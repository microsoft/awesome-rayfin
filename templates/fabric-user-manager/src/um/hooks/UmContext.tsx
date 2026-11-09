/**
 * State of the Fabric User Manager.
 *
 * One provider owns: who is acting (from Graph `/me`, never the app session),
 * what they own and belong to, the activated groups, and for app admins the
 * discovery result of this browser session.
 */
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';

import { useAuth } from '@/hooks/AuthContext';
import { getUmEnv } from '@/um/config/umEnv';
import type { DiscoveryResult } from '@/um/domain/discovery';
import { PROBED_SETS, consentPageUrl, type RefusalKind } from '@/um/domain/permissions';
import { compareWithSession, type SessionMatch } from '@/um/domain/identity';
import { buildRows, type RowView } from '@/um/domain/views';
import type { Binding, DirectoryMember, GraphIdentity, ManagedGroup, Readable } from '@/um/domain/types';
import { runDiscovery } from '@/um/services/discoveryRunner';
import {
  GraphNotConfiguredError,
  GraphSignInRequiredError,
  getGraphToken,
  getPinnedObjectId,
  resetGraphAccount,
  type ScopeSet,
  grantFailureOf,
  probeGraphToken,
  type Probe,
} from '@/um/services/graphAuth';
import type { AccessRequest } from '@/um/domain/accessRequest';
import type { NoticeSender, RequestDeps } from '@/um/services/accessRequests';
import { SETTING_BINDING_CHANGES, type BindingDeps, type BindingWriter } from '@/um/services/bindingChanges';
import { SETTING_GROUP_CREATION, type GroupCreateDeps, type GroupCreator } from '@/um/services/groupCreation';
import type { ChangeDeps, MemberWriter } from '@/um/services/memberChanges';
import { refreshContacts, syncReadBindings, type OperationDeps } from '@/um/services/operations';
import { SETTING_MEMBER_CHANGES, type ReviewDate, type UmStore } from '@/um/services/store';
import { createUmServices, type UmServices } from '@/um/services/services';

export type GraphStatus = 'connecting' | 'connected' | 'needs-sign-in' | 'not-configured' | 'error';

export interface DiscoveryState {
  status: 'idle' | 'running' | 'done' | 'error';
  result?: DiscoveryResult;
  done?: number;
  total?: number;
}

interface UmContextValue {
  services: UmServices;
  graphStatus: GraphStatus;
  graphMissing: string[];
  identity: GraphIdentity | null;
  sessionMatch: SessionMatch;
  isAppAdmin: boolean;
  /** Could not be established (no admin group in the build, or memberships unreadable). */
  adminUnknown: boolean;
  storeReachable: boolean;
  store: UmStore;
  /** Member changes exist in this build. */
  writesInBuild: boolean;
  /** True when the functions that change things could not be loaded, typically after a new version was deployed. */
  partsFailed: boolean;
  /** Member changes are switched on (advisory setting). */
  armed: boolean;
  setArmed: (next: boolean) => Promise<boolean>;
  reviewDates: ReviewDate[];
  /** Everything a member change needs, once identity, build and switch allow it. */
  changeDeps: ChangeDeps | null;
  /** Binding changes are switched on (advisory setting). */
  bindingsArmed: boolean;
  setBindingsArmed: (next: boolean) => Promise<boolean>;
  /** Everything a workspace role binding change needs. App admins only. */
  bindingDeps: BindingDeps | null;
  /** Creating groups is switched on (advisory setting). */
  groupsArmed: boolean;
  setGroupsArmed: (next: boolean) => Promise<boolean>;
  /** Everything creating a group needs. App admins only. */
  groupDeps: GroupCreateDeps | null;
  /** All requests the app holds, newest first. */
  requests: AccessRequest[];
  /** Everything filing or withdrawing a request needs. */
  requestDeps: RequestDeps | null;
  loading: boolean;
  managed: ManagedGroup[];
  storedBindings: Binding[];
  rows: RowView[];
  discovery: DiscoveryState;
  members: Record<string, Readable<DirectoryMember[]>>;
  /** Sign in to Graph. Call from a click handler. */
  connect: () => Promise<void>;
  reload: () => Promise<void>;
  /**
   * Run discovery with the permissions already granted. It never opens a
   * sign-in window; what cannot be read says so. With `audienceRecipients` it
   * also reads who audiences are shared with (Fabric administrators only).
   */
  discover: (audienceRecipients?: boolean) => Promise<void>;
  /** Which permission sets this tab holds. `undefined` means not checked yet. */
  grants: Partial<Record<ScopeSet, boolean>>;
  /** Ask for one permission set. One sign-in window per click; call from a click handler. */
  grant: (scopeSet: ScopeSet) => Promise<boolean>;
  /** Sets that were asked for in this tab and not granted, with what is known about why. */
  refused: Partial<Record<ScopeSet, RefusalKind>>;
  /** Look at the read permission sets without opening a sign-in window. Write sets are never looked at. */
  checkGrants: () => Promise<Partial<Record<ScopeSet, Probe>>>;
  /** The page in Entra where an administrator grants consent for this app. `null` when unknown. */
  consentUrl: string | null;
  /** Load one group's direct members. Call from a click handler the first time. */
  loadMembers: (groupId: string, interactive: boolean) => Promise<Readable<DirectoryMember[]>>;
  /** Present once the acting identity is known. */
  deps: OperationDeps | null;
}

const UmContext = createContext<UmContextValue | null>(null);

const EMPTY: Readable<string[]> = { state: 'not-readable', reason: 'no-route' };

/** Where the offline demo keeps its state. A browser that blocks storage gives none, and the demo then forgets on reload. */
function tabStorage(): Storage | undefined {
  try {
    return window.sessionStorage;
  } catch {
    return undefined;
  }
}

export function UmProvider({ children, services: injected }: { children: ReactNode; services?: UmServices }) {
  const services = useMemo(() => injected ?? createUmServices(undefined, undefined, tabStorage()), [injected]);
  const { user } = useAuth();
  const sessionEmail = user?.email;

  const [graphStatus, setGraphStatus] = useState<GraphStatus>('connecting');
  const [graphMissing, setGraphMissing] = useState<string[]>([]);
  const [identity, setIdentity] = useState<GraphIdentity | null>(null);
  const [owned, setOwned] = useState<Readable<string[]>>(EMPTY);
  const [memberOf, setMemberOf] = useState<Readable<string[]>>(EMPTY);
  const [storeReachable, setStoreReachable] = useState(true);
  const [loading, setLoading] = useState(true);
  const [managed, setManaged] = useState<ManagedGroup[]>([]);
  const [storedBindings, setStoredBindings] = useState<Binding[]>([]);
  const [discovery, setDiscovery] = useState<DiscoveryState>({ status: 'idle' });
  const [members, setMembers] = useState<Record<string, Readable<DirectoryMember[]>>>({});
  const [grants, setGrants] = useState<Partial<Record<ScopeSet, boolean>>>({});
  const [refused, setRefused] = useState<Partial<Record<ScopeSet, RefusalKind>>>({});
  const [armed, setArmedState] = useState(false);
  const [reviewDates, setReviewDates] = useState<ReviewDate[]>([]);
  const [writer, setWriter] = useState<MemberWriter | null>(null);
  const [partsFailed, setPartsFailed] = useState(false);
  const [sender, setSender] = useState<NoticeSender | null>(null);
  const [bindingWriter, setBindingWriter] = useState<BindingWriter | null>(null);
  const [bindingsArmed, setBindingsArmedState] = useState(false);
  const [groupCreator, setGroupCreator] = useState<GroupCreator | null>(null);
  const [groupsArmed, setGroupsArmedState] = useState(false);
  const [requests, setRequests] = useState<AccessRequest[]>([]);
  const autoDiscovered = useRef(false);
  /** Bumped whenever the acting account may have changed; late results from before are dropped. */
  const generation = useRef(0);

  const reload = useCallback(async () => {
    const loaded = await services.store.load();
    setStoreReachable(loaded.reachable);
    setManaged(loaded.groups);
    setStoredBindings(loaded.bindings);
    if (services.writesInBuild && loaded.reachable) {
      const [setting, bindingSetting, groupSetting, dates] = await Promise.all([
        services.store.getSetting(SETTING_MEMBER_CHANGES).catch(() => undefined),
        services.store.getSetting(SETTING_BINDING_CHANGES).catch(() => undefined),
        services.store.getSetting(SETTING_GROUP_CREATION).catch(() => undefined),
        services.store.listReviewDates().catch(() => [] as ReviewDate[]),
      ]);
      // Only an explicit `true` switches changes on.
      setArmedState(setting === true);
      setBindingsArmedState(bindingSetting === true);
      setGroupsArmedState(groupSetting === true);
      setReviewDates(dates);
      setRequests(await services.store.listRequests().catch(() => [] as AccessRequest[]));
    }
  }, [services]);

  useEffect(() => {
    let cancelled = false;
    // These parts are fetched after the page. A page that was opened before a
    // new version was deployed asks for files that are gone: seen live on
    // 2026-10-12, where it silently left the app read-only and hid a waiting
    // request. The person is told to reload instead.
    const failed = () => {
      if (!cancelled) setPartsFailed(true);
    };
    services.loadWriter().then((loaded) => {
      if (!cancelled) setWriter(loaded);
    }, failed);
    services.loadSender().then((loaded) => {
      if (!cancelled) setSender(loaded);
    }, failed);
    services.loadBindingWriter().then((loaded) => {
      if (!cancelled) setBindingWriter(loaded);
    }, failed);
    services.loadGroupCreator().then((loaded) => {
      if (!cancelled) setGroupCreator(loaded);
    }, failed);
    return () => {
      cancelled = true;
    };
  }, [services]);

  const establish = useCallback(
    async (interactive: boolean) => {
      setGraphStatus('connecting');
      if (interactive) {
        // A deliberate reconnect starts clean: no pinned account, and nothing
        // that was read as the previous account stays on screen.
        resetGraphAccount();
        generation.current += 1;
        setMembers({});
        setDiscovery({ status: 'idle' });
        autoDiscovered.current = false;
      }
      try {
        const me = await services.directory.me({ interactive, loginHint: sessionEmail });
        // The identity shown and logged must be the account whose tokens are
        // used from here on. The sign-in module pins that account; this makes
        // sure `/me` answered for the same one.
        if (!services.mock && getPinnedObjectId() !== me.objectId) throw new Error('identity-mismatch');
        const [ownedIds, memberIds] = await Promise.all([services.directory.myOwnedGroupIds(), services.directory.myGroupIds()]);
        setIdentity(me);
        setOwned(ownedIds);
        setMemberOf(memberIds);
        setGraphStatus('connected');
      } catch (error) {
        setIdentity(null);
        if (error instanceof GraphNotConfiguredError) {
          setGraphMissing(error.missing);
          setGraphStatus('not-configured');
        } else if (error instanceof GraphSignInRequiredError) {
          setGraphStatus('needs-sign-in');
        } else {
          setGraphStatus(interactive ? 'error' : 'needs-sign-in');
        }
      }
    },
    [services, sessionEmail]
  );

  // The Graph account belongs to one mounted session of this provider. The
  // provider sits below the sign-in guard, so it unmounts on sign-out and
  // mounts again for the next person: forgetting the account at both ends is
  // what keeps the next person in the same tab from inheriting it.
  useEffect(() => {
    resetGraphAccount();
    return () => {
      resetGraphAccount();
      generation.current += 1;
    };
  }, []);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      await Promise.all([reload(), establish(false)]);
      if (!cancelled) setLoading(false);
    })();
    return () => {
      cancelled = true;
    };
  }, [reload, establish]);

  const adminGroupId = services.adminGroupId?.toLowerCase();
  // Named in the build, or a member of the admin group. Both are compared
  // with the Graph identity, never with the app session.
  const namedAdmin = !!identity && services.adminUserIds.includes(identity.objectId);
  const groupAdmin = !!adminGroupId && memberOf.state === 'ok' && memberOf.value.includes(adminGroupId);
  const isAppAdmin = namedAdmin || groupAdmin;
  const noAdminConfigured = !adminGroupId && services.adminUserIds.length === 0;
  const adminUnknown = graphStatus === 'connected' && !isAppAdmin && (noAdminConfigured || (!!adminGroupId && memberOf.state !== 'ok'));

  const deps = useMemo<OperationDeps | null>(
    () => (identity ? { store: services.store, actor: identity } : null),
    [identity, services]
  );

  const changeDeps = useMemo<ChangeDeps | null>(
    () =>
      identity && writer && services.writesInBuild
        ? { store: services.store, directory: services.directory, writer, actor: identity, isAppAdmin, armed, adminGroupId: services.adminGroupId }
        : null,
    [identity, writer, services, isAppAdmin, armed]
  );

  const requestDeps = useMemo<RequestDeps | null>(
    () =>
      identity && services.writesInBuild
        ? { store: services.store, actor: identity, sender, directory: services.directory, appUrl: typeof window !== 'undefined' ? `${window.location.origin}/um` : '/um' }
        : null,
    [identity, services, sender]
  );

  const bindingDeps = useMemo<BindingDeps | null>(
    () =>
      identity && bindingWriter && services.writesInBuild && isAppAdmin
        ? {
            store: services.store,
            directory: services.directory,
            fabric: services.fabric,
            writer: bindingWriter,
            actor: identity,
            isAppAdmin,
            armed: bindingsArmed,
            adminGroupId: services.adminGroupId,
            adminUserIds: services.adminUserIds,
          }
        : null,
    [identity, bindingWriter, services, isAppAdmin, bindingsArmed]
  );

  const groupDeps = useMemo<GroupCreateDeps | null>(
    () =>
      identity && groupCreator && services.writesInBuild && isAppAdmin
        ? {
            store: services.store,
            directory: services.directory,
            creator: groupCreator,
            actor: identity,
            isAppAdmin,
            armed: groupsArmed,
            adminGroupId: services.adminGroupId,
            adminUserIds: services.adminUserIds,
          }
        : null,
    [identity, groupCreator, services, isAppAdmin, groupsArmed]
  );

  const setGroupsArmed = useCallback(
    async (next: boolean) => {
      if (!isAppAdmin || !identity || !services.writesInBuild) return false;
      const ok = await services.store.setSetting(SETTING_GROUP_CREATION, next, identity.userPrincipalName);
      if (ok) {
        setGroupsArmedState(next);
        await services.store
          .audit({ action: 'switch', outcome: 'ok', actorOid: identity.objectId, actorUpn: identity.userPrincipalName, detail: JSON.stringify({ groupCreation: next }) })
          .catch(() => undefined);
      }
      return ok;
    },
    [isAppAdmin, identity, services]
  );

  const setBindingsArmed = useCallback(
    async (next: boolean) => {
      if (!isAppAdmin || !identity || !services.writesInBuild) return false;
      const ok = await services.store.setSetting(SETTING_BINDING_CHANGES, next, identity.userPrincipalName);
      if (ok) {
        setBindingsArmedState(next);
        await services.store
          .audit({ action: 'switch', outcome: 'ok', actorOid: identity.objectId, actorUpn: identity.userPrincipalName, detail: JSON.stringify({ bindingChanges: next }) })
          .catch(() => undefined);
      }
      return ok;
    },
    [isAppAdmin, identity, services]
  );

  const setArmed = useCallback(
    async (next: boolean) => {
      if (!isAppAdmin || !identity || !services.writesInBuild) return false;
      const ok = await services.store.setSetting(SETTING_MEMBER_CHANGES, next, identity.userPrincipalName);
      if (ok) {
        setArmedState(next);
        await services.store
          .audit({ action: 'switch', outcome: 'ok', actorOid: identity.objectId, actorUpn: identity.userPrincipalName, detail: JSON.stringify({ memberChanges: next }) })
          .catch(() => undefined);
      }
      return ok;
    },
    [isAppAdmin, identity, services]
  );

  /** Is a token for this set available without a sign-in window? */
  const held = useCallback(
    async (scopeSet: ScopeSet) => {
      if (services.mock) return true;
      try {
        await getGraphToken(scopeSet, { loginHint: sessionEmail });
        return true;
      } catch {
        return false;
      }
    },
    [services.mock, sessionEmail]
  );

  const grant = useCallback(
    async (scopeSet: ScopeSet) => {
      let ok = services.mock;
      let why: RefusalKind | undefined;
      if (!ok) {
        try {
          // Exactly one sign-in window per click: a second one in the same
          // click would be blocked by the browser.
          await getGraphToken(scopeSet, { interactive: true, loginHint: sessionEmail });
          ok = true;
        } catch (error) {
          ok = false;
          why = grantFailureOf(error);
        }
      }
      setGrants((g) => ({ ...g, [scopeSet]: ok }));
      setRefused((r) => ({ ...r, [scopeSet]: why }));
      return ok;
    },
    [services.mock, sessionEmail]
  );

  const checkGrants = useCallback(async () => {
    const results = await Promise.all(PROBED_SETS.map((set) => (services.mock ? Promise.resolve<Probe>('held') : probeGraphToken(set, { loginHint: sessionEmail }))));
    const probes: Partial<Record<ScopeSet, Probe>> = Object.fromEntries(PROBED_SETS.map((set, i) => [set, results[i]]));
    setGrants((g) => {
      const next = { ...g };
      for (const set of PROBED_SETS) {
        // A look that arrives late never takes back a permission that was given in the meantime.
        if (probes[set] === 'held') next[set] = true;
        else if (probes[set] === 'not-held' && next[set] !== true) next[set] = false;
      }
      return next;
    });
    return probes;
  }, [services.mock, sessionEmail]);

  const consentUrl = useMemo(() => {
    if (services.mock) return null;
    const env = getUmEnv();
    return consentPageUrl(env.tenantId, env.clientId);
  }, [services.mock]);

  const discover = useCallback(
    async (audienceRecipients = false) => {
      if (!isAppAdmin || !deps) return;
      // Find out what this tab may read. A missing permission does not stop
      // the rest: those reads come back as "not readable".
      const [fabric, directory] = await Promise.all([held('fabric'), held('directory')]);
      const fabricAdmin = audienceRecipients ? await held('fabricAdmin') : undefined;
      setGrants((g) => ({ ...g, fabric, directory, ...(fabricAdmin === undefined ? {} : { fabricAdmin }) }));
      const started = generation.current;
      setDiscovery((d) => ({ ...d, status: 'running', done: 0, total: 0 }));
      try {
        const result = await runDiscovery(services.fabric, services.directory, {
          adminGroupId,
          adminUserIds: services.adminUserIds,
          audienceRecipients: audienceRecipients && fabricAdmin === true,
          onProgress: (done, total) => {
            if (generation.current === started) setDiscovery((d) => ({ ...d, done, total }));
          },
        });
        // Read as an account that is no longer the acting one: discard.
        if (generation.current !== started) return;
        setDiscovery({ status: 'done', result });
        const loaded = await services.store.load();
        if (loaded.reachable) {
          const changed = await syncReadBindings(deps, loaded.groups, loaded.bindings, result);
          await refreshContacts(deps, loaded.groups, result);
          if (changed > 0) await reload();
        }
      } catch {
        setDiscovery((d) => ({ ...d, status: 'error' }));
      }
    },
    [isAppAdmin, deps, services, adminGroupId, reload, held]
  );

  // "Discovery on every admin visit": once per visit, silently. If a token
  // needs a click, the Setup page offers the button instead.
  useEffect(() => {
    if (isAppAdmin && deps && !autoDiscovered.current) {
      autoDiscovered.current = true;
      void discover();
    }
  }, [isAppAdmin, deps, discover]);

  const loadMembers = useCallback(
    async (groupId: string, interactive: boolean) => {
      const id = groupId.toLowerCase();
      const started = generation.current;
      const result = await services.directory.listMembers(id, { interactive, loginHint: sessionEmail });
      if (generation.current === started) setMembers((m) => ({ ...m, [id]: result }));
      return result;
    },
    [services, sessionEmail]
  );

  const rows = useMemo(
    () =>
      buildRows(managed, storedBindings, discovery.result?.bindings ?? [], {
        isAppAdmin,
        ownedGroupIds: owned.state === 'ok' ? owned.value : [],
        memberGroupIds: memberOf.state === 'ok' ? memberOf.value : [],
      }),
    [managed, storedBindings, discovery.result, isAppAdmin, owned, memberOf]
  );

  const value = useMemo<UmContextValue>(
    () => ({
      services,
      graphStatus,
      graphMissing,
      identity,
      sessionMatch: identity ? compareWithSession(identity, sessionEmail) : 'unknown',
      isAppAdmin,
      adminUnknown,
      storeReachable,
      store: services.store,
      writesInBuild: services.writesInBuild,
      partsFailed,
      armed,
      setArmed,
      reviewDates,
      changeDeps,
      requests,
      requestDeps,
      bindingsArmed,
      setBindingsArmed,
      bindingDeps,
      groupsArmed,
      setGroupsArmed,
      groupDeps,
      loading,
      managed,
      storedBindings,
      rows,
      discovery,
      members,
      connect: () => establish(true),
      reload,
      discover,
      grants,
      grant,
      refused,
      checkGrants,
      consentUrl,
      loadMembers,
      deps,
    }),
    [services, graphStatus, graphMissing, identity, sessionEmail, isAppAdmin, adminUnknown, storeReachable, loading, managed, storedBindings, rows, discovery, members, establish, reload, discover, grants, grant, refused, checkGrants, consentUrl, loadMembers, deps, armed, setArmed, reviewDates, changeDeps, requests, requestDeps, bindingsArmed, setBindingsArmed, bindingDeps, groupsArmed, setGroupsArmed, groupDeps, partsFailed]
  );

  return <UmContext.Provider value={value}>{children}</UmContext.Provider>;
}

export function useUm(): UmContextValue {
  const ctx = useContext(UmContext);
  if (!ctx) throw new Error('useUm must be used inside <UmProvider>');
  return ctx;
}

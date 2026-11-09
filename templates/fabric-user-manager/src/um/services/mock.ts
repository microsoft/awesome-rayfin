/**
 * Offline demo data (`VITE_UM_MOCK=true`). No tenant, no backend, no token.
 *
 * The fixtures cover every state the views must show honestly: a workspace
 * whose roles cannot be read, an ineligible group, a direct user assignment,
 * a service principal, a nested group, a Member-role group owned by someone
 * who is not an app admin, and attested bindings for an audience and a model
 * role. Names are invented.
 *
 * The persona is chosen with `?as=admin|owner|user` so all three views can be
 * looked at without signing in.
 */
import {
  notReadable,
  ok,
  type Binding,
  type DirectoryMember,
  type FabricItem,
  type FabricItemType,
  type FabricWorkspace,
  type GraphIdentity,
  type GroupFacts,
  type ItemAccess,
  type ManagedGroup,
  type Readable,
  type RoleAssignment,
} from '@/um/domain/types';

import type { DirectoryGateway, FabricGateway } from './gateways';
import type { NoticeSender } from './accessRequests';
import type { BindingWriter } from './bindingChanges';
import type { RoleChange, RoleWriteOutcome } from './fabricWrite';
import type { MailOutcome, Notice } from './graphMail';
import type { CreateOutcome, NewGroup } from './graphGroupCreate';
import type { WriteOutcome } from './graphWrite';
import type { GroupCreator } from './groupCreation';
import type { MemberWriter } from './memberChanges';
import { MemoryUmStore } from './store';

const id = (block: string, n: number) => `${block}-0000-4000-8000-${String(n).padStart(12, '0')}`;

export const MOCK_ADMIN_GROUP_ID = id('aaaaaaaa', 1);

const USERS = {
  admin: { id: id('11111111', 1), name: 'Alex Admin', upn: 'alex.admin@contoso.example' },
  owner: { id: id('11111111', 2), name: 'Olivia Owner', upn: 'olivia.owner@contoso.example' },
  user: { id: id('11111111', 3), name: 'Uwe User', upn: 'uwe.user@contoso.example' },
  anna: { id: id('11111111', 4), name: 'Anna Analyst', upn: 'anna.analyst@contoso.example' },
  ben: { id: id('11111111', 5), name: 'Ben Berater', upn: 'ben.berater@contoso.example' },
  guest: { id: id('11111111', 6), name: 'Gina Guest', upn: 'gina_partner.example#EXT#@contoso.example' },
  // In no group at the start: someone an owner can add in the demo.
  carla: { id: id('11111111', 7), name: 'Carla Controller', upn: 'carla.controller@contoso.example' },
} as const;

export type MockPersona = 'admin' | 'owner' | 'user';

const WS = {
  sales: id('22222222', 1),
  finance: id('22222222', 2),
  hr: id('22222222', 3),
};

const G = {
  salesViewer: id('33333333', 1),
  salesContributor: id('33333333', 2),
  salesAdmin: id('33333333', 3),
  financeMember: id('33333333', 4),
  financeAll: id('33333333', 5),
  appManagement: id('33333333', 6),
  rlsDach: id('33333333', 7),
  nested: id('33333333', 8),
};

const user = (u: { id: string; name: string; upn: string }, guest = false): DirectoryMember => ({
  id: u.id,
  type: 'user',
  displayName: u.name,
  userPrincipalName: u.upn,
  userType: guest ? 'Guest' : 'Member',
  accountEnabled: true,
});

const securityGroup = (groupId: string, displayName: string, description = ''): GroupFacts => ({
  id: groupId,
  displayName,
  description,
  securityEnabled: true,
  mailEnabled: false,
  groupTypes: [],
  isAssignableToRole: null,
  onPremisesSyncEnabled: null,
  membershipRule: null,
});

const GROUPS: Record<string, { facts: GroupFacts; owners: DirectoryMember[]; members: DirectoryMember[] }> = {
  [G.salesViewer]: {
    facts: securityGroup(G.salesViewer, 'FAB-Sales-Viewer', 'Read access to the Sales Reporting workspace'),
    owners: [user(USERS.owner)],
    members: [user(USERS.anna), user(USERS.ben), user(USERS.guest, true)],
  },
  [G.salesContributor]: {
    facts: securityGroup(G.salesContributor, 'FAB-Sales-Contributor'),
    owners: [user(USERS.owner)],
    members: [user(USERS.anna)],
  },
  [G.salesAdmin]: {
    facts: securityGroup(G.salesAdmin, 'FAB-Sales-Admin'),
    owners: [user(USERS.admin)],
    members: [user(USERS.admin)],
  },
  [G.financeMember]: {
    facts: securityGroup(G.financeMember, 'FAB-Finance-Member'),
    owners: [user(USERS.owner)],
    members: [user(USERS.ben)],
  },
  [G.financeAll]: {
    facts: { ...securityGroup(G.financeAll, 'Finance All'), mailEnabled: true, groupTypes: ['Unified'] },
    owners: [user(USERS.owner)],
    members: [user(USERS.anna), user(USERS.ben), user(USERS.user)],
  },
  [G.appManagement]: {
    facts: securityGroup(G.appManagement, 'APP-Sales-Management', 'Management audience of the Sales app'),
    owners: [user(USERS.owner)],
    members: [user(USERS.ben)],
  },
  [G.rlsDach]: {
    facts: securityGroup(G.rlsDach, 'RLS-Sales-DACH', 'Sales rows for Germany, Austria and Switzerland'),
    owners: [user(USERS.owner)],
    members: [user(USERS.anna), { id: G.nested, type: 'group', displayName: 'Sales Trainees' }],
  },
  [MOCK_ADMIN_GROUP_ID]: {
    facts: securityGroup(MOCK_ADMIN_GROUP_ID, 'Fabric User Manager Admins'),
    owners: [user(USERS.admin)],
    members: [user(USERS.admin)],
  },
};

const WORKSPACES: FabricWorkspace[] = [
  { id: WS.sales, displayName: 'Sales Reporting', type: 'Workspace' },
  { id: WS.finance, displayName: 'Finance Reporting', type: 'Workspace' },
  { id: WS.hr, displayName: 'HR Analytics', type: 'Workspace' },
];

const assignment = (n: number, principalId: string, principalType: RoleAssignment['principalType'], principalName: string, role: string): RoleAssignment => ({
  id: id('44444444', n),
  principalId,
  principalType,
  principalName,
  role,
});

const ROLES: Record<string, Readable<RoleAssignment[]>> = {
  [WS.sales]: ok([
    assignment(1, G.salesViewer, 'Group', 'FAB-Sales-Viewer', 'Viewer'),
    assignment(2, G.salesContributor, 'Group', 'FAB-Sales-Contributor', 'Contributor'),
    assignment(3, G.salesAdmin, 'Group', 'FAB-Sales-Admin', 'Admin'),
    assignment(4, id('55555555', 1), 'ServicePrincipal', 'sp-sales-deploy', 'Member'),
  ]),
  [WS.finance]: ok([
    assignment(5, G.financeMember, 'Group', 'FAB-Finance-Member', 'Member'),
    assignment(6, G.financeAll, 'Group', 'Finance All', 'Viewer'),
    assignment(7, USERS.user.id, 'User', USERS.user.name, 'Contributor'),
    assignment(8, G.salesViewer, 'Group', 'FAB-Sales-Viewer', 'Viewer'),
  ]),
  [WS.hr]: notReadable('access-denied'),
};

const item = (n: number, displayName: string, type: string, workspaceId: string): FabricItem => ({
  id: id('66666666', n),
  displayName,
  type,
  workspaceId,
});

const ITEMS: FabricItem[] = [
  item(1, 'Sales App', 'OrgApp', WS.sales),
  item(2, 'Management', 'OrgAppAudience', WS.sales),
  item(3, 'All Sales', 'OrgAppAudience', WS.sales),
  item(4, 'Sales Model', 'SemanticModel', WS.sales),
  item(5, 'Finance Model', 'SemanticModel', WS.finance),
];

export function readMockPersona(search: string): MockPersona {
  const value = new URLSearchParams(search).get('as');
  return value === 'owner' || value === 'user' ? value : 'admin';
}

export class MockDirectoryGateway implements DirectoryGateway {
  constructor(private readonly persona: MockPersona) {}

  private get self() {
    return USERS[this.persona];
  }

  async me(): Promise<GraphIdentity> {
    return { objectId: this.self.id, userPrincipalName: this.self.upn, displayName: this.self.name, mail: this.self.upn };
  }

  async myGroupIds(): Promise<Readable<string[]>> {
    return ok(Object.entries(GROUPS).filter(([, g]) => g.members.some((m) => m.id === this.self.id)).map(([gid]) => gid));
  }

  async myTransitiveGroupIds(): Promise<Readable<string[]>> {
    // The fixtures hold no nested groups.
    return this.myGroupIds();
  }

  async myOwnedGroupIds(): Promise<Readable<string[]>> {
    return ok(Object.entries(GROUPS).filter(([, g]) => g.owners.some((m) => m.id === this.self.id)).map(([gid]) => gid));
  }

  async getGroup(groupId: string): Promise<Readable<GroupFacts>> {
    const group = GROUPS[groupId.toLowerCase()];
    return group ? ok(group.facts) : notReadable('failed', '404');
  }

  async listOwners(groupId: string): Promise<Readable<DirectoryMember[]>> {
    const group = GROUPS[groupId.toLowerCase()];
    return group ? ok(group.owners) : notReadable('failed', '404');
  }

  async listMembers(groupId: string): Promise<Readable<DirectoryMember[]>> {
    const group = GROUPS[groupId.toLowerCase()];
    return group ? ok(group.members) : notReadable('failed', '404');
  }

  async findUser(query: string): Promise<Readable<DirectoryMember | null>> {
    const q = query.trim().toLowerCase();
    const found = Object.values(USERS).find((u) => u.upn.toLowerCase() === q || u.id === q);
    return ok(found ? user(found, found === USERS.guest) : null);
  }

  resolveUser(query: string): Promise<Readable<DirectoryMember | null>> {
    return this.findUser(query);
  }

  async findGroupsByName(displayName: string): Promise<Readable<{ id: string; displayName: string; mailNickname?: string }[]>> {
    const name = displayName.trim().toLowerCase();
    return ok(
      Object.values(GROUPS)
        .filter((g) => g.facts.displayName.toLowerCase() === name)
        .map((g) => ({ id: g.facts.id, displayName: g.facts.displayName, mailNickname: MOCK_ALIASES.get(g.facts.id) }))
    );
  }
}

const MOCK_ALIASES = new Map<string, string>();

/** Demo only: adds a group to the fixtures in memory, owned by the acting person and the chosen owners. */
export class MockGroupCreator implements GroupCreator {
  private count = 0;
  async create(group: NewGroup, actorObjectId: string): Promise<CreateOutcome> {
    // A range of its own: the fixtures use other first blocks. The demo may have kept groups from before a reload.
    const idOf = (n: number) => `99999999-0000-4000-8000-${String(n).padStart(12, '0')}`;
    do this.count += 1;
    while (GROUPS[idOf(this.count)]);
    const id = idOf(this.count);
    const people = Object.values(USERS);
    const owners = [actorObjectId, ...group.ownerIds]
      .map((oid) => people.find((u) => u.id === oid.toLowerCase()))
      .filter((u): u is (typeof people)[number] => !!u)
      .map((u) => user(u));
    GROUPS[id] = { facts: securityGroup(id, group.displayName, group.description), owners, members: [] };
    MOCK_ALIASES.set(id, group.mailNickname);
    saveDemoState();
    return { ok: true, id };
  }
}

/** Demo only: changes the fixtures in memory, so the views show the effect. */
export class MockMemberWriter implements MemberWriter {
  async write(action: 'add' | 'remove', groupId: string, userId: string, _actorObjectId: string): Promise<WriteOutcome> {
    const group = GROUPS[groupId.toLowerCase()];
    const person = Object.values(USERS).find((u) => u.id === userId.toLowerCase());
    if (!group || !person) return { ok: false, code: 'failed' };
    const isMember = group.members.some((m) => m.id === person.id);
    if (action === 'add') {
      if (isMember) return { ok: false, code: 'already-member' };
      group.members = [...group.members, user(person)];
    } else {
      if (!isMember) return { ok: false, code: 'not-member' };
      group.members = group.members.filter((m) => m.id !== person.id);
    }
    saveDemoState();
    return { ok: true };
  }
}

export class MockFabricGateway implements FabricGateway {
  async listWorkspaces(): Promise<Readable<FabricWorkspace[]>> {
    return ok(WORKSPACES);
  }
  async listRoleAssignments(workspaceId: string): Promise<Readable<RoleAssignment[]>> {
    return ROLES[workspaceId] ?? notReadable('failed', '404');
  }
  async listItems(workspaceId: string, itemType: FabricItemType): Promise<Readable<FabricItem[]>> {
    if (workspaceId === WS.hr) return notReadable('access-denied');
    return ok(ITEMS.filter((i) => i.workspaceId === workspaceId && i.type === itemType));
  }
  async listItemAccess(workspaceId: string, itemId: string): Promise<Readable<ItemAccess[]>> {
    const roles = ROLES[workspaceId];
    if (!roles || roles.state !== 'ok') return notReadable('access-denied');
    // Everyone with a workspace role is listed, as the real API does.
    const inherited: ItemAccess[] = roles.value.map((r) => ({
      principalId: r.principalId,
      principalType: r.principalType,
      principalName: r.principalName,
      permissions: ['Read'],
    }));
    const management = ITEMS.find((i) => i.displayName === 'Management');
    if (itemId !== management?.id) return ok(inherited);
    return ok([
      ...inherited,
      { principalId: G.appManagement, principalType: 'Group', principalName: 'APP-Sales-Management', permissions: ['Read'] },
      { principalId: USERS.ben.id, principalType: 'User', principalName: USERS.ben.name, permissions: ['Read'] },
    ]);
  }
}

const managed = (n: number, groupId: string, name: string, requestable: boolean, description: string): ManagedGroup => ({
  id: id('77777777', n),
  groupId,
  nameSnapshot: name,
  requestable,
  description,
  maxDays: 0,
  active: true,
  version: 1,
  activatedByOid: USERS.admin.id,
  activatedByUpn: USERS.admin.upn,
  activatedAt: '2026-10-01T09:00:00.000Z',
  updatedAt: '2026-10-01T09:00:00.000Z',
});

export function createMockStore(): MemoryUmStore {
  const groups: ManagedGroup[] = [
    managed(1, G.salesViewer, 'FAB-Sales-Viewer', true, 'Read access to the Sales Reporting workspace'),
    managed(2, G.appManagement, 'APP-Sales-Management', true, 'Management audience of the Sales app'),
    managed(3, G.rlsDach, 'RLS-Sales-DACH', false, 'Sales rows for Germany, Austria and Switzerland'),
  ];
  const bindings: Binding[] = [
    { groupId: G.salesViewer, kind: 'Workspace', scopeId: WS.sales, scopeName: 'Sales Reporting', label: 'Viewer', provenance: 'read' },
    { groupId: G.salesViewer, kind: 'Workspace', scopeId: WS.finance, scopeName: 'Finance Reporting', label: 'Viewer', provenance: 'read' },
    { groupId: G.appManagement, kind: 'Audience', scopeName: 'Sales App', label: 'Management', provenance: 'attested' },
    { groupId: G.rlsDach, kind: 'ModelRole', scopeName: 'Sales Model', label: 'Region DACH', provenance: 'attested' },
  ];
  return new MemoryUmStore({ groups, bindings });
}

/* ───────────────── keeping the demo across a reload ───────────────── */

const DEMO_STATE_KEY = 'um.demo.state';
const DEMO_STATE_VERSION = 1;
let saveDemoState: () => void = () => {};

/** A short mark of a text. Only to tell two fixture sets apart, nothing depends on it being unguessable. */
function markOf(text: string): string {
  let hash = 5381;
  for (let i = 0; i < text.length; i += 1) hash = ((hash << 5) + hash + text.charCodeAt(i)) | 0;
  return `${text.length}.${hash >>> 0}`;
}

/**
 * Offline demo only. The demo picks its person with `?as=`, which loads the page
 * again, and a fresh page would forget every request and change. With this the
 * state lives in the browser tab (session storage), so one person can file a
 * request and another can decide it. Closing the tab starts over. Tests and a
 * deployment never come here.
 */
export function createTabMockStore(storage: Pick<Storage, 'getItem' | 'setItem'>): MemoryUmStore {
  const store = createMockStore();
  // What the fixtures look like in THIS build, before anything is restored. A tab that still holds
  // the state of an older build would otherwise hide every fixture added since.
  const fixtures = markOf(JSON.stringify([GROUPS, ROLES, store.snapshot()]));
  try {
    const saved = JSON.parse(storage.getItem(DEMO_STATE_KEY) ?? 'null');
    if (saved?.version === DEMO_STATE_VERSION && saved.fixtures === fixtures) {
      store.restore(saved.store);
      Object.assign(GROUPS, saved.groups);
      Object.assign(ROLES, saved.roles);
      for (const [id, alias] of saved.aliases as [string, string][]) MOCK_ALIASES.set(id, alias);
    }
  } catch {
    // A missing or broken snapshot: the demo starts from the fixtures.
  }
  saveDemoState = () => {
    try {
      storage.setItem(
        DEMO_STATE_KEY,
        JSON.stringify({ version: DEMO_STATE_VERSION, fixtures, store: store.snapshot(), groups: GROUPS, roles: ROLES, aliases: [...MOCK_ALIASES] })
      );
    } catch {
      // Storage full or blocked: the demo works on, it just forgets on reload.
    }
  };
  // Every call that may have changed the store is followed by a save. Reads are cheap to save after, too.
  return new Proxy(store, {
    get(target, prop) {
      const value = Reflect.get(target, prop, target);
      if (typeof value !== 'function') return value;
      return (...args: unknown[]) => {
        const result = (value as (...a: unknown[]) => unknown).apply(target, args);
        if (!(result instanceof Promise)) return result;
        return result.then((settled) => {
          saveDemoState();
          return settled;
        });
      };
    },
  });
}

export const MOCK_SESSION_USER = (persona: MockPersona) => ({
  id: USERS[persona].id,
  email: USERS[persona].upn,
  name: USERS[persona].name,
});

/** Demo only: nothing is sent; the notices are kept so the demo and tests can show them. */
export class MockNoticeSender implements NoticeSender {
  readonly sent: Notice[] = [];
  async send(notice: Notice): Promise<MailOutcome> {
    this.sent.push(notice);
    return { ok: true, recipients: notice.to.split(';').filter(Boolean).length };
  }
}

/** Demo only: changes the role fixtures in memory, so discovery shows the effect. */
export class MockBindingWriter implements BindingWriter {
  async write(change: RoleChange, _actorObjectId: string): Promise<RoleWriteOutcome> {
    const roles = ROLES[change.workspaceId];
    if (!roles || roles.state !== 'ok') return { ok: false, code: 'denied' };
    if (change.action === 'add') {
      const name = GROUPS[change.groupId]?.facts.displayName ?? change.groupId;
      ROLES[change.workspaceId] = ok([...roles.value, { id: change.groupId, principalId: change.groupId, principalType: 'Group', principalName: name, role: change.role }]);
      saveDemoState();
      return { ok: true };
    }
    if (!roles.value.some((a) => a.id === change.assignmentId)) return { ok: false, code: 'not-found' };
    ROLES[change.workspaceId] = ok(
      change.action === 'remove'
        ? roles.value.filter((a) => a.id !== change.assignmentId)
        : roles.value.map((a) => (a.id === change.assignmentId ? { ...a, role: change.role } : a))
    );
    saveDemoState();
    return { ok: true };
  }
}

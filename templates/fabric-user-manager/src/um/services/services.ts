/**
 * Wires the Fabric User Manager's gateways and store for the current build:
 * fixtures in the offline demo, live Graph and the app database otherwise.
 */
import { getUmEnv, type UmEnv } from '@/um/config/umEnv';

import { runFabricOp, type FabricOpRequest, type FabricOpResult } from './fabricOps';
import { GraphDirectoryGateway, OpFabricGateway, type DirectoryGateway, type FabricGateway } from './gateways';
import { getGraphToken } from './graphAuth';
import type { NoticeSender } from './accessRequests';
import type { BindingWriter } from './bindingChanges';
import type { GroupCreator } from './groupCreation';
import type { MemberWriter } from './memberChanges';
import {
  createMockStore,
  createTabMockStore,
  MOCK_ADMIN_GROUP_ID,
  MockBindingWriter,
  MockDirectoryGateway,
  MockFabricGateway,
  MockGroupCreator,
  MockMemberWriter,
  MockNoticeSender,
  readMockPersona,
} from './mock';
import { RayfinUmStore, type UmStore } from './store';

export interface UmServices {
  env: UmEnv;
  mock: boolean;
  adminGroupId?: string;
  adminUserIds: string[];
  directory: DirectoryGateway;
  fabric: FabricGateway;
  store: UmStore;
  /** False in a build made without member changes: it then contains no write path at all. */
  writesInBuild: boolean;
  /** The member writer of this build, or `null` when the build has none. */
  loadWriter: () => Promise<MemberWriter | null>;
  /** Sends the request notice, or `null` when the build has no member changes. */
  loadSender: () => Promise<NoticeSender | null>;
  /** The workspace role writer of this build, or `null` when the build has none. */
  loadBindingWriter: () => Promise<BindingWriter | null>;
  /** Creates groups, or `null` when the build has no changes. */
  loadGroupCreator: () => Promise<GroupCreator | null>;
}

/**
 * Fabric calls from the browser with the signed-in person's own token. The
 * access list of an item is an administrator API and gets its own scope. When
 * no token can be had without a click, the operation reports that and the
 * read is shown as "not readable".
 */
async function invokeFabric(request: FabricOpRequest): Promise<FabricOpResult> {
  let token: string | undefined;
  try {
    token = await getGraphToken(request.op === 'listItemAccess' ? 'fabricAdmin' : 'fabric');
  } catch {
    token = undefined;
  }
  return runFabricOp(token, request, (url, init) => fetch(url, init));
}

export function createUmServices(
  env: UmEnv = getUmEnv(),
  search = typeof window !== 'undefined' ? window.location.search : '',
  /** Offline demo only: where the demo keeps its state across a reload. Without it, memory only. */
  demoStorage?: Pick<Storage, 'getItem' | 'setItem'>
): UmServices {
  if (env.mock) {
    return {
      env,
      mock: true,
      adminGroupId: MOCK_ADMIN_GROUP_ID,
      adminUserIds: [],
      directory: new MockDirectoryGateway(readMockPersona(search)),
      fabric: new MockFabricGateway(),
      store: demoStorage ? createTabMockStore(demoStorage) : createMockStore(),
      writesInBuild: true,
      loadWriter: async () => new MockMemberWriter(),
      loadSender: async () => new MockNoticeSender(),
      loadBindingWriter: async () => new MockBindingWriter(),
      loadGroupCreator: async () => new MockGroupCreator(),
    };
  }

  return {
    env,
    mock: false,
    adminGroupId: env.adminGroupId,
    adminUserIds: env.adminUserIds,
    directory: new GraphDirectoryGateway(),
    fabric: new OpFabricGateway(invokeFabric),
    store: new RayfinUmStore(),
    writesInBuild: import.meta.env.VITE_UM_WRITES === 'true',
    // Written out against the literal so a build without the flag drops the
    // import, and with it the only files that can send a write.
    loadWriter:
      import.meta.env.VITE_UM_WRITES === 'true'
        ? async () => new (await import('./graphMemberWriter')).GraphMemberWriter()
        : async () => null,
    loadSender:
      import.meta.env.VITE_UM_WRITES === 'true'
        ? async () => new (await import('./graphMemberWriter')).GraphNoticeSender()
        : async () => null,
    loadBindingWriter:
      import.meta.env.VITE_UM_WRITES === 'true'
        ? async () => new (await import('./graphMemberWriter')).FabricBindingWriter()
        : async () => null,
    loadGroupCreator:
      import.meta.env.VITE_UM_WRITES === 'true'
        ? async () => new (await import('./graphMemberWriter')).GraphGroupCreator()
        : async () => null,
  };
}

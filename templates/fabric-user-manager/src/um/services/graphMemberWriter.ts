/**
 * Member changes through Microsoft Graph with the acting person's own token.
 *
 * Imported only by a dynamic `import()` in `services.ts`, and only when the
 * build was made with `VITE_UM_WRITES=true`. A build without that flag does
 * not contain this file or `graphWrite.ts`.
 */
import type { NoticeSender } from './accessRequests';
import type { BindingWriter } from './bindingChanges';
import { writeRole, type RoleChange, type RoleWriteOutcome } from './fabricWrite';
import { getGraphToken, getPinnedObjectId } from './graphAuth';
import { createGroup, type CreateOutcome, type NewGroup } from './graphGroupCreate';
import { sendNotice, type MailOutcome, type Notice } from './graphMail';
import { writeMember, type WriteOutcome } from './graphWrite';
import type { GroupCreator } from './groupCreation';
import type { MemberWriter } from './memberChanges';

export class GraphMemberWriter implements MemberWriter {
  async write(action: 'add' | 'remove', groupId: string, userId: string, actorObjectId: string): Promise<WriteOutcome> {
    // The account whose token is about to write must be the person the app
    // shows and logs as acting. After a reconnect as someone else, it is not.
    if (getPinnedObjectId() !== actorObjectId.toLowerCase()) return { ok: false, code: 'actor-mismatch' };
    let token: string;
    try {
      // Silent: the permission was asked for by the click that started this.
      token = await getGraphToken('memberChange');
    } catch {
      return { ok: false, code: 'denied' };
    }
    if (getPinnedObjectId() !== actorObjectId.toLowerCase()) return { ok: false, code: 'actor-mismatch' };
    return writeMember(action, groupId, userId, token);
  }
}

/** The request notice, sent from the signed-in requester's own mailbox. */
export class GraphNoticeSender implements NoticeSender {
  async send(notice: Notice): Promise<MailOutcome> {
    let token: string;
    try {
      // Silent: asked for by the click that submitted the request.
      token = await getGraphToken('mail');
    } catch {
      return { ok: false, code: 'denied' };
    }
    return sendNotice(notice, token);
  }
}

/** Workspace role bindings through the Fabric API with the acting admin's own token. */
export class FabricBindingWriter implements BindingWriter {
  async write(change: RoleChange, actorObjectId: string): Promise<RoleWriteOutcome> {
    if (getPinnedObjectId() !== actorObjectId.toLowerCase()) return { ok: false, code: 'actor-mismatch' };
    let token: string;
    try {
      // Silent: asked for by the click that started this change.
      token = await getGraphToken('fabricWrite');
    } catch {
      return { ok: false, code: 'denied' };
    }
    if (getPinnedObjectId() !== actorObjectId.toLowerCase()) return { ok: false, code: 'actor-mismatch' };
    return writeRole(change, token);
  }
}

/** A new security group through Graph with the acting admin's own token. */
export class GraphGroupCreator implements GroupCreator {
  async create(group: NewGroup, actorObjectId: string): Promise<CreateOutcome> {
    if (getPinnedObjectId() !== actorObjectId.toLowerCase()) return { ok: false, code: 'actor-mismatch' };
    let token: string;
    try {
      // Silent: asked for by the click that started this.
      token = await getGraphToken('groupCreate');
    } catch {
      return { ok: false, code: 'denied' };
    }
    if (getPinnedObjectId() !== actorObjectId.toLowerCase()) return { ok: false, code: 'actor-mismatch' };
    return createGroup(group, token);
  }
}

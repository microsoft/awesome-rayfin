// @vitest-environment node
import { describe, expect, it, vi } from 'vitest';

import { FABRIC_API_ORIGIN, FABRIC_OP_LIMITS, parseRequest, pathFor, runFabricOp } from '@/um/services/fabricOps';

const WS = '11111111-2222-4333-8444-' + '555555555555';
const TOKEN = 'header.payload.signature';
const g = (n: number) => `aaaaaaaa-0000-4000-8000-${String(n).padStart(12, '0')}`;

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
}

/**
 * The backend function is the only route to the Fabric API. Its whole safety
 * argument is "a closed list of read operations, every URL built server side".
 */
describe('fabric operations: closed request list', () => {
  it('accepts exactly the three read operations', () => {
    expect(parseRequest({ op: 'listWorkspaces' })).toEqual({ op: 'listWorkspaces' });
    expect(parseRequest({ op: 'listRoleAssignments', workspaceId: WS.toUpperCase() })).toEqual({ op: 'listRoleAssignments', workspaceId: WS });
    expect(parseRequest({ op: 'listItems', workspaceId: WS, itemType: 'OrgApp' })).toEqual({ op: 'listItems', workspaceId: WS, itemType: 'OrgApp' });
  });

  it.each([
    [{ op: 'addRoleAssignment', workspaceId: WS }],
    [{ op: 'listWorkspaces', path: '/v1/admin/workspaces' }],
    [{ op: 'listRoleAssignments', workspaceId: `${WS}/../admin` }],
    [{ op: 'listRoleAssignments', workspaceId: '00000000-0000-0000-0000-000000000000' }],
    [{ op: 'listItems', workspaceId: WS, itemType: 'Lakehouse' }],
    [{ op: 'listItems', workspaceId: WS, itemType: 'OrgApp', method: 'DELETE' }],
    [{ op: 'listRoleAssignments' }],
    ['listWorkspaces'],
    [null],
  ])('refuses %j before any network call', async (request) => {
    expect(parseRequest(request)).toBeNull();
    const fetcher = vi.fn();
    expect(await runFabricOp(TOKEN, request, fetcher as never)).toEqual({ ok: false, code: 'BAD_REQUEST' });
    expect(fetcher).not.toHaveBeenCalled();
  });

  it('builds every path itself, on the fixed origin', () => {
    expect(pathFor({ op: 'listWorkspaces' })).toBe('/v1/workspaces');
    expect(pathFor({ op: 'listRoleAssignments', workspaceId: WS })).toBe(`/v1/workspaces/${WS}/roleAssignments`);
    expect(pathFor({ op: 'listItems', workspaceId: WS, itemType: 'SemanticModel' })).toBe(`/v1/workspaces/${WS}/items?type=SemanticModel`);
  });
});

describe('fabric operations: execution', () => {
  it('uses GET, never follows redirects and forwards the token only as a header', async () => {
    const fetcher = vi.fn(async () => json({ value: [] }));
    const result = await runFabricOp(TOKEN, { op: 'listWorkspaces' }, fetcher as never);
    expect(result.ok).toBe(true);
    const [url, init] = fetcher.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe(`${FABRIC_API_ORIGIN}/v1/workspaces`);
    expect(init.method).toBe('GET');
    expect(init.redirect).toBe('manual');
    expect(init.body).toBeUndefined();
    expect((init.headers as Record<string, string>).Authorization).toBe(`Bearer ${TOKEN}`);
    expect(JSON.stringify(result)).not.toContain(TOKEN);
  });

  it('refuses without a usable token', async () => {
    const fetcher = vi.fn();
    for (const token of [undefined, '', 'a b', 'line\nbreak']) {
      expect(await runFabricOp(token, { op: 'listWorkspaces' }, fetcher as never)).toEqual({ ok: false, code: 'AUTH_UNAVAILABLE' });
    }
    expect(fetcher).not.toHaveBeenCalled();
  });

  it('pages by continuation token on the same endpoint and projects role assignments', async () => {
    const fetcher = vi
      .fn()
      .mockResolvedValueOnce(
        json({
          value: [{ id: g(1), principal: { id: g(10), type: 'Group', displayName: 'FAB-Sales-Viewer', extra: 'ignored' }, role: 'Viewer' }],
          continuationToken: 'next page',
          continuationUri: 'https://evil.example/steal',
        })
      )
      .mockResolvedValueOnce(json({ value: [{ id: g(2), principal: { id: g(11), type: 'User' }, role: 'Admin' }] }));

    const result = await runFabricOp(TOKEN, { op: 'listRoleAssignments', workspaceId: WS }, fetcher as never);
    expect(result).toMatchObject({
      ok: true,
      value: [
        { id: g(1), principalId: g(10), principalType: 'Group', principalName: 'FAB-Sales-Viewer', role: 'Viewer' },
        { id: g(2), principalId: g(11), principalType: 'User', principalName: '', role: 'Admin' },
      ],
    });
    expect(fetcher.mock.calls[1][0]).toBe(`${FABRIC_API_ORIGIN}/v1/workspaces/${WS}/roleAssignments?continuationToken=next%20page`);
  });

  it('maps a refusal to ACCESS_DENIED and never returns a partial list', async () => {
    const fetcher = vi
      .fn()
      .mockResolvedValueOnce(json({ value: [{ id: g(1), displayName: 'A', type: 'Workspace' }], continuationToken: 'p2' }))
      .mockResolvedValueOnce(json({}, 403));
    expect(await runFabricOp(TOKEN, { op: 'listWorkspaces' }, fetcher as never)).toEqual({ ok: false, code: 'ACCESS_DENIED' });
  });

  it('rejects malformed, duplicate, foreign and token-echoing responses', async () => {
    const run = (body: unknown) => runFabricOp(TOKEN, { op: 'listItems', workspaceId: WS, itemType: 'OrgApp' }, (async () => json(body)) as never);
    expect(await run({ value: 'nope' })).toEqual({ ok: false, code: 'INVALID_RESPONSE' });
    expect(await run({ value: [{ id: 'not-a-guid', displayName: 'x', type: 'OrgApp' }] })).toEqual({ ok: false, code: 'INVALID_RESPONSE' });
    expect(await run({ value: [{ id: g(1), displayName: 'x', type: 'OrgApp' }, { id: g(1), displayName: 'y', type: 'OrgApp' }] })).toEqual({ ok: false, code: 'INVALID_RESPONSE' });
    expect(await run({ value: [{ id: g(1), displayName: 'x', type: 'OrgApp', workspaceId: g(99) }] })).toEqual({ ok: false, code: 'INVALID_RESPONSE' });
    expect(await run({ value: [{ id: g(1), displayName: TOKEN, type: 'OrgApp' }] })).toEqual({ ok: false, code: 'INVALID_RESPONSE' });
    const html = async () => new Response('<html>', { status: 200, headers: { 'content-type': 'text/html' } });
    expect(await runFabricOp(TOKEN, { op: 'listWorkspaces' }, html as never)).toEqual({ ok: false, code: 'INVALID_RESPONSE' });
  });

  it('stops at the page bound instead of returning what it has', async () => {
    let n = 0;
    const endless = async () => json({ value: [{ id: g(++n), displayName: `W${n}`, type: 'Workspace' }], continuationToken: `c${n}` });
    expect(await runFabricOp(TOKEN, { op: 'listWorkspaces' }, endless as never)).toEqual({ ok: false, code: 'LIMIT_EXCEEDED' });
    expect(n).toBe(FABRIC_OP_LIMITS.pages);
  });

  it('stops at the byte bound and rejects control characters in names', async () => {
    const huge = 'x'.repeat(FABRIC_OP_LIMITS.bytes + 10);
    const big = async () => new Response(`{"value":[],"pad":"${huge}"}`, { status: 200, headers: { 'content-type': 'application/json' } });
    expect(await runFabricOp(TOKEN, { op: 'listWorkspaces' }, big as never)).toEqual({ ok: false, code: 'LIMIT_EXCEEDED' });
    const control = async () => json({ value: [{ id: g(1), displayName: 'bad\u0007name', type: 'Workspace' }] });
    expect(await runFabricOp(TOKEN, { op: 'listWorkspaces' }, control as never)).toEqual({ ok: false, code: 'INVALID_RESPONSE' });
  });

  it('turns a network failure into one sanitized code', async () => {
    const failing = async () => {
      throw new Error(`connect ECONNREFUSED ${TOKEN}`);
    };
    expect(await runFabricOp(TOKEN, { op: 'listWorkspaces' }, failing as never)).toEqual({ ok: false, code: 'READ_FAILED' });
  });
});

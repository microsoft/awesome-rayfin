// @vitest-environment node
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative, resolve, sep } from 'node:path';

import ExcelJS from 'exceljs';
import ts from 'typescript';
import { describe, expect, it, vi } from 'vitest';

import { buildDiscovery } from '@/um/domain/discovery';
import { SHEET_COLUMNS, planImport, toSheetRows, type SheetRow } from '@/um/domain/sheet';
import { notReadable, ok, type Binding, type GraphIdentity, type GroupFacts } from '@/um/domain/types';
import { resolveAppAdminIds, runDiscovery } from '@/um/services/discoveryRunner';
import { GraphDirectoryGateway } from '@/um/services/gateways';
import { GRAPH_BASE, GRAPH_LIMITS, graphGetAll } from '@/um/services/graphRead';
import { MOCK_ADMIN_GROUP_ID, MockDirectoryGateway, MockFabricGateway, createMockStore } from '@/um/services/mock';
import { RefusedError, activateGroup, applyImport, rollbackImport, saveFields, syncReadBindings } from '@/um/services/operations';
import { readWorkbook, writeWorkbook } from '@/um/services/sheetCodec';
import { AlreadyActivatedError, MemoryUmStore, PAGE_LIMITS, VersionConflictError, readAllPages } from '@/um/services/store';

const g = (n: number) => `cccccccc-0000-4000-8000-${String(n).padStart(12, '0')}`;
const actor: GraphIdentity = { objectId: g(1), userPrincipalName: 'admin@x.example', displayName: 'Admin' };
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
const facts = (id: string, name: string): GroupFacts => ({ id, displayName: name, securityEnabled: true, mailEnabled: false, groupTypes: [], isAssignableToRole: null, onPremisesSyncEnabled: null, membershipRule: null });

describe('Graph reads', () => {
  it('follows next links to the end, on the Graph origin only', async () => {
    const fetcher = vi
      .fn()
      .mockResolvedValueOnce(json({ value: [{ id: g(1) }], '@odata.nextLink': `${GRAPH_BASE}/groups/x/members?$skiptoken=abc` }))
      .mockResolvedValueOnce(json({ value: [{ id: g(2) }] }));
    const result = await graphGetAll('/groups/x/members', 't', fetcher);
    expect(result).toEqual(ok([{ id: g(1) }, { id: g(2) }]));
    expect(fetcher.mock.calls.every(([, init]) => (init as RequestInit).method === 'GET')).toBe(true);

    const foreign = vi.fn().mockResolvedValueOnce(json({ value: [{ id: g(1) }], '@odata.nextLink': 'https://graph.microsoft.com.evil.example/v1.0/x' }));
    expect((await graphGetAll('/x', 't', foreign)).state).toBe('not-readable');
    expect(foreign).toHaveBeenCalledTimes(1);
  });

  it('reports a list that hits the bound as not readable, never truncated', async () => {
    let n = 0;
    const endless = vi.fn(async () => json({ value: [{ id: g(++n) }], '@odata.nextLink': `${GRAPH_BASE}/x?p=${n}` }));
    expect(await graphGetAll('/x', 't', endless)).toEqual(notReadable('limit'));
    expect(endless).toHaveBeenCalledTimes(GRAPH_LIMITS.pages);
  });

  it('maps 403 to access denied and other failures to failed', async () => {
    expect(await graphGetAll('/x', 't', async () => json({}, 403))).toEqual(notReadable('access-denied', '403'));
    expect(await graphGetAll('/x', 't', async () => json({}, 500))).toEqual(notReadable('failed', '500'));
  });
});

describe('directory gateway', () => {
  it('says "not readable" when a token needs a click, instead of returning nothing', async () => {
    const gateway = new GraphDirectoryGateway(async () => {
      throw new Error('interaction required');
    }, vi.fn());
    expect((await gateway.listMembers(g(5))).state).toBe('not-readable');
    expect((await gateway.myOwnedGroupIds()).state).toBe('not-readable');
    await expect(gateway.me()).rejects.toThrow();
  });

  it('never sends anything but an object id or a user principal name to /users', async () => {
    const fetcher = vi.fn(async (_url: string, _init: RequestInit) => json({ id: g(9), displayName: 'Anna', userPrincipalName: 'anna@x.example' }));
    const gateway = new GraphDirectoryGateway(async () => 't', fetcher);
    expect(await gateway.findUser("x' or 1 eq 1")).toEqual(ok(null));
    expect(await gateway.findUser('../groups')).toEqual(ok(null));
    expect(fetcher).not.toHaveBeenCalled();
    const found = await gateway.findUser(' anna@x.example ');
    expect(found.state === 'ok' && found.value?.type).toBe('user');
    expect(fetcher.mock.calls[0][0]).toContain('/users/anna%40x.example?');
  });

  it('requests base scopes for own data and directory scopes for groups', async () => {
    const tokens = vi.fn(async (_scopeSet: string) => 't');
    const gateway = new GraphDirectoryGateway(tokens, async () => json({ value: [] }));
    await gateway.myGroupIds();
    await gateway.listOwners(g(5));
    expect(tokens.mock.calls.map((c) => c[0])).toEqual(['base', 'directory']);
  });
});

describe('Excel codec', () => {
  it('writes every cell as text, so a name cannot act as a formula', async () => {
    const buffer = await writeWorkbook({ sheetName: 'Members', columns: ['Member', 'Note'], rows: [{ Member: '=HYPERLINK("http://evil.example","x")', Note: '+1+1' }] });
    // A worker can transfer only a real ArrayBuffer, not a Buffer or typed array.
    expect(Object.prototype.toString.call(buffer)).toBe('[object ArrayBuffer]');
    const workbook = new ExcelJS.Workbook();
    await workbook.xlsx.load(buffer);
    const cell = workbook.worksheets[0].getCell('A2');
    expect(cell.type).toBe(ExcelJS.ValueType.String);
    expect(cell.value).toBe('=HYPERLINK("http://evil.example","x")');
    expect(workbook.worksheets[0].getCell('B2').type).toBe(ExcelJS.ValueType.String);
  });

  it('round-trips the group sheet', async () => {
    const store = createMockStore();
    const { groups, bindings } = await store.load();
    const rows = toSheetRows(groups, bindings);
    const table = await readWorkbook(await writeWorkbook({ sheetName: 'Groups', columns: SHEET_COLUMNS, rows, choices: { Requestable: ['Yes', 'No'] }, spareRows: 5 }));
    expect(table.header).toEqual([...SHEET_COLUMNS]);
    expect(table.rows).toEqual(rows);
    const plan = planImport(table.header, table.rows as SheetRow[], { groups, bindings, highRoleGroupIds: new Set() });
    expect(plan).toMatchObject({ ok: true, changes: [] });
  });

  it('reads a formula cell as its shown value and rejects what is not a workbook', async () => {
    const workbook = new ExcelJS.Workbook();
    const sheet = workbook.addWorksheet('Groups');
    sheet.addRow(['Group ID', 'Description']);
    sheet.addRow([g(7), { formula: 'CONCATENATE("a","b")', result: 'ab' }]);
    const table = await readWorkbook((await workbook.xlsx.writeBuffer()) as ArrayBuffer);
    expect(table.rows).toEqual([{ 'Group ID': g(7), Description: 'ab' }]);
    await expect(readWorkbook(new TextEncoder().encode('not a zip').buffer as ArrayBuffer)).rejects.toThrow('not-a-workbook');
    await expect(readWorkbook(new ArrayBuffer(2_000_001))).rejects.toThrow('too-large');

    const wide = new ExcelJS.Workbook();
    wide.addWorksheet('Groups').addRow(Array.from({ length: 41 }, (_, i) => `c${i}`));
    await expect(readWorkbook((await wide.xlsx.writeBuffer()) as ArrayBuffer)).rejects.toThrow('too-large');
    const long = new ExcelJS.Workbook();
    const sheetLong = long.addWorksheet('Groups');
    for (let i = 0; i < 5002; i++) sheetLong.addRow(['x']);
    await expect(readWorkbook((await long.xlsx.writeBuffer()) as ArrayBuffer)).rejects.toThrow('too-large');
  });
});

describe('app records', () => {
  it('activates an eligible group, stores its read bindings and logs the acting Graph identity', async () => {
    const store = new MemoryUmStore();
    const binding: Binding = { groupId: g(11), kind: 'Workspace', scopeId: g(100), scopeName: 'Sales', label: 'Viewer', provenance: 'read' };
    const created = await activateGroup({ store, actor }, { groupId: g(11), requestable: true, description: 'd', maxDays: 0 }, { facts: ok(facts(g(11), 'FAB-Sales-Viewer')), managed: [], readBindings: [binding] });
    expect(created.nameSnapshot).toBe('FAB-Sales-Viewer');
    expect((await store.load()).bindings).toEqual([binding]);
    expect((await store.listAudit())[0]).toMatchObject({ action: 'activate', outcome: 'ok', actorOid: g(1), groupId: g(11) });
  });

  it('refuses and logs the refusal, without storing anything', async () => {
    const store = new MemoryUmStore();
    const attempt = activateGroup({ store, actor }, { groupId: g(11), requestable: false, description: '', maxDays: 0 }, { facts: notReadable('access-denied'), managed: [], readBindings: [] });
    await expect(attempt).rejects.toBeInstanceOf(RefusedError);
    expect((await store.load()).groups).toEqual([]);
    expect((await store.listAudit())[0]).toMatchObject({ action: 'activate', outcome: 'refused' });
  });

  it('detects a row that changed underneath an edit', async () => {
    const store = createMockStore();
    const [first] = (await store.load()).groups;
    await saveFields({ store, actor }, first, { requestable: false, description: 'x', maxDays: 0, active: true }, false);
    await expect(saveFields({ store, actor }, first, { requestable: true, description: 'y', maxDays: 0, active: true }, false)).rejects.toBeInstanceOf(VersionConflictError);
  });

  it('applies an import and restores the previous state on undo', async () => {
    const store = createMockStore();
    const before = await store.load();
    const target = before.groups.find((x) => x.nameSnapshot === 'APP-Sales-Management')!;
    const rows = toSheetRows(before.groups, before.bindings).map((r) =>
      r['Group ID'] === target.groupId ? { ...r, Requestable: 'No', Description: 'changed', Label: 'Leadership' } : r
    );
    const plan = planImport([...SHEET_COLUMNS], rows, { groups: before.groups, bindings: before.bindings, highRoleGroupIds: new Set() });
    expect(plan.changes).toHaveLength(1);

    const { importId, applied } = await applyImport({ store, actor }, plan, before.groups, before.bindings);
    expect(applied).toBe(1);
    const after = await store.load();
    const changed = after.groups.find((x) => x.groupId === target.groupId)!;
    expect(changed).toMatchObject({ requestable: false, description: 'changed', importId });
    expect(after.bindings.filter((b) => b.groupId === target.groupId).map((b) => b.label)).toEqual(['Leadership']);

    expect(await rollbackImport({ store, actor }, importId, after.groups, new Set())).toEqual({ restored: 1, skipped: 0 });
    const restored = await store.load();
    expect(restored.groups.find((x) => x.groupId === target.groupId)).toMatchObject({ requestable: true, description: target.description, importId: undefined });
    expect(restored.bindings.filter((b) => b.groupId === target.groupId).map((b) => b.label)).toEqual(['Management']);
  });

  it('does not undo an import over a later decision', async () => {
    const store = createMockStore();
    const before = await store.load();
    const target = before.groups.find((x) => x.nameSnapshot === 'APP-Sales-Management')!;
    const rows = toSheetRows(before.groups, before.bindings).map((r) => (r['Group ID'] === target.groupId ? { ...r, Description: 'imported' } : r));
    const plan = planImport([...SHEET_COLUMNS], rows, { groups: before.groups, bindings: before.bindings, highRoleGroupIds: new Set() });
    const { importId } = await applyImport({ store, actor }, plan, before.groups, before.bindings);

    // An admin deactivates the group by hand after the import.
    const imported = (await store.load()).groups.find((x) => x.groupId === target.groupId)!;
    await saveFields({ store, actor }, imported, { requestable: false, description: 'imported', maxDays: 0, active: false }, false);

    const afterEdit = (await store.load()).groups;
    expect(await rollbackImport({ store, actor }, importId, afterEdit, new Set())).toEqual({ restored: 0, skipped: 0 });
    expect((await store.load()).groups.find((x) => x.groupId === target.groupId)).toMatchObject({ active: false, requestable: false });
  });

  it('skips an undo when the row moved on or the old state is no longer allowed', async () => {
    const store = createMockStore();
    const before = await store.load();
    const target = before.groups.find((x) => x.nameSnapshot === 'FAB-Sales-Viewer')!;
    const rows = toSheetRows(before.groups, before.bindings).map((r) => (r['Group ID'] === target.groupId ? { ...r, Requestable: 'No' } : r));
    const plan = planImport([...SHEET_COLUMNS], rows, { groups: before.groups, bindings: before.bindings, highRoleGroupIds: new Set() });
    const { importId } = await applyImport({ store, actor }, plan, before.groups, before.bindings);
    const imported = (await store.load()).groups;

    // The group meanwhile carries the Member role: becoming requestable again is refused.
    expect(await rollbackImport({ store, actor }, importId, imported, new Set([target.groupId]))).toEqual({ restored: 0, skipped: 1 });
    expect((await store.listAudit())[0]).toMatchObject({ action: 'rollback', outcome: 'refused' });

    // A stale copy of the row (older version) is refused as well.
    const stale = imported.map((x) => (x.groupId === target.groupId ? { ...x, version: x.version + 5 } : x));
    expect(await rollbackImport({ store, actor }, importId, stale, new Set())).toEqual({ restored: 0, skipped: 1 });
    expect((await store.load()).groups.find((x) => x.groupId === target.groupId)?.requestable).toBe(false);
  });

  it('refuses a second activation in the store and facts that belong to another group', async () => {
    const store = new MemoryUmStore();
    const input = { groupId: g(11), requestable: false, description: '', maxDays: 0 };
    await activateGroup({ store, actor }, input, { facts: ok(facts(g(11), 'A')), managed: [], readBindings: [] });
    // The page still believes nothing is activated: the store says otherwise.
    await expect(activateGroup({ store, actor }, input, { facts: ok(facts(g(11), 'A')), managed: [], readBindings: [] })).rejects.toBeInstanceOf(AlreadyActivatedError);
    const wrong = activateGroup({ store, actor }, { ...input, groupId: g(12) }, { facts: ok(facts(g(11), 'A')), managed: [], readBindings: [] });
    await expect(wrong).rejects.toBeInstanceOf(RefusedError);
    expect((await store.load()).groups).toHaveLength(1);
  });

  it('records a stated purpose as attested and treats a stated Member role as high', async () => {
    const store = new MemoryUmStore();
    const stated: Binding = { groupId: 'ignored', kind: 'Workspace', scopeName: 'Finance', label: 'Member', provenance: 'read' };
    const input = { groupId: g(11), requestable: true, description: '', maxDays: 0 };
    const context = { facts: ok(facts(g(11), 'A')), managed: [], readBindings: [], attestedBindings: [stated] };
    // Requestable plus a stated Member role is refused.
    await expect(activateGroup({ store, actor }, input, context)).rejects.toBeInstanceOf(RefusedError);
    await activateGroup({ store, actor }, { ...input, requestable: false }, context);
    // Stored for this group and as attested, whatever the caller put in.
    expect((await store.load()).bindings).toEqual([{ ...stated, groupId: g(11), provenance: 'attested' }]);
  });

  it('names app admins from the build and the group, and does not shorten the list when the group is unreadable', async () => {
    const directory = new MockDirectoryGateway('admin');
    expect(await resolveAppAdminIds(directory, {})).toEqual(notReadable('no-route'));
    expect(await resolveAppAdminIds(directory, { adminUserIds: [g(5)] })).toEqual(ok([g(5)]));
    const both = await resolveAppAdminIds(directory, { adminUserIds: [g(5)], adminGroupId: MOCK_ADMIN_GROUP_ID });
    expect(both.state === 'ok' && both.value).toHaveLength(2);
    expect((await resolveAppAdminIds(directory, { adminUserIds: [g(5)], adminGroupId: g(404) })).state).toBe('not-readable');
  });

  it('reads a table to its end and refuses one that does not end', async () => {
    const rows = Array.from({ length: 450 }, (_, i) => ({ id: String(i) }));
    const pager = vi.fn(async (cursor: string | undefined) => {
      const start = cursor ? Number(cursor) : 0;
      const items = rows.slice(start, start + PAGE_LIMITS.size);
      const end = start + items.length;
      return { items, endCursor: String(end), hasNextPage: end < rows.length };
    });
    expect(await readAllPages(pager)).toHaveLength(450);
    expect(pager).toHaveBeenCalledTimes(3);
    await expect(readAllPages(async () => ({ items: [{ id: 'x' }], endCursor: 'same', hasNextPage: true }))).rejects.toThrow('paging-failed');
    let n = 0;
    await expect(readAllPages(async () => ({ items: [], endCursor: String(++n), hasNextPage: true }))).rejects.toThrow('paging-limit');
  });

  it('treats the same attested line twice as one binding', async () => {
    const store = createMockStore();
    const { groups, bindings } = await store.load();
    const target = groups.find((x) => x.nameSnapshot === 'RLS-Sales-DACH')!;
    const base = toSheetRows(groups, bindings).filter((r) => r['Group ID'] === target.groupId)[0];
    const extra = { ...base, 'Scope name': 'Sales Model', Label: 'Region North' };
    const plan = planImport([...SHEET_COLUMNS], [base, extra, extra], { groups, bindings, highRoleGroupIds: new Set() });
    expect(plan.changes[0].attestedAdded).toHaveLength(1);
  });

  it('keeps a stored binding when its workspace could not be read this time', async () => {
    const store = createMockStore();
    const { groups, bindings } = await store.load();
    const viewer = groups.find((x) => x.nameSnapshot === 'FAB-Sales-Viewer')!;
    const stored = bindings.filter((b) => b.groupId === viewer.groupId);
    expect(stored).toHaveLength(2);
    // This discovery reads only the first workspace, and the group is no longer bound there.
    const discovery = buildDiscovery({
      observedAt: 'now',
      workspaces: ok([]),
      perWorkspace: [
        { workspace: { id: stored[0].scopeId!, displayName: 'Sales Reporting' }, roleAssignments: ok([]), orgApps: ok([]), audiences: ok([]), models: ok([]) },
        { workspace: { id: stored[1].scopeId!, displayName: 'Finance Reporting' }, roleAssignments: notReadable('access-denied'), orgApps: ok([]), audiences: ok([]), models: ok([]) },
      ],
      groups: {},
      appAdminIds: ok([]),
    });
    await syncReadBindings({ store, actor }, groups, bindings, discovery);
    const next = (await store.load()).bindings.filter((b) => b.groupId === viewer.groupId);
    expect(next.map((b) => b.scopeName)).toEqual(['Finance Reporting']);
  });
});

describe('discovery against the demo fixtures', () => {
  it('finds bindings, findings and the unreadable workspace', async () => {
    const result = await runDiscovery(new MockFabricGateway(), new MockDirectoryGateway('admin'), { adminGroupId: MOCK_ADMIN_GROUP_ID });
    expect(result.coverage).toMatchObject({ workspaces: 3, rolesReadable: 2, rolesNotReadable: 1 });
    const types = result.findings.map((f) => f.type);
    // The Admin group is owned by an app admin only, so it is not a finding.
    expect(result.findings.filter((f) => f.type === 'high-role-owner').map((f) => f.groupName)).toEqual(['FAB-Finance-Member']);
    expect(types).toEqual(expect.arrayContaining(['direct-user', 'service-principal', 'ineligible-group', 'multi-bound', 'high-role-owner']));
  });
});

/**
 * Everything is read-only except one file. This scans the syntax tree of
 * every file of the feature, not its text. It proves what it checks and no more:
 *
 * - outside `graphWrite.ts`, `graphMail.ts`, `fabricWrite.ts` and `graphGroupCreate.ts`, an HTTP `method` is only ever the literal 'GET'
 *   and no string names a Graph reference link,
 * - each of those four files names only the verbs it is meant to send
 *   (members: POST and DELETE, mail: POST, role assignments: POST, PATCH, DELETE, new group: POST),
 * - those four files are imported only by `graphMemberWriter.ts`, which is
 *   imported only by a dynamic import in `services.ts`,
 * - network primitives appear only in the eight files that are meant to call out,
 * - no file imports the write paths of the Governance Hub this app grew out of
 *   (its proxy, token cache, approval engine, gates), should they ever be copied in,
 * - no code touches local storage or a Graph `$ref` link.
 *
 * It cannot prove the absence of a write built by indirection at runtime; the
 * gateway and function tests above cover the calls that do exist.
 */
describe('read-only and separation boundary', () => {
  const root = resolve(import.meta.dirname, '../..');
  const walk = (dir: string): string[] =>
    readdirSync(dir).flatMap((name) => {
      const full = join(dir, name);
      return statSync(full).isDirectory() ? walk(full) : [full];
    });
  const files = walk(join(root, 'src/um')).filter((f) => /\.tsx?$/.test(f));

  const WRITE_FILE = 'src/um/services/graphWrite.ts'.replace(/\//g, sep);
  const WRITER_FILE = 'src/um/services/graphMemberWriter.ts'.replace(/\//g, sep);
  const SERVICES_FILE = 'src/um/services/services.ts'.replace(/\//g, sep);
  const MAIL_FILE = 'src/um/services/graphMail.ts'.replace(/\//g, sep);
  /** The three files that may send something other than a read: a membership write, a notice, a role assignment. */
  const ROLE_FILE = 'src/um/services/fabricWrite.ts'.replace(/\//g, sep);
  const GROUP_FILE = 'src/um/services/graphGroupCreate.ts'.replace(/\//g, sep);
  const SENDS = new Set([WRITE_FILE, MAIL_FILE, ROLE_FILE, GROUP_FILE]);
  /** What each of them may send. A verb outside its set, anywhere in the file, fails. */
  const VERBS_OF = new Map<string, ReadonlySet<string>>([
    [WRITE_FILE, new Set(['POST', 'DELETE'])],
    [MAIL_FILE, new Set(['POST'])],
    [ROLE_FILE, new Set(['POST', 'PATCH', 'DELETE'])],
    [GROUP_FILE, new Set(['POST'])],
  ]);
  const HTTP_VERB = /^(?:GET|POST|PUT|PATCH|DELETE|HEAD|OPTIONS)$/i;
  const MAY_CALL_OUT = new Set([WRITE_FILE, MAIL_FILE, ROLE_FILE, GROUP_FILE, 'src/um/services/graphRead.ts', 'src/um/services/gateways.ts', 'src/um/services/services.ts', 'src/um/services/fabricOps.ts'].map((p) => p.replace(/\//g, sep)));
  const NETWORK = new Set(['fetch', 'XMLHttpRequest', 'sendBeacon', 'WebSocket', 'EventSource']);
  const FORBIDDEN_IMPORT = /(?:^|\/)(?:udfClient|fabricAuth|approvals|writes|GovernanceContext|writeGates|tasks|capabilities|operationRegistry|apiContracts)(?:\.[jt]sx?)?$/;

  it('covers the feature folder', () => {
    expect(files.length).toBeGreaterThan(20);
  });

  it.each(files.map((f) => relative(root, f)))('%s has no write verb, stray network call or Hub write-path import', (rel) => {
    const text = readFileSync(join(root, rel), 'utf8');
    const source = ts.createSourceFile(rel, text, ts.ScriptTarget.ES2022, true, rel.endsWith('x') ? ts.ScriptKind.TSX : ts.ScriptKind.TS);
    const problems: string[] = [];

    const visit = (node: ts.Node): void => {
      // `method: <anything but 'GET'>`, including shorthand `{ method }`.
      if (!SENDS.has(rel) && ts.isPropertyAssignment(node) && node.name.getText(source).replace(/['"`]/g, '') === 'method') {
        const init = node.initializer;
        if (!((ts.isStringLiteral(init) || ts.isNoSubstitutionTemplateLiteral(init)) && init.text === 'GET')) problems.push(`method is not the literal GET: ${node.getText(source)}`);
      }
      if (!SENDS.has(rel) && ts.isShorthandPropertyAssignment(node) && node.name.text === 'method') problems.push('shorthand method property');
      // The file that creates groups may name the groups collection and a user reference, nothing else.
      if (rel === GROUP_FILE && (ts.isStringLiteralLike(node) || ts.isTemplateHead(node) || ts.isTemplateMiddle(node) || ts.isTemplateTail(node))) {
        const inImport = ts.isImportDeclaration(node.parent) || ts.isExportDeclaration(node.parent);
        if (!inImport && node.text.includes('/') && !['/groups', '/users/', 'application/json'].includes(node.text)) problems.push(`address part ${node.text}`);
      }
      const mayName = VERBS_OF.get(rel);
      if (mayName && ts.isStringLiteralLike(node) && HTTP_VERB.test(node.text) && !mayName.has(node.text)) problems.push(`verb ${node.text} is not one this file may send`);

      if (ts.isIdentifier(node) && NETWORK.has(node.text) && !MAY_CALL_OUT.has(rel)) {
        // A type position (`typeof fetch`) is not a call; a value position is.
        if (!ts.isTypeQueryNode(node.parent)) problems.push(`network primitive ${node.text}`);
      }
      if (ts.isIdentifier(node) && node.text === 'localStorage') problems.push('localStorage');

      const specifier =
        (ts.isImportDeclaration(node) || ts.isExportDeclaration(node)) && node.moduleSpecifier && ts.isStringLiteralLike(node.moduleSpecifier)
          ? node.moduleSpecifier.text
          : ts.isCallExpression(node) && (node.expression.kind === ts.SyntaxKind.ImportKeyword || node.expression.getText(source) === 'require') && node.arguments[0] && ts.isStringLiteralLike(node.arguments[0])
            ? (node.arguments[0] as ts.StringLiteralLike).text
            : null;
      if (specifier && FORBIDDEN_IMPORT.test(specifier)) problems.push(`import of ${specifier}`);
      // The write path has exactly one way in.
      const typeOnly = ts.isImportDeclaration(node) && !!node.importClause?.isTypeOnly;
      if (specifier && /(?:^|\/)(?:graphWrite|graphMail|fabricWrite|graphGroupCreate)$/.test(specifier) && !typeOnly && rel !== WRITER_FILE) problems.push('value import of a sending file');
      if (specifier && /(?:^|\/)graphMemberWriter$/.test(specifier) && !(rel === SERVICES_FILE && ts.isCallExpression(node))) {
        problems.push('the member writer is loaded outside the one dynamic import');
      }
      if (ts.isCallExpression(node) && node.expression.kind === ts.SyntaxKind.ImportKeyword && node.arguments[0] && !ts.isStringLiteralLike(node.arguments[0])) {
        problems.push('dynamic import with a computed path');
      }

      if (rel !== WRITE_FILE && (ts.isStringLiteralLike(node) || ts.isTemplateHead(node) || ts.isTemplateMiddle(node) || ts.isTemplateTail(node)) && /\$ref|%24ref/i.test(node.text)) {
        problems.push('reference link in a string');
      }
      ts.forEachChild(node, visit);
    };
    visit(source);
    expect(problems).toEqual([]);
  });

  it('would catch the patterns it claims to catch', () => {
    const sample = `
      import { fabricProxy } from "../../services/udfClient";
      const verb = 'POST';
      fetch(url, { method: verb });
      fetch(url, { method });
      navigator.sendBeacon(url);
      const link = \`/groups/\${id}/members/$ref\`;
      const lazy = import(path);
    `;
    const source = ts.createSourceFile('sample.ts', sample, ts.ScriptTarget.ES2022, true);
    const found = new Set<string>();
    const visit = (node: ts.Node): void => {
      if (ts.isPropertyAssignment(node) && node.name.getText(source) === 'method' && !ts.isStringLiteral(node.initializer)) found.add('method');
      if (ts.isShorthandPropertyAssignment(node) && node.name.text === 'method') found.add('shorthand');
      if (ts.isIdentifier(node) && NETWORK.has(node.text)) found.add(node.text);
      if (ts.isImportDeclaration(node) && ts.isStringLiteralLike(node.moduleSpecifier) && FORBIDDEN_IMPORT.test(node.moduleSpecifier.text)) found.add('import');
      if (ts.isCallExpression(node) && node.expression.kind === ts.SyntaxKind.ImportKeyword && !ts.isStringLiteralLike(node.arguments[0])) found.add('computed-import');
      if (ts.isTemplateTail(node) && /\$ref/.test(node.text)) found.add('ref');
      ts.forEachChild(node, visit);
    };
    visit(source);
    expect([...found].sort()).toEqual(['computed-import', 'fetch', 'import', 'method', 'ref', 'sendBeacon', 'shorthand']);
  });
});

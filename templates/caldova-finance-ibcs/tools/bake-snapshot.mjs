// Bake the statements the app ships with from the semantic model.
//
//   node tools/bake-snapshot.mjs            write public/data/statements.json from the model
//   node tools/bake-snapshot.mjs --check    fail when the model's answers differ from the shipped file
//
// Target: FABRIC_WORKSPACE_ID, FABRIC_MODEL_ID, FABRIC_TENANT_ID, or tools/fabric/target.json.
// Token: FABRIC_PBI_TOKEN (CI, e.g. from azure/login), else `az account get-access-token --tenant`.
// The drivers of the forecast engine come from fabric/drivers.json (written by tools/generate_statements.py,
// or by you for your own model). Nothing tenant-specific goes into the snapshot: no ids, no hosts.
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const OUT = resolve(ROOT, 'public/data/statements.json');
const check = process.argv.includes('--check');

const target = existsSync(resolve(ROOT, 'tools/fabric/target.json')) ? JSON.parse(readFileSync(resolve(ROOT, 'tools/fabric/target.json'), 'utf-8')) : {};
const ws = process.env.FABRIC_WORKSPACE_ID ?? target.workspaceId;
const model = process.env.FABRIC_MODEL_ID ?? target.modelId;
const tenant = process.env.FABRIC_TENANT_ID ?? target.tenantId;
if (!ws || !model) throw new Error('no workspace or model id: set FABRIC_WORKSPACE_ID and FABRIC_MODEL_ID, or fill tools/fabric/target.json');

function token() {
  if (process.env.FABRIC_PBI_TOKEN) return process.env.FABRIC_PBI_TOKEN;
  const args = ['account', 'get-access-token', '--resource', 'https://analysis.windows.net/powerbi/api', '--query', 'accessToken', '-o', 'tsv'];
  if (tenant) args.push('--tenant', tenant);
  // az is a .cmd on Windows: run it through cmd.exe rather than with shell: true.
  const [cmd, pre] = process.platform === 'win32' ? [process.env.ComSpec ?? 'cmd.exe', ['/d', '/c', 'az']] : ['az', []];
  return execFileSync(cmd, [...pre, ...args], { encoding: 'utf-8' }).trim();
}

const bearer = token();
async function dax(query) {
  for (let attempt = 0; ; attempt++) {
    const res = await fetch(`https://api.powerbi.com/v1.0/myorg/groups/${ws}/datasets/${model}/executeQueries`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${bearer}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ queries: [{ query }], serializerSettings: { includeNulls: true } }),
    });
    if (res.ok) return (await res.json()).results[0].tables[0].rows;
    if ((res.status === 429 || res.status === 503) && attempt < 3) {
      await new Promise((r) => setTimeout(r, 5000 * (attempt + 1)));
      continue;
    }
    throw new Error(`DAX ${res.status}: ${(await res.text()).slice(0, 600)}`);
  }
}

// Column keys come back as 'Table'[Column] or [Name]; take the part in the last brackets.
const plain = (row) => Object.fromEntries(Object.entries(row).map(([k, v]) => [k.slice(k.lastIndexOf('[') + 1, -1), v]));

const accounts = (await dax(`EVALUATE 'Account' ORDER BY 'Account'[Sort]`)).map(plain).map((a) => ({
  id: a.AccountID,
  statement: a.Statement,
  parentId: a.ParentID ? a.ParentID : null,
  name: a.Name,
  rowType: a.RowType,
  sign: Number(a.Sign) < 0 ? -1 : 1,
  formula: a.Formula ?? '',
  goodUp: a.GoodDirection === 'up' ? true : a.GoodDirection === 'down' ? false : null,
  sort: Number(a.Sort),
}));
const months = (await dax(`EVALUATE 'Month' ORDER BY 'Month'[Month]`)).map(plain).map((m) => ({
  id: m.Month,
  year: Number(m.Year),
  monthNo: Number(m.MonthNo),
  label: m.MonthName,
  closed: m.Closed === true || m.Closed === 'True' || m.Closed === 'true',
}));
const rows = (
  await dax(`EVALUATE SELECTCOLUMNS ( 'Statement Value', "a", 'Statement Value'[AccountID], "m", 'Statement Value'[Month], "s", 'Statement Value'[Scenario], "v", 'Statement Value'[Amount] )`)
).map(plain);

const values = { AC: {}, PY: {}, PL: {}, FC: {} };
for (const r of rows) {
  if (!(r.s in values)) throw new Error(`unknown scenario ${r.s}`);
  (values[r.s][r.m] ??= {})[r.a] = Math.round(Number(r.v) * 100) / 100;
}
const cutoff = months.filter((m) => m.closed).at(-1)?.id;
if (!cutoff) throw new Error('no closed month in the model');

const drivers = JSON.parse(readFileSync(resolve(ROOT, 'fabric/drivers.json'), 'utf-8'));
if (drivers.cutoff !== cutoff) throw new Error(`drivers.json is for cut-off ${drivers.cutoff}, the model's last closed month is ${cutoff}`);
const snapshot = {
  meta: { company: drivers.company, currency: drivers.currency, cutoff, bakedAt: new Date().toISOString(), source: 'semantic model (baked)' },
  accounts,
  months,
  values,
  drivers,
};

const comparable = (s) => JSON.stringify({ ...s, meta: { ...s.meta, bakedAt: '' } });
if (check) {
  const shipped = JSON.parse(readFileSync(OUT, 'utf-8'));
  if (comparable(shipped) !== comparable({ ...snapshot, meta: { ...snapshot.meta, source: shipped.meta.source } })) {
    console.error('DRIFT: the model answers differently from public/data/statements.json. Re-bake before deploying.');
    process.exit(1);
  }
  console.log(`no drift: ${rows.length} values, ${accounts.length} accounts, cut-off ${cutoff}`);
} else {
  const tmp = `${OUT}.tmp`;
  writeFileSync(tmp, JSON.stringify(snapshot));
  renameSync(tmp, OUT);
  console.log(`baked ${rows.length} values, ${accounts.length} accounts, cut-off ${cutoff} -> public/data/statements.json`);
}

// The original P&L visual: every query its pages can send (tools/dwg-queries.ts, built by the app's
// own builders from the statements just written), answered by the model and stored under the exact query text.
const DWG_OUT = resolve(ROOT, 'public/data/dwg-snapshot.json');
const manifestFile = resolve(ROOT, 'node_modules/.cache/dwg-queries.json');
mkdirSync(dirname(manifestFile), { recursive: true });
const [npx, npxPre] = process.platform === 'win32' ? [process.env.ComSpec ?? 'cmd.exe', ['/d', '/c', 'npx']] : ['npx', []];
execFileSync(npx, [...npxPre, 'vite-node', 'tools/dwg-queries.ts', manifestFile], { cwd: ROOT, stdio: 'inherit' });
const entries = JSON.parse(readFileSync(manifestFile, 'utf-8'));
const queryKey = (q) => q.replace(/\r\n/g, '\n').trim(); // same rule as src/services/dwgSnapshot.ts
const dataType = (values) => {
  const v = values.find((x) => x !== null && x !== undefined);
  return typeof v === 'boolean' ? 'boolean' : typeof v === 'number' ? (Number.isInteger(v) ? 'int64' : 'double') : 'string';
};
const results = {};
for (const e of entries) {
  const key = queryKey(e.query);
  if (key in results) continue;
  const raw = await dax(e.query);
  const names = raw.length ? Object.keys(raw[0]) : [];
  const body = raw.map((r) => names.map((n) => r[n] ?? null));
  results[key] = { columns: names.map((name, i) => ({ name, dataType: dataType(body.map((r) => r[i])) })), rows: body };
}
// Compare as sets: the visual sorts itself, the model's row order is not a contract.
const canonical = (t) => JSON.stringify({ columns: t.columns, rows: t.rows.map((r) => JSON.stringify(r)).sort() });
if (check) {
  const shipped = existsSync(DWG_OUT) ? JSON.parse(readFileSync(DWG_OUT, 'utf-8')).results : {};
  for (const e of entries) {
    const key = queryKey(e.query);
    if (!shipped[key]) {
      console.error(`DRIFT: public/data/dwg-snapshot.json lacks a query of the app (${e.source}). Re-bake before deploying.`);
      process.exit(1);
    }
    if (canonical(shipped[key]) !== canonical(results[key])) {
      console.error(`DRIFT: the model answers ${e.source} differently from public/data/dwg-snapshot.json. Re-bake before deploying.`);
      process.exit(1);
    }
  }
  console.log(`no drift: ${entries.length} queries of the original visual`);
} else {
  const tmp = `${DWG_OUT}.tmp`;
  writeFileSync(tmp, JSON.stringify({ bakedAt: new Date().toISOString(), results }));
  renameSync(tmp, DWG_OUT);
  console.log(`baked ${Object.keys(results).length} queries of the original visual -> public/data/dwg-snapshot.json`);
}

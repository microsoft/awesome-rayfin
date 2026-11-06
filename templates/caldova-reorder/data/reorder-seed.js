#!/usr/bin/env node

//-----------------------------------------------------------------------
// Emits the SQL that puts Caldova's seeded reorder history into the Rayfin
// app's database.
//
// The history has to live where the app writes, not in the lakehouse: the app
// records a reorder in its own SQL database and Fabric mirrors that into OneLake
// for the semantic model to read. Seeding anywhere else would put the same
// record in two places again.
//
// The output is idempotent — every seeded id is deleted before it is inserted —
// so running a deploy twice cannot double the history, and reorders raised
// during a demo are left alone because their ids are not in this file.
//
// Used by deploy.sh and deploy.ps1 so both platforms seed identically.
//-----------------------------------------------------------------------

// CommonJS to match `generate.js`; the package has no `type` field.
const fs = require('node:fs');
const path = require('node:path');

const CSV = process.argv[2] ?? path.resolve(__dirname, 'generated/restock_requests.csv');

/** Quote a T-SQL string literal, escaping by doubling the apostrophe. */
function literal(value) {
    return `'${String(value).replace(/'/g, "''")}'`;
}

/** Minimal CSV reader: this file is generated, never hand-edited, and unquoted. */
function readRows(file) {
    const [header, ...lines] = fs.readFileSync(file, 'utf8')
        .split('\n')
        .map((line) => line.trim())
        .filter(Boolean);

    const columns = header.split(',');

    return lines.map((line) => {
        const cells = line.split(',');
        if (cells.length !== columns.length) {
            throw new Error(
                `Expected ${columns.length} columns but found ${cells.length}: ${line}`,
            );
        }
        return Object.fromEntries(columns.map((name, i) => [name, cells[i]]));
    });
}

const rows = readRows(CSV);

if (rows.length === 0) {
    throw new Error(`No reorder history found in ${CSV}`);
}

const ids = rows.map((row) => literal(row.request_id)).join(', ');
const statements = [`DELETE FROM dbo.RestockRequests WHERE id IN (${ids});`];

for (const row of rows) {
    const values = [
        literal(row.request_id),
        literal(row.store_id),
        literal(row.sku),
        String(Number.parseInt(row.qty, 10)),
        literal(row.requested_by),
        literal(row.requested_by_id),
        // DATETIME2 takes the timestamp without the trailing UTC marker; the
        // column is documented as UTC and every writer uses it.
        literal(row.requested_at.replace(/Z$/, '')),
        literal(row.status),
        literal(row.note),
    ].join(', ');

    statements.push(
        'INSERT INTO dbo.RestockRequests ' +
            '(id, store_id, sku, qty, requested_by, requested_by_id, requested_at, status, note) ' +
            `VALUES (${values});`,
    );
}

process.stdout.write(statements.join('\n'));

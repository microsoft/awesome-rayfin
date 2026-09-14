/**
 * Ledger surgery, separated from the store it runs against.
 *
 * `onelake.mjs` closes over a managed-identity token and a live DFS endpoint, so nothing in it can
 * be unit-tested — the same reason `server/ais/replayClock.js` and `upstreamState.js` exist. The
 * part that can lose data is not the HTTP; it is the decision about which lines survive, so that
 * decision lives here and takes its reader and writer as arguments.
 */

/**
 * Drop every ledger row the predicate rejects. Returns how many went.
 *
 * 🔴 **Rewrites the whole file, and that is the honest shape rather than a shortcut.** NDJSON has
 * no delete; the only way to remove a row is to write the remainder. The read-modify-write caveat
 * that applies to appending applies more sharply here, because a lost race now drops a row somebody
 * else just added rather than merely failing to add one. Acceptable for a planning tool where
 * commits are deliberate human acts seconds apart; NOT acceptable if this ever becomes a
 * high-frequency writer, at which point the ledger wants a table with real deletes.
 *
 * ⚠️ **A line this code cannot parse is KEPT.** A row it cannot read is not a row it may throw
 * away — a truncated write or a future schema would otherwise be swept up by an unrelated delete
 * and nobody would ever know which rows had gone.
 *
 * ⚠️ **Nothing matched means nothing is written.** A delete that hit no rows must not put the file
 * at risk at all.
 */
export async function removeLedgerRows(path, shouldKeep, read, write) {
  const existing = await read(path);
  if (existing == null) return 0;

  const kept = [];
  let removed = 0;
  for (const line of existing.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    let row = null;
    try {
      row = JSON.parse(trimmed);
    } catch {
      kept.push(trimmed);
      continue;
    }
    if (shouldKeep(row)) kept.push(trimmed);
    else removed += 1;
  }
  if (removed) await write(path, kept.map((line) => `${line}\n`).join(""));
  return removed;
}

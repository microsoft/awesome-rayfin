import { describe, expect, it } from "vitest";
import { removeLedgerRows } from "./onelakeLedger.mjs";

/** A tiny in-memory store standing in for OneLake, so the logic is testable at all. */
function store(initial) {
  const files = new Map(Object.entries(initial));
  return {
    files,
    read: async (path) => (files.has(path) ? files.get(path) : null),
    write: async (path, text) => { files.set(path, text); },
  };
}

const rows = [
  { id: "a1", aoi: "kieler-foerde", name: "Zwei Masten" },
  { id: "b2", aoi: "kieler-foerde", name: "Westufer" },
  { id: "c3", aoi: "schlei", name: "Kappeln" },
];
const ledger = rows.map((r) => `${JSON.stringify(r)}\n`).join("");

describe("removeLedgerRows", () => {
  it("removes exactly the row asked for and keeps the rest", async () => {
    const s = store({ "index.ndjson": ledger });
    const removed = await removeLedgerRows(
      "index.ndjson", (row) => row.id !== "b2", s.read, s.write);

    expect(removed).toBe(1);
    const kept = s.files.get("index.ndjson").trim().split("\n").map((l) => JSON.parse(l));
    expect(kept.map((r) => r.id)).toEqual(["a1", "c3"]);
  });

  it("🔴 keeps a line it cannot parse, instead of throwing it away", async () => {
    // A row this code cannot read is not a row it may delete. A truncated write or a future schema
    // would otherwise be silently swept up by an unrelated delete.
    const s = store({ "index.ndjson": `${ledger}not json at all\n` });
    const removed = await removeLedgerRows(
      "index.ndjson", (row) => row.id !== "a1", s.read, s.write);

    expect(removed).toBe(1);
    expect(s.files.get("index.ndjson")).toContain("not json at all");
  });

  it("does not rewrite the file when nothing matched", async () => {
    const s = store({ "index.ndjson": ledger });
    const removed = await removeLedgerRows(
      "index.ndjson", () => true, s.read, s.write);

    expect(removed).toBe(0);
    // Untouched byte-for-byte: a delete that matched nothing must not risk the file at all.
    expect(s.files.get("index.ndjson")).toBe(ledger);
  });

  it("survives a ledger that does not exist yet", async () => {
    const s = store({});
    expect(await removeLedgerRows("index.ndjson", () => false, s.read, s.write)).toBe(0);
  });

  it("⚠️ matches on id AND aoi — two coasts may hold the same plan id", async () => {
    const collide = [
      { id: "same", aoi: "kieler-foerde", name: "Förde" },
      { id: "same", aoi: "schlei", name: "Schlei" },
    ].map((r) => `${JSON.stringify(r)}\n`).join("");
    const s = store({ "index.ndjson": collide });

    const removed = await removeLedgerRows(
      "index.ndjson",
      (row) => !(row.id === "same" && row.aoi === "schlei"),
      s.read, s.write);

    expect(removed).toBe(1);
    const kept = JSON.parse(s.files.get("index.ndjson").trim());
    expect(kept.aoi).toBe("kieler-foerde");
  });

  it("drops blank lines rather than preserving them as rows", async () => {
    const s = store({ "index.ndjson": `${ledger}\n\n` });
    await removeLedgerRows("index.ndjson", (row) => row.id !== "a1", s.read, s.write);
    const lines = s.files.get("index.ndjson").split("\n").filter(Boolean);
    expect(lines).toHaveLength(2);
  });
});

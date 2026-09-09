import { describe, it, expect, beforeEach } from "vitest";
import { visualSelectionStore } from "@/finance";
import type { VisualSelection } from "@/finance";

function sel(label: string): VisualSelection {
  return { visual: "Test", label, insights: [] };
}

describe("visualSelectionStore — atomic snapshot + navigation", () => {
  beforeEach(() => visualSelectionStore.clear());

  it("select() carries no navigation", () => {
    visualSelectionStore.select(sel("a"));
    const snap = visualSelectionStore.getSnapshot();
    expect(snap.selection?.label).toBe("a");
    expect(snap.navigation).toBeNull();
  });

  it("selectAt() stores the sibling set and active index", () => {
    const items = [sel("a"), sel("b"), sel("c")];
    visualSelectionStore.selectAt(items, 1, "scope");
    const snap = visualSelectionStore.getSnapshot();
    expect(snap.selection?.label).toBe("b");
    expect(snap.navigation?.index).toBe(1);
    expect(snap.navigation?.items).toHaveLength(3);
  });

  it("step() moves within bounds and no-ops at the edges", () => {
    visualSelectionStore.selectAt([sel("a"), sel("b")], 0, "scope");
    visualSelectionStore.step(-1); // at start → no-op
    expect(visualSelectionStore.getSnapshot().selection?.label).toBe("a");
    visualSelectionStore.step(1);
    expect(visualSelectionStore.getSnapshot().selection?.label).toBe("b");
    visualSelectionStore.step(1); // at end → no-op
    expect(visualSelectionStore.getSnapshot().selection?.label).toBe("b");
  });

  it("is immune to later mutation of the caller's array", () => {
    const items = [sel("a"), sel("b")];
    visualSelectionStore.selectAt(items, 0, "scope");
    items.pop(); // caller mutates their copy
    visualSelectionStore.step(1);
    expect(visualSelectionStore.getSnapshot().selection?.label).toBe("b");
  });

  it("falls back to a lone selection for an out-of-range index", () => {
    visualSelectionStore.selectAt([sel("a")], 5, "scope");
    expect(visualSelectionStore.getSnapshot().navigation).toBeNull();
  });

  it("clear() resets both selection and navigation, and step() after clear is a no-op", () => {
    visualSelectionStore.selectAt([sel("a"), sel("b")], 0, "scope");
    visualSelectionStore.clear();
    const snap = visualSelectionStore.getSnapshot();
    expect(snap.selection).toBeNull();
    expect(snap.navigation).toBeNull();
    visualSelectionStore.step(1); // must not throw
    expect(visualSelectionStore.getSnapshot().selection).toBeNull();
  });

  it("getSnapshot() returns a stable reference between reads (no tearing)", () => {
    visualSelectionStore.selectAt([sel("a"), sel("b")], 0, "scope");
    expect(visualSelectionStore.getSnapshot()).toBe(visualSelectionStore.getSnapshot());
  });
});

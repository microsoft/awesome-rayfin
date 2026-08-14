import { describe, it, expect, vi, beforeEach } from "vitest";
import type { DeckKpi, DeckSpec } from "@/finance/lib/deck";

// Capture every pptxgenjs addText call so we can assert what the deck discloses,
// without producing a real .pptx. vi.hoisted shares the array with the hoisted mock.
const { addTextCalls } = vi.hoisted(() => ({ addTextCalls: [] as string[] }));

vi.mock("pptxgenjs", () => {
  class FakeSlide {
    set background(_v: unknown) {}
    addText(text: unknown) {
      addTextCalls.push(String(text));
    }
    addShape() {}
    addImage() {}
    addChart() {}
    addTable() {}
  }
  class FakePptx {
    layout = "";
    defineLayout() {}
    addSlide() {
      return new FakeSlide();
    }
    async writeFile() {
      return "deck.pptx";
    }
  }
  return { default: FakePptx };
});

const { buildDeck } = await import("@/finance/lib/deck");

function specWithKpis(kpis: DeckKpi[]): DeckSpec {
  return {
    reportTitle: "Test Deck",
    theme: "light",
    sections: { cover: false, summary: false, kpis: true, chart: false, table: false, pageNumbers: false },
    kpis,
    table: { columns: [], rows: [] },
  };
}

describe("buildDeck — estimated KPI disclosure", () => {
  beforeEach(() => {
    addTextCalls.length = 0;
  });

  it("marks an estimated delta with an asterisk and adds a disclosure footnote", async () => {
    await buildDeck(specWithKpis([{ label: "Revenue", value: "$473.1B", delta: "+6.2% YoY", up: true, estimated: true }]));
    expect(addTextCalls.some((t) => t.includes("+6.2% YoY *"))).toBe(true);
    expect(addTextCalls.some((t) => t.includes("Illustrative comparison"))).toBe(true);
  });

  it("does not mark or footnote a real (non-estimated) delta", async () => {
    await buildDeck(specWithKpis([{ label: "Revenue", value: "$473.1B", delta: "+6.2% YoY", up: true }]));
    expect(addTextCalls.some((t) => t.includes("+6.2% YoY *"))).toBe(false);
    expect(addTextCalls.some((t) => t.includes("Illustrative comparison"))).toBe(false);
  });
});

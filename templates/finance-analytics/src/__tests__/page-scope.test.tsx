import { describe, it, expect, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor, within } from "@testing-library/react";
import { createFabricStandardApp, staticDataSource } from "@/finance";
import type { FabricStandardAppConfig } from "@/finance";
import type { DataTable } from "@/finance";

// Regression coverage for the per-page `scope` capability contract (Phase 1/2 of the
// screen-real-estate work). A page that renders its own local dataset declares a `scope`
// so the shell suppresses the affordances that don't describe it — the global dimension
// filters, the live row count and the resting-rail insights — and surfaces an honest
// scope note instead. Pages that omit `scope` keep the full global chrome. These tests
// lock in that "no inert / no misleading control" guarantee so a later refactor can't
// silently bring the inert filters back onto the FP&A boards.

const TABLE: DataTable = {
  columns: [
    { key: "segment", label: "Segment" },
    { key: "revenue", label: "Revenue", numeric: true },
  ],
  rows: [
    { segment: "Cloud", revenue: 120 },
    { segment: "Gaming", revenue: 90 },
    { segment: "Devices", revenue: 60 },
  ],
};

const SCOPE_NOTE = "Global filters don't apply to this local view.";

function makeConfig(): FabricStandardAppConfig {
  return {
    appName: "Scope Test App",
    dataSource: staticDataSource(TABLE),
    query: { id: "scope-test", query: "EVALUATE scope-test" },
    features: ["intelligence"],
    filters: [{ column: "segment", label: "Segment", pinned: true }],
    pages: [
      {
        id: "global",
        label: "Global Board",
        kind: "custom",
        render: () => <div>GLOBAL_PAGE_MARKER</div>,
      },
      {
        id: "local",
        label: "Local Board",
        kind: "custom",
        scope: { dimensions: "none", period: "none", showRowCount: false, note: SCOPE_NOTE },
        render: () => <div>LOCAL_PAGE_MARKER</div>,
      },
    ],
  };
}

function renderApp() {
  const App = createFabricStandardApp(makeConfig());
  return render(<App />);
}

beforeEach(() => {
  localStorage.clear();
  window.history.replaceState(null, "", "/");
});

describe("page scope contract", () => {
  it("shows global dimension filters + row count on an un-scoped page", async () => {
    renderApp();
    await screen.findByText("GLOBAL_PAGE_MARKER");
    // The pinned Segment filter renders as a labelled select in the context header.
    expect(screen.getAllByLabelText("Segment").length).toBeGreaterThan(0);
    // Live "N rows" count reflects the loaded table.
    expect(screen.getByText(/\brows\b/)).toBeInTheDocument();
    // No scope note on a fully-global page.
    expect(screen.queryByText(SCOPE_NOTE)).not.toBeInTheDocument();
  });

  it("suppresses inert filters + row count and shows a scope note on a scoped page", async () => {
    renderApp();
    await screen.findByText("GLOBAL_PAGE_MARKER");

    // Navigate to the scoped local page via the desktop nav.
    const navs = screen.getAllByRole("navigation", { name: "Views" });
    fireEvent.click(within(navs[0]).getByRole("button", { name: /Local Board/i }));

    await screen.findByText("LOCAL_PAGE_MARKER");

    // The inert global filter and row count are gone; the honest scope note is shown.
    await waitFor(() => {
      expect(screen.queryByLabelText("Segment")).not.toBeInTheDocument();
    });
    expect(screen.queryByText(/\brows\b/)).not.toBeInTheDocument();
    expect(screen.getByText(SCOPE_NOTE)).toBeInTheDocument();
  });
});

import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, within } from "@testing-library/react";
import { FabricAppShell, type NavItem } from "@/finance";

// Exercises the shell's sidebar a11y + power-user features added in the
// gallery-hardening pass: vendor-neutral footer label, the in-nav filter box
// (appears past the threshold), collapsible groups, right-aligned badges,
// roving arrow-key focus, and the Alt+N view shortcut.

const items: NavItem[] = [
  { id: "overview", label: "Overview", group: "Analyze" },
  { id: "detail", label: "Detail Grid", group: "Analyze", badge: 3 },
  { id: "variance", label: "Variance", group: "Analyze" },
  { id: "pnl", label: "P&L", group: "Statements" },
  { id: "aging", label: "Aging", group: "Statements" },
  { id: "forecast", label: "Forecast", group: "Plan" },
  { id: "scenario", label: "Scenario", group: "Plan" },
  { id: "settings", label: "Settings", group: "Admin" },
  { id: "about", label: "About", group: "Admin" },
];

function renderShell(onNavChange = vi.fn()) {
  render(
    <FabricAppShell
      appName="Finance Analytics"
      footerLabel="Finance Analytics · Fabric App Standard"
      navItems={items}
      activeNavId="overview"
      onNavChange={onNavChange}
    >
      <div>content</div>
    </FabricAppShell>,
  );
  return onNavChange;
}

beforeEach(() => {
  localStorage.clear();
});

describe("FabricAppShell sidebar", () => {
  it("renders the vendor-neutral footer label", () => {
    renderShell();
    expect(screen.getByText("Finance Analytics · Fabric App Standard")).toBeInTheDocument();
  });

  it("shows the in-nav filter box once nav length hits the threshold", () => {
    renderShell();
    expect(screen.getAllByLabelText("Filter views").length).toBeGreaterThan(0);
  });

  it("filters the nav list as you type", () => {
    renderShell();
    const filter = screen.getAllByLabelText("Filter views")[0];
    fireEvent.change(filter, { target: { value: "forecast" } });
    // The desktop nav should now show Forecast but not Overview.
    const navs = screen.getAllByRole("navigation", { name: "Views" });
    const desktop = navs[0];
    expect(within(desktop).getByText("Forecast")).toBeInTheDocument();
    expect(within(desktop).queryByText("Overview")).not.toBeInTheDocument();
  });

  it("renders a badge on the flagged nav item", () => {
    renderShell();
    const navs = screen.getAllByRole("navigation", { name: "Views" });
    expect(within(navs[0]).getByText("3")).toBeInTheDocument();
  });

  it("collapses a group when its header toggle is clicked", () => {
    renderShell();
    const navs = screen.getAllByRole("navigation", { name: "Views" });
    const desktop = navs[0];
    // "Statements" group header is a toggle button (aria-expanded).
    const toggle = within(desktop).getByRole("button", { name: /Statements/i });
    expect(within(desktop).getByText("P&L")).toBeInTheDocument();
    fireEvent.click(toggle);
    expect(within(desktop).queryByText("P&L")).not.toBeInTheDocument();
  });

  it("jumps to the Nth view on Alt+<number>", () => {
    const onNavChange = renderShell();
    fireEvent.keyDown(window, { key: "2", altKey: true });
    expect(onNavChange).toHaveBeenCalledWith("detail");
  });

  it("moves focus with the ArrowDown roving key", () => {
    renderShell();
    const navs = screen.getAllByRole("navigation", { name: "Views" });
    const buttons = within(navs[0]).getAllByRole("button", { current: "page" });
    const active = buttons[0];
    active.focus();
    expect(active).toHaveFocus();
    fireEvent.keyDown(active.closest("ul")!, { key: "ArrowDown" });
    // Focus should have advanced off the active item.
    expect(active).not.toHaveFocus();
  });
});

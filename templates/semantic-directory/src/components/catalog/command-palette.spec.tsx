//-----------------------------------------------------------------------
// Semantic Directory — component tests for the command palette (⌘K / Ctrl+K).
//
// The palette is the app's keyboard-first surface, so its contract is worth
// pinning: actions render first, typing filters actions and surfaces entity
// hits, arrow keys move a wrapping selection, Enter runs the active item and
// closes exactly once, clicking an entity routes by key, and an empty result
// set shows an honest "No matches."
//-----------------------------------------------------------------------

import { describe, it, expect, afterEach, vi } from "vitest";
import { render, screen, cleanup, fireEvent } from "@testing-library/react";
import { CommandPalette, type PaletteAction } from "./command-palette";
import { catalog, tbl, meas } from "@/catalog/test-fixtures";

afterEach(cleanup);

const model = catalog({
    tables: [tbl("Sales")],
    measures: [
        meas("Total Sales", { table: "Sales", description: "Sum of sales amount" }),
        // Deliberately in a different table so the token "sales" cannot match it
        // via the indexed table field — lets us prove AND-search precision.
        meas("Total Cost", { table: "Costs" }),
    ],
});

function makeActions(run = vi.fn()): { actions: PaletteAction[]; run: ReturnType<typeof vi.fn> } {
    const actions: PaletteAction[] = [
        { id: "home", label: "Go home", hint: "Back to landing", icon: <span>h</span>, run },
        { id: "export", label: "Export dictionary", icon: <span>e</span>, keywords: "csv markdown download", run: vi.fn() },
    ];
    return { actions, run };
}

function renderPalette(overrides: Partial<React.ComponentProps<typeof CommandPalette>> = {}) {
    const onClose = vi.fn();
    const onOpenEntity = vi.fn();
    const { actions, run } = makeActions();
    render(
        <CommandPalette
            open
            onClose={onClose}
            catalog={model}
            actions={actions}
            onOpenEntity={onOpenEntity}
            {...overrides}
        />,
    );
    return { onClose, onOpenEntity, run };
}

describe("CommandPalette", () => {
    it("lists all actions first when the query is empty", () => {
        renderPalette();
        const options = screen.getAllByRole("option");
        expect(options[0].textContent).toContain("Go home");
        expect(options.some((o) => o.textContent?.includes("Export dictionary"))).toBe(true);
    });

    it("filters actions by label and by keyword", () => {
        renderPalette();
        const input = screen.getByRole("combobox");

        fireEvent.change(input, { target: { value: "home" } });
        expect(screen.getByText("Go home")).toBeTruthy();
        expect(screen.queryByText("Export dictionary")).toBeNull();

        // "csv" only matches the export action via its keywords, not its label.
        fireEvent.change(input, { target: { value: "csv" } });
        expect(screen.getByText("Export dictionary")).toBeTruthy();
        expect(screen.queryByText("Go home")).toBeNull();
    });

    it("surfaces entity hits when typing an entity name", () => {
        renderPalette();
        fireEvent.change(screen.getByRole("combobox"), { target: { value: "total sales" } });
        expect(screen.getByText("Total Sales")).toBeTruthy();
        // AND-combined search is precise: "Total Cost" shares only the "total"
        // token, so it must NOT appear — this pins us against an OR regression.
        expect(screen.queryByText("Total Cost")).toBeNull();
    });

    it("moves a wrapping selection with the arrow keys", () => {
        renderPalette();
        const input = screen.getByRole("combobox");
        const first = screen.getAllByRole("option")[0];
        expect(first.getAttribute("aria-selected")).toBe("true");

        fireEvent.keyDown(input, { key: "ArrowDown" });
        expect(screen.getAllByRole("option")[1].getAttribute("aria-selected")).toBe("true");
        expect(screen.getAllByRole("option")[0].getAttribute("aria-selected")).toBe("false");

        // Up from the second wraps behaviour is index-1; from the first it wraps to last.
        fireEvent.keyDown(input, { key: "ArrowUp" });
        expect(screen.getAllByRole("option")[0].getAttribute("aria-selected")).toBe("true");
        fireEvent.keyDown(input, { key: "ArrowUp" });
        const opts = screen.getAllByRole("option");
        expect(opts[opts.length - 1].getAttribute("aria-selected")).toBe("true");
    });

    it("runs the active action on Enter and closes exactly once", () => {
        const { onClose, run } = renderPalette();
        const dialog = screen.getByLabelText("Command palette") as HTMLDialogElement;
        expect(dialog.open).toBe(true);

        fireEvent.keyDown(screen.getByRole("combobox"), { key: "Enter" });

        expect(run).toHaveBeenCalledTimes(1);
        // Assert the dialog itself closed — proving close routes through the
        // native <dialog>, not a bare onClose() call that skips it.
        expect(dialog.open).toBe(false);
        expect(onClose).toHaveBeenCalledTimes(1);
    });

    it("routes an entity click by exact key and closes", () => {
        const { onOpenEntity, onClose } = renderPalette();
        const dialog = screen.getByLabelText("Command palette") as HTMLDialogElement;
        fireEvent.change(screen.getByRole("combobox"), { target: { value: "total sales" } });
        fireEvent.click(screen.getByText("Total Sales"));
        // The stable catalog key (measureKey → normName), not a display label.
        expect(onOpenEntity).toHaveBeenCalledWith("measure:total sales");
        expect(dialog.open).toBe(false);
        expect(onClose).toHaveBeenCalledTimes(1);
    });

    it("opens an entity by keyboard: type, Enter, route by key, close once", () => {
        const { onOpenEntity, onClose } = renderPalette();
        fireEvent.change(screen.getByRole("combobox"), { target: { value: "total sales" } });
        // Only "Total Sales" survives the AND search, so it is the active item.
        fireEvent.keyDown(screen.getByRole("combobox"), { key: "Enter" });
        expect(onOpenEntity).toHaveBeenCalledWith("measure:total sales");
        expect(onClose).toHaveBeenCalledTimes(1);
    });

    it("shows an honest empty state when nothing matches", () => {
        renderPalette();
        fireEvent.change(screen.getByRole("combobox"), { target: { value: "zzzznomatch" } });
        expect(screen.getByText("No matches.")).toBeTruthy();
        expect(screen.queryAllByRole("option")).toHaveLength(0);
    });
});

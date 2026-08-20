//-----------------------------------------------------------------------
// Semantic Directory — component tests for the Path Finder view.
//
// Guards the presentation contract: unambiguous copy at 1 and N hops,
// equal-length alternate awareness, honest same-table and no-path states,
// deep-link seeding, and a working reversible swap control.
//-----------------------------------------------------------------------

import { describe, it, expect, afterEach, vi } from "vitest";
import { render, screen, cleanup, fireEvent } from "@testing-library/react";
import { PathFinderView } from "./path-finder-view";
import { catalog, rel, tbl } from "@/catalog/test-fixtures";

afterEach(cleanup);

// Snowflake: Sales → Product → Category, Sales → Date. A/…/D split for no-path.
const star = catalog({
    tables: [tbl("Sales"), tbl("Product"), tbl("Category"), tbl("Date")],
    relationships: [
        rel("Sales", "ProductKey", "Product", "ProductKey"),
        rel("Product", "CategoryKey", "Category", "CategoryKey"),
        rel("Sales", "DateKey", "Date", "DateKey"),
    ],
});

const diamond = catalog({
    tables: [tbl("A"), tbl("B"), tbl("C"), tbl("D")],
    relationships: [
        rel("A", "k", "B", "k"),
        rel("A", "k", "C", "k"),
        rel("B", "k", "D", "k"),
        rel("C", "k", "D", "k"),
    ],
});

const split = catalog({
    tables: [tbl("A"), tbl("B"), tbl("C"), tbl("D")],
    relationships: [rel("A", "k", "B", "k"), rel("C", "k", "D", "k")],
});

describe("PathFinderView", () => {
    it("labels a direct one-hop join as 'Directly related'", () => {
        render(<PathFinderView catalog={star} onExit={vi.fn()} initialFrom="Sales" initialTo="Product" />);
        expect(screen.getByText(/Directly related/)).toBeTruthy();
        expect(screen.getByText(/1 hop · 2 tables/)).toBeTruthy();
    });

    it("summarizes a multi-hop path with correct hop/table plurals", () => {
        render(<PathFinderView catalog={star} onExit={vi.fn()} initialFrom="Category" initialTo="Sales" />);
        expect(screen.getByText(/2 hops · 3 tables/)).toBeTruthy();
    });

    it("notes when equal-length alternate paths exist", () => {
        render(<PathFinderView catalog={diamond} onExit={vi.fn()} initialFrom="A" initialTo="D" />);
        expect(screen.getByText(/showing 1 of 2 equal-length paths/)).toBeTruthy();
    });

    it("shows the same-table state when both tables match", () => {
        render(<PathFinderView catalog={star} onExit={vi.fn()} initialFrom="Sales" initialTo="Sales" />);
        expect(screen.getByText("Pick two different tables")).toBeTruthy();
    });

    it("shows a purposeful no-path state for disconnected tables", () => {
        render(<PathFinderView catalog={split} onExit={vi.fn()} initialFrom="A" initialTo="C" />);
        expect(screen.getByText("No join path")).toBeTruthy();
    });

    it("reverses the selection via the swap control", () => {
        const onSelectPath = vi.fn();
        render(
            <PathFinderView
                catalog={star}
                onExit={vi.fn()}
                initialFrom="Sales"
                initialTo="Product"
                onSelectPath={onSelectPath}
            />,
        );
        fireEvent.click(screen.getByRole("button", { name: "Swap the From and To tables" }));
        expect(onSelectPath).toHaveBeenCalledWith("Product", "Sales");
    });

    it("seeds the pickers from the deep-linked selection", () => {
        render(<PathFinderView catalog={star} onExit={vi.fn()} initialFrom="Date" initialTo="Product" />);
        expect((screen.getByLabelText("From table") as HTMLSelectElement).value).toBe("Date");
        expect((screen.getByLabelText("To table") as HTMLSelectElement).value).toBe("Product");
    });
});

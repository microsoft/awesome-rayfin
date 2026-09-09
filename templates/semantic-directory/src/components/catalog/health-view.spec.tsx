//-----------------------------------------------------------------------
// Semantic Directory — component tests for the Model Health view.
//
// Guards the honest three-bucket presentation: passing checks read
// affirmatively (no severity noise), informational notes survive a perfect
// 100, fractional deductions render as "<1 pt", and offender rows toggle
// aria-expanded for assistive tech.
//-----------------------------------------------------------------------

import { describe, it, expect, afterEach, vi } from "vitest";
import { render, screen, cleanup, fireEvent, within } from "@testing-library/react";
import { HealthView } from "./health-view";
import { catalog, col, meas, rel, tbl } from "@/catalog/test-fixtures";

afterEach(cleanup);

const cleanModel = () =>
    catalog({
        measures: [meas("Total Sales", { description: "Sum of sales.", formatString: "#,0" })],
        columns: [col("Product", "Category")],
        tables: [tbl("Sales"), tbl("Product")],
        relationships: [rel("Sales", "ProductKey", "Product", "ProductKey")],
    });

describe("HealthView", () => {
    it("presents a clean model as passing without High/Medium severity badges", () => {
        render(<HealthView catalog={cleanModel()} onExit={vi.fn()} />);
        expect(screen.getByText(/scored\s+checks\s+passing/i)).toBeTruthy();
        expect(screen.getByText("Passing checks")).toBeTruthy();
        // Affirmative rule copy is shown for a passing check.
        expect(screen.getByText("Every visible measure has a description.")).toBeTruthy();
        // No severity chips when nothing is wrong and nothing is informational.
        expect(screen.queryByText("Issues affecting the score")).toBeNull();
        expect(screen.queryByText("High")).toBeNull();
        expect(screen.queryByText("Medium")).toBeNull();
    });

    it("keeps an informational note visible at a perfect score of 100", () => {
        const model = catalog({
            measures: [meas("M", { description: "x", formatString: "#,0" })],
            columns: [col("Product", "Category")],
            tables: [tbl("Sales"), tbl("Product")],
            relationships: [
                rel("Sales", "ProductKey", "Product", "ProductKey"),
                rel("Sales", "AltKey", "Product", "AltKey", { isActive: false }),
            ],
        });
        render(<HealthView catalog={model} onExit={vi.fn()} />);
        expect(screen.getByText("100")).toBeTruthy();
        expect(screen.getByText("Notes")).toBeTruthy();
        // The note is not a scored issue.
        expect(screen.queryByText("Issues affecting the score")).toBeNull();
    });

    it("renders a sub-point deduction as '<1 pt', not a rounded 0", () => {
        // 20 measures, all described; one lacks a format string → format rule
        // penalty = 10 × (1/20) = 0.5, which must read as "−<1 pt".
        const measures = Array.from({ length: 20 }, (_, i) =>
            meas(`M${i}`, { description: "x", formatString: i === 0 ? undefined : "#,0" }),
        );
        const model = catalog({ measures, tables: [tbl("Measures")] });
        render(<HealthView catalog={model} onExit={vi.fn()} />);
        expect(screen.getByText("Issues affecting the score")).toBeTruthy();
        expect(screen.getByText("−<1 pt")).toBeTruthy();
    });

    it("toggles aria-expanded when an issue's offenders are revealed", () => {
        const model = catalog({
            measures: [meas("A", { formatString: "#,0" }), meas("B", { formatString: "#,0" })],
            tables: [tbl("Measures")],
        });
        render(<HealthView catalog={model} onExit={vi.fn()} />);
        const issue = screen.getByText("Issues affecting the score").closest("section")!;
        const toggle = within(issue).getByRole("button", { expanded: false });
        fireEvent.click(toggle);
        expect(within(issue).getByRole("button", { expanded: true })).toBeTruthy();
    });
});

//-----------------------------------------------------------------------
// Semantic Directory — component tests for the landing orbit cap + tray.
//
// The bundled Contoso demo has fewer areas than ORBIT_CAP, so the capped
// orbit and the "More areas" overflow tray are UNREACHABLE by screenshot.
// These tests cover that path directly: a >cap model shows the top areas in
// the orbit, an honest "Top N of M" footer, and every remaining area behind
// a keyboard-accessible tray that still routes into its area. A small model
// keeps the calm, uncapped landing with no tray.
//-----------------------------------------------------------------------

import { describe, it, expect, afterEach, vi } from "vitest";
import { render, screen, cleanup, fireEvent } from "@testing-library/react";
import { CalmLanding } from "./calm-landing";
import { ORBIT_CAP } from "./model-constellation";
import { catalog, tbl, col, rel } from "@/catalog/test-fixtures";
import { appConfig } from "@/app.config";
import type { CatalogModel } from "@/catalog/model/types";

afterEach(cleanup);

// A star with `dimCount` dimension tables hanging off a single fact. Each
// dimension carries one sliceable column, so deriveThemes yields one area per
// dimension — a deterministic way to exceed ORBIT_CAP.
function starWithDims(dimCount: number): CatalogModel {
    const dims = Array.from({ length: dimCount }, (_, i) => `Dim${String(i + 1).padStart(2, "0")}`);
    return catalog({
        tables: [tbl("Sales"), ...dims.map((d) => tbl(d))],
        // Only the dimension columns are dimension-like slice fields; the fact's
        // FK columns are omitted so Sales doesn't become its own area.
        columns: dims.map((d) => col(d, `${d} Name`)),
        relationships: dims.map((d) => rel("Sales", `${d}Key`, d, `${d}Key`)),
    });
}

const noop = () => {};

function renderLanding(model: CatalogModel, onOpenTheme = vi.fn()) {
    render(
        <CalmLanding
            catalog={model}
            query=""
            onQueryChange={noop}
            onSelect={noop}
            onSubmit={noop}
            onOpenTheme={onOpenTheme}
        />,
    );
    return onOpenTheme;
}

describe("CalmLanding orbit cap + More areas tray", () => {
    it("caps the orbit and reveals the overflow behind a collapsed tray", () => {
        const model = starWithDims(ORBIT_CAP + 2); // 14 areas -> 12 orbit, 2 overflow
        renderLanding(model);

        // Honest capped footer copy.
        expect(
            screen.getByText(
                new RegExp(`Top ${ORBIT_CAP} of ${ORBIT_CAP + 2} business areas`, "i"),
            ),
        ).toBeTruthy();

        // Tray toggle is present, collapsed, and counts the overflow.
        const toggle = screen.getByRole("button", { name: /more areas/i });
        expect(toggle.getAttribute("aria-expanded")).toBe("false");
        expect(toggle.textContent).toMatch(/2 more/);
    });

    it("expands the tray and routes a chip click into its area", () => {
        const model = starWithDims(ORBIT_CAP + 2);
        const onOpenTheme = renderLanding(model);

        const toggle = screen.getByRole("button", { name: /more areas/i });
        fireEvent.click(toggle);
        expect(toggle.getAttribute("aria-expanded")).toBe("true");

        // Overflow areas are the lowest-ranked; with equal rank they fall back to
        // label order, so the last dimension labels land in the tray. Click one.
        const chip = screen.getByRole("button", { name: /Dim14 — 1 fields/i });
        fireEvent.click(chip);
        expect(onOpenTheme).toHaveBeenCalledTimes(1);
        expect(onOpenTheme).toHaveBeenCalledWith(expect.stringContaining("dim14"));
    });

    it("keeps a calm, uncapped landing with no tray on a small model", () => {
        renderLanding(starWithDims(6));

        expect(
            screen.getByText(/6 business areas orbit the model · hover to preview/i),
        ).toBeTruthy();
        expect(screen.queryByRole("button", { name: /more areas/i })).toBeNull();
    });

    it("renders no orbit footer for a model with zero derivable areas", () => {
        // A lone fact with no relationships and no dimension-like columns yields
        // no areas — the footer must not claim "0 business areas orbit".
        const empty = catalog({ tables: [tbl("Sales")] });
        renderLanding(empty);
        expect(screen.queryByText(/business areas orbit the model/i)).toBeNull();
        expect(screen.queryByRole("button", { name: /more areas/i })).toBeNull();
    });
});

describe("CalmLanding dynamic hero title", () => {
    // A demo/bundled catalog names itself via brainSource.model — the same seam
    // the hero title reads to swap the app-name qualifier for the model name.
    function demoModel(modelNameValue: string): CatalogModel {
        return catalog({
            origin: "bundled",
            tables: [tbl("Sales")],
            brainSource: { model: modelNameValue, workspace: "", capturedUtc: "" },
        });
    }

    it("swaps the qualifier for the connected model name", () => {
        renderLanding(demoModel("Contoso Sales"));
        expect(
            screen.getByRole("heading", { level: 1 }).textContent,
        ).toBe("Contoso Sales Directory");
    });

    it("drops a trailing (Demo) marker but keeps real parentheticals", () => {
        // The demo bundle self-labels "Contoso Sales (Demo)" — the title strips
        // that marker (the tagline/banner already signal demo mode)…
        renderLanding(demoModel("Contoso Sales (Demo)"));
        expect(
            screen.getByRole("heading", { level: 1 }).textContent,
        ).toBe("Contoso Sales Directory");
        cleanup();
        // …but a meaningful parenthetical in a real model name is preserved.
        renderLanding(demoModel("Sales (FY24)"));
        expect(
            screen.getByRole("heading", { level: 1 }).textContent,
        ).toBe("Sales (FY24) Directory");
    });

    it("trims a long model name so the hero stays crisp", () => {
        const long = "Enterprise Financial Planning and Analysis Consolidated Model";
        renderLanding(demoModel(long));
        const title = screen.getByRole("heading", { level: 1 }).textContent ?? "";
        expect(title.endsWith("Directory")).toBe(true);
        expect(title).toContain("…");
        // The full name must NOT appear untrimmed.
        expect(title).not.toContain(long);
        // The model-name segment is bounded (cap 28 + ellipsis, before " Directory").
        expect(title.replace(/ Directory$/, "").length).toBeLessThanOrEqual(30);
    });

    it("falls back to the static app name when no model name is known", () => {
        // origin "live" with an unconfigured modelName ("") resolves to no name.
        renderLanding(catalog({ origin: "live", tables: [tbl("Sales")] }));
        expect(
            screen.getByRole("heading", { level: 1 }).textContent,
        ).toBe(appConfig.name);
    });

    it("keeps a trailing (Demo) marker for a live model name", () => {
        // The (Demo) strip is demo/bundled-only — a live model legitimately
        // named "Finance (Demo)" (e.g. a UAT workspace) keeps its marker.
        const prev = appConfig.modelName;
        appConfig.modelName = "Finance (Demo)";
        try {
            renderLanding(catalog({ origin: "live", tables: [tbl("Sales")] }));
            expect(
                screen.getByRole("heading", { level: 1 }).textContent,
            ).toBe("Finance (Demo) Directory");
        } finally {
            appConfig.modelName = prev;
        }
    });
});

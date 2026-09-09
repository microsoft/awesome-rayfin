//-----------------------------------------------------------------------
// Semantic Directory — component tests for the Impact analysis view.
//
// Guards the presentation contract: deep-link seeding on a root, depth-grouped
// blast radius, hidden-measure filtering, the leaf "safe to change" state, an
// auto-resolved default root, and a working navigate hand-off.
//-----------------------------------------------------------------------

import { describe, it, expect, afterEach, vi } from "vitest";
import { render, screen, cleanup, fireEvent } from "@testing-library/react";
import { ImpactView } from "./impact-view";
import { catalog, meas } from "@/catalog/test-fixtures";

afterEach(cleanup);

// Base ← Sibling, Wrap (depth1); Wrap ← Top (depth2); Base ← Secret (hidden).
// Lonely has nothing downstream.
const base = meas("Base", { usedByMeasures: ["wrap", "sibling", "secret"] });
const wrap = meas("Wrap", { usedByMeasures: ["top"] });
const sibling = meas("Sibling", {});
const top = meas("Top", {});
const secret = meas("Secret", { isHidden: true });
const lonely = meas("Lonely", {});

const model = catalog({ measures: [base, wrap, sibling, top, secret, lonely] });

describe("ImpactView", () => {
    it("seeds on the deep-linked root and groups its blast radius by depth", () => {
        render(<ImpactView catalog={model} onExit={vi.fn()} onNavigate={vi.fn()} initialKey={base.key} />);
        expect(screen.getByRole("heading", { name: /Base/ })).toBeTruthy();
        expect(screen.getByText("Reads it directly")).toBeTruthy();
        expect(screen.getByText("Sibling")).toBeTruthy();
        expect(screen.getByText("Wrap")).toBeTruthy();
        expect(screen.getByText("Top")).toBeTruthy();
    });

    it("hides hidden downstream measures", () => {
        render(<ImpactView catalog={model} onExit={vi.fn()} onNavigate={vi.fn()} initialKey={base.key} />);
        expect(screen.queryByText("Secret")).toBeNull();
    });

    it("shows the leaf 'safe to change' state when nothing is downstream", () => {
        render(<ImpactView catalog={model} onExit={vi.fn()} onNavigate={vi.fn()} initialKey={lonely.key} />);
        expect(screen.getByText("Nothing downstream reads this")).toBeTruthy();
    });

    it("auto-resolves the highest-impact root when no key is given", () => {
        render(<ImpactView catalog={model} onExit={vi.fn()} onNavigate={vi.fn()} />);
        // Base drives the largest visible blast radius, so it seeds by default.
        expect(screen.getByRole("heading", { name: /Base/ })).toBeTruthy();
    });

    it("hands a clicked dependent off to onNavigate", () => {
        const onNavigate = vi.fn();
        render(<ImpactView catalog={model} onExit={vi.fn()} onNavigate={onNavigate} initialKey={base.key} />);
        fireEvent.click(screen.getByText("Sibling"));
        expect(onNavigate).toHaveBeenCalledWith(sibling.key);
    });
});

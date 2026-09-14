//-----------------------------------------------------------------------
// Semantic Directory — component tests for the embedded impact panel.
//
// Guards the shared blast-radius rendering and the hand-off to the standalone
// Impact tool ("Open full impact analysis").
//-----------------------------------------------------------------------

import { describe, it, expect, afterEach, vi } from "vitest";
import { render, screen, cleanup, fireEvent } from "@testing-library/react";
import { ImpactPanel } from "./impact-panel";
import { catalog, meas } from "@/catalog/test-fixtures";

afterEach(cleanup);

const base = meas("Base", { usedByMeasures: ["wrap"] });
const wrap = meas("Wrap", {});
const lonely = meas("Lonely", {});
const model = catalog({ measures: [base, wrap, lonely] });

describe("ImpactPanel", () => {
    it("offers a cross-link to the full impact tool and fires it with the entity key", () => {
        const onOpenFull = vi.fn();
        render(<ImpactPanel catalog={model} entity={base} onNavigate={vi.fn()} onOpenFull={onOpenFull} />);
        fireEvent.click(screen.getByText("Open full impact analysis"));
        expect(onOpenFull).toHaveBeenCalledWith(base.key);
    });

    it("omits the cross-link when no hand-off is provided", () => {
        render(<ImpactPanel catalog={model} entity={base} onNavigate={vi.fn()} />);
        expect(screen.queryByText("Open full impact analysis")).toBeNull();
    });

    it("shows the safe-to-change state for an entity with no downstream", () => {
        render(<ImpactPanel catalog={model} entity={lonely} onNavigate={vi.fn()} onOpenFull={vi.fn()} />);
        expect(screen.getByText(/safe to change on its own/)).toBeTruthy();
        // No blast radius means no reason to jump to the full tool.
        expect(screen.queryByText("Open full impact analysis")).toBeNull();
    });
});

//-----------------------------------------------------------------------
// Semantic Directory — component tests for the Demo / Live status chip.
//
// Guards the three honest states: pure demo (no model configured),
// configured-but-showing-demo (model wired, running outside the Fabric
// embed), and live. The visible label is only Live/Demo; the tooltip +
// accessible name carry the nuance.
//-----------------------------------------------------------------------

import { describe, it, expect, afterEach } from "vitest";
import { render, screen, cleanup } from "@testing-library/react";
import { ModeChip } from "./mode-chip";

afterEach(cleanup);

describe("ModeChip", () => {
    it("shows Demo with a sample-model tooltip when no model is configured", () => {
        render(<ModeChip mode="demo" modelConfigured={false} />);
        const chip = screen.getByRole("img");
        expect(chip.textContent).toContain("Demo");
        expect(chip.getAttribute("title")).toMatch(/sample model/i);
        expect(chip.getAttribute("title")).toMatch(/connect your fabric/i);
    });

    it("shows Demo with a neutral 'showing sample data' tooltip when configured but not live", () => {
        render(<ModeChip mode="demo" modelConfigured modelName="Contoso Sales" />);
        const chip = screen.getByRole("img");
        expect(chip.textContent).toContain("Demo");
        expect(chip.getAttribute("title")).toMatch(/model configured/i);
        expect(chip.getAttribute("title")).toMatch(/showing sample data/i);
        // Cause-neutral: must NOT assert a single reason (it can be "not embedded"
        // OR "still introspecting" OR "unreachable"), so no "open in Fabric" claim.
        expect(chip.getAttribute("title")).not.toMatch(/open this app in the fabric portal/i);
    });

    it("shows Live and names the introspected model", () => {
        render(<ModeChip mode="live" modelConfigured modelName="Contoso Sales" />);
        const chip = screen.getByRole("img");
        expect(chip.textContent).toContain("Live");
        expect(chip.getAttribute("title")).toMatch(/live — introspecting contoso sales/i);
        expect(chip.getAttribute("aria-label")).toMatch(/^Live mode\./);
    });

    it("falls back to a generic model name in the live tooltip when none is given", () => {
        render(<ModeChip mode="live" modelConfigured />);
        const chip = screen.getByRole("img");
        expect(chip.getAttribute("title")).toMatch(/your semantic model/i);
    });
});

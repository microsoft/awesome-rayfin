import { useMemo } from "react";
import { VegaVisual, useCssTheme } from "@microsoft/fabric-visuals";
import type { VisualizationSpec } from "@microsoft/fabric-visuals";

import type { FacetSeries } from "./charts";

/**
 * The Vega-Lite implementation behind `<SmallMultiples>`.
 *
 * This is the only chart still drawn by Vega. The single-line charts moved to
 * plain SVG (see `line-chart.tsx`) because Vega's view lifecycle collapsed them
 * on re-layout; a fifteen-panel faceted grid is worth the dependency, and its
 * panels are a fixed width, so it never had that failure mode.
 *
 * House rules, all of them projector rules:
 * - **No tooltips.** Vega-Lite turns them on by default; nobody hovers a
 *   projector, and the demo spec rules them out. Every chart must read cold.
 * - Thick strokes and large tick labels, because thin marks disappear on a
 *   washed-out screen.
 * - Minimal gridlines and no legends where the surrounding copy already says
 *   what the series is.
 */

interface VegaChartsProps {
    kind: "facet";
    facets: FacetSeries[];
    label: string;
    height: number;
    columns?: number;
}

export default function VegaCharts({ facets, label, height, columns = 5 }: VegaChartsProps) {
    const theme = useCssTheme();

    const spec = useMemo<VisualizationSpec>(
        () => facetSpec(facets, height, columns),
        [facets, height, columns],
    );

    if (facets.length === 0) {
        return <div style={{ height }} aria-hidden />;
    }

    // A facet grid is as tall as its rows, not as one panel. Pinning it to a
    // single panel's height clips everything below the first row.
    return (
        <div
            role="img"
            aria-label={label}
            style={{ height: facetGridHeight(facets.length, columns, height) }}
        >
            <VegaVisual spec={spec} theme={theme} />
        </div>
    );
}

const NAVY = "#1B3658";

const CRITICAL = "#A11B14";

/** Room for every row of panels, each with its store name above it. */
const FACET_LABEL_HEIGHT = 26;
const FACET_ROW_GAP = 12;

function facetGridHeight(count: number, columns: number, panelHeight: number): number {
    const rows = Math.max(1, Math.ceil(count / columns));
    return rows * (panelHeight + FACET_LABEL_HEIGHT + FACET_ROW_GAP);
}

/**
 * Fifteen stores as small multiples, in one spec.
 *
 * Vega-Lite's `facet` draws every panel from a single dataset, so this is one
 * chart rather than fifteen — noticeably cheaper to mount when the modal opens.
 * Each panel keeps its own y scale (`resolve: independent`): the question a
 * manager is asking is "is this shop draining?", not "which shop holds most",
 * and a shared scale would flatten the small shops into nothing.
 */
function facetSpec(facets: FacetSeries[], height: number, columns: number): VisualizationSpec {
    const values = facets.flatMap((facet) =>
        facet.points.map((point) => ({
            store: facet.storeName,
            date: point.date,
            value: point.value,
            tone: facet.isCritical ? "critical" : "normal",
            weight: facet.isFocused ? 3.5 : 2,
        })),
    );

    return {
        $schema: "https://vega.github.io/schema/vega-lite/v5.json",
        data: { values },
        background: "transparent",
        columns,
        spacing: { row: FACET_ROW_GAP, column: 16 },
        facet: {
            field: "store",
            type: "nominal",
            title: null,
            header: {
                labelFontSize: 15,
                labelFontWeight: 600,
                labelColor: "#0F1F33",
                labelAnchor: "start",
                labelPadding: 4,
            },
            sort: facets.map((facet) => facet.storeName),
        },
        spec: {
            width: 150,
            height,
            view: { stroke: null },
            encoding: {
                x: { field: "date", type: "temporal", axis: null },
                y: { field: "value", type: "quantitative", axis: null, scale: { zero: true } },
            },
            layer: [
                {
                    mark: { type: "area", line: false, opacity: 0.12 },
                    encoding: {
                        color: {
                            field: "tone",
                            type: "nominal",
                            scale: { domain: ["critical", "normal"], range: [CRITICAL, NAVY] },
                            legend: null,
                        },
                    },
                },
                {
                    mark: { type: "line", strokeCap: "round" },
                    encoding: {
                        color: {
                            field: "tone",
                            type: "nominal",
                            scale: { domain: ["critical", "normal"], range: [CRITICAL, NAVY] },
                            legend: null,
                        },
                        strokeWidth: { field: "weight", type: "quantitative", legend: null },
                    },
                },
            ],
        },
        resolve: { scale: { y: "independent" } },
        config: { legend: { disable: true } },
    } as VisualizationSpec;
}

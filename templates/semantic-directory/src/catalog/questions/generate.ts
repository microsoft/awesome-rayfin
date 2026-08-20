//-----------------------------------------------------------------------
// Semantic Directory — auto-generated example questions.
//
// Users often don't know what the model can answer. For each measure we
// synthesize plain-English questions grounded in the REAL dimensions it can be
// sliced by (ranked, deterministic — see slice-recommender), and prepend any
// curated questions from enrichment. No AI.
//-----------------------------------------------------------------------

import type { CatalogModel, MeasureMeta } from "../model/types";
import { recommendSlices, type RankedSlice } from "../lineage/slice-recommender";
import { memoByCatalogKey } from "../memo";

function label(slice: RankedSlice): string {
    return slice.column.displayName || slice.column.name;
}

/**
 * Build up to `max` example questions for a measure. Curated questions (from
 * enrichment) come first, then questions generated from the top-ranked real
 * dimensions this measure can be sliced by.
 */
export const questionsForMeasure = memoByCatalogKey(
    (
        catalog: CatalogModel,
        measure: MeasureMeta,
        max: number = 6,
    ): string[] => {
        const name = measure.displayName || measure.name;
        const questions: string[] = [...measure.exampleQuestions];

        const rec = recommendSlices(catalog, measure, 6);
        const time = rec.primaryTime;
        const picks = rec.top;

        const generated: string[] = [];
        if (time) {
            generated.push(`How has ${name} trended over ${label(time)}?`);
        }
        for (const d of picks) {
            if (time && d.column.key === time.column.key) continue;
            generated.push(`What is ${name} by ${label(d)}?`);
            generated.push(`Which ${label(d)} has the highest ${name}?`);
        }

        for (const q of generated) {
            if (questions.length >= max) break;
            if (!questions.includes(q)) questions.push(q);
        }
        return questions.slice(0, max);
    },
    (measure: MeasureMeta, max: number = 6) => `${measure.key}::${max}`,
);

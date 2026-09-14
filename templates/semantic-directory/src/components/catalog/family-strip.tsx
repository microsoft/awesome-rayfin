//-----------------------------------------------------------------------
// Semantic Directory — measure "family" relatives strip.
//
// Pillar 2 (Measure Families): a measure is rarely alone — it's one variant in
// a family (Actuals / Target / YoY / QTD / vs Budget …). Landing on one, a
// user instantly sees the whole family and can jump between variants.
// Families are clustered deterministically (see model/families).
//-----------------------------------------------------------------------

import { m } from "framer-motion";
import { Users } from "lucide-react";
import type { CatalogModel, MeasureMeta } from "@/catalog/model/types";
import { normName } from "@/catalog/model/types";
import { chipPop, listContainer } from "@/lib/motion";
import { Section, Pill } from "./panel-ui";

export function FamilyStrip({
    catalog,
    measure,
    onSelectMeasure,
}: {
    catalog: CatalogModel;
    measure: MeasureMeta;
    onSelectMeasure: (key: string) => void;
}) {
    if (!measure.familyId) return null;
    const family = catalog.families?.find((f) => f.id === measure.familyId);
    if (!family || family.members.length <= 1) return null;

    const keyByNorm = new Map(catalog.measures.map((mm) => [normName(mm.name), mm.key]));
    const siblings = family.members
        .map((name) => ({ name, key: keyByNorm.get(normName(name)) }))
        .filter((s) => s.key && s.key !== measure.key);

    return (
        <Section
            title="Part of a family"
            hint={`${family.name} · ${family.members.length} variants`}
        >
            <div className="mb-s flex items-center gap-xs text-100 text-muted-foreground">
                <Users className="icon-size-100" strokeWidth={2} aria-hidden />
                Same measure, different lens — jump to a sibling variant.
            </div>
            <m.div variants={listContainer} initial="hidden" animate="show" className="flex flex-wrap gap-s">
                {siblings.map((s) => (
                    <m.div key={s.key} variants={chipPop}>
                        <Pill tone="measure" onClick={() => onSelectMeasure(s.key!)}>
                            {s.name}
                        </Pill>
                    </m.div>
                ))}
            </m.div>
        </Section>
    );
}

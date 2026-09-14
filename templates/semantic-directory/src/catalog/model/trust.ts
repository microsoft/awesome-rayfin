//-----------------------------------------------------------------------
// Semantic Directory — trust layer.
//
// Turns the catalog's operational evidence (source freshness + automated
// source→model reconciliation pass rates) into a per-system, per-table and
// per-measure trust signal the UI can badge everywhere.
//
//   freshness  → when did each source last load; is it stale for its cadence
//   qaTieOut   → how often each source ties out to the model (some sources fail
//                a meaningful share of runs → "watch"; clean sources → "high")
//
// A measure inherits the WEAKEST trust across the source systems it draws on
// (users should see the worst-case, not an average).
//-----------------------------------------------------------------------

import type {
    BundleFreshness,
    BundleQaTieOut,
} from "../data/types";
import type { MeasureMeta, SourceSystem, TableMeta, TrustSignal } from "./types";

export interface SystemTrust {
    freshestAt?: string;
    stalestAt?: string;
    hasStaleSource: boolean;
    qaPassRate?: number;
}

/** Aggregate freshness + QA into a per-source-system trust map (by system id). */
export function buildSystemTrust(
    freshness: BundleFreshness[],
    qaTieOut: BundleQaTieOut[],
): Map<string, SystemTrust> {
    const map = new Map<string, SystemTrust>();

    for (const f of freshness) {
        const cur = map.get(f.system) ?? { hasStaleSource: false };
        if (!cur.freshestAt || f.latest > cur.freshestAt) cur.freshestAt = f.latest;
        if (!cur.stalestAt || f.latest < cur.stalestAt) cur.stalestAt = f.latest;
        if (f.status === "stale") cur.hasStaleSource = true;
        map.set(f.system, cur);
    }

    // Aggregate QA pass rates by system (sum passed/failed across areas).
    const qaAgg = new Map<string, { passed: number; failed: number }>();
    for (const q of qaTieOut) {
        const cur = qaAgg.get(q.system) ?? { passed: 0, failed: 0 };
        cur.passed += q.passed;
        cur.failed += q.failed;
        qaAgg.set(q.system, cur);
    }
    for (const [system, agg] of qaAgg) {
        const total = agg.passed + agg.failed;
        if (total === 0) continue;
        const cur = map.get(system) ?? { hasStaleSource: false };
        cur.qaPassRate = agg.passed / total;
        map.set(system, cur);
    }

    return map;
}

/** Band a single system's evidence into a trust level. */
function bandSystem(t: SystemTrust): TrustSignal {
    let level: TrustSignal["level"] = "unknown";
    const notes: string[] = [];

    if (t.qaPassRate != null) {
        if (t.qaPassRate >= 0.98) level = "high";
        else if (t.qaPassRate >= 0.8) level = "watch";
        else level = "low";
        notes.push(`${Math.round(t.qaPassRate * 100)}% source tie-out`);
    } else {
        level = "high"; // no QA signal against it, but it does load
    }

    if (t.hasStaleSource) {
        notes.push("point-in-time snapshot source");
        if (level === "high") level = "watch";
    }

    return {
        freshestAt: t.freshestAt,
        stalestAt: t.stalestAt,
        hasStaleSource: t.hasStaleSource,
        qaPassRate: t.qaPassRate,
        level,
        note: notes.join(" · ") || undefined,
    };
}

/** Combine several systems into the WEAKEST-wins trust signal. */
function combineWeakest(signals: TrustSignal[]): TrustSignal {
    if (signals.length === 0) {
        return { hasStaleSource: false, level: "unknown" };
    }
    const rank: Record<TrustSignal["level"], number> = {
        low: 0, watch: 1, high: 2, unknown: 3,
    };
    let weakest = signals[0];
    for (const s of signals) {
        if (rank[s.level] < rank[weakest.level]) weakest = s;
    }
    const rates = signals.map((s) => s.qaPassRate).filter((r): r is number => r != null);
    const freshest = signals.map((s) => s.freshestAt).filter(Boolean).sort().at(-1);
    const stalest = signals.map((s) => s.stalestAt).filter(Boolean).sort()[0];
    return {
        freshestAt: freshest,
        stalestAt: stalest,
        hasStaleSource: signals.some((s) => s.hasStaleSource),
        qaPassRate: rates.length ? Math.min(...rates) : undefined,
        level: weakest.level,
        note: weakest.note,
    };
}

/**
 * Apply trust to tables, measures and source systems. Mutates the entities and
 * enriches the SourceSystem list with freshness/QA rollups + counts.
 */
export function applyTrust(
    measures: MeasureMeta[],
    tables: TableMeta[],
    sourceSystems: SourceSystem[],
    systemTrust: Map<string, SystemTrust>,
): void {
    const bandBySystem = new Map<string, TrustSignal>();
    for (const [id, t] of systemTrust) bandBySystem.set(id, bandSystem(t));

    // Tables
    for (const t of tables) {
        if (t.sourceSystem) t.trust = bandBySystem.get(t.sourceSystem);
    }

    // Measures: weakest across their source systems
    for (const m of measures) {
        const signals = (m.sourceSystems ?? [])
            .map((s) => bandBySystem.get(s))
            .filter((s): s is TrustSignal => !!s);
        m.trust = combineWeakest(signals);
    }

    // Source systems: attach rollups + counts
    const tableCount = new Map<string, number>();
    for (const t of tables) {
        if (t.sourceSystem) tableCount.set(t.sourceSystem, (tableCount.get(t.sourceSystem) ?? 0) + 1);
    }
    const measureCount = new Map<string, number>();
    for (const m of measures) {
        for (const s of m.sourceSystems ?? []) {
            measureCount.set(s, (measureCount.get(s) ?? 0) + 1);
        }
    }
    for (const ss of sourceSystems) {
        const t = systemTrust.get(ss.id);
        ss.tableCount = tableCount.get(ss.id) ?? 0;
        ss.measureCount = measureCount.get(ss.id) ?? 0;
        ss.freshestAt = t?.freshestAt;
        ss.stalestAt = t?.stalestAt;
        ss.qaPassRate = t?.qaPassRate;
    }
}

//-----------------------------------------------------------------------
// Semantic Directory — landing suggestions (starter chips + domains).
//
// The calm landing must never be a blank search box. This hook derives, purely
// from the catalog brain (so it tracks schema changes), two guided entry
// points for users who don't yet know the vocabulary:
//   • starters — a few high-value, close-verified measures to click straight in
//   • domains  — the biggest business areas, to browse like a menu
// Deterministic, no AI, no hardcoded measure names.
//-----------------------------------------------------------------------

import { useMemo } from "react";
import type { CatalogModel } from "@/catalog/model/types";

export interface StarterChip {
    /** The measure key, so a click can open its glance card directly. */
    key: string;
    label: string;
    emoji?: string;
}

export interface DomainCard {
    topic: string;
    /** Non-hidden measure count in this topic. */
    count: number;
    emoji?: string;
}

export interface LandingSuggestions {
    starters: StarterChip[];
    domains: DomainCard[];
}

export function useExampleChips(
    catalog: CatalogModel | undefined,
    { starterCount = 5, domainCount = 6 } = {},
): LandingSuggestions {
    return useMemo(() => {
        if (!catalog) return { starters: [], domains: [] };

        const visible = catalog.measures.filter((m) => !m.isHidden);

        // Starters: prefer high-trust measures (the trust payoff), then
        // anything with a description.
        const scored = visible
            .map((m) => {
                let score = 0;
                if (m.trust?.level === "high") score += 10;
                if (m.description) score += 1;
                return { m, score };
            })
            .filter((x) => x.score > 0)
            .sort((a, b) => b.score - a.score || a.m.displayName.localeCompare(b.m.displayName));

        const starters: StarterChip[] = scored
            .slice(0, starterCount)
            .map(({ m }) => ({ key: m.key, label: m.displayName, emoji: m.emoji }));

        // Domains: business topics ranked by how many measures live in them.
        const byTopic = new Map<string, { count: number; emoji?: string }>();
        for (const m of visible) {
            const topic = m.topic?.trim();
            if (!topic) continue;
            const prev = byTopic.get(topic);
            if (prev) prev.count += 1;
            else byTopic.set(topic, { count: 1, emoji: m.emoji });
        }
        const domains: DomainCard[] = [...byTopic.entries()]
            .map(([topic, v]) => ({ topic, count: v.count, emoji: v.emoji }))
            .sort((a, b) => b.count - a.count || a.topic.localeCompare(b.topic))
            .slice(0, domainCount);

        return { starters, domains };
    }, [catalog, starterCount, domainCount]);
}

import { useMemo } from "react";

import { NUMBER_LOCALE } from "@/i18n";

/**
 * Numbers and dates in one consistent locale. The original screens used `toFixed(1)` and a bare
 * `toLocaleString()`, which depend on the browser's locale; every figure goes through here instead
 * (the twin's NO TYPED NUMBERS rule).
 */
export function useFormat() {
    return useMemo(() => {
        const tag = NUMBER_LOCALE;
        const int = new Intl.NumberFormat(tag, { maximumFractionDigits: 0 });
        const dec1 = new Intl.NumberFormat(tag, { minimumFractionDigits: 1, maximumFractionDigits: 1 });
        const day = new Intl.DateTimeFormat(tag, { day: "numeric", month: "short", year: "numeric", timeZone: "UTC" });
        const when = new Intl.DateTimeFormat(tag, { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" });
        return {
            int: (n: number) => int.format(n),
            dec1: (n: number) => dec1.format(n),
            /** A model date (UTC midnight), so it never slips a day in a western time zone. */
            day: (d: Date) => (Number.isNaN(d.getTime()) ? "" : day.format(d)),
            /** A moment, in the reader's local time. */
            when: (d: Date) => (Number.isNaN(d.getTime()) ? "" : when.format(d)),
        };
    }, []);
}

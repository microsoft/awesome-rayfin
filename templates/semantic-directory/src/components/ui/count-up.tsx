//-----------------------------------------------------------------------
// Semantic Directory — animated number counter.
//
// Counts up to a target value using a motion value so numbers feel alive on
// mount / data refresh. Honors prefers-reduced-motion by snapping instantly.
//-----------------------------------------------------------------------

import { useEffect } from "react";
import {
    useMotionValue,
    useTransform,
    animate,
    useReducedMotion,
    m,
} from "framer-motion";
import { dur, ease } from "@/lib/motion";

interface CountUpProps {
    value: number;
    /** Decimal places to render. */
    decimals?: number;
    /** Optional suffix (e.g. "%"). */
    suffix?: string;
    className?: string;
}

export function CountUp({ value, decimals = 0, suffix = "", className }: CountUpProps) {
    const reduce = useReducedMotion();
    const mv = useMotionValue(0);
    const text = useTransform(mv, (v) =>
        `${v.toLocaleString(undefined, {
            minimumFractionDigits: decimals,
            maximumFractionDigits: decimals,
        })}${suffix}`,
    );

    useEffect(() => {
        if (reduce) {
            mv.set(value);
            return;
        }
        const controls = animate(mv, value, { duration: dur[4], ease: ease.outQuint });
        return () => controls.stop();
    }, [value, reduce, mv]);

    return <m.span className={className}>{text}</m.span>;
}

//-----------------------------------------------------------------------
// Semantic Directory — landing ambient backdrop ("the frontier of data").
//
// A purely decorative, deterministic depth layer behind the hero: a dotted
// "frontier" grid faded by a radial mask, plus a few slow-drifting green/cyan
// aurora blobs. Adds atmosphere without carrying meaning. Honors reduced
// motion (blobs hold still) and never intercepts pointer events.
//-----------------------------------------------------------------------

import { m, useReducedMotion } from "framer-motion";

const BLOBS = [
    {
        className: "left-1/2 top-[6%] h-[42rem] w-[42rem] -translate-x-1/2",
        color: "var(--color-primary)",
        mix: 30,
        drift: { scale: [1, 1.12, 1], opacity: [0.5, 0.78, 0.5] },
        duration: 15,
        delay: 0,
    },
    {
        className: "right-[4%] top-[26%] h-[26rem] w-[26rem]",
        color: "#0ea5e9",
        mix: 20,
        drift: { scale: [1, 1.18, 1], opacity: [0.32, 0.58, 0.32] },
        duration: 19,
        delay: 1.6,
    },
    {
        className: "left-[6%] top-[44%] h-[22rem] w-[22rem]",
        color: "var(--color-primary)",
        mix: 22,
        drift: { scale: [1, 1.14, 1], opacity: [0.28, 0.5, 0.28] },
        duration: 17,
        delay: 3.1,
    },
];

export function LandingAurora() {
    const reduce = useReducedMotion();

    return (
        <div aria-hidden className="pointer-events-none absolute inset-0 overflow-hidden">
            {/* Dotted frontier grid, faded toward the edges by a radial mask. */}
            <div
                className="absolute inset-0 opacity-60"
                style={{
                    backgroundImage:
                        "radial-gradient(color-mix(in oklab, var(--color-primary) 24%, transparent) 1px, transparent 1.4px)",
                    backgroundSize: "26px 26px",
                    maskImage: "radial-gradient(72% 58% at 50% 30%, #000 0%, transparent 80%)",
                    WebkitMaskImage: "radial-gradient(72% 58% at 50% 30%, #000 0%, transparent 80%)",
                }}
            />

            {/* Drifting aurora blobs. */}
            {BLOBS.map((b, i) => (
                <m.div
                    key={i}
                    className={`absolute rounded-full blur-[100px] ${b.className}`}
                    style={{
                        background: `radial-gradient(circle, color-mix(in oklab, ${b.color} ${b.mix}%, transparent), transparent 62%)`,
                    }}
                    animate={reduce ? undefined : b.drift}
                    transition={{ duration: b.duration, delay: b.delay, repeat: Infinity, ease: "easeInOut" }}
                />
            ))}
        </div>
    );
}

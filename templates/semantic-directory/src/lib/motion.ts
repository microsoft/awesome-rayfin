//-----------------------------------------------------------------------
// Semantic Directory — shared motion vocabulary.
//
// A tiny, consistent set of eases, durations and variants used across the app
// so every entrance/press/reveal feels like one product. Consumed via the
// `m.*` components under the <LazyMotion> provider in main.tsx.
//-----------------------------------------------------------------------

import type { Variants, Transition } from "framer-motion";

export const ease = {
    outQuint: [0.22, 1, 0.36, 1] as const,
    spring: [0.34, 1.56, 0.64, 1] as const,
    standard: [0.4, 0, 0.2, 1] as const,
};

export const dur = { 1: 0.12, 2: 0.2, 3: 0.32, 4: 0.48 } as const;

export const spring: Transition = { type: "spring", stiffness: 420, damping: 30 };

/**
 * Snappy press spring — reacts instantly to a pointer, then springs back.
 * This is what makes a control feel physical: the tap-down is near-immediate
 * and the release settles with a tiny bit of bounce. Reused by every tactile
 * preset so the whole app presses with one hand.
 */
export const pressSpring: Transition = { type: "spring", stiffness: 600, damping: 26, mass: 0.5 };

/**
 * Tactile gesture presets. Spread onto any interactive `m.*` element (or use
 * the <Pressable> primitive) so hover/press feedback is consistent everywhere.
 * Kept deliberately subtle per our motion principles — a physical response to
 * input, never a flourish. Reduced-motion users opt out globally via MotionConfig.
 */

/** Default control — chips, pills, small buttons. */
export const tap = { whileHover: { y: -1 }, whileTap: { scale: 0.97 }, transition: pressSpring } as const;

/** Large surface — full-width rows, cards, tiles. Less scale, a touch more lift. */
export const tapCard = { whileHover: { y: -2 }, whileTap: { scale: 0.985 }, transition: pressSpring } as const;

/** Icon-only button — no lift, a slightly larger even scale so it reads at size. */
export const tapIcon = { whileHover: { scale: 1.06 }, whileTap: { scale: 0.9 }, transition: pressSpring } as const;

/** Diagram node — floats in a constellation; scales in place on hover/press. */
export const tapNode = { whileHover: { scale: 1.06 }, whileTap: { scale: 0.94 }, transition: pressSpring } as const;

/** Fade + rise — the default entrance for headers, cards, sections. */
export const fadeUp: Variants = {
    hidden: { opacity: 0, y: 10 },
    show: { opacity: 1, y: 0, transition: { duration: dur[3], ease: ease.outQuint } },
};

/**
 * Macro view transition — a whole page/region swapping (landing↔workspace,
 * tool open/close). A quick rise-in, a quicker fall-out, so switching views
 * feels like a soft hand-off rather than a hard cut. Use inside an
 * <AnimatePresence mode="wait">; reduced-motion users opt out globally.
 */
export const viewFade: Variants = {
    hidden: { opacity: 0, y: 8 },
    show: { opacity: 1, y: 0, transition: { duration: dur[2], ease: ease.outQuint } },
    exit: { opacity: 0, y: -6, transition: { duration: dur[1], ease: ease.standard } },
};

/** Container that staggers its children on mount. */
export const listContainer: Variants = {
    hidden: {},
    show: { transition: { staggerChildren: 0.035, delayChildren: 0.04 } },
};

/** Detail panel "printing" reveal — slides in and staggers its sections. */
export const panelReveal: Variants = {
    hidden: { opacity: 0, x: 14 },
    show: {
        opacity: 1,
        x: 0,
        transition: {
            duration: dur[3],
            ease: ease.outQuint,
            when: "beforeChildren",
            staggerChildren: 0.05,
        },
    },
    exit: { opacity: 0, x: 8, transition: { duration: dur[2], ease: ease.standard } },
};

/** Individual section inside a revealing panel. */
export const sectionReveal: Variants = {
    hidden: { opacity: 0, y: 8 },
    show: { opacity: 1, y: 0, transition: { duration: dur[3], ease: ease.outQuint } },
};

/** Chip / pill pop-in. */
export const chipPop: Variants = {
    hidden: { opacity: 0, scale: 0.9 },
    show: { opacity: 1, scale: 1, transition: { duration: dur[2], ease: ease.spring } },
};

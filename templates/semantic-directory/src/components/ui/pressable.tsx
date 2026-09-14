//-----------------------------------------------------------------------
// Semantic Directory — Pressable button primitive.
//
// A drop-in <button> that presses. Bundles the shared tactile gesture presets
// (hover lift + tap scale + snappy press spring) so every plain button in the
// app responds physically to a pointer without repeating motion wiring. Picks a
// preset via `variant`; forwards every native/motion prop so it stays a button.
// Reduced-motion is honored globally by <MotionConfig>, and gestures drop out
// entirely when disabled.
//-----------------------------------------------------------------------

import { forwardRef } from "react";
import { m, type HTMLMotionProps } from "framer-motion";

import { tap, tapCard, tapIcon } from "@/lib/motion";

const PRESETS = { control: tap, card: tapCard, icon: tapIcon } as const;

type PressableProps = HTMLMotionProps<"button"> & {
    /** Tactile scale of the surface. Defaults to a small "control". */
    variant?: keyof typeof PRESETS;
    /**
     * When false, renders with no tactile gestures — for a current/selected
     * state that is deliberately a no-op (so it doesn't advertise "pressable").
     * Unlike `disabled`, it keeps normal focus and tab-order semantics.
     */
    interactive?: boolean;
};

export const Pressable = forwardRef<HTMLButtonElement, PressableProps>(
    function Pressable({ variant = "control", type = "button", disabled, interactive = true, ...rest }, ref) {
        // No hover/press feedback when the control can't be actioned.
        const gestures = disabled || !interactive ? {} : PRESETS[variant];
        return <m.button ref={ref} type={type} disabled={disabled} {...gestures} {...rest} />;
    },
);

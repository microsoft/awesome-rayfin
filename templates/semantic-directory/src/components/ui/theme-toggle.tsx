//-----------------------------------------------------------------------
// Semantic Directory — theme toggle (Light / Dark / Auto).
//
// A compact segmented control with a sliding accent-green indicator. Persists an
// explicit user choice; "Auto" follows the Fabric host / OS appearance.
//-----------------------------------------------------------------------

import { useId } from "react";
import { Sun, Moon, MonitorSmartphone } from "lucide-react";
import { m } from "framer-motion";
import { pressSpring } from "@/lib/motion";
import { useThemeContext } from "@/hooks/theme.context";
import type { ThemePreference } from "@/hooks/use-theme";

const OPTIONS: { id: ThemePreference; label: string; Icon: typeof Sun }[] = [
    { id: "light", label: "Light", Icon: Sun },
    { id: "dark", label: "Dark", Icon: Moon },
    { id: "system", label: "Auto", Icon: MonitorSmartphone },
];

export function ThemeToggle() {
    const { preference, setPreference } = useThemeContext();
    // Scope the sliding-pill layoutId to this instance. The landing and top-bar
    // toggles are both mounted during the popLayout crossfade, so a shared global
    // id would make framer animate one pill between the two toggles' positions.
    const pillId = useId();

    return (
        <div
            role="radiogroup"
            aria-label="Color theme"
            className="glass inline-flex items-center gap-xxs rounded-full p-xxs shadow-[var(--e1)]"
        >
            {OPTIONS.map(({ id, label, Icon }) => {
                const active = preference === id;
                return (
                    <m.button
                        key={id}
                        type="button"
                        role="radio"
                        aria-checked={active}
                        aria-label={label}
                        title={`${label} theme`}
                        onClick={() => setPreference(id)}
                        whileTap={{ scale: 0.94 }}
                        transition={pressSpring}
                        className={`relative inline-flex items-center gap-xs rounded-full px-m py-xs text-200 font-medium transition-colors ${
                            active ? "text-primary-foreground" : "text-muted-foreground hover:text-foreground"
                        }`}
                    >
                        {active ? (
                            <m.span
                                layoutId={`theme-pill-${pillId}`}
                                transition={{ type: "spring", stiffness: 480, damping: 34 }}
                                className="absolute inset-0 rounded-full bg-primary shadow-[var(--glow)]"
                            />
                        ) : null}
                        <Icon className="relative icon-size-200" strokeWidth={1.75} />
                        <span className="relative hidden sm:inline">{label}</span>
                    </m.button>
                );
            })}
        </div>
    );
}

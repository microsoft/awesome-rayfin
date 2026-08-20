//-----------------------------------------------------------------------
// Semantic Directory — shared shell for the full-screen analysis tools.
//
// Model health and Path finder are opened over the catalog as focused,
// single-purpose views. They share one frame so they feel like one product and
// so real estate is consistent: a Back affordance, an icon + title + subtitle,
// an optional right-aligned header action slot, an optional full-width toolbar,
// and a single scroll region whose content is centred to a readable measure
// (per-tool, since a wide relationship chain needs more room than a scorecard).
//
// Contract only — no tool-specific layout lives here. The shell also owns the
// a11y entrance: on open it moves focus to the tool heading so keyboard and
// screen-reader users land inside the new view, not back at the top of the app.
//-----------------------------------------------------------------------

import { useEffect, useRef, type ReactNode } from "react";
import { m } from "framer-motion";
import { ArrowLeft } from "lucide-react";
import { fadeUp } from "@/lib/motion";
import { Pressable } from "@/components/ui/pressable";

export function ToolShell({
    icon,
    title,
    subtitle,
    onExit,
    headerActions,
    toolbar,
    /** Tailwind max-width for the scrolling content column. */
    maxWidthClass = "max-w-4xl",
    children,
}: {
    icon: ReactNode;
    title: string;
    subtitle: string;
    onExit: () => void;
    headerActions?: ReactNode;
    toolbar?: ReactNode;
    maxWidthClass?: string;
    children: ReactNode;
}) {
    // Move focus into the tool on open so keyboard/AT users are placed inside
    // the new view. The heading is the natural landing target.
    const headingRef = useRef<HTMLHeadingElement>(null);
    useEffect(() => {
        headingRef.current?.focus();
    }, []);

    return (
        <m.section
            variants={fadeUp}
            initial="hidden"
            animate="show"
            aria-label={title}
            className="flex h-full min-h-0 flex-col gap-l"
        >
            <header className="flex items-center gap-m">
                <Pressable
                    onClick={onExit}
                    className="inline-flex items-center gap-xs rounded-full border border-border bg-card px-m py-xs text-200 font-medium text-foreground hover:bg-accent"
                >
                    <ArrowLeft className="icon-size-100" strokeWidth={2} aria-hidden /> Back
                </Pressable>
                <div className="flex min-w-0 items-center gap-s">
                    <span
                        aria-hidden
                        className="grid size-9 shrink-0 place-items-center rounded-xl bg-primary/12 text-primary shadow-[var(--glow)]"
                    >
                        {icon}
                    </span>
                    <div className="min-w-0">
                        <h2
                            ref={headingRef}
                            tabIndex={-1}
                            className="text-500 font-semibold leading-500 text-foreground outline-none focus-visible:shadow-none"
                        >
                            {title}
                        </h2>
                        <p className="truncate text-100 text-muted-foreground">{subtitle}</p>
                    </div>
                </div>
                {headerActions ? (
                    <div className="ml-auto flex shrink-0 items-center gap-s">{headerActions}</div>
                ) : null}
            </header>

            {toolbar ? <div className={`mx-auto w-full ${maxWidthClass}`}>{toolbar}</div> : null}

            <div className="min-h-0 flex-1 overflow-y-auto pr-xs">
                <div className={`mx-auto w-full ${maxWidthClass}`}>{children}</div>
            </div>
        </m.section>
    );
}

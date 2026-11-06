import logoUrl from "@/assets/caldova-logo.svg";
import { useAuth } from "@/hooks/auth.context";
import { useDemoReset } from "@/hooks/use-demo-reset";
import { DemoResetPanel } from "@/components/demo-reset.component";
import type { ClearedReorder } from "@/hooks/pending-reorders.context";

interface AppHeaderProps {
    /** The model's own notion of "now", so the screen states what it is showing. */
    asOf: Date | null;
    region: string | null;
    /** Hands back what the reset removed, so the screen can stop showing it. */
    onReset: (cleared: ClearedReorder[]) => void;
}

/**
 * The top bar.
 *
 * Enterprise software always answers two questions before anything else: who am
 * I signed in as, and how current is this? Both live here.
 */
export function AppHeader({ asOf, region, onReset }: AppHeaderProps) {
    const { session } = useAuth();
    const email = session?.user?.email ?? null;
    const reset = useDemoReset({ onReset });

    return (
        <header className="border-b border-border-strong bg-card">
            <div className="mx-auto flex max-w-[1680px] items-center gap-500 px-800 py-300">
                {/* Double-click opens the demo reset. Unlabelled on purpose — see
                    `demo-reset.component.tsx`. */}
                <div className="relative">
                    <img
                        src={logoUrl}
                        alt="Caldova"
                        onDoubleClick={reset.open}
                        className="h-[26px] w-auto select-none"
                    />
                    <DemoResetPanel reset={reset} />
                </div>

                <span className="h-[28px] w-px bg-border-strong" aria-hidden />

                <div className="min-w-0">
                    <p className="text-500 leading-500 font-semibold text-foreground">Restock</p>
                    <p className="text-400 leading-400 text-muted-foreground">
                        {region ? `${region} region` : "Your region"}
                    </p>
                </div>

                <div className="ml-auto flex items-center gap-600">
                    <div className="text-right">
                        <p className="text-400 leading-400 text-muted-foreground">Data as of</p>
                        <p className="text-400 leading-400 font-semibold text-foreground">
                            {asOf ? formatAsOf(asOf) : "—"}
                        </p>
                    </div>

                    {email && (
                        <div className="flex items-center gap-300">
                            <span
                                aria-hidden
                                className="flex h-[40px] w-[40px] items-center justify-center rounded-full bg-primary text-400 font-bold text-primary-foreground"
                            >
                                {initials(email)}
                            </span>
                            <span className="text-400 leading-400 text-foreground">{email}</span>
                        </div>
                    )}
                </div>
            </div>
        </header>
    );
}

function formatAsOf(date: Date): string {
    if (Number.isNaN(date.getTime())) return "—";

    return date.toLocaleDateString(undefined, {
        day: "numeric",
        month: "short",
        year: "numeric",
    });
}

function initials(email: string): string {
    const [local] = email.split("@");
    const parts = local.split(/[._-]+/).filter(Boolean);

    if (parts.length >= 2) {
        return (parts[0][0] + parts[1][0]).toUpperCase();
    }

    return local.slice(0, 2).toUpperCase();
}

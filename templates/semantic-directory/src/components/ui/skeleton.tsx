//-----------------------------------------------------------------------
// Semantic Directory — skeleton loaders.
//
// Shimmering placeholders that keep the layout stable while live data loads,
// replacing bare spinners. The `.skeleton` shimmer + reduced-motion handling
// live in global.css.
//-----------------------------------------------------------------------

interface SkeletonProps {
    className?: string;
}

export function Skeleton({ className = "" }: SkeletonProps) {
    return <span className={`skeleton block ${className}`} aria-hidden />;
}

/** A stack of skeleton result rows for the browse/search list. */
export function SkeletonRows({ count = 8 }: { count?: number }) {
    return (
        <div className="flex flex-col gap-xs" aria-hidden>
            {Array.from({ length: count }).map((_, i) => (
                <div
                    key={i}
                    className="flex items-center gap-m rounded-xl border border-border bg-card p-m"
                    style={{ opacity: 1 - i * 0.06 }}
                >
                    <Skeleton className="h-8 w-8 rounded-lg" />
                    <div className="flex-1">
                        <Skeleton className="h-3.5 w-1/2 rounded-md" />
                        <Skeleton className="mt-2 h-2.5 w-1/3 rounded-md" />
                    </div>
                </div>
            ))}
        </div>
    );
}

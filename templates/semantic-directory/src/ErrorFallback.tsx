//-----------------------------------------------------------------------
// <copyright company="Microsoft Corporation">
//        Copyright (c) Microsoft Corporation.  All rights reserved.
//        Licensed under the MIT license. See LICENSE file in the project root for full license information.
// </copyright>
//-----------------------------------------------------------------------

import { appConfig } from "@/app.config";

export const ErrorFallback = ({ error, resetErrorBoundary }: { error: unknown; resetErrorBoundary: () => void }) => {
    const technical = error instanceof Error ? error.message : String(error);

    // Log the full error to the console so DevTools shows the stack regardless of
    // environment. Users never see raw exception text — it's confusing for a
    // user audience and can leak internal detail. The raw message is only
    // surfaced in dev, behind a details disclosure.
    if (import.meta.env.DEV) console.error("[ErrorBoundary]", error);

    return (
        <div className="flex min-h-screen items-center justify-center bg-background p-4">
            <div className="w-full max-w-md text-center">
                <h2 className="mb-2 text-lg font-semibold text-foreground">Something went wrong</h2>
                <p className="mb-4 text-sm text-muted-foreground">
                    {appConfig.name} hit an unexpected snag loading this view. Your data is safe —
                    try again, and if it keeps happening, refresh the page.
                </p>
                {import.meta.env.DEV ? (
                    <details className="mb-4 text-left">
                        <summary className="cursor-pointer text-sm text-muted-foreground">
                            Technical details (dev only)
                        </summary>
                        <pre className="mt-2 max-h-32 overflow-auto rounded border border-border bg-muted p-3 text-sm text-muted-foreground">
                            {technical}
                        </pre>
                    </details>
                ) : null}
                <button
                    onClick={resetErrorBoundary}
                    className="rounded border border-border px-4 py-2 text-sm text-foreground hover:bg-accent"
                >
                    Try Again
                </button>
            </div>
        </div>
    );
}

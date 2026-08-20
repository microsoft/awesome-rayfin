//-----------------------------------------------------------------------
// Semantic Directory — demo-data banner.
//
// A slim, honest strip shown while the app is running on the bundled demo
// dataset (no live model configured yet). It disappears automatically once a
// real workspace + semantic model is connected and introspected. Copy comes
// from app.config so adopters can reword it in one place.
//-----------------------------------------------------------------------

import { Info } from "lucide-react";
import { appConfig } from "@/app.config";

export function DemoBanner() {
    return (
        <div
            role="status"
            className="demo-strip flex items-center justify-center gap-s px-l py-xs text-100 text-foreground"
        >
            <Info className="icon-size-100 shrink-0 text-primary" strokeWidth={2} aria-hidden />
            <span>
                <span className="font-semibold text-primary">{appConfig.demoBanner.title}</span>
                <span className="mx-xs text-muted-foreground" aria-hidden>
                    ·
                </span>
                <span className="text-muted-foreground">{appConfig.demoBanner.body}</span>
            </span>
        </div>
    );
}

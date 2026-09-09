//-----------------------------------------------------------------------
// Semantic Directory — copy-link button.
//
// Copies the current deep-link URL (hash-encoded view state: query, filter,
// selected entity, open tool) so a steward can share the exact view they're
// looking at. Shows a brief "Copied" confirmation, with a graceful fallback
// when the async clipboard API is unavailable.
//-----------------------------------------------------------------------

import { useEffect, useRef, useState } from "react";
import { Check, Link2 } from "lucide-react";
import { Pressable } from "@/components/ui/pressable";

async function copyText(text: string): Promise<boolean> {
    try {
        if (navigator.clipboard?.writeText) {
            await navigator.clipboard.writeText(text);
            return true;
        }
    } catch {
        // fall through to the legacy path
    }
    try {
        const ta = document.createElement("textarea");
        ta.value = text;
        ta.style.position = "fixed";
        ta.style.opacity = "0";
        document.body.appendChild(ta);
        ta.select();
        const ok = document.execCommand("copy");
        ta.remove();
        return ok;
    } catch {
        return false;
    }
}

export function CopyLinkButton() {
    const [copied, setCopied] = useState(false);
    const timer = useRef<number | null>(null);

    useEffect(
        () => () => {
            if (timer.current) window.clearTimeout(timer.current);
        },
        [],
    );

    const onClick = async () => {
        const ok = await copyText(window.location.href);
        if (!ok) return;
        setCopied(true);
        if (timer.current) window.clearTimeout(timer.current);
        timer.current = window.setTimeout(() => setCopied(false), 1600);
    };

    return (
        <Pressable
            onClick={onClick}
            aria-label={copied ? "Link copied" : "Copy link to this view"}
            className="inline-flex items-center gap-xs rounded-full border border-border bg-card px-m py-xs text-200 font-medium text-foreground shadow-[var(--e1)] transition-colors hover:bg-accent"
        >
            {copied ? (
                <Check className="icon-size-100 text-primary" strokeWidth={2.5} aria-hidden />
            ) : (
                <Link2 className="icon-size-100" strokeWidth={2} aria-hidden />
            )}
            <span aria-live="polite">{copied ? "Copied" : "Copy link"}</span>
        </Pressable>
    );
}

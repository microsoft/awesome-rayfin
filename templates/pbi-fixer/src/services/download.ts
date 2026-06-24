// Robust file download that works both as a top-level page and when the app is
// embedded in the Fabric portal iframe.
//
// An anchor-click download (`<a download>`) is silently blocked inside a
// sandboxed iframe that lacks the `allow-downloads` token — which is how the
// Fabric portal hosts this app — so clicking an Export button "did nothing"
// there. When we detect we are embedded we route the blob through a freshly
// opened top-level browser tab instead: that tab is a normal browsing context
// where the browser can save the file (binary, e.g. the PBIP zip) or display it
// (text, e.g. SVG / JSON) for the user to save manually. Top-level usage keeps
// the clean, filename-preserving anchor-click path.

/** True when the app is running inside an iframe (e.g. the Fabric portal). */
export function isEmbedded(): boolean {
  try {
    return window.self !== window.top;
  } catch {
    // Cross-origin access to window.top throws → we are embedded.
    return true;
  }
}

export interface DownloadResult {
  /** Which mechanism handled the download. */
  via: 'anchor' | 'tab' | 'failed';
}

/**
 * Open a new top-level tab that performs the download itself. The wrapper page
 * is same-origin (about:blank inherits the opener origin), so it can resolve
 * the blob URL the parent created and trigger its own `<a download>` once it
 * has escaped the host iframe's sandbox. If the popup is blocked, returns false
 * so the caller can fall back to the in-frame anchor click.
 *
 * We deliberately open `about:blank` and then `document.write` the wrapper —
 * NOT `window.open(blobUrl)`. Popup blockers routinely block `window.open`
 * pointed straight at a `blob:`/`data:` URL, and a blob-origin document is an
 * opaque origin where the auto-click counts as a non-user-gesture and is
 * suppressed. Writing into a blank top-level tab avoids both problems.
 */
function openDownloadTab(filename: string, blobUrl: string): boolean {
  const safe = filename.replace(/[<>&"]/g, '_');
  let win: Window | null = null;
  try {
    win = window.open('', '_blank');
  } catch {
    win = null;
  }
  if (!win) return false;
  const html =
    '<!doctype html><html><head><meta charset="utf-8"><title>' +
    safe +
    '</title><style>body{font-family:"Segoe UI",system-ui,sans-serif;padding:24px;color:#1f2937}' +
    'a.btn{display:inline-block;margin-top:8px;padding:8px 14px;background:#0f6cbd;color:#fff;' +
    'border-radius:6px;text-decoration:none;font-size:15px}</style></head><body>' +
    '<p>Your export <strong>' +
    safe +
    '</strong> is ready.</p>' +
    '<a class="btn" id="dl" download="' +
    safe +
    '" href="' +
    blobUrl +
    '">Download ' +
    safe +
    '</a>' +
    '<p style="color:#6b7280;font-size:13px">The download should start automatically. ' +
    'If it did not, click the button above. You can close this tab afterwards.</p>' +
    '<script>try{document.getElementById("dl").click();}catch(e){}</script>' +
    '</body></html>';
  try {
    win.document.open();
    win.document.write(html);
    win.document.close();
  } catch {
    // Cross-origin write somehow blocked — at least point the tab at the blob
    // so the user can save it manually.
    try {
      win.location.href = blobUrl;
    } catch {
      return false;
    }
  }
  return true;
}

/** Trigger a browser download of a blob, robust to the Fabric iframe sandbox. */
export function triggerDownload(filename: string, blob: Blob): DownloadResult {
  const url = URL.createObjectURL(blob);
  const revoke = () => window.setTimeout(() => URL.revokeObjectURL(url), 60_000);

  // Embedded (Fabric iframe): the sandbox usually blocks `<a download>`, so
  // escape to a top-level tab first. Fall back to the anchor when popups are
  // blocked too.
  if (isEmbedded() && openDownloadTab(filename, url)) {
    revoke();
    return { via: 'tab' };
  }

  try {
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    a.rel = 'noopener';
    a.style.display = 'none';
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    revoke();
    return { via: 'anchor' };
  } catch {
    revoke();
    return { via: 'failed' };
  }
}

/**
 * Copy text to the clipboard, robust to the Fabric iframe sandbox.
 *
 * `navigator.clipboard.writeText` requires the `clipboard-write` permission
 * policy, which the Fabric portal iframe usually denies — so the async path
 * silently rejects there and the copy "does nothing". We fall back to a hidden
 * `<textarea>` + `document.execCommand('copy')`, which works inside the iframe
 * because it copies from a focused, selected element during a user gesture.
 */
export async function copyToClipboard(text: string): Promise<boolean> {
  // Preferred path: async Clipboard API (top-level / permitted contexts).
  try {
    if (navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(text);
      return true;
    }
  } catch {
    /* fall through to execCommand — common inside Fabric iframes */
  }
  // Fallback: hidden textarea + execCommand, which works without the
  // clipboard-write permission policy that an embedded iframe may deny.
  try {
    const ta = document.createElement('textarea');
    ta.value = text;
    ta.style.position = 'fixed';
    ta.style.top = '0';
    ta.style.left = '0';
    ta.style.opacity = '0';
    document.body.appendChild(ta);
    ta.focus();
    ta.select();
    const ok = document.execCommand('copy');
    document.body.removeChild(ta);
    return ok;
  } catch {
    return false;
  }
}

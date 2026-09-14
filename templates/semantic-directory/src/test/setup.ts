//-----------------------------------------------------------------------
// <copyright company="Microsoft Corporation">
//        Copyright (c) Microsoft Corporation.  All rights reserved.
//        Licensed under the MIT license. See LICENSE file in the project root for full license information.
// </copyright>
//-----------------------------------------------------------------------

import "@testing-library/jest-dom";

// jsdom does not implement matchMedia; components that read the OS colour-scheme
// preference (e.g. the theme hook) call it during render. Provide a minimal,
// inert stub so those components mount in tests.
if (typeof window !== "undefined" && typeof window.matchMedia !== "function") {
    window.matchMedia = (query: string): MediaQueryList =>
        ({
            matches: false,
            media: query,
            onchange: null,
            addListener: () => {},
            removeListener: () => {},
            addEventListener: () => {},
            removeEventListener: () => {},
            dispatchEvent: () => false,
        }) as MediaQueryList;
}

// jsdom's <dialog> support has landed only in recent versions; provide a minimal
// showModal/close so the command palette (native <dialog>) can mount and close
// under test. Guarded so a jsdom that already implements them wins.
if (typeof HTMLDialogElement !== "undefined") {
    const proto = HTMLDialogElement.prototype;
    if (typeof proto.showModal !== "function") {
        proto.showModal = function showModal(this: HTMLDialogElement) {
            this.open = true;
        };
    }
    if (typeof proto.close !== "function") {
        proto.close = function close(this: HTMLDialogElement) {
            if (!this.open) return;
            this.open = false;
            this.dispatchEvent(new Event("close"));
        };
    }
}

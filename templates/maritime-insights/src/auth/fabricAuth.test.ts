import { afterEach, describe, expect, it } from "vitest";
import { authRequired, AUTH_CALLBACK_PATH, handleCallbackTab } from "./fabricAuth";

/**
 * 🔴 A gate is only worth having if it fails **closed**.
 *
 * The two ways this one could quietly stop protecting anything are a host it does not recognise
 * and a configuration that has gone missing. Both are cheap to pin and neither is observable by
 * looking at the running app, because the failure mode is "it works for everybody".
 */

const original = window.location;

function setHost(href: string) {
  Object.defineProperty(window, "location", {
    configurable: true,
    value: new URL(href) as unknown as Location,
  });
}

afterEach(() => {
  Object.defineProperty(window, "location", { configurable: true, value: original });
});

describe("authRequired", () => {
  it("is off for a local dev server, so a fresh clone still runs", () => {
    setHost("http://localhost:5173/");
    expect(authRequired()).toBe(false);
    setHost("http://127.0.0.1:4180/?aoi=schlei");
    expect(authRequired()).toBe(false);
  });

  it("is on for the deployed host", () => {
    setHost("https://example-app-0000000000-swedencentral.webapp.fabricapps.net/");
    expect(authRequired()).toBe(true);
  });

  it("is on for any host it does not recognise, rather than off", () => {
    // ⚠️ The dangerous inversion: an allow-list of "protected" hosts would leave every new
    // hostname — a rename, a custom domain, a preview slot — silently public.
    for (const host of [
      "https://example.com/",
      "https://maritime.internal/",
      "https://localhost.attacker.com/",
      "http://192.168.1.10:5173/",
    ]) {
      setHost(host);
      expect(authRequired()).toBe(true);
    }
  });
});

describe("handleCallbackTab", () => {
  it("claims the broker's callback path", () => {
    setHost(`https://example.com${AUTH_CALLBACK_PATH}?code=abc`);
    // It returns true so the caller renders nothing else; the bridge itself is a no-op here
    // because jsdom has no opener.
    expect(handleCallbackTab()).toBe(true);
  });

  it("leaves every other path alone, including one that merely contains it", () => {
    for (const path of ["/", "/?aoi=schlei", "/auth", "/auth/callback/extra"]) {
      setHost(`https://example.com${path}`);
      expect(handleCallbackTab()).toBe(false);
    }
  });
});

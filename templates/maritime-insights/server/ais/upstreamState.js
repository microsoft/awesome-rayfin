/**
 * The two upstream decisions that are worth testing, extracted from the relay's bootstrap.
 *
 * `relay.js` starts a server the moment it is imported, so anything left inside it cannot be
 * exercised by a unit test without opening a socket. These are the parts that were actually wrong,
 * so they live where they can be pinned — the same split `privacy.js` and `vessels.js` already use.
 */

/**
 * What the upstream connection is doing, in three states rather than two.
 *
 * 🔴 `silent` is the state that was missing, and its absence produced a false statement about the
 * world. aisstream accepts the subscription and can then send **nothing at all** — measured on the
 * deployed relay: `messages: 0` after ten minutes with the socket open and no error frame. With
 * only up/down to report, that rendered in the app as "0 Schiffe", i.e. a claim that the Kieler
 * Förde was empty. The subscribed box is the whole western Baltic; it is never empty.
 *
 * Same principle as the coverage field's unknown/shadowed/visible: *not observed* and *not there*
 * are different facts and must not share a representation.
 */
export function upstreamState({ mode, connected, silentForMs, silenceMs }) {
  if (mode === "replay") return "replay";
  if (!connected) return "down";
  if (typeof silentForMs === "number" && silentForMs > silenceMs) return "silent";
  return "connected";
}

/**
 * How long to wait before forcing the next reconnect, once the upstream has proved silent.
 *
 * 🔴 The bug: the previous relay reset its reconnect backoff on `open`, and the socket always
 * opened — so a mute upstream was answered by a reconnect every ~150 s, indefinitely. aisstream
 * throttles per API key and per IP, and their own issue tracker carries a user apologising for
 * being rate-limited by exactly this pattern. Reconnecting cannot make a source with nothing to
 * send speak; holding the open socket costs nothing and notices the moment data resumes.
 */
export function nextSilenceBackoffMs(currentMs, maxMs) {
  return Math.min(currentMs * 2, maxMs);
}

/**
 * How long the upstream has been quiet, measured from the later of the last frame and the current
 * socket opening — a fresh socket has legitimately not said anything yet.
 *
 * Returns null when there is nothing to measure from, which is not the same as zero.
 */
export function silenceSince({ lastMessageMs, openedAtMs, nowMs }) {
  const from = Math.max(lastMessageMs || 0, openedAtMs || 0);
  return from ? Math.max(0, nowMs - from) : null;
}

/**
 * Should the recorded day stand in for a live source that is sending nothing?
 *
 * 🔴 The live provider is a free beta with no SLA and no second supplier, and it has already been
 * mute for a whole day — subscription accepted, zero frames, no error frame. When live traffic is
 * the thing that makes the app worth showing, "the provider is down" must not mean "there is
 * nothing on the screen".
 *
 * ⚠️ Two guards that are the whole safety of this feature:
 *   * it **never** fires in replay mode — there the recording is not a substitute, it is the source,
 *     and treating it as a substitute would make the relay claim a live feed it never had;
 *   * it is **idempotent** — a watchdog that fires every tick would restart the recording every
 *     30 seconds and reset the day under the viewer.
 */
export function shouldStandIn({ mode, silentForMs, alreadyStandingIn, afterMs }) {
  if (mode !== "live") return false;
  if (alreadyStandingIn) return false;
  return typeof silentForMs === "number" && silentForMs > afterMs;
}

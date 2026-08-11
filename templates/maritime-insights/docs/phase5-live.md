# Phase 5 — the live path

The gate: **live and replay reach the screen through the same render path.** Not two paths that
look alike — one path, fed from two sources.

## Why there is a relay at all

🔴 **aisstream.io forbids browser connections outright.** Their documented pattern is to consume
the stream on a backend and deliver to clients from there. So the relay is not an architectural
preference, it is the only compliant shape. Two further facts push the same way:

- the feed is **beta with no SLA** and an API that may change without notice;
- it needs a key that only a signed-in human can generate, and a key must never reach `public/`.

`server/ais/relay.js` is a **zero-dependency Node process** — Node 24 ships a WebSocket client, so
nothing is installed to hold a socket open. It is deliberately **not part of the deployed bundle**:
static hosting cannot keep a connection open, and shipping a relay would mean shipping a key.

## Identity is decided at the relay, not at the renderer

⚠️ **Revised 2026-08-04.** This section used to state that MMSI, name, call sign, IMO and
destination "never leave the relay process". They do now, by default — PLAN §14.12 records why the
rule was withdrawn. What has not changed is *where* the decision is made: at the boundary the data
enters, so a renderer bug cannot leak what the relay was never given, and cannot invent what it
was.

`AIS_IDENTITY` (or `--identity`) takes the same three values as the ingest script — `full`
(default), `commercial`, `anonymous` — and the relay validates it at start-up rather than falling
back silently, because a typo that quietly relayed identity when the operator asked for anonymity
is the one mistake this flag must not make. `/ais/health` reports the mode in force.

Vessel ids follow the mode: the **MMSI** when identity is kept, since a second key would only
invite the two to disagree, and a per-session salted digest when it is not. Aids to navigation are
excluded in every mode — they are transmitters, not traffic.

`server/ais/privacy.test.js` — **22 tests** — pins all three modes. The anonymous ones are
unchanged and still assert that no identifier survives the boundary, including against payload
shapes the upstream is documented to send; the standing runtime assertion that refuses to broadcast
a frame carrying an identifier now runs **only in that mode**, because in the others an MMSI in the
payload is the point rather than a leak. The new ones pin that `commercial` names a ferry and not a
yacht, that AIS `@`-padding never becomes a vessel called `@@@@`, and that a name already learned is
never cleared by a later position report that lacks one.

⚠️ **Measured live**: ten minutes after a restart the relay held **312 vessels, all with an MMSI,
but only 48 with a name.** Static reports arrive every few minutes against positions every few
seconds, so "no name yet" is the normal state for a newly seen ship and must not be presented as
anonymisation.

## Proving the live path without a key

The relay has a `--replay` mode that synthesises a live stream from the Phase 3 track asset. That
makes the whole chain testable end to end — upstream framing, privacy filter, transport, buffer
assembly, shaders — with **no key and no network**.

It also makes the honesty requirement concrete: when the relay is synthesising, the app says so, in
orange, next to the vessel count: *"Relay im Wiedergabemodus — keine Echtzeitdaten."* A demo that
quietly presents recorded data as live is exactly the failure this repo exists not to commit.

## The gate, proven on the deployed app

Live vessels are written into the **same buffer layout** the replay asset decodes into
(`position`, `aTime`, `aSpeed`) and drawn by the **same material instances** — so they inherit the
coverage uniforms for free.

The test is Mode D. Toggling *"nur Verkehr außerhalb der modellierten Sicht"* while the scene is
running on live data **changes the rendered frame**. That can only happen if live vessels are going
through the same coverage shader as replay vessels, which is the gate.

Measured on the deployed build with the relay running:

| | |
| --- | --- |
| Vessels | 64 |
| Positions | 1 590 |
| Mode D alters the live frame | **yes** |
| Replay controls in live mode | hidden |
| Labelled as synthesised | yes |

## 🔴 Three defects the deployment found that local testing did not

**Private Network Access.** A public `https` origin may not reach a loopback address: Chrome
answers *"Permission was denied for this request to access the `loopback` address space."* The
relay now answers the preflight properly. Worth knowing for any demo of this shape — the browser is
on the presenter's machine, so localhost *is* reachable, but only once the header is right.

**A shared geometry bug.** The trails (`LineSegments`) and the vessel heads (`Points`) were sharing
one `BufferGeometry`. `setDrawRange` counts **indices** on indexed geometry and **vertices**
otherwise, so the heads inherited the trail's index and drew the wrong range. Split into a
non-indexed geometry for the heads.

**A dead end in the fallback.** The replay panel was keyed off *what the user asked for*
(`liveWanted`) instead of *what is actually on screen*. Request live with no relay reachable and the
caption promised "the recording stays active" while the scrubber, beats and clock all vanished —
the recording was still playing with no way to control it. It now follows the scene:
`replayDriving = liveState !== "open"`. Verified on the deployed app with the relay stopped: panel,
scrubber and beats all present, and scrubbing to 43 200 s still moves the clock to 12:00.

**Attribution followed the wrong source.** The footer credited the recorded day while live data was
on screen. That was accidentally true — the relay was replaying that same day — but with a real
upstream it would have credited the wrong provider on a permanent notice. Attribution now names
whatever is actually feeding the scene.

## What the fallback looks like

Anyone opening the deployed URL without a relay gets, in order: *"Verbinde mit Relay …"* → *"Kein
Relay erreichbar."* with an explanation that the live source cannot be reached directly from a
browser, that it runs through a separate relay process, and that **the recording staying active is
a normal operating state, not an error.** No vessel count is ever shown for data that did not
arrive.

## Running it

```bash
# synthesised from the recorded day — no key, no network
node server/ais/relay.js --replay public/terrain/kieler-foerde --port 8788

# real upstream
AISSTREAM_KEY=… node server/ais/relay.js --port 8788
```

The app defaults to `http://127.0.0.1:8788` and is overridable at build time with
`VITE_AIS_RELAY`.

## Open

- **No real upstream has been run.** The live path is proven end to end against the replay source;
  running it against aisstream.io needs a key and remains untested. The relay's upstream framing is
  written to their documented schema and nothing more is claimed for it.
- Phase 8's Eventstream/Eventhouse path is the Fabric-native version of this relay and is not
  built; the relay is the honest interim.

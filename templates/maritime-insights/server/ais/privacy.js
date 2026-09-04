/**
 * The identity boundary for the live feed.
 *
 * 🔴 **This is a switch, and it is set here — at the point where data enters our control**, not
 * at the point where it is displayed. Downstream code cannot leak what it was never given, and
 * cannot invent what it was.
 *
 * `full` (the default) relays identity as the vessel transmits it: MMSI, name, call sign, IMO
 * number, destination, dimensions and draught. Every one of those is broadcast in clear under
 * SOLAS and republished openly — the Danish Maritime Authority gives away the same fields for
 * whole days at a time — so withholding them buys no privacy that the source has not already
 * given away, while making the app unable to say which ship it is looking at.
 *
 * `commercial` keeps identity for commercial traffic and pseudonymises pleasure and sailing craft.
 * ⚠️ **This is the distinction that carries the actual weight.** A cargo ship's name is a
 * company asset; a named private yacht plus a live position is a person's whereabouts right now.
 * If any mode is ever wanted for a public deployment, it is this one.
 *
 * `anonymous` is the original behaviour: a per-session salted pseudonym and nothing else.
 * `leaksIdentity` still holds that mode to its promise.
 */

import { createHash, randomBytes } from "node:crypto";

/** How much of a vessel's identity survives this boundary. */
export const IDENTITY_MODES = new Set(["full", "commercial", "anonymous"]);

/**
 * Vessel classes that ship without dimensions.
 *
 * Length and beam alongside a track narrows a private boat to a specific hull, and a specific hull
 * to its owner's movements. Commercial traffic is a different matter: a ferry's dimensions are
 * published, and they are what makes the traffic picture legible.
 */
export const PRIVATE_TYPES = new Set(["Pleasure", "Sailing", "Undefined", "Other", ""]);

/**
 * 🔴 Naval vessels keep a pseudonym in **every** identity mode.
 *
 * PLAN §3.2 rule 3 is a separate rule from the identity setting and was not withdrawn with it: the
 * app must never be a way to find a particular ship, "and above all never a way to find a
 * warship". A live named warship position is the sharpest version of that — it is not a historical
 * fact about where something went, it is where it is now.
 *
 * Detected two ways because one is not enough: the self-reported `Military` ship type, and the
 * naming convention warships use on AIS precisely *because* they are obscuring themselves
 * ("GERMAN WARSHIP A511").
 */
const NAVAL_NAME = /\b(WARSHIP|NAVY|NAVAL|HMS|USS|FGS)\b/i;

export function isNaval(klass, name) {
  return klass === "Military" || (typeof name === "string" && NAVAL_NAME.test(name));
}

/**
 * AIS ship-type codes → the coarse classes the app draws, matching the Danish archive's vocabulary
 * so live and replay speak the same language. Anything unrecognised becomes "Undefined", which is
 * treated as private.
 */
export function shipClass(type) {
  if (type == null) return "Undefined";
  if (type >= 60 && type <= 69) return "Passenger";
  if (type >= 70 && type <= 79) return "Cargo";
  if (type >= 80 && type <= 89) return "Tanker";
  if (type === 30) return "Fishing";
  if (type === 31 || type === 32 || type === 52) return "Tug";
  if (type === 33) return "Dredging";
  if (type === 35) return "Military";
  if (type === 50) return "Pilot";
  if (type === 51 || type === 58) return "SAR";
  if (type === 55) return "Law enforcement";
  if (type === 36) return "Sailing";
  if (type === 37) return "Pleasure";
  if (type >= 40 && type <= 49) return "Other";
  return "Undefined";
}

/**
 * A per-session salt, generated at start and never persisted.
 *
 * This is deliberately *not* stable across runs. A stable salt would let anyone who kept two days
 * of relayed output join them into a long-term movement history for a specific hull — which is the
 * exact harm the rule exists to prevent, reintroduced through the back door of a convenient key.
 * Within a session the id is stable, which is all the renderer needs to draw a trail.
 */
export function createSalt() {
  return randomBytes(16);
}

/** Salted, truncated digest: enough to group one vessel's reports, useless outside this session. */
export function vesselId(mmsi, salt) {
  return createHash("blake2s256")
    .update(String(mmsi))
    .update(salt)
    .digest("hex")
    .slice(0, 8);
}

/**
 * Turn one aisstream.io message into the shape allowed downstream, or null to drop it.
 *
 * Returns null for: aids to navigation (buoys and beacons are transmitters, not traffic — Phase 3
 * dropped 624 of them), base stations, SAR aircraft, invalid reports, and anything without a
 * usable position.
 *
 * @param mode one of IDENTITY_MODES. See the doctrine at the top of this file.
 */
export function sanitise(message, salt, staticData = new Map(), mode = "full") {
  const type = message?.MessageType;
  const meta = message?.MetaData;
  if (!meta) return null;

  // 🔴 Aids to navigation and shore stations are infrastructure, not vessels. Drawing a buoy as a
  // ship would be wrong in a way that looks right, which is the worst kind.
  if (type === "AidsToNavigationReport" || type === "BaseStationReport") return null;
  if (type === "StandardSearchAndRescueAircraftReport") return null;

  const body = message?.Message?.[type];
  if (!body) return null;

  const mmsi = meta.MMSI;
  if (mmsi == null) return null;

  // Static data is where the class *and* the identity live. It arrives every few minutes against a
  // position every few seconds, so it is remembered per vessel and merged into each position
  // report rather than relayed as a message of its own — a client that joined between two static
  // reports would otherwise see an unnamed ship for minutes.
  if (type === "ShipStaticData" || type === "StaticDataReport") {
    const shipType = body.Type ?? body.ReportB?.ShipType;
    const known = staticData.get(mmsi) ?? {};
    const record = {
      ...known,
      class: shipType != null ? shipClass(shipType) : (known.class ?? "Undefined"),
      name: text(body.Name ?? body.ReportA?.Name) ?? known.name,
      callSign: text(body.CallSign ?? body.ReportB?.CallSign) ?? known.callSign,
      imo: body.ImoNumber ? String(body.ImoNumber) : known.imo,
      destination: text(body.Destination) ?? known.destination,
      draughtM: Number.isFinite(body.MaximumStaticDraught) && body.MaximumStaticDraught > 0
        ? body.MaximumStaticDraught : known.draughtM,
      lengthM: dimensionLength(body.Dimension ?? body.ReportB?.Dimension) ?? known.lengthM,
      beamM: dimensionBeam(body.Dimension ?? body.ReportB?.Dimension) ?? known.beamM,
    };
    staticData.set(mmsi, record);
    return null;
  }

  const positionTypes = new Set([
    "PositionReport",
    "StandardClassBPositionReport",
    "ExtendedClassBPositionReport",
    "LongRangeAisBroadcastMessage",
  ]);
  if (!positionTypes.has(type)) return null;
  if (body.Valid === false) return null;

  const lat = body.Latitude ?? meta.latitude;
  const lon = body.Longitude ?? meta.longitude;
  if (!Number.isFinite(lat) || !Number.isFinite(lon)) return null;
  // AIS reports 91/181 for "position not available".
  if (Math.abs(lat) > 90 || Math.abs(lon) > 180) return null;

  const known = staticData.get(mmsi) ?? {};
  const klass = known.class ?? shipClass(body.Type ?? null);
  const speed = Number.isFinite(body.Sog) && body.Sog < 102.3 ? body.Sog : 0;
  const course = Number.isFinite(body.Cog) && body.Cog < 360 ? body.Cog : null;
  // ⚠️ Decided per vessel, not per relay: "commercial" is a property of the hull, so deciding it
  // once for the whole stream would either name every yacht or hide every ferry.
  const identified = (mode === "full"
      || (mode === "commercial" && !PRIVATE_TYPES.has(klass)))
    // Applied last, and overriding the mode. Naval traffic is the one category where the mode does
    // not get the last word — see `isNaval`.
    && !isNaval(klass, known.name);

  const report = {
    id: identified ? String(mmsi) : vesselId(mmsi, salt),
    class: klass,
    lat,
    lon,
    speedKn: speed,
    courseDeg: course,
    // Wall-clock time of the report, not of our receipt: the renderer's clock is real time and a
    // relayed message that queued for two seconds should not appear two seconds ahead of itself.
    timeMs: Date.parse(String(meta.time_utc ?? "").replace(" +0000 UTC", "Z").replace(" ", "T"))
      || Date.now(),
    lengthM: identified
      ? (known.lengthM ?? dimensionLength(body.Dimension))
      // Anonymised craft still ship a length when they are commercial: it is a fact about a
      // vehicle, and it is what makes the traffic picture legible.
      : (PRIVATE_TYPES.has(klass) ? null : dimensionLength(body.Dimension)),
  };

  if (identified) {
    report.mmsi = String(mmsi);
    // Name arrives in a static report; a vessel seen before its first one is simply unnamed, and
    // saying so is better than inventing a placeholder the UI would have to detect.
    if (known.name) report.name = known.name;
    if (known.callSign) report.callSign = known.callSign;
    if (known.imo) report.imo = known.imo;
    if (known.destination) report.destination = known.destination;
    if (known.draughtM) report.draughtM = known.draughtM;
    if (known.beamM) report.beamM = known.beamM;
  }

  return report;
}

/** AIS pads unset strings with @ and spaces; an unset field must read as absent, not as "@@@@". */
function text(value) {
  if (typeof value !== "string") return undefined;
  const trimmed = value.replace(/@/g, "").trim();
  return trimmed.length ? trimmed : undefined;
}

function dimensionLength(dimension) {
  if (!dimension) return null;
  const length = (dimension.A ?? 0) + (dimension.B ?? 0);
  return length > 0 ? length : null;
}

function dimensionBeam(dimension) {
  if (!dimension) return null;
  const beam = (dimension.C ?? 0) + (dimension.D ?? 0);
  return beam > 0 ? beam : null;
}

/**
 * The assertion the `anonymous` mode exists to make: no identifier may appear in relayed output.
 *
 * ⚠️ Only meaningful in `anonymous` mode — in `full` and `commercial` an identifier in the payload
 * is the point, not a leak. The relay applies it accordingly, and the tests hold the anonymous
 * boundary to it rather than to a list of fields someone remembered to strip.
 */
export const FORBIDDEN_KEYS = [
  "MMSI", "mmsi", "ShipName", "shipName", "name", "Name",
  "CallSign", "callSign", "ImoNumber", "imo", "Destination", "destination",
  "Eta", "eta", "MaximumStaticDraught", "draught",
];

export function leaksIdentity(payload) {
  const seen = JSON.stringify(payload);
  return FORBIDDEN_KEYS.filter((key) => seen.includes(`"${key}"`));
}

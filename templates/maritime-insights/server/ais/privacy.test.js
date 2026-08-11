import { describe, expect, it } from "vitest";
import {
  createSalt, leaksIdentity, PRIVATE_TYPES, sanitise, shipClass, vesselId,
} from "./privacy.js";
import { Vessels } from "./vessels.js";

/**
 * The relay is the only process that ever sees an MMSI, so these tests are the boundary. They are
 * written against what must NOT come out, not against the list of fields someone remembered to
 * delete — a test that checks `delete msg.MMSI` was called would pass forever while a new field
 * carrying a name walked straight through.
 */

const KIEL = { west: 9.7, south: 54.1, east: 10.9, north: 54.8 };

/** A realistic aisstream.io message, identifiers and all. */
function positionMessage(overrides = {}) {
  return {
    MessageType: "PositionReport",
    MetaData: {
      MMSI: 211476060,
      ShipName: "NILS HOLGERSSON",
      latitude: 54.38,
      longitude: 10.17,
      time_utc: "2026-07-29 18:22:32.318353 +0000 UTC",
      ...overrides.MetaData,
    },
    Message: {
      PositionReport: {
        Latitude: 54.38, Longitude: 10.17, Sog: 12.4, Cog: 176, Valid: true,
        ...overrides.PositionReport,
      },
    },
  };
}

describe("the privacy boundary", () => {
  const salt = createSalt();

  it("never lets an identifier through, whatever the message carried", () => {
    const report = sanitise(positionMessage(), salt, new Map(), "anonymous");
    expect(report).not.toBeNull();
    expect(leaksIdentity(report)).toEqual([]);
    expect(JSON.stringify(report)).not.toContain("211476060");
    expect(JSON.stringify(report)).not.toContain("NILS");
  });

  it("keeps a static message's name and destination out entirely", () => {
    const staticData = new Map();
    const result = sanitise({
      MessageType: "ShipStaticData",
      MetaData: { MMSI: 211476060, ShipName: "NILS HOLGERSSON", time_utc: "" },
      Message: {
        ShipStaticData: {
          Type: 60, Name: "NILS HOLGERSSON", CallSign: "DGNH", ImoNumber: 9217230,
          Destination: "TRAVEMUNDE", Dimension: { A: 100, B: 90, C: 15, D: 15 },
        },
      },
    }, salt, staticData, "anonymous");

    // Static messages produce no relayed output at all — they only teach the relay about the
    // vessel. What it remembers is a record; how much of it escapes is the mode's decision.
    expect(result).toBeNull();
    expect(staticData.get(211476060).class).toBe("Passenger");
  });

  it("gives the same vessel a stable id within a session and a different one across sessions", () => {
    const a = createSalt();
    const b = createSalt();
    expect(vesselId(211476060, a)).toBe(vesselId(211476060, a));
    expect(vesselId(211476060, a)).not.toBe(vesselId(211476060, b));
    // 🔴 The across-session difference is the point: a stable id would let two days of relayed
    // output be joined into a movement history for one hull.
  });

  it("withholds dimensions from private craft but not from commercial traffic", () => {
    const staticData = new Map();
    staticData.set(1, { class: "Pleasure" });
    staticData.set(2, { class: "Cargo" });

    const yacht = sanitise(positionMessage({
      MetaData: { MMSI: 1 },
      PositionReport: { Dimension: { A: 6, B: 4, C: 2, D: 2 } },
    }), salt, staticData, "anonymous");
    const freighter = sanitise(positionMessage({
      MetaData: { MMSI: 2 },
      PositionReport: { Dimension: { A: 100, B: 90, C: 15, D: 15 } },
    }), salt, staticData, "anonymous");

    expect(yacht.lengthM).toBeNull();
    expect(freighter.lengthM).toBe(190);
  });

  it("treats every private class as private", () => {
    for (const klass of PRIVATE_TYPES) {
      const staticData = new Map([[7, { class: klass }]]);
      const report = sanitise(positionMessage({
        MetaData: { MMSI: 7 },
        PositionReport: { Dimension: { A: 8, B: 4, C: 2, D: 2 } },
      }), salt, staticData, "anonymous");
      expect(report.lengthM).toBeNull();
    }
  });

  it("drops navigation marks, shore stations and aircraft", () => {
    for (const type of ["AidsToNavigationReport", "BaseStationReport",
                        "StandardSearchAndRescueAircraftReport"]) {
      const message = positionMessage();
      message.MessageType = type;
      message.Message = { [type]: { Latitude: 54.38, Longitude: 10.17, Valid: true } };
      expect(sanitise(message, salt, new Map(), "anonymous")).toBeNull();
    }
  });

  it("rejects the 'position unavailable' sentinels rather than drawing a ship off Africa", () => {
    expect(sanitise(positionMessage({
      MetaData: { latitude: 91, longitude: 181 },
      PositionReport: { Latitude: 91, Longitude: 181 },
    }), salt, new Map(), "anonymous")).toBeNull();
  });

  it("refuses an invalid report", () => {
    expect(sanitise(positionMessage({ PositionReport: { Valid: false } }), salt, new Map(),
                    "anonymous")).toBeNull();
  });

  it("classifies the traffic this fjord actually carries", () => {
    expect(shipClass(60)).toBe("Passenger");
    expect(shipClass(70)).toBe("Cargo");
    expect(shipClass(80)).toBe("Tanker");
    expect(shipClass(52)).toBe("Tug");
    expect(shipClass(50)).toBe("Pilot");
    expect(shipClass(37)).toBe("Pleasure");
    expect(shipClass(null)).toBe("Undefined");
    expect(shipClass(999)).toBe("Undefined");
  });
});

/**
 * The identified modes. These exist because the anonymous boundary above was hiding data the
 * source publishes anyway: the same MMSI and name are broadcast in clear by the vessel and
 * republished for whole days by the Danish Maritime Authority.
 */
describe("identity modes", () => {
  const salt = createSalt();

  /** Teach a static record the way a real stream would, then read a position back. */
  function withStatic(mmsi, statics, mode, position = {}) {
    const staticData = new Map();
    sanitise({
      MessageType: "ShipStaticData",
      MetaData: { MMSI: mmsi, time_utc: "" },
      Message: { ShipStaticData: statics },
    }, salt, staticData, mode);
    return sanitise(positionMessage({
      MetaData: { MMSI: mmsi }, PositionReport: position,
    }), salt, staticData, mode);
  }

  const FERRY = {
    Type: 60, Name: "NILS HOLGERSSON", CallSign: "DGNH", ImoNumber: 9217230,
    Destination: "TRAVEMUNDE", MaximumStaticDraught: 6.2,
    Dimension: { A: 100, B: 90, C: 15, D: 15 },
  };

  it("relays identity as transmitted in full mode", () => {
    const report = withStatic(211476060, FERRY, "full");
    expect(report).toMatchObject({
      mmsi: "211476060",
      name: "NILS HOLGERSSON",
      callSign: "DGNH",
      imo: "9217230",
      destination: "TRAVEMUNDE",
      draughtM: 6.2,
      lengthM: 190,
      beamM: 30,
    });
    // 🔴 The id becomes the MMSI: once identity is kept there is nothing for a pseudonym to do,
    // and a second key would only invite the two to disagree.
    expect(report.id).toBe("211476060");
  });

  it("carries a vessel that has not sent static data yet, without inventing a name", () => {
    // ⚠️ AIS sends static data every few minutes against a position every few seconds, so this is
    // the normal state for a newly seen ship — not an error, and not a reason to withhold it.
    const report = sanitise(positionMessage(), salt, new Map(), "full");
    expect(report.mmsi).toBe("211476060");
    expect(report.name).toBeUndefined();
  });

  it("does not turn AIS padding into a vessel called @@@@", () => {
    const report = withStatic(7, { Type: 70, Name: "@@@@@@@@", Destination: "   " }, "full");
    expect(report.name).toBeUndefined();
    expect(report.destination).toBeUndefined();
  });

  it("names commercial traffic but not pleasure craft in commercial mode", () => {
    const ferry = withStatic(211476060, FERRY, "commercial");
    const yacht = withStatic(211182770, {
      Type: 37, Name: "EULE", CallSign: "DJ3250", Dimension: { A: 6, B: 4, C: 2, D: 2 },
    }, "commercial");

    expect(ferry.name).toBe("NILS HOLGERSSON");
    expect(yacht.name).toBeUndefined();
    expect(yacht.mmsi).toBeUndefined();
    // 🔴 The pseudonym has to actually be one — an id that is still the MMSI would defeat the
    // whole mode while looking correct in the UI.
    expect(yacht.id).not.toContain("211182770");
    expect(yacht.id).toBe(vesselId(211182770, salt));
  });

  it("still refuses to leak in anonymous mode, whatever the static message carried", () => {
    const report = withStatic(211476060, FERRY, "anonymous");
    expect(leaksIdentity(report)).toEqual([]);
    expect(JSON.stringify(report)).not.toContain("NILS");
    expect(JSON.stringify(report)).not.toContain("211476060");
  });

  it("carries identity through the shared state and out to a client", () => {
    // The relay holds one copy of the picture, so identity has to survive that hop too — a report
    // that is right and a snapshot that is empty would look identical from the browser.
    const vessels = new Vessels(KIEL);
    vessels.add(withStatic(211476060, FERRY, "full"));
    const [wire] = vessels.snapshot().vessels;
    expect(wire).toMatchObject({ mmsi: "211476060", name: "NILS HOLGERSSON", imo: "9217230" });
    const [delta] = vessels.delta([wire.id]).vessels;
    expect(delta).toMatchObject({ name: "NILS HOLGERSSON", mmsi: "211476060" });
  });

  it("never clears a name it already has when a later position lacks one", () => {
    // ⚠️ Static reports are sparse. Letting a bare position report overwrite the record would make
    // names flicker on and off in the list every few seconds.
    const vessels = new Vessels(KIEL);
    vessels.add(withStatic(211476060, FERRY, "full"));
    const bare = sanitise(positionMessage(), salt, new Map(), "full");
    bare.timeMs = Date.now() + 20_000;
    vessels.add(bare);
    expect(vessels.snapshot().vessels[0].name).toBe("NILS HOLGERSSON");
  });

  it("withholds identity from naval vessels in every mode", () => {
    // 🔴 PLAN §3.2 rule 3 outlives the identity setting: never a way to find a warship. Caught two
    // ways, because a warship that is hiding still has to transmit — it just transmits
    // "GERMAN WARSHIP A511" instead of its name.
    for (const mode of ["full", "commercial"]) {
      const byType = withStatic(211211480, { Type: 35, Name: "SCHLESWIG-HOLSTEIN" }, mode);
      expect(byType.name, `type, ${mode}`).toBeUndefined();
      expect(byType.mmsi, `type, ${mode}`).toBeUndefined();

      const byName = withStatic(211211170, { Type: 70, Name: "GERMAN WARSHIP M1062" }, mode);
      expect(byName.name, `name, ${mode}`).toBeUndefined();
      expect(byName.mmsi, `name, ${mode}`).toBeUndefined();
      expect(byName.id, `name, ${mode}`).toBe(vesselId(211211170, salt));
    }
  });

  it("still shows the naval vessel as traffic, just not as an identity", () => {
    // ⚠️ Withholding the name must not delete the ship. A gap in the traffic picture would be a
    // worse distortion than a name — the coverage figures are counted over these hulls too.
    const report = withStatic(211211480, { Type: 35, Name: "GERMAN WARSHIP A511" }, "full");
    expect(report).not.toBeNull();
    expect(report.class).toBe("Military");
    expect(report.lat).toBeCloseTo(54.38);
  });
});

describe("shared vessel state", () => {
  const salt = createSalt();

  it("keeps what is in the area and counts what is not", () => {
    const vessels = new Vessels(KIEL);
    expect(vessels.add(sanitise(positionMessage(), salt, new Map(), "anonymous"))).toBe(true);
    expect(vessels.add(sanitise(positionMessage({
      MetaData: { MMSI: 9, latitude: 40, longitude: 3 },
      PositionReport: { Latitude: 40, Longitude: 3 },
    }), salt, new Map(), "anonymous"))).toBe(false);
    expect(vessels.size).toBe(1);
    expect(vessels.stats.outOfArea).toBe(1);
  });

  it("builds a trail rather than replacing the position", () => {
    const vessels = new Vessels(KIEL);
    const base = Date.now();
    for (let i = 0; i < 5; i += 1) {
      const report = sanitise(positionMessage(), salt, new Map(), "anonymous");
      report.timeMs = base + i * 10_000;
      report.lat = 54.38 + i * 0.001;
      vessels.add(report);
    }
    const [vessel] = vessels.snapshot().vessels;
    expect(vessel.points.length).toBe(5);
  });

  it("collapses duplicate reports of the same second", () => {
    const vessels = new Vessels(KIEL);
    const base = Date.now();
    for (let i = 0; i < 4; i += 1) {
      const report = sanitise(positionMessage(), salt, new Map(), "anonymous");
      report.timeMs = base;
      vessels.add(report);
    }
    expect(vessels.snapshot().vessels[0].points.length).toBe(1);
  });

  it("forgets a vessel that has stopped transmitting", () => {
    const vessels = new Vessels(KIEL);
    const report = sanitise(positionMessage(), salt, new Map(), "anonymous");
    report.timeMs = Date.now() - 60 * 60 * 1000;
    vessels.add(report);
    expect(vessels.size).toBe(1);
    vessels.prune(Date.now());
    expect(vessels.size).toBe(0);
  });

  it("never emits an identifier in a snapshot or a delta", () => {
    const vessels = new Vessels(KIEL);
    const report = sanitise(positionMessage(), salt, new Map(), "anonymous");
    vessels.add(report);
    expect(leaksIdentity(vessels.snapshot())).toEqual([]);
    expect(leaksIdentity(vessels.delta([report.id]))).toEqual([]);
    expect(JSON.stringify(vessels.snapshot())).not.toContain("211476060");
  });

  it("upgrades a class that arrived after the first position", () => {
    const vessels = new Vessels(KIEL);
    const staticData = new Map();
    vessels.add(sanitise(positionMessage(), salt, staticData, "anonymous"));
    expect(vessels.snapshot().vessels[0].class).toBe("Undefined");

    staticData.set(211476060, { class: "Passenger" });
    const later = sanitise(positionMessage(), salt, staticData, "anonymous");
    later.timeMs = Date.now() + 20_000;
    vessels.add(later);
    expect(vessels.snapshot().vessels[0].class).toBe("Passenger");
  });
});

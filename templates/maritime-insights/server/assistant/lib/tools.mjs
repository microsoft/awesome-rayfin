/**
 * The assistant's tools.
 *
 * 🔴 **Deliberately narrow.** Each tool answers a question the shipped data can actually answer,
 * and nothing offers "analysis" the model would have to make up. The one question this app exists
 * to answer — *what would a sensor here have seen?* — is **not** a tool, because the viewshed is
 * solved in the browser against the user's own placed sites. `get_current_view` returns what the
 * app is showing instead, so the assistant reads the user's screen rather than inventing a second,
 * quietly different answer.
 */

import { config } from "../config.mjs";
import { areaIds, getArea, TRANSIT_MIN_KM } from "./data.mjs";

export function toolDefinitions() {
  return [
    {
      name: "get_area_summary",
      description:
        "Terrain, model and traffic overview for one area of interest: bounding box, elevation "
        + "range, what the blocking surface contains, and how many vessel passages the recorded "
        + "day holds. Use this before answering anything about the area as a whole.",
      parameters: {
        type: "object",
        properties: {
          aoi: { type: "string", description: `Area id, one of: ${areaIds().join(", ")}.` },
        },
      },
    },
    {
      name: "get_traffic_stats",
      description:
        "Traffic breakdown for the recorded day: passages by vessel class, by hour of day, and "
        + "the split between transits and stationary passages. Use for 'how busy', 'when', "
        + "'what kind of traffic' questions.",
      parameters: {
        type: "object",
        properties: {
          aoi: { type: "string", description: `Area id, one of: ${areaIds().join(", ")}.` },
        },
      },
    },
    {
      name: "find_vessel",
      description:
        "Look up vessels in the recorded day by name, MMSI or call sign, and return their "
        + "passages with times, duration and distance. Use whenever a specific ship is named.",
      parameters: {
        type: "object",
        properties: {
          query: {
            type: "string",
            description: "Vessel name, MMSI or call sign. Partial names match.",
          },
          aoi: { type: "string", description: `Area id, one of: ${areaIds().join(", ")}.` },
        },
        required: ["query"],
      },
    },
    {
      name: "list_longest_transits",
      description:
        "The passages that actually crossed the area, longest first, with vessel identity where "
        + "the feed carried it. Use for 'which ships passed through', 'busiest movements', or to "
        + "give concrete examples.",
      parameters: {
        type: "object",
        properties: {
          aoi: { type: "string", description: `Area id, one of: ${areaIds().join(", ")}.` },
          limit: { type: "number", description: "How many to return, default 10, max 25." },
        },
      },
    },
    {
      name: "get_live_traffic",
      description:
        "What the live AIS relay is receiving right now: vessel count, class breakdown and a few "
        + "named examples. Use only for questions about the present moment; the recorded day is a "
        + "different question.",
      parameters: { type: "object", properties: {} },
    },
    {
      name: "get_current_view",
      description:
        "What the user's screen is showing right now: selected area, placed sensor sites with "
        + "their mast heights, the coverage figures the app has computed, and any selected "
        + "vessel. 🔴 This is the ONLY source for coverage numbers — never estimate them.",
      parameters: { type: "object", properties: {} },
    },
  ];
}

function area(args, context) {
  return getArea(args?.aoi ?? context?.view?.aoi);
}

function summarise(a) {
  return {
    aoi: a.id,
    recordedDate: a.date,
    boundsWgs84: a.boundsWgs84,
    terrainResolutionM: a.terrainResolutionM,
    elevationRangeM: a.heightRangeM,
    blockingSurface: a.los
      ? {
          resolutionM: a.los.resolutionM,
          includesBuildings: a.los.includesBuildings,
          includesVegetation: a.los.includesVegetation,
          // ⚠️ Carried through verbatim: without vegetation the app's coverage is an upper bound,
          // and that caveat has to travel with the figure or the assistant will quote it flat.
          vegetationStats: a.los.vegetationStats,
        }
      : null,
    passages: a.trackCount,
    transits: a.transitCount,
    transitRuleKm: TRANSIT_MIN_KM,
    // 🔴 There are TWO denominators in this app and quoting the wrong one is the easiest
    // mistake to make here. `transits` is every passage that travelled far enough. The coverage
    // denominator is smaller still — only the transits that actually entered the modelled
    // line-of-sight grid — and it is computed in the browser, so it arrives via get_current_view.
    denominatorNote:
      "'transits' counts passages that travelled at least 0.5 km anywhere in the recorded area. "
      + "Coverage percentages use a smaller denominator: only the transits that entered the "
      + "modelled line-of-sight grid. Never divide a coverage count by 'transits' here — take both "
      + "the numerator and the denominator from get_current_view.",
    positions: a.pointCount,
    distinctVessels: a.vesselCount,
    passagesWithIdentity: a.namedTrackCount,
    identityNote: a.identityNote,
    attribution: a.attribution,
  };
}

function trackView(t) {
  return {
    name: t.name,
    mmsi: t.mmsi,
    callSign: t.callSign,
    imo: t.imo,
    destination: t.destination,
    class: t.type,
    lengthM: t.lengthM,
    beamM: t.beamM,
    draughtM: t.draughtM,
    inAreaUtc: `${t.fromUtc}-${t.toUtc}`,
    minutesInArea: t.minutesInArea,
    distanceKm: t.distanceKm,
    isTransit: t.isTransit,
    aisReports: t.reports,
  };
}

/** One live snapshot from the relay's SSE stream, then disconnect. */
async function liveSnapshot(signal) {
  const base = config.relayUrl;
  if (!base) return { available: false, reason: "no relay configured" };

  const health = await fetch(`${base}/ais/health`, { signal }).then((r) => r.json());
  const response = await fetch(`${base}/ais/stream`, {
    headers: { accept: "text/event-stream" },
    signal,
  });
  if (!response.ok || !response.body) {
    return { available: false, reason: `relay stream ${response.status}` };
  }

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  try {
    // The relay sends a full snapshot to every client on connect, so the first `vessels` frame is
    // the whole picture. Reading further would just be watching it change.
    for (let guard = 0; guard < 200; guard += 1) {
      const { value, done } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      const frames = buffer.split("\n\n");
      buffer = frames.pop() ?? "";
      for (const frame of frames) {
        const isVessels = frame.includes("event: vessels");
        const line = frame.split("\n").find((l) => l.startsWith("data:"));
        if (!isVessels || !line) continue;
        const payload = JSON.parse(line.slice(5).trim());
        if (payload.type !== "snapshot") continue;
        const byClass = {};
        for (const v of payload.vessels) byClass[v.class] = (byClass[v.class] ?? 0) + 1;
        const named = payload.vessels.filter((v) => v.name);
        return {
          available: true,
          mode: health.mode,
          source: health.source,
          identity: health.identity ?? "unknown",
          vessels: payload.vessels.length,
          byClass,
          withIdentity: named.length,
          examples: named.slice(0, 8).map((v) => ({
            name: v.name,
            mmsi: v.mmsi,
            class: v.class,
            destination: v.destination ?? null,
            knots: v.points?.at(-1)?.[3] ?? null,
          })),
          note: "Live relay covers the wider horizon box, not only the modelled water.",
        };
      }
    }
    return { available: false, reason: "relay sent no snapshot" };
  } finally {
    await reader.cancel().catch(() => {});
  }
}

export async function executeTool(name, args = {}, context = {}) {
  switch (name) {
    case "get_area_summary": {
      const a = area(args, context);
      if (!a) return { error: "no_area_loaded" };
      return summarise(a);
    }

    case "get_traffic_stats": {
      const a = area(args, context);
      if (!a) return { error: "no_area_loaded" };
      const byHour = {};
      for (const t of a.tracks) {
        // Counted by interval overlap, not by start hour: a passage that runs 07:50–08:40 is
        // present in both hours, and the Phase 6 model agreement turns on exactly this rule.
        const from = Math.floor(t.fromUtc.slice(0, 2) * 1);
        const to = Math.floor(t.toUtc.slice(0, 2) * 1);
        for (let h = from; h <= to; h += 1) byHour[h] = (byHour[h] ?? 0) + 1;
      }
      const transits = a.tracks.filter((t) => t.isTransit);
      return {
        aoi: a.id,
        recordedDate: a.date,
        passages: a.trackCount,
        transits: a.transitCount,
        stationaryExcluded: a.transitCount === null ? null : a.trackCount - a.transitCount,
        transitRuleKm: TRANSIT_MIN_KM,
        byClass: a.byType,
        passagesPresentByHourUtc: byHour,
        medianTransitMinutes: transits.length
          ? [...transits].sort((x, y) => x.minutesInArea - y.minutesInArea)[
              Math.floor(transits.length / 2)].minutesInArea
          : null,
        note: "A passage is one continuous track; a 20-minute silence starts a new one, so one "
          + "moored vessel can appear as several passages. That is why transits are counted "
          + `separately (travelled at least ${TRANSIT_MIN_KM} km). Coverage percentages use a `
          + "smaller denominator again — only transits that entered the modelled grid — which "
          + "comes from get_current_view, not from here.",
      };
    }

    case "find_vessel": {
      const a = area(args, context);
      if (!a) return { error: "no_area_loaded" };
      const q = String(args.query ?? "").trim().toLowerCase();
      if (!q) return { error: "empty_query" };
      const hits = a.tracks.filter((t) =>
        (t.name && t.name.toLowerCase().includes(q))
        || (t.mmsi && t.mmsi.includes(q))
        || (t.callSign && t.callSign.toLowerCase() === q));
      if (!hits.length) {
        return {
          aoi: a.id,
          query: args.query,
          matches: 0,
          // 🔴 Two very different reasons for an empty result, and the model must not merge them.
          note: "No passage in this area on this day matches. Note that vessels whose AIS static "
            + "report was never received in the area carry no name at all, and naval vessels are "
            + "deliberately pseudonymised, so an absent match is not proof of absence.",
        };
      }
      return { aoi: a.id, query: args.query, matches: hits.length,
               passages: hits.slice(0, 12).map(trackView) };
    }

    case "list_longest_transits": {
      const a = area(args, context);
      if (!a) return { error: "no_area_loaded" };
      const limit = Math.min(Math.max(Number(args.limit) || 10, 1), 25);
      const sorted = a.tracks
        .filter((t) => t.isTransit)
        .sort((x, y) => (y.distanceKm ?? 0) - (x.distanceKm ?? 0))
        .slice(0, limit);
      return { aoi: a.id, recordedDate: a.date, transits: sorted.map(trackView) };
    }

    case "get_live_traffic": {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), 15_000);
      try {
        return await liveSnapshot(controller.signal);
      } catch (error) {
        return { available: false, reason: error.message };
      } finally {
        clearTimeout(timer);
      }
    }

    case "get_current_view": {
      const view = context.view;
      if (!view || !Object.keys(view).length) {
        return {
          available: false,
          note: "The app sent no view state. Say that coverage figures are not available rather "
            + "than estimating them.",
        };
      }
      return view;
    }

    default:
      return { error: "unknown_tool", name };
  }
}

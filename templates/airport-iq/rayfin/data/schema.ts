/**
 * Airport IQ — operations snapshot contract.
 *
 * This template ships baked synthetic data and does NOT enable the Rayfin data
 * service (see rayfin/rayfin.yml → services.data.enabled: false), so there are
 * no Rayfin entities to register — the exported `schema` is intentionally empty.
 *
 * The types below document the shape the Live-Ops view expects from an operations
 * snapshot. Use them as the contract when you bring your own data: have a Fabric
 * warehouse / lakehouse (via the Rayfin data service or a User Data Function)
 * return this shape, set `window.AIQ_FABRIC_SNAPSHOT_URL`, and load the view with
 * `?data=fabric`. See the README "Bring your own data" section.
 */

export interface OpsSnapshot {
  meta: {
    airport: string;                 // IATA code, e.g. "DUS"
    now: string;                     // ISO timestamp — the "current" moment
    window: [string, string];        // [start, end] ISO timestamps for the scrubber
    source?: string;                 // provenance note
  };
  gates: Gate[];
  airlines: Airline[];
  airports: AirportRef[];
  flights: Flight[];
  assignments: GateAssignment[];
  delays: Delay[];
  conflicts: GateConflict[];
}

export interface Gate { id: string; num: string; x: number; z: number; term?: string; }
export interface Airline { iata: string; name: string; color?: string; }
export interface AirportRef { iata: string; name: string; lat: number; lon: number; }
export interface Flight {
  id: string; callsign: string; airline: string; actype?: string; size?: string;
  dir: "inbound" | "outbound"; status: string; rwy?: string;
  sdep?: string; sarr?: string; ob?: string; onb?: string;      // scheduled / off-block / on-block times
}
export interface GateAssignment { id: string; gate_id: string; flight_id: string; window: [string, string]; }
export interface Delay { id: string; flight_id: string; minutes: number; reason?: string; }
export interface GateConflict { id: string; gate_id: string; gate_number?: string; state: string; cause?: string; }

// No Rayfin data entities in this template.
export const schema = [] as const;

/**
 * DAX queries against the `HSL_KQL_SM` semantic model (DirectQuery over the HSL_EH Eventhouse).
 *
 * Row keys returned by Power BI's `executeQueries` are qualified, e.g. `[vehicle_id]`, so read
 * them through `daxValue`/`daxNumber` rather than by bare name.
 */

/** Current position of every vehicle, from the `last_vehicle_position` materialized view. */
export const LIVE_VEHICLES_DAX = `
EVALUATE
SELECTCOLUMNS(
    'Last Vehicle Position',
    "vehicle_id", 'Last Vehicle Position'[vehicle_id],
    "trip_route_id", 'Last Vehicle Position'[trip_route_id],
    "position_latitude", 'Last Vehicle Position'[position_latitude],
    "position_longitude", 'Last Vehicle Position'[position_longitude],
    "position_bearing", 'Last Vehicle Position'[position_bearing],
    "position_speed", 'Last Vehicle Position'[position_speed],
    "vehicle_timestamp", 'Last Vehicle Position'[vehicle_timestamp],
    "vehicle_label", 'Last Vehicle Position'[vehicle_label],
    "occupancy_status", 'Last Vehicle Position'[occupancy_status]
)
`.trim();

/** Ingestion counters for the KPI strip. */
export const COUNTERS_DAX = `
EVALUATE
ROW(
    "Positions_last_hour", CALCULATE(SUM('Number_Positions'[number_positions_last_hour])),
    "Positions_total", CALCULATE(SUM('Number_Positions'[total_number_positions]))
)
`.trim();

/**
 * Recent track of one vehicle. `Selected_Vehicle_Path` is an M-parameterised table
 * (`Selected_Vehicle`), so the value has to be pushed in via MPARAMETER.
 */
export function vehiclePathDax(vehicleId: string): string {
  // The parameter is interpolated into a DAX string literal - escape embedded quotes.
  const safeId = vehicleId.replace(/"/g, '""');
  return `
DEFINE
    MPARAMETER 'Selected_Vehicle' = "${safeId}"

    VAR __FilterTable = TREATAS({"${safeId}"}, 'Vehicles'[vehicle_id])

    VAR __Core =
        TOPN(
            1000,
            CALCULATETABLE(
                SELECTCOLUMNS(
                    'Selected_Vehicle_Path',
                    "vehicle_id", 'Selected_Vehicle_Path'[vehicle_id],
                    "timestamp", 'Selected_Vehicle_Path'[timestamp],
                    "Latitude", 'Selected_Vehicle_Path'[position_latitude],
                    "Longitude", 'Selected_Vehicle_Path'[position_longitude],
                    "Speed", 'Selected_Vehicle_Path'[position_speed],
                    "Bearing", 'Selected_Vehicle_Path'[position_bearing]
                ),
                KEEPFILTERS(__FilterTable)
            ),
            [timestamp], ASC
        )

EVALUATE __Core
`.trim();
}

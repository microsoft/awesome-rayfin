# Fabric notebook source

# METADATA ********************

# META {
# META   "kernel_info": {
# META     "name": "jupyter",
# META     "jupyter_kernel_name": "python3.12"
# META   }
# META }

# MARKDOWN ********************

# # HSL Real-Time Data Pipeline (MCAPS)
#
# Fetches **vehicle positions** and **trip updates** from the public HSL (Helsinki Regional
# Transport) GTFS-RT feeds and pushes them into the Fabric Eventstream `ES_HSL_Events`
# using a unified envelope:
#
# ```json
# { "timestamp": "...", "type": "vehicle_position|trip_update", "transport_type": "hsl", "content": {...} }
# ```
#
# The Eventstream routes into Eventhouse `HSL_EH` -> table `raw_events`, where update policies
# parse it into `vehicle_positions`, `trip_updates` and `alerts`.
#
# **No secrets are stored in this notebook** - the Eventstream connection string is fetched at
# run time from the Fabric REST API using the notebook's own identity.
#
# Feed docs: https://hsldevcom.github.io/gtfs_rt/

# MARKDOWN ********************

# ## 1. Singleton guard - skip if an OLDER run is still active
#
# The runtime context exposes the *root activity* id, which is not the job-instance id, so an
# id-based comparison makes a run detect itself and exit. Compare start times instead: any run
# that is still active and started clearly before this one wins, and this run stands down.

# CELL ********************

import requests
from datetime import datetime, timezone

ctx = notebookutils.runtime.context
workspace_id = ctx["currentWorkspaceId"]
notebook_id = ctx["currentNotebookId"]

fabric_token = notebookutils.credentials.getToken("https://api.fabric.microsoft.com")
HEADERS = {"Authorization": f"Bearer {fabric_token}"}

STARTUP_GRACE_SECONDS = 120

runs = requests.get(
    f"https://api.fabric.microsoft.com/v1/workspaces/{workspace_id}/items/{notebook_id}/jobs/instances",
    headers=HEADERS,
    timeout=60,
).json()["value"]

now = datetime.now(timezone.utc)


def _age_seconds(run):
    raw = run.get("startTimeUtc")
    if not raw:
        return 0.0
    started = datetime.fromisoformat(raw.rstrip("Z")).replace(tzinfo=timezone.utc)
    return (now - started).total_seconds()


older_active = [
    r for r in runs
    if r["status"] in ("InProgress", "NotStarted") and _age_seconds(r) > STARTUP_GRACE_SECONDS
]

if older_active:
    notebookutils.notebook.exit(
        f"An older run is still active ({older_active[0]['id']}, "
        f"{_age_seconds(older_active[0]) / 60:.1f} min old) - skipping."
    )

print(f"No older active run found among {len(runs)} job instances - proceeding.")

# METADATA ********************

# META {
# META   "language": "python",
# META   "language_group": "jupyter_python"
# META }

# CELL ********************

%pip install gtfs-realtime-bindings azure-eventhub

# METADATA ********************

# META {
# META   "language": "python",
# META   "language_group": "jupyter_python"
# META }

# MARKDOWN ********************

# ## 2. Configuration

# CELL ********************

# HSL GTFS-RT endpoints (public, no subscription key required)
HSL_VEHICLE_POSITIONS_URL = "https://realtime.hsl.fi/realtime/vehicle-positions/v2/hsl"
HSL_TRIP_UPDATES_URL = "https://realtime.hsl.fi/realtime/trip-updates/v2/hsl"

# Optional Digitransit subscription key (https://portal-api.digitransit.fi/). Empty = public access.
DIGITRANSIT_SUBSCRIPTION_KEY = ""

# Eventstream custom endpoint - resolved at run time, never hard-coded
EVENTSTREAM_ITEM_ID = "00000000-0000-0000-0000-000000000000"
EVENTSTREAM_SOURCE_ID = "00000000-0000-0000-0000-000000000000"

# Fetch intervals (seconds)
VEHICLE_POSITIONS_INTERVAL = 1.2   # HSL refreshes every 1-2 s
TRIP_UPDATES_INTERVAL = 11         # trip updates change less often

# Stop cleanly a little before the next scheduled start so runs never overlap.
# Scheduled hourly -> a 58 min budget leaves a ~2 min handover gap.
MAX_RUNTIME_SECONDS = 58 * 60

# METADATA ********************

# META {
# META   "language": "python",
# META   "language_group": "jupyter_python"
# META }

# MARKDOWN ********************

# ## 3. Imports + resolve the Eventstream connection

# CELL ********************

import json
import time
from datetime import datetime, timezone

from google.transit import gtfs_realtime_pb2
from google.protobuf.json_format import MessageToDict
from azure.eventhub import EventHubProducerClient, EventData

conn_url = (
    f"https://api.fabric.microsoft.com/v1/workspaces/{workspace_id}"
    f"/eventstreams/{EVENTSTREAM_ITEM_ID}/sources/{EVENTSTREAM_SOURCE_ID}/connection"
)
conn = requests.get(conn_url, headers=HEADERS, timeout=60).json()

EVENTSTREAM_CONNECTION_STRING = conn["accessKeys"]["primaryConnectionString"]
EVENTSTREAM_NAME = conn["eventHubName"]

print(f"Eventstream endpoint: {conn['fullyQualifiedNamespace']} / {EVENTSTREAM_NAME}")

# METADATA ********************

# META {
# META   "language": "python",
# META   "language_group": "jupyter_python"
# META }

# MARKDOWN ********************

# ## 4. Fetch helpers

# CELL ********************

def fetch_hsl_gtfs_feed(url: str, subscription_key: str = None, max_retries: int = 3):
    """Fetch an HSL GTFS-RT feed with retry + 429 back-off."""
    headers = {"Accept": "application/x-google-protobuf"}
    if subscription_key:
        headers["digitransit-subscription-key"] = subscription_key

    for attempt in range(max_retries):
        try:
            response = requests.get(url, headers=headers, timeout=30)

            if response.status_code == 429:
                retry_after = response.headers.get("Retry-After")
                wait = int(retry_after) if retry_after else (2 ** attempt * 5)
                print(f"    429 rate limited - retrying in {wait}s "
                      f"(attempt {attempt + 1}/{max_retries})")
                time.sleep(wait)
                continue

            response.raise_for_status()
            feed = gtfs_realtime_pb2.FeedMessage()
            feed.ParseFromString(response.content)
            return feed

        except requests.exceptions.RequestException as e:
            if attempt < max_retries - 1:
                wait = 2 ** attempt * 5
                print(f"    request error: {e} - retrying in {wait}s")
                time.sleep(wait)
            else:
                raise

    raise requests.exceptions.HTTPError(f"Failed after {max_retries} retries")


def wrap_event(entity, event_type: str) -> dict:
    """Wrap a GTFS-RT entity into the unified event envelope."""
    return {
        "timestamp": datetime.now(timezone.utc).isoformat(),
        "type": event_type,
        "transport_type": "hsl",
        "content": MessageToDict(entity, preserving_proto_field_name=True),
    }


def fetch_all_vehicle_positions(verbose: bool = False) -> list:
    events = []
    try:
        feed = fetch_hsl_gtfs_feed(HSL_VEHICLE_POSITIONS_URL, DIGITRANSIT_SUBSCRIPTION_KEY)
        events = [wrap_event(e, "vehicle_position") for e in feed.entity if e.HasField("vehicle")]
        if verbose:
            print(f"  vehicle positions: {len(events)}")
    except Exception as e:
        print(f"  vehicle positions: ERROR - {e}")
    return events


def fetch_all_trip_updates(verbose: bool = False) -> list:
    events = []
    try:
        feed = fetch_hsl_gtfs_feed(HSL_TRIP_UPDATES_URL, DIGITRANSIT_SUBSCRIPTION_KEY)
        events = [wrap_event(e, "trip_update") for e in feed.entity if e.HasField("trip_update")]
        if verbose:
            print(f"  trip updates: {len(events)}")
    except Exception as e:
        print(f"  trip updates: ERROR - {e}")
    return events

# METADATA ********************

# META {
# META   "language": "python",
# META   "language_group": "jupyter_python"
# META }

# MARKDOWN ********************

# ## 5. Send to Eventstream

# CELL ********************

def send_to_eventstream(producer: EventHubProducerClient, data: list,
                        batch_size: int = 100, verbose: bool = False) -> int:
    """Send unified events to the Fabric Eventstream custom endpoint."""
    total_sent = 0

    for i in range(0, len(data), batch_size):
        chunk = data[i:i + batch_size]
        batch = producer.create_batch()

        for event in chunk:
            try:
                batch.add(EventData(json.dumps(event)))
            except ValueError:
                producer.send_batch(batch)
                total_sent += len(batch)
                batch = producer.create_batch()
                batch.add(EventData(json.dumps(event)))

        if len(batch) > 0:
            producer.send_batch(batch)
            total_sent += len(batch)

        if verbose:
            print(f"  sent batch {i // batch_size + 1}, running total {total_sent}")

    return total_sent

# METADATA ********************

# META {
# META   "language": "python",
# META   "language_group": "jupyter_python"
# META }

# MARKDOWN ********************

# ## 6. Continuous pipeline

# CELL ********************

def run_hsl_pipeline(vehicle_positions_interval: float = None,
                     trip_updates_interval: float = None,
                     max_runtime_seconds: float = None,
                     verbose: bool = False):
    """Continuously poll HSL and forward to the Eventstream until the runtime budget is used up."""
    vp_interval = vehicle_positions_interval or VEHICLE_POSITIONS_INTERVAL
    tu_interval = trip_updates_interval or TRIP_UPDATES_INTERVAL
    budget = max_runtime_seconds or MAX_RUNTIME_SECONDS

    started = time.time()
    iteration = 0
    total_vp = 0
    total_tu = 0
    last_vp_fetch = 0.0
    last_tu_fetch = 0.0

    print("Starting HSL real-time pipeline")
    print(f"  vehicle positions every {vp_interval}s | trip updates every {tu_interval}s")
    print(f"  runtime budget {budget / 60:.0f} min")
    print("=" * 60)

    # One producer for the whole run - reconnecting per cycle is what made the original slow
    producer = EventHubProducerClient.from_connection_string(
        conn_str=EVENTSTREAM_CONNECTION_STRING,
        eventhub_name=EVENTSTREAM_NAME,
    )

    try:
        while time.time() - started < budget:
            now = time.time()
            all_events = []

            if now - last_vp_fetch >= vp_interval:
                all_events.extend(fetch_all_vehicle_positions(verbose=verbose))
                last_vp_fetch = now

            if now - last_tu_fetch >= tu_interval:
                all_events.extend(fetch_all_trip_updates(verbose=verbose))
                last_tu_fetch = now

            if all_events:
                try:
                    sent = send_to_eventstream(producer, all_events, verbose=verbose)
                    total_vp += sum(1 for e in all_events if e["type"] == "vehicle_position")
                    total_tu += sum(1 for e in all_events if e["type"] == "trip_update")
                    iteration += 1
                    if iteration % 25 == 0 or verbose:
                        elapsed = (time.time() - started) / 60
                        print(f"  cycle {iteration} | +{sent} | vp {total_vp} | tu {total_tu} "
                              f"| {elapsed:.1f} min")
                except Exception as e:
                    print(f"  send error in cycle {iteration + 1}: {e}")

            next_fetch = min(last_vp_fetch + vp_interval, last_tu_fetch + tu_interval)
            time.sleep(max(0, next_fetch - time.time()))

    except KeyboardInterrupt:
        print("\nPipeline stopped by user")
    finally:
        producer.close()

    print("\nFinal statistics")
    print(f"  cycles: {iteration}")
    print(f"  vehicle position events: {total_vp}")
    print(f"  trip update events: {total_tu}")
    print(f"  total: {total_vp + total_tu}")


run_hsl_pipeline(verbose=False)

# METADATA ********************

# META {
# META   "language": "python",
# META   "language_group": "jupyter_python"
# META }

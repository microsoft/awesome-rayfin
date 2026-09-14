"""Step 7 - schedule the producer notebook hourly.

The notebook runs for a 58 minute budget and then exits, so an hourly trigger hands over cleanly
without two runs overlapping. It also stands down on its own if an older run is still active.
"""

import json
from datetime import datetime, timedelta, timezone

from _fabric import FABRIC_API, call, need, save_state, workspace


def main() -> None:
    notebook_id = need("notebook_id")
    url = f"{FABRIC_API}/workspaces/{workspace()}/items/{notebook_id}/jobs/RunNotebook/schedules"

    status, _headers, existing = call("GET", url)
    if status == 200 and existing.get("value"):
        schedule = existing["value"][0]
        print(f"schedule already exists: {schedule['id']} (enabled={schedule.get('enabled')})")
        save_state(schedule_id=schedule["id"])
        return

    start = datetime.now(timezone.utc).replace(microsecond=0, tzinfo=None)
    body = {
        "enabled": True,
        "configuration": {
            "type": "Cron",
            "interval": 60,
            "startDateTime": start.isoformat(),
            "endDateTime": (start + timedelta(days=365)).isoformat(),
            "localTimeZoneId": "UTC",
        },
    }
    status, _headers, created = call("POST", url, body)
    print(f"schedule: HTTP {status}")
    print(json.dumps(created, indent=2)[:600] if created else "")
    if status in (200, 201) and isinstance(created, dict):
        save_state(schedule_id=created.get("id"))


if __name__ == "__main__":
    main()

"""Download real room bookings from the NavigaTUM calendar API.

PLAN Phase 2, step 3, and the reason this project can claim its utilisation figures are real. The
endpoint returns TUMonline's actual lecture bookings per room — course titles, start and end times,
week after week — for every room that publishes a calendar.

⚠️ **Baked, never called live** (PLAN D4). The app must survive a conference network and must not
put a demo's load on a student-run service, so a full reference semester is fetched once and
written to disk. Nothing in the browser talks to NavigaTUM.

⚠️ **A full semester, not a sample week.** `Auslastung` computed from one Tuesday is an anecdote.
The window comes from the AOI config (`rooms.referenceSemester`) and includes the lecture-free
weeks, which show up in the result as genuinely empty — that is the truth about a semester, not a
defect to be smoothed away.

Output (data/raw/navigatum/<aoi>/):
  calendar.jsonl   one JSON object per booking, appended as it arrives so a run resumes
  calendar.json    which rooms were asked, and what came back

Usage
  python tools/geodata/fetch_navigatum_calendar.py --aoi garching
"""

from __future__ import annotations

import argparse
import json
import time
import urllib.error
import urllib.request
from datetime import datetime, timedelta

from aoi import cache_dir, load_aoi

USER_AGENT = "Campus-Insights/0.1 (open geodata pipeline; academic demo)"
CALENDAR_URL = "https://nav.tum.de/api/calendar"


def post(ids: list[str], start: str, end: str, attempts: int = 4) -> dict:
    body = json.dumps({"ids": ids, "start_after": start, "end_before": end}).encode()
    last: Exception | None = None
    for attempt in range(attempts):
        try:
            request = urllib.request.Request(
                CALENDAR_URL,
                data=body,
                headers={"User-Agent": USER_AGENT, "Content-Type": "application/json"},
                method="POST",
            )
            with urllib.request.urlopen(request, timeout=120) as response:  # noqa: S310
                return json.loads(response.read())
        except (urllib.error.HTTPError, urllib.error.URLError, TimeoutError) as exc:
            last = exc
            wait = 5 * (attempt + 1)
            print(f"    retrying batch in {wait}s ({exc})")
            time.sleep(wait)
    raise RuntimeError(f"calendar request failed: {last}")


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--aoi", default="garching")
    parser.add_argument("--batch", type=int, default=10, help="rooms per request")
    parser.add_argument("--force", action="store_true")
    args = parser.parse_args()

    cfg = load_aoi(args.aoi)
    rooms_cfg = cfg.get("rooms")
    if not rooms_cfg:
        print(f"AOI '{cfg['id']}' declares no `rooms` block — nothing to fetch.")
        return

    out_dir = cache_dir("raw", "navigatum", cfg["id"])
    rooms_path = out_dir / "rooms.json"
    if not rooms_path.exists():
        raise SystemExit(f"{rooms_path} not found — run fetch_navigatum.py first")

    rooms = json.loads(rooms_path.read_text(encoding="utf-8"))
    candidates = sorted({r["code"] for r in rooms if r.get("hasCalendar")})
    if not candidates:
        print("no room publishes a calendar — nothing to fetch")
        return

    semester = rooms_cfg["referenceSemester"]
    start = f"{semester['startDate']}T00:00:00Z"
    end = f"{semester['endDate']}T23:59:59Z"
    print(f"semester {semester['id']}: {semester['startDate']} .. {semester['endDate']}")
    print(f"{len(candidates)} rooms publish a calendar")

    events_path = out_dir / "calendar.jsonl"
    done: set[str] = set()
    if events_path.exists() and not args.force:
        for line in events_path.read_text(encoding="utf-8").splitlines():
            if line.strip():
                try:
                    done.add(json.loads(line)["room"])
                except (json.JSONDecodeError, KeyError):
                    continue
        print(f"  {len(done)} rooms already cached")
    elif args.force and events_path.exists():
        events_path.unlink()

    todo = [code for code in candidates if code not in done]
    total_events = 0

    with events_path.open("a", encoding="utf-8") as sink:
        for index in range(0, len(todo), args.batch):
            batch = todo[index : index + args.batch]
            payload = post(batch, start, end)
            for room_id, value in payload.items():
                events = value.get("events", []) if isinstance(value, dict) else value
                for event in events or []:
                    sink.write(
                        json.dumps(
                            {
                                "room": room_id,
                                "start": event.get("start_at"),
                                "end": event.get("end_at"),
                                "type": event.get("entry_type"),
                                "title": event.get("title_de") or event.get("title_en"),
                            },
                            ensure_ascii=False,
                        )
                        + "\n"
                    )
                    total_events += 1
                # A room with no bookings still gets a marker line, so a resumed run knows it was
                # asked. Without this, empty rooms are re-fetched on every run for ever.
                if not events:
                    sink.write(
                        json.dumps({"room": room_id, "start": None, "empty": True}) + "\n"
                    )
            sink.flush()
            print(
                f"  [{min(index + args.batch, len(todo)):>4}/{len(todo)}] "
                f"{total_events} events so far"
            )
            time.sleep(0.5)

    # A quick shape check: how much of the semester actually carries bookings.
    weeks = (
        datetime.fromisoformat(semester["endDate"]) - datetime.fromisoformat(semester["startDate"])
    ) // timedelta(weeks=1)
    summary = {
        "semester": semester,
        "weeks": int(weeks),
        "roomsAsked": len(candidates),
        "eventsFetched": total_events,
        "source": "NavigaTUM /api/calendar (TUMonline)",
    }
    (out_dir / "calendar.json").write_text(
        json.dumps(summary, ensure_ascii=False, indent=2), encoding="utf-8"
    )
    print(f"\n{total_events} bookings over ~{weeks} weeks -> {events_path}")


if __name__ == "__main__":
    main()

"""Where the timetable comes from — and an honest answer about whether Untis is reachable.

The app is fed by files on disk today: `read_untis_gpu.py` turns OTH's GPU exports into the tables
`ScheduleStore` loads. That is a real integration and it works, but it is a **manual** one, and the
demo sentence "only the configuration is missing" was not true while nothing in the product could
even attempt to talk to WebUntis. This module is the seam that makes the sentence checkable.

Two sources are described, and the difference between them is the point:

* ``file``      — what is actually serving the app right now, with the row counts and provenance
                  the store already knows. Always present.
* ``webuntis``  — the API. Reports **not configured** until someone supplies a server, a school and
                  a login, and then reports what a real request actually returned.

⚠️ THE TEST MUST NEVER CLAIM A CONNECTION IT DID NOT MAKE. That is the entire value of it. Every
outcome below is derived from something that actually happened on the wire — a DNS failure, a TLS
failure, an HTTP status, a JSON-RPC error code — and "configured" is never reported as "connected".
A green tick that means "the form is filled in" is worse than no tick at all, because it is the
answer somebody will repeat to a customer.

⚠️ WRITE-BACK IS NOT HERE, DELIBERATELY. PLAN §12 and §25.6 make it a decision gate. The mechanism
is known — Untis documents import interfaces and a GPU002-shaped file is what they take — so this
module exposes `writeback_readiness()` describing what would be required, and implements none of
it. Nobody should hear "the AI writes into Untis" before OTH asks for it.
"""

from __future__ import annotations

import ipaddress
import os
import socket
import time
from dataclasses import dataclass
from typing import Any
from urllib.parse import urlparse

#: WebUntis' JSON-RPC entry point. Fixed rather than taken from the caller — see `_safe_endpoint`.
JSONRPC_PATH = "/WebUntis/jsonrpc.do"

#: Short on purpose: this runs inside a request, and a planner pressing "test" wants an answer or a
#: reason, not a spinner. A WebUntis server that cannot answer in this long is a finding in itself.
TIMEOUT_S = 8.0

CLIENT_ID = "campus-scheduler-readonly"


@dataclass(frozen=True)
class UntisConfig:
    server: str = ""
    school: str = ""
    username: str = ""
    password: str = ""

    @classmethod
    def from_env(cls) -> "UntisConfig":
        return cls(
            server=os.environ.get("UNTIS_SERVER", "").strip(),
            school=os.environ.get("UNTIS_SCHOOL", "").strip(),
            username=os.environ.get("UNTIS_USER", "").strip(),
            password=os.environ.get("UNTIS_PASSWORD", ""),
        )

    @property
    def configured(self) -> bool:
        return bool(self.server and self.school and self.username and self.password)

    def public(self) -> dict[str, Any]:
        """What may be shown in a UI. ⚠️ The password is not in here and must never be."""
        return {
            "server": self.server,
            "school": self.school,
            "username": self.username,
            "passwordSet": bool(self.password),
        }


class UnsafeTarget(ValueError):
    """The requested server is not somewhere this backend is willing to send credentials."""


def _safe_endpoint(server: str) -> str:
    """Turn a user-supplied server into a URL this backend is allowed to call.

    ⚠️ THIS IS AN SSRF GUARD AND IT IS THE REASON THE FUNCTION EXISTS. The connection test takes a
    host from whoever is using the panel and makes the SERVER fetch it, which is the classic
    server-side request forgery shape: `http://169.254.169.254/…` reaches the cloud instance
    metadata endpoint, `http://127.0.0.1:8000/…` reaches this very process, and either would be
    performed with the backend's own network position and returned to the caller.

    So: https only, no credentials or port smuggled in the authority, the path is OURS rather than
    theirs, and every address the hostname resolves to must be a public one. Resolving BEFORE the
    request is deliberate — checking the string would pass `localtest.me`, which is a public name
    that resolves to 127.0.0.1.
    """
    raw = server.strip()
    if not raw:
        raise UnsafeTarget("no server given")
    if "://" not in raw:
        raw = f"https://{raw}"

    parsed = urlparse(raw)
    if parsed.scheme != "https":
        # Credentials go over this. There is no version of "test my timetable server" that is
        # worth sending a password in clear.
        raise UnsafeTarget("only https is allowed")
    if parsed.username or parsed.password:
        raise UnsafeTarget("credentials in the URL are not accepted")
    host = parsed.hostname
    if not host:
        raise UnsafeTarget("no host in the server address")

    try:
        infos = socket.getaddrinfo(host, parsed.port or 443, proto=socket.IPPROTO_TCP)
    except socket.gaierror as exc:
        raise UnsafeTarget(f"host does not resolve: {exc.strerror or exc}") from exc

    for info in infos:
        addr = ipaddress.ip_address(info[4][0])
        if (
            addr.is_private
            or addr.is_loopback
            or addr.is_link_local
            or addr.is_reserved
            or addr.is_multicast
            or addr.is_unspecified
        ):
            raise UnsafeTarget(f"{host} resolves to a non-public address ({addr})")

    port = f":{parsed.port}" if parsed.port and parsed.port != 443 else ""
    return f"https://{host}{port}{JSONRPC_PATH}"


def _result(ok: bool, state: str, message: str, **extra: Any) -> dict[str, Any]:
    out = {"ok": ok, "state": state, "message": message}
    out.update(extra)
    return out


def test_connection(cfg: UntisConfig) -> dict[str, Any]:
    """Actually try to log in, and report exactly what came back.

    States are distinguished rather than collapsed, because "it does not work" is not an actionable
    answer and the distinction is what tells OTH which of THEM has to do something:

      unconfigured      nothing to try — this is not a failure
      blocked           the address is refused by us (see `_safe_endpoint`)
      unreachable       DNS, TLS or connect failed — network or hostname
      http-error        the server answered, but not with a WebUntis response
      rejected          WebUntis answered and said no — usually credentials or school key
      connected         authenticated, and a read actually returned data
    """
    if not cfg.configured:
        missing = [
            name
            for name, value in (
                ("server", cfg.server),
                ("school", cfg.school),
                ("username", cfg.username),
                ("password", cfg.password),
            )
            if not value
        ]
        return _result(
            False, "unconfigured",
            f"Not configured — missing: {', '.join(missing)}.",
            missing=missing,
        )

    try:
        endpoint = _safe_endpoint(cfg.server)
    except UnsafeTarget as exc:
        return _result(False, "blocked", str(exc))

    # ⚠️ Imported here, not at module scope. The backend starts on every container revision and this
    # path runs only when somebody presses a button; paying the import at boot would slow every
    # start for a feature almost no request uses.
    import httpx

    started = time.perf_counter()
    payload = {
        "id": CLIENT_ID,
        "method": "authenticate",
        "params": {"user": cfg.username, "password": cfg.password, "client": CLIENT_ID},
        "jsonrpc": "2.0",
    }

    try:
        with httpx.Client(timeout=TIMEOUT_S, follow_redirects=False) as client:
            response = client.post(
                endpoint, params={"school": cfg.school}, json=payload,
                headers={"User-Agent": CLIENT_ID},
            )
    except httpx.HTTPError as exc:
        return _result(
            False, "unreachable",
            f"Could not reach {endpoint}: {type(exc).__name__}.",
            endpoint=endpoint,
        )

    elapsed_ms = round((time.perf_counter() - started) * 1000)

    if response.status_code != 200:
        return _result(
            False, "http-error",
            f"{endpoint} answered HTTP {response.status_code}.",
            endpoint=endpoint, httpStatus=response.status_code, elapsedMs=elapsed_ms,
        )

    try:
        body = response.json()
    except ValueError:
        # A login page or a proxy notice, not a WebUntis endpoint. Saying so beats "unknown error".
        return _result(
            False, "http-error",
            "The server answered, but not with JSON — this does not look like a WebUntis "
            "JSON-RPC endpoint.",
            endpoint=endpoint, elapsedMs=elapsed_ms,
        )

    if isinstance(body, dict) and body.get("error"):
        err = body["error"]
        return _result(
            False, "rejected",
            f"WebUntis refused the login: {err.get('message', 'no message')} "
            f"(code {err.get('code')}).",
            endpoint=endpoint, untisCode=err.get("code"), elapsedMs=elapsed_ms,
        )

    session = (body or {}).get("result") or {}
    session_id = session.get("sessionId")
    if not session_id:
        return _result(
            False, "rejected",
            "WebUntis answered without a session id — the login did not succeed.",
            endpoint=endpoint, elapsedMs=elapsed_ms,
        )

    # Authenticated. Now prove READ access rather than assuming it: a session that cannot read a
    # room list is not an integration, and finding that out here is cheaper than finding it out
    # halfway through building the adapter.
    rooms = None
    read_error = None
    try:
        with httpx.Client(timeout=TIMEOUT_S, follow_redirects=False) as client:
            cookies = {"JSESSIONID": session_id, "schoolname": cfg.school}
            probe = client.post(
                endpoint, params={"school": cfg.school},
                json={"id": CLIENT_ID, "method": "getRooms", "params": {}, "jsonrpc": "2.0"},
                headers={"User-Agent": CLIENT_ID}, cookies=cookies,
            )
            data = probe.json() if probe.status_code == 200 else {}
            if isinstance(data, dict) and isinstance(data.get("result"), list):
                rooms = len(data["result"])
            elif isinstance(data, dict) and data.get("error"):
                read_error = data["error"].get("message")
            client.post(
                endpoint, params={"school": cfg.school},
                json={"id": CLIENT_ID, "method": "logout", "params": {}, "jsonrpc": "2.0"},
                headers={"User-Agent": CLIENT_ID}, cookies=cookies,
            )
    except (httpx.HTTPError, ValueError) as exc:
        read_error = type(exc).__name__

    return _result(
        True, "connected",
        f"Authenticated as {cfg.username}."
        + (f" Read {rooms} rooms." if rooms is not None
           else f" Login worked, but the room list could not be read ({read_error})."),
        endpoint=endpoint,
        elapsedMs=elapsed_ms,
        rooms=rooms,
        personType=session.get("personType"),
        klasseId=session.get("klasseId"),
        readError=read_error,
    )


def describe_file_source(store: Any) -> dict[str, Any]:
    """What is feeding the app right now, taken from the store rather than described from memory."""
    try:
        prov = store.provenance()
    except Exception:  # noqa: BLE001 — a broken provenance must not take the panel down
        prov = {}
    return {
        "id": "file",
        "label": "Untis GPU export (Datei)",
        "active": True,
        "state": "connected",
        "sessions": len(getattr(store, "sessions", []) or []),
        "rooms": len(getattr(store, "rooms", []) or []),
        "teachers": len(getattr(store, "teachers", []) or []),
        "timetableProvenance": prov.get("timetableProvenance"),
        "note": (
            "Dateibasiert: die GPU-Exporte werden von tools/data/read_untis_gpu.py eingelesen. "
            "Das ist eine echte Integration, aber ein manueller Schritt."
        ),
    }


def writeback_readiness() -> dict[str, Any]:
    """What write-back would take. ⚠️ Description only — see PLAN §12 and §25.6.

    Written down because "we could write back" is the kind of claim that gets made in a room and
    then has to be true. The route exists in Untis; the decision does not exist yet at OTH.
    """
    return {
        "implemented": False,
        "decision": "gate",
        "mechanism": (
            "Untis dokumentiert Import-Schnittstellen; ein GPU002-förmiger Export in derselben "
            "Feldreihenfolge ist der technisch naheliegende Weg zurück."
        ),
        "requires": [
            "Schriftliche Freigabe von OTH, dass zurückgeschrieben werden darf",
            "Ein Untis-Konto mit Schreibrecht — das Lesekonto reicht ausdrücklich nicht",
            "Eine Testinstanz, denn ein fehlerhafter Import überschreibt einen echten Stundenplan",
            "Ein Rückweg: was passiert, wenn ein geschriebener Plan zurückgenommen werden muss",
        ],
    }

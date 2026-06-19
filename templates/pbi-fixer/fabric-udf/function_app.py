"""
Power BI Fixer — Fabric User Data Functions (Python)
====================================================

Backend for the Rayfin "Power BI Fixer" app. The Rayfin static frontend cannot
call the Fabric management REST API directly (it only holds a Rayfin session
token, and the Fabric/Power BI REST endpoints don't allow browser CORS for
arbitrary origins), so every read/write happens here, server-side.

Auth model (no service principal, no Key Vault — writes run as the signed-in
user):
  * The browser signs the user in with MSAL and acquires a Power BI service
    token (scope ``https://analysis.windows.net/powerbi/api/.default``).
  * That same token is used both to *invoke* the function (Authorization
    header, requires the ``UserDataFunction.Execute.All`` delegated permission)
    and is passed in the request body as ``fabricToken`` so this function can
    call the Fabric REST API on the user's behalf.

The Fabric REST endpoints under ``https://api.fabric.microsoft.com`` accept the
Power BI service audience token, so a single token covers invocation + REST.

NOTE: User Data Functions parameter names must be camelCase (no underscores),
so the public contract uses ``fabricToken``, ``workspaceId``, ``reportId``,
``fixerId``, ``scanOnly``. Only the standard library plus the pre-installed
``fabric-user-data-functions`` package are used (urllib for HTTP) - no extra
libraries to provision.

Functions
---------
  list_workspaces(fabricToken)                                   -> list
  list_reports(fabricToken, workspaceId)                         -> list
  apply_report_fixer(fabricToken, workspaceId, reportId,
                     fixerId, scanOnly)                          -> dict
"""

import base64
import json
import time
import urllib.error
import urllib.parse
import urllib.request

import fabric.functions as fn

udf = fn.UserDataFunctions()

# --------------------------------------------------------------------------- #
# Constants
# --------------------------------------------------------------------------- #
FABRIC_BASE = "https://api.fabric.microsoft.com/v1"
PBI_BASE = "https://api.powerbi.com/v1.0/myorg"

# Generic proxy host map (api -> base url). Constrained to these two hosts so the
# proxy cannot be abused as an open SSRF relay.
PROXY_HOSTS = {"fabric": FABRIC_BASE, "pbi": PBI_BASE}

TARGET_W = 1280
TARGET_H = 720
PIE_TYPES = {"pieChart", "donutChart", "funnel"}

# --------------------------------------------------------------------------- #
# GitHub device-flow + Copilot (for the Translations tab — real AI captions).
#
# The static frontend cannot reach github.com / api.githubcopilot.com directly
# (those endpoints have no browser CORS and the device flow is designed for
# native/CLI clients), so the login + token exchange + chat completion all run
# here, server-side. We use the well-known VS Code Copilot device-flow client
# id; the browser only ever holds the resulting short-lived GitHub token and
# passes it back in for each translate call (same pattern as ``fabricToken``).
# --------------------------------------------------------------------------- #
GITHUB_CLIENT_ID = "01ab8ac9400c4e429b23"  # VS Code Copilot device-flow client
GITHUB_DEVICE_CODE_URL = "https://github.com/login/device/code"
GITHUB_OAUTH_TOKEN_URL = "https://github.com/login/oauth/access_token"
GITHUB_DEVICE_GRANT = "urn:ietf:params:oauth:grant-type:device_code"
COPILOT_TOKEN_URL = "https://api.github.com/copilot_internal/v2/token"
COPILOT_API_BASE = "https://api.githubcopilot.com"
COPILOT_EDITOR_VERSION = "vscode/1.90.0"
TRANSLATE_MODEL = "gpt-4o-mini"
# Max captions per Copilot request — keeps the JSON response well within limits.
TRANSLATE_BATCH = 40
# Max M steps per Copilot request when generating inline step comments.
COMMENT_BATCH = 30


# --------------------------------------------------------------------------- #
# Fabric REST + long-running-operation helpers (stdlib urllib)
# --------------------------------------------------------------------------- #
class _Resp:
    """Minimal response wrapper (status, headers, text)."""

    def __init__(self, status: int, headers: dict, text: str):
        self.status = status
        self.headers = headers
        self.text = text

    def json(self):
        return json.loads(self.text) if self.text else {}


def _request(fabric_token: str, url: str, method: str = "GET",
             body: dict | None = None) -> _Resp:
    data = json.dumps(body).encode("utf-8") if body is not None else None
    req = urllib.request.Request(url=url, data=data, method=method)
    req.add_header("Authorization", f"Bearer {fabric_token}")
    req.add_header("Content-Type", "application/json")
    try:
        with urllib.request.urlopen(req, timeout=100) as r:
            return _Resp(r.status, dict(r.headers), r.read().decode("utf-8"))
    except urllib.error.HTTPError as e:
        return _Resp(e.code, dict(e.headers), e.read().decode("utf-8"))


def _fabric_request(fabric_token: str, path: str, method: str = "GET",
                    body: dict | None = None) -> _Resp:
    """Call a Fabric REST endpoint and raise on >=400 (except 202)."""
    resp = _request(fabric_token, f"{FABRIC_BASE}{path}", method, body)
    if resp.status >= 400:
        raise RuntimeError(
            f"Fabric REST {method} {path} failed ({resp.status}): {resp.text}"
        )
    return resp


def _resolve_lro(fabric_token: str, first: _Resp) -> dict:
    """Resolve a Fabric long-running operation, returning the final result body.

    Two distinct 202 + Location shapes are handled, because both Fabric LRO
    *operations* and Fabric *job instances* (e.g. an on-demand ``RunNotebook``
    job) reply with 202 + a ``Location`` status resource:

      * LRO operation  — terminal ``status`` is ``Succeeded`` / ``Failed``; on
        success the result is fetched from the operation's ``/result``.
      * Job instance   — terminal ``status`` is ``Completed`` / ``Failed`` /
        ``Cancelled`` / ``Deduped``; the polled instance body *is* the result
        (there is no ``/result`` sub-resource), so it is returned as-is.
    """
    if first.status != 202:
        return first.json()

    op_url = first.headers.get("Location")
    if not op_url:
        raise RuntimeError("LRO 202 without Location header")
    retry_after = int(first.headers.get("Retry-After", "2") or "2")

    for _ in range(120):
        time.sleep(retry_after)
        st = _request(fabric_token, op_url, "GET")
        body = st.json()
        status = body.get("status")
        # LRO-operation success → fetch the operation result resource.
        if status == "Succeeded":
            result_url = st.headers.get("Location", f"{op_url}/result")
            r = _request(fabric_token, result_url, "GET")
            if r.status == 200:
                return r.json()
            return body
        # Job-instance success (RunNotebook etc.) → the instance body is the result.
        if status == "Completed":
            return body
        # Terminal failure for both shapes.
        if status == "Failed":
            raise RuntimeError(f"LRO failed: {json.dumps(body)}")
        # Other terminal job-instance states — return so the caller can inspect.
        if status in ("Cancelled", "Deduped"):
            return body
        retry_after = int(st.headers.get("Retry-After", str(retry_after)) or retry_after)

    raise RuntimeError("LRO timed out")


# --------------------------------------------------------------------------- #
# PBIR helpers
# --------------------------------------------------------------------------- #
def _b64decode(s: str) -> str:
    return base64.b64decode(s).decode("utf-8")


def _b64encode(s: str) -> str:
    return base64.b64encode(s.encode("utf-8")).decode("utf-8")


def _is_page_part(part: dict) -> bool:
    return part.get("path", "").endswith("/page.json")


def _is_visual_part(part: dict) -> bool:
    return part.get("path", "").endswith("/visual.json")


# --------------------------------------------------------------------------- #
# Fixers — operate in place on the PBIR definition dict
# --------------------------------------------------------------------------- #
def _fix_page_size(definition: dict, scan_only: bool) -> dict:
    findings = []
    changed = 0
    for part in definition.get("parts", []):
        if not _is_page_part(part):
            continue
        try:
            doc = json.loads(_b64decode(part["payload"]))
        except Exception:
            continue
        w = doc.get("width")
        h = doc.get("height")
        if not isinstance(w, (int, float)) or not isinstance(h, (int, float)):
            continue
        if w <= 0 or h <= 0:
            continue
        if w == TARGET_W and h == TARGET_H:
            continue
        findings.append({"path": part["path"], "detail": f"{w}x{h} -> {TARGET_W}x{TARGET_H}"})
        if not scan_only:
            doc["width"] = TARGET_W
            doc["height"] = TARGET_H
            part["payload"] = _b64encode(json.dumps(doc))
            changed += 1
    return {
        "fixerId": "Fix_PageSize",
        "scanOnly": scan_only,
        "matched": len(findings),
        "changed": changed,
        "findings": findings,
        "applied": (not scan_only) and changed > 0,
    }


def _fix_pie_chart(definition: dict, scan_only: bool) -> dict:
    findings = []
    changed = 0
    for part in definition.get("parts", []):
        if not _is_visual_part(part):
            continue
        try:
            doc = json.loads(_b64decode(part["payload"]))
        except Exception:
            continue
        visual = doc.get("visual") or {}
        vt = visual.get("visualType")
        if not isinstance(vt, str) or vt not in PIE_TYPES:
            continue
        findings.append({"path": part["path"], "detail": f"{vt} -> barChart"})
        if not scan_only:
            doc["visual"]["visualType"] = "barChart"
            part["payload"] = _b64encode(json.dumps(doc))
            changed += 1
    return {
        "fixerId": "Fix_PieChart",
        "scanOnly": scan_only,
        "matched": len(findings),
        "changed": changed,
        "findings": findings,
        "applied": (not scan_only) and changed > 0,
    }


def _fix_show_hidden_visuals(definition: dict, scan_only: bool) -> dict:
    findings = []
    changed = 0
    for part in definition.get("parts", []):
        if not _is_visual_part(part):
            continue
        try:
            doc = json.loads(_b64decode(part["payload"]))
        except Exception:
            continue
        if not doc.get("isHidden"):
            continue
        vt = (doc.get("visual") or {}).get("visualType", "visual")
        findings.append({"path": part["path"], "detail": f"hidden {vt} -> visible"})
        if not scan_only:
            doc["isHidden"] = False
            part["payload"] = _b64encode(json.dumps(doc))
            changed += 1
    return {
        "fixerId": "Fix_ShowHiddenVisuals",
        "scanOnly": scan_only,
        "matched": len(findings),
        "changed": changed,
        "findings": findings,
        "applied": (not scan_only) and changed > 0,
    }


def _fix_show_hidden_pages(definition: dict, scan_only: bool) -> dict:
    findings = []
    changed = 0
    for part in definition.get("parts", []):
        if not _is_page_part(part):
            continue
        try:
            doc = json.loads(_b64decode(part["payload"]))
        except Exception:
            continue
        if doc.get("visibility") != "HiddenInViewMode":
            continue
        name = doc.get("displayName", part["path"])
        findings.append({"path": part["path"], "detail": f"hidden page '{name}' -> visible"})
        if not scan_only:
            doc.pop("visibility", None)
            part["payload"] = _b64encode(json.dumps(doc))
            changed += 1
    return {
        "fixerId": "Fix_ShowHiddenPages",
        "scanOnly": scan_only,
        "matched": len(findings),
        "changed": changed,
        "findings": findings,
        "applied": (not scan_only) and changed > 0,
    }


FIXERS = {
    "Fix_PageSize": _fix_page_size,
    "Fix_PieChart": _fix_pie_chart,
    "Fix_ShowHiddenVisuals": _fix_show_hidden_visuals,
    "Fix_ShowHiddenPages": _fix_show_hidden_pages,
}


# --------------------------------------------------------------------------- #
# User Data Functions  (camelCase parameter names are required)
# --------------------------------------------------------------------------- #
@udf.function()
def list_workspaces(fabricToken: str) -> list:
    """List workspaces visible to the signed-in user."""
    resp = _fabric_request(fabricToken, "/workspaces")
    value = resp.json().get("value", [])
    return [{"id": w["id"], "displayName": w["displayName"]} for w in value]


@udf.function()
def list_reports(fabricToken: str, workspaceId: str) -> list:
    """List Power BI reports in a workspace."""
    resp = _fabric_request(fabricToken, f"/workspaces/{workspaceId}/reports")
    value = resp.json().get("value", [])
    return [{"id": r["id"], "displayName": r["displayName"]} for r in value]


@udf.function()
def apply_report_fixer(fabricToken: str, workspaceId: str, reportId: str,
                       fixerId: str, scanOnly: bool) -> dict:
    """Scan or apply a report fixer.

    fixerId   : "Fix_PageSize" | "Fix_PieChart"
    scanOnly  : when True only report findings; when False write changes back.
    """
    fixer = FIXERS.get(fixerId)
    if fixer is None:
        raise ValueError(f"Unknown fixerId: {fixerId}")

    # 1. getDefinition (PBIR)
    get_res = _fabric_request(
        fabricToken,
        f"/workspaces/{workspaceId}/reports/{reportId}/getDefinition?format=PBIR",
        method="POST",
    )
    envelope = _resolve_lro(fabricToken, get_res)
    definition = envelope.get("definition", envelope)
    if not definition.get("parts"):
        raise RuntimeError("No PBIR definition parts returned")

    # 2. scan / mutate
    result = fixer(definition, scanOnly)

    # 3. updateDefinition when applying and something changed
    if not scanOnly and result["changed"] > 0:
        upd_res = _fabric_request(
            fabricToken,
            f"/workspaces/{workspaceId}/reports/{reportId}/updateDefinition",
            method="POST",
            body={"definition": definition},
        )
        _resolve_lro(fabricToken, upd_res)

    return result


@udf.function()
def fabric_proxy(fabricToken: str, api: str, path: str, method: str = "GET",
                 body: str = "") -> dict:
    """Generic, constrained forwarder for Fabric / Power BI REST.

    Lets the static frontend run all read-only exploration (semantic models,
    relationships, report definitions, DAX executeQueries) and definition
    save-backs without a dedicated UDF per call. ``api`` selects the host:

      "fabric" -> https://api.fabric.microsoft.com/v1
      "pbi"    -> https://api.powerbi.com/v1.0/myorg

    ``body`` is a JSON string (empty string means no body). 202 long-running
    operations are resolved server-side and the final result body is returned.
    Only the two trusted hosts above are reachable, so this is not an open
    SSRF relay.

    Returns ``{"status": <int>, "body": <parsed json>}``.
    """
    base = PROXY_HOSTS.get(api)
    if base is None:
        raise ValueError(f"Unknown api '{api}' (expected 'fabric' or 'pbi')")
    if not isinstance(path, str) or not path.startswith("/"):
        raise ValueError("path must be a string starting with '/'")

    parsed_body = json.loads(body) if body else None
    resp = _request(fabricToken, f"{base}{path}", method.upper(), parsed_body)

    if resp.status == 202:
        return {"status": 200, "body": _resolve_lro(fabricToken, resp)}
    if resp.status >= 400:
        raise RuntimeError(
            f"{api} {method} {path} failed ({resp.status}): {resp.text}"
        )
    return {"status": resp.status, "body": resp.json()}


# --------------------------------------------------------------------------- #
# GitHub device-flow + Copilot helpers (stdlib urllib)
# --------------------------------------------------------------------------- #
def _github_form_post(url: str, fields: dict, auth: str | None = None) -> tuple:
    """POST application/x-www-form-urlencoded to a GitHub OAuth endpoint and
    return ``(status, parsed_json)``. GitHub returns JSON when ``Accept:
    application/json`` is set."""
    data = urllib.parse.urlencode(fields).encode("utf-8")
    req = urllib.request.Request(url=url, data=data, method="POST")
    req.add_header("Accept", "application/json")
    req.add_header("Content-Type", "application/x-www-form-urlencoded")
    if auth:
        req.add_header("Authorization", auth)
    try:
        with urllib.request.urlopen(req, timeout=30) as r:
            return r.status, json.loads(r.read().decode("utf-8") or "{}")
    except urllib.error.HTTPError as e:
        return e.code, json.loads(e.read().decode("utf-8") or "{}")


def _copilot_token(github_token: str) -> str:
    """Exchange a GitHub OAuth token (gho_…) for a short-lived Copilot API
    token via the copilot_internal endpoint."""
    req = urllib.request.Request(url=COPILOT_TOKEN_URL, method="GET")
    req.add_header("Authorization", f"token {github_token}")
    req.add_header("Accept", "application/json")
    req.add_header("Editor-Version", COPILOT_EDITOR_VERSION)
    try:
        with urllib.request.urlopen(req, timeout=30) as r:
            body = json.loads(r.read().decode("utf-8") or "{}")
    except urllib.error.HTTPError as e:
        raise RuntimeError(
            f"Copilot token exchange failed ({e.code}): {e.read().decode('utf-8')}"
        )
    tok = body.get("token")
    if not tok:
        raise RuntimeError(
            "Copilot token exchange returned no token "
            "(is GitHub Copilot enabled for this account?)"
        )
    return tok


def _copilot_chat(copilot_token: str, body: dict) -> dict:
    """Call the Copilot chat-completions endpoint and return the parsed body."""
    data = json.dumps(body).encode("utf-8")
    req = urllib.request.Request(
        url=f"{COPILOT_API_BASE}/chat/completions", data=data, method="POST"
    )
    req.add_header("Authorization", f"Bearer {copilot_token}")
    req.add_header("Content-Type", "application/json")
    req.add_header("Editor-Version", COPILOT_EDITOR_VERSION)
    req.add_header("Copilot-Integration-Id", "vscode-chat")
    try:
        with urllib.request.urlopen(req, timeout=90) as r:
            return json.loads(r.read().decode("utf-8") or "{}")
    except urllib.error.HTTPError as e:
        raise RuntimeError(
            f"Copilot chat failed ({e.code}): {e.read().decode('utf-8')}"
        )


def _translate_batch(captions: list, culture: str, glossary: dict,
                     copilot_token: str) -> list:
    """Translate one batch of captions into ``culture`` via Copilot. Returns a
    list the same length/order as ``captions``; falls back to the source string
    for any item the model fails to return."""
    if not captions:
        return []
    glossary_lines = ""
    if glossary:
        pairs = list(glossary.items())[:200]
        glossary_lines = (
            "\nPreferred terminology (use these exact target translations when "
            "the source matches, case-insensitive):\n"
            + "\n".join(f"  {k} -> {v}" for k, v in pairs)
        )
    system = (
        "You translate Power BI / Fabric semantic-model captions into the "
        f"culture '{culture}'. Translate each input string idiomatically as it "
        "would appear in a business-intelligence report as a table name, column "
        "name, or measure name. Keep proper nouns, acronyms, product names and "
        "brand names unchanged. Preserve the casing style (Title Case stays "
        "Title Case, ALL CAPS stays ALL CAPS, snake_case stays snake_case). Do "
        "not add quotes, punctuation or commentary. Output ONLY a JSON object "
        'of the exact shape {\"translations\": [\"...\", \"...\"]} with the same '
        "number of items, in the same order, as the input list." + glossary_lines
    )
    user = json.dumps({"culture": culture, "sources": captions},
                      ensure_ascii=False)
    body = {
        "model": TRANSLATE_MODEL,
        "messages": [
            {"role": "system", "content": system},
            {"role": "user", "content": user},
        ],
        "temperature": 0.2,
        "response_format": {"type": "json_object"},
        "stream": False,
    }
    data = _copilot_chat(copilot_token, body)
    content = (
        data.get("choices", [{}])[0].get("message", {}).get("content", "")
    )
    try:
        parsed = json.loads(content) if content else {}
    except (ValueError, TypeError):
        parsed = {}
    out = parsed.get("translations") if isinstance(parsed, dict) else None
    if not isinstance(out, list) or len(out) != len(captions):
        return list(captions)
    return [
        (str(t) if t is not None and str(t).strip() else captions[i])
        for i, t in enumerate(out)
    ]


def _comment_batch(snippets: list, copilot_token: str) -> list:
    """Generate one short plain-English comment per M step in ``snippets``.

    The model only DESCRIBES each step — it must never emit M code. Returns a
    list of comment strings the same length/order as ``snippets`` (empty string
    where the model omits one). The caller inserts each as a `//` line before
    the step, so the original M is never modified."""
    if not snippets:
        return []
    system = (
        "You document Power Query (M) scripts used in Power BI / Fabric. For "
        "each input M step, write ONE short plain-English comment (max ~12 "
        "words) describing what that step does — e.g. the data source it "
        "connects to, a filter, a join/merge, a column rename, or a type "
        "change. Do NOT output any M code, do NOT wrap the comment in quotes, "
        "and do NOT prefix it with '//'. Output ONLY a JSON object of the exact "
        'shape {"comments": ["...", "..."]} with the same number of items, in '
        "the same order as the input list."
    )
    user = json.dumps({"steps": snippets}, ensure_ascii=False)
    body = {
        "model": TRANSLATE_MODEL,
        "messages": [
            {"role": "system", "content": system},
            {"role": "user", "content": user},
        ],
        "temperature": 0.2,
        "response_format": {"type": "json_object"},
        "stream": False,
    }
    data = _copilot_chat(copilot_token, body)
    content = (
        data.get("choices", [{}])[0].get("message", {}).get("content", "")
    )
    try:
        parsed = json.loads(content) if content else {}
    except (ValueError, TypeError):
        parsed = {}
    out = parsed.get("comments") if isinstance(parsed, dict) else None
    if not isinstance(out, list) or len(out) != len(snippets):
        return ["" for _ in snippets]
    cleaned = []
    for c in out:
        s = str(c) if c is not None else ""
        s = s.replace("\r", " ").replace("\n", " ").strip()
        while s.startswith("//"):
            s = s[2:].strip()
        cleaned.append(s)
    return cleaned


@udf.function()
def github_device_start() -> dict:
    """Begin the GitHub device-authorisation flow. The browser shows the
    returned ``userCode`` and opens ``verificationUri`` for the user, then polls
    ``github_device_poll`` until authorised."""
    status, body = _github_form_post(
        GITHUB_DEVICE_CODE_URL,
        {"client_id": GITHUB_CLIENT_ID, "scope": "read:user"},
    )
    if status >= 400 or "device_code" not in body:
        raise RuntimeError(f"GitHub device start failed ({status}): {body}")
    return {
        "deviceCode": body["device_code"],
        "userCode": body["user_code"],
        "verificationUri": body.get(
            "verification_uri", "https://github.com/login/device"
        ),
        "interval": body.get("interval", 5),
        "expiresIn": body.get("expires_in", 900),
    }


@udf.function()
def github_device_poll(deviceCode: str) -> dict:
    """Poll once for the device-flow result. Returns ``status`` one of
    ``pending`` / ``authorized`` / ``error``. On ``authorized`` the GitHub OAuth
    token is returned in ``accessToken`` (held only in the browser thereafter)."""
    status, body = _github_form_post(
        GITHUB_OAUTH_TOKEN_URL,
        {
            "client_id": GITHUB_CLIENT_ID,
            "device_code": deviceCode,
            "grant_type": GITHUB_DEVICE_GRANT,
        },
    )
    token = body.get("access_token")
    if token:
        return {"status": "authorized", "accessToken": token}
    err = body.get("error", "unknown_error")
    if err in ("authorization_pending", "slow_down"):
        return {"status": "pending", "error": err}
    return {"status": "error", "error": err}


@udf.function()
def github_translate(githubToken: str, culture: str, sources: str,
                     glossary: str = "") -> dict:
    """Translate a list of captions into ``culture`` using GitHub Copilot.

    ``sources`` is a JSON-array string of caption strings; ``glossary`` is an
    optional JSON-object string of preferred ``source -> target`` terms. Returns
    ``{\"translations\": [...]}`` aligned 1:1 with ``sources``. The GitHub token
    is exchanged for a Copilot token server-side on each call.
    """
    try:
        src_list = json.loads(sources) if sources else []
    except (ValueError, TypeError):
        src_list = []
    try:
        gloss = json.loads(glossary) if glossary else {}
    except (ValueError, TypeError):
        gloss = {}
    if not isinstance(src_list, list) or not src_list:
        return {"translations": []}
    captions = [str(s) for s in src_list]
    copilot = _copilot_token(githubToken)
    result: list = []
    for i in range(0, len(captions), TRANSLATE_BATCH):
        chunk = captions[i:i + TRANSLATE_BATCH]
        result.extend(_translate_batch(chunk, culture, gloss, copilot))
    return {"translations": result}


@udf.function()
def github_comment_m(githubToken: str, steps: str) -> dict:
    """Generate one short inline comment per Power Query (M) step.

    ``steps`` is a JSON-array string of M step code snippets (one element per
    step, in order). Returns ``{"comments": [...]}`` aligned 1:1 with ``steps``.
    The model only DESCRIBES each step in plain English — it never returns M
    code — and the browser inserts each result as a `//` line *before* the
    matching step, so the original M is only ever annotated, never altered.
    The GitHub token is exchanged for a Copilot token server-side per call.
    """
    try:
        step_list = json.loads(steps) if steps else []
    except (ValueError, TypeError):
        step_list = []
    if not isinstance(step_list, list) or not step_list:
        return {"comments": []}
    snippets = [str(s) for s in step_list]
    copilot = _copilot_token(githubToken)
    result: list = []
    for i in range(0, len(snippets), COMMENT_BATCH):
        chunk = snippets[i:i + COMMENT_BATCH]
        result.extend(_comment_batch(chunk, copilot))
    # Pad/trim defensively so the response is always 1:1 with the input.
    if len(result) < len(snippets):
        result.extend([""] * (len(snippets) - len(result)))
    return {"comments": result[:len(snippets)]}

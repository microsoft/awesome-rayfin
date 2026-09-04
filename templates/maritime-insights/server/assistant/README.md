# Assistant backend — chat, grounded in the shipped data

A small HTTP service in front of Azure OpenAI. It exists for two reasons that cannot be solved in
the browser: the model needs a credential that must never reach a bundle, and the tools need to
read the shipped AIS assets server-side so answers are grounded in the same data the app draws.

**Chat only. No voice.** The sibling wind-farm app also mints realtime voice tokens; that was
deliberately left out, so there is no second auth flow and no second model deployment to keep
alive.

## Run it locally

```bash
npm install --prefix server/assistant
node server/assistant/server.mjs --terrain public/terrain
```

Without `AZURE_OPENAI_ENDPOINT` it starts and answers `503` on the chat route — deliberately, so
the data layer can be exercised (`/healthz`) with no cloud access at all.

Point the app at it with `VITE_ASSISTANT_API_BASE=http://127.0.0.1:8081` in `.env`.

## Environment

| Variable | Default | Purpose |
|---|---|---|
| `PORT` | `8081` | Listen port. Container Apps injects this. |
| `AZURE_OPENAI_ENDPOINT` | — | Required for chat. Without it the route answers 503. |
| `AZURE_OPENAI_CHAT_DEPLOYMENT` | `gpt-chat-latest` | Deployment name. |
| `AZURE_OPENAI_API_KEY` | — | Optional. Managed identity is used when unset. |
| `AZURE_OPENAI_USE_AZURE_CLI_TOKEN` | `false` | `true` only for running on a laptop. |
| `BACKEND_APP_KEY` | — | Shared secret, sent as `x-app-key`. |
| `AIS_RELAY_URL` | — | The live relay. Without it `get_live_traffic` says so. |
| `TERRAIN_DIR` | `./terrain` | Folder of per-AOI descriptors. |
| `CORS_ALLOW_ORIGINS` | `*` | No credentials are ever sent, so `*` is defensible. |

## What it answers with

🔴 **Every tool reads the asset the browser downloads.** PLAN §3.2 rule 6 forbids invented data,
and an assistant is the easiest place in an app to break that rule convincingly — asked "how many
ferries were there?", a model will produce a number whether or not it has one.

| Tool | Source |
|---|---|
| `get_area_summary` | `heightmap_4m.json`, `los_16m.json`, `tracks.json` |
| `get_traffic_stats` | `tracks.json` + distances decoded from `tracks.binz` |
| `find_vessel` | `tracks.json` identity fields |
| `list_longest_transits` | as above, sorted by decoded distance |
| `get_live_traffic` | one snapshot frame from the relay's SSE stream |
| `get_current_view` | **the browser**, sent with each prompt |

🔴 **Coverage figures come only from `get_current_view`.** The viewshed is solved in the browser
against the sites the user placed, so the backend cannot know them. The snapshot is built from
`reportData()` — the same model the exported annex renders from — rather than collected separately,
because assembling a second set of numbers is exactly how the annex and the assistant would come to
disagree.

⚠️ **Two denominators, and mixing them is the easiest error here.** 153 passages travelled ≥ 0.5 km
on the recorded Förde day; only **137** of those entered the modelled line-of-sight grid, and that
smaller figure is the coverage denominator. Both the tool output and the instructions say which is
which, and a test pins it.

## Guardrails

The rules in PLAN §3.2 are enforced in code everywhere except inside a language model, where the
only enforcement is the instruction text — a model will describe radar detection probability,
quote a coverage figure it inferred, or name a warship, because none of those look syntactically
different from a correct answer.

`lib/instructions.mjs` restates them in the imperative and `lib/instructions.test.js` asserts each
one survives. Verified against the deployed backend:

The prompts below are quoted in German because that is the language the assistant is exercised in;
the English rendering follows each one.

- *"Auf welche Entfernung würde ein Radar … entdecken?"* (*"at what range would a radar detect …?"*)
  → refuses, explains that the model answers geometric line of sight only, and offers what it can do
  instead.
- *"Welche Kriegsschiffe waren unterwegs? Nenne Namen und MMSI."* (*"which warships were under way?
  Give names and MMSI."*) → declines; naval identity is withheld by design.
- *"Wie viel Prozent deckt mein Standort ab?"* (*"what percentage does my site cover?"*) with no view
  attached → says it is not available rather than estimating.

The caveats follow the data rather than being fixed strings: the upper-bound warning appears only
when the loaded surface actually excludes vegetation. A notice that outlives the thing it
describes is the failure §14.12 was about, and it is not worth repeating here.

## Deploy

```powershell
az acr build --registry <your-acr> --image maritime-assistant:vN `
  --file server/assistant/Dockerfile .     # ⚠️ context is the REPO ROOT

az containerapp update -n <your-assistant-app> -g <your-resource-group> `
  --image <your-acr>.azurecr.io/maritime-assistant:vN
```

The container app holds a system-assigned managed identity with **Cognitive Services OpenAI User**
on the OpenAI resource, so no key exists anywhere. `min-replicas 0`, so an idle demo costs nothing
and the first question after a quiet period waits for a cold start.

⚠️ The image bakes `tracks.json` / `tracks.binz`, so a rebuilt AIS asset needs a rebuilt image.
`/healthz` reports the track date and counts it is holding, which is the only way that drift is
visible from outside.

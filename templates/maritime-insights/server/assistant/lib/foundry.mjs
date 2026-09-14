/**
 * Azure OpenAI Responses API client — streaming, with a tool loop.
 *
 * Only the chat path exists here. The sibling wind-farm app also mints realtime voice tokens; this
 * app was asked for chat only, and leaving the voice path out means there is no second auth flow
 * and no second deployment to keep alive.
 */

import { DefaultAzureCredential, AzureCliCredential } from "@azure/identity";
import { config } from "../config.mjs";

let credential = null;
let cachedToken = null;

/**
 * A bearer token for the OpenAI resource.
 *
 * 🔴 `DefaultAzureCredential` inside the container resolves the **managed identity**; the CLI
 * credential is only for running this on a laptop. Getting that the wrong way round is the
 * sibling app's recorded failure: the container looks for an `az` binary that is not installed and
 * reports it as an opaque authentication error rather than as a missing tool.
 */
async function getToken() {
  if (config.openai.apiKey) return null;
  const now = Date.now();
  if (cachedToken && cachedToken.expiresOnTimestamp - now > 120_000) return cachedToken.token;
  if (!credential) {
    credential = config.openai.useCliToken
      ? new AzureCliCredential()
      : new DefaultAzureCredential();
  }
  cachedToken = await credential.getToken("https://cognitiveservices.azure.com/.default");
  return cachedToken.token;
}

function responsesUrl() {
  const base = config.openai.endpoint;
  if (base.endsWith("/openai/v1")) return `${base}/responses`;
  return `${base}/openai/v1/responses`;
}

async function authHeaders() {
  if (config.openai.apiKey) return { "api-key": config.openai.apiKey };
  return { authorization: `Bearer ${await getToken()}` };
}

/** Tool definitions in the shape the Responses API expects. */
function toResponsesTools(definitions) {
  return definitions.map((tool) => ({
    type: "function",
    name: tool.name,
    description: tool.description,
    parameters: {
      type: "object",
      properties: tool.parameters?.properties ?? {},
      required: tool.parameters?.required ?? [],
      additionalProperties: false,
    },
  }));
}

/**
 * Stream one request, yielding text deltas and collecting any tool calls.
 *
 * ⚠️ Tool-call arguments arrive in fragments across several events and are assembled by item id.
 * Parsing whatever has arrived when the first fragment lands produces `SyntaxError` on valid
 * output — the arguments are only complete at `...arguments.done`.
 */
async function* streamOnce(body) {
  const response = await fetch(responsesUrl(), {
    method: "POST",
    headers: {
      ...(await authHeaders()),
      "content-type": "application/json",
      accept: "text/event-stream",
    },
    body: JSON.stringify({ ...body, stream: true }),
  });

  if (!response.ok || !response.body) {
    const detail = await response.text().catch(() => "");
    throw new Error(`Azure OpenAI ${response.status}: ${detail.slice(0, 400)}`);
  }

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  const calls = new Map();
  let buffer = "";
  let responseId = null;
  let usage = null;

  for (;;) {
    const { value, done } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    const frames = buffer.split("\n\n");
    buffer = frames.pop() ?? "";

    for (const frame of frames) {
      const line = frame.split("\n").find((l) => l.startsWith("data:"));
      if (!line) continue;
      const payload = line.slice(5).trim();
      if (!payload || payload === "[DONE]") continue;

      const event = JSON.parse(payload);
      switch (event.type) {
        case "response.output_text.delta":
          if (event.delta) yield { type: "delta", text: event.delta };
          break;
        case "response.output_item.added":
        case "response.output_item.done":
          if (event.item?.type === "function_call") {
            const existing = calls.get(event.item.id) ?? {};
            calls.set(event.item.id, {
              name: event.item.name ?? existing.name,
              callId: event.item.call_id ?? existing.callId,
              arguments: event.item.arguments ?? existing.arguments ?? "",
            });
          }
          break;
        case "response.function_call_arguments.delta": {
          const entry = calls.get(event.item_id);
          if (entry) entry.arguments = (entry.arguments ?? "") + (event.delta ?? "");
          break;
        }
        case "response.function_call_arguments.done": {
          const entry = calls.get(event.item_id);
          if (entry && event.arguments != null) entry.arguments = event.arguments;
          break;
        }
        case "response.completed":
        case "response.incomplete":
          responseId = event.response?.id ?? responseId;
          usage = event.response?.usage ?? usage;
          break;
        case "error":
        case "response.failed":
          throw new Error(event.response?.error?.message ?? "Azure OpenAI streaming error");
        default:
          break;
      }
    }
  }

  return { calls: [...calls.values()], responseId, usage };
}

/**
 * Ask, run tools, and keep going until the model answers without asking for more.
 *
 * Yields the frames the browser renders: `status`, `delta`, `tool`, `metadata`.
 */
export async function* streamAnswer({ prompt, instructions, tools, executeTool, context }) {
  const wireTools = toResponsesTools(tools);
  let body = {
    model: config.openai.chatDeployment,
    instructions,
    input: prompt,
    tools: wireTools,
    tool_choice: "auto",
    max_output_tokens: config.openai.maxOutputTokens,
  };

  yield { type: "metadata", provider: "azure-openai", model: config.openai.chatDeployment };

  for (let round = 0; round < config.openai.maxToolRounds; round += 1) {
    const { calls, responseId, usage } = yield* streamOnce(body);

    if (!calls.length) {
      yield { type: "metadata", provider: "azure-openai",
              model: config.openai.chatDeployment, usage };
      return;
    }

    const outputs = [];
    for (const call of calls) {
      let args = {};
      try {
        args = JSON.parse(call.arguments || "{}");
      } catch {
        // A malformed argument blob is the model's mistake, not a reason to kill the answer —
        // hand the tool an empty object and let it report what it needs.
        args = {};
      }
      yield { type: "status", message: `Frage die Daten ab: ${call.name}` };
      const result = await executeTool(call.name, args, context);
      yield { type: "tool", name: call.name, arguments: args, result };
      outputs.push({
        type: "function_call_output",
        call_id: call.callId,
        output: JSON.stringify(result),
      });
    }

    body = {
      model: config.openai.chatDeployment,
      previous_response_id: responseId,
      input: outputs,
      tools: wireTools,
      tool_choice: "auto",
      max_output_tokens: config.openai.maxOutputTokens,
    };
  }

  // ⚠️ Ran out of rounds. Said out loud rather than silently truncated, because a confident
  // half-answer built from partial tool output is worse than an admission.
  yield {
    type: "status",
    message: "Tool-Limit erreicht — die Antwort stützt sich auf die bisher geholten Daten.",
  };
}

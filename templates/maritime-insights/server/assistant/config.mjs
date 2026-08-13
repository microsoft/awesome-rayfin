/**
 * Configuration for the assistant backend.
 *
 * Everything is read from the environment, because this runs as a Container App and a value baked
 * into an image is a value that needs a rebuild to change. Defaults are the local-development
 * ones; nothing here carries a secret.
 */

const env = process.env;

function bool(value, fallback) {
  if (value == null || value === "") return fallback;
  return /^(1|true|yes|on)$/i.test(String(value));
}

export const config = {
  port: Number(env.PORT) || 8081,
  /** Comma-separated allow-list, or `*`. No credentials are ever sent, so `*` is defensible here. */
  corsOrigins: (env.CORS_ALLOW_ORIGINS ?? "*").split(",").map((v) => v.trim()).filter(Boolean),
  /**
   * A shared secret sent as `x-app-key`.
   *
   * ⚠️ This is an abuse gate, not authentication — it is in the browser bundle and anyone who
   * opens dev tools can read it. It exists so that a stranger who finds the URL cannot burn the
   * token budget, which is the actual risk for a public endpoint in front of a paid model.
   */
  appKey: (env.BACKEND_APP_KEY ?? "").trim(),

  openai: {
    endpoint: (env.AZURE_OPENAI_ENDPOINT ?? "").replace(/\/$/, ""),
    apiKey: env.AZURE_OPENAI_API_KEY ?? "",
    /**
     * 🔴 Defaults to **false** so the container uses its managed identity.
     *
     * The sibling app learned this the hard way: leaving the Azure-CLI path on inside a container
     * makes the client look for a CLI that is not installed, and the failure surfaces as an opaque
     * auth error rather than as "there is no CLI here".
     */
    useCliToken: bool(env.AZURE_OPENAI_USE_AZURE_CLI_TOKEN, false),
    chatDeployment: env.AZURE_OPENAI_CHAT_DEPLOYMENT ?? "gpt-chat-latest",
    maxOutputTokens: Number(env.ASSISTANT_MAX_OUTPUT_TOKENS) || 700,
    /** How many times the model may call tools before it has to answer. */
    maxToolRounds: Number(env.ASSISTANT_MAX_TOOL_ROUNDS) || 4,
  },

  /** The AIS relay, for live questions. Optional: without it the live tool says so. */
  relayUrl: (env.AIS_RELAY_URL ?? "").replace(/\/$/, ""),

  /** Directory holding one folder per AOI, each with the shipped `tracks.json`. */
  terrainDir: env.TERRAIN_DIR ?? "./terrain",

  /**
   * Where committed sensor plans are written.
   *
   * Both ids are required before the writeback endpoints do anything: a half-configured target is
   * how a plan gets written somewhere nobody looks. Without them the endpoints answer 503 and say
   * which variable is missing, rather than failing at the storage layer with a 404 on a path the
   * operator never chose.
   */
  fabric: {
    workspaceId: (env.FABRIC_WORKSPACE_ID ?? "").trim(),
    lakehouseId: (env.FABRIC_LAKEHOUSE_ID ?? "").trim(),
    /** Laptop-only. Inside the container the managed identity is the credential — see onelake.mjs. */
    useCliToken: bool(env.FABRIC_USE_AZURE_CLI_TOKEN, false),
  },
};

export function openAiConfigured() {
  return Boolean(config.openai.endpoint);
}

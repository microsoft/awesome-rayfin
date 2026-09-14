/**
 * Realtime voice session minting — PLAN §3 Mode E, phase 6.
 *
 * The browser needs to talk to Azure AI Foundry's realtime API, and the credential that authorises
 * that must never reach it. So this service does exactly one thing: it exchanges a credential the
 * browser does not have for an **ephemeral client secret** that expires in ten minutes, and hands
 * that back. The browser then opens a WebRTC peer connection **straight to Foundry** — audio never
 * flows through here, which is why a single small process can serve a room full of listeners.
 *
 * ⚠️ **No API key, anywhere.** The credential is an Azure CLI token for the Cognitive Services data
 * plane, minted on demand. There is no key in a file to leak, none in the repo to redact, and none
 * in the browser to read out of devtools. In a hosted deployment the same code path works with a
 * managed identity; `az` is simply what a laptop has.
 *
 * Deliberately **not** part of the Vite build, and deliberately a separate process from the OGN
 * relay: the two share nothing, fail independently, and the app treats the absence of either as a
 * normal state rather than an error.
 *
 * Usage
 *   npm run voice
 *   node server/voice/mint.js --port 8788
 */

import { createServer } from 'node:http';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

const run = promisify(execFile);

/**
 * The Azure CLI entry point.
 *
 * ⚠️ `az.cmd` by name on Windows rather than `az` with `shell: true`. Running a command through a
 * shell with an argument array concatenates rather than escapes them — Node deprecated it
 * (DEP0190) for exactly that reason. Nothing here takes user input, so it was not exploitable, but
 * the safe form is no harder to write.
 */
const AZ = process.platform === 'win32' ? 'az.cmd' : 'az';
/** The Cognitive Services data-plane audience. Not the Fabric or Kusto ones from phases 4 and 5. */
const RESOURCE = 'https://cognitiveservices.azure.com';

/**
 * The sibling project's Foundry resource, reused rather than duplicated.
 *
 * Realtime is billed per use, so an idle deployment costs nothing — provisioning a second one to
 * hold the same model would have been pure ceremony. Override with `--endpoint` for a different
 * resource.
 */
const DEFAULTS = {
  port: 8788,
  endpoint: 'https://aif-flutinsights-swc.cognitiveservices.azure.com',
  deployment: 'gpt-voice',
  origin: '*',
  /** Long enough to start a conversation, short enough that a leaked secret is worthless. */
  seconds: 600,
};

function parseArgs(argv) {
  const args = { ...DEFAULTS };
  for (let i = 0; i < argv.length; i += 2) {
    const key = argv[i]?.replace(/^--/, '');
    const value = argv[i + 1];
    if (key in args) args[key] = key === 'port' || key === 'seconds' ? Number(value) : value;
  }
  return args;
}

/**
 * A token for the data plane.
 *
 * Cached until shortly before it expires: `az` takes about a second, and paying that on every
 * session start is a second of silence at exactly the moment someone has just pressed the button.
 */
let cached = { token: null, expiresAt: 0 };

async function accessToken() {
  const now = Date.now() / 1000;
  if (cached.token && cached.expiresAt - now > 120) return cached.token;

  const { stdout } = await run(AZ, [
    'account', 'get-access-token',
    '--resource', RESOURCE,
    '--query', '{t:accessToken,e:expiresOn}',
    '-o', 'json',
  ], { maxBuffer: 8 * 1024 * 1024 });

  const parsed = JSON.parse(stdout);
  cached = { token: parsed.t, expiresAt: Date.parse(parsed.e) / 1000 || now + 1800 };
  return cached.token;
}

async function mint(args, { voice, instructions }) {
  const token = await accessToken();
  const url = `${args.endpoint.replace(/\/$/, '')}/openai/v1/realtime/client_secrets`;

  const response = await fetch(url, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      expires_after: { anchor: 'created_at', seconds: args.seconds },
      session: {
        type: 'realtime',
        model: args.deployment,
        // ⚠️ Instructions are set **here**, not in the browser. They are the assistant's brief and
        // its guardrails; a client that could rewrite them could talk the model out of every rule
        // in §2.2 — including the one about never naming a pilot.
        instructions,
        audio: { output: { voice } },
      },
    }),
  });

  if (!response.ok) {
    const detail = await response.text();
    throw new Error(`client_secrets ${response.status}: ${detail.slice(0, 400)}`);
  }

  const payload = await response.json();
  const secret = payload.value ?? payload.client_secret?.value;
  if (!secret) throw new Error('no ephemeral secret in the response');

  return {
    secret,
    expiresAt: payload.expires_at ?? payload.client_secret?.expires_at ?? null,
    callsUrl: `${args.endpoint.replace(/\/$/, '')}/openai/v1/realtime/calls`,
    model: args.deployment,
    voice,
  };
}

function main() {
  const args = parseArgs(process.argv.slice(2));

  const server = createServer(async (req, res) => {
    res.setHeader('Access-Control-Allow-Origin', args.origin);
    res.setHeader('Access-Control-Allow-Headers', 'content-type');

    if (req.method === 'OPTIONS') {
      res.writeHead(204).end();
      return;
    }

    const url = new URL(req.url, 'http://localhost');

    if (url.pathname === '/voice/health') {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ endpoint: args.endpoint, deployment: args.deployment }, null, 2));
      return;
    }

    if (url.pathname !== '/voice/session' || req.method !== 'POST') {
      res.writeHead(404).end();
      return;
    }

    try {
      const body = await new Promise((resolve, reject) => {
        let raw = '';
        req.on('data', (chunk) => {
          raw += chunk;
          // A session request is a few hundred bytes. Anything larger is not one.
          if (raw.length > 8192) reject(new Error('request too large'));
        });
        req.on('end', () => resolve(raw ? JSON.parse(raw) : {}));
        req.on('error', reject);
      });

      const plan = await mint(args, {
        voice: typeof body.voice === 'string' ? body.voice : 'marin',
        instructions: typeof body.instructions === 'string' ? body.instructions : '',
      });

      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(plan));
      console.log(`[voice] minted a ${args.seconds}s secret (${plan.voice})`);
    } catch (error) {
      console.warn(`[voice] ${error.message}`);
      res.writeHead(502, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: error.message }));
    }
  });

  server.listen(args.port, () => {
    console.log(`[voice] http://localhost:${args.port}/voice/session`);
    console.log(`[voice] ${args.endpoint} · ${args.deployment}`);
  });
}

main();

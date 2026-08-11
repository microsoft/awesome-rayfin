import { activeAoi } from '@/config/aoi';
import type { Locale } from '@/i18n';

/**
 * Mode E — **Frag den Berg** (PLAN §3, decision 18, phase 6).
 *
 * A realtime voice assistant that **drives the app**. That distinction is the whole design: a chat
 * window bolted onto the side would be a demo of a language model, whereas this one can move the
 * camera, start the tour, switch into drone mode and scrub the replay — so asking *"zeig mir den
 * Startplatz"* moves the mountain rather than describing it.
 *
 * ## How it connects
 *
 * The browser asks `server/voice/mint.js` for an **ephemeral client secret**, then opens a WebRTC
 * peer connection **straight to Azure AI Foundry**. Audio never passes through our server; the
 * credential never reaches the browser. The secret lives ten minutes and is worthless afterwards.
 *
 * ## Where the answers come from
 *
 * ⚠️ **Every factual tool returns data the app already holds** — the Mode D snapshot out of the
 * Direct Lake model, the live traffic from the OGN relay, the flight's own derived figures. The
 * model is told, in its instructions, that it may not invent a number it was not given. That is
 * §2.2.6 applied to a component whose entire failure mode is fluent invention: a paragliding app
 * that confidently states a wrong cloud base is worse than one that says it does not know.
 *
 * ## When it is not available
 *
 * The published app is static hosting and cannot mint a secret, so Mode E is usually unavailable —
 * the same first-class fallback as Mode C and Mode D. It says so rather than failing.
 */

export type AssistantStatus = 'idle' | 'connecting' | 'microphone' | 'listening' | 'unavailable';

/**
 * Realtime voices, per locale.
 *
 * ⚠️ These are **realtime API** voice names, not Azure Speech ones. The i18n module used to carry
 * `de-DE-SeraphinaMultilingualNeural` under a comment describing it as the realtime voice; that is
 * a Speech TTS name and the realtime endpoint rejects it. The model speaks whatever language it is
 * addressed in, so the locale picks a timbre and the *instructions* pick the language.
 */
export const REALTIME_VOICE: Record<Locale, string> = {
  de: 'marin',
  en: 'cedar',
};

/** What the assistant is allowed to do to the app. Supplied by the view; this module has no scene. */
export interface AssistantActions {
  /** Fly the camera to a place id from the AOI config. */
  focusPlace(placeId: string): void;
  /** Start or stop the guided tour. */
  setTour(on: boolean): void;
  /** Enter or leave drone mode. */
  setDroneMode(on: boolean): void;
  /** Move the replay head, in seconds from the first fix. */
  setFlightTime(seconds: number): void;
  /** Play or pause the replay. */
  setPlaying(playing: boolean): void;
  /** Lock the camera to the replayed glider. */
  setFollow(on: boolean): void;
  /** Everything the assistant is allowed to state as fact, gathered at call time. */
  facts(): AssistantFacts;
}

export interface AssistantFacts {
  places: { id: string; name: string; groundM: number }[];
  flight: {
    date: string | null;
    durationS: number;
    ceilingM: number | null;
    bestClimbMs: number | null;
    distanceKm: number | null;
    headS: number;
  } | null;
  day: {
    modelRun: string;
    cloudBaseM: number | null;
    cloudCoveragePct: number | null;
    capeJkg: number | null;
    freezingM: number | null;
  } | null;
  live: { status: string; count: number; types: Record<string, number> };
}

interface Handlers {
  onStatus(status: AssistantStatus, detail?: string): void;
  /** Called with a line of conversation, for the transcript. */
  onTranscript(role: 'user' | 'assistant', text: string): void;
}

export interface AssistantHandle {
  stop(): void;
}

/**
 * The tool surface.
 *
 * Kept small on purpose. Every tool is either an action the viewer could take themselves, or a
 * lookup of data already on screen — nothing here reaches for anything the app does not have, so
 * there is no path by which the assistant can answer from its own memory of the Alps.
 */
const TOOLS = [
  {
    type: 'function',
    name: 'orte_auflisten',
    description:
      'Lists the places in this area with their ground elevation. Call this before flying anywhere, ' +
      'to get valid place ids.',
    parameters: { type: 'object', properties: {}, required: [] },
  },
  {
    type: 'function',
    name: 'ort_anfliegen',
    description: 'Flies the camera to a place. Use an id from orte_auflisten.',
    parameters: {
      type: 'object',
      properties: { ort: { type: 'string', description: 'place id' } },
      required: ['ort'],
    },
  },
  {
    type: 'function',
    name: 'fuehrung',
    description: 'Starts or stops the guided tour of the area.',
    parameters: {
      type: 'object',
      properties: { an: { type: 'boolean' } },
      required: ['an'],
    },
  },
  {
    type: 'function',
    name: 'drohnen_modus',
    description:
      'Turns drone mode on or off — a free camera the viewer flies with the keyboard. It has no ' +
      'terrain collision and is not a flight simulator.',
    parameters: {
      type: 'object',
      properties: { an: { type: 'boolean' } },
      required: ['an'],
    },
  },
  {
    type: 'function',
    name: 'flug_steuern',
    description:
      'Controls the recorded flight replay: play or pause, jump to a time in seconds from the ' +
      'start, and lock the camera to the glider.',
    parameters: {
      type: 'object',
      properties: {
        abspielen: { type: 'boolean' },
        sekunde: { type: 'number', description: 'seconds from the first fix' },
        folgen: { type: 'boolean' },
      },
      required: [],
    },
  },
  {
    type: 'function',
    name: 'fakten',
    description:
      'Returns everything known: the recorded flight, the day forecast from the semantic model, ' +
      'and who is airborne right now. Call this before answering any question about numbers.',
    parameters: { type: 'object', properties: {}, required: [] },
  },
] as const;

function instructionsFor(locale: Locale): string {
  const language =
    locale === 'de'
      ? 'Antworte immer auf Deutsch, per Du, knapp und freundlich.'
      : 'Always answer in English, briefly and warmly.';

  // ⚠️ The site comes from the AOI config. Telling the model it is looking at the Nebelhorn while
  // the viewer is looking at the Tegelberg would make it confidently wrong about the one thing it
  // can see — and a voice that is fluent and wrong is the worst failure mode this app has.
  const aoi = activeAoi();
  const site = aoi.site.name.en;
  const region = aoi.site.region.en;

  return [
    `You are the assistant inside Gleitschirm-Insights, a 3D paragliding map of ${site} in the`,
    `${region}. You are talking to someone looking at that map.`,
    language,
    '',
    'Keep answers to one or two sentences — this is speech, not a report.',
    '',
    'CRITICAL RULES:',
    '- Call `fakten` before stating ANY number. Never answer a numeric question from memory.',
    '- If `fakten` does not contain the answer, say plainly that you do not know. Do not estimate,',
    '  do not interpolate, and never offer a plausible-sounding figure. A wrong cloud base or a',
    '  wrong altitude is worse than no answer, because someone might believe it.',
    '- Never name a pilot, and never speculate about who is flying. Everyone here is anonymous by',
    '  design, including the recorded flight.',
    '- This is a demonstration, not a flight-planning tool. If asked whether it is safe or good to',
    '  fly, say that only the official sources answer that.',
    '',
    'You can move the map. When someone asks to see something, fly there rather than describing it.',
    'When the answer is a place, show it and say one interesting thing about it.',
  ].join('\n');
}

/** Where the minting service lives. Same-origin in dev via the Vite proxy; absent in production. */
const MINT_URL = import.meta.env.VITE_VOICE_MINT_URL ?? '/voice/session';

/**
 * How long the whole connect may take before it is called off.
 *
 * ⚠️ This exists because of the microphone. `getUserMedia` does not reject when someone ignores the
 * browser's permission prompt — it simply never settles, and the panel sits on "connecting" for as
 * long as the tab is open, which reads as a hang rather than as a question waiting to be answered.
 * Found by driving it from Playwright, where the prompt is never answered at all.
 */
const CONNECT_TIMEOUT_MS = 20000;

function withTimeout<T>(promise: Promise<T>, ms: number, message: string): Promise<T> {
  return Promise.race([
    promise,
    new Promise<T>((_, reject) => setTimeout(() => reject(new Error(message)), ms)),
  ]);
}

export async function startAssistant(
  locale: Locale,
  actions: AssistantActions,
  handlers: Handlers
): Promise<AssistantHandle> {
  handlers.onStatus('connecting');

  let peer: RTCPeerConnection | null = null;
  let channel: RTCDataChannel | null = null;
  let mic: MediaStream | null = null;
  let audio: HTMLAudioElement | null = null;
  let stopped = false;

  const stop = () => {
    stopped = true;
    channel?.close();
    peer?.close();
    mic?.getTracks().forEach((track) => track.stop());
    if (audio) audio.srcObject = null;
    channel = null;
    peer = null;
    mic = null;
    audio = null;
    handlers.onStatus('idle');
  };

  try {
    const planResponse = await fetch(MINT_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ voice: REALTIME_VOICE[locale], instructions: instructionsFor(locale) }),
    });
    if (!planResponse.ok) throw new Error(`mint ${planResponse.status}`);
    const plan = (await planResponse.json()) as { secret: string; callsUrl: string };

    // Asked for only after the secret is in hand: prompting for a microphone and then failing to
    // connect is the rudest possible order to do these two things in.
    handlers.onStatus('microphone');
    mic = await withTimeout(
      navigator.mediaDevices.getUserMedia({ audio: true }),
      CONNECT_TIMEOUT_MS,
      'no microphone permission'
    );
    if (stopped) throw new Error('cancelled');
    handlers.onStatus('connecting');

    peer = new RTCPeerConnection();
    audio = new Audio();
    audio.autoplay = true;

    mic.getTracks().forEach((track) => peer!.addTrack(track, mic!));
    peer.ontrack = (event) => {
      if (audio) {
        audio.srcObject = event.streams[0];
        void audio.play().catch(() => undefined);
      }
    };
    peer.onconnectionstatechange = () => {
      const state = peer?.connectionState;
      if (state && ['failed', 'disconnected', 'closed'].includes(state) && !stopped) {
        handlers.onStatus('unavailable', state);
      }
    };

    channel = peer.createDataChannel('oai-events');
    channel.onopen = () => {
      handlers.onStatus('listening');
      // Tools are declared once the channel is up. They are not in the mint request because the
      // browser is allowed to choose what it can do; it is not allowed to choose the instructions.
      channel?.send(
        JSON.stringify({ type: 'session.update', session: { type: 'realtime', tools: TOOLS } })
      );
    };
    channel.onmessage = (message) => {
      void handleEvent(JSON.parse(message.data));
    };

    const offer = await peer.createOffer();
    await peer.setLocalDescription(offer);

    const answer = await withTimeout(
      fetch(plan.callsUrl, {
        method: 'POST',
        headers: { Authorization: `Bearer ${plan.secret}`, 'Content-Type': 'application/sdp' },
        body: offer.sdp ?? '',
      }),
      CONNECT_TIMEOUT_MS,
      'realtime did not answer'
    );
    if (!answer.ok) throw new Error(`SDP exchange ${answer.status}`);
    await peer.setRemoteDescription({ type: 'answer', sdp: await answer.text() });
  } catch (error) {
    stop();
    stopped = true;
    handlers.onStatus('unavailable', error instanceof Error ? error.message : String(error));
    return { stop: () => undefined };
  }

  async function handleEvent(event: Record<string, unknown>) {
    const type = String(event.type ?? '');

    // What the person said, once the transcription settles.
    if (type === 'conversation.item.input_audio_transcription.completed') {
      const text = String(event.transcript ?? '').trim();
      if (text) handlers.onTranscript('user', text);
      return;
    }

    // What the assistant said.
    if (type === 'response.output_audio_transcript.done') {
      const text = String(event.transcript ?? '').trim();
      if (text) handlers.onTranscript('assistant', text);
      return;
    }

    if (type === 'response.function_call_arguments.done') {
      const name = String(event.name ?? '');
      const callId = String(event.call_id ?? '');
      let args: Record<string, unknown> = {};
      try {
        args = JSON.parse(String(event.arguments ?? '{}'));
      } catch {
        args = {};
      }
      const output = dispatch(name, args);

      channel?.send(
        JSON.stringify({
          type: 'conversation.item.create',
          item: { type: 'function_call_output', call_id: callId, output: JSON.stringify(output) },
        })
      );
      // The model does not speak again on its own after a tool result; it has to be asked to.
      channel?.send(JSON.stringify({ type: 'response.create' }));
    }
  }

  function dispatch(name: string, args: Record<string, unknown>): unknown {
    const facts = actions.facts();

    switch (name) {
      case 'orte_auflisten':
        return { orte: facts.places };

      case 'ort_anfliegen': {
        const id = String(args.ort ?? '');
        const place = facts.places.find((p) => p.id === id);
        if (!place) return { ok: false, grund: 'unbekannter Ort', orte: facts.places.map((p) => p.id) };
        actions.focusPlace(id);
        return { ok: true, ort: place };
      }

      case 'fuehrung':
        actions.setTour(Boolean(args.an));
        return { ok: true };

      case 'drohnen_modus':
        actions.setDroneMode(Boolean(args.an));
        return { ok: true };

      case 'flug_steuern': {
        if (!facts.flight) return { ok: false, grund: 'kein Flug geladen' };
        if (typeof args.sekunde === 'number') {
          actions.setFlightTime(
            Math.max(0, Math.min(facts.flight.durationS, args.sekunde as number))
          );
        }
        if (typeof args.folgen === 'boolean') actions.setFollow(args.folgen as boolean);
        if (typeof args.abspielen === 'boolean') actions.setPlaying(args.abspielen as boolean);
        return { ok: true, flug: facts.flight };
      }

      case 'fakten':
        return facts;

      default:
        return { ok: false, grund: `unbekanntes Werkzeug ${name}` };
    }
  }

  return { stop };
}

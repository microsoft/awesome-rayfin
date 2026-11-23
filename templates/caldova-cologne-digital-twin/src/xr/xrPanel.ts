import * as THREE from 'three';

/**
 * Text in the headset.
 *
 * Inside an immersive session the HTML page is not drawn at all, so everything the app says with
 * its panels has to be said again on a surface in the scene. Two surfaces:
 *
 * - the **wrist panel** on the left controller: lens and legend, x-ray state, height and speed, the
 *   selected segment, and the controls. Raise the hand to read it, lower it to get it out of view.
 * - the **banner**: what the viewer is looking at (1:1 or the tabletop scale) and the controls. It
 *   floats low in the field of view and follows the head lazily, the way a body-locked menu does,
 *   because text glued to the face is unreadable and nauseating. (The name `SyntheticBanner` is
 *   kept from an earlier twin, where it carried a "synthetic data" statement.)
 *
 * Both are 2D canvases uploaded as textures. They are redrawn only when their text changes, and the
 * caller throttles the telemetry, so a parked viewer costs no uploads at all.
 */

export interface PanelLine {
  text: string;
  /** CSS colour. */
  colour?: string;
  /** A filled square before the text, for legend entries. */
  swatch?: string;
  size?: 'title' | 'body' | 'small';
  /** Right-aligned second column. */
  value?: string;
}

const PANEL_PX = { w: 1024, h: 1280 };
/** Physical size on the wrist, metres. A phone-sized card at forearm length. */
const PANEL_M = { w: 0.2, h: 0.25 };

export interface WristPanel {
  mesh: THREE.Mesh;
  draw(lines: PanelLine[]): void;
  dispose(): void;
}

export function createWristPanel(): WristPanel {
  const canvas = document.createElement('canvas');
  canvas.width = PANEL_PX.w;
  canvas.height = PANEL_PX.h;
  const ctx = canvas.getContext('2d')!;
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.anisotropy = 4;

  const material = new THREE.MeshBasicMaterial({
    map: texture,
    transparent: true,
    // Always readable: a panel that a nearby roof or the terrain can cut in half is useless.
    depthTest: false,
    depthWrite: false,
    fog: false,
    toneMapped: false,
  });
  const mesh = new THREE.Mesh(new THREE.PlaneGeometry(PANEL_M.w, PANEL_M.h), material);
  mesh.name = 'xr-wrist-panel';
  mesh.renderOrder = 1000;
  mesh.frustumCulled = false;
  // Above the left controller, tilted back towards the face, as a watch face is read.
  mesh.position.set(0, 0.07, -0.13);
  mesh.rotation.set(-0.95, 0, 0);

  let lastKey = '';

  return {
    mesh,
    draw(lines) {
      const key = JSON.stringify(lines);
      if (key === lastKey) return;
      lastKey = key;

      ctx.clearRect(0, 0, PANEL_PX.w, PANEL_PX.h);
      roundRect(ctx, 8, 8, PANEL_PX.w - 16, PANEL_PX.h - 16, 36);
      ctx.fillStyle = 'rgba(8, 16, 20, 0.88)';
      ctx.fill();
      ctx.lineWidth = 4;
      ctx.strokeStyle = 'rgba(255, 255, 255, 0.18)';
      ctx.stroke();

      let y = 64;
      const left = 48;
      const right = PANEL_PX.w - 48;
      for (const line of lines) {
        const px = line.size === 'title' ? 54 : line.size === 'small' ? 32 : 40;
        ctx.font = `${line.size === 'title' ? 600 : 400} ${px}px "Segoe UI", system-ui, sans-serif`;
        ctx.textBaseline = 'middle';
        let x = left;
        if (line.swatch) {
          ctx.fillStyle = line.swatch;
          ctx.fillRect(x, y - px * 0.36, px * 0.72, px * 0.72);
          x += px;
        }
        ctx.fillStyle = line.colour ?? 'rgba(255,255,255,0.92)';
        ctx.textAlign = 'left';
        ctx.fillText(line.text, x, y, right - x - (line.value ? 260 : 0));
        if (line.value) {
          ctx.textAlign = 'right';
          ctx.fillStyle = 'rgba(255,255,255,0.98)';
          ctx.fillText(line.value, right, y, 300);
        }
        y += px * 1.32;
        if (y > PANEL_PX.h - 40) break;
      }
      texture.needsUpdate = true;
    },
    dispose() {
      texture.dispose();
      material.dispose();
      mesh.geometry.dispose();
    },
  };
}

/** Distance of the banner in front of the head, and how far below eye level, metres. */
const BANNER_DISTANCE_M = 2.2;
const BANNER_DROP_M = 0.95;
/** The banner stays put until the head has turned this far away from it. */
const BANNER_FOLLOW_RAD = THREE.MathUtils.degToRad(28);
/** Compact: only the buttons, low at the edge of the view, and turning with the head much later. */
const COMPACT_DROP_M = 1.45;
const COMPACT_FOLLOW_RAD = THREE.MathUtils.degToRad(50);

export interface SyntheticBanner {
  mesh: THREE.Mesh;
  /** `icon` precedes the title; the default is the synthetic-data warning sign. */
  setText(title: string, body: string, icon?: string): void;
  /**
   * Compact: the text plate is hidden (its children, the buttons, stay), it sits lower and only
   * follows a large head turn. For when the banner is in the way.
   */
  setCompact(compact: boolean): void;
  /** Call every frame with the head pose in world space. */
  follow(headPosition: THREE.Vector3, headForward: THREE.Vector3, dt: number): void;
  /** Place it straight ahead at once, for the first frame of a session. */
  snap(headPosition: THREE.Vector3, headForward: THREE.Vector3): void;
  dispose(): void;
}

export function createSyntheticBanner(): SyntheticBanner {
  const canvas = document.createElement('canvas');
  canvas.width = 1024;
  canvas.height = 160;
  const ctx = canvas.getContext('2d')!;
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  const material = new THREE.MeshBasicMaterial({
    map: texture,
    transparent: true,
    depthTest: false,
    depthWrite: false,
    fog: false,
    toneMapped: false,
  });
  const mesh = new THREE.Mesh(new THREE.PlaneGeometry(0.96, 0.15), material);
  mesh.name = 'xr-synthetic-banner';
  mesh.renderOrder = 1001;
  mesh.frustumCulled = false;

  let yaw = 0;
  let chasing = false;
  let drop = BANNER_DROP_M;
  let followRad = BANNER_FOLLOW_RAD;
  const flat = new THREE.Vector3();

  const place = (head: THREE.Vector3) => {
    mesh.position.set(
      head.x - Math.sin(yaw) * BANNER_DISTANCE_M,
      head.y - drop,
      head.z - Math.cos(yaw) * BANNER_DISTANCE_M
    );
    // Facing the head, and tipped back so it is square to a glance downwards.
    mesh.rotation.set(0, 0, 0);
    mesh.rotateY(yaw);
    mesh.rotateX(-0.4);
  };

  const yawOf = (forward: THREE.Vector3) => {
    flat.set(forward.x, 0, forward.z);
    if (flat.lengthSq() < 1e-6) return yaw;
    flat.normalize();
    return Math.atan2(-flat.x, -flat.z);
  };

  return {
    mesh,
    setText(title, body, icon = '\u26A0') {
      ctx.clearRect(0, 0, canvas.width, canvas.height);
      roundRect(ctx, 4, 4, canvas.width - 8, canvas.height - 8, 26);
      ctx.fillStyle = 'rgba(70, 36, 10, 0.9)';
      ctx.fill();
      ctx.lineWidth = 4;
      ctx.strokeStyle = 'rgba(232, 180, 74, 0.85)';
      ctx.stroke();
      ctx.textBaseline = 'middle';
      ctx.textAlign = 'left';
      ctx.fillStyle = '#ffd27a';
      ctx.font = '600 50px "Segoe UI", system-ui, sans-serif';
      ctx.fillText(icon ? `${icon} ${title}` : title, 36, 56, canvas.width - 72);
      ctx.fillStyle = 'rgba(255,255,255,0.9)';
      ctx.font = '400 32px "Segoe UI", system-ui, sans-serif';
      ctx.fillText(body, 36, 116, canvas.width - 72);
      texture.needsUpdate = true;
    },
    snap(headPosition, headForward) {
      yaw = yawOf(headForward);
      place(headPosition);
    },
    setCompact(compact) {
      // Material.visible hides only this plate; the buttons are children with their own materials.
      material.visible = !compact;
      drop = compact ? COMPACT_DROP_M : BANNER_DROP_M;
      followRad = compact ? COMPACT_FOLLOW_RAD : BANNER_FOLLOW_RAD;
    },
    follow(headPosition, headForward, dt) {
      const want = yawOf(headForward);
      let diff = want - yaw;
      diff = Math.atan2(Math.sin(diff), Math.cos(diff));
      // Lazy: only chase once the head has clearly turned away, then ease all the way back to
      // centre so it does not sit on the edge of the view and twitch.
      if (Math.abs(diff) > followRad || chasing) {
        chasing = Math.abs(diff) > 0.02;
        yaw += diff * (1 - Math.exp(-dt / 0.25));
      }
      place(headPosition);
    },
    dispose() {
      texture.dispose();
      material.dispose();
      mesh.geometry.dispose();
    },
  };
}

/** Physical size of the exit button, metres. Beside the banner, as big as a hand at arm's length. */
const EXIT_M = { w: 0.3, h: 0.12 };

export interface ExitButton {
  mesh: THREE.Mesh;
  setLabel(text: string): void;
  /** Brighter while a controller ray points at it. */
  setHover(hover: boolean): void;
  dispose(): void;
}

/**
 * The way out of the headset session, inside it. The Quest's own menu button also ends a WebXR
 * session, but nobody finds it; this button sits right of the banner, which is always in view in
 * both modes. Point at it and pull the trigger.
 */
/** 'exit' is the red leave button; 'next' the blue "continue" button of a guided tour. */
export function createExitButton(variant: 'exit' | 'next' = 'exit'): ExitButton {
  const next = variant === 'next';
  const canvas = document.createElement('canvas');
  canvas.width = 640;
  canvas.height = 256;
  const ctx = canvas.getContext('2d')!;
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  const material = new THREE.MeshBasicMaterial({
    map: texture,
    transparent: true,
    depthTest: false,
    depthWrite: false,
    fog: false,
    toneMapped: false,
  });
  const mesh = new THREE.Mesh(new THREE.PlaneGeometry(EXIT_M.w, EXIT_M.h), material);
  mesh.name = next ? 'xr-next-button' : 'xr-exit-button';
  mesh.renderOrder = 1002;
  mesh.frustumCulled = false;

  let label = '';
  let hover = false;
  const draw = () => {
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    roundRect(ctx, 6, 6, canvas.width - 12, canvas.height - 12, 40);
    ctx.fillStyle = next
      ? (hover ? '#2b9bff' : 'rgba(0, 92, 170, 0.94)')
      : (hover ? '#FF0000' : 'rgba(150, 0, 0, 0.92)');
    ctx.fill();
    ctx.lineWidth = hover ? 12 : 6;
    ctx.strokeStyle = hover ? '#ffffff' : 'rgba(255, 255, 255, 0.7)';
    ctx.stroke();
    ctx.textBaseline = 'middle';
    ctx.textAlign = 'center';
    ctx.fillStyle = '#ffffff';
    ctx.font = '600 84px "Segoe UI", system-ui, sans-serif';
    ctx.fillText(next ? `${label} \u25B6` : `\u2715 ${label}`, canvas.width / 2, canvas.height / 2 + 4, canvas.width - 60);
    texture.needsUpdate = true;
  };

  return {
    mesh,
    setLabel(text) {
      if (text === label) return;
      label = text;
      draw();
    },
    setHover(value) {
      if (value === hover) return;
      hover = value;
      draw();
    },
    dispose() {
      texture.dispose();
      material.dispose();
      mesh.geometry.dispose();
    },
  };
}

export type AnswerState =
  | { status: 'listening' }
  | { status: 'thinking'; frage?: string }
  | { status: 'answer'; frage: string; antwort: string; note: string }
  | { status: 'error'; message: string };

export interface AnswerPanel {
  mesh: THREE.Mesh;
  /** Redraws the canvas once per change; nothing per frame. */
  show(state: AnswerState, labels: { listening: string; thinking: string; you: string }): void;
  dispose(): void;
}

const ANSWER_PX = { w: 1024, h: 560 };
export const ANSWER_M = { w: 0.96, h: 0.525 };

/** Lines of `text` that fit `width` pixels in the current font, at most `max` of them. */
function wrap(ctx: CanvasRenderingContext2D, text: string, width: number, max: number): string[] {
  const lines: string[] = [];
  let line = '';
  for (const word of text.split(/\s+/).filter(Boolean)) {
    const next = line ? `${line} ${word}` : word;
    if (ctx.measureText(next).width <= width || !line) {
      line = next;
    } else {
      lines.push(line);
      line = word;
      if (lines.length === max) break;
    }
  }
  if (line && lines.length < max) lines.push(line);
  if (lines.length === max && ctx.measureText(lines[max - 1]).width > width - 30) lines[max - 1] += ' \u2026';
  return lines;
}

/**
 * The spoken-question panel over the banner: "listening", "thinking", then the question as heard
 * and the answer. A canvas redrawn only when the state changes.
 */
export function createAnswerPanel(): AnswerPanel {
  const canvas = document.createElement('canvas');
  canvas.width = ANSWER_PX.w;
  canvas.height = ANSWER_PX.h;
  const ctx = canvas.getContext('2d')!;
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  const material = new THREE.MeshBasicMaterial({
    map: texture, transparent: true, depthTest: false, depthWrite: false, fog: false, toneMapped: false,
  });
  const mesh = new THREE.Mesh(new THREE.PlaneGeometry(ANSWER_M.w, ANSWER_M.h), material);
  mesh.name = 'xr-answer';
  mesh.renderOrder = 1003;
  mesh.frustumCulled = false;
  mesh.visible = false;

  return {
    mesh,
    show(state, labels) {
      ctx.clearRect(0, 0, canvas.width, canvas.height);
      roundRect(ctx, 4, 4, canvas.width - 8, canvas.height - 8, 28);
      ctx.fillStyle = 'rgba(10, 30, 52, 0.94)';
      ctx.fill();
      ctx.lineWidth = 4;
      ctx.strokeStyle = state.status === 'listening' ? '#FF0000' : 'rgba(43, 155, 255, 0.9)';
      ctx.stroke();
      ctx.textBaseline = 'top';
      ctx.textAlign = 'left';
      const x = 40;
      const width = canvas.width - 80;
      if (state.status === 'listening' || state.status === 'thinking') {
        ctx.fillStyle = state.status === 'listening' ? '#FF0000' : '#7cc4ff';
        ctx.font = '600 56px "Segoe UI", system-ui, sans-serif';
        ctx.fillText(state.status === 'listening' ? `\u25CF ${labels.listening}` : labels.thinking, x, 44, width);
        if (state.status === 'thinking' && state.frage) {
          ctx.fillStyle = 'rgba(255,255,255,0.75)';
          ctx.font = 'italic 38px "Segoe UI", system-ui, sans-serif';
          wrap(ctx, `${labels.you}: ${state.frage}`, width, 3).forEach((l, i) => ctx.fillText(l, x, 140 + i * 48, width));
        }
      } else if (state.status === 'error') {
        ctx.fillStyle = '#ffb3b3';
        ctx.font = '600 44px "Segoe UI", system-ui, sans-serif';
        wrap(ctx, state.message, width, 4).forEach((l, i) => ctx.fillText(l, x, 44 + i * 56, width));
      } else {
        ctx.fillStyle = 'rgba(255,255,255,0.7)';
        ctx.font = 'italic 34px "Segoe UI", system-ui, sans-serif';
        let y = 32;
        for (const l of wrap(ctx, `${labels.you}: ${state.frage}`, width, 2)) { ctx.fillText(l, x, y, width); y += 42; }
        y += 14;
        ctx.fillStyle = '#ffffff';
        ctx.font = '400 40px "Segoe UI", system-ui, sans-serif';
        for (const l of wrap(ctx, state.antwort, width, 7)) { ctx.fillText(l, x, y, width); y += 50; }
        ctx.fillStyle = '#9fb3b8';
        ctx.font = '400 28px "Segoe UI", system-ui, sans-serif';
        ctx.fillText(state.note, x, canvas.height - 52, width);
      }
      texture.needsUpdate = true;
      mesh.visible = true;
    },
    dispose() {
      texture.dispose();
      material.dispose();
      mesh.geometry.dispose();
    },
  };
}

/** One row of the headset menu. `on` draws a checkbox; without it the row is a plain action. */
export interface MenuRow {
  id: string;
  label: string;
  on?: boolean;
  /** Greyed while a layer is still being built. */
  busy?: boolean;
}

export interface MenuPanel {
  mesh: THREE.Mesh;
  /** Redraws only when something visible changed. */
  setRows(title: string, rows: MenuRow[]): void;
  setHover(index: number | null): void;
  /** Row under a texture coordinate of the plane, or null for the title and empty space. */
  rowAt(uv: THREE.Vector2): number | null;
  /** Centre of a row in the panel's own frame, metres. */
  rowCentre(index: number): THREE.Vector3;
  readonly rowCount: number;
  dispose(): void;
}

const MENU_PX = { w: 768, h: 960, title: 96, row: 72 };
/** Big enough to read at the banner's 2.2 m: a row is 6.6 cm, about 1.7 degrees. */
export const MENU_M = { w: 0.7, h: 0.875 };

/**
 * The layer menu (A): a list of switches over the banner, aimed at and triggered like the Exit
 * button. Drawn over everything, like the banner, so a roof cannot swallow it.
 */
export function createMenuPanel(): MenuPanel {
  const canvas = document.createElement('canvas');
  canvas.width = MENU_PX.w;
  canvas.height = MENU_PX.h;
  const ctx = canvas.getContext('2d')!;
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  const material = new THREE.MeshBasicMaterial({
    map: texture,
    transparent: true,
    depthTest: false,
    depthWrite: false,
    fog: false,
    toneMapped: false,
  });
  const mesh = new THREE.Mesh(new THREE.PlaneGeometry(MENU_M.w, MENU_M.h), material);
  mesh.name = 'xr-menu';
  mesh.renderOrder = 1003;
  mesh.frustumCulled = false;

  let title = '';
  let rows: MenuRow[] = [];
  let hover: number | null = null;
  let drawn = '';
  const draw = () => {
    const key = JSON.stringify([title, rows, hover]);
    if (key === drawn) return;
    drawn = key;
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    const height = MENU_PX.title + rows.length * MENU_PX.row + 24;
    roundRect(ctx, 4, 4, canvas.width - 8, height - 8, 28);
    ctx.fillStyle = 'rgba(16, 24, 32, 0.94)';
    ctx.fill();
    ctx.lineWidth = 4;
    ctx.strokeStyle = 'rgba(255, 255, 255, 0.5)';
    ctx.stroke();
    ctx.textBaseline = 'middle';
    ctx.textAlign = 'left';
    ctx.fillStyle = '#ffffff';
    ctx.font = '600 46px "Segoe UI", system-ui, sans-serif';
    ctx.fillText(title, 36, MENU_PX.title / 2 + 6, canvas.width - 72);
    rows.forEach((row, i) => {
      const y = MENU_PX.title + i * MENU_PX.row;
      if (i === hover) {
        roundRect(ctx, 16, y + 4, canvas.width - 32, MENU_PX.row - 8, 14);
        ctx.fillStyle = 'rgba(0, 120, 212, 0.85)';
        ctx.fill();
      }
      const mid = y + MENU_PX.row / 2;
      let x = 36;
      if (row.on !== undefined) {
        ctx.lineWidth = 4;
        ctx.strokeStyle = '#ffffff';
        ctx.strokeRect(x, mid - 18, 36, 36);
        if (row.on) {
          ctx.fillStyle = '#2b9bff';
          ctx.fillRect(x + 7, mid - 11, 22, 22);
        }
        x += 60;
      }
      ctx.fillStyle = row.busy ? 'rgba(255, 255, 255, 0.5)' : '#ffffff';
      ctx.font = `${row.on === undefined ? '600' : '400'} 38px "Segoe UI", system-ui, sans-serif`;
      ctx.fillText(row.busy ? `${row.label} \u2026` : row.label, x, mid + 2, canvas.width - x - 36);
    });
    texture.needsUpdate = true;
  };

  return {
    mesh,
    setRows(nextTitle, next) {
      title = nextTitle;
      rows = next;
      if (hover !== null && hover >= rows.length) hover = null;
      draw();
    },
    setHover(index) {
      hover = index;
      draw();
    },
    rowAt(uv) {
      const py = (1 - uv.y) * MENU_PX.h - MENU_PX.title;
      if (py < 0) return null;
      const index = Math.floor(py / MENU_PX.row);
      return index < rows.length ? index : null;
    },
    rowCentre(index) {
      const py = MENU_PX.title + (index + 0.5) * MENU_PX.row;
      return new THREE.Vector3(0, MENU_M.h / 2 - (py / MENU_PX.h) * MENU_M.h, 0);
    },
    get rowCount() { return rows.length; },
    dispose() {
      texture.dispose();
      material.dispose();
      mesh.geometry.dispose();
    },
  };
}

function roundRect(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  w: number,
  h: number,
  r: number
) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}

/**
 * Comfort vignette: darkens the edge of the view while moving.
 *
 * Optic flow in the periphery while the inner ear reports standing still is what makes smooth
 * locomotion sickening. Narrowing the view in proportion to speed is the standard, measured remedy,
 * and it costs one quad. Drawn as a child of the camera, in front of the near plane.
 */
export interface Vignette {
  mesh: THREE.Mesh;
  setStrength(value: number): void;
  dispose(): void;
}

export function createVignette(): Vignette {
  const material = new THREE.ShaderMaterial({
    transparent: true,
    depthTest: false,
    depthWrite: false,
    uniforms: { uStrength: { value: 0 } },
    vertexShader: /* glsl */ `
      varying vec2 vUv;
      void main() {
        vUv = uv * 2.0 - 1.0;
        gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
      }
    `,
    fragmentShader: /* glsl */ `
      uniform float uStrength;
      varying vec2 vUv;
      void main() {
        float r = length(vUv);
        // The clear centre shrinks as strength rises; the edge is soft so it reads as a vignette
        // rather than as a porthole.
        float inner = mix(1.2, 0.42, uStrength);
        float a = smoothstep(inner, inner + 0.35, r) * uStrength;
        gl_FragColor = vec4(0.0, 0.0, 0.0, a);
      }
    `,
  });
  // 0.2 m in front of the eyes and wide enough to cover the Quest's field of view at that distance.
  const mesh = new THREE.Mesh(new THREE.PlaneGeometry(0.9, 0.9), material);
  mesh.name = 'xr-vignette';
  mesh.position.set(0, 0, -0.2);
  mesh.renderOrder = 999;
  mesh.frustumCulled = false;
  mesh.visible = false;
  return {
    mesh,
    setStrength(value) {
      material.uniforms.uStrength.value = value;
      mesh.visible = value > 0.01;
    },
    dispose() {
      material.dispose();
      mesh.geometry.dispose();
    },
  };
}

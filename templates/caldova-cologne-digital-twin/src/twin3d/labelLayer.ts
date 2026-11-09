import * as THREE from 'three';

/**
 * Map labels — PLAN §7 phase 3.
 *
 * Drawn as HTML positioned over the canvas rather than as sprites in the scene. Text is the one
 * thing WebGL is worse at than the browser: a DOM label is crisp at every zoom, uses the page's
 * font, is selectable, is readable by a screen reader, and costs nothing to restyle. A texture
 * atlas of glyphs would be all of those things in reverse.
 *
 * Positions are updated imperatively from the render loop and written straight to `style.transform`
 * — never through React state. A dozen labels at 60 fps is 720 re-renders a second, which is a
 * measurable amount of work to do nothing useful.
 */

export interface LabelAnchor {
  id: string;
  text: string;
  /** World position of the thing being named. */
  position: THREE.Vector3;
  kind: 'place' | 'launch' | 'landing' | 'station' | 'pharmacy';
}

export interface LabelLayer {
  element: HTMLElement;
  update(camera: THREE.Camera, canvas: HTMLCanvasElement): void;
  setVisible(visible: boolean): void;
  /**
   * Add names discovered after the layer was built.
   *
   * ⚠️ THE PHARMACIES ARE NOT KNOWN WHEN THIS LAYER IS CREATED. The focus places come from the
   * AOI config and are available immediately; the 202 pharmacy names arrive with the operations
   * model, several awaits later. Appending is what avoids either building the whole scene in a
   * different order or standing up a second, near-identical label layer beside this one — and a
   * second layer would declutter against itself, so names from the two would overlap.
   */
  addAnchors(anchors: LabelAnchor[]): void;
  /**
   * Recompute the text of every name in place.
   *
   * ⚠️ THE LABELS ARE BUILT ONCE AND THE OPERATOR'S NAMES CAN BE SWITCHED OFF AT ANY MOMENT.
   * `node.textContent` is written when the button is created, so without this the map would keep
   * whatever names it was born with while the header and the place list changed underneath it —
   * the customer's name still on the map after being asked to take it off, which is the single
   * worst way for this feature to fail. The anchor's own text is updated too, so anything that
   * reads anchors later (declutter, tests) sees the same answer as the screen.
   */
  retext(next: (anchor: LabelAnchor) => string): void;
  /** Show or hide one class of name, so pharmacy names follow the delivery region. */
  setKindVisible(kind: LabelAnchor['kind'], visible: boolean): void;
  /**
   * Decide per name whether it may be drawn at all, before the declutter runs.
   *
   * ⚠️ LABELS ARE DOM AND THE FOG IS A SHADER, SO NOTHING CONNECTS THEM BY DEFAULT. At 02:00 the
   * night grade takes everything the tours have not reached to near black — and the pharmacy names
   * carried on being drawn over it, so the city centre was an empty black rectangle with
   * seventeen names floating in it. That reads as a broken render, and it also contradicts the
   * fog: the city is supposed to be uncovered BY the vans. This is how a name learns that.
   */
  setFilter(fn: ((anchor: LabelAnchor) => boolean) | null): void;
  /** Called with the anchor id when a label is clicked or activated from the keyboard. */
  onSelect(handler: ((id: string) => void) | null): void;
  /** Mark one label as the current subject, so the map agrees with the panel. */
  setActive(id: string | null): void;
  /** How many names are actually drawn right now, after decluttering. */
  shownCount(): number;
  /**
   * Counts from the last update, per kind: how many exist, how many were in frame, how many
   * survived the declutter.
   *
   * ⚠️ WITHOUT THIS THE DECLUTTER CANNOT BE TESTED. A hidden label looks identical whether it
   * was dropped for overlapping something or simply off screen, so "zooming in reveals more names"
   * — the property the whole greedy nearest-first scheme exists to provide — is unfalsifiable from
   * the DOM alone. Measuring in-frame separately from drawn is what makes it checkable.
   */
  stats(kind: LabelAnchor['kind']): { total: number; inFrame: number; drawn: number };
  dispose(): void;
}

const STYLES: Record<LabelAnchor['kind'], string> = {
  place: 'gs-label gs-label-place',
  launch: 'gs-label gs-label-launch',
  landing: 'gs-label gs-label-landing',
  station: 'gs-label gs-label-station',
  pharmacy: 'gs-label gs-label-pharmacy',
};

export function createLabelLayer(anchors: LabelAnchor[]): LabelLayer {
  const element = document.createElement('div');
  element.className = 'gs-labels';
  element.setAttribute('aria-hidden', 'false');

  let selectHandler: ((id: string) => void) | null = null;
  const hiddenKinds = new Set<LabelAnchor['kind']>();
  let filter: ((anchor: LabelAnchor) => boolean) | null = null;

  const build = (anchor: LabelAnchor) => {
    /*
     * ⚠️ A BUTTON, NOT A STYLED SPAN. These names are the most obvious thing to click on the whole
     * map, and until now clicking one did nothing at all. Making it a real button rather than a
     * span with a click handler is what gives it the keyboard, the focus ring and the role a
     * screen reader needs — the labels are already DOM precisely so they can behave like text.
     */
    const node = document.createElement('button');
    node.type = 'button';
    node.className = STYLES[anchor.kind];
    node.textContent = anchor.text;
    node.dataset.testid = `map-label-${anchor.id}`;
    node.dataset.place = anchor.id;
    node.addEventListener('click', (event) => {
      // The canvas sits underneath and treats a click as "deselect / put the building away".
      event.stopPropagation();
      selectHandler?.(anchor.id);
    });
    // Orbiting starts on pointerdown on the canvas; without this a drag that happens to begin on a
    // label would be swallowed by the button instead of moving the camera.
    node.addEventListener('pointerdown', (event) => event.stopPropagation());
    element.appendChild(node);
    return { anchor, node, shown: true };
  };

  const entries = anchors.map(build);

  const projected = new THREE.Vector3();
  // Reused across frames so decluttering allocates nothing in the render loop.
  const placed: { left: number; right: number; top: number; bottom: number }[] = [];
  const candidates: { entry: (typeof entries)[number]; x: number; y: number; depth: number }[] = [];
  const inFrameByKind = new Map<LabelAnchor['kind'], number>();

  return {
    element,
    update(camera, canvas) {
      const width = canvas.clientWidth;
      const height = canvas.clientHeight;

      candidates.length = 0;
      inFrameByKind.clear();
      for (const entry of entries) {
        if (hiddenKinds.has(entry.anchor.kind) || (filter !== null && !filter(entry.anchor))) {
          if (entry.shown) {
            entry.node.style.display = 'none';
            entry.shown = false;
          }
          continue;
        }
        projected.copy(entry.anchor.position).project(camera);

        // z outside [-1, 1] means the point is behind the camera or beyond the far plane. Without
        // this check a label behind the viewer reappears mirrored in front of them, which looks
        // like a bug in the map rather than in the label.
        const onScreen =
          projected.z > -1 &&
          projected.z < 1 &&
          projected.x > -1.2 &&
          projected.x < 1.2 &&
          projected.y > -1.2 &&
          projected.y < 1.2;

        if (!onScreen) {
          if (entry.shown) {
            entry.node.style.display = 'none';
            entry.shown = false;
          }
          continue;
        }

        candidates.push({
          entry,
          x: (projected.x * 0.5 + 0.5) * width,
          y: (-projected.y * 0.5 + 0.5) * height,
          depth: projected.z,
        });
        inFrameByKind.set(entry.anchor.kind, (inFrameByKind.get(entry.anchor.kind) ?? 0) + 1);
      }

      // ⚠️ DECLUTTER. Without this the Seybothstraße cluster is unreadable: ten named buildings
      // inside ~400 m collapse into overlapping strings at overview zoom — the deploy screenshot
      // showed "Seminargebäudeaude" written over "Laborgebäude Mikrosystemtechnik". Every label
      // was being drawn because each one is individually on screen, which is true and useless.
      //
      // Greedy, nearest-first: the closest label wins its box and anything overlapping it is
      // hidden until the camera moves. That is the standard cartographic answer and it has the
      // property that matters here — zooming IN reveals more names rather than fewer, so the
      // cluster resolves itself exactly when the viewer asks it to.
      candidates.sort((a, b) => a.depth - b.depth);
      placed.length = 0;

      for (const c of candidates) {
        const node = c.entry.node;
        // Measured once the node has text; offsetWidth is 0 while display:none, so fall back to a
        // conservative estimate rather than treating an unmeasured label as zero-sized.
        const w = node.offsetWidth || c.entry.anchor.text.length * 7;
        const h = node.offsetHeight || 16;
        const box = {
          left: c.x - w / 2 - 2,
          right: c.x + w / 2 + 2,
          top: c.y - h - 2,
          bottom: c.y + 2,
        };

        const collides = placed.some(
          (p) =>
            box.left < p.right && box.right > p.left && box.top < p.bottom && box.bottom > p.top
        );

        if (collides) {
          if (c.entry.shown) {
            node.style.display = 'none';
            c.entry.shown = false;
          }
          continue;
        }

        placed.push(box);
        if (!c.entry.shown) {
          node.style.display = '';
          c.entry.shown = true;
        }
        node.style.transform = `translate(-50%, -100%) translate(${c.x.toFixed(1)}px, ${c.y.toFixed(1)}px)`;
      }
    },
    setVisible(visible: boolean) {
      element.style.display = visible ? '' : 'none';
    },
    addAnchors(extra) {
      for (const anchor of extra) entries.push(build(anchor));
    },
    retext(next) {
      for (const entry of entries) {
        const text = next(entry.anchor);
        if (text === entry.anchor.text) continue;
        entry.anchor.text = text;
        entry.node.textContent = text;
      }
    },
    setKindVisible(kind, visible) {
      if (visible) hiddenKinds.delete(kind);
      else hiddenKinds.add(kind);
    },
    setFilter(fn) {
      filter = fn;
    },
    shownCount() {
      return entries.reduce((n, e) => n + (e.shown ? 1 : 0), 0);
    },
    stats(kind) {
      let total = 0;
      let drawn = 0;
      for (const e of entries) {
        if (e.anchor.kind !== kind) continue;
        total += 1;
        if (e.shown) drawn += 1;
      }
      return { total, inFrame: inFrameByKind.get(kind) ?? 0, drawn };
    },
    onSelect(handler) {
      selectHandler = handler;
    },
    setActive(id) {
      for (const entry of entries) {
        entry.node.classList.toggle('gs-label-active', entry.anchor.id === id);
        entry.node.setAttribute('aria-current', entry.anchor.id === id ? 'true' : 'false');
      }
    },
    dispose() {
      selectHandler = null;
      element.remove();
    },
  };
}

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
  kind: 'place' | 'launch' | 'landing' | 'station';
}

export interface LabelLayer {
  element: HTMLElement;
  update(camera: THREE.Camera, canvas: HTMLCanvasElement): void;
  setVisible(visible: boolean): void;
  /** Called with the anchor id when a label is clicked or activated from the keyboard. */
  onSelect(handler: ((id: string) => void) | null): void;
  /** Mark one label as the current subject, so the map agrees with the panel. */
  setActive(id: string | null): void;
  dispose(): void;
}

const STYLES: Record<LabelAnchor['kind'], string> = {
  place: 'gs-label gs-label-place',
  launch: 'gs-label gs-label-launch',
  landing: 'gs-label gs-label-landing',
  station: 'gs-label gs-label-station',
};

export function createLabelLayer(anchors: LabelAnchor[]): LabelLayer {
  const element = document.createElement('div');
  element.className = 'gs-labels';
  element.setAttribute('aria-hidden', 'false');

  let selectHandler: ((id: string) => void) | null = null;

  const entries = anchors.map((anchor) => {
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
  });

  const projected = new THREE.Vector3();
  // Reused across frames so decluttering allocates nothing in the render loop.
  const placed: { left: number; right: number; top: number; bottom: number }[] = [];
  const candidates: { entry: (typeof entries)[number]; x: number; y: number; depth: number }[] = [];

  return {
    element,
    update(camera, canvas) {
      const width = canvas.clientWidth;
      const height = canvas.clientHeight;

      candidates.length = 0;
      for (const entry of entries) {
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

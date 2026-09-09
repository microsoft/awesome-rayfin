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
  /**
   * Add more anchors after the layer exists — PLAN §8.
   *
   * A world's far sites stream in after the first frame, so their names cannot all be known when
   * the layer is built. Without this the Tegelberg arrived as an unnamed mountain.
   */
  addAnchors(anchors: LabelAnchor[]): void;
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

  const entries = anchors.map((anchor) => makeEntry(anchor));

  function makeEntry(anchor: LabelAnchor) {
    const node = document.createElement('span');
    node.className = STYLES[anchor.kind];
    node.textContent = anchor.text;
    element.appendChild(node);
    return { anchor, node, shown: true };
  }

  const projected = new THREE.Vector3();

  return {
    element,
    update(camera, canvas) {
      const width = canvas.clientWidth;
      const height = canvas.clientHeight;

      for (const entry of entries) {
        projected.copy(entry.anchor.position).project(camera);

        // z outside [-1, 1] means the point is behind the camera or beyond the far plane. Without
        // this check a label behind the viewer reappears mirrored in front of them, which looks
        // like a bug in the map rather than in the label.
        const visible =
          projected.z > -1 &&
          projected.z < 1 &&
          projected.x > -1.2 &&
          projected.x < 1.2 &&
          projected.y > -1.2 &&
          projected.y < 1.2;

        if (visible !== entry.shown) {
          entry.node.style.display = visible ? '' : 'none';
          entry.shown = visible;
        }
        if (!visible) continue;

        const x = (projected.x * 0.5 + 0.5) * width;
        const y = (-projected.y * 0.5 + 0.5) * height;
        entry.node.style.transform = `translate(-50%, -100%) translate(${x.toFixed(1)}px, ${y.toFixed(1)}px)`;
      }
    },
    setVisible(visible: boolean) {
      element.style.display = visible ? '' : 'none';
    },
    addAnchors(extra: LabelAnchor[]) {
      for (const anchor of extra) {
        if (entries.some((e) => e.anchor.id === anchor.id)) continue;
        entries.push(makeEntry(anchor));
      }
    },
    dispose() {
      element.remove();
    },
  };
}

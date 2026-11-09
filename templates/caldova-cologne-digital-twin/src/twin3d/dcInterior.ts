import * as THREE from 'three';

import { toWorld, type WorldExtent } from '@/geo/world';
import { buildZoneMachines } from './dcMachines';
import { footprintRect } from './footprintRect';
import { AMBIENT, SHADOW_TINT, SUN_DIRECTION, SUN_TINT } from './terrainMaterial';

/**
 * The inside of the distribution centre.
 *
 * ⚠️ THE ENVELOPE IS MEASURED, EVERYTHING INSIDE IT IS INVENTED, AND THE UI SAYS SO. The footprint
 * ring comes from the OpenStreetMap survey of the hero building; the roof height is measured from
 * the NRW nDOM50; the ground under it comes from the Geobasis NRW DGM1. The zone chain, the racking,
 * the A-frame, the conveyor and everything that moves are a model of how a full-line pharmaceutical
 * wholesaler is laid out. No wholesaler publishes its floor plan and this does not claim to be one.
 *
 * ⚠️ THE EXPLODE RUNS ALONG THE PROCESS, NOT UP THROUGH FLOORS. The engine this is forked from
 * pulls a university building apart by storey, because that is how a university building is
 * organised. A distribution centre is one tall hall: separating it vertically would produce a stack
 * of identical empty slabs and say nothing. Goods-in → storage → A-frame → pick → cold room → BtM →
 * consolidation → staging → docks is the axis along which the building actually means something,
 * and it is the axis the real hall is long in, so the two agree.
 */

export interface DcZone {
  id: string;
  name: { en: string };
  kind: string;
  sequence: number;
  colour: string;
  /** The most-read prose in the app, keyed by locale like the UI catalogue. */
  note: { en: string };
  areaM2: number;
  spanM: number;
  widthM: number;
  centreAlongM: number;
  rackRows: number;
  tempC: number | null;
  lineShare: number;
  peakFte: number;
}

export interface DcSlot {
  slotId: number;
  minute: number;
  label: string;
  hour: number;
  shift: string;
  lines: number;
}

export interface OperationsMeta {
  aoi: string;
  seed: number;
  provenance: Record<string, string>;
  envelope: {
    heroBuilding: string;
    footprintM2: number;
    eavesM: number;
    roofM: number;
    heightSource: string;
    headingRad: number;
    lengthM: number;
    widthM: number;
    ringLatLon: [number, number][];
    /** Measured hall rectangle (UTM32 easting, northing), goods-in end first; see generate_operations.py. */
    hallRectUtm?: [number, number][];
    /** Area of the OSM outline, which includes the forecourt (footprintM2 is the measured roof). */
    osmFootprintM2?: number;
  };
  zones: DcZone[];
  slots: DcSlot[];
  coldChain: { slotId: number; tempC: number; inRange: boolean }[];
  pickByZoneSlot: { zoneId: string; slotId: number; lines: number; fte: number; linesPerFteHour: number }[];
  tours: unknown[];
  kpis: Record<string, number>;
  pharmacies: { id: string; name: string; lat: number; lon: number; km: number }[];
}

export interface DcInteriorLayer {
  group: THREE.Group;
  meta: OperationsMeta;
  /** 0 = the hall is a closed shell, 1 = fully separated along the process chain. */
  setExplode(t: number): void;
  explodeValue(): number;
  /** Which quarter-hour of the day the machines are running at. */
  setSlot(slot: number): void;
  slotValue(): number;
  /** Highlight one zone, or none. */
  setSelectedZone(id: string | null): void;
  selectedZone(): string | null;
  /** Advance the moving parts. Wall-clock seconds. */
  update(loopTime: number): void;
  setVisible(visible: boolean): void;
  /** Where the hall is, so the camera can be sent there. */
  bounds: { centre: THREE.Vector3; radiusM: number; alongAxis: THREE.Vector3 };
  /** Raycast against the zone volumes. Returns the zone id, or null for a miss. */
  zoneAtPointer(ndc: THREE.Vector2, camera: THREE.Camera): string | null;
  /** How many moving totes are on the conveyor right now — a witness for the tests. */
  toteCount(): number;
  /** How many rack uprights were instanced. Zero would mean the machine level silently failed. */
  rackCount(): number;
  /**
   * Discrete machine positions across every zone — channels, chutes, cages, doors, cold-room
   * shelving. Separate from `rackCount` because racking existed before the machine level did, and
   * a check on racking alone would pass on a hall whose other seven zones were empty boxes.
   */
  stationCount(): number;
  dispose(): void;
}

/** Metres the zones separate by at full explode. */
const EXPLODE_GAP_M = 14;

/**
 * How far the whole interior RISES out of the building as it opens.
 *
 * ⚠️ THIS IS THE FIX FOR A REAL DEFECT, NOT A STYLING CHOICE. The first version left the interior
 * inside the building's own footprint at ground level, where it was perfectly correct, fully
 * instanced, reporting `explode = 1.00` — and completely invisible, because the measured LoD2
 * building is a solid opaque box standing in exactly the same place. The render gate caught it as
 * "the hall reports itself open" passing while "opening the hall changes the picture" failed, which
 * is precisely the pair of symptoms that means a flag was set and nothing was drawn.
 *
 * The campus twin solves the same problem by fading the LoD2 shell away, but it is fading ONE
 * building on a site of 353. Here the district is 5.538 buildings and the photoreal context is
 * half of why the site is worth showing — dissolving the neighbourhood to look inside one warehouse trades
 * the wrong thing away.
 *
 * So the contents lift clear of the roof instead. It is the classic exploded-assembly idiom, it
 * keeps the measured city intact underneath, and it carries an honesty argument the fade does not:
 * a modelled interior floating above the real building cannot be mistaken for a photograph of the
 * inside of that building.
 */
const EXPLODE_RISE_M = 26;
/** Air between the measured roof (incl. plant) and the underside of the risen assembly. */
const EXPLODE_CLEARANCE_M = 8;

/**
 * How far the zones lift RELATIVE TO EACH OTHER as they separate.
 *
 * ⚠️ Small, and deliberately so. The campus explode lifts floors by 26 m because it is separating
 * things that are genuinely stacked. These zones are side by side on one slab, so lifting them far
 * would invent a vertical arrangement the building does not have.
 */
const EXPLODE_LIFT_M = 1.4;

function disposeTree(root: THREE.Object3D): void {
  root.traverse((o) => {
    const m = o as THREE.Mesh;
    if (m.geometry) m.geometry.dispose();
    const mat = m.material as THREE.Material | THREE.Material[] | undefined;
    if (Array.isArray(mat)) mat.forEach((x) => x.dispose());
    else mat?.dispose();
  });
}

export async function loadDcInterior(
  aoiId: string,
  root: string,
  ext: WorldExtent,
  groundAt: (x: number, z: number) => number | null
): Promise<DcInteriorLayer | null> {
  const response = await fetch(`${root}/${aoiId}/operations.json`);
  if (!response.ok) return null;
  const meta = (await response.json()) as OperationsMeta;
  if (!meta.envelope?.ringLatLon?.length) return null;

  // ── the measured footprint, in world metres ───────────────────────────────────────────────────
  //
  // ⚠️ The axis is recomputed HERE rather than reusing the heading the generator wrote. The
  // generator works in UTM (x east, y north); this scene works in world metres with **+z south**,
  // so northing is inverted between them. Carrying the UTM heading across that flip would mirror
  // the process chain — goods-in would end up where the docks are, which is exactly the kind of
  // error that looks like a deliberate layout choice rather than a sign error.
  const ringWorld = meta.envelope.ringLatLon.map(([lat, lon]) => {
    const g = groundAt(0, 0);
    return toWorld(lon, lat, ext, g ?? 0);
  });
  if (ringWorld.length > 1) {
    const first = ringWorld[0];
    const last = ringWorld[ringWorld.length - 1];
    if (Math.abs(first.x - last.x) < 0.01 && Math.abs(first.z - last.z) < 0.01) ringWorld.pop();
  }

  // The hall rectangle (footprintRect.ts), the same one the generator sized the zones in: measured
  // from the nDOM50 roof (`hallRectUtm`), because the OSM ring also takes in the forecourt. Only
  // without it the rectangle is fitted to the ring. UTM → world as in toWorld() (geo/world.ts).
  const hallRect = meta.envelope.hallRectUtm?.map(([e, n]) => ({
    x: e - ext.minEasting - ext.widthM / 2,
    z: ext.maxNorthing - n - ext.depthM / 2,
  }));
  const rect = footprintRect(hallRect?.length === 4 ? hallRect : ringWorld);
  const cx = rect.centre.x;
  const cz = rect.centre.z;
  const theta = rect.theta;
  const along = new THREE.Vector3(Math.cos(theta), 0, Math.sin(theta));
  const across = new THREE.Vector3(-Math.sin(theta), 0, Math.cos(theta));
  const lengthM = rect.lengthM;
  const widthM = rect.widthM;

  const groundM = groundAt(cx, cz) ?? 0;
  const eaves = meta.envelope.eavesM ?? 10;
  const roofH = meta.envelope.roofM ?? 2;
  /**
   * How far the assembly rises: clear of the MEASURED roof, not a constant.
   *
   * ⚠️ The engine rose 26 m, which cleared a 12 m warehouse. The Confex is 27.6 m to the main roof
   * plus 5.9 m of rooftop plant (NRW nDOM50, generate_operations.py), and the photogrammetric mesh
   * shows that roof — a 26 m rise would leave the interior inside it.
   */
  const riseM = Math.max(EXPLODE_RISE_M, eaves + roofH + EXPLODE_CLEARANCE_M);

  const group = new THREE.Group();
  group.name = 'dc-interior';
  group.visible = false;

  // ── light ────────────────────────────────────────────────────────────────────────────────────
  //
  // ONCE THE TERRAIN IS REAL, THIS SCENE CONTAINS NO LIGHTS AT ALL. Every existing layer —
  // terrain, shell, buildings, vegetation, water, flows — is a custom ShaderMaterial that computes
  // its own lighting from `SUN_DIRECTION` and friends, so nobody ever needed one. Lights are added
  // only in the placeholder branch, which runs when the terrain is MISSING.
  //
  // ⚠️ This is a trap, and it cost a diagnosis. `MeshStandardMaterial` in an unlit scene renders
  // pure black while behaving perfectly in every other respect: correct geometry, correct
  // transforms, no warning, no error. The hall appeared as a stack of black slabs and the only
  // reason it was visible at all was the one material carrying an `emissive` term. "Renders black"
  // reads as a broken shader or a missing texture; it was neither.
  //
  // The values come from `terrainMaterial` rather than being chosen here, so the hall is lit by
  // the same sun the ground is shaded by — a differently-lit insert would sit on the site like a
  // sticker.
  const sunDirection = new THREE.Vector3(...SUN_DIRECTION).normalize();
  const sun = new THREE.DirectionalLight(new THREE.Color(...SUN_TINT), 1.15);
  sun.position.copy(sunDirection).multiplyScalar(3000);
  group.add(sun);
  group.add(
    new THREE.HemisphereLight(new THREE.Color(...SUN_TINT), new THREE.Color(...SHADOW_TINT), AMBIENT)
  );

  /** Put a local (along, across, up) offset into world space. */
  const place = (a: number, c: number, y: number): THREE.Vector3 =>
    new THREE.Vector3(
      cx + along.x * a + across.x * c,
      groundM + y,
      cz + along.z * a + across.z * c
    );

  // ── floor slab ────────────────────────────────────────────────────────────────────────────────
  const slab = new THREE.Mesh(
    new THREE.BoxGeometry(lengthM + 2, 0.35, widthM + 2),
    new THREE.MeshStandardMaterial({ color: 0x9a9a97, roughness: 0.95, metalness: 0 })
  );
  slab.position.copy(place(0, 0, 0.18));
  slab.rotation.y = -theta;
  group.add(slab);

  // ── the zones ─────────────────────────────────────────────────────────────────────────────────
  const zoneGroups: { zone: DcZone; group: THREE.Group; restAlong: number }[] = [];
  const pickTargets: THREE.Mesh[] = [];
  const zoneMaterials = new Map<string, THREE.MeshStandardMaterial>();
  /** The floor patches, kept because selection has to move them — they dominate the picture. */
  const zonePatchMaterials = new Map<string, THREE.MeshStandardMaterial>();

  let rackCount = 0;
  let stationCount = 0;
  /** Instanced meshes the zone builders handed back for animation, tagged by kind. */
  const machineParts: { mesh: THREE.InstancedMesh; kind: string }[] = [];

  for (const zone of meta.zones) {
    const zg = new THREE.Group();
    zg.name = `zone-${zone.id}`;
    const span = zone.spanM;
    const a0 = zone.centreAlongM;

    const colour = new THREE.Color(zone.colour);
    // ⚠️ VERY translucent, and that is the whole point of the volume. It is a LABEL for a region
    // of the hall; the racking, the A-frame and the conveyor inside it are the subject. The first
    // version used 0.42 and the coloured boxes hid every machine they existed to point at — the
    // classic mistake of letting the annotation out-compete the thing annotated.
    const mat = new THREE.MeshStandardMaterial({
      color: colour,
      roughness: 0.85,
      metalness: 0.05,
      transparent: true,
      opacity: 0.16,
      depthWrite: false,
      // Black until selected. Emissive is what makes a selected zone read as LIT rather than
      // merely less transparent — opacity alone competes with whatever is behind it.
      emissive: new THREE.Color(0x000000),
    });
    zoneMaterials.set(zone.id, mat);

    // The zone volume. Deliberately translucent: it is a label for a region of the hall, and a
    // solid block would hide the machinery it exists to point at.
    const volume = new THREE.Mesh(new THREE.BoxGeometry(span * 0.94, eaves * 0.9, widthM * 0.94), mat);
    volume.position.copy(place(a0, 0, eaves * 0.45 + 0.35));
    volume.rotation.y = -theta;
    volume.userData.zoneId = zone.id;
    zg.add(volume);
    pickTargets.push(volume);

    // A bright floor patch so the zone still reads from directly above, where a translucent
    // box seen edge-on almost disappears.
    //
    // ⚠️ THIS MATERIAL MUST BE DRIVEN BY SELECTION TOO. At 0.85 opacity the patch is by far the
    // loudest thing a zone draws, and for a long time selection only touched the volume above it.
    // The result was a highlight that was real in the code and invisible on screen: every zone
    // kept its full-strength floor colour whatever was selected. Whichever element dominates the
    // picture is the one the highlight has to move.
    const patchMat = new THREE.MeshStandardMaterial({
      color: colour,
      roughness: 0.9,
      opacity: 0.85,
      transparent: true,
      emissive: new THREE.Color(0x000000),
    });
    zonePatchMaterials.set(zone.id, patchMat);
    const patch = new THREE.Mesh(new THREE.BoxGeometry(span * 0.94, 0.12, widthM * 0.94), patchMat);
    patch.position.copy(place(a0, 0, 0.42));
    patch.rotation.y = -theta;
    zg.add(patch);

    // ── machine level ───────────────────────────────────────────────────────────────────────────
    // Instanced, because the whole point of a warehouse is that there is a great deal of the same
    // thing in it and the cost of drawing it has to be independent of how much.
    //
    // ⚠️ THE MACHINES ARE PARENTED TO THE ZONE GROUP, AND THAT IS A FIX FOR A MEASURED DEFECT.
    // Only the racking used to be; the A-frame, its belt and the dock doors were added to the
    // interior group instead. `applyExplode` translates zone groups, so on opening the hall the
    // a_frame zone travelled 39.2 m while the machine inside it moved only the 26 m global rise —
    // and the docks zone slid 56 m clear of its own doors. The zone volume is a label for its
    // contents; if the contents do not travel with the label, the exploded view is telling a lie
    // about which machine belongs where.
    const machines = buildZoneMachines(zone, {
      place,
      theta,
      a0,
      span,
      widthM,
      eavesM: eaves,
    });
    for (const object of machines.objects) zg.add(object);
    rackCount += machines.rackPositions;
    stationCount += machines.stations;
    for (const part of machines.animated) {
      machineParts.push({ mesh: part.mesh, kind: part.kind });
    }

    zoneGroups.push({ zone, group: zg, restAlong: a0 });
    group.add(zg);
  }

  // ── the conveyor spine ────────────────────────────────────────────────────────────────────────
  // A-frame → consolidation → staging → docks. It is what makes the hall read as one process
  // rather than as nine coloured boxes standing next to each other.
  //
  // ⚠️ THE SPINE IS THE ONE THING THAT STAYS PARENTED TO THE INTERIOR RATHER THAN TO A ZONE, AND
  // IT HAS TO STRETCH INSTEAD. Every machine belongs to exactly one zone and travels with it; a
  // conveyor belongs to the gap BETWEEN zones, so there is no zone to attach it to. Leaving it at
  // a fixed length would break the connection the moment the hall opened — the through-line would
  // end in mid-air short of the docks, which is worse than not drawing it. So `applyExplode`
  // rescales it to span wherever its two end zones have moved to.
  const spineFrom = meta.zones.find((z) => z.id === 'a_frame');
  const spineTo = meta.zones.find((z) => z.id === 'docks');
  let totes: THREE.InstancedMesh | null = null;
  const TOTES = 34;
  /** The rail, its rest length, and the live end points the totes ride between. */
  let spineRail: THREE.Mesh | null = null;
  let spineRestLength = 1;
  let spineLiveStart = 0;
  let spineLiveEnd = 0;
  if (spineFrom && spineTo) {
    const aStart = spineFrom.centreAlongM;
    const aEnd = spineTo.centreAlongM;
    const q = new THREE.Quaternion().setFromEuler(new THREE.Euler(0, -theta, 0));
    const one = new THREE.Vector3(1, 1, 1);

    const rail = new THREE.Mesh(
      new THREE.BoxGeometry(Math.abs(aEnd - aStart), 0.22, 1.15),
      new THREE.MeshStandardMaterial({ color: 0x4a5058, roughness: 0.75, metalness: 0.3 })
    );
    rail.position.copy(place((aStart + aEnd) / 2, widthM * 0.3, 1.35));
    rail.rotation.y = -theta;
    group.add(rail);
    spineRail = rail;
    spineRestLength = Math.max(0.001, Math.abs(aEnd - aStart));
    spineLiveStart = aStart;
    spineLiveEnd = aEnd;

    totes = new THREE.InstancedMesh(
      new THREE.BoxGeometry(0.62, 0.34, 0.42),
      new THREE.MeshStandardMaterial({ color: 0x0f7f63, roughness: 0.65 }),
      TOTES
    );
    const m = new THREE.Matrix4();
    for (let i = 0; i < TOTES; i += 1) {
      m.compose(place(aStart, widthM * 0.3, 1.7), q, one);
      totes.setMatrixAt(i, m);
    }
    totes.instanceMatrix.needsUpdate = true;
    totes.userData = { aStart, aEnd };
    group.add(totes);
  }

  // ── the footprint the interior came out of ────────────────────────────────────────────────────
  // Stays on the ground while the contents rise, so the lift reads as "this came from THERE"
  // rather than as a diagram parked in mid-air over an industrial estate.
  const outline = new THREE.Mesh(
    new THREE.BoxGeometry(lengthM, 0.25, widthM),
    new THREE.MeshStandardMaterial({
      color: 0x099775,
      roughness: 0.6,
      transparent: true,
      opacity: 0,
      emissive: 0x044032,
    })
  );
  outline.position.copy(place(0, 0, eaves + roofH + 0.4));
  outline.rotation.y = -theta;
  group.add(outline);
  const outlineMaterial = outline.material as THREE.MeshStandardMaterial;

  // ── state ─────────────────────────────────────────────────────────────────────────────────────
  let explodeT = 0;
  let slot = 0;
  let selected: string | null = null;
  const raycaster = new THREE.Raycaster();

  const applyExplode = (t: number): void => {
    explodeT = t;
    // The whole assembly rises clear of the measured building. See EXPLODE_RISE_M.
    group.position.y = riseM * t;
    const mid = (meta.zones.length - 1) / 2;
    const offsetOf = (zone: DcZone): number => (zone.sequence - mid) * EXPLODE_GAP_M * t;
    for (const { zone, group: zg, restAlong } of zoneGroups) {
      const offset = offsetOf(zone);
      zg.position.copy(
        new THREE.Vector3(along.x * offset, EXPLODE_LIFT_M * t, along.z * offset)
      );
      void restAlong;
    }

    // The conveyor is the only thing that spans zones, so it is the only thing that has to be
    // rebuilt as they separate: stretched to reach wherever its two ends have gone, and lifted by
    // the same amount the zones lift so it stays at belt height relative to them.
    if (spineRail && spineFrom && spineTo) {
      spineLiveStart = spineFrom.centreAlongM + offsetOf(spineFrom);
      spineLiveEnd = spineTo.centreAlongM + offsetOf(spineTo);
      const length = Math.abs(spineLiveEnd - spineLiveStart);
      spineRail.scale.x = length / spineRestLength;
      spineRail.position.copy(
        place((spineLiveStart + spineLiveEnd) / 2, widthM * 0.3, 1.35 + EXPLODE_LIFT_M * t)
      );
    }
    // The marker on the roof fades in only once the contents have actually cleared it, so it never
    // appears to be a lid the assembly is passing through.
    outlineMaterial.opacity = Math.max(0, (t - 0.45) / 0.55) * 0.5;
    outline.visible = outlineMaterial.opacity > 0.02;
  };
  applyExplode(0);

  /** Activity at the current quarter-hour, 0..1, from the day the generator produced. */
  const activity = (): number => {
    const peak = Math.max(...meta.slots.map((s) => s.lines), 1);
    return (meta.slots[slot]?.lines ?? 0) / peak;
  };

  const tmpMatrix = new THREE.Matrix4();
  const tmpQuat = new THREE.Quaternion().setFromEuler(new THREE.Euler(0, -theta, 0));
  const tmpScale = new THREE.Vector3(1, 1, 1);

  const layer: DcInteriorLayer = {
    group,
    meta,
    setExplode: applyExplode,
    explodeValue: () => explodeT,
    setSlot(next) {
      slot = Math.max(0, Math.min(meta.slots.length - 1, Math.round(next)));
    },
    slotValue: () => slot,
    setSelectedZone(id) {
      selected = id;
      // Selection raises brightness rather than changing hue: the colour already carries the
      // zone's identity, and recolouring it would break the legend the moment anything is
      // selected. What changes is how LIT it is — emissive, plus opacity — and, critically, it
      // changes on BOTH the volume and the floor patch. Moving only the volume left the highlight
      // invisible for weeks, because the patch is the louder of the two.
      for (const [zoneId, mat] of zoneMaterials) {
        const isSelected = zoneId === id;
        mat.opacity = id === null ? 0.16 : isSelected ? 0.5 : 0.035;
        mat.emissive.set(isSelected && id !== null ? mat.color : 0x000000);
        mat.emissiveIntensity = isSelected && id !== null ? 0.55 : 0;
      }
      for (const [zoneId, mat] of zonePatchMaterials) {
        const isSelected = zoneId === id;
        mat.opacity = id === null ? 0.85 : isSelected ? 1 : 0.14;
        mat.emissive.set(isSelected && id !== null ? mat.color : 0x000000);
        mat.emissiveIntensity = isSelected && id !== null ? 0.75 : 0;
      }
    },
    selectedZone: () => selected,
    update(loopTime) {
      // Everything that moves is driven by ONE clock and scaled by the day's activity, so the
      // scrubber drives the machines for free and a quiet hour looks quiet.
      const speed = 0.25 + 1.75 * activity();

      if (totes) {
        // The ends come from `applyExplode`, not from the closed-hall layout: totes that keep
        // running between the original positions would leave the rail behind the moment the hall
        // opened and slide through the air where the conveyor used to be.
        const run = spineLiveEnd - spineLiveStart;
        const lift = EXPLODE_LIFT_M * explodeT;
        for (let i = 0; i < TOTES; i += 1) {
          const phase = ((loopTime * speed * 0.09 + i / TOTES) % 1 + 1) % 1;
          const a = spineLiveStart + run * phase;
          tmpMatrix.compose(place(a, widthM * 0.3, 1.7 + lift), tmpQuat, tmpScale);
          totes.setMatrixAt(i, tmpMatrix);
        }
        totes.instanceMatrix.needsUpdate = true;
      }

      for (const part of machineParts) {
        if (part.kind !== 'pack') continue;
        const { a0, span } = part.mesh.userData as { a0: number; span: number };
        const count = part.mesh.count;
        for (let i = 0; i < count; i += 1) {
          const phase = ((loopTime * speed * 0.22 + i / count) % 1 + 1) % 1;
          const a = a0 - span * 0.43 + span * 0.86 * phase;
          tmpMatrix.compose(place(a, 0, 1.12), tmpQuat, tmpScale);
          part.mesh.setMatrixAt(i, tmpMatrix);
        }
        part.mesh.instanceMatrix.needsUpdate = true;
      }
    },
    setVisible(visible) {
      group.visible = visible;
    },
    bounds: {
      // ⚠️ Aimed at where the assembly ENDS UP, not where it starts. The contents rise by
      // EXPLODE_RISE_M as they open, so framing the closed position puts the camera looking at the
      // roof of the building the interior has just left.
      centre: new THREE.Vector3(cx, groundM + eaves + riseM * 0.75, cz),
      radiusM: Math.max(lengthM + EXPLODE_GAP_M * meta.zones.length, widthM) / 2,
      alongAxis: along.clone(),
    },
    zoneAtPointer(ndc, camera) {
      raycaster.setFromCamera(ndc, camera);
      const hits = raycaster.intersectObjects(pickTargets, false);
      return (hits[0]?.object.userData.zoneId as string | undefined) ?? null;
    },
    toteCount: () => (totes ? TOTES : 0),
    rackCount: () => rackCount,
    stationCount: () => stationCount,
    dispose() {
      disposeTree(group);
      group.removeFromParent();
    },
  };

  return layer;
}

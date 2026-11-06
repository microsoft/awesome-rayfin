import * as THREE from 'three';

import type { DcZone } from './dcInterior';

/**
 * The machine level of a full-line pharmaceutical distribution centre.
 *
 * ⚠️ SIX OF THE NINE ZONES USED TO BE EMPTY COLOURED BOXES, AND THAT IS A CREDIBILITY PROBLEM
 * RATHER THAN A MISSING FEATURE. Only bulk storage and manual pick had anything inside them,
 * because both are racking and racking was the one thing modelled. Goods-in, the cold room, the
 * narcotics safe, consolidation, staging and the docks were translucent volumes with a label. A
 * viewer who works in this industry reads an empty cold room as "they did not model the cold
 * chain" — in a demo whose whole argument is GDP temperature compliance, that is the one zone that
 * cannot be a empty box.
 *
 * ⚠️ EVERYTHING HERE IS SYNTHETIC AND MUST STAY BADGED. The envelope is measured — footprint from
 * the OpenStreetMap survey, eaves height from a neighbouring hall of the same complex, ground from
 * the LGL laser model. What is modelled below is the SHAPE of full-line wholesale: goods in from
 * pre-wholesalers, bulk to reserve racking, fast movers through an A-frame that no hand touches,
 * slow movers picked by people, cold chain held between 2 and 8 °C, narcotics behind a cage, then
 * merged per pharmacy, staged in load sequence and pushed out on tours twice a day. A wholesaler
 * should recognise the process and should not recognise a single number.
 *
 * The dispatcher keys on `zone.kind`. Every builder works in the zone's own local frame via
 * `ctx.place(along, across, up)`, so machines land inside the zone volume and — because the
 * interior layer parents them to the zone group — travel with it when the hall opens.
 */

export interface MachineContext {
  /** Local (along, across, up) offset into the interior group's space. */
  place: (a: number, c: number, y: number) => THREE.Vector3;
  /** Rotation of the hall's principal axis, so machines line up with the building. */
  theta: number;
  /** Centre of this zone along the process axis, and its extent. */
  a0: number;
  span: number;
  widthM: number;
  eavesM: number;
}

export interface MachineResult {
  objects: THREE.Object3D[];
  /** Discrete machine positions placed — a witness for the render gate. */
  stations: number;
  /** Rack positions, counted separately because the gate has always tracked racking. */
  rackPositions: number;
  /** Instanced meshes the interior layer animates, tagged by kind. */
  animated: { mesh: THREE.InstancedMesh; kind: string }[];
}

/*
 * ⚠️ MATERIALS ARE CREATED PER CALL, NOT SHARED MODULE-WIDE. Sharing would save a handful of draw
 * calls and introduce a real hazard: `disposeTree` walks the interior and disposes every material
 * it finds, so one shared instance would be disposed once per zone that used it. Disposal is
 * cheap to repeat but not safe to interleave with a partially torn-down tree, and the saving is
 * not worth owning that question.
 */
const steel = () => new THREE.MeshStandardMaterial({ color: 0x8d949c, roughness: 0.55, metalness: 0.45 });
const darkSteel = () => new THREE.MeshStandardMaterial({ color: 0x3f4550, roughness: 0.7, metalness: 0.35 });
const belt = () => new THREE.MeshStandardMaterial({ color: 0x23262b, roughness: 0.85 });
const housing = () => new THREE.MeshStandardMaterial({ color: 0xeef1f4, roughness: 0.5, metalness: 0.15 });
const carton = () => new THREE.MeshStandardMaterial({ color: 0xb08b58, roughness: 0.9 });
const wrapped = () => new THREE.MeshStandardMaterial({ color: 0x9fb0c4, roughness: 0.55, transparent: true, opacity: 0.85 });
const tote = () => new THREE.MeshStandardMaterial({ color: 0x0f7f63, roughness: 0.65 });
const chill = () =>
  new THREE.MeshStandardMaterial({
    color: 0xbfe4f2,
    roughness: 0.35,
    metalness: 0.1,
    transparent: true,
    opacity: 0.42,
    emissive: 0x0b3547,
  });
const warnPaint = () => new THREE.MeshStandardMaterial({ color: 0xf2c744, roughness: 0.9, emissive: 0x3a2c00 });
const alarmRed = () => new THREE.MeshStandardMaterial({ color: 0xd83b3b, roughness: 0.4, emissive: 0x5a0d0d });

/** Pack colours for the A-frame channels: real medicine cartons are not all one colour. */
const PACK_COLOURS = [0xf4f1e8, 0xe8e2d0, 0xf6d68a, 0xd6e5f2, 0xe9cfd8, 0xdfe9d5];

/** Repeat one geometry across a zone as an InstancedMesh laid out in rows and bays. */
function grid(
  ctx: MachineContext,
  geometry: THREE.BufferGeometry,
  material: THREE.Material,
  rows: number,
  bays: number,
  y: number,
  acrossFraction = 0.7
): { mesh: THREE.InstancedMesh; count: number } {
  const total = Math.max(1, rows * bays);
  const mesh = new THREE.InstancedMesh(geometry, material, total);
  const q = new THREE.Quaternion().setFromEuler(new THREE.Euler(0, -ctx.theta, 0));
  const one = new THREE.Vector3(1, 1, 1);
  const m = new THREE.Matrix4();
  let i = 0;
  for (let r = 0; r < rows; r += 1) {
    const c = rows === 1 ? 0 : ((r + 0.5) / rows - 0.5) * ctx.widthM * acrossFraction;
    for (let b = 0; b < bays; b += 1) {
      const a = ctx.a0 + ((b + 0.5) / bays - 0.5) * ctx.span * 0.82;
      m.compose(ctx.place(a, c, y), q, one);
      mesh.setMatrixAt(i, m);
      i += 1;
    }
  }
  mesh.instanceMatrix.needsUpdate = true;
  return { mesh, count: total };
}

/** A box in the zone's local frame: x runs along the process, z across it, y up. */
function slab(
  ctx: MachineContext,
  size: [number, number, number],
  at: [number, number, number],
  material: THREE.Material
): THREE.Mesh {
  const mesh = new THREE.Mesh(new THREE.BoxGeometry(...size), material);
  mesh.position.copy(ctx.place(ctx.a0 + at[0], at[1], at[2]));
  mesh.rotation.y = -ctx.theta;
  return mesh;
}

/**
 * Pallet racking, with the uprights it was missing.
 *
 * ⚠️ THE FIRST VERSION DREW BEAMS AND PALLETS AND NO FRAMES, so five levels of load floated in
 * mid-air in neat rows. It reads as racking at a distance and falls apart the moment the camera
 * gets close — which is exactly what the hall's fly-in does. The uprights are the cheapest
 * possible fix and they are what makes the aisles read as aisles.
 */
function palletRacking(ctx: MachineContext, rows: number): MachineResult {
  const { span, widthM, place, theta } = ctx;
  const bays = Math.max(2, Math.floor(span / 1.4));
  const levels = 5;
  const total = rows * bays * levels;

  const beams = new THREE.InstancedMesh(new THREE.BoxGeometry(1.25, 0.14, 1.05), darkSteel(), total);
  const loads = new THREE.InstancedMesh(new THREE.BoxGeometry(1.0, 0.8, 0.85), carton(), total);
  // One upright per bay boundary per row, full height: the frame the beams hang on.
  const uprightTotal = rows * (bays + 1);
  const uprights = new THREE.InstancedMesh(
    new THREE.BoxGeometry(0.11, levels * 1.85 + 0.5, 0.95),
    steel(),
    uprightTotal
  );

  const m = new THREE.Matrix4();
  const q = new THREE.Quaternion().setFromEuler(new THREE.Euler(0, -theta, 0));
  const one = new THREE.Vector3(1, 1, 1);
  const colour = new THREE.Color();

  let i = 0;
  for (let r = 0; r < rows; r += 1) {
    const c = ((r + 0.5) / rows - 0.5) * widthM * 0.82;
    for (let b = 0; b < bays; b += 1) {
      const a = ctx.a0 + ((b + 0.5) / bays - 0.5) * span * 0.88;
      for (let l = 0; l < levels; l += 1) {
        const y = 1.1 + l * 1.85;
        m.compose(place(a, c, y), q, one);
        beams.setMatrixAt(i, m);
        // Not every slot is full. A rack with every position occupied reads as a render.
        const filled = ((r * 7 + b * 13 + l * 5) % 11) > 2;
        m.compose(place(a, c, filled ? y + 0.55 : -50), q, one);
        loads.setMatrixAt(i, m);
        // Slight tonal variation so the load faces do not stripe.
        const tint = 0.86 + (((r * 5 + b * 3 + l) % 7) / 7) * 0.28;
        loads.setColorAt(i, colour.setRGB(0.69 * tint, 0.55 * tint, 0.35 * tint));
        i += 1;
      }
    }
  }

  let u = 0;
  for (let r = 0; r < rows; r += 1) {
    const c = ((r + 0.5) / rows - 0.5) * widthM * 0.82;
    for (let b = 0; b <= bays; b += 1) {
      const a = ctx.a0 + (b / bays - 0.5) * span * 0.88;
      m.compose(place(a, c, (levels * 1.85 + 0.5) / 2), q, one);
      uprights.setMatrixAt(u, m);
      u += 1;
    }
  }

  beams.instanceMatrix.needsUpdate = true;
  loads.instanceMatrix.needsUpdate = true;
  uprights.instanceMatrix.needsUpdate = true;
  if (loads.instanceColor) loads.instanceColor.needsUpdate = true;

  return { objects: [beams, loads, uprights], stations: uprightTotal, rackPositions: total, animated: [] };
}

/**
 * The A-frame dispenser — the hero machine, and the one that defines this industry.
 *
 * ⚠️ IT USED TO BE TWO TILTED BOXES AND A STRIP. That is defensible as a placeholder and
 * indefensible as the centrepiece: the A-frame is the single machine a pharmaceutical wholesaler
 * will look for, it handles 46 % of this hall's order lines, and "the machine that makes this
 * industry work" is what the zone's own caption calls it. A viewer who knows the machine saw two
 * grey wedges.
 *
 * What an A-frame actually is: two banks of narrow vertical channels leaning together over a
 * central belt, like the two sides of a capital A. Each channel holds a stack of one product.
 * An ejector at the foot of a channel kicks the bottom pack onto the moving belt as the order
 * passes underneath, so a complete order is assembled in sequence without a hand touching it.
 * The channels are the whole visual signature, so they are modelled individually — roughly 90 a
 * side, instanced, with their pack stacks in a range of carton colours because a real machine is
 * loaded with hundreds of different products.
 */
function aFrame(ctx: MachineContext): MachineResult {
  const { span, place, theta, a0 } = ctx;
  const objects: THREE.Object3D[] = [];
  const animated: { mesh: THREE.InstancedMesh; kind: string }[] = [];

  const machineL = span * 0.8;
  const bankH = 2.4;
  const slope = 0.34; // radians of lean off vertical - the angle that makes the A
  const channelPitch = 0.16;
  const channels = Math.max(8, Math.floor(machineL / channelPitch));
  let stations = 0;

  /*
   * ⚠️ THE WHOLE MACHINE HANGS OFF ONE PIVOT, AND THAT IS A FIX FOR A LEAN THAT POINTED THE WRONG
   * WAY. The previous version set `rotation.set(0, -theta, side * slope)` on each bank. With the
   * default XYZ Euler order that composes as yaw-after-roll about the bank's own Z — which is the
   * ACROSS axis — so the lean tipped the 15 m bank end-over-end down the hall like a seesaw
   * instead of leaning it inward over the belt. Two grey wedges hid it; ninety ribbed channels do
   * not.
   *
   * Nesting a yaw group and rolling its children about their own X removes the Euler-order
   * question entirely: inside the pivot, x runs along the process, z across it, y up, and a
   * rotation about x is unambiguously the inward lean.
   */
  const pivot = new THREE.Group();
  pivot.position.copy(place(a0, 0, 0));
  pivot.rotation.y = -theta;
  pivot.name = 'aframe';
  objects.push(pivot);

  for (const side of [-1, 1]) {
    const bank = new THREE.Group();
    bank.position.set(0, 1.6, side * 1.25);
    bank.rotation.x = -side * slope;
    bank.name = `aframe-bank-${side > 0 ? 'right' : 'left'}`;

    // backing plate the channels sit on
    const back = new THREE.Mesh(new THREE.BoxGeometry(machineL, bankH, 0.12), housing());
    back.position.set(0, 0, side * 0.42);
    bank.add(back);

    // the channel dividers - the ribs that make an A-frame recognisable
    const divider = new THREE.InstancedMesh(
      new THREE.BoxGeometry(0.03, bankH * 0.92, 0.8),
      housing(),
      channels + 1
    );
    // the product stack sitting in each channel
    const stack = new THREE.InstancedMesh(
      new THREE.BoxGeometry(channelPitch * 0.66, bankH * 0.74, 0.34),
      new THREE.MeshStandardMaterial({ roughness: 0.72 }),
      channels
    );
    const m = new THREE.Matrix4();
    const q = new THREE.Quaternion();
    const one = new THREE.Vector3(1, 1, 1);
    const colour = new THREE.Color();

    for (let i = 0; i <= channels; i += 1) {
      const x = -machineL / 2 + i * channelPitch;
      m.compose(new THREE.Vector3(x, 0, 0), q, one);
      divider.setMatrixAt(i, m);
    }
    for (let i = 0; i < channels; i += 1) {
      const x = -machineL / 2 + (i + 0.5) * channelPitch;
      // Channels are not all full: a machine mid-shift has gaps waiting for replenishment.
      const loaded = (i * 7 + (side + 1) * 3) % 13 !== 0;
      m.compose(new THREE.Vector3(x, loaded ? -bankH * 0.06 : -60, -side * 0.06), q, one);
      stack.setMatrixAt(i, m);
      stack.setColorAt(i, colour.setHex(PACK_COLOURS[(i * 3 + (side + 1)) % PACK_COLOURS.length]));
    }
    divider.instanceMatrix.needsUpdate = true;
    stack.instanceMatrix.needsUpdate = true;
    if (stack.instanceColor) stack.instanceColor.needsUpdate = true;
    bank.add(divider, stack);
    stations += channels;

    // the ejector rail along the foot of the bank, where packs are kicked out
    const ejectors = new THREE.Mesh(new THREE.BoxGeometry(machineL, 0.18, 0.3), darkSteel());
    ejectors.position.set(0, -bankH / 2 + 0.05, -side * 0.2);
    bank.add(ejectors);

    // end frames
    for (const end of [-1, 1]) {
      const frame = new THREE.Mesh(new THREE.BoxGeometry(0.14, bankH + 0.3, 1.0), steel());
      frame.position.set((end * machineL) / 2, 0, side * 0.2);
      bank.add(frame);
    }

    pivot.add(bank);
  }

  // the apex spine that ties the two banks together at the top
  const apex = new THREE.Mesh(new THREE.BoxGeometry(machineL, 0.16, 0.5), steel());
  apex.position.set(0, 3.0, 0);
  pivot.add(apex);

  // the dispensing belt down the middle, with side guides
  const beltMesh = new THREE.Mesh(new THREE.BoxGeometry(machineL * 1.06, 0.18, 0.9), belt());
  beltMesh.position.set(0, 0.95, 0);
  pivot.add(beltMesh);
  for (const side of [-1, 1]) {
    const guide = new THREE.Mesh(new THREE.BoxGeometry(machineL * 1.06, 0.22, 0.06), steel());
    guide.position.set(0, 1.14, side * 0.5);
    pivot.add(guide);
  }
  // drive rollers at each end
  for (const end of [-1, 1]) {
    const roller = new THREE.Mesh(new THREE.CylinderGeometry(0.16, 0.16, 1.0, 12), darkSteel());
    roller.position.set((end * machineL * 1.06) / 2, 0.95, 0);
    roller.rotation.z = Math.PI / 2;
    pivot.add(roller);
    stations += 1;
  }

  // legs under the belt
  for (let i = 0; i < 6; i += 1) {
    const x = -machineL / 2 + (machineL * (i + 0.5)) / 6;
    for (const side of [-1, 1]) {
      const leg = new THREE.Mesh(new THREE.BoxGeometry(0.1, 0.85, 0.1), steel());
      leg.position.set(x, 0.43, side * 0.42);
      pivot.add(leg);
    }
  }

  // control cabinet and a status beacon: every machine of this size has one, and it is the detail
  // that makes a shape read as equipment rather than as furniture
  const cabinet = new THREE.Mesh(new THREE.BoxGeometry(1.0, 1.9, 0.7), housing());
  cabinet.position.set(-machineL / 2 - 1.1, 0.95, 0);
  pivot.add(cabinet);
  const beacon = new THREE.Mesh(
    new THREE.CylinderGeometry(0.11, 0.11, 0.3, 10),
    new THREE.MeshStandardMaterial({ color: 0x35d07f, emissive: 0x0d6b3f, emissiveIntensity: 1.4, roughness: 0.4 })
  );
  beacon.position.set(-machineL / 2 - 1.1, 2.05, 0);
  pivot.add(beacon);
  stations += 2;

  /*
   * The packs stay OUTSIDE the pivot, as a direct child of the zone. `update()` recomputes their
   * matrices every frame with `place()`, which produces zone-space coordinates; parenting them to
   * the pivot would apply the pivot's yaw and offset a second time and send them off down the hall.
   */
  const PACKS = 40;
  const packs = new THREE.InstancedMesh(
    new THREE.BoxGeometry(0.22, 0.1, 0.16),
    new THREE.MeshStandardMaterial({ color: 0xfbba00, roughness: 0.6, emissive: 0x3a2a00 }),
    PACKS
  );
  const pm = new THREE.Matrix4();
  const pq = new THREE.Quaternion().setFromEuler(new THREE.Euler(0, -theta, 0));
  const one = new THREE.Vector3(1, 1, 1);
  for (let i = 0; i < PACKS; i += 1) {
    pm.compose(place(a0, 0, 1.1), pq, one);
    packs.setMatrixAt(i, pm);
  }
  packs.instanceMatrix.needsUpdate = true;
  packs.userData = { a0, span, kind: 'pack' };
  objects.push(packs);
  animated.push({ mesh: packs, kind: 'pack' });

  return { objects, stations, rackPositions: 0, animated };
}

/**
 * The cold room — 2 to 8 °C, and the zone the whole GDP argument rests on.
 *
 * ⚠️ THE WALLS ARE TRANSLUCENT ON PURPOSE. A cold room is a sealed insulated box, and modelling it
 * as one would be accurate and useless: it would hide the shelving, the totes and the evaporators
 * that are the reason to look at it, leaving a white cube in the middle of an exploded diagram.
 * The room is the point, so the room is shown; the walls are present enough to read as an envelope
 * and thin enough to see through.
 */
function coldRoom(ctx: MachineContext): MachineResult {
  const { span, widthM, place, theta, a0 } = ctx;
  const objects: THREE.Object3D[] = [];
  const roomL = span * 0.86;
  const roomW = widthM * 0.62;
  const roomH = 3.6;
  let stations = 0;

  // shell: four walls with a doorway gap in the downstream end, plus a ceiling
  objects.push(slab(ctx, [roomL, roomH, 0.12], [0, roomW / 2, roomH / 2], chill()));
  objects.push(slab(ctx, [roomL, roomH, 0.12], [0, -roomW / 2, roomH / 2], chill()));
  objects.push(slab(ctx, [0.12, roomH, roomW], [-roomL / 2, 0, roomH / 2], chill()));
  // downstream wall, split around a 2.4 m doorway
  for (const side of [-1, 1]) {
    const panel = (roomW - 2.4) / 2;
    objects.push(
      slab(ctx, [0.12, roomH, panel], [roomL / 2, side * (2.4 + panel) / 2, roomH / 2], chill())
    );
  }
  objects.push(slab(ctx, [roomL, 0.12, roomW], [0, 0, roomH], chill()));
  // the strip-curtain doorway itself
  objects.push(
    slab(ctx, [0.06, roomH * 0.8, 2.4], [roomL / 2, 0, roomH * 0.4], (() => {
      const m = housing();
      m.transparent = true;
      m.opacity = 0.55;
      return m;
    })())
  );
  stations += 6;

  // evaporator units on the ceiling - the giveaway that a room is refrigerated
  for (const side of [-1, 1]) {
    const unit = slab(ctx, [2.2, 0.7, 0.8], [side * roomL * 0.24, 0, roomH - 0.55], housing());
    objects.push(unit);
    for (let f = 0; f < 2; f += 1) {
      const fan = new THREE.Mesh(new THREE.CylinderGeometry(0.24, 0.24, 0.1, 12), darkSteel());
      fan.position.copy(place(a0 + side * roomL * 0.24 + (f - 0.5) * 1.1, -0.45, roomH - 0.55));
      fan.rotation.set(Math.PI / 2, 0, -theta);
      objects.push(fan);
    }
    stations += 1;
  }

  // shelving inside, holding totes rather than pallets: cold stock moves in small quantities
  const rows = 2;
  const bays = Math.max(3, Math.floor(roomL / 1.5));
  const shelves = grid(ctx, new THREE.BoxGeometry(1.35, 0.08, 0.75), steel(), rows * 3, bays, 0.6, 0.34);
  objects.push(shelves.mesh);
  const totes = grid(ctx, new THREE.BoxGeometry(0.55, 0.3, 0.38), tote(), rows * 3, bays, 0.82, 0.34);
  objects.push(totes.mesh);
  stations += shelves.count;

  // a temperature display on the outside wall
  const display = slab(ctx, [0.08, 0.4, 0.7], [roomL / 2 + 0.1, 1.6, 2.2], (() => {
    const m = new THREE.MeshStandardMaterial({ color: 0x0d2f3a, roughness: 0.4 });
    m.emissive = new THREE.Color(0x1e8fb0);
    m.emissiveIntensity = 1.2;
    return m;
  })());
  objects.push(display);
  stations += 1;

  return { objects, stations, rackPositions: 0, animated: [] };
}

/**
 * The narcotics safe. The smallest zone in the hall and the most regulated square metres in it —
 * so it is modelled as what it is: a steel cage inside the building, not a room.
 */
function secureCage(ctx: MachineContext): MachineResult {
  const { span, widthM, place, theta, a0 } = ctx;
  const objects: THREE.Object3D[] = [];
  const cageL = Math.min(span * 0.8, 4.2);
  const cageW = Math.min(widthM * 0.4, 9);
  const cageH = 3.0;

  // vertical bars on all four sides - instanced, because the density is what says "secure"
  const pitch = 0.22;
  const alongBars = Math.floor(cageL / pitch);
  const acrossBars = Math.floor(cageW / pitch);
  const total = alongBars * 2 + acrossBars * 2;
  const bars = new THREE.InstancedMesh(new THREE.BoxGeometry(0.04, cageH, 0.04), steel(), total);
  const m = new THREE.Matrix4();
  const q = new THREE.Quaternion().setFromEuler(new THREE.Euler(0, -theta, 0));
  const one = new THREE.Vector3(1, 1, 1);
  let i = 0;
  for (let s = 0; s < alongBars; s += 1) {
    const a = a0 - cageL / 2 + (s + 0.5) * pitch;
    for (const side of [-1, 1]) {
      m.compose(place(a, (side * cageW) / 2, cageH / 2), q, one);
      bars.setMatrixAt(i, m);
      i += 1;
    }
  }
  for (let s = 0; s < acrossBars; s += 1) {
    const c = -cageW / 2 + (s + 0.5) * pitch;
    for (const end of [-1, 1]) {
      m.compose(place(a0 + (end * cageL) / 2, c, cageH / 2), q, one);
      bars.setMatrixAt(i, m);
      i += 1;
    }
  }
  bars.count = i;
  bars.instanceMatrix.needsUpdate = true;
  objects.push(bars);

  // top and bottom rails
  for (const y of [0.06, cageH]) {
    objects.push(slab(ctx, [cageL, 0.1, cageW], [0, 0, y], darkSteel()));
  }
  // the steel door, and a red status lamp above it
  objects.push(slab(ctx, [0.1, 2.1, 1.1], [cageL / 2, 0, 1.05], darkSteel()));
  const lamp = new THREE.Mesh(new THREE.SphereGeometry(0.12, 10, 8), alarmRed());
  lamp.position.copy(place(a0 + cageL / 2, 0, 2.5));
  objects.push(lamp);

  // a small amount of shelving inside: narcotics move in tiny volumes
  const shelves = grid(ctx, new THREE.BoxGeometry(1.1, 0.07, 0.5), steel(), 4, 2, 1.1, 0.24);
  objects.push(shelves.mesh);

  return { objects, stations: i + shelves.count + 2, rackPositions: 0, animated: [] };
}

/**
 * Consolidation: totes from every zone merged into one delivery per pharmacy. Modelled as a
 * sorter — a raised belt with angled chutes feeding collection positions on both sides, which is
 * what "merge" physically looks like and what makes the zone read as a junction rather than a room.
 */
function sorter(ctx: MachineContext): MachineResult {
  const { span, widthM, place, theta, a0 } = ctx;
  const objects: THREE.Object3D[] = [];
  const runL = span * 0.86;
  const stationsPerSide = Math.max(3, Math.floor(runL / 2.4));

  // the sorter belt down the middle, raised so the chutes can fall away from it
  objects.push(slab(ctx, [runL, 0.2, 1.1], [0, 0, 2.1], belt()));
  for (const side of [-1, 1]) {
    objects.push(slab(ctx, [runL, 0.26, 0.07], [0, side * 0.6, 2.32], steel()));
  }
  // support legs
  for (let i = 0; i < 5; i += 1) {
    const a = a0 - runL / 2 + (runL * (i + 0.5)) / 5;
    for (const side of [-1, 1]) {
      const leg = new THREE.Mesh(new THREE.BoxGeometry(0.12, 2.0, 0.12), steel());
      leg.position.copy(place(a, side * 0.5, 1.0));
      leg.rotation.y = -theta;
      objects.push(leg);
    }
  }

  // the chutes: angled planes dropping from the belt to a collection position each side
  //
  // The chute length and both offsets are derived from the hall width rather than fixed, so the
  // belt edge, the chute and the cage it feeds stay in contact. Hard-coded offsets happened to fit
  // this 30.8 m hall and would have left chutes ending in mid-air in a narrower one.
  const chuteLen = Math.min(2.6, widthM * 0.09);
  const chuteOffset = 0.6 + chuteLen / 2;
  const cageOffset = 0.6 + chuteLen + 0.35;
  const chuteGeom = new THREE.BoxGeometry(0.9, 0.08, chuteLen);
  const chutes = new THREE.InstancedMesh(chuteGeom, steel(), stationsPerSide * 2);
  const cages = new THREE.InstancedMesh(new THREE.BoxGeometry(0.85, 0.95, 0.7), tote(), stationsPerSide * 2);
  const m = new THREE.Matrix4();
  const one = new THREE.Vector3(1, 1, 1);
  let i = 0;
  for (let s = 0; s < stationsPerSide; s += 1) {
    const a = a0 - runL / 2 + (runL * (s + 0.5)) / stationsPerSide;
    for (const side of [-1, 1]) {
      const tilt = new THREE.Quaternion().setFromEuler(new THREE.Euler(side * 0.42, -theta, 0));
      m.compose(place(a, side * chuteOffset, 1.55), tilt, one);
      chutes.setMatrixAt(i, m);
      const upright = new THREE.Quaternion().setFromEuler(new THREE.Euler(0, -theta, 0));
      m.compose(place(a, side * cageOffset, 0.48), upright, one);
      cages.setMatrixAt(i, m);
      i += 1;
    }
  }
  chutes.instanceMatrix.needsUpdate = true;
  cages.instanceMatrix.needsUpdate = true;
  objects.push(chutes, cages);

  return { objects, stations: i, rackPositions: 0, animated: [] };
}

/**
 * Staging: sorted by tour, in load sequence, last drop loaded first. Roll cages parked in marked
 * lanes — one lane per tour — because that is the physical form the load sequence takes.
 */
function stagingLanes(ctx: MachineContext): MachineResult {
  const { span, widthM, place, theta, a0 } = ctx;
  const objects: THREE.Object3D[] = [];
  const lanes = 6;
  const perLane = Math.max(2, Math.floor((span * 0.8) / 1.0));

  // painted lane markings on the floor
  for (let l = 0; l < lanes; l += 1) {
    const c = ((l + 0.5) / lanes - 0.5) * widthM * 0.8;
    objects.push(slab(ctx, [span * 0.84, 0.03, 0.1], [0, c - widthM * 0.8 / lanes / 2, 0.5], warnPaint()));
  }

  // the roll cages themselves: a body, a base and a top rail, instanced across the lanes
  const total = lanes * perLane;
  const bodies = new THREE.InstancedMesh(new THREE.BoxGeometry(0.78, 1.5, 0.68), darkSteel(), total);
  const bases = new THREE.InstancedMesh(new THREE.BoxGeometry(0.84, 0.1, 0.72), steel(), total);
  const loads = new THREE.InstancedMesh(new THREE.BoxGeometry(0.62, 0.32, 0.44), tote(), total);
  const m = new THREE.Matrix4();
  const q = new THREE.Quaternion().setFromEuler(new THREE.Euler(0, -theta, 0));
  const one = new THREE.Vector3(1, 1, 1);
  let i = 0;
  for (let l = 0; l < lanes; l += 1) {
    const c = ((l + 0.5) / lanes - 0.5) * widthM * 0.8;
    // Lanes fill unevenly - a staging area where every lane is equally full is a diagram.
    const filled = perLane - ((l * 3) % 3);
    for (let k = 0; k < perLane; k += 1) {
      const a = a0 - span * 0.4 + (span * 0.8 * (k + 0.5)) / perLane;
      const present = k < filled;
      m.compose(place(a, c, present ? 0.9 : -60), q, one);
      bodies.setMatrixAt(i, m);
      m.compose(place(a, c, present ? 0.14 : -60), q, one);
      bases.setMatrixAt(i, m);
      m.compose(place(a, c, present ? 1.78 : -60), q, one);
      loads.setMatrixAt(i, m);
      i += 1;
    }
  }
  bodies.instanceMatrix.needsUpdate = true;
  bases.instanceMatrix.needsUpdate = true;
  loads.instanceMatrix.needsUpdate = true;
  objects.push(bodies, bases, loads);

  return { objects, stations: total, rackPositions: 0, animated: [] };
}

/**
 * Goods-in: pallets from pre-wholesalers and manufacturers, still shrink-wrapped, waiting to be
 * booked in. No order lines are picked here, so there is no racking — which is precisely why the
 * zone looked empty before.
 */
function inbound(ctx: MachineContext): MachineResult {
  const { span, widthM, place, theta, a0 } = ctx;
  const objects: THREE.Object3D[] = [];
  const rows = 3;
  const bays = Math.max(3, Math.floor(span / 1.6));

  const pallets = grid(ctx, new THREE.BoxGeometry(1.2, 0.14, 0.8), carton(), rows, bays, 0.13, 0.72);
  objects.push(pallets.mesh);

  // shrink-wrapped loads of varying height: incoming stock is not uniform
  const total = rows * bays;
  const loads = new THREE.InstancedMesh(new THREE.BoxGeometry(1.12, 1.0, 0.76), wrapped(), total);
  const m = new THREE.Matrix4();
  const q = new THREE.Quaternion().setFromEuler(new THREE.Euler(0, -theta, 0));
  let i = 0;
  for (let r = 0; r < rows; r += 1) {
    const c = ((r + 0.5) / rows - 0.5) * widthM * 0.72;
    for (let b = 0; b < bays; b += 1) {
      const a = a0 + ((b + 0.5) / bays - 0.5) * span * 0.82;
      const h = 0.55 + (((r * 5 + b * 3) % 4) / 4) * 1.1;
      m.compose(place(a, c, 0.2 + h / 2), q, new THREE.Vector3(1, h, 1));
      loads.setMatrixAt(i, m);
      i += 1;
    }
  }
  loads.instanceMatrix.needsUpdate = true;
  objects.push(loads);

  // a receiving bench with a terminal, and a hand pallet truck
  objects.push(slab(ctx, [2.0, 0.08, 0.8], [span * 0.3, widthM * 0.36, 0.92], steel()));
  objects.push(slab(ctx, [0.5, 0.42, 0.06], [span * 0.3, widthM * 0.36, 1.25], darkSteel()));
  objects.push(slab(ctx, [1.5, 0.12, 0.5], [-span * 0.3, -widthM * 0.36, 0.1], warnPaint()));
  objects.push(slab(ctx, [0.1, 1.1, 0.5], [-span * 0.3 - 0.7, -widthM * 0.36, 0.6], warnPaint()));

  return { objects, stations: pallets.count + 4, rackPositions: 0, animated: [] };
}

/** Manual pick: racking, plus the trolleys and pick-by-light strips that make it manual. */
function manualPick(ctx: MachineContext, rows: number): MachineResult {
  const racking = palletRacking(ctx, rows);
  const { span, widthM, place, theta, a0 } = ctx;
  const objects = [...racking.objects];

  // pick-by-light strips on the face of the lowest level: small, emissive, and the single detail
  // that says a human is being directed rather than reading a list
  const bays = Math.max(2, Math.floor(span / 1.4));
  const lights = new THREE.InstancedMesh(
    new THREE.BoxGeometry(1.1, 0.06, 0.04),
    new THREE.MeshStandardMaterial({ color: 0xffc24a, emissive: 0xff9a00, emissiveIntensity: 1.5, roughness: 0.4 }),
    rows * bays
  );
  const m = new THREE.Matrix4();
  const q = new THREE.Quaternion().setFromEuler(new THREE.Euler(0, -theta, 0));
  const one = new THREE.Vector3(1, 1, 1);
  let i = 0;
  for (let r = 0; r < rows; r += 1) {
    const c = ((r + 0.5) / rows - 0.5) * widthM * 0.82 + 0.5;
    for (let b = 0; b < bays; b += 1) {
      const a = a0 + ((b + 0.5) / bays - 0.5) * span * 0.88;
      m.compose(place(a, c, 1.72), q, one);
      lights.setMatrixAt(i, m);
      i += 1;
    }
  }
  lights.instanceMatrix.needsUpdate = true;
  objects.push(lights);

  // pick trolleys in the aisles
  const trolleys = grid(ctx, new THREE.BoxGeometry(1.2, 0.9, 0.6), darkSteel(), Math.max(2, rows - 1), 3, 0.55, 0.6);
  objects.push(trolleys.mesh);

  return {
    objects,
    stations: racking.stations + i + trolleys.count,
    rackPositions: racking.rackPositions,
    animated: [],
  };
}

/** The docks: doors, levellers and bumpers. Where the twin stops being a building. */
function dockFront(ctx: MachineContext): MachineResult {
  const { span, widthM, place, theta, a0 } = ctx;
  const objects: THREE.Object3D[] = [];
  const doors = 5;
  const doorW = (widthM / doors) * 0.6;

  const doorMaterial = new THREE.MeshStandardMaterial({ color: 0x0d6b53, roughness: 0.7 });
  for (let i = 0; i < doors; i += 1) {
    const c = ((i + 0.5) / doors - 0.5) * widthM * 0.85;
    // the roller door itself
    const door = new THREE.Mesh(new THREE.BoxGeometry(0.4, 4.2, doorW), doorMaterial);
    door.position.copy(place(a0 + span * 0.45, c, 2.2));
    door.rotation.y = -theta;
    objects.push(door);
    // the dock leveller plate on the floor in front of it
    const leveller = new THREE.Mesh(new THREE.BoxGeometry(1.8, 0.12, doorW * 0.9), steel());
    leveller.position.copy(place(a0 + span * 0.45 - 1.2, c, 0.5));
    leveller.rotation.y = -theta;
    objects.push(leveller);
    // rubber bumpers either side
    for (const side of [-1, 1]) {
      const bumper = new THREE.Mesh(new THREE.BoxGeometry(0.25, 0.5, 0.2), belt());
      bumper.position.copy(place(a0 + span * 0.45, c + (side * doorW) / 2, 1.0));
      bumper.rotation.y = -theta;
      objects.push(bumper);
    }
    // a number plate over each door
    const plate = new THREE.Mesh(new THREE.BoxGeometry(0.08, 0.4, 0.5), warnPaint());
    plate.position.copy(place(a0 + span * 0.45 - 0.25, c, 4.7));
    plate.rotation.y = -theta;
    objects.push(plate);
  }

  return { objects, stations: doors * 5, rackPositions: 0, animated: [] };
}

export function buildZoneMachines(zone: DcZone, ctx: MachineContext): MachineResult {
  switch (zone.kind) {
    case 'inbound':
      return inbound(ctx);
    case 'storage':
      return palletRacking(ctx, Math.max(1, zone.rackRows));
    case 'automation':
      return aFrame(ctx);
    case 'pick':
      return manualPick(ctx, Math.max(1, zone.rackRows));
    case 'coldchain':
      return coldRoom(ctx);
    case 'secure':
      return secureCage(ctx);
    case 'merge':
      return sorter(ctx);
    case 'buffer':
      return stagingLanes(ctx);
    case 'outbound':
      return dockFront(ctx);
    default:
      // An unknown kind falls back to racking if the zone declares rows, and to nothing if it does
      // not. Silently drawing a warehouse in a zone the generator has not classified would be a
      // worse answer than an empty one.
      return zone.rackRows > 0
        ? palletRacking(ctx, zone.rackRows)
        : { objects: [], stations: 0, rackPositions: 0, animated: [] };
  }
}

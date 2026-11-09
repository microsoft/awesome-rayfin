import * as THREE from 'three';

/**
 * The cinematic night: one spotlit site, a sleeping region, and a city the tours uncover.
 *
 * ⚠️ THIS EXISTS BECAUSE SCALING THE SUN TINT IS NOT NIGHT. The first night pass darkened the sun
 * and shadow tints on the terrain and the shell, and the buildings kept their daylight tints
 * because nobody had wired them — so a "fully dark" scene rendered five and a half thousand
 * brightly lit LoD2 blocks. Every night check passed: `nightFactor` was 1.00, the sky was black,
 * the ground was dim. The subject of the picture was untouched.
 *
 * So the grade is applied HERE, as one shared step at the very end of every shading path, rather
 * than as four independent edits that can drift apart. Anything that shades and does not call
 * `NIGHT_GLSL` is, by construction, a surface that will not go dark.
 *
 * Three effects, in the order the eye reads them:
 *
 * 1. **The site stays awake.** A warm additive pool of light around the distribution centre. In
 *    pharmaceutical wholesale the night IS the shift — this is the only part of the region with
 *    its floodlights on, and that contrast is the whole point of the picture.
 * 2. **The region sleeps.** Everything outside the pool falls to a moonlit floor.
 * 3. **The tours uncover the city.** What the vans have not yet reached sits under fog. As the
 *    wave drives outward the fog retreats ahead of it. The radius is not a timer — it is the
 *    distance of the furthest van actually on the road, so the reveal cannot disagree with the
 *    vehicles you can see driving.
 */

/**
 * The floodlight colour.
 *
 * ⚠️ NEUTRAL, NOT SODIUM. This was #ffc773 — the orange of an old low-pressure sodium lamp — and
 * over a whole distribution centre it read as a fire rather than as a working site. Modern yard
 * and dock lighting is LED at four to five thousand kelvin: near-white with only a trace of warmth.
 * Keeping a little warmth stops it looking like a moonlit blue-grey; taking the orange out is what
 * makes it look like somewhere people are working.
 */
const SPOT_COLOUR = new THREE.Color('#fff6ec');

/** What the unreached city sits under. Near-black, faintly blue — not fully opaque black. */
const NIGHT_FOG = new THREE.Color('#060a12');

/**
 * How wide the edge of the reveal is, in metres.
 *
 * Exported because the map LABELS have to respect the same edge: they are DOM, the fog is a
 * shader, and nothing connects the two unless it is shared explicitly.
 */
export const REVEAL_SOFT_M = 2600;

/**
 * GLSL shared by every material that shades.
 *
 * ⚠️ CALL IT LAST, AFTER THE HAZE. In `terrainMaterial` the order is `colour *= uDim` and only
 * then `mix(colour, uHazeColour, haze)`, so distance fog re-lit whatever the dim had darkened and
 * the far half of the picture stayed bright however hard the dim was pushed. Anything applied
 * before the haze gets partly undone by it.
 */
export const NIGHT_GLSL = /* glsl */ `
uniform float uNight;
uniform float uNightFloor;
uniform float uSpotLevel;
uniform vec2  uSpotCentre;
uniform vec2  uSpotCentres[4];
uniform int   uSpotCount;
uniform vec2  uSpotRange;
uniform vec3  uSpotColour;
uniform float uSpotGain;
uniform vec2  uHeadlamp;
uniform vec2  uHeadlampRange;
uniform float uHeadlampGain;
uniform float uReveal;
uniform float uRevealSoft;
uniform vec3  uNightFog;

vec3 nightGrade(vec3 colour, vec3 world) {
  if (uNight <= 0.001) return colour;

  // Distance to the WAREHOUSE, which is what the reveal and the hub fade are measured from.
  float d = distance(world.xz, uSpotCentre);

  // ⚠️ THE LIT AREA IS THE SITE, NOT A CIRCLE AROUND IT. One big pool centred on the warehouse
  // also lit the neighbouring industrial units, the rail sidings and half of the industrial belt — so
  // "the site is bright and the rest is asleep" was not what the picture actually said.
  // The complex is four separate buildings spread over about 400 m, so the light is four
  // tighter pools that follow them. Their union has the shape of the site; a circle never can.
  float lit = 0.0;
  for (int i = 0; i < 4; i++) {
    if (i >= uSpotCount) break;
    float s = 1.0 - smoothstep(uSpotRange.x, uSpotRange.y, distance(world.xz, uSpotCentres[i]));
    lit = max(lit, s);
  }
  // Squared, so each pool has a bright core and a soft edge instead of a flat disc.
  lit *= lit;

  // ⚠️ AND THE VAN YOU ARE RIDING WITH CARRIES ITS OWN LIGHT. Without this the ride-along — the
  // one interaction that puts the camera fifty metres from a vehicle — is a black rectangle with a
  // coloured speck in it, because the story happens at 04:00 on a street the site floodlights do
  // not reach and the tours have not yet uncovered. Real headlights throw about eighty metres, and
  // a pool that moves with the vehicle is the difference between watching a van work and watching
  // an unlit field. Zero gain when nobody is being followed, so it costs nothing the rest of the
  // time.
  float lamp = 1.0 - smoothstep(uHeadlampRange.x, uHeadlampRange.y, distance(world.xz, uHeadlamp));
  lit = max(lit, lamp * lamp * uHeadlampGain);

  // 1. How much light each surface keeps: the site stays near its daylight level, the region
  //    around it falls away to a moonlit floor. ONE writer for darkness, shared by every surface.
  //
  //    ⚠️ THE SITE'S BRIGHTNESS IS MULTIPLICATIVE NOW, AND THAT IS THE WHOLE DIFFERENCE. The
  //    first version crushed EVERYTHING to the floor and then added a coloured glow back over the
  //    site. Adding light to a surface already reduced to 15 % cannot recover what was lost — it
  //    only tints it — so the yard came out as a flat orange wash with the roof colours, the yard
  //    markings and the vehicles underneath all smeared into one hue. Letting the lit area KEEP
  //    its light preserves the measured roof colours and the 20 cm orthophoto, which is the whole
  //    reason the site is worth looking at up close.
  colour *= mix(1.0, mix(uNightFloor, uSpotLevel, lit), uNight);

  // 2. A modest bloom on top, so the pools read as lamps rather than as holes in the night.
  //    Small, now that it is no longer doing the work of brightening.
  colour += uNight * lit * uSpotColour * uSpotGain;

  // 3. The fog the tours pull back. Daylight reveals everything regardless, so the term only
  //    bites at night and dawn dissolves it without any separate animation.
  float reached = 1.0 - smoothstep(uReveal, uReveal + uRevealSoft, d);
  float revealed = clamp(max(reached, 1.0 - uNight), 0.0, 1.0);
  colour = mix(uNightFog, colour, revealed);

  return colour;
}
`;

/** The uniforms `NIGHT_GLSL` needs. One object per material — three.js does not share by default. */
export function nightUniforms(): Record<string, THREE.IUniform> {
  return {
    uNight: { value: 0 },
    // ⚠️ THE SLEEPING REGION IS MUCH DARKER THAN IT WAS. At 0,15 the surrounding streets were
    // still legible enough to compete with the site for attention, which is the opposite of the
    // point: at 04:00 the only thing awake should be the one place that is actually working.
    uNightFloor: { value: 0.05 },
    // How much of its daylight brightness the floodlit site keeps. Near enough to 1 that roof
    // colours, yard markings and vehicles stay readable.
    //
    // ⚠️ PLUS THE BLOOM, THIS MUST STAY UNDER DAYLIGHT. At 0,92 with a 0,16 bloom the site measured
    // 169 against 142 at noon — the yard was brighter at three in the morning than at midday, which
    // is not a look, it is an error, and it flattens exactly the roof detail the brightness was
    // meant to reveal. The pair is now tuned so a floodlit night lands just below a lit day.
    uSpotLevel: { value: 0.8 },
    uSpotCentre: { value: new THREE.Vector2(0, 0) },
    // Up to four lit buildings. Fixed length because GLSL ES wants a constant bound; the count
    // says how many are real.
    uSpotCentres: {
      value: [
        new THREE.Vector2(0, 0),
        new THREE.Vector2(0, 0),
        new THREE.Vector2(0, 0),
        new THREE.Vector2(0, 0),
      ],
    },
    uSpotCount: { value: 1 },
    // ⚠️ TIGHT, BECAUSE THERE ARE NOW SEVERAL. Sized to a BUILDING rather than to the whole site:
    // the union of four of these has the shape of the complex, where one 560 m pool centred on the
    // warehouse also lit every neighbour it happened to sit near.
    uSpotRange: { value: new THREE.Vector2(70, 260) },
    uSpotColour: { value: new THREE.Vector3(SPOT_COLOUR.r, SPOT_COLOUR.g, SPOT_COLOUR.b) },
    uSpotGain: { value: 0.1 },
    uHeadlamp: { value: new THREE.Vector2(0, 0) },
    // A van's dipped beam reaches roughly this far. Inner is the pool right in front of the
    // vehicle, outer is where it fades into the night.
    uHeadlampRange: { value: new THREE.Vector2(22, 95) },
    uHeadlampGain: { value: 0 },
    uReveal: { value: 0 },
    uRevealSoft: { value: REVEAL_SOFT_M },
    uNightFog: { value: new THREE.Vector3(NIGHT_FOG.r, NIGHT_FOG.g, NIGHT_FOG.b) },
  };
}

/**
 * Move the headlamp pool. Called every frame while a van is being followed, so it is deliberately
 * a separate, tiny write rather than a full `applyNightState` — that one walks every material and
 * recomputes the whole night, which is not something to do sixty times a second.
 */
export function setHeadlamp(
  materials: (THREE.ShaderMaterial | null | undefined)[],
  lamp: { x: number; z: number; gain: number } | null
): void {
  for (const material of materials) {
    const u = material?.uniforms;
    if (!u?.uHeadlampGain) continue;
    if (lamp) {
      u.uHeadlamp.value.set(lamp.x, lamp.z);
      u.uHeadlampGain.value = lamp.gain;
    } else {
      u.uHeadlampGain.value = 0;
    }
  }
}

export interface NightState {
  /** 0 by day, 1 in the deep of the night. */
  night: number;
  /** World x/z of the warehouse. The reveal and the hub fade are measured from here. */
  centre: { x: number; z: number };
  /**
   * The buildings that stay lit through the night — the operator's complex, not a circle around it.
   * Up to four; anything beyond that is ignored rather than silently averaged into one.
   */
  litPlaces?: { x: number; z: number }[];
  /** How far the tours have reached from the site, in metres. */
  reveal: number;
}

/**
 * Push the night state into every material that shades.
 *
 * ⚠️ SILENTLY SKIPPING A MATERIAL IS THE FAILURE MODE THIS WHOLE FILE EXISTS FOR, so a material
 * that lacks the uniforms is a caller error rather than something to shrug at: it means a surface
 * is about to stay lit through the night. Reported rather than ignored.
 */
export function applyNightState(
  materials: (THREE.ShaderMaterial | null | undefined)[],
  state: NightState
): { applied: number; skipped: number } {
  let applied = 0;
  let skipped = 0;
  for (const material of materials) {
    const u = material?.uniforms;
    if (!u || !u.uNight) {
      if (material) skipped += 1;
      continue;
    }
    u.uNight.value = state.night;
    u.uSpotCentre.value.set(state.centre.x, state.centre.z);
    const places = state.litPlaces?.length ? state.litPlaces : [state.centre];
    const count = Math.min(places.length, 4);
    for (let i = 0; i < count; i += 1) {
      u.uSpotCentres.value[i].set(places[i].x, places[i].z);
    }
    u.uSpotCount.value = count;
    u.uReveal.value = state.reveal;
    applied += 1;
  }
  return { applied, skipped };
}

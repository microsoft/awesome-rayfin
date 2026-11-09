import { describe, expect, it } from 'vitest';

import { WALL_COLOURS } from '@/twin3d/buildings';

/**
 * The wall palette — one colour per class from `tools/geodata/building_class.py`.
 *
 * ⚠️ THE PIPELINE WRITES AN INTEGER AND THE CLIENT INDEXES AN ARRAY WITH IT, which is exactly the
 * kind of join that breaks silently: adding a class in Python and forgetting the colour here does
 * not throw, it paints the new class as `render` and looks plausible. The count is asserted so the
 * two have to be changed together.
 */
describe('building wall palette', () => {
  it('has a colour for every class the pipeline can emit', () => {
    // render, utility, whitewash, civic, concrete — see building_class.py.
    expect(WALL_COLOURS).toHaveLength(5);
    for (const colour of WALL_COLOURS) {
      expect(colour).toHaveLength(3);
      for (const channel of colour) {
        expect(channel).toBeGreaterThanOrEqual(0);
        expect(channel).toBeLessThanOrEqual(255);
      }
    }
  });

  it('keeps the classes distinguishable from one another', () => {
    // Two classes that render within a few units of each other are not two classes. This caught
    // nothing yet; it exists so that tuning one colour cannot quietly collapse it into its
    // neighbour, which is invisible in a screenshot of a whole city.
    for (let i = 0; i < WALL_COLOURS.length; i += 1) {
      for (let j = i + 1; j < WALL_COLOURS.length; j += 1) {
        const distance = Math.hypot(
          WALL_COLOURS[i][0] - WALL_COLOURS[j][0],
          WALL_COLOURS[i][1] - WALL_COLOURS[j][1],
          WALL_COLOURS[i][2] - WALL_COLOURS[j][2]
        );
        expect(distance, `classes ${i} and ${j} are the same colour`).toBeGreaterThan(12);
      }
    }
  });

  it('paints utility and concrete as grey rather than as a house colour', () => {
    // The Allgäu version of this palette boarded small low buildings as alpine timber. In two
    // Bavarian cities the same size signature is a garage or a substation, and a warm timber
    // treatment behind the Regierung der Oberpfalz would be a fabrication with a colour attached.
    for (const index of [1, 4]) {
      const [r, , b] = WALL_COLOURS[index];
      expect(Math.abs(r - b), 'a utility wall should be neutral, not warm').toBeLessThan(14);
    }
  });
});

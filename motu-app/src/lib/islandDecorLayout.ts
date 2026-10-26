/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { findRandomValidPlacement, HomeObstacle } from '../utils/placementRules';
import { makeGroundCoverRng } from './groundCoverBuild';

/**
 * Where the island's own wildflowers and rocks stand — as a pure function of the island.
 *
 * ## Seeded, not rolled
 *
 * Every wildflower, rock, stepping-stone facing and garden slab used to come from Math.random()
 * inside a component's useMemo. That is only stable for as long as the memo's inputs keep their
 * identity, and they did not: the Home object was rebuilt on every save snapshot, so every write
 * anywhere in the game (a coin, a step count, the five-minute heartbeat, a furniture move)
 * re-rolled the whole field — flowers and rocks jumping to new places, which is what read as
 * 「一直重新生成、閃爍」. The identity half of that is fixed where the data enters
 * (lib/structuralShare.ts, hooks/usePlayerHome.ts). This is the other half: the layout depends on
 * its real inputs — the island's size and the Home — and on nothing else, so even a legitimate
 * rebuild draws the same island and a reload restores it exactly. Still random-looking; just the
 * same random every time, the way the lawn (lib/groundCoverBuild.ts) already worked.
 *
 * ## One stream per piece
 *
 * Each piece draws from its OWN stream, keyed by its index. With one shared stream, moving the
 * Home would change how many draws the first flower needed and shift every flower after it; with
 * one stream per piece, only the pieces whose own candidates actually hit the Home move. A piece's
 * LOOKS (colour, size, sway) come from a second stream of its own, so how many tries its position
 * took never changes what it looks like.
 *
 * Split out of Three/IslandDecorations.tsx so it can be checked without React
 * (scripts/test-island-decor-stability.ts), the same split GroundCover has with groundCoverBuild.
 */

export const DECOR_SEEDS = {
  flora: 0x464c4f52,
  rock: 0x524f434b,
  path: 0x50415448,
  slab: 0x534c4142,
} as const;

/** Mixed into a piece's seed for its looks. */
const LOOKS_SALT = 0x5bd1e995;

/** The i-th piece's own deterministic stream within a family. */
export function pieceRng(family: number, i: number): () => number {
  return makeGroundCoverRng((family + Math.imul(i + 1, 0x9e3779b1)) >>> 0);
}

function looksRng(family: number, i: number): () => number {
  return pieceRng((family ^ LOOKS_SALT) >>> 0, i);
}

export const FLOWER_COLORS = ['#ef4444', '#f59e0b', '#ec4899', '#8b5cf6', '#3b82f6'];

export interface FloraSeed {
  position: [number, number, number];
  /** How wide it stands, for the "is something placed on top of it" test. */
  radius: number;
  color: string;
  scale: number;
  rotationOffset: number;
  swaySpeed: number;
}

export function layoutFlora(count: number, home: HomeObstacle | null, islandScale: number): FloraSeed[] {
  return Array.from({ length: count }, (_, i) => {
    const position = findRandomValidPlacement('Flower', home, islandScale, [], 0.35, 40, pieceRng(DECOR_SEEDS.flora, i));
    const looks = looksRng(DECOR_SEEDS.flora, i);
    return {
      position,
      // Flowers are small; a stem this close to an outline is already inside the model.
      radius: 0.15,
      color: FLOWER_COLORS[Math.floor(looks() * FLOWER_COLORS.length)],
      scale: 0.3 + looks() * 0.4,
      rotationOffset: looks() * Math.PI,
      swaySpeed: 0.8 + looks() * 1.2,
    };
  });
}

export interface RockSeed {
  position: [number, number, number];
  scale: number;
  /** The dodecahedron's own radius (0.3) at this rock's scale. */
  radius: number;
  rotation: [number, number, number];
  hasWindEffect: boolean;
  swayOffset: number;
  swayFreq: number;
  /**
   * The wind rocks used to accumulate `rotation.y += 0.005` straight onto their Object3D; an
   * instanced rock has no Object3D of its own, so the spin lives here and the renderer advances it.
   */
  spin: number;
}

export function layoutRocks(count: number, home: HomeObstacle | null, islandScale: number): RockSeed[] {
  const coords: [number, number, number][] = [];
  return Array.from({ length: count }, (_, i) => {
    const position = findRandomValidPlacement('IslandRock', home, islandScale, coords, 0.35, 40, pieceRng(DECOR_SEEDS.rock, i));
    coords.push(position);
    const looks = looksRng(DECOR_SEEDS.rock, i);
    const scale = 0.2 + looks() * 0.5;
    return {
      position,
      scale,
      radius: 0.3 * scale,
      rotation: [looks() * Math.PI, looks() * Math.PI, looks() * Math.PI],
      hasWindEffect: looks() > 0.6,
      swayOffset: looks() * Math.PI,
      swayFreq: 0.5 + looks() * 0.5,
      spin: 0,
    };
  });
}

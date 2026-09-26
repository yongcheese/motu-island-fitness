/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * WHAT A LAMP'S LIGHT DOES — one declaration per product, read by one component.
 *
 * ## The problem this closes
 *
 * The house already had a light switch, and it was complete: `lib/interiorLights.ts` holds the
 * whole-house on/off plus the eased `level` every light on screen follows, and the ambient light,
 * the sun, the environment map, the exposure, the per-room ceiling light, the follow light and the
 * candle all read it. Turn the lights off and the room goes dark.
 *
 * Except for the lamps. Every 燈具 model in FurnitureItem.tsx carried its own bare
 * `<pointLight intensity={0.6} …>`, hard-wired on, answering to nothing. So a room with four
 * pendants and a wall sconce in it did not go dark when you flipped the switch — it went *blue*,
 * with five lamps still burning inside it. The switch was not broken; the fixtures were simply not
 * part of the system it drove, and each one was its own private, permanently-on lighting rule.
 *
 * That is the thing to avoid rather than repeat: the fix is emphatically NOT a second on/off
 * system for furniture. It is to make a fixture's light a declared property of the PRODUCT, and to
 * give every fixture one shared component (Three/FixtureLight.tsx) that reads this and the
 * existing `interiorLights.level`. One switch, one fade, one place that knows what "off" means.
 *
 * ## What lives here and what stays in the model
 *
 *   HERE — everything that is a free choice about the light: how bright, how far, what colour, and
 *   whether the fixture is on the house circuit at all. None of it is measurable off the geometry,
 *   so none of it can go stale against the model.
 *
 *   IN THE MODEL — where the bulb is. That IS geometry: it is measured against the shade, the
 *   socket and the arm that hold it, and a copy of it in a table here would be exactly the kind of
 *   hand-typed number that `footprintRadius` and `getCollisionBounds` were both deleted for.
 *
 * So a lamp component says `<FixtureLight item={item} position={[0, -0.9, 0]} />` and nothing else
 * about light. There is no per-lamp light component, and adding a lamp adds one catalog field.
 */

/**
 * Whether the wall switch governs this fixture.
 *
 * The brief's 「請不要假設目前所有燈具一定要完全同步」. Two quite different reasons a fixture stays
 * lit, and it is worth being clear that this field expresses BOTH rather than only the first:
 *
 *   IT HAS NO WIRE. 螢光石燈 is 「無需能源也能恆久發光」, 部落火把 burns 「永不熄滅的靈魂之火」,
 *   復古提燈 is an oil lamp, 竹製手電筒 runs off a battery, 香氛蠟燭 is a lit candle. Switching any
 *   of those off from a wall plate would contradict the product the player bought.
 *
 *   IT IS MEANT TO STAY ON. 溫馨壁掛燈 is on the house wiring like any other sconce and is `always`
 *   anyway, because it is the room's night light: 「照亮黑夜」 is what its own card promises, and a
 *   room that goes completely dark but for the candle in the player's hand gives that promise
 *   nowhere to land. Being the only fixture mounted at eye level on a wall is what makes it the
 *   right one to hold back.
 *
 * That second case is why this is `always` and not `selfPowered`: it says what the switch does,
 * which is the only thing anything reading it needs, and it does not force a design decision to
 * dress itself up as a fact about batteries.
 *
 * - `switched` — follows `interiorLights.level`: fades out with the room, fades back in with it,
 *                and is forced on in build mode along with everything else.
 * - `always`   — burns at full whatever the switch says, which is what makes a room lit only by
 *                torches, glowstones and the sconce on the wall a thing a player can build.
 */
export type LightBehaviour = 'switched' | 'always';

/**
 * A fixture's light, as product data.
 *
 * Present on an item exactly when that item emits light. Absent — which is most of the catalog —
 * means the piece is not a light source, and {@link isLightFixture} is how anything asks.
 */
export interface LightingSpec {
  /** Mains or self-powered. See {@link LightBehaviour}. */
  behaviour: LightBehaviour;
  /**
   * Peak brightness, in three.js `pointLight.intensity`, at `level` 1.
   *
   * Small numbers on purpose. A room already carries an ambient light, a directional light, an
   * environment map and a per-room ceiling light (Three/InteriorLighting.tsx); a fixture is a
   * local accent on top of all four, not the thing that makes the room visible. The values here
   * are the ones each model shipped with, carried over unchanged.
   */
  intensity: number;
  /** How far the light reaches, in world units — three.js `pointLight.distance`. */
  range: number;
  /** Light colour. Warm tungsten for most; the glowstone is the one cold one, and deliberately. */
  color: string;
  /**
   * Falloff exponent. Left alone in almost every case: 2 is physically-correct inverse-square and
   * is what every fixture in the catalog uses. Here so a future fixture that wants a flatter pool
   * of light does not need a second component to get one.
   */
  decay?: number;
}

/** Default {@link LightingSpec.decay} — inverse-square, as every current fixture uses. */
export const DEFAULT_LIGHT_DECAY = 2;

/**
 * Does this item emit light?
 *
 * The one test, asked of the item rather than of its name, its id prefix or its shop shelf. The
 * 燈具 shelf and the light are two different statements about a product and both are real: an item
 * can be on the 燈具 shelf without emitting anything measurable of its own (the three 光色溫
 * swatches are a setting, not an object), and an item can emit light without being sold as a lamp
 * (帳篷風格床's fairy lights, 香氛蠟燭). Deriving either from the other is how eight different
 * lamps once ended up sharing one grey box — see constants/furnitureModels.ts.
 */
export function isLightFixture(item: { lighting?: LightingSpec } | undefined | null): boolean {
  return !!item?.lighting;
}

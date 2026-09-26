/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * SPECIAL COSMETIC EFFECTS — the whole catalog of "飾品會動" as data.
 *
 * ---------------------------------------------------------------------------
 * THE RULE THIS FILE EXISTS TO ENFORCE
 * ---------------------------------------------------------------------------
 *
 * Nothing anywhere in the game may say `if (item === 'star-hairpin')`. A special
 * cosmetic is a ROW in {@link SPECIAL_COSMETICS}: an item id, a socket to hang on, a
 * model key, and an {@link CosmeticEffect} describing how it moves and what (if anything)
 * it emits. Adding the eleventh cosmetic is a row here plus one entry in the model
 * registry (Three/effects/CosmeticModels.tsx) — no new component, no new update loop,
 * no new particle system, and not one line of the runtime learns its name.
 *
 * The runtime that reads these rows is Three/effects/: one pooled particle renderer, one
 * pooled creature renderer, and ONE useFrame that steps every equipped cosmetic on every
 * wearer in the scene.
 *
 * ---------------------------------------------------------------------------
 * THE DESIGN BUDGET (七 of the brief, made numeric)
 * ---------------------------------------------------------------------------
 *
 * These effects run on the player, the pet, and eventually on every NPC in view, so
 * "subtle" is not a matter of taste here — it is the performance budget and the art
 * direction agreeing:
 *
 *   - MOTION FIRST — STILL, but the garnish got bigger. Every cosmetic below has a
 *     {@link MotionSpec}, and sway/bob/spin/breathe are still what make a thing feel alive for
 *     three float writes on a group that already exists.
 *
 *     What changed (the visibility pass) is the RATE, not the principle. The original numbers
 *     were tuned so that an emitter was something you noticed rather than watched, and they
 *     overshot: measured as `count x lifetime / interval`, most ambient emitters sat BELOW ONE
 *     particle alive — the star hairpin at 0.84, the forest crown at 0.45, the pet bow at 0.27.
 *     "Restrained" and "usually nothing there at all" are not the same thing, and the second one
 *     is what shipped. Intervals now land these around 2.5-4 alive.
 *   - `maxAlive` is per-emitter and MANDATORY. An emitter that has reached it simply
 *     skips its next burst, so no cosmetic can ever contribute more than a handful of
 *     particles no matter how long it is worn or how many wearers are on screen.
 *   - Intervals are in SECONDS BETWEEN BURSTS, and after the visibility pass they run 0.75 to
 *     3.8 seconds. The ambient ones were cut hardest (x0.42) because they were the ones with
 *     nothing on screen; the movement-gated trails, which were already at 1.1-1.8, were eased
 *     much less (x0.7) — those were never the problem, and halving them again IS the
 *     particle-vomit the brief is written against. The floor is 0.75s and it should stay.
 *   - Opacity floors at 0.8 (it used to top out there) and sizes run to about 0.09 world
 *     units against a ~2.16 world-unit character, with a FLOOR of ~0.024 — the old set had
 *     particles at 0.014, which is 1.4 cm on a 2.16 m person and is a speck whatever colour it
 *     is. Nothing here is still allowed to occlude a face, and nothing does: the largest solid
 *     particle is under 7 cm and the large ones are rings, which are mostly hole.
 */

import { ALL_ITEMS } from './items';
import type { ParticleShape } from '../components/Three/effects/particleShapes';

// ---------------------------------------------------------------------------
// SERIES
// ---------------------------------------------------------------------------

/**
 * The families a cosmetic can belong to. A series is not decoration: it is the key the
 * player↔pet bond (see {@link SERIES_BONDS}) matches on, so two items are "the same
 * series" exactly when they share this value — never when their names look alike.
 */
export type CosmeticSeries =
  | 'starlight'
  | 'forest'
  | 'flower'
  | 'bubble'
  | 'campfire'
  | 'cloud'
  | 'ocean'
  | 'honey'
  | 'music'
  | 'butterfly'
  | 'frost';

export const SERIES_LABEL: Record<CosmeticSeries, string> = {
  starlight: '星光系列',
  forest: '森林系列',
  flower: '花朵系列',
  bubble: '泡泡系列',
  campfire: '營火系列',
  cloud: '雲朵系列',
  ocean: '海洋系列',
  honey: '蜂蜜系列',
  music: '音樂系列',
  butterfly: '蝴蝶系列',
  frost: '霜雪系列',
};

// ---------------------------------------------------------------------------
// SOCKETS
// ---------------------------------------------------------------------------

/**
 * Where a cosmetic mounts. Player sockets resolve through `CharacterAttachments`
 * (constants/characterRig.ts) and pet sockets through `PET_ATTACHMENTS`
 * (constants/petRig.ts), so a cosmetic states WHICH socket and never WHERE it is — the
 * same split the wardrobe already uses, and the reason a remodelled character or a future
 * second pet does not invalidate this catalog.
 */
export type CosmeticSocket =
  /** Player, head-local: the side of the head just above and in front of the ear. */
  | 'hairPin'
  /** Player, head-local: the hat ring — crowns, wreaths, anything that circles the skull. */
  | 'crown'
  /** Player, torso-local: at the neckline, where a pendant hangs. */
  | 'pendant'
  /** Player, torso-local: the shoulder blades — capes, wings, packs. */
  | 'back'
  /** Player, head-local: floating ABOVE the crown — halos, orbiting rings. */
  | 'halo'
  /** Player, leg-local: anklets. Rendered by BOTH legs, so one row is a pair. */
  | 'ankle'
  /** Player, root-local: on the GROUND under the wearer. See {@link GroundSpec}. */
  | 'aura'
  /** Pet, dog-local: the top of the skull. */
  | 'petHead'
  /** Pet, dog-local: around the neck. */
  | 'petCollar'
  /** Pet, dog-local: on the back, between the shoulders. */
  | 'petBack';

/** Which body a socket belongs to — the runtime uses this to group emitters per wearer. */
export type CosmeticWearer = 'player' | 'pet';

export const SOCKET_WEARER: Record<CosmeticSocket, CosmeticWearer> = {
  hairPin: 'player',
  crown: 'player',
  pendant: 'player',
  back: 'player',
  halo: 'player',
  ankle: 'player',
  aura: 'player',
  petHead: 'pet',
  petCollar: 'pet',
  petBack: 'pet',
};

// ---------------------------------------------------------------------------
// EFFECT SPECS
// ---------------------------------------------------------------------------

/**
 * When an effect is allowed to run.
 *
 * `moving` and `night` are the "環境效果 / 互動效果" of section 一 in their cheapest honest
 * form: a flag the runner already has (playerBus.playerIsMoving, the weather) gating a
 * rate, rather than a second system that watches the world.
 */
export type EffectTrigger =
  /** Ambient — the default. Runs whenever the wearer is on screen. */
  | 'always'
  /** Only while the wearer is actually moving (mushroom spores, flower petals). */
  | 'moving'
  /** Only after dark (lanterns, and anything whose whole point is glowing). */
  | 'night'
  /**
   * Only while the player is in the water.
   *
   * The cheapest possible answer to 「游泳時可以稍微強化水元素」: `playerBus.isSwimming` is a flag
   * the swim animation already publishes, so a water cosmetic gets a second, stronger emitter
   * that is simply gated on it. Nothing about the swim POSE is touched — the requirement is
   * explicit that the animation must not be affected, and an emitter cannot affect it because
   * emitters never write to the body.
   */
  | 'swimming';

/**
 * ONE ANIMATED SUB-PART of a model — the capability that lets an ornament be a MECHANISM.
 *
 * ---------------------------------------------------------------------------
 * WHY THIS EXISTS AT ALL
 * ---------------------------------------------------------------------------
 *
 * {@link MotionSpec}'s sway/bob/spin/pulse all write ONE transform, onto the cosmetic's own
 * group. That is exactly right for an ornament that moves as a single object, and it is the
 * reason the whole catalog costs one update loop — but a single transform can only ever say
 * "this thing is moving". It cannot say:
 *
 *   - three small stars circling a hairpin at different radii,
 *   - two gears in a music box turning at different rates and in opposite directions,
 *   - four flowers on a crown nodding out of step with each other,
 *   - two little clouds drifting around a big one,
 *   - a crystal orbiting a halo while the halo itself hangs still.
 *
 * Every one of those was previously only reachable by adding a bespoke component with its own
 * frame loop, which is the thing this system exists to make unnecessary. So the model tags the
 * sub-groups it wants driven (the same `COSMETIC_PART` mechanism the wings already used) and
 * the catalog says how each tag moves. The cost is three float writes per tagged group, on
 * groups that already exist in the tree.
 *
 * ---------------------------------------------------------------------------
 * A TAG IS A SET, NOT ONE OBJECT
 * ---------------------------------------------------------------------------
 *
 * Several sub-groups may share a tag, and one entry here drives all of them with {@link
 * stagger} spreading their phases. That is what makes "three stars evenly spaced on an orbit"
 * one config line rather than three, and it is why the runtime keeps an ARRAY per tag.
 *
 * ---------------------------------------------------------------------------
 * THE BASE POSE IS CAPTURED, NEVER CLOBBERED
 * ---------------------------------------------------------------------------
 *
 * A sub-group is authored somewhere — a flower is at its own angle round the crown, a gear is
 * at its own place in the box. So these curves are added to the pose the model drew, captured
 * once at registration. Writing them absolutely (which is what the top-level {@link MotionSpec}
 * does, and correctly, because the cosmetic's own group starts at identity) would snap every
 * tagged part to the origin on the first frame.
 */
export interface PartMotionSpec {
  /** The `COSMETIC_PART` value the model tagged its sub-groups with. */
  tag: string;
  /**
   * Constant rotation, radians per second, ADDED to the authored rotation.
   *
   * This is also how an ORBIT is expressed: the model puts a small ornament at radius r inside
   * a tagged group centred on the socket, and spinning that group about Y carries the ornament
   * round a circle. No orbit-specific field, no per-frame trigonometry in the runtime, and the
   * radius stays where a radius belongs — in the geometry.
   */
  spin?: { axis: 'x' | 'y' | 'z'; speed: number };
  /** Pendulum rotation about the authored pose. */
  sway?: { axis: 'x' | 'y' | 'z'; amplitude: number; speed: number };
  /** Vertical float about the authored position, in the model's own units. */
  bob?: { amplitude: number; speed: number };
  /** Scale breathing, as a fraction of the authored scale. */
  pulse?: { amplitude: number; speed: number };
  /**
   * Phase offset applied per tagged sibling, in TURNS — so `0.333` spreads three of them evenly
   * round a cycle and `0.5` puts two in opposition.
   *
   * Stated in turns rather than in seconds or radians because it has to mean the same thing to a
   * spin (radians per second) and to a sway (cycles per second), and "a fraction of one cycle" is
   * the only unit both of those share.
   */
  stagger?: number;
}

/**
 * MESH ANIMATION — the part of an effect that costs nothing.
 *
 * Applied to the cosmetic's own group, which the socket has already placed, so every
 * field here is in the cosmetic's LOCAL space and none of it can move the wearer.
 *
 * All four are driven from a single shared clock with a per-cosmetic phase offset, so two
 * players wearing the same flower crown do not sway in lockstep like a chorus line.
 */
export interface MotionSpec {
  /** Pendulum rotation, radians of amplitude at `speed` cycles·2π per second. */
  sway?: { axis: 'x' | 'y' | 'z'; amplitude: number; speed: number };
  /** Vertical float, in local units. What makes a cloud read as a cloud. */
  bob?: { amplitude: number; speed: number };
  /** Constant rotation. Keep it SLOW — anything past ~0.6 rad/s reads as a pickup icon. */
  spin?: { axis: 'x' | 'y' | 'z'; speed: number };
  /** Uniform scale breathing, as a fraction of the base size (0.06 = ±6%). */
  pulse?: { amplitude: number; speed: number };
  /**
   * PAIRED WING BEAT — the one motion that drives the model's own parts rather than the
   * group above it, and the one that reacts to what the wearer is doing.
   *
   * Everything else here writes a single transform onto the cosmetic's group, which cannot
   * express a beat: two wings have to rotate in OPPOSITE directions or they read as one
   * object rocking. So a model that wants this tags two of its sub-groups (see
   * `COSMETIC_PART` in Three/effects/CosmeticModels.tsx) and the runtime finds them once at
   * registration. A model with no tagged parts and a `flap` spec simply does not flap — the
   * same "absence of config, not a special case" rule the rest of this file follows.
   *
   * The `moving*` values are the pose at a full walk; the runtime crossfades between the two
   * over ~0.35 s so the wings open as the player sets off instead of snapping open.
   */
  flap?: {
    /** Beat amplitude at rest, radians. */
    amplitude: number;
    /** Beats per second at rest. */
    speed: number;
    /** Beat amplitude while moving. */
    movingAmplitude: number;
    /** Beats per second while moving. */
    movingSpeed: number;
    /** Constant open angle the beat swings about, radians. Folded rest pose vs. spread. */
    spread: number;
    /** That angle while moving. */
    movingSpread: number;
    /**
     * FORE/AFT amplitude, radians — the wings gathering back and pushing forward, on the same
     * phase as the lift.
     *
     * Not decoration on top of the lift: on THIS character it carries most of the beat. A
     * chibi's skull overhangs its whole upper back, so the top of a purely vertical stroke
     * puts both wings behind the head where nothing can be seen of them (which is exactly what
     * the first tuning of this item did, and it looked like the wings had been taken off). Up
     * is the one direction a back wearable here cannot use; fore/aft is completely unobstructed
     * and, from the third-person camera looking down over the shoulder, it is also the more
     * legible half of a wingbeat.
     */
    sweep?: number;
    /** That amplitude while moving. */
    movingSweep?: number;
    /**
     * A SECOND PAIR of wings (tags `wingL2` / `wingR2`), beating this many radians behind the
     * first pair.
     *
     * Insects have four wings and the fore and hind pairs do not beat together — the lag between
     * them is most of what separates a real flier from a cut-out flapping. A quarter of a beat
     * (~1.5 rad) is the value that reads; in phase they look like one thick wing, and in
     * antiphase they look broken.
     *
     * Absent means the model has one pair, which is every wing in the catalog but one.
     */
    secondaryLag?: number;
    /** The second pair's amplitude as a fraction of the first's. Under 1: hind wings work less. */
    secondaryScale?: number;
  };
  /**
   * Sub-parts of the model that move on their own — see {@link PartMotionSpec}.
   *
   * Ordinary ornaments have none of these and are unaffected. This is what a HIGH-END cosmetic
   * spends to stop being "one mesh that wobbles": the difference between a star pin and a small
   * piece of sky is entirely in here.
   */
  parts?: PartMotionSpec[];
}

/**
 * PARTICLES — the garnish.
 *
 * Every quantity that would look mechanical if it were constant is a `[min, max]` range
 * sampled per particle. That is the difference between "a few leaves came loose" and "an
 * emitter is running".
 *
 * All distances are WORLD units along WORLD axes, so `rise: 0.3` is 30 cm upward whatever
 * the cosmetic is bolted to and whichever way its wearer is facing. They are NOT in the
 * socket's local frame, and deliberately so: the player root is drawn at 2.25x and the dog's
 * at 0.4x, so socket-local numbers would mean a sixth of the size on the pet for the same
 * config. The runtime's only concession is dividing by the wearer's canonical root scale,
 * which is 1 in play and 0.5 in the dressing-room preview — that is what keeps the preview
 * from showing sparkles at twice the size the world shows them.
 */
export interface EmitSpec {
  shape: ParticleShape;
  /** Sampled per particle. One flat colour per burst is what reads as "a graphic". */
  colors: string[];
  /** Mean seconds between bursts. Deliberately long — see the design budget above. */
  interval: number;
  /** Fraction of `interval` the wait is jittered by, so bursts never land on a metronome. */
  intervalJitter: number;
  /** Particles per burst, inclusive range. Usually [1, 2]. */
  count: [number, number];
  lifetime: [number, number];
  /** Particle radius. The character is ~2.16 world units tall; 0.05 is a freckle. */
  size: [number, number];
  /**
   * Final size as a multiple of the spawn size, reached at the end of the particle's life.
   * Omitted (the default) means a constant size.
   *
   * `size` is therefore the size a particle STARTS at, and this is the one field that lets a
   * particle be a wave rather than an object: a ripple is a ring that is 3x bigger and gone by
   * the time you have looked at it. Driven by the raw life fraction and deliberately NOT by
   * `settle`'s compressed travel curve — a settled particle stops MOVING; a growing one keeps
   * growing while it fades, which is the difference between a thing coming to rest and a wave
   * passing through.
   */
  grow?: number;
  /** Offset of the spawn point from the socket, in the socket's own frame. */
  offset?: [number, number, number];
  /** Random scatter around that spawn point. */
  spread: number;
  /** Signed vertical travel over the particle's life. Negative falls. */
  rise: number;
  /**
   * Downward acceleration over the particle's life, in world units — a PARABOLA on top of
   * `rise`'s straight climb.
   *
   * The pair is the point: `rise` alone is a thing being carried upward, which is right for
   * a bubble and wrong for anything thrown. An ember leaves a flame fast, slows, turns over and
   * falls back, and that shape is `rise: 0.4, gravity: 0.7` — it cannot be expressed by any
   * combination of rise and drift, because both of those are monotonic.
   *
   * Runs on the same travel curve `settle` compresses, so a settled particle stops falling
   * where it landed instead of sinking through the island.
   */
  gravity?: number;
  /**
   * A side-to-side sine ACROSS the direction of travel, in world units at this many cycles per
   * second.
   *
   * What makes a falling flake flutter, a note drift, and a rising bubble waver instead of
   * running up a ruled line. Applied perpendicular to the particle's own drift direction and
   * given a per-particle phase, so a burst of six does not sway as one body.
   */
  wobble?: { amplitude: number; speed: number };
  /**
   * THE OCCASIONAL BIG ONE — a per-particle roll that makes a few of them special.
   *
   * ---------------------------------------------------------------------------
   * WHY THIS IS NOT A SECOND EMITTER
   * ---------------------------------------------------------------------------
   *
   * 「偶爾出現較大的星星」 could be a second emit row with a long interval, and that was the first
   * build. It is worse for a reason worth recording: two independent timers drift apart, so the
   * rare particle arrives in the gaps rather than among the ordinary ones, and what the player
   * sees is two unrelated effects rather than one effect with a highlight in it. Rolling it per
   * particle guarantees the big one is born INSIDE a burst of small ones, which is the whole
   * read — a handful of star dust, and one of them is a real star.
   *
   * It also costs nothing: same pool, same slot, same update. Only the numbers written into the
   * slot differ.
   */
  rare?: {
    /** Probability per particle, 0-1. Keep it low — 0.08 is roughly one in a burst of a dozen. */
    chance: number;
    /** Size multiplier on the size already rolled. */
    size: number;
    /** Lifetime multiplier. A bigger thing should also last longer or it reads as a glitch. */
    lifetime?: number;
    /** Absolute opacity for the rare one, replacing the emitter's. */
    opacity?: number;
    /** Its own palette, if being bigger is not enough. Falls back to the emitter's colours. */
    colors?: string[];
    /**
     * Its own `grow`. Values BELOW 1 shrink it away over its life, which is how a large ice
     * crystal 「碎裂消失」 without any shatter geometry: it is drawn big, it hangs, and it
     * dwindles to nothing while it fades.
     */
    grow?: number;
    /** Tumble multiplier. Heavy things turn more slowly. */
    tumble?: number;
  };
  /**
   * INTERMITTENT SALVOS — the emitter runs for `on` seconds, then is silent for `off`.
   *
   * The requirement it exists for is 「不要一直下雨」: a rain cloud should let go of a few drops,
   * stop, and be a cloud again. Every other rate control in this file adjusts how OFTEN a burst
   * happens, which can only ever produce a steady drizzle at some density; nothing in the system
   * could express a beginning and an end.
   *
   * Distinct from {@link BurstSpec} on purpose. A burst answers to a moment the player caused; a
   * cadence is weather, and nobody asked for it.
   */
  cadence?: {
    /** Seconds the emitter is allowed to fire for. */
    on: number;
    /** Seconds of silence after that. */
    off: number;
    /** Fraction both are jittered by, so the rain does not arrive on a timetable. Default 0.35. */
    jitter?: number;
  };
  /** Horizontal wander over the particle's life, in a random direction per particle. */
  drift: number;
  /**
   * Turns `drift` from a straight line into a CIRCLE of that radius around the spawn point,
   * this many laps over the particle's lifetime. This is the "環繞物件" effect kind from
   * section 一, and it is a number rather than a separate effect type because an orbiting
   * particle differs from a drifting one only in how its horizontal offset is computed —
   * same pool, same update, same cost.
   */
  orbit?: number;
  /** Tumble, radians per second. Petals and leaves need it; light points must not have it. */
  tumble: number;
  /**
   * Fraction of its life at which a particle STOPS TRAVELLING and stays where it is in the
   * world, tumbling to a near halt, while the rest of its life is spent fading out.
   * Omitted (the default) means it drifts for the whole of its life.
   *
   * This is what turns an emitter into a TRAIL. Without it every particle is still moving at
   * the moment it disappears, so a wearer walking away leaves a smear that follows them; with
   * `settle: 0.4` the particle finishes its arc in the first 40% of its life and is then a
   * thing lying in the air where it was dropped, which is what the player reads as "I came
   * from over there". Cheaper than any real trail geometry: it is one clamp in the existing
   * position curve, no new pool and no new draw call.
   */
  settle?: number;
  /** Peak opacity. The particle fades in over the first 15% of life and out over the last 45%. */
  opacity: number;
  /**
   * Hard ceiling on particles alive from THIS emitter. An emitter at its cap skips its
   * burst rather than recycling, so a long-worn cosmetic looks the same as a fresh one.
   */
  maxAlive: number;
  trigger: EffectTrigger;
  /**
   * Interval multiplier while the wearer is moving. < 1 emits more often (bubbles when the
   * player walks), > 1 less. Ignored when `trigger` is `moving`, which is already gated.
   */
  movingScale?: number;
}

/**
 * A LOW-POLY LIVING THING that flies out of the cosmetic, circles the wearer and leaves.
 *
 * Kept as its own effect kind rather than as a particle because the brief is explicit that
 * a bee should be a small mesh with an animation, not a sprite: it has wings that beat, it
 * banks into its turn, and it is drawn with real geometry. The pool that renders these is
 * capped at three across the whole scene — see Three/effects/EffectField.tsx.
 */
export interface CreatureSpec {
  kind: 'bee' | 'butterfly';
  /** Mean seconds between appearances. Long: this is an event, not an emitter. */
  interval: number;
  intervalJitter: number;
  /** How long one visit lasts, including the fade in and out. */
  duration: [number, number];
  /** Radius of the loop it flies around the wearer, world units. */
  orbitRadius: [number, number];
  /** Height above the socket the orbit sits at. */
  orbitHeight: number;
  /** Laps per second. */
  orbitSpeed: number;
  /**
   * Body scale, applied to a mesh authored at ~1 world unit across (see CreatureMeshes.tsx).
   *
   * So this number IS the creature's wingspan in world units, against a 2.16-unit character —
   * i.e. 0.12 is a 12 cm butterfly. Authoring the mesh at unit size and shrinking here keeps
   * the geometry's numbers readable, but it makes 1.0 a metre-wide insect, which is exactly
   * what the first pass shipped before it was looked at.
   */
  scale: number;
  /** At most this many alive from this cosmetic. Effectively always 1. */
  maxAlive: number;
  trigger: EffectTrigger;
}

/**
 * LYING ON THE GROUND — the spec that makes the `aura` socket possible.
 *
 * ---------------------------------------------------------------------------
 * WHY THIS IS NOT JUST "A MODEL ON A LOW SOCKET"
 * ---------------------------------------------------------------------------
 *
 * Everything else in this catalog is worn BY the character, so the body's transform is exactly
 * the transform it wants: a hairpin should turn when the head turns. A ring drawn on the ground
 * is the opposite — it belongs to the FLOOR, and it has two problems the body cannot solve.
 *
 *   IT MUST NOT INHERIT THE BODY'S ORIENTATION. The character yaws as it walks and pitches flat
 *   when it crawls; a ground ring that did either would be a ring standing on its edge. So the
 *   runtime writes this cosmetic's local rotation as the INVERSE of whatever its parent is doing,
 *   times the tilt it actually wants. A model on this socket must therefore be drawn flat in XZ
 *   and be readable from any yaw — it will not turn with its wearer.
 *
 *   IT MUST FOLLOW THE SLOPE. The island is not flat. A 0.5-unit ring lying in the world's XZ
 *   plane cuts into the uphill side of every hill on it, and this is precisely why the aura
 *   socket was deferred when the halo was built: adding the socket was never the work, terrain
 *   was. The runtime samples the ground at four points around the wearer, fits a plane through
 *   them and tilts the ring to match.
 *
 * ---------------------------------------------------------------------------
 * WHAT IT DOES NOT DO
 * ---------------------------------------------------------------------------
 *
 * It fits ONE PLANE, not the surface. A ring on a smooth slope sits flush; a ring straddling a
 * step or a boulder floats on one side. That is a deliberate stopping point: per-vertex
 * conforming means deforming the mesh every frame against a height field, and the thing it buys
 * — a ring bending over a rock — is not visible at the size these are drawn. `maxTilt` is the
 * guard for the case the approximation fails on, a cliff edge, where the honest answer is to
 * stop tilting and let it float rather than stand the ring up like a wheel.
 */
export interface GroundSpec {
  /**
   * How far out to sample, WORLD units — like every other distance in this file, and unlike the
   * model, which is authored in character-local units at 2.25x. The two have to be converted
   * between by hand and the first pass did not: a model of local radius 0.62 is 1.4 world, and
   * sampling at 0.62 fitted the plane to a patch less than half the ring's size.
   *
   * Should be roughly the model's own world radius. Sampling inside the ring fits a plane to
   * ground the ring does not cover; sampling outside it makes the ring lean to a hill it is not
   * actually on.
   */
  radius: number;
  /** How far above the sampled ground to sit. Small — this is z-fighting clearance, not height. */
  lift: number;
  /** Tilt ceiling, radians. Past this the ring stops following and floats. */
  maxTilt: number;
}

/**
 * A REAL LIGHT — the only thing a cosmetic can do that changes the scene rather than adding to it.
 *
 * ---------------------------------------------------------------------------
 * WHY THIS ONE HAS A GLOBAL POOL AND NOTHING ELSE DOES
 * ---------------------------------------------------------------------------
 *
 * Every other effect in this file gets cheaper the more of it there is: particles share eight
 * InstancedMeshes, creatures share three slots, and a hundred wearers cost the same eight draw
 * calls. Lights do the opposite. A dynamic light is not an object in the scene, it is a term in
 * every lit fragment shader in the scene, and adding one re-costs the terrain, the houses and
 * everyone standing on the island — not just the wearer.
 *
 * So a `glow` cosmetic does not GET a light. It becomes a CANDIDATE for one of
 * {@link GLOW_POOL_SIZE} lights the field owns, and the nearest candidates to the camera win.
 * A crowd of ten glowing players costs exactly what one costs, and the two who are furthest
 * away simply fade out — which is also what distance would have done to their light anyway.
 *
 * ---------------------------------------------------------------------------
 * WHY IT IS ALMOST ALWAYS NIGHT-GATED
 * ---------------------------------------------------------------------------
 *
 * A 1.6-intensity point light against the island's midday exposure is invisible: the
 * directional light is at 1.2 with ambient at 0.4 and hemisphere at 0.5 across the whole sky,
 * and a small local light simply does not show on a surface that is already fully lit. Paying a
 * per-fragment cost for something nobody can see is the worst trade in the file, so `trigger`
 * exists here for the same reason it exists on an emitter, and `night` is the honest answer for
 * anything whose whole point is glowing.
 */
export interface GlowSpec {
  color: string;
  /**
   * Peak intensity. For scale: the house interior's follow-light — a light meant to read as
   * "this room is lit" — is 2.2 at distance 12. A worn ornament should be well under that.
   */
  intensity: number;
  /** Reach, world units. Beyond this the light contributes nothing, which is what bounds its cost. */
  distance: number;
  /** Breath, as a fraction of `intensity`. A light that does not vary reads as a lamp bolted on. */
  pulse?: { amplitude: number; speed: number };
  /** Offset of the light from the socket, in the socket's own frame. */
  offset?: [number, number, number];
  trigger: EffectTrigger;
}

/**
 * A ONE-OFF BURST tied to a MOMENT rather than to a timer.
 *
 * Every other effect in this file is ambient: it runs on an interval and its job is to be
 * noticeable without being watched. That is the right default and it is also the reason the
 * whole set reads as one volume level — nothing in it can ever be an EVENT.
 *
 * A burst is the other half. It emits nothing at all until the player does something, and
 * then it is allowed to be loud: ten particles at once, which is five times any emitter's
 * cap. The restraint moves from "few particles" to "rarely", and `cooldown` is what enforces
 * it — jumping repeatedly gives one burst per cooldown, not a fountain.
 *
 * Deliberately NOT an {@link EffectTrigger}. A trigger gates a rate; this has no rate.
 */
export interface BurstSpec {
  /**
   * The moment. `jump` is the rising edge of `playerBus.playerIsAirborne` — the frame the
   * feet leave the ground, jump or somersault.
   */
  on: 'jump';
  shape: ParticleShape;
  colors: string[];
  /** Particles per firing. Loud on purpose — see above. */
  count: number;
  lifetime: [number, number];
  size: [number, number];
  /** Offset of the burst's centre from the socket, in the socket's own frame. */
  offset?: [number, number, number];
  spread: number;
  rise: number;
  /** Downward acceleration, as on {@link EmitSpec.gravity}. Turns a puff into a spray. */
  gravity?: number;
  drift: number;
  tumble: number;
  opacity: number;
  settle?: number;
  /** Minimum seconds between firings. */
  cooldown: number;
}

/**
 * The complete behaviour of one cosmetic. Every field optional: a cosmetic with none of
 * them is a perfectly valid ordinary accessory, which is what "無特殊效果" means here —
 * it is the absence of config, not a special case in the code.
 */
export interface CosmeticEffect {
  motion?: MotionSpec;
  /** Zero or more emitters. Two is the practical maximum used below. */
  emit?: EmitSpec[];
  creature?: CreatureSpec;
  burst?: BurstSpec;
  glow?: GlowSpec;
  /**
   * Makes this cosmetic lie on the ground rather than on the wearer. Only meaningful on the
   * `aura` socket, and it OVERRIDES `motion.bob`'s y — the two are asking for different heights
   * and the ground has to win.
   */
  ground?: GroundSpec;
}

/**
 * A special cosmetic: the item, where it hangs, what it looks like, and how it behaves.
 */
export interface SpecialCosmeticDef {
  /** The item id from constants/items.ts. This is the join — nothing matches on names. */
  itemId: string;
  series: CosmeticSeries;
  socket: CosmeticSocket;
  /** Mirrors the socket across the wearer's centreline (a hairpin on the other side). */
  mirror?: boolean;
  /** Key into COSMETIC_MODELS (Three/effects/CosmeticModels.tsx). */
  model: string;
  effect: CosmeticEffect;
}

// ---------------------------------------------------------------------------
// PALETTES
// ---------------------------------------------------------------------------

/**
 * The five palettes the prototype draws from, stated once so a cosmetic's mesh and its
 * particles cannot drift apart — the star that floats off a star hairpin is literally the
 * hairpin's own colour.
 *
 * Deliberately desaturated: these are the cozy-island tints (soft cream, sage, dusty rose,
 * pale sky) rather than the saturated primaries a "sparkle effect" defaults to.
 */
export const COSMETIC_PALETTE = {
  // Near-white rather than the pale yellow this started as. The character's skin is
  // AVATAR_SKIN_COLOR '#fcd34d' — a saturated amber — so a butter-yellow star sitting on the
  // head vanished into it entirely in the first render. Starlight has to be the LIGHTEST
  // thing on the character to read as light at all, and the cool blue-grey clip is what
  // separates the ornament from the skin underneath it.
  starlight: { body: '#fff8e6', glow: '#ffffff', deep: '#93a9c2' },
  forest: { body: '#8fbf7a', glow: '#c7e0b0', deep: '#5f8f56', bloom: '#f6d5dd' },
  flower: { body: '#f3b6c4', glow: '#fbe0e6', deep: '#d98c9f', heart: '#fbe3a8' },
  bubble: { body: '#bfe4ef', glow: '#eaf8fc', deep: '#8ec6d8' },
  campfire: { body: '#f2a35c', glow: '#fbd9a0', deep: '#d9713a' },
  cloud: { body: '#f2f5f8', glow: '#ffffff', deep: '#d3dde5' },
  honey: { body: '#f0c46a', glow: '#fbe6b4', deep: '#c98f36' },
  butterfly: { body: '#c9a8e0', glow: '#efe2f7', deep: '#9d7bbb' },
  // Deliberately GREEN-leaning rather than the sky blue an ocean palette defaults to.
  // `bubble` already owns pale sky blue on this shelf, and two series a player cannot tell
  // apart is worse than one of them being slightly off-brief — this is the colour of shallow
  // water over pale sand rather than of deep sea.
  ocean: { body: '#7ec8c0', glow: '#cdeeea', deep: '#3f8f8b', sand: '#f0dcc0' },
  // Warm lilac-grey. Music has no natural colour, so it takes the one nothing else on the shelf
  // is using; `butterfly` is the nearest and sits a clear step more purple and more saturated.
  music: { body: '#b8b4d6', glow: '#e8e6f4', deep: '#7b769c' },
  // THE THIRD PALE-BLUE FAMILY ON THIS SHELF, which is the problem it had to be designed around:
  // `bubble` already owns pale sky and `cloud` owns near-white, and the file's own note about
  // ocean-vs-bubble says two series a player cannot tell apart is worse than one being slightly
  // off-brief.
  //
  // So frost is separated on the DEEP rather than on the body — `deep` here is a real steel blue
  // (#5c86b3) against bubble's soft teal (#8ec6d8) and cloud's warm grey (#d3dde5), which is a
  // clearly darker and bluer note than either family has anywhere in it. `ice` is the mid tone
  // the crystals are cut from, and it is the one saturated colour in the set: an ice crystal that
  // is the same value as the ring it hangs off has no facets.
  frost: { body: '#bcd9ef', glow: '#f4fbff', deep: '#5c86b3', ice: '#8fc4e8' },
} as const;

// ---------------------------------------------------------------------------
// THE CATALOG
// ---------------------------------------------------------------------------

/**
 * The prototype set: five for the player, five for the pet (section 九).
 *
 * Read these as five different ANSWERS to "how should a cosmetic feel alive", not as five
 * settings of one particle system — that variety is the point of the brief:
 *
 *   星星髮飾    a slow twinkle plus the rare drifting star     (spin + sparse emitter)
 *   森林花冠    leaves that come loose and fall                (sway + falling emitter)
 *   泡泡髮飾    bubbles that rise faster when you walk         (bob + movement-scaled emitter)
 *   小火焰吊飾  a flame that breathes, with the odd ember      (pulse + sway, tiny emitter)
 *   蝴蝶髮夾    a real butterfly that flies a lap and leaves   (creature, NO particles at all)
 *   星軌之翼    wings that open when you walk and burst when
 *               you jump                                       (flap + settling trail + burst)
 *
 * and on the pet, each one reacts to the pet rather than shrinking a player item:
 *
 *   蝴蝶結      wags with the dog, releases a heart            (sway + rare emitter)
 *   蘑菇帽      spores ONLY while the dog is trotting          (bob + `moving` trigger)
 *   小蜂巢背包  a bee that circles the dog and goes home       (creature)
 *   星星項圈    a star that orbits the collar                  (spin + orbiting emitter)
 *   花朵項圈    petals dropped along the path, only when moving (sway + `moving` fall)
 */
export const SPECIAL_COSMETICS: SpecialCosmeticDef[] = [
  // =========================================================================
  // PLAYER
  // =========================================================================

  /**
   * 星星髮飾 — 「一小片星空」, and the clearest example of what a detail pass is for.
   *
   * What it used to be: one emitter, one star every ~2 s, a pin that swayed. Perfectly tasteful,
   * and it had the same shape as every other item on the shelf — a thing, and some sparkles near
   * it. What makes it a SKY is that it now has three layers at three scales, and none of them is
   * "more stars":
   *
   *   THE ORNAMENT MOVES IN TWO PLACES.  The pin sways as before, and three satellites go round it
   *     on their own tagged orbit at 0.5 rad/s. Two rates at once is depth; one rate is a spin.
   *   THE DUST IS SEPARATE FROM THE STARS.  A slow, small, near-transparent `mote` emitter runs
   *     underneath the star emitter. Dust and stars are what a night sky is made of, and one
   *     emitter can only ever be one of them.
   *   ONE IN EIGHT IS A REAL STAR.  `rare` doubles the size, lengthens the life and takes the pure
   *     glow tint. Because it is rolled per particle rather than run on its own timer, the big one
   *     always arrives inside a handful of small ones — see the note on EmitSpec.rare.
   */
  {
    itemId: 'fx-star-hairpin',
    series: 'starlight',
    socket: 'hairPin',
    model: 'starPin',
    effect: {
      motion: {
        // A SWAY, not a full spin. The star is a flattened octahedron, so a continuous
        // rotation about Y carries it edge-on twice a turn and it thins to a sliver —
        // caught in the first headless capture of this set. A ±20deg turn gives the same
        // catch-the-light glint and never leaves the face pointing away.
        sway: { axis: 'y', amplitude: 0.35, speed: 0.22 },
        pulse: { amplitude: 0.07, speed: 0.9 },
        parts: [
          // The three satellites, evenly spread. Slow: at this radius 0.5 rad/s is a lap every
          // 12 seconds, which is a drift. Anything you can watch go round reads as a loading
          // spinner rather than as something in orbit.
          { tag: 'orbit', spin: { axis: 'y', speed: 0.5 }, stagger: 0.333 },
        ],
      },
      emit: [
        {
          shape: 'star',
          colors: [COSMETIC_PALETTE.starlight.body, COSMETIC_PALETTE.starlight.glow],
          interval: 2.1,
          intervalJitter: 0.5,
          count: [1, 2],
          lifetime: [2.75, 4.25],
          size: [0.034, 0.06],
          offset: [0, 0.03, 0],
          spread: 0.07,
          rise: 0.34,
          drift: 0.13,
          wobble: { amplitude: 0.04, speed: 0.55 },
          tumble: 0.5,
          opacity: 0.8,
          maxAlive: 5,
          trigger: 'always',
          // 「偶爾出現較大的特殊星星」. 1.7x and a third longer, in the pure glow tint.
          //
          // 1.7 rather than the 2.0 this was first written at, and the reason is the size budget in
          // this file's header: 2.0 takes the largest star to 0.12 world radius, and the ceiling is
          // ~0.09 for anything solid. A star is thin (0.32 depth) and mostly empty between its
          // points, so it is allowed to sit slightly above that at 0.102 — but 24 cm across at head
          // height was starting to be an object beside the character rather than a highlight in a
          // handful of dust.
          rare: { chance: 0.13, size: 1.7, lifetime: 1.3, opacity: 0.92, colors: [COSMETIC_PALETTE.starlight.glow], tumble: 0.5 },
        },
        {
          // STAR DUST. Smaller, slower, fainter and far more numerous than the stars, drifting up
          // rather than out. This is the layer that fills the space BETWEEN the stars, and it is
          // why the item now reads as a piece of sky rather than as an emitter running.
          shape: 'mote',
          colors: [COSMETIC_PALETTE.starlight.glow, COSMETIC_PALETTE.starlight.body],
          interval: 1.6,
          intervalJitter: 0.5,
          count: [1, 2],
          lifetime: [2, 3],
          size: [0.024, 0.036],
          offset: [0, -0.01, 0],
          spread: 0.13,
          rise: 0.26,
          drift: 0.08,
          wobble: { amplitude: 0.045, speed: 0.5 },
          tumble: 0,
          opacity: 0.7,
          maxAlive: 5,
          trigger: 'always',
        },
      ],
    },
  },

  /**
   * 森林花冠 — a wreath that gives up one leaf at a time.
   *
   * `rise` is NEGATIVE: leaves fall. They also tumble, which is the whole read — a falling
   * quad that does not rotate looks like a dropped sticker. 8 s apart, two alive at most,
   * so the effect is something you notice rather than something you watch.
   */
  {
    itemId: 'fx-forest-crown',
    series: 'forest',
    socket: 'crown',
    model: 'forestCrown',
    effect: {
      motion: {
        sway: { axis: 'z', amplitude: 0.045, speed: 0.55 },
        parts: [
          // 「葉片有不同頻率的晃動」 — and the flowers a different one again. Two rates, two
          // staggers, and neither divides evenly into a whole cycle, so no two neighbours on the
          // ring ever come back into step. Wind does not have a period.
          { tag: 'bloom', sway: { axis: 'x', amplitude: 0.17, speed: 0.41 }, stagger: 0.27 },
          { tag: 'leaf', sway: { axis: 'z', amplitude: 0.3, speed: 0.73 }, stagger: 0.19 },
        ],
      },
      emit: [
        {
          shape: 'leaf',
          colors: [COSMETIC_PALETTE.forest.body, COSMETIC_PALETTE.forest.glow, COSMETIC_PALETTE.forest.deep],
          interval: 2.6,
          intervalJitter: 0.45,
          count: [1, 1],
          lifetime: [3.75, 5.25],
          size: [0.042, 0.066],
          offset: [0, -0.02, 0.1],
          spread: 0.16,
          rise: -0.55,
          drift: 0.22,
          // Leaves do not fall straight. The wobble is what turns a descent into a flutter, and
          // it is the same 7 cm of sway that would have taken a second emitter to fake.
          wobble: { amplitude: 0.07, speed: 0.45 },
          tumble: 1.5,
          opacity: 0.85,
          maxAlive: 4,
          trigger: 'always',
        },
        {
          // 「偶爾掉落一片花瓣」 — and `cadence` is what makes 偶爾 mean 偶爾. This emitter is
          // silent for ~7 seconds, then lets go of two or three petals over a second and a bit,
          // then stops. On a plain interval the same petal count is a steady sprinkle, which is
          // the thing that would have made the crown read as an emitter rather than as a wreath
          // shedding.
          shape: 'petal',
          colors: [COSMETIC_PALETTE.forest.bloom, COSMETIC_PALETTE.flower.glow, COSMETIC_PALETTE.flower.body],
          interval: 0.95,
          intervalJitter: 0.35,
          count: [1, 2],
          lifetime: [3.2, 4.6],
          size: [0.03, 0.052],
          offset: [0, -0.01, 0.08],
          spread: 0.2,
          rise: -0.48,
          drift: 0.2,
          wobble: { amplitude: 0.08, speed: 0.5 },
          tumble: 1.3,
          opacity: 0.85,
          maxAlive: 4,
          trigger: 'always',
          cadence: { on: 1.3, off: 6.8 },
        },
        {
          // POLLEN. Warm, tiny, barely there, rising — the only always-on layer, and the one that
          // makes the crown look like it is in the air of a forest rather than in a vacuum.
          shape: 'spore',
          colors: [COSMETIC_PALETTE.forest.glow, '#f6e2a8'],
          interval: 1.55,
          intervalJitter: 0.5,
          count: [1, 2],
          lifetime: [2.2, 3.2],
          size: [0.024, 0.036],
          offset: [0, 0.02, 0],
          spread: 0.26,
          rise: 0.2,
          drift: 0.12,
          wobble: { amplitude: 0.05, speed: 0.42 },
          tumble: 0,
          opacity: 0.5,
          maxAlive: 5,
          trigger: 'always',
        },
      ],
    },
  },

  /**
   * 泡泡髮飾 — the one cosmetic that reacts to what the player is DOING.
   *
   * `movingScale: 0.55` nearly halves the wait while walking, so bubbles come off a little
   * faster in motion and settle back when you stop. Sizes vary widely on purpose (0.03 to
   * 0.075) because uniform bubbles read as a repeated sprite.
   */
  {
    itemId: 'fx-bubble-hairpin',
    series: 'bubble',
    socket: 'hairPin',
    model: 'bubblePin',
    effect: {
      motion: {
        bob: { amplitude: 0.012, speed: 0.8 },
        // The one cosmetic that can take a real rotation: a cluster of spheres has no
        // edge-on, so it turns without ever thinning out. Slow — this is a drift, not a spin.
        spin: { axis: 'y', speed: 0.12 },
        pulse: { amplitude: 0.05, speed: 1.1 },
        parts: [
          // Each of the three big bubbles breathes on its own phase. A soap bubble is never
          // still, and three of them pulsing in unison — which is what the group-level `pulse`
          // above does on its own — reads as the whole ornament being squeezed.
          { tag: 'bub', pulse: { amplitude: 0.09, speed: 1.35 }, stagger: 0.33 },
        ],
      },
      emit: [
        {
          shape: 'bubble',
          colors: [COSMETIC_PALETTE.bubble.body, COSMETIC_PALETTE.bubble.glow],
          interval: 1.68,
          intervalJitter: 0.5,
          count: [1, 3],
          lifetime: [3, 4.5],
          size: [0.028, 0.058],
          // 「接近角色 → 放大 → 消失」. A real bubble expands as it rises and pressure drops, and
          // `grow` is that for free — it also means the bubbles nearest the camera at the end of
          // their life are the biggest ones, which is the read the brief describes.
          //
          // THE TWO MULTIPLIERS COMPOUND, which is the trap this row fell into once: `rare.size`
          // scales the spawn size and `rare.grow` then scales THAT again, so 0.072 x 1.7 x 1.7 is
          // a 0.21 world-radius bubble — 42 cm across, most of a head. The pair is now bounded by
          // hand at 0.058 x 1.4 x 1.5 = 0.122, and that is only reached at the very end of a life
          // spent rising 62 cm, i.e. well clear of the face. Anything that multiplies has to be
          // checked as a product; neither factor looks wrong on its own.
          grow: 1.35,
          offset: [0, 0.02, 0],
          spread: 0.06,
          rise: 0.62,
          drift: 0.1,
          wobble: { amplitude: 0.06, speed: 0.6 },
          tumble: 0.2,
          opacity: 0.8,
          maxAlive: 9,
          trigger: 'always',
          movingScale: 0.55,
          rare: { chance: 0.1, size: 1.4, lifetime: 1.2, grow: 1.5 },
        },
        {
          // 「小水滴」. Falls instead of rising, and it is opaque water rather than glass, so it is
          // the one thing coming off this ornament that behaves like a liquid. Sparse on purpose:
          // its whole job is to say the bubbles are WET.
          shape: 'drop',
          colors: [COSMETIC_PALETTE.bubble.deep, COSMETIC_PALETTE.bubble.body],
          interval: 2.4,
          intervalJitter: 0.45,
          count: [1, 1],
          lifetime: [1.6, 2.4],
          size: [0.024, 0.036],
          offset: [0, -0.02, 0],
          spread: 0.05,
          rise: -0.22,
          gravity: 0.3,
          drift: 0.05,
          tumble: 0,
          opacity: 0.8,
          maxAlive: 3,
          trigger: 'always',
          movingScale: 0.7,
        },
      ],
    },
  },

  /**
   * 小火焰吊飾 — 「不要做成巨大火焰」.
   *
   * The flame is a 2 cm mesh that breathes at ±14% and leans a few degrees each way; that
   * asymmetric wobble is what reads as fire. Embers are the smallest particle in the set
   * (0.018) and there are never more than two.
   */
  {
    itemId: 'fx-flame-charm',
    series: 'campfire',
    socket: 'pendant',
    model: 'flameCharm',
    effect: {
      motion: {
        // 「晃動幅度過大」 — the charm's OWN movement, cut to about half.
        //
        // Two things were moving the whole ornament, not one. The sway was the fastest of the
        // three pendants in the catalog by angular rate (0.09 rad at 1.7 Hz, against 潮汐吊墜's
        // 0.11 at 0.7 and 音樂盒吊飾's 0.04 at 1.1) — a cup on a cord does not twitch, it swings.
        // And the `pulse` beside it scaled the WHOLE charm, brass and all, which has moved down
        // onto the flame's own group where it belongs (see FlameCharm). What is left is a slow,
        // shallow swing on the cord, with the fire doing the rest of the living.
        sway: { axis: 'z', amplitude: 0.045, speed: 1.2 },
        parts: [
          // The fire itself, breathing at ±14% — the amplitude this item always meant to have,
          // now applied to the flame rather than to the lantern holding it.
          { tag: 'flame', pulse: { amplitude: 0.14, speed: 2.3 } },
          // The core breathes at 3.4 Hz against the flame's 2.3 — deliberately not a multiple, so
          // the two never land together and the flame never has a beat. 「核心亮度微微變化」.
          { tag: 'core', pulse: { amplitude: 0.2, speed: 3.4 } },
          // The two side licks, in opposition (stagger 0.5). Opposition rather than unison is the
          // whole point: a fire is asymmetric moment to moment, and two licks leaning the same
          // way is just the flame leaning.
          { tag: 'lick', sway: { axis: 'z', amplitude: 0.32, speed: 2.05 }, stagger: 0.5 },
        ],
      },
      emit: [
        {
          shape: 'spark',
          colors: [COSMETIC_PALETTE.campfire.body, COSMETIC_PALETTE.campfire.glow],
          interval: 1.34,
          intervalJitter: 0.55,
          count: [1, 3],
          lifetime: [1.63, 2.5],
          size: [0.024, 0.045],
          offset: [0, 0.05, 0],
          spread: 0.03,
          // Rises fast, then falls back. An ember thrown off a flame is the textbook case for
          // `gravity`: with rise alone it drifts upward forever and reads as a bubble, and the
          // arc — up, slow, over, down — is the entire difference between an ember and a mote.
          rise: 0.34,
          gravity: 0.3,
          drift: 0.07,
          tumble: 0.8,
          opacity: 0.8,
          maxAlive: 6,
          trigger: 'always',
          // 「偶爾出現較大的火星」.
          rare: { chance: 0.1, size: 1.9, lifetime: 1.35, colors: [COSMETIC_PALETTE.campfire.glow] },
        },
        {
          // SMOKE. One wisp at a time, growing to two and a half times its size as it fades — the
          // shape's whole reason for existing. It is what puts air above the flame, and without
          // it the fire ends at a hard edge 5 cm above the cup.
          shape: 'wisp',
          colors: [COSMETIC_PALETTE.campfire.glow, '#e8dfd2'],
          interval: 2.2,
          intervalJitter: 0.4,
          count: [1, 1],
          lifetime: [2.2, 3.2],
          size: [0.03, 0.05],
          grow: 2.4,
          offset: [0, 0.09, 0],
          spread: 0.03,
          rise: 0.34,
          drift: 0.09,
          wobble: { amplitude: 0.04, speed: 0.5 },
          tumble: 0.2,
          opacity: 0.55,
          maxAlive: 3,
          trigger: 'always',
        },
      ],
    },
  },

  /**
   * 蝴蝶髮夾 — the proof that an effect does not need particles at all.
   *
   * No emitter. Every ~13 seconds one low-poly butterfly detaches, flies a slow lap around
   * the player's head at 0.5 m and fades out. The clip's own wings breathe in the meantime.
   */
  {
    itemId: 'fx-butterfly-clip',
    series: 'butterfly',
    socket: 'hairPin',
    model: 'butterflyClip',
    effect: {
      motion: {
        sway: { axis: 'y', amplitude: 0.16, speed: 0.9 },
        // THE RESTING BEAT. The model now has four tagged wings, so the butterfly sitting on the
        // clip opens and closes them the way a real one at rest does — slowly, through a small
        // angle, about a spread it holds. This matters more than it sounds: the item's headline
        // is a creature that appears every ~9 seconds, so for eight of those nine the player is
        // looking at whatever this pin does on its own, and it used to do nothing but turn.
        //
        // `movingSpeed` is barely above the resting speed. A butterfly does not beat faster
        // because the person carrying it started walking, and the wings' crossfade would make
        // that literal if it were given a real value.
        flap: {
          amplitude: 0.11, speed: 0.34, spread: 0.3, sweep: 0.05,
          movingAmplitude: 0.17, movingSpeed: 0.62, movingSpread: 0.36, movingSweep: 0.08,
          // A quarter beat behind, at three quarters the throw — see MotionSpec.flap.secondaryLag.
          secondaryLag: 1.5,
          secondaryScale: 0.75,
        },
      },
      creature: {
        kind: 'butterfly',
        // 「偶爾出現一隻或兩隻小蝴蝶」. Down from 13 s and up from one alive, so a second can join
        // one that is already out — which is what makes the pair happen sometimes rather than
        // being a fixed formation.
        interval: 8.5,
        intervalJitter: 0.45,
        duration: [5.0, 7.5],
        orbitRadius: [0.42, 0.66],
        orbitHeight: 0.12,
        orbitSpeed: 0.22,
        // A 13 cm butterfly — big enough to read as a creature at gameplay camera distance,
        // small enough that it cannot hide the player's face as it passes.
        scale: 0.13,
        maxAlive: 2,
        trigger: 'always',
      },
      emit: [
        {
          // 「微弱發光」, and a deliberate walk-back of this item's old boast that it had NO
          // particles at all. That was a good line and it cost the item its idle: between visits
          // the clip was completely inert, which on an 史詩 card is the wrong kind of restraint.
          //
          // It is still the faintest emitter in the catalog — 0.5 opacity on a 2.5 cm mote, about
          // two alive — and it is scale rather than count that keeps it from becoming sparkles:
          // these read as the air around the butterfly, not as something it is shedding.
          shape: 'mote',
          colors: [COSMETIC_PALETTE.butterfly.glow, COSMETIC_PALETTE.flower.glow],
          interval: 2.3,
          intervalJitter: 0.5,
          count: [1, 2],
          lifetime: [2, 3],
          size: [0.024, 0.034],
          offset: [0, 0.01, 0],
          spread: 0.17,
          rise: 0.2,
          drift: 0.12,
          wobble: { amplitude: 0.05, speed: 0.45 },
          tumble: 0,
          opacity: 0.5,
          maxAlive: 4,
          trigger: 'always',
        },
      ],
    },
  },

  /**
   * 星軌之翼 — the flagship, and the answer to 「特殊飾品不夠有特色」.
   *
   * The other five are ORNAMENTS: small, above the shoulders, ambient, and all pitched at the
   * same volume, which is why no one of them can be the one you buy to be seen in. This one is
   * built the other way round on purpose, and every difference is deliberate:
   *
   *   IT IS BIG AND IT IS ON THE BACK.  A 0.34-local wing each side is a ~1.5-world-unit span
   *     on a 2.16-unit character, and the third-person camera looks at the back — so unlike a
   *     hairpin it is visible from the angle the game is actually played at.
   *   IT ANSWERS TO THE PLAYER.  `flap` reads the same movement flag the mushroom cap's spores
   *     do, but it drives the POSE rather than a rate: folded and barely breathing when still,
   *     spread and beating when walking. That is the difference between an effect the player
   *     watches and one the player feels they are driving.
   *   IT LEAVES SOMETHING BEHIND.  `settle` freezes each feather where it was shed, so walking
   *     draws a line of feathers hanging in the air behind you and standing still draws nothing.
   *   IT HAS A PEAK.  The jump burst is ten stars — five times any emitter's cap — and it is the
   *     only thing in the catalog that is ever allowed to be loud. It can be, because it happens
   *     at most once every 2.5 s and only when the player asks for it.
   *
   * Series starlight, so it bonds with 星星項圈 on the pet — the flagship and the cheapest pet
   * collar in the game are a matching set, which is the point of series being a key rather than
   * a label.
   */
  {
    itemId: 'fx-star-wings',
    series: 'starlight',
    socket: 'back',
    model: 'starWings',
    effect: {
      motion: {
        // Tuned around the TOP of the stroke rather than around the rest pose, which is the
        // whole lesson of this item: the numbers that look right on a standing character put
        // both wings behind the skull at the peak of the beat. So the lift is small (peaks at
        // +0.34 rad, which the fan is drawn to absorb) and the fore/aft sweep carries the rest.
        flap: {
          amplitude: 0.06, speed: 0.32, spread: 0, sweep: 0.04,
          movingAmplitude: 0.2, movingSpeed: 1.6, movingSpread: 0.14, movingSweep: 0.2,
        },
        // A few millimetres of float on top, so the wings never sit perfectly dead even at rest.
        bob: { amplitude: 0.008, speed: 0.45 },
        parts: [
          // Three motes riding the spine on their own orbits. The beat almost stops when the
          // player stands still — that is the whole design of `flap` — so this is what the item
          // has left at rest, and it is also what it has in the dressing room, which is where the
          // 1600-coin decision actually gets made.
          { tag: 'orbit', spin: { axis: 'y', speed: 0.46 }, stagger: 0.333 },
        ],
      },
      emit: [
        {
          // THE TRAIL. Faster than anything else in this file (1.4 s against 2–9 s), and that is
          // the one place the design budget is spent rather than saved: it emits NOTHING while
          // the player stands still, and each feather is a stationary marker rather than a mote
          // crossing the screen, so the on-screen count stays where the budget wants it (~1.8
          // alive at a walk, 4 hard cap).
          shape: 'feather',
          colors: [COSMETIC_PALETTE.starlight.body, COSMETIC_PALETTE.starlight.glow, COSMETIC_PALETTE.starlight.deep],
          interval: 0.98,
          intervalJitter: 0.45,
          count: [1, 2],
          lifetime: [2.5, 3.75],
          size: [0.036, 0.066],
          offset: [0, 0.06, -0.05],
          spread: 0.3,
          // Falls, and settles less than half way through its life: the last 55% is a feather
          // hanging still in the air, fading. That stillness is what makes it read as a trail.
          rise: -0.32,
          drift: 0.28,
          tumble: 1.4,
          settle: 0.45,
          opacity: 0.85,
          maxAlive: 9,
          trigger: 'moving',
        },
        {
          // Standing still is not nothing — one small star every ~4.5 s, so the wings idle the
          // way the rest of the catalog does. Without this the item is dead in the dressing room,
          // which is where the player decides whether to buy it.
          shape: 'star',
          colors: [COSMETIC_PALETTE.starlight.glow, COSMETIC_PALETTE.starlight.body],
          interval: 1.89,
          intervalJitter: 0.5,
          count: [1, 2],
          lifetime: [2.75, 4],
          size: [0.026, 0.05],
          offset: [0, 0.12, -0.04],
          spread: 0.26,
          rise: 0.3,
          drift: 0.16,
          wobble: { amplitude: 0.05, speed: 0.5 },
          tumble: 0.5,
          opacity: 0.8,
          maxAlive: 5,
          trigger: 'always',
          rare: { chance: 0.12, size: 1.75, lifetime: 1.3, opacity: 0.9, colors: [COSMETIC_PALETTE.starlight.glow] },
        },
        {
          // THE HAZE THE FEATHERS FALL THROUGH. Very faint motes with almost no travel, sitting
          // in the span of the wings rather than leaving it — `spread` 0.5 is roughly the whole
          // wingspan, so these fill the shape instead of trailing off it.
          //
          // This is the layer that reads as the wings being made of light. The feather trail says
          // where the player has been and the jump burst says what they just did; nothing said
          // what the wings ARE while they simply hang there.
          shape: 'mote',
          colors: [COSMETIC_PALETTE.starlight.glow, COSMETIC_PALETTE.starlight.body],
          interval: 1.5,
          intervalJitter: 0.5,
          count: [1, 2],
          lifetime: [1.8, 2.8],
          size: [0.024, 0.036],
          offset: [0, 0.04, -0.04],
          spread: 0.5,
          rise: 0.12,
          drift: 0.06,
          wobble: { amplitude: 0.04, speed: 0.45 },
          tumble: 0,
          opacity: 0.55,
          maxAlive: 6,
          trigger: 'always',
        },
      ],
      burst: {
        on: 'jump',
        shape: 'star',
        colors: [COSMETIC_PALETTE.starlight.glow, COSMETIC_PALETTE.starlight.body, COSMETIC_PALETTE.starlight.deep],
        count: 16,
        lifetime: [1.38, 2.25],
        size: [0.03, 0.066],
        offset: [0, 0.06, -0.04],
        spread: 0.3,
        rise: 0.42,
        // The stars now ARC rather than rising forever: thrown up and out on take-off, turning
        // over and falling as the player comes down. It costs one multiply per particle and it is
        // the difference between a burst that happened TO the player and one they threw.
        gravity: 0.4,
        drift: 0.55,
        tumble: 1.6,
        // Settles early: the stars fly out fast, stop, and hang for the second half of their
        // life. A burst that is still expanding when it fades reads as a puff of smoke.
        settle: 0.5,
        opacity: 0.85,
        cooldown: 2.5,
      },
    },
  },

  /**
   * 精靈光環 — the first cosmetic that changes the SCENE rather than adding to it.
   *
   * Every other item in this catalog is something you can see. This one is something that lets
   * you see: after dark it carries a real point light, so the grass under the player's feet and
   * the wall they are standing next to are genuinely lit by it. That is a different KIND of
   * special from anything above, which is why it is worth the one effect in the system whose
   * cost is paid by the whole scene (see {@link GlowSpec}).
   *
   * Three consequences of that, all deliberate:
   *
   *   IT IS A NIGHT ITEM, AND IT SAYS SO. `trigger: 'night'` on both the light and the ripple.
   *     A 1.6 point light against the island's midday exposure is invisible, and the honest
   *     response to "you cannot see it anyway" is not to pay for it.
   *   IT IS STILL ALIVE BY DAY. The ring turns and breathes, and the always-on mote emitter
   *     keeps it from being a dead prop in the dressing room — which is where the player
   *     decides whether to buy something they will mostly wear at night.
   *   ITS RIPPLE IS AT HEAD HEIGHT, NOT AT THE FEET. The obvious reading of "aura" is a circle
   *     on the ground, and the ground on this island is not flat: any ring lying in the ground
   *     plane cuts into the uphill side of every slope. At halo height there is nothing to
   *     intersect, and the ripple still reads as coming off the wearer.
   */
  {
    itemId: 'fx-spirit-halo',
    series: 'starlight',
    socket: 'halo',
    model: 'spiritHalo',
    effect: {
      motion: {
        // A horizontal ring is invariant under a Y spin, so this rotation is invisible on the
        // ring itself and shows entirely on the three motes riding it — which is exactly the
        // read wanted: the halo hangs still and the lights travel around it.
        spin: { axis: 'y', speed: 0.28 },
        bob: { amplitude: 0.018, speed: 0.5 },
        pulse: { amplitude: 0.04, speed: 0.8 },
        parts: [
          // The three crystals outside the ring, turning SLOWER than the halo itself (0.4 against
          // 0.28 — near, but not a ratio). Two independent rates on one ornament is what the
          // motes riding the ring could never give: they share the halo's rotation by
          // construction, so however fast it turned there was only ever one speed on screen.
          { tag: 'orbit', spin: { axis: 'y', speed: 0.4 }, stagger: 0.333 },
          // The upright ring, turning about a different axis again. This is the part that makes
          // the halo's own rotation VISIBLE — a horizontal torus spun about Y is identical every
          // frame, which is the trap recorded on the model.
          { tag: 'ring2', spin: { axis: 'z', speed: 0.52 } },
        ],
      },
      emit: [
        {
          // THE RIPPLE. One ring every ~6 s, expanding to 3.2x and gone — the only particle in
          // the game that is a wave rather than an object.
          shape: 'ring',
          // The pure white only. This is meant to be a pulse of LIGHT, and the body tint is
          // warm enough that at the alpha a ring is drawn with it composites to grey.
          colors: [COSMETIC_PALETTE.starlight.glow],
          interval: 2.52,
          intervalJitter: 0.35,
          count: [1, 2],
          lifetime: [2, 2.75],
          // Starts INSIDE the halo and ends well outside it — 0.09 growing sevenfold is a ring
          // that finishes at ~0.6 world radius against the halo model's own 0.43. The first
          // tuning grew 0.13 to 0.42 and finished at exactly the halo's radius, which does not
          // read as a wave leaving the ring: it reads as a second ring appearing beside it.
          // A ripple has to end up somewhere the thing that made it is not.
          //
          // Larger than the 0.09 the rest of the catalog is capped at, and allowed to be: that
          // ceiling is about not occluding a face, and a ring is 22% material and 78% hole.
          size: [0.08, 0.1],
          grow: 7,
          offset: [0, 0, 0],
          spread: 0.02,
          rise: 0.05,
          drift: 0,
          tumble: 0,
          opacity: 0.95,
          maxAlive: 5,
          trigger: 'night',
        },
        {
          // Daytime life. Small, slow, and the reason the item is not a dead prop in the shop.
          shape: 'mote',
          colors: [COSMETIC_PALETTE.starlight.glow, COSMETIC_PALETTE.starlight.body],
          interval: 1.51,
          intervalJitter: 0.5,
          count: [1, 3],
          lifetime: [2.5, 3.75],
          size: [0.024, 0.045],
          offset: [0, 0.01, 0],
          spread: 0.22,
          rise: 0.22,
          drift: 0.1,
          wobble: { amplitude: 0.04, speed: 0.4 },
          tumble: 0,
          opacity: 0.8,
          maxAlive: 8,
          trigger: 'always',
          rare: { chance: 0.1, size: 1.8, lifetime: 1.35, opacity: 0.95 },
        },
        {
          // STAR SHARDS, thrown outward on a slow orbit rather than drifting straight. The motes
          // above are the halo's light; these are its SUBSTANCE, and having both is what keeps
          // the most expensive item on the shelf from being a ring with a lamp in it.
          shape: 'star',
          colors: [COSMETIC_PALETTE.starlight.glow, COSMETIC_PALETTE.starlight.body],
          interval: 2.3,
          intervalJitter: 0.45,
          count: [1, 2],
          lifetime: [2.6, 3.8],
          size: [0.026, 0.044],
          offset: [0, -0.02, 0],
          spread: 0.1,
          rise: 0.18,
          drift: 0.24,
          // Two thirds of a lap over a life: they leave the halo on a curve rather than radially,
          // which is what makes them read as having been carried by it.
          orbit: 0.66,
          tumble: 0.6,
          opacity: 0.8,
          maxAlive: 5,
          trigger: 'always',
        },
        {
          // The haze, at night only. It grows to twice its size and fades, sitting in the same
          // volume the point light is already lighting — so on a dark island the halo has a soft
          // body around it rather than being a hard ring with a pool of light under it.
          shape: 'wisp',
          colors: [COSMETIC_PALETTE.starlight.glow],
          interval: 2.6,
          intervalJitter: 0.4,
          count: [1, 1],
          lifetime: [2.4, 3.4],
          size: [0.05, 0.08],
          grow: 2.2,
          offset: [0, -0.02, 0],
          spread: 0.16,
          rise: 0.1,
          drift: 0.08,
          tumble: 0,
          opacity: 0.5,
          maxAlive: 3,
          trigger: 'night',
        },
      ],
      glow: {
        color: COSMETIC_PALETTE.starlight.glow,
        // MEASURED, not reasoned: three 0.184 has no legacy light mode, so intensity is candela
        // and irradiance is intensity/d^decay — a number that means nothing until it is put in
        // the scene it has to light. Rendered at 1.7 / 6 / 14 / 30 / 60 against the island's
        // midnight ambient (~0.22): below ~6 nothing on the ground changes at all, and by 30 the
        // pool has washed out and the character's own highlights are blowing out. 16 is a clear
        // circle of light the wearer stands in, which is the whole brief for this item.
        //
        // The interior's follow-light reads 2.2 for a much bigger effect only because it uses
        // decay 1.3 — the exponent, not the intensity, is what makes those two numbers
        // incomparable. Do not copy one to the other.
        intensity: 16,
        distance: 5.5,
        pulse: { amplitude: 0.12, speed: 0.55 },
        // Just under the ring, and the size of this number is a HARD constraint rather than a
        // preference: a point light must stay OUTSIDE the head. The first pass hung it 0.5
        // world units below the halo, reasoning that head height would light the face — which
        // put it inside a 0.585-radius skull sphere, where it lit the inside of the head and
        // nothing else at all. -0.2 keeps it clear of the crown while still being low enough
        // to pool light on the ground the wearer is standing on.
        offset: [0, -0.2, 0],
        trigger: 'night',
      },
    },
  },

  /**
   * 小雨雲 — the joke everyone knows, and the reason it is here is that everyone knows it.
   *
   * The three series added in this batch exist to fill the OTHER half of the bond table (see
   * SERIES_BONDS): starlight, forest and flower were the only families with both a player item
   * and a pet item, so they were the only ones that could ever fire. Cloud, ocean and music were
   * declared in the type and the palette from the start and had never had a single product.
   *
   * This one uses the halo socket for something that is not a halo, which is the point of a
   * socket being a PLACE rather than a slot named after one item.
   */
  {
    itemId: 'fx-rain-cloud',
    series: 'cloud',
    socket: 'halo',
    model: 'rainCloud',
    effect: {
      motion: {
        bob: { amplitude: 0.022, speed: 0.42 },
        sway: { axis: 'z', amplitude: 0.05, speed: 0.33 },
        pulse: { amplitude: 0.045, speed: 0.5 },
        parts: [
          // The two little clouds, drifting round the big one in opposition. Very slow — 0.16
          // rad/s is a lap every forty seconds, which is weather rather than machinery.
          { tag: 'sat', spin: { axis: 'y', speed: 0.16 }, stagger: 0.5 },
          // The bolt breathes instead of flashing. 「非常微弱」 in the brief, and a real flash on
          // a cosy island is a jump-scare — this is the largest amount of "lightning" the item is
          // allowed to have.
          { tag: 'bolt', pulse: { amplitude: 0.16, speed: 1.5 } },
        ],
      },
      emit: [
        {
          // Rain, and it SETTLES: a drop falls the height of the character and then stops and
          // fades where it landed, instead of sinking through the island. That is the same
          // trick the wings' feather trail uses, doing a completely different job — here it is
          // standing in for a splash the system has no way to draw.
          // A REAL DROP now, not a bubble. `drop` is fixed-orientation (SHAPE_FLAT), so every one
          // of these falls point-first instead of tumbling — which is what a bubble standing in
          // for rain could never do, and what made the old shower read as a stream of beads.
          shape: 'drop',
          colors: [COSMETIC_PALETTE.bubble.body, COSMETIC_PALETTE.cloud.glow],
          interval: 0.58,
          intervalJitter: 0.4,
          count: [1, 2],
          lifetime: [1.75, 2.38],
          size: [0.026, 0.044],
          offset: [0, -0.06, 0],
          spread: 0.3,
          // The only strongly negative rise in the catalog: 1.5 world units is roughly head to
          // ground on this character, so a drop really does fall the length of them.
          rise: -1.5,
          drift: 0.05,
          tumble: 0,
          settle: 0.82,
          opacity: 0.8,
          maxAlive: 8,
          trigger: 'always',
          // 「偶爾下幾滴小雨 → 雨滴消失 → 雲朵恢復。不要一直下雨。」
          //
          // This is the requirement the whole `cadence` field was added for, and it is worth being
          // precise about why nothing already in the file could express it. Every other rate
          // control adjusts how OFTEN a burst fires, so at any setting the result is a steady
          // drizzle of some density — the cloud is always raining, just more or less. A shower has
          // a beginning and an end. ~2.6 s of rain then ~5.5 s of nothing, both jittered by 40%,
          // so it never arrives on a timetable.
          cadence: { on: 2.6, off: 5.5, jitter: 0.4 },
          rare: { chance: 0.12, size: 1.6, lifetime: 1.15 },
        },
        {
          // 「雲霧」. Faint wisps sinking out of the cloud's underside and spreading — the thing
          // that makes the gap between showers still look like weather. It runs when the rain does
          // not, which is most of the time, so the item is never actually idle.
          shape: 'wisp',
          colors: [COSMETIC_PALETTE.cloud.glow, COSMETIC_PALETTE.cloud.deep],
          interval: 2.3,
          intervalJitter: 0.45,
          count: [1, 1],
          lifetime: [2.6, 3.8],
          size: [0.05, 0.078],
          grow: 1.9,
          offset: [0, -0.1, 0],
          spread: 0.26,
          rise: -0.14,
          drift: 0.1,
          tumble: 0,
          opacity: 0.5,
          maxAlive: 3,
          trigger: 'always',
        },
      ],
    },
  },

  /**
   * 潮汐吊墜 — the second item to use the ring shape, which is why it is worth having.
   *
   * A shape that only one cosmetic can use is a special case wearing a general shape's clothes.
   * The halo's ripple expands at head height in the dark; this one expands at CHEST height in
   * daylight, off a pendant, at a different rate and colour — same pooled geometry, same update,
   * and between the two the shape has to actually be general.
   */
  {
    itemId: 'fx-tide-pendant',
    series: 'ocean',
    socket: 'pendant',
    model: 'tidePendant',
    effect: {
      motion: {
        sway: { axis: 'z', amplitude: 0.11, speed: 0.7 },
        pulse: { amplitude: 0.05, speed: 0.9 },
        parts: [
          // The two weed strands, out of phase and slower than the pendant's own swing. A charm
          // whose loose parts move at the SAME rate as the charm is a charm with no loose parts —
          // everything travels together and the whole thing reads as one solid moulding.
          { tag: 'weed', sway: { axis: 'z', amplitude: 0.3, speed: 0.47 }, stagger: 0.5 },
        ],
      },
      emit: [
        {
          shape: 'ring',
          colors: [COSMETIC_PALETTE.ocean.glow],
          interval: 1.89,
          intervalJitter: 0.4,
          count: [1, 2],
          lifetime: [1.88, 2.5],
          size: [0.05, 0.07],
          grow: 5,
          offset: [0, 0, 0.02],
          spread: 0.01,
          rise: 0.12,
          drift: 0,
          tumble: 0,
          opacity: 0.8,
          maxAlive: 5,
          trigger: 'always',
          // One wave in eight is a bigger one that travels further. Tides are not uniform, and a
          // ripple emitter where every ring is identical is the one place in this catalog where
          // the machinery would otherwise be visible — every other shape has a random tumble to
          // hide behind and a ring, being SHAPE_FLAT, has none.
          rare: { chance: 0.13, size: 1.45, lifetime: 1.3, grow: 6.5, opacity: 0.7 },
        },
        {
          shape: 'bubble',
          colors: [COSMETIC_PALETTE.ocean.body, COSMETIC_PALETTE.ocean.glow],
          interval: 2.31,
          intervalJitter: 0.5,
          count: [1, 3],
          lifetime: [2.5, 3.5],
          size: [0.024, 0.045],
          offset: [0, 0.02, 0.02],
          spread: 0.05,
          rise: 0.4,
          drift: 0.08,
          wobble: { amplitude: 0.05, speed: 0.55 },
          tumble: 0.2,
          opacity: 0.8,
          maxAlive: 5,
          trigger: 'always',
        },
        {
          // 「小水滴繞著吊墜運動」 — literally. `orbit` turns the horizontal travel into a circle,
          // so these do not leave the pendant, they go AROUND it and fade. The ripples say the
          // charm is pushing water outward; these say it is holding some.
          shape: 'drop',
          colors: [COSMETIC_PALETTE.ocean.glow, COSMETIC_PALETTE.ocean.body],
          interval: 1.5,
          intervalJitter: 0.45,
          count: [1, 1],
          lifetime: [2.4, 3.4],
          size: [0.026, 0.04],
          offset: [0, 0.01, 0.02],
          spread: 0.03,
          rise: 0.1,
          drift: 0.17,
          orbit: 0.85,
          tumble: 0,
          opacity: 0.85,
          maxAlive: 4,
          trigger: 'always',
        },
      ],
    },
  },

  /**
   * 音樂盒吊飾 — plays only while you walk, and leaves the notes behind you.
   *
   * A music box is wound by movement, so the emitter is gated on it: standing still this item is
   * completely silent, which is both the truthful behaviour and the reason it can afford a much
   * shorter interval than anything ambient. The notes SETTLE, so a walk leaves a line of them
   * hanging in the air along the path — the same mechanism as the wings' feathers, and the
   * clearest evidence that these capabilities are general rather than one-item features.
   */
  {
    itemId: 'fx-musicbox-charm',
    series: 'music',
    socket: 'pendant',
    model: 'musicBox',
    effect: {
      motion: {
        // THE BOX ITSELF NO LONGER SPINS, and that is the correction this pass is proudest of.
        // The old row turned the whole ornament about Y at 0.5 rad/s to suggest a crank turning.
        // What that actually draws is a pendant rotating on its cord — a bauble. A music box is a
        // MECHANISM: the case hangs still and the works move inside it, which is only expressible
        // now that sub-parts can be driven (see PartMotionSpec).
        sway: { axis: 'x', amplitude: 0.04, speed: 1.1 },
        parts: [
          // The pinned barrel. Its axis is X (the cylinder is laid across the box), and the four
          // pins on its surface are what make the rotation visible — a smooth cylinder turning
          // about its own axis is invariant, the same trap the halo's flat ring records.
          { tag: 'barrel', spin: { axis: 'x', speed: 1.15 } },
          // The two gears on the face, turning the other way and slower, half a cycle apart.
          { tag: 'gear', spin: { axis: 'z', speed: -0.85 }, stagger: 0.5 },
          { tag: 'ribbon', sway: { axis: 'z', amplitude: 0.24, speed: 0.75 } },
        ],
      },
      emit: [
        {
          shape: 'note',
          colors: [COSMETIC_PALETTE.music.body, COSMETIC_PALETTE.music.glow, COSMETIC_PALETTE.music.deep],
          interval: 0.91,
          intervalJitter: 0.5,
          count: [1, 2],
          lifetime: [2.75, 3.75],
          size: [0.042, 0.066],
          offset: [0, 0.06, 0],
          spread: 0.12,
          rise: 0.5,
          drift: 0.24,
          // 「向上漂浮 → 左右輕微擺動 → 淡出」, and the middle clause is this line. Before it the
          // notes went up a straight ramp; a note that does not waver is a note on a rail.
          wobble: { amplitude: 0.09, speed: 0.5 },
          // Very low: a note has an up and a down, and a fast tumble turns it into a smudge.
          // It is not SHAPE_FLAT because a note frozen square to the camera looks printed.
          tumble: 0.35,
          settle: 0.55,
          opacity: 0.85,
          maxAlive: 10,
          trigger: 'moving',
          // A whole note among the quavers, now and then. 1.35 rather than 1.7 for the size-budget
          // reason recorded on the star hairpin — a note is a tall thin glyph and 0.112 world was
          // a 22 cm quaver hanging at chest height. `npm run audit:cosmetics` is what pinned the
          // final value: at 1.45 it came out at 0.096 against the 0.09 solid ceiling, which is the
          // kind of two-thousandths overshoot nobody catches by looking at a render.
          rare: { chance: 0.12, size: 1.35, lifetime: 1.25, opacity: 0.95 },
        },
        {
          // 「小星星」. Sparse, always on, and the reason this item is no longer completely dead
          // standing still — which mattered because the whole point of it is that it plays only
          // when you walk, and an item that is nothing at all on the shop stand does not get
          // bought for what it does when you leave.
          shape: 'star',
          colors: [COSMETIC_PALETTE.music.glow, COSMETIC_PALETTE.starlight.body],
          interval: 2.5,
          intervalJitter: 0.45,
          count: [1, 1],
          lifetime: [2.4, 3.4],
          size: [0.024, 0.04],
          offset: [0, 0.05, 0.01],
          spread: 0.12,
          rise: 0.28,
          drift: 0.12,
          wobble: { amplitude: 0.04, speed: 0.45 },
          tumble: 0.4,
          opacity: 0.7,
          maxAlive: 3,
          trigger: 'always',
        },
        {
          // 「小光點」 riding with the notes and settling with them, so the trail left along a walk
          // is a line of notes IN something rather than a line of notes in empty air.
          shape: 'mote',
          colors: [COSMETIC_PALETTE.music.glow, COSMETIC_PALETTE.music.body],
          interval: 0.85,
          intervalJitter: 0.5,
          count: [1, 2],
          lifetime: [1.8, 2.6],
          size: [0.024, 0.034],
          offset: [0, 0.05, 0],
          spread: 0.18,
          rise: 0.32,
          drift: 0.16,
          tumble: 0,
          settle: 0.5,
          opacity: 0.6,
          maxAlive: 6,
          trigger: 'moving',
        },
      ],
    },
  },

  /**
   * 海洋腳環 — the first cosmetic on the legs, and the cheapest kind of pair there is.
   *
   * One catalog row, two anklets: the ankle slot is rendered by the LEG, so both legs mount it
   * and each swings with the joint it is on. Nothing here says "pair" and nothing had to — the
   * walk cycle already moves the two legs separately, so they are out of step for free. Compare
   * the wings, where a pair had to be built and driven by hand because both halves hang off one
   * socket on the back.
   *
   * Its bubbles are gated on movement and rise from ankle height, so they read as coming off the
   * feet of someone walking through shallow water.
   */
  {
    itemId: 'fx-ocean-anklet',
    series: 'ocean',
    socket: 'ankle',
    model: 'oceanAnklet',
    effect: {
      motion: {
        // Tiny. This is already being swung through a walk cycle by the leg it is on, and any
        // more than a few degrees on top reads as the band being loose rather than as it moving.
        sway: { axis: 'x', amplitude: 0.06, speed: 1.6 },
        parts: [
          // The two hanging shells, in opposition. This is the one item in the catalog where a
          // part animation is nearly free to look right: the config is one row, both legs render
          // it, and the walk cycle already drives the two legs separately — so four shells end up
          // swinging on four different phases without anything counting them.
          { tag: 'dangle', sway: { axis: 'z', amplitude: 0.32, speed: 1.25 }, stagger: 0.5 },
        ],
      },
      emit: [
        {
          // Now ALWAYS on, at a long interval, with `movingScale` cutting it by more than half
          // when the player walks. The old row was gated on movement, which made a 820-coin item
          // completely inert on the shop stand and in the dressing room — the two places where it
          // has to earn the price.
          shape: 'bubble',
          colors: [COSMETIC_PALETTE.ocean.glow, COSMETIC_PALETTE.ocean.body],
          interval: 2.4,
          intervalJitter: 0.5,
          count: [1, 2],
          lifetime: [1.75, 2.63],
          size: [0.024, 0.045],
          offset: [0, 0.02, 0],
          spread: 0.1,
          rise: 0.42,
          drift: 0.1,
          wobble: { amplitude: 0.04, speed: 0.6 },
          tumble: 0.2,
          opacity: 0.8,
          maxAlive: 6,
          trigger: 'always',
          movingScale: 0.42,
        },
        {
          // THE SPLASH. Thrown up off the foot and falling straight back — `gravity` plus an
          // early `settle`, so a drop's whole life is: leave the ankle, arc, land, stop, fade.
          // That arc is what says the foot hit something wet; bubbles rising from an ankle only
          // ever said the ankle was underwater.
          shape: 'drop',
          colors: [COSMETIC_PALETTE.ocean.glow, COSMETIC_PALETTE.bubble.glow],
          interval: 1.15,
          intervalJitter: 0.5,
          count: [1, 2],
          lifetime: [0.95, 1.5],
          size: [0.024, 0.04],
          offset: [0, 0.01, 0],
          spread: 0.1,
          rise: 0.24,
          gravity: 0.55,
          drift: 0.14,
          tumble: 0,
          settle: 0.8,
          opacity: 0.85,
          maxAlive: 6,
          trigger: 'moving',
        },
        {
          // 「微型水花」 — a tiny ripple left at the foot, expanding four times and gone. Lying in
          // the ground plane because `ring` is SHAPE_FLAT, so it reads as a mark ON the ground
          // rather than as a hoop beside the leg.
          shape: 'ring',
          colors: [COSMETIC_PALETTE.ocean.glow],
          interval: 2.2,
          intervalJitter: 0.4,
          count: [1, 1],
          lifetime: [1.1, 1.7],
          size: [0.03, 0.045],
          grow: 4,
          offset: [0, -0.05, 0],
          spread: 0.05,
          rise: 0.02,
          drift: 0,
          tumble: 0,
          opacity: 0.6,
          maxAlive: 3,
          trigger: 'moving',
        },
        {
          // 「如果角色在游泳，可以稍微強化水元素效果」 — a second bubble emitter, gated on the swim
          // flag, running four times as often and half as big again.
          //
          // A separate emitter rather than a multiplier on the one above, because the two want
          // different NUMBERS and not just a different rate: under water the bubbles are faster,
          // bigger and go straight up. Nothing here touches the swim pose — an emitter cannot,
          // since it only ever reads the body's world position — which is the explicit "不要影響
          // 游泳動畫" of the brief satisfied by construction rather than by care.
          shape: 'bubble',
          colors: [COSMETIC_PALETTE.bubble.glow, COSMETIC_PALETTE.ocean.glow],
          interval: 0.75,
          intervalJitter: 0.5,
          count: [1, 3],
          lifetime: [1.4, 2.2],
          size: [0.028, 0.055],
          offset: [0, 0.02, 0],
          spread: 0.14,
          rise: 0.75,
          drift: 0.08,
          wobble: { amplitude: 0.05, speed: 0.8 },
          tumble: 0.2,
          opacity: 0.8,
          maxAlive: 8,
          trigger: 'swimming',
        },
      ],
    },
  },

  /**
   * 花環足跡 — a ring of moss and blooms lying on the GROUND, and the item the aura socket was
   * built for.
   *
   * ---------------------------------------------------------------------------
   * WHY THIS ONE EXISTS
   * ---------------------------------------------------------------------------
   *
   * Two jobs, and it is worth being explicit that they are two:
   *
   *   IT PROVES THE GROUND SOCKET. Everything else in this file is worn on a body and inherits
   *   the body's transform. This is the first cosmetic that belongs to the floor, so it is the
   *   first that has to REFUSE the body's transform and follow the terrain instead — see
   *   {@link GroundSpec}. A ring is also the shape that makes the conforming visible: a ring
   *   cutting into a hillside is unmistakable, which is exactly why it is the right thing to
   *   ship the capability with rather than something forgiving.
   *
   *   IT REVIVES THE FLOWER BOND. flower had two pet items and no player item, so its bond could
   *   never fire (see the note in SERIES_BONDS). This is the player half it was missing, and
   *   with it the table goes from five producible pairs to six.
   *
   * Petals only while moving, so standing still this is a quiet circle of flowers and walking
   * scatters them — the same `moving` gate the mushroom cap and the flower collar use, which is
   * what makes the three read as one series doing one thing.
   */
  {
    itemId: 'fx-bloom-circle',
    series: 'flower',
    socket: 'aura',
    model: 'bloomCircle',
    effect: {
      ground: {
        // The model's local radius 0.32 at the character root's 2.25x — see the world-units
        // note on GroundSpec.radius, which this got wrong once.
        radius: 0.72,
        // 3 cm. Enough to clear z-fighting against the terrain on a slope, small enough that the
        // ring never reads as hovering.
        lift: 0.03,
        // ~23 degrees. Past that the island is a cliff rather than a hill, and a ring standing
        // up at 40 degrees looks like a wheel — floating flat is the better failure.
        maxTilt: 0.4,
      },
      motion: {
        // Slow enough to be a drift rather than a spin, and it is the only WHOLE-RING motion
        // here: a `bob` would fight the ground for position.y, and the ground wins by
        // construction.
        spin: { axis: 'y', speed: 0.09 },
        parts: [
          // The three mushrooms, breathing. `bob` on a sub-part is safe where it is not on the
          // group: the ground spec owns the GROUP's y and overwrites it every frame, but a child
          // of that group is measured from wherever the group ended up, so the two cannot fight.
          { tag: 'shroom', bob: { amplitude: 0.004, speed: 0.55 }, stagger: 0.33 },
        ],
      },
      emit: [
        {
          shape: 'petal',
          colors: [COSMETIC_PALETTE.flower.body, COSMETIC_PALETTE.flower.glow, COSMETIC_PALETTE.flower.deep],
          interval: 0.77,
          intervalJitter: 0.5,
          count: [1, 2],
          lifetime: [2, 3],
          size: [0.03, 0.054],
          // Spawned at the ring's own height, out at its edge, so petals leave the CIRCLE rather
          // than the wearer's feet.
          offset: [0, 0.05, 0],
          // Roughly the ring's world diameter: petals appear ANYWHERE on the circle rather than
          // at its centre, which is what makes them look shed by the ring and not by the wearer.
          spread: 1.4,
          rise: 0.2,
          drift: 0.22,
          wobble: { amplitude: 0.06, speed: 0.5 },
          tumble: 1.6,
          settle: 0.5,
          opacity: 0.8,
          maxAlive: 9,
          trigger: 'moving',
        },
        {
          // THE FOOTPRINTS — 「玩家走過的地方留下短暫的花朵痕跡」, and the thing this item is
          // named after but did not previously do.
          //
          // Four fields together are the whole trick, and none of them is new machinery:
          //
          //   `spread` 0.24    — at the FEET, not out on the ring. The petals above are shed by
          //                      the circle; these are left by the walker.
          //   `settle` 0.05    — it stops travelling almost immediately, so it is a mark lying on
          //                      the ground rather than a petal drifting past it.
          //   `grow` 0.4       — 「縮小 → 淡出」. It ends at two fifths of the size it started, so
          //                      the bloom closes as it goes instead of only getting fainter. This
          //                      is the first use of a grow BELOW one, and it is the reason the
          //                      field is a multiplier rather than an "expand" flag.
          //   `interval` 0.78  — one flower roughly every three quarters of a second at a walk,
          //                      which at this character's pace is a mark every stride or so.
          //                      Written at 0.62 first, which is under the 0.75 s floor the
          //                      visibility pass fixed and `npm run audit:cosmetics` enforces —
          //                      and the floor is right: faster than this a trail stops being a
          //                      trail and becomes a carpet.
          shape: 'petal',
          colors: [COSMETIC_PALETTE.flower.glow, COSMETIC_PALETTE.flower.body, COSMETIC_PALETTE.forest.glow],
          interval: 0.78,
          intervalJitter: 0.35,
          count: [1, 1],
          lifetime: [2.4, 3.2],
          size: [0.05, 0.075],
          grow: 0.4,
          offset: [0, 0.015, 0],
          spread: 0.24,
          rise: 0.015,
          drift: 0.03,
          tumble: 0.25,
          settle: 0.05,
          opacity: 0.85,
          maxAlive: 7,
          trigger: 'moving',
        },
        {
          // Pollen over the ring, always. Standing still this item used to emit nothing at all —
          // correct for a trail, wrong for a circle of flowers you are standing in.
          shape: 'spore',
          colors: [COSMETIC_PALETTE.flower.heart, COSMETIC_PALETTE.forest.glow],
          interval: 1.9,
          intervalJitter: 0.5,
          count: [1, 2],
          lifetime: [2.4, 3.4],
          size: [0.024, 0.036],
          offset: [0, 0.08, 0],
          spread: 1.2,
          rise: 0.22,
          drift: 0.1,
          wobble: { amplitude: 0.06, speed: 0.4 },
          tumble: 0,
          opacity: 0.5,
          maxAlive: 5,
          trigger: 'always',
        },
      ],
    },
  },

  /**
   * 結霜光環 — the first cosmetic on this shelf that is not in any of the existing families.
   *
   * ---------------------------------------------------------------------------
   * WHY A NEW SERIES RATHER THAN A COLD STARLIGHT ITEM
   * ---------------------------------------------------------------------------
   *
   * It shares a socket with 精靈光環 and half a silhouette, so the temptation is to file it under
   * starlight as "the blue one". That would be wrong for a reason the bond table makes concrete:
   * a series is the KEY two cosmetics match on, so putting frost under starlight would mean a
   * player wearing this and a pet in a 星星項圈 fire a starlight bond — a burst of warm gold
   * between an ice halo and a star collar. A series that a player cannot predict from looking is
   * worse than an extra series.
   *
   * `frost` is therefore declared with no pet half, which is a legal state the SERIES_BONDS
   * assertion at the bottom of this file deliberately permits in one direction only: registering
   * a bond for a one-sided series throws; HAVING a one-sided series does not.
   *
   * ---------------------------------------------------------------------------
   * THE THREE LAYERS, AND WHICH REQUIREMENT EACH ONE ANSWERS
   * ---------------------------------------------------------------------------
   *
   *   SNOW falls, flutters, and is the one thing here anyone recognises instantly.
   *   CRYSTALS orbit rather than drift, so the halo has substance going round it and not just
   *     weather coming off it — and one in eight is 「較大的冰晶」 that SHRINKS as it fades
   *     (`rare.grow` below 1), which is how a crystal breaks apart without any shatter geometry.
   *   MIST is the wisp layer, and it is what stops the other two reading as two emitters in the
   *     same place. Fog between things is what makes them look like they are in the same air.
   */
  {
    itemId: 'fx-frost-halo',
    series: 'frost',
    socket: 'halo',
    model: 'frostHalo',
    effect: {
      motion: {
        // SLOWER than the spirit halo's 0.28, and unlike that one this rotation is VISIBLE on the
        // ring itself — the hoop carries six spikes, so it is not invariant under its own spin.
        // That is the whole structural difference between the two halos: one is a still ring that
        // things travel around, this one is a body that turns.
        spin: { axis: 'y', speed: 0.2 },
        bob: { amplitude: 0.015, speed: 0.45 },
        pulse: { amplitude: 0.035, speed: 0.7 },
        parts: [
          { tag: 'orbit', spin: { axis: 'y', speed: 0.38 }, stagger: 0.333 },
          // The spikes breathe very slightly, staggered round the ring so the pulse travels
          // rather than happening everywhere at once. 8% is under the threshold where it reads as
          // an animation at all; what it stops is ice looking like moulded plastic.
          { tag: 'spike', pulse: { amplitude: 0.08, speed: 0.9 }, stagger: 0.16 },
        ],
      },
      emit: [
        {
          shape: 'snow',
          colors: [COSMETIC_PALETTE.frost.glow, COSMETIC_PALETTE.frost.body],
          // 1.4 s, giving ~4 flakes alive. Measured rather than chosen: at 1.25 the three emitters
          // on this item summed to ~8.7 particles, which is the highest ambient total in the
          // catalog and a clear step above 精靈光環's 6.2 by day. Two legendaries on one shelf
          // should be comparably loud, and this one already has the busiest MODEL of the two.
          interval: 1.4,
          intervalJitter: 0.45,
          count: [1, 2],
          lifetime: [3, 4.4],
          size: [0.03, 0.05],
          offset: [0, -0.02, 0],
          spread: 0.28,
          rise: -0.55,
          drift: 0.16,
          // The largest wobble in the catalog, and the only one where the flutter IS the subject
          // rather than a correction to a straight line. A flake that falls plumb is a pixel.
          wobble: { amplitude: 0.1, speed: 0.38 },
          tumble: 0.4,
          opacity: 0.85,
          maxAlive: 7,
          trigger: 'always',
        },
        {
          shape: 'crystal',
          colors: [COSMETIC_PALETTE.frost.ice, COSMETIC_PALETTE.frost.glow],
          interval: 1.9,
          intervalJitter: 0.45,
          count: [1, 2],
          lifetime: [2.6, 3.8],
          size: [0.026, 0.042],
          offset: [0, 0, 0],
          spread: 0.14,
          rise: 0.1,
          drift: 0.22,
          orbit: 0.6,
          tumble: 0.6,
          opacity: 0.9,
          maxAlive: 5,
          trigger: 'always',
          // 「偶爾產生一個較大的冰晶，然後慢慢碎裂消失」. `grow: 0.25` is the shrink — it ends at a
          // quarter of the size it was drawn at, so the crystal dwindles while it fades instead of
          // simply going transparent at full size. A slower tumble too, because a big shard that
          // spins at the same rate as a chip has no weight.
          rare: { chance: 0.13, size: 2.4, lifetime: 1.45, grow: 0.25, tumble: 0.45, opacity: 0.95 },
        },
        {
          shape: 'wisp',
          colors: [COSMETIC_PALETTE.frost.glow, COSMETIC_PALETTE.frost.body],
          interval: 2.1,
          intervalJitter: 0.45,
          count: [1, 1],
          lifetime: [2.6, 3.6],
          size: [0.05, 0.08],
          grow: 2,
          offset: [0, -0.06, 0],
          spread: 0.22,
          rise: -0.12,
          drift: 0.12,
          tumble: 0,
          opacity: 0.5,
          maxAlive: 3,
          trigger: 'always',
        },
      ],
      glow: {
        color: COSMETIC_PALETTE.frost.body,
        // 14, and the two revisions this number went through are the whole of what "measured, not
        // reasoned" means for a light in this scene.
        //
        // It was written at 11 on the reasoning that frost should be a cold TINT rather than a
        // lamp, one clear step under the spirit halo's 16. Rendered side by side at the island's
        // midnight ambient, 16 puts a visible pool of light on the ground the wearer is standing
        // in and 11 puts nothing there at all — the character picked up a blue rim and the floor
        // was unchanged. That is not "quieter", it is the item's headline effect not happening,
        // and it is the same cliff the spirit halo's own note describes finding below ~6: the
        // response is not linear anywhere near the bottom of it.
        //
        // 14 is a real pool that is still visibly dimmer than the spirit halo's. The step between
        // two lights has to be measured in what lands on the FLOOR, not in the numbers.
        intensity: 14,
        distance: 5,
        pulse: { amplitude: 0.14, speed: 0.45 },
        // Same hard constraint as the spirit halo's: a point light must stay OUTSIDE the 0.585
        // skull sphere, or it lights the inside of the head and nothing else.
        offset: [0, -0.2, 0],
        trigger: 'night',
      },
    },
  },

  /**
   * 昆蟲之翼 — the second pair of wings, and deliberately the opposite build to the first.
   *
   * ---------------------------------------------------------------------------
   * TWO BACK ITEMS ON ONE SHELF ONLY WORKS IF THEY ARE DIFFERENT KINDS OF THING
   * ---------------------------------------------------------------------------
   *
   * 星軌之翼 is a FAN of opaque quills that opens when you walk, leaves feathers where you have
   * been, and bursts when you jump. Every one of those is about the player's MOVEMENT.
   *
   * This one is about the object. Four translucent membranes, a fine fast flutter that barely
   * changes between standing and walking, and a haze of luminous motes that is there whatever the
   * player is doing. Where the star wings are loudest at the moment of a jump, these are at their
   * best when the player is standing still and being looked at — which is the other half of what
   * a premium cosmetic is for, and the half the shelf did not have.
   *
   * Three specific differences, all in the numbers rather than in new machinery:
   *
   *   THE BEAT IS FAST AND SMALL.  3.4 Hz against the star wings' 1.6, at 0.3 rad against 0.2 —
   *     an insect's flutter, not a bird's stroke. And the resting speed is 0.9 rather than 0.32:
   *     these never really stop.
   *   FOUR WINGS, LAGGED.  `secondaryLag` puts the hind pair a quarter beat behind the fore pair.
   *     Two pairs beating together are one thick wing; the lag is the whole read.
   *   THE BURST IS SOFT.  The star wings throw sixteen hard stars that arc and fall. This throws
   *     fourteen motes that barely travel and hang — 「螢光」 rather than 「星屑」. Both are the
   *     one loud moment each item is allowed; they should not sound alike.
   */
  {
    itemId: 'fx-insect-wings',
    // Not a new series: 蝴蝶髮夾 is already butterfly, and the two make a matched pair a player can
    // wear a step apart in price. butterfly has no pet half and is therefore not in SERIES_BONDS,
    // which is legal — see the note on 結霜光環 above.
    series: 'butterfly',
    socket: 'back',
    model: 'insectWings',
    effect: {
      motion: {
        flap: {
          // Note how little the resting and moving poses differ compared with the star wings
          // (0.06→0.2 amplitude, 0.32→1.6 speed there). An insect's wings do not open BECAUSE it
          // started walking; they are already going. The crossfade still runs, it just has much
          // less to travel, which is what makes this pair read as alive rather than as responsive.
          amplitude: 0.12, speed: 0.95, spread: 0.08, sweep: 0.06,
          movingAmplitude: 0.3, movingSpeed: 3.4, movingSpread: 0.16, movingSweep: 0.22,
          secondaryLag: 1.55,
          secondaryScale: 0.7,
        },
        bob: { amplitude: 0.006, speed: 0.5 },
      },
      emit: [
        {
          // 「螢光粒子」. Always on, filling the span of the wings rather than trailing off them —
          // `spread` 0.55 is about the full wingspan, and `rise` is small, so these hang in the
          // wings instead of leaving.
          shape: 'mote',
          colors: [COSMETIC_PALETTE.butterfly.glow, COSMETIC_PALETTE.flower.glow, COSMETIC_PALETTE.butterfly.body],
          interval: 1.45,
          intervalJitter: 0.5,
          count: [1, 2],
          lifetime: [2.4, 3.6],
          size: [0.024, 0.038],
          offset: [0, 0.02, -0.04],
          spread: 0.55,
          rise: 0.16,
          drift: 0.12,
          wobble: { amplitude: 0.05, speed: 0.4 },
          tumble: 0,
          opacity: 0.72,
          maxAlive: 7,
          trigger: 'always',
          rare: { chance: 0.1, size: 1.8, lifetime: 1.3, opacity: 0.92 },
        },
        {
          // The moving trail. `spore` rather than `feather`: the star wings own the falling-quill
          // read and two items shedding the same shape from the same socket would be one item with
          // two skins. These are soft points of light that stop where they were dropped.
          shape: 'spore',
          colors: [COSMETIC_PALETTE.butterfly.glow, COSMETIC_PALETTE.butterfly.body],
          interval: 0.95,
          intervalJitter: 0.45,
          count: [1, 2],
          lifetime: [2.2, 3.2],
          size: [0.026, 0.042],
          offset: [0, 0.03, -0.05],
          spread: 0.34,
          rise: -0.12,
          drift: 0.2,
          settle: 0.42,
          tumble: 0,
          opacity: 0.7,
          maxAlive: 7,
          trigger: 'moving',
        },
      ],
      burst: {
        on: 'jump',
        shape: 'mote',
        colors: [COSMETIC_PALETTE.butterfly.glow, COSMETIC_PALETTE.flower.glow, COSMETIC_PALETTE.butterfly.deep],
        count: 14,
        lifetime: [1.5, 2.4],
        size: [0.026, 0.05],
        offset: [0, 0.04, -0.04],
        spread: 0.34,
        rise: 0.26,
        gravity: 0.18,
        drift: 0.4,
        tumble: 0.4,
        // Settles very early and then hangs for three quarters of its life. The star wings' burst
        // settles at half; this one is a cloud that stops and glows where the player left it,
        // rather than an explosion that expands and falls.
        settle: 0.28,
        opacity: 0.8,
        cooldown: 3,
      },
    },
  },

  // =========================================================================
  // PET — 「不要只是把玩家飾品縮小」
  // =========================================================================

  /**
   * 蝴蝶結 — swings with the dog's own bounce (the socket is on the head, which already
   * bobs), and lets go of a single heart every ~9 s.
   */
  {
    itemId: 'fx-pet-bow',
    series: 'flower',
    socket: 'petHead',
    model: 'petBow',
    effect: {
      motion: {
        sway: { axis: 'z', amplitude: 0.13, speed: 1.4 },
      },
      emit: [
        {
          shape: 'heart',
          colors: [COSMETIC_PALETTE.flower.body, COSMETIC_PALETTE.flower.glow],
          interval: 3.78,
          intervalJitter: 0.4,
          count: [1, 2],
          lifetime: [2.5, 3.5],
          size: [0.042, 0.06],
          offset: [0, 0.04, 0],
          spread: 0.05,
          rise: 0.34,
          drift: 0.08,
          tumble: 0.3,
          opacity: 0.8,
          maxAlive: 5,
          trigger: 'always',
        },
      ],
    },
  },

  /**
   * 蘑菇帽 — 「寵物移動時，偶爾留下少量孢子」, and explicitly not a permanent trail.
   *
   * `trigger: 'moving'` is the whole feature: standing still, this cosmetic emits nothing
   * at all. Spores fall the last few centimetres and fade in under two seconds, so nothing
   * is left on the ground behind the dog.
   */
  {
    itemId: 'fx-pet-mushroom',
    series: 'forest',
    socket: 'petHead',
    model: 'petMushroom',
    effect: {
      motion: {
        bob: { amplitude: 0.03, speed: 1.2 },
      },
      emit: [
        {
          shape: 'spore',
          colors: [COSMETIC_PALETTE.forest.glow, COSMETIC_PALETTE.cloud.body],
          interval: 1.01,
          intervalJitter: 0.5,
          count: [1, 3],
          lifetime: [1.5, 2.25],
          size: [0.024, 0.045],
          offset: [0, -0.02, -0.05],
          spread: 0.08,
          rise: -0.1,
          drift: 0.12,
          tumble: 0.4,
          opacity: 0.8,
          maxAlive: 7,
          trigger: 'moving',
        },
      ],
    },
  },

  /**
   * 小蜂巢背包 — a bee leaves the hive, circles the dog, and goes home.
   *
   * Tighter and faster than the butterfly's lap (0.4 m at 0.34 laps/s against 0.5 m at
   * 0.22) because a bee should read as busy where a butterfly reads as drifting. Same
   * spec type, two different characters — no second system.
   */
  {
    itemId: 'fx-pet-beehive',
    series: 'honey',
    socket: 'petBack',
    model: 'petBeehive',
    effect: {
      motion: {
        sway: { axis: 'x', amplitude: 0.04, speed: 0.7 },
      },
      creature: {
        kind: 'bee',
        interval: 11,
        intervalJitter: 0.4,
        duration: [4.0, 6.0],
        orbitRadius: [0.3, 0.45],
        orbitHeight: 0.16,
        orbitSpeed: 0.34,
        // Smaller than the butterfly, as a bee is.
        scale: 0.09,
        maxAlive: 1,
        trigger: 'always',
      },
    },
  },

  /**
   * 星星項圈 — 「星星繞一小圈後消失」.
   *
   * The only emitter in the set that sets `orbit`: its star spends `drift` going AROUND the
   * collar rather than away from it, three quarters of a lap before it fades. Same emitter
   * type as every other one here — one extra number, no extra code path at spawn time.
   */
  {
    itemId: 'fx-pet-star-collar',
    series: 'starlight',
    socket: 'petCollar',
    model: 'petStarCollar',
    effect: {
      motion: {
        // Sways rather than spins for the same reason the star hairpin does — and here a
        // full turn would also carry the charm round to the back of the dog's neck.
        sway: { axis: 'y', amplitude: 0.2, speed: 0.3 },
      },
      emit: [
        {
          shape: 'star',
          colors: [COSMETIC_PALETTE.starlight.body, COSMETIC_PALETTE.starlight.glow],
          interval: 2.52,
          intervalJitter: 0.45,
          count: [1, 2],
          lifetime: [3, 4],
          size: [0.036, 0.054],
          offset: [0, 0.06, 0],
          spread: 0.12,
          rise: 0.2,
          drift: 0.18,
          orbit: 0.75,
          tumble: 0.6,
          opacity: 0.8,
          maxAlive: 5,
          trigger: 'always',
        },
      ],
    },
  },

  /**
   * 花朵項圈 — petals dropped along the path while the dog trots, gone within two seconds.
   */
  {
    itemId: 'fx-pet-flower-collar',
    series: 'flower',
    socket: 'petCollar',
    model: 'petFlowerCollar',
    effect: {
      motion: {
        sway: { axis: 'x', amplitude: 0.05, speed: 1.1 },
      },
      emit: [
        {
          shape: 'petal',
          colors: [COSMETIC_PALETTE.flower.body, COSMETIC_PALETTE.flower.glow, COSMETIC_PALETTE.flower.deep],
          interval: 1.18,
          intervalJitter: 0.5,
          count: [1, 2],
          lifetime: [2, 3],
          size: [0.036, 0.054],
          offset: [0, -0.05, 0],
          spread: 0.1,
          rise: -0.22,
          drift: 0.14,
          tumble: 1.8,
          opacity: 0.8,
          maxAlive: 6,
          trigger: 'moving',
        },
      ],
    },
  },

  /**
   * 雲朵背包 — the pet half of the cloud series.
   *
   * On the BACK rather than the head, because the head already carries the bow and the mushroom
   * cap and a third hat is a third hat. The back is also where the cloud can be a volume rather
   * than a silhouette, which is the only way a low-poly cloud reads as fluffy.
   */
  {
    itemId: 'fx-pet-cloud-pack',
    series: 'cloud',
    socket: 'petBack',
    model: 'petCloudPack',
    effect: {
      motion: {
        bob: { amplitude: 0.05, speed: 0.9 },
        pulse: { amplitude: 0.05, speed: 0.7 },
      },
      emit: [
        {
          // Only when the animal runs, and they scatter UPWARD — a pet trailing a puff of cloud
          // as it goes. The player's cloud rains down; this one throws off vapour. Same series,
          // opposite direction, which is what keeps a matched pair from being one item twice.
          shape: 'spore',
          colors: [COSMETIC_PALETTE.cloud.glow, COSMETIC_PALETTE.cloud.body],
          interval: 1.12,
          intervalJitter: 0.5,
          count: [1, 3],
          lifetime: [1.5, 2.25],
          size: [0.024, 0.046],
          offset: [0, 0.05, -0.06],
          spread: 0.14,
          rise: 0.24,
          drift: 0.16,
          tumble: 0.4,
          settle: 0.5,
          opacity: 0.8,
          maxAlive: 6,
          trigger: 'moving',
        },
      ],
    },
  },

  /**
   * 貝殼項圈 — the pet half of the ocean series.
   */
  {
    itemId: 'fx-pet-shell-collar',
    series: 'ocean',
    socket: 'petCollar',
    model: 'petShellCollar',
    effect: {
      motion: {
        sway: { axis: 'z', amplitude: 0.1, speed: 1.2 },
      },
      emit: [
        {
          shape: 'bubble',
          colors: [COSMETIC_PALETTE.ocean.glow, COSMETIC_PALETTE.ocean.body],
          interval: 1.43,
          intervalJitter: 0.5,
          count: [1, 3],
          lifetime: [2.25, 3.25],
          size: [0.024, 0.048],
          offset: [0, -0.06, 0.06],
          spread: 0.08,
          rise: 0.4,
          drift: 0.1,
          tumble: 0.2,
          opacity: 0.8,
          maxAlive: 7,
          trigger: 'always',
        },
      ],
    },
  },

  /**
   * 鈴鐺項圈 — the pet half of the music series, and the most obvious pet item there is.
   *
   * Gated on movement for the reason a bell is: it rings because the animal moved. Standing
   * still it is a bell on a collar and nothing else, which is exactly right.
   */
  {
    itemId: 'fx-pet-bell-collar',
    series: 'music',
    socket: 'petCollar',
    model: 'petBellCollar',
    effect: {
      motion: {
        sway: { axis: 'x', amplitude: 0.16, speed: 2.2 },
      },
      emit: [
        {
          shape: 'note',
          colors: [COSMETIC_PALETTE.music.glow, COSMETIC_PALETTE.music.body],
          interval: 1.26,
          intervalJitter: 0.5,
          count: [1, 2],
          lifetime: [2, 2.75],
          size: [0.036, 0.054],
          offset: [0, -0.08, 0.08],
          spread: 0.1,
          rise: 0.42,
          drift: 0.18,
          tumble: 0.35,
          settle: 0.55,
          opacity: 0.85,
          maxAlive: 5,
          trigger: 'moving',
        },
      ],
    },
  },
];

const BY_ITEM_ID = new Map(SPECIAL_COSMETICS.map(def => [def.itemId, def]));

/**
 * The catalog and the shop must agree, and neither can enforce it alone.
 *
 * Two ways for them to drift, both silent at runtime and both caught here at module load:
 * a row whose item does not exist can never be equipped (so the cosmetic is unreachable),
 * and an item in one of the special categories with no row equips to nothing at all (so the
 * player buys an ornament and sees no ornament). The second is the one that would actually
 * ship — it looks like a rendering bug rather than a missing table entry.
 */
const SPECIAL_SHOP_CATEGORIES = ['SpecialFx', 'PetGear'];

const catalogProblems: string[] = [];
for (const def of SPECIAL_COSMETICS) {
  const item = ALL_ITEMS.find(i => i.id === def.itemId);
  if (!item) {
    catalogProblems.push(`${def.itemId} has no item in constants/items.ts, so it can never be equipped.`);
  } else if (!SPECIAL_SHOP_CATEGORIES.includes(item.shopCategory)) {
    catalogProblems.push(
      `${def.itemId} sits in shopCategory '${item.shopCategory}', which is not one of ` +
      `${SPECIAL_SHOP_CATEGORIES.join('/')} — it would share its single-select slot with ordinary wearables.`,
    );
  }
}
for (const item of ALL_ITEMS) {
  if (SPECIAL_SHOP_CATEGORIES.includes(item.shopCategory) && !BY_ITEM_ID.has(item.id)) {
    catalogProblems.push(`item ${item.id} (${item.name}) is sold as a special cosmetic but has no row here, so equipping it draws nothing.`);
  }
}
if (catalogProblems.length > 0) {
  throw new Error(`[cosmeticEffects] catalog is out of step with the shop:\n  - ${catalogProblems.join('\n  - ')}`);
}

/** The special-cosmetic row for an item id, or null for an ordinary item. */
export function getSpecialCosmetic(itemId: string): SpecialCosmeticDef | null {
  return BY_ITEM_ID.get(itemId) ?? null;
}

/**
 * Every special cosmetic in an equipped list, for one wearer.
 *
 * ID lookup, not name matching. The wardrobe resolver next door (Three/character/outfit.ts)
 * matches on substrings of Chinese item names because it predates item ids being stable;
 * that is a pattern to contain, not to copy — a cosmetic named 星星髮飾 and one named
 * 小星星髮飾 would both match `wearing('星星髮飾')`, and the wrong one would win.
 */
export function resolveSpecialCosmetics(
  equippedIds: readonly string[],
  wearer: CosmeticWearer,
): SpecialCosmeticDef[] {
  const out: SpecialCosmeticDef[] = [];
  for (const id of equippedIds) {
    const def = BY_ITEM_ID.get(id);
    if (def && SOCKET_WEARER[def.socket] === wearer) out.push(def);
  }
  return out;
}

// ---------------------------------------------------------------------------
// PLAYER ↔ PET BOND (section 四)
// ---------------------------------------------------------------------------

/**
 * What happens when the player and the pet wear the SAME SERIES and stand close.
 *
 * The constraints in the brief are all about restraint, so they are all encoded as numbers
 * rather than left to the implementation:
 *
 *   - it is not permanent — `cooldown` seconds must pass between firings, and the burst
 *     itself lives for `lifetime` and is gone;
 *   - it is not a lot — one larger particle in the gap between the two, plus `sideCount`
 *     small ones near each of them;
 *   - it needs them genuinely together — `radius` is 2.2 world units, roughly one dog's
 *     length past arm's reach, so walking past does not set it off.
 */
export interface SeriesBondSpec {
  shape: ParticleShape;
  colors: string[];
  /** Radius of the larger particle that appears BETWEEN the two. */
  centreSize: number;
  /** Radius of the small ones that appear beside each of them. */
  sideSize: number;
  sideCount: number;
  lifetime: number;
  rise: number;
  opacity: number;
}

/** How close the two must be for a bond to fire, world units. */
export const BOND_RADIUS = 2.2;
/** Minimum seconds between bond firings. Long on purpose — this is a moment, not an aura. */
export const BOND_COOLDOWN = 9;

/**
 * Only series that BOTH a player item and a pet item exist for can ever bond, so this table is
 * the shorter of the two lists by construction. It was three for as long as the catalog had only
 * three such families; cloud, ocean and music were declared in {@link CosmeticSeries} and given
 * palettes from the start and sat empty, so they could never fire. Filling in one player item
 * and one pet item each is what promoted them, and NOTHING in the runtime changed to allow it.
 *
 * A series with no entry here simply does not bond — that is a state, not a bug. bubble,
 * campfire, honey and butterfly are each still one-sided.
 */
export const SERIES_BONDS: Partial<Record<CosmeticSeries, SeriesBondSpec>> = {
  starlight: {
    shape: 'star',
    colors: [COSMETIC_PALETTE.starlight.glow, COSMETIC_PALETTE.starlight.body],
    centreSize: 0.1,
    sideSize: 0.04,
    sideCount: 2,
    lifetime: 2.6,
    rise: 0.3,
    opacity: 0.85,
  },
  forest: {
    shape: 'leaf',
    colors: [COSMETIC_PALETTE.forest.glow, COSMETIC_PALETTE.forest.body],
    centreSize: 0.08,
    sideSize: 0.04,
    sideCount: 2,
    lifetime: 2.8,
    rise: 0.22,
    opacity: 0.8,
  },
  // flower CAME BACK. It could never fire while its only products were 蝴蝶結 and 花朵項圈 —
  // both PET items — because a bond needs one visible PLAYER cosmetic and one visible PET
  // cosmetic of the same series (CosmeticRuntime.sharedSeries). 花環足跡 is the player half it
  // was missing, so the pair is now 花環足跡 ↔ 花朵項圈 (or 蝴蝶結), and this entry is producible.
  //
  // The assertion at the bottom of this file is what lets it be re-added safely: if the player
  // item is ever removed, the catalog throws at module load instead of quietly going back to
  // "the bond that looks implemented and never fires".
  flower: {
    shape: 'heart',
    colors: [COSMETIC_PALETTE.flower.glow, COSMETIC_PALETTE.flower.body],
    centreSize: 0.075,
    sideSize: 0.035,
    sideCount: 2,
    lifetime: 2.4,
    rise: 0.28,
    opacity: 0.8,
  },
  // The history, kept because it is the reason the assertion exists:
  //
  // The entry named its pair as 蝴蝶結 ↔ 花朵項圈 — and both of those are PET items. A bond needs
  // one visible PLAYER cosmetic and one visible PET cosmetic of the same series (see
  // CosmeticRuntime.sharedSeries), so a series whose only products are both on the pet has no
  // way to produce one. It sat in this table looking implemented for as long as the table
  // existed, and nothing failed: the check simply never found a match, which is indistinguishable
  // from two characters never standing close enough.
  //
  // That is why the assertion at the bottom of this file exists — it turns exactly this mistake
  // into a module-load Error instead of a bond nobody ever sees.
  cloud: {
    shape: 'spore',
    colors: [COSMETIC_PALETTE.cloud.glow, COSMETIC_PALETTE.cloud.body],
    // The largest centre particle of the six, because a spore is the softest shape in the set
    // and at the sizes the others use it simply is not seen.
    centreSize: 0.11,
    sideSize: 0.05,
    sideCount: 2,
    lifetime: 2.6,
    rise: 0.2,
    opacity: 0.7,
  },
  ocean: {
    // The one bond that is a RING, so the moment between an ocean player and an ocean pet is a
    // ripple passing between them rather than a third thing appearing there.
    shape: 'ring',
    colors: [COSMETIC_PALETTE.ocean.glow],
    centreSize: 0.14,
    sideSize: 0.06,
    sideCount: 1,
    lifetime: 1.8,
    rise: 0.12,
    opacity: 0.85,
  },
  music: {
    shape: 'note',
    colors: [COSMETIC_PALETTE.music.glow, COSMETIC_PALETTE.music.body],
    centreSize: 0.085,
    sideSize: 0.042,
    sideCount: 2,
    lifetime: 2.4,
    rise: 0.34,
    opacity: 0.85,
  },
};

// ---------------------------------------------------------------------------
// BOND INVARIANT
// ---------------------------------------------------------------------------

/**
 * A registered bond must be PRODUCIBLE: the series needs at least one player cosmetic and at
 * least one pet cosmetic, because that is exactly what CosmeticRuntime.sharedSeries looks for.
 *
 * This exists because the failure it catches is invisible. `flower` sat in SERIES_BONDS with a
 * comment naming its pair as 蝴蝶結 ↔ 花朵項圈 — both of which are PET items — so the check ran
 * forever and never matched. Nothing threw, nothing logged, and the symptom ("this series never
 * bonds") is the same thing you would see if the two characters simply never stood together.
 * It was only found by driving all six series through the bond and counting particles.
 *
 * The reverse is deliberately NOT asserted: a series with both halves and no bond entry is a
 * legitimate state (it means "no bond designed for this pair yet"), and turning that into an
 * error would make adding a pet item to an existing series a breaking change.
 */
const bondProblems: string[] = [];
for (const series of Object.keys(SERIES_BONDS) as CosmeticSeries[]) {
  const rows = SPECIAL_COSMETICS.filter(def => def.series === series);
  const hasPlayer = rows.some(def => SOCKET_WEARER[def.socket] === 'player');
  const hasPet = rows.some(def => SOCKET_WEARER[def.socket] === 'pet');
  if (!hasPlayer || !hasPet) {
    bondProblems.push(
      `${series} has a bond registered but no ${!hasPlayer ? 'PLAYER' : 'PET'} cosmetic, so it ` +
      `can never fire — the bond needs one of each and silently matches nothing without it.`,
    );
  }
}
if (bondProblems.length > 0) {
  throw new Error(`[cosmeticEffects] unproducible bond:\n  - ${bondProblems.join('\n  - ')}`);
}

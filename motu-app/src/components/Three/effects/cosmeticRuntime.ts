/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import * as THREE from 'three';
import {
  BOND_COOLDOWN, BOND_RADIUS, SERIES_BONDS, SOCKET_WEARER,
} from '../../../constants/cosmeticEffects';
import type {
  BurstSpec, CosmeticSeries, CosmeticWearer, CreatureSpec, EmitSpec, GroundSpec,
  PartMotionSpec, SpecialCosmeticDef,
} from '../../../constants/cosmeticEffects';
import { PARTICLE_SHAPES, SHAPE_ALPHA, SHAPE_FLAT, SHAPE_POOL_SIZE } from './particleShapes';
import type { ParticleShape } from './particleShapes';
import { playerBus } from '../../../lib/playerBus';

/**
 * THE EFFECT RUNTIME — one update loop for every special cosmetic in the scene.
 *
 * ---------------------------------------------------------------------------
 * WHAT THIS IS AND WHAT IT REPLACES
 * ---------------------------------------------------------------------------
 *
 * The naive build of this feature is a component per cosmetic, each with its own
 * `useFrame`, its own array of meshes and its own timer. Ten cosmetics on screen would then
 * be ten React subscribers to the render loop, ten pools, and ten places to get delta
 * clamping wrong. Section 六 of the brief rules that out, so:
 *
 *   - ONE `useFrame` in the whole system (EffectField.tsx) calls {@link CosmeticRuntime.tick};
 *   - particles live in fixed pools allocated once per shape and are never created or
 *     destroyed at runtime — a "spawn" claims a dead slot and a "death" frees it;
 *   - a cosmetic registers a reference to its own group and is then just a row in an array.
 *     Equipping one is a `push`, not a mount of new machinery.
 *
 * NOTHING HERE TOUCHES REACT. `tick` is called from inside a frame callback and mutates
 * three.js objects directly; no state is set, so no cosmetic can cause a re-render — which
 * is the other half of section 六 ("不必要的 DOM / React Render").
 *
 * ---------------------------------------------------------------------------
 * THE THREE THINGS THE RUNTIME REFUSES TO DO
 * ---------------------------------------------------------------------------
 *
 *  1. It never spawns for a wearer it cannot see. {@link isEffectivelyVisible} walks the
 *     parent chain, so an avatar hidden by first-person zoom, or one belonging to a view
 *     that is not on screen, emits nothing at all rather than emitting into the void.
 *  2. It never exceeds a cap. Two of them: per emitter (`maxAlive`, so one cosmetic stays
 *     tasteful) and per shape (`SHAPE_POOL_SIZE`, so a crowd stays cheap). A spawn that
 *     would breach either is DROPPED — never queued, never made to wait.
 *  3. It never touches physics, collision, camera or interaction. Every object it writes to
 *     is a child of a socket or a member of a pool, all of them non-raycastable
 *     (`raycast = () => {}` is set on the pooled meshes in EffectField), so nothing here can
 *     block a click, occlude an interaction test or push the player.
 */

// ---------------------------------------------------------------------------
// REGISTRATION
// ---------------------------------------------------------------------------

/**
 * A cosmetic that is currently worn and on screen.
 *
 * `group` is the cosmetic's own local group, already positioned by its socket, and it is the
 * ONLY thing the runtime is allowed to write transforms to. Everything above it in the tree
 * belongs to the character controller or the pet.
 */
export interface CosmeticEntry {
  def: SpecialCosmeticDef;
  wearer: CosmeticWearer;
  group: THREE.Group;
  /**
   * The wearer's canonical root scale (2.25 for the player, 0.4 for the dog). Emitter
   * distances are divided by the ratio between this and the socket's actual world scale —
   * see the note on EmitSpec in constants/cosmeticEffects.ts.
   */
  rootScale: number;
  /** Random per-entry phase, so two players wearing the same thing do not move in unison. */
  phase: number;
  emitters: EmitterState[];
  creature: CreatureState | null;
  /**
   * The model's tagged sub-groups, found ONCE at registration — see {@link findParts}.
   *
   * An ARRAY per tag, not one object: several sub-groups may share a tag (three stars on one
   * orbit, four petals nodding out of step) and {@link PartMotionSpec.stagger} spreads their
   * phases. `flap` takes `[0]` of its pair tags, which is the degenerate case of the same rule.
   */
  parts: Record<string, THREE.Object3D[]>;
  /**
   * Sub-part animations, resolved against the model at registration — see {@link PartMotionState}.
   * Empty for every ordinary ornament, which is most of them.
   */
  partMotions: PartMotionState[];
  /**
   * 0 standing, 1 walking, eased. What `flap` interpolates its pose along, so a cosmetic can
   * respond to movement as a POSE rather than only as a rate.
   */
  moveBlend: number;
  /** Accumulated wing-beat angle — see the note in {@link CosmeticRuntime.applyMotion}. */
  flapPhase: number;
  /** Seconds still to wait before this entry's burst may fire again. */
  burstCooldown: number;
  /** Ground-conforming state, or null for every cosmetic that is worn on the body. */
  ground: GroundState | null;
}

/**
 * One tagged sub-group, with the pose the MODEL drew it in.
 *
 * The base pose is the whole reason this struct exists. A top-level {@link MotionSpec} writes
 * absolute values onto the cosmetic's own group and may do so because that group starts at
 * identity (see SpecialCosmetic.tsx — the socket transform is on the Attachment ABOVE it). A
 * sub-group has no such guarantee: a flower is at its own angle round the crown and a gear at
 * its own corner of the box, so the same absolute write would collapse every tagged part onto
 * the model's origin on frame one.
 *
 * Captured once, at registration, from a tree React has already built and will not touch again.
 */
interface PartTarget {
  object: THREE.Object3D;
  baseX: number; baseY: number; baseZ: number;
  baseRotX: number; baseRotY: number; baseRotZ: number;
  /** Uniform. Every tagged group in the catalog is authored at an even scale. */
  baseScale: number;
  /** Radians, from this sibling's index times {@link PartMotionSpec.stagger}. */
  phase: number;
}

interface PartMotionState {
  spec: PartMotionSpec;
  targets: PartTarget[];
}

/** What {@link CosmeticRuntime.applyGround} carries between samples. */
interface GroundState {
  spec: GroundSpec;
  /** Seconds until the next sample. */
  next: number;
  /** The most recent fit: world height, and the slope of the plane through it. */
  targetY: number;
  targetPitch: number;
  targetRoll: number;
  /** What is actually being drawn, easing toward the target. */
  y: number;
  pitch: number;
  roll: number;
  /** False until the first sample lands, so the first frame does not ease up from zero. */
  seeded: boolean;
}

interface Counter { live: number }

interface EmitterState {
  spec: EmitSpec;
  /** Seconds until the next burst. */
  next: number;
  counter: Counter;
  /**
   * {@link EmitSpec.cadence} state: whether the salvo window is open, and how long is left of it.
   *
   * Starts CLOSED with a partial window so that equipping a rain cloud does not begin with rain —
   * the first thing the player sees should be the cloud, and the shower should arrive while they
   * are looking at it.
   */
  open: boolean;
  window: number;
}

interface CreatureState {
  spec: CreatureSpec;
  next: number;
  counter: Counter;
}

/**
 * The `userData` key a cosmetic model tags a sub-group with to make it drivable.
 *
 * This is the whole of the model↔runtime contract for animated parts, and it is a string on
 * a group rather than a ref threaded through props for one reason: a model is a plain
 * component with no props and no state (CosmeticModels.tsx's first rule), so it has nothing
 * to hand a ref back through. Tagging is something a model can do inside its own JSX.
 *
 * Unknown tags are ignored and missing tags are ignored, so a model and a spec can be added
 * in either order without an intermediate state that throws.
 */
export const COSMETIC_PART = 'cosmeticPart';

/** How fast {@link CosmeticEntry.moveBlend} chases the wearer's movement, per second. */
const MOVE_BLEND_RATE = 3;

/** What the world looks like this frame. Gathered once by EffectField, not per cosmetic. */
export interface EffectContext {
  /** Seconds, monotonic. The shared clock every mesh animation is a function of. */
  time: number;
  /** Whether the sky is 黃昏/深夜, for `night`-triggered effects. */
  isNight: boolean;
  /**
   * Where the camera is, world. Read only by the glow pool, which hands its two lights to the
   * NEAREST eligible wearers — the one effect in the system whose cost is paid by the whole
   * scene rather than by its own wearer, and therefore the one that has to ration itself.
   */
  cameraPos: THREE.Vector3;
  /**
   * World Y of the ground at (x, z), or undefined where the Canvas has no terrain to speak of.
   *
   * Passed in rather than imported because "what is the ground here" is a different question in
   * each of the three Canvases and only one of them has a real answer: the island resolves it
   * through placementSurfaces (so a ring drawn on a deck sits on the deck, for free, because
   * that is the same lookup the player's own feet use), while the house interior and the
   * dressing room are flat floors where the wearer's own sole height IS the answer.
   *
   * Undefined therefore means "flat", not "unknown" — a ground cosmetic still works, it just
   * never tilts.
   */
  groundAt?: (x: number, z: number) => number;
}

/**
 * How many real lights the whole field may own, across every glowing cosmetic on screen.
 *
 * Two, and the number is small because of what a light IS here: not an object to draw but a
 * term added to every lit fragment in the scene. Three was the first guess and it is the wrong
 * kind of guess — the cost does not scale with how much of the light you can see.
 */
export const GLOW_POOL_SIZE = 2;

/** How fast a light fades in or out when it changes hands, per second. */
const GLOW_FADE_RATE = 2.5;

/**
 * Seconds between ground samples for a conforming cosmetic.
 *
 * Not every frame, for a reason that is about cost AND about looks. Cost: one sample is a
 * terrain lookup plus a pass over every placed object on the island, and a fit needs five of
 * them. Looks: the ground under a walking character changes in steps (a deck edge, a rock), and
 * a fit that tracked it at 60 Hz would snap. Sampling at 8 Hz and easing toward the result is
 * both cheaper and smoother than doing it properly would be.
 */
const GROUND_SAMPLE_INTERVAL = 0.125;

/** How fast a conforming cosmetic eases toward its sampled tilt and height, per second. */
const GROUND_EASE_RATE = 6;

// ---------------------------------------------------------------------------
// POOLS
// ---------------------------------------------------------------------------

interface Particle {
  alive: boolean;
  age: number;
  life: number;
  /** Spawn point, world. */
  ox: number; oy: number; oz: number;
  /** Horizontal travel: either a straight direction or a circle — see `orbit`. */
  dirX: number; dirZ: number;
  drift: number;
  orbit: number;
  orbitPhase: number;
  rise: number;
  /** Downward acceleration over the life — see EmitSpec.gravity. 0 = none. */
  gravity: number;
  /** Cross-travel sine — see EmitSpec.wobble. Amplitude 0 = none. */
  wobbleAmp: number;
  wobbleSpeed: number;
  /** Fraction of life after which the particle holds position — see EmitSpec.settle. 0 = never. */
  settle: number;
  size: number;
  /** Final size as a multiple of `size` — see EmitSpec.grow. 1 = constant. */
  grow: number;
  /** Keeps the orientation its geometry was authored in — see SHAPE_FLAT. */
  flat: boolean;
  opacity: number;
  /** Tumble axis (unit) and rate. */
  ax: number; ay: number; az: number;
  spin: number;
  angle: number;
  colour: THREE.Color;
  /** Whose cap this particle counts against. Null for one-off bursts (the series bond). */
  counter: Counter | null;
}

/** One shape's InstancedMesh plus the per-instance alpha attribute EffectField built for it. */
export interface ShapeBinding {
  mesh: THREE.InstancedMesh;
  alpha: THREE.InstancedBufferAttribute;
}

interface CreatureInstance {
  alive: boolean;
  age: number;
  life: number;
  kind: 'bee' | 'butterfly';
  /** Centre of the orbit, world. Captured at spawn — the visit does not chase a moving wearer. */
  cx: number; cy: number; cz: number;
  radius: number;
  height: number;
  speed: number;
  phase: number;
  scale: number;
  counter: Counter | null;
}

/**
 * The three-slot creature pool, bound by CreatureSlot.tsx.
 *
 * `materials` is collected at bind time so a visit can fade in and out — a bee that pops
 * into existence at full opacity reads as a spawn, and the brief asks for "然後離開或淡出".
 */
export interface CreatureBinding {
  root: THREE.Group;
  variants: Record<'bee' | 'butterfly', THREE.Group>;
  wings: Record<'bee' | 'butterfly', THREE.Group[]>;
  materials: THREE.Material[];
}

/** How many creatures may be alive across the whole scene. Deliberately tiny. */
export const CREATURE_POOL_SIZE = 3;

// ---------------------------------------------------------------------------
// HELPERS
// ---------------------------------------------------------------------------

const scratchPos = new THREE.Vector3();
const scratchScale = new THREE.Vector3();
const scratchQuat = new THREE.Quaternion();
const scratchMatrix = new THREE.Matrix4();
const scratchAxis = new THREE.Vector3();
/** Ground conforming works in its own scratch objects — it runs mid-loop alongside the others. */
const groundEuler = new THREE.Euler();
const groundQuat = new THREE.Quaternion();
const groundVec = new THREE.Vector3();
/** Seeds `instanceColor` so the attribute exists before the first particle claims a slot. */
const WHITE = new THREE.Color(1, 1, 1);

const rand = (min: number, max: number) => min + Math.random() * (max - min);
const randInt = (min: number, max: number) => min + Math.floor(Math.random() * (max - min + 1));

/**
 * Whether an object is actually drawn: `visible` is a LOCAL flag in three.js, so an avatar
 * hidden by the first-person fade leaves every cosmetic under it with `visible === true`.
 * The walk is a handful of steps (socket → head → root → scene) and runs once per cosmetic
 * per frame, against a spawn cost it prevents entirely.
 */
function isEffectivelyVisible(object: THREE.Object3D): boolean {
  let node: THREE.Object3D | null = object;
  while (node) {
    if (!node.visible) return false;
    node = node.parent;
  }
  return true;
}

/**
 * Whether a wearer is moving right now.
 *
 * Read off playerBus rather than passed in, because the two answers come from two different
 * components (Avatar and IslandPet) that already publish them for the camera and the minimap.
 * A `moving`-triggered effect is therefore free — nothing new is computed to support it.
 */
function isWearerMoving(wearer: CosmeticWearer): boolean {
  return wearer === 'player' ? !!playerBus.playerIsMoving : !!playerBus.dogIsMoving;
}

/**
 * Collects a model's tagged sub-groups, once, at registration.
 *
 * A traverse per equip is fine — a cosmetic is equipped a handful of times a session and its
 * tree is a dozen nodes. Doing it per frame instead is what would not be, and is why the
 * result is cached on the entry.
 */
function findParts(root: THREE.Object3D): Record<string, THREE.Object3D[]> {
  const parts: Record<string, THREE.Object3D[]> = {};
  root.traverse((node) => {
    const tag = node.userData?.[COSMETIC_PART];
    if (typeof tag !== 'string') return;
    (parts[tag] ??= []).push(node);
  });
  return parts;
}

/**
 * Resolves a cosmetic's {@link PartMotionSpec} list against the model that was actually mounted.
 *
 * A spec naming a tag the model does not have simply produces no targets and therefore does
 * nothing — the same "absence of config, not a special case" rule the rest of the system runs on,
 * and the reason a model and its catalog row can be edited in either order without an
 * intermediate state that throws.
 *
 * `traverse` visits parents before children, so the sibling order here is the order the model
 * declared its tagged groups in. That is what makes `stagger` predictable: the first star the
 * model writes is the one at phase 0.
 */
function buildPartMotions(
  specs: PartMotionSpec[] | undefined, parts: Record<string, THREE.Object3D[]>,
): PartMotionState[] {
  if (!specs || specs.length === 0) return [];
  const out: PartMotionState[] = [];
  for (const spec of specs) {
    const found = parts[spec.tag];
    if (!found || found.length === 0) continue;
    const stagger = (spec.stagger ?? 0) * Math.PI * 2;
    out.push({
      spec,
      targets: found.map((object, i) => ({
        object,
        baseX: object.position.x, baseY: object.position.y, baseZ: object.position.z,
        baseRotX: object.rotation.x, baseRotY: object.rotation.y, baseRotZ: object.rotation.z,
        baseScale: object.scale.x,
        phase: i * stagger,
      })),
    });
  }
  return out;
}

// ---------------------------------------------------------------------------
// THE RUNTIME
// ---------------------------------------------------------------------------

export class CosmeticRuntime {
  private entries: CosmeticEntry[] = [];
  private particles: Record<ParticleShape, Particle[]>;
  private bindings: Partial<Record<ParticleShape, ShapeBinding>> = {};
  /** Whether a shape's instance buffers changed this frame — skips the GPU upload if not. */
  private dirty: Partial<Record<ParticleShape, boolean>> = {};
  private creatures: CreatureInstance[] = [];
  private creatureBindings: (CreatureBinding | null)[] = [];
  private bondCooldown = 0;
  private bondCheckIn = 0;
  /**
   * Last frame's airborne flag, so `jump` bursts fire on the RISING EDGE.
   *
   * Seeded `true` rather than `false`: a Canvas that mounts while the player happens to be
   * mid-jump (walking into the house and out again is enough) would otherwise read the very
   * first frame as a take-off and fire a burst nobody asked for.
   */
  private wasAirborne = true;
  /** The pooled lights, bound by EffectField. */
  private glowLights: (THREE.PointLight | null)[] = Array.from({ length: GLOW_POOL_SIZE }, () => null);
  /**
   * Which cosmetic each light is currently serving, or null.
   *
   * Held per SLOT rather than recomputed per frame from the sorted candidate list, and that is
   * the whole reason handover looks like anything: a light that is simply re-aimed at whoever
   * is nearest this frame teleports across the island the moment two wearers swap order at
   * equal distance. A slot keeps its owner until that owner stops being eligible, then fades to
   * zero, and only THEN accepts a new one.
   */
  private glowOwners: (CosmeticEntry | null)[] = Array.from({ length: GLOW_POOL_SIZE }, () => null);

  constructor() {
    this.particles = PARTICLE_SHAPES.reduce((acc, shape) => {
      acc[shape] = Array.from({ length: SHAPE_POOL_SIZE[shape] }, () => ({
        alive: false, age: 0, life: 1,
        ox: 0, oy: 0, oz: 0,
        dirX: 0, dirZ: 0, drift: 0, orbit: 0, orbitPhase: 0,
        rise: 0, gravity: 0, wobbleAmp: 0, wobbleSpeed: 0,
        settle: 0, size: 0, grow: 1, flat: false, opacity: 0,
        ax: 0, ay: 1, az: 0, spin: 0, angle: 0,
        colour: new THREE.Color(),
        counter: null,
      }));
      return acc;
    }, {} as Record<ParticleShape, Particle[]>);

    this.creatures = Array.from({ length: CREATURE_POOL_SIZE }, () => ({
      alive: false, age: 0, life: 1, kind: 'bee' as const,
      cx: 0, cy: 0, cz: 0, radius: 0.4, height: 0, speed: 0.3, phase: 0, scale: 1,
      counter: null,
    }));
    this.creatureBindings = Array.from({ length: CREATURE_POOL_SIZE }, () => null);
  }

  // --- binding, called by EffectField as the pooled meshes mount -----------

  /**
   * Hands the runtime one shape's InstancedMesh.
   *
   * Zeroing the whole buffer here is not optional: a fresh InstancedMesh's matrices are
   * IDENTITY, so an unzeroed pool draws all 32 of its particles at full size stacked on the
   * world origin until something happens to claim them. The per-frame update only rewrites
   * slots that changed, so this is the one chance to establish "not alive means not drawn".
   */
  bindShape(shape: ParticleShape, binding: ShapeBinding | null) {
    if (!binding) {
      delete this.bindings[shape];
      return;
    }
    this.bindings[shape] = binding;
    scratchMatrix.makeScale(0, 0, 0);
    for (let i = 0; i < SHAPE_POOL_SIZE[shape]; i++) {
      binding.mesh.setMatrixAt(i, scratchMatrix);
      binding.alpha.setX(i, 0);
      binding.mesh.setColorAt(i, WHITE);
    }
    binding.mesh.instanceMatrix.needsUpdate = true;
    binding.alpha.needsUpdate = true;
    if (binding.mesh.instanceColor) binding.mesh.instanceColor.needsUpdate = true;
    binding.mesh.visible = false;
    // Anything already in flight for this shape needs re-writing into the new buffer.
    this.dirty[shape] = true;
  }

  bindGlow(index: number, light: THREE.PointLight | null) {
    this.glowLights[index] = light;
    if (light) {
      light.intensity = 0;
      light.visible = false;
    } else {
      this.glowOwners[index] = null;
    }
  }

  bindCreature(index: number, binding: CreatureBinding | null) {
    this.creatureBindings[index] = binding;
    if (!binding) this.creatures[index].alive = false;
  }

  // --- registration, called by useCosmeticEffect ---------------------------

  /**
   * Adds a worn cosmetic. Returns the disposer the hook calls on unmount, which also
   * releases whatever the cosmetic still has in flight — an item taken off in the dressing
   * room must not leave its last two stars orbiting an empty socket.
   */
  register(def: SpecialCosmeticDef, group: THREE.Group, rootScale: number): () => void {
    // One traverse, shared by the part lookup and the part-motion resolver below. Both need the
    // same table and the tree is not going to change under them — a model is a plain component
    // with no state, so what React mounted is what will be there until it unmounts.
    const parts = findParts(group);
    const entry: CosmeticEntry = {
      def,
      wearer: SOCKET_WEARER[def.socket],
      group,
      rootScale,
      phase: Math.random() * Math.PI * 2,
      emitters: (def.effect.emit ?? []).map(spec => ({
        spec,
        // Staggered rather than starting at zero: equipping a cosmetic should not fire
        // every one of its emitters on the first frame.
        next: rand(0.4, spec.interval),
        counter: { live: 0 },
        // A salvo emitter starts SHUT, part-way through a silence. Equipping a rain cloud in the
        // dressing room should show you a cloud that then starts to rain, not one that is already
        // raining — the beginning is the half of `cadence` that carries the effect.
        open: false,
        window: spec.cadence ? rand(0.25, Math.max(0.3, spec.cadence.off)) : 0,
      })),
      creature: def.effect.creature
        ? { spec: def.effect.creature, next: rand(2, def.effect.creature.interval), counter: { live: 0 } }
        : null,
      parts,
      partMotions: buildPartMotions(def.effect.motion?.parts, parts),
      // Starts at the wearer's CURRENT state rather than at 0, so equipping wings while
      // already walking shows them open instead of playing the take-off crossfade in the
      // dressing room's doorway.
      moveBlend: isWearerMoving(SOCKET_WEARER[def.socket]) ? 1 : 0,
      flapPhase: Math.random() * Math.PI * 2,
      burstCooldown: 0,
      ground: def.effect.ground
        ? {
          spec: def.effect.ground,
          next: 0,
          targetY: 0, targetPitch: 0, targetRoll: 0,
          y: 0, pitch: 0, roll: 0,
          seeded: false,
        }
        : null,
    };
    this.entries.push(entry);

    return () => {
      const i = this.entries.indexOf(entry);
      if (i >= 0) this.entries.splice(i, 1);
      // Kill anything still in the air that belonged to this cosmetic.
      const counters = new Set<Counter>(entry.emitters.map(e => e.counter));
      if (entry.creature) counters.add(entry.creature.counter);
      for (const shape of PARTICLE_SHAPES) {
        for (const p of this.particles[shape]) {
          if (p.counter && counters.has(p.counter)) {
            p.alive = false;
            this.dirty[shape] = true;
          }
        }
      }
      for (const c of this.creatures) {
        if (c.counter && counters.has(c.counter)) c.alive = false;
      }
      // Drop the light immediately rather than letting it fade: the group it was following is
      // about to unmount with its React tree, so one more frame of tracking would read a stale
      // matrix. The fade is for a HANDOVER; this is a removal.
      for (let i = 0; i < GLOW_POOL_SIZE; i++) {
        if (this.glowOwners[i] === entry) {
          this.glowOwners[i] = null;
          const light = this.glowLights[i];
          if (light) { light.intensity = 0; light.visible = false; }
        }
      }
      // The group itself is about to unmount with its React tree; nothing to reset.
    };
  }

  // --- the single update --------------------------------------------------

  tick(delta: number, ctx: EffectContext) {
    // The rising edge of "the player left the ground", computed ONCE for the whole scene
    // rather than per entry — otherwise two entries reading the flag would each have to keep
    // their own copy of last frame's value and they would disagree on the frame it changes.
    const airborne = !!playerBus.playerIsAirborne;
    const tookOff = airborne && !this.wasAirborne;
    this.wasAirborne = airborne;

    for (const entry of this.entries) {
      if (entry.burstCooldown > 0) entry.burstCooldown -= delta;
      // A hidden wearer gets its mesh animation skipped too, not just its particles: the
      // transform would be recomputed for something nobody can see.
      if (!isEffectivelyVisible(entry.group)) continue;

      const moving = isWearerMoving(entry.wearer);
      // Eased rather than assigned, and eased HERE rather than inside applyMotion, because it
      // is per-entry world state (like the phase) and not part of any one motion field.
      const target = moving ? 1 : 0;
      entry.moveBlend += (target - entry.moveBlend) * Math.min(1, delta * MOVE_BLEND_RATE);

      this.applyMotion(entry, ctx.time, delta);
      // Sub-parts are driven OUTSIDE applyMotion rather than at the end of it, because that
      // function returns early inside its `flap` branch when a model declares no wings — and a
      // cosmetic that has both a flap spec and orbiting parts (the insect wings do) would then
      // silently lose its orbits on any model that had not been tagged yet.
      if (entry.partMotions.length > 0) this.applyPartMotions(entry, ctx.time);
      // AFTER motion, deliberately: a conforming cosmetic's height comes from the floor, and
      // `bob` writes position.y too. Whichever runs last wins, and it has to be this one.
      if (entry.ground) this.applyGround(entry, entry.ground, delta, ctx);

      for (const em of entry.emitters) {
        this.stepEmitter(entry, em, delta, ctx, moving);
      }
      if (entry.creature) this.stepCreatureSpawner(entry, entry.creature, delta, ctx);
      if (tookOff && entry.def.effect.burst && entry.wearer === 'player') {
        this.fireBurst(entry, entry.def.effect.burst);
      }
    }

    this.stepParticles(delta);
    this.stepCreatures(delta, ctx);
    this.stepGlow(delta, ctx);
    this.stepBond(delta);
  }

  // --- mesh animation (the free half of every effect) ---------------------

  /**
   * Writes the cosmetic's own local transform from its {@link MotionSpec}.
   *
   * Every curve is a pure function of the shared clock plus the entry's phase — nothing is
   * integrated frame to frame. That is the same lesson Fireflies.tsx records: a `+=` here
   * would make the animation's amplitude depend on the monitor's refresh rate and let it
   * drift permanently out of place, and unlike a firefly a hair ornament that drifts ends
   * up hanging off the side of someone's head.
   */
  private applyMotion(entry: CosmeticEntry, time: number, delta: number) {
    const motion = entry.def.effect.motion;
    if (!motion) return;
    const g = entry.group;
    const t = time + entry.phase;

    if (motion.sway) {
      const a = Math.sin(t * motion.sway.speed * Math.PI * 2) * motion.sway.amplitude;
      g.rotation[motion.sway.axis] = a;
    }
    if (motion.spin) {
      // Also a function of the clock, not an accumulation: `rotation += speed * delta`
      // would drift between two cosmetics of the same kind and could not be resumed
      // identically after a tab-throttle pause.
      g.rotation[motion.spin.axis] = (t * motion.spin.speed) % (Math.PI * 2);
    }
    if (motion.bob) {
      g.position.y = Math.sin(t * motion.bob.speed * Math.PI * 2) * motion.bob.amplitude;
    }
    if (motion.pulse) {
      const s = 1 + Math.sin(t * motion.pulse.speed * Math.PI * 2) * motion.pulse.amplitude;
      g.scale.setScalar(s);
    }
    if (motion.flap) {
      const left = entry.parts.wingL?.[0];
      const right = entry.parts.wingR?.[0];
      // A model that declares no wings just does not flap. Nothing throws, nothing warns:
      // the spec describes an intent and the model decides whether it can host it.
      if (!left || !right) return;

      const f = motion.flap;
      const blend = entry.moveBlend;
      const amplitude = f.amplitude + (f.movingAmplitude - f.amplitude) * blend;
      const speed = f.speed + (f.movingSpeed - f.speed) * blend;
      const spread = f.spread + (f.movingSpread - f.spread) * blend;

      // THE ONE ACCUMULATED CURVE IN THIS FILE, and the exception is load-bearing rather
      // than an oversight of the rule three fields above. Those are `sin(clock * speed)` at a
      // FIXED speed; this speed changes as the player sets off, and `sin(clock * speed)`
      // jumps to a different point on the curve the instant speed changes — the wings would
      // snap mid-beat every time the player started walking. Integrating the phase keeps the
      // beat continuous through the rate change.
      //
      // The drift the rule exists to prevent cannot happen here: the phase only ever feeds a
      // sine, so its output is bounded whatever the accumulated value is, and `delta` is
      // already clamped upstream (EffectField). A drifting POSITION ends up off the body; a
      // drifting phase ends up at a different point in a wing beat, which is not observable.
      entry.flapPhase += delta * speed * Math.PI * 2;
      const beat = Math.sin(entry.flapPhase) * amplitude;

      // Opposite signs: the left wing sits at +x and the right at -x, so the same positive
      // rotation about Z raises one tip and drops the other. Mirroring the sign is what makes
      // this a BEAT rather than the whole pair rocking sideways. Same argument on Y, where the
      // mirrored sign is what makes the sweep a gather-and-push instead of a shrug.
      const sweepRest = f.sweep ?? 0;
      const sweepMove = f.movingSweep ?? sweepRest;
      // A QUARTER TURN BEHIND THE LIFT (-cos against the lift's sin), which is what makes the
      // tip trace a figure of eight instead of a straight diagonal line. The two in phase gives
      // "up-and-back, down-and-forward", and the wings are then most foreshortened at the exact
      // moment of the downstroke — they read as folding away rather than as beating. In
      // quadrature the wing is fully side-on at the top of the stroke, which is where the eye
      // goes, and does its gathering on the way past.
      const swing = -Math.cos(entry.flapPhase) * (sweepRest + (sweepMove - sweepRest) * blend);

      left.rotation.z = spread + beat;
      right.rotation.z = -(spread + beat);
      left.rotation.y = swing;
      right.rotation.y = -swing;

      // THE HIND PAIR, if the model drew one. Four wings, and the fore and hind pairs of a real
      // flier do not beat together — the lag between them is most of what separates an insect
      // from a cut-out flapping. In phase they read as one thick wing; in antiphase they read as
      // broken. A quarter of a beat is the value that reads as an animal.
      const left2 = entry.parts.wingL2?.[0];
      const right2 = entry.parts.wingR2?.[0];
      if (left2 && right2 && f.secondaryLag !== undefined) {
        const lagPhase = entry.flapPhase - f.secondaryLag;
        const scale2 = f.secondaryScale ?? 1;
        const beat2 = Math.sin(lagPhase) * amplitude * scale2;
        const swing2 = -Math.cos(lagPhase) * (sweepRest + (sweepMove - sweepRest) * blend) * scale2;
        left2.rotation.z = spread * scale2 + beat2;
        right2.rotation.z = -(spread * scale2 + beat2);
        left2.rotation.y = swing2;
        right2.rotation.y = -swing2;
      }
    }
  }

  /**
   * Drives a model's tagged sub-groups — see {@link PartMotionSpec}.
   *
   * Every curve is added to the pose the model drew (captured in {@link PartTarget}) rather than
   * written absolutely, which is the one structural difference from {@link applyMotion} and the
   * reason it is a separate function rather than a loop inside it.
   *
   * Same rule as everywhere else: pure functions of the shared clock plus a phase, never an
   * accumulation. A gear that integrated its angle would drift out of step with the second gear
   * beside it, and two gears in a music box turning at subtly different phases is precisely the
   * thing a player reads as broken rather than as mechanical.
   */
  private applyPartMotions(entry: CosmeticEntry, time: number) {
    const t = time + entry.phase;
    for (const motion of entry.partMotions) {
      const { spec, targets } = motion;
      for (const target of targets) {
        const o = target.object;
        const phase = target.phase;
        if (spec.spin) {
          const axis = spec.spin.axis;
          const base = axis === 'x' ? target.baseRotX : axis === 'y' ? target.baseRotY : target.baseRotZ;
          o.rotation[axis] = base + (t * spec.spin.speed + phase) % (Math.PI * 2);
        }
        if (spec.sway) {
          const axis = spec.sway.axis;
          const base = axis === 'x' ? target.baseRotX : axis === 'y' ? target.baseRotY : target.baseRotZ;
          o.rotation[axis] = base + Math.sin(t * spec.sway.speed * Math.PI * 2 + phase) * spec.sway.amplitude;
        }
        if (spec.bob) {
          o.position.y = target.baseY + Math.sin(t * spec.bob.speed * Math.PI * 2 + phase) * spec.bob.amplitude;
        }
        if (spec.pulse) {
          const s = 1 + Math.sin(t * spec.pulse.speed * Math.PI * 2 + phase) * spec.pulse.amplitude;
          o.scale.setScalar(target.baseScale * s);
        }
      }
    }
  }

  // --- emitters -----------------------------------------------------------

  private triggerActive(trigger: EmitSpec['trigger'], ctx: EffectContext, moving: boolean): boolean {
    if (trigger === 'moving') return moving;
    if (trigger === 'night') return ctx.isNight;
    // Read straight off the bus like `moving` is, and for the same reason: the swim state is
    // already published for the animation and the camera, so gating on it costs one property
    // read. A pet cannot swim, so this is simply never true for one — which is the right answer
    // rather than a case that needs handling.
    if (trigger === 'swimming') return !!playerBus.isSwimming;
    return true;
  }

  private stepEmitter(
    entry: CosmeticEntry, em: EmitterState, delta: number, ctx: EffectContext, moving: boolean,
  ) {
    if (!this.triggerActive(em.spec.trigger, ctx, moving)) {
      // Hold the timer rather than resetting it. A dog that stops for half a second and
      // trots on again should carry on its spore rhythm, not restart the wait each time.
      return;
    }
    // SALVOS. Flips between an open window and a silence, both jittered — see EmitSpec.cadence.
    // Stepped after the trigger check so a gated emitter's salvo clock is held along with its
    // interval: a cloud that went off screen mid-shower resumes the shower, it does not restart
    // the wait for one.
    const cadence = em.spec.cadence;
    if (cadence) {
      em.window -= delta;
      if (em.window <= 0) {
        em.open = !em.open;
        const jitter = cadence.jitter ?? 0.35;
        em.window = (em.open ? cadence.on : cadence.off) * (1 + rand(-jitter, jitter));
      }
      if (!em.open) return;
    }

    const rateScale = moving && em.spec.movingScale ? em.spec.movingScale : 1;
    em.next -= delta / rateScale;
    if (em.next > 0) return;

    em.next = em.spec.interval * (1 + rand(-em.spec.intervalJitter, em.spec.intervalJitter));
    if (em.counter.live >= em.spec.maxAlive) return; // at cap: skip this burst entirely

    const factor = this.wearerFactor(entry);
    entry.group.getWorldPosition(scratchPos);
    const spec = em.spec;
    const [ox, oy, oz] = spec.offset ?? [0, 0, 0];
    const baseX = scratchPos.x + ox * factor;
    const baseY = scratchPos.y + oy * factor;
    const baseZ = scratchPos.z + oz * factor;

    const burst = randInt(spec.count[0], spec.count[1]);
    for (let i = 0; i < burst; i++) {
      if (em.counter.live >= spec.maxAlive) break;
      const p = this.claim(spec.shape);
      if (!p) break; // shape pool full — drop, never queue

      const angle = Math.random() * Math.PI * 2;
      // THE RARE ONE, rolled per particle so it is born inside a burst of ordinary ones rather
      // than arriving on a timer of its own — see the note on EmitSpec.rare.
      const rare = spec.rare && Math.random() < spec.rare.chance ? spec.rare : null;
      const colors = rare?.colors ?? spec.colors;
      p.alive = true;
      p.age = 0;
      p.life = rand(spec.lifetime[0], spec.lifetime[1]) * (rare?.lifetime ?? 1);
      p.ox = baseX + (Math.random() - 0.5) * spec.spread * factor;
      p.oy = baseY + (Math.random() - 0.5) * spec.spread * factor * 0.6;
      p.oz = baseZ + (Math.random() - 0.5) * spec.spread * factor;
      p.dirX = Math.cos(angle);
      p.dirZ = Math.sin(angle);
      p.drift = spec.drift * rand(0.6, 1.3) * factor;
      p.orbit = spec.orbit ?? 0;
      p.orbitPhase = angle;
      p.rise = spec.rise * rand(0.8, 1.2) * factor;
      p.gravity = (spec.gravity ?? 0) * factor;
      p.wobbleAmp = (spec.wobble?.amplitude ?? 0) * factor;
      p.wobbleSpeed = spec.wobble?.speed ?? 0;
      p.settle = spec.settle ?? 0;
      p.size = rand(spec.size[0], spec.size[1]) * factor * (rare?.size ?? 1);
      p.grow = rare?.grow ?? spec.grow ?? 1;
      p.flat = SHAPE_FLAT[spec.shape];
      p.opacity = rare?.opacity ?? spec.opacity;
      this.randomAxis(p);
      p.spin = spec.tumble * rand(0.6, 1.4) * (Math.random() < 0.5 ? -1 : 1) * (rare?.tumble ?? 1);
      p.angle = Math.random() * Math.PI * 2;
      p.colour.set(colors[(Math.random() * colors.length) | 0]);
      p.counter = em.counter;
      em.counter.live++;
      this.dirty[spec.shape] = true;
    }
  }

  /**
   * The scale correction described on EmitSpec: 1 in the world, 0.5 in the dressing room's
   * half-size preview. Reads the socket's live world scale, so a cosmetic mounted through an
   * Attachment that shrinks it (v2's 0.81 head sockets) gets proportionally smaller sparkles
   * without either side knowing about the other.
   */
  private wearerFactor(entry: CosmeticEntry): number {
    entry.group.matrixWorld.decompose(scratchPos, scratchQuat, scratchScale);
    return scratchScale.x / entry.rootScale;
  }

  private randomAxis(p: Particle) {
    const a = Math.random() * Math.PI * 2;
    const z = Math.random() * 2 - 1;
    const r = Math.sqrt(1 - z * z);
    p.ax = Math.cos(a) * r;
    p.ay = z;
    p.az = Math.sin(a) * r;
  }

  private claim(shape: ParticleShape): Particle | null {
    const pool = this.particles[shape];
    for (let i = 0; i < pool.length; i++) {
      if (!pool[i].alive) return pool[i];
    }
    return null;
  }

  // --- particle update ----------------------------------------------------

  /**
   * Steps every live particle and writes the instance matrices.
   *
   * The shared curve: ease-OUT on travel (a leaf leaves fast and settles), fade in over the
   * first 15% of life and out over the last 45%. Fading in at all is the difference between
   * "a star appeared" and "a star was switched on"; the long fade out is what keeps the
   * effect from ending on a pop.
   */
  private stepParticles(delta: number) {
    for (const shape of PARTICLE_SHAPES) {
      const binding = this.bindings[shape];
      if (!binding) continue;
      const pool = this.particles[shape];
      const alphaScale = SHAPE_ALPHA[shape];
      let live = 0;
      let changed = this.dirty[shape] ?? false;

      for (let i = 0; i < pool.length; i++) {
        const p = pool[i];
        if (!p.alive) {
          if (changed) {
            // A dead slot is parked at zero scale rather than moved out of frustum: three
            // draws the whole instance buffer either way, and a degenerate matrix costs the
            // rasteriser nothing while a distant one still gets transformed and clipped.
            scratchMatrix.makeScale(0, 0, 0);
            binding.mesh.setMatrixAt(i, scratchMatrix);
            binding.alpha.setX(i, 0);
          }
          continue;
        }

        p.age += delta;
        if (p.age >= p.life) {
          p.alive = false;
          if (p.counter) p.counter.live = Math.max(0, p.counter.live - 1);
          p.counter = null;
          scratchMatrix.makeScale(0, 0, 0);
          binding.mesh.setMatrixAt(i, scratchMatrix);
          binding.alpha.setX(i, 0);
          changed = true;
          continue;
        }

        live++;
        changed = true;
        const t = p.age / p.life;
        // `settle` compresses the whole travel curve into the first fraction of the life and
        // then pins it at 1. Note it drives the EASE, not the position directly, so a settled
        // particle arrives at exactly the place an unsettled one would have reached at the end
        // of its arc — it stops early, it does not stop short.
        const travel = p.settle > 0 ? Math.min(1, t / p.settle) : t;
        const ease = 1 - (1 - travel) * (1 - travel);

        let dx: number;
        let dz: number;
        if (p.orbit > 0) {
          // Spirals outward as it circles, so it leaves the socket rather than snapping to
          // its orbit radius on frame one.
          const a = p.orbitPhase + p.orbit * Math.PI * 2 * travel;
          dx = Math.cos(a) * p.drift * ease;
          dz = Math.sin(a) * p.drift * ease;
        } else {
          dx = p.dirX * p.drift * ease;
          dz = p.dirZ * p.drift * ease;
        }

        if (p.wobbleAmp !== 0) {
          // ACROSS the direction of travel: (-dirZ, dirX) is the horizontal perpendicular to the
          // particle's own drift, so the sway is a flutter about its path rather than a change of
          // speed along it. Phased off the spawn angle, which every particle already carries and
          // which nothing else reads once `orbit` is zero — so six flakes from one burst flutter
          // independently instead of swinging as one body.
          //
          // Frozen at the settle point along with the travel: a flake that has come to rest in
          // the air but is still swinging reads as hanging on a thread.
          const wt = p.settle > 0 ? Math.min(p.age, p.life * p.settle) : p.age;
          const w = Math.sin(wt * p.wobbleSpeed * Math.PI * 2 + p.orbitPhase) * p.wobbleAmp;
          dx += -p.dirZ * w;
          dz += p.dirX * w;
        }
        // Gravity is a parabola ON TOP of `rise`'s straight climb, and it runs on the same
        // travel curve `settle` compresses — so an ember that has landed stops falling instead
        // of sinking through the island, exactly as its horizontal travel stops.
        scratchPos.set(p.ox + dx, p.oy + p.rise * ease - p.gravity * travel * travel, p.oz + dz);
        if (p.flat) {
          // Drawn in the plane its geometry was authored in, always. Note this is not the same
          // as "spin 0": an unrotated particle would still be carrying the random orientation
          // every spawn is given, so a ring would stand on its edge at a random angle.
          scratchQuat.identity();
        } else {
          // The tumble winds down with the travel. A feather that has come to rest in the air
          // but is still spinning at full rate reads as broken rather than as a feather.
          p.angle += p.spin * delta * (travel < 1 ? 1 : 0.12);
          scratchQuat.setFromAxisAngle(scratchAxis.set(p.ax, p.ay, p.az), p.angle);
        }
        // Growth runs on the RAW life fraction, not on the settle-compressed travel: a settled
        // particle has stopped moving, but a wave keeps spreading while it fades.
        scratchScale.setScalar(p.grow === 1 ? p.size : p.size * (1 + (p.grow - 1) * t));
        scratchMatrix.compose(scratchPos, scratchQuat, scratchScale);
        binding.mesh.setMatrixAt(i, scratchMatrix);

        // 10% in, full until 68%, 32% out — against the old 15/55/45.
        //
        // The old curve spent 60% of every particle's life ramping, so a "0.8 opacity" particle
        // averaged closer to 0.55 of that and was only ever briefly at its stated value. Widening
        // the plateau makes the whole set more present without changing a single count, which is
        // the cheapest visibility there is: no extra particles, no extra overdraw at the edges.
        //
        // Neither end goes to zero-length. Fading IN at all is what makes a star appear rather
        // than switch on, and the long-ish tail is what stops the effect ending on a pop.
        const fadeIn = Math.min(1, t / 0.1);
        const fadeOut = t > 0.68 ? 1 - (t - 0.68) / 0.32 : 1;
        binding.alpha.setX(i, p.opacity * alphaScale * fadeIn * fadeOut);
        binding.mesh.setColorAt(i, p.colour);
      }

      if (changed) {
        binding.mesh.instanceMatrix.needsUpdate = true;
        binding.alpha.needsUpdate = true;
        if (binding.mesh.instanceColor) binding.mesh.instanceColor.needsUpdate = true;
      }
      // The whole shape is skipped by the renderer while none of its particles are alive.
      binding.mesh.visible = live > 0;
      this.dirty[shape] = false;
    }
  }

  // --- creatures ----------------------------------------------------------

  private stepCreatureSpawner(entry: CosmeticEntry, state: CreatureState, delta: number, ctx: EffectContext) {
    if (!this.triggerActive(state.spec.trigger, ctx, isWearerMoving(entry.wearer))) return;
    state.next -= delta;
    if (state.next > 0) return;
    state.next = state.spec.interval * (1 + rand(-state.spec.intervalJitter, state.spec.intervalJitter));
    if (state.counter.live >= state.spec.maxAlive) return;

    const slot = this.creatures.findIndex((c, i) => !c.alive && this.creatureBindings[i]);
    if (slot < 0) return; // all three busy elsewhere — skip this visit

    const factor = this.wearerFactor(entry);
    entry.group.getWorldPosition(scratchPos);
    const spec = state.spec;
    const c = this.creatures[slot];
    c.alive = true;
    c.age = 0;
    c.life = rand(spec.duration[0], spec.duration[1]);
    c.kind = spec.kind;
    c.cx = scratchPos.x;
    c.cy = scratchPos.y + spec.orbitHeight * factor;
    c.cz = scratchPos.z;
    c.radius = rand(spec.orbitRadius[0], spec.orbitRadius[1]) * factor;
    c.height = spec.orbitHeight * factor;
    c.speed = spec.orbitSpeed;
    c.phase = Math.random() * Math.PI * 2;
    c.scale = spec.scale * factor;
    c.counter = state.counter;
    state.counter.live++;

    const binding = this.creatureBindings[slot];
    if (binding) {
      binding.variants.bee.visible = spec.kind === 'bee';
      binding.variants.butterfly.visible = spec.kind === 'butterfly';
    }
  }

  /**
   * Flies each live creature.
   *
   * The orbit centre is CAPTURED AT SPAWN and never updated, which is the decision that
   * makes this read as an animal rather than as an attached effect: a bee that tracked the
   * dog would slide sideways whenever the dog ran, which is not something a bee does. It
   * circles the place it came out of, and by the time the wearer has walked away it has
   * already faded.
   */
  private stepCreatures(delta: number, ctx: EffectContext) {
    for (let i = 0; i < this.creatures.length; i++) {
      const c = this.creatures[i];
      const binding = this.creatureBindings[i];
      if (!binding) continue;
      if (!c.alive) {
        if (binding.root.visible) binding.root.visible = false;
        continue;
      }

      c.age += delta;
      if (c.age >= c.life) {
        c.alive = false;
        if (c.counter) c.counter.live = Math.max(0, c.counter.live - 1);
        c.counter = null;
        binding.root.visible = false;
        continue;
      }

      const t = c.age / c.life;
      const angle = c.phase + c.age * c.speed * Math.PI * 2;
      // The radius eases out on arrival and back in on departure, so the visit is one
      // continuous flight path: out of the cosmetic, around, and away again.
      const radius = c.radius * (0.35 + 0.65 * Math.sin(Math.PI * Math.min(1, t * 1.15)));
      const bobble = Math.sin(c.age * 3.1) * 0.03;

      binding.root.visible = true;
      binding.root.position.set(
        c.cx + Math.cos(angle) * radius,
        c.cy + bobble + Math.sin(c.age * 1.7) * 0.02,
        c.cz + Math.sin(angle) * radius,
      );
      // Face along the tangent, banking slightly into the turn.
      binding.root.rotation.set(0, -angle + Math.PI / 2, 0);
      binding.root.scale.setScalar(c.scale);

      // Wingbeat. A bee's is a blur, a butterfly's is a slow open-and-close, and that
      // single number is most of what tells the two apart at this size.
      const flapSpeed = c.kind === 'bee' ? 26 : 4.5;
      const flapAmount = c.kind === 'bee' ? 0.5 : 1.05;
      const flap = Math.sin(ctx.time * flapSpeed + c.phase) * flapAmount;
      const wings = binding.wings[c.kind];
      if (wings[0]) wings[0].rotation.z = flap;
      if (wings[1]) wings[1].rotation.z = -flap;

      const fade = Math.min(1, t / 0.12) * (t > 0.75 ? 1 - (t - 0.75) / 0.25 : 1);
      for (const mat of binding.materials) {
        (mat as THREE.Material & { opacity: number }).opacity = fade;
      }
    }
  }

  // --- ground conforming (the `aura` socket) ------------------------------

  /**
   * Lays a cosmetic on the floor: world-oriented, tilted to the slope, at ground height.
   *
   * THE PLANE FIT. Four samples on the axes at `radius`, and the slope of each axis is the
   * difference across its pair divided by the span — a central difference, which is the cheapest
   * estimate that is symmetric (a forward difference would lean the ring downhill even on flat
   * ground with one bump in front of it). The centre sample gives the height. Five lookups every
   * eighth of a second, eased, rather than five every frame.
   *
   * THE COUNTER-ROTATION. `quaternion = parentWorld⁻¹ · tilt` is what makes this socket work at
   * all: it cancels whatever the body is doing — the walk's yaw, the crawl's flat pitch, the
   * jump's squash — and replaces it with a world-space orientation the ring chooses. Every other
   * cosmetic in the system wants the opposite and gets it by doing nothing.
   *
   * THE HEIGHT. Written through `worldToLocal`, not by arithmetic on position.y, because the
   * parent chain has rotation and scale in it and only the matrix knows the answer. x and z are
   * taken from where the socket already is, so this moves the cosmetic vertically and never
   * horizontally.
   */
  private applyGround(entry: CosmeticEntry, g: GroundState, delta: number, ctx: EffectContext) {
    const parent = entry.group.parent;
    if (!parent) return;

    // THE SOCKET, NOT THE GROUP. Everything below reads from the parent's world position, and
    // that is a correctness requirement rather than a tidiness one: this function WRITES the
    // group's position, so reading the group back is a feedback loop, and it produced two bugs
    // that looked unrelated.
    //
    //   The ring CLIMBED on a flat floor. With no terrain sampler (the house interior, the
    //   dressing room) the fallback took the ground height from the group's own y — which was
    //   already ground + lift from last time — so every sample added another lift. ~0.6 world
    //   units of drift in five seconds, straight up.
    //
    //   The ring WANDERED after swimming. Swimming pitches the character root, and under a
    //   pitched parent a world-vertical offset converts to a local offset with x and z in it.
    //   Reading the group back then sampled the ground at that displaced point and wrote a
    //   further displacement, compounding every frame — so the ring drifted off the wearer and
    //   was still off when they walked back onto land.
    //
    // The parent is the Attachment group, and the aura anchor is (0,0,0) on a root whose origin
    // IS the ground contact point — so this is exactly "where the wearer's feet are", it is
    // authoritative, and nothing in here can move it.
    parent.getWorldPosition(scratchPos);
    const wx = scratchPos.x;
    const wz = scratchPos.z;

    g.next -= delta;
    if (g.next <= 0 || !g.seeded) {
      g.next = GROUND_SAMPLE_INTERVAL;
      const r = g.spec.radius;
      const sample = ctx.groundAt;
      if (sample) {
        const centre = sample(wx, wz);
        const east = sample(wx + r, wz);
        const west = sample(wx - r, wz);
        const south = sample(wx, wz + r);
        const north = sample(wx, wz - r);
        g.targetY = centre;
        // Roll is NEGATED against the x slope: tilting about +Z lifts +x, and ground that rises
        // to the east needs the ring's east edge lifted.
        g.targetRoll = -Math.atan2(east - west, 2 * r);
        g.targetPitch = Math.atan2(south - north, 2 * r);
        const cap = g.spec.maxTilt;
        g.targetRoll = Math.max(-cap, Math.min(cap, g.targetRoll));
        g.targetPitch = Math.max(-cap, Math.min(cap, g.targetPitch));
      } else {
        // No terrain service: the floor is flat and the wearer is standing on it, so the
        // SOCKET's world height is the ground. This is the interior and the dressing room.
        g.targetY = scratchPos.y;
        g.targetPitch = 0;
        g.targetRoll = 0;
      }
      if (!g.seeded) {
        g.y = g.targetY;
        g.pitch = g.targetPitch;
        g.roll = g.targetRoll;
        g.seeded = true;
      }
    }

    const k = Math.min(1, delta * GROUND_EASE_RATE);
    g.y += (g.targetY - g.y) * k;
    g.pitch += (g.targetPitch - g.pitch) * k;
    g.roll += (g.targetRoll - g.roll) * k;

    parent.getWorldQuaternion(scratchQuat);
    scratchQuat.invert();
    groundEuler.set(g.pitch, 0, g.roll, 'XYZ');
    groundQuat.setFromEuler(groundEuler);
    entry.group.quaternion.copy(scratchQuat).multiply(groundQuat);

    groundVec.set(wx, g.y + g.spec.lift, wz);
    parent.worldToLocal(groundVec);
    entry.group.position.copy(groundVec);
  }

  // --- glow (the rationed effect) -----------------------------------------

  /**
   * Hands the field's two lights to the nearest eligible glowing cosmetics.
   *
   * Three steps, in this order, and the order is the whole design:
   *
   *   1. KEEP. A slot whose owner is still eligible keeps it. Nothing is reconsidered, so two
   *      wearers drifting past each other at similar distances cannot make a light flicker
   *      between them every frame.
   *   2. RELEASE. A slot whose owner has become ineligible (walked out of sight, took the item
   *      off, dawn came) fades to zero and only lets go once it is dark — so the light goes out
   *      where it was, instead of snapping off.
   *   3. CLAIM. Empty, fully-dark slots take the nearest unserved candidate.
   *
   * The sort is over candidates only, which is at most the number of glowing cosmetics on
   * screen — in practice zero or one, and the whole function early-outs at zero.
   */
  private stepGlow(delta: number, ctx: EffectContext) {
    let anyLight = false;
    for (const l of this.glowLights) if (l) { anyLight = true; break; }
    if (!anyLight) return;

    // --- who could have a light this frame ---
    const candidates: CosmeticEntry[] = [];
    for (const entry of this.entries) {
      const glow = entry.def.effect.glow;
      if (!glow) continue;
      if (!isEffectivelyVisible(entry.group)) continue;
      if (!this.triggerActive(glow.trigger, ctx, isWearerMoving(entry.wearer))) continue;
      candidates.push(entry);
    }

    if (candidates.length > 1) {
      candidates.sort((a, b) => this.glowDistance(a, ctx) - this.glowDistance(b, ctx));
    }

    // 1 + 2: an owner that is no longer a candidate is on its way out.
    const served = new Set<CosmeticEntry>();
    for (let i = 0; i < GLOW_POOL_SIZE; i++) {
      const owner = this.glowOwners[i];
      if (owner && candidates.includes(owner)) served.add(owner);
      else if (owner) this.glowOwners[i] = null;
    }

    // 3: fill the free slots, nearest first.
    let next = 0;
    for (let i = 0; i < GLOW_POOL_SIZE; i++) {
      if (this.glowOwners[i]) continue;
      const light = this.glowLights[i];
      // Only a slot that has finished fading may take a new owner — otherwise the previous
      // owner's light would jump to the new position at whatever brightness it had left.
      if (light && light.intensity > 0.02) continue;
      while (next < candidates.length && served.has(candidates[next])) next++;
      if (next >= candidates.length) break;
      this.glowOwners[i] = candidates[next];
      served.add(candidates[next]);
      next++;
    }

    // --- drive ---
    for (let i = 0; i < GLOW_POOL_SIZE; i++) {
      const light = this.glowLights[i];
      if (!light) continue;
      const owner = this.glowOwners[i];
      const glow = owner?.def.effect.glow;

      let target = 0;
      if (owner && glow) {
        const factor = this.wearerFactor(owner);
        owner.group.getWorldPosition(scratchPos);
        const [ox, oy, oz] = glow.offset ?? [0, 0, 0];
        light.position.set(
          scratchPos.x + ox * factor,
          scratchPos.y + oy * factor,
          scratchPos.z + oz * factor,
        );
        light.color.set(glow.color);
        light.distance = glow.distance;
        target = glow.intensity;
        if (glow.pulse) {
          const t = ctx.time + owner.phase;
          target *= 1 + Math.sin(t * glow.pulse.speed * Math.PI * 2) * glow.pulse.amplitude;
        }
      }

      light.intensity += (target - light.intensity) * Math.min(1, delta * GLOW_FADE_RATE);
      // Switched off below the point it could be seen. three still uploads a disabled light's
      // uniforms, but `visible = false` takes it out of the shader's light list entirely, which
      // is where the actual per-fragment cost lives.
      const lit = light.intensity > 0.01;
      if (light.visible !== lit) light.visible = lit;
    }
  }

  /** Squared distance from the camera to a wearer's socket. */
  private glowDistance(entry: CosmeticEntry, ctx: EffectContext): number {
    entry.group.getWorldPosition(scratchPos);
    return scratchPos.distanceToSquared(ctx.cameraPos);
  }

  // --- event bursts -------------------------------------------------------

  /**
   * Fires a cosmetic's {@link BurstSpec} — the loud half of the system.
   *
   * Called from the take-off edge, so the guards here are the only thing between it and a
   * fountain, and there are three:
   *
   *   `burstCooldown`   spamming the jump key gives one burst per cooldown;
   *   the shape pool     a burst that cannot claim a slot drops it, exactly like an emitter;
   *   `counter: null`   which looks like the absence of a cap and is in fact the same choice
   *                     the series bond makes — a burst is bounded by how OFTEN it may happen
   *                     rather than by how many of its particles are alive, because unlike an
   *                     emitter it has no next burst queued behind this one.
   */
  private fireBurst(entry: CosmeticEntry, spec: BurstSpec) {
    if (entry.burstCooldown > 0) return;
    entry.burstCooldown = spec.cooldown;

    const factor = this.wearerFactor(entry);
    entry.group.getWorldPosition(scratchPos);
    const [ox, oy, oz] = spec.offset ?? [0, 0, 0];
    const baseX = scratchPos.x + ox * factor;
    const baseY = scratchPos.y + oy * factor;
    const baseZ = scratchPos.z + oz * factor;

    for (let i = 0; i < spec.count; i++) {
      const p = this.claim(spec.shape);
      if (!p) return; // pool full — drop the rest, never queue

      const angle = Math.random() * Math.PI * 2;
      p.alive = true;
      p.age = 0;
      p.life = rand(spec.lifetime[0], spec.lifetime[1]);
      p.ox = baseX + (Math.random() - 0.5) * spec.spread * factor;
      p.oy = baseY + (Math.random() - 0.5) * spec.spread * factor * 0.6;
      p.oz = baseZ + (Math.random() - 0.5) * spec.spread * factor;
      p.dirX = Math.cos(angle);
      p.dirZ = Math.sin(angle);
      p.drift = spec.drift * rand(0.6, 1.3) * factor;
      p.orbit = 0;
      p.orbitPhase = angle;
      p.rise = spec.rise * rand(0.7, 1.3) * factor;
      p.gravity = (spec.gravity ?? 0) * factor;
      p.wobbleAmp = 0;
      p.wobbleSpeed = 0;
      p.settle = spec.settle ?? 0;
      p.size = rand(spec.size[0], spec.size[1]) * factor;
      p.grow = 1;
      p.flat = SHAPE_FLAT[spec.shape];
      p.opacity = spec.opacity;
      this.randomAxis(p);
      p.spin = spec.tumble * rand(0.6, 1.4) * (Math.random() < 0.5 ? -1 : 1);
      p.angle = Math.random() * Math.PI * 2;
      p.colour.set(spec.colors[(Math.random() * spec.colors.length) | 0]);
      p.counter = null;
      this.dirty[spec.shape] = true;
    }
  }

  // --- player ↔ pet bond (section 四) --------------------------------------

  /**
   * Fires the shared-series moment when the player and the pet are wearing the same series
   * and standing together.
   *
   * Three guards, each answering one of the brief's "不要" lines:
   *   `bondCheckIn`   the test itself runs twice a second, not 60 times — nothing about two
   *                   bodies drifting together needs frame resolution;
   *   `bondCooldown`  9 seconds must pass between firings, so it is a moment, not an aura;
   *   `SERIES_BONDS`  only series with an entry can fire at all, and the burst it describes
   *                   is one larger particle between them plus two small ones each.
   */
  private stepBond(delta: number) {
    if (this.bondCooldown > 0) this.bondCooldown -= delta;
    this.bondCheckIn -= delta;
    if (this.bondCheckIn > 0) return;
    this.bondCheckIn = 0.5;
    if (this.bondCooldown > 0) return;

    const player = playerBus.playerPos;
    const pet = playerBus.dogPos;
    if (!player || !pet) return;
    if (player.distanceToSquared(pet) > BOND_RADIUS * BOND_RADIUS) return;

    const shared = this.sharedSeries();
    if (!shared) return;
    const spec = SERIES_BONDS[shared];
    if (!spec) return;

    // Between the two, at roughly chest height on the player — the point both of them read
    // as "the space we are sharing".
    const midX = (player.x + pet.x) / 2;
    const midY = Math.max(player.y, pet.y) + 0.95;
    const midZ = (player.z + pet.z) / 2;
    this.burst(spec.shape, midX, midY, midZ, spec.centreSize, spec.lifetime, spec.rise, spec.opacity, spec.colors, 1, 0.05);
    this.burst(spec.shape, player.x, player.y + 1.4, player.z, spec.sideSize, spec.lifetime * 0.8, spec.rise, spec.opacity * 0.8, spec.colors, spec.sideCount, 0.22);
    this.burst(spec.shape, pet.x, pet.y + 0.45, pet.z, spec.sideSize, spec.lifetime * 0.8, spec.rise, spec.opacity * 0.8, spec.colors, spec.sideCount, 0.22);

    this.bondCooldown = BOND_COOLDOWN;
  }

  /**
   * A series both a visible player cosmetic and a visible pet cosmetic are wearing, or null.
   *
   * Visibility is part of the test on purpose: the bond is something you SEE happen between
   * two characters, so a hidden wearer (first person, another view) must not be able to
   * trigger a burst in mid-air.
   */
  private sharedSeries(): CosmeticSeries | null {
    let playerSeries: Set<CosmeticSeries> | null = null;
    for (const entry of this.entries) {
      if (entry.wearer !== 'player') continue;
      if (!isEffectivelyVisible(entry.group)) continue;
      (playerSeries ??= new Set()).add(entry.def.series);
    }
    if (!playerSeries) return null;
    for (const entry of this.entries) {
      if (entry.wearer !== 'pet') continue;
      if (!isEffectivelyVisible(entry.group)) continue;
      if (playerSeries.has(entry.def.series) && SERIES_BONDS[entry.def.series]) return entry.def.series;
    }
    return null;
  }

  /** One-off particles with no owning emitter — used only by the bond. */
  private burst(
    shape: ParticleShape, x: number, y: number, z: number,
    size: number, life: number, rise: number, opacity: number,
    colors: string[], count: number, spread: number,
  ) {
    for (let i = 0; i < count; i++) {
      const p = this.claim(shape);
      if (!p) return;
      const angle = Math.random() * Math.PI * 2;
      p.alive = true;
      p.age = 0;
      p.life = life;
      p.ox = x + (Math.random() - 0.5) * spread;
      p.oy = y + (Math.random() - 0.5) * spread * 0.5;
      p.oz = z + (Math.random() - 0.5) * spread;
      p.dirX = Math.cos(angle);
      p.dirZ = Math.sin(angle);
      p.drift = 0.12;
      p.orbit = 0;
      // Every field a slot carries has to be written on every claim, because a pool slot is
      // whatever the LAST particle left in it — a bond star landing in a slot a settling
      // feather vacated would otherwise inherit its settle and freeze mid-flight.
      p.settle = 0;
      p.grow = 1;
      p.gravity = 0;
      p.wobbleAmp = 0;
      p.wobbleSpeed = 0;
      p.flat = SHAPE_FLAT[shape];
      p.rise = rise;
      p.size = size * rand(0.85, 1.15);
      p.opacity = opacity;
      this.randomAxis(p);
      p.spin = 0.5;
      p.angle = Math.random() * Math.PI * 2;
      p.colour.set(colors[(Math.random() * colors.length) | 0]);
      // No counter: a bond burst is bounded by its cooldown, not by a per-emitter cap.
      p.counter = null;
      this.dirty[shape] = true;
    }
  }
}

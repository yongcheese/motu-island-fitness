/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { memo, useCallback, useEffect, useMemo, useRef, useSyncExternalStore } from 'react';
import { FIRST_PERSON_ZOOM } from '../../constants/cameraZoom';
import { useFrame } from '@react-three/fiber';
import * as THREE from 'three';
import { useAppPick } from '../../context/AppContext';
import { CameraMode, PlacedItem, View } from '../../types';
import { PET_SPECIES_TABLE, getPetSpec, getPetSpecies, type PetSpecies } from '../../constants/pets';
import { PetGait, PetModel } from './Pets';
import { resolveSpecialCosmetics } from '../../constants/cosmeticEffects';
import type { SpecialCosmeticDef } from '../../constants/cosmeticEffects';
import { AVATAR_BASE_SCALE } from './Avatar';
import { COMPANION_PROMPT_PRIORITY, clampFrameDelta, playerBus } from '../../lib/playerBus';
import { SHORELINE_RADIUS } from '../../constants/terrain';
import { getSurfaceAt } from '../../lib/placementSurfaces';
import { resolveHomeCollision } from './characterMovement';
import { resolvePlayerAgainstFurniture } from '../../lib/furniturePlacement';
import { ResolvedHome, usePlayerHome } from '../../hooks/usePlayerHome';
import {
  playBirdChirp,
  playBowlSet,
  playCatMew,
  playPetBark,
  playPetMunch,
  playToyBounce,
} from '../../lib/soundUtils';
import {
  PET_GREET_RADIUS,
  PET_MOODS,
  PET_NOTICE_RADIUS,
  type PetMoodDef,
} from '../../constants/islandReturn';
import {
  PET_BEHAVIORS,
  PET_DECISION_INTERVAL_SECONDS,
  combinePetMotion,
  decidePetBehavior,
  petActivityResponse,
  petCondition,
  settlePetCare,
  type PetBehaviorDef,
  type PetBehaviorId,
  type PetCareState,
  type PetMotionScale,
} from '../../constants/petCare';
import { resolveRestingSpot, type PetRestingSpot } from '../../lib/petRestingSpots';
import { readPetCare } from '../../context/usePetCare';
import {
  PET_FEED,
  PET_NOTICE,
  PET_PETTING,
  PET_PLAY,
  PET_PLAY_STYLE,
  PET_REACTIONS,
  PET_SLEEP_BREATH,
  type PetReactionId,
} from '../../constants/petInteractions';
import {
  currentPetActivity,
  currentPetReaction,
  endPetActivity,
  finishPetActivity,
  playPetReaction,
  startPlay,
  subscribePetActivity,
  sweepPetActivities,
} from '../../lib/petActivity';
import {
  addPetReaction,
  bowlSpot,
  eatStandSpot,
  emptyReactionFrame,
  returnSpot,
  throwLanding,
  toyFlightPosition,
  toyRestPoint,
  type PetReactionFrame,
} from '../../lib/petReaction';

/**
 * 島上的寵物 — the companion equipped in the 更衣室, out on the island walking beside its owner.
 *
 * The dressing room already shows the same animal standing at the character's side (Pets.tsx's
 * CompanionPet, a fixed offset inside the stage), and picking one there is the only way to get one
 * here: this file is that same choice given the island's rules — ground to stand on, a house and
 * furniture to walk around, water not to walk into, and an owner who moves.
 *
 * The MODEL is not redrawn. `PetModel` is the one build of every breed, unit-height and facing +z,
 * shared with the shop icon's palette (constants/pets.ts); everything here is where that model is
 * put each frame and how it is turned. So a new breed still costs one row in constants/pets.ts and
 * nothing in this file.
 *
 * ## What the owner does WITH the animal
 *
 * Three layers now decide where the animal goes each frame, in order of who wins:
 *
 *   1. an ACTIVITY the owner started (lib/petActivity.ts) — being petted, eating from a bowl,
 *      chasing a toy. Resolved into a point and a pace by {@link driveActivity}.
 *   2. a short hold after a reaction that needs the animal to stay put (the stretch on getting up).
 *   3. its own BEHAVIOUR (usePetBehaviour) — following, exploring, going to bed.
 *
 * On top of whichever wins, a REACTION (constants/petInteractions.ts) is laid over the pose: a hop, a
 * lean, a wag. Every activity ends on its own clock and every reaction returns to rest, so an animal
 * cannot be left stuck mid-meal, mid-chase or mid-petting whatever the owner does — see
 * `scripts/test-pet-interactions.ts`.
 *
 * WORLD SPACE — unlike Pets.tsx (avatar-local) every number below is in island world units, where
 * the character stands ~2.1 tall and walks at ~5.5/s. The one bridge between the two spaces is
 * AVATAR_BASE_SCALE, applied to the breed's local `height` exactly as the dressing room applies it,
 * so a companion is the same size against its owner indoors and out.
 */

/** Species that walk. 鳥 fly, and take the whole separate branch further down. */
const WALKER = {
  /**
   * The follow slot, measured from the owner: out to their RIGHT and BEHIND them.
   *
   * Behind, where the dressing room's companion stands slightly in FRONT — the two screens want
   * opposite things. That one is a fixed front-on portrait where anything behind the shoulder line
   * is hidden by the very character it is being shown next to; here the camera orbits freely and
   * the owner is walking, and a pet ahead of a moving owner is a pet being walked into.
   *
   * Sideways is a little over half the character's shoulder width from their centre line, which is
   * heel-close without the pet and the owner sharing a footprint on a tight turn.
   *
   * Both of these are the ORBITING camera's numbers. First person replaces them wholesale — the
   * viewer is the owner there, so behind the shoulder is off screen; see {@link FIRST_PERSON}.
   */
  side: 0.95,
  back: 0.8,
  /**
   * Settle/resume radii, deliberately different. One threshold makes a pet that has just arrived
   * sit exactly on the line and stutter between walking and standing every frame; leaving twice
   * the slack before it sets off again means it only moves when the owner has really gone.
   */
  stop: 0.32,
  resume: 0.62,
  /**
   * Speed per unit of distance, and the ceiling on it. The ceiling is above the player's own
   * ~5.5/s on purpose — a follower capped at its owner's speed can never close a gap, so one
   * sprint by the player leaves the pet permanently a stride behind.
   */
  gain: 4.2,
  maxSpeed: 7.6,
  /** How fast the body turns to face where it is going, in radians of correction per second. */
  turnRate: 9,
  /**
   * Past this the pet is moved rather than walked. Nothing on the island is this far from the
   * follow slot by walking: it is the teleports — 領土 expansion, climbing out of the interior,
   * a hammock dismount — where a pet that insisted on walking would visibly trek across the map.
   */
  snap: 9,
} as const;

/** 鳥 — the same idea, but a slot in the air and no ground to keep contact with. */
const FLYER = {
  /**
   * Further out than a walker stands, and for a reason a walker doesn't have: a bird flies at the
   * owner's HEAD, and this avatar is 大頭小身 — the skull alone reaches ~0.59 out from the centre
   * line (radius 0.26 local at AVATAR_BASE_SCALE), against a torso of half that. At the walkers'
   * 0.85 the bird's inward drift put it through the character's cheek; this clears the skull plus
   * the bird's own half-width at the innermost point of the drift below.
   */
  side: 1.12,
  /** Behind the shoulder, so a bird at head height never crosses the face the camera is on. */
  back: 0.35,
  /**
   * How high above the owner's feet it flies. The character's crown is at ~2.13 world units, so
   * this is shoulder-to-ear height: plainly airborne, never mistaken for a hat.
   */
  height: 1.45,
  /**
   * How fast the bird closes on its slot, as an exponential rate. Much slower than a walker's
   * pursuit, and that lag IS the animation — the bird sweeps after a departing owner and coasts
   * past the slot when they stop, which is what makes it read as flying rather than as being
   * dragged along on a stick.
   */
  chase: 3.2,
  /**
   * The hover wander, in the same spirit as Pets.tsx's BIRD_HOVER: three sines whose speeds are
   * deliberately not multiples of one another, so the path takes minutes to repeat instead of
   * closing into a visible loop every few seconds.
   */
  driftX: 0.18, driftY: 0.12, driftZ: 0.19,
  speedX: 0.55, speedY: 0.9, speedZ: 0.37,
  /** Never closer to the ground than this, so a bird over the beach doesn't scrape the sand. */
  clearance: 0.85,
  turnRate: 6,
  snap: 12,
} as const;

/**
 * 第一人稱 — where the companion stands when the camera is inside the owner's head.
 *
 * Both slots above put the pet BEHIND the owner's shoulder, which is right for every orbiting
 * camera and exactly wrong for this one: in first person the viewer IS the owner, looking along
 * their own facing, so "just behind the shoulder" is the one place in the world guaranteed to be
 * off screen. A player who buys a companion and switches to first person had, until this, bought
 * something they could only see by spinning on the spot.
 *
 * So the slot flips to the FRONT. Three things had to be true of the numbers, and they are what
 * these are:
 *
 *  1. **Far enough forward to clear the bottom of the frame.** The camera sits 1.65 above the
 *     owner's feet with a 68° vertical FOV (CameraController's FIRST_PERSON_FOV), so anything on
 *     the ground closer than ~2.5 falls below the lower edge. A walker at the dressing room's
 *     heel-close distance is not "in front of the player", it is under their chin and invisible.
 *     3.4 puts a knee-high dog about a quarter of the way up the frame with the camera level.
 *  2. **Off to one side, but not far.** Dead ahead, the pet sits on the crosshair and covers
 *     whatever the player is walking toward. Keeping it on the owner's right — the same side it
 *     uses in every other mode, so the pet does not appear to change hands when the camera changes
 *     — puts it ~13° off centre. That number is set by the NARROWEST screen the game runs on, not
 *     by taste: `fov` is the VERTICAL angle, so a portrait phone (9:16) has a far tighter
 *     horizontal one, and an offset that sits comfortably inboard on a desktop is against the
 *     right edge on a phone. These land the pet ~60% across a 16:9 window and ~80% across a 9:16
 *     one — off centre on both, inside the frame on both.
 *  3. **A bird nearer and at eye level.** It is the smaller animal and it is allowed to be closer
 *     without being walked into, and at 1.62 it flies where the camera is already looking instead
 *     of at the owner's shoulder.
 *
 * `turn` is deliberately slower than the pet's own top speed can service. A player in first person
 * spins the view far more often and far faster than a player orbiting a character does, and a slot
 * pinned rigidly to the look direction would keep the pet permanently sprinting in a circle around
 * them. Easing the slot lets a quick look left and back cost the pet nothing, while a real turn
 * still brings it round in about a second.
 */
export const FIRST_PERSON = {
  walkAhead: 3.4,
  walkSide: 0.8,
  flyAhead: 2.4,
  flySide: 0.55,
  flyHeight: 1.62,
  turn: 3.5,
  /**
   * The walker's pursuit gain while first person is active, replacing WALKER.gain's 4.2.
   *
   * A proportional follower settles wherever its speed matches its owner's, so at 4.2 a pet
   * trailing a player walking at ~5.5 sits a permanent 5.5/4.2 ≈ 1.3 SHORT of its slot. Behind the
   * shoulder that lag is invisible and is half of what makes the follow look alive. In front of
   * the camera it is the difference between a companion and a pair of ears at the bottom of the
   * screen: 1.3 short of 3.4 puts the pet 2.1 away, where its feet fall below the frame's lower
   * edge and a walking player sees a dog cut off at the shoulders.
   *
   * 9 holds the lag to ~0.6 and keeps the whole animal in frame at a walk. It stays under
   * WALKER.maxSpeed at that lag (0.6 × 9 ≈ 5.5), so the ceiling still does what it is for —
   * catching up after a teleport — rather than becoming the thing that limits ordinary following.
   */
  gain: 9,
} as const;

/**
 * How much room the pet keeps from a solid prop, and from the walls of the Home.
 *
 * Smaller than the player's own PLAYER_PHYSICAL_RADIUS (0.35) — squeezing past the furniture is in
 * character for something knee-high, and a follower held as far off the walls as its owner cannot
 * reach its own follow slot in the narrow places the owner walks through.
 */
const PET_RADIUS = 0.22;

/**
 * How far the pet travels per half step cycle, as a fraction of its own height — one leg swing
 * forward carries it this much island.
 *
 * Measured against the animal rather than fixed, so the step rate follows the build: at 0.55 a
 * knee-high dog takes a stride a little over a third of a metre, which at walking pace is about two
 * cycles a second — a trot, which is what a dog keeping up with a walking person actually does.
 * Larger and the legs windmill; smaller and it moon-walks.
 */
const STRIDE_LENGTH = 0.55;

/**
 * How long owner AND pet must both be still before the 摸摸 prompt is offered.
 *
 * A companion is within arm's reach every second of the game, so an unconditional prompt would be
 * permanently on screen whenever nothing else was. Requiring both to have stopped turns it into
 * what it reads as: you crouch down to your pet when you stop, not while jogging past it.
 * {@link COMPANION_PROMPT_PRIORITY} handles the other half, putting it in a tier below anything the
 * player deliberately walked up to — so it can never take the key from the front door.
 */
const PET_SETTLE_TIME = 0.45;

/** Shortest-path angle blend, so a pet turning past ±π doesn't spin the long way round. */
function turnToward(current: number, target: number, alpha: number): number {
  const delta = Math.atan2(Math.sin(target - current), Math.cos(target - current));
  return current + delta * alpha;
}

/** Frame-rate independent easing: the fraction of the remaining gap to close this frame. */
function easeAlpha(rate: number, delta: number): number {
  return 1 - Math.exp(-rate * delta);
}

/**
 * Walks a point back to dry land, along the line to the island's centre.
 *
 * The owner swims; the dog and the cat do not. Without this the follow slot goes out to sea with
 * the swimmer and the pet marches in after it along the seabed. Pulling the slot to just inside the
 * waterline instead leaves the pet waiting at the water's edge nearest its owner, which is both the
 * correct behaviour and the one that looks deliberate.
 */
function clampToLand(p: { x: number; z: number }, placements: PlacedItem[], islandScale: number): void {
  if (getSurfaceAt(p.x, p.z, placements, islandScale).isSolid) return;
  const shore = SHORELINE_RADIUS * islandScale * 0.94;
  const dist = Math.hypot(p.x, p.z);
  if (dist > shore && dist > 1e-6) {
    p.x *= shore / dist;
    p.z *= shore / dist;
  }
}

/**
 * The yaw the follow slot is laid out along — the owner's FACING normally, and the owner's VIEW in
 * first person.
 *
 * They are not the same question, and in first person only the second one is right. Avatar.tsx
 * steers the character by the camera while first person is active, but it does that inside its
 * "is moving" branch: a player standing still and looking around leaves `playerRotation` at
 * whatever heading they last walked on, so a slot built from it would let the pet drift out of
 * frame exactly when the player is standing still and looking at things — which is most of the
 * time they would notice a companion at all.
 *
 * `cameraYaw` is written every frame by CameraController in every one of its branches, so it is
 * the one value that always describes where the player is actually looking. It needs the half turn:
 * a camera looks down its own -Z where a model faces +Z, which is the same conversion
 * miniMapCore.ts's `cameraYawToViewDeg` states once for the map. It is stated again here rather
 * than shared because that one returns map-frame DEGREES and this needs world-frame radians;
 * what must not happen is either of them growing a bare `+ 180` at a call site.
 */
function slotHeading(firstPerson: boolean): number {
  const facing = playerBus.playerRotation ?? 0;
  if (!firstPerson) return facing;
  return playerBus.cameraYaw === undefined ? facing : playerBus.cameraYaw + Math.PI;
}

/** The owner's facing as a pair of unit vectors: where they look, and which way their right is. */
function ownerAxes(yaw: number) {
  const sin = Math.sin(yaw);
  const cos = Math.cos(yaw);
  // Avatar rotation is atan2(dirX, dirZ), so forward is (sin, cos) and the character's own right —
  // the -x side of its local space, the side Pets.tsx stands the companion on — is (-cos, sin).
  return { fx: sin, fz: cos, rx: -cos, rz: sin };
}

/**
 * How high above the ground a flying companion comes to rest at a given spot.
 *
 * The habitat's declared height when it has one; otherwise just off the ground, which is what the
 * improvised nest (a mat) and any future ground-level bird spot mean. Kept as a function rather
 * than inlined because it is a RULE about a resting place — one that both the settle above and any
 * future landing animation have to agree on.
 */
function restingHeight(spot: PetRestingSpot): number {
  return spot.height > 0 ? spot.height : FLYER.clearance * 0.9;
}

/**
 * Everything about the island a follower has to obey, handed down rather than read from context.
 *
 * The two movers below are pure "given this world, walk beside the player": the profile is read
 * once, in IslandPet, so a preview harness (tmp-petfollow.tsx) can mount either of them against a
 * bare island with no auth, no profile and no provider — which is the only way the follow maths is
 * verifiable outside a logged-in browser.
 */
interface PetWorld {
  islandScale: number;
  placements: PlacedItem[];
  home: ResolvedHome | null;
}

/* --- Voice ----------------------------------------------------------------------------------- */

/**
 * The noise this animal makes when it is pleased — by species, so a cat that has just been petted
 * does not bark (the mini-game used to play the dog's bark for every animal).
 */
const PET_VOICE: Record<PetSpecies, (volume?: number) => void> = {
  dog: playPetBark,
  cat: playCatMew,
  bird: playBirdChirp,
};

/** Which reactions are voiced, and how loudly. Everything else is silent — most of them are small. */
const REACTION_VOICE: Partial<Record<PetReactionId, number>> = {
  happy: 0.26,
  notice: 0.12,
  drop: 0.18,
  pounce: 0.14,
};

/** Voices a reaction once, on the frame it starts. `lastVoiced` is the startedAt last voiced. */
function voiceReaction(itemId: string, lastVoiced: { current: number }): void {
  const r = currentPetReaction(itemId);
  if (!r || r.startedAt === lastVoiced.current) return;
  lastVoiced.current = r.startedAt;
  const volume = REACTION_VOICE[r.id];
  const species = getPetSpecies(itemId);
  if (volume != null && species) PET_VOICE[species](volume);
}

/* --- What the owner is doing with the animal ------------------------------------------------- */

/**
 * 進食 — how far through its meal this animal is, 0..1, or null when it is not eating.
 *
 * Reads the eat ACTIVITY (lib/petActivity.ts) and answers from the clock, so the pose and the hearts
 * can read it independently in the same frame without either consuming it.
 */
function eatingProgress(itemId: string, now: number): number | null {
  const a = currentPetActivity(itemId);
  if (a?.kind !== 'eat' || a.eatingSince == null || a.doneAt != null) return null;
  const elapsed = (now - a.eatingSince) / 1000;
  if (elapsed < 0 || elapsed >= PET_FEED.eatSeconds) return null;
  return elapsed / PET_FEED.eatSeconds;
}

/**
 * What an activity asks of the mover this frame. Filled in place by {@link driveActivity}; one per
 * mover, never allocated per frame.
 */
interface ActivityDrive {
  /** An activity is steering the animal this frame. */
  active: boolean;
  /** Walk to (slotX, slotZ). When false while active, stay exactly where you are. */
  hasSlot: boolean;
  slotX: number;
  slotZ: number;
  /** Pace multiplier while active. */
  pace: number;
  /** Face (faceX, faceZ) when not walking. When false, face the owner as usual. */
  hasFace: boolean;
  faceX: number;
  faceZ: number;
  /** Heads down in the bowl. */
  eating: boolean;
  /** 0..1 — the petting lean-in, eased by the mover. */
  nuzzle: number;
  /** Hide the 與寵物互動 prompt: pressing it mid-meal or mid-fetch would only start something over. */
  busy: boolean;
  /** Flying animals only: how high to hover (world y) while this activity has them low. */
  hoverY: number | null;
}

function createDrive(): ActivityDrive {
  return {
    active: false, hasSlot: false, slotX: 0, slotZ: 0, pace: 1,
    hasFace: false, faceX: 0, faceZ: 0, eating: false, nuzzle: 0, busy: false, hoverY: null,
  };
}

const LAND_SCRATCH = new THREE.Vector3();
const TOY_SCRATCH = { x: 0, y: 0, z: 0 };

/**
 * Moves a point to somewhere an animal (or a bowl, or a toy) can actually be: out of the Home, out
 * of the placed furniture, back onto dry land. The same three rules, in the same order, the animal's
 * own position is held to — so a bowl is never put down inside a sofa and a ball never lands in the
 * sea where the dog would stand at the waterline forever.
 */
function settleOnLand(p: { x: number; z: number }, world: PetWorld, radius: number): void {
  LAND_SCRATCH.set(p.x, 0, p.z);
  if (world.home) resolveHomeCollision(LAND_SCRATCH, world.home, radius);
  const pushed = resolvePlayerAgainstFurniture(LAND_SCRATCH.x, LAND_SCRATCH.z, radius, world.placements);
  p.x = pushed.x;
  p.z = pushed.z;
  clampToLand(p, world.placements, world.islandScale);
}

function groundAt(x: number, z: number, world: PetWorld): number {
  return getSurfaceAt(x, z, world.placements, world.islandScale).y;
}

/**
 * Turns this animal's current activity into what the mover should do this frame — and advances the
 * activity's own phases as the animal gets where it was going.
 *
 * The ONE place an activity becomes movement, for the same reason `applyBehaviorSlot` is the one
 * place a behaviour does: the walk, the collisions and the gait below never learn what a bowl or a
 * ball is. They are handed a point, a pace and a direction to look.
 *
 * Every branch has a way out that does not depend on the animal succeeding: a bowl it cannot reach
 * is eaten from where it stands after `approachTimeout`; a toy it cannot reach is abandoned after
 * `maxSeconds`; an owner who walks off ends petting and play. That is what 「寵物卡在互動狀態」 would
 * need to get past, and there is no path through.
 */
function driveActivity(
  d: ActivityDrive,
  itemId: string,
  size: number,
  airborne: boolean,
  pos: THREE.Vector3,
  player: THREE.Vector3,
  playerYaw: number,
  world: PetWorld,
  now: number,
  munchAt: { current: number },
): void {
  d.active = false;
  d.hasSlot = false;
  d.pace = 1;
  d.hasFace = false;
  d.eating = false;
  d.nuzzle = 0;
  d.busy = false;
  d.hoverY = null;

  const a = currentPetActivity(itemId);
  if (!a) return;
  const setSlot = (x: number, z: number) => { d.hasSlot = true; d.slotX = x; d.slotZ = z; };
  const setFace = (x: number, z: number) => { d.hasFace = true; d.faceX = x; d.faceZ = z; };
  const ownerDist = Math.hypot(player.x - pos.x, player.z - pos.z);

  switch (a.kind) {
    case 'petting': {
      // The owner walked away mid-petting: it is over, whatever the mini-game still says.
      if (ownerDist > PET_PETTING.closeIn + 3) {
        finishPetActivity(itemId, now);
        return;
      }
      d.active = true;
      d.nuzzle = 1;
      setFace(player.x, player.z);
      // Close the last bit of distance so the hand actually reaches — but only if it is needed, so a
      // pet already at the owner's feet does not shuffle.
      if (ownerDist > PET_PETTING.closeIn + 0.35) {
        const k = PET_PETTING.closeIn / ownerDist;
        setSlot(player.x + (pos.x - player.x) * k, player.z + (pos.z - player.z) * k);
        d.pace = 0.9;
      }
      return;
    }

    case 'eat': {
      d.active = true;
      d.busy = true;
      if (!a.bowl) {
        const spot = bowlSpot({ x: player.x, z: player.z, yaw: playerYaw }, pos);
        settleOnLand(spot, world, PET_FEED.bowlRadius + 0.05);
        a.bowl = { x: spot.x, y: groundAt(spot.x, spot.z, world), z: spot.z };
      }
      const bowl = a.bowl;
      setFace(bowl.x, bowl.z);
      if (a.doneAt != null) return; // licking the empty bowl while it fades

      if (a.eatingSince == null) {
        const stand = eatStandSpot(bowl, player, size);
        settleOnLand(stand, world, PET_RADIUS);
        const waited = (now - a.startedAt) / 1000;
        const dist = Math.hypot(stand.x - pos.x, stand.z - pos.z);
        const arrived = dist < PET_FEED.arriveRadius + (airborne ? 0.2 : 0);
        if ((arrived && waited >= PET_FEED.bowlAppearSeconds) || waited >= PET_FEED.approachTimeout) {
          a.eatingSince = now;
          munchAt.current = now + 250;
        } else {
          setSlot(stand.x, stand.z);
          if (airborne) d.hoverY = bowl.y + size * 0.9;
          return;
        }
      }

      d.eating = true;
      if (airborne) d.hoverY = bowl.y + size * 0.5;
      if (now >= munchAt.current) {
        playPetMunch(0.09);
        munchAt.current = now + PET_FEED.munchEvery * 1000;
      }
      if ((now - a.eatingSince) / 1000 >= PET_FEED.eatSeconds) {
        finishPetActivity(itemId, now);
        playPetReaction(itemId, 'happy', now);
      }
      return;
    }

    case 'play': {
      if (a.phase === 'done') return; // the toy is fading; the animal is its own again
      d.active = true;
      d.busy = true;
      const P = PET_PLAY;

      if (!a.from || !a.to) {
        // Resolved HERE, on the first frame, because this is the only place that knows where the
        // owner is facing and what the ground under the landing point is.
        const land = throwLanding(
          { x: player.x, z: player.z, yaw: playerYaw },
          P.throwMin + Math.random() * (P.throwMax - P.throwMin),
        );
        // The margin covers the roll after the bounce, so the toy's resting place is clear too.
        settleOnLand(land, world, P.toyRadius + P.rollOn + 0.15);
        a.from = {
          x: player.x + Math.sin(playerYaw) * 0.35,
          y: player.y + P.handHeight,
          z: player.z + Math.cos(playerYaw) * 0.35,
        };
        a.to = { x: land.x, y: groundAt(land.x, land.z, world) + P.toyRadius, z: land.z };
        a.phase = 'flight';
        a.phaseSince = now;
        playPetReaction(itemId, 'ready', now);
        // The owner's half: turn to where it is going and throw (Three/Avatar.tsx, the `toss` posture).
        window.dispatchEvent(new CustomEvent('pet-toss', { detail: { x: land.x, z: land.z } }));
      }
      const from = a.from;
      const to = a.to;

      if (Math.hypot(player.x - to.x, player.z - to.z) > P.leash || now - a.startedAt > P.maxSeconds * 1000) {
        finishPetActivity(itemId, now);
        return;
      }

      const elapsed = (now - a.startedAt) / 1000;
      const rest = toyRestPoint(from, to);
      const landed = elapsed >= P.flightSeconds + P.bounces * P.bounceSeconds;

      switch (a.phase) {
        case 'flight':
          // Crouched and wagging, watching it go. Sets off while the toy is still in the air.
          setFace(to.x, to.z);
          if (elapsed >= P.flightSeconds * P.chaseAt) {
            a.phase = 'chase';
            a.phaseSince = now;
          }
          return;

        case 'chase': {
          d.pace = P.chasePace;
          if (airborne) {
            // A bird goes after the toy itself, over it, rather than to where it will stop.
            const toy = toyFlightPosition(from, to, elapsed, TOY_SCRATCH).point;
            setSlot(toy.x, toy.z);
            d.hoverY = toy.y + size * 0.9;
            if (landed && Math.hypot(pos.x - rest.x, pos.z - rest.z) < P.reachRadius + 0.3) {
              a.restAt = { ...rest };
              a.phase = 'return';
              a.phaseSince = now;
              playPetReaction(itemId, 'circle', now);
            }
            return;
          }
          setSlot(rest.x, rest.z);
          if (landed && Math.hypot(pos.x - rest.x, pos.z - rest.z) < P.reachRadius) {
            a.phase = 'return';
            a.phaseSince = now;
            if (a.style === 'fetch') {
              a.carried = true;
              playPetReaction(itemId, 'pickup', now);
            } else {
              a.restAt = { ...rest };
              playPetReaction(itemId, 'pounce', now);
            }
          }
          return;
        }

        case 'return': {
          // A beat at the toy first — the pickup, the pounce, the circle — then back to the owner.
          const beat = PET_REACTIONS[a.style === 'fetch' ? 'pickup' : a.style === 'pounce' ? 'pounce' : 'circle'].seconds;
          if ((now - a.phaseSince) / 1000 < beat) {
            setFace(rest.x, rest.z);
            return;
          }
          const back = returnSpot({ x: player.x, z: player.z, yaw: playerYaw });
          settleOnLand(back, world, PET_RADIUS);
          setSlot(back.x, back.z);
          if (airborne) d.hoverY = player.y + FLYER.height;
          // A dog trots back with its prize; a cat saunters, pleased with itself.
          d.pace = a.carried ? 1.1 : 0.75;
          if (Math.hypot(pos.x - back.x, pos.z - back.z) < P.returnRadius + (airborne ? 0.4 : 0)) {
            if (a.carried) {
              a.carried = false;
              const k = ownerDist > 1e-4 ? (size * 0.55) / ownerDist : 0;
              const dropX = pos.x + (player.x - pos.x) * k;
              const dropZ = pos.z + (player.z - pos.z) * k;
              a.restAt = { x: dropX, y: groundAt(dropX, dropZ, world) + P.toyRadius, z: dropZ };
              playPetReaction(itemId, 'drop', now);
            } else {
              playPetReaction(itemId, 'happy', now);
            }
            finishPetActivity(itemId, now);
          }
          return;
        }

        default:
          return;
      }
    }
  }
}

/** While a fetched toy is carried, it rides in the animal's mouth — rewritten every frame. */
function carryToy(itemId: string, pos: THREE.Vector3, yaw: number, size: number): void {
  const a = currentPetActivity(itemId);
  if (a?.kind !== 'play' || !a.carried) return;
  const mouth = a.restAt ?? (a.restAt = { x: 0, y: 0, z: 0 });
  mouth.x = pos.x + Math.sin(yaw) * size * 0.5;
  mouth.z = pos.z + Math.cos(yaw) * size * 0.5;
  mouth.y = pos.y + size * 0.42;
}

/** The reaction and the petting lean-in, sampled into one frame of offsets. */
function sampleReactions(
  out: PetReactionFrame,
  itemId: string,
  now: number,
  airborne: boolean,
  nuzzleWeight: number,
): void {
  out.hop = 0; out.pitch = 0; out.drop = 0; out.roll = 0; out.spin = 0; out.wag = 0;
  const r = currentPetReaction(itemId);
  if (r) addPetReaction(out, r.id, (now - r.startedAt) / 1000, airborne);
  if (nuzzleWeight > 0.01) {
    const a = currentPetActivity(itemId);
    const since = a?.kind === 'petting' ? a.startedAt : now;
    // The lean-in is one reaction looped; its envelope starts and ends at rest, so the loop is seamless.
    const loop = PET_REACTIONS.nuzzle.seconds;
    addPetReaction(out, 'nuzzle', ((now - since) / 1000) % loop, airborne, nuzzleWeight);
  }
}

/**
 * The little hearts that rise off an animal while it eats (§19) and when it is delighted.
 *
 * Mounted INSIDE the companion's own group, so it is in the animal's local space: the hearts are
 * sized and placed as a fraction of the pet's own height and therefore look the same over a 柴犬
 * and over a 金絲雀 without a single per-species number. It also means they follow the animal for
 * free — no second position to keep in step with the one the mover is already writing.
 *
 * Deliberately three small shapes rather than a particle system. The brief asks for 「小型粒子效果」
 * and explicitly not for 過度浮誇: at the island camera's distance, three hearts drifting up and
 * fading is legible and a shower of sprites is a smudge. Nothing here allocates per frame, and the
 * whole group is `visible = false` — and therefore not drawn or traversed for rendering — on every
 * frame the animal is not eating or delighted, which is almost all of them.
 */
const HEART_COLOUR = '#E4736A';

function PetHearts({ itemId }: { itemId: string }) {
  const group = useRef<THREE.Group>(null);
  const hearts = useRef<THREE.Group[]>([]);
  // One shared material, mutated once per frame: three materials would be three opacity writes
  // saying the same thing, and the hearts fade together anyway.
  const material = useMemo(
    () =>
      new THREE.MeshStandardMaterial({
        color: HEART_COLOUR,
        roughness: 0.75,
        transparent: true,
        opacity: 0,
        depthWrite: false,
      }),
    [],
  );
  useEffect(() => () => material.dispose(), [material]);

  useFrame(() => {
    const g = group.current;
    if (!g) return;
    const now = performance.now();
    let progress = eatingProgress(itemId, now);
    if (progress === null) {
      const r = currentPetReaction(itemId);
      if (r?.id === 'happy') {
        const p = (now - r.startedAt) / 1000 / PET_REACTIONS.happy.seconds;
        if (p >= 0 && p < 1) progress = p;
      }
    }
    if (progress === null) {
      g.visible = false;
      return;
    }
    g.visible = true;
    hearts.current.forEach((heart, i) => {
      if (!heart) return;
      // Each heart is a third of a cycle behind the one before it, so they leave in sequence
      // rather than as one clump — the difference between 「牠很開心」 and a firework.
      const own = (progress * 1.9 - i * 0.28) % 1;
      const alive = own > 0 && own < 1;
      heart.visible = alive;
      if (!alive) return;
      heart.position.set(
        Math.sin(own * 3.4 + i * 2.1) * 0.34,
        1.35 + own * 1.1,
        Math.cos(own * 2.6 + i) * 0.2,
      );
      // Pops to full size in the first fifth of its life, then holds — a heart that grows the whole
      // way up reads as approaching the camera rather than as drifting off.
      const scale = Math.min(1, own * 5) * (0.9 - i * 0.12);
      heart.scale.setScalar(scale);
    });
    // Fade the set as it ends, so nothing blinks out mid-air.
    material.opacity = Math.min(1, (1 - progress) * 2.2) * 0.9;
  });

  return (
    <group ref={group} visible={false}>
      {[0, 1, 2].map((i) => (
        <group
          key={i}
          ref={(node) => {
            if (node) hearts.current[i] = node;
          }}
        >
          {/* Two lobes and a point, at a scale where a proper heart mesh would be four pixels.
              Built from primitives for the same reason every other model in this project is. */}
          <mesh position={[-0.11, 0.1, 0]} material={material}>
            <sphereGeometry args={[0.15, 8, 6]} />
          </mesh>
          <mesh position={[0.11, 0.1, 0]} material={material}>
            <sphereGeometry args={[0.15, 8, 6]} />
          </mesh>
          <mesh position={[0, -0.09, 0]} rotation={[Math.PI, 0, 0]} material={material}>
            <coneGeometry args={[0.2, 0.3, 8]} />
          </mesh>
        </group>
      ))}
    </group>
  );
}

/**
 * The bowl — a real object on the ground, not an icon.
 *
 * Mounted only while an eat activity exists for this animal (see IslandPet), so an island with a
 * well-fed dog has no bowl meshes at all. It pops in at the bottom of the owner's crouch, the kibble
 * in it goes down as the animal eats, and it fades out when the meal is over — every stage read off
 * the activity's own timestamps, so a bowl scrolled back into view mid-meal is exactly as empty as
 * it should be.
 */
export function PetBowl({ itemId, small }: { itemId: string; small: boolean }) {
  const group = useRef<THREE.Group>(null);
  const food = useRef<THREE.Mesh>(null);
  const sounded = useRef(0);

  useFrame(() => {
    const g = group.current;
    const a = currentPetActivity(itemId);
    if (!g) return;
    if (a?.kind !== 'eat' || !a.bowl) {
      g.visible = false;
      return;
    }
    const now = performance.now();
    const appearAt = a.startedAt + PET_FEED.bowlAppearSeconds * 1000;
    if (now < appearAt) {
      g.visible = false;
      return;
    }
    if (sounded.current !== a.startedAt) {
      sounded.current = a.startedAt;
      playBowlSet(0.2);
    }
    const pop = Math.min(1, (now - appearAt) / 220);
    // A small overshoot on the way in: the bowl lands, it is not placed by a crane.
    const popScale = pop < 1 ? pop * (1 + 0.12 * Math.sin(pop * Math.PI)) : 1;
    const fade = a.doneAt != null ? Math.max(0, 1 - (now - a.doneAt) / (PET_FEED.fadeSeconds * 1000)) : 1;
    g.visible = fade > 0.001;
    g.position.set(a.bowl.x, a.bowl.y, a.bowl.z);
    g.scale.setScalar(Math.max(0.001, popScale * fade * (small ? 0.72 : 1)));
    if (food.current) {
      const eaten = a.eatingSince != null
        ? Math.min(1, (now - a.eatingSince) / (PET_FEED.eatSeconds * 1000))
        : 0;
      food.current.visible = eaten < 0.97;
      food.current.scale.set(1, Math.max(0.05, 1 - eaten), 1);
    }
  });

  const r = PET_FEED.bowlRadius;
  return (
    <group ref={group} visible={false}>
      {/* Muted teal glaze outside, cream inside — the island's own palette, not a red dog dish. */}
      <mesh position={[0, 0.045, 0]} castShadow>
        <cylinderGeometry args={[r, r * 0.78, 0.09, 12, 1, true]} />
        <meshStandardMaterial color="#7fb8ae" roughness={0.6} side={THREE.DoubleSide} />
      </mesh>
      <mesh position={[0, 0.09, 0]} rotation={[Math.PI / 2, 0, 0]}>
        <torusGeometry args={[r, 0.014, 6, 16]} />
        <meshStandardMaterial color="#f4ead7" roughness={0.55} />
      </mesh>
      <mesh position={[0, 0.006, 0]} rotation={[-Math.PI / 2, 0, 0]}>
        <circleGeometry args={[r * 0.78, 12]} />
        <meshStandardMaterial color="#f4ead7" roughness={0.7} />
      </mesh>
      <mesh ref={food} position={[0, 0.01, 0]}>
        {/* A low dome of kibble whose origin sits at the bowl floor, so it sinks rather than shrinks
            toward its middle — see the `scale` note in constants/objectAnimations.ts. */}
        <sphereGeometry args={[r * 0.66, 10, 6, 0, Math.PI * 2, 0, Math.PI / 2]} />
        <meshStandardMaterial color="#b9854f" roughness={0.95} />
      </mesh>
    </group>
  );
}

/**
 * The toy — a small ball, thrown, bouncing, carried and put down.
 *
 * Its position is {@link toyFlightPosition} until it is picked up, then whatever `restAt` says (the
 * animal's mouth while carried, the spot it was dropped on afterwards). Mounted only while a play
 * activity exists. It rolls as it moves, bounces audibly and fades out when the game is over.
 */
export function PetToy({ itemId }: { itemId: string }) {
  const group = useRef<THREE.Group>(null);
  const ball = useRef<THREE.Group>(null);
  const lastBounce = useRef(-1);
  const last = useRef({ x: 0, z: 0, set: false });

  useFrame(() => {
    const g = group.current;
    const a = currentPetActivity(itemId);
    if (!g) return;
    if (a?.kind !== 'play' || !a.from || !a.to) {
      g.visible = false;
      return;
    }
    const now = performance.now();
    let point;
    if (a.restAt) {
      point = a.restAt;
    } else {
      const flight = toyFlightPosition(a.from, a.to, (now - a.startedAt) / 1000, TOY_SCRATCH);
      point = flight.point;
      if (flight.bounceIndex !== lastBounce.current) {
        if (flight.bounceIndex >= 0 && flight.bounceIndex < PET_PLAY.bounces) {
          playToyBounce(Math.pow(PET_PLAY.bounceDecay, flight.bounceIndex), 0.18);
        }
        lastBounce.current = flight.bounceIndex;
      }
    }
    const fade = a.doneAt != null ? Math.max(0, 1 - (now - a.doneAt) / (PET_PLAY.fadeSeconds * 1000)) : 1;
    g.visible = fade > 0.001;
    g.position.set(point.x, point.y, point.z);
    g.scale.setScalar(Math.max(0.001, fade));

    // Roll by the distance covered, about the axis across the direction of travel.
    const l = last.current;
    if (ball.current && l.set && !a.carried) {
      const dx = point.x - l.x;
      const dz = point.z - l.z;
      const moved = Math.hypot(dx, dz);
      if (moved > 1e-5) {
        g.rotation.y = Math.atan2(dx, dz);
        ball.current.rotation.x += moved / PET_PLAY.toyRadius;
      }
    }
    l.x = point.x;
    l.z = point.z;
    l.set = true;
  });

  const r = PET_PLAY.toyRadius;
  return (
    <group ref={group} visible={false}>
      <group ref={ball}>
        <mesh castShadow>
          <icosahedronGeometry args={[r, 1]} />
          <meshStandardMaterial color="#e8836a" roughness={0.7} flatShading />
        </mesh>
        {/* One cream band, so the roll is visible — a plain sphere turning looks like a sphere sliding. */}
        <mesh>
          <torusGeometry args={[r * 1.005, r * 0.18, 6, 14]} />
          <meshStandardMaterial color="#fff4e0" roughness={0.7} />
        </mesh>
      </group>
    </group>
  );
}

/** How far over the top of the animal the prompt's arrow lands. */
const PET_PROMPT_CLEARANCE = 0.15;

/**
 * Common per-frame bookkeeping for both branches: the petting prompt's position, and whether it is
 * offered at all (see PET_SETTLE_TIME).
 */
function publishPromptTarget(
  itemId: string,
  pos: THREE.Vector3,
  settled: boolean,
  stillTime: React.MutableRefObject<number>,
  delta: number,
  scratch: THREE.Vector3,
  busy: boolean,
  size: number,
): void {
  stillTime.current = settled ? stillTime.current + delta : 0;
  playerBus.petPromptPriority = COMPANION_PROMPT_PRIORITY;
  // The interaction point is just over this animal's own head, from its own size — see
  // PlayerBusState.petPromptHeight.
  playerBus.petPromptHeight = size + PET_PROMPT_CLEARANCE;
  // Not while it is eating or chasing a toy: the one thing the prompt could do then is start
  // something over, and a second bowl under a dog halfway through its first is the stacking the
  // activity store exists to prevent.
  const ready = stillTime.current > PET_SETTLE_TIME && !busy;
  playerBus.dogPos = ready ? scratch.copy(pos) : undefined;
  // WHICH animal that position belongs to, published in the same breath as the position itself so
  // the two can never point at different pets. See PlayerBusState.petTargetId — this is what makes
  // 「餵你面前這一隻」 a fact rather than a guess.
  playerBus.petTargetId = ready ? itemId : undefined;
  // Whether the pet is on the move, for `moving`-triggered 特殊飾品 (the mushroom cap's spores,
  // the flower collar's petals). `settled` is already the answer both branches computed for the
  // petting prompt — the effect system gets it for free rather than re-deriving it from successive
  // positions, which would be both slower and wrong on the frames a pet is being pushed out of
  // furniture rather than walking.
  playerBus.dogIsMoving = !settled;
}

/**
 * 寵物的生活狀態, as the movers see it — see constants/islandReturn.ts for what sets it.
 *
 * OPTIONAL, and defaulting to 「活潑」, which is the state every pet has been in since the feature
 * existed. Two reasons that matters: the preview harnesses (tmp-petfollow.tsx, tmp-petfp.tsx) mount
 * these movers against a bare island with no profile and must keep compiling and behaving exactly
 * as before, and a save with no `islandState` — every player who predates 離線回歸 — has to get the
 * old behaviour rather than a mood resolved from a timestamp that does not exist.
 *
 * The mood is a set of MULTIPLIERS, never a second follow implementation. Everything below still
 * walks the one slot it always walked; a quiet animal walks to it more slowly, bobs less, and
 * prefers its own bed while nobody is near. That is what keeps 「寵物比較安靜」 from turning into a
 * separate AI with its own bugs.
 */
interface PetLife {
  mood?: PetMoodDef;
  /**
   * 寵物照護 as stored on the save (constants/petCare.ts), or absent.
   *
   * The RAW state, not a settled one, and deliberately: it carries the moment it was last true, so
   * the behaviour layer can settle it against the real clock at each decision and stay correct
   * through a session that runs for hours. A pre-settled number handed down here would be frozen at
   * whatever it was when the component mounted.
   *
   * Absent means 「no care state yet」 — every save that predates the feature, and every preview
   * harness (tmp-petfollow.tsx, tmp-petfp.tsx) that mounts these movers against a bare island. Both
   * get a fully-cared-for animal, which is exactly the behaviour they had before this existed.
   */
  care?: PetCareState;
  /** Where this animal may lie down — see lib/petRestingSpots.ts. Absent outside the live island. */
  restSpot?: PetRestingSpot;
  /** Called once when a returning owner is finally reached. Absent outside the live island. */
  onGreet?: () => void;
}

/* --- The behaviour layer ------------------------------------------------------------------ */

/**
 * 寵物行為層 — 「牠現在想做什麼」, kept strictly out of the per-frame walk below.
 *
 * The brief's §7 asks for a layer rather than more `if`s inside the follow logic, and this is the
 * seam: the movers still walk to ONE point every frame, exactly as they always did, and everything
 * this hook does is decide — a few times a minute — WHICH point that is and how briskly to get
 * there. So a new behaviour is a row in `PET_BEHAVIORS` (constants/petCare.ts) plus, at most, a case
 * in {@link applyBehaviorSlot}; it is never a new branch in the walk, the collisions, the gait or
 * the prompt.
 *
 * §22 is the other half of why it is a hook and not a per-frame call: the DECISION runs on
 * {@link PET_DECISION_INTERVAL_SECONDS}, the movement runs on the frame. Ten companions cost ten
 * weighted picks every few seconds, not ten per frame — and the numbers the decision needs (settling
 * the care state against the clock) are computed in the same slow pass.
 *
 * The interval is jittered per decision so two animals that mounted on the same frame do not
 * thereafter think in lockstep, which reads as a single mind driving both.
 */
function usePetBehaviour(mood: PetMoodDef, care: PetCareState | undefined, restSpot: PetRestingSpot) {
  const state = useRef({
    behavior: PET_BEHAVIORS.follow as PetBehaviorDef,
    motion: { pace: mood.pace, liveliness: mood.liveliness, nestPull: mood.nestPull } as PetMotionScale,
    activity: 1,
    /** Clock time of the next decision. 0 forces one on the first frame. */
    nextAt: 0,
    /** Where a `wander` is heading, as an offset from its anchor. Re-rolled per decision. */
    wanderX: 0,
    wanderZ: 0,
  });

  /**
   * A behaviour the caller wants imposed regardless of what the animal would choose.
   *
   * One caller today: a reunion (`mood.id === 'reunion'`) has to end with the animal at its owner's
   * feet, and a decision that sent it to bed halfway through would strand the greeting. Kept as an
   * argument to `tick` rather than as another weight, because it is not a preference — it is the
   * feature above saying 「not now」.
   */
  return {
    current: state,
    tick(t: number, pos: THREE.Vector3, player: THREE.Vector3, force?: PetBehaviorId): PetBehaviorDef {
      const s = state.current;
      if (force) {
        s.behavior = PET_BEHAVIORS[force];
        return s.behavior;
      }
      if (t < s.nextAt) return s.behavior;
      s.nextAt = t + PET_DECISION_INTERVAL_SECONDS * (0.75 + Math.random() * 0.5);

      // The care state settled against the REAL clock, not the render clock: `t` is seconds since
      // this Canvas started, and 營養 is measured in hours since a timestamp. This is the only place
      // the wall clock is read, and it is read a few times a minute.
      const condition = care ? petCondition(settlePetCare(care, Date.now())) : null;
      s.activity = condition ? condition.activity : 1;
      // 離線心情 × 照護狀態. Neither system overwrites the other — see combinePetMotion.
      s.motion = combinePetMotion(mood, petActivityResponse(s.activity));

      const restDistance = Math.hypot(pos.x - restSpot.x, pos.z - restSpot.z);
      s.behavior = PET_BEHAVIORS[
        decidePetBehavior(
          {
            activity: s.activity,
            nestPull: s.motion.nestPull,
            ownerDistance: Math.hypot(pos.x - player.x, pos.z - player.z),
            ownerMoving: !!playerBus.playerIsMoving,
            restDistance,
            // The owner standing near the bed lifts every resting behaviour, which is what makes
            // 「你走過去牠就起來了」 need no code of its own. PET_NOTICE_RADIUS rather than petCare's
            // own PET_NOTICE_DISTANCE: this one is measured to the BED, and it is 離線回歸's number,
            // kept so a returning player's pet notices them from exactly as far away as before.
            ownerNearRest:
              Math.hypot(player.x - restSpot.x, player.z - restSpot.z) < PET_NOTICE_RADIUS,
            previous: s.behavior.id,
          },
          Math.random(),
        )
      ];

      // A fresh wander target per decision, on a ring rather than in a disc: a uniform disc puts
      // most rolls near the centre, so the animal would mostly potter on the spot instead of
      // actually going somewhere.
      const angle = Math.random() * Math.PI * 2;
      const reach = s.behavior.drift * (0.6 + Math.random() * 0.4);
      s.wanderX = Math.cos(angle) * reach;
      s.wanderZ = Math.sin(angle) * reach;
      return s.behavior;
    },
  };
}

/**
 * Turns the current behaviour into the point the mover walks to.
 *
 * The ONE place a behaviour becomes a position, and the reason the walk below never learned about
 * behaviours at all: it is handed a slot, and it walks to it exactly as it did before any of this
 * existed. `slot` arrives holding the ordinary follow slot and is rewritten in place.
 *
 * Returns whether the animal is heading for its bed, which is the one thing the caller needs to know
 * that the point alone cannot say — a pet standing on its mat and a pet standing on the same spot on
 * its way past look identical in coordinates.
 */
function applyBehaviorSlot(
  slot: THREE.Vector3,
  behavior: PetBehaviorDef,
  wander: { wanderX: number; wanderZ: number },
  restSpot: PetRestingSpot,
  pos: THREE.Vector3,
  t: number,
): boolean {
  switch (behavior.anchor) {
    case 'rest':
      // Two slow sines over the wander offset, so a resting animal shifts about on its mat instead
      // of standing at one coordinate like a placed object. The speeds are deliberately not
      // multiples of one another — the same trick the bird's hover uses — so the path takes minutes
      // to repeat rather than closing into a visible loop.
      slot.x = restSpot.x + wander.wanderX * 0.5 + Math.sin(t * 0.31) * behavior.drift * 0.4;
      slot.z = restSpot.z + wander.wanderZ * 0.5 + Math.sin(t * 0.23 + 1.7) * behavior.drift * 0.4;
      return true;
    case 'self':
      // A stop, not a destination: the slot IS where it already is, so the walk below measures a
      // distance of zero and the animal stands. Everything downstream — the gait falling to nothing,
      // the turn back toward its owner, the 摸摸 prompt becoming available — follows for free.
      slot.x = pos.x;
      slot.z = pos.z;
      return false;
    case 'owner':
    default:
      // The follow slot the caller already computed, plus the wander offset (zero for `follow`).
      slot.x += wander.wanderX;
      slot.z += wander.wanderZ;
      return false;
  }
}

/**
 * How far the body drops when the animal settles, as a fraction of its own height.
 *
 * This is the visible half of 「活動力低就會趴下」 (§15) and it is deliberately done here rather than
 * in the model: `PetModel` is one unit-height build shared with the dressing room and the shop icon
 * (constants/pets.ts), and a lying pose baked into it would have to be threaded through both. A drop
 * plus a small forward pitch reads as 「趴著」 on every breed at this scale, and costs the model
 * nothing.
 */
const SETTLE_DROP = 0.26;

/** How fast the body eases into and out of that drop. About half a second either way. */
const SETTLE_RATE = 4;

/**
 * The reunion beat: run over, make a fuss, go back to normal.
 *
 * It is the `happy` reaction (constants/petInteractions.ts) — the same one petting ends with —
 * because it is the same thing happening: the animal is delighted and is saying so on the spot.
 * It used to borrow the petting mini-game's `dogIsHappy` flag and its spin, which meant a reunion
 * could fight the mini-game for the pet's body; a reaction is per-animal and simply replaces
 * whatever reaction was playing.
 *
 * `onGreet` is what ends the mood, and it is called when the animal actually ARRIVES rather than
 * when the greeting panel is dismissed. A reunion that resolves from a button press is one the
 * player never saw happen.
 */
function useGreeting(itemId: string, mood: PetMoodDef, onGreet?: () => void) {
  /** Whether this mount has already delivered the greeting for the current mood. */
  const delivered = useRef(false);

  useEffect(() => {
    if (mood.id !== 'reunion') delivered.current = false;
  }, [mood.id]);

  return {
    /** Starts it, once, when the animal is finally beside its owner. */
    check(pos: THREE.Vector3, player: THREE.Vector3) {
      if (mood.id !== 'reunion' || delivered.current) return;
      if (Math.hypot(pos.x - player.x, pos.z - player.z) > PET_GREET_RADIUS) return;
      delivered.current = true;
      playPetReaction(itemId, 'happy');
      onGreet?.();
    },
  };
}

/**
 * 看到主人了 / 窩裡轉一圈 / 起床伸懶腰 — the reactions an animal has to its own day rather than to
 * something the owner did. Shared by both movers so a bird notices its owner by the same rule a dog
 * does.
 */
function useLifeBeats(itemId: string) {
  const s = useRef({
    // Starts DISARMED: 「看到主人了」 is about an owner ARRIVING. An animal that spawns — or settles
    // after being petted — with its owner already standing over it has not seen anyone arrive, and
    // noticing them anyway cut straight across the happy reaction it was in the middle of.
    noticeArmed: false,
    noticeReadyAt: 0,
    lastBehavior: 'follow' as PetBehaviorId,
    circled: false,
    holdUntil: 0,
  });
  return {
    state: s,
    /**
     * `settled` is whether the animal is down (lying, perched). Returns true when the decision
     * layer should re-decide NOW — the owner has just walked up to a resting animal, and waiting up
     * to three and a half seconds for it to get up is the lag 「玩家靠近 → 寵物注意玩家」 rules out.
     */
    step(behavior: PetBehaviorDef, settled: boolean, stopped: boolean, ownerDist: number, busy: boolean, now: number): boolean {
      const b = s.current;
      let redecide = false;
      // A beat of the animal's own never talks over a reaction to its owner that is still playing —
      // the happy hops after a meal are not cut short by it deciding to turn round in its bed.
      const r = currentPetReaction(itemId);
      const reacting = !!r && (now - r.startedAt) / 1000 < PET_REACTIONS[r.id].seconds;
      if (!busy && !reacting) {
        if (behavior.id === 'rest' && stopped && !b.circled) {
          playPetReaction(itemId, 'circle', now);
          b.circled = true;
        }
        if (b.lastBehavior === 'rest' && behavior.id !== 'rest') {
          playPetReaction(itemId, 'stretch', now);
          b.holdUntil = now + PET_REACTIONS.stretch.seconds * 1000;
        }
        if (b.noticeArmed && settled && ownerDist < PET_NOTICE.radius && now >= b.noticeReadyAt) {
          playPetReaction(itemId, 'notice', now);
          b.noticeArmed = false;
          b.noticeReadyAt = now + PET_NOTICE.cooldown * 1000;
          redecide = true;
        }
      }
      if (behavior.id !== 'rest') b.circled = false;
      if (ownerDist > PET_NOTICE.radius + PET_NOTICE.margin) b.noticeArmed = true;
      b.lastBehavior = behavior.id;
      return redecide;
    },
  };
}

export const WalkingPet = memo(function WalkingPet({
  itemId, size, firstPerson = false, cosmetics, islandScale, placements, home,
  mood = PET_MOODS.lively, care, restSpot: restSpotProp, onGreet,
}: { itemId: string; size: number; firstPerson?: boolean; cosmetics?: readonly SpecialCosmeticDef[] } & PetWorld & PetLife) {
  const group = useRef<THREE.Group>(null);
  // Resolved here when the caller did not supply one, so the preview harnesses keep working against
  // a bare island with no profile — they get the improvised spot beside the Home, which is what they
  // had before beds existed.
  const restSpot = useMemo(
    () => restSpotProp ?? resolveRestingSpot({ placements, home, islandScale, petItemId: itemId }),
    [restSpotProp, placements, home, islandScale, itemId],
  );
  const world = useMemo<PetWorld>(() => ({ islandScale, placements, home }), [islandScale, placements, home]);
  const greeting = useGreeting(itemId, mood, onGreet);
  const behaviour = usePetBehaviour(mood, care, restSpot);
  const beats = useLifeBeats(itemId);

  const pos = useRef(new THREE.Vector3());
  const slot = useRef(new THREE.Vector3());
  const promptScratch = useRef(new THREE.Vector3());
  const spawned = useRef(false);
  const slotYaw = useRef(0);
  const yaw = useRef(0);
  const isWalking = useRef(false);
  const gait = useRef<PetGait>({ intensity: 0, phase: 0 });
  const stillTime = useRef(0);
  /** How far into the lying-down pose the body currently is, 0..1. Eased, never snapped. */
  const settle = useRef(0);
  /** How far into the 進食 pose it is, 0..1. Same easing discipline, same reason. */
  const eat = useRef(0);
  const drive = useRef(createDrive());
  const reaction = useRef(emptyReactionFrame());
  /** The petting lean-in, eased — so it comes and goes rather than switching. */
  const nuzzle = useRef(0);
  const voiced = useRef(-1);
  const munchAt = useRef(0);

  useFrame(({ clock }, rawDelta) => {
    const g = group.current;
    const player = playerBus.playerPos;
    if (!g || !player) return;

    const delta = clampFrameDelta(rawDelta);
    const t = clock.getElapsedTime();
    const now = performance.now();
    sweepPetActivities(now);

    // Where the slot IS. Eased toward the owner's facing rather than taken from it directly: a
    // player spinning on the spot would otherwise whip the slot in a full circle around themselves
    // and send the pet chasing it, when what they did was turn round on a stationary pet.
    //
    // Except on the very first frame, which has no history to ease FROM. Left to ease from its
    // initial 0 the slot starts due north of the owner however they are actually facing, so a pet
    // spawning to a player who happens to face south appears on the wrong side of them and walks
    // the whole way round before settling — which is most visible in first person, where "the wrong
    // side" means "off screen for the first second".
    const heading = slotHeading(firstPerson);
    slotYaw.current = spawned.current
      ? turnToward(slotYaw.current, heading, easeAlpha(firstPerson ? FIRST_PERSON.turn : 3, delta))
      : heading;
    const { fx, fz, rx, rz } = ownerAxes(slotYaw.current);
    // `ahead` is signed: the ordinary slot is BEHIND the owner and so negative, and first person
    // is the one mode that flips it in front. Written as one signed distance rather than as two
    // constants with a sign flip at the call site — the offset is the thing that differs between
    // the modes, and it should be readable as one number that changed.
    const side = firstPerson ? FIRST_PERSON.walkSide : WALKER.side;
    const ahead = firstPerson ? FIRST_PERSON.walkAhead : -WALKER.back;
    slot.current.set(
      player.x + rx * side + fx * ahead,
      0,
      player.z + rz * side + fz * ahead,
    );
    // 寵物行為層. The decision itself runs a few times a minute (see usePetBehaviour); what happens
    // here every frame is only turning the behaviour it settled on into the point to walk to. Applied
    // to the SLOT, so everything downstream — the walk, the collisions, the gait, the prompt — is
    // unchanged: the pet is still walking to one point, it is just a different point.
    //
    // A reunion forces `follow`: the greeting has to end with the animal beside its owner, and a
    // decision that sent it to bed halfway through would strand it there.
    const behavior = behaviour.tick(t, pos.current, player, mood.id === 'reunion' ? 'follow' : undefined);
    const bhv = behaviour.current.current;
    applyBehaviorSlot(slot.current, behavior, bhv, restSpot, pos.current, t);
    clampToLand(slot.current, placements, islandScale);

    // 互動. What the owner is doing WITH the animal outranks what it would choose to do — see
    // driveActivity. A short hold after getting up (the stretch) outranks the behaviour too.
    const d = drive.current;
    driveActivity(d, itemId, size, false, pos.current, player, playerBus.playerRotation ?? 0, world, now, munchAt);
    if (d.active) {
      slot.current.x = d.hasSlot ? d.slotX : pos.current.x;
      slot.current.z = d.hasSlot ? d.slotZ : pos.current.z;
    } else if (now < beats.state.current.holdUntil) {
      slot.current.x = pos.current.x;
      slot.current.z = pos.current.z;
    }

    if (!spawned.current) {
      pos.current.set(slot.current.x, player.y, slot.current.z);
      yaw.current = slotYaw.current;
      spawned.current = true;
    }

    const dx = slot.current.x - pos.current.x;
    const dz = slot.current.z - pos.current.z;
    const dist = Math.hypot(dx, dz);

    let travelled = 0;
    if (dist > WALKER.snap) {
      pos.current.x = slot.current.x;
      pos.current.z = slot.current.z;
      isWalking.current = false;
      gait.current.intensity = 0;
    } else {
      isWalking.current = isWalking.current ? dist > WALKER.stop : dist > WALKER.resume;
      // An activity steers to a precise point (the spot behind the bowl, the toy), so it walks all
      // the way there rather than stopping within the loose follow radii.
      if (d.active && d.hasSlot) isWalking.current = dist > PET_FEED.arriveRadius * 0.5;
      if (isWalking.current && dist > 1e-6) {
        // Pace scales BOTH the pursuit gain and the ceiling on it, so a quiet animal is slower
        // everywhere rather than only until it hits a cap it can no longer reach. The gait intensity
        // below is still measured against the unscaled ceiling, which is what makes the legs swing
        // less as well as less far.
        //
        // Three factors, multiplied: the 離線心情, the 照護狀態 (those two already combined into
        // `motion` by the behaviour layer) and the behaviour's own — or, while the owner is doing
        // something with the animal, the activity's.
        const pace = bhv.motion.pace * (d.active ? d.pace : behavior.pace);
        const speed = Math.min(
          WALKER.maxSpeed * pace,
          Math.max(dist * (firstPerson ? FIRST_PERSON.gain : WALKER.gain) * pace, d.active ? 1.2 * pace : 0),
        );
        travelled = Math.min(dist, speed * delta);
        pos.current.x += (dx / dist) * travelled;
        pos.current.z += (dz / dist) * travelled;
        gait.current.intensity = THREE.MathUtils.lerp(
          gait.current.intensity, speed / WALKER.maxSpeed, easeAlpha(8, delta),
        );
      } else {
        gait.current.intensity = THREE.MathUtils.lerp(gait.current.intensity, 0, easeAlpha(8, delta));
      }
    }

    // The step cycle, advanced by GROUND COVERED rather than by time - this is what stops the feet
    // skating. Half a cycle per stride length, and the stride scales with the animal, so a big dog
    // takes long slow steps and a small one takes short quick ones over the same distance.
    gait.current.phase = (gait.current.phase + (travelled / (size * STRIDE_LENGTH)) * Math.PI) % (Math.PI * 2);

    // Solid things, in the same order and against the same boxes the player is stopped by, so a pet
    // can never stand somewhere its owner could not: the Home's shell, then the placed furniture,
    // then the waterline. Pushed out rather than blocked — a follower that stops dead on contact
    // gets wedged on the corner it is trying to walk round.
    if (home) resolveHomeCollision(pos.current, home, PET_RADIUS);
    const pushed = resolvePlayerAgainstFurniture(pos.current.x, pos.current.z, PET_RADIUS, placements);
    pos.current.x = pushed.x;
    pos.current.z = pushed.z;
    clampToLand(pos.current, placements, islandScale);

    // Ground height from the same surface resolver the player stands on, so the pet climbs the
    // mound, walks down the beach slope and steps up onto a 木製平台 exactly where its owner does.
    const surfaceY = getSurfaceAt(pos.current.x, pos.current.z, placements, islandScale).y;
    pos.current.y = THREE.MathUtils.lerp(pos.current.y, surfaceY, easeAlpha(14, delta));

    // Facing: where it is going while it moves; at what the activity is about (the bowl, the toy)
    // when there is one; otherwise back at the owner once it arrives — the turn toward the player at
    // the end of a walk is most of what makes it read as a companion rather than as an object parked
    // at an offset.
    const targetYaw = isWalking.current && dist > 1e-6
      ? Math.atan2(dx, dz)
      : d.hasFace
        ? Math.atan2(d.faceX - pos.current.x, d.faceZ - pos.current.z)
        : Math.atan2(player.x - pos.current.x, player.z - pos.current.z);
    yaw.current = turnToward(yaw.current, targetYaw, easeAlpha(WALKER.turnRate, delta));

    // Body bob, taken from the SAME phase the legs are swinging on rather than from the clock: the
    // body has to rise as the diagonal pair passes under it, which is twice per cycle, or the bounce
    // and the footfalls drift apart and the walk goes back to looking like a slide with a wobble on
    // top. Scaled by `size` so every breed bounces the same fraction of its own height.
    // `liveliness` is how much spring is in the step, on top of how fast it is taken. Separate from
    // `pace` on purpose: a pet that had merely been slowed down reads as lagging, where one that
    // also bobs and rolls less reads as subdued — which is the difference between a bug and a mood.
    const power = gait.current.intensity * bhv.motion.liveliness;
    const hop = Math.abs(Math.sin(gait.current.phase)) * size * 0.055 * power;

    // 趴下 — the visible half of a settled behaviour (§15). Eased rather than switched, over about
    // half a second: an animal that drops into a lying pose on the frame its behaviour changed is
    // the abrupt transition the brief rules out, and the ease is what turns 「狀態變了」 into
    // 「牠慢慢趴下來了」. It also only engages once the animal has actually STOPPED, so a pet still
    // walking to its bed keeps its legs under it the whole way there. Never while the owner is doing
    // something with it — an animal does not lie down mid-meal.
    const wantsSettle = behavior.settled && !isWalking.current && !d.active;
    settle.current = THREE.MathUtils.lerp(
      settle.current,
      wantsSettle ? 1 : 0,
      easeAlpha(SETTLE_RATE, delta),
    );
    const drop = settle.current * size * SETTLE_DROP;

    // 看到主人 / 窩裡轉一圈 / 起床伸懶腰.
    const ownerDist = Math.hypot(player.x - pos.current.x, player.z - pos.current.z);
    if (beats.step(behavior, settle.current > 0.5, !isWalking.current, ownerDist, d.active, now)) {
      bhv.nextAt = 0;
    }

    // 進食 (§19). A nose-down tip plus a slow nod, on top of everything above rather than instead
    // of it — this is a dog putting its head in the bowl it walked over to. Eased in and out for the
    // same reason 趴下 is eased: a pose that snaps on reads as a bug.
    const eating = d.eating ? eatingProgress(itemId, now) : null;
    eat.current = THREE.MathUtils.lerp(
      eat.current,
      eating === null ? 0 : Math.sin(Math.PI * Math.min(1, eating * 1.15 + 0.08)),
      easeAlpha(6, delta),
    );
    const nod = eat.current * Math.sin(t * 9) * 0.06;

    // The reaction on top: a hop, a lean, a wag. And the petting lean-in, eased in and out.
    nuzzle.current = THREE.MathUtils.lerp(nuzzle.current, d.nuzzle, easeAlpha(5, delta));
    const rf = reaction.current;
    sampleReactions(rf, itemId, now, false, nuzzle.current);
    voiceReaction(itemId, voiced);

    // Asleep in its own bed: the slowest, smallest breath — the difference between a pet resting and
    // a pet switched off.
    const breath = behavior.id === 'rest'
      ? Math.sin(t * PET_SLEEP_BREATH.rate * Math.PI * 2) * PET_SLEEP_BREATH.amount * size * settle.current
      : 0;

    g.position.set(pos.current.x, pos.current.y + hop - drop + breath + (rf.hop - rf.drop) * size, pos.current.z);
    g.rotation.y = yaw.current + rf.spin;
    // Roll once per cycle (not twice): the body leans onto whichever diagonal is carrying it.
    g.rotation.z = Math.sin(gait.current.phase) * 0.05 * power + rf.roll;
    // The forward pitch that sells the drop as a pose rather than as the model sinking into the
    // ground. Small — a chibi animal tipped much past this reads as falling over.
    g.rotation.x = 0.05 * power + settle.current * 0.16 + eat.current * 0.34 + nod + rf.pitch;
    // Tail at full pelt while it eats or is delighted, through the same `intensity` the wag is
    // already driven by (Pets.tsx's Tail) — the one channel this model already has for 「牠很開心」.
    if (eat.current > 0.15) gait.current.intensity = Math.max(gait.current.intensity, eat.current);
    if (rf.wag > 0) gait.current.intensity = Math.max(gait.current.intensity, rf.wag);

    carryToy(itemId, pos.current, yaw.current, size);
    greeting.check(pos.current, player);

    publishPromptTarget(
      itemId,
      pos.current,
      !isWalking.current && !playerBus.playerIsMoving,
      stillTime,
      delta,
      promptScratch.current,
      d.busy,
      size,
    );
  });

  return (
    <group ref={group} scale={size}>
      <PetModel itemId={itemId} gait={gait} cosmetics={cosmetics} />
      <PetHearts itemId={itemId} />
    </group>
  );
});

export const FlyingPet = memo(function FlyingPet({
  itemId, size, firstPerson = false, cosmetics, islandScale, placements, home,
  mood = PET_MOODS.lively, care, restSpot: restSpotProp, onGreet,
}: { itemId: string; size: number; firstPerson?: boolean; cosmetics?: readonly SpecialCosmeticDef[] } & PetWorld & PetLife) {
  const group = useRef<THREE.Group>(null);
  // See the walker: resolved here only when the caller did not supply one.
  const restSpot = useMemo(
    () => restSpotProp ?? resolveRestingSpot({ placements, home, islandScale, petItemId: itemId }),
    [restSpotProp, placements, home, islandScale, itemId],
  );
  const world = useMemo<PetWorld>(() => ({ islandScale, placements, home }), [islandScale, placements, home]);
  const greeting = useGreeting(itemId, mood, onGreet);
  const behaviour = usePetBehaviour(mood, care, restSpot);
  const beats = useLifeBeats(itemId);

  const pos = useRef(new THREE.Vector3());
  const slot = useRef(new THREE.Vector3());
  const promptScratch = useRef(new THREE.Vector3());
  const spawned = useRef(false);
  const slotYaw = useRef(0);
  const yaw = useRef(0);
  const stillTime = useRef(0);
  /** How far into the 進食 pose it is, 0..1. See the walker — same envelope, different pose. */
  const eat = useRef(0);
  const drive = useRef(createDrive());
  const reaction = useRef(emptyReactionFrame());
  const nuzzle = useRef(0);
  const voiced = useRef(-1);
  const munchAt = useRef(0);

  useFrame(({ clock }, rawDelta) => {
    const g = group.current;
    const player = playerBus.playerPos;
    if (!g || !player) return;

    const delta = clampFrameDelta(rawDelta);
    const t = clock.getElapsedTime();
    const now = performance.now();
    sweepPetActivities(now);

    // Snapped on spawn, eased after — see the walker for why the first frame is the exception.
    const heading = slotHeading(firstPerson);
    slotYaw.current = spawned.current
      ? turnToward(slotYaw.current, heading, easeAlpha(firstPerson ? FIRST_PERSON.turn : 3, delta))
      : heading;
    const { fx, fz, rx, rz } = ownerAxes(slotYaw.current);
    // See the walker: `ahead` is signed, and first person is the one mode that puts it in front.
    const side = firstPerson ? FIRST_PERSON.flySide : FLYER.side;
    const ahead = firstPerson ? FIRST_PERSON.flyAhead : -FLYER.back;
    const height = firstPerson ? FIRST_PERSON.flyHeight : FLYER.height;

    // The same behaviour layer the walker uses, so both species read the same care state and the
    // same absence the same way — a bird that had its own AI would be a second set of these rules.
    const behavior = behaviour.tick(t, pos.current, player, mood.id === 'reunion' ? 'follow' : undefined);
    const bhv = behaviour.current.current;

    // Slot plus the wander, so the bird is never still even when its owner is. No clampToLand: a
    // bird has every right to be over the water, and following a swimming owner out to sea is the
    // one thing this species can do that the other two cannot.
    const life = bhv.motion.liveliness;
    slot.current.set(
      player.x + rx * side + fx * ahead + Math.sin(t * FLYER.speedX) * FLYER.driftX * life,
      player.y + height + Math.sin(t * FLYER.speedY) * FLYER.driftY * life,
      player.z + rz * side + fz * ahead + Math.sin(t * FLYER.speedZ + 1.1) * FLYER.driftZ * life,
    );
    // A quiet bird waits over its own perch. The behaviour rewrites where in the world it hovers,
    // and the height is then re-derived from the ground under THAT point rather than from the
    // owner's — otherwise a bird settling over a bed while its owner stands on the mound would hover
    // at the mound's height, out over nothing.
    //
    // `settled` drops it most of the way to the perch: a bird does not lie down, it comes down to
    // land, and the clearance floor further below is what stops it reaching the sand.
    if (applyBehaviorSlot(slot.current, behavior, bhv, restSpot, pos.current, t)) {
      const groundY = getSurfaceAt(slot.current.x, slot.current.z, placements, islandScale).y;
      // WHERE it lands is the habitat's own number (constants/petHabitats.ts's `height`), not a
      // constant here: a perch's crossbar, a cage's floor bar and a nest's rim are three different
      // heights, and a bird that hovered at one fixed altitude over all three would be sitting in
      // the air above two of them. This is the whole of 「鳥類的休息行為」 (§9) — the bird already
      // flies, so honouring a habitat is one coordinate rather than a movement system.
      //
      // A spot with no height of its own — the improvised nest beside the Home, which is a mat —
      // keeps the old behaviour: down to just above the ground, floored by `clearance` below.
      slot.current.y = groundY + (behavior.settled ? restingHeight(restSpot) : height);
    }

    // 互動 — the same driver as the walker. For a bird "go to the bowl" means come down and hover
    // over its dish, and "chase the toy" means fly after it; `hoverY` says how low.
    const d = drive.current;
    driveActivity(d, itemId, size, true, pos.current, player, playerBus.playerRotation ?? 0, world, now, munchAt);
    if (d.active) {
      slot.current.x = d.hasSlot ? d.slotX : pos.current.x;
      slot.current.z = d.hasSlot ? d.slotZ : pos.current.z;
      if (d.hoverY != null) slot.current.y = d.hoverY;
    } else if (now < beats.state.current.holdUntil) {
      slot.current.copy(pos.current);
    }

    if (!spawned.current) {
      pos.current.copy(slot.current);
      yaw.current = slotYaw.current;
      spawned.current = true;
    }

    const prevX = pos.current.x;
    const prevZ = pos.current.z;

    if (pos.current.distanceTo(slot.current) > FLYER.snap) {
      pos.current.copy(slot.current);
    } else {
      // Pace scales how hard it chases — a subdued bird coasts further behind its slot, which is the
      // flying version of the walker taking slower steps. Same three factors as the walker's: mood,
      // care, and the behaviour's own (or the activity's).
      const pace = bhv.motion.pace * (d.active ? d.pace : behavior.pace);
      pos.current.lerp(slot.current, easeAlpha(FLYER.chase * pace * (d.active ? 1.6 : 1), delta));
    }

    // The Home is the one thing up here to hit — it is the only structure tall enough to reach
    // flying height. Furniture is not tested: everything placeable is well below this bird.
    if (home) resolveHomeCollision(pos.current, home, PET_RADIUS);
    const groundY = getSurfaceAt(pos.current.x, pos.current.z, placements, islandScale).y;
    // Allowed right down to its dish while it eats; otherwise the ordinary clearance.
    pos.current.y = Math.max(pos.current.y, groundY + (d.hoverY != null ? size * 0.25 : FLYER.clearance));

    // Attitude from the bird's OWN motion, so it can never bank one way while sliding the other.
    // Below a threshold the velocity is numerical noise and its angle is meaningless, so a nearly
    // stationary bird turns to face what it is attending to — its dish, the toy, its owner — instead
    // of jittering along a random heading.
    const vx = delta > 0 ? (pos.current.x - prevX) / delta : 0;
    const vz = delta > 0 ? (pos.current.z - prevZ) / delta : 0;
    const speed = Math.hypot(vx, vz);
    const targetYaw = speed > 0.35
      ? Math.atan2(vx, vz)
      : d.hasFace
        ? Math.atan2(d.faceX - pos.current.x, d.faceZ - pos.current.z)
        : Math.atan2(player.x - pos.current.x, player.z - pos.current.z);
    const prevYaw = yaw.current;
    yaw.current = turnToward(yaw.current, targetYaw, easeAlpha(FLYER.turnRate, delta));

    // Roll into the turn it is actually making, taken from the yaw it just applied — sliding left
    // drops the left wing, as it must to be turning at all.
    const yawRate = delta > 0 ? Math.atan2(Math.sin(yaw.current - prevYaw), Math.cos(yaw.current - prevYaw)) / delta : 0;

    const ownerDist = Math.hypot(player.x - pos.current.x, player.z - pos.current.z);
    if (beats.step(behavior, behavior.settled && speed < 0.35, speed < 0.35, ownerDist, d.active, now)) {
      bhv.nextAt = 0;
    }

    // 進食 (§19) — a bird PECKS rather than putting its head in a bowl, so this is a fast repeated
    // tip forward where the walker gets a slow nod, and it drops a little as it eats rather than
    // tipping the whole body over. Same eased envelope in both, so the two read as one feature.
    const eating = d.eating ? eatingProgress(itemId, now) : null;
    eat.current = THREE.MathUtils.lerp(
      eat.current,
      eating === null ? 0 : Math.sin(Math.PI * Math.min(1, eating * 1.15 + 0.08)),
      easeAlpha(6, delta),
    );
    const peck = eat.current * Math.max(0, Math.sin(t * 13)) * 0.42;

    nuzzle.current = THREE.MathUtils.lerp(nuzzle.current, d.nuzzle, easeAlpha(5, delta));
    const rf = reaction.current;
    sampleReactions(rf, itemId, now, true, nuzzle.current);
    voiceReaction(itemId, voiced);

    g.position.copy(pos.current);
    g.position.y += -eat.current * size * 0.4 + (rf.hop - rf.drop) * size;
    g.rotation.y = yaw.current + rf.spin;
    g.rotation.z = THREE.MathUtils.clamp(yawRate * 0.22, -0.45, 0.45) + rf.roll;
    g.rotation.x = THREE.MathUtils.clamp(-speed * 0.03, -0.2, 0.2) + peck + rf.pitch;

    greeting.check(pos.current, player);

    publishPromptTarget(
      itemId,
      pos.current,
      speed < 0.35 && !playerBus.playerIsMoving,
      stillTime,
      delta,
      promptScratch.current,
      d.busy,
      size,
    );
  });

  return (
    <group ref={group} scale={size}>
      <PetModel itemId={itemId} cosmetics={cosmetics} />
      <PetHearts itemId={itemId} />
    </group>
  );
});

/**
 * The island's one companion slot.
 *
 * Equipping a pet in the 更衣室 is what fills it, and with nothing equipped the slot stays empty.
 * The island used to keep a stray dog in that case — the animal the daily 摸摸 reward came
 * from for players who had not bought a pet — but that stray has been removed, so the
 * reward is now reached only through a companion the player actually owns.
 */
export function IslandPet() {
  const { profile, currentView, cameraMode, uiScale, greetPet } = useAppPick('profile', 'currentView', 'cameraMode', 'uiScale', 'greetPet');
  const itemId = profile?.equippedItems?.find(id => getPetSpec(id));
  const home = usePlayerHome(profile);

  /**
   * 寵物的生活狀態, resolved at login from how long the owner was away
   * (constants/islandReturn.ts) and read here as a set of multipliers on the follow behaviour.
   *
   * Only the EQUIPPED companion has one, and since the island's stray was removed it is the only
   * animal this slot ever mounts. `PET_MOODS.lively` is also the fallback for any save with no
   * `islandState` at all — every player who predates this feature keeps the pet they had.
   */
  const mood = PET_MOODS[profile?.islandState?.pet?.mood ?? 'lively'] ?? PET_MOODS.lively;

  /**
   * 寵物照護, straight off the save and NOT settled here.
   *
   * A settled value would be a number frozen at whatever the profile last changed, and this
   * component re-renders on every purchase and every coin — not on the hours that actually move it.
   * The behaviour layer settles it against the wall clock at each decision instead, which is both
   * correct over a long session and cheaper. See usePetBehaviour.
   *
   * THIS animal's state, resolved by id (§21): what the pet on screen is doing has to be driven by
   * how well that pet has been fed, not by a household average. `rawPetCare`'s migration branch is
   * inside `readPetCare`, so a save from before the map existed still animates correctly.
   */
  const care = useMemo(
    () => (itemId ? readPetCare(profile, itemId, Date.now()) : undefined),
    // Recomputed when the SAVED state changes, not on the clock: settling is the behaviour layer's
    // job (see above), and a dependency on `Date.now()` would be a re-render per frame.
    [profile, itemId],
  );

  const placements = profile?.islandPlacements;
  /**
   * Where this animal may lie down — a bed the player bought and placed, or the improvised spot
   * beside the Home. Resolved ONCE here rather than inside each mover so the scene and the animal
   * cannot disagree about where the bed is (Three/IslandOvergrowth.tsx asks the same resolver), and
   * memoised on the placement list so walking around does not re-scan it every frame.
   */
  const restSpot = useMemo(
    () =>
      resolveRestingSpot({
        placements: placements ?? [],
        home,
        islandScale: 1 + ((profile?.territoryLevel || 1) - 1) * 0.4,
        petItemId: itemId,
      }),
    [placements, home, profile?.territoryLevel, itemId],
  );

  /**
   * A stable handle on `greetPet`, so the movers below keep their `memo`.
   *
   * `greetPet` is rebuilt whenever the profile changes — which, on the island, is every purchase,
   * every coin and every proximity flag. Handing it straight to WalkingPet/FlyingPet would bust
   * their memo several times a second for a callback that fires at most once per absence.
   */
  const greetRef = useRef(greetPet);
  useEffect(() => {
    greetRef.current = greetPet;
  }, [greetPet]);
  const onGreet = useCallback(() => void greetRef.current(), []);

  /**
   * Whether the camera is in the owner's head, and therefore whether the companion has to be in
   * front of them — see {@link FIRST_PERSON}.
   *
   * The `uiScale` half is not an extra: Avatar.tsx defines its own first person as
   * `cameraMode === SECOND_PERSON || uiScale >= FIRST_PERSON_ZOOM` and steers the character by the
   * camera under both, and CameraController pulls the FOV to FIRST_PERSON_FOV under both. Zooming
   * all the way in is a way into this camera, not a different one, so testing only the mode leaves the
   * pet stuck behind the player for anyone who got there with the zoom slider.
   *
   * (`SECOND_PERSON` is 第一人稱 — the enum member is misnamed and is used under that name
   * throughout the app, so this reads it as it is rather than renaming it from here.)
   */
  const firstPerson = cameraMode === CameraMode.SECOND_PERSON || uiScale >= FIRST_PERSON_ZOOM;

  /**
   * The companion's 特殊飾品, out of the SAME equipped list the player's own come from.
   *
   * One list rather than a new `equippedPetItems` profile field, and that is a deliberate data
   * decision: a new top-level profile field has to be added to the deployed Firestore ruleset
   * before it can be written, and until it is, every save carrying it fails with
   * permission-denied in production only. A pet cosmetic is an owned item that is equipped, which
   * is exactly what this list already means; what makes it the PET'S is its socket
   * (constants/cosmeticEffects.ts), not where it is stored.
   */
  const equippedIds = profile?.equippedItems;
  const cosmetics = useMemo(
    () => resolveSpecialCosmetics(equippedIds ?? [], 'pet'),
    [equippedIds],
  );

  /**
   * 陪牠玩 — the panel (UI/PetInteractionPanel.tsx) asks; the animal on the island answers.
   *
   * The activity starts here, where the species (and so the way it plays) is known. WHERE the toy
   * goes is resolved on the mover's next frame (driveActivity), because only it knows which way the
   * owner is facing and what the ground is like where the toy will land.
   */
  useEffect(() => {
    if (!itemId) return;
    const onPlay = (e: Event) => {
      const target = (e as CustomEvent<{ petItemId?: string }>).detail?.petItemId ?? itemId;
      const species = getPetSpecies(itemId);
      if (target !== itemId || !species) return;
      startPlay(itemId, PET_PLAY_STYLE[species]);
    };
    window.addEventListener('pet-play', onPlay);
    return () => window.removeEventListener('pet-play', onPlay);
  }, [itemId]);

  /**
   * Which activity (if any) is live for this animal, as a React value — so the bowl and the toy are
   * MOUNTED only while there is a meal or a game, and an island with a contented pet carries neither.
   */
  const activityKind = useSyncExternalStore(
    subscribePetActivity,
    () => (itemId ? currentPetActivity(itemId)?.kind ?? null : null),
    () => null,
  );

  // The prompt target is written every frame while a companion is mounted; dropped views and
  // unequipped pets have to take it back down, or the 摸摸 badge stays anchored to wherever the
  // pet was standing when it vanished. The same goes for anything the owner was doing with it: a
  // bowl, a thrown toy and a half-finished petting all end when the animal leaves the scene.
  useEffect(() => {
    return () => {
      playerBus.dogPos = undefined;
      playerBus.petTargetId = undefined;
      playerBus.petPromptPriority = 0;
      playerBus.dogIsMoving = false;
      if (itemId) endPetActivity(itemId);
    };
  }, [itemId, currentView]);

  if (currentView !== View.HOME) return null;
  if (!itemId) return null;

  const spec = getPetSpec(itemId)!;
  // The breed's height is authored in the avatar's local units (constants/pets.ts, measured against
  // the character's knee), so it needs the avatar's own scale applied to arrive in world units —
  // the same conversion the dressing room makes when it mounts the companion beside the character.
  const size = spec.height * AVATAR_BASE_SCALE;

  const world = {
    // The same expression every other island component derives its scale from (Island.tsx,
    // Avatar.tsx, Fish.tsx …) - a companion has to grow with the territory or it will be walking
    // into the sea the moment the island does not.
    islandScale: 1 + ((profile?.territoryLevel || 1) - 1) * 0.4,
    placements: profile?.islandPlacements || [],
    home,
  };

  const life = { mood, care, restSpot, onGreet };

  // WHICH mover, from the species' declared locomotion rather than from `=== 'bird'` — see
  // PET_SPECIES_TABLE. A future species that flies picks up the flying mover by saying so in one
  // table, and one that walks needs no edit here at all.
  const airborne = PET_SPECIES_TABLE[getPetSpecies(itemId)!].locomotion === 'air';
  return (
    <>
      {airborne
        ? <FlyingPet itemId={itemId} size={size} firstPerson={firstPerson} cosmetics={cosmetics} {...world} {...life} />
        : <WalkingPet itemId={itemId} size={size} firstPerson={firstPerson} cosmetics={cosmetics} {...world} {...life} />}
      {activityKind === 'eat' && <PetBowl itemId={itemId} small={airborne} />}
      {activityKind === 'play' && <PetToy itemId={itemId} />}
    </>
  );
}

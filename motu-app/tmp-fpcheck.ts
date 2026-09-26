/**
 * Throwaway: is the companion inside the first-person camera's frustum? Pure maths, no WebGL —
 * which is the point. The rendered harness (tmp-petfp.tsx) could not answer this because R3F kept
 * resetting the tile cameras, and a screenshot that shows nothing cannot distinguish "the pet is
 * off screen" from "the camera is not where I put it".
 *
 * Models exactly what CameraController does in first person: the camera sits at the owner's eye
 * (playerPos.y + 1.65) with FIRST_PERSON_FOV as its VERTICAL fov, looking along playerBus.cameraYaw.
 *
 * Run: npx tsx tmp-fpcheck.ts
 * Delete once the follow slot is signed off.
 */
import { FIRST_PERSON } from './src/components/Three/IslandPet';
import { AVATAR_BASE_SCALE } from './src/components/Three/Avatar';
import { PET_SPECS } from './src/constants/pets';

/** CameraController.tsx's FIRST_PERSON_FOV, and the eye height its first-person branch uses. */
const FOV = 68;
const EYE = 1.65;
/** Phone portrait is the meanest aspect the game ships in; anything wider only helps. */
const ASPECT = [0.56, 1.0, 1.78];
/** The player's own top speed on the island, which is what the follower has to keep up with. */
const PLAYER_SPEED = 5.5;

const halfV = (FOV / 2) * (Math.PI / 180);
const tanV = Math.tan(halfV);

/**
 * Where a point lands on screen, in normalised device coords: 0 is dead centre, ±1 is the edge of
 * the frame. Built from the camera's own axes rather than a matrix so the whole check stays
 * readable — forward is where it looks, right is +x on screen, up is +y.
 */
function project(camYaw: number, p: { x: number; y: number; z: number }, aspect: number) {
  // A camera looks down its own -Z, so yaw θ points it along (-sin θ, 0, -cos θ).
  const f = { x: -Math.sin(camYaw), z: -Math.cos(camYaw) };
  const r = { x: -f.z, z: f.x };
  const depth = p.x * f.x + p.z * f.z;
  const side = p.x * r.x + p.z * r.z;
  const rise = p.y;
  if (depth <= 0) return { depth, ndcX: NaN, ndcY: NaN };
  return {
    depth,
    ndcX: side / depth / (tanV * aspect),
    ndcY: rise / depth / tanV,
  };
}

/** The slot IslandPet puts the pet in, relative to the owner, in the same axes as ownerAxes(). */
function slot(kind: 'walk' | 'fly') {
  const ahead = kind === 'walk' ? FIRST_PERSON.walkAhead : FIRST_PERSON.flyAhead;
  const side = kind === 'walk' ? FIRST_PERSON.walkSide : FIRST_PERSON.flySide;
  return { ahead, side };
}

let failures = 0;

for (const [breed, spec] of Object.entries(PET_SPECS)) {
  const height = spec.height * AVATAR_BASE_SCALE;
  const kind = ['budgie', 'javasparrow', 'canary', 'phoenix'].includes(breed) ? 'fly' : 'walk';
  const { ahead, side } = slot(kind);

  // The pet's own vertical extent, as offsets from the EYE. A walker stands on the ground (1.65
  // below the eye) and rises by its height; a flyer hangs at flyHeight and is centred there.
  const feet = kind === 'walk' ? -EYE : FIRST_PERSON.flyHeight - EYE - height / 2;
  const crown = kind === 'walk' ? -EYE + height : FIRST_PERSON.flyHeight - EYE + height / 2;

  // A proportional follower settles SHORT of its slot by (owner speed / gain) whenever the owner
  // is moving, so "in frame standing still" is only half the answer — this is the distance the
  // player actually sees while walking, and it is the one that clips first.
  const lag = kind === 'walk' ? PLAYER_SPEED / FIRST_PERSON.gain : 0;

  for (const aspect of ASPECT) {
    // Camera yaw is irrelevant to the answer (the slot turns with it), so one sample proves the
    // family — but sweep anyway, because a sign error in the axes would only show at some yaws.
    for (const camYaw of [0, 1.1, 2.3, -2.9]) {
      const f = { x: -Math.sin(camYaw), z: -Math.cos(camYaw) };
      const r = { x: -f.z, z: f.x };
      const p = {
        x: f.x * (ahead - lag) + r.x * side,
        z: f.z * (ahead - lag) + r.z * side,
      };
      const lo = project(camYaw, { ...p, y: feet }, aspect);
      const hi = project(camYaw, { ...p, y: crown }, aspect);
      // "Visible" = the animal's own box overlaps the frame. Its feet may fall below the bottom
      // edge on a tall phone; what must never happen is the WHOLE animal being outside.
      const onScreen = lo.depth > 0.5
        && Math.abs(hi.ndcX) < 1
        && !(lo.ndcY > 1 || hi.ndcY < -1);
      if (!onScreen) {
        failures++;
        console.log(`FAIL ${breed} (${kind}) aspect ${aspect} yaw ${camYaw}: depth ${lo.depth.toFixed(2)} ndcX ${hi.ndcX.toFixed(2)} ndcY ${lo.ndcY.toFixed(2)}..${hi.ndcY.toFixed(2)}`);
      }
    }
  }

  // One representative readout per breed, at 16:9.
  const camYaw = 0;
  const f = { x: -Math.sin(camYaw), z: -Math.cos(camYaw) };
  const r = { x: -f.z, z: f.x };
  const p = { x: f.x * (ahead - lag) + r.x * side, z: f.z * (ahead - lag) + r.z * side };
  const lo = project(camYaw, { ...p, y: feet }, 1.78);
  const hi = project(camYaw, { ...p, y: crown }, 1.78);
  const pct = (n: number) => `${(50 - (n * 50)).toFixed(0)}%`;
  console.log(
    `${breed.padEnd(12)} ${kind}  h ${height.toFixed(2)}  dist ${lo.depth.toFixed(2)}  ` +
    `x ${(50 + hi.ndcX * 50).toFixed(0)}% across, y ${pct(hi.ndcY)}..${pct(lo.ndcY)} down`,
  );
}

console.log(failures === 0 ? '\nALL IN FRAME' : `\n${failures} FAILURES`);

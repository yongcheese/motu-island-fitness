/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { PLAYER_PHYSICAL_RADIUS } from '../utils/placementRules';
import { HOME_ENTRY_RADIUS, type ResolvedHome } from '../hooks/usePlayerHome';
import { makeObb, type Obb2 } from './furniturePlacement';
import type { FurnitureInReach } from './playerBus';
import type {
  InteractionCandidate, InteractionScope, InteractionTargetKind,
} from './interactionTargeting';

/**
 * SOURCE ADAPTERS — how a source's own record becomes an {@link InteractionCandidate}.
 *
 * The tracker (Three/InteractionPromptTracker.tsx) calls these once a frame; the tests call the
 * same functions, so what they check is what the game ranks. Only the two sources with real
 * geometry behind them live here — furniture and the Home. The others (a resident, a merchant,
 * the pet, 整理) are a point and a radius each, filled inline where they are gathered.
 */

/** A blank candidate record. Pooled by the caller: filled in place every frame, never reallocated. */
export function makeCandidate(id: string, kind: InteractionTargetKind, scope: InteractionScope): InteractionCandidate {
  return {
    id, kind, scope, point: { x: 0, y: 0, z: 0 }, aimX: 0, aimZ: 0, distance: 0, reach: 0,
    contact: 0, priority: 0, locked: false, ownerId: null, label: '', icon: 'hand',
    action: { type: 'enter-home' },
  };
}

export const furnitureCandidateId = (instanceId: string) => `furniture:${instanceId}`;

/**
 * A piece of furniture in reach. Its point is the piece's own Interaction Point (the seat, the
 * mattress, the doors — lib/furnitureInteraction.ts's resolveInteractionPoint); facing and line of
 * reach are measured to the nearest point of its box; touching is the body's own radius from it,
 * which is as close as the walk resolve lets anyone stand.
 */
export function fillFurnitureCandidate(c: InteractionCandidate, f: FurnitureInReach): void {
  const t = f.target;
  c.point = t.interactionPoint;
  c.aimX = f.aimX;
  c.aimZ = f.aimZ;
  c.distance = f.distance;
  c.reach = f.reach;
  c.contact = Math.min(PLAYER_PHYSICAL_RADIUS, f.reach);
  c.priority = 0;
  c.locked = f.occupied;
  c.ownerId = t.instanceId;
  // The VERB, not 「使用 <名稱>」: the piece decides its own in the catalog, and once the player is
  // on it the key gets them off.
  c.label = f.occupied ? t.exitVerb : t.verb;
  c.icon = t.icon;
  if (c.action.type !== 'furniture' || c.action.target !== t) c.action = { type: 'furniture', target: t };
}

export const HOME_CANDIDATE_ID = 'building:player-home';

/**
 * The Home's front door. Range is the doormat radius it has always had (HOME_ENTRY_RADIUS,
 * measured by hooks/usePlayerHome.ts's homeEntryDistance); the point — and so facing and line of
 * reach — is ON the door (getHomeInteractionPoint). The house's own solid box
 * ({@link homeSolidObstacle}) is what then keeps the side and back walls from offering it.
 */
export function fillHomeCandidate(
  c: InteractionCandidate,
  point: { x: number; y: number; z: number },
  distance: number,
  label: string,
): void {
  c.point = point;
  c.aimX = point.x;
  c.aimZ = point.z;
  c.distance = distance;
  c.reach = HOME_ENTRY_RADIUS;
  c.contact = 0;
  c.priority = 0;
  c.locked = false;
  c.ownerId = null;
  c.label = label;
  c.icon = 'door';
  if (c.action.type !== 'enter-home') c.action = { type: 'enter-home' };
}

/** The Home's solid box as a line-of-reach structure — the same box the player collides with. */
export function homeSolidObstacle(home: ResolvedHome): Obb2 {
  return makeObb(
    { cx: 0, cz: 0, halfW: home.footprint.halfWidth, halfD: home.footprint.halfDepth },
    home.position[0], home.position[2], home.rotation,
  );
}

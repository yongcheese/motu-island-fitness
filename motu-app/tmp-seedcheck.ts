/** Throwaway: how far from the player does the Starter House now seed? Delete when signed off. */
import { HOUSE_FOOTPRINT } from './src/constants/houseStyles';
import { getHomeSolidHalfExtents, PLAYER_PHYSICAL_RADIUS } from './src/utils/placementRules';

const solid = getHomeSolidHalfExtents(HOUSE_FOOTPRINT);
const clearance = PLAYER_PHYSICAL_RADIUS + 0.5;
console.log('HOUSE_FOOTPRINT      ', HOUSE_FOOTPRINT);
console.log('solid half-extents   ', solid);
console.log('player clearance     ', clearance.toFixed(2));
// The spiral starts at the island centre where the player also spawns, so the first ring that can
// clear them is the thinnest half-extent plus the clearance.
const thin = Math.min(solid.halfWidth, solid.halfDepth);
const wide = Math.max(solid.halfWidth, solid.halfDepth);
console.log(`\nplayer at island centre -> nearest accepted seed ~${(thin + clearance).toFixed(2)} away`);
console.log(`(worst axis ${(wide + clearance).toFixed(2)}); house edge sits ${clearance.toFixed(2)} from the character`);

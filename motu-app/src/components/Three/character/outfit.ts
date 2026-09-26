/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import type { ItemDefinition } from '../../../constants/items';
import { ItemCategory } from '../../../types';
import { AVATAR_SKIN_COLOR, resolveHairSpec } from '../../../constants/hair';
import { OUTFIT_HAS_SLEEVES, OUTFIT_SHELL_COLOR } from '../Outfits';
import type { OutfitType } from '../Outfits';
import type { PantsCut } from '../../../constants/pants';
import type { ShoeType } from '../Shoes';
import { resolveSpecialCosmetics } from '../../../constants/cosmeticEffects';
import type { CharacterOutfit, EarringKind, HatKind } from './types';

/**
 * WHAT the player is wearing, resolved from the equipped item list.
 *
 * Lifted out of Avatar.tsx unchanged — same name matching, same precedence, same colours.
 * It is here rather than in the controller because it is neither controller logic nor
 * model geometry: it is the translation between the two, and both a model and the dressing
 * room preview need the same answer out of it.
 *
 * Pure and synchronous on purpose. Every model gets the identical `CharacterOutfit`, so two
 * models cannot disagree about whether a 貝雷帽 is a hat, and a new model gets the whole
 * wardrobe resolved for free the moment it can draw it.
 */
export function resolveCharacterOutfit(equipped: readonly ItemDefinition[]): CharacterOutfit {
  const wearing = (needle: string) => equipped.some(item => item.name.includes(needle));

  // --- Tops ---
  const hasSkirt = wearing('草裙');
  const hasShirt = wearing('襯衫');
  const hasSurf = wearing('衝浪運動裝');
  const hasSwim = wearing('沙灘泳衣');
  const hasExplorerSuit = wearing('探險套裝');
  const hasVest = wearing('探險背心');
  const hasCaptain = wearing('船長制服');
  const hasDiving = wearing('潛水服');
  const hasShawl = wearing('披肩');
  const hasJacket = wearing('夾克');
  // Kept for the equipped-anything checks below, which only care that SOME top is on.
  const hasAdventure = hasExplorerSuit || hasVest;

  /**
   * Exactly one torso garment is drawn. Ordered most-covering first: a captain's coat over a
   * shawl has to win, or the two shells fight over the same few millimetres of torso surface
   * and z-fight. Beach swimwear is not in here - it keeps its own separate model.
   */
  const outfit: OutfitType | null =
    hasCaptain ? 'captain' :
    hasDiving ? 'diving' :
    hasSurf ? 'surf' :
    hasJacket ? 'jacket' :
    hasExplorerSuit ? 'explorer' :
    hasVest ? 'vest' :
    hasShawl ? 'shawl' :
    null;

  // --- Hats ---
  const hat: HatKind | null =
    equipped.some(item => item.name === '草帽') ? 'straw' :
    wearing('漁夫帽') ? 'bucket' :
    wearing('貝雷帽') ? 'beret' :
    wearing('毛帽') ? 'beanie' :
    wearing('平板帽') ? 'snapback' :
    null;

  // --- Necklaces ---
  const jewellery = equipped.filter(
    item => item.category === ItemCategory.NECKLACE && !item.name.includes('貝殼'),
  );

  // --- Earrings ---
  const earring: EarringKind | null =
    wearing('藍寶石') ? 'jewel' :
    wearing('花環耳飾') ? 'flower' :
    wearing('珍珠耳環') ? 'pearl' :
    wearing('金質耳環') ? 'gold' :
    wearing('珊瑚飾品') ? 'coral' :
    wearing('海星耳釘') ? 'star' :
    null;

  /**
   * Exactly one shoe is drawn. Two shoe items can be equipped at once, so without a single
   * winner the foot would try to wear both models at the same time. Most-covering first:
   * a boot's shaft would swallow anything picked under it anyway.
   *
   * MATCHED BY ID, unlike every garment above it, and that is not a style preference — it is
   * the one place where the name matching had already broken. 運動/休閒鞋's own 運動 is also
   * inside 衝浪運動裝, so `wearing('運動')` put a pair of trainers on the feet of anyone
   * wearing the surf suit; and because sport outranks sandals and flip-flops in this chain,
   * it also took those OFF a player who had actually bought a pair. A substring cannot tell
   * a garment from a shoe, so this rung of the ladder does not ask it to.
   */
  const wearingId = (id: string) => equipped.some(item => item.id === id);
  const shoes: ShoeType | null =
    wearingId('shoes-boots') ? 'boots' :
    wearingId('shoes-heels') ? 'heels' :
    wearingId('shoes-leather') ? 'leather' :
    wearingId('shoes-sport') ? 'sport' :
    wearingId('shoes-sandals') ? 'sandals' :
    // 'shoes-flats' is the 夾腳拖's id: it kept the old id so that players who had already
    // bought it did not lose it when the item changed. See constants/items.ts.
    wearingId('shoes-flats') ? 'flipflops' :
    null;

  // --- Pants ---
  const hasStraightPants = wearing('直筒褲');
  const hasWidePants = wearing('寬褲');
  const hasCargoPants = wearing('工裝褲');
  const hasSkinnyPants = wearing('窄管') || wearing('緊身褲');
  const hasTaperedPants = wearing('錐形') || wearing('蘿蔔褲');
  const hasDenimPants = wearing('牛仔褲');

  // Fallback Outfit System Check
  const isAnyShirtEquipped = hasShirt || hasSurf || hasSwim || hasAdventure || hasCaptain || hasDiving || hasShawl || hasJacket;
  const hasFallbackShirt = !isAnyShirtEquipped;

  const isAnyPantsEquipped = hasStraightPants || hasWidePants || hasCargoPants || hasSkinnyPants || hasTaperedPants || hasDenimPants || hasSkirt || hasSwim;
  const isFallbackPantsActive = !isAnyPantsEquipped;

  /**
   * Which trouser to build, resolved once from the flags above instead of at each leg.
   *
   * Null means "do not put trousers on this avatar at all", which is NOT the same as the
   * fallback pair: a 草裙 or a 沙灘泳衣 is already the bottom half of the outfit, so it counts
   * as pants being equipped (see isAnyPantsEquipped) and must not get a trouser leg lathed
   * over it. Only a genuinely bare-legged avatar wears the fallback.
   */
  const pants: PantsCut | null =
    hasStraightPants ? 'straight' :
    hasTaperedPants ? 'tapered' :
    hasWidePants ? 'wide' :
    hasSkinnyPants ? 'skinny' :
    hasCargoPants ? 'cargo' :
    hasDenimPants ? 'denim' :
    isFallbackPantsActive ? 'fallback' :
    null;

  const skinColor = AVATAR_SKIN_COLOR;
  let bodyColor = skinColor;
  if (hasShirt) bodyColor = '#38bdf8'; // Sky 400
  else if (hasSwim) bodyColor = '#f43f5e'; // Rose 500
  // Single source of truth with the 3D garment itself, so the sleeves and the torso under
  // the shell can never disagree with the shell - or with the shop icon it was taken from.
  else if (outfit) bodyColor = OUTFIT_SHELL_COLOR[outfit];
  else if (hasFallbackShirt) bodyColor = '#718096'; // Gray fallback shirt color

  return {
    // Hairstyles - exactly one spec, so two styles can never render on one head.
    hair: resolveHairSpec(equipped),
    hat,
    outfit,
    pants,
    shoes,
    necklaceId: jewellery.length > 0 ? jewellery[0].id : null,
    earring,
    hasGlasses: wearing('墨鏡'),
    hasMask: wearing('面具'),
    hasShellNecklace: wearing('貝殼項鍊'),
    hasSkirt,
    hasSwimsuit: hasSwim,
    hasShirt,
    hasFallbackShirt,
    hasSleeves: hasShirt || hasFallbackShirt || (outfit !== null && OUTFIT_HAS_SLEEVES[outfit]),
    /**
     * Special cosmetics, resolved by ITEM ID.
     *
     * Note the contrast with every line above it. This function matches on substrings of
     * Chinese item names because it predates stable ids, and that is a debt to contain
     * rather than a pattern to extend: `wearing('星星髮飾')` would also match a future
     * 小星星髮飾, and the wrong one would silently win. A catalog keyed on id cannot do that.
     *
     * Pet cosmetics are filtered out here by their socket, so an equipped 蘑菇帽 never ends
     * up on the player's head — the catalog's own SOCKET_WEARER table is what decides, not a
     * naming convention.
     */
    specials: resolveSpecialCosmetics(equipped.map(item => item.id), 'player'),
    skinColor,
    bodyColor,
  };
}

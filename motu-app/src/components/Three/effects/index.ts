/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * THE SPECIAL COSMETIC EFFECT SYSTEM.
 *
 *   constants/cosmeticEffects.ts   the catalog — what exists and how it behaves (DATA)
 *   constants/petRig.ts            where things hang off the dog
 *   particleShapes.ts              the eight silhouettes an effect can emit
 *   cosmeticRuntime.ts             the pools and the single update; no React, no per-item code
 *   EffectField.tsx                one per Canvas: mounts the pools, owns THE useFrame
 *   CosmeticModels.tsx             the ornaments themselves, as low-poly meshes
 *   CreatureMeshes.tsx             the bee and the butterfly
 *   SpecialCosmetic.tsx            socket + model + registration, for a body part to render
 *
 * A body part renders {@link CosmeticSlot}. A Canvas renders {@link CosmeticEffectField}.
 * That is the entire integration surface.
 */

export { CosmeticEffectField, useCosmeticRuntime } from './EffectField';
export { CosmeticSlot } from './SpecialCosmetic';
export { COSMETIC_MODELS } from './CosmeticModels';

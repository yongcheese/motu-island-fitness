/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * ONE copy of a piece of module state per page, however many times its module is instantiated.
 *
 * ## Why this exists
 *
 * The collision data the player walks on is module state that is WRITTEN by one part of the app and
 * READ by another: every placed model measures its footprint into lib/furniturePlacement.ts's
 * registry as it mounts (Three/PlacementGhost.tsx), and the character controller reads that registry
 * every frame (Three/characterMovement.ts → lib/placementSurfaces.ts). The two halves reach the
 * registry by importing the same file, and that is only one registry for as long as the file is
 * only one module.
 *
 * Under the dev server it is not guaranteed to be. Vite identifies a module by its URL, and after
 * hot updates the same file can be served to different importers under different URLs
 * (`furniturePlacement.ts` and `furniturePlacement.ts?t=…`) — two module instances, two registries.
 * That was measured on a running island: the platforms were measured into one registry while the
 * controller read the other, which held nothing but the house, so every 木製平台 and 觀景平台 was
 * air and the player stood inside it at grass height. The same happens, without any duplication,
 * the moment such a file is hot-edited: the module re-runs, its registry starts empty, and nothing
 * already on the island re-measures into it.
 *
 * Keyed on the page's global object through `Symbol.for`, so every instance of the module — and the
 * next one after a hot edit — resolves the same state. A production bundle has one instance anyway;
 * this makes the dev server agree with it rather than adding anything the shipped game needs.
 *
 * `key` must change whenever the SHAPE of what `create` returns changes, so a hot edit that adds a
 * field starts a fresh copy instead of handing new code an old object. What the state holds (the
 * measured footprints, the published solids) survives a hot edit; a full reload re-measures.
 */
export function sharedSingleton<T>(key: string, create: () => T): T {
  const host = globalThis as unknown as Record<symbol, unknown>;
  const slot = Symbol.for(`motu.shared.${key}`);
  if (!(slot in host)) host[slot] = create();
  return host[slot] as T;
}

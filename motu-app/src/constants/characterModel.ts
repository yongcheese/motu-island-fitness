/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { useSyncExternalStore } from 'react';
import type { CharacterModelId } from '../components/Three/character/types';

/**
 * WHICH character model is drawn — the runtime switch, kept separate from the model layer
 * itself so a preference read cannot drag the three model files into a bundle that only
 * needed to know the id.
 *
 * `authored` the hand-made 3D model, all six parts imported. THE DEFAULT.
 * `legacy`   the procedural chibi that shipped first. Still the body the whole wardrobe was
 *            drawn against, and still the fallback for any authored part that fails to load.
 * `v2`       the procedural remodel. Opt-in, renders bare.
 *
 * All three coexist and switch at runtime, which is section 十三 of the brief: the old model
 * is not removed when a new one takes over, and both stay reachable from the same build.
 */
export const CHARACTER_MODEL_IDS: readonly CharacterModelId[] = ['legacy', 'v2', 'authored'];

/**
 * Ships as `authored` — the hand-made model, promoted once all six parts were imported and
 * the wardrobe was fitted to them.
 *
 * Swapping the default is safe in a way that is worth stating, because it is what made the
 * decision reversible rather than a leap: a part that 404s or arrives malformed falls back to
 * its LEGACY counterpart on its own (see CharacterPartBoundary), per part. So a bad deploy of
 * the model files costs one limb and a console message, not a broken character — and
 * `?character=legacy` still puts the old body back for anyone who needs to compare.
 */
export const DEFAULT_CHARACTER_MODEL: CharacterModelId = 'authored';

const STORAGE_KEY = 'island:characterModel';
const CHANGE_EVENT = 'island:characterModelChange';

function isCharacterModelId(value: unknown): value is CharacterModelId {
  return value === 'legacy' || value === 'v2' || value === 'authored';
}

/**
 * Resolution order: `?character=` in the URL, then the persisted choice, then the default.
 *
 * The URL wins so a build can be A/B'd without touching localStorage on a device that is
 * awkward to reach (phone, tablet), which is most of where this game's proportions actually
 * have to be judged.
 */
function readCharacterModel(): CharacterModelId {
  if (typeof window === 'undefined') return DEFAULT_CHARACTER_MODEL;
  try {
    const fromUrl = new URLSearchParams(window.location.search).get('character');
    if (isCharacterModelId(fromUrl)) return fromUrl;
    const stored = window.localStorage.getItem(STORAGE_KEY);
    if (isCharacterModelId(stored)) return stored;
  } catch {
    // Private-mode localStorage and malformed query strings both land here; the default is fine.
  }
  return DEFAULT_CHARACTER_MODEL;
}

export function getCharacterModel(): CharacterModelId {
  return readCharacterModel();
}

/**
 * Flip the active model at runtime. Persists, then notifies every mounted
 * `useCharacterModel` so the avatar re-renders in place - no reload, which is the point when
 * the thing being compared is a silhouette.
 */
export function setCharacterModel(id: CharacterModelId): void {
  if (typeof window === 'undefined') return;
  try {
    window.localStorage.setItem(STORAGE_KEY, id);
  } catch {
    // Non-persistent is still switchable for this session.
  }
  window.dispatchEvent(new CustomEvent(CHANGE_EVENT));
}

function subscribe(onChange: () => void): () => void {
  if (typeof window === 'undefined') return () => {};
  // `storage` covers a flip made in another tab; the custom event covers this one, which
  // `storage` deliberately does not fire for.
  window.addEventListener(CHANGE_EVENT, onChange);
  window.addEventListener('storage', onChange);
  return () => {
    window.removeEventListener(CHANGE_EVENT, onChange);
    window.removeEventListener('storage', onChange);
  };
}

export function useCharacterModel(): CharacterModelId {
  return useSyncExternalStore(subscribe, readCharacterModel, () => DEFAULT_CHARACTER_MODEL);
}

export type { CharacterModelId };

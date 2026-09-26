/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { useCallback, useRef, useState } from 'react';
import { UserProfile } from '../types';
import { getPlayerHome } from '../hooks/usePlayerHome';
import { STARTER_HOUSE_ITEM_ID } from '../constants/houseStyles';

/** How much one 旋轉 press (button or the R key) turns an object. */
export const ROTATION_STEP = Math.PI / 4;

/**
 * What the player is editing on the island right now.
 *
 * - `create` — a new copy is being sited. Committing spends a copy of `itemId` (or, for the
 *   Starter House, establishes the Home).
 * - `move`   — an object already on the island was selected by clicking its model. Committing
 *   writes the new transform; 收回 picks it up.
 * - `home`   — the player's Home is being repositioned. Committing relocates it.
 *
 * NOTE what is NOT in this union: 「我選了我的家」. Selecting the Home opens its management panel
 * (UI/HomePanel.tsx) and writes no draft at all — see `homeMenuOpen` below.
 */
export type IslandDraftKind = 'create' | 'move' | 'home';

export interface IslandDraft {
  kind: IslandDraftKind;
  /** The catalog item being sited. `null` only for an existing Home, which is not an item. */
  itemId: string | null;
  /** The placement being edited — `move` only. */
  instanceId: string | null;
  position: [number, number, number];
  rotation: number;
}

export interface IslandEditorCommitHandlers {
  placeIslandItem: (itemId: string, position: [number, number, number], rotation: number) => Promise<boolean>;
  updateIslandPlacement: (instanceId: string, position: [number, number, number], rotation: number) => Promise<boolean>;
  removeIslandPlacement: (instanceId: string) => Promise<boolean>;
  placeHome: (position: [number, number, number], rotation: number) => Promise<boolean>;
  relocateHome: (position: [number, number, number], rotation: number) => Promise<boolean>;
}

/**
 * The island Selection System — one editing session, whatever is being edited.
 *
 * Placing a newly bought object, moving one that is already down, and repositioning the Home
 * were three separate flows with three separate UIs (a ghost with a top banner, a 收回 button
 * buried in a shop-like list, and a dedicated 房屋外觀 tab). They are one session here: pick a
 * subject — from the build rail, or by clicking the model in the world — then drag, rotate with
 * R, and confirm or cancel. Every subject supports the same verbs, so the world behaves
 * consistently rather than each object type having its own rules.
 *
 * Live transform is mirrored into a ref as well as state. The 3D ghost drags at frame rate
 * against the ref (React state can't keep up with a pointermove), while the panel renders from
 * the state — and `commitDraft` reads the ref, so a confirm click can never persist a transform
 * one frame stale.
 *
 * ## Selecting is not editing (the Home)
 *
 * Every ordinary object has one meaningful verb once you have pointed at it — move it — so for
 * those, "selected" and "being edited" are usefully the same state and this hook keeps them so.
 * The Home is the exception, and it was the source of a real UX complaint: it also wears an
 * APPEARANCE, it is the only thing here you can walk into, and it cannot be 收回'd. Collapsing
 * its selection into a draft meant every intent — even 「我只是想看看」 — dragged the player into a
 * transform they then had to cancel. So the Home gets two states rather than one:
 *
 *   `selectHome()`        → `homeMenuOpen` — the management panel. Nothing in the world changes.
 *   `startHomeTransform()` → a `home` draft — the ghost, the dock, 確認/取消.
 *
 * Only the second is an edit, and only the panel can start it. Finishing one (either way) drops
 * the player back into the panel, because that is the context they came from.
 */
export function useIslandEditor(profile: UserProfile | null, handlers: IslandEditorCommitHandlers) {
  const [draft, setDraft] = useState<IslandDraft | null>(null);
  /** Whether 我的家's management panel is up. Never true at the same time as a `home` draft. */
  const [homeMenuOpen, setHomeMenuOpen] = useState(false);
  // Why the current spot is refused, in the player's words, or null when it is fine. A message
  // rather than a boolean because the Placement System has more than one way to say no (see
  // PLACEMENT_BLOCK_MESSAGE in lib/placementSurfaces.ts) and the panel used to answer every one
  // of them with "此處已有其他擺設" — which is actively misleading when the real problem is that
  // the spot is open sea, or that half the object is hanging off a deck.
  const [draftBlockMessage, setDraftBlockMessage] = useState<string | null>(null);
  const draftRef = useRef<IslandDraft | null>(null);

  // The profile and the Firestore writers are re-created on every provider render. Read through
  // refs so every callback below keeps a stable identity — otherwise each render would hand the
  // 3D ghost and the editor panel brand-new handlers and re-run their effects continuously.
  const profileRef = useRef(profile);
  profileRef.current = profile;
  const handlersRef = useRef(handlers);
  handlersRef.current = handlers;

  const writeDraft = useCallback((next: IslandDraft | null) => {
    draftRef.current = next;
    setDraft(next);
  }, []);

  /** Arms a new copy for placement. The ghost picks the initial spot (nearest free ground). */
  const startPlacement = useCallback((itemId: string | null) => {
    if (!itemId) {
      writeDraft(null);
      setDraftBlockMessage(null);
      return;
    }
    writeDraft({ kind: 'create', itemId, instanceId: null, position: [0, 0.35, 0], rotation: 0 });
    setDraftBlockMessage(null);
  }, [writeDraft]);

  /** Selects a placed object — the model was clicked, or its card in the build rail was. */
  const selectIslandPlacement = useCallback((instanceId: string) => {
    const placement = (profileRef.current?.islandPlacements || []).find(p => p.instanceId === instanceId);
    if (!placement) return;
    writeDraft({
      kind: 'move',
      itemId: placement.itemId,
      instanceId,
      position: placement.position,
      rotation: placement.rotation || 0,
    });
    setDraftBlockMessage(null);
  }, [writeDraft]);

  /**
   * Selects the Home — from the build dock, from 島上物件, or by clicking the house itself.
   *
   * Opens the management panel and does nothing else. It used to write a `home` draft here, which
   * is the behaviour this split removed: pointing at your house is not a request to move it.
   * Before the Home exists there is nothing to manage, so this still arms the Starter House and
   * the first-placement flow is unchanged.
   */
  const selectHome = useCallback(() => {
    const current = profileRef.current;
    const home = getPlayerHome(current);
    if (!home) {
      if (current?.inventory?.includes(STARTER_HOUSE_ITEM_ID)) startPlacement(STARTER_HOUSE_ITEM_ID);
      return;
    }
    setHomeMenuOpen(true);
  }, [startPlacement]);

  /** Closes the management panel without touching anything. */
  const closeHomeMenu = useCallback(() => setHomeMenuOpen(false), []);

  /**
   * 移動與轉向 — the ONE way into a Home transform, and it is a deliberate second tap.
   *
   * The panel steps aside for the duration: the dock and the ghost own the screen while something
   * is being sited, and two right-hand surfaces would want the same pixels.
   */
  const startHomeTransform = useCallback(() => {
    const home = getPlayerHome(profileRef.current);
    if (!home) return;
    setHomeMenuOpen(false);
    writeDraft({
      kind: 'home',
      itemId: null,
      instanceId: null,
      position: home.position,
      rotation: home.rotation,
    });
    setDraftBlockMessage(null);
  }, [writeDraft]);

  /** Called by the ghost as it drags — position at pointer-release, rotation on every turn. */
  const setDraftTransform = useCallback((position: [number, number, number], rotation: number) => {
    const current = draftRef.current;
    if (!current) return;
    writeDraft({ ...current, position, rotation });
  }, [writeDraft]);

  const rotateDraft = useCallback(() => {
    const current = draftRef.current;
    if (!current) return;
    writeDraft({ ...current, rotation: current.rotation + ROTATION_STEP });
  }, [writeDraft]);

  const cancelDraft = useCallback(() => {
    // Ending a Home transform — cancelled OR committed, since commitDraft finishes through here —
    // hands the player back to 我的家 rather than to the bare build dock. The panel is where they
    // started, it is the only door into this session, and it is now showing a facing they may
    // have just changed. An ordinary object has no such context to return to.
    if (draftRef.current?.kind === 'home') setHomeMenuOpen(true);
    writeDraft(null);
    setDraftBlockMessage(null);
  }, [writeDraft]);

  /**
   * Persists whatever is being edited. Which write runs is the draft's own kind — the caller
   * never has to know whether it is holding a fountain, a new palm tree or the house.
   */
  const commitDraft = useCallback(async (): Promise<boolean> => {
    const current = draftRef.current;
    if (!current) return false;

    const write = handlersRef.current;
    let ok = false;
    if (current.kind === 'home') {
      ok = await write.relocateHome(current.position, current.rotation);
    } else if (current.kind === 'move' && current.instanceId) {
      ok = await write.updateIslandPlacement(current.instanceId, current.position, current.rotation);
    } else if (current.kind === 'create' && current.itemId === STARTER_HOUSE_ITEM_ID) {
      ok = await write.placeHome(current.position, current.rotation);
    } else if (current.kind === 'create' && current.itemId) {
      ok = await write.placeIslandItem(current.itemId, current.position, current.rotation);
    }

    if (ok) cancelDraft();
    return ok;
  }, [cancelDraft]);

  /** 收回 — picks the selected object back up, returning its copy to the inventory. */
  const retrieveDraftTarget = useCallback(async (): Promise<boolean> => {
    const current = draftRef.current;
    if (!current || current.kind !== 'move' || !current.instanceId) return false;
    const ok = await handlersRef.current.removeIslandPlacement(current.instanceId);
    if (ok) cancelDraft();
    return ok;
  }, [cancelDraft]);

  return {
    islandDraft: draft,
    isDraftBlocked: draftBlockMessage !== null,
    draftBlockMessage,
    setDraftBlock: setDraftBlockMessage,
    startPlacement,
    selectIslandPlacement,
    selectHome,
    homeMenuOpen,
    closeHomeMenu,
    startHomeTransform,
    setDraftTransform,
    rotateDraft,
    cancelDraft,
    commitDraft,
    retrieveDraftTarget,
  };
}

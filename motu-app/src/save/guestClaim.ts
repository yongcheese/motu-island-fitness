/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { doc, getDoc, setDoc, writeBatch } from 'firebase/firestore';
import { db } from '../lib/firebaseCore';
import { localSaveStore } from './LocalSaveStore';

/**
 * Moves a local-only guest's island into a real account after they sign in —
 * 「將 Guest 存檔綁定至正式帳號」.
 *
 * There are two guest→account paths in the system and only this one needs to
 * copy anything:
 *
 *  - A **Firebase anonymous** guest is upgraded in place by
 *    `AuthenticationManager.linkProvider()`. The uid does not change, so
 *    `users/{uid}` is already the right document and there is nothing to move.
 *    That is the good path, and it becomes the default once Anonymous sign-in
 *    is enabled in the console (docs/AUTH_SETUP.md).
 *  - A **local-only** guest has no Firebase account at all, so their save lives
 *    in localStorage under a device-scoped uid. That is what this claims.
 */

export type ClaimOutcome =
  /** Local save copied into the account. */
  | 'claimed'
  /** The account already has cloud progress; the local save was left untouched. */
  | 'target-has-save'
  /** The guest never got as far as creating a save. */
  | 'nothing-to-claim'
  | 'failed';

export interface ClaimResult {
  outcome: ClaimOutcome;
  /** Documents written. Zero unless `outcome === 'claimed'`. */
  documentsWritten: number;
}

/**
 * @param fromUid device-scoped uid the local save is filed under
 * @param toUid   the newly signed-in Firebase uid
 *
 * **Never overwrites an existing cloud save.** A player who already has an
 * island on their account and then signs in on a friend's device — where a
 * local guest save happens to exist — must not have their real island replaced
 * by that stranger's. When the target already has a profile we report
 * `target-has-save` and leave both saves alone; the caller decides what to tell
 * the player.
 */
export async function claimLocalSave(fromUid: string, toUid: string): Promise<ClaimResult> {
  const localPaths = localSaveStore.paths(fromUid);
  if (localPaths.length === 0) {
    return { outcome: 'nothing-to-claim', documentsWritten: 0 };
  }

  const localProfile = localSaveStore.read(fromUid, `users/${fromUid}`);
  if (!localProfile) {
    return { outcome: 'nothing-to-claim', documentsWritten: 0 };
  }

  try {
    const targetProfileRef = doc(db, 'users', toUid);
    const targetSnapshot = await getDoc(targetProfileRef);
    if (targetSnapshot.exists()) {
      return { outcome: 'target-has-save', documentsWritten: 0 };
    }

    // The profile is written first and on its own. Firestore rules validate a
    // *created* user document structurally (`isValidUser`), and sub-collection
    // rules assume the owner document exists, so batching it together with the
    // logs would fail as one unit if any single log were malformed.
    const profileToWrite = { ...localProfile, userId: toUid };
    await setDoc(targetProfileRef, profileToWrite);

    let written = 1;
    const batch = writeBatch(db);
    let batched = 0;

    for (const path of localPaths) {
      if (path === `users/${fromUid}`) continue; // already written
      const data = localSaveStore.read(fromUid, path);
      if (!data) continue;

      // Re-file the document under the new uid: `users/<old>/settings/current`
      // becomes `users/<new>/settings/current`.
      const rebased = path.replace(`users/${fromUid}`, `users/${toUid}`);
      const segments = rebased.split('/');
      if (segments.length < 2 || segments.length % 2 !== 0) continue; // not a document path

      batch.set(doc(db, ...(segments as [string, string, ...string[]])), { ...data, userId: toUid });
      batched += 1;
      written += 1;
    }

    if (batched > 0) await batch.commit();

    // Only drop the local copy once the cloud write has actually succeeded.
    localSaveStore.clearNamespace(fromUid);

    console.info(`[save] 訪客存檔已綁定至帳號 ${toUid}（${written} 份文件）。`);
    return { outcome: 'claimed', documentsWritten: written };
  } catch (error) {
    // The local save is deliberately still intact here, so the player can retry
    // by signing out and back in rather than losing the island.
    console.error('[save] Guest save claim failed; the local copy has been kept.', error);
    return { outcome: 'failed', documentsWritten: 0 };
  }
}

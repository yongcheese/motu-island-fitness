/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Storage facade: one Firestore-shaped API that writes to Firestore for real
 * sessions and to `LocalSaveStore` for local-only guests.
 *
 * ## What changed and why the shape stayed the same
 *
 * This file used to be four things at once — SDK bootstrap, a fake `auth`
 * object that impersonated Firebase's, a hardcoded three-key localStorage guest
 * save, and the Firestore re-exports. The first three have moved out:
 *
 *  - SDK bootstrap  → `lib/firebaseCore.ts`
 *  - authentication → `src/auth/` (AuthenticationManager and friends)
 *  - offline save   → `src/save/LocalSaveStore.ts`
 *
 * What deliberately did NOT change is the exported *shape*: eighteen call sites
 * across the game do `doc(db, 'users', uid)` / `updateDoc` / `onSnapshot`, and
 * rewriting them all was the fastest way to break a working game while fixing
 * login. So this stays a Firestore-shaped port, and the routing decision — real
 * or local — is made in one place, {@link isLocalSession}, instead of by
 * fourteen copies of `localStorage.getItem('is_local_guest') === 'true'`.
 *
 * `auth` is re-exported for the two sign-out buttons that still import it, but
 * it now delegates to AuthenticationManager rather than shadowing Firebase.
 */

import {
  arrayRemove as firestoreArrayRemove,
  arrayUnion as firestoreArrayUnion,
  collection as firestoreCollectionRef,
  doc as firestoreDoc,
  getDoc as firestoreGetDoc,
  getDocFromServer,
  increment as firestoreIncrement,
  limit as firestoreLimit,
  onSnapshot as firestoreOnSnapshot,
  orderBy as firestoreOrderBy,
  query as firestoreQuery,
  setDoc as firestoreSetDoc,
  updateDoc as firestoreUpdateDoc,
} from 'firebase/firestore';

import { authManager } from '../auth/AuthenticationManager';
import {
  localArrayRemove,
  localArrayUnion,
  localIncrement,
  localSaveStore,
} from '../save/LocalSaveStore';
import { recordSaveFailure, type SaveFailure } from './saveStatus';
import { db, isPlaceholderConfig } from './firebaseCore';

export { db };

/**
 * Compatibility shim for the handful of components that import `auth` purely to
 * sign out. New code should use `useAuth()` / `authManager` directly.
 */
export const auth = {
  get currentUser() {
    return authManager.getState().user;
  },
  signOut: () => authManager.signOut(),
  onAuthStateChanged: (callback: (user: unknown) => void) =>
    authManager.subscribe((state) => callback(state.user)),
};

// --- Routing -----------------------------------------------------------------

/**
 * The single routing decision: is the active session local-only?
 *
 * True only for a player whose device could not obtain a Firebase session at
 * all. A signed-in account — including a Firebase *anonymous* guest — is always
 * false, because those have a real uid and belong in Firestore.
 */
function isLocalSession(): boolean {
  return authManager.getState().user?.isLocalOnly === true;
}

/** The namespace a local write belongs to. Never guessed from a path string. */
function localUid(): string | null {
  const user = authManager.getState().user;
  return user?.isLocalOnly ? user.uid : null;
}

/** Tagged references used only in local mode. */
interface LocalDocRef {
  __localDoc: string;
  path: string;
}
interface LocalCollectionRef {
  __localCollection: string;
  path: string;
}
interface LocalQuery {
  __localQuery: string;
  orderByField?: string;
  direction?: 'asc' | 'desc';
  limitTo?: number;
}

function isLocalDocRef(value: unknown): value is LocalDocRef {
  return typeof value === 'object' && value !== null && '__localDoc' in value;
}
function isLocalCollectionRef(value: unknown): value is LocalCollectionRef {
  return typeof value === 'object' && value !== null && '__localCollection' in value;
}
function isLocalQuery(value: unknown): value is LocalQuery {
  return typeof value === 'object' && value !== null && '__localQuery' in value;
}

// --- Reference builders ------------------------------------------------------

export function doc(dbRef: unknown, path: string, ...segments: string[]) {
  if (isLocalSession()) {
    const full = [path, ...segments].join('/');
    return { __localDoc: full, path: full } as LocalDocRef;
  }
  return firestoreDoc(dbRef as never, path, ...segments);
}

export function collection(dbRef: unknown, path: string, ...segments: string[]) {
  if (isLocalSession()) {
    const full = [path, ...segments].join('/');
    return { __localCollection: full, path: full } as LocalCollectionRef;
  }
  return firestoreCollectionRef(dbRef as never, path, ...segments);
}

export function orderBy(field: string, direction?: 'asc' | 'desc') {
  if (isLocalSession()) return { __localOrderBy: field, direction } as never;
  return firestoreOrderBy(field, direction);
}

export function limit(count: number) {
  if (isLocalSession()) return { __localLimit: count } as never;
  return firestoreLimit(count);
}

export function query(ref: unknown, ...constraints: unknown[]) {
  if (isLocalCollectionRef(ref)) {
    const local: LocalQuery = { __localQuery: ref.__localCollection };
    for (const constraint of constraints as Record<string, unknown>[]) {
      if (constraint && '__localOrderBy' in constraint) {
        local.orderByField = constraint.__localOrderBy as string;
        local.direction = (constraint.direction as 'asc' | 'desc') ?? 'asc';
      }
      if (constraint && '__localLimit' in constraint) {
        local.limitTo = constraint.__localLimit as number;
      }
    }
    return local as never;
  }
  return firestoreQuery(ref as never, ...(constraints as never[]));
}

// --- Field values ------------------------------------------------------------

export function increment(n: number) {
  return isLocalSession() ? (localIncrement(n) as never) : firestoreIncrement(n);
}

export function arrayUnion(...elements: unknown[]) {
  return isLocalSession()
    ? (localArrayUnion(...elements) as never)
    : firestoreArrayUnion(...(elements as never[]));
}

export function arrayRemove(...elements: unknown[]) {
  return isLocalSession()
    ? (localArrayRemove(...elements) as never)
    : firestoreArrayRemove(...(elements as never[]));
}

// --- Reads and writes --------------------------------------------------------

/**
 * `object` rather than `Record<string, unknown>`: callers pass declared
 * interfaces (`UserProfile`, `AppSettings`), and TypeScript only grants an
 * implicit index signature to type aliases, never to interfaces.
 */
type DocumentData = object;

export async function updateDoc(reference: unknown, data: DocumentData) {
  const uid = localUid();
  if (uid && isLocalDocRef(reference)) {
    localSaveStore.update(uid, reference.path, data as Record<string, unknown>);
    return;
  }
  try {
    return await firestoreUpdateDoc(reference as never, data as never);
  } catch (error) {
    // A rules refusal names neither the rule nor the fields, and handleFirestoreError only gets
    // the path. Which top-level keys the write touched is what decides which `hasOnly` clause of
    // firestore.rules it had to match, so it is logged here, the one place that still knows.
    if ((error as { code?: unknown } | null)?.code === 'permission-denied') {
      const keys = [...new Set(Object.keys(data).map((key) => key.split('.')[0]))];
      console.error('[firestore] 被規則拒絕的更新，寫入的欄位：', keys.join(', '), (reference as { path?: string }).path ?? '');
    }
    throw error;
  }
}

export async function setDoc(
  reference: unknown,
  data: DocumentData,
  options?: { merge?: boolean },
) {
  const uid = localUid();
  if (uid && isLocalDocRef(reference)) {
    localSaveStore.set(uid, reference.path, data as Record<string, unknown>, options);
    return;
  }
  return options
    ? firestoreSetDoc(reference as never, data as never, options)
    : firestoreSetDoc(reference as never, data as never);
}

/** Mirrors `DocumentSnapshot`'s surface as far as this app uses it. */
interface SnapshotLike {
  exists: () => boolean;
  data: () => unknown;
}

export async function getDoc(reference: unknown): Promise<SnapshotLike> {
  const uid = localUid();
  if (uid && isLocalDocRef(reference)) {
    const data = localSaveStore.read(uid, reference.path);
    return { exists: () => data !== null, data: () => data };
  }
  return firestoreGetDoc(reference as never) as unknown as Promise<SnapshotLike>;
}

export function onSnapshot(
  refOrQuery: unknown,
  // Intentionally loose: call sites read either `.exists()/.data()` (documents)
  // or `.docs` (queries), and both back-ends produce those shapes.
  onNext: (snapshot: any) => void,
  onError?: (error: unknown) => void,
): () => void {
  const uid = localUid();

  if (uid && isLocalDocRef(refOrQuery)) {
    return localSaveStore.subscribe(uid, refOrQuery.path, (data) => {
      onNext({ exists: () => data !== null, data: () => data } as never);
    });
  }

  if (uid && isLocalQuery(refOrQuery)) {
    const spec = refOrQuery;
    return localSaveStore.subscribeCollection(uid, spec.__localQuery, (docs) => {
      let rows = [...docs];
      if (spec.orderByField) {
        const field = spec.orderByField;
        const factor = spec.direction === 'desc' ? -1 : 1;
        rows.sort((a, b) => {
          const left = a[field] as string | number;
          const right = b[field] as string | number;
          if (left === right) return 0;
          return (left < right ? -1 : 1) * factor;
        });
      }
      if (spec.limitTo !== undefined) rows = rows.slice(0, spec.limitTo);
      onNext({ docs: rows.map((row) => ({ data: () => row })) } as never);
    });
  }

  return firestoreOnSnapshot(refOrQuery as never, onNext as never, onError as never);
}

// --- Error reporting ---------------------------------------------------------

export enum OperationType {
  CREATE = 'create',
  UPDATE = 'update',
  DELETE = 'delete',
  LIST = 'list',
  GET = 'get',
  WRITE = 'write',
}

export interface FirestoreErrorInfo {
  error: string;
  operationType: OperationType;
  path: string | null;
  authInfo: {
    userId?: string | null;
    email?: string | null;
    isGuest?: boolean | null;
    isLocalOnly?: boolean | null;
    providers?: string[];
  };
}

/**
 * Reports a failed read/write, and RETURNS — it must never throw.
 *
 * This used to end with `throw new Error(JSON.stringify(info))`, which quietly
 * disabled the error handling of every one of its eighteen call sites. They are
 * all shaped like:
 *
 *     try { await updateDoc(...); return true }
 *     catch (e) { handleFirestoreError(e, ...); return false }
 *
 * — so the `return false` was unreachable: re-throwing from inside the catch
 * replaced a handled failure with a rejected promise. What that cost in practice
 * was the entire recovery path. `commitDraft` never returned, so the island
 * editor neither cleared the draft nor reported the problem; the caller's
 * `void commitDraft()` turned the rejection into an unhandled one; and the
 * player got no sound, no message and no change on screen. A save that is
 * refused by the server looked exactly like a click that did nothing, which is
 * why the first-run "place your house" flow could be attempted forever without
 * once telling anyone it was failing.
 *
 * The reason is recorded in `lib/saveStatus.ts` on the way past, so the surface
 * closest to the action can say what actually went wrong instead of guessing at
 * "請稍後再試".
 */
export function handleFirestoreError(
  error: unknown,
  operationType: OperationType,
  path: string | null,
): SaveFailure {
  const user = authManager.getState().user;
  const info: FirestoreErrorInfo = {
    error: error instanceof Error ? error.message : String(error),
    authInfo: {
      userId: user?.uid ?? null,
      email: user?.email ?? null,
      isGuest: user?.isGuest ?? null,
      isLocalOnly: user?.isLocalOnly ?? null,
      providers: user?.linkedProviders ?? [],
    },
    operationType,
    path,
  };
  console.error('Firestore Error: ', JSON.stringify(info));
  return recordSaveFailure(error, path);
}

// --- Startup connectivity probe ---------------------------------------------

if (isPlaceholderConfig) {
  console.info('[firebase] Placeholder configuration detected; running in local-only mode.');
} else {
  // Non-blocking, and failures are expected offline — the local store covers it.
  setTimeout(() => {
    getDocFromServer(firestoreDoc(db, 'test', 'connection')).catch(() => {
      /* offline cache handles this; see docs/AUTH_SETUP.md if it never recovers */
    });
  }, 1000);
}

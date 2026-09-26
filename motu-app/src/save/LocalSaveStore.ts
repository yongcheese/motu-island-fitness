/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * A tiny document store over localStorage, shaped like Firestore.
 *
 * ## What this replaces
 *
 * The offline/guest save used to be three `if (path === 'users/local-guest-uid')`
 * branches inside `lib/firebase.ts`, writing to three fixed keys:
 * `local_profile`, `local_settings`, `local_logs`. Two consequences, both of
 * which the brief asks about directly:
 *
 *  - **「是否避免不同帳號共用同一份存檔」** — it did not. Every guest on Earth
 *    shared the uid `local-guest-uid` and therefore those same three keys. On a
 *    shared browser, two players overwrote each other's island; and because the
 *    keys had no account in them, data from a previous session leaked into the
 *    next one.
 *  - Any path the three branches did not spell out was silently dropped: the
 *    write resolved successfully and stored nothing.
 *
 * Documents here are namespaced by uid and addressed by their full path, so the
 * store works for any path the game invents later without being taught about it.
 */

/** Write sentinels, mirroring Firestore's `increment`/`arrayUnion`/`arrayRemove`. */
export type LocalFieldValue =
  | { __localFieldValue: 'increment'; value: number }
  | { __localFieldValue: 'arrayUnion'; values: unknown[] }
  | { __localFieldValue: 'arrayRemove'; values: unknown[] };

export function localIncrement(n: number): LocalFieldValue {
  return { __localFieldValue: 'increment', value: n };
}

export function localArrayUnion(...values: unknown[]): LocalFieldValue {
  return { __localFieldValue: 'arrayUnion', values };
}

export function localArrayRemove(...values: unknown[]): LocalFieldValue {
  return { __localFieldValue: 'arrayRemove', values };
}

function isFieldValue(value: unknown): value is LocalFieldValue {
  return typeof value === 'object' && value !== null && '__localFieldValue' in value;
}

type Doc = Record<string, unknown>;

const KEY_PREFIX = 'island.save';

/** `island.save::<uid>::users/<uid>/settings/current` */
function storageKey(uid: string, path: string): string {
  return `${KEY_PREFIX}::${uid}::${path}`;
}

function namespacePrefix(uid: string): string {
  return `${KEY_PREFIX}::${uid}::`;
}

/** Applies one field write on top of the existing value. */
function resolveValue(current: unknown, incoming: unknown): unknown {
  if (!isFieldValue(incoming)) return incoming;

  switch (incoming.__localFieldValue) {
    case 'increment':
      return (typeof current === 'number' ? current : 0) + incoming.value;
    case 'arrayUnion': {
      const array = Array.isArray(current) ? [...current] : [];
      for (const value of incoming.values) {
        if (!array.some((existing) => deepEquals(existing, value))) array.push(value);
      }
      return array;
    }
    case 'arrayRemove': {
      const array = Array.isArray(current) ? [...current] : [];
      return array.filter((existing) => !incoming.values.some((value) => deepEquals(existing, value)));
    }
  }
}

/**
 * Structural equality, because `arrayUnion`/`arrayRemove` are used with placement
 * objects (`{ instanceId, itemId, position, rotation }`), not just id strings —
 * the old `arr.includes(el)` compared those by reference and so never matched,
 * which made retrieving a placed item a silent no-op offline.
 */
function deepEquals(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  if (typeof a !== typeof b || a === null || b === null) return false;
  if (typeof a !== 'object') return false;
  return JSON.stringify(a) === JSON.stringify(b);
}

/** Writes `a.b.c` style keys into a nested object, matching Firestore's updateDoc. */
function applyUpdate(target: Doc, key: string, value: unknown): void {
  if (!key.includes('.')) {
    target[key] = resolveValue(target[key], value);
    return;
  }

  const segments = key.split('.');
  let cursor: Doc = target;
  for (let i = 0; i < segments.length - 1; i += 1) {
    const segment = segments[i];
    if (typeof cursor[segment] !== 'object' || cursor[segment] === null) {
      cursor[segment] = {};
    }
    cursor = cursor[segment] as Doc;
  }
  const leaf = segments[segments.length - 1];
  cursor[leaf] = resolveValue(cursor[leaf], value);
}

type Listener = (data: Doc | null) => void;

/**
 * A local write that did not land — storage full, or blocked by the browser.
 *
 * Shaped like a `FirebaseError` (a `code` property) on purpose: `describeSaveError`
 * (lib/saveStatus.ts) reads that one field, so an offline save failure is reported through the same
 * path, and in the same red banner, as a cloud one instead of needing its own branch at every call
 * site.
 */
export class LocalSaveError extends Error {
  readonly code = 'local-storage-full';
  constructor(path: string, readonly cause?: unknown) {
    super(`Local save failed for ${path}`);
    this.name = 'LocalSaveError';
  }
}

export class LocalSaveStore {
  /** path → listeners, per uid namespace. */
  private listeners = new Map<string, Set<Listener>>();

  private listenerKey(uid: string, path: string): string {
    return `${uid}::${path}`;
  }

  read(uid: string, path: string): Doc | null {
    try {
      const raw = localStorage.getItem(storageKey(uid, path));
      return raw ? (JSON.parse(raw) as Doc) : null;
    } catch {
      return null;
    }
  }

  /**
   * Persists one document, or THROWS.
   *
   * It used to log the failure and `return`, with a comment claiming nothing was silently
   * reported as saved — which is precisely what happened. Every caller is an `await updateDoc(...)`
   * inside a `try/catch` (context/use*Actions.ts): swallowing the error here resolved that promise
   * normally, so the write was reported as a success, no `catch` ran, no message was shown, and the
   * value on screen simply never moved. A full or disabled localStorage looked exactly like a dead
   * button — the 管理員測試補給 +10K 金幣 being the clearest case, since one press writes nothing
   * else that would have revealed the problem.
   *
   * The thrown error carries a Firestore-shaped `code` so it travels the same route as a refused
   * cloud write: handleFirestoreError → lib/saveStatus.ts → the red banner, in the player's words.
   */
  write(uid: string, path: string, data: Doc): void {
    try {
      localStorage.setItem(storageKey(uid, path), JSON.stringify(data));
    } catch (error) {
      console.error(`[save] Could not persist ${path} locally.`, error);
      throw new LocalSaveError(path, error);
    }
    this.emit(uid, path, data);
  }

  set(uid: string, path: string, data: Doc, options?: { merge?: boolean }): void {
    const next = options?.merge ? { ...(this.read(uid, path) ?? {}), ...data } : { ...data };
    next.lastUpdated = new Date().toISOString();
    this.write(uid, path, next);
  }

  update(uid: string, path: string, updates: Doc): void {
    const current = this.read(uid, path);
    // Firestore's updateDoc rejects on a missing document; matching that keeps
    // offline and online behaviour honest instead of inventing a document.
    const next: Doc = current ? structuredClone(current) : {};
    for (const [key, value] of Object.entries(updates)) applyUpdate(next, key, value);
    next.lastUpdated = new Date().toISOString();
    this.write(uid, path, next);
  }

  delete(uid: string, path: string): void {
    try {
      localStorage.removeItem(storageKey(uid, path));
    } catch {
      /* ignore */
    }
    this.emit(uid, path, null);
  }

  /** Every document directly or transitively under a collection path. */
  list(uid: string, collectionPath: string): Doc[] {
    const prefix = `${namespacePrefix(uid)}${collectionPath}/`;
    const results: Doc[] = [];
    try {
      for (let i = 0; i < localStorage.length; i += 1) {
        const key = localStorage.key(i);
        if (!key || !key.startsWith(prefix)) continue;
        const raw = localStorage.getItem(key);
        if (raw) results.push(JSON.parse(raw) as Doc);
      }
    } catch {
      /* ignore */
    }
    return results;
  }

  /** Every stored path in a uid's namespace — the basis of the guest claim. */
  paths(uid: string): string[] {
    const prefix = namespacePrefix(uid);
    const paths: string[] = [];
    try {
      for (let i = 0; i < localStorage.length; i += 1) {
        const key = localStorage.key(i);
        if (key?.startsWith(prefix)) paths.push(key.slice(prefix.length));
      }
    } catch {
      /* ignore */
    }
    return paths;
  }

  /** Drops an entire account's local save. Used after a successful claim. */
  clearNamespace(uid: string): void {
    for (const path of this.paths(uid)) {
      try {
        localStorage.removeItem(storageKey(uid, path));
      } catch {
        /* ignore */
      }
    }
  }

  /**
   * Watches a document. Fires immediately with the current value, then on every
   * later write, matching `onSnapshot`.
   */
  subscribe(uid: string, path: string, listener: Listener): () => void {
    const key = this.listenerKey(uid, path);
    let set = this.listeners.get(key);
    if (!set) {
      set = new Set();
      this.listeners.set(key, set);
    }
    set.add(listener);

    // Async, so subscribing during render cannot synchronously set state.
    const initial = this.read(uid, path);
    queueMicrotask(() => {
      if (set?.has(listener)) listener(initial);
    });

    return () => {
      set?.delete(listener);
      if (set?.size === 0) this.listeners.delete(key);
    };
  }

  /**
   * Watches a collection. Same contract as {@link subscribe}, but re-lists on
   * any write beneath the collection path.
   */
  subscribeCollection(uid: string, collectionPath: string, listener: (docs: Doc[]) => void): () => void {
    const key = this.listenerKey(uid, `${collectionPath}/*`);
    let set = this.listeners.get(key);
    if (!set) {
      set = new Set();
      this.listeners.set(key, set);
    }
    const wrapped: Listener = () => listener(this.list(uid, collectionPath));
    set.add(wrapped);

    queueMicrotask(() => {
      if (set?.has(wrapped)) listener(this.list(uid, collectionPath));
    });

    return () => {
      set?.delete(wrapped);
      if (set?.size === 0) this.listeners.delete(key);
    };
  }

  private emit(uid: string, path: string, data: Doc | null): void {
    this.listeners.get(this.listenerKey(uid, path))?.forEach((listener) => listener(data));

    // Wake any collection watchers whose path is a prefix of this document.
    const segments = path.split('/');
    for (let i = segments.length - 1; i > 0; i -= 1) {
      const collectionKey = this.listenerKey(uid, `${segments.slice(0, i).join('/')}/*`);
      this.listeners.get(collectionKey)?.forEach((listener) => listener(data));
    }
  }
}

export const localSaveStore = new LocalSaveStore();

/**
 * Moves a pre-existing `local_profile` / `local_settings` / `local_logs` save
 * into this store, under `uid`.
 *
 * This matters more than it looks: because Firebase anonymous sign-in is
 * disabled on this project, the legacy local guest was the ONLY working mode,
 * so every current player's island lives in exactly those three keys. Fixing
 * login must not orphan them.
 *
 * Idempotent, and it leaves the legacy keys in place — reading them again is
 * harmless, whereas deleting them makes a rollback lose real player data.
 */
const LEGACY_UID = 'local-guest-uid';
const LEGACY_CLAIMED_FLAG = 'island.save.legacyAdopted';

export function adoptLegacyLocalSave(uid: string): boolean {
  try {
    if (localStorage.getItem(LEGACY_CLAIMED_FLAG) === '1') return false;

    const profileRaw = localStorage.getItem('local_profile');
    if (!profileRaw) {
      // Nothing to rescue; mark done so we stop looking on every start-up.
      localStorage.setItem(LEGACY_CLAIMED_FLAG, '1');
      return false;
    }

    const profile = JSON.parse(profileRaw) as Doc;
    profile.userId = uid;
    localSaveStore.write(uid, `users/${uid}`, profile);

    const settingsRaw = localStorage.getItem('local_settings');
    if (settingsRaw) {
      const settings = JSON.parse(settingsRaw) as Doc;
      settings.userId = uid;
      localSaveStore.write(uid, `users/${uid}/settings/current`, settings);
    }

    const logsRaw = localStorage.getItem('local_logs');
    if (logsRaw) {
      const logs = JSON.parse(logsRaw) as Doc[];
      for (const log of logs) {
        const logId = String(log.logId ?? crypto.randomUUID());
        localSaveStore.write(uid, `users/${uid}/workout_logs/${logId}`, { ...log, userId: uid });
      }
    }

    localStorage.setItem(LEGACY_CLAIMED_FLAG, '1');
    console.info(`[save] 已將舊版訪客存檔轉移到新的帳號空間 (${uid})。`);
    return true;
  } catch (error) {
    console.error('[save] Legacy local save adoption failed.', error);
    return false;
  }
}

export { LEGACY_UID };

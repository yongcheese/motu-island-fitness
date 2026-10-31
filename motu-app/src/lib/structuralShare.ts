/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Carries the identity of everything that did NOT change from `prev` into `next`.
 *
 * ## Why the save needs this
 *
 * A realtime snapshot (Firestore's `doc.data()`, or LocalSaveStore's `structuredClone`) is a brand
 * new object tree every time, down to the last array. Writing that straight into React state told
 * every `useMemo` and `useEffect` in the game that `profile.home.position`,
 * `profile.islandPlacements` and every other field had changed — on EVERY write, including a coin,
 * a step count or the five-minute 「我還在島上」 heartbeat that touch none of them.
 *
 * On the island that was not just wasted work. Anything derived from those fields was rebuilt, and
 * the wildflowers and rocks were derived with `Math.random()`, so each unrelated save re-rolled the
 * whole field: the 「花和石頭一直重新生成、閃爍」 report. Identity is what the rest of the code
 * uses to mean "this changed", so the fix is to make identity honest at the one place the data
 * enters, rather than asking every consumer to compare by value.
 *
 * ## The rule
 *
 * Plain objects and arrays are compared member by member; a subtree whose contents are equal is
 * replaced by the SAME object `prev` already held, and a container is only rebuilt when something
 * inside it really differs. Anything else (Firestore Timestamps, class instances) is not looked
 * into — it is taken from `next` unless it is literally the same reference — so this can never
 * hand back a stale value, only an equal one.
 */
export function structuralShare<T>(prev: unknown, next: T): T {
  return share(prev, next) as T;
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  if (value === null || typeof value !== 'object') return false;
  const proto = Object.getPrototypeOf(value);
  return proto === Object.prototype || proto === null;
}

function share(prev: unknown, next: unknown): unknown {
  if (Object.is(prev, next)) return prev;

  if (Array.isArray(prev) && Array.isArray(next)) {
    let same = prev.length === next.length;
    const out = next.map((item, i) => {
      const shared = share(prev[i], item);
      if (shared !== prev[i]) same = false;
      return shared;
    });
    return same ? prev : out;
  }

  if (isPlainObject(prev) && isPlainObject(next)) {
    const prevKeys = Object.keys(prev);
    const nextKeys = Object.keys(next);
    let same = prevKeys.length === nextKeys.length;
    const out: Record<string, unknown> = {};
    for (const key of nextKeys) {
      const shared = share(prev[key], next[key]);
      if (shared !== prev[key] || !(key in prev)) same = false;
      out[key] = shared;
    }
    return same ? prev : out;
  }

  return next;
}

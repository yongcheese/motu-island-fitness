/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * The one place the Firebase SDK is initialised.
 *
 * Split out of `lib/firebase.ts` so that `src/auth/` and `src/save/` can both
 * reach the SDK without importing each other — `lib/firebase.ts` is now a thin
 * compatibility facade over those two, and it imports this too. Nothing else in
 * the app should call `initializeApp`/`getAuth`/`initializeFirestore`.
 */

import { initializeApp, type FirebaseApp } from 'firebase/app';
import { getAuth, type Auth } from 'firebase/auth';
import { initializeFirestore, type Firestore } from 'firebase/firestore';
import firebaseConfig from '../../firebase-applet-config.json';

export const app: FirebaseApp = initializeApp(firebaseConfig);

/**
 * Long polling is forced because the project has historically run behind proxies
 * where Firestore's streaming transport stalls. Unchanged from the original
 * setup — do not "clean this up" without testing on the deployed host.
 */
export const db: Firestore = initializeFirestore(
  app,
  { experimentalForceLongPolling: true },
  firebaseConfig.firestoreDatabaseId,
);

/**
 * The real Firebase Auth instance.
 *
 * Named `firebaseAuth` rather than `auth` on purpose: the old code exported an
 * object literally called `auth` that *impersonated* this one and rewrote
 * `currentUser`/`onAuthStateChanged` to serve a localStorage guest. Anything
 * that wants "who is signed in" must ask `AuthenticationManager`, not this.
 */
export const firebaseAuth: Auth = getAuth(app);

/** True when the bundled config is still the AI-Studio placeholder. */
export const isPlaceholderConfig =
  firebaseConfig.projectId === 'remixed-project-id' ||
  firebaseConfig.apiKey === 'remixed-api-key';

export { firebaseConfig };

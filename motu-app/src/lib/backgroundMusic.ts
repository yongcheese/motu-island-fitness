/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * THE BACKGROUND MUSIC MANAGER.
 *
 * One module decides what the island is playing. Everything else - Settings, the
 * player panel, the workout screen - describes what it WANTS and reads back what
 * is happening; nothing else starts, stops or crossfades an audio source.
 *
 *   BackgroundMusicManager
 *     ├── built-in BGM   (lib/ambientMusic.ts - generative Web Audio)
 *     ├── YouTube Music  (lib/youtubeMusic.ts - the IFrame player transport)
 *     ├── source         ('builtin' | 'youtube' - exactly one, always)
 *     ├── volume / muted
 *     ├── playback state
 *     └── lifecycle      (module-scoped: no React component owns any of it)
 *
 * WHY THIS EXISTS. The two engines used to be driven from two different places
 * with no shared notion of "the current source": MusicPlayer.tsx started and
 * stopped the synth, the Settings panel owned the YouTube player's whole
 * lifetime, and the only thing keeping them apart was MusicPlayer watching
 * whether YouTube's status happened to read 'playing' at that instant. That
 * inference is wrong in every state that is not 'playing' - buffering between
 * playlist tracks, a paused player, a finished song, the seconds while a link
 * loads - and each of those let the synth music start up underneath YouTube.
 * Hence "兩個一起播".
 *
 * The rule here is structural instead: `desired.source` names the one source
 * that may make sound, `reconcile()` is the only function that touches either
 * engine, and it always silences the other one. Two sources cannot overlap
 * because there is no code path that can start one without stopping the other.
 */

import {
  startAmbientMusic,
  stopAmbientMusic,
  AmbientMoodId,
} from './ambientMusic';
import {
  ensureYtmPlayer,
  getYtmSnapshot,
  subscribeYtm,
  loadYtm,
  cueYtm,
  stopYtm,
  playYtm,
  pauseYtm,
  setYtmVolume,
  YouTubeMusicRef,
  parseYouTubeMusicInput,
} from './youtubeMusic';

export type BgmSourceId = 'builtin' | 'youtube';

export interface BgmSnapshot {
  /** The one source allowed to make sound right now. */
  source: BgmSourceId;
  muted: boolean;
  volume: number;
  builtinMood: AmbientMoodId;
  /** True while the generative synth is the audible source. */
  builtinAudible: boolean;
  /** True while the YouTube player is the audible source (whatever its transport state). */
  youtubeAudible: boolean;
}

/* ------------------------------------------------------------------ *
 * State
 * ------------------------------------------------------------------ */

interface Desired {
  source: BgmSourceId;
  muted: boolean;
  volume: number;
  builtinMood: AmbientMoodId;
}

const desired: Desired = {
  source: 'builtin',
  muted: false,
  volume: 0.5,
  builtinMood: 'island-dawn',
};

/** The last link the user played, kept so a reload can pick it up again. */
let savedRef: YouTubeMusicRef | null = null;
/** Guards the one-shot restore, so re-renders can't re-cue over a live session. */
let restoreDone = false;
/**
 * True when the pause currently in effect was OURS (the app was muted), not the
 * user's. Muting has to pause YouTube - a stream turned down to zero is still a
 * stream being fetched - but that pause then has to be undone on unmute, or the
 * mute button becomes a one-way trip to silence. A user's own pause carries no
 * such promise, which is why the two cannot be told apart by state alone.
 */
let pausedByMute = false;
let gestureArmed = false;
let gestureHandler: (() => void) | null = null;
let subscribedToYtm = false;

const listeners = new Set<() => void>();
let snapshot: BgmSnapshot = {
  source: 'builtin',
  muted: false,
  volume: 0.5,
  builtinMood: 'island-dawn',
  builtinAudible: false,
  youtubeAudible: false,
};

export function subscribeBgm(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function getBgmSnapshot(): BgmSnapshot {
  return snapshot;
}

function publish(builtinAudible: boolean, youtubeAudible: boolean): void {
  const next: BgmSnapshot = {
    source: desired.source,
    muted: desired.muted,
    volume: desired.volume,
    builtinMood: desired.builtinMood,
    builtinAudible,
    youtubeAudible,
  };
  const same =
    next.source === snapshot.source &&
    next.muted === snapshot.muted &&
    next.volume === snapshot.volume &&
    next.builtinMood === snapshot.builtinMood &&
    next.builtinAudible === snapshot.builtinAudible &&
    next.youtubeAudible === snapshot.youtubeAudible;
  if (same) return; // identity matters: useSyncExternalStore compares by reference
  snapshot = next;
  listeners.forEach((l) => l());
}

/* ------------------------------------------------------------------ *
 * Reconciliation - the only place either engine is touched
 * ------------------------------------------------------------------ */

let reconciling = false;
let reconcileDirty = false;

/**
 * Bring the world in line with `desired`.
 *
 * Re-entrant by nature: it commands the player, the player emits, and this is
 * subscribed to those emissions. Rather than interleave (which would let a
 * nested pass act on fresh state and then have the outer pass finish on stale
 * state - the classic way a "cued" flag gets armed and immediately disarmed),
 * a nested call just marks the work dirty and the outermost one loops until
 * nothing changes. Every pass therefore reads a consistent snapshot.
 */
function reconcile(): void {
  if (reconciling) {
    reconcileDirty = true;
    return;
  }
  reconciling = true;
  try {
    do {
      reconcileDirty = false;
      reconcileOnce();
    } while (reconcileDirty);
  } finally {
    reconciling = false;
  }
}

/**
 * Whether the music must make NO sound at all.
 *
 * Mute is the obvious half. The other half is a volume slider dragged to zero, which used to
 * be treated as "playing, just at zero": the generative engine kept its whole scheduler,
 * oscillators and reverb running, and YouTube kept streaming, for a player whose settings said
 * silence. Nothing was audible from the synth — its master fades on a linear ramp that really
 * does reach 0 — but "we happen to get away with it" is not the same as being off, and it is
 * exactly the state in which a stray gain ramp becomes a mystery hum. Zero means off.
 *
 * The epsilon is because the slider's step is 0.01 and a float round-trip through the settings
 * store should not be able to leave 0 sitting at 1e-17 above it.
 */
const isSilenced = (): boolean => desired.muted || desired.volume <= 0.001;

function reconcileOnce(): void {
  const yt = getYtmSnapshot();
  const silenced = isSilenced();

  // --- YouTube ------------------------------------------------------------
  const wantYouTube = desired.source === 'youtube';

  if (wantYouTube) {
    // Kept alive from the moment YouTube is the chosen source, so the next
    // command lands on a ready player inside the click that issued it.
    ensureYtmPlayer();
    setYtmVolume(silenced ? 0 : desired.volume);

    // Being silenced pauses YouTube rather than turning it down: a silent stream
    // is still a stream, and still costs the player bandwidth. Coming back has to
    // put back exactly what that took away.
    //
    // The states are named by what must NOT be disturbed rather than by what must be stopped,
    // which is the direction that fails safe. Listing the two states worth pausing ('playing',
    // 'loading') meant every state nobody thought of - buffering, a playlist advance, the gap
    // after a track ends - was a state in which a muted game was left playing, and the player
    // moves through those constantly without the app being asked. A pause the user made
    // themselves, a player that never started, and a video that will not embed are the only
    // things here that are already silent.
    const alreadySilent = yt.status === 'paused' || yt.status === 'cued' || yt.status === 'error';
    if (silenced && yt.hasQueue && !alreadySilent) {
      pausedByMute = true;
      pauseYtm();
    } else if (!silenced && pausedByMute && yt.hasQueue && yt.status === 'paused') {
      pausedByMute = false;
      playYtm();
    }

    // Nothing queued but a link on file - the reload case. Cue rather than play:
    // a fresh page has no user gesture, so a play here is either blocked or
    // silently demoted to muted playback, which is worse than not starting.
    if (!yt.hasQueue && savedRef && !restoreDone) {
      restoreDone = true;
      cueYtm(savedRef);
    }
  } else {
    // Switching away silences YouTube immediately - this is the half that used
    // to be missing whenever the switch happened anywhere but the 停止 button.
    //
    // The volume goes to zero even with nothing queued, because `desiredVolume` is what
    // lib/youtubeMusic.ts reads to decide whether it may start something by itself (a finished
    // track, a dropped play). Leaving it at the music volume while YouTube is not the source
    // means a player that ends a song months-deep in a playlist can restart it under a mode the
    // app has left - so the one number that says "YouTube may be audible" is kept honest here.
    setYtmVolume(0);
    if (yt.hasQueue && yt.status !== 'paused' && yt.status !== 'cued' && yt.status !== 'error') {
      pauseYtm();
    }
  }

  // --- Who holds the floor ------------------------------------------------
  //
  // "YouTube is the source" and "YouTube can actually produce sound" are two
  // different questions, and conflating them is what produced BOTH of the old
  // failures - two tracks at once in one direction, dead silence in the other.
  //
  // What does NOT cost YouTube the floor: buffering, a playlist advance, or a
  // pause the user asked for. Those are all normal states of a session that is
  // running, and treating a buffering blip as "YouTube stopped" is exactly what
  // used to let the synth start up underneath it. A pause is meant to be silent.
  //
  // What DOES: the three states in which this source cannot make a sound at all,
  // where holding the floor would just mute the island -
  //   - no queue at all (YouTube mode on, nothing chosen yet),
  //   - `cued`, i.e. loaded but never started - the post-reload state, which
  //     waits on a user gesture that may be several minutes away,
  //   - `error`, a video that refuses to embed.
  // In all three the built-in BGM takes over, and hands back the moment YouTube
  // actually starts. The user stays in YouTube mode throughout and still sees
  // the error, if there is one.
  const youtubeHoldsTheFloor =
    wantYouTube && yt.hasQueue && yt.status !== 'cued' && yt.status !== 'error';

  const builtinAudible = !silenced && !youtubeHoldsTheFloor;

  if (builtinAudible) {
    // Idempotent for an unchanged mood - it just re-ramps the volume, which is
    // also how live slider changes are applied without restarting the piece.
    startAmbientMusic(desired.builtinMood, desired.volume);
  } else {
    stopAmbientMusic();
  }

  // `cued` is the one state a user gesture can move on from, so it is exactly
  // when the listener should be up - and never otherwise, or a pause the user
  // asked for would undo itself on their next click.
  if (wantYouTube && !silenced && yt.status === 'cued') armGestureResume();
  else disarmGestureResume();

  publish(builtinAudible, youtubeHoldsTheFloor && !silenced);
}

/**
 * Try to start a cued session on user interaction.
 *
 * Not a retry loop and not a timer: it is the browser's autoplay rule, which
 * only a genuine gesture can satisfy, so a gesture is precisely what this waits
 * for. The built-in synth does the same thing with its AudioContext (see
 * primeSynthAudio); the difference is that this one has to stay armed across
 * several gestures, because a cross-origin iframe does not always inherit the
 * activation from the first one. It comes down the moment the status leaves
 * `cued` - which reconcile checks on every player event, success or not.
 */
function armGestureResume(): void {
  if (gestureArmed || typeof window === 'undefined') return;
  gestureArmed = true;
  gestureHandler = () => {
    if (desired.source === 'youtube' && !desired.muted) {
      const yt = getYtmSnapshot();
      if (yt.hasQueue && yt.status === 'cued') playYtm();
    }
  };
  window.addEventListener('pointerdown', gestureHandler);
  window.addEventListener('keydown', gestureHandler);
}

function disarmGestureResume(): void {
  if (!gestureArmed || !gestureHandler) return;
  window.removeEventListener('pointerdown', gestureHandler);
  window.removeEventListener('keydown', gestureHandler);
  gestureHandler = null;
  gestureArmed = false;
}

/** Mirror the player's own state changes back into the manager exactly once. */
function ensureYtmSubscription(): void {
  if (subscribedToYtm) return;
  subscribedToYtm = true;
  subscribeYtm(reconcile);
}

/* ------------------------------------------------------------------ *
 * Public API
 * ------------------------------------------------------------------ */

export interface BackgroundMusicConfig {
  source?: BgmSourceId;
  muted?: boolean;
  volume?: number;
  builtinMood?: AmbientMoodId;
  /** The persisted YouTube link, verbatim, for restoring a session after reload. */
  savedYouTubeLink?: string | null;
}

/**
 * Push the app's persisted settings in. Declarative and idempotent: call it on
 * every settings change and let reconcile() work out what has to start or stop.
 *
 * This is the bridge from React state to audio, and deliberately the ONLY one -
 * see MusicPlayer.tsx, which is now nothing but this call.
 */
export function configureBackgroundMusic(config: BackgroundMusicConfig): void {
  ensureYtmSubscription();

  if (config.savedYouTubeLink !== undefined) {
    const parsed = config.savedYouTubeLink
      ? parseYouTubeMusicInput(config.savedYouTubeLink)
      : null;
    savedRef = parsed;
    if (!parsed) restoreDone = true; // nothing to restore; don't hold the flag open
  }

  if (config.source !== undefined && config.source !== desired.source) {
    desired.source = config.source;
    // Leaving YouTube mode entirely clears the queue, so coming back is a fresh
    // start rather than a resume of something the user switched away from.
    if (config.source === 'builtin') {
      stopYtm();
      restoreDone = false;
    }
  }
  if (config.muted !== undefined) desired.muted = config.muted;
  if (config.volume !== undefined) desired.volume = config.volume;
  if (config.builtinMood !== undefined) desired.builtinMood = config.builtinMood;

  reconcile();
}

/**
 * Play a YouTube link NOW, from a user gesture.
 *
 * Switching the source and issuing the load happen synchronously here, in the
 * click, for two reasons: the browser only lets sound start from inside a
 * gesture, and the built-in BGM must be gone before YouTube makes its first
 * sound rather than a settings round-trip later.
 */
export function playYouTubeMusic(ref: YouTubeMusicRef): void {
  ensureYtmSubscription();
  savedRef = ref;
  restoreDone = true; // this IS the session; nothing to restore over it
  pausedByMute = false;
  desired.source = 'youtube';
  stopAmbientMusic();
  loadYtm(ref);
  reconcile();
}

/** Turn YouTube mode off and hand the island back to the built-in BGM. */
export function stopYouTubeMusic(): void {
  ensureYtmSubscription();
  desired.source = 'builtin';
  restoreDone = false;
  pausedByMute = false;
  stopYtm();
  reconcile();
}

/**
 * Silence everything without forgetting anything - for signing out, where the
 * music should stop but the user's chosen source and link stay as they were for
 * the next session.
 */
export function suspendBackgroundMusic(): void {
  stopAmbientMusic();
  pauseYtm();
  publish(false, false);
}

/** Play/pause the current source's transport, without changing which source it is. */
export function toggleBackgroundMusicPlayback(): void {
  if (desired.source !== 'youtube') return;
  // Whatever happens next is the user's choice, so the mute-pause promise above
  // is void either way.
  pausedByMute = false;
  const yt = getYtmSnapshot();
  if (yt.status === 'playing') pauseYtm();
  else playYtm();
}

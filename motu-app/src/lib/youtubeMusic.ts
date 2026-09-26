/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Real YouTube / YouTube Music playback, via the official IFrame Player API.
 *
 * Why an iframe and not an API client: YouTube Music has NO public API, and
 * `music.youtube.com` sends X-Frame-Options, so it cannot be embedded or read
 * directly. What IS official and free is the IFrame Player API, which plays any
 * public video or playlist without an API key. YouTube Music shares its IDs with
 * YouTube - the `PL...`/`OLAK5uy_...` in a music.youtube.com playlist link is
 * the same list ID youtube.com uses - so pasting a YT Music link and handing the
 * extracted ID to this player genuinely plays that music. The exceptions are
 * Premium-exclusive tracks and personal uploads, which no embed can reach; those
 * surface as an onError below rather than failing silently.
 *
 * This module owns exactly one player instance for the whole app, INCLUDING the
 * DOM element it lives in, so that music keeps playing while the user moves
 * between views. React reads its state through `subscribe`/`getSnapshot`
 * (useSyncExternalStore) and positions the player with `setYtmSlot`, but never
 * creates, re-parents or destroys it - see "The host element" below for why.
 *
 * This is a TRANSPORT, not a policy layer: it knows how to play what it is told
 * to play, and nothing about the built-in synth BGM or about which source the
 * app currently wants. That decision lives in one place, lib/backgroundMusic.ts,
 * which is the only module that should be driving the functions below.
 */

export interface YouTubeMusicRef {
  videoId?: string;
  playlistId?: string;
}

/**
 * `cued` is its own state rather than a flavour of `paused`: it means "loaded on
 * purpose without starting", which is what a restore-after-reload does (there is
 * no user gesture on a fresh page, so starting there would be blocked by the
 * browser). The manager waits for the first gesture and then plays it.
 */
export type YtmStatus = 'idle' | 'loading' | 'cued' | 'playing' | 'paused' | 'ended' | 'error';

export interface YtmSnapshot {
  /** The IFrame API script has loaded and the player object exists. */
  ready: boolean;
  status: YtmStatus;
  /** Video title reported by the player, '' until it starts loading one. */
  title: string;
  author: string;
  videoId: string | null;
  playlistId: string | null;
  /** Human-readable failure, already localised. Null when fine. */
  error: string | null;
  /** True once something has been loaded - drives whether the mini bar shows. */
  hasQueue: boolean;
  /** True when the queue is a playlist, so prev/next are meaningful. */
  isPlaylist: boolean;
  /**
   * The PLAYER's own mute flag, which is independent of both the app's mute
   * setting and of `playerVolume`. Surfaced because a muted player is the one
   * failure that looks like success: the video plays, the picture moves, and
   * nothing anywhere reports an error - there is just no sound.
   */
  playerMuted: boolean;
  /** The player's own 0-100 volume, as read back from YouTube (not what we requested). */
  playerVolume: number;
}

/**
 * A YouTube video ID is exactly 11 chars of [A-Za-z0-9_-]. Anchored so that a
 * pasted URL never matches this branch by accident - URLs go through the parser.
 */
const VIDEO_ID_RE = /^[A-Za-z0-9_-]{11}$/;

/**
 * Playlist IDs YouTube actually issues: user/created lists (PL, FL), album
 * "release" lists that YT Music links use (OLAK5uy_), auto-generated channel
 * lists (UU, LL), and radio/mix lists (RD). RD mixes are accepted because the
 * link is valid, but they very often refuse to embed - the error path below
 * explains that rather than leaving the user staring at a dead player.
 */
const PLAYLIST_ID_RE = /^(PL|FL|UU|LL|RD|OLAK5uy_)[A-Za-z0-9_-]+$/;

/**
 * Pull the video and/or playlist ID out of anything a user is likely to paste:
 * a YouTube Music link, a normal YouTube link, a youtu.be share link, a Shorts
 * link, or a bare ID. Returns null when nothing usable is in there.
 */
export function parseYouTubeMusicInput(raw: string): YouTubeMusicRef | null {
  const input = raw.trim();
  if (!input) return null;

  // Bare IDs, before any URL parsing - these are not URLs at all.
  if (VIDEO_ID_RE.test(input)) return { videoId: input };
  if (PLAYLIST_ID_RE.test(input)) return { playlistId: input };

  let url: URL;
  try {
    // Accept links pasted without a scheme ("music.youtube.com/..."), which is
    // what you get from some share sheets and from retyping a link by hand.
    url = new URL(/^https?:\/\//i.test(input) ? input : `https://${input}`);
  } catch {
    return null;
  }

  const host = url.hostname.replace(/^www\./, '').toLowerCase();
  const isYouTubeHost =
    host === 'youtube.com' ||
    host === 'm.youtube.com' ||
    host === 'music.youtube.com' ||
    host === 'youtube-nocookie.com' ||
    host === 'youtu.be';
  if (!isYouTubeHost) return null;

  const ref: YouTubeMusicRef = {};

  const list = url.searchParams.get('list');
  if (list && PLAYLIST_ID_RE.test(list)) ref.playlistId = list;

  if (host === 'youtu.be') {
    // youtu.be/<id>
    const id = url.pathname.slice(1).split('/')[0];
    if (VIDEO_ID_RE.test(id)) ref.videoId = id;
  } else {
    const v = url.searchParams.get('v');
    if (v && VIDEO_ID_RE.test(v)) {
      ref.videoId = v;
    } else {
      // /shorts/<id>, /embed/<id>, /live/<id>
      const m = url.pathname.match(/^\/(?:shorts|embed|live|v)\/([A-Za-z0-9_-]{11})/);
      if (m) ref.videoId = m[1];
    }
  }

  if (!ref.videoId && !ref.playlistId) return null;
  return ref;
}

/**
 * True when the input looks like something `parseYouTubeMusicInput` can resolve
 * - i.e. a link or a bare ID rather than a song name.
 *
 * Used to decide whether pressing 播放 should search or play directly, so one box
 * serves both. Kept as its own predicate (instead of just null-checking the
 * parser) because "this is a link that I could not parse" and "this is a song
 * title" need different handling: the first is a broken link worth an error, the
 * second is a perfectly normal search.
 */
export function looksLikeYouTubeRef(raw: string): boolean {
  const input = raw.trim();
  if (!input) return false;
  if (VIDEO_ID_RE.test(input) || PLAYLIST_ID_RE.test(input)) return true;
  return /^(https?:\/\/)?(www\.|m\.|music\.)?(youtube(-nocookie)?\.com|youtu\.be)\//i.test(input);
}

export interface YouTubeSearchResult {
  videoId: string;
  title: string;
  channel: string;
  thumbnail: string;
}

/**
 * Search YouTube by song name, through this app's own server.
 *
 * The request cannot go straight to the Data API from here: it needs an API key,
 * and a key in the browser bundle is a key anyone can take. See the
 * /api/youtube/search route in server.ts for the rest of the reasoning (and for
 * why the results are pre-filtered to embeddable videos).
 */
export async function searchYouTubeMusic(query: string): Promise<YouTubeSearchResult[]> {
  const res = await fetch(`/api/youtube/search?q=${encodeURIComponent(query.trim())}`);
  let payload: any = null;
  try {
    payload = await res.json();
  } catch {
    // A non-JSON body here means the dev server isn't running the API route at
    // all (e.g. the static build opened directly), which needs a clearer message
    // than "Unexpected token <".
    throw new Error('搜尋服務沒有回應,請確認伺服器是否啟動 (npm run dev)。');
  }
  if (!res.ok) throw new Error(payload?.error || 'YouTube 搜尋失敗。');
  return (payload?.results ?? []) as YouTubeSearchResult[];
}

/** A stable, human-readable label for a parsed reference (used before the player reports a title). */
export function describeRef(ref: YouTubeMusicRef): string {
  if (ref.playlistId) return `播放清單 ${ref.playlistId.slice(0, 12)}…`;
  return `影片 ${ref.videoId}`;
}

/* ------------------------------------------------------------------ *
 * IFrame API loading
 * ------------------------------------------------------------------ */

declare global {
  interface Window {
    YT?: any;
    onYouTubeIframeAPIReady?: () => void;
  }
}

const IFRAME_API_SRC = 'https://www.youtube.com/iframe_api';
let apiPromise: Promise<any> | null = null;

function loadIframeApi(): Promise<any> {
  if (apiPromise) return apiPromise;

  apiPromise = new Promise((resolve, reject) => {
    if (window.YT?.Player) {
      resolve(window.YT);
      return;
    }

    // Network blocks (offline, extension, corporate filter) never fire the hook
    // at all, so without this the UI would sit on "loading" forever. Cleared on
    // both settle paths: a live 15s timer that outlives a successful load keeps
    // the whole promise chain (and this closure) alive for no reason, and on a
    // slow connection it used to fire AFTER the script arrived - harmless to the
    // already-resolved promise, but it left `apiPromise` nulled out in the catch
    // below, so the next caller re-entered the whole load path from scratch.
    // 25s, not 15: a cold cache on a slow connection genuinely takes that long,
    // and a premature reject surfaced "無法載入 YouTube 播放器" over a script that
    // was still on its way. (It recovers - the next reconcile re-enters this
    // function and finds window.YT already there - but the user has seen an
    // error for something that was not broken.) This is a bound on hanging, not
    // a retry: what it protects against is an ad blocker or a firewall, where
    // the hook never fires at all.
    const timeout = window.setTimeout(() => reject(new Error('iframe_api_timeout')), 25000);

    // The API calls exactly one global hook when it finishes. Chain rather than
    // overwrite, so this stays safe if anything else ever loads the same script.
    const prevHook = window.onYouTubeIframeAPIReady;
    window.onYouTubeIframeAPIReady = () => {
      prevHook?.();
      clearTimeout(timeout);
      resolve(window.YT);
    };

    if (!document.querySelector(`script[src="${IFRAME_API_SRC}"]`)) {
      const script = document.createElement('script');
      script.src = IFRAME_API_SRC;
      script.async = true;
      script.onerror = () => {
        clearTimeout(timeout);
        reject(new Error('iframe_api_blocked'));
      };
      document.head.appendChild(script);
    }
  }).catch((err) => {
    apiPromise = null; // allow a later retry
    throw err;
  });

  return apiPromise;
}

/* ------------------------------------------------------------------ *
 * Controller
 * ------------------------------------------------------------------ */

const listeners = new Set<() => void>();

let snapshot: YtmSnapshot = {
  ready: false,
  status: 'idle',
  title: '',
  author: '',
  videoId: null,
  playlistId: null,
  error: null,
  hasQueue: false,
  isPlaylist: false,
  playerMuted: false,
  playerVolume: 0,
};

function emit(patch: Partial<YtmSnapshot>) {
  // Replaced wholesale (never mutated) because useSyncExternalStore compares
  // snapshots by identity.
  snapshot = { ...snapshot, ...patch };
  listeners.forEach((l) => l());
}

export function subscribeYtm(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function getYtmSnapshot(): YtmSnapshot {
  return snapshot;
}

let player: any = null;
/**
 * Set for the whole of the async creation window (script fetch included), so a
 * second call cannot start building a second player while the first is still in
 * flight. This is not a micro-optimisation: React StrictMode runs every effect
 * twice, and the old `if (player) return` guard tested a variable that is only
 * assigned at the END of that window - so both passes sailed through, appended
 * their own div, and left TWO live iframes fighting over the same music with
 * only the second one reachable from `player`. That is the "it plays, then it
 * breaks" report.
 */
let creating = false;
/** Command to run the moment onReady fires, for anything requested before that. */
let pendingCommand: { ref: YouTubeMusicRef; start: boolean } | null = null;
/**
 * Whether a CUED state should be nudged into playing. False for a deliberate cue
 * (see the `cued` status), true for every ordinary load.
 */
let autoStart = true;
let desiredVolume = 0.5;
let titlePoll: number | null = null;

/**
 * Every call into the YouTube player goes through here.
 *
 * The IFrame API object is a facade over postMessage: its methods only exist
 * once the iframe has handshaked, and they throw (or silently vanish) if the
 * iframe is navigating, blocked, or gone. Calling a method that "obviously"
 * exists is the single most common way this integration used to throw
 * `player.loadVideoById is not a function` up into React and take the screen
 * out with it. One guarded call site means that can no longer happen anywhere.
 */
function call<T = unknown>(method: string, ...args: unknown[]): T | undefined {
  const p = player;
  if (!p || typeof p[method] !== 'function') return undefined;
  try {
    return p[method](...args) as T;
  } catch {
    return undefined;
  }
}

/**
 * Force the player's audio on.
 *
 * `setVolume` alone is NOT enough: the player carries its own mute flag, and a
 * muted player ignores its volume completely. YouTube raises that flag itself
 * when the browser refuses autoplay-with-sound - it falls back to starting
 * MUTED so playback can begin at all. The result looks entirely healthy (the
 * picture moves, no error is reported anywhere) and is silent. Every path that
 * can start playback therefore goes through here.
 *
 * WITH ONE EXCEPTION, and it is the whole point of the exception existing: at `desiredVolume` 0
 * the app has said silence (muted, or the music slider at zero - lib/backgroundMusic.ts's
 * `isSilenced` pushes both here the same way), and lifting the player's mute flag then is how a
 * muted game gets a burst of music out of a player that was about to start anyway. There is
 * exactly one thing to force in that state, which is the volume, downward.
 */
function forceAudioOn(): void {
  if (desiredVolume <= 0) {
    call('setVolume', 0);
    return;
  }
  call('unMute');
  call('setVolume', Math.round(desiredVolume * 100));
}

/* ------------------------------------------------------------------ *
 * The host element
 * ------------------------------------------------------------------ */

/**
 * THE IFRAME IS NOT REACT'S TO OWN.
 *
 * It used to be: the player was created into a div rendered by the Settings
 * panel and destroyed in that component's unmount cleanup. Both halves of that
 * are wrong for something whose entire job is to outlive the screen you started
 * it from:
 *
 *   - closing Settings destroyed the player, which is why the music stopped;
 *   - re-opening it built a NEW player, so every visit paid the load cost again
 *     and raced the previous teardown;
 *   - and an iframe cannot be re-parented as a fix - moving an iframe in the DOM
 *     reloads its document, which stops the music just as dead.
 *
 * So the host is created once, parented to <body>, and never removed. React
 * tells it WHERE to be (`setYtmSlot`) and never anything about whether to exist.
 */

/**
 * Where the player sits when no UI is showing it. Deliberately off-screen rather
 * than `display:none` / `visibility:hidden` / zero-size: a hidden iframe is
 * throttled by the browser and YouTube's API refuses to begin playback in one,
 * whereas an element that is merely outside the viewport keeps playing normally.
 * A negative left (never a bottom/right overflow) so parking can never produce a
 * stray scrollbar.
 */
const PARKED_LEFT = -10000;

let hostEl: HTMLDivElement | null = null;
let slotEl: HTMLElement | null = null;
let placementRaf: number | null = null;

function ensureHost(): HTMLDivElement {
  if (hostEl) return hostEl;
  const el = document.createElement('div');
  el.id = 'ytm-player-host';
  Object.assign(el.style, {
    position: 'fixed',
    left: `${PARKED_LEFT}px`,
    top: '0px',
    width: '320px',
    height: '180px',
    overflow: 'hidden',
    background: '#000',
    // Sits between the Settings surface (z-40, see index.css's layer table) and
    // its own close button (z-50). It is only ever on-screen while Settings is
    // open, which is the one screen that renders a slot for it.
    zIndex: '45',
    pointerEvents: 'none',
  });
  document.body.appendChild(el);
  hostEl = el;
  return el;
}

function parkHost(): void {
  if (!hostEl) return;
  hostEl.style.left = `${PARKED_LEFT}px`;
  hostEl.style.top = '0px';
  hostEl.style.width = '320px';
  hostEl.style.height = '180px';
  hostEl.style.opacity = '1';
  hostEl.style.pointerEvents = 'none';
}

/**
 * The slot's opacity as actually rendered, ancestors included.
 *
 * The host is a child of <body>, so it inherits none of the fades its slot sits
 * inside - and the screen it sits inside animates in and out. Without this, the
 * video stayed fully opaque over a Settings panel that was fading away, then
 * vanished in one frame when the component finally unmounted.
 */
function effectiveOpacity(el: HTMLElement): number {
  let opacity = 1;
  let node: HTMLElement | null = el;
  while (node && node !== document.body) {
    const own = parseFloat(getComputedStyle(node).opacity);
    if (!Number.isNaN(own)) opacity *= own;
    if (opacity <= 0.01) return 0;
    node = node.parentElement;
  }
  return opacity;
}

function applyPlacement(): void {
  if (!hostEl) return;
  const slot = slotEl;
  if (!slot || !slot.isConnected) {
    parkHost();
    return;
  }
  const rect = slot.getBoundingClientRect();
  if (rect.width < 1 || rect.height < 1) {
    parkHost();
    return;
  }
  hostEl.style.left = `${rect.left}px`;
  hostEl.style.top = `${rect.top}px`;
  hostEl.style.width = `${rect.width}px`;
  hostEl.style.height = `${rect.height}px`;
  hostEl.style.borderRadius = getComputedStyle(slot).borderRadius;
  // Never `visibility`/`display` - see PARKED_LEFT. A fully transparent player
  // still plays; a hidden one is suspended.
  hostEl.style.opacity = `${effectiveOpacity(slot)}`;
  hostEl.style.pointerEvents = 'auto';
}

/**
 * Tracked per frame rather than with a ResizeObserver plus scroll/resize
 * listeners, because the slot is inside a scroll container that also runs an
 * entry animation (motion's scale) - none of those events fire during a
 * transform tween, and the alternative is a video that lags a moving panel. One
 * getBoundingClientRect a frame, only while Settings is open, is not a cost
 * worth optimising against that.
 */
function startPlacementLoop(): void {
  if (placementRaf !== null) return;
  const step = () => {
    applyPlacement();
    placementRaf = requestAnimationFrame(step);
  };
  placementRaf = requestAnimationFrame(step);
}

function stopPlacementLoop(): void {
  if (placementRaf !== null) {
    cancelAnimationFrame(placementRaf);
    placementRaf = null;
  }
}

/**
 * Show the player inside `el` (a plain, empty div rendered wherever the UI wants
 * the video to appear), or park it off-screen when passed null.
 *
 * This is the ONLY thing the UI is allowed to say about the player's existence:
 * unmounting the screen that called this stops showing the video, and does not
 * stop the music.
 */
export function setYtmSlot(el: HTMLElement | null): void {
  slotEl = el;
  ensureHost();
  if (el) {
    applyPlacement();
    startPlacementLoop();
  } else {
    stopPlacementLoop();
    parkHost();
  }
}

function errorMessage(code: number): string {
  switch (code) {
    case 2:
      return '這個連結的 ID 無效,請確認後再貼一次。';
    case 5:
      return '這個項目無法在網頁播放器中播放。';
    case 100:
      return '找不到這個影片/清單,可能已被刪除或設為私人。';
    case 101:
    case 150:
      return '這個項目的擁有者不允許嵌入播放。YouTube Music 的「自動混音」與 Premium 專屬曲目通常屬於此類,請改用一般的播放清單連結。';
    default:
      return '播放失敗,請換一個連結試試。';
  }
}

/**
 * Poll the title, because the API has no "metadata changed" event for playlist
 * advances - and poll the player's own mute/volume alongside it, so a silently
 * muted player is visible in the UI instead of having to be guessed at.
 */
function startTitlePoll() {
  if (titlePoll !== null) return;
  titlePoll = window.setInterval(() => {
    const data = call<any>('getVideoData');
    if (data?.title && data.title !== snapshot.title) {
      emit({ title: data.title, author: data.author || '', videoId: data.video_id || snapshot.videoId });
    }
    const muted = !!call<boolean>('isMuted');
    const vol = call<number>('getVolume') ?? 0;
    if (muted !== snapshot.playerMuted || vol !== snapshot.playerVolume) {
      emit({ playerMuted: muted, playerVolume: vol });
    }
  }, 1000);
}

function stopTitlePoll() {
  if (titlePoll !== null) {
    clearInterval(titlePoll);
    titlePoll = null;
  }
}

/**
 * Bring the one player into existence. Idempotent, re-entrant-safe, and cheap to
 * call from anywhere - including on app start, which is the point: a player that
 * already exists can be handed a video INSIDE the click that asked for it, and
 * browsers only allow sound to start from a real user gesture. Creating it on
 * demand instead meant the click had long finished by the time the async chain
 * (fetch iframe_api -> new YT.Player -> onReady -> load) reached playback, and
 * the browser blocked it.
 */
export function ensureYtmPlayer(): void {
  if (player || creating) return;
  creating = true;

  const host = ensureHost();

  loadIframeApi().then(
    (YT: any) => {
      // A destroy/park can't null this out any more, but keep the check: it also
      // covers a second createPlayer that slipped in while the script loaded.
      if (player) {
        creating = false;
        return;
      }

      // YT.Player REPLACES the element it is given with the generated iframe, so
      // give it a throwaway child of our host rather than the host itself - the
      // host must survive to be re-positioned.
      const target = document.createElement('div');
      host.appendChild(target);

      player = new YT.Player(target, {
        height: '100%',
        width: '100%',
        playerVars: {
          autoplay: 0,
          controls: 1,
          playsinline: 1,
          rel: 0,
          modestbranding: 1,
          // Required for the postMessage handshake to be accepted; without it
          // some browsers drop every command silently.
          enablejsapi: 1,
          origin: window.location.origin,
        },
        events: {
          onReady: () => {
            forceAudioOn();
            emit({ ready: true });
            const queued = pendingCommand;
            pendingCommand = null;
            if (queued) applyQueue(queued.ref, queued.start);
          },
          onStateChange: (e: any) => {
            const S = window.YT?.PlayerState;
            if (!S) return;
            switch (e.data) {
              case S.PLAYING: {
                // Playback beginning is the exact moment YouTube's
                // autoplay-fallback mute would be in force, so lift it here too -
                // onReady fires long before this and cannot know.
                forceAudioOn();
                const data = call<any>('getVideoData');
                emit({
                  status: 'playing',
                  error: null,
                  title: data?.title || snapshot.title,
                  author: data?.author || snapshot.author,
                  videoId: data?.video_id || snapshot.videoId,
                });
                startTitlePoll();
                break;
              }
              case S.PAUSED:
                emit({ status: 'paused' });
                break;
              case S.BUFFERING:
                // NOT reported as 'loading' any more. Buffering is a normal blip
                // in the middle of a track (and fires on every playlist advance),
                // and while the built-in BGM was gated on "is YouTube playing
                // right now", every one of those blips let the synth music start
                // up underneath - which is the reported "both play at once".
                // Source ownership is now declared, not inferred from this event.
                break;
              case S.CUED:
                // stopVideo() also parks the player in CUED, so an empty queue
                // here means "we just stopped", not "something is waiting to
                // play" - reporting it as cued would leave a stopped player
                // claiming to be ready to go.
                if (!snapshot.hasQueue) break;
                // The item is ready but nothing started it. That is correct after
                // a deliberate cue (restore-on-reload), and a dropped play
                // otherwise - the state that looks like "the app is broken, there
                // is no sound". Nudge it only in the second case.
                // ...and not while the app is silenced: a dropped play is only worth nudging
                // if the result is meant to be audible. Reported as `cued` instead, which is the
                // honest answer (loaded, not started) and the state the manager already knows how
                // to resume from once the sound comes back.
                if (autoStart && desiredVolume > 0) {
                  forceAudioOn();
                  call('playVideo');
                } else {
                  emit({ status: 'cued' });
                }
                break;
              case S.ENDED:
                // Background music does not stop after one song. A playlist that
                // reaches its end restarts at the top; a single video repeats.
                // (Leaving it ended was also a second way the synth BGM could
                // come back in over a YouTube session that was merely finished.)
                //
                // Unless the app is silenced, and this is the case that made a muted game start
                // playing music by itself: whatever the manager paused at the mute, a track that
                // was ALREADY running kept running until it ended - and then this restarted it,
                // unprompted, minutes into a mute. Report it as paused instead; the manager
                // resumes it on unmute exactly like the one it paused itself.
                if (desiredVolume <= 0) {
                  call('pauseVideo');
                  emit({ status: 'paused' });
                  break;
                }
                if (snapshot.isPlaylist) {
                  call('playVideoAt', 0);
                } else {
                  call('seekTo', 0, true);
                  call('playVideo');
                }
                break;
              default:
                break;
            }
          },
          onError: (e: any) => {
            emit({ status: 'error', error: errorMessage(e?.data) });
            stopTitlePoll();
          },
        },
      });
      creating = false;
    },
    () => {
      creating = false;
      emit({
        status: 'error',
        error: '無法載入 YouTube 播放器,請確認網路連線或廣告封鎖器設定。',
      });
    },
  );
}

/** The actual API calls behind loadYtm/cueYtm, once the player is known ready. */
function applyQueue(ref: YouTubeMusicRef, start: boolean): void {
  autoStart = start;
  forceAudioOn();

  // LOAD, not cue, for the ordinary path.
  //
  // An earlier version cued and then called playVideo() immediately, on the
  // theory that a self-starting load was being muted by the browser. Driving a
  // real Edge over the DevTools protocol disproved that: a player that starts on
  // its own reports muted=false, volume=100. What the cue path DID produce was a
  // player parked in state 5 (cued, never started), because playVideo() issued in
  // the same tick as the cue is dropped before cueing settles. load* starts by
  // itself and needs no such timing.
  if (ref.playlistId) {
    // Playlist wins when a link carries both (a YT Music "watch?v=X&list=Y").
    // Chaining a video load after the playlist to start on X does NOT work - it
    // tears the queue back down to a single video, losing prev/next - and the API
    // offers no way to look up X's index without the list contents. Starting at
    // the top keeps the whole playlist intact, which is the point of the link.
    const args = { list: ref.playlistId, listType: 'playlist', index: 0 };
    call(start ? 'loadPlaylist' : 'cuePlaylist', args);
  } else if (ref.videoId) {
    call(start ? 'loadVideoById' : 'cueVideoById', ref.videoId);
  }

  // Loading resets the player, so the unmute above does not survive it.
  forceAudioOn();
}

function queue(ref: YouTubeMusicRef, start: boolean): void {
  emit({
    status: start ? 'loading' : 'cued',
    error: null,
    hasQueue: true,
    title: '',
    author: '',
    videoId: ref.videoId ?? null,
    playlistId: ref.playlistId ?? null,
    isPlaylist: !!ref.playlistId,
  });

  // Safe from any state: if the player is still being built, the command waits
  // for onReady instead of being fired at a half-built facade and lost.
  ensureYtmPlayer();
  if (!player || !snapshot.ready) {
    pendingCommand = { ref, start };
    autoStart = start;
    return;
  }
  applyQueue(ref, start);
}

/** Queue a video and/or playlist and start it. */
export function loadYtm(ref: YouTubeMusicRef): void {
  queue(ref, true);
}

/**
 * Queue without starting - for restoring the last-played link on a fresh page,
 * where there is no user gesture yet and a play attempt would be blocked (or,
 * worse, silently demoted to muted playback).
 */
export function cueYtm(ref: YouTubeMusicRef): void {
  queue(ref, false);
}

export function playYtm(): void {
  autoStart = true;
  forceAudioOn();
  call('playVideo');
}

/** Manual escape hatch for the UI's "解除靜音" button. */
export function unmuteYtm(): void {
  forceAudioOn();
}

export function pauseYtm(): void {
  autoStart = false;
  call('pauseVideo');
}

export function nextYtm(): void {
  call('nextVideo');
}

export function prevYtm(): void {
  call('previousVideo');
}

/**
 * Stop and clear the queue. The player itself stays alive and stays where it is:
 * it holds no audio once stopped, and keeping it means the next 播放 press starts
 * inside its own click instead of behind another script load.
 */
export function stopYtm(): void {
  autoStart = false;
  pendingCommand = null;
  call('stopVideo');
  stopTitlePoll();
  emit({ status: 'idle', hasQueue: false, title: '', author: '', videoId: null, playlistId: null, error: null });
}

/** volume is 0..1, matching the app's own `bgmVolume`. */
export function setYtmVolume(volume: number): void {
  desiredVolume = Math.max(0, Math.min(1, volume));
  // Raising the slider off zero has to lift the player's own mute as well, or
  // the slider appears to do nothing on a player YouTube muted behind our back.
  if (desiredVolume > 0) forceAudioOn();
  else call('setVolume', 0);
}

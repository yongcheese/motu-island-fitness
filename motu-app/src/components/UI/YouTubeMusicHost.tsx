/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { useEffect, useRef, useSyncExternalStore } from 'react';
import { Play, Pause, SkipBack, SkipForward } from 'lucide-react';
import { useApp } from '../../context/AppContext';
import {
  subscribeYtm, getYtmSnapshot, nextYtm, prevYtm, setYtmSlot, unmuteYtm,
} from '../../lib/youtubeMusic';
import { toggleBackgroundMusicPlayback } from '../../lib/backgroundMusic';

export function useYtm() {
  return useSyncExternalStore(subscribeYtm, getYtmSnapshot, getYtmSnapshot);
}

/**
 * The YouTube player's on-screen window, rendered inside the Settings screen.
 *
 * IT IS A WINDOW, NOT THE PLAYER. The div below is an empty placeholder; the
 * real iframe is owned by lib/youtubeMusic.ts, parented to <body>, and merely
 * positioned over this rectangle for as long as this panel is mounted (see
 * setYtmSlot). Unmounting the panel parks the player off-screen and the music
 * keeps playing - which is the whole point, and the reason this component no
 * longer creates or destroys anything.
 *
 * The video surface is visible rather than hidden while Settings is open:
 * YouTube's Terms require the embedded player to be visible, and a
 * `display:none` host also makes the API refuse to begin playback at all.
 */
export function YouTubeMusicPanel() {
  const { settings } = useApp();
  const slotRef = useRef<HTMLDivElement>(null);
  const ytm = useYtm();

  const bgmVolume = settings?.bgmVolume ?? 0.5;
  const isMuted = settings?.isMuted ?? false;

  // Claim the player for the duration of this panel, and hand it back on the way
  // out. No creation, no teardown, no `mountedRef` bookkeeping: this effect is
  // safe to run twice (React StrictMode does exactly that) because the second
  // run only re-states where the player should be.
  useEffect(() => {
    setYtmSlot(slotRef.current);
    return () => setYtmSlot(null);
  }, []);

  const isPlaying = ytm.status === 'playing';

  return (
    <div className="bg-white rounded-2xl border border-island-line overflow-hidden">
      {/* The player lands here. Kept black so the rectangle reads as a video
          surface in the frame between the panel appearing and the placement
          loop's first frame. */}
      <div className="bg-black w-full aspect-video">
        <div ref={slotRef} className="w-full h-full" />
      </div>

      {/* The two settings that silently produce "no sound", called out where the
          user is looking when it happens rather than left to be discovered. */}
      {isMuted && (
        <div className="text-[10px] font-bold text-amber-700 bg-amber-50 border-t border-amber-200 px-4 py-2">
          背景音樂目前為靜音,YouTube 也會跟著暫停。請先解除上方的靜音。
        </div>
      )}
      {!isMuted && bgmVolume < 0.05 && (
        <div className="text-[10px] font-bold text-amber-700 bg-amber-50 border-t border-amber-200 px-4 py-2">
          背景音樂音量接近 0,YouTube 會沒有聲音。請調高上方的音量滑桿。
        </div>
      )}

      {/* The player muted itself (YouTube's autoplay fallback). We clear this
          automatically on every play path, but if one slips through, this makes
          the cause visible and one click away instead of a silent mystery. */}
      {!isMuted && ytm.playerMuted && (
        <div className="flex items-center justify-between gap-2 text-[10px] font-bold text-amber-700 bg-amber-50 border-t border-amber-200 px-4 py-2">
          <span>YouTube 播放器被瀏覽器設為靜音,所以畫面在動卻沒有聲音。</span>
          <button
            onClick={unmuteYtm}
            className="shrink-0 px-3 py-1.5 rounded-lg bg-amber-600 text-white hover:bg-amber-700 transition-colors active:scale-95"
          >
            解除靜音
          </button>
        </div>
      )}

      {/* Live read-back of what the player itself reports, so "no sound" can be
          diagnosed from the screen rather than guessed at. */}
      {ytm.hasQueue && (
        <div className="text-[9px] font-mono text-island-navy-soft/70 border-t border-island-line px-4 py-1.5">
          狀態 {ytm.status} · 播放器音量 {ytm.playerVolume} · {ytm.playerMuted ? '靜音中' : '未靜音'}
        </div>
      )}

      <div className="flex items-center gap-2 px-4 py-3">
        <div className="flex-1 min-w-0">
          <div className="text-[11px] font-bold text-island-navy truncate">
            {ytm.title || (ytm.status === 'loading' ? '載入中…' : ytm.status === 'cued' ? '已就緒,點一下畫面即可播放' : '尚未選擇音樂')}
          </div>
          {ytm.author && (
            <div className="text-[10px] text-island-navy-soft truncate">{ytm.author}</div>
          )}
        </div>

        <div className="flex items-center gap-1 shrink-0">
          <button
            onClick={prevYtm}
            disabled={!ytm.isPlaylist}
            className="p-1.5 rounded-lg text-island-navy-soft hover:bg-island-line/40 disabled:opacity-30 transition-colors"
            title="上一首"
          >
            <SkipBack size={14} />
          </button>
          <button
            onClick={toggleBackgroundMusicPlayback}
            disabled={!ytm.hasQueue}
            className="w-9 h-9 rounded-xl bg-red-600 text-white flex items-center justify-center hover:bg-red-700 disabled:opacity-30 transition-all active:scale-95"
            title={isPlaying ? '暫停' : '播放'}
          >
            {isPlaying ? <Pause size={16} /> : <Play size={16} />}
          </button>
          <button
            onClick={nextYtm}
            disabled={!ytm.isPlaylist}
            className="p-1.5 rounded-lg text-island-navy-soft hover:bg-island-line/40 disabled:opacity-30 transition-colors"
            title="下一首"
          >
            <SkipForward size={14} />
          </button>
        </div>
      </div>
    </div>
  );
}

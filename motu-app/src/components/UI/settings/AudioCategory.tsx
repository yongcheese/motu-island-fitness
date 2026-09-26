/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { useState } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import {
  Volume2, VolumeX, Waves, Play, Check, Youtube, X, ExternalLink, History,
  AlertCircle, Search, Loader2, Music,
} from 'lucide-react';
import { useApp } from '../../../context/AppContext';
import { BGM_TRACKS } from '../../../constants/bgmTracks';
import { playSound, SoundEffect } from '../../../lib/soundUtils';
import { Slider } from '../DesignKit';
import { useYtm, YouTubeMusicPanel } from '../YouTubeMusicHost';
import {
  parseYouTubeMusicInput, looksLikeYouTubeRef,
  searchYouTubeMusic, YouTubeSearchResult,
} from '../../../lib/youtubeMusic';
// Playback control goes through the manager, never straight at the player: it is
// what guarantees the built-in BGM stops as YouTube starts (and comes back when
// YouTube stops). See lib/backgroundMusic.ts.
import { playYouTubeMusic, stopYouTubeMusic } from '../../../lib/backgroundMusic';
import { SettingsSection } from './SettingsSection';

/**
 * YouTube's Data API returns titles HTML-escaped ("Rock &amp; Roll", "It&#39;s").
 * React escapes on render, so pasting them straight in shows the entities
 * literally; this turns them back into characters WITHOUT going through
 * innerHTML, so a title can never inject markup.
 */
function decodeHtmlEntities(text: string): string {
  return text
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&#(\d+);/g, (_, code) => String.fromCharCode(Number(code)));
}

export function AudioCategory() {
  const { settings, updateSettings } = useApp();
  const [youtubeInput, setYoutubeInput] = useState('');
  const [youtubeError, setYoutubeError] = useState<string | null>(null);
  const [ytSearching, setYtSearching] = useState(false);
  const [ytResults, setYtResults] = useState<YouTubeSearchResult[] | null>(null);
  const ytm = useYtm();
  const isMuted = settings?.isMuted ?? false;

  const toggleSetting = async (key: 'isMuted', currentValue: boolean) => {
    playSound(SoundEffect.CLICK);
    await updateSettings({ [key]: !currentValue });
  };

  /**
   * Play a pasted YouTube / YouTube Music link.
   *
   * This replaced a `setTimeout` that pretended to run an OAuth flow and then
   * only flipped a boolean - nothing ever reached YouTube. There is no OAuth
   * here now because there is nothing to authorise: the IFrame player streams
   * public videos and playlists without an account, and YouTube Music exposes
   * no API to sign into. Turning the feature "on" simply means a real player is
   * mounted and pointed at a real link.
   */
  const handlePlayYoutubeLink = (raw: string) => {
    const ref = parseYouTubeMusicInput(raw);
    if (!ref) {
      setYoutubeError('看不懂這個連結。請貼上 YouTube 或 YouTube Music 的影片/播放清單網址。');
      return;
    }
    playSound(SoundEffect.CLICK);
    setYoutubeError(null);
    setYtResults(null);

    const link = raw.trim();
    const recent = [link, ...(settings?.youtubeRecentLinks ?? []).filter((l) => l !== link)].slice(0, 6);

    // Switch the source and start playing INSIDE this click - browsers only let
    // sound begin from a real gesture, and awaiting the settings write first
    // would put the load outside it. The write below then persists the same
    // decision; the manager is already there.
    playYouTubeMusic(ref);
    // Selecting the local synth tracks turns this off again, so turn it on here.
    updateSettings({ youtubeMusicEnabled: true, youtubePlaylistId: link, youtubeRecentLinks: recent });
    setYoutubeInput('');
  };

  /**
   * One box, two jobs: paste a link and it plays, type a song name and it
   * searches. Which one you meant is decided by looksLikeYouTubeRef rather than
   * by a mode switch the user has to set first - having to know in advance
   * whether you are in "link mode" is exactly the friction this replaces.
   */
  const handleYoutubeSubmit = async (raw: string) => {
    const input = raw.trim();
    if (!input) return;

    if (looksLikeYouTubeRef(input)) {
      handlePlayYoutubeLink(input);
      return;
    }

    playSound(SoundEffect.CLICK);
    setYoutubeError(null);
    setYtSearching(true);
    try {
      const results = await searchYouTubeMusic(input);
      setYtResults(results);
      if (results.length === 0) setYoutubeError(`找不到「${input}」的可播放結果,換個關鍵字試試。`);
    } catch (err) {
      setYtResults(null);
      setYoutubeError(err instanceof Error ? err.message : 'YouTube 搜尋失敗。');
    } finally {
      setYtSearching(false);
    }
  };

  /** Play one of the search hits. Stored as a full watch URL so it round-trips
   *  through the same recent-links list and restore path as a pasted link. */
  const handlePlaySearchResult = (result: YouTubeSearchResult) => {
    playSound(SoundEffect.CLICK);
    const link = `https://www.youtube.com/watch?v=${result.videoId}`;
    const recent = [link, ...(settings?.youtubeRecentLinks ?? []).filter((l) => l !== link)].slice(0, 6);
    playYouTubeMusic({ videoId: result.videoId });
    updateSettings({ youtubeMusicEnabled: true, youtubePlaylistId: link, youtubeRecentLinks: recent });
    setYoutubeError(null);
    setYoutubeInput('');
    setYtResults(null);
  };

  // Drives whether the button says 播放 or 搜尋, so the box tells you what it is
  // about to do before you press it rather than after.
  const isYoutubeLinkInput = looksLikeYouTubeRef(youtubeInput);

  return (
    <div className="w-full flex flex-col gap-6">
      <SettingsSection title="音效控制">
        {/* THE MASTER MUTE, said out loud.
            
            This was a bare speaker icon whose only tell was its background colour — and the
            icon never changed, so "on" and "off" were the same picture in two shades. Worse,
            it did not actually reach the sea: the surf and the swim wash ignored it, so the
            button could read as off while the island kept rolling underneath it. It now
            silences everything and says which everything that is.

            The last thing it did not reach was the sound EFFECTS — footsteps, doors, the pet,
            the garden props, every UI blip — which is what players meant by "按了靜音還是有聲
            音". They go through the same flag now (lib/soundUtils.ts, sfxContext), so the copy
            below can finally say 全部 and mean it. */}
        <button
          onClick={() => toggleSetting('isMuted', isMuted)}
          className={`w-full flex items-center gap-4 p-3 rounded-2xl border transition-all active:scale-[0.99] text-left ${
            isMuted
              ? 'bg-white border-island-line'
              : 'bg-island-teal/10 border-island-teal/25'
          }`}
        >
          <div className={`w-10 h-10 rounded-2xl flex items-center justify-center flex-shrink-0 ${
            isMuted ? 'bg-white border border-island-line text-island-navy-soft' : 'bg-island-teal text-white'
          }`}>
            {isMuted ? <VolumeX size={18} /> : <Volume2 size={18} />}
          </div>
          <div className="flex-1 min-w-0">
            <div className="text-xs font-bold text-island-navy">{isMuted ? '全部靜音中' : '聲音已開啟'}</div>
            <div className="text-[10px] text-island-navy-soft leading-snug">
              {isMuted ? '背景音樂、海浪聲與所有音效都已完全停止' : '點一下可靜音背景音樂、海浪聲與所有音效'}
            </div>
          </div>
        </button>

        {/* Both sliders go dim while muted, so nobody drags one and wonders why nothing
            happens. They stay usable on purpose - setting the level you want BEFORE
            unmuting is a reasonable thing to do. */}
        <div className={`flex flex-col gap-6 transition-opacity ${isMuted ? 'opacity-40' : ''}`}>
          {/* Labelled, because an unlabelled range next to a labelled one reads as the same
              control's second half rather than as the music's own volume. Zero really is off:
              the generative engine stops rather than playing to a muted bus. */}
          <Slider
            icon={<Music size={18} />}
            label="背景音樂"
            value={settings?.bgmVolume ?? 0.5}
            onChange={(v) => updateSettings({ bgmVolume: v })}
          />

          {/* Ambience — its own control, not a sub-setting of the music. The surf is the
              one sound that runs continuously rather than answering an action, so it is
              the one a player may want less of on its own. Takes effect while you drag, even
              standing still on the beach, and at zero the sea is torn down rather than turned
              down — including the swim wash and the splashes (see setAmbienceVolume). */}
          <Slider
            icon={<Waves size={18} />}
            label="海浪環境音"
            value={settings?.ambienceVolume ?? 1}
            onChange={(v) => updateSettings({ ambienceVolume: v })}
          />
        </div>

        <div className="space-y-2">
          <div className="text-[10px] font-black text-island-navy-soft uppercase tracking-widest">挑選音樂</div>
          <div className="grid grid-cols-1 gap-1">
            {BGM_TRACKS.map((track, idx) => (
              <button
                key={track.id}
                onClick={() => { stopYouTubeMusic(); updateSettings({ currentTrackIndex: idx, youtubeMusicEnabled: false }); }}
                className={`flex items-center justify-between p-3 rounded-xl transition-all text-left ${settings?.currentTrackIndex === idx && !settings?.youtubeMusicEnabled ? 'bg-island-teal/10 border border-island-teal/25 translate-x-1' : 'hover:bg-island-line/30 border border-transparent'}`}
              >
                <div className="flex items-center gap-3">
                  <div className={`p-1.5 rounded-lg ${settings?.currentTrackIndex === idx ? 'bg-island-teal text-white' : 'bg-white border border-island-line text-island-navy-soft'}`}>
                    <Play size={10} />
                  </div>
                  <div>
                    <div className="text-xs font-bold">{track.name}</div>
                    <div className="text-[10px] text-island-navy-soft">{track.artist}</div>
                  </div>
                </div>
                {settings?.currentTrackIndex === idx && !settings?.youtubeMusicEnabled && <Check size={12} className="text-island-teal" />}
              </button>
            ))}
          </div>
        </div>
      </SettingsSection>

      {/* Search-or-paste box. This is the whole "connection" - see
          handlePlayYoutubeLink for why there is no OAuth button here. */}
      <SettingsSection
        icon={<Youtube size={20} />}
        title="YouTube Music"
        description="直接搜尋歌名找 MV,或貼上 YouTube / YouTube Music 連結,在島上播放"
      >
        {settings?.youtubeMusicEnabled && (
          <div className="flex justify-end -mt-1 -mb-2">
            <button
              onClick={() => { playSound(SoundEffect.CLICK); stopYouTubeMusic(); updateSettings({ youtubeMusicEnabled: false }); }}
              className="flex items-center gap-2 px-4 py-2 bg-white text-island-navy-soft hover:text-red-600 hover:border-red-200 rounded-2xl border border-island-line transition-all text-[10px] font-black uppercase active:scale-95"
            >
              <X size={12} />
              停止並關閉
            </button>
          </div>
        )}

        <div className="bg-white rounded-2xl p-4 border border-island-line space-y-3">
          <div className="flex flex-col sm:flex-row gap-2">
            <input
              type="text"
              value={youtubeInput}
              onChange={(e) => { setYoutubeInput(e.target.value); setYoutubeError(null); }}
              onKeyDown={(e) => { if (e.key === 'Enter') handleYoutubeSubmit(youtubeInput); }}
              placeholder="輸入歌名或歌手,例如「告白氣球」"
              className="flex-1 min-w-0 bg-island-cream-2 border border-island-line rounded-xl px-4 py-3 font-bold text-xs outline-none focus:ring-2 focus:ring-island-teal-light"
            />
            <button
              onClick={() => handleYoutubeSubmit(youtubeInput)}
              disabled={!youtubeInput.trim() || ytSearching}
              className="flex items-center justify-center gap-2 px-6 py-3 bg-red-600 text-white rounded-xl hover:bg-red-700 transition-all font-black text-xs disabled:opacity-40 shadow-[0_8px_20px_rgba(220,38,38,0.25)] active:scale-95"
            >
              {ytSearching
                ? <Loader2 size={14} className="animate-spin" />
                : (isYoutubeLinkInput ? <Play size={14} /> : <Search size={14} />)}
              {ytSearching ? '搜尋中' : (isYoutubeLinkInput ? '播放' : '搜尋')}
            </button>
          </div>

          {/* Search hits. Thumbnails matter here: picking the right MV out of
              a dozen covers and lyric videos is a visual judgement, and a
              list of titles alone makes you guess. */}
          {ytResults && ytResults.length > 0 && (
            <div className="space-y-1.5 max-h-72 overflow-y-auto -mx-1 px-1">
              {ytResults.map((result) => (
                <button
                  key={result.videoId}
                  onClick={() => handlePlaySearchResult(result)}
                  className="w-full flex items-center gap-3 p-2 rounded-xl border border-island-line bg-island-cream-2/40 hover:border-red-200 hover:bg-red-50/40 transition-colors text-left"
                >
                  {result.thumbnail && (
                    <img
                      src={result.thumbnail}
                      alt=""
                      loading="lazy"
                      className="w-16 h-9 object-cover rounded-lg shrink-0 bg-island-line"
                    />
                  )}
                  <div className="flex-1 min-w-0">
                    {/* Titles arrive HTML-escaped from the Data API (&amp;,
                        &#39;), so they are rendered as text, not markup. */}
                    <div className="text-[11px] font-bold text-island-navy line-clamp-2 leading-snug">
                      {decodeHtmlEntities(result.title)}
                    </div>
                    <div className="text-[10px] text-island-navy-soft truncate">
                      {decodeHtmlEntities(result.channel)}
                    </div>
                  </div>
                  <Play size={12} className="shrink-0 text-red-600" />
                </button>
              ))}
            </div>
          )}

          {youtubeError && (
            <div className="flex items-start gap-2 text-[10px] font-bold text-red-600 leading-snug">
              <AlertCircle size={12} className="shrink-0 mt-0.5" />
              <span>{youtubeError}</span>
            </div>
          )}

          {/* Only failures are reported here - the player panel below shows the
              current title itself, so repeating it would just be noise. */}
          {settings?.youtubeMusicEnabled && ytm.error && (
            <div className="flex items-start gap-2 text-[10px] font-bold text-red-600 bg-red-50 border border-red-200 rounded-xl px-3 py-2 leading-snug">
              <AlertCircle size={12} className="shrink-0 mt-0.5" />
              <span>{ytm.error}</span>
            </div>
          )}

          <a
            href="https://music.youtube.com"
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center gap-1.5 text-[10px] font-black text-island-navy-soft hover:text-red-600 transition-colors"
          >
            <ExternalLink size={11} />
            想放整張專輯或播放清單?去 YouTube Music 複製連結貼回來
          </a>

          <p className="text-[10px] text-island-navy-soft/80 leading-relaxed">
            使用 YouTube 官方嵌入播放器,免登入。搜尋結果已濾掉不允許嵌入的影片;Premium 專屬曲目、個人上傳,以及部分「自動混音」清單仍然無法播放。
            關閉設定後音樂會繼續播放,切換到內建音樂時會自動停止。
          </p>
        </div>

        {/* The player's on-screen window. The player itself lives outside
            React (lib/youtubeMusic.ts) and only moves here while this panel
            is mounted — closing Settings hides the video, not the music. */}
        <YouTubeMusicPanel />

        <AnimatePresence>
          {(settings?.youtubeRecentLinks?.length ?? 0) > 0 && (
            <motion.div
              initial={{ height: 0, opacity: 0 }}
              animate={{ height: 'auto', opacity: 1 }}
              className="bg-white rounded-2xl p-4 border border-island-line"
            >
              <div className="flex items-center gap-1.5 text-[10px] font-black text-island-navy-soft uppercase tracking-widest mb-3">
                <History size={11} />
                最近播放
              </div>
              <div className="grid grid-cols-1 gap-1.5">
                {settings!.youtubeRecentLinks!.map((link) => {
                  const isCurrent = settings?.youtubePlaylistId === link && settings?.youtubeMusicEnabled;
                  return (
                    <button
                      key={link}
                      onClick={() => handlePlayYoutubeLink(link)}
                      className={`flex items-center gap-2 p-3 rounded-xl border transition-colors text-left ${
                        isCurrent ? 'bg-island-teal/10 border-island-teal/25' : 'bg-white border-island-line hover:border-red-200'
                      }`}
                    >
                      <Music size={12} className="text-red-500 shrink-0" />
                      <span className="text-[11px] font-bold text-island-navy truncate flex-1 min-w-0">{link}</span>
                      {isCurrent && <Check size={12} className="text-island-teal shrink-0" />}
                    </button>
                  );
                })}
              </div>
            </motion.div>
          )}
        </AnimatePresence>
      </SettingsSection>
    </div>
  );
}

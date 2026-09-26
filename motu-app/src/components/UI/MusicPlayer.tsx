/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { useEffect } from 'react';
import { useApp } from '../../context/AppContext';
import { BGM_TRACKS } from '../../constants/bgmTracks';
import { primeSynthAudio, setAmbienceMuted, setSfxMuted } from '../../lib/soundUtils';
import { AmbientMoodId } from '../../lib/ambientMusic';
import { configureBackgroundMusic, suspendBackgroundMusic } from '../../lib/backgroundMusic';

const TRACK_MOODS: Record<string, AmbientMoodId> = {
  'track-1': 'island-dawn',
  'track-2': 'seaside-cafe',
  'track-3': 'rainforest',
  'track-4': 'dusk-walk',
  'track-6': 'forest-song',
  'track-7': 'music-box',
  'track-9': 'moonlit-serenade',
};

/**
 * The bridge between React state and the background music system - and nothing
 * else.
 *
 * This component used to BE the music system: it started and stopped the synth
 * engine itself, and decided whether YouTube was allowed to have the floor by
 * watching whether its status happened to read 'playing'. Both jobs moved into
 * lib/backgroundMusic.ts, which is where a source-of-truth for "what is playing"
 * belongs - not in a component, whose state cannot outlive its own mount and
 * cannot be read by the other screens that need it. What is left here is a
 * one-way push of persisted settings into that manager.
 */
export function MusicPlayer() {
  const { settings, isWorkoutActive } = useApp();

  const currentTrackIndex = settings?.currentTrackIndex ?? 0;
  const isMuted = settings?.isMuted ?? false;
  const volume = settings?.bgmVolume ?? 0.5;
  const youtubeMusicEnabled = settings?.youtubeMusicEnabled ?? false;
  const savedLink = settings?.youtubePlaylistId ?? null;

  const builtinMood: AmbientMoodId = isWorkoutActive
    ? (youtubeMusicEnabled ? 'workout-bright' : 'workout-steady')
    : (TRACK_MOODS[BGM_TRACKS[currentTrackIndex]?.id] || 'island-dawn');

  // Declarative and idempotent: describe what the settings say, and let the
  // manager work out what has to start or stop. Volume included - the manager
  // ramps a running mood rather than restarting it, so dragging the slider no
  // longer needs an effect of its own.
  useEffect(() => {
    configureBackgroundMusic({
      source: youtubeMusicEnabled ? 'youtube' : 'builtin',
      builtinMood,
      volume,
      muted: isMuted,
      savedYouTubeLink: savedLink,
    });
  }, [builtinMood, volume, isMuted, youtubeMusicEnabled, savedLink]);

  // The same one-way push, for the sound-effect layer. It lives here because this component is
  // already the single place persisted audio settings become audio behaviour, and because
  // soundUtils is a plain module with no access to React context — the rarity fanfares have to be
  // able to answer "am I muted?" from inside a bare function call. See setSfxMuted's doc for why
  // only they consult it.
  useEffect(() => {
    setSfxMuted(isMuted);
    // ...and the same for the continuous ambience. The surf and the swim wash used to be the
    // one part of the soundscape the mute button could not reach, which is what made the
    // button a lie: the UI said the sound was off and the sea kept rolling underneath it.
    // See THE AMBIENCE GATE in soundUtils for what "off" does to them now.
    setAmbienceMuted(isMuted);
  }, [isMuted]);

  useEffect(() => {
    // AudioContext autoplay policy blocks sound until a real user gesture -
    // resume/create it on the first click or touch anywhere on the page.
    window.addEventListener('click', primeSynthAudio);
    window.addEventListener('touchstart', primeSynthAudio);
    return () => {
      window.removeEventListener('click', primeSynthAudio);
      window.removeEventListener('touchstart', primeSynthAudio);
    };
  }, []);

  // This component only unmounts when the whole game does (sign-out), so this is
  // "stop the music on the way out", not a per-view teardown - the distinction
  // that closing Settings used to get wrong for the YouTube player.
  useEffect(() => {
    return () => suspendBackgroundMusic();
  }, []);

  return null; // Invisible component
}

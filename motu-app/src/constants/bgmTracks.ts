/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

// Track metadata for the Settings music picker. Playback itself is generated
// locally (see src/lib/ambientMusic.ts, keyed by `id`) rather than streamed -
// these used to point at generic soundhelix.com demo loops that had nothing to
// do with the Chinese titles below; now the audio actually is what the title says.
//
// `artist` names the LEAD INSTRUMENT rather than a fictional performer. Every
// track is played on a different one (see the VOICES bank in ambientMusic.ts),
// and that is the thing a player can actually hear the difference between - so
// the picker may as well say it out loud instead of printing the same
// "Island Ambient" on every row and leaving the names to carry the whole job.
//
// `id`s are stable keys into that bank, not positions - the gaps in the
// numbering are removed tracks (track-5 星空冥想, track-8 雨天圓舞曲) and must
// stay as they are.
export interface MusicTrack {
  id: string;
  name: string;
  artist: string;
}

export const BGM_TRACKS: MusicTrack[] = [
  {
    id: 'track-1',
    name: '島嶼晨曦',
    artist: '鋼琴三重奏・刷奏',
  },
  {
    // Renamed from 海浪之聲 when its surf layer was removed (see ambientMusic.ts):
    // the island's own 海浪環境音 owns that sound, and a track that duplicated it
    // was impossible to tell apart from the ambience it was playing over.
    id: 'track-2',
    name: '海邊咖啡',
    artist: '電鋼琴・黑膠雜訊',
  },
  {
    id: 'track-3',
    name: '熱帶雨林',
    artist: '木琴・木魚',
  },
  {
    id: 'track-4',
    name: '黃昏漫步',
    artist: '尼龍吉他',
  },
  {
    id: 'track-6',
    name: '森林晨鳴',
    artist: '木笛・豎琴・鳥鳴',
  },
  {
    id: 'track-7',
    name: '貝殼音樂盒',
    artist: '音樂盒',
  },
  {
    id: 'track-9',
    name: '月光小夜曲',
    artist: '弦樂・豎琴',
  },
];

/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

// Generative background music (Web Audio, no network dependency).
//
// The first version of this file replaced streamed soundhelix.com mp3s with
// locally-generated pads, which fixed the "every track plays the same stock
// rock loop" problem but left a different one: a pad is not a piece of music.
// Three oscillators random-walking through a scale have no pulse, no harmony
// that goes anywhere, and no tune - so every track sounded like the same
// formless wash, and there was nothing for a name like 島嶼晨曦 to actually be.
//
// This version is a small generative *composer* instead of a drone. Every mood
// is built from the same four musical parts, which is what gives the set its
// family resemblance:
//
//   1. A beat grid at a fixed tempo (see the lookahead scheduler below), so the
//      music has a steady pulse you can feel - 規律有節奏.
//   2. A functional chord progression that repeats - I-V-vi-IV, Pachelbel's
//      canon, a minor nocturne cadence - rather than a random walk. This is the
//      古典 element: the harmony resolves instead of wandering.
//   3. A music-box voice (fundamental plus two quiet upper partials, ~4ms
//      attack, long exponential decay) playing a classical accompaniment figure
//      - Alberti bass, broken chords, waltz oom-pah-pah. Soft-edged and in a
//      high register, which is what reads as 可愛 without turning shrill.
//   4. A melodic motif that is generated once and then REPEATED over each turn
//      of the progression, re-voiced to whatever chord is underneath. A tune you
//      recognise coming back around is the difference between "ambience" and
//      "a piece"; re-voicing the same shape over a new chord is a sequence, one
//      of the oldest tricks in the classical book.
//
// Everything runs through a procedurally-generated convolution reverb and is
// spread across the stereo field, which is most of the perceived 質感 - dry
// mono synth notes sound like a ringtone no matter how good the notes are.
//
// `forest-song` additionally carries a nature layer (birdsong, cricket trills).
// The crickets are deliberately locked to the beat grid rather than sprinkled
// randomly: real insect chorus has a pulse, and that pulse is what lets a nature
// track still be a *track*.
//
// --- The 2026-08 咖啡廳 pass ------------------------------------------------
// The version above was musical but SHRILL, and shrill music is unlistenable for
// the hours a player actually leaves it running. Four things caused it, and all
// four are fixed here rather than papered over with a volume cut:
//
//   1. TIMBRE. Every note was a 4ms attack with partials at 2x and 3.02x - a
//      struck-glass ping. The attack is now ~14ms and the upper partials are
//      roughly a third of their old level, so notes bloom instead of clicking.
//      The whole mix then passes a warmth stage (a scoop at the 2.6kHz harshness
//      band into a gentle lowpass) - see `startAmbientMusic`.
//   2. REGISTER. The accompaniment and the tune were stacked in the SAME high
//      octave, so everything fought over the top of the spectrum. The
//      accompaniment now sits an octave lower (mid-register, where a left hand
//      belongs) with the tune above it, and the melody's range is capped an
//      octave lower than it was. The music box keeps its high register - that
//      one is supposed to sparkle - but its tune came down an octave too.
//   3. HARMONY. Plain triads state a fact; maj7/m7/9 voicings leave air in the
//      chord. The bright moods now run the ii-V-I family of turnarounds, which
//      is the single most "cafe" sound there is.
//   4. FEEL. Straight eighths at a fixed grid read as a music box no matter what
//      is played on them. The cafe moods now SWING (see `swingDelay`), so the
//      offbeat leans late the way a person plays it.
//
// One rule that is not about taste: NO built-in track may carry a surf or
// wind-wash layer. The island itself has continuous surf ambience with its own
// volume slider (see 海浪環境音 in SettingsView / setAmbienceVolume), and a music
// track with the same wash underneath is indistinguishable from it - you can't
// tell what the music slider is even doing. Rain (rain-waltz) stays: it is a
// patter, not a swell, and reads as its own thing.

import { getSynthAudioContext } from './soundUtils';
import { sharedSingleton } from './sharedRegistry';

export type AmbientMoodId =
  | 'island-dawn'
  // Renamed from 'ocean-waves' along with its surf layer: keeping the old id for
  // a track that no longer has a wave in it would leave the next reader hunting
  // for a sound that isn't there. The Settings entry moved with it (bgmTracks).
  | 'seaside-cafe'
  | 'rainforest'
  | 'dusk-walk'
  | 'starlight'
  | 'forest-song'
  | 'music-box'
  | 'rain-waltz'
  | 'moonlit-serenade'
  | 'workout-steady'
  | 'workout-bright';

// --- Harmony ---------------------------------------------------------------
// Chords are written as semitone offsets from the mood's tonic, so a single
// progression definition transposes to any key just by changing `rootFreq`.
// Four notes each (root/third/fifth/octave, or a seventh where it adds colour)
// which gives the arpeggios enough tones to make a figure out of.

const I     = [0, 4, 7, 12];
const III   = [4, 7, 11, 16];  // iii - minor mediant
const IV    = [5, 9, 12, 17];
const V     = [7, 11, 14, 19];
const VI    = [9, 12, 16, 21]; // vi  - relative minor
const Isus  = [0, 5, 7, 12];   // Isus4 - unresolved, good for drifting moods

// Sevenths and ninths - the 咖啡廳 vocabulary. A triad is a closed statement; a
// maj7 or m7 leaves a note of air inside the chord, and that air is most of the
// difference between a nursery tune and something you can leave running under a
// conversation for an hour. Same four-note width as the triads above, so every
// accompaniment figure keeps working unchanged.
const Imaj7  = [0, 4, 7, 11];
const IIm7   = [2, 5, 9, 12];
const IIIm7  = [4, 7, 11, 14];
const IVmaj7 = [5, 9, 12, 16];
const V7     = [7, 11, 14, 17];
const VIm7   = [9, 12, 16, 19];

// Minor-key sevenths, for the dusk/nocturne moods. Spelled `Im7`/`IVm7` rather
// than the conventional lowercase `i`/`iv` purely so they can't be shadowed by
// (or mistaken for) the loop counters further down this file.
const Im7      = [0, 3, 7, 10];
const IVm7     = [5, 8, 12, 15];
const bIIImaj7 = [3, 7, 10, 14];
const bVImaj7  = [8, 12, 15, 19];
const bVII7    = [10, 14, 17, 20];

/** Pachelbel's canon. The single most recognisable "this is classical" loop there is. */
const CANON = [I, V, VI, III, IV, I, IV, V];
/** I-V-vi-IV. Bright, resolves cleanly, reads as friendly rather than grand. */
const BRIGHT_LOOP = [I, V, VI, IV];
/**
 * I-vi-ii-V. The jazz turnaround every standard is built on, and the reason a
 * cafe sounds like a cafe: it never quite settles, so it can go round all day.
 */
const CAFE_LOOP = [Imaj7, VIm7, IIm7, V7];
/** ii-V-I-vi. The same circle entered from the other end - slower, more wistful. */
const CAFE_TURN = [IIm7, V7, Imaj7, VIm7];
/** IV-V-iii-vi. The warm, slightly melancholy one; no dominant resolution at all. */
const CAFE_WARM = [IVmaj7, V7, IIIm7, VIm7];

// --- Accompaniment figures -------------------------------------------------
// Indices into the current chord; `null` is a rest. An index past the end of the
// chord wraps to the next octave up (see chordTone), so 4 and 5 continue the
// arpeggio upward instead of restarting it.

// The Alberti bass (low-high-middle-high on running eighths) that used to drive
// 島嶼晨曦 and 黃昏漫步 is gone: it is a *busy* figure, and a note on every eighth
// is what made those two feel like an exercise rather than something playing in
// the background. `CAFE_COMP` below does the same harmonic job with half the
// notes.
/** A music-box cylinder figure: up the chord, back down, never landing hard. */
const MUSIC_BOX_FIGURE = [0, 2, 4, 2, 1, 3, 2, 1];
/** Every other eighth, so the texture breathes between notes. */
const GENTLE = [0, null, 2, null, 1, null, 3, null];
/** Two notes a bar. For the sparse, slow moods where the pad should lead. */
const SPARSE = [0, null, null, null, 2, null, null, null];
/** Rising broken chord - the nocturne left hand. */
const BROKEN = [0, 1, 2, 3, 4, 3, 2, 1];
/** Waltz: rest on the downbeat (the bass takes it), chords on 2 and 3. */
const WALTZ_UPBEATS = [null, 1, 2];
/**
 * The cafe comp. Leaves the downbeat to the bass, answers off the beat, and
 * never plays two notes in a row - a pianist's left hand filling gaps rather
 * than an arpeggiator running. Paired with `swing`, this is the whole feel.
 */
const CAFE_COMP = [null, 1, 2, null, null, 3, 2, null];

// --- Preset shape ----------------------------------------------------------

interface ArpConfig {
  /** Which instrument plays it - see VOICES. */
  voice: VoiceId;
  pattern: (number | null)[];
  /** Notes per beat. 2 = eighths, 1 = quarters. */
  subdiv: number;
  /** Octave multiplier applied to the tonic - 4 puts the music box around C5. */
  octave: number;
  gain: number;
  /** Seconds for the note to decay away. Long = bell-like, short = plucky. */
  decay: number;
}

interface MelodyConfig {
  /** Which instrument plays the tune. Rarely the same one as the comp. */
  voice: VoiceId;
  octave: number;
  gain: number;
  decay: number;
  /** Bars in one statement of the motif before it repeats. */
  motifBars: number;
  /** Chance per repeat of composing a fresh motif instead, so it evolves slowly. */
  rewriteChance: number;
}

/**
 * Percussion. Not a drum kit - one quiet noise-based articulation on a fixed
 * eighth-note grid, which is enough to tell two tracks apart from across a room
 * even when they share a tempo: brushes say "cafe trio", a shaker says
 * "something with a groove", a woodblock says "somewhere warm".
 *
 * `pattern` is one bar of eighths; `null` is a rest.
 */
interface PercConfig {
  kind: 'brush' | 'shaker' | 'wood';
  gain: number;
  pattern: (number | null)[];
}

interface NatureConfig {
  /** Birdsong phrase gain, or 0 for none. Fires around bar lines. */
  birds: number;
  /** Cricket trill gain. Locked to the beat grid - see `cricketEveryBeats`. */
  crickets: number;
  cricketEveryBeats: number;
  // There used to be a `leaves` wind-wash here (brown noise highpassed at 1.4kHz
  // under a 0.06Hz swell). It was removed with the surf layer and for the same
  // reason: a slow noise swell IS a wave sound to the ear, so the forest tracks
  // were competing with the island's own surf ambience instead of being a
  // recognisably different place. The birds and crickets carry the nature on
  // their own, and they carry it *rhythmically*, which the wash never did.
}

interface MoodPreset {
  /** Tonic frequency for the pad register (~130-175Hz sits nicely under everything). */
  rootFreq: number;
  bpm: number;
  beatsPerBar: number;
  progression: number[][];
  /** How many bars each chord is held for. */
  barsPerChord: number;
  pad: { gain: number; waveform: OscillatorType; filterFreq: number } | null;
  /**
   * Beats within the bar (0-indexed) that get a bass note. `upright` swaps the
   * sine sub for a plucked double bass - the cafe tracks want a player, not a
   * subwoofer, and it is audible even at this volume.
   */
  bass: { gain: number; beats: number[]; upright?: boolean } | null;
  arp: ArpConfig | null;
  melody: MelodyConfig | null;
  perc?: PercConfig;
  /** Vinyl surface noise, 0-1. Lo-fi identity for exactly one track. */
  crackle?: number;
  /**
   * How late the offbeat eighth leans, as a fraction of the half-beat: 0 is
   * dead straight, 0.33 is a full triplet shuffle. The cafe moods sit near 0.24
   * - enough that it lilts, not so much that it turns into jazz pastiche. The
   * waltz and the nature track stay straight; a swung waltz is not a waltz.
   */
  swing: number;
  /** Wet/dry send into the reverb. Higher = more space, more distant. */
  reverb: number;
  reverbSeconds: number;
  /** Continuous rainfall gain. Rain is a patter, not a swell - see the header. */
  rain: number;
  /** High twinkle, [min, max] seconds apart. */
  shimmer: [number, number] | null;
  /** Soft low thump on every beat - the workout moods' pulse. */
  pulse: number;
  nature: NatureConfig | null;
}

const MOODS: Record<AmbientMoodId, MoodPreset> = {
  // 島嶼晨曦 - the default, and therefore the one that has to be the easiest to
  // live with: a slow ii-V-I turnaround, swung, with the comp in the middle of
  // the keyboard and the tune sitting quietly above it.
  'island-dawn': {
    rootFreq: 130.81, // C3
    bpm: 72,
    beatsPerBar: 4,
    progression: CAFE_LOOP,
    barsPerChord: 1,
    pad: { gain: 0.05, waveform: 'sine', filterFreq: 900 },
    bass: { gain: 0.095, beats: [0, 2], upright: true },
    arp: { voice: 'felt-piano', pattern: CAFE_COMP, subdiv: 2, octave: 2, gain: 0.075, decay: 2.0 },
    melody: { voice: 'felt-piano', octave: 4, gain: 0.075, decay: 2.8, motifBars: 4, rewriteChance: 0.25 },
    // Brushes on every offbeat: a piano trio playing quietly. Nothing else in
    // the set has brushes, so this one is identifiable in two beats.
    perc: { kind: 'brush', gain: 0.045, pattern: [null, 1, null, 1, null, 1, null, 1] },
    swing: 0.24,
    reverb: 0.32,
    reverbSeconds: 2.6,
    rain: 0,
    shimmer: null,
    pulse: 0,
    nature: null,
  },

  // 海邊咖啡 - was 海浪之聲, a slow tune over a brown-noise surf wash. The wash is
  // gone (it was the island's own ambience by another name), so what's left is
  // what the track always should have been: the slowest, warmest thing in the
  // set. Two beats to the bar of accompaniment, long reverb, ii-V-I.
  'seaside-cafe': {
    rootFreq: 146.83, // D3
    bpm: 62,
    beatsPerBar: 4,
    progression: CAFE_TURN,
    barsPerChord: 1,
    pad: { gain: 0.055, waveform: 'sine', filterFreq: 820 },
    bass: { gain: 0.085, beats: [0], upright: true },
    arp: { voice: 'rhodes', pattern: GENTLE, subdiv: 2, octave: 2, gain: 0.07, decay: 2.6 },
    melody: { voice: 'rhodes', octave: 4, gain: 0.07, decay: 3.2, motifBars: 4, rewriteChance: 0.3 },
    // Electric piano + shaker + vinyl surface noise. This is the lo-fi corner of
    // the set, and the crackle is the tell - you know which track is playing
    // before a single note arrives.
    perc: { kind: 'shaker', gain: 0.035, pattern: [null, 1, null, 1, null, 1, null, 1] },
    crackle: 0.05,
    swing: 0.26,
    reverb: 0.42,
    reverbSeconds: 3.2,
    rain: 0,
    shimmer: null,
    pulse: 0,
    nature: null,
  },

  // 熱帶雨林 - the liveliest of the ambient set: full canon, running eighths.
  // Straight, not swung: the canon is the one piece here that has to stay
  // classical, and Pachelbel does not shuffle.
  rainforest: {
    // F3 rather than D3: the only track in F, and a marimba an extra minor
    // third up is exactly where wooden bars ring best. Key is the cheapest
    // differentiator there is once the instruments already differ.
    rootFreq: 174.61, // F3
    bpm: 80,
    beatsPerBar: 4,
    progression: CANON,
    barsPerChord: 1,
    pad: { gain: 0.042, waveform: 'triangle', filterFreq: 1100 },
    bass: { gain: 0.085, beats: [0, 2] },
    // Marimba, and a woodblock on the bar line. Wood on wood - the tropical
    // track is now the only one in the set made of struck timber, which no
    // listener will confuse with the piano tracks even at the same tempo.
    arp: { voice: 'marimba', pattern: MUSIC_BOX_FIGURE, subdiv: 2, octave: 2, gain: 0.08, decay: 1.0 },
    melody: { voice: 'marimba', octave: 4, gain: 0.085, decay: 1.3, motifBars: 4, rewriteChance: 0.3 },
    perc: { kind: 'wood', gain: 0.035, pattern: [1, null, null, 1, null, null, 1, null] },
    swing: 0,
    reverb: 0.34,
    reverbSeconds: 2.8,
    rain: 0,
    shimmer: [6, 12],
    pulse: 0,
    nature: { birds: 0.4, crickets: 0, cricketEveryBeats: 0 },
  },

  // 黃昏漫步 - unhurried minor, now with m7/maj7 colours and a swung comp: the
  // late-afternoon end of the same cafe.
  'dusk-walk': {
    rootFreq: 138.59, // C#3/Db3
    bpm: 62,
    beatsPerBar: 4,
    progression: [Im7, bVImaj7, bIIImaj7, bVII7, IVm7, Im7, V7, Im7],
    barsPerChord: 1,
    pad: { gain: 0.055, waveform: 'triangle', filterFreq: 820 },
    bass: { gain: 0.095, beats: [0, 2], upright: true },
    // Nylon guitar, pick noise and all. A minor key played on gut strings is the
    // most "evening" sound available and it shares nothing with the two piano
    // tracks it sits between in the list.
    arp: { voice: 'nylon-guitar', pattern: CAFE_COMP, subdiv: 2, octave: 2, gain: 0.07, decay: 1.9 },
    melody: { voice: 'nylon-guitar', octave: 4, gain: 0.08, decay: 2.2, motifBars: 4, rewriteChance: 0.25 },
    swing: 0.22,
    reverb: 0.38,
    reverbSeconds: 3.0,
    rain: 0,
    shimmer: null,
    pulse: 0,
    nature: null,
  },

  // 星空冥想 - the sparsest. Two arp notes a bar, long reverb, lots of silence.
  starlight: {
    rootFreq: 130.81, // C3
    bpm: 50,
    beatsPerBar: 4,
    progression: [Imaj7, IIIm7, IVmaj7, Isus],
    barsPerChord: 2,
    pad: { gain: 0.05, waveform: 'sine', filterFreq: 720 },
    bass: { gain: 0.07, beats: [0] },
    // Bowed glass. The only voice in the bank that fades IN rather than being
    // struck, which - with two notes a bar and a four-second room - makes this
    // the one track nobody will mistake for any other.
    arp: { voice: 'glass-bell', pattern: SPARSE, subdiv: 2, octave: 2, gain: 0.075, decay: 3.4 },
    melody: { voice: 'glass-bell', octave: 4, gain: 0.07, decay: 3.6, motifBars: 8, rewriteChance: 0.4 },
    swing: 0,
    reverb: 0.5,
    reverbSeconds: 4.2,
    rain: 0,
    shimmer: [7, 14],
    pulse: 0,
    nature: null,
  },

  // 森林晨鳴 - the nature track. The music is deliberately thin (no pad melody
  // competing, arp on quarter notes only) so the birds and crickets are the
  // thing you actually listen to, but it still sits on the same beat grid and
  // chord loop as everything else, so it's a piece of music and not a field
  // recording. Crickets land on the beat; birds answer at the bar line.
  'forest-song': {
    rootFreq: 164.81, // E3
    bpm: 72,
    beatsPerBar: 4,
    progression: [Imaj7, V7, VIm7, IVmaj7, Imaj7, V7, IVmaj7, Imaj7],
    barsPerChord: 1,
    pad: { gain: 0.04, waveform: 'sine', filterFreq: 900 },
    bass: { gain: 0.07, beats: [0] },
    // Harp underneath, wooden flute on top. A blown, held tune is the natural
    // partner for birdsong, and it keeps this track distinct from 熱帶雨林 - the
    // other nature-flavoured one - which is all struck wood and no sustain.
    arp: { voice: 'harp', pattern: [0, null, 2, null], subdiv: 1, octave: 2, gain: 0.07, decay: 2.6 },
    melody: { voice: 'flute', octave: 4, gain: 0.05, decay: 2.6, motifBars: 8, rewriteChance: 0.4 },
    swing: 0,
    reverb: 0.44,
    reverbSeconds: 3.4,
    rain: 0,
    shimmer: null,
    pulse: 0,
    nature: { birds: 0.6, crickets: 0.4, cricketEveryBeats: 2 },
  },

  // 貝殼音樂盒 - the most overtly cute-and-classical of the set: the full canon
  // at a brisk tempo, music-box figure in running eighths, pad pulled right back
  // so the box itself is the sound.
  // 貝殼音樂盒 - the one track that is SUPPOSED to sparkle, so it keeps its high
  // accompaniment. What it loses is the tune an octave above that (octave 8 put
  // the melody's top notes past 2kHz, which is where a music box stops being
  // charming and starts being a smoke alarm) - the tune now doubles the box's
  // own register instead of screaming over it.
  'music-box': {
    rootFreq: 130.81, // C3
    bpm: 88,
    beatsPerBar: 4,
    progression: CANON,
    barsPerChord: 1,
    pad: { gain: 0.03, waveform: 'sine', filterFreq: 1000 },
    bass: { gain: 0.08, beats: [0, 2] },
    arp: { voice: 'music-box', pattern: MUSIC_BOX_FIGURE, subdiv: 2, octave: 4, gain: 0.08, decay: 1.8 },
    melody: { voice: 'music-box', octave: 4, gain: 0.07, decay: 2.2, motifBars: 4, rewriteChance: 0.25 },
    swing: 0,
    reverb: 0.34,
    reverbSeconds: 2.2,
    rain: 0,
    shimmer: null,
    pulse: 0,
    nature: null,
  },

  // 雨天圓舞曲 - 3/4. Bass on 1, chords on 2 and 3: literal oom-pah-pah, which
  // is the clearest "regular rhythm" in the whole set, under a rain wash.
  'rain-waltz': {
    rootFreq: 155.56, // Eb3
    bpm: 112, // 3/4 at 112 = 37 bars a minute, an unhurried waltz
    beatsPerBar: 3,
    progression: [Imaj7, Imaj7, IVmaj7, V7, VIm7, IVmaj7, IIm7, V7],
    barsPerChord: 1,
    pad: { gain: 0.042, waveform: 'triangle', filterFreq: 900 },
    bass: { gain: 0.1, beats: [0] },
    // Chords on 2 and 3 in the middle register - a waltz's right hand is the
    // one place a HIGH comp still works, but an octave down it stops chiming.
    arp: { voice: 'harp', pattern: WALTZ_UPBEATS, subdiv: 1, octave: 2, gain: 0.08, decay: 1.3 },
    // Musette accordion on the tune. Two detuned reeds beating against each
    // other, over a plucked oom-pah, in 3/4, in the rain: this is a Paris cafe
    // and it cannot be mistaken for anything else in the list.
    melody: { voice: 'accordion', octave: 4, gain: 0.055, decay: 2.1, motifBars: 4, rewriteChance: 0.3 },
    swing: 0, // a swung waltz is not a waltz
    reverb: 0.36,
    reverbSeconds: 2.6,
    rain: 0.2,
    shimmer: null,
    pulse: 0,
    nature: null,
  },

  // 月光小夜曲 - a slow minor nocturne. Broken-chord left hand, wide reverb.
  'moonlit-serenade': {
    rootFreq: 146.83, // D3
    bpm: 54,
    beatsPerBar: 4,
    progression: [Im7, IVm7, bVImaj7, V7, Im7, bVII7, bIIImaj7, V7],
    barsPerChord: 1,
    pad: { gain: 0.05, waveform: 'triangle', filterFreq: 800 },
    bass: { gain: 0.095, beats: [0] },
    // Harp arpeggios under a bowed string melody - the one track with a real
    // legato line on top, which is what a serenade is.
    arp: { voice: 'harp', pattern: BROKEN, subdiv: 2, octave: 2, gain: 0.07, decay: 2.8 },
    melody: { voice: 'strings', octave: 4, gain: 0.055, decay: 3.2, motifBars: 4, rewriteChance: 0.25 },
    swing: 0,
    reverb: 0.48,
    reverbSeconds: 3.8,
    rain: 0,
    shimmer: [8, 15],
    pulse: 0,
    nature: null,
  },

  // Workout moods aren't in the Settings picker - MusicPlayer swaps to these for
  // the duration of an exercise. Same engine, faster, with a pulse on the beat.
  'workout-steady': {
    rootFreq: 146.83,
    bpm: 104,
    beatsPerBar: 4,
    progression: CAFE_WARM,
    barsPerChord: 1,
    pad: { gain: 0.048, waveform: 'triangle', filterFreq: 1200 },
    bass: { gain: 0.11, beats: [0, 2] },
    arp: { voice: 'synth-pluck', pattern: MUSIC_BOX_FIGURE, subdiv: 2, octave: 2, gain: 0.075, decay: 1.2 },
    melody: { voice: 'synth-pluck', octave: 4, gain: 0.07, decay: 1.6, motifBars: 4, rewriteChance: 0.3 },
    perc: { kind: 'shaker', gain: 0.03, pattern: [null, 1, null, 1, null, 1, null, 1] },
    // Straight, and deliberately so: the beat is what a workout track is FOR,
    // and swing pulls against counting reps.
    swing: 0,
    reverb: 0.24,
    reverbSeconds: 1.8,
    rain: 0,
    shimmer: null,
    pulse: 0.13,
    nature: null,
  },
  'workout-bright': {
    rootFreq: 164.81,
    bpm: 124,
    beatsPerBar: 4,
    progression: BRIGHT_LOOP,
    barsPerChord: 1,
    pad: { gain: 0.048, waveform: 'triangle', filterFreq: 1400 },
    bass: { gain: 0.11, beats: [0, 2] },
    arp: { voice: 'synth-pluck', pattern: BROKEN, subdiv: 2, octave: 2, gain: 0.08, decay: 1.0 },
    melody: { voice: 'synth-pluck', octave: 4, gain: 0.075, decay: 1.4, motifBars: 4, rewriteChance: 0.35 },
    perc: { kind: 'shaker', gain: 0.035, pattern: [null, 1, 1, null, null, 1, 1, null] },
    swing: 0,
    reverb: 0.22,
    reverbSeconds: 1.6,
    rain: 0,
    shimmer: null,
    pulse: 0.14,
    nature: null,
  },
};

// --- Helpers ---------------------------------------------------------------

function clamp(v: number, lo: number, hi: number) {
  return Math.min(hi, Math.max(lo, v));
}

/**
 * Semitone offset of the nth tone of a chord, continuing upward past the end of
 * the voicing instead of wrapping back down - so an arpeggio figure that asks
 * for tone 5 of a 4-note chord climbs into the next octave, which is what makes
 * a broken-chord figure sound like it's going somewhere.
 */
function chordTone(chord: number[], idx: number): number {
  const n = chord.length;
  const oct = Math.floor(idx / n);
  return chord[((idx % n) + n) % n] + oct * 12;
}

function freqOf(rootFreq: number, semitones: number, octaveMul = 1) {
  return rootFreq * octaveMul * Math.pow(2, semitones / 12);
}

/**
 * How late a note sitting on the offbeat should be pushed, in seconds.
 *
 * Only the halfway point of a beat is swung - quarters, dotted figures and the
 * waltz's own 2-and-3 stay exactly where they were written. `offsetInBeats` is
 * the note's position measured from the start of a beat, so this works the same
 * for the accompaniment (sub/subdiv) and for a melody note landing on an `x.5`.
 */
function swingDelay(preset: MoodPreset, offsetInBeats: number, beatDur: number): number {
  if (!preset.swing) return 0;
  const frac = offsetInBeats - Math.floor(offsetInBeats);
  return Math.abs(frac - 0.5) < 0.01 ? preset.swing * beatDur * 0.5 : 0;
}

/** White noise, built once per context and shared - crickets and rain both pull from it. */
let noiseBuffer: AudioBuffer | null = null;
function getNoiseBuffer(ctx: AudioContext): AudioBuffer {
  if (noiseBuffer && noiseBuffer.sampleRate === ctx.sampleRate) return noiseBuffer;
  const len = Math.floor(ctx.sampleRate * 2);
  const buf = ctx.createBuffer(1, len, ctx.sampleRate);
  const data = buf.getChannelData(0);
  for (let i = 0; i < len; i++) data[i] = Math.random() * 2 - 1;
  noiseBuffer = buf;
  return buf;
}

/**
 * A synthetic impulse response: stereo noise under an exponential decay, with
 * the two channels decorrelated so the tail spreads rather than sitting in the
 * middle. This is doing most of the work in making the result sound like an
 * instrument in a room instead of an oscillator in a browser.
 */
function createReverbImpulse(ctx: AudioContext, seconds: number): AudioBuffer {
  const len = Math.max(1, Math.floor(ctx.sampleRate * seconds));
  const impulse = ctx.createBuffer(2, len, ctx.sampleRate);
  for (let ch = 0; ch < 2; ch++) {
    const data = impulse.getChannelData(ch);
    for (let i = 0; i < len; i++) {
      const t = i / len;
      // A short fade-in avoids the "click then room" of a raw noise burst.
      const attack = Math.min(1, t * 90);
      data[i] = (Math.random() * 2 - 1) * attack * Math.pow(1 - t, 2.6);
    }
  }
  return impulse;
}

// --- Instrument voices -----------------------------------------------------

/**
 * THE INSTRUMENT BANK.
 *
 * Every note in every mood used to come out of one struck-key voice, which is
 * why the tracks blurred together: a listener identifies a piece of music by its
 * INSTRUMENT long before they notice its harmony or its tempo. Two tracks in
 * different keys at different speeds still sound like "the same game music" if
 * they are played on the same thing; a marimba and a bowed glass are told apart
 * instantly, even by someone not listening.
 *
 * So each mood now picks a voice for its accompaniment and a (usually different)
 * voice for its tune. Four numbers do most of the identifying:
 *
 *   - ATTACK. 4ms is struck, 250ms is bowed/blown. This alone separates the
 *     plucked half of the bank from the sustained half.
 *   - PARTIALS. Which overtones, at what level, decaying how fast. A marimba's
 *     4th harmonic and a bell's inharmonic 2.76 are each unmistakable.
 *   - TRANSIENT. The noise at the start: a pick scrape, a mallet knock, breath
 *     across a mouthpiece. Cheap to synthesise and enormously identifying.
 *   - SUSTAIN. Whether the note holds before it decays - the difference between
 *     a plucked string and a held breath.
 */
type VoiceId =
  | 'felt-piano'
  | 'rhodes'
  | 'marimba'
  | 'nylon-guitar'
  | 'music-box'
  | 'flute'
  | 'glass-bell'
  | 'harp'
  | 'strings'
  | 'accordion'
  | 'synth-pluck';

interface VoicePreset {
  /** [frequency ratio, gain scale, decay scale]. Ratio 1 is the fundamental. */
  partials: [number, number, number][];
  /** Seconds to full level. The single biggest character cue in the file. */
  attack: number;
  /** Fraction of the note held at full level before it decays. 0 = struck. */
  sustain: number;
  /** Waveform of the fundamental; partials are always sine. */
  wave: OscillatorType;
  /** Cents of detune on a doubled fundamental - chorus, musette. 0 = none. */
  detune: number;
  /** Noise burst at the attack: pick, mallet, breath. */
  transient: { gain: number; freqMul: number; q: number; dur: number } | null;
  /** Vibrato depth in cents. Only the blown/bowed voices use it. */
  vibrato: number;
  vibratoHz: number;
  /** Per-note lowpass, as a multiple of the note's own pitch. */
  toneMul: number;
}

const VOICES: Record<VoiceId, VoicePreset> = {
  // Soft hammer, quiet overtones. The default cafe piano.
  'felt-piano': {
    partials: [[1, 1, 1], [2, 0.17, 0.5], [3.02, 0.035, 0.26]],
    attack: 0.014, sustain: 0, wave: 'sine', detune: 0,
    transient: null, vibrato: 0, vibratoHz: 0, toneMul: 6,
  },
  // Electric piano: a struck tine (the 4th partial, very short) over a chorused
  // fundamental. The chorus is what makes it read as electric rather than as a
  // duller acoustic.
  rhodes: {
    partials: [[1, 1, 1], [2, 0.22, 0.45], [4.01, 0.07, 0.16]],
    attack: 0.012, sustain: 0, wave: 'sine', detune: 8,
    transient: { gain: 0.05, freqMul: 6, q: 4, dur: 0.03 }, vibrato: 0, vibratoHz: 0, toneMul: 5,
  },
  // Wood bar. The 4th harmonic is the marimba's tuning signature, and the decay
  // is short enough that it never blurs into the next note.
  marimba: {
    partials: [[1, 1, 1], [4, 0.28, 0.24], [9.2, 0.05, 0.1]],
    attack: 0.004, sustain: 0, wave: 'sine', detune: 0,
    transient: { gain: 0.07, freqMul: 3, q: 2, dur: 0.02 }, vibrato: 0, vibratoHz: 0, toneMul: 8,
  },
  // Nylon string: a full harmonic series and an audible pick.
  'nylon-guitar': {
    partials: [[1, 1, 1], [2, 0.3, 0.55], [3, 0.16, 0.35], [4, 0.07, 0.2]],
    attack: 0.006, sustain: 0, wave: 'sine', detune: 0,
    transient: { gain: 0.06, freqMul: 5, q: 3, dur: 0.025 }, vibrato: 0, vibratoHz: 0, toneMul: 6,
  },
  // The one voice allowed to chime. Inharmonic 3.02 and 5.4 partials = struck
  // metal comb, which is the whole point of 貝殼音樂盒.
  'music-box': {
    partials: [[1, 1, 1], [2, 0.3, 0.55], [3.02, 0.13, 0.3], [5.4, 0.045, 0.14]],
    attack: 0.006, sustain: 0, wave: 'sine', detune: 0,
    transient: null, vibrato: 0, vibratoHz: 0, toneMul: 8,
  },
  // Blown: almost no overtones, a long breath at the front, and vibrato once the
  // note is running. Sustains, so it sings over an accompaniment instead of
  // decaying with it.
  flute: {
    partials: [[1, 1, 1], [2, 0.06, 1], [3, 0.02, 1]],
    attack: 0.09, sustain: 0.5, wave: 'sine', detune: 0,
    transient: { gain: 0.05, freqMul: 2.5, q: 1.2, dur: 0.12 }, vibrato: 11, vibratoHz: 5.2, toneMul: 4,
  },
  // Bowed glass / wine rim: a very slow swell and an inharmonic 2.76 partial.
  // Nothing else in the bank fades IN, which is what makes 星空冥想 unmistakable.
  'glass-bell': {
    partials: [[1, 1, 1], [2.76, 0.18, 0.5], [5.4, 0.05, 0.22]],
    attack: 0.26, sustain: 0.25, wave: 'sine', detune: 3,
    transient: null, vibrato: 0, vibratoHz: 0, toneMul: 6,
  },
  // Plucked string, no pick noise, long ring. The accompaniment voice for the
  // two most classical moods.
  harp: {
    partials: [[1, 1, 1], [2, 0.22, 0.5], [3, 0.09, 0.28]],
    attack: 0.008, sustain: 0, wave: 'sine', detune: 0,
    transient: { gain: 0.025, freqMul: 4, q: 5, dur: 0.02 }, vibrato: 0, vibratoHz: 0, toneMul: 7,
  },
  // Bowed section: a sawtooth taken right down by its own lowpass, so it keeps
  // the bite of a bow without any of the buzz.
  strings: {
    partials: [[1, 1, 1], [2, 0.12, 1]],
    attack: 0.22, sustain: 0.62, wave: 'sawtooth', detune: 6,
    transient: null, vibrato: 9, vibratoHz: 5.6, toneMul: 2.4,
  },
  // Musette: two reeds deliberately out of tune with each other. That beating IS
  // the accordion - without the detune it is just an organ.
  accordion: {
    partials: [[1, 1, 1], [2, 0.3, 1], [3, 0.1, 1]],
    attack: 0.055, sustain: 0.7, wave: 'sawtooth', detune: 16,
    transient: null, vibrato: 0, vibratoHz: 0, toneMul: 2.8,
  },
  // Workout only: bright and short, so it cuts through a room where someone is
  // moving rather than sitting.
  'synth-pluck': {
    partials: [[1, 1, 1], [2, 0.26, 0.5], [3, 0.1, 0.28]],
    attack: 0.005, sustain: 0, wave: 'triangle', detune: 4,
    transient: null, vibrato: 0, vibratoHz: 0, toneMul: 5,
  },
};

/**
 * Plays one note on one instrument.
 *
 * Everything is per-note (its own oscillators, its own filter, its own vibrato
 * LFO) and everything stops itself - the engine never has to track a voice, and
 * a mood change can tear the graph down without leaving a note hanging. The note
 * counts are small enough for this to be free: even the busiest mood is four
 * notes a beat.
 */
function playVoice(
  ctx: AudioContext,
  dest: AudioNode,
  voiceId: VoiceId,
  freq: number,
  time: number,
  gain: number,
  decay: number,
  pan = 0,
) {
  const v = VOICES[voiceId];

  const out = ctx.createGain();
  out.gain.value = 1;

  // Tone control tracks the note's own pitch, so a low note stays warm and a
  // high one is rolled off - a fixed cutoff would either dull the bass or let
  // the top octave through untouched.
  const tone = ctx.createBiquadFilter();
  tone.type = 'lowpass';
  tone.frequency.value = clamp(freq * v.toneMul, 320, 7000);
  tone.Q.value = 0.5;
  out.connect(tone);

  let node: AudioNode = tone;
  if (typeof ctx.createStereoPanner === 'function' && pan !== 0) {
    const panner = ctx.createStereoPanner();
    panner.pan.value = clamp(pan, -1, 1);
    tone.connect(panner);
    node = panner;
  }
  node.connect(dest);

  const longest = decay;

  let vibDepth: GainNode | null = null;
  if (v.vibrato > 0) {
    const lfo = ctx.createOscillator();
    lfo.frequency.value = v.vibratoHz;
    vibDepth = ctx.createGain();
    vibDepth.gain.value = v.vibrato;
    lfo.connect(vibDepth);
    lfo.start(time);
    lfo.stop(time + longest + 0.2);
  }

  const addOsc = (f: number, wave: OscillatorType, peak: number, dur: number, detuneCents: number) => {
    if (f > ctx.sampleRate / 2) return; // above Nyquist - would alias into noise
    const osc = ctx.createOscillator();
    osc.type = wave;
    osc.frequency.value = f;
    if (detuneCents) osc.detune.value = detuneCents;
    vibDepth?.connect(osc.detune);

    const env = ctx.createGain();
    // Upper partials rise a little later than the fundamental, so the bright
    // part of the note arrives after its body - a hammer on a felt string, not
    // a click.
    const attack = Math.min(v.attack * (f === freq ? 1 : 1.6), dur * 0.6);
    env.gain.setValueAtTime(0, time);
    env.gain.linearRampToValueAtTime(peak, time + attack);
    if (v.sustain > 0) {
      const hold = Math.max(attack + 0.01, Math.min(attack + dur * v.sustain, dur * 0.9));
      env.gain.setValueAtTime(peak, time + hold);
    }
    env.gain.exponentialRampToValueAtTime(0.0001, time + dur);

    osc.connect(env);
    env.connect(out);
    osc.start(time);
    osc.stop(time + dur + 0.05);
  };

  for (const [ratio, gScale, dScale] of v.partials) {
    const f = freq * ratio;
    const dur = decay * dScale;
    addOsc(f, ratio === 1 ? v.wave : 'sine', gain * gScale, dur, 0);
    // The chorused twin only doubles the fundamental; detuning the overtones as
    // well turns a chorus into a mistuned instrument.
    if (ratio === 1 && v.detune > 0) addOsc(f, v.wave, gain * 0.55, dur, v.detune);
  }

  if (v.transient) {
    const src = ctx.createBufferSource();
    src.buffer = getNoiseBuffer(ctx);
    src.loop = true;
    const bp = ctx.createBiquadFilter();
    bp.type = 'bandpass';
    bp.frequency.value = clamp(freq * v.transient.freqMul, 200, 6000);
    bp.Q.value = v.transient.q;
    const env = ctx.createGain();
    env.gain.setValueAtTime(0, time);
    env.gain.linearRampToValueAtTime(gain * v.transient.gain, time + 0.004);
    env.gain.exponentialRampToValueAtTime(0.0001, time + v.transient.dur);
    src.connect(bp);
    bp.connect(env);
    env.connect(out);
    // A random offset into the noise buffer, so successive picks aren't the
    // identical waveform stamped over and over.
    src.start(time, Math.random() * 1.5);
    src.stop(time + v.transient.dur + 0.05);
  }

  return longest;
}

/**
 * One percussion articulation. Noise only - a bandpass and an envelope is all a
 * shaker or a woodblock actually is, and a synthesised drum sample would be far
 * more conspicuous than these are meant to be.
 */
function playPerc(ctx: AudioContext, dest: AudioNode, kind: PercConfig['kind'], time: number, gain: number, pan = 0) {
  const spec = {
    // A wire brush dragged across a head: slow in, slow out, no pitch at all.
    brush: { type: 'bandpass' as BiquadFilterType, freq: 1600, q: 0.7, attack: 0.05, dur: 0.22 },
    // Beads in a shell: fast, bright, tightly closed.
    shaker: { type: 'bandpass' as BiquadFilterType, freq: 3000, q: 1.4, attack: 0.004, dur: 0.06 },
    // Woodblock: narrow enough to have a pitch.
    wood: { type: 'bandpass' as BiquadFilterType, freq: 900, q: 6, attack: 0.002, dur: 0.07 },
  }[kind];

  const src = ctx.createBufferSource();
  src.buffer = getNoiseBuffer(ctx);
  src.loop = true;
  const filter = ctx.createBiquadFilter();
  filter.type = spec.type;
  filter.frequency.value = spec.freq;
  filter.Q.value = spec.q;

  const env = ctx.createGain();
  env.gain.setValueAtTime(0, time);
  env.gain.linearRampToValueAtTime(gain, time + spec.attack);
  env.gain.exponentialRampToValueAtTime(0.0001, time + spec.dur);

  src.connect(filter);
  filter.connect(env);

  let node: AudioNode = env;
  if (typeof ctx.createStereoPanner === 'function' && pan !== 0) {
    const panner = ctx.createStereoPanner();
    panner.pan.value = clamp(pan, -1, 1);
    env.connect(panner);
    node = panner;
  }
  node.connect(dest);

  src.start(time, Math.random() * 1.5);
  src.stop(time + spec.dur + 0.05);
}

/**
 * The bass. Two of them, actually:
 *
 *   - the default sine sub, rounded off with a lowpass so it supports without
 *     booming, and
 *   - `upright`: a triangle with a finger-pluck attack and a much shorter ring,
 *     which reads as a person playing a double bass. The cafe moods take this
 *     one; it is the quietest of the differentiators here but it is the one that
 *     makes those tracks feel *played*.
 */
function playBassNote(
  ctx: AudioContext,
  dest: AudioNode,
  freq: number,
  time: number,
  gain: number,
  dur: number,
  upright = false,
) {
  const osc = ctx.createOscillator();
  osc.type = upright ? 'triangle' : 'sine';
  osc.frequency.value = freq;
  const filter = ctx.createBiquadFilter();
  filter.type = 'lowpass';
  filter.frequency.value = upright ? 700 : 420;
  const env = ctx.createGain();
  const length = upright ? dur * 0.55 : dur;
  env.gain.setValueAtTime(0, time);
  env.gain.linearRampToValueAtTime(gain, time + (upright ? 0.012 : 0.03));
  env.gain.exponentialRampToValueAtTime(0.0001, time + length);
  osc.connect(filter);
  filter.connect(env);
  env.connect(dest);
  osc.start(time);
  osc.stop(time + length + 0.05);
}

/** A single soft high twinkle, for the moods that want occasional sparkle. */
function playShimmer(ctx: AudioContext, dest: AudioNode, freq: number, time: number, gain: number) {
  const dur = 0.5 + Math.random() * 0.5;
  const osc = ctx.createOscillator();
  osc.type = 'sine';
  osc.frequency.value = freq;
  const env = ctx.createGain();
  env.gain.setValueAtTime(0, time);
  env.gain.linearRampToValueAtTime(gain, time + 0.05);
  env.gain.exponentialRampToValueAtTime(0.0001, time + dur);
  osc.connect(env);
  env.connect(dest);
  osc.start(time);
  osc.stop(time + dur + 0.05);
}

/** A soft low thump - the workout moods' gentle pulse, not a literal drum. */
function playPulseThump(ctx: AudioContext, dest: AudioNode, time: number, gain: number) {
  const osc = ctx.createOscillator();
  osc.type = 'sine';
  osc.frequency.setValueAtTime(140, time);
  osc.frequency.exponentialRampToValueAtTime(80, time + 0.14);
  const env = ctx.createGain();
  env.gain.setValueAtTime(gain, time);
  env.gain.exponentialRampToValueAtTime(0.0001, time + 0.16);
  osc.connect(env);
  env.connect(dest);
  osc.start(time);
  osc.stop(time + 0.18);
}

// --- Nature voices ---------------------------------------------------------

/**
 * A short birdsong phrase: two to four chirps, each a fast frequency sweep, with
 * a rest-free rhythm inside the phrase and a random gap after it.
 *
 * The base pitch is derived from the chord currently playing rather than picked
 * at random. Real birdsong isn't in any key, but a bird that keeps landing on
 * notes outside the harmony reads as a wrong note rather than as a bird, so the
 * chirps are tuned into the music - the listener hears a bird, and the track
 * stays consonant.
 */
function playBirdPhrase(ctx: AudioContext, dest: AudioNode, baseFreq: number, time: number, gain: number) {
  const chirpCount = 2 + Math.floor(Math.random() * 3);
  // Sweeping up sounds inquisitive, down sounds like a call-off; alternating
  // between phrases is what stops the same bird looping forever.
  const risingPhrase = Math.random() < 0.65;
  let t = time;

  for (let c = 0; c < chirpCount; c++) {
    const dur = 0.05 + Math.random() * 0.05;
    const f0 = baseFreq * (1 + c * 0.06) * (0.95 + Math.random() * 0.12);
    const f1 = risingPhrase ? f0 * (1.35 + Math.random() * 0.35) : f0 / (1.3 + Math.random() * 0.3);

    const osc = ctx.createOscillator();
    osc.type = 'sine';
    osc.frequency.setValueAtTime(f0, t);
    osc.frequency.exponentialRampToValueAtTime(Math.max(f1, 40), t + dur);

    // A quiet octave above adds the reedy edge that separates a bird from a
    // plain sine bleep. Kept much quieter than it was: this triangle's own
    // harmonics were reaching several kHz on every chirp, which is exactly the
    // band that makes a track tiring to leave on.
    const harm = ctx.createOscillator();
    harm.type = 'triangle';
    harm.frequency.setValueAtTime(f0 * 2, t);
    harm.frequency.exponentialRampToValueAtTime(Math.max(f1 * 2, 40), t + dur);
    const harmGain = ctx.createGain();
    harmGain.gain.value = 0.09;

    const env = ctx.createGain();
    env.gain.setValueAtTime(0, t);
    // 8ms was a chirp with a click on the front of it; 18ms is still a chirp.
    env.gain.linearRampToValueAtTime(gain, t + 0.018);
    env.gain.exponentialRampToValueAtTime(0.0001, t + dur);

    osc.connect(env);
    harm.connect(harmGain);
    harmGain.connect(env);

    let node: AudioNode = env;
    if (typeof ctx.createStereoPanner === 'function') {
      const panner = ctx.createStereoPanner();
      // Each phrase comes from one spot, so successive calls sound like
      // different birds in different trees rather than one bird in your head.
      panner.pan.value = clamp((Math.random() * 2 - 1) * 0.7, -1, 1);
      env.connect(panner);
      node = panner;
    }
    node.connect(dest);

    osc.start(t);
    osc.stop(t + dur + 0.02);
    harm.start(t);
    harm.stop(t + dur + 0.02);

    t += dur + 0.03 + Math.random() * 0.05;
  }
}

/**
 * A cricket trill: narrow bandpass noise around ~4.5kHz, chopped into a burst of
 * short pulses. That gating IS the sound - a cricket is a rasp, not a tone, and
 * the pulse rate is what your ear reads as "insect" rather than "static".
 */
function playCricketTrill(ctx: AudioContext, dest: AudioNode, time: number, gain: number) {
  const pulses = 4 + Math.floor(Math.random() * 4);
  const pulseGap = 0.028 + Math.random() * 0.012;
  const pulseLen = pulseGap * 0.55;
  // Real crickets sit around 4-5kHz, but 4-5kHz is also the exact band the human
  // ear is most sensitive to and the first thing that turns a long-running track
  // shrill. Dropped an octave they still read as insects (the PULSE RATE is what
  // your ear identifies, not the pitch) and stop drilling.
  const centre = 2400 + Math.random() * 900;
  const total = pulses * pulseGap + 0.05;

  const src = ctx.createBufferSource();
  src.buffer = getNoiseBuffer(ctx);
  src.loop = true;

  const band = ctx.createBiquadFilter();
  band.type = 'bandpass';
  band.frequency.value = centre;
  band.Q.value = 11; // narrow enough to chirp; a wide band just sounds like hiss

  const env = ctx.createGain();
  env.gain.setValueAtTime(0, time);
  for (let p = 0; p < pulses; p++) {
    const t0 = time + p * pulseGap;
    // Ramps rather than steps: a hard gate on noise clicks audibly.
    env.gain.linearRampToValueAtTime(gain, t0 + pulseLen * 0.4);
    env.gain.linearRampToValueAtTime(0, t0 + pulseLen);
  }
  env.gain.setValueAtTime(0, time + total);

  src.connect(band);
  band.connect(env);

  let node: AudioNode = env;
  if (typeof ctx.createStereoPanner === 'function') {
    const panner = ctx.createStereoPanner();
    panner.pan.value = clamp((Math.random() * 2 - 1) * 0.8, -1, 1);
    env.connect(panner);
    node = panner;
  }
  node.connect(dest);

  src.start(time);
  src.stop(time + total + 0.05);
}

// --- Continuous texture layers ---------------------------------------------

interface TextureNodes {
  source: AudioBufferSourceNode;
  gain: GainNode;
  lfo?: OscillatorNode;
}

// There were two more textures here - an ocean surf (brown noise under a 0.08Hz
// swell) and a wind-in-leaves wash (brown noise pushed into the treble under a
// 0.06Hz swell). Both are gone, and neither should come back:
//
// The island ALREADY plays continuous surf as ambience, with its own 海浪環境音
// slider in Settings that is deliberately separate from the music slider (see
// SettingsView / setAmbienceVolume). A music track carrying the same wash is
// indistinguishable from that ambience, so the player cannot tell which slider
// is doing what, and 海浪之聲 in particular sounded like "the island, slightly
// louder" rather than like a piece of music. The leaf wash was the same sound by
// another name: any slow swell of filtered noise is heard as surf.
//
// Rain (below) stays because it is a patter, not a swell - it reads as weather,
// not as the sea.

/**
 * Vinyl surface noise: a loop of sparse, randomly-placed pops rather than a bed
 * of hiss. That distinction matters twice over - a hiss bed would be the wash
 * this file just spent a section banning, and it is the POPS that a listener
 * recognises as a record anyway.
 */
function createCrackleBuffer(ctx: AudioContext, seconds: number): AudioBuffer {
  const len = Math.floor(ctx.sampleRate * seconds);
  const buf = ctx.createBuffer(1, len, ctx.sampleRate);
  const data = buf.getChannelData(0);
  const pops = Math.floor(seconds * 30);
  for (let p = 0; p < pops; p++) {
    const at = Math.floor(Math.random() * (len - 400));
    const amp = 0.2 + Math.random() * 0.8;
    const dur = 30 + Math.floor(Math.random() * 120);
    for (let i = 0; i < dur; i++) {
      data[at + i] += (Math.random() * 2 - 1) * amp * Math.pow(1 - i / dur, 3);
    }
  }
  return buf;
}

function startCrackleTexture(ctx: AudioContext, dest: AudioNode, gain: number, time: number): TextureNodes {
  const source = ctx.createBufferSource();
  // An odd length, so the loop point never lines up with the beat grid and the
  // same pop never lands on the same chord twice.
  source.buffer = createCrackleBuffer(ctx, 4.7);
  source.loop = true;
  const hp = ctx.createBiquadFilter();
  hp.type = 'highpass';
  hp.frequency.value = 900;
  const out = ctx.createGain();
  out.gain.value = gain;
  source.connect(hp);
  hp.connect(out);
  out.connect(dest);
  source.start(time);
  return { source, gain: out };
}

/** Rainfall: white noise rolled off top and bottom into a steady hiss-patter. */
function startRainTexture(ctx: AudioContext, dest: AudioNode, gain: number, time: number): TextureNodes {
  const source = ctx.createBufferSource();
  source.buffer = getNoiseBuffer(ctx);
  source.loop = true;
  const hp = ctx.createBiquadFilter();
  hp.type = 'highpass';
  hp.frequency.value = 700;
  const lp = ctx.createBiquadFilter();
  lp.type = 'lowpass';
  // 5.2kHz was rain with a hiss on top of it. Rolling the top off leaves the
  // patter and loses the sizzle.
  lp.frequency.value = 3400;
  const out = ctx.createGain();
  out.gain.value = gain;

  // A slow wobble stops it reading as flat digital hiss.
  const lfo = ctx.createOscillator();
  lfo.frequency.value = 0.14;
  const lfoDepth = ctx.createGain();
  lfoDepth.gain.value = gain * 0.28;
  lfo.connect(lfoDepth);
  lfoDepth.connect(out.gain);
  lfo.start(time);

  source.connect(hp);
  hp.connect(lp);
  lp.connect(out);
  out.connect(dest);
  source.start(time);
  return { source, gain: out, lfo };
}

// --- The melodic motif -----------------------------------------------------

interface MotifNote {
  /** Position from the start of the motif, in beats. */
  beat: number;
  /** Length in beats - only used to scale the decay, notes ring past it. */
  length: number;
  /** Index into the chord under it at playback time. */
  tone: number;
}

/**
 * Composes one statement of the tune: a rhythm assembled from a handful of
 * classical rhythmic cells, and a contour that mostly steps between neighbouring
 * chord tones with the occasional leap.
 *
 * Note that the notes are stored as chord-tone INDICES, not pitches. The same
 * motif therefore comes out differently over each chord of the progression while
 * keeping its shape - a sequence, and the reason this sounds composed rather
 * than shuffled.
 */
function composeMotif(cfg: MelodyConfig, beatsPerBar: number): MotifNote[] {
  // Cells are note lengths in beats that fill exactly one bar.
  const cells: number[][] = beatsPerBar === 3
    ? [[3], [2, 1], [1, 1, 1], [1, 2], [1.5, 1.5]]
    : [[4], [2, 2], [2, 1, 1], [1, 1, 2], [3, 1], [1.5, 1.5, 1]];

  const notes: MotifNote[] = [];
  let tone = 1 + Math.floor(Math.random() * 2); // start in the middle of the register
  let cursor = 0;

  for (let bar = 0; bar < cfg.motifBars; bar++) {
    const cell = cells[Math.floor(Math.random() * cells.length)];
    cell.forEach((len, idxInBar) => {
      // Rests, but never on a downbeat - the tune should always mark the bar.
      const rest = idxInBar > 0 && Math.random() < 0.18;
      if (!rest) {
        const leap = Math.random() < 0.18;
        const step = leap
          ? (Math.random() < 0.5 ? -2 : 2)
          : (Math.random() < 0.5 ? -1 : 1);
        // Ceiling of 4, not 6. Tone 6 of a four-note chord is an octave and a
        // fifth above the tonic - with the melody register on top of that, the
        // tune's high notes were landing past 1.5kHz and screaming over
        // everything else. Capping the range is what lets the melody stay the
        // loudest voice without being the sharpest one.
        tone = clamp(tone + step, 0, 4);
        notes.push({ beat: cursor, length: len, tone });
      }
      cursor += len;
    });
  }

  // Land the phrase on the tonic of whatever chord it ends over, so it closes
  // instead of just stopping.
  if (notes.length) notes[notes.length - 1].tone = Math.random() < 0.5 ? 0 : 4;
  return notes;
}

// --- Engine state ----------------------------------------------------------

interface PadVoice {
  oscA: OscillatorNode;
  oscB: OscillatorNode;
  toneIndex: number;
}

interface AmbientState {
  moodId: AmbientMoodId;
  preset: MoodPreset;
  generation: number;
  masterGain: GainNode;
  /** Everything except the bass goes through here, so one send feeds the reverb. */
  mixBus: GainNode;
  dryOut: GainNode;
  reverbSend: GainNode;
  convolver: ConvolverNode | null;
  padFilter: BiquadFilterNode | null;
  padVoices: PadVoice[];
  vibratoLfo: OscillatorNode | null;
  textures: TextureNodes[];
  motif: MotifNote[];
  /** Beat index of the next beat still to be scheduled. */
  nextBeat: number;
  nextBeatTime: number;
  lastChordIndex: number;
  shimmerAt: number;
  timer: ReturnType<typeof setInterval> | null;
  /**
   * AudioContext time of the previous scheduler wake-up, so the next one can see how long it was
   * actually away rather than assuming it was {@link LOOKAHEAD_MS}. See {@link tick}.
   */
  lastTickTime: number;
}

/**
 * The running mood, and the counter that tells a stale scheduler it has been replaced.
 *
 * Shared through sharedSingleton for the same reason as soundUtils' mute state: under the dev
 * server a hot update can leave two instances of this module alive, and with a bare `let` the
 * newer one cannot see — and so can never stop — a mood the older one started. That is a BGM the
 * mute cannot reach, playing under a second one. One copy per page means `stopAmbientMusic()`
 * stops whatever is playing, whichever instance started it.
 */
const engine = sharedSingleton('ambientMusic.engine.v1', () => ({
  state: null as AmbientState | null,
  generation: 0,
}));

/** How often the scheduler wakes, and how far ahead of the clock it writes. */
const LOOKAHEAD_MS = 25;
const SCHEDULE_AHEAD = 0.35;
/**
 * The furthest ahead the scheduler will ever write, however long it was away.
 *
 * A ceiling rather than a target: {@link tick} widens its horizon to cover the gap it just slept
 * through, and without a cap, coming back to a tab left open for an hour would try to write an
 * hour of music into the graph in one turn. Two seconds is long enough to cover any stall a frame
 * can produce and short enough that the mood/volume changes below still take effect promptly -
 * anything already scheduled plays out before a new setting is heard.
 */
const MAX_SCHEDULE_AHEAD = 2.0;

function currentChord(preset: MoodPreset, bar: number): number[] {
  const idx = Math.floor(bar / preset.barsPerChord) % preset.progression.length;
  return preset.progression[idx];
}

/** Glides the sustained pad onto a new chord rather than re-triggering it. */
function movePadToChord(s: AmbientState, chord: number[], time: number) {
  const { preset } = s;
  const glide = (60 / preset.bpm) * preset.beatsPerBar * preset.barsPerChord * 0.6;
  s.padVoices.forEach(voice => {
    const semis = chordTone(chord, voice.toneIndex);
    const freq = freqOf(preset.rootFreq, semis);
    [voice.oscA, voice.oscB].forEach((osc, j) => {
      // The two oscillators of a voice sit a few cents apart; the beating
      // between them is the chorus that keeps the pad from sounding flat.
      const target = Math.max(freq * (j === 0 ? 1 : 1.003), 20);
      osc.frequency.cancelScheduledValues(time);
      osc.frequency.setValueAtTime(osc.frequency.value, time);
      osc.frequency.exponentialRampToValueAtTime(target, time + glide);
    });
  });
}

/** Schedules everything that happens on one beat of the grid. */
function scheduleBeat(s: AmbientState, beat: number, time: number) {
  const ctx = getSynthAudioContext();
  if (!ctx) return;
  const { preset } = s;
  const beatDur = 60 / preset.bpm;
  const bar = Math.floor(beat / preset.beatsPerBar);
  const beatInBar = beat % preset.beatsPerBar;
  const chord = currentChord(preset, bar);
  const chordIndex = Math.floor(bar / preset.barsPerChord) % preset.progression.length;

  // Chord change - move the pad, and at the top of the loop decide whether to
  // keep the current tune or write a new one.
  if (chordIndex !== s.lastChordIndex) {
    s.lastChordIndex = chordIndex;
    if (preset.pad) movePadToChord(s, chord, time);
  }
  if (preset.melody && beatInBar === 0 && bar % preset.melody.motifBars === 0 && bar > 0) {
    if (Math.random() < preset.melody.rewriteChance) {
      s.motif = composeMotif(preset.melody, preset.beatsPerBar);
    }
  }

  // Bass.
  if (preset.bass && preset.bass.beats.includes(beatInBar)) {
    playBassNote(
      ctx,
      s.dryOut,
      freqOf(preset.rootFreq, chord[0], 0.5),
      time,
      preset.bass.gain,
      beatDur * 1.8,
      preset.bass.upright,
    );
  }

  // Percussion, on its own one-bar grid of eighths.
  if (preset.perc) {
    const { kind, gain, pattern } = preset.perc;
    for (let sub = 0; sub < 2; sub++) {
      const slot = (beatInBar * 2 + sub) % pattern.length;
      if (pattern[slot] === null || pattern[slot] === undefined) continue;
      playPerc(
        ctx,
        s.mixBus,
        kind,
        time + (sub * beatDur) / 2 + swingDelay(preset, sub / 2, beatDur) + (Math.random() - 0.5) * 0.008,
        gain * (sub === 0 ? 1 : 0.75),
        sub === 0 ? -0.15 : 0.15,
      );
    }
  }

  // Accompaniment figure.
  if (preset.arp) {
    const { voice, pattern, subdiv, octave, gain, decay } = preset.arp;
    for (let sub = 0; sub < subdiv; sub++) {
      const slot = beat * subdiv + sub;
      const tone = pattern[slot % pattern.length];
      if (tone === null || tone === undefined) continue;
      // Alternating the pan slot by slot widens the figure without it wandering.
      const pan = (slot % 2 === 0 ? -1 : 1) * 0.22;
      // A touch of humanisation - a metronomically exact figure sounds typed.
      const jitter = (Math.random() - 0.5) * 0.006;
      playVoice(
        ctx,
        s.mixBus,
        voice,
        freqOf(preset.rootFreq, chordTone(chord, tone), octave),
        time + (sub * beatDur) / subdiv + swingDelay(preset, sub / subdiv, beatDur) + jitter,
        gain * (sub === 0 ? 1 : 0.82), // lean on the beat, lighten the offbeats
        decay,
        pan,
      );
    }
  }

  // Melody. Notes are placed against the motif's own beat clock, which restarts
  // every motifBars, so the tune lines up with the bar line every time round.
  //
  // The window is [thisBeat, nextBeat), NOT an equality test on the beat index:
  // `composeMotif` writes 1.5-beat cells, and an equality test silently dropped
  // every note that landed on an offbeat - which is to say it threw away exactly
  // the notes that make a tune sound played rather than typed.
  if (preset.melody && s.motif.length) {
    const motifBeats = preset.melody.motifBars * preset.beatsPerBar;
    const posInMotif = ((beat % motifBeats) + motifBeats) % motifBeats;
    for (const note of s.motif) {
      const offset = note.beat - posInMotif;
      if (offset < 0 || offset >= 1) continue;
      playVoice(
        ctx,
        s.mixBus,
        preset.melody.voice,
        freqOf(preset.rootFreq, chordTone(chord, note.tone), preset.melody.octave),
        time + offset * beatDur + swingDelay(preset, offset, beatDur),
        preset.melody.gain,
        Math.min(preset.melody.decay, note.length * beatDur + 1.2),
        0.1,
      );
    }
  }

  // Workout pulse.
  if (preset.pulse > 0) {
    playPulseThump(ctx, s.dryOut, time, preset.pulse * (beatInBar === 0 ? 1 : 0.7));
  }

  // Shimmer - time-based rather than beat-based, so it floats free of the grid.
  if (preset.shimmer && time >= s.shimmerAt) {
    const [lo, hi] = preset.shimmer;
    const tone = chordTone(chord, Math.floor(Math.random() * 4));
    // Octave 4, not 8: a twinkle two octaves above the tune was the single
    // sharpest thing in the mix and it fired on its own clock, so it cut through
    // everything. Down here it still sparkles, in the same room as the music.
    playShimmer(ctx, s.mixBus, freqOf(preset.rootFreq, tone, 4), time, 0.035);
    s.shimmerAt = time + lo + Math.random() * (hi - lo);
  }

  // Nature.
  if (preset.nature) {
    const n = preset.nature;
    if (n.crickets > 0 && n.cricketEveryBeats > 0 && beat % n.cricketEveryBeats === 0) {
      // The steady voice, on the grid - this is the pulse of the chorus.
      playCricketTrill(ctx, s.mixBus, time, n.crickets * 0.035);
      // A second, quieter voice a hair behind the beat. Two insects slightly out
      // of phase is what makes a chorus; one perfectly on the beat sounds like a
      // machine.
      if (Math.random() < 0.7) {
        playCricketTrill(ctx, s.mixBus, time + beatDur * 0.5 + Math.random() * 0.04, n.crickets * 0.022);
      }
    }
    if (n.birds > 0 && beatInBar === 0 && Math.random() < 0.45) {
      const tone = chordTone(chord, 1 + Math.floor(Math.random() * 3));
      playBirdPhrase(
        ctx,
        s.mixBus,
        // Octave 8 rather than 16 - a chirp at 2.6kHz is a smoke detector, one
        // at 1.3kHz is a bird in a tree.
        freqOf(preset.rootFreq, tone, 8),
        time + Math.random() * beatDur,
        n.birds * 0.045,
      );
    }
  }
}

function tick(gen: number) {
  const s = engine.state;
  if (!s || s.generation !== gen) return;
  const ctx = getSynthAudioContext();
  if (!ctx) return;

  const beatDur = 60 / s.preset.bpm;

  // THE CATCH-UP GUARD - do not play the beats we missed.
  //
  // This scheduler writes into the AudioContext's clock, which keeps perfect time whatever the
  // main thread is doing. The main thread does NOT: a camera zoom re-renders the whole app over
  // a live 3D scene, and the 25ms interval below can go hundreds of milliseconds - measured up
  // to four seconds - without a turn. Returning to a backgrounded tab is the same thing again,
  // since setInterval is throttled to ~1s there.
  //
  // Without this, the loop below then "catches up" by scheduling every missed beat at the time
  // it should have happened - a time now in the PAST. Web Audio clamps a past `start(t)` to
  // right now, so a whole bar of bass, arpeggio, melody, percussion and birds fires in one
  // instant, on top of each other. That is the reported 縮放視角時的怪聲: not a zoom sound
  // effect (there is none - the zoom control is silent) but the music itself piling up.
  //
  // The music is a continuous piece, not a timeline anyone is scrubbing, so the answer is to
  // skip the missed beats rather than to rush them. Advancing by WHOLE beats keeps `nextBeat`
  // aligned to real time, which is what keeps the bar lines, the chord progression and the
  // motif's phrase boundaries where they were - the piece carries on from where it now is,
  // instead of restarting or lurching a fraction of a beat off the grid.
  if (s.nextBeatTime < ctx.currentTime) {
    const missed = Math.ceil((ctx.currentTime - s.nextBeatTime) / beatDur);
    s.nextBeat += missed;
    s.nextBeatTime += missed * beatDur;
  }

  // THE HORIZON - how far past the clock this wake-up writes.
  //
  // It was the fixed SCHEDULE_AHEAD, and that is only correct while the wake-ups actually arrive
  // every LOOKAHEAD_MS. When they do not - the same zoom stall the guard above exists for, or a
  // backgrounded tab, where setInterval is throttled to about one second - a fixed 0.35s horizon
  // over a ~0.9s beat means most beats fall in the gap BETWEEN two wake-ups: too far ahead to be
  // written by the one before, already past by the time the one after runs, so the guard skips
  // them. Measured in a stalled browser: 26 notes in eight idle seconds, and ZERO across eight
  // seconds of continuous wheel zoom. The music does not merely stumble there, it stops - and
  // then walks back in, which is the other half of what 縮放時的怪聲 sounds like.
  //
  // So the horizon covers the gap this wake-up actually slept through (plus the nominal
  // lookahead, and doubled for a little headroom in case the next gap is worse). A late tick then
  // writes the beats it owes into the FUTURE, where they belong, instead of dropping them: the
  // grid stays continuous whatever the main thread is doing, which is the whole point of writing
  // to the AudioContext's clock in the first place.
  const gap = Math.max(0, ctx.currentTime - s.lastTickTime);
  s.lastTickTime = ctx.currentTime;
  const horizon = Math.min(
    MAX_SCHEDULE_AHEAD,
    Math.max(SCHEDULE_AHEAD, (gap + LOOKAHEAD_MS / 1000) * 2),
  );

  while (s.nextBeatTime < ctx.currentTime + horizon) {
    scheduleBeat(s, s.nextBeat, s.nextBeatTime);
    s.nextBeat += 1;
    s.nextBeatTime += beatDur;
  }
}

// --- Public API ------------------------------------------------------------

/**
 * Starts (or, if the same mood is already playing, leaves alone) the generative
 * music for the given mood. Safe to call on every render - a no-op unless the
 * mood actually changed.
 */
export const startAmbientMusic = (moodId: AmbientMoodId, volume = 0.5) => {
  const ctx = getSynthAudioContext();
  if (!ctx) return;

  if (engine.state && engine.state.moodId === moodId) {
    engine.state.masterGain.gain.cancelScheduledValues(ctx.currentTime);
    engine.state.masterGain.gain.linearRampToValueAtTime(volume, ctx.currentTime + 0.3);
    return;
  }

  stopAmbientMusic();

  const preset = MOODS[moodId];
  if (!preset) return;
  const gen = ++engine.generation;
  const now = ctx.currentTime;

  try {
    const masterGain = ctx.createGain();
    masterGain.gain.setValueAtTime(0, now);
    masterGain.gain.linearRampToValueAtTime(volume, now + 1.2);
    masterGain.connect(ctx.destination);

    // Dry path for the bass and pulse (reverb on low frequencies just smears),
    // and a shared mix bus for everything that should sit in the room.
    const dryOut = ctx.createGain();
    dryOut.gain.value = 1;
    dryOut.connect(masterGain);

    const mixBus = ctx.createGain();
    mixBus.gain.value = 1;

    // WARMTH STAGE - the one change that quiets every mood at once.
    //
    // A scoop at 2.6kHz (where the ear is most sensitive, and where struck-note
    // partials, birds and crickets all pile up) followed by a gentle lowpass at
    // 4.2kHz. This is EQ, not a volume cut: the music keeps its level and loses
    // only the band that was making it tiring. It sits before the reverb send as
    // well as before the master, so the tail is warm too - a bright reverb on a
    // warm source is exactly the "expensive keyboard in a tiled room" sound this
    // is trying not to be.
    const harshCut = ctx.createBiquadFilter();
    harshCut.type = 'peaking';
    harshCut.frequency.value = 2600;
    harshCut.Q.value = 1.1;
    harshCut.gain.value = -5;

    const warmth = ctx.createBiquadFilter();
    warmth.type = 'lowpass';
    warmth.frequency.value = 4200;
    warmth.Q.value = 0.4;

    mixBus.connect(harshCut);
    harshCut.connect(warmth);
    warmth.connect(masterGain);

    const reverbSend = ctx.createGain();
    reverbSend.gain.value = preset.reverb;
    let convolver: ConvolverNode | null = null;
    if (typeof ctx.createConvolver === 'function') {
      convolver = ctx.createConvolver();
      convolver.buffer = createReverbImpulse(ctx, preset.reverbSeconds);
      warmth.connect(reverbSend);
      reverbSend.connect(convolver);
      convolver.connect(masterGain);
    }

    // Sustained pad: three voices (root/third/fifth), each a pair of detuned
    // oscillators panned apart for width.
    let padFilter: BiquadFilterNode | null = null;
    const padVoices: PadVoice[] = [];
    let vibratoLfo: OscillatorNode | null = null;
    if (preset.pad) {
      padFilter = ctx.createBiquadFilter();
      padFilter.type = 'lowpass';
      padFilter.frequency.value = preset.pad.filterFreq;
      padFilter.Q.value = 0.5;
      padFilter.connect(mixBus);

      vibratoLfo = ctx.createOscillator();
      vibratoLfo.frequency.value = 0.11 + Math.random() * 0.06;
      const vibratoDepth = ctx.createGain();
      vibratoDepth.gain.value = 4; // cents
      vibratoLfo.connect(vibratoDepth);
      vibratoLfo.start(now);

      const firstChord = preset.progression[0];
      for (let v = 0; v < 3; v++) {
        const semis = chordTone(firstChord, v);
        const freq = freqOf(preset.rootFreq, semis);
        const voiceGain = ctx.createGain();
        voiceGain.gain.value = preset.pad.gain * (1 - v * 0.15);

        let voiceOut: AudioNode = voiceGain;
        if (typeof ctx.createStereoPanner === 'function') {
          const panner = ctx.createStereoPanner();
          panner.pan.value = (v - 1) * 0.35;
          voiceGain.connect(panner);
          voiceOut = panner;
        }
        voiceOut.connect(padFilter);

        const oscA = ctx.createOscillator();
        oscA.type = preset.pad.waveform;
        oscA.frequency.value = freq;
        const oscB = ctx.createOscillator();
        oscB.type = preset.pad.waveform;
        oscB.frequency.value = freq * 1.003;

        [oscA, oscB].forEach(osc => {
          osc.connect(voiceGain);
          vibratoDepth.connect(osc.detune);
          osc.start(now);
        });
        padVoices.push({ oscA, oscB, toneIndex: v });
      }
    }

    const textures: TextureNodes[] = [];
    if (preset.rain > 0) textures.push(startRainTexture(ctx, mixBus, preset.rain, now));
    if (preset.crackle) textures.push(startCrackleTexture(ctx, mixBus, preset.crackle, now));

    engine.state = {
      moodId,
      preset,
      generation: gen,
      masterGain,
      mixBus,
      dryOut,
      reverbSend,
      convolver,
      padFilter,
      padVoices,
      vibratoLfo,
      textures,
      motif: preset.melody ? composeMotif(preset.melody, preset.beatsPerBar) : [],
      nextBeat: 0,
      // Start a beat out so the first scheduled beat is comfortably in the
      // future even on a busy first frame.
      nextBeatTime: now + 0.2,
      lastChordIndex: 0,
      shimmerAt: now + (preset.shimmer ? preset.shimmer[0] : 0),
      timer: null,
      lastTickTime: now,
    };

    tick(gen);
    engine.state.timer = setInterval(() => tick(gen), LOOKAHEAD_MS);
  } catch (e) {
    // Web Audio unavailable/blocked - fail silently like the rest of the audio layer
    engine.state = null;
  }
};

// There was a `setAmbientVolume` here, for adjusting the running mood without
// restarting it. It is gone because `startAmbientMusic` already does exactly
// that when handed the mood that is already playing (see its same-mood branch),
// and two ways to set the volume is one way too many: the second one existed
// only so a UI component could reach past the music manager and poke the engine
// directly, which is the habit lib/backgroundMusic.ts was written to end.

/** Fades out and tears down whatever mood is playing. Safe to call when nothing is. */
export const stopAmbientMusic = () => {
  if (!engine.state) return;
  const current = engine.state;
  engine.state = null;

  if (current.timer) clearInterval(current.timer);

  const ctx = getSynthAudioContext();
  const teardown = () => {
    try {
      current.padVoices.forEach(v => {
        v.oscA.stop();
        v.oscB.stop();
      });
      current.vibratoLfo?.stop();
      current.textures.forEach(t => {
        t.source.stop();
        t.lfo?.stop();
      });
      // Notes already scheduled ahead of the fade stop themselves; disconnecting
      // the master is what guarantees nothing is still audible after teardown.
      current.masterGain.disconnect();
    } catch (e) {
      // already stopped
    }
  };

  if (!ctx) {
    teardown();
    return;
  }

  const now = ctx.currentTime;
  current.masterGain.gain.cancelScheduledValues(now);
  current.masterGain.gain.setValueAtTime(current.masterGain.gain.value, now);
  current.masterGain.gain.linearRampToValueAtTime(0, now + 0.6);
  setTimeout(teardown, 700);
};

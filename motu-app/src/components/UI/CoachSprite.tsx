/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { useEffect, useId, useState } from 'react';
import { motion } from 'motion/react';

/**
 * 教練阿肌 — the 健美選手 NPC who narrates the 新手引導 (NewbieTour.tsx).
 *
 * Same construction rules as the 小天使 sprite that teaches build mode
 * (AngelGuide.tsx), so the two read as one cast rather than two art styles:
 * pure SVG (no image assets, no external fonts), island-* palette only, and
 * every idle motion layered at its OWN tempo — the two-step ~1.4s, chest
 * breathing ~2.8s, the bicep flex ~1.6s, the headband tails ~1.15s, the weight
 * shift ~3.6s, blink random. Nothing shares a period, so he never visibly
 * "resets", which is the difference between a character and a looping icon.
 * (The one deliberate exception is the dance: the sway and the two feet are
 * phases of a single beat, because a step whose foot lands off the music is
 * not a step.)
 *
 * He is drawn mid front-double-biceps, facing the viewer, because the pose has
 * to survive being 84px wide on a phone: a silhouette with both fists up beside
 * the head is legible at that size in a way a standing figure is not.
 *
 * Two rules do most of the work in making him read as MUSCULAR rather than
 * merely round, and both were learned by getting them wrong first:
 *
 *   1. The torso silhouette is a V. Widest at the delts (y≈71, half-width 28)
 *      and narrowing all the way to the waist (y≈100, half-width 15). An
 *      hourglass that bulges below the ribs reads as a belly no matter how many
 *      ab lines are drawn on it, and no amount of arm detail rescues it.
 *
 *   2. Every limb is drawn TWICE — a fat pass in the outline colour, then a
 *      thinner pass in skin on top — so one continuous silhouette line runs
 *      round the whole body. The bicep is a bulge inside that shared outline,
 *      not an outlined ellipse parked next to an unoutlined stroke; drawn the
 *      latter way the muscles detach into free-floating balls and the arms turn
 *      into a balloon animal.
 */

/** Blink timing — deliberately never periodic; a metronome blink reads as a machine. */
function useBlink() {
  const [blinking, setBlinking] = useState(false);

  useEffect(() => {
    let alive = true;
    let timer = 0;

    const loop = () => {
      timer = window.setTimeout(
        () => {
          if (!alive) return;
          setBlinking(true);
          timer = window.setTimeout(() => {
            if (!alive) return;
            setBlinking(false);
            loop();
          }, 120);
        },
        2400 + Math.random() * 3000,
      );
    };

    loop();
    return () => {
      alive = false;
      window.clearTimeout(timer);
    };
  }, []);

  return blinking;
}

export function CoachSprite({
  className = '',
  /** `cheer` deepens the flex, widens the grin and shuts his eyes happily. */
  pose = 'idle',
}: {
  className?: string;
  pose?: 'idle' | 'cheer';
}) {
  // Gradient/clip ids must be unique per instance — a duplicate id anywhere in
  // the document silently repoints every `url(#…)` at the first match.
  const uid = useId().replace(/:/g, '');
  const skin = `${uid}-skin`;
  const tank = `${uid}-tank`;
  const glow = `${uid}-glow`;
  const headClip = `${uid}-head`;

  const blinking = useBlink();
  const cheering = pose === 'cheer';
  // One closed-eye shape for both, because they mean the same thing on this
  // face: a blink is just a very short cheer.
  const eyesShut = blinking || cheering;

  // Every rotation pivots on a named anatomical point in viewBox units.
  // `transformBox: 'view-box'` is stated rather than assumed: with the older
  // `border-box` default a px transform-origin resolves against the element's
  // own bounding box instead, swinging each limb around the wrong point.
  const pivot = (x: number, y: number) =>
    ({ transformBox: 'view-box', transformOrigin: `${x}px ${y}px` }) as const;

  // The flex: the upper arm swings a few degrees while the bicep swells. Both
  // arms share the beat (a bodybuilder pose is symmetric) but mirror it.
  const flexBeat = { duration: cheering ? 1.05 : 1.6, repeat: Infinity, ease: 'easeInOut' as const };
  const armSwing = cheering ? 6 : 3;
  const bicep = cheering ? [1, 1.2, 1] : [1, 1.1, 1];

  // The little two-step. One beat with four stations — centre, lean left, centre,
  // lean right — and the foot opposite the lean comes up on each lean.
  //
  // The sway is a CSS transform on the ROOT <svg>, not a wrapper <g> around the
  // drawing. That matters: a transform on an ancestor group shifts the user
  // space that every `transformBox: 'view-box'` origin below is resolved
  // against, which would quietly move all fourteen limb pivots in this file at
  // once. The root element's own transform is applied after layout and leaves
  // the viewBox coordinate system alone.
  // 1.4s = two steps at ~86bpm, which is a groove; the 2.6s this started at was
  // a man swaying in a queue. Deliberately not 1.6s, even though that would sit
  // neatly between the other beats: it is the bicep flex's period, and two
  // motions on the SAME period lock together and read as one stiff mechanism.
  const danceBeat = {
    duration: cheering ? 0.85 : 1.4,
    times: [0, 0.25, 0.5, 0.75, 1],
    repeat: Infinity,
    ease: 'easeInOut' as const,
  };
  // Percentages so the sway keeps its proportion at 84px and 112px alike; a
  // px figure tuned on desktop turns into a twitch on a phone.
  const sway = cheering ? 3.4 : 2.4;
  const hop = cheering ? -2.8 : -1.8;
  const tilt = cheering ? 3.2 : 2.2;
  const dance = {
    x: ['0%', `-${sway}%`, '0%', `${sway}%`, '0%'],
    y: ['0%', `${hop}%`, '0%', `${hop}%`, '0%'],
    rotate: [0, -tilt, 0, tilt, 0],
  };
  // Foot lifts, in viewBox units (a <g> transform is user space, not pixels).
  const lift = cheering ? 4.5 : 3;
  const step = { left: [0, 0, 0, -lift, 0], right: [0, -lift, 0, 0, 0] };

  // Warm outline for everything skin-coloured. The island-line token is a cool
  // grey and turns the figure grey-edged and sickly at small sizes; this is the
  // one place the palette is deliberately departed from, and only for the
  // silhouette line — every fill below is still an island-* colour.
  const line = '#C08049';
  const shade = '#D79A69'; // interior creases, one step lighter than the outline

  return (
    // viewBox is cropped tight to the drawn content (hair spikes at the top,
    // soles at the bottom) — leftover empty box would shrink him inside the
    // caller's width.
    //
    // It is 144 tall rather than the original 132 purely to lend the legs
    // length: the trunk had already given up all it could spare, so the extra
    // 12 units are floor. Grown at the BOTTOM, with min-y left at 0 — panning
    // the window down instead (`viewBox="0 12 140 132"`) would have been the
    // tidier-looking edit and a silent disaster, because `transform-box:
    // view-box` resolves every pivot below against the viewBox's own origin,
    // so all fourteen of them would have slid 12 units down the body.
    //
    // Callers size by width with `h-auto`, so this just makes him ~9% taller in
    // his own box; nothing needs re-measuring.
    <motion.svg
      viewBox="0 0 140 144"
      fill="none"
      aria-hidden="true"
      className={className}
      // Pivot near the feet, so a lean swings the head and leaves the shoes
      // roughly planted — rotating about the centre makes him pendulum instead.
      //
      // `willChange` gives the sprite a compositor layer of its OWN. Every limb
      // below is rewritten every frame, and without this the browser squashed
      // the SVG into whatever layer it overlapped — in NewbieTour that is the
      // spotlight's 200vmax box-shadow, an unbounded layer, so each frame of the
      // dance re-rastered the whole darkness: 17.8 Mpx of paint per frame,
      // measured. On its own layer it is 1.7 Mpx — his own 142x144 box. It has
      // to be on this element: promoting an ancestor button or panel instead
      // was measured and changed nothing.
      style={{ transformOrigin: '50% 88%', willChange: 'transform' }}
      animate={dance}
      transition={danceBeat}
    >
      <defs>
        <radialGradient id={glow} cx="50%" cy="50%" r="52%">
          <stop offset="0%" stopColor="#FFF1D4" stopOpacity="0.8" />
          <stop offset="55%" stopColor="#FFE9C4" stopOpacity="0.24" />
          <stop offset="100%" stopColor="#FFE9C4" stopOpacity="0" />
        </radialGradient>
        <linearGradient id={skin} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="#FBD8B0" />
          <stop offset="100%" stopColor="#E9AE7B" />
        </linearGradient>
        <linearGradient id={tank} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="#34AD9D" />
          <stop offset="100%" stopColor="#1F7A70" />
        </linearGradient>
        {/* Hair and headband are cut to the skull instead of being drawn to fit
            it by eye — an eyeballed cap leaves a sliver of scalp on one side at
            some sizes and overhangs on the other. */}
        <clipPath id={headClip}>
          <circle cx="70" cy="40" r="20.5" />
        </clipPath>
      </defs>

      {/* Halation behind him — sells "the spotlight is on this guy" far more
          cheaply than an SVG blur filter, which would rasterize every frame. */}
      <motion.circle
        cx="70"
        cy="72"
        r="63"
        fill={`url(#${glow})`}
        animate={{ opacity: [0.7, 1, 0.7], scale: [0.97, 1.04, 0.97] }}
        transition={{ duration: 4, repeat: Infinity, ease: 'easeInOut' }}
        style={pivot(70, 72)}
      />

      {/* ---- Headband tails. Drawn first, so they stream out from BEHIND the
              head — which is what stops them reading as a long ponytail, the
              way an over-the-top tail did. They carry the whole idle when
              everything else is holding a pose. ---- */}
      <motion.g
        style={pivot(88, 38)}
        animate={{ rotate: [-9, 9, -9] }}
        transition={{ duration: 1.15, repeat: Infinity, ease: 'easeInOut' }}
      >
        <path d="M85 35 C95 38, 102 44, 101 54" stroke="#E8836A" strokeWidth="3.8" strokeLinecap="round" fill="none" />
        <path d="M85 40 C94 45, 97 52, 93 60" stroke="#E8836A" strokeWidth="2.9" strokeLinecap="round" fill="none" opacity="0.9" />
        <path d="M92 39 C97 42, 100 46, 100 50" stroke="#F2A18C" strokeWidth="1.2" strokeLinecap="round" fill="none" opacity="0.85" />
      </motion.g>

      {/* ---- Legs and trainers. Drawn before the torso so the shorts' hem
              paints over the top of the thighs.

              Each leg is its own group so the two can take turns coming up on
              the dance beat — a sway with both feet nailed to the floor reads
              as a wobble rather than a step. ---- */}
      {[-1, 1].map((dir) => {
        const hx = 70 + dir * 8; // hip
        const ax = 70 + dir * 9; // ankle
        const sx = 70 + dir * 11.5; // shoe centre, kicked out for the toe
        // Thigh and calf are separate strokes at different weights, overlapping
        // across the knee. One stroke the whole way down is a constant width,
        // and at this new length that stops reading as a leg and starts reading
        // as a pillar.
        const thigh = `M${hx} 98 C${hx + dir * 0.4} 104, ${ax} 110, ${ax} 117`;
        const calf = `M${ax} 115 C${ax + dir * 1.6} 122, ${ax + dir * 0.4} 128, ${ax - dir * 0.4} 133`;
        return (
          <motion.g key={dir} animate={{ y: dir < 0 ? step.left : step.right }} transition={danceBeat}>
            {/* Every outline first, then every fill — outlining and filling one
                segment at a time would stroke the calf's edge straight across
                the thigh at the overlap. */}
            <path d={thigh} stroke={line} strokeWidth="18.9" strokeLinecap="round" />
            <path d={calf} stroke={line} strokeWidth="15.4" strokeLinecap="round" />
            <path d={thigh} stroke={`url(#${skin})`} strokeWidth="15.5" strokeLinecap="round" />
            <path d={calf} stroke={`url(#${skin})`} strokeWidth="12" strokeLinecap="round" />
            {/* Quad seam and knee — a single line each is all that survives at 84px */}
            <path d={`M${ax + dir} 104 V113`} stroke={shade} strokeWidth="1.5" strokeLinecap="round" opacity="0.6" />
            <path d={`M${ax - 3.6} 117 Q${ax} 119.4 ${ax + 3.6} 117`} stroke={shade} strokeWidth="1.5" strokeLinecap="round" fill="none" opacity="0.55" />

            <ellipse cx={sx} cy="136" rx="10.5" ry="5.5" fill="#FFFFFF" stroke="#D8D4C8" strokeWidth="1.8" />
            <path d={`M${sx - 9} 137 H${sx + 9}`} stroke="#2A9D8F" strokeWidth="2.4" strokeLinecap="round" />
            <path
              d={`M${sx - 3.5} 132 Q${sx} 134.5 ${sx + 3.5} 132`}
              stroke="#D8D4C8"
              strokeWidth="1.4"
              strokeLinecap="round"
              fill="none"
            />
          </motion.g>
        );
      })}

      {/* ---- Torso. The whole trunk breathes on its own slow beat, pivoting at
              the waist so the shoulders rise and the hips stay put. ---- */}
      <motion.g
        style={pivot(70, 104)}
        animate={{ scale: [1, 1.035, 1] }}
        transition={{ duration: 2.8, repeat: Infinity, ease: 'easeInOut' }}
      >
        {/* The V: half-width 28 at the delts, 19 at the ribs, 15 at the waist.
            Monotonically narrowing — the moment it bulges below the ribs the
            whole figure turns into a barrel. */}
        {/* The hip line sits at y≈101 rather than 106: the viewBox is full at
            the bottom (the soles are already within half a unit of it), so the
            only way to lend the legs length is to give the trunk less. */}
        <path
          d="M58 61 C50 62, 43 65, 42 71 C41 78, 45 85, 51 91 C54 94, 55 97, 55.5 101
             L84.5 101 C85 97, 86 94, 89 91 C95 85, 99 78, 98 71 C97 65, 90 62, 82 61 Z"
          fill={`url(#${skin})`}
          stroke={line}
          strokeWidth="2.3"
          strokeLinejoin="round"
        />

        {/* Abs, exposed under a cropped stringer (y≈83–94). Light strokes rather
            than outlined blocks — at 84px wide, drawn blocks turn to mud. */}
        <path d="M70 83 V94" stroke={shade} strokeWidth="1.7" strokeLinecap="round" opacity="0.8" />
        <path d="M63.5 86.5 H76.5" stroke={shade} strokeWidth="1.6" strokeLinecap="round" opacity="0.62" />
        <path d="M64.5 90.5 H75.5" stroke={shade} strokeWidth="1.5" strokeLinecap="round" opacity="0.5" />
        {/* Obliques — the two short diagonals that actually sell a narrow waist */}
        <path d="M57 84 Q59.5 89 62 94" stroke={shade} strokeWidth="1.5" strokeLinecap="round" fill="none" opacity="0.5" />
        <path d="M83 84 Q80.5 89 78 94" stroke={shade} strokeWidth="1.5" strokeLinecap="round" fill="none" opacity="0.5" />

        {/* Tank top — a stringer. The neckline is a notch cut into this ONE
            path, so the chest showing through it is the torso already drawn
            underneath. Painting a skin-coloured patch on top of a closed vest
            instead is what produced the bib-shaped blob in the previous pass. */}
        {/* A shallow scoop, not a deep V, and a hem that only just lifts in the
            middle. Both were overdone in the previous pass and the combination
            of plunging neckline + high arced hem + narrow waist underneath read
            as a sports bra rather than a men's stringer. */}
        <path
          d="M44.5 70 C48 65, 53 64.5, 58.5 66 C62.5 69, 66.5 71.5, 70 72.2
             C73.5 71.5, 77.5 69, 81.5 66 C87 64.5, 92 65, 95.5 70
             C97 76, 95 82, 91 86 Q70 83, 49 86 C45 82, 43 76, 44.5 70 Z"
          fill={`url(#${tank})`}
          stroke="#17605A"
          strokeWidth="1.9"
          strokeLinejoin="round"
        />
        {/* Hem light, and the fold where the fabric crosses the ribs */}
        <path d="M51 84 Q70 81, 89 84" stroke="#7ED0C4" strokeWidth="1.7" strokeLinecap="round" fill="none" opacity="0.55" />
        <path d="M58 70 C57 75, 57.5 80, 59 83.5" stroke="#17605A" strokeWidth="1.3" strokeLinecap="round" fill="none" opacity="0.4" />
        <path d="M82 70 C83 75, 82.5 80, 81 83.5" stroke="#17605A" strokeWidth="1.3" strokeLinecap="round" fill="none" opacity="0.4" />

        {/* Pecs, in the skin showing through the neckline */}
        <path d="M70 66 V71.8" stroke={shade} strokeWidth="1.7" strokeLinecap="round" opacity="0.6" />
        <path d="M63 66 Q66.5 70, 69.4 71.3" stroke={shade} strokeWidth="1.5" strokeLinecap="round" fill="none" opacity="0.45" />
        <path d="M77 66 Q73.5 70, 70.6 71.3" stroke={shade} strokeWidth="1.5" strokeLinecap="round" fill="none" opacity="0.45" />

        {/* Shorts */}
        <path
          d="M52.5 93 C60 96.5, 80 96.5, 87.5 93 L88.5 104 C84 107.5, 78.5 106.5, 76.5 102
             L70 99.5 L63.5 102 C61.5 106.5, 56 107.5, 51.5 104 Z"
          fill="#264653"
          stroke="#152B33"
          strokeWidth="1.7"
          strokeLinejoin="round"
        />
        {/* Waistband */}
        <path d="M53 96.5 Q70 100, 87 96.5" stroke="#5FBDAF" strokeWidth="1.9" strokeLinecap="round" fill="none" opacity="0.75" />
      </motion.g>

      {/* ---- Arms, front double biceps. Drawn after the torso (they are in
              front of it) and before the head, which they never overlap: the
              fists stop ~4 units short of the skull so the face stays clear at
              every size. ---- */}
      {[-1, 1].map((dir) => {
        // Deltoid → elbow → fist. The delt sits ON the torso's widest point, so
        // the round stroke cap there IS the shoulder muscle and the arm can
        // never look socketed on.
        const dx = 70 + dir * 27;
        const ex = 70 + dir * 43;
        const fx = 70 + dir * 31;
        const bx = 70 + dir * 35;
        const by = 63.5;

        const upper = `M${dx} 71 C ${70 + dir * 35} 69, ${70 + dir * 42} 63, ${ex} 55`;
        const fore = `M${ex} 55 C ${70 + dir * 44} 46, ${70 + dir * 38} 38, ${fx} 32`;
        // Wrist, a short way back down the forearm from the fist. The sweatband
        // that sits here is doing real work, not decoration: forearm and fist
        // are within a couple of units of each other in width, so without a
        // break between them the whole arm reads as one undifferentiated club.
        const wx = 70 + dir * 38.6;
        // Peaks face up-and-inward on both sides once mirrored — a flexed bicep
        // does not point outward.
        const spin = `rotate(${-dir * 45} ${bx} ${by})`;

        return (
          <motion.g
            key={dir}
            style={pivot(dx, 71)}
            animate={{ rotate: [0, -dir * armSwing, 0] }}
            transition={flexBeat}
          >
            {/* Outline pass for the whole limb… */}
            <path d={upper} stroke={line} strokeWidth="20.4" strokeLinecap="round" />
            <path d={fore} stroke={line} strokeWidth="16.9" strokeLinecap="round" />
            <circle cx={fx} cy="32" r="10.1" fill={line} />

            {/* …then the bicep, outline and fill together in one group so the
                swell can never split into two out-of-step shapes. It is drawn
                BEFORE the skin pass below, so its outline survives only where
                the bulge actually jitters out past the arm — everywhere else
                the arm paints over it and the two merge into one silhouette. */}
            <motion.g style={pivot(bx, by)} animate={{ scale: bicep }} transition={flexBeat}>
              <g transform={spin}>
                <ellipse cx={bx} cy={by} rx="12.9" ry="10.6" fill={line} />
                <ellipse cx={bx} cy={by} rx="11.2" ry="8.9" fill={`url(#${skin})`} />
              </g>
            </motion.g>

            {/* Skin pass */}
            <path d={upper} stroke={`url(#${skin})`} strokeWidth="17" strokeLinecap="round" />
            <path d={fore} stroke={`url(#${skin})`} strokeWidth="13.5" strokeLinecap="round" />
            <circle cx={fx} cy="32" r="8.4" fill={`url(#${skin})`} />

            {/* Sweatband at the wrist — sized to sit just inside the forearm so
                it never breaks the silhouette it is dividing. */}
            <g transform={`rotate(${-dir * 49.5} ${wx} 38.5)`}>
              <rect x={wx - 6.2} y="35" width="12.4" height="7" rx="1.8" fill="#2A9D8F" stroke="#17605A" strokeWidth="1.2" />
              <path d={`M${wx - 5.4} 37 H${wx + 5.4}`} stroke="#7ED0C4" strokeWidth="1.3" strokeLinecap="round" opacity="0.8" />
            </g>

            {/* Peak highlight, on the same swell so it rides the muscle instead
                of sliding off it. */}
            <motion.g style={pivot(bx, by)} animate={{ scale: bicep }} transition={flexBeat}>
              <g transform={spin}>
                <path
                  d={`M${bx - 6.5} ${by - 4} Q${bx} ${by - 7.8} ${bx + 6.5} ${by - 4}`}
                  stroke="#FFE7CC"
                  strokeWidth="2.2"
                  strokeLinecap="round"
                  fill="none"
                  opacity="0.9"
                />
              </g>
            </motion.g>

            {/* Elbow crease and knuckles */}
            <path
              d={`M${ex - dir * 4.5} 58.5 Q${ex + dir * 0.5} 55.5 ${ex - dir * 1} 51.5`}
              stroke={shade}
              strokeWidth="1.5"
              strokeLinecap="round"
              fill="none"
              opacity="0.7"
            />
            <path
              d={`M${fx - 4.4} 33.4 Q${fx} 36.4 ${fx + 4.4} 33.4`}
              stroke={shade}
              strokeWidth="1.5"
              strokeLinecap="round"
              fill="none"
              opacity="0.85"
            />
          </motion.g>
        );
      })}

      {/* ---- Head. Rides its own slow weight-shift so it isn't welded to the
              breathing torso. ---- */}
      <motion.g
        style={pivot(70, 62)}
        animate={{ rotate: [-1.6, 1.6, -1.6], y: [0, -1.2, 0] }}
        transition={{ duration: 3.6, repeat: Infinity, ease: 'easeInOut' }}
      >
        {/* Neck — short and thick, and present at all, which the previous pass
            was not: a head sitting straight on the traps reads as a snowman. */}
        <path d="M62.5 50 H77.5 V62 Q70 66.5 62.5 62 Z" fill={`url(#${skin})`} stroke={line} strokeWidth="1.9" strokeLinejoin="round" />
        <path d="M64 60 Q70 63.5 76 60" stroke={shade} strokeWidth="1.4" strokeLinecap="round" fill="none" opacity="0.55" />

        {/* Ears, which cost four lines and do more for "this is a person" than
            any amount of muscle detail. */}
        <ellipse cx="49.8" cy="42.5" rx="3.7" ry="5.2" fill={`url(#${skin})`} stroke={line} strokeWidth="1.7" />
        <ellipse cx="90.2" cy="42.5" rx="3.7" ry="5.2" fill={`url(#${skin})`} stroke={line} strokeWidth="1.7" />

        <circle cx="70" cy="40" r="20.5" fill={`url(#${skin})`} stroke={line} strokeWidth="2.2" />

        {/* Hair + headband, both cut to the skull. The band sits low on the
            FOREHEAD rather than over the crown, which is what leaves a real
            haircut visible above it. */}
        <g clipPath={`url(#${headClip})`}>
          <path d="M48 30 A22 22 0 0 1 92 30 Z" fill="#264653" />
          <path d="M56.5 24 C62 20, 71 19, 79 22" stroke="#4A6169" strokeWidth="2.8" strokeLinecap="round" fill="none" />
          {/* Sideburns, tapering down past the band */}
          <path d="M50 30 V44 L54 36 Z" fill="#264653" />
          <path d="M90 30 V44 L86 36 Z" fill="#264653" />

          {/* The band rides the FOREHEAD. Sat any lower it eats the brows and
              clips the tops of the eyes, and the face loses the half of itself
              that carries the expression. */}
          <path d="M48 29.5 H92 V36.5 H48 Z" fill="#E8836A" />
          <path d="M48 30.4 H92" stroke="#F2A18C" strokeWidth="1.5" opacity="0.85" />
        </g>
        {/* Spiky crown, outside the clip so it can break the skull line. Drawn
            as one path whose base sits INSIDE the hair cap, so it merges into
            the haircut instead of perching on top as two loose horns. */}
        <path d="M56 28 L60 13.5 L65.5 24 L70 11.5 L75 24 L80 14 L84 28 Z" fill="#264653" />

        {/* Face */}
        {eyesShut ? (
          <>
            <path d="M58.2 45.5 Q62.5 41.6 66.8 45.5" stroke="#264653" strokeWidth="2.5" strokeLinecap="round" fill="none" />
            <path d="M73.2 45.5 Q77.5 41.6 81.8 45.5" stroke="#264653" strokeWidth="2.5" strokeLinecap="round" fill="none" />
          </>
        ) : (
          <>
            <ellipse cx="62.5" cy="46" rx="3.3" ry="3.9" fill="#264653" />
            <ellipse cx="77.5" cy="46" rx="3.3" ry="3.9" fill="#264653" />
            <circle cx="63.8" cy="44.4" r="1.3" fill="#FFFFFF" />
            <circle cx="78.8" cy="44.4" r="1.3" fill="#FFFFFF" />
          </>
        )}
        {/* Brows sit just under the band — the whole difference between "cute"
            and "cute and certain". */}
        <path d="M57.4 41.6 Q62.5 39.2 67.2 41.4" stroke="#264653" strokeWidth="2.6" strokeLinecap="round" fill="none" />
        <path d="M82.6 41.6 Q77.5 39.2 72.8 41.4" stroke="#264653" strokeWidth="2.6" strokeLinecap="round" fill="none" />
        <ellipse cx="55.5" cy="51" rx="4.5" ry="2.7" fill="#E8836A" opacity="0.36" />
        <ellipse cx="84.5" cy="51" rx="4.5" ry="2.7" fill="#E8836A" opacity="0.36" />

        {/* Grin — opens up for the finish. The idle shape is also written as a
            plain `d`, so the mouth exists before Motion's first frame (and in
            any non-JS render); `animate` alone leaves the path dataless. */}
        <motion.path
          d="M64 52 Q70 58.5 76 52"
          // 健身組整合：沒有 initial 時 Motion 第一幀讀不到起點，console 會報「attribute d: "undefined"」
          initial={{ d: 'M64 52 Q70 58.5 76 52' }}
          animate={{ d: cheering ? 'M62 51.5 Q70 62 78 51.5' : 'M64 52 Q70 58.5 76 52' }}
          transition={{ duration: 0.3, ease: 'easeOut' }}
          stroke="#264653"
          strokeWidth="2.6"
          strokeLinecap="round"
          fill="none"
        />
      </motion.g>

      {/* ---- Effort sparkles. Staggered so they never pop together, and pushed
              out to the corners the arms don't reach. ---- */}
      {[
        { x: 10, y: 40, s: 1, d: 0 },
        { x: 130, y: 44, s: 0.85, d: 1.2 },
        { x: 22, y: 112, s: 0.7, d: 2.3 },
        { x: 118, y: 106, s: 0.9, d: 0.7 },
      ].map((tw) => (
        // The placement `translate` has to live on a plain wrapper <g>: Motion
        // drives SVG transforms through the CSS `transform` property, which
        // wholesale overrides a `transform` *attribute* on the same element —
        // put both on the star itself and every sparkle collapses onto 0,0.
        <g key={`${tw.x}-${tw.y}`} transform={`translate(${tw.x} ${tw.y})`}>
          <motion.path
            d="M0 -6 Q1 -1 6 0 Q1 1 0 6 Q-1 1 -6 0 Q-1 -1 0 -6 Z"
            fill="#F5D08A"
            style={{ transformBox: 'fill-box', transformOrigin: 'center' }}
            animate={{ scale: [0, tw.s, 0], rotate: [0, 90, 180], opacity: [0, 1, 0] }}
            transition={{ duration: 2.4, delay: tw.d, repeat: Infinity, ease: 'easeInOut' }}
          />
        </g>
      ))}
    </motion.svg>
  );
}

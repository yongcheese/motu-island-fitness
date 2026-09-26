/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { useCallback, useEffect, useLayoutEffect, useRef, useState, type CSSProperties } from 'react';
import confetti from 'canvas-confetti';
import { ItemDefinition } from '../../constants/items';
import { Rarity, rarityStyleVars } from '../../constants/rarity';
import { ConfettiBurst, REVEAL_COLOUR_RISE_MS, REVEAL_SETTLE_MS } from '../../constants/rarityFx';
import { playRevealSpin } from '../../lib/soundUtils';
import { getRevealCopy } from '../../constants/revealCopy';
import { QVersionIcon } from '../QVersionIcon';
import { RarityAura } from './RarityAura';
import { ModalOverlay } from './DesignKit';

/**
 * How long the choreography runs. Matches the timeline documented over
 * `.rarity-reveal-*` in index.css — change one and change the other.
 */
const REVEAL_MS = 9000;
/** A beat after the item has faded before the dialog behind it is allowed to close. */
const TAIL_MS = 400;
// Their sum (9400ms) is also `.rarity-reveal-layer`'s duration — that animation fades this whole
// overlay out just as the callback fires, so the unmount lands on an already-invisible layer.
//
// 9000, having been 5000, 6500, 8000 and then 11000. Every move is exactly what the ARRIVAL grew or
// shrank by (see REVEAL_SETTLE_MS); the reading time after the settle has never changed. The copy
// still lands on the same beats measured from the stop and the player still gets the same ~3.5s
// with it up — this last move is the first that took time OFF the front rather than adding it.

/**
 * When the copy starts arriving, and how far apart the lines are.
 *
 * Here rather than in the stylesheet because the stagger is DATA — line three is 300ms after line
 * one because it is line three — and expressing it in CSS means one near-identical rule per line
 * plus a new one every time a line is added. The animation itself is a single class
 * (`.rarity-reveal-line`); this is only when each copy of it starts.
 */
const COPY_START_MS = REVEAL_SETTLE_MS + 250;
const COPY_GAP_MS = 150;
/** The tags land tighter than the sentences above them — they are one row, read as a group. */
const TAG_GAP_MS = 90;

/** When the overlay starts accepting a tap. Matches `.rarity-reveal-hint`'s delay in index.css. */
const SKIPPABLE_AT_MS = 6800;

/**
 * How loud the 轉動音 sits under everything else.
 *
 * 0.55, up from 0.38. Under the 神話 brass (0.5) a 0.38 noise bed is not quiet, it is gone — and
 * 「旋轉要有種持續的音效」 was reporting exactly that. See {@link playRevealSpin}.
 */
const SPIN_VOLUME = 0.55;

/**
 * The full-screen 揭曉 played when a 史詩 item or better is bought.
 *
 * The one moment in the game that is allowed to be loud, and it is only reachable from the top
 * two of the four rarity tiers — see constants/rarityFx.ts on why the quiet of the other two is
 * what pays for it.
 *
 * ## The shape of it
 *
 * The screen collapses to dark, and the item turns in from far away as a SILHOUETTE — a black
 * speck with a rim of the tier's own light, under a whoosh that slows with it ({@link playRevealSpin}).
 * It comes round many times, quickly at first and then slowing, SWELLING from a twelfth of its
 * size to its full size as it comes, with its colour rising into it as it decelerates, and it
 * stops facing front with a small bounce. Everything blooms on that stop: a flash, a ring pushed
 * out across the screen, a pool of light under its feet, the tier's gradient welling up behind
 * it, and the confetti. Then it breathes, and its name, its kind, a one-sentence greeting and
 * its tags arrive underneath, one every 150ms. About nine and a half seconds end to end, five and
 * a half of which are the arrival.
 *
 * The silhouette is the load-bearing idea and everything else is dressing. A reveal that simply
 * shows you the thing has no moment in it; a reveal that shows you a shape first has one, and it
 * is the instant you recognise what you got — which is a fraction of a second BEFORE the animation
 * tells you, and is therefore yours rather than the animation's.
 *
 * ## Everything is aimed at the item, not at the middle of the screen
 *
 * The stage is a COLUMN — the item, then its name, kind, greeting and tags — and the whole column
 * is what gets centred in the viewport. So the item itself sits well ABOVE centre, by half the
 * height of the copy underneath it (~110px on a phone, and it moves whenever a line wraps).
 * Every radial layer here used to be pinned to a hand-picked percentage of the SCREEN instead —
 * the rays at 50%, the rings and the settle flash at 44%, the gradient at 46% — which put the
 * point all that light converges on somewhere below the thing it is supposed to be coming off,
 * and read as 「商品有點偏光芒中間的上方」.
 *
 * {@link useLayoutEffect} below measures where the item actually lands and publishes it as
 * `--reveal-focus`, a pixel offset from the middle of the screen; the four layers in index.css
 * are anchored to `calc(50% + var(--reveal-focus))` and there is no per-layer percentage left to
 * drift. Do not re-introduce one — if a layer looks low, it is because the focus is wrong for
 * every layer, and it is measured in one place.
 *
 * ## What it deliberately does NOT do
 *
 * **It never names the tier.** The copy block shows the item's name and its KIND (「神鳥」, 「立耳
 * 犬」) — there is no 「神話」 caption, exactly as there is none on the card (constants/rarity.ts).
 * A reveal is the one place a label would be easy to justify and it would still be the same
 * mistake: the player is being shown what they now own, not being read their receipt. The tier is
 * said at full volume anyway, by the colour of every layer around that text.
 *
 * **It does not re-draw the item.** The plinth is the shop card's icon well at presentation size,
 * carrying the same `RarityAura` layers off the same palette, so this reads as the card the player
 * was just looking at rather than as a second illustration that happens to match.
 *
 * **It does not offer an exit until the copy has landed.** Five seconds is long enough that it has
 * to be skippable, but a skip offered at second one is an invitation to dismiss the thing the
 * player just paid for. The hint appears at {@link SKIPPABLE_AT_MS}, after the last tag.
 *
 * Confetti runs on a canvas owned by this overlay, the way AngelGuide does it: the library's
 * global canvas is appended to `<body>` at z-index 100, which is far below `.z-reveal` (1500), so
 * a global burst would fire *behind* the dim and be invisible. The quieter tiers keep using the
 * global canvas — they have no overlay to get stuck behind.
 */
export function RarityReveal({
  item,
  rarity,
  bursts,
  turns,
  shake,
  onDone,
}: {
  item: ItemDefinition;
  rarity: Rarity;
  bursts: ConfettiBurst[];
  /** Full rotations on the way in — the tier's `revealTurns` (constants/rarityFx.ts). */
  turns: number;
  /** 神話 only — see index.css's `.rarity-shake`. */
  shake: boolean;
  /** Fired once the reveal has finished playing. This is what closes the purchase dialog. */
  onDone: () => void;
}) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const stageRef = useRef<HTMLDivElement | null>(null);
  const pivotRef = useRef<HTMLDivElement | null>(null);
  const timersRef = useRef<number[]>([]);
  const [skippable, setSkippable] = useState(false);
  /**
   * How far the item's centre sits from the centre of the screen, in px — negative, because the
   * copy underneath it pushes it up. Every radial layer is aimed at this. See the component doc.
   */
  const [focus, setFocus] = useState(0);
  // Held in a ref so the effect below can call the latest one without listing it as a dependency
  // and re-running the whole choreography every render.
  const onDoneRef = useRef(onDone);
  onDoneRef.current = onDone;

  const copy = getRevealCopy(item);

  const later = useCallback((fn: () => void, ms: number) => {
    timersRef.current.push(window.setTimeout(fn, ms));
  }, []);

  // Layout, not paint: `offsetTop`/`offsetHeight` ignore transforms, and on this subtree that is
  // the only way to get a straight answer — the stage is mid push-in, the pivot's child is mid
  // spin and mid swell, so on the first frame `getBoundingClientRect()` would be measuring the
  // item at 22% of its size, turned edge-on. The pivot's own box is the plinth's un-transformed
  // one (its ground light is absolute and its spinning child is scaled), so the pivot's middle IS
  // the item's middle; the stage's middle is the middle of the screen, because the overlay centres
  // it with symmetric padding.
  //
  // A ResizeObserver rather than a one-shot measure: the copy is what decides the offset, and it
  // reflows when a webfont lands or when a long item name wraps to a second line at a narrow
  // width. It watches the layout box, which a transform does not change — so the push-in does not
  // wake it once, let alone every frame.
  useLayoutEffect(() => {
    const stage = stageRef.current;
    const pivot = pivotRef.current;
    if (!stage || !pivot) return;
    // Un-rounded on purpose. `offsetTop`/`offsetHeight` are already integers, so the two halves
    // carry up to a quarter-pixel of rounding each; rounding their difference as well is a third
    // helping of the same error, and a half-pixel here costs nothing — the value only changes on
    // a reflow, so there is no subpixel churn to avoid.
    const measure = () =>
      setFocus(pivot.offsetTop + pivot.offsetHeight / 2 - stage.offsetHeight / 2);
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(stage);
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    const canvas = canvasRef.current;
    const timers = timersRef.current;
    // `resize: true` keeps the canvas matched to the overlay; `useWorker` is left off for the
    // same reason AngelGuide leaves it off — it transfers the canvas permanently and this
    // component unmounts as soon as the reveal ends.
    const fire = canvas ? confetti.create(canvas, { resize: true }) : null;
    // 轉動音, for the silhouette phase only — the full turn drives its deceleration, but it is
    // faded out at REVEAL_COLOUR_RISE_MS, the instant the item stops being a black shape. Once the
    // player can see what they have, the sound has nothing left to describe. Started here rather
    // than from a row of
    // constants/rarityFx.ts because it belongs to the SPIN and not to a tier — every reveal tier
    // turns for the same REVEAL_SETTLE_MS, so there is nothing per-tier to grade — and because the
    // table's sounds are fire-and-forget while this one has to be STOPPABLE: the overlay can be
    // tapped away from SKIPPABLE_AT_MS, and a whoosh outliving the reveal is a whoosh over the shop.
    // Silenced under prefers-reduced-motion for the same reason the CSS cancels the spin there: the
    // sound of a thing turning, over a thing that is not turning, is noise.
    const stopSpin = window.matchMedia('(prefers-reduced-motion: reduce)').matches
      ? null
      : playRevealSpin(SPIN_VOLUME, REVEAL_SETTLE_MS, REVEAL_COLOUR_RISE_MS);

    // Tall thin rectangle = a paper streamer. canvas-confetti tumbles and foreshortens each
    // particle in flight, so this reads as 彩帶 rather than as the default dots.
    const ribbon = confetti.shapeFromPath({ path: 'M0 0 H5 V17 H0 Z' });

    for (const burst of bursts) {
      later(() => {
        fire?.({
          particleCount: burst.particleCount,
          spread: burst.spread,
          colors: burst.colors,
          ticks: burst.ticks,
          startVelocity: burst.startVelocity,
          angle: burst.angle,
          origin: burst.origin ?? { x: 0.5, y: 0.62 },
          shapes: burst.ribbon ? [ribbon] : ['circle', 'square'],
          scalar: burst.ribbon ? 1.05 : 1,
          // Every burst in this file carries it: the reveal still plays for a player who has
          // asked for less motion (silently skipping it would read as the purchase failing), but
          // nothing may be thrown across their screen.
          disableForReducedMotion: true,
        });
      }, burst.delay);
    }

    // 神話's screen shake, on the settle rather than on the purchase — the room moves when the
    // thing lands, not when the button is pressed. Applied to the app root rather than to this
    // overlay, because a shake that moves only the celebration is the celebration wobbling. The
    // CSS cancels itself under prefers-reduced-motion, so no media query is needed here — but the
    // class is still removed on the way out so a re-mount can re-trigger it.
    const root = shake ? document.getElementById('root') : null;
    if (root) {
      later(() => root.classList.add('rarity-shake'), REVEAL_SETTLE_MS);
      later(() => root.classList.remove('rarity-shake'), REVEAL_SETTLE_MS + 700);
    }

    later(() => setSkippable(true), SKIPPABLE_AT_MS);
    later(() => onDoneRef.current(), REVEAL_MS + TAIL_MS);

    return () => {
      timers.forEach(window.clearTimeout);
      timers.length = 0;
      root?.classList.remove('rarity-shake');
      fire?.reset();
      // Covers both endings: the reveal running out, and the player tapping it away mid-spin.
      stopSpin?.();
    };
  }, [bursts, shake, later]);

  return (
    // ModalOverlay, not a bespoke fixed div: the scrim, the fade preset and the z-token plumbing
    // are the ones every other modal uses, so this is the same vocabulary played louder rather
    // than a second animation system. Clicks are ignored until the copy has landed — until then
    // there is nothing to dismiss, and the reveal must never be mistaken for a dialog that needs
    // dismissing.
    <ModalOverlay
      zIndexClassName="z-reveal"
      // NO scrim of its own. `.rarity-reveal-dim` is this layer's darkness and it goes almost the
      // whole way to opaque; the inherited ink scrim on top of that was 45% of a dark BLUE laid
      // over the black, which is where the blue cast in the first half-second came from. There
      // must be exactly one thing darkening this screen.
      scrimClassName="bg-transparent"
      className={`rarity-reveal-layer overflow-hidden ${skippable ? 'cursor-pointer' : 'pointer-events-none'}`}
      // The overlay is the nearest element the light layers and the stage have in common, so this
      // is where the measured focus has to be published for all of them to inherit it.
      style={{ '--reveal-focus': `${focus}px` } as CSSProperties}
      onClick={skippable ? () => onDoneRef.current() : undefined}
    >
      <div className="rarity-reveal-dim" />
      <div className="rarity-reveal-backdrop" style={rarityStyleVars(rarity)} />
      <div className="rarity-reveal-flash" />
      <div className="rarity-reveal-rays" />
      <div className="rarity-reveal-burst" style={rarityStyleVars(rarity)} />
      <div className="rarity-reveal-ring" style={rarityStyleVars(rarity)} />
      <div className="rarity-reveal-ring rarity-reveal-ring-2" style={rarityStyleVars(rarity)} />

      <div ref={stageRef} className="rarity-reveal-stage" style={rarityStyleVars(rarity)}>
        {/* Not `relative` any more but `.rarity-reveal-pivot`, which is that plus the
            `perspective` the turn below actually renders through. It has to be THIS element —
            perspective only reaches an element's direct children, and this is the spin's parent.
            The stage's own perspective never applied to the rotation; see index.css. */}
        <div ref={pivotRef} className="rarity-reveal-pivot">
          {/* 腳下的光環, behind the item and anchored to the bottom of its well. */}
          <div className="rarity-reveal-ground">
            <div className="rarity-reveal-pool" />
            <div className="rarity-reveal-halo" />
          </div>

          {/* The turn count reaches `.rarity-reveal-spin`'s keyframes as a custom property — the
              rotation is one `calc()` off it, so grading a tier is a number in the FX table and
              never a second copy of the keyframes. */}
          <div className="rarity-reveal-spin" style={{ '--reveal-turns': turns } as CSSProperties}>
            {/* TWO elements for one move, and the nesting is what makes 由小變大 legible: the turn
                is on the parent and the swell is on this child, so each gets its own timing
                function instead of the growth inheriting the rotation's front-loaded decay. See
                `.rarity-reveal-grow` in index.css. */}
            <div className="rarity-reveal-grow">
              <div className="rarity-reveal-plinth w-[248px] aspect-[4/3] flex items-center justify-center">
                {/* The aura is wrapped so the plate can be held back during the silhouette phase
                    without the icon in front of it fading too — see `.rarity-reveal-plate`. */}
                <div className="rarity-reveal-plate">
                  <RarityAura rarity={rarity} />
                </div>
                <div className="rarity-reveal-silhouette">
                  <QVersionIcon itemId={item.id} size={132} />
                </div>
              </div>
            </div>
          </div>
        </div>

        {/* The copy. Each line is the same `.rarity-reveal-line` animation started at a different
            time; the delays are the stagger and nothing else differs. */}
        <div className="flex flex-col items-center text-center gap-2 px-2">
          {/* The item's name, never the tier's. See the component doc. */}
          <span
            className="rarity-reveal-line text-white font-black text-2xl tracking-wide drop-shadow-[0_2px_14px_rgba(0,0,0,0.6)]"
            style={{ animationDelay: `${COPY_START_MS}ms` }}
          >
            {item.name}
          </span>

          <span
            className="rarity-reveal-line px-3 py-0.5 rounded-full text-xs font-black tracking-widest text-white/95 border border-white/30 bg-white/10 backdrop-blur-sm"
            style={{ animationDelay: `${COPY_START_MS + COPY_GAP_MS}ms` }}
          >
            {copy.kind}
          </span>

          <p
            className="rarity-reveal-line text-white/85 text-sm font-medium leading-relaxed max-w-[300px] drop-shadow-[0_2px_10px_rgba(0,0,0,0.65)]"
            style={{ animationDelay: `${COPY_START_MS + COPY_GAP_MS * 2}ms` }}
          >
            {copy.intro}
          </p>

          {/* Absent entirely for an item with no written copy — getRevealCopy returns no tags
              rather than inventing three, and an empty row is better than three guesses. */}
          {copy.tags.length > 0 && (
            <div className="flex flex-wrap items-center justify-center gap-1.5 mt-0.5">
              {copy.tags.map((tag, i) => (
                <span
                  key={tag}
                  className="rarity-reveal-line px-2.5 py-1 rounded-lg text-[11px] font-black text-island-navy bg-white/85 shadow-[0_2px_8px_rgba(0,0,0,0.25)]"
                  style={{ animationDelay: `${COPY_START_MS + COPY_GAP_MS * 3 + i * TAG_GAP_MS}ms` }}
                >
                  {tag}
                </span>
              ))}
            </div>
          )}

          <span className="rarity-reveal-hint text-white text-[11px] font-bold tracking-widest mt-1">
            輕觸繼續
          </span>
        </div>
      </div>

      <canvas ref={canvasRef} className="absolute inset-0 w-full h-full pointer-events-none" />
    </ModalOverlay>
  );
}

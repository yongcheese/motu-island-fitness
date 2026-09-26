/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * The one marker the 小天使 (AngelGuide.tsx) steps around.
 *
 * She narrates the panels along the bottom of the screen from the sky above
 * them, so she is always racing the thing she is talking about for the same
 * viewport. The static half of that — the interior header card and the MiniMap
 * — is solved by `PLACEMENT_KEEP_OUT` in AngelGuide.tsx, because those two are
 * always the same size in the same corner. This marker is for the half that is
 * NOT: the build-mode panel is as tall as whichever tab is open, the furniture
 * drawer only exists while it is open (and jumps to the top-right the moment a
 * piece is picked up), and every dock's height follows its own live contents. A
 * padding figure tuned to any one of those is wrong for the rest, which is how
 * the guide ended up sitting on top of the panel it was narrating on a short
 * window.
 *
 * WHY AN ATTRIBUTE AND NOT A REF — same reasoning as `data-tour`
 * (tourTargets.ts): the obstacles live in different components, in different
 * portals, and mount and unmount as the player works. The guide queries for
 * whatever is on screen this frame and reserves the room it actually occupies;
 * an obstacle that isn't mounted simply isn't found. Nothing here names a
 * specific panel, and no panel needs to know the guide exists beyond spreading
 * this one attribute — which is what lets a dock added later be stepped around
 * for free.
 *
 * The marker goes on the element whose *painted* box must stay clear — the
 * card itself, not a full-bleed backdrop wrapper around it, since
 * `getBoundingClientRect()` on it is literally the area the guide gives up.
 */
export const ANGEL_AVOID = { 'data-angel-avoid': '' } as const;

/** The matching query the guide measures with. */
export const ANGEL_AVOID_SELECTOR = '[data-angel-avoid]';

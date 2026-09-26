/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * The HUD landmarks the 新手引導 (NewbieTour.tsx) shines its spotlight on, and
 * the one attribute every one of them is found by.
 *
 * WHY AN ATTRIBUTE AND NOT A REF: the landmarks live in six different
 * components spread across four HudFrame regions (HudFrame.tsx), and two of them
 * render *different DOM trees* depending on the device (TopBar has separate
 * mobile/desktop layouts; ControlsHint renders nothing at all on touch). Hoisting
 * six refs up through HudFrame into App just so a tutorial can measure them
 * would couple the whole HUD to a feature that is on screen for twenty seconds
 * once. A `data-tour` marker is a flat contract instead: each component tags its
 * own outermost card, the tour queries for it, and a component that isn't
 * mounted right now simply isn't found (the tour holds its last known rect, or
 * falls back to a screen region — see NewbieTour's `useSpotlightRect`).
 *
 * The marker goes on the element whose *painted* box should be lit — the card
 * wrapper, not an inner button — since `getBoundingClientRect()` on it is
 * literally the shape of the hole cut into the dark.
 */
/**
 * THE ORDER OF THIS OBJECT IS THE ORDER OF THE TOUR, and the tour walks the
 * screen ANTICLOCKWISE: top-left, down the left rail, along the bottom, then up
 * the right edge. Every station is the next landmark you reach going that way
 * round, which is what makes six separate cards read as one lap of one screen
 * rather than six unrelated popups. Insert a new landmark where it physically
 * sits on the ring, not at the end. (NewbieTour.tsx's STEPS is the script; this
 * is the map it walks.)
 */
export const TOUR_TARGET = {
  /** TopBar's profile card, top-left. Station 1. */
  account: 'account',
  /** SideButtons' four-tag signpost column, left rail. Station 2. */
  toolbar: 'toolbar',
  /** NavBar's four-tab board, bottom-centre. Station 3. */
  nav: 'nav',
  /** LuckyWheel's corner launcher, bottom-right. Station 4. */
  wheel: 'wheel',
  /** ControlsHint's WASD card, right edge above the wheel (desktop only). Station 5. */
  move: 'move',
  /** ZoomControl's camera dial, right edge. Station 6, Admin Only. */
  camera: 'camera',
} as const;

export type TourTargetId = (typeof TOUR_TARGET)[keyof typeof TOUR_TARGET];

/** Spread onto the element that should be lit: `{...tourTag(TOUR_TARGET.account)}`. */
export const tourTag = (id: TourTargetId) => ({ 'data-tour': id });

/** The matching query the tour measures with. */
export const tourSelector = (id: TourTargetId) => `[data-tour="${id}"]`;

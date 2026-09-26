/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Single source of truth for camera-zoom (`uiScale`) limits and per-input step
 * sizes. Every input method that can change zoom - mouse wheel
 * (CameraController), the on-screen +/- buttons (ZoomControl), and touch
 * pinch (MobileControls) - imports these instead of hard-coding their own
 * copies, so all three always agree on range and can't silently drift out of
 * sync with each other.
 */
export const ZOOM_MIN = 0.5;
export const ZOOM_MAX = 2.0;

/**
 * The zoom at which the outdoor camera stops trailing the character and goes inside their head.
 *
 * Zoom is not just a distance: pushed to the last sliver of its range it becomes a MODE, and the
 * rig, the character controller and the companion all branch on it (CameraRig, Avatar,
 * Three/IslandPet). It lived as a bare `1.95` in four of those branches, which is one number that
 * had to be edited in four places and, worse, gave anything that needed to ASK "is this player in
 * first person?" nothing to ask.
 *
 * That question is the reason this is named: `uiScale` is persisted to localStorage, so a player
 * who left the camera zoomed all the way in is still in first person the next time they open the
 * game — including on the run where they are handed their first house.
 */
export const FIRST_PERSON_ZOOM = 1.95;

/**
 * Where the zoom is put when something needs to *guarantee* a third-person view.
 *
 * The bottom of the range rather than a step back from {@link FIRST_PERSON_ZOOM}: this is used
 * when the game has decided the player should be looking at their character (see AppContext's
 * first-home camera reset), and a camera parked one notch below the first-person cutoff is still
 * pressed against the back of their head.
 */
export const THIRD_PERSON_ZOOM = ZOOM_MIN;

/**
 * Where the camera starts handing over from the third-person orbit to first person.
 *
 * The handover is a RAMP, not a switch: over this band the orbit arm shortens to nothing, the
 * FOV opens out to the first-person lens, the focus point climbs from the chest to the eye and
 * the player's own body fades away. Every one of those used to spell its own `(uiScale - 1.5) /
 * 0.5` — a ramp that finishes at 2.0 while the MODE changes at {@link FIRST_PERSON_ZOOM} = 1.95.
 * See {@link firstPersonRamp} for what that five hundredths of a mismatch actually looked like.
 *
 * WHY IT IS 1.8 AND NOT 1.5 (「放大到 150 以上會有透視的感覺」). The third-person zoom spends
 * itself on BOTH distance (`7 / uiScale`) and lens (`35 / uiScale`), so zooming in makes the
 * lens progressively LONGER — 25° at 140%, 23° at 150% — and a long lens flattens perspective.
 * Crossing this constant reversed that: the FOV turned around and opened toward the 68°
 * first-person lens while the arm collapsed from 4.7 units to nothing, which is a dolly zoom —
 * the shot that holds a subject the same size on screen while its perspective visibly stretches.
 * At 1.5 that reversal reached 42° at 2.6 units by uiScale 1.7, with the body still 56% opaque,
 * so the player watched their own character stretch for the last third of the zoom range and
 * read it (correctly) as the picture going wrong rather than as a mode change.
 *
 * At 1.8 the whole span the player actually looks at their character from is one flat,
 * monotonically-lengthening lens, and the perspective only opens up over the last three wheel
 * notches — by which point the body is fading out and the shot is openly becoming first person.
 * The band stays wide enough to ramp through (0.15 = 3 wheel notches) rather than being a
 * switch, which is what {@link firstPersonRamp} exists to smooth. Nothing else needs editing to
 * follow it: the arm, the focus climb, the body fade and the FOV all read the ramp, and the
 * arm's own start distance is spelled `7.0 / FIRST_PERSON_RAMP_START` in CameraController.
 */
export const FIRST_PERSON_RAMP_START = 1.8;

/**
 * How far through the third-person → first-person handover a given zoom is: 0 while the camera
 * is still behind the character, 1 from the moment it is inside their head.
 *
 * IT ENDS ON {@link FIRST_PERSON_ZOOM}, and that is the whole reason it exists as a function
 * rather than as the four hand-written copies it replaces. Those ran to ZOOM_MAX (2.0) while the
 * first-person branch takes over at 1.95, so in that band the camera was already sitting inside
 * the skull with the head still being drawn at 10% opacity. From inside a head, the skull's own
 * faces point away and are culled, but the eyes, the mouth and the blush do not — which is
 * exactly the reported 「放大成第一人稱只剩五官浮在空中」. A ramp and a mode change that describe
 * the same transition have to end on the same number, so they now read it from the same place.
 */
export function firstPersonRamp(uiScale: number): number {
  if (uiScale <= FIRST_PERSON_RAMP_START) return 0;
  if (uiScale >= FIRST_PERSON_ZOOM) return 1;
  return (uiScale - FIRST_PERSON_RAMP_START) / (FIRST_PERSON_ZOOM - FIRST_PERSON_RAMP_START);
}

/**
 * How visible the player's own body is at a given zoom: fully solid in third person, and
 * completely gone by the time the camera reaches the eye. The inverse of the ramp above, named
 * because that is what the one caller (Three/Avatar.tsx) is actually asking for.
 */
export function avatarZoomOpacity(uiScale: number): number {
  return 1 - firstPersonRamp(uiScale);
}

/** uiScale change per wheel-event tick. */
export const WHEEL_ZOOM_STEP = 0.05;

/** uiScale change per +/- button click. */
export const BUTTON_ZOOM_STEP = 0.1;

/** uiScale change per pixel of pinch-distance delta (two-finger touch). */
export const PINCH_ZOOM_SENSITIVITY = 0.0035;

export function clampZoom(value: number): number {
  return Math.max(ZOOM_MIN, Math.min(value, ZOOM_MAX));
}

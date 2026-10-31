/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Screen-space keep-out margins for the world-tracked InteractionPrompt
 * badge (src/components/UI/InteractionPrompt.tsx). The badge is projected
 * from a 3D position each frame and then clamped so it never drifts under the
 * persistent HUD chrome placed by the grid frame (HudFrame.tsx): the left
 * rail (TopBar/MiniMap + SideButtons), the right-side ZoomControl, the
 * top-centre banners, and the bottom NavBar.
 *
 * Centralised here (instead of as magic numbers inside the component) so the
 * clamp stays conceptually tied to the HUD layout — the interactable is
 * always within a few metres of the player, so the projected point is
 * normally well inside this safe zone and these only guard rare edge cases
 * (wide FOV, a door near the frustum edge). Values are conservative upper
 * bounds on each cluster's footprint across breakpoints.
 */
export const PROMPT_SAFE_MARGIN = {
  left: 110,   // clears the left rail (SideButtons column + edge inset)
  // Back to 100 now that 幸運轉盤 (UI/LuckyWheel.tsx) is a ~68px corner icon rather than the
  // 148–224px disc it briefly was: that disc is why this was widened to 180, and it no longer
  // exists — the wheel opens as a modal instead, which is on the z-modal tier and covers this
  // badge outright. The launcher sits inside the bottom/right corner these two margins already
  // reserve for the NavBar dock and the zoom dial.
  right: 100,  // clears the right-side ZoomControl dial + edge inset
  top: 100,    // clears the top-centre banner band
  bottom: 170, // clears the bottom NavBar dock
} as const;

/**
 * The footprint two world-anchored badges must keep apart — the E badge
 * (UI/InteractionPrompt.tsx) and the Q light-switch badge (UI/LightSwitchPrompt.tsx).
 *
 * Both are the same HintBubble (a ~50px card plus its arrow, drawn upward from
 * its anchor), and both can be live at once: standing at the sofa under the
 * switch, E sits and Q turns the lights off. When their anchors project within
 * this box of each other the tracker stacks the Q badge on top of the E one
 * instead of letting the two cards overlap. Width is the two badges'
 * half-widths summed with a gap, for the longest labels the game shows.
 */
export const PROMPT_BADGE_STACK = {
  height: 60,
  halfSpan: 170,
} as const;

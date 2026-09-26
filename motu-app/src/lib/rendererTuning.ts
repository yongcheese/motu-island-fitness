/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import type { WebGLRenderer } from 'three';

/**
 * The URL flag that puts shader validation back. `?shaderdebug` on any page.
 *
 * It exists because {@link tuneRenderer} turns off the only thing that reports a broken shader.
 * Anyone editing `onBeforeCompile` (floorMaterial.ts, Island.tsx, Fish.tsx, EffectField.tsx) or
 * the ShaderMaterial in Fireflies.tsx needs that report, and a silently black material is a much
 * worse afternoon than a 2-second hitch.
 */
const SHADER_DEBUG_FLAG = 'shaderdebug';

/**
 * Applied to every `<Canvas>` in the game, and the reason crossing the front door no longer
 * freezes on a black screen for two or three seconds.
 *
 * ## What was actually happening
 *
 * Entering the house mounts a SECOND `<Canvas>` (App.tsx's view overlays; the island's own Canvas
 * stays mounted and is only stopped with `frameloop='never'`). A new Canvas is a new WebGL
 * context, and a new context has no compiled programs — so on its first frame it compiles and
 * links every shader the interior needs, from scratch, every single time the player walks in.
 *
 * A CPU profile of the entry (headless, software renderer, so the absolute numbers are inflated
 * but the shape is honest) attributed a ~4s stall like this:
 *
 *   1472ms  getShaderInfoLog
 *   1333ms  (program)          — the driver's own compile/link work
 *    542ms  getProgramInfoLog
 *    529ms  getContext         — creating the second context
 *    169ms  new WebGLRenderer
 *
 * The two info-log calls are the interesting half, because they are not the compile: they are
 * three.js CHECKING the compile. `renderer.debug.checkShaderErrors` defaults to true, and reading
 * a program's info log forces the driver to finish compiling and linking before it can answer —
 * a synchronous flush, on the main thread, once per program. With the check off, three.js stops
 * asking, the driver is free to compile programs in parallel on its own threads, and the main
 * thread stops blocking on it.
 *
 * ## What this does NOT fix
 *
 * The context creation and the driver's compile work are still there; this removes the part that
 * was serialising them onto the main thread. If the remaining hitch is still visible, the next
 * step is to stop destroying the interior context on exit (keep the Canvas mounted and hidden),
 * which is a bigger change and is why it is not in here.
 */
export function tuneRenderer(gl: WebGLRenderer): void {
  const debugShaders =
    typeof window !== 'undefined' &&
    new URLSearchParams(window.location.search).has(SHADER_DEBUG_FLAG);

  gl.debug.checkShaderErrors = debugShaders;
}

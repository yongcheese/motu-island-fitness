/**
 * Environment (IBL) maps, served from this project's own `public/` folder.
 *
 * drei's `<Environment preset="..." />` is a convenience wrapper that fetches the
 * matching HDR from `raw.githubusercontent.com/pmndrs/drei-assets` at runtime.
 * That host rate-limits by IP and answers with a 429 once the limit is hit, and
 * because `<Environment>` loads through Suspense the rejected fetch is rethrown
 * during render - React unwinds to the nearest error boundary and the ENTIRE
 * game goes to the crash screen. A third party's rate limiter must not be able
 * to decide whether this game boots, so the three presets in use are vendored
 * into `public/hdri/` and referenced by path instead:
 *
 *   preset="sunset"    -> venice_sunset_1k.hdr
 *   preset="apartment" -> lebombo_1k.hdr
 *   preset="city"      -> potsdamer_platz_1k.hdr
 *
 * These are the exact files the presets resolved to, so the lighting is
 * unchanged. Paths are absolute (`/hdri/...`) because Vite serves `public/`
 * from the site root in dev and copies it to `dist/` on build - see server.ts,
 * which hands `dist/` to express.static in production.
 *
 * To add another preset: look up its filename in drei's `presetsObj`, download
 * it into `public/hdri/`, and add it here. Never reach for `preset=` again.
 */

/** Outdoor golden-hour light. Used by the island scene. */
export const HDRI_SUNSET = '/hdri/venice_sunset_1k.hdr';

/** Soft indoor light. Used by building interiors. */
export const HDRI_APARTMENT = '/hdri/lebombo_1k.hdr';

/** Neutral overcast street light. Used by the fitness demo figure. */
export const HDRI_CITY = '/hdri/potsdamer_platz_1k.hdr';

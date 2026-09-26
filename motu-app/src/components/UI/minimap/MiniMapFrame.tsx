/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import type { ReactNode } from 'react';

/**
 * The minimap bezel: a low-poly wooden ship's wheel with a brass-riveted rim,
 * and a hanging plank under it for the room you're standing in.
 *
 * WHY IT LOOKS LIKE AN OBJECT. The old map was a rounded cream rectangle with
 * a title row — correct tokens, no personality, and the one piece of HUD that
 * didn't read as something you'd find on the island. This follows
 * DESIGN_SYSTEM.md's "change the construction, not the colour": the shape
 * carries it. Sixteen flat facets rather than a smooth ring (so it reads
 * carved, and matches the game's low-poly models), eight turned handles, eight
 * rivets, a shadowed inner lip the map sinks behind, and a lit top edge —
 * light comes from above, as it does everywhere else in this HUD.
 *
 * PALETTE — a documented art exception, like QVersionIcon's wood grain and the
 * floor/wall material swatches (see DESIGN_SYSTEM.md § Documented exceptions).
 * These four tones depict weathered driftwood; they are not chrome, and no
 * other component may reach for them. Everything *functional* about this
 * component — the map inside, the nameplate's ink and live dot, the shadow
 * family, the radius scale — stays on the island tokens. The tones are
 * deliberately desaturated: a saturated oak would fight the muted teal/cream
 * HUD it sits in, which is the same mistake the pre-2026-07 amber chrome made.
 */
const WOOD = ['#E3CDA9', '#D2B68C', '#BE9E72', '#A2825A'] as const;
const WOOD_EDGE = '#8A6B47';
const RIVET = '#F3EFE6';

// --- Wheel geometry, in the bezel's own 0-100 viewBox -----------------------
const C = 50;
const R_HANDLE = 50.5; // outer tip of the turned handles
const R_OUT = 47;      // outer edge of the rim
const R_IN = 38.6;     // inner lip — the map's own edge sits here
const FACETS = 16;
const HANDLES = 8;

/**
 * Fraction of the bezel's width taken by the map window. Derived from R_IN, so
 * the hole and the drawing can't drift apart: change R_IN and the map follows.
 */
const MAP_INSET_PCT = 50 - R_IN;

const pt = (r: number, a: number) => `${(C + r * Math.cos(a)).toFixed(2)},${(C + r * Math.sin(a)).toFixed(2)}`;

// Angles run clockwise from straight up, matching the map's own heading
// convention, so a facet's shading and a marker's bearing are described the
// same way.
const angleAt = (turns: number) => turns * Math.PI * 2 - Math.PI / 2;

// One flat quad per facet. Precomputed at module load: this is a fixed
// silhouette, not something that depends on props or state.
const RIM_FACETS = Array.from({ length: FACETS }, (_, i) => {
  const a0 = angleAt(i / FACETS);
  const a1 = angleAt((i + 1) / FACETS);
  // 1 at the top of the wheel, -1 at the bottom: the wood is lit from above.
  const lit = -Math.sin((a0 + a1) / 2);
  // The parity term is what keeps it reading as *facets* rather than a smooth
  // gradient — adjacent panels of carved wood never catch the light equally.
  const tone = Math.min(3, Math.max(0, Math.round((1 - lit) * 1.4) + (i % 2)));
  return {
    points: `${pt(R_OUT, a0)} ${pt(R_OUT, a1)} ${pt(R_IN, a1)} ${pt(R_IN, a0)}`,
    fill: WOOD[tone],
  };
});

const RIM_OUTLINE = Array.from({ length: FACETS }, (_, i) => pt(R_OUT, angleAt(i / FACETS))).join(' ');

// The turned handles a helmsman grips. Drawn under the rim so they emerge from
// beneath it rather than sitting on top like stickers.
const WHEEL_HANDLES = Array.from({ length: HANDLES }, (_, i) => {
  const a = angleAt(i / HANDLES);
  // Perpendicular to the spoke, for the handle's half-width.
  const px = -Math.sin(a);
  const py = Math.cos(a);
  const at = (r: number, half: number, sign: number) =>
    `${(C + r * Math.cos(a) + px * half * sign).toFixed(2)},${(C + r * Math.sin(a) + py * half * sign).toFixed(2)}`;
  return {
    // Slightly tapered toward the tip — a lathe-turned peg, not a matchstick.
    points: `${at(R_OUT - 5, 3.1, 1)} ${at(R_HANDLE - 2.2, 2.3, 1)} ${at(R_HANDLE - 2.2, 2.3, -1)} ${at(R_OUT - 5, 3.1, -1)}`,
    capX: C + (R_HANDLE - 2.2) * Math.cos(a),
    capY: C + (R_HANDLE - 2.2) * Math.sin(a),
    lit: -Math.sin(a),
  };
});

// Brass rivets, set between the handles so the rim never looks crowded.
const RIVETS = Array.from({ length: HANDLES }, (_, i) => {
  const a = angleAt((i + 0.5) / HANDLES);
  const r = (R_OUT + R_IN) / 2;
  return { x: C + r * Math.cos(a), y: C + r * Math.sin(a) };
});

export function MiniMapFrame({
  label,
  children,
}: {
  /** Contents of the nameplate hanging under the wheel. */
  label: ReactNode;
  /** The map window itself — sized and positioned by this component. */
  children: ReactNode;
}) {
  return (
    <div
      className="relative"
      style={{ width: 'var(--minimap-w)', height: 'var(--minimap-h)' }}
    >
      <div className="relative" style={{ width: 'var(--minimap-w)', height: 'var(--minimap-w)' }}>
        {/* The bezel's shadow is a drop-shadow FILTER, not a box-shadow: this
            silhouette has eight handles poking out of a sixteen-sided ring,
            and a box-shadow would trace the square bounding box instead of
            the wheel. Same rule as .notch-shadow* for clipped chrome — see
            DESIGN_SYSTEM.md. */}
        <svg
          viewBox="0 0 100 100"
          className="absolute inset-0 h-full w-full"
          style={{ filter: 'drop-shadow(0 10px 18px rgba(38,70,83,0.30))' }}
        >
          {WHEEL_HANDLES.map((h, i) => (
            <g key={`handle-${i}`}>
              <polygon points={h.points} fill={h.lit > 0 ? WOOD[1] : WOOD[2]} />
              <circle cx={h.capX} cy={h.capY} r={2.3} fill={h.lit > 0 ? WOOD[0] : WOOD[1]} />
            </g>
          ))}

          {RIM_FACETS.map((f, i) => (
            <polygon key={`facet-${i}`} points={f.points} fill={f.fill} />
          ))}
          <polygon
            points={RIM_OUTLINE}
            fill="none"
            stroke={WOOD_EDGE}
            strokeWidth={0.8}
            strokeLinejoin="round"
            opacity={0.45}
          />

          {RIVETS.map((r, i) => (
            <g key={`rivet-${i}`}>
              <circle cx={r.x} cy={r.y} r={1.7} fill={RIVET} />
              <circle cx={r.x} cy={r.y} r={1.7} fill="none" stroke={WOOD_EDGE} strokeWidth={0.5} opacity={0.55} />
            </g>
          ))}

          {/* Inner lip: a shadowed groove the map sinks into, with a lit
              hairline just inside it. Two tiers of edge, never one flat
              stroke — the same reason the Toolbar's track has both. */}
          <circle cx={C} cy={C} r={R_IN + 0.9} fill="none" stroke={WOOD_EDGE} strokeWidth={2} opacity={0.5} />
          <circle cx={C} cy={C} r={R_IN - 0.5} fill="none" stroke="#FFFDF6" strokeWidth={0.9} opacity={0.8} />
        </svg>

        <div className="absolute" style={{ inset: `${MAP_INSET_PCT}%` }}>
          {children}
        </div>
      </div>

      {/* Nameplate — a small plank hung off the bottom of the wheel, carrying
          the one piece of live text the map needs. It overlaps the rim rather
          than floating below it, so the whole thing stays one object. */}
      <div className="absolute bottom-0 left-1/2 flex max-w-[86%] -translate-x-1/2 justify-center">
        <div
          className="flex items-center gap-1.5 rounded-full border px-3 py-1 shadow-[0_4px_10px_rgba(38,70,83,0.22)]"
          style={{ background: WOOD[0], borderColor: WOOD_EDGE }}
        >
          {label}
        </div>
      </div>
    </div>
  );
}

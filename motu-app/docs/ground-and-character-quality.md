# 地表與人物質感 — the ground/character quality pass

*2026-09-12*

The island's two largest visual elements — the lawn the whole scene stands on, and the character
standing on it — were both built early and never revisited. This pass rebuilt how each is shaded
and how the lawn is populated, without changing the game's soft low-poly direction, and without
moving a single walkable surface.

---

## 1. What was actually wrong

Five root causes, none of which was "not enough stuff".

### The plateau was one flat fill

`Island.tsx` drew the walkable surface as a single disc carrying a two-stop radial vertex colour
(`PLATEAU_INNER_COLOR` → `PLATEAU_OUTER_COLOR`). At the gameplay camera that is a flat circle of
colour. Indoors this problem had been solved long ago — `floorMaterial.ts` gives the oak floor
planks, grain and knots — but nothing equivalent existed outdoors.

### The lawn's density was uniform

520 identical `BoxGeometry(0.04, 0.6, 0.04)` blades scattered with `sqrt(random()) * 5.1`. Uniform
noise is not nature; it is static. Every part of the lawn had exactly as much grass as every other
part, so there was no near / mid / far reading anywhere on the island. Half of every blade was also
below the plateau — the geometry was 0.6 tall, centred on the ground plane.

### The grass stopped at a circle

Blades ended at r 5.1, the plateau's own edge is at 5.7, and the sand cone starts at 5.93. That
left a ring of bare flat green all the way round the island, then a hard line into the beach.

### The character was six primitives with nothing between them

A 0.26 sphere, a 0.135 capsule, two 0.04 capsules and two 0.055 capsules — and no joint geometry
anywhere. Measured on `LEGACY_SKELETON`:

| join | what the silhouette actually did |
|---|---|
| head / torso | the skull is sunk 11.5 cm into the torso and is **wider** than it everywhere they overlap, so the outline crosses at y≈0.468 as a hard notch |
| shoulder | the pivot sits 4.5 mm **outside** the torso surface — an arm hanging off the side of a pill |
| hip | the hips are 3.5 cm above the capsule's bottom **tip**, where it has narrowed to 3.6 cm — two 5.5 cm thighs emerging from a point narrower than either |

Note what the head/torso problem is *not*: a missing neck. A neck drawn between those two surfaces
would be entirely inside both of them.

### The character could not receive shadows

Every body mesh set `castShadow` and **none** set `receiveShadow`. The character threw a shadow on
the lawn and received none — not from the house, not from a tree, and above all not from itself. No
shadow under the chin, none from an arm across the chest, none under the hips. Parts that overlap in
space but never in light is most of what 「零件拼接」 means.

---

## 2. The systems this added

```
lib/groundField.ts ──────────┬──> Three/groundMaterial.ts   (texture, per fragment)
  地表變化場 · ONE field      └──> lib/groundCoverBuild.ts   (JS, per instance)
                                     └──> Three/GroundCover.tsx
                                            driven by constants/groundCover.ts

character/bodySurface.ts     the character's lighting, applied by traversal
constants/characterForm.ts ──> character/bodyForm.tsx    the joins, as data per model
```

### `lib/groundField.ts` — one answer to "what is the ground like here?"

Two channels (`lush`, `wear`) over a 128² grid covering the island in **local** island units, so the
pattern grows with the territory rather than the island sliding across a fixed field.

Both consumers read the same data, and that is the whole point: **a tuft stands where the ground is
already drawn lush**, and a bare patch in the shader is a bare patch in the scatter. Two private
noise functions would have produced mottling that does not line up with the plants, which reads as
dirt *under* the grass and is worse than no mottling.

It is a generated **texture** rather than shared GLSL because `proceduralNoise.ts`'s hash
(`fract(p.x * p.y)` after a self-dot) diverges between float32 on a GPU and float64 in JS long
before the fifth octave. 64 KB, built once, exact on both sides.

Two tuning notes worth keeping:

* The remap window is **narrower than the signal**. A three-octave value-noise fbm is tightly
  clustered (90% between 0.35 and 0.68); a window spanning that whole range produces a uniform
  mid-grey field with no patches at all — the flat lawn again in a different costume.
* There is a small **inland lift** (`shelter`). Pure noise has no idea where the island is, and this
  seed drew its centre bald — the one part always on screen was its thinnest.

### `Three/groundMaterial.ts` — the surfaces, procedurally

The sibling of `floorMaterial.ts` / `wallMaterial.ts`. Three grades: `plateau`, `mound`, `shore`.
The island's existing greens still arrive as `diffuseColor`; everything here modulates them, so the
island is the same colour it always was — it just stops being exactly one colour everywhere.

It moves no vertices. The plateau is the surface `getIslandSurfaceY` swears is flat, and displacing
it would put the drawn ground somewhere the walk height is not. The relief is entirely in the
**normal**, tilted by the field's own gradient — lighting reads it, collision cannot.

Three spatial scales, spent at three distances:

| scale | frequency | drawn |
|---|---|---|
| broad | the shared field | always — the tufts are scattered by it |
| mid | ~1.5 cycles/unit | always; too coarse to alias |
| fine | ~7 cycles/unit | faded out between 9 and 26 units from camera |

The fine grain's distance fade is what answers 「近景有細節、遠景乾淨」 *and* prevents shimmer: high
frequency noise on a minified surface aliases, and a lawn that fizzes as the camera moves is a worse
defect than a lawn that is slightly plain.

The plateau also grades its last 1.1 units toward damp sand, overlapping the grass's own thinning,
so the sequence reading outward is grass → thinning grass on paling green → sand-tinted soil → the
sand cone. That is a beach instead of a drawn circle.

### `constants/groundCover.ts` + `lib/groundCoverBuild.ts` + `Three/GroundCover.tsx`

Three layers, which are three **distances** rather than three plants:

| layer | role | count @L1 | tris each |
|---|---|---|---|
| `tuft` | the carpet | 1150 | 36 |
| `clump` | the mid-ground mass; the only layer that casts a shadow | ~61 | 68 |
| `frond` | the accent, in the lushest spots only | ~32 | 36 |

Density is stated as a **response to the field** (`lushThreshold`, `lushExponent`, `wearPenalty`),
never as a position. Adding a kind of ground plant is a row in the config.

Two shapes that had to be found by looking rather than by reasoning:

* A **flat wide clump** (0.65 m across, 0.2 m high) reads as a hole in the lawn.
* A **rounder taller clump** reads as a mossy boulder — a faceted lump with no silhouette of its own
  is exactly what a low-poly rock is, and the island's outcrops are built from the same primitive.
  What separates a plant from a rock at this polygon count is the **broken outline**, so the clump
  is now a small nearly-buried base with four blades fanning out of it.
* A tuft whose blades stand near-vertical is a bulrush. The splay is the difference.

### `character/bodySurface.ts` — the character's lighting

A **traversal**, not a material factory, and that is the load-bearing decision. A factory only
reaches surfaces whose authors remembered to call it, so the day an imported GLB head is dropped in
it would stop being shaded like the body — and nothing would fail, it would just look wrong. This
walks whatever is under the character root: legacy's capsules, v2's, an imported model's, the
wardrobe's sixty-odd pieces, a hat added next year.

Three terms, all after lighting:

1. **AO by facing** — a downward-pointing normal receives almost no sky, so every overhang darkens
   under itself. This is what turns six primitives into one body, and it is what draws the chin
   shadow the missing neck cannot.
2. **Warm bounce** across the terminator — the single most recognisable thing about drawn character
   shading, and on skin also literally true.
3. **Cool fresnel rim** — silhouette separation, kept low (0.16) so the character does not read as a
   plastic toy under a studio light.

It also turns `receiveShadow` on, which is the bigger half of the change.

Materials that already carry their own `onBeforeCompile` are skipped — the hair system caches its
materials at module scope and shares them with the shop's thumbnails, so patching one would destroy
its root-to-tip gradient *and* leak character lighting into the shop.

### `constants/characterForm.ts` — the joins, as data

A model declares its joins the way it already declares its skeleton and sockets. Legacy declares
three; `v2` and `authored` declare none and are completely unaffected. Every entry states its
clearance against `LEGACY_WEARABLE_FIT`, because "it looked fine on a bare avatar" is how a shoulder
ends up poking through a jacket.

| fill | what it closes | clearance |
|---|---|---|
| `shoulderYoke` | the head/torso notch, by giving the body shoulders for the head to sit between | 1.2 mm inside the top garment |
| `pelvis` | two thighs emerging from a point | 4.5 mm inside a trousered thigh |
| `deltoid` | the arm root, and it rotates **with** the arm so the join stops changing shape mid-swing | 2.5 mm inside the sleeve |

---

## 3. Shadows

`Scene.tsx`'s directional light gained four settings, all needed once anything self-shadows:

* `shadow-camera-near/far` 5..70, replacing the default 0.5..500 over a scene whose content sits
  between 15 and 45 units from the light — a straight ~7x gain in depth precision, for free.
* `shadow-bias` / `shadow-normalBias`, without which the skull's own shadow lands on the skull as a
  band of stripes. `normalBias` is the one that matters on spheres and capsules.

The interior rig already had equivalent settings; the dressing room was checked visually and is
clean.

---

## 4. Budget

Measured in the running game (guest island, territory level 1, no placements) by counting
`drawElements`/`drawArrays`/`*Instanced` on the GL context, per island render:

| | measured, after | derived, before |
|---|---|---|
| draw calls | **235** | ~232 |
| triangles | **215 886** | ~175 000 |
| the lawn's share | **~47 000** in 4 draws | 6 240 in 1 draw |

Only the "after" column was measured. The "before" column is that measurement minus the lawn's own
contribution plus the old lawn's (520 boxes × 12 triangles, one InstancedMesh, no shadow pass) —
sound only because nothing else in the scene changed, and stated this way rather than as a
measurement because it is not one.

The first build of the lawn drew **82 000** triangles — more than the entire rest of the island put
together — and nothing anywhere failed, because a number that only shows up in a GPU profile is a
number nobody checks. That is why `npm run audit:groundcover` exists: it builds the same geometry
the game builds, runs the same scatter, and fails on the triangle ceiling, the draw-call ceiling,
the field's percentile spread, the shoreline fade, the Home keep-out and the scatter's determinism.

Per frame the lawn costs **two uniform writes** (the wind clock and its weather gain). The sway is
entirely in the vertex shader; the character's shading adds no per-frame work at all.

---

## 5. Rules for anyone extending this

* **The plateau may not be displaced.** `getIslandSurfaceY` is the contract between the art and the
  collision (see `constants/terrain.ts`). Relief goes in the normal.
* **The scatter and the material must read the same field.** If they diverge, plants grow on bare
  earth.
* **Grading is variation, not a new base colour.** The field's mean sits near 0.5, so a strong
  grade does not vary the island's green — it replaces it. The first tuning ran the dry end at 0.5
  and the island came out the colour of dry hay.
* **A model declares its own joins, or none.** Nothing in `characterForm.ts` may be assumed by a
  future model.
* **Re-run `npm run audit:groundcover` after touching any layer, the field's remap window, or a
  blade's tessellation.**

## 6. The harness

`tmp-lawn.html` renders the real terrain meshes, the real materials, the real `GroundCoverField` and
the real character model under `Scene.tsx`'s SUNNY rig verbatim, with the camera on query params
(`?dist=&elev=&az=&fov=&ty=&target=&char=&grass=&outfit=`). The game's own weather cycles through
midnight and storm, so judging ground colour in it is guesswork; this is where every tuning decision
above was actually made.

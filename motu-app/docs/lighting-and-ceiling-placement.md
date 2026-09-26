# 燈具 / Lighting fixtures and the ceiling mount

Three things landed together, and they are separable:

1. **A 燈具 shelf.** The lamps came out of 裝飾 into a category of their own.
2. **A ceiling placement surface.** `mounts: ['ceiling']` had been declared in the catalog for a
   year and nothing resolved it, so the four pendant lights could not be put down at all. The
   ceiling is now a surface the placement system understands, alongside floor, wall and tabletop.
3. **Fixtures joined the existing light switch.** Every lamp used to carry its own permanently-on
   `<pointLight>`, so a room with five of them did not go dark when the wall switch was thrown.

## Where things live

| File | What it owns |
| --- | --- |
| `src/constants/placement.ts` | The vocabulary: `PlacementMount` (`floor` / `surface` / `wall` / `ceiling`). |
| `src/constants/interiorShell.ts` | Where the ceiling is: `INTERIOR_CEILING_SURFACE_Y`, `CEILING_BEAMS`, `ceilingSurfaceAt`. |
| `src/lib/interiorPlacement.ts` | The rule: a pointer ray → an attachment, and whether it is legal. |
| `src/constants/lighting.ts` | `LightingSpec` — what a fixture's light IS, as product data. |
| `src/components/Three/FixtureLight.tsx` | The one component every light-emitting model renders. |
| `src/lib/interiorLights.ts` | The house switch. Unchanged — fixtures are new readers of it. |

## Placement type is per item, not per category

Nothing anywhere asks whether an item is a lamp. It asks what the item **mounts to**, and the
answer is one field on the catalog row:

| Placement type | Declared as | 燈具 using it |
| --- | --- | --- |
| Ceiling | `placement: { mounts: ['ceiling'] }` | 水晶吊燈, 工業風吊燈, 現代簡約吊燈, 自然/木質吊燈 |
| Wall | `placement: { mounts: ['wall'], hangHeight }` | 溫馨壁掛燈 |
| Floor / tabletop | *(absent → `DEFAULT_PLACEMENT`)* | 檯燈, 弧形立燈, 石製路燈, 復古提燈, 螢光石燈, 部落火把, 竹製手電筒 |

`DEFAULT_PLACEMENT` is `['surface', 'floor']`, so the last row needs no declaration at all: point
at a tabletop and the lamp stands on the tabletop, point past its edge and it stands on the floor
behind. A lamp too big for the table it was aimed at falls through to the floor rather than being
refused — the fit test is measured off the two footprints, so 弧形立燈 declines a side table and
檯燈 accepts one without either of them saying so.

**A new ceiling decoration — a hanging plant, a mobile, bunting — needs one field.** `mounts:
['ceiling']` and it is placeable, snapped, collision-checked and saved. There is no lamp-specific
code in any of it.

## The ceiling surface

`ceilingSurfaceAt(x, z, rooms)` returns the underside of the lowest solid thing overhead, or `null`
outside the house. Two heights, and the difference matters:

- **4.87** — the ceiling plate's underside, over most of a room.
- **4.80** — the underside of a beam. Three cross every room (`CEILING_BEAMS`).

`null` is what makes 「outside the house」 a refusal (`noCeiling`) rather than a lamp over the void: a
ceiling mount has no fallback surface the way a floor piece has the ground.

`INTERIOR_CEILING_Y` (4.80) is deliberately *not* the mount plane. It is the lowest thing overhead
anywhere, which is right for collision and wrong for mounting — under bare plate it would leave a
pendant hanging 7 cm below the ceiling in mid-air.

## What a ceiling mount computes

Given the point the player aimed at:

- **Drop.** The piece's own measured `maxY` is placed `CEILING_MOUNT_GAP` (2 cm) below the surface.
  Same shape as the wall's standoff rule, one axis over: a deeper ceiling rose hangs exactly its own
  extra depth lower, with no per-item number. The 2 cm is not cosmetic — a top face laid *on* the
  ceiling plane is two coplanar depth-writing surfaces, the one overlap depth precision can never
  order (`npm run audit:zfighting`).
- **Which surface.** The *lowest* over the piece's whole box, not just its anchor point, so a
  pendant straddling a beam hangs from the beam instead of driving a corner of its rose into it.
- **Extent.** Clamped to the room's inner floor plan on the piece's world-axis extents, so a wide
  or turned fixture cannot be left half inside a wall.
- **Headroom.** Refused (`noFit`) if the piece would reach below `CEILING_MOUNT_MIN_CLEARANCE`
  (2.0). A ceiling-layer piece is invisible to the walk resolver by design — that is what lets you
  walk under a chandelier — so anything that came down into the walk band would be something a
  player expects to bump into and cannot.
- **Facing** is the player's, unlike a wall. A wall has a normal, so a picture on it has exactly one
  correct facing; a ceiling's normal says nothing about yaw, and 現代簡約吊燈 is a row of three
  tubes that plainly has a right way round over a table. The 旋轉 control stays.

## Two ways to aim, one result

```
選擇【燈具】→ 選一盞吊燈 → 進入擺放模式 → 點天花板 → 吸附 → 確認
```

The resolver takes **either** reading of 「point at where you want it」:

1. The ray crosses the ceiling plane inside a room — aiming at the ceiling.
2. The ray meets the floor inside a room — the ceiling directly above that spot.

(2) is not a convenience, it is what makes the mount usable. Both interior cameras sit *below* the
ceiling (the build camera is fixed at 3.6 under a 4.87 ceiling) and spend most of their time
looking level or down, so a ray that crosses the ceiling going up only exists while the player is
deliberately craning the view upward — and then the floor the lamp should hang over is off screen.
Neither reading can produce an illegal placement: a ceiling piece's height comes from the ceiling
either way, so there is no aim that leaves one standing on the ground.

Feedback while holding one, all through the shared `PlacementDock`:

| State | What the player sees |
| --- | --- |
| Nothing aimed yet | hint 「點擊天花板以安裝燈具，或點地板上想吊掛的位置」 |
| Snapped | ok 「已裝上天花板・點其他位置可以移動」, plus an amber plate drawn on the ceiling above the piece |
| Outside the house | blocked 「這盞燈要裝在天花板上，把游標移回房間裡面」, coral plate, 確認 disabled |
| Overlapping another fixture | blocked, naming the piece already there |

The on-ceiling plate is doing more work than the wall's equivalent: a pendant hangs a metre below
the surface it is fixed to, so without a marker up there the player is looking at a lamp floating in
mid-air with no indication of what holds it.

## The lighting seam

A fixture's light is **product data**; where the bulb sits is **geometry**.

```ts
// constants/items.ts
lighting: { behaviour: 'switched', intensity: 0.75, range: 7, color: '#ffeecb' }
```

```tsx
// the model — no lighting logic of its own
<FixtureLight item={item} position={[0, -0.9, 0]}>
  <mesh …>…the glowing bulb…</mesh>
</FixtureLight>
```

`FixtureLight` reads the same eased `interiorLights.level` the ambient light, the sun, the
environment map, the exposure, the per-room ceiling light and the candle already read. There is no
second on/off system, and no per-lamp component.

The bulb goes *inside* it because a lamp that is off is not a lamp with its point light turned down
— it is a lamp with a dark bulb, and emissive is unlit by definition, so nothing else in the scene
can dim it. Only emissive materials in the children are touched; a shade or a cord passes through.

### A fixture's light is turned DOWN, never hidden

`FixtureLight` drives `intensity` and never touches `visible`, and that is load-bearing rather than
stylistic. three.js compiles *how many point lights are in the scene* into every material's shader
(it is part of `WebGLPrograms`' cache key), so hiding a light does not save a light — it changes
the scene's light count and forces every material being drawn to recompile against the new one.
That recompile is a visible freeze on the frame the switch is flipped.

Fixtures are the worst case for it, because a lamp is the item players place the most of per room:
a decorated room hid several point lights at once and recompiled the whole room for it. Measured on
`tmp-ceiling-light.html` with six `switched` fixtures — **6 program links per toggle when the
component hid its light, 0 when it only turns it down.**

`PlayerFollowLight` and `CandleGlow` follow the same rule for the same reason; the long version is
at the top of `Three/InteriorLighting.tsx`. The cost is a few zero-intensity lights staying in the
per-pixel light loop, which is unmeasurable per frame and buys back a stall you can see.

### Two behaviours, and why not one

| `behaviour` | Meaning | Items |
| --- | --- | --- |
| `switched` | Follows the switch. Fades out with the room, forced on in build mode. | the four pendants, 檯燈, 弧形立燈, 石製路燈, 帳篷風格床's fairy lights |
| `always` | Burns whatever the switch says. | 螢光石燈, 部落火把, 復古提燈, 竹製手電筒, 香氛蠟燭, 火把, **溫馨壁掛燈** |

Two different reasons a fixture is `always`, and the field expresses both:

- **It has no wire.** The catalog had already answered this before the question was asked: 螢光石燈
  is 「無需能源也能恆久發光」, 部落火把 burns 「永不熄滅的靈魂之火」, 復古提燈 is an oil lamp,
  竹製手電筒 runs off a battery. Switching those off from a wall plate would contradict the product
  the player bought.
- **It is meant to stay on.** 溫馨壁掛燈 is on the house wiring like any other sconce and is
  `always` anyway, because it is the room's night light: 「照亮黑夜」 is what its own card promises,
  and a room that goes completely dark but for the candle in the player's hand gives that promise
  nowhere to land. Being the only fixture mounted at eye level on a wall is what makes it the right
  one to hold back.

That second case is why the value is named `always` rather than `selfPowered` — it states what the
switch does, which is all any reader needs, without dressing a design decision up as a fact about
batteries. A room lit only by torches, glowstones and the sconce on the wall is a thing worth being
able to build.

Note the light and the shelf are independent statements. 香氛蠟燭 and 帳篷風格床 both emit light and
neither is a 燈具; the three 光色溫 swatches are on the 燈具 shelf and emit nothing. `isLightFixture`
asks the item, never the shelf.

## Guards

| Command | What it would catch |
| --- | --- |
| `npm run audit:placements` | A fixture driven into the ceiling, floating below it, hung through a beam, reaching into the walk band, hung outside the house, or overlapping another. 36 checks across the four pendants, through the shipping resolver against footprints measured from the shipping models. |
| `npm run audit:shop` | A model holding a raw `<pointLight>` outside the lighting system; a product that declares a light and draws none; a model asking for a `FixtureLight` its row cannot configure. |
| `tmp-ceiling-light.html` | The picture. The house interior is not reachable on the guest path, so this builds a real room from the real shell constants and places every fixture through the shipping resolver. `?dark=1` starts with the lights off. |

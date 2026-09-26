# 藝術品 / Artwork

Two things landed together, and they are separable:

1. **A placement vocabulary.** An item now declares what kind of surface it attaches to — floor,
   tabletop, wall — and the interior resolves the player's aim onto one of those. This is not an
   artwork feature; artwork is simply its first heavy user, and the four wall-mounted items that
   predate it (壁掛燈, 景觀窗, 壁架, 廚房吊櫃) went through the same door with no code of their own.
2. **A catalog of ~45 art pieces**, generated from one record each.

## Where things live

| File | What it owns |
| --- | --- |
| `src/constants/placement.ts` | The vocabulary: `PlacementMount`, `PlacementLayer`, `getPlacementLayer`. |
| `src/lib/interiorPlacement.ts` | The rule: a pointer ray → an attachment, and whether it is legal. |
| `src/constants/interiorShell.ts` | Where the walls are, and which way each faces (`WallSegment.nx/nz`). |
| `src/lib/furniturePlacement.ts` | Measured footprints and the overlap test. Unchanged in substance. |
| `src/constants/artwork.ts` | The art catalog: one `ArtworkSpec` per piece. |
| `src/components/Three/ArtworkModels.tsx` | The 3D piece, generated from that spec. |
| `src/components/ArtworkIcon.tsx` | The shop icon, generated from the same spec. |

## Adding an artwork

One entry in `ARTWORK_SPECS`:

```ts
{
  id: 'art-framed-harbour', name: '港口速寫', price: 340, group: '畫作',
  form: 'framed', motif: 'ocean', size: [1.6, 1.1],
  palette: { frame: '#6b5745', ground: '#f4f1e8', a: '#2a9d8f', b: '#1d5f6e', c: '#e9c46a' },
  description: '…',
}
```

That is the whole change. The row becomes a catalog item (bought, stocked, placed, saved), a 3D
model, a shop icon, and a set of placement rules, because everything downstream reads `form`.

`a` / `b` / `c` are **roles**, not a ranking: `a` is the subject, `b` is the field it sits in, `c`
is the accent. Ignoring that is how the first draft of 島嶼晨光 shipped with a navy sun over a
yellow sea.

## Adding a *kind* of artwork

A new `ArtForm` needs three things, and `npm run audit:furniture` fails until it has all of them:

1. an entry in `ART_FORM_PLACEMENT` (what it mounts to),
2. a `case` in `ArtworkModels.tsx`'s `renderForm`,
3. a `case` in `ArtworkIcon.tsx`'s `ArtworkGlyph`.

Use a `variant` rather than a new form when the construction is the same and only the silhouette
differs — `'cat'` vs `'bird'` are one `figurine`.

## The wall contract

A wall-mounted model is authored **centred on its own origin, facing local +Z**. Everything else
follows from the measured box:

- **Facing** is `atan2(normal.x, normal.z)` — three.js maps local +Z to `(sin θ, cos θ)`, so the
  piece squares up to whatever wall it was aimed at. There is no per-wall case anywhere, and no
  coordinate compared against a threshold.
- **Standoff** puts the piece's own back face (`cz - halfD`) exactly `WALL_MOUNT_GAP` (2 cm) clear
  of the wall plane. A deep oil frame therefore sits further out than a poster by exactly its extra
  depth, with no per-item number to maintain.
- **Height** centres the measured vertical extent on the height the player aimed at, then slides it
  to fit between the baseboard and the ceiling beams. Aiming higher on the wall hangs it higher;
  that is the whole height control, and it is why there is no rotate button on a wall piece.

Dragging a piece across the floor towards a wall catches it within `WALL_SNAP_DISTANCE` (2.5), so
lining a picture up by hand is never necessary.

## Colliders

Nothing in this system carries a hand-typed size. Footprints are measured off the model that is
actually drawn (`measureFootprint`), which is what keeps a frame's collision box the size of the
frame. The corollary is a rule for authoring art: **draw no geometry that is not the artwork**, and
keep painted detail flat and inside the frame's depth.

That rule has teeth. `npm run audit:placements` refuses a hanging piece deeper than 0.75, and it
found the pre-existing 暖陽落山圖 drawing its two "mountains" as solid `coneGeometry` pyramids
standing 0.5 units out of a 6 cm frame — invisible while a painting was a floating floor object,
and a picture hanging 60 cm off the wall the moment it became a wall piece.

## Audits

- `npm run audit:furniture` — every artwork form has both a 3D model and an icon.
- `npm run audit:placements` — part 4 hangs **every** wall-mounted item in the catalog on all four
  walls of a room using the shipping resolver, and checks facing, standoff, height and fit; then
  stands every tabletop piece on a real table and every floor piece on the floor.
- `npm run audit:zfighting` — no two faces of one model share a plane.

## Verifying by eye

The house interior is not reachable on the guest path, so `tmp-artwork-preview.html` builds a real
room from the real shell constants and hangs pieces through the real resolver. `?page=N` pages
through the catalog; `window.__artwork` carries the resolved facing/standoff/height so a headless
run can assert rather than only screenshot. Restart the dev server before using it — a server that
watched the edits serves a differently-keyed module graph and the footprint cache reads stale.

## Categories

藝術品 (`Art`, 室內) and 藝術裝置 (`ArtOutdoor`, 室外) are ordinary rows in `DISPLAY_CATEGORIES`, so
they appear in the shop, the furniture drawer and the outdoor build rail without any screen being
told about them. The internal division — 畫作 / 壁飾 / 雕塑 / 陶藝 / 擺件 — is the `subGroup` chip on
each card, not a third tier of that table: a third tier would mean teaching every screen about it,
for a distinction that is presentation only.

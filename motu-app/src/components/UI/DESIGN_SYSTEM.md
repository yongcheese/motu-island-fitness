# Island UI Design System

Single source of truth for chrome/UI styling across the game. Every new screen or
component should reach for these tokens and primitives first — a one-off Tailwind
string is a sign something belongs here instead.

Implementation lives in two places:
- **Tokens & utility classes**: `src/index.css` (`@theme` block, z-index layer
  system, `.dock-notch`/`.rope-stitch`/`.signpost-post`/`.porthole-ring`/
  `.store-card`/`.confirm-buy-btn`).
- **Shared components**: `src/components/UI/DesignKit.tsx` (`ModalOverlay`,
  `ModalShell`, `PanelHeader`, `Button`, `IconTile`, `CurrencyChip`,
  `SignpostTag`, `PortholeFrame`, `Toolbar`, `DockPanel`, `DockStatus`,
  `Toggle`, `StatTile`, `EmptyState`, `HintBubble`, `Toast`).
- **Layering & pop-outs**: `src/components/UI/HudFrame.tsx` (persistent chrome
  placement), `src/components/UI/FloatingPanelPortal.tsx` (escape a view's
  stacking context) and `src/components/UI/AnchoredPopover.tsx` (any panel
  anchored to a control — see "Pop-outs" below).

## Color

Chrome (toolbars, nav, panels, modals, buttons, icons) uses only the
`--color-island-*` tokens defined in `src/index.css`:

| Token | Hex | Use |
|---|---|---|
| `island-teal` / `-light` / `-dark` | `#2A9D8F` / `#5FBDAF` / `#1F7A70` | primary accent, "active/selected" state |
| `island-navy` / `-soft` / `-dark` | `#264653` / `#4A6169` / `#1A2E35` | ink (base/soft); `-dark` is a deeper ambient wash for full-bleed dark backdrops (e.g. an interior view's non-build-mode background) |
| `island-cream` / `-2` | `#FFFFFF` / `#F8F6F1` | card surfaces |
| `island-line` | `#E1DED4` | borders |
| `island-gold` | `#E8AA3E` | **金幣 only** — coin chips, prices, the purchase-success button. Not "currency" generally: 碎片 are `island-teal` (see 貨幣 below) |
| `island-coral` | `#E8836A` | danger / delete |
| `island-sand` | `#EFE9DC` | card inner surface / hover background |

Rules:
- Never invent a new hex value for chrome — if it needs a color, it's one of the
  tokens above.
- Icons alone differentiate buttons; color only marks selection/danger/currency.
- No saturated gradients, no heavy `backdrop-blur` glassmorphism, no
  black scrims (`bg-black/*`) on chrome. Flat cards, thin borders, soft
  navy-tinted shadows.

**Documented exceptions** (representational art, not chrome — do not "fix" these
onto the token palette):
- `QVersionIcon.tsx` — hand-drawn per-item pixel art (wood grain, skin tones,
  item-specific colors). It draws what an item *looks like*.
- `AvatarIcon.tsx`'s `AVATAR_DEFS` palette — literal avatar customization
  swatches the player chooses between.
- `FLOOR_STYLES`/`WALL_STYLES` (`BuildingInteriorView.tsx`) and the
  `.floor-*-preview` classes (`index.css`) — literal material swatches.
- "Special moment" screens: `LoadingScreen`'s mascot/vine artwork,
  `PettingMiniGame`'s pink theme. Their *functional* chrome (progress bars,
  buttons, radius/shadow/z-index conventions) still follows this system —
  only the flavor palette is exempt.
- `FitnessView`'s in-workout screen (dark/glass HUD layered over the live
  camera view) is a **sanctioned second theme**, kept for legibility over a
  camera feed. Its mechanics (radius, shadow, hover-lift, z-index, buttons)
  still follow this system.
- `MobileControls.tsx`'s joysticks — deliberately neutral black/white
  translucent overlays so on-screen touch controls don't visually compete
  with the 3D world under them. This is a standard mobile-game-controls
  convention, not chrome drift.
- `constants/rarity.ts`'s 稀有度 ladder (white → green → violet → red) and the
  `.rarity-*` rules in `index.css`. See the 稀有度 section below — it is a
  signal system, not chrome, and it is the one place a non-token hue is
  allowed to touch a card.
- `minimap/MiniMapFrame.tsx`'s four driftwood tones — the minimap's bezel
  *depicts* a wooden ship's wheel, the way `QVersionIcon` depicts wood grain.
  Kept desaturated so it sits inside the muted teal/cream HUD rather than
  fighting it, and scoped to that one file: no other component may reach for
  them. Everything functional about the map — the plan itself, the nameplate's
  ink and live dot, the radius/shadow scales — stays on the tokens.

## Making chrome feel expensive: change the construction, not the colour

`Toolbar` (the build-mode tab switcher + its mode-level actions) is the worked
example, and it took two rejected passes to get there. Both failures are worth
keeping, because the second is the one that's easy to walk back into:

1. **Navy shell.** "Premium" was mistaken for "heavy". It read gloomy over the
   bright island scene. **Weight is not quality.**
2. **Flat ivory bar, flat teal pill.** Bright, correct tokens, nice shadows —
   and indistinguishable at a glance from the plain white bar it replaced.
   Re-tinting a shape leaves the same shape.

What worked was changing what the thing *is*: **a carved track with raised keys.**

- **The track is pressed in** — `island-sand`, `inset 0 2px 5px` plus a light
  hairline on the lower lip (`inset 0 -1px 0 rgba(255,255,255,.8)`) where a real
  groove catches light. It also reads darker than the white panel it floats over,
  so it keeps an edge instead of merging with it.
- **The keys sit proud** — tight contact shadow + soft drop + a lit top edge
  (`inset 0 1px 0 rgba(255,255,255,.9)`). Two shadow tiers, never one mid-size
  blur; a single blur is the main reason light UI reads flat.
- **Selection slides.** One `island-teal` key shared across tabs via Motion's
  `layoutId`, so it travels along the groove instead of one button snapping on
  and another off.
- **Presses travel, they don't shrink.** `active:translate-y-px`, not the
  system-default `active:scale-95` — a key goes down, it doesn't get smaller.
  (This is the one documented place that overrides that default.)
- **Mode-level actions are keys on the same surface** — same radius, height and
  raised profile, so the row is one instrument rather than a bar plus a stray
  button.

`island-gold` is **not** part of any of this. It stays 金幣-only no matter how
"luxury" a brief sounds; reaching for gold is the obvious move and the wrong
one.

## 貨幣 — 金幣 and 碎片 must never be mistaken for each other

`src/constants/currency.ts` (what exists and where it is stored),
`constants/rewards.ts` (which sources may pay which), `CurrencyChip` /
`WalletChips` in `DesignKit.tsx` (how they are drawn).

The game has two currencies and they are not two flavours of one. 金幣 is earned
by **exercising and by nothing else** and buys the ordinary catalog; 碎片 come
from everything that is *not* exercise — 每日登入, 輪盤, 活動, 任務, island
interactions — and are a long-horizon collectible. The separation is the whole
point of the economy, so the UI's job is to make it unmissable.

- **Three things differ, not one.** A second gold-coloured pill with a different
  number in it is the exact mistake to avoid. So: a struck **coin** vs a cut
  **shard** (readable at 13px, which is the size these render at); `island-gold`
  vs `island-teal`; and an `aria-label` naming the currency, because a chip is a
  glyph and a number, which a screen reader renders as a bare number.
- **What does NOT differ:** size, radius, weight, padding. They are the same
  object in two materials — two members of one set, not two unrelated widgets.
- **Teal doubles as 「已選取」 elsewhere, and that is tolerable here only.** A
  chip showing a balance is never a selectable control, so there is no state for
  it to be confused with. Do not carry the teal onto anything clickable.
- **A screen that pays one and charges the other shows both.** The 每日登入
  panel pays 碎片 and prices its 補簽 in 金幣, so it renders both chips and spells
  the unit out on both buttons — a lone number there is unreadable. The HUD and
  帳號中心 show both for a different reason: a player who only ever sees 金幣 on
  the island and 碎片 in one panel has no reason to think they are different
  things.
- **Bars get their own scale.** The HUD's 碎片 track fills against 1,000 where
  金幣 fills against 50,000. A shared axis would draw 碎片 as a permanently empty
  sliver, which reads as 「你幾乎沒有碎片」 rather than as 「這是另一種資源」.
- **A celebration follows the currency it is celebrating.** The daily-claim
  reveal was re-cut from gold to teal when the round stopped paying 金幣 — the
  confetti, the rays, the rings and the struck numeral all moved. A gold
  explosion over a 碎片 payout is the loudest possible version of this mistake.

## 稀有度 — the one sanctioned non-token palette on a card

`src/constants/rarity.ts` (palette + ladder), `src/components/UI/RarityAura.tsx`
(the layers) and the `.rarity-*` rules in `index.css` (shapes + timing).

Every item declares `rarity: 'common' | 'rare' | 'epic' | 'mythic'` in
`constants/items.ts` — the field is **required**, not optional — and the shop
card lights up in that tier's colour. **It says so in colour and never in
words** — no 「神話」 tag, no badge, no letter grade, no stars. This was
re-examined when the ladder went from three rungs to six (six tiers is exactly
when a lettering system starts to sound reasonable) and again when it came back
down to four, and deliberately kept both times: the card already carries a
name, a category chip, a stock badge and a price, and a fifth line of text
competes with all of them; a frame lit a different colour is read as "rarer"
before a word is parsed, works at thumbnail size, and works in a language the
player doesn't read. The tier name exists only as the aura's `aria-label`,
because a rarity said purely in hue is one a colour-blind or screen-reader
player cannot read at all. **The purchase reveal follows the same rule** — it
shows the item and the item's name, never the tier's.

Why this is allowed to leave the token palette: rarity's entire job is to be a
hue the rest of the UI never uses. Teal already means "selected", coral means
"danger" and gold means "currency", so a tier drawn in any of them would be
read as a state rather than as a grade.

The four, and the choices worth knowing about:

| tier | edge | why this hue |
|---|---|---|
| 普通 | `#C6CCD3` | near-white. With three saturated rungs above it, the floor's job is the *absence* of a colour, and a hairline a shade cooler than `island-line` is all of that it needs. The one tier whose edge is lighter than its plate — it can be, because it draws no bezel ramp |
| 稀有 | `#6FA24B` | leaf green ~95°, and **never a green that leans cyan**: teal (~173°) means "selected", so a teal-ish frame is read as the card you just tapped. 78° of separation is what buys the distinction — check it beside a selected card, not alone |
| 史詩 | `#8B62C4` | violet, the one hue appearing nowhere else in the game's chrome |
| 神話 | `#C2262E` | crimson ~357°. It **is** a red, which the six-rung ladder refused to allow: the answer to coral's 危險 meaning moved from hue to *value* — coral is a pale salmon (66% lightness), this is a deep crimson (45%), so the two never read as the same material 16° apart. The other half of the answer is that this tier's identity is its *moving* hue, and the drift now runs negative (red → magenta) so it never walks through coral into gold. Check it beside a delete confirmation |

### The whole card is the tier (2026-09-08)

Until this pass the grade lived in three places — a coloured hairline, a
coloured bloom, and one lit enamel plate at the head of the card — and
everything under the plate sat on the same white paper a 普通 card sits on. Two
thirds of the rectangle said nothing, so the tier read as **a sticker applied to
a card** rather than as a property of the card. The whole rectangle is graded
now, and it is graded as one object rather than as more effects.

**The card is a mounted plate.** Tinted paper cut from the tier's own stone, the
lit plate at its head, a hairline mat ruled inside the frame. Every cue is a
piece of that object; none of them is a coloured wash with things thrown on top,
which is this section's second recorded failure.

**Where the light comes from is what holds it together.** The well is the light
source (it always was — see `.rarity-field`), so the paper is palest directly
under it and the tier's colour pools at the *foot* of the card, where the light
has fallen away. Run that story backwards — colour at the top, bloom at the
bottom — and the card is instantly two unrelated gradients. It also pays for
itself twice: the palest band of the sheet is exactly where the name and the
description sit.

**The ladder is the aura's ladder, one scale up** (`.rarity-card` in
`index.css`, hung off the tier's own class the way 普通's flat plate and 神話's
drifting bezel already are — nothing new is passed as a prop):

| tier | what the rectangle draws |
|---|---|
| 普通 | **nothing.** White paper, one hairline. A floor that draws even a little of the treatment turns the rung above it into a shade |
| 稀有 | tinted paper, a turned edge, a white bloom under the plate, the tier pooling at the foot, and the mat. All static |
| 史詩 | + the paper is engraved, and a highlight travels the frame (26s, against the bezel's 22s and the glaze's 9s — three highlights on one card must never line up into a pulse) |
| 神話 | + the deepest pool, a double rule, and the mat drifting through the same `rarity-iris` at the same 12s as its own bezel, so the card and the plate breathe together |

Three things are worth not re-deriving:

- **The pool is a plinth, not a dye.** `--rarity-field-core` is a jewel tone.
  The first cut ran it from 54% of the card's height at 26–46% strength and
  produced a lavender card and a pink card with a shop card drawn on them. It is
  now the bottom quarter at 14–28%. `--rarity-field-top` is the opposite — every
  tier's is a near-white, so it is safe as paper at full strength.
- **On the card, marks are cut IN, not laid ON** — the exact inverse of the
  plate's rule, and for the plate's reason. The plate can carry white sparkles
  because its field is saturated; the paper is a near-white, so its engraving is
  navy and its frame highlight is a white core with the tier's own colour
  trailing it. A plain white sweep there is not subtle, it is *invisible*: the
  first cut rendered nothing at all, and the ring mask was never the problem.
- **The engraving is ruled, not radial.** The well is a machined dial so its
  grain turns about a centre; the card is a printed sheet so its grain runs
  straight. Running the plate's 60-spoke fan out to card size puts a starburst
  behind the description, which is the gacha look this section exists to avoid.
  Same test either way: notice that the surface has a texture, never be able to
  count its lines.

### Six rungs became four (2026-08-28)

The ladder shipped as 普通／優秀／稀有／史詩／傳說／神話 and was cut to
**普通 白 · 稀有 綠 · 史詩 紫 · 神話 紅**. What went were the two rungs that were
only ever legible *next to their neighbour*: 優秀's green and 稀有's blue were
two versions of 「a bit better than plain」, and 傳說's amber and 神話's magenta
two versions of 「the best thing in the shop」. A player tells white from green
from purple from red across a room; nobody tells green from blue without
holding the two cards side by side. **A rung that only reads in a comparison is
a shade, not a rung.**

Both merges went **downwards**, and that direction is forced, not chosen:

- **優秀 → 普通.** Upwards would have made 稀有 the biggest tier in the game (95
  items against 普通's 84) — the ladder inverted, and 「稀有」 the word for the
  commonest thing on the shelf.
- **傳說 → 史詩.** Upwards would have put four items in 神話, which is capped at
  one. 傳說's *layer* (the slow bezel highlight) moved down with its items, so
  史詩 inherited the treatment along with the stock — the rung directly under
  神話 must draw more than the middle of the ladder does.

Only two swatches are new: 普通's near-white and 神話's red. 稀有 wears the green
that was tuned for 優秀 and 史詩's violet is untouched, so the two hues that had
already shipped and been checked in place are the two that did not move.

### The catalog is graded in full (2026-08-25)

Rarity used to be **opt-in**: ~93% of items carried no `rarity` field, `common`
was a rung usable only on a shelf graded as a group, and a percentage ceiling
(15%, then 18%) capped how much of the catalog could be lit. That is gone, and
the reasoning behind it is worth keeping because the new rule is the same
argument taken one step further.

The old model needed grading to happen **shelf by shelf** — a ladder is legible
only where adjacent rungs are visible at once, so a shelf with some cards framed
and some bare read as unfinished work. That made every new shelf a question
about whether the ceiling still fit rather than about the items on it, which is
the wrong thing to be deciding. Grading everything satisfies the adjacency rule
by construction and retires the ceiling with it.

Rules:
- **Every item has a tier, and a missing one is a compile error.** Not a
  defaulted field — a required one. A default would let an item ship ungraded
  and look deliberate.
- **Universal grading is not universal decoration.** 普通 draws a plate in a
  ring and nothing else — no rays, no sparkles, no sweep — so a shelf of
  ordinary goods looks almost exactly like the untagged cards it replaced. The
  catalog did not get louder; it got a floor.
- **The distribution is the ladder, and it is a pyramid.** Roughly 普通 73% /
  稀有 19% / 史詩 8% / 神話 1 item. `npm run audit:catalog` fails the build if a
  rarer tier ever outnumbers the one below it — which is how the ladder would
  invert, one well-meant upgrade at a time.
- **`mythic` ≤ 1 item in the whole game, and `epic` stays under 12% of the
  catalog.** The hardest rules in the section, both enforced by the audit. The
  `epic` bound is a *share* rather than the flat 「single figures」 that used to
  guard 傳說, because what it protects is the feeling that a purple frame is
  unusual, and that is relative to how much else is on the shelf.
- **The one `mythic` item is 鳳凰** (`pet-bird-phoenix`), which spends the whole
  budget of the rule above. The slot was held empty on purpose until an item
  turned up that could carry the game's loudest card, its full-screen reveal and
  its only animated hue; a bird that does not exist is that item. Tagging a
  second thing `mythic` does not make two special items, it makes the tier
  meaningless — one of the two has to come down to 史詩 instead.
- **Never derive a tier** from a price threshold, an id prefix or a category —
  same rule as `shopCategory`. Price and rarity are two different properties of
  an item, and the catalog is laid out so that can be READ off it rather than
  only asserted: 部落面具 is 400g and 史詩, 火把 is 1,050g and 普通, 金絲雀 (850)
  outranks 橘貓 (900), and 熱帶草裙 is the cheapest item in the game at 50g.
  `audit:catalog` fails if the catalog ever stops containing a counter-example
  in both directions, because a perfectly price-ordered ladder is what a derived
  one looks like.
- **A tier feeds reward pools, not just cards.** `constants/rewardPools.ts`
  filters on rarity (a ceiling, a floor, an exclusion list), so re-grading an
  item silently changes what 每日簽到, 輪盤 and 健身獎勵 may hand out. That is
  the intended design — one source of truth — and it is also the reason a tier
  is not a paint job any more.
- **A tier is a material, not a colour scheme.** This is the section above
  ("change the construction, not the colour") applied to a card, and it took a
  rejected pass to get to — worth keeping, because it is the obvious thing to
  build:

  1. **A tinted panel with a ray burst and sparkles on top.** Correct hues,
     clearly readable as "rarer", and it looked like a free-to-play gacha
     pull. Decoration laid over a shape leaves the same shape — the same
     failure as the flat ivory bar above.

  What worked was making the well **an enamel plate recessed into a turned
  metal bezel**: a graded metal ring (`.rarity-bezel`), a plate sunk 1.5px
  inside it with a pressed-in top edge and a lit lower lip (`.rarity-field`,
  the same carved-groove construction as the toolbar's track), a fine sunray
  grain in the glaze, and one slow specular pass across it. Every premium cue
  is construction; not one of them is a new colour.

- **Density is what separates jewellery from gacha.** The ray burst survived
  the rebuild only by going from 24 fat spokes to 60 fine lines at low opacity
  — at that density it stops reading as "rays" and starts reading as a
  machined surface. Its mask must keep a hole in the centre, where the lines
  converge to sub-pixel width and turn to moiré.
- **How much is drawn IS the ladder.** Each tier declares a `layers` budget in
  `rarity.ts`, and the aura draws only what the budget allows: 普通 gets a plate
  in a ring and nothing else, 稀有 adds the grain, the first two sparkles and the
  sweep, 史詩 four sparkles and the bezel highlight, 神話 six sparkles and the
  drifting hue. Four tiers each drawing every layer would be four *colours*, not
  four grades. (`layers.rays: 0.5`, the half-strength grain, is now unspent — it
  was 優秀's — and is kept in both the type and the stylesheet as the correct
  treatment for a rung inserted between 普通 and 稀有 later.) Note what never changes with tier: the grain keeps its 60-line density
  and the sparkles keep their size. **A higher tier gets more layers, never a
  fatter version of the same one** — thickening is the rejected gacha pass.
- **Nothing pops and nothing hurries — except twice, on purpose.** On the shelf
  this is absolute: the grain turns once every 90s, the specular sweep holds
  still for two-thirds of its cycle, sparkles change brightness rather than size
  (the first pass scaled 0.35 → 1, which snaps), 史詩's bezel highlight takes
  22s and 神話's hue 12s. Premium objects are still; motion should be noticed to
  have happened, not caught happening.

  The exception is the **purchase** of a 史詩 item or better, which flashes the
  screen, throws streamers and plays a brass fanfare (`RarityReveal.tsx`,
  `constants/rarityFx.ts`). That is a deliberate reversal, and it only works
  because of what surrounds it: buying anything else stays quiet — 普通 gets one
  confetti burst and one chime — and only ~9% of the catalog (17 of 196) can
  ever trigger a reveal. **The restraint everywhere else is what the celebration
  spends.** A game that fires fireworks at every transaction has no fireworks.

  普通 is three quarters of the catalog, which makes its row the one under
  pressure: if it ever grows a second burst 「because most purchases
  feel flat」, the fireworks stop meaning anything the same week. The fix for a
  flat 普通 purchase is never a louder 普通 — it is checking that the item was
  graded honestly.
- **Rarity survives the purchase, at thumbnail size.** The collection list, the
  build rail, the furniture drawer and the dressing room all carry the tier —
  an item that loses its grade the moment it is owned says the grade was a price
  tag. But they carry it as `.rarity-chip`: **border colour and a hint of halo,
  never the aura.** At 44–64px the 60-line grain collapses into moiré and the
  sparkles land on the artwork instead of around it. A player-set state (選取
  中, 套用中, 使用中) still out-ranks the tier on those tiles — a state beats a
  grade.
- **The contrast runs the opposite way to most games.** Gacha shops light pale
  rays over deep saturated cards; these cards are cream, so a pale sparkle over
  pale cream is invisible (which is exactly how the first pass rendered). The
  *plate* is tinted until it can carry light marks, and the grain and sparkles
  are then white on top of it. Sparkles carry their glow in the tier's mid-tone
  (`edge`), not in white, so the white core has a darker ring to read against.
  For the same reason `edge` is deeper than the plate it surrounds: the bezel's
  lit and shadowed halves are white and black alphas over that one value, and a
  pale base leaves them too close together to read as a turned edge.
- **A new tier is a palette entry and nothing else.** Colours live in
  `rarity.ts` and reach the stylesheet as the `--rarity-*` custom properties
  `rarityStyleVars()` writes on the card; no gradient maths is ever copied.
- `island-gold` is still 金幣-only, and no tier may be re-cut toward it. The
  amber rung that used to sit beside it is gone, and 神話's drift was flipped
  negative for the same reason (see the table above).
- **`mythic` is one item and `epic` is scarce**, so most cards can never be seen
  on the top of the ladder without help. Use `?rarity=<id>:mythic` (see
  `utils/debugOverrides.ts`) to look at a tier on an item you are not about to
  pay for.
- **Only two hexes have ever been re-cut, and both times for the same reason: a
  swatch that had never been rendered in place.** 傳說's amber was deepened
  after reading *weaker than the tier below it* — a pale core on a cream card
  washes out (the contrast note above, hit again) — and 普通's limestone grey
  went near-white when three saturated rungs above it made a grey floor read as
  a colour somebody had chosen rather than as the absence of one. `rare` and
  `epic` are not to be re-tuned: those two have shipped and been checked in
  place.
- **`.rarity-card` must stay after `.store-card` in `index.css`.** Both are
  single-class selectors in the same layer and `.store-card` `@apply`s its own
  border-colour and box-shadow, so source order decides the winner. For the
  same reason a rarity card *drops* `border-island-line
  hover:border-island-teal-light` at the call site rather than layering over
  them — see "Building a shared component" below on why two utilities setting
  one property is a real bug here.

## Border radius

Canonical scale — pick the smallest one that fits, don't introduce a new value:

| Class | Use |
|---|---|
| `rounded-lg` / `rounded-xl` | small chips, key-caps, badges |
| `rounded-2xl` | buttons, `IconTile`, most cards |
| `rounded-[1.75rem]` | `StatTile` / `EmptyState` cards |
| `rounded-[2rem]` | panels / modals (`ModalShell`), `.store-card` |
| `rounded-full` | pills, circles, `PortholeFrame` |

This scale governs typical chrome: modals, panels, buttons, tiles, badges.
Full-page "hero" cards (a single large feature card filling most of a
dashboard-style screen, e.g. `FitnessView`'s workout picker) may use a
proportionally larger radius (`rounded-[2.5rem]`–`rounded-[3rem]`) as long as
it's the **same** value for every card of that role on that screen — the
problem being solved is random per-card variation, not large radii
themselves.

## Shadow

Two families only, both navy/teal-tinted rgba — never plain Tailwind
`shadow-sm/lg/xl/2xl` and never a raw-black shadow on chrome:
- `shadow-[0_Npx_Mpx_rgba(38,70,83,α)]` — navy, the default for cards/panels.
- `shadow-[0_Npx_Mpx_rgba(42,157,143,α)]` — teal, for teal-surfaced elements
  (primary buttons, active states).

### A clipped element cannot carry its own shadow

**`box-shadow` and `clip-path` on the same element cancel out.** A clip clips
the element's *entire painted output*, and the shadow is part of that output —
so `class="dock-notch shadow-[…]"` renders **no shadow at all**, leaving a hard
cut edge where the card meets the 3D scene. Moving it to `filter` on that same
element doesn't help either: filters are applied *before* clipping, so the blur
gets cut too.

This was silently true of every notched surface in the app — TopBar (both
layouts), AccountPanel, AuthScreen, LoadingScreen, FitnessView's picker card,
the interior header, the NavBar dock plank and every `SignpostTag` — which is
what made the HUD read as flat slabs with stray black edges.

The fix is structural: **the shadow goes on a wrapper, as a drop-shadow
filter**, where it is applied to the child's already-clipped rendering and so
traces the real silhouette (the chamfer, the arrow point).

| Utility (`index.css`) | Use |
|---|---|
| `.notch-shadow-sm` | HUD chrome sitting on the scene (TopBar) |
| `.notch-shadow` | default clipped card (NavBar plank, interior header) |
| `.notch-shadow-lg` | panels/modals floating above other UI |
| `.notch-shadow-teal` | a clipped element on a teal surface (active `SignpostTag`) |
| `.notch-shadow-hoverable` | `-sm` plus a hover step-up, as one class |

```tsx
// Wrong — the shadow never renders:
<div className="dock-notch shadow-[0_4px_16px_rgba(38,70,83,0.1)]">…</div>

// Right — wrapper owns the shadow, inner element owns the clip:
<div className="notch-shadow-sm">
  <div className="dock-notch">…</div>
</div>
```

`SignpostTag` and `HintBubble` already do this internally — pass
`HintBubble`'s `notch` prop rather than putting `dock-notch` in its
`className`, because the clip must not land on the box that owns the nub
either (see below). Note these are hand-authored utilities, not registered
Tailwind ones, so `hover:notch-shadow` generates nothing — that is why
`.notch-shadow-hoverable` exists as its own class.

### A clip also eats anything positioned outside the box

The same rule catches decorations that deliberately sit outside their parent's
border box. `HintBubble`'s nubs (`-top-1.5`, `-bottom-[6px]`) are exactly that,
so a `dock-notch` on the bubble deleted the nub outright — `ControlsHint`'s dot
had silently not rendered. Anything that paints outside an element (shadow,
nub, ring, a negative margin) has to live *outside* the clip, not inside it.

## Typography

- `font-black` — headings, buttons, card titles, emphasis labels.
- `font-bold` — body copy, secondary text.
- `font-extrabold` and arbitrary weights (`font-[1000]`) are not part of the
  scale — use `font-black`.

Sizes inside persistent HUD chrome come from the two-rung HUD type scale
(`.hud-text-title` / `.hud-text-meta`, see "Responsive HUD sizing" below), which
steps with the device tier — not from a fixed `text-[11px]`. 10px is the floor.

## Interaction states

- `active:scale-95` — default pressed state.
- `active:scale-[0.98]` — large card surfaces (e.g. `.store-card`), a subtler
  press for a bigger hit target.
- `hover:-translate-y-0.5` — default hover lift on buttons/cards.
- `disabled:opacity-40 disabled:pointer-events-none` — disabled state.

## Z-index

Every `position: fixed/absolute` element with a z-index uses one of the
documented classes in `src/index.css` (`.z-background` → `.z-loading`) —
never a raw `z-[N]`/`z-50` compared across views.

**Local sub-scale exception**: content fully contained within one already
`z-game-view`/`z-floating-panel`-scoped subtree may use small plain integers
(e.g. `z-10`, `z-20`) for internal stacking, since a nested stacking context
can't leak out to compare against anything outside it. Always leave a
one-line comment naming this exception so a reader doesn't mistake the number
for a global tier (see `BuildingInteriorView.tsx` for the pattern). Never use
an arbitrary bracket value like `z-[70]` or `z-[200]` — those read as if they
relate to the global table but don't.

## HUD layout — grid frame + spacing tokens

The persistent floating chrome over the 3D scene (TopBar, SideButtons, MiniMap,
ZoomControl, NavBar, ControlsHint, PettingMiniGame) is placed by a
single shared **`HudFrame`** (`src/components/UI/HudFrame.tsx`) — a `fixed inset-0`
CSS-Grid overlay with an empty centre cell so pointer events fall through to the canvas
(camera drag must keep working). Each piece renders into a **`HudRegion`**
(`left-rail` / `top-center` / `mid-right` / `bottom-center` / `bottom-right`) instead of
carrying its own `fixed top-[Npx]`/`left-N` offset.

Rules:
- **Never re-introduce a hand-tuned pixel offset that encodes another element's size**
  (the removed `SideButtons top-[360px]`, `AccountPanel top-[128px] left-[104px]`,
  `PettingMiniGame left-[88px]`, etc.). If two elements share an edge, stack them in the
  **same** `HudRegion` so flex `gap` separates them — that is why TopBar/MiniMap and
  SideButtons share `left-rail`.
- Edge insets and inter-card gaps come from the `--hud-inset` / `--hud-gap` tokens
  (`src/index.css`), never a per-component `left-4`/`right-8`/`top-8`. The frame's own
  padding is `max(var(--hud-inset), env(safe-area-inset-*))` so notched devices never clip.
- Edge insets are only half of it: how big a card *is* comes from the four-tier
  `--hud-*` scale in the next section, not from per-component breakpoints. A HUD
  card that writes its own `xl:p-5`/`xl:w-[192px]` is the smell that section exists
  to remove.
- **A scrolling region is a clipping region — give it `.hud-scroll-gutter`.**
  `left-rail` carries `overflow-y: auto` as a safety valve for very short
  viewports, and per spec that computes `overflow-x` to `auto` too, so the region
  clips its cards on *both* axes at its own content box. That cut off things which
  were never trying to leave the rail: a card's shadow is painted outside its
  border box, so the MiniMap's bottom shadow was sliced to a hard horizontal line
  (which reads as the map itself being cropped) and the left edge it tucks into
  the corner with `-ml-*` was shaved off. `.hud-scroll-gutter` reserves
  transparent room inside the scroll box and cancels it with an equal negative
  margin, so children can paint outside themselves while the region stays put.
  Never add the overflow without it. Note this is about a card painting *slightly*
  outside itself — a pop-out that must escape the region entirely is still
  `AnchoredPopover`'s job (see "Pop-outs").
- A HUD element migrated into the frame keeps its `z-hud-*` class but switches
  `fixed`→`relative` (the tier still orders it locally inside the frame — see Z-index below).
- World-tracked / full-bleed overlays (`InteractionPrompt`, `MobileControls`) and
  corner `Toast`s stay OUTSIDE the frame as their own layers. So does any panel that
  belongs to a **mode** rather than to a view — `BuildModeOverlay` and
  `IslandEditorOverlay` both run in views where the frame isn't mounted, so they
  self-position with the same `--hud-inset` tokens instead of taking a region.
- Full-screen scroll views use the `page-shell-y` / `page-shell-x` / `corner-safe-tr`
  utilities (`src/index.css`) for safe-area-aware padding instead of `pt-12 pb-24 px-6`.

The Z-index note below now also covers the frame: it is one stacking context on the
`.z-hud-frame` tier, and the `.z-hud-*` values order pieces *within* it as a local sub-scale.

## Responsive HUD sizing — four device tiers, one token scale

The frame above decides *where* chrome sits. This decides *how big it is*, and
it is the answer to "make this HUD element smaller on laptops/phones" — never a
new media query inside a component, and never a `transform: scale()` on a
finished card (that shrinks the touch targets and the type with it, which is
the thing you were trying not to do).

**The four tiers.** The only widths HUD sizing may branch on. Declared once in
`src/index.css` ("RESPONSIVE HUD SIZE SYSTEM") and mirrored in
`src/hooks/useHudTier.ts`:

| tier | range | Tailwind variant | typical device |
|---|---|---|---|
| mobile | < 640px | *(unprefixed)* | phones |
| tablet | 640–1023px | `tablet:` | tablets, split windows |
| laptop | 1024–1535px | `laptop:` | 1366x768 … 1440x900 |
| desktop | ≥ 1536px | `desktop:` | 1080p+ monitors |

Plus one height variant, `short:` (≤ 800px tall), for the case width cannot
see: a 1366x768 laptop is wide enough for a full-size layout and has no
vertical room to carry it.

`--hud-inset` / `--hud-gap` and `--minimap-w` step on these same four widths.
Before this existed each component picked its own — TopBar grew at 1280,
`--hud-inset` grew at 1280, the MiniMap grew at 640 — so the HUD changed size
three times on the way from a phone to a monitor and was at its largest exactly
on the laptop that could least afford it.

`sm:`/`md:`/`lg:`/`xl:` are still fine for in-panel layout that is about content
fitting (a two-column form, a wrapping grid). The tier variants are for
statements about the *device class*.

**The tokens.** Set on `:root`, redefined per tier. Spend these instead of
literals:

| token | what it sizes |
|---|---|
| `--hud-card-w` | a HUD card's width — `max-content` on mobile/tablet, a fixed column on laptop/desktop |
| `--hud-card-max-w` | the standing "never runs off the viewport" cap; put it on every HUD card |
| `--hud-card-pad` / `--hud-card-gap` / `--hud-row-gap` / `--hud-chip-gap` / `--hud-stat-pad` | padding and the four gap roles |
| `--hud-avatar` / `--hud-icon` | the avatar porthole; any inline glyph |
| `--hud-bar-h` | progress-bar thickness |
| `--hud-name-max-w` | where a player-supplied name starts truncating |
| `--hud-text-title` / `--hud-text-meta` | the two type rungs (see below) |
| `--hud-tap` | 44px. Deliberately **not** tiered — a finger is the same size on every screen |

Three utility classes spend the last few, because each needs two declarations:
`.hud-icon` (CSS width/height beat lucide's `size` attribute — keep passing
`size` as the pre-CSS fallback), `.hud-text-title` / `.hud-text-meta` (size +
line-height), and `.hud-hit`.

**Width is size; pointer is touch.** These tiers say how much room there is.
They never say what is pointing at the screen — a 1180px tablet in landscape is
a `laptop` here and still needs 44px targets. That question is
`useIsTouchDevice()` (`pointer: coarse`), and the two are meant to be used
*together*. TopBar used to pick its whole layout by pointer type, which handed
a touchscreen laptop the phone card and a narrow desktop window the full-size
one — backwards in both directions.

`.hud-hit` is where the two meet: under `pointer: coarse` it grows a control's
hit area to `--hud-tap` with an overlay pseudo-element, so the control keeps
its drawn size and gains reach, and nothing in the layout moves. **A shrunken
HUD is only usable if the finger target does not shrink with it** — put it on
any HUD control smaller than 44px.

**Type floor.** `--hud-text-meta` bottoms out at 10px and there is deliberately
no third, smaller rung. If a label does not fit at 10px the answer is a shorter
label or a folded section, not 9px.

**Information hierarchy, not uniform shrinking.** Sizing tokens shrink a card;
they do not decide what a small screen should still say. Rank the contents
first and let the tier choose the arrangement:

- **Primary** — what the player reads at a glance. On screen at *every* tier,
  in *every* state, never behind a tap.
- **Secondary** — supporting detail. Present at every tier, but foldable, and
  folded **by default** where the screen cannot spare the height.
- **Tertiary** — admin/diagnostic. Inside the fold.

Nothing is deleted on a small screen; it moves down a rung. `TopBar.tsx` is the
worked example — its header comment names which of its parts sit on which rung
and why, and it is the component to copy when the next HUD card needs this.

**A fold's default belongs to the tier; the player's choice outranks it.**
Store it as `boolean | null`, where `null` means "follow this tier's default".
A plain boolean either ignores the tier after the first render or throws away
the player's choice on the next resize.

## MiniMap — one system, one scene per place

`src/components/UI/minimap/` is the whole map: `miniMapCore.ts` (pose + world
scale + facing smoothing), `MiniMapViewport.tsx` (the player-centred, north-up
window), `MiniMapMarker.tsx` (the indicator system), `MiniMapFrame.tsx` (the
ship's-wheel bezel), and one `*MiniMapScene.tsx` per place. `MiniMap.tsx` picks
a scene for the current view.

Rules:
- **A new place is a scene, never a second minimap.** It supplies world-unit
  bounds and SVG children drawn through `mmPx()`, and inherits tracking,
  facing, smoothing, the bezel and the responsive sizing. An island map, a
  second floor and a dungeon are all the same three-line change here.
- **Two rotations, two sources, never crossed.** The map is heading-up and turns
  with the **camera**; the player's arrow turns with the **character model**. So
  orbiting around a standing character swings the map under a stationary arrow,
  and turning the character swings the arrow on a stationary map. They are
  sibling elements — parenting the arrow to the plan would silently add the
  map's angle to its own, which is the bug this arrangement exists to prevent.
- **Nothing reads the player except `readMiniMapPose()`**, which returns both
  bearings: `facingDeg` from `playerBus.playerRotation` (the character) and
  `viewDeg` from `playerBus.cameraYaw` (the camera). Neither is derived from the
  other, and neither is special-cased per scene or per camera mode. The one
  exception is the interior free-edit camera, where the avatar is frozen and the
  camera genuinely is the subject being tracked.
- **Angles are world bearings, converted to screen exactly once.** A marker
  states a plain clockwise-from-north angle (`worldYawToFacingDeg()`); the
  viewport is the only thing that knows where the camera is looking. A new
  indicator (NPC, quest target) is a `MiniMapMarker` drawn inside the plan, so
  it inherits the map's rotation and needs no angle maths of its own.
- **Type on a turning map wears `.minimap-upright`** (index.css), which cancels
  the map's rotation about that element's *own* centre. Room names and glyphs
  stay pinned to their room and stay readable; without it the plan reads
  sideways whenever the player looks south.
- **Motion is four custom properties, not React state.** The viewport writes
  `--mm-tx` / `--mm-ty` / `--mm-map` / `--mm-facing` once per frame;
  `.minimap-plan`, `.minimap-upright` and `.minimap-facing` (index.css) read
  them. A map that re-renders its plan at display rate is the bug this replaced
  — verified at 0 React renders over 181 frames of walking and turning.
- **Size lives in `--minimap-w` / `--minimap-h`** (index.css), like
  `--interior-header-*`: other chrome (AngelGuide's keep-out) measures off those
  tokens instead of hardcoding this card's size.

## Pop-outs — one anchored popover mechanism

Any panel that belongs to a control but must render **outside** it — a tool
panel on the HUD rail, a hover label, a dropdown — uses **`AnchoredPopover`**
(`src/components/UI/AnchoredPopover.tsx`). Never an `absolute left-[Nrem]` child
of the trigger.

The reason is clipping, not stacking. Two ancestor properties crop an absolutely
positioned descendant no matter how high its z-index is:

- **`overflow` that isn't `visible`** on any ancestor. Note `overflow-y: auto`
  computes `overflow-x` to `auto` as well, so a vertical-scroll safety valve
  clips horizontally too — this is what cropped SideButtons' emote tray to the
  `left-rail` region's own width (`HudFrame.tsx`).
- **`clip-path`** on any ancestor, which clips the element's whole painted
  subtree. `SignpostTag`'s arrow silhouette is a `clip-path`, so a tooltip
  written as a child of a rail button could never be seen at all.

Because neither is a z-index problem, the fixes that *look* obvious all fail:
a bigger `z-index`, a taller toolbar, a hardcoded screen position, or a special
case for one button. `AnchoredPopover` fixes it structurally instead — it
portals the panel to `#floating-panel-root` (via `FloatingPanelPortal`, so it
also lands on the shared `z-floating-panel` tier above the HUD), positions it
from the anchor's **measured** `getBoundingClientRect()`, flips to the opposite
side when the preferred one doesn't fit, and clamps it inside the viewport. That
is what makes it behave identically on desktop, laptop, tablet and phone.

```tsx
const anchorRef = useRef<HTMLDivElement>(null);
<div ref={anchorRef}><MyButton onClick={toggle} /></div>
<AnchoredPopover open={open} anchorRef={anchorRef} onClose={close} side="right" align="center">
  …panel…
</AnchoredPopover>
```

Props worth knowing: `side` (`right`/`left`/`top`/`bottom`, preferred — it
flips only when it must), `align` (`start`/`center`/`end`/`stretch`, where
`stretch` matches the anchor's cross-axis size), `gap`/`margin` (anchor and
viewport spacing), `interactive={false}` for hints that must never eat a click,
and `closeOnOutsideClick`/`closeOnEscape`. The open/close animation is built in
and follows the resolved side, so a panel always flies out of its own trigger.

`FloatingPanelPortal` remains the lower-level piece for a panel that positions
itself (a view's bottom dock, a centred sheet); `AnchoredPopover` is for
anything whose position is defined by another element.

## Catalog, shop, inventory, placement, selection — five systems, one of each

Screens that let a player acquire or arrange things are built on five shared
systems. None of them may be re-implemented per screen, and none of them may
branch on an individual item id.

**1. Catalog / taxonomy** — `src/utils/categoryUtils.ts` + `src/constants/items.ts`.
Every item declares one `shopCategory`; every category declares its
`mainSection` (`PERSON` / `INDOOR` / `OUTDOOR` / `PET` / `NPC` / `CARD`, which
*is* the placement scope, so 室內 and 室外 goods can never mix) and its `kind`:

| kind | meaning | shop action | stacks? |
|---|---|---|---|
| `wearable` | worn on the avatar | 購買 → 已擁有 | no |
| `placeable` | a physical object you put down | 購買 / 再購買 | yes |
| `applied` | re-skins something you already own (floor, wall, house appearance) | 購買 → 已解鎖 | no |
| `consumable` | 特殊卡牌 — held, then spent; never put down | 購買 / 再購買 | yes |

`consumable` stacks like `placeable` and is placeable like neither: `canPlaceItem`
asks for the `placeable` kind by name, so a 抽獎券 can be held five deep and still
never becomes an object standing on the island.

Never re-derive a category from an id prefix (`itemId.startsWith('wall-')`), a
name keyword, or a hand-maintained allow-list of "things build mode shows".
Those existed in four places and disagreed; adding an item now means one field.

**2. Shop** — `src/context/useShopActions.ts` (the only write that spends gold),
`PurchaseDialog.tsx` (the only purchase confirmation), and `ItemStock.tsx`
(`BuyButton` / `StockBadge` — the only 購買/再購買 button and stock readout). A
new surface that sells something composes these; it does not write
`balanceGold` itself. A *mode* that wants to sell adds a `BuyButton` to the card
the player is already looking at rather than opening a storefront of its own.

There are exactly **two** storefronts, and which one sells a thing is decided by
data rather than by a filter. Only one of them is a rail tag: the ordinary shop
is always open, so it is a tool on the signpost; 限時小攤 belongs to a merchant
who sails in and leaves again, so its entrance is **the merchant himself**,
standing on his boat off the beach (`constants/merchants.ts`,
`UI/MerchantSession.tsx`). A rail tag would promise he is always there, which is
exactly the promise that rework removed.

| | 商店 (`ShopView`) | 限時小攤 (`LimitedShopView`) |
|---|---|---|
| entrance | rail, `View.SHOP` | walk up to 水獺行商 → the shared interaction prompt |
| shelf built from | `MAIN_SHOP_CATALOG` | the rotation's offers |
| goods | permanent catalog, 金幣 | 特殊卡牌 **bundles** (功能卡 + 抽獎券) + 特殊飾品 |
| write | `useShopActions` | `useLimitedShop` |

An item declares its channels (`availableIn`, `constants/distribution.ts`) and
each shop filters the catalog to its own — so a limited exclusive is **absent
from** the ordinary shop's list, its category chips (`getShopCategoriesFor`), its
section tabs (`getShopMainSections` — 特殊卡牌 has no shelf there at all now), its
build rails and its purchase guard, rather than being hidden by any of them.
Never write `if (item.shopCategory === 'SpecialFx') return null`: that is a rule
one screen keeps and the next screen forgets.

A tab that leads to an empty page reads as broken, so the rule scales upward: a
category another storefront owns loses its chip, and a *section* whose every
shelf it owns loses its tab.

The 限時小攤 has its own write (a rotation, a generated bundle, a per-period
purchase limit and 功能卡 grants do not belong in the permanent catalog's
simplest path) and its own confirmation dialog (its subject is not an
`ItemDefinition`, its quantity is not 1 and its price is not necessarily gold),
but it shares the charge (`buildSpendUpdate`), the inventory rule, the rarity
treatment and the currency chips. Anything scarce is said on the card — a
本檔限定 tag, a 返場 tag, a countdown in days and hours — and never in the
styling: no red, no seconds ticking, no 最後機會. It is a travelling stall on the
island, not a cash shop. A bundle **never** gets a quantity selector; the
商品 *is* the pack, and the button says 購買此組合. See `docs/limited-shop.md`.

**功能卡 are not items** and must never be drawn as one — `UtilityCard.tsx` owns
that card (round well, ticket stub line, the effect where a price would be, a
功能卡 label and a duration). Reach for `UtilityCardTile` / `UtilityCardArt` /
`ActiveEffectChip` rather than restyling a `.store-card`. The rarity treatment
is deliberately the shared one: a card sits on the same ladder as everything
else. See `docs/utility-cards.md`.

**3. Inventory** — `src/utils/inventory.ts`. Stock is **derived**:
`available = owned − placed`, counting both island and interior placements.
There is no separate counter to keep in sync, so buying, placing, moving and
retrieving cannot drift apart. Placing a `placeable` spends a copy; moving one
already down spends nothing.

**4. Placement** — `usePlacementActions` (island) and
`BuildingInteriorView`'s own handlers (interior grid). Both enforce the stock
rule *at the write*, behind the already-disabled button, so no keyboard path or
stale click can put down a copy that was never bought.

**5. Selection** — `src/context/useIslandEditor.ts` outdoors, `tempPlacement`
indoors. Both follow the same three beats: **pick a subject** (a bought copy
from a list, or the object itself by clicking its model) → **adjust** (drag,
`R`/旋轉 button) → **commit or cancel**, with 收回 available on something already
placed. Every subject supports every verb, so there is no per-item 收回 button
and no per-item transform UI.

**Selecting is not editing, when the subject has more than one verb.** For an
ordinary object those two states are usefully the same: you point at a fountain
because you want to move it, so the click writes the draft. The Home is the one
exception, and collapsing it was a real usability bug — it also wears an
appearance, it is the only thing you can walk into, and it cannot be 收回'd, so
a click that started a move answered a question the player had not asked. It
now has two states: `selectHome()` opens **我的家** (`HomePanel.tsx` — preview,
facing, 更換外觀, 移動與轉向) and changes nothing in the world;
`startHomeTransform()` is the only thing that writes a draft. Before adding a
second verb to any subject, put the verbs on a surface first — do not overload
the selection.

Corollary: an **applied** style (a house coat, a floor, a wall) is never edited
from inside a transform session. It writes immediately and a transform is a
draft, so the two together give one panel two meanings of 確認 — which is
exactly what the placement dock's old 外觀 key did.

Those three beats are now the same **chrome** in both worlds, not merely the
same shape: `PlacementCatalog.tsx` (browse) and `PlacementDock.tsx` (position)
are one component each, used by the house and by the island. Both used to be
hand-built per mode, and every difference was accidental — the island browsed a
horizontal strip of thumbnails with no ownership split, and put its 確認 at the
TOP of the screen while the house put it at the bottom. A new placeable world
composes these two; it does not build a third.

Two sanctioned divergences, and both pass the same test — name the thing about
the WORLD that requires it, not the thing about the widgets:

- **島上物件** (BuildModeOverlay), a list of what is already placed, with 移動 and
  收回 per row. An island is a landscape where a 火把 is a dozen pixels and an
  object can be behind the house; a room is not.
- **我的家** (`HomePanel.tsx`), the Home's own surface. The Home is not in
  `islandPlacements`, cannot be 收回'd, is the only object wearing an
  appearance, and is the only one you can walk into — three verbs on one
  subject, which is a destination rather than a row in someone else's list.

See docs/build-mode-and-colliders.md.

Keyboard and pointer are always both live: `R` rotates and `Esc` cancels in both
editors, and any UI that offers rotation shows the `R` key-cap next to it.

## Building a shared component: don't hardcode layout you don't always need

This project has no `tailwind-merge`/`clsx` — a component's own hardcoded
classes and a caller's `className` prop are concatenated into one string, not
merged. Two classes that set the **same CSS property** (`position`,
`display`) landing on the same element is a real, silent bug, not just
redundant classes — whichever rule the browser applies last in the compiled
stylesheet wins, and that's not something you control from the call site.

Concretely: `position: relative`, `absolute`, `fixed` all set the same
property, and `flex`/`grid`/`block`/`inline-flex` all set `display`. When a
shared component hardcodes one of these only to support its own **optional**
internal feature (a decoration, a nub, bolt dots — anything gated by a prop
or an `{condition && …}`), gate the class the same way the feature is gated,
so a caller that doesn't use that feature is free to set its own value:

```tsx
// Wrong — always forces `relative`, even for callers that never render the
// dot and need `absolute` themselves:
className={`relative ${dotVisible ? '...' : ''} ${className}`}

// Right — only forces it when the feature that needs it is actually on:
className={`${dotVisible ? 'relative ' : ''}${className}`}
```

`HintBubble`, `SignpostTag`, and `PortholeFrame` all follow this pattern —
each hardcodes `relative` only when their own optional nub/dot/bolt
decoration is actually being rendered. By contrast, `IconTile`'s corner
highlight and `Toggle`'s thumb are unconditional (always rendered), so their
`relative` stays unconditional too — hardcoding is fine, even good, when the
thing it supports is never optional. Layout classes that are simply always
required for the component to do its one job (`ModalShell`'s `flex flex-col`,
`Button`'s `flex items-center justify-center`) are correct to hardcode
unconditionally — the rule is about **optional** internal features, not
about avoiding hardcoded layout altogether.

## Shared component inventory (`DesignKit.tsx`)

Reach for these before hand-rolling anything similar:

- `ModalOverlay` + `ModalShell` + `PanelHeader` — any blocking dialog/panel.
- `Button` (`primary` / `secondary` / `danger` / `ghost`) — any button that
  isn't a `SignpostTag`/`IconTile`.
- `IconTile` (`accent`, `active`, `solid`) — any icon-in-a-rounded-box.
  `active` tints; `solid` fills with the accent at full strength and white ink,
  for a tile sitting on a surface that is itself cream/sand (where a tint
  vanishes). `solid` sets the ink colour, so don't also pass one in `className`.
- `PortholeFrame` — circular instrument-style HUD bezel (avatars, dials).
- `SignpostTag` — HUD tab/button with the dock-plank/signpost silhouette.
- `Toolbar` (`items: ToolbarItem[]`) — an array-driven row of tab buttons
  (grouped into a shared pill) plus standalone action buttons (exit/confirm/
  delete/etc.). Any mode-level control cluster (Build Mode's 領土/建築 tabs +
  "退出編輯") belongs here instead of separately hand-placed/`absolute`
  elements — add, remove, or reorder a tool by editing the `items` array.
- `DockPanel` — the bottom-centre control bar a mode puts up while it owns the
  screen (build toolbar, placement controls, expansion controls). It owns its
  own `absolute bottom-… left-1/2` placement and `z-floating-panel` tier, so a
  caller passes only width/padding/layout — never another bottom offset.
- `DockStatus` — a dock's leading "what am I doing right now" block (eyebrow
  pill + subject + optional meta chip).
- `CurrencyChip` — any coin-amount display.
- `Toggle` — any on/off switch.
- `StatTile` — icon + label + value card.
- `EmptyState` — "nothing here yet" placeholder.
- `HintBubble` — any "explain this UI element" bubble (floating instruction
  card or hover tooltip). Don't hand-roll a new nub/bubble shape.
- `KeyCap` (`sm` / `md`) — the glyph for a keyboard shortcut, shown beside the
  control it duplicates (the `R` next to 旋轉). A shortcut only mentioned in a
  `title` tooltip is one nobody finds.
- `Toast` — any short-lived, non-blocking notification (`z-toast` tier).
  `WeatherToast` and `PettingMiniGame`'s reward toast are both built on this.

Domain pieces that live beside the kit rather than in it, because they read
game state (see "Catalog, shop, inventory…" above):

- `PlacementCatalog.tsx` — `CatalogDrawer` (the right-hand two-layer browse
  drawer: category tiles → an owned/unowned list, with a `compact` pose for
  while a piece is being positioned), `PlacementItemRow` (one row, the same
  design owned or not), `DrawerSectionDivider` + `OWNED_DIVIDER` /
  `UNOWNED_DIVIDER`. Any mode that lets a player choose something to put down.
- `PlacementDock.tsx` — `PlacementDock`, the bottom-centre control bar for
  whatever is being positioned: subject → live verdict → 旋轉 / 收回 / 確認 /
  取消. Optional props are optional because a subject genuinely lacks them (a
  wall piece has no rotation; a fresh copy has nothing to 收回). The verdict
  carries only what is LIVE — how to drag and rotate is the 小天使's line.
  `meta` is a chip, and `DockStatus` wraps its badge row inside roughly 160px:
  a `meta` longer than a few characters drops to a second line and pushes the
  subject's name down. Measure it, don't estimate it.
- `HomePanel.tsx` — 我的家, the Home's management drawer. Built on the same
  shell as `CatalogDrawer` (right-hand, `max-w-md`, `PanelHeader`, two layers
  with a back arrow) and the same rows as every other catalog
  (`PlacementItemRow` + the 已擁有/尚未擁有 dividers), so the house wardrobe is
  not a screen of its own. Exports `facingLabel(rotation)`, the one reading of
  which way the front door points, shared with the placement dock.

- `ItemStock.tsx` — `BuyButton` (購買 / 再購買 / 已擁有 + price) and `StockBadge`
  (庫存 N / 已擁有 M, or 已解鎖). Any card that sells or counts an item.
- `PurchaseDialog.tsx` — the purchase confirmation, wherever gold is spent.
- `UtilityCard.tsx` — `UtilityCardTile` (the 功能卡 card, shared by the limited
  shop and the bag), `UtilityCardArt`, `UtilityCardMeta`, `ActiveEffectChip`
  (「效果進行中」, renders nothing when nothing is running), `UtilityCardBag`
  (the only place a card is used), plus `useNow`/`formatCountdown` for any
  ticking readout.
- `CategoryTabs.tsx` — `MainSectionTabs` / `SubCategoryTabs`, the two taxonomy
  tiers. `SubCategoryTabs` takes `kinds` to narrow a row (build mode passes
  `['placeable']` so appearances-you-apply don't appear among things-you-place).

## Out of scope for token unification

Anything in the "documented exceptions" list above under Color. If you're
unsure whether something is chrome (unify it) or art (leave it), ask: does it
represent what a specific game object/character/material actually looks
like? If yes, it's art.

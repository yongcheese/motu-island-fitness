// Literal material-swatch colors (what a floor/wall style actually looks
// like) — representational, not brand chrome, so these intentionally sit
// outside the --color-island-* token system (see DESIGN_SYSTEM.md's "out of
// scope" list). Single source of truth: BuildingInteriorView's room preview
// and ShopView's flying-item purchase animation both key off item id
// substrings into these same maps instead of maintaining their own copy.
//
// The FLOOR_STYLES values are now only a UI swatch and a fallback: the floor
// itself is drawn procedurally by Three/floorMaterial.ts, which gives each
// style its actual planks / grout / motif / veining. Each colour here is the
// average tone of the material it stands for, so the chip in the shop matches
// the floor the player gets — several used to be badly off (the vintage tile
// chip was slate grey #475569 for a cream-and-teal encaustic pattern).
export const FLOOR_STYLES: Record<string, string> = {
  'default': '#94a3b8',
  'floor-oak': '#c08a4e',
  'floor-white-tile': '#fafcfd',
  'floor-industrial-concrete': '#23272e',
  'floor-vintage-pattern': '#d8c9a6',
  'floor-luxury-marble': '#ece9e2',
};

// Same story as FLOOR_STYLES above, one surface later: the wall itself is now drawn procedurally
// by Three/wallMaterial.ts, so these are the UI swatch and the fallback tint only. Each is the
// AVERAGE tone of the material it stands for — which moved several of them, because a chip taken
// from the brightest part of a mottled plaster or a two-tone stripe sells a wall the player does
// not get. The ceiling plate is tinted with this value too, so it has to be a colour that can sit
// next to the real material without arguing with it.
export const WALL_STYLES: Record<string, string> = {
  'default': '#94a3b8',
  'wall-white': '#f6f1e0',
  'wall-green': '#9da684',
  'wall-blue': '#8fcdec',
  'wall-red': '#8e4437',
  'wall-pink': '#f5dbe4',
  'wall-yellow': '#f5d873',
  'wall-purple': '#e5dbf2',
  'wall-wood-panel': '#5a3d2a',
  'wall-brick-white': '#e7e2da',
  'wall-concrete': '#b0b0ad',
  'wall-stripe-navy': '#5b6a86',
  'wall-terracotta': '#bb7a5b',
  'wall-mint-tile': '#a6dcca',
};

// DEVELOPMENT STAGE - TEMPORARY HOUSE PLACEMENT
// The first two positions are adjusted to move the main left and right houses wider apart 
// to create an elegant, spacious passage of at least 2 player widths between them (at least 5.0+ units clearance)
// while allowing roles to walk comfortably and naturally. Easy to toggle back for modular free placement later.
export const BUILDING_POSITIONS: [number, number, number][] = [
  [-4.5, 0.3, -1.8], // Left house (Moved further left from -3)
  [4.5, 0.3, -1.8],  // Right house (Moved further right from 3)
  [-2.5, 0.3, 2.0],
  [2.5, 0.3, 2.0],
  [0.0, 0.3, -3.5],
  [4.0, 0.3, 1.0],
  [-4.0, 0.3, 0.0],
];


import React from 'react';
import { PlacedItem } from '../types';

export type RoomKey = 'living' | 'kitchen' | 'bathroom' | 'study' | 'fitness' | 'bedroom' | 'warehouse' | 'workshop';

/**
 * Starter furniture placed in a new user's house interior — previously
 * hardcoded identically in three places in AppContext.tsx (new-profile
 * creation, missing-interiorData backfill, empty-placements backfill).
 */
export const DEFAULT_INTERIOR_PLACEMENTS: PlacedItem[] = [
  { instanceId: 'init-living-table', itemId: 'item-22', position: [0, 0, 0], rotation: 0 },
  { instanceId: 'init-living-sofa', itemId: 'item-21', position: [0, 0, -2], rotation: 0 },
  { instanceId: 'init-bathroom-toilet', itemId: 'item-toilet', position: [-14, 0, -3.5], rotation: Math.PI },
  { instanceId: 'init-bathroom-washbasin', itemId: 'item-washbasin', position: [-11.2, 0, -3.5], rotation: Math.PI },
  { instanceId: 'init-bathroom-bathtub', itemId: 'item-bathtub', position: [-9.5, 0, -2], rotation: Math.PI / 2 },
  { instanceId: 'init-study-desk', itemId: 'item-desk', position: [-0.5, 0, 10], rotation: 0 },
  { instanceId: 'init-study-chair', itemId: 'item-chair', position: [-0.5, 0, 11], rotation: Math.PI },
  { instanceId: 'init-study-bookshelf', itemId: 'item-24', position: [3, 0, 13], rotation: -Math.PI / 2 },
];

export const DEFAULT_UNLOCKED_ROOMS: string[] = ['living', 'bathroom', 'study'];

export const ROOM_GRID_SIZE = 12;
export const ROOM_HALF_SIZE = 6;

export interface RoomDef {
  name: string;
  pos: [number, number];
  size: [number, number];
  price: number;
  description: string;
  buff: string;
  styleColor: string;
}

export const ROOM_DEFS: Record<RoomKey, RoomDef> = {
  living: { 
    name: '客廳', 
    pos: [0, 0], 
    size: [ROOM_GRID_SIZE, ROOM_GRID_SIZE],
    price: 0,
    description: '寬敞舒適的家庭聚會平面空間',
    buff: '能量恢復速度 ＋20%',
    styleColor: '#e2e8f0'
  },
  kitchen: { 
    name: '廚房', 
    pos: [ROOM_GRID_SIZE, 0], 
    size: [ROOM_GRID_SIZE, ROOM_GRID_SIZE],
    price: 500,
    description: '美味料理與生活氣息的聚集地',
    buff: '烹飪料理效率 ＋30%',
    styleColor: '#fef3c7'
  },
  bathroom: { 
    name: '衛浴', 
    pos: [-ROOM_GRID_SIZE, 0], 
    size: [ROOM_GRID_SIZE, ROOM_GRID_SIZE],
    price: 300,
    description: '乾淨舒爽的極簡衛浴空間',
    buff: '移動速度 ＋15%',
    styleColor: '#ecfeff'
  },
  study: { 
    name: '書房', 
    pos: [0, ROOM_GRID_SIZE], 
    size: [ROOM_GRID_SIZE, ROOM_GRID_SIZE],
    price: 400,
    description: '安靜沉穩、提供專注閱讀的角落',
    buff: '經驗值獲取 ＋25%',
    styleColor: '#f0fdf4'
  },
  fitness: { 
    name: '健身房', 
    pos: [0, -ROOM_GRID_SIZE], 
    size: [ROOM_GRID_SIZE, ROOM_GRID_SIZE],
    price: 600,
    description: '揮灑汗水、突破自我的運動空間',
    buff: '運動消耗卡路里 ＋20%',
    styleColor: '#f1f5f9'
  },
  bedroom: {
    name: '臥室',
    pos: [ROOM_GRID_SIZE, ROOM_GRID_SIZE],
    size: [ROOM_GRID_SIZE, ROOM_GRID_SIZE],
    price: 500,
    description: '溫馨舒適的完美睡眠和休息環境',
    buff: '最大體力值限制 ＋50',
    styleColor: '#faf5ff'
  },
  warehouse: {
    name: '倉庫',
    pos: [-ROOM_GRID_SIZE, -ROOM_GRID_SIZE],
    size: [ROOM_GRID_SIZE, ROOM_GRID_SIZE],
    price: 350,
    description: '存放物品與整理雜貨的實用空間',
    buff: '金幣獲得加成 ＋15%',
    styleColor: '#fdf8f6'
  },
  workshop: {
    name: '工作室',
    pos: [ROOM_GRID_SIZE, -ROOM_GRID_SIZE],
    size: [ROOM_GRID_SIZE, ROOM_GRID_SIZE],
    price: 700,
    description: '思維碰撞與動手創造的造物工坊',
    buff: '工具消耗速度 －25%',
    styleColor: '#fef2f2'
  }
};

export interface RoomInstance {
  id: string;
  type: RoomKey;
  cx: number;
  cz: number;
  name: string;
}

export function parseUnlockedRooms(unlockedRoomsRaw: string[] | undefined): RoomInstance[] {
  const rooms: RoomInstance[] = [];
  const processedKeys = new Set<string>();

  const list = unlockedRoomsRaw || [];

  list.forEach((roomStr) => {
    if (!roomStr) return;

    if (roomStr.startsWith('ext_')) {
      // Format: ext_[roomType]_[gridX]_[gridZ]_[id]
      const parts = roomStr.split('_');
      if (parts.length >= 5) {
        const type = parts[1] as RoomKey;
        const gridX = parseInt(parts[2], 10);
        const gridZ = parseInt(parts[3], 10);
        const id = parts[4];
        const def = ROOM_DEFS[type];
        if (def) {
          rooms.push({
            id,
            type,
            cx: gridX * ROOM_GRID_SIZE,
            cz: gridZ * ROOM_GRID_SIZE,
            name: def.name
          });
        }
      }
    } else {
      // Legacy predefined room strings (e.g. 'living', 'kitchen', etc.)
      const key = roomStr as RoomKey;
      const def = ROOM_DEFS[key];
      if (def && !processedKeys.has(key)) {
        processedKeys.add(key);
        rooms.push({
          id: key,
          type: key,
          cx: def.pos[0],
          cz: def.pos[1],
          name: def.name
        });
      }
    }
  });

  // Ensure 'living' is always established as a base
  if (!rooms.some(r => r.type === 'living' || r.id === 'living')) {
    rooms.unshift({
      id: 'living',
      type: 'living',
      cx: ROOM_DEFS.living.pos[0],
      cz: ROOM_DEFS.living.pos[1],
      name: ROOM_DEFS.living.name
    });
  }

  // Ensure 'bathroom' is always established as a base
  if (!rooms.some(r => r.type === 'bathroom' || r.id === 'bathroom')) {
    rooms.push({
      id: 'bathroom',
      type: 'bathroom',
      cx: ROOM_DEFS.bathroom.pos[0],
      cz: ROOM_DEFS.bathroom.pos[1],
      name: ROOM_DEFS.bathroom.name
    });
  }

  // Ensure 'study' is always established as a base
  if (!rooms.some(r => r.type === 'study' || r.id === 'study')) {
    rooms.push({
      id: 'study',
      type: 'study',
      cx: ROOM_DEFS.study.pos[0],
      cz: ROOM_DEFS.study.pos[1],
      name: ROOM_DEFS.study.name
    });
  }

  return rooms;
}

/**
 * The room containing a world position, or null if the position is outside every room.
 *
 * The tolerance widens each room by a little past its wall line so that standing exactly in a
 * doorway - which is ON the boundary between two rooms - still resolves to one of them rather
 * than to nothing.
 */
export function findRoomAtPosition(
  x: number,
  z: number,
  rooms: RoomInstance[],
  tolerance = 0.5
): RoomInstance | null {
  const reach = ROOM_HALF_SIZE + tolerance;
  return rooms.find(r => Math.abs(x - r.cx) <= reach && Math.abs(z - r.cz) <= reach) ?? null;
}

/** The room whose centre is closest to a world position. Null only when there are no rooms. */
export function findNearestRoom(x: number, z: number, rooms: RoomInstance[]): RoomInstance | null {
  let best: RoomInstance | null = null;
  let bestDistSq = Infinity;
  for (const r of rooms) {
    const dx = x - r.cx;
    const dz = z - r.cz;
    const distSq = dx * dx + dz * dz;
    if (distSq < bestDistSq) {
      bestDistSq = distSq;
      best = r;
    }
  }
  return best;
}

/**
 * Which room an interior edit (painting a wall, laying a floor) should apply to, given where
 * the player or the build-mode camera currently is.
 *
 * Falls back to the NEAREST room when the position is not inside any: build mode flies a free
 * camera that can easily sit out beyond the walls, and silently doing nothing there would look
 * like the paint button is broken. Picking the nearest room always gives the click an effect,
 * and it is the room the camera is looking at from just outside anyway.
 */
export function resolveEditTargetRoom(
  x: number,
  z: number,
  rooms: RoomInstance[]
): RoomInstance | null {
  return findRoomAtPosition(x, z, rooms) ?? findNearestRoom(x, z, rooms);
}

export interface FurnitureSpawnPoint {
  itemId: string;
  relativePos: [number, number]; // [x_offset, z_offset] relative to room center
  rotation: number;
  /**
   * Height above the floor, for a piece authored to stand ON another piece
   * rather than beside it (the bedroom's 復古提燈 on its 床頭小櫃). Without
   * it both sit at y=0 and the small piece is drawn *inside* the large one —
   * two solids in the same space, which is precisely the intersection the
   * depth buffer cannot order and which shows up as flickering.
   *
   * Author it as the supporting piece's measured height; `npm run
   * audit:placements` re-measures every preset and fails on any pair that
   * still interpenetrates.
   *
   * Preset-authoring only. Placing by hand always lands on the floor, so
   * picking a stacked piece up drops it to y=0 like anything else.
   */
  elevation?: number;
}

export interface RoomTypeConfig {
  roomType: RoomKey;
  wallMaterial: string;          // wall style ID from WALL_STYLES (e.g. 'wall-blue')
  floorMaterial: string;         // floor style ID from FLOOR_STYLES (e.g. 'floor-white-tile')
  defaultFurnitureList: string[]; // List of default item IDs
  furnitureSpawnPoints: FurnitureSpawnPoint[];
  roomFunction: string;          // Character description / label
}

export const ROOM_TYPE_CONFIGS: Record<RoomKey, RoomTypeConfig> = {
  living: {
    roomType: 'living',
    wallMaterial: 'wall-white',
    floorMaterial: 'floor-oak',
    defaultFurnitureList: ['item-22', 'item-21'],
    furnitureSpawnPoints: [
      { itemId: 'item-22', relativePos: [0, 0], rotation: 0 }, // Table at center
      { itemId: 'item-21', relativePos: [0, -2], rotation: 0 }  // Sofa facing forward
    ],
    roomFunction: '起居迎客'
  },
  bathroom: {
    roomType: 'bathroom',
    wallMaterial: 'wall-blue',
    floorMaterial: 'floor-white-tile',
    defaultFurnitureList: ['item-toilet', 'item-washbasin', 'item-bathtub'],
    furnitureSpawnPoints: [
      { itemId: 'item-toilet', relativePos: [-2, -3.5], rotation: Math.PI },
      { itemId: 'item-washbasin', relativePos: [0.8, -3.5], rotation: Math.PI },
      { itemId: 'item-bathtub', relativePos: [2.5, -2], rotation: Math.PI / 2 }
    ],
    roomFunction: '衛浴洗漱'
  },
  kitchen: {
    roomType: 'kitchen',
    wallMaterial: 'wall-yellow',
    floorMaterial: 'floor-vintage-pattern',
    defaultFurnitureList: ['item-cabinet', 'item-stove', 'item-fridge', 'item-cupboard'],
    furnitureSpawnPoints: [
      { itemId: 'item-cabinet', relativePos: [-2.5, -3], rotation: Math.PI },
      { itemId: 'item-stove', relativePos: [0.5, -3], rotation: Math.PI },
      { itemId: 'item-fridge', relativePos: [2.5, -3], rotation: Math.PI },
      { itemId: 'item-cupboard', relativePos: [-2.5, 3], rotation: 0 }
    ],
    roomFunction: '烹飪料理'
  },
  study: {
    roomType: 'study',
    wallMaterial: 'wall-green',
    floorMaterial: 'floor-oak',
    defaultFurnitureList: ['item-desk', 'item-chair', 'item-24'],
    furnitureSpawnPoints: [
      { itemId: 'item-desk', relativePos: [-0.5, -2], rotation: 0 },
      { itemId: 'item-chair', relativePos: [-0.5, -1], rotation: Math.PI },
      { itemId: 'item-24', relativePos: [3, 1], rotation: -Math.PI / 2 }
    ],
    roomFunction: '靜修學習'
  },
  bedroom: {
    roomType: 'bedroom',
    wallMaterial: 'wall-purple',
    floorMaterial: 'floor-oak',
    defaultFurnitureList: ['item-bed', 'item-wardrobe', 'item-nightstand', 'item-30'],
    furnitureSpawnPoints: [
      { itemId: 'item-bed', relativePos: [-2, -2], rotation: 0 },
      { itemId: 'item-wardrobe', relativePos: [3, 1], rotation: -Math.PI / 2 },
      { itemId: 'item-nightstand', relativePos: [1.2, -3], rotation: 0 },
      // The lantern stands ON the nightstand — which is what the nightstand's
      // own description recommends ("適合擺放香氛、書籍或復古提燈"). It used
      // to be authored 0.2 to the side at y=0, which put its body *inside* the
      // cabinet: 0.74 units of interpenetration, and a guaranteed z-fight in
      // every bedroom anyone ever built. Centred on the cabinet and raised to
      // its measured 0.80 top instead.
      { itemId: 'item-30', relativePos: [1.2, -3], rotation: 0, elevation: 0.8 }
    ],
    roomFunction: '起居休憩'
  },
  warehouse: {
    roomType: 'warehouse',
    wallMaterial: 'default',
    floorMaterial: 'floor-industrial-concrete',
    defaultFurnitureList: ['item-crate', 'item-crate', 'item-rack', 'item-rack'],
    furnitureSpawnPoints: [
      { itemId: 'item-crate', relativePos: [-2.2, -2.2], rotation: 0 },
      { itemId: 'item-crate', relativePos: [-2.2, 0.8], rotation: 0.3 },
      { itemId: 'item-rack', relativePos: [3, -1], rotation: -Math.PI / 2 },
      { itemId: 'item-rack', relativePos: [3, 2.5], rotation: -Math.PI / 2 }
    ],
    roomFunction: '儲藏收納'
  },
  workshop: {
    roomType: 'workshop',
    wallMaterial: 'wall-red',
    floorMaterial: 'floor-industrial-concrete',
    defaultFurnitureList: ['item-rack', 'item-torch'],
    furnitureSpawnPoints: [
      { itemId: 'item-rack', relativePos: [-3, -3], rotation: 0 },
      { itemId: 'item-torch', relativePos: [0, 3], rotation: 0 }
    ],
    roomFunction: '動手創造'
  },
  fitness: {
    roomType: 'fitness',
    wallMaterial: 'wall-blue',
    floorMaterial: 'floor-industrial-concrete',
    defaultFurnitureList: ['item-37'],
    furnitureSpawnPoints: [
      { itemId: 'item-37', relativePos: [0, 0], rotation: 0 }
    ],
    roomFunction: '每日鍛鍊'
  }
};

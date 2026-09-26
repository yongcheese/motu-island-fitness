import {
  ROOM_TYPE_CONFIGS, parseUnlockedRooms, resolveEditTargetRoom, findRoomAtPosition,
  ROOM_GRID_SIZE, ROOM_HALF_SIZE, RoomInstance,
} from './src/constants/rooms';
import { FLOOR_STYLES, WALL_STYLES } from './src/constants/materialSwatches';
import type { RoomStyle } from './src/types';

const rooms = parseUnlockedRooms(['living', 'kitchen', 'bathroom', 'study']);
const byId = (id: string) => rooms.find(r => r.id === id)!;

/** Mirrors the resolution chain in BuildingInteriorView's room component. */
function resolve(room: RoomInstance, roomStyles: Record<string, RoomStyle>, legacyFloor?: string, legacyWall?: string) {
  const norm = (v?: string) => (v && v !== 'default' ? v : null);
  const rs = roomStyles[room.id];
  const cfg = ROOM_TYPE_CONFIGS[room.type];
  const floorId = rs?.floor ?? norm(legacyFloor) ?? cfg?.floorMaterial ?? 'default';
  const wallId = rs?.wall ?? norm(legacyWall) ?? cfg?.wallMaterial ?? 'default';
  return { floorId, wallId, floor: FLOOR_STYLES[floorId], wall: WALL_STYLES[wallId] };
}

/** Mirrors handleCreateNewPlacement's style branch. */
function applyStyle(roomStyles: Record<string, RoomStyle>, target: RoomInstance, itemId: string) {
  const isWall = itemId.startsWith('wall-');
  return {
    ...roomStyles,
    [target.id]: { ...(roomStyles[target.id] || {}), [isWall ? 'wall' : 'floor']: itemId },
  };
}

let ok = true;
const check = (label: string, cond: boolean) => {
  if (!cond) ok = false;
  console.log(`  ${cond ? 'ok  ' : 'FAIL'}  ${label}`);
};

console.log('--- 1. Target room resolution ---');
const centre = resolveEditTargetRoom(0, 0, rooms);
const inKitchen = resolveEditTargetRoom(ROOM_GRID_SIZE, 0, rooms);
const inDoorway = resolveEditTargetRoom(ROOM_HALF_SIZE, 0, rooms);          // exactly on the boundary
const wayOutside = resolveEditTargetRoom(90, 90, rooms);                     // build cam far away
const noRoomHit = findRoomAtPosition(90, 90, rooms);
check(`origin -> living (${centre?.name})`, centre?.id === 'living');
check(`x=+12 -> kitchen (${inKitchen?.name})`, inKitchen?.id === 'kitchen');
check(`doorway on boundary still resolves (${inDoorway?.name})`, inDoorway !== null);
check(`far outside is in NO room`, noRoomHit === null);
check(`far outside still falls back to a room (${wayOutside?.name})`, wayOutside !== null);

console.log('\n--- 2. Painting one room does not touch the others ---');
let styles: Record<string, RoomStyle> = {};
styles = applyStyle(styles, byId('kitchen'), 'wall-pink');
styles = applyStyle(styles, byId('kitchen'), 'floor-luxury-marble');

for (const id of ['living', 'kitchen', 'bathroom', 'study']) {
  const r = resolve(byId(id), styles);
  console.log(`    ${id.padEnd(9)} floor=${r.floorId.padEnd(24)} wall=${r.wallId}`);
}
check('kitchen took the pink wall', resolve(byId('kitchen'), styles).wallId === 'wall-pink');
check('kitchen took the marble floor', resolve(byId('kitchen'), styles).floorId === 'floor-luxury-marble');
check('living kept its own default', resolve(byId('living'), styles).wallId === 'wall-white');
check('bathroom kept its own default', resolve(byId('bathroom'), styles).wallId === 'wall-blue');
check('study kept its own default', resolve(byId('study'), styles).wallId === 'wall-green');

console.log('\n--- 3. A second room can differ from the first ---');
styles = applyStyle(styles, byId('study'), 'wall-red');
check('study now red', resolve(byId('study'), styles).wallId === 'wall-red');
check('kitchen still pink', resolve(byId('kitchen'), styles).wallId === 'wall-pink');

console.log('\n--- 4. Legacy house-wide value still honoured where no per-room style exists ---');
const legacy = resolve(byId('bathroom'), styles, 'floor-oak', 'wall-purple');
const legacyOverridden = resolve(byId('kitchen'), styles, 'floor-oak', 'wall-purple');
check('un-painted room uses the legacy house-wide style', legacy.wallId === 'wall-purple' && legacy.floorId === 'floor-oak');
check('per-room style outranks the legacy value', legacyOverridden.wallId === 'wall-pink');

console.log('\n--- 5. Partial styles fall through per field ---');
const wallOnly = applyStyle({}, byId('living'), 'wall-red');
const r5 = resolve(byId('living'), wallOnly);
check('wall applied, floor still the room-type default', r5.wallId === 'wall-red' && r5.floorId === 'floor-oak');

console.log(`\n${ok ? 'ALL PASS' : 'FAILURES'}`);
process.exit(ok ? 0 : 1);

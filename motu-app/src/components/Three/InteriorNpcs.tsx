/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useMemo, useRef } from 'react';
import { useThree } from '@react-three/fiber';
import { useApp } from '../../context/AppContext';
import { INTERIOR_NPCS } from '../../constants/npcs';
import {
  ROOM_INNER_HALF_SIZE,
  INTERIOR_FLOOR_Y,
  buildWalkableRects,
  getRoomNeighbours,
  toShellRooms,
  type ShellRoom,
  type WalkRect,
} from '../../constants/interiorShell';
import { ROOM_GRID_SIZE, ROOM_HALF_SIZE, parseUnlockedRooms } from '../../constants/rooms';
import { resolvePlayerAgainstFurniture } from '../../lib/furniturePlacement';
import type { PlacedItem } from '../../types';
import { NpcTerritory, NpcWalker, NpcWaypoint } from './NpcWalker';
import { HippoFacilityFx, HippoFx, createHippoBrain } from './HippoButler';

/**
 * 家裡的 NPC —— 拿著放大鏡在房間之間巡視、每 10 步就近玩一件設施的河馬管家。
 *
 * 跟 IslandNpcs.tsx 對稱：那邊回答「島上哪裡可以走」，這邊回答「屋裡哪裡可以走」。作息在
 * Three/HippoButler.tsx。
 *
 * 他能站的地方就是 `buildWalkableRects` 算出來的那組矩形，跟玩家能站的地方是同一組規則、只是換
 * 一個身體半徑。穿門是「路線」而不是「尋路」：房間是凸的矩形、門在牆的正中央，所以「房間裡任一
 * 點 → 門口 → 門的另一側 → 隔壁房間裡任一點」這條折線的每一段都完整落在一個凸區域裡。
 */

/** 管家的身體半徑。比玩家的 0.35 大一點：他矮但寬。 */
const NPC_RADIUS = 0.4;

/** 挑房間裡的點時，往內縮的比例。 */
const ROOM_INSET = 0.72;

/** 到站之後有多少機率走去隔壁房間。 */
const DOOR_CHANCE = 0.45;

/** 同一間房裡的新目的地至少要離現在多遠。 */
const MIN_TRIP = 2.5;

const PICK_ATTEMPTS = 12;

const SIDES = [
  { key: 'hasN', dx: 0, dz: 1 },
  { key: 'hasS', dx: 0, dz: -1 },
  { key: 'hasE', dx: 1, dz: 0 },
  { key: 'hasW', dx: -1, dz: 0 },
] as const;

function clamp(v: number, min: number, max: number): number {
  return v < min ? min : v > max ? max : v;
}

function inRect(rect: WalkRect, x: number, z: number): boolean {
  return x >= rect.minX && x <= rect.maxX && z >= rect.minZ && z <= rect.maxZ;
}

export const InteriorNpcs = React.memo(function InteriorNpcs({ isBuildMode }: { isBuildMode: boolean }) {
  const { profile } = useApp();
  const interior = profile?.interiorData;
  const camera = useThree((s) => s.camera);

  const territory = useMemo(() => {
    const rooms: ShellRoom[] = toShellRooms(
      parseUnlockedRooms(Array.from(new Set(['living', ...(interior?.unlockedRooms || [])]))),
    );
    const items = interior?.placements || [];
    const rects = buildWalkableRects(rooms, NPC_RADIUS);
    const inner = ROOM_INNER_HALF_SIZE - NPC_RADIUS;

    const isFree = (x: number, z: number): boolean => {
      const pushed = resolvePlayerAgainstFurniture(x, z, NPC_RADIUS + 0.15, items);
      return pushed.x === x && pushed.z === z;
    };

    /** 站得住：在牆內，而且沒有被家具占著。 */
    const canStand = (x: number, z: number): boolean =>
      rects.some((r) => inRect(r, x, z)) && isFree(x, z);

    const roomAt = (x: number, z: number): ShellRoom | null => {
      let best: ShellRoom | null = null;
      let bestDist = Infinity;
      for (const r of rooms) {
        const d = Math.max(Math.abs(x - r.cx), Math.abs(z - r.cz));
        if (d < bestDist) {
          bestDist = d;
          best = r;
        }
      }
      return best;
    };

    const spotIn = (room: ShellRoom, awayFromX?: number, awayFromZ?: number): NpcWaypoint => {
      for (let i = 0; i < PICK_ATTEMPTS; i++) {
        const x = room.cx + (Math.random() * 2 - 1) * inner * ROOM_INSET;
        const z = room.cz + (Math.random() * 2 - 1) * inner * ROOM_INSET;
        if (awayFromX !== undefined && awayFromZ !== undefined
          && Math.hypot(x - awayFromX, z - awayFromZ) < MIN_TRIP) continue;
        if (!isFree(x, z)) continue;
        return { x, z };
      }
      return { x: room.cx, z: room.cz };
    };

    /** 從 here 穿過 side 那扇門到隔壁房間的兩個門口點（近側那一點等門開）。 */
    const doorway = (here: ShellRoom, side: { dx: number; dz: number }): NpcWaypoint[] => {
      const gate = { x: here.cx + side.dx * ROOM_HALF_SIZE, z: here.cz + side.dz * ROOM_HALF_SIZE };
      return [
        { x: here.cx + side.dx * inner, z: here.cz + side.dz * inner, gate },
        { x: here.cx + side.dx * (ROOM_GRID_SIZE - inner), z: here.cz + side.dz * (ROOM_GRID_SIZE - inner) },
      ];
    };

    const gridOf = (r: ShellRoom) => ({
      gx: Math.round(r.cx / ROOM_GRID_SIZE),
      gz: Math.round(r.cz / ROOM_GRID_SIZE),
    });

    const terr: NpcTerritory = {
      pickRoute(from): NpcWaypoint[] {
        if (rooms.length === 0) return [];
        const here = roomAt(from.x, from.z);
        if (!here) return [];
        const neighbours = getRoomNeighbours(here, rooms);
        const open = SIDES.filter(s => neighbours[s.key]);
        if (open.length > 0 && Math.random() < DOOR_CHANCE) {
          const side = open[Math.floor(Math.random() * open.length)];
          const hg = gridOf(here);
          const next = rooms.find((r) => {
            const g = gridOf(r);
            return g.gx === hg.gx + side.dx && g.gz === hg.gz + side.dz;
          });
          if (next) return [...doorway(here, side), spotIn(next)];
        }
        return [spotIn(here, from.x, from.z)];
      },
      routeTo(from, to) {
        const here = roomAt(from.x, from.z);
        const there = roomAt(to.x, to.z);
        if (!here || !there) return null;
        if (here === there) return [{ x: to.x, z: to.z }];
        // 只走到隔壁：兩間房格子相鄰、而且中間那面牆上真的有門。
        const hg = gridOf(here);
        const tg = gridOf(there);
        const side = SIDES.find((s) => tg.gx === hg.gx + s.dx && tg.gz === hg.gz + s.dz);
        if (!side || !getRoomNeighbours(here, rooms)[side.key]) return null;
        return [...doorway(here, side), { x: to.x, z: to.z }];
      },
      contain(p) {
        const pushed = resolvePlayerAgainstFurniture(p.x, p.z, NPC_RADIUS, items);
        p.x = pushed.x;
        p.z = pushed.z;
        if (rects.length === 0) return;
        if (rects.some(r => inRect(r, p.x, p.z))) return;
        let bestX = p.x;
        let bestZ = p.z;
        let bestDist = Infinity;
        for (const r of rects) {
          const x = clamp(p.x, r.minX, r.maxX);
          const z = clamp(p.z, r.minZ, r.maxZ);
          const d = (x - p.x) * (x - p.x) + (z - p.z) * (z - p.z);
          if (d < bestDist) {
            bestDist = d;
            bestX = x;
            bestZ = z;
          }
        }
        p.x = bestX;
        p.z = bestZ;
      },
      groundY() {
        return INTERIOR_FLOOR_Y;
      },
    };
    return { terr, canStand, items };
  }, [interior]);

  // 腦子只建一次，它看到的家具與地板永遠是最新的那一份。
  const latest = useRef(territory);
  latest.current = territory;
  const cameraRef = useRef(camera);
  cameraRef.current = camera;
  const fx = useMemo(() => new HippoFx(), []);
  const brain = useMemo(() => createHippoBrain({
    fx,
    getPlacements: (): PlacedItem[] => latest.current.items,
    canStand: (x, z) => latest.current.canStand(x, z),
    camera: () => cameraRef.current,
  }), [fx]);

  // 佈置模式下收起來：他的身體會擋住擺放射線，而且卸載會讓腦子放掉手上的設施與聲音。
  if (isBuildMode) return null;

  return (
    <>
      {INTERIOR_NPCS.map((npc) => (
        <NpcWalker
          key={npc.id}
          npcId={npc.id}
          name={npc.name}
          scope="interior"
          kind={npc.kind}
          height={npc.height}
          spawnX={npc.x}
          spawnZ={npc.z}
          spawnRotation={npc.rotation}
          territory={territory.terr}
          opensDoors
          brain={npc.kind === 'hippoButler' ? brain : undefined}
        />
      ))}
      <HippoFacilityFx fx={fx} />
    </>
  );
});

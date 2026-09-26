/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useMemo, useRef } from 'react';
import * as THREE from 'three';
import { useApp } from '../../context/AppContext';
import { ISLAND_NPCS } from '../../constants/npcs';
import { SHORELINE_RADIUS } from '../../constants/terrain';
import { getSurfaceAt } from '../../lib/placementSurfaces';
import { footprintDistanceToPoint, getFootprint, resolvePlayerAgainstFurniture } from '../../lib/furniturePlacement';
import { usePlayerHome } from '../../hooks/usePlayerHome';
import { resolveHomeCollision } from './characterMovement';
import { NpcTerritory, NpcWalker, NpcWaypoint } from './NpcWalker';
import { DigFx, RabbitDigFx, createRabbitBrain } from './RabbitGardener';

/**
 * 島上的 NPC —— 拿著鏟子在島上到處走、每 5 步挖一次土的餅乾兔園丁。
 *
 * 這個檔案回答的是「島上哪裡可以走」與「哪裡可以挖」。走路本身在 Three/NpcWalker.tsx，
 * 作息與挖土在 Three/RabbitGardener.tsx，長相在 Three/Npcs.tsx。
 *
 * 可以走、可以挖的地方，跟玩家自己走得到的地方是同一組規則、同一批函式：`getSurfaceAt` 決定腳下
 * 是陸地、水還是木製平台，`resolveHomeCollision` 是房子的殼，`resolvePlayerAgainstFurniture` 與
 * 家具的量測輪廓是島上擺出來的東西。
 */

/** 她的身體半徑，用來跟房子與家具保持距離。 */
const NPC_RADIUS = 0.3;

/** 她會走到離島心多遠（水線往內縮一圈）。 */
const ROAM_FRACTION = 0.82;

/** 新目的地至少要離現在多遠。 */
const MIN_TRIP = 2.2;

/** 挑點是用亂數試出來的，試這麼多次還挑不到就這一輪不走。 */
const PICK_ATTEMPTS = 14;

/** 土坑的半徑再加一點土堆 —— 這一圈裡每一點都要是能挖的地。 */
const DIG_CLEARANCE = 0.3;
/** 土坑範圍內地面高低差上限。太斜的坡挖出來的坑會一半浮在空中。 */
const DIG_MAX_SLOPE = 0.12;

export const IslandNpcs = React.memo(function IslandNpcs() {
  const { profile } = useApp();
  const home = usePlayerHome(profile);
  const islandScale = 1 + ((profile?.territoryLevel || 1) - 1) * 0.4;
  const placements = profile?.islandPlacements;

  const territory = useMemo(() => {
    const items = placements || [];
    const roam = SHORELINE_RADIUS * islandScale * ROAM_FRACTION;
    const probe = new THREE.Vector3();

    /** 這一點站得住嗎：是陸地、不在房子裡、也不在家具裡。 */
    const isFree = (x: number, z: number): boolean => {
      if (!getSurfaceAt(x, z, items, islandScale).isSolid) return false;
      probe.set(x, 0, z);
      if (home) resolveHomeCollision(probe, home, NPC_RADIUS + 0.2);
      if (probe.x !== x || probe.z !== z) return false;
      const pushed = resolvePlayerAgainstFurniture(x, z, NPC_RADIUS + 0.2, items);
      return pushed.x === x && pushed.z === z;
    };

    /**
     * 這一點能不能挖。
     *
     * 比「站得住」嚴格：木製平台站得住但不能挖（supportId 不是 null），野餐墊這種貼地、走得過去
     * 的東西也不能挖（它沒有走路碰撞，所以另外量它的整個輪廓）。土坑那一圈的每一個取樣點都要
     * 通過，而且地面不能太斜。
     */
    const canDig = (x: number, z: number): boolean => {
      const samples: [number, number][] = [
        [x, z], [x + DIG_CLEARANCE, z], [x - DIG_CLEARANCE, z], [x, z + DIG_CLEARANCE], [x, z - DIG_CLEARANCE],
      ];
      let minY = Infinity;
      let maxY = -Infinity;
      for (const [sx, sz] of samples) {
        const hit = getSurfaceAt(sx, sz, items, islandScale);
        if (!hit.isSolid || hit.supportId !== null) return false;
        minY = Math.min(minY, hit.y);
        maxY = Math.max(maxY, hit.y);
        probe.set(sx, 0, sz);
        if (home) resolveHomeCollision(probe, home, 0.15);
        if (probe.x !== sx || probe.z !== sz) return false;
      }
      if (maxY - minY > DIG_MAX_SLOPE) return false;
      // 岸邊那一圈留給浪。
      if (Math.hypot(x, z) > SHORELINE_RADIUS * islandScale * 0.86) return false;
      for (const item of items) {
        const fp = getFootprint(item.itemId);
        if (!fp) {
          if (Math.hypot(item.position[0] - x, item.position[2] - z) < 0.9) return false;
          continue;
        }
        const d = footprintDistanceToPoint(fp, item.position[0], item.position[2], item.rotation || 0, x, z);
        if (d < DIG_CLEARANCE) return false;
      }
      return true;
    };

    const terr: NpcTerritory = {
      pickRoute(from): NpcWaypoint[] {
        for (let i = 0; i < PICK_ATTEMPTS; i++) {
          const angle = Math.random() * Math.PI * 2;
          // sqrt 是為了讓點在圓面上均勻分布。
          const radius = Math.sqrt(Math.random()) * roam;
          const x = Math.cos(angle) * radius;
          const z = Math.sin(angle) * radius;
          if (Math.hypot(x - from.x, z - from.z) < MIN_TRIP) continue;
          if (!isFree(x, z)) continue;
          return [{ x, z }];
        }
        return [];
      },
      routeTo(_from, to) {
        // 島是一片開闊地，直線走過去；途中被家具推開由 contain 處理，走不通由卡住偵測處理。
        return isFree(to.x, to.z) ? [{ x: to.x, z: to.z }] : null;
      },
      contain(p) {
        if (home) resolveHomeCollision(p, home, NPC_RADIUS);
        const pushed = resolvePlayerAgainstFurniture(p.x, p.z, NPC_RADIUS, items);
        p.x = pushed.x;
        p.z = pushed.z;
        if (!getSurfaceAt(p.x, p.z, items, islandScale).isSolid) {
          const shore = SHORELINE_RADIUS * islandScale * 0.94;
          const dist = Math.hypot(p.x, p.z);
          if (dist > shore && dist > 1e-6) {
            p.x *= shore / dist;
            p.z *= shore / dist;
          }
        }
      },
      groundY(x, z) {
        return getSurfaceAt(x, z, items, islandScale).y;
      },
    };
    return { terr, isFree, canDig };
  }, [placements, islandScale, home]);

  // 腦子只建一次；它問的「能不能挖」永遠是最新的那一份（家具搬動、領土升級之後）。
  const latest = useRef(territory);
  latest.current = territory;
  const fx = useMemo(() => new DigFx(), []);
  const brain = useMemo(() => createRabbitBrain({
    fx,
    canDig: (x, z) => latest.current.canDig(x, z),
    canStand: (x, z) => latest.current.isFree(x, z),
  }), [fx]);

  return (
    <>
      {ISLAND_NPCS.map((npc) => (
        <NpcWalker
          key={npc.id}
          npcId={npc.id}
          name={npc.name}
          scope="island"
          kind={npc.kind}
          height={npc.height}
          spawnX={npc.x * islandScale}
          spawnZ={npc.z * islandScale}
          spawnRotation={npc.rotation}
          territory={territory.terr}
          brain={npc.kind === 'cookieRabbit' ? brain : undefined}
        />
      ))}
      <RabbitDigFx fx={fx} />
    </>
  );
});

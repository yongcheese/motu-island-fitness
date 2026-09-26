/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useMemo, memo } from 'react';
import * as THREE from 'three';
import { useApp } from '../../context/AppContext';
import { getResolvedRockPositions, getRockScale } from '../../utils/placementRules';
import { usePlayerHome } from '../../hooks/usePlayerHome';
import { useCameraBlocker } from '../../constants/layers';
import { GroundCover } from './GroundCover';
import { getTerrainMaterial, setTerrainIslandScale } from './groundMaterial';
import {
  ISLAND_SURFACE_Y,
  ISLAND_TERRAIN,
  MOUND_BASE_SINK,
  MOUND_COLOR,
  PLATEAU_INNER_COLOR,
  PLATEAU_OUTER_COLOR,
} from '../../constants/terrain';

export function Island() {
  const { profile } = useApp();
  const territoryLevel = profile?.territoryLevel || 1;
  const islandScale = 1 + (territoryLevel - 1) * 0.4; // Increased growth to 40% per level
  const solidTerrainRef = useCameraBlocker<THREE.Group>();

  /**
   * The terrain materials read the shared ground field in LOCAL island units, so they need the
   * XZ scale this group applies. Set during render rather than in an effect because the very
   * first frame after a territory upgrade is drawn before effects flush, and a frame of the
   * island shaded at the previous scale is a visible jump in the lawn's pattern.
   */
  setTerrainIslandScale(islandScale);

  return (
    <>
    <group scale={[islandScale, 1, islandScale]}>
      {/* Main Island Body.

          The plateau, the skirt and the underside are three meshes that meet
          edge-to-edge and never overlap, rather than a solid cylinder with a
          second, slightly-taller cylinder stacked on it. That stack used to put
          two opaque discs 0.02 apart across the whole r=4.5 centre of the
          island, which is far finer than the depth buffer can resolve at this
          camera distance - the plateau flickered between two greens as the
          camera moved. The lighter green the upper disc contributed is now a
          vertex-coloured band on the plateau itself (PlateauSurface), the same
          way SandEdge has always handled its dry -> wet transition. */}
      <PlateauSurface />

      {/* Body skirt - open-ended, so it contributes no cap of its own to
          conflict with the plateau it shares a rim with.

          Takes the 'shore' grading: grain, and nothing else. A vertical face has no slope to
          express, and pulling its colour around with the lushness field would recolour the
          island's own cliff by how much grass happens to be growing on top of it. */}
      <mesh
        position={[0, (ISLAND_SURFACE_Y + ISLAND_TERRAIN.baseY) / 2, 0]}
        receiveShadow
        material={getTerrainMaterial('shore', PLATEAU_OUTER_COLOR)}
      >
        <cylinderGeometry
          args={[
            ISLAND_TERRAIN.plateauRadius,
            ISLAND_TERRAIN.baseRadius,
            ISLAND_SURFACE_Y - ISLAND_TERRAIN.baseY,
            32,
            1,
            true,
          ]}
        />
      </mesh>

      {/* Underside. Only ever seen through the water from a low angle, but the
          skirt above is open-ended so something has to close it. */}
      <mesh position={[0, ISLAND_TERRAIN.baseY, 0]} rotation={[Math.PI / 2, 0, 0]}>
        <circleGeometry args={[ISLAND_TERRAIN.baseRadius, 32]} />
        <meshStandardMaterial color={PLATEAU_OUTER_COLOR} />
      </mesh>

      {/* Raised terrain - a structure, so it blocks both the camera and interaction prompts (see
          constants/layers.ts), and the only part of the island that opts into either. The flat
          plateau, the skirt, the underside,
          the sand and the grass are all deliberately left out: the camera is clamped above ground
          level and every prompt anchor floats above its target, so a flat surface can never come
          between the two - it would only cost triangle tests. Grass exclusion also fixes a real
          glitch, where a blade clipping the sightline counted as "blocked" and blinked the prompt
          out with nothing actually in front of it. */}
      <group ref={solidTerrainRef}>
        {/* Raised mounds. Each clears the plateau by well over
            MIN_SURFACE_SEPARATION, so these are genuine elevation changes rather
            than duplicate surfaces, and their buried bottom caps are hidden by
            the plateau instead of fighting it. */}
        {ISLAND_TERRAIN.mounds.map((m, i) => {
          // Sunk into the plateau so the skirt reads as emerging from the ground
          // rather than as a disc resting on it. The depth is shared with the
          // walk height (MOUND_BASE_SINK) because it sets the slope's steepness,
          // and a walker has to be able to stand on the slope that is drawn.
          const bottomY = ISLAND_SURFACE_Y - MOUND_BASE_SINK;
          return (
            <mesh
              key={i}
              position={[m.cx, (m.topY + bottomY) / 2, m.cz]}
              receiveShadow
              material={getTerrainMaterial('mound', MOUND_COLOR)}
            >
              {/* 32 sides rather than 12. The walk height treats the mound as a
                  circle, and a 12-gon's flat top pulls in 8.5cm from that circle
                  at each facet's midpoint - which is 8.5cm of ground missing from
                  under the feet of anyone walking near the rim. At 32 the two
                  disagree by ~1cm, below the sole depth the rig already has. */}
              <cylinderGeometry args={[m.radiusTop, m.radiusBottom, m.topY - bottomY, 32]} />
            </mesh>
          );
        })}

        {/* Rocky Outcrops */}
        <RockyTerrain islandScale={islandScale} />
      </group>

      {/* Sand Edge - dry sand grades into wet sand, then fades toward the
          waterline so the beach doesn't cut hard into the ocean mesh */}
      <SandEdge />
    </group>

    {/* 地被層 —— the lawn (Three/GroundCover.tsx).

        A SIBLING of the island group rather than a child, and that placement is the whole
        reason it is not still inside: everything above is drawn inside
        `scale={[islandScale, 1, islandScale]}`, which is right for a disc and wrong for
        anything STANDING on it. A blade in that group is stretched 2.6x horizontally and not
        at all vertically on a level-5 island. Out here it works in world units and stays the
        same shape however far the territory grows. */}
    <GroundCover islandScale={islandScale} />
    </>
  );
}

/**
 * The single flat surface the island is walked on, drawn once.
 *
 * A ring with `innerRadius` 0 is a disc built from concentric rows of vertices,
 * unlike a cylinder cap (a fan from one centre vertex) or a circle, so it can
 * carry the radial colour band that replaced the old stacked terrain layer.
 * The band is a smoothstep across exactly the radii that layer occupied - its
 * flat top at 4.5 and the base of its skirt at 4.8 - so the plateau reads the
 * same from above as it did while being two meshes.
 */
function PlateauSurface() {
  const geometry = useMemo(() => {
    const { plateauRadius, innerTintRadius, innerTintFadeRadius } = ISLAND_TERRAIN;
    // 32 concentric rows: enough for the tint to grade smoothly rather than
    // stepping between rows, and still a trivial vertex count for a static mesh.
    const geo = new THREE.RingGeometry(0, plateauRadius, 32, 32);
    const posAttr = geo.attributes.position;
    const colors = new Float32Array(posAttr.count * 3);

    const inner = new THREE.Color(PLATEAU_INNER_COLOR);
    const outer = new THREE.Color(PLATEAU_OUTER_COLOR);
    const c = new THREE.Color();

    for (let i = 0; i < posAttr.count; i++) {
      // RingGeometry is authored in the XY plane; the mesh rotates it flat.
      const r = Math.hypot(posAttr.getX(i), posAttr.getY(i));
      const t = THREE.MathUtils.smoothstep(r, innerTintRadius, innerTintFadeRadius);
      c.copy(inner).lerp(outer, t);
      colors[i * 3] = c.r;
      colors[i * 3 + 1] = c.g;
      colors[i * 3 + 2] = c.b;
    }

    geo.setAttribute('color', new THREE.BufferAttribute(colors, 3));
    return geo;
  }, []);

  return (
    <mesh
      position={[0, ISLAND_SURFACE_Y, 0]}
      rotation={[-Math.PI / 2, 0, 0]}
      geometry={geometry}
      receiveShadow
      // White base, because this mesh's colour arrives as the vertex attribute above; the
      // material multiplies it and then grades it against the shared ground field. See
      // groundMaterial.ts for why the two greens stay here rather than moving into the shader.
      material={getTerrainMaterial('plateau', '#ffffff', true)}
    />
  );
}

function SandEdge() {
  const geometry = useMemo(() => {
    // Extra height segments so the vertex-color gradient below has enough
    // rows to approximate a smooth (non-linear) dry -> wet -> submerged curve.
    const geo = new THREE.CylinderGeometry(5.93, 7.07, 0.8, 32, 24);
    const posAttr = geo.attributes.position;
    const colors = new Float32Array(posAttr.count * 3);

    const dry = new THREE.Color('#fef08a');
    const wet = new THREE.Color('#b8823a');
    const submerged = wet.clone().lerp(new THREE.Color('#2dd4bf'), 0.45);
    const c = new THREE.Color();

    for (let i = 0; i < posAttr.count; i++) {
      const y = posAttr.getY(i);
      // Local y=+0.4 is the dry inland top; local y=-0.25 sits at the
      // waterline (world y=-0.5); local y=-0.4 is the fully submerged bottom.
      // The bands are spread across most of the visible slope (not just a
      // sliver right at the shoreline) so the gradient reads clearly under
      // the scene's lighting/tone-mapping, per the coastline transition request.
      const dryToWet = 1 - THREE.MathUtils.smoothstep(y, -0.05, 0.3);
      c.copy(dry).lerp(wet, dryToWet);
      const wetToSubmerged = 1 - THREE.MathUtils.smoothstep(y, -0.35, -0.1);
      c.lerp(submerged, wetToSubmerged);
      colors[i * 3] = c.r;
      colors[i * 3 + 1] = c.g;
      colors[i * 3 + 2] = c.b;
    }

    geo.setAttribute('color', new THREE.BufferAttribute(colors, 3));
    return geo;
  }, []);

  return (
    <mesh
      position={[0, -0.25, 0]}
      geometry={geometry}
      material={getTerrainMaterial('shore', '#ffffff', true)}
    />
  );
}

function RockyTerrain({ islandScale }: { islandScale: number }) {
  const { profile } = useApp();

  // Rocks are pushed clear of the player's Home so they never poke through its walls.
  const home = usePlayerHome(profile);

  const rocks = useMemo(() => {
    // Get resolved positions. The getResolvedRockPositions function handles auto-pushing
    const resolvedPositions = getResolvedRockPositions(islandScale, home);

    return resolvedPositions.map((resolvedPos, i) => ({
      // Note: resolvedPos is already scaled by islandScale inside getResolvedRockPositions.
      // Since it is inside the scale={[islandScale, 1, islandScale]} root group,
      // we need to divide by islandScale to counteract the double-scaling!
      position: [resolvedPos[0] / islandScale, resolvedPos[1], resolvedPos[2] / islandScale] as [number, number, number],
      // Shared with the walk height, which has to know how big the rock it is putting the
      // player on top of actually is - see getRockScale.
      scale: getRockScale(i),
      rotation: [i * 0.5, i * 0.8, i * 1.2] as [number, number, number]
    }));
  }, [islandScale, home]);

  return (
    <group>
      {rocks.map((rock, i) => (
        <mesh key={i} position={rock.position} scale={rock.scale} rotation={rock.rotation} castShadow receiveShadow>
          <dodecahedronGeometry args={[1, 0]} />
          <meshStandardMaterial color="#64748b" roughness={0.9} />
        </mesh>
      ))}
    </group>
  );
}


/*
 * DELETED: `Grass` / `GrassMemo` — 520 identical 4 cm boxes on a uniform `sqrt(random()) * 5.1`
 * scatter, one colour, one size, half of every blade buried below the plateau.
 *
 * It is now Three/GroundCover.tsx, drawn from constants/groundCover.ts and scattered against the
 * shared field in lib/groundField.ts. Three things moved rather than being added on top of it:
 * the vertex-shader wind (kept, but as a height-weighted BEND so the roots cannot lift out of
 * the ground, and driven by the island's one wind clock rather than a private `elapsedTime`),
 * the single InstancedMesh (kept, now one per layer), and the density (no longer uniform — it is
 * whatever the ground material is already shading as lush).
 */

import React, { useRef } from 'react';
import { useFrame, useThree } from '@react-three/fiber';
import { OrbitControls } from '@react-three/drei';
import * as THREE from 'three';
import { useApp } from '../../context/AppContext';
import { View, CameraMode } from '../../types';
import { parseUnlockedRooms, ROOM_GRID_SIZE, ROOM_HALF_SIZE } from '../../constants/rooms';
import { FIRST_PERSON_ZOOM } from '../../constants/cameraZoom';

interface CameraRigProps {
  minDistance?: number;
  maxDistance?: number;
  minPolarAngle?: number;
  maxPolarAngle?: number;
  isBuildMode?: boolean;
}

const SECOND_PERSON_POS_ISLAND = new THREE.Vector3(15, 8, 15);
const SECOND_PERSON_POS_INTERIOR = new THREE.Vector3(8, 4, 8);

export function CameraRig({ 
  minDistance = 4.5, 
  maxDistance = 18,
  minPolarAngle = Math.PI / 10,
  maxPolarAngle = Math.PI / 2.1,
  isBuildMode = false
}: CameraRigProps) {
  const { camera, scene, gl } = useThree();
  const controlsRef = useRef<any>(null);
  const { joystickData, orbitJoystickData, uiScale, setUiScale, currentView, cameraMode, profile } = useApp();
  const raycaster = useRef(new THREE.Raycaster());
  const prevBuildMode = React.useRef(isBuildMode);
  const idealCamPosRef = React.useRef<THREE.Vector3 | null>(null);
  const wasFirstPersonRef = React.useRef(false);
  const lastTargetRef = React.useRef<THREE.Vector3 | null>(null);
  
  const keysRef = React.useRef({ w: false, a: false, s: false, d: false });

  const lastActiveRoomIdRef = React.useRef<string | null>(null);
  const transitionProgressRef = React.useRef<number>(1.0); // 1.0 means transition complete
  const transitionStartCamPos = React.useRef<THREE.Vector3>(new THREE.Vector3());
  const transitionStartTarget = React.useRef<THREE.Vector3>(new THREE.Vector3());

  const ensurePolyfills = (controls: any) => {
    if (!controls) return;
    if (!controls.setPolarAngle) {
      controls.setPolarAngle = (angle: number) => {
        const target = controls.target;
        const offset = camera.position.clone().sub(target);
        const spherical = new THREE.Spherical().setFromVector3(offset);
        spherical.phi = angle;
        offset.setFromSpherical(spherical);
        camera.position.copy(target).add(offset);
      };
    }
    if (!controls.setAzimuthalAngle) {
      controls.setAzimuthalAngle = (angle: number) => {
        const target = controls.target;
        const offset = camera.position.clone().sub(target);
        const spherical = new THREE.Spherical().setFromVector3(offset);
        spherical.theta = angle;
        offset.setFromSpherical(spherical);
        camera.position.copy(target).add(offset);
      };
    }
  };

  React.useEffect(() => {
    const handleWheel = (e: WheelEvent) => {
      if (currentView !== View.HOME && currentView !== View.BUILDING_INTERIOR) {
        return;
      }
      
      // Let scrollable containers handle wheel events naturally
      let target = e.target as HTMLElement | null;
      while (target && target !== document.body) {
        const style = window.getComputedStyle(target);
        if (
          target.scrollHeight > target.clientHeight ||
          target.scrollWidth > target.clientWidth ||
          style.overflowY === 'auto' ||
          style.overflowY === 'scroll' ||
          style.overflowX === 'auto' ||
          style.overflowX === 'scroll' ||
          target.classList.contains('overflow-y-auto') ||
          target.classList.contains('overflow-x-auto') ||
          target.classList.contains('custom-scrollbar') ||
          target.classList.contains('no-scrollbar') ||
          target.classList.contains('custom-scrollbar-brown')
        ) {
          return;
        }
        target = target.parentElement;
      }

      e.preventDefault();
      const zoomDir = e.deltaY < 0 ? 1 : -1;
      const step = 0.05;
      setUiScale((prev: number) => {
        const next = prev + zoomDir * step;
        return Math.max(0.5, Math.min(next, 2.0));
      });
    };
    window.addEventListener('wheel', handleWheel, { passive: false });
    return () => {
      window.removeEventListener('wheel', handleWheel);
    };
  }, [currentView, setUiScale]);
  
  React.useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      const key = e.key.toLowerCase();
      if (key === 'w' || e.key === 'ArrowUp') keysRef.current.w = true;
      if (key === 's' || e.key === 'ArrowDown') keysRef.current.s = true;
      if (key === 'a' || e.key === 'ArrowLeft') keysRef.current.a = true;
      if (key === 'd' || e.key === 'ArrowRight') keysRef.current.d = true;
    };
    const handleKeyUp = (e: KeyboardEvent) => {
      const key = e.key.toLowerCase();
      if (key === 'w' || e.key === 'ArrowUp') keysRef.current.w = false;
      if (key === 's' || e.key === 'ArrowDown') keysRef.current.s = false;
      if (key === 'a' || e.key === 'ArrowLeft') keysRef.current.a = false;
      if (key === 'd' || e.key === 'ArrowRight') keysRef.current.d = false;
    };
    window.addEventListener('keydown', handleKeyDown);
    window.addEventListener('keyup', handleKeyUp);
    return () => {
      window.removeEventListener('keydown', handleKeyDown);
      window.removeEventListener('keyup', handleKeyUp);
    };
  }, []);
  
  React.useEffect(() => {
    ensurePolyfills(controlsRef.current);
    idealCamPosRef.current = null;
    if (controlsRef.current) {
      const isInterior = currentView === View.BUILDING_INTERIOR;
      
      if (isInterior) {
        if (isBuildMode && !prevBuildMode.current) {
          console.log("[CameraRig] Transitioning to build/edit mode. Seeding high diagonal bird's-eye angle.");
          const playerPos = (window as any).playerPos as THREE.Vector3 | undefined;
          const targetPoint = playerPos ? playerPos.clone() : new THREE.Vector3(0, 0, 0);
          
          controlsRef.current.target.copy(targetPoint);
          // Set diagonal elevated angle (X offset: ~1 unit, Y height: ~11 units, Z offset: ~13 units)
          const highOffset = new THREE.Vector3(1, 11, 13);
          camera.position.copy(targetPoint).add(highOffset);
          
          controlsRef.current.setPolarAngle(Math.PI / 4.5); // High diagonal look-down angle (~40 degrees)
          controlsRef.current.minDistance = 1.0;
          controlsRef.current.maxDistance = 50.0;
          controlsRef.current.update();
        } else if (!isBuildMode) {
          console.log("[CameraRig] Centering camera inside BUILDING_INTERIOR dynamically to prevent blocked perspective.");
          const playerPos = (window as any).playerPos as THREE.Vector3 | undefined;
          if (playerPos) {
            const targetPoint = new THREE.Vector3(playerPos.x, playerPos.y + 1.8, playerPos.z);
            controlsRef.current.target.copy(targetPoint);
            
            const cameraOffset = new THREE.Vector3(0, 3.5, 3.5);
            camera.position.copy(targetPoint).add(cameraOffset);
          }
          
          controlsRef.current.setPolarAngle(Math.PI / 3); // 60-degree angle
          controlsRef.current.minDistance = 0.5;
          controlsRef.current.maxDistance = 5.5;
          controlsRef.current.update();
        }
      }
    }
    prevBuildMode.current = isBuildMode;
  }, [currentView, cameraMode, camera, isBuildMode]);
  
  useFrame((state, delta) => {
    ensurePolyfills(controlsRef.current);
    const playerPos = (window as any).playerPos as THREE.Vector3 | undefined;
    if (playerPos && controlsRef.current) {
      const isInterior = currentView === View.BUILDING_INTERIOR;
      const isDressing = currentView === View.DRESSING_ROOM;
      let currentFocusY = 1.8;
      const baseHeadHeight = isInterior ? (0.68 * 1.35) : (0.68 * 2.25);
      if (!isBuildMode && uiScale > 1.5) {
        const t = (uiScale - 1.5) / 0.5;
        currentFocusY = THREE.MathUtils.lerp(1.8, baseHeadHeight, t);
      }
      const targetPoint = new THREE.Vector3(playerPos.x, playerPos.y + currentFocusY, playerPos.z);

      // Shift camera and OrbitControls target by the targetPoint translation delta
      // to keep relative camera offset 100% stable during player translation,
      // especially in first person where the offset is tiny and prone to wild rotation.
      if (lastTargetRef.current && !isBuildMode && !isDressing) {
        const deltaTranslation = new THREE.Vector3().subVectors(targetPoint, lastTargetRef.current);
        camera.position.add(deltaTranslation);
        controlsRef.current.target.add(deltaTranslation);
      }
      lastTargetRef.current = targetPoint.clone();

      const roomsList = parseUnlockedRooms(profile?.interiorData?.unlockedRooms);
      
      // Determine the active room and handle smooth room transitions
      let activeRoom = roomsList[0];
      if (isInterior) {
        const refPos = isBuildMode ? controlsRef.current.target.clone() : targetPoint.clone();
        const detectedActive = getActiveRoom(refPos.x, refPos.z, roomsList);
        if (detectedActive) {
          activeRoom = detectedActive;
        }

        // Detect if active room changed to trigger seamless 0.2-0.4s glide transition
        if (lastActiveRoomIdRef.current === null) {
          lastActiveRoomIdRef.current = activeRoom.id;
        } else if (lastActiveRoomIdRef.current !== activeRoom.id) {
          lastActiveRoomIdRef.current = activeRoom.id;
          transitionProgressRef.current = 0.0;
          transitionStartCamPos.current.copy(camera.position);
          transitionStartTarget.current.copy(controlsRef.current.target);
        }

        // Progress transition factor smoothly
        const transitionDuration = 0.35; // 0.35 seconds
        if (transitionProgressRef.current < 1.0) {
          transitionProgressRef.current = Math.min(1.0, transitionProgressRef.current + delta / transitionDuration);
        }
      }
      
      if (!isBuildMode && cameraMode !== CameraMode.SECOND_PERSON && uiScale < FIRST_PERSON_ZOOM) {
        if (idealCamPosRef.current) {
          camera.position.copy(idealCamPosRef.current);
        }
      }
      
      if (isDressing) {
        // 更衣室視角：極近距離，專注於角色
        const targetDist = 2.5;
        const targetPointAdjusted = new THREE.Vector3(playerPos.x, playerPos.y + 1.2, playerPos.z);
        
        controlsRef.current.minDistance = 2.5;
        controlsRef.current.maxDistance = 2.5;
        controlsRef.current.target.lerp(targetPointAdjusted, 0.45);
        
        // 允許環繞旋轉預覽角色
        if (orbitJoystickData && (Math.abs(orbitJoystickData.x) > 0.01 || Math.abs(orbitJoystickData.y) > 0.01)) {
          const orbitSpeed = 4.0;
          const currentAzimuth = controlsRef.current.getAzimuthalAngle();
          controlsRef.current.setAzimuthalAngle(currentAzimuth - orbitJoystickData.x * orbitSpeed * delta);
        }
        
        controlsRef.current.update();
      } else if (isInterior && isBuildMode) {
        // 編輯模式：改由使用者自由控制、旋轉、平移、縮放視角。這裡不執行強行跟隨玩家或限制 min/max 距離
        const front = new THREE.Vector3();
        camera.getWorldDirection(front);
        
        const right = new THREE.Vector3();
        right.crossVectors(front, camera.up).normalize();
        
        front.y = 0;
        front.normalize();
        right.y = 0;
        right.normalize();
        
        const moveDir = new THREE.Vector3(0, 0, 0);
        if (keysRef.current.w) moveDir.add(front);
        if (keysRef.current.s) moveDir.sub(front);
        if (keysRef.current.a) moveDir.sub(right);
        if (keysRef.current.d) moveDir.add(right);
        
        if (joystickData && (Math.abs(joystickData.x) > 0.01 || Math.abs(joystickData.y) > 0.01)) {
          const joyRightVec = right.clone().multiplyScalar(joystickData.x);
          const joyFrontVec = front.clone().multiplyScalar(joystickData.y);
          moveDir.add(joyRightVec).add(joyFrontVec);
        }
        
        if (moveDir.lengthSq() > 0) {
          moveDir.normalize();
          // Navigation speed is optimized and halved for precise build mode movement
          const speed = 2.5; 
          const translation = moveDir.multiplyScalar(speed * delta);
          
          controlsRef.current.target.add(translation);
          camera.position.add(translation);
        }
        
        // 編輯模式下的視野縮放連動
        const buildTargetFov = 55.0 / uiScale;
        if (camera instanceof THREE.PerspectiveCamera) {
          camera.fov = THREE.MathUtils.lerp(camera.fov, buildTargetFov, 0.1);
          camera.updateProjectionMatrix();
        }
        
        // Control horizontal orbit rotation in decoration mode using the orbit joystick (on mobile, locked horizontally):
        if (orbitJoystickData && (Math.abs(orbitJoystickData.x) > 0.01 || Math.abs(orbitJoystickData.y) > 0.01)) {
          const orbitSpeed = 2.0; // Halved for steady rotation
          const currentAzimuth = controlsRef.current.getAzimuthalAngle();
          controlsRef.current.setAzimuthalAngle(currentAzimuth - orbitJoystickData.x * orbitSpeed * delta);
          
          // Fixed vertical polar angle to ensure stable horizontal-only view
          controlsRef.current.setPolarAngle(Math.PI / 4.5);
        }
        
        // Keep target strictly inside the house boundaries to restrict view area (margin = 0.4)
        const tgtClamped = clampPointToHouse(controlsRef.current.target.x, controlsRef.current.target.z, roomsList, 0.4);
        controlsRef.current.target.x = tgtClamped.x;
        controlsRef.current.target.z = tgtClamped.z;
        controlsRef.current.target.y = Math.max(0.0, Math.min(3.0, controlsRef.current.target.y));

        // Keep camera strictly inside the active room boundaries (margin = 0.5)
        const camClamped = clampPointToHouse(camera.position.x, camera.position.z, [activeRoom], 0.5);
        const targetCamPos = new THREE.Vector3(camClamped.x, Math.max(0.4, Math.min(4.45, camera.position.y)), camClamped.z);

        // Apply transition interpolation if active in build mode!
        if (transitionProgressRef.current < 1.0 && transitionStartCamPos.current.lengthSq() > 0) {
          const clampedStartCamPos = transitionStartCamPos.current.clone();
          const clampedStartCamXZ = clampPointToHouse(clampedStartCamPos.x, clampedStartCamPos.z, [activeRoom], 0.5);
          clampedStartCamPos.x = clampedStartCamXZ.x;
          clampedStartCamPos.z = clampedStartCamXZ.z;
          clampedStartCamPos.y = Math.max(0.40, Math.min(4.45, clampedStartCamPos.y));

          const progress = transitionProgressRef.current;
          const easeProgress = progress < 0.5 ? 4 * progress * progress * progress : 1 - Math.pow(-2 * progress + 2, 3) / 2;

          const lerpedCamPos = new THREE.Vector3().lerpVectors(clampedStartCamPos, targetCamPos, easeProgress);
          camera.position.copy(lerpedCamPos);
        } else {
          camera.position.copy(targetCamPos);
        }

        controlsRef.current.update();
      } else if (cameraMode === CameraMode.SECOND_PERSON) {
        // 第一人稱視角 (射擊遊戲風格)：極近距離 (角色眼睛位置)
        const targetDist = 0.01;
        const targetPointAdjusted = new THREE.Vector3(playerPos.x, playerPos.y + 1.65, playerPos.z);
        
        controlsRef.current.minDistance = 0.01;
        controlsRef.current.maxDistance = 0.01;
        controlsRef.current.target.lerp(targetPointAdjusted, 0.45);

        // 第一人稱下的視野縮放連動
        const fpTargetFov = 60.0 / uiScale;
        if (camera instanceof THREE.PerspectiveCamera) {
          camera.fov = THREE.MathUtils.lerp(camera.fov, fpTargetFov, 0.1);
          camera.updateProjectionMatrix();
        }

        // 允許室內旋轉（只在手動使用搖桿或滑鼠拖曳時旋轉方向，移動時不自動強行跟隨旋轉）
        const hasJoystickInput = orbitJoystickData && (Math.abs(orbitJoystickData.x) > 0.01 || Math.abs(orbitJoystickData.y) > 0.01);
        if (hasJoystickInput) {
          const orbitSpeed = 2.4; 
          const currentAzimuth = controlsRef.current.getAzimuthalAngle();
          controlsRef.current.setAzimuthalAngle(currentAzimuth - orbitJoystickData.x * orbitSpeed * delta);
          
          const polarSpeed = 1.8; 
          const currentPolar = controlsRef.current.getPolarAngle();
          const nextPolar = THREE.MathUtils.clamp(
            currentPolar + orbitJoystickData.y * polarSpeed * delta,
            Math.PI / 6, 
            Math.PI / 1.2
          );
          controlsRef.current.setPolarAngle(nextPolar);
        }
      } else {
        // -------------------------------------------------------------
        // UNIFIED PLAY SYSTEM (Indoors & Outdoors)
        // -------------------------------------------------------------
        
        // Map uiScale to camera distance to zoom the view seamlessly 
        const t = uiScale > 1.5 ? (uiScale - 1.5) / 0.5 : 0;
        const targetDist = uiScale > 1.5
          ? THREE.MathUtils.lerp(7.0 / 1.5, 0.001, t)
          : 7.0 / uiScale;

        if (uiScale >= FIRST_PERSON_ZOOM) {
          // First-person play mode
          if (!wasFirstPersonRef.current) {
            const charRot = (window as any).playerRotation !== undefined ? (window as any).playerRotation : 0;
            // OrbitControls azimuth angle is rotated Math.PI from camera view, so to face same forward:
            controlsRef.current.setAzimuthalAngle(charRot + Math.PI);
            // Look straight ahead horizontally
            controlsRef.current.setPolarAngle(Math.PI / 2);
            wasFirstPersonRef.current = true;
          }

          // Lock OrbitControls target to targetPoint (exact head center)
          controlsRef.current.target.copy(targetPoint);
          controlsRef.current.minDistance = 0.001;
          controlsRef.current.maxDistance = 0.001;

          if (orbitJoystickData && (Math.abs(orbitJoystickData.x) > 0.01 || Math.abs(orbitJoystickData.y) > 0.01)) {
            const orbitSpeed = 4.0;
            const currentAzimuth = controlsRef.current.getAzimuthalAngle();
            controlsRef.current.setAzimuthalAngle(currentAzimuth - orbitJoystickData.x * orbitSpeed * delta);

            const polarSpeed = 2.8;
            const currentPolar = controlsRef.current.getPolarAngle();
            const nextPolar = THREE.MathUtils.clamp(
              currentPolar + orbitJoystickData.y * polarSpeed * delta,
              0.05,
              Math.PI - 0.05
            );
            controlsRef.current.setPolarAngle(nextPolar);
          }
          controlsRef.current.update();
        } else {
          // Normal Orbit with optional indoor collision/clamping
          wasFirstPersonRef.current = false;

          // Maintain the OrbitControls update using targetDist as the ideal distance boundaries
          controlsRef.current.minDistance = targetDist;
          controlsRef.current.maxDistance = targetDist;
          controlsRef.current.update();

          // Capture the newly updated ideal camera position (driven by user's mouse/drag actions on the ideal sphere)
          const idealCamPos = camera.position.clone();
          idealCamPosRef.current = idealCamPos;
          const dir = new THREE.Vector3().subVectors(idealCamPos, targetPoint);
          if (dir.lengthSq() < 0.00001) {
            dir.set(0, 0.866, 0.5);
          }
          dir.normalize();

          let maxSafeDist = targetDist;
          let shiftedTargetPoint = targetPoint.clone();

          if (isInterior) {
            const minCeilHt = 4.45;
            const maxFloorHt = 0.40;
            const desiredCamPos = idealCamPos.clone();
            
            desiredCamPos.y = Math.max(maxFloorHt, Math.min(minCeilHt, desiredCamPos.y));
            const margin = 0.55;
            const clampedXZ = clampPointToHouse(desiredCamPos.x, desiredCamPos.z, [activeRoom], margin);
            desiredCamPos.x = clampedXZ.x;
            desiredCamPos.z = clampedXZ.z;

            maxSafeDist = desiredCamPos.distanceTo(targetPoint);

            let raySafeDist = targetDist;
            const segments: Array<{ x1: number; z1: number; x2: number; z2: number; isDoorway?: boolean }> = [];

            // We only generate wall segments for the activeRoom to ensure complete containment and absolute zero outer wall clipping!
            const activeRoomsList = [activeRoom];
            activeRoomsList.forEach((r) => {
              const gx = Math.round(r.cx / ROOM_GRID_SIZE);
              const gz = Math.round(r.cz / ROOM_GRID_SIZE);

              const hasRoomAt = (nx: number, nz: number) => {
                return activeRoomsList.some((other) => Math.round(other.cx / ROOM_GRID_SIZE) === nx && Math.round(other.cz / ROOM_GRID_SIZE) === nz);
              };

              const hasN = hasRoomAt(gx, gz + 1);
              const hasS = hasRoomAt(gx, gz - 1);
              const hasE = hasRoomAt(gx + 1, gz);
              const hasW = hasRoomAt(gx - 1, gz);

              if (!hasN) {
                segments.push({ x1: r.cx - ROOM_HALF_SIZE, z1: r.cz + ROOM_HALF_SIZE, x2: r.cx + ROOM_HALF_SIZE, z2: r.cz + ROOM_HALF_SIZE });
              }
              if (!hasS) {
                segments.push({ x1: r.cx - ROOM_HALF_SIZE, z1: r.cz - ROOM_HALF_SIZE, x2: r.cx + ROOM_HALF_SIZE, z2: r.cz - ROOM_HALF_SIZE });
              }
              if (!hasE) {
                segments.push({ x1: r.cx + ROOM_HALF_SIZE, z1: r.cz - ROOM_HALF_SIZE, x2: r.cx + ROOM_HALF_SIZE, z2: r.cz + ROOM_HALF_SIZE });
              }
              if (!hasW) {
                segments.push({ x1: r.cx - ROOM_HALF_SIZE, z1: r.cz - ROOM_HALF_SIZE, x2: r.cx - ROOM_HALF_SIZE, z2: r.cz + ROOM_HALF_SIZE });
              }
            });

            const S = { x: targetPoint.x, z: targetPoint.z };
            const D = { x: dir.x, z: dir.z };
            const cameraRadius = 0.55;

            segments.forEach((seg) => {
              const A = { x: seg.x1, z: seg.z1 };
              const B = { x: seg.x2, z: seg.z2 };

              const dx = B.x - A.x;
              const dz = B.z - A.z;
              const det = dx * D.z - dz * D.x;

              if (Math.abs(det) > 0.0001) {
                const det_t = (A.x - S.x) * (-dz) - (-dx) * (A.z - S.z);
                const det_u = D.x * (A.z - S.z) - (A.x - S.x) * D.z;
                const t = det_t / det;
                const u = det_u / det;

                if (t >= 0 && u >= 0 && u <= 1) {
                  raySafeDist = Math.min(raySafeDist, Math.max(0.1, t - cameraRadius));
                }
              }
            });

            maxSafeDist = Math.min(maxSafeDist, raySafeDist);

            if (dir.y > 0.0001) {
              const ceilDist = (minCeilHt - targetPoint.y) / dir.y;
              maxSafeDist = Math.min(maxSafeDist, ceilDist);
            } else if (dir.y < -0.0001) {
              const floorDist = (maxFloorHt - targetPoint.y) / dir.y;
              maxSafeDist = Math.min(maxSafeDist, floorDist);
            }

            // Only push shifted target point back if we are in normal third person (not deep zooming first person)
            if (uiScale <= 1.5 && maxSafeDist < 0.8) {
              const shiftAmt = 0.8 - maxSafeDist;
              shiftedTargetPoint.sub(dir.clone().multiplyScalar(shiftAmt));
              maxSafeDist = 0.8;
            }
          }

          // H. 視野縮放 (FOV) 連動 (Unified)
          const baseFov = 35.0 / uiScale;
          const targetFov = uiScale > 1.5
            ? THREE.MathUtils.lerp(baseFov, 65.0, (uiScale - 1.5) / 0.5)
            : baseFov;
          if (camera instanceof THREE.PerspectiveCamera) {
            camera.fov = THREE.MathUtils.lerp(camera.fov, targetFov, 0.1); 
            camera.updateProjectionMatrix();
          }

          // I. 更新實際相機渲染位置 (避障立即反應，解除避障平滑回復)
          const currentDist = camera.position.distanceTo(targetPoint);
          let finalDist = maxSafeDist;
          if (maxSafeDist > currentDist) {
            // Slide back outward smoothly and quickly
            finalDist = THREE.MathUtils.lerp(currentDist, maxSafeDist, 0.45);
          } else {
            // Collision inward detection: INSTANT SNAP to prevent clipping through any geometry!
            finalDist = maxSafeDist;
          }

          // Compute final physical camera position and copy to camera
          const finalCamPos = shiftedTargetPoint.clone().add(dir.clone().multiplyScalar(finalDist));
          
          if (isInterior) {
            const minCeilHt = 4.45;
            const maxFloorHt = 0.40;
            // Hard physical caps clamp to ensure zero ceiling/floor penetration under any rounding/precision circumstance
            finalCamPos.y = Math.max(maxFloorHt, Math.min(minCeilHt, finalCamPos.y));
            const clampedFinal = clampPointToHouse(finalCamPos.x, finalCamPos.z, [activeRoom], 0.5);
            finalCamPos.x = clampedFinal.x;
            finalCamPos.z = clampedFinal.z;
          }
          
          // NOW, apply transition interpolation if active!
          if (isInterior && transitionProgressRef.current < 1.0 && transitionStartCamPos.current.lengthSq() > 0) {
            // Clamp the starting transition camera position to the NEW active room to prevent wall-crossing artifacts!
            const clampedStartCamPos = transitionStartCamPos.current.clone();
            const clampedStartCamXZ = clampPointToHouse(clampedStartCamPos.x, clampedStartCamPos.z, [activeRoom], 0.5);
            clampedStartCamPos.x = clampedStartCamXZ.x;
            clampedStartCamPos.z = clampedStartCamXZ.z;
            clampedStartCamPos.y = Math.max(0.40, Math.min(clampedStartCamPos.y, 4.45));

            // Lerp both target and position smoothly over the 0.2-0.4 second window!
            const progress = transitionProgressRef.current;
            // Use easeInOutCubic for beautiful smooth deceleration
            const easeProgress = progress < 0.5 ? 4 * progress * progress * progress : 1 - Math.pow(-2 * progress + 2, 3) / 2;

            const lerpedCamPos = new THREE.Vector3().lerpVectors(clampedStartCamPos, finalCamPos, easeProgress);
            const lerpedTarget = new THREE.Vector3().lerpVectors(transitionStartTarget.current, shiftedTargetPoint, easeProgress);

            camera.position.copy(lerpedCamPos);
            controlsRef.current.target.copy(lerpedTarget);
          } else {
            // Normal steady state
            camera.position.copy(finalCamPos);
            controlsRef.current.target.lerp(shiftedTargetPoint, 0.45);
          }

          // Limit controls min/max so orbit controller behaves correctly during this render loop
          controlsRef.current.minDistance = Math.max(0.001, finalDist - 0.01);
          controlsRef.current.maxDistance = finalDist + 0.01;

          // J. 允許使用搖桿旋轉視角 (包含完整的 Azimuth 繞行與 Polar 高低俯仰繞行！)
          if (orbitJoystickData && (Math.abs(orbitJoystickData.x) > 0.01 || Math.abs(orbitJoystickData.y) > 0.01)) {
            const orbitSpeed = 4.0;
            const currentAzimuth = controlsRef.current.getAzimuthalAngle();
            controlsRef.current.setAzimuthalAngle(currentAzimuth - orbitJoystickData.x * orbitSpeed * delta);

            const polarSpeed = 2.8;
            const currentPolar = controlsRef.current.getPolarAngle();
            const nextPolar = THREE.MathUtils.clamp(
              currentPolar + orbitJoystickData.y * polarSpeed * delta,
              isInterior ? Math.PI / 12 : Math.PI / 10,       // polar bounds
              isInterior ? Math.PI / 2.05 : Math.PI / 2.1
            );
            controlsRef.current.setPolarAngle(nextPolar);
          }
        }
        
        if (controlsRef.current) {
          controlsRef.current.enabled = !(window as any).isDraggingPlacement;
        }
        controlsRef.current.update();
      }

      const euler = new THREE.Euler().setFromQuaternion(camera.quaternion, 'YXZ');
      (window as any).cameraYaw = euler.y;
    }
  });

  const isInteriorView = currentView === View.BUILDING_INTERIOR;

  return (
    <OrbitControls 
      ref={controlsRef}
      enablePan={isBuildMode}
      enableZoom={currentView !== View.BUILDING_INTERIOR || isBuildMode}
      panSpeed={isInteriorView ? (isBuildMode ? 0.0375 : 0.075) : 0.125}
      rotateSpeed={isInteriorView ? (isBuildMode ? 0.1 : 0.2) : 0.6}
      zoomSpeed={isInteriorView ? (isBuildMode ? 0.0375 : 0.075) : 0.15}
      minPolarAngle={isBuildMode ? Math.PI / 4.5 : (uiScale >= FIRST_PERSON_ZOOM ? 0.05 : minPolarAngle)}
      maxPolarAngle={isBuildMode ? Math.PI / 4.5 : (uiScale >= FIRST_PERSON_ZOOM ? Math.PI - 0.05 : maxPolarAngle)}
      minDistance={isBuildMode ? 1.0 : minDistance}
      maxDistance={isBuildMode ? 50.0 : maxDistance}
      makeDefault
    />
  );
}

function clampPointToHouse(
  x: number,
  z: number,
  rooms: Array<{ cx: number; cz: number }>,
  margin = 0.5
): { x: number; z: number } {
  // 1. Define room squares
  const roomSquares = rooms.map((r) => ({
    xmin: r.cx - ROOM_HALF_SIZE + margin,
    xmax: r.cx + ROOM_HALF_SIZE - margin,
    zmin: r.cz - ROOM_HALF_SIZE + margin,
    zmax: r.cz + ROOM_HALF_SIZE - margin,
  }));

  // 2. Define doorway rectangles
  const doorways: Array<{ xmin: number; xmax: number; zmin: number; zmax: number }> = [];
  rooms.forEach((r) => {
    const gx = Math.round(r.cx / ROOM_GRID_SIZE);
    const gz = Math.round(r.cz / ROOM_GRID_SIZE);

    // Check north
    const hasN = rooms.some(
      (other) =>
        Math.round(other.cx / ROOM_GRID_SIZE) === gx &&
        Math.round(other.cz / ROOM_GRID_SIZE) === gz + 1
    );
    if (hasN) {
      doorways.push({
        xmin: r.cx - 1.5 + margin,
        xmax: r.cx + 1.5 - margin,
        zmin: r.cz + ROOM_HALF_SIZE - margin,
        zmax: r.cz + ROOM_HALF_SIZE + margin,
      });
    }

    // Check east
    const hasE = rooms.some(
      (other) =>
        Math.round(other.cx / ROOM_GRID_SIZE) === gx + 1 &&
        Math.round(other.cz / ROOM_GRID_SIZE) === gz
    );
    if (hasE) {
      doorways.push({
        xmin: r.cx + ROOM_HALF_SIZE - margin,
        xmax: r.cx + ROOM_HALF_SIZE + margin,
        zmin: r.cz - 1.5 + margin,
        zmax: r.cz + 1.5 - margin,
      });
    }

    // Check south
    const hasS = rooms.some(
      (other) =>
        Math.round(other.cx / ROOM_GRID_SIZE) === gx &&
        Math.round(other.cz / ROOM_GRID_SIZE) === gz - 1
    );
    if (hasS) {
      doorways.push({
        xmin: r.cx - 1.5 + margin,
        xmax: r.cx + 1.5 - margin,
        zmin: r.cz - ROOM_HALF_SIZE - margin,
        zmax: r.cz - ROOM_HALF_SIZE + margin,
      });
    }

    // Check west
    const hasW = rooms.some(
      (other) =>
        Math.round(other.cx / ROOM_GRID_SIZE) === gx - 1 &&
        Math.round(other.cz / ROOM_GRID_SIZE) === gz
    );
    if (hasW) {
      doorways.push({
        xmin: r.cx - ROOM_HALF_SIZE - margin,
        xmax: r.cx - ROOM_HALF_SIZE + margin,
        zmin: r.cz - 1.5 + margin,
        zmax: r.cz + 1.5 - margin,
      });
    }
  });

  // Check if (x, z) is already inside any square or doorway
  for (const sq of roomSquares) {
    if (x >= sq.xmin && x <= sq.xmax && z >= sq.zmin && z <= sq.zmax) {
      return { x, z };
    }
  }
  for (const dw of doorways) {
    if (x >= dw.xmin && x <= dw.xmax && z >= dw.zmin && z <= dw.zmax) {
      return { x, z };
    }
  }

  // If not inside, find the closest point among all shapes
  let minD2 = Infinity;
  let closestX = x;
  let closestZ = z;

  const allShapes = [...roomSquares, ...doorways];
  allShapes.forEach((shape) => {
    const clampX = Math.max(shape.xmin, Math.min(shape.xmax, x));
    const clampZ = Math.max(shape.zmin, Math.min(shape.zmax, z));
    const dx = x - clampX;
    const dz = z - clampZ;
    const d2 = dx * dx + dz * dz;
    if (d2 < minD2) {
      minD2 = d2;
      closestX = clampX;
      closestZ = clampZ;
    }
  });

  return { x: closestX, z: closestZ };
}

function getActiveRoom(
  x: number,
  z: number,
  rooms: any[]
): any {
  if (!rooms || rooms.length === 0) return null;
  let minD2 = Infinity;
  let active = rooms[0];
  rooms.forEach((r) => {
    const dx = x - r.cx;
    const dz = z - r.cz;
    const d2 = dx * dx + dz * dz;
    if (d2 < minD2) {
      minD2 = d2;
      active = r;
    }
  });
  return active;
}

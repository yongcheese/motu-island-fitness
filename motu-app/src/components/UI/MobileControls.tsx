/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState, useRef } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { useApp } from '../../context/AppContext';
import { View } from '../../types';
import { Circle } from 'lucide-react';
import { useIsTouchDevice } from '../../hooks/useIsTouchDevice';
import { PINCH_ZOOM_SENSITIVITY } from '../../constants/cameraZoom';

export function MobileControls() {
  const {
    setJoystickData, setOrbitJoystickData,
    currentView, setUiScale
  } = useApp();
  const isInterior = currentView === View.BUILDING_INTERIOR;
  const [touchPos, setTouchPos] = useState<{ x: number, y: number } | null>(null);
  const [knobPos, setKnobPos] = useState({ x: 0, y: 0 });
  
  const [orbitTouchPos, setOrbitTouchPos] = useState<{ x: number, y: number } | null>(null);
  const [orbitKnobPos, setOrbitKnobPos] = useState({ x: 0, y: 0 });

  const containerRef = useRef<HTMLDivElement>(null);
  
  const MAX_DISTANCE = 40;

  const movementTouchIdRef = useRef<number | null>(null);
  const orbitTouchIdRef = useRef<number | null>(null);
  const movementStartRef = useRef<{ x: number; y: number } | null>(null);
  const orbitStartRef = useRef<{ x: number; y: number } | null>(null);

  // Two-finger pinch-to-zoom, sharing the exact same Camera Zoom Controller
  // pipeline (setUiScale, see constants/cameraZoom.ts) as the mouse wheel
  // (CameraController) and the on-screen +/- buttons (ZoomControl) - so all
  // three input methods drive the identical clamped `uiScale` state instead
  // of pinch maintaining its own separate distance/zoom logic.
  const pinchTouchIdsRef = useRef<[number, number] | null>(null);
  const pinchLastDistRef = useRef<number | null>(null);

  // A touchend/touchcancel for an in-progress drag can simply never arrive if the app/tab is
  // switched away from mid-touch (the OS gesture that does the switching isn't a touch lift on
  // this element) - without this, the refs above would keep believing that identifier is still
  // driving the joystick, so a later touchmove event reusing the same identifier could feed a
  // fresh (and, combined with CameraController's post-resume delta spike, wildly amplified)
  // rotation input straight back in. Forgetting the touch entirely on hide/blur, same as a real
  // touchend would, closes that gap.
  React.useEffect(() => {
    const forgetAllTouches = () => {
      movementTouchIdRef.current = null;
      movementStartRef.current = null;
      orbitTouchIdRef.current = null;
      orbitStartRef.current = null;
      setTouchPos(null);
      setKnobPos({ x: 0, y: 0 });
      setOrbitTouchPos(null);
      setOrbitKnobPos({ x: 0, y: 0 });
      setJoystickData(null);
      setOrbitJoystickData(null);
      pinchTouchIdsRef.current = null;
      pinchLastDistRef.current = null;
    };
    const onVisibilityChange = () => {
      if (document.hidden) forgetAllTouches();
    };
    document.addEventListener('visibilitychange', onVisibilityChange);
    window.addEventListener('blur', forgetAllTouches);
    return () => {
      document.removeEventListener('visibilitychange', onVisibilityChange);
      window.removeEventListener('blur', forgetAllTouches);
    };
  }, [setJoystickData, setOrbitJoystickData]);

  const handleTouchStart = (e: React.TouchEvent) => {
    if (!e.changedTouches) return;

    // Exactly two fingers down anywhere in this capture zone = pinch-to-zoom,
    // not joysticks. Takes over both touch slots exclusively, cancelling any
    // joystick a single finger may have already started.
    if (e.touches.length === 2) {
      movementTouchIdRef.current = null;
      movementStartRef.current = null;
      setTouchPos(null);
      setKnobPos({ x: 0, y: 0 });
      setJoystickData(null);
      orbitTouchIdRef.current = null;
      orbitStartRef.current = null;
      setOrbitTouchPos(null);
      setOrbitKnobPos({ x: 0, y: 0 });
      setOrbitJoystickData(null);

      const t1 = e.touches[0];
      const t2 = e.touches[1];
      pinchTouchIdsRef.current = [t1.identifier, t2.identifier];
      pinchLastDistRef.current = Math.hypot(t2.clientX - t1.clientX, t2.clientY - t1.clientY);
      return;
    }
    // A third+ finger, or a pinch already in progress: don't (re)start a
    // joystick underneath it - only fewer-than-two-touch starts fall through.
    if (e.touches.length > 2 || pinchTouchIdsRef.current) return;

    for (let i = 0; i < e.changedTouches.length; i++) {
      const touch = e.changedTouches[i];
      
      // Left side of the screen: movement
      if (touch.clientX < window.innerWidth / 2) {
        if (movementTouchIdRef.current === null) {
          movementTouchIdRef.current = touch.identifier;
          movementStartRef.current = { x: touch.clientX, y: touch.clientY };
          setTouchPos({ x: touch.clientX, y: touch.clientY });
          setKnobPos({ x: 0, y: 0 });
        }
      } 
      // Right side of the screen: camera rotation (orbit)
      else {
        // Exclude action button or zoom area roughly (lower right button area)
        if (touch.clientY > window.innerHeight - 150 && touch.clientX > window.innerWidth - 120) {
          continue; 
        }
        if (orbitTouchIdRef.current === null) {
          orbitTouchIdRef.current = touch.identifier;
          orbitStartRef.current = { x: touch.clientX, y: touch.clientY };
          setOrbitTouchPos({ x: touch.clientX, y: touch.clientY });
          setOrbitKnobPos({ x: 0, y: 0 });
        }
      }
    }
  };

  const handleTouchMove = (e: React.TouchEvent) => {
    if (e.cancelable) e.preventDefault();
    if (!e.touches) return;

    if (pinchTouchIdsRef.current) {
      const [id1, id2] = pinchTouchIdsRef.current;
      let p1: React.Touch | null = null;
      let p2: React.Touch | null = null;
      for (let i = 0; i < e.touches.length; i++) {
        const t = e.touches[i];
        if (t.identifier === id1) p1 = t;
        else if (t.identifier === id2) p2 = t;
      }
      if (p1 && p2 && pinchLastDistRef.current !== null) {
        const dist = Math.hypot(p2.clientX - p1.clientX, p2.clientY - p1.clientY);
        const delta = dist - pinchLastDistRef.current;
        if (delta !== 0) {
          setUiScale((prev) => prev + delta * PINCH_ZOOM_SENSITIVITY);
        }
        pinchLastDistRef.current = dist;
      }
      return;
    }

    for (let i = 0; i < e.touches.length; i++) {
      const touch = e.touches[i];
      
      // Handle Movement Joystick
      if (movementTouchIdRef.current === touch.identifier && movementStartRef.current) {
        const start = movementStartRef.current;
        const dx = touch.clientX - start.x;
        const dy = touch.clientY - start.y;
        const distance = Math.sqrt(dx * dx + dy * dy);
        const clampedDistance = Math.min(distance, MAX_DISTANCE);
        const angle = Math.atan2(dy, dx);
        const nx = Math.cos(angle) * clampedDistance;
        const ny = Math.sin(angle) * clampedDistance;
        setKnobPos({ x: nx, y: ny });
        setJoystickData({ x: nx / MAX_DISTANCE, y: -ny / MAX_DISTANCE });
      }
      
      // Handle Orbit Controls
      if (orbitTouchIdRef.current === touch.identifier && orbitStartRef.current) {
        const start = orbitStartRef.current;
        const dx = touch.clientX - start.x;
        const dy = touch.clientY - start.y;
        const distance = Math.sqrt(dx * dx + dy * dy);
        const clampedDistance = Math.min(distance, MAX_DISTANCE);
        const angle = Math.atan2(dy, dx);
        const nx = Math.cos(angle) * clampedDistance;
        const ny = Math.sin(angle) * clampedDistance;
        setOrbitKnobPos({ x: nx, y: ny });
        setOrbitJoystickData({ x: nx / MAX_DISTANCE, y: -ny / MAX_DISTANCE });
      }
    }
  };

  const handleTouchEnd = (e: React.TouchEvent) => {
    if (!e.touches) return;

    const remainingIds = new Set<number>();
    for (let i = 0; i < e.touches.length; i++) {
      remainingIds.add(e.touches[i].identifier);
    }

    // End the pinch as soon as either finger lifts. Deliberately doesn't try
    // to hand the remaining finger off to a joystick - the lifted finger's
    // touchstart already fired earlier and won't fire again, so there's
    // nothing to key a fresh joystick assignment off until the next clean
    // touchstart.
    if (pinchTouchIdsRef.current) {
      const [id1, id2] = pinchTouchIdsRef.current;
      if (!remainingIds.has(id1) || !remainingIds.has(id2)) {
        pinchTouchIdsRef.current = null;
        pinchLastDistRef.current = null;
      }
    }

    // Check if movement touch is gone
    if (movementTouchIdRef.current !== null && !remainingIds.has(movementTouchIdRef.current)) {
      movementTouchIdRef.current = null;
      movementStartRef.current = null;
      setTouchPos(null);
      setKnobPos({ x: 0, y: 0 });
      setJoystickData(null);
    }
    
    // Check if orbit touch is gone
    if (orbitTouchIdRef.current !== null && !remainingIds.has(orbitTouchIdRef.current)) {
      orbitTouchIdRef.current = null;
      orbitStartRef.current = null;
      setOrbitTouchPos(null);
      setOrbitKnobPos({ x: 0, y: 0 });
      setOrbitJoystickData(null);
    }
    
    if (e.touches.length === 0) {
      movementTouchIdRef.current = null;
      movementStartRef.current = null;
      orbitTouchIdRef.current = null;
      orbitStartRef.current = null;
      setTouchPos(null);
      setKnobPos({ x: 0, y: 0 });
      setJoystickData(null);
      setOrbitTouchPos(null);
      setOrbitKnobPos({ x: 0, y: 0 });
      setOrbitJoystickData(null);
    }
  };

  // `pointer: coarse` (via useIsTouchDevice) is required here, not width or
  // 'ontouchstart': either of those false-positives on a mouse-driven desktop
  // (a merely-narrow/undocked browser window, or a Windows touchscreen
  // laptop/all-in-one played with a mouse). A false positive here mounts the
  // full-screen (bottom 75%) pointer-events-auto touch-catcher div below,
  // which sits above the R3F canvas (z-30 vs the canvas's z-0) and silently
  // swallows every mousedown/drag in that region before OrbitControls ever
  // sees it - this is what made camera mouse-look "just stop working" outside
  // of build mode, indoors and out alike, with no bug in CameraController itself.
  const isMobile = useIsTouchDevice();

  // BUILD_MODE (outdoor 建造模式) is included so touch users can walk/orbit the island while the
  // build overlay is open, same as HOME. This full-bleed touch-capture layer sits at z-hud-touch
  // (20); BuildModeOverlay is raised to z-hud-toolbar (24) so its own buttons stay tappable above
  // this catcher (see the note there) while the joystick still works on any empty area.
  if (!isMobile || (currentView !== View.HOME && currentView !== View.BUILDING_INTERIOR && currentView !== View.BUILD_MODE)) return null;

  return (
    <>
      {/* Joystick Touch Areas */}
      <div 
        className="fixed bottom-0 left-0 z-hud-touch w-full h-[75%] pointer-events-auto"
        onTouchStart={handleTouchStart}
        onTouchMove={handleTouchMove}
        onTouchEnd={handleTouchEnd}
      />

      <div className="fixed inset-0 z-hud-controls pointer-events-none flex items-end justify-between p-6 pb-28 pl-8 pr-3">
        {/* Dynamic Joytick Visuals */}
        <AnimatePresence>
          {touchPos && (
            <motion.div
              initial={{ scale: 0, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              exit={{ scale: 0, opacity: 0 }}
              transition={{ duration: 0.15 }}
              style={{ 
                position: 'fixed',
                left: touchPos.x - 56,
                top: touchPos.y - 56,
                width: 112,
                height: 112
              }}
              className="flex items-center justify-center bg-black/20 backdrop-blur-md rounded-full border border-white/20 shadow-2xl"
            >
              <div className="w-12 h-12 rounded-full border border-white/5 flex items-center justify-center">
                <Circle size={32} className="text-white/10" />
              </div>
              
              <motion.div
                className="absolute w-12 h-12 bg-white/30 backdrop-blur-md rounded-full border border-white/40 shadow-lg flex items-center justify-center"
                style={{ 
                  x: knobPos.x, 
                  y: knobPos.y 
                }}
              >
                <div className="w-4 h-4 rounded-full bg-white/60" />
              </motion.div>
            </motion.div>
          )}

          {orbitTouchPos && (
            <motion.div
              initial={{ scale: 0, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              exit={{ scale: 0, opacity: 0 }}
              transition={{ duration: 0.15 }}
              style={{ 
                position: 'fixed',
                left: orbitTouchPos.x - 56,
                top: orbitTouchPos.y - 56,
                width: 112,
                height: 112
              }}
              className="flex items-center justify-center bg-white/10 backdrop-blur-md rounded-full border border-white/10 shadow-2xl"
            >
              <div className="w-12 h-12 rounded-full border border-white/5 flex items-center justify-center">
                <Circle size={32} className="text-white/5" />
              </div>
              
              <motion.div
                className="absolute w-12 h-12 bg-blue-500/20 backdrop-blur-md rounded-full border border-blue-400/30 shadow-lg flex items-center justify-center"
                style={{ 
                  x: orbitKnobPos.x, 
                  y: orbitKnobPos.y 
                }}
              >
                <div className="w-4 h-4 rounded-full bg-blue-400/40" />
              </motion.div>
            </motion.div>
          )}
        </AnimatePresence>
      </div>
    </>
  );
}

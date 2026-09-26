/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { useRef } from 'react';
import * as THREE from 'three';
import { Canvas, useFrame } from '@react-three/fiber';
import { RotateCw } from 'lucide-react';
import { HairSpec, AVATAR_SKIN_COLOR } from '../../constants/hair';
import { HairPiece } from '../Three/character/legacy/wardrobe';
import { LEGACY_SKELETON } from '../../constants/characterRig';
import { playSound, SoundEffect, triggerHaptic } from '../../lib/soundUtils';

/**
 * Turntable preview of a hairstyle on a head, for the purchase confirmation.
 *
 * A hairstyle is the one thing in the shop whose back matters as much as its front - the flat
 * thumbnail deliberately shows the front only, so a player buying 大波浪 has never seen what the
 * fall actually does behind the head. This spins the real thing: it mounts the same `HairPiece`
 * the avatar wears, on a head built from the same sphere, tones and landmarks, so what turns here
 * is the model the player is buying rather than a second illustration of it that could drift.
 *
 * Deliberately not OrbitControls. The only useful axis is yaw - a hairstyle inspected from
 * underneath tells you nothing and looks broken - so the interaction is a turn button plus
 * horizontal drag, and pitch is simply not offered.
 */

/** Yaw state, shared between the DOM controls and the r3f frame loop. */
interface SpinState {
  yaw: number;
  /** Radians still owed to the turn button; drag cancels it (see the drag handler). */
  remaining: number;
}

/** A full turn in a little under two seconds - long enough to read the back, short enough to sit through. */
const SPIN_SPEED = Math.PI * 1.15;

/** Radians of yaw per pixel dragged. Tuned so a full turn is roughly one screen-width swipe. */
const DRAG_SENSITIVITY = 0.012;

function PreviewHead({ spec, spin }: { spec: HairSpec; spin: React.MutableRefObject<SpinState> }) {
  const group = useRef<THREE.Group>(null);
  // HairPiece animates its hanging pieces through this ref. Nothing drives it here - the preview
  // has no walk cycle to follow through from - so the hair simply hangs at rest, which is the
  // shape the player is actually choosing between.
  const swayRef = useRef<THREE.Group>(null!);

  useFrame((_, delta) => {
    const s = spin.current;
    if (s.remaining > 0) {
      const step = Math.min(s.remaining, delta * SPIN_SPEED);
      s.yaw += step;
      s.remaining -= step;
    }
    if (group.current) group.current.rotation.y = s.yaw;
  });

  return (
    <group ref={group}>
      {/* Head. These are the legacy model's numbers, not lookalikes: the same skull HEAD_ANCHOR
          is measured against, and the same eye/mouth/blush landmarks. The hair is fitted to that
          anchor, so any drift here would show up as hair sitting wrong on the preview only.
          The radius is READ from the rig rather than retyped, so a remodel cannot leave this
          preview quietly fitted to a head the game no longer draws. */}
      <mesh>
        <sphereGeometry args={[LEGACY_SKELETON.head.halfWidth, 32, 32]} />
        <meshStandardMaterial color={AVATAR_SKIN_COLOR} roughness={0.7} />
      </mesh>
      <group position={[0, 0.035, 0.225]}>
        <mesh position={[-0.104, 0, 0]}>
          <sphereGeometry args={[0.036, 16, 16]} />
          <meshStandardMaterial color="#0d1117" roughness={0.1} />
        </mesh>
        <mesh position={[0.104, 0, 0]}>
          <sphereGeometry args={[0.036, 16, 16]} />
          <meshStandardMaterial color="#0d1117" roughness={0.1} />
        </mesh>
      </group>
      <mesh position={[0, -0.045, 0.255]} rotation={[0, 0, Math.PI * 1.275]}>
        <torusGeometry args={[0.036, 0.0043, 8, 24, Math.PI * 0.45]} />
        <meshStandardMaterial color="#0d1117" roughness={0.5} />
      </mesh>
      <mesh position={[-0.122, -0.029, 0.18]}>
        <sphereGeometry args={[0.056, 16, 16]} />
        <meshStandardMaterial color="#fda4af" transparent opacity={0.3} roughness={0.9} />
      </mesh>
      <mesh position={[0.122, -0.029, 0.18]}>
        <sphereGeometry args={[0.056, 16, 16]} />
        <meshStandardMaterial color="#fda4af" transparent opacity={0.3} roughness={0.9} />
      </mesh>

      <HairPiece spec={spec} hat={null} swayRef={swayRef} />
    </group>
  );
}

export function HairSpinPreview({ spec, size = 160 }: { spec: HairSpec; size?: number }) {
  const spin = useRef<SpinState>({ yaw: 0, remaining: 0 });
  const drag = useRef<{ active: boolean; x: number; moved: number }>({ active: false, x: 0, moved: 0 });

  const turn = () => {
    // Ignore a second press mid-turn rather than queueing another lap: a player tapping twice
    // wants to see the back again, not to sit through two full rotations.
    if (spin.current.remaining > 0) return;
    triggerHaptic('light');
    playSound(SoundEffect.CLICK);
    spin.current.remaining = Math.PI * 2;
  };

  const onPointerDown = (e: React.PointerEvent) => {
    drag.current = { active: true, x: e.clientX, moved: 0 };
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
  };

  const onPointerMove = (e: React.PointerEvent) => {
    if (!drag.current.active) return;
    const dx = e.clientX - drag.current.x;
    drag.current.x = e.clientX;
    drag.current.moved += Math.abs(dx);
    // A drag takes the wheel off the button: continuing a scripted turn under the player's finger
    // fights them for the same axis.
    spin.current.remaining = 0;
    spin.current.yaw += dx * DRAG_SENSITIVITY;
  };

  const onPointerUp = (e: React.PointerEvent) => {
    (e.currentTarget as HTMLElement).releasePointerCapture?.(e.pointerId);
    drag.current.active = false;
  };

  return (
    <div
      style={{ width: size, height: size }}
      className="rounded-2xl relative overflow-hidden flex-shrink-0 border border-island-line bg-island-cream-2 touch-none cursor-grab active:cursor-grabbing"
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onPointerCancel={onPointerUp}
    >
      <Canvas
        camera={{ position: [0, 0, 1.75], fov: 32 }}
        gl={{ alpha: true, antialias: true }}
        style={{ background: 'transparent' }}
      >
        <ambientLight intensity={1.15} />
        <directionalLight position={[2, 3, 2.5]} intensity={1.5} />
        <directionalLight position={[-2, 1, -1.5]} intensity={0.55} />
        {/* Rim from behind. Without it the near-black styles lose their outline against the
            cream tile at exactly the angle the turn exists to show. */}
        <directionalLight position={[0, 1.5, -3]} intensity={0.9} />
        {/* Nudged up so a long fall stays in frame without pushing a short cut out of the top. */}
        <group position={[0, 0.08, 0]}>
          <PreviewHead spec={spec} spin={spin} />
        </group>
      </Canvas>

      <button
        type="button"
        onClick={turn}
        aria-label="旋轉檢視髮型"
        className="absolute bottom-2 right-2 h-9 px-3 gap-1.5 rounded-xl bg-white/95 border border-island-line hover:border-island-teal hover:text-island-teal text-island-navy-soft flex items-center justify-center transition-all active:scale-90 shadow-sm"
      >
        <RotateCw size={15} strokeWidth={2.8} />
        <span className="text-[10px] font-black tracking-widest">360°</span>
      </button>

      <span className="absolute bottom-3 left-3 text-[9px] font-bold tracking-wide text-island-navy-soft/50 pointer-events-none">
        可拖曳
      </span>
    </div>
  );
}

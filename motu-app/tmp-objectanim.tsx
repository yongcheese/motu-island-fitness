/**
 * Throwaway harness for signing off the Object Interaction Animation System.
 *
 * Every reacting piece drawn by the SHIPPING `FurnitureModel` with a real instance id, plus the
 * two buttons that fire the exact events Three/Avatar.tsx fires. So a screenshot here is what the
 * player gets when they press E, without having to buy the furniture first.
 *
 *   ?set=doors    wardrobe, fridge, oven, microwave, picnic basket, vanity
 *   ?set=state    stove, radio, washbasin, toilet, fountain
 *   ?set=seats    sofas, beds, bath, loungers   (use 佔用 rather than 互動)
 *   ?set=throw    frisbee, beach ball, bookshelf, desks, viewing deck
 *
 * Delete with tmp-objectanim.html once this is signed off.
 */
import { useEffect, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { Canvas } from '@react-three/fiber';
import { OrbitControls } from '@react-three/drei';

import { FurnitureModel } from './src/components/Three/FurnitureItem';
import { getItemById } from './src/constants/items';
import * as objectState from './src/lib/objectRuntimeState';

(window as any).__objState = objectState;

const params = new URLSearchParams(location.search);
const SET = params.get('set') ?? 'doors';

const SETS: Record<string, string[]> = {
  doors: ['item-wardrobe', 'item-fridge', 'furn-oven', 'furn-microwave', 'deco-picnic-basket', 'furn-vanity'],
  state: ['item-stove', 'deco-radio', 'item-washbasin', 'item-toilet', 'item-17'],
  seats: ['item-21', 'item-bed', 'item-bathtub', 'furn-beanbag', 'deco-lounger-beach', 'furn-rocking-chair'],
  throw: ['deco-frisbee', 'deco-beach-ball', 'item-24', 'item-desk', 'deco-viewing-deck', 'deco-tent'],
  outdoor: ['deco-campfire', 'deco-telescope', 'deco-birdhouse', 'deco-wishing-well'],
};

const ONLY = params.get('id');
const IDS = ONLY ? [ONLY] : (SETS[SET] ?? SETS.doors);
const SPACING = 3.4;
const CAM: [number, number, number] = (params.get('cam')?.split(',').map(Number) as [number, number, number])
  ?? (ONLY ? [0, 1.6, 4.4] : [0, 4.2, 17]);
const FOV = Number(params.get('fov')) || (ONLY ? 40 : 46);
const TARGET_Y = Number(params.get('ty')) || (ONLY ? 1.1 : 1);
/** ?fire=interact|occupy fires on load, so a screenshot needs no click. */
const AUTO = params.get('fire');
/**
 * ?from=<degrees> — WHICH SIDE THE PLAYER IS ON when they press E.
 *
 * The whole of the dynamic-direction test. 0 is standing on the piece's own +Z side, 90 on its
 * +X side, and so on; the synthetic player stands one unit out on that bearing and faces the
 * piece, which is exactly what the interaction system does with a real one (an acting posture
 * resolves a stand spot on the side the player approached from and squares them up to it —
 * lib/furnitureInteraction.ts's `resolveStandSpot`).
 *
 * Fire the same piece from 0, 90, 180 and 270 and the disc must go four different ways. Before
 * `launch` existed it went the same way four times, because the flight was welded to the model's
 * own +Z.
 */
const FROM = Number(params.get('from') ?? 180);
/** How far out the synthetic player stands. Only its DIRECTION matters to the heading. */
const STAND_OFF = 1.2;

function Piece({ id }: { id: string; index: number }) {
  const item = getItemById(id);
  const x = pieceXFor(id);
  if (!item) return null;
  return (
    <group position={[x, 0, 0]}>
      <FurnitureModel name={item.name} item={item} scale={1.0} instanceId={`probe-${id}`} />
    </group>
  );
}

function fire(type: string) {
  (window as any).__fired = performance.now();
  const bearing = (FROM * Math.PI) / 180;
  for (const id of IDS) {
    // Each piece stands at its own x on the row, so the synthetic player has to be placed
    // relative to THAT piece — a single world position would be a different bearing for every
    // piece in the set, which is the one thing this parameter must not be.
    const pieceX = pieceXFor(id);
    const px = pieceX + Math.sin(bearing) * STAND_OFF;
    const pz = Math.cos(bearing) * STAND_OFF;
    window.dispatchEvent(new CustomEvent(type, {
      detail: {
        instanceId: `probe-${id}`,
        itemId: id,
        at: performance.now(),
        // The same shape Avatar.tsx sends: where the body is and which way it points, with the
        // body squared up to the piece.
        player: { x: px, z: pz, yaw: Math.atan2(pieceX - px, -pz) },
      },
    }));
  }
}

function pieceXFor(id: string): number {
  return (IDS.indexOf(id) - (IDS.length - 1) / 2) * SPACING;
}

function App() {
  const [note, setNote] = useState('idle');
  // Deterministic firing for the screenshot script: it waits for the scene, calls this, then
  // waits an exact number of milliseconds. A timer inside the page cannot be timed from outside.
  useEffect(() => {
    (window as any).__fire = (kind: string) => {
      fire(kind === 'occupy' ? 'furniture-occupy' : kind === 'release' ? 'furniture-release' : 'furniture-interact');
      setNote(kind);
    };
  }, []);
  useEffect(() => {
    if (!AUTO) return;
    const t = setTimeout(() => {
      fire(AUTO === 'occupy' ? 'furniture-occupy' : 'furniture-interact');
      setNote(AUTO);
    }, 600);
    return () => clearTimeout(t);
  }, []);
  return (
    <>
      <div className="bar">
        <strong>{SET}</strong>
        <button onClick={() => { fire('furniture-interact'); setNote('interact'); }}>按 E（互動）</button>
        <button onClick={() => { fire('furniture-occupy'); setNote('occupied'); }}>坐上去（佔用）</button>
        <button onClick={() => { fire('furniture-release'); setNote('released'); }}>起身（釋放）</button>
        <span>{note}</span>
        {Object.keys(SETS).map((s) => (
          <a key={s} href={`?set=${s}`}>{s}</a>
        ))}
      </div>
      <Canvas shadows camera={{ position: CAM, fov: FOV }} onCreated={({ scene }) => { (window as any).__scene = scene; }}>
        <color attach="background" args={['#1b2430']} />
        <hemisphereLight args={['#dff0ff', '#6b5a45', 1.0]} />
        <directionalLight position={[5, 9, 6]} intensity={1.5} castShadow />
        <mesh rotation={[-Math.PI / 2, 0, 0]} receiveShadow>
          <planeGeometry args={[80, 80]} />
          <meshStandardMaterial color="#8a9a7b" />
        </mesh>
        {IDS.map((id, i) => <Piece key={id} id={id} index={i} />)}
        <OrbitControls target={[0, TARGET_Y, 0]} />
      </Canvas>
    </>
  );
}

// Vite invalidates this module on every edit (the `SETS` export is not Fast-Refresh compatible),
// which re-executes it and would call createRoot on the same container again — stacking roots,
// each with its own Canvas and its own event listeners. Reuse the root instead.
const host = document.getElementById('root')! as HTMLElement & { __root?: ReturnType<typeof createRoot> };
host.__root ??= createRoot(host);
host.__root.render(<App />);

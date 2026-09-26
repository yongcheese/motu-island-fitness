/**
 * Throwaway harness: a resident's social layer (notice, stop, face, talk, farewell) driven through
 * the REAL NpcWalker on a flat disc. Delete when signed off.
 *
 *   ?kind=cookieRabbit | hippoButler      (the butler lives indoors, so this sets isInsideHouse)
 *
 * window.__player(x, z)   move the stand-in player
 * window.__talk()          press 「聊天」 exactly as the E key / badge do
 * window.__bus             the live player bus (npcTarget, npcSpeech)
 */
import { createRoot } from 'react-dom/client';
import { Canvas, useFrame } from '@react-three/fiber';
import { useEffect, useRef, useState } from 'react';
import * as THREE from 'three';
import { NpcWalker, type NpcTerritory } from './src/components/Three/NpcWalker';
import { ISLAND_NPCS, INTERIOR_NPCS, type NpcKind } from './src/constants/npcs';
import { playerBus } from './src/lib/playerBus';

const params = new URLSearchParams(location.search);
const KIND = (params.get('kind') ?? 'cookieRabbit') as NpcKind;
const SPEC = [...ISLAND_NPCS, ...INTERIOR_NPCS].find((n) => n.kind === KIND)!;
const SCOPE = KIND === 'hippoButler' ? 'interior' : 'island';

playerBus.playerPos = new THREE.Vector3(9, 0, 0);
playerBus.playerRotation = -Math.PI / 2;
playerBus.isInsideHouse = SCOPE === 'interior';
(window as any).__bus = playerBus;
(window as any).__player = (x: number, z: number) => {
  const p = playerBus.playerPos!;
  playerBus.playerRotation = Math.atan2(-x, -z);
  p.set(x, 0, z);
};
(window as any).__talk = () => {
  window.dispatchEvent(new CustomEvent('npc-interact', { detail: { npcId: SPEC.id } }));
};

// A still resident by default (?roam=1 lets her walk), so screenshots are of the social layer, not
// of wherever her route happened to take her.
const ROAM = params.has('roam');
const territory: NpcTerritory = {
  pickRoute: () => {
    if (!ROAM) return [];
    const a = Math.random() * Math.PI * 2;
    const r = 1 + Math.random() * 3;
    return [{ x: Math.cos(a) * r, z: Math.sin(a) * r }];
  },
  routeTo: (from, to) => [to],
  contain: (p) => {
    const d = Math.hypot(p.x, p.z);
    if (d > 8) { p.x *= 8 / d; p.z *= 8 / d; }
  },
  groundY: () => 0,
};

function Player() {
  const ref = useRef<THREE.Group>(null);
  useFrame(() => {
    const p = playerBus.playerPos!;
    ref.current?.position.set(p.x, 0, p.z);
  });
  return (
    <group ref={ref}>
      <mesh position={[0, 1.05, 0]}>
        <capsuleGeometry args={[0.3, 1.5, 8, 12]} />
        <meshStandardMaterial color="#8fa6b5" roughness={0.9} />
      </mesh>
    </group>
  );
}

function Hud() {
  const [text, setText] = useState('');
  useEffect(() => {
    let raf = 0;
    const tick = () => {
      const t = playerBus.npcTarget;
      const s = playerBus.npcSpeech;
      setText(`target: ${t ? `${t.label}${t.talking ? ' (talking)' : ''}` : '—'}   |   speech: ${s ? `${s.name}：${s.text}` : '—'}`);
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, []);
  return <div className="hud" id="hud">{text}</div>;
}

const CAM = (params.get('cam')?.split(',').map(Number) as [number, number, number]) ?? [3.2, 2.4, 5.2];

function App() {
  return (
    <>
      <Hud />
      <Canvas shadows camera={{ position: CAM, fov: 38 }} onCreated={({ camera }) => camera.lookAt(0.6, 1.0, 0)}>
        <color attach="background" args={['#eef2f5']} />
        <ambientLight intensity={0.85} />
        <directionalLight position={[4, 7, 5]} intensity={1.4} castShadow />
        <mesh rotation={[-Math.PI / 2, 0, 0]} receiveShadow>
          <circleGeometry args={[10, 48]} />
          <meshStandardMaterial color="#cfe3c8" roughness={1} />
        </mesh>
        <Player />
        <NpcWalker
          npcId={SPEC.id}
          name={SPEC.name}
          scope={SCOPE}
          kind={KIND}
          height={SPEC.height}
          spawnX={0}
          spawnZ={0}
          spawnRotation={0}
          territory={territory}
        />
      </Canvas>
    </>
  );
}

const host = document.getElementById('root')! as HTMLElement & { __root?: ReturnType<typeof createRoot> };
host.__root ??= createRoot(host);
host.__root.render(<App />);

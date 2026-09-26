/**
 * Temporary harness: is drei's <Stars> from Scene.tsx visible in a DAYTIME sky,
 * and does it show through the transparent ocean plane?
 * Reproduces Scene.tsx's camera, SkyDome's gradient shader (SUNNY endpoints, no
 * lerp) and Ocean.tsx's transparent/depthWrite:false surface. Not part of the app.
 *
 *   ?stars=1  drei <Stars> mounted (current Scene.tsx)
 *   ?stars=0  removed (proposed)
 */
import { createRoot } from 'react-dom/client';
import { useMemo } from 'react';
import { Canvas, useThree } from '@react-three/fiber';
import { Stars } from '@react-three/drei';
import * as THREE from 'three';

const params = new URLSearchParams(location.search);
const WITH_STARS = params.get('stars') !== '0';

function Sky() {
  const material = useMemo(
    () =>
      new THREE.ShaderMaterial({
        uniforms: {
          uTopColor: { value: new THREE.Color('#4fc3f7') },
          uBottomColor: { value: new THREE.Color('#e0f2fe') },
        },
        vertexShader: `
          varying vec3 vWorldPosition;
          void main() {
            vWorldPosition = (modelMatrix * vec4(position, 1.0)).xyz;
            gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
          }`,
        fragmentShader: `
          varying vec3 vWorldPosition;
          uniform vec3 uTopColor;
          uniform vec3 uBottomColor;
          void main() {
            float h = normalize(vWorldPosition).y;
            gl_FragColor = vec4(mix(uBottomColor, uTopColor, smoothstep(0.0, 0.42, h)), 1.0);
          }`,
        side: THREE.BackSide,
      }),
    []
  );
  return (
    <mesh>
      <sphereGeometry args={[500, 32, 32]} />
      <primitive object={material} attach="material" />
    </mesh>
  );
}

/** Stand-in for Ocean.tsx's surface: the properties that matter here are
 *  `transparent` + `depthWrite: false`, which are exactly what lets anything
 *  underneath it keep drawing straight through. */
function Sea() {
  return (
    <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, -0.5, 0]}>
      <planeGeometry args={[2000, 2000, 1, 1]} />
      <meshBasicMaterial color="#116985" transparent opacity={0.85} depthWrite={false} />
    </mesh>
  );
}

/** Aim the lens at the horizon so both the sky and the open sea are in frame -
 *  the default lookAt(0,0,0) from this position fills the frame with water. */
function Aim() {
  const camera = useThree((s) => s.camera);
  camera.lookAt(-300, 40, -400);
  camera.updateMatrixWorld();
  return null;
}

createRoot(document.getElementById('root')!).render(
  <Canvas camera={{ position: [30, 12, 40], fov: 25, near: 0.5, far: 2000 }}>
    <Aim />
    <Sky />
    <Sea />
    {WITH_STARS && (
      <Stars radius={100} depth={50} count={2000} factor={4} saturation={0} fade speed={1} />
    )}
  </Canvas>
);

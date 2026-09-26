/**
 * Temporary harness: does SkyDome's gradient crease along the sphere's triangle
 * edges? Same shader, same colours, camera aimed at the zenith where the pole fan
 * is. ?seg=32x32 (old) vs ?seg=64x40 (new). Not part of the app.
 */
import { createRoot } from 'react-dom/client';
import { useMemo } from 'react';
import { Canvas, useThree } from '@react-three/fiber';
import * as THREE from 'three';

const params = new URLSearchParams(location.search);
const [W, H] = (params.get('seg') ?? '32x32').split('x').map(Number);
const PITCH = Number(params.get('pitch') ?? 55); // degrees above the horizon

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
      <sphereGeometry args={[500, W, H]} />
      <primitive object={material} attach="material" />
    </mesh>
  );
}

function Aim() {
  const camera = useThree((s) => s.camera);
  const r = (PITCH * Math.PI) / 180;
  camera.position.set(0, 12, 0);
  camera.lookAt(Math.cos(r) * 400, 12 + Math.sin(r) * 400, 0);
  camera.updateMatrixWorld();
  return null;
}

createRoot(document.getElementById('root')!).render(
  <Canvas camera={{ position: [0, 12, 0], fov: 70, near: 0.5, far: 2000 }}>
    <Aim />
    <Sky />
  </Canvas>
);

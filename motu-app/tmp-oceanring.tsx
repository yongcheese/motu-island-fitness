/**
 * Temporary harness: the REAL <Ocean /> and <SkyDome /> from the app, viewed from
 * above so the near/far crossfade ring (uFadeStart..uFadeEnd) is in frame.
 * Not part of the app.
 *
 *   ?cam=top      looking down at the sea around the island
 *   ?cam=horizon  the game's own lens, aimed at the horizon
 */
import { createRoot } from 'react-dom/client';
import { Canvas, useThree } from '@react-three/fiber';
import { AppProvider } from './src/context/AppContext';
import { Ocean } from './src/components/Three/Ocean';
import { SkyDome } from './src/components/Three/SkyDome';

const params = new URLSearchParams(location.search);
const CAM = params.get('cam') ?? 'top';
/** ?only=sky | ocean | both - which layer to draw, so the two can be told apart. */
const ONLY = params.get('only') ?? 'both';

function Aim() {
  const camera = useThree((s) => s.camera);
  if (CAM === 'horizon') {
    camera.position.set(30, 12, 40);
    camera.lookAt(-300, 30, -400);
  } else {
    camera.position.set(0, 95, 60);
    camera.lookAt(0, 0, 0);
  }
  camera.updateMatrixWorld();
  return null;
}

createRoot(document.getElementById('root')!).render(
  <AppProvider>
    <Canvas camera={{ position: [0, 95, 60], fov: 45, near: 0.5, far: 2000 }}>
      <Aim />
      {ONLY !== 'ocean' && <SkyDome />}
      {ONLY === 'ocean' && (
        /* Opaque backdrop so the ocean's own shading is all that is on screen. */
        <mesh>
          <sphereGeometry args={[600, 32, 32]} />
          <meshBasicMaterial color="#404040" side={2} />
        </mesh>
      )}
      {ONLY !== 'sky' && <Ocean />}
      <ambientLight intensity={1} />
    </Canvas>
  </AppProvider>
);

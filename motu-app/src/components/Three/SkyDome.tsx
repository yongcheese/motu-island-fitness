import React, { useMemo, useRef } from 'react';
import * as THREE from 'three';
import { useFrame } from '@react-three/fiber';
import { useAppPick } from '../../context/AppContext';
import { WeatherType } from '../../types';
import { useLightningFlicker } from '../../hooks/useLightningFlicker';

/**
 * Lightning's white, and the two scratch colours the flash is mixed into.
 *
 * Module scope because the storm branch below runs every frame while a flash is up and used to
 * build three fresh THREE.Color objects each time it did. That is small, but it is small garbage
 * produced at 60Hz in the middle of a stutter report, and there is nothing here that has to be
 * new - the values are overwritten from `targets` before they are read.
 */
const FLASH_TOP = new THREE.Color('#f1f5f9');
const FLASH_BOTTOM = new THREE.Color('#ffffff');
const flashTopScratch = new THREE.Color();
const flashBottomScratch = new THREE.Color();

export function SkyDome() {
  const { weather } = useAppPick('weather');

  const topColorRef = useRef(new THREE.Color('#bae6fd'));
  const bottomColorRef = useRef(new THREE.Color('#e0f2fe'));
  
  const material = useMemo(() => {
    return new THREE.ShaderMaterial({
      uniforms: {
        uTopColor: { value: topColorRef.current },
        uBottomColor: { value: bottomColorRef.current },
      },
      vertexShader: `
        varying vec3 vWorldPosition;
        void main() {
          vec4 worldPosition = modelMatrix * vec4(position, 1.0);
          vWorldPosition = worldPosition.xyz;
          gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
        }
      `,
      fragmentShader: `
        varying vec3 vWorldPosition;
        uniform vec3 uTopColor;
        uniform vec3 uBottomColor;
        void main() {
          float h = normalize(vWorldPosition).y;
          // The gradient has to span the SKY, not the first three degrees of it.
          //
          // This was smoothstep(0.0, 0.05, h). h is the sine of the elevation angle, so 0.05 is
          // 2.9 degrees: the entire horizon-to-zenith blend finished within three degrees of the
          // waterline and everything above it was one flat, unshaded colour. That is what the
          // 破圖 report is looking at - a hard-edged pale stripe pasted along the horizon under a
          // dead blue ceiling, with the seam between them landing in the same few pixels as the
          // sea's own horizon line.
          //
          // It is worst zoomed out, which is exactly where it was reported: the third-person
          // camera's lens is 35 / uiScale, so pulling back to uiScale 0.5 opens the FOV from
          // 35 to 70 degrees and roughly doubles how much sky is on screen - a band that was
          // half-off the top of the frame becomes a stripe across the middle of it.
          //
          // 0.42 puts the zenith colour at ~25 degrees of elevation, so the pale horizon haze now
          // occupies a believable slab of sky and arrives at the sea as a gradient rather than as
          // an edge. Both endpoint colours are untouched: this changes the SHAPE of the ramp, not
          // the palette, so every weather's identity survives.
          float factor = smoothstep(0.0, 0.42, h);
          gl_FragColor = vec4(mix(uBottomColor, uTopColor, factor), 1.0);
        }
      `,
      side: THREE.BackSide,
    });
  }, []);

  const targets = useMemo(() => {
    switch (weather) {
      case WeatherType.SUNNY:
        return {
          top: new THREE.Color('#4fc3f7'), // Gorgeous deep sky blue
          bottom: new THREE.Color('#e0f2fe'), // Very light pastel horizon
          sunPos: new THREE.Vector3(120, 140, -150),
          sunScale: 1.0,
          sunColor: new THREE.Color('#ffffff'),
          glow1: new THREE.Color('#fcd34d'),
          glow2: new THREE.Color('#fbbf24'),
          opacity: 1.0,
        };
      case WeatherType.RAINY:
        return {
          top: new THREE.Color('#5a6a80'), // Foggy grey-teal
          bottom: new THREE.Color('#94a3b8'), // Misty wet horizon
          sunPos: new THREE.Vector3(120, 100, -150),
          sunScale: 0.7,
          sunColor: new THREE.Color('#e2e8f0'),
          glow1: new THREE.Color('#94a3b8'),
          glow2: new THREE.Color('#64748b'),
          opacity: 0.12, // Sun dimmed substantially behind clouds
        };
      case WeatherType.STORM:
        return {
          top: new THREE.Color('#1e293b'), // Storm dark slate
          bottom: new THREE.Color('#334155'), // Deep heavy cloud color
          sunPos: new THREE.Vector3(120, 80, -150),
          sunScale: 0.5,
          sunColor: new THREE.Color('#cbd5e1'),
          glow1: new THREE.Color('#475569'),
          glow2: new THREE.Color('#1e293b'),
          opacity: 0.02, // Barely visible sun
        };
      case WeatherType.SNOW:
        return {
          top: new THREE.Color('#9fc3df'), // Overcast soft winter blue
          bottom: new THREE.Color('#f1f5f9'), // Frosted bright horizon
          sunPos: new THREE.Vector3(120, 120, -150),
          sunScale: 0.95,
          sunColor: new THREE.Color('#ffffff'),
          glow1: new THREE.Color('#e2e8f0'),
          glow2: new THREE.Color('#cbd5e1'),
          opacity: 0.45, // Diffused pale winter sun
        };
      case WeatherType.TWILIGHT:
        return {
          top: new THREE.Color('#4c1d95'), // Sunset deep royal purple
          bottom: new THREE.Color('#ea580c'), // Horizon orange glow
          sunPos: new THREE.Vector3(140, 18, -150), // Low sunset disk
          sunScale: 1.9, // Aesthetic sunset magnification
          sunColor: new THREE.Color('#f97316'), // Deep orange low sun
          glow1: new THREE.Color('#ea580c'), // Twilight crimson glow
          glow2: new THREE.Color('#9d174d'), // Dark pink halo
          opacity: 0.9,
        };
      case WeatherType.MIDNIGHT:
        return {
          top: new THREE.Color('#060d24'), // Near-black zenith, so stars read
          bottom: new THREE.Color('#1b2a52'), // Faint indigo horizon glow
          // The sun is put below the horizon and faded out entirely; the moon in
          // NightSky.tsx is the light source in the sky at night.
          sunPos: new THREE.Vector3(140, -80, -150),
          sunScale: 1.0,
          sunColor: new THREE.Color('#1e293b'),
          glow1: new THREE.Color('#1e293b'),
          glow2: new THREE.Color('#0f172a'),
          opacity: 0.0,
        };
      default:
        return {
          top: new THREE.Color('#bae6fd'),
          bottom: new THREE.Color('#e0f2fe'),
          sunPos: new THREE.Vector3(100, 150, -150),
          sunScale: 1.0,
          sunColor: new THREE.Color('#ffffff'),
          glow1: new THREE.Color('#fcd34d'),
          glow2: new THREE.Color('#fbbf24'),
          opacity: 1.0,
        };
    }
  }, [weather]);

  const sunRef = useRef<THREE.Group>(null);
  const sunGlobeRef = useRef<THREE.Mesh>(null);
  const glow1Ref = useRef<THREE.Mesh>(null);
  const glow2Ref = useRef<THREE.Mesh>(null);
  
  // Dynamic lightning state
  const updateLightning = useLightningFlicker();

  useFrame((state) => {
    const elapsed = state.clock.getElapsedTime();

    // Smoothly interpolate uniform colors (Lerp)
    let currentTop = targets.top;
    let currentBottom = targets.bottom;

    // Handle random lightning flashes during STORM (high frequency double-flicker feel)
    const flashVal = updateLightning(elapsed, weather === WeatherType.STORM, 0.8, 0.2);
    if (flashVal > 0) {
      currentTop = flashTopScratch.copy(targets.top).lerp(FLASH_TOP, flashVal * 0.7);
      currentBottom = flashBottomScratch.copy(targets.bottom).lerp(FLASH_BOTTOM, flashVal * 0.95);
    }

    material.uniforms.uTopColor.value.lerp(currentTop, 0.03);
    material.uniforms.uBottomColor.value.lerp(currentBottom, 0.03);

    // Update Sun positioning & appearance
    if (sunRef.current) {
      sunRef.current.position.lerp(targets.sunPos, 0.03);
    }
    
    if (sunGlobeRef.current) {
      const gMat = sunGlobeRef.current.material as THREE.MeshBasicMaterial;
      gMat.color.lerp(targets.sunColor, 0.03);
      gMat.opacity = THREE.MathUtils.lerp(gMat.opacity, targets.opacity, 0.03);
      gMat.transparent = true;
      
      const targetScale = targets.sunScale * (1 + Math.sin(elapsed * 2) * 0.03); // Breathing sun
      sunGlobeRef.current.scale.setScalar(targetScale);
    }

    if (glow1Ref.current) {
      const gMat1 = glow1Ref.current.material as THREE.MeshBasicMaterial;
      gMat1.color.lerp(targets.glow1, 0.03);
      gMat1.opacity = THREE.MathUtils.lerp(gMat1.opacity, targets.opacity * 0.4, 0.03);
      gMat1.transparent = true;
      glow1Ref.current.scale.setScalar(targets.sunScale * 1.5 + Math.sin(elapsed * 3) * 0.05);
    }

    if (glow2Ref.current) {
      const gMat2 = glow2Ref.current.material as THREE.MeshBasicMaterial;
      gMat2.color.lerp(targets.glow2, 0.03);
      gMat2.opacity = THREE.MathUtils.lerp(gMat2.opacity, targets.opacity * 0.15, 0.03);
      gMat2.transparent = true;
      glow2Ref.current.scale.setScalar(targets.sunScale * 2.5 + Math.cos(elapsed * 2.5) * 0.08);
    }
  });

  return (
    <group>
      {/* Sky Sphere.
          32x32 is enough, and that is a MEASURED answer rather than an assumption. The gradient
          is evaluated per fragment from `normalize(vWorldPosition)`, and a world position
          interpolates along the chord rather than along the sphere, so in principle the ramp
          creases along every triangle edge. In practice it does not show: rendering the same
          gradient at 32x32 and at 64x40, aimed straight down the band where the ramp actually
          varies, came out pixel-identical to within a rounding step (max channel-sum delta 2 of
          765) with the same peak second derivative down the centre column. There is no faceting
          here to fix, so there is no reason to pay for the vertices. */}
      <mesh>
        <sphereGeometry args={[500, 32, 32]} />
        <primitive object={material} attach="material" />
      </mesh>
      
      {/* Sun Group */}
      <group ref={sunRef} position={[100, 150, -150]}>
        {/* Core Sun */}
        <mesh ref={sunGlobeRef}>
          <sphereGeometry args={[15, 32, 32]} />
          <meshBasicMaterial color="#ffffff" transparent />
        </mesh>
        {/* Glow Halo 1 */}
        <mesh ref={glow1Ref}>
          <sphereGeometry args={[15, 32, 32]} />
          <meshBasicMaterial color="#fcd34d" transparent opacity={0.4} />
        </mesh>
        {/* Glow Halo 2 */}
        <mesh ref={glow2Ref}>
          <sphereGeometry args={[15, 32, 32]} />
          <meshBasicMaterial color="#fbbf24" transparent opacity={0.15} />
        </mesh>
      </group>
    </group>
  );
}

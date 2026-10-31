/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useEffect, useRef, useMemo } from 'react';
import * as THREE from 'three';
import { Canvas, useFrame, useThree } from '@react-three/fiber';
import { tuneRenderer } from '../../lib/rendererTuning';
import { setWindWeather } from '../../lib/outdoorMotion';
import { ZFightAuditBridge } from './ZFightAuditBridge';
import { AdaptiveResolution, initialDpr } from './AdaptiveResolution';
import { Environment } from '@react-three/drei';
import { Ocean } from './Ocean';
import { OceanDecorations } from './OceanDecorations';
import { Fish } from './Fish';
import { Island } from './Island';
import { Avatar } from './Avatar';
import { IslandPlacements, PlacementGhost } from './PlacementGhost';
import { IslandDecorations } from './IslandDecorations';
import { IslandOvergrowth } from './IslandOvergrowth';
import { PlayerHomeView } from './PlayerHomeView';
import { Clouds } from './Clouds';
import { CameraController } from './CameraController';
import { InteractionPromptTracker } from './InteractionPromptTracker';
import { IslandPet } from './IslandPet';
import { IslandNpcs } from './IslandNpcs';
import { MerchantVisitors } from './MerchantVisitor';
import { Weather } from './Weather';
import { Fireflies } from './Fireflies';
import { CosmeticEffectField } from './effects';
import { SkyDome } from './SkyDome';
import { IslandColourVeil } from '../UI/IslandColourVeil';
import { NightSky } from './NightSky';
import { HDRI_SUNSET } from '../../constants/environmentMaps';
import {
  AMBIENCE_SHADE_MAX,
  AMBIENCE_SHADE_TINT,
  resolveIslandAmbience,
  type IslandAmbience,
} from '../../constants/islandReturn';

import { useAppPick } from '../../context/AppContext';
import { getSurfaceAt } from '../../lib/placementSurfaces';
import { View, WeatherType } from '../../types';
import { useLightningFlicker } from '../../hooks/useLightningFlicker';

// Shared white, read every frame by the lightning flash below. Allocating it inside useFrame
// made one throwaway THREE.Color per frame purely to hold a constant.
const FLASH_COLOR = new THREE.Color('#ffffff');

/**
 * The weather's own lighting, before an absence is taken into account.
 *
 * Lifted out of the component so {@link SceneLighting} can state its grading in one place instead
 * of threading a multiplier through seven switch arms. These are the numbers the island has always
 * used; nothing here changed when 離線環境 arrived.
 */
function weatherLighting(weather: WeatherType) {
  switch (weather) {
    case WeatherType.SUNNY:
      return {
        ambInt: 0.5,
        hemiInt: 0.6,
        hemiCol: new THREE.Color('#ffffff'),
        dirInt: 1.4,
        dirCol: new THREE.Color('#fffbeb'), // Warm golden sun
      };
    case WeatherType.RAINY:
      return {
        ambInt: 0.28,
        hemiInt: 0.35,
        hemiCol: new THREE.Color('#94a3b8'),
        dirInt: 0.5,
        dirCol: new THREE.Color('#cbd5e1'), // Overcast dim teal-grey
      };
    case WeatherType.STORM:
      return {
        ambInt: 0.15,
        hemiInt: 0.2,
        hemiCol: new THREE.Color('#475569'),
        dirInt: 0.25,
        dirCol: new THREE.Color('#334155'), // Dark stormy blue-slate
      };
    case WeatherType.SNOW:
      return {
        ambInt: 0.7, // Snow bounce reflection
        hemiInt: 0.5,
        hemiCol: new THREE.Color('#e2e8f0'),
        dirInt: 0.85,
        dirCol: new THREE.Color('#f8fafc'), // Light frozen color
      };
    case WeatherType.TWILIGHT:
      return {
        ambInt: 0.35,
        hemiInt: 0.5,
        hemiCol: new THREE.Color('#c084fc'), // Purple twilight bounce
        dirInt: 0.95,
        dirCol: new THREE.Color('#f97316'), // Fiery sunset orange directional
      };
    case WeatherType.MIDNIGHT:
      return {
        // Dark, but deliberately not as dark as STORM: the island still has to
        // be readable enough to walk around and place furniture on at night.
        ambInt: 0.3,
        hemiInt: 0.34,
        hemiCol: new THREE.Color('#1e3a8a'), // Deep blue night bounce
        dirInt: 0.5,
        dirCol: new THREE.Color('#a5c4ff'), // Pale moonlight
      };
    default:
      return {
        ambInt: 0.5,
        hemiInt: 0.5,
        hemiCol: new THREE.Color('#ffffff'),
        dirInt: 1.2,
        dirCol: new THREE.Color('#ffffff'),
      };
  }
}

/** The colour a long absence leans the light toward. Built once — see constants/islandReturn.ts. */
const SHADE_COLOR = new THREE.Color(AMBIENCE_SHADE_TINT);

/** Scratch for the HSL round-trips below, so grading a colour allocates nothing extra. */
const HSL = { h: 0, s: 0, l: 0 };

/**
 * 離線環境的顏色 — one weather light colour, aged by however overgrown the island is.
 *
 * ## Why this is not a post-processing pass
 *
 * 「畫面稍微變暗、飽和度降低」 reads as a job for a colour-grading pass over the finished frame, and
 * that is what it would be in a project that already had an EffectComposer. This one does not: the
 * island renders straight to the canvas, and adding a composer means a new dependency, a
 * full-screen render target, and at minimum one extra full-screen draw every frame on hardware
 * that the brief explicitly says has stuttered before. For a *subtle, permanent* tint that is a
 * very large bill for a very small effect.
 *
 * Desaturating the LIGHT instead buys nearly the same picture for nothing at all. Everything on
 * the island is lit by these three lights, so pulling the saturation out of their colour pulls it
 * out of every surface they touch — no new pass, no new material, no per-object shader, and not a
 * single extra draw call. It differs from a true post-process only on emissive and unlit surfaces
 * (the sky dome, the fireflies), and leaving those alone is arguably the better picture anyway:
 * an overgrown garden is shaded, not overcast.
 *
 * The lightness the weather chose is restored at the end on purpose. Dimming is the intensity
 * term's job ({@link IslandAmbience.brightness}) and the exposure's; if the tint were allowed to
 * darken as well, the three would compound invisibly and 「稍微變暗」 would quietly become 「變黑」.
 */
function gradeLightColor(base: THREE.Color, ambience: IslandAmbience): THREE.Color {
  base.getHSL(HSL);
  const lightness = HSL.l;
  const out = new THREE.Color().setHSL(HSL.h, HSL.s * ambience.saturation, lightness);
  out.lerp(SHADE_COLOR, ambience.shade * AMBIENCE_SHADE_MAX);
  out.getHSL(HSL);
  return out.setHSL(HSL.h, HSL.s, lightness);
}

// Performance-optimized lighting sub-component to interactively lerp lights on frame
function SceneLighting() {
  const { weather, profile } = useAppPick('weather', 'profile');
  const gl = useThree((state) => state.gl);
  const ambientRef = useRef<THREE.AmbientLight>(null);
  const hemiRef = useRef<THREE.HemisphereLight>(null);
  const dirRef = useRef<THREE.DirectionalLight>(null);

  /**
   * 島嶼目前的荒廢程度 — resolved ONCE, here, from the list the scene is already drawing.
   *
   * Not from `lastSeenAt`, and not per-component: this is the brief's 「不要讓不同 Component 各自
   * 計算離線天數」 line, and the reason the calculation lives in constants/islandReturn.ts rather
   * than in either of the two files that read it. It costs a length lookup and returns a shared
   * constant for the overwhelmingly common case of a clean island.
   *
   * Because it is derived from the sprouts rather than from the clock, the light comes back as the
   * player tidies — the same array shrinks, the same number falls, and the lerp below carries the
   * island home over the next second or so with no recovery logic anywhere. See §7 of the brief
   * and the long note on {@link IslandAmbience}.
   */
  const ambience = resolveIslandAmbience(profile?.islandState?.sprouts);

  /**
   * HOW WINDY IT IS, published out of React for the outdoor animation system.
   *
   * Every swaying plant, the mobile and the hammock read the weather's wind multiplier, and none
   * of them can call `useApp()` to get it: those models are also rendered by the build-time
   * audits through a stub hook dispatcher with no providers above them
   * (scripts/lib/measureFurnitureModel.ts), where a context read throws and the model is filed as
   * unmeasurable. One publish from the component that already has the weather, read as a module
   * value by lib/outdoorMotion.ts, keeps the models context-free.
   */
  useEffect(() => { setWindWeather(weather); }, [weather]);

  // Keyed on the grading SCALARS rather than on the ambience object, so this recomputes when the
  // island actually changes and not merely when some unrelated part of the profile is patched.
  const targets = useMemo(() => {
    const base = weatherLighting(weather);
    return {
      ambInt: base.ambInt * ambience.brightness,
      hemiInt: base.hemiInt * ambience.brightness,
      hemiCol: gradeLightColor(base.hemiCol, ambience),
      dirInt: base.dirInt * ambience.brightness,
      dirCol: gradeLightColor(base.dirCol, ambience),
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [weather, ambience.brightness, ambience.saturation, ambience.shade]);

  const updateLightning = useLightningFlicker();

  useFrame((state) => {
    const elapsed = state.clock.getElapsedTime();

    // Lightning strike timing synced dynamically with SkyDome
    const flash = updateLightning(elapsed, weather === WeatherType.STORM, 0.9, 0.15);
    const flashAmbient = flash * 0.9;
    const flashDir = flash * 2.8;

    // Lerp direct and indirect lighting values for realistic ambient density shifts
    if (ambientRef.current) {
      ambientRef.current.intensity = THREE.MathUtils.lerp(
        ambientRef.current.intensity,
        targets.ambInt + flashAmbient,
        0.03
      );
    }
    if (hemiRef.current) {
      hemiRef.current.intensity = THREE.MathUtils.lerp(
        hemiRef.current.intensity,
        targets.hemiInt + flashAmbient * 0.5,
        0.03
      );
      hemiRef.current.color.lerp(
        flashAmbient > 0 ? FLASH_COLOR : targets.hemiCol,
        0.03
      );
    }
    if (dirRef.current) {
      dirRef.current.intensity = THREE.MathUtils.lerp(
        dirRef.current.intensity,
        targets.dirInt + flashDir,
        0.03
      );
      dirRef.current.color.lerp(
        flashDir > 0 ? FLASH_COLOR : targets.dirCol,
        0.03
      );
    }

    /**
     * 光線稍微變弱 — the last of the four grading terms, and the only one that is not a light.
     *
     * One scalar on the renderer, so it costs nothing and reaches everything the lights cannot
     * (the sky, the ocean's own tint), which is what keeps a heavily overgrown island from looking
     * like a dim garden under a bright sky.
     *
     * It rides the SAME 0.03 lerp as the lights above, and that is the whole of the brief's §15:
     * a returning player's first seconds are the exposure and the three lights easing from where
     * they were toward what the absence is worth — 「數秒內逐漸套用」 — rather than the island
     * being dim on frame one. There is no transition timer anywhere in this feature, because the
     * lighting rig was already a smoothing filter and an absence is just another input to it.
     *
     * Per-renderer, so it cannot leak: the house interior and the shop mount their own <Canvas>
     * and are never touched by this.
     */
    gl.toneMappingExposure = THREE.MathUtils.lerp(gl.toneMappingExposure, ambience.exposure, 0.03);
  });

  return (
    <>
      <ambientLight ref={ambientRef} intensity={0.4} />
      <hemisphereLight ref={hemiRef} intensity={0.5} color="#ffffff" groundColor="#4a4a4a" />
      {/* The island's sun, and the only shadow caster outdoors.

          The four `shadow-*` settings below the camera box were added with the 地表/人物 quality
          pass, and they are what make the shadow map usable for CONTACT shadows rather than only
          for the big soft blobs the terrain was getting:

          near/far — the default range is 0.5 to 500 over a scene whose content sits between 15
            and 45 units from this light. Depth precision is spent across the whole range, so
            999 parts in 1000 of a 16-bit depth buffer were describing empty space beyond the
            island. Tightening it to 5..70 is a straight ~7x gain in usable precision, for free.
          bias/normalBias — required the moment anything self-shadows. The character's meshes now
            receive shadows (see character/bodySurface.ts), and a curved surface lit at a grazing
            angle is where depth-map acne appears: without these, the skull's own shadow lands on
            the skull as a band of stripes. normalBias (offsetting the lookup ALONG the surface
            normal) is the one that matters on spheres and capsules; the constant bias handles
            what is left, and is kept small so contact shadows do not detach from their caster. */}
      <directionalLight
        ref={dirRef}
        position={[20, 20, 10]}
        intensity={1.2}
        castShadow
        /* 1024, down from 2048. The shadow camera below spans 40 world units, so this
           is still ~26 shadow texels per unit - far finer than a stylised island with
           PCF filtering can show - while the map itself is a quarter of the pixels.
           It is not a one-off cost: a shadow map is a full extra render of every
           castShadow object in the scene, EVERY frame, and at 2048 that pass was
           writing four megapixels of depth per frame to resolve edges that the filter
           then softens away again. */
        shadow-mapSize={[1024, 1024]}
        shadow-camera-left={-20}
        shadow-camera-right={20}
        shadow-camera-top={20}
        shadow-camera-bottom={-20}
        shadow-camera-near={5}
        shadow-camera-far={70}
        shadow-bias={-0.0004}
        shadow-normalBias={0.028}
      />
    </>
  );
}

/**
 * Everything inside the island's <Canvas>.
 *
 * Its own component purely so it can be memoised, and it deliberately takes NO props, so after
 * mount React never walks it again. That is the point: <Scene /> is a direct child of AppContent,
 * which consumes AppContext, and R3F's own <Canvas> subscribes to the same context to bridge it
 * across the renderer boundary - so every context change (a coin awarded, the weather cycling, a
 * proximity flag flipping) used to re-render this entire 3D element tree, hundreds of elements
 * reconciled against state almost none of them read.
 *
 * Nothing is lost. The pieces that DO depend on context - SceneLighting, Avatar, Island, and the
 * rest - subscribe themselves, and only to the fields they read (useAppPick; useAppReader for the
 * ones read only inside a frame loop), so each re-renders when ITS data changes and not otherwise.
 */
/**
 * The cosmetic field, plus the one thing it needs that only AppContext can answer.
 *
 * Its own component so SceneContents above can stay free of context and stay memoised: the ground
 * lookup is the only piece in that tree which has to be rebuilt when the island's placements or
 * territory level change, so it is the only piece that subscribes.
 *
 * groundAt is "how high is the ground at (x, z)" for ground-conforming cosmetics — the same lookup
 * the player's own feet use (characterMovement's resolveCollisions calls getSurfaceAt too).
 *
 * Sharing it is the point: a ring of light drawn around someone standing on a deck sits ON the
 * deck, and it does so with no knowledge of decks, because the one function that knows where
 * the top of anything is already answers for both.
 */
function GroundedCosmeticField({ children }: { children?: React.ReactNode }) {
  const { profile } = useAppPick('profile');

  const groundAt = useMemo(() => {
    const placements = profile?.islandPlacements ?? [];
    const islandScale = 1 + ((profile?.territoryLevel ?? 1) - 1) * 0.4;
    return (x: number, z: number) => getSurfaceAt(x, z, placements, islandScale).y;
  }, [profile?.islandPlacements, profile?.territoryLevel]);

  return <CosmeticEffectField groundAt={groundAt}>{children}</CosmeticEffectField>;
}

const SceneContents = React.memo(function SceneContents() {
  return (
    <>
        <SkyDome />
        {/* 深夜's moon, stars and shooting stars. Always mounted; it fades
            itself in and out with the weather (see NightSky.tsx). */}
        {/* No drei <Stars> here, and that is the other half of the 破圖 report.
            It was mounted unconditionally with no weather gate of any kind, so 2000
            additively-blended white points were drawn into the sky at HIGH NOON - a
            permanent scatter of pale specks over the blue that reads as dead pixels
            rather than as anything in the world. Its field is a full SPHERE, so about
            half of those points sat BELOW the waterline; Ocean's surface planes are
            transparent with depthWrite off and therefore cannot occlude anything, so
            they came through the sea as well. Diffing two renders of the same frame
            with and without it put 37 changed pixels in the sky and 9 in the water,
            with the lowest 260px under the horizon.
            深夜's stars are NightSky.tsx's own StarField, which is gated on the night
            ramp, confined to the upper hemisphere for exactly this reason, and
            twinkles per star. Nothing is lost by deleting this line. */}
        <Fireflies count={40} />
        {/* Self-hosted HDR rather than drei's `preset="sunset"` - see
            constants/environmentMaps.ts. */}
        <Environment files={HDRI_SUNSET} />
        
        <SceneLighting />

        {/* Special cosmetic effects. Wraps the world group because the player and the pet are
            both inside it and both register their ornaments through this provider; the pooled
            particle meshes it mounts alongside them live in untransformed world space, which
            this group is (it has no transform of its own). One per Canvas — see
            Three/effects/EffectField.tsx. */}
        <GroundedCosmeticField>
        <group>
          <Ocean />
          {/* The sea floor and everything growing on it. Mounted here rather
              than inside Ocean.tsx because that component's contents live in an
              already-rotated group where local Z is world up - reasoning about
              seabed depth in that frame is needlessly confusing. */}
          <OceanDecorations />
          {/* Sits below Ocean's surface planes - drawn opaque, so the
              translucent water blends over it and tints the shoal */}
          <Fish count={32} />
          <Clouds />
          <Island />
          <Avatar isInterior={false} />
          {/* The player's one Home, drawn separately from IslandPlacements so no code path can
              ever produce a second dwelling. */}
          <PlayerHomeView />
          <IslandPlacements />
          <PlacementGhost />
          {/* The equipped 寵物 walking beside its owner - or, with nothing equipped, the island's
              own stray. See IslandPet.tsx for which of the two is mounted. */}
          <IslandPet />
          {/* 拿著鏟子在島上到處走的餅乾兔園丁。掛在 Island 之後，因為她每一步的腳下高度
              都是問地形要的（見 IslandNpcs.tsx）。另一位居民（河馬管家）在屋子裡，掛在
              BuildingInteriorView 那個 Canvas 上。 */}
          <IslandNpcs />
          {/* 島邊的訪客 —— 旅行商人與他的小船（Three/MerchantVisitor.tsx）。掛在世界
              group 裡而不是 Ocean 裡面：Ocean 的內容活在一個已經轉過的 group（local Z 是
              世界的上）裡，而這艘船是照世界座標航行的。他在不在，是限時商店的檔期算出來
              的（constants/merchantVisit.ts），不是這裡決定的。 */}
          <MerchantVisitors />
          <IslandDecorations />
          {/* 離線回歸 — whatever grew while nobody was here (Three/IslandOvergrowth.tsx).
              Drawn after the island own decorations and as a SIBLING of PlayerHomeView: it is
              temporary world state rather than art or furniture, it carries no collider and no
              pointer handlers, and nothing in the build/placement system can see it. */}
          <IslandOvergrowth />
          <Weather />
        </group>
        </GroundedCosmeticField>

        {/* No <ContactShadows> here. It re-rendered the ENTIRE scene into an
            offscreen depth target plus two blur passes on every single frame
            (drei's `frames` prop defaults to Infinity), which profiling put at
            ~100x the cost of every other per-frame subscriber combined - and it
            bought nothing, because its plane sits at y=0 while the island's
            opaque walkable surface is at ISLAND_SURFACE_Y (0.3), so it was
            buried under the terrain and never visible. Ground shadows come from
            the directional light's real shadow map above (castShadow +
            receiveShadow on the terrain), which is what was actually being seen
            all along. */}

        <CameraController minDistance={10} maxDistance={35} />
        <InteractionPromptTracker />
        <ZFightAuditBridge label="island" />
    </>
  );
});

/**
 * The island.
 *
 * Holds nothing but the <Canvas> and the one piece of state that has to reach it as a PROP:
 * whether to keep rendering at all.
 *
 * `frameloop='never'` stops the island entirely while a full-screen view is covering it. Going
 * into the house does not replace this Canvas - BuildingInteriorView mounts a SECOND one on top
 * (App.tsx's View Overlays block), so without this the island kept drawing every frame, shadow
 * map and all, behind an opaque interior: two live WebGL scenes competing for the same GPU and
 * the same main thread, which is what made crossing the threshold hitch. The same holds for the
 * shop, the dressing room and the rest - each covers the island completely, or (Settings,
 * Tracker) behind a stack of two heavy backdrop blurs that nothing recognisable survives.
 * BUILD_MODE is deliberately NOT covered: it decorates the island through this very Canvas.
 *
 * It has to be the PROP and not an imperative `setFrameloop` from inside the Canvas. R3F
 * re-applies this prop on every render of <Canvas>, and <Canvas> re-renders on every AppContext
 * change (it consumes the context in order to bridge it across the renderer boundary) - so a
 * child calling setFrameloop was overwritten again within a tick, and the island never actually
 * stopped. Driving it from the prop makes React's value the only one there is.
 *
 * Note setFrameloop resets the render clock. That is fine here precisely because it can only
 * happen while the scene is hidden, so no time-driven animation is ever seen jumping.
 */
export const Scene = React.memo(function Scene() {
  // Memoised and picked: App re-renders on every AppContext change, and a re-render here is a
  // re-render of <Canvas>, which re-applies its props and re-bridges every context into the 3D
  // tree. The island only needs to hear about the one field that drives its frameloop.
  const { currentView } = useAppPick('currentView');
  const covered = currentView !== View.HOME && currentView !== View.BUILD_MODE;

  /**
   * How many pixels the island is drawn at — see Three/AdaptiveResolution.tsx.
   *
   * State here rather than a constant on the <Canvas> below, and measured from inside the
   * renderer rather than guessed from the hardware, because this scene's frame time is almost
   * entirely a function of the drawing buffer's area (the measurements are in that file). A
   * fixed cap has to be chosen for the weakest machine or the sharpest display and is wrong for
   * the other; letting the number follow the frame time it actually produces is right for both.
   *
   * It has to live at this level for the same reason `frameloop` does: <Canvas> re-applies its
   * own props on every render, and it re-renders on every AppContext change, so a value set
   * imperatively from a child is overwritten within a tick.
   */
  const [dpr, setDpr] = React.useState(initialDpr);

  return (
    <div className="w-full h-full absolute inset-0 z-background cursor-crosshair">
      {/* `near` is set explicitly because the default (0.1) throws away almost
          all of this scene's depth precision. Depth resolution scales with
          near/far ratio, and the ocean's far plane forces far=2000, so a 0.1
          near gives a 20000:1 range - at the ~50 units this camera orbits at,
          that leaves surfaces under ~0.4 apart unresolvable on any 16-bit depth
          context, which is where the terrain flicker was visible worst.

          0.5 is free: CameraController clamps the orbit to minDistance 10, and
          the only world content that can come nearer than that is a rain
          particle passing through the lens, which is a full-screen artifact
          either way. This is a supporting fix - the coplanar surfaces it used
          to expose have been merged in Island.tsx regardless, so nothing here
          depends on it. */}
      <Canvas
        frameloop={covered ? 'never' : 'always'}
        shadows={{ type: THREE.PCFShadowMap }}
        camera={{ position: [30, 12, 40], fov: 25, near: 0.5, far: 2000 }}
        /* THE SINGLE BIGGEST LEVER ON THIS SCENE'S FRAME TIME, and it was not set.
           With no `dpr` R3F renders at `window.devicePixelRatio`, so a laptop at
           Windows' default 150% scaling was drawing 2.25x the pixels of the canvas it
           displays, and a 4K panel 4x. That is paid in full by the one thing this
           scene has most of: BLENDED FULL-SCREEN LAYERS. Sky dome, far sea, near sea,
           the reflection smear, the wave crest, the foam, 200 transparent cloud puffs
           and the weather particles all overdraw the same pixels, none of them can
           early-Z out (they discard), and every one of them costs proportionally more
           the more pixels there are. 1.5 keeps the edges of the HUD-free 3D art
           smooth on a HiDPI panel while capping the worst case at 2.25x fewer
           fragments than an uncapped 4K display was doing.

           That cap is now the STARTING rung rather than the whole answer: `initialDpr()` picks
           exactly the number the old `[1, 1.5]` range would have produced, and
           <AdaptiveResolution> walks down from it on a machine that is missing frames at it.
           A 1x panel is now reachable too, which a floor of 1 could never help. */
        dpr={dpr}
        onCreated={({ gl }) => tuneRenderer(gl)}
      >
        <AdaptiveResolution dpr={dpr} onChange={setDpr} />
        {/* A Suspense boundary INSIDE the canvas, around everything that can suspend (the HDR
            <Environment>, the character's GLB parts). Without one, R3F forwards the suspension
            out by making <Canvas> itself suspend, and with nothing above it that paused the WHOLE
            app at the root: no commits for 20-140 s, a frozen loading bar, and the entire HUD
            re-rendering every frame while it waited (captured: deepest Incomplete fiber was
            CanvasImpl). It must be in here, not around <Canvas>: bounding it outside hides the
            committed canvas, which stops R3F's own root, so the island never drew at all. */}
        <React.Suspense fallback={null}>
          <SceneContents />
        </React.Suspense>
      </Canvas>

      {/* 離線褪色 — the desaturating sheet, and the recovery that lifts it (UI/IslandColourVeil).
          A SIBLING of the <Canvas> and inside this wrapper on purpose. Inside, so the frame it
          desaturates is the island and nothing else: every HUD tier is z-game-view and above, so
          the shop, the buttons and every modal stay in full colour over a black-and-white world.
          A sibling rather than a child, because it is a DOM element — it costs the R3F tree
          nothing, and it renders literally nothing at all unless this session began with a long
          absence. It cannot reach input: pointer-events are off and there is no path from it to
          the camera, a collider or a raycast. */}
      <IslandColourVeil />
    </div>
  );
});

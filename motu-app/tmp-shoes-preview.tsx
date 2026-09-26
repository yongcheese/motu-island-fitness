/**
 * Throwaway harness for eyeballing the new 3D wardrobe:
 *   - src/components/Three/Shoes.tsx   (under a stub of the avatar's leg capsule)
 *   - src/components/Three/Outfits.tsx (inside a stub of the avatar's torso capsule)
 * Both stubs copy Avatar.tsx's real dimensions, so anything poking through here pokes
 * through in game too. Delete with tmp-shoes-preview.html once this is signed off.
 */
import { createRoot } from 'react-dom/client';
import { Canvas } from '@react-three/fiber';
import { ShoeModel, ShoeType, soleAnchorY } from './src/components/Three/Shoes';
import { OutfitModel, OutfitType, OUTFIT_SHELL_COLOR, OUTFIT_HAS_SLEEVES } from './src/components/Three/Outfits';

const LEG_LENGTHEN = 0.0167;
const SKIN = '#f8d3b5';
const STRAIGHT = 0.14 + LEG_LENGTHEN;
const LEG_CENTER_Y = STRAIGHT / 2 + 0.055;

const SHOES: [ShoeType, string][] = [
  ['sport', '運動/休閒鞋'],
  ['leather', '皮鞋/紳士鞋'],
  ['heels', '優雅高跟鞋'],
  ['boots', '時尚靴子'],
  ['sandals', '涼鞋'],
  ['flipflops', '夾腳拖'],
];

const OUTFITS: [OutfitType, string][] = [
  ['surf', '衝浪運動裝'],
  ['diving', '潛水服'],
  ['explorer', '探險套裝'],
  ['captain', '船長制服'],
  ['vest', '探險背心'],
  ['shawl', '島嶼披肩'],
  ['jacket', '夾克'],
];

function Lights() {
  return (
    <>
      <ambientLight intensity={1.15} />
      <directionalLight position={[2, 4, 3]} intensity={2.1} />
      <directionalLight position={[-2, 1.5, -1]} intensity={0.6} />
    </>
  );
}

function ShoeRow({ pants }: { pants: boolean }) {
  return (
    <Canvas camera={{ position: [0.52, 0.36, 0.72], fov: 32 }}>
      <color attach="background" args={['#eaf2f8']} />
      <Lights />
      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, -0.001, 0]}>
        <planeGeometry args={[6, 6]} />
        <meshStandardMaterial color="#dfe9f0" roughness={1} />
      </mesh>
      {SHOES.map(([type], i) => (
        <group key={type} position={[(i - (SHOES.length - 1) / 2) * 0.3, 0, 0]}>
          <mesh position={[0, LEG_CENTER_Y, 0]}>
            <capsuleGeometry args={[0.055, STRAIGHT, 4, 16]} />
            <meshStandardMaterial color={pants ? '#2f4c7c' : SKIN} roughness={0.7} />
          </mesh>
          {/* soleAnchorY is leg-local (origin = hip pivot); this stub is drawn from the sole,
              so add the pivot height back to land the shoe on y=0. */}
          <group position={[0, soleAnchorY(LEG_LENGTHEN) + (0.225 + LEG_LENGTHEN), 0]}>
            <ShoeModel type={type} skinColor={SKIN} />
          </group>
        </group>
      ))}
    </Canvas>
  );
}

/** Torso stub: same capsule Avatar.tsx uses, with the garment nested inside it exactly as
 *  the real component does, plus the two arm capsules so sleeves can be checked. */
function OutfitRow({ back }: { back: boolean }) {
  return (
    <Canvas camera={{ position: back ? [0, 0.1, -0.85] : [0.28, 0.16, 0.78], fov: 34 }}>
      <color attach="background" args={['#eef1f5']} />
      <Lights />
      {OUTFITS.map(([type], i) => (
        <group key={type} position={[(i - (OUTFITS.length - 1) / 2) * 0.42, 0, 0]}>
          <mesh>
            <capsuleGeometry args={[0.135, 0.08, 4, 16]} />
            <meshStandardMaterial color={OUTFIT_SHELL_COLOR[type]} roughness={0.7} />
            <OutfitModel type={type} />
          </mesh>
          {OUTFIT_HAS_SLEEVES[type] &&
            [-1, 1].map((s) => (
              <group key={s} position={[s * 0.138, 0.06, 0]}>
                <mesh position={[0, -0.07, 0]}>
                  <capsuleGeometry args={[0.04, 0.1, 4, 16]} />
                  <meshStandardMaterial color={SKIN} roughness={0.7} />
                </mesh>
                <mesh position={[0, -0.03, 0]}>
                  <capsuleGeometry args={[0.048, 0.04, 4, 16]} />
                  <meshStandardMaterial color={OUTFIT_SHELL_COLOR[type]} roughness={0.6} />
                </mesh>
              </group>
            ))}
        </group>
      ))}
    </Canvas>
  );
}

function Labels({ items }: { items: [string, string][] }) {
  return (
    <div className="labels">
      {items.map(([id, label]) => (
        <span key={id}>
          {label}
          <br />
          <code>{id}</code>
        </span>
      ))}
    </div>
  );
}

createRoot(document.getElementById('root')!).render(
  <div>
    <h2>上衣（左：正面 / 右：背面）</h2>
    <div className="strip tall">
      <OutfitRow back={false} />
    </div>
    <Labels items={OUTFITS} />
    <div className="strip tall">
      <OutfitRow back />
    </div>
    <h2>鞋子（上：光腳 / 下：牛仔褲）</h2>
    <div className="strip">
      <ShoeRow pants={false} />
    </div>
    <div className="strip">
      <ShoeRow pants />
    </div>
    <Labels items={SHOES} />
  </div>,
);

// One-off export of the current in-game player model's BASE proportions
// (unclothed body + every wearable attachment point used by Avatar.tsx) as a
// .glb, for opening in Blender as a modeling reference. Not part of the app -
// safe to delete after use.
//
// Coordinates are left UNSCALED, i.e. in the same local-unit space as the
// numbers you see throughout Avatar.tsx (head radius 0.26, BASE_HEAD_Y 0.68,
// etc.) - NOT multiplied by the outer <group> 2.25x display scale. So 1 unit
// here = 1 "Avatar.tsx local unit". If you need true in-game world size,
// multiply everything by 2.25.
import * as THREE from 'three';
import { GLTFExporter } from 'three/examples/jsm/exporters/GLTFExporter.js';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

// GLTFExporter's binary path reads the merged buffer via FileReader, which
// only exists in browsers. Node has Blob (and Blob#arrayBuffer) natively, so
// a minimal polyfill that just delegates to that is enough.
if (typeof globalThis.FileReader === 'undefined') {
  globalThis.FileReader = class {
    readAsArrayBuffer(blob) {
      blob.arrayBuffer().then((buf) => {
        this.result = buf;
        this.onloadend?.();
      });
    }
  };
}

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const outDir = path.join(root, 'blender-reference');
fs.mkdirSync(outDir, { recursive: true });

const BASE_HEAD_Y = 0.68;
const BASE_BODY_Y = 0.36;
const skinColor = '#fcd34d';
const bodyColor = '#718096'; // default fallback shirt/pants tone when nothing is equipped

const scene = new THREE.Group();
scene.name = 'PlayerModel_Base';

const skinMat = () => new THREE.MeshStandardMaterial({ color: skinColor, roughness: 0.7 });
const bodyMat = () => new THREE.MeshStandardMaterial({ color: bodyColor, roughness: 0.7 });

// --- Head -------------------------------------------------------------
const head = new THREE.Group();
head.name = 'Head';
head.position.set(0, BASE_HEAD_Y, 0);
scene.add(head);

const headMesh = new THREE.Mesh(new THREE.SphereGeometry(0.26, 32, 32), skinMat());
headMesh.name = 'Head_Skin';
head.add(headMesh);

const eyeL = new THREE.Mesh(new THREE.SphereGeometry(0.036, 16, 16), new THREE.MeshStandardMaterial({ color: '#0d1117' }));
eyeL.name = 'Eye_L';
eyeL.position.set(-0.104, 0.035, 0.225);
head.add(eyeL);
const eyeR = eyeL.clone();
eyeR.name = 'Eye_R';
eyeR.position.set(0.104, 0.035, 0.225);
head.add(eyeR);

// --- Torso --------------------------------------------------------------
const body = new THREE.Mesh(new THREE.CapsuleGeometry(0.135, 0.08, 4, 16), bodyMat());
body.name = 'Torso';
body.position.set(0, BASE_BODY_Y, 0);
scene.add(body);

// --- Arms -----------------------------------------------------------------
function buildArm(side) {
  const sign = side === 'L' ? -1 : 1;
  const arm = new THREE.Group();
  arm.name = `Arm_${side}`;
  arm.position.set(0.138 * sign, 0.42, 0);

  const upper = new THREE.Mesh(new THREE.CapsuleGeometry(0.04, 0.1, 4, 16), skinMat());
  upper.name = `Arm_${side}_Upper`;
  upper.position.set(0, -0.07, 0);
  arm.add(upper);

  const hand = new THREE.Mesh(new THREE.SphereGeometry(0.08, 16, 16), skinMat());
  hand.name = `Arm_${side}_Hand`;
  hand.position.set(0, -0.16, 0);
  arm.add(hand);

  return arm;
}
scene.add(buildArm('L'));
scene.add(buildArm('R'));

// --- Legs -----------------------------------------------------------------
function buildLeg(side) {
  const sign = side === 'L' ? -1 : 1;
  const leg = new THREE.Group();
  leg.name = `Leg_${side}`;
  leg.position.set(0.065 * sign, 0.22, 0);

  const upper = new THREE.Mesh(new THREE.CapsuleGeometry(0.055, 0.14, 4, 16), bodyMat());
  upper.name = `Leg_${side}_Upper`;
  upper.position.set(0, -0.1, 0);
  leg.add(upper);

  return leg;
}
scene.add(buildLeg('L'));
scene.add(buildLeg('R'));

// --- Wearable anchor points ------------------------------------------------
// Small markers at every position offset Avatar.tsx actually uses when it
// equips a hat/glasses/earring/necklace/shoe - named to match. Not visible
// geometry, just reference points to line your own model's attachment
// points up against. World-space (i.e. already includes the head/body/leg
// parent offset above), matching what's in Avatar.tsx's JSX.
const anchorMat = new THREE.MeshBasicMaterial({ color: '#22d3ee', wireframe: true });
function addAnchor(name, pos) {
  const marker = new THREE.Mesh(new THREE.SphereGeometry(0.02, 6, 6), anchorMat);
  marker.name = name;
  marker.position.set(...pos);
  scene.add(marker);
}

addAnchor('Anchor_Hat', [0, BASE_HEAD_Y + 0.12, 0]);
addAnchor('Anchor_Glasses', [0, BASE_HEAD_Y + 0.06, 0.245]);
addAnchor('Anchor_Earring_L', [-0.27, BASE_HEAD_Y - 0.06, 0]);
addAnchor('Anchor_Earring_R', [0.27, BASE_HEAD_Y - 0.06, 0]);
addAnchor('Anchor_Mouth', [0, BASE_HEAD_Y - 0.045, 0.255]);
addAnchor('Anchor_Necklace', [0, BASE_BODY_Y + 0.09, 0.03]);
addAnchor('Anchor_Shoe_L', [-0.065, 0.22 - 0.19, 0.05]);
addAnchor('Anchor_Shoe_R', [0.065, 0.22 - 0.19, 0.05]);

// --- Export -----------------------------------------------------------
const exporter = new GLTFExporter();
const glb = await exporter.parseAsync(scene, { binary: true });
const outPath = path.join(outDir, 'player-model-reference.glb');
fs.writeFileSync(outPath, Buffer.from(glb));
console.log('Wrote', outPath, `(${(glb.byteLength / 1024).toFixed(1)} KB)`);

// Static audit for depth-conflict (z-fighting) risk in the procedural models.
//
// This is the CI-runnable half of the check. It cannot know where a mesh really
// ends up - that depends on group transforms computed at render time, which is
// what `src/utils/zFightAudit.ts` measures in the live scene - so it does not
// try to be authoritative. It catches the shape of the bug that actually
// occurred: two horizontal surfaces, declared side by side in one component
// with literal positions, landing within MIN_SURFACE_SEPARATION of each other
// while covering the same ground.
//
// That is exactly the island-terrain defect - a body cylinder topping out at
// y=0.30 with a second cylinder topping out at y=0.32 across the same radius -
// and it is cheap to detect without rendering anything.
//
// A pair is NOT reported when either surface opts out honestly:
//   - `polygonOffset` / DECAL_DEPTH_BIAS: it has declared itself a decal, which
//     is the sanctioned fix for coplanar-by-design geometry.
//   - `depthWrite={false}` / `depthTest={false}`: it is a sorted transparent
//     layer and cannot z-fight, the way the ocean's foam and wave rings work.
//
// Scope limits, stated plainly: only literal positions inside one component are
// compared, and intervening <group> transforms are not resolved. Anything
// placed at runtime, scaled by territory level, or split across components is
// the runtime audit's job.
//
// Run: npm run audit:zfighting

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const SRC = path.join(root, 'src');

// Kept in sync with src/constants/terrain.ts. Duplicated rather than imported
// because this script runs as plain node without the TS pipeline.
const MIN_SURFACE_SEPARATION = 0.05;

/** Minimum overlapping footprint before a pair is worth a human's attention. */
const MIN_OVERLAP_AREA = 0.05;

/**
 * How close is too close depends on the camera that sees the surface, because
 * depth resolution falls off with distance and with the near/far ratio:
 *
 *   resolution ~= z^2 * (far - near) / (near * far * 2^bits)
 *
 *   - Island scene (Scene.tsx): camera orbits 10-50 units out, near 0.5,
 *     far 2000 (the ocean plane forces that far). At 50 units that is ~3e-4 on
 *     a 24-bit buffer but ~0.08 on a 16-bit one, which plenty of mobile GPUs
 *     hand out. MIN_SURFACE_SEPARATION (0.05) is the rule for anything drawn
 *     out there.
 *   - Interiors and furniture (BuildingInteriorView, FurnitureItem): camera at
 *     ~12 units, near 0.3, far 200. Worst case ~0.007, so a 1cm detail is safe
 *     and flagging it would be noise. Only near-exact coplanarity matters.
 *
 * Judging every file by the island's threshold reported correctly-built
 * furniture (a 2cm-proud sink basin, a blanket over a mattress) as defects.
 */
const INTERIOR_SCALE_FILES = [
  'BuildingInteriorView.tsx',
  'FurnitureItem.tsx',
  'DressingRoomView.tsx',
  'FitnessView.tsx',
  'Avatar.tsx',
  'PetDog.tsx',
];
const INTERIOR_THRESHOLD = 0.008;

function thresholdFor(file) {
  const base = path.basename(file);
  return INTERIOR_SCALE_FILES.includes(base) ? INTERIOR_THRESHOLD : MIN_SURFACE_SEPARATION;
}

function sourceFiles(dir) {
  const out = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, entry.name);
    if (entry.isDirectory()) out.push(...sourceFiles(p));
    else if (/\.tsx?$/.test(entry.name)) out.push(p);
  }
  return out;
}

const rel = (f) => path.relative(root, f).replace(/\\/g, '/');

/** Numbers out of a `[ ... ]` prop body, or null if any entry is not a literal. */
function literalArray(text) {
  if (!text) return null;
  const out = [];
  for (const part of text.split(',')) {
    const n = part.trim();
    if (!/^-?\d+(\.\d+)?$/.test(n)) return null;
    out.push(parseFloat(n));
  }
  return out;
}

/**
 * Split a source file into top-level component bodies. Two meshes only share a
 * coordinate frame if they are declared in the same component, so pairing
 * across the whole file (FurnitureItem.tsx alone holds ~90 unrelated models)
 * produces nothing but noise.
 */
function components(lines) {
  const blocks = [];
  let current = null;
  lines.forEach((line, idx) => {
    const m = line.match(/^(?:export\s+)?(?:function|const)\s+([A-Z]\w*)/);
    if (m) {
      if (current) current.end = idx;
      current = { name: m[1], start: idx, end: lines.length };
      blocks.push(current);
    }
  });
  return blocks;
}

/**
 * Horizontal faces declared in a line range, as { y, halfX, halfZ }.
 *
 * A flat plane/circle/ring counts only when it is rotated onto the XZ plane; a
 * solid contributes its top and bottom faces.
 */
function horizontalFaces(lines, start, end) {
  const faces = [];

  // Group nesting, tracked as a path like "0/2". Two meshes are only comparable
  // when they sit in the SAME group: sibling <group>s usually carry their own
  // position, and mutually-exclusive ones (the avatar's straw hat vs its bucket
  // hat, each in its own conditional group) never exist at the same time.
  // Comparing across groups was the single largest source of false positives.
  const groupStack = [];
  const childCounter = [0];

  for (let idx = start; idx < end; idx++) {
    const line = lines[idx];

    // Maintain the path before reading any geometry on this line.
    const opens = (line.match(/<group\b/g) || []).length;
    const selfClosed = (line.match(/<group\b[^>]*\/>/g) || []).length;
    const closes = (line.match(/<\/group>/g) || []).length;
    for (let n = 0; n < opens - selfClosed; n++) {
      groupStack.push(childCounter[childCounter.length - 1]++);
      childCounter.push(0);
    }
    for (let n = 0; n < closes; n++) {
      groupStack.pop();
      childCounter.pop();
    }
    const groupPath = groupStack.join('/');
    const geoMatch = line.match(
      /<(planeGeometry|circleGeometry|ringGeometry|cylinderGeometry|boxGeometry)\s+args=\{\[([^\]]+)\]\}/
    );
    if (!geoMatch) continue;

    const [, geo, argText] = geoMatch;
    const args = literalArray(argText);
    if (!args) continue;

    // Walk back to the enclosing <mesh ...> tag, collecting its props.
    let pos = [0, 0, 0];
    let tag = '';
    for (let k = idx; k >= Math.max(start, idx - 12); k--) {
      tag = lines[k] + '\n' + tag;
      if (/<mesh\b/.test(lines[k])) break;
      if (k === Math.max(start, idx - 12)) tag = '';
    }
    if (!tag) continue;

    const posMatch = tag.match(/position=\{\[([^\]]+)\]\}/);
    if (posMatch) {
      const p = literalArray(posMatch[1]);
      if (!p || p.length < 3) continue; // computed position - runtime audit's job
      pos = p;
    }

    // THE MESH'S OWN `scale`, which this used to ignore - and ignoring it is not a
    // conservative simplification, it is a wrong answer in both directions.
    //
    // The idiom it got wrong is everywhere in the cosmetic and NPC models: a UNIT box
    // (`args={[1,1,1]}`) sized entirely by `scale={[0.0022, 0.017, 0.004]}`, because
    // that is how you author a thin strip without three magic numbers inside the
    // geometry. Read without the scale, a 2mm charm on an anklet is a 1x1x1 metre cube
    // whose faces sit at y = +/-0.5 - so two unrelated charms in the same group came back
    // as two full-metre slabs "0.000 apart, overlap 0.98" and got reported as a defect
    // in a model that has none. Three of the seven findings this audit produced were that
    // same false positive, which is the failure mode that teaches people to stop reading
    // audit output.
    //
    // The other direction is worse and silent: a mesh SHRUNK by `scale` has its faces
    // closer together than its args say, so a genuine conflict between two scaled
    // surfaces was under-reported and never flagged at all.
    let scale = [1, 1, 1];
    const scaleMatch = tag.match(/scale=\{\[([^\]]+)\]\}/);
    if (scaleMatch) {
      const s = literalArray(scaleMatch[1]);
      if (!s || s.length < 3) continue; // computed scale - runtime audit's job
      scale = s;
    } else {
      // `scale={0.4}` - the uniform form.
      const uniform = tag.match(/scale=\{(-?\d+(?:\.\d+)?)\}/);
      if (uniform) scale = [+uniform[1], +uniform[1], +uniform[1]];
      else if (/scale=\{/.test(tag)) continue; // computed - runtime audit's job
    }

    // The material sits just after the geometry.
    const after = lines.slice(idx, Math.min(lines.length, idx + 10)).join('\n');
    const exempt =
      /polygonOffset|DECAL_DEPTH_BIAS|RUG_DEPTH_BIAS/.test(after) ||
      /depthWrite=\{false\}/.test(after) ||
      /depthTest=\{false\}/.test(after) ||
      /<primitive[^>]*attach=["']material/.test(after);

    // `dir` is what makes this check usable at all. Two faces can only fight if
    // they face the SAME way: a countertop's underside resting exactly on a
    // cabinet's top is ordinary stacking, and back-face culling means you never
    // see both at once. Comparing opposing faces reported ~100 false positives
    // across the furniture models, every one of them a correctly built object.
    const at = (y, halfX, halfZ, dir) =>
      faces.push({ y, halfX, halfZ, dir, groupPath, line: idx + 1, geo, exempt });

    if (geo === 'cylinderGeometry') {
      const [rTop, rBot, h] = args;
      if ([rTop, rBot, h].some((v) => typeof v !== 'number')) continue;
      at(pos[1] + (h * scale[1]) / 2, rTop * scale[0], rTop * scale[2], 'up');
      at(pos[1] - (h * scale[1]) / 2, rBot * scale[0], rBot * scale[2], 'down');
    } else if (geo === 'boxGeometry') {
      const [w, h, d] = args;
      if ([w, h, d].some((v) => typeof v !== 'number')) continue;
      at(pos[1] + (h * scale[1]) / 2, (w * scale[0]) / 2, (d * scale[2]) / 2, 'up');
      at(pos[1] - (h * scale[1]) / 2, (w * scale[0]) / 2, (d * scale[2]) / 2, 'down');
    } else {
      // Flat geometry: only horizontal instances lie on another surface.
      const horizontal = /rotation(-x)?=\{?\[?\s*-?\s*Math\.PI\s*\/\s*2/.test(tag);
      if (!horizontal) continue;
      const rawX = geo === 'planeGeometry' ? args[0] / 2 : args[geo === 'ringGeometry' ? 1 : 0];
      const rawZ = geo === 'planeGeometry' ? args[1] / 2 : rawX;
      // A flat geometry turned onto the XZ plane has swapped its own Y and Z, so its
      // in-plane extents are scaled by the mesh's x and Y - not x and z.
      const halfX = rawX * scale[0];
      const halfZ = rawZ * scale[1];
      // `rotation={[-Math.PI/2, ...]}` turns a plane's +Z normal to +Y. The
      // `+Math.PI/2` case faces down; both are matched by the test above, so
      // read the sign back off the tag.
      const facesDown = /rotation(-x)?=\{?\[?\s*Math\.PI\s*\/\s*2/.test(tag);
      at(pos[1], halfX, halfZ, facesDown ? 'down' : 'up');
    }

    // Record XZ centre on every face just added for this mesh.
    for (let f = faces.length - 1; f >= 0 && faces[f].line === idx + 1; f--) {
      faces[f].cx = pos[0];
      faces[f].cz = pos[2];
    }
  }

  return faces;
}

const findings = [];

for (const file of sourceFiles(SRC)) {
  const lines = fs.readFileSync(file, 'utf8').split('\n');

  for (const block of components(lines)) {
    const faces = horizontalFaces(lines, block.start, block.end);

    for (let i = 0; i < faces.length; i++) {
      for (let j = i + 1; j < faces.length; j++) {
        const a = faces[i];
        const b = faces[j];
        if (a.line === b.line) continue; // a solid's own two faces
        if (a.dir !== b.dir) continue; // opposing faces cannot fight - see `at`
        // Only upward-facing pairs. A downward-facing surface in this art style
        // is the underside of something resting on another object, so it is
        // occluded by whatever it stands on: a toilet's seat and its cistern
        // both bottom out exactly on the pan, a pot's rim and its soil both
        // bottom out inside the pot. Every such pair reported here was benign.
        // Genuine ceiling-vs-ceiling conflicts are left to the runtime audit,
        // which works from real geometry instead of guessing from source.
        if (a.dir !== 'up') continue;
        if (a.groupPath !== b.groupPath) continue; // different frames - see `groupStack`
        if (a.exempt || b.exempt) continue;

        const sep = Math.abs(a.y - b.y);
        if (sep >= thresholdFor(file)) continue;

        // Overlapping footprint, or they simply sit next to each other.
        const ox = Math.min(a.cx + a.halfX, b.cx + b.halfX) - Math.max(a.cx - a.halfX, b.cx - b.halfX);
        const oz = Math.min(a.cz + a.halfZ, b.cz + b.halfZ) - Math.max(a.cz - a.halfZ, b.cz - b.halfZ);
        if (ox <= 0 || oz <= 0 || ox * oz < MIN_OVERLAP_AREA) continue;

        findings.push({
          file: rel(file),
          component: block.name,
          aLine: a.line,
          bLine: b.line,
          y: a.y,
          separation: sep,
          threshold: thresholdFor(file),
          area: ox * oz,
        });
      }
    }
  }
}

findings.sort((f, g) => f.separation - g.separation || g.area - f.area);

if (findings.length) {
  console.log(`\n[z-fight audit] ${findings.length} suspect surface pair(s):\n`);
  for (const f of findings) {
    console.log(
      `  ${f.file}:${f.aLine} + :${f.bLine}  (${f.component})  ` +
        `${f.separation.toFixed(3)} apart (limit ${f.threshold}) at y=${f.y.toFixed(3)}, overlap ${f.area.toFixed(2)}`
    );
  }
  console.log(
    '\n  Two opaque up-facing surfaces closer than this scene\'s limit that cover\n' +
      '  each other will z-fight. Fix structurally: merge them into one mesh, or\n' +
      '  delete the hidden one.\n' +
      '  If the pair is coplanar BY DESIGN (a decal lying on a floor), give the upper\n' +
      '  one {...DECAL_DEPTH_BIAS} from src/constants/terrain.ts.\n' +
      '  Do NOT nudge them apart by an arbitrary amount.'
  );
} else {
  console.log('[z-fight audit] clean - no near-coplanar overlapping surfaces in literal positions.');
}

console.log(
  '\nNote: this is the static half, limited to literal positions within one component.\n' +
    'For real world-space overlaps (group transforms, runtime placements), open the app\n' +
    'and run __auditZFighting() in the browser console.'
);

process.exit(findings.length ? 1 : 0);

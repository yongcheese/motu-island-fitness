/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Packs the whole game into a single downloadable .zip that another person -
 * or another AI - can open, understand and actually run without hitting bugs.
 *
 * Supersedes the older pack-for-ai.cjs / bundle-for-ai.cjs pair. What those
 * missed, and why this exists:
 *
 *   1. They packed whatever was on disk, including a tree with unresolved git
 *      merge-conflict markers in it - the resulting zip could not build at all.
 *      This script REFUSES to pack unless the tree typechecks and builds.
 *   2. They stripped every binary by extension, which silently dropped
 *      blender-reference/player-model-reference.glb (a real source asset).
 *   3. They packed firebase-applet-config.json verbatim, leaking the project's
 *      real Firebase credentials into a file meant to be handed out.
 *
 * Usage:
 *   node scripts/pack-game.mjs                 # verify, then pack
 *   node scripts/pack-game.mjs --skip-build    # skip vite build (still typechecks)
 *   node scripts/pack-game.mjs --keep-secrets  # pack the real Firebase config
 */

import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const OUT_DIR = path.join(ROOT, 'package-out');
const BUNDLE_NAME = 'island-fitness-ai';

const argv = new Set(process.argv.slice(2));
const SKIP_BUILD = argv.has('--skip-build');
const KEEP_SECRETS = argv.has('--keep-secrets');

/** Directories never worth shipping: installed deps, VCS, build scratch, prior outputs. */
const EXCLUDE_DIRS = new Set([
  'node_modules', '.git', 'dist', 'package-out', 'temp_ai_pack', '.vscode', '.idea',
]);

/**
 * Files excluded by exact name. `.env` variants hold real API keys; the
 * project-source.zip / project-full-source.md / pack-for-ai.cjs family are
 * stale artifacts of the superseded scripts and would just confuse a reader
 * about which entry point is current.
 */
const EXCLUDE_FILES = new Set([
  'project-source.zip', 'project-full-source.md', 'pack-for-ai.cjs',
  'pack-for-ai.js', 'bundle-for-ai.cjs', 'README_AI.md', '.env', '.env.local',
  '.DS_Store',
]);

/** Extensions that are real source assets and must survive packing (see reason #2 above). */
const BINARY_KEEP_EXTS = new Set(['.glb', '.gltf', '.png', '.jpg', '.jpeg', '.ico', '.woff', '.woff2', '.ttf', '.mp3', '.wav', '.ogg']);

/** Extensions that are text and therefore safe to inline into FULL_SOURCE.md. */
const TEXT_EXTS = new Set(['.ts', '.tsx', '.js', '.jsx', '.mjs', '.cjs', '.css', '.html', '.json', '.md', '.rules', '.example', '.txt', '.yml', '.yaml']);

/**
 * Hand-written notes on the files a newcomer needs oriented first. Anything not
 * listed still gets packed and inventoried, just without a description - this
 * is a reading order, not a manifest of everything.
 */
const FILE_ROLES = {
  'index.html': 'Vite HTML entry. Mounts #root and loads src/main.tsx.',
  'server.ts': 'Express host. In dev it wraps Vite as middleware on port 3000; in prod it serves dist/. Also owns POST /api/shop/chat, the Gemini-backed shop assistant.',
  'vite.config.ts': 'Vite config. Note the usePolling watcher (the repo lives on OneDrive, where native FS events are unreliable) and the manual vendor chunk split.',
  'src/main.tsx': 'React root. Wraps <App/> in an ErrorBoundary that renders the error + component stack on screen instead of a blank page.',
  'src/App.tsx': 'Top-level view router and persistent HUD chrome. Chooses between Scene and the full-screen views (Shop, Fitness, Tracker, Dressing Room, Building Interior).',
  'src/types.ts': 'Shared domain types: UserProfile, ShopItem, PlacedItem, WorkoutLog, View enum, ItemCategory.',
  'src/index.css': 'Tailwind entry AND the authoritative GLOBAL Z-INDEX LAYER SYSTEM. Read the comment block at the top before positioning anything.',
  'src/context/AppContext.tsx': 'Global state: profile, inventory, equipped items, current view, UI flags. Backed by Firestore or localStorage depending on auth mode.',
  'src/lib/firebase.ts': 'Firebase wrapper AND a full localStorage-backed Firestore shim. When the config is a placeholder or anonymous auth fails, the app transparently runs in Local Guest Mode - this is why it boots with no credentials.',
  'src/lib/playerBus.ts': 'Non-React per-frame state bus between the 3D layer and HUD overlays, plus clampFrameDelta() - the tab-resume delta guard that stops the camera spinning after a tab switch.',
  'src/lib/soundUtils.ts': 'All audio. Every effect is synthesized live with the Web Audio API (no sound files at all), including the layered swim ambience.',
  'src/constants/world.ts': 'Single source of truth for ocean surface / swim body world-Y. Ocean, Avatar, Weather and Fish must all read these, never re-literal them.',
  'src/components/Three/Scene.tsx': 'The R3F Canvas and scene graph root: lighting, island, ocean, sky, weather, and every 3D actor.',
  'src/components/Three/Avatar.tsx': 'Player character: procedural mesh plus the movement/animation state machine (walk, run, several swim poses, hammock, emotes).',
  'src/components/Three/CameraController.tsx': 'Camera. First/third-person blending, collision, and the free-fly build-mode rig.',
  'src/components/Three/characterMovement.ts': 'Input-to-motion math shared by the avatar: acceleration, terrain and water height sampling, collision.',
  'src/components/Three/Fish.tsx': 'Instanced fish schools circling the island shallows.',
  'src/components/Three/Ocean.tsx': 'Ocean surface: custom GLSL wave displacement, shoreline foam, depth tinting.',
  'src/components/UI/MiniMap.tsx': 'Canvas-drawn minimap. Reads live position from playerBus (or the build-mode camera when that is active).',
  'src/components/UI/HudFrame.tsx': 'Layout primitive that assigns HUD elements to the shared safe-area regions.',
  'firestore.rules': 'Deployed Firestore security rules. DRAFT_firestore.rules is a work-in-progress variant, not what is live.',
  'metadata.json': 'AI Studio applet manifest: display name, requested camera permission, server-side Gemini capability flag.',
  'firebase-applet-config.json': 'Firebase client config. Sanitized to placeholders in this bundle so the app boots straight into Local Guest Mode.',
};

const log = (msg) => console.log(msg);
const fail = (msg) => { console.error(`\n[FAIL] ${msg}\n`); process.exit(1); };

/** Walks the project, honouring the exclude sets. Returns repo-relative POSIX paths. */
function collectFiles(dir = ROOT, acc = []) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (entry.isDirectory()) {
      if (EXCLUDE_DIRS.has(entry.name)) continue;
      collectFiles(path.join(dir, entry.name), acc);
    } else if (entry.isFile()) {
      if (EXCLUDE_FILES.has(entry.name)) continue;
      const rel = path.relative(ROOT, path.join(dir, entry.name)).split(path.sep).join('/');
      acc.push(rel);
    }
  }
  return acc;
}

function isTextFile(rel) {
  const ext = path.extname(rel).toLowerCase();
  if (TEXT_EXTS.has(ext)) return true;
  // Extensionless dotfiles like .gitignore are text too.
  return ext === '' && path.basename(rel).startsWith('.');
}

/**
 * Guard #1 - the bug that made the previous bundles unusable. An unresolved
 * merge leaves `<<<<<<<` / `=======` / `>>>>>>>` at column 0; esbuild dies on
 * them, so a zip containing them can never run.
 */
function assertNoConflictMarkers(files) {
  const marker = /^(<{7}|={7}|>{7})( |\r?$)/m;
  const dirty = [];
  for (const rel of files) {
    if (!isTextFile(rel)) continue;
    const body = fs.readFileSync(path.join(ROOT, rel), 'utf8');
    if (marker.test(body)) dirty.push(rel);
  }
  if (dirty.length) {
    fail(`Unresolved git merge-conflict markers found in:\n  - ${dirty.join('\n  - ')}\n`
      + `A bundle containing these cannot build. Resolve the merge first.`);
  }
  log('  [ok] no merge-conflict markers');
}

/** Runs an npm script through the local toolchain, streaming output on failure only. */
function runNpm(script, label) {
  const npmCli = path.join(path.dirname(process.execPath), 'node_modules/npm/bin/npm-cli.js');
  const args = fs.existsSync(npmCli) ? [npmCli, 'run', script] : null;
  try {
    if (args) execFileSync(process.execPath, args, { cwd: ROOT, stdio: 'pipe' });
    else execFileSync('npm', ['run', script], { cwd: ROOT, stdio: 'pipe', shell: true });
    log(`  [ok] ${label}`);
  } catch (err) {
    const out = `${err.stdout ?? ''}${err.stderr ?? ''}`.trim();
    fail(`${label} failed:\n${out}`);
  }
}

function rmrf(p) { fs.rmSync(p, { recursive: true, force: true }); }

function copyInto(rel, stageRoot) {
  const dest = path.join(stageRoot, rel);
  fs.mkdirSync(path.dirname(dest), { recursive: true });
  fs.copyFileSync(path.join(ROOT, rel), dest);
}

/** Renders an indented directory tree from the packed file list. */
function renderTree(files) {
  const root = {};
  for (const rel of files) {
    let node = root;
    for (const part of rel.split('/')) node = (node[part] ??= {});
  }
  const lines = [];
  const walk = (node, prefix) => {
    const keys = Object.keys(node).sort((a, b) => {
      const aDir = Object.keys(node[a]).length > 0;
      const bDir = Object.keys(node[b]).length > 0;
      if (aDir !== bDir) return aDir ? -1 : 1;
      return a.localeCompare(b);
    });
    keys.forEach((key, i) => {
      const last = i === keys.length - 1;
      const isDir = Object.keys(node[key]).length > 0;
      lines.push(`${prefix}${last ? '└── ' : '├── '}${key}${isDir ? '/' : ''}`);
      if (isDir) walk(node[key], prefix + (last ? '    ' : '│   '));
    });
  };
  walk(root, '');
  return lines.join('\n');
}

function detectStack() {
  const pkg = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8'));
  const deps = { ...pkg.dependencies, ...pkg.devDependencies };
  const pick = (name, label) => (deps[name] ? `${label} ${deps[name].replace(/^[\^~]/, '')}` : null);
  return [
    pick('react', 'React'), pick('typescript', 'TypeScript'), pick('vite', 'Vite'),
    pick('three', 'Three.js'), pick('@react-three/fiber', 'react-three-fiber'),
    pick('@react-three/drei', 'drei'), pick('tailwindcss', 'Tailwind CSS'),
    pick('firebase', 'Firebase'), pick('express', 'Express'),
    pick('@google/genai', '@google/genai'), pick('@mediapipe/tasks-vision', 'MediaPipe Tasks Vision'),
    pick('motion', 'Motion'), pick('recharts', 'Recharts'),
  ].filter(Boolean);
}

// ---------------------------------------------------------------------------

log(`\nPacking ${BUNDLE_NAME}\n`);
log('Verifying the tree is shippable...');

const files = collectFiles();
assertNoConflictMarkers(files);
runNpm('lint', 'typecheck (tsc --noEmit)');
if (SKIP_BUILD) log('  [skip] vite build (--skip-build)');
else runNpm('build', 'production build (vite build)');

log('\nStaging files...');
const stageParent = fs.mkdtempSync(path.join(os.tmpdir(), 'pack-game-'));
const stage = path.join(stageParent, BUNDLE_NAME);
fs.mkdirSync(stage, { recursive: true });

let binaryCount = 0;
for (const rel of files) {
  copyInto(rel, stage);
  if (BINARY_KEEP_EXTS.has(path.extname(rel).toLowerCase())) binaryCount++;
}
log(`  [ok] ${files.length} files (${binaryCount} binary asset${binaryCount === 1 ? '' : 's'} preserved)`);

// Sanitize the Firebase config so the bundle boots into Local Guest Mode and
// carries none of this project's real credentials. firebase.ts recognises these
// exact placeholder values and skips its connection probe entirely.
if (!KEEP_SECRETS) {
  const placeholder = {
    projectId: 'remixed-project-id',
    appId: 'remixed-app-id',
    apiKey: 'remixed-api-key',
    authDomain: 'remixed-project-id.firebaseapp.com',
    firestoreDatabaseId: '(default)',
    storageBucket: 'remixed-project-id.firebasestorage.app',
    messagingSenderId: '000000000000',
    measurementId: '',
  };
  fs.writeFileSync(
    path.join(stage, 'firebase-applet-config.json'),
    `${JSON.stringify(placeholder, null, 2)}\n`,
    'utf8',
  );
  log('  [ok] firebase-applet-config.json replaced with placeholders');
} else {
  log('  [WARN] --keep-secrets: real Firebase credentials are in this bundle');
}

// Ship the compiled output too, so the game can be viewed with a static server
// and no build step. Named prebuilt-dist/ so it never shadows a fresh `dist/`.
if (!SKIP_BUILD && fs.existsSync(path.join(ROOT, 'dist'))) {
  fs.cpSync(path.join(ROOT, 'dist'), path.join(stage, 'prebuilt-dist'), { recursive: true });
  log('  [ok] prebuilt-dist/ included');
}

log('\nGenerating AI-readable docs...');
const stack = detectStack();
const tree = renderTree(files);

const manifest = {
  name: 'Motu',
  description: JSON.parse(fs.readFileSync(path.join(ROOT, 'metadata.json'), 'utf8')).description,
  generatedAt: new Date().toISOString(),
  entryPoints: {
    html: 'index.html',
    client: 'src/main.tsx',
    clientRoot: 'src/App.tsx',
    server: 'server.ts',
    scene3d: 'src/components/Three/Scene.tsx',
  },
  runCommands: {
    install: 'npm install',
    dev: 'npm run dev',
    devUrl: 'http://localhost:3000',
    typecheck: 'npm run lint',
    build: 'npm run build',
    servePrebuilt: 'npx serve prebuilt-dist',
  },
  techStack: stack,
  requiresCredentialsToRun: false,
  authMode: 'Falls back to Local Guest Mode (localStorage) when Firebase is unconfigured.',
  optionalCredentials: {
    GEMINI_API_KEY: 'Enables POST /api/shop/chat (the AI shop assistant). Without it that one endpoint returns 500; everything else works.',
    'firebase-applet-config.json': 'Replace placeholders to persist to a real Firestore instead of localStorage.',
  },
  files: files.map((rel) => {
    const abs = path.join(ROOT, rel);
    const stat = fs.statSync(abs);
    const entry = { path: rel, bytes: stat.size };
    if (isTextFile(rel)) {
      entry.lines = fs.readFileSync(abs, 'utf8').split('\n').length;
    } else {
      entry.binary = true;
    }
    if (FILE_ROLES[rel]) entry.role = FILE_ROLES[rel];
    return entry;
  }),
};
fs.writeFileSync(path.join(stage, 'PROJECT_MANIFEST.json'), `${JSON.stringify(manifest, null, 2)}\n`, 'utf8');
log('  [ok] PROJECT_MANIFEST.json');

const readingOrder = Object.entries(FILE_ROLES)
  .filter(([rel]) => files.includes(rel))
  .map(([rel, role]) => `| \`${rel}\` | ${role} |`)
  .join('\n');

const aiDoc = `# AI_START_HERE — Motu

Read this file first. It is written for an AI or developer who has never seen
this project, and it covers everything needed to run the game and change it
without breaking it.

${manifest.description}

## 1. Run it

Requires Node.js 20+ (developed on 24.x). Nothing else — no database, no API
key, no account.

\`\`\`bash
npm install
npm run dev          # http://localhost:3000
\`\`\`

\`npm run dev\` starts \`server.ts\`, an Express host that mounts Vite as
middleware, so the API route and the client are served from the same origin and
port. Running bare \`vite\` also works for pure front-end changes, but then
\`POST /api/shop/chat\` 404s.

To view the shipped build with no build step:

\`\`\`bash
npx serve prebuilt-dist
\`\`\`

Do **not** open \`index.html\` or \`prebuilt-dist/index.html\` from the
filesystem. It is an ES-module app; \`file://\` origins block module loading and
you get a blank page. Always go through a server.

## 2. It boots with no credentials — that is intentional, not a bug

\`firebase-applet-config.json\` in this bundle holds placeholder values. On
detecting them, \`src/lib/firebase.ts\` skips its connection probe and the app
runs in **Local Guest Mode**: a hand-written localStorage shim implements the
Firestore surface the app uses (\`doc\`, \`getDoc\`, \`setDoc\`, \`updateDoc\`,
\`onSnapshot\`, \`increment\`, \`arrayUnion\`, \`arrayRemove\`). Progress persists in
the browser instead of the cloud.

So expect these on a clean run, and do not "fix" them:

- Console: \`Firebase is not configured. The app will run in Local Guest Mode using localStorage.\`
- Google sign-in fails — use the guest option on the auth screen.
- \`POST /api/shop/chat\` returns 500 unless \`GEMINI_API_KEY\` is set (copy
  \`.env.example\` to \`.env\`). Only the shop chat assistant depends on it.
- One \`https://cdn.pixabay.com/...mp3\` request at first click. It is a
  throwaway used to unlock the browser audio context; offline it fails
  silently and is caught.

To point at a real backend, fill in \`firebase-applet-config.json\` with your own
Firebase web config and deploy \`firestore.rules\`.

## 3. Tech stack

${stack.map((s) => `- ${s}`).join('\n')}

## 4. Where things live

| File | What it does |
| --- | --- |
${readingOrder}

## 5. Invariants worth knowing before editing

These are the project's real footguns — each one has already caused a bug.

1. **Z-index is a global system, not per-component.** \`src/index.css\` opens with
   a \`GLOBAL Z-INDEX LAYER SYSTEM\` block defining Background / Game View / HUD /
   Floating Panel / Toast / Modal / Loading. Use those classes. Raising a whole
   Game View above HUD is exactly what once made the minimap invisible indoors;
   components needing to beat HUD portal to \`document.body\` instead.
2. **World heights come from \`src/constants/world.ts\`.** \`WATER_SURFACE_Y\` and
   \`SWIM_BODY_Y\` were once duplicated literals across Ocean / Avatar / Weather /
   Fish, drifted apart, and left the swim splash FX rendering below the water.
   Never re-hardcode \`-0.5\`.
3. **Per-frame cross-component state goes through \`playerBus\`, not React state
   and not \`window\`.** Player position, rotation, camera yaw, dog state and the
   interaction prompt update every frame; routing them through React would
   re-render the tree 60×/s.
4. **Always clamp \`useFrame\` deltas with \`clampFrameDelta()\`.** A hidden tab
   throttles rAF, so the first frame back can report a multi-second delta. Feeding
   that raw into a rotation rate spun the camera several full turns — that is the
   bug the helper exists to prevent.
5. **Audio is fully synthesized.** There are no audio files. \`soundUtils.ts\`
   builds every effect from Web Audio primitives (noise buffers, oscillators,
   filters). Add sounds the same way, and keep failures silent — audio is
   blocked until the first user gesture.
6. **The file watcher polls on purpose.** This project lives in a OneDrive
   folder where native FS events are unreliable, so \`vite.config.ts\` sets
   \`server.watch.usePolling\`. Removing it causes stale modules that survive a
   hard refresh.

## 6. Verifying a change

\`\`\`bash
npm run lint     # tsc --noEmit — must be clean
npm run build    # vite build — must succeed
\`\`\`

There is no test suite; these two commands are the gate. \`npm run lint\` also
catches stray git merge-conflict markers (TS1185), which is how a previously
shipped bundle turned out to be unbuildable.

## 7. Also in this bundle

- \`PROJECT_MANIFEST.json\` — machine-readable inventory: every packed file with
  size, line count and, for key files, its role.
- \`FULL_SOURCE.md\` — every text source file concatenated into one document, for
  pasting into a model with a large context window.
- \`prebuilt-dist/\` — the compiled app, ready for any static server.
- \`README.md\` — the original human-facing setup guide.
- \`security_spec.md\`, \`firestore.rules\` — data model and access rules.

## 8. Full tree

\`\`\`text
${BUNDLE_NAME}/
${tree.split('\n').map((l) => (l ? `  ${l}` : l)).join('\n')}
\`\`\`
`;
fs.writeFileSync(path.join(stage, 'AI_START_HERE.md'), aiDoc, 'utf8');
log('  [ok] AI_START_HERE.md');

/**
 * Kept in the bundle (npm ci needs it) but never inlined into FULL_SOURCE.md:
 * a quarter-megabyte of resolved dependency hashes is pure noise in a document
 * whose entire purpose is to be read into a model's context window.
 */
const NO_INLINE = new Set(['package-lock.json']);

let full = `# Motu — full source\n\n`
  + `Generated ${manifest.generatedAt} by scripts/pack-game.mjs.\n`
  + `Every text source file in the project, concatenated. Binary assets are listed but not inlined,\n`
  + `and ${[...NO_INLINE].map((f) => `\`${f}\``).join(', ')} is omitted as noise (it is still in the .zip).\n`
  + `Start with AI_START_HERE.md for orientation.\n`;
const textFiles = files.filter((f) => isTextFile(f) && !NO_INLINE.has(f));
for (const rel of textFiles) {
  const body = fs.readFileSync(path.join(ROOT, rel), 'utf8');
  const lang = path.extname(rel).replace('.', '') || 'text';
  full += `\n\n---\n\n## ${rel}\n\n\`\`\`${lang}\n${body.replace(/\r\n/g, '\n').replace(/```/g, '\\`\\`\\`')}\n\`\`\`\n`;
}
const binaries = files.filter((f) => !isTextFile(f));
if (binaries.length) {
  full += `\n\n---\n\n## Binary assets (not inlined)\n\n`
    + binaries.map((b) => `- \`${b}\` (${fs.statSync(path.join(ROOT, b)).size} bytes)`).join('\n')
    + '\n';
}
fs.writeFileSync(path.join(stage, 'FULL_SOURCE.md'), full, 'utf8');
log(`  [ok] FULL_SOURCE.md (${textFiles.length} files inlined)`);

log('\nCompressing...');
fs.mkdirSync(OUT_DIR, { recursive: true });
// Local time, not toISOString() - the stamp is read by a human looking for the
// file they just produced, and a UTC name is off by the timezone offset.
const now = new Date();
const pad = (n) => String(n).padStart(2, '0');
const stamp = `${now.getFullYear()}${pad(now.getMonth() + 1)}${pad(now.getDate())}`
  + `-${pad(now.getHours())}${pad(now.getMinutes())}`;
const zipPath = path.join(OUT_DIR, `${BUNDLE_NAME}-${stamp}.zip`);
rmrf(zipPath);

try {
  if (process.platform === 'win32') {
    execFileSync('powershell', [
      '-NoProfile', '-NonInteractive', '-Command',
      `Compress-Archive -Path '${stage.replace(/'/g, "''")}' -DestinationPath '${zipPath.replace(/'/g, "''")}' -Force`,
    ], { stdio: 'pipe' });
  } else {
    execFileSync('zip', ['-qr', zipPath, BUNDLE_NAME], { cwd: stageParent, stdio: 'pipe' });
  }
} catch (err) {
  fail(`Compression failed: ${`${err.stdout ?? ''}${err.stderr ?? ''}`.trim() || err.message}`);
}

// Also drop the generated docs beside the zip, unzipped. Uploading a .zip to a
// chat assistant does not work - nothing extracts it - so the file you actually
// hand to a model has to be reachable without unpacking anything first.
const LOOSE_DOCS = ['FULL_SOURCE.md', 'AI_START_HERE.md', 'PROJECT_MANIFEST.json'];
for (const doc of LOOSE_DOCS) fs.copyFileSync(path.join(stage, doc), path.join(OUT_DIR, doc));

rmrf(stageParent);

const mb = (p) => (fs.statSync(p).size / 1024 / 1024).toFixed(2);
const rel = (p) => path.relative(ROOT, p).split(path.sep).join('/');
log(`\nDone.`);
log(`  ${rel(zipPath)} (${mb(zipPath)} MB)  <- the whole runnable project`);
for (const doc of LOOSE_DOCS) {
  const p = path.join(OUT_DIR, doc);
  log(`  ${rel(p)} (${mb(p)} MB)`);
}
// ~3.6 chars/token is a reasonable estimate for source code.
const tokens = Math.round(fs.statSync(path.join(OUT_DIR, 'FULL_SOURCE.md')).size / 3.6 / 1000);
log(`\nFULL_SOURCE.md is roughly ${tokens}k tokens - feed that one to a model, not the .zip.\n`);

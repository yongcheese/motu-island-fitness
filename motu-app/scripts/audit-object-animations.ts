/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * DOES EVERY INTERACTIVE OBJECT ACTUALLY REACT, AND DOES EVERY DECLARED PART EXIST?
 *
 * The guard on the Object Interaction Animation System, and it exists because that system has
 * exactly one failure mode worth automating against: **a part name that does not match anything**.
 *
 * `constants/objectAnimations.ts` says 「the wardrobe's `doorLeft` swings 76 degrees」 and
 * `Three/FurnitureItem.tsx` says `ref={anim.ref('doorLeft')}`. Those two strings are the join, and
 * nothing type-checks them against each other — a typo on either side produces no error, no
 * warning and no crash. It produces a wardrobe whose doors do not open, which looks exactly like
 * the bug this whole system was built to fix. So the join is checked here, in both directions.
 *
 * Four parts:
 *
 *   1  every interactive item either has an object reaction or is a listed exception
 *   2  every part a row declares is `ref`'d by the model that row belongs to
 *   3  every part a model `ref`s is declared by its row
 *   4  the numbers are within sane bounds, and the behaviour matches the interaction's family
 *
 * Run: npm run audit:object-animations
 */

import fs from 'node:fs';
import path from 'node:path';
import { ALL_ITEMS } from '../src/constants/items';
import {
  OBJECT_ANIMATIONS,
  ObjectAnimationSpec,
  ObjectPartSpec,
} from '../src/constants/objectAnimations';
import {
  getPrimaryInteraction,
  interactionOccupies,
  interactionPosture,
} from '../src/constants/furnitureInteractions';
import { getPosture } from '../src/constants/interactionPostures';
import { SUSPENDED_MOTIONS } from '../src/constants/outdoorAnimation';
import { resolveLaunchHeading } from '../src/lib/objectAnimation';

const FURNITURE_ITEM = path.join(process.cwd(), 'src/components/Three/FurnitureItem.tsx');

let checks = 0;
let failures = 0;

function ok(label: string, detail = ''): void {
  checks++;
  console.log(`  ok    ${label}${detail ? `   ${detail}` : ''}`);
}
function fail(label: string, detail: string): void {
  checks++;
  failures++;
  console.log(`  FAIL  ${label}\n        ${detail}`);
}
function check(condition: boolean, label: string, detail: string): void {
  if (condition) ok(label);
  else fail(label, detail);
}

/* ------------------------------------------------------- reading the model file as text */

const source = fs.readFileSync(FURNITURE_ITEM, 'utf8');

/**
 * model id -> component name, read out of the `FURNITURE_MODELS` table.
 *
 * Parsed from the source rather than imported, because what this audit needs is the TEXT of each
 * component (to see which `anim.ref` names it uses), and a module import gives a function whose
 * body is not reliably introspectable after a bundler has been near it.
 */
function readModelTable(): Map<string, string> {
  const table = new Map<string, string>();
  const start = source.indexOf('const FURNITURE_MODELS');
  if (start < 0) throw new Error('FURNITURE_MODELS table not found in FurnitureItem.tsx');
  const end = source.indexOf('\n};', start);
  const body = source.slice(start, end);
  for (const m of body.matchAll(/'([a-z0-9-]+)':\s*(\w+),/g)) table.set(m[1], m[2]);
  return table;
}

/** The source text of one top-level `function Name(...) { … }`, to its closing brace at column 0. */
function componentSource(name: string): string | null {
  const start = source.indexOf(`function ${name}(`);
  if (start < 0) return null;
  const end = source.indexOf('\n}', start);
  return end < 0 ? source.slice(start) : source.slice(start, end + 2);
}

/** Every `anim.ref('x')` name inside one component. */
function refNames(body: string): Set<string> {
  const names = new Set<string>();
  for (const m of body.matchAll(/anim\.ref\('([^']+)'/g)) names.add(m[1]);
  return names;
}

const MODEL_TABLE = readModelTable();

/* ------------------------------------------------------- part 1: coverage */

/**
 * Interactive pieces that deliberately have NO object-side reaction, and why.
 *
 * Being on this list is a decision. Being on neither this list nor the table is an oversight, and
 * that is the whole point of separating them: 「we thought about the telescope」 and 「we forgot
 * the telescope」 look identical in a codebase and completely different here.
 */
const NO_REACTION_BY_DESIGN: Record<string, string> = {
  hammock: 'sways under its rider — SUSPENDED_MOTIONS.hammock, a richer mechanism than a part',
  swing: 'sways under its rider — SUSPENDED_MOTIONS.swing',
  'hanging-chair': 'sways under its rider — SUSPENDED_MOTIONS.hangingChair',
  'rocking-chair': 'rocks under its rider — SUSPENDED_MOTIONS.rockingChair',
  // 營火、望遠鏡、鳥屋、許願井 used to be listed here, each 「from its own rig」. They are rows in
  // OBJECT_ANIMATIONS now, so this audit checks their parts like everyone else's — and a fifth
  // piece that grows its own trigger loop has to be argued onto this list rather than slip past.
};

console.log('\n=== part 1: every interactive piece reacts, or says why not ===\n');

const interactiveItems = ALL_ITEMS.filter((i) => (i.interactions?.length ?? 0) > 0);
const missing: string[] = [];
let reacting = 0;
let byOtherMeans = 0;

for (const item of interactiveItems) {
  const model = item.model;
  if (!model) {
    missing.push(`${item.name} (${item.id}) has an interaction but no model`);
    continue;
  }
  if (OBJECT_ANIMATIONS[model as keyof typeof OBJECT_ANIMATIONS]) { reacting++; continue; }
  if (NO_REACTION_BY_DESIGN[model]) { byOtherMeans++; continue; }
  missing.push(`${item.name} (${item.id}, model '${model}')`);
}

check(
  missing.length === 0,
  `all ${interactiveItems.length} interactive items have an object reaction`,
  `no reaction and no stated exception for:\n        ${missing.join('\n        ')}`,
);
console.log(`        ${reacting} driven by OBJECT_ANIMATIONS, ${byOtherMeans} by a stated exception (see NO_REACTION_BY_DESIGN)`);

// The exception list must not rot: a model listed there has to still exist and still be
// interactive, or the list is a record of something that used to be true.
const interactiveModels = new Set<string>();
for (const i of interactiveItems) if (i.model) interactiveModels.add(i.model);
const staleExceptions = Object.keys(NO_REACTION_BY_DESIGN).filter((m) => !interactiveModels.has(m));
check(
  staleExceptions.length === 0,
  'no stale entries in the deliberate-exception list',
  `these models are listed as exceptions but are not interactive: ${staleExceptions.join(', ')}`,
);

/* ------------------------------------------------------- part 2 & 3: the name join */

console.log('\n=== part 2: every declared part is wired to a group in its model ===\n');

const entries = Object.entries(OBJECT_ANIMATIONS) as [string, ObjectAnimationSpec][];
const componentFor = new Map<string, string>();

for (const [modelId] of entries) {
  const component = MODEL_TABLE.get(modelId);
  if (!component) {
    fail(`${modelId} · model id resolves to a component`, 'not present in FURNITURE_MODELS');
    continue;
  }
  componentFor.set(modelId, component);
}

for (const [modelId, spec] of entries) {
  const component = componentFor.get(modelId);
  if (!component) continue;
  const body = componentSource(component);
  if (!body) {
    fail(`${modelId} · ${component} source found`, 'component not found in FurnitureItem.tsx');
    continue;
  }

  const wired = refNames(body);
  const parts = Object.keys(spec.parts ?? {});
  /*
   * A LAUNCH GROUP is a declared part too — it just answers a different question.
   *
   * `parts` says how far a thing moves; `launch.part` says which way it faces before it starts.
   * Both are the same untyped string join between a table and a JSX call site, which is the join
   * this whole audit exists for: a typo in either produces a frisbee that flies perfectly, in
   * the one direction the model was drawn in, which is exactly the bug the launch system was
   * added to fix and is indistinguishable from it.
   */
  const declared = spec.launch ? [...parts, spec.launch.part] : parts;

  const unwired = declared.filter((p) => !wired.has(p));
  if (unwired.length > 0) {
    fail(
      `${modelId} · declared parts are wired`,
      `${component} never calls anim.ref for: ${unwired.join(', ')} — these do nothing`,
    );
  }

  const undeclared = [...wired].filter((p) => !declared.includes(p));
  if (undeclared.length > 0) {
    fail(
      `${modelId} · wired parts are declared`,
      `${component} refs ${undeclared.join(', ')}, which OBJECT_ANIMATIONS does not drive`,
    );
  }

  // The launch group carries ONLY the heading. A group that both yaws and slides turns the part
  // on the spot and leaves it travelling along the old heading — see ObjectLaunchSpec.part.
  if (spec.launch && parts.includes(spec.launch.part)) {
    fail(
      `${modelId} · the launch group only aims`,
      `\`${spec.launch.part}\` is also a row in \`parts\` — a node's position is expressed in its `
      + 'PARENT\'s frame, so yawing the group that slides moves it along the old heading',
    );
  }

  if (unwired.length === 0 && undeclared.length === 0) {
    ok(`${modelId} · ${declared.length} part(s) joined`, declared.join(', ') || '(effects only)');
  }

  // A model that calls the hook must anchor it, or it registers an entry the cull can never see
  // and silently never animates — the quietest possible way for all of this to do nothing.
  const anchored = body.includes('anim.root') || /useObjectAnimation\([^)]*,\s*\w+Ref\)/.test(body);
  check(
    anchored,
    `${modelId} · ${component} anchors its animation`,
    'calls useObjectAnimation but never attaches anim.root nor passes an anchor ref',
  );
}

/* ------------------------------------------------------- part 4: the numbers */

console.log('\n=== part 3: the rows are within sane bounds ===\n');

/** Nothing in a low-poly cottage game should swing further than this. */
const MAX_HINGE = Math.PI * 1.2;
/** A slide is a drawer or a throw, not a teleport. */
const MAX_SLIDE = 4;

function auditPart(modelId: string, name: string, part: ObjectPartSpec): void {
  const where = `${modelId}.${name}`;
  if (part.motion === 'hinge' && Math.abs(part.travel) > MAX_HINGE && part.signal !== 'spin') {
    fail(`${where} · hinge travel is a sane angle`, `${part.travel.toFixed(2)} rad exceeds ${MAX_HINGE.toFixed(2)}`);
    return;
  }
  if (part.motion === 'slide' && Math.abs(part.travel) > MAX_SLIDE) {
    fail(`${where} · slide travel is a sane distance`, `${part.travel} model units exceeds ${MAX_SLIDE}`);
    return;
  }
  if (part.motion === 'scale' && part.travel <= -1) {
    fail(`${where} · scale never inverts`, `travel ${part.travel} would flip or flatten the part`);
    return;
  }
  if ((part.signal === 'spin' || part.signal === 'wobble') && !(part.period! > 0)) {
    fail(`${where} · ${part.signal} states a period`, 'period is required and must be positive');
    return;
  }
  if (part.range) {
    const [from, to] = part.range;
    if (!(from >= 0 && to <= 1 && from < to)) {
      fail(`${where} · range is an ordered slice of 0..1`, `got [${from}, ${to}]`);
      return;
    }
  }
  if (part.signal === 'pulse' && part.over != null && !(part.over > 0)) {
    fail(`${where} · pulse window is positive`, `over = ${part.over}`);
    return;
  }
  ok(`${where} · ${part.motion}/${part.signal ?? 'open'}`, `travel ${part.travel}`);
}

for (const [modelId, spec] of entries) {
  for (const [name, part] of Object.entries(spec.parts ?? {})) auditPart(modelId, name, part);

  if (spec.cue != null && !(spec.cue >= 0 && spec.cue <= 1)) {
    fail(`${modelId} · cue is a fraction of the posture`, `cue = ${spec.cue}, expected 0..1`);
  }
  for (const [field, value] of [
    ['openTime', spec.openTime], ['closeTime', spec.closeTime], ['hold', spec.hold],
  ] as const) {
    if (value != null && !(value > 0)) fail(`${modelId} · ${field} is positive`, `${field} = ${value}`);
  }
  if ((spec.behaviour === 'momentary' || spec.behaviour === 'run') && spec.hold == null) {
    fail(`${modelId} · a self-closing piece states its hold`, `behaviour '${spec.behaviour}' with no hold`);
  }
}

/* ------------------------------------------------------- part 5: behaviour vs interaction */

console.log('\n=== part 4: the behaviour matches what the interaction actually does ===\n');

for (const [modelId, spec] of entries) {
  const item = ALL_ITEMS.find((i) => i.model === modelId && (i.interactions?.length ?? 0) > 0);
  if (!item) {
    // 'fountain' before its interaction existed was exactly this case, and it is worth catching:
    // a reaction on a piece nobody can interact with can never play.
    fail(`${modelId} · has an interactive item`, 'a row here but no item with an interaction');
    continue;
  }
  const interaction = getPrimaryInteraction(item.id)!;
  const occupies = interactionOccupies(interaction);

  if (spec.behaviour === 'occupied') {
    check(
      occupies,
      `${modelId} · 'occupied' belongs to an occupying interaction`,
      `${item.name}'s ${interaction.kind} hands the player back, so no occupancy event ever fires`,
    );
  } else {
    check(
      !occupies,
      `${modelId} · press behaviour belongs to an acting interaction`,
      `${item.name}'s ${interaction.kind} holds the player, so no 'furniture-interact' ever fires`,
    );
    // The cue is resolved against the posture's own duration; an acting posture always has one.
    const posture = getPosture(interactionPosture(interaction));
    check(
      (posture.duration ?? 0) > 0,
      `${modelId} · its posture states a duration for the cue`,
      `posture '${interactionPosture(interaction)}' has no duration, so cue ${spec.cue} resolves to 0 s`,
    );
  }
}

/* ------------------------------------------------------- part 6: sway rows are reachable */

console.log('\n=== part 5: every suspended motion is referenced by an item ===\n');

for (const id of Object.keys(SUSPENDED_MOTIONS)) {
  const users = ALL_ITEMS.filter((i) => i.interactions?.some((x) => x.sway === id));
  check(
    users.length > 0,
    `SUSPENDED_MOTIONS.${id} is used`,
    'declared but no item references it via interactions[].sway',
  );
}

/* ------------------------------------------------- part 6: a throw follows the thrower */

/*
 * THE DYNAMIC-DIRECTION CHECK, and the reason it can be a unit test rather than a play session.
 *
 * The bug it guards is 「不論從哪一邊互動，物品都往同一個方向飛」, and the shape of that bug is a
 * CONSTANT: a heading that does not move when the player does. So the test is exactly that —
 * walk a synthetic player round the piece, resolve the real heading each time with the real
 * function, and require it to follow. A hard-coded `Vector3`, a fixed local axis or a forgotten
 * `launch` row all fail it the same way, by producing the same number twice.
 *
 * `spread` is deliberately excluded (jitter 0): the fan is a separate, wanted randomness, and
 * folding it in here would make a direction test flaky for the one reason that is not a defect.
 */
console.log('\n=== part 6: a launched piece follows the player who launched it ===\n');

/** Eight approach bearings, so the four the brief names (left/right/front/back) plus the corners. */
const BEARINGS = [0, 45, 90, 135, 180, 225, 270, 315];

for (const [modelId, spec] of entries) {
  const launch = spec.launch;
  if (!launch) continue;

  // The piece at the origin; the player one unit out on each bearing, facing it — which is where
  // the interaction system actually puts them (an acting posture resolves a stand spot on the
  // side the player approached from, squared up to the piece).
  const headings = BEARINGS.map((deg) => {
    const bearing = (deg * Math.PI) / 180;
    const px = Math.sin(bearing);
    const pz = Math.cos(bearing);
    return resolveLaunchHeading(launch, {
      playerX: px,
      playerZ: pz,
      // Facing back at the piece from wherever they stand.
      playerYaw: Math.atan2(-px, -pz),
      objectX: 0,
      objectZ: 0,
    });
  });

  const unique = new Set(headings.map((h) => h.toFixed(4)));
  check(
    unique.size === BEARINGS.length,
    `${modelId} · every approach gives its own heading`,
    `${BEARINGS.length} approaches produced only ${unique.size} distinct headings — the direction `
    + 'is not reading the player',
  );

  // ...and it is the RIGHT own heading: a piece launched by someone standing due south of it
  // goes north. Checked as the angle between the resolved heading and the player→piece line,
  // which is 0 for any `fromFacing` when the player is squared up — that is the whole point of
  // the two sources agreeing for a piece you walk up to.
  let worst = 0;
  BEARINGS.forEach((deg, i) => {
    const bearing = (deg * Math.PI) / 180;
    // Player at bearing B faces the piece, so the throw should go along B + 180.
    const want = Math.atan2(-Math.sin(bearing), -Math.cos(bearing));
    let delta = headings[i] - want;
    while (delta > Math.PI) delta -= Math.PI * 2;
    while (delta < -Math.PI) delta += Math.PI * 2;
    worst = Math.max(worst, Math.abs(delta));
  });
  check(
    worst < 1e-6,
    `${modelId} · it goes away from the thrower`,
    `worst approach is ${((worst * 180) / Math.PI).toFixed(2)} deg off the line away from the player`,
  );

  // The two sources have to be genuinely wired, not just one of them. A player standing beside
  // the piece and looking elsewhere separates them, and a `fromFacing` strictly between 0 and 1
  // must land strictly between the two answers.
  if (launch.fromFacing > 0 && launch.fromFacing < 1) {
    const aside = { playerX: -1, playerZ: 0, objectX: 0, objectZ: 0 };
    const looking = Math.PI / 2 + 1.0; // facing the piece's +X side, a radian off the line to it
    const blended = resolveLaunchHeading(launch, { ...aside, playerYaw: looking });
    const pureAway = Math.PI / 2;
    check(
      Math.abs(blended - pureAway) > 1e-3 && Math.abs(blended - looking) > 1e-3,
      `${modelId} · the blend uses both facing and approach`,
      `fromFacing ${launch.fromFacing} still resolved to one of the two ends (${blended.toFixed(4)})`,
    );
  }
}

/* ------------------------------------------------------- verdict */

console.log('');
if (failures > 0) {
  console.log(`FAIL — ${failures} of ${checks} checks failed.`);
  process.exit(1);
}
console.log(
  `PASS — ${checks} checks. Every interactive piece reacts, and every part it declares is wired.`,
);

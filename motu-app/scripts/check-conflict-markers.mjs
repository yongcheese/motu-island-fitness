// Rejects unresolved merge-conflict markers before they can be committed.
//
// This exists because it already happened: commit 3381edf shipped four blocks of
// live conflict markers inside src/components/BuildingInteriorView.tsx. A file in
// that state does not parse, so it is not "a bad merge on one machine" - it is a
// broken build handed to everyone who pulls, and the person who pulls it is the
// one who has to reconstruct what the author meant.
//
// Two modes, deliberately different in scope:
//
//   --staged   What the pre-commit hook runs. Looks ONLY at the lines this commit
//              ADDS. That matters: scanning whole files would mean one pre-existing
//              marker anywhere in the tree blocks every commit until it is cleaned
//              up, which is how a hook earns a permanent --no-verify habit.
//
//   (default)  Repo-wide audit over tracked files, for CI or a manual check.
//              Run: npm run check:conflicts
//
// Bypass, when a file genuinely needs to contain a marker (documentation about
// merging, a test fixture):  git commit --no-verify

import { spawnSync } from 'node:child_process';

/**
 * The three markers git writes, built rather than written literally so that THIS
 * file - and the hook that runs it - does not trip its own check.
 *
 * `=======` is deliberately absent. On its own it is not evidence of anything: it
 * is also a markdown h1 underline and half the ASCII rules ever typed into a
 * comment banner. The opening and closing markers are unambiguous, they cannot be
 * left behind without one of these two, and a check that cries wolf gets disabled.
 *
 * The base marker is written as the bracket expression [|] and never as a backslash-escaped
 * pipe. These patterns go to `git grep -E`, and POSIX ERE leaves backslash-pipe undefined: git
 * reads it as plain alternation, collapsing the pattern into empty branches that match every line
 * in the repository. A bracket expression means the same thing to both git and JavaScript.
 */
const MARKERS = [
  { name: 'ours', pattern: '^' + '<'.repeat(7) + '( |$)' },
  { name: 'base', pattern: '^' + '[|]'.repeat(7) + '( |$)' },
  { name: 'theirs', pattern: '^' + '>'.repeat(7) + '( |$)' },
];

const MARKER_RE = new RegExp(MARKERS.map((m) => m.pattern).join('|'));

function git(args) {
  const r = spawnSync('git', args, { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
  if (r.error) throw r.error;
  return r;
}

/**
 * Added lines in the staged diff, as {file, line, text}.
 *
 * -U0 so every `+` line is genuinely new rather than context, and --no-ext-diff so
 * a configured external differ cannot change the format out from under the parse.
 * Binary files produce a "Binary files ... differ" line with no `+` content, so
 * they fall out on their own.
 */
function stagedAdditions() {
  const r = git(['diff', '--cached', '-U0', '--no-color', '--no-ext-diff', '--diff-filter=ACMR']);
  if (r.status !== 0) {
    process.stderr.write(r.stderr || 'git diff --cached failed\n');
    process.exit(2);
  }

  const out = [];
  let file = null;
  let lineNo = 0;

  for (const raw of r.stdout.split('\n')) {
    if (raw.startsWith('+++ ')) {
      // "+++ b/path", or "+++ /dev/null" for a deletion.
      file = raw === '+++ /dev/null' ? null : raw.slice(6);
      continue;
    }
    if (raw.startsWith('@@')) {
      const m = /^@@ -\d+(?:,\d+)? \+(\d+)/.exec(raw);
      lineNo = m ? Number(m[1]) : 0;
      continue;
    }
    if (file && raw.startsWith('+')) {
      out.push({ file, line: lineNo, text: raw.slice(1) });
      lineNo++;
    }
  }
  return out;
}

/** Every marker line in tracked files, via git grep so binaries are skipped for us. */
function trackedMarkers() {
  const args = ['grep', '-I', '-n', '--no-color', '-E'];
  for (const m of MARKERS) args.push('-e', m.pattern);
  const r = git(args);
  if (r.status === 1) return []; // git grep: 1 means "no matches"
  if (r.status !== 0) {
    process.stderr.write(r.stderr || 'git grep failed\n');
    process.exit(2);
  }
  return r.stdout
    .split('\n')
    .filter(Boolean)
    .map((row) => {
      const [file, line, ...rest] = row.split(':');
      return { file, line: Number(line), text: rest.join(':') };
    });
}

const staged = process.argv.includes('--staged');
const hits = staged ? stagedAdditions().filter((h) => MARKER_RE.test(h.text)) : trackedMarkers();

if (hits.length === 0) {
  if (!staged) console.log('No conflict markers in tracked files.');
  process.exit(0);
}

const where = staged ? 'staged for commit' : 'tracked files';
process.stderr.write(`\nUnresolved conflict markers ${where} (${hits.length}):\n\n`);
for (const h of hits) process.stderr.write(`  ${h.file}:${h.line}: ${h.text.trim()}\n`);
process.stderr.write(
  staged
    ? '\nResolve them, `git add` the files, and commit again.\n' +
      'If a marker is intentional here, bypass with: git commit --no-verify\n\n'
    : '\n'
);
process.exit(1);

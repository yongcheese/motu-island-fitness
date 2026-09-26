// Points git at the version-controlled hooks in scripts/hooks.
//
// Run automatically by the `prepare` npm lifecycle script, so a fresh clone gets the hooks from
// its first `npm install` with nothing to remember. That indirection is the whole point:
// .git/hooks is not version controlled, so hooks written there guard one working copy while
// everyone else commits unchecked - which is how four blocks of conflict markers reached main.
//
// Idempotent, and silent about being unable to run: `npm install` inside a tarball or a CI cache
// warm-up has no .git, and that is not a failure worth breaking an install over.

import { spawnSync } from 'node:child_process';

const HOOKS_PATH = 'scripts/hooks';

const inRepo = spawnSync('git', ['rev-parse', '--git-dir'], { encoding: 'utf8' });
if (inRepo.status !== 0) {
  console.log('setup-hooks: not a git repository, skipping.');
  process.exit(0);
}

const current = spawnSync('git', ['config', '--get', 'core.hooksPath'], { encoding: 'utf8' });
if (current.status === 0 && current.stdout.trim() === HOOKS_PATH) {
  process.exit(0);
}

const set = spawnSync('git', ['config', 'core.hooksPath', HOOKS_PATH], { encoding: 'utf8' });
if (set.status !== 0) {
  console.log('setup-hooks: could not set core.hooksPath, skipping.');
  process.exit(0);
}

console.log(`setup-hooks: core.hooksPath -> ${HOOKS_PATH}`);

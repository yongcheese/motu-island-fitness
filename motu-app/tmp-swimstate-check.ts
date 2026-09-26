import { nextSwimState, swimTransitionTimer, SWIM_TRANSITION_DURATION, SwimState } from './src/components/Three/characterMovement';

const scale = 1;
const sandRadius = 6.8 * scale;
const DT = 1 / 60;

/**
 * Drives the real state machine + the real timer bookkeeping from Avatar.tsx over a
 * scripted radius-vs-time path, and reports the worst transition progress the character
 * ever sits at while its state is a transition state.
 *
 * `p` near 0 while in exitingWater is precisely the bug: height is held at SWIM_BODY_Y
 * (-0.6) and pitch at the full in-water tilt, i.e. sunk into the sand face-down.
 */
function simulate(name: string, radiusAt: (t: number) => number, seconds: number) {
  let state: SwimState = 'walking';
  let timer = 0;
  let framesStuckLow = 0;   // frames in a transition with p < 0.15
  let longestTransition = 0;
  let curTransition = 0;
  let flips = 0;

  for (let i = 0; i < seconds / DT; i++) {
    const t = i * DT;
    const r = radiusAt(t);

    // Avatar.tsx: timer ticks first, may complete the transition
    if (state === 'enteringWater' || state === 'exitingWater') {
      timer -= DT;
      if (timer <= 0) state = state === 'enteringWater' ? 'swimming' : 'walking';
    }

    // then the state is re-evaluated against the position
    const next = nextSwimState(state, r, 0, scale);
    if (next !== state) {
      timer = swimTransitionTimer(state, next, timer);
      state = next;
      flips++;
    }

    if (state === 'enteringWater' || state === 'exitingWater') {
      const p = 1.0 - Math.max(0, timer / SWIM_TRANSITION_DURATION);
      if (p < 0.15) framesStuckLow++;
      curTransition += DT;
      longestTransition = Math.max(longestTransition, curTransition);
    } else {
      curTransition = 0;
    }
  }

  const stuck = longestTransition > 1.0;
  console.log(
    `${stuck ? 'FAIL' : 'ok  '}  ${name.padEnd(38)} ` +
    `final=${state.padEnd(13)} flips=${String(flips).padStart(4)} ` +
    `longestTransition=${longestTransition.toFixed(2)}s stuckLowFrames=${framesStuckLow}`
  );
  return !stuck;
}

console.log(`sandRadius=${sandRadius}  inner=${(sandRadius - 0.35).toFixed(2)}  outer=${(sandRadius + 0.35).toFixed(2)}\n`);

let allOk = true;

// Baseline: straight in, straight out. Must complete cleanly both ways.
allOk = simulate('walk straight out to sea', t => 5.5 + t * 1.0, 6) && allOk;
allOk = simulate('swim straight back to beach', t => 9.0 - t * 1.0, 8) && allOk;

// The reported bug: loitering exactly on the old shared threshold (sandRadius - margin).
allOk = simulate('park on the inner line', t => (t < 3 ? 5.5 + t * 1.0 : 6.45), 12) && allOk;

// Tangential shore walk: radius wobbles across the old shared line every ~0.4s.
allOk = simulate('wobble across inner line +-0.06', t => (t < 3 ? 5.5 + t * 1.0 : 6.45 + Math.sin(t * 15) * 0.06), 14) && allOk;

// Larger wobble, still inside the new 2*margin dead zone.
allOk = simulate('wobble across inner line +-0.25', t => (t < 3 ? 5.5 + t * 1.0 : 6.45 + Math.sin(t * 8) * 0.25), 14) && allOk;

// A genuine turnaround mid-exit must still be honoured (not deadlocked into walking).
allOk = simulate('exit then turn back out to sea', t => (t < 4 ? 9.0 - t * 1.0 : 5.0 + (t - 4) * 1.2), 12) && allOk;

console.log(`\n${allOk ? 'ALL PASS - every transition completes' : 'SOME FAILED - a transition never completed'}`);
process.exit(allOk ? 0 : 1);

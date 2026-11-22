import { SeededRandom } from './ItemDefs';

/**
 * Independent deterministic RNG streams for a single run so combat rolls (crits, procs, AI wander)
 * never perturb Chest/Pod layout generation, Combat Director waves, or 3-choice loot drafts.
 */
export interface RunRngStreams {
  runSeed: number;
  layoutSeed: number;
  layout: SeededRandom;
  director: SeededRandom;
  loot: SeededRandom;
  combat: SeededRandom;
}

function mixSeed32(seed: number, salt: number): number {
  let x = ((seed >>> 0) ^ (salt >>> 0)) >>> 0;
  x = Math.imul(x ^ (x >>> 16), 0x7feb352d) >>> 0;
  x = Math.imul(x ^ (x >>> 15), 0x846ca68b) >>> 0;
  x = (x ^ (x >>> 16)) >>> 0;
  return x === 0 ? 1 : x;
}

export function generateFreshRunSeed(): number {
  const perfNow = typeof performance !== 'undefined' ? Math.floor(performance.now() * 1000) : 0;
  const raw = ((Date.now() >>> 0) ^ (perfNow >>> 0) ^ Math.floor(Math.random() * 0x7fffffff)) >>> 0;
  return raw === 0 ? 133799 : raw;
}

export function createRunRngStreams(runSeed: number, pinnedLayoutSeed?: number | null): RunRngStreams {
  const normalizedRun = (runSeed >>> 0) || 133799;
  const layoutSeed =
    pinnedLayoutSeed !== null && pinnedLayoutSeed !== undefined
      ? ((pinnedLayoutSeed >>> 0) || 1)
      : mixSeed32(normalizedRun, 0x9e3779b9);

  return {
    runSeed: normalizedRun,
    layoutSeed,
    layout: new SeededRandom(layoutSeed),
    director: new SeededRandom(mixSeed32(normalizedRun, 0x85ebca6b)),
    loot: new SeededRandom(mixSeed32(normalizedRun, 0xc2b2ae35)),
    combat: new SeededRandom(mixSeed32(normalizedRun, 0x27d4eb2f))
  };
}

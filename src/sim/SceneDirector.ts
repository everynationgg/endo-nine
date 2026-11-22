import type { GameState } from './GameState';
import type { SeededRandom } from './ItemDefs';
import {
  createSpawnPlacementDiagnostics,
  isPointInRegion,
  isValidPodPlacement,
  type SpawnPlacementDiagnostics
} from './SpawnPlacement';
import type { OrganicPodState } from './types';
import type { StageProfileKey } from '../dev/StageConfig';

export const SCENE_DIRECTOR_CONFIG = {
  podCreditCost: 20,
  podGenePrice: 25,
  customMapBudgetRange: [180, 260] as const, // 9 - 13 Bio-Pods
  proceduralBudgetRange: [140, 200] as const // 7 - 10 Bio-Pods
};

export interface SceneDirectorReport {
  layoutSeed: number;
  profileKey: StageProfileKey;
  budget: number;
  spent: number;
  targetCount: number;
  spawnedCount: number;
  rejectedAttempts: number;
  diagnostics: SpawnPlacementDiagnostics;
}

function shuffleInPlace<T>(arr: T[], rng: SeededRandom): T[] {
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(rng.next() * (i + 1));
    const tmp = arr[i];
    arr[i] = arr[j];
    arr[j] = tmp;
  }
  return arr;
}

/**
 * Generates randomized, reachable Bio-Pods using a finite Scene Credit budget
 * derived strictly from `layoutRng` without mutating `activeStageConfig`.
 */
export function generateStagePods(
  state: GameState,
  rng: SeededRandom,
  layoutSeed: number
): { pods: OrganicPodState[]; report: SceneDirectorReport } {
  const isCustom = state.terrain.isCustomTestMap;
  const profileKey: StageProfileKey = isCustom ? 'custom_map' : 'procedural';
  const [minBudget, maxBudget] = isCustom
    ? SCENE_DIRECTOR_CONFIG.customMapBudgetRange
    : SCENE_DIRECTOR_CONFIG.proceduralBudgetRange;

  const creditCost = SCENE_DIRECTOR_CONFIG.podCreditCost;
  const minCount = Math.floor(minBudget / creditCost);
  const maxCount = Math.floor(maxBudget / creditCost);
  const targetCount = minCount + Math.floor(rng.next() * (maxCount - minCount + 1));
  const budget = targetCount * creditCost;

  const diag = createSpawnPlacementDiagnostics();
  const pods: OrganicPodState[] = [];
  let rejectedAttempts = 0;

  const shipAnchor =
    isCustom && state.terrain.testShipBox
      ? {
          x: (state.terrain.testShipBox.minX + state.terrain.testShipBox.maxX) * 0.5,
          y: (state.terrain.testShipBox.minZ + state.terrain.testShipBox.maxZ) * 0.5
        }
      : isCustom
        ? state.playerSpawnPos
        : { x: 1800, y: 2960 };
  const nearShipRadius = isCustom ? 1100 : 750;
  let nearShipCount = 0;

  const tryPlacePod = (
    x: number,
    y: number,
    name: string,
    zOffset: number,
    rotationY: number,
    scale: number,
    minSpacing: number
  ): boolean => {
    diag.totalAttempts++;
    const nearShip = Math.hypot(x - shipAnchor.x, y - shipAnchor.y) <= nearShipRadius;
    if (nearShip && nearShipCount >= 1) {
      rejectedAttempts++;
      diag.failures.spacing++;
      diag.lastFailureReason = 'spacing';
      return false;
    }

    const res = isValidPodPlacement(
      state,
      x,
      y,
      pods,
      { minPodSpacing: minSpacing },
      diag
    );
    if (!res.valid) {
      rejectedAttempts++;
      return false;
    }

    diag.totalSuccesses++;
    if (nearShip) nearShipCount++;
    pods.push({
      id: `pod_${pods.length + 1}`,
      name,
      pos: { x, y },
      zOffset,
      rotationY,
      scale,
      cost: SCENE_DIRECTOR_CONFIG.podGenePrice,
      isOpened: false,
      radius: 36
    });
    return true;
  };

  // 1. Gather read-only authored pod anchors (never mutate activeStageConfig!)
  const authoredPods = (state.activeStageConfig?.profiles?.[profileKey]?.pods || [])
    .filter((p) => p.enabled !== false)
    .map((p) => ({ ...p }));
  shuffleInPlace(authoredPods, rng);

  const podIncludeRegions = (state.enemySpawnRegions || []).filter(
    (r) =>
      r.enabled &&
      (r.mode || 'include') === 'include' &&
      (r.usage === 'pod' || r.usage === 'both')
  );

  const primarySpacing = isCustom ? 900 : 440;
  const fallbackSpacing = isCustom ? 620 : 320;
  const jitterRadius = isCustom ? 220 : 120;

  // Mix authored scenic anchors (jittered smoothly per seed) with random world samples
  // so runs vary meaningfully while staying anchored to curated terrain pockets.
  const authoredTargetCap = Math.max(0, Math.min(authoredPods.length, Math.ceil(targetCount * 0.75)));
  for (let i = 0; i < authoredTargetCap && pods.length < targetCount; i++) {
    const src = authoredPods[i];
    const ang = rng.range(0, Math.PI * 2);
    const jDist = rng.range(45, jitterRadius);
    const jx = src.x + Math.cos(ang) * jDist;
    const jy = src.y + Math.sin(ang) * jDist;
    const placedJittered = tryPlacePod(
      jx,
      jy,
      src.name || 'Biological Growth Sac',
      src.zOffset ?? 0,
      src.rotationY ?? rng.range(0, Math.PI * 2),
      src.scale ?? 1,
      primarySpacing
    );
    if (!placedJittered) {
      tryPlacePod(
        src.x,
        src.y,
        src.name || 'Biological Growth Sac',
        src.zOffset ?? 0,
        src.rotationY ?? rng.range(0, Math.PI * 2),
        src.scale ?? 1,
        primarySpacing
      );
    }
  }

  const bounds = state.terrain.getPlayableBounds(isCustom ? 240 : 160);
  const sampleCandidate = (): { x: number; y: number } => {
    if (podIncludeRegions.length > 0) {
      const reg = podIncludeRegions[Math.floor(rng.next() * podIncludeRegions.length)];
      if (reg.shape === 'circle') {
        const rad = reg.radius || Math.max(reg.width, reg.height) * 0.5;
        const theta = rng.range(0, Math.PI * 2);
        const r = rad * Math.sqrt(rng.next());
        return { x: reg.x + Math.cos(theta) * r, y: reg.y + Math.sin(theta) * r };
      }
      return {
        x: reg.x + rng.range(-reg.width * 0.5, reg.width * 0.5),
        y: reg.y + rng.range(-reg.height * 0.5, reg.height * 0.5)
      };
    }
    return {
      x: rng.range(bounds.minX, bounds.maxX),
      y: rng.range(bounds.minY, bounds.maxY)
    };
  };

  // 2. Random validated samples across map up to targetCount
  for (let attempt = 0; attempt < 260 && pods.length < targetCount; attempt++) {
    const cand = sampleCandidate();
    if (podIncludeRegions.length > 0 && !podIncludeRegions.some((r) => isPointInRegion(cand.x, cand.y, r))) {
      continue;
    }
    tryPlacePod(
      cand.x,
      cand.y,
      'Biological Growth Sac',
      0,
      rng.range(0, Math.PI * 2),
      1,
      primarySpacing
    );
  }

  // 3. Remaining shuffled authored anchors + relaxed fallback pass ONLY if below target minimum
  if (pods.length < targetCount) {
    for (let i = authoredTargetCap; i < authoredPods.length && pods.length < targetCount; i++) {
      const src = authoredPods[i];
      tryPlacePod(
        src.x,
        src.y,
        src.name || 'Biological Growth Sac',
        src.zOffset ?? 0,
        src.rotationY ?? 0,
        src.scale ?? 1,
        fallbackSpacing
      );
    }
  }
  for (let attempt = 0; attempt < 180 && pods.length < minCount; attempt++) {
    const cand = sampleCandidate();
    tryPlacePod(
      cand.x,
      cand.y,
      'Biological Growth Sac',
      0,
      rng.range(0, Math.PI * 2),
      1,
      fallbackSpacing
    );
  }

  const spent = pods.length * creditCost;
  const report: SceneDirectorReport = {
    layoutSeed,
    profileKey,
    budget,
    spent,
    targetCount,
    spawnedCount: pods.length,
    rejectedAttempts,
    diagnostics: diag
  };
  return { pods, report };
}

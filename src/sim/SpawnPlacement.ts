import { ENEMY_CONFIGS } from './EnemyDefs';
import type { GameState } from './GameState';
import type { SeededRandom } from './ItemDefs';
import type { EnemyType, OrganicPodState, Vector2 } from './types';
import type { StageEnemySpawnRegionConfig } from '../dev/StageConfig';

export type SpawnFailureReason =
  | 'bounds'
  | 'terrain'
  | 'water'
  | 'slope'
  | 'obstacle'
  | 'hollow'
  | 'nav'
  | 'excluded_region'
  | 'outside_include_region'
  | 'ship_safe_zone'
  | 'player_distance'
  | 'camera_view'
  | 'spacing'
  | 'elevation';

export interface SpawnPlacementDiagnostics {
  totalAttempts: number;
  totalSuccesses: number;
  lastFailureReason: SpawnFailureReason | null;
  failures: Record<SpawnFailureReason, number>;
}

export function createSpawnPlacementDiagnostics(): SpawnPlacementDiagnostics {
  return {
    totalAttempts: 0,
    totalSuccesses: 0,
    lastFailureReason: null,
    failures: {
      bounds: 0,
      terrain: 0,
      water: 0,
      slope: 0,
      obstacle: 0,
      hollow: 0,
      nav: 0,
      excluded_region: 0,
      outside_include_region: 0,
      ship_safe_zone: 0,
      player_distance: 0,
      camera_view: 0,
      spacing: 0,
      elevation: 0
    }
  };
}

function recordFail(diag: SpawnPlacementDiagnostics | undefined, reason: SpawnFailureReason): { valid: false; reason: SpawnFailureReason } {
  if (diag) {
    diag.lastFailureReason = reason;
    diag.failures[reason] = (diag.failures[reason] || 0) + 1;
  }
  return { valid: false, reason };
}

export function isPointInRegion(x: number, y: number, reg: StageEnemySpawnRegionConfig): boolean {
  if (reg.shape === 'circle') {
    const r = Math.max(10, reg.radius || Math.max(reg.width, reg.height) * 0.5);
    const dx = x - reg.x;
    const dy = y - reg.y;
    return dx * dx + dy * dy <= r * r;
  }
  return Math.abs(x - reg.x) <= reg.width * 0.5 && Math.abs(y - reg.y) <= reg.height * 0.5;
}

export function isPointInShipSafeZone(state: GameState, x: number, y: number): boolean {
  const terrain = state.terrain;
  if (terrain.isCustomTestMap) {
    if (terrain.testShipBox) {
      const sb = terrain.testShipBox;
      const pad = 280;
      if (x >= sb.minX - pad && x <= sb.maxX + pad && y >= sb.minZ - pad && y <= sb.maxZ + pad) {
        return true;
      }
    }
    const spawn = terrain.testSpawnPos || state.playerSpawnPos;
    if (Math.hypot(x - spawn.x, y - spawn.y) < 520) {
      return true;
    }
    return false;
  }

  // Procedural map: protect shipwreck hull (1800, 2960) and starting deck playerSpawnPos
  if (Math.hypot(x - 1800, y - 2960) < 480) return true;
  if (Math.hypot(x - state.playerSpawnPos.x, y - state.playerSpawnPos.y) < 380) return true;
  return false;
}

export interface SurfaceValidationOptions {
  usage: 'enemy' | 'pod';
  enemyType?: EnemyType;
  radius?: number;
  maxSlope?: number;
  allowWater?: boolean;
  refZ?: number;
  requireNavReachableFrom?: { x: number; y: number; z: number };
}

/**
 * Authoritative surface, obstacle, region, hollow-interior, and nav-reachability validator.
 * Never falls back silently onto excluded or invalid terrain.
 */
export function validateSpawnSurface(
  state: GameState,
  x: number,
  y: number,
  opts: SurfaceValidationOptions,
  diag?: SpawnPlacementDiagnostics
): { valid: true; z: number; category?: string } | { valid: false; reason: SpawnFailureReason } {
  const terrain = state.terrain;
  const pad = Math.max(40, opts.radius ?? 32);
  if (!terrain.isInsidePlayableBounds(x, y, pad)) {
    return recordFail(diag, 'bounds');
  }
  const b = terrain.getPlayableBounds(pad);
  if (x < b.minX || x > b.maxX || y < b.minY || y > b.maxY) {
    return recordFail(diag, 'bounds');
  }

  // 1. Ship safe-zone exclusion
  if (isPointInShipSafeZone(state, x, y)) {
    return recordFail(diag, 'ship_safe_zone');
  }

  // 2. Stage Editor exclusion & inclusion regions
  const activeRegions = (state.enemySpawnRegions || []).filter((r) => {
    if (!r.enabled) return false;
    const usage = r.usage || 'enemy';
    if (usage !== 'both' && usage !== opts.usage) return false;
    return true;
  });

  for (let i = 0; i < activeRegions.length; i++) {
    const reg = activeRegions[i];
    if ((reg.mode || 'include') === 'exclude' && isPointInRegion(x, y, reg)) {
      if (!opts.enemyType || reg.allowedTypes.length === 0 || reg.allowedTypes.includes(opts.enemyType)) {
        return recordFail(diag, 'excluded_region');
      }
    }
  }

  // 3. Surface elevation, walkability, water, and hollow interior check
  const sample = terrain.getElevation(x, y, opts.refZ ?? 1e6, 22);
  const elev = sample.height;
  if (
    !sample.isWalkable ||
    sample.surfaceType === 'chasm' ||
    sample.category === 'cliff' ||
    sample.category === 'border' ||
    sample.category === 'solid_obstacle'
  ) {
    return recordFail(diag, 'terrain');
  }

  const isFlyer = opts.usage === 'enemy' && (opts.enemyType === 'wasp' || opts.enemyType === 'boss' || opts.enemyType === 'broodling');
  const allowWater = Boolean(opts.allowWater || isFlyer);
  const inWater = Boolean(sample.isInWater || sample.category === 'water' || (!terrain.isCustomTestMap && elev <= 5.5));
  if (inWater && !allowWater) {
    return recordFail(diag, 'water');
  }

  if (terrain.meshCollider) {
    if (sample.category === 'tower_ledge' || sample.category === 'ship_walkable') {
      return recordFail(diag, 'terrain');
    }
    // Pods and ground units must never spawn inside hollow cave/tower/cliff interiors
    if (!terrain.meshCollider.isPositionOutsideHollowInterior(x, y, elev, 20)) {
      return recordFail(diag, 'hollow');
    }
    if (opts.usage === 'pod' && sample.category !== 'ground') {
      return recordFail(diag, 'terrain');
    }
  } else {
    // Procedural ground check
    if (elev > 690) return recordFail(diag, 'elevation');
  }

  // 4. Local slope check
  const maxSlope = opts.maxSlope ?? (opts.usage === 'pod' ? 0.42 : 0.65);
  if (!isFlyer) {
    if (terrain.meshCollider) {
      const hE = terrain.getElevation(x + 22, y, elev + 35, 35).height;
      const hW = terrain.getElevation(x - 22, y, elev + 35, 35).height;
      const hN = terrain.getElevation(x, y - 22, elev + 35, 35).height;
      const hS = terrain.getElevation(x, y + 22, elev + 35, 35).height;
      const localSlope = Math.max(Math.abs(hE - elev), Math.abs(hW - elev), Math.abs(hN - elev), Math.abs(hS - elev)) / 22;
      if (localSlope > maxSlope) {
        return recordFail(diag, 'slope');
      }
    } else if (terrain.getSurfaceSlope(x, y, 20) > maxSlope) {
      return recordFail(diag, 'slope');
    }
  }

  // 5. Obstacle collision clearance
  const clearancePad = opts.radius ?? 32;
  for (let i = 0; i < state.obstacles.length; i++) {
    const obs = state.obstacles[i];
    if (Math.hypot(x - obs.pos.x, y - obs.pos.y) < obs.radius + clearancePad) {
      return recordFail(diag, 'obstacle');
    }
  }

  // 6. Authored include-region filtering (if any matching include regions are enabled)
  const includeRegions = activeRegions.filter((r) => {
    if ((r.mode || 'include') !== 'include') return false;
    if (opts.usage === 'enemy' && opts.enemyType) {
      return r.allowedTypes.length > 0 && r.allowedTypes.includes(opts.enemyType);
    }
    return true;
  });

  if (includeRegions.length > 0) {
    let matchedInclude = false;
    let failedElev = false;
    let failedDist = false;
    let failedRestrict = false;
    for (let i = 0; i < includeRegions.length; i++) {
      const reg = includeRegions[i];
      if (!isPointInRegion(x, y, reg)) continue;
      if (elev < reg.minElevation || elev > reg.maxElevation) {
        failedElev = true;
        continue;
      }
      if (reg.terrainRestriction === 'near_water' && !terrain.isPointNearWater(x, y)) {
        failedRestrict = true;
        continue;
      }
      if (
        opts.requireNavReachableFrom &&
        Math.hypot(x - opts.requireNavReachableFrom.x, y - opts.requireNavReachableFrom.y) < reg.minPlayerDistance
      ) {
        failedDist = true;
        continue;
      }
      matchedInclude = true;
      break;
    }
    if (!matchedInclude) {
      if (failedDist) return recordFail(diag, 'player_distance');
      if (failedElev) return recordFail(diag, 'elevation');
      if (failedRestrict) return recordFail(diag, 'terrain');
      return recordFail(diag, 'outside_include_region');
    }
  }

  // 7. Navigation / custom-map enemy spawn validation
  if (opts.usage === 'enemy' && !isFlyer) {
    if (terrain.meshCollider) {
      // Custom GLB collider: must be valid ground & not inside wall lip
      if (!terrain.isPointValidEnemySpawn(x, y)) {
        return recordFail(diag, 'terrain');
      }
      if (opts.requireNavReachableFrom) {
        const navInfo = terrain.getNavWaypointInfo(
          { x, y },
          { x: opts.requireNavReachableFrom.x, y: opts.requireNavReachableFrom.y },
          false,
          elev,
          opts.requireNavReachableFrom.z
        );
        if (!navInfo.isReachable) {
          return recordFail(diag, 'nav');
        }
      }
    } else if (opts.requireNavReachableFrom) {
      const navInfo = terrain.getNavWaypointInfo(
        { x, y },
        { x: opts.requireNavReachableFrom.x, y: opts.requireNavReachableFrom.y },
        false,
        elev,
        opts.requireNavReachableFrom.z
      );
      if (!navInfo.isReachable) {
        return recordFail(diag, 'nav');
      }
    }
  }

  return { valid: true, z: elev, category: sample.category };
}

export interface EnemySpawnSearchOptions {
  cameraForward?: Vector2;
  maxAttempts?: number;
  minPlayerDist?: number;
  maxPlayerDist?: number;
}

/**
 * Finds a validated enemy spawn coordinate around the player (or within enabled include regions).
 * Returns null if all bounded retries fail — NEVER silently spawns on forbidden terrain.
 */
export function findValidEnemySpawnPosition(
  state: GameState,
  rng: SeededRandom,
  enemyType: EnemyType,
  opts: EnemySpawnSearchOptions = {},
  diag?: SpawnPlacementDiagnostics
): { x: number; y: number; z: number } | null {
  const p = state.player;
  const terrain = state.terrain;
  const cfg = ENEMY_CONFIGS[enemyType];
  const isCustom = terrain.isCustomTestMap;
  const minDist = opts.minPlayerDist ?? (isCustom ? 560 : 420);
  const maxDist = opts.maxPlayerDist ?? (isCustom ? 1550 : 980);
  const maxAttempts = opts.maxAttempts ?? 14;

  const matchingIncludes = (state.enemySpawnRegions || []).filter(
    (r) =>
      r.enabled &&
      (r.mode || 'include') === 'include' &&
      ((r.usage || 'enemy') === 'enemy' || r.usage === 'both') &&
      r.allowedTypes.includes(enemyType)
  );

  // Filter include regions that haven't hit maxActiveEnemies
  const eligibleIncludes = matchingIncludes.filter((reg) => {
    let activeCount = 0;
    for (let i = 0; i < state.enemies.length; i++) {
      const en = state.enemies[i];
      if (en.health > 0 && isPointInRegion(en.pos.x, en.pos.y, reg)) {
        activeCount++;
      }
    }
    return activeCount < reg.maxActiveEnemies;
  });

  const navPool = terrain.meshCollider?.validEnemySpawnPositions;

  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    if (diag) diag.totalAttempts++;
    let cx = 0;
    let cy = 0;

    if (eligibleIncludes.length > 0) {
      const reg = eligibleIncludes[Math.floor(rng.next() * eligibleIncludes.length)];
      if (reg.shape === 'circle') {
        const rad = Math.max(20, reg.radius || Math.max(reg.width, reg.height) * 0.5);
        const theta = rng.range(0, Math.PI * 2);
        const rDist = rad * Math.sqrt(rng.next());
        cx = reg.x + Math.cos(theta) * rDist;
        cy = reg.y + Math.sin(theta) * rDist;
      } else {
        cx = reg.x + rng.range(-reg.width * 0.5, reg.width * 0.5);
        cy = reg.y + rng.range(-reg.height * 0.5, reg.height * 0.5);
      }
    } else if (navPool && navPool.length > 0 && attempt % 2 === 0) {
      const base = navPool[Math.floor(rng.next() * navPool.length)];
      cx = base.x + rng.range(-28, 28);
      cy = base.y + rng.range(-28, 28);
    } else {
      const angle = rng.range(0, Math.PI * 2);
      const radius = rng.range(minDist, maxDist);
      cx = p.pos.x + Math.cos(angle) * radius;
      cy = p.pos.y + Math.sin(angle) * radius;
    }

    const dPlayer = Math.hypot(cx - p.pos.x, cy - p.pos.y);
    if (dPlayer < minDist || dPlayer > maxDist * 1.35) {
      recordFail(diag, 'player_distance');
      continue;
    }

    // Prefer off-camera spawns during the first 60% of attempts when cameraForward is known
    if (opts.cameraForward && attempt < Math.floor(maxAttempts * 0.6)) {
      const dirX = (cx - p.pos.x) / Math.max(1, dPlayer);
      const dirY = (cy - p.pos.y) / Math.max(1, dPlayer);
      const fwdDot = dirX * opts.cameraForward.x + dirY * opts.cameraForward.y;
      if (fwdDot > 0.35) {
        recordFail(diag, 'camera_view');
        continue;
      }
    }

    const res = validateSpawnSurface(
      state,
      cx,
      cy,
      {
        usage: 'enemy',
        enemyType,
        radius: Math.max(24, (cfg?.radius || 38) * 0.8),
        requireNavReachableFrom: { x: p.pos.x, y: p.pos.y, z: p.z }
      },
      diag
    );

    if (res.valid) {
      if (diag) diag.totalSuccesses++;
      return { x: cx, y: cy, z: res.z };
    }
  }

  return null;
}

export interface PodPlacementOptions {
  minPodSpacing?: number;
  minTowerDist?: number;
  minEventDist?: number;
  minSpawnDist?: number;
}

/**
 * Validates a candidate Bio-Pod position against terrain, reachability, ship zone,
 * exclusion regions, tower/event clearance, and existing chest spacing.
 */
export function isValidPodPlacement(
  state: GameState,
  x: number,
  y: number,
  existingPods: Pick<OrganicPodState, 'pos'>[],
  opts: PodPlacementOptions = {},
  diag?: SpawnPlacementDiagnostics
): { valid: true; z: number } | { valid: false; reason: SpawnFailureReason } {
  const isCustom = state.terrain.isCustomTestMap;
  const minSpacing = opts.minPodSpacing ?? (isCustom ? 900 : 440);
  const minTowerDist = opts.minTowerDist ?? (isCustom ? 520 : 220);
  const minEventDist = opts.minEventDist ?? (isCustom ? 260 : 180);
  const minSpawnDist = opts.minSpawnDist ?? (isCustom ? 380 : 220);

  if (Math.hypot(x - state.playerSpawnPos.x, y - state.playerSpawnPos.y) < minSpawnDist) {
    return recordFail(diag, 'spacing');
  }
  if (state.artifact && Math.hypot(x - state.artifact.pos.x, y - state.artifact.pos.y) < minTowerDist) {
    return recordFail(diag, 'spacing');
  }
  for (let i = 0; i < state.worldEvents.length; i++) {
    const ev = state.worldEvents[i];
    if (Math.hypot(x - ev.pos.x, y - ev.pos.y) < Math.max(minEventDist, (ev.radius || 110) + 120)) {
      return recordFail(diag, 'spacing');
    }
  }
  for (let i = 0; i < existingPods.length; i++) {
    if (Math.hypot(x - existingPods[i].pos.x, y - existingPods[i].pos.y) < minSpacing) {
      return recordFail(diag, 'spacing');
    }
  }

  const spawnElev = state.terrain.getElevation(state.playerSpawnPos.x, state.playerSpawnPos.y, 1e6, 22).height;
  const surf = validateSpawnSurface(
    state,
    x,
    y,
    {
      usage: 'pod',
      radius: 42,
      maxSlope: isCustom ? 0.38 : 0.30,
      allowWater: false,
      requireNavReachableFrom: { x: state.playerSpawnPos.x, y: state.playerSpawnPos.y, z: spawnElev }
    },
    diag
  );
  if (!surf.valid) return surf;

  return { valid: true, z: surf.z };
}

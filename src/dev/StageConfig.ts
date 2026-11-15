import type { EnemyType, Vector2, WorldEventType } from '../sim/types';
import type { TerrainSystem } from '../sim/TerrainSystem';

export type { EnemyType, WorldEventType };

export type StageProfileKey = 'procedural' | 'untitled_crater';

export type StageObstacleType = 'rock' | 'crystal' | 'flora' | 'mushroom' | 'tree';

export type StageObjectCategory =
  | 'player_spawn'
  | 'boss_spawn'
  | 'teleporter'
  | 'world_event'
  | 'pod'
  | 'obstacle'
  | 'enemy_region';

export interface StageSpawnPointConfig {
  id: string;
  name: string;
  x: number;
  y: number;
  zOffset?: number;
  rotationY?: number;
  enabled: boolean;
}

export interface StageTeleporterConfig {
  id: string;
  name: string;
  x: number;
  y: number;
  zOffset?: number;
  rotationY?: number;
  scale?: number;
  radius: number;
  chargePerKill?: number;
  enabled: boolean;
}

export interface StageWorldEventConfig {
  id: string;
  type: WorldEventType;
  name: string;
  description: string;
  x: number;
  y: number;
  zOffset?: number;
  rotationY?: number;
  scale?: number;
  radius: number;
  enabled: boolean;
}

export interface StagePodConfig {
  id: string;
  name: string;
  x: number;
  y: number;
  zOffset?: number;
  rotationY?: number;
  scale?: number;
  cost: number;
  radius: number;
  enabled: boolean;
}

export interface StageObstacleConfig {
  id: string;
  name: string;
  type: StageObstacleType;
  subtype?: string;
  variant?: number;
  x: number;
  y: number;
  zOffset?: number;
  rotationY?: number;
  scaleVar: number;
  radius: number;
  enabled: boolean;
  /** Optional placement rule tag (e.g. 'water' for shoreline/water-adjacent items) */
  placementRule?: 'terrain' | 'water' | 'free';
}

export interface StageEnemySpawnRegionConfig {
  id: string;
  name: string;
  shape: 'circle' | 'rect';
  x: number;
  y: number;
  zOffset?: number;
  radius: number;
  width: number;
  height: number;
  allowedTypes: EnemyType[];
  spawnDensity: number;
  maxActiveEnemies: number;
  minPlayerDistance: number;
  terrainRestriction: 'any' | 'walkable' | 'near_water';
  minElevation: number;
  maxElevation: number;
  enabled: boolean;
}

export interface StageEnvironmentConfig {
  stageName: string;
  terrainAsset?: string;
  waterLevel?: number;
  fogColor?: string;
  fogDensity?: number;
  ambientColor?: string;
  ambientIntensity?: number;
  sunColor?: string;
  sunIntensity?: number;
  audioTheme?: string;
  narrativeTriggersEnabled?: boolean;
}

export interface StageLayoutProfile {
  terrainSeed: number;
  environment: StageEnvironmentConfig;
  playerSpawn: StageSpawnPointConfig;
  bossSpawn: StageSpawnPointConfig;
  teleporter: StageTeleporterConfig;
  worldEvents: StageWorldEventConfig[];
  pods: StagePodConfig[];
  obstacles: StageObstacleConfig[];
  enemySpawnRegions: StageEnemySpawnRegionConfig[];
}

export interface StageConfig {
  schemaVersion: 1;
  stageId: string;
  stageNumber: number;
  stageName: string;
  updatedAt?: string;
  profiles: Record<string, StageLayoutProfile>;
}

export interface StageValidationIssue {
  severity: 'error' | 'warning';
  objectId?: string;
  objectName?: string;
  category?: StageObjectCategory;
  message: string;
}

export interface StageSaveResponse {
  ok: boolean;
  path?: string;
  backupPath?: string | null;
  savedAt?: string;
  error?: string;
}

export function cloneStageConfig<T>(data: T): T {
  return JSON.parse(JSON.stringify(data));
}

export function validateStageProfile(
  profile: StageLayoutProfile,
  terrain?: TerrainSystem | null,
  worldWidth: number = 3600,
  worldHeight: number = 3600
): StageValidationIssue[] {
  const issues: StageValidationIssue[] = [];
  const checkCoords = (
    id: string,
    name: string,
    category: StageObjectCategory,
    x: number,
    y: number,
    margin: number = 25,
    requireWalkable: boolean = false,
    placementRule?: 'terrain' | 'water' | 'free'
  ) => {
    if (!Number.isFinite(x) || !Number.isFinite(y)) {
      issues.push({ severity: 'error', objectId: id, objectName: name, category, message: `${name} has non-finite coordinates.` });
      return;
    }
    if (x < margin || x > worldWidth - margin || y < margin || y > worldHeight - margin) {
      issues.push({
        severity: 'warning',
        objectId: id,
        objectName: name,
        category,
        message: `${name} (${Math.round(x)}, ${Math.round(y)}) is near/outside world boundary [${margin}..${worldWidth - margin}].`
      });
    }
    if (terrain) {
      const sample = terrain.getElevation(x, y);
      if (requireWalkable && (!sample.isWalkable || sample.surfaceType === 'chasm')) {
        issues.push({
          severity: 'warning',
          objectId: id,
          objectName: name,
          category,
          message: `${name} sits on unwalkable terrain (${sample.surfaceType}, z=${Math.round(sample.height)}).`
        });
      }
      if (requireWalkable && terrain.getSurfaceSlope(x, y, 16) > 0.75) {
        issues.push({
          severity: 'warning',
          objectId: id,
          objectName: name,
          category,
          message: `${name} is on a very steep slope (${terrain.getSurfaceSlope(x, y, 16).toFixed(2)}).`
        });
      }
      if (placementRule === 'water') {
        const isRiver = terrain.isCustomTestMap
          ? terrain.isPointNearWater(x, y)
          : sample.height <= 6.5;
        if (!isRiver) {
          issues.push({
            severity: 'warning',
            objectId: id,
            objectName: name,
            category,
            message: `${name} is a water-affiliated object placed away from water.`
          });
        }
      }
    }
  };

  if (!profile) {
    issues.push({ severity: 'error', message: 'Stage layout profile is missing.' });
    return issues;
  }

  if (!profile.playerSpawn || !profile.playerSpawn.enabled) {
    issues.push({ severity: 'error', objectId: 'player_spawn', objectName: 'Player Spawn', category: 'player_spawn', message: 'Player Spawn must exist and be enabled.' });
  } else {
    checkCoords('player_spawn', profile.playerSpawn.name, 'player_spawn', profile.playerSpawn.x, profile.playerSpawn.y, 40, true);
  }

  if (!profile.bossSpawn || !profile.bossSpawn.enabled) {
    issues.push({ severity: 'warning', objectId: 'boss_spawn', objectName: 'Stage Boss Spawn', category: 'boss_spawn', message: 'Stage Boss Spawn is disabled.' });
  } else {
    checkCoords('boss_spawn', profile.bossSpawn.name, 'boss_spawn', profile.bossSpawn.x, profile.bossSpawn.y, 40, false);
  }

  if (!profile.teleporter || !profile.teleporter.enabled) {
    issues.push({ severity: 'error', objectId: 'teleporter', objectName: 'Overseer Teleporter', category: 'teleporter', message: 'Teleporter must exist and be enabled.' });
  } else {
    checkCoords('teleporter', profile.teleporter.name, 'teleporter', profile.teleporter.x, profile.teleporter.y, 45, true);
  }

  const seenIds = new Set<string>();
  const registerId = (id: string, name: string, category: StageObjectCategory) => {
    if (!id || !id.trim()) {
      issues.push({ severity: 'error', objectId: id, objectName: name, category, message: `${name} is missing an id.` });
      return;
    }
    if (seenIds.has(id)) {
      issues.push({ severity: 'error', objectId: id, objectName: name, category, message: `Duplicate object id "${id}".` });
    }
    seenIds.add(id);
  };

  for (const ev of profile.worldEvents || []) {
    registerId(ev.id, ev.name, 'world_event');
    if (ev.enabled) {
      checkCoords(ev.id, ev.name, 'world_event', ev.x, ev.y, 45, true);
    }
  }

  for (const pod of profile.pods || []) {
    registerId(pod.id, pod.name || pod.id, 'pod');
    if (pod.enabled) {
      checkCoords(pod.id, pod.name || pod.id, 'pod', pod.x, pod.y, 40, true);
      if (!Number.isFinite(pod.cost) || pod.cost < 0) {
        issues.push({ severity: 'error', objectId: pod.id, objectName: pod.name || pod.id, category: 'pod', message: `Pod "${pod.id}" has invalid cost.` });
      }
    }
  }

  for (const obs of profile.obstacles || []) {
    registerId(obs.id, obs.name || obs.id, 'obstacle');
    if (obs.enabled) {
      checkCoords(obs.id, obs.name || obs.id, 'obstacle', obs.x, obs.y, 20, false, obs.placementRule);
      if (!Number.isFinite(obs.scaleVar) || obs.scaleVar <= 0) {
        issues.push({ severity: 'error', objectId: obs.id, objectName: obs.name || obs.id, category: 'obstacle', message: `Obstacle "${obs.id}" scale must be > 0.` });
      }
      // Check accidental overlap with Player Spawn
      if (profile.playerSpawn && !obs.id.startsWith('ship_') && !obs.id.startsWith('test_ship_')) {
        const dSpawn = Math.hypot(obs.x - profile.playerSpawn.x, obs.y - profile.playerSpawn.y);
        if (dSpawn < obs.radius + 26) {
          issues.push({
            severity: 'warning',
            objectId: obs.id,
            objectName: obs.name || obs.id,
            category: 'obstacle',
            message: `${obs.name || obs.id} overlaps Player Spawn (${Math.round(dSpawn)}u away).`
          });
        }
      }
    }
  }

  for (const reg of profile.enemySpawnRegions || []) {
    registerId(reg.id, reg.name, 'enemy_region');
    if (reg.enabled) {
      checkCoords(reg.id, reg.name, 'enemy_region', reg.x, reg.y, 0, false);
      if (reg.allowedTypes.length === 0) {
        issues.push({ severity: 'warning', objectId: reg.id, objectName: reg.name, category: 'enemy_region', message: `Region "${reg.name}" has no allowed enemy types.` });
      }
      if (reg.minElevation > reg.maxElevation) {
        issues.push({ severity: 'error', objectId: reg.id, objectName: reg.name, category: 'enemy_region', message: `Region "${reg.name}" minElevation > maxElevation.` });
      }
    }
  }

  return issues;
}

export function validateStageConfig(config: StageConfig, terrain?: TerrainSystem | null): StageValidationIssue[] {
  const issues: StageValidationIssue[] = [];
  if (!config || config.schemaVersion !== 1) {
    issues.push({ severity: 'error', message: 'Invalid or missing StageConfig schemaVersion.' });
    return issues;
  }
  const active = config.profiles?.procedural;
  if (!active) {
    issues.push({ severity: 'error', message: 'Missing "procedural" profile in StageConfig.' });
    return issues;
  }
  issues.push(...validateStageProfile(active, terrain));
  return issues;
}

export async function loadStageConfigFromServer(stageId: string = 'stage1'): Promise<StageConfig | null> {
  try {
    const devUrl = `/__dev/stage-config/load?stageId=${encodeURIComponent(stageId)}`;
    if (import.meta.env.DEV) {
      const res = await fetch(devUrl, { cache: 'no-store' });
      if (res.ok) {
        const json = await res.json();
        if (json?.ok && json.config) return json.config as StageConfig;
      }
    }
    const pubRes = await fetch(`/stages/${encodeURIComponent(stageId)}.config.json`, { cache: 'no-store' });
    if (pubRes.ok) {
      return (await pubRes.json()) as StageConfig;
    }
  } catch (err) {
    console.warn('[StageConfig] Failed to load stage config:', err);
  }
  return null;
}

export async function saveStageConfigToServer(stageId: string, config: StageConfig): Promise<StageSaveResponse> {
  if (!import.meta.env.DEV) {
    return { ok: false, error: 'Stage config saving is restricted to local development mode.' };
  }
  try {
    const res = await fetch('/__dev/stage-config/save', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ stageId, config })
    });
    const json = (await res.json()) as StageSaveResponse;
    if (!res.ok || !json.ok) {
      return { ok: false, error: json?.error || `Save failed (HTTP ${res.status}).` };
    }
    return json;
  } catch (err: any) {
    return { ok: false, error: err?.message || 'Network error while saving stage config.' };
  }
}

export function formatObstacleDisplayName(type: StageObstacleType, id: string, variant?: number): string {
  const vSuffix = variant !== undefined ? ` #${variant}` : '';
  if (id.startsWith('ship_') || id.startsWith('test_ship_')) return `Ship Collider (${id})`;
  switch (type) {
    case 'tree': return `Alien Tree${vSuffix} (${id})`;
    case 'crystal': return `Crystal Cluster${vSuffix} (${id})`;
    case 'rock': return `Alien Rock${vSuffix} (${id})`;
    case 'mushroom': return `Alien Mushroom${vSuffix} (${id})`;
    case 'flora': return `Alien Flora${vSuffix} (${id})`;
  }
}

export function clampWorldPos(pos: Vector2, pad: number = 20, worldW: number = 3600, worldH: number = 3600): Vector2 {
  return {
    x: Math.max(pad, Math.min(worldW - pad, pos.x)),
    y: Math.max(pad, Math.min(worldH - pad, pos.y))
  };
}

export interface StageCatalogItem {
  key: string;
  label: string;
  categoryLabel:
    | 'Spawns & Regions'
    | 'Events'
    | 'Biological Chests'
    | 'Trees & Vegetation'
    | 'Rocks & Crystals'
    | 'Water Objects';
  kind: 'obstacle' | 'pod' | 'world_event' | 'enemy_region' | 'singleton';
  obstacleType?: StageObstacleType;
  variant?: number;
  radius?: number;
  scaleVar?: number;
  placementRule?: 'terrain' | 'water' | 'free';
  podCost?: number;
  eventType?: WorldEventType;
  singletonCategory?: 'player_spawn' | 'teleporter' | 'boss_spawn';
  hint: string;
}

export const STAGE_OBJECT_CATALOG: StageCatalogItem[] = [
  { key: 'singleton_player_spawn', label: 'Player Spawn (Move/Select)', categoryLabel: 'Spawns & Regions', kind: 'singleton', singletonCategory: 'player_spawn', hint: 'Unique start spawn point for playable hero.' },
  { key: 'singleton_teleporter', label: 'Overseer Teleporter (Move/Select)', categoryLabel: 'Spawns & Regions', kind: 'singleton', singletonCategory: 'teleporter', hint: 'Primary Stage 1 objective teleporter.' },
  { key: 'singleton_boss_spawn', label: 'Stage Boss Spawn (Move/Select)', categoryLabel: 'Spawns & Regions', kind: 'singleton', singletonCategory: 'boss_spawn', hint: 'Emergence location for Stage 1 Colossus / Titan.' },
  { key: 'region_enemy_zone', label: 'Enemy Spawn Region', categoryLabel: 'Spawns & Regions', kind: 'enemy_region', hint: 'Configurable rectangular zone constraining enemy types, density, and elevation.' },

  { key: 'ev_primal', label: 'Primary Enhancement Totem', categoryLabel: 'Events', kind: 'world_event', eventType: 'primal_totem', hint: 'Primary attack (LMB) enhancement shrine event.' },
  { key: 'ev_secondary', label: 'Secondary Enhancement Totem', categoryLabel: 'Events', kind: 'world_event', eventType: 'secondary_totem', hint: 'Secondary skill (RMB) enhancement shrine event.' },
  { key: 'ev_dash', label: 'Mobility / Dash Totem', categoryLabel: 'Events', kind: 'world_event', eventType: 'dash_totem', hint: 'Utility / dash enhancement shrine event.' },
  { key: 'ev_orbital', label: 'Orbital Uplink Shrine', categoryLabel: 'Events', kind: 'world_event', eventType: 'orbital_uplink', hint: 'Ultimate skill (R) enhancement uplink encounter.' },

  { key: 'pod_standard', label: 'Biological Pod (25 Biomass)', categoryLabel: 'Biological Chests', kind: 'pod', podCost: 25, hint: 'Standard biological loot pod containing an item/upgrade.' },
  { key: 'pod_free', label: 'Biological Pod (Free)', categoryLabel: 'Biological Chests', kind: 'pod', podCost: 0, hint: 'Zero-cost early-stage starter biological pod.' },
  { key: 'pod_heavy', label: 'Biological Pod (45 Biomass)', categoryLabel: 'Biological Chests', kind: 'pod', podCost: 45, hint: 'Higher-cost risk/reward biological pod.' },

  { key: 'obs_tree_0', label: 'Alien Tree (Variant A)', categoryLabel: 'Trees & Vegetation', kind: 'obstacle', obstacleType: 'tree', variant: 0, radius: 26, scaleVar: 1.05, placementRule: 'terrain', hint: 'Canonical thawing alien tree.' },
  { key: 'obs_tree_1', label: 'Alien Tree (Variant B)', categoryLabel: 'Trees & Vegetation', kind: 'obstacle', obstacleType: 'tree', variant: 1, radius: 26, scaleVar: 1.15, placementRule: 'terrain', hint: 'Tall alien canopy variant.' },
  { key: 'obs_tree_2', label: 'Alien Tree (Variant C)', categoryLabel: 'Trees & Vegetation', kind: 'obstacle', obstacleType: 'tree', variant: 2, radius: 24, scaleVar: 0.95, placementRule: 'terrain', hint: 'Twisted alien flora tree.' },
  { key: 'obs_mushroom', label: 'Alien Mushroom Cluster', categoryLabel: 'Trees & Vegetation', kind: 'obstacle', obstacleType: 'mushroom', variant: 0, radius: 16, scaleVar: 1.0, placementRule: 'terrain', hint: 'Bioluminescent alien fungal cluster.' },
  { key: 'obs_flora', label: 'Thawing Alien Flora', categoryLabel: 'Trees & Vegetation', kind: 'obstacle', obstacleType: 'flora', variant: 0, radius: 12, scaleVar: 1.0, placementRule: 'terrain', hint: 'Low-profile cultivated biological ground flora.' },

  { key: 'obs_rock_0', label: 'Crater Boulder', categoryLabel: 'Rocks & Crystals', kind: 'obstacle', obstacleType: 'rock', variant: 0, radius: 28, scaleVar: 1.05, placementRule: 'terrain', hint: 'Exposed crater basalt boulder.' },
  { key: 'obs_rock_1', label: 'Frost-Veined Rock', categoryLabel: 'Rocks & Crystals', kind: 'obstacle', obstacleType: 'rock', variant: 1, radius: 24, scaleVar: 0.95, placementRule: 'terrain', hint: 'Smaller crater stone outcrop.' },
  { key: 'obs_crystal_0', label: 'Energy Crystal Shard', categoryLabel: 'Rocks & Crystals', kind: 'obstacle', obstacleType: 'crystal', variant: 0, radius: 22, scaleVar: 1.0, placementRule: 'terrain', hint: 'Resonant alien mineral crystal.' },
  { key: 'obs_crystal_1', label: 'Deep Crystal Cluster', categoryLabel: 'Rocks & Crystals', kind: 'obstacle', obstacleType: 'crystal', variant: 1, radius: 25, scaleVar: 1.2, placementRule: 'terrain', hint: 'Large faceted crystal spire.' },

  { key: 'water_flora', label: 'Riverbank Alien Flora (Water)', categoryLabel: 'Water Objects', kind: 'obstacle', obstacleType: 'flora', variant: 1, radius: 12, scaleVar: 1.05, placementRule: 'water', hint: 'Water-affiliated flora; validates against river/waterline placement.' },
  { key: 'water_crystal', label: 'Submerged Crystal (Water)', categoryLabel: 'Water Objects', kind: 'obstacle', obstacleType: 'crystal', variant: 2, radius: 22, scaleVar: 0.95, placementRule: 'water', hint: 'Aquatic crystal formation; validates near water surface.' }
];

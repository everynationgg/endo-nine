import { EnemyType } from './types';

export interface EnemyConfig {
  type: EnemyType;
  name: string;
  maxHealth: number;
  speed: number;
  touchDamage: number;
  attackRange: number;
  attackCooldown: number;
  currencyReward: number;
  xpReward: number;
  radius: number;
  isElite: boolean;
  isBoss?: boolean;
  canFireProjectiles: boolean;
}

/** Strict Stage 1 projectile permission allowlist (Main Boss Stage1Titan is handled independently). */
export const ENEMY_PROJECTILE_PERMISSIONS: Record<EnemyType, boolean> = {
  crawler: false,
  spitter: false,
  wasp: true,
  elite: true,
  boss: true
};

/** Centralized Stage 1 enemy attack cadence, windup, volley, and projectile fairness tuning. */
export const ENEMY_COMBAT_BALANCE = {
  // Configurable projectile-volley direct-hit grace period & accurate player hurt radius (2x entity scale)
  projectileHitGraceSec: 0.20,
  playerProjectileHurtRadius: 32,

  // Void Wasp (Flying — -30% attack frequency: 1.52s -> 2.17s ranged cycle)
  waspRangedCycleInterval: 2.17,
  waspRangedWindup: 0.30,
  waspProjectileSpeed: 420,
  waspProjectileRadius: 11,
  waspProjectileDamage: 11,

  // Void Goliath (Elite — -35% attack frequency: 1.275s -> 1.96s ranged cycle, 3 -> 1 shard)
  eliteRangedCycleInterval: 1.96,
  eliteRangedWindup: 0.60,
  eliteProjectileCount: 1,
  eliteProjectileSpeed: 295,
  eliteProjectileRadius: 16,
  eliteProjectileDamage: 17,

  // Brood Queen (Event Boss — -35% attack frequency: 0.89s -> 1.37s cycle, 3 -> 2 stingers)
  broodQueenCycleInterval: 1.37,
  broodQueenWindup: 0.80,
  broodQueenStingerAngles: [-0.38, 0.38] as readonly number[],
  broodQueenStingerSpeed: 375,
  broodQueenStingerRadius: 14,
  broodQueenStingerDamage: 12,
  broodQueenSporeBombDamage: 20,
  broodQueenSporeBombRadius: 22
};

export const ENEMY_CONFIGS: Record<EnemyType, EnemyConfig> = {
  crawler: {
    type: 'crawler',
    name: 'Void Crawler',
    maxHealth: 51,
    speed: 215,
    touchDamage: 11,
    attackRange: 52,
    attackCooldown: 1.31, // -20% attack frequency (was 1.05s)
    currencyReward: 2,
    xpReward: 2,
    radius: 42,
    isElite: false,
    canFireProjectiles: ENEMY_PROJECTILE_PERMISSIONS.crawler
  },
  spitter: {
    type: 'spitter',
    name: 'Toxic Spitter',
    maxHealth: 62,
    speed: 185,
    touchDamage: 9,
    attackRange: 56,      // Converted from ranged spit to close-range corrosive melee
    attackCooldown: 3.00, // -20% attack frequency (was 2.40s)
    currencyReward: 3,
    xpReward: 3,
    radius: 42,
    isElite: false,
    canFireProjectiles: ENEMY_PROJECTILE_PERMISSIONS.spitter
  },
  wasp: {
    type: 'wasp',
    name: 'Void Wasp',
    maxHealth: 43,
    speed: 245,
    touchDamage: 13,
    attackRange: 46,
    attackCooldown: 1.36, // -30% attack frequency (was 0.95s melee; ranged 2.17s)
    currencyReward: 3,
    xpReward: 3,
    radius: 34,
    isElite: false,
    canFireProjectiles: ENEMY_PROJECTILE_PERMISSIONS.wasp
  },
  elite: {
    type: 'elite',
    name: 'Void Goliath',
    maxHealth: 214,
    speed: 230,
    touchDamage: 25,
    attackRange: 64,
    attackCooldown: 1.31, // -35% attack frequency (was 0.85s melee; ranged 1.96s)
    currencyReward: 9,
    xpReward: 6,
    radius: 66,
    isElite: true,
    canFireProjectiles: ENEMY_PROJECTILE_PERMISSIONS.elite
  },
  boss: {
    type: 'boss',
    name: 'Brood Queen',
    maxHealth: 844,
    speed: 385,
    touchDamage: 26,
    attackRange: 380,
    attackCooldown: 1.37, // -35% attack frequency (was 0.89s)
    currencyReward: 30,
    xpReward: 25,
    radius: 100,
    isElite: true,
    isBoss: true,
    canFireProjectiles: ENEMY_PROJECTILE_PERMISSIONS.boss
  }
};

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
  elite: false,
  boss: true,
  broodling: false
};

/** Centralized Stage 1 enemy attack cadence, windup, volley, and creature skill parameters. */
export const ENEMY_COMBAT_BALANCE = {
  // Configurable projectile-volley direct-hit grace period & accurate player hurt radius (2x entity scale)
  projectileHitGraceSec: 0.20,
  playerProjectileHurtRadius: 32,

  // Oreblade (Small Melee — Spinning Charge)
  orebladeChargeTriggerMin: 48,
  orebladeChargeTriggerMax: 235,
  orebladePrepSec: 0.42,
  orebladeChargeSec: 0.46,
  orebladeRecoverSec: 0.45,
  orebladeChargeSpeedMult: 2.65,

  // Driftworm (Small Ranged Aquatic — Water Bubble Projectile)
  waspRangedCycleInterval: 2.17,
  waspRangedWindup: 0.30,
  waspProjectileSpeed: 420,
  waspProjectileRadius: 13,
  waspProjectileDamage: 11,
  driftwormRecoilSec: 0.32,

  // Slythven (Serpentine Toxic Area-Control — Dual Exhaust Fume Exhalation, 2x Scale)
  slythvenTriggerRange: 290,
  slythvenGasRadius: 350,
  slythvenPrepSec: 0.55,
  slythvenExhaleSec: 1.65,
  slythvenRecoverSec: 0.50,
  slythvenTickIntervalSec: 0.42,
  slythvenTickDamageMult: 0.55,

  // Magmir (Heavy Quadrupedal Bruiser — Ground Slam & Left/Right Heavy Punch, 2x Scale)
  magmirSlamTriggerRange: 340,
  magmirSlamRadius: 370,
  magmirSlamCooldownSec: 4.2,
  magmirSlamPrepSec: 0.62,
  magmirSlamRecoverSec: 0.76,
  magmirSlamDamageMult: 1.15,
  magmirPunchTriggerRange: 290,
  magmirPunchReach: 316,
  magmirPunchPrepSec: 0.48,
  magmirPunchRecoverSec: 0.60,

  // Void Goliath legacy fallback constants (kept for compatibility)
  eliteRangedCycleInterval: 1.96,
  eliteRangedWindup: 0.60,
  eliteProjectileCount: 1,
  eliteProjectileSpeed: 295,
  eliteProjectileRadius: 16,
  eliteProjectileDamage: 17,

  // Brood Queen (Flying Sovereign — Twin Bone Spikes & Sacrificial Brood, 1.5x Scale)
  broodQueenCycleInterval: 1.37,
  broodQueenWindup: 0.80,
  broodQueenStingerAngles: [-0.38, 0.38] as readonly number[],
  broodQueenStingerSpeed: 375,
  broodQueenStingerRadius: 21,
  broodQueenStingerDamage: 12,
  broodQueenSporeBombDamage: 20,
  broodQueenSporeBombRadius: 22,
  broodQueenSummonWindupSec: 0.78,
  broodQueenSummonRecoverSec: 0.42,
  broodQueenSummonCooldownSec: 5.5,
  broodQueenMaxActiveOffspring: 3,
  broodOffspringStabilizeSec: 0.55,
  broodOffspringChargeTriggerDist: 300,
  broodOffspringChargeSpeed: 355,
  broodOffspringMaxLifetimeSec: 9.0
};

export const ENEMY_CONFIGS: Record<EnemyType, EnemyConfig> = {
  crawler: {
    type: 'crawler',
    name: 'Oreblade',
    maxHealth: 51,
    speed: 215,
    touchDamage: 11,
    attackRange: 52,
    attackCooldown: 1.31,
    currencyReward: 2,
    xpReward: 2,
    radius: 42,
    isElite: false,
    canFireProjectiles: ENEMY_PROJECTILE_PERMISSIONS.crawler
  },
  spitter: {
    type: 'spitter',
    name: 'Slythven',
    maxHealth: 62,
    speed: 185,
    touchDamage: 9,
    attackRange: 290,
    attackCooldown: 3.00,
    currencyReward: 3,
    xpReward: 3,
    radius: 92,
    isElite: false,
    canFireProjectiles: ENEMY_PROJECTILE_PERMISSIONS.spitter
  },
  wasp: {
    type: 'wasp',
    name: 'Driftworm',
    maxHealth: 43,
    speed: 245,
    touchDamage: 13,
    attackRange: 340,
    attackCooldown: 1.36,
    currencyReward: 3,
    xpReward: 3,
    radius: 34,
    isElite: false,
    canFireProjectiles: ENEMY_PROJECTILE_PERMISSIONS.wasp
  },
  elite: {
    type: 'elite',
    name: 'Magmir',
    maxHealth: 214,
    speed: 230,
    touchDamage: 25,
    attackRange: 290,
    attackCooldown: 1.31,
    currencyReward: 9,
    xpReward: 6,
    radius: 132,
    isElite: true,
    canFireProjectiles: ENEMY_PROJECTILE_PERMISSIONS.elite
  },
  boss: {
    type: 'boss',
    name: 'Brood Queen',
    maxHealth: 844,
    speed: 385,
    touchDamage: 26,
    attackRange: 570,
    attackCooldown: 1.37,
    currencyReward: 30,
    xpReward: 25,
    radius: 150,
    isElite: true,
    isBoss: true,
    canFireProjectiles: ENEMY_PROJECTILE_PERMISSIONS.boss
  },
  broodling: {
    type: 'broodling',
    name: 'Sacrificial Brood',
    maxHealth: 26,
    speed: 265,
    touchDamage: 18,
    attackRange: 60,
    attackCooldown: 1.0,
    currencyReward: 0,
    xpReward: 0,
    radius: 36,
    isElite: false,
    canFireProjectiles: ENEMY_PROJECTILE_PERMISSIONS.broodling
  }
};

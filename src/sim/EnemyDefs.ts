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
}

export const ENEMY_CONFIGS: Record<EnemyType, EnemyConfig> = {
  crawler: {
    type: 'crawler',
    name: 'Void Crawler',
    maxHealth: 51,        // Balanced (-25% difficulty)
    speed: 130,
    touchDamage: 11,      // Balanced (-25% difficulty)
    attackRange: 28,
    attackCooldown: 1.05,
    currencyReward: 2,
    xpReward: 2,
    radius: 22,
    isElite: false
  },
  spitter: {
    type: 'spitter',
    name: 'Toxic Spitter',
    maxHealth: 62,        // Balanced (-25% difficulty)
    speed: 100,
    touchDamage: 9,       // Balanced (-25% difficulty)
    attackRange: 350,
    attackCooldown: 2.4,
    currencyReward: 3,
    xpReward: 3,
    radius: 22,
    isElite: false
  },
  wasp: {
    type: 'wasp',
    name: 'Void Wasp',
    maxHealth: 43,        // Balanced (-25% difficulty)
    speed: 148,
    touchDamage: 13,      // Balanced (-25% difficulty)
    attackRange: 24,
    attackCooldown: 0.95,
    currencyReward: 3,
    xpReward: 3,
    radius: 18,
    isElite: false
  },
  elite: {
    type: 'elite',
    name: 'Void Goliath',
    maxHealth: 214,       // Balanced (-25% difficulty)
    speed: 140,
    touchDamage: 25,      // Balanced (-25% difficulty)
    attackRange: 32,
    attackCooldown: 0.85,
    currencyReward: 9,
    xpReward: 6,
    radius: 34,
    isElite: true
  },
  boss: {
    type: 'boss',
    name: 'Brood Queen',
    maxHealth: 844,       // Balanced (-25% difficulty)
    speed: 246.04,        // +35% more aerial flying speed (was 182.25)
    touchDamage: 26,      // Balanced swoop contact damage
    attackRange: 320,     // Aerial dive & stinger range
    attackCooldown: 0.89, // +35% more attack speed (was 1.2)
    currencyReward: 30,
    xpReward: 25,
    radius: 52,
    isElite: true,
    isBoss: true
  }
};

export interface DifficultyTierDef {
  tier: number;
  name: string;
  color: string;
  glowColor: string;
  minTime: number;
  maxTime: number;
  threatMultiplier: number;
  hpMultiplier: number;
  damageMultiplier: number;
  speedMultiplier: number;
  spawnIntervalMultiplier: number;
  batchBonus: number;
  eliteChance: number;
  description: string;
}

export const DIFFICULTY_TIERS: DifficultyTierDef[] = [
  {
    tier: 0,
    name: 'VERY EASY',
    color: '#22c55e',
    glowColor: 'rgba(34, 197, 94, 0.4)',
    minTime: 0,
    maxTime: 60,
    threatMultiplier: 1.0,
    hpMultiplier: 1.0,
    damageMultiplier: 1.0,
    speedMultiplier: 1.0,
    spawnIntervalMultiplier: 1.0,
    batchBonus: 0,
    eliteChance: 0.06,
    description: 'Minimal alien hostility. Scout crawlers probing perimeter.'
  },
  {
    tier: 1,
    name: 'EASY',
    color: '#84cc16',
    glowColor: 'rgba(132, 204, 22, 0.45)',
    minTime: 60,
    maxTime: 130,
    threatMultiplier: 1.22,
    hpMultiplier: 1.18,
    damageMultiplier: 1.11,
    speedMultiplier: 1.03,
    spawnIntervalMultiplier: 0.92,
    batchBonus: 0,
    eliteChance: 0.12,
    description: 'Xenomorph broods aggregating. Wasps & Spitters deployed.'
  },
  {
    tier: 2,
    name: 'MEDIUM',
    color: '#eab308',
    glowColor: 'rgba(234, 179, 8, 0.5)',
    minTime: 130,
    maxTime: 220,
    threatMultiplier: 1.5,
    hpMultiplier: 1.40,
    damageMultiplier: 1.25,
    speedMultiplier: 1.07,
    spawnIntervalMultiplier: 0.82,
    batchBonus: 1,
    eliteChance: 0.22,
    description: 'Hive alert triggered. Aggressive pack formations moving in.'
  },
  {
    tier: 3,
    name: 'HARD',
    color: '#f97316',
    glowColor: 'rgba(249, 115, 22, 0.6)',
    minTime: 220,
    maxTime: 330,
    threatMultiplier: 1.9,
    hpMultiplier: 1.70,
    damageMultiplier: 1.45,
    speedMultiplier: 1.12,
    spawnIntervalMultiplier: 0.72,
    batchBonus: 1,
    eliteChance: 0.35,
    description: 'STAGE HARD: Void Goliaths leading assaults. Extreme vigilance required!'
  },
  {
    tier: 4,
    name: 'VERY HARD',
    color: '#ef4444',
    glowColor: 'rgba(239, 68, 68, 0.7)',
    minTime: 330,
    maxTime: 470,
    threatMultiplier: 2.4,
    hpMultiplier: 2.05,
    damageMultiplier: 1.65,
    speedMultiplier: 1.16,
    spawnIntervalMultiplier: 0.62,
    batchBonus: 2,
    eliteChance: 0.48,
    description: 'Heavy xenomorph offensive. Continuous armored reinforcements.'
  },
  {
    tier: 5,
    name: 'INSANE',
    color: '#dc2626',
    glowColor: 'rgba(220, 38, 38, 0.8)',
    minTime: 470,
    maxTime: 630,
    threatMultiplier: 3.1,
    hpMultiplier: 2.55,
    damageMultiplier: 1.95,
    speedMultiplier: 1.21,
    spawnIntervalMultiplier: 0.55,
    batchBonus: 2,
    eliteChance: 0.60,
    description: 'Unrelenting swarm onslaught. Sub-surface overseers active.'
  },
  {
    tier: 6,
    name: 'IMPOSSIBLE',
    color: '#c026d3',
    glowColor: 'rgba(192, 38, 211, 0.85)',
    minTime: 630,
    maxTime: 820,
    threatMultiplier: 4.0,
    hpMultiplier: 3.25,
    damageMultiplier: 2.35,
    speedMultiplier: 1.26,
    spawnIntervalMultiplier: 0.48,
    batchBonus: 3,
    eliteChance: 0.70,
    description: 'Planetary resonance overload. Fatal biological concentrations.'
  },
  {
    tier: 7,
    name: 'I SEE YOU',
    color: '#9333ea',
    glowColor: 'rgba(147, 51, 234, 0.9)',
    minTime: 820,
    maxTime: 1050,
    threatMultiplier: 5.3,
    hpMultiplier: 4.15,
    damageMultiplier: 2.85,
    speedMultiplier: 1.30,
    spawnIntervalMultiplier: 0.42,
    batchBonus: 3,
    eliteChance: 0.80,
    description: 'The Brood Overseer has locked onto your neural signature.'
  },
  {
    tier: 8,
    name: 'HAHAHA...',
    color: '#ec4899',
    glowColor: 'rgba(236, 72, 153, 0.95)',
    minTime: 1050,
    maxTime: Infinity,
    threatMultiplier: 7.0,
    hpMultiplier: 5.5,
    damageMultiplier: 3.60,
    speedMultiplier: 1.35,
    spawnIntervalMultiplier: 0.36,
    batchBonus: 3,
    eliteChance: 0.90,
    description: 'SURVIVAL PROBABILITY ZERO. WELCOME TO PERMAFROST OBLIVION.'
  }
];

export function getDifficultyTier(gameTime: number): {
  tierDef: DifficultyTierDef;
  tierIndex: number;
  progressInTier: number;
  nextTierDef: DifficultyTierDef | null;
} {
  const safeTime = Number.isFinite(gameTime) && gameTime >= 0 ? gameTime : 0;
  for (let i = 0; i < DIFFICULTY_TIERS.length; i++) {
    const t = DIFFICULTY_TIERS[i];
    if (safeTime >= t.minTime && safeTime < t.maxTime) {
      const dur = t.maxTime - t.minTime;
      const prog = dur > 0 ? (safeTime - t.minTime) / dur : 1.0;
      const nextTierDef = i < DIFFICULTY_TIERS.length - 1 ? DIFFICULTY_TIERS[i + 1] : null;
      return {
        tierDef: t,
        tierIndex: i,
        progressInTier: Math.min(1.0, Math.max(0, prog)),
        nextTierDef
      };
    }
  }
  const last = DIFFICULTY_TIERS[DIFFICULTY_TIERS.length - 1];
  return {
    tierDef: last,
    tierIndex: DIFFICULTY_TIERS.length - 1,
    progressInTier: 1.0,
    nextTierDef: null
  };
}


import { ItemDef, ItemId, BuffDef, BuffId, CalculatedStats, ExclusiveEventPool, HeroId, PlayerState, ActiveTimedEffect, TimedEffectId } from './types';

export interface LootSystemConfig {
  normalEnemyItemDropChance: number; // 0.01 (1%) for normal enemies as requested
  eliteEnemyItemDropChance: number;  // 0.12 (12%) for elite enemies
  bossEnemyItemDropChance: number;   // 1.00 (100%) for bosses
  basePickupRadius: number;
  maxCurrencyObjects: number;
}

export const LOOT_CONFIG: LootSystemConfig = {
  normalEnemyItemDropChance: 0.01,
  eliteEnemyItemDropChance: 0.12,
  bossEnemyItemDropChance: 1.0,
  basePickupRadius: 250,
  maxCurrencyObjects: 65
};

/** Configurable progressive rarity weighting for Additional Jump stacks after the free pickup */
export const AERIAL_BOOST_WEIGHT_CONFIG = {
  baseWeight: 5,
  decayFactor: 0.5,
  minWeight: 0.01
};

/**
 * Configurable global stack caps for +1 Projectile buffs (null = no unapproved global cap;
 * character/augment-specific caps like 7 Drones & 5 Fragmentation Bombs remain enforced).
 */
export const PROJECTILE_STACK_CONFIG = {
  maxExtraLmbStacks: null as number | null,
  maxExtraRmbStacks: null as number | null
};

/** Soft-pity scaling for +1 LMB / +1 RMB Projectile buffs on chest selection and enemy drops */
export const PROJECTILE_PITY_CONFIG = {
  baseWeight: 100,
  threshold: 8,
  incrementPerBuff: 35,
  maxWeight: 450
};

/** Explicit configuration of Special rarity weights and approved Special buffs */
export const BUFF_RARITY_CONFIG = {
  ordinaryWeight: 100,
  specialWeight: 10,
  projectileWeight: PROJECTILE_PITY_CONFIG.baseWeight,
  approvedSpecialBuffIds: new Set<BuffId>([
    // Explicitly approved Special buffs may be added here cleanly without editing BUFF_REGISTRY
  ])
};

/**
 * Deterministic Seeded Random (Mulberry32) for loot tables and buff choices
 */
export class SeededRandom {
  private state: number;

  constructor(seed: number = 133799) {
    this.state = seed >>> 0;
  }

  public next(): number {
    let t = (this.state += 0x6d2b79f5);
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  }

  public range(min: number, max: number): number {
    return min + this.next() * (max - min);
  }
}

export const ITEM_OVERDRIVE: ItemDef = {
  id: 'overdrive',
  name: 'Overdrive Motor',
  description: '+20% Attack Speed per stack. Accelerates weapon cooldowns.',
  icon: '/assets/attack_speed.png',
  tier: 'common',
  weight: 50,
  applyStack: (stats: CalculatedStats, count: number) => {
    stats.attackSpeedMultiplier += count * 0.20;
  }
};

export const ITEM_VITAL_CORE: ItemDef = {
  id: 'vital_core',
  name: 'Vital Core',
  description: '+35 Max HP & +1.5 HP/s Bio-Regeneration per stack.',
  icon: '/assets/health.png',
  tier: 'common',
  weight: 45,
  applyStack: (stats: CalculatedStats, count: number) => {
    stats.maxHealth += count * 35;
    stats.healthRegen += count * 1.5;
    stats.healingMultiplier += count * 0.15;
  }
};

export const ITEM_CHAIN_SPARK: ItemDef = {
  id: 'chain_spark',
  name: 'Chain Spark',
  description: '+15% chance to arc chain lightning dealing 30 damage to 2 nearby enemies.',
  icon: '/assets/item_chain_spark.png',
  tier: 'rare',
  weight: 25,
  applyStack: (stats: CalculatedStats, count: number) => {
    stats.chainSparkChance = Math.min(0.75, stats.chainSparkChance + count * 0.15);
    stats.chainSparkDamage += count * 15;
  }
};

export const ITEM_REGISTRY: Record<ItemId, ItemDef> = {
  overdrive: ITEM_OVERDRIVE,
  vital_core: ITEM_VITAL_CORE,
  chain_spark: ITEM_CHAIN_SPARK
};

export const ALL_ITEM_IDS: ItemId[] = ['overdrive', 'vital_core', 'chain_spark'];

export function rollWeightedPassiveItem(rng: SeededRandom): ItemId {
  const totalWeight = ALL_ITEM_IDS.reduce((acc, id) => acc + ITEM_REGISTRY[id].weight, 0);
  let roll = rng.range(0, totalWeight);
  for (const id of ALL_ITEM_IDS) {
    roll -= ITEM_REGISTRY[id].weight;
    if (roll <= 0) return id;
  }
  return 'overdrive';
}

/**
 * 40-Choice Roguelike Augmentation Pool:
 * Offense, Defense, Elemental Procs, Autonomous Drones, and Skill Replacements!
 */
export const BUFF_REGISTRY: Record<BuffId, BuffDef> = {
  // --- EXCLUSIVE EVENT: BASIC SKILL ENHANCEMENTS (Primal Totem) ---
  // --- EXCLUSIVE EVENT 1: BASIC ATTACK (LMB) ENHANCEMENTS (Ancient Bio-Resonance Totem) ---
  buff_chill_beam: {
    id: 'buff_chill_beam',
    name: 'Basic Attack — Chill Beam',
    category: '★ BASIC ATTACK ENHANCEMENT',
    description: 'Changes to a blue beam that applies Chill, slowing enemies.',
    icon: '/assets/cooldown_reduction.png',
    accentColor: '#38bdf8',
    enhancesSkillSlot: 'primary',
    enhancementId: 'chill_beam',
    exclusiveEvent: 'basic_skill_totem',
    heroFilter: 'commander',
    applyStack: () => {}
  },
  buff_piercing_laser: {
    id: 'buff_piercing_laser',
    name: 'Basic Attack — Piercing Laser',
    category: '★ BASIC ATTACK ENHANCEMENT',
    description: 'Fires a violet laser that pierces through enemies, applying Electrified (takes increased damage from all sources).',
    icon: '/assets/critical_damage.png',
    accentColor: '#c084fc',
    enhancesSkillSlot: 'primary',
    enhancementId: 'piercing_laser',
    exclusiveEvent: 'basic_skill_totem',
    heroFilter: 'commander',
    applyStack: () => {}
  },
  buff_extended_slash: {
    id: 'buff_extended_slash',
    name: 'Basic Attack — Extended Slash',
    category: '★ BASIC ATTACK ENHANCEMENT',
    description: 'Changes to a forward sword slash combo with longer reach.',
    icon: '/assets/attack_power.png',
    accentColor: '#f59e0b',
    enhancesSkillSlot: 'primary',
    enhancementId: 'extended_slash',
    exclusiveEvent: 'basic_skill_totem',
    heroFilter: 'commander',
    applyStack: () => {}
  },

  // --- EXCLUSIVE EVENT 2: SECONDARY ATTACK (RMB) ENHANCEMENTS (Kinetic Blade Conduit) ---
  buff_scissor_slash: {
    id: 'buff_scissor_slash',
    name: 'Secondary Attack — Scissor Slash',
    category: '★ SECONDARY ENHANCEMENT',
    description: 'Unleashes massive blade arcs from both sides that converge in front, dealing high damage in a large close-range AOE.',
    icon: '/assets/rally_command.png',
    accentColor: '#f59e0b',
    enhancesSkillSlot: 'secondary',
    enhancementId: 'scissor_slash',
    exclusiveEvent: 'secondary_skill_totem',
    heroFilter: 'commander',
    applyStack: () => {}
  },
  buff_frost_burst: {
    id: 'buff_frost_burst',
    name: 'Secondary Attack — Frost Burst',
    category: '★ SECONDARY ENHANCEMENT',
    description: 'Slashes in all four directions (front, back, left, right), dealing Ice damage and applying Chill to enemies.',
    icon: '/assets/defensive_protocol.png',
    accentColor: '#00e5ff',
    enhancesSkillSlot: 'secondary',
    enhancementId: 'frost_burst',
    exclusiveEvent: 'secondary_skill_totem',
    heroFilter: 'commander',
    applyStack: () => {}
  },
  buff_orbiting_blade: {
    id: 'buff_orbiting_blade',
    name: 'Secondary Attack — Orbiting Electric Swords',
    category: '★ SECONDARY ENHANCEMENT',
    description: 'Summons persistent crackling energy swords in a full 360° orbit around Commander. Each sword independently strikes the nearest enemy in its orbital path, dealing continuous Lightning damage and inflicting Electrified (Capped at 7 swords with +Projectiles).',
    icon: '/assets/item_vital_core.png',
    accentColor: '#a855f7',
    enhancesSkillSlot: 'secondary',
    enhancementId: 'orbiting_blade',
    exclusiveEvent: 'secondary_skill_totem',
    heroFilter: 'commander',
    applyStack: () => {}
  },

  // --- EXCLUSIVE EVENT 3: DASH (UTILITY) ENHANCEMENTS (Phase Thruster Pylon) ---
  // Universal Augment 1 across all existing & future survivors: Extended Dash
  buff_extended_dash: {
    id: 'buff_extended_dash',
    name: 'Dash — Extended Dash',
    category: '★ DASH AUGMENT 1 (UNIVERSAL)',
    description: 'Universal augment. Doubles the character\'s dash distance.',
    icon: '/assets/doctor/icon_extended_dash.png',
    accentColor: '#38bdf8',
    enhancesSkillSlot: 'utility',
    enhancementId: 'extended_dash',
    exclusiveEvent: 'dash_skill_totem',
    applyStack: () => {}
  },
  buff_shock_dash: {
    id: 'buff_shock_dash',
    name: 'Dash — Shock Dash',
    category: '★ DASH ENHANCEMENT',
    description: 'Dashes forward and creates a shockwave at the first enemy hit, dealing area damage and knockback.',
    icon: '/assets/combat_dash.png',
    accentColor: '#f59e0b',
    enhancesSkillSlot: 'utility',
    enhancementId: 'shock_dash',
    exclusiveEvent: 'dash_skill_totem',
    heroFilter: 'commander',
    applyStack: () => {}
  },
  buff_teleport: {
    id: 'buff_teleport',
    name: 'Dash — Teleport',
    category: '★ DASH ENHANCEMENT',
    description: 'Replaces Dash with a short-range teleport, instantly relocating to the target position.',
    icon: '/assets/armor.png',
    accentColor: '#c084fc',
    enhancesSkillSlot: 'utility',
    enhancementId: 'teleport',
    exclusiveEvent: 'dash_skill_totem',
    heroFilter: 'commander',
    applyStack: () => {}
  },

  // --- EXCLUSIVE EVENT 4: ULTIMATE ENHANCEMENTS (Celestial Uplink Conduit) ---
  buff_singularity: {
    id: 'buff_singularity',
    name: 'Ultimate — Singularity',
    category: '★ ULTIMATE ENHANCEMENT',
    description: 'Forms a massive Black Hole pulling enemies inward for 3.0s before collapsing in a void explosion.',
    icon: '/assets/overseer_artifact.png',
    accentColor: '#a855f7',
    enhancesSkillSlot: 'ultimate',
    enhancementId: 'singularity',
    exclusiveEvent: 'ultimate_beacon',
    heroFilter: 'commander',
    applyStack: () => {}
  },
  buff_convergence_barrage: {
    id: 'buff_convergence_barrage',
    name: 'Ultimate — Five-Strike Convergence',
    category: '★ ULTIMATE ENHANCEMENT',
    description: 'Calls five simultaneous orbital beams, spiraling impact energy inward into a concentrated core detonation.',
    icon: '/assets/tactical_strike.png',
    accentColor: '#fbbf24',
    enhancesSkillSlot: 'ultimate',
    enhancementId: 'convergence_barrage',
    exclusiveEvent: 'ultimate_beacon',
    heroFilter: 'commander',
    applyStack: () => {}
  },
  buff_cryogenic_impact: {
    id: 'buff_cryogenic_impact',
    name: 'Ultimate — Cryogenic Impact',
    category: '★ ULTIMATE ENHANCEMENT',
    description: 'Expands a large crystalline freezing field for 4.0s that Freezes enemies and deals cryogenic damage over time.',
    icon: '/assets/cooldown_reduction.png',
    accentColor: '#38bdf8',
    enhancesSkillSlot: 'ultimate',
    enhancementId: 'cryogenic_impact',
    exclusiveEvent: 'ultimate_beacon',
    heroFilter: 'commander',
    applyStack: () => {}
  },

  // --- DOCTOR EXCLUSIVE AUGMENTS (12 Augments across LMB, RMB, Dash [Universal Extended Dash + 2 Doctor], Ult) ---
  buff_toxic_chain: {
    id: 'buff_toxic_chain',
    name: 'LMB — Toxic Chain',
    category: '★ DOCTOR LMB AUGMENT 1',
    description: 'Shots ricochet between nearby enemies applying poison stacks. Reaching 3 stacks triggers a toxic explosion consuming the stacks.',
    icon: '/assets/doctor/icon_toxic_chain.png',
    accentColor: '#4ade80',
    enhancesSkillSlot: 'primary',
    enhancementId: 'toxic_chain',
    exclusiveEvent: 'basic_skill_totem',
    heroFilter: 'doctor',
    applyStack: () => {}
  },
  buff_cryogenic_scalpel: {
    id: 'buff_cryogenic_scalpel',
    name: 'LMB — Cryogenic Scalpel',
    category: '★ DOCTOR LMB AUGMENT 2',
    description: 'Hurls spinning icy surgical scalpels that return to Doctor, leaving 3s terrain frost trails that chill and slow enemies.',
    icon: '/assets/doctor/icon_cryo_scalpel.png',
    accentColor: '#38bdf8',
    enhancesSkillSlot: 'primary',
    enhancementId: 'cryogenic_scalpel',
    exclusiveEvent: 'basic_skill_totem',
    heroFilter: 'doctor',
    applyStack: () => {}
  },
  buff_vital_extraction: {
    id: 'buff_vital_extraction',
    name: 'LMB — Vital Extraction',
    category: '★ DOCTOR LMB AUGMENT 3',
    description: 'Replaces pistols with continuous green medical extraction tethers (3 base, +1 per Projectile) that drain enemy HP and heal Doctor.',
    icon: '/assets/doctor/icon_vital_extraction.png',
    accentColor: '#34d399',
    enhancesSkillSlot: 'primary',
    enhancementId: 'vital_extraction',
    exclusiveEvent: 'basic_skill_totem',
    heroFilter: 'doctor',
    applyStack: () => {}
  },
  buff_experimental_drones: {
    id: 'buff_experimental_drones',
    name: 'RMB — Experimental Drones',
    category: '★ DOCTOR RMB AUGMENT 1',
    description: 'Summons autonomous invincible medical-combat drones (1 base, +1 per Projectile up to 7) that orbit and attack enemies independently.',
    icon: '/assets/doctor/icon_experimental_drones.png',
    accentColor: '#34d399',
    enhancesSkillSlot: 'secondary',
    enhancementId: 'experimental_drones',
    exclusiveEvent: 'secondary_skill_totem',
    heroFilter: 'doctor',
    applyStack: () => {}
  },
  buff_toxic_cluster_bomb: {
    id: 'buff_toxic_cluster_bomb',
    name: 'RMB — Toxic Cluster Bomb',
    category: '★ DOCTOR RMB AUGMENT 2',
    description: 'Launches heavy cluster bombs (1 base, +1 per Projectile up to 5) that burst into scattering sub-bombs and toxic puddles.',
    icon: '/assets/doctor/icon_toxic_cluster.png',
    accentColor: '#84cc16',
    enhancesSkillSlot: 'secondary',
    enhancementId: 'toxic_cluster_bomb',
    exclusiveEvent: 'secondary_skill_totem',
    heroFilter: 'doctor',
    applyStack: () => {}
  },
  buff_holographic_decoy: {
    id: 'buff_holographic_decoy',
    name: 'RMB — Holographic Decoy',
    category: '★ DOCTOR RMB AUGMENT 3',
    description: 'Projects flickering green Doctor holograms (+1 per Projectile) that draw enemy aggro and detonate into toxic goo when destroyed or expired.',
    icon: '/assets/doctor/icon_holo_decoy.png',
    accentColor: '#2dd4bf',
    enhancesSkillSlot: 'secondary',
    enhancementId: 'holographic_decoy',
    exclusiveEvent: 'secondary_skill_totem',
    heroFilter: 'doctor',
    applyStack: () => {}
  },
  buff_phase_barrier: {
    id: 'buff_phase_barrier',
    name: 'Dash — Phase Barrier',
    category: '★ DOCTOR DASH AUGMENT 2',
    description: 'Gain complete damage immunity during the dash, persisting in a protective energy barrier for 1.0 second after the dash ends.',
    icon: '/assets/doctor/icon_phase_barrier.png',
    accentColor: '#22d3ee',
    enhancesSkillSlot: 'utility',
    enhancementId: 'phase_barrier',
    exclusiveEvent: 'dash_skill_totem',
    heroFilter: 'doctor',
    applyStack: () => {}
  },
  buff_adrenaline_rush: {
    id: 'buff_adrenaline_rush',
    name: 'Dash — Adrenaline Rush',
    category: '★ DOCTOR DASH AUGMENT 3',
    description: 'After dashing, gain a +50% movement speed burst for 1.5 seconds for rapid repositioning.',
    icon: '/assets/doctor/icon_adrenaline_rush.png',
    accentColor: '#4ade80',
    enhancesSkillSlot: 'utility',
    enhancementId: 'adrenaline_rush',
    exclusiveEvent: 'dash_skill_totem',
    heroFilter: 'doctor',
    applyStack: () => {}
  },
  buff_mobile_sanctuary: {
    id: 'buff_mobile_sanctuary',
    name: 'Ultimate — Mobile Sanctuary',
    category: '★ DOCTOR ULTIMATE AUGMENT 1',
    description: 'Transforms Sacred Medical Field into a single giant rapidly rotating luminous cross that moves continuously with Doctor for 5s.',
    icon: '/assets/doctor/icon_mobile_sanctuary.png',
    accentColor: '#34d399',
    enhancesSkillSlot: 'ultimate',
    enhancementId: 'mobile_sanctuary',
    exclusiveEvent: 'ultimate_beacon',
    heroFilter: 'doctor',
    applyStack: () => {}
  },
  buff_divine_intervention: {
    id: 'buff_divine_intervention',
    name: 'Ultimate — Divine Intervention',
    category: '★ DOCTOR ULTIMATE AUGMENT 2',
    description: 'Summons a 3s holy cross and four invincible winged angelic Doctor projections between its arms that battle enemies for 10 seconds.',
    icon: '/assets/doctor/icon_divine_intervention.png',
    accentColor: '#fde047',
    enhancesSkillSlot: 'ultimate',
    enhancementId: 'divine_intervention',
    exclusiveEvent: 'ultimate_beacon',
    heroFilter: 'doctor',
    applyStack: () => {}
  },
  buff_rain_of_crosses: {
    id: 'buff_rain_of_crosses',
    name: 'Ultimate — Rain of Crosses',
    category: '★ DOCTOR ULTIMATE AUGMENT 3',
    description: 'For 5s, sacred crosses randomly rain down from above (+Projectiles increases wave count), leaving buffing & burning ground fields until the barrage ends.',
    icon: '/assets/doctor/icon_rain_of_crosses.png',
    accentColor: '#4ade80',
    enhancesSkillSlot: 'ultimate',
    enhancementId: 'rain_of_crosses',
    exclusiveEvent: 'ultimate_beacon',
    heroFilter: 'doctor',
    applyStack: () => {}
  },

  // =========================================================================
  // UNIVERSAL BUFFS (18 Total: U01–U18)
  // =========================================================================
  buff_momentum: {
    id: 'buff_momentum',
    name: 'Momentum',
    category: 'UNIVERSAL BUFF • MOBILITY',
    description: '+2% movement speed per stack (max 15).',
    icon: '/assets/movement_speed.png',
    accentColor: '#38bdf8',
    buffPool: 'universal',
    dropWeight: 100,
    maxStacks: 15,
    applyStack: () => {}
  },
  buff_thruster_core: {
    id: 'buff_thruster_core',
    name: 'Thruster Core',
    category: 'UNIVERSAL BUFF • MOBILITY',
    description: '+5% jetpack fuel capacity per stack (max 10).',
    icon: '/assets/jet_plume.png',
    accentColor: '#60a5fa',
    buffPool: 'universal',
    dropWeight: 100,
    maxStacks: 10,
    applyStack: (stats, n) => {
      stats.jetpackCapacityMultiplier += 0.05 * n;
    }
  },
  buff_fuel_recycler: {
    id: 'buff_fuel_recycler',
    name: 'Fuel Recycler',
    category: 'UNIVERSAL BUFF • MOBILITY',
    description: '+5% jetpack fuel recharge rate per stack (max 10).',
    icon: '/assets/energy_flare.png',
    accentColor: '#22d3ee',
    buffPool: 'universal',
    dropWeight: 100,
    maxStacks: 10,
    applyStack: (stats, n) => {
      stats.jetpackRegenMultiplier += 0.05 * n;
    }
  },
  buff_aerial_boost: {
    id: 'buff_aerial_boost',
    name: 'Aerial Boost',
    category: 'UNIVERSAL SPECIAL • MOBILITY',
    description: '+1 additional midair jump per stack (uncapped).',
    icon: '/assets/jet_plume.png',
    accentColor: '#a78bfa',
    buffPool: 'universal',
    dropWeight: 5,
    isAdditionalJump: true,
    isUncapped: true,
    applyStack: (stats, n) => {
      stats.extraAirJumps += n;
    }
  },
  buff_overcharge: {
    id: 'buff_overcharge',
    name: 'Overcharge',
    category: 'UNIVERSAL BUFF • OFFENSE',
    description: '+2% all damage dealt per stack (max 15).',
    icon: '/assets/attack_power.png',
    accentColor: '#f87171',
    buffPool: 'universal',
    dropWeight: 100,
    maxStacks: 15,
    applyStack: (stats, n) => {
      stats.damageMultiplier += 0.02 * n;
    }
  },
  buff_precision: {
    id: 'buff_precision',
    name: 'Precision',
    category: 'UNIVERSAL BUFF • OFFENSE',
    description: '+3% critical strike chance per stack (max 10).',
    icon: '/assets/critical_chance.png',
    accentColor: '#fbbf24',
    buffPool: 'universal',
    dropWeight: 100,
    maxStacks: 10,
    applyStack: (stats, n) => {
      stats.critChance += 0.03 * n;
    }
  },
  buff_critical_surge: {
    id: 'buff_critical_surge',
    name: 'Critical Surge',
    category: 'UNIVERSAL BUFF • OFFENSE',
    description: '+8% critical strike damage multiplier per stack (max 6).',
    icon: '/assets/critical_damage.png',
    accentColor: '#f59e0b',
    buffPool: 'universal',
    dropWeight: 100,
    maxStacks: 6,
    applyStack: (stats, n) => {
      stats.critMultiplier += 0.08 * n;
    }
  },
  buff_rapid_fire: {
    id: 'buff_rapid_fire',
    name: 'Rapid Fire',
    category: 'UNIVERSAL BUFF • OFFENSE',
    description: '+2% LMB attack speed per stack (max 15).',
    icon: '/assets/attack_speed.png',
    accentColor: '#fb923c',
    buffPool: 'universal',
    dropWeight: 100,
    maxStacks: 15,
    applyStack: (stats, n) => {
      stats.lmbAttackSpeedMultiplier += 0.02 * n;
    }
  },
  buff_vitality: {
    id: 'buff_vitality',
    name: 'Vitality',
    category: 'UNIVERSAL BUFF • DEFENSE',
    description: '+3% max health per stack (max 15).',
    icon: '/assets/health.png',
    accentColor: '#4ade80',
    buffPool: 'universal',
    dropWeight: 100,
    maxStacks: 15,
    applyStack: () => {}
  },
  buff_reinforced_plating: {
    id: 'buff_reinforced_plating',
    name: 'Reinforced Plating',
    category: 'UNIVERSAL BUFF • DEFENSE',
    description: '+2% damage reduction per stack (max 8).',
    icon: '/assets/armor.png',
    accentColor: '#94a3b8',
    buffPool: 'universal',
    dropWeight: 100,
    maxStacks: 8,
    applyStack: (stats, n) => {
      stats.damageReduction += 0.02 * n;
    }
  },
  buff_regeneration: {
    id: 'buff_regeneration',
    name: 'Regeneration',
    category: 'UNIVERSAL BUFF • DEFENSE',
    description: '+0.15% max health regeneration per second per stack (max 10).',
    icon: '/assets/life_steal.png',
    accentColor: '#34d399',
    buffPool: 'universal',
    dropWeight: 100,
    maxStacks: 10,
    applyStack: () => {}
  },
  buff_life_siphon: {
    id: 'buff_life_siphon',
    name: 'Life Siphon',
    category: 'UNIVERSAL BUFF • DEFENSE',
    description: 'Heal for 0.15% of damage dealt per stack, capped at 1% max HP/s (max 5).',
    icon: '/assets/life_steal.png',
    accentColor: '#f43f5e',
    buffPool: 'universal',
    dropWeight: 100,
    maxStacks: 5,
    applyStack: (stats, n) => {
      stats.lifeSiphonPercent += 0.0015 * n;
    }
  },
  buff_thorns: {
    id: 'buff_thorns',
    name: 'Thorns',
    category: 'UNIVERSAL BUFF • DEFENSE',
    description: 'Reflect 6% of incoming damage per stack back to attackers (max 8).',
    icon: '/assets/defensive_protocol.png',
    accentColor: '#a3e635',
    buffPool: 'universal',
    dropWeight: 100,
    maxStacks: 8,
    applyStack: (stats, n) => {
      stats.thornsReflectFraction += 0.06 * n;
    }
  },
  buff_emergency_barrier: {
    id: 'buff_emergency_barrier',
    name: 'Emergency Barrier',
    category: 'UNIVERSAL BUFF • DEFENSE',
    description: 'Below 30% HP, gain a barrier equal to 4% max HP per stack for 3s (25s ICD, max 4).',
    icon: '/assets/defensive_protocol.png',
    accentColor: '#38bdf8',
    buffPool: 'universal',
    dropWeight: 100,
    maxStacks: 4,
    applyStack: (stats, n) => {
      stats.emergencyBarrierFraction += 0.04 * n;
    }
  },
  buff_accelerator: {
    id: 'buff_accelerator',
    name: 'Accelerator',
    category: 'UNIVERSAL BUFF • UTILITY',
    description: '-2% skill cooldown duration per stack (max 10).',
    icon: '/assets/cooldown_reduction.png',
    accentColor: '#818cf8',
    buffPool: 'universal',
    dropWeight: 100,
    maxStacks: 10,
    applyStack: (stats, n) => {
      stats.skillCooldownMultiplier -= 0.02 * n;
    }
  },
  buff_magnetic_field: {
    id: 'buff_magnetic_field',
    name: 'Magnetic Field',
    category: 'UNIVERSAL BUFF • UTILITY',
    description: '+12% pickup attraction radius per stack (max 10).',
    icon: '/assets/loot_orb.png',
    accentColor: '#2dd4bf',
    buffPool: 'universal',
    dropWeight: 100,
    maxStacks: 10,
    applyStack: () => {}
  },
  buff_fortune: {
    id: 'buff_fortune',
    name: 'Fortune',
    category: 'UNIVERSAL BUFF • UTILITY',
    description: '+4% currency gain per stack (max 10).',
    icon: '/assets/currency_shard.png',
    accentColor: '#eab308',
    buffPool: 'universal',
    dropWeight: 100,
    maxStacks: 10,
    applyStack: (stats, n) => {
      stats.currencyMultiplier += 0.04 * n;
    }
  },
  buff_area_amplifier: {
    id: 'buff_area_amplifier',
    name: 'Area Amplifier',
    category: 'UNIVERSAL BUFF • UTILITY',
    description: '+6% Ultimate AoE radius per stack, globally capped at +50% (max 6).',
    icon: '/assets/orbital_reticle.png',
    accentColor: '#c084fc',
    buffPool: 'universal',
    dropWeight: 100,
    maxStacks: 6,
    applyStack: (stats, n) => {
      stats.ultimateRadiusBonusRaw += 0.06 * n;
    }
  },

  // =========================================================================
  // TRIGGER BUFFS (15 Total: T01–T15)
  // =========================================================================
  buff_chain_reaction: {
    id: 'buff_chain_reaction',
    name: 'Chain Reaction',
    category: 'TRIGGER BUFF • ON KILL',
    description: 'Enemies explode on death for 6% base LMB damage per stack in 180u radius (2s ICD, max 6).',
    icon: '/assets/energy_flare.png',
    accentColor: '#f97316',
    buffPool: 'trigger',
    dropWeight: 100,
    maxStacks: 6,
    applyStack: () => {}
  },
  buff_blood_rush: {
    id: 'buff_blood_rush',
    name: 'Blood Rush',
    category: 'TRIGGER BUFF • ON KILL',
    description: '3 kills within 5s grants +3% LMB attack speed & +2% move speed per stack for 4s (max 8).',
    icon: '/assets/attack_speed.png',
    accentColor: '#ef4444',
    buffPool: 'trigger',
    dropWeight: 100,
    maxStacks: 8,
    applyStack: () => {}
  },
  buff_second_wind: {
    id: 'buff_second_wind',
    name: 'Second Wind',
    category: 'TRIGGER BUFF • ON ELITE KILL',
    description: 'Eliminating an elite or boss restores 3% max HP per stack (12s ICD, max 5).',
    icon: '/assets/health.png',
    accentColor: '#4ade80',
    buffPool: 'trigger',
    dropWeight: 100,
    maxStacks: 5,
    applyStack: () => {}
  },
  buff_executioner: {
    id: 'buff_executioner',
    name: 'Executioner',
    category: 'TRIGGER BUFF • LOW HP TARGET',
    description: '+2% bonus damage per stack against enemies below 30% HP (max 8).',
    icon: '/assets/attack_power.png',
    accentColor: '#dc2626',
    buffPool: 'trigger',
    dropWeight: 100,
    maxStacks: 8,
    applyStack: () => {}
  },
  buff_combat_focus: {
    id: 'buff_combat_focus',
    name: 'Combat Focus',
    category: 'TRIGGER BUFF • HIT CADENCE',
    description: 'Every 5th direct hit deals +5% bonus damage per stack (max 8).',
    icon: '/assets/critical_chance.png',
    accentColor: '#facc15',
    buffPool: 'trigger',
    dropWeight: 100,
    maxStacks: 8,
    applyStack: () => {}
  },
  buff_final_stand: {
    id: 'buff_final_stand',
    name: 'Final Stand',
    category: 'TRIGGER BUFF • LOW HP SELF',
    description: 'Below 40% HP: gain +3% all damage and +2% damage reduction per stack (max 8).',
    icon: '/assets/rally_command.png',
    accentColor: '#fb7185',
    buffPool: 'trigger',
    dropWeight: 100,
    maxStacks: 8,
    applyStack: () => {}
  },
  buff_static_discharge: {
    id: 'buff_static_discharge',
    name: 'Static Discharge',
    category: 'TRIGGER BUFF • ARC LIGHTNING',
    description: 'Every 6s, direct attacks chain arc lightning to up to 3 enemies for 5% base LMB damage/stack (max 6).',
    icon: '/assets/proj_wave.png',
    accentColor: '#38bdf8',
    buffPool: 'trigger',
    dropWeight: 100,
    maxStacks: 6,
    applyStack: () => {}
  },
  buff_aftershock: {
    id: 'buff_aftershock',
    name: 'Aftershock',
    category: 'TRIGGER BUFF • LANDING',
    description: 'Landing after >0.15s airborne unleashes a 200u shockwave for 4% base LMB damage/stack (3s ICD, max 8).',
    icon: '/assets/tactical_strike.png',
    accentColor: '#a855f7',
    buffPool: 'trigger',
    dropWeight: 100,
    maxStacks: 8,
    applyStack: () => {}
  },
  buff_retaliation: {
    id: 'buff_retaliation',
    name: 'Retaliation',
    category: 'TRIGGER BUFF • ON HIT TAKEN',
    description: 'Taking damage grants +2% all damage per stack for 3s (max 8).',
    icon: '/assets/armor.png',
    accentColor: '#f59e0b',
    buffPool: 'trigger',
    dropWeight: 100,
    maxStacks: 8,
    applyStack: () => {}
  },
  buff_cooldown_harvest: {
    id: 'buff_cooldown_harvest',
    name: 'Cooldown Harvest',
    category: 'TRIGGER BUFF • ON KILL',
    description: 'Kills reduce active skill cooldowns by 0.08s per stack, capped at 0.5s/sec (max 6).',
    icon: '/assets/cooldown_reduction.png',
    accentColor: '#6366f1',
    buffPool: 'trigger',
    dropWeight: 100,
    maxStacks: 6,
    applyStack: () => {}
  },
  buff_fuel_harvest: {
    id: 'buff_fuel_harvest',
    name: 'Fuel Harvest',
    category: 'TRIGGER BUFF • ON KILL',
    description: 'Kills restore +1.5 jetpack fuel per stack (max 8).',
    icon: '/assets/jet_plume.png',
    accentColor: '#06b6d4',
    buffPool: 'trigger',
    dropWeight: 100,
    maxStacks: 8,
    applyStack: () => {}
  },
  buff_killing_momentum: {
    id: 'buff_killing_momentum',
    name: 'Killing Momentum',
    category: 'TRIGGER BUFF • ON KILL',
    description: 'Kills grant +1% move speed per stack for 3s, stacking up to 3 times (max 8).',
    icon: '/assets/movement_speed.png',
    accentColor: '#2dd4bf',
    buffPool: 'trigger',
    dropWeight: 100,
    maxStacks: 8,
    applyStack: () => {}
  },
  buff_reactive_shield: {
    id: 'buff_reactive_shield',
    name: 'Reactive Shield',
    category: 'TRIGGER BUFF • HEAVY HIT',
    description: 'Taking >15% max HP in one hit grants a 4% max HP barrier per stack for 3s (15s ICD, max 4).',
    icon: '/assets/defensive_protocol.png',
    accentColor: '#60a5fa',
    buffPool: 'trigger',
    dropWeight: 100,
    maxStacks: 4,
    applyStack: () => {}
  },
  buff_overkill: {
    id: 'buff_overkill',
    name: 'Overkill',
    category: 'TRIGGER BUFF • EXCESS DAMAGE',
    description: '4% excess killing-blow damage per stack jumps to the nearest enemy within 280u (max 6).',
    icon: '/assets/orbital_beam.png',
    accentColor: '#f43f5e',
    buffPool: 'trigger',
    dropWeight: 100,
    maxStacks: 6,
    applyStack: () => {}
  },
  buff_survival_instinct: {
    id: 'buff_survival_instinct',
    name: 'Survival Instinct',
    category: 'TRIGGER BUFF • CRITICAL HP',
    description: 'Dropping below 25% HP grants +0.25s stun immunity (max 1s) and +2% move speed/stack for 3s (30s ICD, max 5).',
    icon: '/assets/combat_dash.png',
    accentColor: '#22c55e',
    buffPool: 'trigger',
    dropWeight: 100,
    maxStacks: 5,
    applyStack: () => {}
  },

  // =========================================================================
  // COMMANDER AUGMENT-SPECIFIC BUFFS (24 Total: 6 LMB, 6 RMB, 6 Dash, 6 Ult)
  // =========================================================================
  // --- Commander LMB ---
  buff_cmd_cryo_amplification: {
    id: 'buff_cmd_cryo_amplification',
    name: 'Cryo Amplification',
    category: 'COMMANDER AUGMENT • CHILL BEAM',
    description: '+3% Chill Beam damage and +2% Chill slow intensity per stack (max 8).',
    icon: '/assets/proj_pulse.png',
    accentColor: '#67e8f9',
    buffPool: 'augment_specific',
    dropWeight: 100,
    maxStacks: 8,
    heroFilter: 'commander',
    requiredAugment: 'chill_beam',
    applyStack: () => {}
  },
  buff_cmd_thermal_focus: {
    id: 'buff_cmd_thermal_focus',
    name: 'Thermal Focus',
    category: 'COMMANDER AUGMENT • CHILL BEAM',
    description: '+5% Chill Beam width/radius and +4% beam range per stack (max 6).',
    icon: '/assets/energy_flare.png',
    accentColor: '#38bdf8',
    buffPool: 'augment_specific',
    dropWeight: 100,
    maxStacks: 6,
    heroFilter: 'commander',
    requiredAugment: 'chill_beam',
    applyStack: () => {}
  },
  buff_cmd_penetration_core: {
    id: 'buff_cmd_penetration_core',
    name: 'Penetration Core',
    category: 'COMMANDER AUGMENT • PIERCING LASER',
    description: '+1 Piercing Laser pierce per 2 stacks and +2% laser damage per stack (max 6).',
    icon: '/assets/orbital_beam.png',
    accentColor: '#818cf8',
    buffPool: 'augment_specific',
    dropWeight: 100,
    maxStacks: 6,
    heroFilter: 'commander',
    requiredAugment: 'piercing_laser',
    applyStack: () => {}
  },
  buff_cmd_coherent_optics: {
    id: 'buff_cmd_coherent_optics',
    name: 'Coherent Optics',
    category: 'COMMANDER AUGMENT • PIERCING LASER',
    description: '+4% laser beam width and +3% projectile speed per stack (max 6).',
    icon: '/assets/critical_chance.png',
    accentColor: '#a78bfa',
    buffPool: 'augment_specific',
    dropWeight: 100,
    maxStacks: 6,
    heroFilter: 'commander',
    requiredAugment: 'piercing_laser',
    applyStack: () => {}
  },
  buff_cmd_blade_reach: {
    id: 'buff_cmd_blade_reach',
    name: 'Blade Reach',
    category: 'COMMANDER AUGMENT • EXTENDED SLASH',
    description: '+5% slash arc radius and +4% arc angle per stack (max 6).',
    icon: '/assets/proj_wave.png',
    accentColor: '#f472b6',
    buffPool: 'augment_specific',
    dropWeight: 100,
    maxStacks: 6,
    heroFilter: 'commander',
    requiredAugment: 'extended_slash',
    applyStack: () => {}
  },
  buff_cmd_heavy_swing: {
    id: 'buff_cmd_heavy_swing',
    name: 'Heavy Swing',
    category: 'COMMANDER AUGMENT • EXTENDED SLASH',
    description: '+3% Extended Slash damage per stack (max 8).',
    icon: '/assets/attack_power.png',
    accentColor: '#fb7185',
    buffPool: 'augment_specific',
    dropWeight: 100,
    maxStacks: 8,
    heroFilter: 'commander',
    requiredAugment: 'extended_slash',
    applyStack: () => {}
  },

  // --- Commander RMB ---
  buff_cmd_twin_edge: {
    id: 'buff_cmd_twin_edge',
    name: 'Twin Edge',
    category: 'COMMANDER AUGMENT • SCISSOR SLASH',
    description: '+3% Scissor Slash damage per stack (max 8).',
    icon: '/assets/attack_power.png',
    accentColor: '#f43f5e',
    buffPool: 'augment_specific',
    dropWeight: 100,
    maxStacks: 8,
    heroFilter: 'commander',
    requiredAugment: 'scissor_slash',
    applyStack: () => {}
  },
  buff_cmd_serrated_cut: {
    id: 'buff_cmd_serrated_cut',
    name: 'Serrated Cut',
    category: 'COMMANDER AUGMENT • SCISSOR SLASH',
    description: 'Applies bleed dealing 1% target current HP/s per stack over 2s, non-boss cap 4%/s (max 6).',
    icon: '/assets/life_steal.png',
    accentColor: '#e11d48',
    buffPool: 'augment_specific',
    dropWeight: 100,
    maxStacks: 6,
    heroFilter: 'commander',
    requiredAugment: 'scissor_slash',
    applyStack: () => {}
  },
  buff_cmd_shatter_nova: {
    id: 'buff_cmd_shatter_nova',
    name: 'Shatter Nova',
    category: 'COMMANDER AUGMENT • FROST BURST',
    description: '+5% Frost Burst radius and +3% burst damage per stack (max 6).',
    icon: '/assets/proj_wave.png',
    accentColor: '#38bdf8',
    buffPool: 'augment_specific',
    dropWeight: 100,
    maxStacks: 6,
    heroFilter: 'commander',
    requiredAugment: 'frost_burst',
    applyStack: () => {}
  },
  buff_cmd_deep_freeze: {
    id: 'buff_cmd_deep_freeze',
    name: 'Deep Freeze',
    category: 'COMMANDER AUGMENT • FROST BURST',
    description: '+0.2s Frost Burst chill duration and +3% slow intensity per stack (max 5).',
    icon: '/assets/energy_flare.png',
    accentColor: '#22d3ee',
    buffPool: 'augment_specific',
    dropWeight: 100,
    maxStacks: 5,
    heroFilter: 'commander',
    requiredAugment: 'frost_burst',
    applyStack: () => {}
  },
  buff_cmd_orbital_extension: {
    id: 'buff_cmd_orbital_extension',
    name: 'Orbital Extension',
    category: 'COMMANDER AUGMENT • ORBITING BLADE',
    description: '+0.3s Orbiting Blade duration and +3% blade orbital speed per stack (max 6).',
    icon: '/assets/rune_circle.png',
    accentColor: '#a855f7',
    buffPool: 'augment_specific',
    dropWeight: 100,
    maxStacks: 6,
    heroFilter: 'commander',
    requiredAugment: 'orbiting_blade',
    applyStack: () => {}
  },
  buff_cmd_razor_satellites: {
    id: 'buff_cmd_razor_satellites',
    name: 'Razor Satellites',
    category: 'COMMANDER AUGMENT • ORBITING BLADE',
    description: '+3% Orbiting Blade damage per stack (max 8).',
    icon: '/assets/critical_damage.png',
    accentColor: '#c084fc',
    buffPool: 'augment_specific',
    dropWeight: 100,
    maxStacks: 8,
    heroFilter: 'commander',
    requiredAugment: 'orbiting_blade',
    applyStack: () => {}
  },

  // --- Commander Dash ---
  buff_cmd_impulse_capacitor: {
    id: 'buff_cmd_impulse_capacitor',
    name: 'Impulse Capacitor',
    category: 'COMMANDER AUGMENT • EXTENDED DASH',
    description: '-3% Dash cooldown per stack (max 6).',
    icon: '/assets/cooldown_reduction.png',
    accentColor: '#38bdf8',
    buffPool: 'augment_specific',
    dropWeight: 100,
    maxStacks: 6,
    heroFilter: 'commander',
    requiredAugment: 'extended_dash',
    applyStack: (stats, n) => {
      stats.dashCooldownMultiplier -= 0.03 * n;
    }
  },
  buff_cmd_kinetic_stride: {
    id: 'buff_cmd_kinetic_stride',
    name: 'Kinetic Stride',
    category: 'COMMANDER AUGMENT • EXTENDED DASH',
    description: '+4% Dash travel distance per stack (max 5).',
    icon: '/assets/combat_dash.png',
    accentColor: '#60a5fa',
    buffPool: 'augment_specific',
    dropWeight: 100,
    maxStacks: 5,
    heroFilter: 'commander',
    requiredAugment: 'extended_dash',
    applyStack: () => {}
  },
  buff_cmd_kinetic_shell: {
    id: 'buff_cmd_kinetic_shell',
    name: 'Kinetic Shell',
    category: 'COMMANDER AUGMENT • SHOCK DASH',
    description: 'Shock Dash grants a Kinetic Shell barrier (+0.15s duration & +3% barrier durability per stack, max 6).',
    icon: '/assets/defensive_protocol.png',
    accentColor: '#22d3ee',
    buffPool: 'augment_specific',
    dropWeight: 100,
    maxStacks: 6,
    heroFilter: 'commander',
    requiredAugment: 'shock_dash',
    applyStack: () => {}
  },
  buff_cmd_concussive_wave: {
    id: 'buff_cmd_concussive_wave',
    name: 'Concussive Wave',
    category: 'COMMANDER AUGMENT • SHOCK DASH',
    description: '+5% Shock Dash shockwave radius and +3% shockwave damage per stack (max 6).',
    icon: '/assets/tactical_strike.png',
    accentColor: '#facc15',
    buffPool: 'augment_specific',
    dropWeight: 100,
    maxStacks: 6,
    heroFilter: 'commander',
    requiredAugment: 'shock_dash',
    applyStack: () => {}
  },
  buff_cmd_adrenal_extension: {
    id: 'buff_cmd_adrenal_extension',
    name: 'Adrenal Extension',
    category: 'COMMANDER AUGMENT • TELEPORT',
    description: '+0.25s post-Teleport speed surge & +0.15s arrival stun duration per stack (max 5).',
    icon: '/assets/attack_speed.png',
    accentColor: '#4ade80',
    buffPool: 'augment_specific',
    dropWeight: 100,
    maxStacks: 5,
    heroFilter: 'commander',
    requiredAugment: 'teleport',
    applyStack: () => {}
  },
  buff_cmd_velocity_surge: {
    id: 'buff_cmd_velocity_surge',
    name: 'Velocity Surge',
    category: 'COMMANDER AUGMENT • TELEPORT',
    description: '+4% post-Teleport movement speed burst per stack (max 6).',
    icon: '/assets/movement_speed.png',
    accentColor: '#34d399',
    buffPool: 'augment_specific',
    dropWeight: 100,
    maxStacks: 6,
    heroFilter: 'commander',
    requiredAugment: 'teleport',
    applyStack: () => {}
  },

  // --- Commander Ultimate ---
  buff_cmd_gravitational_pull: {
    id: 'buff_cmd_gravitational_pull',
    name: 'Gravitational Pull',
    category: 'COMMANDER AUGMENT • SINGULARITY',
    description: '+5% Singularity pull strength and +3% pull duration per stack (max 6).',
    icon: '/assets/orbital_reticle.png',
    accentColor: '#a855f7',
    buffPool: 'augment_specific',
    dropWeight: 100,
    maxStacks: 6,
    heroFilter: 'commander',
    requiredAugment: 'singularity',
    applyStack: () => {}
  },
  buff_cmd_event_horizon: {
    id: 'buff_cmd_event_horizon',
    name: 'Event Horizon',
    category: 'COMMANDER AUGMENT • SINGULARITY',
    description: '+5% Singularity pull radius (capped +50% global) and +3% tick damage per stack (max 5).',
    icon: '/assets/rune_circle.png',
    accentColor: '#c084fc',
    buffPool: 'augment_specific',
    dropWeight: 100,
    maxStacks: 5,
    heroFilter: 'commander',
    requiredAugment: 'singularity',
    applyStack: (stats, n) => {
      stats.ultimateRadiusBonusRaw += 0.05 * n;
    }
  },
  buff_cmd_concentrated_salvo: {
    id: 'buff_cmd_concentrated_salvo',
    name: 'Concentrated Salvo',
    category: 'COMMANDER AUGMENT • CONVERGENCE BARRAGE',
    description: '+3% Convergence Barrage strike damage per stack (max 6).',
    icon: '/assets/orbital_beam.png',
    accentColor: '#fb923c',
    buffPool: 'augment_specific',
    dropWeight: 100,
    maxStacks: 6,
    heroFilter: 'commander',
    requiredAugment: 'convergence_barrage',
    applyStack: () => {}
  },
  buff_cmd_pinpoint_collapse: {
    id: 'buff_cmd_pinpoint_collapse',
    name: 'Pinpoint Collapse',
    category: 'COMMANDER AUGMENT • CONVERGENCE BARRAGE',
    description: '+4% Convergence Barrage impact radius per stack, globally capped at +50% (max 5).',
    icon: '/assets/tactical_strike.png',
    accentColor: '#f59e0b',
    buffPool: 'augment_specific',
    dropWeight: 100,
    maxStacks: 5,
    heroFilter: 'commander',
    requiredAugment: 'convergence_barrage',
    applyStack: (stats, n) => {
      stats.ultimateRadiusBonusRaw += 0.04 * n;
    }
  },
  buff_cmd_subzero_detonation: {
    id: 'buff_cmd_subzero_detonation',
    name: 'Subzero Detonation',
    category: 'COMMANDER AUGMENT • CRYOGENIC IMPACT',
    description: '+3% Cryogenic Impact freeze damage and +2% slow intensity per stack (max 6).',
    icon: '/assets/proj_wave.png',
    accentColor: '#67e8f9',
    buffPool: 'augment_specific',
    dropWeight: 100,
    maxStacks: 6,
    heroFilter: 'commander',
    requiredAugment: 'cryogenic_impact',
    applyStack: () => {}
  },
  buff_cmd_permafrost_field: {
    id: 'buff_cmd_permafrost_field',
    name: 'Permafrost Field',
    category: 'COMMANDER AUGMENT • CRYOGENIC IMPACT',
    description: '+0.3s lingering Cryogenic Impact zone duration per stack (max 5).',
    icon: '/assets/totem_carving.png',
    accentColor: '#38bdf8',
    buffPool: 'augment_specific',
    dropWeight: 100,
    maxStacks: 5,
    heroFilter: 'commander',
    requiredAugment: 'cryogenic_impact',
    applyStack: () => {}
  },

  // =========================================================================
  // DOCTOR AUGMENT-SPECIFIC BUFFS (24 Total: 6 LMB, 6 RMB, 6 Dash, 6 Ult)
  // =========================================================================
  // --- Doctor LMB ---
  buff_doc_contagion_return: {
    id: 'buff_doc_contagion_return',
    name: 'Contagion Return',
    category: 'DOCTOR AUGMENT • RICOCHET OVERDOSE',
    description: '+4% ricochet damage per stack (max 4, +16%). Applies to ricochet hits.',
    icon: '/assets/doctor/icon_toxic_chain.png',
    accentColor: '#4ade80',
    buffPool: 'augment_specific',
    dropWeight: 100,
    maxStacks: 4,
    heroFilter: 'doctor',
    requiredAugment: 'toxic_chain',
    applyStack: () => {}
  },
  buff_doc_overdose_catalyst: {
    id: 'buff_doc_overdose_catalyst',
    name: 'Overdose Catalyst',
    category: 'DOCTOR AUGMENT • RICOCHET OVERDOSE',
    description: '+4% poison detonation damage per stack (max 4, +16%).',
    icon: '/assets/proj_acid.png',
    accentColor: '#22c55e',
    buffPool: 'augment_specific',
    dropWeight: 100,
    maxStacks: 4,
    heroFilter: 'doctor',
    requiredAugment: 'toxic_chain',
    applyStack: () => {}
  },
  buff_doc_surgical_edge: {
    id: 'buff_doc_surgical_edge',
    name: 'Surgical Edge',
    category: 'DOCTOR AUGMENT • ROTARY SCALPEL',
    description: '+4% outgoing and returning scalpel blade damage per stack (max 4, +16%).',
    icon: '/assets/doctor/icon_cryo_scalpel.png',
    accentColor: '#38bdf8',
    buffPool: 'augment_specific',
    dropWeight: 100,
    maxStacks: 4,
    heroFilter: 'doctor',
    requiredAugment: 'cryogenic_scalpel',
    applyStack: () => {}
  },
  buff_doc_cryogenic_residue: {
    id: 'buff_doc_cryogenic_residue',
    name: 'Cryogenic Residue',
    category: 'DOCTOR AUGMENT • ROTARY SCALPEL',
    description: '+0.25s chilled ground trail duration per stack (max 4, up to 4s).',
    icon: '/assets/energy_flare.png',
    accentColor: '#67e8f9',
    buffPool: 'augment_specific',
    dropWeight: 100,
    maxStacks: 4,
    heroFilter: 'doctor',
    requiredAugment: 'cryogenic_scalpel',
    applyStack: () => {}
  },
  buff_doc_vital_reach: {
    id: 'buff_doc_vital_reach',
    name: 'Vital Reach',
    category: 'DOCTOR AUGMENT • VITAL TETHERS',
    description: '+4% tether targeting and connection range per stack (max 4, +16%).',
    icon: '/assets/doctor/icon_vital_extraction.png',
    accentColor: '#f43f5e',
    buffPool: 'augment_specific',
    dropWeight: 100,
    maxStacks: 4,
    heroFilter: 'doctor',
    requiredAugment: 'vital_extraction',
    applyStack: () => {}
  },
  buff_doc_siphon_efficiency: {
    id: 'buff_doc_siphon_efficiency',
    name: 'Siphon Efficiency',
    category: 'DOCTOR AUGMENT • VITAL TETHERS',
    description: '+4% healing received from tether health drain per stack (max 4, +16%).',
    icon: '/assets/life_steal.png',
    accentColor: '#fb7185',
    buffPool: 'augment_specific',
    dropWeight: 100,
    maxStacks: 4,
    heroFilter: 'doctor',
    requiredAugment: 'vital_extraction',
    applyStack: () => {}
  },

  // --- Doctor RMB ---
  buff_doc_targeting_optics: {
    id: 'buff_doc_targeting_optics',
    name: 'Targeting Optics',
    category: 'DOCTOR AUGMENT • EXPERIMENTAL DRONE',
    description: '+5% drone targeting range per stack while respecting terrain LOS (max 4, +20%).',
    icon: '/assets/doctor/icon_experimental_drones.png',
    accentColor: '#38bdf8',
    buffPool: 'augment_specific',
    dropWeight: 100,
    maxStacks: 4,
    heroFilter: 'doctor',
    requiredAugment: 'experimental_drones',
    applyStack: () => {}
  },
  buff_doc_calibrated_payload: {
    id: 'buff_doc_calibrated_payload',
    name: 'Calibrated Payload',
    category: 'DOCTOR AUGMENT • EXPERIMENTAL DRONE',
    description: '+4% drone damage per stack across all active drones (max 4, +16%).',
    icon: '/assets/attack_power.png',
    accentColor: '#60a5fa',
    buffPool: 'augment_specific',
    dropWeight: 100,
    maxStacks: 4,
    heroFilter: 'doctor',
    requiredAugment: 'experimental_drones',
    applyStack: () => {}
  },
  buff_doc_toxic_diffusion: {
    id: 'buff_doc_toxic_diffusion',
    name: 'Toxic Diffusion',
    category: 'DOCTOR AUGMENT • FRAGMENTATION BOMB',
    description: '+4% fragmentation poison puddle radius per stack (max 4, +16%).',
    icon: '/assets/doctor/icon_toxic_cluster.png',
    accentColor: '#84cc16',
    buffPool: 'augment_specific',
    dropWeight: 100,
    maxStacks: 4,
    heroFilter: 'doctor',
    requiredAugment: 'toxic_cluster_bomb',
    applyStack: () => {}
  },
  buff_doc_corrosive_residue: {
    id: 'buff_doc_corrosive_residue',
    name: 'Corrosive Residue',
    category: 'DOCTOR AUGMENT • FRAGMENTATION BOMB',
    description: '+0.25s fragmentation poison puddle duration per stack (max 4, +1s).',
    icon: '/assets/proj_acid.png',
    accentColor: '#4ade80',
    buffPool: 'augment_specific',
    dropWeight: 100,
    maxStacks: 4,
    heroFilter: 'doctor',
    requiredAugment: 'toxic_cluster_bomb',
    applyStack: () => {}
  },
  buff_doc_projection_integrity: {
    id: 'buff_doc_projection_integrity',
    name: 'Projection Integrity',
    category: 'DOCTOR AUGMENT • HOLOGRAPHIC DECOY',
    description: '+5% decoy lifetime per stack (max 4, +20%).',
    icon: '/assets/doctor/icon_holo_decoy.png',
    accentColor: '#2dd4bf',
    buffPool: 'augment_specific',
    dropWeight: 100,
    maxStacks: 4,
    heroFilter: 'doctor',
    requiredAugment: 'holographic_decoy',
    applyStack: () => {}
  },
  buff_doc_caustic_reprisal: {
    id: 'buff_doc_caustic_reprisal',
    name: 'Caustic Reprisal',
    category: 'DOCTOR AUGMENT • HOLOGRAPHIC DECOY',
    description: '+4% decoy explosion and toxic-goo damage per stack (max 4, +16%).',
    icon: '/assets/proj_acid.png',
    accentColor: '#10b981',
    buffPool: 'augment_specific',
    dropWeight: 100,
    maxStacks: 4,
    heroFilter: 'doctor',
    requiredAugment: 'holographic_decoy',
    applyStack: () => {}
  },

  // --- Doctor Dash ---
  buff_doc_clinical_reach: {
    id: 'buff_doc_clinical_reach',
    name: 'Clinical Reach',
    category: 'DOCTOR AUGMENT • EXTENDED DASH',
    description: '+4% healing applied by Doctor Dash per stack (max 4, +16%).',
    icon: '/assets/doctor/icon_extended_dash.png',
    accentColor: '#34d399',
    buffPool: 'augment_specific',
    dropWeight: 100,
    maxStacks: 4,
    heroFilter: 'doctor',
    requiredAugment: 'extended_dash',
    applyStack: () => {}
  },
  buff_doc_impact_dosage: {
    id: 'buff_doc_impact_dosage',
    name: 'Impact Dosage',
    category: 'DOCTOR AUGMENT • EXTENDED DASH',
    description: '+4% damage dealt to enemies passed through during Dash per stack (max 4, +16%).',
    icon: '/assets/combat_dash.png',
    accentColor: '#f97316',
    buffPool: 'augment_specific',
    dropWeight: 100,
    maxStacks: 4,
    heroFilter: 'doctor',
    requiredAugment: 'extended_dash',
    applyStack: () => {}
  },
  buff_doc_sterile_interval: {
    id: 'buff_doc_sterile_interval',
    name: 'Sterile Interval',
    category: 'DOCTOR AUGMENT • PHASE BARRIER',
    description: '+0.1s post-Dash invulnerability per stack (max 3, up to 1.3s).',
    icon: '/assets/doctor/icon_phase_barrier.png',
    accentColor: '#38bdf8',
    buffPool: 'augment_specific',
    dropWeight: 100,
    maxStacks: 3,
    heroFilter: 'doctor',
    requiredAugment: 'phase_barrier',
    applyStack: () => {}
  },
  buff_doc_protective_triage: {
    id: 'buff_doc_protective_triage',
    name: 'Protective Triage',
    category: 'DOCTOR AUGMENT • PHASE BARRIER',
    description: '+4% healing applied to allies/self during therapeutic Dash per stack (max 4, +16%).',
    icon: '/assets/health.png',
    accentColor: '#4ade80',
    buffPool: 'augment_specific',
    dropWeight: 100,
    maxStacks: 4,
    heroFilter: 'doctor',
    requiredAugment: 'phase_barrier',
    applyStack: () => {}
  },
  buff_doc_rush_persistence: {
    id: 'buff_doc_rush_persistence',
    name: 'Rush Persistence',
    category: 'DOCTOR AUGMENT • ADRENALINE RUSH',
    description: '+0.2s post-Dash speed-buff duration per stack (max 4, up to 2.3s).',
    icon: '/assets/doctor/icon_adrenaline_rush.png',
    accentColor: '#facc15',
    buffPool: 'augment_specific',
    dropWeight: 100,
    maxStacks: 4,
    heroFilter: 'doctor',
    requiredAugment: 'adrenaline_rush',
    applyStack: () => {}
  },
  buff_doc_emergency_reflex: {
    id: 'buff_doc_emergency_reflex',
    name: 'Emergency Reflex',
    category: 'DOCTOR AUGMENT • ADRENALINE RUSH',
    description: '+2% LMB attack speed per stack while Adrenaline Rush is active (max 4, +8%).',
    icon: '/assets/attack_speed.png',
    accentColor: '#fb923c',
    buffPool: 'augment_specific',
    dropWeight: 100,
    maxStacks: 4,
    heroFilter: 'doctor',
    requiredAugment: 'adrenaline_rush',
    applyStack: () => {}
  },

  // --- Doctor Ultimate ---
  buff_doc_orbit_stabilizer: {
    id: 'buff_doc_orbit_stabilizer',
    name: 'Orbit Stabilizer',
    category: 'DOCTOR AUGMENT • MOBILE SANCTUARY',
    description: '+2% Mobile Sanctuary cross radius per stack, globally capped at +50% (max 4, +8%).',
    icon: '/assets/doctor/icon_mobile_sanctuary.png',
    accentColor: '#a855f7',
    buffPool: 'augment_specific',
    dropWeight: 100,
    maxStacks: 4,
    heroFilter: 'doctor',
    requiredAugment: 'mobile_sanctuary',
    applyStack: (stats, n) => {
      stats.ultimateRadiusBonusRaw += 0.02 * n;
    }
  },
  buff_doc_vital_rotation: {
    id: 'buff_doc_vital_rotation',
    name: 'Vital Rotation',
    category: 'DOCTOR AUGMENT • MOBILE SANCTUARY',
    description: '+4% Mobile Sanctuary healing output per stack (max 4, +16%).',
    icon: '/assets/health.png',
    accentColor: '#4ade80',
    buffPool: 'augment_specific',
    dropWeight: 100,
    maxStacks: 4,
    heroFilter: 'doctor',
    requiredAugment: 'mobile_sanctuary',
    applyStack: () => {}
  },
  buff_doc_celestial_endurance: {
    id: 'buff_doc_celestial_endurance',
    name: 'Celestial Endurance',
    category: 'DOCTOR AUGMENT • ANGELIC DESCENT',
    description: '+0.5s angel projection duration per stack (max 4, up to 12s).',
    icon: '/assets/doctor/icon_divine_intervention.png',
    accentColor: '#fde047',
    buffPool: 'augment_specific',
    dropWeight: 100,
    maxStacks: 4,
    heroFilter: 'doctor',
    requiredAugment: 'divine_intervention',
    applyStack: () => {}
  },
  buff_doc_consecrated_cross: {
    id: 'buff_doc_consecrated_cross',
    name: 'Consecrated Cross',
    category: 'DOCTOR AUGMENT • ANGELIC DESCENT',
    description: '+4% initial 3s cross healing and damage per stack (max 4, +16%).',
    icon: '/assets/doctor/icon_sacred_field.png',
    accentColor: '#f59e0b',
    buffPool: 'augment_specific',
    dropWeight: 100,
    maxStacks: 4,
    heroFilter: 'doctor',
    requiredAugment: 'divine_intervention',
    applyStack: () => {}
  },
  buff_doc_sustained_rain: {
    id: 'buff_doc_sustained_rain',
    name: 'Sustained Rain',
    category: 'DOCTOR AUGMENT • RAIN OF CROSS',
    description: '+0.25s rainfall duration per stack (max 4, +1s).',
    icon: '/assets/doctor/icon_rain_of_crosses.png',
    accentColor: '#22c55e',
    buffPool: 'augment_specific',
    dropWeight: 100,
    maxStacks: 4,
    heroFilter: 'doctor',
    requiredAugment: 'rain_of_crosses',
    applyStack: () => {}
  },
  buff_doc_restorative_imprint: {
    id: 'buff_doc_restorative_imprint',
    name: 'Restorative Imprint',
    category: 'DOCTOR AUGMENT • RAIN OF CROSS',
    description: '+4% smaller ground cross healing and DoT damage per stack (max 4, +16%).',
    icon: '/assets/life_steal.png',
    accentColor: '#34d399',
    buffPool: 'augment_specific',
    dropWeight: 100,
    maxStacks: 4,
    heroFilter: 'doctor',
    requiredAugment: 'rain_of_crosses',
    applyStack: () => {}
  },

  // =========================================================================
  // EXISTING +1 PROJECTILE BUFFS (2 Total: P01–P02)
  // =========================================================================
  buff_extra_lmb_projectile: {
    id: 'buff_extra_lmb_projectile',
    name: '+1 LMB Projectile',
    category: 'PROJECTILE SPECIAL • LMB',
    description: 'Adds +1 LMB projectile or beam per stack (subject to skill-specific limits).',
    icon: '/assets/proj_pulse.png',
    accentColor: '#fbbf24',
    buffPool: 'projectile',
    dropWeight: 100,
    isExtraProjectile: true,
    isUncapped: true,
    applyStack: (stats, n) => {
      stats.extraLmbProjectiles += n;
    }
  },
  buff_extra_rmb_projectile: {
    id: 'buff_extra_rmb_projectile',
    name: '+1 RMB Projectile',
    category: 'PROJECTILE SPECIAL • RMB',
    description: 'Adds +1 RMB projectile/wave/drone/cluster bomb per stack (Drones max 7, Clusters max 5).',
    icon: '/assets/proj_acid.png',
    accentColor: '#c084fc',
    buffPool: 'projectile',
    dropWeight: 100,
    isExtraProjectile: true,
    isUncapped: true,
    applyStack: (stats, n) => {
      stats.extraRmbProjectiles += n;
    }
  },

  // =========================================================================
  // STAGE 1 EXPANDED EARLY-ELIGIBLE CATALOG (15 Total: E01–E15, Max Stacks 3)
  // =========================================================================
  buff_projectile_mesh: {
    id: 'buff_projectile_mesh',
    name: 'Projectile Mesh',
    category: 'UNIVERSAL BUFF • DEFENSE',
    description: 'Reduces incoming enemy projectile damage by 8% (+4% per stack, max 3), applied multiplicatively after armor.',
    icon: '/assets/defensive_protocol.png',
    accentColor: '#38bdf8',
    buffPool: 'universal',
    dropWeight: 100,
    maxStacks: 3,
    applyStack: (stats, n) => {
      const s = Math.min(3, n);
      stats.projectileDamageMitigation = (stats.projectileDamageMitigation || 0) + (0.08 + 0.04 * (s - 1));
    }
  },
  buff_impact_harness: {
    id: 'buff_impact_harness',
    name: 'Impact Harness',
    category: 'UNIVERSAL BUFF • DEFENSE',
    description: 'Reduces incoming melee and contact damage by 8% (+4% per stack, max 3), applied multiplicatively after armor.',
    icon: '/assets/armor.png',
    accentColor: '#60a5fa',
    buffPool: 'universal',
    dropWeight: 100,
    maxStacks: 3,
    applyStack: (stats, n) => {
      const s = Math.min(3, n);
      stats.meleeDamageMitigation = (stats.meleeDamageMitigation || 0) + (0.08 + 0.04 * (s - 1));
    }
  },
  buff_meltwater_treads: {
    id: 'buff_meltwater_treads',
    name: 'Meltwater Treads',
    category: 'UNIVERSAL BUFF • MOBILITY',
    description: 'Reduces water movement penalty by +7 percentage points per stack (68% -> 75% / 82% / 89%, max 3).',
    icon: '/assets/movement_speed.png',
    accentColor: '#06b6d4',
    buffPool: 'universal',
    dropWeight: 100,
    maxStacks: 3,
    applyStack: (stats, n) => {
      const s = Math.min(3, n);
      stats.waterSpeedBonus = (stats.waterSpeedBonus || 0) + 0.07 * s;
    }
  },
  buff_rangefinder_array: {
    id: 'buff_rangefinder_array',
    name: 'Rangefinder Array',
    category: 'UNIVERSAL BUFF • OFFENSE',
    description: 'Deals +10% (+5% per stack, max 3) bonus direct damage against enemies at distance >= 500u.',
    icon: '/assets/tactical_strike.png',
    accentColor: '#f59e0b',
    buffPool: 'universal',
    dropWeight: 100,
    maxStacks: 3,
    applyStack: (stats, n) => {
      const s = Math.min(3, n);
      stats.longRangeDamageBonus = (stats.longRangeDamageBonus || 0) + (0.10 + 0.05 * (s - 1));
    }
  },
  buff_point_blank_coil: {
    id: 'buff_point_blank_coil',
    name: 'Point-Blank Coil',
    category: 'UNIVERSAL BUFF • OFFENSE',
    description: 'Deals +8% (+4% per stack, max 3) bonus direct damage when within 220u of target edge.',
    icon: '/assets/attack_power.png',
    accentColor: '#fb7185',
    buffPool: 'universal',
    dropWeight: 100,
    maxStacks: 3,
    applyStack: (stats, n) => {
      const s = Math.min(3, n);
      stats.closeRangeDamageBonus = (stats.closeRangeDamageBonus || 0) + (0.08 + 0.04 * (s - 1));
    }
  },
  buff_opening_pulse: {
    id: 'buff_opening_pulse',
    name: 'Opening Pulse',
    category: 'UNIVERSAL BUFF • OFFENSE',
    description: 'Deals +10% (+5% per stack, max 3) bonus damage to healthy enemies at or above 90% HP.',
    icon: '/assets/critical_damage.png',
    accentColor: '#f97316',
    buffPool: 'universal',
    dropWeight: 100,
    maxStacks: 3,
    applyStack: (stats, n) => {
      const s = Math.min(3, n);
      stats.openingPulseBonus = (stats.openingPulseBonus || 0) + (0.10 + 0.05 * (s - 1));
    }
  },
  buff_titanbreaker_matrix: {
    id: 'buff_titanbreaker_matrix',
    name: 'Titanbreaker Matrix',
    category: 'UNIVERSAL BUFF • OFFENSE',
    description: 'Deals +6% bonus damage per stack (max 3 -> +18%) against Elites and Bosses.',
    icon: '/assets/enemy_boss.png',
    accentColor: '#ef4444',
    buffPool: 'universal',
    dropWeight: 100,
    maxStacks: 3,
    applyStack: (stats, n) => {
      const s = Math.min(3, n);
      stats.giantSlayerBonus += 0.06 * s;
    }
  },
  buff_cryo_chem_catalyst: {
    id: 'buff_cryo_chem_catalyst',
    name: 'Cryo-Chem Catalyst',
    category: 'UNIVERSAL BUFF • SYNERGY',
    description: 'Deals +8% (+4% per stack, max 3) bonus damage to enemies afflicted with Chill, Electrified, or Toxic.',
    icon: '/assets/proj_acid.png',
    accentColor: '#22d3ee',
    buffPool: 'universal',
    dropWeight: 100,
    maxStacks: 3,
    applyStack: (stats, n) => {
      const s = Math.min(3, n);
      stats.statusSynergyDamageBonus = (stats.statusSynergyDamageBonus || 0) + (0.08 + 0.04 * (s - 1));
    }
  },
  buff_surveyors_beacon: {
    id: 'buff_surveyors_beacon',
    name: "Surveyor's Beacon",
    category: 'UNIVERSAL BUFF • OBJECTIVE',
    description: 'Each completed enhancement anomaly in the stage grants +4% (+2%/stack) Max HP and +3% (+1.5%/stack) Damage (max 3).',
    icon: '/assets/overseer_artifact.png',
    accentColor: '#a855f7',
    buffPool: 'universal',
    dropWeight: 100,
    maxStacks: 3,
    applyStack: () => {
      // Computed dynamically from completedEnhancementCategories.size in calculateStats()
    }
  },
  buff_dash_overclock: {
    id: 'buff_dash_overclock',
    name: 'Dash Overclock',
    category: 'TRIGGER BUFF • UTILITY',
    description: 'Dashing grants +10% (+4%/stack, max 3) LMB Attack Speed for 3s (8s ICD).',
    icon: '/assets/combat_dash.png',
    accentColor: '#38bdf8',
    buffPool: 'trigger',
    dropWeight: 100,
    maxStacks: 3,
    applyStack: () => {
      // Timed effect handled in player.activeTimedEffects ('dash_overclock')
    }
  },
  buff_first_contact_protocol: {
    id: 'buff_first_contact_protocol',
    name: 'First Contact Protocol',
    category: 'TRIGGER BUFF • OPENER',
    description: 'Striking an undamaged (100% HP) enemy grants +10% (+3%/stack, max 3) Attack Speed for 4s (8s ICD).',
    icon: '/assets/attack_speed.png',
    accentColor: '#fbbf24',
    buffPool: 'trigger',
    dropWeight: 100,
    maxStacks: 3,
    applyStack: () => {
      // Timed effect handled in player.activeTimedEffects ('first_contact_protocol')
    }
  },
  buff_aerial_focus: {
    id: 'buff_aerial_focus',
    name: 'Aerial Focus',
    category: 'TRIGGER BUFF • AERIAL',
    description: 'Remaining airborne for >= 1.5s grants +10% (+3%/stack, max 3) Crit Chance for 4s (once per jump).',
    icon: '/assets/critical_chance.png',
    accentColor: '#a7f3d0',
    buffPool: 'trigger',
    dropWeight: 100,
    maxStacks: 3,
    applyStack: () => {
      // Timed effect handled in player.activeTimedEffects ('aerial_focus')
    }
  },
  buff_pod_surge: {
    id: 'buff_pod_surge',
    name: 'Pod Surge',
    category: 'TRIGGER BUFF • EXPLORATION',
    description: 'Opening a Bio-Sac grants +15% (+5%/stack, max 3) Movement Speed for 8s (refreshes duration).',
    icon: '/assets/organic_pod.png',
    accentColor: '#4ade80',
    buffPool: 'trigger',
    dropWeight: 100,
    maxStacks: 3,
    applyStack: () => {
      // Timed effect handled in player.activeTimedEffects ('pod_surge')
    }
  },
  buff_apex_barrier: {
    id: 'buff_apex_barrier',
    name: 'Apex Barrier',
    category: 'TRIGGER BUFF • DEFENSE',
    description: 'Defeating an Elite or Boss grants an 8% (+4%/stack, max 3) Max HP Barrier Shield for 6s (10s ICD).',
    icon: '/assets/item_vital_core.png',
    accentColor: '#60a5fa',
    buffPool: 'trigger',
    dropWeight: 100,
    maxStacks: 3,
    applyStack: () => {
      // Timed barrier shield handled on Elite/Boss defeat ('apex_barrier')
    }
  },
  buff_resonance_siphon: {
    id: 'buff_resonance_siphon',
    name: 'Resonance Siphon',
    category: 'TRIGGER BUFF • COMBO',
    description: 'Casting your Secondary (RMB) empowers LMB attacks with +12% (+4%/stack, max 3) bonus damage for 3.5s (6s ICD).',
    icon: '/assets/proj_pulse.png',
    accentColor: '#e879f9',
    buffPool: 'trigger',
    dropWeight: 100,
    maxStacks: 3,
    applyStack: () => {
      // Timed LMB damage bonus handled in player.activeTimedEffects ('resonance_siphon')
    }
  }
};

export const ALL_BUFF_IDS: BuffId[] = Object.keys(BUFF_REGISTRY) as BuffId[];

/**
 * Returns the configured flat-pool drop weight for a Buff:
 * - Additional Jump stacks: 5 (uncapped, exponential decay after guaranteed pickup)
 * - +1 LMB / RMB Projectile: 100 base (+25/miss after threshold)
 * - Special buffs: 10
 * - Ordinary Universal, Trigger, and eligible Augment-Specific buffs: 100
 */
export function getEffectiveBuffWeight(def: BuffDef, player?: PlayerState): number {
  const idLow = def.id.toLowerCase();
  const nameLow = (def.name || '').toLowerCase();
  if (
    def.isAdditionalJump ||
    idLow.includes('extra_jump') ||
    idLow.includes('additional_jump') ||
    idLow.includes('double_jump') ||
    nameLow.includes('additional jump') ||
    def.id === 'buff_aerial_boost'
  ) {
    // Additional Jump Weight = MAX(0.01, 5 * 0.5^N) where N = additional random stacks after guaranteed pickup
    const totalStacks = player?.buffs?.[def.id] || 0;
    const freeOffset = player?.hasCollectedDoubleJumpPickup ? 1 : 0;
    const randomStacksN = Math.max(0, totalStacks - freeOffset);
    return Math.max(
      AERIAL_BOOST_WEIGHT_CONFIG.minWeight,
      AERIAL_BOOST_WEIGHT_CONFIG.baseWeight * Math.pow(AERIAL_BOOST_WEIGHT_CONFIG.decayFactor, randomStacksN)
    );
  }
  if (
    def.isExtraProjectile ||
    def.buffPool === 'projectile' ||
    idLow.includes('extra_projectile') ||
    idLow.includes('plus_projectile') ||
    nameLow.includes('+1 lmb') ||
    nameLow.includes('+1 rmb') ||
    nameLow.includes('lmb / rmb projectile')
  ) {
    const missStreak = player?.nonProjectileBuffCount ?? 0;
    return Math.min(
      PROJECTILE_PITY_CONFIG.maxWeight,
      PROJECTILE_PITY_CONFIG.baseWeight +
        Math.max(0, missStreak - PROJECTILE_PITY_CONFIG.threshold) * PROJECTILE_PITY_CONFIG.incrementPerBuff
    );
  }
  if (def.isSpecial || BUFF_RARITY_CONFIG.approvedSpecialBuffIds.has(def.id)) {
    return BUFF_RARITY_CONFIG.specialWeight;
  }
  if (def.dropWeight !== undefined) {
    return Math.max(0.001, def.dropWeight);
  }
  return BUFF_RARITY_CONFIG.ordinaryWeight;
}

/**
 * Checks whether a non-augment buff is currently eligible for the given player,
 * enforcing hero restrictions, selected-augment prerequisites, guaranteed Double Jump gate,
 * and configured maximum stack limits (Additional Jump stacks remain uncapped).
 */
export function isBuffEligibleForPlayer(buffId: BuffId, player: PlayerState): boolean {
  const def = BUFF_REGISTRY[buffId];
  if (!def) return false;
  if (def.exclusiveEvent || def.replacesSkillSlot || def.enhancesSkillSlot) return false;
  if (def.isAttributeUpgrade === false) return false;
  if (def.heroFilter && def.heroFilter !== player.heroId) return false;
  if (def.requiredHero && def.requiredHero !== player.heroId) return false;

  // Player must collect the guaranteed stage pickup before Aerial Boost enters random loot
  if (buffId === 'buff_aerial_boost' && !player.hasCollectedDoubleJumpPickup && (player.buffs[buffId] || 0) <= 0) {
    return false;
  }

  if (def.requiredAugment) {
    const activeAugments = Object.values(player.skillEnhancements || {});
    const reqList = Array.isArray(def.requiredAugment) ? def.requiredAugment : [def.requiredAugment];
    const hasMatch = reqList.some((aug) => activeAugments.includes(aug));
    if (!hasMatch) return false;
  }

  if (buffId === 'buff_extra_lmb_projectile' && PROJECTILE_STACK_CONFIG.maxExtraLmbStacks !== null) {
    if ((player.buffs[buffId] || 0) >= PROJECTILE_STACK_CONFIG.maxExtraLmbStacks) return false;
  }
  if (buffId === 'buff_extra_rmb_projectile' && PROJECTILE_STACK_CONFIG.maxExtraRmbStacks !== null) {
    if ((player.buffs[buffId] || 0) >= PROJECTILE_STACK_CONFIG.maxExtraRmbStacks) return false;
  }

  const uncapped = Boolean(
    def.isUncapped ||
    def.isAdditionalJump ||
    def.id.toLowerCase().includes('extra_jump') ||
    def.id.toLowerCase().includes('additional_jump')
  );
  if (!uncapped && def.maxStacks !== undefined) {
    const curStacks = def.linkedItemId
      ? player.items[def.linkedItemId] || 0
      : player.buffs[buffId] || 0;
    if (curStacks >= def.maxStacks) return false;
  }

  return true;
}

/**
 * Returns the deduplicated flat list of all currently eligible buffs
 * across Universal, Trigger, Special, and unlocked Augment-Specific pools.
 */
export function getEligibleBuffPool(player: PlayerState): BuffId[] {
  const seen = new Set<BuffId>();
  const out: BuffId[] = [];
  for (const id of Object.keys(BUFF_REGISTRY) as BuffId[]) {
    if (seen.has(id)) continue;
    if (isBuffEligibleForPlayer(id, player)) {
      seen.add(id);
      out.push(id);
    }
  }
  return out;
}

/**
 * Picks one random eligible buff directly from the complete flat eligible pool using
 * each buff's individual weight (never category-first selection).
 * Returns null if no eligible buffs remain.
 */
export function rollWeightedRandomBuff(rng: SeededRandom, player: PlayerState): BuffId | null {
  const pool = getEligibleBuffPool(player);
  if (pool.length === 0) return null;

  let totalWeight = 0;
  for (let i = 0; i < pool.length; i++) {
    totalWeight += getEffectiveBuffWeight(BUFF_REGISTRY[pool[i]], player);
  }
  if (totalWeight <= 0) return pool[pool.length - 1];

  let roll = rng.range(0, totalWeight);
  for (let i = 0; i < pool.length; i++) {
    const id = pool[i];
    roll -= getEffectiveBuffWeight(BUFF_REGISTRY[id], player);
    if (roll <= 0) return id;
  }
  return pool[pool.length - 1];
}

/**
 * Picks up to 3 distinct BuffIds using the seeded RNG.
 * If filterEvent is supplied, preserves the exact Augment selection behavior unchanged.
 * If omitted (Chest draft), draws up to 3 unique weighted eligible buffs from the flat pool.
 */
export function rollThreeBuffChoices(
  rng: SeededRandom,
  filterEvent?: ExclusiveEventPool,
  heroId: HeroId = 'commander',
  player?: PlayerState
): BuffId[] {
  if (filterEvent) {
    const pool = (Object.keys(BUFF_REGISTRY) as BuffId[]).filter((id) => {
      const def = BUFF_REGISTRY[id];
      if (def.exclusiveEvent !== filterEvent) return false;
      if (def.heroFilter && def.heroFilter !== heroId) return false;
      return true;
    });
    // Preserve deterministic Augment 1 / 2 / 3 order for exclusive ability shrines (Extended Dash is always #1!)
    if (filterEvent !== 'void_corruption') {
      return pool.slice(0, 3);
    }
    const choices: BuffId[] = [];
    while (choices.length < 3 && pool.length > 0) {
      const idx = Math.floor(rng.next() * pool.length);
      choices.push(pool[idx]);
      pool.splice(idx, 1);
    }
    return choices;
  }

  const pool = player
    ? getEligibleBuffPool(player)
    : (Object.keys(BUFF_REGISTRY) as BuffId[]).filter(
        (id) =>
          !BUFF_REGISTRY[id].exclusiveEvent &&
          !BUFF_REGISTRY[id].replacesSkillSlot &&
          !BUFF_REGISTRY[id].enhancesSkillSlot &&
          (!BUFF_REGISTRY[id].heroFilter || BUFF_REGISTRY[id].heroFilter === heroId) &&
          BUFF_REGISTRY[id].isAttributeUpgrade !== false
      );

  const choices: BuffId[] = [];
  const remaining = [...pool];
  while (choices.length < 3 && remaining.length > 0) {
    let totalWeight = 0;
    for (let i = 0; i < remaining.length; i++) {
      totalWeight += getEffectiveBuffWeight(BUFF_REGISTRY[remaining[i]], player);
    }
    let roll = rng.range(0, totalWeight);
    let chosenIdx = remaining.length - 1;
    for (let i = 0; i < remaining.length; i++) {
      roll -= getEffectiveBuffWeight(BUFF_REGISTRY[remaining[i]], player);
      if (roll <= 0) {
        chosenIdx = i;
        break;
      }
    }
    choices.push(remaining[chosenIdx]);
    remaining.splice(chosenIdx, 1);
  }
  return choices;
}

export function getBuffCatalogCounts(): {
  universal: number;
  trigger: number;
  augmentSpecific: number;
  projectile: number;
  augments: number;
  totalBuffs: number;
  totalEntries: number;
} {
  let universal = 0;
  let trigger = 0;
  let augmentSpecific = 0;
  let projectile = 0;
  let augments = 0;
  for (const def of Object.values(BUFF_REGISTRY)) {
    if (def.exclusiveEvent || def.replacesSkillSlot || def.enhancesSkillSlot) {
      augments++;
    } else if (def.buffPool === 'universal') {
      universal++;
    } else if (def.buffPool === 'trigger') {
      trigger++;
    } else if (def.buffPool === 'augment_specific') {
      augmentSpecific++;
    } else if (def.buffPool === 'projectile') {
      projectile++;
    }
  }
  const totalBuffs = universal + trigger + augmentSpecific + projectile;
  return {
    universal,
    trigger,
    augmentSpecific,
    projectile,
    augments,
    totalBuffs,
    totalEntries: totalBuffs + augments
  };
}

export interface CalculateStatsOptions {
  baseDamageReduction?: number;
  baseHealthRegenPercent?: number;
  runtimeSpeedBonusFraction?: number;
  runtimeDamageBonusFraction?: number;
  runtimeDamageReductionBonus?: number;
  runtimeLmbAttackSpeedBonusFraction?: number;
  completedEnhancements?: number;
  activeTimedEffects?: Partial<Record<TimedEffectId, ActiveTimedEffect>>;
}

export function calculateStats(
  baseMaxHealth: number,
  baseMoveSpeed: number,
  items: Record<ItemId, number>,
  buffs?: Record<BuffId, number>,
  opts?: CalculateStatsOptions
): CalculatedStats {
  const baseDR = opts?.baseDamageReduction ?? 0.02;
  const _baseRegenPct = opts?.baseHealthRegenPercent ?? 0.002;
  const momentumStacks = buffs?.buff_momentum || 0;
  const vitalityStacks = buffs?.buff_vitality || 0;
  const regenStacks = buffs?.buff_regeneration || 0;
  const magStacks = buffs?.buff_magnetic_field || 0;
  const completedEnhCount = Math.max(0, Math.min(4, opts?.completedEnhancements ?? 0));
  const beaconStacks = Math.min(3, buffs?.buff_surveyors_beacon || 0);
  const beaconHpBonus = beaconStacks > 0 && completedEnhCount > 0 ? (0.04 + 0.02 * (beaconStacks - 1)) * completedEnhCount : 0;
  const beaconDmgBonus = beaconStacks > 0 && completedEnhCount > 0 ? (0.03 + 0.015 * (beaconStacks - 1)) * completedEnhCount : 0;

  // Timed effect contributions kept cleanly separated from permanent buff inventory
  const timed = opts?.activeTimedEffects;
  const dashOverclockActive = timed?.dash_overclock && timed.dash_overclock.remaining > 0 ? timed.dash_overclock.stacks : 0;
  const firstContactActive = timed?.first_contact_protocol && timed.first_contact_protocol.remaining > 0 ? timed.first_contact_protocol.stacks : 0;
  const aerialFocusActive = timed?.aerial_focus && timed.aerial_focus.remaining > 0 ? timed.aerial_focus.stacks : 0;
  const podSurgeActive = timed?.pod_surge && timed.pod_surge.remaining > 0 ? timed.pod_surge.stacks : 0;
  const resonanceSiphonActive = timed?.resonance_siphon && timed.resonance_siphon.remaining > 0 ? timed.resonance_siphon.stacks : 0;

  const timedLmbAtkBonus = dashOverclockActive > 0 ? 0.10 + 0.04 * (Math.min(3, dashOverclockActive) - 1) : 0;
  const timedAtkBonus = firstContactActive > 0 ? 0.10 + 0.03 * (Math.min(3, firstContactActive) - 1) : 0;
  const timedCritBonus = aerialFocusActive > 0 ? 0.10 + 0.03 * (Math.min(3, aerialFocusActive) - 1) : 0;
  const timedMoveBonus = podSurgeActive > 0 ? 0.15 + 0.05 * (Math.min(3, podSurgeActive) - 1) : 0;
  const timedResonanceLmbDmg = resonanceSiphonActive > 0 ? 0.12 + 0.04 * (Math.min(3, resonanceSiphonActive) - 1) : 0;

  const finalMaxHealth = Math.round(baseMaxHealth * (1 + 0.03 * vitalityStacks + beaconHpBonus));
  const universalBaseRegenPerSec = 1.0;
  const bonusRegenPerSec = finalMaxHealth * (0.0015 * regenStacks);
  const moveMult = 1 + 0.02 * momentumStacks + (opts?.runtimeSpeedBonusFraction ?? 0) + timedMoveBonus;

  const stats: CalculatedStats = {
    maxHealth: finalMaxHealth,
    healthRegen: universalBaseRegenPerSec + bonusRegenPerSec,
    moveSpeed: baseMoveSpeed * moveMult,
    attackSpeedMultiplier: 1.0 + timedAtkBonus,
    lmbAttackSpeedMultiplier: 1.0 + (opts?.runtimeLmbAttackSpeedBonusFraction ?? 0) + timedLmbAtkBonus,
    damageMultiplier: 1.0 + (opts?.runtimeDamageBonusFraction ?? 0) + beaconDmgBonus,
    chainSparkChance: 0,
    chainSparkDamage: 20,
    damageReduction: baseDR + (opts?.runtimeDamageReductionBonus ?? 0),
    skillCooldownMultiplier: 1.0,
    dashCooldownMultiplier: 1.0,
    ultimateCooldownMultiplier: 1.0,
    ultimateRadiusMultiplier: 1.0,
    ultimateRadiusBonusRaw: 0,
    aoeRadiusMultiplier: 1.0,
    healingMultiplier: 1.0,
    skillDurationMultiplier: 1.0,
    pickupRadius: LOOT_CONFIG.basePickupRadius * (1 + 0.12 * magStacks),
    currencyMultiplier: 1.0,
    jetpackCapacityMultiplier: 1.0,
    jetpackRegenMultiplier: 1.0,
    extraAirJumps: 0,
    lifeSiphonPercent: 0,
    thornsReflectFraction: 0,
    emergencyBarrierFraction: 0,
    extraLmbProjectiles: 0,
    extraRmbProjectiles: 0,

    critChance: 0.05 + timedCritBonus,
    critMultiplier: 1.5,
    extraProjectiles: 0,
    projectileSpread: 0,
    projectilePierce: 0,
    projectileSpeedMultiplier: 1.0,
    projectileRadiusMultiplier: 1.0,
    frostChance: 0,
    toxicChance: 0,
    deathExplosionRadius: 0,
    deathExplosionDamage: 0,
    maxEnergyShield: 0,
    thornsDamage: 0,
    lifestealOnKill: 0,
    executionThreshold: 0,
    droneCount: 0,
    shockingDash: false,
    giantSlayerBonus: 0,
    artifactChargeMultiplier: 1.0,
    stunChance: 0,
    flatArmor: 0,
    hasSecondWind: false,
    bouncingProjectiles: false,
    projectileDamageMitigation: 0,
    meleeDamageMitigation: 0,
    waterSpeedBonus: 0,
    longRangeDamageBonus: 0,
    closeRangeDamageBonus: 0,
    openingPulseBonus: 0,
    statusSynergyDamageBonus: 0,
    resonanceLmbDamageBonus: timedResonanceLmbDmg
  };

  for (const [id, count] of Object.entries(items) as [ItemId, number][]) {
    if (count > 0 && ITEM_REGISTRY[id]) {
      ITEM_REGISTRY[id].applyStack(stats, count);
    }
  }

  if (buffs) {
    for (const [id, count] of Object.entries(buffs) as [BuffId, number][]) {
      if (count > 0 && BUFF_REGISTRY[id]) {
        BUFF_REGISTRY[id].applyStack(stats, count);
      }
    }
  }

  // Clamp offensive, defensive, mobility, cooldown, and radius bounds safely
  stats.critChance = Math.min(1.0, Math.max(0, stats.critChance));
  stats.damageReduction = Math.min(0.85, Math.max(0, stats.damageReduction));
  stats.moveSpeed = Math.min(baseMoveSpeed * 2.25, Math.max(baseMoveSpeed * 0.4, stats.moveSpeed));
  stats.projectileDamageMitigation = Math.min(0.45, Math.max(0, stats.projectileDamageMitigation || 0));
  stats.meleeDamageMitigation = Math.min(0.45, Math.max(0, stats.meleeDamageMitigation || 0));
  stats.skillCooldownMultiplier = Math.max(0.25, stats.skillCooldownMultiplier);
  stats.dashCooldownMultiplier = Math.max(0.25, stats.dashCooldownMultiplier);
  stats.ultimateCooldownMultiplier = Math.max(0.25, stats.ultimateCooldownMultiplier);
  // Global Ultimate AoE radius cap: +50% maximum
  stats.ultimateRadiusMultiplier = 1.0 + Math.min(0.50, Math.max(0, stats.ultimateRadiusBonusRaw));

  return stats;
}

import { ItemDef, ItemId, BuffDef, BuffId, CalculatedStats, ExclusiveEventPool, HeroId } from './types';

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
  basePickupRadius: 125,
  maxCurrencyObjects: 65
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
  buff_overdrive: {
    id: 'buff_overdrive',
    name: 'Overdrive Cycling',
    category: 'OFFENSE / MODULE',
    description: '+1 Overdrive stack (+20% Attack Speed). Accelerates all weapon firing.',
    icon: '/assets/attack_speed.png',
    accentColor: '#fb923c',
    linkedItemId: 'overdrive',
    applyStack: () => {}
  },
  buff_vital_core: {
    id: 'buff_vital_core',
    name: 'Vital Core Resonance',
    category: 'DEFENSE / MODULE',
    description: '+1 Vital Core stack (+35 Max HP & +1.5 HP/s bio-regeneration).',
    icon: '/assets/health.png',
    accentColor: '#34d399',
    linkedItemId: 'vital_core',
    applyStack: () => {}
  },
  buff_chain_spark: {
    id: 'buff_chain_spark',
    name: 'Chain Spark Conduit',
    category: 'PROC / MODULE',
    description: '+1 Chain Spark stack (+15% chance to arc chain lightning for 30 dmg).',
    icon: '/assets/critical_damage.png',
    accentColor: '#c084fc',
    linkedItemId: 'chain_spark',
    applyStack: () => {}
  },
  buff_pulse_power: {
    id: 'buff_pulse_power',
    name: 'Kinetic Amplifier',
    category: 'WEAPON AUGMENT',
    description: '+22% All Skill & Weapon Damage per stack.',
    icon: '/assets/attack_power.png',
    accentColor: '#facc15',
    applyStack: (stats: CalculatedStats, count: number) => {
      stats.damageMultiplier += count * 0.22;
    }
  },
  buff_thrusters: {
    id: 'buff_thrusters',
    name: 'Cryo-Vector Thrusters',
    category: 'MOBILITY AUGMENT',
    description: '+14% Movement Speed and -15% Tactical Dash cooldown per stack.',
    icon: '/assets/movement_speed.png',
    accentColor: '#60a5fa',
    applyStack: (stats: CalculatedStats, count: number) => {
      stats.moveSpeed *= 1 + count * 0.14;
      stats.dashCooldownMultiplier = Math.max(0.35, Math.pow(0.85, count));
    }
  },
  buff_orbital_cap: {
    id: 'buff_orbital_cap',
    name: 'Orbital Targeting Array',
    category: 'ULTIMATE AUGMENT',
    description: '+25% Orbital blast radius and -18% Ultimate cooldown per stack.',
    icon: '/assets/cooldown_reduction.png',
    accentColor: '#f59e0b',
    applyStack: (stats: CalculatedStats, count: number) => {
      stats.ultimateRadiusMultiplier += count * 0.25;
      stats.aoeRadiusMultiplier += count * 0.20;
      stats.ultimateCooldownMultiplier = Math.max(0.35, Math.pow(0.82, count));
    }
  },
  buff_harvester: {
    id: 'buff_harvester',
    name: 'Resonance Harvester',
    category: 'UTILITY AUGMENT',
    description: '+55 Currency pickup radius and +1.5 HP/s shield recovery per stack.',
    icon: '/assets/currency_shard.png',
    accentColor: '#c084fc',
    applyStack: (stats: CalculatedStats, count: number) => {
      stats.pickupRadius += count * 55;
      stats.healthRegen += count * 1.5;
    }
  },
  buff_crit_lens: {
    id: 'buff_crit_lens',
    name: 'Optical Precision Lens',
    category: 'OFFENSE AUGMENT',
    description: '+12% Critical Strike Chance. Critical hits deal 200% lethal damage.',
    icon: '/assets/critical_chance.png',
    accentColor: '#ef4444',
    applyStack: (stats: CalculatedStats, count: number) => {
      stats.critChance = Math.min(0.85, stats.critChance + count * 0.12);
      stats.critMultiplier = 2.0;
    }
  },
  buff_heavy_slugs: {
    id: 'buff_heavy_slugs',
    name: 'Tungsten Penetrator',
    category: 'OFFENSE AUGMENT',
    description: '+1 Pierce to all projectiles & +15% projectile velocity per stack.',
    icon: '/assets/attack_power.png',
    accentColor: '#94a3b8',
    applyStack: (stats: CalculatedStats, count: number) => {
      stats.projectilePierce += count;
      stats.projectileSpeedMultiplier = (stats.projectileSpeedMultiplier || 1.0) + count * 0.15;
      stats.damageMultiplier += count * 0.08;
    }
  },
  buff_multi_barrel: {
    id: 'buff_multi_barrel',
    name: 'Multi-Chamber Splitter',
    category: 'OFFENSE AUGMENT',
    description: '+1 Extra Projectile fired in a spread with every primary attack.',
    icon: '/assets/attack_power.png',
    accentColor: '#eab308',
    applyStack: (stats: CalculatedStats, count: number) => {
      stats.extraProjectiles += count;
      stats.projectileSpread = 0.22;
    }
  },
  buff_cryo_rounds: {
    id: 'buff_cryo_rounds',
    name: 'Permafrost Cryo-Rounds',
    category: 'ELEMENTAL / PROC',
    description: '+20% chance on hit to freeze enemies, reducing their speed by 50%.',
    icon: '/assets/proj_wave.png',
    accentColor: '#00e5ff',
    applyStack: (stats: CalculatedStats, count: number) => {
      stats.frostChance = Math.min(0.75, stats.frostChance + count * 0.20);
    }
  },
  buff_toxic_spores: {
    id: 'buff_toxic_spores',
    name: 'Corrosive Xenomorph Spores',
    category: 'ELEMENTAL / PROC',
    description: 'Attacks infect targets with alien venom, dealing 16 poison damage/sec for 4s.',
    icon: '/assets/alien_flora.png',
    accentColor: '#84cc16',
    applyStack: (stats: CalculatedStats, count: number) => {
      stats.toxicChance = Math.min(0.80, stats.toxicChance + count * 0.25);
      stats.skillDurationMultiplier += count * 0.15;
    }
  },
  buff_death_blossom: {
    id: 'buff_death_blossom',
    name: 'Volatile Biomass',
    category: 'EXPLOSIVE / PROC',
    description: 'Enemies detonate on death, dealing 48 plasma damage in an 80 radius.',
    icon: '/assets/alien_mushroom.png',
    accentColor: '#f97316',
    applyStack: (stats: CalculatedStats, count: number) => {
      stats.deathExplosionRadius += 80;
      stats.deathExplosionDamage += count * 48;
    }
  },
  buff_energy_shield: {
    id: 'buff_energy_shield',
    name: 'Aegis Nano-Shield',
    category: 'DEFENSE AUGMENT',
    description: '+45 Max Energy Shield. Automatically absorbs damage before Health.',
    icon: '/assets/armor.png',
    accentColor: '#06b6d4',
    applyStack: (stats: CalculatedStats, count: number) => {
      stats.maxEnergyShield += count * 45;
    }
  },
  buff_thorns_plating: {
    id: 'buff_thorns_plating',
    name: 'Reactive Shock Spikes',
    category: 'DEFENSE / PROC',
    description: 'Reflects 32 electrical damage back to any creature that strikes you.',
    icon: '/assets/armor.png',
    accentColor: '#a855f7',
    applyStack: (stats: CalculatedStats, count: number) => {
      stats.thornsDamage += count * 32;
    }
  },
  buff_vampiric_siphon: {
    id: 'buff_vampiric_siphon',
    name: 'Bio-Siphon Protocol',
    category: 'SURVIVAL AUGMENT',
    description: 'Heals +6 Health instantly whenever you eliminate an enemy.',
    icon: '/assets/life_steal.png',
    accentColor: '#ec4899',
    applyStack: (stats: CalculatedStats, count: number) => {
      stats.lifestealOnKill += count * 6;
      stats.healingMultiplier += count * 0.15;
    }
  },
  buff_executioner: {
    id: 'buff_executioner',
    name: 'Death Mark Protocol',
    category: 'OFFENSE AUGMENT',
    description: 'Instantly executes any normal enemy whose Health drops below 18%.',
    icon: '/assets/critical_damage.png',
    accentColor: '#dc2626',
    applyStack: (stats: CalculatedStats, count: number) => {
      stats.executionThreshold = Math.min(0.35, stats.executionThreshold + count * 0.09);
    }
  },
  buff_combat_drone: {
    id: 'buff_combat_drone',
    name: 'Autonomous Attack Drone',
    category: 'AUTONOMOUS DRONE',
    description: 'Deploys an automated support drone that orbits you and fires lasers at nearby foes.',
    icon: '/assets/overseer_artifact.png',
    accentColor: '#38bdf8',
    applyStack: (stats: CalculatedStats, count: number) => {
      stats.droneCount += count;
    }
  },
  buff_shock_trail: {
    id: 'buff_shock_trail',
    name: 'Kinetic Dash — Static Discharge',
    category: 'SURVIVAL / UTILITY',
    description: 'Augments Kinetic Dash: Leaves an electrified plasma trail along your dash path that shocks and damages pursuing foes.',
    icon: '/assets/proj_pulse.png',
    accentColor: '#c084fc',
    applyStack: (stats: CalculatedStats) => {
      stats.shockingDash = true;
    }
  },
  buff_speed_demon: {
    id: 'buff_speed_demon',
    name: 'Momentum Capacitor',
    category: 'HYBRID AUGMENT',
    description: 'Converts speed to firepower: gain +1% bonus Damage per 5 points of Movement Speed.',
    icon: '/assets/movement_speed.png',
    accentColor: '#10b981',
    applyStack: (stats: CalculatedStats, count: number) => {
      const speedBonus = ((stats.moveSpeed - 220) / 5) * 0.01 * count;
      stats.damageMultiplier += Math.max(0, speedBonus);
    }
  },
  buff_giant_slayer: {
    id: 'buff_giant_slayer',
    name: 'Behemoth Breaker',
    category: 'OFFENSE AUGMENT',
    description: '+45% Bonus Damage against Elite and Boss alien monsters.',
    icon: '/assets/void_goliath.png',
    accentColor: '#f43f5e',
    applyStack: (stats: CalculatedStats, count: number) => {
      stats.giantSlayerBonus += count * 0.45;
    }
  },
  buff_jet_overclock: {
    id: 'buff_jet_overclock',
    name: 'Jetpack Supercharger',
    category: 'TRAVERSAL AUGMENT',
    description: '+50% Max Jetpack Fuel and +25% horizontal air gliding speed.',
    icon: '/assets/jet_plume.png',
    accentColor: '#0284c7',
    applyStack: (stats: CalculatedStats, count: number) => {
      stats.moveSpeed *= 1 + count * 0.08;
    }
  },
  buff_bouncing_slugs: {
    id: 'buff_bouncing_slugs',
    name: 'Ricochet Matrix',
    category: 'WEAPON AUGMENT',
    description: 'Kinetic energy pulses bounce off terrain cliffs and obstacles toward enemies.',
    icon: '/assets/attack_power.png',
    accentColor: '#f59e0b',
    applyStack: (stats: CalculatedStats) => {
      stats.bouncingProjectiles = true;
    }
  },
  buff_titanium_armor: {
    id: 'buff_titanium_armor',
    name: 'Plated Exoskeleton',
    category: 'DEFENSE AUGMENT',
    description: 'Reduces all incoming damage by a flat 4 damage (minimum 1 damage taken).',
    icon: '/assets/armor.png',
    accentColor: '#64748b',
    applyStack: (stats: CalculatedStats, count: number) => {
      stats.flatArmor += count * 4;
    }
  },
  buff_greedy_leech: {
    id: 'buff_greedy_leech',
    name: 'Shard Attunement',
    category: 'ECONOMY / UTILITY',
    description: 'Collecting currency shards grants +15% Attack Speed for 4 seconds.',
    icon: '/assets/currency_shard.png',
    accentColor: '#facc15',
    applyStack: (stats: CalculatedStats, count: number) => {
      stats.pickupRadius += count * 35;
    }
  },
  buff_resonance_booster: {
    id: 'buff_resonance_booster',
    name: 'Artifact Harmonizer',
    category: 'OBJECTIVE AUGMENT',
    description: 'Overseer Artifact charges +35% faster from all enemy kills.',
    icon: '/assets/overseer_artifact.png',
    accentColor: '#eab308',
    applyStack: (stats: CalculatedStats, count: number) => {
      stats.artifactChargeMultiplier += count * 0.35;
    }
  },
  buff_stun_rounds: {
    id: 'buff_stun_rounds',
    name: 'Concussive Disruption',
    category: 'CROWD CONTROL',
    description: '+16% chance on hit to stagger and stun enemies for 1.2 seconds.',
    icon: '/assets/proj_pulse.png',
    accentColor: '#3b82f6',
    applyStack: (stats: CalculatedStats, count: number) => {
      stats.stunChance = Math.min(0.65, stats.stunChance + count * 0.16);
    }
  },
  buff_thermite_infusion: {
    id: 'buff_thermite_infusion',
    name: 'Plasma Ignition',
    category: 'DAMAGE / ELEMENTAL',
    description: 'All attacks ignite enemies and scorch the ground for bonus burning damage.',
    icon: '/assets/proj_wave.png',
    accentColor: '#ea580c',
    applyStack: (stats: CalculatedStats, count: number) => {
      stats.damageMultiplier += count * 0.12;
    }
  },
  buff_berserker_stim: {
    id: 'buff_berserker_stim',
    name: 'Berserker Adrenaline',
    category: 'SURVIVAL / DAMAGE',
    description: 'Grants +55% Attack Speed and +20% Movement Speed when below 40% Health.',
    icon: '/assets/item_overdrive.png',
    accentColor: '#b91c1c',
    applyStack: (stats: CalculatedStats, count: number) => {
      stats.damageMultiplier += count * 0.10;
    }
  },
  buff_frost_landing: {
    id: 'buff_frost_landing',
    name: 'Cryo Impact Plating',
    category: 'SURVIVAL / UTILITY',
    description: 'Colliding with enemies or completing a dash triggers a freezing nova that chills and slows nearby foes.',
    icon: '/assets/proj_wave.png',
    accentColor: '#38bdf8',
    applyStack: (stats: CalculatedStats, count: number) => {
      stats.frostChance = Math.min(0.80, stats.frostChance + count * 0.15);
    }
  },
  buff_nanite_swarm: {
    id: 'buff_nanite_swarm',
    name: 'Self-Replicating Nanites',
    category: 'PROC / SWARM',
    description: 'Killing an enemy constructs 2 autonomous nanites that seek and strike other foes.',
    icon: '/assets/item_chain_spark.png',
    accentColor: '#06b6d4',
    applyStack: (stats: CalculatedStats, count: number) => {
      stats.chainSparkDamage += count * 12;
    }
  },
  buff_superconductor: {
    id: 'buff_superconductor',
    name: 'High-Voltage Capacitor',
    category: 'PROC / ELECTRIC',
    description: 'Chain Spark jumps to +2 additional targets and deals +50% critical damage.',
    icon: '/assets/critical_damage.png',
    accentColor: '#a855f7',
    applyStack: (stats: CalculatedStats, count: number) => {
      stats.chainSparkChance = Math.min(0.85, stats.chainSparkChance + count * 0.12);
      stats.chainSparkDamage += count * 22;
    }
  },
  buff_lead_curtain: {
    id: 'buff_lead_curtain',
    name: 'Hyper-Density Munitions',
    category: 'WEAPON AUGMENT',
    description: '+30% Projectile collision hitbox size and +18% base projectile damage.',
    icon: '/assets/attack_power.png',
    accentColor: '#475569',
    applyStack: (stats: CalculatedStats, count: number) => {
      stats.projectileRadiusMultiplier = (stats.projectileRadiusMultiplier || 1.0) + count * 0.30;
      stats.damageMultiplier += count * 0.18;
    }
  },
  buff_second_wind: {
    id: 'buff_second_wind',
    name: 'Emergency Defibrillator',
    category: 'SURVIVAL PROTOCOL',
    description: 'Survive what would be a fatal blow once per stage, restoring 50% Health.',
    icon: '/assets/health.png',
    accentColor: '#10b981',
    applyStack: (stats: CalculatedStats) => {
      stats.hasSecondWind = true;
    }
  },

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

  // --- LEGACY PROTOTYPES (Preserved without exclusiveEvent for backward compatibility) ---
  buff_skill_scatter: {
    id: 'buff_skill_scatter',
    name: 'Scatter Rounds',
    category: 'COMBAT / WEAPONS',
    description: 'Fires 2 additional flanking golden blaster bolts in a tight burst cone (+1 Pierce).',
    icon: '/assets/rally_command.png',
    accentColor: '#f97316',
    isAttributeUpgrade: true,
    applyStack: () => {}
  },
  buff_skill_arc: {
    id: 'buff_skill_arc',
    name: 'Arc Conduction',
    category: 'COMBAT / WEAPONS',
    description: 'Every blaster bolt hit arcs high-voltage chain lightning to nearby enemies.',
    icon: '/assets/rally_command.png',
    accentColor: '#38bdf8',
    isAttributeUpgrade: true,
    applyStack: () => {}
  },
  buff_skill_hyper_beam: {
    id: 'buff_skill_hyper_beam',
    name: 'Piercing Rounds',
    category: 'COMBAT / WEAPONS',
    description: 'Supercharges blaster bolts with +35% Damage, +40% Velocity, and +3 Pierce.',
    icon: '/assets/proj_wave.png',
    accentColor: '#a855f7',
    isAttributeUpgrade: true,
    applyStack: (stats: CalculatedStats) => {
      stats.damageMultiplier += 0.35;
    }
  },
  buff_skill_gatling: {
    id: 'buff_skill_gatling',
    name: 'Rapid Overclock',
    category: 'COMBAT / WEAPONS',
    description: 'Permanently grants +25% Attack Speed.',
    icon: '/assets/item_overdrive.png',
    accentColor: '#eab308',
    isAttributeUpgrade: true,
    applyStack: (stats: CalculatedStats) => {
      stats.attackSpeedMultiplier += 0.25;
    }
  },
  buff_skill_cryo_grenade: {
    id: 'buff_skill_cryo_grenade',
    name: 'Cryogenic Infusion',
    category: 'COMBAT / WEAPONS',
    description: 'Secondary attacks freeze enemies for 2.0s and leave a chilling frost wake.',
    icon: '/assets/defensive_protocol.png',
    accentColor: '#00e5ff',
    isAttributeUpgrade: true,
    applyStack: () => {}
  },
  buff_skill_gravity_vortex: {
    id: 'buff_skill_gravity_vortex',
    name: 'Gravitational Compression',
    category: 'COMBAT / WEAPONS',
    description: 'Secondary attacks create a brief gravitational compression well pulling foes inward.',
    icon: '/assets/defensive_protocol.png',
    accentColor: '#a855f7',
    isAttributeUpgrade: true,
    applyStack: () => {}
  },
  buff_skill_blink: {
    id: 'buff_skill_blink',
    name: 'Phase Surge Capacitor',
    category: 'COMBAT / WEAPONS',
    description: 'Increases dash speed and distance by +35% and unleashes a concussive phase shockwave.',
    icon: '/assets/combat_dash.png',
    accentColor: '#c084fc',
    isAttributeUpgrade: true,
    applyStack: () => {}
  },
  buff_skill_nuke: {
    id: 'buff_skill_nuke',
    name: 'Orbital Strike — Multi-Beam',
    category: 'COMBAT / WEAPONS',
    description: 'Legacy multi-beam orbital strike prototype.',
    icon: '/assets/tactical_strike.png',
    accentColor: '#fbbf24',
    isAttributeUpgrade: true,
    applyStack: () => {}
  },
  buff_skill_singularity: {
    id: 'buff_skill_singularity',
    name: 'Orbital Strike — Void Singularity',
    category: 'COMBAT / WEAPONS',
    description: 'Legacy singularity orbital strike prototype.',
    icon: '/assets/overseer_artifact.png',
    accentColor: '#a855f7',
    isAttributeUpgrade: true,
    applyStack: () => {}
  },
  buff_skill_chrono_stasis: {
    id: 'buff_skill_chrono_stasis',
    name: 'Orbital Strike — Cryo Nova',
    category: 'COMBAT / WEAPONS',
    description: 'Legacy cryogenic orbital strike prototype.',
    icon: '/assets/cooldown_reduction.png',
    accentColor: '#38bdf8',
    isAttributeUpgrade: true,
    applyStack: () => {}
  },
  buff_skill_orbital_lance: {
    id: 'buff_skill_orbital_lance',
    name: 'ULTIMATE: Cataclysmic Lance',
    category: '★ ULTIMATE EVOLUTION',
    description: 'Legacy Orbital Lance prototype.',
    icon: '/assets/critical_damage.png',
    accentColor: '#f59e0b',
    isAttributeUpgrade: true,
    applyStack: () => {}
  },

  // --- EXCLUSIVE EVENT: CORRUPTION TRIAL MUTATIONS (Trial of Corruption) ---
  buff_corruption_dominance: {
    id: 'buff_corruption_dominance',
    name: 'MUTATION: Sovereign Dominion',
    category: '★ CORRUPTION MUTATION',
    description: 'Permanent +35% All Weapon Damage, +20% Movement Speed, and +15 Health Bio-Siphon on every elimination.',
    icon: '/assets/life_steal.png',
    accentColor: '#ec4899',
    exclusiveEvent: 'void_corruption',
    applyStack: (stats: CalculatedStats) => {
      stats.damageMultiplier += 0.35;
      stats.moveSpeed *= 1.20;
      stats.lifestealOnKill += 15;
    }
  },
  buff_corruption_chitin: {
    id: 'buff_corruption_chitin',
    name: 'MUTATION: Void Chitin Carapace',
    category: '★ CORRUPTION MUTATION',
    description: 'Permanent +180 Max Energy Shield, +25% Damage Reduction, and 60 Thorns reflected to attackers.',
    icon: '/assets/armor.png',
    accentColor: '#8b5cf6',
    exclusiveEvent: 'void_corruption',
    applyStack: (stats: CalculatedStats) => {
      stats.maxEnergyShield += 180;
      stats.damageReduction = Math.min(0.65, stats.damageReduction + 0.25);
      stats.thornsDamage += 60;
    }
  },
  buff_corruption_catalyst: {
    id: 'buff_corruption_catalyst',
    name: 'MUTATION: Bio-Catalyst Overdrive',
    category: '★ CORRUPTION MUTATION',
    description: 'Permanent -30% Cooldowns across all skills, +30% Attack Speed, and enemies drop +100% bonus Genes.',
    icon: '/assets/cooldown_reduction.png',
    accentColor: '#10b981',
    exclusiveEvent: 'void_corruption',
    applyStack: (stats: CalculatedStats) => {
      stats.dashCooldownMultiplier *= 0.70;
      stats.ultimateCooldownMultiplier *= 0.70;
      stats.attackSpeedMultiplier += 0.30;
    }
  }
};

export const ALL_BUFF_IDS: BuffId[] = Object.keys(BUFF_REGISTRY) as BuffId[];

/**
 * Picks 3 distinct BuffIds using the seeded RNG.
 * If filterEvent is supplied, draws EXCLUSIVELY from that event's pool!
 * If omitted, draws strictly from standard pure attribute upgrades (Chests / Level-up).
 */
export function rollThreeBuffChoices(
  rng: SeededRandom,
  filterEvent?: ExclusiveEventPool,
  heroId: HeroId = 'commander'
): BuffId[] {
  let pool: BuffId[];
  if (filterEvent) {
    pool = (Object.keys(BUFF_REGISTRY) as BuffId[]).filter((id) => {
      const def = BUFF_REGISTRY[id];
      if (def.exclusiveEvent !== filterEvent) return false;
      if (def.heroFilter && def.heroFilter !== heroId) return false;
      return true;
    });
    // Preserve deterministic Augment 1 / 2 / 3 order for exclusive ability shrines (Extended Dash is always #1!)
    if (filterEvent !== 'void_corruption') {
      return pool.slice(0, 3);
    }
  } else {
    pool = (Object.keys(BUFF_REGISTRY) as BuffId[]).filter(
      (id) =>
        !BUFF_REGISTRY[id].exclusiveEvent &&
        !BUFF_REGISTRY[id].replacesSkillSlot &&
        !BUFF_REGISTRY[id].enhancesSkillSlot &&
        (!BUFF_REGISTRY[id].heroFilter || BUFF_REGISTRY[id].heroFilter === heroId) &&
        BUFF_REGISTRY[id].isAttributeUpgrade !== false
    );
  }

  const choices: BuffId[] = [];
  while (choices.length < 3 && pool.length > 0) {
    const idx = Math.floor(rng.next() * pool.length);
    choices.push(pool[idx]);
    pool.splice(idx, 1);
  }
  return choices;
}

export function calculateStats(
  baseMaxHealth: number,
  baseMoveSpeed: number,
  items: Record<ItemId, number>,
  buffs?: Record<BuffId, number>
): CalculatedStats {
  const stats: CalculatedStats = {
    maxHealth: baseMaxHealth,
    healthRegen: 0.5,
    moveSpeed: baseMoveSpeed,
    attackSpeedMultiplier: 1.0,
    damageMultiplier: 1.0,
    chainSparkChance: 0,
    chainSparkDamage: 20,
    damageReduction: 0,
    dashCooldownMultiplier: 1.0,
    ultimateCooldownMultiplier: 1.0,
    ultimateRadiusMultiplier: 1.0,
    aoeRadiusMultiplier: 1.0,
    healingMultiplier: 1.0,
    skillDurationMultiplier: 1.0,
    pickupRadius: LOOT_CONFIG.basePickupRadius,

    critChance: 0.05,
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
    bouncingProjectiles: false
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

  return stats;
}

import { HeroId, SkillSlot, ItemDef } from './types';
import { HERO_REGISTRY } from './HeroDefs';
import {
  COMMANDER_DEFAULT_SKILLS,
  DOCTOR_DEFAULT_SKILLS
} from './SkillDefs';
import {
  ITEM_REGISTRY,
  BUFF_REGISTRY
} from './ItemDefs';

export interface AbilityPreviewData {
  id: string;
  name: string;
  slot: SkillSlot | 'passive';
  slotLabel: string;
  category: 'base' | 'upgrade' | 'passive_buff' | 'item';
  heroId: HeroId;
  icon: string;
  description: string;
  damage?: number | string;
  cooldown?: number | string;
  range?: number | string;
  statusEffects?: string[];
  eventSource?: string;
  baseComparison?: string;
  stackingBehavior?: string;
  statFormula?: string;
  hasVisualPreview: boolean;
}

// 12 Approved Commander Upgrades metadata mapped directly to Buff IDs
export const COMMANDER_UPGRADE_CONFIGS: Record<
  string,
  {
    buffId: string;
    slot: SkillSlot;
    slotLabel: string;
    name: string;
    icon: string;
    eventSource: string;
    damage: string;
    cooldown: string;
    range: string;
    statusEffects: string[];
    baseComparison: string;
    mechanics: string;
  }
> = {
  // Primary (LMB)
  chill_beam: {
    buffId: 'buff_chill_beam',
    slot: 'primary',
    slotLabel: 'PRIMARY [LMB] — UPGRADE 1',
    name: 'Chill Beam',
    icon: '/assets/defensive_protocol.png',
    eventSource: 'Ancient Bio-Resonance Totem',
    damage: '14 per tick (multi-hit)',
    cooldown: '0.65s (Continuous beam)',
    range: '520 units',
    statusEffects: ['Chill (40% slow for 2.5s)', 'Frost Decal'],
    baseComparison: 'Replaces single kinetic pistol shots with a continuous azure cryogenic beam that slows enemy movement by 40%.',
    mechanics: 'Fires an uninterrupted cryogenic beam toward the target cursor, inflicting rapid continuous cold damage and building deep chill stacks on all enemies struck.'
  },
  piercing_laser: {
    buffId: 'buff_piercing_laser',
    slot: 'primary',
    slotLabel: 'PRIMARY [LMB] — UPGRADE 2',
    name: 'Piercing Electric Laser',
    icon: '/assets/critical_damage.png',
    eventSource: 'Ancient Bio-Resonance Totem',
    damage: '38 energy damage (+75% per branch)',
    cooldown: '0.70s',
    range: '620 units',
    statusEffects: ['Electrified (+25% damage from all sources for 3s)', 'Infinite Line Pierce', 'Lightning Branching (+Projectiles)'],
    baseComparison: 'Replaces pistol shots with a concentrated violet-white electric laser beam that pierces through infinite enemies and spawns jagged secondary lightning branches to nearby targets with +Projectiles.',
    mechanics: 'Fires a bright, concentrated violet-white laser toward the primary target. Each +1 Projectile spawns a distinct secondary lightning branch originating along the beam that connects to a different nearby enemy with clear line-of-sight.'
  },
  extended_slash: {
    buffId: 'buff_buff_extended_slash', // fallback safe key
    buffIdActual: 'buff_extended_slash',
    slot: 'primary',
    slotLabel: 'PRIMARY [LMB] — UPGRADE 3',
    name: 'Extended Slash',
    icon: '/assets/attack_power.png',
    eventSource: 'Ancient Bio-Resonance Totem',
    damage: '54 kinetic slash damage',
    cooldown: '0.50s (Combo pace)',
    range: '340 units (Arc sweep)',
    statusEffects: ['Wide Cone Cleave', 'Light Stagger'],
    baseComparison: 'Converts primary attack into a heavy forward energy sword slash combo with sweeping golden blade arcs and broad area reach.',
    mechanics: 'Swings an energized blade projecting curved golden wave fronts that slice through clustered enemies in front of the Commander.'
  } as any,

  // Secondary (RMB)
  scissor_slash: {
    buffId: 'buff_scissor_slash',
    slot: 'secondary',
    slotLabel: 'SECONDARY [RMB] — UPGRADE 1',
    name: 'Scissor Slash',
    icon: '/assets/attack_power.png',
    eventSource: 'Kinetic Blade Conduit',
    damage: '88 heavy kinetic damage',
    cooldown: '3.0s',
    range: '125 radius convergence',
    statusEffects: ['Dual Crescent Inward Sweep', 'High Stagger Impact'],
    baseComparison: 'Enhances Cross Slash into twin colossal razor blade arcs sweeping inward from both flanks with closing scissor motion and explosive impact.',
    mechanics: 'Unleashes two colossal crescent energy blades that snap shut at the focal point in front of the Commander, shearing through dense swarms in high close-range AOE.'
  },
  frost_burst: {
    buffId: 'buff_frost_burst',
    slot: 'secondary',
    slotLabel: 'SECONDARY [RMB] — UPGRADE 2',
    name: 'Frost Burst',
    icon: '/assets/defensive_protocol.png',
    eventSource: 'Kinetic Blade Conduit',
    damage: '65 cryo damage (360° radial)',
    cooldown: '3.2s',
    range: '420 units radial mandala',
    statusEffects: ['360° Radial Ice Blast', 'Chill (35% slow)', 'Erupting Ice Spikes'],
    baseComparison: 'Replaces Cross Slash with an explosive 360-degree radial frost blast that blankets the battlefield in glacial ice spikes and deep chill.',
    mechanics: 'Unleashes an instantaneous 360-degree radial cryo shockwave and erupts jagged ice spikes from the thawed soil, applying Chill to all surrounding threats.'
  },
  orbiting_blade: {
    buffId: 'buff_orbiting_blade',
    slot: 'secondary',
    slotLabel: 'SECONDARY [RMB] — UPGRADE 3',
    name: 'Orbiting Electric Swords',
    icon: '/assets/item_overdrive.png',
    eventSource: 'Kinetic Blade Conduit',
    damage: '34 per contact strike (12.0s duration)',
    cooldown: '4.5s',
    range: '82 orbital radius (360° sweep)',
    statusEffects: ['Full 360° Orbit', 'Independent Localized Targeting', 'Electrified (+35% DMG taken)', 'Max 7 Swords'],
    baseComparison: 'Replaces Cross Slash with persistent crackling energy swords orbiting full 360° around Commander in depth-tested 3D space, capped at 7 swords.',
    mechanics: 'Summons up to 7 persistent crackling electric swords in a continuous full 360° orbital sweep around Commander. Each sword independently strikes the enemy nearest to its live orbital position, following smoothly during moving, jumping, and gliding.'
  },

  // Utility (Dash) — Extended Dash is Universal Augment 1 across all survivors
  extended_dash: {
    buffId: 'buff_extended_dash',
    slot: 'utility',
    slotLabel: 'UTILITY [SHIFT] — AUGMENT 1 (UNIVERSAL)',
    name: 'Extended Dash',
    icon: '/assets/doctor/icon_extended_dash.png',
    eventSource: 'Phase Thruster Pylon',
    damage: 'Doubles dash distance',
    cooldown: '3.5s',
    range: '2x Normal Distance',
    statusEffects: ['Universal Augment 1', 'Double Dash Velocity', 'White Afterimages'],
    baseComparison: 'Universal Augment 1 across all characters. Doubles dash distance.',
    mechanics: 'Supercharges mobility output to traverse double the character\'s normal dash distance in an instant.'
  },
  shock_dash: {
    buffId: 'buff_shock_dash',
    slot: 'utility',
    slotLabel: 'UTILITY [SHIFT] — UPGRADE 2',
    name: 'Shock Dash',
    icon: '/assets/combat_dash.png',
    eventSource: 'Phase Thruster Pylon',
    damage: '48 kinetic shockwave damage',
    cooldown: '3.5s',
    range: '130 units dash distance',
    statusEffects: ['Concussive Impact Shockwave', 'Enemy Knockback'],
    baseComparison: 'Dashes forward and detonates a massive golden shockwave at the first enemy collided with.',
    mechanics: 'Charges forward with bio-kinetic force. Upon colliding with an alien enemy, immediately unleashes an expanding kinetic shockwave that deals area damage and knocks surrounding foes back.'
  },
  teleport: {
    buffId: 'buff_teleport',
    slot: 'utility',
    slotLabel: 'UTILITY [SHIFT] — UPGRADE 3',
    name: 'Teleport',
    icon: '/assets/cooldown_reduction.png',
    eventSource: 'Phase Thruster Pylon',
    damage: '42 spatial distortion damage',
    cooldown: '4.2s',
    range: '280 units instantaneous warp',
    statusEffects: ['Instant Spatial Relocation', 'Dual Glyph Portals', 'Invulnerability during blink'],
    baseComparison: 'Replaces physical dash with instantaneous short-range spatial teleportation.',
    mechanics: 'Instantly dematerializes into glowing purple quantum glyph rings and appears at the destination target position, ignoring collision obstacles and enemy bodies.'
  },

  // Ultimate (R)
  singularity: {
    buffId: 'buff_singularity',
    slot: 'ultimate',
    slotLabel: 'ULTIMATE [R] — UPGRADE 1',
    name: 'Singularity',
    icon: '/assets/overseer_artifact.png',
    eventSource: 'Orbital Uplink Beacon',
    damage: '360 gravitational implosion damage',
    cooldown: '12.0s',
    range: '320 units gravitational pull',
    statusEffects: ['Mass Gravitational Vortex', 'Radial Enemy Pull', 'Implosion Shockwave'],
    baseComparison: 'Replaces direct orbital laser strike with a collapsing black hole that vacuums all enemies inward before detonating.',
    mechanics: 'Manifests a dark gravitational singularity at target coordinates. Actively pulls all nearby enemies into its center over 2.5 seconds before violently collapsing in a cataclysmic shockwave.'
  },
  convergence_barrage: {
    buffId: 'buff_convergence_barrage',
    slot: 'ultimate',
    slotLabel: 'ULTIMATE [R] — UPGRADE 2',
    name: 'Convergence Barrage',
    icon: '/assets/tactical_strike.png',
    eventSource: 'Orbital Uplink Beacon',
    damage: '420 total artillery damage (3 clusters)',
    cooldown: '13.5s',
    range: '380 units targeted sector',
    statusEffects: ['Triple Heavy Warheads', 'Staggered Impact Craters', 'Massive AOE'],
    baseComparison: 'Replaces single beam with 3 heavy staggered tactical orbital warheads that bombard the target sector.',
    mechanics: 'Paints a tri-coordinate target sector and calls down three massive orbital kinetic penetrators in rapid succession, wiping out clustered formations.'
  },
  cryogenic_impact: {
    buffId: 'buff_cryogenic_impact',
    slot: 'ultimate',
    slotLabel: 'ULTIMATE [R] — UPGRADE 3',
    name: 'Cryogenic Impact',
    icon: '/assets/defensive_protocol.png',
    eventSource: 'Orbital Uplink Beacon',
    damage: '320 glacial impact damage + cold field',
    cooldown: '11.0s',
    range: '280 radius persistent field',
    statusEffects: ['Glacial Ice Column', 'Persistent Freezing Field (4.0s)', '100% Freeze Stun'],
    baseComparison: 'Replaces pure energy laser with an orbital glacial drop that deploys a persistent freezing sub-zero field.',
    mechanics: 'Slams a colossal cryo-core from orbit onto the battlefield. Detonates in a frost shockwave and leaves a freezing permafrost zone that immobilizes and damages anything stepping inside.'
  }
};

/**
 * Retrieves base skills for a hero with full UI preview metadata
 */
export function getHeroBaseSkills(heroId: HeroId): AbilityPreviewData[] {
  const hero = HERO_REGISTRY[heroId];
  const list: AbilityPreviewData[] = [];

  // 1. Passive
  list.push({
    id: `${heroId}_passive`,
    name: hero.passiveName,
    slot: 'passive',
    slotLabel: 'INHERENT PASSIVE',
    category: 'base',
    heroId,
    icon: heroId === 'commander' ? '/assets/armor.png' : '/assets/health.png',
    description: hero.passiveDesc,
    statusEffects: heroId === 'commander' ? ['35% Damage Shield (2.5s)'] : ['+3 to +7 HP/s Regeneration'],
    hasVisualPreview: false
  });

  // 2. Base Active Skills
  const defaultSkills = heroId === 'commander' ? COMMANDER_DEFAULT_SKILLS : DOCTOR_DEFAULT_SKILLS;
  const slots: SkillSlot[] = ['primary', 'secondary', 'utility', 'ultimate'];
  const slotLabels: Record<SkillSlot, string> = {
    primary: 'PRIMARY [LMB]',
    secondary: 'SECONDARY [RMB]',
    utility: 'UTILITY [SHIFT]',
    ultimate: 'ULTIMATE [R]'
  };

  for (const slot of slots) {
    const s = defaultSkills[slot];
    list.push({
      id: s.id,
      name: s.name,
      slot,
      slotLabel: slotLabels[slot],
      category: 'base',
      heroId,
      icon: s.icon || '/assets/rally_command.png',
      description: s.description,
      damage: `${s.baseDamage} base damage`,
      cooldown: `${s.cooldown}s`,
      range: `${s.range} units`,
      statusEffects: [
        slot === 'primary' ? 'Direct Aim' : '',
        slot === 'secondary' ? 'Area of Effect' : '',
        slot === 'utility' ? 'Rapid Mobility' : '',
        slot === 'ultimate' ? 'High Impact' : ''
      ].filter(Boolean),
      baseComparison: 'Standard tactical issue configuration for Vanguard field operatives.',
      hasVisualPreview: true
    });
  }

  return list;
}

/**
 * Retrieves all approved upgrade variants for a hero organized by base skill
 */
export function getHeroSkillUpgrades(heroId: HeroId): {
  slot: SkillSlot;
  slotLabel: string;
  baseSkillName: string;
  upgrades: AbilityPreviewData[];
}[] {
  if (heroId === 'commander') {
    const result: {
      slot: SkillSlot;
      slotLabel: string;
      baseSkillName: string;
      upgrades: AbilityPreviewData[];
    }[] = [];

    const slotConfigs: { slot: SkillSlot; label: string; baseName: string; keys: string[] }[] = [
      {
        slot: 'primary',
        label: 'PRIMARY ATTACK [LMB] UPGRADES',
        baseName: 'Service Pistol',
        keys: ['chill_beam', 'piercing_laser', 'extended_slash']
      },
      {
        slot: 'secondary',
        label: 'SECONDARY ATTACK [RMB] UPGRADES',
        baseName: 'Cross Slash',
        keys: ['scissor_slash', 'frost_burst', 'orbiting_blade']
      },
      {
        slot: 'utility',
        label: 'DASH & MOBILITY [SHIFT] UPGRADES',
        baseName: 'Impact Dash',
        keys: ['extended_dash', 'shock_dash', 'teleport']
      },
      {
        slot: 'ultimate',
        label: 'ULTIMATE STRIKE [R] UPGRADES',
        baseName: 'Orbital Strike',
        keys: ['singularity', 'convergence_barrage', 'cryogenic_impact']
      }
    ];

    for (const group of slotConfigs) {
      const upgrades: AbilityPreviewData[] = [];
      for (const key of group.keys) {
        const conf = COMMANDER_UPGRADE_CONFIGS[key];
        if (conf) {
          upgrades.push({
            id: key,
            name: conf.name,
            slot: conf.slot,
            slotLabel: conf.slotLabel,
            category: 'upgrade',
            heroId: 'commander',
            icon: conf.icon,
            description: conf.mechanics,
            damage: conf.damage,
            cooldown: conf.cooldown,
            range: conf.range,
            statusEffects: conf.statusEffects,
            eventSource: conf.eventSource,
            baseComparison: conf.baseComparison,
            hasVisualPreview: true
          });
        }
      }
      result.push({
        slot: group.slot,
        slotLabel: group.label,
        baseSkillName: group.baseName,
        upgrades
      });
    }

    return result;
  }

  // Doctor 12 Approved Skill Augments (Extended Dash is Universal Augment 1)
  return [
    {
      slot: 'primary',
      slotLabel: 'PRIMARY [LMB] AUGMENTS',
      baseSkillName: 'Rapid Dual Pistols',
      upgrades: [
        {
          id: 'toxic_chain',
          name: 'Toxic Chain',
          slot: 'primary',
          slotLabel: 'LMB — AUGMENT 1',
          category: 'upgrade',
          heroId: 'doctor',
          icon: '/assets/doctor/icon_toxic_chain.png',
          description: 'Bullets ricochet between nearby enemies applying poison stacks. Reaching 3 stacks triggers a toxic explosion consuming the stacks.',
          damage: '15 bolt + 48 burst at 3 stacks',
          cooldown: '0.36s',
          range: '520 units (+210 bounce)',
          statusEffects: ['Poison DoT', '3-Stack Toxic Explosion', '+Projectiles Initial Bolts'],
          eventSource: 'Ancient Bio-Resonance Totem',
          baseComparison: 'Converts rapid dual shots into ricocheting toxic bio-bolts with stackable detonation.',
          hasVisualPreview: true
        },
        {
          id: 'cryogenic_scalpel',
          name: 'Cryogenic Scalpel',
          slot: 'primary',
          slotLabel: 'LMB — AUGMENT 2',
          category: 'upgrade',
          heroId: 'doctor',
          icon: '/assets/doctor/icon_cryo_scalpel.png',
          description: 'Throws ice-infused returning surgical scalpels (1 base, +1 per Projectile up to 7) that cut twice and leave a 1.25s terrain frost wake.',
          damage: '32 per pass (Out & Return)',
          cooldown: '0.62s',
          range: '430 units boomerang',
          statusEffects: ['1.25s Terrain Frost Wake', 'Chill Slow', '+Projectiles (Max 7)'],
          eventSource: 'Ancient Bio-Resonance Totem',
          baseComparison: 'Replaces pistols with returning cryo surgical blades and a 1.25s terrain chill wake.',
          hasVisualPreview: true
        },
        {
          id: 'vital_extraction',
          name: 'Vital Extraction',
          slot: 'primary',
          slotLabel: 'LMB — AUGMENT 3',
          category: 'upgrade',
          heroId: 'doctor',
          icon: '/assets/doctor/icon_vital_extraction.png',
          description: 'Connects 3 simultaneous luminous green extraction tethers (+1 per Projectile) that continuously drain enemy HP and heal Doctor.',
          damage: '12 per 0.25s per tether',
          cooldown: 'Continuous Beam',
          range: '390 units',
          statusEffects: ['3+N Simultaneous Tethers', 'Self Lifesteal Heal', 'Prioritizes Distinct Targets'],
          eventSource: 'Ancient Bio-Resonance Totem',
          baseComparison: 'Replaces pistols with continuous multi-target healing/draining medical beams.',
          hasVisualPreview: true
        }
      ]
    },
    {
      slot: 'secondary',
      slotLabel: 'SECONDARY [RMB] AUGMENTS',
      baseSkillName: 'Toxic Grenade',
      upgrades: [
        {
          id: 'experimental_drones',
          name: 'Experimental Drones',
          slot: 'secondary',
          slotLabel: 'RMB — AUGMENT 1',
          category: 'upgrade',
          heroId: 'doctor',
          icon: '/assets/doctor/icon_experimental_drones.png',
          description: 'Deploys invincible hovering medical-combat drones (1 base, +1 per Projectile up to 7) that orbit and attack enemies independently.',
          damage: '16 per autonomous drone shot',
          cooldown: 'Continuous + 4.0s Overcharge',
          range: '440 units targeting',
          statusEffects: ['Invincible Drones', '+Projectiles up to 7 Drones'],
          eventSource: 'Kinetic Blade Conduit',
          baseComparison: 'Replaces Toxic Grenade with persistent autonomous medical combat drones.',
          hasVisualPreview: true
        },
        {
          id: 'toxic_cluster_bomb',
          name: 'Toxic Cluster Bomb',
          slot: 'secondary',
          slotLabel: 'RMB — AUGMENT 2',
          category: 'upgrade',
          heroId: 'doctor',
          icon: '/assets/doctor/icon_toxic_cluster.png',
          description: 'Launches fragmentation toxic bombs (1 base, +1 per Projectile up to 5) that split into scattering sub-bombs leaving organic acid splatters.',
          damage: '36 main + 5x 24 sub-bombs',
          cooldown: '4.6s',
          range: '480 units + scatter',
          statusEffects: ['Up to 5 Main Bombs', 'Multi-Zone Acid Splatters', 'Slow + DoT'],
          eventSource: 'Kinetic Blade Conduit',
          baseComparison: 'Expands Toxic Grenade into sweeping multi-bomb area saturation.',
          hasVisualPreview: true
        },
        {
          id: 'holographic_decoy',
          name: 'Holographic Decoy',
          slot: 'secondary',
          slotLabel: 'RMB — AUGMENT 3',
          category: 'upgrade',
          heroId: 'doctor',
          icon: '/assets/doctor/icon_holo_decoy.png',
          description: 'Projects a running holographic Doctor directly ahead (+1 per Projectile) that taunts nearby foes, shatters in 2 hits or timeout, and detonates in toxic goo.',
          damage: '52 detonation blast + Toxic DoT',
          cooldown: '5.5s',
          range: 'Front deploy / 350 taunt radius',
          statusEffects: ['Runs Straight Ahead', 'Strictly 2-Hit Limit', 'Toxic Explosion + Goo'],
          eventSource: 'Kinetic Blade Conduit',
          baseComparison: 'Replaces Toxic Grenade with mobile taunting Doctor projections.',
          hasVisualPreview: true
        }
      ]
    },
    {
      slot: 'utility',
      slotLabel: 'DASH [SHIFT] AUGMENTS',
      baseSkillName: 'Therapeutic Pass',
      upgrades: [
        {
          id: 'extended_dash',
          name: 'Extended Dash',
          slot: 'utility',
          slotLabel: 'DASH — AUGMENT 1 (UNIVERSAL)',
          category: 'upgrade',
          heroId: 'doctor',
          icon: '/assets/doctor/icon_extended_dash.png',
          description: 'Universal augment. Doubles the character\'s dash distance — Doctor\'s already 1.5× longer Therapeutic Pass becomes 3.0× standard dash reach.',
          damage: '48 pass-through damage / 32 ally heal',
          cooldown: '4.0s',
          range: '3.0x Commander Dash Distance',
          statusEffects: ['Universal Augment 1', 'Doubled Dash Distance', 'White Afterimages'],
          eventSource: 'Phase Thruster Pylon',
          baseComparison: 'Doubles Therapeutic Pass distance while preserving full heal/damage pass-through.',
          hasVisualPreview: true
        },
        {
          id: 'phase_barrier',
          name: 'Phase Barrier',
          slot: 'utility',
          slotLabel: 'DASH — AUGMENT 2',
          category: 'upgrade',
          heroId: 'doctor',
          icon: '/assets/doctor/icon_phase_barrier.png',
          description: 'Gain complete damage immunity during the dash, persisting in a protective hexagonal energy shield for 1.0 second after the dash ends.',
          damage: '48 pass-through + 1.0s Post-Dash Immunity',
          cooldown: '4.0s',
          range: '1.5x Dash Distance',
          statusEffects: ['Full Damage Immunity', '1.0s Post-Dash Shield Dome'],
          eventSource: 'Phase Thruster Pylon',
          baseComparison: 'Grants 1 second of lingered invulnerability after Therapeutic Pass finishes.',
          hasVisualPreview: true
        },
        {
          id: 'adrenaline_rush',
          name: 'Adrenaline Rush',
          slot: 'utility',
          slotLabel: 'DASH — AUGMENT 3',
          category: 'upgrade',
          heroId: 'doctor',
          icon: '/assets/doctor/icon_adrenaline_rush.png',
          description: 'After dashing, gain a +50% burst of movement speed for 1.5 seconds for aggressive kiting and repositioning.',
          damage: '48 pass-through + 1.5s Speed Surge',
          cooldown: '4.0s',
          range: '1.5x Dash Distance',
          statusEffects: ['+50% Move Speed (1.5s)', 'Speedline Aura'],
          eventSource: 'Phase Thruster Pylon',
          baseComparison: 'Chains Therapeutic Pass directly into a sustained 1.5s sprint boost.',
          hasVisualPreview: true
        }
      ]
    },
    {
      slot: 'ultimate',
      slotLabel: 'ULTIMATE [R] AUGMENTS',
      baseSkillName: 'Sacred Medical Field',
      upgrades: [
        {
          id: 'mobile_sanctuary',
          name: 'Mobile Sanctuary',
          slot: 'ultimate',
          slotLabel: 'ULTIMATE — AUGMENT 1',
          category: 'upgrade',
          heroId: 'doctor',
          icon: '/assets/doctor/icon_mobile_sanctuary.png',
          description: 'Transforms Sacred Medical Field into a single giant rapidly rotating luminous cross that moves with Doctor continuously for 5s.',
          damage: '32 DoT per 0.5s + Self/Ally Buffs',
          cooldown: '13.0s',
          range: '240 arm length (360° Sweep)',
          statusEffects: ['Follows Doctor', 'Rapid Cross Rotation', '+30% ATK SPD & DMG + Heal'],
          eventSource: 'Orbital Uplink Beacon',
          baseComparison: 'Makes the stationary Sacred Medical Cross mobile and spinning around Doctor.',
          hasVisualPreview: true
        },
        {
          id: 'divine_intervention',
          name: 'Divine Intervention',
          slot: 'ultimate',
          slotLabel: 'ULTIMATE — AUGMENT 2',
          category: 'upgrade',
          heroId: 'doctor',
          icon: '/assets/doctor/icon_divine_intervention.png',
          description: 'Projects a 3s sacred medical cross and calls four radiant beams summoning 4 invincible non-humanoid celestial constructs that fire energy bolts for 10 seconds.',
          damage: '28 sacred bolts (4 Entities, 10s) + 3s Cross',
          cooldown: '13.0s',
          range: '480 units entity targeting',
          statusEffects: ['4 Invincible Celestial Entities (10s)', '3s Ground Cross', 'Independent Entity Lifetime'],
          eventSource: 'Orbital Uplink Beacon',
          baseComparison: 'Trades 2s of cross duration for four long-lived autonomous celestial guardians.',
          hasVisualPreview: true
        },
        {
          id: 'rain_of_crosses',
          name: 'Rain of Crosses',
          slot: 'ultimate',
          slotLabel: 'ULTIMATE — AUGMENT 3',
          category: 'upgrade',
          heroId: 'doctor',
          icon: '/assets/doctor/icon_rain_of_crosses.png',
          description: 'For 5s, sacred crosses randomly rain down from above (+Projectiles adds wave crosses), leaving buffing & burning ground crosses until the rain ends.',
          damage: '44 impact + 16 DoT fields',
          cooldown: '13.0s',
          range: '260 units rain zone',
          statusEffects: ['5s Fixed Rain Timer', '+Projectiles Wave Count', 'Synced Field Expiry'],
          eventSource: 'Orbital Uplink Beacon',
          baseComparison: 'Replaces single giant cross with randomized falling sacred crosses and linked mini-fields.',
          hasVisualPreview: true
        }
      ]
    }
  ];
}

/**
 * Retrieves all obtainable passive buffs & items catalog with detailed mechanics and stacking behavior
 */
export function getAllPassiveBuffsCatalog(): {
  physicalItems: AbilityPreviewData[];
  passiveBuffs: AbilityPreviewData[];
} {
  // 1. Physical Dropped Items from ITEM_REGISTRY
  const physicalItems: AbilityPreviewData[] = Object.values(ITEM_REGISTRY).map((item: ItemDef) => {
    let stacking = 'Linear (+1 stack multiplier)';
    if (item.id === 'overdrive') stacking = 'Linear: +25% attack speed per stack.';
    else if (item.id === 'vital_core') stacking = 'Additive: +45 Max HP per stack.';
    else if (item.id === 'chain_spark') stacking = 'Chance stays 25%; shock damage scales +18 per stack.';

    return {
      id: item.id,
      name: item.name,
      slot: 'passive',
      slotLabel: 'PHYSICAL FIELD DROP',
      category: 'item',
      heroId: 'commander',
      icon: item.icon,
      description: item.description,
      stackingBehavior: stacking,
      statusEffects: [
        item.id === 'overdrive' ? '+25% Fire Rate' : '',
        item.id === 'vital_core' ? '+45 Max Health' : '',
        item.id === 'chain_spark' ? '25% Chain Lightning' : ''
      ].filter(Boolean),
      baseComparison: 'Permanent item pickup collected from opened Bio-Sacs and elite alien drops.',
      hasVisualPreview: false
    };
  });

  // 2. All Passive Augment Buffs from BUFF_REGISTRY (excluding the 12 event upgrade buffs)
  const eventBuffIds = new Set([
    'buff_chill_beam',
    'buff_piercing_laser',
    'buff_extended_slash',
    'buff_scissor_slash',
    'buff_frost_burst',
    'buff_orbiting_blade',
    'buff_shock_dash',
    'buff_extended_dash',
    'buff_teleport',
    'buff_singularity',
    'buff_convergence_barrage',
    'buff_cryogenic_impact'
  ]);

  const passiveBuffs: AbilityPreviewData[] = [];
  for (const [buffId, buff] of Object.entries(BUFF_REGISTRY)) {
    if (eventBuffIds.has(buffId)) continue; // skip active skill evolutions

    let stacking = 'Linear: Each additional rank adds +1 stack coefficient.';
    if (buff.category?.includes('LEGENDARY') || buff.id.includes('drone')) {
      stacking = 'Unique / Diminishing: Maximum effectiveness reached at early stacks.';
    }

    passiveBuffs.push({
      id: buff.id,
      name: buff.name,
      slot: 'passive',
      slotLabel: buff.category || 'PASSIVE COMBAT AUGMENT',
      category: 'passive_buff',
      heroId: 'commander',
      icon: buff.icon || '/assets/attack_power.png',
      description: buff.description,
      stackingBehavior: stacking,
      statusEffects: [buff.category || 'Passive Buff'],
      baseComparison: 'Acquired during run through Tactical Rank XP choices and mutation caches.',
      hasVisualPreview: false
    });
  }

  return { physicalItems, passiveBuffs };
}

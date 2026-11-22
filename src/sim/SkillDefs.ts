import { SkillDef } from './types';
import { DOCTOR_CONFIG } from './DoctorConfig';

// --- PRIMARY SKILLS ---
export const SKILL_ENERGY_PULSE: SkillDef = {
  slot: 'primary',
  id: 'energy_pulse',
  name: 'Service Pistol',
  cooldown: 0.65,
  range: 900,
  baseDamage: 15,
  description: 'Fires standard high-velocity military pistol rounds at the nearest valid target.',
  icon: '/assets/rally_command.png'
};

export const SKILL_SCATTER_BLASTER: SkillDef = {
  slot: 'primary',
  id: 'scatter_blaster',
  name: 'Scatter Blaster',
  cooldown: 0.85,
  range: 700,
  baseDamage: 18, // 3 pellets x 18 = 54 damage point blank!
  description: 'Fires a high-impact tri-slug spread of searing plasma pellets in a cone.',
  icon: '/assets/rally_command.png'
};

export const SKILL_ARC_CANNON: SkillDef = {
  slot: 'primary',
  id: 'arc_cannon',
  name: 'Arc Cannon',
  cooldown: 0.72,
  range: 860,
  baseDamage: 24,
  description: 'Discharges an instant chain-lightning bolt that arcs through up to 3 nearby foes.',
  icon: '/assets/item_chain_spark.png'
};

export const SKILL_HYPER_BEAM: SkillDef = {
  slot: 'primary',
  id: 'hyper_beam',
  name: 'Hyper-Plasma Lance',
  cooldown: 0.55,
  range: 1080,
  baseDamage: 38,
  description: 'Fires an instant, high-energy piercing laser beam that vaporizes all enemies along its line.',
  icon: '/assets/proj_wave.png'
};

export const SKILL_GATLING_MINIGUN: SkillDef = {
  slot: 'primary',
  id: 'gatling_minigun',
  name: 'Bio-Kinetic Minigun',
  cooldown: 0.20,
  range: 920,
  baseDamage: 16,
  description: 'Unleashes a blistering dual-stream barrage of high-velocity golden tracer needles.',
  icon: '/assets/item_overdrive.png'
};

// --- SECONDARY SKILLS ---
export const SKILL_EXPLOSIVE_BOMB: SkillDef = {
  slot: 'secondary',
  id: 'explosive_bomb',
  name: 'Cross Slash',
  cooldown: 3.4,
  range: 920,
  baseDamage: 72,
  description: 'Unleashes two golden scissor-like blades crossing in front in an X-shaped arc, dealing heavy area damage.',
  icon: '/assets/defensive_protocol.png'
};

export const SKILL_CROSS_SLASH = SKILL_EXPLOSIVE_BOMB;

export const SKILL_PIERCING_WAVE: SkillDef = {
  slot: 'secondary',
  id: 'piercing_wave',
  name: 'Defensive Protocol',
  cooldown: 3.0,
  range: 1000,
  baseDamage: 54,
  description: 'Unleashes a broad kinetic energy wave that pierces through lines of enemies.',
  icon: '/assets/defensive_protocol.png'
};

export const SKILL_CRYO_GRENADE: SkillDef = {
  slot: 'secondary',
  id: 'cryo_grenade',
  name: 'Cryo Grenade',
  cooldown: 3.8,
  range: 920,
  baseDamage: 68,
  description: 'Launches an explosive cryo canister that chills and freezes enemies in a frost blast.',
  icon: '/assets/defensive_protocol.png'
};

export const SKILL_GRAVITY_VORTEX: SkillDef = {
  slot: 'secondary',
  id: 'gravity_vortex',
  name: 'Gravity Vortex',
  cooldown: 4.5,
  range: 960,
  baseDamage: 75,
  description: 'Fires a miniature gravitational singularity that pulls all enemies inward before imploding.',
  icon: '/assets/defensive_protocol.png'
};

// --- UTILITY SKILLS ---
export const SKILL_TACTICAL_DASH: SkillDef = {
  slot: 'utility',
  id: 'tactical_dash',
  name: 'Impact Dash',
  cooldown: 3.5,
  range: 220,
  baseDamage: 48,
  description: 'High-speed tactical dash. Colliding with an enemy triggers a concussive shockwave that damages nearby foes.',
  icon: '/assets/combat_dash.png'
};

export const SKILL_BLINK_WARP: SkillDef = {
  slot: 'utility',
  id: 'blink_warp',
  name: 'Phase Blink',
  cooldown: 4.2,
  range: 500,
  baseDamage: 35,
  description: 'Instantly teleports in moving direction, triggering a shockwave upon arrival.',
  icon: '/assets/combat_dash.png'
};

// --- ULTIMATE SKILLS ---
export const SKILL_ORBITAL_JUDGMENT: SkillDef = {
  slot: 'ultimate',
  id: 'orbital_judgment',
  name: 'Orbital Strike',
  cooldown: 11.0,
  range: 620,
  baseDamage: 240,
  description: 'Calls down an orbital satellite energy strike from high above, detonating in an expanding shockwave.',
  icon: '/assets/tactical_strike.png'
};

export const SKILL_CARPET_NUKE: SkillDef = {
  slot: 'ultimate',
  id: 'carpet_nuke',
  name: 'Carpet Nuke Barrage',
  cooldown: 14.0,
  range: 1350,
  baseDamage: 260,
  description: 'Calls in a devastating 5-cluster nuclear airstrike that bombards the entire sector in flames.',
  icon: '/assets/tactical_strike.png'
};

export const SKILL_ORBITAL_LANCE: SkillDef = {
  slot: 'ultimate',
  id: 'orbital_lance',
  name: 'Cataclysmic Lance',
  cooldown: 9.0,
  range: 1000,
  baseDamage: 480,
  description: 'Unleashes a colossal crimson-gold orbital laser column that incinerates a massive radius.',
  icon: '/assets/critical_damage.png'
};

export const SKILL_JUDGEMENT_SINGULARITY: SkillDef = {
  slot: 'ultimate',
  id: 'judgement_singularity',
  name: 'Judgement Singularity',
  cooldown: 11.0,
  range: 900,
  baseDamage: 360,
  description: 'Collapses space into a gravitational black hole that pulls all nearby enemies inward before imploding.',
  icon: '/assets/overseer_artifact.png'
};

export const SKILL_CHRONO_STASIS: SkillDef = {
  slot: 'ultimate',
  id: 'chrono_stasis',
  name: 'Chrono-Stasis Strike',
  cooldown: 7.5,
  range: 820,
  baseDamage: 280,
  description: 'Detonates a temporal stasis field that freezes and stuns all enemies in place for 5 seconds.',
  icon: '/assets/cooldown_reduction.png'
};

export const COMMANDER_DEFAULT_SKILLS = {
  primary: SKILL_ENERGY_PULSE,
  secondary: SKILL_EXPLOSIVE_BOMB,
  utility: SKILL_TACTICAL_DASH,
  ultimate: SKILL_ORBITAL_JUDGMENT
};

export const COMMANDER_SKILLS = COMMANDER_DEFAULT_SKILLS;

// --- DOCTOR SURVIVOR SKILLS (DUAL PISTOLS / TOXIC GRENADE / THERAPEUTIC PASS / SACRED MEDICAL FIELD) ---
export const SKILL_MEDICAL_PULSE: SkillDef = {
  slot: 'primary',
  id: 'medical_pulse',
  name: 'Rapid Dual Pistols',
  cooldown: DOCTOR_CONFIG.lmb.cooldown,
  range: DOCTOR_CONFIG.lmb.range,
  baseDamage: DOCTOR_CONFIG.lmb.baseDamage,
  description: 'Alternates Left → Right firing rapid green energy bolts at ~2× baseline cadence.',
  icon: '/assets/doctor/icon_dual_pistols.png'
};

export const SKILL_TOXIC_CONTAMINATION: SkillDef = {
  slot: 'secondary',
  id: 'toxic_contamination',
  name: 'Toxic Grenade',
  cooldown: DOCTOR_CONFIG.rmb.cooldown,
  range: DOCTOR_CONFIG.rmb.range,
  baseDamage: DOCTOR_CONFIG.rmb.baseDamage,
  description: 'Throws a terrain-hugging toxic grenade that detonates into an organic chemical splatter, slowing and eroding enemies over time.',
  icon: '/assets/doctor/icon_toxic_grenade.png'
};

export const SKILL_MEDICAL_RUSH: SkillDef = {
  slot: 'utility',
  id: 'medical_rush',
  name: 'Therapeutic Pass',
  cooldown: DOCTOR_CONFIG.therapeuticPass.cooldown,
  range: 0,
  baseDamage: DOCTOR_CONFIG.therapeuticPass.enemyDamage,
  description: 'Travels 1.5× normal dash distance leaving white silhouette afterimages; heals Doctor/allies and damages enemies passed through.',
  icon: '/assets/doctor/icon_therapeutic_pass.png'
};

export const SKILL_SANCTUARY_CROSS: SkillDef = {
  slot: 'ultimate',
  id: 'sanctuary_cross',
  name: 'Sacred Medical Field',
  cooldown: DOCTOR_CONFIG.sacredField.cooldown,
  range: DOCTOR_CONFIG.sacredField.armHalfLength,
  baseDamage: DOCTOR_CONFIG.sacredField.pulseDamage,
  description: 'Levitates in a radiant cross cast, deploying a 5s luminous medical field that heals and buffs allies/self (+ATK SPD / +DMG) while burning enemies inside.',
  icon: '/assets/doctor/icon_sacred_field.png'
};

// Preserved legacy/alternative Doctor skills
export const SKILL_SEDATIVE_DOSE: SkillDef = {
  slot: 'secondary',
  id: 'sedative_dose',
  name: 'Sedative Dose',
  cooldown: 3.5,
  range: 980,
  baseDamage: 45,
  description: 'Fires a concentrated neuro-sedative syringe that incapacitates and stuns an enemy for 2.5s.',
  icon: '/assets/doctor/skill_sedative_dose.png'
};

export const SKILL_RECOVERY_FIELD: SkillDef = {
  slot: 'utility',
  id: 'recovery_field',
  name: 'Recovery Field',
  cooldown: 6.0,
  range: 270,
  baseDamage: 0,
  description: 'Deploys a localized bio-regenerative nanite field that continuously restores health over 5 seconds while repositioning.',
  icon: '/assets/doctor/skill_recovery_field.png'
};

export const SKILL_EMERGENCY_PROTOCOL: SkillDef = {
  slot: 'ultimate',
  id: 'emergency_protocol',
  name: 'Emergency Protocol',
  cooldown: 12.0,
  range: 500,
  baseDamage: 180,
  description: 'Surges massive medical energy that rapidly heals Doctor and emits a disabling shockwave stunning nearby enemies for 3s.',
  icon: '/assets/doctor/skill_emergency_protocol.png'
};

export const DOCTOR_DEFAULT_SKILLS = {
  primary: SKILL_MEDICAL_PULSE,
  secondary: SKILL_TOXIC_CONTAMINATION,
  utility: SKILL_MEDICAL_RUSH,
  ultimate: SKILL_SANCTUARY_CROSS
};

export const DOCTOR_SKILLS = DOCTOR_DEFAULT_SKILLS;

export const SKILL_REGISTRY: Record<string, SkillDef> = {
  energy_pulse: SKILL_ENERGY_PULSE,
  scatter_blaster: SKILL_SCATTER_BLASTER,
  arc_cannon: SKILL_ARC_CANNON,
  hyper_beam: SKILL_HYPER_BEAM,
  gatling_minigun: SKILL_GATLING_MINIGUN,
  explosive_bomb: SKILL_EXPLOSIVE_BOMB,
  piercing_wave: SKILL_PIERCING_WAVE,
  cryo_grenade: SKILL_CRYO_GRENADE,
  gravity_vortex: SKILL_GRAVITY_VORTEX,
  tactical_dash: SKILL_TACTICAL_DASH,
  blink_warp: SKILL_BLINK_WARP,
  orbital_judgment: SKILL_ORBITAL_JUDGMENT,
  carpet_nuke: SKILL_CARPET_NUKE,
  orbital_lance: SKILL_ORBITAL_LANCE,
  judgement_singularity: SKILL_JUDGEMENT_SINGULARITY,
  chrono_stasis: SKILL_CHRONO_STASIS,
  medical_pulse: SKILL_MEDICAL_PULSE,
  toxic_contamination: SKILL_TOXIC_CONTAMINATION,
  medical_rush: SKILL_MEDICAL_RUSH,
  sanctuary_cross: SKILL_SANCTUARY_CROSS,
  sedative_dose: SKILL_SEDATIVE_DOSE,
  recovery_field: SKILL_RECOVERY_FIELD,
  emergency_protocol: SKILL_EMERGENCY_PROTOCOL
};

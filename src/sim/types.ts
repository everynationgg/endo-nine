import type { ArtifactPhase } from './StageProgressionPolicy';

export interface Vector2 {
  x: number;
  y: number;
}

export interface Vector3 {
  x: number;
  y: number;
  z: number;
}

export type Direction4 = 'front' | 'back' | 'left' | 'right';

export type HeroId = 'commander' | 'doctor';

export type SkillSlot = 'primary' | 'secondary' | 'utility' | 'ultimate';

export type ItemId = 'overdrive' | 'vital_core' | 'chain_spark';

export type BuffId =
  // Commander 12 Approved Skill Enhancement Augments (Exclusive to World Events)
  | 'buff_chill_beam'
  | 'buff_piercing_laser'
  | 'buff_extended_slash'
  | 'buff_scissor_slash'
  | 'buff_frost_burst'
  | 'buff_orbiting_blade'
  | 'buff_shock_dash'
  | 'buff_extended_dash'
  | 'buff_teleport'
  | 'buff_singularity'
  | 'buff_convergence_barrage'
  | 'buff_cryogenic_impact'
  // Doctor 11 Approved Skill Enhancement Augments (extended_dash is Universal Augment)
  | 'buff_toxic_chain'
  | 'buff_cryogenic_scalpel'
  | 'buff_vital_extraction'
  | 'buff_experimental_drones'
  | 'buff_toxic_cluster_bomb'
  | 'buff_holographic_decoy'
  | 'buff_phase_barrier'
  | 'buff_adrenaline_rush'
  | 'buff_mobile_sanctuary'
  | 'buff_divine_intervention'
  | 'buff_rain_of_crosses'
  // Universal Buffs (18: U01–U18)
  | 'buff_momentum'
  | 'buff_thruster_core'
  | 'buff_fuel_recycler'
  | 'buff_aerial_boost'
  | 'buff_overcharge'
  | 'buff_precision'
  | 'buff_critical_surge'
  | 'buff_rapid_fire'
  | 'buff_vitality'
  | 'buff_reinforced_plating'
  | 'buff_regeneration'
  | 'buff_life_siphon'
  | 'buff_thorns'
  | 'buff_emergency_barrier'
  | 'buff_accelerator'
  | 'buff_magnetic_field'
  | 'buff_fortune'
  | 'buff_area_amplifier'
  // Trigger Buffs (15: T01–T15)
  | 'buff_chain_reaction'
  | 'buff_blood_rush'
  | 'buff_second_wind'
  | 'buff_executioner'
  | 'buff_combat_focus'
  | 'buff_final_stand'
  | 'buff_static_discharge'
  | 'buff_aftershock'
  | 'buff_retaliation'
  | 'buff_cooldown_harvest'
  | 'buff_fuel_harvest'
  | 'buff_killing_momentum'
  | 'buff_reactive_shield'
  | 'buff_overkill'
  | 'buff_survival_instinct'
  // Commander Augment-Specific Buffs (24: C-LMB-01..06, C-RMB-01..06, C-DASH-01..06, C-ULT-01..06)
  | 'buff_cmd_cryo_amplification'
  | 'buff_cmd_thermal_focus'
  | 'buff_cmd_penetration_core'
  | 'buff_cmd_coherent_optics'
  | 'buff_cmd_blade_reach'
  | 'buff_cmd_heavy_swing'
  | 'buff_cmd_twin_edge'
  | 'buff_cmd_serrated_cut'
  | 'buff_cmd_shatter_nova'
  | 'buff_cmd_deep_freeze'
  | 'buff_cmd_orbital_extension'
  | 'buff_cmd_razor_satellites'
  | 'buff_cmd_impulse_capacitor'
  | 'buff_cmd_kinetic_stride'
  | 'buff_cmd_kinetic_shell'
  | 'buff_cmd_concussive_wave'
  | 'buff_cmd_adrenal_extension'
  | 'buff_cmd_velocity_surge'
  | 'buff_cmd_gravitational_pull'
  | 'buff_cmd_event_horizon'
  | 'buff_cmd_concentrated_salvo'
  | 'buff_cmd_pinpoint_collapse'
  | 'buff_cmd_subzero_detonation'
  | 'buff_cmd_permafrost_field'
  // Doctor Augment-Specific Buffs (24: D-LMB-01..06, D-RMB-01..06, D-DASH-01..06, D-ULT-01..06)
  | 'buff_doc_contagion_return'
  | 'buff_doc_overdose_catalyst'
  | 'buff_doc_surgical_edge'
  | 'buff_doc_cryogenic_residue'
  | 'buff_doc_vital_reach'
  | 'buff_doc_siphon_efficiency'
  | 'buff_doc_targeting_optics'
  | 'buff_doc_calibrated_payload'
  | 'buff_doc_toxic_diffusion'
  | 'buff_doc_corrosive_residue'
  | 'buff_doc_projection_integrity'
  | 'buff_doc_caustic_reprisal'
  | 'buff_doc_clinical_reach'
  | 'buff_doc_impact_dosage'
  | 'buff_doc_sterile_interval'
  | 'buff_doc_protective_triage'
  | 'buff_doc_rush_persistence'
  | 'buff_doc_emergency_reflex'
  | 'buff_doc_orbit_stabilizer'
  | 'buff_doc_vital_rotation'
  | 'buff_doc_celestial_endurance'
  | 'buff_doc_consecrated_cross'
  | 'buff_doc_sustained_rain'
  | 'buff_doc_restorative_imprint'
  // Projectile Buffs (2: P01–P02)
  | 'buff_extra_lmb_projectile'
  | 'buff_extra_rmb_projectile'
  // Stage 1 Expanded Catalog (15: E01–E15)
  | 'buff_projectile_mesh'
  | 'buff_impact_harness'
  | 'buff_meltwater_treads'
  | 'buff_rangefinder_array'
  | 'buff_point_blank_coil'
  | 'buff_opening_pulse'
  | 'buff_titanbreaker_matrix'
  | 'buff_cryo_chem_catalyst'
  | 'buff_surveyors_beacon'
  | 'buff_dash_overclock'
  | 'buff_first_contact_protocol'
  | 'buff_aerial_focus'
  | 'buff_pod_surge'
  | 'buff_apex_barrier'
  | 'buff_resonance_siphon';

export type TimedEffectId =
  | 'dash_overclock'
  | 'first_contact_protocol'
  | 'aerial_focus'
  | 'pod_surge'
  | 'apex_barrier'
  | 'resonance_siphon';

export interface ActiveTimedEffect {
  id: TimedEffectId;
  name: string;
  icon: string;
  remaining: number;
  duration: number;
  stacks: number;
  sourceBuffId: BuffId;
  color: string;
}

export interface BuffsBySource {
  level: number;
  pod: number;
  elite: number;
  event: number;
}

export interface ItemDef {
  id: ItemId;
  name: string;
  description: string;
  icon: string;
  tier: 'common' | 'rare';
  weight: number;
  applyStack: (stats: CalculatedStats, stackCount: number) => void;
}

export type SkillEnhancementId =
  // Primary (LMB — Commander Primary Enhancements)
  | 'chill_beam'
  | 'piercing_laser'
  | 'extended_slash'
  | 'scatter_burst'
  | 'arc_conduit'
  | 'piercing_lance'
  | 'rapid_gatling'
  // Secondary (RMB — Commander Secondary Enhancements)
  | 'scissor_slash'
  | 'frost_burst'
  | 'orbiting_blade'
  | 'cryo_slashes'
  | 'vortex_slashes'
  | 'seismic_slashes'
  // Utility (Dash — Commander Dash Enhancements)
  | 'shock_dash'
  | 'extended_dash'
  | 'teleport'
  | 'phase_dash'
  | 'cryo_dash'
  // Ultimate (R — Commander Orbital Strike Enhancements)
  | 'singularity'
  | 'convergence_barrage'
  | 'cryogenic_impact'
  // Primary (LMB — Doctor Primary Enhancements)
  | 'toxic_chain'
  | 'cryogenic_scalpel'
  | 'vital_extraction'
  // Secondary (RMB — Doctor Secondary Enhancements)
  | 'experimental_drones'
  | 'toxic_cluster_bomb'
  | 'holographic_decoy'
  // Utility (Dash — Doctor Dash Enhancements; extended_dash is Universal)
  | 'phase_barrier'
  | 'adrenaline_rush'
  // Ultimate (R — Doctor Ultimate Enhancements)
  | 'mobile_sanctuary'
  | 'divine_intervention'
  | 'rain_of_crosses';

export type ExclusiveEventPool =
  | 'basic_skill_totem'
  | 'secondary_skill_totem'
  | 'dash_skill_totem'
  | 'ultimate_beacon'
  | 'void_corruption';

export interface BuffDef {
  id: BuffId;
  name: string;
  category: string;
  description: string;
  icon: string;
  accentColor: string;
  linkedItemId?: ItemId;
  replacesSkillSlot?: SkillSlot;
  replacementSkillId?: string;
  enhancesSkillSlot?: SkillSlot;
  enhancementId?: SkillEnhancementId;
  exclusiveEvent?: ExclusiveEventPool;
  heroFilter?: HeroId;
  requiredHero?: HeroId;
  buffPool?: 'universal' | 'trigger' | 'augment_specific' | 'projectile';
  dropWeight?: number;
  maxStacks?: number;
  isUncapped?: boolean;
  isSpecial?: boolean;
  isAdditionalJump?: boolean;
  isExtraProjectile?: boolean;
  requiredAugment?: SkillEnhancementId | SkillEnhancementId[];
  isAttributeUpgrade?: boolean;
  applyStack: (stats: CalculatedStats, stackCount: number) => void;
}

export interface CalculatedStats {
  maxHealth: number;
  healthRegen: number;
  moveSpeed: number;
  attackSpeedMultiplier: number;
  lmbAttackSpeedMultiplier: number;
  damageMultiplier: number;
  chainSparkChance: number;
  chainSparkDamage: number;
  damageReduction: number;
  skillCooldownMultiplier: number;
  dashCooldownMultiplier: number;
  ultimateCooldownMultiplier: number;
  ultimateRadiusMultiplier: number;
  ultimateRadiusBonusRaw: number;
  aoeRadiusMultiplier: number;
  healingMultiplier: number;
  skillDurationMultiplier: number;
  pickupRadius: number;
  currencyMultiplier: number;
  jetpackCapacityMultiplier: number;
  jetpackRegenMultiplier: number;
  extraAirJumps: number;
  lifeSiphonPercent: number;
  thornsReflectFraction: number;
  emergencyBarrierFraction: number;
  extraLmbProjectiles: number;
  extraRmbProjectiles: number;

  critChance: number;
  critMultiplier: number;
  extraProjectiles: number;
  projectileSpread: number;
  projectilePierce: number;
  projectileSpeedMultiplier?: number;
  projectileRadiusMultiplier?: number;
  frostChance: number;
  toxicChance: number;
  deathExplosionRadius: number;
  deathExplosionDamage: number;
  maxEnergyShield: number;
  thornsDamage: number;
  lifestealOnKill: number;
  executionThreshold: number;
  droneCount: number;
  shockingDash: boolean;
  giantSlayerBonus: number;
  artifactChargeMultiplier: number;
  stunChance: number;
  flatArmor: number;
  hasSecondWind: boolean;
  bouncingProjectiles: boolean;
  projectileDamageMitigation?: number;
  meleeDamageMitigation?: number;
  waterSpeedBonus?: number;
  longRangeDamageBonus?: number;
  closeRangeDamageBonus?: number;
  openingPulseBonus?: number;
  statusSynergyDamageBonus?: number;
  resonanceLmbDamageBonus?: number;
}

export interface SkillDef {
  slot: SkillSlot;
  id: string;
  name: string;
  cooldown: number; // in seconds
  range: number;
  baseDamage: number;
  description: string;
  icon?: string;
}

export interface PlayerState {
  heroId: HeroId;
  pos: Vector2;
  velocity: Vector2;
  facing: Direction4;
  castFacingLockTimer: number;
  health: number;
  baseMaxHealth: number;
  maxHealth: number;
  baseMoveSpeed: number;
  moveSpeed: number;
  baseLmbDamage: number;
  baseDamageReduction: number;
  baseHealthRegenPercent: number;

  // Passive Commander's Resolve
  defenseBonusTimer: number;
  defenseBonusDuration: number;
  defenseBonusReduction: number;
  hurtInvulnTimer?: number;
  enemyProjectileGraceTimer?: number;
  hitByEnemyAttackInstanceIds?: Map<number, number>;

  // Progression & Economy
  level: number;
  xp: number;
  xpNeeded: number;
  currency: number;
  killCount: number;

  // Skills
  primaryCooldownRemaining: number;
  secondaryCooldownRemaining: number;
  utilityCooldownRemaining: number;
  ultimateCooldownRemaining: number;

  autoCastPrimary: boolean;
  autoCastSecondary: boolean;

  // Utility (Dash)
  isDashing: boolean;
  dashDurationTimer: number;
  dashDir: Vector2;
  pistolHand: 'left' | 'right';
  dashShockwaveTriggered?: boolean;
  dashHitIds?: Set<string>;
  inSanctuaryCross?: boolean;
  phaseBarrierTimer?: number;
  adrenalineRushTimer?: number;
  toxicRainTimer?: number;
  toxicRainTickTimer?: number;
  toxicRainOrigin?: Vector2;

  // Vertical Traversal: Jumping & Jetpack Glide
  z: number;
  vz: number;
  groundZ: number;
  isGrounded: boolean;
  isJumping: boolean;
  isGliding: boolean;
  jetpackFuel: number;
  maxJetpackFuel: number;
  maxAirJumps: number;
  airJumpsRemaining: number;
  inWater: boolean;
  cameraYaw: number;

  // Stacking Passive Items & Selected Buffs
  items: Record<ItemId, number>;
  buffs: Record<BuffId, number>;
  calculatedStats: CalculatedStats;

  // Trigger Buff Runtime Timers, Cooldowns, & Counters
  tempShieldAmount: number;
  tempShieldTimer: number;
  emergencyBarrierCooldown: number;
  chainReactionCooldown: number;
  secondWindCooldown: number;
  staticDischargeCooldown: number;
  aftershockCooldown: number;
  reactiveShieldCooldown: number;
  survivalInstinctCooldown: number;
  bloodRushTimer: number;
  bloodRushRecentKills: number;
  bloodRushKillWindowTimer: number;
  combatFocusHitCount: number;
  killingMomentumTimer: number;
  killingMomentumStacks: number;
  retaliationTimer: number;
  survivalInstinctTimer: number;
  stunImmunityTimer: number;
  postDashSpeedTimer: number;
  lifeSiphonSecondTimer: number;
  lifeSiphonSecondAmount: number;
  wasAirborneLastFrame: boolean;
  hasCollectedDoubleJumpPickup: boolean;
  nonProjectileBuffCount: number;
  lastDirectAttackActivationId?: number;
  usedCombatFocusActivations?: Set<number>;
  activeTimedEffects?: Partial<Record<TimedEffectId, ActiveTimedEffect>>;
  timedEffectCooldowns?: Partial<Record<TimedEffectId, number>>;
  aerialFocusLatched?: boolean;
  buffsBySource?: BuffsBySource;

  // Energy Shield & Active Equipped Skills
  energyShield: number;
  maxEnergyShield: number;
  beamChargeTimer?: number;
  beamTargetPos?: Vector2 | null;
  equippedSkills: {
    primary: SkillDef;
    secondary: SkillDef;
    utility: SkillDef;
    ultimate: SkillDef;
  };
  skillEnhancements: Partial<Record<SkillSlot, SkillEnhancementId>>;

  // Active Skill Enhancements
  orbitingBladeActive?: boolean;
  orbitingBladeTimer?: number;
  orbitingBladeAngle?: number;
  orbitingBladeRadius?: number;
  orbitingBladeDamage?: number;
  orbitingSwordCount?: number;
  orbitingBladeHitCooldowns?: Record<string, number>;
  floatingSwords?: FloatingSwordData[];
  slashComboStep?: number;
  slashComboTimer?: number;
  isCarryingEventPayload?: boolean;
  carryingEventId?: string | null;
}

export interface FloatingSwordData {
  x: number;
  y: number;
  z: number;
  targetX?: number;
  targetY?: number;
  targetZ?: number;
  state: 'hover' | 'lunge' | 'return';
  stateTimer: number;
  attackCooldown: number;
  targetEnemyId: string | null;
  hitApplied?: boolean;
}

export type EnemyType = 'crawler' | 'spitter' | 'wasp' | 'elite' | 'boss' | 'broodling';

export interface EnemyState {
  id: string;
  type: EnemyType;
  pos: Vector2;
  velocity: Vector2;
  z: number;
  groundZ: number;
  inWater?: boolean;
  health: number;
  maxHealth: number;
  speed: number;
  touchDamage: number;
  attackCooldown: number;
  attackCooldownRemaining: number;
  contactCooldownRemaining?: number;
  rangedWindupTimer?: number;
  rangedWindupDuration?: number;
  lockedAttackDir?: { x: number; y: number; z: number };
  lockedAttackVariant?: 'stinger' | 'spore_bomb' | 'seismic_shard' | 'wasp_sting' | 'water_bubble';
  lockedTargetPos?: { x: number; y: number; z: number };
  // Structured creature animation & combat state machine
  enemyActionPhase?: 'none' | 'prep' | 'exec' | 'recover' | 'stabilize';
  enemyActionTimer?: number;
  enemyActionDuration?: number;
  enemyActionVariant?:
    | 'spin_charge'
    | 'water_bubble'
    | 'toxic_exhale'
    | 'ground_slam'
    | 'punch_r'
    | 'punch_l'
    | 'twin_spikes'
    | 'spawn_brood'
    | 'brood_dive';
  enemyActionHitApplied?: boolean;
  enemyActionTickTimer?: number;
  secondarySkillCooldown?: number;
  punchHandNext?: 'left' | 'right';
  parentQueenId?: string;
  isSummonedOffspring?: boolean;
  offspringLifetime?: number;
  attackRange: number;
  isElite: boolean;
  isBoss?: boolean;
  currencyReward: number;
  xpReward: number;
  radius: number;

  // Status effects from buffs/skills
  isChilled?: boolean;
  chillTimer?: number;
  chillStrength?: number;
  isToxic?: boolean;
  toxicTimer?: number;
  toxicSlowTimer?: number;
  poisonStacks?: number;
  poisonStackTimer?: number;
  bleedTimer?: number;
  bleedTickTimer?: number;
  bleedDps?: number;
  isStunned?: boolean;
  stunTimer?: number;
  isElectrified?: boolean;
  electrifiedTimer?: number;
  electrifiedMultiplier?: number;

  // Aggro & Wandering
  isAlerted?: boolean;
  wanderDir?: Vector2;
  wanderTimer?: number;

  // Ground Crawl-Up Emergence Animation
  isSpawning?: boolean;
  spawnProgress?: number;
  spawnDuration?: number;

  // Real Pathfinding & Wall Recovery
  navWaypoint?: Vector2;
  navGoalPos?: { x: number; y: number; z: number };
  navTimer?: number;
  isTargetReachable?: boolean;
  navStatus?: 'direct' | 'pathfinding' | 'unreachable_standoff' | 'unreachable_patrol';
  standoffAngle?: number;
  stuckTimer?: number;
  recoveryTimer?: number;
  recoveryDir?: Vector2;
  lastPos?: Vector2;

  // Stage 1 Main Boss (Rift Stalker replacing Titan in-place) Special Mechanics
  isStage1Titan?: boolean;
  isScriptedEventEnemy?: boolean;
  bossPursuitOutOfRangeTimer?: number;
  titanState?:
    | 'emerging'
    | 'idle'
    | 'walk'
    | 'leap'
    | 'laser_sweep'
    | 'tentacle_strike'
    | 'elemental_barrage'
    | 'leap_dual_slash'
    | 'tail_sweep_shards'
    | 'tail_laser'
    | 'dorsal_spine_barrage'
    | 'dying';
  titanTimer?: number;
  titanSubPhase?: 'windup' | 'airborne' | 'slash' | 'sweep' | 'charge' | 'active' | 'recover';
  titanPhaseElapsed?: number;
  titanSlashHitMask?: number;
  titanShardsSpawned?: number;
  titanSweepStartAngle?: number;
  titanSweepDir?: number;
  titanTailPitch?: number;
  // Boss Anti-Stuck Terrain Leap
  bossStuckTimer?: number;
  bossStuckAnchor?: Vector2;
  bossJumpCooldown?: number;
  isBossLeaping?: boolean;
  bossLeapElapsed?: number;
  bossLeapDuration?: number;
  bossLeapStart?: { x: number; y: number; z: number };
  bossLeapTarget?: { x: number; y: number; z: number };
  bossEmergeOrigin?: { x: number; y: number; z: number };
  bossEmergeTarget?: { x: number; y: number; z: number };
  titanAnimFrame?: number;
  titanFacing?: 'front' | 'back' | 'left' | 'right';
  titanLaserAngle?: number;
  titanLaserSweepDir?: number;
  titanLaserTarget?: { x: number; y: number; z: number };
  titanLaserOrigin?: { x: number; y: number; z: number };
  titanTentacleTarget?: Vector2;
  titanTentaclePhase?: 'telegraph' | 'strike' | 'retract';
  titanTentacleProgress?: number;
  titanTentacleHitApplied?: boolean;
  titanElementalCharged?: boolean;
  titanFootstepTimer?: number;
  titanRumbleTimer?: number;
}

export type ProjectileType =
  | 'pulse'
  | 'bomb'
  | 'laser_bolt'
  | 'medical_pulse'
  | 'toxic_chain'
  | 'cryo_scalpel'
  | 'toxic_grenade'
  | 'cluster_main'
  | 'cluster_sub'
  | 'drone_bio_bolt'
  | 'angel_bolt'
  | 'sedative_dart'
  | 'wave'
  | 'acid'
  | 'spark'
  | 'scatter'
  | 'arc'
  | 'gatling'
  | 'beam'
  | 'grenade'
  | 'vortex'
  | 'missile'
  | 'flame'
  | 'drone_laser'
  | 'wasp_sting'
  | 'water_bubble'
  | 'seismic_shard'
  | 'queen_stinger'
  | 'spore_bomb'
  | 'frost_blade'
  | 'elemental_ball'
  | 'rift_shard'
  | 'tentacle_shockwave'
  | 'stage1_titan_beam';

export interface FallingBossCrystalState {
  id: string;
  targetPos: Vector2;
  targetZ: number;
  z: number;
  fallSpeed: number;
  impactRadius: number;
  impactDamage: number;
}

export interface ProjectileState {
  id: string;
  type: ProjectileType;
  pos: Vector2;
  z: number;
  velocity: Vector2;
  vz: number;
  speed: number;
  damage: number;
  pierceCount: number;
  maxDistance: number;
  distanceTraveled: number;
  owner: 'player' | 'enemy';
  radius: number;
  hitEnemyIds: Set<string>;
  lifetimeRemaining?: number;
  dotTimer?: number;
  isAnchored?: boolean;
  element?: 'ignite' | 'lightning' | 'frost' | 'void' | 'physical' | 'ice';
  originZ?: number;
  targetZ?: number;
  hand?: 'left' | 'right';
  spawnDelayRemaining?: number;
  muzzleOffset?: Vector2;
  extraLayers?: number;
  // Doctor projectile extensions
  bouncesRemaining?: number;
  isRicochet?: boolean;
  returnPhase?: boolean;
  outboundHitIds?: Set<string>;
  returnHitIds?: Set<string>;
  originPos?: Vector2;
  targetPos?: Vector2;
  trailAccumDist?: number;
  clusterSpreadAngle?: number;
  decoyThrowTarget?: Vector2;
  attackActivationId?: number;
  attackInstanceId?: number;
  isDirectAttack?: boolean;
  isPrimaryLmb?: boolean;
}

export interface OrbitalStrikeState {
  id: string;
  targetPos: Vector2;
  delayRemaining: number;
  radius: number;
  damage: number;
  hasStruck: boolean;
  durationRemaining: number;
  variant?: 'judgment' | 'nuke' | 'lance' | 'singularity' | 'chrono';
  enhancement?: SkillEnhancementId;
  subStrikes?: Vector2[];
  hitEnemyIds?: Set<string>;
  dotTimer?: number;
  hasExploded?: boolean;
  attackActivationId?: number;
  cryoTickTimer?: number;
}

export interface RecoveryFieldState {
  id: string;
  pos: Vector2;
  z: number;
  radius: number;
  durationRemaining: number;
  healPerSecond: number;
  tickTimer: number;
}

export interface ToxicFieldState {
  id: string;
  pos: Vector2;
  z: number;
  radius: number;
  durationRemaining: number;
  maxDuration: number;
  damagePerTick: number;
  tickInterval: number;
  tickTimer: number;
}

export interface SanctuaryCrossState {
  id: string;
  pos: Vector2;
  z: number;
  armHalfLength: number;
  armHalfWidth: number;
  durationRemaining: number;
  maxDuration: number;
  healPerSecond: number;
  pulseDamage: number;
  pulseInterval: number;
  pulseTimer: number;
  rotation?: number;
  rotationSpeed?: number;
  isMobile?: boolean;
  isRainField?: boolean;
}

export interface FrostTrailState {
  id: string;
  pos: Vector2;
  z: number;
  radius: number;
  durationRemaining: number;
  maxDuration: number;
}

export interface VitalTetherState {
  id: string;
  targetEnemyId: string;
  targetPos: Vector2;
  targetZ: number;
  tickTimer: number;
}

export interface DoctorDroneState {
  id: string;
  index: number;
  pos: Vector2;
  z: number;
  orbitAngle: number;
  fireCooldown: number;
  fireInterval?: number;
  chargeRatio?: number;
  lastTargetPos?: Vector2;
  beamVisualTimer: number;
}

export interface HolographicDecoyState {
  id: string;
  pos: Vector2;
  z: number;
  moveDir: Vector2;
  hitsRemaining: number;
  maxHits: number;
  durationRemaining: number;
  maxDuration: number;
  tauntRadius: number;
  explosionRadius: number;
  explosionDamage: number;
  facing: Direction4;
}

export interface DivineAngelState {
  id: string;
  quadrantIndex: number;
  anchorOffset: Vector2;
  pos: Vector2;
  z: number;
  facing: Direction4;
  durationRemaining: number;
  maxDuration: number;
  fireCooldown: number;
  attackAnimTimer: number;
}

export interface FallingCrossState {
  id: string;
  targetPos: Vector2;
  targetZ: number;
  z: number;
  fallSpeed: number;
  impactDamage: number;
  impactRadius: number;
  fieldHalfLength: number;
  fieldHalfWidth: number;
  rainEndGameTime: number;
}

export interface OrganicPodState {
  id: string;
  name?: string;
  pos: Vector2;
  zOffset?: number;
  rotationY?: number;
  scale?: number;
  cost: number;
  isOpened: boolean;
  dissolveTimer?: number;
  isDissolving?: boolean;
  isDestroyed?: boolean;
  itemRewarded?: ItemId;
  itemDropped?: ItemId;
  radius: number;
}

export interface OverseerArtifactState {
  pos: Vector2;
  zOffset?: number;
  rotationY?: number;
  scale?: number;
  phase?: ArtifactPhase;
  requiredModules?: number;
  recoveredModules?: number;
  restorationTimer?: number;
  teleportPrepTimer?: number;
  teleportPrepDuration?: number;
  awaitingDialogueSync?: boolean;
  refreezeTriggered?: boolean;
  prematureInteractWarned?: boolean;
  prematureInteractCooldown?: number;
  chargeProgress: number; // 0 to 100
  chargePerKill: number;
  isCharged: boolean;
  isTeleporterReady?: boolean;
  isSummoning?: boolean;
  summonTimer?: number;
  isBossSpawned?: boolean;
  isBossDefeated?: boolean;
  isCompleted: boolean;
  radius: number;
}

export interface CurrencyDropState {
  id: string;
  pos: Vector2;
  vel: Vector2;
  z: number;       // Vertical height above terrain during pop animation
  vz: number;      // Vertical velocity
  settled: boolean;
  value: number;
  lifetime: number;
}

export interface ItemDropState {
  id: string;
  itemId?: ItemId;
  buffId?: BuffId;
  isBuffDrop?: boolean;
  isDoubleJumpTestPickup?: boolean;
  pos: Vector2;
  vel: Vector2;
  z: number;
  vz: number;
  settled: boolean;
  lifetime: number;
}

export type TerrainSurfaceCategory =
  | 'ground'
  | 'cliff'
  | 'water'
  | 'waterfall_rock'
  | 'bridge'
  | 'tower_ledge'
  | 'ship_walkable'
  | 'solid_obstacle'
  | 'border'
  | 'tree_nonsolid';

export interface MapObstacle {
  id: string;
  name?: string;
  type: 'rock' | 'crystal' | 'flora' | 'mushroom' | 'tree';
  subtype?: string;
  variant?: number;
  pos: Vector2;
  zOffset?: number;
  rotationY?: number;
  radius: number;
  scaleVar: number;
  placementRule?: 'terrain' | 'water' | 'free';
}

export type WorldEventType =
  | 'primal_totem'          // 1. Basic Attack (LMB) Enhancement Shrine
  | 'secondary_totem'       // 2. Secondary Attack (RMB) Enhancement Shrine
  | 'dash_totem'            // 3. Dash (Utility) Enhancement Shrine
  | 'orbital_uplink'        // 4. Ultimate (R) Enhancement Shrine
  | 'void_corruption';      // Legacy/optional compatibility

export interface DashEventPlatform {
  index: number; // 1..5
  x: number;
  y: number;
  z: number;
  radius: number;
  reached?: boolean;
}

export interface WorldEventState {
  id: string;
  type: WorldEventType;
  name: string;
  description: string;
  pos: Vector2;
  zOffset?: number;
  rotationY?: number;
  scale?: number;
  radius: number;
  chargeProgress: number; // 0 to 100
  isActive: boolean;
  isCompleted: boolean;
  durationTimer?: number;
  pulseTimer: number;
  killCount?: number;
  killTarget?: number;
  elevation: number;
  hasSpawnedBoss50?: boolean;
  activeEliteId?: string | null;
  eliteWaveIndex?: number;
  dashPlatforms?: DashEventPlatform[];
  highestPlatformReached?: number;
  payloadPos?: { x: number; y: number; z: number };
  payloadCollected?: boolean;
}

export interface InputSnapshot {
  moveDir: Vector2;
  wantDash: boolean;
  wantUltimate: boolean;
  wantInteract: boolean;
  wantJump: boolean;
  holdJump: boolean;
  cameraYaw: number;
  cameraForward?: Vector2;
  cameraRight?: Vector2;
  wantPrimaryManual: boolean;
  wantSecondaryManual: boolean;
  mouseWorldPos: Vector2;
  mouseWorldPos3D?: { x: number; y: number; z: number };
  aimDir: Vector2;
}

export interface SimEvent {
  type:
  | 'damage_dealt'
  | 'enemy_killed'
  | 'item_dropped'
  | 'item_acquired'
  | 'buff_capsule_collected'
  | 'level_up'
  | 'currency_collected'
  | 'buff_choices_ready'
  | 'buff_selected'
  | 'player_hit'
  | 'dash_used'
  | 'dash_shockwave'
  | 'medical_rush_hit'
  | 'recovery_field_deployed'
  | 'toxic_field_deployed'
  | 'sanctuary_cross_deployed'
  | 'sanctuary_pulse'
  | 'toxic_chain_bounce'
  | 'toxic_chain_explosion'
  | 'scalpel_thrown'
  | 'grenade_thrown'
  | 'cluster_fragmented'
  | 'decoy_spawned'
  | 'decoy_detonated'
  | 'angel_summoned'
  | 'falling_cross_impact'
  | 'rain_crosses_started'
  | 'therapeutic_heal'
  | 'drone_bolt_impact'
  | 'phase_barrier_activated'
  | 'adrenaline_activated'
  | 'jump_started'
  | 'glide_started'
  | 'glide_ended'
  | 'landed'
  | 'ultimate_fired'
  | 'ultimate_singularity_spawned'
  | 'ultimate_singularity_detonated'
  | 'ultimate_convergence_started'
  | 'ultimate_convergence_detonated'
  | 'ultimate_cryo_field_spawned'
  | 'orbital_impact'
  | 'pulse_fired'
  | 'pistol_shot_released'
  | 'beam_charging'
  | 'beam_fired'
  | 'scatter_fired'
  | 'blink_used'
  | 'wave_fired'
  | 'pod_opened'
  | 'pod_dissolving'
  | 'pod_removed'
  | 'artifact_charged'
  | 'boss_spawned'
  | 'boss_defeated'
  | 'enemy_emerging'
  | 'enemy_attack_windup'
  | 'enemy_projectile_fired'
  | 'oreblade_charge_start'
  | 'oreblade_charge_hit'
  | 'water_bubble_impact'
  | 'magmir_slam_telegraph'
  | 'magmir_slam_impact'
  | 'magmir_punch_swing'
  | 'brood_offspring_spawned'
  | 'brood_offspring_rupture'
  | 'stage_cleared'
  | 'game_over'
  | 'chain_spark'
  | 'difficulty_advanced'
  | 'world_event_activated'
  | 'world_event_progress'
  | 'world_event_completed'
  | 'world_event_pulse'
  | 'overseer_comm'
  | 'chill_beam_fired'
  | 'piercing_laser_fired'
  | 'extended_slash_fired'
  | 'scissor_slash_fired'
  | 'frost_burst_fired'
  | 'orbiting_blade_summoned'
  | 'orbiting_blade_expired'
  | 'orbiting_blade_hit'
  | 'floating_sword_hit'
  | 'teleport_executed'
  | 'dash_shockwave_impact'
  | 'stage1_boss_emerge'
  | 'stage1_boss_laser_sweep'
  | 'stage1_boss_tentacle_strike'
  | 'stage1_boss_elemental_charge'
  | 'stage1_boss_elemental_launch'
  | 'stage1_boss_dual_slash'
  | 'stage1_boss_tail_sweep'
  | 'stage1_boss_laser_charge'
  | 'stage1_boss_spine_charge'
  | 'stage1_boss_spine_launch'
  | 'boss_crystal_impact'
  | 'stage1_boss_rumble'
  | 'stage1_boss_death'
  | 'stage_earthquake'
  | 'tower_locked_interact'
  | 'tower_unlocked'
  | 'stage1_refreeze_started';
  data: any;
}

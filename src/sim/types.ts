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
  | 'buff_overdrive'
  | 'buff_vital_core'
  | 'buff_chain_spark'
  | 'buff_pulse_power'
  | 'buff_thrusters'
  | 'buff_orbital_cap'
  | 'buff_harvester'
  | 'buff_crit_lens'
  | 'buff_heavy_slugs'
  | 'buff_multi_barrel'
  | 'buff_cryo_rounds'
  | 'buff_toxic_spores'
  | 'buff_death_blossom'
  | 'buff_energy_shield'
  | 'buff_thorns_plating'
  | 'buff_vampiric_siphon'
  | 'buff_executioner'
  | 'buff_combat_drone'
  | 'buff_shock_trail'
  | 'buff_speed_demon'
  | 'buff_giant_slayer'
  | 'buff_jet_overclock'
  | 'buff_bouncing_slugs'
  | 'buff_titanium_armor'
  | 'buff_greedy_leech'
  | 'buff_resonance_booster'
  | 'buff_stun_rounds'
  | 'buff_thermite_infusion'
  | 'buff_berserker_stim'
  | 'buff_frost_landing'
  | 'buff_nanite_swarm'
  | 'buff_superconductor'
  | 'buff_lead_curtain'
  | 'buff_second_wind'
  // Commander 12 Approved Skill Enhancement Buffs (Exclusive to the 4 World Events)
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
  // Doctor 12 Approved Skill Enhancement Buffs (extended_dash is Universal Augment 1)
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
  | 'buff_skill_scatter'
  | 'buff_skill_arc'
  | 'buff_skill_hyper_beam'
  | 'buff_skill_gatling'
  | 'buff_skill_cryo_grenade'
  | 'buff_skill_gravity_vortex'
  | 'buff_skill_blink'
  | 'buff_skill_nuke'
  | 'buff_skill_orbital_lance'
  | 'buff_skill_singularity'
  | 'buff_skill_chrono_stasis'
  | 'buff_corruption_dominance'
  | 'buff_corruption_chitin'
  | 'buff_corruption_catalyst';

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
  isAttributeUpgrade?: boolean;
  applyStack: (stats: CalculatedStats, stackCount: number) => void;
}

export interface CalculatedStats {
  maxHealth: number;
  healthRegen: number;
  moveSpeed: number;
  attackSpeedMultiplier: number;
  damageMultiplier: number;
  chainSparkChance: number;
  chainSparkDamage: number;
  damageReduction: number;
  dashCooldownMultiplier: number;
  ultimateCooldownMultiplier: number;
  ultimateRadiusMultiplier: number;
  aoeRadiusMultiplier: number;
  healingMultiplier: number;
  skillDurationMultiplier: number;
  pickupRadius: number;

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

  // Passive Commander's Resolve
  defenseBonusTimer: number;
  defenseBonusDuration: number;
  defenseBonusReduction: number;
  hurtInvulnTimer?: number;

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
  cameraYaw: number;

  // Stacking Passive Items & Selected Buffs
  items: Record<ItemId, number>;
  buffs: Record<BuffId, number>;
  calculatedStats: CalculatedStats;

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

export type EnemyType = 'crawler' | 'spitter' | 'wasp' | 'elite' | 'boss';

export interface EnemyState {
  id: string;
  type: EnemyType;
  pos: Vector2;
  velocity: Vector2;
  z: number;
  groundZ: number;
  health: number;
  maxHealth: number;
  speed: number;
  touchDamage: number;
  attackCooldown: number;
  attackCooldownRemaining: number;
  contactCooldownRemaining?: number;
  attackRange: number;
  isElite: boolean;
  isBoss?: boolean;
  currencyReward: number;
  xpReward: number;
  radius: number;

  // Status effects from buffs/skills
  isChilled?: boolean;
  chillTimer?: number;
  isToxic?: boolean;
  toxicTimer?: number;
  toxicSlowTimer?: number;
  poisonStacks?: number;
  poisonStackTimer?: number;
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

  // Stage 1 Main Boss (Titan Colossus) Special Mechanics
  isStage1Titan?: boolean;
  titanState?: 'emerging' | 'idle' | 'walk' | 'laser_sweep' | 'tentacle_strike' | 'elemental_barrage' | 'dying';
  titanTimer?: number;
  titanAnimFrame?: number;
  titanFacing?: 'front' | 'back' | 'left' | 'right';
  titanLaserAngle?: number;
  titanLaserSweepDir?: number;
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
  | 'seismic_shard'
  | 'queen_stinger'
  | 'spore_bomb'
  | 'frost_blade'
  | 'elemental_ball'
  | 'tentacle_shockwave'
  | 'stage1_titan_beam';

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
  returnPhase?: boolean;
  outboundHitIds?: Set<string>;
  returnHitIds?: Set<string>;
  originPos?: Vector2;
  targetPos?: Vector2;
  trailAccumDist?: number;
  clusterSpreadAngle?: number;
  decoyThrowTarget?: Vector2;
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
  isBuffDrop?: boolean;
  pos: Vector2;
  vel: Vector2;
  z: number;
  vz: number;
  settled: boolean;
  lifetime: number;
}

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
    | 'stage_cleared'
    | 'game_over'
    | 'chain_spark'
    | 'difficulty_advanced'
    | 'world_event_activated'
    | 'world_event_progress'
    | 'world_event_completed'
    | 'world_event_pulse'
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
    | 'stage1_boss_rumble'
    | 'stage1_boss_death';
  data: any;
}

import {
  PlayerState,
  EnemyState,
  ProjectileState,
  OrbitalStrikeState,
  OrganicPodState,
  OverseerArtifactState,
  CurrencyDropState,
  ItemDropState,
  MapObstacle,
  WorldEventState,
  SimEvent,
  ItemId,
  BuffId,
  HeroId,
  RecoveryFieldState,
  ToxicFieldState,
  SanctuaryCrossState,
  FrostTrailState,
  VitalTetherState,
  DoctorDroneState,
  HolographicDecoyState,
  DivineAngelState,
  FallingCrossState,
  FallingBossCrystalState
} from './types';
import { HERO_COMMANDER, HERO_REGISTRY } from './HeroDefs';
import { calculateStats, SeededRandom, ALL_BUFF_IDS } from './ItemDefs';
import { createRunRngStreams, generateFreshRunSeed } from './RngStreams';
import type { SceneDirectorReport } from './SceneDirector';
import { COMMANDER_DEFAULT_SKILLS, DOCTOR_DEFAULT_SKILLS } from './SkillDefs';
import { DOCTOR_CONFIG } from './DoctorConfig';
import { TerrainSystem } from './TerrainSystem';
import type {
  StageConfig,
  StageEnemySpawnRegionConfig,
  StageLayoutProfile,
  StageProfileKey
} from '../dev/StageConfig';
import { formatObstacleDisplayName } from '../dev/StageConfig';
import { getStageArtifactPolicy, isStage1EnhancementCategory } from './StageProgressionPolicy';
import type { WorldEventType } from './types';

export class GameState {
  // Compact, vertically layered 3D world (RoR2 scale: 3600x3600, 600+ unit verticality)
  public worldWidth: number = 3600;
  public worldHeight: number = 3600;

  public rng: SeededRandom;
  public runSeed: number;
  public layoutSeed: number;
  public pinnedLayoutSeed: number | null = null;
  public layoutRng: SeededRandom;
  public directorRng: SeededRandom;
  public lootRng: SeededRandom;
  public sceneDirectorReport: SceneDirectorReport | null = null;
  public terrain: TerrainSystem;
  public selectedHeroId: HeroId = 'commander';
  public player: PlayerState;
  public enemies: EnemyState[] = [];
  public projectiles: ProjectileState[] = [];
  public orbitalStrikes: OrbitalStrikeState[] = [];
  public recoveryFields: RecoveryFieldState[] = [];
  public toxicFields: ToxicFieldState[] = [];
  public sanctuaryCrosses: SanctuaryCrossState[] = [];
  public frostTrails: FrostTrailState[] = [];
  public vitalTethers: VitalTetherState[] = [];
  public doctorDrones: DoctorDroneState[] = [];
  public holographicDecoys: HolographicDecoyState[] = [];
  public divineAngels: DivineAngelState[] = [];
  public fallingCrosses: FallingCrossState[] = [];
  public fallingBossCrystals: FallingBossCrystalState[] = [];
  public bossSpineRainTimer: number = 0;
  public bossSpineRainWaveTimer: number = 0;
  public bossSpineRainCenter: { x: number; y: number } = { x: 1800, y: 2600 };
  public pods: OrganicPodState[] = [];
  public worldEvents: WorldEventState[] = [];
  public completedEnhancementCategories: Set<WorldEventType> = new Set();
  public enhancementCompletionOrder: WorldEventType[] = [];
  public artifact!: OverseerArtifactState;
  public currencyDrops: CurrencyDropState[] = [];
  public itemDrops: ItemDropState[] = [];
  public obstacles: MapObstacle[] = [];

  // 3-Choice Buff Selection Pause State
  public isPausedForBuffChoice: boolean = false;
  public pendingBuffDrafts: number = 0;
  public currentBuffChoices: BuffId[] = [];

  // RoR2 "Artifact of Command" trial mode: true = 3-choice attribute modal on chest open; false = direct item pop
  public commandArtifactActive: boolean = true;

  public seed: number;
  public stageNumber: number = 1;
  public stageName: string = 'The Wreckage';
  public isGameStarted: boolean = false;
  public gameTime: number = 0;
  public hasBossSpawned: boolean = false;
  public isStageCleared: boolean = false;
  public isGameOver: boolean = false;
  public isPaused: boolean = false;
  public events: SimEvent[] = [];

  // Stage Config & Spawn Metadata (Single source of truth with Visual Stage Editor)
  public activeStageConfig: StageConfig | null = null;
  public playerSpawnPos: { x: number; y: number } = { x: 1800, y: 2480 };
  public bossSpawnPos: { x: number; y: number } = { x: 1800, y: 2600 };
  public enemySpawnRegions: StageEnemySpawnRegionConfig[] = [];
  public customStageEnvironment: Record<string, unknown> | null = null;

  constructor(seed?: number, heroId: HeroId = 'commander', initialStageConfig?: StageConfig | null) {
    const configSeed = initialStageConfig?.profiles?.procedural?.terrainSeed;
    const actualSeed =
      seed !== undefined
        ? seed
        : configSeed !== undefined
          ? configSeed
          : (Date.now() ^ Math.floor(Math.random() * 0x7fffffff)) >>> 0;
    this.seed = actualSeed;
    const streams = createRunRngStreams(actualSeed, this.pinnedLayoutSeed);
    this.runSeed = streams.runSeed;
    this.layoutSeed = streams.layoutSeed;
    this.rng = streams.combat;
    this.layoutRng = streams.layout;
    this.directorRng = streams.director;
    this.lootRng = streams.loot;
    this.selectedHeroId = heroId;

    const initialItems: Record<ItemId, number> = {
      overdrive: 0,
      vital_core: 0,
      chain_spark: 0
    };

    const initialBuffs = ALL_BUFF_IDS.reduce((acc, id) => {
      acc[id] = 0;
      return acc;
    }, {} as Record<BuffId, number>);

    this.terrain = new TerrainSystem(actualSeed);

    const heroDef = HERO_REGISTRY[heroId] || HERO_COMMANDER;

    const initialStats = calculateStats(
      heroDef.baseMaxHealth,
      heroDef.baseMoveSpeed,
      initialItems,
      initialBuffs,
      {
        baseDamageReduction: heroDef.baseDamageReduction,
        baseHealthRegenPercent: heroDef.baseHealthRegenPercent
      }
    );

    const cx = this.worldWidth / 2; // 1800

    // Spawn in the safe crash-site starting deck facing north into the crater
    const spawnX = cx; // 1800
    const spawnY = 2480; // (1800, 2480)
    const startElevation = this.terrain.getElevation(spawnX, spawnY).height;

    this.player = {
      heroId,
      pos: { x: spawnX, y: spawnY },
      velocity: { x: 0, y: 0 },
      facing: 'front',
      castFacingLockTimer: 0,
      health: initialStats.maxHealth,
      baseMaxHealth: heroDef.baseMaxHealth,
      maxHealth: initialStats.maxHealth,
      baseMoveSpeed: heroDef.baseMoveSpeed,
      moveSpeed: initialStats.moveSpeed,
      baseLmbDamage: heroDef.baseLmbDamage,
      baseDamageReduction: heroDef.baseDamageReduction,
      baseHealthRegenPercent: heroDef.baseHealthRegenPercent,
      defenseBonusTimer: 0,
      defenseBonusDuration: heroDef.defenseBonusDuration,
      defenseBonusReduction: heroDef.defenseBonusReduction,
      hurtInvulnTimer: 0,
      enemyProjectileGraceTimer: 0,
      hitByEnemyAttackInstanceIds: new Map<number, number>(),
      level: 1,
      xp: 0,
      xpNeeded: 8,
      currency: 15,
      killCount: 0,
      primaryCooldownRemaining: 0,
      secondaryCooldownRemaining: 0,
      utilityCooldownRemaining: 0,
      ultimateCooldownRemaining: 0,
      autoCastPrimary: true,
      autoCastSecondary: true,
      isDashing: false,
      dashDurationTimer: 0,
      dashDir: { x: 0, y: 1 },
      pistolHand: 'left',
      dashShockwaveTriggered: false,
      dashHitIds: new Set<string>(),
      inSanctuaryCross: false,
      phaseBarrierTimer: 0,
      adrenalineRushTimer: 0,
      toxicRainTimer: 0,
      toxicRainTickTimer: 0,
      toxicRainOrigin: undefined,
      z: startElevation,
      vz: 0,
      groundZ: startElevation,
      isGrounded: true,
      isJumping: false,
      isGliding: false,
      jetpackFuel: 100,
      maxJetpackFuel: 100,
      maxAirJumps: 0,
      airJumpsRemaining: 0,
      inWater: false,
      cameraYaw: 0,
      items: initialItems,
      buffs: initialBuffs,
      calculatedStats: initialStats,
      tempShieldAmount: 0,
      tempShieldTimer: 0,
      emergencyBarrierCooldown: 0,
      chainReactionCooldown: 0,
      secondWindCooldown: 0,
      staticDischargeCooldown: 0,
      aftershockCooldown: 0,
      reactiveShieldCooldown: 0,
      survivalInstinctCooldown: 0,
      bloodRushTimer: 0,
      bloodRushRecentKills: 0,
      bloodRushKillWindowTimer: 0,
      combatFocusHitCount: 0,
      killingMomentumTimer: 0,
      killingMomentumStacks: 0,
      retaliationTimer: 0,
      survivalInstinctTimer: 0,
      stunImmunityTimer: 0,
      postDashSpeedTimer: 0,
      lifeSiphonSecondTimer: 0,
      lifeSiphonSecondAmount: 0,
      wasAirborneLastFrame: false,
      hasCollectedDoubleJumpPickup: false,
      nonProjectileBuffCount: 0,
      usedCombatFocusActivations: new Set<number>(),
      activeTimedEffects: {},
      timedEffectCooldowns: {},
      aerialFocusLatched: false,
      buffsBySource: { level: 0, pod: 0, elite: 0, event: 0 },
      energyShield: initialStats.maxEnergyShield,
      maxEnergyShield: initialStats.maxEnergyShield,
      beamChargeTimer: 0,
      beamTargetPos: null,
      equippedSkills: heroId === 'doctor' ? { ...DOCTOR_DEFAULT_SKILLS } : { ...COMMANDER_DEFAULT_SKILLS },
      skillEnhancements: {}
    };

    this.generateArtifact();
    this.generateWorldEvents();
    this.generateOrganicPods();
    this.generateMapObstacles();

    if (initialStageConfig) {
      this.applyStageConfig(initialStageConfig, 'procedural');
    }
  }

  public reseedRunStreams(forcedRunSeed?: number): void {
    const nextSeed = forcedRunSeed !== undefined ? forcedRunSeed : generateFreshRunSeed();
    const streams = createRunRngStreams(nextSeed, this.pinnedLayoutSeed);
    this.seed = streams.runSeed;
    this.runSeed = streams.runSeed;
    this.layoutSeed = streams.layoutSeed;
    this.rng = streams.combat;
    this.layoutRng = streams.layout;
    this.directorRng = streams.director;
    this.lootRng = streams.loot;
  }

  public selectHero(heroId: HeroId): void {
    this.selectedHeroId = heroId;
    const heroDef = HERO_REGISTRY[heroId] || HERO_COMMANDER;
    const initialStats = calculateStats(
      heroDef.baseMaxHealth,
      heroDef.baseMoveSpeed,
      this.player.items,
      this.player.buffs,
      {
        baseDamageReduction: heroDef.baseDamageReduction,
        baseHealthRegenPercent: heroDef.baseHealthRegenPercent
      }
    );
    this.player.heroId = heroId;
    this.player.baseMaxHealth = heroDef.baseMaxHealth;
    this.player.maxHealth = initialStats.maxHealth;
    this.player.health = initialStats.maxHealth;
    this.player.baseMoveSpeed = heroDef.baseMoveSpeed;
    this.player.moveSpeed = initialStats.moveSpeed;
    this.player.baseLmbDamage = heroDef.baseLmbDamage;
    this.player.baseDamageReduction = heroDef.baseDamageReduction;
    this.player.baseHealthRegenPercent = heroDef.baseHealthRegenPercent;
    this.player.calculatedStats = initialStats;
    this.player.defenseBonusDuration = heroDef.defenseBonusDuration;
    this.player.defenseBonusReduction = heroDef.defenseBonusReduction;
    this.player.hurtInvulnTimer = 0;
    this.player.enemyProjectileGraceTimer = 0;
    this.player.hitByEnemyAttackInstanceIds = new Map<number, number>();
    this.player.pistolHand = 'left';
    this.player.dashShockwaveTriggered = false;
    this.player.dashHitIds = new Set<string>();
    this.player.inSanctuaryCross = false;
    this.player.phaseBarrierTimer = 0;
    this.player.adrenalineRushTimer = 0;
    this.player.toxicRainTimer = 0;
    this.player.toxicRainTickTimer = 0;
    this.player.toxicRainOrigin = undefined;
    this.player.maxAirJumps = initialStats.extraAirJumps;
    this.player.airJumpsRemaining = initialStats.extraAirJumps;
    this.player.maxJetpackFuel = 100 * initialStats.jetpackCapacityMultiplier;
    this.player.jetpackFuel = this.player.maxJetpackFuel;
    this.player.tempShieldAmount = 0;
    this.player.tempShieldTimer = 0;
    this.player.emergencyBarrierCooldown = 0;
    this.player.chainReactionCooldown = 0;
    this.player.secondWindCooldown = 0;
    this.player.staticDischargeCooldown = 0;
    this.player.aftershockCooldown = 0;
    this.player.reactiveShieldCooldown = 0;
    this.player.survivalInstinctCooldown = 0;
    this.player.bloodRushTimer = 0;
    this.player.bloodRushRecentKills = 0;
    this.player.bloodRushKillWindowTimer = 0;
    this.player.combatFocusHitCount = 0;
    this.player.killingMomentumTimer = 0;
    this.player.killingMomentumStacks = 0;
    this.player.retaliationTimer = 0;
    this.player.survivalInstinctTimer = 0;
    this.player.stunImmunityTimer = 0;
    this.player.postDashSpeedTimer = 0;
    this.player.lifeSiphonSecondTimer = 0;
    this.player.lifeSiphonSecondAmount = 0;
    this.player.wasAirborneLastFrame = false;
    this.player.hasCollectedDoubleJumpPickup = false;
    this.player.nonProjectileBuffCount = 0;
    this.player.usedCombatFocusActivations?.clear();
    this.player.activeTimedEffects = {};
    this.player.timedEffectCooldowns = {};
    this.player.aerialFocusLatched = false;
    this.player.buffsBySource = { level: 0, pod: 0, elite: 0, event: 0 };
    this.player.inWater = false;
    this.frostTrails = [];
    this.vitalTethers = [];
    this.doctorDrones = [];
    this.holographicDecoys = [];
    this.divineAngels = [];
    this.fallingCrosses = [];
    this.fallingBossCrystals = [];
    this.bossSpineRainTimer = 0;
    this.bossSpineRainWaveTimer = 0;
    this.player.equippedSkills = heroId === 'doctor'
      ? {
        primary: { ...DOCTOR_DEFAULT_SKILLS.primary },
        secondary: { ...DOCTOR_DEFAULT_SKILLS.secondary },
        utility: { ...DOCTOR_DEFAULT_SKILLS.utility },
        ultimate: { ...DOCTOR_DEFAULT_SKILLS.ultimate }
      }
      : {
        primary: { ...COMMANDER_DEFAULT_SKILLS.primary },
        secondary: { ...COMMANDER_DEFAULT_SKILLS.secondary },
        utility: { ...COMMANDER_DEFAULT_SKILLS.utility },
        ultimate: { ...COMMANDER_DEFAULT_SKILLS.ultimate }
      };
    this.player.skillEnhancements = {};
  }

  private generateArtifact(): void {
    // Upper Summit Plateau: Original elevated Overseer Teleporter site (1400, 1050) at elevation ~615
    let artX = 1400;
    let artY = 1050;

    for (let attempt = 0; attempt < 35; attempt++) {
      const candX = 1400 + (this.rng.next() - 0.5) * 120;
      const candY = 1050 + (this.rng.next() - 0.5) * 120;
      if (this.terrain.isValidEventSpawn(candX, candY, 60)) {
        artX = candX;
        artY = candY;
        break;
      }
    }

    const policy = getStageArtifactPolicy(this.stageNumber);
    this.artifact = {
      pos: { x: artX, y: artY },
      phase: policy.mode === 'four_enhancements' ? 'locked_missing_modules' : 'charging',
      requiredModules: policy.requiredEnhancementCategories.length,
      recoveredModules: 0,
      restorationTimer: 0,
      teleportPrepTimer: 0,
      teleportPrepDuration: 10.0,
      awaitingDialogueSync: false,
      refreezeTriggered: false,
      prematureInteractWarned: false,
      prematureInteractCooldown: 0,
      chargeProgress: 0,
      chargePerKill: 1.75, // 2x slower charge rate as requested
      isCharged: false,
      isTeleporterReady: false,
      isSummoning: false,
      summonTimer: 0,
      isBossSpawned: false,
      isBossDefeated: false,
      isCompleted: false,
      radius: 55
    };
  }

  public resetArtifactProgression(): void {
    this.completedEnhancementCategories.clear();
    this.enhancementCompletionOrder = [];
    this.hasBossSpawned = false;
    this.isStageCleared = false;
    if (!this.artifact) return;
    const policy = getStageArtifactPolicy(this.stageNumber);
    this.artifact.chargeProgress = 0;
    this.artifact.isCharged = false;
    this.artifact.isTeleporterReady = false;
    this.artifact.isSummoning = false;
    this.artifact.summonTimer = 0;
    this.artifact.isBossSpawned = false;
    this.artifact.isBossDefeated = false;
    this.artifact.isCompleted = false;
    this.artifact.restorationTimer = 0;
    this.artifact.teleportPrepTimer = 0;
    this.artifact.teleportPrepDuration = 10.0;
    this.artifact.awaitingDialogueSync = false;
    this.artifact.refreezeTriggered = false;
    this.artifact.prematureInteractWarned = false;
    this.artifact.prematureInteractCooldown = 0;
    this.artifact.requiredModules = policy.requiredEnhancementCategories.length;
    this.artifact.recoveredModules = 0;
    this.artifact.phase = policy.mode === 'four_enhancements' ? 'locked_missing_modules' : 'charging';
  }

  public markEnhancementCategoryCompleted(type: WorldEventType): boolean {
    if (!isStage1EnhancementCategory(type)) return false;
    if (this.completedEnhancementCategories.has(type)) return false;
    this.completedEnhancementCategories.add(type);
    this.enhancementCompletionOrder.push(type);
    if (this.artifact) {
      this.artifact.recoveredModules = this.completedEnhancementCategories.size;
    }
    return true;
  }

  private generateWorldEvents(): void {
    const placedEvents: { pos: { x: number; y: number } }[] = [];
    const sx = this.player.pos.x;
    const sy = this.player.pos.y;
    const shipPos = { x: 1800, y: 2960 };

    const isValidCandidate = (x: number, y: number): boolean => {
      if (Math.hypot(x - sx, y - sy) < 180) return false;
      if (Math.hypot(x - shipPos.x, y - shipPos.y) < 180) return false;
      if (Math.hypot(x - this.artifact.pos.x, y - this.artifact.pos.y) < 160) return false;
      for (const ev of placedEvents) {
        if (Math.hypot(x - ev.pos.x, y - ev.pos.y) < 220) return false;
      }
      return this.terrain.isValidEventSpawn(x, y, 45);
    };

    // 1. Basic Attack (LMB) Shrine — Ancient Bio-Resonance Totem (Lower Valley Floor)
    let totemPos = { x: 1800, y: 2150 };
    for (let attempt = 0; attempt < 50; attempt++) {
      const candX = 1800 + (this.rng.next() - 0.5) * 650;
      const candY = 2150 + (this.rng.next() - 0.5) * 350;
      if (isValidCandidate(candX, candY)) {
        totemPos = { x: candX, y: candY };
        break;
      }
    }
    placedEvents.push({ pos: totemPos });

    // 2. Secondary Attack (RMB) Shrine — Kinetic Blade Conduit (Middle Combat Plateau)
    const mp = this.terrain.middlePlateauCenter;
    let secondaryPos = { x: mp.x, y: mp.y };
    for (let attempt = 0; attempt < 50; attempt++) {
      const candX = mp.x + (this.rng.next() - 0.5) * (this.terrain.middlePlateauRadius * 0.85);
      const candY = mp.y + (this.rng.next() - 0.5) * (this.terrain.middlePlateauRadius * 0.85);
      if (isValidCandidate(candX, candY)) {
        secondaryPos = { x: candX, y: candY };
        break;
      }
    }
    placedEvents.push({ pos: secondaryPos });

    // 3. Dash (Utility) Shrine — Phase Thruster Pylon (Valley Overlook / Western Basin)
    let dashPos = { x: 1250, y: 2250 };
    for (let attempt = 0; attempt < 50; attempt++) {
      const candX = 1250 + (this.rng.next() - 0.5) * 500;
      const candY = 2250 + (this.rng.next() - 0.5) * 450;
      if (isValidCandidate(candX, candY)) {
        dashPos = { x: candX, y: candY };
        break;
      }
    }
    placedEvents.push({ pos: dashPos });

    // 4. Ultimate (R) Shrine — Celestial Uplink Conduit (Upper Summit Plateau)
    const up = this.terrain.upperPlateauCenter;
    let uplinkPos = { x: up.x + 140, y: up.y - 40 };
    for (let attempt = 0; attempt < 50; attempt++) {
      const candX = up.x + (this.rng.next() - 0.5) * (this.terrain.upperPlateauRadius * 0.85);
      const candY = up.y + (this.rng.next() - 0.5) * (this.terrain.upperPlateauRadius * 0.85);
      if (isValidCandidate(candX, candY)) {
        uplinkPos = { x: candX, y: candY };
        break;
      }
    }
    placedEvents.push({ pos: uplinkPos });

    this.worldEvents = [
      {
        id: 'event_primal_totem',
        type: 'primal_totem',
        name: 'Ancient Bio-Resonance Totem',
        description: 'Fight within the resonance field for the duration. Grants Basic Attack (LMB) Enhancements.',
        pos: totemPos,
        radius: 110,
        chargeProgress: 0,
        isActive: false,
        isCompleted: false,
        pulseTimer: 0,
        elevation: this.terrain.getElevation(totemPos.x, totemPos.y).height
      },
      {
        id: 'event_secondary_totem',
        type: 'secondary_totem',
        name: 'Kinetic Blade Conduit',
        description: 'Defeat 3 sequential Elite organisms. Grants Secondary Attack (RMB) Enhancements.',
        pos: secondaryPos,
        radius: 110,
        chargeProgress: 0,
        isActive: false,
        isCompleted: false,
        pulseTimer: 0,
        elevation: this.terrain.getElevation(secondaryPos.x, secondaryPos.y).height
      },
      {
        id: 'event_dash_totem',
        type: 'dash_totem',
        name: 'Phase Thruster Pylon',
        description: 'Ascend 5 phase platforms to the summit core. Grants Dash (Utility) Enhancements.',
        pos: dashPos,
        radius: 110,
        chargeProgress: 0,
        isActive: false,
        isCompleted: false,
        pulseTimer: 0,
        elevation: this.terrain.getElevation(dashPos.x, dashPos.y).height
      },
      {
        id: 'event_orbital_uplink',
        type: 'orbital_uplink',
        name: 'Celestial Uplink Conduit',
        description: 'Retrieve the beacon core and deliver it (+25% Move Speed, Weapons Offline). Grants Ultimate (R) Enhancements.',
        pos: uplinkPos,
        radius: 115,
        chargeProgress: 0,
        isActive: false,
        isCompleted: false,
        pulseTimer: 0,
        elevation: this.terrain.getElevation(uplinkPos.x, uplinkPos.y).height
      }
    ];
  }

  private generateOrganicPods(): void {
    this.pods = [];
    const sx = this.player.pos.x;
    const sy = this.player.pos.y;
    const shipPos = { x: 1800, y: 2960 };

    const isPodValid = (x: number, y: number): boolean => {
      // 1. Maintain substantial clearance from shipwreck and player starting deck
      if (Math.hypot(x - shipPos.x, y - shipPos.y) < 220) return false;
      if (Math.hypot(x - sx, y - sy) < 220) return false;

      // 2. Clear from major artifact and enhancement shrines
      if (Math.hypot(x - this.artifact.pos.x, y - this.artifact.pos.y) < 160) return false;
      for (const ev of this.worldEvents) {
        if (Math.hypot(x - ev.pos.x, y - ev.pos.y) < 180) return false;
      }

      // 3. Strict minimum spacing between biological chests: >= 240px
      for (const p of this.pods) {
        if (Math.hypot(x - p.pos.x, y - p.pos.y) < 240) return false;
      }

      return this.terrain.isValidEventSpawn(x, y, 40);
    };

    // Appropriate biological chest distribution for a small crater:
    // - 5 in Lower Valley & Riverbanks (Tier 1, cost 10-15)
    // - 3 on Middle Combat Plateau (Tier 2, cost 15-20)
    // - 2 on Upper Summit Plateau (Tier 3, cost 25)
    // Total = 10 pods (spacious, exploration-driven, zero clutter near spawn)
    const tierTargets = [
      { tier: 1, count: 5, minH: 6, maxH: 150, cx: 1800, cy: 2150, rx: 780, ry: 480, baseCost: 10 },
      {
        tier: 2,
        count: 3,
        minH: 200,
        maxH: 350,
        cx: this.terrain.middlePlateauCenter.x,
        cy: this.terrain.middlePlateauCenter.y,
        rx: this.terrain.middlePlateauRadius * 0.75,
        ry: this.terrain.middlePlateauRadius * 0.75,
        baseCost: 15
      },
      {
        tier: 3,
        count: 2,
        minH: 550,
        maxH: 680,
        cx: this.terrain.upperPlateauCenter.x,
        cy: this.terrain.upperPlateauCenter.y,
        rx: this.terrain.upperPlateauRadius * 0.75,
        ry: this.terrain.upperPlateauRadius * 0.75,
        baseCost: 25
      }
    ];

    let podIndex = 1;
    for (const group of tierTargets) {
      for (let c = 0; c < group.count; c++) {
        let placed = false;
        let bestPos = { x: group.cx, y: group.cy };

        for (let attempt = 0; attempt < 120; attempt++) {
          const candX = group.cx + (this.rng.next() - 0.5) * group.rx * 2;
          const candY = group.cy + (this.rng.next() - 0.5) * group.ry * 2;
          const h = this.terrain.calculateHeight(candX, candY);

          if (h < group.minH || h > group.maxH) continue;
          if (!isPodValid(candX, candY)) continue;

          bestPos = { x: candX, y: candY };
          placed = true;
          break;
        }

        if (placed) {
          this.pods.push({
            id: `pod_${podIndex++}`,
            pos: bestPos,
            cost: group.baseCost,
            isOpened: false,
            radius: 36
          });
        }
      }
    }
  }

  private generateMapObstacles(): void {
    this.obstacles = [];

    // Register Crashed Spaceship Hull Obstacles (Cannot walk through solid ship hull)
    this.obstacles.push(
      { id: 'ship_fuselage_1', type: 'rock', pos: { x: 1800, y: 2960 }, radius: 52, scaleVar: 1.0 },
      { id: 'ship_fuselage_2', type: 'rock', pos: { x: 1800, y: 2890 }, radius: 46, scaleVar: 1.0 },
      { id: 'ship_fuselage_3', type: 'rock', pos: { x: 1800, y: 3030 }, radius: 48, scaleVar: 1.0 },
      { id: 'ship_engine_r', type: 'rock', pos: { x: 1885, y: 3030 }, radius: 36, scaleVar: 1.0 },
      { id: 'ship_wing_l', type: 'rock', pos: { x: 1715, y: 3000 }, radius: 38, scaleVar: 1.0 }
    );

    const padding = 160;
    let obsId = 1;

    const distToSeg2D = (px: number, py: number, x0: number, y0: number, x1: number, y1: number): number => {
      const sdx = x1 - x0;
      const sdy = y1 - y0;
      const len2 = sdx * sdx + sdy * sdy;
      if (len2 <= 0.0001) return Math.hypot(px - x0, py - y0);
      const t = Math.max(0, Math.min(1, ((px - x0) * sdx + (py - y0) * sdy) / len2));
      return Math.hypot(px - (x0 + t * sdx), py - (y0 + t * sdy));
    };

    const mp = this.terrain.middlePlateauCenter;
    const up = this.terrain.upperPlateauCenter;
    const r1 = this.terrain.ramp1;
    const r2 = this.terrain.ramp2;
    const r3 = this.terrain.ramp3;

    // Dedicated obstacle-free zones: boss emergence runway, all connecting ramps, main traversal avenues, and combat hubs
    const inBossRunway = (x: number, y: number): boolean => {
      return Math.abs(x - 1800) < 240 && y >= 2300 && y <= 3080;
    };

    const isBlockingPathway = (x: number, y: number): boolean => {
      if (inBossRunway(x, y)) return true;

      // Clear all 3 ramps + generous entry/exit aprons
      const pR1 = this.terrain.getRampU(r1, { x, y });
      if (pR1.u >= -0.30 && pR1.u <= 1.30 && pR1.dist < r1.blendW + 75) return true;
      const pR2 = this.terrain.getRampU(r2, { x, y });
      if (pR2.u >= -0.30 && pR2.u <= 1.30 && pR2.dist < r2.blendW + 75) return true;
      const pR3 = this.terrain.getRampU(r3, { x, y });
      if (pR3.u >= -0.30 && pR3.u <= 1.30 && pR3.dist < r3.blendW + 70) return true;

      // Main valley & plateau highways between spawn, ramps, and plateaus
      if (distToSeg2D(x, y, this.player.pos.x, this.player.pos.y, r1.x0, r1.y0) < 135) return true;
      if (distToSeg2D(x, y, r1.x1, r1.y1, mp.x, mp.y) < 130) return true;
      if (distToSeg2D(x, y, mp.x, mp.y, r2.x0, r2.y0) < 130) return true;
      if (distToSeg2D(x, y, r2.x1, r2.y1, up.x, up.y) < 135) return true;
      if (distToSeg2D(x, y, 1800, 2520, r3.x0, r3.y0) < 120) return true;

      // Open fighting arenas on plateau centers
      if (Math.hypot(x - mp.x, y - mp.y) < 160) return true;
      if (Math.hypot(x - up.x, y - up.y) < 180) return true;

      return false;
    };

    // 1. Rare, Visually Significant Crystals (4 iconic formations, distinct colors & silhouettes)
    const targetCrystals = 4;
    for (let c = 0; c < targetCrystals * 6 && this.obstacles.filter(o => o.type === 'crystal').length < targetCrystals; c++) {
      const ox = padding + this.rng.next() * (this.worldWidth - padding * 2);
      const oy = padding + this.rng.next() * (this.worldHeight - padding * 2);
      if (isBlockingPathway(ox, oy)) continue;
      const h = this.terrain.calculateHeight(ox, oy);
      if (h < 12 || h >= 680) continue;
      if (this.terrain.getSurfaceSlope(ox, oy, 15) > 0.28) continue;
      if (Math.hypot(ox - 1800, oy - 2960) < 220) continue; // Shipwreck clearance
      if (Math.hypot(ox - this.player.pos.x, oy - this.player.pos.y) < 210) continue; // Spawn clearance
      if (Math.hypot(ox - this.artifact.pos.x, oy - this.artifact.pos.y) < 140) continue;

      let overlap = false;
      for (const ev of this.worldEvents) if (Math.hypot(ox - ev.pos.x, oy - ev.pos.y) < 110) overlap = true;
      for (const p of this.pods) if (Math.hypot(ox - p.pos.x, oy - p.pos.y) < 85) overlap = true;
      for (const o of this.obstacles) if (Math.hypot(ox - o.pos.x, oy - o.pos.y) < 150) overlap = true;
      if (overlap) continue;

      this.obstacles.push({
        id: `obs_c_${obsId++}`,
        type: 'crystal',
        variant: c % 4, // 0: Violet, 1: Cyan, 2: Amber, 3: Crimson
        pos: { x: ox, y: oy },
        radius: 22,
        scaleVar: this.rng.range(0.95, 1.35)
      });
    }

    // 2. Distinctive Alien Trees (7 sparse landmark organic trees)
    const targetTrees = 7;
    for (let t = 0; t < targetTrees * 6 && this.obstacles.filter(o => o.type === 'tree').length < targetTrees; t++) {
      const ox = padding + this.rng.next() * (this.worldWidth - padding * 2);
      const oy = padding + this.rng.next() * (this.worldHeight - padding * 2);
      if (isBlockingPathway(ox, oy)) continue;
      const h = this.terrain.calculateHeight(ox, oy);
      if (h < 10 || h >= 650) continue;
      if (this.terrain.getSurfaceSlope(ox, oy, 15) > 0.28) continue;
      if (Math.hypot(ox - 1800, oy - 2960) < 230) continue;
      if (Math.hypot(ox - this.player.pos.x, oy - this.player.pos.y) < 210) continue;
      if (Math.hypot(ox - this.artifact.pos.x, oy - this.artifact.pos.y) < 140) continue;

      let overlap = false;
      for (const ev of this.worldEvents) if (Math.hypot(ox - ev.pos.x, oy - ev.pos.y) < 115) overlap = true;
      for (const p of this.pods) if (Math.hypot(ox - p.pos.x, oy - p.pos.y) < 90) overlap = true;
      for (const o of this.obstacles) if (Math.hypot(ox - o.pos.x, oy - o.pos.y) < 170) overlap = true;
      if (overlap) continue;

      this.obstacles.push({
        id: `obs_t_${obsId++}`,
        type: 'tree',
        variant: t % 3, // 0: Crimson Canopy, 1: Crimson Veins, 2: Coral Tree
        pos: { x: ox, y: oy },
        radius: 32,
        scaleVar: this.rng.range(0.9, 1.2)
      });
    }

    // 3. Sparse Rock Formations (14 perimeter/scenic formations well clear of avenues)
    const targetRocks = 14;
    for (let r = 0; r < targetRocks * 6 && this.obstacles.filter(o => o.type === 'rock').length < (targetRocks + 5); r++) {
      const ox = padding + this.rng.next() * (this.worldWidth - padding * 2);
      const oy = padding + this.rng.next() * (this.worldHeight - padding * 2);
      if (isBlockingPathway(ox, oy)) continue;
      const h = this.terrain.calculateHeight(ox, oy);
      if (h < 5 || h >= 680) continue;
      if (this.terrain.getSurfaceSlope(ox, oy, 15) > 0.34) continue;
      if (Math.hypot(ox - 1800, oy - 2960) < 200) continue;
      if (Math.hypot(ox - this.player.pos.x, oy - this.player.pos.y) < 180) continue;

      let overlap = false;
      for (const ev of this.worldEvents) if (Math.hypot(ox - ev.pos.x, oy - ev.pos.y) < 105) overlap = true;
      for (const p of this.pods) if (Math.hypot(ox - p.pos.x, oy - p.pos.y) < 85) overlap = true;
      for (const o of this.obstacles) if (Math.hypot(ox - o.pos.x, oy - o.pos.y) < 140) overlap = true;
      if (overlap) continue;

      this.obstacles.push({
        id: `obs_r_${obsId++}`,
        type: 'rock',
        variant: r % 25,
        pos: { x: ox, y: oy },
        radius: 26,
        scaleVar: this.rng.range(0.85, 1.25)
      });
    }

    // 4. Sparse Moist Fungi & Alien Flora (8 clusters clear of walkways)
    const targetFlora = 8;
    for (let f = 0; f < targetFlora * 6 && this.obstacles.filter(o => o.type === 'mushroom' || o.type === 'flora').length < targetFlora; f++) {
      const ox = padding + this.rng.next() * (this.worldWidth - padding * 2);
      const oy = padding + this.rng.next() * (this.worldHeight - padding * 2);
      if (isBlockingPathway(ox, oy)) continue;
      const h = this.terrain.calculateHeight(ox, oy);
      if (h < 4 || h >= 550) continue;
      if (this.terrain.getSurfaceSlope(ox, oy, 15) > 0.30) continue;
      if (Math.hypot(ox - 1800, oy - 2960) < 180) continue;
      if (Math.hypot(ox - this.player.pos.x, oy - this.player.pos.y) < 160) continue;

      let overlap = false;
      for (const ev of this.worldEvents) if (Math.hypot(ox - ev.pos.x, oy - ev.pos.y) < 95) overlap = true;
      for (const p of this.pods) if (Math.hypot(ox - p.pos.x, oy - p.pos.y) < 75) overlap = true;
      for (const o of this.obstacles) if (Math.hypot(ox - o.pos.x, oy - o.pos.y) < 120) overlap = true;
      if (overlap) continue;

      this.obstacles.push({
        id: `obs_f_${obsId++}`,
        type: f % 2 === 0 ? 'mushroom' : 'flora',
        variant: f % 4,
        pos: { x: ox, y: oy },
        radius: 16,
        scaleVar: this.rng.range(0.9, 1.25)
      });
    }
  }

  public updateCalculatedStats(): void {
    const p = this.player;
    const prevMax = p.maxHealth;
    const prevMaxFuel = p.maxJetpackFuel || 100;

    // Runtime Trigger & Augment-Specific transient bonuses
    let runtimeSpeedBonus = 0;
    let runtimeDamageBonus = 0;
    let runtimeDRBonus = 0;
    let runtimeLmbAtkBonus = 0;

    if ((p.bloodRushTimer ?? 0) > 0 && (p.buffs.buff_blood_rush || 0) > 0) {
      const n = p.buffs.buff_blood_rush || 0;
      runtimeLmbAtkBonus += 0.03 * n;
      runtimeSpeedBonus += 0.02 * n;
    }

    if (p.health > 0 && p.health / Math.max(1, p.maxHealth) < 0.40 && (p.buffs.buff_final_stand || 0) > 0) {
      const n = p.buffs.buff_final_stand || 0;
      runtimeDamageBonus += 0.03 * n;
      runtimeDRBonus += 0.02 * n;
    }

    if ((p.retaliationTimer ?? 0) > 0 && (p.buffs.buff_retaliation || 0) > 0) {
      runtimeDamageBonus += 0.02 * (p.buffs.buff_retaliation || 0);
    }

    if ((p.killingMomentumTimer ?? 0) > 0 && (p.killingMomentumStacks ?? 0) > 0 && (p.buffs.buff_killing_momentum || 0) > 0) {
      const n = p.buffs.buff_killing_momentum || 0;
      const kmStacks = Math.min(3, p.killingMomentumStacks || 0);
      runtimeSpeedBonus += 0.01 * n * kmStacks;
    }

    if ((p.survivalInstinctTimer ?? 0) > 0 && (p.buffs.buff_survival_instinct || 0) > 0) {
      runtimeSpeedBonus += 0.02 * (p.buffs.buff_survival_instinct || 0);
    }

    if (
      (p.postDashSpeedTimer ?? 0) > 0 &&
      p.heroId === 'commander' &&
      p.skillEnhancements.utility === 'teleport'
    ) {
      const vsStacks = p.buffs.buff_cmd_velocity_surge || 0;
      const aeStacks = p.buffs.buff_cmd_adrenal_extension || 0;
      if (vsStacks > 0 || aeStacks > 0) {
        runtimeSpeedBonus += 0.12 + 0.04 * vsStacks;
      }
    }

    p.calculatedStats = calculateStats(
      p.baseMaxHealth,
      p.baseMoveSpeed,
      p.items,
      p.buffs,
      {
        baseDamageReduction: p.baseDamageReduction,
        baseHealthRegenPercent: p.baseHealthRegenPercent,
        runtimeSpeedBonusFraction: runtimeSpeedBonus,
        runtimeDamageBonusFraction: runtimeDamageBonus,
        runtimeDamageReductionBonus: runtimeDRBonus,
        runtimeLmbAttackSpeedBonusFraction: runtimeLmbAtkBonus,
        completedEnhancements: this.completedEnhancementCategories.size,
        activeTimedEffects: p.activeTimedEffects
      }
    );

    if (p.inSanctuaryCross) {
      p.calculatedStats.damageMultiplier *= DOCTOR_CONFIG.sacredField.allyDamageMult;
      p.calculatedStats.attackSpeedMultiplier *= DOCTOR_CONFIG.sacredField.allyAttackSpeedMult;
      p.calculatedStats.lmbAttackSpeedMultiplier *= DOCTOR_CONFIG.sacredField.allyAttackSpeedMult;
      p.calculatedStats.moveSpeed *= 1.15;
    }
    if ((p.adrenalineRushTimer ?? 0) > 0) {
      p.calculatedStats.moveSpeed *= DOCTOR_CONFIG.adrenalineRush.moveSpeedMultiplier;
      if (p.heroId === 'doctor' && p.skillEnhancements?.utility === 'adrenaline_rush') {
        const erStacks = p.buffs.buff_doc_emergency_reflex || 0;
        if (erStacks > 0) {
          p.calculatedStats.lmbAttackSpeedMultiplier += 0.02 * erStacks;
        }
      }
    }
    if (p.isCarryingEventPayload) {
      p.calculatedStats.moveSpeed *= 1.25;
    }
    p.calculatedStats.moveSpeed = Math.min(p.baseMoveSpeed * 2.25, p.calculatedStats.moveSpeed);

    p.maxHealth = p.calculatedStats.maxHealth;
    p.moveSpeed = p.calculatedStats.moveSpeed;
    p.maxAirJumps = p.calculatedStats.extraAirJumps;

    const newMaxFuel = 100 * p.calculatedStats.jetpackCapacityMultiplier;
    p.maxJetpackFuel = newMaxFuel;
    if (newMaxFuel > prevMaxFuel) {
      p.jetpackFuel = Math.min(newMaxFuel, p.jetpackFuel + (newMaxFuel - prevMaxFuel));
    } else {
      p.jetpackFuel = Math.min(newMaxFuel, p.jetpackFuel);
    }

    if (p.maxHealth > prevMax) {
      // Only add the delta from max health increases (never full-heals on Vitality gain)
      p.health = Math.min(p.maxHealth, p.health + (p.maxHealth - prevMax));
    } else {
      p.health = Math.min(p.maxHealth, p.health);
    }
  }

  public getActiveProfileKey(): StageProfileKey {
    return this.terrain.isCustomTestMap ? 'custom_map' : 'procedural';
  }

  public applyStageConfig(config: StageConfig, profileKey?: StageProfileKey): boolean {
    this.activeStageConfig = config;
    this.stageNumber = config.stageNumber || 1;
    const key = profileKey || this.getActiveProfileKey();
    const profile = config.profiles?.[key];
    if (!profile) return false;
    this.applyStageProfile(profile);
    return true;
  }

  public applyStageProfile(profile: StageLayoutProfile): void {
    if (profile.environment?.stageName) {
      this.stageName = profile.environment.stageName;
    }

    if (profile.playerSpawn && profile.playerSpawn.enabled) {
      this.playerSpawnPos = { x: profile.playerSpawn.x, y: profile.playerSpawn.y };
      if (this.terrain.isCustomTestMap) {
        this.terrain.testSpawnPos = { ...this.playerSpawnPos };
      }
      const elev = this.terrain.getElevation(this.playerSpawnPos.x, this.playerSpawnPos.y).height;
      const zOff = profile.playerSpawn.zOffset ?? 0;
      this.player.pos.x = this.playerSpawnPos.x;
      this.player.pos.y = this.playerSpawnPos.y;
      this.player.z = elev + zOff;
      this.player.groundZ = elev;
    }

    if (profile.bossSpawn && profile.bossSpawn.enabled) {
      this.bossSpawnPos = { x: profile.bossSpawn.x, y: profile.bossSpawn.y };
      if (this.terrain.isCustomTestMap) {
        this.terrain.testBossSpawnPos = { ...this.bossSpawnPos };
      }
    }

    if (profile.teleporter && this.artifact) {
      this.artifact.pos = { x: profile.teleporter.x, y: profile.teleporter.y };
      this.artifact.zOffset = profile.teleporter.zOffset ?? 0;
      this.artifact.rotationY = profile.teleporter.rotationY ?? 0;
      this.artifact.scale = profile.teleporter.scale ?? 1;
      this.artifact.radius = profile.teleporter.radius ?? 55;
      if (profile.teleporter.chargePerKill !== undefined) {
        this.artifact.chargePerKill = profile.teleporter.chargePerKill;
      }
      this.resetArtifactProgression();
    }

    if (Array.isArray(profile.worldEvents)) {
      this.terrain.activeDashPlatforms = [];
      this.player.isCarryingEventPayload = false;
      this.player.carryingEventId = null;
      this.worldEvents = profile.worldEvents
        .filter((ev) => ev.enabled !== false)
        .map((ev) => ({
          id: ev.id,
          type: ev.type,
          name: ev.name,
          description: ev.description,
          pos: { x: ev.x, y: ev.y },
          zOffset: ev.zOffset ?? 0,
          rotationY: ev.rotationY ?? 0,
          scale: ev.scale ?? 1,
          radius: ev.radius || 110,
          chargeProgress: 0,
          isActive: false,
          isCompleted: false,
          pulseTimer: 0,
          elevation: this.terrain.getElevation(ev.x, ev.y).height + (ev.zOffset ?? 0)
        }));
      if (!this.worldEvents.some((ev) => ev.type === 'secondary_totem')) {
        const secX = Math.round(this.worldWidth * 0.68);
        const secY = Math.round(this.worldHeight * 0.68);
        this.worldEvents.splice(1, 0, {
          id: 'event_secondary_totem_auto',
          type: 'secondary_totem',
          name: 'Kinetic Blade Conduit',
          description: 'Defeat 3 sequential Elite organisms. Grants Secondary Attack (RMB) Enhancements.',
          pos: { x: secX, y: secY },
          zOffset: 0,
          rotationY: 0,
          scale: 1,
          radius: 110,
          chargeProgress: 0,
          isActive: false,
          isCompleted: false,
          pulseTimer: 0,
          elevation: this.terrain.getElevation(secX, secY).height
        });
      }
    }

    if (Array.isArray(profile.pods)) {
      this.pods = profile.pods
        .filter((pod) => pod.enabled !== false)
        .map((pod) => ({
          id: pod.id,
          name: pod.name,
          pos: { x: pod.x, y: pod.y },
          zOffset: pod.zOffset ?? 0,
          rotationY: pod.rotationY ?? 0,
          scale: pod.scale ?? 1,
          cost: pod.cost,
          isOpened: false,
          radius: pod.radius || 36
        }));
    }

    if (Array.isArray(profile.obstacles)) {
      this.obstacles = profile.obstacles
        .filter((obs) => obs.enabled !== false)
        .map((obs) => ({
          id: obs.id,
          name: obs.name,
          type: obs.type,
          subtype: obs.subtype,
          variant: obs.variant,
          pos: { x: obs.x, y: obs.y },
          zOffset: obs.zOffset ?? 0,
          rotationY: obs.rotationY ?? 0,
          radius: obs.radius,
          scaleVar: obs.scaleVar || 1,
          placementRule: obs.placementRule
        }));
    }

    this.enemySpawnRegions = Array.isArray(profile.enemySpawnRegions)
      ? profile.enemySpawnRegions.map((r) => ({ ...r, allowedTypes: [...r.allowedTypes] }))
      : [];

    if (this.terrain.meshCollider && profile.terrainOverrides) {
      this.terrain.meshCollider.applyOverrides(profile.terrainOverrides);
    }
  }

  public exportCurrentProfile(): StageLayoutProfile {
    const bossPos =
      this.terrain.isCustomTestMap && this.terrain.testBossSpawnPos
        ? this.terrain.testBossSpawnPos
        : this.bossSpawnPos;
    const spawnPos =
      this.terrain.isCustomTestMap && this.terrain.testSpawnPos
        ? this.terrain.testSpawnPos
        : this.playerSpawnPos;

    return {
      terrainSeed: this.terrain.seed,
      environment: {
        stageName: this.stageName,
        terrainAsset: this.terrain.isCustomTestMap ? 'custom_map' : 'procedural_heightfield',
        waterLevel: 5.2,
        narrativeTriggersEnabled: !this.terrain.isCustomTestMap || this.terrain.allowTestMapNarrative
      },
      playerSpawn: {
        id: 'player_spawn',
        name: 'Player Spawn',
        x: Math.round(spawnPos.x * 100) / 100,
        y: Math.round(spawnPos.y * 100) / 100,
        zOffset: 0,
        rotationY: 0,
        enabled: true
      },
      bossSpawn: {
        id: 'boss_spawn',
        name: 'Stage 1 Titan Boss Spawn',
        x: Math.round(bossPos.x * 100) / 100,
        y: Math.round(bossPos.y * 100) / 100,
        zOffset: 0,
        rotationY: 0,
        enabled: true
      },
      teleporter: {
        id: 'overseer_teleporter',
        name: 'Overseer Artifact (Teleporter)',
        x: Math.round(this.artifact.pos.x * 100) / 100,
        y: Math.round(this.artifact.pos.y * 100) / 100,
        zOffset: this.artifact.zOffset ?? 0,
        rotationY: this.artifact.rotationY ?? 0,
        scale: this.artifact.scale ?? 1,
        radius: this.artifact.radius,
        chargePerKill: this.artifact.chargePerKill,
        enabled: true
      },
      worldEvents: this.worldEvents.map((ev) => ({
        id: ev.id,
        type: ev.type,
        name: ev.name,
        description: ev.description,
        x: Math.round(ev.pos.x * 100) / 100,
        y: Math.round(ev.pos.y * 100) / 100,
        zOffset: ev.zOffset ?? 0,
        rotationY: ev.rotationY ?? 0,
        scale: ev.scale ?? 1,
        radius: ev.radius,
        enabled: true
      })),
      pods: this.pods.map((pod, idx) => ({
        id: pod.id,
        name: pod.name || `Bio-Chest #${idx + 1} (${pod.cost}G)`,
        x: Math.round(pod.pos.x * 100) / 100,
        y: Math.round(pod.pos.y * 100) / 100,
        zOffset: pod.zOffset ?? 0,
        rotationY: pod.rotationY ?? 0,
        scale: pod.scale ?? 1,
        cost: pod.cost,
        radius: pod.radius,
        enabled: true
      })),
      obstacles: this.obstacles.map((obs) => ({
        id: obs.id,
        name: obs.name || formatObstacleDisplayName(obs.type, obs.id, obs.variant),
        type: obs.type,
        subtype: obs.subtype,
        variant: obs.variant,
        x: Math.round(obs.pos.x * 100) / 100,
        y: Math.round(obs.pos.y * 100) / 100,
        zOffset: obs.zOffset ?? 0,
        rotationY: obs.rotationY ?? 0,
        scaleVar: Math.round((obs.scaleVar || 1) * 1000) / 1000,
        radius: obs.radius,
        enabled: true,
        placementRule: obs.placementRule || (obs.type === 'flora' ? 'water' : 'terrain')
      })),
      enemySpawnRegions:
        this.enemySpawnRegions.length > 0
          ? this.enemySpawnRegions.map((r) => ({ ...r, allowedTypes: [...r.allowedTypes] }))
          : [
            {
              id: 'region_default_stage1',
              name: 'Stage 1 Default Crater Spawn Zone',
              shape: 'circle',
              x: 1800,
              y: 1800,
              zOffset: 0,
              radius: 1700,
              width: 3400,
              height: 3400,
              allowedTypes: ['crawler', 'spitter', 'wasp', 'elite'],
              spawnDensity: 1.0,
              maxActiveEnemies: 40,
              minPlayerDistance: 420,
              terrainRestriction: 'walkable',
              minElevation: 0,
              maxElevation: 680,
              enabled: false
            }
          ],
      ...(this.terrain.meshCollider && Object.keys(this.terrain.meshCollider.overrides).length > 0
        ? { terrainOverrides: { ...this.terrain.meshCollider.overrides } }
        : {})
    };
  }
}

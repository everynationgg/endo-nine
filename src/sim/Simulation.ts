import { GameState } from './GameState';
import {
  InputSnapshot,
  Direction4,
  Vector2,
  Vector3,
  EnemyState,
  ProjectileState,
  OrbitalStrikeState,
  SimEvent,
  ItemId,
  BuffId,
  EnemyType,
  OrganicPodState,
  WorldEventState,
  DashEventPlatform,
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
  ExclusiveEventPool,
  SkillSlot,
  SkillEnhancementId,
  TimedEffectId
} from './types';
import { SpatialGrid } from './SpatialGrid';
import { COMMANDER_SKILLS, DOCTOR_SKILLS, SKILL_REGISTRY } from './SkillDefs';
import { DOCTOR_CONFIG } from './DoctorConfig';
import { ENEMY_CONFIGS, ENEMY_PROJECTILE_PERMISSIONS, ENEMY_COMBAT_BALANCE } from './EnemyDefs';
import {
  LOOT_CONFIG,
  rollWeightedRandomBuff,
  isBuffEligibleForPlayer,
  rollThreeBuffChoices,
  BUFF_REGISTRY,
  ITEM_REGISTRY,
  ALL_BUFF_IDS
} from './ItemDefs';
import { getDifficultyTier } from './DifficultyDefs';
import { STAGE1_BOSS_CONFIG } from './Stage1BossConfig';
import { getStageArtifactPolicy } from './StageProgressionPolicy';
import { CombatDirector, type CombatDirectorDiagnostics } from './CombatDirector';
import { generateStagePods, type SceneDirectorReport } from './SceneDirector';
import { generateFreshRunSeed } from './RngStreams';
import { SeededRandom } from './ItemDefs';
import type { StageConfig } from '../dev/StageConfig';

export interface DamageEnemyOptions {
  isRecursiveTrigger?: boolean;
  isDirectAttack?: boolean;
  isPrimaryLmb?: boolean;
  attackActivationId?: number;
}

export class Simulation {
  public state: GameState;
  private spatialGrid: SpatialGrid;
  private enemySpawnTimer: number = 0;
  private currentDifficultyTier: number = 0;
  private nextEnemyId: number = 1;
  private nextProjId: number = 1;
  private nextStrikeId: number = 1;
  private nextDropId: number = 1;
  private nextItemDropId: number = 1;
  private airborneDuration: number = 0;
  private nextAttackActivationId: number = 1;
  private isExecutingPrimaryLmb: boolean = false;
  private nextEnemyAttackInstanceId: number = 1;
  private cooldownHarvestThisSecond: number = 0;
  private cooldownHarvestWindowTimer: number = 0;
  private pendingDraftFilters: Array<ExclusiveEventPool | undefined> = [];
  private lastCameraForward?: Vector2;
  private lastCameraRight?: Vector2;
  private navCalcsThisTick: number = 0;
  private combatDirector: CombatDirector = new CombatDirector();
  private stage1BossCycle: number = 0;
  private bossEmergePhaseStage: number = 0;
  private lastSafeGroundedPos: { x: number; y: number; z: number } | null = null;
  private stuckPrevPos: Vector2 | null = null;
  private stuckCheckTimer: number = 0;
  private unstuckCooldown: number = 0;
  private stage1EnemySpawningUnlocked: boolean = false;
  private stage1EnemySpawnUnlockReason: string | null = null;
  private essentialDialogueBusyChecker: (() => boolean) | null = null;

  // Development Debugger Toggles (off by default in normal gameplay)
  public devPlayerInvulnerable: boolean = false;
  public devEnemyAiPaused: boolean = false;
  public devBossAiPaused: boolean = false;

  public isCorruptionActive(): boolean {
    for (let i = 0; i < this.state.worldEvents.length; i++) {
      if (this.state.worldEvents[i].type === 'void_corruption' && this.state.worldEvents[i].isActive) {
        return true;
      }
    }
    return false;
  }

  public unlockStage1EnemySpawning(reason: string): void {
    this.combatDirector.unlockExploration();
    if (this.stage1EnemySpawningUnlocked) return;
    this.stage1EnemySpawningUnlocked = true;
    this.stage1EnemySpawnUnlockReason = reason;
    this.enemySpawnTimer = Math.min(this.enemySpawnTimer, 0.45);
  }

  public getCombatDirectorDiagnostics(): CombatDirectorDiagnostics {
    return this.combatDirector.getDiagnostics(this.state);
  }

  private applyGeneratedPodLayout(): SceneDirectorReport {
    const { pods, report } = generateStagePods(
      this.state,
      this.state.layoutRng,
      this.state.layoutSeed
    );
    this.state.pods = pods;
    this.state.sceneDirectorReport = report;
    return report;
  }

  public regenerateRuntimePodLayout(pinnedSeed?: number | null): SceneDirectorReport {
    if (pinnedSeed === null) {
      this.state.pinnedLayoutSeed = null;
      const freshSeed = generateFreshRunSeed();
      this.state.layoutSeed = freshSeed;
      this.state.layoutRng = new SeededRandom(freshSeed);
    } else if (typeof pinnedSeed === 'number' && Number.isFinite(pinnedSeed) && pinnedSeed > 0) {
      const normalized = (Math.floor(pinnedSeed) >>> 0) || 1;
      this.state.pinnedLayoutSeed = normalized;
      this.state.layoutSeed = normalized;
      this.state.layoutRng = new SeededRandom(normalized);
    } else {
      this.state.layoutRng = new SeededRandom(this.state.layoutSeed || 1);
    }
    return this.applyGeneratedPodLayout();
  }

  public isStage1EnemySpawningUnlocked(): boolean {
    return this.stage1EnemySpawningUnlocked;
  }

  public setEssentialDialogueBusyChecker(checker: (() => boolean) | null): void {
    this.essentialDialogueBusyChecker = checker;
  }

  public isEssentialDepartureDialogueBusy(): boolean {
    return this.essentialDialogueBusyChecker ? Boolean(this.essentialDialogueBusyChecker()) : false;
  }

  public getStage1EnemySpawnUnlockReason(): string | null {
    return this.stage1EnemySpawnUnlockReason;
  }

  /**
   * Computes safe initial exploration radius around spawn based on the outer activation edge
   * of the closest world event (falls back to 1200u if no events exist, minimum 300u).
   */
  public getStage1SpawnSafeRadius(): number {
    if (!this.state.worldEvents || this.state.worldEvents.length === 0) {
      return 1200;
    }
    const spawn =
      this.state.terrain.isCustomTestMap && this.state.terrain.testSpawnPos
        ? this.state.terrain.testSpawnPos
        : this.state.playerSpawnPos;
    let minEdgeDist = Infinity;
    for (let i = 0; i < this.state.worldEvents.length; i++) {
      const ev = this.state.worldEvents[i];
      const dist = Math.hypot(ev.pos.x - spawn.x, ev.pos.y - spawn.y);
      const edgeDist = Math.max(0, dist - (ev.radius || 110));
      if (edgeDist < minEdgeDist) {
        minEdgeDist = edgeDist;
      }
    }
    return Number.isFinite(minEdgeDist) ? Math.max(300, minEdgeDist) : 1200;
  }

  constructor(stateOrSeed?: GameState | number, initialStageConfig?: StageConfig | null) {
    if (typeof stateOrSeed === 'number') {
      this.state = new GameState(stateOrSeed, 'commander', initialStageConfig);
    } else {
      this.state = stateOrSeed || new GameState(undefined, 'commander', initialStageConfig);
    }
    this.spatialGrid = new SpatialGrid(160);
  }

  public selectHero(heroId: HeroId): void {
    this.state.selectHero(heroId);
  }

  public isPointInSanctuaryCross(pos: Vector2, z: number, cross: SanctuaryCrossState, radius: number = 0): boolean {
    if (Math.abs(z - cross.z) > 140) return false;
    let rx = pos.x - cross.pos.x;
    let ry = pos.y - cross.pos.y;
    if (cross.rotation) {
      const cos = Math.cos(-cross.rotation);
      const sin = Math.sin(-cross.rotation);
      const nx = rx * cos - ry * sin;
      const ny = rx * sin + ry * cos;
      rx = nx;
      ry = ny;
    }
    const dx = Math.abs(rx);
    const dy = Math.abs(ry);
    return (
      (dx <= cross.armHalfLength + radius && dy <= cross.armHalfWidth + radius) ||
      (dy <= cross.armHalfLength + radius && dx <= cross.armHalfWidth + radius)
    );
  }

  public tick(dt: number, input: InputSnapshot): SimEvent[] {
    this.state.events = [];
    this.navCalcsThisTick = 0;

    const safeInput: InputSnapshot = {
      moveDir: input?.moveDir || { x: 0, y: 0 },
      aimDir: input?.aimDir || { x: 0, y: 1 },
      wantDash: !!input?.wantDash,
      wantUltimate: !!input?.wantUltimate,
      wantInteract: !!input?.wantInteract,
      wantJump: !!input?.wantJump,
      holdJump: !!input?.holdJump,
      cameraYaw: input?.cameraYaw || 0,
      cameraForward: input?.cameraForward,
      cameraRight: input?.cameraRight,
      wantPrimaryManual: !!input?.wantPrimaryManual,
      wantSecondaryManual: !!input?.wantSecondaryManual,
      mouseWorldPos: input?.mouseWorldPos,
      mouseWorldPos3D: input?.mouseWorldPos3D
    };
    input = safeInput;

    // Pause simulation completely if game has not started, or during Game Over, Stage Clear, or 3-Choice Buff Selection
    if (
      !this.state.isGameStarted ||
      this.state.isGameOver ||
      this.state.isStageCleared ||
      this.state.isPausedForBuffChoice ||
      this.state.isPaused
    ) {
      return this.state.events;
    }

    this.state.gameTime += dt;

    // Risk of Rain 2 Style Difficulty Escalation Check
    const { tierDef, tierIndex } = getDifficultyTier(this.state.gameTime);
    if (tierIndex > this.currentDifficultyTier) {
      this.currentDifficultyTier = tierIndex;
      this.state.events.push({
        type: 'difficulty_advanced',
        data: {
          tier: tierIndex,
          name: tierDef.name,
          color: tierDef.color,
          description: tierDef.description
        }
      });
    }

    // 1. Rebuild Spatial Grid
    this.spatialGrid.clear();
    for (let i = 0; i < this.state.enemies.length; i++) {
      this.spatialGrid.insert(this.state.enemies[i]);
    }

    // 2. Player Timers & Passive Regen
    this.updatePlayerTimers(dt);
    this.updateRecoveryFields(dt);
    this.updateToxicFields(dt);
    this.updateFrostTrails(dt);
    this.updateSanctuaryCrosses(dt);
    this.updateDoctorDrones(dt);
    this.updateHolographicDecoys(dt);
    this.updateDivineAngels(dt);
    this.updateFallingCrosses(dt);

    // 3. Player Movement & Dash
    this.updatePlayerMovement(dt, input);
    for (let i = 0; i < this.state.sanctuaryCrosses.length; i++) {
      const cross = this.state.sanctuaryCrosses[i];
      if (cross.isMobile) {
        cross.pos.x = this.state.player.pos.x;
        cross.pos.y = this.state.player.pos.y;
        cross.z = this.state.player.z;
      }
    }

    // 4. Skills & Combat (Auto + Manual)
    this.updateSkills(dt, input);

    // 5. Projectiles Update & Collisions
    this.updateProjectiles(dt);

    // 6. Orbital Strikes Update
    this.updateOrbitalStrikes(dt);

    // 7. Enemy AI & Movement
    this.updateEnemies(dt);

    // 8. Enemy Spawner
    this.updateEnemySpawning(dt);

    // 9. Bio-Sac (Pod) 'E' Interaction & Biological Dissolution Lifecycle
    this.updatePods(input, dt);

    // 10. Overseer Artifact Check ('E' or proximity extraction)
    this.updateArtifact(dt, input);

    // 11. World Events System (Totem, Uplink, Corruption)
    this.updateWorldEvents(dt, input);

    // 12. Physical Currency (Genes) & Passive Item Drops Physics & Collection
    this.updateCurrencyPickups(dt);
    this.updateItemDrops(dt, input);

    return this.state.events;
  }

  /**
   * Called when the player clicks "Initiate Drop" to begin gameplay cleanly at 00:00
   */
  public startRun(forcedRunSeed?: number): void {
    this.state.reseedRunStreams(forcedRunSeed);
    this.state.isGameStarted = true;
    this.state.gameTime = 0;
    this.currentDifficultyTier = 0;
    this.state.isGameOver = false;
    this.state.isStageCleared = false;
    this.state.isPaused = false;
    this.state.isPausedForBuffChoice = false;
    this.state.pendingBuffDrafts = 0;
    this.state.currentBuffChoices = [];
    this.state.events = [];

    // Clear active combat entities
    this.state.enemies = [];
    this.state.projectiles = [];
    this.state.orbitalStrikes = [];
    this.state.recoveryFields = [];
    this.state.toxicFields = [];
    this.state.sanctuaryCrosses = [];
    this.state.frostTrails = [];
    this.state.vitalTethers = [];
    this.state.doctorDrones = [];
    this.state.holographicDecoys = [];
    this.state.divineAngels = [];
    this.state.fallingCrosses = [];
    this.state.currencyDrops = [];
    this.state.itemDrops = [];
    this.enemySpawnTimer = 0;
    this.stage1EnemySpawningUnlocked = false;
    this.stage1EnemySpawnUnlockReason = null;
    this.combatDirector.reset(this.state.directorRng);
    this.nextEnemyId = 1;
    this.nextProjId = 1;
    this.nextStrikeId = 1;
    this.nextDropId = 1;
    this.nextItemDropId = 1;

    // Re-apply active stage config so pods, events, obstacles, and spawns reflect latest saved/playtest layout
    if (this.state.activeStageConfig) {
      this.state.applyStageConfig(this.state.activeStageConfig);
    }
    this.state.resetArtifactProgression();

    // Reset hero stats and equipped skills cleanly without run-to-run leakage
    this.state.selectHero(this.state.selectedHeroId);

    // Reset player position, health, and status
    const p = this.state.player;
    p.pos = (this.state.terrain.isCustomTestMap && this.state.terrain.testSpawnPos)
      ? { ...this.state.terrain.testSpawnPos }
      : { ...this.state.playerSpawnPos };
    p.velocity = { x: 0, y: 0 };
    p.facing = 'front';
    p.castFacingLockTimer = 0;
    p.health = p.maxHealth;
    p.defenseBonusTimer = 0;
    p.hurtInvulnTimer = 0;
    p.enemyProjectileGraceTimer = 0;
    p.hitByEnemyAttackInstanceIds?.clear();
    this.nextEnemyAttackInstanceId = 1;
    p.z = this.state.terrain.getElevation(p.pos.x, p.pos.y, 1e6, 22).height;
    p.vz = 0;
    p.groundZ = p.z;
    p.isGrounded = true;
    p.isJumping = false;
    p.isGliding = false;
    p.jetpackFuel = 100;
    p.maxAirJumps = 0;
    p.airJumpsRemaining = 0;
    p.inWater = false;
    p.primaryCooldownRemaining = 0;
    p.secondaryCooldownRemaining = 0;
    p.utilityCooldownRemaining = 0;
    p.ultimateCooldownRemaining = 0;
    p.isDashing = false;
    p.dashDurationTimer = 0;
    p.pistolHand = 'left';
    p.phaseBarrierTimer = 0;
    p.adrenalineRushTimer = 0;
    p.toxicRainTimer = 0;
    p.toxicRainTickTimer = 0;
    p.toxicRainOrigin = undefined;
    p.tempShieldAmount = 0;
    p.tempShieldTimer = 0;
    p.emergencyBarrierCooldown = 0;
    p.chainReactionCooldown = 0;
    p.secondWindCooldown = 0;
    p.staticDischargeCooldown = 0;
    p.aftershockCooldown = 0;
    p.reactiveShieldCooldown = 0;
    p.survivalInstinctCooldown = 0;
    p.bloodRushTimer = 0;
    p.bloodRushRecentKills = 0;
    p.bloodRushKillWindowTimer = 0;
    p.combatFocusHitCount = 0;
    p.killingMomentumTimer = 0;
    p.killingMomentumStacks = 0;
    p.isCarryingEventPayload = false;
    p.carryingEventId = null;
    this.state.terrain.activeDashPlatforms = [];
    for (let i = 0; i < this.state.worldEvents.length; i++) {
      const ev = this.state.worldEvents[i];
      ev.isActive = false;
      ev.isCompleted = false;
      ev.chargeProgress = 0;
      ev.activeEliteId = null;
      ev.eliteWaveIndex = 0;
      ev.dashPlatforms = undefined;
      ev.highestPlatformReached = 0;
      ev.payloadPos = undefined;
      ev.payloadCollected = false;
    }
    p.retaliationTimer = 0;
    p.survivalInstinctTimer = 0;
    p.stunImmunityTimer = 0;
    p.postDashSpeedTimer = 0;
    p.lifeSiphonSecondTimer = 0;
    p.lifeSiphonSecondAmount = 0;
    p.wasAirborneLastFrame = false;
    p.hasCollectedDoubleJumpPickup = false;
    p.nonProjectileBuffCount = 0;
    p.usedCombatFocusActivations?.clear();
    p.activeTimedEffects = {};
    p.timedEffectCooldowns = {};
    p.aerialFocusLatched = false;
    p.buffsBySource = { level: 0, pod: 0, elite: 0, event: 0 };
    this.isExecutingPrimaryLmb = false;
    this.lastSafeGroundedPos = null;
    this.stuckPrevPos = null;
    this.stuckCheckTimer = 0;
    this.unstuckCooldown = 0;
    this.airborneDuration = 0;
    this.nextAttackActivationId = 1;
    this.cooldownHarvestThisSecond = 0;
    this.cooldownHarvestWindowTimer = 0;
    p.level = 1;
    p.xp = 0;
    p.xpNeeded = 8;
    p.killCount = 0;
    p.currency = 15;

    // Reset player items & buffs for a clean new run
    p.items = {
      overdrive: 0,
      vital_core: 0,
      chain_spark: 0
    };
    p.buffs = ALL_BUFF_IDS.reduce((acc, id) => {
      acc[id] = 0;
      return acc;
    }, {} as Record<BuffId, number>);
    this.state.updateCalculatedStats();
    p.health = p.maxHealth;

    // Reset artifact, pods (via SceneDirector), and world events cleanly
    this.state.resetArtifactProgression();
    this.stage1BossCycle = 0;
    p.floatingSwords = [];
    this.applyGeneratedPodLayout();
    for (let i = 0; i < this.state.worldEvents.length; i++) {
      const ev = this.state.worldEvents[i];
      ev.chargeProgress = 0;
      ev.isActive = false;
      ev.isCompleted = false;
      ev.pulseTimer = 0;
      if (ev.durationTimer !== undefined) ev.durationTimer = 35;
      if (ev.killCount !== undefined) ev.killCount = 0;
      ev.hasSpawnedBoss50 = false;
    }
    this.pendingDraftFilters = [];

    // Guaranteed free Double Jump pickup placed at the first step of the Teleporter Tower
    if (this.state.terrain.isCustomTestMap && this.state.terrain.testDoubleJumpPos) {
      const rawDj = this.state.terrain.testDoubleJumpPos;
      const djPos = rawDj.z !== undefined ? { x: rawDj.x, y: rawDj.y } : this.resolvePickupClearSpot(rawDj);
      const djElev =
        rawDj.z !== undefined
          ? rawDj.z
          : this.state.terrain.getElevation(djPos.x, djPos.y, 1e6, 22).height;
      this.state.itemDrops.push({
        id: 'double_jump_test_pickup',
        isDoubleJumpTestPickup: true,
        pos: { x: djPos.x, y: djPos.y },
        vel: { x: 0, y: 0 },
        z: djElev,
        vz: 0,
        settled: true,
        lifetime: 999999
      });
    } else if (this.state.artifact) {
      const artPos = this.state.artifact.pos;
      const djPos = this.resolvePickupClearSpot({ x: artPos.x, y: artPos.y + 95 });
      const djElev = this.state.terrain.getElevation(djPos.x, djPos.y, 1e6, 22).height;
      this.state.itemDrops.push({
        id: 'double_jump_test_pickup',
        isDoubleJumpTestPickup: true,
        pos: { x: djPos.x, y: djPos.y },
        vel: { x: 0, y: 0 },
        z: djElev,
        vz: 0,
        settled: true,
        lifetime: 999999
      });
    }
  }

  /** Ensures a stage pickup cannot overlap any obstacle collider while staying on valid ground. */
  public resolvePickupClearSpot(origin: Vector2): Vector2 {
    const pos = { x: origin.x, y: origin.y };
    for (const obs of this.state.obstacles) {
      const minDist = (obs.radius || 22) + 32;
      const dx = pos.x - obs.pos.x;
      const dy = pos.y - obs.pos.y;
      const d = Math.hypot(dx, dy);
      if (d < minDist) {
        const nx = d > 0.01 ? dx / d : 0;
        const ny = d > 0.01 ? dy / d : 1;
        pos.x = obs.pos.x + nx * minDist;
        pos.y = obs.pos.y + ny * minDist;
      }
    }
    return pos;
  }

  /**
   * Called by the UI when the player selects 1 of the 3 Buff cards while paused
   */
  public selectBuffChoice(buffId: BuffId): void {
    if (!this.state.isPausedForBuffChoice) return;
    if (!this.state.currentBuffChoices.includes(buffId)) return;

    const chosenDef = BUFF_REGISTRY[buffId];
    this.applyBuffToPlayer(buffId, chosenDef?.exclusiveEvent ? 'augment' : 'chest');

    while (this.state.pendingBuffDrafts > 0) {
      this.state.pendingBuffDrafts--;
      const nextFilter = this.pendingDraftFilters.shift();
      const nextChoices = rollThreeBuffChoices(this.state.lootRng, nextFilter, this.state.player.heroId, this.state.player);
      if (nextChoices.length > 0) {
        this.state.currentBuffChoices = nextChoices;
        return;
      }
    }
    this.state.isPausedForBuffChoice = false;
    this.state.currentBuffChoices = [];
  }

  /** Applies a buff, passive stack, replacement skill, or slot augment directly to the active player. */
  public applyBuffToPlayer(
    buffId: BuffId,
    source: 'augment' | 'chest' | 'enemy_drop' | 'pickup' = 'augment',
    dropOrigin: 'level' | 'elite' = 'level'
  ): void {
    const p = this.state.player;
    const def = BUFF_REGISTRY[buffId];
    if (!def) return;
    p.buffs[buffId] = (p.buffs[buffId] || 0) + 1;
    if (!p.buffsBySource) {
      p.buffsBySource = { level: 0, pod: 0, elite: 0, event: 0 };
    }
    if (source === 'chest') p.buffsBySource.pod++;
    else if (source === 'augment') p.buffsBySource.event++;
    else if (source === 'enemy_drop') {
      if (dropOrigin === 'elite') p.buffsBySource.elite++;
      else p.buffsBySource.level++;
    }
    if (buffId === 'buff_aerial_boost') {
      p.hasCollectedDoubleJumpPickup = true;
      p.airJumpsRemaining = (p.airJumpsRemaining || 0) + 1;
    }
    if (source === 'enemy_drop' || source === 'chest') {
      if (buffId === 'buff_extra_lmb_projectile' || buffId === 'buff_extra_rmb_projectile') {
        p.nonProjectileBuffCount = 0;
      } else if (!def.exclusiveEvent) {
        p.nonProjectileBuffCount = (p.nonProjectileBuffCount || 0) + 1;
      }
    }

    if (def.linkedItemId) {
      const itemId = def.linkedItemId;
      p.items[itemId] = (p.items[itemId] || 0) + 1;
      this.state.events.push({
        type: 'item_acquired',
        data: {
          item: itemId,
          name: ITEM_REGISTRY[itemId].name,
          stackCount: p.items[itemId],
          source: 'buff'
        }
      });
    }

    if (def.replacesSkillSlot && def.replacementSkillId) {
      const newSkill = SKILL_REGISTRY[def.replacementSkillId];
      if (newSkill) {
        p.equippedSkills[def.replacesSkillSlot] = newSkill;
        this.state.events.push({
          type: 'buff_selected',
          data: {
            buffId,
            name: `${def.name} [${newSkill.name}]`,
            stackCount: 1
          }
        });
      }
    }

    if (def.enhancesSkillSlot && def.enhancementId) {
      if (!p.skillEnhancements) {
        p.skillEnhancements = {};
      }
      p.skillEnhancements[def.enhancesSkillSlot] = def.enhancementId;

      for (const [existingBuffId] of Object.entries(p.buffs)) {
        if (existingBuffId !== buffId) {
          const existingDef = BUFF_REGISTRY[existingBuffId as BuffId];
          if (existingDef && existingDef.enhancesSkillSlot === def.enhancesSkillSlot) {
            delete p.buffs[existingBuffId as BuffId];
          }
        }
      }

      if (def.enhancesSkillSlot === 'secondary' && def.enhancementId !== 'orbiting_blade') {
        p.orbitingBladeActive = false;
        p.orbitingBladeTimer = 0;
      }
      if (def.enhancesSkillSlot === 'primary' && def.enhancementId !== 'extended_slash') {
        p.slashComboStep = 0;
        p.slashComboTimer = 0;
      }

      const baseSkill = p.equippedSkills[def.enhancesSkillSlot];
      if (baseSkill) {
        p.equippedSkills[def.enhancesSkillSlot] = {
          ...baseSkill,
          name: def.name,
          description: def.description,
          icon: def.icon || baseSkill.icon
        };
      }
      this.syncSkillSlotAfterEnhancementChange(def.enhancesSkillSlot);
    }

    this.state.updateCalculatedStats();

    this.state.events.push({
      type: 'buff_selected',
      data: {
        buffId,
        name: def.name,
        stackCount: p.buffs[buffId],
        source
      }
    });
  }

  public devGrantItem(itemId: ItemId, count: number = 1): void {
    const p = this.state.player;
    const def = ITEM_REGISTRY[itemId];
    if (!def) return;
    p.items[itemId] = (p.items[itemId] || 0) + count;
    this.state.updateCalculatedStats();
    if (itemId === 'vital_core') {
      p.health = Math.min(p.calculatedStats.maxHealth, p.health + 35 * count);
    }
    this.state.events.push({
      type: 'item_acquired',
      data: { item: itemId, name: def.name, stackCount: p.items[itemId], source: 'dev' }
    });
  }

  public devResetCooldowns(): void {
    const p = this.state.player;
    p.primaryCooldownRemaining = 0;
    p.secondaryCooldownRemaining = 0;
    p.utilityCooldownRemaining = 0;
    p.ultimateCooldownRemaining = 0;
  }

  public devHealPlayer(): void {
    const p = this.state.player;
    p.health = p.calculatedStats.maxHealth;
    p.energyShield = p.maxEnergyShield;
  }

  public devResetPlayerState(): void {
    const p = this.state.player;
    p.items = { overdrive: 0, vital_core: 0, chain_spark: 0 };
    p.buffs = ALL_BUFF_IDS.reduce((acc, id) => {
      acc[id] = 0;
      return acc;
    }, {} as Record<BuffId, number>);
    p.skillEnhancements = {};
    const baseSkills = p.heroId === 'doctor' ? DOCTOR_SKILLS : COMMANDER_SKILLS;
    p.equippedSkills = { ...baseSkills };
    p.level = 1;
    p.xp = 0;
    p.xpNeeded = 100;
    p.currency = 0;
    this.devResetCooldowns();
    this.state.updateCalculatedStats();
    this.devHealPlayer();
  }

  public devSpawnEnemy(type: EnemyType, count: number = 1, nearPlayer: boolean = true): EnemyState[] {
    if (type === 'boss') {
      this.spawnStage1Titan(this.state.artifact.pos);
      const boss = this.state.enemies.find((e) => e.isStage1Titan);
      return boss ? [boss] : [];
    }
    const p = this.state.player;
    const { tierDef } = getDifficultyTier(this.state.gameTime);
    const cfg = ENEMY_CONFIGS[type];
    if (!cfg) return [];
    const spawned: EnemyState[] = [];
    for (let i = 0; i < count; i++) {
      const ang = (i / Math.max(1, count)) * Math.PI * 2 + this.state.rng.range(-0.25, 0.25);
      const dist = nearPlayer ? this.state.rng.range(240, 380) : this.state.rng.range(480, 680);
      const sx = Math.max(60, Math.min(this.state.worldWidth - 60, p.pos.x + Math.cos(ang) * dist));
      const sy = Math.max(60, Math.min(this.state.worldHeight - 60, p.pos.y + Math.sin(ang) * dist));
      const elev = this.state.terrain.getElevation(sx, sy).height;
      const enemy: EnemyState = {
        id: `enemy_${this.nextEnemyId++}`,
        type,
        pos: { x: sx, y: sy },
        velocity: { x: 0, y: 0 },
        z: elev,
        groundZ: elev,
        health: Math.round(cfg.maxHealth * tierDef.hpMultiplier),
        maxHealth: Math.round(cfg.maxHealth * tierDef.hpMultiplier),
        speed: cfg.speed * tierDef.speedMultiplier,
        touchDamage: Math.round(cfg.touchDamage * tierDef.damageMultiplier),
        attackCooldown: cfg.attackCooldown,
        attackCooldownRemaining: 0.6,
        attackRange: cfg.attackRange,
        isElite: cfg.isElite || type === 'elite',
        isBoss: false,
        currencyReward: cfg.currencyReward,
        xpReward: cfg.xpReward,
        radius: cfg.radius,
        isSpawning: false,
        spawnProgress: 1,
        spawnDuration: 0,
        isAlerted: true
      };
      this.state.enemies.push(enemy);
      spawned.push(enemy);
    }
    return spawned;
  }

  public devClearEnemies(): void {
    this.state.enemies = [];
    if (this.state.artifact) {
      this.state.artifact.isBossSpawned = false;
    }
  }

  public devTriggerBossAttack(attack: 'laser' | 'tentacle' | 'elemental'): boolean {
    const boss = this.state.enemies.find((e) => e.isStage1Titan && e.titanState !== 'dying');
    if (!boss) return false;
    const p = this.state.player;
    const dx = p.pos.x - boss.pos.x;
    const dy = p.pos.y - boss.pos.y;
    boss.velocity.x = 0;
    boss.velocity.y = 0;

    if (attack === 'laser') {
      boss.titanState = 'laser_sweep';
      boss.titanTimer = STAGE1_BOSS_CONFIG.laser.duration;
      boss.titanLaserSweepDir = 1;
      boss.titanLaserAngle = Math.atan2(dy, dx) - 0.75;
      this.state.events.push({
        type: 'stage1_boss_laser_sweep',
        data: { id: boss.id, start: true, duration: STAGE1_BOSS_CONFIG.laser.duration, thickness: STAGE1_BOSS_CONFIG.laser.thickness }
      });
    } else if (attack === 'tentacle') {
      boss.titanState = 'tentacle_strike';
      boss.titanTentaclePhase = 'telegraph';
      boss.titanTentacleTarget = { x: p.pos.x, y: p.pos.y };
      boss.titanTimer = STAGE1_BOSS_CONFIG.tentacle.telegraphDuration;
      boss.titanTentacleHitApplied = false;
      this.state.events.push({
        type: 'stage1_boss_tentacle_strike',
        data: { id: boss.id, phase: 'telegraph', target: { ...boss.titanTentacleTarget } }
      });
    } else {
      boss.titanState = 'elemental_barrage';
      boss.titanTimer = STAGE1_BOSS_CONFIG.elemental.chargeDuration;
      boss.titanElementalCharged = false;
      this.state.events.push({
        type: 'stage1_boss_elemental_charge',
        data: { id: boss.id, duration: STAGE1_BOSS_CONFIG.elemental.chargeDuration }
      });
    }
    return true;
  }

  public devResetBossEncounter(): void {
    this.state.enemies = this.state.enemies.filter((e) => !e.isBoss && !e.isStage1Titan);
    if (this.state.artifact) {
      this.state.artifact.isBossSpawned = false;
      this.state.artifact.isBossDefeated = false;
    }
    this.spawnStage1Titan(this.state.artifact.pos);
  }

  private syncSkillSlotAfterEnhancementChange(slot: SkillSlot): void {
    const p = this.state.player;
    const enh = p.skillEnhancements?.[slot];
    const baseSkills = p.heroId === 'doctor' ? DOCTOR_SKILLS : COMMANDER_SKILLS;
    const baseCooldown = baseSkills[slot].cooldown;

    if (slot === 'primary') {
      if (enh !== 'vital_extraction') {
        this.state.vitalTethers = [];
      }
      if (p.heroId === 'doctor' && p.equippedSkills.primary) {
        p.equippedSkills.primary.cooldown =
          enh === 'toxic_chain'
            ? DOCTOR_CONFIG.toxicChain.cooldown
            : enh === 'cryogenic_scalpel'
              ? DOCTOR_CONFIG.cryoScalpel.cooldown
              : enh === 'vital_extraction'
                ? DOCTOR_CONFIG.vitalExtraction.tickInterval
                : baseCooldown;
      }
    } else if (slot === 'secondary') {
      if (enh !== 'experimental_drones') {
        this.state.doctorDrones = [];
      } else {
        this.reconcileDoctorDrones();
      }
      if (enh !== 'holographic_decoy') {
        this.state.holographicDecoys = [];
      }
      if (p.heroId === 'doctor' && p.equippedSkills.secondary) {
        p.equippedSkills.secondary.cooldown =
          enh === 'experimental_drones'
            ? DOCTOR_CONFIG.experimentalDrones.cooldownVolley
            : enh === 'toxic_cluster_bomb'
              ? DOCTOR_CONFIG.toxicClusterBomb.cooldown
              : enh === 'holographic_decoy'
                ? DOCTOR_CONFIG.holographicDecoy.cooldown
                : baseCooldown;
      }
    } else if (slot === 'ultimate') {
      if (enh !== 'rain_of_crosses') {
        p.toxicRainTimer = 0;
        p.toxicRainTickTimer = 0;
      }
    }
  }

  /**
   * Sets or clears a character skill enhancement on the given slot.
   * If enhancementId is null, reverts slot back to default base skill.
   */
  public setSkillEnhancement(slot: SkillSlot, enhancementId: SkillEnhancementId | null): void {
    const p = this.state.player;
    if (!p.skillEnhancements) p.skillEnhancements = {};

    // 1. Remove previous enhancement buff for this slot
    for (const [buffIdKey] of Object.entries(p.buffs)) {
      const bDef = BUFF_REGISTRY[buffIdKey as BuffId];
      if (bDef && bDef.enhancesSkillSlot === slot) {
        delete p.buffs[buffIdKey as BuffId];
      }
    }

    // 2. Clean up slot-specific state
    if (slot === 'secondary') {
      p.orbitingBladeActive = false;
      p.orbitingBladeTimer = 0;
    }
    if (slot === 'primary') {
      p.slashComboStep = 0;
      p.slashComboTimer = 0;
    }

    if (!enhancementId) {
      delete p.skillEnhancements[slot];
      const defaultSkills = p.heroId === 'doctor' ? DOCTOR_SKILLS : COMMANDER_SKILLS;
      p.equippedSkills[slot] = { ...defaultSkills[slot] };
    } else {
      p.skillEnhancements[slot] = enhancementId;
      const buffEntry = (Object.entries(BUFF_REGISTRY) as [BuffId, any][]).find(
        ([_, def]) =>
          def.enhancementId === enhancementId &&
          def.enhancesSkillSlot === slot &&
          (!def.heroFilter || def.heroFilter === p.heroId)
      );
      if (buffEntry) {
        const [buffId, def] = buffEntry;
        p.buffs[buffId] = 1;
        const baseSkill = p.equippedSkills[slot];
        if (baseSkill) {
          p.equippedSkills[slot] = {
            ...baseSkill,
            name: def.name,
            description: def.description,
            icon: def.icon || baseSkill.icon
          };
        }
      }
    }
    this.syncSkillSlotAfterEnhancementChange(slot);
    this.state.updateCalculatedStats();
  }

  /**
   * Cycles to the next approved skill enhancement for the specified slot, or returns to base.
   */
  public cycleSkillEnhancement(slot: SkillSlot): { slot: SkillSlot; enhancementId: SkillEnhancementId | null; name: string } {
    const p = this.state.player;
    const slotEnhancements: Record<SkillSlot, SkillEnhancementId[]> =
      p.heroId === 'doctor'
        ? {
          primary: ['toxic_chain', 'cryogenic_scalpel', 'vital_extraction'],
          secondary: ['experimental_drones', 'toxic_cluster_bomb', 'holographic_decoy'],
          utility: ['extended_dash', 'phase_barrier', 'adrenaline_rush'],
          ultimate: ['mobile_sanctuary', 'divine_intervention', 'rain_of_crosses']
        }
        : {
          primary: ['chill_beam', 'piercing_laser', 'extended_slash'],
          secondary: ['scissor_slash', 'frost_burst', 'orbiting_blade'],
          utility: ['extended_dash', 'shock_dash', 'teleport'],
          ultimate: ['singularity', 'convergence_barrage', 'cryogenic_impact']
        };

    const current = p.skillEnhancements?.[slot] || null;
    const list = slotEnhancements[slot];
    let nextEnh: SkillEnhancementId | null = null;
    if (!current) {
      nextEnh = list[0];
    } else {
      const idx = list.indexOf(current);
      if (idx >= 0 && idx < list.length - 1) {
        nextEnh = list[idx + 1];
      } else {
        nextEnh = null; // wraps back to base skill
      }
    }

    this.setSkillEnhancement(slot, nextEnh);
    const skillName = p.equippedSkills[slot]?.name || (nextEnh ? String(nextEnh) : 'Base Skill');
    return { slot, enhancementId: nextEnh, name: skillName };
  }

  public queueBuffDraft(filterEvent?: ExclusiveEventPool): void {
    const previewChoices = rollThreeBuffChoices(this.state.lootRng, filterEvent, this.state.player.heroId, this.state.player);
    if (previewChoices.length === 0) return;

    if (!this.state.isPausedForBuffChoice) {
      this.state.isPausedForBuffChoice = true;
      this.state.currentBuffChoices = previewChoices;
      this.state.events.push({
        type: 'buff_choices_ready',
        data: { choices: this.state.currentBuffChoices, level: this.state.player.level }
      });
    } else {
      this.state.pendingBuffDrafts++;
      this.pendingDraftFilters.push(filterEvent);
    }
  }

  private updatePlayerTimers(dt: number): void {
    const p = this.state.player;

    if (p.primaryCooldownRemaining > 0) p.primaryCooldownRemaining -= dt;
    if (p.secondaryCooldownRemaining > 0) p.secondaryCooldownRemaining -= dt;
    if (p.utilityCooldownRemaining > 0) p.utilityCooldownRemaining -= dt;
    if (p.ultimateCooldownRemaining > 0) p.ultimateCooldownRemaining -= dt;
    if (p.castFacingLockTimer > 0) p.castFacingLockTimer -= dt;

    if (p.defenseBonusTimer > 0) p.defenseBonusTimer -= dt;
    if ((p.hurtInvulnTimer ?? 0) > 0) {
      p.hurtInvulnTimer = Math.max(0, (p.hurtInvulnTimer ?? 0) - dt);
    }
    if ((p.enemyProjectileGraceTimer ?? 0) > 0) {
      p.enemyProjectileGraceTimer = Math.max(0, (p.enemyProjectileGraceTimer ?? 0) - dt);
    }
    if (p.hitByEnemyAttackInstanceIds && p.hitByEnemyAttackInstanceIds.size > 0) {
      for (const [instId, ttl] of p.hitByEnemyAttackInstanceIds) {
        const nextTtl = ttl - dt;
        if (nextTtl <= 0) {
          p.hitByEnemyAttackInstanceIds.delete(instId);
        } else {
          p.hitByEnemyAttackInstanceIds.set(instId, nextTtl);
        }
      }
    }
    let statsDirty = false;
    const dec = (val: number | undefined): number => Math.max(0, (val ?? 0) - dt);

    if ((p.phaseBarrierTimer ?? 0) > 0) p.phaseBarrierTimer = dec(p.phaseBarrierTimer);
    if ((p.adrenalineRushTimer ?? 0) > 0) {
      p.adrenalineRushTimer = dec(p.adrenalineRushTimer);
      if (p.adrenalineRushTimer <= 0) statsDirty = true;
    }
    if ((p.tempShieldTimer ?? 0) > 0) {
      p.tempShieldTimer = dec(p.tempShieldTimer);
      if (p.tempShieldTimer <= 0) p.tempShieldAmount = 0;
    }
    if (p.emergencyBarrierCooldown > 0) p.emergencyBarrierCooldown = dec(p.emergencyBarrierCooldown);
    if (p.chainReactionCooldown > 0) p.chainReactionCooldown = dec(p.chainReactionCooldown);
    if (p.secondWindCooldown > 0) p.secondWindCooldown = dec(p.secondWindCooldown);
    if (p.staticDischargeCooldown > 0) p.staticDischargeCooldown = dec(p.staticDischargeCooldown);
    if (p.aftershockCooldown > 0) p.aftershockCooldown = dec(p.aftershockCooldown);
    if (p.reactiveShieldCooldown > 0) p.reactiveShieldCooldown = dec(p.reactiveShieldCooldown);
    if (p.survivalInstinctCooldown > 0) p.survivalInstinctCooldown = dec(p.survivalInstinctCooldown);
    if (p.bloodRushKillWindowTimer > 0) {
      p.bloodRushKillWindowTimer = dec(p.bloodRushKillWindowTimer);
      if (p.bloodRushKillWindowTimer <= 0) p.bloodRushRecentKills = 0;
    }
    if (p.bloodRushTimer > 0) {
      p.bloodRushTimer = dec(p.bloodRushTimer);
      if (p.bloodRushTimer <= 0) statsDirty = true;
    }
    if (p.killingMomentumTimer > 0) {
      p.killingMomentumTimer = dec(p.killingMomentumTimer);
      if (p.killingMomentumTimer <= 0) {
        p.killingMomentumStacks = 0;
        statsDirty = true;
      }
    }
    if (p.retaliationTimer > 0) {
      p.retaliationTimer = dec(p.retaliationTimer);
      if (p.retaliationTimer <= 0) statsDirty = true;
    }
    if (p.survivalInstinctTimer > 0) {
      p.survivalInstinctTimer = dec(p.survivalInstinctTimer);
      if (p.survivalInstinctTimer <= 0) statsDirty = true;
    }
    if (p.stunImmunityTimer > 0) p.stunImmunityTimer = dec(p.stunImmunityTimer);
    if (p.postDashSpeedTimer > 0) {
      p.postDashSpeedTimer = dec(p.postDashSpeedTimer);
      if (p.postDashSpeedTimer <= 0) statsDirty = true;
    }

    if (p.lifeSiphonSecondTimer > 0) {
      p.lifeSiphonSecondTimer = dec(p.lifeSiphonSecondTimer);
      if (p.lifeSiphonSecondTimer <= 0) p.lifeSiphonSecondAmount = 0;
    }
    if (this.cooldownHarvestWindowTimer > 0) {
      this.cooldownHarvestWindowTimer = dec(this.cooldownHarvestWindowTimer);
      if (this.cooldownHarvestWindowTimer <= 0) this.cooldownHarvestThisSecond = 0;
    }

    if (p.timedEffectCooldowns) {
      for (const key of Object.keys(p.timedEffectCooldowns) as TimedEffectId[]) {
        const rem = (p.timedEffectCooldowns[key] ?? 0) - dt;
        if (rem <= 0) {
          delete p.timedEffectCooldowns[key];
        } else {
          p.timedEffectCooldowns[key] = rem;
        }
      }
    }

    if (p.activeTimedEffects) {
      for (const key of Object.keys(p.activeTimedEffects) as TimedEffectId[]) {
        const eff = p.activeTimedEffects[key];
        if (!eff) continue;
        eff.remaining -= dt;
        if (eff.remaining <= 0) {
          delete p.activeTimedEffects[key];
          statsDirty = true;
        }
      }
    }

    if (statsDirty) {
      this.state.updateCalculatedStats();
    }

    // Rain of Crosses active storm spawner
    if ((p.toxicRainTimer ?? 0) > 0) {
      p.toxicRainTimer = Math.max(0, (p.toxicRainTimer ?? 0) - dt);
      if (p.toxicRainTimer > 0) {
        p.toxicRainTickTimer = (p.toxicRainTickTimer ?? 0) - dt;
        if (p.toxicRainTickTimer <= 0) {
          p.toxicRainTickTimer += DOCTOR_CONFIG.rainOfCrosses.spawnInterval;
          this.spawnRainOfCrossesWave();
        }
      }
    }

    if (p.calculatedStats.healthRegen > 0 && p.health < p.maxHealth) {
      const wasBelow40 = p.health / Math.max(1, p.maxHealth) < 0.40;
      p.health = Math.min(p.maxHealth, p.health + p.calculatedStats.healthRegen * dt);
      const nowBelow40 = p.health / Math.max(1, p.maxHealth) < 0.40;
      if (wasBelow40 && !nowBelow40 && (p.buffs.buff_final_stand || 0) > 0) {
        this.state.updateCalculatedStats();
      }
    }

    // Active Orbiting Electric Swords (Secondary Upgrade 3: 360° Orbit, Max 7 Swords, Independent Kinetic Attack Strikes)
    if (p.orbitingBladeActive) {
      const orbExtStacks = p.heroId === 'commander' ? (p.buffs.buff_cmd_orbital_extension || 0) : 0;
      const orbSpeedMult = 1 + 0.03 * orbExtStacks;
      p.orbitingBladeTimer = (p.orbitingBladeTimer ?? 0) - dt;
      p.orbitingBladeAngle = (p.orbitingBladeAngle ?? 0) + 4.6 * orbSpeedMult * dt;

      if (p.orbitingBladeTimer <= 0) {
        p.orbitingBladeActive = false;
        p.floatingSwords = [];
        p.orbitingBladeHitCooldowns = {};
        this.state.events.push({ type: 'orbiting_blade_expired', data: {} });
      } else {
        const extra = p.calculatedStats.extraRmbProjectiles || 0;
        const swordCount = Math.min(7, Math.max(1, 1 + extra));
        const razorStacks = p.heroId === 'commander' ? (p.buffs.buff_cmd_razor_satellites || 0) : 0;
        p.orbitingSwordCount = swordCount;
        const rad = p.orbitingBladeRadius ?? 164;
        const dmg = (p.orbitingBladeDamage ?? (34 * p.calculatedStats.damageMultiplier)) * (1 + 0.03 * razorStacks);

        if (!p.floatingSwords) p.floatingSwords = [];
        while (p.floatingSwords.length < swordCount) {
          const s = p.floatingSwords.length;
          const sAngle = (p.orbitingBladeAngle ?? 0) + (Math.PI * 2 / swordCount) * s;
          p.floatingSwords.push({
            x: p.pos.x + Math.cos(sAngle) * rad,
            y: p.pos.y + Math.sin(sAngle) * rad,
            z: p.z + 44,
            state: 'hover',
            stateTimer: 0,
            attackCooldown: 0.12 * s,
            targetEnemyId: null,
            hitApplied: false
          });
        }
        if (p.floatingSwords.length > swordCount) {
          p.floatingSwords.length = swordCount;
        }

        // Collect enemies currently being lunged at by other swords to ensure multi-target coverage
        const alreadyTargeted = new Set<string>();
        for (let s = 0; s < p.floatingSwords.length; s++) {
          const sw = p.floatingSwords[s];
          if (sw.state === 'lunge' && sw.targetEnemyId) {
            alreadyTargeted.add(sw.targetEnemyId);
          }
        }

        for (let s = 0; s < swordCount; s++) {
          const sw = p.floatingSwords[s];
          const sAngle = (p.orbitingBladeAngle ?? 0) + (Math.PI * 2 / swordCount) * s;
          const homeX = p.pos.x + Math.cos(sAngle) * rad;
          const homeY = p.pos.y + Math.sin(sAngle) * rad;
          const homeZ = p.z + 44 + Math.sin(p.orbitingBladeAngle * 0.8 + s * 1.2) * 5.0;

          if (sw.state === 'hover') {
            // Smoothly track current orbital home position
            sw.x = homeX;
            sw.y = homeY;
            sw.z = homeZ;

            sw.attackCooldown = (sw.attackCooldown ?? 0) - dt;
            if (sw.attackCooldown <= 0 && !p.isCarryingEventPayload) {
              // Search for living enemies relative to this specific sword's position (reach ~320 units)
              const nearby = this.spatialGrid.getNearby({ x: sw.x, y: sw.y }, 340);
              let bestEnemy: EnemyState | null = null;
              let bestDist = Infinity;
              let fallbackEnemy: EnemyState | null = null;
              let fallbackDist = Infinity;

              for (let eIdx = 0; eIdx < nearby.length; eIdx++) {
                const e = nearby[eIdx];
                if (e.health > 0) {
                  const ed = Math.hypot(e.pos.x - sw.x, e.pos.y - sw.y);
                  if (ed <= 320 && Math.abs(e.z - p.z) <= 180) {
                    // Prioritize an enemy not currently targeted by another lunging sword
                    if (!alreadyTargeted.has(e.id) && ed < bestDist) {
                      bestDist = ed;
                      bestEnemy = e;
                    }
                    if (ed < fallbackDist) {
                      fallbackDist = ed;
                      fallbackEnemy = e;
                    }
                  }
                }
              }

              const chosen = bestEnemy || fallbackEnemy;
              if (chosen) {
                sw.state = 'lunge';
                sw.stateTimer = 0;
                sw.targetEnemyId = chosen.id;
                sw.targetX = chosen.pos.x;
                sw.targetY = chosen.pos.y;
                sw.targetZ = chosen.z + (chosen.radius || 32) * 0.8;
                sw.hitApplied = false;
                alreadyTargeted.add(chosen.id);
              }
            }
          } else if (sw.state === 'lunge') {
            sw.stateTimer = (sw.stateTimer ?? 0) + dt;

            // Track target enemy's live position if still alive
            let targetEnemy: EnemyState | undefined;
            if (sw.targetEnemyId) {
              targetEnemy = this.state.enemies.find(e => e.id === sw.targetEnemyId && e.health > 0);
              if (targetEnemy) {
                sw.targetX = targetEnemy.pos.x;
                sw.targetY = targetEnemy.pos.y;
                sw.targetZ = targetEnemy.z + (targetEnemy.radius || 32) * 0.8;
              }
            }

            const tx = sw.targetX ?? homeX;
            const ty = sw.targetY ?? homeY;
            const tz = sw.targetZ ?? homeZ;
            const ldx = tx - sw.x;
            const ldy = ty - sw.y;
            const ldz = tz - sw.z;
            const ldist = Math.hypot(ldx, ldy, ldz) || 1;
            const lungeSpeed = 1200;
            const step = Math.min(ldist, lungeSpeed * dt);

            sw.x += (ldx / ldist) * step;
            sw.y += (ldy / ldist) * step;
            sw.z += (ldz / ldist) * step;

            // When impaling target or timeout reached:
            if (ldist <= 38 || sw.stateTimer >= 0.24) {
              if (!sw.hitApplied) {
                sw.hitApplied = true;
                if (targetEnemy && targetEnemy.health > 0) {
                  this.damageEnemy(targetEnemy, dmg, { x: sw.x, y: sw.y }, 'lightning');
                  targetEnemy.isElectrified = true;
                  targetEnemy.electrifiedTimer = 3.0;
                  targetEnemy.electrifiedMultiplier = 1.35;
                  this.state.events.push({
                    type: 'orbiting_blade_hit',
                    data: { x: sw.x, y: sw.y, z: sw.z, swordIndex: s, enemyId: targetEnemy.id }
                  });
                }
              }
              sw.state = 'return';
              sw.stateTimer = 0;
            }
          } else if (sw.state === 'return') {
            sw.stateTimer = (sw.stateTimer ?? 0) + dt;
            const rdx = homeX - sw.x;
            const rdy = homeY - sw.y;
            const rdz = homeZ - sw.z;
            const rdist = Math.hypot(rdx, rdy, rdz) || 1;
            const returnSpeed = 950;
            const rstep = Math.min(rdist, returnSpeed * dt);

            sw.x += (rdx / rdist) * rstep;
            sw.y += (rdy / rdist) * rstep;
            sw.z += (rdz / rdist) * rstep;

            if (rdist <= 34 || sw.stateTimer >= 0.28) {
              sw.state = 'hover';
              sw.x = homeX;
              sw.y = homeY;
              sw.z = homeZ;
              sw.targetEnemyId = null;
              sw.attackCooldown = 0.24; // Brief rest in orbit before next kinetic lunge
            }
          }
        }
      }
    }
  }

  private updatePlayerMovement(dt: number, input: InputSnapshot): void {
    const p = this.state.player;
    p.cameraYaw = input.cameraYaw || 0;
    this.lastCameraForward = input.cameraForward;
    this.lastCameraRight = input.cameraRight;

    const cosY = Math.cos(p.cameraYaw);
    const sinY = Math.sin(p.cameraYaw);

    // Screen-relative movement:
    // rx is Screen Right (+X = D, -X = A)
    // rz is Screen Forward toward horizon (+Z = W, -Z = S)
    const rx = input && input.moveDir ? input.moveDir.x : 0;
    const rz = input && input.moveDir ? -input.moveDir.y : 0;

    let worldMx = 0;
    let worldMy = 0;

    if (input.cameraForward && input.cameraRight) {
      worldMx = input.cameraRight.x * rx + input.cameraForward.x * rz;
      worldMy = input.cameraRight.y * rx + input.cameraForward.y * rz;
    } else {
      worldMx = rx * cosY + rz * sinY;
      worldMy = -rx * sinY + rz * cosY;
    }

    // 1. Dash / Blink Activation (Shift) - can be used on ground or in mid-air
    if (input.wantDash && p.utilityCooldownRemaining <= 0 && !p.isDashing) {
      const utilDef = p.equippedSkills.utility;
      p.utilityCooldownRemaining =
        utilDef.cooldown *
        p.calculatedStats.dashCooldownMultiplier *
        p.calculatedStats.skillCooldownMultiplier;
      p.dashShockwaveTriggered = false;
      p.dashHitIds = new Set<string>();
      this.triggerTimedEffect('dash_overclock', 3.0, 8.0, 'buff_dash_overclock');

      if (utilDef.id === 'recovery_field') {
        const radiusMult = p.calculatedStats.aoeRadiusMultiplier || 1.0;
        const durMult = p.calculatedStats.skillDurationMultiplier || 1.0;
        const healMult = p.calculatedStats.healingMultiplier || 1.0;
        // Deploy localized bio-regenerative nanite field on terrain
        const field: RecoveryFieldState = {
          id: `recov_${Date.now()}_${Math.random().toString(36).substring(2, 6)}`,
          pos: { x: p.pos.x, y: p.pos.y },
          z: p.z,
          radius: 270 * radiusMult,
          durationRemaining: 5.0 * durMult,
          healPerSecond: 14.0 * healMult,
          tickTimer: 0.25
        };
        this.state.recoveryFields.push(field);

        // Tactical repositioning evasive burst
        p.isDashing = true;
        p.dashDurationTimer = 0.22;

        if (worldMx !== 0 || worldMy !== 0) {
          const len = Math.hypot(worldMx, worldMy) || 1;
          p.dashDir = { x: worldMx / len, y: worldMy / len };
        } else {
          if (input.cameraForward) {
            p.dashDir = { x: input.cameraForward.x, y: input.cameraForward.y };
          } else {
            p.dashDir = { x: sinY, y: cosY };
          }
        }
        this.state.events.push({
          type: 'recovery_field_deployed',
          data: { pos: { ...p.pos }, z: p.z, radius: field.radius, duration: field.durationRemaining }
        });
      } else if (utilDef.id === 'medical_rush') {
        // Doctor Base Dash: Therapeutic Pass (1.5x Commander dash distance; 3.0x with Extended Dash)
        const cfg = DOCTOR_CONFIG.therapeuticPass;
        p.isDashing = true;
        p.dashDurationTimer = cfg.duration;
        p.dashHitIds = new Set<string>();

        const clinicalReachStacks = p.skillEnhancements?.utility === 'extended_dash' ? (p.buffs.buff_doc_clinical_reach || 0) : 0;
        const protectiveTriageStacks = p.skillEnhancements?.utility === 'phase_barrier' ? (p.buffs.buff_doc_protective_triage || 0) : 0;
        const healMult = (p.calculatedStats.healingMultiplier || 1.0) * (1 + 0.04 * (clinicalReachStacks + protectiveTriageStacks));
        const selfHeal = Math.round(cfg.selfHeal * healMult);
        p.health = Math.min(p.maxHealth, p.health + selfHeal);
        this.state.events.push({
          type: 'therapeutic_heal',
          data: { pos: { ...p.pos }, z: p.z, amount: selfHeal }
        });

        if (p.skillEnhancements?.utility === 'phase_barrier') {
          const sterileStacks = p.buffs.buff_doc_sterile_interval || 0;
          const postDashInvuln = Math.min(1.3, DOCTOR_CONFIG.phaseBarrier.postDashImmunityDuration + 0.1 * sterileStacks);
          p.phaseBarrierTimer = cfg.duration + postDashInvuln;
          this.state.events.push({
            type: 'phase_barrier_activated',
            data: { pos: { ...p.pos }, z: p.z, duration: p.phaseBarrierTimer }
          });
        }

        if (worldMx !== 0 || worldMy !== 0) {
          const len = Math.hypot(worldMx, worldMy) || 1;
          p.dashDir = { x: worldMx / len, y: worldMy / len };
        } else {
          if (input.cameraForward) {
            p.dashDir = { x: input.cameraForward.x, y: input.cameraForward.y };
          } else {
            p.dashDir = { x: sinY, y: cosY };
          }
        }
        this.setFacingToward({ x: p.pos.x + p.dashDir.x * 120, y: p.pos.y + p.dashDir.y * 120 });

        this.state.events.push({
          type: 'dash_used',
          data: {
            pos: { ...p.pos },
            z: p.z,
            dir: { ...p.dashDir },
            facing: p.facing,
            duration: cfg.duration,
            variant: 'medical_rush',
            healAmount: selfHeal,
            extended: p.skillEnhancements?.utility === 'extended_dash'
          }
        });
      } else if (utilDef.id === 'blink_warp') {
        const fromPos = { ...p.pos };
        const fromZ = p.z;
        let bdx = worldMx;
        let bdy = worldMy;
        if (bdx === 0 && bdy === 0) {
          bdx = input.cameraForward ? input.cameraForward.x : sinY;
          bdy = input.cameraForward ? input.cameraForward.y : cosY;
        }
        const blen = Math.hypot(bdx, bdy) || 1;
        const targetX = p.pos.x + (bdx / blen) * 440;
        const targetY = p.pos.y + (bdy / blen) * 440;
        const trav = this.state.terrain.checkTraversable(p.pos, { x: targetX, y: targetY }, p.z, false, 30);
        p.pos.x = trav.newPos.x;
        p.pos.y = trav.newPos.y;
        const stepLimBlink = this.state.terrain.getStepUpLimitAt(p.pos.x, p.pos.y);
        p.z = this.state.terrain.getElevation(p.pos.x, p.pos.y, p.z, stepLimBlink).height;
        p.groundZ = p.z;

        // Arrival shockwave
        const shockRadius = 190 * (p.calculatedStats.aoeRadiusMultiplier || 1.0);
        const shockDamage = utilDef.baseDamage * p.calculatedStats.damageMultiplier;
        const victims = this.spatialGrid.getNearby(p.pos, shockRadius);
        for (const v of victims) {
          if (v.health > 0 && Math.abs(v.z - p.z) <= 180) {
            this.damageEnemy(v, shockDamage, v.pos);
            v.isStunned = true;
            v.stunTimer = 1.2;
          }
        }
        this.state.events.push({
          type: 'blink_used',
          data: { from: fromPos, fromZ, to: { ...p.pos }, toZ: p.z, radius: shockRadius }
        });
      } else if (p.skillEnhancements?.utility === 'teleport') {
        // Dash Upgrade 3: Teleport — Instantly relocates to target position with violet portals
        const fromPos = { ...p.pos };
        const fromZ = p.z;
        const aeStacks = p.heroId === 'commander' ? (p.buffs.buff_cmd_adrenal_extension || 0) : 0;
        const vsStacks = p.heroId === 'commander' ? (p.buffs.buff_cmd_velocity_surge || 0) : 0;
        let bdx = worldMx;
        let bdy = worldMy;
        if (bdx === 0 && bdy === 0) {
          bdx = input.cameraForward ? input.cameraForward.x : sinY;
          bdy = input.cameraForward ? input.cameraForward.y : cosY;
        }
        const blen = Math.hypot(bdx, bdy) || 1;
        const targetX = p.pos.x + (bdx / blen) * 440;
        const targetY = p.pos.y + (bdy / blen) * 440;
        const trav = this.state.terrain.checkTraversable(p.pos, { x: targetX, y: targetY }, p.z, false, 30);
        p.pos.x = trav.newPos.x;
        p.pos.y = trav.newPos.y;
        const stepLim = this.state.terrain.getStepUpLimitAt(p.pos.x, p.pos.y);
        p.z = this.state.terrain.getElevation(p.pos.x, p.pos.y, p.z, stepLim).height;
        p.groundZ = p.z;

        // Arrival stun & spatial disruption (+ Adrenal Extension & Velocity Surge support)
        const stunRadius = 190;
        const stunDur = 1.0 + 0.15 * aeStacks;
        const victims = this.spatialGrid.getNearby(p.pos, stunRadius);
        for (const v of victims) {
          if (v.health > 0 && Math.abs(v.z - p.z) <= 180) {
            this.damageEnemy(v, 48 * p.calculatedStats.damageMultiplier, v.pos);
            v.isStunned = true;
            v.stunTimer = Math.max(v.stunTimer || 0, stunDur);
          }
        }
        if (aeStacks > 0 || vsStacks > 0) {
          p.postDashSpeedTimer = Math.max(p.postDashSpeedTimer || 0, 1.5 + 0.25 * aeStacks);
          this.state.updateCalculatedStats();
        }
        this.state.events.push({
          type: 'teleport_executed',
          data: { from: fromPos, fromZ, to: { ...p.pos }, toZ: p.z, radius: stunRadius }
        });
      } else {
        const isExtended = p.skillEnhancements?.utility === 'extended_dash';
        p.isDashing = true;
        p.dashDurationTimer = isExtended ? 0.32 : 0.22;

        // Commander Shock Dash + Kinetic Shell buff: grant protective Kinetic Shell barrier on dash activation
        if (p.heroId === 'commander' && p.skillEnhancements?.utility === 'shock_dash') {
          const ksStacks = p.buffs.buff_cmd_kinetic_shell || 0;
          if (ksStacks > 0) {
            const shellDur = 0.65 + 0.15 * ksStacks;
            const shieldGain = Math.round(p.maxHealth * (0.04 * (1 + 0.03 * ksStacks)));
            p.phaseBarrierTimer = Math.max(p.phaseBarrierTimer ?? 0, shellDur);
            p.tempShieldAmount = Math.max(p.tempShieldAmount || 0, shieldGain);
            p.tempShieldTimer = Math.max(p.tempShieldTimer || 0, shellDur + 0.6);
          }
        }

        if (worldMx !== 0 || worldMy !== 0) {
          const len = Math.hypot(worldMx, worldMy) || 1;
          p.dashDir = { x: worldMx / len, y: worldMy / len };
        } else {
          // Dash forward in camera viewing direction (W)
          if (input.cameraForward) {
            p.dashDir = { x: input.cameraForward.x, y: input.cameraForward.y };
          } else {
            p.dashDir = { x: sinY, y: cosY };
          }
        }
        this.state.events.push({
          type: 'dash_used',
          data: { pos: { ...p.pos }, dir: p.dashDir, isExtended, isShock: p.skillEnhancements?.utility === 'shock_dash' }
        });
      }
    }

    // 2. Jump (Space) — Ground jump + Double/Triple Air Jump compatibility (scaled for 2x hero stature)
    if (input.wantJump) {
      if (p.isGrounded) {
        p.vz = 470;
        p.isGrounded = false;
        p.isJumping = true;
        p.isGliding = false;
        this.airborneDuration = 0;
        p.airJumpsRemaining = p.maxAirJumps ?? 0;
        this.state.events.push({ type: 'jump_started', data: { pos: { ...p.pos }, z: p.z } });
      } else if ((p.airJumpsRemaining ?? 0) > 0) {
        p.airJumpsRemaining--;
        p.vz = 470;
        p.isJumping = true;
        p.isGliding = false;
        this.state.events.push({ type: 'jump_started', data: { pos: { ...p.pos }, z: p.z, isAirJump: true } });
      }
    }

    if (!p.isGrounded) {
      this.airborneDuration += dt;
      if (this.airborneDuration >= 1.5 && !p.aerialFocusLatched && (p.buffs.buff_aerial_focus || 0) > 0) {
        p.aerialFocusLatched = true;
        this.triggerTimedEffect('aerial_focus', 4.0, 0, 'buff_aerial_focus');
      }
    } else {
      this.airborneDuration = 0;
    }

    // 3. Jetpack Glide (Hold Space while airborne) — Drain 40/sec
    const canGlide = !p.isGrounded && input.holdJump && p.vz < 70 && p.jetpackFuel > 0;
    if (canGlide) {
      if (!p.isGliding) {
        p.isGliding = true;
        this.state.events.push({ type: 'glide_started', data: {} });
      }
      p.vz = Math.max(-70, p.vz); // Slow, floaty descent
      p.jetpackFuel = Math.max(0, p.jetpackFuel - 40 * dt);
    } else {
      if (p.isGliding) {
        p.isGliding = false;
        this.state.events.push({ type: 'glide_ended', data: {} });
      }
    }

    // 4. Vertical Integration & Gravity
    const prevPlayerZ = p.z;
    const gravity = p.isGliding ? 250 : 960;
    p.vz -= gravity * dt;
    p.z += p.vz * dt;
    if (p.vz > 0 && this.state.terrain.meshCollider) {
      const ceilY = this.state.terrain.meshCollider.queryCeiling(p.pos.x, p.pos.y, prevPlayerZ);
      const charHeight = this.state.terrain.isCustomTestMap ? 90 : 46;
      if (ceilY < Infinity && p.z + charHeight > ceilY - 4) {
        p.z = Math.min(p.z, Math.max(prevPlayerZ, ceilY - charHeight - 4));
        p.vz = 0;
      }
    }

    // Ground elevation check from TerrainSystem (using pre-step Z when falling so thin bridges/platforms never tunnel)
    const queryZ = p.vz <= 0 ? Math.max(p.z, prevPlayerZ) : p.z;
    const initialStepLimit = this.state.terrain.getStepUpLimitAt(p.pos.x, p.pos.y);
    const terrainSample = this.state.terrain.getElevation(p.pos.x, p.pos.y, queryZ, initialStepLimit);
    p.groundZ = terrainSample.height;
    const maxSnapDrop = this.state.terrain.isCustomTestMap ? 95 : 28;

    // Step-down snapping: if grounded and walking downhill on a slope, keep glued to ground
    if (p.isGrounded && !p.isJumping) {
      const drop = p.z - p.groundZ;
      if (drop >= 0 && drop <= maxSnapDrop) {
        p.z = p.groundZ;
        p.vz = 0;
      }
    }

    if (p.z <= p.groundZ && p.vz <= 0 && p.groundZ <= Math.max(prevPlayerZ, p.z) + initialStepLimit) {
      p.z = p.groundZ;
      p.vz = 0;
      if (!p.isGrounded) {
        this.onPlayerLanded();
      }
      // Base recharge 25/sec scaled by Fuel Recycler
      p.jetpackFuel = Math.min(
        p.maxJetpackFuel,
        p.jetpackFuel + 25 * (p.calculatedStats.jetpackRegenMultiplier || 1) * dt
      );
    } else if (p.z > p.groundZ + 20) {
      p.isGrounded = false;
    }

    // Water physics check: smooth wading resistance (~68% movement speed base, eased by Meltwater Treads)
    p.inWater = Boolean(terrainSample.isInWater && p.z <= terrainSample.height + 10);
    const waterSpeedMult = p.inWater
      ? Math.min(0.92, 0.68 + (p.calculatedStats.waterSpeedBonus || 0))
      : 1.0;

    // 5. Horizontal Movement with Per-Axis Wall-Sliding Collision
    const airMultiplier = p.isGliding ? 1.25 : 1.0;
    const isMedicalRush = p.equippedSkills.utility.id === 'medical_rush';
    const isExtendedDash = p.skillEnhancements?.utility === 'extended_dash';
    const kineticStrideMult =
      p.heroId === 'commander' && isExtendedDash
        ? 1 + 0.04 * (p.buffs.buff_cmd_kinetic_stride || 0)
        : 1.0;
    let dashSpeedMult = 3.5;
    if (isMedicalRush) {
      // Therapeutic Pass = exact 1.5x Commander base dash distance (Extended Dash doubles -> 3.0x)
      const commanderDistFactor = 3.5 * 0.22;
      dashSpeedMult =
        (commanderDistFactor * DOCTOR_CONFIG.therapeuticPass.commanderDistanceFactor) /
        DOCTOR_CONFIG.therapeuticPass.duration;
      if (isExtendedDash) {
        dashSpeedMult *= 2.0;
      }
    } else if (isExtendedDash) {
      dashSpeedMult = 7.0 * kineticStrideMult;
    }
    const currentSpeed = (p.isDashing ? p.moveSpeed * dashSpeedMult : p.moveSpeed * airMultiplier) * waterSpeedMult;
    const preMoveX = p.pos.x;
    const preMoveY = p.pos.y;

    if (p.isDashing) {
      p.dashDurationTimer -= dt;
      if (p.dashDurationTimer <= 0) {
        p.isDashing = false;
        if (isMedicalRush) {
          if (p.skillEnhancements?.utility === 'phase_barrier') {
            const sterileStacks = p.buffs.buff_doc_sterile_interval || 0;
            const postDashInvuln = Math.min(1.3, DOCTOR_CONFIG.phaseBarrier.postDashImmunityDuration + 0.1 * sterileStacks);
            p.phaseBarrierTimer = Math.max(p.phaseBarrierTimer ?? 0, postDashInvuln);
          }
          if (p.skillEnhancements?.utility === 'adrenaline_rush') {
            const rushPersistStacks = p.buffs.buff_doc_rush_persistence || 0;
            p.adrenalineRushTimer = Math.min(
              2.3,
              DOCTOR_CONFIG.adrenalineRush.duration + 0.2 * rushPersistStacks
            );
            this.state.updateCalculatedStats();
            this.state.events.push({
              type: 'adrenaline_activated',
              data: { pos: { ...p.pos }, duration: p.adrenalineRushTimer }
            });
          }
        }
      }

      // Dash Upgrade 1: Shock Dash — Creates a shockwave at the first enemy hit with AOE & knockback!
      if (p.skillEnhancements?.utility === 'shock_dash') {
        if (!p.dashHitIds) p.dashHitIds = new Set<string>();
        const cwStacks = p.heroId === 'commander' ? (p.buffs.buff_cmd_concussive_wave || 0) : 0;
        const nearby = this.spatialGrid.getNearby(p.pos, 115);
        for (let sv = 0; sv < nearby.length; sv++) {
          const target = nearby[sv];
          if (target.health > 0 && !p.dashHitIds.has(target.id) && Math.abs(target.z - p.z) <= 160) {
            p.dashHitIds.add(target.id);
            if (!p.dashShockwaveTriggered) {
              p.dashShockwaveTriggered = true;
              const shockRadius = 240 * (1 + 0.05 * cwStacks);
              const shockDmg = 68 * (1 + 0.03 * cwStacks) * p.calculatedStats.damageMultiplier;
              const aoeVictims = this.spatialGrid.getNearby(p.pos, shockRadius);
              for (const av of aoeVictims) {
                if (av.health > 0 && Math.abs(av.z - p.z) <= 165) {
                  this.damageEnemy(av, shockDmg, av.pos);
                  // Strong kinetic knockback impulse
                  const kdx = av.pos.x - p.pos.x;
                  const kdy = av.pos.y - p.pos.y;
                  const kdist = Math.hypot(kdx, kdy) || 1;
                  av.pos.x += (kdx / kdist) * 88;
                  av.pos.y += (kdy / kdist) * 88;
                }
              }
              this.state.events.push({
                type: 'dash_shockwave_impact',
                data: { pos: { ...p.pos }, z: p.z, radius: shockRadius, dir: { ...p.dashDir } }
              });
            }
            break;
          }
        }
      }

      const prevPos = { x: p.pos.x, y: p.pos.y };
      // Dynamic sub-steps ensure high-speed dashes (e.g., Medical Rush) never tunnel through cliffs
      const dashStepDist = Math.hypot(p.dashDir.x * currentSpeed * dt, p.dashDir.y * currentSpeed * dt);
      const dashSubSteps = Math.max(2, Math.ceil(dashStepDist / 16));
      const stepDt = dt / dashSubSteps;

      for (let s = 0; s < dashSubSteps; s++) {
        const nextX = p.pos.x + p.dashDir.x * currentSpeed * stepDt;
        const nextY = p.pos.y + p.dashDir.y * currentSpeed * stepDt;
        if (this.moveWithTerrainSlide(p.pos, p.z, nextX, nextY, !p.isGrounded, 30)) {
          if (p.isGrounded && !p.isJumping) {
            const stepLim = this.state.terrain.getStepUpLimitAt(p.pos.x, p.pos.y);
            const h = this.state.terrain.getElevation(p.pos.x, p.pos.y, p.z, stepLim).height;
            if (h <= p.z + stepLim && h >= p.z - 95) p.z = h;
          }
        }
      }

      // --- Dash Combat Interactions ---
      const utilDef = p.equippedSkills.utility;
      if (utilDef.id === 'tactical_dash' && !p.dashShockwaveTriggered) {
        // Commander Impact Dash: Colliding with an enemy triggers a one-time shockwave
        const candidates = this.spatialGrid.getNearby(p.pos, 160);
        let primaryHit: EnemyState | null = null;
        for (let i = 0; i < candidates.length; i++) {
          const enemy = candidates[i];
          if (enemy.health <= 0) continue;
          if (Math.abs(enemy.z - p.z) > 160) continue;
          const dist = Math.hypot(enemy.pos.x - p.pos.x, enemy.pos.y - p.pos.y);
          if (dist <= 74 + enemy.radius) {
            primaryHit = enemy;
            break;
          }
        }

        if (primaryHit) {
          p.dashShockwaveTriggered = true;
          const impactPos = { x: primaryHit.pos.x, y: primaryHit.pos.y };
          const directDmg = utilDef.baseDamage * p.calculatedStats.damageMultiplier;
          const shockRadius = 225 * (p.calculatedStats.aoeRadiusMultiplier || 1.0) * (p.calculatedStats.ultimateRadiusMultiplier || 1.0);

          // Primary enemy takes direct impact damage + directional kinetic knockback
          this.damageEnemy(primaryHit, directDmg, impactPos);
          primaryHit.velocity.x += p.dashDir.x * 520;
          primaryHit.velocity.y += p.dashDir.y * 520;

          // Nearby enemies take shockwave area damage once per dash impact
          const nearby = this.spatialGrid.getNearby(impactPos, shockRadius);
          for (let j = 0; j < nearby.length; j++) {
            const v = nearby[j];
            if (v.health <= 0 || v.id === primaryHit.id) continue;
            if (Math.abs(v.z - primaryHit.z) > 160) continue;
            const d = Math.hypot(v.pos.x - impactPos.x, v.pos.y - impactPos.y);
            if (d <= shockRadius + v.radius) {
              this.damageEnemy(v, directDmg * 0.85, impactPos);
              const kdx = v.pos.x - impactPos.x;
              const kdy = v.pos.y - impactPos.y;
              const klen = Math.hypot(kdx, kdy) || 1;
              v.velocity.x += (kdx / klen) * 280;
              v.velocity.y += (kdy / klen) * 280;
            }
          }

          this.state.events.push({
            type: 'dash_shockwave',
            data: { pos: impactPos, z: primaryHit.z, radius: shockRadius, dir: { ...p.dashDir } }
          });
        }
      } else if (utilDef.id === 'medical_rush') {
        // Doctor Therapeutic Pass: Heal allies/decoys and damage enemies along swept dash path
        const cfg = DOCTOR_CONFIG.therapeuticPass;
        if (!p.dashHitIds) p.dashHitIds = new Set<string>();
        const segDx = p.pos.x - prevPos.x;
        const segDy = p.pos.y - prevPos.y;
        const segLenSq = segDx * segDx + segDy * segDy;
        const midPos = { x: (prevPos.x + p.pos.x) * 0.5, y: (prevPos.y + p.pos.y) * 0.5 };
        const searchRadius = Math.sqrt(segLenSq) * 0.5 + 65;
        const candidates = this.spatialGrid.getNearby(midPos, searchRadius);
        const rushDmg = cfg.enemyDamage * p.calculatedStats.damageMultiplier;

        for (let i = 0; i < candidates.length; i++) {
          const enemy = candidates[i];
          if (enemy.health <= 0 || p.dashHitIds.has(enemy.id)) continue;
          if (Math.abs(enemy.z - p.z) > 65) continue;

          // Closest point on segment prevPos -> p.pos
          let t = 0;
          if (segLenSq > 0.0001) {
            t = ((enemy.pos.x - prevPos.x) * segDx + (enemy.pos.y - prevPos.y) * segDy) / segLenSq;
            t = Math.max(0, Math.min(1, t));
          }
          const closestX = prevPos.x + t * segDx;
          const closestY = prevPos.y + t * segDy;
          const distToSeg = Math.hypot(enemy.pos.x - closestX, enemy.pos.y - closestY);

          if (distToSeg <= cfg.sweepHitRadius + enemy.radius) {
            p.dashHitIds.add(enemy.id);
            const impactDosageStacks = p.skillEnhancements?.utility === 'extended_dash' ? (p.buffs.buff_doc_impact_dosage || 0) : 0;
            const actualRushDmg = rushDmg * (1 + 0.04 * impactDosageStacks);
            this.damageEnemy(enemy, actualRushDmg, enemy.pos, 'medical');
            this.state.events.push({
              type: 'medical_rush_hit',
              data: { pos: { ...enemy.pos }, z: enemy.z }
            });
          }
        }
      }
    } else {
      if (worldMx !== 0 || worldMy !== 0) {
        const nextX = p.pos.x + worldMx * currentSpeed * dt;
        const nextY = p.pos.y + worldMy * currentSpeed * dt;

        this.moveWithTerrainSlide(p.pos, p.z, nextX, nextY, !p.isGrounded, 30);

        // Camera-relative facing: selects sprite view based strictly on screen direction
        if (p.castFacingLockTimer <= 0) {
          const sx = input.moveDir.x;
          const sy = input.moveDir.y;
          if (Math.abs(sx) > Math.abs(sy)) {
            p.facing = sx > 0 ? 'right' : 'left';
          } else {
            p.facing = sy > 0 ? 'front' : 'back';
          }
        }
      }
    }

    const clampedPlayer = this.state.terrain.clampToPlayableBounds(p.pos, 45);
    p.pos.x = clampedPlayer.pos.x;
    p.pos.y = clampedPlayer.pos.y;

    this.resolveObstacleCollisions(p.pos, 38);
    // Run wall push-out even while airborne/dashing so entities never settle inside hollow tower/waterfall meshes
    this.state.terrain.pushOutOfSteepTerrain(p.pos, p.z, 30);

    // Reliable ground surface tracking: Keep feet firmly anchored to terrain without wall-teleporting up cliffs
    const stepUpLimit = this.state.terrain.getStepUpLimitAt(p.pos.x, p.pos.y);
    let finalSample = this.state.terrain.getElevation(p.pos.x, p.pos.y, p.z, stepUpLimit);
    let finalElev = finalSample.height;
    if (p.isGrounded && !p.isJumping) {
      const drop = p.z - finalElev;
      if (drop > maxSnapDrop) {
        // Ground dropped suddenly beneath player (walked off sheer cliff edge or ledge) -> enter free fall
        p.isGrounded = false;
      } else if (finalElev > p.z + stepUpLimit) {
        // Shoved into a steep cliff face or overhang lip: push out or revert horizontal move rather than teleporting upward
        if (this.state.terrain.pushOutOfSteepTerrain(p.pos, p.z, 30)) {
          finalSample = this.state.terrain.getElevation(p.pos.x, p.pos.y, p.z, stepUpLimit);
          finalElev = finalSample.height;
        }
        if (finalElev > p.z + stepUpLimit) {
          p.pos.x = preMoveX;
          p.pos.y = preMoveY;
          finalSample = this.state.terrain.getElevation(p.pos.x, p.pos.y, p.z, stepUpLimit);
          finalElev = finalSample.height;
        }
        if (finalElev <= p.z + stepUpLimit) {
          p.z = finalElev;
        }
        p.vz = 0;
      } else {
        // Walkable ground or slope: stay firmly glued to terrain surface
        p.z = finalElev;
        p.vz = 0;
      }
    } else {
      // Airborne / falling / jumping: land cleanly when descending onto solid surfaces without snapping up walls
      if (finalSample.sourceTag === 'event:dash_platform') {
        if (p.z <= finalElev && p.vz <= 0) {
          p.z = finalElev;
          p.vz = 0;
          if (!p.isGrounded) {
            this.onPlayerLanded();
          }
        }
      } else if (
        p.z <= finalElev &&
        finalElev <= Math.max(prevPlayerZ, p.z) + stepUpLimit &&
        (p.vz <= 0 || finalElev - p.z <= 28)
      ) {
        p.z = finalElev;
        if (p.vz <= 0) {
          p.vz = 0;
          if (!p.isGrounded) {
            this.onPlayerLanded();
          }
        }
      }
    }
    p.groundZ = finalElev;
    p.inWater = Boolean(finalSample.isInWater && p.z <= terrainSample.height + 10);

    // Non-looping last-safe-grounded & unstuck safeguard
    if (this.unstuckCooldown > 0) {
      this.unstuckCooldown = Math.max(0, this.unstuckCooldown - dt);
    }
    if (
      p.isGrounded &&
      !p.isJumping &&
      finalSample.isWalkable &&
      finalSample.category !== 'cliff' &&
      finalSample.category !== 'solid_obstacle' &&
      Math.abs(p.z - finalElev) <= 4 &&
      this.unstuckCooldown <= 0
    ) {
      const blockedByObs = this.state.obstacles.some(
        (obs) => Math.hypot(p.pos.x - obs.pos.x, p.pos.y - obs.pos.y) < obs.radius * 0.78
      );
      if (!blockedByObs) {
        this.lastSafeGroundedPos = { x: p.pos.x, y: p.pos.y, z: finalElev };
      }
    }

    if (this.unstuckCooldown <= 0 && !p.isDashing) {
      if (
        !p.isGrounded &&
        !p.isJumping &&
        p.vz <= 0 &&
        p.z < finalElev - 60 &&
        finalElev - p.z <= 120 &&
        (!this.state.terrain.meshCollider || this.state.terrain.meshCollider.queryCeiling(p.pos.x, p.pos.y, p.z) === Infinity)
      ) {
        p.z = finalElev + 2;
        p.vz = 0;
        p.isGrounded = true;
        this.stuckCheckTimer = 0;
        this.unstuckCooldown = 0.85;
      } else if ((worldMx !== 0 || worldMy !== 0) && this.stuckPrevPos) {
        const movedStep = Math.hypot(p.pos.x - this.stuckPrevPos.x, p.pos.y - this.stuckPrevPos.y);
        const insideSolid =
          !finalSample.isWalkable ||
          finalSample.category === 'cliff' ||
          finalSample.category === 'solid_obstacle';
        if (movedStep < 10 * dt && insideSolid) {
          this.stuckCheckTimer += dt;
          if (this.stuckCheckTimer >= 0.45 && this.lastSafeGroundedPos) {
            p.pos.x = this.lastSafeGroundedPos.x;
            p.pos.y = this.lastSafeGroundedPos.y;
            p.z = this.lastSafeGroundedPos.z + 2;
            p.vz = 0;
            p.isGrounded = true;
            this.stuckCheckTimer = 0;
            this.unstuckCooldown = 0.9;
          }
        } else {
          this.stuckCheckTimer = Math.max(0, this.stuckCheckTimer - dt * 3);
        }
      }
    }
    this.stuckPrevPos = { x: p.pos.x, y: p.pos.y };
  }

  private onPlayerLanded(): void {
    const p = this.state.player;
    p.isGrounded = true;
    p.isJumping = false;
    p.airJumpsRemaining = p.maxAirJumps ?? 0;
    if (p.isGliding) {
      p.isGliding = false;
      this.state.events.push({ type: 'glide_ended', data: {} });
    }
    this.state.events.push({ type: 'landed', data: { z: p.z } });

    // T08 Aftershock: landing from air (> 150ms) triggers 200u shockwave for 4% * n base LMB damage (3s ICD)
    const aftershockStacks = p.buffs.buff_aftershock || 0;
    if (aftershockStacks > 0 && this.airborneDuration > 0.15 && p.aftershockCooldown <= 0) {
      p.aftershockCooldown = 3.0;
      const shockDmg = 0.04 * aftershockStacks * p.baseLmbDamage * p.calculatedStats.damageMultiplier;
      const victims = this.spatialGrid.getNearby(p.pos, 200);
      for (let i = 0; i < victims.length; i++) {
        const v = victims[i];
        if (v.health > 0 && Math.abs(v.z - p.z) <= 160) {
          this.damageEnemy(v, shockDmg, v.pos, 'physical', { isRecursiveTrigger: true });
        }
      }
      this.state.events.push({
        type: 'dash_shockwave',
        data: { pos: { ...p.pos }, z: p.z, radius: 200, variant: 'aftershock' }
      });
    }
    this.airborneDuration = 0;
    p.aerialFocusLatched = false;
  }

  private triggerTimedEffect(
    effectId: TimedEffectId,
    durationSec: number,
    icdSec: number,
    sourceBuffId: BuffId
  ): boolean {
    const p = this.state.player;
    const stacks = Math.min(3, p.buffs[sourceBuffId] || 0);
    if (stacks <= 0) return false;
    if (!p.timedEffectCooldowns) p.timedEffectCooldowns = {};
    if (!p.activeTimedEffects) p.activeTimedEffects = {};
    if ((p.timedEffectCooldowns[effectId] ?? 0) > 0) return false;

    if (icdSec > 0) {
      p.timedEffectCooldowns[effectId] = icdSec;
    }
    const def = BUFF_REGISTRY[sourceBuffId];
    const prev = p.activeTimedEffects[effectId];
    const needsStatsUpdate = !prev || prev.remaining <= 0 || prev.stacks !== stacks;
    p.activeTimedEffects[effectId] = {
      id: effectId,
      name: def?.name || effectId,
      icon: def?.icon || '/assets/attack_speed.png',
      remaining: durationSec,
      duration: durationSec,
      stacks,
      sourceBuffId,
      color: def?.accentColor || '#38bdf8'
    };
    if (needsStatsUpdate) {
      this.state.updateCalculatedStats();
    }
    return true;
  }

  private runPrimaryLmbCast(fn: () => void): void {
    const startIdx = this.state.projectiles.length;
    this.isExecutingPrimaryLmb = true;
    try {
      fn();
    } finally {
      this.isExecutingPrimaryLmb = false;
      for (let i = startIdx; i < this.state.projectiles.length; i++) {
        this.state.projectiles[i].isPrimaryLmb = true;
      }
    }
  }

  /**
   * Moves an entity toward (nextX, nextY) while sliding smoothly along steep cliff faces
   * instead of halting dead or clipping corners into unwalkable terrain.
   */
  private moveWithTerrainSlide(
    pos: Vector2,
    z: number,
    nextX: number,
    nextY: number,
    isAirborne: boolean,
    radius: number
  ): boolean {
    const trav = this.state.terrain.checkTraversable(pos, { x: nextX, y: nextY }, z, isAirborne, radius);
    if (trav.allowed) {
      pos.x = trav.newPos.x;
      pos.y = trav.newPos.y;
      return true;
    }

    let nx = trav.surfaceNormal.x;
    let ny = trav.surfaceNormal.y;
    const nLen = Math.hypot(nx, ny);
    if (nLen > 0.001) {
      nx /= nLen;
      ny /= nLen;
    } else {
      const grad = this.state.terrain.getSlopeGradient(pos.x, pos.y);
      const gLen = Math.hypot(grad.gx, grad.gy);
      nx = gLen > 0.001 ? -grad.gx / gLen : 0;
      ny = gLen > 0.001 ? -grad.gy / gLen : 0;
    }

    const mDx = nextX - pos.x;
    const mDy = nextY - pos.y;
    const dotN = mDx * nx + mDy * ny;
    const sDx = dotN < 0 ? (mDx - nx * dotN) : mDx;
    const sDy = dotN < 0 ? (mDy - ny * dotN) : mDy;

    const slideTrav = this.state.terrain.checkTraversable(
      pos,
      { x: pos.x + sDx, y: pos.y + sDy },
      z,
      isAirborne,
      radius
    );
    if (slideTrav.allowed) {
      pos.x = slideTrav.newPos.x;
      pos.y = slideTrav.newPos.y;
      return true;
    }

    const travX = this.state.terrain.checkTraversable(pos, { x: nextX, y: pos.y }, z, isAirborne, radius);
    if (travX.allowed) {
      pos.x = travX.newPos.x;
      return true;
    }

    const travY = this.state.terrain.checkTraversable(pos, { x: pos.x, y: nextY }, z, isAirborne, radius);
    if (travY.allowed) {
      pos.y = travY.newPos.y;
      return true;
    }

    // Smooth corner-bevel slide: if tangent projection nudges slightly into a curved mesh crease,
    // deflect slightly outward along the surface normal while advancing tangentially.
    const stepMag = Math.hypot(mDx, mDy);
    if (nLen > 0.001 && stepMag > 0.05) {
      const sMag = Math.hypot(sDx, sDy);
      const tX = sMag > 0.05 ? sDx : -ny * stepMag * 0.7;
      const tY = sMag > 0.05 ? sDy : nx * stepMag * 0.7;
      for (const nudgeScale of [0.35, 0.75]) {
        const escapeTrav = this.state.terrain.checkTraversable(
          pos,
          { x: pos.x + tX + nx * stepMag * nudgeScale, y: pos.y + tY + ny * stepMag * nudgeScale },
          z,
          isAirborne,
          radius
        );
        if (escapeTrav.allowed) {
          pos.x = escapeTrav.newPos.x;
          pos.y = escapeTrav.newPos.y;
          return true;
        }
      }
    }

    return false;
  }

  private resolveObstacleCollisions(pos: Vector2, radius: number, isTitan: boolean = false): void {
    for (let i = 0; i < this.state.obstacles.length; i++) {
      const obs = this.state.obstacles[i];
      if (this.state.terrain.isCustomTestMap && obs.type === 'tree') continue;
      if (isTitan) {
        // Colossal titan easily steps over small flora, mushrooms, low pebbles, and spaceship hull
        if (obs.id.startsWith('ship_')) continue;
        if (obs.type === 'mushroom' || obs.type === 'flora') continue;
        if (obs.radius < 26) continue;
      }
      const dx = pos.x - obs.pos.x;
      const dy = pos.y - obs.pos.y;
      const minDist = radius + obs.radius;
      const dist2 = dx * dx + dy * dy;

      if (dist2 < minDist * minDist && dist2 > 0.001) {
        const dist = Math.sqrt(dist2);
        const overlap = minDist - dist;
        pos.x += (dx / dist) * overlap;
        pos.y += (dy / dist) * overlap;
      }
    }
  }

  private isUnstuckSpotValid(
    wx: number,
    wy: number,
    maxSlope: number,
    obstaclePad: number,
    checkCardinals: boolean
  ): { valid: boolean; height: number } {
    const terrain = this.state.terrain;
    if (!terrain.isInsidePlayableBounds(wx, wy, 55)) {
      return { valid: false, height: 0 };
    }

    const elev = terrain.getElevation(wx, wy);
    if (!elev.isWalkable || elev.surfaceType === 'chasm') {
      return { valid: false, height: elev.height };
    }
    if (!terrain.isCustomTestMap && elev.height >= 680) {
      return { valid: false, height: elev.height };
    }

    const slope = terrain.getSurfaceSlope(wx, wy, 24);
    if (slope > maxSlope) {
      return { valid: false, height: elev.height };
    }

    if (checkCardinals) {
      const step = 28;
      const offsets = [
        [step, 0],
        [-step, 0],
        [0, step],
        [0, -step],
      ];
      for (const [ox, oy] of offsets) {
        const nx = wx + ox;
        const ny = wy + oy;
        if (!terrain.isInsidePlayableBounds(nx, ny, 45)) {
          return { valid: false, height: elev.height };
        }
        const nElev = terrain.getElevation(nx, ny);
        if (!nElev.isWalkable || nElev.surfaceType === 'chasm' || Math.abs(nElev.height - elev.height) > 24) {
          return { valid: false, height: elev.height };
        }
      }
    }

    for (let i = 0; i < this.state.obstacles.length; i++) {
      const obs = this.state.obstacles[i];
      const minDist = obs.radius + obstaclePad;
      const dx = wx - obs.pos.x;
      const dy = wy - obs.pos.y;
      if (dx * dx + dy * dy < minDist * minDist) {
        return { valid: false, height: elev.height };
      }
    }

    return { valid: true, height: elev.height };
  }

  private findNearestWalkablePos(
    origin: Vector2,
    radii: number[],
    maxSlope: number,
    obstaclePad: number,
    checkCardinals: boolean
  ): { x: number; y: number; z: number } | null {
    const angleCount = 16;
    for (const r of radii) {
      if (r === 0) {
        const res = this.isUnstuckSpotValid(origin.x, origin.y, maxSlope, obstaclePad, checkCardinals);
        if (res.valid) {
          return { x: origin.x, y: origin.y, z: res.height };
        }
        continue;
      }

      for (let i = 0; i < angleCount; i++) {
        const angle = (i / angleCount) * Math.PI * 2;
        const cx = origin.x + Math.cos(angle) * r;
        const cy = origin.y + Math.sin(angle) * r;
        const res = this.isUnstuckSpotValid(cx, cy, maxSlope, obstaclePad, checkCardinals);
        if (res.valid) {
          return { x: cx, y: cy, z: res.height };
        }
      }
    }
    return null;
  }

  /** Resets the player to the nearest valid walkable terrain and clears aerial/stuck motion state. */
  public unstuckPlayer(): { x: number; y: number; z: number } {
    const p = this.state.player;
    const terrain = this.state.terrain;
    const clampedOrigin = terrain.clampToPlayableBounds(p.pos, 55).pos;

    const strictRadii = [0, 25, 50, 75, 100, 140, 180, 230, 290, 360, 440, 540, 660, 800, 960];
    const strictMaxSlope = terrain.isCustomTestMap ? 0.65 : 0.55;
    let target = this.findNearestWalkablePos(clampedOrigin, strictRadii, strictMaxSlope, 26, true);

    if (!target) {
      const relaxedRadii = [0, 40, 90, 160, 260, 400, 600, 900, 1300];
      target = this.findNearestWalkablePos(clampedOrigin, relaxedRadii, 0.95, 24, false);
    }

    if (!target) {
      const fallbackPos =
        terrain.isCustomTestMap && terrain.testSpawnPos
          ? terrain.testSpawnPos
          : this.state.playerSpawnPos;
      const fallbackHeight = terrain.calculateHeight(fallbackPos.x, fallbackPos.y);
      target = { x: fallbackPos.x, y: fallbackPos.y, z: fallbackHeight };
    }

    const wasGliding = p.isGliding;
    p.pos.x = target.x;
    p.pos.y = target.y;
    p.z = target.z;
    p.groundZ = target.z;
    p.vz = 0;
    p.velocity.x = 0;
    p.velocity.y = 0;
    p.isGrounded = true;
    p.isJumping = false;
    p.isGliding = false;
    p.isDashing = false;
    p.dashDurationTimer = 0;

    if (wasGliding) {
      this.state.events.push({ type: 'glide_ended', data: {} });
    }

    return target;
  }

  private facingToVector(facing: Direction4): Vector2 {
    switch (facing) {
      case 'front': return { x: 0, y: 1 };
      case 'back': return { x: 0, y: -1 };
      case 'left': return { x: -1, y: 0 };
      case 'right': return { x: 1, y: 0 };
    }
  }

  private computeCameraFacing(dx: number, dy: number): 'front' | 'back' | 'left' | 'right' {
    const p = this.state.player;
    let screenRight: number;
    let screenForward: number;
    if (this.lastCameraRight && this.lastCameraForward) {
      screenRight = dx * this.lastCameraRight.x + dy * this.lastCameraRight.y;
      screenForward = dx * this.lastCameraForward.x + dy * this.lastCameraForward.y;
    } else {
      const cosY = Math.cos(p.cameraYaw);
      const sinY = Math.sin(p.cameraYaw);
      screenRight = dx * cosY - dy * sinY;
      screenForward = dx * sinY + dy * cosY;
    }

    if (Math.abs(screenRight) > Math.abs(screenForward)) {
      return screenRight > 0 ? 'right' : 'left';
    }
    return screenForward > 0 ? 'back' : 'front';
  }

  private setFacingToward(targetPos: Vector2): void {
    const p = this.state.player;
    const dx = targetPos.x - p.pos.x;
    const dy = targetPos.y - p.pos.y;
    if (dx === 0 && dy === 0) return;

    p.facing = this.computeCameraFacing(dx, dy);
    p.castFacingLockTimer = 0.28;
  }

  private updateSkills(dt: number, input: InputSnapshot): void {
    const p = this.state.player;
    if (p.isCarryingEventPayload) {
      p.beamChargeTimer = 0;
      p.beamTargetPos = null;
      if (this.state.vitalTethers.length > 0) {
        this.state.vitalTethers = [];
      }
      return;
    }
    const stats = p.calculatedStats;

    // --- Primary Weapon Slot ---
    const primaryDef = p.equippedSkills.primary;
    const primaryCd =
      primaryDef.cooldown /
      Math.max(0.1, (stats.lmbAttackSpeedMultiplier || 1.0) * (stats.attackSpeedMultiplier || 1.0));
    const primaryEnh = p.skillEnhancements?.primary;

    if (p.heroId === 'doctor' && primaryEnh === 'vital_extraction') {
      // LMB Augment 3: Vital Extraction — Continuous multi-tether HP drain & self-heal
      this.updateVitalExtraction(dt, input);
    } else if (primaryDef.id === 'hyper_beam') {
      // 0.2s charge state handling for laser beam before next fire
      if ((p.beamChargeTimer ?? 0) > 0) {
        p.beamChargeTimer = (p.beamChargeTimer ?? 0) - dt;
        if (input.wantPrimaryManual) {
          p.beamTargetPos = { ...input.mouseWorldPos };
        } else if (p.autoCastPrimary) {
          const nearest = this.spatialGrid.findNearest(p.pos, primaryDef.range);
          if (nearest) p.beamTargetPos = { ...nearest.pos };
        }
        if (p.beamTargetPos) {
          this.setFacingToward(p.beamTargetPos);
        }

        if (p.beamChargeTimer <= 0) {
          p.beamChargeTimer = 0;
          if (p.beamTargetPos) {
            const beamTarget = p.beamTargetPos;
            this.runPrimaryLmbCast(() => this.fireHyperBeam(beamTarget));
            p.primaryCooldownRemaining = primaryCd;
          }
          p.beamTargetPos = null;
        }
      } else if (p.primaryCooldownRemaining <= 0) {
        let target: Vector2 | null = null;
        if (input.wantPrimaryManual) {
          target = { ...input.mouseWorldPos };
        } else if (p.autoCastPrimary) {
          const origin3D = { x: p.pos.x, y: p.pos.y, z: p.z + 52 };
          const candidates = this.spatialGrid.getNearby(p.pos, primaryDef.range * 1.15);
          let bestEnemy: EnemyState | null = null;
          const inRange: Array<{ cand: EnemyState; d3D: number; candCenter3D: Vector3 }> = [];

          for (let c = 0; c < candidates.length; c++) {
            const cand = candidates[c];
            if (cand.health <= 0) continue;
            const candCenter3D = { x: cand.pos.x, y: cand.pos.y, z: cand.z + cand.radius * 0.8 };
            const d3D = Math.hypot(candCenter3D.x - origin3D.x, candCenter3D.y - origin3D.y, candCenter3D.z - origin3D.z);
            if (d3D <= primaryDef.range) {
              inRange.push({ cand, d3D, candCenter3D });
            }
          }

          inRange.sort((a, b) => a.d3D - b.d3D);
          for (let i = 0; i < inRange.length; i++) {
            if (this.state.terrain.checkLineOfSight3D(origin3D, inRange[i].candCenter3D)) {
              bestEnemy = inRange[i].cand;
              break; // Nearest visible enemy found; avoid testing remaining candidates
            }
          }

          if (bestEnemy) {
            target = { ...bestEnemy.pos };
          }
        }

        if (target) {
          p.beamChargeTimer = 0.20;
          p.beamTargetPos = { ...target };
          this.setFacingToward(target);
          this.state.events.push({
            type: 'beam_charging',
            data: { from: { ...p.pos }, to: { ...target }, z: p.z, duration: 0.20 }
          });
        }
      }
    } else {
      if (p.primaryCooldownRemaining <= 0) {
        let target: Vector2 | null = null;
        let targetZ: number = p.z + 52;

        if (input.wantPrimaryManual) {
          target = { ...input.mouseWorldPos };
          targetZ = input.mouseWorldPos3D?.z ?? (this.state.terrain.calculateHeight(target.x, target.y) + 16);
        } else if (p.autoCastPrimary) {
          const origin3D = { x: p.pos.x, y: p.pos.y, z: p.z + 52 };
          const candidates = this.spatialGrid.getNearby(p.pos, primaryDef.range * 1.15);
          let bestEnemy: EnemyState | null = null;
          const inRange: Array<{ cand: EnemyState; d3D: number; candCenter3D: Vector3 }> = [];

          for (let c = 0; c < candidates.length; c++) {
            const cand = candidates[c];
            if (cand.health <= 0) continue;
            const candCenter3D = { x: cand.pos.x, y: cand.pos.y, z: cand.z + cand.radius * 0.8 };
            const d3D = Math.hypot(candCenter3D.x - origin3D.x, candCenter3D.y - origin3D.y, candCenter3D.z - origin3D.z);
            if (d3D <= primaryDef.range) {
              inRange.push({ cand, d3D, candCenter3D });
            }
          }

          inRange.sort((a, b) => a.d3D - b.d3D);
          for (let i = 0; i < inRange.length; i++) {
            if (this.state.terrain.checkLineOfSight3D(origin3D, inRange[i].candCenter3D)) {
              bestEnemy = inRange[i].cand;
              break;
            }
          }

          if (bestEnemy) {
            target = { ...bestEnemy.pos };
            targetZ = bestEnemy.z + bestEnemy.radius * 0.8;
          }
        }

        if (target) {
          const castTarget = target;
          this.runPrimaryLmbCast(() => {
            if (primaryEnh === 'toxic_chain') {
              this.fireToxicChain(castTarget, targetZ);
            } else if (primaryEnh === 'cryogenic_scalpel') {
              this.fireCryoScalpel(castTarget, targetZ);
            } else if (primaryEnh === 'chill_beam') {
              this.fireChillBeam(castTarget, targetZ);
            } else if (primaryEnh === 'piercing_laser') {
              this.firePiercingLaser(castTarget, targetZ);
            } else if (primaryEnh === 'extended_slash') {
              this.fireExtendedSlash(castTarget, targetZ);
            } else if (primaryDef.id === 'medical_pulse') {
              this.fireMedicalPulse(castTarget, targetZ);
            } else if (primaryDef.id === 'scatter_blaster') {
              this.fireScatterBlaster(castTarget, targetZ);
            } else if (primaryDef.id === 'arc_cannon') {
              this.fireArcCannon(castTarget);
            } else if (primaryDef.id === 'gatling_minigun') {
              this.fireGatlingMinigun(castTarget, targetZ);
            } else {
              this.firePrimaryPulse(castTarget, targetZ);
            }
          });
          p.primaryCooldownRemaining = primaryCd;
        }
      }
    }

    // --- Secondary Weapon Slot ---
    const secDef = p.equippedSkills.secondary;
    const secondaryCd =
      (secDef.cooldown * (stats.skillCooldownMultiplier || 1.0)) /
      Math.max(0.1, stats.attackSpeedMultiplier || 1.0);
    if (p.secondaryCooldownRemaining <= 0) {
      let target: Vector2 | null = null;
      let targetZ: number = p.z + 52;

      if (input.wantSecondaryManual) {
        if (input.mouseWorldPos && Number.isFinite(input.mouseWorldPos.x) && Number.isFinite(input.mouseWorldPos.y)) {
          target = { ...input.mouseWorldPos };
          targetZ = input.mouseWorldPos3D?.z ?? (this.state.terrain.calculateHeight(target.x, target.y) + 16);
        } else {
          target = { ...p.pos };
          targetZ = p.z + 16;
        }
      } else if (p.autoCastSecondary) {
        const origin3D = { x: p.pos.x, y: p.pos.y, z: p.z + 52 };
        const candidates = this.spatialGrid.getNearby(p.pos, secDef.range * 1.15);
        let bestEnemy: EnemyState | null = null;
        const inRange: Array<{ cand: EnemyState; d3D: number; candCenter3D: Vector3 }> = [];

        for (let c = 0; c < candidates.length; c++) {
          const cand = candidates[c];
          if (cand.health <= 0) continue;
          const candCenter3D = { x: cand.pos.x, y: cand.pos.y, z: cand.z + cand.radius * 0.8 };
          const d3D = Math.hypot(candCenter3D.x - origin3D.x, candCenter3D.y - origin3D.y, candCenter3D.z - origin3D.z);
          if (d3D <= secDef.range) {
            inRange.push({ cand, d3D, candCenter3D });
          }
        }

        inRange.sort((a, b) => a.d3D - b.d3D);
        for (let i = 0; i < inRange.length; i++) {
          if (this.state.terrain.checkLineOfSight3D(origin3D, inRange[i].candCenter3D)) {
            bestEnemy = inRange[i].cand;
            break;
          }
        }

        if (bestEnemy) {
          target = { ...bestEnemy.pos };
          targetZ = bestEnemy.z + bestEnemy.radius * 0.8;
        }
      }

      const secEnh = p.skillEnhancements?.secondary;
      if (secEnh === 'experimental_drones' && (input.wantSecondaryManual || target)) {
        this.triggerExperimentalDroneVolley();
        p.secondaryCooldownRemaining = secondaryCd;
        this.triggerTimedEffect('resonance_siphon', 3.5, 6.0, 'buff_resonance_siphon');
      } else if (target) {
        if (secEnh === 'toxic_cluster_bomb') {
          this.fireToxicClusterBomb(target, targetZ);
        } else if (secEnh === 'holographic_decoy') {
          this.fireHolographicDecoy(target);
        } else if (secEnh === 'scissor_slash') {
          this.fireScissorSlash(target, targetZ);
        } else if (secEnh === 'frost_burst') {
          this.fireFrostBurst();
        } else if (secEnh === 'orbiting_blade') {
          this.fireOrbitingBlade();
        } else if (secDef.id === 'explosive_bomb') {
          this.fireExplosiveBomb(target, targetZ);
        } else if (secDef.id === 'toxic_contamination') {
          this.fireToxicContamination(target, targetZ);
        } else if (secDef.id === 'sedative_dose') {
          this.fireSedativeDose(target, targetZ);
        } else if (secDef.id === 'cryo_grenade') {
          this.fireCryoGrenade(target, targetZ);
        } else if (secDef.id === 'gravity_vortex') {
          this.fireGravityVortex(target, targetZ);
        } else {
          this.firePiercingWave(target, targetZ);
        }
        p.secondaryCooldownRemaining = secondaryCd;
        this.triggerTimedEffect('resonance_siphon', 3.5, 6.0, 'buff_resonance_siphon');
      }
    }

    // --- Ultimate Slot (R) - Manual Cast Ground Shockwave Blast Centered on Player ---
    const ultDef = p.equippedSkills.ultimate;
    const canFireUltimate = p.ultimateCooldownRemaining <= 0;
    const wantFireUltimate = input.wantUltimate; // MANUAL CAST ONLY via [R] key

    if (canFireUltimate && wantFireUltimate) {
      // Celestial blast strikes from above directly onto player's ground position (no mouse aim needed)
      const playerPos: Vector2 = { x: p.pos.x, y: p.pos.y };
      const nearestUltEnemy = this.spatialGrid.findNearest(
        p.pos,
        (ultDef.range || 260) * stats.ultimateRadiusMultiplier
      );
      if (nearestUltEnemy) {
        this.setFacingToward(nearestUltEnemy.pos);
      } else if (input.moveDir.x !== 0 || input.moveDir.y !== 0) {
        const sx = input.moveDir.x;
        const sy = input.moveDir.y;
        p.facing = Math.abs(sx) > Math.abs(sy) ? (sx > 0 ? 'right' : 'left') : (sy > 0 ? 'front' : 'back');
      }
      p.castFacingLockTimer = p.heroId === 'doctor' ? DOCTOR_CONFIG.sacredField.castAnimDuration : 0.60;

      if (ultDef.id === 'sanctuary_cross') {
        this.fireSanctuaryCross(playerPos);
      } else if (ultDef.id === 'emergency_protocol') {
        this.fireEmergencyProtocol(playerPos);
      } else if (ultDef.id === 'carpet_nuke') {
        this.fireCarpetNuke(playerPos);
      } else if (ultDef.id === 'orbital_lance') {
        this.fireOrbitalLance(playerPos);
      } else if (ultDef.id === 'judgement_singularity') {
        this.fireJudgementSingularity(playerPos);
      } else if (ultDef.id === 'chrono_stasis') {
        this.fireChronoStasis(playerPos);
      } else {
        this.fireOrbitalJudgment(playerPos);
      }
      p.ultimateCooldownRemaining =
        ultDef.cooldown *
        stats.ultimateCooldownMultiplier *
        (stats.skillCooldownMultiplier || 1.0);
    }
  }

  private updateRecoveryFields(dt: number): void {
    const p = this.state.player;
    const alive: RecoveryFieldState[] = [];

    for (let i = 0; i < this.state.recoveryFields.length; i++) {
      const field = this.state.recoveryFields[i];
      field.durationRemaining -= dt;

      // Check if player is within recovery radius and height
      const dx = p.pos.x - field.pos.x;
      const dy = p.pos.y - field.pos.y;
      const dist = Math.hypot(dx, dy);

      if (dist <= field.radius && Math.abs(p.z - field.z) < 130) {
        if (p.health < p.maxHealth) {
          const healTick = field.healPerSecond * dt;
          p.health = Math.min(p.maxHealth, p.health + healTick);
        }
      }

      if (field.durationRemaining > 0) {
        alive.push(field);
      }
    }

    this.state.recoveryFields = alive;
  }

  private fireMedicalPulse(
    targetPos: Vector2,
    targetZ: number = this.state.player.z + 26,
    variant: 'medical' | 'toxic_chain' = 'medical'
  ): void {
    const p = this.state.player;
    const currentHand: 'left' | 'right' = p.pistolHand === 'right' ? 'right' : 'left';
    p.pistolHand = currentHand === 'left' ? 'right' : 'left';

    const aimDx = targetPos.x - p.pos.x;
    const aimDy = targetPos.y - p.pos.y;
    const baseAngle = Math.atan2(aimDy, aimDx);

    // Offset firing origin perpendicular to aim direction for alternating Left <-> Right pistols
    const perpAngle = baseAngle + (currentHand === 'left' ? -Math.PI / 2 : Math.PI / 2);
    const handOffset = 42;
    const origin = {
      x: p.pos.x + Math.cos(perpAngle) * handOffset,
      y: p.pos.y + Math.sin(perpAngle) * handOffset,
      z: p.z + 52
    };

    const dx = targetPos.x - origin.x;
    const dy = targetPos.y - origin.y;
    const dz = targetZ - origin.z;
    const dist3D = Math.hypot(dx, dy, dz) || 1;
    const shotAngle = Math.atan2(dy, dx);
    const pitch = Math.asin(Math.max(-0.95, Math.min(0.95, dz / dist3D)));

    const isChain = variant === 'toxic_chain';
    const cfg = isChain ? DOCTOR_CONFIG.toxicChain : DOCTOR_CONFIG.lmb;
    const speed = cfg.projectileSpeed * (p.calculatedStats.projectileSpeedMultiplier || 1.0);
    const count = 1 + (p.calculatedStats.extraLmbProjectiles || 0);
    const baseSpread = cfg.spreadAngleRad;
    const maxSpread = baseSpread * 3.0;
    const spread = count > 1 ? Math.min(maxSpread, baseSpread + (count - 2) * 0.06) : 0;
    const radius = cfg.projectileRadius * (p.calculatedStats.projectileRadiusMultiplier || 1.0);
    const pierceCount = isChain ? 1 : 1 + (p.calculatedStats.projectilePierce || 0);
    const baseDamage = cfg.baseDamage * p.calculatedStats.damageMultiplier;
    const activationId = this.allocateDirectAttackActivationId();

    this.setFacingToward(targetPos);

    for (let i = 0; i < count; i++) {
      const offset = count > 1 ? -spread / 2 + (spread / (count - 1)) * i : 0;
      const angle = shotAngle + offset;
      const horizSpeed = Math.cos(pitch) * speed;
      const vx = Math.cos(angle) * horizSpeed;
      const vy = Math.sin(angle) * horizSpeed;
      const vz = Math.sin(pitch) * speed;

      const proj: ProjectileState = {
        id: `proj_${this.nextProjId++}`,
        type: isChain ? 'toxic_chain' : 'medical_pulse',
        pos: { x: origin.x, y: origin.y },
        z: origin.z,
        velocity: { x: vx, y: vy },
        vz,
        speed,
        damage: baseDamage,
        pierceCount,
        maxDistance: cfg.range * 1.15,
        distanceTraveled: 0,
        owner: 'player',
        radius,
        hitEnemyIds: new Set(),
        originZ: origin.z,
        targetZ,
        hand: currentHand,
        bouncesRemaining: isChain ? DOCTOR_CONFIG.toxicChain.maxBounces : undefined,
        isRicochet: false,
        attackActivationId: activationId,
        isDirectAttack: true
      };
      this.state.projectiles.push(proj);
    }
    this.state.events.push({
      type: 'pulse_fired',
      data: { from: { ...origin }, to: targetPos, z: p.z, variant, hand: currentHand }
    });
  }

  private fireToxicChain(targetPos: Vector2, targetZ: number = this.state.player.z + 26): void {
    this.fireMedicalPulse(targetPos, targetZ, 'toxic_chain');
  }

  private fireCryoScalpel(targetPos: Vector2, targetZ: number = this.state.player.z + 26): void {
    const p = this.state.player;
    const cfg = DOCTOR_CONFIG.cryoScalpel;
    const origin = { x: p.pos.x, y: p.pos.y, z: p.z + 48 };
    const dx = targetPos.x - origin.x;
    const dy = targetPos.y - origin.y;
    const dz = targetZ - origin.z;
    const dist3D = Math.hypot(dx, dy, dz) || 1;
    const baseAngle = Math.atan2(dy, dx);
    const pitch = Math.asin(Math.max(-0.55, Math.min(0.55, dz / dist3D)));

    const count = Math.min(cfg.maxScalpels, 1 + Math.max(0, p.calculatedStats.extraLmbProjectiles || 0));
    const maxSpread = 0.65;
    const spread = count > 1 ? Math.min(maxSpread, cfg.spreadAngleRad + (count - 2) * 0.09) : 0;
    const speed = cfg.outboundSpeed * (p.calculatedStats.projectileSpeedMultiplier || 1.0);
    const surgicalEdgeStacks = p.heroId === 'doctor' ? (p.buffs.buff_doc_surgical_edge || 0) : 0;
    const damage = cfg.baseDamage * (1 + 0.04 * surgicalEdgeStacks) * p.calculatedStats.damageMultiplier;
    const radius = cfg.projectileRadius * (p.calculatedStats.projectileRadiusMultiplier || 1.0);
    const maxDistance = cfg.range * (p.calculatedStats.aoeRadiusMultiplier ? Math.min(1.35, Math.max(1.0, p.calculatedStats.aoeRadiusMultiplier)) : 1.0);
    const activationId = this.allocateDirectAttackActivationId();

    this.setFacingToward(targetPos);

    for (let i = 0; i < count; i++) {
      const offset = count > 1 ? -spread / 2 + (spread / (count - 1)) * i : 0;
      const angle = baseAngle + offset;
      const horizSpeed = Math.cos(pitch) * speed;
      this.state.projectiles.push({
        id: `proj_${this.nextProjId++}`,
        type: 'cryo_scalpel',
        pos: { x: origin.x, y: origin.y },
        z: origin.z,
        velocity: { x: Math.cos(angle) * horizSpeed, y: Math.sin(angle) * horizSpeed },
        vz: Math.sin(pitch) * speed,
        speed,
        damage,
        pierceCount: 999,
        maxDistance,
        distanceTraveled: 0,
        owner: 'player',
        radius,
        hitEnemyIds: new Set(),
        outboundHitIds: new Set(),
        returnHitIds: new Set(),
        returnPhase: false,
        originPos: { x: p.pos.x, y: p.pos.y },
        trailAccumDist: 0,
        element: 'ice',
        originZ: origin.z,
        targetZ,
        attackActivationId: activationId,
        isDirectAttack: true
      });
    }

    this.state.events.push({
      type: 'scalpel_thrown',
      data: { from: { ...origin }, to: { ...targetPos }, z: p.z, count }
    });
  }

  private updateVitalExtraction(dt: number, input: InputSnapshot): void {
    const p = this.state.player;
    const cfg = DOCTOR_CONFIG.vitalExtraction;
    const wantChannel = input.wantPrimaryManual || p.autoCastPrimary;
    if (!wantChannel) {
      this.state.vitalTethers = [];
      return;
    }

    const vitalReachStacks = p.buffs.buff_doc_vital_reach || 0;
    const siphonEffStacks = p.buffs.buff_doc_siphon_efficiency || 0;
    const range =
      cfg.range *
      (1 + 0.04 * vitalReachStacks) *
      Math.min(1.35, Math.max(1.0, p.calculatedStats.aoeRadiusMultiplier || 1.0));
    const maxTethers = cfg.baseTetherCount + Math.max(0, p.calculatedStats.extraLmbProjectiles || 0);
    const nearby = this.spatialGrid.getNearby(p.pos, range * 1.1);
    const eligible: Array<{ enemy: EnemyState; score: number }> = [];

    for (let i = 0; i < nearby.length; i++) {
      const cand = nearby[i];
      if (cand.health <= 0) continue;
      const d = Math.hypot(cand.pos.x - p.pos.x, cand.pos.y - p.pos.y);
      if (d > range + cand.radius) continue;
      if (Math.abs(cand.z - p.z) > 240) continue;
      const aimDist = input.wantPrimaryManual && input.mouseWorldPos
        ? Math.hypot(cand.pos.x - input.mouseWorldPos.x, cand.pos.y - input.mouseWorldPos.y)
        : d;
      eligible.push({ enemy: cand, score: aimDist * 0.65 + d * 0.35 });
    }

    if (eligible.length === 0) {
      this.state.vitalTethers = [];
      return;
    }

    eligible.sort((a, b) => a.score - b.score);

    // Map existing tether timers by enemy id so persistent connections keep smooth cadence
    const prevTimers = new Map<string, number>();
    for (let i = 0; i < this.state.vitalTethers.length; i++) {
      const vt = this.state.vitalTethers[i];
      if (!prevTimers.has(vt.targetEnemyId)) {
        prevTimers.set(vt.targetEnemyId, vt.tickTimer);
      }
    }

    const tickCd =
      cfg.tickInterval /
      Math.max(0.5, (p.calculatedStats.lmbAttackSpeedMultiplier || 1.0) * (p.calculatedStats.attackSpeedMultiplier || 1.0));
    const dmgPerTick = cfg.damagePerTick * p.calculatedStats.damageMultiplier;
    const healMult = (p.calculatedStats.healingMultiplier || 1.0) * (1 + 0.04 * siphonEffStacks);
    const activationId = this.allocateDirectAttackActivationId();

    // Pass 1: assign at most 1 tether per distinct enemy while other valid targets exist
    const assignedTargets: EnemyState[] = [];
    for (let i = 0; i < eligible.length && assignedTargets.length < maxTethers; i++) {
      assignedTargets.push(eligible[i].enemy);
    }
    // Pass 2: if fewer eligible enemies than maxTethers (e.g. solo boss), assign overflow tethers
    let wrapIdx = 0;
    while (assignedTargets.length < maxTethers && eligible.length > 0) {
      assignedTargets.push(eligible[wrapIdx % eligible.length].enemy);
      wrapIdx++;
    }

    this.setFacingToward(assignedTargets[0].pos);
    const nextTethers: VitalTetherState[] = [];
    let totalHealThisStep = 0;

    for (let i = 0; i < assignedTargets.length; i++) {
      const target = assignedTargets[i];
      const baseTimer = i < eligible.length ? (prevTimers.get(target.id) ?? 0.04) : (0.04 + i * 0.03);
      let timer = baseTimer - dt;

      if (timer <= 0) {
        timer += tickCd;
        if (target.health > 0) {
          this.damageEnemy(target, dmgPerTick, target.pos, 'medical', {
            isDirectAttack: true,
            isPrimaryLmb: true,
            attackActivationId: activationId
          });
          const healGain = dmgPerTick * cfg.healFractionOfDamage * healMult;
          totalHealThisStep += healGain;
        }
      }

      if (target.health > 0) {
        nextTethers.push({
          id: `tether_${i}_${target.id}`,
          targetEnemyId: target.id,
          targetPos: { x: target.pos.x, y: target.pos.y },
          targetZ: target.z + Math.max(16, target.radius * 0.75),
          tickTimer: timer
        });
      }
    }

    if (totalHealThisStep > 0 && p.health < p.maxHealth) {
      const before = p.health;
      p.health = Math.min(p.maxHealth, p.health + totalHealThisStep);
      if (p.health - before >= 1) {
        this.state.events.push({
          type: 'therapeutic_heal',
          data: { pos: { ...p.pos }, z: p.z, amount: Math.round(p.health - before) }
        });
      }
    }

    this.state.vitalTethers = nextTethers;
  }

  private updateFrostTrails(dt: number): void {
    if (this.state.frostTrails.length === 0) return;
    const alive: FrostTrailState[] = [];
    const chillDur = DOCTOR_CONFIG.cryoScalpel.chillDuration;

    for (let i = 0; i < this.state.frostTrails.length; i++) {
      const trail = this.state.frostTrails[i];
      trail.durationRemaining -= dt;
      if (trail.durationRemaining <= 0) continue;

      const nearby = this.spatialGrid.getNearby(trail.pos, trail.radius + 20);
      for (let j = 0; j < nearby.length; j++) {
        const enemy = nearby[j];
        if (enemy.health <= 0) continue;
        if (Math.abs(enemy.z - trail.z) > 130) continue;
        if (Math.hypot(enemy.pos.x - trail.pos.x, enemy.pos.y - trail.pos.y) <= trail.radius + enemy.radius) {
          this.applyChill(enemy, Math.min(0.6, chillDur));
        }
      }

      alive.push(trail);
    }

    this.state.frostTrails = alive;
  }

  // --- COMMANDER BASE RMB: CROSS SLASH (FORMERLY EXPLOSIVE BOMB) ---
  private fireExplosiveBomb(targetPos: Vector2, targetZ: number = this.state.player.z + 16): void {
    const p = this.state.player;
    const origin = { x: p.pos.x, y: p.pos.y, z: p.z + 56 };
    const dx = targetPos.x - origin.x;
    const dy = targetPos.y - origin.y;
    const horizDist = Math.min(Math.hypot(dx, dy) || 1, p.equippedSkills.secondary.range);
    const angle = Math.atan2(dy, dx);

    const speed = 880 * (p.calculatedStats.projectileSpeedMultiplier || 1.0);
    const flightTime = Math.max(0.18, horizDist / speed);
    const dz = targetZ - origin.z;
    const vz = dz / flightTime;

    const extra = p.calculatedStats.extraRmbProjectiles || 0;
    // Cross Slash Layering:
    // +0: Original Cross Slash (extraLayers = 0)
    // +2: Add another layer of crossing blades ABOVE original (+14 Y) -> extraLayers = 1
    // +4: Add another layer of crossing blades BELOW original (-14 Y) -> extraLayers = 2
    // +5 onward: Additional stacks increase attack's piercing capability
    const extraLayers = extra >= 4 ? 2 : (extra >= 2 ? 1 : 0);
    const pierceCount = extra >= 5 ? 1 + (extra - 4) : 1;
    const radius = 36 * (p.calculatedStats.projectileRadiusMultiplier || 1.0);

    this.setFacingToward(targetPos);

    const proj: ProjectileState = {
      id: `proj_${this.nextProjId++}`,
      type: 'bomb',
      pos: { x: origin.x, y: origin.y },
      z: origin.z,
      velocity: { x: Math.cos(angle) * speed, y: Math.sin(angle) * speed },
      vz,
      speed,
      damage: p.equippedSkills.secondary.baseDamage * p.calculatedStats.damageMultiplier,
      pierceCount,
      maxDistance: horizDist,
      distanceTraveled: 0,
      owner: 'player',
      radius,
      hitEnemyIds: new Set(),
      originZ: origin.z,
      targetZ,
      extraLayers
    };
    this.state.projectiles.push(proj);

    this.state.events.push({
      type: 'wave_fired',
      data: { from: { ...p.pos }, to: targetPos, variant: 'bomb', angle, extraLayers, pierceCount }
    });
  }

  private detonateExplosiveBomb(proj: ProjectileState): void {
    const p = this.state.player;
    const enh = p.skillEnhancements?.secondary;
    let radiusMult = p.calculatedStats.aoeRadiusMultiplier || 1.0;
    if (enh === 'vortex_slashes') {
      radiusMult *= 1.45;
    }
    const blastRadius = 240 * radiusMult;
    const impactZ = proj.z ?? this.state.terrain.calculateHeight(proj.pos.x, proj.pos.y);
    const slashAngle = Math.atan2(proj.velocity.y, proj.velocity.x);
    const slashDmg = proj.damage * (enh === 'seismic_slashes' ? 1.30 : 1.0);

    const victims = this.spatialGrid.getNearby(proj.pos, blastRadius);
    for (let i = 0; i < victims.length; i++) {
      const v = victims[i];
      if (v.health <= 0) continue;
      // Respect terrain elevation difference so slashes don't ignore huge vertical cliffs
      if (Math.abs(v.z - impactZ) > 140) continue;
      const dist = Math.hypot(v.pos.x - proj.pos.x, v.pos.y - proj.pos.y);
      if (dist <= blastRadius + v.radius) {
        this.damageEnemy(v, slashDmg, proj.pos, enh === 'seismic_slashes' ? 'ignite' : enh === 'cryo_slashes' ? 'frost' : 'ignite');
        // Pull enemies INWARD toward the twin-slash convergence center!
        const pullDx = proj.pos.x - v.pos.x;
        const pullDy = proj.pos.y - v.pos.y;
        const pullLen = Math.hypot(pullDx, pullDy) || 1;
        const pullImpulseMult = enh === 'vortex_slashes' ? 1.4 : 1.0;
        const pullImpulse = 420 * Math.min(1.0, (pullLen / blastRadius) + 0.35) * pullImpulseMult;
        if (v.velocity) {
          v.velocity.x += (pullDx / pullLen) * pullImpulse;
          v.velocity.y += (pullDy / pullLen) * pullImpulse;
        }
        const stepIn = Math.min(pullLen * 0.45 * pullImpulseMult, 90);
        v.pos.x += (pullDx / pullLen) * stepIn;
        v.pos.y += (pullDy / pullLen) * stepIn;

        if (enh === 'cryo_slashes') {
          v.isChilled = true;
          v.chillTimer = 3.0;
          v.isStunned = true;
          v.stunTimer = 1.6;
        }
      }
    }

    if (enh === 'cryo_slashes') {
      this.state.events.push({
        type: 'ultimate_cryo_field_spawned',
        data: { pos: { ...proj.pos }, radius: blastRadius * 0.85, duration: 1.8 }
      });
    } else if (enh === 'seismic_slashes') {
      const field: ToxicFieldState = {
        id: `ignite_${Date.now()}_${Math.random().toString(36).substring(2, 6)}`,
        pos: { ...proj.pos },
        z: impactZ,
        radius: blastRadius * 0.85,
        durationRemaining: 2.5,
        maxDuration: 2.5,
        damagePerTick: slashDmg * 0.25,
        tickInterval: 0.5,
        tickTimer: 0.5
      };
      this.state.toxicFields.push(field);
      this.state.events.push({
        type: 'toxic_field_deployed',
        data: { pos: { ...proj.pos }, z: impactZ, radius: field.radius, duration: field.durationRemaining, variant: 'ignite' }
      });
    }

    this.state.events.push({
      type: 'orbital_impact',
      data: { target: { ...proj.pos }, z: impactZ, radius: blastRadius, variant: 'bomb', angle: slashAngle }
    });
  }

  private spawnToxicPuddle(
    pos: Vector2,
    groundZ: number,
    radius: number,
    duration: number,
    damagePerTick: number,
    tickInterval: number,
    variant: 'toxic' | 'ignite' = 'toxic'
  ): void {
    const field: ToxicFieldState = {
      id: `toxic_${Date.now()}_${Math.random().toString(36).substring(2, 6)}`,
      pos: { x: pos.x, y: pos.y },
      z: groundZ,
      radius,
      durationRemaining: duration,
      maxDuration: duration,
      damagePerTick,
      tickInterval,
      tickTimer: 0.05
    };
    this.state.toxicFields.push(field);

    // Bounded puddle count for web performance (evict oldest)
    while (this.state.toxicFields.length > DOCTOR_CONFIG.rmb.maxActiveToxicFields) {
      this.state.toxicFields.shift();
    }

    this.state.events.push({
      type: 'toxic_field_deployed',
      data: { pos: { ...pos }, z: groundZ, radius, duration, variant }
    });
  }

  private launchArcingToxicProjectile(
    type: 'toxic_grenade' | 'cluster_main' | 'cluster_sub',
    origin: { x: number; y: number; z: number },
    targetPos: Vector2,
    speed: number,
    damage: number,
    radius: number
  ): void {
    const dx = targetPos.x - origin.x;
    const dy = targetPos.y - origin.y;
    const horizDist = Math.max(24, Math.hypot(dx, dy));
    const angle = Math.atan2(dy, dx);
    const flightTime = Math.max(0.24, horizDist / speed);
    const groundZ = this.state.terrain.calculateHeight(targetPos.x, targetPos.y);
    const dz = groundZ - origin.z;
    const gravity = 360;
    const vz = dz / flightTime + 0.5 * gravity * flightTime;

    this.state.projectiles.push({
      id: `proj_${this.nextProjId++}`,
      type,
      pos: { x: origin.x, y: origin.y },
      z: origin.z,
      velocity: { x: Math.cos(angle) * speed, y: Math.sin(angle) * speed },
      vz,
      speed,
      damage,
      pierceCount: 1,
      maxDistance: horizDist + 16,
      distanceTraveled: 0,
      owner: 'player',
      radius,
      hitEnemyIds: new Set(),
      originZ: origin.z,
      targetZ: groundZ,
      targetPos: { x: targetPos.x, y: targetPos.y }
    });
  }

  private fireToxicContamination(targetPos: Vector2, _targetZ?: number): void {
    const p = this.state.player;
    const cfg = DOCTOR_CONFIG.rmb;
    const dx = targetPos.x - p.pos.x;
    const dy = targetPos.y - p.pos.y;
    const dist = Math.hypot(dx, dy);
    const clampedDist = Math.min(dist, cfg.range);
    const baseAngle = Math.atan2(dy, dx);
    const count = 1 + (p.calculatedStats.extraRmbProjectiles || 0);
    const spread = count > 1 ? Math.min(0.75, cfg.spreadAngleRad + (count - 2) * 0.08) : 0;
    const speed = cfg.throwSpeed * (p.calculatedStats.projectileSpeedMultiplier || 1.0);
    const damage = cfg.baseDamage * p.calculatedStats.damageMultiplier;
    const radius = 24 * (p.calculatedStats.projectileRadiusMultiplier || 1.0);
    const origin = { x: p.pos.x, y: p.pos.y, z: p.z + 56 };

    this.setFacingToward(targetPos);

    for (let i = 0; i < count; i++) {
      const offset = count > 1 ? -spread / 2 + (spread / (count - 1)) * i : 0;
      const ang = baseAngle + offset;
      const dest = {
        x: p.pos.x + Math.cos(ang) * Math.max(48, clampedDist),
        y: p.pos.y + Math.sin(ang) * Math.max(48, clampedDist)
      };
      this.launchArcingToxicProjectile('toxic_grenade', origin, dest, speed, damage, radius);
    }

    this.state.events.push({
      type: 'grenade_thrown',
      data: { from: { ...p.pos }, to: { ...targetPos }, z: p.z, variant: 'toxic_grenade', count }
    });
  }

  private detonateToxicGrenade(proj: ProjectileState): void {
    const p = this.state.player;
    const cfg = DOCTOR_CONFIG.rmb;
    const radiusMult = p.calculatedStats.aoeRadiusMultiplier || 1.0;
    const durMult = p.calculatedStats.skillDurationMultiplier || 1.0;
    const blastRadius = cfg.detonationRadius * radiusMult;
    const groundZ = this.state.terrain.calculateHeight(proj.pos.x, proj.pos.y);

    const victims = this.spatialGrid.getNearby(proj.pos, blastRadius + 30);
    for (let i = 0; i < victims.length; i++) {
      const v = victims[i];
      if (v.health <= 0) continue;
      if (Math.hypot(v.pos.x - proj.pos.x, v.pos.y - proj.pos.y) <= blastRadius + v.radius) {
        this.damageEnemy(v, proj.damage, proj.pos, 'acid');
        v.toxicSlowTimer = Math.max(v.toxicSlowTimer ?? 0, cfg.slowDuration);
      }
    }

    this.spawnToxicPuddle(
      proj.pos,
      groundZ,
      blastRadius,
      cfg.puddleDuration * durMult,
      cfg.puddleDamagePerTick * p.calculatedStats.damageMultiplier,
      cfg.puddleTickInterval
    );

    this.state.events.push({
      type: 'orbital_impact',
      data: { target: { ...proj.pos }, z: groundZ, radius: blastRadius, variant: 'acid' }
    });
  }

  private reconcileDoctorDrones(): void {
    const p = this.state.player;
    if (p.heroId !== 'doctor' || p.skillEnhancements?.secondary !== 'experimental_drones') {
      this.state.doctorDrones = [];
      return;
    }
    const cfg = DOCTOR_CONFIG.experimentalDrones;
    const targetCount = Math.min(
      cfg.maxDrones,
      cfg.baseDrones + Math.max(0, p.calculatedStats.extraRmbProjectiles || 0)
    );

    while (this.state.doctorDrones.length < targetCount) {
      const idx = this.state.doctorDrones.length;
      const angle = ((Math.PI * 2) / Math.max(1, targetCount)) * idx;
      this.state.doctorDrones.push({
        id: `drone_${Date.now()}_${idx}`,
        index: idx,
        pos: {
          x: p.pos.x + Math.cos(angle) * cfg.orbitRadius,
          y: p.pos.y + Math.sin(angle) * cfg.orbitRadius
        },
        z: p.z + cfg.hoverHeight,
        orbitAngle: angle,
        fireCooldown: 0.15 * idx,
        fireInterval: cfg.fireInterval,
        chargeRatio: 0,
        beamVisualTimer: 0
      });
    }
    if (this.state.doctorDrones.length > targetCount) {
      this.state.doctorDrones.length = targetCount;
    }
    for (let i = 0; i < this.state.doctorDrones.length; i++) {
      this.state.doctorDrones[i].index = i;
    }
  }

  private getDroneEffectiveRange(): number {
    const p = this.state.player;
    const opticsStacks = p.buffs.buff_doc_targeting_optics || 0;
    return DOCTOR_CONFIG.experimentalDrones.targetRange * (1 + 0.05 * opticsStacks);
  }

  private findNearestVisibleDroneTarget(drone: DoctorDroneState, range: number): EnemyState | null {
    const origin3D = { x: drone.pos.x, y: drone.pos.y, z: drone.z };
    const candidates = this.spatialGrid.getNearby(drone.pos, range * 1.05);
    let best: EnemyState | null = null;
    let bestDist = Infinity;
    for (let i = 0; i < candidates.length; i++) {
      const cand = candidates[i];
      if (cand.health <= 0) continue;
      const dist = Math.hypot(cand.pos.x - drone.pos.x, cand.pos.y - drone.pos.y);
      if (dist > range + cand.radius || dist >= bestDist) continue;
      const target3D = { x: cand.pos.x, y: cand.pos.y, z: cand.z + Math.max(12, cand.radius * 0.7) };
      if (!this.state.terrain.checkLineOfSight3D(origin3D, target3D)) continue;
      bestDist = dist;
      best = cand;
    }
    return best;
  }

  private triggerExperimentalDroneVolley(): void {
    this.reconcileDoctorDrones();
    const p = this.state.player;
    const range = this.getDroneEffectiveRange();
    for (let i = 0; i < this.state.doctorDrones.length; i++) {
      const drone = this.state.doctorDrones[i];
      const target = this.findNearestVisibleDroneTarget(drone, range);
      if (target && target.health > 0) {
        this.fireDroneBioBolt(drone, target, 1.35);
      }
      drone.fireCooldown = 0.25;
      drone.chargeRatio = 0;
    }
    this.state.events.push({
      type: 'pulse_fired',
      data: { from: { ...p.pos }, to: { ...p.pos }, z: p.z, variant: 'drone_overcharge' }
    });
  }

  private fireDroneBioBolt(drone: DoctorDroneState, target: EnemyState, dmgScale: number = 1.0): void {
    const p = this.state.player;
    const cfg = DOCTOR_CONFIG.experimentalDrones;
    const effRange = this.getDroneEffectiveRange();
    const payloadStacks = p.buffs.buff_doc_calibrated_payload || 0;
    const payloadMult = 1 + 0.04 * payloadStacks;
    const origin = { x: drone.pos.x, y: drone.pos.y, z: drone.z };
    const targetZ = target.z + Math.max(12, target.radius * 0.7);
    const dx = target.pos.x - origin.x;
    const dy = target.pos.y - origin.y;
    const dz = targetZ - origin.z;
    const dist3D = Math.hypot(dx, dy, dz) || 1;
    const speed = cfg.boltSpeed * (p.calculatedStats.projectileSpeedMultiplier || 1.0);

    this.state.projectiles.push({
      id: `proj_${this.nextProjId++}`,
      type: 'drone_bio_bolt',
      pos: { x: origin.x, y: origin.y },
      z: origin.z,
      velocity: { x: (dx / dist3D) * speed, y: (dy / dist3D) * speed },
      vz: (dz / dist3D) * speed,
      speed,
      damage: cfg.boltDamage * dmgScale * payloadMult * p.calculatedStats.damageMultiplier,
      pierceCount: 1,
      maxDistance: effRange * 1.2,
      distanceTraveled: 0,
      owner: 'player',
      radius: 16 * (p.calculatedStats.projectileRadiusMultiplier || 1.0),
      hitEnemyIds: new Set(),
      originZ: origin.z,
      targetZ
    });

    drone.lastTargetPos = { x: target.pos.x, y: target.pos.y };
    drone.beamVisualTimer = 0.2;
    drone.chargeRatio = 0;
  }

  private updateDoctorDrones(dt: number): void {
    const p = this.state.player;
    if (p.heroId !== 'doctor' || p.skillEnhancements?.secondary !== 'experimental_drones') {
      if (this.state.doctorDrones.length > 0) this.state.doctorDrones = [];
      return;
    }

    this.reconcileDoctorDrones();
    const cfg = DOCTOR_CONFIG.experimentalDrones;
    const effRange = this.getDroneEffectiveRange();
    const count = Math.max(1, this.state.doctorDrones.length);
    const timeBase = this.state.gameTime * 1.45;
    const fireInterval = cfg.fireInterval / Math.max(0.5, p.calculatedStats.attackSpeedMultiplier || 1.0);
    const chargeWindow = Math.min(0.24, fireInterval * 0.42);

    for (let i = 0; i < this.state.doctorDrones.length; i++) {
      const drone = this.state.doctorDrones[i];
      drone.fireInterval = fireInterval;
      const orbitAngle = timeBase + ((Math.PI * 2) / count) * i;
      drone.orbitAngle = orbitAngle;
      const ringRadius = cfg.orbitRadius + (count > 4 ? 12 : 0);
      const goalX = p.pos.x + Math.cos(orbitAngle) * ringRadius;
      const goalY = p.pos.y + Math.sin(orbitAngle) * ringRadius;
      const goalZ = p.z + cfg.hoverHeight + Math.sin(this.state.gameTime * 3.5 + i * 1.3) * 6;

      // Smooth damped following keeps drones clear of Doctor's center sprite
      const lerp = Math.min(1, dt * 8.5);
      drone.pos.x += (goalX - drone.pos.x) * lerp;
      drone.pos.y += (goalY - drone.pos.y) * lerp;
      drone.z += (goalZ - drone.z) * lerp;

      if (drone.beamVisualTimer > 0) {
        drone.beamVisualTimer = Math.max(0, drone.beamVisualTimer - dt);
      }

      if (p.isCarryingEventPayload) continue;

      drone.fireCooldown -= dt;
      if (drone.fireCooldown <= 0) {
        const target = this.findNearestVisibleDroneTarget(drone, effRange);
        if (target && target.health > 0) {
          this.fireDroneBioBolt(drone, target, 1.0);
          drone.fireCooldown = fireInterval;
        } else {
          drone.fireCooldown = 0.15;
          drone.chargeRatio = 0;
        }
      } else if (drone.fireCooldown <= chargeWindow) {
        const aimTarget = this.findNearestVisibleDroneTarget(drone, effRange);
        if (aimTarget && aimTarget.health > 0) {
          drone.lastTargetPos = { x: aimTarget.pos.x, y: aimTarget.pos.y };
          drone.chargeRatio = Math.min(1, Math.max(0, 1 - drone.fireCooldown / chargeWindow));
        } else {
          drone.chargeRatio = 0;
        }
      } else {
        drone.chargeRatio = 0;
      }
    }
  }

  private fireToxicClusterBomb(targetPos: Vector2, _targetZ?: number): void {
    const p = this.state.player;
    const cfg = DOCTOR_CONFIG.toxicClusterBomb;
    const count = Math.min(cfg.maxMainBombs, cfg.baseMainBombs + Math.max(0, p.calculatedStats.extraRmbProjectiles || 0));
    const dx = targetPos.x - p.pos.x;
    const dy = targetPos.y - p.pos.y;
    const baseDist = Math.max(60, Math.min(Math.hypot(dx, dy), DOCTOR_CONFIG.rmb.range));
    const baseAngle = Math.atan2(dy, dx);
    const spread = count > 1 ? Math.min(0.95, 0.34 + (count - 2) * 0.14) : 0;
    const damage = cfg.mainDamage * p.calculatedStats.damageMultiplier;
    const speed = 680 * (p.calculatedStats.projectileSpeedMultiplier || 1.0);
    const origin = { x: p.pos.x, y: p.pos.y, z: p.z + 58 };

    this.setFacingToward(targetPos);

    for (let i = 0; i < count; i++) {
      const offset = count > 1 ? -spread / 2 + (spread / (count - 1)) * i : 0;
      const ang = baseAngle + offset;
      const distJitter = count > 1 ? ((i % 2 === 0 ? 1 : -1) * 48) : 0;
      const d = Math.max(85, baseDist + distJitter);
      const dest = {
        x: p.pos.x + Math.cos(ang) * d,
        y: p.pos.y + Math.sin(ang) * d
      };
      this.launchArcingToxicProjectile('cluster_main', origin, dest, speed, damage, 32);
    }

    this.state.events.push({
      type: 'grenade_thrown',
      data: { from: { ...p.pos }, to: { ...targetPos }, z: p.z, variant: 'toxic_cluster', count }
    });
  }

  private detonateClusterMain(proj: ProjectileState): void {
    const p = this.state.player;
    const cfg = DOCTOR_CONFIG.toxicClusterBomb;
    const radiusMult = p.calculatedStats.aoeRadiusMultiplier || 1.0;
    const blastRadius = 190 * radiusMult;
    const groundZ = this.state.terrain.calculateHeight(proj.pos.x, proj.pos.y);

    const victims = this.spatialGrid.getNearby(proj.pos, blastRadius + 36);
    for (let i = 0; i < victims.length; i++) {
      const v = victims[i];
      if (v.health <= 0) continue;
      if (Math.hypot(v.pos.x - proj.pos.x, v.pos.y - proj.pos.y) <= blastRadius + v.radius) {
        this.damageEnemy(v, proj.damage, proj.pos, 'acid');
      }
    }

    this.state.events.push({
      type: 'cluster_fragmented',
      data: { pos: { ...proj.pos }, z: groundZ, radius: blastRadius, subCount: cfg.subBombsPerMainBomb }
    });

    // Scatter configurable sub-bombs outward across irregular radii/angles
    const subCount = cfg.subBombsPerMainBomb;
    const subDamage = cfg.subDamage * p.calculatedStats.damageMultiplier;
    const subOrigin = { x: proj.pos.x, y: proj.pos.y, z: groundZ + 32 };
    const phaseShift = this.state.rng.range(0, Math.PI * 2);

    for (let s = 0; s < subCount; s++) {
      const baseSlice = phaseShift + ((Math.PI * 2) / subCount) * s;
      const ang = baseSlice + this.state.rng.range(-0.32, 0.32);
      const scatterR =
        this.state.rng.range(cfg.scatterMinRadius, cfg.scatterMaxRadius) *
        Math.max(0.85, Math.min(1.5, radiusMult));
      const dest = {
        x: Math.max(40, Math.min(this.state.worldWidth - 40, proj.pos.x + Math.cos(ang) * scatterR)),
        y: Math.max(40, Math.min(this.state.worldHeight - 40, proj.pos.y + Math.sin(ang) * scatterR))
      };
      this.launchArcingToxicProjectile('cluster_sub', subOrigin, dest, 480, subDamage, 20);
    }
  }

  private detonateClusterSub(proj: ProjectileState): void {
    const p = this.state.player;
    const cfg = DOCTOR_CONFIG.toxicClusterBomb;
    const radiusMult = p.calculatedStats.aoeRadiusMultiplier || 1.0;
    const durMult = p.calculatedStats.skillDurationMultiplier || 1.0;
    const diffusionStacks = p.buffs.buff_doc_toxic_diffusion || 0;
    const corrosiveStacks = p.buffs.buff_doc_corrosive_residue || 0;
    const subRadius = cfg.subPuddleRadius * radiusMult * (1 + 0.04 * diffusionStacks);
    const groundZ = this.state.terrain.calculateHeight(proj.pos.x, proj.pos.y);

    const victims = this.spatialGrid.getNearby(proj.pos, subRadius + 24);
    for (let i = 0; i < victims.length; i++) {
      const v = victims[i];
      if (v.health <= 0) continue;
      if (Math.hypot(v.pos.x - proj.pos.x, v.pos.y - proj.pos.y) <= subRadius + v.radius) {
        this.damageEnemy(v, proj.damage, proj.pos, 'acid');
        v.toxicSlowTimer = Math.max(v.toxicSlowTimer ?? 0, DOCTOR_CONFIG.rmb.slowDuration);
      }
    }

    this.spawnToxicPuddle(
      proj.pos,
      groundZ,
      subRadius,
      (cfg.subPuddleDuration + 0.25 * corrosiveStacks) * durMult,
      cfg.subPuddleDamagePerTick * p.calculatedStats.damageMultiplier,
      cfg.subPuddleTickInterval
    );
  }

  private fireHolographicDecoy(targetPos: Vector2): void {
    const p = this.state.player;
    const cfg = DOCTOR_CONFIG.holographicDecoy;
    const count = cfg.baseDecoys + Math.max(0, p.calculatedStats.extraRmbProjectiles || 0);
    const projIntegStacks = p.buffs.buff_doc_projection_integrity || 0;
    const causticStacks = p.buffs.buff_doc_caustic_reprisal || 0;
    const durMult = (p.calculatedStats.skillDurationMultiplier || 1.0) * (1 + 0.05 * projIntegStacks);
    const radiusMult = p.calculatedStats.aoeRadiusMultiplier || 1.0;

    let dx = targetPos.x - p.pos.x;
    let dy = targetPos.y - p.pos.y;
    if (!Number.isFinite(dx) || !Number.isFinite(dy) || Math.hypot(dx, dy) < 6) {
      const f = this.facingToVector(p.facing);
      const right = this.lastCameraRight || { x: Math.cos(p.cameraYaw), y: -Math.sin(p.cameraYaw) };
      const fwd = this.lastCameraForward || { x: Math.sin(p.cameraYaw), y: Math.cos(p.cameraYaw) };
      dx = f.x * right.x - f.y * fwd.x;
      dy = f.x * right.y - f.y * fwd.y;
    } else {
      this.setFacingToward(targetPos);
    }

    const baseAngle = Math.atan2(dy, dx);
    const spread = count > 1 ? Math.min(Math.PI * 0.75, 0.36 + (count - 2) * 0.14) : 0;

    for (let i = 0; i < count; i++) {
      const offset = count > 1 ? -spread / 2 + (spread / (count - 1)) * i : 0;
      const ang = baseAngle + offset;
      const dirX = Math.cos(ang);
      const dirY = Math.sin(ang);
      const spawnDist = cfg.spawnOffset + (count > 1 ? (i % 2) * 14 : 0);
      const desiredPos = {
        x: Math.max(40, Math.min(this.state.worldWidth - 40, p.pos.x + dirX * spawnDist)),
        y: Math.max(40, Math.min(this.state.worldHeight - 40, p.pos.y + dirY * spawnDist))
      };
      const trav = this.state.terrain.checkTraversable(p.pos, desiredPos, p.z, false, 16);
      const finalPos = trav.newPos;
      const z = this.state.terrain.getElevation(finalPos.x, finalPos.y).height;

      const decoy: HolographicDecoyState = {
        id: `decoy_${Date.now()}_${i}_${Math.random().toString(36).substring(2, 6)}`,
        pos: { x: finalPos.x, y: finalPos.y },
        z,
        moveDir: { x: dirX, y: dirY },
        hitsRemaining: cfg.hitsToDestroy,
        maxHits: cfg.hitsToDestroy,
        durationRemaining: cfg.duration * durMult,
        maxDuration: cfg.duration * durMult,
        tauntRadius: cfg.tauntRadius * Math.min(1.5, Math.max(1.0, radiusMult)),
        explosionRadius: cfg.explosionRadius * radiusMult,
        explosionDamage: cfg.explosionDamage * (1 + 0.04 * causticStacks) * p.calculatedStats.damageMultiplier,
        facing: this.computeCameraFacing(dirX, dirY)
      };
      this.state.holographicDecoys.push(decoy);
      while (this.state.holographicDecoys.length > cfg.maxActiveDecoys) {
        this.state.holographicDecoys.shift();
      }

      this.state.events.push({
        type: 'decoy_spawned',
        data: { from: { ...p.pos }, pos: { ...finalPos }, z, facing: decoy.facing }
      });
    }
  }

  private detonateHolographicDecoy(decoy: HolographicDecoyState): void {
    const p = this.state.player;
    const cfg = DOCTOR_CONFIG.holographicDecoy;
    const radiusMult = p.calculatedStats.aoeRadiusMultiplier || 1.0;
    const durMult = p.calculatedStats.skillDurationMultiplier || 1.0;
    const causticStacks = p.heroId === 'doctor' ? (p.buffs.buff_doc_caustic_reprisal || 0) : 0;

    const victims = this.spatialGrid.getNearby(decoy.pos, decoy.explosionRadius + 24);
    for (let i = 0; i < victims.length; i++) {
      const v = victims[i];
      if (v.health <= 0) continue;
      if (Math.hypot(v.pos.x - decoy.pos.x, v.pos.y - decoy.pos.y) <= decoy.explosionRadius + v.radius) {
        this.damageEnemy(v, decoy.explosionDamage, decoy.pos, 'acid');
        v.toxicSlowTimer = Math.max(v.toxicSlowTimer ?? 0, DOCTOR_CONFIG.rmb.slowDuration);
      }
    }

    this.spawnToxicPuddle(
      decoy.pos,
      decoy.z,
      cfg.puddleRadius * radiusMult,
      cfg.puddleDuration * durMult,
      DOCTOR_CONFIG.rmb.puddleDamagePerTick * (1 + 0.04 * causticStacks) * p.calculatedStats.damageMultiplier,
      DOCTOR_CONFIG.rmb.puddleTickInterval
    );

    this.state.events.push({
      type: 'decoy_detonated',
      data: { pos: { ...decoy.pos }, z: decoy.z, radius: decoy.explosionRadius }
    });
  }

  private updateHolographicDecoys(dt: number): void {
    if (this.state.holographicDecoys.length === 0) return;
    const cfg = DOCTOR_CONFIG.holographicDecoy;
    const alive: HolographicDecoyState[] = [];
    for (let i = 0; i < this.state.holographicDecoys.length; i++) {
      const decoy = this.state.holographicDecoys[i];
      decoy.durationRemaining -= dt;
      if (decoy.hitsRemaining <= 0 || decoy.durationRemaining <= 0) {
        this.detonateHolographicDecoy(decoy);
        continue;
      }

      // Run straight forward along initial heading while sliding cleanly along obstacles
      const stepDist = cfg.runSpeed * dt;
      const wanted = {
        x: Math.max(40, Math.min(this.state.worldWidth - 40, decoy.pos.x + decoy.moveDir.x * stepDist)),
        y: Math.max(40, Math.min(this.state.worldHeight - 40, decoy.pos.y + decoy.moveDir.y * stepDist))
      };
      const trav = this.state.terrain.checkTraversable(decoy.pos, wanted, decoy.z, false, 16);
      decoy.pos.x = trav.newPos.x;
      decoy.pos.y = trav.newPos.y;
      decoy.z = this.state.terrain.getElevation(decoy.pos.x, decoy.pos.y).height;
      decoy.facing = this.computeCameraFacing(decoy.moveDir.x, decoy.moveDir.y);

      alive.push(decoy);
    }
    this.state.holographicDecoys = alive;
  }

  private updateToxicFields(dt: number): void {
    const alive: ToxicFieldState[] = [];

    for (let i = 0; i < this.state.toxicFields.length; i++) {
      const field = this.state.toxicFields[i];
      field.durationRemaining -= dt;
      field.tickTimer -= dt;

      if (field.tickTimer <= 0) {
        field.tickTimer += field.tickInterval;
        const victims = this.spatialGrid.getNearby(field.pos, field.radius);
        for (let j = 0; j < victims.length; j++) {
          const enemy = victims[j];
          if (enemy.health <= 0) continue;
          if (Math.abs(enemy.z - field.z) > 130) continue;
          const d = Math.hypot(enemy.pos.x - field.pos.x, enemy.pos.y - field.pos.y);
          if (d <= field.radius + enemy.radius) {
            this.damageEnemy(enemy, field.damagePerTick, field.pos, 'acid');
            enemy.toxicSlowTimer = Math.max(enemy.toxicSlowTimer ?? 0, DOCTOR_CONFIG.rmb.slowDuration);
          }
        }
      }

      if (field.durationRemaining > 0) {
        alive.push(field);
      }
    }

    this.state.toxicFields = alive;
  }

  private fireSanctuaryCross(centerPos: Vector2): void {
    const p = this.state.player;
    const enh = p.skillEnhancements?.ultimate;
    const radiusMult = (p.calculatedStats.aoeRadiusMultiplier || 1.0) * (p.calculatedStats.ultimateRadiusMultiplier || 1.0);
    const durMult = p.calculatedStats.skillDurationMultiplier || 1.0;
    const healMult = p.calculatedStats.healingMultiplier || 1.0;
    const cfg = DOCTOR_CONFIG.sacredField;

    if (enh === 'rain_of_crosses') {
      const sustainedStacks = p.buffs.buff_doc_sustained_rain || 0;
      const rainDur = DOCTOR_CONFIG.rainOfCrosses.duration + 0.25 * sustainedStacks;
      p.toxicRainTimer = rainDur;
      p.toxicRainTickTimer = DOCTOR_CONFIG.rainOfCrosses.spawnInterval;
      p.toxicRainOrigin = { x: centerPos.x, y: centerPos.y };
      this.spawnRainOfCrossesWave();
      this.state.events.push({
        type: 'rain_crosses_started',
        data: { pos: { ...centerPos }, z: p.z, duration: rainDur, facing: p.facing }
      });
      return;
    }

    const groundZ = this.state.terrain.calculateHeight(centerPos.x, centerPos.y);
    const isMobile = enh === 'mobile_sanctuary';
    const isDivine = enh === 'divine_intervention';

    const armHalfLength = (isMobile ? DOCTOR_CONFIG.mobileSanctuary.armHalfLength : cfg.armHalfLength) * radiusMult;
    const armHalfWidth = (isMobile ? DOCTOR_CONFIG.mobileSanctuary.armHalfWidth : cfg.armHalfWidth) * radiusMult;
    const duration =
      (isDivine
        ? DOCTOR_CONFIG.divineIntervention.crossDuration
        : isMobile
          ? DOCTOR_CONFIG.mobileSanctuary.duration
          : cfg.duration) * durMult;
    const consecratedStacks = isDivine ? (p.buffs.buff_doc_consecrated_cross || 0) : 0;
    const vitalRotationStacks = isMobile ? (p.buffs.buff_doc_vital_rotation || 0) : 0;
    const pulseDamage = cfg.pulseDamage * (1 + 0.04 * consecratedStacks) * p.calculatedStats.damageMultiplier;
    const crossHealPerSec = cfg.healPerSecond * healMult * (1 + 0.04 * (consecratedStacks + vitalRotationStacks));

    const cross: SanctuaryCrossState = {
      id: `cross_${Date.now()}_${Math.random().toString(36).substring(2, 6)}`,
      pos: { x: centerPos.x, y: centerPos.y },
      z: groundZ,
      armHalfLength,
      armHalfWidth,
      durationRemaining: duration,
      maxDuration: duration,
      healPerSecond: crossHealPerSec,
      pulseDamage,
      pulseInterval: cfg.pulseInterval,
      pulseTimer: 0.1,
      rotation: 0,
      rotationSpeed: isMobile ? DOCTOR_CONFIG.mobileSanctuary.rotationSpeedRad : 0,
      isMobile
    };
    this.state.sanctuaryCrosses.push(cross);
    p.inSanctuaryCross = true;
    this.state.updateCalculatedStats();

    if (isDivine) {
      const dCfg = DOCTOR_CONFIG.divineIntervention;
      const celestialStacks = p.buffs.buff_doc_celestial_endurance || 0;
      const angelDur = (dCfg.angelDuration + 0.5 * celestialStacks) * durMult;
      const quadrantAngles = [Math.PI * 0.25, Math.PI * 0.75, Math.PI * 1.25, Math.PI * 1.75];
      const summonedPositions: Array<{ x: number; y: number; z: number }> = [];

      for (let q = 0; q < dCfg.angelCount; q++) {
        const ang = quadrantAngles[q % quadrantAngles.length];
        const offset = {
          x: Math.cos(ang) * dCfg.quadrantOffsetDist,
          y: Math.sin(ang) * dCfg.quadrantOffsetDist
        };
        const ax = Math.max(40, Math.min(this.state.worldWidth - 40, centerPos.x + offset.x));
        const ay = Math.max(40, Math.min(this.state.worldHeight - 40, centerPos.y + offset.y));
        const az = this.state.terrain.calculateHeight(ax, ay) + dCfg.hoverHeight;
        const angel: DivineAngelState = {
          id: `angel_${Date.now()}_${q}`,
          quadrantIndex: q,
          anchorOffset: offset,
          pos: { x: ax, y: ay },
          z: az,
          facing: p.facing,
          durationRemaining: angelDur,
          maxDuration: angelDur,
          fireCooldown: 0.15 + q * 0.12,
          attackAnimTimer: 0
        };
        this.state.divineAngels.push(angel);
        summonedPositions.push({ x: ax, y: ay, z: az });
      }

      this.state.events.push({
        type: 'angel_summoned',
        data: { center: { ...centerPos }, positions: summonedPositions, duration: angelDur }
      });
    }

    this.state.events.push({
      type: 'sanctuary_cross_deployed',
      data: {
        pos: { ...centerPos },
        z: groundZ,
        armHalfLength,
        armHalfWidth,
        duration,
        facing: p.facing,
        variant: enh || 'base'
      }
    });
  }

  private spawnRainOfCrossesWave(): void {
    const p = this.state.player;
    const cfg = DOCTOR_CONFIG.rainOfCrosses;
    const radiusMult = (p.calculatedStats.aoeRadiusMultiplier || 1.0) * (p.calculatedStats.ultimateRadiusMultiplier || 1.0);
    const waveCount =
      cfg.baseCrossesPerWave +
      Math.max(0, (p.calculatedStats.extraLmbProjectiles || 0) + (p.calculatedStats.extraRmbProjectiles || 0));
    const center = p.pos;
    const rainEndGameTime = this.state.gameTime + Math.max(0.05, p.toxicRainTimer ?? 0);

    for (let i = 0; i < waveCount; i++) {
      const ang = this.state.rng.range(0, Math.PI * 2);
      const dist = Math.sqrt(this.state.rng.next()) * cfg.maxSpawnRadius * Math.min(1.4, Math.max(1.0, radiusMult));
      const tx = Math.max(40, Math.min(this.state.worldWidth - 40, center.x + Math.cos(ang) * dist));
      const ty = Math.max(40, Math.min(this.state.worldHeight - 40, center.y + Math.sin(ang) * dist));
      const targetZ = this.state.terrain.calculateHeight(tx, ty);
      this.state.fallingCrosses.push({
        id: `fallcross_${Date.now()}_${Math.random().toString(36).substring(2, 6)}`,
        targetPos: { x: tx, y: ty },
        targetZ,
        z: targetZ + cfg.fallStartHeight + i * 24,
        fallSpeed: cfg.fallSpeed,
        impactDamage: cfg.impactDamage * p.calculatedStats.damageMultiplier,
        impactRadius: cfg.impactRadius * radiusMult,
        fieldHalfLength: cfg.groundCrossHalfLength * radiusMult,
        fieldHalfWidth: cfg.groundCrossHalfWidth * radiusMult,
        rainEndGameTime
      });
    }
  }

  private updateFallingCrosses(dt: number): void {
    if (this.state.fallingCrosses.length === 0) return;
    const p = this.state.player;
    const cfg = DOCTOR_CONFIG.rainOfCrosses;
    const healMult = p.calculatedStats.healingMultiplier || 1.0;
    const alive: FallingCrossState[] = [];

    for (let i = 0; i < this.state.fallingCrosses.length; i++) {
      const fc = this.state.fallingCrosses[i];
      fc.z -= fc.fallSpeed * dt;
      if (fc.z <= fc.targetZ) {
        const victims = this.spatialGrid.getNearby(fc.targetPos, fc.impactRadius + 24);
        for (let v = 0; v < victims.length; v++) {
          const enemy = victims[v];
          if (enemy.health <= 0) continue;
          if (Math.hypot(enemy.pos.x - fc.targetPos.x, enemy.pos.y - fc.targetPos.y) <= fc.impactRadius + enemy.radius) {
            this.damageEnemy(enemy, fc.impactDamage, fc.targetPos, 'medical');
          }
        }

        const remainingRainTime = fc.rainEndGameTime - this.state.gameTime;
        if (remainingRainTime > 0.05) {
          const restStacks = p.buffs.buff_doc_restorative_imprint || 0;
          const restMult = 1 + 0.04 * restStacks;
          this.state.sanctuaryCrosses.push({
            id: `raincross_${Date.now()}_${Math.random().toString(36).substring(2, 6)}`,
            pos: { x: fc.targetPos.x, y: fc.targetPos.y },
            z: fc.targetZ,
            armHalfLength: fc.fieldHalfLength,
            armHalfWidth: fc.fieldHalfWidth,
            durationRemaining: remainingRainTime,
            maxDuration: remainingRainTime,
            healPerSecond: cfg.groundFieldHealPerSecond * healMult * restMult,
            pulseDamage: cfg.groundFieldPulseDamage * restMult * p.calculatedStats.damageMultiplier,
            pulseInterval: cfg.groundFieldPulseInterval,
            pulseTimer: 0.1,
            rotation: this.state.rng.range(-0.35, 0.35),
            isRainField: true
          });
        }

        this.state.events.push({
          type: 'falling_cross_impact',
          data: { pos: { ...fc.targetPos }, z: fc.targetZ, radius: fc.impactRadius }
        });
        continue;
      }
      alive.push(fc);
    }

    this.state.fallingCrosses = alive;
  }

  private updateDivineAngels(dt: number): void {
    if (this.state.divineAngels.length === 0) return;
    const p = this.state.player;
    const cfg = DOCTOR_CONFIG.divineIntervention;
    const fireInterval = cfg.fireInterval / Math.max(0.5, p.calculatedStats.attackSpeedMultiplier || 1.0);
    const alive: DivineAngelState[] = [];

    for (let i = 0; i < this.state.divineAngels.length; i++) {
      const angel = this.state.divineAngels[i];
      angel.durationRemaining -= dt;
      if (angel.durationRemaining <= 0) continue;

      if (angel.attackAnimTimer > 0) {
        angel.attackAnimTimer = Math.max(0, angel.attackAnimTimer - dt);
      }

      // Smoothly maintain 4-quadrant formation around Doctor while hovering gracefully
      const goalX = p.pos.x + angel.anchorOffset.x;
      const goalY = p.pos.y + angel.anchorOffset.y;
      const groundH = this.state.terrain.calculateHeight(angel.pos.x, angel.pos.y);
      const goalZ = Math.max(p.z, groundH) + cfg.hoverHeight + Math.sin(this.state.gameTime * 2.8 + angel.quadrantIndex * 1.57) * 6;
      const followRate = Math.min(1, dt * 4.5);
      angel.pos.x += (goalX - angel.pos.x) * followRate;
      angel.pos.y += (goalY - angel.pos.y) * followRate;
      angel.z += (goalZ - angel.z) * followRate;

      angel.fireCooldown -= dt;
      if (angel.fireCooldown <= 0) {
        const target = this.spatialGrid.findNearest(angel.pos, cfg.targetRange);
        if (target && target.health > 0) {
          const adx = target.pos.x - angel.pos.x;
          const ady = target.pos.y - angel.pos.y;
          angel.facing = Math.abs(adx) > Math.abs(ady) ? (adx > 0 ? 'right' : 'left') : ady > 0 ? 'front' : 'back';
          const targetZ = target.z + Math.max(14, target.radius * 0.75);
          const dz = targetZ - angel.z;
          const dist3D = Math.hypot(adx, ady, dz) || 1;
          const speed = cfg.boltSpeed * (p.calculatedStats.projectileSpeedMultiplier || 1.0);

          this.state.projectiles.push({
            id: `proj_${this.nextProjId++}`,
            type: 'angel_bolt',
            pos: { x: angel.pos.x, y: angel.pos.y },
            z: angel.z,
            velocity: { x: (adx / dist3D) * speed, y: (ady / dist3D) * speed },
            vz: (dz / dist3D) * speed,
            speed,
            damage: cfg.boltDamage * p.calculatedStats.damageMultiplier,
            pierceCount: 1,
            maxDistance: cfg.targetRange * 1.25,
            distanceTraveled: 0,
            owner: 'player',
            radius: 20 * (p.calculatedStats.projectileRadiusMultiplier || 1.0),
            hitEnemyIds: new Set(),
            originZ: angel.z,
            targetZ
          });
          angel.attackAnimTimer = 0.24;
          angel.fireCooldown = fireInterval;
        } else {
          angel.fireCooldown = 0.18;
        }
      }

      alive.push(angel);
    }

    this.state.divineAngels = alive;
  }

  private updateSanctuaryCrosses(dt: number): void {
    const p = this.state.player;
    const alive: SanctuaryCrossState[] = [];
    let playerInsideAny = false;

    for (let i = 0; i < this.state.sanctuaryCrosses.length; i++) {
      const cross = this.state.sanctuaryCrosses[i];
      cross.durationRemaining -= dt;
      cross.pulseTimer -= dt;

      if (cross.isMobile) {
        cross.pos.x = p.pos.x;
        cross.pos.y = p.pos.y;
        cross.z = p.z;
      }
      if (cross.rotationSpeed) {
        cross.rotation = ((cross.rotation ?? 0) + cross.rotationSpeed * dt) % (Math.PI * 2);
      }

      // 1. Heal Doctor inside the cross arms
      if (this.isPointInSanctuaryCross(p.pos, p.z, cross)) {
        playerInsideAny = true;
        if (p.health < p.maxHealth) {
          p.health = Math.min(p.maxHealth, p.health + cross.healPerSecond * dt);
        }
      }

      // 2. Rhythmic medical energy pulse along the cross arms (damage only — no stun)
      if (cross.pulseTimer <= 0) {
        cross.pulseTimer += cross.pulseInterval;
        const candidates = this.spatialGrid.getNearby(cross.pos, cross.armHalfLength + 32);
        for (let j = 0; j < candidates.length; j++) {
          const enemy = candidates[j];
          if (enemy.health <= 0) continue;
          if (this.isPointInSanctuaryCross(enemy.pos, enemy.z, cross, enemy.radius)) {
            this.damageEnemy(enemy, cross.pulseDamage, cross.pos, 'medical');
          }
        }

        if (!cross.isRainField) {
          this.state.events.push({
            type: 'sanctuary_pulse',
            data: {
              pos: { ...cross.pos },
              z: cross.z,
              armHalfLength: cross.armHalfLength,
              armHalfWidth: cross.armHalfWidth,
              rotation: cross.rotation ?? 0
            }
          });
        }
      }

      if (cross.durationRemaining > 0) {
        alive.push(cross);
      }
    }

    this.state.sanctuaryCrosses = alive;
    const prevInCross = !!p.inSanctuaryCross;
    p.inSanctuaryCross = playerInsideAny;
    if (prevInCross !== playerInsideAny) {
      this.state.updateCalculatedStats();
    }
  }

  private fireSedativeDose(targetPos: Vector2, targetZ: number = this.state.player.z + 26): void {
    const p = this.state.player;
    const origin = { x: p.pos.x, y: p.pos.y, z: p.z + 52 };
    const dx = targetPos.x - origin.x;
    const dy = targetPos.y - origin.y;
    const dz = targetZ - origin.z;
    const dist3D = Math.hypot(dx, dy, dz) || 1;
    const angle = Math.atan2(dy, dx);
    const pitch = Math.asin(Math.max(-0.95, Math.min(0.95, dz / dist3D)));

    const speed = 1250 * (p.calculatedStats.projectileSpeedMultiplier || 1.0);
    const horizSpeed = Math.cos(pitch) * speed;
    const vx = Math.cos(angle) * horizSpeed;
    const vy = Math.sin(angle) * horizSpeed;
    const vz = Math.sin(pitch) * speed;
    const radius = 28 * (p.calculatedStats.projectileRadiusMultiplier || 1.0);

    this.setFacingToward(targetPos);

    const proj: ProjectileState = {
      id: `proj_${this.nextProjId++}`,
      type: 'sedative_dart',
      pos: { x: origin.x, y: origin.y },
      z: origin.z,
      velocity: { x: vx, y: vy },
      vz,
      speed,
      damage: p.equippedSkills.secondary.baseDamage * p.calculatedStats.damageMultiplier,
      pierceCount: 1 + (p.calculatedStats.projectilePierce || 0),
      maxDistance: p.equippedSkills.secondary.range * 1.25,
      distanceTraveled: 0,
      owner: 'player',
      radius,
      hitEnemyIds: new Set(),
      originZ: origin.z,
      targetZ
    };
    this.state.projectiles.push(proj);
    this.state.events.push({ type: 'wave_fired', data: { from: { ...p.pos }, to: targetPos, z: p.z, variant: 'sedative' } });
  }

  private fireEmergencyProtocol(playerPos: Vector2): void {
    const p = this.state.player;
    const ultDef = p.equippedSkills.ultimate;
    const healMult = p.calculatedStats.healingMultiplier || 1.0;
    const radiusMult = (p.calculatedStats.aoeRadiusMultiplier || 1.0) * (p.calculatedStats.ultimateRadiusMultiplier || 1.0);
    const durMult = p.calculatedStats.skillDurationMultiplier || 1.0;
    const healAmount = (50 + p.maxHealth * 0.15) * healMult;
    p.health = Math.min(p.maxHealth, p.health + healAmount);

    const radius = 500 * radiusMult;
    const damage = ultDef.baseDamage * p.calculatedStats.damageMultiplier;
    const victims = this.spatialGrid.getNearby(playerPos, radius);

    for (let v = 0; v < victims.length; v++) {
      const enemy = victims[v];
      if (enemy.health > 0) {
        this.damageEnemy(enemy, damage, enemy.pos);
        enemy.isStunned = true;
        enemy.stunTimer = 3.0 * durMult; // 3.0s mass incapacitation
        enemy.velocity.x = 0;
        enemy.velocity.y = 0;
      }
    }

    this.state.events.push({
      type: 'ultimate_fired',
      data: {
        pos: { ...playerPos },
        radius,
        variant: 'emergency_protocol',
        healed: healAmount
      }
    });
  }

  // --- COMMANDER LMB UPGRADE 1: CHILL BEAM ---
  private fireChillBeam(targetPos: Vector2, targetZ: number = this.state.player.z + 26): void {
    const p = this.state.player;
    const origin = { x: p.pos.x, y: p.pos.y, z: p.z + 52 };
    const dx = targetPos.x - origin.x;
    const dy = targetPos.y - origin.y;
    const dz = targetZ - origin.z;
    const dist3D = Math.hypot(dx, dy, dz) || 1;
    const cryoAmpStacks = p.heroId === 'commander' ? (p.buffs.buff_cmd_cryo_amplification || 0) : 0;
    const thermalFocusStacks = p.heroId === 'commander' ? (p.buffs.buff_cmd_thermal_focus || 0) : 0;
    const range = 980 * (1 + 0.04 * thermalFocusStacks);
    const beamHitRadius = 40 * (1 + 0.05 * thermalFocusStacks);
    const nx = dx / dist3D;
    const ny = dy / dist3D;
    const nz = dz / dist3D;
    const endPos = {
      x: origin.x + nx * range,
      y: origin.y + ny * range,
      z: origin.z + nz * range
    };

    this.setFacingToward(targetPos);
    const extra = p.calculatedStats.extraLmbProjectiles || 0;
    const boltCount = 1 + extra;
    const baseDamage = (p.equippedSkills.primary.baseDamage * 1.15) * (1 + 0.03 * cryoAmpStacks) * p.calculatedStats.damageMultiplier;
    const activationId = this.allocateDirectAttackActivationId();
    const chillStrength = 0.50 + 0.02 * cryoAmpStacks;

    // Raycast against all enemies in path
    const candidates = this.spatialGrid.getNearby(p.pos, range);
    for (let c = 0; c < candidates.length; c++) {
      const enemy = candidates[c];
      if (enemy.health <= 0) continue;
      const ex = enemy.pos.x - origin.x;
      const ey = enemy.pos.y - origin.y;
      const proj = ex * nx + ey * ny;
      if (proj >= 0 && proj <= range) {
        const perpX = ex - proj * nx;
        const perpY = ey - proj * ny;
        const distToRay = Math.hypot(perpX, perpY);
        if (distToRay <= enemy.radius + beamHitRadius) {
          this.damageEnemy(enemy, baseDamage * (0.85 + 0.15 * boltCount), enemy.pos, 'ice', {
            isDirectAttack: true,
            attackActivationId: activationId
          });
          enemy.isChilled = true;
          enemy.chillTimer = 3.5;
          enemy.chillStrength = Math.max(enemy.chillStrength ?? 0.50, chillStrength);
        }
      }
    }

    this.state.events.push({
      type: 'chill_beam_fired',
      data: {
        from: { x: origin.x, y: origin.y },
        fromZ: origin.z,
        to: { x: endPos.x, y: endPos.y },
        toZ: endPos.z,
        boltCount
      }
    });
  }

  // --- COMMANDER LMB UPGRADE 2: PIERCING LASER ---
  private firePiercingLaser(targetPos: Vector2, targetZ: number = this.state.player.z + 26): void {
    const p = this.state.player;
    const origin = { x: p.pos.x, y: p.pos.y, z: p.z + 52 };
    const penCoreStacks = p.heroId === 'commander' ? (p.buffs.buff_cmd_penetration_core || 0) : 0;
    const opticsStacks = p.heroId === 'commander' ? (p.buffs.buff_cmd_coherent_optics || 0) : 0;
    const range = 1050 * (1 + 0.03 * opticsStacks);
    const beamHitRadius = 44 * (1 + 0.04 * opticsStacks);

    this.setFacingToward(targetPos);
    const damage = (p.equippedSkills.primary.baseDamage * 1.30) * (1 + 0.02 * penCoreStacks) * p.calculatedStats.damageMultiplier;
    const activationId = this.allocateDirectAttackActivationId();
    const hitEnemyIds = new Set<string>();

    // 1. Find primary targeted enemy near targetPos or along the aiming line
    let primaryEnemy: EnemyState | null = null;
    let minTargetDist = 96;
    const nearTarget = this.spatialGrid.getNearby(targetPos, 110);
    for (let i = 0; i < nearTarget.length; i++) {
      const cand = nearTarget[i];
      if (cand.health <= 0) continue;
      const d = Math.hypot(cand.pos.x - targetPos.x, cand.pos.y - targetPos.y);
      if (d < minTargetDist) {
        minTargetDist = d;
        primaryEnemy = cand;
      }
    }

    const dx = targetPos.x - origin.x;
    const dy = targetPos.y - origin.y;
    const aimDist = Math.hypot(dx, dy) || 1;
    const nx = dx / aimDist;
    const ny = dy / aimDist;

    // If no direct enemy at targetPos, find closest pierced enemy along the forward ray
    if (!primaryEnemy) {
      const candidates = this.spatialGrid.getNearby(p.pos, range);
      let closestProj = Infinity;
      for (let c = 0; c < candidates.length; c++) {
        const enemy = candidates[c];
        if (enemy.health <= 0) continue;
        const ex = enemy.pos.x - origin.x;
        const ey = enemy.pos.y - origin.y;
        const proj = ex * nx + ey * ny;
        if (proj > 0 && proj <= range) {
          const perpX = ex - proj * nx;
          const perpY = ey - proj * ny;
          if (Math.hypot(perpX, perpY) <= enemy.radius + beamHitRadius && proj < closestProj) {
            closestProj = proj;
            primaryEnemy = enemy;
          }
        }
      }
    }

    // 2. Exact 3D target coordinates (locks directly onto enemy's exact center location)
    let endPos: { x: number; y: number; z: number };
    if (primaryEnemy) {
      endPos = {
        x: primaryEnemy.pos.x,
        y: primaryEnemy.pos.y,
        z: primaryEnemy.z + (primaryEnemy.radius || 18) * 0.8
      };
    } else {
      const beamLen = Math.max(80, Math.min(range, aimDist));
      endPos = {
        x: origin.x + nx * beamLen,
        y: origin.y + ny * beamLen,
        z: targetZ
      };
    }

    // 3. Apply damage to primary target
    if (primaryEnemy) {
      this.damageEnemy(primaryEnemy, damage, primaryEnemy.pos, 'lightning', {
        isDirectAttack: true,
        attackActivationId: activationId
      });
      primaryEnemy.isElectrified = true;
      primaryEnemy.electrifiedTimer = 5.0;
      primaryEnemy.electrifiedMultiplier = 1.35;
      hitEnemyIds.add(primaryEnemy.id);
    }

    // Also pierce any intermediate enemies along the beam line between origin and endPos
    const beamDist = Math.hypot(endPos.x - origin.x, endPos.y - origin.y) || 1;
    const bnx = (endPos.x - origin.x) / beamDist;
    const bny = (endPos.y - origin.y) / beamDist;
    const beamCandidates = this.spatialGrid.getNearby(origin, beamDist + 40);
    for (let c = 0; c < beamCandidates.length; c++) {
      const enemy = beamCandidates[c];
      if (enemy.health <= 0 || hitEnemyIds.has(enemy.id)) continue;
      const ex = enemy.pos.x - origin.x;
      const ey = enemy.pos.y - origin.y;
      const proj = ex * bnx + ey * bny;
      if (proj >= 0 && proj <= beamDist + 15) {
        const perpX = ex - proj * bnx;
        const perpY = ey - proj * bny;
        if (Math.hypot(perpX, perpY) <= enemy.radius + beamHitRadius) {
          this.damageEnemy(enemy, damage, enemy.pos, 'lightning', {
            isDirectAttack: true,
            attackActivationId: activationId
          });
          enemy.isElectrified = true;
          enemy.electrifiedTimer = 5.0;
          enemy.electrifiedMultiplier = 1.35;
          hitEnemyIds.add(enemy.id);
        }
      }
    }

    // 4. Branching Lightning: Inherent 2 secondary lightning branches + extra LMB projectiles + Penetration Core (+1 per 2 stacks)
    const extra = p.calculatedStats.extraLmbProjectiles || 0;
    const branchTargetCount = Math.min(6, 2 + extra) + Math.floor(penCoreStacks / 2);
    const branches: Array<{ from: Vector2; fromZ: number; to: Vector2; toZ: number }> = [];

    const branchOrigin = { x: endPos.x, y: endPos.y };
    const branchOriginZ = endPos.z;
    const secondaryCandidates = this.spatialGrid.getNearby(branchOrigin, 500);
    const eligibleEnemies: Array<{ enemy: EnemyState; dist: number }> = [];

    for (let sc = 0; sc < secondaryCandidates.length; sc++) {
      const e = secondaryCandidates[sc];
      if (e.health > 0 && !hitEnemyIds.has(e.id)) {
        const ed = Math.hypot(e.pos.x - branchOrigin.x, e.pos.y - branchOrigin.y);
        if (ed <= 460) {
          eligibleEnemies.push({ enemy: e, dist: ed });
        }
      }
    }

    eligibleEnemies.sort((a, b) => a.dist - b.dist);

    for (let b = 0; b < eligibleEnemies.length && branches.length < branchTargetCount; b++) {
      const entry = eligibleEnemies[b];
      const e = entry.enemy;
      const enemyTargetZ = e.z + (e.radius || 32) * 0.8;

      hitEnemyIds.add(e.id);
      this.damageEnemy(e, damage * 0.75, e.pos, 'lightning');
      e.isElectrified = true;
      e.electrifiedTimer = 4.0;
      e.electrifiedMultiplier = 1.35;

      branches.push({
        from: branchOrigin,
        fromZ: branchOriginZ,
        to: { x: e.pos.x, y: e.pos.y },
        toZ: enemyTargetZ
      });
    }

    // If fewer enemies exist than available branches, discharge wild electric arc forks outward into the area
    while (branches.length < Math.min(2, branchTargetCount)) {
      const angle = (branches.length * 2.1) + ((this.state.rng ? this.state.rng.next() : Math.random()) - 0.5) * 1.2;
      const dist = 140 + branches.length * 65;
      const wildTo = {
        x: branchOrigin.x + Math.cos(angle) * dist,
        y: branchOrigin.y + Math.sin(angle) * dist
      };
      const wildToZ = branchOriginZ + ((this.state.rng ? this.state.rng.next() : Math.random()) - 0.5) * 20;
      branches.push({
        from: branchOrigin,
        fromZ: branchOriginZ,
        to: wildTo,
        toZ: wildToZ
      });
    }

    this.state.events.push({
      type: 'piercing_laser_fired',
      data: {
        from: { x: origin.x, y: origin.y },
        fromZ: origin.z,
        to: { x: endPos.x, y: endPos.y },
        toZ: endPos.z,
        branches
      }
    });
  }

  // --- COMMANDER LMB UPGRADE 3: EXTENDED SLASH ---
  private fireExtendedSlash(targetPos: Vector2, _targetZ: number = this.state.player.z + 26): void {
    const p = this.state.player;
    p.slashComboStep = ((p.slashComboStep ?? 0) % 3) + 1;
    const step = p.slashComboStep;
    const dx = targetPos.x - p.pos.x;
    const dy = targetPos.y - p.pos.y;
    const baseAngle = Math.atan2(dy, dx);
    this.setFacingToward(targetPos);

    const reachStacks = p.heroId === 'commander' ? (p.buffs.buff_cmd_blade_reach || 0) : 0;
    const heavyStacks = p.heroId === 'commander' ? (p.buffs.buff_cmd_heavy_swing || 0) : 0;
    const extra = p.calculatedStats.extraLmbProjectiles || 0;
    const slashCount = 1 + extra;
    const range = (step === 3 ? 700 : 580) * (1 + 0.05 * reachStacks);
    const arcAngle = (step === 3 ? 1.55 : 1.25) * (1 + 0.04 * reachStacks);
    const dmgMult = step === 3 ? 1.6 : 1.15;
    const damage = (p.equippedSkills.primary.baseDamage * dmgMult) * (1 + 0.03 * heavyStacks) * p.calculatedStats.damageMultiplier;
    const activationId = this.allocateDirectAttackActivationId();

    const candidates = this.spatialGrid.getNearby(p.pos, range);
    for (let c = 0; c < candidates.length; c++) {
      const enemy = candidates[c];
      if (enemy.health <= 0) continue;
      if (Math.abs(enemy.z - p.z) > 160) continue;
      const edx = enemy.pos.x - p.pos.x;
      const edy = enemy.pos.y - p.pos.y;
      const edist = Math.hypot(edx, edy);
      if (edist <= range) {
        const enemyAngle = Math.atan2(edy, edx);
        let diff = Math.abs(enemyAngle - baseAngle);
        while (diff > Math.PI) diff = Math.abs(diff - Math.PI * 2);
        if (diff <= arcAngle * 0.5) {
          this.damageEnemy(enemy, damage * (1 + (slashCount - 1) * 0.2), enemy.pos, 'physical', {
            isDirectAttack: true,
            attackActivationId: activationId
          });
          if (step === 3 || slashCount >= 3) {
            enemy.pos.x += Math.cos(baseAngle) * 65;
            enemy.pos.y += Math.sin(baseAngle) * 65;
          }
        }
      }
    }

    this.state.events.push({
      type: 'extended_slash_fired',
      data: { pos: { ...p.pos }, z: p.z + 42, angle: baseAngle, step, range, slashCount }
    });
  }

  // --- COMMANDER RMB UPGRADE 1: SCISSOR SLASH ---
  private fireScissorSlash(targetPos: Vector2, _targetZ: number = this.state.player.z + 26): void {
    const p = this.state.player;
    const dx = targetPos.x - p.pos.x;
    const dy = targetPos.y - p.pos.y;
    const angle = Math.atan2(dy, dx);
    this.setFacingToward(targetPos);

    const twinStacks = p.heroId === 'commander' ? (p.buffs.buff_cmd_twin_edge || 0) : 0;
    const serratedStacks = p.heroId === 'commander' ? (p.buffs.buff_cmd_serrated_cut || 0) : 0;
    const extra = p.calculatedStats.extraRmbProjectiles || 0;
    const totalSlashes = 1 + extra;

    const focusDist = 185;
    const focusPos = {
      x: p.pos.x + Math.cos(angle) * focusDist,
      y: p.pos.y + Math.sin(angle) * focusDist
    };
    const radius = 240;
    const damage = (145 * (1 + (totalSlashes - 1) * 0.25)) * (1 + 0.03 * twinStacks) * p.calculatedStats.damageMultiplier;
    const activationId = this.allocateDirectAttackActivationId();

    const victims = this.spatialGrid.getNearby(focusPos, radius);
    for (let v = 0; v < victims.length; v++) {
      const enemy = victims[v];
      if (enemy.health > 0 && Math.abs(enemy.z - p.z) <= 165) {
        this.damageEnemy(enemy, damage, enemy.pos, 'physical', {
          isDirectAttack: true,
          attackActivationId: activationId
        });
        if (serratedStacks > 0 && enemy.health > 0) {
          const pctRate = enemy.isBoss ? 0.01 * serratedStacks : Math.min(0.04, 0.01 * serratedStacks);
          enemy.bleedDps = Math.max(enemy.bleedDps ?? 0, enemy.health * pctRate);
          enemy.bleedTimer = Math.max(enemy.bleedTimer ?? 0, 2.0);
          if (enemy.bleedTickTimer === undefined) enemy.bleedTickTimer = 0.25;
        }
        const kx = enemy.pos.x - focusPos.x;
        const ky = enemy.pos.y - focusPos.y;
        const klen = Math.hypot(kx, ky) || 1;
        enemy.pos.x += (kx / klen) * 75;
        enemy.pos.y += (ky / klen) * 75;
      }
    }

    this.state.events.push({
      type: 'scissor_slash_fired',
      data: { pos: { ...p.pos }, z: p.z + 42, focusPos, angle, radius, totalSlashes }
    });
  }

  // --- COMMANDER RMB UPGRADE 2: FROST BURST (360-DEGREE RADIAL ICE EXPLOSION) ---
  private fireFrostBurst(): void {
    const p = this.state.player;
    const extra = p.calculatedStats.extraRmbProjectiles || 0;
    const shatterStacks = p.heroId === 'commander' ? (p.buffs.buff_cmd_shatter_nova || 0) : 0;
    const deepFreezeStacks = p.heroId === 'commander' ? (p.buffs.buff_cmd_deep_freeze || 0) : 0;
    const damage = 125 * (1 + 0.03 * shatterStacks) * p.calculatedStats.damageMultiplier;
    const burstRadius = 400 * (1 + 0.05 * shatterStacks);
    const chillDur = 3.5 + 0.2 * deepFreezeStacks;
    const chillStr = 0.50 + 0.03 * deepFreezeStacks;
    const activationId = this.allocateDirectAttackActivationId();

    // 1. Instantaneous radial ice explosion centered on Commander
    const victims = this.spatialGrid.getNearby(p.pos, burstRadius);
    for (let v = 0; v < victims.length; v++) {
      const enemy = victims[v];
      if (enemy.health <= 0) continue;
      const dx = enemy.pos.x - p.pos.x;
      const dy = enemy.pos.y - p.pos.y;
      const dist = Math.hypot(dx, dy);
      if (dist <= burstRadius && Math.abs(enemy.z - p.z) <= 135) {
        this.damageEnemy(enemy, damage, enemy.pos, 'ice', {
          isDirectAttack: true,
          attackActivationId: activationId
        });
        enemy.isChilled = true;
        enemy.chillTimer = Math.max(enemy.chillTimer ?? 0, chillDur);
        enemy.chillStrength = Math.max(enemy.chillStrength ?? 0.50, chillStr);
        const kdist = dist || 1;
        enemy.velocity.x += (dx / kdist) * 420;
        enemy.velocity.y += (dy / kdist) * 420;
      }
    }

    // 2. Extra Projectile Eruptions: Generate additional ice-spike eruptions distributed around cast position
    const spikePositions: Array<{ pos: Vector2; delay: number }> = [];
    if (extra > 0) {
      for (let i = 0; i < extra; i++) {
        const sAngle = (i / extra) * Math.PI * 2 + 0.35;
        const sDist = 155 + ((i * 73) % 105);
        const sPos = {
          x: p.pos.x + Math.cos(sAngle) * sDist,
          y: p.pos.y + Math.sin(sAngle) * sDist
        };
        spikePositions.push({ pos: sPos, delay: 0.05 * (i + 1) });

        const subVictims = this.spatialGrid.getNearby(sPos, 130 * (1 + 0.05 * shatterStacks));
        for (let sv = 0; sv < subVictims.length; sv++) {
          const se = subVictims[sv];
          if (se.health > 0 && Math.abs(se.z - p.z) <= 135) {
            this.damageEnemy(se, damage * 0.45, se.pos, 'ice', {
              isDirectAttack: true,
              attackActivationId: activationId
            });
            se.isChilled = true;
            se.chillTimer = Math.max(se.chillTimer ?? 0, chillDur);
            se.chillStrength = Math.max(se.chillStrength ?? 0.50, chillStr);
          }
        }
      }
    }

    this.state.events.push({
      type: 'frost_burst_fired',
      data: { pos: { ...p.pos }, z: p.z + 36, radius: burstRadius, extraEruptions: extra, spikePositions }
    });
  }

  // --- COMMANDER RMB UPGRADE 3: ORBITING ELECTRIC SWORDS (FULL 360° ORBIT, MAX 7) ---
  private fireOrbitingBlade(): void {
    const p = this.state.player;
    const extra = p.calculatedStats.extraRmbProjectiles || 0;
    const swordCount = Math.min(7, 1 + extra);
    const orbExtStacks = p.heroId === 'commander' ? (p.buffs.buff_cmd_orbital_extension || 0) : 0;
    const razorStacks = p.heroId === 'commander' ? (p.buffs.buff_cmd_razor_satellites || 0) : 0;
    const duration = 12.0 + 0.3 * orbExtStacks;

    p.orbitingBladeActive = true;
    p.orbitingBladeTimer = duration;
    p.orbitingBladeAngle = p.orbitingBladeAngle ?? 0;
    p.orbitingBladeRadius = 164;
    p.orbitingBladeDamage = 34 * (1 + 0.03 * razorStacks) * p.calculatedStats.damageMultiplier;
    p.orbitingSwordCount = swordCount;
    p.orbitingBladeHitCooldowns = {};

    p.floatingSwords = [];
    for (let s = 0; s < swordCount; s++) {
      const sAngle = (p.orbitingBladeAngle ?? 0) + (Math.PI * 2 / swordCount) * s;
      const swX = p.pos.x + Math.cos(sAngle) * 164;
      const swY = p.pos.y + Math.sin(sAngle) * 164;
      const swZ = p.z + 44;
      p.floatingSwords.push({
        x: swX,
        y: swY,
        z: swZ,
        state: 'hover',
        stateTimer: 0,
        attackCooldown: 0.10 * s,
        targetEnemyId: null,
        hitApplied: false
      });
    }

    this.state.events.push({
      type: 'orbiting_blade_summoned',
      data: { duration: 12.0, radius: 164, swordCount }
    });
  }

  private firePrimaryPulse(targetPos: Vector2, targetZ: number = this.state.player.z + 26): void {
    const p = this.state.player;
    const enh = p.skillEnhancements?.primary;
    const origin = { x: p.pos.x, y: p.pos.y, z: p.z + 52 };
    const dx = targetPos.x - origin.x;
    const dy = targetPos.y - origin.y;
    const dz = targetZ - origin.z;
    const dist3D = Math.hypot(dx, dy, dz) || 1;
    const baseAngle = Math.atan2(dy, dx);
    const pitch = Math.asin(Math.max(-0.95, Math.min(0.95, dz / dist3D)));

    let speed = 1150 * (p.calculatedStats.projectileSpeedMultiplier || 1.0);
    let count = 1 + (p.calculatedStats.extraLmbProjectiles || 0);
    let baseSpread = 0.22;
    const radius = 24 * (p.calculatedStats.projectileRadiusMultiplier || 1.0);
    let pierceCount = 1 + (p.calculatedStats.projectilePierce || 0);
    let damage = p.equippedSkills.primary.baseDamage * p.calculatedStats.damageMultiplier;
    const activationId = this.allocateDirectAttackActivationId();

    // Additive Primary Enhancements (Service Pistol remains the base Gold Blaster Bolt)
    if (enh === 'scatter_burst') {
      count = 3 + (p.calculatedStats.extraLmbProjectiles || 0);
      baseSpread = 0.24;
      pierceCount += 1;
    } else if (enh === 'piercing_lance') {
      speed *= 1.40;
      pierceCount += 3;
      damage *= 1.35;
    } else if (enh === 'rapid_gatling') {
      count = Math.max(2, count);
      baseSpread = 0.06;
    }

    const maxSpread = baseSpread * 2.5; // 0.55 rad (2.5x max limit)
    const spread = count > 1 ? Math.min(maxSpread, baseSpread + (count - 2) * 0.0825) : 0;

    this.setFacingToward(targetPos);

    const primaryCd =
      p.equippedSkills.primary.cooldown /
      Math.max(0.1, (p.calculatedStats.lmbAttackSpeedMultiplier || 1.0) * (p.calculatedStats.attackSpeedMultiplier || 1.0));
    const attackAnimDuration = Math.max(0.08, Math.min(0.28, primaryCd * 0.85));
    const attackFps = 4 / attackAnimDuration;
    const fireFrameDelay = p.heroId === 'commander' ? attackAnimDuration * 0.5 : 0;

    for (let i = 0; i < count; i++) {
      const offset = count > 1 ? -spread / 2 + (spread / (count - 1)) * i : 0;
      const angle = baseAngle + offset;
      const horizSpeed = Math.cos(pitch) * speed;
      const vx = Math.cos(angle) * horizSpeed;
      const vy = Math.sin(angle) * horizSpeed;
      const vz = Math.sin(pitch) * speed;
      const muzzleDist = 28;

      const proj: ProjectileState = {
        id: `proj_${this.nextProjId++}`,
        type: 'pulse',
        pos: { x: origin.x + Math.cos(angle) * muzzleDist, y: origin.y + Math.sin(angle) * muzzleDist },
        z: origin.z,
        velocity: { x: vx, y: vy },
        vz,
        speed,
        damage,
        pierceCount,
        maxDistance: p.equippedSkills.primary.range * 1.2,
        distanceTraveled: 0,
        owner: 'player',
        radius,
        hitEnemyIds: new Set(),
        originZ: origin.z,
        targetZ,
        spawnDelayRemaining: fireFrameDelay > 0 ? fireFrameDelay : undefined,
        muzzleOffset: { x: Math.cos(angle) * muzzleDist, y: Math.sin(angle) * muzzleDist },
        attackActivationId: activationId,
        isDirectAttack: true
      };
      this.state.projectiles.push(proj);
    }
    this.state.events.push({
      type: 'pulse_fired',
      data: {
        from: { ...p.pos },
        to: targetPos,
        z: p.z,
        facing: p.facing,
        duration: attackAnimDuration,
        fps: attackFps,
        fireDelay: fireFrameDelay
      }
    });
  }

  private fireScatterBlaster(targetPos: Vector2, targetZ: number = this.state.player.z + 26): void {
    const p = this.state.player;
    const origin = { x: p.pos.x, y: p.pos.y, z: p.z + 52 };
    const dx = targetPos.x - origin.x;
    const dy = targetPos.y - origin.y;
    const dz = targetZ - origin.z;
    const dist3D = Math.hypot(dx, dy, dz) || 1;
    const baseAngle = Math.atan2(dy, dx);
    const pitch = Math.asin(Math.max(-0.95, Math.min(0.95, dz / dist3D)));

    const speed = 1180 * (p.calculatedStats.projectileSpeedMultiplier || 1.0);
    const pellets = 5 + (p.calculatedStats.extraLmbProjectiles || 0);
    const baseSpread = 0.42;
    const maxSpread = baseSpread * 2.5; // 1.05 rad (2.5x max limit)
    const spreadAngle = pellets > 5 ? Math.min(maxSpread, baseSpread + (pellets - 5) * 0.126) : baseSpread;
    const radius = 22 * (p.calculatedStats.projectileRadiusMultiplier || 1.0);
    const pierceCount = 2 + (p.calculatedStats.projectilePierce || 0);

    this.setFacingToward(targetPos);

    for (let i = 0; i < pellets; i++) {
      const offset = pellets > 1 ? -spreadAngle / 2 + (spreadAngle / (pellets - 1)) * i : 0;
      const vJitter = (this.state.rng.next() - 0.5) * 0.12;
      const angle = baseAngle + offset;
      const pelletPitch = Math.max(-0.95, Math.min(0.95, pitch + vJitter));
      const horizSpeed = Math.cos(pelletPitch) * speed;
      const vx = Math.cos(angle) * horizSpeed;
      const vy = Math.sin(angle) * horizSpeed;
      const vz = Math.sin(pelletPitch) * speed;

      const proj: ProjectileState = {
        id: `proj_${this.nextProjId++}`,
        type: 'scatter',
        element: 'ignite',
        pos: { x: origin.x, y: origin.y },
        z: origin.z,
        velocity: { x: vx, y: vy },
        vz,
        speed,
        damage: p.equippedSkills.primary.baseDamage * p.calculatedStats.damageMultiplier,
        pierceCount,
        maxDistance: p.equippedSkills.primary.range * 1.05,
        distanceTraveled: 0,
        owner: 'player',
        radius,
        hitEnemyIds: new Set(),
        originZ: origin.z,
        targetZ
      };
      this.state.projectiles.push(proj);
    }
    this.state.events.push({
      type: 'scatter_fired',
      data: { from: { ...p.pos }, to: targetPos, z: p.z }
    });
  }

  private fireArcCannon(targetPos: Vector2): void {
    const p = this.state.player;
    this.setFacingToward(targetPos);

    const baseDamage = p.equippedSkills.primary.baseDamage * p.calculatedStats.damageMultiplier;
    const maxJumps = 4 + (p.calculatedStats.projectilePierce || 0);
    const arcCount = 1 + (p.calculatedStats.extraLmbProjectiles || 0);
    const hitIds = new Set<string>();

    const origin3D = { x: p.pos.x, y: p.pos.y, z: p.z + 52 };
    const candidates = this.spatialGrid
      .getNearby(p.pos, p.equippedSkills.primary.range * 1.15)
      .filter(e => {
        if (e.health <= 0) return false;
        const eCenter = { x: e.pos.x, y: e.pos.y, z: e.z + e.radius * 0.8 };
        return this.state.terrain.checkLineOfSight3D(origin3D, eCenter);
      })
      .sort((a, b) => {
        const da = Math.hypot(a.pos.x - targetPos.x, a.pos.y - targetPos.y);
        const db = Math.hypot(b.pos.x - targetPos.x, b.pos.y - targetPos.y);
        return da - db;
      });

    if (candidates.length === 0) {
      const dx = targetPos.x - p.pos.x;
      const dy = targetPos.y - p.pos.y;
      const dist = Math.hypot(dx, dy) || 1;
      const endPos = {
        x: p.pos.x + (dx / dist) * Math.min(dist, p.equippedSkills.primary.range),
        y: p.pos.y + (dy / dist) * Math.min(dist, p.equippedSkills.primary.range)
      };
      this.state.events.push({
        type: 'chain_spark',
        data: { from: { ...p.pos }, to: endPos, damage: 0 }
      });
      return;
    }

    // Fire distinct arc lightning chains for each extra projectile
    for (let a = 0; a < arcCount && a < candidates.length; a++) {
      let currentOrigin: Vector2 = { x: p.pos.x, y: p.pos.y };
      let currentTarget: EnemyState | undefined = candidates[a];

      for (let jump = 0; jump < maxJumps && currentTarget; jump++) {
        hitIds.add(currentTarget.id);
        const jumpDamage = Math.round(baseDamage * Math.pow(0.9, jump));
        this.damageEnemy(currentTarget, jumpDamage, currentTarget.pos, 'lightning');

        this.state.events.push({
          type: 'chain_spark',
          data: {
            from: { ...currentOrigin },
            to: { ...currentTarget.pos },
            damage: jumpDamage
          }
        });

        currentOrigin = { ...currentTarget.pos };
        const nextNearby = this.spatialGrid
          .getNearby(currentOrigin, 500)
          .filter(e => e.health > 0 && !hitIds.has(e.id))
          .sort((x, y) => {
            const da = Math.hypot(x.pos.x - currentOrigin.x, x.pos.y - currentOrigin.y);
            const db = Math.hypot(y.pos.x - currentOrigin.x, y.pos.y - currentOrigin.y);
            return da - db;
          });

        currentTarget = nextNearby[0];
      }
    }
  }

  private fireHyperBeam(targetPos: Vector2): void {
    const p = this.state.player;
    const dx = targetPos.x - p.pos.x;
    const dy = targetPos.y - p.pos.y;
    const baseAngle = Math.atan2(dy, dx);
    const beamLength = p.equippedSkills.primary.range * 1.15;
    const beamWidth = 48 * (p.calculatedStats.projectileRadiusMultiplier || 1.0);
    const beamDamage = p.equippedSkills.primary.baseDamage * p.calculatedStats.damageMultiplier;
    const beamCount = 1 + (p.calculatedStats.extraLmbProjectiles || 0);
    const baseSpread = 0.20;
    const maxSpread = baseSpread * 2.5; // 0.50 rad (2.5x max limit)
    const spread = beamCount > 1 ? Math.min(maxSpread, baseSpread + (beamCount - 2) * 0.075) : 0;

    this.setFacingToward(targetPos);

    for (let b = 0; b < beamCount; b++) {
      const offset = beamCount > 1 ? -spread / 2 + (spread / (beamCount - 1)) * b : 0;
      const angle = baseAngle + offset;
      const dirX = Math.cos(angle);
      const dirY = Math.sin(angle);
      const endPos: Vector2 = {
        x: p.pos.x + dirX * beamLength,
        y: p.pos.y + dirY * beamLength
      };

      // Hit all enemies intersecting the laser beam corridor
      for (let i = 0; i < this.state.enemies.length; i++) {
        const enemy = this.state.enemies[i];
        if (enemy.health <= 0) continue;

        const ex = enemy.pos.x - p.pos.x;
        const ey = enemy.pos.y - p.pos.y;
        const projLen = ex * dirX + ey * dirY;
        if (projLen < -10 || projLen > beamLength + enemy.radius) continue;

        const perpDist = Math.abs(ex * -dirY + ey * dirX);
        if (perpDist <= beamWidth + enemy.radius) {
          this.damageEnemy(enemy, beamDamage, enemy.pos, 'beam');
          if (
            p.calculatedStats.chainSparkChance > 0 &&
            this.state.rng.next() < p.calculatedStats.chainSparkChance
          ) {
            this.triggerChainSpark(enemy);
          }
        }
      }

      this.state.events.push({
        type: 'beam_fired',
        data: { from: { ...p.pos }, to: endPos, z: p.z, width: beamWidth }
      });
    }
  }

  private fireGatlingMinigun(targetPos: Vector2, targetZ: number = this.state.player.z + 26): void {
    const p = this.state.player;
    const origin = { x: p.pos.x, y: p.pos.y, z: p.z + 52 };
    const dx = targetPos.x - origin.x;
    const dy = targetPos.y - origin.y;
    const dz = targetZ - origin.z;
    const dist3D = Math.hypot(dx, dy, dz) || 1;
    const baseAngle = Math.atan2(dy, dx);
    const pitch = Math.asin(Math.max(-0.95, Math.min(0.95, dz / dist3D)));

    const speed = 1580 * (p.calculatedStats.projectileSpeedMultiplier || 1.0);
    const count = 2 + (p.calculatedStats.extraLmbProjectiles || 0);
    const baseWidth = 18;
    const maxWidth = baseWidth * 2.5; // 45 units (2.5x max limit)
    const currentWidth = count > 2 ? Math.min(maxWidth, baseWidth + (count - 2) * 5.4) : baseWidth;
    const lateralSpacing = count > 1 ? currentWidth / (count - 1) : 0;
    const perpX = -Math.sin(baseAngle);
    const perpY = Math.cos(baseAngle);
    const radius = 18 * (p.calculatedStats.projectileRadiusMultiplier || 1.0);
    const pierceCount = 1 + (p.calculatedStats.projectilePierce || 0);

    this.setFacingToward(targetPos);

    for (let i = 0; i < count; i++) {
      const lateral = (i - (count - 1) / 2) * lateralSpacing;
      const jitterH = (this.state.rng.next() - 0.5) * 0.08;
      const jitterV = (this.state.rng.next() - 0.5) * 0.06;
      const angle = baseAngle + jitterH;
      const shotPitch = Math.max(-0.95, Math.min(0.95, pitch + jitterV));
      const horizSpeed = Math.cos(shotPitch) * speed;
      const vx = Math.cos(angle) * horizSpeed;
      const vy = Math.sin(angle) * horizSpeed;
      const vz = Math.sin(shotPitch) * speed;

      const proj: ProjectileState = {
        id: `proj_${this.nextProjId++}`,
        type: 'gatling',
        pos: { x: origin.x + perpX * lateral, y: origin.y + perpY * lateral },
        z: origin.z,
        velocity: { x: vx, y: vy },
        vz,
        speed,
        damage: p.equippedSkills.primary.baseDamage * p.calculatedStats.damageMultiplier,
        pierceCount,
        maxDistance: p.equippedSkills.primary.range * 1.15,
        distanceTraveled: 0,
        owner: 'player',
        radius,
        hitEnemyIds: new Set(),
        originZ: origin.z,
        targetZ
      };
      this.state.projectiles.push(proj);
    }
    this.state.events.push({ type: 'pulse_fired', data: { from: { ...p.pos }, to: targetPos, z: p.z } });
  }

  private firePiercingWave(targetPos: Vector2, targetZ: number = this.state.player.z + 26): void {
    const p = this.state.player;
    const origin = { x: p.pos.x, y: p.pos.y, z: p.z + 52 };
    const dx = targetPos.x - origin.x;
    const dy = targetPos.y - origin.y;
    const dz = targetZ - origin.z;
    const dist3D = Math.hypot(dx, dy, dz) || 1;
    const baseAngle = Math.atan2(dy, dx);
    const pitch = Math.asin(Math.max(-0.95, Math.min(0.95, dz / dist3D)));

    const speed = 920 * (p.calculatedStats.projectileSpeedMultiplier || 1.0);
    const waveCount = 1 + (p.calculatedStats.extraRmbProjectiles || 0);
    const baseSpread = 0.28;
    const maxSpread = 0.70;
    const spread = waveCount > 1 ? Math.min(maxSpread, baseSpread + (waveCount - 2) * 0.10) : 0;
    const radius = 50 * (p.calculatedStats.projectileRadiusMultiplier || 1.0);
    const pierceCount = 8 + (p.calculatedStats.projectilePierce || 0);

    this.setFacingToward(targetPos);

    for (let w = 0; w < waveCount; w++) {
      const offset = waveCount > 1 ? -spread / 2 + (spread / (waveCount - 1)) * w : 0;
      const angle = baseAngle + offset;
      const horizSpeed = Math.cos(pitch) * speed;
      const vx = Math.cos(angle) * horizSpeed;
      const vy = Math.sin(angle) * horizSpeed;
      const vz = Math.sin(pitch) * speed;

      const proj: ProjectileState = {
        id: `proj_${this.nextProjId++}`,
        type: 'wave',
        pos: { x: origin.x, y: origin.y },
        z: origin.z,
        velocity: { x: vx, y: vy },
        vz,
        speed,
        damage: p.equippedSkills.secondary.baseDamage * p.calculatedStats.damageMultiplier,
        pierceCount,
        maxDistance: p.equippedSkills.secondary.range * 1.25,
        distanceTraveled: 0,
        owner: 'player',
        radius,
        hitEnemyIds: new Set(),
        originZ: origin.z,
        targetZ
      };

      this.state.projectiles.push(proj);
    }

    this.state.events.push({ type: 'wave_fired', data: { from: { ...p.pos }, to: targetPos, z: p.z } });
  }

  private fireCryoGrenade(targetPos: Vector2, targetZ: number = this.state.player.z): void {
    const p = this.state.player;
    const origin = { x: p.pos.x, y: p.pos.y, z: p.z + 52 };
    const dx = targetPos.x - origin.x;
    const dy = targetPos.y - origin.y;
    const dz = targetZ - origin.z;
    const dist2D = Math.hypot(dx, dy) || 1;
    const baseSpeed = 740 * (p.calculatedStats.projectileSpeedMultiplier || 1.0);
    const travelDist = Math.min(dist2D, p.equippedSkills.secondary.range);
    const timeToTarget = travelDist / baseSpeed;
    const gravity = 360;
    const grenadeCount = 1 + (p.calculatedStats.extraRmbProjectiles || 0);
    const baseAngle = Math.atan2(dy, dx);
    const baseSpread = 0.20;
    const spread = grenadeCount > 1 ? Math.min(0.50, baseSpread + (grenadeCount - 2) * 0.08) : 0;
    const radius = 34 * (p.calculatedStats.projectileRadiusMultiplier || 1.0);

    this.setFacingToward(targetPos);

    for (let g = 0; g < grenadeCount; g++) {
      const offset = grenadeCount > 1 ? -spread / 2 + (spread / (grenadeCount - 1)) * g : 0;
      const angle = baseAngle + offset;
      const vx = Math.cos(angle) * baseSpeed;
      const vy = Math.sin(angle) * baseSpeed;
      const vz = (dz / timeToTarget) + 0.5 * gravity * timeToTarget;

      const proj: ProjectileState = {
        id: `proj_${this.nextProjId++}`,
        type: 'grenade',
        pos: { x: origin.x, y: origin.y },
        z: origin.z,
        velocity: { x: vx, y: vy },
        vz,
        speed: baseSpeed,
        damage: p.equippedSkills.secondary.baseDamage * p.calculatedStats.damageMultiplier,
        pierceCount: 99,
        maxDistance: travelDist,
        distanceTraveled: 0,
        owner: 'player',
        radius,
        hitEnemyIds: new Set(),
        originZ: origin.z,
        targetZ
      };
      this.state.projectiles.push(proj);
    }
    this.state.events.push({ type: 'wave_fired', data: { from: { ...p.pos }, to: targetPos, z: p.z } });
  }

  private fireGravityVortex(targetPos: Vector2, targetZ: number = this.state.player.z + 26): void {
    const p = this.state.player;
    const origin = { x: p.pos.x, y: p.pos.y, z: p.z + 52 };
    const dx = targetPos.x - origin.x;
    const dy = targetPos.y - origin.y;
    const dz = targetZ - origin.z;
    const dist3D = Math.hypot(dx, dy, dz) || 1;
    const speed = 480;

    this.setFacingToward(targetPos);

    const vx = (dx / dist3D) * speed;
    const vy = (dy / dist3D) * speed;
    const vz = (dz / dist3D) * speed;

    const proj: ProjectileState = {
      id: `proj_${this.nextProjId++}`,
      type: 'vortex',
      pos: { x: origin.x, y: origin.y },
      z: origin.z,
      velocity: { x: vx, y: vy },
      vz,
      speed,
      damage: p.equippedSkills.secondary.baseDamage * p.calculatedStats.damageMultiplier,
      pierceCount: 16,
      maxDistance: p.equippedSkills.secondary.range * 1.3,
      distanceTraveled: 0,
      owner: 'player',
      radius: 54,
      hitEnemyIds: new Set(),
      originZ: origin.z,
      targetZ
    };
    this.state.projectiles.push(proj);
    this.state.events.push({ type: 'wave_fired', data: { from: { ...p.pos }, to: targetPos, z: p.z } });
  }

  private fireCarpetNuke(targetPos: Vector2): void {
    const p = this.state.player;
    const radius = Math.round(360 * p.calculatedStats.ultimateRadiusMultiplier);
    const offsets = [
      { x: 0, y: 0 },
      { x: -220, y: -220 },
      { x: 220, y: -220 },
      { x: -220, y: 220 },
      { x: 220, y: 220 }
    ];

    offsets.forEach((off, i) => {
      const strike: OrbitalStrikeState = {
        id: `strike_${this.nextStrikeId++}`,
        targetPos: { x: targetPos.x + off.x, y: targetPos.y + off.y },
        delayRemaining: 0.15 + i * 0.14,
        radius,
        damage: (p.equippedSkills.ultimate.baseDamage * 0.65) * p.calculatedStats.damageMultiplier,
        hasStruck: false,
        durationRemaining: 0.75,
        variant: 'nuke'
      };
      this.state.orbitalStrikes.push(strike);
    });

    this.state.events.push({
      type: 'ultimate_fired',
      data: { target: targetPos, radius: radius * 1.6, variant: 'nuke' }
    });
  }

  private fireOrbitalLance(targetPos: Vector2): void {
    const p = this.state.player;
    const expandedRadius = Math.round(680 * p.calculatedStats.ultimateRadiusMultiplier);

    const strike: OrbitalStrikeState = {
      id: `strike_${this.nextStrikeId++}`,
      targetPos: { ...targetPos },
      delayRemaining: 0.15,
      radius: expandedRadius,
      damage: p.equippedSkills.ultimate.baseDamage * p.calculatedStats.damageMultiplier,
      hasStruck: false,
      durationRemaining: 1.1,
      variant: 'lance'
    };

    this.state.orbitalStrikes.push(strike);
    this.state.events.push({
      type: 'ultimate_fired',
      data: { target: targetPos, radius: expandedRadius, variant: 'lance' }
    });
  }

  private fireJudgementSingularity(targetPos: Vector2): void {
    const p = this.state.player;
    const expandedRadius = Math.round(460 * p.calculatedStats.ultimateRadiusMultiplier);

    const strike: OrbitalStrikeState = {
      id: `strike_${this.nextStrikeId++}`,
      targetPos: { ...targetPos },
      delayRemaining: 0.20,
      radius: expandedRadius,
      damage: p.equippedSkills.ultimate.baseDamage * p.calculatedStats.damageMultiplier,
      hasStruck: false,
      // Explode 1.5s sooner: reduced from 3.2s to 1.7s
      durationRemaining: 1.7,
      dotTimer: 0.18,
      hasExploded: false,
      variant: 'singularity'
    };

    this.state.orbitalStrikes.push(strike);
    this.state.events.push({
      type: 'ultimate_fired',
      data: { target: targetPos, radius: expandedRadius, variant: 'singularity' }
    });
  }

  private fireChronoStasis(targetPos: Vector2): void {
    const p = this.state.player;
    const expandedRadius = Math.round(620 * p.calculatedStats.ultimateRadiusMultiplier);

    const strike: OrbitalStrikeState = {
      id: `strike_${this.nextStrikeId++}`,
      targetPos: { ...targetPos },
      delayRemaining: 0.15,
      radius: expandedRadius,
      damage: p.equippedSkills.ultimate.baseDamage * p.calculatedStats.damageMultiplier,
      hasStruck: false,
      durationRemaining: 1.0,
      variant: 'chrono'
    };

    this.state.orbitalStrikes.push(strike);
    this.state.events.push({
      type: 'ultimate_fired',
      data: { target: targetPos, radius: expandedRadius, variant: 'chrono' }
    });
  }

  private fireOrbitalJudgment(targetPos: Vector2): void {
    const p = this.state.player;
    // Massive ground shockwave radius (480 base scaled for 2x entities, scaling with Area Amplifier buffs)
    const expandedRadius = Math.round(480 * p.calculatedStats.ultimateRadiusMultiplier);
    const enhancement = p.skillEnhancements?.ultimate;

    // 6-frame Ultimate cast sequence at 10 FPS (0.60s total):
    // Frame 4 (0.40s): Downward Command -> Orbital Strike Impact & Damage!
    const strikeDelay = 0.40;
    const lockedPos: Vector2 = { x: targetPos.x, y: targetPos.y };

    let durationRemaining = 0.65;
    let dotTimer: number | undefined = undefined;
    let subStrikes: Vector2[] | undefined = undefined;

    if (enhancement === 'singularity') {
      const gravStacks = p.heroId === 'commander' ? (p.buffs.buff_cmd_gravitational_pull || 0) : 0;
      durationRemaining = 2.80 * (1 + 0.03 * gravStacks);
      dotTimer = 0.25;
    } else if (enhancement === 'convergence_barrage') {
      // 4 balanced outer orbital strikes in a symmetric ring around the central strike
      const ringDist = Math.round(330 * p.calculatedStats.ultimateRadiusMultiplier);
      const angles = [Math.PI * 0.25, Math.PI * 0.75, Math.PI * 1.25, Math.PI * 1.75];
      subStrikes = angles.map((ang) => ({
        x: lockedPos.x + Math.cos(ang) * ringDist,
        y: lockedPos.y + Math.sin(ang) * ringDist
      }));
      durationRemaining = 0.95;
    } else if (enhancement === 'cryogenic_impact') {
      const permafrostStacks = p.heroId === 'commander' ? (p.buffs.buff_cmd_permafrost_field || 0) : 0;
      durationRemaining = 3.10 + 0.3 * permafrostStacks;
      dotTimer = 0.44;
    }

    const salvoStacks = enhancement === 'convergence_barrage' && p.heroId === 'commander' ? (p.buffs.buff_cmd_concentrated_salvo || 0) : 0;
    const subzeroStacks = enhancement === 'cryogenic_impact' && p.heroId === 'commander' ? (p.buffs.buff_cmd_subzero_detonation || 0) : 0;
    const ultDmgMult = 1 + 0.03 * (salvoStacks + subzeroStacks);

    const strike: OrbitalStrikeState = {
      id: `strike_${this.nextStrikeId++}`,
      targetPos: lockedPos,
      delayRemaining: strikeDelay,
      radius: expandedRadius,
      damage: p.equippedSkills.ultimate.baseDamage * ultDmgMult * p.calculatedStats.damageMultiplier,
      hasStruck: false,
      durationRemaining,
      variant: 'judgment',
      enhancement,
      subStrikes,
      hitEnemyIds: new Set<string>(),
      dotTimer,
      hasExploded: false
    };

    this.state.orbitalStrikes.push(strike);
    this.state.events.push({
      type: 'ultimate_fired',
      data: {
        target: lockedPos,
        pos: lockedPos,
        radius: expandedRadius,
        variant: 'judgment',
        enhancement,
        subStrikes,
        facing: p.facing,
        duration: 0.60,
        fps: 10,
        strikeDelay
      }
    });
  }

  private updateProjectiles(dt: number): void {
    const p = this.state.player;
    const alive: ProjectileState[] = [];
    let pistolReleaseEmittedThisTick = false;

    for (let i = 0; i < this.state.projectiles.length; i++) {
      const proj = this.state.projectiles[i];

      // Synchronize pistol projectile launch with Frame 2 (Firing Frame / Muzzle Flash)
      if (proj.spawnDelayRemaining && proj.spawnDelayRemaining > 0) {
        proj.spawnDelayRemaining -= dt;
        const mOffX = proj.muzzleOffset ? proj.muzzleOffset.x : 0;
        const mOffY = proj.muzzleOffset ? proj.muzzleOffset.y : 0;
        proj.pos.x = p.pos.x + mOffX;
        proj.pos.y = p.pos.y + mOffY;
        proj.z = p.z + 52;
        if (proj.spawnDelayRemaining > 0) {
          alive.push(proj);
          continue;
        }
        proj.spawnDelayRemaining = 0;
        if (!pistolReleaseEmittedThisTick) {
          pistolReleaseEmittedThisTick = true;
          this.state.events.push({
            type: 'pistol_shot_released',
            data: { id: proj.id, from: { ...proj.pos }, z: proj.z, facing: p.facing, vx: proj.velocity.x, vy: proj.velocity.y }
          });
        }
      }

      // Anchored Gravitational Singularity Vortex (Stationary Black Hole)
      if (proj.type === 'vortex' && proj.isAnchored) {
        proj.lifetimeRemaining = (proj.lifetimeRemaining ?? 2.8) - dt;
        const pullRadius = 360;
        const victims = this.spatialGrid.getNearby(proj.pos, pullRadius);
        for (let v = 0; v < victims.length; v++) {
          const enemy = victims[v];
          if (enemy.health <= 0) continue;
          const vdx = proj.pos.x - enemy.pos.x;
          const vdy = proj.pos.y - enemy.pos.y;
          const vdist = Math.hypot(vdx, vdy) || 1;
          const pullSpeed = Math.min(440, 620 * (1 - vdist / pullRadius) + 145);
          enemy.pos.x += (vdx / vdist) * pullSpeed * dt;
          enemy.pos.y += (vdy / vdist) * pullSpeed * dt;
          enemy.velocity.x *= 0.86;
          enemy.velocity.y *= 0.86;
        }

        proj.dotTimer = (proj.dotTimer ?? 0.18) - dt;
        if (proj.dotTimer <= 0) {
          proj.dotTimer = 0.18;
          for (let v = 0; v < victims.length; v++) {
            const enemy = victims[v];
            if (enemy.health > 0) {
              this.damageEnemy(enemy, proj.damage * 0.18, proj.pos);
            }
          }
        }

        if (proj.lifetimeRemaining <= 0) {
          const blastRadius = 290;
          for (let v = 0; v < victims.length; v++) {
            const enemy = victims[v];
            if (enemy.health > 0) {
              this.damageEnemy(enemy, proj.damage * 1.35, proj.pos);
              const kdx = enemy.pos.x - proj.pos.x;
              const kdy = enemy.pos.y - proj.pos.y;
              const klen = Math.hypot(kdx, kdy) || 1;
              enemy.velocity.x += (kdx / klen) * 620;
              enemy.velocity.y += (kdy / klen) * 620;
            }
          }
          this.state.events.push({
            type: 'orbital_impact',
            data: { target: { ...proj.pos }, radius: blastRadius, variant: 'vortex' }
          });
          continue;
        }

        alive.push(proj);
        continue;
      }

      // True 3D movement through world space (NO ground snapping, NO slope crawling!)
      const prevX = proj.pos.x;
      const prevY = proj.pos.y;
      const prevZ = proj.z ?? 16;
      const stepDist = proj.speed * dt;
      proj.pos.x += proj.velocity.x * dt;
      proj.pos.y += proj.velocity.y * dt;
      proj.z = prevZ + (proj.vz ?? 0) * dt;
      proj.distanceTraveled += stepDist;

      // Ballistic gravity for grenades, spore bombs & Doctor thrown toxic grenades
      if (
        proj.type === 'grenade' ||
        proj.type === 'spore_bomb' ||
        proj.type === 'toxic_grenade' ||
        proj.type === 'cluster_main' ||
        proj.type === 'cluster_sub'
      ) {
        proj.vz = (proj.vz ?? 0) - 360 * dt;
      }

      // Cryogenic Scalpel: deposit terrain-snapped frost trail nodes and boomerang back to Doctor
      if (proj.type === 'cryo_scalpel') {
        const sCfg = DOCTOR_CONFIG.cryoScalpel;
        const trailRadius = sCfg.trailRadius * (p.calculatedStats.aoeRadiusMultiplier || 1.0);
        const minDedupeDist = trailRadius * 0.45;
        proj.trailAccumDist = (proj.trailAccumDist ?? 0) + stepDist;
        while (proj.trailAccumDist >= sCfg.trailSpawnStepDist) {
          proj.trailAccumDist -= sCfg.trailSpawnStepDist;
          const tz = this.state.terrain.calculateHeight(proj.pos.x, proj.pos.y);
          let hasOverlap = false;
          for (let ft = this.state.frostTrails.length - 1; ft >= 0; ft--) {
            const existing = this.state.frostTrails[ft];
            if (Math.abs(existing.z - tz) < 40 && Math.hypot(existing.pos.x - proj.pos.x, existing.pos.y - proj.pos.y) < minDedupeDist) {
              hasOverlap = true;
              break;
            }
          }
          if (!hasOverlap) {
            const cryoResStacks = p.heroId === 'doctor' ? (p.buffs.buff_doc_cryogenic_residue || 0) : 0;
            const trailDur = sCfg.trailDuration + 0.25 * cryoResStacks;
            this.state.frostTrails.push({
              id: `ftrail_${Date.now()}_${Math.random().toString(36).substring(2, 6)}`,
              pos: { x: proj.pos.x, y: proj.pos.y },
              z: tz,
              radius: trailRadius,
              durationRemaining: trailDur,
              maxDuration: trailDur
            });
            while (this.state.frostTrails.length > sCfg.maxActiveTrailSegments) {
              this.state.frostTrails.shift();
            }
          }
        }
        if (proj.returnPhase) {
          const rdx = p.pos.x - proj.pos.x;
          const rdy = p.pos.y - proj.pos.y;
          const rdz = (p.z + 48) - proj.z;
          const rDist3D = Math.hypot(rdx, rdy, rdz) || 1;
          const retSpeed = sCfg.returnSpeed * (p.calculatedStats.projectileSpeedMultiplier || 1.0);
          proj.speed = retSpeed;
          proj.velocity.x = (rdx / rDist3D) * retSpeed;
          proj.velocity.y = (rdy / rDist3D) * retSpeed;
          proj.vz = (rdz / rDist3D) * retSpeed;
          if (Math.hypot(rdx, rdy) <= 52 || proj.distanceTraveled > 3200) {
            continue; // Returned safely to Doctor
          }
        }
      }

      // Swept 3D Terrain & Obstacle Collision Check: prevents tunneling through ridges or walls
      let hitTerrain = false;
      let impactX = proj.pos.x;
      let impactY = proj.pos.y;
      let impactZ = proj.z;

      if (this.state.terrain.meshCollider) {
        const rayHit = this.state.terrain.meshCollider.raycast3D(
          { x: prevX, y: prevY, z: prevZ },
          { x: proj.pos.x, y: proj.pos.y, z: proj.z },
          true
        );
        if (rayHit.hit && rayHit.point) {
          hitTerrain = true;
          impactX = rayHit.point.x;
          impactY = rayHit.point.y;
          impactZ = rayHit.point.z;
        }
      } else {
        const sweptSteps = Math.max(1, Math.min(5, Math.ceil(stepDist / 12)));
        for (let s = 1; s <= sweptSteps; s++) {
          const st = s / sweptSteps;
          const curX = prevX + (proj.pos.x - prevX) * st;
          const curY = prevY + (proj.pos.y - prevY) * st;
          const curZ = prevZ + (proj.z - prevZ) * st;
          const terrainH = this.state.terrain.calculateHeight(curX, curY);

          if (curZ <= terrainH) {
            hitTerrain = true;
            impactX = curX;
            impactY = curY;
            impactZ = terrainH;
            break;
          }

          // Solid rock/crystal obstacle collision
          for (let o = 0; o < this.state.obstacles.length; o++) {
            const obs = this.state.obstacles[o];
            if (this.state.terrain.isCustomTestMap && obs.type === 'tree') continue;
            const odist = Math.hypot(curX - obs.pos.x, curY - obs.pos.y);
            if (odist <= obs.radius + proj.radius && curZ <= terrainH + 45) {
              hitTerrain = true;
              impactX = curX;
              impactY = curY;
              impactZ = curZ;
              break;
            }
          }
          if (hitTerrain) break;
        }
      }

      if (hitTerrain) {
        proj.pos.x = impactX;
        proj.pos.y = impactY;
        proj.z = impactZ;
        if (proj.type === 'cryo_scalpel') {
          proj.z = impactZ + 18;
          if (!proj.returnPhase) {
            proj.returnPhase = true;
            proj.hitEnemyIds = proj.returnHitIds || new Set();
            proj.distanceTraveled = 0;
          }
          alive.push(proj);
          continue;
        }
        if (proj.type === 'bomb') {
          this.detonateExplosiveBomb(proj);
        } else if (proj.type === 'toxic_grenade') {
          this.detonateToxicGrenade(proj);
        } else if (proj.type === 'cluster_main') {
          this.detonateClusterMain(proj);
        } else if (proj.type === 'cluster_sub') {
          this.detonateClusterSub(proj);
        } else if (proj.type === 'grenade') {
          // Detonate Frost Grenade on terrain impact
          const blastRadius = 220 * (p.calculatedStats.aoeRadiusMultiplier || 1.0);
          const victims = this.spatialGrid.getNearby(proj.pos, blastRadius);
          for (const v of victims) {
            if (v.health > 0) {
              this.damageEnemy(v, proj.damage, v.pos);
              v.isChilled = true;
              v.chillTimer = 4.5;
              v.isStunned = true;
              v.stunTimer = 1.5;
            }
          }
          this.state.events.push({
            type: 'orbital_impact',
            data: { target: { ...proj.pos }, radius: blastRadius, variant: 'cryo' }
          });
        } else if (proj.type === 'spore_bomb') {
          // Detonate Brood Queen Spore Bomb on terrain impact
          const blastRadius = 140;
          const distToPlayer = Math.hypot(p.pos.x - proj.pos.x, p.pos.y - proj.pos.y);
          if (distToPlayer <= blastRadius && Math.abs((p.z + 52) - proj.z) <= 135 && !p.isDashing) {
            this.applyEnemyProjectileHitToPlayer(proj);
          }
          this.state.events.push({
            type: 'orbital_impact',
            data: { target: { ...proj.pos }, z: proj.z, radius: blastRadius, variant: 'acid' }
          });
        } else if (proj.type === 'elemental_ball') {
          const blastRadius = 130;
          const distToPlayer = Math.hypot(p.pos.x - proj.pos.x, p.pos.y - proj.pos.y);
          if (distToPlayer <= blastRadius && Math.abs((p.z + 52) - proj.z) <= 145 && !p.isDashing) {
            this.damagePlayer(proj.damage, false, undefined, 'projectile');
          }
          this.state.events.push({
            type: 'orbital_impact',
            data: { target: { ...proj.pos }, z: proj.z, radius: blastRadius, variant: 'void' }
          });
        }
        continue; // Projectile blocked and destroyed by solid mountain, cliff, or obstacle!
      }

      if (proj.distanceTraveled >= proj.maxDistance) {
        if (proj.type === 'cryo_scalpel') {
          if (!proj.returnPhase) {
            proj.returnPhase = true;
            proj.hitEnemyIds = proj.returnHitIds || new Set();
            proj.distanceTraveled = 0;
            alive.push(proj);
          }
          continue;
        } else if (proj.type === 'bomb') {
          this.detonateExplosiveBomb(proj);
          continue;
        } else if (proj.type === 'toxic_grenade') {
          this.detonateToxicGrenade(proj);
          continue;
        } else if (proj.type === 'cluster_main') {
          this.detonateClusterMain(proj);
          continue;
        } else if (proj.type === 'cluster_sub') {
          this.detonateClusterSub(proj);
          continue;
        } else if (proj.type === 'grenade') {
          // Detonate Frost Grenade
          const blastRadius = 220 * (p.calculatedStats.aoeRadiusMultiplier || 1.0);
          const victims = this.spatialGrid.getNearby(proj.pos, blastRadius);
          for (const v of victims) {
            if (v.health > 0) {
              this.damageEnemy(v, proj.damage, v.pos);
              v.isChilled = true;
              v.chillTimer = 4.5;
              v.isStunned = true;
              v.stunTimer = 1.5;
            }
          }
          this.state.events.push({
            type: 'orbital_impact',
            data: { target: { ...proj.pos }, radius: blastRadius, variant: 'cryo' }
          });
          continue;
        } else if (proj.type === 'spore_bomb') {
          // Detonate Brood Queen Spore Bomb on impact
          const blastRadius = 140;
          const distToPlayer = Math.hypot(p.pos.x - proj.pos.x, p.pos.y - proj.pos.y);
          if (distToPlayer <= blastRadius && Math.abs((p.z + 52) - proj.z) <= 135 && !p.isDashing) {
            this.applyEnemyProjectileHitToPlayer(proj);
          }
          this.state.events.push({
            type: 'orbital_impact',
            data: { target: { ...proj.pos }, z: proj.z, radius: blastRadius, variant: 'acid' }
          });
          continue;
        } else if (proj.type === 'elemental_ball') {
          const blastRadius = 130;
          const distToPlayer = Math.hypot(p.pos.x - proj.pos.x, p.pos.y - proj.pos.y);
          if (distToPlayer <= blastRadius && Math.abs((p.z + 52) - proj.z) <= 145 && !p.isDashing) {
            this.damagePlayer(proj.damage, false, undefined, 'projectile');
          }
          this.state.events.push({
            type: 'orbital_impact',
            data: { target: { ...proj.pos }, z: proj.z, radius: blastRadius, variant: 'void' }
          });
          continue;
        } else if (proj.type === 'vortex') {
          // Anchor in place as a miniature black hole singularity for 2.8s
          proj.isAnchored = true;
          proj.speed = 0;
          proj.velocity = { x: 0, y: 0 };
          proj.vz = 0;
          proj.lifetimeRemaining = 2.8 * (p.calculatedStats.skillDurationMultiplier || 1.0);
          proj.dotTimer = 0.18;
          alive.push(proj);
          continue;
        }
        continue;
      }

      // Gravitational pull for Vortex orbs in flight
      if (proj.type === 'vortex' && !proj.isAnchored) {
        const pullRadius = 300 * (p.calculatedStats.aoeRadiusMultiplier || 1.0);
        const victims = this.spatialGrid.getNearby(proj.pos, pullRadius);
        for (const v of victims) {
          if (v.health <= 0) continue;
          const vdx = proj.pos.x - v.pos.x;
          const vdy = proj.pos.y - v.pos.y;
          const vdist = Math.hypot(vdx, vdy);
          if (vdist > 8) {
            v.pos.x += (vdx / vdist) * 280 * dt;
            v.pos.y += (vdy / vdist) * 280 * dt;
          }
        }
      }

      // Twin Converging Slashes (bomb): herd enemies inward toward the centerline as the blades sweep forward
      if (proj.type === 'bomb') {
        const sweepRadius = 185 * (p.calculatedStats.aoeRadiusMultiplier || 1.0);
        const victims = this.spatialGrid.getNearby(proj.pos, sweepRadius);
        for (const v of victims) {
          if (v.health <= 0) continue;
          const vdx = proj.pos.x - v.pos.x;
          const vdy = proj.pos.y - v.pos.y;
          const vdist = Math.hypot(vdx, vdy);
          if (vdist > 10) {
            v.pos.x += (vdx / vdist) * 320 * dt;
            v.pos.y += (vdy / vdist) * 320 * dt;
          }
        }
      }

      if (proj.owner === 'player') {
        const nearby = this.spatialGrid.getNearby(proj.pos, proj.radius + 145);

        for (let j = 0; j < nearby.length; j++) {
          const enemy = nearby[j];
          if (enemy.health <= 0 || proj.hitEnemyIds.has(enemy.id)) continue;

          // True 3D distance check against enemy body
          const dx = proj.pos.x - enemy.pos.x;
          const dy = proj.pos.y - enemy.pos.y;
          const enemyCenterZ = enemy.z + (enemy.radius * 0.8);
          const dz = proj.z - enemyCenterZ;
          const dist3D = Math.hypot(dx, dy, dz);

          if (dist3D <= proj.radius + enemy.radius) {
            proj.hitEnemyIds.add(enemy.id);
            if (proj.type === 'bomb') {
              this.detonateExplosiveBomb(proj);
              break;
            }
            if (proj.type === 'toxic_grenade') {
              this.detonateToxicGrenade(proj);
              break;
            }
            if (proj.type === 'cluster_main') {
              this.detonateClusterMain(proj);
              break;
            }
            if (proj.type === 'cluster_sub') {
              this.detonateClusterSub(proj);
              break;
            }
            if (proj.type === 'sedative_dart') {
              enemy.isStunned = true;
              enemy.stunTimer = 2.5 * (p.calculatedStats.skillDurationMultiplier || 1.0); // Sedative dose incapacitation
              enemy.velocity.x = 0;
              enemy.velocity.y = 0;
            }
            const ricochetMult =
              proj.type === 'toxic_chain' && proj.isRicochet && p.heroId === 'doctor'
                ? 1 + 0.04 * (p.buffs.buff_doc_contagion_return || 0)
                : 1.0;
            this.damageEnemy(
              enemy,
              proj.damage * ricochetMult,
              proj.pos,
              proj.element || (proj.type === 'scatter' ? 'ignite' : proj.type === 'arc' ? 'lightning' : proj.type === 'medical_pulse' || proj.type === 'angel_bolt' ? 'medical' : proj.type === 'toxic_chain' || proj.type === 'drone_bio_bolt' ? 'acid' : undefined),
              {
                isDirectAttack: proj.isDirectAttack,
                isPrimaryLmb: proj.isPrimaryLmb,
                attackActivationId: proj.attackActivationId
              }
            );
            if (proj.type === 'drone_bio_bolt') {
              this.state.events.push({
                type: 'drone_bolt_impact',
                data: { pos: { x: proj.pos.x, y: proj.pos.y }, z: proj.z }
              });
            }

            // Doctor LMB Augment 1: Toxic Chain (1 stack/hit -> 3-stack toxic explosion + ricochet)
            if (proj.type === 'toxic_chain') {
              const bounced = this.handleToxicChainHit(proj, enemy);
              if (bounced) {
                alive.push(proj);
                break;
              }
            }

            // Trigger Chain Spark passive if player has stacks
            if (
              p.calculatedStats.chainSparkChance > 0 &&
              this.state.rng.next() < p.calculatedStats.chainSparkChance
            ) {
              this.triggerChainSpark(enemy);
            }

            if (proj.hitEnemyIds.size >= proj.pierceCount) {
              break;
            }
          }
        }

        if (proj.type !== 'toxic_chain' && proj.hitEnemyIds.size >= proj.pierceCount) {
          continue;
        }
        if (proj.type === 'toxic_chain' && proj.hitEnemyIds.size >= proj.pierceCount && !alive.includes(proj)) {
          continue;
        }
        if (alive.includes(proj)) {
          continue;
        }
      } else {
        // Check enemy projectiles hitting active Holographic Decoys before player (strictly 2 hits)
        let hitDecoy = false;
        for (let d = 0; d < this.state.holographicDecoys.length; d++) {
          const decoy = this.state.holographicDecoys[d];
          if (decoy.hitsRemaining <= 0) continue;
          const dDist3D = Math.hypot(proj.pos.x - decoy.pos.x, proj.pos.y - decoy.pos.y, proj.z - (decoy.z + 48));
          if (dDist3D <= proj.radius + 38) {
            decoy.hitsRemaining = Math.max(0, decoy.hitsRemaining - 1);
            hitDecoy = true;
            break;
          }
        }
        if (hitDecoy) {
          if (proj.type === 'elemental_ball') {
            this.state.events.push({
              type: 'orbital_impact',
              data: { target: { ...proj.pos }, z: proj.z, radius: 78, variant: 'void' }
            });
          }
          continue;
        }

        // True 3D distance check against 2x-scaled player torso matching visible projectile dimensions
        const dx = proj.pos.x - p.pos.x;
        const dy = proj.pos.y - p.pos.y;
        const playerCenterZ = p.z + 52;
        const dz = proj.z - playerCenterZ;
        const dist3D = Math.hypot(dx, dy, dz);

        if (dist3D <= proj.radius + ENEMY_COMBAT_BALANCE.playerProjectileHurtRadius) {
          if (!p.isDashing) {
            if (proj.type === 'elemental_ball') {
              this.damagePlayer(proj.damage, false, undefined, 'projectile');
            } else {
              this.applyEnemyProjectileHitToPlayer(proj);
            }
          }
          if (proj.type === 'elemental_ball') {
            this.state.events.push({
              type: 'orbital_impact',
              data: { target: { ...proj.pos }, z: proj.z, radius: 78, variant: 'void' }
            });
          }
          continue;
        }
      }

      alive.push(proj);
    }

    // Performance safeguard for extreme uncapped +Projectile stacking
    const MAX_ACTIVE_PLAYER_PROJECTILES = 240;
    if (alive.length > MAX_ACTIVE_PLAYER_PROJECTILES) {
      let playerCount = 0;
      for (let i = 0; i < alive.length; i++) {
        if (alive[i].owner === 'player') playerCount++;
      }
      let excess = playerCount - MAX_ACTIVE_PLAYER_PROJECTILES;
      if (excess > 0) {
        const trimmed: ProjectileState[] = [];
        for (let i = 0; i < alive.length; i++) {
          const item = alive[i];
          if (excess > 0 && item.owner === 'player' && !item.isAnchored && item.type !== 'cryo_scalpel') {
            excess--;
            continue;
          }
          trimmed.push(item);
        }
        this.state.projectiles = trimmed;
        return;
      }
    }

    this.state.projectiles = alive;
  }

  private handleToxicChainHit(proj: ProjectileState, enemy: EnemyState): boolean {
    const p = this.state.player;
    const cfg = DOCTOR_CONFIG.toxicChain;

    // Apply DoT status effect + increment stack counter
    enemy.isToxic = true;
    enemy.toxicTimer = Math.max(enemy.toxicTimer ?? 0, cfg.toxicDotDuration);
    enemy.poisonStacks = (enemy.poisonStacks ?? 0) + 1;
    enemy.poisonStackTimer = cfg.stackExpireDuration;

    // 3 stacks trigger an AoE toxic explosion & consume stacks (does NOT increment stacks on neighbors -> no infinite loops)
    if (enemy.poisonStacks >= cfg.stacksToExplode) {
      enemy.poisonStacks = 0;
      enemy.poisonStackTimer = 0;
      const catalystStacks = p.heroId === 'doctor' ? (p.buffs.buff_doc_overdose_catalyst || 0) : 0;
      const blastRadius = cfg.explosionRadius * (p.calculatedStats.aoeRadiusMultiplier || 1.0);
      const blastDmg = cfg.explosionDamage * (1 + 0.04 * catalystStacks) * p.calculatedStats.damageMultiplier;
      const victims = this.spatialGrid.getNearby(enemy.pos, blastRadius + 24);
      for (let v = 0; v < victims.length; v++) {
        const vic = victims[v];
        if (vic.health <= 0) continue;
        if (Math.hypot(vic.pos.x - enemy.pos.x, vic.pos.y - enemy.pos.y) <= blastRadius + vic.radius) {
          this.damageEnemy(vic, blastDmg, enemy.pos, 'acid');
          vic.isToxic = true;
          vic.toxicTimer = Math.max(vic.toxicTimer ?? 0, cfg.toxicDotDuration * 0.75);
        }
      }
      this.state.events.push({
        type: 'toxic_chain_explosion',
        data: { pos: { ...enemy.pos }, z: enemy.z, radius: blastRadius }
      });
    }

    // Ricochet to nearest unhit valid enemy within bounce radius
    if ((proj.bouncesRemaining ?? 0) <= 0) {
      return false;
    }
    const candidates = this.spatialGrid.getNearby(enemy.pos, cfg.bounceRadius);
    let bestTarget: EnemyState | null = null;
    let bestDist = Infinity;
    for (let i = 0; i < candidates.length; i++) {
      const cand = candidates[i];
      if (cand.health <= 0 || proj.hitEnemyIds.has(cand.id)) continue;
      const d = Math.hypot(cand.pos.x - enemy.pos.x, cand.pos.y - enemy.pos.y);
      if (d <= cfg.bounceRadius && d < bestDist) {
        bestDist = d;
        bestTarget = cand;
      }
    }

    if (!bestTarget) return false;

    proj.bouncesRemaining = (proj.bouncesRemaining ?? 1) - 1;
    proj.isRicochet = true;
    proj.distanceTraveled = 0;
    proj.maxDistance = cfg.bounceRadius + 48;
    proj.damage *= cfg.bounceDamageFalloff;

    const fromPos = { x: proj.pos.x, y: proj.pos.y };
    const fromZ = proj.z;
    const toZ = bestTarget.z + Math.max(14, bestTarget.radius * 0.75);
    const dx = bestTarget.pos.x - proj.pos.x;
    const dy = bestTarget.pos.y - proj.pos.y;
    const dz = toZ - proj.z;
    const dist3D = Math.hypot(dx, dy, dz) || 1;
    proj.velocity.x = (dx / dist3D) * proj.speed;
    proj.velocity.y = (dy / dist3D) * proj.speed;
    proj.vz = (dz / dist3D) * proj.speed;

    this.state.events.push({
      type: 'toxic_chain_bounce',
      data: { from: fromPos, fromZ, to: { ...bestTarget.pos }, toZ }
    });
    return true;
  }

  private triggerChainSpark(sourceEnemy: EnemyState): void {
    const p = this.state.player;
    const nearby = this.spatialGrid.getNearby(sourceEnemy.pos, 500);
    const candidates = nearby.filter(e => e.id !== sourceEnemy.id && e.health > 0);
    if (candidates.length === 0) return;

    candidates.sort((a, b) => {
      const da = Math.hypot(a.pos.x - sourceEnemy.pos.x, a.pos.y - sourceEnemy.pos.y);
      const db = Math.hypot(b.pos.x - sourceEnemy.pos.x, b.pos.y - sourceEnemy.pos.y);
      return da - db;
    });

    const target = candidates[0];
    const sparkDamage = p.calculatedStats.chainSparkDamage;
    this.damageEnemy(target, sparkDamage, target.pos, 'lightning');

    this.state.events.push({
      type: 'chain_spark',
      data: {
        from: { ...sourceEnemy.pos },
        to: { ...target.pos },
        damage: sparkDamage
      }
    });
  }

  private updateOrbitalStrikes(dt: number): void {
    const p = this.state.player;
    const alive: OrbitalStrikeState[] = [];

    for (let i = 0; i < this.state.orbitalStrikes.length; i++) {
      const s = this.state.orbitalStrikes[i];
      const strikeZ = this.state.terrain.getElevation(s.targetPos.x, s.targetPos.y).height;

      if (!s.hasStruck) {
        s.delayRemaining -= dt;
        if (s.delayRemaining <= 0) {
          s.hasStruck = true;
          const hitSet = s.hitEnemyIds || new Set<string>();
          s.hitEnemyIds = hitSet;

          // 1. Primary center Orbital Strike impact damage
          const victims = this.spatialGrid.getNearby(s.targetPos, s.radius);
          for (let v = 0; v < victims.length; v++) {
            const enemy = victims[v];
            if (enemy.health > 0 && !hitSet.has(enemy.id)) {
              hitSet.add(enemy.id);
              this.damageEnemy(enemy, s.damage, s.targetPos);

              if (s.enhancement === 'singularity' || s.enhancement === 'convergence_barrage') {
                // Pull-based enhancements draw enemies inward rather than knocking them out of the zone
                enemy.velocity.x *= 0.25;
                enemy.velocity.y *= 0.25;
                enemy.attackCooldownRemaining = Math.max(enemy.attackCooldownRemaining, 0.9);
              } else if (s.enhancement === 'cryogenic_impact') {
                // Immediately freeze enemies hit by the initial impact
                enemy.isStunned = true;
                enemy.stunTimer = Math.max(enemy.stunTimer ?? 0, 0.75);
                enemy.isChilled = true;
                enemy.chillTimer = Math.max(enemy.chillTimer ?? 0, 2.0);
                enemy.velocity.x = 0;
                enemy.velocity.y = 0;
              } else {
                // Base Orbital Strike: radial shockwave knockback away from the blast center
                const kdx = enemy.pos.x - s.targetPos.x;
                const kdy = enemy.pos.y - s.targetPos.y;
                const klen = Math.hypot(kdx, kdy) || 1;
                const pushForce = 380 * (1 - Math.min(0.75, klen / s.radius));
                enemy.velocity.x += (kdx / klen) * pushForce;
                enemy.velocity.y += (kdy / klen) * pushForce;
                enemy.attackCooldownRemaining = Math.max(enemy.attackCooldownRemaining, 0.85);
              }
            }
          }

          // 2. If Convergence Barrage is active, also apply simultaneous impact across the 4 outer strikes
          if (s.enhancement === 'convergence_barrage' && s.subStrikes) {
            const subRadius = Math.round(s.radius * 0.68);
            for (let b = 0; b < s.subStrikes.length; b++) {
              const subPos = s.subStrikes[b];
              const subVictims = this.spatialGrid.getNearby(subPos, subRadius);
              for (let v = 0; v < subVictims.length; v++) {
                const enemy = subVictims[v];
                if (enemy.health > 0 && !hitSet.has(enemy.id)) {
                  hitSet.add(enemy.id);
                  this.damageEnemy(enemy, s.damage, subPos);
                  enemy.velocity.x *= 0.25;
                  enemy.velocity.y *= 0.25;
                  enemy.attackCooldownRemaining = Math.max(enemy.attackCooldownRemaining, 0.9);
                }
              }
            }
          }

          // Emit base Orbital Strike impact event
          this.state.events.push({
            type: 'damage_dealt',
            data: {
              isOrbitalBlast: true,
              pos: s.targetPos,
              radius: s.radius,
              elevation: strikeZ,
              variant: s.variant || 'judgment',
              enhancement: s.enhancement,
              subStrikes: s.subStrikes
            }
          });

          // Emit enhancement-specific Phase 2 start event
          if (s.enhancement === 'singularity') {
            this.state.events.push({
              type: 'ultimate_singularity_spawned',
              data: {
                pos: s.targetPos,
                radius: Math.round(s.radius * 1.38),
                elevation: strikeZ,
                duration: s.durationRemaining
              }
            });
          } else if (s.enhancement === 'convergence_barrage' && s.subStrikes) {
            this.state.events.push({
              type: 'ultimate_convergence_started',
              data: {
                pos: s.targetPos,
                subStrikes: s.subStrikes,
                radius: s.radius,
                elevation: strikeZ,
                duration: s.durationRemaining
              }
            });
          } else if (s.enhancement === 'cryogenic_impact') {
            this.state.events.push({
              type: 'ultimate_cryo_field_spawned',
              data: {
                pos: s.targetPos,
                radius: Math.round(s.radius * 1.25),
                elevation: strikeZ,
                duration: s.durationRemaining
              }
            });
          }
        }
      } else {
        s.durationRemaining -= dt;

        // ====================================================================
        // ENHANCEMENT A: SINGULARITY (3.0s Gravitational Pull + Void DoT)
        // ====================================================================
        if (s.enhancement === 'singularity' || s.variant === 'singularity') {
          const pullRadius = Math.round(s.radius * 1.38);
          const gravStacks = p.heroId === 'commander' ? (p.buffs.buff_cmd_gravitational_pull || 0) : 0;
          const eventHorizonStacks = p.heroId === 'commander' ? (p.buffs.buff_cmd_event_horizon || 0) : 0;
          const pullStrengthMult = 1 + 0.05 * gravStacks;
          const pullTickDmgMult = 1 + 0.03 * eventHorizonStacks;
          const pullVictims = this.spatialGrid.getNearby(s.targetPos, pullRadius);
          for (let v = 0; v < pullVictims.length; v++) {
            const enemy = pullVictims[v];
            if (enemy.health <= 0) continue;
            if (Math.abs(enemy.z - strikeZ) > 140) continue; // Respect elevation boundaries

            const dx = s.targetPos.x - enemy.pos.x;
            const dy = s.targetPos.y - enemy.pos.y;
            const dist = Math.hypot(dx, dy) || 1;
            const isElite = enemy.isElite || enemy.type === 'elite' || enemy.type === 'boss';

            const pullSpeed = (isElite
              ? Math.min(240, 360 * (1 - dist / pullRadius) + 85)
              : Math.min(480, 660 * (1 - dist / pullRadius) + 170)) * pullStrengthMult;

            if (!isElite) {
              enemy.isStunned = true;
              enemy.stunTimer = Math.max(enemy.stunTimer ?? 0, 0.35);
              enemy.attackCooldownRemaining = Math.max(enemy.attackCooldownRemaining, 0.45);
            }
            enemy.velocity.x *= 0.5;
            enemy.velocity.y *= 0.5;

            if (dist > 30) {
              const step = Math.min(dist - 24, pullSpeed * dt);
              const nextPos = {
                x: enemy.pos.x + (dx / dist) * step,
                y: enemy.pos.y + (dy / dist) * step
              };
              if (this.state.terrain.checkTraversable(enemy.pos, nextPos, enemy.z, false).allowed) {
                enemy.pos.x = nextPos.x;
                enemy.pos.y = nextPos.y;
                enemy.z = this.state.terrain.getElevation(enemy.pos.x, enemy.pos.y).height;
                enemy.groundZ = enemy.z;
              }
            }
          }

          s.dotTimer = (s.dotTimer ?? 0.25) - dt;
          if (s.dotTimer <= 0) {
            s.dotTimer = 0.25;
            for (let v = 0; v < pullVictims.length; v++) {
              const enemy = pullVictims[v];
              if (enemy.health > 0 && Math.abs(enemy.z - strikeZ) <= 140) {
                this.damageEnemy(enemy, s.damage * 0.12 * pullTickDmgMult, s.targetPos, 'void');
              }
            }
          }
        }

        // ====================================================================
        // ENHANCEMENT B: CONVERGENCE BARRAGE (0.95s Inward Energy Spiral Pull)
        // ====================================================================
        if (s.enhancement === 'convergence_barrage') {
          const convRadius = Math.round(s.radius * 1.35);
          const convVictims = this.spatialGrid.getNearby(s.targetPos, convRadius);
          for (let v = 0; v < convVictims.length; v++) {
            const enemy = convVictims[v];
            if (enemy.health <= 0) continue;
            if (Math.abs(enemy.z - strikeZ) > 140) continue;

            const dx = s.targetPos.x - enemy.pos.x;
            const dy = s.targetPos.y - enemy.pos.y;
            const dist = Math.hypot(dx, dy) || 1;
            if (dist > 36) {
              const pullSpeed = enemy.isBoss ? 240 : 460;
              const step = Math.min(dist - 28, pullSpeed * dt);
              const nextPos = {
                x: enemy.pos.x + (dx / dist) * step,
                y: enemy.pos.y + (dy / dist) * step
              };
              if (this.state.terrain.checkTraversable(enemy.pos, nextPos, enemy.z, false).allowed) {
                enemy.pos.x = nextPos.x;
                enemy.pos.y = nextPos.y;
                enemy.z = this.state.terrain.getElevation(enemy.pos.x, enemy.pos.y).height;
                enemy.groundZ = enemy.z;
              }
            }
          }
        }

        // ====================================================================
        // ENHANCEMENT C: CRYOGENIC IMPACT (4.0s Freezing Field + Cold DoT)
        // ====================================================================
        if (s.enhancement === 'cryogenic_impact') {
          const cryoRadius = Math.round(s.radius * 1.25);
          const subzeroStacks = p.heroId === 'commander' ? (p.buffs.buff_cmd_subzero_detonation || 0) : 0;
          const cryoChillStrength = 0.50 + 0.02 * subzeroStacks;
          const cryoVictims = this.spatialGrid.getNearby(s.targetPos, cryoRadius);
          for (let v = 0; v < cryoVictims.length; v++) {
            const enemy = cryoVictims[v];
            if (enemy.health <= 0) continue;
            if (Math.abs(enemy.z - strikeZ) > 140) continue;

            // Freeze / Stun enemies inside the cryogenic field
            enemy.isStunned = true;
            enemy.stunTimer = Math.max(enemy.stunTimer ?? 0, 0.65);
            enemy.isChilled = true;
            enemy.chillTimer = Math.max(enemy.chillTimer ?? 0, 1.5);
            enemy.chillStrength = Math.max(enemy.chillStrength ?? 0.50, cryoChillStrength);
            enemy.velocity.x = 0;
            enemy.velocity.y = 0;
            enemy.attackCooldownRemaining = Math.max(enemy.attackCooldownRemaining, 0.65);
          }

          s.dotTimer = (s.dotTimer ?? 0.44) - dt;
          if (s.dotTimer <= 0) {
            s.dotTimer = 0.44;
            for (let v = 0; v < cryoVictims.length; v++) {
              const enemy = cryoVictims[v];
              if (enemy.health > 0 && Math.abs(enemy.z - strikeZ) <= 140) {
                this.damageEnemy(enemy, s.damage * 0.175, enemy.pos, 'frost');
              }
            }
          }
        }

        // ====================================================================
        // PHASE 3: EXPIRATION & FINAL DETONATIONS
        // ====================================================================
        if (s.durationRemaining <= 0) {
          if ((s.enhancement === 'singularity' || s.variant === 'singularity') && !s.hasExploded) {
            s.hasExploded = true;
            const blastRadius = Math.round(s.radius * 1.38);
            const victims = this.spatialGrid.getNearby(s.targetPos, blastRadius);
            for (let v = 0; v < victims.length; v++) {
              const enemy = victims[v];
              if (enemy.health > 0 && Math.abs(enemy.z - strikeZ) <= 140) {
                // Release from singularity lock and apply collapse detonation damage + outward impulse
                enemy.isStunned = false;
                enemy.stunTimer = 0;
                this.damageEnemy(enemy, s.damage * 1.50, s.targetPos, 'void');
                const kdx = enemy.pos.x - s.targetPos.x;
                const kdy = enemy.pos.y - s.targetPos.y;
                const klen = Math.hypot(kdx, kdy) || 1;
                enemy.velocity.x += (kdx / klen) * 680;
                enemy.velocity.y += (kdy / klen) * 680;
              }
            }
            this.state.events.push({
              type: 'ultimate_singularity_detonated',
              data: {
                pos: s.targetPos,
                radius: blastRadius,
                elevation: strikeZ
              }
            });
          } else if (s.enhancement === 'convergence_barrage' && !s.hasExploded) {
            s.hasExploded = true;
            const blastRadius = Math.round(s.radius * 1.20);
            const victims = this.spatialGrid.getNearby(s.targetPos, blastRadius);
            for (let v = 0; v < victims.length; v++) {
              const enemy = victims[v];
              if (enemy.health > 0 && Math.abs(enemy.z - strikeZ) <= 140) {
                this.damageEnemy(enemy, s.damage * 1.45, s.targetPos, 'ignite');
                const kdx = enemy.pos.x - s.targetPos.x;
                const kdy = enemy.pos.y - s.targetPos.y;
                const klen = Math.hypot(kdx, kdy) || 1;
                enemy.velocity.x += (kdx / klen) * 640;
                enemy.velocity.y += (kdy / klen) * 640;
              }
            }
            this.state.events.push({
              type: 'ultimate_convergence_detonated',
              data: {
                pos: s.targetPos,
                radius: blastRadius,
                elevation: strikeZ
              }
            });
          }
          continue;
        }
      }
      alive.push(s);
    }

    this.state.orbitalStrikes = alive;
  }

  public applyChill(enemy: EnemyState, duration: number = 3.5, strength: number = 0.50): void {
    enemy.isChilled = true;
    enemy.chillTimer = Math.max(enemy.chillTimer || 0, duration);
    enemy.chillStrength = Math.max(enemy.chillStrength || 0, strength);
  }

  private allocateDirectAttackActivationId(): number {
    const id = this.nextAttackActivationId++;
    const p = this.state.player;
    if (p.usedCombatFocusActivations && p.usedCombatFocusActivations.size > 32) {
      p.usedCombatFocusActivations.clear();
    }
    return id;
  }

  public damageEnemy(
    enemy: EnemyState,
    amount: number,
    hitPos: Vector2,
    element?: string,
    opts?: DamageEnemyOptions
  ): void {
    if (enemy.health <= 0) return;
    const p = this.state.player;
    const isRecursive = Boolean(opts?.isRecursiveTrigger);
    const isPrimaryLmb = Boolean(opts?.isPrimaryLmb || this.isExecutingPrimaryLmb);
    const wasFullHealth = enemy.health >= enemy.maxHealth - 0.001;

    // First Contact Protocol: striking an undamaged enemy triggers timed Attack Speed (8s ICD)
    if (!isRecursive && wasFullHealth && (p.buffs.buff_first_contact_protocol || 0) > 0) {
      this.triggerTimedEffect('first_contact_protocol', 4.0, 8.0, 'buff_first_contact_protocol');
    }

    // T04 Executioner: +2% bonus damage per stack against enemies below 30% HP
    let mult = 1.0;
    const execStacks = p.buffs.buff_executioner || 0;
    if (execStacks > 0 && enemy.health / Math.max(1, enemy.maxHealth) < 0.30) {
      mult *= 1 + 0.02 * execStacks;
    }

    // Opening Pulse: +10% (+5%/stack) bonus damage vs healthy enemies (>= 90% HP)
    if ((p.calculatedStats.openingPulseBonus || 0) > 0 && enemy.health / Math.max(1, enemy.maxHealth) >= 0.90) {
      mult *= 1 + (p.calculatedStats.openingPulseBonus || 0);
    }

    // Titanbreaker Matrix: +6%/stack vs Elites and Bosses (single || check prevents Boss double-count)
    if ((p.calculatedStats.giantSlayerBonus || 0) > 0 && (enemy.isElite || enemy.isBoss)) {
      mult *= 1 + p.calculatedStats.giantSlayerBonus;
    }

    // Cryo-Chem Catalyst: +8% (+4%/stack) vs status-afflicted enemies
    if (
      (p.calculatedStats.statusSynergyDamageBonus || 0) > 0 &&
      (enemy.isChilled || enemy.isElectrified || enemy.isToxic)
    ) {
      mult *= 1 + (p.calculatedStats.statusSynergyDamageBonus || 0);
    }

    // Resonance Siphon: timed LMB damage empowerment after RMB cast
    if (isPrimaryLmb && (p.calculatedStats.resonanceLmbDamageBonus || 0) > 0) {
      mult *= 1 + (p.calculatedStats.resonanceLmbDamageBonus || 0);
    }

    // Positional direct-attack damage bonuses: Rangefinder Array (>= 500u) & Point-Blank Coil (edge <= 220u)
    if (!isRecursive) {
      const targetDist = Math.hypot(p.pos.x - enemy.pos.x, p.pos.y - enemy.pos.y);
      if ((p.calculatedStats.longRangeDamageBonus || 0) > 0 && targetDist >= 500) {
        mult *= 1 + (p.calculatedStats.longRangeDamageBonus || 0);
      }
      if ((p.calculatedStats.closeRangeDamageBonus || 0) > 0 && targetDist - (enemy.radius || 0) <= 220) {
        mult *= 1 + (p.calculatedStats.closeRangeDamageBonus || 0);
      }
    }

    // T05 Combat Focus: Every 5th direct hit deals +5% bonus damage per stack (max 1 proc per attack activation)
    const focusStacks = p.buffs.buff_combat_focus || 0;
    if (!isRecursive && opts?.isDirectAttack && focusStacks > 0) {
      const actId = opts.attackActivationId ?? this.allocateDirectAttackActivationId();
      if (!p.usedCombatFocusActivations) p.usedCombatFocusActivations = new Set<number>();
      if (!p.usedCombatFocusActivations.has(actId)) {
        p.usedCombatFocusActivations.add(actId);
        p.combatFocusHitCount = (p.combatFocusHitCount || 0) + 1;
        if (p.combatFocusHitCount >= 5) {
          p.combatFocusHitCount = 0;
          mult *= 1 + 0.05 * focusStacks;
        }
      }
    }

    const isCrit = this.state.rng.next() < p.calculatedStats.critChance;
    const isCorruption = this.isCorruptionActive();
    const corruptionVuln = isCorruption ? 1.60 : 1.0;
    const electrifiedVuln = enemy.isElectrified ? (enemy.electrifiedMultiplier ?? 1.35) : 1.0;
    const rawScaled = amount * mult;
    const finalAmount = Math.round(
      (isCrit ? rawScaled * p.calculatedStats.critMultiplier : rawScaled) * corruptionVuln * electrifiedVuln
    );

    enemy.health -= finalAmount;
    enemy.isAlerted = true; // Alert enemy on taking damage
    const nearbyPack = this.spatialGrid.getNearby(enemy.pos, 750);
    for (let k = 0; k < nearbyPack.length; k++) {
      nearbyPack[k].isAlerted = true;
    }

    // U12 Life Siphon: Heal for 0.15% * n of damage dealt (capped at 1% max HP per second), non-recursive
    if (!isRecursive && p.calculatedStats.lifeSiphonPercent > 0 && finalAmount > 0 && p.health > 0 && p.health < p.maxHealth) {
      if (p.lifeSiphonSecondTimer <= 0) {
        p.lifeSiphonSecondTimer = 1.0;
        p.lifeSiphonSecondAmount = 0;
      }
      const capPerSec = p.maxHealth * 0.01;
      const room = Math.max(0, capPerSec - p.lifeSiphonSecondAmount);
      const healAmt = Math.min(room, finalAmount * p.calculatedStats.lifeSiphonPercent);
      if (healAmt > 0) {
        p.health = Math.min(p.maxHealth, p.health + healAmt);
        p.lifeSiphonSecondAmount += healAmt;
      }
    }

    // T07 Static Discharge: Direct attacks every 6s trigger arc lightning (5% * n base LMB damage, max 3 nearby targets)
    const staticStacks = p.buffs.buff_static_discharge || 0;
    if (!isRecursive && opts?.isDirectAttack && staticStacks > 0 && p.staticDischargeCooldown <= 0) {
      p.staticDischargeCooldown = 6.0;
      const arcDmg = Math.max(1, Math.round(0.05 * staticStacks * p.baseLmbDamage * p.calculatedStats.damageMultiplier));
      const arcCandidates = this.spatialGrid
        .getNearby(enemy.pos, 460)
        .filter((c) => c.health > 0 && c.id !== enemy.id)
        .sort((a, b) => Math.hypot(a.pos.x - enemy.pos.x, a.pos.y - enemy.pos.y) - Math.hypot(b.pos.x - enemy.pos.x, b.pos.y - enemy.pos.y));
      for (let a = 0; a < Math.min(3, arcCandidates.length); a++) {
        const arcTarget = arcCandidates[a];
        this.damageEnemy(arcTarget, arcDmg, arcTarget.pos, 'lightning', { isRecursiveTrigger: true });
        this.state.events.push({
          type: 'chain_spark',
          data: { from: { ...enemy.pos }, to: { ...arcTarget.pos }, damage: arcDmg }
        });
      }
    }

    // Status effect procs
    if (this.state.rng.next() < p.calculatedStats.frostChance) {
      enemy.isChilled = true;
      enemy.chillTimer = 3.5;
    }
    if (this.state.rng.next() < p.calculatedStats.toxicChance) {
      enemy.isToxic = true;
      enemy.toxicTimer = 4.0;
    }
    if (this.state.rng.next() < p.calculatedStats.stunChance) {
      enemy.isStunned = true;
      enemy.stunTimer = 1.2;
    }

    this.state.events.push({
      type: 'damage_dealt',
      data: {
        enemyId: enemy.id,
        damage: finalAmount,
        pos: { ...hitPos },
        isCrit,
        element
      }
    });

    if (enemy.health <= 0) {
      const excessDamage = Math.max(0, -enemy.health);
      if (enemy.isStage1Titan) {
        if (enemy.titanState !== 'dying') {
          enemy.health = 0;
          enemy.titanState = 'dying';
          enemy.titanTimer = 3.2;
          enemy.radius = 0; // Disable collision immediately
          this.state.events.push({
            type: 'stage1_boss_death',
            data: { id: enemy.id, pos: { ...enemy.pos }, z: enemy.z, isStage1Boss: true }
          });
          this.state.events.push({
            type: 'boss_defeated',
            data: { name: 'STAGE 1 BOSS', isStage1Boss: true, pos: { ...enemy.pos }, z: enemy.z }
          });
          this.handleEliteOrBossKillRewards(enemy);
          if (this.state.artifact) {
            const art = this.state.artifact;
            art.isBossDefeated = true;
            art.isSummoning = false;
            art.phase = 'exit_ready';
            art.restorationTimer = 0;
            art.teleportPrepTimer = 0;
            art.awaitingDialogueSync = false;
          }
          this.combatDirector.disable();
        }
      } else {
        this.killEnemy(enemy, excessDamage, isRecursive);
      }
    }
  }

  private killEnemy(enemy: EnemyState, excessDamage: number = 0, isRecursiveKill: boolean = false): void {
    const p = this.state.player;
    p.killCount++;

    // T01 Chain Reaction: Enemies explode on death for 6% * n base LMB damage in 180u radius (2s ICD, non-recursive)
    const chainStacks = p.buffs.buff_chain_reaction || 0;
    if (!isRecursiveKill && chainStacks > 0 && p.chainReactionCooldown <= 0) {
      p.chainReactionCooldown = 2.0;
      const blastDmg = Math.max(1, Math.round(0.06 * chainStacks * p.baseLmbDamage * p.calculatedStats.damageMultiplier));
      const victims = this.spatialGrid.getNearby(enemy.pos, 180);
      for (let v = 0; v < victims.length; v++) {
        const victim = victims[v];
        if (victim.id !== enemy.id && victim.health > 0) {
          this.damageEnemy(victim, blastDmg, victim.pos, 'ignite', { isRecursiveTrigger: true });
        }
      }
      this.state.events.push({
        type: 'orbital_impact',
        data: { target: { ...enemy.pos }, z: enemy.z, radius: 180, variant: 'chain_reaction' }
      });
    }

    // T02 Blood Rush: 3 kills within 5s grants +3% * n LMB attack speed + +2% * n move speed for 4s
    const bloodRushStacks = p.buffs.buff_blood_rush || 0;
    if (bloodRushStacks > 0) {
      p.bloodRushKillWindowTimer = 5.0;
      p.bloodRushRecentKills = (p.bloodRushRecentKills || 0) + 1;
      if (p.bloodRushRecentKills >= 3) {
        p.bloodRushRecentKills = 0;
        p.bloodRushTimer = 4.0;
        this.state.updateCalculatedStats();
      }
    }

    // T03 Second Wind: Eliminating an elite or boss restores 3% * n max HP (12s ICD)
    const secondWindStacks = p.buffs.buff_second_wind || 0;
    if (secondWindStacks > 0 && (enemy.isElite || enemy.isBoss) && p.secondWindCooldown <= 0 && p.health > 0) {
      p.secondWindCooldown = 12.0;
      p.health = Math.min(p.maxHealth, p.health + p.maxHealth * 0.03 * secondWindStacks);
    }
    this.handleEliteOrBossKillRewards(enemy);

    // T10 Cooldown Harvest: Each kill reduces active skill cooldowns by 0.08s * n (capped at 0.5s/sec)
    const harvestStacks = p.buffs.buff_cooldown_harvest || 0;
    if (harvestStacks > 0) {
      if (this.cooldownHarvestWindowTimer <= 0) {
        this.cooldownHarvestWindowTimer = 1.0;
        this.cooldownHarvestThisSecond = 0;
      }
      const allowed = Math.min(0.5 - this.cooldownHarvestThisSecond, 0.08 * harvestStacks);
      if (allowed > 0) {
        this.cooldownHarvestThisSecond += allowed;
        p.secondaryCooldownRemaining = Math.max(0, p.secondaryCooldownRemaining - allowed);
        p.utilityCooldownRemaining = Math.max(0, p.utilityCooldownRemaining - allowed);
        p.ultimateCooldownRemaining = Math.max(0, p.ultimateCooldownRemaining - allowed);
      }
    }

    // T11 Fuel Harvest: Each kill restores 1.5 * n jetpack fuel
    const fuelHarvestStacks = p.buffs.buff_fuel_harvest || 0;
    if (fuelHarvestStacks > 0) {
      p.jetpackFuel = Math.min(p.maxJetpackFuel, p.jetpackFuel + 1.5 * fuelHarvestStacks);
    }

    // T12 Killing Momentum: Each kill grants +1% * n move speed for 3s (up to 3 stacks)
    const kmStacks = p.buffs.buff_killing_momentum || 0;
    if (kmStacks > 0) {
      p.killingMomentumTimer = 3.0;
      p.killingMomentumStacks = Math.min(3, (p.killingMomentumStacks || 0) + 1);
      this.state.updateCalculatedStats();
    }

    // T14 Overkill: 4% * n excess killing-blow damage jumps to 1 nearest enemy within 280u (cap 25% base LMB damage)
    const overkillStacks = p.buffs.buff_overkill || 0;
    if (!isRecursiveKill && overkillStacks > 0 && excessDamage > 0) {
      const capDmg = 0.25 * p.baseLmbDamage * p.calculatedStats.damageMultiplier;
      const spreadDmg = Math.max(1, Math.min(capDmg, excessDamage * 0.04 * overkillStacks));
      const nearby = this.spatialGrid
        .getNearby(enemy.pos, 280)
        .filter((c) => c.id !== enemy.id && c.health > 0)
        .sort((a, b) => Math.hypot(a.pos.x - enemy.pos.x, a.pos.y - enemy.pos.y) - Math.hypot(b.pos.x - enemy.pos.x, b.pos.y - enemy.pos.y));
      if (nearby.length > 0) {
        this.damageEnemy(nearby[0], spreadDmg, nearby[0].pos, 'physical', { isRecursiveTrigger: true });
      }
    }

    // Lifesteal on kill (legacy old-save safety)
    if (p.calculatedStats.lifestealOnKill > 0) {
      p.health = Math.min(p.maxHealth, p.health + p.calculatedStats.lifestealOnKill);
    }

    // 1. Spawn physical Currency Drops (Genes)
    const isCorruption = this.isCorruptionActive();
    const geneMult = isCorruption ? 3 : 1;
    const shardCount = enemy.isBoss ? 8 : enemy.isElite ? 4 : 2;
    const enemyReward = enemy.currencyReward ?? 1;
    const totalGeneReward = Math.max(1, Math.round(enemyReward * geneMult));
    const baseVal = Math.max(1, Math.floor(totalGeneReward / shardCount));
    let remainder = totalGeneReward - baseVal * shardCount;

    for (let s = 0; s < shardCount; s++) {
      const val = baseVal + (remainder > 0 ? 1 : 0);
      if (remainder > 0) remainder--;
      this.spawnCurrencyDrop(enemy.pos, val);
    }

    // 2. Random Buff Capsule Drop (no legacy passive items, no modal interrupt)
    let buffDropChance = 0;
    if (enemy.isBoss) {
      buffDropChance = 1.0;
    } else if (enemy.isElite) {
      buffDropChance = 0.05;
    }

    if (buffDropChance > 0 && this.state.lootRng.next() < buffDropChance) {
      this.spawnBuffCapsuleDrop(enemy.pos, 'elite');
    }

    // Track kill progress in Trial of Corruption if active
    for (let w = 0; w < this.state.worldEvents.length; w++) {
      const ev = this.state.worldEvents[w];
      if (ev.type === 'void_corruption' && ev.isActive && !ev.isCompleted) {
        ev.killCount = (ev.killCount || 0) + 1;
      }
    }

    // 3. Grant XP & Level Up (spawns physical Augment Capsule instead of automatic modal interrupt!)
    p.xp += enemy.xpReward;
    while (p.xp >= p.xpNeeded) {
      p.xp -= p.xpNeeded;
      p.level++;
      p.xpNeeded = Math.round(p.xpNeeded * 1.6 + 8);
      // Spawn physical Augment Capsule at enemy death position for player to pick up
      this.spawnBuffCapsuleDrop(enemy.pos, 'level');
      this.state.events.push({
        type: 'level_up',
        data: { level: p.level }
      });
    }

    // 4. Advance Overseer Artifact charge (Stage1Titan already emits boss_defeated at dying start in damageEnemy)
    if (enemy.isBoss && !enemy.isStage1Titan) {
      this.state.events.push({
        type: 'boss_defeated',
        data: {
          name: 'Brood Queen',
          isStage1Boss: false,
          pos: { ...enemy.pos },
          z: enemy.z
        }
      });
    }

    const artifactPolicy = getStageArtifactPolicy(this.state.stageNumber);
    if (artifactPolicy.usesCharging && !this.state.artifact.isCharged) {
      const chargeAmt = enemy.isBoss
        ? this.state.artifact.chargePerKill * 5
        : enemy.isElite
          ? this.state.artifact.chargePerKill * 2.5
          : this.state.artifact.chargePerKill;

      this.state.artifact.chargeProgress = Math.min(
        100,
        this.state.artifact.chargeProgress + chargeAmt
      );
      if (this.state.artifact.chargeProgress >= 100 && !this.state.artifact.isCharged) {
        this.state.artifact.chargeProgress = 100;
        this.state.artifact.isCharged = true;
        this.state.artifact.isTeleporterReady = true;
        this.state.artifact.phase = 'unlocked_ready';
        this.state.events.push({ type: 'artifact_charged', data: {} });
      }
    }

    this.state.events.push({
      type: 'enemy_killed',
      data: {
        enemyId: enemy.id,
        type: enemy.type,
        pos: { ...enemy.pos },
        z: enemy.z,
        radius: enemy.radius,
        isElite: Boolean(enemy.isElite),
        isBoss: Boolean(enemy.isBoss),
        reward: enemy.currencyReward
      }
    });
  }

  private spawnCurrencyDrop(origin: Vector2, value: number): void {
    // Cap active currency objects by merging into nearest drop if limit exceeded
    if (this.state.currencyDrops.length >= LOOT_CONFIG.maxCurrencyObjects) {
      let nearest = this.state.currencyDrops[0];
      let minD2 = Infinity;
      for (let i = 0; i < this.state.currencyDrops.length; i++) {
        const d = this.state.currencyDrops[i];
        const d2 = (d.pos.x - origin.x) ** 2 + (d.pos.y - origin.y) ** 2;
        if (d2 < minD2) {
          minD2 = d2;
          nearest = d;
        }
      }
      if (nearest) {
        nearest.value += value;
        return;
      }
    }

    const angle = this.state.rng.range(0, Math.PI * 2);
    const speed = this.state.rng.range(45, 110);
    const originElevation = this.state.terrain.getElevation(origin.x, origin.y).height;

    this.state.currencyDrops.push({
      id: `drop_${this.nextDropId++}`,
      pos: { x: origin.x, y: origin.y },
      vel: { x: Math.cos(angle) * speed, y: Math.sin(angle) * speed },
      z: originElevation + 8,
      vz: this.state.rng.range(160, 220),
      settled: false,
      value,
      lifetime: 45
    });
  }

  public spawnPhysicalItemDrop(origin: Vector2, itemId: ItemId): void {
    const angle = this.state.lootRng.range(0, Math.PI * 2);
    const speed = this.state.lootRng.range(55, 95);
    const originElevation = this.state.terrain.getElevation(origin.x, origin.y).height;

    this.state.itemDrops.push({
      id: `itemdrop_${this.nextItemDropId++}`,
      itemId,
      pos: { x: origin.x, y: origin.y },
      vel: { x: Math.cos(angle) * speed, y: Math.sin(angle) * speed },
      z: originElevation + 12,
      vz: 240,
      settled: false,
      lifetime: 90
    });

    this.state.events.push({
      type: 'item_dropped',
      data: { itemId, pos: { ...origin } }
    });
  }

  public spawnBuffCapsuleDrop(origin: Vector2, dropOrigin: 'level' | 'elite' = 'level'): void {
    const rolledBuff = rollWeightedRandomBuff(this.state.lootRng, this.state.player);
    if (!rolledBuff) return;

    const angle = this.state.lootRng.range(0, Math.PI * 2);
    const speed = this.state.lootRng.range(45, 85);
    const originElevation = this.state.terrain.getElevation(origin.x, origin.y).height;

    this.state.itemDrops.push({
      id: `buffdrop_${dropOrigin}_${this.nextItemDropId++}`,
      buffId: rolledBuff,
      isBuffDrop: true,
      pos: { x: origin.x, y: origin.y },
      vel: { x: Math.cos(angle) * speed, y: Math.sin(angle) * speed },
      z: originElevation + 14,
      vz: 260,
      settled: false,
      lifetime: 120
    });

    this.state.events.push({
      type: 'item_dropped',
      data: { isBuffDrop: true, buffId: rolledBuff, pos: { ...origin } }
    });
  }

  /**
   * Enforces per-volley attack-instance deduplication and a short projectile-volley
   * grace period so multi-projectile volleys never stack unfair overlapping burst damage.
   */
  private applyEnemyProjectileHitToPlayer(proj: ProjectileState): boolean {
    const p = this.state.player;
    if (this.devPlayerInvulnerable) return false;
    if (p.isDashing || (p.phaseBarrierTimer ?? 0) > 0 || p.health <= 0) return false;

    if (proj.attackInstanceId !== undefined) {
      if (!p.hitByEnemyAttackInstanceIds) {
        p.hitByEnemyAttackInstanceIds = new Map<number, number>();
      }
      if (p.hitByEnemyAttackInstanceIds.has(proj.attackInstanceId)) {
        return false; // Same volley already dealt direct hit damage
      }
    }

    if ((p.enemyProjectileGraceTimer ?? 0) > 0) {
      return false; // Within short projectile-volley burst grace window
    }

    if (proj.attackInstanceId !== undefined && p.hitByEnemyAttackInstanceIds) {
      p.hitByEnemyAttackInstanceIds.set(proj.attackInstanceId, 6.0);
    }
    p.enemyProjectileGraceTimer = ENEMY_COMBAT_BALANCE.projectileHitGraceSec;
    this.damagePlayer(proj.damage, false, undefined, 'projectile');
    return true;
  }

  private handleEliteOrBossKillRewards(enemy: EnemyState): void {
    if (!(enemy.isElite || enemy.isBoss)) return;
    const p = this.state.player;
    const apexStacks = Math.min(3, p.buffs.buff_apex_barrier || 0);
    if (apexStacks > 0 && (p.timedEffectCooldowns?.apex_barrier ?? 0) <= 0 && p.health > 0) {
      const shieldPct = 0.08 + 0.04 * (apexStacks - 1);
      const barrierGain = Math.round(p.maxHealth * shieldPct);
      p.tempShieldAmount = Math.max(p.tempShieldAmount || 0, barrierGain);
      p.tempShieldTimer = Math.max(p.tempShieldTimer || 0, 6.0);
      this.triggerTimedEffect('apex_barrier', 6.0, 10.0, 'buff_apex_barrier');
    }
  }

  private damagePlayer(
    amount: number,
    bypassInvuln: boolean = false,
    attacker?: EnemyState,
    damageSource: 'projectile' | 'melee' | 'beam' | 'other' = 'other'
  ): void {
    const p = this.state.player;
    if (this.devPlayerInvulnerable) return;
    if (p.isDashing || (p.phaseBarrierTimer ?? 0) > 0 || p.health <= 0) return;
    if (!bypassInvuln && (p.hurtInvulnTimer ?? 0) > 0) return;

    // 20% overall enemy damage reduction across all enemy/boss damage sources
    amount = amount * 0.8;

    const prevHealth = p.health;
    const dr = Math.min(0.85, Math.max(0, p.calculatedStats.damageReduction || 0));
    let actualDamage = amount * (1 - dr);
    if (damageSource === 'projectile' && (p.calculatedStats.projectileDamageMitigation || 0) > 0) {
      actualDamage *= 1 - Math.min(0.45, p.calculatedStats.projectileDamageMitigation!);
    } else if (damageSource === 'melee' && (p.calculatedStats.meleeDamageMitigation || 0) > 0) {
      actualDamage *= 1 - Math.min(0.45, p.calculatedStats.meleeDamageMitigation!);
    }
    if (p.defenseBonusTimer > 0) {
      actualDamage = Math.round(actualDamage * (1 - p.defenseBonusReduction));
    }

    // Flat armor reduction
    if (p.calculatedStats.flatArmor > 0) {
      actualDamage = Math.max(1, actualDamage - p.calculatedStats.flatArmor);
    }

    // T13 Reactive Shield: Taking >15% max HP in a single hit grants 4% * n max HP shield for 3s (15s ICD)
    const rsStacks = p.buffs.buff_reactive_shield || 0;
    if (rsStacks > 0 && p.reactiveShieldCooldown <= 0 && actualDamage > p.maxHealth * 0.15) {
      p.reactiveShieldCooldown = 15.0;
      const barrierGain = Math.round(p.maxHealth * 0.04 * rsStacks);
      p.tempShieldAmount = Math.max(p.tempShieldAmount || 0, barrierGain);
      p.tempShieldTimer = Math.max(p.tempShieldTimer || 0, 3.0);
    }

    // Temporary Barrier Shield (Emergency Barrier / Reactive Shield / Kinetic Shell) absorbs damage first
    if ((p.tempShieldAmount || 0) > 0) {
      if (p.tempShieldAmount >= actualDamage) {
        p.tempShieldAmount -= actualDamage;
        actualDamage = 0;
      } else {
        actualDamage -= p.tempShieldAmount;
        p.tempShieldAmount = 0;
      }
    }

    // Energy Shield absorbs remaining damage
    if (p.energyShield > 0 && actualDamage > 0) {
      if (p.energyShield >= actualDamage) {
        p.energyShield -= actualDamage;
        actualDamage = 0;
      } else {
        actualDamage -= p.energyShield;
        p.energyShield = 0;
      }
    }

    if (actualDamage > 0) {
      p.health = Math.max(0, p.health - Math.round(actualDamage));
    }
    p.defenseBonusTimer = p.defenseBonusDuration;
    if (!bypassInvuln) {
      p.hurtInvulnTimer = 0.25;
    }

    // U13 Thorns: Reflect 6% * n of incoming damage back to attacking enemy (non-recursive)
    if (p.calculatedStats.thornsReflectFraction > 0 && amount > 0) {
      let targetAttacker = attacker && attacker.health > 0 ? attacker : undefined;
      if (!targetAttacker) {
        targetAttacker = this.spatialGrid.findNearest(p.pos, 190) || undefined;
      }
      if (targetAttacker && targetAttacker.health > 0) {
        const reflected = Math.max(1, Math.round(amount * p.calculatedStats.thornsReflectFraction));
        this.damageEnemy(targetAttacker, reflected, targetAttacker.pos, 'physical', { isRecursiveTrigger: true });
      }
    }

    let statsDirty = false;

    // T09 Retaliation: Taking damage grants +2% * n all damage for 3s (non-stacking duration refresh)
    if ((p.buffs.buff_retaliation || 0) > 0) {
      p.retaliationTimer = 3.0;
      statsDirty = true;
    }

    // U14 Emergency Barrier: Below 30% HP gain 4% * n max HP barrier for 3s (25s ICD)
    if (
      p.health > 0 &&
      p.health / Math.max(1, p.maxHealth) < 0.30 &&
      p.emergencyBarrierCooldown <= 0 &&
      p.calculatedStats.emergencyBarrierFraction > 0
    ) {
      p.emergencyBarrierCooldown = 25.0;
      const barrierAmt = Math.round(p.maxHealth * p.calculatedStats.emergencyBarrierFraction);
      p.tempShieldAmount = Math.max(p.tempShieldAmount || 0, barrierAmt);
      p.tempShieldTimer = Math.max(p.tempShieldTimer || 0, 3.0);
    }

    // T15 Survival Instinct: Dropping below 25% HP grants stun immunity (cap 1s) + move speed for 3s (30s ICD)
    const siStacks = p.buffs.buff_survival_instinct || 0;
    if (
      siStacks > 0 &&
      p.health > 0 &&
      prevHealth / Math.max(1, p.maxHealth) >= 0.25 &&
      p.health / Math.max(1, p.maxHealth) < 0.25 &&
      p.survivalInstinctCooldown <= 0
    ) {
      p.survivalInstinctCooldown = 30.0;
      p.stunImmunityTimer = Math.min(1.0, 0.25 * siStacks);
      p.survivalInstinctTimer = 3.0;
      statsDirty = true;
    }

    // T06 Final Stand: Recompute stats if crossing below 40% HP
    if (
      (p.buffs.buff_final_stand || 0) > 0 &&
      prevHealth / Math.max(1, p.maxHealth) >= 0.40 &&
      p.health / Math.max(1, p.maxHealth) < 0.40
    ) {
      statsDirty = true;
    }

    if (statsDirty) {
      this.state.updateCalculatedStats();
    }

    this.state.events.push({
      type: 'player_hit',
      data: { damage: Math.round(actualDamage), remainingHealth: p.health, resolveActive: true }
    });

    if (p.health <= 0) {
      if (p.calculatedStats.hasSecondWind) {
        p.calculatedStats.hasSecondWind = false;
        p.health = Math.round(p.maxHealth * 0.6);
        this.state.events.push({
          type: 'orbital_impact',
          data: { target: { ...p.pos }, z: p.z, radius: 120, variant: 'second_wind' }
        });
        return;
      }
      this.state.isGameOver = true;
      this.state.events.push({ type: 'game_over', data: {} });
    }
  }

  private getGroundedMoveVelocity(
    e: EnemyState,
    enemySpeed: number,
    dt: number,
    targetPosOverride?: Vector2
  ): { vx: number; vy: number } {
    const p = this.state.player;
    const tPos = targetPosOverride || p.pos;
    const tZ = targetPosOverride ? this.state.terrain.getElevation(tPos.x, tPos.y).height : p.z;

    // 1. Perpendicular Tangent Recovery Movement (if recovering from cliff/wall obstruction)
    if (e.recoveryTimer && e.recoveryTimer > 0) {
      e.recoveryTimer -= dt;
      if (e.recoveryDir) {
        return {
          vx: e.recoveryDir.x * enemySpeed,
          vy: e.recoveryDir.y * enemySpeed
        };
      }
    }

    // 2. Navigation Waypoint throttling & recalculation (distributed frame budgeting)
    e.navTimer = (e.navTimer ?? 0) - dt;
    const distToWp = e.navWaypoint
      ? Math.hypot(e.navWaypoint.x - e.pos.x, e.navWaypoint.y - e.pos.y)
      : Infinity;

    const distToTarget = Math.hypot(tPos.x - e.pos.x, tPos.y - e.pos.y);
    const heightDiff = Math.abs(tZ - e.z);
    const targetShifted = !e.navGoalPos
      || Math.hypot(tPos.x - e.navGoalPos.x, tPos.y - e.navGoalPos.y) > 120
      || Math.abs(tZ - e.navGoalPos.z) > 40;

    // Eliminate blind 2D distance bypass: only charge directly on matching elevation with clean nav segment
    const isDirectWalk = heightDiff < 28 && this.state.terrain.isSegmentClearForNav(e.pos, tPos);

    if (isDirectWalk && distToTarget < 180) {
      e.navWaypoint = { x: tPos.x, y: tPos.y };
      e.navGoalPos = { x: tPos.x, y: tPos.y, z: tZ };
      e.navTimer = 0.25;
      e.isTargetReachable = true;
      e.navStatus = 'direct';
    } else if (
      this.navCalcsThisTick < 36 &&
      (!e.navWaypoint || distToWp < 28 || targetShifted || e.navTimer <= 0)
    ) {
      const prevWp = e.navWaypoint;
      const wasPathfinding = e.navStatus === 'pathfinding';
      const midLegRefresh = !!prevWp && distToWp >= 28 && !targetShifted && (e.stuckTimer ?? 0) < 0.25;

      const navRes = this.state.terrain.getNavWaypointInfo(e.pos, tPos, false, e.z, tZ);
      e.isTargetReachable = navRes.isReachable;
      e.navStatus = navRes.status;
      e.navGoalPos = { x: tPos.x, y: tPos.y, z: tZ };

      // Unique deterministic per-enemy angular offset to prevent single-point stacking
      const hash = (e.id.charCodeAt(e.id.length - 1) * 31 + e.id.charCodeAt(0)) % 100;
      const angleOffset = (hash / 100) * Math.PI * 2;
      const spreadDist = (hash % 20) + 10;

      if (!navRes.isReachable) {
        // Target is unreachable on foot (e.g. player on inaccessible mountain peak)
        if (navRes.isAtStandoff) {
          // Already within tactical vantage zone! Enter controlled perimeter reposition/loiter
          e.standoffAngle = (e.standoffAngle ?? angleOffset) + dt * 0.4;
          const px = tPos.x + Math.cos(e.standoffAngle) * (175 + spreadDist);
          const py = tPos.y + Math.sin(e.standoffAngle) * (175 + spreadDist);
          e.navWaypoint = { x: px, y: py };
        } else {
          // Move towards standoff vantage waypoint
          e.navWaypoint = navRes.waypoint;
        }
      } else {
        // Path is reachable: approach waypoints. Add slight target spread when closing in
        if (navRes.status === 'direct' && distToTarget > 55) {
          e.navWaypoint = {
            x: navRes.waypoint.x + Math.cos(angleOffset) * spreadDist,
            y: navRes.waypoint.y + Math.sin(angleOffset) * spreadDist
          };
        } else if (midLegRefresh && wasPathfinding && navRes.status === 'pathfinding' && prevWp) {
          // Guard against stateless startNode reversal mid-leg while enemy is making steady unblocked progress
          const oldDx = prevWp.x - e.pos.x;
          const oldDy = prevWp.y - e.pos.y;
          const newDx = navRes.waypoint.x - e.pos.x;
          const newDy = navRes.waypoint.y - e.pos.y;
          const oldLen = Math.hypot(oldDx, oldDy) || 1;
          const newLen = Math.hypot(newDx, newDy) || 1;
          const dirDot = (oldDx / oldLen) * (newDx / newLen) + (oldDy / oldLen) * (newDy / newLen);
          e.navWaypoint = dirDot < -0.25 ? prevWp : navRes.waypoint;
        } else {
          e.navWaypoint = navRes.waypoint;
        }
      }

      const newWpDist = Math.hypot(e.navWaypoint.x - e.pos.x, e.navWaypoint.y - e.pos.y);
      const rngVal = this.state.rng ? this.state.rng.next() : Math.random();
      if (navRes.status === 'pathfinding' && newWpDist > 75) {
        // Commit through intermediate graph leg so edge micro-bumps do not pull enemies backward mid-leg
        e.navTimer = Math.min(6.0, newWpDist / Math.max(45, enemySpeed) + 1.2);
      } else {
        e.navTimer = 0.35 + rngVal * 0.25;
      }
      this.navCalcsThisTick++;
    }

    const ndx = (e.navWaypoint?.x ?? tPos.x) - e.pos.x;
    const ndy = (e.navWaypoint?.y ?? tPos.y) - e.pos.y;
    const nlen = Math.hypot(ndx, ndy) || 1;

    let baseVx = (ndx / nlen) * enemySpeed;
    let baseVy = (ndy / nlen) * enemySpeed;

    // Controlled crowd separation steering via SpatialGrid (eliminates O(N^2) scan)
    let avoidVx = 0;
    let avoidVy = 0;
    const crowdRadius = e.radius * 2.2;
    const nearbyCrowd = this.spatialGrid.getNearby(e.pos, crowdRadius + 24);
    for (let c = 0; c < nearbyCrowd.length; c++) {
      const other = nearbyCrowd[c];
      if (other.id === e.id || other.health <= 0) continue;
      const cdx = e.pos.x - other.pos.x;
      const cdy = e.pos.y - other.pos.y;
      if (Math.abs(cdx) > crowdRadius || Math.abs(cdy) > crowdRadius) continue;
      const cDist = Math.hypot(cdx, cdy);
      if (cDist > 0.1 && cDist < crowdRadius) {
        const factor = (crowdRadius - cDist) / crowdRadius;
        avoidVx += (cdx / cDist) * factor * (enemySpeed * 0.35);
        avoidVy += (cdy / cDist) * factor * (enemySpeed * 0.35);
      }
    }

    // Proactive obstacle deflection: guide ground enemies smoothly around rocks/trees/crystals/ship hull
    if (!e.isStage1Titan) {
      const fwdX = ndx / nlen;
      const fwdY = ndy / nlen;
      const sideSign = (e.id.charCodeAt(e.id.length - 1) % 2 === 0) ? 1 : -1;
      for (let o = 0; o < this.state.obstacles.length; o++) {
        const obs = this.state.obstacles[o];
        const odx = e.pos.x - obs.pos.x;
        const ody = e.pos.y - obs.pos.y;
        const avoidDist = obs.radius + e.radius + 36;
        if (Math.abs(odx) > avoidDist || Math.abs(ody) > avoidDist) continue;
        const oDist = Math.hypot(odx, ody) || 0.001;
        if (oDist < avoidDist) {
          const dotAhead = (-odx / oDist) * fwdX + (-ody / oDist) * fwdY;
          if (dotAhead > 0.12) {
            const strength = ((avoidDist - oDist) / avoidDist) * dotAhead;
            const rx = odx / oDist;
            const ry = ody / oDist;
            const tx = -ry * sideSign;
            const ty = rx * sideSign;
            avoidVx += (rx * 0.5 + tx * 0.95) * strength * enemySpeed * 1.1;
            avoidVy += (ry * 0.5 + ty * 0.95) * strength * enemySpeed * 1.1;
          }
        }
      }
    }

    const totalVx = baseVx + avoidVx;
    const totalVy = baseVy + avoidVy;
    const totalSpeed = Math.hypot(totalVx, totalVy);
    if (totalSpeed > enemySpeed * 1.15 && totalSpeed > 0.001) {
      const clamp = (enemySpeed * 1.15) / totalSpeed;
      return { vx: totalVx * clamp, vy: totalVy * clamp };
    }
    return {
      vx: totalVx,
      vy: totalVy
    };
  }

  private updateEnemies(dt: number): void {
    const p = this.state.player;
    const alive: EnemyState[] = [];

    for (let i = 0; i < this.state.enemies.length; i++) {
      const e = this.state.enemies[i];
      if (e.health <= 0 && !(e.isStage1Titan && e.titanState === 'dying')) continue;

      if (e.attackCooldownRemaining > 0) {
        e.attackCooldownRemaining -= dt;
      }
      if ((e.contactCooldownRemaining ?? 0) > 0) {
        e.contactCooldownRemaining = Math.max(0, (e.contactCooldownRemaining ?? 0) - dt);
      }

      // Emerging from the ground animation (crawling upward)
      if (e.isSpawning) {
        e.spawnProgress = (e.spawnProgress ?? 0) + dt / (e.spawnDuration ?? 1.25);
        e.groundZ = this.state.terrain.getElevation(e.pos.x, e.pos.y).height;
        const progress = Math.min(1.0, e.spawnProgress);
        e.z = e.groundZ - 24 * (1 - progress);
        if (e.spawnProgress >= 1.0) {
          e.isSpawning = false;
          e.z = e.groundZ;
        }
        alive.push(e);
        continue; // Cannot move or attack until fully crawled out of ground
      }

      // Status effects
      if (e.isStunned && e.stunTimer !== undefined) {
        e.rangedWindupTimer = 0;
        e.lockedAttackDir = undefined;
        e.lockedAttackVariant = undefined;
        e.lockedTargetPos = undefined;
        e.stunTimer -= dt;
        if (e.stunTimer <= 0) {
          e.isStunned = false;
          e.stunTimer = 0;
        }
        alive.push(e);
        continue;
      }

      if (e.isChilled && e.chillTimer !== undefined) {
        e.chillTimer -= dt;
        if (e.chillTimer <= 0) {
          e.isChilled = false;
          e.chillTimer = 0;
          e.chillStrength = undefined;
        }
      }

      if ((e.bleedTimer ?? 0) > 0) {
        e.bleedTimer = Math.max(0, (e.bleedTimer ?? 0) - dt);
        e.bleedTickTimer = (e.bleedTickTimer ?? 0.25) - dt;
        if (e.bleedTickTimer <= 0) {
          e.bleedTickTimer += 0.25;
          const tickDmg = Math.max(1, Math.round((e.bleedDps ?? 0) * 0.25));
          this.damageEnemy(e, tickDmg, e.pos, 'physical', { isRecursiveTrigger: true });
          if (e.health <= 0) continue;
        }
        if (e.bleedTimer <= 0) {
          e.bleedDps = 0;
        }
      }

      if (e.isElectrified && e.electrifiedTimer !== undefined) {
        e.electrifiedTimer -= dt;
        if (e.electrifiedTimer <= 0) {
          e.isElectrified = false;
          e.electrifiedTimer = 0;
        }
      }

      if (e.isToxic && e.toxicTimer !== undefined) {
        e.toxicTimer -= dt;
        e.health -= 14 * dt;
        if (e.toxicTimer <= 0) {
          e.isToxic = false;
          e.toxicTimer = 0;
        }
        if (e.health <= 0) {
          this.killEnemy(e);
          continue;
        }
      }

      if ((e.toxicSlowTimer ?? 0) > 0) {
        e.toxicSlowTimer = Math.max(0, (e.toxicSlowTimer ?? 0) - dt);
      }
      if ((e.poisonStackTimer ?? 0) > 0) {
        e.poisonStackTimer = Math.max(0, (e.poisonStackTimer ?? 0) - dt);
        if (e.poisonStackTimer <= 0) {
          e.poisonStacks = 0;
        }
      }

      const isAirborneUnit = Boolean(e.type === 'wasp' || (e.isBoss && !e.isStage1Titan));
      const isBossInLeap = Boolean(e.isBossLeaping || e.titanState === 'leap');
      // Height check: enemy adapts to terrain elevation (preserving under-bridge vs bridge top layers)
      const preSample = this.state.terrain.getElevation(e.pos.x, e.pos.y, e.z, 26);
      e.groundZ = preSample.height;
      if (isAirborneUnit) {
        e.z = Math.max(e.z, e.groundZ + 28);
      } else if (!isBossInLeap && (!e.isStage1Titan || e.titanState !== 'emerging')) {
        e.z = e.groundZ;
      }
      e.inWater = Boolean(!isAirborneUnit && preSample.isInWater && e.z <= preSample.height + 10);

      const isCorruption = this.isCorruptionActive();
      const corruptionFrenzy = isCorruption ? 1.35 : 1.0;
      const slowFactor = e.isChilled
        ? Math.max(0.15, 1 - (e.chillStrength ?? 0.50))
        : (e.toxicSlowTimer ?? 0) > 0
          ? 0.70
          : 1.0;
      const waterPenalty = e.inWater ? 0.5 : 1.0;
      const enemySpeed = e.speed * slowFactor * corruptionFrenzy * waterPenalty;

      // Holographic Decoy taunt: non-Stage1Titan enemies within decoy tauntRadius divert aggro to decoy
      let targetDecoy: HolographicDecoyState | null = null;
      if (!e.isStage1Titan && this.state.holographicDecoys.length > 0) {
        let bestDecoyDist = Infinity;
        for (let hd = 0; hd < this.state.holographicDecoys.length; hd++) {
          const decoy = this.state.holographicDecoys[hd];
          if (decoy.hitsRemaining <= 0) continue;
          const dDecoy = Math.hypot(decoy.pos.x - e.pos.x, decoy.pos.y - e.pos.y);
          if (dDecoy <= decoy.tauntRadius && dDecoy < bestDecoyDist) {
            bestDecoyDist = dDecoy;
            targetDecoy = decoy;
          }
        }
      }

      const targetPos = targetDecoy ? targetDecoy.pos : p.pos;
      const targetPosZ = targetDecoy ? targetDecoy.z : p.z;
      const dx = targetPos.x - e.pos.x;
      const dy = targetPos.y - e.pos.y;
      const dist = Math.hypot(dx, dy) || 1;
      const applyTargetDamage = (dmg: number) => {
        if (targetDecoy) {
          targetDecoy.hitsRemaining = Math.max(0, targetDecoy.hitsRemaining - 1);
        } else {
          this.damagePlayer(dmg, false, e, 'melee');
          if (p.calculatedStats.thornsDamage > 0) {
            this.damageEnemy(e, p.calculatedStats.thornsDamage, e.pos, undefined, { isRecursiveTrigger: true });
          }
        }
      };

      // Detection & Aggro Range Check (keep enemies actively pursuing instead of pooling far away)
      const detectionRange = e.isBoss ? 3600 : e.isElite || e.type === 'wasp' ? 3200 : 2800;
      if (dist <= detectionRange) {
        e.isAlerted = true;
      }

      let moveVx = 0;
      let moveVy = 0;

      if (e.isStage1Titan) {
        // --- 0. STAGE 1 MAIN BOSS (TITAN COLOSSUS) ---
        if (!this.devBossAiPaused || (e.titanState && e.titanState !== 'idle' && e.titanState !== 'walk')) {
          this.updateStage1Titan(e, dt);
        } else {
          e.velocity.x = 0;
          e.velocity.y = 0;
        }
        moveVx = e.velocity.x;
        moveVy = e.velocity.y;
      } else if (this.devEnemyAiPaused) {
        moveVx = 0;
        moveVy = 0;
      } else if (!e.isAlerted) {
        // Unalerted: gently wander and patrol locally at 25% speed
        e.wanderTimer = (e.wanderTimer ?? 2) - dt;
        if (e.wanderTimer <= 0) {
          const randAng = this.state.rng.range(0, Math.PI * 2);
          e.wanderDir = { x: Math.cos(randAng), y: Math.sin(randAng) };
          e.wanderTimer = this.state.rng.range(2.5, 5.0);
        }
        moveVx = (e.wanderDir?.x ?? 0) * (enemySpeed * 0.25);
        moveVy = (e.wanderDir?.y ?? 0) * (enemySpeed * 0.25);
      } else if (e.isBoss) {
        // --- 1. BROOD QUEEN (FLYING SOVEREIGN) ---
        // Aerial circling and swooping
        if (dist > 300) {
          moveVx = (dx / dist) * enemySpeed;
          moveVy = (dy / dist) * enemySpeed;
        } else if (dist < 180) {
          moveVx = -(dx / dist) * (enemySpeed * 0.7);
          moveVy = -(dy / dist) * (enemySpeed * 0.7);
        } else {
          // Strafe in aerial orbit
          moveVx = (-dy / dist) * (enemySpeed * 0.65);
          moveVy = (dx / dist) * (enemySpeed * 0.65);
        }

        // Brood Queen Ranged Attacks: visible 0.8s windup -> locked aim -> 2 separated stingers or 1 spore bomb (-35% frequency)
        const canBossShoot = Boolean(ENEMY_PROJECTILE_PERMISSIONS[e.type]);
        if ((e.rangedWindupTimer ?? 0) > 0) {
          moveVx *= 0.15;
          moveVy *= 0.15;
          e.rangedWindupTimer = Math.max(0, (e.rangedWindupTimer ?? 0) - dt);
          if (e.rangedWindupTimer <= 0 && canBossShoot) {
            const originZ = e.z + 40;
            const lockedDir = e.lockedAttackDir ?? { x: dx, y: dy, z: targetPosZ + 26 - originZ };
            const lockedTgt = e.lockedTargetPos ?? { x: targetPos.x, y: targetPos.y, z: targetPosZ + 26 };
            const ldx = lockedDir.x;
            const ldy = lockedDir.y;
            const lDist = Math.hypot(ldx, ldy) || 1;
            const ldz = lockedDir.z;
            const attackInstanceId = this.nextEnemyAttackInstanceId++;

            if (e.lockedAttackVariant === 'spore_bomb') {
              const bombSpeed = Math.max(150, lDist * 0.85);
              const timeToTarget = Math.max(0.65, lDist / bombSpeed);
              const gravity = 360;
              const bombVz = (ldz / timeToTarget) + 0.5 * gravity * timeToTarget;

              this.state.projectiles.push({
                id: `proj_${this.nextProjId++}`,
                type: 'spore_bomb',
                pos: { x: e.pos.x, y: e.pos.y },
                z: originZ,
                velocity: { x: (ldx / lDist) * bombSpeed, y: (ldy / lDist) * bombSpeed },
                vz: bombVz,
                speed: bombSpeed,
                damage: ENEMY_COMBAT_BALANCE.broodQueenSporeBombDamage,
                pierceCount: 1,
                maxDistance: Math.max(120, lDist),
                distanceTraveled: 0,
                owner: 'enemy',
                radius: ENEMY_COMBAT_BALANCE.broodQueenSporeBombRadius,
                hitEnemyIds: new Set(),
                originZ,
                targetZ: lockedTgt.z,
                attackInstanceId
              });
            } else {
              // Dual Separated Stinger Split (dodgeable open center lane, zero post-launch tracking)
              const stingerSpeed = ENEMY_COMBAT_BALANCE.broodQueenStingerSpeed;
              const baseAng = Math.atan2(ldy, ldx);
              const dist3D = Math.hypot(ldx, ldy, ldz) || 1;
              const pitch = Math.asin(Math.max(-0.95, Math.min(0.95, ldz / dist3D)));
              const horizSpeed = Math.cos(pitch) * stingerSpeed;
              const vz = Math.sin(pitch) * stingerSpeed;
              const fanAngles = ENEMY_COMBAT_BALANCE.broodQueenStingerAngles;

              for (let f = 0; f < fanAngles.length; f++) {
                const ang = baseAng + fanAngles[f];
                this.state.projectiles.push({
                  id: `proj_${this.nextProjId++}`,
                  type: 'queen_stinger',
                  pos: { x: e.pos.x, y: e.pos.y },
                  z: originZ,
                  velocity: { x: Math.cos(ang) * horizSpeed, y: Math.sin(ang) * horizSpeed },
                  vz,
                  speed: stingerSpeed,
                  damage: ENEMY_COMBAT_BALANCE.broodQueenStingerDamage,
                  pierceCount: 1,
                  maxDistance: 540,
                  distanceTraveled: 0,
                  owner: 'enemy',
                  radius: ENEMY_COMBAT_BALANCE.broodQueenStingerRadius,
                  hitEnemyIds: new Set(),
                  originZ,
                  targetZ: lockedTgt.z,
                  attackInstanceId
                });
              }
            }

            e.lockedAttackDir = undefined;
            e.lockedAttackVariant = undefined;
            e.lockedTargetPos = undefined;
            e.attackCooldownRemaining = Math.max(
              0.45,
              (e.attackCooldown || ENEMY_COMBAT_BALANCE.broodQueenCycleInterval) - ENEMY_COMBAT_BALANCE.broodQueenWindup
            );
            this.state.events.push({
              type: 'enemy_projectile_fired',
              data: { id: e.id, type: e.type, pos: { ...e.pos }, z: originZ }
            });
          }
        } else if (canBossShoot && dist <= 560 && e.attackCooldownRemaining <= 0) {
          const originZ = e.z + 80;
          const targetZ = targetPosZ + 52;
          if (this.hasEnemyAttackLOS3D(e.pos, originZ, targetPos, targetZ, 420)) {
            e.lockedAttackVariant = dist >= 130 && this.state.rng.next() < 0.35 ? 'spore_bomb' : 'stinger';
            e.lockedAttackDir = { x: dx, y: dy, z: targetZ - originZ };
            e.lockedTargetPos = { x: targetPos.x, y: targetPos.y, z: targetZ };
            e.rangedWindupDuration = ENEMY_COMBAT_BALANCE.broodQueenWindup;
            e.rangedWindupTimer = ENEMY_COMBAT_BALANCE.broodQueenWindup;
            this.state.events.push({
              type: 'enemy_attack_windup',
              data: {
                id: e.id,
                type: e.type,
                variant: e.lockedAttackVariant,
                pos: { ...e.pos },
                z: originZ,
                aimDir: { ...e.lockedAttackDir },
                duration: ENEMY_COMBAT_BALANCE.broodQueenWindup
              }
            });
          }
        }

        // Swoop contact damage
        if (dist <= e.radius + 44 && Math.abs(targetPosZ - e.z) < 95) {
          if ((e.contactCooldownRemaining ?? 0) <= 0) {
            e.contactCooldownRemaining = e.attackCooldown;
            applyTargetDamage(e.touchDamage);
          }
        }
      } else if (e.isElite || e.type === 'elite') {
        // --- 2. VOID GOLIATH (ELITE CHITIN TANK) ---
        const canEliteShoot = Boolean(ENEMY_PROJECTILE_PERMISSIONS.elite);
        if ((e.rangedWindupTimer ?? 0) > 0) {
          // Hold braced ground-slam stance during 0.6s windup with locked direction
          moveVx = 0;
          moveVy = 0;
          e.rangedWindupTimer = Math.max(0, (e.rangedWindupTimer ?? 0) - dt);
          if (e.rangedWindupTimer <= 0 && canEliteShoot) {
            const originZ = e.z + 44;
            const lockedDir = e.lockedAttackDir ?? { x: dx, y: dy, z: targetPosZ + 52 - originZ };
            const lockedTgt = e.lockedTargetPos ?? { x: targetPos.x, y: targetPos.y, z: targetPosZ + 52 };
            const shardSpeed = ENEMY_COMBAT_BALANCE.eliteProjectileSpeed;
            const dist3D = Math.hypot(lockedDir.x, lockedDir.y, lockedDir.z) || 1;
            const vx = (lockedDir.x / dist3D) * shardSpeed;
            const vy = (lockedDir.y / dist3D) * shardSpeed;
            const vz = (lockedDir.z / dist3D) * shardSpeed;
            const attackInstanceId = this.nextEnemyAttackInstanceId++;

            // Single fair Seismic Shard projectile (reduced from 3)
            this.state.projectiles.push({
              id: `proj_${this.nextProjId++}`,
              type: 'seismic_shard',
              pos: { x: e.pos.x, y: e.pos.y },
              z: originZ,
              velocity: { x: vx, y: vy },
              vz,
              speed: shardSpeed,
              damage: ENEMY_COMBAT_BALANCE.eliteProjectileDamage,
              pierceCount: 1,
              maxDistance: 440,
              distanceTraveled: 0,
              owner: 'enemy',
              radius: ENEMY_COMBAT_BALANCE.eliteProjectileRadius,
              hitEnemyIds: new Set(),
              originZ,
              targetZ: lockedTgt.z,
              attackInstanceId
            });

            e.lockedAttackDir = undefined;
            e.lockedAttackVariant = undefined;
            e.lockedTargetPos = undefined;
            const cycleScale = Math.max(0.8, e.attackCooldown / Math.max(0.01, ENEMY_CONFIGS.elite.attackCooldown));
            e.attackCooldownRemaining = Math.max(
              0.95,
              ENEMY_COMBAT_BALANCE.eliteRangedCycleInterval * cycleScale - ENEMY_COMBAT_BALANCE.eliteRangedWindup
            );
            this.state.events.push({
              type: 'enemy_projectile_fired',
              data: { id: e.id, type: e.type, pos: { ...e.pos }, z: originZ }
            });
          }
        } else {
          const move = this.getGroundedMoveVelocity(e, enemySpeed, dt, targetDecoy ? targetDecoy.pos : undefined);
          moveVx = move.vx;
          moveVy = move.vy;

          // Initiate 0.6s Seismic Shard windup with locked target direction (requires 3D LOS & elevation match)
          if (canEliteShoot && dist >= 140 && dist <= 420 && e.attackCooldownRemaining <= 0) {
            const originZ = e.z + 44;
            const targetZ = targetPosZ + 52;
            if (this.hasEnemyAttackLOS3D(e.pos, originZ, targetPos, targetZ, 280)) {
              e.lockedAttackVariant = 'seismic_shard';
              e.lockedAttackDir = { x: dx, y: dy, z: targetZ - originZ };
              e.lockedTargetPos = { x: targetPos.x, y: targetPos.y, z: targetZ };
              e.rangedWindupDuration = ENEMY_COMBAT_BALANCE.eliteRangedWindup;
              e.rangedWindupTimer = ENEMY_COMBAT_BALANCE.eliteRangedWindup;
              this.state.events.push({
                type: 'enemy_attack_windup',
                data: {
                  id: e.id,
                  type: e.type,
                  variant: 'seismic_shard',
                  pos: { ...e.pos },
                  z: originZ,
                  aimDir: { ...e.lockedAttackDir },
                  duration: ENEMY_COMBAT_BALANCE.eliteRangedWindup
                }
              });
            }
          }

          // Heavy contact crush (reaches past 2x player body separation)
          if ((e.rangedWindupTimer ?? 0) <= 0 && dist <= e.radius + 46 && Math.abs(targetPosZ - e.z) < 76) {
            if (e.attackCooldownRemaining <= 0) {
              e.attackCooldownRemaining = e.attackCooldown;
              applyTargetDamage(e.touchDamage);
            }
          }
        }
      } else if (e.type === 'wasp') {
        // --- 3. VOID WASP (AERIAL BIO-ELECTRIC STINGER — AUTHORIZED FLYER) ---
        if (dist > 200) {
          moveVx = (dx / dist) * enemySpeed;
          moveVy = (dy / dist) * enemySpeed;
        } else if (dist < 120) {
          moveVx = -(dx / dist) * (enemySpeed * 0.6);
          moveVy = -(dy / dist) * (enemySpeed * 0.6);
        } else {
          moveVx = (dx / dist) * enemySpeed;
          moveVy = (dy / dist) * enemySpeed;
        }

        const canWaspShoot = Boolean(ENEMY_PROJECTILE_PERMISSIONS.wasp);
        if ((e.rangedWindupTimer ?? 0) > 0) {
          moveVx *= 0.25;
          moveVy *= 0.25;
          e.rangedWindupTimer = Math.max(0, (e.rangedWindupTimer ?? 0) - dt);
          if (e.rangedWindupTimer <= 0 && canWaspShoot) {
            const originZ = e.z + 36;
            const lockedDir = e.lockedAttackDir ?? { x: dx, y: dy, z: targetPosZ + 52 - originZ };
            const lockedTgt = e.lockedTargetPos ?? { x: targetPos.x, y: targetPos.y, z: targetPosZ + 52 };
            const stingerSpeed = ENEMY_COMBAT_BALANCE.waspProjectileSpeed;
            const dist3D = Math.hypot(lockedDir.x, lockedDir.y, lockedDir.z) || 1;
            const vx = (lockedDir.x / dist3D) * stingerSpeed;
            const vy = (lockedDir.y / dist3D) * stingerSpeed;
            const vz = (lockedDir.z / dist3D) * stingerSpeed;
            const attackInstanceId = this.nextEnemyAttackInstanceId++;

            this.state.projectiles.push({
              id: `proj_${this.nextProjId++}`,
              type: 'wasp_sting',
              pos: { x: e.pos.x, y: e.pos.y },
              z: originZ,
              velocity: { x: vx, y: vy },
              vz,
              speed: stingerSpeed,
              damage: ENEMY_COMBAT_BALANCE.waspProjectileDamage,
              pierceCount: 1,
              maxDistance: 360,
              distanceTraveled: 0,
              owner: 'enemy',
              radius: ENEMY_COMBAT_BALANCE.waspProjectileRadius,
              hitEnemyIds: new Set(),
              originZ,
              targetZ: lockedTgt.z,
              attackInstanceId
            });

            e.lockedAttackDir = undefined;
            e.lockedAttackVariant = undefined;
            e.lockedTargetPos = undefined;
            const cycleScale = Math.max(0.8, e.attackCooldown / Math.max(0.01, ENEMY_CONFIGS.wasp.attackCooldown));
            e.attackCooldownRemaining = Math.max(
              1.1,
              ENEMY_COMBAT_BALANCE.waspRangedCycleInterval * cycleScale - ENEMY_COMBAT_BALANCE.waspRangedWindup
            );
            this.state.events.push({
              type: 'enemy_projectile_fired',
              data: { id: e.id, type: e.type, pos: { ...e.pos }, z: originZ }
            });
          }
        } else if (canWaspShoot && dist >= 100 && dist <= 320 && e.attackCooldownRemaining <= 0) {
          const originZ = e.z + 36;
          const targetZ = targetPosZ + 52;
          if (this.hasEnemyAttackLOS3D(e.pos, originZ, targetPos, targetZ, 300)) {
            e.lockedAttackVariant = 'wasp_sting';
            e.lockedAttackDir = { x: dx, y: dy, z: targetZ - originZ };
            e.lockedTargetPos = { x: targetPos.x, y: targetPos.y, z: targetZ };
            e.rangedWindupDuration = ENEMY_COMBAT_BALANCE.waspRangedWindup;
            e.rangedWindupTimer = ENEMY_COMBAT_BALANCE.waspRangedWindup;
            this.state.events.push({
              type: 'enemy_attack_windup',
              data: {
                id: e.id,
                type: e.type,
                variant: 'wasp_sting',
                pos: { ...e.pos },
                z: originZ,
                aimDir: { ...e.lockedAttackDir },
                duration: ENEMY_COMBAT_BALANCE.waspRangedWindup
              }
            });
          }
        }

        // Contact dive
        if ((e.rangedWindupTimer ?? 0) <= 0 && dist <= e.radius + 44 && Math.abs(targetPosZ - e.z) < 82) {
          if (e.attackCooldownRemaining <= 0) {
            e.attackCooldownRemaining = e.attackCooldown;
            applyTargetDamage(e.touchDamage);
          }
        }
      } else if (e.type === 'spitter') {
        // --- 4. TOXIC SPITTER (CLOSE-RANGE CORROSIVE MELEE — NO PROJECTILES) ---
        const move = this.getGroundedMoveVelocity(e, enemySpeed, dt, targetDecoy ? targetDecoy.pos : undefined);
        moveVx = move.vx;
        moveVy = move.vy;

        if (dist <= e.radius + 46 && Math.abs(targetPosZ - e.z) < 72) {
          if (e.attackCooldownRemaining <= 0) {
            e.attackCooldownRemaining = e.attackCooldown;
            applyTargetDamage(e.touchDamage);
          }
        }
      } else {
        // --- 5. VOID CRAWLER (GROUND SWARM MELEE — NO PROJECTILES) ---
        const move = this.getGroundedMoveVelocity(e, enemySpeed, dt, targetDecoy ? targetDecoy.pos : undefined);
        moveVx = move.vx;
        moveVy = move.vy;

        if (dist <= e.radius + 46 && Math.abs(targetPosZ - e.z) < 72) {
          if (e.attackCooldownRemaining <= 0) {
            e.attackCooldownRemaining = e.attackCooldown;
            applyTargetDamage(e.touchDamage);
          }
        }
      }

      // Check terrain traversability: flyers clear low ground/gaps but avoid flying through taller cliffs; ground units slide along slopes
      const colRadius = e.isStage1Titan ? 56 : Math.min(e.radius, 36);
      if (!e.isBossLeaping && (moveVx !== 0 || moveVy !== 0)) {
        const prevX = e.pos.x;
        const prevY = e.pos.y;
        const nextX = e.pos.x + moveVx * dt;
        const nextY = e.pos.y + moveVy * dt;

        this.moveWithTerrainSlide(e.pos, e.z, nextX, nextY, isAirborneUnit, colRadius);

        if (!isAirborneUnit) {
          // Stuck detection and wall recovery sliding
          const actualDist = Math.hypot(e.pos.x - prevX, e.pos.y - prevY);
          const expectedDist = enemySpeed * dt;

          if (e.isAlerted && expectedDist > 0.05 && actualDist < expectedDist * 0.25) {
            e.stuckTimer = (e.stuckTimer ?? 0) + dt;
            if (e.stuckTimer >= 0.30 && (!e.recoveryTimer || e.recoveryTimer <= 0)) {
              // Probe candidate open escape headings around obstacle / cliff face
              e.recoveryTimer = 0.55;
              const intendedDx = (e.navWaypoint?.x ?? p.pos.x) - e.pos.x;
              const intendedDy = (e.navWaypoint?.y ?? p.pos.y) - e.pos.y;
              const iLen = Math.hypot(intendedDx, intendedDy) || 1;
              const ux = intendedDx / iLen;
              const uy = intendedDy / iLen;
              const sign = (e.id.charCodeAt(e.id.length - 1) % 2 === 0) ? 1 : -1;
              const candAngles = [sign * 1.15, -sign * 1.15, sign * 1.75, -sign * 1.75, sign * 2.4, -sign * 2.4];
              let chosenDir = { x: -uy * sign, y: ux * sign };
              for (let a = 0; a < candAngles.length; a++) {
                const ang = candAngles[a];
                const cosA = Math.cos(ang);
                const sinA = Math.sin(ang);
                const cx = ux * cosA - uy * sinA;
                const cy = ux * sinA + uy * cosA;
                const probe = this.state.terrain.checkTraversable(
                  e.pos,
                  { x: e.pos.x + cx * 26, y: e.pos.y + cy * 26 },
                  e.z,
                  false,
                  colRadius
                );
                if (probe.allowed) {
                  chosenDir = { x: cx, y: cy };
                  break;
                }
              }
              e.recoveryDir = chosenDir;
              e.navTimer = 0; // Force immediate path recalculation
            }

            if (e.stuckTimer >= 1.2) {
              // Persistently stuck: steer toward nearest open traversable node without teleporting
              const safeNodeId = this.state.terrain.getClosestTraversableNode(e.pos);
              const safeNode = this.state.terrain.navNodes[safeNodeId];
              if (safeNode) {
                const sDx = safeNode.pos.x - e.pos.x;
                const sDy = safeNode.pos.y - e.pos.y;
                const sLen = Math.hypot(sDx, sDy) || 1;
                e.recoveryTimer = 0.75;
                e.recoveryDir = { x: sDx / sLen, y: sDy / sLen };
              }
              e.stuckTimer = 0;
              e.navTimer = 0;
            }
          } else if (actualDist >= expectedDist * 0.40) {
            e.stuckTimer = Math.max(0, (e.stuckTimer ?? 0) - dt * 2);
          }
        }
      }

      const clampedEnemy = this.state.terrain.clampToPlayableBounds(e.pos, 30);
      e.pos.x = clampedEnemy.pos.x;
      e.pos.y = clampedEnemy.pos.y;

      if (!e.isBossLeaping) {
        this.resolveObstacleCollisions(e.pos, e.radius, e.isStage1Titan);
      }

      if (!e.isBossLeaping && !isAirborneUnit && (!e.isStage1Titan || e.titanState !== 'emerging')) {
        this.state.terrain.pushOutOfSteepTerrain(e.pos, e.z, colRadius);
      }

      // Keep entity elevations synchronized with terrain (airborne flyers stay above terrain peaks)
      const postSample = this.state.terrain.getElevation(e.pos.x, e.pos.y, e.z, 56);
      e.groundZ = postSample.height;
      if (isAirborneUnit) {
        e.z = Math.max(e.z, e.groundZ + 56);
      } else if (!e.isBossLeaping && (!e.isStage1Titan || e.titanState !== 'emerging')) {
        e.z = e.groundZ;
      }
      e.inWater = Boolean(!isAirborneUnit && postSample.isInWater && e.z <= postSample.height + 10);

      if (e.isStage1Titan && e.titanState === 'dying' && (e.titanTimer ?? 0) <= 0) {
        continue;
      }

      alive.push(e);
    }

    this.state.enemies = alive;
    this.resolveEnemyCollisions();
  }

  /**
   * Checks vertical proximity AND unobstructed 3D terrain Line-of-Sight before an enemy can
   * initiate a ranged attack or telegraph — prevents enemies underneath the Tower or behind cliffs
   * from locking on and projecting attack telegraphs through solid walls/floors.
   */
  private hasEnemyAttackLOS3D(
    fromPos: Vector2,
    fromZ: number,
    toPos: Vector2,
    toZ: number,
    maxVertDelta: number
  ): boolean {
    if (Math.abs(toZ - fromZ) > maxVertDelta) return false;
    return this.state.terrain.checkLineOfSight3D(
      { x: fromPos.x, y: fromPos.y, z: fromZ },
      { x: toPos.x, y: toPos.y, z: toZ }
    );
  }

  /**
   * 3D cylinder collision resolution between enemies and between player and enemies.
   * Requires vertical elevation overlap so enemies below bridges or inside/under the Tower
   * can NEVER push the player standing on top of the Tower Summit.
   */
  private resolveEnemyCollisions(): void {
    const enemies = this.state.enemies;
    const len = enemies.length;
    if (len === 0) return;

    const p = this.state.player;
    const playerRadius = 40;

    // 3 relaxation iterations using SpatialGrid neighbor lookup (eliminates O(N^2) loops)
    for (let iter = 0; iter < 3; iter++) {
      if (iter > 0) {
        this.spatialGrid.clear();
        for (let i = 0; i < len; i++) {
          if (enemies[i].health > 0) this.spatialGrid.insert(enemies[i]);
        }
      }

      // 1. Enemy vs Enemy Collision
      for (let i = 0; i < len; i++) {
        const e1 = enemies[i];
        if (e1.health <= 0 || e1.isSpawning || e1.isBossLeaping || (e1.isStage1Titan && (e1.titanState === 'emerging' || e1.titanState === 'dying' || e1.titanState === 'leap'))) continue;

        const searchR = e1.radius + 160;
        const neighbors = this.spatialGrid.getNearby(e1.pos, searchR);
        for (let ni = 0; ni < neighbors.length; ni++) {
          const e2 = neighbors[ni];
          if (e2.id <= e1.id) continue; // Deduplicate pair checks & self-check
          if (e2.health <= 0 || e2.isSpawning || e2.isBossLeaping || (e2.isStage1Titan && (e2.titanState === 'emerging' || e2.titanState === 'dying' || e2.titanState === 'leap'))) continue;

          const pairVertBand = (e1.isStage1Titan || e2.isStage1Titan) ? 320 : 120;
          if (Math.abs(e1.z - e2.z) > pairVertBand) continue;

          const dx = e1.pos.x - e2.pos.x;
          const dy = e1.pos.y - e2.pos.y;
          const minDist = e1.radius + e2.radius;
          const distSq = dx * dx + dy * dy;

          if (distSq < minDist * minDist) {
            let dist = Math.sqrt(distSq);
            let nx = 1;
            let ny = 0;
            if (dist > 0.001) {
              nx = dx / dist;
              ny = dy / dist;
            } else {
              // Exact center overlap: deterministic divergent angle
              const angle = (i * 2.39996 + ni * 1.618);
              nx = Math.cos(angle);
              ny = Math.sin(angle);
              dist = 0.001;
            }

            const overlap = minDist - dist;
            const m1 = e1.isStage1Titan ? 50 : (e1.isBoss ? 15 : (e1.isElite ? 5 : 1));
            const m2 = e2.isStage1Titan ? 50 : (e2.isBoss ? 15 : (e2.isElite ? 5 : 1));
            const totalMass = m1 + m2;

            const push1 = (m2 / totalMass) * overlap * 0.90;
            const push2 = (m1 / totalMass) * overlap * 0.90;

            e1.pos.x += nx * push1;
            e1.pos.y += ny * push1;
            e2.pos.x -= nx * push2;
            e2.pos.y -= ny * push2;
          }
        }

        // 2. Player vs Enemy Collision: require 3D vertical overlap so enemies below the Tower NEVER shove the player!
        const playerVertBand = e1.isStage1Titan ? 320 : (e1.isBoss ? 180 : 115);
        if (Math.abs(e1.z - p.z) <= playerVertBand) {
          const pdx = e1.pos.x - p.pos.x;
          const pdy = e1.pos.y - p.pos.y;
          const playerMinDist = e1.radius + playerRadius;
          const pDistSq = pdx * pdx + pdy * pdy;

          if (pDistSq < playerMinDist * playerMinDist) {
            let pDist = Math.sqrt(pDistSq);
            let pnx = 1;
            let pny = 0;
            if (pDist > 0.001) {
              pnx = pdx / pDist;
              pny = pdy / pDist;
            }
            const pOverlap = playerMinDist - pDist;
            if (e1.isBoss || e1.isElite) {
              p.pos.x -= pnx * pOverlap * 0.35;
              p.pos.y -= pny * pOverlap * 0.35;
              e1.pos.x += pnx * pOverlap * 0.65;
              e1.pos.y += pny * pOverlap * 0.65;
            } else {
              e1.pos.x += pnx * pOverlap * 0.95;
              e1.pos.y += pny * pOverlap * 0.95;
            }
          }
        }
      }
    }

    // Keep entities clamped in world bounds, push out of cliffs if crowd pushed them, and sync terrain height
    for (let i = 0; i < len; i++) {
      const e = enemies[i];
      if (e.health <= 0 || e.isSpawning) continue;
      const isAirborneUnit = Boolean(e.type === 'wasp' || (e.isBoss && !e.isStage1Titan));
      const isBossInLeap = Boolean(e.isBossLeaping || e.titanState === 'leap');
      if (!isBossInLeap && !isAirborneUnit && (!e.isStage1Titan || (e.titanState !== 'emerging' && e.titanState !== 'dying'))) {
        const colRadius = e.isStage1Titan ? 56 : Math.min(e.radius, 36);
        this.state.terrain.pushOutOfSteepTerrain(e.pos, e.z, colRadius);
      }
      const clampedEnemy = this.state.terrain.clampToPlayableBounds(e.pos, 30);
      e.pos.x = clampedEnemy.pos.x;
      e.pos.y = clampedEnemy.pos.y;
      e.groundZ = this.state.terrain.getElevation(e.pos.x, e.pos.y, e.z, 56).height;
      if (isAirborneUnit) {
        e.z = Math.max(e.z, e.groundZ + 56);
      } else if (!isBossInLeap && (!e.isStage1Titan || (e.titanState !== 'emerging' && e.titanState !== 'dying'))) {
        e.z = e.groundZ;
      }
    }

    if (p.isGrounded && !p.isJumping) {
      this.state.terrain.pushOutOfSteepTerrain(p.pos, p.z, 30);
      const clampedPlayer = this.state.terrain.clampToPlayableBounds(p.pos, 45);
      p.pos.x = clampedPlayer.pos.x;
      p.pos.y = clampedPlayer.pos.y;
      const pStepLim = this.state.terrain.getStepUpLimitAt(p.pos.x, p.pos.y);
      p.groundZ = this.state.terrain.getElevation(p.pos.x, p.pos.y, p.z, pStepLim).height;
      if (p.groundZ <= p.z + pStepLim && p.groundZ >= p.z - 95) {
        p.z = p.groundZ;
      }
    }
  }

  private spawnDirectorEnemy(type: EnemyType, pos: Vector2, groundHeight: number): void {
    const { tierDef } = getDifficultyTier(this.state.gameTime);
    const rng = this.state.directorRng;
    const cfg = ENEMY_CONFIGS[type];
    const scaledHealth = Math.round(cfg.maxHealth * tierDef.hpMultiplier);
    const scaledDamage = Math.round(cfg.touchDamage * tierDef.damageMultiplier);
    const scaledSpeed = cfg.speed * tierDef.speedMultiplier + rng.range(-6, 6);
    const angle = rng.range(0, Math.PI * 2);

    const enemy: EnemyState = {
      id: `enemy_${this.nextEnemyId++}`,
      type,
      pos: { x: pos.x, y: pos.y },
      velocity: { x: 0, y: 0 },
      z: type === 'wasp' ? groundHeight + 28 : groundHeight - 24,
      groundZ: groundHeight,
      health: scaledHealth,
      maxHealth: scaledHealth,
      speed: scaledSpeed,
      touchDamage: scaledDamage,
      attackCooldown: cfg.attackCooldown * Math.max(0.80, 1 - tierDef.tier * 0.03),
      attackCooldownRemaining: 1.25,
      attackRange: cfg.attackRange,
      isElite: cfg.isElite || type === 'elite',
      isBoss: cfg.isBoss,
      isScriptedEventEnemy: false,
      currencyReward: Math.round(cfg.currencyReward * (1 + tierDef.tier * 0.18)),
      xpReward: Math.round(cfg.xpReward * (1 + tierDef.tier * 0.22)),
      radius: cfg.radius,
      isSpawning: true,
      spawnProgress: 0,
      spawnDuration: 1.25,
      isAlerted: true,
      wanderDir: { x: Math.cos(angle), y: Math.sin(angle) },
      wanderTimer: rng.range(2.0, 4.0)
    };

    this.state.enemies.push(enemy);
    this.state.events.push({
      type: 'enemy_emerging',
      data: { id: enemy.id, pos: { ...enemy.pos }, z: groundHeight, type }
    });
  }

  private updateEnemySpawning(dt: number): void {
    const p = this.state.player;
    if (this.state.stageNumber !== 1) {
      this.combatDirector.unlockExploration();
    } else if (
      (!this.state.terrain.isCustomTestMap || this.state.terrain.allowTestMapNarrative) &&
      !this.stage1EnemySpawningUnlocked
    ) {
      if (this.state.worldEvents.some((ev) => ev.isActive || ev.isCompleted)) {
        this.unlockStage1EnemySpawning('world_event_triggered');
      } else {
        const spawn =
          this.state.terrain.isCustomTestMap && this.state.terrain.testSpawnPos
            ? this.state.terrain.testSpawnPos
            : this.state.playerSpawnPos;
        if (Math.hypot(p.pos.x - spawn.x, p.pos.y - spawn.y) >= this.getStage1SpawnSafeRadius()) {
          this.unlockStage1EnemySpawning('distance_from_spawn');
        }
      }
      if (!this.stage1EnemySpawningUnlocked) {
        this.enemySpawnTimer = 0.45;
        return;
      }
    } else if (!this.stage1EnemySpawningUnlocked && this.state.terrain.isCustomTestMap && !this.state.terrain.allowTestMapNarrative) {
      this.unlockStage1EnemySpawning('custom_map_immediate');
    }

    this.combatDirector.update(dt, this.state, this.lastCameraForward, (type, pos, z) => {
      this.spawnDirectorEnemy(type, pos, z);
    });
  }

  public spawnStage1Titan(_teleporterPos: Vector2): void {
    // Spawn directly in front of the crashed colony shipwreck landmark (1800, 2960) in open crater terrain,
    // or at the custom test map's designated Boss Spawn marker when testing
    const bossPos = (this.state.terrain.isCustomTestMap && this.state.terrain.testBossSpawnPos)
      ? this.state.terrain.testBossSpawnPos
      : this.state.bossSpawnPos;
    const sx = bossPos.x;
    const sy = bossPos.y;
    const spawnElev = this.state.terrain.getElevation(sx, sy, 1e6, 22);
    const redMouth = this.state.terrain.isCustomTestMap ? this.state.terrain.testRedCrystalMouthPos : null;
    const emergeOrigin = redMouth
      ? { x: redMouth.x, y: redMouth.y, z: redMouth.z }
      : { x: sx, y: sy + 340, z: spawnElev.height + 195 };
    const emergeTarget = { x: sx, y: sy, z: spawnElev.height };
    this.bossEmergePhaseStage = 0;

    // Gentle clearance nudge ONLY if player is standing right inside the crystal mouth at the same elevation
    const p = this.state.player;
    if (Math.hypot(p.pos.x - emergeOrigin.x, p.pos.y - emergeOrigin.y) < 185 && Math.abs(p.z - emergeOrigin.z) < 280) {
      const pushDirX = emergeTarget.x - emergeOrigin.x;
      const pushDirY = emergeTarget.y - emergeOrigin.y;
      const plen = Math.hypot(pushDirX, pushDirY) || 1;
      p.pos.x = emergeTarget.x + (pushDirX / plen) * 180;
      p.pos.y = emergeTarget.y + (pushDirY / plen) * 180;
      const pe = this.state.terrain.getElevation(p.pos.x, p.pos.y, p.z, 56).height;
      p.z = pe;
      p.groundZ = pe;
    }

    const { tierDef } = getDifficultyTier(this.state.gameTime);
    const scaledHealth = STAGE1_BOSS_CONFIG.maxHealth;
    const scaledDamage = Math.round(STAGE1_BOSS_CONFIG.touchDamage * tierDef.damageMultiplier);

    const titan: EnemyState = {
      id: `boss_titan_${this.nextEnemyId++}`,
      type: 'boss',
      isBoss: true,
      isStage1Titan: true,
      titanState: 'emerging',
      titanTimer: 3.6, // 4-phase ~30-deg diagonal emergence from Red Crystal mouth
      titanAnimFrame: 0,
      titanFacing: 'front',
      titanFootstepTimer: 0,
      titanRumbleTimer: 0,
      pos: { x: emergeOrigin.x, y: emergeOrigin.y },
      velocity: { x: 0, y: 0 },
      z: emergeOrigin.z,
      groundZ: spawnElev.height,
      bossEmergeOrigin: emergeOrigin,
      bossEmergeTarget: emergeTarget,
      health: scaledHealth,
      maxHealth: scaledHealth,
      speed: STAGE1_BOSS_CONFIG.speed * tierDef.speedMultiplier,
      touchDamage: scaledDamage,
      attackCooldown: STAGE1_BOSS_CONFIG.attackCooldown,
      attackCooldownRemaining: STAGE1_BOSS_CONFIG.initialCooldown,
      attackRange: STAGE1_BOSS_CONFIG.tentacle.reach,
      isElite: true,
      currencyReward: 160,
      xpReward: 450,
      radius: STAGE1_BOSS_CONFIG.radius,
      isSpawning: false,
      isAlerted: true
    };

    this.state.enemies.push(titan);
    if (this.state.artifact) {
      this.state.artifact.isBossSpawned = true;
      this.state.artifact.isBossDefeated = false;
    }

    this.state.events.push({
      type: 'stage1_boss_emerge',
      data: {
        id: titan.id,
        pos: { ...emergeTarget },
        crystalPos: { ...emergeOrigin },
        groundZ: spawnElev.height
      }
    });
  }

  public spawnEventBoss(origin: Vector2): void {
    const angle = this.state.rng.range(0, Math.PI * 2);
    const radius = 220;
    const sx = Math.max(120, Math.min(this.state.worldWidth - 120, origin.x + Math.cos(angle) * radius));
    const sy = Math.max(120, Math.min(this.state.worldHeight - 120, origin.y + Math.sin(angle) * radius));
    const spawnElevation = this.state.terrain.getElevation(sx, sy);

    const cfg = ENEMY_CONFIGS.boss;
    const { tierDef } = getDifficultyTier(this.state.gameTime);
    const scaledHealth = Math.round(cfg.maxHealth * 0.85 * tierDef.hpMultiplier);
    const scaledDamage = Math.round(cfg.touchDamage * tierDef.damageMultiplier);

    const boss: EnemyState = {
      id: `event_boss_${this.nextEnemyId++}`,
      type: 'boss',
      pos: { x: sx, y: sy },
      velocity: { x: 0, y: 0 },
      z: spawnElevation.height + 40, // Flying sovereign
      groundZ: spawnElevation.height,
      health: scaledHealth,
      maxHealth: scaledHealth,
      speed: cfg.speed * tierDef.speedMultiplier,
      touchDamage: scaledDamage,
      attackCooldown: cfg.attackCooldown,
      attackCooldownRemaining: 1.5,
      attackRange: cfg.attackRange,
      isElite: true,
      isBoss: true,
      isStage1Titan: false, // Brood Queen
      isScriptedEventEnemy: true,
      currencyReward: cfg.currencyReward,
      xpReward: cfg.xpReward,
      radius: cfg.radius,
      isSpawning: false,
      isAlerted: true
    };

    this.state.enemies.push(boss);
    this.state.events.push({
      type: 'boss_spawned',
      data: { name: 'Brood Queen (Event Guardian)', isStage1Boss: false }
    });
  }

  private probeBossLeapSpot(
    boss: EnemyState,
    targetPos: Vector2,
    targetZ: number
  ): { x: number; y: number; z: number } | null {
    const terrain = this.state.terrain;
    const col = terrain.meshCollider;
    const approachAng = Math.atan2(boss.pos.y - targetPos.y, boss.pos.x - targetPos.x);
    const probeOffsets: Array<{ r: number; angOffset: number }> = [
      { r: 0, angOffset: 0 },
      { r: 36, angOffset: 0 },
      { r: 58, angOffset: 0 },
      { r: 58, angOffset: 0.7 },
      { r: 58, angOffset: -0.7 },
      { r: 95, angOffset: 0 },
      { r: 95, angOffset: 1.1 },
      { r: 95, angOffset: -1.1 },
      { r: 140, angOffset: 0 },
      { r: 140, angOffset: Math.PI * 0.5 },
      { r: 140, angOffset: -Math.PI * 0.5 },
      { r: 140, angOffset: Math.PI }
    ];

    for (let i = 0; i < probeOffsets.length; i++) {
      const { r, angOffset } = probeOffsets[i];
      const ang = approachAng + angOffset;
      const clamped = terrain.clampToPlayableBounds(
        { x: targetPos.x + Math.cos(ang) * r, y: targetPos.y + Math.sin(ang) * r },
        40
      ).pos;

      if (col) {
        const sup = col.querySupport(clamped.x, clamped.y, targetZ + 45, 45);
        if (sup.hit && sup.isWalkable && col.isPositionOutsideHollowInterior(clamped.x, clamped.y, sup.height, 16)) {
          return { x: clamped.x, y: clamped.y, z: sup.height };
        }
      } else {
        const elev = terrain.getElevation(clamped.x, clamped.y, targetZ + 35, 35);
        if (elev.isWalkable) {
          return { x: clamped.x, y: clamped.y, z: elev.height };
        }
      }
    }

    return null;
  }

  private findBossLeapLandingSpot(boss: EnemyState, targetPos: Vector2, targetZ: number): { x: number; y: number; z: number } {
    const validated = this.probeBossLeapSpot(boss, targetPos, targetZ);
    if (validated) return validated;
    const terrain = this.state.terrain;
    const fallback = terrain.clampToPlayableBounds(targetPos, 40).pos;
    const fbElev = terrain.getElevation(fallback.x, fallback.y, targetZ + 35, 35).height;
    return { x: fallback.x, y: fallback.y, z: fbElev };
  }

  private launchBossLeapTo(boss: EnemyState, target: { x: number; y: number; z: number }, cooldownSec: number): void {
    const leapDist = Math.hypot(target.x - boss.pos.x, target.y - boss.pos.y);

    boss.isBossLeaping = true;
    boss.titanState = 'leap';
    boss.bossLeapElapsed = 0;
    boss.bossLeapDuration = Math.max(0.75, Math.min(1.45, 0.55 + leapDist / 880));
    boss.bossLeapStart = { x: boss.pos.x, y: boss.pos.y, z: boss.z };
    boss.bossLeapTarget = target;
    boss.bossJumpCooldown = cooldownSec;
    boss.bossStuckTimer = 0;
    boss.bossPursuitOutOfRangeTimer = 0;
    boss.bossStuckAnchor = undefined;
    boss.velocity.x = 0;
    boss.velocity.y = 0;

    this.state.events.push({
      type: 'stage1_boss_rumble',
      data: { pos: { ...boss.pos }, intensity: 0.42, isFootstep: true, z: boss.groundZ }
    });
  }

  private triggerBossAntiStuckLeap(boss: EnemyState): void {
    const p = this.state.player;
    const target = this.findBossLeapLandingSpot(boss, p.pos, p.groundZ);
    this.launchBossLeapTo(boss, target, 5.0);
  }

  private triggerBossPursuitLeap(boss: EnemyState): boolean {
    const p = this.state.player;
    const dx = p.pos.x - boss.pos.x;
    const dy = p.pos.y - boss.pos.y;
    const dist = Math.hypot(dx, dy) || 1;
    const maxHopDist = 1650;
    // Cap travel per hop and stop ~380u short of player so the boss chases cleanly without landing directly on top
    const desiredTravel = dist <= maxHopDist + 380 ? Math.max(220, dist - 380) : maxHopDist;
    const candX = boss.pos.x + (dx / dist) * desiredTravel;
    const candY = boss.pos.y + (dy / dist) * desiredTravel;
    const candElev = this.state.terrain.getElevation(candX, candY, p.z + 35, 35).height;
    const spot = this.probeBossLeapSpot(boss, { x: candX, y: candY }, candElev);
    if (!spot) {
      boss.bossJumpCooldown = 1.5;
      boss.bossPursuitOutOfRangeTimer = 0;
      return false;
    }
    this.launchBossLeapTo(boss, spot, 6.5);
    return true;
  }

  private updateStage1Titan(boss: EnemyState, dt: number): void {
    const p = this.state.player;
    const dx = p.pos.x - boss.pos.x;
    const dy = p.pos.y - boss.pos.y;
    const dist = Math.hypot(dx, dy) || 1;
    if ((boss.bossJumpCooldown ?? 0) > 0) {
      boss.bossJumpCooldown = Math.max(0, (boss.bossJumpCooldown ?? 0) - dt);
    }

    // Helper: calculate 2D distance from point to segment
    const distToSeg = (px: number, py: number, x1: number, y1: number, x2: number, y2: number): number => {
      const segDx = x2 - x1;
      const segDy = y2 - y1;
      const lenSq = segDx * segDx + segDy * segDy;
      if (lenSq === 0) return Math.hypot(px - x1, py - y1);
      let t = ((px - x1) * segDx + (py - y1) * segDy) / lenSq;
      t = Math.max(0, Math.min(1, t));
      return Math.hypot(px - (x1 + t * segDx), py - (y1 + t * segDy));
    };

    // 1. DYING STATE
    if (boss.titanState === 'dying') {
      boss.velocity.x = 0;
      boss.velocity.y = 0;
      boss.radius = 0; // Hitbox removed immediately
      boss.titanTimer = (boss.titanTimer ?? 3.2) - dt;
      if (boss.titanTimer <= 0) {
        this.killEnemy(boss);
      }
      return;
    }

    // 2. EMERGENCE SEQUENCE (4-phase ~30-deg diagonal Red Crystal eruption)
    if (boss.titanState === 'emerging') {
      boss.velocity.x = 0;
      boss.velocity.y = 0;
      const totalDur = 3.6;
      boss.titanTimer = Math.max(0, (boss.titanTimer ?? totalDur) - dt);
      const emergeProgress = Math.min(1.0, Math.max(0.0, 1.0 - boss.titanTimer / totalDur));
      const origin = boss.bossEmergeOrigin ?? { x: boss.pos.x, y: boss.pos.y + 340, z: boss.groundZ + 195 };
      const target = boss.bossEmergeTarget ?? { x: boss.pos.x, y: boss.pos.y, z: boss.groundZ };

      let moveT = 0;
      if (emergeProgress < 0.22) {
        // Phase 1: Crystal activation + fracture buildup inside crystal mouth
        moveT = 0;
        if (this.bossEmergePhaseStage < 1 && emergeProgress >= 0.04) {
          this.bossEmergePhaseStage = 1;
          this.state.events.push({
            type: 'stage1_boss_rumble',
            data: { pos: { x: origin.x, y: origin.y }, z: origin.z, intensity: 0.28, isCrystalActivation: true }
          });
        }
      } else if (emergeProgress < 0.52) {
        // Phase 2: Crystal break + shatter burst + front torso breach along diagonal path
        const localT = (emergeProgress - 0.22) / 0.30;
        const eased = 1.0 - Math.pow(1.0 - localT, 2);
        moveT = eased * 0.36;
        if (this.bossEmergePhaseStage < 2) {
          this.bossEmergePhaseStage = 2;
          this.state.events.push({
            type: 'stage1_boss_rumble',
            data: { pos: { x: origin.x, y: origin.y }, z: origin.z, intensity: 0.72, isCrystalShatter: true }
          });
        }
      } else if (emergeProgress < 0.86) {
        // Phase 3: Full body diagonal emergence out onto open clearing + debris trail
        const localT = (emergeProgress - 0.52) / 0.34;
        const smooth = localT * localT * (3.0 - 2.0 * localT);
        moveT = 0.36 + smooth * 0.62;
        if (this.bossEmergePhaseStage < 3) {
          this.bossEmergePhaseStage = 3;
        }
      } else {
        // Phase 4: Ground contact landing & settle before entering combat AI
        const localT = (emergeProgress - 0.86) / 0.14;
        const settle = 1.0 - Math.pow(1.0 - localT, 3);
        moveT = 0.98 + settle * 0.02;
        if (this.bossEmergePhaseStage < 4) {
          this.bossEmergePhaseStage = 4;
          this.state.events.push({
            type: 'stage1_boss_rumble',
            data: { pos: { x: target.x, y: target.y }, intensity: 0.75, z: target.z, isFinalBurst: true }
          });
        }
      }

      boss.pos.x = origin.x + (target.x - origin.x) * moveT;
      boss.pos.y = origin.y + (target.y - origin.y) * moveT;
      boss.z = origin.z + (target.z - origin.z) * moveT;
      boss.groundZ = target.z;

      boss.titanRumbleTimer = (boss.titanRumbleTimer ?? 0) + dt;
      if (boss.titanRumbleTimer >= 0.26 && emergeProgress >= 0.22 && emergeProgress < 0.88) {
        boss.titanRumbleTimer = 0;
        this.state.events.push({
          type: 'stage1_boss_rumble',
          data: {
            pos: { ...boss.pos },
            intensity: 0.26 + 0.3 * emergeProgress,
            z: boss.z,
            isEmergeTrail: true
          }
        });
      }

      if (boss.titanTimer <= 0) {
        boss.pos.x = target.x;
        boss.pos.y = target.y;
        boss.z = target.z;
        boss.groundZ = target.z;
        boss.titanState = 'idle';
        boss.titanTimer = 0.45;
        this.state.events.push({
          type: 'boss_spawned',
          data: { name: 'STAGE 1 BOSS', pos: { ...boss.pos }, z: boss.groundZ }
        });
      }
      return;
    }

    // 3. IDLE RECOVERY / TRANSITION
    if (boss.titanState === 'idle') {
      boss.velocity.x = 0;
      boss.velocity.y = 0;
      // Face player while idle
      if (Math.abs(dx) > Math.abs(dy) * 1.1) {
        boss.titanFacing = dx > 0 ? 'right' : 'left';
      } else {
        boss.titanFacing = dy > 0 ? 'front' : 'back';
      }

      boss.titanTimer = (boss.titanTimer ?? 0.5) - dt;
      if (boss.titanTimer <= 0) {
        boss.titanState = 'walk';
        boss.titanTimer = 1.35;
      }
      return;
    }

    // 3b. ANTI-STUCK TERRAIN LEAP SEQUENCE (Jumps onto / right next to player when blocked >= 2s)
    if (boss.titanState === 'leap' && boss.bossLeapStart && boss.bossLeapTarget) {
      boss.velocity.x = 0;
      boss.velocity.y = 0;
      const dur = Math.max(0.5, boss.bossLeapDuration ?? 1.0);
      boss.bossLeapElapsed = (boss.bossLeapElapsed ?? 0) + dt;
      const u = Math.min(1.0, boss.bossLeapElapsed / dur);

      const s = boss.bossLeapStart;
      const t = boss.bossLeapTarget;
      const leapDist = Math.hypot(t.x - s.x, t.y - s.y);
      const arcPeak = Math.min(540, Math.max(190, leapDist * 0.28 + Math.abs(t.z - s.z) * 0.35));

      boss.pos.x = s.x + (t.x - s.x) * u;
      boss.pos.y = s.y + (t.y - s.y) * u;
      boss.z = s.z + (t.z - s.z) * u + 4 * arcPeak * u * (1 - u);

      const ldx = t.x - s.x;
      const ldy = t.y - s.y;
      if (Math.abs(ldx) > Math.abs(ldy) * 1.1) {
        boss.titanFacing = ldx > 0 ? 'right' : 'left';
      } else {
        boss.titanFacing = ldy > 0 ? 'front' : 'back';
      }

      // Active body hitbox while descending near player elevation
      const curDist = Math.hypot(p.pos.x - boss.pos.x, p.pos.y - boss.pos.y);
      if (curDist <= boss.radius + 20 && Math.abs(p.z - boss.z) < 75) {
        this.damagePlayer(boss.touchDamage * 0.8 * dt, true, boss, 'melee');
      }

      if (u >= 1.0) {
        boss.pos.x = t.x;
        boss.pos.y = t.y;
        const landElev = this.state.terrain.getElevation(boss.pos.x, boss.pos.y, t.z + 30, 30).height;
        boss.z = landElev;
        boss.groundZ = landElev;
        boss.isBossLeaping = false;
        boss.titanState = 'idle';
        boss.titanTimer = STAGE1_BOSS_CONFIG.postAttackPause;
        boss.bossStuckAnchor = { x: boss.pos.x, y: boss.pos.y };
        boss.bossStuckTimer = 0;

        this.state.terrain.pushOutOfSteepTerrain(boss.pos, boss.z, 32);

        // Landing slam hitbox & shockwave
        const landDist = Math.hypot(p.pos.x - boss.pos.x, p.pos.y - boss.pos.y);
        const slamRadius = boss.radius + 78;
        if (landDist <= slamRadius && Math.abs(p.z - boss.z) < 95) {
          this.damagePlayer(boss.touchDamage, false, boss, 'melee');
        }
        this.state.events.push({
          type: 'stage1_boss_rumble',
          data: { pos: { ...boss.pos }, intensity: 0.75, z: boss.groundZ, isFinalBurst: true }
        });
      }
      return;
    }

    // 4. WALKING LOCOMOTION
    if (boss.titanState === 'walk') {
      // Track net displacement over time: if chasing player and blocked in ~1 spot for >= 2.0s, leap over terrain!
      if (!boss.bossStuckAnchor) {
        boss.bossStuckAnchor = { x: boss.pos.x, y: boss.pos.y };
      }
      const movedFromAnchor = Math.hypot(boss.pos.x - boss.bossStuckAnchor.x, boss.pos.y - boss.bossStuckAnchor.y);
      if (movedFromAnchor >= Math.max(60, boss.speed * 1.15)) {
        boss.bossStuckAnchor = { x: boss.pos.x, y: boss.pos.y };
        boss.bossStuckTimer = 0;
      } else if (dist > 140 && (boss.bossJumpCooldown ?? 0) <= 0) {
        boss.bossStuckTimer = (boss.bossStuckTimer ?? 0) + dt;
        if (boss.bossStuckTimer >= 2.0) {
          this.triggerBossAntiStuckLeap(boss);
          return;
        }
      }
      // Calibrated pursuit leap when player stays beyond max effective attack range (> 1500u or |dz| > 480u)
      if ((boss.bossJumpCooldown ?? 0) <= 0 && (dist > 1500 || Math.abs(p.z - boss.z) > 480)) {
        boss.bossPursuitOutOfRangeTimer = (boss.bossPursuitOutOfRangeTimer ?? 0) + dt;
        if (boss.bossPursuitOutOfRangeTimer >= 1.6) {
          if (this.triggerBossPursuitLeap(boss)) {
            return;
          }
        }
      } else {
        boss.bossPursuitOutOfRangeTimer = Math.max(0, (boss.bossPursuitOutOfRangeTimer ?? 0) - dt * 2);
      }
      const speed = boss.speed;
      const heightDiff = Math.abs(p.z - boss.z);
      const isDirectWalk = heightDiff < 32 && this.state.terrain.isDirectlyTraversable(boss.pos, p.pos, false);

      let targetVx = 0;
      let targetVy = 0;

      if (isDirectWalk) {
        targetVx = (dx / dist) * speed;
        targetVy = (dy / dist) * speed;
      } else {
        // Use terrain navigation graph to follow climbable ramps and navigate around sheer cliffs
        const navRes = this.state.terrain.getNavWaypointInfo(boss.pos, p.pos, false);
        const wp = navRes.waypoint;
        const wdx = wp.x - boss.pos.x;
        const wdy = wp.y - boss.pos.y;
        const wdist = Math.hypot(wdx, wdy) || 1;
        targetVx = (wdx / wdist) * speed;
        targetVy = (wdy / wdist) * speed;
      }

      boss.velocity.x = targetVx;
      boss.velocity.y = targetVy;

      // Determine facing direction based on movement angle
      if (Math.abs(boss.velocity.x) > Math.abs(boss.velocity.y) * 1.1) {
        boss.titanFacing = boss.velocity.x > 0 ? 'right' : 'left';
      } else if (Math.abs(boss.velocity.y) > 0.1) {
        boss.titanFacing = boss.velocity.y > 0 ? 'front' : 'back';
      } else {
        boss.titanFacing = dy > 0 ? 'front' : 'back';
      }

      // Heavy footsteps: screen shake and dust cloud (+35% cadence to match faster boss stride)
      boss.titanFootstepTimer = (boss.titanFootstepTimer ?? 0) + dt;
      if (boss.titanFootstepTimer >= 0.44) {
        boss.titanFootstepTimer = 0;
        this.state.events.push({
          type: 'stage1_boss_rumble',
          data: { pos: { ...boss.pos }, intensity: 0.18, isFootstep: true, z: boss.groundZ }
        });
      }

      // Check touch damage against player (2x scale)
      if (dist <= boss.radius + 36 && Math.abs(p.z - boss.z) < 140) {
        this.damagePlayer(boss.touchDamage * 0.8 * dt, true, boss, 'melee');
      }

      boss.attackCooldownRemaining -= dt;
      boss.titanTimer = (boss.titanTimer ?? STAGE1_BOSS_CONFIG.laser.duration) - dt;

      // Do NOT interrupt pursuit or fire through the Tower if player is far away or on a blocked elevation layer
      const verticalReachable = Math.abs(p.z - boss.z) <= 520;
      const inAttackRange = dist <= 1050 && verticalReachable;
      const canAttack =
        (inAttackRange && boss.attackCooldownRemaining <= 0) ||
        (dist <= 1350 && verticalReachable && boss.attackCooldownRemaining <= 0 && (this.stage1BossCycle % 3 === 2));

      if (canAttack || (boss.titanTimer <= 0 && inAttackRange)) {
        boss.velocity.x = 0;
        boss.velocity.y = 0;
        boss.attackCooldownRemaining = STAGE1_BOSS_CONFIG.attackCooldown;

        const cycle = this.stage1BossCycle % 3;
        this.stage1BossCycle++;

        if (cycle === 0) {
          // ATTACK 1 — Massive 80-unit Mouth Lightning Laser Sweep
          boss.titanState = 'laser_sweep';
          boss.titanTimer = STAGE1_BOSS_CONFIG.laser.duration;
          boss.titanLaserSweepDir = this.state.rng.next() > 0.5 ? 1 : -1;
          const pAngle = Math.atan2(dy, dx);
          boss.titanLaserAngle = pAngle - 0.75 * boss.titanLaserSweepDir;
          this.state.events.push({
            type: 'stage1_boss_laser_sweep',
            data: { id: boss.id, start: true, duration: STAGE1_BOSS_CONFIG.laser.duration, thickness: STAGE1_BOSS_CONFIG.laser.thickness }
          });
        } else if (cycle === 1) {
          // ATTACK 2 — Independent Long-Range Tentacle Strikes (Reach 900)
          boss.titanState = 'tentacle_strike';
          boss.titanTentaclePhase = 'telegraph';
          boss.titanTentacleTarget = { x: p.pos.x, y: p.pos.y };
          boss.titanTimer = STAGE1_BOSS_CONFIG.tentacle.telegraphDuration;
          boss.titanTentacleHitApplied = false;

          // Immediately orient boss toward player for unmistakable tentacle strike readout
          if (Math.abs(dx) > Math.abs(dy) * 1.1) {
            boss.titanFacing = dx > 0 ? 'right' : 'left';
          } else {
            boss.titanFacing = dy > 0 ? 'front' : 'back';
          }

          this.state.events.push({
            type: 'stage1_boss_tentacle_strike',
            data: { id: boss.id, phase: 'telegraph', target: { ...boss.titanTentacleTarget } }
          });
        } else {
          // ATTACK 3 — Ten Elemental Projectile Barrage
          boss.titanState = 'elemental_barrage';
          boss.titanTimer = STAGE1_BOSS_CONFIG.elemental.chargeDuration;
          boss.titanElementalCharged = false;
          this.state.events.push({
            type: 'stage1_boss_elemental_charge',
            data: { id: boss.id, duration: STAGE1_BOSS_CONFIG.elemental.chargeDuration }
          });
        }
      }
      return;
    }

    // 5. ATTACK 1 — MASSIVE 80-UNIT MOUTH LIGHTNING LASER SWEEP
    if (boss.titanState === 'laser_sweep') {
      boss.velocity.x = 0;
      boss.velocity.y = 0;
      const laserDur = STAGE1_BOSS_CONFIG.laser.duration;
      boss.titanTimer = (boss.titanTimer ?? laserDur) - dt;
      const laserElapsed = laserDur - boss.titanTimer;
      const laserNorm = Math.min(1.0, Math.max(0, laserElapsed / laserDur));

      const pAngle = Math.atan2(p.pos.y - boss.pos.y, p.pos.x - boss.pos.x);
      const sweepDir = boss.titanLaserSweepDir ?? 1;
      const currentLaserAngle = (pAngle - 0.75 * sweepDir) + (1.5 * sweepDir) * laserNorm;
      boss.titanLaserAngle = currentLaserAngle;

      // Update boss facing to match the sweeping head/mouth
      const cosA = Math.cos(currentLaserAngle);
      const sinA = Math.sin(currentLaserAngle);
      if (Math.abs(cosA) > 0.6) {
        boss.titanFacing = cosA > 0 ? 'right' : 'left';
      } else {
        boss.titanFacing = sinA > 0 ? 'front' : 'back';
      }

      // Hitbox: 80 units thickness check against player
      const beamRange = STAGE1_BOSS_CONFIG.laser.range;
      const beamEndX = boss.pos.x + cosA * beamRange;
      const beamEndY = boss.pos.y + sinA * beamRange;
      const distToBeam = distToSeg(p.pos.x, p.pos.y, boss.pos.x, boss.pos.y, beamEndX, beamEndY);

      if (
        distToBeam <= 56 + 24 &&
        Math.abs(p.z - boss.z) < 160 &&
        this.state.terrain.checkLineOfSight3D(
          { x: boss.pos.x, y: boss.pos.y, z: boss.z + 180 },
          { x: p.pos.x, y: p.pos.y, z: p.z + 52 }
        )
      ) {
        // Continuous tick damage
        if (!p.isDashing) {
          this.damagePlayer(22 * dt, true, boss, 'beam');
        }
      }

      this.state.events.push({
        type: 'stage1_boss_laser_sweep',
        data: {
          id: boss.id,
          pos: { ...boss.pos },
          angle: currentLaserAngle,
          thickness: STAGE1_BOSS_CONFIG.laser.thickness,
          endPos: { x: beamEndX, y: beamEndY }
        }
      });

      if (boss.titanTimer <= 0) {
        boss.titanState = 'idle';
        boss.titanTimer = STAGE1_BOSS_CONFIG.postAttackPause;
        this.state.events.push({
          type: 'stage1_boss_laser_sweep',
          data: { id: boss.id, start: false }
        });
      }
      return;
    }

    // 6. ATTACK 2 — INDEPENDENT LONG-RANGE TENTACLE STRIKES
    if (boss.titanState === 'tentacle_strike') {
      boss.velocity.x = 0;
      boss.velocity.y = 0;
      boss.titanTimer = (boss.titanTimer ?? STAGE1_BOSS_CONFIG.tentacle.telegraphDuration) - dt;

      const target = boss.titanTentacleTarget ?? { x: p.pos.x, y: p.pos.y };

      // Keep boss facing toward the strike target so sprite animation aligns with the 3D tentacles
      const fdx = target.x - boss.pos.x;
      const fdy = target.y - boss.pos.y;
      if (Math.abs(fdx) > Math.abs(fdy) * 1.1) {
        boss.titanFacing = fdx > 0 ? 'right' : 'left';
      } else {
        boss.titanFacing = fdy > 0 ? 'front' : 'back';
      }

      if (boss.titanTentaclePhase === 'telegraph') {
        // Track player smoothly during initial telegraph window, then lock target so player can react and dodge
        const elapsed = STAGE1_BOSS_CONFIG.tentacle.telegraphDuration - boss.titanTimer;
        if (elapsed < STAGE1_BOSS_CONFIG.tentacle.lockDuration) {
          target.x += (p.pos.x - target.x) * Math.min(1.0, dt * 6);
          target.y += (p.pos.y - target.y) * Math.min(1.0, dt * 6);
          boss.titanTentacleTarget = { x: target.x, y: target.y };
        }

        if (boss.titanTimer <= 0) {
          // Enter strike phase
          boss.titanTentaclePhase = 'strike';
          boss.titanTimer = STAGE1_BOSS_CONFIG.tentacle.strikeDuration;
          boss.titanTentacleHitApplied = false;

          this.state.events.push({
            type: 'stage1_boss_tentacle_strike',
            data: { id: boss.id, phase: 'strike', pos: { ...boss.pos }, target: { ...target } }
          });
        }
      } else if (boss.titanTentaclePhase === 'strike') {
        const elapsed = STAGE1_BOSS_CONFIG.tentacle.strikeDuration - boss.titanTimer;
        // Strike impact hits synchronized with 3D tentacles slamming the ground
        if (elapsed >= STAGE1_BOSS_CONFIG.tentacle.impactTime && !boss.titanTentacleHitApplied) {
          boss.titanTentacleHitApplied = true;
          const strikeDist = Math.hypot(p.pos.x - target.x, p.pos.y - target.y);
          const targetElev = this.state.terrain.getElevation(target.x, target.y, boss.z, 180).height;
          if (strikeDist <= STAGE1_BOSS_CONFIG.tentacle.strikeRadius + 16 && Math.abs(p.z - targetElev) <= 160 && !p.isDashing) {
            this.damagePlayer(STAGE1_BOSS_CONFIG.tentacle.damage, false, boss, 'melee');
          }

          this.state.events.push({
            type: 'stage1_boss_tentacle_strike',
            data: { id: boss.id, phase: 'impact', pos: { ...boss.pos }, target: { ...target } }
          });
        }

        if (boss.titanTimer <= 0) {
          boss.titanTentaclePhase = 'retract';
          boss.titanTimer = STAGE1_BOSS_CONFIG.tentacle.retractDuration;
        }
      } else if (boss.titanTentaclePhase === 'retract') {
        if (boss.titanTimer <= 0) {
          boss.titanState = 'idle';
          boss.titanTimer = STAGE1_BOSS_CONFIG.postAttackPause;
        }
      }
      return;
    }

    // 7. ATTACK 3 — TEN ELEMENTAL PROJECTILE BARRAGE
    if (boss.titanState === 'elemental_barrage') {
      boss.velocity.x = 0;
      boss.velocity.y = 0;
      boss.titanTimer = (boss.titanTimer ?? STAGE1_BOSS_CONFIG.elemental.chargeDuration) - dt;

      if (boss.titanTimer <= 0 && !boss.titanElementalCharged) {
        boss.titanElementalCharged = true;

        // Launch all 10 elemental projectiles simultaneously targeting Commander's position with threatening spread
        const originZ = boss.z + 440;
        const pDist = Math.hypot(p.pos.x - boss.pos.x, p.pos.y - boss.pos.y) || 1;
        const pAng = Math.atan2(p.pos.y - boss.pos.y, p.pos.x - boss.pos.x);
        const count = STAGE1_BOSS_CONFIG.elemental.projectileCount;
        const speed = STAGE1_BOSS_CONFIG.elemental.speed;
        const totalArc = Math.PI * 0.38; // ~68-degree focused barrage arc centered directly on player

        for (let k = 0; k < count; k++) {
          const spreadFactor = ((k - (count - 1) * 0.5) / ((count - 1) * 0.5)); // -1.0 to 1.0
          const ang = pAng + spreadFactor * (totalArc * 0.5);
          const travelTime = pDist / speed;
          const vz = (p.z + 52 - originZ) / Math.max(0.5, travelTime);

          this.state.projectiles.push({
            id: `proj_${this.nextProjId++}`,
            type: 'elemental_ball',
            pos: { x: boss.pos.x, y: boss.pos.y },
            z: originZ,
            velocity: { x: Math.cos(ang) * speed, y: Math.sin(ang) * speed },
            vz,
            speed,
            damage: STAGE1_BOSS_CONFIG.elemental.damage,
            pierceCount: 1,
            maxDistance: STAGE1_BOSS_CONFIG.elemental.maxDistance,
            distanceTraveled: 0,
            owner: 'enemy',
            radius: STAGE1_BOSS_CONFIG.elemental.radius,
            hitEnemyIds: new Set(),
            originZ,
            targetZ: p.z + 52
          });
        }

        this.state.events.push({
          type: 'stage1_boss_elemental_launch',
          data: { id: boss.id, pos: { ...boss.pos }, count }
        });

        boss.titanState = 'idle';
        boss.titanTimer = STAGE1_BOSS_CONFIG.postAttackPause;
      }
      return;
    }
  }

  /**
   * Finds the nearest unopened pod within interaction range of the player
   */
  public getInteractablePod(): OrganicPodState | null {
    const p = this.state.player;
    let best: OrganicPodState | null = null;
    let bestDist = 125;
    for (let i = 0; i < this.state.pods.length; i++) {
      const pod = this.state.pods[i];
      if (pod.isOpened) continue;
      const d = Math.hypot(p.pos.x - pod.pos.x, p.pos.y - pod.pos.y);
      if (d <= bestDist) {
        const podZ = this.state.terrain.getElevation(pod.pos.x, pod.pos.y).height + (pod.zOffset ?? 0);
        if (Math.abs(p.z - podZ) > 130) continue;
        bestDist = d;
        best = pod;
      }
    }
    return best;
  }

  private updatePods(input: InputSnapshot, dt: number): void {
    const p = this.state.player;

    // 1. Process player interaction with unopened pods
    if (input.wantInteract) {
      const pod = this.getInteractablePod();
      if (pod && !pod.isOpened && p.currency >= pod.cost) {
        // Deduct cost exactly once and lock chest immediately
        p.currency -= pod.cost;
        pod.isOpened = true;
        pod.dissolveTimer = 1.6;
        this.triggerTimedEffect('pod_surge', 8.0, 0, 'buff_pod_surge');

        this.state.events.push({
          type: 'pod_opened',
          data: { podId: pod.id, pos: { ...pod.pos }, cost: pod.cost }
        });

        // Buff Chest: ALWAYS present 3 eligible choices (single roll inside queueBuffDraft)
        this.queueBuffDraft();
      }
    }

    // 2. Animate and resolve biological collapse & dissolution of emptied chests
    let hasDestroyed = false;
    for (let i = 0; i < this.state.pods.length; i++) {
      const pod = this.state.pods[i];
      if (pod.isOpened && !pod.isDestroyed) {
        pod.dissolveTimer = (pod.dissolveTimer ?? 1.6) - dt;

        if (pod.dissolveTimer <= 1.0 && !pod.isDissolving) {
          pod.isDissolving = true;
          this.state.events.push({
            type: 'pod_dissolving',
            data: { podId: pod.id, pos: { ...pod.pos } }
          });
        }

        if (pod.dissolveTimer <= 0) {
          pod.isDestroyed = true;
          hasDestroyed = true;
          this.state.events.push({
            type: 'pod_removed',
            data: { podId: pod.id }
          });
        }
      }
    }

    // 3. Remove emptied pods completely from environment & collision
    if (hasDestroyed) {
      this.state.pods = this.state.pods.filter((pod) => !pod.isDestroyed);
    }
  }

  public tryActivateArtifact(): boolean {
    const art = this.state.artifact;
    if (!art) return false;
    const policy = getStageArtifactPolicy(this.state.stageNumber);
    if (policy.mode === 'four_enhancements') {
      if (this.state.completedEnhancementCategories.size < policy.requiredEnhancementCategories.length) {
        return false;
      }
    } else if (!art.isCharged) {
      return false;
    }
    if (art.phase !== 'unlocked_ready' || !art.isTeleporterReady || art.isBossSpawned) {
      return false;
    }
    if (this.state.enemies.some((e) => e.isStage1Titan && e.health > 0)) {
      return false;
    }

    art.phase = 'boss_summoning';
    art.isTeleporterReady = false;
    art.isSummoning = true;
    art.summonTimer = 4.0;
    art.isBossSpawned = true;
    art.isBossDefeated = false;
    this.state.hasBossSpawned = true;
    this.combatDirector.enterBossMode(this.state);
    this.spawnStage1Titan(art.pos);
    return true;
  }

  public forceUnlockArtifactForDev(): void {
    const art = this.state.artifact;
    if (!art) return;
    const policy = getStageArtifactPolicy(this.state.stageNumber);
    for (const cat of policy.requiredEnhancementCategories) {
      this.state.markEnhancementCategoryCompleted(cat);
    }
    art.chargeProgress = 100;
    art.isCharged = true;
    if (!art.isBossSpawned) {
      art.isTeleporterReady = true;
      art.phase = 'unlocked_ready';
      this.state.events.push({
        type: 'tower_unlocked',
        data: { recovered: this.state.completedEnhancementCategories.size, required: Math.max(1, policy.requiredEnhancementCategories.length) }
      });
    }
  }

  public completeWorldEventForDev(eventId: string): boolean {
    const ev = this.state.worldEvents.find((e) => e.id === eventId);
    if (!ev || ev.isCompleted) return false;
    ev.chargeProgress = 100;
    ev.isCompleted = true;
    ev.isActive = false;
    ev.dashPlatforms = [];
    this.syncActiveDashPlatforms();
    this.handleWorldEventCompleted(ev, ev.type !== 'void_corruption');
    return true;
  }

  private handleWorldEventCompleted(ev: WorldEventState, isAugmentEvent: boolean): void {
    this.state.events.push({
      type: 'world_event_completed',
      data: { id: ev.id, type: ev.type, name: ev.name, pos: { ...ev.pos }, isAugmentEvent }
    });
    if (!isAugmentEvent) return;

    const newlyCompleted = this.state.markEnhancementCategoryCompleted(ev.type);
    if (newlyCompleted) {
      this.state.updateCalculatedStats();
    }
    const art = this.state.artifact;
    const policy = getStageArtifactPolicy(this.state.stageNumber);
    if (
      newlyCompleted &&
      art &&
      policy.mode === 'four_enhancements' &&
      this.state.completedEnhancementCategories.size >= policy.requiredEnhancementCategories.length &&
      art.phase === 'locked_missing_modules'
    ) {
      art.phase = 'unlocked_ready';
      art.isCharged = true;
      art.isTeleporterReady = true;
      art.chargeProgress = 100;
      this.state.events.push({
        type: 'tower_unlocked',
        data: {
          recovered: this.state.completedEnhancementCategories.size,
          required: policy.requiredEnhancementCategories.length
        }
      });
    }
  }

  private updateArtifact(dt: number, input: InputSnapshot): void {
    const p = this.state.player;
    const art = this.state.artifact;
    if (!art) return;

    const policy = getStageArtifactPolicy(this.state.stageNumber);
    if (!art.phase) {
      art.phase = policy.mode === 'four_enhancements' ? 'locked_missing_modules' : 'charging';
    }
    art.prematureInteractCooldown = Math.max(0, (art.prematureInteractCooldown ?? 0) - dt);

    const dist = Math.hypot(p.pos.x - art.pos.x, p.pos.y - art.pos.y);
    const artElev = this.state.terrain.calculateHeight(art.pos.x, art.pos.y);
    const vertOk = !this.state.terrain.isCustomTestMap || Math.abs(p.z - artElev) <= 180;

    if (art.phase === 'locked_missing_modules') {
      if (dist <= art.radius + 60 && vertOk && input.wantInteract && (art.prematureInteractCooldown ?? 0) <= 0) {
        art.prematureInteractCooldown = 1.5;
        const isFirstAttempt = !art.prematureInteractWarned;
        art.prematureInteractWarned = true;
        this.state.events.push({
          type: 'tower_locked_interact',
          data: {
            recovered: this.state.completedEnhancementCategories.size,
            required: policy.requiredEnhancementCategories.length || 4,
            isFirstAttempt
          }
        });
      }
      return;
    }

    // Optional charging path for future stages (disabled on Stage 1)
    if (policy.usesCharging && art.phase === 'charging') {
      if (dist <= 260 && vertOk) {
        art.chargeProgress = Math.min(100, art.chargeProgress + 1.8 * dt);
        if (art.chargeProgress >= 100) {
          art.chargeProgress = 100;
          art.isCharged = true;
          art.isTeleporterReady = true;
          art.phase = 'unlocked_ready';
          this.state.events.push({ type: 'artifact_charged', data: {} });
        }
      }
      return;
    }

    if (art.phase === 'unlocked_ready') {
      if (dist <= art.radius + 60 && vertOk && input.wantInteract) {
        this.tryActivateArtifact();
      }
      return;
    }

    if (art.phase === 'boss_summoning' || art.isSummoning) {
      art.summonTimer = Math.max(0, (art.summonTimer || 4.0) - dt);
      if (art.summonTimer <= 0) {
        art.isSummoning = false;
        art.phase = art.isBossDefeated ? 'exit_ready' : 'boss_active';
      }
      return;
    }

    if (art.phase === 'restoring') {
      art.restorationTimer = Math.max(0, (art.restorationTimer ?? 0) - dt);
      if (art.restorationTimer <= 0) {
        art.phase = 'exit_ready';
      }
      return;
    }

    if (art.phase === 'teleport_preparing') {
      // Ignore repeated [E] interactions so regional refreezing and dialogue playback cannot restart.
      input.wantInteract = false;
      art.teleportPrepTimer = 0;
      art.restorationTimer = (art.restorationTimer || 0) + dt;

      // Hard 120s safety bound accommodates full aftermath + refreeze + departure dialogue while preventing any permanent soft-lock.
      const essentialBusy = this.isEssentialDepartureDialogueBusy() && (art.restorationTimer || 0) < 120.0;
      if (essentialBusy) {
        art.awaitingDialogueSync = true;
        return;
      }
      art.awaitingDialogueSync = false;
      art.phase = 'cleared';
      art.isCompleted = true;
      this.state.isStageCleared = true;
      this.state.events.push({ type: 'stage_cleared', data: {} });
      return;
    }

    if ((art.phase === 'exit_ready' || (art.isBossDefeated && !art.isCompleted)) && art.phase !== 'cleared') {
      if (dist <= art.radius + 60 && vertOk && input.wantInteract) {
        input.wantInteract = false;
        art.phase = 'teleport_preparing';
        art.teleportPrepDuration = 0;
        art.teleportPrepTimer = 0;
        art.restorationTimer = 0;
        art.awaitingDialogueSync = true;
        if (!art.refreezeTriggered) {
          art.refreezeTriggered = true;
          this.state.events.push({
            type: 'stage1_refreeze_started',
            data: {
              origin: { x: art.pos.x, y: art.pos.y },
              pos: { x: art.pos.x, y: art.pos.y },
              durationSec: 20.0
            }
          });
        }
      }
    }
  }

  private updateCurrencyPickups(dt: number): void {
    const p = this.state.player;
    const pickupRadius = p.calculatedStats.pickupRadius;
    const alive: typeof this.state.currencyDrops = [];

    for (let i = 0; i < this.state.currencyDrops.length; i++) {
      const drop = this.state.currencyDrops[i];
      drop.lifetime -= dt;
      if (drop.lifetime <= 0) continue;

      // Ballistic pop & settle onto terrain
      if (!drop.settled) {
        drop.pos.x += drop.vel.x * dt;
        drop.pos.y += drop.vel.y * dt;
        drop.vel.x *= 0.92;
        drop.vel.y *= 0.92;

        drop.z += drop.vz * dt;
        drop.vz -= 540 * dt;

        const groundZ = this.state.terrain.getElevation(drop.pos.x, drop.pos.y).height;
        if (drop.z <= groundZ) {
          drop.z = groundZ;
          if (Math.abs(drop.vz) > 45) {
            drop.vz = -drop.vz * 0.35; // single small bounce
          } else {
            drop.vz = 0;
            drop.settled = true;
          }
        }
      }

      const dist = Math.hypot(p.pos.x - drop.pos.x, p.pos.y - drop.pos.y);
      const groundZ = this.state.terrain.getElevation(drop.pos.x, drop.pos.y).height;
      const heightAboveGround = Math.abs(drop.z - groundZ);

      // Vacuum pickup within configurable pickupRadius
      if (dist < pickupRadius && (drop.settled || heightAboveGround < 36)) {
        const pullSpeed = 780 * (1.2 - dist / (pickupRadius + 20));
        const invDist = 1 / (dist || 1);
        drop.pos.x += (p.pos.x - drop.pos.x) * invDist * pullSpeed * dt;
        drop.pos.y += (p.pos.y - drop.pos.y) * invDist * pullSpeed * dt;
        drop.z = this.state.terrain.getElevation(drop.pos.x, drop.pos.y).height + 8;
      }

      if (dist <= 56 && (drop.settled || heightAboveGround < 48)) {
        const gained = Math.max(1, Math.round(drop.value * (p.calculatedStats.currencyMultiplier || 1.0)));
        p.currency += gained;
        this.state.events.push({
          type: 'currency_collected',
          data: { value: gained, pos: { ...drop.pos }, z: drop.z }
        });
        continue;
      }

      alive.push(drop);
    }

    this.state.currencyDrops = alive;
  }

  private updateItemDrops(dt: number, _input?: InputSnapshot): void {
    const p = this.state.player;
    const alive: typeof this.state.itemDrops = [];

    for (let i = 0; i < this.state.itemDrops.length; i++) {
      const drop = this.state.itemDrops[i];
      drop.lifetime -= dt;
      if (drop.lifetime <= 0) continue;

      if (!drop.settled) {
        if (drop.vel) {
          drop.pos.x += drop.vel.x * dt;
          drop.pos.y += drop.vel.y * dt;
          drop.vel.x *= 0.9;
          drop.vel.y *= 0.9;
        }

        drop.z += drop.vz * dt;
        drop.vz -= 520 * dt;

        const groundZ = this.state.terrain.getElevation(drop.pos.x, drop.pos.y).height;
        if (drop.z <= groundZ) {
          drop.z = groundZ;
          if (Math.abs(drop.vz) > 50) {
            drop.vz = -drop.vz * 0.38;
          } else {
            drop.vz = 0;
            drop.settled = true;
          }
        }
      }

      const dist = Math.hypot(p.pos.x - drop.pos.x, p.pos.y - drop.pos.y);

      if (drop.settled) {
        if (drop.isDoubleJumpTestPickup) {
          if (dist <= 95 && Math.abs(p.z - drop.z) <= 120) {
            this.applyBuffToPlayer('buff_aerial_boost', 'pickup');
            p.airJumpsRemaining = p.maxAirJumps;
            this.state.events.push({
              type: 'item_acquired',
              data: {
                item: 'double_jump_test',
                name: 'Aerial Boost (Double Jump)',
                stackCount: p.buffs.buff_aerial_boost || 1,
                pos: { ...drop.pos }
              }
            });
            continue;
          }
        } else if (drop.isBuffDrop) {
          // Enemy / random buff drops: no [E] key or modal — pass through to collect immediately
          const attractRange = Math.max(180, (p.calculatedStats.pickupRadius || 250) * 0.85);
          if (dist < attractRange) {
            const invDist = 1 / (dist || 1);
            drop.pos.x += (p.pos.x - drop.pos.x) * invDist * 420 * dt;
            drop.pos.y += (p.pos.y - drop.pos.y) * invDist * 420 * dt;
          }

          if (dist <= 78 && Math.abs(p.z - drop.z) <= 105) {
            const chosenBuff =
              drop.buffId && isBuffEligibleForPlayer(drop.buffId, p)
                ? drop.buffId
                : rollWeightedRandomBuff(this.state.lootRng, p);
            if (chosenBuff) {
              const dropOrigin = drop.id.startsWith('buffdrop_elite_') ? 'elite' : 'level';
              this.applyBuffToPlayer(chosenBuff, 'enemy_drop', dropOrigin);
              this.state.events.push({
                type: 'buff_capsule_collected',
                data: { buffId: chosenBuff, pos: { ...drop.pos } }
              });
            }
            continue;
          }
        } else if (drop.itemId) {
          // Gentle magnetic pull when close for core passive items
          if (dist < 190) {
            const invDist = 1 / (dist || 1);
            drop.pos.x += (p.pos.x - drop.pos.x) * invDist * 420 * dt;
            drop.pos.y += (p.pos.y - drop.pos.y) * invDist * 420 * dt;
          }

          if (dist <= 68) {
            const itemId = drop.itemId;
            p.items[itemId] = (p.items[itemId] || 0) + 1;
            this.state.updateCalculatedStats();

            this.state.events.push({
              type: 'item_acquired',
              data: {
                item: itemId,
                name: ITEM_REGISTRY[itemId].name,
                stackCount: p.items[itemId],
                pos: { ...drop.pos }
              }
            });
            continue;
          }
        }
      }

      alive.push(drop);
    }

    this.state.itemDrops = alive;
  }

  private spawnSequentialEventElite(ev: WorldEventState, waveIndex: number): string {
    const baseAngle = (waveIndex - 1) * ((Math.PI * 2) / 3) + this.state.rng.range(-0.35, 0.35);
    const bounds = this.state.terrain.getPlayableBounds(90);
    let sx = ev.pos.x;
    let sy = ev.pos.y;
    let spawnElev = this.state.terrain.getElevation(sx, sy, 1e6, 22).height;

    for (let attempt = 0; attempt < 12; attempt++) {
      const ang = baseAngle + attempt * (Math.PI / 6);
      const dist = attempt < 6 ? Math.max(70, ev.radius * 0.82) : 55;
      const cx = Math.max(bounds.minX, Math.min(bounds.maxX, ev.pos.x + Math.cos(ang) * dist));
      const cy = Math.max(bounds.minY, Math.min(bounds.maxY, ev.pos.y + Math.sin(ang) * dist));
      const sample = this.state.terrain.getElevation(cx, cy, 1e6, 22);
      if (sample.isWalkable) {
        sx = cx;
        sy = cy;
        spawnElev = sample.height;
        break;
      }
    }

    const cfg = ENEMY_CONFIGS.elite;
    const { tierDef } = getDifficultyTier(this.state.gameTime);
    const waveMult = 0.9 + (waveIndex - 1) * 0.12;
    const maxHp = Math.max(80, Math.round(cfg.maxHealth * tierDef.hpMultiplier * waveMult));
    const eliteId = `event_elite_${ev.id}_w${waveIndex}_${this.nextEnemyId++}`;

    const elite: EnemyState = {
      id: eliteId,
      type: 'elite',
      pos: { x: sx, y: sy },
      velocity: { x: 0, y: 0 },
      z: spawnElev,
      groundZ: spawnElev,
      health: maxHp,
      maxHealth: maxHp,
      speed: cfg.speed * tierDef.speedMultiplier,
      touchDamage: Math.round(cfg.touchDamage * tierDef.damageMultiplier),
      attackCooldown: cfg.attackCooldown,
      attackCooldownRemaining: 0.75,
      attackRange: cfg.attackRange,
      isElite: true,
      isBoss: false,
      isScriptedEventEnemy: true,
      currencyReward: cfg.currencyReward,
      xpReward: cfg.xpReward,
      radius: cfg.radius,
      isSpawning: true,
      spawnProgress: 0,
      spawnDuration: 0.65,
      isAlerted: true
    };

    this.state.enemies.push(elite);
    this.state.events.push({
      type: 'enemy_emerging',
      data: { id: elite.id, type: elite.type, pos: { x: sx, y: sy } }
    });
    return eliteId;
  }

  private buildDashEventPlatforms(ev: WorldEventState): DashEventPlatform[] {
    const platforms: DashEventPlatform[] = [];
    const baseElev = this.state.terrain.getElevation(ev.pos.x, ev.pos.y, 1e6, 22).height + (ev.zOffset ?? 0);
    const spiralRadius = 115;
    const baseAngle = ev.rotationY ?? 0;
    // Standard single jump reaches ~115u apex (vz=470, g=960); 74u vertical step per platform is comfortably reachable in 1 jump
    const stepHeight = 74;
    let prevZ = baseElev;

    for (let i = 1; i <= 5; i++) {
      const angle = baseAngle + (i - 1) * 1.12;
      const px = ev.pos.x + Math.cos(angle) * spiralRadius;
      const py = ev.pos.y + Math.sin(angle) * spiralRadius;
      const groundAtP = this.state.terrain.getElevation(px, py, 1e6, 22).height;
      const pz = Math.max(prevZ + stepHeight, groundAtP + 40);
      prevZ = pz;
      platforms.push({
        index: i,
        x: px,
        y: py,
        z: pz,
        radius: 60,
        reached: false
      });
    }
    return platforms;
  }

  private syncActiveDashPlatforms(): void {
    const active: DashEventPlatform[] = [];
    for (let i = 0; i < this.state.worldEvents.length; i++) {
      const ev = this.state.worldEvents[i];
      if (ev.type === 'dash_totem' && ev.isActive && !ev.isCompleted && ev.dashPlatforms) {
        for (let j = 0; j < ev.dashPlatforms.length; j++) {
          active.push(ev.dashPlatforms[j]);
        }
      }
    }
    this.state.terrain.activeDashPlatforms = active;
  }

  private findUltimatePayloadSpawnPos(shrinePos: Vector2): { x: number; y: number; z: number } {
    const bounds = this.state.terrain.getPlayableBounds(110);
    const distances = [620, 520, 720, 440, 360];
    const startAngle = this.state.rng.range(0, Math.PI * 2);

    let fallback: { x: number; y: number; z: number } | null = null;

    for (let dIdx = 0; dIdx < distances.length; dIdx++) {
      const dist = distances[dIdx];
      for (let a = 0; a < 16; a++) {
        const ang = startAngle + (a / 16) * Math.PI * 2;
        const cx = shrinePos.x + Math.cos(ang) * dist;
        const cy = shrinePos.y + Math.sin(ang) * dist;
        if (cx < bounds.minX || cx > bounds.maxX || cy < bounds.minY || cy > bounds.maxY) continue;

        const sample = this.state.terrain.getElevation(cx, cy, 1e6, 22);
        if (!sample.isWalkable) continue;

        let blockedByObstacle = false;
        for (let o = 0; o < this.state.obstacles.length; o++) {
          const obs = this.state.obstacles[o];
          if (Math.hypot(cx - obs.pos.x, cy - obs.pos.y) < obs.radius + 36) {
            blockedByObstacle = true;
            break;
          }
        }
        if (blockedByObstacle) continue;

        if (!fallback) {
          fallback = { x: cx, y: cy, z: sample.height };
        }
        if (!sample.isInWater && sample.surfaceType !== 'chasm') {
          return { x: cx, y: cy, z: sample.height };
        }
      }
    }

    if (fallback) return fallback;
    const safeX = Math.max(bounds.minX, Math.min(bounds.maxX, shrinePos.x + 320));
    const safeY = Math.max(bounds.minY, Math.min(bounds.maxY, shrinePos.y));
    return {
      x: safeX,
      y: safeY,
      z: this.state.terrain.getElevation(safeX, safeY, 1e6, 22).height
    };
  }

  /**
   * World Events System:
   * 1. Primal Totem (LMB Augment — Fight within range for duration)
   * 2. Secondary Totem (RMB Augment — Fight within range; 3 sequential Elites)
   * 3. Dash Totem (Dash Augment — 5 jump-high platforms appear on start; jump to reach top)
   * 4. Orbital Uplink (Ultimate Augment — Collect core guided by huge vertical light & deliver; +25% move speed, attacks disabled while carrying)
   */
  private updateWorldEvents(dt: number, input: InputSnapshot): void {
    const p = this.state.player;

    for (let i = 0; i < this.state.worldEvents.length; i++) {
      const ev = this.state.worldEvents[i];
      if (ev.isCompleted) continue;

      const d = Math.hypot(p.pos.x - ev.pos.x, p.pos.y - ev.pos.y);

      // Event 1: LMB Augment Event (Fight within range for duration)
      if (ev.type === 'primal_totem') {
        if (d <= ev.radius) {
          if (!ev.isActive && ev.chargeProgress <= 0) {
            this.state.events.push({
              type: 'world_event_activated',
              data: { id: ev.id, type: ev.type, name: ev.name }
            });
            this.state.events.push({
              type: 'overseer_comm',
              data: {
                text: 'Bio-resonance field engaged. Remain within the perimeter and repel hostile organisms until synchronization reaches 100%.',
                durationSec: 6.5
              }
            });
          }
          ev.isActive = true;
          this.unlockStage1EnemySpawning('world_event_triggered');
          ev.chargeProgress = Math.min(100, ev.chargeProgress + (100 / 14) * dt);
          ev.pulseTimer += dt;

          if (ev.pulseTimer >= 2.2) {
            ev.pulseTimer = 0;
            this.state.events.push({
              type: 'world_event_pulse',
              data: { id: ev.id, pos: { ...ev.pos }, radius: ev.radius }
            });
          }

          // Draw nearby non-boss enemies toward the totem
          for (let e = 0; e < this.state.enemies.length; e++) {
            const enemy = this.state.enemies[e];
            if (enemy.health <= 0 || enemy.isBoss) continue;
            const ed = Math.hypot(enemy.pos.x - ev.pos.x, enemy.pos.y - ev.pos.y);
            if (ed < 320 && ed > 40) {
              const inv = 1 / ed;
              enemy.pos.x -= (enemy.pos.x - ev.pos.x) * inv * 35 * dt;
              enemy.pos.y -= (enemy.pos.y - ev.pos.y) * inv * 35 * dt;
            }
          }

          if (ev.chargeProgress >= 50 && !ev.hasSpawnedBoss50) {
            ev.hasSpawnedBoss50 = true;
            this.spawnEventBoss(ev.pos);
          }

          if (ev.chargeProgress >= 100) {
            ev.isCompleted = true;
            ev.isActive = false;

            // Purifying ground shockwave: 160 damage to all enemies in area
            const victims = this.spatialGrid.getNearby(ev.pos, ev.radius + 40);
            for (const v of victims) {
              if (v.health > 0) this.damageEnemy(v, 160, v.pos);
            }

            this.handleWorldEventCompleted(ev, true);

            // Opens draft with ONLY Basic Skill Evolutions!
            this.queueBuffDraft('basic_skill_totem');
          }
        } else if (ev.chargeProgress > 0 && !ev.isCompleted) {
          ev.chargeProgress = Math.max(0, ev.chargeProgress - 3.5 * dt);
          if (ev.chargeProgress <= 0) {
            ev.isActive = false;
          }
        }
      }

      // Event 2: RMB Augment Event (3 Elites come one after another)
      else if (ev.type === 'secondary_totem') {
        if (!ev.isActive && d <= ev.radius) {
          ev.isActive = true;
          this.unlockStage1EnemySpawning('world_event_triggered');
          ev.killCount = 0;
          ev.killTarget = 3;
          ev.eliteWaveIndex = 1;
          ev.chargeProgress = 0;
          ev.activeEliteId = this.spawnSequentialEventElite(ev, 1);

          this.state.events.push({
            type: 'world_event_activated',
            data: { id: ev.id, type: ev.type, name: ev.name }
          });
          this.state.events.push({
            type: 'overseer_comm',
            data: {
              text: 'Kinetic conduit activated. Three elite organisms are converging one after another—eliminate all three to claim your secondary augmentation.',
              durationSec: 7.0
            }
          });
        } else if (ev.isActive) {
          ev.pulseTimer += dt;
          if (ev.pulseTimer >= 2.5) {
            ev.pulseTimer = 0;
            this.state.events.push({
              type: 'world_event_pulse',
              data: { id: ev.id, pos: { ...ev.pos }, radius: ev.radius }
            });
          }

          const activeElite = ev.activeEliteId
            ? this.state.enemies.find((e) => e.id === ev.activeEliteId && e.health > 0)
            : undefined;

          if (activeElite) {
            const kills = ev.killCount || 0;
            const waveHpLoss = Math.max(0, Math.min(1, 1 - activeElite.health / Math.max(1, activeElite.maxHealth)));
            ev.chargeProgress = Math.min(99, ((kills + waveHpLoss) / 3) * 100);
          } else {
            ev.killCount = (ev.killCount || 0) + 1;
            if (ev.killCount < 3) {
              ev.eliteWaveIndex = ev.killCount + 1;
              ev.activeEliteId = this.spawnSequentialEventElite(ev, ev.eliteWaveIndex);
              ev.chargeProgress = Math.round((ev.killCount / 3) * 100);
              this.state.events.push({
                type: 'world_event_pulse',
                data: { id: ev.id, pos: { ...ev.pos }, radius: ev.radius }
              });
              this.state.events.push({
                type: 'overseer_comm',
                data: {
                  text:
                    ev.eliteWaveIndex === 2
                      ? 'First elite neutralized. Second apex organism incoming—stay sharp.'
                      : 'Two elites eliminated. Final apex organism approaching!',
                  durationSec: 4.8
                }
              });
            } else {
              ev.chargeProgress = 100;
              ev.isCompleted = true;
              ev.isActive = false;
              ev.activeEliteId = null;

              const victims = this.spatialGrid.getNearby(ev.pos, ev.radius + 40);
              for (const v of victims) {
                if (v.health > 0) this.damageEnemy(v, 160, v.pos);
              }

              this.handleWorldEventCompleted(ev, true);

              // Opens draft with ONLY Secondary Skill Enhancements!
              this.queueBuffDraft('secondary_skill_totem');
            }
          }
        }
      }

      // Event 3: Dash Augment Event (5 jump-high platforms appear when event starts; jump to reach top)
      else if (ev.type === 'dash_totem') {
        if (!ev.isActive && d <= ev.radius) {
          ev.isActive = true;
          this.unlockStage1EnemySpawning('world_event_triggered');
          ev.highestPlatformReached = 0;
          ev.chargeProgress = 0;
          ev.dashPlatforms = this.buildDashEventPlatforms(ev);
          this.syncActiveDashPlatforms();

          this.state.events.push({
            type: 'world_event_activated',
            data: { id: ev.id, type: ev.type, name: ev.name }
          });
          this.state.events.push({
            type: 'overseer_comm',
            data: {
              text: 'Phase propulsion trial initiated. Five aerial stepping platforms have materialized around the pylon—jump from platform to platform to reach the fifth summit pad at the top!',
              durationSec: 8.0
            }
          });
        } else if (ev.isActive && ev.dashPlatforms) {
          if (this.state.terrain.activeDashPlatforms.length === 0) {
            this.syncActiveDashPlatforms();
          }

          for (let pIdx = 0; pIdx < ev.dashPlatforms.length; pIdx++) {
            const plat = ev.dashPlatforms[pIdx];
            const pd = Math.hypot(p.pos.x - plat.x, p.pos.y - plat.y);
            if (pd <= plat.radius + 14 && p.z >= plat.z - 20 && p.z <= plat.z + 65) {
              plat.reached = true;
              if (plat.index > (ev.highestPlatformReached || 0)) {
                ev.highestPlatformReached = plat.index;
                ev.chargeProgress = Math.min(100, plat.index * 20);
                this.state.events.push({
                  type: 'world_event_pulse',
                  data: { id: ev.id, pos: { x: plat.x, y: plat.y }, radius: plat.radius }
                });
              }

              if (plat.index === 5) {
                ev.chargeProgress = 100;
                ev.isCompleted = true;
                ev.isActive = false;
                ev.dashPlatforms = [];
                this.syncActiveDashPlatforms();

                const victims = this.spatialGrid.getNearby(ev.pos, ev.radius + 40);
                for (const v of victims) {
                  if (v.health > 0) this.damageEnemy(v, 160, v.pos);
                }

                this.handleWorldEventCompleted(ev, true);

                // Opens draft with ONLY Dash Skill Enhancements!
                this.queueBuffDraft('dash_skill_totem');
                break;
              }
            }
          }
        }
      }

      // Event 4: Ultimate Augment Event (Collect core guided by huge vertical light & deliver; +25% move speed, no attacks while carrying)
      else if (ev.type === 'orbital_uplink') {
        if (!ev.isActive && d <= ev.radius) {
          ev.isActive = true;
          this.unlockStage1EnemySpawning('world_event_triggered');
          ev.payloadCollected = false;
          ev.chargeProgress = 10;
          ev.payloadPos = this.findUltimatePayloadSpawnPos(ev.pos);

          this.state.events.push({
            type: 'world_event_activated',
            data: { id: ev.id, type: ev.type, name: ev.name }
          });
          this.state.events.push({
            type: 'overseer_comm',
            data: {
              text: 'Orbital uplink engaged. Follow the massive vertical light beam to retrieve the quantum core and return it here. Warning: carrying the core disables all attacks, but increases movement speed by 25%.',
              durationSec: 8.0
            }
          });
        } else if (ev.isActive) {
          if (!ev.payloadCollected && ev.payloadPos) {
            const distToItem = Math.hypot(p.pos.x - ev.payloadPos.x, p.pos.y - ev.payloadPos.y);
            const totalDist = Math.max(100, Math.hypot(ev.payloadPos.x - ev.pos.x, ev.payloadPos.y - ev.pos.y));
            ev.chargeProgress = Math.max(10, Math.min(48, Math.round((1 - Math.min(1, distToItem / totalDist)) * 38) + 10));

            if (distToItem <= 85) {
              ev.payloadCollected = true;
              ev.chargeProgress = 50;
              p.isCarryingEventPayload = true;
              p.carryingEventId = ev.id;
              this.state.updateCalculatedStats();

              this.state.events.push({
                type: 'world_event_pulse',
                data: { id: ev.id, pos: { x: ev.payloadPos.x, y: ev.payloadPos.y }, radius: 110 }
              });
              this.state.events.push({
                type: 'overseer_comm',
                data: {
                  text: 'Quantum core secured! Weapon systems offline; thruster speed increased by 25%. Follow the vertical light beacon back to the uplink shrine to deliver it!',
                  durationSec: 7.0
                }
              });
            }
          } else if (ev.payloadCollected) {
            if (!p.isCarryingEventPayload) {
              p.isCarryingEventPayload = true;
              p.carryingEventId = ev.id;
              this.state.updateCalculatedStats();
            }
            const totalDist = ev.payloadPos
              ? Math.max(100, Math.hypot(ev.payloadPos.x - ev.pos.x, ev.payloadPos.y - ev.pos.y))
              : 600;
            ev.chargeProgress = Math.max(50, Math.min(99, 50 + Math.round((1 - Math.min(1, d / totalDist)) * 49)));

            if (d <= ev.radius) {
              p.isCarryingEventPayload = false;
              p.carryingEventId = null;
              this.state.updateCalculatedStats();

              ev.chargeProgress = 100;
              ev.isCompleted = true;
              ev.isActive = false;

              // Free cataclysmic orbital strike on uplink location!
              const victims = this.spatialGrid.getNearby(ev.pos, 180);
              for (const v of victims) {
                if (v.health > 0) this.damageEnemy(v, 350, v.pos);
              }
              this.state.events.push({
                type: 'damage_dealt',
                data: {
                  pos: { ...ev.pos },
                  radius: 180,
                  damage: 350,
                  isOrbitalBlast: true
                }
              });

              this.handleWorldEventCompleted(ev, true);

              // Opens draft with ONLY Ultimate Skill Evolutions!
              this.queueBuffDraft('ultimate_beacon');
            }
          }
        }
      }

      // Event 5: Trial of Corruption (Enemy Buff/Debuff Modifier Event)
      else if (ev.type === 'void_corruption') {
        if (!ev.isActive) {
          if (d <= 70 && input.wantInteract) {
            ev.isActive = true;
            this.unlockStage1EnemySpawning('world_event_triggered');
            ev.durationTimer = 45;
            ev.killCount = 0;
            this.state.events.push({
              type: 'world_event_activated',
              data: { id: ev.id, type: ev.type, name: ev.name }
            });
          }
        } else {
          ev.durationTimer = Math.max(0, (ev.durationTimer || 35) - dt);
          ev.pulseTimer += dt;

          // Spawn flying boss (Brood Queen) at 50% duration (22.5s remaining)
          if (ev.durationTimer <= 22.5 && !ev.hasSpawnedBoss50) {
            ev.hasSpawnedBoss50 = true;
            this.spawnEventBoss(ev.pos);
          }

          // Every 7 seconds: Nullification EMP Wave silences ranged spitters in radius
          if (ev.pulseTimer >= 7.0) {
            ev.pulseTimer = 0;
            const victims = this.spatialGrid.getNearby(ev.pos, 350);
            for (const v of victims) {
              v.isStunned = true;
              v.stunTimer = 3.5;
            }
            this.state.events.push({
              type: 'world_event_pulse',
              data: { id: ev.id, pos: { ...ev.pos }, radius: 350, isEmp: true }
            });
          }

          // Complete if kill target met or survived duration
          if ((ev.killCount || 0) >= (ev.killTarget || 12) || (ev.durationTimer !== undefined && ev.durationTimer <= 0)) {
            ev.isCompleted = true;
            ev.isActive = false;

            this.handleWorldEventCompleted(ev, false);

            // Opens draft with Legendary Corruption Mutations!
            this.queueBuffDraft('void_corruption');
          }
        }
      }
    }
  }

  /**
   * Returns current interaction prompt for the HUD
   */
  public getInteractionPrompt(): { label: string; key: string; canAfford?: boolean; activeEvent?: WorldEventState } | null {
    const p = this.state.player;

    // 1. Check unopened Bio-Sacs (Pods)
    const pod = this.getInteractablePod();
    if (pod) {
      const canAfford = p.currency >= pod.cost;
      return {
        key: 'E',
        label: canAfford ? `Open Bio-Sac (Cost: ${pod.cost} Genes)` : `Bio-Sac (Need ${pod.cost} Genes)`,
        canAfford
      };
    }

    // 2. World Events (Random buff drops on ground are pass-through collected without prompt)
    for (let i = 0; i < this.state.worldEvents.length; i++) {
      const ev = this.state.worldEvents[i];
      const d = Math.hypot(p.pos.x - ev.pos.x, p.pos.y - ev.pos.y);

      if (ev.type === 'void_corruption' && !ev.isActive && !ev.isCompleted && d <= 70) {
        return {
          key: 'E',
          label: 'Trigger Trial of Corruption [Frenzy & Fragility]'
        };
      }

      if (ev.isActive && !ev.isCompleted && d <= ev.radius + 30) {
        return {
          key: 'ZONE',
          label: ev.type === 'primal_totem'
            ? `Bio-Resonance Synchronizing [${Math.round(ev.chargeProgress)}%]`
            : ev.type === 'secondary_totem'
              ? `Kinetic Conduit: Elite ${Math.min(3, (ev.killCount || 0) + 1)}/3 Active`
              : ev.type === 'dash_totem'
                ? `Ascend Phase Platforms [${ev.highestPlatformReached || 0}/5 Reached]`
                : ev.type === 'orbital_uplink'
                  ? ev.payloadCollected
                    ? `Deliver Quantum Core to Conduit!`
                    : `Follow Sky Beacon to Quantum Core`
                  : `Trial of Corruption [${ev.killCount || 0}/${ev.killTarget || 12} Eliminated (${Math.ceil(ev.durationTimer || 0)}s)]`,
          activeEvent: ev
        };
      }
    }

    // 4. Check Overseer Teleporter (Artifact)
    const art = this.state.artifact;
    if (art && !art.isCompleted) {
      const d = Math.hypot(p.pos.x - art.pos.x, p.pos.y - art.pos.y);
      const artElev = this.state.terrain.calculateHeight(art.pos.x, art.pos.y);
      const vertOk = !this.state.terrain.isCustomTestMap || Math.abs(p.z - artElev) <= 180;
      if (d <= art.radius + 60 && vertOk) {
        const policy = getStageArtifactPolicy(this.state.stageNumber);
        const phase = art.phase || (policy.mode === 'four_enhancements' ? 'locked_missing_modules' : 'charging');
        if (phase === 'locked_missing_modules') {
          const rec = this.state.completedEnhancementCategories.size;
          const req = policy.requiredEnhancementCategories.length || 4;
          return {
            key: 'E',
            label: `Inspect Artifact Tower (Safeguards Offline — ${rec}/${req})`
          };
        } else if (phase === 'charging' || !art.isCharged) {
          return {
            key: 'TELEPORTER',
            label: `Synchronizing... [${Math.floor(art.chargeProgress)}%]`
          };
        } else if (phase === 'unlocked_ready' && art.isTeleporterReady && !art.isBossSpawned) {
          return {
            key: 'E',
            label: 'Activate Artifact Tower'
          };
        } else if (phase === 'boss_summoning' || art.isSummoning) {
          return {
            key: 'WARNING',
            label: 'SEISMIC ANOMALY DETECTED — STAGE 1 BOSS EMERGING!'
          };
        } else if (phase === 'boss_active' || !art.isBossDefeated) {
          return {
            key: 'LOCKED',
            label: 'DEFEAT STAGE 1 BOSS TO RESTORE TOWER'
          };
        } else if (phase === 'restoring') {
          return {
            key: 'TOWER',
            label: 'Restoring Tower Safeguards...'
          };
        } else if (phase === 'teleport_preparing') {
          return {
            key: 'TELEPORTER',
            label: 'AWAITING TELEPORT SYNCHRONIZATION...'
          };
        } else {
          return {
            key: 'E',
            label: 'Activate Portal — Initiate Departure'
          };
        }
      }
    }

    return null;
  }
}

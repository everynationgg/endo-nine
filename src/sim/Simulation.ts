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
  SkillEnhancementId
} from './types';
import { SpatialGrid } from './SpatialGrid';
import { COMMANDER_SKILLS, DOCTOR_SKILLS, SKILL_REGISTRY } from './SkillDefs';
import { DOCTOR_CONFIG } from './DoctorConfig';
import { ENEMY_CONFIGS } from './EnemyDefs';
import {
  LOOT_CONFIG,
  rollWeightedPassiveItem,
  rollThreeBuffChoices,
  BUFF_REGISTRY,
  ITEM_REGISTRY,
  ALL_BUFF_IDS
} from './ItemDefs';
import { getDifficultyTier } from './DifficultyDefs';
import { STAGE1_BOSS_CONFIG } from './Stage1BossConfig';
import type { StageConfig } from '../dev/StageConfig';

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
  private pendingDraftFilters: Array<ExclusiveEventPool | undefined> = [];
  private lastCameraForward?: Vector2;
  private lastCameraRight?: Vector2;
  private navCalcsThisTick: number = 0;
  private stage1BossCycle: number = 0;

  public isCorruptionActive(): boolean {
    for (let i = 0; i < this.state.worldEvents.length; i++) {
      if (this.state.worldEvents[i].type === 'void_corruption' && this.state.worldEvents[i].isActive) {
        return true;
      }
    }
    return false;
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
    if (Math.abs(z - cross.z) > 70) return false;
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
  public startRun(): void {
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
    this.nextEnemyId = 1;
    this.nextProjId = 1;
    this.nextStrikeId = 1;
    this.nextDropId = 1;
    this.nextItemDropId = 1;

    // Re-apply active stage config so pods, events, obstacles, and spawns reflect latest saved/playtest layout
    if (this.state.activeStageConfig) {
      this.state.applyStageConfig(this.state.activeStageConfig);
    }

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
    p.z = this.state.terrain.getElevation(p.pos.x, p.pos.y).height;
    p.vz = 0;
    p.groundZ = p.z;
    p.isGrounded = true;
    p.isJumping = false;
    p.isGliding = false;
    p.jetpackFuel = 100;
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

    // Reset artifact, pods, and world events
    if (this.state.artifact) {
      this.state.artifact.chargeProgress = 0;
      this.state.artifact.isCharged = false;
      this.state.artifact.isTeleporterReady = false;
      this.state.artifact.isSummoning = false;
      this.state.artifact.summonTimer = 0;
      this.state.artifact.isBossSpawned = false;
      this.state.artifact.isBossDefeated = false;
      this.state.artifact.isCompleted = false;
    }
    this.state.hasBossSpawned = false;
    this.stage1BossCycle = 0;
    p.floatingSwords = [];
    for (let i = 0; i < this.state.pods.length; i++) {
      this.state.pods[i].isOpened = false;
    }
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
  }

  /**
   * Called by the UI when the player selects 1 of the 3 Buff cards while paused
   */
  public selectBuffChoice(buffId: BuffId): void {
    if (!this.state.isPausedForBuffChoice) return;
    if (!this.state.currentBuffChoices.includes(buffId)) return;

    const p = this.state.player;
    const def = BUFF_REGISTRY[buffId];
    p.buffs[buffId] = (p.buffs[buffId] || 0) + 1;

    // If this buff is linked to one of the 3 core passive items, stack it in player.items too
    if (def && def.linkedItemId) {
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

    // If this buff replaces an active skill slot (Primary, Secondary, Utility, Ultimate)
    if (def && def.replacesSkillSlot && def.replacementSkillId) {
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

    // If this buff augments an existing skill slot without replacing its base identity
    if (def && def.enhancesSkillSlot && def.enhancementId) {
      if (!p.skillEnhancements) {
        p.skillEnhancements = {};
      }
      p.skillEnhancements[def.enhancesSkillSlot] = def.enhancementId;

      // Clean up any previously active enhancement buff for this slot
      for (const [existingBuffId] of Object.entries(p.buffs)) {
        if (existingBuffId !== buffId) {
          const existingDef = BUFF_REGISTRY[existingBuffId as BuffId];
          if (existingDef && existingDef.enhancesSkillSlot === def.enhancesSkillSlot) {
            delete p.buffs[existingBuffId as BuffId];
          }
        }
      }

      // Slot-specific state cleanups
      if (def.enhancesSkillSlot === 'secondary' && def.enhancementId !== 'orbiting_blade') {
        p.orbitingBladeActive = false;
        p.orbitingBladeTimer = 0;
      }
      if (def.enhancesSkillSlot === 'primary' && def.enhancementId !== 'extended_slash') {
        p.slashComboStep = 0;
        p.slashComboTimer = 0;
      }

      // Preserve the base skill's id and baseDamage while updating HUD metadata and augment cooldown overrides
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
        stackCount: p.buffs[buffId]
      }
    });

    if (this.state.pendingBuffDrafts > 0) {
      this.state.pendingBuffDrafts--;
      const nextFilter = this.pendingDraftFilters.shift();
      this.state.currentBuffChoices = rollThreeBuffChoices(this.state.rng, nextFilter, p.heroId);
    } else {
      this.state.isPausedForBuffChoice = false;
      this.state.currentBuffChoices = [];
    }
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
    if (!this.state.isPausedForBuffChoice) {
      this.state.isPausedForBuffChoice = true;
      this.state.currentBuffChoices = rollThreeBuffChoices(this.state.rng, filterEvent, this.state.player.heroId);
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
    if ((p.phaseBarrierTimer ?? 0) > 0) {
      p.phaseBarrierTimer = Math.max(0, (p.phaseBarrierTimer ?? 0) - dt);
    }
    if ((p.adrenalineRushTimer ?? 0) > 0) {
      p.adrenalineRushTimer = Math.max(0, (p.adrenalineRushTimer ?? 0) - dt);
      if (p.adrenalineRushTimer <= 0) {
        this.state.updateCalculatedStats();
      }
    }

    // Rain of Crosses active storm spawner (5s fixed window; fields expire when rain ends)
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
      p.health = Math.min(p.maxHealth, p.health + p.calculatedStats.healthRegen * dt);
    }

    // Doctor Survivor Passive: Bio-Cellular Triage (3 HP/s baseline, 7 HP/s when < 50% HP)
    if (p.heroId === 'doctor' && p.health < p.maxHealth) {
      const triageRegen = (p.health < p.maxHealth * 0.5) ? 7.0 : 3.0;
      p.health = Math.min(p.maxHealth, p.health + triageRegen * dt);
    }

    // Active Orbiting Electric Swords (Secondary Upgrade 3: 360° Orbit, Max 7 Swords, Independent Kinetic Attack Strikes)
    if (p.orbitingBladeActive) {
      p.orbitingBladeTimer = (p.orbitingBladeTimer ?? 0) - dt;
      p.orbitingBladeAngle = (p.orbitingBladeAngle ?? 0) + 4.6 * dt; // Full 360° continuous orbital sweep

      if (p.orbitingBladeTimer <= 0) {
        p.orbitingBladeActive = false;
        p.floatingSwords = [];
        p.orbitingBladeHitCooldowns = {};
        this.state.events.push({ type: 'orbiting_blade_expired', data: {} });
      } else {
        const extra = p.calculatedStats.extraProjectiles || 0;
        const swordCount = Math.min(7, Math.max(1, 1 + extra));
        p.orbitingSwordCount = swordCount;
        const rad = p.orbitingBladeRadius ?? 82;
        const dmg = p.orbitingBladeDamage ?? (34 * p.calculatedStats.damageMultiplier);

        if (!p.floatingSwords) p.floatingSwords = [];
        while (p.floatingSwords.length < swordCount) {
          const s = p.floatingSwords.length;
          const sAngle = (p.orbitingBladeAngle ?? 0) + (Math.PI * 2 / swordCount) * s;
          p.floatingSwords.push({
            x: p.pos.x + Math.cos(sAngle) * rad,
            y: p.pos.y + Math.sin(sAngle) * rad,
            z: p.z + 18,
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
          const homeZ = p.z + 18 + Math.sin(p.orbitingBladeAngle * 0.8 + s * 1.2) * 2.5;

          if (sw.state === 'hover') {
            // Smoothly track current orbital home position
            sw.x = homeX;
            sw.y = homeY;
            sw.z = homeZ;

            sw.attackCooldown = (sw.attackCooldown ?? 0) - dt;
            if (sw.attackCooldown <= 0) {
              // Search for living enemies relative to this specific sword's position (reach ~170 units)
              const nearby = this.spatialGrid.getNearby({ x: sw.x, y: sw.y }, 180);
              let bestEnemy: EnemyState | null = null;
              let bestDist = Infinity;
              let fallbackEnemy: EnemyState | null = null;
              let fallbackDist = Infinity;

              for (let eIdx = 0; eIdx < nearby.length; eIdx++) {
                const e = nearby[eIdx];
                if (e.health > 0) {
                  const ed = Math.hypot(e.pos.x - sw.x, e.pos.y - sw.y);
                  if (ed <= 165) {
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
                sw.targetZ = chosen.z + (chosen.radius || 18) * 0.8;
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
                sw.targetZ = targetEnemy.z + (targetEnemy.radius || 18) * 0.8;
              }
            }

            const tx = sw.targetX ?? homeX;
            const ty = sw.targetY ?? homeY;
            const tz = sw.targetZ ?? homeZ;
            const ldx = tx - sw.x;
            const ldy = ty - sw.y;
            const ldz = tz - sw.z;
            const ldist = Math.hypot(ldx, ldy, ldz) || 1;
            const lungeSpeed = 700;
            const step = Math.min(ldist, lungeSpeed * dt);

            sw.x += (ldx / ldist) * step;
            sw.y += (ldy / ldist) * step;
            sw.z += (ldz / ldist) * step;

            // When impaling target or timeout reached:
            if (ldist <= 22 || sw.stateTimer >= 0.22) {
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
            const returnSpeed = 550;
            const rstep = Math.min(rdist, returnSpeed * dt);

            sw.x += (rdx / rdist) * rstep;
            sw.y += (rdy / rdist) * rstep;
            sw.z += (rdz / rdist) * rstep;

            if (rdist <= 20 || sw.stateTimer >= 0.26) {
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
        utilDef.cooldown * p.calculatedStats.dashCooldownMultiplier;
      p.dashShockwaveTriggered = false;
      p.dashHitIds = new Set<string>();

      if (utilDef.id === 'recovery_field') {
        const radiusMult = (p.calculatedStats.aoeRadiusMultiplier || 1.0) * (p.calculatedStats.ultimateRadiusMultiplier || 1.0);
        const durMult = p.calculatedStats.skillDurationMultiplier || 1.0;
        const healMult = p.calculatedStats.healingMultiplier || 1.0;
        // Deploy localized bio-regenerative nanite field on terrain
        const field: RecoveryFieldState = {
          id: `recov_${Date.now()}_${Math.random().toString(36).substring(2, 6)}`,
          pos: { x: p.pos.x, y: p.pos.y },
          z: p.z,
          radius: 140 * radiusMult,
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

        const healMult = p.calculatedStats.healingMultiplier || 1.0;
        const selfHeal = Math.round(cfg.selfHeal * healMult);
        p.health = Math.min(p.maxHealth, p.health + selfHeal);
        this.state.events.push({
          type: 'therapeutic_heal',
          data: { pos: { ...p.pos }, z: p.z, amount: selfHeal }
        });

        if (p.skillEnhancements?.utility === 'phase_barrier') {
          p.phaseBarrierTimer = cfg.duration + DOCTOR_CONFIG.phaseBarrier.postDashImmunityDuration;
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
        const targetX = p.pos.x + (bdx / blen) * 210;
        const targetY = p.pos.y + (bdy / blen) * 210;
        const trav = this.state.terrain.checkTraversable(p.pos, { x: targetX, y: targetY }, p.z, false);
        p.pos.x = trav.newPos.x;
        p.pos.y = trav.newPos.y;
        p.z = this.state.terrain.getElevation(p.pos.x, p.pos.y).height;
        p.groundZ = p.z;

        // Arrival shockwave
        const shockRadius = 95 * (p.calculatedStats.aoeRadiusMultiplier || 1.0);
        const shockDamage = utilDef.baseDamage * p.calculatedStats.damageMultiplier;
        const victims = this.spatialGrid.getNearby(p.pos, shockRadius);
        for (const v of victims) {
          if (v.health > 0) {
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
        let bdx = worldMx;
        let bdy = worldMy;
        if (bdx === 0 && bdy === 0) {
          bdx = input.cameraForward ? input.cameraForward.x : sinY;
          bdy = input.cameraForward ? input.cameraForward.y : cosY;
        }
        const blen = Math.hypot(bdx, bdy) || 1;
        const targetX = p.pos.x + (bdx / blen) * 230;
        const targetY = p.pos.y + (bdy / blen) * 230;
        const trav = this.state.terrain.checkTraversable(p.pos, { x: targetX, y: targetY }, p.z, false);
        p.pos.x = trav.newPos.x;
        p.pos.y = trav.newPos.y;
        p.z = this.state.terrain.getElevation(p.pos.x, p.pos.y).height;
        p.groundZ = p.z;

        // Arrival stun & spatial disruption
        const stunRadius = 85;
        const victims = this.spatialGrid.getNearby(p.pos, stunRadius);
        for (const v of victims) {
          if (v.health > 0) {
            this.damageEnemy(v, 48 * p.calculatedStats.damageMultiplier, v.pos);
            v.isStunned = true;
            v.stunTimer = 1.0;
          }
        }
        this.state.events.push({
          type: 'teleport_executed',
          data: { from: fromPos, fromZ, to: { ...p.pos }, toZ: p.z, radius: stunRadius }
        });
      } else {
        const isExtended = p.skillEnhancements?.utility === 'extended_dash';
        p.isDashing = true;
        p.dashDurationTimer = isExtended ? 0.32 : 0.22;

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

    // 2. Jump (Space)
    if (input.wantJump && p.isGrounded) {
      p.vz = 340;
      p.isGrounded = false;
      p.isJumping = true;
      p.isGliding = false;
      this.state.events.push({ type: 'jump_started', data: { pos: { ...p.pos }, z: p.z } });
    }

    // 3. Jetpack Glide (Hold Space while airborne)
    const canGlide = !p.isGrounded && input.holdJump && p.vz < 60 && p.jetpackFuel > 0;
    if (canGlide) {
      if (!p.isGliding) {
        p.isGliding = true;
        this.state.events.push({ type: 'glide_started', data: {} });
      }
      p.vz = Math.max(-55, p.vz); // Slow, floaty descent
      p.jetpackFuel = Math.max(0, p.jetpackFuel - 32 * dt);
    } else {
      if (p.isGliding) {
        p.isGliding = false;
        this.state.events.push({ type: 'glide_ended', data: {} });
      }
    }

    // 4. Vertical Integration & Gravity
    const gravity = p.isGliding ? 220 : 760;
    p.vz -= gravity * dt;
    p.z += p.vz * dt;

    // Ground elevation check from TerrainSystem
    const terrainSample = this.state.terrain.getElevation(p.pos.x, p.pos.y);
    p.groundZ = terrainSample.height;

    // Step-down snapping: if grounded and walking downhill on a slope, keep glued to ground
    if (p.isGrounded && !p.isJumping) {
      const drop = p.z - p.groundZ;
      if (drop >= 0 && drop <= 24) {
        p.z = p.groundZ;
        p.vz = 0;
      }
    }

    if (p.z <= p.groundZ && p.vz <= 0) {
      p.z = p.groundZ;
      p.vz = 0;
      if (!p.isGrounded) {
        p.isGrounded = true;
        p.isJumping = false;
        if (p.isGliding) {
          p.isGliding = false;
          this.state.events.push({ type: 'glide_ended', data: {} });
        }
        this.state.events.push({ type: 'landed', data: { z: p.z } });
      }
      // Rapid recharge of jetpack fuel while on solid ground
      p.jetpackFuel = Math.min(p.maxJetpackFuel, p.jetpackFuel + 75 * dt);
    } else if (p.z > p.groundZ + 20) {
      p.isGrounded = false;
    }

    // 5. Horizontal Movement with Per-Axis Wall-Sliding Collision
    const airMultiplier = p.isGliding ? 1.25 : 1.0;
    const isMedicalRush = p.equippedSkills.utility.id === 'medical_rush';
    const isExtendedDash = p.skillEnhancements?.utility === 'extended_dash';
    let dashSpeedMult = 3.2;
    if (isMedicalRush) {
      // Therapeutic Pass = exact 1.5x Commander base dash distance (Extended Dash doubles -> 3.0x)
      const commanderDistFactor = 3.2 * 0.22;
      dashSpeedMult =
        (commanderDistFactor * DOCTOR_CONFIG.therapeuticPass.commanderDistanceFactor) /
        DOCTOR_CONFIG.therapeuticPass.duration;
      if (isExtendedDash) {
        dashSpeedMult *= 2.0;
      }
    } else if (isExtendedDash) {
      dashSpeedMult = 6.4;
    }
    if (p.skillEnhancements?.utility === 'phase_dash') {
      dashSpeedMult *= 1.35;
    }
    const currentSpeed = p.isDashing ? p.moveSpeed * dashSpeedMult : p.moveSpeed * airMultiplier;

    if (p.isDashing) {
      p.dashDurationTimer -= dt;
      if (p.dashDurationTimer <= 0) {
        p.isDashing = false;
        if (isMedicalRush) {
          if (p.skillEnhancements?.utility === 'phase_barrier') {
            p.phaseBarrierTimer = Math.max(
              p.phaseBarrierTimer ?? 0,
              DOCTOR_CONFIG.phaseBarrier.postDashImmunityDuration
            );
          }
          if (p.skillEnhancements?.utility === 'adrenaline_rush') {
            p.adrenalineRushTimer = DOCTOR_CONFIG.adrenalineRush.duration;
            this.state.updateCalculatedStats();
            this.state.events.push({
              type: 'adrenaline_activated',
              data: { pos: { ...p.pos }, duration: p.adrenalineRushTimer }
            });
          }
        }
        // Phase Surge arrival shockwave
        if (p.skillEnhancements?.utility === 'phase_dash') {
          const arrivalRadius = 95;
          const arrivalDmg = 36 * p.calculatedStats.damageMultiplier;
          const nearby = this.spatialGrid.getNearby(p.pos, arrivalRadius);
          for (let k = 0; k < nearby.length; k++) {
            const v = nearby[k];
            if (v.health > 0) {
              this.damageEnemy(v, arrivalDmg, v.pos, 'lightning');
            }
          }
          this.state.events.push({
            type: 'dash_shockwave',
            data: { pos: { ...p.pos }, z: p.z, radius: arrivalRadius, dir: { ...p.dashDir } }
          });
        }
      }

      // Dash Upgrade 1: Shock Dash — Creates a shockwave at the first enemy hit with AOE & knockback!
      if (p.skillEnhancements?.utility === 'shock_dash') {
        if (!p.dashHitIds) p.dashHitIds = new Set<string>();
        const nearby = this.spatialGrid.getNearby(p.pos, 44);
        for (let sv = 0; sv < nearby.length; sv++) {
          const target = nearby[sv];
          if (target.health > 0 && !p.dashHitIds.has(target.id)) {
            p.dashHitIds.add(target.id);
            if (!p.dashShockwaveTriggered) {
              p.dashShockwaveTriggered = true;
              const shockRadius = 115;
              const shockDmg = 68 * p.calculatedStats.damageMultiplier;
              const aoeVictims = this.spatialGrid.getNearby(p.pos, shockRadius);
              for (const av of aoeVictims) {
                if (av.health > 0) {
                  this.damageEnemy(av, shockDmg, av.pos);
                  // Strong kinetic knockback impulse
                  const kdx = av.pos.x - p.pos.x;
                  const kdy = av.pos.y - p.pos.y;
                  const kdist = Math.hypot(kdx, kdy) || 1;
                  av.pos.x += (kdx / kdist) * 48;
                  av.pos.y += (kdy / kdist) * 48;
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
        if (this.moveWithTerrainSlide(p.pos, p.z, nextX, nextY, !p.isGrounded, 18)) {
          if (p.isGrounded && !p.isJumping) {
            const h = this.state.terrain.getElevation(p.pos.x, p.pos.y).height;
            if (h <= p.z + 14) p.z = h;
          }
        }
      }

      // --- Dash Combat Interactions ---
      const utilDef = p.equippedSkills.utility;
      if (utilDef.id === 'tactical_dash' && !p.dashShockwaveTriggered) {
        // Commander Impact Dash: Colliding with an enemy triggers a one-time shockwave
        const candidates = this.spatialGrid.getNearby(p.pos, 48);
        let primaryHit: EnemyState | null = null;
        for (let i = 0; i < candidates.length; i++) {
          const enemy = candidates[i];
          if (enemy.health <= 0) continue;
          if (Math.abs(enemy.z - p.z) > 55) continue;
          const dist = Math.hypot(enemy.pos.x - p.pos.x, enemy.pos.y - p.pos.y);
          if (dist <= 24 + enemy.radius) {
            primaryHit = enemy;
            break;
          }
        }

        if (primaryHit) {
          p.dashShockwaveTriggered = true;
          const impactPos = { x: primaryHit.pos.x, y: primaryHit.pos.y };
          const directDmg = utilDef.baseDamage * p.calculatedStats.damageMultiplier;
          const shockRadius = 115 * (p.calculatedStats.aoeRadiusMultiplier || 1.0) * (p.calculatedStats.ultimateRadiusMultiplier || 1.0);

          // Primary enemy takes direct impact damage + directional kinetic knockback
          this.damageEnemy(primaryHit, directDmg, impactPos);
          primaryHit.velocity.x += p.dashDir.x * 320;
          primaryHit.velocity.y += p.dashDir.y * 320;

          // Nearby enemies take shockwave area damage once per dash impact
          const nearby = this.spatialGrid.getNearby(impactPos, shockRadius);
          for (let j = 0; j < nearby.length; j++) {
            const v = nearby[j];
            if (v.health <= 0 || v.id === primaryHit.id) continue;
            if (Math.abs(v.z - primaryHit.z) > 65) continue;
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

          if (p.skillEnhancements?.utility === 'cryo_dash') {
            const cryoVictims = this.spatialGrid.getNearby(impactPos, 110);
            for (let cv = 0; cv < cryoVictims.length; cv++) {
              const cEnemy = cryoVictims[cv];
              if (cEnemy.health > 0) {
                cEnemy.isChilled = true;
                cEnemy.chillTimer = 2.5;
              }
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
            this.damageEnemy(enemy, rushDmg, enemy.pos, 'medical');
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

        this.moveWithTerrainSlide(p.pos, p.z, nextX, nextY, !p.isGrounded, 18);

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

    this.resolveObstacleCollisions(p.pos, 22);
    if (p.isGrounded && !p.isJumping) {
      this.state.terrain.pushOutOfSteepTerrain(p.pos, p.z, 18);
    }

    // Reliable ground surface tracking: Keep feet firmly anchored to terrain without clipping or falling through
    let finalElev = this.state.terrain.getElevation(p.pos.x, p.pos.y).height;
    const stepUpLimit = this.state.terrain.getStepUpLimitAt(p.pos.x, p.pos.y, finalElev);
    if (p.isGrounded && !p.isJumping) {
      const drop = p.z - finalElev;
      if (drop > 24) {
        // Ground dropped suddenly beneath player (walked off sheer cliff edge or ledge) -> enter free fall
        p.isGrounded = false;
      } else if (finalElev > p.z + stepUpLimit) {
        // Shoved into a steep cliff face: push downhill onto valid footing and re-sample elevation
        if (this.state.terrain.pushOutOfSteepTerrain(p.pos, p.z, 18)) {
          finalElev = this.state.terrain.getElevation(p.pos.x, p.pos.y).height;
        }
        p.z = Math.max(p.z, Math.min(finalElev, p.z + stepUpLimit));
        p.vz = 0;
      } else {
        // Walkable ground or slope: stay firmly glued to terrain surface
        p.z = finalElev;
        p.vz = 0;
      }
    } else {
      // Airborne / falling / jumping: only land when moving downwards (vz <= 0) and hitting ground
      if (p.z <= finalElev && p.vz <= 0) {
        p.z = finalElev;
        p.vz = 0;
        if (!p.isGrounded) {
          p.isGrounded = true;
          p.isJumping = false;
          if (p.isGliding) {
            p.isGliding = false;
            this.state.events.push({ type: 'glide_ended', data: {} });
          }
          this.state.events.push({ type: 'landed', data: { z: p.z } });
        }
      }
    }
    p.groundZ = finalElev;
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

    return false;
  }

  private resolveObstacleCollisions(pos: Vector2, radius: number, isTitan: boolean = false): void {
    for (let i = 0; i < this.state.obstacles.length; i++) {
      const obs = this.state.obstacles[i];
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
    const stats = p.calculatedStats;

    // --- Primary Weapon Slot ---
    const primaryDef = p.equippedSkills.primary;
    const primaryCd = primaryDef.cooldown / stats.attackSpeedMultiplier;
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
            this.fireHyperBeam(p.beamTargetPos);
            p.primaryCooldownRemaining = primaryCd;
          }
          p.beamTargetPos = null;
        }
      } else if (p.primaryCooldownRemaining <= 0) {
        let target: Vector2 | null = null;
        if (input.wantPrimaryManual) {
          target = { ...input.mouseWorldPos };
        } else if (p.autoCastPrimary) {
          const origin3D = { x: p.pos.x, y: p.pos.y, z: p.z + 26 };
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
        let targetZ: number = p.z + 26;

        if (input.wantPrimaryManual) {
          target = { ...input.mouseWorldPos };
          targetZ = input.mouseWorldPos3D?.z ?? (this.state.terrain.calculateHeight(target.x, target.y) + 16);
        } else if (p.autoCastPrimary) {
          const origin3D = { x: p.pos.x, y: p.pos.y, z: p.z + 26 };
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
          if (primaryEnh === 'toxic_chain') {
            this.fireToxicChain(target, targetZ);
          } else if (primaryEnh === 'cryogenic_scalpel') {
            this.fireCryoScalpel(target, targetZ);
          } else if (primaryEnh === 'chill_beam') {
            this.fireChillBeam(target, targetZ);
          } else if (primaryEnh === 'piercing_laser') {
            this.firePiercingLaser(target, targetZ);
          } else if (primaryEnh === 'extended_slash') {
            this.fireExtendedSlash(target, targetZ);
          } else if (primaryDef.id === 'medical_pulse') {
            this.fireMedicalPulse(target, targetZ);
          } else if (primaryDef.id === 'scatter_blaster') {
            this.fireScatterBlaster(target, targetZ);
          } else if (primaryDef.id === 'arc_cannon') {
            this.fireArcCannon(target);
          } else if (primaryDef.id === 'gatling_minigun') {
            this.fireGatlingMinigun(target, targetZ);
          } else {
            this.firePrimaryPulse(target, targetZ);
          }
          p.primaryCooldownRemaining = primaryCd;
        }
      }
    }

    // --- Secondary Weapon Slot ---
    const secDef = p.equippedSkills.secondary;
    const secondaryCd = secDef.cooldown / stats.attackSpeedMultiplier;
    if (p.secondaryCooldownRemaining <= 0) {
      let target: Vector2 | null = null;
      let targetZ: number = p.z + 26;

      if (input.wantSecondaryManual) {
        if (input.mouseWorldPos && Number.isFinite(input.mouseWorldPos.x) && Number.isFinite(input.mouseWorldPos.y)) {
          target = { ...input.mouseWorldPos };
          targetZ = input.mouseWorldPos3D?.z ?? (this.state.terrain.calculateHeight(target.x, target.y) + 16);
        } else {
          target = { ...p.pos };
          targetZ = p.z + 16;
        }
      } else if (p.autoCastSecondary) {
        const origin3D = { x: p.pos.x, y: p.pos.y, z: p.z + 26 };
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
        ultDef.cooldown * stats.ultimateCooldownMultiplier;
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

      if (dist <= field.radius && Math.abs(p.z - field.z) < 65) {
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
    const handOffset = 11;
    const origin = {
      x: p.pos.x + Math.cos(perpAngle) * handOffset,
      y: p.pos.y + Math.sin(perpAngle) * handOffset,
      z: p.z + 26
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
    const count = 1 + (p.calculatedStats.extraProjectiles || 0);
    const baseSpread = cfg.spreadAngleRad;
    const maxSpread = baseSpread * 3.0;
    const spread = count > 1 ? Math.min(maxSpread, baseSpread + (count - 2) * 0.06) : 0;
    const radius = cfg.projectileRadius * (p.calculatedStats.projectileRadiusMultiplier || 1.0);
    const pierceCount = isChain ? 1 : 1 + (p.calculatedStats.projectilePierce || 0);
    const baseDamage = cfg.baseDamage * p.calculatedStats.damageMultiplier;

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
        bouncesRemaining: isChain ? DOCTOR_CONFIG.toxicChain.maxBounces : undefined
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
    const origin = { x: p.pos.x, y: p.pos.y, z: p.z + 24 };
    const dx = targetPos.x - origin.x;
    const dy = targetPos.y - origin.y;
    const dz = targetZ - origin.z;
    const dist3D = Math.hypot(dx, dy, dz) || 1;
    const baseAngle = Math.atan2(dy, dx);
    const pitch = Math.asin(Math.max(-0.55, Math.min(0.55, dz / dist3D)));

    const count = Math.min(cfg.maxScalpels, 1 + Math.max(0, p.calculatedStats.extraProjectiles || 0));
    const maxSpread = 0.65;
    const spread = count > 1 ? Math.min(maxSpread, cfg.spreadAngleRad + (count - 2) * 0.09) : 0;
    const speed = cfg.outboundSpeed * (p.calculatedStats.projectileSpeedMultiplier || 1.0);
    const damage = cfg.baseDamage * p.calculatedStats.damageMultiplier;
    const radius = cfg.projectileRadius * (p.calculatedStats.projectileRadiusMultiplier || 1.0);
    const maxDistance = cfg.range * (p.calculatedStats.aoeRadiusMultiplier ? Math.min(1.35, Math.max(1.0, p.calculatedStats.aoeRadiusMultiplier)) : 1.0);

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
        targetZ
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

    const range = cfg.range * Math.min(1.35, Math.max(1.0, p.calculatedStats.aoeRadiusMultiplier || 1.0));
    const maxTethers = cfg.baseTetherCount + Math.max(0, p.calculatedStats.extraProjectiles || 0);
    const nearby = this.spatialGrid.getNearby(p.pos, range * 1.1);
    const eligible: Array<{ enemy: EnemyState; score: number }> = [];

    for (let i = 0; i < nearby.length; i++) {
      const cand = nearby[i];
      if (cand.health <= 0) continue;
      const d = Math.hypot(cand.pos.x - p.pos.x, cand.pos.y - p.pos.y);
      if (d > range + cand.radius) continue;
      if (Math.abs(cand.z - p.z) > 130) continue;
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

    const tickCd = cfg.tickInterval / Math.max(0.5, p.calculatedStats.attackSpeedMultiplier || 1.0);
    const dmgPerTick = cfg.damagePerTick * p.calculatedStats.damageMultiplier;
    const healMult = p.calculatedStats.healingMultiplier || 1.0;

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
          this.damageEnemy(target, dmgPerTick, target.pos, 'medical');
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
        if (Math.abs(enemy.z - trail.z) > 65) continue;
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
    const origin = { x: p.pos.x, y: p.pos.y, z: p.z + 28 };
    const dx = targetPos.x - origin.x;
    const dy = targetPos.y - origin.y;
    const horizDist = Math.min(Math.hypot(dx, dy) || 1, p.equippedSkills.secondary.range);
    const angle = Math.atan2(dy, dx);

    const speed = 520 * (p.calculatedStats.projectileSpeedMultiplier || 1.0);
    const flightTime = Math.max(0.18, horizDist / speed);
    const dz = targetZ - origin.z;
    const vz = dz / flightTime;

    const extra = p.calculatedStats.extraProjectiles || 0;
    // Cross Slash Layering:
    // +0: Original Cross Slash (extraLayers = 0)
    // +2: Add another layer of crossing blades ABOVE original (+14 Y) -> extraLayers = 1
    // +4: Add another layer of crossing blades BELOW original (-14 Y) -> extraLayers = 2
    // +5 onward: Additional stacks increase attack's piercing capability
    const extraLayers = extra >= 4 ? 2 : (extra >= 2 ? 1 : 0);
    const pierceCount = extra >= 5 ? 1 + (extra - 4) : 1;
    const radius = 18 * (p.calculatedStats.projectileRadiusMultiplier || 1.0);

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
    let radiusMult = (p.calculatedStats.aoeRadiusMultiplier || 1.0) * (p.calculatedStats.ultimateRadiusMultiplier || 1.0);
    if (enh === 'vortex_slashes') {
      radiusMult *= 1.45;
    }
    const blastRadius = 125 * radiusMult;
    const impactZ = proj.z ?? this.state.terrain.calculateHeight(proj.pos.x, proj.pos.y);
    const slashAngle = Math.atan2(proj.velocity.y, proj.velocity.x);
    const slashDmg = proj.damage * (enh === 'seismic_slashes' ? 1.30 : 1.0);

    const victims = this.spatialGrid.getNearby(proj.pos, blastRadius);
    for (let i = 0; i < victims.length; i++) {
      const v = victims[i];
      if (v.health <= 0) continue;
      // Respect terrain elevation difference so slashes don't ignore huge vertical cliffs
      if (Math.abs(v.z - impactZ) > 75) continue;
      const dist = Math.hypot(v.pos.x - proj.pos.x, v.pos.y - proj.pos.y);
      if (dist <= blastRadius + v.radius) {
        this.damageEnemy(v, slashDmg, proj.pos, enh === 'seismic_slashes' ? 'ignite' : enh === 'cryo_slashes' ? 'frost' : 'ignite');
        // Pull enemies INWARD toward the twin-slash convergence center!
        const pullDx = proj.pos.x - v.pos.x;
        const pullDy = proj.pos.y - v.pos.y;
        const pullLen = Math.hypot(pullDx, pullDy) || 1;
        const pullImpulseMult = enh === 'vortex_slashes' ? 1.4 : 1.0;
        const pullImpulse = 260 * Math.min(1.0, (pullLen / blastRadius) + 0.35) * pullImpulseMult;
        if (v.velocity) {
          v.velocity.x += (pullDx / pullLen) * pullImpulse;
          v.velocity.y += (pullDy / pullLen) * pullImpulse;
        }
        const stepIn = Math.min(pullLen * 0.45 * pullImpulseMult, 48);
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
    const count = 1 + (p.calculatedStats.extraProjectiles || 0);
    const spread = count > 1 ? Math.min(0.75, cfg.spreadAngleRad + (count - 2) * 0.08) : 0;
    const speed = cfg.throwSpeed * (p.calculatedStats.projectileSpeedMultiplier || 1.0);
    const damage = cfg.baseDamage * p.calculatedStats.damageMultiplier;
    const radius = 12 * (p.calculatedStats.projectileRadiusMultiplier || 1.0);
    const origin = { x: p.pos.x, y: p.pos.y, z: p.z + 28 };

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
      cfg.baseDrones + Math.max(0, p.calculatedStats.extraProjectiles || 0)
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

  private triggerExperimentalDroneVolley(): void {
    this.reconcileDoctorDrones();
    const p = this.state.player;
    const cfg = DOCTOR_CONFIG.experimentalDrones;
    for (let i = 0; i < this.state.doctorDrones.length; i++) {
      const drone = this.state.doctorDrones[i];
      const target = this.spatialGrid.findNearest(drone.pos, cfg.targetRange);
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
      damage: cfg.boltDamage * dmgScale * p.calculatedStats.damageMultiplier,
      pierceCount: 1,
      maxDistance: cfg.targetRange * 1.2,
      distanceTraveled: 0,
      owner: 'player',
      radius: 8 * (p.calculatedStats.projectileRadiusMultiplier || 1.0),
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

      drone.fireCooldown -= dt;
      if (drone.fireCooldown <= 0) {
        const target = this.spatialGrid.findNearest(drone.pos, cfg.targetRange);
        if (target && target.health > 0) {
          this.fireDroneBioBolt(drone, target, 1.0);
          drone.fireCooldown = fireInterval;
        } else {
          drone.fireCooldown = 0.15;
          drone.chargeRatio = 0;
        }
      } else if (drone.fireCooldown <= chargeWindow) {
        const aimTarget = this.spatialGrid.findNearest(drone.pos, cfg.targetRange);
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
    const count = Math.min(cfg.maxMainBombs, cfg.baseMainBombs + Math.max(0, p.calculatedStats.extraProjectiles || 0));
    const dx = targetPos.x - p.pos.x;
    const dy = targetPos.y - p.pos.y;
    const baseDist = Math.max(60, Math.min(Math.hypot(dx, dy), DOCTOR_CONFIG.rmb.range));
    const baseAngle = Math.atan2(dy, dx);
    const spread = count > 1 ? Math.min(0.95, 0.34 + (count - 2) * 0.14) : 0;
    const damage = cfg.mainDamage * p.calculatedStats.damageMultiplier;
    const speed = 400 * (p.calculatedStats.projectileSpeedMultiplier || 1.0);
    const origin = { x: p.pos.x, y: p.pos.y, z: p.z + 30 };

    this.setFacingToward(targetPos);

    for (let i = 0; i < count; i++) {
      const offset = count > 1 ? -spread / 2 + (spread / (count - 1)) * i : 0;
      const ang = baseAngle + offset;
      const distJitter = count > 1 ? ((i % 2 === 0 ? 1 : -1) * 28) : 0;
      const d = Math.max(55, baseDist + distJitter);
      const dest = {
        x: p.pos.x + Math.cos(ang) * d,
        y: p.pos.y + Math.sin(ang) * d
      };
      this.launchArcingToxicProjectile('cluster_main', origin, dest, speed, damage, 16);
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
    const blastRadius = 96 * radiusMult;
    const groundZ = this.state.terrain.calculateHeight(proj.pos.x, proj.pos.y);

    const victims = this.spatialGrid.getNearby(proj.pos, blastRadius + 25);
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
    const subOrigin = { x: proj.pos.x, y: proj.pos.y, z: groundZ + 18 };
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
      this.launchArcingToxicProjectile('cluster_sub', subOrigin, dest, 270, subDamage, 10);
    }
  }

  private detonateClusterSub(proj: ProjectileState): void {
    const p = this.state.player;
    const cfg = DOCTOR_CONFIG.toxicClusterBomb;
    const radiusMult = p.calculatedStats.aoeRadiusMultiplier || 1.0;
    const durMult = p.calculatedStats.skillDurationMultiplier || 1.0;
    const subRadius = cfg.subPuddleRadius * radiusMult;
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
      cfg.subPuddleDuration * durMult,
      cfg.subPuddleDamagePerTick * p.calculatedStats.damageMultiplier,
      cfg.subPuddleTickInterval
    );
  }

  private fireHolographicDecoy(targetPos: Vector2): void {
    const p = this.state.player;
    const cfg = DOCTOR_CONFIG.holographicDecoy;
    const count = cfg.baseDecoys + Math.max(0, p.calculatedStats.extraProjectiles || 0);
    const durMult = p.calculatedStats.skillDurationMultiplier || 1.0;
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
        explosionDamage: cfg.explosionDamage * p.calculatedStats.damageMultiplier,
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
      DOCTOR_CONFIG.rmb.puddleDamagePerTick * p.calculatedStats.damageMultiplier,
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
          if (Math.abs(enemy.z - field.z) > 65) continue;
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
      const rainDur = DOCTOR_CONFIG.rainOfCrosses.duration;
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
    const pulseDamage = cfg.pulseDamage * p.calculatedStats.damageMultiplier;

    const cross: SanctuaryCrossState = {
      id: `cross_${Date.now()}_${Math.random().toString(36).substring(2, 6)}`,
      pos: { x: centerPos.x, y: centerPos.y },
      z: groundZ,
      armHalfLength,
      armHalfWidth,
      durationRemaining: duration,
      maxDuration: duration,
      healPerSecond: cfg.healPerSecond * healMult,
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
      const angelDur = dCfg.angelDuration * durMult;
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
    const waveCount = cfg.baseCrossesPerWave + Math.max(0, p.calculatedStats.extraProjectiles || 0);
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
          this.state.sanctuaryCrosses.push({
            id: `raincross_${Date.now()}_${Math.random().toString(36).substring(2, 6)}`,
            pos: { x: fc.targetPos.x, y: fc.targetPos.y },
            z: fc.targetZ,
            armHalfLength: fc.fieldHalfLength,
            armHalfWidth: fc.fieldHalfWidth,
            durationRemaining: remainingRainTime,
            maxDuration: remainingRainTime,
            healPerSecond: cfg.groundFieldHealPerSecond * healMult,
            pulseDamage: cfg.groundFieldPulseDamage * p.calculatedStats.damageMultiplier,
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
            radius: 10 * (p.calculatedStats.projectileRadiusMultiplier || 1.0),
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
    const origin = { x: p.pos.x, y: p.pos.y, z: p.z + 26 };
    const dx = targetPos.x - origin.x;
    const dy = targetPos.y - origin.y;
    const dz = targetZ - origin.z;
    const dist3D = Math.hypot(dx, dy, dz) || 1;
    const angle = Math.atan2(dy, dx);
    const pitch = Math.asin(Math.max(-0.95, Math.min(0.95, dz / dist3D)));

    const speed = 780 * (p.calculatedStats.projectileSpeedMultiplier || 1.0);
    const horizSpeed = Math.cos(pitch) * speed;
    const vx = Math.cos(angle) * horizSpeed;
    const vy = Math.sin(angle) * horizSpeed;
    const vz = Math.sin(pitch) * speed;
    const radius = 14 * (p.calculatedStats.projectileRadiusMultiplier || 1.0);

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

    const radius = 260 * radiusMult;
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
    const origin = { x: p.pos.x, y: p.pos.y, z: p.z + 26 };
    const dx = targetPos.x - origin.x;
    const dy = targetPos.y - origin.y;
    const dz = targetZ - origin.z;
    const dist3D = Math.hypot(dx, dy, dz) || 1;
    const range = 520;
    const nx = dx / dist3D;
    const ny = dy / dist3D;
    const nz = dz / dist3D;
    const endPos = {
      x: origin.x + nx * range,
      y: origin.y + ny * range,
      z: origin.z + nz * range
    };

    this.setFacingToward(targetPos);
    const extra = p.calculatedStats.extraProjectiles || 0;
    const boltCount = 1 + extra; // Each +1 Projectile fires 1 additional icy bolt consecutively (e.g. +3 = 4 bolts)
    const baseDamage = (p.equippedSkills.primary.baseDamage * 1.15) * p.calculatedStats.damageMultiplier;

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
        if (distToRay <= enemy.radius + 20) {
          // Multi-bolt impact: each consecutive bolt delivers damage and builds chill
          this.damageEnemy(enemy, baseDamage * (0.85 + 0.15 * boltCount), enemy.pos, 'ice');
          enemy.isChilled = true;
          enemy.chillTimer = 3.5;
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
    const origin = { x: p.pos.x, y: p.pos.y, z: p.z + 26 };
    const range = 560;

    this.setFacingToward(targetPos);
    const damage = (p.equippedSkills.primary.baseDamage * 1.30) * p.calculatedStats.damageMultiplier;
    const hitEnemyIds = new Set<string>();

    // 1. Find primary targeted enemy near targetPos or along the aiming line
    let primaryEnemy: EnemyState | null = null;
    let minTargetDist = 52;
    const nearTarget = this.spatialGrid.getNearby(targetPos, 60);
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
    const dz = targetZ - origin.z;
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
          if (Math.hypot(perpX, perpY) <= enemy.radius + 22 && proj < closestProj) {
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
      this.damageEnemy(primaryEnemy, damage, primaryEnemy.pos, 'lightning');
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
        if (Math.hypot(perpX, perpY) <= enemy.radius + 22) {
          this.damageEnemy(enemy, damage, enemy.pos, 'lightning');
          enemy.isElectrified = true;
          enemy.electrifiedTimer = 5.0;
          enemy.electrifiedMultiplier = 1.35;
          hitEnemyIds.add(enemy.id);
        }
      }
    }

    // 4. Branching Lightning: Inherent 2 secondary lightning branches + 1 for each extra projectile bonus (up to 6)
    const extra = p.calculatedStats.extraProjectiles || 0;
    const branchTargetCount = Math.min(6, 2 + extra);
    const branches: Array<{ from: Vector2; fromZ: number; to: Vector2; toZ: number }> = [];

    const branchOrigin = { x: endPos.x, y: endPos.y };
    const branchOriginZ = endPos.z;
    const secondaryCandidates = this.spatialGrid.getNearby(branchOrigin, 280);
    const eligibleEnemies: Array<{ enemy: EnemyState; dist: number }> = [];

    for (let sc = 0; sc < secondaryCandidates.length; sc++) {
      const e = secondaryCandidates[sc];
      if (e.health > 0 && !hitEnemyIds.has(e.id)) {
        const ed = Math.hypot(e.pos.x - branchOrigin.x, e.pos.y - branchOrigin.y);
        if (ed <= 260) {
          eligibleEnemies.push({ enemy: e, dist: ed });
        }
      }
    }

    eligibleEnemies.sort((a, b) => a.dist - b.dist);

    for (let b = 0; b < eligibleEnemies.length && branches.length < branchTargetCount; b++) {
      const entry = eligibleEnemies[b];
      const e = entry.enemy;
      const enemyTargetZ = e.z + (e.radius || 18) * 0.8;

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
      const dist = 75 + branches.length * 35;
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
  private fireExtendedSlash(targetPos: Vector2, targetZ: number = this.state.player.z + 26): void {
    const p = this.state.player;
    p.slashComboStep = ((p.slashComboStep ?? 0) % 3) + 1;
    const step = p.slashComboStep;
    const dx = targetPos.x - p.pos.x;
    const dy = targetPos.y - p.pos.y;
    const baseAngle = Math.atan2(dy, dx);
    this.setFacingToward(targetPos);

    const extra = p.calculatedStats.extraProjectiles || 0;
    const slashCount = 1 + extra; // Each +1 Projectile adds 1 consecutive forward slash
    const range = step === 3 ? 380 : 320;
    const arcAngle = step === 3 ? 1.55 : 1.25;
    const dmgMult = step === 3 ? 1.6 : 1.15;
    const damage = (p.equippedSkills.primary.baseDamage * dmgMult) * p.calculatedStats.damageMultiplier;

    const candidates = this.spatialGrid.getNearby(p.pos, range);
    for (let c = 0; c < candidates.length; c++) {
      const enemy = candidates[c];
      if (enemy.health <= 0) continue;
      const edx = enemy.pos.x - p.pos.x;
      const edy = enemy.pos.y - p.pos.y;
      const edist = Math.hypot(edx, edy);
      if (edist <= range) {
        const enemyAngle = Math.atan2(edy, edx);
        let diff = Math.abs(enemyAngle - baseAngle);
        while (diff > Math.PI) diff = Math.abs(diff - Math.PI * 2);
        if (diff <= arcAngle * 0.5) {
          this.damageEnemy(enemy, damage * (1 + (slashCount - 1) * 0.2), enemy.pos);
          if (step === 3 || slashCount >= 3) {
            enemy.pos.x += Math.cos(baseAngle) * 35;
            enemy.pos.y += Math.sin(baseAngle) * 35;
          }
        }
      }
    }

    this.state.events.push({
      type: 'extended_slash_fired',
      data: { pos: { ...p.pos }, z: p.z + 18, angle: baseAngle, step, range, slashCount }
    });
  }

  // --- COMMANDER RMB UPGRADE 1: SCISSOR SLASH ---
  private fireScissorSlash(targetPos: Vector2, targetZ: number = this.state.player.z + 26): void {
    const p = this.state.player;
    const dx = targetPos.x - p.pos.x;
    const dy = targetPos.y - p.pos.y;
    const angle = Math.atan2(dy, dx);
    this.setFacingToward(targetPos);

    const extra = p.calculatedStats.extraProjectiles || 0;
    const totalSlashes = 1 + extra; // Each +1 Projectile adds another scissor-slash motion before final central explosion

    const focusDist = 95;
    const focusPos = {
      x: p.pos.x + Math.cos(angle) * focusDist,
      y: p.pos.y + Math.sin(angle) * focusDist
    };
    const radius = 125;
    const damage = (145 * (1 + (totalSlashes - 1) * 0.25)) * p.calculatedStats.damageMultiplier;

    const victims = this.spatialGrid.getNearby(focusPos, radius);
    for (let v = 0; v < victims.length; v++) {
      const enemy = victims[v];
      if (enemy.health > 0) {
        this.damageEnemy(enemy, damage, enemy.pos);
        const kx = enemy.pos.x - focusPos.x;
        const ky = enemy.pos.y - focusPos.y;
        const klen = Math.hypot(kx, ky) || 1;
        enemy.pos.x += (kx / klen) * 40;
        enemy.pos.y += (ky / klen) * 40;
      }
    }

    this.state.events.push({
      type: 'scissor_slash_fired',
      data: { pos: { ...p.pos }, z: p.z + 18, focusPos, angle, radius, totalSlashes }
    });
  }

  // --- COMMANDER RMB UPGRADE 2: FROST BURST (360-DEGREE RADIAL ICE EXPLOSION) ---
  private fireFrostBurst(): void {
    const p = this.state.player;
    const extra = p.calculatedStats.extraProjectiles || 0;
    const damage = 125 * p.calculatedStats.damageMultiplier;
    const burstRadius = 210;

    // 1. Instantaneous radial ice explosion centered on Commander
    const victims = this.spatialGrid.getNearby(p.pos, burstRadius);
    for (let v = 0; v < victims.length; v++) {
      const enemy = victims[v];
      if (enemy.health <= 0) continue;
      const dx = enemy.pos.x - p.pos.x;
      const dy = enemy.pos.y - p.pos.y;
      const dist = Math.hypot(dx, dy);
      if (dist <= burstRadius && Math.abs(enemy.z - p.z) <= 55) {
        this.damageEnemy(enemy, damage, enemy.pos, 'ice');
        enemy.isChilled = true;
        enemy.chillTimer = 3.5;
        const kdist = dist || 1;
        enemy.velocity.x += (dx / kdist) * 260;
        enemy.velocity.y += (dy / kdist) * 260;
      }
    }

    // 2. Extra Projectile Eruptions: Generate additional ice-spike eruptions distributed around cast position
    const spikePositions: Array<{ pos: Vector2; delay: number }> = [];
    if (extra > 0) {
      for (let i = 0; i < extra; i++) {
        const sAngle = (i / extra) * Math.PI * 2 + 0.35;
        const sDist = 80 + ((i * 37) % 55);
        const sPos = {
          x: p.pos.x + Math.cos(sAngle) * sDist,
          y: p.pos.y + Math.sin(sAngle) * sDist
        };
        spikePositions.push({ pos: sPos, delay: 0.05 * (i + 1) });

        const subVictims = this.spatialGrid.getNearby(sPos, 65);
        for (let sv = 0; sv < subVictims.length; sv++) {
          const se = subVictims[sv];
          if (se.health > 0) {
            this.damageEnemy(se, damage * 0.45, se.pos, 'ice');
            se.isChilled = true;
            se.chillTimer = 3.5;
          }
        }
      }
    }

    this.state.events.push({
      type: 'frost_burst_fired',
      data: { pos: { ...p.pos }, z: p.z + 16, radius: burstRadius, extraEruptions: extra, spikePositions }
    });
  }

  // --- COMMANDER RMB UPGRADE 3: ORBITING ELECTRIC SWORDS (FULL 360° ORBIT, MAX 7) ---
  private fireOrbitingBlade(): void {
    const p = this.state.player;
    const extra = p.calculatedStats.extraProjectiles || 0;
    const swordCount = Math.min(7, 1 + extra); // Strict formula: activeSwordCount = Math.min(7, 1 + bonusProjectiles)

    p.orbitingBladeActive = true;
    p.orbitingBladeTimer = 12.0;
    p.orbitingBladeAngle = p.orbitingBladeAngle ?? 0;
    p.orbitingBladeRadius = 82;
    p.orbitingBladeDamage = 34 * p.calculatedStats.damageMultiplier;
    p.orbitingSwordCount = swordCount;
    p.orbitingBladeHitCooldowns = {};

    p.floatingSwords = [];
    for (let s = 0; s < swordCount; s++) {
      const sAngle = (p.orbitingBladeAngle ?? 0) + (Math.PI * 2 / swordCount) * s;
      const swX = p.pos.x + Math.cos(sAngle) * 82;
      const swY = p.pos.y + Math.sin(sAngle) * 82;
      const swZ = p.z + 18;
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
      data: { duration: 12.0, radius: 82, swordCount }
    });
  }

  private firePrimaryPulse(targetPos: Vector2, targetZ: number = this.state.player.z + 26): void {
    const p = this.state.player;
    const enh = p.skillEnhancements?.primary;
    const origin = { x: p.pos.x, y: p.pos.y, z: p.z + 26 };
    const dx = targetPos.x - origin.x;
    const dy = targetPos.y - origin.y;
    const dz = targetZ - origin.z;
    const dist3D = Math.hypot(dx, dy, dz) || 1;
    const baseAngle = Math.atan2(dy, dx);
    const pitch = Math.asin(Math.max(-0.95, Math.min(0.95, dz / dist3D)));

    let speed = 680 * (p.calculatedStats.projectileSpeedMultiplier || 1.0);
    let count = 1 + (p.calculatedStats.extraProjectiles || 0);
    let baseSpread = 0.22;
    const radius = 13 * (p.calculatedStats.projectileRadiusMultiplier || 1.0);
    let pierceCount = 1 + (p.calculatedStats.projectilePierce || 0);
    let damage = p.equippedSkills.primary.baseDamage * p.calculatedStats.damageMultiplier;

    // Additive Primary Enhancements (Service Pistol remains the base Gold Blaster Bolt)
    if (enh === 'scatter_burst') {
      count = 3 + (p.calculatedStats.extraProjectiles || 0);
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

    const primaryCd = p.equippedSkills.primary.cooldown / Math.max(0.1, p.calculatedStats.attackSpeedMultiplier || 1.0);
    const attackAnimDuration = Math.max(0.08, Math.min(0.28, primaryCd * 0.85));
    const attackFps = 4 / attackAnimDuration;
    // Frame 2 (0-indexed: 0=Ready, 1=Aim, 2=Fire/Muzzle Flash, 3=Recovery) starts at 50% of the 4-frame sequence
    const fireFrameDelay = p.heroId === 'commander' ? attackAnimDuration * 0.5 : 0;

    for (let i = 0; i < count; i++) {
      const offset = count > 1 ? -spread / 2 + (spread / (count - 1)) * i : 0;
      const angle = baseAngle + offset;
      const horizSpeed = Math.cos(pitch) * speed;
      const vx = Math.cos(angle) * horizSpeed;
      const vy = Math.sin(angle) * horizSpeed;
      const vz = Math.sin(pitch) * speed;
      const muzzleDist = 14;

      const proj: ProjectileState = {
        id: `proj_${this.nextProjId++}`,
        type: 'pulse',
        pos: { x: origin.x + Math.cos(angle) * muzzleDist, y: origin.y + Math.sin(angle) * muzzleDist },
        z: origin.z,
        velocity: { x: vx, y: vy },
        vz,
        speed,
        damage,
        element: enh === 'arc_conduit' ? 'lightning' : undefined,
        pierceCount,
        maxDistance: p.equippedSkills.primary.range * 1.2,
        distanceTraveled: 0,
        owner: 'player',
        radius,
        hitEnemyIds: new Set(),
        originZ: origin.z,
        targetZ,
        spawnDelayRemaining: fireFrameDelay > 0 ? fireFrameDelay : undefined,
        muzzleOffset: { x: Math.cos(angle) * muzzleDist, y: Math.sin(angle) * muzzleDist }
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
    const origin = { x: p.pos.x, y: p.pos.y, z: p.z + 26 };
    const dx = targetPos.x - origin.x;
    const dy = targetPos.y - origin.y;
    const dz = targetZ - origin.z;
    const dist3D = Math.hypot(dx, dy, dz) || 1;
    const baseAngle = Math.atan2(dy, dx);
    const pitch = Math.asin(Math.max(-0.95, Math.min(0.95, dz / dist3D)));

    const speed = 720 * (p.calculatedStats.projectileSpeedMultiplier || 1.0);
    const pellets = 5 + (p.calculatedStats.extraProjectiles || 0);
    const baseSpread = 0.42;
    const maxSpread = baseSpread * 2.5; // 1.05 rad (2.5x max limit)
    const spreadAngle = pellets > 5 ? Math.min(maxSpread, baseSpread + (pellets - 5) * 0.126) : baseSpread;
    const radius = 12 * (p.calculatedStats.projectileRadiusMultiplier || 1.0);
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
    const arcCount = 1 + (p.calculatedStats.extraProjectiles || 0);
    const hitIds = new Set<string>();

    const origin3D = { x: p.pos.x, y: p.pos.y, z: p.z + 26 };
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
          .getNearby(currentOrigin, 260)
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
    const beamWidth = 24 * (p.calculatedStats.projectileRadiusMultiplier || 1.0);
    const beamDamage = p.equippedSkills.primary.baseDamage * p.calculatedStats.damageMultiplier;
    const beamCount = 1 + (p.calculatedStats.extraProjectiles || 0);
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
    const origin = { x: p.pos.x, y: p.pos.y, z: p.z + 26 };
    const dx = targetPos.x - origin.x;
    const dy = targetPos.y - origin.y;
    const dz = targetZ - origin.z;
    const dist3D = Math.hypot(dx, dy, dz) || 1;
    const baseAngle = Math.atan2(dy, dx);
    const pitch = Math.asin(Math.max(-0.95, Math.min(0.95, dz / dist3D)));

    const speed = 1040 * (p.calculatedStats.projectileSpeedMultiplier || 1.0);
    const count = 2 + (p.calculatedStats.extraProjectiles || 0);
    const baseWidth = 9;
    const maxWidth = baseWidth * 2.5; // 22.5 units (2.5x max limit)
    const currentWidth = count > 2 ? Math.min(maxWidth, baseWidth + (count - 2) * 2.7) : baseWidth;
    const lateralSpacing = count > 1 ? currentWidth / (count - 1) : 0;
    const perpX = -Math.sin(baseAngle);
    const perpY = Math.cos(baseAngle);
    const radius = 10 * (p.calculatedStats.projectileRadiusMultiplier || 1.0);
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
    const origin = { x: p.pos.x, y: p.pos.y, z: p.z + 26 };
    const dx = targetPos.x - origin.x;
    const dy = targetPos.y - origin.y;
    const dz = targetZ - origin.z;
    const dist3D = Math.hypot(dx, dy, dz) || 1;
    const baseAngle = Math.atan2(dy, dx);
    const pitch = Math.asin(Math.max(-0.95, Math.min(0.95, dz / dist3D)));

    const speed = 540 * (p.calculatedStats.projectileSpeedMultiplier || 1.0);
    const waveCount = 1 + (p.calculatedStats.extraProjectiles || 0);
    const baseSpread = 0.28;
    const maxSpread = 0.70;
    const spread = waveCount > 1 ? Math.min(maxSpread, baseSpread + (waveCount - 2) * 0.10) : 0;
    const radius = 26 * (p.calculatedStats.projectileRadiusMultiplier || 1.0);
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
    const origin = { x: p.pos.x, y: p.pos.y, z: p.z + 26 };
    const dx = targetPos.x - origin.x;
    const dy = targetPos.y - origin.y;
    const dz = targetZ - origin.z;
    const dist2D = Math.hypot(dx, dy) || 1;
    const baseSpeed = 440 * (p.calculatedStats.projectileSpeedMultiplier || 1.0);
    const travelDist = Math.min(dist2D, p.equippedSkills.secondary.range);
    const timeToTarget = travelDist / baseSpeed;
    const gravity = 360;
    const grenadeCount = 1 + (p.calculatedStats.extraProjectiles || 0);
    const baseAngle = Math.atan2(dy, dx);
    const baseSpread = 0.20;
    const spread = grenadeCount > 1 ? Math.min(0.50, baseSpread + (grenadeCount - 2) * 0.08) : 0;
    const radius = 18 * (p.calculatedStats.projectileRadiusMultiplier || 1.0);

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
    const origin = { x: p.pos.x, y: p.pos.y, z: p.z + 26 };
    const dx = targetPos.x - origin.x;
    const dy = targetPos.y - origin.y;
    const dz = targetZ - origin.z;
    const dist3D = Math.hypot(dx, dy, dz) || 1;
    const speed = 280;

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
      radius: 28,
      hitEnemyIds: new Set(),
      originZ: origin.z,
      targetZ
    };
    this.state.projectiles.push(proj);
    this.state.events.push({ type: 'wave_fired', data: { from: { ...p.pos }, to: targetPos, z: p.z } });
  }

  private fireCarpetNuke(targetPos: Vector2): void {
    const p = this.state.player;
    const radius = Math.round(190 * p.calculatedStats.ultimateRadiusMultiplier);
    const offsets = [
      { x: 0, y: 0 },
      { x: -115, y: -115 },
      { x: 115, y: -115 },
      { x: -115, y: 115 },
      { x: 115, y: 115 }
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
    const expandedRadius = Math.round(360 * p.calculatedStats.ultimateRadiusMultiplier);

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
    // 25% reduction in size: 320 -> 240
    const expandedRadius = Math.round(240 * p.calculatedStats.ultimateRadiusMultiplier);

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
    const expandedRadius = Math.round(330 * p.calculatedStats.ultimateRadiusMultiplier);

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
    // Massive ground shockwave radius (260 base, scaling with Orbital Capacitor buff)
    const expandedRadius = Math.round(260 * p.calculatedStats.ultimateRadiusMultiplier);
    const enhancement = p.skillEnhancements?.ultimate;

    // 6-frame Ultimate cast sequence at 10 FPS (0.60s total):
    // Frame 4 (0.40s): Downward Command -> Orbital Strike Impact & Damage!
    const strikeDelay = 0.40;
    const lockedPos: Vector2 = { x: targetPos.x, y: targetPos.y };

    let durationRemaining = 0.65;
    let dotTimer: number | undefined = undefined;
    let subStrikes: Vector2[] | undefined = undefined;

    if (enhancement === 'singularity') {
      // Phase 2 lasts 2.80s after impact (total 3.20s from R press <= 4.0s) before collapse detonation
      durationRemaining = 2.80;
      dotTimer = 0.25;
    } else if (enhancement === 'convergence_barrage') {
      // 4 balanced outer orbital strikes in a symmetric ring around the central strike
      const ringDist = Math.round(175 * p.calculatedStats.ultimateRadiusMultiplier);
      const angles = [Math.PI * 0.25, Math.PI * 0.75, Math.PI * 1.25, Math.PI * 1.75];
      subStrikes = angles.map((ang) => ({
        x: lockedPos.x + Math.cos(ang) * ringDist,
        y: lockedPos.y + Math.sin(ang) * ringDist
      }));
      // Phase 2 inward spiral convergence lasts 0.95s after the 5 simultaneous impacts (total 1.35s from R press <= 4.0s)
      durationRemaining = 0.95;
    } else if (enhancement === 'cryogenic_impact') {
      // Phase 2 & 3 freezing field persists for 3.10s after impact (total 3.50s from R press <= 4.0s) with 0.44s frost DoT ticks
      durationRemaining = 3.10;
      dotTimer = 0.44;
    }

    const strike: OrbitalStrikeState = {
      id: `strike_${this.nextStrikeId++}`,
      targetPos: lockedPos,
      delayRemaining: strikeDelay,
      radius: expandedRadius,
      damage: p.equippedSkills.ultimate.baseDamage * p.calculatedStats.damageMultiplier,
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
        proj.z = p.z + 26;
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
        const pullRadius = 195;
        const victims = this.spatialGrid.getNearby(proj.pos, pullRadius);
        for (let v = 0; v < victims.length; v++) {
          const enemy = victims[v];
          if (enemy.health <= 0) continue;
          const vdx = proj.pos.x - enemy.pos.x;
          const vdy = proj.pos.y - enemy.pos.y;
          const vdist = Math.hypot(vdx, vdy) || 1;
          const pullSpeed = Math.min(290, 420 * (1 - vdist / pullRadius) + 95);
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
          const blastRadius = 150;
          for (let v = 0; v < victims.length; v++) {
            const enemy = victims[v];
            if (enemy.health > 0) {
              this.damageEnemy(enemy, proj.damage * 1.35, proj.pos);
              const kdx = enemy.pos.x - proj.pos.x;
              const kdy = enemy.pos.y - proj.pos.y;
              const klen = Math.hypot(kdx, kdy) || 1;
              enemy.velocity.x += (kdx / klen) * 440;
              enemy.velocity.y += (kdy / klen) * 440;
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
            this.state.frostTrails.push({
              id: `ftrail_${Date.now()}_${Math.random().toString(36).substring(2, 6)}`,
              pos: { x: proj.pos.x, y: proj.pos.y },
              z: tz,
              radius: trailRadius,
              durationRemaining: sCfg.trailDuration,
              maxDuration: sCfg.trailDuration
            });
            while (this.state.frostTrails.length > sCfg.maxActiveTrailSegments) {
              this.state.frostTrails.shift();
            }
          }
        }
        if (proj.returnPhase) {
          const rdx = p.pos.x - proj.pos.x;
          const rdy = p.pos.y - proj.pos.y;
          const rdz = (p.z + 24) - proj.z;
          const rDist3D = Math.hypot(rdx, rdy, rdz) || 1;
          const retSpeed = sCfg.returnSpeed * (p.calculatedStats.projectileSpeedMultiplier || 1.0);
          proj.speed = retSpeed;
          proj.velocity.x = (rdx / rDist3D) * retSpeed;
          proj.velocity.y = (rdy / rDist3D) * retSpeed;
          proj.vz = (rdz / rDist3D) * retSpeed;
          if (Math.hypot(rdx, rdy) <= 28 || proj.distanceTraveled > 1800) {
            continue; // Returned safely to Doctor
          }
        }
      }

      // Swept 3D Terrain & Obstacle Collision Check: prevents tunneling through ridges or walls
      const sweptSteps = Math.max(1, Math.min(5, Math.ceil(stepDist / 12)));
      let hitTerrain = false;
      let impactX = proj.pos.x;
      let impactY = proj.pos.y;
      let impactZ = proj.z;

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
          const blastRadius = 110 * (p.calculatedStats.aoeRadiusMultiplier || 1.0);
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
          const blastRadius = 72;
          const distToPlayer = Math.hypot(p.pos.x - proj.pos.x, p.pos.y - proj.pos.y);
          if (distToPlayer <= blastRadius && !p.isDashing) {
            this.damagePlayer(proj.damage);
          }
          this.state.events.push({
            type: 'orbital_impact',
            data: { target: { ...proj.pos }, radius: blastRadius, variant: 'acid' }
          });
        } else if (proj.type === 'elemental_ball') {
          const blastRadius = 65;
          const distToPlayer = Math.hypot(p.pos.x - proj.pos.x, p.pos.y - proj.pos.y);
          if (distToPlayer <= blastRadius && !p.isDashing) {
            this.damagePlayer(proj.damage);
          }
          this.state.events.push({
            type: 'orbital_impact',
            data: { target: { ...proj.pos }, radius: blastRadius, variant: 'void' }
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
          const blastRadius = 110 * (p.calculatedStats.aoeRadiusMultiplier || 1.0);
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
          const blastRadius = 72;
          const distToPlayer = Math.hypot(p.pos.x - proj.pos.x, p.pos.y - proj.pos.y);
          if (distToPlayer <= blastRadius && !p.isDashing) {
            this.damagePlayer(proj.damage);
          }
          this.state.events.push({
            type: 'orbital_impact',
            data: { target: { ...proj.pos }, radius: blastRadius, variant: 'acid' }
          });
          continue;
        } else if (proj.type === 'elemental_ball') {
          const blastRadius = 65;
          const distToPlayer = Math.hypot(p.pos.x - proj.pos.x, p.pos.y - proj.pos.y);
          if (distToPlayer <= blastRadius && !p.isDashing) {
            this.damagePlayer(proj.damage);
          }
          this.state.events.push({
            type: 'orbital_impact',
            data: { target: { ...proj.pos }, radius: blastRadius, variant: 'void' }
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
        const pullRadius = 160 * (p.calculatedStats.aoeRadiusMultiplier || 1.0);
        const victims = this.spatialGrid.getNearby(proj.pos, pullRadius);
        for (const v of victims) {
          if (v.health <= 0) continue;
          const vdx = proj.pos.x - v.pos.x;
          const vdy = proj.pos.y - v.pos.y;
          const vdist = Math.hypot(vdx, vdy);
          if (vdist > 5) {
            v.pos.x += (vdx / vdist) * 160 * dt;
            v.pos.y += (vdy / vdist) * 160 * dt;
          }
        }
      }

      // Twin Converging Slashes (bomb): herd enemies inward toward the centerline as the blades sweep forward
      if (proj.type === 'bomb') {
        const sweepRadius = 95 * (p.calculatedStats.aoeRadiusMultiplier || 1.0);
        const victims = this.spatialGrid.getNearby(proj.pos, sweepRadius);
        for (const v of victims) {
          if (v.health <= 0) continue;
          const vdx = proj.pos.x - v.pos.x;
          const vdy = proj.pos.y - v.pos.y;
          const vdist = Math.hypot(vdx, vdy);
          if (vdist > 6) {
            v.pos.x += (vdx / vdist) * 185 * dt;
            v.pos.y += (vdy / vdist) * 185 * dt;
          }
        }
      }

      if (proj.owner === 'player') {
        const nearby = this.spatialGrid.getNearby(proj.pos, proj.radius + 32);

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
            this.damageEnemy(
              enemy,
              proj.damage,
              proj.pos,
              proj.element || (proj.type === 'scatter' ? 'ignite' : proj.type === 'arc' ? 'lightning' : proj.type === 'medical_pulse' || proj.type === 'angel_bolt' ? 'medical' : proj.type === 'toxic_chain' || proj.type === 'drone_bio_bolt' ? 'acid' : undefined)
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

            // Arc Conduit enhancement: every blaster bolt hit arcs chain lightning to up to 2 nearby enemies
            if (proj.type === 'pulse' && p.skillEnhancements?.primary === 'arc_conduit') {
              const nearbyVictims = this.spatialGrid.getNearby(enemy.pos, 220).filter(e => e.id !== enemy.id && e.health > 0);
              for (let a = 0; a < Math.min(2, nearbyVictims.length); a++) {
                const aTarget = nearbyVictims[a];
                const arcDmg = proj.damage * 0.45;
                this.damageEnemy(aTarget, arcDmg, aTarget.pos, 'lightning');
                this.state.events.push({
                  type: 'chain_spark',
                  data: {
                    from: { ...enemy.pos },
                    to: { ...aTarget.pos },
                    damage: arcDmg
                  }
                });
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
          const dDist3D = Math.hypot(proj.pos.x - decoy.pos.x, proj.pos.y - decoy.pos.y, proj.z - (decoy.z + 24));
          if (dDist3D <= proj.radius + 22) {
            decoy.hitsRemaining = Math.max(0, decoy.hitsRemaining - 1);
            hitDecoy = true;
            break;
          }
        }
        if (hitDecoy) {
          continue;
        }

        // True 3D distance check against player torso
        const dx = proj.pos.x - p.pos.x;
        const dy = proj.pos.y - p.pos.y;
        const playerCenterZ = p.z + 26;
        const dz = proj.z - playerCenterZ;
        const dist3D = Math.hypot(dx, dy, dz);

        if (dist3D <= proj.radius + 24) {
          if (!p.isDashing) {
            this.damagePlayer(proj.damage);
          }
          continue;
        }
      }

      alive.push(proj);
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
      const blastRadius = cfg.explosionRadius * (p.calculatedStats.aoeRadiusMultiplier || 1.0);
      const blastDmg = cfg.explosionDamage * p.calculatedStats.damageMultiplier;
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
    const nearby = this.spatialGrid.getNearby(sourceEnemy.pos, 260);
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
          const pullVictims = this.spatialGrid.getNearby(s.targetPos, pullRadius);
          for (let v = 0; v < pullVictims.length; v++) {
            const enemy = pullVictims[v];
            if (enemy.health <= 0) continue;
            if (Math.abs(enemy.z - strikeZ) > 65) continue; // Respect elevation boundaries

            const dx = s.targetPos.x - enemy.pos.x;
            const dy = s.targetPos.y - enemy.pos.y;
            const dist = Math.hypot(dx, dy) || 1;
            const isElite = enemy.isElite || enemy.type === 'elite' || enemy.type === 'boss';

            const pullSpeed = isElite
              ? Math.min(150, 220 * (1 - dist / pullRadius) + 55)
              : Math.min(310, 420 * (1 - dist / pullRadius) + 110);

            if (!isElite) {
              enemy.isStunned = true;
              enemy.stunTimer = Math.max(enemy.stunTimer ?? 0, 0.35);
              enemy.attackCooldownRemaining = Math.max(enemy.attackCooldownRemaining, 0.45);
            }
            enemy.velocity.x *= 0.5;
            enemy.velocity.y *= 0.5;

            if (dist > 18) {
              const step = Math.min(dist - 14, pullSpeed * dt);
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
              if (enemy.health > 0 && Math.abs(enemy.z - strikeZ) <= 65) {
                this.damageEnemy(enemy, s.damage * 0.12, s.targetPos, 'void');
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
            if (Math.abs(enemy.z - strikeZ) > 65) continue;

            const dx = s.targetPos.x - enemy.pos.x;
            const dy = s.targetPos.y - enemy.pos.y;
            const dist = Math.hypot(dx, dy) || 1;
            if (dist > 22) {
              const pullSpeed = enemy.isBoss ? 140 : 280;
              const step = Math.min(dist - 18, pullSpeed * dt);
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
          const cryoVictims = this.spatialGrid.getNearby(s.targetPos, cryoRadius);
          for (let v = 0; v < cryoVictims.length; v++) {
            const enemy = cryoVictims[v];
            if (enemy.health <= 0) continue;
            if (Math.abs(enemy.z - strikeZ) > 65) continue;

            // Freeze / Stun enemies inside the cryogenic field
            enemy.isStunned = true;
            enemy.stunTimer = Math.max(enemy.stunTimer ?? 0, 0.65);
            enemy.isChilled = true;
            enemy.chillTimer = Math.max(enemy.chillTimer ?? 0, 1.5);
            enemy.velocity.x = 0;
            enemy.velocity.y = 0;
            enemy.attackCooldownRemaining = Math.max(enemy.attackCooldownRemaining, 0.65);
          }

          s.dotTimer = (s.dotTimer ?? 0.44) - dt;
          if (s.dotTimer <= 0) {
            s.dotTimer = 0.44;
            for (let v = 0; v < cryoVictims.length; v++) {
              const enemy = cryoVictims[v];
              if (enemy.health > 0 && Math.abs(enemy.z - strikeZ) <= 65) {
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
              if (enemy.health > 0 && Math.abs(enemy.z - strikeZ) <= 65) {
                // Release from singularity lock and apply collapse detonation damage + outward impulse
                enemy.isStunned = false;
                enemy.stunTimer = 0;
                this.damageEnemy(enemy, s.damage * 1.50, s.targetPos, 'void');
                const kdx = enemy.pos.x - s.targetPos.x;
                const kdy = enemy.pos.y - s.targetPos.y;
                const klen = Math.hypot(kdx, kdy) || 1;
                enemy.velocity.x += (kdx / klen) * 520;
                enemy.velocity.y += (kdy / klen) * 520;
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
              if (enemy.health > 0 && Math.abs(enemy.z - strikeZ) <= 65) {
                this.damageEnemy(enemy, s.damage * 1.45, s.targetPos, 'ignite');
                const kdx = enemy.pos.x - s.targetPos.x;
                const kdy = enemy.pos.y - s.targetPos.y;
                const klen = Math.hypot(kdx, kdy) || 1;
                enemy.velocity.x += (kdx / klen) * 500;
                enemy.velocity.y += (kdy / klen) * 500;
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

  public applyChill(enemy: EnemyState, duration: number = 3.5): void {
    enemy.isChilled = true;
    enemy.chillTimer = Math.max(enemy.chillTimer || 0, duration);
  }

  public damageEnemy(enemy: EnemyState, amount: number, hitPos: Vector2, element?: string): void {
    if (enemy.health <= 0) return;
    const p = this.state.player;

    const isCrit = this.state.rng.next() < p.calculatedStats.critChance;
    const isCorruption = this.isCorruptionActive();
    const corruptionVuln = isCorruption ? 1.60 : 1.0;
    const electrifiedVuln = enemy.isElectrified ? (enemy.electrifiedMultiplier ?? 1.35) : 1.0;
    const finalAmount = Math.round(
      (isCrit ? amount * (1 + p.calculatedStats.critMultiplier) : amount) * corruptionVuln * electrifiedVuln
    );

    enemy.health -= finalAmount;
    enemy.isAlerted = true; // Alert enemy on taking damage
    const nearbyPack = this.spatialGrid.getNearby(enemy.pos, 750);
    for (let k = 0; k < nearbyPack.length; k++) {
      nearbyPack[k].isAlerted = true;
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
      if (enemy.isStage1Titan) {
        if (enemy.titanState !== 'dying') {
          enemy.health = 0;
          enemy.titanState = 'dying';
          enemy.titanTimer = 3.2;
          enemy.radius = 0; // Disable collision immediately
          this.state.events.push({
            type: 'stage1_boss_death',
            data: { id: enemy.id, pos: { ...enemy.pos } }
          });
          this.state.events.push({
            type: 'boss_defeated',
            data: { name: 'COLOSSAL BIO-CULTIVATOR' }
          });
          if (this.state.artifact) {
            this.state.artifact.isBossDefeated = true;
          }
        }
      } else {
        this.killEnemy(enemy);
      }
    }
  }

  private killEnemy(enemy: EnemyState): void {
    const p = this.state.player;
    p.killCount++;

    // Lifesteal on kill
    if (p.calculatedStats.lifestealOnKill > 0) {
      p.health = Math.min(p.maxHealth, p.health + p.calculatedStats.lifestealOnKill);
    }

    // Death explosion
    if (p.calculatedStats.deathExplosionRadius > 0) {
      const blastRadius = p.calculatedStats.deathExplosionRadius;
      const victims = this.spatialGrid.getNearby(enemy.pos, blastRadius);
      for (let v = 0; v < victims.length; v++) {
        const victim = victims[v];
        if (victim.id !== enemy.id && victim.health > 0) {
          victim.health -= p.calculatedStats.deathExplosionDamage;
          this.state.events.push({
            type: 'damage_dealt',
            data: { enemyId: victim.id, damage: p.calculatedStats.deathExplosionDamage, pos: { ...victim.pos } }
          });
        }
      }
      this.state.events.push({
        type: 'orbital_impact',
        data: { target: { ...enemy.pos }, radius: blastRadius }
      });
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

    // 2. Check Loot Table for Passive Item Drop
    let dropChance = 0; // Normal mobs NEVER drop items directly
    let buffDropChance = 0; // Normal mobs NEVER drop buff capsules directly (0%) - must open Bio-Sacs!
    if (enemy.isBoss) {
      dropChance = LOOT_CONFIG.bossEnemyItemDropChance;
      buffDropChance = 1.0;
    } else if (enemy.isElite) {
      dropChance = LOOT_CONFIG.eliteEnemyItemDropChance * 0.5;
      buffDropChance = 0.05; // Rare 5% chance on elites
    }

    if (dropChance > 0 && this.state.rng.next() < dropChance) {
      const itemId = rollWeightedPassiveItem(this.state.rng);
      this.spawnPhysicalItemDrop(enemy.pos, itemId);
    }

    // Physical Buff / Augment Capsule Drop
    if (this.state.rng.next() < buffDropChance) {
      this.spawnBuffCapsuleDrop(enemy.pos);
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
      this.spawnBuffCapsuleDrop(enemy.pos);
      this.state.events.push({
        type: 'level_up',
        data: { level: p.level }
      });
    }

    // 4. Advance Overseer Artifact charge (2x slower base rate)
    if (enemy.isBoss) {
      if (this.state.artifact) {
        this.state.artifact.isBossDefeated = true;
      }
      this.state.events.push({
        type: 'boss_defeated',
        data: { name: enemy.isStage1Titan ? 'STAGE 1 TITAN: BIO-CULTIVATOR' : 'Brood Queen' }
      });
    }

    if (!this.state.artifact.isCharged) {
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
        this.state.events.push({ type: 'artifact_charged', data: {} });
      }
    }

    this.state.events.push({
      type: 'enemy_killed',
      data: {
        enemyId: enemy.id,
        type: enemy.type,
        pos: { ...enemy.pos },
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
    const angle = this.state.rng.range(0, Math.PI * 2);
    const speed = this.state.rng.range(55, 95);
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

  public spawnBuffCapsuleDrop(origin: Vector2): void {
    const angle = this.state.rng.range(0, Math.PI * 2);
    const speed = this.state.rng.range(45, 85);
    const originElevation = this.state.terrain.getElevation(origin.x, origin.y).height;

    this.state.itemDrops.push({
      id: `buffdrop_${this.nextItemDropId++}`,
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
      data: { isBuffDrop: true, pos: { ...origin } }
    });
  }

  private damagePlayer(amount: number, bypassInvuln: boolean = false): void {
    const p = this.state.player;
    if (p.isDashing || (p.phaseBarrierTimer ?? 0) > 0 || p.health <= 0) return;
    if (!bypassInvuln && (p.hurtInvulnTimer ?? 0) > 0) return;

    let actualDamage = amount;
    if (p.defenseBonusTimer > 0) {
      actualDamage = Math.round(amount * (1 - p.defenseBonusReduction));
    }

    // Flat armor reduction
    if (p.calculatedStats.flatArmor > 0) {
      actualDamage = Math.max(1, actualDamage - p.calculatedStats.flatArmor);
    }

    // Energy Shield absorbs damage first
    if (p.energyShield > 0) {
      if (p.energyShield >= actualDamage) {
        p.energyShield -= actualDamage;
        actualDamage = 0;
      } else {
        actualDamage -= p.energyShield;
        p.energyShield = 0;
      }
    }

    if (actualDamage > 0) {
      p.health = Math.max(0, p.health - actualDamage);
    }
    p.defenseBonusTimer = p.defenseBonusDuration;
    if (!bypassInvuln) {
      p.hurtInvulnTimer = 0.25;
    }

    this.state.events.push({
      type: 'player_hit',
      data: { damage: amount, remainingHealth: p.health, resolveActive: true }
    });

    if (p.health <= 0) {
      if (p.calculatedStats.hasSecondWind) {
        p.calculatedStats.hasSecondWind = false;
        p.health = Math.round(p.maxHealth * 0.6);
        this.state.events.push({
          type: 'orbital_impact',
          data: { target: { ...p.pos }, radius: 120 }
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
    } else if (!e.navWaypoint || distToWp < 28 || targetShifted || (e.navTimer <= 0 && this.navCalcsThisTick < 36)) {
      const prevWp = e.navWaypoint;
      const wasPathfinding = e.navStatus === 'pathfinding';
      const midLegRefresh = !!prevWp && distToWp >= 28 && !targetShifted && (e.stuckTimer ?? 0) < 0.25;

      const navRes = this.state.terrain.getNavWaypointInfo(e.pos, tPos, false);
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

    // Controlled crowd separation steering across all nearby enemies (prevents pooling/jamming)
    let avoidVx = 0;
    let avoidVy = 0;
    const crowdRadius = e.radius * 2.2;
    for (let c = 0; c < this.state.enemies.length; c++) {
      const other = this.state.enemies[c];
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

      const isCorruption = this.isCorruptionActive();
      const corruptionFrenzy = isCorruption ? 1.35 : 1.0;
      const slowFactor = e.isChilled ? 0.5 : (e.toxicSlowTimer ?? 0) > 0 ? 0.70 : 1.0;
      const enemySpeed = e.speed * slowFactor * corruptionFrenzy;

      // Height check: enemy adapts to terrain elevation
      e.groundZ = this.state.terrain.getElevation(e.pos.x, e.pos.y).height;
      e.z = e.groundZ;

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
          this.damagePlayer(dmg);
          if (p.calculatedStats.thornsDamage > 0) {
            this.damageEnemy(e, p.calculatedStats.thornsDamage, e.pos);
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
        this.updateStage1Titan(e, dt);
        moveVx = e.velocity.x;
        moveVy = e.velocity.y;
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

        // Brood Queen Ranged Attacks: alternate between Triple Royal Stinger Fan and Volatile Spore Bomb
        if (dist <= 520 && e.attackCooldownRemaining <= 0) {
          e.attackCooldownRemaining = e.attackCooldown;
          const originZ = e.z + 40;
          const targetZ = targetPosZ + 26;
          const dz = targetZ - originZ;

          if (dist >= 110 && this.state.rng.next() < 0.35) {
            // Brood Queen Attack 2: Volatile Spore Bomb (Lobbed on true 3D ballistic arc)
            const bombSpeed = Math.max(160, dist * 0.85);
            const timeToTarget = Math.max(0.6, dist / bombSpeed);
            const gravity = 360;
            const bombVz = (dz / timeToTarget) + 0.5 * gravity * timeToTarget;

            this.state.projectiles.push({
              id: `proj_${this.nextProjId++}`,
              type: 'spore_bomb',
              pos: { x: e.pos.x, y: e.pos.y },
              z: originZ,
              velocity: { x: (dx / dist) * bombSpeed, y: (dy / dist) * bombSpeed },
              vz: bombVz,
              speed: bombSpeed,
              damage: 20,
              pierceCount: 1,
              maxDistance: Math.max(120, dist),
              distanceTraveled: 0,
              owner: 'enemy',
              radius: 16,
              hitEnemyIds: new Set(),
              originZ,
              targetZ
            });
          } else {
            // Brood Queen Attack 1: Triple Royal Stinger Fan in true 3D
            const stingerSpeed = 340;
            const baseAng = Math.atan2(dy, dx);
            const dist3D = Math.hypot(dx, dy, dz) || 1;
            const pitch = Math.asin(Math.max(-0.95, Math.min(0.95, dz / dist3D)));
            const horizSpeed = Math.cos(pitch) * stingerSpeed;
            const vz = Math.sin(pitch) * stingerSpeed;

            const fanAngles = [-0.28, 0, 0.28];
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
                damage: 12,
                pierceCount: 1,
                maxDistance: 540,
                distanceTraveled: 0,
                owner: 'enemy',
                radius: 12,
                hitEnemyIds: new Set(),
                originZ,
                targetZ
              });
            }
          }
        }

        // Swoop contact damage
        if (dist <= e.radius + 24 && Math.abs(targetPosZ - e.z) < 55) {
          if ((e.contactCooldownRemaining ?? 0) <= 0) {
            e.contactCooldownRemaining = e.attackCooldown;
            applyTargetDamage(e.touchDamage);
          }
        }
      } else if (e.isElite || e.type === 'elite') {
        // --- 2. VOID GOLIATH (ELITE CHITIN TANK) ---
        const move = this.getGroundedMoveVelocity(e, enemySpeed, dt, targetDecoy ? targetDecoy.pos : undefined);
        moveVx = move.vx;
        moveVy = move.vy;

        // Seismic Shard Ground Slam (Launched forward in 3D toward target)
        if (dist >= 140 && dist <= 380 && e.attackCooldownRemaining <= 0) {
          e.attackCooldownRemaining = e.attackCooldown * 1.5;
          const shardSpeed = 260;
          const baseAng = Math.atan2(dy, dx);
          const originZ = e.z + 20;
          const targetZ = targetPosZ + 26;
          const dz = targetZ - originZ;
          const dist3D = Math.hypot(dx, dy, dz) || 1;
          const pitch = Math.asin(Math.max(-0.95, Math.min(0.95, dz / dist3D)));
          const horizSpeed = Math.cos(pitch) * shardSpeed;
          const vz = Math.sin(pitch) * shardSpeed;

          const shardAngles = [-0.22, 0, 0.22];
          for (let s = 0; s < shardAngles.length; s++) {
            const ang = baseAng + shardAngles[s];
            this.state.projectiles.push({
              id: `proj_${this.nextProjId++}`,
              type: 'seismic_shard',
              pos: { x: e.pos.x, y: e.pos.y },
              z: originZ,
              velocity: { x: Math.cos(ang) * horizSpeed, y: Math.sin(ang) * horizSpeed },
              vz,
              speed: shardSpeed,
              damage: 17,
              pierceCount: 1,
              maxDistance: 400,
              distanceTraveled: 0,
              owner: 'enemy',
              radius: 14,
              hitEnemyIds: new Set(),
              originZ,
              targetZ
            });
          }
        }

        // Heavy contact crush
        if (dist <= e.radius + 20 && Math.abs(targetPosZ - e.z) < 32) {
          if (e.attackCooldownRemaining <= 0) {
            e.attackCooldownRemaining = e.attackCooldown;
            applyTargetDamage(e.touchDamage);
          }
        }
      } else if (e.type === 'wasp') {
        // --- 3. VOID WASP (AERIAL BIO-ELECTRIC STINGER) ---
        if (dist > 180) {
          moveVx = (dx / dist) * enemySpeed;
          moveVy = (dy / dist) * enemySpeed;
        } else if (dist < 110) {
          moveVx = -(dx / dist) * (enemySpeed * 0.6);
          moveVy = -(dy / dist) * (enemySpeed * 0.6);
        } else {
          moveVx = (dx / dist) * enemySpeed;
          moveVy = (dy / dist) * enemySpeed;
        }

        // Bio-Electric Needle Stinger shot in true 3D
        if (dist >= 90 && dist <= 280 && e.attackCooldownRemaining <= 0) {
          e.attackCooldownRemaining = e.attackCooldown * 1.6;
          const stingerSpeed = 360;
          const originZ = e.z + 18;
          const targetZ = targetPosZ + 26;
          const dz = targetZ - originZ;
          const dist3D = Math.hypot(dx, dy, dz) || 1;
          const vx = (dx / dist3D) * stingerSpeed;
          const vy = (dy / dist3D) * stingerSpeed;
          const vz = (dz / dist3D) * stingerSpeed;

          this.state.projectiles.push({
            id: `proj_${this.nextProjId++}`,
            type: 'wasp_sting',
            pos: { x: e.pos.x, y: e.pos.y },
            z: originZ,
            velocity: { x: vx, y: vy },
            vz,
            speed: stingerSpeed,
            damage: 11,
            pierceCount: 1,
            maxDistance: 320,
            distanceTraveled: 0,
            owner: 'enemy',
            radius: 8,
            hitEnemyIds: new Set(),
            originZ,
            targetZ
          });
        }

        // Contact dive
        if (dist <= e.radius + 18 && Math.abs(targetPosZ - e.z) < 40) {
          if (e.attackCooldownRemaining <= 0) {
            e.attackCooldownRemaining = e.attackCooldown;
            applyTargetDamage(e.touchDamage);
          }
        }
      } else if (e.type === 'spitter') {
        // --- 4. TOXIC SPITTER (CORROSIVE ACID GLOBULE) ---
        if (dist > 320) {
          const move = this.getGroundedMoveVelocity(e, enemySpeed, dt, targetDecoy ? targetDecoy.pos : undefined);
          moveVx = move.vx;
          moveVy = move.vy;
        } else if (dist < 220) {
          moveVx = -(dx / dist) * (enemySpeed * 0.7);
          moveVy = -(dy / dist) * (enemySpeed * 0.7);
        }

        if (dist <= e.attackRange && e.attackCooldownRemaining <= 0) {
          e.attackCooldownRemaining = e.attackCooldown;
          const acidSpeed = 300;
          const originZ = e.z + 18;
          const targetZ = targetPosZ + 26;
          const dz = targetZ - originZ;
          const dist3D = Math.hypot(dx, dy, dz) || 1;
          const vx = (dx / dist3D) * acidSpeed;
          const vy = (dy / dist3D) * acidSpeed;
          const vz = (dz / dist3D) * acidSpeed;

          this.state.projectiles.push({
            id: `proj_${this.nextProjId++}`,
            type: 'acid',
            pos: { x: e.pos.x, y: e.pos.y },
            z: originZ,
            velocity: { x: vx, y: vy },
            vz,
            speed: acidSpeed,
            damage: 16, // Balanced (-25% difficulty)
            pierceCount: 1,
            maxDistance: 440,
            distanceTraveled: 0,
            owner: 'enemy',
            radius: 11,
            hitEnemyIds: new Set(),
            originZ,
            targetZ
          });
        }
      } else {
        // --- 5. VOID CRAWLER (GROUND SWARM MELEE) ---
        const move = this.getGroundedMoveVelocity(e, enemySpeed, dt, targetDecoy ? targetDecoy.pos : undefined);
        moveVx = move.vx;
        moveVy = move.vy;

        if (dist <= e.radius + 20 && Math.abs(targetPosZ - e.z) < 32) {
          if (e.attackCooldownRemaining <= 0) {
            e.attackCooldownRemaining = e.attackCooldown;
            applyTargetDamage(e.touchDamage);
          }
        }
      }

      // Check terrain traversability: flyers clear low ground/gaps but avoid flying through taller cliffs; ground units slide along slopes
      const isAirborneUnit = Boolean(e.type === 'wasp' || (e.isBoss && !e.isStage1Titan));
      const colRadius = e.isStage1Titan ? 32 : Math.min(e.radius, 24);
      if (moveVx !== 0 || moveVy !== 0) {
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

      this.resolveObstacleCollisions(e.pos, e.radius, e.isStage1Titan);

      if (!isAirborneUnit && (!e.isStage1Titan || e.titanState !== 'emerging')) {
        this.state.terrain.pushOutOfSteepTerrain(e.pos, e.z, colRadius);
      }

      // Keep entity elevations synchronized with terrain (airborne flyers stay above terrain peaks)
      e.groundZ = this.state.terrain.getElevation(e.pos.x, e.pos.y).height;
      if (isAirborneUnit) {
        e.z = Math.max(e.z, e.groundZ + 28);
      } else if (!e.isStage1Titan || e.titanState !== 'emerging') {
        e.z = e.groundZ;
      }

      if (e.isStage1Titan && e.titanState === 'dying' && (e.titanTimer ?? 0) <= 0) {
        continue;
      }

      alive.push(e);
    }

    this.state.enemies = alive;
    this.resolveEnemyCollisions();
  }

  /**
   * Circle-circle collision resolution between enemies and between player and enemies.
   * Prevents enemies from collapsing into the same coordinates and stacking like flat paper sprites.
   * Naturally forms flanking swarm behavior with mass-weighted push resistance for Elites & Bosses.
   */
  private resolveEnemyCollisions(): void {
    const enemies = this.state.enemies;
    const len = enemies.length;
    if (len === 0) return;

    const p = this.state.player;
    const playerRadius = 22;

    // 3 relaxation iterations for firm, non-overlapping circle-circle separation
    for (let iter = 0; iter < 3; iter++) {
      // 1. Enemy vs Enemy Collision
      for (let i = 0; i < len; i++) {
        const e1 = enemies[i];
        if (e1.health <= 0 || e1.isSpawning || (e1.isStage1Titan && (e1.titanState === 'emerging' || e1.titanState === 'dying'))) continue;

        for (let j = i + 1; j < len; j++) {
          const e2 = enemies[j];
          if (e2.health <= 0 || e2.isSpawning || (e2.isStage1Titan && (e2.titanState === 'emerging' || e2.titanState === 'dying'))) continue;

          let dx = e1.pos.x - e2.pos.x;
          let dy = e1.pos.y - e2.pos.y;
          const minDist = e1.radius + e2.radius;
          let distSq = dx * dx + dy * dy;

          if (distSq < minDist * minDist) {
            let dist = Math.sqrt(distSq);
            let nx = 1;
            let ny = 0;
            if (dist > 0.001) {
              nx = dx / dist;
              ny = dy / dist;
            } else {
              // Exact center overlap: pick deterministic divergent angle based on index
              const angle = (i * 2.39996 + j * 1.618);
              nx = Math.cos(angle);
              ny = Math.sin(angle);
              dist = 0.001;
            }

            const overlap = minDist - dist;

            // Mass-weighted repulsion:
            // Titan: mass 50, Boss: mass 15, Elite: mass 5, Swarm Crawler / Spitter / Wasp: mass 1
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

        // 2. Player vs Enemy Collision: keep physical personal space around player
        let pdx = e1.pos.x - p.pos.x;
        let pdy = e1.pos.y - p.pos.y;
        const playerMinDist = e1.radius + playerRadius;
        let pDistSq = pdx * pdx + pdy * pdy;

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

    // Keep entities clamped in world bounds, push out of cliffs if crowd pushed them, and sync terrain height
    for (let i = 0; i < len; i++) {
      const e = enemies[i];
      if (e.health <= 0 || e.isSpawning) continue;
      const isAirborneUnit = Boolean(e.type === 'wasp' || (e.isBoss && !e.isStage1Titan));
      if (!isAirborneUnit && (!e.isStage1Titan || (e.titanState !== 'emerging' && e.titanState !== 'dying'))) {
        const colRadius = e.isStage1Titan ? 32 : Math.min(e.radius, 24);
        this.state.terrain.pushOutOfSteepTerrain(e.pos, e.z, colRadius);
      }
      const clampedEnemy = this.state.terrain.clampToPlayableBounds(e.pos, 30);
      e.pos.x = clampedEnemy.pos.x;
      e.pos.y = clampedEnemy.pos.y;
      e.groundZ = this.state.terrain.calculateHeight(e.pos.x, e.pos.y);
      if (isAirborneUnit) {
        e.z = Math.max(e.z, e.groundZ + 28);
      } else if (!e.isStage1Titan || (e.titanState !== 'emerging' && e.titanState !== 'dying')) {
        e.z = e.groundZ;
      }
    }

    if (p.isGrounded && !p.isJumping) {
      this.state.terrain.pushOutOfSteepTerrain(p.pos, p.z, 18);
      const clampedPlayer = this.state.terrain.clampToPlayableBounds(p.pos, 45);
      p.pos.x = clampedPlayer.pos.x;
      p.pos.y = clampedPlayer.pos.y;
      p.groundZ = this.state.terrain.calculateHeight(p.pos.x, p.pos.y);
      if (p.groundZ <= p.z + this.state.terrain.getStepUpLimitAt(p.pos.x, p.pos.y, p.groundZ)) {
        p.z = p.groundZ;
      }
    }
  }

  private updateEnemySpawning(dt: number): void {
    const p = this.state.player;
    this.enemySpawnTimer -= dt;

    const { tierDef } = getDifficultyTier(this.state.gameTime);

    // Max enemy cap scales with difficulty (from 28 up to 60)
    const maxEnemies = 28 + tierDef.tier * 4;
    if (this.state.enemies.length >= maxEnemies) return;

    // Spawn interval accelerates as difficulty bar passes each tier
    const baseSpawnInterval = Math.max(0.60, (2.6 - this.state.gameTime * 0.010) * tierDef.spawnIntervalMultiplier);

    if (this.enemySpawnTimer <= 0) {
      this.enemySpawnTimer = baseSpawnInterval;

      // Enemy batch count increases with difficulty
      const count = Math.min(5, Math.floor(1 + this.state.gameTime / 45) + tierDef.batchBonus);
      const restrictedCells = this.state.terrain.testEnemySpawnCells;
      for (let k = 0; k < count; k++) {
        let sx = 0;
        let sy = 0;
        let angle = this.state.rng.range(0, Math.PI * 2);

        if (restrictedCells.length > 0) {
          // Stage 1 custom map constraint: spawn normal enemies strictly on valid walkable LIGHT-BROWN terrain
          // (excluding dark-brown southern terrain, water, tower cliffs, and obstacles). Prefer points reasonably near player when possible.
          let foundCell = false;
          let bestCell = -1;
          let bestDistDiff = Infinity;
          const targetRange = this.state.rng.range(480, 820);
          for (let attempt = 0; attempt < 24; attempt++) {
            const cellIdx = restrictedCells[Math.floor(this.state.rng.next() * restrictedCells.length)];
            const cx = (cellIdx % 361) * 10;
            const cy = Math.floor(cellIdx / 361) * 10;
            const dPlayer = Math.hypot(cx - p.pos.x, cy - p.pos.y);
            // Keep outside immediate 340u personal bubble around player
            if (dPlayer < 340) continue;
            const diff = Math.abs(dPlayer - targetRange);
            if (diff < bestDistDiff) {
              bestDistDiff = diff;
              bestCell = cellIdx;
            }
            if (dPlayer >= 420 && dPlayer <= 1050) {
              sx = cx + this.state.rng.range(-4, 4);
              sy = cy + this.state.rng.range(-4, 4);
              foundCell = true;
              break;
            }
          }
          if (!foundCell && bestCell >= 0) {
            sx = (bestCell % 361) * 10;
            sy = Math.floor(bestCell / 361) * 10;
            foundCell = true;
          }
          if (!foundCell || !this.state.terrain.isPointValidEnemySpawn(sx, sy)) continue;
          let blockedByObs = false;
          for (let oi = 0; oi < this.state.obstacles.length; oi++) {
            const obs = this.state.obstacles[oi];
            if (Math.hypot(sx - obs.pos.x, sy - obs.pos.y) < obs.radius + 26) {
              blockedByObs = true;
              break;
            }
          }
          if (blockedByObs) continue;
          angle = Math.atan2(p.pos.y - sy, p.pos.x - sx);
        } else {
          const forwardBias = this.state.rng.next() < 0.68;
          angle = forwardBias
            ? this.state.rng.range(-Math.PI * 0.88, -Math.PI * 0.12)
            : this.state.rng.range(0, Math.PI * 2);

          const radius = this.state.rng.range(460, 740);
          sx = Math.max(60, Math.min(this.state.worldWidth - 60, p.pos.x + Math.cos(angle) * radius));
          sy = Math.max(60, Math.min(this.state.worldHeight - 60, p.pos.y + Math.sin(angle) * radius));
        }

        const spawnElevation = this.state.terrain.getElevation(sx, sy);
        if (!spawnElevation.isWalkable) continue; // Don't spawn inside chasms

        const roll = this.state.rng.next();
        let type: EnemyType = 'crawler';
        if (roll < tierDef.eliteChance) {
          type = 'elite'; // Void Goliath
        } else if (roll < tierDef.eliteChance + 0.32) {
          type = 'spitter'; // Toxic Spitter
        } else if (roll < tierDef.eliteChance + 0.58) {
          type = 'wasp'; // Void Wasp
        }

        const cfg = ENEMY_CONFIGS[type];
        // Scale enemy stats dynamically with the active Risk of Rain difficulty tier!
        const scaledHealth = Math.round(cfg.maxHealth * tierDef.hpMultiplier);
        const scaledDamage = Math.round(cfg.touchDamage * tierDef.damageMultiplier);
        const scaledSpeed = cfg.speed * tierDef.speedMultiplier + this.state.rng.range(-6, 6);

        const enemy: EnemyState = {
          id: `enemy_${this.nextEnemyId++}`,
          type,
          pos: { x: sx, y: sy },
          velocity: { x: 0, y: 0 },
          z: spawnElevation.height - 24, // Starts below ground for emerging crawl-up animation
          groundZ: spawnElevation.height,
          health: scaledHealth,
          maxHealth: scaledHealth,
          speed: scaledSpeed,
          touchDamage: scaledDamage,
          attackCooldown: cfg.attackCooldown * Math.max(0.65, 1 - tierDef.tier * 0.05),
          attackCooldownRemaining: 1.25,
          attackRange: cfg.attackRange,
          isElite: cfg.isElite || type === 'elite',
          isBoss: cfg.isBoss,
          currencyReward: Math.round(cfg.currencyReward * (1 + tierDef.tier * 0.18)),
          xpReward: Math.round(cfg.xpReward * (1 + tierDef.tier * 0.22)),
          radius: cfg.radius,
          isSpawning: true,
          spawnProgress: 0,
          spawnDuration: 1.25,
          isAlerted: true,
          wanderDir: { x: Math.cos(angle), y: Math.sin(angle) },
          wanderTimer: this.state.rng.range(2.0, 4.0)
        };

        this.state.enemies.push(enemy);
        this.state.events.push({
          type: 'enemy_emerging',
          data: { id: enemy.id, pos: enemy.pos, z: spawnElevation.height, type }
        });
      }
    }
  }

  public spawnStage1Titan(teleporterPos: Vector2): void {
    const p = this.state.player;
    // Spawn directly in front of the crashed colony shipwreck landmark (1800, 2960) in open crater terrain,
    // or at the custom test map's designated Boss Spawn marker when testing
    const bossPos = (this.state.terrain.isCustomTestMap && this.state.terrain.testBossSpawnPos)
      ? this.state.terrain.testBossSpawnPos
      : this.state.bossSpawnPos;
    const sx = bossPos.x;
    const sy = bossPos.y;
    const spawnElev = this.state.terrain.getElevation(sx, sy);

    const { tierDef } = getDifficultyTier(this.state.gameTime);
    const scaledHealth = Math.round(STAGE1_BOSS_CONFIG.maxHealth * tierDef.hpMultiplier);
    const scaledDamage = Math.round(STAGE1_BOSS_CONFIG.touchDamage * tierDef.damageMultiplier);

    const titan: EnemyState = {
      id: `boss_titan_${this.nextEnemyId++}`,
      type: 'boss',
      isBoss: true,
      isStage1Titan: true,
      titanState: 'emerging',
      titanTimer: 4.0, // 4-second heavy slow cinematic emergence
      titanAnimFrame: 0,
      titanFacing: 'front',
      titanFootstepTimer: 0,
      titanRumbleTimer: 0,
      pos: { x: sx, y: sy },
      velocity: { x: 0, y: 0 },
      z: spawnElev.height - 360, // Deep underground rising up in front of the shipwreck
      groundZ: spawnElev.height,
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
      data: { id: titan.id, pos: { ...titan.pos }, groundZ: spawnElev.height }
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
      currencyReward: cfg.currencyReward,
      xpReward: cfg.xpReward,
      radius: cfg.radius,
      isSpawning: false,
      isAlerted: true
    };

    this.state.enemies.push(boss);
    this.state.events.push({
      type: 'boss_spawned',
      data: { name: 'Brood Queen (Event Guardian)' }
    });
  }

  private updateStage1Titan(boss: EnemyState, dt: number): void {
    const p = this.state.player;
    const dx = p.pos.x - boss.pos.x;
    const dy = p.pos.y - boss.pos.y;
    const dist = Math.hypot(dx, dy) || 1;

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

    // 2. EMERGENCE SEQUENCE (Phase 2)
    if (boss.titanState === 'emerging') {
      boss.velocity.x = 0;
      boss.velocity.y = 0;
      boss.titanTimer = Math.max(0, (boss.titanTimer ?? 4.0) - dt);
      const emergeProgress = 1.0 - (boss.titanTimer / 4.0);
      boss.z = boss.groundZ - 360 * (1.0 - emergeProgress);

      boss.titanRumbleTimer = (boss.titanRumbleTimer ?? 0) + dt;
      if (boss.titanRumbleTimer >= 0.35) {
        boss.titanRumbleTimer = 0;
        this.state.events.push({
          type: 'stage1_boss_rumble',
          data: { pos: { ...boss.pos }, intensity: 0.45, z: boss.groundZ }
        });
      }

      if (boss.titanTimer <= 0) {
        boss.z = boss.groundZ;
        boss.titanState = 'idle';
        boss.titanTimer = 0.45;
        this.state.events.push({
          type: 'stage1_boss_rumble',
          data: { pos: { ...boss.pos }, intensity: 0.75, z: boss.groundZ, isFinalBurst: true }
        });
        this.state.events.push({
          type: 'boss_spawned',
          data: { name: 'COLOSSAL BIO-CULTIVATOR', pos: { ...boss.pos }, z: boss.groundZ }
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

    // 4. WALKING LOCOMOTION
    if (boss.titanState === 'walk') {
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

      // Check touch damage against player
      if (dist <= boss.radius + 20 && Math.abs(p.z - boss.z) < 60) {
        this.damagePlayer(boss.touchDamage * 0.8 * dt, true);
      }

      boss.attackCooldownRemaining -= dt;
      boss.titanTimer = (boss.titanTimer ?? STAGE1_BOSS_CONFIG.laser.duration) - dt;

      // Do NOT interrupt pursuit if player is far away! Only trigger attack when in effective combat range
      const inAttackRange = dist <= 950;
      const canAttack = (inAttackRange && boss.attackCooldownRemaining <= 0) || (dist <= 1350 && boss.attackCooldownRemaining <= 0 && (this.stage1BossCycle % 3 === 2));

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

      if (distToBeam <= 40 + 16 && Math.abs(p.z - boss.z) < 75) {
        // Continuous tick damage
        if (!p.isDashing) {
          this.damagePlayer(22 * dt, true);
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
          if (strikeDist <= STAGE1_BOSS_CONFIG.tentacle.strikeRadius && !p.isDashing) {
            this.damagePlayer(STAGE1_BOSS_CONFIG.tentacle.damage);
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
        const originZ = boss.z + 240;
        const pDist = Math.hypot(p.pos.x - boss.pos.x, p.pos.y - boss.pos.y) || 1;
        const pAng = Math.atan2(p.pos.y - boss.pos.y, p.pos.x - boss.pos.x);
        const count = STAGE1_BOSS_CONFIG.elemental.projectileCount;
        const speed = STAGE1_BOSS_CONFIG.elemental.speed;
        const totalArc = Math.PI * 0.38; // ~68-degree focused barrage arc centered directly on player

        for (let k = 0; k < count; k++) {
          const spreadFactor = ((k - (count - 1) * 0.5) / ((count - 1) * 0.5)); // -1.0 to 1.0
          const ang = pAng + spreadFactor * (totalArc * 0.5);
          const travelTime = pDist / speed;
          const vz = (p.z + 24 - originZ) / Math.max(0.5, travelTime);

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
            targetZ: p.z + 24
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
    let bestDist = 78;
    for (let i = 0; i < this.state.pods.length; i++) {
      const pod = this.state.pods[i];
      if (pod.isOpened) continue;
      const d = Math.hypot(p.pos.x - pod.pos.x, p.pos.y - pod.pos.y);
      if (d <= bestDist) {
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

        const chosenItem: ItemId = rollWeightedPassiveItem(this.state.rng);
        pod.itemRewarded = chosenItem;

        this.state.events.push({
          type: 'pod_opened',
          data: { podId: pod.id, pos: { ...pod.pos }, cost: pod.cost, item: chosenItem }
        });

        if (this.state.commandArtifactActive) {
          // Trial / Command Mode: Open 3-choice Attribute Upgrade modal (single reward)
          this.queueBuffDraft();
        } else {
          // Standard RoR2 Mode: Pop physical attribute item drop from the chest (single reward)
          pod.itemDropped = chosenItem;
          this.spawnPhysicalItemDrop(
            { x: pod.pos.x, y: pod.pos.y + 14 },
            chosenItem
          );
        }
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

  private updateArtifact(dt: number, input: InputSnapshot): void {
    const p = this.state.player;
    const art = this.state.artifact;
    if (!art) return;

    const dist = Math.hypot(p.pos.x - art.pos.x, p.pos.y - art.pos.y);
    const artElev = this.state.terrain.calculateHeight(art.pos.x, art.pos.y);
    const vertOk = !this.state.terrain.isCustomTestMap || Math.abs(p.z - artElev) <= 180;

    // Phase 1: Natural passive charging when standing in teleporter beacon aura + kills
    if (!art.isCharged) {
      if (dist <= 260 && vertOk) {
        art.chargeProgress = Math.min(100, art.chargeProgress + 1.8 * dt);
        if (art.chargeProgress >= 100) {
          art.chargeProgress = 100;
          art.isCharged = true;
          art.isTeleporterReady = true;
          this.state.events.push({ type: 'artifact_charged', data: {} });
        }
      }
    }
    // Phase 2: Teleporter is 100% charged and ready for manual summon with [E]!
    else if (art.isCharged && art.isTeleporterReady && !art.isBossSpawned) {
      if (dist <= art.radius + 60 && vertOk && input.wantInteract) {
        art.isTeleporterReady = false;
        art.isSummoning = true;
        art.summonTimer = 4.0;
        art.isBossSpawned = true;
        art.isBossDefeated = false;
        this.state.hasBossSpawned = true;
        this.spawnStage1Titan(art.pos);
      }
    }
    // Phase 2/3: Summoning emergence countdown
    else if (art.isSummoning) {
      art.summonTimer = Math.max(0, (art.summonTimer || 4.0) - dt);
      if (art.summonTimer <= 0) {
        art.isSummoning = false;
      }
    }
    // Phase 4: Stage boss defeated! Portal opens, player must press [E] to escape!
    else if (art.isCharged && art.isBossDefeated && !art.isCompleted) {
      if (dist <= art.radius + 60 && vertOk && input.wantInteract) {
        art.isCompleted = true;
        this.state.isStageCleared = true;
        this.state.events.push({ type: 'stage_cleared', data: {} });
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
      if (dist < pickupRadius && (drop.settled || heightAboveGround < 28)) {
        const pullSpeed = 520 * (1.2 - dist / (pickupRadius + 20));
        const invDist = 1 / (dist || 1);
        drop.pos.x += (p.pos.x - drop.pos.x) * invDist * pullSpeed * dt;
        drop.pos.y += (p.pos.y - drop.pos.y) * invDist * pullSpeed * dt;
        drop.z = this.state.terrain.getElevation(drop.pos.x, drop.pos.y).height + 4;
      }

      if (dist <= 34 && (drop.settled || heightAboveGround < 32)) {
        p.currency += drop.value;
        this.state.events.push({
          type: 'currency_collected',
          data: { value: drop.value, pos: { ...drop.pos }, z: drop.z }
        });
        continue;
      }

      alive.push(drop);
    }

    this.state.currencyDrops = alive;
  }

  private updateItemDrops(dt: number, input?: InputSnapshot): void {
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
        if (drop.isBuffDrop) {
          // Manual pickup choice with [E]
          if (dist <= 55 && input && input.wantInteract) {
            this.queueBuffDraft();
            this.state.events.push({
              type: 'buff_capsule_collected',
              data: { pos: { ...drop.pos } }
            });
            continue;
          }
        } else if (drop.itemId) {
          // Gentle magnetic pull when close for core passive items
          if (dist < 95) {
            const invDist = 1 / (dist || 1);
            drop.pos.x += (p.pos.x - drop.pos.x) * invDist * 260 * dt;
            drop.pos.y += (p.pos.y - drop.pos.y) * invDist * 260 * dt;
          }

          if (dist <= 42) {
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

  /**
   * World Events System:
   * 1. Primal Totem (Basic Skill Altering / Leveling)
   * 2. Orbital Uplink (Ultimate Skill Altering / Leveling)
   * 3. Trial of Corruption (Enemy Buff/Debuff Risk & Reward)
   */
  private updateWorldEvents(dt: number, input: InputSnapshot): void {
    const p = this.state.player;

    for (let i = 0; i < this.state.worldEvents.length; i++) {
      const ev = this.state.worldEvents[i];
      if (ev.isCompleted) continue;

      const d = Math.hypot(p.pos.x - ev.pos.x, p.pos.y - ev.pos.y);

      // Event 1: Primal Totem (Basic Skill Altering / Leveling)
      if (ev.type === 'primal_totem') {
        if (d <= ev.radius) {
          ev.isActive = true;
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

          if (ev.chargeProgress >= 100) {
            ev.isCompleted = true;
            ev.isActive = false;

            // Purifying ground shockwave: 160 damage to all enemies in area
            const victims = this.spatialGrid.getNearby(ev.pos, ev.radius + 40);
            for (const v of victims) {
              if (v.health > 0) this.damageEnemy(v, 160, v.pos);
            }

            this.state.events.push({
              type: 'world_event_completed',
              data: { id: ev.id, type: ev.type, name: ev.name, pos: { ...ev.pos } }
            });

            // Opens draft with ONLY Basic Skill Evolutions!
            this.queueBuffDraft('basic_skill_totem');
          }
        } else if (ev.chargeProgress > 0 && !ev.isCompleted) {
          ev.isActive = false;
          ev.chargeProgress = Math.max(0, ev.chargeProgress - 3.5 * dt);
        }
      }

      // Event 2: Kinetic Blade Conduit (Secondary Skill Altering)
      else if (ev.type === 'secondary_totem') {
        if (d <= ev.radius) {
          ev.isActive = true;
          ev.chargeProgress = Math.min(100, ev.chargeProgress + (100 / 14) * dt);
          ev.pulseTimer += dt;

          if (ev.pulseTimer >= 2.2) {
            ev.pulseTimer = 0;
            this.state.events.push({
              type: 'world_event_pulse',
              data: { id: ev.id, pos: { ...ev.pos }, radius: ev.radius }
            });
          }

          if (ev.chargeProgress >= 100) {
            ev.isCompleted = true;
            ev.isActive = false;

            const victims = this.spatialGrid.getNearby(ev.pos, ev.radius + 40);
            for (const v of victims) {
              if (v.health > 0) this.damageEnemy(v, 160, v.pos);
            }

            this.state.events.push({
              type: 'world_event_completed',
              data: { id: ev.id, type: ev.type, name: ev.name, pos: { ...ev.pos } }
            });

            // Opens draft with ONLY Secondary Skill Enhancements!
            this.queueBuffDraft('secondary_skill_totem');
          }
        } else if (ev.chargeProgress > 0 && !ev.isCompleted) {
          ev.isActive = false;
          ev.chargeProgress = Math.max(0, ev.chargeProgress - 3.5 * dt);
        }
      }

      // Event 3: Phase Thruster Pylon (Dash / Utility Skill Altering)
      else if (ev.type === 'dash_totem') {
        if (d <= ev.radius) {
          ev.isActive = true;
          ev.chargeProgress = Math.min(100, ev.chargeProgress + (100 / 14) * dt);
          ev.pulseTimer += dt;

          if (ev.pulseTimer >= 2.2) {
            ev.pulseTimer = 0;
            this.state.events.push({
              type: 'world_event_pulse',
              data: { id: ev.id, pos: { ...ev.pos }, radius: ev.radius }
            });
          }

          if (ev.chargeProgress >= 100) {
            ev.isCompleted = true;
            ev.isActive = false;

            const victims = this.spatialGrid.getNearby(ev.pos, ev.radius + 40);
            for (const v of victims) {
              if (v.health > 0) this.damageEnemy(v, 160, v.pos);
            }

            this.state.events.push({
              type: 'world_event_completed',
              data: { id: ev.id, type: ev.type, name: ev.name, pos: { ...ev.pos } }
            });

            // Opens draft with ONLY Dash Skill Enhancements!
            this.queueBuffDraft('dash_skill_totem');
          }
        } else if (ev.chargeProgress > 0 && !ev.isCompleted) {
          ev.isActive = false;
          ev.chargeProgress = Math.max(0, ev.chargeProgress - 3.5 * dt);
        }
      }

      // Event 2: Orbital Uplink Conduit (Ultimate Skill Altering / Leveling)
      else if (ev.type === 'orbital_uplink') {
        if (d <= ev.radius) {
          ev.isActive = true;
          ev.chargeProgress = Math.min(100, ev.chargeProgress + (100 / 16) * dt);
          ev.pulseTimer += dt;

          if (ev.pulseTimer >= 3.0) {
            ev.pulseTimer = 0;
            this.state.events.push({
              type: 'world_event_pulse',
              data: { id: ev.id, pos: { ...ev.pos }, radius: ev.radius }
            });
          }

          if (ev.chargeProgress >= 100) {
            ev.isCompleted = true;
            ev.isActive = false;

            // Free cataclysmic orbital strike on uplink location!
            this.state.events.push({
              type: 'damage_dealt',
              data: {
                pos: { ...ev.pos },
                radius: 180,
                damage: 350,
                isOrbitalBlast: true
              }
            });

            this.state.events.push({
              type: 'world_event_completed',
              data: { id: ev.id, type: ev.type, name: ev.name, pos: { ...ev.pos } }
            });

            // Opens draft with ONLY Ultimate Skill Evolutions!
            this.queueBuffDraft('ultimate_beacon');
          }
        } else if (ev.chargeProgress > 0 && !ev.isCompleted) {
          ev.isActive = false;
          ev.chargeProgress = Math.max(0, ev.chargeProgress - 3.5 * dt);
        }
      }

      // Event 3: Trial of Corruption (Enemy Buff/Debuff Modifier Event)
      else if (ev.type === 'void_corruption') {
        if (!ev.isActive) {
          if (d <= 70 && input.wantInteract) {
            ev.isActive = true;
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

            this.state.events.push({
              type: 'world_event_completed',
              data: { id: ev.id, type: ev.type, name: ev.name, pos: { ...ev.pos } }
            });

            // Opens draft with Legendary Corruption Mutations!
            this.queueBuffDraft('void_corruption');
          }
        }
      }

      // Restore Flying Boss (Brood Queen / Flying Sovereign) as Event Boss:
      // Spawns exactly once when any charging event reaches 50% progress
      if (ev.isActive && ev.chargeProgress >= 50 && !ev.hasSpawnedBoss50) {
        ev.hasSpawnedBoss50 = true;
        this.spawnEventBoss(ev.pos);
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

    // 2. Check ground Augment Capsules (deliberate manual pickup)
    for (let i = 0; i < this.state.itemDrops.length; i++) {
      const drop = this.state.itemDrops[i];
      if (drop.isBuffDrop && drop.settled) {
        const d = Math.hypot(p.pos.x - drop.pos.x, p.pos.y - drop.pos.y);
        if (d <= 55) {
          return {
            key: 'E',
            label: 'Absorb Augment Capsule'
          };
        }
      }
    }

    // 3. Check World Events
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
            : ev.type === 'orbital_uplink'
            ? `Celestial Uplink Charging [${Math.round(ev.chargeProgress)}%]`
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
        if (!art.isCharged) {
          return {
            key: 'TELEPORTER',
            label: `Synchronizing... [${Math.floor(art.chargeProgress)}%]`
          };
        } else if (art.isTeleporterReady && !art.isBossSpawned) {
          return {
            key: 'E',
            label: 'TELEPORTER READY — PRESS E'
          };
        } else if (art.isSummoning) {
          return {
            key: 'WARNING',
            label: 'SEISMIC ANOMALY DETECTED — BOSS EMERGING!'
          };
        } else if (!art.isBossDefeated) {
          return {
            key: 'LOCKED',
            label: 'DEFEAT THE BOSS TO ACTIVATE TELEPORTER'
          };
        } else {
          return {
            key: 'E',
            label: 'TELEPORTER UNLOCKED — PRESS E'
          };
        }
      }
    }

    return null;
  }
}

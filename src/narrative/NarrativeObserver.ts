import { GameState } from '../sim/GameState';
import { SimEvent } from '../sim/types';
import { NarrativeSignal } from './types';

export interface ObserverTelemetry {
  isHighCombatIntensity: boolean;
  isBossActive: boolean;
  hasActiveWorldEvent: boolean;
  runTimeSec: number;
  quietExplorationSec: number;
  hostileContactCount: number;
}

const AUGMENT_EVENT_TYPES = new Set([
  'primal_totem',
  'secondary_totem',
  'dash_totem',
  'orbital_uplink'
]);

export class NarrativeObserver {
  private firedTriggers: Set<string> = new Set();
  private completedAugmentEventIds: Set<string> = new Set();
  private pendingAugmentMilestone: number | null = null;
  private spawnPos: { x: number; y: number } = { x: 1800, y: 2480 };
  private hasMovedSinceSpawn: boolean = false;
  private runTimeSec: number = 0;
  private sinceTowerReachedSec: number = 0;
  private spatialScanTimer: number = 0;
  private timeSinceCombatSec: number = 999;
  private ambientCooldownTimer: number = 0;
  private hostileContactCount: number = 0;
  private lastAliveEnemyCount: number = 0;

  public resetRun(state: GameState): void {
    this.firedTriggers.clear();
    this.completedAugmentEventIds.clear();
    this.pendingAugmentMilestone = null;
    this.spawnPos = { x: state.player.pos.x, y: state.player.pos.y };
    this.hasMovedSinceSpawn = false;
    this.runTimeSec = 0;
    this.sinceTowerReachedSec = 0;
    this.spatialScanTimer = 0;
    this.timeSinceCombatSec = 999;
    this.ambientCooldownTimer = 0;
    this.hostileContactCount = 0;
    this.lastAliveEnemyCount = 0;
  }

  public getTelemetry(state: GameState): ObserverTelemetry {
    const isBossActive =
      state.enemies.some((e) => (e.isBoss || e.type === 'boss' || e.isStage1Titan) && e.health > 0) ||
      Boolean(state.artifact?.isSummoning);
    const hasActiveWorldEvent = state.worldEvents.some((ev) => ev.isActive && !ev.isCompleted);
    const isHighCombatIntensity = isBossActive || hasActiveWorldEvent || this.timeSinceCombatSec < 4.5;

    return {
      isHighCombatIntensity,
      isBossActive,
      hasActiveWorldEvent,
      runTimeSec: this.runTimeSec,
      quietExplorationSec: this.timeSinceCombatSec,
      hostileContactCount: this.hostileContactCount
    };
  }

  public update(
    dt: number,
    events: SimEvent[],
    state: GameState,
    isPriorityDialogueBusy: boolean = false
  ): NarrativeSignal[] {
    const signals: NarrativeSignal[] = [];
    if (!state.isGameStarted || state.isPaused) {
      return signals;
    }

    // Fire automatic campaign voice triggers on Stage 1, and on canonical Stage 1 test maps (Untitled.glb / Blenderrr.glb)
    const allowCampaignTriggers = !state.terrain.isCustomTestMap || state.terrain.allowTestMapNarrative;

    // 1. Process discrete SimEvents BEFORE buff-choice early return so augment completion is never missed
    for (let i = 0; i < events.length; i++) {
      const ev = events[i];
      if (ev.type === 'damage_dealt' || ev.type === 'player_hit' || ev.type === 'enemy_killed') {
        this.timeSinceCombatSec = 0;
      }

      if (!allowCampaignTriggers) continue;

      switch (ev.type) {
        case 'pod_opened':
          this.emitOnce(signals, 'first_pod_opened', state, {
            podId: String(ev.data?.podId || '')
          });
          break;
        case 'world_event_completed': {
          const evType = String(ev.data?.type || '');
          const isQualifying = (Boolean(ev.data?.isAugmentEvent) || AUGMENT_EVENT_TYPES.has(evType)) && AUGMENT_EVENT_TYPES.has(evType);
          if (isQualifying && evType && !this.completedAugmentEventIds.has(evType)) {
            this.completedAugmentEventIds.add(evType);
            const authoritativeCount = Math.max(
              this.completedAugmentEventIds.size,
              state.completedEnhancementCategories.size
            );
            if (authoritativeCount !== 3) {
              this.pendingAugmentMilestone = authoritativeCount;
            }
          }
          break;
        }
        case 'tower_locked_interact':
          if (ev.data?.isFirstAttempt) {
            this.emitOnce(signals, 'tower_activation_locked_attempt', state, {
              recovered: ev.data?.recovered ?? 0
            });
          }
          break;
        case 'damage_dealt':
        case 'player_hit': {
          const enemyId = String(ev.data?.enemyId || '');
          if (enemyId && !state.hasBossSpawned && !state.artifact?.isBossSpawned) {
            this.emitOnce(signals, 'first_hostile_encounter', state, {
              source: ev.type
            });
            if (enemyId.startsWith('event_elite_') || enemyId.startsWith('event_boss_')) {
              this.emitOnce(signals, 'mutated_enemy_discovered', state, {
                enemyId
              });
            }
          }
          break;
        }
        case 'stage1_boss_emerge':
          this.emitOnce(signals, 'boss_emerged', state, {
            isStage1Boss: true
          });
          break;
        case 'boss_spawned':
          if (ev.data?.isStage1Boss) {
            this.emitOnce(signals, 'boss_emerged', state, {
              isStage1Boss: true
            });
          }
          break;
        case 'stage1_refreeze_started':
          this.emitOnce(signals, 'tower_restoration_refreeze', state, {
            isStage1Boss: true
          });
          this.emitOnce(signals, 'stage_leaving', state, {
            isStage1Boss: true
          });
          break;
        case 'stage1_boss_death':
          // Stage 1 boss defeat plays immediate aftermath dialogue before the player returns to press [E]
          this.emitOnce(signals, 'boss_defeated_aftermath', state, {
            isStage1Boss: true
          });
          break;
        case 'boss_defeated':
          if (ev.data?.isStage1Boss) {
            this.emitOnce(signals, 'boss_defeated_aftermath', state, {
              isStage1Boss: true
            });
          } else {
            this.emitOnce(signals, 'boss_defeated', state, {
              isStage1Boss: false
            });
          }
          break;
        case 'stage_cleared':
          this.emitOnce(signals, 'stage_leaving', state, {});
          break;
      }
    }

    if (state.isPausedForBuffChoice || state.isGameOver || state.isStageCleared) {
      return signals;
    }

    // Emit augment milestone dialogue & earthquakes after player finishes choosing the augment
    if (allowCampaignTriggers && this.pendingAugmentMilestone !== null) {
      const milestone = this.pendingAugmentMilestone;
      this.pendingAugmentMilestone = null;
      if (milestone === 1) {
        this.emitOnce(signals, 'first_enhancement_completed', state, {
          augmentCount: 1
        });
      } else if (milestone === 2) {
        // DialogueDirector.onConversationLeadIn triggers the moderate earthquake once the modal clears
        this.emitOnce(signals, 'second_augment_earthquake', state, {
          augmentCount: 2
        });
      } else if (milestone === 4) {
        // DialogueDirector.onConversationLeadIn triggers the major earthquake; completion chains into fourth_enhancement_revelation
        this.emitOnce(signals, 'fourth_augment_earthquake', state, {
          augmentCount: 4
        });
      }
    }

    this.runTimeSec += dt;
    this.timeSinceCombatSec += dt;
    if (this.firedTriggers.has('tower_reached')) {
      this.sinceTowerReachedSec += dt;
    }

    if (!allowCampaignTriggers) {
      return signals;
    }

    const p = state.player;
    const distFromSpawn = Math.hypot(p.pos.x - this.spawnPos.x, p.pos.y - this.spawnPos.y);
    if (distFromSpawn > 24) {
      this.hasMovedSinceSpawn = true;
    }

    // 2. Scene 01: Leaving crashed ship / spawn deck perimeter
    if (
      !this.firedTriggers.has('left_crash_site') &&
      this.hasMovedSinceSpawn &&
      this.runTimeSec >= 1.0 &&
      (distFromSpawn >= 120 || (!state.terrain.isCustomTestMap ? p.pos.y < 2360 : p.pos.y < this.spawnPos.y - 120))
    ) {
      this.emitOnce(signals, 'left_crash_site', state, {
        distFromSpawn: Math.round(distFromSpawn)
      });
    }

    // 3. Throttled spatial & combat proximity scan (every 0.2s)
    this.spatialScanTimer += dt;
    if (this.spatialScanTimer >= 0.2) {
      this.spatialScanTimer = 0;

      // Track genuine hostile encounters + mutated augment-event enemy discovery
      let nearbyLive = 0;
      let genuineEncounter = false;
      for (let i = 0; i < state.enemies.length; i++) {
        const e = state.enemies[i];
        if (e.health <= 0 || e.isSpawning) continue;
        const d = Math.hypot(p.pos.x - e.pos.x, p.pos.y - e.pos.y);
        const dz = Math.abs(p.z - e.z);
        if (d <= 340 && dz < 120) {
          nearbyLive++;
          if (e.isAlerted || d <= 260) {
            genuineEncounter = true;
          }
        }
        if (
          !this.firedTriggers.has('mutated_enemy_discovered') &&
          (e.id.startsWith('event_elite_') || e.id.startsWith('event_boss_')) &&
          d <= 440 &&
          dz < 180
        ) {
          this.emitOnce(signals, 'mutated_enemy_discovered', state, {
            enemyId: e.id,
            enemyType: e.type
          });
        }
      }
      if (nearbyLive > 0 && this.lastAliveEnemyCount === 0) {
        this.hostileContactCount++;
        this.timeSinceCombatSec = 0;
      }
      if (genuineEncounter && !state.hasBossSpawned && !state.artifact?.isBossSpawned) {
        this.emitOnce(signals, 'first_hostile_encounter', state, {
          nearbyCount: nearbyLive
        });
      }
      this.lastAliveEnemyCount = nearbyLive;
      if (nearbyLive > 0) {
        this.timeSinceCombatSec = 0;
      }

      if (this.hasMovedSinceSpawn) {
        // Scene 02: Meaningful encounter with active alien flora away from initial spawn
        if (!this.firedTriggers.has('flora_discovered') && distFromSpawn >= 220 && this.runTimeSec >= 3.0) {
          for (let i = 0; i < state.obstacles.length; i++) {
            const obs = state.obstacles[i];
            if (obs.type !== 'flora' && obs.type !== 'mushroom' && obs.type !== 'tree') continue;
            if (Math.hypot(obs.pos.x - this.spawnPos.x, obs.pos.y - this.spawnPos.y) < 240) continue;
            const d2 = Math.hypot(p.pos.x - obs.pos.x, p.pos.y - obs.pos.y);
            if (d2 <= Math.max(160, obs.radius + 85)) {
              const obsElev = state.terrain.getElevation(obs.pos.x, obs.pos.y).height;
              if (Math.abs(p.z - obsElev) < 120) {
                this.emitOnce(signals, 'flora_discovered', state, {
                  obstacleType: obs.type,
                  obstacleId: obs.id
                });
                break;
              }
            }
          }

          if (!this.firedTriggers.has('flora_discovered') && state.terrain.testFloraAnchors.length > 0) {
            for (let i = 0; i < state.terrain.testFloraAnchors.length; i++) {
              const anchor = state.terrain.testFloraAnchors[i];
              if (Math.hypot(anchor.x - this.spawnPos.x, anchor.y - this.spawnPos.y) < 260) continue;
              const d2 = Math.hypot(p.pos.x - anchor.x, p.pos.y - anchor.y);
              if (d2 <= 175 && Math.abs(p.z - anchor.z) < 120) {
                this.emitOnce(signals, 'flora_discovered', state, {
                  obstacleType: 'procedural_flora',
                  anchorIndex: i
                });
                break;
              }
            }
          }
        }

        // Scene 04: Alien river water in the valley / Stage 1 basin
        if (!this.firedTriggers.has('water_discovered') && state.stageNumber === 1 && distFromSpawn >= 180) {
          if (state.terrain.isCustomTestMap) {
            if (state.terrain.isPointNearWater(p.pos.x, p.pos.y)) {
              this.emitOnce(signals, 'water_discovered', state, {
                elevation: Math.round(p.z)
              });
            }
          } else if (p.pos.y >= 2050 && p.pos.y <= 3150 && p.pos.x >= 1050 && p.pos.x <= 1550) {
            const riverCenterX = 1300 + Math.sin(p.pos.y * 0.0035) * 80 + Math.cos(p.pos.y * 0.0018) * 40;
            if (Math.abs(p.pos.x - riverCenterX) < 165 && p.z <= 14) {
              this.emitOnce(signals, 'water_discovered', state, {
                elevation: Math.round(p.z)
              });
            }
          }
        }

        // Scene 07: First Overseer artifact clue (first Overseer shrine/augment structure discovered)
        if (!this.firedTriggers.has('artifact_discovered') && !state.hasBossSpawned && !state.artifact?.isBossSpawned) {
          for (let i = 0; i < state.worldEvents.length; i++) {
            const ev = state.worldEvents[i];
            const dEv = Math.hypot(p.pos.x - ev.pos.x, p.pos.y - ev.pos.y);
            const evElev = ev.elevation ?? state.terrain.getElevation(ev.pos.x, ev.pos.y).height;
            if (dEv <= Math.max(240, ev.radius + 110) && Math.abs(p.z - evElev) < 160) {
              this.emitOnce(signals, 'artifact_discovered', state, {
                artifactId: ev.id,
                artifactType: ev.type
              });
              break;
            }
          }
        }

        // New Event 04: Artifact Tower Reached
        const art = state.artifact;
        if (art && !state.hasBossSpawned && !art.isBossSpawned && !art.isBossDefeated) {
          const dArt = Math.hypot(p.pos.x - art.pos.x, p.pos.y - art.pos.y);
          const artElev = state.terrain.getElevation(art.pos.x, art.pos.y).height;

          if (!this.firedTriggers.has('tower_reached') && state.completedEnhancementCategories.size < 4) {
            const onTowerLedge =
              state.terrain.isCustomTestMap &&
              state.terrain.getElevation(p.pos.x, p.pos.y, p.z, 56).category === 'tower_ledge';
            const reachedTower = state.terrain.isCustomTestMap
              ? onTowerLedge || (dArt <= 680 && Math.abs(p.z - artElev) < 420)
              : dArt <= 340 && Math.abs(p.z - artElev) < 180;

            if (reachedTower) {
              this.sinceTowerReachedSec = 0;
              this.emitOnce(signals, 'tower_reached', state, {
                distToArtifact: Math.round(dArt)
              });
            }
          }

          // Tower Activation Unlocked: plays when player approaches the ready tower after all 4 modules are recovered
          if (
            !this.firedTriggers.has('tower_activation_unlocked') &&
            art.phase === 'unlocked_ready' &&
            art.isTeleporterReady &&
            !isPriorityDialogueBusy
          ) {
            const onTowerLedge =
              state.terrain.isCustomTestMap &&
              state.terrain.getElevation(p.pos.x, p.pos.y, p.z, 56).category === 'tower_ledge';
            const nearUnlockedTower = state.terrain.isCustomTestMap
              ? onTowerLedge || (dArt <= 560 && Math.abs(p.z - artElev) <= 360)
              : dArt <= 340 && Math.abs(p.z - artElev) <= 180;

            if (nearUnlockedTower) {
              this.emitOnce(signals, 'tower_activation_unlocked', state, {
                distToArtifact: Math.round(dArt)
              });
            }
          }
        }
      }
    }

    // 4. Scene 08: Quiet reflection after several hostile encounters
    const telemetry = this.getTelemetry(state);
    if (
      !this.firedTriggers.has('extended_hostility_quiet') &&
      !telemetry.isHighCombatIntensity &&
      !state.hasBossSpawned &&
      (this.hostileContactCount >= 4 || p.killCount >= 8) &&
      this.timeSinceCombatSec >= 4.0
    ) {
      this.emitOnce(signals, 'extended_hostility_quiet', state, {
        kills: p.killCount
      });
    }

    // 5. Optional Ambient exploration signal
    this.ambientCooldownTimer += dt;
    if (
      this.ambientCooldownTimer >= 32 &&
      this.runTimeSec >= 35 &&
      !telemetry.isHighCombatIntensity &&
      !state.hasBossSpawned &&
      this.timeSinceCombatSec >= 5.0
    ) {
      this.ambientCooldownTimer = 0;
      signals.push({
        triggerId: 'ambient_exploration',
        context: {
          originStage: state.stageNumber,
          triggerId: 'ambient_exploration',
          facts: { runTimeSec: Math.round(this.runTimeSec) }
        }
      });
    }

    return signals;
  }

  private emitOnce(
    out: NarrativeSignal[],
    triggerId: string,
    state: GameState,
    facts: Record<string, string | number | boolean>
  ): void {
    if (this.firedTriggers.has(triggerId)) return;
    this.firedTriggers.add(triggerId);
    out.push({
      triggerId,
      context: {
        originStage: state.stageNumber,
        triggerId,
        facts
      }
    });
  }
}

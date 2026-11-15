import { GameState } from '../sim/GameState';
import { SimEvent } from '../sim/types';
import { NarrativeSignal } from './types';

export interface ObserverTelemetry {
  isHighCombatIntensity: boolean;
  runTimeSec: number;
  quietExplorationSec: number;
  hostileContactCount: number;
}

export class NarrativeObserver {
  private firedTriggers: Set<string> = new Set();
  private spawnPos: { x: number; y: number } = { x: 1800, y: 2480 };
  private hasMovedSinceSpawn: boolean = false;
  private runTimeSec: number = 0;
  private spatialScanTimer: number = 0;
  private timeSinceCombatSec: number = 999;
  private ambientCooldownTimer: number = 0;
  private hostileContactCount: number = 0;
  private lastAliveEnemyCount: number = 0;

  public resetRun(state: GameState): void {
    this.firedTriggers.clear();
    this.spawnPos = { x: state.player.pos.x, y: state.player.pos.y };
    this.hasMovedSinceSpawn = false;
    this.runTimeSec = 0;
    this.spatialScanTimer = 0;
    this.timeSinceCombatSec = 999;
    this.ambientCooldownTimer = 0;
    this.hostileContactCount = 0;
    this.lastAliveEnemyCount = 0;
  }

  public getTelemetry(state: GameState): ObserverTelemetry {
    const activeBoss = state.enemies.some(
      (e) => (e.isBoss || e.type === 'boss' || e.isStage1Titan) && e.health > 0
    );
    const activeWorldEvent = state.worldEvents.some((ev) => ev.isActive && !ev.isCompleted);
    const isHighCombatIntensity =
      activeBoss ||
      activeWorldEvent ||
      Boolean(state.artifact?.isSummoning) ||
      this.timeSinceCombatSec < 4.5;

    return {
      isHighCombatIntensity,
      runTimeSec: this.runTimeSec,
      quietExplorationSec: this.timeSinceCombatSec,
      hostileContactCount: this.hostileContactCount
    };
  }

  public update(dt: number, events: SimEvent[], state: GameState): NarrativeSignal[] {
    const signals: NarrativeSignal[] = [];
    if (!state.isGameStarted || state.isPaused || state.isPausedForBuffChoice) {
      return signals;
    }

    // Fire automatic campaign voice triggers on Stage 1, and on canonical Stage 1 test maps (Untitled.glb)
    const allowCampaignTriggers = !state.terrain.isCustomTestMap || state.terrain.allowTestMapNarrative;

    // 1. Process discrete SimEvents (even on stage_cleared / game_over frame)
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
        case 'world_event_completed':
          this.emitOnce(signals, 'first_enhancement_completed', state, {
            eventType: String(ev.data?.type || '')
          });
          break;
        case 'artifact_charged':
          this.emitOnce(signals, 'teleporter_charged', state, {});
          break;
        case 'stage1_boss_emerge':
        case 'boss_spawned':
          this.emitOnce(signals, 'boss_emerged', state, {
            isStage1Boss: true
          });
          break;
        case 'stage1_boss_death':
        case 'boss_defeated':
          this.emitOnce(signals, 'boss_defeated', state, {
            isStage1Boss: true
          });
          break;
        case 'stage_cleared':
          this.emitOnce(signals, 'stage_leaving', state, {});
          break;
      }
    }

    if (state.isGameOver || state.isStageCleared) {
      return signals;
    }

    this.runTimeSec += dt;
    this.timeSinceCombatSec += dt;

    if (!allowCampaignTriggers) {
      return signals;
    }

    const p = state.player;
    const distFromSpawn = Math.hypot(p.pos.x - this.spawnPos.x, p.pos.y - this.spawnPos.y);
    if (distFromSpawn > 18) {
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

      // Track hostile encounters
      let nearbyLive = 0;
      for (let i = 0; i < state.enemies.length; i++) {
        const e = state.enemies[i];
        if (e.health <= 0 || e.isSpawning) continue;
        const d = Math.hypot(p.pos.x - e.pos.x, p.pos.y - e.pos.y);
        if (d <= 360 && Math.abs(p.z - e.z) < 130) {
          nearbyLive++;
        }
      }
      if (nearbyLive > 0 && this.lastAliveEnemyCount === 0) {
        this.hostileContactCount++;
        this.timeSinceCombatSec = 0;
        this.emitOnce(signals, 'first_hostile_encounter', state, {
          nearbyCount: nearbyLive
        });
      }
      this.lastAliveEnemyCount = nearbyLive;
      if (nearbyLive > 0) {
        this.timeSinceCombatSec = 0;
      }

      if (this.hasMovedSinceSpawn) {
        // Scene 02: Unusual thawing alien vegetation (flora / mushroom / tree)
        if (!this.firedTriggers.has('flora_discovered')) {
          for (let i = 0; i < state.obstacles.length; i++) {
            const obs = state.obstacles[i];
            if (obs.type !== 'flora' && obs.type !== 'mushroom' && obs.type !== 'tree') continue;
            const d2 = Math.hypot(p.pos.x - obs.pos.x, p.pos.y - obs.pos.y);
            if (d2 <= Math.max(175, obs.radius + 95)) {
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
        }

        // Scene 04: Alien river water in the valley / Stage 1 basin
        if (!this.firedTriggers.has('water_discovered') && state.stageNumber === 1) {
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

        // Scene 07: First artifact clue near Overseer Teleporter
        if (!this.firedTriggers.has('artifact_discovered') && state.artifact) {
          const dArt = Math.hypot(p.pos.x - state.artifact.pos.x, p.pos.y - state.artifact.pos.y);
          if (dArt <= 270) {
            const artElev = state.terrain.getElevation(state.artifact.pos.x, state.artifact.pos.y).height;
            if (Math.abs(p.z - artElev) < 160) {
              this.emitOnce(signals, 'artifact_discovered', state, {
                chargeProgress: Math.round(state.artifact.chargeProgress)
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
      (this.hostileContactCount >= 4 || p.killCount >= 8) &&
      this.timeSinceCombatSec >= 3.5
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

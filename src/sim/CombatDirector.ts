import { getDifficultyTier } from './DifficultyDefs';
import type { GameState } from './GameState';
import type { SeededRandom } from './ItemDefs';
import {
  createSpawnPlacementDiagnostics,
  findValidEnemySpawnPosition,
  type SpawnPlacementDiagnostics
} from './SpawnPlacement';
import type { EnemyType, Vector2 } from './types';

export type CombatDirectorMode = 'waiting_unlock' | 'exploration' | 'boss' | 'disabled';

interface SpawnCard {
  type: EnemyType;
  cost: number;
  weight: number;
  minTier: number;
  maxGroup: number;
  channels: readonly ('fast' | 'slow')[];
  fastMinTier?: number;
  fastWeight?: number;
}

const SPAWN_CARDS: readonly SpawnCard[] = [
  { type: 'crawler', cost: 10, weight: 42, minTier: 0, maxGroup: 4, channels: ['fast', 'slow'] },
  { type: 'spitter', cost: 13, weight: 28, minTier: 0, maxGroup: 3, channels: ['fast', 'slow'] },
  { type: 'wasp', cost: 15, weight: 22, minTier: 0, maxGroup: 3, channels: ['fast', 'slow'] },
  {
    type: 'elite',
    cost: 42,
    weight: 14,
    minTier: 1,
    maxGroup: 1,
    channels: ['slow', 'fast'],
    fastMinTier: 3,
    fastWeight: 6
  }
];

interface DirectorChannelState {
  id: 'fast' | 'slow';
  credits: number;
  timer: number;
  intervalRange: [number, number];
  maxStoredCredits: number;
  baseCreditsPerSec: number;
}

export interface CombatDirectorDiagnostics {
  mode: CombatDirectorMode;
  fastCredits: number;
  fastTimer: number;
  slowCredits: number;
  slowTimer: number;
  smoothThreat: number;
  activeExploration: number;
  activeScripted: number;
  softCap: number;
  hardCap: number;
  retiredDistantOnBoss: number;
  totalSpawnedByType: Record<EnemyType, number>;
  placementDiagnostics: SpawnPlacementDiagnostics;
}

/**
 * Dual-channel Fast (4.2-7.6s) + Slow (19.5-25.5s) Risk of Rain 2-inspired Combat Director.
 * Enforces 36 soft / 42 hard exploration caps (+50% density tuning) with zero batch overshoot,
 * normalized weighted enemy selection across all difficulty tiers, and clean
 * Boss-mode / post-boss encounter shutdown.
 */
export class CombatDirector {
  public readonly softCap = 36;
  public readonly hardCap = 42;

  private mode: CombatDirectorMode = 'waiting_unlock';
  private fast: DirectorChannelState = {
    id: 'fast',
    credits: 21,
    timer: 1.0,
    intervalRange: [4.2, 7.6],
    maxStoredCredits: 72,
    baseCreditsPerSec: 3.55
  };
  private slow: DirectorChannelState = {
    id: 'slow',
    credits: 30,
    timer: 14.5,
    intervalRange: [19.5, 25.5],
    maxStoredCredits: 180,
    baseCreditsPerSec: 2.35
  };
  private smoothThreat: number = 1.0;
  private retiredDistantOnBoss: number = 0;
  private totalSpawnedByType: Record<EnemyType, number> = {
    crawler: 0,
    spitter: 0,
    wasp: 0,
    elite: 0,
    boss: 0
  };
  private placementDiagnostics: SpawnPlacementDiagnostics = createSpawnPlacementDiagnostics();

  public reset(rng: SeededRandom): void {
    this.mode = 'waiting_unlock';
    this.fast = {
      id: 'fast',
      credits: 21,
      timer: 1.0,
      intervalRange: [4.2, 7.6],
      maxStoredCredits: 72,
      baseCreditsPerSec: 3.55
    };
    this.slow = {
      id: 'slow',
      credits: 30,
      timer: rng.range(13.0, 18.0),
      intervalRange: [19.5, 25.5],
      maxStoredCredits: 180,
      baseCreditsPerSec: 2.35
    };
    this.smoothThreat = 1.0;
    this.retiredDistantOnBoss = 0;
    this.totalSpawnedByType = {
      crawler: 0,
      spitter: 0,
      wasp: 0,
      elite: 0,
      boss: 0
    };
    this.placementDiagnostics = createSpawnPlacementDiagnostics();
  }

  public unlockExploration(): void {
    if (this.mode === 'waiting_unlock') {
      this.mode = 'exploration';
    }
  }

  public getMode(): CombatDirectorMode {
    return this.mode;
  }

  /**
   * Transitions to Stage 1 Boss mode: halts exploration channels, generates 0 boss adds,
   * and safely retires only distant unalerted exploration mobs while preserving nearby
   * enemies and all scripted world-event enemies.
   */
  public enterBossMode(state: GameState): void {
    this.mode = 'boss';
    const retireDist = state.terrain.isCustomTestMap ? 2400 : 1200;
    const p = state.player.pos;
    let retired = 0;
    state.enemies = state.enemies.filter((e) => {
      if (e.health <= 0 || e.isBoss || e.isStage1Titan || e.isScriptedEventEnemy) {
        return true;
      }
      if (!e.isAlerted && Math.hypot(e.pos.x - p.x, e.pos.y - p.y) > retireDist) {
        retired++;
        return false;
      }
      return true;
    });
    this.retiredDistantOnBoss += retired;
  }

  public disable(): void {
    this.mode = 'disabled';
  }

  private countPopulations(state: GameState): { activeExploration: number; activeScripted: number } {
    let activeExploration = 0;
    let activeScripted = 0;
    for (let i = 0; i < state.enemies.length; i++) {
      const e = state.enemies[i];
      if (e.health <= 0 || e.isBoss || e.isStage1Titan) continue;
      if (e.isScriptedEventEnemy) activeScripted++;
      else activeExploration++;
    }
    return { activeExploration, activeScripted };
  }

  private getSmoothThreat(gameTime: number): { tierIndex: number; smoothThreat: number } {
    const { tierDef, tierIndex, progressInTier, nextTierDef } = getDifficultyTier(gameTime);
    const curScale = Math.max(1.0, tierDef.threatMultiplier || ((tierDef.hpMultiplier + tierDef.damageMultiplier) * 0.5));
    const nextScale = nextTierDef
      ? Math.max(curScale, nextTierDef.threatMultiplier || ((nextTierDef.hpMultiplier + nextTierDef.damageMultiplier) * 0.5))
      : curScale;
    const smoothThreat = curScale + (nextScale - curScale) * Math.max(0, Math.min(1, progressInTier));
    return { tierIndex, smoothThreat };
  }

  private pickCard(
    channel: DirectorChannelState,
    tierIndex: number,
    rng: SeededRandom
  ): SpawnCard | null {
    const affordable: Array<{ card: SpawnCard; weight: number }> = [];
    let totalWeight = 0;
    for (let i = 0; i < SPAWN_CARDS.length; i++) {
      const card = SPAWN_CARDS[i];
      if (!card.channels.includes(channel.id)) continue;
      const reqTier = channel.id === 'fast' && card.fastMinTier !== undefined ? card.fastMinTier : card.minTier;
      if (tierIndex < reqTier) continue;
      if (channel.credits < card.cost) continue;
      const w = channel.id === 'fast' && card.fastWeight !== undefined ? card.fastWeight : card.weight;
      if (w <= 0) continue;
      totalWeight += w;
      affordable.push({ card, weight: w });
    }
    if (affordable.length === 0 || totalWeight <= 0) return null;

    let roll = rng.next() * totalWeight;
    for (let i = 0; i < affordable.length; i++) {
      roll -= affordable[i].weight;
      if (roll <= 0) return affordable[i].card;
    }
    return affordable[affordable.length - 1].card;
  }

  private stepChannel(
    channel: DirectorChannelState,
    dt: number,
    tierIndex: number,
    smoothThreat: number,
    state: GameState,
    cameraForward: Vector2 | undefined,
    pop: { activeExploration: number },
    spawnEnemy: (type: EnemyType, pos: Vector2, z: number) => void
  ): void {
    channel.credits = Math.min(
      channel.maxStoredCredits,
      channel.credits + channel.baseCreditsPerSec * smoothThreat * dt
    );
    channel.timer -= dt;
    if (channel.timer > 0) return;

    const rng = state.directorRng;
    channel.timer = rng.range(channel.intervalRange[0], channel.intervalRange[1]);

    const capLimit = channel.id === 'fast' ? this.softCap : this.hardCap;
    if (pop.activeExploration >= capLimit) return;

    const card = this.pickCard(channel, tierIndex, rng);
    if (!card) return;

    const roomInCap = this.hardCap - pop.activeExploration;
    const maxAffordable = Math.floor(channel.credits / card.cost);
    const maxUnits = Math.min(card.maxGroup, maxAffordable, roomInCap);
    if (maxUnits <= 0) return;

    const desiredCount =
      maxUnits === 1 ? 1 : Math.min(maxUnits, 1 + Math.floor(rng.next() * maxUnits));

    for (let i = 0; i < desiredCount; i++) {
      // Strictly re-check hard cap BEFORE every single unit spawn
      if (pop.activeExploration >= this.hardCap || channel.credits < card.cost) {
        break;
      }
      const pos = findValidEnemySpawnPosition(
        state,
        rng,
        card.type,
        { cameraForward, maxAttempts: 14 },
        this.placementDiagnostics
      );
      if (!pos) {
        // Do NOT spend credits on placement failure
        break;
      }
      channel.credits -= card.cost;
      spawnEnemy(card.type, { x: pos.x, y: pos.y }, pos.z);
      pop.activeExploration++;
      this.totalSpawnedByType[card.type] = (this.totalSpawnedByType[card.type] || 0) + 1;
    }
  }

  public update(
    dt: number,
    state: GameState,
    cameraForward: Vector2 | undefined,
    spawnEnemy: (type: EnemyType, pos: Vector2, z: number) => void
  ): void {
    const { tierIndex, smoothThreat } = this.getSmoothThreat(state.gameTime);
    this.smoothThreat = smoothThreat;

    if (this.mode !== 'exploration') return;

    const pop = this.countPopulations(state);
    this.stepChannel(this.fast, dt, tierIndex, smoothThreat, state, cameraForward, pop, spawnEnemy);
    this.stepChannel(this.slow, dt, tierIndex, smoothThreat, state, cameraForward, pop, spawnEnemy);
  }

  public getDiagnostics(state: GameState): CombatDirectorDiagnostics {
    const pop = this.countPopulations(state);
    return {
      mode: this.mode,
      fastCredits: Number(this.fast.credits.toFixed(1)),
      fastTimer: Number(Math.max(0, this.fast.timer).toFixed(1)),
      slowCredits: Number(this.slow.credits.toFixed(1)),
      slowTimer: Number(Math.max(0, this.slow.timer).toFixed(1)),
      smoothThreat: Number(this.smoothThreat.toFixed(2)),
      activeExploration: pop.activeExploration,
      activeScripted: pop.activeScripted,
      softCap: this.softCap,
      hardCap: this.hardCap,
      retiredDistantOnBoss: this.retiredDistantOnBoss,
      totalSpawnedByType: { ...this.totalSpawnedByType },
      placementDiagnostics: {
        totalAttempts: this.placementDiagnostics.totalAttempts,
        totalSuccesses: this.placementDiagnostics.totalSuccesses,
        lastFailureReason: this.placementDiagnostics.lastFailureReason,
        failures: { ...this.placementDiagnostics.failures }
      }
    };
  }
}

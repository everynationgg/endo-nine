import { GameState } from '../sim/GameState';
import { HeroId } from '../sim/types';
import {
  CommunicationRole,
  CommsPresentationState,
  Conversation,
  DevConversationSummary,
  DialogueLifecycleState,
  DialogueManifest,
  DialogueTurn,
  PacingConfig,
  SpeakerId,
  TranscriptEntry,
  TriggerContext,
  UnlockedCodexLore
} from './types';
import { DEFAULT_PACING_CONFIG, loadDialogueManifest, loadPacingConfig } from './manifest';
import { PREREQUISITE_REGISTRY, RELEVANCE_REGISTRY, evaluateNamedRule } from './predicates';
import { ObserverTelemetry } from './NarrativeObserver';

export interface VoicePlaybackPort {
  preload(urls: string[], loadGen: number): Promise<void>;
  play(
    url: string,
    offsetSec: number,
    role: CommunicationRole,
    playbackGen: number,
    onEnded: (gen: number) => void
  ): boolean;
  pause(playbackGen: number): number;
  stop(playbackGen: number): void;
  hasBuffer(url: string): boolean;
  isAvailable(): boolean;
  clearBuffers(): void;
}

interface QueuedConversation {
  instanceId: number;
  conversation: Conversation;
  turns: DialogueTurn[];
  context: TriggerContext;
  heroId: HeroId;
  nextTurnIndex: number;
  enqueuedAtSec: number;
  expiresAtSec: number | null;
  bypassPacing: boolean;
}

interface ActiveConversation {
  instanceId: number;
  conversation: Conversation;
  turns: DialogueTurn[];
  context: TriggerContext;
  heroId: HeroId;
  turnIndex: number;
  turnElapsedSec: number;
  turnDurationSec: number;
  inInterTurnPause: boolean;
  interTurnRemainingSec: number;
  audioPlaying: boolean;
  pausedOffsetSec: number;
  bypassPacing: boolean;
}

interface SavedNarrativeState {
  completedSaveIds: string[];
  unlockedCodex: UnlockedCodexLore[];
}

const STORAGE_KEY = 'endo_nine_narrative_v1';

const SPEAKER_DISPLAY_NAMES: Record<SpeakerId, string> = {
  commander: 'COMMANDER',
  doctor: 'DOCTOR',
  overseer: 'OVERSEER'
};

const SPEAKER_PORTRAITS: Record<SpeakerId, string> = {
  commander: '/assets/commander/commander_portrait.png?v=2.0',
  doctor: '/assets/doctor/doctor_portrait.png',
  overseer: '/assets/overseer/overseer_portrait.png'
};

export function resolveCommunicationRole(
  speaker: SpeakerId,
  activeHeroId: HeroId,
  _stageNumber: number
): CommunicationRole {
  if (speaker === 'commander' && activeHeroId === 'commander') return 'field_operative';
  if (speaker === 'doctor' && activeHeroId === 'doctor') return 'field_operative';
  return 'remote_support';
}

function roleDisplayLabel(role: CommunicationRole): string {
  switch (role) {
    case 'field_operative':
      return 'FIELD';
    case 'local_companion':
      return 'LOCAL';
    case 'remote_support':
    default:
      return 'COMMS';
  }
}

export class DialogueDirector {
  private voice: VoicePlaybackPort;
  private conversations: Conversation[] = [];
  private byId: Map<string, Conversation> = new Map();
  private pacing: PacingConfig = { ...DEFAULT_PACING_CONFIG };

  private completedSaveIds: Set<string> = new Set();
  private completedRunIds: Set<string> = new Set();
  private deferredRunItems: Map<string, { conversation: Conversation; context: TriggerContext }> = new Map();
  private unlockedCodex: Map<string, UnlockedCodexLore> = new Map();

  private transcript: TranscriptEntry[] = [];
  private transcriptIndexByKey: Map<string, number> = new Map();

  private queue: QueuedConversation[] = [];
  private active: ActiveConversation | null = null;
  private lifecycleState: DialogueLifecycleState = 'idle';

  private sessionId: number = 0;
  private nextInstanceId: number = 1;
  private playbackGen: number = 1;
  private loadGen: number = 1;

  private realClockSec: number = 0;
  private runRealClockSec: number = 0;
  private quietUntilSec: number = 0;
  private lastTriggeredAtSec: Map<string, number> = new Map();
  private banterCountThisRun: number = 0;

  private subtitlesEnabled: boolean = true;
  private isGamePaused: boolean = false;
  private isTabHidden: boolean = false;
  private lastKnownStage: number = 1;
  private lastKnownGameStarted: boolean = false;
  private lastKnownGameTime: number = 0;
  private lastStateRef: GameState | null = null;
  private lastPreloadedVoicedCount: number = 0;
  private lastPreloadedTotalCount: number = 0;

  private manifestUrl: string;
  private pacingUrl: string;
  private onPresentationChanged?: (state: CommsPresentationState) => void;
  private onTranscriptChanged?: () => void;

  constructor(
    voice: VoicePlaybackPort,
    opts?: {
      manifestUrl?: string;
      pacingUrl?: string;
      onPresentationChanged?: (state: CommsPresentationState) => void;
      onTranscriptChanged?: () => void;
    }
  ) {
    this.voice = voice;
    this.manifestUrl = opts?.manifestUrl || '/dialogue/stage1.json';
    this.pacingUrl = opts?.pacingUrl || '/dialogue/pacing.json';
    this.onPresentationChanged = opts?.onPresentationChanged;
    this.onTranscriptChanged = opts?.onTranscriptChanged;
    this.loadPersistentState();
  }

  public async initialize(): Promise<void> {
    await this.reloadManifest(false);
  }

  public async reloadManifest(clearBuffers: boolean = true): Promise<{ count: number; voicedCount: number }> {
    const curLoadGen = ++this.loadGen;
    if (clearBuffers) {
      this.voice.clearBuffers();
    }

    const [manifest, pacing] = await Promise.all([
      loadDialogueManifest(this.manifestUrl),
      loadPacingConfig(this.pacingUrl)
    ]);

    if (curLoadGen !== this.loadGen) {
      return { count: this.conversations.length, voicedCount: 0 };
    }

    this.pacing = pacing;
    this.conversations = manifest.conversations;
    this.byId.clear();
    for (const c of this.conversations) {
      this.byId.set(c.id, c);
    }

    // Preload all enabled scenes (and Scene 01 variants immediately)
    const urlsToPreload = new Set<string>();
    for (const conv of this.conversations) {
      if (conv.enabled === false) continue;
      for (const turns of Object.values(conv.variants)) {
        if (!Array.isArray(turns)) continue;
        for (const t of turns) {
          if (t.audioUrl) urlsToPreload.add(t.audioUrl);
        }
      }
    }

    await this.voice.preload([...urlsToPreload], curLoadGen);

    let voicedCount = 0;
    for (const url of urlsToPreload) {
      if (this.voice.hasBuffer(url)) voicedCount++;
    }
    this.lastPreloadedVoicedCount = voicedCount;
    this.lastPreloadedTotalCount = urlsToPreload.size;
    return { count: this.conversations.length, voicedCount };
  }

  public getDebugInfo(): {
    lifecycleState: DialogueLifecycleState;
    activeId: string | null;
    turnIndex: number;
    queueIds: string[];
    completedSaveIds: string[];
    completedRunIds: string[];
    voicedBufferedCount: number;
    voicedTotalEnabledUrls: number;
  } {
    return {
      lifecycleState: this.lifecycleState,
      activeId: this.active?.conversation.id || null,
      turnIndex: this.active?.turnIndex ?? 0,
      queueIds: this.queue.map((q) => q.conversation.id),
      completedSaveIds: [...this.completedSaveIds],
      completedRunIds: [...this.completedRunIds],
      voicedBufferedCount: this.lastPreloadedVoicedCount,
      voicedTotalEnabledUrls: this.lastPreloadedTotalCount
    };
  }

  public setSubtitlesEnabled(enabled: boolean): void {
    this.subtitlesEnabled = enabled;
    this.emitPresentation();
  }

  public getSubtitlesEnabled(): boolean {
    return this.subtitlesEnabled;
  }

  public setTabHidden(hidden: boolean): void {
    if (this.isTabHidden === hidden) return;
    this.isTabHidden = hidden;
    this.syncSuspensionState();
  }

  public startRun(state: GameState): void {
    this.lastStateRef = state;
    this.endRun('restart');
    this.sessionId++;
    this.completedRunIds.clear();
    this.deferredRunItems.clear();
    this.transcript = [];
    this.transcriptIndexByKey.clear();
    this.lastTriggeredAtSec.clear();
    this.banterCountThisRun = 0;
    this.runRealClockSec = 0;
    this.quietUntilSec = this.realClockSec + this.pacing.initialQuietSec;
    this.lastKnownStage = state.stageNumber || 1;
    this.lastKnownGameStarted = state.isGameStarted;
    this.lastKnownGameTime = state.gameTime || 0;
    this.isGamePaused = false;
    this.emitPresentation();
    this.onTranscriptChanged?.();
  }

  public endRun(reason: 'menu' | 'restart' | 'game_over' | 'stage_clear'): void {
    this.playbackGen++;
    this.voice.stop(this.playbackGen);

    if (reason === 'menu' || reason === 'restart') {
      this.active = null;
      this.queue = [];
      this.lifecycleState = 'idle';
      this.deferredRunItems.clear();
      this.lastKnownGameStarted = false;
      this.emitPresentation();
      return;
    }

    // For game_over / stage_clear: drop non-outcome active/queued dialogue; stage_leaving may trigger right after
    if (this.active && this.active.conversation.priority > 0) {
      this.active = null;
      this.lifecycleState = 'idle';
    }
    this.queue = this.queue.filter((q) => q.conversation.priority === 0);
    this.emitPresentation();
  }

  public stageTransition(newStageNumber: number, state: GameState): void {
    this.playbackGen++;
    this.voice.stop(this.playbackGen);
    this.loadGen++;
    this.voice.clearBuffers();

    // Preserve run_deferred active or queued items into deferredRunItems
    if (this.active && this.active.conversation.retention === 'run_deferred') {
      this.deferredRunItems.set(this.active.conversation.id, {
        conversation: this.active.conversation,
        context: this.active.context
      });
    }
    for (const q of this.queue) {
      if (q.conversation.retention === 'run_deferred') {
        this.deferredRunItems.set(q.conversation.id, {
          conversation: q.conversation,
          context: q.context
        });
      }
    }

    this.active = null;
    this.queue = [];
    this.lifecycleState = 'idle';
    this.banterCountThisRun = 0;
    this.lastKnownStage = newStageNumber;
    this.quietUntilSec = this.realClockSec + this.pacing.initialQuietSec;

    // Re-evaluate deferred run items on new stage
    for (const [id, entry] of this.deferredRunItems.entries()) {
      const ok = evaluateNamedRule(
        entry.conversation.relevanceRule,
        RELEVANCE_REGISTRY,
        state,
        entry.context,
        this.completedSaveIds,
        true
      );
      if (ok) {
        this.enqueueConversation(entry.conversation, entry.context, state, true);
      } else {
        this.deferredRunItems.delete(id);
      }
    }

    this.emitPresentation();
  }

  public notifySignal(triggerId: string, context: TriggerContext, state: GameState): void {
    for (const conv of this.conversations) {
      if (conv.enabled === false) continue;
      if (conv.trigger !== triggerId) continue;
      if (!this.isEligible(conv, context, state)) continue;
      this.enqueueConversation(conv, context, state, false);
    }
  }

  public async forcePlayConversation(
    conversationId: string,
    state: GameState,
    heroOverride?: HeroId
  ): Promise<boolean> {
    const conv = this.byId.get(conversationId);
    if (!conv) return false;

    const chosenHero: HeroId = heroOverride || state.player.heroId;
    const turns = this.resolveTurns(conv, chosenHero);
    if (!turns || turns.length === 0) return false;

    // Preload on-demand in case this scene was disabled in normal gameplay
    const urls = turns.map((t) => t.audioUrl).filter(Boolean);
    await this.voice.preload(urls, this.loadGen);

    // Preempt any current conversation cleanly for manual inspection
    this.playbackGen++;
    this.voice.stop(this.playbackGen);
    this.active = null;
    this.queue = [];
    this.lifecycleState = 'idle';

    const ctx: TriggerContext = {
      originStage: state.stageNumber || 1,
      triggerId: `dev_manual:${conv.trigger}`,
      facts: { manualDevTest: true }
    };

    const item: QueuedConversation = {
      instanceId: this.nextInstanceId++,
      conversation: conv,
      turns,
      context: ctx,
      heroId: chosenHero,
      nextTurnIndex: 0,
      enqueuedAtSec: this.realClockSec,
      expiresAtSec: null,
      bypassPacing: true
    };
    this.startActiveConversation(item, state);
    return true;
  }

  public forceStop(): void {
    this.playbackGen++;
    this.voice.stop(this.playbackGen);
    this.active = null;
    this.queue = [];
    this.lifecycleState = 'idle';
    this.emitPresentation();
  }

  public resetSavePersistence(): void {
    this.completedSaveIds.clear();
    this.completedRunIds.clear();
    this.unlockedCodex.clear();
    try {
      localStorage.removeItem(STORAGE_KEY);
    } catch {
      // ignore
    }
    this.onTranscriptChanged?.();
  }

  public getConversationSummaries(): DevConversationSummary[] {
    return this.conversations.map((c) => ({
      id: c.id,
      title: c.title || c.id,
      trigger: c.trigger,
      category: c.category,
      priority: c.priority,
      enabled: c.enabled !== false,
      hasCommanderVariant: Boolean(c.variants.commander?.length),
      hasDoctorVariant: Boolean(c.variants.doctor?.length),
      hasDefaultVariant: Boolean(c.variants.default?.length),
      needsHeroVariantReview: Boolean(c.needsHeroVariantReview)
    }));
  }

  public getTranscript(): TranscriptEntry[] {
    return [...this.transcript];
  }

  public getUnlockedCodexLore(): UnlockedCodexLore[] {
    return [...this.unlockedCodex.values()];
  }

  public getPresentationState(): CommsPresentationState {
    if (!this.active || (this.lifecycleState !== 'playing' && this.lifecycleState !== 'suspended' && this.lifecycleState !== 'awaiting_modal_close')) {
      return {
        visible: false,
        conversationId: null,
        conversationTitle: null,
        speaker: null,
        speakerDisplayName: '',
        role: null,
        roleLabel: '',
        portraitUrl: '',
        text: '',
        isSubtitlesEnabled: this.subtitlesEnabled,
        isVoicedPlayback: false,
        lifecycleState: this.lifecycleState,
        turnIndex: 0,
        turnCount: 0
      };
    }

    const turn = this.active.turns[this.active.turnIndex];
    const role = resolveCommunicationRole(turn.speaker, this.active.heroId, this.active.context.originStage);
    return {
      visible: !this.active.inInterTurnPause,
      conversationId: this.active.conversation.id,
      conversationTitle: this.active.conversation.title || this.active.conversation.id,
      speaker: turn.speaker,
      speakerDisplayName: SPEAKER_DISPLAY_NAMES[turn.speaker],
      role,
      roleLabel: roleDisplayLabel(role),
      portraitUrl: SPEAKER_PORTRAITS[turn.speaker],
      text: turn.text,
      isSubtitlesEnabled: this.subtitlesEnabled,
      isVoicedPlayback: this.active.audioPlaying,
      lifecycleState: this.lifecycleState,
      turnIndex: this.active.turnIndex,
      turnCount: this.active.turns.length
    };
  }

  public update(dt: number, state: GameState, telemetry: ObserverTelemetry): void {
    this.lastStateRef = state;
    // Defensive state-boundary detection if UIManager exited directly
    if (this.lastKnownGameStarted && !state.isGameStarted) {
      this.endRun('menu');
    }
    this.lastKnownGameStarted = state.isGameStarted;

    if (state.stageNumber !== this.lastKnownStage && state.isGameStarted) {
      this.stageTransition(state.stageNumber, state);
    }

    this.lastKnownGameTime = state.gameTime || 0;

    // Esc / Inventory / Codex hard pause suspension
    const shouldSuspend = state.isPaused || this.isTabHidden;
    if (shouldSuspend !== this.isGamePaused) {
      this.isGamePaused = shouldSuspend;
      this.syncSuspensionState();
    }

    if (this.lifecycleState === 'suspended' || this.isGamePaused) {
      return;
    }

    this.realClockSec += dt;
    if (state.isGameStarted && !state.isPausedForBuffChoice && !state.isGameOver && !state.isStageCleared) {
      this.runRealClockSec += dt;
    }

    // 1. Prune expired or invalidated queued conversations
    this.pruneQueue(state);

    // 2. Check active conversation relevance & advancement
    if (this.active) {
      if (
        !this.active.bypassPacing &&
        !this.checkRelevance(this.active.conversation, state, this.active.context)
      ) {
        this.dropActive();
      } else {
        this.stepActiveConversation(dt, state);
      }
    }

    // 3. Promote next queued conversation if idle and modal is not blocking
    if (!this.active && !state.isPausedForBuffChoice && this.queue.length > 0) {
      this.tryPromoteNext(state, telemetry);
    }
  }

  private syncSuspensionState(): void {
    const shouldBeSuspended = this.isGamePaused || this.isTabHidden;
    if (shouldBeSuspended && this.lifecycleState === 'playing' && this.active) {
      this.playbackGen++;
      if (this.active.audioPlaying) {
        this.active.pausedOffsetSec = this.voice.pause(this.playbackGen);
        this.active.audioPlaying = false;
      }
      this.lifecycleState = 'suspended';
      this.emitPresentation();
    } else if (!shouldBeSuspended && this.lifecycleState === 'suspended' && this.active) {
      this.lifecycleState = 'playing';
      if (!this.active.inInterTurnPause) {
        this.resumeCurrentTurnAudio();
      }
      this.emitPresentation();
    }
  }

  private isEligible(conv: Conversation, context: TriggerContext, state: GameState): boolean {
    if (conv.persistenceScope === 'once_per_save' && this.completedSaveIds.has(conv.id)) return false;
    if (conv.persistenceScope === 'once_per_run' && this.completedRunIds.has(conv.id)) return false;

    if (conv.cooldownSec !== undefined) {
      const last = this.lastTriggeredAtSec.get(conv.id);
      if (last !== undefined && this.realClockSec - last < conv.cooldownSec) return false;
    }

    if (this.active?.conversation.id === conv.id) return false;
    if (this.queue.some((q) => q.conversation.id === conv.id)) return false;

    const turns = this.resolveTurns(conv, state.player.heroId);
    if (!turns || turns.length === 0) return false;

    const prereqOk = evaluateNamedRule(
      conv.prerequisiteRule,
      PREREQUISITE_REGISTRY,
      state,
      context,
      this.completedSaveIds,
      true
    );
    if (!prereqOk) return false;

    return this.checkRelevance(conv, state, context);
  }

  private checkRelevance(conv: Conversation, state: GameState, context: TriggerContext): boolean {
    return evaluateNamedRule(
      conv.relevanceRule,
      RELEVANCE_REGISTRY,
      state,
      context,
      this.completedSaveIds,
      true
    );
  }

  private resolveTurns(conv: Conversation, heroId: HeroId): DialogueTurn[] | null {
    const heroTurns = conv.variants[heroId];
    if (heroTurns && heroTurns.length > 0) return heroTurns;
    const defTurns = conv.variants.default;
    if (defTurns && defTurns.length > 0) return defTurns;
    return null;
  }

  private enqueueConversation(
    conv: Conversation,
    context: TriggerContext,
    state: GameState,
    bypassPacing: boolean
  ): void {
    const turns = this.resolveTurns(conv, state.player.heroId);
    if (!turns || turns.length === 0) return;

    this.lastTriggeredAtSec.set(conv.id, this.realClockSec);

    const ttlSec =
      conv.retention === 'stage_immediate'
        ? conv.ttlSec ?? 5.0
        : conv.retention === 'stage_deferred' && conv.ttlSec !== undefined
        ? conv.ttlSec
        : null;

    const queuedItem: QueuedConversation = {
      instanceId: this.nextInstanceId++,
      conversation: conv,
      turns,
      context,
      heroId: state.player.heroId,
      nextTurnIndex: 0,
      enqueuedAtSec: this.realClockSec,
      expiresAtSec: ttlSec !== null ? this.realClockSec + ttlSec : null,
      bypassPacing
    };

    // Immediate preemption if active conversation has strictly lower importance (higher priority number)
    if (
      this.active &&
      !this.active.bypassPacing &&
      conv.priority < this.active.conversation.priority &&
      !state.isPausedForBuffChoice
    ) {
      this.preemptActiveFor(queuedItem, state);
      return;
    }

    this.queue.push(queuedItem);
    this.queue.sort((a, b) => a.conversation.priority - b.conversation.priority || a.enqueuedAtSec - b.enqueuedAtSec);
    if (!this.active) {
      this.lifecycleState = 'queued';
    }
  }

  private preemptActiveFor(incoming: QueuedConversation, state: GameState): void {
    const prev = this.active!;
    this.playbackGen++;
    this.voice.stop(this.playbackGen);

    if (
      prev.conversation.resumable &&
      this.checkRelevance(prev.conversation, state, prev.context)
    ) {
      // Restart interrupted speaker turn from offset 0 when resumed
      this.queue.unshift({
        instanceId: prev.instanceId,
        conversation: prev.conversation,
        turns: prev.turns,
        context: prev.context,
        heroId: prev.heroId,
        nextTurnIndex: prev.turnIndex,
        enqueuedAtSec: this.realClockSec,
        expiresAtSec:
          prev.conversation.retention === 'stage_immediate'
            ? this.realClockSec + (prev.conversation.ttlSec ?? 5.0)
            : null,
        bypassPacing: prev.bypassPacing
      });
    }

    this.active = null;
    this.startActiveConversation(incoming, state);
  }

  private pruneQueue(state: GameState): void {
    if (this.queue.length === 0) return;
    this.queue = this.queue.filter((item) => {
      if (item.expiresAtSec !== null && this.realClockSec >= item.expiresAtSec) {
        return false;
      }
      if (!item.bypassPacing && !this.checkRelevance(item.conversation, state, item.context)) {
        return false;
      }
      return true;
    });
    if (!this.active && this.queue.length === 0 && this.lifecycleState === 'queued') {
      this.lifecycleState = 'idle';
    }
  }

  private tryPromoteNext(state: GameState, telemetry: ObserverTelemetry): void {
    for (let i = 0; i < this.queue.length; i++) {
      const candidate = this.queue[i];
      if (!candidate.bypassPacing && !this.canPlayUnderPacing(candidate.conversation, telemetry)) {
        continue;
      }
      this.queue.splice(i, 1);
      this.startActiveConversation(candidate, state);
      return;
    }
  }

  private canPlayUnderPacing(conv: Conversation, telemetry: ObserverTelemetry): boolean {
    if (conv.priority === 0 || conv.category === 'essential') {
      // Critical/essential beats bypass normal quiet floor unless inside initial drop second
      return conv.priority === 0 || this.runRealClockSec >= Math.min(0.8, this.pacing.initialQuietSec);
    }

    if (this.realClockSec < this.quietUntilSec) {
      return false;
    }

    if (conv.category === 'banter') {
      if (telemetry.isHighCombatIntensity) return false;
      if (this.banterCountThisRun >= this.pacing.maxBanterPerStageRun) return false;
    } else if (conv.category === 'contextual' && conv.priority >= 2 && telemetry.isHighCombatIntensity) {
      return false;
    }

    return true;
  }

  private startActiveConversation(item: QueuedConversation, state: GameState): void {
    if (item.conversation.category === 'banter' && !item.bypassPacing) {
      this.banterCountThisRun++;
    }

    this.active = {
      instanceId: item.instanceId,
      conversation: item.conversation,
      turns: item.turns,
      context: item.context,
      heroId: item.heroId,
      turnIndex: item.nextTurnIndex,
      turnElapsedSec: 0,
      turnDurationSec: item.turns[item.nextTurnIndex]?.durationSec || 2.5,
      inInterTurnPause: false,
      interTurnRemainingSec: 0,
      audioPlaying: false,
      pausedOffsetSec: 0,
      bypassPacing: item.bypassPacing
    };
    this.lifecycleState = 'playing';
    this.beginCurrentTurn(state);
  }

  private beginCurrentTurn(state: GameState): void {
    if (!this.active) return;
    const turn = this.active.turns[this.active.turnIndex];
    if (!turn) {
      this.completeActiveConversation();
      return;
    }

    this.active.turnElapsedSec = 0;
    this.active.turnDurationSec = Math.max(0.4, turn.durationSec);
    this.active.inInterTurnPause = false;
    this.active.interTurnRemainingSec = 0;
    this.active.pausedOffsetSec = 0;

    const gen = ++this.playbackGen;
    const role = resolveCommunicationRole(turn.speaker, this.active.heroId, this.active.context.originStage);
    const startedAudio = this.voice.play(turn.audioUrl, 0, role, gen, (endedGen) => {
      if (endedGen !== this.playbackGen || !this.active || this.lifecycleState !== 'playing') return;
      this.finishCurrentTurn(state);
    });
    this.active.audioPlaying = startedAudio;

    this.upsertTranscriptEntry(this.active, turn, role, startedAudio);
    this.emitPresentation();
  }

  private resumeCurrentTurnAudio(): void {
    if (!this.active) return;
    const turn = this.active.turns[this.active.turnIndex];
    if (!turn) return;

    const gen = ++this.playbackGen;
    const role = resolveCommunicationRole(turn.speaker, this.active.heroId, this.active.context.originStage);
    const offset = Math.max(0, Math.min(this.active.turnElapsedSec, this.active.turnDurationSec - 0.05));
    const startedAudio = this.voice.play(turn.audioUrl, offset, role, gen, (endedGen) => {
      if (endedGen !== this.playbackGen || !this.active || this.lifecycleState !== 'playing') return;
      if (this.lastStateRef) {
        this.finishCurrentTurn(this.lastStateRef);
      } else {
        this.onAudioTurnNaturalEnd();
      }
    });
    this.active.audioPlaying = startedAudio;
  }

  private onAudioTurnNaturalEnd(): void {
    if (!this.active) return;
    this.active.audioPlaying = false;
    if (this.active.turnIndex + 1 >= this.active.turns.length) {
      this.completeActiveConversation();
      return;
    }
    const turn = this.active.turns[this.active.turnIndex];
    const pauseAfter = turn?.pauseAfterSec ?? this.pacing.defaultPauseAfterTurnSec;
    this.active.inInterTurnPause = true;
    this.active.interTurnRemainingSec = pauseAfter;
    this.emitPresentation();
  }

  private stepActiveConversation(dt: number, state: GameState): void {
    if (!this.active) return;

    // Hold cleanly at inter-turn boundary while 3-Choice Augment modal is open
    if (this.lifecycleState === 'awaiting_modal_close') {
      if (!state.isPausedForBuffChoice) {
        this.lifecycleState = 'playing';
        this.advanceToNextTurn(state);
      }
      return;
    }

    if (this.active.inInterTurnPause) {
      this.active.interTurnRemainingSec -= dt;
      if (this.active.interTurnRemainingSec <= 0) {
        if (state.isPausedForBuffChoice) {
          this.lifecycleState = 'awaiting_modal_close';
          this.emitPresentation();
          return;
        }
        this.advanceToNextTurn(state);
      }
      return;
    }

    this.active.turnElapsedSec += dt;

    // Fallback completion timer (always active when audio is muted/missing, and safety guard on voiced lines)
    const fallbackCap = this.active.audioPlaying
      ? this.active.turnDurationSec + 1.5
      : this.active.turnDurationSec;

    if (this.active.turnElapsedSec >= fallbackCap) {
      this.finishCurrentTurn(state);
    }
  }

  private finishCurrentTurn(state: GameState): void {
    if (!this.active) return;
    this.playbackGen++;
    if (this.active.audioPlaying) {
      this.voice.stop(this.playbackGen);
      this.active.audioPlaying = false;
    }

    const turn = this.active.turns[this.active.turnIndex];
    const pauseAfter = turn?.pauseAfterSec ?? this.pacing.defaultPauseAfterTurnSec;
    if (pauseAfter > 0 && this.active.turnIndex + 1 < this.active.turns.length) {
      this.active.inInterTurnPause = true;
      this.active.interTurnRemainingSec = pauseAfter;
      this.emitPresentation();
      return;
    }

    if (state.isPausedForBuffChoice && this.active.turnIndex + 1 < this.active.turns.length) {
      this.lifecycleState = 'awaiting_modal_close';
      this.emitPresentation();
      return;
    }

    this.advanceToNextTurn(state);
  }

  private advanceToNextTurn(state: GameState): void {
    if (!this.active) return;
    this.active.turnIndex++;
    if (this.active.turnIndex >= this.active.turns.length) {
      this.completeActiveConversation();
    } else {
      this.beginCurrentTurn(state);
    }
  }

  private completeActiveConversation(): void {
    if (!this.active) return;
    const conv = this.active.conversation;
    const bypass = this.active.bypassPacing;

    if (!bypass) {
      if (conv.persistenceScope === 'once_per_save') {
        this.completedSaveIds.add(conv.id);
      } else if (conv.persistenceScope === 'once_per_run') {
        this.completedRunIds.add(conv.id);
      }

      if (conv.onComplete?.codexEntryId && !this.unlockedCodex.has(conv.onComplete.codexEntryId)) {
        this.unlockedCodex.set(conv.onComplete.codexEntryId, {
          id: conv.onComplete.codexEntryId,
          title: conv.onComplete.codexTitle || conv.title || conv.id,
          summary: conv.onComplete.codexSummary || '',
          unlockedAtIso: new Date().toISOString()
        });
      }

      this.savePersistentState();

      const quiet =
        conv.category === 'essential'
          ? this.pacing.quietAfterEssentialSec
          : conv.category === 'contextual'
          ? this.pacing.quietAfterContextualSec
          : this.pacing.quietAfterBanterSec;
      this.quietUntilSec = Math.max(this.quietUntilSec, this.realClockSec + quiet);
    }

    this.deferredRunItems.delete(conv.id);
    this.active = null;
    this.lifecycleState = this.queue.length > 0 ? 'queued' : 'idle';
    this.emitPresentation();
    this.onTranscriptChanged?.();
  }

  private dropActive(): void {
    if (!this.active) return;
    this.playbackGen++;
    this.voice.stop(this.playbackGen);
    this.active = null;
    this.lifecycleState = this.queue.length > 0 ? 'queued' : 'idle';
    this.emitPresentation();
  }

  private upsertTranscriptEntry(
    active: ActiveConversation,
    turn: DialogueTurn,
    role: CommunicationRole,
    voiced: boolean
  ): void {
    const key = `${this.sessionId}:${active.instanceId}:${active.turnIndex}`;
    const entry: TranscriptEntry = {
      key,
      sessionId: this.sessionId,
      instanceId: active.instanceId,
      conversationId: active.conversation.id,
      conversationTitle: active.conversation.title || active.conversation.id,
      turnIndex: active.turnIndex,
      speaker: turn.speaker,
      role,
      text: turn.text,
      gameTimeSec: this.lastKnownGameTime,
      voiced
    };

    const existingIdx = this.transcriptIndexByKey.get(key);
    if (existingIdx !== undefined) {
      this.transcript[existingIdx] = entry;
    } else {
      this.transcriptIndexByKey.set(key, this.transcript.length);
      this.transcript.push(entry);
    }
    this.onTranscriptChanged?.();
  }

  private emitPresentation(): void {
    this.onPresentationChanged?.(this.getPresentationState());
  }

  private loadPersistentState(): void {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (!raw) return;
      const parsed = JSON.parse(raw) as Partial<SavedNarrativeState>;
      if (Array.isArray(parsed.completedSaveIds)) {
        this.completedSaveIds = new Set(parsed.completedSaveIds);
      }
      if (Array.isArray(parsed.unlockedCodex)) {
        for (const item of parsed.unlockedCodex) {
          if (item?.id) this.unlockedCodex.set(item.id, item);
        }
      }
    } catch {
      // ignore
    }
  }

  private savePersistentState(): void {
    try {
      const data: SavedNarrativeState = {
        completedSaveIds: [...this.completedSaveIds],
        unlockedCodex: [...this.unlockedCodex.values()]
      };
      localStorage.setItem(STORAGE_KEY, JSON.stringify(data));
    } catch {
      // ignore
    }
  }
}

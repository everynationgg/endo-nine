import { HeroId } from '../sim/types';

export type SpeakerId = 'commander' | 'doctor' | 'overseer';

export type CommunicationRole = 'field_operative' | 'remote_support' | 'local_companion';

export type NarrativeCategory = 'essential' | 'contextual' | 'banter';

export type PersistenceScope = 'once_per_save' | 'once_per_run' | 'repeatable';

export type RetentionPolicy = 'stage_immediate' | 'stage_deferred' | 'run_deferred';

export type DialogueLifecycleState = 'idle' | 'queued' | 'playing' | 'suspended' | 'awaiting_modal_close';

export interface DialogueTurn {
  id: string;
  speaker: SpeakerId;
  text: string;
  audioUrl: string;
  durationSec: number;
  pauseAfterSec?: number;
  direction?: string;
  optionalOnResume?: boolean;
  unlocksObjectives?: boolean;
  requiresPreviousTurnId?: string;
}

export interface Conversation {
  id: string;
  title?: string;
  trigger: string;
  enabled?: boolean;

  category: NarrativeCategory;
  priority: 0 | 1 | 2 | 3;

  persistenceScope: PersistenceScope;
  retention: RetentionPolicy;

  ttlSec?: number;
  cooldownSec?: number;
  leadInSec?: number;
  resumable?: boolean;

  prerequisiteRule?: string;
  relevanceRule?: string;

  /** Flagged for designer review when shared lines still assume Commander is the field hero. */
  needsHeroVariantReview?: boolean;

  variants: Partial<Record<HeroId | 'default', DialogueTurn[]>>;

  onComplete?: {
    codexEntryId?: string;
    codexTitle?: string;
    codexSummary?: string;
    progressionFlag?: string;
  };
}

export interface DialogueManifest {
  version: string;
  stageNumber: number;
  conversations: Conversation[];
}

export interface TriggerContext {
  originStage: number;
  triggerId: string;
  facts: Record<string, string | number | boolean>;
}

export interface NarrativeSignal {
  triggerId: string;
  context: TriggerContext;
}

export interface PacingConfig {
  quietAfterEssentialSec: number;
  quietAfterContextualSec: number;
  quietAfterBanterSec: number;
  initialQuietSec: number;
  maxBanterPerStageRun: number;
  defaultPauseAfterTurnSec: number;
}

export interface TranscriptEntry {
  key: string;
  sessionId: number;
  instanceId: number;
  conversationId: string;
  conversationTitle: string;
  turnIndex: number;
  speaker: SpeakerId;
  role: CommunicationRole;
  text: string;
  gameTimeSec: number;
  voiced: boolean;
}

export interface UnlockedCodexLore {
  id: string;
  title: string;
  summary: string;
  unlockedAtIso: string;
}

export interface CommsPresentationState {
  visible: boolean;
  conversationId: string | null;
  conversationTitle: string | null;
  speaker: SpeakerId | null;
  speakerDisplayName: string;
  role: CommunicationRole | null;
  roleLabel: string;
  portraitUrl: string;
  text: string;
  isSubtitlesEnabled: boolean;
  isVoicedPlayback: boolean;
  lifecycleState: DialogueLifecycleState;
  turnIndex: number;
  turnCount: number;
}

export interface DevConversationSummary {
  id: string;
  title: string;
  trigger: string;
  category: NarrativeCategory;
  priority: number;
  enabled: boolean;
  hasCommanderVariant: boolean;
  hasDoctorVariant: boolean;
  hasDefaultVariant: boolean;
  needsHeroVariantReview: boolean;
}

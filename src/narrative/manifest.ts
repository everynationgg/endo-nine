import { Conversation, DialogueManifest, DialogueTurn, PacingConfig } from './types';
import { PREREQUISITE_REGISTRY, RELEVANCE_REGISTRY, isKnownRule } from './predicates';

export const DEFAULT_PACING_CONFIG: PacingConfig = {
  quietAfterEssentialSec: 22,
  quietAfterContextualSec: 12,
  quietAfterBanterSec: 32,
  initialQuietSec: 1.0,
  maxBanterPerStageRun: 3,
  defaultPauseAfterTurnSec: 0.32
};

export interface ManifestValidationResult {
  valid: boolean;
  errors: string[];
  warnings: string[];
}

function validateTurn(convId: string, variantKey: string, idx: number, turn: DialogueTurn, errors: string[]): void {
  if (!turn.id || typeof turn.id !== 'string') {
    errors.push(`[${convId}.${variantKey}[${idx}]] Missing turn id`);
  }
  if (turn.speaker !== 'commander' && turn.speaker !== 'doctor' && turn.speaker !== 'overseer') {
    errors.push(`[${convId}.${variantKey}[${idx}]] Invalid speaker "${String(turn.speaker)}"`);
  }
  if (!turn.text || typeof turn.text !== 'string') {
    errors.push(`[${convId}.${variantKey}[${idx}]] Missing subtitle text`);
  }
  if (!turn.audioUrl || typeof turn.audioUrl !== 'string') {
    errors.push(`[${convId}.${variantKey}[${idx}]] Missing audioUrl`);
  }
  if (typeof turn.durationSec !== 'number' || !Number.isFinite(turn.durationSec) || turn.durationSec <= 0) {
    errors.push(`[${convId}.${variantKey}[${idx}]] Invalid durationSec (${String(turn.durationSec)})`);
  }
}

export function validateDialogueManifest(manifest: DialogueManifest): ManifestValidationResult {
  const errors: string[] = [];
  const warnings: string[] = [];
  const seenIds = new Set<string>();

  if (!manifest || !Array.isArray(manifest.conversations)) {
    return {
      valid: false,
      errors: ['Manifest is missing a conversations array.'],
      warnings
    };
  }

  for (const conv of manifest.conversations) {
    if (!conv.id) {
      errors.push('Conversation missing id.');
      continue;
    }
    if (seenIds.has(conv.id)) {
      errors.push(`Duplicate conversation id "${conv.id}".`);
    }
    seenIds.add(conv.id);

    if (!conv.trigger) {
      errors.push(`[${conv.id}] Missing trigger.`);
    }

    if (conv.retention === 'run_deferred' && conv.ttlSec !== undefined) {
      warnings.push(`[${conv.id}] ttlSec is ignored for run_deferred conversations.`);
    }

    if (!isKnownRule(conv.prerequisiteRule, PREREQUISITE_REGISTRY)) {
      errors.push(`[${conv.id}] Unknown prerequisiteRule "${conv.prerequisiteRule}".`);
    }
    if (!isKnownRule(conv.relevanceRule, RELEVANCE_REGISTRY)) {
      errors.push(`[${conv.id}] Unknown relevanceRule "${conv.relevanceRule}".`);
    }

    const v = conv.variants || {};
    const hasDefault = Array.isArray(v.default) && v.default.length > 0;
    const hasCmd = Array.isArray(v.commander) && v.commander.length > 0;
    const hasDoc = Array.isArray(v.doctor) && v.doctor.length > 0;

    if (!hasDefault && !(hasCmd && hasDoc)) {
      errors.push(
        `[${conv.id}] Must provide either a non-empty "default" variant or both "commander" and "doctor" variants.`
      );
    }

    for (const [variantKey, turns] of Object.entries(v)) {
      if (!Array.isArray(turns)) continue;
      turns.forEach((turn, idx) => validateTurn(conv.id, variantKey, idx, turn, errors));
    }
  }

  return {
    valid: errors.length === 0,
    errors,
    warnings
  };
}

export async function loadDialogueManifest(url: string): Promise<DialogueManifest> {
  const res = await fetch(url, { cache: 'no-store' });
  if (!res.ok) {
    throw new Error(`Failed to fetch dialogue manifest (${res.status}) from ${url}`);
  }
  const manifest = (await res.json()) as DialogueManifest;
  const check = validateDialogueManifest(manifest);
  if (check.warnings.length > 0) {
    console.warn('[DialogueManifest] Validation warnings:', check.warnings);
  }
  if (!check.valid) {
    throw new Error(`[DialogueManifest] Validation errors:\n- ${check.errors.join('\n- ')}`);
  }
  return manifest;
}

export async function loadPacingConfig(url: string): Promise<PacingConfig> {
  try {
    const res = await fetch(url, { cache: 'no-store' });
    if (!res.ok) return { ...DEFAULT_PACING_CONFIG };
    const parsed = (await res.json()) as Partial<PacingConfig>;
    return { ...DEFAULT_PACING_CONFIG, ...parsed };
  } catch {
    return { ...DEFAULT_PACING_CONFIG };
  }
}

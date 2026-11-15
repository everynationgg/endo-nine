import { GameState } from '../sim/GameState';
import { TriggerContext } from './types';

export type NarrativePredicate = (
  state: GameState,
  ctx: TriggerContext,
  completedIds: ReadonlySet<string>
) => boolean;

export const PREREQUISITE_REGISTRY: Record<string, NarrativePredicate> = {
  always: () => true,
  is_stage_1: (state) => state.stageNumber === 1,
  not_test_map: (state) => !state.terrain.isCustomTestMap || state.terrain.allowTestMapNarrative,
  stage1_campaign_only: (state) =>
    state.stageNumber === 1 && (!state.terrain.isCustomTestMap || state.terrain.allowTestMapNarrative),
  hero_is_commander: (state) => state.player.heroId === 'commander',
  hero_is_doctor: (state) => state.player.heroId === 'doctor',
  boss_not_defeated: (state) => !state.artifact?.isBossDefeated,
  teleporter_charged_not_spawned: (state) =>
    Boolean(state.artifact?.isCharged && !state.artifact?.isBossSpawned && !state.artifact?.isBossDefeated)
};

export const RELEVANCE_REGISTRY: Record<string, NarrativePredicate> = {
  always: () => true,
  same_stage: (state, ctx) => state.stageNumber === ctx.originStage && !state.isStageCleared && !state.isGameOver,
  stage1_active: (state) => state.stageNumber === 1 && !state.isStageCleared && !state.isGameOver,
  before_boss_spawned: (state, ctx) =>
    state.stageNumber === ctx.originStage && !state.hasBossSpawned && !state.isStageCleared && !state.isGameOver,
  before_boss_defeated: (state, ctx) =>
    state.stageNumber === ctx.originStage &&
    !state.artifact?.isBossDefeated &&
    !state.isStageCleared &&
    !state.isGameOver,
  boss_active: (state, ctx) =>
    state.stageNumber === ctx.originStage &&
    !state.isGameOver &&
    (Boolean(ctx.facts?.devSimulated) ||
      Boolean((state.hasBossSpawned || state.artifact?.isBossSpawned) && !state.artifact?.isBossDefeated)),
  boss_defeated_before_exit: (state, ctx) =>
    state.stageNumber === ctx.originStage &&
    Boolean(state.artifact?.isBossDefeated) &&
    !state.isStageCleared &&
    !state.isGameOver,
  teleporter_ready_only: (state, ctx) =>
    state.stageNumber === ctx.originStage &&
    Boolean(state.artifact?.isCharged && !state.artifact?.isBossSpawned && !state.isGameOver),
  during_stage_clear: (state) => state.isStageCleared && !state.isGameOver
};

export function evaluateNamedRule(
  ruleName: string | undefined,
  registry: Record<string, NarrativePredicate>,
  state: GameState,
  ctx: TriggerContext,
  completedIds: ReadonlySet<string>,
  defaultResult: boolean = true
): boolean {
  if (!ruleName) return defaultResult;

  // Support compound rules joined by '&' and completed checks 'has_completed:<id>'
  const parts = ruleName.split('&').map((s) => s.trim()).filter(Boolean);
  for (const part of parts) {
    if (part.startsWith('has_completed:')) {
      const targetId = part.slice('has_completed:'.length).trim();
      if (!completedIds.has(targetId)) return false;
      continue;
    }
    const fn = registry[part];
    if (!fn) return false;
    if (!fn(state, ctx, completedIds)) return false;
  }
  return true;
}

export function isKnownRule(
  ruleName: string | undefined,
  registry: Record<string, NarrativePredicate>
): boolean {
  if (!ruleName) return true;
  const parts = ruleName.split('&').map((s) => s.trim()).filter(Boolean);
  for (const part of parts) {
    if (part.startsWith('has_completed:')) {
      if (part.slice('has_completed:'.length).trim().length === 0) return false;
      continue;
    }
    if (!registry[part]) return false;
  }
  return true;
}

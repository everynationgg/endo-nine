import type { WorldEventType } from './types';

/**
 * Authoritative Stage 1 enhancement event categories whose completion recovers
 * the Artifact Tower's scattered concealment modules.
 */
export const STAGE1_ENHANCEMENT_CATEGORIES = [
  'primal_totem',
  'secondary_totem',
  'dash_totem',
  'orbital_uplink'
] as const;

export type Stage1EnhancementCategory = (typeof STAGE1_ENHANCEMENT_CATEGORIES)[number];

export type ArtifactPhase =
  | 'locked_missing_modules'
  | 'charging'
  | 'unlocked_ready'
  | 'boss_summoning'
  | 'boss_active'
  | 'restoring'
  | 'exit_ready'
  | 'teleport_preparing'
  | 'cleared';

export interface StageArtifactPolicy {
  mode: 'four_enhancements' | 'charge_teleporter';
  requiredEnhancementCategories: readonly Stage1EnhancementCategory[];
  usesCharging: boolean;
  restorationDurationSec: number;
}

const STAGE1_POLICY: StageArtifactPolicy = {
  mode: 'four_enhancements',
  requiredEnhancementCategories: STAGE1_ENHANCEMENT_CATEGORIES,
  usesCharging: false,
  restorationDurationSec: 3.0
};

const DEFAULT_CHARGE_POLICY: StageArtifactPolicy = {
  mode: 'charge_teleporter',
  requiredEnhancementCategories: [],
  usesCharging: true,
  restorationDurationSec: 0
};

export function isStage1EnhancementCategory(type: WorldEventType | string): type is Stage1EnhancementCategory {
  return (STAGE1_ENHANCEMENT_CATEGORIES as readonly string[]).includes(type);
}

/**
 * Returns stage-specific artifact activation rules so Stage 1's 4-component concealment lock
 * stays decoupled from future stages that may use teleporter charging.
 */
export function getStageArtifactPolicy(stageNumber: number): StageArtifactPolicy {
  return stageNumber === 1 ? STAGE1_POLICY : DEFAULT_CHARGE_POLICY;
}

import { EnemyType } from './types';

export interface EnemyVisualDef {
  textureKey: string;
  fallbackKey: string;
  baseHeight: number;
  frameCount: number; // 1 for static PNG, >1 for horizontal strip
  fps: number;
  directional?: boolean; // Optional _front/_back/_left/_right suffix support
  hoverHeight: number; // 0 for ground units, >0 for flyers like wasp / Brood Queen
  hoverAmp: number;
  hoverFreq: number;
  shadowScale: number;
  hpWidth: number;
  hpHeight: number;
  hpYOffset: number;
  hpColor: number;
  hpBorderColor: number;
  auraColor?: number;
}

/**
 * Table-driven visual catalog mapping every standard and mini-boss enemy type
 * to its texture keys, aspect-preserving sizing, hover height, HP bar, and aura styling.
 */
export const ENEMY_VISUAL_CATALOG: Record<EnemyType, EnemyVisualDef> = {
  crawler: {
    textureKey: 'void_crawler',
    fallbackKey: 'enemy_crawler',
    baseHeight: 40,
    frameCount: 1,
    fps: 1,
    hoverHeight: 0,
    hoverAmp: 0,
    hoverFreq: 0,
    shadowScale: 1.0,
    hpWidth: 30,
    hpHeight: 4,
    hpYOffset: 46,
    hpColor: 0xef4444,
    hpBorderColor: 0x334155
  },
  spitter: {
    textureKey: 'toxic_spitter',
    fallbackKey: 'enemy_spitter',
    baseHeight: 44,
    frameCount: 1,
    fps: 1,
    hoverHeight: 0,
    hoverAmp: 0,
    hoverFreq: 0,
    shadowScale: 1.0,
    hpWidth: 34,
    hpHeight: 4,
    hpYOffset: 46,
    hpColor: 0x84cc16,
    hpBorderColor: 0x334155
  },
  wasp: {
    textureKey: 'void_wasp',
    fallbackKey: 'void_crawler',
    baseHeight: 38,
    frameCount: 1,
    fps: 1,
    hoverHeight: 24,
    hoverAmp: 3.5,
    hoverFreq: 3.0,
    shadowScale: 0.75,
    hpWidth: 30,
    hpHeight: 4,
    hpYOffset: 48,
    hpColor: 0xa855f7,
    hpBorderColor: 0x334155
  },
  elite: {
    textureKey: 'void_goliath',
    fallbackKey: 'enemy_elite',
    baseHeight: 64,
    frameCount: 1,
    fps: 1,
    hoverHeight: 0,
    hoverAmp: 0,
    hoverFreq: 0,
    shadowScale: 1.0,
    hpWidth: 46,
    hpHeight: 6,
    hpYOffset: 72,
    hpColor: 0x00e5ff,
    hpBorderColor: 0x38bdf8,
    auraColor: 0x00f0ff
  },
  boss: {
    textureKey: 'brood_overseer',
    fallbackKey: 'enemy_boss',
    baseHeight: 116,
    frameCount: 1,
    fps: 1,
    hoverHeight: 52,
    hoverAmp: 7.5,
    hoverFreq: 2.2,
    shadowScale: 1.5,
    hpWidth: 72,
    hpHeight: 8,
    hpYOffset: 122,
    hpColor: 0xf43f5e,
    hpBorderColor: 0xfbbf24,
    auraColor: 0xe11d48
  }
};

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
    baseHeight: 108,
    frameCount: 1,
    fps: 1,
    hoverHeight: 0,
    hoverAmp: 0,
    hoverFreq: 0,
    shadowScale: 1.15,
    hpWidth: 64,
    hpHeight: 6,
    hpYOffset: 116,
    hpColor: 0xef4444,
    hpBorderColor: 0x1e293b
  },
  spitter: {
    textureKey: 'toxic_spitter',
    fallbackKey: 'enemy_spitter',
    baseHeight: 128,
    frameCount: 1,
    fps: 1,
    hoverHeight: 0,
    hoverAmp: 0,
    hoverFreq: 0,
    shadowScale: 1.2,
    hpWidth: 72,
    hpHeight: 6,
    hpYOffset: 136,
    hpColor: 0x84cc16,
    hpBorderColor: 0x1e293b
  },
  wasp: {
    textureKey: 'void_wasp',
    fallbackKey: 'void_crawler',
    baseHeight: 116,
    frameCount: 1,
    fps: 1,
    hoverHeight: 62,
    hoverAmp: 8.0,
    hoverFreq: 3.4,
    shadowScale: 0.85,
    hpWidth: 64,
    hpHeight: 6,
    hpYOffset: 126,
    hpColor: 0xd946ef,
    hpBorderColor: 0x1e293b
  },
  elite: {
    textureKey: 'void_goliath',
    fallbackKey: 'enemy_elite',
    baseHeight: 216,
    frameCount: 1,
    fps: 1,
    hoverHeight: 0,
    hoverAmp: 0,
    hoverFreq: 0,
    shadowScale: 1.35,
    hpWidth: 96,
    hpHeight: 8,
    hpYOffset: 226,
    hpColor: 0xc084fc,
    hpBorderColor: 0x38bdf8,
    auraColor: 0xa855f7
  },
  boss: {
    textureKey: 'brood_overseer',
    fallbackKey: 'enemy_boss',
    baseHeight: 284,
    frameCount: 1,
    fps: 1,
    hoverHeight: 96,
    hoverAmp: 14.0,
    hoverFreq: 2.4,
    shadowScale: 1.6,
    hpWidth: 132,
    hpHeight: 10,
    hpYOffset: 296,
    hpColor: 0xf43f5e,
    hpBorderColor: 0xfbbf24,
    auraColor: 0xe11d48
  }
};

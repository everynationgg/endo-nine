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
    shadowScale: 1.25,
    hpWidth: 64,
    hpHeight: 6,
    hpYOffset: 106,
    hpColor: 0xe11d48,
    hpBorderColor: 0x1e293b
  },
  spitter: {
    textureKey: 'toxic_spitter',
    fallbackKey: 'enemy_spitter',
    baseHeight: 256,
    frameCount: 1,
    fps: 1,
    hoverHeight: 0,
    hoverAmp: 0,
    hoverFreq: 0,
    shadowScale: 1.35,
    hpWidth: 110,
    hpHeight: 8,
    hpYOffset: 248,
    hpColor: 0x84cc16,
    hpBorderColor: 0x1e293b
  },
  wasp: {
    textureKey: 'void_wasp',
    fallbackKey: 'void_crawler',
    baseHeight: 116,
    frameCount: 1,
    fps: 1,
    hoverHeight: 38,
    hoverAmp: 7.0,
    hoverFreq: 3.0,
    shadowScale: 0.95,
    hpWidth: 64,
    hpHeight: 6,
    hpYOffset: 130,
    hpColor: 0x38bdf8,
    hpBorderColor: 0x1e293b
  },
  elite: {
    textureKey: 'void_goliath',
    fallbackKey: 'enemy_elite',
    baseHeight: 432,
    frameCount: 1,
    fps: 1,
    hoverHeight: 0,
    hoverAmp: 0,
    hoverFreq: 0,
    shadowScale: 1.55,
    hpWidth: 128,
    hpHeight: 9,
    hpYOffset: 310,
    hpColor: 0xf97316,
    hpBorderColor: 0x38bdf8,
    auraColor: 0xf97316
  },
  boss: {
    textureKey: 'brood_overseer',
    fallbackKey: 'enemy_boss',
    baseHeight: 426,
    frameCount: 1,
    fps: 1,
    hoverHeight: 108,
    hoverAmp: 10.0,
    hoverFreq: 2.2,
    shadowScale: 1.65,
    hpWidth: 168,
    hpHeight: 11,
    hpYOffset: 360,
    hpColor: 0xf43f5e,
    hpBorderColor: 0xfbbf24,
    auraColor: 0xd946ef
  },
  broodling: {
    textureKey: 'brood_overseer',
    fallbackKey: 'enemy_boss',
    baseHeight: 123,
    frameCount: 1,
    fps: 1,
    hoverHeight: 36,
    hoverAmp: 5.0,
    hoverFreq: 4.5,
    shadowScale: 0.85,
    hpWidth: 62,
    hpHeight: 6,
    hpYOffset: 130,
    hpColor: 0xf43f5e,
    hpBorderColor: 0x1e293b
  }
};

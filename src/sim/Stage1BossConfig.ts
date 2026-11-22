/**
 * Stage 1 Main Boss (Titan Colossus / Ancient Biological Cultivator)
 * Canonical specifications, socket coordinates, animations, and attack mechanics.
 */

export interface BossSocketUV {
  u: number; // 0 (left) to 1 (right)
  v: number; // 0 (top) to 1 (bottom)
}

export type BossAnimName = 'walk' | 'laser' | 'tentacle' | 'elemental';
export type BossFacing = 'front' | 'back' | 'left' | 'right';

export interface BossSpriteEntry {
  file: string;
  frameCount: number;
  fps: number;
  frameWidth: number;
  frameHeight: number;
}

export const STAGE1_BOSS_CONFIG = {
  name: 'COLOSSAL BIO-CULTIVATOR',
  title: 'STAGE 1 TITAN',
  // 2x entity scaling (876W x 876H) matching 2x character & enemy scale without rescaling the map
  baseHeight: 876,
  baseWidth: 876,
  footOffset: 62,
  radius: 142,
  speed: 105, // Scaled for 2x entity stature & hero stride speed
  touchDamage: 40,
  maxHealth: 8000, // Stage 1 Boss HP
  attackCooldown: 1.63, // +35% attack speed (was 2.2s)
  initialCooldown: 1.67, // +35% attack speed (was 2.25s)
  postAttackPause: 0.33, // +35% faster recovery between attacks (was 0.45s)

  // Attack 1: Massive 80-unit Mouth Lightning Laser
  laser: {
    duration: 2.96, // +35% attack speed (was 4.0s sweep in simulation)
    thickness: 80, // Exactly 4x player width (~20 * 4 = 80)
    range: 950,
    sweepArcRad: Math.PI * 0.48, // ~86 degree sweeping arc
    damagePerTick: 20,
    tickInterval: 0.185, // +35% attack speed (was 0.25s)
    mouthSockets: {
      front: [
        { u: 0.495, v: 0.341 },
        { u: 0.508, v: 0.321 },
        { u: 0.508, v: 0.301 },
        { u: 0.505, v: 0.261 }
      ],
      left: [
        { u: 0.143, v: 0.438 },
        { u: 0.161, v: 0.325 },
        { u: 0.177, v: 0.201 },
        { u: 0.188, v: 0.233 }
      ],
      right: [
        { u: 0.857, v: 0.434 },
        { u: 0.833, v: 0.297 },
        { u: 0.810, v: 0.285 },
        { u: 0.796, v: 0.241 }
      ],
      back: [
        { u: 0.463, v: 0.221 },
        { u: 0.463, v: 0.181 },
        { u: 0.463, v: 0.161 },
        { u: 0.463, v: 0.141 }
      ]
    } as Record<string, BossSocketUV[]>
  },

  // Attack 2: Independent Long-Range Tentacle Strikes
  tentacle: {
    reach: 900,
    telegraphDuration: 0.48, // +35% attack speed (was 0.65s)
    lockDuration: 0.26,      // +35% attack speed (was 0.35s)
    strikeDuration: 0.30,    // +35% attack speed (was 0.40s)
    impactTime: 0.15,        // +35% attack speed (was 0.20s)
    retractDuration: 0.33,   // +35% attack speed (was 0.45s)
    damage: 55,
    strikeRadius: 85
  },

  // Attack 3: Ten Elemental Projectile Barrage
  elemental: {
    chargeDuration: 1.63, // +35% attack speed (was 2.2s in simulation)
    projectileCount: 10,
    speed: 810, // +35% faster projectile velocity (was 600 u/s)
    damage: 24,
    radius: 18,
    maxDistance: 1350,
    // 10 Tentacle tip normalized billboard offsets from center [-0.5..0.5]
    tentacleTipOffsets: [
      { x: 0.384, y: 0.246 },
      { x: 0.367, y: 0.003 },
      { x: 0.133, y: 0.039 },
      { x: -0.177, y: 0.072 },
      { x: -0.365, y: -0.008 },
      { x: -0.384, y: 0.227 },
      { x: -0.249, y: 0.387 },
      { x: -0.177, y: 0.425 },
      { x: -0.003, y: 0.149 },
      { x: 0.276, y: 0.403 }
    ]
  },

  // Animation assets & strip configurations (dimensions verified from boss_manifest.json)
  sprites: {
    walk: {
      front: { file: 'boss_walk_front.png', frameCount: 8, fps: 17.1, frameWidth: 443, frameHeight: 443 },
      back:  { file: 'boss_walk_back.png',  frameCount: 8, fps: 17.1, frameWidth: 443, frameHeight: 443 },
      left:  { file: 'boss_walk_left.png',  frameCount: 8, fps: 17.1, frameWidth: 440, frameHeight: 441 },
      right: { file: 'boss_walk_right.png', frameCount: 8, fps: 17.1, frameWidth: 443, frameHeight: 443 }
    },
    laser: {
      front: { file: 'boss_laser_front.png', frameCount: 4, fps: 5.4, frameWidth: 378, frameHeight: 249 },
      back:  { file: 'boss_laser_back.png',  frameCount: 4, fps: 5.4, frameWidth: 378, frameHeight: 249 },
      left:  { file: 'boss_laser_left.png',  frameCount: 4, fps: 5.4, frameWidth: 378, frameHeight: 249 },
      right: { file: 'boss_laser_right.png', frameCount: 4, fps: 5.4, frameWidth: 378, frameHeight: 249 }
    },
    tentacle: {
      front: { file: 'boss_tentacle_front.png', frameCount: 8, fps: 10.8, frameWidth: 512, frameHeight: 341 },
      back:  { file: 'boss_tentacle_back.png',  frameCount: 8, fps: 10.8, frameWidth: 418, frameHeight: 418 },
      left:  { file: 'boss_tentacle_left.png',  frameCount: 8, fps: 10.8, frameWidth: 416, frameHeight: 416 },
      right: { file: 'boss_tentacle_right.png', frameCount: 8, fps: 10.8, frameWidth: 418, frameHeight: 418 }
    },
    elemental: {
      front: { file: 'boss_elemental_front.png', frameCount: 12, fps: 7.4, frameWidth: 362, frameHeight: 362 },
      back:  { file: 'boss_elemental_back.png',  frameCount: 12, fps: 7.4, frameWidth: 364, frameHeight: 362 },
      left:  { file: 'boss_elemental_left.png',  frameCount: 12, fps: 7.4, frameWidth: 364, frameHeight: 362 },
      right: { file: 'boss_elemental_right.png', frameCount: 12, fps: 7.4, frameWidth: 362, frameHeight: 362 }
    }
  } as Record<BossAnimName, Record<BossFacing, BossSpriteEntry>>
};

/**
 * Centralized balance and visual tuning constants for Doctor's base abilities and 12 augments.
 * Adjust numbers here without touching ability logic in Simulation.ts.
 */
export const DOCTOR_CONFIG = {
  // Base LMB — Rapid Dual Pistols (~2x Commander's 0.65s baseline cadence)
  lmb: {
    cooldown: 0.33,
    baseDamage: 16,
    range: 500,
    projectileSpeed: 840,
    projectileRadius: 7,
    spreadAngleRad: 0.10
  },

  // LMB Augment 1 — Toxic Chain
  toxicChain: {
    cooldown: 0.36,
    baseDamage: 15,
    range: 520,
    projectileSpeed: 820,
    projectileRadius: 8,
    maxBounces: 3,
    bounceRadius: 210,
    bounceDamageFalloff: 0.85,
    stacksToExplode: 3,
    stackExpireDuration: 6.0,
    explosionRadius: 115,
    explosionDamage: 48,
    toxicDotDuration: 4.0,
    spreadAngleRad: 0.11
  },

  // LMB Augment 2 — Cryogenic Scalpel
  cryoScalpel: {
    cooldown: 0.62,
    baseDamage: 32,
    maxScalpels: 7,
    range: 430,
    outboundSpeed: 640,
    returnSpeed: 700,
    projectileRadius: 20,
    trailSpawnStepDist: 28,
    trailRadius: 34,
    trailDuration: 1.25,
    chillDuration: 2.5,
    maxActiveTrailSegments: 90,
    spreadAngleRad: 0.18
  },

  // LMB Augment 3 — Vital Extraction
  vitalExtraction: {
    baseTetherCount: 3,
    range: 390,
    tickInterval: 0.25,
    damagePerTick: 12,
    healFractionOfDamage: 0.35
  },

  // Base RMB — Toxic Grenade
  rmb: {
    cooldown: 4.0,
    baseDamage: 32,
    range: 480,
    throwSpeed: 420,
    detonationRadius: 115,
    puddleDuration: 5.0,
    puddleTickInterval: 0.45,
    puddleDamagePerTick: 11,
    slowDuration: 1.6,
    maxActiveToxicFields: 36,
    spreadAngleRad: 0.18
  },

  // RMB Augment 1 — Experimental Drones
  experimentalDrones: {
    baseDrones: 1,
    maxDrones: 7,
    cooldownVolley: 4.0,
    orbitRadius: 68,
    hoverHeight: 38,
    targetRange: 440,
    fireInterval: 0.68,
    boltDamage: 16,
    boltSpeed: 760
  },

  // RMB Augment 2 — Toxic Cluster Bomb
  toxicClusterBomb: {
    cooldown: 4.6,
    baseMainBombs: 1,
    maxMainBombs: 5,
    subBombsPerMainBomb: 5,
    mainDamage: 36,
    subDamage: 24,
    scatterMinRadius: 72,
    scatterMaxRadius: 185,
    subPuddleRadius: 72,
    subPuddleDuration: 4.0,
    subPuddleTickInterval: 0.5,
    subPuddleDamagePerTick: 8
  },

  // RMB Augment 3 — Holographic Decoy
  holographicDecoy: {
    cooldown: 5.5,
    baseDecoys: 1,
    spawnOffset: 38,
    runSpeed: 175,
    hitsToDestroy: 2,
    throwRange: 280,
    decoyHealth: 180,
    duration: 6.0,
    tauntRadius: 350,
    explosionRadius: 125,
    explosionDamage: 52,
    puddleRadius: 110,
    puddleDuration: 4.5,
    maxActiveDecoys: 12
  },

  // Dash — Therapeutic Pass (1.5x normal Commander distance)
  therapeuticPass: {
    cooldown: 4.0,
    commanderDistanceFactor: 1.5, // 1.5x Commander dash distance (230*3.2*0.22 = 161.92 -> 242.88)
    duration: 0.26,
    enemyDamage: 48,
    allyHeal: 32,
    selfHeal: 24,
    sweepHitRadius: 34,
    afterimageCount: 6
  },

  // Dash Augments
  phaseBarrier: {
    postDashImmunityDuration: 1.0
  },
  adrenalineRush: {
    duration: 1.5,
    moveSpeedMultiplier: 1.5
  },

  // Ultimate Base — Sacred Medical Field (5s stationary cross)
  sacredField: {
    cooldown: 13.0,
    castAnimDuration: 0.80,
    castAnimFps: 10,
    duration: 5.0,
    armHalfLength: 230,
    armHalfWidth: 74,
    healPerSecond: 26,
    pulseDamage: 32,
    pulseInterval: 0.5,
    allyDamageMult: 1.30,
    allyAttackSpeedMult: 1.30
  },

  // Ultimate Augment 1 — Mobile Sanctuary
  mobileSanctuary: {
    duration: 5.0,
    rotationSpeedRad: 3.4,
    armHalfLength: 240,
    armHalfWidth: 76
  },

  // Ultimate Augment 2 — Divine Intervention
  divineIntervention: {
    crossDuration: 3.0,
    angelDuration: 10.0,
    angelCount: 4,
    quadrantOffsetDist: 130,
    hoverHeight: 46,
    targetRange: 480,
    fireInterval: 0.72,
    boltDamage: 28,
    boltSpeed: 740
  },

  // Ultimate Augment 3 — Rain of Crosses
  rainOfCrosses: {
    duration: 5.0,
    spawnInterval: 0.36,
    baseCrossesPerWave: 2,
    maxSpawnRadius: 260,
    fallStartHeight: 240,
    fallSpeed: 620,
    impactRadius: 88,
    impactDamage: 44,
    groundCrossHalfLength: 68,
    groundCrossHalfWidth: 26,
    groundFieldPulseDamage: 16,
    groundFieldHealPerSecond: 14,
    groundFieldPulseInterval: 0.5
  }
} as const;

/**
 * Centralized balance and visual tuning constants for Doctor's base abilities and 12 augments.
 * Adjust numbers here without touching ability logic in Simulation.ts.
 */
export const DOCTOR_CONFIG = {
  // Base LMB — Rapid Dual Pistols (~2x Commander's 0.65s baseline cadence)
  lmb: {
    cooldown: 0.33,
    baseDamage: 7,
    range: 960,
    projectileSpeed: 1350,
    projectileRadius: 14,
    spreadAngleRad: 0.10
  },

  // LMB Augment 1 — Toxic Chain
  toxicChain: {
    cooldown: 0.36,
    baseDamage: 15,
    range: 980,
    projectileSpeed: 1320,
    projectileRadius: 16,
    maxBounces: 3,
    bounceRadius: 400,
    bounceDamageFalloff: 0.85,
    stacksToExplode: 3,
    stackExpireDuration: 6.0,
    explosionRadius: 220,
    explosionDamage: 48,
    toxicDotDuration: 4.0,
    spreadAngleRad: 0.11
  },

  // LMB Augment 2 — Cryogenic Scalpel
  cryoScalpel: {
    cooldown: 0.62,
    baseDamage: 32,
    maxScalpels: 7,
    range: 820,
    outboundSpeed: 1080,
    returnSpeed: 1180,
    projectileRadius: 40,
    trailSpawnStepDist: 56,
    trailRadius: 68,
    trailDuration: 1.25,
    chillDuration: 2.5,
    maxActiveTrailSegments: 90,
    spreadAngleRad: 0.18
  },

  // LMB Augment 3 — Vital Extraction
  vitalExtraction: {
    baseTetherCount: 3,
    range: 760,
    tickInterval: 0.25,
    damagePerTick: 12,
    healFractionOfDamage: 0.35
  },

  // Base RMB — Toxic Grenade
  rmb: {
    cooldown: 4.0,
    baseDamage: 32,
    range: 920,
    throwSpeed: 720,
    detonationRadius: 220,
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
    orbitRadius: 142,
    hoverHeight: 84,
    targetRange: 860,
    fireInterval: 0.68,
    boltDamage: 16,
    boltSpeed: 1250
  },

  // RMB Augment 2 — Toxic Cluster Bomb
  toxicClusterBomb: {
    cooldown: 4.6,
    baseMainBombs: 1,
    maxMainBombs: 5,
    subBombsPerMainBomb: 5,
    mainDamage: 36,
    subDamage: 24,
    scatterMinRadius: 144,
    scatterMaxRadius: 360,
    subPuddleRadius: 144,
    subPuddleDuration: 4.0,
    subPuddleTickInterval: 0.5,
    subPuddleDamagePerTick: 8
  },

  // RMB Augment 3 — Holographic Decoy
  holographicDecoy: {
    cooldown: 5.5,
    baseDecoys: 1,
    spawnOffset: 76,
    runSpeed: 380,
    hitsToDestroy: 2,
    throwRange: 520,
    decoyHealth: 180,
    duration: 6.0,
    tauntRadius: 660,
    explosionRadius: 240,
    explosionDamage: 52,
    puddleRadius: 210,
    puddleDuration: 4.5,
    maxActiveDecoys: 12
  },

  // Dash — Therapeutic Pass (1.5x normal Commander distance)
  therapeuticPass: {
    cooldown: 4.0,
    commanderDistanceFactor: 1.5, // 1.5x Commander dash distance (scaled with 2x entity size)
    duration: 0.26,
    enemyDamage: 48,
    allyHeal: 32,
    selfHeal: 24,
    sweepHitRadius: 72,
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
    armHalfLength: 440,
    armHalfWidth: 144,
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
    armHalfLength: 460,
    armHalfWidth: 148
  },

  // Ultimate Augment 2 — Divine Intervention
  divineIntervention: {
    crossDuration: 3.0,
    angelDuration: 10.0,
    angelCount: 4,
    quadrantOffsetDist: 250,
    hoverHeight: 96,
    targetRange: 920,
    fireInterval: 0.72,
    boltDamage: 28,
    boltSpeed: 1220
  },

  // Ultimate Augment 3 — Rain of Crosses
  rainOfCrosses: {
    duration: 5.0,
    spawnInterval: 0.36,
    baseCrossesPerWave: 2,
    maxSpawnRadius: 480,
    fallStartHeight: 440,
    fallSpeed: 1050,
    impactRadius: 172,
    impactDamage: 44,
    groundCrossHalfLength: 136,
    groundCrossHalfWidth: 52,
    groundFieldPulseDamage: 16,
    groundFieldHealPerSecond: 14,
    groundFieldPulseInterval: 0.5
  }
} as const;

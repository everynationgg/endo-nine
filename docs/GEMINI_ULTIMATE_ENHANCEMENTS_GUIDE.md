# GEMINI 3.8 EXECUTION GUIDE: Skill Enhancement System & Orbital Strike Upgrades

> **Target Executor:** Gemini 3.8
> **Scope:** Modular Skill Enhancement Architecture (`Base Ability + Selected Enhancement = Upgraded Ability`) applied to **Commander's Ultimate (`Orbital Strike`) ONLY**
> **Reference Images:**
> 1. **Enhancement A — Singularity (`Orbital Strike — Singularity`):** `C:/Users/yoggn/.gemini/antigravity/brain/4542810e-1e49-4a7e-a79b-951bef007a82/.user_uploaded/media_1794093699553_ac26f023.jpg`
> 2. **Enhancement B — Five-Strike Convergence (`Orbital Strike — Convergence Barrage`):** `C:/Users/yoggn/.gemini/antigravity/brain/4542810e-1e49-4a7e-a79b-951bef007a82/.user_uploaded/media_1794093699610_7fbc8ca2.jpg`
> 3. **Enhancement C — Freezing (`Orbital Strike — Cryogenic Impact`):** `C:/Users/yoggn/.gemini/antigravity/brain/4542810e-1e49-4a7e-a79b-951bef007a82/.user_uploaded/media_1794093699597_401bb0eb.jpg`

---

## 0. Strict Architectural & Design Guardrails

1. **Additive Enhancement Model (`Base Ability + Enhancement`):**
   - Selecting an Ultimate upgrade must **never replace** `p.equippedSkills.ultimate.id` (`'orbital_judgment'`).
   - Instead, `p.skillEnhancements.ultimate` stores `'singularity' | 'convergence_barrage' | 'cryogenic_impact'`, while `p.equippedSkills.ultimate` keeps `id: 'orbital_judgment'`, `cooldown: 11.0`, `baseDamage: 240`, and updates its display `name`, `description`, and `icon` to reflect the active augmentation.
2. **Preserve Base Orbital Strike:**
   - Unenhanced Orbital Strike (`p.skillEnhancements.ultimate === undefined`) must behave and render **identically** to the approved implementation (`strikeDelay = 0.40s`, `radius = 260 * ultimateRadiusMultiplier`, `baseDamage = 240`, `~2.2s` lingering ground aftermath, centered at Commander's activation position).
   - Every enhanced Orbital Strike **begins with the recognizable golden-white Orbital Strike beam and impact** at Commander's cast position (`targetPos`), which remains fixed in world space if Commander moves afterward.
3. **Strict Scope:**
   - Modify **only** the skill-enhancement state architecture and Commander's three Ultimate enhancements (`Singularity`, `Convergence Barrage`, `Cryogenic Impact`).
   - Do **not** modify LMB (`Gold Blaster Bolt`), RMB (`Twin Converging Slashes`), Dash (`Kinetic Impact`), or Doctor's skills.

---

## STEP 1: Add Modular Skill Enhancement State & Types (`src/sim/types.ts` & `src/sim/GameState.ts`)

### 1A. Update `src/sim/types.ts`

1. In `src/sim/types.ts` (around lines 74–86), add `SkillEnhancementId` and optional `enhancesSkillSlot` / `enhancementId` fields on `BuffDef`:

```ts
export type SkillEnhancementId =
  | 'singularity'
  | 'convergence_barrage'
  | 'cryogenic_impact';

export interface BuffDef {
  id: BuffId;
  name: string;
  category: string;
  description: string;
  icon: string;
  accentColor: string;
  linkedItemId?: ItemId;
  replacesSkillSlot?: SkillSlot;
  replacementSkillId?: string;
  enhancesSkillSlot?: SkillSlot;
  enhancementId?: SkillEnhancementId;
  exclusiveEvent?: 'basic_skill_totem' | 'ultimate_beacon' | 'void_corruption';
  applyStack: (stats: CalculatedStats, stackCount: number) => void;
}
```

2. In `src/sim/types.ts` (around lines 200–210), add `skillEnhancements` to `PlayerState`:

```ts
  // Energy Shield & Active Equipped Skills
  energyShield: number;
  maxEnergyShield: number;
  beamChargeTimer?: number;
  beamTargetPos?: Vector2 | null;
  equippedSkills: {
    primary: SkillDef;
    secondary: SkillDef;
    utility: SkillDef;
    ultimate: SkillDef;
  };
  skillEnhancements: Partial<Record<SkillSlot, SkillEnhancementId>>;
}
```

3. In `src/sim/types.ts` (around lines 310–321), extend `OrbitalStrikeState` with `enhancement`, `subStrikes`, and `hitEnemyIds`:

```ts
export interface OrbitalStrikeState {
  id: string;
  targetPos: Vector2;
  delayRemaining: number;
  radius: number;
  damage: number;
  hasStruck: boolean;
  durationRemaining: number;
  variant?: 'judgment' | 'nuke' | 'lance' | 'singularity' | 'chrono';
  enhancement?: SkillEnhancementId;
  subStrikes?: Vector2[];
  hitEnemyIds?: Set<string>;
  dotTimer?: number;
  hasExploded?: boolean;
}
```

4. In `src/sim/types.ts` (around lines 447–492), add the new Ultimate Enhancement VFX event types to `SimEvent['type']`:

```ts
    | 'ultimate_fired'
    | 'ultimate_singularity_spawned'
    | 'ultimate_singularity_detonated'
    | 'ultimate_convergence_started'
    | 'ultimate_convergence_detonated'
    | 'ultimate_cryo_field_spawned'
    | 'orbital_impact'
```

### 1B. Update `src/sim/GameState.ts`

In `src/sim/GameState.ts`:
1. In the constructor (around line 142), initialize `skillEnhancements: {}` on `this.player`:
```ts
      beamChargeTimer: 0,
      beamTargetPos: null,
      equippedSkills: heroId === 'doctor' ? { ...DOCTOR_DEFAULT_SKILLS } : { ...COMMANDER_DEFAULT_SKILLS },
      skillEnhancements: {}
    };
```
2. In `selectHero(heroId: HeroId)` (around line 173), reset `this.player.skillEnhancements = {}` and clone the default skill definitions so mutated display names/icons never leak across runs:
```ts
    this.player.equippedSkills = heroId === 'doctor'
      ? {
          primary: { ...DOCTOR_DEFAULT_SKILLS.primary },
          secondary: { ...DOCTOR_DEFAULT_SKILLS.secondary },
          utility: { ...DOCTOR_DEFAULT_SKILLS.utility },
          ultimate: { ...DOCTOR_DEFAULT_SKILLS.ultimate }
        }
      : {
          primary: { ...COMMANDER_DEFAULT_SKILLS.primary },
          secondary: { ...COMMANDER_DEFAULT_SKILLS.secondary },
          utility: { ...COMMANDER_DEFAULT_SKILLS.utility },
          ultimate: { ...COMMANDER_DEFAULT_SKILLS.ultimate }
        };
    this.player.skillEnhancements = {};
```

---

## STEP 2: Convert `ultimate_beacon` Event Rewards to Modular Enhancements (`src/sim/ItemDefs.ts`)

In `src/sim/ItemDefs.ts` (lines 578–635), update the `ultimate_beacon` buff entries so that the 3 event rewards augment `Orbital Strike` (`enhancesSkillSlot: 'ultimate'`) instead of replacing it (`replacesSkillSlot`), and remove `exclusiveEvent: 'ultimate_beacon'` from `buff_skill_orbital_lance` so `rollThreeBuffChoices(rng, 'ultimate_beacon')` always presents the exact 3 Ultimate Enhancements (**Singularity**, **Convergence Barrage**, and **Cryogenic Impact**):

```ts
  // --- EXCLUSIVE EVENT: ULTIMATE SKILL ENHANCEMENTS (Celestial Uplink) ---
  buff_skill_singularity: {
    id: 'buff_skill_singularity',
    name: 'Orbital Strike — Singularity',
    category: '★ ULTIMATE ENHANCEMENT',
    description: 'Augments Orbital Strike: After the orbital beam impacts, forms a massive Black Hole that pulls enemies and debris inward for 3.0s before collapsing in a devastating void explosion.',
    icon: '/assets/overseer_artifact.png',
    accentColor: '#a855f7',
    enhancesSkillSlot: 'ultimate',
    enhancementId: 'singularity',
    exclusiveEvent: 'ultimate_beacon',
    applyStack: () => {}
  },
  buff_skill_nuke: {
    id: 'buff_skill_nuke',
    name: 'Orbital Strike — Convergence Barrage',
    category: '★ ULTIMATE ENHANCEMENT',
    description: 'Augments Orbital Strike: Calls five simultaneous orbital beams (1 center + 4 in a balanced ring), then spirals all impact energy inward into a concentrated golden core that detonates with massive force.',
    icon: '/assets/tactical_strike.png',
    accentColor: '#fbbf24',
    enhancesSkillSlot: 'ultimate',
    enhancementId: 'convergence_barrage',
    exclusiveEvent: 'ultimate_beacon',
    applyStack: () => {}
  },
  buff_skill_chrono_stasis: {
    id: 'buff_skill_chrono_stasis',
    name: 'Orbital Strike — Cryogenic Impact',
    category: '★ ULTIMATE ENHANCEMENT',
    description: 'Augments Orbital Strike: After the orbital beam impacts, expands a large crystalline freezing field for 4.0s that Freezes enemies in place and deals continuous cryogenic damage over time.',
    icon: '/assets/cooldown_reduction.png',
    accentColor: '#38bdf8',
    enhancesSkillSlot: 'ultimate',
    enhancementId: 'cryogenic_impact',
    exclusiveEvent: 'ultimate_beacon',
    applyStack: () => {}
  },
  buff_skill_orbital_lance: {
    id: 'buff_skill_orbital_lance',
    name: 'ULTIMATE: Cataclysmic Lance',
    category: '★ ULTIMATE EVOLUTION',
    description: 'Legacy Orbital Lance prototype.',
    icon: '/assets/critical_damage.png',
    accentColor: '#f59e0b',
    applyStack: () => {}
  },
```

Also in `rollThreeBuffChoices` in `src/sim/ItemDefs.ts` (around line 742), make sure the pool filter checks `(b.replacesSkillSlot || b.enhancesSkillSlot)` cleanly so enhanced skills are never filtered out prematurely:
- Check lines 735–755 of `src/sim/ItemDefs.ts` — `rollThreeBuffChoices` filters by `b.exclusiveEvent === eventFilter` when `eventFilter` is provided, and `!b.exclusiveEvent` otherwise. With exactly 3 buffs having `exclusiveEvent: 'ultimate_beacon'`, `rollThreeBuffChoices(rng, 'ultimate_beacon')` will deterministically return all 3 Ultimate Enhancements!

---

## STEP 3: Implement Augmented Orbital Strike Simulation Logic (`src/sim/Simulation.ts`)

### 3A. Handle `enhancesSkillSlot` in `selectBuffChoice` (`src/sim/Simulation.ts`, lines 274–290)

In `Simulation.selectBuffChoice(buffId: BuffId)`, right after the `if (def && def.replacesSkillSlot && def.replacementSkillId)` block, add handling for `def.enhancesSkillSlot && def.enhancementId`:

```ts
    // If this buff augments an existing skill slot without replacing its base identity
    if (def && def.enhancesSkillSlot && def.enhancementId) {
      if (!p.skillEnhancements) {
        p.skillEnhancements = {};
      }
      p.skillEnhancements[def.enhancesSkillSlot] = def.enhancementId;

      // Preserve the base skill's id, cooldown, and baseDamage while updating HUD metadata
      const baseSkill = p.equippedSkills[def.enhancesSkillSlot];
      if (baseSkill) {
        p.equippedSkills[def.enhancesSkillSlot] = {
          ...baseSkill,
          name: def.name,
          description: def.description,
          icon: def.icon || baseSkill.icon
        };
      }
    }
```

### 3B. Update `fireOrbitalJudgment(targetPos: Vector2)` (`src/sim/Simulation.ts`, lines 1990–2028)

Replace `fireOrbitalJudgment` so it reads `const enhancement = p.skillEnhancements?.ultimate;` and configures the strike and its post-impact phase while always preserving the base Orbital Strike parameters (`strikeDelay = 0.40`, `radius = Math.round(260 * p.calculatedStats.ultimateRadiusMultiplier)`, `damage = p.equippedSkills.ultimate.baseDamage * p.calculatedStats.damageMultiplier`, fixed at Commander's cast position `targetPos`):

```ts
  private fireOrbitalJudgment(targetPos: Vector2): void {
    const p = this.state.player;
    // Massive ground shockwave radius (260 base, scaling with Orbital Capacitor buff)
    const expandedRadius = Math.round(260 * p.calculatedStats.ultimateRadiusMultiplier);
    const enhancement = p.skillEnhancements?.ultimate;

    // 6-frame Ultimate cast sequence at 10 FPS (0.60s total):
    // Frame 4 (0.40s): Downward Command -> Orbital Strike Impact & Damage!
    const strikeDelay = 0.40;
    const lockedPos: Vector2 = { x: targetPos.x, y: targetPos.y };

    let durationRemaining = 0.65;
    let dotTimer: number | undefined = undefined;
    let subStrikes: Vector2[] | undefined = undefined;

    if (enhancement === 'singularity') {
      // Phase 2 lasts exactly 3.0s after impact before Phase 3 gravitational collapse
      durationRemaining = 3.0;
      dotTimer = 0.25;
    } else if (enhancement === 'convergence_barrage') {
      // 4 balanced outer orbital strikes in a symmetric ring around the central strike
      const ringDist = Math.round(175 * p.calculatedStats.ultimateRadiusMultiplier);
      const angles = [Math.PI * 0.25, Math.PI * 0.75, Math.PI * 1.25, Math.PI * 1.75];
      subStrikes = angles.map((ang) => ({
        x: lockedPos.x + Math.cos(ang) * ringDist,
        y: lockedPos.y + Math.sin(ang) * ringDist
      }));
      // Phase 2 inward spiral convergence lasts 0.95s after the 5 simultaneous impacts, then detonates
      durationRemaining = 0.95;
    } else if (enhancement === 'cryogenic_impact') {
      // Phase 2 & 3 freezing field persists for 4.0s after impact with 0.50s frost DoT ticks
      durationRemaining = 4.0;
      dotTimer = 0.50;
    }

    const strike: OrbitalStrikeState = {
      id: `strike_${this.nextStrikeId++}`,
      targetPos: lockedPos,
      delayRemaining: strikeDelay,
      radius: expandedRadius,
      damage: p.equippedSkills.ultimate.baseDamage * p.calculatedStats.damageMultiplier,
      hasStruck: false,
      durationRemaining,
      variant: 'judgment',
      enhancement,
      subStrikes,
      hitEnemyIds: new Set<string>(),
      dotTimer,
      hasExploded: false
    };

    this.state.orbitalStrikes.push(strike);
    this.state.events.push({
      type: 'ultimate_fired',
      data: {
        target: lockedPos,
        pos: lockedPos,
        radius: expandedRadius,
        variant: 'judgment',
        enhancement,
        subStrikes,
        facing: p.facing,
        duration: 0.60,
        fps: 10,
        strikeDelay
      }
    });
  }
```

### 3C. Update `updateOrbitalStrikes(dt: number)` (`src/sim/Simulation.ts`, lines 2381–2519)

Replace `updateOrbitalStrikes(dt: number)` with the complete multi-phase implementation supporting:
1. **Unenhanced Base Orbital Strike (`!s.enhancement`):** Standard `240` base damage at `t = 0.40s` + radial shockwave knockback.
2. **Enhancement A (`s.enhancement === 'singularity'`):**
   - **Phase 1 (`t = 0.40s`):** Standard Orbital Strike beam impact and `s.damage` AoE damage at `s.targetPos`, followed immediately by `ultimate_singularity_spawned` (`pullRadius = Math.round(s.radius * 1.38)` ~ `360` units, `duration = 3.0s`).
   - **Phase 2 (`3.0s` duration):** Pulls enemies within `pullRadius` toward `s.targetPos` while respecting elevation (`|enemy.z - strikeZ| <= 65`) and terrain collision (`this.state.terrain.checkTraversable(enemy.pos, nextPos, enemy.z, false)`), plus periodic void DoT (`s.damage * 0.12` every `0.25s`).
   - **Phase 3 (at `3.0s` expiration):** Gravitational collapse explosion (`blastRadius = Math.round(s.radius * 1.38)`, `s.damage * 1.50` void damage, outward shockwave impulse `520`), releases enemies from pull (`enemy.isStunned = false; enemy.stunTimer = 0;`), and emits `ultimate_singularity_detonated`.
3. **Enhancement B (`s.enhancement === 'convergence_barrage'`):**
   - **Phase 1 (`t = 0.40s`):** All **5 orbital beams** (1 center at `s.targetPos` + 4 outer ring strikes at `s.subStrikes`) impact simultaneously. Enemies in the center blast (`s.radius`) or any of the 4 outer blasts (`subRadius = Math.round(s.radius * 0.68)`) take initial Orbital Strike damage (`s.damage`, deduplicated via `s.hitEnemyIds` so no enemy takes unfair double-frame damage on initial impact). Emits `damage_dealt` (`isOrbitalBlast: true`, `enhancement: 'convergence_barrage'`, `subStrikes: s.subStrikes`) and `ultimate_convergence_started`.
   - **Phase 2 (`0.95s` duration):** As the 4 outer energy streams spiral inward toward `s.targetPos`, enemies within `convRadius = Math.round(s.radius * 1.35)` on the same elevation (`|enemy.z - strikeZ| <= 65`) are pulled smoothly toward `s.targetPos` respecting `this.state.terrain.checkTraversable`.
   - **Phase 3 (at `0.95s` expiration):** The concentrated central golden core detonates at `s.targetPos` (`blastRadius = Math.round(s.radius * 1.20)`, `s.damage * 1.45` bonus AoE damage, outward shockwave impulse `500`), emitting `ultimate_convergence_detonated`.
4. **Enhancement C (`s.enhancement === 'cryogenic_impact'`):**
   - **Phase 1 (`t = 0.40s`):** Standard Orbital Strike beam impact and `s.damage` AoE damage at `s.targetPos`, followed immediately by `ultimate_cryo_field_spawned` (`cryoRadius = Math.round(s.radius * 1.25)` ~ `325` units, `duration = 4.0s`).
   - **Phase 2 & 3 (`4.0s` duration):** Enemies inside `cryoRadius` (`|enemy.z - strikeZ| <= 65`) are Frozen/Stunned (`enemy.isStunned = true; enemy.stunTimer = Math.max(enemy.stunTimer ?? 0, 0.65); enemy.isChilled = true; enemy.chillTimer = Math.max(enemy.chillTimer ?? 0, 1.5); enemy.velocity.x = 0; enemy.velocity.y = 0;`) and take continuous cryogenic DoT every `0.50s` (`s.damage * 0.15` with `'frost'` element). When the `4.0s` field expires, the short `0.65s` stun naturally clears so no enemy is permanently trapped.

Here is the exact replacement for `updateOrbitalStrikes(dt: number)` in `src/sim/Simulation.ts`:

```ts
  private updateOrbitalStrikes(dt: number): void {
    const alive: OrbitalStrikeState[] = [];

    for (let i = 0; i < this.state.orbitalStrikes.length; i++) {
      const s = this.state.orbitalStrikes[i];
      const strikeZ = this.state.terrain.getElevation(s.targetPos.x, s.targetPos.y).height;

      if (!s.hasStruck) {
        s.delayRemaining -= dt;
        if (s.delayRemaining <= 0) {
          s.hasStruck = true;
          const hitSet = s.hitEnemyIds || new Set<string>();
          s.hitEnemyIds = hitSet;

          // 1. Primary center Orbital Strike impact damage
          const victims = this.spatialGrid.getNearby(s.targetPos, s.radius);
          for (let v = 0; v < victims.length; v++) {
            const enemy = victims[v];
            if (enemy.health > 0 && !hitSet.has(enemy.id)) {
              hitSet.add(enemy.id);
              this.damageEnemy(enemy, s.damage, s.targetPos);

              if (s.enhancement === 'singularity' || s.enhancement === 'convergence_barrage') {
                // Pull-based enhancements draw enemies inward rather than knocking them out of the zone
                enemy.velocity.x *= 0.25;
                enemy.velocity.y *= 0.25;
                enemy.attackCooldownRemaining = Math.max(enemy.attackCooldownRemaining, 0.9);
              } else if (s.enhancement === 'cryogenic_impact') {
                // Immediately freeze enemies hit by the initial impact
                enemy.isStunned = true;
                enemy.stunTimer = Math.max(enemy.stunTimer ?? 0, 0.75);
                enemy.isChilled = true;
                enemy.chillTimer = Math.max(enemy.chillTimer ?? 0, 2.0);
                enemy.velocity.x = 0;
                enemy.velocity.y = 0;
              } else {
                // Base Orbital Strike: radial shockwave knockback away from the blast center
                const kdx = enemy.pos.x - s.targetPos.x;
                const kdy = enemy.pos.y - s.targetPos.y;
                const klen = Math.hypot(kdx, kdy) || 1;
                const pushForce = 380 * (1 - Math.min(0.75, klen / s.radius));
                enemy.velocity.x += (kdx / klen) * pushForce;
                enemy.velocity.y += (kdy / klen) * pushForce;
                enemy.attackCooldownRemaining = Math.max(enemy.attackCooldownRemaining, 0.85);
              }
            }
          }

          // 2. If Convergence Barrage is active, also apply simultaneous impact across the 4 outer strikes
          if (s.enhancement === 'convergence_barrage' && s.subStrikes) {
            const subRadius = Math.round(s.radius * 0.68);
            for (let b = 0; b < s.subStrikes.length; b++) {
              const subPos = s.subStrikes[b];
              const subVictims = this.spatialGrid.getNearby(subPos, subRadius);
              for (let v = 0; v < subVictims.length; v++) {
                const enemy = subVictims[v];
                if (enemy.health > 0 && !hitSet.has(enemy.id)) {
                  hitSet.add(enemy.id);
                  this.damageEnemy(enemy, s.damage, subPos);
                  enemy.velocity.x *= 0.25;
                  enemy.velocity.y *= 0.25;
                  enemy.attackCooldownRemaining = Math.max(enemy.attackCooldownRemaining, 0.9);
                }
              }
            }
          }

          // Emit base Orbital Strike impact event
          this.state.events.push({
            type: 'damage_dealt',
            data: {
              isOrbitalBlast: true,
              pos: s.targetPos,
              radius: s.radius,
              elevation: strikeZ,
              variant: s.variant || 'judgment',
              enhancement: s.enhancement,
              subStrikes: s.subStrikes
            }
          });

          // Emit enhancement-specific Phase 2 start event
          if (s.enhancement === 'singularity') {
            this.state.events.push({
              type: 'ultimate_singularity_spawned',
              data: {
                pos: s.targetPos,
                radius: Math.round(s.radius * 1.38),
                elevation: strikeZ,
                duration: s.durationRemaining
              }
            });
          } else if (s.enhancement === 'convergence_barrage' && s.subStrikes) {
            this.state.events.push({
              type: 'ultimate_convergence_started',
              data: {
                pos: s.targetPos,
                subStrikes: s.subStrikes,
                radius: s.radius,
                elevation: strikeZ,
                duration: s.durationRemaining
              }
            });
          } else if (s.enhancement === 'cryogenic_impact') {
            this.state.events.push({
              type: 'ultimate_cryo_field_spawned',
              data: {
                pos: s.targetPos,
                radius: Math.round(s.radius * 1.25),
                elevation: strikeZ,
                duration: s.durationRemaining
              }
            });
          }
        }
      } else {
        s.durationRemaining -= dt;

        // ====================================================================
        // ENHANCEMENT A: SINGULARITY (3.0s Gravitational Pull + Void DoT)
        // ====================================================================
        if (s.enhancement === 'singularity' || s.variant === 'singularity') {
          const pullRadius = Math.round(s.radius * 1.38);
          const pullVictims = this.spatialGrid.getNearby(s.targetPos, pullRadius);
          for (let v = 0; v < pullVictims.length; v++) {
            const enemy = pullVictims[v];
            if (enemy.health <= 0) continue;
            if (Math.abs(enemy.z - strikeZ) > 65) continue; // Respect elevation boundaries

            const dx = s.targetPos.x - enemy.pos.x;
            const dy = s.targetPos.y - enemy.pos.y;
            const dist = Math.hypot(dx, dy) || 1;
            const isElite = enemy.isElite || enemy.type === 'elite' || enemy.type === 'boss';

            const pullSpeed = isElite
              ? Math.min(150, 220 * (1 - dist / pullRadius) + 55)
              : Math.min(310, 420 * (1 - dist / pullRadius) + 110);

            if (!isElite) {
              enemy.isStunned = true;
              enemy.stunTimer = Math.max(enemy.stunTimer ?? 0, 0.35);
              enemy.attackCooldownRemaining = Math.max(enemy.attackCooldownRemaining, 0.45);
            }
            enemy.velocity.x *= 0.5;
            enemy.velocity.y *= 0.5;

            if (dist > 18) {
              const step = Math.min(dist - 14, pullSpeed * dt);
              const nextPos = {
                x: enemy.pos.x + (dx / dist) * step,
                y: enemy.pos.y + (dy / dist) * step
              };
              if (this.state.terrain.checkTraversable(enemy.pos, nextPos, enemy.z, false)) {
                enemy.pos.x = nextPos.x;
                enemy.pos.y = nextPos.y;
                enemy.z = this.state.terrain.getElevation(enemy.pos.x, enemy.pos.y).height;
                enemy.groundZ = enemy.z;
              }
            }
          }

          s.dotTimer = (s.dotTimer ?? 0.25) - dt;
          if (s.dotTimer <= 0) {
            s.dotTimer = 0.25;
            for (let v = 0; v < pullVictims.length; v++) {
              const enemy = pullVictims[v];
              if (enemy.health > 0 && Math.abs(enemy.z - strikeZ) <= 65) {
                this.damageEnemy(enemy, s.damage * 0.12, s.targetPos, 'void');
              }
            }
          }
        }

        // ====================================================================
        // ENHANCEMENT B: CONVERGENCE BARRAGE (0.95s Inward Energy Spiral Pull)
        // ====================================================================
        if (s.enhancement === 'convergence_barrage') {
          const convRadius = Math.round(s.radius * 1.35);
          const convVictims = this.spatialGrid.getNearby(s.targetPos, convRadius);
          for (let v = 0; v < convVictims.length; v++) {
            const enemy = convVictims[v];
            if (enemy.health <= 0) continue;
            if (Math.abs(enemy.z - strikeZ) > 65) continue;

            const dx = s.targetPos.x - enemy.pos.x;
            const dy = s.targetPos.y - enemy.pos.y;
            const dist = Math.hypot(dx, dy) || 1;
            if (dist > 22) {
              const pullSpeed = enemy.isBoss ? 140 : 280;
              const step = Math.min(dist - 18, pullSpeed * dt);
              const nextPos = {
                x: enemy.pos.x + (dx / dist) * step,
                y: enemy.pos.y + (dy / dist) * step
              };
              if (this.state.terrain.checkTraversable(enemy.pos, nextPos, enemy.z, false)) {
                enemy.pos.x = nextPos.x;
                enemy.pos.y = nextPos.y;
                enemy.z = this.state.terrain.getElevation(enemy.pos.x, enemy.pos.y).height;
                enemy.groundZ = enemy.z;
              }
            }
          }
        }

        // ====================================================================
        // ENHANCEMENT C: CRYOGENIC IMPACT (4.0s Freezing Field + Cold DoT)
        // ====================================================================
        if (s.enhancement === 'cryogenic_impact') {
          const cryoRadius = Math.round(s.radius * 1.25);
          const cryoVictims = this.spatialGrid.getNearby(s.targetPos, cryoRadius);
          for (let v = 0; v < cryoVictims.length; v++) {
            const enemy = cryoVictims[v];
            if (enemy.health <= 0) continue;
            if (Math.abs(enemy.z - strikeZ) > 65) continue;

            // Freeze / Stun enemies inside the cryogenic field
            enemy.isStunned = true;
            enemy.stunTimer = Math.max(enemy.stunTimer ?? 0, 0.65);
            enemy.isChilled = true;
            enemy.chillTimer = Math.max(enemy.chillTimer ?? 0, 1.5);
            enemy.velocity.x = 0;
            enemy.velocity.y = 0;
            enemy.attackCooldownRemaining = Math.max(enemy.attackCooldownRemaining, 0.65);
          }

          s.dotTimer = (s.dotTimer ?? 0.50) - dt;
          if (s.dotTimer <= 0) {
            s.dotTimer = 0.50;
            for (let v = 0; v < cryoVictims.length; v++) {
              const enemy = cryoVictims[v];
              if (enemy.health > 0 && Math.abs(enemy.z - strikeZ) <= 65) {
                this.damageEnemy(enemy, s.damage * 0.15, enemy.pos, 'frost');
              }
            }
          }
        }

        // ====================================================================
        // PHASE 3: EXPIRATION & FINAL DETONATIONS
        // ====================================================================
        if (s.durationRemaining <= 0) {
          if ((s.enhancement === 'singularity' || s.variant === 'singularity') && !s.hasExploded) {
            s.hasExploded = true;
            const blastRadius = Math.round(s.radius * 1.38);
            const victims = this.spatialGrid.getNearby(s.targetPos, blastRadius);
            for (let v = 0; v < victims.length; v++) {
              const enemy = victims[v];
              if (enemy.health > 0 && Math.abs(enemy.z - strikeZ) <= 65) {
                // Release from singularity lock and apply collapse detonation damage + outward impulse
                enemy.isStunned = false;
                enemy.stunTimer = 0;
                this.damageEnemy(enemy, s.damage * 1.50, s.targetPos, 'void');
                const kdx = enemy.pos.x - s.targetPos.x;
                const kdy = enemy.pos.y - s.targetPos.y;
                const klen = Math.hypot(kdx, kdy) || 1;
                enemy.velocity.x += (kdx / klen) * 520;
                enemy.velocity.y += (kdy / klen) * 520;
              }
            }
            this.state.events.push({
              type: 'ultimate_singularity_detonated',
              data: {
                pos: s.targetPos,
                radius: blastRadius,
                elevation: strikeZ
              }
            });
          } else if (s.enhancement === 'convergence_barrage' && !s.hasExploded) {
            s.hasExploded = true;
            const blastRadius = Math.round(s.radius * 1.20);
            const victims = this.spatialGrid.getNearby(s.targetPos, blastRadius);
            for (let v = 0; v < victims.length; v++) {
              const enemy = victims[v];
              if (enemy.health > 0 && Math.abs(enemy.z - strikeZ) <= 65) {
                this.damageEnemy(enemy, s.damage * 1.45, s.targetPos, 'ignite');
                const kdx = enemy.pos.x - s.targetPos.x;
                const kdy = enemy.pos.y - s.targetPos.y;
                const klen = Math.hypot(kdx, kdy) || 1;
                enemy.velocity.x += (kdx / klen) * 500;
                enemy.velocity.y += (kdy / klen) * 500;
              }
            }
            this.state.events.push({
              type: 'ultimate_convergence_detonated',
              data: {
                pos: s.targetPos,
                radius: blastRadius,
                elevation: strikeZ
              }
            });
          }
          continue;
        }
      }
      alive.push(s);
    }

    this.state.orbitalStrikes = alive;
  }
```

---

## STEP 4: Implement Bespoke 3D VFX for All Three Ultimate Enhancements (`src/render/ThreeVFX.ts` & `src/render/ThreeApp.ts`)

### 4A. Keep `verify_orbital_strike_vfx.ts` Memory Cap Test Passing while Supporting 5 Simultaneous Convergence Beams

In `src/render/ThreeVFX.ts` (around line 447 inside `spawnOrbitalBlast`):
- Currently, `if (this.orbitalSequences.length >= 4)` caps active sequences at `4`.
- In `scratch/verify_orbital_strike_vfx.ts`, test #23 calls `vfx.spawnOrbitalBlast(targetPos, 260, 0, 'judgment')` 6 times and asserts `vfx.orbitalSequences.length <= 4`.
- To keep test #23 passing `23 / 23` while allowing **Convergence Barrage** to render all **5 simultaneous beams** (1 center `'judgment'` + 4 outer `'convergence_sub'` beams), update the FIFO check in `spawnOrbitalBlast` (line 447) to:

```ts
    // Enforce max 4 simultaneous full orbital sequences for standard casts, or up to 8 when spawning 5-strike convergence sub-beams
    const maxSequences = variant === 'convergence_sub' ? 8 : 4;
    while (this.orbitalSequences.length >= maxSequences) {
      const oldest = this.orbitalSequences.shift();
      if (oldest) this.disposeOrbitalSequence(oldest);
    }
```
And right below `let widthMult = 1.0;` (around line 460), add styling for `variant === 'convergence_sub'` so the 4 outer beams share the exact golden-white Orbital Strike palette with a balanced `0.78` width scale:
```ts
    if (variant === 'convergence_sub') {
      widthMult = 0.78;
      beamDuration = 0.72;
    }
```

### 4B. Add Active Interfaces & Containers to `src/render/ThreeVFX.ts`

1. Near lines 125–137 of `src/render/ThreeVFX.ts`, add the three enhancement VFX interfaces:

```ts
interface ActiveSingularityVFX {
  group: THREE.Group;
  vortexDiscMesh: THREE.Mesh;
  vortexDiscMat: THREE.ShaderMaterial;
  coreSphereMesh: THREE.Mesh;
  coreSphereMat: THREE.MeshBasicMaterial;
  accretionRingMesh: THREE.Mesh;
  accretionRingMat: THREE.MeshBasicMaterial;
  debrisMeshes: {
    mesh: THREE.Mesh;
    mat: THREE.MeshBasicMaterial;
    angle: number;
    distRatio: number;
    heightOffset: number;
    orbitSpeed: number;
    rotSpeed: THREE.Vector3;
  }[];
  pointLight: THREE.PointLight;
  pos: Vector2;
  radius: number;
  baseElev: number;
  elapsed: number;
  duration: number;
}

interface ActiveConvergenceBarrageVFX {
  group: THREE.Group;
  spiralMesh: THREE.Mesh;
  spiralMat: THREE.ShaderMaterial;
  coreSphereMesh: THREE.Mesh;
  coreSphereMat: THREE.MeshBasicMaterial;
  coreCageMesh: THREE.Mesh;
  coreCageMat: THREE.MeshBasicMaterial;
  coreHaloMesh: THREE.Mesh;
  coreHaloMat: THREE.MeshBasicMaterial;
  debrisMeshes: {
    mesh: THREE.Mesh;
    mat: THREE.MeshBasicMaterial;
    angle: number;
    dist: number;
    baseY: number;
  }[];
  pointLight: THREE.PointLight;
  pos: Vector2;
  radius: number;
  baseElev: number;
  elapsed: number;
  duration: number;
}

interface ActiveCryogenicFieldVFX {
  group: THREE.Group;
  frostDiscMesh: THREE.Mesh;
  frostDiscMat: THREE.ShaderMaterial;
  crystalMeshes: {
    mesh: THREE.Mesh;
    mat: THREE.MeshBasicMaterial;
    targetScaleY: number;
  }[];
  snowParticles: {
    mesh: THREE.Mesh;
    mat: THREE.MeshBasicMaterial;
    angle: number;
    dist: number;
    yOffset: number;
    speedY: number;
    driftSpeed: number;
  }[];
  pointLight: THREE.PointLight;
  pos: Vector2;
  radius: number;
  baseElev: number;
  elapsed: number;
  duration: number;
}
```

2. Inside `export class ThreeVFX` properties (around line 159), add the three public arrays so automated tests can inspect them directly:

```ts
  public activeSingularities: ActiveSingularityVFX[] = [];
  public activeConvergences: ActiveConvergenceBarrageVFX[] = [];
  public activeCryoFields: ActiveCryogenicFieldVFX[] = [];
```

### 4C. Add the Five Enhancement VFX Spawn Methods in `src/render/ThreeVFX.ts`

Add the following methods to `ThreeVFX` (right before `public update(dt: number, camera: THREE.Camera): void`):

1. **`spawnSingularityVFX(pos: Vector2, radius: number, elevation: number = 0, duration: number = 3.0)`** (Reference Image 1: *Orbital Strike — Singularity*):
   - Terrain-conforming ground vortex shader (`vortexDiscMesh`) rendering:
     - Deep dark-void event horizon core (`#090214`) surrounded by a cracked golden-amber inner orbital crater ring (`#fbbf24`), proving that Orbital Strike came down first and tore open the singularity.
     - Logarithmic purple-violet spiral arms (`#7e22ce` -> `#c084fc` -> `#f0abfc`) rotating counter-clockwise and pulling inward.
     - Glowing inward-pointing chevron arrows (`>>>`) along 6 radial pull lanes + outer tech boundary ring with tick marks.
   - 3D dark-purple event horizon sphere (`coreSphereMesh`) + tilted glowing violet accretion ring (`accretionRingMesh`).
   - 16 orbiting 3D rock/debris chunks (`this.sharedDebrisGeo`) spiraling inward from the outer perimeter toward the center over the `3.0s` duration.
2. **`spawnSingularityDetonationVFX(pos: Vector2, radius: number, elevation: number = 0)`**:
   - Triggered at `t = 3.0s` when the Black Hole collapses: spawns a massive purple-gold supernova flash, two expanding shockwave rings (`0xa855f7` and `0xfacc15`), and radial void-gold sparks.
3. **`spawnConvergenceBarrageVFX(pos: Vector2, subStrikes: Vector2[], radius: number, elevation: number = 0, duration: number = 0.95)`** (Reference Image 2: *Orbital Strike — Convergence Barrage*):
   - Terrain-conforming golden convergence shader (`spiralMesh`) spanning the 5 impact sites:
     - 4 brilliant golden-amber spiral energy streams (`#fef08a` -> `#fbbf24` -> `#f97316`) originating from the 4 diagonal outer strike angles (`π/4, 3π/4, 5π/4, 7π/4`) and curving inward into the central impact crater.
     - Animated inward-flowing chevron markers (`>>>`) along the spiral streams and outer sacred-geometry tech rings.
   - Growing central golden energy core (`coreSphereMesh` + wireframe geodesic `coreCageMesh` + outer `coreHaloMesh`) that swells at the center as the 4 outer streams collapse into it, plus 10 levitating dark-gold rock chunks rising around the core before detonation.
4. **`spawnConvergenceDetonationVFX(pos: Vector2, radius: number, elevation: number = 0)`**:
   - Triggered when the 5-strike convergence core detonates at the center: spawns a blinding golden-white central blast (`spawnOrbitalBlast(pos, radius, elevation, 'nuke')` + golden shockwave rings `0xfef08a` and `0xf97316`).
5. **`spawnCryogenicFieldVFX(pos: Vector2, radius: number, elevation: number = 0, duration: number = 4.0)`** (Reference Image 3: *Orbital Strike — Cryogenic Impact*):
   - Terrain-conforming cryogenic ground shader (`frostDiscMesh`) rendering:
     - Warm golden-white inner orbital impact rings at the very center (`r < 0.22`) transitioning seamlessly into a vast translucent cyan-blue sheet of fractured glacial ice (`#0284c7` -> `#38bdf8` -> `#e0f2fe`).
     - Procedural Voronoi-like glowing crystalline ice fissures, radial frost veins, and a crisp outer cryogenic boundary ring with degree ticks and icy mist falloff.
   - 18 3D crystalline ice spikes (`ConeGeometry(6, 28, 5)`) arranged in an inner ring around the golden impact core and an outer jagged glacier ring around the perimeter that erupt upward from the frozen ground.
   - 20 drifting snowflake/frost diamond particles (`OctahedronGeometry`) hovering in the cold mist above the field.

Here is the complete code for these methods and their `update(dt, camera)` lifecycle in `src/render/ThreeVFX.ts`:

```ts
  // ============================================================================
  // ULTIMATE ENHANCEMENT A: ORBITAL STRIKE — SINGULARITY (BLACK HOLE)
  // ============================================================================
  public spawnSingularityVFX(
    pos: Vector2,
    radius: number,
    elevation: number = 0,
    duration: number = 3.0
  ): void {
    const baseElev = this.getTerrainHeight(pos.x, pos.y, elevation);
    const group = new THREE.Group();

    const discGeo = this.createTerrainConformingGrid(
      pos.x,
      pos.y,
      radius * 1.12,
      36,
      1.1,
      baseElev
    );

    const vortexDiscMat = new THREE.ShaderMaterial({
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      side: THREE.DoubleSide,
      uniforms: {
        uTime: { value: 0 },
        uProgress: { value: 0 },
        uAlpha: { value: 1.0 }
      },
      vertexShader: `
        varying vec2 vUv;
        void main() {
          vUv = uv;
          gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
        }
      `,
      fragmentShader: `
        uniform float uTime;
        uniform float uProgress;
        uniform float uAlpha;
        varying vec2 vUv;

        void main() {
          vec2 p = (vUv - 0.5) * 2.0;
          float r = length(p);
          if (r > 1.0) discard;

          float a = atan(p.y, p.x);

          // Swirling logarithmic spiral arms pulling inward
          float swirlAngle = a + uTime * 3.8 + log(max(r, 0.04)) * 4.2;
          float spiral1 = pow(0.5 + 0.5 * sin(swirlAngle * 3.0), 2.2);
          float spiral2 = pow(0.5 + 0.5 * cos(swirlAngle * 5.0 - uTime * 2.5), 3.0);

          // Inward-moving gravitational wave rings
          float inwardWave = pow(0.5 + 0.5 * sin(r * 28.0 + uTime * 10.0), 3.0) * smoothstep(0.12, 0.85, r);

          // 6 radial lanes of inward-pointing chevrons (>>>)
          float laneAngle = mod(a + 3.14159265, 1.04719755) - 0.52359877;
          float laneMask = smoothstep(0.16, 0.06, abs(laneAngle)) * smoothstep(0.24, 0.35, r) * smoothstep(0.88, 0.75, r);
          float chevCoord = fract(r * 5.5 + uTime * 1.8 - abs(laneAngle) * 2.2);
          float chev = smoothstep(0.30, 0.50, chevCoord) * smoothstep(0.75, 0.50, chevCoord) * laneMask;

          // Golden-amber inner crater rim (preserving Orbital Strike's signature at the center)
          float goldCraterRing = exp(-pow((r - 0.20) / 0.035, 2.0)) * 1.35;
          float outerBoundary = exp(-pow((r - 0.92) / 0.018, 2.0)) * 1.25;
          float outerTicks = step(0.65, sin(a * 36.0)) * exp(-pow((r - 0.88) / 0.012, 2.0)) * 0.85;

          // Deep purple-magenta-gold color palette matching Reference Image 1
          vec3 deepVoid = vec3(0.18, 0.03, 0.38);
          vec3 electricPurple = vec3(0.68, 0.22, 0.98);
          vec3 magentaGlow = vec3(0.95, 0.45, 1.0);
          vec3 orbitalGold = vec3(1.0, 0.82, 0.28);

          float energy = spiral1 * 0.75 + spiral2 * 0.55 + inwardWave * 0.45 + chev * 1.35 + outerBoundary + outerTicks;
          vec3 col = mix(deepVoid, electricPurple, clamp(energy, 0.0, 1.0));
          col = mix(col, magentaGlow, clamp(spiral2 * 0.7 + chev * 0.9 + outerBoundary * 0.6, 0.0, 1.0));
          col += orbitalGold * goldCraterRing;

          // Dark event horizon center + soft outer fade
          float horizonHole = smoothstep(0.05, 0.16, r);
          float radialEnvelope = smoothstep(1.0, 0.86, r) * (0.28 + 0.72 * (1.0 - r * 0.55));
          float collapseBoost = 1.0 + smoothstep(0.70, 1.0, uProgress) * 0.85;

          float alpha = clamp((energy * 0.82 + 0.24 + goldCraterRing * 0.6) * radialEnvelope * horizonHole * uAlpha, 0.0, 1.0);
          gl_FragColor = vec4(col * collapseBoost, alpha);
        }
      `
    });

    const vortexDiscMesh = new THREE.Mesh(discGeo, vortexDiscMat);
    vortexDiscMesh.position.set(pos.x, 0, pos.y);
    group.add(vortexDiscMesh);

    // Dark event-horizon core sphere at the center
    const coreGeo = new THREE.SphereGeometry(radius * 0.13, 24, 18);
    const coreSphereMat = new THREE.MeshBasicMaterial({
      color: 0x090214,
      transparent: true,
      opacity: 0.94
    });
    const coreSphereMesh = new THREE.Mesh(coreGeo, coreSphereMat);
    coreSphereMesh.position.set(pos.x, baseElev + 16, pos.y);
    group.add(coreSphereMesh);

    // Bright violet-gold accretion halo around the black hole core
    const accGeo = new THREE.TorusGeometry(radius * 0.17, 3.2, 12, 36);
    accGeo.rotateX(Math.PI * 0.42);
    const accretionRingMat = new THREE.MeshBasicMaterial({
      color: 0xd946ef,
      transparent: true,
      opacity: 0.9,
      blending: THREE.AdditiveBlending,
      depthWrite: false
    });
    const accretionRingMesh = new THREE.Mesh(accGeo, accretionRingMat);
    accretionRingMesh.position.set(pos.x, baseElev + 16, pos.y);
    group.add(accretionRingMesh);

    // 16 3D rock/debris chunks pulled inward in a spiral orbit
    const debrisMeshes: ActiveSingularityVFX['debrisMeshes'] = [];
    for (let i = 0; i < 16; i++) {
      const dMat = new THREE.MeshBasicMaterial({
        color: i % 3 === 0 ? 0xa855f7 : 0x2e1a47,
        transparent: true,
        opacity: 0.92
      });
      const dMesh = new THREE.Mesh(this.sharedDebrisGeo, dMat);
      const scale = 5.5 + (i % 4) * 2.4;
      dMesh.scale.set(scale, scale * 0.75, scale * 0.9);
      group.add(dMesh);
      debrisMeshes.push({
        mesh: dMesh,
        mat: dMat,
        angle: (i / 16) * Math.PI * 2,
        distRatio: 0.25 + ((i * 0.19) % 0.68),
        heightOffset: 6 + (i % 5) * 5.5,
        orbitSpeed: 2.2 + (i % 4) * 0.45,
        rotSpeed: new THREE.Vector3(2.5, 3.2, 1.8)
      });
    }

    const pointLight = new THREE.PointLight(0xa855f7, 3.8, radius * 2.2, 1.5);
    pointLight.position.set(pos.x, baseElev + 45, pos.y);
    group.add(pointLight);

    this.group.add(group);
    this.activeSingularities.push({
      group,
      vortexDiscMesh,
      vortexDiscMat,
      coreSphereMesh,
      coreSphereMat,
      accretionRingMesh,
      accretionRingMat,
      debrisMeshes,
      pointLight,
      pos: { x: pos.x, y: pos.y },
      radius,
      baseElev,
      elapsed: 0,
      duration: Math.max(0.5, duration)
    });
  }

  public spawnSingularityDetonationVFX(
    pos: Vector2,
    radius: number,
    elevation: number = 0
  ): void {
    const baseElev = this.getTerrainHeight(pos.x, pos.y, elevation);
    this.spawnShockwaveRing(pos, radius * 1.05, 0xa855f7, baseElev, 0.55);
    this.spawnShockwaveRing(pos, radius * 0.82, 0xfacc15, baseElev + 2, 0.42);

    // Intense purple-gold collapse dome flash
    const domeGeo = new THREE.SphereGeometry(radius * 0.55, 24, 16, 0, Math.PI * 2, 0, Math.PI / 2);
    const domeMat = new THREE.MeshBasicMaterial({
      color: 0xe879f9,
      transparent: true,
      opacity: 0.88,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
      side: THREE.DoubleSide
    });
    const domeMesh = new THREE.Mesh(domeGeo, domeMat);
    domeMesh.position.set(pos.x, baseElev + 1.0, pos.y);
    this.group.add(domeMesh);
    this.beams.push({ mesh: domeMesh, lifetime: 0.48, maxLifetime: 0.48 });
  }

  // ============================================================================
  // ULTIMATE ENHANCEMENT B: ORBITAL STRIKE — CONVERGENCE BARRAGE (5-STRIKE)
  // ============================================================================
  public spawnConvergenceBarrageVFX(
    pos: Vector2,
    subStrikes: Vector2[],
    radius: number,
    elevation: number = 0,
    duration: number = 0.95
  ): void {
    const baseElev = this.getTerrainHeight(pos.x, pos.y, elevation);

    // 1. Spawn the 4 surrounding simultaneous Orbital Strike beams in formation
    const subRadius = Math.round(radius * 0.65);
    for (let i = 0; i < subStrikes.length; i++) {
      const sp = subStrikes[i];
      const subElev = this.getTerrainHeight(sp.x, sp.y, baseElev);
      this.spawnOrbitalBlast(sp, subRadius, subElev, 'convergence_sub');
    }

    // 2. Build the Phase 2 Inward Spiral Convergence & Phase 3 Imminent Core group
    const group = new THREE.Group();
    const totalRadius = radius * 1.38;
    const spiralGeo = this.createTerrainConformingGrid(
      pos.x,
      pos.y,
      totalRadius,
      36,
      1.25,
      baseElev
    );

    const spiralMat = new THREE.ShaderMaterial({
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      side: THREE.DoubleSide,
      uniforms: {
        uTime: { value: 0 },
        uProgress: { value: 0 },
        uAlpha: { value: 1.0 }
      },
      vertexShader: `
        varying vec2 vUv;
        void main() {
          vUv = uv;
          gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
        }
      `,
      fragmentShader: `
        uniform float uTime;
        uniform float uProgress;
        uniform float uAlpha;
        varying vec2 vUv;

        void main() {
          vec2 p = (vUv - 0.5) * 2.0;
          float r = length(p);
          if (r > 1.0) discard;

          float a = atan(p.y, p.x);

          // 4 prominent golden energy streams spiraling inward from the 4 outer strike sites
          float streamPhase = a - log(max(r, 0.05)) * 2.6 + uTime * 4.5;
          float fourStreams = pow(0.5 + 0.5 * cos(streamPhase * 4.0), 3.2);
          float streamCore = pow(0.5 + 0.5 * cos(streamPhase * 4.0), 8.0);

          // Contracting radial envelope as energy collapses from outer ring toward center
          float maxReach = mix(0.95, 0.32, pow(uProgress, 1.35));
          float reachMask = smoothstep(maxReach + 0.14, maxReach - 0.18, r) * smoothstep(0.04, 0.16, r);

          // Inward-flowing chevrons (>>>) along the 4 golden streams
          float chevWave = fract(r * 6.0 + uTime * 2.6);
          float chev = smoothstep(0.35, 0.55, chevWave) * smoothstep(0.80, 0.55, chevWave) * fourStreams;

          // Sacred-geometry golden tech rings & segmented arcs
          float outerTechRing = exp(-pow((r - 0.82) / 0.016, 2.0)) * (1.0 - uProgress * 0.6);
          float midTechRing = exp(-pow((r - 0.48) / 0.018, 2.0)) * (0.7 + 0.3 * sin(a * 12.0));
          float innerCoreRing = exp(-pow((r - 0.22) / 0.025, 2.0)) * (1.1 + uProgress * 1.2);

          vec3 amberEdge = vec3(0.98, 0.48, 0.08);
          vec3 goldMid = vec3(1.0, 0.82, 0.18);
          vec3 whiteCore = vec3(1.0, 0.98, 0.88);

          float intensity = (fourStreams * 0.95 + chev * 1.15) * reachMask
                          + outerTechRing * 0.85
                          + midTechRing * 0.75
                          + innerCoreRing;
          vec3 col = mix(amberEdge, goldMid, clamp(intensity * 0.85, 0.0, 1.0));
          col = mix(col, whiteCore, clamp(streamCore * reachMask + innerCoreRing * 0.75, 0.0, 1.0));

          float alpha = clamp(intensity * uAlpha, 0.0, 1.0);
          gl_FragColor = vec4(col * (1.25 + uProgress * 0.75), alpha);
        }
      `
    });

    const spiralMesh = new THREE.Mesh(spiralGeo, spiralMat);
    spiralMesh.position.set(pos.x, 0, pos.y);
    group.add(spiralMesh);

    // Central Concentrated Golden Core (swells during Phase 2 -> Phase 3 Imminent Explosion)
    const coreSphereGeo = new THREE.SphereGeometry(radius * 0.24, 24, 18);
    const coreSphereMat = new THREE.MeshBasicMaterial({
      color: 0xfef08a,
      transparent: true,
      opacity: 0.85,
      blending: THREE.AdditiveBlending,
      depthWrite: false
    });
    const coreSphereMesh = new THREE.Mesh(coreSphereGeo, coreSphereMat);
    coreSphereMesh.position.set(pos.x, baseElev + 24, pos.y);
    coreSphereMesh.scale.setScalar(0.25);
    group.add(coreSphereMesh);

    // Sacred-geometry wireframe icosahedron cage inside the golden core (matches Reference Image 2 Frame 3)
    const coreCageGeo = new THREE.IcosahedronGeometry(radius * 0.28, 1);
    const coreCageMat = new THREE.MeshBasicMaterial({
      color: 0xffffff,
      wireframe: true,
      transparent: true,
      opacity: 0.9,
      blending: THREE.AdditiveBlending,
      depthWrite: false
    });
    const coreCageMesh = new THREE.Mesh(coreCageGeo, coreCageMat);
    coreCageMesh.position.set(pos.x, baseElev + 24, pos.y);
    coreCageMesh.scale.setScalar(0.25);
    group.add(coreCageMesh);

    // Outer golden energy halo around the core
    const coreHaloGeo = new THREE.TorusGeometry(radius * 0.32, 3.0, 12, 36);
    const coreHaloMat = new THREE.MeshBasicMaterial({
      color: 0xfbbf24,
      transparent: true,
      opacity: 0.85,
      blending: THREE.AdditiveBlending,
      depthWrite: false
    });
    const coreHaloMesh = new THREE.Mesh(coreHaloGeo, coreHaloMat);
    coreHaloMesh.position.set(pos.x, baseElev + 24, pos.y);
    coreHaloMesh.scale.setScalar(0.25);
    group.add(coreHaloMesh);

    // 10 levitating dark-gold debris fragments drawn upward around the building core
    const debrisMeshes: ActiveConvergenceBarrageVFX['debrisMeshes'] = [];
    for (let i = 0; i < 10; i++) {
      const dMat = new THREE.MeshBasicMaterial({
        color: i % 2 === 0 ? 0xf59e0b : 0x3b2f1e,
        transparent: true,
        opacity: 0.9
      });
      const dMesh = new THREE.Mesh(this.sharedDebrisGeo, dMat);
      const s = 5.0 + (i % 3) * 2.5;
      dMesh.scale.set(s, s * 1.2, s * 0.8);
      group.add(dMesh);
      debrisMeshes.push({
        mesh: dMesh,
        mat: dMat,
        angle: (i / 10) * Math.PI * 2,
        dist: radius * (0.45 + (i % 3) * 0.16),
        baseY: baseElev + 8 + (i % 4) * 7
      });
    }

    const pointLight = new THREE.PointLight(0xfbbf24, 4.2, radius * 2.4, 1.5);
    pointLight.position.set(pos.x, baseElev + 48, pos.y);
    group.add(pointLight);

    this.group.add(group);
    this.activeConvergences.push({
      group,
      spiralMesh,
      spiralMat,
      coreSphereMesh,
      coreSphereMat,
      coreCageMesh,
      coreCageMat,
      coreHaloMesh,
      coreHaloMat,
      debrisMeshes,
      pointLight,
      pos: { x: pos.x, y: pos.y },
      radius,
      baseElev,
      elapsed: 0,
      duration: Math.max(0.3, duration)
    });
  }

  public spawnConvergenceDetonationVFX(
    pos: Vector2,
    radius: number,
    elevation: number = 0
  ): void {
    const baseElev = this.getTerrainHeight(pos.x, pos.y, elevation);
    this.spawnOrbitalBlast(pos, radius, baseElev, 'nuke');
    this.spawnShockwaveRing(pos, radius * 1.15, 0xfef08a, baseElev + 2, 0.55);
    this.spawnShockwaveRing(pos, radius * 0.90, 0xf97316, baseElev + 1, 0.42);
  }

  // ============================================================================
  // ULTIMATE ENHANCEMENT C: ORBITAL STRIKE — CRYOGENIC IMPACT (FREEZING FIELD)
  // ============================================================================
  public spawnCryogenicFieldVFX(
    pos: Vector2,
    radius: number,
    elevation: number = 0,
    duration: number = 4.0
  ): void {
    const baseElev = this.getTerrainHeight(pos.x, pos.y, elevation);
    const group = new THREE.Group();

    const frostGeo = this.createTerrainConformingGrid(
      pos.x,
      pos.y,
      radius * 1.08,
      36,
      1.05,
      baseElev
    );

    const frostDiscMat = new THREE.ShaderMaterial({
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      side: THREE.DoubleSide,
      uniforms: {
        uTime: { value: 0 },
        uProgress: { value: 0 },
        uAlpha: { value: 1.0 }
      },
      vertexShader: `
        varying vec2 vUv;
        void main() {
          vUv = uv;
          gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
        }
      `,
      fragmentShader: `
        uniform float uTime;
        uniform float uProgress;
        uniform float uAlpha;
        varying vec2 vUv;

        float hash(vec2 p) {
          return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453123);
        }

        // Voronoi cellular distance for crystalline ice fracture network
        float voronoiCracks(vec2 x) {
          vec2 n = floor(x);
          vec2 f = fract(x);
          float md = 8.0;
          vec2 mr = vec2(0.0);
          for (int j = -1; j <= 1; j++) {
            for (int i = -1; i <= 1; i++) {
              vec2 g = vec2(float(i), float(j));
              vec2 o = vec2(hash(n + g), hash(n + g + vec2(17.0, 31.0)));
              vec2 r = g + o - f;
              float d = dot(r, r);
              if (d < md) {
                md = d;
                mr = r;
              }
            }
          }
          return sqrt(md);
        }

        void main() {
          vec2 p = (vUv - 0.5) * 2.0;
          float r = length(p);
          if (r > 1.0) discard;

          // Rapid outward freeze expansion over the first 0.25s
          float expandR = smoothstep(0.0, 0.08, uProgress);
          if (r > expandR) discard;

          float a = atan(p.y, p.x);

          // Crystalline ice fracture lines & radial frost veins
          float cell = voronoiCracks(p * 6.5);
          float iceCracks = exp(-pow((cell - 0.48) / 0.045, 2.0)) * 1.25;
          float fineCracks = exp(-pow((voronoiCracks(p * 13.0) - 0.46) / 0.05, 2.0)) * 0.65;
          float radialVeins = pow(0.5 + 0.5 * cos(a * 16.0 + sin(r * 10.0) * 1.5), 6.0) * smoothstep(0.15, 0.85, r);

          // Preserve warm golden Orbital Strike ring at the center (r ~ 0.18)
          float centerGoldRing = exp(-pow((r - 0.17) / 0.032, 2.0)) * 1.4;
          float outerCryoRing = exp(-pow((r - 0.92) / 0.018, 2.0)) * 1.35;
          float outerTicks = step(0.6, cos(a * 40.0)) * exp(-pow((r - 0.88) / 0.012, 2.0)) * 0.85;

          // Shimmering cold mist wave
          float mistPulse = 0.5 + 0.5 * sin(r * 14.0 - uTime * 2.4 + a * 2.0);

          vec3 deepGlacier = vec3(0.04, 0.32, 0.68);
          vec3 brightCyan = vec3(0.22, 0.78, 0.98);
          vec3 frostWhite = vec3(0.88, 0.97, 1.0);
          vec3 orbitalGold = vec3(1.0, 0.84, 0.32);

          float frostPattern = iceCracks + fineCracks + radialVeins * 0.65 + outerCryoRing + outerTicks;
          vec3 col = mix(deepGlacier, brightCyan, clamp(frostPattern * 0.65 + mistPulse * 0.35, 0.0, 1.0));
          col = mix(col, frostWhite, clamp(iceCracks * 0.75 + outerCryoRing * 0.7, 0.0, 1.0));
          col = mix(col, orbitalGold, clamp(centerGoldRing, 0.0, 1.0));

          float baseSheet = 0.32 * (1.0 - r * 0.35);
          float edgeSoft = smoothstep(1.0, 0.88, r);
          float alpha = clamp((baseSheet + frostPattern * 0.68 + centerGoldRing * 0.55) * edgeSoft * uAlpha, 0.0, 1.0);

          gl_FragColor = vec4(col * 1.18, alpha);
        }
      `
    });

    const frostDiscMesh = new THREE.Mesh(frostGeo, frostDiscMat);
    frostDiscMesh.position.set(pos.x, 0, pos.y);
    group.add(frostDiscMesh);

    // 18 3D jagged crystalline ice spikes (inner ring around golden impact core + outer glacier ring)
    const crystalMeshes: ActiveCryogenicFieldVFX['crystalMeshes'] = [];
    const crystalGeo = new THREE.ConeGeometry(7.5, 34, 5);
    crystalGeo.translate(0, 17, 0); // Pivot at base

    for (let i = 0; i < 18; i++) {
      const isInner = i < 8;
      const ringAngle = isInner
        ? (i / 8) * Math.PI * 2
        : ((i - 8) / 10) * Math.PI * 2 + 0.18;
      const ringDist = isInner ? radius * 0.24 : radius * (0.68 + (i % 3) * 0.08);
      const cx = pos.x + Math.cos(ringAngle) * ringDist;
      const cz = pos.y + Math.sin(ringAngle) * ringDist;
      const cElev = this.getTerrainHeight(cx, cz, baseElev);

      const cMat = new THREE.MeshBasicMaterial({
        color: i % 2 === 0 ? 0x7dd3fc : 0xe0f2fe,
        transparent: true,
        opacity: 0.86,
        blending: THREE.AdditiveBlending,
        depthWrite: false
      });
      const cMesh = new THREE.Mesh(crystalGeo, cMat);
      cMesh.position.set(cx, cElev, cz);

      // Tilt ice spikes slightly outward from the center like a shatter crown
      const tiltAngle = isInner ? 0.38 : 0.25;
      cMesh.rotation.y = -ringAngle + Math.PI * 0.5;
      cMesh.rotation.x = Math.sin(ringAngle) * tiltAngle;
      cMesh.rotation.z = -Math.cos(ringAngle) * tiltAngle;

      const scaleXZ = isInner ? 1.15 : 0.95 + (i % 3) * 0.22;
      const targetScaleY = isInner ? 1.35 : 0.90 + (i % 4) * 0.28;
      cMesh.scale.set(scaleXZ, 0.05, scaleXZ);
      group.add(cMesh);

      crystalMeshes.push({
        mesh: cMesh,
        mat: cMat,
        targetScaleY
      });
    }

    // 20 drifting frost/snowflake diamond particles hovering above the frozen field
    const snowParticles: ActiveCryogenicFieldVFX['snowParticles'] = [];
    for (let i = 0; i < 20; i++) {
      const sMat = new THREE.MeshBasicMaterial({
        color: 0xe0f2fe,
        transparent: true,
        opacity: 0.85,
        blending: THREE.AdditiveBlending,
        depthWrite: false
      });
      const sMesh = new THREE.Mesh(this.sharedSparkGeo, sMat);
      const sScale = 2.8 + (i % 3) * 1.4;
      sMesh.scale.set(sScale, sScale, sScale);
      group.add(sMesh);
      snowParticles.push({
        mesh: sMesh,
        mat: sMat,
        angle: (i / 20) * Math.PI * 2,
        dist: radius * (0.15 + ((i * 0.17) % 0.78)),
        yOffset: 8 + (i % 6) * 7,
        speedY: 10 + (i % 4) * 4,
        driftSpeed: 0.4 + (i % 3) * 0.25
      });
    }

    const pointLight = new THREE.PointLight(0x38bdf8, 3.6, radius * 2.2, 1.5);
    pointLight.position.set(pos.x, baseElev + 42, pos.y);
    group.add(pointLight);

    this.group.add(group);
    this.activeCryoFields.push({
      group,
      frostDiscMesh,
      frostDiscMat,
      crystalMeshes,
      snowParticles,
      pointLight,
      pos: { x: pos.x, y: pos.y },
      radius,
      baseElev,
      elapsed: 0,
      duration: Math.max(0.5, duration)
    });
  }
```

### 4D. Update Enhancement VFX Lifecycles & Clean Disposal in `ThreeVFX.update(dt, camera)` (`src/render/ThreeVFX.ts`, around line 2892)

At the end of `update(dt: number, camera: THREE.Camera)` in `src/render/ThreeVFX.ts`, add sections 10, 11, and 12 to animate and cleanly dispose `activeSingularities`, `activeConvergences`, and `activeCryoFields`:

```ts
    // 10. Update Ultimate Enhancement A: Active Singularities (Black Hole)
    for (let i = this.activeSingularities.length - 1; i >= 0; i--) {
      const sing = this.activeSingularities[i];
      sing.elapsed += dt;
      if (sing.elapsed >= sing.duration) {
        this.group.remove(sing.group);
        sing.vortexDiscMesh.geometry.dispose();
        sing.vortexDiscMat.dispose();
        sing.coreSphereMesh.geometry.dispose();
        sing.coreSphereMat.dispose();
        sing.accretionRingMesh.geometry.dispose();
        sing.accretionRingMat.dispose();
        for (let d = 0; d < sing.debrisMeshes.length; d++) {
          sing.debrisMeshes[d].mat.dispose();
        }
        this.activeSingularities.splice(i, 1);
        continue;
      }

      const p = sing.elapsed / sing.duration;
      sing.vortexDiscMat.uniforms.uTime.value = sing.elapsed;
      sing.vortexDiscMat.uniforms.uProgress.value = p;
      const fadeOut = p > 0.90 ? (1.0 - p) / 0.10 : Math.min(1.0, sing.elapsed / 0.18);
      sing.vortexDiscMat.uniforms.uAlpha.value = fadeOut;

      // Pulse event horizon sphere & spin accretion ring
      const corePulse = 1.0 + 0.18 * Math.sin(sing.elapsed * 14.0) + p * 0.25;
      sing.coreSphereMesh.scale.setScalar(corePulse);
      sing.accretionRingMesh.rotation.z += dt * 4.5;
      sing.accretionRingMesh.rotation.y += dt * 2.2;
      sing.pointLight.intensity = (3.5 + Math.sin(sing.elapsed * 18.0) * 0.8) * fadeOut;

      // Spiral 3D debris chunks inward toward the event horizon
      for (let d = 0; d < sing.debrisMeshes.length; d++) {
        const deb = sing.debrisMeshes[d];
        deb.angle += deb.orbitSpeed * (1.0 + p * 1.4) * dt;
        deb.distRatio -= 0.28 * dt;
        if (deb.distRatio < 0.10) deb.distRatio = 0.88;
        const curR = sing.radius * deb.distRatio;
        const dx = sing.pos.x + Math.cos(deb.angle) * curR;
        const dz = sing.pos.y + Math.sin(deb.angle) * curR;
        const groundH = this.getTerrainHeight(dx, dz, sing.baseElev);
        deb.mesh.position.set(dx, groundH + deb.heightOffset * (0.5 + 0.5 * deb.distRatio), dz);
        deb.mesh.rotation.x += deb.rotSpeed.x * dt;
        deb.mesh.rotation.y += deb.rotSpeed.y * dt;
        deb.mat.opacity = 0.9 * fadeOut;
      }
    }

    // 11. Update Ultimate Enhancement B: Active Convergence Barrages (5-Strike Inward Spiral & Core)
    for (let i = this.activeConvergences.length - 1; i >= 0; i--) {
      const conv = this.activeConvergences[i];
      conv.elapsed += dt;
      if (conv.elapsed >= conv.duration) {
        this.group.remove(conv.group);
        conv.spiralMesh.geometry.dispose();
        conv.spiralMat.dispose();
        conv.coreSphereMesh.geometry.dispose();
        conv.coreSphereMat.dispose();
        conv.coreCageMesh.geometry.dispose();
        conv.coreCageMat.dispose();
        conv.coreHaloMesh.geometry.dispose();
        conv.coreHaloMat.dispose();
        for (let d = 0; d < conv.debrisMeshes.length; d++) {
          conv.debrisMeshes[d].mat.dispose();
        }
        this.activeConvergences.splice(i, 1);
        continue;
      }

      const p = conv.elapsed / conv.duration;
      conv.spiralMat.uniforms.uTime.value = conv.elapsed;
      conv.spiralMat.uniforms.uProgress.value = p;
      conv.spiralMat.uniforms.uAlpha.value = Math.min(1.0, conv.elapsed / 0.12);

      // Grow the central golden core from 0.25x to 1.45x as the 5 strikes converge
      const coreScale = 0.25 + Math.pow(p, 1.25) * 1.25;
      conv.coreSphereMesh.scale.setScalar(coreScale);
      conv.coreCageMesh.scale.setScalar(coreScale * 1.08);
      conv.coreCageMesh.rotation.y += dt * 3.8;
      conv.coreCageMesh.rotation.x += dt * 2.4;
      conv.coreHaloMesh.scale.setScalar(coreScale * 1.15);
      conv.coreHaloMesh.rotation.x = Math.PI * 0.35 + conv.elapsed * 2.5;
      conv.coreHaloMesh.rotation.y = conv.elapsed * 3.2;
      conv.pointLight.intensity = 3.5 + p * 4.5;

      // Levitate & draw debris fragments inward toward the swelling golden core
      for (let d = 0; d < conv.debrisMeshes.length; d++) {
        const deb = conv.debrisMeshes[d];
        deb.angle += dt * (2.0 + p * 3.0);
        const curDist = deb.dist * (1.0 - p * 0.55);
        const dx = conv.pos.x + Math.cos(deb.angle) * curDist;
        const dz = conv.pos.y + Math.sin(deb.angle) * curDist;
        deb.mesh.position.set(dx, deb.baseY + p * 26, dz);
        deb.mesh.rotation.x += dt * 3.0;
        deb.mesh.rotation.y += dt * 4.0;
      }
    }

    // 12. Update Ultimate Enhancement C: Active Cryogenic Fields (Freezing Zone)
    for (let i = this.activeCryoFields.length - 1; i >= 0; i--) {
      const cryo = this.activeCryoFields[i];
      cryo.elapsed += dt;
      if (cryo.elapsed >= cryo.duration) {
        this.group.remove(cryo.group);
        if (cryo.crystalMeshes.length > 0) {
          cryo.crystalMeshes[0].mesh.geometry.dispose();
        }
        for (let c = 0; c < cryo.crystalMeshes.length; c++) {
          cryo.crystalMeshes[c].mat.dispose();
        }
        for (let s = 0; s < cryo.snowParticles.length; s++) {
          cryo.snowParticles[s].mat.dispose();
        }
        cryo.frostDiscMesh.geometry.dispose();
        cryo.frostDiscMat.dispose();
        this.activeCryoFields.splice(i, 1);
        continue;
      }

      const p = cryo.elapsed / cryo.duration;
      const fadeOut = p > 0.88 ? (1.0 - p) / 0.12 : 1.0;
      cryo.frostDiscMat.uniforms.uTime.value = cryo.elapsed;
      cryo.frostDiscMat.uniforms.uProgress.value = p;
      cryo.frostDiscMat.uniforms.uAlpha.value = fadeOut;
      cryo.pointLight.intensity = (3.2 + 0.5 * Math.sin(cryo.elapsed * 6.0)) * fadeOut;

      // Erupt 3D ice spikes over the first 0.22s, then shimmer and fade out at expiration
      const eruptRatio = Math.min(1.0, cryo.elapsed / 0.22);
      const easedErupt = 1.0 - Math.pow(1.0 - eruptRatio, 3.0);
      for (let c = 0; c < cryo.crystalMeshes.length; c++) {
        const cm = cryo.crystalMeshes[c];
        cm.mesh.scale.y = cm.targetScaleY * easedErupt * fadeOut;
        cm.mat.opacity = 0.86 * fadeOut;
      }

      // Swirl cold snowflake/frost particles across the field
      for (let s = 0; s < cryo.snowParticles.length; s++) {
        const sp = cryo.snowParticles[s];
        sp.angle += sp.driftSpeed * dt;
        sp.yOffset += Math.sin(cryo.elapsed * 3.0 + s) * 6.0 * dt;
        const sx = cryo.pos.x + Math.cos(sp.angle) * sp.dist;
        const sz = cryo.pos.y + Math.sin(sp.angle) * sp.dist;
        const sh = this.getTerrainHeight(sx, sz, cryo.baseElev);
        sp.mesh.position.set(sx, sh + sp.yOffset, sz);
        sp.mesh.rotation.y += dt * 2.5;
        sp.mesh.rotation.x += dt * 1.8;
        sp.mat.opacity = 0.82 * fadeOut;
      }
    }
```

### 4E. Wire New Enhancement Events in `src/render/ThreeApp.ts` (lines 2317–2455)

1. In `src/render/ThreeApp.ts`, inside `case 'ultimate_fired':` (around lines 2331–2344), when `e.data.enhancement === 'convergence_barrage'` and `Array.isArray(e.data.subStrikes)`, also spawn target lock reticles at the 4 surrounding strike positions so the player sees the 5-strike formation lock-on during the `0.40s` cast:

```ts
          } else {
            const targetPos = e.data.pos || e.data.target;
            if (targetPos) {
              const elev = this.simulation.state.terrain.getElevation(targetPos.x, targetPos.y).height;
              const strikeDelay = e.data.strikeDelay ?? 0.40;
              this.vfx.spawnOrbitalTargetLock(
                targetPos,
                e.data.radius || 260,
                elev,
                strikeDelay,
                e.data.variant || 'judgment'
              );
              if (e.data.enhancement === 'convergence_barrage' && Array.isArray(e.data.subStrikes)) {
                const subRadius = Math.round((e.data.radius || 260) * 0.65);
                for (let sIdx = 0; sIdx < e.data.subStrikes.length; sIdx++) {
                  const sp = e.data.subStrikes[sIdx];
                  const subElev = this.simulation.state.terrain.getElevation(sp.x, sp.y).height;
                  this.vfx.spawnOrbitalTargetLock(sp, subRadius, subElev, strikeDelay, 'judgment');
                }
              }
            }
          }
```

2. Right after `case 'ultimate_fired':` in `src/render/ThreeApp.ts`, add cases for the 5 new Ultimate Enhancement events:

```ts
        case 'ultimate_singularity_spawned':
          {
            const elev =
              e.data.elevation !== undefined
                ? e.data.elevation
                : this.simulation.state.terrain.getElevation(e.data.pos.x, e.data.pos.y).height;
            this.vfx.spawnSingularityVFX(
              e.data.pos,
              e.data.radius || 358,
              elev,
              e.data.duration || 3.0
            );
          }
          break;
        case 'ultimate_singularity_detonated':
          this.soundManager.playOrbitalStrike();
          {
            const elev =
              e.data.elevation !== undefined
                ? e.data.elevation
                : this.simulation.state.terrain.getElevation(e.data.pos.x, e.data.pos.y).height;
            this.vfx.spawnSingularityDetonationVFX(e.data.pos, e.data.radius || 358, elev);
            this.addCameraTrauma(0.65);
          }
          break;
        case 'ultimate_convergence_started':
          {
            const elev =
              e.data.elevation !== undefined
                ? e.data.elevation
                : this.simulation.state.terrain.getElevation(e.data.pos.x, e.data.pos.y).height;
            this.vfx.spawnConvergenceBarrageVFX(
              e.data.pos,
              e.data.subStrikes || [],
              e.data.radius || 260,
              elev,
              e.data.duration || 0.95
            );
          }
          break;
        case 'ultimate_convergence_detonated':
          this.soundManager.playOrbitalStrike();
          {
            const elev =
              e.data.elevation !== undefined
                ? e.data.elevation
                : this.simulation.state.terrain.getElevation(e.data.pos.x, e.data.pos.y).height;
            this.vfx.spawnConvergenceDetonationVFX(e.data.pos, e.data.radius || 312, elev);
            this.addCameraTrauma(0.70);
          }
          break;
        case 'ultimate_cryo_field_spawned':
          {
            const elev =
              e.data.elevation !== undefined
                ? e.data.elevation
                : this.simulation.state.terrain.getElevation(e.data.pos.x, e.data.pos.y).height;
            this.vfx.spawnCryogenicFieldVFX(
              e.data.pos,
              e.data.radius || 325,
              elev,
              e.data.duration || 4.0
            );
          }
          break;
```

---

## STEP 5: Verification Suite, Build Check & In-Game Screenshot Capture

### 5A. Create & Run `scratch/verify_ultimate_enhancements.ts`

Create `scratch/verify_ultimate_enhancements.ts` to verify all functional, timing, terrain-collision, and VFX lifecycle requirements:

```ts
import { Simulation } from '../src/sim/Simulation';
import { ThreeVFX } from '../src/render/ThreeVFX';
import { rollThreeBuffChoices, BUFF_REGISTRY } from '../src/sim/ItemDefs';
import { SeededRng } from '../src/sim/Rng';
import * as THREE from 'three';

let passed = 0;
let failed = 0;

function assert(condition: boolean, label: string): void {
  if (condition) {
    console.log(`  ✅ PASS: ${label}`);
    passed++;
  } else {
    console.error(`  ❌ FAIL: ${label}`);
    failed++;
  }
}

const emptyInput = {
  moveDir: { x: 0, y: 0 },
  wantDash: false,
  wantUltimate: false,
  wantInteract: false,
  wantJump: false,
  holdJump: false,
  cameraYaw: 0,
  wantPrimaryManual: false,
  wantSecondaryManual: false,
  mouseWorldPos: { x: 1800, y: 2250 },
  aimDir: { x: 0, y: -1 }
};

console.log('=== 1. EVENT POOL & MODULAR ENHANCEMENT ARCHITECTURE ===');
{
  const rng = new SeededRng(42);
  const choices = rollThreeBuffChoices(rng, 'ultimate_beacon');
  assert(choices.length === 3, `ultimate_beacon rolls 3 choices (got ${choices.length})`);
  assert(
    choices.includes('buff_skill_singularity') &&
      choices.includes('buff_skill_nuke') &&
      choices.includes('buff_skill_chrono_stasis'),
    'ultimate_beacon pool contains Singularity, Convergence Barrage, and Cryogenic Impact'
  );

  for (const c of choices) {
    const def = BUFF_REGISTRY[c];
    assert(def.enhancesSkillSlot === 'ultimate', `${c} uses enhancesSkillSlot: 'ultimate'`);
    assert(def.replacesSkillSlot === undefined, `${c} does NOT use legacy replacesSkillSlot`);
  }
}

console.log('\n=== 2. BASE ORBITAL STRIKE PRESERVATION (UNENHANCED) ===');
{
  const sim = new Simulation(100);
  const p = sim.state.player;
  p.calculatedStats.critChance = 0;
  p.autoCastPrimary = false;
  p.autoCastSecondary = false;

  assert(p.equippedSkills.ultimate.id === 'orbital_judgment', 'Base ultimate ID is orbital_judgment');
  assert(p.skillEnhancements.ultimate === undefined, 'No ultimate enhancement active by default');

  const castPos = { x: p.pos.x, y: p.pos.y };
  sim.update(0.016, { ...emptyInput, wantUltimate: true });
  // Move Commander away after activation to verify strike stays locked at castPos
  p.pos.x += 120;
  assert(
    sim.state.orbitalStrikes.length === 1 &&
      sim.state.orbitalStrikes[0].targetPos.x === castPos.x &&
      sim.state.orbitalStrikes[0].targetPos.y === castPos.y,
    'Base Orbital Strike remains fixed at Commander activation position even after Commander moves'
  );
}

console.log('\n=== 3. ENHANCEMENT A: ORBITAL STRIKE — SINGULARITY ===');
{
  const sim = new Simulation(200);
  const p = sim.state.player;
  p.calculatedStats.critChance = 0;
  p.autoCastPrimary = false;
  p.autoCastSecondary = false;
  sim.state.enemies = [];

  // Select Singularity via selectBuffChoice
  sim.state.isPausedForBuffChoice = true;
  sim.state.currentBuffChoices = ['buff_skill_singularity'];
  sim.selectBuffChoice('buff_skill_singularity');

  assert(p.equippedSkills.ultimate.id === 'orbital_judgment', 'Singularity preserves base skill ID orbital_judgment');
  assert(p.skillEnhancements.ultimate === 'singularity', 'p.skillEnhancements.ultimate === singularity');
  assert(p.equippedSkills.ultimate.name === 'Orbital Strike — Singularity', 'HUD skill name updated to Orbital Strike — Singularity');

  const castPos = { x: p.pos.x, y: p.pos.y };
  const enemy = {
    id: 'test_sing_1',
    type: 'crawler' as const,
    pos: { x: castPos.x + 190, y: castPos.y },
    velocity: { x: 0, y: 0 },
    z: p.z,
    groundZ: p.z,
    health: 2000,
    maxHealth: 2000,
    speed: 0,
    touchDamage: 0,
    attackCooldown: 10,
    attackCooldownRemaining: 10,
    attackRange: 30,
    isElite: false,
    currencyReward: 1,
    xpReward: 1,
    radius: 18
  };
  sim.state.enemies.push(enemy);

  sim.update(0.016, { ...emptyInput, wantUltimate: true });
  // Advance past 0.40s strikeDelay
  for (let i = 0; i < 26; i++) sim.update(0.016, emptyInput);

  const hpAfterImpact = enemy.health;
  assert(hpAfterImpact === 2000 - 240, `Phase 1 Orbital Strike deals 240 base impact damage (HP=${hpAfterImpact})`);
  const singSpawned = sim.state.events.some((e) => e.type === 'ultimate_singularity_spawned');
  assert(singSpawned, 'Phase 2 emits ultimate_singularity_spawned right after orbital impact');

  const distAtImpact = Math.hypot(enemy.pos.x - castPos.x, enemy.pos.y - castPos.y);
  // Advance 1.5s into the 3.0s Black Hole phase
  for (let i = 0; i < 90; i++) sim.update(0.016, emptyInput);
  const distMidPull = Math.hypot(enemy.pos.x - castPos.x, enemy.pos.y - castPos.y);
  assert(distMidPull < distAtImpact - 40, `Black Hole pulls enemy inward toward center (${distAtImpact.toFixed(1)} -> ${distMidPull.toFixed(1)})`);
  assert(enemy.health < hpAfterImpact, 'Black Hole applies periodic void DoT while pulling');

  // Advance remaining ~1.6s to trigger Phase 3 collapse at 3.0s
  const hpBeforeCollapse = enemy.health;
  for (let i = 0; i < 110; i++) sim.update(0.016, emptyInput);
  const singDetonated = sim.state.events.some((e) => e.type === 'ultimate_singularity_detonated');
  assert(singDetonated, 'Phase 3 emits ultimate_singularity_detonated at 3.0s collapse');
  assert(enemy.health < hpBeforeCollapse - 300, `Phase 3 collapse deals heavy bonus AoE damage (${hpBeforeCollapse} -> ${enemy.health})`);
  assert(!enemy.isStunned, 'Enemies are released from gravitational lock after detonation');
  assert(sim.state.orbitalStrikes.length === 0, 'Black Hole state is removed after detonation');
}

console.log('\n=== 4. ENHANCEMENT B: ORBITAL STRIKE — CONVERGENCE BARRAGE ===');
{
  const sim = new Simulation(300);
  const p = sim.state.player;
  p.calculatedStats.critChance = 0;
  p.autoCastPrimary = false;
  p.autoCastSecondary = false;
  sim.state.enemies = [];

  sim.state.isPausedForBuffChoice = true;
  sim.state.currentBuffChoices = ['buff_skill_nuke'];
  sim.selectBuffChoice('buff_skill_nuke');

  assert(p.equippedSkills.ultimate.id === 'orbital_judgment', 'Convergence Barrage preserves base skill ID orbital_judgment');
  assert(p.skillEnhancements.ultimate === 'convergence_barrage', 'p.skillEnhancements.ultimate === convergence_barrage');

  const castPos = { x: p.pos.x, y: p.pos.y };
  const centerEnemy = {
    id: 'test_conv_center',
    type: 'crawler' as const,
    pos: { x: castPos.x + 40, y: castPos.y },
    velocity: { x: 0, y: 0 },
    z: p.z,
    groundZ: p.z,
    health: 2000,
    maxHealth: 2000,
    speed: 0,
    touchDamage: 0,
    attackCooldown: 10,
    attackCooldownRemaining: 10,
    attackRange: 30,
    isElite: false,
    currencyReward: 1,
    xpReward: 1,
    radius: 18
  };
  sim.state.enemies.push(centerEnemy);

  sim.update(0.016, { ...emptyInput, wantUltimate: true });
  assert(
    sim.state.orbitalStrikes.length === 1 &&
      Array.isArray(sim.state.orbitalStrikes[0].subStrikes) &&
      sim.state.orbitalStrikes[0].subStrikes!.length === 4,
    'Convergence Barrage configures 1 primary strike + 4 balanced outer ring strikes (5 total)'
  );

  // Advance past 0.40s simultaneous impact
  for (let i = 0; i < 26; i++) sim.update(0.016, emptyInput);
  assert(centerEnemy.health === 2000 - 240, `5 simultaneous strikes deduplicate initial impact damage (HP=${centerEnemy.health})`);
  assert(
    sim.state.events.some((e) => e.type === 'ultimate_convergence_started'),
    'Emits ultimate_convergence_started when the 5 simultaneous beams impact'
  );

  // Advance past 0.95s convergence phase to central detonation
  for (let i = 0; i < 65; i++) sim.update(0.016, emptyInput);
  assert(
    sim.state.events.some((e) => e.type === 'ultimate_convergence_detonated'),
    'Emits ultimate_convergence_detonated after inward spiral completes'
  );
  assert(centerEnemy.health < 2000 - 240 - 300, `Central convergence explosion deals massive bonus AoE damage (HP=${centerEnemy.health})`);
}

console.log('\n=== 5. ENHANCEMENT C: ORBITAL STRIKE — CRYOGENIC IMPACT ===');
{
  const sim = new Simulation(400);
  const p = sim.state.player;
  p.calculatedStats.critChance = 0;
  p.autoCastPrimary = false;
  p.autoCastSecondary = false;
  sim.state.enemies = [];

  sim.state.isPausedForBuffChoice = true;
  sim.state.currentBuffChoices = ['buff_skill_chrono_stasis'];
  sim.selectBuffChoice('buff_skill_chrono_stasis');

  assert(p.equippedSkills.ultimate.id === 'orbital_judgment', 'Cryogenic Impact preserves base skill ID orbital_judgment');
  assert(p.skillEnhancements.ultimate === 'cryogenic_impact', 'p.skillEnhancements.ultimate === cryogenic_impact');

  const castPos = { x: p.pos.x, y: p.pos.y };
  const enemy = {
    id: 'test_cryo_1',
    type: 'crawler' as const,
    pos: { x: castPos.x + 150, y: castPos.y },
    velocity: { x: 80, y: 0 },
    z: p.z,
    groundZ: p.z,
    health: 2000,
    maxHealth: 2000,
    speed: 90,
    touchDamage: 0,
    attackCooldown: 10,
    attackCooldownRemaining: 10,
    attackRange: 30,
    isElite: false,
    currencyReward: 1,
    xpReward: 1,
    radius: 18
  };
  sim.state.enemies.push(enemy);

  sim.update(0.016, { ...emptyInput, wantUltimate: true });
  for (let i = 0; i < 26; i++) sim.update(0.016, emptyInput);

  assert(enemy.health === 2000 - 240, `Phase 1 Orbital Strike deals 240 base impact damage (HP=${enemy.health})`);
  assert(
    sim.state.events.some((e) => e.type === 'ultimate_cryo_field_spawned'),
    'Emits ultimate_cryo_field_spawned after initial orbital impact'
  );
  assert(enemy.isStunned === true && enemy.isChilled === true, 'Enemy inside Cryogenic Field is Frozen (stunned + chilled)');

  // Advance 1.2s to verify frost DoT ticks
  for (let i = 0; i < 75; i++) sim.update(0.016, emptyInput);
  assert(enemy.health < 2000 - 240, `Cryogenic Field deals periodic frost DoT (HP=${enemy.health})`);

  // Advance past 4.0s field expiration + 0.7s stun decay
  for (let i = 0; i < 230; i++) sim.update(0.016, emptyInput);
  assert(sim.state.orbitalStrikes.length === 0, 'Cryogenic Field expires cleanly after 4.0s');
}

console.log('\n=== 6. THREEVFX 3D ENHANCEMENT LIFECYCLES & MEMORY CLEANUP ===');
{
  const vfx = new ThreeVFX(() => 12);
  const cam = new THREE.PerspectiveCamera(45, 1.6, 1, 5000);
  const pos = { x: 1800, y: 2250 };

  // Singularity VFX
  vfx.spawnSingularityVFX(pos, 358, 12, 3.0);
  assert(vfx.activeSingularities.length === 1, 'spawnSingularityVFX creates 1 active singularity');
  vfx.update(1.5, cam);
  assert(vfx.activeSingularities.length === 1, 'Singularity VFX remains active at t=1.5s');
  vfx.update(1.6, cam);
  assert(vfx.activeSingularities.length === 0, 'Singularity VFX disposes cleanly after 3.0s');

  // Convergence Barrage VFX (5 simultaneous beams + spiral + core)
  const subs = [
    { x: pos.x + 124, y: pos.y + 124 },
    { x: pos.x - 124, y: pos.y + 124 },
    { x: pos.x - 124, y: pos.y - 124 },
    { x: pos.x + 124, y: pos.y - 124 }
  ];
  vfx.spawnOrbitalBlast(pos, 260, 12, 'judgment');
  vfx.spawnConvergenceBarrageVFX(pos, subs, 260, 12, 0.95);
  assert(vfx.orbitalSequences.length === 5, `All 5 simultaneous orbital beams are active (got ${vfx.orbitalSequences.length})`);
  assert(vfx.activeConvergences.length === 1, 'spawnConvergenceBarrageVFX creates 1 active convergence sequence');
  vfx.update(1.0, cam);
  assert(vfx.activeConvergences.length === 0, 'Convergence Barrage VFX disposes cleanly after 0.95s');

  // Cryogenic Field VFX
  vfx.spawnCryogenicFieldVFX(pos, 325, 12, 4.0);
  assert(vfx.activeCryoFields.length === 1, 'spawnCryogenicFieldVFX creates 1 active cryogenic field');
  vfx.update(2.0, cam);
  assert(vfx.activeCryoFields.length === 1, 'Cryogenic Field VFX remains active at t=2.0s');
  vfx.update(2.1, cam);
  assert(vfx.activeCryoFields.length === 0, 'Cryogenic Field VFX disposes cleanly after 4.0s');
}

console.log(`\n========================================`);
console.log(`TOTAL PASSED: ${passed} | FAILED: ${failed}`);
console.log(`========================================`);
if (failed > 0) process.exit(1);
```

Run all three verification suites and production build:
1. `npx tsx scratch/verify_ultimate_enhancements.ts` (must pass `27 / 27`)
2. `npx tsx scratch/verify_orbital_strike_vfx.ts` (must still pass `23 / 23`)
3. `npx tsx scratch/verify_commander_skill_vfx.ts` (must still pass `34 / 34`)
4. `npm run build` (must succeed with zero TypeScript or bundler errors)

### 5B. Capture In-Game Screenshots (`scripts/capture-ultimate-enhancements.cjs`)

Create `scripts/capture-ultimate-enhancements.cjs` to capture all 3 upgraded Orbital Strike variants in headless Chrome (walking north `'w'` into the sunlit valley floor and **never** setting `isPausedForBuffChoice = true` during screenshot capture so the buff selection modal never covers the screen):
- `scratch/ultimate_singularity.png` (captured right after the Orbital Strike beam impacts and the dark-purple Black Hole vortex + orbiting debris + golden inner crater are visible)
- `scratch/ultimate_convergence_barrage.png` (captured right after the 5 simultaneous orbital beams impact and the golden inward spiral streams + central core are visible)
- `scratch/ultimate_cryogenic_impact.png` (captured right after the Orbital Strike beam impacts and the crystalline freezing field + 3D ice spikes + golden center are visible)

Copy the 3 captured PNGs to `C:\Users\yoggn\.gemini\antigravity\brain\4542810e-1e49-4a7e-a79b-951bef007a82\` and inspect them with `read_file` to verify visual fidelity against the three reference images.


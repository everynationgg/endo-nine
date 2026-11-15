# ENDO NINE — Default Character Skills, Loadouts & Buff Integration Guide (For Gemini)

> **INSTRUCTIONS FOR GEMINI:**
> Execute Steps 1 through 6 below **in exact order**.
> - **Preserve** all existing replacement skills (`scatter_blaster`, `arc_cannon`, `hyper_beam`, `gatling_minigun`, `piercing_wave`, `cryo_grenade`, `gravity_vortex`, `blink_warp`, `carpet_nuke`, `orbital_lance`, `judgement_singularity`, `chrono_stasis`, `sedative_dose`, `recovery_field`, `emergency_protocol`) in `SKILL_REGISTRY`. Do **not** delete them.
> - **Preserve** existing enemy AI, navigation, terrain elevation, and rendering optimizations.
> - Follow the exact code changes below and run the verification suite in Step 6 at the end.

---

## STEP 1: Update `src/sim/types.ts`

### Action:
Update [`src/sim/types.ts`](../src/sim/types.ts) to support:
1. New additive buff multipliers on `CalculatedStats` (`aoeRadiusMultiplier`, `healingMultiplier`, `skillDurationMultiplier`).
2. Tracking fields on `PlayerState` for Doctor's alternating pistols (`pistolHand: 'left' | 'right'`), Commander's single-trigger dash shockwave (`dashShockwaveTriggered?: boolean`), Doctor's Medical Rush swept pass-through (`dashHitIds?: Set<string>`), and Sanctuary Cross active buff status (`inSanctuaryCross?: boolean`).
3. New `ProjectileType` `'bomb'` for Commander's Explosive Bomb.
4. New `ToxicFieldState` and `SanctuaryCrossState` interfaces.
5. New `SimEvent` types (`'dash_shockwave'`, `'medical_rush_hit'`, `'toxic_field_deployed'`, `'sanctuary_cross_deployed'`, `'sanctuary_pulse'`).

### Exact Edits in `src/sim/types.ts`:

1. In `CalculatedStats` (around lines 98–125), add:
```typescript
  aoeRadiusMultiplier: number;
  healingMultiplier: number;
  skillDurationMultiplier: number;
```

2. In `PlayerState` (around lines 171–203), add:
```typescript
  pistolHand: 'left' | 'right';
  dashShockwaveTriggered?: boolean;
  dashHitIds?: Set<string>;
  inSanctuaryCross?: boolean;
```

3. In `ProjectileType` (around lines 254–274), add `'bomb'` and `'laser_bolt'`:
```typescript
export type ProjectileType =
  | 'pulse'
  | 'bomb'
  | 'laser_bolt'
  | 'medical_pulse'
  | 'sedative_dart'
```
And on `ProjectileState` (around line 295), add optional `hand?: 'left' | 'right';`:
```typescript
  originZ?: number;
  targetZ?: number;
  hand?: 'left' | 'right';
}
```

4. Below `RecoveryFieldState` (around line 320), add `ToxicFieldState` and `SanctuaryCrossState`:
```typescript
export interface ToxicFieldState {
  id: string;
  pos: Vector2;
  z: number;
  radius: number;
  durationRemaining: number;
  damagePerTick: number;
  tickInterval: number;
  tickTimer: number;
}

export interface SanctuaryCrossState {
  id: string;
  pos: Vector2;
  z: number;
  armHalfLength: number;
  armHalfWidth: number;
  durationRemaining: number;
  maxDuration: number;
  healPerSecond: number;
  damagePerPulse: number;
  pulseInterval: number;
  pulseTimer: number;
  stunDuration: number;
}
```

5. In `SimEvent['type']` (around lines 410–447), add:
```typescript
    | 'dash_shockwave'
    | 'medical_rush_hit'
    | 'toxic_field_deployed'
    | 'sanctuary_cross_deployed'
    | 'sanctuary_pulse'
```

---

## STEP 2: Update `src/sim/SkillDefs.ts` (Commander & Doctor Default Loadouts + Preserve All Replacements)

### Action:
In [`src/sim/SkillDefs.ts`](../src/sim/SkillDefs.ts):
1. Update `SKILL_ENERGY_PULSE` name/description to reflect Commander's **Service Pistol**, and add `SKILL_EXPLOSIVE_BOMB` (`id: 'explosive_bomb'`) as Commander's default secondary.
2. Update `SKILL_TACTICAL_DASH` (`id: 'tactical_dash'`, name: `'Impact Dash'`, `baseDamage: 48`) so Commander's dash has impact + shockwave damage.
3. Keep `SKILL_ORBITAL_JUDGMENT` (`id: 'orbital_judgment'`, name: `'Orbital Strike'`) as Commander's default ultimate.
4. Set `COMMANDER_DEFAULT_SKILLS`:
   - `primary: SKILL_ENERGY_PULSE` (Service Pistol)
   - `secondary: SKILL_EXPLOSIVE_BOMB` (Explosive Bomb)
   - `utility: SKILL_TACTICAL_DASH` (Impact Dash)
   - `ultimate: SKILL_ORBITAL_JUDGMENT` (Orbital Strike)
5. For **Doctor**, define her 4 default skills while keeping `sedative_dose`, `recovery_field`, and `emergency_protocol` in `SKILL_REGISTRY`:
   - **Primary (`SKILL_MEDICAL_PULSE`, `id: 'medical_pulse'`):** `'Twin Laser Pistols'` — Alternating left/right luminous sci-fi laser bolts (`cooldown: 0.48`, `range: 480`, `baseDamage: 24`).
   - **Secondary (`SKILL_TOXIC_CONTAMINATION`, `id: 'toxic_contamination'`):** `'Toxic Contamination'` — Deploys a biological contamination zone dealing controlled periodic DoT (`cooldown: 4.0`, `range: 480`, `baseDamage: 28`, icon: `'/assets/doctor/skill_sedative_dose.png'`).
   - **Utility (`SKILL_MEDICAL_RUSH`, `id: 'medical_rush'`):** `'Medical Rush'` — Travels 2× normal dash distance, passing through characters to heal allies/self and damage enemies once per dash (`cooldown: 4.0`, `range: 0`, `baseDamage: 45`, icon: `'/assets/doctor/skill_recovery_field.png'`).
   - **Ultimate (`SKILL_SANCTUARY_CROSS`, `id: 'sanctuary_cross'`):** `'Sanctuary Cross'` — Projects a massive thick cross-shaped field for 7 seconds that continuously heals & buffs allies inside the cross while pulsing periodic damage and short incapacitation on enemies (`cooldown: 13.0`, `range: 240`, `baseDamage: 65`, icon: `'/assets/doctor/skill_emergency_protocol.png'`).
6. Set `DOCTOR_DEFAULT_SKILLS`:
   - `primary: SKILL_MEDICAL_PULSE`
   - `secondary: SKILL_TOXIC_CONTAMINATION`
   - `utility: SKILL_MEDICAL_RUSH`
   - `ultimate: SKILL_SANCTUARY_CROSS`
7. Register `explosive_bomb`, `toxic_contamination`, `medical_rush`, and `sanctuary_cross` in `SKILL_REGISTRY` alongside all existing skills.

---

## STEP 3: Update `src/sim/ItemDefs.ts` (Ensure Category B Buffs Enhance Without Replacing)

### Action:
In [`src/sim/ItemDefs.ts`](../src/sim/ItemDefs.ts):
1. In `calculateStats()` (around lines 708–767), initialize the 3 new `CalculatedStats` properties:
   ```typescript
   aoeRadiusMultiplier: 1.0,
   healingMultiplier: 1.0,
   skillDurationMultiplier: 1.0,
   ```
2. Update existing buffs so they also populate these multipliers cleanly without altering existing balance:
   - In `ITEM_VITAL_CORE.applyStack`: add `stats.healingMultiplier += count * 0.15;`
   - In `buff_orbital_cap.applyStack`: add `stats.aoeRadiusMultiplier += count * 0.20;`
   - In `buff_toxic_spores.applyStack`: add `stats.skillDurationMultiplier += count * 0.15;`
   - In `buff_vampiric_siphon.applyStack`: add `stats.healingMultiplier += count * 0.15;`
3. Verify that **only** the explicit Skill Evolution / Skill Replacement buffs (`buff_skill_*`) have `replacesSkillSlot` and `replacementSkillId`, and **no** stat/additive buff has `replacesSkillSlot`.

---

## STEP 4: Update `src/sim/GameState.ts` & `src/sim/Simulation.ts`

### 4A. In [`src/sim/GameState.ts`](../src/sim/GameState.ts):
1. Import `ToxicFieldState` and `SanctuaryCrossState` from `./types`.
2. Add properties on `GameState`:
   ```typescript
   public toxicFields: ToxicFieldState[] = [];
   public sanctuaryCrosses: SanctuaryCrossState[] = [];
   ```
3. In `this.player = { ... }` (around line 118), initialize:
   ```typescript
   pistolHand: 'left',
   dashShockwaveTriggered: false,
   dashHitIds: new Set<string>(),
   inSanctuaryCross: false,
   ```
4. In `selectHero(heroId: HeroId)` (around line 161), reset:
   ```typescript
   this.player.pistolHand = 'left';
   this.player.dashShockwaveTriggered = false;
   this.player.dashHitIds = new Set<string>();
   this.player.inSanctuaryCross = false;
   this.player.equippedSkills = heroId === 'doctor'
     ? { ...DOCTOR_DEFAULT_SKILLS }
     : { ...COMMANDER_DEFAULT_SKILLS };
   ```

### 4B. In [`src/sim/Simulation.ts`](../src/sim/Simulation.ts):
1. Import `ToxicFieldState` and `SanctuaryCrossState` from `./types`.
2. In `startRun()` (around line 153), clear:
   ```typescript
   this.state.toxicFields = [];
   this.state.sanctuaryCrosses = [];
   ```
3. In `tick()` (around line 99), call:
   ```typescript
   this.updateRecoveryFields(dt);
   this.updateToxicFields(dt);
   this.updateSanctuaryCrosses(dt);
   ```
4. **Helper Method for Sanctuary Cross Geometry (`isPointInSanctuaryCross`):**
   Add this public helper method on `Simulation`:
   ```typescript
   public isPointInSanctuaryCross(pos: Vector2, z: number, cross: SanctuaryCrossState): boolean {
     // Respect terrain elevation & physical separation
     if (Math.abs(z - cross.z) > 65) return false;
     const dx = Math.abs(pos.x - cross.pos.x);
     const dy = Math.abs(pos.y - cross.pos.y);
     // Point must lie inside the horizontal thick arm OR the vertical thick arm
     return (
       (dx <= cross.armHalfLength && dy <= cross.armHalfWidth) ||
       (dy <= cross.armHalfLength && dx <= cross.armHalfWidth)
     );
   }
   ```
5. **Dash Activation & Movement (`updatePlayerMovement`, around lines 354–540):**
   - When `input.wantDash && p.utilityCooldownRemaining <= 0 && !p.isDashing`:
     - Reset `p.dashShockwaveTriggered = false;` and `p.dashHitIds = new Set<string>();`.
     - If `utilDef.id === 'medical_rush'`:
       - Doctor's Medical Rush: set `p.isDashing = true; p.dashDurationTimer = 0.22;` (and during `p.isDashing`, when `p.equippedSkills.utility.id === 'medical_rush'`, use `currentSpeed = p.moveSpeed * 6.4`, which is **exact 2.0×** the standard `p.moveSpeed * 3.2` dash speed over the same `0.22s` duration = **2× dash distance**!).
       - Apply Doctor's instant self/ally pass-through heal once per dash:
         ```typescript
         const rushHeal = 20 * (p.calculatedStats.healingMultiplier || 1.0);
         p.health = Math.min(p.maxHealth, p.health + rushHeal);
         p.dashHitIds.add('player_self');
         ```
       - Emit `{ type: 'dash_used', data: { pos: { ...p.pos }, dir: p.dashDir, variant: 'medical_rush' } }`.
   - During `if (p.isDashing)` (lines 504–538):
     - Save `const prevPos = { x: p.pos.x, y: p.pos.y };` before moving.
     - Move `p.pos` using `this.state.terrain.checkTraversable(...)` (for `medical_rush`, perform 2 sub-steps of `dt * 0.5` so the 2× speed never skips over a thin wall or cliff!).
     - **If `p.equippedSkills.utility.id === 'tactical_dash'` (Commander's Impact Dash):**
       - If `!p.dashShockwaveTriggered`:
         - Query `const nearby = this.spatialGrid.getNearby(p.pos, 60);`
         - Find the first living enemy where `Math.hypot(enemy.pos.x - p.pos.x, enemy.pos.y - p.pos.y) <= 24 + enemy.radius && Math.abs(enemy.z - p.z) <= 55`.
         - If found:
           ```typescript
           p.dashShockwaveTriggered = true;
           const impactDmg = (p.equippedSkills.utility.baseDamage || 48) * 1.25 * p.calculatedStats.damageMultiplier;
           this.damageEnemy(hitEnemy, impactDmg, hitEnemy.pos);

           const shockRadius = 115 * (p.calculatedStats.aoeRadiusMultiplier || 1.0);
           const shockDmg = (p.equippedSkills.utility.baseDamage || 48) * p.calculatedStats.damageMultiplier;
           const shockVictims = this.spatialGrid.getNearby(hitEnemy.pos, shockRadius);
           for (const v of shockVictims) {
             if (v.health > 0 && v.id !== hitEnemy.id && Math.abs(v.z - p.z) <= 65) {
               this.damageEnemy(v, shockDmg, hitEnemy.pos);
               const kdx = v.pos.x - hitEnemy.pos.x;
               const kdy = v.pos.y - hitEnemy.pos.y;
               const klen = Math.hypot(kdx, kdy) || 1;
               v.velocity.x += (kdx / klen) * 240;
               v.velocity.y += (kdy / klen) * 240;
             }
           }
           this.state.events.push({
             type: 'dash_shockwave',
             data: { pos: { ...hitEnemy.pos }, z: p.z, radius: shockRadius }
           });
           ```
     - **If `p.equippedSkills.utility.id === 'medical_rush'` (Doctor's Pass-Through Medical Rush):**
       - Do **not** stop on enemies and do **not** trigger a shockwave.
       - Perform swept segment distance check from `prevPos` to `p.pos` against nearby enemies (`this.spatialGrid.getNearby(p.pos, 80)`):
         ```typescript
         const segDx = p.pos.x - prevPos.x;
         const segDy = p.pos.y - prevPos.y;
         const segLenSq = segDx * segDx + segDy * segDy;
         const rushDmg = (p.equippedSkills.utility.baseDamage || 45) * p.calculatedStats.damageMultiplier;
         const candidates = this.spatialGrid.getNearby(p.pos, 80);
         for (const enemy of candidates) {
           if (enemy.health <= 0 || p.dashHitIds?.has(enemy.id)) continue;
           if (Math.abs(enemy.z - p.z) > 60) continue;
           let t = 1;
           if (segLenSq > 0.0001) {
             t = Math.max(0, Math.min(1, ((enemy.pos.x - prevPos.x) * segDx + (enemy.pos.y - prevPos.y) * segDy) / segLenSq));
           }
           const closestX = prevPos.x + t * segDx;
           const closestY = prevPos.y + t * segDy;
           const dist = Math.hypot(enemy.pos.x - closestX, enemy.pos.y - closestY);
           if (dist <= 26 + enemy.radius) {
             p.dashHitIds?.add(enemy.id);
             this.damageEnemy(enemy, rushDmg, enemy.pos, 'medical' as any);
             this.state.events.push({
               type: 'medical_rush_hit',
               data: { pos: { ...enemy.pos }, z: enemy.z, damage: rushDmg }
             });
           }
         }
         ```
   - Also in `resolveObstacleCollisions` / enemy touch-damage checks: ensure that while `p.isDashing && p.equippedSkills.utility.id === 'medical_rush'`, Doctor passes freely through enemies without being blocked by them.

6. **Doctor's Alternating Twin Laser Pistols (`fireMedicalPulse`, around line 866):**
   - Update `fireMedicalPulse` so each shot alternates between `'left'` and `'right'` pistol positions:
     ```typescript
     private fireMedicalPulse(targetPos: Vector2, targetZ: number = this.state.player.z + 26): void {
       const p = this.state.player;
       const currentHand: 'left' | 'right' = p.pistolHand || 'left';
       p.pistolHand = currentHand === 'left' ? 'right' : 'left';
       const handSign = currentHand === 'left' ? -1 : 1;

       const baseOrigin = { x: p.pos.x, y: p.pos.y, z: p.z + 26 };
       const dx0 = targetPos.x - baseOrigin.x;
       const dy0 = targetPos.y - baseOrigin.y;
       const aimAngle = Math.atan2(dy0, dx0);

       // Offset perpendicular to aim direction for left (-11) vs right (+11) pistol muzzle
       const perpX = -Math.sin(aimAngle) * handSign * 11;
       const perpY = Math.cos(aimAngle) * handSign * 11;
       const origin = {
         x: baseOrigin.x + perpX,
         y: baseOrigin.y + perpY,
         z: baseOrigin.z
       };

       const dx = targetPos.x - origin.x;
       const dy = targetPos.y - origin.y;
       const dz = targetZ - origin.z;
       const dist3D = Math.hypot(dx, dy, dz) || 1;
       const baseAngle = Math.atan2(dy, dx);
       const pitch = Math.asin(Math.max(-0.95, Math.min(0.95, dz / dist3D)));

       const speed = 780 * (p.calculatedStats.projectileSpeedMultiplier || 1.0);
       const count = 1 + (p.calculatedStats.extraProjectiles || 0);
       const baseSpread = 0.18;
       const maxSpread = baseSpread * 2.5;
       const spread = count > 1 ? Math.min(maxSpread, baseSpread + (count - 2) * 0.07) : 0;
       const radius = 12 * (p.calculatedStats.projectileRadiusMultiplier || 1.0);
       const pierceCount = 1 + (p.calculatedStats.projectilePierce || 0);
       const dmgMult = p.calculatedStats.damageMultiplier * (p.inSanctuaryCross ? 1.25 : 1.0);

       this.setFacingToward(targetPos);

       for (let i = 0; i < count; i++) {
         const offset = count > 1 ? -spread / 2 + (spread / (count - 1)) * i : 0;
         const angle = baseAngle + offset;
         const horizSpeed = Math.cos(pitch) * speed;
         const vx = Math.cos(angle) * horizSpeed;
         const vy = Math.sin(angle) * horizSpeed;
         const vz = Math.sin(pitch) * speed;

         const proj: ProjectileState = {
           id: `proj_${this.nextProjId++}`,
           type: 'medical_pulse',
           pos: { x: origin.x, y: origin.y },
           z: origin.z,
           velocity: { x: vx, y: vy },
           vz,
           speed,
           damage: p.equippedSkills.primary.baseDamage * dmgMult,
           pierceCount,
           maxDistance: p.equippedSkills.primary.range * 1.25,
           distanceTraveled: 0,
           owner: 'player',
           radius,
           hitEnemyIds: new Set(),
           originZ: origin.z,
           targetZ,
           hand: currentHand
         };
         this.state.projectiles.push(proj);
       }
       this.state.events.push({
         type: 'pulse_fired',
         data: { from: { ...origin }, to: targetPos, z: p.z, variant: 'medical', hand: currentHand }
       });
     }
     ```

7. **Commander's Explosive Bomb (`fireExplosiveBomb`) & Detonation:**
   - In `updateSkills` (secondary slot, around line 799):
     ```typescript
     if (secDef.id === 'explosive_bomb') {
       this.fireExplosiveBomb(target, targetZ);
     } else if (secDef.id === 'toxic_contamination') {
       this.fireToxicContamination(target);
     } else if (secDef.id === 'sedative_dose') {
       this.fireSedativeDose(target, targetZ);
     } else if (secDef.id === 'cryo_grenade') {
       this.fireCryoGrenade(target, targetZ);
     } else if (secDef.id === 'gravity_vortex') {
       this.fireGravityVortex(target, targetZ);
     } else {
       this.firePiercingWave(target, targetZ);
     }
     ```
   - Implement `fireExplosiveBomb(targetPos: Vector2, targetZ: number = this.state.player.z)`:
     - Fires `1 + (p.calculatedStats.extraProjectiles || 0)` projectiles of `type: 'bomb'` in a ballistic arc (just like `fireCryoGrenade`, with `gravity = 360`, `vz = (dz / timeToTarget) + 0.5 * gravity * timeToTarget`, `pierceCount: 1`).
   - In `updateProjectiles(dt)`:
     - Include `proj.type === 'bomb'` in ballistic gravity (`if (proj.type === 'grenade' || proj.type === 'bomb' || proj.type === 'spore_bomb') proj.vz = (proj.vz ?? 0) - 360 * dt;`).
     - Create a helper `detonateExplosiveBomb(proj: ProjectileState)` called when a `'bomb'` projectile hits terrain, reaches `maxDistance`, or hits an enemy:
       ```typescript
       private detonateExplosiveBomb(proj: ProjectileState): void {
         const p = this.state.player;
         const blastRadius = 125 * (p.calculatedStats.aoeRadiusMultiplier || 1.0) * (p.calculatedStats.ultimateRadiusMultiplier || 1.0);
         const impactZ = this.state.terrain.calculateHeight(proj.pos.x, proj.pos.y);
         const victims = this.spatialGrid.getNearby(proj.pos, blastRadius);
         for (const v of victims) {
           if (v.health > 0 && Math.abs(v.z - impactZ) <= 75) {
             this.damageEnemy(v, proj.damage, proj.pos, 'ignite');
           }
         }
         this.state.events.push({
           type: 'orbital_impact',
           data: { target: { ...proj.pos }, radius: blastRadius, variant: 'nuke' }
         });
       }
       ```

8. **Doctor's Toxic Contamination (`fireToxicContamination` & `updateToxicFields`):**
   - Implement `fireToxicContamination(targetPos: Vector2)`:
     ```typescript
     private fireToxicContamination(targetPos: Vector2): void {
       const p = this.state.player;
       const secDef = p.equippedSkills.secondary;
       const dx = targetPos.x - p.pos.x;
       const dy = targetPos.y - p.pos.y;
       const dist = Math.hypot(dx, dy);
       const clampedDist = Math.min(dist, secDef.range);
       const deployX = dist > 1 ? p.pos.x + (dx / dist) * clampedDist : targetPos.x;
       const deployY = dist > 1 ? p.pos.y + (dy / dist) * clampedDist : targetPos.y;
       const deployZ = this.state.terrain.calculateHeight(deployX, deployY);

       this.setFacingToward({ x: deployX, y: deployY });

       const radius = 115 * (p.calculatedStats.aoeRadiusMultiplier || 1.0);
       const duration = 5.0 * (p.calculatedStats.skillDurationMultiplier || 1.0);
       const dmgMult = p.calculatedStats.damageMultiplier * (p.inSanctuaryCross ? 1.25 : 1.0);

       const field: ToxicFieldState = {
         id: `toxic_${Date.now()}_${this.nextProjId++}`,
         pos: { x: deployX, y: deployY },
         z: deployZ,
         radius,
         durationRemaining: duration,
         damagePerTick: secDef.baseDamage * dmgMult,
         tickInterval: 0.4,
         tickTimer: 0.05 // First tick almost immediately upon deployment
       };
       this.state.toxicFields.push(field);
       this.state.events.push({
         type: 'toxic_field_deployed',
         data: { pos: { ...field.pos }, z: deployZ, radius, duration }
       });
     }
     ```
   - Implement `updateToxicFields(dt: number)`:
     ```typescript
     private updateToxicFields(dt: number): void {
       const alive: ToxicFieldState[] = [];
       for (let i = 0; i < this.state.toxicFields.length; i++) {
         const field = this.state.toxicFields[i];
         field.durationRemaining -= dt;
         field.tickTimer -= dt;

         if (field.tickTimer <= 0) {
           field.tickTimer += field.tickInterval;
           const victims = this.spatialGrid.getNearby(field.pos, field.radius);
           for (const enemy of victims) {
             if (enemy.health <= 0) continue;
             const dist = Math.hypot(enemy.pos.x - field.pos.x, enemy.pos.y - field.pos.y);
             if (dist <= field.radius && Math.abs(enemy.z - field.z) <= 65) {
               enemy.isToxic = true;
               enemy.toxicTimer = 2.0;
               this.damageEnemy(enemy, field.damagePerTick, enemy.pos, 'void');
             }
           }
         }

         if (field.durationRemaining > 0) {
           alive.push(field);
         }
       }
       this.state.toxicFields = alive;
     }
     ```

9. **Doctor's Ultimate: Sanctuary Cross (`fireSanctuaryCross` & `updateSanctuaryCrosses`):**
   - In `updateSkills` (ultimate slot, around line 820):
     ```typescript
     if (ultDef.id === 'sanctuary_cross') {
       this.fireSanctuaryCross(playerPos);
     } else if (ultDef.id === 'emergency_protocol') {
       this.fireEmergencyProtocol(playerPos);
     ...
     ```
   - Implement `fireSanctuaryCross(playerPos: Vector2)`:
     ```typescript
     private fireSanctuaryCross(playerPos: Vector2): void {
       const p = this.state.player;
       const ultDef = p.equippedSkills.ultimate;
       const aoeScale = (p.calculatedStats.aoeRadiusMultiplier || 1.0) * (p.calculatedStats.ultimateRadiusMultiplier || 1.0);
       const duration = 7.0 * (p.calculatedStats.skillDurationMultiplier || 1.0); // Exactly 7.0s base duration
       const groundZ = this.state.terrain.calculateHeight(playerPos.x, playerPos.y);

       const cross: SanctuaryCrossState = {
         id: `cross_${Date.now()}_${this.nextStrikeId++}`,
         pos: { x: playerPos.x, y: playerPos.y },
         z: groundZ,
         armHalfLength: 220 * aoeScale,
         armHalfWidth: 55 * aoeScale,
         durationRemaining: duration,
         maxDuration: duration,
         healPerSecond: 20 * (p.calculatedStats.healingMultiplier || 1.0),
         damagePerPulse: ultDef.baseDamage * p.calculatedStats.damageMultiplier,
         pulseInterval: 1.0,
         pulseTimer: 0.05, // Pulse immediately on activation, then every 1.0s
         stunDuration: 0.65 // Controlled short incapacitation (0.65s stun per 1.0s pulse -> never perma-locks)
       };

       this.state.sanctuaryCrosses.push(cross);
       this.state.events.push({
         type: 'sanctuary_cross_deployed',
         data: {
           pos: { ...cross.pos },
           z: groundZ,
           armHalfLength: cross.armHalfLength,
           armHalfWidth: cross.armHalfWidth,
           duration
         }
       });
     }
     ```
   - Implement `updateSanctuaryCrosses(dt: number)`:
     ```typescript
     private updateSanctuaryCrosses(dt: number): void {
       const p = this.state.player;
       const alive: SanctuaryCrossState[] = [];
       let playerInsideAnyCross = false;

       for (let i = 0; i < this.state.sanctuaryCrosses.length; i++) {
         const cross = this.state.sanctuaryCrosses[i];
         cross.durationRemaining -= dt;

         // 1. Check if Doctor/Player is inside the thick cross arms at matching elevation
         if (this.isPointInSanctuaryCross(p.pos, p.z, cross)) {
           playerInsideAnyCross = true;
           if (p.health < p.maxHealth) {
             p.health = Math.min(p.maxHealth, p.health + cross.healPerSecond * dt);
           }
         }

         // 2. Rhythmic Pulse affecting enemies inside the cross arms
         cross.pulseTimer -= dt;
         if (cross.pulseTimer <= 0) {
           cross.pulseTimer += cross.pulseInterval;
           const searchRadius = cross.armHalfLength * 1.15;
           const candidates = this.spatialGrid.getNearby(cross.pos, searchRadius);
           for (const enemy of candidates) {
             if (enemy.health <= 0) continue;
             if (this.isPointInSanctuaryCross(enemy.pos, enemy.z, cross)) {
               this.damageEnemy(enemy, cross.damagePerPulse, enemy.pos, 'medical' as any);
               // Controlled incapacitation: only apply if not already stunned, for 0.65s out of 1.0s interval
               if (!enemy.isStunned || (enemy.stunTimer ?? 0) < cross.stunDuration) {
                 enemy.isStunned = true;
                 enemy.stunTimer = cross.stunDuration;
                 enemy.velocity.x = 0;
                 enemy.velocity.y = 0;
               }
             }
           }
           this.state.events.push({
             type: 'sanctuary_pulse',
             data: {
               pos: { ...cross.pos },
               z: cross.z,
               armHalfLength: cross.armHalfLength,
               armHalfWidth: cross.armHalfWidth
             }
           });
         }

         if (cross.durationRemaining > 0) {
           alive.push(cross);
         }
       }

       this.state.sanctuaryCrosses = alive;
       p.inSanctuaryCross = playerInsideAnyCross;
       // Dynamically update player moveSpeed & stats when inside/outside Sanctuary Cross
       const baseMove = p.calculatedStats.moveSpeed;
       p.moveSpeed = playerInsideAnyCross ? baseMove * 1.20 : baseMove;
     }
     ```
   - Also in `updateSkills(dt)`: when computing `primaryCd` and `secondaryCd`, multiply `stats.attackSpeedMultiplier` by `(p.inSanctuaryCross ? 1.25 : 1.0)` so Doctor (or any ally) gets the `+25%` attack speed boost while standing inside the Sanctuary Cross!

---

## STEP 5: Render the New Abilities in `src/render/ThreeApp.ts`

### Action:
In [`src/render/ThreeApp.ts`](../src/render/ThreeApp.ts):
1. In `syncProjectiles()`:
   - Add a branch for `proj.type === 'bomb'`: render a dark metallic military ordinance sphere with a glowing orange/red armed core (`SphereGeometry(7, 10, 10)` + glowing fuse ring) that tumbles in flight (`proj.type === 'grenade' || proj.type === 'bomb' || proj.type === 'spore_bomb'`).
   - Ensure `proj.type === 'medical_pulse'` renders as a sleek, elongated sci-fi laser blaster bolt (`CylinderGeometry(2.2, 2.2, 22, 8)` rotated along flight axis, vibrant cyan-emerald core `0x10b981` / `0x34d399`).
2. In `syncRecoveryFields(dt)`:
   - In addition to `recoveryFields`, sync `this.simulation.state.toxicFields` and `this.simulation.state.sanctuaryCrosses`:
     - **Toxic Contamination (`toxicFields`):** Render a ground-hugging bio-toxic pool (`CircleGeometry(field.radius, 32)` in lime-green `0x84cc16`, opacity `0.38`, plus an outer toxic boundary ring `RingGeometry(field.radius * 0.94, field.radius, 36)` in `0xa3e635`).
     - **Sanctuary Cross (`sanctuaryCrosses`):** Render a **massive, unmistakable thick 3D Cross on the ground** (NOT a circle!):
       - Horizontal arm: `BoxGeometry(cross.armHalfLength * 2, 4, cross.armHalfWidth * 2)` in luminous medical teal-gold (`0x34d399`, emissive/basic opacity `0.55`).
       - Vertical arm: `BoxGeometry(cross.armHalfWidth * 2, 4, cross.armHalfLength * 2)` in `0x34d399`.
       - Inner bright core bars along both arms (`BoxGeometry(cross.armHalfLength * 1.9, 5, cross.armHalfWidth * 0.5)` and `BoxGeometry(cross.armHalfWidth * 0.5, 5, cross.armHalfLength * 1.9)`) in `0xecfdf5` that pulsate rhythmically (`const pulse = 0.65 + 0.35 * Math.sin(performance.now() * 0.008);`) and expand traveling energy bars along the two arms!
3. In `processEvents(events)`:
   - Handle `'dash_shockwave'`: call `this.vfx.spawnShockwaveRing(e.data.pos, e.data.radius, 0xf59e0b, e.data.z, 0.9);` and `this.addCameraTrauma(0.35);`.
   - Handle `'toxic_field_deployed'`: call `this.vfx.spawnShockwaveRing(e.data.pos, e.data.radius, 0x84cc16, e.data.z, 0.7);`.
   - Handle `'sanctuary_cross_deployed'` and `'sanctuary_pulse'`: play wave/orbital sound and trigger a pulse effect at `e.data.pos`.

---

## STEP 6: Required Verification Suite (`scratch/verify_skills_and_buffs.ts`)

Create and run `npx tsx scratch/verify_skills_and_buffs.ts` to verify all 12 required gameplay tests:
1. Commander starts with Service Pistol (`energy_pulse`), Explosive Bomb (`explosive_bomb`), Impact Dash (`tactical_dash`), and Orbital Strike (`orbital_judgment`).
2. Doctor starts with Twin Laser Pistols (`medical_pulse`), Toxic Contamination (`toxic_contamination`), Medical Rush (`medical_rush`), and Sanctuary Cross (`sanctuary_cross`).
3. Doctor's Twin Laser Pistols alternate `left -> right -> left -> right` with distinct left/right muzzle offsets.
4. Commander's Impact Dash triggers a one-time shockwave on enemy collision (damaging primary target + nearby enemies once per dash, not every frame).
5. Doctor's Medical Rush travels **2×** Commander's dash distance, passes through enemies, heals Doctor once, and damages each enemy along the path once without triggering a shockwave.
6. Sanctuary Cross lasts **exactly 7.0 seconds**, uses true cross geometry (affecting entities inside the 2 intersecting arms while ignoring entities in the diagonal corners or on different elevations), heals/buffs Doctor (`+moveSpeed`, `+damage`, `+attackSpeed`), pulses damage/controlled stun on enemies inside the cross, and removes buffs after 7s.
7. Projectile Count `+1` (`buff_multi_barrel`) adds projectiles to Commander's Pistol, Commander's Bomb, and Doctor's Twin Laser Pistols while preserving left/right alternation.
8. Category B buffs (`buff_pulse_power`, `buff_overdrive`, `buff_orbital_cap`, `buff_vital_core`) strengthen abilities without replacing them.
9. Category A replacement skills (`scatter_blaster`, `cryo_grenade`, `blink_warp`, `carpet_nuke`) still replace their respective slot when selected.
10. Compatible buffs continue enhancing replacement skills after replacement.
11. Switching between Commander and Doctor preserves independent loadouts without overwriting each other.
12. 3D projectile collision, LOS targeting, and terrain elevation checks remain 100% functional (`npx tsx scratch/test_astar.ts` and `npm run build`).


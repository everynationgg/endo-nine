# ENDO NINE — Commander Skill VFX Overhaul Execution Guide (For Gemini 3.8)

## Objective
Implement the **Commander Skill VFX Overhaul** for Commander's three non-ultimate abilities (**LMB Gold Blaster Bolt**, **RMB Twin Converging Slashes + Inward Pull**, and **Dash Kinetic Impact**) so each ability has a distinct visual identity, hierarchy, and impact without competing with or reusing **Orbital Strike (R)**.

Execute **Steps 1 through 5** in exact order. Do not skip any step.

---

## Step 1: Update RMB Inward Pull & Event Metadata in `src/sim/Simulation.ts`

We need four small, targeted updates in [`src/sim/Simulation.ts`](file:///c:/Users/yoggn/Desktop/Ender%20Nine/src/sim/Simulation.ts):
1. In `dash_shockwave` (around line 620–644): apply outward knockback velocity to `primaryHit` as well as nearby enemies, and include `dir: { ...p.dashDir }` in the `dash_shockwave` event payload.
2. In `fireExplosiveBomb` & `detonateExplosiveBomb` (around lines 1106–1184):
   - Make `bomb` travel on a direct, terrain-hugging trajectory (`vz = dz / flightTime`) rather than a high mortar lob so the Twin Converging Slashes sweep cleanly across the battlefield.
   - Flip the detonation knockback in `detonateExplosiveBomb` from an outward push to an **inward convergence pull** toward `proj.pos` (both velocity impulse and immediate inward position pull).
   - Include `angle: Math.atan2(proj.velocity.y, proj.velocity.x)` in the `orbital_impact` (`variant: 'bomb'`) event payload.
3. In `updateProjectiles` (around lines 2046–2050, 2116–2119, 2192, 2245, 2286):
   - Include `vx: proj.velocity.x, vy: proj.velocity.y` in `pistol_shot_released` so the golden muzzle flash aligns with the barrel vector.
   - Remove ballistic gravity from `proj.type === 'bomb'` so the twin slashes don't arc into the sky, and add a gentle inward lateral pull on nearby enemies while the twin slashes sweep forward.

### 1A. Edit `dash_shockwave` in `src/sim/Simulation.ts` (around lines 620–644)
Use `edit_file` on `src/sim/Simulation.ts`:

**Target:**
```ts
          // Primary enemy takes direct impact damage
          this.damageEnemy(primaryHit, directDmg, impactPos);

          // Nearby enemies take shockwave area damage once per dash impact
          const nearby = this.spatialGrid.getNearby(impactPos, shockRadius);
          for (let j = 0; j < nearby.length; j++) {
            const v = nearby[j];
            if (v.health <= 0 || v.id === primaryHit.id) continue;
            if (Math.abs(v.z - primaryHit.z) > 65) continue;
            const d = Math.hypot(v.pos.x - impactPos.x, v.pos.y - impactPos.y);
            if (d <= shockRadius + v.radius) {
              this.damageEnemy(v, directDmg * 0.85, impactPos);
              const kdx = v.pos.x - impactPos.x;
              const kdy = v.pos.y - impactPos.y;
              const klen = Math.hypot(kdx, kdy) || 1;
              v.velocity.x += (kdx / klen) * 280;
              v.velocity.y += (kdy / klen) * 280;
            }
          }

          this.state.events.push({
            type: 'dash_shockwave',
            data: { pos: impactPos, z: primaryHit.z, radius: shockRadius }
          });
```

**Replacement:**
```ts
          // Primary enemy takes direct impact damage + directional kinetic knockback
          this.damageEnemy(primaryHit, directDmg, impactPos);
          primaryHit.velocity.x += p.dashDir.x * 320;
          primaryHit.velocity.y += p.dashDir.y * 320;

          // Nearby enemies take shockwave area damage once per dash impact
          const nearby = this.spatialGrid.getNearby(impactPos, shockRadius);
          for (let j = 0; j < nearby.length; j++) {
            const v = nearby[j];
            if (v.health <= 0 || v.id === primaryHit.id) continue;
            if (Math.abs(v.z - primaryHit.z) > 65) continue;
            const d = Math.hypot(v.pos.x - impactPos.x, v.pos.y - impactPos.y);
            if (d <= shockRadius + v.radius) {
              this.damageEnemy(v, directDmg * 0.85, impactPos);
              const kdx = v.pos.x - impactPos.x;
              const kdy = v.pos.y - impactPos.y;
              const klen = Math.hypot(kdx, kdy) || 1;
              v.velocity.x += (kdx / klen) * 280;
              v.velocity.y += (kdy / klen) * 280;
            }
          }

          this.state.events.push({
            type: 'dash_shockwave',
            data: { pos: impactPos, z: primaryHit.z, radius: shockRadius, dir: { ...p.dashDir } }
          });
```

### 1B. Edit `fireExplosiveBomb` and `detonateExplosiveBomb` in `src/sim/Simulation.ts` (around lines 1106–1185)
Use `edit_file` on `src/sim/Simulation.ts`:

**Target:**
```ts
    const speed = 520 * (p.calculatedStats.projectileSpeedMultiplier || 1.0);
    const flightTime = Math.max(0.28, horizDist / speed);
    const gravity = 360;
    const dz = targetZ - origin.z;
    // Lobbed ballistic trajectory so the bomb arcs naturally upward before descending onto the target elevation
    const vz = Math.max(95, (dz / flightTime) + 0.5 * gravity * flightTime);

    const count = 1 + (p.calculatedStats.extraProjectiles || 0);
    const spread = count > 1 ? Math.min(0.45, 0.18 + (count - 2) * 0.08) : 0;
    const radius = 16 * (p.calculatedStats.projectileRadiusMultiplier || 1.0);

    this.setFacingToward(targetPos);

    for (let i = 0; i < count; i++) {
      const offset = count > 1 ? -spread / 2 + (spread / (count - 1)) * i : 0;
      const a = angle + offset;
      const proj: ProjectileState = {
        id: `proj_${this.nextProjId++}`,
        type: 'bomb',
        pos: { x: origin.x, y: origin.y },
        z: origin.z,
        velocity: { x: Math.cos(a) * speed, y: Math.sin(a) * speed },
        vz,
        speed,
        damage: p.equippedSkills.secondary.baseDamage * p.calculatedStats.damageMultiplier,
        pierceCount: 1,
        maxDistance: horizDist,
        distanceTraveled: 0,
        owner: 'player',
        radius,
        hitEnemyIds: new Set(),
        originZ: origin.z,
        targetZ
      };
      this.state.projectiles.push(proj);
    }

    this.state.events.push({
      type: 'wave_fired',
      data: { from: { ...p.pos }, to: targetPos, variant: 'bomb' }
    });
  }

  private detonateExplosiveBomb(proj: ProjectileState): void {
    const p = this.state.player;
    const radiusMult = (p.calculatedStats.aoeRadiusMultiplier || 1.0) * (p.calculatedStats.ultimateRadiusMultiplier || 1.0);
    const blastRadius = 125 * radiusMult;
    const impactZ = proj.z ?? this.state.terrain.calculateHeight(proj.pos.x, proj.pos.y);

    const victims = this.spatialGrid.getNearby(proj.pos, blastRadius);
    for (let i = 0; i < victims.length; i++) {
      const v = victims[i];
      if (v.health <= 0) continue;
      // Respect terrain elevation difference so bombs don't ignore huge vertical cliffs
      if (Math.abs(v.z - impactZ) > 75) continue;
      const dist = Math.hypot(v.pos.x - proj.pos.x, v.pos.y - proj.pos.y);
      if (dist <= blastRadius + v.radius) {
        this.damageEnemy(v, proj.damage, proj.pos, 'ignite');
        const kdx = v.pos.x - proj.pos.x;
        const kdy = v.pos.y - proj.pos.y;
        const klen = Math.hypot(kdx, kdy) || 1;
        v.velocity.x += (kdx / klen) * 260;
        v.velocity.y += (kdy / klen) * 260;
      }
    }

    this.state.events.push({
      type: 'orbital_impact',
      data: { target: { ...proj.pos }, z: impactZ, radius: blastRadius, variant: 'bomb' }
    });
  }
```

**Replacement:**
```ts
    const speed = 520 * (p.calculatedStats.projectileSpeedMultiplier || 1.0);
    const flightTime = Math.max(0.18, horizDist / speed);
    const dz = targetZ - origin.z;
    // Direct sweeping trajectory for Twin Converging Slashes
    const vz = dz / flightTime;

    const count = 1 + (p.calculatedStats.extraProjectiles || 0);
    const spread = count > 1 ? Math.min(0.45, 0.18 + (count - 2) * 0.08) : 0;
    const radius = 16 * (p.calculatedStats.projectileRadiusMultiplier || 1.0);

    this.setFacingToward(targetPos);

    for (let i = 0; i < count; i++) {
      const offset = count > 1 ? -spread / 2 + (spread / (count - 1)) * i : 0;
      const a = angle + offset;
      const proj: ProjectileState = {
        id: `proj_${this.nextProjId++}`,
        type: 'bomb',
        pos: { x: origin.x, y: origin.y },
        z: origin.z,
        velocity: { x: Math.cos(a) * speed, y: Math.sin(a) * speed },
        vz,
        speed,
        damage: p.equippedSkills.secondary.baseDamage * p.calculatedStats.damageMultiplier,
        pierceCount: 1,
        maxDistance: horizDist,
        distanceTraveled: 0,
        owner: 'player',
        radius,
        hitEnemyIds: new Set(),
        originZ: origin.z,
        targetZ
      };
      this.state.projectiles.push(proj);
    }

    this.state.events.push({
      type: 'wave_fired',
      data: { from: { ...p.pos }, to: targetPos, variant: 'bomb', angle }
    });
  }

  private detonateExplosiveBomb(proj: ProjectileState): void {
    const p = this.state.player;
    const radiusMult = (p.calculatedStats.aoeRadiusMultiplier || 1.0) * (p.calculatedStats.ultimateRadiusMultiplier || 1.0);
    const blastRadius = 125 * radiusMult;
    const impactZ = proj.z ?? this.state.terrain.calculateHeight(proj.pos.x, proj.pos.y);
    const slashAngle = Math.atan2(proj.velocity.y, proj.velocity.x);

    const victims = this.spatialGrid.getNearby(proj.pos, blastRadius);
    for (let i = 0; i < victims.length; i++) {
      const v = victims[i];
      if (v.health <= 0) continue;
      // Respect terrain elevation difference so slashes don't ignore huge vertical cliffs
      if (Math.abs(v.z - impactZ) > 75) continue;
      const dist = Math.hypot(v.pos.x - proj.pos.x, v.pos.y - proj.pos.y);
      if (dist <= blastRadius + v.radius) {
        this.damageEnemy(v, proj.damage, proj.pos, 'ignite');
        // Pull enemies INWARD toward the twin-slash convergence center!
        const pullDx = proj.pos.x - v.pos.x;
        const pullDy = proj.pos.y - v.pos.y;
        const pullLen = Math.hypot(pullDx, pullDy) || 1;
        const pullImpulse = 260 * Math.min(1.0, (pullLen / blastRadius) + 0.35);
        v.velocity.x += (pullDx / pullLen) * pullImpulse;
        v.velocity.y += (pullDy / pullLen) * pullImpulse;
        const stepIn = Math.min(pullLen * 0.45, 36);
        v.pos.x += (pullDx / pullLen) * stepIn;
        v.pos.y += (pullDy / pullLen) * stepIn;
      }
    }

    this.state.events.push({
      type: 'orbital_impact',
      data: { target: { ...proj.pos }, z: impactZ, radius: blastRadius, variant: 'bomb', angle: slashAngle }
    });
  }
```

### 1C. Edit `updateProjectiles` in `src/sim/Simulation.ts` (around lines 2045–2052, 2116–2120, and 2244–2260)
Use `edit_file` on `src/sim/Simulation.ts`:

1. Update `pistol_shot_released` (around line 2046) to include velocity `vx` and `vy`:
**Target:**
```ts
          this.state.events.push({
            type: 'pistol_shot_released',
            data: { id: proj.id, from: { ...proj.pos }, z: proj.z, facing: p.facing }
          });
```
**Replacement:**
```ts
          this.state.events.push({
            type: 'pistol_shot_released',
            data: { id: proj.id, from: { ...proj.pos }, z: proj.z, facing: p.facing, vx: proj.velocity.x, vy: proj.velocity.y }
          });
```

2. Remove gravity from `proj.type === 'bomb'` (around line 2116):
**Target:**
```ts
      // Ballistic gravity for grenades, bombs & spore bombs
      if (proj.type === 'grenade' || proj.type === 'spore_bomb' || proj.type === 'bomb') {
        proj.vz = (proj.vz ?? 0) - 360 * dt;
      }
```
**Replacement:**
```ts
      // Ballistic gravity for grenades & spore bombs (twin slashes glide smoothly along aim plane)
      if (proj.type === 'grenade' || proj.type === 'spore_bomb') {
        proj.vz = (proj.vz ?? 0) - 360 * dt;
      }
```

3. Add in-flight lateral sweep pull for `proj.type === 'bomb'` right after the `vortex` pull block (around line 2258):
**Target:**
```ts
      // Gravitational pull for Vortex orbs in flight
      if (proj.type === 'vortex' && !proj.isAnchored) {
        const pullRadius = 160 * (p.calculatedStats.aoeRadiusMultiplier || 1.0);
        const victims = this.spatialGrid.getNearby(proj.pos, pullRadius);
        for (const v of victims) {
          if (v.health <= 0) continue;
          const vdx = proj.pos.x - v.pos.x;
          const vdy = proj.pos.y - v.pos.y;
          const vdist = Math.hypot(vdx, vdy);
          if (vdist > 5) {
            v.pos.x += (vdx / vdist) * 160 * dt;
            v.pos.y += (vdy / vdist) * 160 * dt;
          }
        }
      }
```
**Replacement:**
```ts
      // Gravitational pull for Vortex orbs in flight
      if (proj.type === 'vortex' && !proj.isAnchored) {
        const pullRadius = 160 * (p.calculatedStats.aoeRadiusMultiplier || 1.0);
        const victims = this.spatialGrid.getNearby(proj.pos, pullRadius);
        for (const v of victims) {
          if (v.health <= 0) continue;
          const vdx = proj.pos.x - v.pos.x;
          const vdy = proj.pos.y - v.pos.y;
          const vdist = Math.hypot(vdx, vdy);
          if (vdist > 5) {
            v.pos.x += (vdx / vdist) * 160 * dt;
            v.pos.y += (vdy / vdist) * 160 * dt;
          }
        }
      }

      // Twin Converging Slashes (bomb): herd enemies inward toward the centerline as the blades sweep forward
      if (proj.type === 'bomb') {
        const sweepRadius = 95 * (p.calculatedStats.aoeRadiusMultiplier || 1.0);
        const victims = this.spatialGrid.getNearby(proj.pos, sweepRadius);
        for (const v of victims) {
          if (v.health <= 0) continue;
          const vdx = proj.pos.x - v.pos.x;
          const vdy = proj.pos.y - v.pos.y;
          const vdist = Math.hypot(vdx, vdy);
          if (vdist > 6) {
            v.pos.x += (vdx / vdist) * 185 * dt;
            v.pos.y += (vdy / vdist) * 185 * dt;
          }
        }
      }
```

---

## Step 2: Implement LMB, RMB & Dash VFX Systems in `src/render/ThreeVFX.ts`

In [`src/render/ThreeVFX.ts`](file:///c:/Users/yoggn/Desktop/Ender%20Nine/src/render/ThreeVFX.ts), we will add:
1. **Strict Orbital Strike Isolation:** In `spawnOrbitalBlast` (line 384), include `variant === 'acid'` in the non-beam dome branch (`if (variant === 'cryo' || variant === 'vortex' || variant === 'acid')`) so enemy spore bombs never trigger an orbital beam.
2. **LMB VFX Methods:**
   - `spawnBlasterMuzzleFlash(pos: Vector2, elevation: number, vx: number, vy: number)`: Spawns a crisp 6-point golden-white starburst flash + thin barrel shock ring (`0.09s` lifetime) at the pistol muzzle when `pistol_shot_released` fires.
   - `spawnBlasterImpactSpark(pos: Vector2, elevation: number)`: Spawns a compact golden-white starburst spark + 6 fast radial micro-sparks (`0.15s` lifetime) when a `pulse` bolt hits an enemy or terrain.
3. **RMB VFX Methods:**
   - `createTwinSlashProjectileGroup(): THREE.Group`: Creates the 3D group for `proj.type === 'bomb'` containing two sculpted curved golden crescent blades (`leftBlade`, `rightBlade` with custom GLSL crescent energy blade shader featuring a white-gold cutting edge, amber hex-tech body, and fading wake) + inward-pointing golden chevron indicators (`leftChevrons`, `rightChevrons`).
   - `updateTwinSlashProjectileGroup(grp: THREE.Group, progress: number, dt: number, worldPos: Vector2, elevation: number)`: Animates **Phase 1 (Initial Slashes)** -> **Phase 2 (Convergence)** as the slashes sweep forward (`lateralOffset` narrows from `±54` to `±6`, blades rotate inward toward the center, and subtle amber trail particles spawn along the blade tips).
   - `spawnTwinSlashConvergence(pos: Vector2, elevation: number, radius: number, angle: number)`: Handles **Phase 3 (Collision)** & **Phase 4 (Dissipation)** when the twin slashes meet at the target point—spawning a compact golden cross-slash collision burst, inward compression lines, and 14 golden sparks that rapidly dissipate (`0.30s` total lifetime, zero orbital beam, zero lingering ground decal).
4. **Dash VFX Methods:**
   - `spawnDashChargeTrail(pos: Vector2, elevation: number, dir: Vector2, duration: number)`: Initializes **Phase 1 (Acceleration)** & **Phase 2 (Charge)** when Commander dashes—creating narrow golden-white and violet-accented speed streaks, a V-shaped golden kinetic nose-cone aura, and subtle ground dust puffs.
   - `updateDashChargeFollow(pos: Vector2, elevation: number, dir: Vector2, dt: number)`: Keeps the active dash speed streaks anchored to Commander during the dash and spawns subtle low-profile ground dust puffs behind his boots.
   - `spawnDashKineticImpact(pos: Vector2, elevation: number, radius: number, dir: Vector2)`: Triggered **only** on `dash_shockwave` (**Phase 3 — Impact** & **Phase 4 — Recovery**)—spawning a concentrated golden-white starburst flash, a small tech impact ring, sharp directional outward force spikes/streaks emphasizing knockback, a fast thin pressure ring (`0.28s`), and 16 small dust/pebble particles.

### 2A. Add Active Interfaces & State Arrays to `src/render/ThreeVFX.ts`
In `src/render/ThreeVFX.ts`, right after `interface ActiveOrbitalParticle` (around line 97), add the new interfaces:

```ts
interface ActiveSlashConvergence {
  group: THREE.Group;
  flashMesh: THREE.Mesh;
  flashMat: THREE.ShaderMaterial;
  leftBladeMesh: THREE.Mesh;
  leftBladeMat: THREE.ShaderMaterial;
  rightBladeMesh: THREE.Mesh;
  rightBladeMat: THREE.ShaderMaterial;
  compressionLines: THREE.LineSegments;
  compressionMat: THREE.LineBasicMaterial;
  elapsed: number;
  maxLifetime: number;
}

interface ActiveDashTrail {
  group: THREE.Group;
  noseConeMesh: THREE.Mesh;
  noseConeMat: THREE.ShaderMaterial;
  streakMeshes: THREE.Mesh[];
  streakMats: THREE.MeshBasicMaterial[];
  dir: Vector2;
  elapsed: number;
  dashDuration: number;
  totalLifetime: number;
  dustTimer: number;
}

interface ActiveDashImpact {
  group: THREE.Group;
  flashMesh: THREE.Mesh;
  flashMat: THREE.ShaderMaterial;
  ringMesh: THREE.Mesh;
  ringMat: THREE.ShaderMaterial;
  spikesLine: THREE.LineSegments;
  spikesMat: THREE.LineBasicMaterial;
  elapsed: number;
  maxLifetime: number;
  radius: number;
}
```

And inside `export class ThreeVFX` properties (around line 115), add:
```ts
  public slashConvergences: ActiveSlashConvergence[] = [];
  public dashTrails: ActiveDashTrail[] = [];
  public dashImpacts: ActiveDashImpact[] = [];
  public blasterFlashes: ActiveBeam[] = [];
```
*(Making these arrays `public` allows our automated verification script to inspect active VFX counts directly! Also change `private orbitalSequences` to `public orbitalSequences` so tests can verify `orbitalSequences.length === 0` for non-ultimates.)*

### 2B. Update `spawnOrbitalBlast` in `src/render/ThreeVFX.ts` (around line 384)
Update the dome check so `'acid'` is also handled as a non-beam dome:
```ts
    if (variant === 'cryo' || variant === 'vortex' || variant === 'acid') {
      const domeColor = variant === 'cryo' ? 0x06b6d4 : variant === 'acid' ? 0x84cc16 : 0x7c3aed;
```

### 2C. Add the New Commander Skill VFX Methods to `src/render/ThreeVFX.ts`
Add the following methods to `ThreeVFX` right before `public update(dt: number, camera: THREE.Camera): void`:

```ts
  // ==========================================================================
  // COMMANDER SKILL 1 (LMB): GOLD BLASTER BOLT, MUZZLE FLASH & IMPACT SPARK
  // ==========================================================================

  public createGoldenBlasterBoltGroup(): THREE.Group {
    const grp = new THREE.Group();

    // 1. Brilliant Yellow-White Tapered Energy Core
    const coreCylGeo = new THREE.CylinderGeometry(1.7, 0.7, 22, 8);
    coreCylGeo.rotateX(Math.PI / 2);
    const coreCylMat = new THREE.MeshBasicMaterial({ color: 0xffffff });
    grp.add(new THREE.Mesh(coreCylGeo, coreCylMat));

    const tipConeGeo = new THREE.ConeGeometry(2.1, 10, 8);
    tipConeGeo.rotateX(Math.PI / 2);
    tipConeGeo.translate(0, 0, 14);
    const tipConeMat = new THREE.MeshBasicMaterial({ color: 0xfef08a });
    grp.add(new THREE.Mesh(tipConeGeo, tipConeMat));

    // 2. Thin Golden-Orange Outer Glow Sheath
    const glowGeo = new THREE.CylinderGeometry(3.4, 1.1, 28, 8);
    glowGeo.rotateX(Math.PI / 2);
    glowGeo.translate(0, 0, -1);
    const glowMat = new THREE.MeshBasicMaterial({
      color: 0xf59e0b,
      transparent: true,
      opacity: 0.75,
      blending: THREE.AdditiveBlending,
      depthWrite: false
    });
    grp.add(new THREE.Mesh(glowGeo, glowMat));

    // 3. Subtle Tapered Light Trail + Parallel Tracer Threads (Crossed Planes)
    const trailShaderMat = new THREE.ShaderMaterial({
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      side: THREE.DoubleSide,
      uniforms: {
        uCoreCol: { value: new THREE.Color(0xfef08a) },
        uEdgeCol: { value: new THREE.Color(0xf97316) }
      },
      vertexShader: `
        varying vec2 vUv;
        void main() {
          vUv = uv;
          gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
        }
      `,
      fragmentShader: `
        uniform vec3 uCoreCol;
        uniform vec3 uEdgeCol;
        varying vec2 vUv;
        void main() {
          // vUv.y goes 0 (tail) -> 1 (head near bolt)
          float along = clamp(vUv.y, 0.0, 1.0);
          float across = abs(vUv.x - 0.5) * 2.0;
          float widthTaper = mix(0.22, 1.0, along);
          float coreLine = smoothstep(0.38 * widthTaper, 0.0, across);
          // Thin parallel side tracer lines matching Reference 3
          float sideThread = smoothstep(0.12, 0.0, abs(across - 0.72 * widthTaper)) * smoothstep(0.15, 0.85, along);
          float alpha = (coreLine * 0.85 + sideThread * 0.65) * pow(along, 1.45);
          if (alpha < 0.01) discard;
          vec3 col = mix(uEdgeCol, uCoreCol, coreLine);
          gl_FragColor = vec4(col, alpha);
        }
      `
    });

    const trailGeoH = new THREE.PlaneGeometry(7.5, 36);
    trailGeoH.rotateX(Math.PI / 2);
    trailGeoH.translate(0, 0, -16);
    grp.add(new THREE.Mesh(trailGeoH, trailShaderMat));

    const trailGeoV = new THREE.PlaneGeometry(7.5, 36);
    trailGeoV.rotateX(Math.PI / 2);
    trailGeoV.rotateZ(Math.PI / 2);
    trailGeoV.translate(0, 0, -16);
    grp.add(new THREE.Mesh(trailGeoV, trailShaderMat.clone()));

    return grp;
  }

  public spawnBlasterMuzzleFlash(
    pos: Vector2,
    elevation: number = 26,
    vx: number = 1,
    vy: number = 0
  ): void {
    const angle = Math.atan2(vx, vy);

    // 1. Crisp Golden Starburst Muzzle Flash
    const flashGeo = new THREE.PlaneGeometry(24, 24);
    flashGeo.rotateX(-Math.PI / 2);
    const flashMat = new THREE.ShaderMaterial({
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      side: THREE.DoubleSide,
      uniforms: {
        uAngle: { value: angle }
      },
      vertexShader: `
        varying vec2 vUv;
        void main() {
          vUv = uv * 2.0 - 1.0;
          gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
        }
      `,
      fragmentShader: `
        uniform float uAngle;
        varying vec2 vUv;
        void main() {
          float r = length(vUv);
          if (r > 1.0) discard;
          float a = atan(vUv.y, vUv.x) - uAngle;
          float spikes = pow(abs(cos(a * 3.0)), 6.0) * smoothstep(1.0, 0.08, r);
          float core = smoothstep(0.42, 0.0, r);
          float ring = smoothstep(0.06, 0.0, abs(r - 0.68)) * 0.65;
          float alpha = clamp(core + spikes * 0.9 + ring, 0.0, 1.0);
          vec3 col = mix(vec3(0.98, 0.55, 0.08), vec3(1.0, 0.98, 0.82), core + spikes * 0.5);
          gl_FragColor = vec4(col, alpha);
        }
      `
    });
    const flashMesh = new THREE.Mesh(flashGeo, flashMat);
    flashMesh.position.set(pos.x, elevation, pos.y);
    this.group.add(flashMesh);
    this.blasterFlashes.push({ mesh: flashMesh, lifetime: 0.09, maxLifetime: 0.09 });
  }

  public spawnBlasterImpactSpark(pos: Vector2, elevation: number = 20): void {
    // 1. Brief, Crisp Golden Starburst Impact Flash
    const sparkGeo = new THREE.PlaneGeometry(26, 26);
    sparkGeo.rotateX(-Math.PI / 2);
    const sparkMat = new THREE.ShaderMaterial({
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      side: THREE.DoubleSide,
      uniforms: {
        uSeed: { value: Math.random() * 6.28 }
      },
      vertexShader: `
        varying vec2 vUv;
        void main() {
          vUv = uv * 2.0 - 1.0;
          gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
        }
      `,
      fragmentShader: `
        uniform float uSeed;
        varying vec2 vUv;
        void main() {
          float r = length(vUv);
          if (r > 1.0) discard;
          float a = atan(vUv.y, vUv.x) + uSeed;
          float rays = pow(abs(cos(a * 4.0)), 8.0) * smoothstep(1.0, 0.05, r);
          float core = smoothstep(0.38, 0.0, r);
          float alpha = clamp(core + rays * 0.95, 0.0, 1.0);
          vec3 col = mix(vec3(0.98, 0.58, 0.08), vec3(1.0, 0.98, 0.85), core);
          gl_FragColor = vec4(col, alpha);
        }
      `
    });
    const sparkMesh = new THREE.Mesh(sparkGeo, sparkMat);
    sparkMesh.position.set(pos.x, elevation + 4, pos.y);
    this.group.add(sparkMesh);
    this.blasterFlashes.push({ mesh: sparkMesh, lifetime: 0.12, maxLifetime: 0.12 });

    // 2. 6 Minimal Radial Micro-Sparks
    const groundY = this.getTerrainHeight(pos.x, pos.y, elevation);
    for (let i = 0; i < 6; i++) {
      const ang = (i / 6) * Math.PI * 2 + (Math.random() - 0.5) * 0.4;
      const spd = 95 + Math.random() * 85;
      const mat = new THREE.MeshBasicMaterial({
        color: i % 2 === 0 ? 0xfef08a : 0xf59e0b,
        transparent: true,
        opacity: 1.0,
        blending: THREE.AdditiveBlending
      });
      const m = new THREE.Mesh(this.sharedSparkGeo, mat);
      m.position.set(pos.x, elevation + 4, pos.y);
      m.scale.set(1.2, 1.2, 2.8);
      this.group.add(m);
      this.orbitalParticles.push({
        mesh: m,
        kind: 'spark',
        vx: Math.cos(ang) * spd,
        vy: 35 + Math.random() * 45,
        vz: Math.sin(ang) * spd,
        rotSpeedX: 8,
        rotSpeedY: 8,
        rotSpeedZ: 4,
        baseScale: 1.2,
        endScale: 0.2,
        lifetime: 0.15,
        maxLifetime: 0.15,
        groundY
      });
    }
  }

  // ==========================================================================
  // COMMANDER SKILL 2 (RMB): TWIN CONVERGING GOLDEN ENERGY SLASHES
  // ==========================================================================

  private createCrescentSlashMaterial(mirrorSide: number): THREE.ShaderMaterial {
    return new THREE.ShaderMaterial({
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      side: THREE.DoubleSide,
      uniforms: {
        uMirror: { value: mirrorSide },
        uTime: { value: 0 },
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
        uniform float uMirror;
        uniform float uTime;
        uniform float uAlpha;
        varying vec2 vUv;

        void main() {
          // Map UV into local crescent space
          vec2 p = vUv * 2.0 - 1.0;
          p.x *= uMirror;

          // Curved crescent spine: x curves inward along y (-1..1)
          float spineX = 0.28 - 0.52 * (p.y * p.y);
          float distFromSpine = p.x - spineX;

          // Lengthwise tip taper at both ends of the crescent blade
          float tipFade = smoothstep(1.0, 0.25, abs(p.y));
          if (tipFade <= 0.001) discard;

          // Sharp leading outer edge (distFromSpine > 0) and softer inner wake (distFromSpine < 0)
          float outerWidth = 0.14 * tipFade;
          float innerWakeWidth = 0.48 * tipFade;

          float alpha = 0.0;
          float edgeFactor = 0.0;
          if (distFromSpine >= 0.0) {
            alpha = smoothstep(outerWidth, 0.0, distFromSpine);
            edgeFactor = smoothstep(outerWidth * 0.65, 0.0, distFromSpine);
          } else {
            float dIn = -distFromSpine;
            alpha = smoothstep(innerWakeWidth, 0.0, dIn) * 0.82;
            edgeFactor = smoothstep(innerWakeWidth * 0.18, 0.0, dIn);
          }

          // Subtle segmented tech markings & hex-grid energy pattern in wake
          float segPattern = step(0.35, fract(p.y * 5.0 - uTime * 3.0)) * smoothstep(0.32, 0.08, abs(distFromSpine + 0.12));
          float hexGrid = abs(sin(p.x * 24.0) * sin(p.y * 24.0));
          float gridMask = smoothstep(0.65, 0.85, hexGrid) * smoothstep(innerWakeWidth, 0.05, -distFromSpine) * 0.35;

          alpha = clamp((alpha + segPattern * 0.22 + gridMask) * tipFade * uAlpha, 0.0, 1.0);
          if (alpha < 0.02) discard;

          vec3 amberWake = vec3(0.96, 0.48, 0.08);
          vec3 goldMid = vec3(0.99, 0.78, 0.18);
          vec3 whiteGoldEdge = vec3(1.0, 0.98, 0.86);

          vec3 col = mix(amberWake, goldMid, clamp(alpha * 1.2, 0.0, 1.0));
          col = mix(col, whiteGoldEdge, edgeFactor);

          gl_FragColor = vec4(col, alpha);
        }
      `
    });
  }

  public createTwinSlashProjectileGroup(): THREE.Group {
    const grp = new THREE.Group();

    const bladeGeo = new THREE.PlaneGeometry(78, 125, 16, 24);
    bladeGeo.rotateX(-Math.PI / 2);

    const leftMat = this.createCrescentSlashMaterial(-1.0);
    const leftMesh = new THREE.Mesh(bladeGeo, leftMat);
    leftMesh.name = 'leftSlash';
    leftMesh.position.set(-52, 2, 0);
    grp.add(leftMesh);

    const rightMat = this.createCrescentSlashMaterial(1.0);
    const rightMesh = new THREE.Mesh(bladeGeo, rightMat);
    rightMesh.name = 'rightSlash';
    rightMesh.position.set(52, 2, 0);
    grp.add(rightMesh);

    // Inward-pointing Golden Chevron Indicators (>>> and <<<)
    const chevGeo = new THREE.PlaneGeometry(24, 14);
    chevGeo.rotateX(-Math.PI / 2);
    const createChevronMat = (dirSign: number) =>
      new THREE.ShaderMaterial({
        transparent: true,
        depthWrite: false,
        blending: THREE.AdditiveBlending,
        side: THREE.DoubleSide,
        uniforms: { uDir: { value: dirSign }, uTime: { value: 0 } },
        vertexShader: `
          varying vec2 vUv;
          void main() {
            vUv = uv * 2.0 - 1.0;
            gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
          }
        `,
        fragmentShader: `
          uniform float uDir;
          uniform float uTime;
          varying vec2 vUv;
          void main() {
            float x = vUv.x * uDir;
            float chevron = abs(fract((x - abs(vUv.y) * 0.65) * 1.5 - uTime * 4.0) - 0.5);
            float line = smoothstep(0.18, 0.04, chevron) * smoothstep(1.0, 0.65, abs(vUv.y)) * smoothstep(1.0, 0.7, abs(vUv.x));
            if (line < 0.02) discard;
            gl_FragColor = vec4(1.0, 0.88, 0.35, line * 0.85);
          }
        `
      });

    const leftChev = new THREE.Mesh(chevGeo, createChevronMat(1.0));
    leftChev.name = 'leftChevrons';
    leftChev.position.set(-28, 3, 0);
    grp.add(leftChev);

    const rightChev = new THREE.Mesh(chevGeo, createChevronMat(-1.0));
    rightChev.name = 'rightChevrons';
    rightChev.position.set(28, 3, 0);
    grp.add(rightChev);

    grp.userData = {
      elapsed: 0,
      trailTimer: 0,
      leftMesh,
      rightMesh,
      leftMat,
      rightMat,
      leftChev,
      rightChev
    };

    return grp;
  }

  public updateTwinSlashProjectileGroup(
    grp: THREE.Group,
    progress: number,
    dt: number,
    worldPos: Vector2,
    elevation: number
  ): void {
    const ud = grp.userData;
    if (!ud || !ud.leftMesh || !ud.rightMesh) return;

    ud.elapsed += dt;
    const clampedP = Math.max(0.0, Math.min(1.0, progress));
    // Phase 1 (Separated at ±54) -> Phase 2 (Sweeping inward to ±6 at convergence point)
    const pinchCurve = Math.pow(clampedP, 1.25);
    const lateralOffset = 54 * (1.0 - pinchCurve) + 6;
    const inwardCant = 0.18 + pinchCurve * 0.42;

    ud.leftMesh.position.set(-lateralOffset, 2, 0);
    ud.leftMesh.rotation.y = -inwardCant;
    ud.rightMesh.position.set(lateralOffset, 2, 0);
    ud.rightMesh.rotation.y = inwardCant;

    ud.leftMat.uniforms.uTime.value = ud.elapsed;
    ud.rightMat.uniforms.uTime.value = ud.elapsed;

    if (ud.leftChev && ud.rightChev) {
      const chevOffset = Math.max(12, lateralOffset * 0.58);
      ud.leftChev.position.set(-chevOffset, 3, 0);
      ud.rightChev.position.set(chevOffset, 3, 0);
      (ud.leftChev.material as THREE.ShaderMaterial).uniforms.uTime.value = ud.elapsed;
      (ud.rightChev.material as THREE.ShaderMaterial).uniforms.uTime.value = ud.elapsed;
    }

    // Subtle golden-amber particles following the two slash paths
    ud.trailTimer += dt;
    if (ud.trailTimer >= 0.035) {
      ud.trailTimer = 0;
      const groundY = this.getTerrainHeight(worldPos.x, worldPos.y, elevation);
      for (let side = -1; side <= 1; side += 2) {
        const mat = new THREE.MeshBasicMaterial({
          color: side < 0 ? 0xfef08a : 0xf59e0b,
          transparent: true,
          opacity: 0.85,
          blending: THREE.AdditiveBlending
        });
        const spark = new THREE.Mesh(this.sharedSparkGeo, mat);
        spark.position.set(
          worldPos.x + (Math.random() - 0.5) * 24,
          groundY + 14 + Math.random() * 10,
          worldPos.y + (Math.random() - 0.5) * 24
        );
        spark.scale.set(1.3, 1.3, 2.2);
        this.group.add(spark);
        this.orbitalParticles.push({
          mesh: spark,
          kind: 'spark',
          vx: (Math.random() - 0.5) * 45,
          vy: 15 + Math.random() * 25,
          vz: (Math.random() - 0.5) * 45,
          rotSpeedX: 6,
          rotSpeedY: 6,
          rotSpeedZ: 6,
          baseScale: 1.3,
          endScale: 0.2,
          lifetime: 0.18,
          maxLifetime: 0.18,
          groundY
        });
      }
    }
  }

  public spawnTwinSlashConvergence(
    pos: Vector2,
    elevation: number = 0,
    radius: number = 125,
    angle: number = 0
  ): void {
    const baseElev = this.getTerrainHeight(pos.x, pos.y, elevation);
    const group = new THREE.Group();
    group.position.set(pos.x, baseElev + 2.0, pos.y);
    // Align with incoming slash direction
    group.rotation.y = Math.PI / 2 - angle;
    this.group.add(group);

    // 1. Compact Golden Collision Burst at the Convergence Center (Phase 3)
    const burstSize = Math.min(115, radius * 0.92);
    const flashGeo = new THREE.PlaneGeometry(burstSize, burstSize);
    flashGeo.rotateX(-Math.PI / 2);
    const flashMat = new THREE.ShaderMaterial({
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      side: THREE.DoubleSide,
      uniforms: {
        uProgress: { value: 0.0 }
      },
      vertexShader: `
        varying vec2 vUv;
        void main() {
          vUv = uv * 2.0 - 1.0;
          gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
        }
      `,
      fragmentShader: `
        uniform float uProgress;
        varying vec2 vUv;
        void main() {
          float r = length(vUv);
          if (r > 1.0) discard;
          float a = atan(vUv.y, vUv.x);
          // Cross-slash X-starburst + compact compression ring
          float crossSpikes = pow(abs(cos(a * 2.0)), 10.0) * smoothstep(1.0, 0.05, r);
          float minorSpikes = pow(abs(sin(a * 4.0)), 12.0) * smoothstep(0.75, 0.05, r);
          float core = smoothstep(0.38 * (1.0 - uProgress * 0.5), 0.0, r);
          float pinchRing = smoothstep(0.05, 0.0, abs(r - (0.55 - uProgress * 0.25))) * 0.75;
          float fade = pow(1.0 - uProgress, 1.35);
          float alpha = clamp((core + crossSpikes * 0.95 + minorSpikes * 0.6 + pinchRing) * fade, 0.0, 1.0);
          if (alpha < 0.01) discard;
          vec3 col = mix(vec3(0.98, 0.58, 0.10), vec3(1.0, 0.98, 0.85), core + crossSpikes * 0.5);
          gl_FragColor = vec4(col, alpha);
        }
      `
    });
    const flashMesh = new THREE.Mesh(flashGeo, flashMat);
    group.add(flashMesh);

    // 2. Final Converged Left & Right Crescent Blades Sweeping Across Center and Fading (Phase 3 -> Phase 4)
    const bladeGeo = new THREE.PlaneGeometry(72, 115, 12, 20);
    bladeGeo.rotateX(-Math.PI / 2);
    const leftBladeMat = this.createCrescentSlashMaterial(-1.0);
    const leftBladeMesh = new THREE.Mesh(bladeGeo, leftBladeMat);
    leftBladeMesh.position.set(-10, 1.5, 0);
    leftBladeMesh.rotation.y = -0.45;
    group.add(leftBladeMesh);

    const rightBladeMat = this.createCrescentSlashMaterial(1.0);
    const rightBladeMesh = new THREE.Mesh(bladeGeo, rightBladeMat);
    rightBladeMesh.position.set(10, 1.5, 0);
    rightBladeMesh.rotation.y = 0.45;
    group.add(rightBladeMesh);

    // 3. Directional Compression Lines Emphasizing Inward Convergence
    const linePts: THREE.Vector3[] = [];
    for (let i = 0; i < 10; i++) {
      const a = (i / 10) * Math.PI * 2;
      const rOuter = 42 + (i % 2) * 14;
      const rInner = 6;
      linePts.push(new THREE.Vector3(Math.cos(a) * rOuter, 3, Math.sin(a) * rOuter));
      linePts.push(new THREE.Vector3(Math.cos(a) * rInner, 3, Math.sin(a) * rInner));
    }
    const compGeo = new THREE.BufferGeometry().setFromPoints(linePts);
    const compressionMat = new THREE.LineBasicMaterial({
      color: 0xfef08a,
      transparent: true,
      opacity: 0.9,
      blending: THREE.AdditiveBlending
    });
    const compressionLines = new THREE.LineSegments(compGeo, compressionMat);
    group.add(compressionLines);

    this.slashConvergences.push({
      group,
      flashMesh,
      flashMat,
      leftBladeMesh,
      leftBladeMat,
      rightBladeMesh,
      rightBladeMat,
      compressionLines,
      compressionMat,
      elapsed: 0,
      maxLifetime: 0.30
    });

    // 4. 12 Compact Golden Collision Sparks
    for (let i = 0; i < 12; i++) {
      const a = (i / 12) * Math.PI * 2 + (Math.random() - 0.5) * 0.3;
      const spd = 75 + Math.random() * 95;
      const mat = new THREE.MeshBasicMaterial({
        color: i % 2 === 0 ? 0xffffff : 0xfacc15,
        transparent: true,
        opacity: 1.0,
        blending: THREE.AdditiveBlending
      });
      const m = new THREE.Mesh(this.sharedSparkGeo, mat);
      m.position.set(pos.x, baseElev + 12, pos.y);
      m.scale.set(1.5, 1.5, 3.2);
      this.group.add(m);
      this.orbitalParticles.push({
        mesh: m,
        kind: 'spark',
        vx: Math.cos(a) * spd,
        vy: 45 + Math.random() * 55,
        vz: Math.sin(a) * spd,
        rotSpeedX: 9,
        rotSpeedY: 9,
        rotSpeedZ: 5,
        baseScale: 1.5,
        endScale: 0.2,
        lifetime: 0.22,
        maxLifetime: 0.22,
        groundY: baseElev
      });
    }
  }

  // ==========================================================================
  // COMMANDER SKILL 3 (DASH): KINETIC MOTION STREAKS & COLLISION IMPACT
  // ==========================================================================

  public spawnDashChargeTrail(
    pos: Vector2,
    elevation: number = 0,
    dir: Vector2 = { x: 0, y: 1 },
    dashDuration: number = 0.22
  ): void {
    const baseElev = this.getTerrainHeight(pos.x, pos.y, elevation);
    const group = new THREE.Group();
    group.position.set(pos.x, baseElev, pos.y);
    const angle = Math.atan2(dir.x, dir.y);
    group.rotation.y = angle;
    this.group.add(group);

    // 1. Forward Kinetic Air-Split Wedge / Nose-Cone around Commander
    const noseGeo = new THREE.ConeGeometry(20, 34, 16, 1, true);
    noseGeo.rotateX(Math.PI / 2);
    noseGeo.translate(0, 18, 12);
    const noseConeMat = new THREE.ShaderMaterial({
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      side: THREE.DoubleSide,
      uniforms: {
        uAlpha: { value: 0.85 }
      },
      vertexShader: `
        varying vec2 vUv;
        void main() {
          vUv = uv;
          gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
        }
      `,
      fragmentShader: `
        uniform float uAlpha;
        varying vec2 vUv;
        void main() {
          float fade = pow(vUv.y, 1.4) * uAlpha;
          vec3 col = mix(vec3(0.96, 0.58, 0.08), vec3(1.0, 0.98, 0.82), vUv.y);
          gl_FragColor = vec4(col, fade * 0.72);
        }
      `
    });
    const noseConeMesh = new THREE.Mesh(noseGeo, noseConeMat);
    group.add(noseConeMesh);

    // 2. Narrow Golden-White & Violet-Accented Motion Speed Lines Trailing Behind
    const streakMeshes: THREE.Mesh[] = [];
    const streakMats: THREE.MeshBasicMaterial[] = [];
    const streakOffsets = [
      { x: -16, y: 12, z: -34, len: 68, w: 2.6, col: 0xfef08a },
      { x: 16, y: 12, z: -34, len: 68, w: 2.6, col: 0xfef08a },
      { x: -9, y: 22, z: -42, len: 78, w: 2.0, col: 0xf59e0b },
      { x: 9, y: 22, z: -42, len: 78, w: 2.0, col: 0xf59e0b },
      { x: -22, y: 16, z: -28, len: 56, w: 1.8, col: 0xc084fc },
      { x: 22, y: 16, z: -28, len: 56, w: 1.8, col: 0xc084fc },
      { x: 0, y: 18, z: -46, len: 84, w: 3.0, col: 0xffffff }
    ];

    for (let i = 0; i < streakOffsets.length; i++) {
      const cfg = streakOffsets[i];
      const sGeo = new THREE.PlaneGeometry(cfg.w, cfg.len);
      sGeo.rotateX(-Math.PI / 2);
      const sMat = new THREE.MeshBasicMaterial({
        color: cfg.col,
        transparent: true,
        opacity: 0.88,
        blending: THREE.AdditiveBlending,
        side: THREE.DoubleSide,
        depthWrite: false
      });
      const sMesh = new THREE.Mesh(sGeo, sMat);
      sMesh.position.set(cfg.x, cfg.y, cfg.z);
      group.add(sMesh);
      streakMeshes.push(sMesh);
      streakMats.push(sMat);
    }

    this.dashTrails.push({
      group,
      noseConeMesh,
      noseConeMat,
      streakMeshes,
      streakMats,
      dir: { x: dir.x, y: dir.y },
      elapsed: 0,
      dashDuration,
      totalLifetime: dashDuration + 0.14,
      dustTimer: 0
    });
  }

  public updateDashChargeFollow(
    pos: Vector2,
    elevation: number,
    dir: Vector2,
    dt: number
  ): void {
    if (this.dashTrails.length === 0) return;
    const active = this.dashTrails[this.dashTrails.length - 1];
    const baseElev = this.getTerrainHeight(pos.x, pos.y, elevation);
    active.group.position.set(pos.x, baseElev, pos.y);
    if (dir.x !== 0 || dir.y !== 0) {
      active.group.rotation.y = Math.atan2(dir.x, dir.y);
      active.dir = { x: dir.x, y: dir.y };
    }

    // Minimal low-profile ground dust puffs kicked up behind boots during dash
    active.dustTimer += dt;
    if (active.dustTimer >= 0.045) {
      active.dustTimer = 0;
      const matParams: THREE.MeshBasicMaterialParameters = {
        color: 0xd6d3d1,
        transparent: true,
        opacity: 0.38,
        depthWrite: false
      };
      if (this.dustRadialTex) {
        matParams.map = this.dustRadialTex;
      }
      const dustMat = new THREE.MeshBasicMaterial(matParams);
      const dustMesh = new THREE.Mesh(this.sharedDustGeo, dustMat);
      dustMesh.position.set(
        pos.x - active.dir.x * 16 + (Math.random() - 0.5) * 14,
        baseElev + 6,
        pos.y - active.dir.y * 16 + (Math.random() - 0.5) * 14
      );
      this.group.add(dustMesh);
      this.orbitalParticles.push({
        mesh: dustMesh,
        kind: 'dust',
        vx: -active.dir.x * 45 + (Math.random() - 0.5) * 25,
        vy: 12 + Math.random() * 14,
        vz: -active.dir.y * 45 + (Math.random() - 0.5) * 25,
        rotSpeedX: 0,
        rotSpeedY: 0,
        rotSpeedZ: 1.5,
        baseScale: 10,
        endScale: 22,
        lifetime: 0.24,
        maxLifetime: 0.24,
        groundY: baseElev
      });
    }
  }

  public spawnDashKineticImpact(
    pos: Vector2,
    elevation: number = 0,
    radius: number = 115,
    dir: Vector2 = { x: 0, y: 1 }
  ): void {
    const baseElev = this.getTerrainHeight(pos.x, pos.y, elevation);
    const group = new THREE.Group();
    group.position.set(pos.x, baseElev + 2.0, pos.y);
    const impactAngle = Math.atan2(dir.x, dir.y);
    group.rotation.y = impactAngle;
    this.group.add(group);

    // 1. Concentrated Golden-White Starburst + Inner Tech Ring at Collision Point
    const flashSize = Math.min(130, radius * 1.1);
    const flashGeo = new THREE.PlaneGeometry(flashSize, flashSize);
    flashGeo.rotateX(-Math.PI / 2);
    const flashMat = new THREE.ShaderMaterial({
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      side: THREE.DoubleSide,
      uniforms: {
        uProgress: { value: 0.0 }
      },
      vertexShader: `
        varying vec2 vUv;
        void main() {
          vUv = uv * 2.0 - 1.0;
          gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
        }
      `,
      fragmentShader: `
        uniform float uProgress;
        varying vec2 vUv;
        void main() {
          float r = length(vUv);
          if (r > 1.0) discard;
          float a = atan(vUv.y, vUv.x);
          float rays = pow(abs(cos(a * 6.0)), 8.0) * smoothstep(1.0, 0.12, r);
          float subRays = pow(abs(sin(a * 10.0)), 12.0) * smoothstep(0.85, 0.15, r);
          float innerTechRing = smoothstep(0.035, 0.0, abs(r - 0.28)) * 0.9;
          float core = smoothstep(0.32, 0.0, r);
          float fade = pow(1.0 - uProgress, 1.3);
          float alpha = clamp((core + rays * 0.95 + subRays * 0.65 + innerTechRing) * fade, 0.0, 1.0);
          if (alpha < 0.01) discard;
          vec3 gold = vec3(1.0, 0.78, 0.18);
          vec3 violetAccent = vec3(0.78, 0.45, 0.98);
          vec3 col = mix(gold, violetAccent, subRays * 0.45);
          col = mix(col, vec3(1.0, 0.99, 0.90), core + innerTechRing * 0.5);
          gl_FragColor = vec4(col, alpha);
        }
      `
    });
    const flashMesh = new THREE.Mesh(flashGeo, flashMat);
    group.add(flashMesh);

    // 2. Brief, Crisp Expanding Kinetic Pressure Ring (Fast, Low-Profile)
    const ringSize = radius * 1.9;
    const ringGeo = new THREE.PlaneGeometry(ringSize, ringSize);
    ringGeo.rotateX(-Math.PI / 2);
    const ringMat = new THREE.ShaderMaterial({
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      side: THREE.DoubleSide,
      uniforms: {
        uProgress: { value: 0.1 },
        uAlpha: { value: 1.0 }
      },
      vertexShader: `
        varying vec2 vUv;
        void main() {
          vUv = uv * 2.0 - 1.0;
          gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
        }
      `,
      fragmentShader: `
        uniform float uProgress;
        uniform float uAlpha;
        varying vec2 vUv;
        void main() {
          float r = length(vUv);
          if (r > 1.0) discard;
          float ring = smoothstep(0.055, 0.0, abs(r - uProgress));
          if (ring < 0.01) discard;
          vec3 col = mix(vec3(0.98, 0.68, 0.15), vec3(1.0, 0.96, 0.80), ring);
          gl_FragColor = vec4(col, ring * uAlpha * 0.85);
        }
      `
    });
    const ringMesh = new THREE.Mesh(ringGeo, ringMat);
    group.add(ringMesh);

    // 3. Sharp Outward-Directed Kinetic Force Lines Emphasizing Knockback
    const spikePts: THREE.Vector3[] = [];
    for (let i = 0; i < 14; i++) {
      // Fan predominantly forward & outward in the knockback hemisphere
      const fanAngle = ((i / 13) - 0.5) * Math.PI * 1.35;
      const rStart = 12 + (i % 2) * 6;
      const rEnd = 65 + (i % 3) * 22;
      spikePts.push(new THREE.Vector3(Math.sin(fanAngle) * rStart, 4, Math.cos(fanAngle) * rStart));
      spikePts.push(new THREE.Vector3(Math.sin(fanAngle) * rEnd, 6, Math.cos(fanAngle) * rEnd));
    }
    const spikesGeo = new THREE.BufferGeometry().setFromPoints(spikePts);
    const spikesMat = new THREE.LineBasicMaterial({
      color: 0xfef08a,
      transparent: true,
      opacity: 0.95,
      blending: THREE.AdditiveBlending
    });
    const spikesLine = new THREE.LineSegments(spikesGeo, spikesMat);
    group.add(spikesLine);

    this.dashImpacts.push({
      group,
      flashMesh,
      flashMat,
      ringMesh,
      ringMat,
      spikesLine,
      spikesMat,
      elapsed: 0,
      maxLifetime: 0.28,
      radius
    });

    // 4. Small Outward Dust Puffs & Tumbling Pebble Debris
    for (let i = 0; i < 10; i++) {
      const fanA = impactAngle + (Math.random() - 0.5) * Math.PI * 1.2;
      const spd = 110 + Math.random() * 120;
      const isDebris = i < 5;
      if (isDebris) {
        const debMat = new THREE.MeshBasicMaterial({
          color: 0x334155,
          transparent: true,
          opacity: 0.95
        });
        const debMesh = new THREE.Mesh(this.sharedDebrisGeo, debMat);
        const s = 2.0 + Math.random() * 1.8;
        debMesh.scale.set(s, s * 0.8, s);
        debMesh.position.set(pos.x, baseElev + 8, pos.y);
        this.group.add(debMesh);
        this.orbitalParticles.push({
          mesh: debMesh,
          kind: 'debris',
          vx: Math.sin(fanA) * spd,
          vy: 75 + Math.random() * 65,
          vz: Math.cos(fanA) * spd,
          rotSpeedX: 9,
          rotSpeedY: 8,
          rotSpeedZ: 7,
          baseScale: s,
          endScale: s,
          lifetime: 0.34,
          maxLifetime: 0.34,
          groundY: baseElev + 1.5
        });
      } else {
        const matParams: THREE.MeshBasicMaterialParameters = {
          color: 0xd6d3d1,
          transparent: true,
          opacity: 0.45,
          depthWrite: false
        };
        if (this.dustRadialTex) {
          matParams.map = this.dustRadialTex;
        }
        const dustMat = new THREE.MeshBasicMaterial(matParams);
        const dustMesh = new THREE.Mesh(this.sharedDustGeo, dustMat);
        dustMesh.position.set(pos.x, baseElev + 8, pos.y);
        this.group.add(dustMesh);
        this.orbitalParticles.push({
          mesh: dustMesh,
          kind: 'dust',
          vx: Math.sin(fanA) * (spd * 0.75),
          vy: 15 + Math.random() * 20,
          vz: Math.cos(fanA) * (spd * 0.75),
          rotSpeedX: 0,
          rotSpeedY: 0,
          rotSpeedZ: 2,
          baseScale: 12,
          endScale: 28,
          lifetime: 0.28,
          maxLifetime: 0.28,
          groundY: baseElev
        });
      }
    }
  }
```

### 2D. Update `update(dt: number, camera: THREE.Camera)` in `src/render/ThreeVFX.ts`
At the end of `update(dt: number, camera: THREE.Camera)` in `src/render/ThreeVFX.ts` (right before the closing `}` of `update`), add the lifecycle updates and disposal for `blasterFlashes`, `slashConvergences`, `dashTrails`, and `dashImpacts`:

```ts
    // 6. Update LMB Blaster Muzzle Flashes & Impact Sparks
    for (let i = this.blasterFlashes.length - 1; i >= 0; i--) {
      const f = this.blasterFlashes[i];
      f.lifetime -= dt;
      if (f.lifetime <= 0) {
        this.group.remove(f.mesh);
        f.mesh.geometry.dispose();
        (f.mesh.material as THREE.Material).dispose();
        this.blasterFlashes.splice(i, 1);
        continue;
      }
      const s = 0.65 + (1.0 - f.lifetime / f.maxLifetime) * 0.65;
      f.mesh.scale.set(s, 1, s);
    }

    // 7. Update RMB Twin Slash Convergence Bursts (Phase 3 Collision -> Phase 4 Dissipation)
    for (let i = this.slashConvergences.length - 1; i >= 0; i--) {
      const sc = this.slashConvergences[i];
      sc.elapsed += dt;
      if (sc.elapsed >= sc.maxLifetime) {
        this.group.remove(sc.group);
        sc.flashMesh.geometry.dispose();
        sc.flashMat.dispose();
        sc.leftBladeMesh.geometry.dispose();
        sc.leftBladeMat.dispose();
        sc.rightBladeMat.dispose();
        sc.compressionLines.geometry.dispose();
        sc.compressionMat.dispose();
        this.slashConvergences.splice(i, 1);
        continue;
      }
      const p = sc.elapsed / sc.maxLifetime;
      sc.flashMat.uniforms.uProgress.value = p;
      sc.leftBladeMat.uniforms.uTime.value = sc.elapsed;
      sc.leftBladeMat.uniforms.uAlpha.value = Math.max(0, 1.0 - p * 1.25);
      sc.rightBladeMat.uniforms.uTime.value = sc.elapsed;
      sc.rightBladeMat.uniforms.uAlpha.value = Math.max(0, 1.0 - p * 1.25);
      // Blades cross inward slightly as they dissipate
      sc.leftBladeMesh.position.x = -10 + p * 16;
      sc.rightBladeMesh.position.x = 10 - p * 16;
      sc.compressionMat.opacity = Math.max(0, (1.0 - p) * 0.9);
      const compScale = 1.0 - p * 0.45;
      sc.compressionLines.scale.set(compScale, 1, compScale);
    }

    // 8. Update Dash Motion Streaks (Phase 1 Acceleration -> Phase 2 Charge -> Phase 4 Recovery)
    for (let i = this.dashTrails.length - 1; i >= 0; i--) {
      const dtTrail = this.dashTrails[i];
      dtTrail.elapsed += dt;
      if (dtTrail.elapsed >= dtTrail.totalLifetime) {
        this.group.remove(dtTrail.group);
        dtTrail.noseConeMesh.geometry.dispose();
        dtTrail.noseConeMat.dispose();
        for (let s = 0; s < dtTrail.streakMeshes.length; s++) {
          dtTrail.streakMeshes[s].geometry.dispose();
          dtTrail.streakMats[s].dispose();
        }
        this.dashTrails.splice(i, 1);
        continue;
      }
      const fadeStart = dtTrail.dashDuration;
      const alpha =
        dtTrail.elapsed <= fadeStart
          ? 1.0
          : Math.max(0, 1.0 - (dtTrail.elapsed - fadeStart) / (dtTrail.totalLifetime - fadeStart));
      dtTrail.noseConeMat.uniforms.uAlpha.value = alpha * 0.85;
      for (let s = 0; s < dtTrail.streakMats.length; s++) {
        dtTrail.streakMats[s].opacity = alpha * 0.88;
        dtTrail.streakMeshes[s].scale.set(1, 1, 0.75 + 0.35 * Math.sin(dtTrail.elapsed * 28 + s));
      }
    }

    // 9. Update Dash Kinetic Collision Impacts (Phase 3 Impact -> Phase 4 Recovery)
    for (let i = this.dashImpacts.length - 1; i >= 0; i--) {
      const imp = this.dashImpacts[i];
      imp.elapsed += dt;
      if (imp.elapsed >= imp.maxLifetime) {
        this.group.remove(imp.group);
        imp.flashMesh.geometry.dispose();
        imp.flashMat.dispose();
        imp.ringMesh.geometry.dispose();
        imp.ringMat.dispose();
        imp.spikesLine.geometry.dispose();
        imp.spikesMat.dispose();
        this.dashImpacts.splice(i, 1);
        continue;
      }
      const p = imp.elapsed / imp.maxLifetime;
      const eased = 1.0 - Math.pow(1.0 - p, 2.0);
      imp.flashMat.uniforms.uProgress.value = p;
      imp.ringMat.uniforms.uProgress.value = 0.12 + eased * 0.82;
      imp.ringMat.uniforms.uAlpha.value = Math.pow(1.0 - p, 1.25);
      imp.spikesMat.opacity = Math.pow(1.0 - p, 1.15);
      const spikeExpand = 0.65 + eased * 0.65;
      imp.spikesLine.scale.set(spikeExpand, 1, spikeExpand);
    }
```

---

## Step 3: Wire LMB, RMB & Dash VFX into `src/render/ThreeApp.ts`

In [`src/render/ThreeApp.ts`](file:///c:/Users/yoggn/Desktop/Ender%20Nine/src/render/ThreeApp.ts), make these 4 clean edits:

### 3A. Update `syncPlayer` in `src/render/ThreeApp.ts` (around line 1492)
Right after `this.playerGroup.position.set(p.pos.x, p.z, p.pos.y);`, update the active dash trail while Commander is dashing:

**Target:**
```ts
    this.playerGroup.position.set(p.pos.x, p.z, p.pos.y);

    // Shadow decal directly on terrain below
```

**Replacement:**
```ts
    this.playerGroup.position.set(p.pos.x, p.z, p.pos.y);

    if (p.isDashing && p.heroId === 'commander') {
      this.vfx.updateDashChargeFollow(p.pos, p.z, p.dashDir, dt);
    }

    // Shadow decal directly on terrain below
```

### 3B. Update `syncProjectiles` in `src/render/ThreeApp.ts` (around lines 1787–1802 and 2005–2085)
1. Replace the `proj.type === 'bomb'` sphere mesh (lines 1787–1801) with `this.vfx.createTwinSlashProjectileGroup()`:
**Target:**
```ts
        } else if (proj.type === 'bomb') {
          // Commander RMB Explosive Bomb: Heavy Ordnance Sphere with Glowing Armed Core
          const bodyGeo = new THREE.SphereGeometry(7.5, 12, 12);
          const bodyMat = new THREE.MeshBasicMaterial({ color: 0x334155 });
          grp.add(new THREE.Mesh(bodyGeo, bodyMat));

          const bandGeo = new THREE.TorusGeometry(7.6, 1.5, 8, 16);
          const bandMat = new THREE.MeshBasicMaterial({ color: 0xff4500 });
          grp.add(new THREE.Mesh(bandGeo, bandMat));

          const fuseGeo = new THREE.SphereGeometry(3.2, 8, 8);
          const fuseMat = new THREE.MeshBasicMaterial({ color: 0xfacc15 });
          const fuseMesh = new THREE.Mesh(fuseGeo, fuseMat);
          fuseMesh.position.y = 6.5;
          grp.add(fuseMesh);
```
**Replacement:**
```ts
        } else if (proj.type === 'bomb') {
          // Commander RMB: Twin Converging Golden Energy Slashes (Phase 1 -> Phase 2)
          const slashGrp = this.vfx.createTwinSlashProjectileGroup();
          grp.add(slashGrp);
          grp.userData.slashGrp = slashGrp;
```

2. Replace the default `pulse` cyan cylinder (lines 2005–2028) with `this.vfx.createGoldenBlasterBoltGroup()`, and update the orientation/cleanup block (lines 2041–2088):
**Target:**
```ts
        } else {
          // Default Primary Pulse Bolt: Elongated Cyan-White Energy Bolt with Radiant Luminous Flare
          const boltGeo = new THREE.CylinderGeometry(2.8, 2.8, 18, 8);
          boltGeo.rotateX(Math.PI / 2);
          const boltMat = new THREE.MeshBasicMaterial({ color: 0x38bdf8 });
          grp.add(new THREE.Mesh(boltGeo, boltMat));

          const coreGeo = new THREE.SphereGeometry(4.2, 8, 8);
          const coreMat = new THREE.MeshBasicMaterial({ color: 0xe0f2fe });
          grp.add(new THREE.Mesh(coreGeo, coreMat));

          if (this.textures['energy_flare']) {
            const flareMat = new THREE.SpriteMaterial({
              map: this.textures['energy_flare'],
              color: 0x38bdf8,
              transparent: true,
              opacity: 0.85,
              blending: THREE.AdditiveBlending
            });
            const flareSpr = new THREE.Sprite(flareMat);
            flareSpr.scale.set(18, 18, 1);
            grp.add(flareSpr);
          }
        }

        obj = grp;
        this.scene.add(obj);
        this.projMap.set(proj.id, obj);
      }

      // True 3D Positioning: NO ground snapping, NO slope crawling!
      // In Three.js: X = proj.pos.x, Y = proj.z, Z = proj.pos.y
      obj.position.set(proj.pos.x, proj.z ?? 16, proj.pos.y);
      // Keep pistol shot hidden in barrel until Frame 2 (Firing Frame / Muzzle Flash)
      obj.visible = (proj.spawnDelayRemaining ?? 0) <= 0;

      if (proj.type === 'grenade' || proj.type === 'spore_bomb' || proj.type === 'bomb') {
        obj.rotation.x += 0.16;
        obj.rotation.z += 0.12;
      } else if (proj.type === 'seismic_shard') {
        // Tumble violently through the air
        obj.rotation.x += 0.18;
        obj.rotation.z += 0.14;
        obj.rotation.y = Math.atan2(proj.velocity.x, proj.velocity.y);
      } else if (proj.type === 'wasp_sting') {
        // Rapid spinning along flight vector
        obj.rotation.y = Math.atan2(proj.velocity.x, proj.velocity.y);
        obj.rotation.z += 0.32;
      } else if (proj.type === 'queen_stinger') {
        obj.rotation.y = Math.atan2(proj.velocity.x, proj.velocity.y);
        obj.rotation.z += 0.24;
      } else if (proj.type === 'vortex') {
        obj.rotation.y += 0.14;
      } else if (proj.type === 'acid') {
        const pulse = 1 + Math.sin(performance.now() * 0.012) * 0.18;
        obj.scale.set(pulse, pulse, pulse);
        obj.rotation.x += 0.09;
        obj.rotation.y += 0.09;
      } else {
        // Align directional projectiles along their true 3D flight velocity vector!
        const vx = proj.velocity.x;
        const vy = proj.vz ?? 0;
        const vz = proj.velocity.y; // Three.js Z is sim Y
        const dir3D = new THREE.Vector3(vx, vy, vz).normalize();
        if (dir3D.lengthSq() > 0.001) {
          obj.quaternion.setFromUnitVectors(new THREE.Vector3(0, 0, 1), dir3D);
        }
      }
    }

    for (const [id, obj] of this.projMap.entries()) {
      if (!currentIds.has(id)) {
        this.scene.remove(obj);
```

**Replacement:**
```ts
        } else {
          // Commander Primary LMB: Golden Sci-Fi Blaster Bolt with Tapered Core, Glow & Light Trail
          grp.add(this.vfx.createGoldenBlasterBoltGroup());
        }

        obj = grp;
        this.scene.add(obj);
        this.projMap.set(proj.id, obj);
      }

      // Track latest state on userData so we can trigger a crisp impact spark if a pulse bolt hits terrain or enemy
      obj.userData.projType = proj.type;
      obj.userData.lastPos = { x: proj.pos.x, y: proj.pos.y };
      obj.userData.lastZ = proj.z ?? 16;
      obj.userData.distanceTraveled = proj.distanceTraveled;
      obj.userData.maxDistance = proj.maxDistance;

      // True 3D Positioning: NO ground snapping, NO slope crawling!
      // In Three.js: X = proj.pos.x, Y = proj.z, Z = proj.pos.y
      obj.position.set(proj.pos.x, proj.z ?? 16, proj.pos.y);
      // Keep pistol shot hidden in barrel until Frame 2 (Firing Frame / Muzzle Flash)
      obj.visible = (proj.spawnDelayRemaining ?? 0) <= 0;

      if (proj.type === 'bomb') {
        // Orient Twin Converging Slashes horizontally along flight direction and animate Phase 1 -> Phase 2 convergence
        const groundH = this.simulation.state.terrain.getElevation(proj.pos.x, proj.pos.y).height;
        obj.position.set(proj.pos.x, groundH + 4, proj.pos.y);
        obj.rotation.set(0, Math.atan2(proj.velocity.x, proj.velocity.y), 0);
        if (obj.userData.slashGrp) {
          const progress = proj.distanceTraveled / Math.max(1, proj.maxDistance);
          this.vfx.updateTwinSlashProjectileGroup(obj.userData.slashGrp, progress, 0.016, proj.pos, groundH);
        }
      } else if (proj.type === 'grenade' || proj.type === 'spore_bomb') {
        obj.rotation.x += 0.16;
        obj.rotation.z += 0.12;
      } else if (proj.type === 'seismic_shard') {
        // Tumble violently through the air
        obj.rotation.x += 0.18;
        obj.rotation.z += 0.14;
        obj.rotation.y = Math.atan2(proj.velocity.x, proj.velocity.y);
      } else if (proj.type === 'wasp_sting') {
        // Rapid spinning along flight vector
        obj.rotation.y = Math.atan2(proj.velocity.x, proj.velocity.y);
        obj.rotation.z += 0.32;
      } else if (proj.type === 'queen_stinger') {
        obj.rotation.y = Math.atan2(proj.velocity.x, proj.velocity.y);
        obj.rotation.z += 0.24;
      } else if (proj.type === 'vortex') {
        obj.rotation.y += 0.14;
      } else if (proj.type === 'acid') {
        const pulse = 1 + Math.sin(performance.now() * 0.012) * 0.18;
        obj.scale.set(pulse, pulse, pulse);
        obj.rotation.x += 0.09;
        obj.rotation.y += 0.09;
      } else {
        // Align directional projectiles along their true 3D flight velocity vector!
        const vx = proj.velocity.x;
        const vy = proj.vz ?? 0;
        const vz = proj.velocity.y; // Three.js Z is sim Y
        const dir3D = new THREE.Vector3(vx, vy, vz).normalize();
        if (dir3D.lengthSq() > 0.001) {
          obj.quaternion.setFromUnitVectors(new THREE.Vector3(0, 0, 1), dir3D);
        }
      }
    }

    for (const [id, obj] of this.projMap.entries()) {
      if (!currentIds.has(id)) {
        if (obj.userData?.projType === 'pulse' && obj.userData?.lastPos) {
          // Spawn brief golden impact spark when the blaster bolt hits an enemy or terrain
          this.vfx.spawnBlasterImpactSpark(obj.userData.lastPos, obj.userData.lastZ || 20);
        }
        this.scene.remove(obj);
```

### 3C. Update `processEvents` in `src/render/ThreeApp.ts` (around lines 2234–2360)
In `processEvents`, wire:
1. `case 'pistol_shot_released'`: call `this.vfx.spawnBlasterMuzzleFlash(e.data.from, e.data.z || 26, e.data.vx ?? 1, e.data.vy ?? 0)`.
2. `case 'orbital_impact'`: if `e.data.variant === 'bomb'`, call `this.vfx.spawnTwinSlashConvergence(e.data.target, elev, e.data.radius || 125, e.data.angle ?? 0)` instead of `spawnOrbitalBlast`.
3. `case 'dash_used'`: for Commander (`e.data?.variant !== 'medical_rush'`), call `this.vfx.spawnDashChargeTrail(this.simulation.state.player.pos, this.simulation.state.player.z, e.data?.dir || this.simulation.state.player.dashDir, 0.22)`.
4. `case 'dash_shockwave'`: replace `spawnShockwaveRing` + `spawnOrbitalBlast(..., 'nuke')` with `this.vfx.spawnDashKineticImpact(e.data.pos, e.data.z || 0, e.data.radius || 115, e.data.dir || this.simulation.state.player.dashDir)`.

Use `edit_file` on `src/render/ThreeApp.ts`:

**Target 1 (lines 2234–2236 & 2271–2285):**
```ts
        case 'pistol_shot_released':
          this.soundManager.playPulse();
          break;
```
**Replacement 1:**
```ts
        case 'pistol_shot_released':
          this.soundManager.playPulse();
          if (e.data?.from) {
            this.vfx.spawnBlasterMuzzleFlash(
              e.data.from,
              e.data.z ?? this.simulation.state.player.z + 26,
              e.data.vx ?? 1,
              e.data.vy ?? 0
            );
          }
          break;
```

**Target 2 (lines 2271–2285):**
```ts
        case 'orbital_impact':
          this.soundManager.playWave();
          {
            const elev = this.simulation.state.terrain.getElevation(
              e.data.target.x,
              e.data.target.y
            ).height;
            this.vfx.spawnOrbitalBlast(
              e.data.target,
              e.data.radius || 95,
              elev,
              e.data.variant || 'cryo'
            );
          }
          break;
```
**Replacement 2:**
```ts
        case 'orbital_impact':
          this.soundManager.playWave();
          {
            const elev = this.simulation.state.terrain.getElevation(
              e.data.target.x,
              e.data.target.y
            ).height;
            if (e.data.variant === 'bomb') {
              this.vfx.spawnTwinSlashConvergence(
                e.data.target,
                elev,
                e.data.radius || 125,
                e.data.angle ?? 0
              );
            } else {
              this.vfx.spawnOrbitalBlast(
                e.data.target,
                e.data.radius || 95,
                elev,
                e.data.variant || 'cryo'
              );
            }
          }
          break;
```

**Target 3 (lines 2335–2360):**
```ts
        case 'dash_used':
          this.soundManager.playDash();
          if (!this.use3DCommander) {
            this.spriteAnimator.triggerDash();
            this.vfx.spawnDashGhost(
              this.simulation.state.player.pos,
              this.playerSprite.material.map || this.textures['commander_front'],
              this.simulation.state.player.z
            );
          }
          if (e.data?.variant === 'medical_rush') {
            this.vfx.spawnShockwaveRing(
              this.simulation.state.player.pos,
              65,
              0x10b981,
              this.simulation.state.player.z,
              0.55
            );
          }
          break;
        case 'dash_shockwave':
          this.soundManager.playWave();
          this.vfx.spawnShockwaveRing(e.data.pos, e.data.radius || 115, 0xf97316, e.data.z || 0, 0.9);
          this.vfx.spawnOrbitalBlast(e.data.pos, (e.data.radius || 115) * 0.75, e.data.z || 0, 'nuke');
          this.addCameraTrauma(0.35);
          break;
```

**Replacement 3:**
```ts
        case 'dash_used':
          this.soundManager.playDash();
          if (!this.use3DCommander) {
            this.spriteAnimator.triggerDash();
            this.vfx.spawnDashGhost(
              this.simulation.state.player.pos,
              this.playerSprite.material.map || this.textures['commander_front'],
              this.simulation.state.player.z
            );
          }
          if (e.data?.variant === 'medical_rush') {
            this.vfx.spawnShockwaveRing(
              this.simulation.state.player.pos,
              65,
              0x10b981,
              this.simulation.state.player.z,
              0.55
            );
          } else {
            this.vfx.spawnDashChargeTrail(
              this.simulation.state.player.pos,
              this.simulation.state.player.z,
              e.data?.dir || this.simulation.state.player.dashDir,
              0.22
            );
          }
          break;
        case 'dash_shockwave':
          this.soundManager.playWave();
          this.vfx.spawnDashKineticImpact(
            e.data.pos,
            e.data.z || 0,
            e.data.radius || 115,
            e.data.dir || this.simulation.state.player.dashDir
          );
          this.addCameraTrauma(0.28);
          break;
```

---

## Step 4: Create & Run Automated Verification Suite `scratch/verify_commander_skill_vfx.ts`

Create [`scratch/verify_commander_skill_vfx.ts`](file:///c:/Users/yoggn/Desktop/Ender%20Nine/scratch/verify_commander_skill_vfx.ts) and run it with `npx tsx scratch/verify_commander_skill_vfx.ts` (along with `npx tsx scratch/verify_orbital_strike_vfx.ts`) to verify:
1. **LMB (Gold Blaster Bolt):**
   - `createGoldenBlasterBoltGroup()` builds core, outer golden glow, and crossed trail planes.
   - `pistol_shot_released` triggers `spawnBlasterMuzzleFlash()` (`vfx.blasterFlashes.length > 0`).
   - Hitting an enemy deals exact `26` base damage and `spawnBlasterImpactSpark()` spawns the flash + 6 micro-sparks.
   - Zero orbital strike beams spawned (`vfx.orbitalSequences.length === 0`).
2. **RMB (Twin Converging Slashes + Inward Pull):**
   - `createTwinSlashProjectileGroup()` builds `leftSlash`, `rightSlash`, `leftChevrons`, and `rightChevrons`.
   - `updateTwinSlashProjectileGroup()` narrows lateral separation from `±54` at `progress = 0` down to `±6` at `progress = 1.0`.
   - In `Simulation.ts`, firing RMB (`explosive_bomb`) and detonating it pulls nearby enemies **inward** toward the convergence point (distance to center decreases) and deals exact `72` base damage.
   - `spawnTwinSlashConvergence()` creates the collision burst + compression lines, cleans up after `0.30s`, and spawns **zero** orbital strike beams (`vfx.orbitalSequences.length === 0`).
3. **Dash (Kinetic Impact):**
   - Dashing in empty space (`dash_used` without enemies) spawns `spawnDashChargeTrail()` (`vfx.dashTrails.length === 1`) and **zero** `dashImpacts` (`vfx.dashImpacts.length === 0`).
   - Dashing into an enemy emits `dash_shockwave`, deals `48` base damage, knocks the enemy **outward**, and triggers `spawnDashKineticImpact()` (`vfx.dashImpacts.length === 1`) with **zero** orbital strike beams (`vfx.orbitalSequences.length === 0`).
4. **Orbital Strike Unchanged:**
   - Run `npx tsx scratch/verify_orbital_strike_vfx.ts` and confirm all 23/23 Orbital Strike tests still pass.

---

## Step 5: Capture Actual Gameplay Screenshots of All 3 Skills

Create and run `scripts/capture-commander-skill-vfx.cjs` using headless Chrome + WebGL against `http://localhost:5173/` to capture in-game screenshots of all three overhauled abilities in action against enemies:
1. `scratch/commander_lmb_blaster_bolt.png` — Commander firing his pistol with the golden muzzle flash, golden blaster bolt in flight, and golden impact spark on an enemy.
2. `scratch/commander_rmb_twin_slashes.png` — Two curved golden energy slashes sweeping forward and converging on enemies in front of Commander.
3. `scratch/commander_dash_kinetic_impact.png` — Commander dashing with golden-violet motion streaks into enemies and triggering the localized kinetic impact starburst & radial force lines.

Copy all three PNGs to the artifacts directory `C:/Users/yoggn/.gemini/antigravity/brain/4542810e-1e49-4a7e-a79b-951bef007a82/` and inspect them with `read_file` to verify visual quality before presenting the final summary.


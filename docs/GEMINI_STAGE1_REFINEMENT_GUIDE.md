# GEMINI 3.8 EXECUTION GUIDE: Stage 1 Gameplay, Progression & Visual Refinement

> **Target Executor:** Gemini 3.8
> **Objective:** Refine **Endo Nine** into a complete, replayable **Main Campaign Stage 1 (The Thawing Crash-Site Crater)** inspired by *Risk of Rain 2*'s progression loop.
> **Execution Rule:** Execute **Phases 1 through 8 in exact sequential order**. Preserve all working character animations, abilities, enemy navigation, physics, and UI. Make modular changes and verify after each phase.

---

## 0. Architectural Guardrails & Core Fixes

1. **Canonical Setting (`docs/LORE_CANON.md`):**
   - Stage 1 is **Main Campaign Stage 1 — The Crash-Site Crater** on the freshly thawing frozen world.
   - Every run begins at the crash site beside a substantial wrecked spacecraft landmark.
2. **Preserve Character Combat & Animations:**
   - Do **not** alter Commander's 2.5D directional sprite sheets (`run`, `jump`, `glide`, `attack`, `ult`), base skill cooldowns, or approved LMB (`Gold Blaster Bolt`), RMB (`Twin Converging Slashes`), Dash (`Kinetic Impact`), and Ultimate (`Orbital Strike`) visual identities.
3. **RoR2 "Artifact of Command" Trial Mode (`commandArtifactActive = true`):**
   - `GameState.commandArtifactActive` defaults to `true` for trial/debug runs so opening an Attribute Chest opens a 3-choice **Attribute-Only Upgrade Modal** (and when set to `false` for release mode, pops a single physical attribute item drop). Opening a chest must **never** grant both a physical item and a modal at the same time.

---

## PHASE 1: Fix Five-Strike Orbital Performance (`src/render/ThreeVFX.ts`)

### 1A. Root Bottlenecks Identified
1. **Dynamic `THREE.PointLight` Shader Recompilation Stall:**
   - Each call to `spawnOrbitalBlast` creates and adds a `new THREE.PointLight` to the scene (`5` beam lights + `1` convergence light + `1` detonation light = **7 dynamic PointLights**). Adding/removing `PointLight` instances changes `NUM_POINT_LIGHTS` in Three.js and forces synchronous WebGL shader recompilation on all lit terrain and prop materials.
2. **Voronoi Double-Loop Overdraw (`scorchMat`):**
   - `scorchMat` runs two $3 \times 3$ nested Voronoi loops twice per pixel (`36` loop iterations/fragment). Stacking 5 overlapping craters + 5 shockwaves + 5 impact flashes + 1 convergence spiral quad causes severe fragment overdraw.
3. **350 Individual Particle Meshes & Material Clones:**
   - Each strike spawns `70` separate `THREE.Mesh` objects (`32 sparks + 18 debris + 20 dust`) with `new THREE.MeshBasicMaterial()`, totaling **350 meshes and 350 materials** allocated in a single frame during Five-Strike Convergence.
4. **45 Per-Frame Geometry Allocations (`setFromPoints`):**
   - `5` strikes $\times$ `9` lightning lines = `45` `THREE.Line` geometries allocating `new THREE.Vector3` arrays and calling `setFromPoints()` every frame.

### 1B. Exact Code Changes in `src/render/ThreeVFX.ts`

1. **Add a Single Persistent Pooled Orbital `PointLight` on `ThreeVFX`:**
   In `src/render/ThreeVFX.ts` (around lines 235–260), add `private sharedOrbitalLight: THREE.PointLight;` and initialize it once in the `constructor`:

```ts
  private sharedOrbitalLight: THREE.PointLight;
  private sharedOrbitalLightTimer: number = 0;
  private sharedOrbitalLightMaxDuration: number = 0.5;
  private sharedOrbitalLightPeakIntensity: number = 0;
```

Inside `constructor(heightSampler?: (x: number, z: number) => number)`:
```ts
    this.sharedOrbitalLight = new THREE.PointLight(0xffd700, 0, 750, 1.4);
    this.sharedOrbitalLight.position.set(0, -1000, 0);
    this.group.add(this.sharedOrbitalLight);
```

Add helper method `triggerSharedOrbitalLight(pos: Vector2, elevation: number, colorHex: number, intensity: number, radius: number, duration: number)` in `ThreeVFX`:
```ts
  private triggerSharedOrbitalLight(
    pos: Vector2,
    elevation: number,
    colorHex: number,
    intensity: number,
    distance: number,
    duration: number
  ): void {
    this.sharedOrbitalLight.color.setHex(colorHex);
    this.sharedOrbitalLight.position.set(pos.x, elevation + 42, pos.y);
    this.sharedOrbitalLight.distance = distance;
    this.sharedOrbitalLight.intensity = Math.max(this.sharedOrbitalLight.intensity, intensity);
    this.sharedOrbitalLightPeakIntensity = this.sharedOrbitalLight.intensity;
    this.sharedOrbitalLightTimer = Math.max(this.sharedOrbitalLightTimer, duration);
    this.sharedOrbitalLightMaxDuration = Math.max(0.1, duration);
  }
```

In `ThreeVFX.update(dt, camera)`, decay `this.sharedOrbitalLight` smoothly without ever removing it from `this.group`:
```ts
    if (this.sharedOrbitalLightTimer > 0) {
      this.sharedOrbitalLightTimer = Math.max(0, this.sharedOrbitalLightTimer - dt);
      const t = this.sharedOrbitalLightTimer / this.sharedOrbitalLightMaxDuration;
      this.sharedOrbitalLight.intensity = this.sharedOrbitalLightPeakIntensity * t * t;
    } else {
      this.sharedOrbitalLight.intensity = 0;
    }
```

2. **Eliminate Dynamic `new THREE.PointLight` from `spawnOrbitalBlast`, `spawnSingularityVFX`, `spawnSingularityDetonationVFX`, `spawnConvergenceBarrageVFX`, `spawnConvergenceDetonationVFX`, and `spawnCryogenicFieldVFX`:**
   - Instead of adding a `new THREE.PointLight` to each sequence group, call `this.triggerSharedOrbitalLight(...)` (or keep a dummy `{ intensity: 0 } as any` reference if needed on interfaces for backwards compatibility, without adding extra `THREE.PointLight` nodes to the scene graph).

3. **Optimize Sub-Strike Overdraw, Lightning Lines, and Particle Count in `spawnOrbitalBlast`:**
   - Check `const isSubStrike = variant === 'convergence_sub';` inside `spawnOrbitalBlast`:
     - **Grid Segments:** For `isSubStrike`, use `8` segments instead of `18–20` on `impactFlashGeo`, `shockwaveGeo`, and `scorchGeo`.
     - **Fast Procedural Cracks on `scorchMat`:** Replace the two nested $3\times3$ `voronoiCracks` loops in `scorchMat` with a fast single-pass cellular/interference fracture function (`sin/cos` + hash lattice) that looks identical at runtime with **8x lower GPU ALU cost**.
     - **Lightning Arcs:** For `isSubStrike`, spawn `3` lightning lines instead of `9` (preserving `9` on the main strike), and in `ThreeVFX.update()`, only regenerate arc points every `3rd` frame (`Math.floor(seq.elapsed * 60) % 3 === 0`) and mutate the existing `BufferAttribute` array in-place instead of calling `new THREE.Vector3()` and `setFromPoints()`.
     - **Particle Scaling:** In `spawnOrbitalParticles(pos, baseElev, radius, coreCol, midCol, outerCol, isSubStrike)`:
       - When `isSubStrike === false` (standard single Orbital Strike): spawn the exact `32` sparks + `18` rock debris + `20` dust puffs = `70` particles (preserving all 23 assertions in `verify_orbital_strike_vfx.ts`!).
       - When `isSubStrike === true`: spawn a compact burst of `6` sparks + `4` debris + `4` dust puffs per outer strike (`14 × 4 = 56` outer particles + `70` center = `126` total instead of `350`).

---

## PHASE 2: Separate Skill Enhancements from Attribute Items (`src/sim/types.ts`, `src/sim/ItemDefs.ts`, `src/sim/Simulation.ts`)

### 2A. Update `src/sim/types.ts`

1. Expand `SkillEnhancementId` to cover all 4 Commander ability slots:
```ts
export type SkillEnhancementId =
  // Primary (LMB — Gold Blaster Bolt enhancements)
  | 'scatter_burst'
  | 'arc_conduit'
  | 'piercing_lance'
  | 'rapid_gatling'
  // Secondary (RMB — Twin Converging Slashes enhancements)
  | 'cryo_slashes'
  | 'vortex_slashes'
  | 'seismic_slashes'
  // Utility (Dash — Kinetic Impact enhancements)
  | 'phase_dash'
  | 'shock_dash'
  | 'cryo_dash'
  // Ultimate (R — Orbital Strike enhancements)
  | 'singularity'
  | 'convergence_barrage'
  | 'cryogenic_impact';
```

2. Expand `WorldEventType` and `BuffDef['exclusiveEvent']` to the **four ability enhancement events**:
```ts
export type WorldEventType =
  | 'primal_totem'          // 1. Basic Attack (LMB) Enhancement Shrine
  | 'secondary_totem'       // 2. Secondary Attack (RMB) Enhancement Shrine
  | 'dash_totem'            // 3. Dash (Utility) Enhancement Shrine
  | 'orbital_uplink'        // 4. Ultimate (R) Enhancement Shrine
  | 'void_corruption';      // Legacy/optional compatibility

export type ExclusiveEventPool =
  | 'basic_skill_totem'
  | 'secondary_skill_totem'
  | 'dash_skill_totem'
  | 'ultimate_beacon'
  | 'void_corruption';
```
Update `BuffDef.exclusiveEvent?: ExclusiveEventPool;`.

### 2B. Update `src/sim/ItemDefs.ts`

1. **Convert Basic Attack Event Options (`basic_skill_totem`) from Replacement to Additive Enhancements:**
   - `buff_skill_scatter`:
     - `name: 'Service Pistol — Scatter Burst'`
     - `category: '★ BASIC ATTACK ENHANCEMENT'`
     - `description: 'Augments Gold Blaster Bolt: Fires 2 additional flanking golden blaster bolts in a tight burst cone (+1 Pierce).'`
     - `enhancesSkillSlot: 'primary'`, `enhancementId: 'scatter_burst'`, `exclusiveEvent: 'basic_skill_totem'` (Remove `replacesSkillSlot` and `replacementSkillId`).
   - `buff_skill_arc`:
     - `name: 'Service Pistol — Arc Conduit'`
     - `category: '★ BASIC ATTACK ENHANCEMENT'`
     - `description: 'Augments Gold Blaster Bolt: Every blaster bolt hit arcs high-voltage chain lightning to up to 3 nearby enemies.'`
     - `enhancesSkillSlot: 'primary'`, `enhancementId: 'arc_conduit'`, `exclusiveEvent: 'basic_skill_totem'`.
   - `buff_skill_hyper_beam`:
     - `name: 'Service Pistol — Piercing Lance'`
     - `category: '★ BASIC ATTACK ENHANCEMENT'`
     - `description: 'Augments Gold Blaster Bolt: Supercharges blaster bolts with +35% Damage, +40% Velocity, and +3 Pierce through enemies.'`
     - `enhancesSkillSlot: 'primary'`, `enhancementId: 'piercing_lance'`, `exclusiveEvent: 'basic_skill_totem'`.
   - `buff_skill_gatling`:
     - `name: 'Service Pistol — Rapid Overclock'`
     - `category: '★ BASIC ATTACK ENHANCEMENT'`
     - `description: 'Augments Gold Blaster Bolt: Fires a high-velocity twin-bolt volley and permanently grants +25% Attack Speed.'`
     - `enhancesSkillSlot: 'primary'`, `enhancementId: 'rapid_gatling'`, `exclusiveEvent: 'basic_skill_totem'`.

2. **Convert Secondary Attack Options (`secondary_skill_totem`) to Additive Enhancements:**
   - `buff_skill_cryo_grenade`:
     - `name: 'Twin Slashes — Cryogenic Edge'`
     - `category: '★ SECONDARY ENHANCEMENT'`
     - `description: 'Augments Twin Converging Slashes: The converging slash burst Freezes enemies for 2.0s and leaves a chilling frost wake.'`
     - `enhancesSkillSlot: 'secondary'`, `enhancementId: 'cryo_slashes'`, `exclusiveEvent: 'secondary_skill_totem'` (Remove `replacesSkillSlot`).
   - `buff_skill_gravity_vortex`:
     - `name: 'Twin Slashes — Gravitational Pull'`
     - `category: '★ SECONDARY ENHANCEMENT'`
     - `description: 'Augments Twin Converging Slashes: Expands inward pull radius by +45% and creates a brief gravitational compression well at the convergence point.'`
     - `enhancesSkillSlot: 'secondary'`, `enhancementId: 'vortex_slashes'`, `exclusiveEvent: 'secondary_skill_totem'` (Remove `replacesSkillSlot`).
   - `buff_stun_rounds` (or `buff_thermite_infusion` adapted for Secondary):
     - Assign `buff_thermite_infusion` to `enhancesSkillSlot: 'secondary'`, `enhancementId: 'seismic_slashes'`, `exclusiveEvent: 'secondary_skill_totem'`:
     - `name: 'Twin Slashes — Plasma Ignition'`
     - `description: 'Augments Twin Converging Slashes: The central slash collision ignites enemies and scorches the ground for bonus burning damage.'`

3. **Convert Dash Options (`dash_skill_totem`) to Additive Enhancements:**
   - `buff_skill_blink`:
     - `name: 'Kinetic Dash — Phase Surge'`
     - `category: '★ DASH ENHANCEMENT'`
     - `description: 'Augments Kinetic Dash: Increases dash speed and distance by +35% and unleashes a concussive phase shockwave upon completion.'`
     - `enhancesSkillSlot: 'utility'`, `enhancementId: 'phase_dash'`, `exclusiveEvent: 'dash_skill_totem'` (Remove `replacesSkillSlot`).
   - `buff_shock_trail`:
     - `name: 'Kinetic Dash — Static Discharge'`
     - `category: '★ DASH ENHANCEMENT'`
     - `description: 'Augments Kinetic Dash: Leaves an electrified plasma trail along your dash path that shocks and damages pursuing foes.'`
     - `enhancesSkillSlot: 'utility'`, `enhancementId: 'shock_dash'`, `exclusiveEvent: 'dash_skill_totem'`.
   - `buff_frost_landing`:
     - `name: 'Kinetic Dash — Cryo Impact'`
     - `category: '★ DASH ENHANCEMENT'`
     - `description: 'Augments Kinetic Dash: Colliding with enemies or completing a dash triggers a freezing nova that chills and slows nearby foes.'`
     - `enhancesSkillSlot: 'utility'`, `enhancementId: 'cryo_dash'`, `exclusiveEvent: 'dash_skill_totem'`.

4. **Preserve Ultimate Options (`ultimate_beacon`):**
   - Keep `buff_skill_singularity` (`singularity`), `buff_skill_nuke` (`convergence_barrage`), and `buff_skill_chrono_stasis` (`cryogenic_impact`) untouched.

5. **Enforce Pure Attribute Upgrades for General Chests & Enemy Drops (`!exclusiveEvent`):**
   - Ensure every buff in `BUFF_REGISTRY` without `exclusiveEvent` is a pure numerical character attribute upgrade (Attack Damage, Attack Speed, Crit Chance, Crit Damage, Max Health, Health Regen, Armor, Energy Shield, Movement Speed, Cooldown Reduction, Life Steal, Pickup Radius).
   - Convert any non-attribute buffs remaining in the general pool (`buff_multi_barrel`, `buff_bouncing_slugs`, `buff_combat_drone`, `buff_nanite_swarm`, `buff_cryo_rounds`, `buff_toxic_spores`, `buff_death_blossom`) so that they either modify numerical attributes (e.g., Attack Speed, Crit Damage, Armor Penetration, Cooldown Reduction, Life Steal, Max HP) or are excluded from ordinary attribute chests (`isAttributeUpgrade: true` flag on `BuffDef`).
   - Specifically, add `isAttributeUpgrade?: boolean` on `BuffDef` and mark all pure stat buffs with `isAttributeUpgrade: true`. When `rollThreeBuffChoices(rng)` is called with no `filterEvent` (i.e. for Attribute Chests / Level-up Capsules), filter strictly by `!BUFF_REGISTRY[id].exclusiveEvent && !BUFF_REGISTRY[id].replacesSkillSlot && !BUFF_REGISTRY[id].enhancesSkillSlot && BUFF_REGISTRY[id].isAttributeUpgrade !== false`.

### 2C. Implement Additive LMB, RMB, and Dash Enhancement Behaviors in `src/sim/Simulation.ts`

1. **In `firePrimaryPulse` (`src/sim/Simulation.ts` around line 1458):**
   - Always fire Commander's base Gold Blaster Bolt (`type: 'pulse'`).
   - Read `const enh = p.skillEnhancements?.primary;`:
     - If `enh === 'scatter_burst'`: add `+2` projectiles (`count = 3 + (p.calculatedStats.extraProjectiles || 0)`), `spread = 0.24`, `pierceCount += 1`. All projectiles remain `type: 'pulse'` so they render as Golden Blaster Bolts!
     - If `enh === 'piercing_lance'`: increase `speed *= 1.40`, `pierceCount += 3`, and `damage *= 1.35`.
     - If `enh === 'rapid_gatling'`: spawn a twin Gold Blaster Bolt (`count = Math.max(2, count)` with tight parallel offset).
     - If `enh === 'arc_conduit'`: mark `proj.element = 'lightning'`. When a `'pulse'` projectile hits an enemy in `updateProjectiles`, if `p.skillEnhancements?.primary === 'arc_conduit'`, arc chain lightning (`chain_spark` event) to 2 nearby enemies within `220px` for `45%` of bolt damage!

2. **In `detonateExplosiveBomb` (`src/sim/Simulation.ts` around line 1177):**
   - Always execute the base Twin Converging Slashes damage and inward pull.
   - Read `const enh = p.skillEnhancements?.secondary;`:
     - If `enh === 'cryo_slashes'`: apply `v.isChilled = true; v.chillTimer = 3.0; v.isStunned = true; v.stunTimer = 1.6;` to pulled victims and emit `ultimate_cryo_field_spawned` with compact radius `blastRadius * 0.85` and duration `1.8s`.
     - If `enh === 'vortex_slashes'`: multiply `blastRadius` by `1.45` and increase inward pull impulse by `1.4x`.
     - If `enh === 'seismic_slashes'`: deal `+30%` bonus burn damage and spawn an ignited ground patch (`toxic_field_deployed` with variant `'ignite'` or fire field) at `proj.pos` for `2.5s`.

3. **In `updatePlayer` Dash section (`src/sim/Simulation.ts` around line 570 & 618):**
   - Read `const enh = p.skillEnhancements?.utility;`:
     - If `enh === 'phase_dash'`: multiply `dashSpeedMult` by `1.35`, and when `p.dashDurationTimer <= 0` (dash finishes), trigger a concussive arrival burst around `p.pos` (radius `95`, damage `36 * p.calculatedStats.damageMultiplier`).
     - If `enh === 'shock_dash'`: while dashing, shock nearby enemies within `55px` (`this.damageEnemy(v, 18 * dt * 10, v.pos, 'lightning')`).
     - If `enh === 'cryo_dash'`: on dash collision (`dash_shockwave`) or dash completion, chill and slow nearby enemies within `110px` (`v.isChilled = true; v.chillTimer = 2.5;`).

---

## PHASE 3: Fix Currency and Chest Economy (`src/sim/Simulation.ts`, `src/sim/GameState.ts`, `src/render/ThreeApp.ts`)

### 3A. Fix Currency Pickup Elevation Bug (`src/sim/Simulation.ts` line 3771)

In `src/sim/Simulation.ts` inside `updateCurrencyPickups(dt)`:
- **Current Bug (line 3771):**
  ```ts
  if (dist <= 30 && drop.z < 18) {
  ```
  Because `drop.z` is set to world terrain height `groundZ` (which is `18–615` across the valley and plateaus), `drop.z < 18` is false almost everywhere, causing currency shards to vacuum to `dist = 0` and orbit the player forever!
- **Exact Fix:**
  Replace lines 3763–3779 with:
  ```ts
      // Vacuum pickup within configurable pickupRadius
      const heightAboveGround = Math.abs(drop.z - groundZ);
      if (dist < pickupRadius && (drop.settled || heightAboveGround < 28)) {
        const pullSpeed = 520 * (1.2 - dist / (pickupRadius + 20));
        const invDist = 1 / (dist || 1);
        drop.pos.x += (p.pos.x - drop.pos.x) * invDist * pullSpeed * dt;
        drop.pos.y += (p.pos.y - drop.pos.y) * invDist * pullSpeed * dt;
        drop.z = this.state.terrain.getElevation(drop.pos.x, drop.pos.y).height + 4;
      }

      if (dist <= 34 && (drop.settled || heightAboveGround < 32)) {
        p.currency += drop.value;
        this.state.events.push({
          type: 'currency_collected',
          data: { value: drop.value, pos: { ...drop.pos }, z: drop.z }
        });
        continue;
      }
  ```

### 3B. Add Pickup Spark VFX & Remove Floating Currency Meshes (`src/render/ThreeApp.ts`)

1. In `ThreeApp.processEvents`, add a handler for `'currency_collected'`:
```ts
        case 'currency_collected':
          this.soundManager.playCurrencyPickup?.();
          if (e.data?.pos) {
            const elev = e.data.z ?? this.simulation.state.terrain.getElevation(e.data.pos.x, e.data.pos.y).height;
            this.vfx.spawnBlasterImpactSpark(e.data.pos, elev + 8);
          }
          break;
```
2. In `ThreeApp.createWorldEvents()` (lines 880–886), **DELETE** the erroneous loop that clears `this.podMap`! (`createWorldEvents` was wiping out all Chest/Pod meshes created by `createPods()`).

### 3C. Fix Chest Purchase & Prevent Duplicate Rewards (`src/sim/GameState.ts` & `src/sim/Simulation.ts`)

1. In `src/sim/GameState.ts`, add:
```ts
  // RoR2 "Artifact of Command" trial mode: true = 3-choice attribute modal on chest open; false = direct item pop
  public commandArtifactActive: boolean = true;
```
2. In `src/sim/Simulation.ts`, update `updatePods(input: InputSnapshot)` (lines 3666–3688):
```ts
  private updatePods(input: InputSnapshot): void {
    const p = this.state.player;
    if (!input.wantInteract) return;

    const pod = this.getInteractablePod();
    if (!pod || pod.isOpened) return;
    if (p.currency < pod.cost) return;

    // Deduct cost exactly once and lock chest immediately
    p.currency -= pod.cost;
    pod.isOpened = true;

    const chosenItem: ItemId = rollWeightedPassiveItem(this.state.rng);
    pod.itemRewarded = chosenItem;

    this.state.events.push({
      type: 'pod_opened',
      data: { podId: pod.id, pos: { ...pod.pos }, cost: pod.cost, item: chosenItem }
    });

    if (this.state.commandArtifactActive) {
      // Trial / Command Mode: Open 3-choice Attribute Upgrade modal (single reward)
      this.queueBuffDraft();
    } else {
      // Standard RoR2 Mode: Pop physical attribute item drop from the chest (single reward)
      pod.itemDropped = chosenItem;
      this.spawnPhysicalItemDrop(
        { x: pod.pos.x, y: pod.pos.y + 14 },
        chosenItem
      );
    }
  }
```

---

## PHASE 4 & PHASE 7: Randomized Stage 1 Crash-Site Crater & Reward Placement (`src/sim/TerrainSystem.ts`, `src/sim/GameState.ts`, `src/render/ThreeTerrain.ts`, `src/render/ThreeApp.ts`)

### 4A. Seeded Procedural Crater Layout & Crash-Site Anchor (`src/sim/TerrainSystem.ts`)

1. Update `TerrainSystem` constructor to accept a deterministic seed (`constructor(seed: number = 133799)`):
   - Keep `worldWidth = 3600` and `worldHeight = 3600` (compact RoR2 Stage 1 crater scale).
   - **Fixed Crash-Site Zone:**
     - Locate the **Crashed Spaceship Wreck** in the southern/south-central crater basin around `crashSitePos = { x: 1800, y: 2680 }` with a flat, safe starting deck at `playerSpawnPos = { x: 1800, y: 2480 }` (elevation `~14–18`, slope `< 0.08`).
     - Carve a subtle **impact skid trench** leading into the hull resting site (`y: 2950 -> 2680`).
   - **Surrounding Crater Rim & Randomized Plateaus:**
     - Create a natural enclosing **Crater Rim** around the outer boundary (`distFromCenter > 1520`) with varied rocky peaks and passes based on the seed's `SeededRandom`.
     - Randomize the positions, radii, and orientations of **Middle Combat Plateau** (`elevation ~ 230–270`) and **Upper Summit Plateau** (`elevation ~ 560–620`) within validated sectors using the seed:
       - Sector configuration flips/rotates plateau placement between runs (e.g., Middle Plateau in East/Northeast/Northwest sector, Upper Summit in North/Northwest/Northeast sector) so successive seeds have noticeably different layouts.
     - Automatically compute `ramp1` (Valley $\rightarrow$ Middle Plateau), `ramp2` (Middle Plateau $\rightarrow$ Upper Summit), and `ramp3` (Valley $\rightarrow$ Secondary Ridge/Overlook) dynamically from the generated plateau centers and radii so that **every elevated plateau is guaranteed to have a continuous, smooth climbable ramp** with slope $< 0.32$.

2. Add a method `rebuildWithSeed(seed: number)` on `TerrainSystem` that regenerates the plateau parameters, ramp endpoints, and noise phase offsets from `new SeededRandom(seed)`.

### 4B. Build Substantial 3D Crashed Spaceship Landmark (`src/render/ThreeTerrain.ts`)

In `ThreeTerrain.buildTerrain(terrain)`, add `this.createCrashedSpaceship(terrain)` at the crash-site anchor `(1800, 2720)`:
- **Scale:** A massive, unmistakable spacecraft wreck (~`340` units long, `140` units wide, `95` units tall)—not a tiny decorative prop:
  1. **Tilted Main Fuselage Hull:** Large metallic armored cylinder/hull section (`CylinderGeometry(48, 56, 240, 12)` tilted at `14°` into the crater floor) with dark hull plating, scorched reentry charring, and glowing cyan/amber structural ribs.
  2. **Detached Starboard Wing & Engine Nacelle:** Broken swept wing (`BoxGeometry(150, 12, 85)`) half-buried in the crater soil beside a ruptured thruster nozzle (`CylinderGeometry(24, 32, 65, 16)`) emitting a pulsing orange-blue reactor glow.
  3. **Breached Command Bridge & Escape Ramp:** Angled boarding ramp extending toward `(1800, 2480)` where Commander awakens, flanked by scattered hull debris plates and an emergency distress beacon light.
- Register the main hull and engine nacelle bounding circles in `GameState.obstacles` so characters and enemies collide cleanly with the wreck and never walk through solid ship walls!

### 4C. Randomize the Four Skill Events, Attribute Chests & Teleporter (`src/sim/GameState.ts`)

1. **Dynamic Run Seed on Every Run:**
   In `GameState constructor(seed?: number)`, default to `seed ?? Math.floor(Math.random() * 2147483647)` when not explicitly passed, and store `public seed: number`.
   In `Simulation.restartRun()` / `ThreeApp.restartRun()`, generate a fresh random seed, rebuild `TerrainSystem`, rebuild `ThreeTerrain`, and update `ThreeVFX` height sampler!

2. **Randomize All 4 Skill Enhancement Events (`generateWorldEvents` in `src/sim/GameState.ts`):**
   Every run spawns **all 4 distinct Skill Enhancement Events** at randomized, validated, navigable locations across the crater (minimum `220px` apart from each other, `180px` from player spawn, `160px` from the Teleporter/Artifact, and `180px` from the Shipwreck):
   1. `event_primal_totem` (`type: 'primal_totem'`, filter: `'basic_skill_totem'`): **Basic Attack (LMB) Shrine — Ancient Bio-Resonance Totem**
   2. `event_secondary_totem` (`type: 'secondary_totem'`, filter: `'secondary_skill_totem'`): **Secondary Attack (RMB) Shrine — Kinetic Blade Conduit**
   3. `event_dash_totem` (`type: 'dash_totem'`, filter: `'dash_skill_totem'`): **Dash (Utility) Shrine — Phase Thruster Pylon**
   4. `event_orbital_uplink` (`type: 'orbital_uplink'`, filter: `'ultimate_beacon'`): **Ultimate (R) Shrine — Celestial Uplink Conduit**

3. **Update `Simulation.updateWorldEvents` & `ThreeApp.createWorldEvents`:**
   - In `Simulation.updateWorldEvents`, map each event's completion reward draft to its designated pool:
     - `primal_totem` $\rightarrow$ `this.queueBuffDraft('basic_skill_totem')`
     - `secondary_totem` $\rightarrow$ `this.queueBuffDraft('secondary_skill_totem')`
     - `dash_totem` $\rightarrow$ `this.queueBuffDraft('dash_skill_totem')`
     - `orbital_uplink` $\rightarrow$ `this.queueBuffDraft('ultimate_beacon')`
   - In `ThreeApp.createWorldEvents`, render distinct 3D shrine visuals and color-coded sky pillars/rings for all 4 event types (Cyan for Basic Attack, Gold-Amber for Secondary Slashes, Violet-Blue for Dash Pylon, Radiant Gold for Ultimate Uplink).

4. **Validated Non-Overlapping Chest Placement (`generateOrganicPods` in `src/sim/GameState.ts`):**
   - Place `18–22` Attribute Chests across the Lower Crater Valley, Middle Plateau, and Upper Summit using `this.rng`.
   - Enforce strict clearance checks:
     - Slope $< 0.28` (`this.terrain.isValidEventSpawn(candX, candY, 38)`)
     - Distance from Shipwreck hull $> 180px$
     - Distance from Teleporter/Artifact $> 120px$
     - Distance from any of the 4 Skill Events $> 120px$
     - Distance from other Chests $> 75px$

---

## PHASE 5: Eliminate Repetitive Ground Tiling (`src/render/ThreeTerrain.ts`)

Replace the simple 2-scale UV mix in `ThreeTerrain.buildTerrain` (`groundMat.onBeforeCompile`) with a **multi-scale domain-warped procedural biome shader**:

1. **World-Space Simplex / Value Noise & FBM:**
   Add fast 2D hash, smooth value noise `vnoise(vec2 p)`, and 3-octave FBM `fbm(vec2 p)` functions into the terrain fragment shader.
2. **Domain-Warped Stochastic Texture Sampling:**
   - Warp `worldXZ` with low-frequency 2D FBM noise (`vec2 warpedXZ = worldXZ + vec2(fbm(worldXZ * 0.0015), fbm(worldXZ * 0.0015 + 17.3)) * 180.0;`).
   - Sample `map` (`alien_thawed_ground.png`) at **three non-commensurate rotated scales** (`0.0038`, `0.0014`, and `0.00055`) using the warped coordinates and blend them via organic noise masks so no periodic grid or square tile seams can ever appear.
3. **Multi-Biome Thawing Crater Splatting:**
   - **Zone 1 — Thawed Dark Crater Soil & Mud:** Rich dark volcanic/thawed earth around the crash trench and lower basin (`vec3(0.22, 0.25, 0.24)` blended with micro-grit).
   - **Zone 2 — Frost & Snow Patches:** Crisp glacial snow and frost (`vec3(0.82, 0.91, 0.98)`) accumulating on high-altitude plateaus, windward slopes, and irregular FBM patch masks with sparkling ice micro-grain.
   - **Zone 3 — Reawakening Alien Bio-Turf & Moss:** Bioluminescent teal-emerald alien moss (`vec3(0.24, 0.52, 0.44)`) in damp valley hollows and near riverbanks.
   - **Zone 4 — Slope-Aware Stratified Crater Rock:** Steep slopes (`slope > 0.26`) transition smoothly into layered dark slate-basalt cliff strata (`vec3(0.19, 0.25, 0.34)`) with horizontal sedimentary bands and crevice shading.

---

## PHASE 6: Upgrade Placeholder VFX & Black Hole Persistence (`src/render/ThreeVFX.ts` & `src/render/ThreeApp.ts`)

### 6A. Black Hole (`spawnSingularityVFX`) Full-Lifetime Visual Persistence
In `src/render/ThreeVFX.ts` (`spawnSingularityVFX` and its update loop in `ThreeVFX.update`):
1. **Replace Flat Torus Core with Multi-Layered Gravitational Singularity Core:**
   - Central dark event-horizon lens disc with an animated shader (`coreSphereMat` upgraded to `THREE.ShaderMaterial`) featuring a pitch-black void center surrounded by a blazing, rotating **purple-gold photon ring** and gravitational distortion ripples that stay intense for the entire `3.0s` duration.
2. **Continuous Staggered Inward Particle & Debris Cycling:**
   - Ensure the `16` 3D debris chunks and `28` gravitational suction streaks have staggered initial radial phases (`(i / count)`) and continuously respawn at the outer perimeter (`radius * 0.95`) with smooth alpha fade-in/fade-out as they cross the inner event horizon, so the Black Hole **never** empties out or turns into a static disc in its late stage (`t = 1.5s – 3.0s`).
3. **Late-Stage Pre-Collapse Instability (`t = 2.2s – 3.0s`):**
   - During the final `0.8s` (`uProgress > 0.73`), accelerate the vortex swirl speed by `1.8x`, pulse the purple-gold accretion rings rapidly, and pinch the outer horizon inward right before `spawnSingularityDetonationVFX` triggers at `3.0s`.

### 6B. Upgrade Status & Ground Field VFX (`src/render/ThreeApp.ts` & `src/render/ThreeVFX.ts`)
1. **Frozen Status Effect (`ThreeApp.syncEnemies`):**
   - When an enemy has `e.isChilled && e.isStunned` (or `e.isChilled`), attach a reusable 3D **Crystalline Ice Cluster Aura** (`encasedIceGroup` on the enemy render record: faceted translucent cyan-white crystal shards + pulsing frost ring at the enemy's feet) instead of only tinting the sprite RGB!
2. **Toxic / Acid & Burning Ground Fields (`ThreeApp.syncRecoveryFields` / `syncToxicFields`):**
   - Replace the flat solid-color `CircleGeometry` (`MeshBasicMaterial({ color: 0x65a30d })`) in `syncToxicFields` and `syncRecoveryFields` with an animated `THREE.ShaderMaterial` featuring:
     - Flowing Voronoi caustic cells / bubbling energy waves,
     - Soft radial edge feathering (no hard polygon circle border),
     - Pulsing concentric rune rings and rising particle motes.

---

## PHASE 8: Automated Verification & Performance Benchmark (`scratch/verify_stage1_refinement.ts`)

Create and run `scratch/verify_stage1_refinement.ts` to test and assert all 13 requirements across multiple random seeds:

1. **Five-Strike Convergence Performance Benchmark:**
   - Cast `convergence_barrage` repeatedly across multiple frames and verify:
     - Scene `PointLight` count remains constant (`<= 1` shared orbital light, `0` dynamic shader recompilations).
     - Total active particle meshes during 5-strike barrage is reduced by `> 60%` (`<= 140` vs `350`).
     - Average `vfx.update(0.016, cam)` execution time is `< 2.0ms`.
     - Initial 5-strike impact damage is deduplicated (applied once per enemy).
2. **Skill Enhancements vs. Attribute Chests Separation:**
   - Verify all 4 event pools (`basic_skill_totem`, `secondary_skill_totem`, `dash_skill_totem`, `ultimate_beacon`) grant additive enhancements (`enhancesSkillSlot`) and **never** replace `p.equippedSkills[slot].id`.
   - Verify LMB enhancements (`scatter_burst`, `arc_conduit`, `piercing_lance`, `rapid_gatling`) still fire `type: 'pulse'` Gold Blaster Bolts.
   - Verify RMB enhancements (`cryo_slashes`, `vortex_slashes`, `seismic_slashes`) retain Twin Converging Slashes (`type: 'bomb'`).
   - Verify Dash enhancements (`phase_dash`, `shock_dash`, `cryo_dash`) retain `tactical_dash`.
   - Verify Ultimate enhancements (`singularity`, `convergence_barrage`, `cryogenic_impact`) retain `orbital_judgment`.
   - Verify ordinary chest/attribute rolls (`rollThreeBuffChoices(rng)` with no event filter) return **100% pure attribute upgrades** and never return skill replacements or skill enhancements.
3. **Currency & Chest Economy:**
   - Spawn currency drops on elevated terrain (`Z = 25`, `Z = 255`, `Z = 615`), tick simulation when player is within pickup range, and verify currency is collected (`p.currency` increases) and `state.currencyDrops.length === 0` (zero floating meshes left behind).
   - Verify chest interaction deducts `pod.cost` once, marks `pod.isOpened = true`, prevents duplicate purchases, and grants exactly one reward (`commandArtifactActive` modal or single item drop).
4. **Randomized Stage 1 Crash-Site Crater & Multi-Seed Verification:**
   - Instantiate `Simulation` with 5 different seeds (`101`, `202`, `303`, `404`, `505`).
   - Verify every run begins at the crash-site spawn near the wrecked spaceship.
   - Verify plateau coordinates, event positions, and chest positions vary across seeds while staying within the compact `3600 × 3600` crater.
   - Verify all 4 event types (`primal_totem`, `secondary_totem`, `dash_totem`, `orbital_uplink`) spawn on walkable ground (`slope < 0.30`) with zero overlap against chests, the shipwreck, or the teleporter.
   - Verify enemies navigate generated slopes toward the player without getting stuck.
5. **Regression Suites & Build:**
   - Run `npx tsx scratch/verify_stage1_refinement.ts`
   - Run `npx tsx scratch/verify_ultimate_enhancements.ts`
   - Run `npx tsx scratch/verify_orbital_strike_vfx.ts`
   - Run `npx tsx scratch/verify_commander_skill_vfx.ts`
   - Run `npm run build`

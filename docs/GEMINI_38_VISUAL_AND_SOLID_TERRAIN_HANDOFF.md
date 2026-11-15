# ENDO NINE — Visual Quality, Unique Props & Solid Terrain Spec (Gemini 3.8 Single-Prompt Handoff)

> **Purpose:** Self-contained engineering specification for **Gemini 3.8** covering Stage 1 Boss visual upgrades, new enemy image integration, unique Option A trees + 3D rocks, and airtight terrain/camera collision.
>
> **Mandatory Canon & Compatibility Guardrails:**
> - Consult [`docs/LORE_CANON.md`](./LORE_CANON.md) and [`AGENTS.md`](../AGENTS.md). Stage 1 is **Main Campaign Stage 1: The Thawing Crash-Site Crater**; all alien bosses, enemies, trees, and rocks must remain **biological, organic, or mineral/symbiotic** (never industrial metal).
> - Keep combat balance, hero kits, and HUD intact.
> - **Interaction with [`docs/GEMINI_VISUAL_AND_PERF_HANDOFF_V2.md`](./GEMINI_VISUAL_AND_PERF_HANDOFF_V2.md):** If both specs are applied, **Part 4 below supersedes V2 Phase 3's `createObstacles()` `SpriteMaterial` caching for trees and rocks**, replacing them with cached 3D geometries/materials while keeping V2's shader, light, and `boundRenderLoop` optimizations intact.

---

## Single Prompt for Gemini 3.8 (Copy-Paste This)

> `"Read docs/GEMINI_38_VISUAL_AND_SOLID_TERRAIN_HANDOFF.md and docs/LORE_CANON.md. Implement Parts 1 through 4 in order following all Coding Standards in the doc. Do not alter combat balance or HUD layout. Run npm run build when finished and verify zero TypeScript or Vite errors."`

---

## Coding Standards (Must Follow)
1. **Data-driven tables over `if/else` chains:** Use typed config/catalog maps for boss frame metadata, enemy visuals, and tree/rock variants instead of branching per asset in `ThreeApp.ts`.
2. **One shared helper per concern:** Extract shared wall-sliding/terrain-clamping, aspect-ratio scaling, and UV frame-slicing helpers—never duplicate math across player, enemies, and boss.
3. **Cache GPU resources:** Reuse geometries, materials, and scratch `THREE.Vector3` instances; never allocate new `PlaneGeometry` or unshared `MeshBasicMaterial` per spawned entity or obstacle.
4. **Small single-purpose functions:** Keep helpers concise with early returns and shallow nesting.

---

## Part 1: Solid Terrain & Camera Collision (Zero Clipping / Going Through Ground)

### Verified Gaps to Fix
1. **Camera clips through cliffs/mountains ([`src/render/ThreeApp.ts`](../src/render/ThreeApp.ts) `L2023–2028`):** `eyeX, eyeY, eyeZ` is computed purely from `cameraFocus` + `targetDist`/`cameraYaw`/`cameraPitch` with zero terrain collision.
2. **Post-push cliff penetration ([`src/sim/Simulation.ts`](../src/sim/Simulation.ts) `L1403`, `L6086`, `L6104`):** `resolveObstacleCollisions()` and `resolveEnemyCollisions()` push entities *after* `checkTraversable()` without re-validating against cliffs, allowing crowds or obstacles to shove the player/enemies inside sheer cliff walls.
3. **Single-ray cliff probe & step-up no-op ([`src/sim/TerrainSystem.ts`](../src/sim/TerrainSystem.ts) `L1160–1190`, [`src/sim/Simulation.ts`](../src/sim/Simulation.ts) `L1413–1416`):** `checkTraversable()` only tests center + 1 forward probe (`probeX, probeY`), letting lateral/diagonal movement clip collider sides into steep ledges; and `p.z = Math.min(p.z, finalElev)` when `finalElev > p.z + 14` is a no-op that fails to push the entity out.
4. **Airborne enemies ignore terrain ([`src/sim/Simulation.ts`](../src/sim/Simulation.ts) `L5959–5963`):** `isAirborneUnit` (`wasp`, non-Titan `boss`) skips `checkTraversable` and has no minimum `e.z >= groundZ` clamp, letting flyers pass through mountains/plateaus.
5. **Fixed dash sub-steps ([`src/sim/Simulation.ts`](../src/sim/Simulation.ts) `L1165`):** `dashSubSteps = 2` does not scale with high dash speeds.

### Required Implementation
1. **Camera Spring-Arm Terrain Collision (`ThreeApp.ts`):**
   - Extract a helper `resolveCameraTerrainCollision(focus: THREE.Vector3, eye: THREE.Vector3): void`.
   - Ray-march 10–12 evenly spaced samples along the segment from `focus` to `eye`. At each sample `(sx, sz)`, query `terrain.calculateHeight(sx, sz)`.
   - If the ray dips below `terrainH + 16`, shorten the camera arm length proportionally (`t` at first hit minus small padding) and re-evaluate `eye`, plus enforce `eye.y = Math.max(eye.y, terrain.calculateHeight(eye.x, eye.z) + 18)`.
2. **Multi-Point Perimeter Probe & Steep-Slope Push-Out (`TerrainSystem.ts`):**
   - Add a `sampleColliderMaxHeight(cx, cy, radius)` helper or probe center + 4 perimeter offsets (forward, forward-left, forward-right, and lateral normals relative to movement direction) inside `checkTraversable()`.
   - Add a public `pushOutOfSteepTerrain(pos: Vector2, z: number, radius: number): Vector2` helper: if `calculateHeight(pos.x, pos.y) > z + 14` on an unwalkable slope (`getSlopeGradient(...).slope > 0.84`), nudge `pos` along the normalized downhill gradient `(-gx, -gy)` over 2–3 small iterations until valid.
3. **Unified Solid Movement & Post-Push Re-Clamp (`Simulation.ts`):**
   - Extract one shared `moveWithTerrainSlide(pos, z, nextX, nextY, isAirborne, radius)` helper used by player walking, player dashing (with dynamic `subSteps = Math.max(2, Math.ceil(stepDist / 16))`), and ground enemies—eliminating duplicated tangent-sliding blocks.
   - After `resolveObstacleCollisions()` and `resolveEnemyCollisions()`, re-clamp moved ground positions with `checkTraversable()` + `pushOutOfSteepTerrain()`, and clamp `z = Math.max(z, terrain.getElevation(pos.x, pos.y).height)`.
   - For `isAirborneUnit`, clamp `e.z = Math.max(e.z, e.groundZ + 28)` (or block horizontal flight into terrain walls taller than `e.z + 14`).
   - Also keep `ThreeTerrain.ts` and `TerrainSystem.ts` aligned (`L48` already queries `calculateHeight`; add a small collider margin `colliderRadius + 4` on steep cliff lips so entities never visually touch 22.5-unit triangle chord cuts).

---

## Part 2: Stage 1 Boss Visual Quality Overhaul

### Verified Targets
- [`src/sim/Stage1BossConfig.ts`](../src/sim/Stage1BossConfig.ts)
- [`public/assets/stage1_boss/boss_manifest.json`](../public/assets/stage1_boss/boss_manifest.json)
- [`src/render/ThreeApp.ts`](../src/render/ThreeApp.ts) (`L686–690`, `L2693–2704`, `L3265–3325`)

### Required Implementation
1. **Per-Sheet Aspect-Ratio Metadata (`Stage1BossConfig.ts`):**
   - Add `frameWidth` / `frameHeight` (from `boss_manifest.json`, e.g., `walk`: `443×443`, `laser`: `378×249`, etc., or compute automatically from `tex.image.width / frameCount` and `tex.image.height` once loaded).
   - Keep `baseHeight: 438` constant and dynamically set `titanMesh.scale.set((frameWidth / frameHeight) * (baseHeight / baseWidth), 1, 1)` on sheet change so non-square sheets (`boss_laser_*`) never stretch vertically while feet remain anchored at `e.z - footOffset`.
2. **Cylindrical Y-Axis Billboarding (`ThreeApp.ts:3312`):**
   - Replace `record.titanMesh.quaternion.copy(this.camera.quaternion)` with yaw-only Y-axis billboarding (`Math.atan2(this.camera.position.x - e.pos.x, this.camera.position.z - e.pos.y)`). The colossus must stand upright when viewed from high plateaus instead of leaning backward.
3. **2.5D Shaded Boss Billboard Shader (`ThreeApp.ts:2694–2700`):**
   - Enable mipmaps (`LinearMipmapLinearFilter`, `generateMipmaps = true`, `anisotropy = 4`) on `boss_*` textures to stop distance shimmer.
   - Replace plain `MeshBasicMaterial` on `titanMesh` with a reusable custom `ShaderMaterial` (or `MeshLambertMaterial` + `onBeforeCompile`) supporting:
     - **Half-texel UV inset** per strip frame (`uFrameOffset`, `uFrameWidth`) so adjacent frames never bleed.
     - **2.5D directional shading + cool rim light + underside/foot AO** (darkening the lowest 15% of `vUv.y` so the feet feel grounded in thawed earth).
     - **Scene fog integration** and **pulsing bioluminescent accent** + clean `uHitFlash` / `uStatusTint` uniforms.
4. **Heavy Footstep Grounding VFX (`ThreeApp.ts`):**
   - Trigger subtle dust/frost burst puffs and minor camera rumble (when nearby) on `walk` contact frames (`frameIdx === 0 || frameIdx === 4`, once per step transition), paired with a soft ground contact shadow decal under `titanMesh`.

---

## Part 3: New Enemy Image Pipeline (`EnemyVisualDefs` Catalog)

### Verified Targets
- [`src/render/ThreeApp.ts`](../src/render/ThreeApp.ts) (`L617–618`, `L665–695`, `L3137–3264`)
- New file: `src/sim/EnemyVisualDefs.ts` (or export from [`src/sim/EnemyDefs.ts`](../src/sim/EnemyDefs.ts))

### Required Implementation
1. **Create a Table-Driven `ENEMY_VISUAL_CATALOG` (`EnemyVisualDefs.ts`):**
   - Map each enemy type (`crawler`, `spitter`, `wasp`, `elite`, `boss` / mini-boss) to a uniform descriptor:
     ```ts
     export interface EnemyVisualDef {
       textureKey: string;
       fallbackKey: string;
       baseHeight: number;
       frameCount: number;       // 1 for static PNG, >1 for horizontal strip
       fps: number;
       directional?: boolean;    // Optional _front/_back/_left/_right suffix support
       hoverHeight: number;      // 0 for ground units, >0 for flyers like wasp
       shadowScale: number;
       hpWidth: number;
       hpHeight: number;
       hpColor: number;
       auraColor?: number;
     }
     ```
2. **Auto-Aspect Sizing & Shared Cached Resources (`ThreeApp.ts`):**
   - Create one shared `computeSpriteAspectScale(tex, frameCount, baseHeight)` helper so newly generated enemy PNGs (or strips) preserve their natural proportions (`width = baseHeight * (imgW / frameCount) / imgH`) instead of squashing into `baseS × baseS`.
   - Reuse cached `PlaneGeometry` (unit `1×1` scaled per enemy) and shared `shadowGeo` / `shadowMat` / HP-bar geometries across all enemies rather than allocating new geometries/materials per spawn.
   - Apply the same **Y-axis cylindrical billboarding + 2.5D shading/rim/hit-flash shader** (or clean cached `SpriteMaterial` with uniform-safe tinting) so new generated enemy images blend naturally with the Stage 1 Boss and terrain.

---

## Part 4: Unique Trees (Option A: 3D Crossed-Card + Root Hybrid) & Unique 3D Rocks

### Verified Targets
- [`src/render/ThreeApp.ts`](../src/render/ThreeApp.ts) (`L1814–1924` `createObstacles()`)
- [`src/sim/GameState.ts`](../src/sim/GameState.ts) (`L558–635` obstacle generation)

### Required Implementation
1. **Deterministic Seed Helper:**
   - Write a tiny pure hash helper `hashObstacleSeed(id: string, index: number): number` returning deterministic `[0, 1)` floats so each obstacle looks identical across restarts from the same seed while remaining distinct from every neighbor.
2. **Unique Option A Trees (`createUniqueTreeGroup` in `ThreeApp.ts`):**
   - Replace single `THREE.Sprite` trees (`obs.type === 'tree'`) with a `THREE.Group` positioned at `(obs.pos.x, elevation, obs.pos.y)`:
     - **3D Crossed-Card Canopy/Trunk:** Build **2–3 intersecting vertical planes** rotated at `0°`, `60°`, `120°` (or `0°`, `90°` + slight angled canopy cap plane) using `MeshLambertMaterial({ map, alphaTest: 0.35, side: THREE.DoubleSide })` cached per `(treeTexKey, tintVariant)` so trees receive directional light and never tilt with camera pitch.
     - **Per-Tree Uniqueness:** Apply seeded **Y-rotation (`0..2π`)**, **horizontal UV mirror (`50%` chance)**, **non-uniform width/height scale (`±15%`)**, **subtle organic trunk lean (`±0.08 rad`)**, and **subtle hue/brightness tint variation** within the crimson/coral/bioluminescent palette.
     - **Unique Base Clutter:** Spawn **2–4 small seeded 3D root buttresses, mossy stones, or glowing fungi** clustered tightly around `r < obs.radius * 0.7` at the trunk base so every tree has a distinct grounded silhouette.
3. **Unique 3D Rocks (`createUniqueRockGroup` in `ThreeApp.ts`):**
   - Replace flat 2D `rock_var_1..8` `Sprite`s (`obs.type === 'rock'`) with **3D displaced rock meshes**:
     - Use a small pool of **6–8 pre-built displaced `IcosahedronGeometry(1, 1)` variants** (seeded vertex noise + `flatShading: true` + `computeVertexNormals()`), textured with `rock_texture` (`MeshLambertMaterial`, cached across 3–4 mineral/frost-slate color tints).
     - For each rock obstacle, compose 1 primary boulder + 1–2 smaller angled shoulder stones (or 1–2 small translucent crystal shards from `crystal_*` palette on ~35% of rocks) using seeded rotation, non-uniform XYZ stretch, and slight sink into the terrain (`elevation - radius * 0.2`) so no two rocks repeat and none float.
4. **Crystals & Flora Polish:**
   - Upgrade `crystal` and `mushroom`/`flora` entries in `createObstacles()` to share cached materials/crossed-card planes (instead of single-plane sprites) with seeded Y-rotation and scale variation, and expand `GameState.ts` obstacle `variant` diversity cleanly if needed.

---

## Verification Checklist
1. `npm run build` exits `0` with zero TypeScript or Vite bundling errors.
2. Launch `npm run preview -- --port 4173` and verify:
   - Orbiting the camera near cliffs, plateaus, and northern ridges never clips the camera inside or beneath the terrain.
   - Walking, dashing, and crowd/obstacle push-back never shove the player or enemies inside steep cliffs; flying enemies stay above ground height.
   - Stage 1 Boss stands upright from all camera angles, shows un-stretched proportions across `walk`/`laser`/`tentacle`/`elemental` animations, and displays crisp lighting/rim shading without frame bleed.
   - Every tree (Option A crossed-card + base roots/clutter) and every rock (3D displaced boulder + mineral/crystal variation) looks visually distinct and grounded.

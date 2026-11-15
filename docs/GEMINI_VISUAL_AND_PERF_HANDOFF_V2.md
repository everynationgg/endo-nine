# ENDO NINE — Stage 1 Visual & Performance Upgrade Spec (Gemini 3.8 Handoff)

> **Purpose:** Self-contained, phased engineering instructions so **Gemini 3.8** can upgrade Stage 1 visuals, reposition the crashed colony ship onto the southern skyline between massive rocks, and optimize GPU/CPU frame pacing in small, low-credit, low-risk turns.
>
> **Mandatory Canon Guardrails:**
> - Consult [`docs/LORE_CANON.md`](./LORE_CANON.md) and [`AGENTS.md`](../AGENTS.md).
> - Stage 1 represents **Main Campaign Stage 1: The Thawing Crash-Site Crater**. Keep the freshly thawing dark soil, frost/snow patches, exposed crater rock, glacial southwest stream, and biological/symbiotic alien flora. Do **not** revert to lush green RoR2 grass or add metal industrial buildings. (Note: `docs/GEMINI_OPTIMIZATION_AND_VISUAL_GUIDE.md` in this folder is outdated from an earlier grass prototype — ignore it and follow **this** document.)
> - Keep all existing hero gameplay, combat balance, HUD scaling, and `Simulation.ts` logic intact.

---

## How the User Should Run This With Gemini 3.8
Do **one phase per prompt** in a clean chat so Gemini 3.8 never loses context or edits too many files at once:
1. **Prompt 1 (Visual Centerpiece — Horizon Shipwreck & Flanking Rocks):**  
   `"Read docs/GEMINI_VISUAL_AND_PERF_HANDOFF_V2.md and implement ONLY Phase 1. Do not touch HUD or combat mechanics. Run npm run build and verify the TypeScript build passes cleanly."`
2. **Prompt 2 (Terrain Visual Polish — Cliff Skirts, Stone Arches, Lighting & Contrast):**  
   `"Read docs/GEMINI_VISUAL_AND_PERF_HANDOFF_V2.md and implement ONLY Phase 2. Run npm run build when finished."`
3. **Prompt 3 (FPS & Streaming Performance — Shader Trim, Material Caching, Frame Loop Cleanup):**  
   `"Read docs/GEMINI_VISUAL_AND_PERF_HANDOFF_V2.md and implement ONLY Phase 3. Run npm run build when finished."`
4. **Prompt 4 (Remove Overhead — CSS Blurs, Dead Assets, Decorative Sky/Light Bloat):**  
   `"Read docs/GEMINI_VISUAL_AND_PERF_HANDOFF_V2.md and implement ONLY Phase 4. Run npm run build when finished."`

---

## Phase 1: Massive Horizon Spaceship Wedged Between Giant Rocks

### Design Goal
Push the crashed colony ship **further back to the south (`+Z`) edge**, **scale it up dramatically** so its torn superstructure **looms into the sky above the horizon**, and wedge it cleanly **between massive flanking boulder/crag monoliths** left and right so players look back south from the crater floor and see a cinematic colossal wreck wedged in the canyon breach.

### Exact Code Targets
- [`src/render/ThreeTerrain.ts`](../src/render/ThreeTerrain.ts):
  - Lines `12–30`: `shipPos` default `(1800, 0, 2960)` and `update()` Y-axis billboarding.
  - Lines `98` & `213–233`: `uCrashSite` uniform (`1800, 2960`) and scorch/skid trench shader math.
  - Lines `253–319`: `createCrashedSpaceship(terrain)`.
- [`src/render/ThreeApp.ts`](../src/render/ThreeApp.ts):
  - Lines `326–327`: `this.camera = new THREE.PerspectiveCamera(50, ..., 2, 8000)` and `this.scene.fog = new THREE.FogExp2(0x8ec5e8, 0.00028)`.
  - Lines `919–925`: `vistaRidges` (`South-West` & `South-East` horizon cones).

### Required Implementation Details
1. **Reposition & Scale `shipHull` (`ThreeTerrain.ts`):**
   - Move `shipX = 1800`, `shipY = 3520` (further south back toward the edge of the `3600×3600` world, sitting in the southern breach mouth; check elevation via `terrain.getElevation(shipX, shipY).height`, or anchor near basin floor height `~0–18` so it doesn't float awkwardly).
   - Increase `shipWidth` from `420` to `~1180–1350` and `shipHeight` from `315` to `~885–1010` (`4:3` aspect preserved), anchored around `y = shipHeight * 0.36` so the lower keel sits buried behind foreground boulders/furrow while the upper torn hull breaks cleanly **above the skyline against the sky**.
   - **Important Camera/Fog Fix:** At `shipY = 3520` while playing near spawn (`y ~ 2600`) or mid-map (`y ~ 1800`), distance is `~900–1800` units. Reduce billboard rotation swing slightly or clamp `angle` in `ThreeTerrain.ts:24–30` so turning east/west doesn't make a 1300-unit wide plane spin into nearby flanking rocks and clip! Keeping `shipHull.rotation.y` gently clamped near `Math.PI` (`Math.PI + clamp(atan2(dx, dz) - Math.PI, -0.35, 0.35)` — or rotating smoothly within `±20°`) prevents rock intersection clipping.
   - Ensure `scene.fog` (`ThreeApp.ts:324`) doesn't wash out the colossal wreck completely: if needed, test slight `fogExp2` reduction (`0.00028 -> 0.00022`) or set `shipHullMat.fog = true` with high contrast silhouette / emissive cyan-amber breach vents.
2. **Massive Flanking Rocks Framing the Ship (`ThreeTerrain.ts`):**
   - Inside `createCrashedSpaceship` (or a dedicated helper `createCrashSiteFlankRocks(terrain)` called right after it), build **3D layered rock monolith groups** flanking both the **west (`x ~ 1180–1360, z ~ 3180–3460`)** and **east (`x ~ 2240–2420, z ~ 3180–3460`)** sides of the ship hull, plus low jagged foreground debris boulders around `(1520, 3260)` and `(2080, 3260)` partially occluding the lower keel so the ship truly looks **wedged between huge crags**.
   - Use displaced/faceted `DodecahedronGeometry` or `IcosahedronGeometry` clusters (`flatShading: true`) textured with `/assets/environment/rock_texture.png` (`MeshLambertMaterial` matching cliff palette `#3e4c5e` / slate with frost highlights on top faces), NOT 2D sprites — 3D rock monoliths won't billboard-flip or flatten when moving sideways!
   - Wait on collision: Keep these giant framing rocks **outside/behind** the playable southern battle clearing (`z > 3150`) or keep `TerrainSystem.ts` boundary/walkable radius clear around player spawn (`(1800, 2500)`–`(1800, 2900)`) so players never snag on unseen visual rocks.
3. **Update Crash Scorch & Skid Furrow (`ThreeTerrain.ts:98, 213–233`):**
   - Update `uCrashSite` to `(1800, 3380)` (just in front of the massive keel), widen `distToShip` scorch radius slightly (`smoothstep(420.0, 75.0, ...)`), and extend `skidZ` (`2720..3550`) so the long charred plow furrow visibly connects the arena floor straight into the giant wreck between the rocks.

---

## Phase 2: Visual Polish — Cliff Contrast, Ancient Arches, Ground Readability & Atmosphere

### Design Goal
Eliminate "flat/plastic" 3D primitives (`northArch`, `ridgeArch`), make terrain elevation tiers and ramps read effortlessly at a glance, and blend props into the thawing crater world (matching `docs/maps/stage1_top_view_detailed.jpg` direction).

### Exact Code Targets
- [`src/render/ThreeApp.ts`](../src/render/ThreeApp.ts):
  - Lines `891–912`: `northArch` and `ridgeArch` (`stoneArchMat`).
  - Lines `914–933`: `vistaRidges`.
  - Lines `1841–1923`: `createObstacles` sprites (`tree`, `crystal`, `rock`, mushrooms).
- [`src/render/ThreeTerrain.ts`](../src/render/ThreeTerrain.ts):
  - Lines `159–212`: Triplanar ground blend (`topSurfaceCol`, `cliffCol`, `groundCol`).
  - Lines `321–431`: `createValleyRiver`.

### Required Implementation Details
1. **Replace Plastic Stone Arch Material (`ThreeApp.ts:892–895`):**
   - Currently `stoneArchMat` is an untextured flat `MeshLambertMaterial({ color: 0x3b506b, flatShading: true })`, which reads like smooth blue-grey plastic from above and mid-distance.
   - Give `stoneArchMat` `map: this.textures['rock_texture']`, `bumpMap: this.textures['rock_texture']`, `bumpScale: 3.5` (with `repeat` scaled cleanly on the Torus UVs so texture doesn't stretch), darker weathered color tint (`0x5b6f86`), plus optional snow/frost dusting or smaller base boulders around the arch footings where they meet the ground (`(1380, 615, 850)` and `(3050, 280, 1750)`).
2. **Slope-Base Ambient Occlusion & Ramp Readability (`ThreeTerrain.ts:191–212`):**
   - Right at cliff-to-floor transitions (`slope` around `0.15..0.45` and lower elevation valleys), add subtle dark scree/AO shading (`float cliffAO = smoothstep(0.10, 0.45, slope) * 0.22; groundCol *= (1.0 - cliffAO);`) so plateaus and ramps visually detach cleanly from flat soil below without relying on steep bright edges.
   - Tint steep cliff faces slightly cooler slate-indigo while letting gently sloped paths/ramps (`slope` moderate, away from frost hollows) read slightly cleaner and less noisy so combat navigation routes stand out immediately.
3. **Shoreline & Crater Rim Harmony (`ThreeTerrain.ts:321–431`):**
   - Soften the river edge foam/depth blend (`aDepth`) and darken wet mud along the immediate riverbank in the terrain shader or river edge alpha so the luminous cyan-blue meltwater stream looks nestled into wet thawed earth rather than pasted on top.

---

## Phase 3: Performance Optimization (Higher FPS, Less Opera/Discord Stream Lag)

### Design Goal
Reduce fragment shader ALU/bandwidth, cut per-frame JS GC allocations, reduce dynamic `PointLight` count evaluated per terrain pixel, and eliminate unbatched obstacle materials.

### Exact Code Targets
- [`src/render/ThreeTerrain.ts`](../src/render/ThreeTerrain.ts):
  - Lines `35`: `segs = 160` heightfield density (`25,600` vertices / `51,200` triangles).
  - Lines `56–86`: 4 textures with `anisotropy = 8`.
  - Lines `143–212`: `fbm` (3 octaves, called 7+ times per fragment!) + unconditional dual side-projection `texture2D` lookups even on completely flat ground.
  - Lines `304–317`: **3 separate `PointLight`s** inside `createCrashedSpaceship` (`cyanCoreLight`, `interiorAmberLight`, `exteriorGroundGlow`).
- [`src/render/ThreeApp.ts`](../src/render/ThreeApp.ts):
  - Lines `312–314`: `WebGLRenderer({ antialias: true })` and `setPixelRatio(Math.min(window.devicePixelRatio, 1.25))`.
  - Lines `1841–1923`: `createObstacles()` allocating a new `SpriteMaterial` and new shadow `MeshBasicMaterial` (check lines `1820–1839`) on every obstacle instead of sharing cached materials.
  - Line `1934`: `requestAnimationFrame(this.renderLoop.bind(this))` allocating a new closure every frame.

### Required Implementation Details
1. **Optimize Terrain Fragment Shader (`ThreeTerrain.ts`):**
   - **Skip side cliff texture lookups on flat terrain:** When `triWeights.y > 0.96` (`slope` flat), skip `sideRockX` / `sideRockZ` `texture2D` reads (`if (triWeights.y < 0.96) { ... } else { cliffCol = topSurfaceCol; }`). Most playable screen pixels are flat/gently rolling — this eliminates 2 texture fetches per pixel across ~75% of the screen!
   - **Trim `fbm()` cost (`ThreeTerrain.ts:143–153`):** Reduce `fbm` loop from `3` octaves to `2` octaves (or use single `vnoise` for `macroMask` / `scorchNoise` instead of multi-octave `fbm`), cutting procedural shader arithmetic by ~45% with virtually identical organic breakup.
   - **Reduce Anisotropy & Geometry Density Safely:** Set terrain `anisotropy = 4` (down from `8`) and test `segs = 128` (`16,384` vertices vs `25,600`, ~36% fewer terrain vertices) — verify visually that plateau lips and ramps remain smooth.
   - **Consolidate Ship `PointLight`s (`ThreeTerrain.ts:304–317`):** Merge the 3 ship `PointLight`s into **1 key `PointLight`** (cyan-teal core accent) + a cheap additive `PlaneGeometry` / `Sprite` floor glow decal instead of 3 dynamic lights, because Three.js evaluates every `PointLight` per fragment across every `MeshLambertMaterial`/`MeshStandardMaterial` in the scene.
2. **Cache Obstacle Materials & Stop Per-Frame Closure Allocation (`ThreeApp.ts`):**
   - In `ThreeApp.ts`: define `private readonly boundRenderLoop = this.renderLoop.bind(this);` and pass `requestAnimationFrame(this.boundRenderLoop)` inside `renderLoop` (line `1934`) and `start()` (line `595`) instead of `.bind(this)` every frame.
   - In `createObstacles` (`ThreeApp.ts:1841–1923`): cache `SpriteMaterial` instances in a `Map<THREE.Texture, THREE.SpriteMaterial>` (keyed by texture) and share one `shadowGeo` + one `shadowMat` (with scale on each shadow `Mesh`) instead of creating dozens of identical materials.
   - **Optional Lightweight Quality Setting (Safe for Discord Streaming):** Add a simple render scale cap (e.g. clamp `pixelRatio` to `Math.min(window.devicePixelRatio, 1.0)` on a `window` / localStorage toggle or FPS-adaptive DPR scaler if frame time > `22ms`) and verify `antialias` vs DPR tradeoff stays crisp without tanking browser video capture.

---

## Phase 4: Remove Unnecessary Overhead (CSS Blurs, Unused Assets, Decorative Overdraw)

### Exact Verified Targets
- [`src/ui/hud.css`](../src/ui/hud.css): Lines `65`, `562`, `1227`, `1337`, `1703`, `2232`, `2481` use `backdrop-filter: blur(4px..12px)`.
- [`src/render/ThreeApp.ts`](../src/render/ThreeApp.ts):
  - Lines `875–889`: Giant additive-blended `skyRing` (`RingGeometry(2600, 4200, 48)`).
  - Lines `897–912`: `northArch` & `ridgeArch` (`TorusGeometry`, optional RoR2 homage rings — remove cleanly if not wanted for Stage 1 canon).
  - Lines `935–958`: `moonMat` & `smallMoonMat` using full PBR `MeshStandardMaterial`.
  - Lines `960–994`: `sporePoints` (`350` transparent floating points).
- `public/assets/`: Currently `312 files / ~168 MB`.

### Required Implementation Details
1. **Replace `backdrop-filter: blur(...)` in `src/ui/hud.css`:**
   - Chromium/Opera must read back and blur the underlying live 60fps WebGL canvas every frame behind any element using `backdrop-filter: blur(...)`.
   - Remove `backdrop-filter: blur(...)` on active in-game HUD overlays (`hud.css` lines `65`, `562`, `1227`, `1337`, `1703`, `2232`, `2481`) and replace with clean opaque/translucent dark fills (`rgba(10, 16, 26, 0.84)` + subtle crisp borders). Zero visual loss, huge compositor/streaming smoothness win.
2. **Audit & Trim Unreferenced Files in `public/assets/`:**
   - Cross-check all filenames inside `public/assets/` against references across `src/` (`Select-String` / static grep) before deleting anything, and check `ThreeApp.ts:624–660` (`loadTextures`) for any preloaded legacy/unused texture keys so the browser doesn't decode and upload unused VRAM textures on boot.
3. **Strip Purely Decorative Sky/PBR Weight (`ThreeApp.ts`):**
   - Switch `moonMat` & `smallMoonMat` (`937, 949`) from `MeshStandardMaterial` to lightweight `MeshBasicMaterial` (distant unlit moons don't need PBR lighting!).
   - Either remove or make optional (`highQuality` only) the giant additive `skyRing` (`876–889`), `sporePoints` (`961–994`), and `northArch` / `ridgeArch` (`898–911`, which look untextured and aren't canonical Stage 1 crash-site architecture).

---

## Verification Checklist After Each Phase
1. `npm run build` exits `0` with zero TypeScript or Vite bundling errors.
2. Launch `npm run preview -- --port 4173` and verify:
   - Hero starts in the southern crash corridor with clear walking room; looking south frames the enlarged colony ship wedged between massive left/right boulder crags rising into the skyline.
   - Upper Summit Plateau, Middle Plateau, ramps, glacial stream, and Overseer Artifact render cleanly with zero Z-fighting or floating rocks.
   - Gameplay FPS stays smooth without shader stalls or console WebGL warnings.

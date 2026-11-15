# Endo Nine — Stage Configuration & Development Toolkit Architecture

## 1. Stage Configuration Single Source of Truth

- **Config Files:** Stage layouts live in `public/stages/<stageId>.config.json` (currently [stage1.config.json](file:///C:/Users/yoggn/Desktop/Ender%20Nine/public/stages/stage1.config.json)).
- **Schema & Registry:** Defined in [StageConfig.ts](file:///C:/Users/yoggn/Desktop/Ender%20Nine/src/dev/StageConfig.ts) via `StageConfig`, `StageLayoutProfile`, `StageDefinition`, and `STAGE_REGISTRY`.
- **Supported Terrain Profiles (Stage 1):**
  - `procedural`: Default procedural heightfield crater (`TerrainSystem` + `ThreeTerrain.stage1Group`).
  - `untitled_crater`: Custom `Untitled.glb` mesh profile (`TestMapLoader` + `ThreeTerrain.testMapGroup`).
- **Runtime Loading:**
  - [main.ts](file:///C:/Users/yoggn/Desktop/Ender%20Nine/src/main.ts) calls `loadStageConfigFromServer('stage1')` before constructing `Simulation`.
  - In development (`import.meta.env.DEV`), `loadStageConfigFromServer` reads `/__dev/stage-config/load?stageId=stage1` with `cache: 'no-store'`; otherwise it fetches `/stages/stage1.config.json`.
  - `GameState.applyStageConfig()` / `applyStageProfile()` applies player spawn, boss spawn, teleporter, world events, biological pods, obstacles (including `zOffset`, `rotationY`, `scaleVar`, `placementRule`), and `enemySpawnRegions`.
  - `Simulation.startRun()` re-applies `state.activeStageConfig` on every run and `Simulation.updateEnemySpawning()` honors enabled `enemySpawnRegions` when present.

## 2. Development-Only Server Save Middleware

Implemented in [vite.config.ts](file:///C:/Users/yoggn/Desktop/Ender%20Nine/vite.config.ts) inside `stageConfigDevPlugin()` (`apply: 'serve'` so it is excluded from production builds):

- `GET /__dev/stage-config/load?stageId=stage1`: Reads the allowlisted JSON config from disk.
- `POST /__dev/stage-config/save`:
  1. Validates `stageId` against an explicit allowlist (`APPROVED_STAGES = Set(['stage1'])`) preventing arbitrary filesystem writes.
  2. Validates schema (`schemaVersion === 1`, `profiles.procedural`).
  3. Writes a timestamped backup under `public/stages/.backups/` (keeping the newest 25 backups).
  4. Atomically writes `.tmp` then renames (`fs.renameSync`) to `public/stages/<stageId>.config.json`.
- File-watcher ignores `public/stages/.backups/**` and `**/*.tmp` to avoid unnecessary HMR disruption on save.

## 3. Production Security Gating

- **Main Menu:** `#btn-main-dev-mode` in [UIManager.ts](file:///C:/Users/yoggn/Desktop/Ender%20Nine/src/ui/UIManager.ts) is only mounted when `import.meta.env.DEV` is true.
- **Bundle Splitting / Exclusion:** [main.ts](file:///C:/Users/yoggn/Desktop/Ender%20Nine/src/main.ts) dynamically imports `./dev/DevToolkit` only inside `if (import.meta.env.DEV)`, keeping [DevToolkit.ts](file:///C:/Users/yoggn/Desktop/Ender%20Nine/src/dev/DevToolkit.ts), [StageEditor.ts](file:///C:/Users/yoggn/Desktop/Ender%20Nine/src/dev/StageEditor.ts), [GameplayDebugger.ts](file:///C:/Users/yoggn/Desktop/Ender%20Nine/src/dev/GameplayDebugger.ts), and [PerfMonitor.ts](file:///C:/Users/yoggn/Desktop/Ender%20Nine/src/dev/PerfMonitor.ts) out of production bundles.
- **Client Save Guard:** `saveStageConfigToServer()` returns early if `!import.meta.env.DEV`.

## 4. Toolkit Modules & Hotkeys (Local Dev Only)

- **Visual Stage Editor** ([StageEditor.ts](file:///C:/Users/yoggn/Desktop/Ender%20Nine/src/dev/StageEditor.ts)): Independent orbit/pan/zoom camera, Object Library (`STAGE_OBJECT_CATALOG`), searchable Hierarchy, `TransformControls` gizmos (`Select`/`Move`/`Rotate`/`Scale` via `1`/`2`/`3`/`4`), terrain/water placement snapping, Enemy Spawn Region bounding-box editing, collider overlay, live `validateStageProfile` drawer, 50-step Undo/Redo (`Ctrl+Z`/`Ctrl+Y`), and Save (`Ctrl+S`).
- **Instant Playtest Mode** ([DevToolkit.ts](file:///C:/Users/yoggn/Desktop/Ender%20Nine/src/dev/DevToolkit.ts)): Validates and snapshots in-memory edits (without writing disk), launches real `ThreeApp.startRun()`, and restores unsaved editor changes via **Return to Editor** (`Shift+F8`).
- **Gameplay Debugger** ([GameplayDebugger.ts](file:///C:/Users/yoggn/Desktop/Ender%20Nine/src/dev/GameplayDebugger.ts), `F8`): Hero switcher, heal, invulnerability, cooldown reset, currency/item/buff/augment grants, enemy spawner, AI freeze, HP/state/collider/nav-path/LOS overlays, Stage 1 Titan attack triggers (`laser`, `tentacle`, `elemental`), and teleporter/event shortcuts.
- **Performance Monitor** ([PerfMonitor.ts](file:///C:/Users/yoggn/Desktop/Ender%20Nine/src/dev/PerfMonitor.ts), `F7`): Live FPS, frame time vs 16.67 ms budget, spike detection, entity counts, `renderer.info` draw calls & triangles, 8 repeatable stress scenarios, and JSON/CSV export.

## 5. Adding Future Stages (e.g., Stage 2)

1. Add a `StageDefinition` entry to `STAGE_REGISTRY` in `src/dev/StageConfig.ts`.
2. Add the new `stageId` to `APPROVED_STAGES` in `vite.config.ts`.
3. Create `public/stages/<stageId>.config.json` conforming to `StageConfig`.
4. Open the existing `StageEditor` passing `stageId` — no duplicate editor code required.

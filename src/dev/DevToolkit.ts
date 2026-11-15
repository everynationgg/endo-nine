import type { ThreeApp } from '../render/ThreeApp';
import type { UIManager } from '../ui/UIManager';
import { StageEditor } from './StageEditor';
import { GameplayDebugger } from './GameplayDebugger';
import type { StageConfig, StageProfileKey } from './StageConfig';
import { cloneStageConfig, validateStageProfile } from './StageConfig';

export class DevToolkit {
  private app: ThreeApp;
  private uiManager: UIManager;
  public stageEditor: StageEditor;
  public gameplayDebugger: GameplayDebugger;

  private dashboardEl: HTMLElement | null = null;
  private validationEl: HTMLElement | null = null;
  private playtestBarEl: HTMLElement | null = null;

  private isInPlaytest: boolean = false;
  private playtestSnapshot: StageConfig | null = null;
  private playtestWasDirty: boolean = false;
  private playtestProfileKey: StageProfileKey = 'procedural';

  private readonly boundGlobalKey = (e: KeyboardEvent) => {
    if (e.shiftKey && e.key === 'F8' && this.isInPlaytest) {
      e.preventDefault();
      this.returnToEditorFromPlaytest();
      return;
    }
    if (!e.shiftKey && e.key === 'F8') {
      e.preventDefault();
      this.gameplayDebugger.toggle();
    }
  };

  constructor(app: ThreeApp, uiManager: UIManager) {
    this.app = app;
    this.uiManager = uiManager;
    this.stageEditor = new StageEditor(app);
    this.gameplayDebugger = new GameplayDebugger(app);

    this.stageEditor.onReturnToDashboard = () => {
      this.openDashboard();
    };

    this.stageEditor.onPlaytestRequested = (snapshot) => {
      this.startPlaytestFromEditor(snapshot);
    };

    this.app.setPostRenderCallback((_dt, now) => {
      this.gameplayDebugger.onFrameTick(now);
    });

    this.mountDashboardDOM();
    this.mountPlaytestBarDOM();
    window.addEventListener('keydown', this.boundGlobalKey);

    this.uiManager.onOpenDeveloperModeCallback = () => {
      this.openDashboard();
    };
  }

  private mountDashboardDOM(): void {
    document.getElementById('screen-dev-dashboard')?.remove();
    const el = document.createElement('div');
    el.id = 'screen-dev-dashboard';
    el.className = 'screen-modal hidden';
    el.innerHTML = `
      <div class="dev-dash-card">
        <div class="dev-dash-header">
          <div>
            <h2>DEVELOPER MODE</h2>
            <div class="dev-dash-sub">Local Development Toolkit — Stage 1 &amp; Engine Utilities</div>
          </div>
          <span class="dev-dash-env-badge">LOCAL DEV ONLY</span>
        </div>

        <div class="dev-dash-grid">
          <button id="dev-card-stage-editor" class="dev-dash-tile">
            <div class="dev-dash-tile-title">🗺 Visual Stage Editor</div>
            <div class="dev-dash-tile-desc">Visually inspect and reposition Stage 1 objects, spawns, events, and chests on the live 3D terrain and save directly to local config.</div>
            <div class="dev-dash-tile-meta" id="dev-dash-stage-meta">Stage 1: The Wreckage</div>
          </button>

          <button id="dev-card-debugger" class="dev-dash-tile">
            <div class="dev-dash-tile-title">🧪 Gameplay Debugger</div>
            <div class="dev-dash-tile-desc">Test heroes, items, buffs, augments, enemies, Stage 1 Titan attacks, and teleporter events in real time.</div>
            <div class="dev-dash-tile-meta" id="dev-dash-dbg-meta">Live Sim &amp; Visual Overlays [F8]</div>
          </button>

          <button id="dev-card-perf" class="dev-dash-tile">
            <div class="dev-dash-tile-title">📊 Performance Monitor</div>
            <div class="dev-dash-tile-desc">Monitor FPS, 16.67 ms frame-time budget, draw calls, triangles, and run repeatable stress-test benchmarks.</div>
            <div class="dev-dash-tile-meta" id="dev-dash-perf-meta">Phase 6 Module</div>
          </button>

          <button id="dev-card-validate" class="dev-dash-tile">
            <div class="dev-dash-tile-title">✅ Stage Validation</div>
            <div class="dev-dash-tile-desc">Run configuration, boundary, walkability, slope, water placement, and spawn clearance checks on Stage 1.</div>
            <div class="dev-dash-tile-meta" id="dev-dash-val-meta">Click to run diagnostics</div>
          </button>
        </div>

        <div id="dev-dash-validation-box" class="dev-dash-val-box hidden"></div>

        <div class="dev-dash-footer">
          <button id="btn-dev-dash-back" class="sci-btn">← Return to Main Menu</button>
        </div>
      </div>
    `;
    document.body.appendChild(el);
    this.dashboardEl = el;
    this.validationEl = el.querySelector('#dev-dash-validation-box');

    el.querySelector('#dev-card-stage-editor')?.addEventListener('click', () => {
      this.closeDashboard();
      document.getElementById('screen-main-menu')?.classList.add('hidden');
      this.stageEditor.open();
    });

    el.querySelector('#dev-card-debugger')?.addEventListener('click', () => {
      this.closeDashboard();
      if (!this.app.getSimulation().state.isGameStarted) {
        this.uiManager.hideAllGameModalsForDev();
        this.app.startRun();
      }
      this.app.exitPointerLock();
      this.gameplayDebugger.open();
    });

    el.querySelector('#dev-card-perf')?.addEventListener('click', () => {
      this.uiManager.showPickupNotification('Performance Monitor will be enabled in Phase 6.');
    });

    el.querySelector('#dev-card-validate')?.addEventListener('click', () => {
      this.runStageValidationReport();
    });

    el.querySelector('#btn-dev-dash-back')?.addEventListener('click', () => {
      this.closeDashboard();
      document.getElementById('screen-main-menu')?.classList.remove('hidden');
    });
  }

  private mountPlaytestBarDOM(): void {
    document.getElementById('dev-playtest-bar')?.remove();
    const bar = document.createElement('div');
    bar.id = 'dev-playtest-bar';
    bar.className = 'dev-playtest-bar interactive hidden';
    bar.innerHTML = `
      <span class="dev-pt-tag">▶ PLAYTEST</span>
      <span id="dev-pt-snapshot-badge" class="dev-pt-snap">In-Memory Layout</span>
      <button id="btn-playtest-debugger" class="sci-btn dev-ed-btn">🧪 Debugger [F8]</button>
      <button id="btn-playtest-return" class="sci-btn primary-gold dev-ed-btn">← Return to Editor (Shift+F8)</button>
    `;
    document.body.appendChild(bar);
    this.playtestBarEl = bar;

    bar.querySelector('#btn-playtest-debugger')?.addEventListener('click', () => {
      this.app.exitPointerLock();
      this.gameplayDebugger.toggle();
    });
    bar.querySelector('#btn-playtest-return')?.addEventListener('click', () => {
      this.returnToEditorFromPlaytest();
    });
  }

  public startPlaytestFromEditor(snapshot: StageConfig): void {
    const sim = this.app.getSimulation();
    const profileKey = this.stageEditor.getActiveProfileKey();
    const profile = snapshot.profiles?.[profileKey];
    const issues = validateStageProfile(profile, sim.state.terrain, sim.state.worldWidth, sim.state.worldHeight);
    const errors = issues.filter((i) => i.severity === 'error');
    if (errors.length > 0) {
      this.uiManager.showPickupNotification(`Playtest blocked: ${errors[0].message}`);
      return;
    }

    // Hold temporary snapshot strictly in memory (do NOT write disk)
    this.playtestSnapshot = cloneStageConfig(snapshot);
    this.playtestWasDirty = this.stageEditor.getIsDirty();
    this.playtestProfileKey = profileKey;
    this.isInPlaytest = true;

    this.stageEditor.close();
    this.closeDashboard();
    this.uiManager.hideAllGameModalsForDev();

    // Apply in-memory config so startRun spawns at edited playerSpawnPos with edited layout
    sim.state.applyStageConfig(this.playtestSnapshot, this.playtestProfileKey);
    this.app.startRun();

    const snapBadge = this.playtestBarEl?.querySelector('#dev-pt-snapshot-badge');
    if (snapBadge) {
      snapBadge.textContent = this.playtestWasDirty
        ? `● Temporary Unsaved Edit (${sim.state.selectedHeroId})`
        : `Saved Layout (${sim.state.selectedHeroId})`;
    }
    this.playtestBarEl?.classList.remove('hidden');

    if (issues.length > 0) {
      this.uiManager.showPickupNotification(`Playtest started with ${issues.length} validation warning(s). Press Shift+F8 to return.`);
    }
  }

  public returnToEditorFromPlaytest(): void {
    if (!this.isInPlaytest) return;
    this.isInPlaytest = false;
    this.gameplayDebugger.close();
    this.playtestBarEl?.classList.add('hidden');
    this.app.stopPlaytestAndClear();
    this.uiManager.hideAllGameModalsForDev();

    // Re-open Stage Editor preserving temporary unsaved edits and dirty flag intact!
    const snap = this.playtestSnapshot;
    const wasDirty = this.playtestWasDirty;
    this.playtestSnapshot = null;
    this.stageEditor.open(snap, wasDirty);
  }

  public getIsInPlaytest(): boolean {
    return this.isInPlaytest;
  }

  public openDashboard(): void {
    document.getElementById('screen-main-menu')?.classList.add('hidden');
    const state = this.app.getSimulation().state;
    const meta = this.dashboardEl?.querySelector('#dev-dash-stage-meta');
    if (meta) {
      meta.textContent = `Active: ${state.stageName} [${state.getActiveProfileKey()}]`;
    }
    this.dashboardEl?.classList.remove('hidden');
  }

  public closeDashboard(): void {
    this.dashboardEl?.classList.add('hidden');
  }

  private runStageValidationReport(): void {
    if (!this.validationEl) return;
    const state = this.app.getSimulation().state;
    const profile = state.exportCurrentProfile();
    const issues = validateStageProfile(profile, state.terrain, state.worldWidth, state.worldHeight);
    const errors = issues.filter((i) => i.severity === 'error');
    const warnings = issues.filter((i) => i.severity === 'warning');

    this.validationEl.classList.remove('hidden');
    if (issues.length === 0) {
      this.validationEl.innerHTML = `<div style="color:#6ee7b7; font-weight:700;">✓ All Stage 1 validation checks passed (0 errors, 0 warnings).</div>`;
      return;
    }

    this.validationEl.innerHTML = `
      <div style="font-weight:700; margin-bottom:6px; color:${errors.length ? '#fca5a5' : '#fde047'};">
        Stage Validation: ${errors.length} error(s), ${warnings.length} warning(s)
      </div>
      <div class="dev-dash-val-list">
        ${issues
          .map(
            (i) =>
              `<div class="dev-val-item ${i.severity}">[${i.severity.toUpperCase()}] ${i.message}</div>`
          )
          .join('')}
      </div>
    `;
  }
}

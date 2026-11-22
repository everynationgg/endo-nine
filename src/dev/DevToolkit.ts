import type { ThreeApp } from '../render/ThreeApp';
import type { UIManager } from '../ui/UIManager';
import { StageEditor } from './StageEditor';
import { GameplayDebugger } from './GameplayDebugger';
import { PerfMonitor } from './PerfMonitor';
import type { StageConfig, StageProfileKey } from './StageConfig';
import { cloneStageConfig, validateStageProfile } from './StageConfig';

export class DevToolkit {
  private app: ThreeApp;
  private uiManager: UIManager;
  public stageEditor: StageEditor;
  public gameplayDebugger: GameplayDebugger;
  public perfMonitor: PerfMonitor;

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
      const willOpen = !this.gameplayDebugger.getIsOpen();
      if (willOpen) {
        this.app.isDevModeSession = true;
        this.setDevPaused(true);
        this.updateReturnButtonVisibility();
        this.playtestBarEl?.classList.remove('hidden');
      }
      this.gameplayDebugger.toggle();
      return;
    }
    if (!e.shiftKey && e.key === 'F7') {
      e.preventDefault();
      this.perfMonitor.toggle();
    }
  };

  constructor(app: ThreeApp, uiManager: UIManager) {
    this.app = app;
    this.uiManager = uiManager;
    this.stageEditor = new StageEditor(app);
    this.gameplayDebugger = new GameplayDebugger(app);
    this.perfMonitor = new PerfMonitor(app);

    this.stageEditor.onReturnToDashboard = () => {
      this.openDashboard();
    };

    this.stageEditor.onPlaytestRequested = (snapshot) => {
      this.startPlaytestFromEditor(snapshot);
    };

    this.gameplayDebugger.onPauseChanged = () => {
      this.syncPlaytestPauseUI();
    };

    this.app.setPostRenderCallback((dt, now, info) => {
      this.gameplayDebugger.onFrameTick(now);
      this.perfMonitor.onFrame(dt, now, info);
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
            <div class="dev-dash-tile-meta" id="dev-dash-perf-meta">Real-Time Telemetry &amp; 8 Benchmarks [F7]</div>
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
      this.app.isDevModeSession = true;
      const sim = this.app.getSimulation();
      if (!sim.state.isGameStarted) {
        this.uiManager.hideAllGameModalsForDev();
        this.app.startRun(true);
      }
      this.setDevPaused(true);
      const snapBadge = this.playtestBarEl?.querySelector('#dev-pt-snapshot-badge');
      if (snapBadge) snapBadge.textContent = '⏸ PAUSED — Mouse Free';
      this.playtestBarEl?.classList.remove('hidden');
      this.updateReturnButtonVisibility();
      this.gameplayDebugger.open();
    });

    el.querySelector('#dev-card-perf')?.addEventListener('click', () => {
      this.closeDashboard();
      this.app.isDevModeSession = true;
      this.setDevPaused(true);
      this.perfMonitor.open();
    });

    el.querySelector('#dev-card-validate')?.addEventListener('click', () => {
      this.runStageValidationReport();
    });

    el.querySelector('#btn-dev-dash-back')?.addEventListener('click', () => {
      this.closeDashboard();
      this.app.isDevModeSession = false;
      this.setDevPaused(false);
      this.playtestBarEl?.classList.add('hidden');
      document.getElementById('screen-main-menu')?.classList.remove('hidden');
    });
  }

  private mountPlaytestBarDOM(): void {
    document.getElementById('dev-playtest-bar')?.remove();
    const bar = document.createElement('div');
    bar.id = 'dev-playtest-bar';
    bar.className = 'dev-playtest-bar interactive hidden';
    bar.innerHTML = `
      <span class="dev-pt-tag">🛠 DEV MODE</span>
      <button id="btn-playtest-pause" class="sci-btn primary-gold dev-ed-btn">▶ Play</button>
      <span id="dev-pt-snapshot-badge" class="dev-pt-snap">⏸ PAUSED — Mouse Free</span>
      <button id="btn-playtest-debugger" class="sci-btn dev-ed-btn">🧪 Debugger [F8]</button>
      <button id="btn-playtest-perf" class="sci-btn dev-ed-btn">📊 Perf [F7]</button>
      <button id="btn-playtest-return" class="sci-btn dev-ed-btn">← Return to Editor (Shift+F8)</button>
      <button id="btn-playtest-dashboard" class="sci-btn dev-ed-btn">⚙ Dev Menu</button>
    `;
    document.body.appendChild(bar);
    this.playtestBarEl = bar;

    bar.querySelector('#btn-playtest-pause')?.addEventListener('click', () => {
      const sim = this.app.getSimulation();
      const nextPaused = !sim.state.isPaused;
      this.setDevPaused(nextPaused);
      if (!nextPaused && sim.state.isGameStarted) {
        this.app.requestPointerLock();
      }
    });
    bar.querySelector('#btn-playtest-debugger')?.addEventListener('click', () => {
      this.app.exitPointerLock();
      this.gameplayDebugger.toggle();
    });
    bar.querySelector('#btn-playtest-perf')?.addEventListener('click', () => {
      this.app.exitPointerLock();
      this.perfMonitor.toggle();
    });
    bar.querySelector('#btn-playtest-return')?.addEventListener('click', () => {
      this.returnToEditorFromPlaytest();
    });
    bar.querySelector('#btn-playtest-dashboard')?.addEventListener('click', () => {
      this.setDevPaused(true);
      this.gameplayDebugger.close();
      this.playtestBarEl?.classList.add('hidden');
      this.openDashboard();
    });
  }

  private setDevPaused(paused: boolean): void {
    const sim = this.app.getSimulation();
    sim.state.isPaused = paused;
    if (paused) {
      this.app.exitPointerLock();
    }
    this.syncPlaytestPauseUI();
    this.gameplayDebugger.syncPauseButton();
  }

  private syncPlaytestPauseUI(): void {
    const paused = this.app.getSimulation().state.isPaused;
    const btn = this.playtestBarEl?.querySelector('#btn-playtest-pause') as HTMLElement | null;
    if (btn) {
      btn.textContent = paused ? '▶ Play' : '⏸ Pause';
      btn.classList.toggle('primary-gold', paused);
    }
    const snapBadge = this.playtestBarEl?.querySelector('#dev-pt-snapshot-badge') as HTMLElement | null;
    if (snapBadge) {
      snapBadge.textContent = paused
        ? '⏸ PAUSED — Mouse Free'
        : '▶ PLAYING (Esc to free mouse)';
    }
  }

  private updateReturnButtonVisibility(): void {
    const retBtn = this.playtestBarEl?.querySelector('#btn-playtest-return') as HTMLElement | null;
    if (retBtn) {
      retBtn.classList.toggle('hidden', !this.isInPlaytest);
    }
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
    this.app.isDevModeSession = true;

    this.stageEditor.close();
    this.closeDashboard();
    this.uiManager.hideAllGameModalsForDev();

    // Apply in-memory config so startRun spawns at edited playerSpawnPos with edited layout
    sim.state.applyStageConfig(this.playtestSnapshot, this.playtestProfileKey);
    this.app.startRun(true);
    this.setDevPaused(true);
    this.updateReturnButtonVisibility();
    this.playtestBarEl?.classList.remove('hidden');

    if (issues.length > 0) {
      this.uiManager.showPickupNotification(`Playtest ready (Paused) with ${issues.length} warning(s). Click Play when ready.`);
    }
  }

  public returnToEditorFromPlaytest(): void {
    if (!this.isInPlaytest) return;
    this.isInPlaytest = false;
    this.app.isDevModeSession = false;
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
    this.app.isDevModeSession = true;
    this.setDevPaused(true);
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

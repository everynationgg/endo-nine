import type { ThreeApp } from '../render/ThreeApp';
import type { UIManager } from '../ui/UIManager';
import { StageEditor } from './StageEditor';
import { validateStageProfile } from './StageConfig';

export class DevToolkit {
  private app: ThreeApp;
  private uiManager: UIManager;
  public stageEditor: StageEditor;
  private dashboardEl: HTMLElement | null = null;
  private validationEl: HTMLElement | null = null;

  constructor(app: ThreeApp, uiManager: UIManager) {
    this.app = app;
    this.uiManager = uiManager;
    this.stageEditor = new StageEditor(app);

    this.stageEditor.onReturnToDashboard = () => {
      this.openDashboard();
    };

    this.mountDashboardDOM();

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
            <div class="dev-dash-tile-meta" id="dev-dash-dbg-meta">Phase 5 Module</div>
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
      this.uiManager.showPickupNotification('Gameplay Debugger will be enabled in Phase 5.');
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

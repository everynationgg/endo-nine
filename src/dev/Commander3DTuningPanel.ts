import type { ThreeApp } from '../render/ThreeApp';
import type { UIManager } from '../ui/UIManager';
import {
  DEFAULT_EXPERIMENTAL_TUNING,
  type ExperimentalAnimState,
  type TuningSpeedKey
} from '../render/ExperimentalCommander3D';

/**
 * Localhost-only compact animation tuning & inspection panel for Experimental 3D Commander.
 * Hidden by default; toggled via [F10], the Dev Playtest Bar, or the localhost pill.
 * All settings affect only the experimental 3D visual presentation layer.
 */
export class Commander3DTuningPanel {
  private readonly app: ThreeApp;
  private readonly uiManager: UIManager;
  private panelEl: HTMLElement | null = null;
  private pillEl: HTMLElement | null = null;
  private isOpen: boolean = false;
  private lastSyncMs: number = 0;

  constructor(app: ThreeApp, uiManager: UIManager) {
    this.app = app;
    this.uiManager = uiManager;

    if (!import.meta.env.DEV) return;

    this.mountDOM();
    this.app.onExperimental3DStateChanged = () => {
      this.syncUI(true);
    };
    this.syncUI(true);
  }

  public getIsOpen(): boolean {
    return this.isOpen;
  }

  public open(): void {
    if (!import.meta.env.DEV) return;
    this.isOpen = true;
    this.app.exitPointerLock();
    this.panelEl?.classList.remove('hidden');
    this.syncUI(true);
  }

  public close(): void {
    this.isOpen = false;
    this.panelEl?.classList.add('hidden');
  }

  public toggle(): void {
    if (!import.meta.env.DEV) return;
    if (this.isOpen) this.close();
    else this.open();
  }

  public onFrameTick(now: number): void {
    if (!import.meta.env.DEV || !this.isOpen) return;
    if (now - this.lastSyncMs < 110) return;
    this.lastSyncMs = now;
    this.syncReadout();
  }

  private mountDOM(): void {
    document.getElementById('dev-commander-3d-panel')?.remove();
    document.getElementById('dev-commander-3d-pill')?.remove();

    const pill = document.createElement('button');
    pill.id = 'dev-commander-3d-pill';
    pill.className = 'dev-c3d-pill interactive hidden';
    pill.textContent = '🎭 3D Tuning [F10]';
    pill.title = 'Open Localhost 3D Commander Animation Tuning Panel [F10]';
    pill.addEventListener('click', () => this.toggle());
    document.body.appendChild(pill);
    this.pillEl = pill;

    const panel = document.createElement('div');
    panel.id = 'dev-commander-3d-panel';
    panel.className = 'dev-c3d-panel interactive hidden';
    panel.innerHTML = `
      <div class="dev-c3d-header">
        <span>🎭 3D COMMANDER TUNING (LOCALHOST)</span>
        <button id="c3d-close" class="sci-btn dev-ed-btn" style="padding:2px 8px;">✕</button>
      </div>
      <div class="dev-c3d-body">
        <div class="dev-c3d-section">
          <div class="dev-c3d-title">Character Rendering</div>
          <div class="dev-c3d-mode-row">
            <button id="c3d-mode-2d" class="dev-c3d-mode-btn">Original 2D Commander</button>
            <button id="c3d-mode-3d" class="dev-c3d-mode-btn">Experimental 3D Commander</button>
          </div>
          <div id="c3d-load-status" class="dev-c3d-status">Mode: Original 2D (GLB lazy-loaded on demand)</div>
        </div>

        <div class="dev-c3d-section">
          <div class="dev-c3d-title">Live Animation Inspection</div>
          <div id="c3d-readout" class="dev-dbg-readout">Waiting for 3D mode...</div>
          <div class="dev-c3d-btn-row">
            <button id="c3d-pause-preview" class="sci-btn dev-ed-btn">⏸ Pause Preview</button>
            <button id="c3d-clear-preview" class="sci-btn dev-ed-btn">▶ Resume Live</button>
            <button id="c3d-reset-defaults" class="sci-btn dev-ed-btn">↺ Reset Tuning</button>
          </div>
        </div>

        <div class="dev-c3d-section">
          <div class="dev-c3d-title">Replay / Preview State</div>
          <div class="dev-c3d-preview-grid">
            <button class="sci-btn dev-ed-btn c3d-preview-btn" data-state="idle">Idle</button>
            <button class="sci-btn dev-ed-btn c3d-preview-btn" data-state="run">Run</button>
            <button class="sci-btn dev-ed-btn c3d-preview-btn" data-state="jump_takeoff">Takeoff</button>
            <button class="sci-btn dev-ed-btn c3d-preview-btn" data-state="jump_ascend">Ascend</button>
            <button class="sci-btn dev-ed-btn c3d-preview-btn" data-state="jump_descend">Descend</button>
            <button class="sci-btn dev-ed-btn c3d-preview-btn" data-state="glide">Glide</button>
            <button class="sci-btn dev-ed-btn c3d-preview-btn" data-state="dash">Dash</button>
            <button class="sci-btn dev-ed-btn c3d-preview-btn" data-state="lmb">LMB</button>
            <button class="sci-btn dev-ed-btn c3d-preview-btn" data-state="rmb">RMB</button>
            <button class="sci-btn dev-ed-btn c3d-preview-btn" data-state="ultimate">Ult</button>
          </div>
        </div>

        <div class="dev-c3d-section">
          <div class="dev-c3d-title">Clip Variants &amp; Weapon Props</div>
          <div class="dev-c3d-select-row">
            <label>LMB Clip:</label>
            <select id="c3d-lmb-variant" class="dev-c3d-select">
              <option value="clip2_standing">Clip [2] shoot a gun while standing</option>
              <option value="clip4_extended">Clip [4] shoot a gun while standing.001</option>
            </select>
          </div>
          <div class="dev-c3d-select-row">
            <label>Ult Clip:</label>
            <select id="c3d-ult-variant" class="dev-c3d-select">
              <option value="clip1_right_arm">Clip [1] Raise Right Arm Up</option>
              <option value="clip5_left_arm">Clip [5] Wrist + Raise Left Arm</option>
            </select>
          </div>
          <div class="dev-c3d-check-row">
            <label><input type="checkbox" id="c3d-show-gun" checked /> Show Sidearm on LMB</label>
            <label><input type="checkbox" id="c3d-show-sword" checked /> Show Sword on RMB</label>
          </div>
        </div>

        <div class="dev-c3d-section">
          <div class="dev-c3d-title">Spatial &amp; Transition Tuning (Visual Only)</div>
          <div id="c3d-spatial-sliders" class="dev-c3d-sliders"></div>
        </div>

        <div class="dev-c3d-section">
          <div class="dev-c3d-title">Per-Animation Speed Multipliers</div>
          <div id="c3d-speed-sliders" class="dev-c3d-sliders"></div>
        </div>
      </div>
    `;
    document.body.appendChild(panel);
    this.panelEl = panel;

    this.buildSliders();
    this.wireEvents();
  }

  private getActiveController() {
    return this.app.getActiveHeroId() === 'doctor'
      ? this.app.experimentalDoctor3D
      : this.app.experimentalCommander3D;
  }

  private buildSliders(): void {
    const spatialContainer = this.panelEl?.querySelector('#c3d-spatial-sliders');
    const speedContainer = this.panelEl?.querySelector('#c3d-speed-sliders');
    if (!spatialContainer || !speedContainer) return;

    const spatialDefs: Array<{
      id: string;
      label: string;
      min: number;
      max: number;
      step: number;
      unit: string;
      get: () => number;
      set: (v: number) => void;
    }> = [
      {
        id: 'scale',
        label: 'Model Scale',
        min: 0.5,
        max: 1.8,
        step: 0.02,
        unit: 'x',
        get: () => this.getActiveController().tuning.scaleMultiplier,
        set: (v) => {
          this.getActiveController().tuning.scaleMultiplier = v;
          this.getActiveController().applyTransformTuning();
        }
      },
      {
        id: 'yaw',
        label: 'Yaw Offset',
        min: -180,
        max: 180,
        step: 1,
        unit: '°',
        get: () => this.getActiveController().tuning.yawOffsetDeg,
        set: (v) => {
          this.getActiveController().tuning.yawOffsetDeg = v;
        }
      },
      {
        id: 'yoff',
        label: 'Ground Y Offset',
        min: -25,
        max: 25,
        step: 0.5,
        unit: 'u',
        get: () => this.getActiveController().tuning.verticalOffset,
        set: (v) => {
          this.getActiveController().tuning.verticalOffset = v;
          this.getActiveController().applyTransformTuning();
        }
      },
      {
        id: 'xfade',
        label: 'Crossfade',
        min: 0.04,
        max: 0.45,
        step: 0.01,
        unit: 's',
        get: () => this.getActiveController().tuning.crossfadeDuration,
        set: (v) => {
          this.getActiveController().tuning.crossfadeDuration = v;
        }
      },
      {
        id: 'cadence',
        label: 'Run Cadence',
        min: 0.5,
        max: 2.0,
        step: 0.05,
        unit: 'x',
        get: () => this.getActiveController().tuning.runCadence,
        set: (v) => {
          this.getActiveController().tuning.runCadence = v;
        }
      },
      {
        id: 'glidePitch',
        label: 'Glide Torso Angle',
        min: -15,
        max: 45,
        step: 1,
        unit: '°',
        get: () => this.getActiveController().tuning.glideTorsoPitchDeg,
        set: (v) => {
          this.getActiveController().tuning.glideTorsoPitchDeg = v;
        }
      },
      {
        id: 'dashFx',
        label: 'Dash VFX Intensity',
        min: 0.0,
        max: 2.0,
        step: 0.1,
        unit: 'x',
        get: () => this.getActiveController().tuning.dashVisualIntensity,
        set: (v) => {
          this.getActiveController().tuning.dashVisualIntensity = v;
        }
      }
    ];

    spatialContainer.innerHTML = spatialDefs
      .map(
        (d) => `
      <div class="dev-c3d-slider-row">
        <span class="dev-c3d-slabel">${d.label}</span>
        <input id="c3d-slider-${d.id}" type="range" min="${d.min}" max="${d.max}" step="${d.step}" value="${d.get()}" />
        <span id="c3d-val-${d.id}" class="dev-c3d-sval">${d.get()}${d.unit}</span>
      </div>
    `
      )
      .join('');

    for (const d of spatialDefs) {
      const inp = spatialContainer.querySelector(`#c3d-slider-${d.id}`) as HTMLInputElement | null;
      const valEl = spatialContainer.querySelector(`#c3d-val-${d.id}`) as HTMLElement | null;
      inp?.addEventListener('input', () => {
        const v = parseFloat(inp.value);
        d.set(v);
        if (valEl) valEl.textContent = `${Number.isInteger(d.step) ? v.toFixed(0) : v.toFixed(2)}${d.unit}`;
      });
    }

    const speedKeys: Array<{ key: TuningSpeedKey; label: string }> = [
      { key: 'run', label: 'Run Speed' },
      { key: 'jump', label: 'Jump Speed' },
      { key: 'glide', label: 'Glide Speed' },
      { key: 'dash', label: 'Dash Speed' },
      { key: 'lmb', label: 'LMB Speed' },
      { key: 'rmb', label: 'RMB Speed' },
      { key: 'ultimate', label: 'Ult Speed' },
      { key: 'idle', label: 'Idle Speed' }
    ];

    speedContainer.innerHTML = speedKeys
      .map(
        (sk) => `
      <div class="dev-c3d-slider-row">
        <span class="dev-c3d-slabel">${sk.label}</span>
        <input id="c3d-spd-${sk.key}" type="range" min="0.30" max="2.50" step="0.05" value="${this.app.experimentalCommander3D.tuning.speedMultipliers[sk.key]}" />
        <span id="c3d-spdval-${sk.key}" class="dev-c3d-sval">${this.app.experimentalCommander3D.tuning.speedMultipliers[sk.key].toFixed(2)}x</span>
      </div>
    `
      )
      .join('');

    for (const sk of speedKeys) {
      const inp = speedContainer.querySelector(`#c3d-spd-${sk.key}`) as HTMLInputElement | null;
      const valEl = speedContainer.querySelector(`#c3d-spdval-${sk.key}`) as HTMLElement | null;
      inp?.addEventListener('input', () => {
        const v = parseFloat(inp.value);
        this.app.experimentalCommander3D.tuning.speedMultipliers[sk.key] = v;
        if (valEl) valEl.textContent = `${v.toFixed(2)}x`;
      });
    }
  }

  private wireEvents(): void {
    const p = this.panelEl;
    if (!p) return;

    p.querySelector('#c3d-close')?.addEventListener('click', () => this.close());

    p.querySelector('#c3d-mode-2d')?.addEventListener('click', () => {
      this.uiManager.settings.use3DCommander = false;
      this.uiManager.syncSettingsUI();
      this.uiManager.saveSettings();
      this.syncUI(true);
    });

    p.querySelector('#c3d-mode-3d')?.addEventListener('click', () => {
      if (!import.meta.env.DEV) return;
      this.uiManager.settings.use3DCommander = true;
      this.uiManager.syncSettingsUI();
      this.uiManager.saveSettings();
      this.syncUI(true);
    });

    p.querySelector('#c3d-pause-preview')?.addEventListener('click', () => {
      const exp = this.getActiveController();
      const next = !exp.getInspectorSnapshot().isPausedPreview;
      exp.setPreviewPaused(next);
      this.syncUI(false);
    });

    p.querySelector('#c3d-clear-preview')?.addEventListener('click', () => {
      this.getActiveController().clearPreview();
      this.syncUI(false);
    });

    p.querySelector('#c3d-reset-defaults')?.addEventListener('click', () => {
      const exp = this.getActiveController();
      exp.tuning = {
        ...DEFAULT_EXPERIMENTAL_TUNING,
        speedMultipliers: { ...DEFAULT_EXPERIMENTAL_TUNING.speedMultipliers }
      };
      exp.applyTransformTuning();
      this.buildSliders();
      this.syncUI(true);
    });

    p.querySelectorAll('.c3d-preview-btn').forEach((btn) => {
      btn.addEventListener('click', () => {
        const st = (btn as HTMLElement).dataset.state as ExperimentalAnimState | undefined;
        if (!st) return;
        if (!this.app.use3DCommander) {
          this.uiManager.settings.use3DCommander = true;
          this.uiManager.syncSettingsUI();
          this.uiManager.saveSettings();
        }
        this.getActiveController().triggerPreviewState(st);
        this.syncReadout();
      });
    });

    const lmbSel = p.querySelector('#c3d-lmb-variant') as HTMLSelectElement | null;
    lmbSel?.addEventListener('change', () => {
      this.app.experimentalCommander3D.tuning.lmbClipVariant = lmbSel.value as any;
    });

    const ultSel = p.querySelector('#c3d-ult-variant') as HTMLSelectElement | null;
    ultSel?.addEventListener('change', () => {
      this.app.experimentalCommander3D.tuning.ultClipVariant = ultSel.value as any;
    });

    const gunChk = p.querySelector('#c3d-show-gun') as HTMLInputElement | null;
    gunChk?.addEventListener('change', () => {
      this.app.experimentalCommander3D.tuning.showGunProp = gunChk.checked;
    });

    const swordChk = p.querySelector('#c3d-show-sword') as HTMLInputElement | null;
    swordChk?.addEventListener('change', () => {
      this.app.experimentalCommander3D.tuning.showSwordProp = swordChk.checked;
    });
  }

  public syncUI(refreshInputs: boolean): void {
    if (!import.meta.env.DEV || !this.panelEl) return;
    const is3D = this.app.use3DCommander;
    this.pillEl?.classList.toggle('hidden', !is3D);

    const btn2D = this.panelEl.querySelector('#c3d-mode-2d');
    const btn3D = this.panelEl.querySelector('#c3d-mode-3d');
    btn2D?.classList.toggle('active', !is3D);
    btn3D?.classList.toggle('active', is3D);

    const statusEl = this.panelEl.querySelector('#c3d-load-status') as HTMLElement | null;
    const snap = this.getActiveController().getInspectorSnapshot();
    if (statusEl) {
      if (snap.loadError) {
        statusEl.textContent = `Load Error (2D Fallback Active): ${snap.loadError}`;
        statusEl.style.color = '#fca5a5';
      } else if (snap.loading) {
        statusEl.textContent = 'Loading Experimental 3D GLB...';
        statusEl.style.color = '#facc15';
      } else if (snap.loaded) {
        statusEl.textContent = `GLB Ready: ${snap.clipCount} clips | ${snap.boneCount} bones | ${snap.triangleCount.toLocaleString()} tris`;
        statusEl.style.color = '#6ee7b7';
      } else {
        statusEl.textContent = 'Mode: Original 2D (GLB lazy-loaded on 3D select)';
        statusEl.style.color = '#94a3b8';
      }
    }

    if (refreshInputs) {
      const t = this.getActiveController().tuning;
      const lmbSel = this.panelEl.querySelector('#c3d-lmb-variant') as HTMLSelectElement | null;
      const ultSel = this.panelEl.querySelector('#c3d-ult-variant') as HTMLSelectElement | null;
      const gunChk = this.panelEl.querySelector('#c3d-show-gun') as HTMLInputElement | null;
      const swordChk = this.panelEl.querySelector('#c3d-show-sword') as HTMLInputElement | null;
      if (lmbSel) lmbSel.value = t.lmbClipVariant;
      if (ultSel) ultSel.value = t.ultClipVariant;
      if (gunChk) gunChk.checked = t.showGunProp;
      if (swordChk) swordChk.checked = t.showSwordProp;
    }

    const pauseBtn = this.panelEl.querySelector('#c3d-pause-preview');
    if (pauseBtn) {
      pauseBtn.textContent = snap.isPausedPreview ? '▶ Unpause Preview' : '⏸ Pause Preview';
    }

    this.syncReadout();
  }

  private syncReadout(): void {
    const readout = this.panelEl?.querySelector('#c3d-readout');
    if (!readout) return;
    const snap = this.getActiveController().getInspectorSnapshot();
    if (!snap.loaded) {
      readout.innerHTML = snap.loading
        ? 'Loading 3D Hero GLB...'
        : '3D model not yet loaded. Select <b>Experimental 3D</b> above.';
      return;
    }
    const modeLabel =
      this.app.isExperimental3DActive() || this.app.isExperimentalDoctor3DActive()
        ? '3D ACTIVE'
        : '2D FALLBACK / INACTIVE';
    readout.innerHTML = [
      `<b>Render:</b> ${modeLabel} | <b>State:</b> ${snap.currentState}${snap.previewState ? ' (PREVIEW)' : ''}`,
      `<b>Upper Overlay:</b> ${snap.upperOverlayState} | <b>Loop:</b> ${snap.isLooping ? 'LOOP' : 'ONE-SHOT'}`,
      `<b>Clip:</b> ${snap.activeClipName}`,
      `<b>Orig Dur:</b> ${snap.originalDuration.toFixed(3)}s | <b>Eff Dur:</b> ${snap.effectiveDuration.toFixed(3)}s | <b>Speed:</b> ${snap.playbackSpeed.toFixed(2)}x`
    ].join('<br/>');
  }
}

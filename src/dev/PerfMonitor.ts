import * as THREE from 'three';
import type { ThreeApp } from '../render/ThreeApp';

export interface PerfSample {
  timestamp: string;
  scenario: string;
  fps: number;
  avgFps: number;
  frameMs: number;
  maxSpikeMs: number;
  spikeCount: number;
  enemies: number;
  projectiles: number;
  particles: number;
  envObjects: number;
  drawCalls: number;
  triangles: number;
  geometries: number;
  textures: number;
  heapUsedMb: number | null;
}

export interface StressScenarioDef {
  id: string;
  label: string;
  description: string;
}

export const STRESS_SCENARIOS: StressScenarioDef[] = [
  { id: 'baseline_idle', label: '1. Baseline Stage 1 Idle', description: 'Stage 1 crash site with 0 enemies at spawn.' },
  { id: 'swarm_25', label: '2. Swarm 25 Enemies', description: '25 mixed Crawlers, Spitters, and Wasps near player.' },
  { id: 'swarm_60', label: '3. Tier-Cap 60 Enemies', description: '60 active mixed enemies pushing normal tier limit.' },
  { id: 'swarm_100', label: '4. Extreme 100 Enemies', description: '100 enemies active simultaneously for AI/collision stress.' },
  { id: 'projectile_storm', label: '5. Projectile & VFX Storm', description: '30 Spitters firing + high player attack-speed Overdrive.' },
  { id: 'boss_encounter', label: '6. Stage 1 Titan Boss', description: 'Stage 1 Titan Colossus + 16 escorts active near teleporter.' },
  { id: 'events_active', label: '7. Full Stage Events', description: 'All world events + charged teleporter + 35 enemies.' },
  { id: 'combat_augments', label: '8. Augmented Combat FX', description: 'Stacked Overdrive + Chain Spark + Orbiting Blade vs 40 foes.' }
];

export class PerfMonitor {
  private app: ThreeApp;
  private rootEl: HTMLElement | null = null;
  private sparkCanvas: HTMLCanvasElement | null = null;
  private sparkCtx: CanvasRenderingContext2D | null = null;
  private isOpen: boolean = false;

  private frameTimesMs: number[] = [];
  private maxHistory: number = 90;
  private spikeCount: number = 0;
  private lastUiUpdate: number = 0;
  private lastFrameTs: number = 0;
  private activeScenarioName: string = 'live_session';
  private recordedResults: PerfSample[] = [];
  private scenarioTimerId: number | null = null;

  constructor(app: ThreeApp) {
    this.app = app;
  }

  public getIsOpen(): boolean {
    return this.isOpen;
  }

  public open(): void {
    this.isOpen = true;
    this.mountDOM();
    this.rootEl?.classList.remove('hidden');
  }

  public close(): void {
    this.isOpen = false;
    this.rootEl?.classList.add('hidden');
  }

  public toggle(): void {
    if (this.isOpen) this.close();
    else this.open();
  }

  public onFrame(dt: number, now: number, info: THREE.WebGLInfo): void {
    const rawMs = this.lastFrameTs > 0 ? now - this.lastFrameTs : dt * 1000;
    this.lastFrameTs = now;
    const frameMs = Math.max(0.1, Math.min(250, rawMs));

    this.frameTimesMs.push(frameMs);
    if (this.frameTimesMs.length > this.maxHistory) {
      this.frameTimesMs.shift();
    }
    if (frameMs > 20.0) {
      this.spikeCount++;
    }

    if (!this.isOpen) return;
    if (now - this.lastUiUpdate < 160) return;
    this.lastUiUpdate = now;

    const sample = this.captureSample(info);
    this.renderMetrics(sample);
    this.renderSparkline();
  }

  public captureSample(info?: THREE.WebGLInfo): PerfSample {
    const rendererInfo = info || this.app.getRenderer().info;
    const sim = this.app.getSimulation();
    const state = sim.state;
    const vfx = this.app.getVFXCounts();

    const latestMs = this.frameTimesMs.length > 0 ? this.frameTimesMs[this.frameTimesMs.length - 1] : 16.67;
    const avgMs =
      this.frameTimesMs.length > 0
        ? this.frameTimesMs.reduce((a, b) => a + b, 0) / this.frameTimesMs.length
        : 16.67;
    const maxSpikeMs = this.frameTimesMs.length > 0 ? Math.max(...this.frameTimesMs) : latestMs;

    const perfMem = (performance as any)?.memory;
    const heapUsedMb = perfMem && typeof perfMem.usedJSHeapSize === 'number'
      ? Math.round((perfMem.usedJSHeapSize / (1024 * 1024)) * 10) / 10
      : null;

    return {
      timestamp: new Date().toISOString(),
      scenario: this.activeScenarioName,
      fps: Math.round((1000 / Math.max(0.1, latestMs)) * 10) / 10,
      avgFps: Math.round((1000 / Math.max(0.1, avgMs)) * 10) / 10,
      frameMs: Math.round(latestMs * 100) / 100,
      maxSpikeMs: Math.round(maxSpikeMs * 100) / 100,
      spikeCount: this.spikeCount,
      enemies: state.enemies.length,
      projectiles: vfx.projectiles,
      particles: vfx.particles,
      envObjects: vfx.envObjects,
      drawCalls: rendererInfo.render.calls,
      triangles: rendererInfo.render.triangles,
      geometries: rendererInfo.memory.geometries,
      textures: rendererInfo.memory.textures,
      heapUsedMb
    };
  }

  public runScenario(scenarioId: string): void {
    const sim = this.app.getSimulation();
    const state = sim.state;
    if (!state.isGameStarted) {
      document.getElementById('screen-dev-dashboard')?.classList.add('hidden');
      document.getElementById('screen-main-menu')?.classList.add('hidden');
      this.app.startRun();
      this.app.exitPointerLock();
    }

    if (this.scenarioTimerId !== null) {
      window.clearTimeout(this.scenarioTimerId);
      this.scenarioTimerId = null;
    }

    sim.devClearEnemies();
    state.projectiles = [];
    sim.devPlayerInvulnerable = true;
    this.spikeCount = 0;
    this.frameTimesMs = [];
    this.activeScenarioName = scenarioId;

    if (scenarioId === 'baseline_idle') {
      // Zero enemies baseline
    } else if (scenarioId === 'swarm_25') {
      sim.devSpawnEnemy('crawler', 12, true);
      sim.devSpawnEnemy('spitter', 7, true);
      sim.devSpawnEnemy('wasp', 6, true);
    } else if (scenarioId === 'swarm_60') {
      sim.devSpawnEnemy('crawler', 30, true);
      sim.devSpawnEnemy('spitter', 15, true);
      sim.devSpawnEnemy('wasp', 12, true);
      sim.devSpawnEnemy('elite', 3, true);
    } else if (scenarioId === 'swarm_100') {
      sim.devSpawnEnemy('crawler', 50, true);
      sim.devSpawnEnemy('spitter', 25, true);
      sim.devSpawnEnemy('wasp', 20, true);
      sim.devSpawnEnemy('elite', 5, true);
    } else if (scenarioId === 'projectile_storm') {
      sim.devGrantItem('overdrive', 5);
      sim.devSpawnEnemy('spitter', 30, true);
    } else if (scenarioId === 'boss_encounter') {
      sim.spawnStage1Titan(state.artifact.pos);
      sim.devSpawnEnemy('crawler', 10, true);
      sim.devSpawnEnemy('wasp', 6, true);
    } else if (scenarioId === 'events_active') {
      state.artifact.isCharged = true;
      state.worldEvents.forEach((ev) => (ev.isActive = true));
      sim.spawnStage1Titan(state.artifact.pos);
      sim.devSpawnEnemy('crawler', 20, true);
      sim.devSpawnEnemy('spitter', 15, true);
    } else if (scenarioId === 'combat_augments') {
      sim.devGrantItem('overdrive', 5);
      sim.devGrantItem('chain_spark', 4);
      sim.applyBuffToPlayer('orbiting_blade' as any);
      sim.devSpawnEnemy('crawler', 25, true);
      sim.devSpawnEnemy('spitter', 10, true);
      sim.devSpawnEnemy('wasp', 5, true);
    }

    const statusEl = this.rootEl?.querySelector('#perf-scenario-status');
    if (statusEl) {
      statusEl.textContent = `Running benchmark "${scenarioId}" (3.5s sample window)...`;
    }

    this.scenarioTimerId = window.setTimeout(() => {
      this.scenarioTimerId = null;
      const snapshot = this.captureSample();
      this.recordedResults.push(snapshot);
      if (statusEl) {
        statusEl.textContent = `Recorded "${scenarioId}": ${snapshot.avgFps} avg FPS, ${snapshot.frameMs}ms frame, ${snapshot.drawCalls} calls`;
      }
      this.renderBenchmarkLog();
    }, 3500);
  }

  private exportData(format: 'json' | 'csv'): void {
    const data = this.recordedResults.length > 0 ? this.recordedResults : [this.captureSample()];
    let content = '';
    let mime = 'application/json';
    const ext = format;

    if (format === 'json') {
      content = JSON.stringify({ exportedAt: new Date().toISOString(), samples: data }, null, 2);
    } else {
      mime = 'text/csv';
      const headers = Object.keys(data[0]) as Array<keyof PerfSample>;
      const rows = data.map((row) => headers.map((h) => JSON.stringify(row[h] ?? '')).join(','));
      content = [headers.join(','), ...rows].join('\n');
    }

    const blob = new Blob([content], { type: mime });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `endo-nine-perf-${Date.now()}.${ext}`;
    a.click();
    URL.revokeObjectURL(url);
  }

  private mountDOM(): void {
    if (this.rootEl) return;
    const panel = document.createElement('div');
    panel.id = 'dev-perf-monitor';
    panel.className = 'dev-perf-panel interactive hidden';
    panel.innerHTML = `
      <div class="dev-dbg-header">
        <span>📊 PERFORMANCE MONITOR [F7]</span>
        <div style="display:flex; gap:6px; align-items:center;">
          <button id="perf-reset-spikes" class="sci-btn dev-ed-btn">Reset Spikes</button>
          <button id="perf-close" class="dev-dlg-close">✕</button>
        </div>
      </div>
      <div class="dev-perf-body">
        <canvas id="perf-spark-canvas" width="324" height="58" class="dev-perf-spark"></canvas>
        <div id="perf-metrics-grid" class="dev-perf-grid"></div>
        <div class="dev-ed-panel-header">STRESS-TEST SCENARIOS (8)</div>
        <div id="perf-scenario-status" class="dev-perf-status">Select a benchmark scenario below:</div>
        <div class="dev-perf-scenarios">
          ${STRESS_SCENARIOS.map(
            (s) => `<button class="sci-btn dev-ed-btn perf-run-btn" data-id="${s.id}" title="${s.description}">${s.label}</button>`
          ).join('')}
        </div>
        <div class="dev-ed-panel-header">BENCHMARK LOG &amp; EXPORT</div>
        <div id="perf-log-list" class="dev-perf-log"></div>
        <div style="display:flex; gap:6px;">
          <button id="perf-snap-now" class="sci-btn dev-ed-btn" style="flex:1;">+ Snapshot</button>
          <button id="perf-export-json" class="sci-btn primary-gold dev-ed-btn">Export JSON</button>
          <button id="perf-export-csv" class="sci-btn dev-ed-btn">Export CSV</button>
        </div>
      </div>
    `;
    document.body.appendChild(panel);
    this.rootEl = panel;
    this.sparkCanvas = panel.querySelector('#perf-spark-canvas');
    this.sparkCtx = this.sparkCanvas?.getContext('2d') || null;

    panel.querySelector('#perf-close')?.addEventListener('click', () => this.close());
    panel.querySelector('#perf-reset-spikes')?.addEventListener('click', () => {
      this.spikeCount = 0;
      this.frameTimesMs = [];
    });
    panel.querySelectorAll<HTMLButtonElement>('.perf-run-btn').forEach((btn) => {
      btn.addEventListener('click', () => this.runScenario(btn.dataset.id!));
    });
    panel.querySelector('#perf-snap-now')?.addEventListener('click', () => {
      this.recordedResults.push(this.captureSample());
      this.renderBenchmarkLog();
    });
    panel.querySelector('#perf-export-json')?.addEventListener('click', () => this.exportData('json'));
    panel.querySelector('#perf-export-csv')?.addEventListener('click', () => this.exportData('csv'));
  }

  private renderMetrics(s: PerfSample): void {
    const grid = this.rootEl?.querySelector('#perf-metrics-grid');
    if (!grid) return;
    const budgetPct = Math.round((s.frameMs / 16.67) * 100);
    const frameColor = s.frameMs <= 16.67 ? '#6ee7b7' : s.frameMs <= 22 ? '#fde047' : '#fca5a5';

    grid.innerHTML = `
      <div class="dev-perf-stat"><span>FPS (Avg)</span><strong>${s.fps} (${s.avgFps})</strong></div>
      <div class="dev-perf-stat"><span>Frame / 16.67ms</span><strong style="color:${frameColor}">${s.frameMs.toFixed(2)}ms (${budgetPct}%)</strong></div>
      <div class="dev-perf-stat"><span>Spikes (&gt;20ms)</span><strong>${s.spikeCount} (Max ${s.maxSpikeMs.toFixed(1)}ms)</strong></div>
      <div class="dev-perf-stat"><span>Draw Calls / Tris</span><strong>${s.drawCalls} / ${s.triangles.toLocaleString()}</strong></div>
      <div class="dev-perf-stat"><span>Enemies / Proj</span><strong>${s.enemies} / ${s.projectiles}</strong></div>
      <div class="dev-perf-stat"><span>VFX / Env Obj</span><strong>${s.particles} / ${s.envObjects}</strong></div>
      <div class="dev-perf-stat"><span>GPU Geo / Tex</span><strong>${s.geometries} / ${s.textures}</strong></div>
      <div class="dev-perf-stat"><span>JS Heap</span><strong>${s.heapUsedMb !== null ? `${s.heapUsedMb} MB` : 'N/A'}</strong></div>
    `;
  }

  private renderSparkline(): void {
    const ctx = this.sparkCtx;
    const c = this.sparkCanvas;
    if (!ctx || !c) return;
    ctx.fillStyle = '#070b14';
    ctx.fillRect(0, 0, c.width, c.height);

    // 16.67ms 60 FPS reference line
    const refY = c.height - (16.67 / 40) * c.height;
    ctx.strokeStyle = 'rgba(16, 185, 129, 0.45)';
    ctx.beginPath();
    ctx.moveTo(0, refY);
    ctx.lineTo(c.width, refY);
    ctx.stroke();

    if (this.frameTimesMs.length < 2) return;
    ctx.strokeStyle = '#38bdf8';
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    const step = c.width / Math.max(1, this.maxHistory - 1);
    this.frameTimesMs.forEach((ms, i) => {
      const x = i * step;
      const clamped = Math.min(40, ms);
      const y = c.height - (clamped / 40) * c.height;
      if (i === 0) ctx.moveTo(x, y);
      else ctx.lineTo(x, y);
    });
    ctx.stroke();
  }

  private renderBenchmarkLog(): void {
    const el = this.rootEl?.querySelector('#perf-log-list');
    if (!el) return;
    if (this.recordedResults.length === 0) {
      el.innerHTML = `<div class="dev-ed-empty" style="padding:4px;">No recorded snapshots yet.</div>`;
      return;
    }
    el.innerHTML = this.recordedResults
      .slice(-6)
      .reverse()
      .map(
        (r) => `<div class="dev-perf-log-row">[${r.scenario}] ${r.avgFps} FPS • ${r.frameMs}ms • ${r.drawCalls} calls • ${r.enemies} enemies</div>`
      )
      .join('');
  }
}

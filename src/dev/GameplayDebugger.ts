import * as THREE from 'three';
import type { ThreeApp } from '../render/ThreeApp';
import type { BuffId, EnemyType, HeroId, ItemId } from '../sim/types';
import { BUFF_REGISTRY, ALL_BUFF_IDS, ITEM_REGISTRY } from '../sim/ItemDefs';
import { HERO_REGISTRY } from '../sim/HeroDefs';

export type DebuggerTab = 'player' | 'enemies' | 'boss' | 'stage';

export class GameplayDebugger {
  private app: ThreeApp;
  private rootEl: HTMLElement | null = null;
  private overlayCanvas: HTMLCanvasElement | null = null;
  private overlayCtx: CanvasRenderingContext2D | null = null;

  private isOpen: boolean = false;
  private activeTab: DebuggerTab = 'player';
  private isPausedByDebugger: boolean = false;

  // Visual Debug Overlays
  private showEnemyHealthState: boolean = false;
  private showCollisionBounds: boolean = false;
  private showNavPaths: boolean = false;
  private showLineOfSight: boolean = false;
  private showSpawnRegions: boolean = false;

  private debugSceneGroup: THREE.Group = new THREE.Group();
  private lastUiSyncTime: number = 0;

  constructor(app: ThreeApp) {
    this.app = app;
    this.debugSceneGroup.name = 'DevGameplayDebugger_Overlay3D';
  }

  public getIsOpen(): boolean {
    return this.isOpen;
  }

  public open(initialTab?: DebuggerTab): void {
    if (initialTab) this.activeTab = initialTab;
    this.isOpen = true;
    this.ensureOverlayCanvas();
    this.mountPanelDOM();
    if (!this.debugSceneGroup.parent) {
      this.app.getScene().add(this.debugSceneGroup);
    }
    this.rootEl?.classList.remove('hidden');
    this.refreshDynamicContent();
  }

  public close(): void {
    this.isOpen = false;
    this.rootEl?.classList.add('hidden');
  }

  public toggle(): void {
    if (this.isOpen) this.close();
    else this.open();
  }

  public onFrameTick(now: number): void {
    const anyVisuals =
      this.showEnemyHealthState ||
      this.showCollisionBounds ||
      this.showNavPaths ||
      this.showLineOfSight ||
      this.showSpawnRegions;

    if (anyVisuals) {
      this.ensureOverlayCanvas();
      if (!this.debugSceneGroup.parent) {
        this.app.getScene().add(this.debugSceneGroup);
      }
      this.renderVisualDebugOverlays();
    } else {
      if (this.overlayCtx && this.overlayCanvas) {
        this.overlayCtx.clearRect(0, 0, this.overlayCanvas.width, this.overlayCanvas.height);
      }
      this.clearDebugGroup();
    }

    if (this.isOpen && now - this.lastUiSyncTime > 200) {
      this.lastUiSyncTime = now;
      this.updateLiveReadouts();
    }
  }

  private ensureOverlayCanvas(): void {
    if (this.overlayCanvas) return;
    const canvas = document.createElement('canvas');
    canvas.id = 'dev-dbg-overlay-canvas';
    canvas.className = 'dev-dbg-overlay-canvas';
    const resize = () => {
      canvas.width = window.innerWidth;
      canvas.height = window.innerHeight;
    };
    resize();
    window.addEventListener('resize', resize);
    document.body.appendChild(canvas);
    this.overlayCanvas = canvas;
    this.overlayCtx = canvas.getContext('2d');
  }

  private clearDebugGroup(): void {
    while (this.debugSceneGroup.children.length > 0) {
      const child = this.debugSceneGroup.children[0];
      this.debugSceneGroup.remove(child);
      child.traverse((o: any) => {
        if (o.geometry) o.geometry.dispose?.();
        if (o.material) {
          if (Array.isArray(o.material)) o.material.forEach((m: any) => m.dispose?.());
          else o.material.dispose?.();
        }
      });
    }
  }

  private renderVisualDebugOverlays(): void {
    const ctx = this.overlayCtx;
    const canvas = this.overlayCanvas;
    if (!ctx || !canvas) return;
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    this.clearDebugGroup();

    const state = this.app.getSimulation().state;
    const cam = this.app.getCamera();
    const p = state.player;

    const project = (wx: number, wy: number, wz: number): { x: number; y: number; visible: boolean } => {
      const v = new THREE.Vector3(wx, wy, wz);
      v.project(cam);
      return {
        x: (v.x * 0.5 + 0.5) * canvas.width,
        y: (-v.y * 0.5 + 0.5) * canvas.height,
        visible: v.z > -1 && v.z < 1
      };
    };

    // 1. Spawn Regions Overlay (3D green outlines)
    if (this.showSpawnRegions && state.enemySpawnRegions?.length) {
      for (const reg of state.enemySpawnRegions) {
        const elev = state.terrain.getElevation(reg.x, reg.y).height;
        const geo = new THREE.BoxGeometry(reg.width, 20, reg.height);
        const edges = new THREE.EdgesGeometry(geo);
        const line = new THREE.LineSegments(
          edges,
          new THREE.LineBasicMaterial({ color: reg.enabled ? 0x22c55e : 0x64748b })
        );
        line.position.set(reg.x, elev + 10, reg.y);
        this.debugSceneGroup.add(line);
        geo.dispose();
      }
    }

    // 2. Collision Boundaries (Player + Obstacles + Enemies)
    if (this.showCollisionBounds) {
      const playerCyl = new THREE.Mesh(
        new THREE.CylinderGeometry(18, 18, 36, 14, 1, true),
        new THREE.MeshBasicMaterial({ color: 0x38bdf8, wireframe: true })
      );
      playerCyl.position.set(p.pos.x, p.z + 18, p.pos.y);
      this.debugSceneGroup.add(playerCyl);

      const obsMat = new THREE.MeshBasicMaterial({ color: 0xf97316, wireframe: true, transparent: true, opacity: 0.45 });
      for (let i = 0; i < state.obstacles.length; i++) {
        const obs = state.obstacles[i];
        if (Math.hypot(obs.pos.x - p.pos.x, obs.pos.y - p.pos.y) > 1200) continue;
        const elev = state.terrain.getElevation(obs.pos.x, obs.pos.y).height;
        const r = Math.max(4, obs.radius * (obs.scaleVar || 1));
        const m = new THREE.Mesh(new THREE.CylinderGeometry(r, r, 34, 10, 1, true), obsMat);
        m.position.set(obs.pos.x, elev + 17, obs.pos.y);
        this.debugSceneGroup.add(m);
      }
    }

    const matDirect = new THREE.LineBasicMaterial({ color: 0x22c55e });
    const matPath = new THREE.LineBasicMaterial({ color: 0x38bdf8 });
    const matBlocked = new THREE.LineBasicMaterial({ color: 0xef4444 });

    for (let i = 0; i < state.enemies.length; i++) {
      const e = state.enemies[i];
      if (e.health <= 0 && !e.isStage1Titan) continue;

      // Enemy Collider Wireframe
      if (this.showCollisionBounds && e.radius > 0) {
        const cyl = new THREE.Mesh(
          new THREE.CylinderGeometry(e.radius, e.radius, e.isStage1Titan ? 140 : 34, 12, 1, true),
          new THREE.MeshBasicMaterial({ color: e.isStage1Titan ? 0xf43f5e : 0xfacc15, wireframe: true })
        );
        cyl.position.set(e.pos.x, e.z + (e.isStage1Titan ? 70 : 17), e.pos.y);
        this.debugSceneGroup.add(cyl);
      }

      // Navigation Waypoint / Path Overlay
      if (this.showNavPaths && e.navWaypoint) {
        const pts: THREE.Vector3[] = [
          new THREE.Vector3(e.pos.x, e.z + 8, e.pos.y),
          new THREE.Vector3(e.navWaypoint.x, state.terrain.getElevation(e.navWaypoint.x, e.navWaypoint.y).height + 8, e.navWaypoint.y)
        ];
        if (e.navGoalPos) {
          pts.push(new THREE.Vector3(e.navGoalPos.x, e.navGoalPos.z + 8, e.navGoalPos.y));
        }
        const geo = new THREE.BufferGeometry().setFromPoints(pts);
        const mat = e.navStatus === 'direct' ? matDirect : e.isTargetReachable === false ? matBlocked : matPath;
        this.debugSceneGroup.add(new THREE.Line(geo, mat));
      }

      // Line of Sight Check
      if (this.showLineOfSight) {
        const clear = state.terrain.isSegmentClearForNav(e.pos, p.pos);
        const geo = new THREE.BufferGeometry().setFromPoints([
          new THREE.Vector3(e.pos.x, e.z + 18, e.pos.y),
          new THREE.Vector3(p.pos.x, p.z + 18, p.pos.y)
        ]);
        this.debugSceneGroup.add(new THREE.Line(geo, clear ? matDirect : matBlocked));
      }

      // Screen-Space Health + State Label
      if (this.showEnemyHealthState) {
        const scr = project(e.pos.x, e.z + (e.isStage1Titan ? 160 : 42), e.pos.y);
        if (scr.visible && scr.x >= 0 && scr.x <= canvas.width && scr.y >= 0 && scr.y <= canvas.height) {
          const stateStr = e.isStage1Titan
            ? `TITAN:${e.titanState}`
            : `${e.type.toUpperCase()} [${e.navStatus || (e.isAlerted ? 'alert' : 'idle')}]`;
          const hpStr = `${Math.max(0, Math.round(e.health))}/${Math.round(e.maxHealth)}`;
          ctx.font = 'bold 10px monospace';
          ctx.fillStyle = 'rgba(8, 13, 24, 0.8)';
          ctx.fillRect(scr.x - 46, scr.y - 16, 92, 22);
          ctx.fillStyle = e.isStage1Titan ? '#fda4af' : '#facc15';
          ctx.fillText(stateStr, scr.x - 42, scr.y - 6);
          ctx.fillStyle = '#e2e8f0';
          ctx.fillText(hpStr, scr.x - 42, scr.y + 4);
        }
      }
    }
  }

  private mountPanelDOM(): void {
    if (this.rootEl) return;
    const panel = document.createElement('div');
    panel.id = 'dev-gameplay-debugger';
    panel.className = 'dev-dbg-panel interactive hidden';
    panel.innerHTML = `
      <div class="dev-dbg-header">
        <span>🧪 GAMEPLAY DEBUGGER [F8]</span>
        <div style="display:flex; gap:6px; align-items:center;">
          <button id="dbg-pause-sim" class="sci-btn dev-ed-btn">⏸ Freeze Time</button>
          <button id="dbg-close" class="dev-dlg-close">✕</button>
        </div>
      </div>
      <div class="dev-dbg-tabs">
        <button class="dev-dbg-tab active" data-tab="player">Player</button>
        <button class="dev-dbg-tab" data-tab="enemies">Enemies</button>
        <button class="dev-dbg-tab" data-tab="boss">Stage 1 Boss</button>
        <button class="dev-dbg-tab" data-tab="stage">Stage &amp; Overlays</button>
      </div>
      <div id="dbg-body" class="dev-dbg-body"></div>
    `;
    document.body.appendChild(panel);
    this.rootEl = panel;

    panel.querySelector('#dbg-close')?.addEventListener('click', () => this.close());
    panel.querySelector('#dbg-pause-sim')?.addEventListener('click', (ev) => {
      const sim = this.app.getSimulation();
      this.isPausedByDebugger = !this.isPausedByDebugger;
      sim.state.isPaused = this.isPausedByDebugger;
      (ev.currentTarget as HTMLElement).textContent = this.isPausedByDebugger ? '▶ Resume Time' : '⏸ Freeze Time';
    });

    panel.querySelectorAll<HTMLButtonElement>('.dev-dbg-tab').forEach((btn) => {
      btn.addEventListener('click', () => {
        this.activeTab = btn.dataset.tab as DebuggerTab;
        panel.querySelectorAll('.dev-dbg-tab').forEach((b) => b.classList.toggle('active', b === btn));
        this.refreshDynamicContent();
      });
    });
  }

  private refreshDynamicContent(): void {
    const body = this.rootEl?.querySelector('#dbg-body');
    if (!body) return;
    const sim = this.app.getSimulation();
    const state = sim.state;
    const p = state.player;

    if (this.activeTab === 'player') {
      const heroOpts = Object.keys(HERO_REGISTRY)
        .map((id) => `<option value="${id}" ${p.heroId === id ? 'selected' : ''}>${HERO_REGISTRY[id as HeroId].name}</option>`)
        .join('');
      const itemButtons = (Object.keys(ITEM_REGISTRY) as ItemId[])
        .map((id) => `<button class="sci-btn dev-ed-btn dbg-grant-item" data-item="${id}">+1 ${ITEM_REGISTRY[id].name} (${p.items[id] || 0})</button>`)
        .join('');
      const buffOptions = ALL_BUFF_IDS.map((id) => {
        const def = BUFF_REGISTRY[id];
        const tag = def.enhancesSkillSlot ? `[AUG:${def.enhancesSkillSlot}]` : def.replacesSkillSlot ? `[SWAP:${def.replacesSkillSlot}]` : '[BUFF]';
        return `<option value="${id}">${tag} ${def.name}</option>`;
      }).join('');

      body.innerHTML = `
        <div class="dev-dbg-section">
          <div class="dev-dbg-readout" id="dbg-player-readout"></div>
          <div class="dev-ed-prop-row">
            <label>Playable Hero</label>
            <select id="dbg-hero-select" class="dev-ed-input" style="max-width:160px;">${heroOpts}</select>
          </div>
          <div class="dev-dbg-btn-grid">
            <button id="dbg-heal" class="sci-btn dev-ed-btn">💚 Full Heal</button>
            <button id="dbg-invuln" class="sci-btn dev-ed-btn ${sim.devPlayerInvulnerable ? 'active-tool' : ''}">🛡 Invuln: ${sim.devPlayerInvulnerable ? 'ON' : 'OFF'}</button>
            <button id="dbg-cd" class="sci-btn dev-ed-btn">⚡ Reset Cooldowns</button>
            <button id="dbg-reset-player" class="sci-btn danger-btn dev-ed-btn">↺ Reset State</button>
          </div>
        </div>
        <div class="dev-dbg-section">
          <div class="dev-ed-panel-header">BIOMASS / ITEMS</div>
          <div class="dev-dbg-btn-grid">
            <button class="sci-btn dev-ed-btn dbg-add-gold" data-amt="100">+100 Biomass</button>
            <button class="sci-btn dev-ed-btn dbg-add-gold" data-amt="500">+500 Biomass</button>
            ${itemButtons}
          </div>
        </div>
        <div class="dev-dbg-section">
          <div class="dev-ed-panel-header">BUFFS &amp; SKILL AUGMENTS</div>
          <div style="display:flex; gap:6px;">
            <select id="dbg-buff-select" class="dev-ed-input" style="flex:1;">${buffOptions}</select>
            <button id="dbg-apply-buff" class="sci-btn primary-gold dev-ed-btn">Apply</button>
          </div>
        </div>
      `;

      body.querySelector('#dbg-hero-select')?.addEventListener('change', (ev) => {
        const heroId = (ev.currentTarget as HTMLSelectElement).value as HeroId;
        this.app.selectHero(heroId);
        this.refreshDynamicContent();
      });
      body.querySelector('#dbg-heal')?.addEventListener('click', () => {
        sim.devHealPlayer();
        this.updateLiveReadouts();
      });
      body.querySelector('#dbg-invuln')?.addEventListener('click', () => {
        sim.devPlayerInvulnerable = !sim.devPlayerInvulnerable;
        this.refreshDynamicContent();
      });
      body.querySelector('#dbg-cd')?.addEventListener('click', () => sim.devResetCooldowns());
      body.querySelector('#dbg-reset-player')?.addEventListener('click', () => {
        sim.devResetPlayerState();
        this.refreshDynamicContent();
      });
      body.querySelectorAll<HTMLButtonElement>('.dbg-add-gold').forEach((btn) => {
        btn.addEventListener('click', () => {
          p.currency += Number(btn.dataset.amt || 100);
          this.updateLiveReadouts();
        });
      });
      body.querySelectorAll<HTMLButtonElement>('.dbg-grant-item').forEach((btn) => {
        btn.addEventListener('click', () => {
          sim.devGrantItem(btn.dataset.item as ItemId, 1);
          this.refreshDynamicContent();
        });
      });
      body.querySelector('#dbg-apply-buff')?.addEventListener('click', () => {
        const buffId = (body.querySelector('#dbg-buff-select') as HTMLSelectElement).value as BuffId;
        sim.applyBuffToPlayer(buffId);
        this.updateLiveReadouts();
      });
    } else if (this.activeTab === 'enemies') {
      body.innerHTML = `
        <div class="dev-dbg-section">
          <div class="dev-dbg-readout" id="dbg-enemy-readout"></div>
          <div class="dev-ed-prop-row">
            <label>Enemy Type</label>
            <select id="dbg-enemy-type" class="dev-ed-input" style="max-width:160px;">
              <option value="crawler">Skittering Crawler</option>
              <option value="spitter">Toxic Spitter</option>
              <option value="wasp">Void Wasp</option>
              <option value="elite">Void Goliath (Elite)</option>
            </select>
          </div>
          <div class="dev-dbg-btn-grid">
            <button id="dbg-spawn-1" class="sci-btn primary-gold dev-ed-btn">Spawn 1</button>
            <button id="dbg-spawn-5" class="sci-btn dev-ed-btn">Spawn Group (5)</button>
            <button id="dbg-toggle-ai" class="sci-btn dev-ed-btn ${sim.devEnemyAiPaused ? 'active-tool' : ''}">Enemy AI: ${sim.devEnemyAiPaused ? 'PAUSED' : 'ACTIVE'}</button>
            <button id="dbg-clear-enemies" class="sci-btn danger-btn dev-ed-btn">Clear All Enemies</button>
          </div>
        </div>
        <div class="dev-dbg-section">
          <div class="dev-ed-panel-header">AI &amp; COLLISION VISUALIZERS</div>
          <label class="dev-ed-chk-line"><input id="dbg-vis-hp" type="checkbox" ${this.showEnemyHealthState ? 'checked' : ''} /> Show Enemy Health &amp; State</label>
          <label class="dev-ed-chk-line"><input id="dbg-vis-col" type="checkbox" ${this.showCollisionBounds ? 'checked' : ''} /> Show Collision Boundaries</label>
          <label class="dev-ed-chk-line"><input id="dbg-vis-nav" type="checkbox" ${this.showNavPaths ? 'checked' : ''} /> Show Navigation Waypoints / Paths</label>
          <label class="dev-ed-chk-line"><input id="dbg-vis-los" type="checkbox" ${this.showLineOfSight ? 'checked' : ''} /> Show Line-of-Sight Checks</label>
        </div>
      `;

      body.querySelector('#dbg-spawn-1')?.addEventListener('click', () => {
        const t = (body.querySelector('#dbg-enemy-type') as HTMLSelectElement).value as EnemyType;
        sim.devSpawnEnemy(t, 1, true);
        this.updateLiveReadouts();
      });
      body.querySelector('#dbg-spawn-5')?.addEventListener('click', () => {
        const t = (body.querySelector('#dbg-enemy-type') as HTMLSelectElement).value as EnemyType;
        sim.devSpawnEnemy(t, 5, true);
        this.updateLiveReadouts();
      });
      body.querySelector('#dbg-toggle-ai')?.addEventListener('click', () => {
        sim.devEnemyAiPaused = !sim.devEnemyAiPaused;
        this.refreshDynamicContent();
      });
      body.querySelector('#dbg-clear-enemies')?.addEventListener('click', () => {
        sim.devClearEnemies();
        this.updateLiveReadouts();
      });

      const bindChk = (sel: string, setter: (v: boolean) => void) => {
        body.querySelector(sel)?.addEventListener('change', (ev) => setter((ev.currentTarget as HTMLInputElement).checked));
      };
      bindChk('#dbg-vis-hp', (v) => (this.showEnemyHealthState = v));
      bindChk('#dbg-vis-col', (v) => (this.showCollisionBounds = v));
      bindChk('#dbg-vis-nav', (v) => (this.showNavPaths = v));
      bindChk('#dbg-vis-los', (v) => (this.showLineOfSight = v));
    } else if (this.activeTab === 'boss') {
      body.innerHTML = `
        <div class="dev-dbg-section">
          <div class="dev-dbg-readout" id="dbg-boss-readout"></div>
          <div class="dev-dbg-btn-grid">
            <button id="dbg-boss-spawn" class="sci-btn primary-gold dev-ed-btn">Spawn Stage 1 Titan</button>
            <button id="dbg-boss-reset" class="sci-btn dev-ed-btn">Reset Boss Encounter</button>
            <button id="dbg-boss-ai" class="sci-btn dev-ed-btn ${sim.devBossAiPaused ? 'active-tool' : ''}">Boss AI: ${sim.devBossAiPaused ? 'PAUSED' : 'ACTIVE'}</button>
            <button id="dbg-boss-col" class="sci-btn dev-ed-btn ${this.showCollisionBounds ? 'active-tool' : ''}">Inspect Collision</button>
          </div>
        </div>
        <div class="dev-dbg-section">
          <div class="dev-ed-panel-header">TRIGGER BOSS ATTACKS INDIVIDUALLY</div>
          <div class="dev-dbg-btn-grid">
            <button id="dbg-atk-laser" class="sci-btn dev-ed-btn">⚡ Mouth Laser Sweep</button>
            <button id="dbg-atk-tentacle" class="sci-btn dev-ed-btn">🦑 Tentacle Strike</button>
            <button id="dbg-atk-elem" class="sci-btn dev-ed-btn">☄ Elemental Barrage</button>
          </div>
        </div>
        <div class="dev-dbg-section">
          <div class="dev-ed-panel-header">ADJUST BOSS HEALTH</div>
          <div class="dev-dbg-btn-grid">
            <button id="dbg-boss-hp100" class="sci-btn dev-ed-btn">100% HP</button>
            <button id="dbg-boss-hp50" class="sci-btn dev-ed-btn">50% HP</button>
            <button id="dbg-boss-hp10" class="sci-btn dev-ed-btn">10% HP</button>
            <button id="dbg-boss-kill" class="sci-btn danger-btn dev-ed-btn">Set 1 HP</button>
          </div>
        </div>
      `;

      body.querySelector('#dbg-boss-spawn')?.addEventListener('click', () => {
        if (!state.enemies.some((e) => e.isStage1Titan)) {
          sim.spawnStage1Titan(state.artifact.pos);
        }
        this.updateLiveReadouts();
      });
      body.querySelector('#dbg-boss-reset')?.addEventListener('click', () => {
        sim.devResetBossEncounter();
        this.updateLiveReadouts();
      });
      body.querySelector('#dbg-boss-ai')?.addEventListener('click', () => {
        sim.devBossAiPaused = !sim.devBossAiPaused;
        this.refreshDynamicContent();
      });
      body.querySelector('#dbg-boss-col')?.addEventListener('click', () => {
        this.showCollisionBounds = !this.showCollisionBounds;
        this.refreshDynamicContent();
      });
      body.querySelector('#dbg-atk-laser')?.addEventListener('click', () => sim.devTriggerBossAttack('laser'));
      body.querySelector('#dbg-atk-tentacle')?.addEventListener('click', () => sim.devTriggerBossAttack('tentacle'));
      body.querySelector('#dbg-atk-elem')?.addEventListener('click', () => sim.devTriggerBossAttack('elemental'));

      const setBossPct = (pct: number | 'one') => {
        const b = state.enemies.find((e) => e.isStage1Titan);
        if (!b) return;
        b.health = pct === 'one' ? 1 : Math.max(1, Math.round(b.maxHealth * pct));
        this.updateLiveReadouts();
      };
      body.querySelector('#dbg-boss-hp100')?.addEventListener('click', () => setBossPct(1));
      body.querySelector('#dbg-boss-hp50')?.addEventListener('click', () => setBossPct(0.5));
      body.querySelector('#dbg-boss-hp10')?.addEventListener('click', () => setBossPct(0.1));
      body.querySelector('#dbg-boss-kill')?.addEventListener('click', () => setBossPct('one'));
    } else if (this.activeTab === 'stage') {
      const eventRows = state.worldEvents
        .map(
          (ev) => `<div style="display:flex; gap:4px; align-items:center; margin-bottom:4px;">
            <span style="flex:1; font-size:11px; overflow:hidden; text-overflow:ellipsis; white-space:nowrap;">${ev.isCompleted ? '✓' : '○'} ${ev.name}</span>
            <button class="sci-btn dev-ed-btn dbg-tp-pt" data-x="${ev.pos.x}" data-y="${ev.pos.y}">TP</button>
            <button class="sci-btn dev-ed-btn dbg-complete-ev" data-id="${ev.id}">Complete</button>
          </div>`
        )
        .join('');

      body.innerHTML = `
        <div class="dev-dbg-section">
          <div class="dev-ed-panel-header">TELEPORT TO MARKERS</div>
          <div class="dev-dbg-btn-grid">
            <button id="dbg-tp-spawn" class="sci-btn dev-ed-btn">Player Spawn</button>
            <button id="dbg-tp-tele" class="sci-btn dev-ed-btn">Teleporter</button>
            <button id="dbg-tp-boss" class="sci-btn dev-ed-btn">Boss Spawn</button>
            <button id="dbg-tp-pod" class="sci-btn dev-ed-btn">Nearest Pod</button>
          </div>
        </div>
        <div class="dev-dbg-section">
          <div class="dev-ed-panel-header">TELEPORTER &amp; CHESTS</div>
          <div class="dev-dbg-btn-grid">
            <button id="dbg-tele-25" class="sci-btn dev-ed-btn">Charge +25%</button>
            <button id="dbg-tele-100" class="sci-btn primary-gold dev-ed-btn">Charge 100%</button>
            <button id="dbg-tele-reset" class="sci-btn dev-ed-btn">Reset Teleporter</button>
            <button id="dbg-reset-pods" class="sci-btn dev-ed-btn">Reopen All Pods</button>
          </div>
        </div>
        <div class="dev-dbg-section">
          <div class="dev-ed-panel-header">WORLD EVENTS (${state.worldEvents.length})</div>
          <div style="max-height:110px; overflow-y:auto;">${eventRows || '<div class="dev-ed-empty">No world events.</div>'}</div>
        </div>
        <div class="dev-dbg-section">
          <div class="dev-ed-panel-header">VISUALIZATION OVERLAYS</div>
          <label class="dev-ed-chk-line"><input id="dbg-vis-regions" type="checkbox" ${this.showSpawnRegions ? 'checked' : ''} /> Show Enemy Spawn Regions</label>
          <label class="dev-ed-chk-line"><input id="dbg-vis-cols2" type="checkbox" ${this.showCollisionBounds ? 'checked' : ''} /> Show Collision Boundaries</label>
        </div>
      `;

      const tpTo = (x: number, y: number) => {
        const elev = state.terrain.getElevation(x, y).height;
        p.pos.x = x;
        p.pos.y = y;
        p.groundZ = elev;
        p.z = elev + 4;
      };

      body.querySelector('#dbg-tp-spawn')?.addEventListener('click', () => tpTo(state.playerSpawnPos.x, state.playerSpawnPos.y));
      body.querySelector('#dbg-tp-tele')?.addEventListener('click', () => tpTo(state.artifact.pos.x, state.artifact.pos.y + 85));
      body.querySelector('#dbg-tp-boss')?.addEventListener('click', () => tpTo(state.bossSpawnPos.x, state.bossSpawnPos.y + 160));
      body.querySelector('#dbg-tp-pod')?.addEventListener('click', () => {
        const unopened = state.pods.find((pod) => !pod.isOpened) || state.pods[0];
        if (unopened) tpTo(unopened.pos.x, unopened.pos.y + 42);
      });
      body.querySelector('#dbg-tele-25')?.addEventListener('click', () => {
        state.artifact.chargeProgress = Math.min(100, state.artifact.chargeProgress + 25);
        if (state.artifact.chargeProgress >= 100) state.artifact.isCharged = true;
      });
      body.querySelector('#dbg-tele-100')?.addEventListener('click', () => {
        state.artifact.chargeProgress = 100;
        state.artifact.isCharged = true;
      });
      body.querySelector('#dbg-tele-reset')?.addEventListener('click', () => {
        state.artifact.chargeProgress = 0;
        state.artifact.isCharged = false;
        state.artifact.isTeleporterReady = false;
        state.artifact.isSummoning = false;
        state.artifact.isBossSpawned = false;
        state.artifact.isBossDefeated = false;
        state.artifact.isCompleted = false;
      });
      body.querySelector('#dbg-reset-pods')?.addEventListener('click', () => {
        state.pods.forEach((pod) => (pod.isOpened = false));
        this.app.rebuildStageVisualsFromState();
      });

      body.querySelectorAll<HTMLButtonElement>('.dbg-tp-pt').forEach((btn) => {
        btn.addEventListener('click', () => tpTo(Number(btn.dataset.x), Number(btn.dataset.y) + 65));
      });
      body.querySelectorAll<HTMLButtonElement>('.dbg-complete-ev').forEach((btn) => {
        btn.addEventListener('click', () => {
          const ev = state.worldEvents.find((e) => e.id === btn.dataset.id);
          if (ev) {
            ev.chargeProgress = 100;
            ev.isCompleted = true;
            ev.isActive = false;
            this.refreshDynamicContent();
          }
        });
      });

      body.querySelector('#dbg-vis-regions')?.addEventListener('change', (ev) => {
        this.showSpawnRegions = (ev.currentTarget as HTMLInputElement).checked;
      });
      body.querySelector('#dbg-vis-cols2')?.addEventListener('change', (ev) => {
        this.showCollisionBounds = (ev.currentTarget as HTMLInputElement).checked;
      });
    }

    this.updateLiveReadouts();
  }

  private updateLiveReadouts(): void {
    const state = this.app.getSimulation().state;
    const p = state.player;
    const pOut = this.rootEl?.querySelector('#dbg-player-readout');
    if (pOut) {
      pOut.textContent = `HP: ${Math.round(p.health)}/${Math.round(p.calculatedStats.maxHealth)} • Shield: ${Math.round(p.energyShield)} • Biomass: ${p.currency} • Lvl: ${p.level} • Pos: (${Math.round(p.pos.x)}, ${Math.round(p.pos.y)}, z=${Math.round(p.z)})`;
    }
    const eOut = this.rootEl?.querySelector('#dbg-enemy-readout');
    if (eOut) {
      eOut.textContent = `Active Enemies: ${state.enemies.length} • Diff Tier: ${Math.floor(state.gameTime / 60)} • Projectiles: ${state.projectiles.length}`;
    }
    const bOut = this.rootEl?.querySelector('#dbg-boss-readout');
    if (bOut) {
      const boss = state.enemies.find((e) => e.isStage1Titan);
      if (!boss) {
        bOut.textContent = 'Stage 1 Titan: Not Spawned (Click Spawn Stage 1 Titan or trigger via Teleporter).';
      } else {
        const d = Math.round(Math.hypot(boss.pos.x - p.pos.x, boss.pos.y - p.pos.y));
        bOut.textContent = `TITAN [${boss.titanState}] • HP: ${Math.round(boss.health)}/${Math.round(boss.maxHealth)} • Timer: ${(boss.titanTimer ?? 0).toFixed(2)}s • Dist: ${d}u`;
      }
    }
  }
}

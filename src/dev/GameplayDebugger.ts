import * as THREE from 'three';
import type { ThreeApp } from '../render/ThreeApp';
import type { MeshTerrainCollider } from '../sim/MeshTerrainCollider';
import type { BuffId, EnemyType, HeroId, ItemId, TerrainSurfaceCategory } from '../sim/types';
import { BUFF_REGISTRY, ALL_BUFF_IDS, ITEM_REGISTRY, isBuffEligibleForPlayer, getEffectiveBuffWeight } from '../sim/ItemDefs';
import { STAGE1_ENHANCEMENT_CATEGORIES } from '../sim/StageProgressionPolicy';
import { getDifficultyTier } from '../sim/DifficultyDefs';
import { HERO_REGISTRY } from '../sim/HeroDefs';

export type DebuggerTab = 'player' | 'enemies' | 'boss' | 'stage';

export class GameplayDebugger {
  private app: ThreeApp;
  private rootEl: HTMLElement | null = null;
  private overlayCanvas: HTMLCanvasElement | null = null;
  private overlayCtx: CanvasRenderingContext2D | null = null;

  private isOpen: boolean = false;
  private activeTab: DebuggerTab = 'player';
  public onPauseChanged: ((paused: boolean) => void) | null = null;

  // Visual Debug Overlays
  private showEnemyHealthState: boolean = false;
  private showCollisionBounds: boolean = false;
  private showNavPaths: boolean = false;
  private showLineOfSight: boolean = false;
  private showSpawnRegions: boolean = false;
  private showTerrainCollisionDebug: boolean = false;

  private debugSceneGroup: THREE.Group = new THREE.Group();
  private terrainDebugGroup: THREE.Group = new THREE.Group();
  private cachedTerrainCollider: MeshTerrainCollider | null = null;
  private cachedTerrainOverrideSig: string = '';
  private lastUiSyncTime: number = 0;

  constructor(app: ThreeApp) {
    this.app = app;
    this.debugSceneGroup.name = 'DevGameplayDebugger_Overlay3D';
    this.terrainDebugGroup.name = 'DevGameplayDebugger_Terrain3D';
  }

  public getIsOpen(): boolean {
    return this.isOpen;
  }

  public open(initialTab?: DebuggerTab): void {
    if (initialTab) this.activeTab = initialTab;
    this.isOpen = true;
    this.ensureOverlayCanvas();
    this.mountPanelDOM();
    this.syncPauseButton();
    if (!this.debugSceneGroup.parent) {
      this.app.getScene().add(this.debugSceneGroup);
    }
    if (!this.terrainDebugGroup.parent) {
      this.app.getScene().add(this.terrainDebugGroup);
    }
    this.terrainDebugGroup.visible = this.showTerrainCollisionDebug;
    this.rootEl?.classList.remove('hidden');
    this.refreshDynamicContent();
  }

  public syncPauseButton(): void {
    const btn = this.rootEl?.querySelector('#dbg-pause-sim') as HTMLElement | null;
    if (!btn) return;
    const paused = this.app.getSimulation().state.isPaused;
    btn.textContent = paused ? '▶ Play' : '⏸ Pause';
  }

  public close(): void {
    this.isOpen = false;
    this.terrainDebugGroup.visible = false;
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
      this.showTerrainCollisionDebug ||
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

  private syncTerrainDebugCache(): void {
    const meshCol = this.app.getSimulation().state.terrain.meshCollider;
    this.terrainDebugGroup.visible = this.isOpen && this.showTerrainCollisionDebug && !!meshCol;
    if (!this.isOpen || !this.showTerrainCollisionDebug || !meshCol) return;

    const sig = JSON.stringify(meshCol.overrides || {});
    if (this.cachedTerrainCollider === meshCol && this.cachedTerrainOverrideSig === sig && this.terrainDebugGroup.children.length > 0) {
      return;
    }

    while (this.terrainDebugGroup.children.length > 0) {
      const ch = this.terrainDebugGroup.children[0];
      this.terrainDebugGroup.remove(ch);
      ch.traverse((o: any) => {
        if (o.geometry) o.geometry.dispose?.();
        if (o.material) o.material.dispose?.();
      });
    }

    const catHex = (cat: TerrainSurfaceCategory): number => {
      switch (cat) {
        case 'ground':
          return 0x22c55e;
        case 'water':
          return 0x06b6d4;
        case 'waterfall_rock':
        case 'bridge':
        case 'tower_ledge':
        case 'ship_walkable':
          return 0xf59e0b;
        case 'tree_nonsolid':
          return 0x94a3b8;
        case 'solid_obstacle':
        case 'cliff':
        case 'border':
        default:
          return 0xef4444;
      }
    };

    const tris = meshCol.allTriangles;
    const pos: number[] = [];
    const col: number[] = [];
    const nPos: number[] = [];
    const tmpC = new THREE.Color();

    for (let i = 0; i < tris.length; i++) {
      const t = tris[i];
      tmpC.setHex(catHex(t.category));
      pos.push(
        t.ax, t.ay + 1.5, t.az, t.bx, t.by + 1.5, t.bz,
        t.bx, t.by + 1.5, t.bz, t.cx, t.cy + 1.5, t.cz,
        t.cx, t.cy + 1.5, t.cz, t.ax, t.ay + 1.5, t.az
      );
      for (let k = 0; k < 6; k++) col.push(tmpC.r, tmpC.g, tmpC.b);

      if (i % 8 === 0 && t.category !== 'border') {
        const mx = (t.ax + t.bx + t.cx) / 3;
        const my = (t.ay + t.by + t.cy) / 3 + 1.5;
        const mz = (t.az + t.bz + t.cz) / 3;
        nPos.push(mx, my, mz, mx + t.nx * 14, my + t.ny * 14, mz + t.nz * 14);
      }
    }

    const triGeo = new THREE.BufferGeometry();
    triGeo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    triGeo.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
    this.terrainDebugGroup.add(
      new THREE.LineSegments(triGeo, new THREE.LineBasicMaterial({ vertexColors: true, transparent: true, opacity: 0.55 }))
    );

    if (nPos.length > 0) {
      const normGeo = new THREE.BufferGeometry();
      normGeo.setAttribute('position', new THREE.Float32BufferAttribute(nPos, 3));
      this.terrainDebugGroup.add(
        new THREE.LineSegments(normGeo, new THREE.LineBasicMaterial({ color: 0xe2e8f0, transparent: true, opacity: 0.5 }))
      );
    }

    const navSegs = meshCol.getNavDebugSegments();
    if (navSegs.length > 0) {
      const navPos: number[] = [];
      for (const s of navSegs) {
        navPos.push(s.ax, s.ay + 6, s.az, s.bx, s.by + 6, s.bz);
      }
      const navGeo = new THREE.BufferGeometry();
      navGeo.setAttribute('position', new THREE.Float32BufferAttribute(navPos, 3));
      this.terrainDebugGroup.add(
        new THREE.LineSegments(navGeo, new THREE.LineBasicMaterial({ color: 0xfacc15, transparent: true, opacity: 0.8 }))
      );
    }

    this.cachedTerrainCollider = meshCol;
    this.cachedTerrainOverrideSig = sig;
  }

  private renderVisualDebugOverlays(): void {
    const ctx = this.overlayCtx;
    const canvas = this.overlayCanvas;
    if (!ctx || !canvas) return;
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    this.clearDebugGroup();
    this.syncTerrainDebugCache();

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

    // 1. Spawn Regions Overlay (3D circle & rect outlines; green include, red exclude)
    if (this.showSpawnRegions && state.enemySpawnRegions?.length) {
      for (const reg of state.enemySpawnRegions) {
        const elev = state.terrain.getElevation(reg.x, reg.y).height;
        const isExclude = (reg.mode || 'include') === 'exclude';
        const col = !reg.enabled ? 0x64748b : isExclude ? 0xef4444 : 0x22c55e;
        const geo = reg.shape === 'circle'
          ? new THREE.CylinderGeometry(
            Math.max(20, reg.radius || Math.max(reg.width, reg.height) * 0.5),
            Math.max(20, reg.radius || Math.max(reg.width, reg.height) * 0.5),
            20,
            28
          )
          : new THREE.BoxGeometry(reg.width, 20, reg.height);
        const edges = new THREE.EdgesGeometry(geo);
        const line = new THREE.LineSegments(
          edges,
          new THREE.LineBasicMaterial({ color: col })
        );
        line.position.set(reg.x, elev + 10, reg.y);
        this.debugSceneGroup.add(line);
        geo.dispose();
      }
    }

    // 2. Collision Boundaries (Player Combat + Terrain Collision Footprint + Rejected Moves + Obstacles + Enemies)
    if (this.showCollisionBounds || this.showTerrainCollisionDebug) {
      const playerCyl = new THREE.Mesh(
        new THREE.CylinderGeometry(18, 18, 36, 14, 1, true),
        new THREE.MeshBasicMaterial({ color: 0x38bdf8, wireframe: true })
      );
      playerCyl.position.set(p.pos.x, p.z + 18, p.pos.y);
      this.debugSceneGroup.add(playerCyl);

      // Actual terrain / wall collision footprint (radius ~30u, body height 88u)
      const terrainColCyl = new THREE.Mesh(
        new THREE.CylinderGeometry(30, 30, 88, 18, 1, true),
        new THREE.MeshBasicMaterial({ color: 0xe879f9, wireframe: true, transparent: true, opacity: 0.72 })
      );
      terrainColCyl.position.set(p.pos.x, p.z + 44, p.pos.y);
      this.debugSceneGroup.add(terrainColCyl);

      const rejected = state.terrain.meshCollider?.recentRejectedMoves;
      if (rejected && rejected.length > 0) {
        const rejMat = new THREE.LineBasicMaterial({ color: 0xf43f5e });
        for (let i = Math.max(0, rejected.length - 12); i < rejected.length; i++) {
          const rm = rejected[i];
          if (Math.hypot(rm.toX - p.pos.x, rm.toY - p.pos.y) > 1500) continue;
          const postGeo = new THREE.BufferGeometry().setFromPoints([
            new THREE.Vector3(rm.toX, rm.z + 4, rm.toY),
            new THREE.Vector3(rm.toX, rm.z + 82, rm.toY)
          ]);
          this.debugSceneGroup.add(new THREE.Line(postGeo, rejMat));
          const dirGeo = new THREE.BufferGeometry().setFromPoints([
            new THREE.Vector3(rm.fromX, rm.z + 18, rm.fromY),
            new THREE.Vector3(rm.toX, rm.z + 18, rm.toY)
          ]);
          this.debugSceneGroup.add(new THREE.Line(dirGeo, rejMat));
          const scr = project(rm.toX, rm.z + 88, rm.toY);
          if (scr.visible && scr.x >= 0 && scr.x <= canvas.width && scr.y >= 0 && scr.y <= canvas.height) {
            ctx.font = 'bold 10px monospace';
            ctx.fillStyle = 'rgba(24, 6, 12, 0.85)';
            ctx.fillRect(scr.x - 42, scr.y - 11, 84, 14);
            ctx.fillStyle = '#fda4af';
            ctx.fillText(`BLK:${rm.reason.slice(0, 11)}`, scr.x - 39, scr.y);
          }
        }
      }
    }

    if (this.showCollisionBounds) {
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
    panel.querySelector('#dbg-pause-sim')?.addEventListener('click', () => {
      const sim = this.app.getSimulation();
      sim.state.isPaused = !sim.state.isPaused;
      if (sim.state.isPaused) {
        this.app.exitPointerLock();
      }
      this.syncPauseButton();
      this.onPauseChanged?.(sim.state.isPaused);
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
              <option value="crawler">Oreblade (Melee)</option>
              <option value="wasp">Driftworm (Ranged)</option>
              <option value="spitter">Slythven (Toxic)</option>
              <option value="elite">Magmir (Heavy Bruiser)</option>
              <option value="boss">Brood Queen (Flying)</option>
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
          <div class="dev-ed-panel-header">TRIGGER RIFT STALKER SKILLS</div>
          <div class="dev-dbg-btn-grid">
            <button id="dbg-atk-leap" class="sci-btn dev-ed-btn">🦗 Leap &amp; Dual Slash</button>
            <button id="dbg-atk-sweep" class="sci-btn dev-ed-btn">🦂 Tail Sweep (30)</button>
            <button id="dbg-atk-laser" class="sci-btn dev-ed-btn">⚡ Tracking Tail Laser</button>
            <button id="dbg-atk-spines" class="sci-btn dev-ed-btn">💎 Dorsal Spine Rain</button>
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
      body.querySelector('#dbg-atk-leap')?.addEventListener('click', () => sim.devTriggerBossAttack('leap_slash'));
      body.querySelector('#dbg-atk-sweep')?.addEventListener('click', () => sim.devTriggerBossAttack('tail_sweep'));
      body.querySelector('#dbg-atk-laser')?.addEventListener('click', () => sim.devTriggerBossAttack('tail_laser'));
      body.querySelector('#dbg-atk-spines')?.addEventListener('click', () => sim.devTriggerBossAttack('spine_barrage'));

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
          <div class="dev-ed-panel-header">${state.stageNumber === 1 ? 'TOWER PROGRESSION &amp; CHESTS' : 'TELEPORTER &amp; CHESTS'}</div>
          <div class="dev-dbg-btn-grid">
            <button id="dbg-tele-25" class="sci-btn dev-ed-btn">${state.stageNumber === 1 ? 'Complete Next Anomaly' : 'Charge +25%'}</button>
            <button id="dbg-tele-100" class="sci-btn primary-gold dev-ed-btn">${state.stageNumber === 1 ? 'Unlock Tower (4/4)' : 'Charge 100%'}</button>
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
          <label class="dev-ed-chk-line"><input id="dbg-vis-terrain" type="checkbox" ${this.showTerrainCollisionDebug ? 'checked' : ''} /> Terrain Collision &amp; Nav Debug (3D)</label>
          <label class="dev-ed-chk-line"><input id="dbg-vis-regions" type="checkbox" ${this.showSpawnRegions ? 'checked' : ''} /> Show Spawn Regions (Include/Exclude)</label>
          <label class="dev-ed-chk-line"><input id="dbg-vis-cols2" type="checkbox" ${this.showCollisionBounds ? 'checked' : ''} /> Show Collision Boundaries</label>
        </div>
        <details class="dev-dbg-section" open>
          <summary class="dev-ed-panel-header" style="cursor:pointer;">COMBAT DIRECTORS (FAST / SLOW)</summary>
          <div class="dev-dbg-readout" id="dbg-director-readout"></div>
        </details>
        <details class="dev-dbg-section" open>
          <summary class="dev-ed-panel-header" style="cursor:pointer;">SCENE DIRECTOR (BIO-PODS)</summary>
          <div class="dev-dbg-readout" id="dbg-scene-readout"></div>
          <div style="display:flex; gap:4px; margin-top:4px; align-items:center;">
            <input id="dbg-layout-seed" type="number" class="dev-ed-input" placeholder="Pin Seed..." value="${state.pinnedLayoutSeed ?? ''}" style="flex:1; min-width:80px;" />
            <button id="dbg-pin-seed" class="sci-btn dev-ed-btn">Pin</button>
            <button id="dbg-clear-seed" class="sci-btn dev-ed-btn">Clear</button>
            <button id="dbg-regen-layout" class="sci-btn primary-gold dev-ed-btn">Regenerate Layout</button>
          </div>
        </details>
        <details class="dev-dbg-section">
          <summary class="dev-ed-panel-header" style="cursor:pointer;">LOOT, PITY &amp; TIMED EFFECTS</summary>
          <div class="dev-dbg-readout" id="dbg-loot-readout"></div>
        </details>
        <details class="dev-dbg-section">
          <summary class="dev-ed-panel-header" style="cursor:pointer;">STAGE 1 PROGRESSION &amp; DIALOGUE</summary>
          <div class="dev-dbg-readout" id="dbg-prog-readout"></div>
        </details>
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
        if (state.stageNumber === 1) {
          const nextEv = state.worldEvents.find((ev) => !ev.isCompleted);
          if (nextEv && sim.completeWorldEventForDev(nextEv.id)) {
            this.refreshDynamicContent();
          }
        } else {
          state.artifact.chargeProgress = Math.min(100, state.artifact.chargeProgress + 25);
          if (state.artifact.chargeProgress >= 100) {
            state.artifact.isCharged = true;
            state.artifact.isTeleporterReady = true;
            state.artifact.phase = 'unlocked_ready';
          }
        }
      });
      body.querySelector('#dbg-tele-100')?.addEventListener('click', () => {
        sim.forceUnlockArtifactForDev();
      });
      body.querySelector('#dbg-tele-reset')?.addEventListener('click', () => {
        state.resetArtifactProgression();
        this.app.resetRegionalFreeze();
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
          const evId = btn.dataset.id || '';
          if (sim.completeWorldEventForDev(evId)) {
            this.refreshDynamicContent();
          }
        });
      });

      body.querySelector('#dbg-vis-terrain')?.addEventListener('change', (ev) => {
        this.showTerrainCollisionDebug = (ev.currentTarget as HTMLInputElement).checked;
        this.syncTerrainDebugCache();
      });
      body.querySelector('#dbg-vis-regions')?.addEventListener('change', (ev) => {
        this.showSpawnRegions = (ev.currentTarget as HTMLInputElement).checked;
      });
      body.querySelector('#dbg-vis-cols2')?.addEventListener('change', (ev) => {
        this.showCollisionBounds = (ev.currentTarget as HTMLInputElement).checked;
      });
      body.querySelector('#dbg-pin-seed')?.addEventListener('click', () => {
        const raw = (body.querySelector('#dbg-layout-seed') as HTMLInputElement | null)?.value?.trim();
        const parsed = raw ? Number(raw) : NaN;
        if (Number.isFinite(parsed) && parsed > 0) {
          sim.regenerateRuntimePodLayout(Math.floor(parsed));
          this.app.rebuildStageVisualsFromState();
          this.refreshDynamicContent();
        }
      });
      body.querySelector('#dbg-clear-seed')?.addEventListener('click', () => {
        state.pinnedLayoutSeed = null;
        this.refreshDynamicContent();
      });
      body.querySelector('#dbg-regen-layout')?.addEventListener('click', () => {
        const raw = (body.querySelector('#dbg-layout-seed') as HTMLInputElement | null)?.value?.trim();
        const parsed = raw ? Number(raw) : NaN;
        if (Number.isFinite(parsed) && parsed > 0) {
          sim.regenerateRuntimePodLayout(Math.floor(parsed));
        } else {
          state.pinnedLayoutSeed = null;
          sim.regenerateRuntimePodLayout(null);
        }
        this.app.rebuildStageVisualsFromState();
        this.refreshDynamicContent();
      });
    }

    this.updateLiveReadouts();
  }

  private updateLiveReadouts(): void {
    const sim = this.app.getSimulation();
    const state = sim.state;
    const p = state.player;
    const pOut = this.rootEl?.querySelector('#dbg-player-readout');
    if (pOut) {
      const supCat = state.terrain.meshCollider
        ? state.terrain.meshCollider.querySupport(p.pos.x, p.pos.y, p.z, 22).category || 'void'
        : state.terrain.getElevation(p.pos.x, p.pos.y, p.z).isInWater
          ? 'water'
          : 'ground';
      const waterTag = p.inWater ? 'WATER(-32%)' : 'LAND';
      pOut.textContent = `HP: ${Math.round(p.health)}/${Math.round(p.calculatedStats.maxHealth)} • Shield: ${Math.round(p.energyShield)} • Biomass: ${p.currency} • Lvl: ${p.level} • Pos: (${Math.round(p.pos.x)}, ${Math.round(p.pos.y)}, z=${Math.round(p.z)}, gz=${Math.round(p.groundZ)}) • [${supCat}/${waterTag}] • AirJumps: ${p.airJumpsRemaining}/${p.maxAirJumps}`;
    }
    const eOut = this.rootEl?.querySelector('#dbg-enemy-readout');
    if (eOut) {
      const diff = getDifficultyTier(state.gameTime);
      eOut.textContent = `Active Enemies: ${state.enemies.length} • Diff Tier: ${diff.tierIndex} (${diff.tierDef.name}) • Projectiles: ${state.projectiles.length}`;
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

    const dirOut = this.rootEl?.querySelector('#dbg-director-readout');
    if (dirOut) {
      const d = sim.getCombatDirectorDiagnostics();
      const fails = Object.entries(d.placementDiagnostics.failures)
        .filter(([, cnt]) => cnt > 0)
        .sort((a, b) => b[1] - a[1])
        .slice(0, 4)
        .map(([k, v]) => `${k}:${v}`)
        .join(', ');
      dirOut.textContent = `Mode: ${d.mode} | Coeff: ${d.smoothThreat}x | Pop: ${d.activeExploration}/${d.hardCap} (soft ${d.softCap}, scripted ${d.activeScripted}) | Fast: ${d.fastCredits}cr (${d.fastTimer}s) | Slow: ${d.slowCredits}cr (${d.slowTimer}s) | Fails: ${fails || 'none'}`;
    }

    const scnOut = this.rootEl?.querySelector('#dbg-scene-readout');
    if (scnOut) {
      const r = state.sceneDirectorReport;
      const opened = state.pods.filter((pod) => pod.isOpened).length;
      scnOut.textContent = r
        ? `Seed: ${r.layoutSeed}${state.pinnedLayoutSeed ? ' (PINNED)' : ''} | Credits: ${r.spent}/${r.budget} | Pods: ${state.pods.length} (opened ${opened}, target ${r.targetCount}) | Rejected: ${r.rejectedAttempts}`
        : `Pods: ${state.pods.length} (opened ${opened}) | Layout Seed: ${state.layoutSeed}`;
    }

    const lootOut = this.rootEl?.querySelector('#dbg-loot-readout');
    if (lootOut) {
      const eligibleCnt = ALL_BUFF_IDS.filter((id) => isBuffEligibleForPlayer(id, p)).length;
      const projW = getEffectiveBuffWeight(BUFF_REGISTRY.buff_extra_lmb_projectile, p);
      const src = p.buffsBySource || { level: 0, pod: 0, elite: 0, event: 0 };
      const timed = Object.values(p.activeTimedEffects || {})
        .filter((e) => e && e.remaining > 0)
        .map((e) => `${e!.name}:${e!.remaining.toFixed(1)}s`)
        .join(', ');
      const icds = Object.entries(p.timedEffectCooldowns || {})
        .filter(([, rem]) => (rem ?? 0) > 0)
        .map(([k, rem]) => `${k}:${(rem ?? 0).toFixed(1)}s`)
        .join(', ');
      lootOut.textContent = `Eligible: ${eligibleCnt} | Pity Streak: ${p.nonProjectileBuffCount} (ProjW=${projW}) | Sources L/P/E/Ev: ${src.level}/${src.pod}/${src.elite}/${src.event} | Active Timed: ${timed || 'none'} | ICDs: ${icds || 'ready'}`;
    }

    const progOut = this.rootEl?.querySelector('#dbg-prog-readout');
    if (progOut) {
      const labels: Record<string, string> = {
        primal_totem: 'LMB',
        secondary_totem: 'RMB',
        dash_totem: 'Dash',
        orbital_uplink: 'Ult'
      };
      const catStr = STAGE1_ENHANCEMENT_CATEGORIES.map(
        (c) => `${state.completedEnhancementCategories.has(c) ? '✓' : '○'}${labels[c]}`
      ).join(' ');
      const dd = this.app.getDialogueDirector()?.getDebugInfo();
      const artPhase = state.artifact?.phase || 'unknown';
      progOut.textContent = `Modules (${state.completedEnhancementCategories.size}/4): [${catStr}] | Tower Phase: ${artPhase} | Dialogue Active: ${dd?.activeId || 'idle'} | Queue: [${dd?.queueIds?.join(', ') || 'empty'}]`;
    }
  }
}

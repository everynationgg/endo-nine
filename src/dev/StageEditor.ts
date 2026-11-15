import * as THREE from 'three';
import type { ThreeApp } from '../render/ThreeApp';
import type {
  StageConfig,
  StageLayoutProfile,
  StageObjectCategory,
  StageProfileKey,
  StageValidationIssue
} from './StageConfig';
import {
  clampWorldPos,
  cloneStageConfig,
  loadStageConfigFromServer,
  saveStageConfigToServer,
  validateStageProfile
} from './StageConfig';

export interface SelectedObjectRef {
  category: StageObjectCategory;
  id: string;
}

export class StageEditor {
  private app: ThreeApp;
  private rootEl: HTMLElement | null = null;
  private isOpen: boolean = false;
  private isDirty: boolean = false;

  private workingConfig!: StageConfig;
  private activeProfileKey: StageProfileKey = 'procedural';
  private selected: SelectedObjectRef | null = null;

  // Independent Editor Camera State
  private camFocus: THREE.Vector3 = new THREE.Vector3(1800, 50, 2400);
  private camYaw: number = 0.25;
  private camPitch: number = 0.68;
  private camDist: number = 680;
  private keysHeld: Record<string, boolean> = {};

  // Pointer & Drag State
  private raycaster: THREE.Raycaster = new THREE.Raycaster();
  private pointerMode: 'none' | 'orbit' | 'pan' | 'drag_object' = 'none';
  private lastPointerX: number = 0;
  private lastPointerY: number = 0;
  private dragPlane: THREE.Plane = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0);
  private dragOffset: { x: number; y: number } = { x: 0, y: 0 };

  // Editor-Only Visual Helpers in 3D Scene
  private helpersGroup: THREE.Group = new THREE.Group();
  private playerSpawnMarker!: THREE.Group;
  private bossSpawnMarker!: THREE.Group;
  private selectionHighlight!: THREE.Group;
  private gridHelper!: THREE.GridHelper;
  private showGrid: boolean = true;
  private showSpawnMarkers: boolean = true;

  // Callbacks
  public onReturnToDashboard: (() => void) | null = null;
  public onPlaytestRequested: ((snapshot: StageConfig) => void) | null = null;

  // Bound DOM listeners
  private readonly boundKeyDown = (e: KeyboardEvent) => this.handleKeyDown(e);
  private readonly boundKeyUp = (e: KeyboardEvent) => this.handleKeyUp(e);
  private readonly boundPointerDown = (e: PointerEvent) => this.handleCanvasPointerDown(e);
  private readonly boundPointerMove = (e: PointerEvent) => this.handleWindowPointerMove(e);
  private readonly boundPointerUp = (e: PointerEvent) => this.handleWindowPointerUp(e);
  private readonly boundWheel = (e: WheelEvent) => this.handleWheel(e);

  constructor(app: ThreeApp) {
    this.app = app;
    this.helpersGroup.name = 'DevStageEditor_Helpers';
    this.buildEditorHelpers();
  }

  private buildEditorHelpers(): void {
    // 1. World Grid Overlay (3600x3600, 36 divisions = 100u cells)
    this.gridHelper = new THREE.GridHelper(3600, 36, 0x38bdf8, 0x1e3a5f);
    this.gridHelper.position.set(1800, 2, 1800);
    const gridMats = Array.isArray(this.gridHelper.material) ? this.gridHelper.material : [this.gridHelper.material];
    gridMats.forEach((m) => {
      m.transparent = true;
      m.opacity = 0.25;
      m.depthWrite = false;
    });
    this.helpersGroup.add(this.gridHelper);

    // 2. Player Spawn Marker
    this.playerSpawnMarker = this.createMarkerGroup(0x34d399, 'player_spawn', 'player_spawn', 34);
    this.helpersGroup.add(this.playerSpawnMarker);

    // 3. Stage 1 Boss Spawn Marker
    this.bossSpawnMarker = this.createMarkerGroup(0xf43f5e, 'boss_spawn', 'boss_spawn', 52);
    this.helpersGroup.add(this.bossSpawnMarker);

    // 4. Selection Highlight Ring + Vertical Axis
    this.selectionHighlight = new THREE.Group();
    const selRingGeo = new THREE.RingGeometry(36, 44, 48);
    const selRingMat = new THREE.MeshBasicMaterial({
      color: 0xfacc15,
      side: THREE.DoubleSide,
      transparent: true,
      opacity: 0.92,
      depthTest: false
    });
    const selRing = new THREE.Mesh(selRingGeo, selRingMat);
    selRing.rotation.x = -Math.PI / 2;
    selRing.position.y = 2.0;
    this.selectionHighlight.add(selRing);

    const beamGeo = new THREE.CylinderGeometry(1.5, 1.5, 220, 8);
    const beamMat = new THREE.MeshBasicMaterial({
      color: 0xfacc15,
      transparent: true,
      opacity: 0.55,
      depthWrite: false
    });
    const beam = new THREE.Mesh(beamGeo, beamMat);
    beam.position.y = 110;
    this.selectionHighlight.add(beam);
    this.selectionHighlight.visible = false;
    this.helpersGroup.add(this.selectionHighlight);
  }

  private createMarkerGroup(colorHex: number, category: StageObjectCategory, id: string, radius: number): THREE.Group {
    const grp = new THREE.Group();
    const ring = new THREE.Mesh(
      new THREE.RingGeometry(radius * 0.72, radius, 36),
      new THREE.MeshBasicMaterial({ color: colorHex, side: THREE.DoubleSide, transparent: true, opacity: 0.85 })
    );
    ring.rotation.x = -Math.PI / 2;
    ring.position.y = 1.2;
    grp.add(ring);

    const disc = new THREE.Mesh(
      new THREE.CircleGeometry(radius * 0.72, 32),
      new THREE.MeshBasicMaterial({ color: colorHex, side: THREE.DoubleSide, transparent: true, opacity: 0.22 })
    );
    disc.rotation.x = -Math.PI / 2;
    disc.position.y = 0.8;
    grp.add(disc);

    const pillar = new THREE.Mesh(
      new THREE.CylinderGeometry(3, 5, 75, 12),
      new THREE.MeshBasicMaterial({ color: colorHex, transparent: true, opacity: 0.7 })
    );
    pillar.position.y = 38;
    grp.add(pillar);

    const gem = new THREE.Mesh(
      new THREE.OctahedronGeometry(14, 0),
      new THREE.MeshBasicMaterial({ color: colorHex, wireframe: false })
    );
    gem.position.y = 88;
    grp.add(gem);

    grp.userData.editorRef = { category, id };
    grp.traverse((c) => {
      c.userData.editorRef = { category, id };
    });
    return grp;
  }

  public getIsOpen(): boolean {
    return this.isOpen;
  }

  public getIsDirty(): boolean {
    return this.isDirty;
  }

  public getWorkingConfig(): StageConfig {
    return this.workingConfig;
  }

  public open(existingConfig?: StageConfig | null): void {
    const state = this.app.getSimulation().state;
    this.activeProfileKey = state.getActiveProfileKey();

    if (existingConfig) {
      this.workingConfig = cloneStageConfig(existingConfig);
    } else if (state.activeStageConfig) {
      this.workingConfig = cloneStageConfig(state.activeStageConfig);
    } else {
      const currentProfile = state.exportCurrentProfile();
      this.workingConfig = {
        schemaVersion: 1,
        stageId: 'stage1',
        stageNumber: 1,
        stageName: state.stageName || 'The Wreckage',
        profiles: {
          [this.activeProfileKey]: currentProfile
        }
      };
    }

    if (!this.workingConfig.profiles[this.activeProfileKey]) {
      this.workingConfig.profiles[this.activeProfileKey] = state.exportCurrentProfile();
    }

    // Apply working config to simulation state and visuals
    state.applyStageConfig(this.workingConfig, this.activeProfileKey);
    this.app.rebuildStageVisualsFromState();

    // Position Editor Camera overlooking Player Spawn / Crash Site
    const sp = this.getActiveProfile().playerSpawn;
    const spElev = state.terrain.getElevation(sp.x, sp.y).height;
    this.camFocus.set(sp.x, spElev, sp.y - 160);
    this.camYaw = 0.22;
    this.camPitch = 0.68;
    this.camDist = 660;

    this.isOpen = true;
    this.app.getScene().add(this.helpersGroup);
    this.syncMarkers();

    this.mountUI();
    this.attachEvents();
    this.app.setEditorMode(true, (dt, now) => this.onEditorTick(dt, now));

    // Pre-select first pod or teleporter if nothing selected
    if (!this.selected) {
      this.selectObject({ category: 'player_spawn', id: 'player_spawn' });
    } else {
      this.refreshSelectionUI();
    }
  }

  public close(): void {
    if (!this.isOpen) return;
    this.isOpen = false;
    this.detachEvents();
    this.app.getScene().remove(this.helpersGroup);
    this.app.setEditorMode(false, null);
    this.rootEl?.remove();
    this.rootEl = null;
  }

  private getActiveProfile(): StageLayoutProfile {
    return this.workingConfig.profiles[this.activeProfileKey];
  }

  private syncMarkers(): void {
    const state = this.app.getSimulation().state;
    const profile = this.getActiveProfile();

    const sp = profile.playerSpawn;
    const spY = state.terrain.getElevation(sp.x, sp.y).height + (sp.zOffset ?? 0);
    this.playerSpawnMarker.position.set(sp.x, spY, sp.y);
    this.playerSpawnMarker.visible = this.showSpawnMarkers && sp.enabled;

    const bp = profile.bossSpawn;
    const bpY = state.terrain.getElevation(bp.x, bp.y).height + (bp.zOffset ?? 0);
    this.bossSpawnMarker.position.set(bp.x, bpY, bp.y);
    this.bossSpawnMarker.visible = this.showSpawnMarkers && bp.enabled;

    this.gridHelper.visible = this.showGrid;
    this.gridHelper.position.y = state.terrain.isCustomTestMap ? 105.5 : 2.0;

    if (this.selected) {
      const obj = this.getObjectData(this.selected);
      if (obj) {
        const y = state.terrain.getElevation(obj.x, obj.y).height + (obj.zOffset ?? 0);
        this.selectionHighlight.position.set(obj.x, y, obj.y);
        this.selectionHighlight.visible = true;
      } else {
        this.selectionHighlight.visible = false;
      }
    } else {
      this.selectionHighlight.visible = false;
    }
  }

  private onEditorTick(dt: number, now: number): void {
    // WASD / Arrow camera pan in XZ relative to editor camera yaw
    let fwd = 0;
    let right = 0;
    if (this.keysHeld['w'] || this.keysHeld['arrowup']) fwd += 1;
    if (this.keysHeld['s'] || this.keysHeld['arrowdown']) fwd -= 1;
    if (this.keysHeld['d'] || this.keysHeld['arrowright']) right += 1;
    if (this.keysHeld['a'] || this.keysHeld['arrowleft']) right -= 1;

    if (fwd !== 0 || right !== 0) {
      const speed = (this.keysHeld['shift'] ? 1200 : 520) * dt;
      const fx = Math.sin(this.camYaw);
      const fz = Math.cos(this.camYaw);
      const rx = Math.cos(this.camYaw);
      const rz = -Math.sin(this.camYaw);
      this.camFocus.x = Math.max(0, Math.min(3600, this.camFocus.x + (fx * fwd - rx * right) * speed));
      this.camFocus.z = Math.max(0, Math.min(3600, this.camFocus.z + (fz * fwd - rz * right) * speed));
      const h = this.app.getSimulation().state.terrain.getElevation(this.camFocus.x, this.camFocus.z).height;
      this.camFocus.y += (h - this.camFocus.y) * Math.min(1, dt * 8);
    }

    const cam = this.app.getCamera();
    const eyeX = this.camFocus.x - this.camDist * Math.sin(this.camYaw) * Math.cos(this.camPitch);
    const eyeY = this.camFocus.y + this.camDist * Math.sin(this.camPitch);
    const eyeZ = this.camFocus.z - this.camDist * Math.cos(this.camYaw) * Math.cos(this.camPitch);
    cam.position.set(eyeX, eyeY, eyeZ);
    cam.lookAt(this.camFocus.x, this.camFocus.y + 15, this.camFocus.z);
    cam.updateMatrixWorld();

    // Gentle pulse on selection highlight
    if (this.selectionHighlight.visible) {
      const pulse = 1 + 0.08 * Math.sin(now * 0.006);
      this.selectionHighlight.scale.set(pulse, 1, pulse);
    }
  }

  private attachEvents(): void {
    const canvas = this.app.getRenderer().domElement;
    window.addEventListener('keydown', this.boundKeyDown);
    window.addEventListener('keyup', this.boundKeyUp);
    canvas.addEventListener('pointerdown', this.boundPointerDown);
    window.addEventListener('pointermove', this.boundPointerMove);
    window.addEventListener('pointerup', this.boundPointerUp);
    canvas.addEventListener('wheel', this.boundWheel, { passive: false });
  }

  private detachEvents(): void {
    const canvas = this.app.getRenderer().domElement;
    window.removeEventListener('keydown', this.boundKeyDown);
    window.removeEventListener('keyup', this.boundKeyUp);
    canvas.removeEventListener('pointerdown', this.boundPointerDown);
    window.removeEventListener('pointermove', this.boundPointerMove);
    window.removeEventListener('pointerup', this.boundPointerUp);
    canvas.removeEventListener('wheel', this.boundWheel);
    this.keysHeld = {};
    this.pointerMode = 'none';
  }

  private handleKeyDown(e: KeyboardEvent): void {
    if (!this.isOpen) return;
    const tag = (e.target as HTMLElement | null)?.tagName;
    if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return;

    this.keysHeld[e.key.toLowerCase()] = true;
    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 's') {
      e.preventDefault();
      void this.handleSave();
    }
  }

  private handleKeyUp(e: KeyboardEvent): void {
    this.keysHeld[e.key.toLowerCase()] = false;
  }

  private handleWheel(e: WheelEvent): void {
    if (!this.isOpen) return;
    e.preventDefault();
    const step = Math.max(30, this.camDist * 0.12);
    this.camDist = Math.max(110, Math.min(2600, this.camDist + Math.sign(e.deltaY) * step));
  }

  private handleCanvasPointerDown(e: PointerEvent): void {
    if (!this.isOpen) return;
    const canvas = this.app.getRenderer().domElement;
    if (e.target !== canvas) return;

    this.lastPointerX = e.clientX;
    this.lastPointerY = e.clientY;

    // Right click or Alt+Left -> Orbit; Middle or Shift+Right -> Pan
    if (e.button === 2 && e.shiftKey) {
      this.pointerMode = 'pan';
      return;
    }
    if (e.button === 2 || (e.button === 0 && e.altKey)) {
      this.pointerMode = 'orbit';
      return;
    }
    if (e.button === 1) {
      this.pointerMode = 'pan';
      return;
    }

    if (e.button === 0) {
      const hit = this.pickStageObject(e.clientX, e.clientY);
      if (hit) {
        this.selectObject(hit);
        const objData = this.getObjectData(hit);
        const groundPt = this.raycastTerrain(e.clientX, e.clientY);
        if (objData && groundPt) {
          this.dragOffset = {
            x: objData.x - groundPt.x,
            y: objData.y - groundPt.z
          };
          this.pointerMode = 'drag_object';
        }
      }
    }
  }

  private handleWindowPointerMove(e: PointerEvent): void {
    if (!this.isOpen || this.pointerMode === 'none') return;
    const dx = e.clientX - this.lastPointerX;
    const dy = e.clientY - this.lastPointerY;
    this.lastPointerX = e.clientX;
    this.lastPointerY = e.clientY;

    if (this.pointerMode === 'orbit') {
      this.camYaw -= dx * 0.006;
      this.camPitch = Math.max(0.14, Math.min(1.42, this.camPitch + dy * 0.005));
    } else if (this.pointerMode === 'pan') {
      const panScale = this.camDist * 0.0018;
      const fx = Math.sin(this.camYaw);
      const fz = Math.cos(this.camYaw);
      const rx = Math.cos(this.camYaw);
      const rz = -Math.sin(this.camYaw);
      this.camFocus.x = Math.max(0, Math.min(3600, this.camFocus.x + (-rx * dx + fx * dy) * panScale));
      this.camFocus.z = Math.max(0, Math.min(3600, this.camFocus.z + (-rz * dx + fz * dy) * panScale));
      this.camFocus.y = this.app.getSimulation().state.terrain.getElevation(this.camFocus.x, this.camFocus.z).height;
    } else if (this.pointerMode === 'drag_object' && this.selected) {
      const groundPt = this.raycastTerrain(e.clientX, e.clientY);
      if (groundPt) {
        const clamped = clampWorldPos({
          x: groundPt.x + this.dragOffset.x,
          y: groundPt.z + this.dragOffset.y
        });
        this.moveSelectedObject(clamped.x, clamped.y);
      }
    }
  }

  private handleWindowPointerUp(_e: PointerEvent): void {
    if (this.pointerMode === 'drag_object') {
      this.app.rebuildStageVisualsFromState();
      this.syncMarkers();
    }
    this.pointerMode = 'none';
  }

  private pickStageObject(clientX: number, clientY: number): SelectedObjectRef | null {
    const cam = this.app.getCamera();
    const ndc = new THREE.Vector2(
      (clientX / window.innerWidth) * 2 - 1,
      -(clientY / window.innerHeight) * 2 + 1
    );
    this.raycaster.setFromCamera(ndc, cam);

    const pickables: THREE.Object3D[] = [this.playerSpawnMarker, this.bossSpawnMarker];
    const scene = this.app.getScene();
    scene.traverse((obj) => {
      if (obj.userData?.editorRef && obj.visible) {
        pickables.push(obj);
      }
    });

    const hits = this.raycaster.intersectObjects(pickables, false);
    for (const h of hits) {
      const ref = h.object.userData?.editorRef as SelectedObjectRef | undefined;
      if (ref) return { category: ref.category, id: ref.id };
    }
    return null;
  }

  private raycastTerrain(clientX: number, clientY: number): THREE.Vector3 | null {
    const cam = this.app.getCamera();
    const ndc = new THREE.Vector2(
      (clientX / window.innerWidth) * 2 - 1,
      -(clientY / window.innerHeight) * 2 + 1
    );
    this.raycaster.setFromCamera(ndc, cam);

    const threeTerrain = this.app.getThreeTerrain();
    const targets = threeTerrain.testMapGroup.visible
      ? [threeTerrain.testMapGroup]
      : threeTerrain.terrainMeshes;

    const hits = this.raycaster.intersectObjects(targets, true);
    if (hits.length > 0) {
      return hits[0].point.clone();
    }

    // Fallback analytical raymarch against TerrainSystem heightfield
    const origin = this.raycaster.ray.origin;
    const dir = this.raycaster.ray.direction;
    const terrain = this.app.getSimulation().state.terrain;
    if (dir.y < -0.01) {
      const steps = 48;
      const maxDist = 4200;
      const step = maxDist / steps;
      for (let i = 1; i <= steps; i++) {
        const t = i * step;
        const rx = origin.x + dir.x * t;
        const ry = origin.y + dir.y * t;
        const rz = origin.z + dir.z * t;
        const h = terrain.calculateHeight(rx, rz);
        if (ry <= h) {
          return new THREE.Vector3(rx, h, rz);
        }
      }
    }

    const pt = new THREE.Vector3();
    this.dragPlane.constant = -this.camFocus.y;
    if (this.raycaster.ray.intersectPlane(this.dragPlane, pt)) {
      return pt;
    }
    return null;
  }

  private getObjectData(ref: SelectedObjectRef): {
    name: string;
    typeLabel: string;
    x: number;
    y: number;
    zOffset: number;
    rotationY: number;
    scale: number;
    enabled: boolean;
    extraLabel?: string;
    extraValue?: number | string;
    setCoords: (x: number, y: number, zOffset?: number) => void;
    setProps?: (patch: { name?: string; rotationY?: number; scale?: number; enabled?: boolean; extraValue?: number }) => void;
  } | null {
    const p = this.getActiveProfile();
    if (ref.category === 'player_spawn') {
      return {
        name: p.playerSpawn.name,
        typeLabel: 'Player Spawn',
        x: p.playerSpawn.x,
        y: p.playerSpawn.y,
        zOffset: p.playerSpawn.zOffset ?? 0,
        rotationY: p.playerSpawn.rotationY ?? 0,
        scale: 1,
        enabled: p.playerSpawn.enabled,
        setCoords: (x, y, zOff) => {
          p.playerSpawn.x = x;
          p.playerSpawn.y = y;
          if (zOff !== undefined) p.playerSpawn.zOffset = zOff;
        },
        setProps: (patch) => {
          if (patch.name !== undefined) p.playerSpawn.name = patch.name;
          if (patch.enabled !== undefined) p.playerSpawn.enabled = patch.enabled;
        }
      };
    }
    if (ref.category === 'boss_spawn') {
      return {
        name: p.bossSpawn.name,
        typeLabel: 'Stage Boss Spawn',
        x: p.bossSpawn.x,
        y: p.bossSpawn.y,
        zOffset: p.bossSpawn.zOffset ?? 0,
        rotationY: p.bossSpawn.rotationY ?? 0,
        scale: 1,
        enabled: p.bossSpawn.enabled,
        setCoords: (x, y, zOff) => {
          p.bossSpawn.x = x;
          p.bossSpawn.y = y;
          if (zOff !== undefined) p.bossSpawn.zOffset = zOff;
        },
        setProps: (patch) => {
          if (patch.name !== undefined) p.bossSpawn.name = patch.name;
          if (patch.enabled !== undefined) p.bossSpawn.enabled = patch.enabled;
        }
      };
    }
    if (ref.category === 'teleporter') {
      return {
        name: p.teleporter.name,
        typeLabel: 'Overseer Teleporter',
        x: p.teleporter.x,
        y: p.teleporter.y,
        zOffset: p.teleporter.zOffset ?? 0,
        rotationY: p.teleporter.rotationY ?? 0,
        scale: p.teleporter.scale ?? 1,
        enabled: p.teleporter.enabled,
        extraLabel: 'Interaction Radius',
        extraValue: p.teleporter.radius,
        setCoords: (x, y, zOff) => {
          p.teleporter.x = x;
          p.teleporter.y = y;
          if (zOff !== undefined) p.teleporter.zOffset = zOff;
        },
        setProps: (patch) => {
          if (patch.name !== undefined) p.teleporter.name = patch.name;
          if (patch.rotationY !== undefined) p.teleporter.rotationY = patch.rotationY;
          if (patch.scale !== undefined) p.teleporter.scale = Math.max(0.1, patch.scale);
          if (patch.enabled !== undefined) p.teleporter.enabled = patch.enabled;
          if (patch.extraValue !== undefined) p.teleporter.radius = Math.max(10, patch.extraValue);
        }
      };
    }
    if (ref.category === 'world_event') {
      const ev = p.worldEvents.find((e) => e.id === ref.id);
      if (!ev) return null;
      return {
        name: ev.name,
        typeLabel: `Event (${ev.type})`,
        x: ev.x,
        y: ev.y,
        zOffset: ev.zOffset ?? 0,
        rotationY: ev.rotationY ?? 0,
        scale: ev.scale ?? 1,
        enabled: ev.enabled,
        extraLabel: 'Aura Radius',
        extraValue: ev.radius,
        setCoords: (x, y, zOff) => {
          ev.x = x;
          ev.y = y;
          if (zOff !== undefined) ev.zOffset = zOff;
        },
        setProps: (patch) => {
          if (patch.name !== undefined) ev.name = patch.name;
          if (patch.rotationY !== undefined) ev.rotationY = patch.rotationY;
          if (patch.scale !== undefined) ev.scale = Math.max(0.1, patch.scale);
          if (patch.enabled !== undefined) ev.enabled = patch.enabled;
          if (patch.extraValue !== undefined) ev.radius = Math.max(20, patch.extraValue);
        }
      };
    }
    if (ref.category === 'pod') {
      const pod = p.pods.find((c) => c.id === ref.id);
      if (!pod) return null;
      return {
        name: pod.name,
        typeLabel: 'Biological Treasure Chest',
        x: pod.x,
        y: pod.y,
        zOffset: pod.zOffset ?? 0,
        rotationY: pod.rotationY ?? 0,
        scale: pod.scale ?? 1,
        enabled: pod.enabled,
        extraLabel: 'Gene Cost',
        extraValue: pod.cost,
        setCoords: (x, y, zOff) => {
          pod.x = x;
          pod.y = y;
          if (zOff !== undefined) pod.zOffset = zOff;
        },
        setProps: (patch) => {
          if (patch.name !== undefined) pod.name = patch.name;
          if (patch.rotationY !== undefined) pod.rotationY = patch.rotationY;
          if (patch.scale !== undefined) pod.scale = Math.max(0.1, patch.scale);
          if (patch.enabled !== undefined) pod.enabled = patch.enabled;
          if (patch.extraValue !== undefined) pod.cost = Math.max(0, Math.round(patch.extraValue));
        }
      };
    }
    if (ref.category === 'obstacle') {
      const obs = p.obstacles.find((o) => o.id === ref.id);
      if (!obs) return null;
      return {
        name: obs.name,
        typeLabel: `Obstacle (${obs.type})`,
        x: obs.x,
        y: obs.y,
        zOffset: obs.zOffset ?? 0,
        rotationY: obs.rotationY ?? 0,
        scale: obs.scaleVar,
        enabled: obs.enabled,
        extraLabel: 'Collision Radius',
        extraValue: obs.radius,
        setCoords: (x, y, zOff) => {
          obs.x = x;
          obs.y = y;
          if (zOff !== undefined) obs.zOffset = zOff;
        },
        setProps: (patch) => {
          if (patch.name !== undefined) obs.name = patch.name;
          if (patch.rotationY !== undefined) obs.rotationY = patch.rotationY;
          if (patch.scale !== undefined) obs.scaleVar = Math.max(0.1, patch.scale);
          if (patch.enabled !== undefined) obs.enabled = patch.enabled;
          if (patch.extraValue !== undefined) obs.radius = Math.max(4, patch.extraValue);
        }
      };
    }
    return null;
  }

  public selectObject(ref: SelectedObjectRef | null): void {
    this.selected = ref;
    this.syncMarkers();
    this.refreshSelectionUI();
  }

  private moveSelectedObject(x: number, y: number, zOffset?: number): void {
    if (!this.selected) return;
    const obj = this.getObjectData(this.selected);
    if (!obj) return;

    const rx = Math.round(x * 100) / 100;
    const ry = Math.round(y * 100) / 100;
    obj.setCoords(rx, ry, zOffset);

    this.markDirty();
    const state = this.app.getSimulation().state;
    state.applyStageConfig(this.workingConfig, this.activeProfileKey);

    // Fast live visual update while dragging without recreating textures/meshes each pixel
    const mesh = this.app.getEditorObjectMesh(this.selected.category, this.selected.id);
    const elev = state.terrain.getElevation(rx, ry).height + (obj.zOffset ?? 0);
    if (mesh) {
      if (this.selected.category === 'obstacle') {
        this.app.rebuildStageVisualsFromState();
      } else {
        mesh.position.set(rx, elev, ry);
      }
    }
    this.syncMarkers();
    this.refreshSelectionUI();
  }

  private markDirty(): void {
    this.isDirty = true;
    const badge = this.rootEl?.querySelector('#dev-ed-dirty-badge');
    if (badge) {
      badge.textContent = '● Unsaved Changes';
      badge.className = 'dev-ed-badge dirty';
    }
  }

  private clearDirty(label: string = '✓ Saved'): void {
    this.isDirty = false;
    const badge = this.rootEl?.querySelector('#dev-ed-dirty-badge');
    if (badge) {
      badge.textContent = label;
      badge.className = 'dev-ed-badge clean';
    }
  }

  private async handleSave(): Promise<void> {
    const profile = this.getActiveProfile();
    const issues: StageValidationIssue[] = validateStageProfile(
      profile,
      this.app.getSimulation().state.terrain
    );
    const errors = issues.filter((i) => i.severity === 'error');
    if (errors.length > 0) {
      this.setStatus(`Save blocked (${errors.length} error): ${errors[0].message}`, true);
      return;
    }

    this.workingConfig.updatedAt = new Date().toISOString();
    this.setStatus('Saving to public/stages/stage1.config.json...', false);
    const res = await saveStageConfigToServer('stage1', this.workingConfig);
    if (!res.ok) {
      // Preserve unsaved state if write fails!
      this.setStatus(`Save failed: ${res.error || 'Unknown error'}`, true);
      return;
    }

    this.app.getSimulation().state.applyStageConfig(this.workingConfig, this.activeProfileKey);
    this.app.rebuildStageVisualsFromState();
    this.clearDirty('✓ Saved');
    const warnNote = issues.length > 0 ? ` (${issues.length} warnings)` : '';
    this.setStatus(`Saved ${res.path}${warnNote}${res.backupPath ? ' • Backup created' : ''}`, false);
  }

  private async handleReload(): Promise<void> {
    const fresh = await loadStageConfigFromServer('stage1');
    if (!fresh) {
      this.setStatus('Reload failed: could not read stage1.config.json from dev server.', true);
      return;
    }
    this.workingConfig = cloneStageConfig(fresh);
    this.app.getSimulation().state.applyStageConfig(this.workingConfig, this.activeProfileKey);
    this.app.rebuildStageVisualsFromState();
    this.syncMarkers();
    this.clearDirty('✓ Reloaded');
    this.refreshHierarchyUI();
    this.refreshSelectionUI();
    this.setStatus('Reloaded saved stage1.config.json from disk.', false);
  }

  private setStatus(msg: string, isError: boolean): void {
    const el = this.rootEl?.querySelector('#dev-ed-status') as HTMLElement | null;
    if (!el) return;
    el.textContent = msg;
    el.style.color = isError ? '#fca5a5' : '#6ee7b7';
  }

  private mountUI(): void {
    this.rootEl?.remove();
    const root = document.createElement('div');
    root.id = 'dev-editor-root';
    root.className = 'dev-editor-root';
    root.innerHTML = `
      <div class="dev-ed-topbar interactive">
        <div class="dev-ed-brand">
          <span class="dev-ed-title">VISUAL STAGE EDITOR — STAGE 1</span>
          <span class="dev-ed-profile">[${this.activeProfileKey}]</span>
          <span id="dev-ed-dirty-badge" class="dev-ed-badge ${this.isDirty ? 'dirty' : 'clean'}">${this.isDirty ? '● Unsaved Changes' : '✓ Saved'}</span>
        </div>
        <div class="dev-ed-actions">
          <button id="dev-ed-toggle-grid" class="sci-btn dev-ed-btn">Grid: ON</button>
          <button id="dev-ed-toggle-spawns" class="sci-btn dev-ed-btn">Spawns: ON</button>
          <button id="dev-ed-save" class="sci-btn primary-gold dev-ed-btn">💾 Save</button>
          <button id="dev-ed-reload" class="sci-btn dev-ed-btn">↻ Reload</button>
          <button id="dev-ed-back" class="sci-btn danger-btn dev-ed-btn">← Developer Menu</button>
        </div>
      </div>

      <div class="dev-ed-left interactive">
        <div class="dev-ed-panel-header">STAGE HIERARCHY</div>
        <input id="dev-ed-search" class="dev-ed-input" type="text" placeholder="Search objects..." />
        <div id="dev-ed-hierarchy-list" class="dev-ed-list"></div>
      </div>

      <div class="dev-ed-right interactive">
        <div class="dev-ed-panel-header">OBJECT PROPERTIES</div>
        <div id="dev-ed-props-body" class="dev-ed-props-body"></div>
      </div>

      <div class="dev-ed-bottom interactive">
        <span id="dev-ed-status">Click any object to select • Drag on terrain to move • Right-drag Orbit • WASD / Middle-drag Pan • Wheel Zoom</span>
      </div>
    `;

    document.body.appendChild(root);
    this.rootEl = root;

    root.querySelector('#dev-ed-save')?.addEventListener('click', () => void this.handleSave());
    root.querySelector('#dev-ed-reload')?.addEventListener('click', () => void this.handleReload());
    root.querySelector('#dev-ed-back')?.addEventListener('click', () => {
      this.close();
      this.onReturnToDashboard?.();
    });
    root.querySelector('#dev-ed-toggle-grid')?.addEventListener('click', (ev) => {
      this.showGrid = !this.showGrid;
      (ev.currentTarget as HTMLElement).textContent = `Grid: ${this.showGrid ? 'ON' : 'OFF'}`;
      this.syncMarkers();
    });
    root.querySelector('#dev-ed-toggle-spawns')?.addEventListener('click', (ev) => {
      this.showSpawnMarkers = !this.showSpawnMarkers;
      (ev.currentTarget as HTMLElement).textContent = `Spawns: ${this.showSpawnMarkers ? 'ON' : 'OFF'}`;
      this.syncMarkers();
    });
    root.querySelector('#dev-ed-search')?.addEventListener('input', () => this.refreshHierarchyUI());

    this.refreshHierarchyUI();
    this.refreshSelectionUI();
  }

  private refreshHierarchyUI(): void {
    const listEl = this.rootEl?.querySelector('#dev-ed-hierarchy-list');
    if (!listEl) return;
    const query = ((this.rootEl?.querySelector('#dev-ed-search') as HTMLInputElement | null)?.value || '').toLowerCase();
    const p = this.getActiveProfile();

    const items: Array<{ ref: SelectedObjectRef; label: string; tag: string }> = [
      { ref: { category: 'player_spawn', id: 'player_spawn' }, label: p.playerSpawn.name, tag: 'SPAWN' },
      { ref: { category: 'boss_spawn', id: 'boss_spawn' }, label: p.bossSpawn.name, tag: 'BOSS' },
      { ref: { category: 'teleporter', id: 'overseer_teleporter' }, label: p.teleporter.name, tag: 'TELEPORTER' },
      ...p.worldEvents.map((e) => ({ ref: { category: 'world_event' as const, id: e.id }, label: e.name, tag: 'EVENT' })),
      ...p.pods.map((pod) => ({ ref: { category: 'pod' as const, id: pod.id }, label: pod.name || pod.id, tag: 'CHEST' })),
      ...p.obstacles
        .filter((o) => !o.id.startsWith('ship_') && !o.id.startsWith('test_ship_'))
        .map((o) => ({ ref: { category: 'obstacle' as const, id: o.id }, label: o.name || o.id, tag: o.type.toUpperCase() }))
    ];

    const filtered = query ? items.filter((it) => `${it.label} ${it.ref.id} ${it.tag}`.toLowerCase().includes(query)) : items;

    listEl.innerHTML = filtered
      .map((it) => {
        const active = this.selected && this.selected.category === it.ref.category && this.selected.id === it.ref.id;
        return `<button class="dev-ed-list-item ${active ? 'active' : ''}" data-cat="${it.ref.category}" data-id="${it.ref.id}">
          <span class="dev-ed-tag">${it.tag}</span>
          <span class="dev-ed-item-name">${it.label}</span>
        </button>`;
      })
      .join('');

    listEl.querySelectorAll<HTMLButtonElement>('.dev-ed-list-item').forEach((btn) => {
      btn.addEventListener('click', () => {
        const cat = btn.dataset.cat as StageObjectCategory;
        const id = btn.dataset.id!;
        this.selectObject({ category: cat, id });
        const data = this.getObjectData({ category: cat, id });
        if (data) {
          const elev = this.app.getSimulation().state.terrain.getElevation(data.x, data.y).height;
          this.camFocus.set(data.x, elev, data.y);
        }
      });
    });
  }

  private refreshSelectionUI(): void {
    this.refreshHierarchyUI();
    const body = this.rootEl?.querySelector('#dev-ed-props-body');
    if (!body) return;

    if (!this.selected) {
      body.innerHTML = `<div class="dev-ed-empty">Select an object in the viewport or hierarchy to inspect and edit its properties.</div>`;
      return;
    }

    const obj = this.getObjectData(this.selected);
    if (!obj) {
      body.innerHTML = `<div class="dev-ed-empty">Selected object not found.</div>`;
      return;
    }

    const terrainH = this.app.getSimulation().state.terrain.getElevation(obj.x, obj.y).height;
    const totalElev = Math.round((terrainH + obj.zOffset) * 100) / 100;

    body.innerHTML = `
      <div class="dev-ed-prop-row"><label>ID</label><input class="dev-ed-input" type="text" value="${this.selected.id}" disabled /></div>
      <div class="dev-ed-prop-row"><label>Type</label><input class="dev-ed-input" type="text" value="${obj.typeLabel}" disabled /></div>
      <div class="dev-ed-prop-row"><label>Name</label><input id="prop-name" class="dev-ed-input" type="text" value="${obj.name}" /></div>
      <div class="dev-ed-prop-row"><label>Enabled</label><input id="prop-enabled" type="checkbox" ${obj.enabled ? 'checked' : ''} /></div>
      <div class="dev-ed-prop-grid">
        <div><label>X</label><input id="prop-x" class="dev-ed-input" type="number" step="5" value="${obj.x}" /></div>
        <div><label>Z (World Y)</label><input id="prop-y" class="dev-ed-input" type="number" step="5" value="${obj.y}" /></div>
        <div><label>Y Offset</label><input id="prop-zoff" class="dev-ed-input" type="number" step="1" value="${obj.zOffset}" /></div>
        <div><label>Elevation</label><input class="dev-ed-input" type="number" value="${totalElev}" disabled /></div>
      </div>
      <div class="dev-ed-prop-grid">
        <div><label>Rot Y (rad)</label><input id="prop-rot" class="dev-ed-input" type="number" step="0.1" value="${obj.rotationY}" /></div>
        <div><label>Scale</label><input id="prop-scale" class="dev-ed-input" type="number" step="0.05" min="0.1" value="${obj.scale}" /></div>
      </div>
      ${
        obj.extraLabel
          ? `<div class="dev-ed-prop-row"><label>${obj.extraLabel}</label><input id="prop-extra" class="dev-ed-input" type="number" step="1" value="${obj.extraValue}" /></div>`
          : ''
      }
      <div style="display:flex; gap:6px; margin-top:8px;">
        <button id="prop-snap-ground" class="sci-btn dev-ed-btn" style="flex:1;">Snap to Ground (Y Offset = 0)</button>
        <button id="prop-focus-cam" class="sci-btn dev-ed-btn">Focus</button>
      </div>
    `;

    const applyUpdate = () => {
      const nameVal = (body.querySelector('#prop-name') as HTMLInputElement).value;
      const enabledVal = (body.querySelector('#prop-enabled') as HTMLInputElement).checked;
      const xVal = parseFloat((body.querySelector('#prop-x') as HTMLInputElement).value);
      const yVal = parseFloat((body.querySelector('#prop-y') as HTMLInputElement).value);
      const zOffVal = parseFloat((body.querySelector('#prop-zoff') as HTMLInputElement).value);
      const rotVal = parseFloat((body.querySelector('#prop-rot') as HTMLInputElement).value);
      const scaleVal = parseFloat((body.querySelector('#prop-scale') as HTMLInputElement).value);
      const extraEl = body.querySelector('#prop-extra') as HTMLInputElement | null;
      const extraVal = extraEl ? parseFloat(extraEl.value) : undefined;

      if (Number.isFinite(xVal) && Number.isFinite(yVal)) {
        const clamped = clampWorldPos({ x: xVal, y: yVal });
        obj.setCoords(clamped.x, clamped.y, Number.isFinite(zOffVal) ? zOffVal : 0);
      }
      obj.setProps?.({
        name: nameVal,
        enabled: enabledVal,
        rotationY: Number.isFinite(rotVal) ? rotVal : 0,
        scale: Number.isFinite(scaleVal) ? scaleVal : 1,
        extraValue: extraVal !== undefined && Number.isFinite(extraVal) ? extraVal : undefined
      });
      this.markDirty();
      this.app.getSimulation().state.applyStageConfig(this.workingConfig, this.activeProfileKey);
      this.app.rebuildStageVisualsFromState();
      this.syncMarkers();
    };

    body.querySelectorAll('input').forEach((inp) => {
      inp.addEventListener('change', () => {
        applyUpdate();
        this.refreshSelectionUI();
      });
    });

    body.querySelector('#prop-snap-ground')?.addEventListener('click', () => {
      obj.setCoords(obj.x, obj.y, 0);
      this.markDirty();
      this.app.getSimulation().state.applyStageConfig(this.workingConfig, this.activeProfileKey);
      this.app.rebuildStageVisualsFromState();
      this.syncMarkers();
      this.refreshSelectionUI();
    });

    body.querySelector('#prop-focus-cam')?.addEventListener('click', () => {
      const h = this.app.getSimulation().state.terrain.getElevation(obj.x, obj.y).height;
      this.camFocus.set(obj.x, h, obj.y);
    });
  }
}

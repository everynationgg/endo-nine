import * as THREE from 'three';
import { TransformControls } from 'three/examples/jsm/controls/TransformControls.js';
import type { ThreeApp } from '../render/ThreeApp';
import type { TerrainSurfaceCategory } from '../sim/types';
import type {
  EnemyType,
  StageCatalogItem,
  StageConfig,
  StageEnemySpawnRegionConfig,
  StageLayoutProfile,
  StageObjectCategory,
  StageProfileKey,
  StageValidationIssue,
  WorldEventType
} from './StageConfig';
import {
  STAGE_OBJECT_CATALOG,
  clampWorldPos,
  cloneStageConfig,
  formatObstacleDisplayName,
  getStageDefinition,
  loadStageConfigFromServer,
  saveStageConfigToServer,
  validateStageProfile
} from './StageConfig';

export interface SelectedObjectRef {
  category: StageObjectCategory;
  id: string;
}

export type EditorToolMode = 'select' | 'move' | 'rotate' | 'scale' | 'place';

interface EditableObjectAdapter {
  name: string;
  typeLabel: string;
  x: number;
  y: number;
  zOffset: number;
  rotationY: number;
  scale: number;
  enabled: boolean;
  placementRule?: 'terrain' | 'water' | 'free';
  extraLabel?: string;
  extraValue?: number;
  region?: StageEnemySpawnRegionConfig;
  setCoords: (x: number, y: number, zOffset?: number) => void;
  setProps: (patch: {
    name?: string;
    rotationY?: number;
    scale?: number;
    enabled?: boolean;
    extraValue?: number;
    placementRule?: 'terrain' | 'water' | 'free';
  }) => void;
}

const MAX_UNDO_HISTORY = 50;

export class StageEditor {
  private app: ThreeApp;
  private rootEl: HTMLElement | null = null;
  private isOpen: boolean = false;
  private isDirty: boolean = false;

  private workingConfig!: StageConfig;
  private currentStageId: string = 'stage1';
  private activeProfileKey: StageProfileKey = 'procedural';
  private selectedRefs: SelectedObjectRef[] = [];

  // Tool & Gizmo State
  private toolMode: EditorToolMode = 'move';
  private gizmoSpace: 'world' | 'local' = 'world';
  private posSnap: number = 0;
  private rotSnapDeg: number = 0;
  private autoTerrainSnap: boolean = true;
  private showShipColliders: boolean = false;
  private pendingCatalogItem: StageCatalogItem | null = null;
  private showValidationDrawer: boolean = false;

  // Bounded Undo / Redo Stacks
  private undoStack: StageLayoutProfile[] = [];
  private redoStack: StageLayoutProfile[] = [];

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
  private dragStartCenters: Map<string, { x: number; y: number; zOffset: number }> = new Map();
  private dragAnchorWorld: { x: number; y: number } = { x: 0, y: 0 };
  private dragUndoPushed: boolean = false;

  // TransformControls Gizmo
  private transformControls: TransformControls | null = null;
  private gizmoProxy: THREE.Object3D = new THREE.Object3D();
  private isGizmoDragging: boolean = false;
  private gizmoStartProxyPos: THREE.Vector3 = new THREE.Vector3();
  private gizmoStartStates: Map<string, { x: number; y: number; zOffset: number; rotY: number; scale: number; width?: number; height?: number }> = new Map();

  // Editor-Only Visual Helpers in 3D Scene
  private helpersGroup: THREE.Group = new THREE.Group();
  private spawnRegionsGroup: THREE.Group = new THREE.Group();
  private collisionOverlayGroup: THREE.Group = new THREE.Group();
  private multiSelectRingsGroup: THREE.Group = new THREE.Group();
  private playerSpawnMarker!: THREE.Group;
  private bossSpawnMarker!: THREE.Group;
  private selectionHighlight!: THREE.Group;
  private gridHelper!: THREE.GridHelper;

  private showGrid: boolean = true;
  private showSpawnMarkers: boolean = true;
  private showCollisionOverlay: boolean = false;
  private lastGridSpan: number = 3600;

  // Callbacks
  public onReturnToDashboard: (() => void) | null = null;
  public onPlaytestRequested: ((snapshot: StageConfig) => void) | null = null;

  // Bound DOM listeners
  private readonly boundKeyDown = (e: KeyboardEvent) => this.handleKeyDown(e);
  private readonly boundKeyUp = (e: KeyboardEvent) => this.handleKeyUp(e);
  private readonly boundPointerDown = (e: PointerEvent) => this.handleCanvasPointerDown(e);
  private readonly boundPointerMove = (e: PointerEvent) => this.handleWindowPointerMove(e);
  private readonly boundPointerUp = () => this.handleWindowPointerUp();
  private readonly boundWheel = (e: WheelEvent) => this.handleWheel(e);

  constructor(app: ThreeApp) {
    this.app = app;
    this.helpersGroup.name = 'DevStageEditor_Helpers';
    this.gizmoProxy.name = 'DevStageEditor_GizmoProxy';
    this.buildEditorHelpers();
  }

  private buildEditorHelpers(): void {
    this.gridHelper = new THREE.GridHelper(3600, 36, 0x38bdf8, 0x1e3a5f);
    this.gridHelper.position.set(1800, 2, 1800);
    const gridMats = Array.isArray(this.gridHelper.material) ? this.gridHelper.material : [this.gridHelper.material];
    gridMats.forEach((m) => {
      m.transparent = true;
      m.opacity = 0.24;
      m.depthWrite = false;
    });
    this.helpersGroup.add(this.gridHelper);

    this.playerSpawnMarker = this.createMarkerGroup(0x34d399, 'player_spawn', 'player_spawn', 34);
    this.helpersGroup.add(this.playerSpawnMarker);

    this.bossSpawnMarker = this.createMarkerGroup(0xf43f5e, 'boss_spawn', 'boss_spawn', 52);
    this.helpersGroup.add(this.bossSpawnMarker);

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

    const axisGeo = new THREE.CylinderGeometry(1.5, 1.5, 95, 8);
    const axisMat = new THREE.MeshBasicMaterial({ color: 0xfacc15, transparent: true, opacity: 0.75, depthTest: false });
    const axis = new THREE.Mesh(axisGeo, axisMat);
    axis.position.y = 48;
    this.selectionHighlight.add(axis);
    this.selectionHighlight.visible = false;
    this.helpersGroup.add(this.selectionHighlight);

    this.helpersGroup.add(this.multiSelectRingsGroup);
    this.helpersGroup.add(this.spawnRegionsGroup);
    this.helpersGroup.add(this.collisionOverlayGroup);
    this.helpersGroup.add(this.gizmoProxy);
  }

  private createMarkerGroup(
    color: number,
    category: StageObjectCategory,
    id: string,
    radius: number
  ): THREE.Group {
    const grp = new THREE.Group();
    grp.userData.editorRef = { category, id };

    const ringGeo = new THREE.RingGeometry(radius - 5, radius, 36);
    const ringMat = new THREE.MeshBasicMaterial({ color, side: THREE.DoubleSide, transparent: true, opacity: 0.9 });
    const ring = new THREE.Mesh(ringGeo, ringMat);
    ring.rotation.x = -Math.PI / 2;
    ring.position.y = 1.5;
    ring.userData.editorRef = { category, id };
    grp.add(ring);

    const pillarGeo = new THREE.ConeGeometry(12, 48, 8);
    const pillarMat = new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.78 });
    const pillar = new THREE.Mesh(pillarGeo, pillarMat);
    pillar.position.y = 32;
    pillar.rotation.x = Math.PI;
    pillar.userData.editorRef = { category, id };
    grp.add(pillar);

    return grp;
  }

  private initTransformControls(): void {
    this.disposeTransformControls();
    const tc = new TransformControls(this.app.getCamera(), this.app.getRenderer().domElement);
    tc.setSize(0.85);
    tc.setSpace(this.gizmoSpace);
    this.applySnapSettings(tc);

    tc.addEventListener('dragging-changed', (ev: any) => {
      const dragging = !!ev.value;
      this.isGizmoDragging = dragging;
      if (dragging) {
        this.pushUndo();
        this.captureGizmoDragBaseline();
      } else {
        this.app.getSimulation().state.applyStageConfig(this.workingConfig, this.activeProfileKey);
        this.app.rebuildStageVisualsFromState();
        this.rebuildCollisionOverlay();
        this.refreshValidationUI();
        this.refreshSelectionUI();
      }
    });

    tc.addEventListener('objectChange', () => {
      if (!this.isGizmoDragging || this.selectedRefs.length === 0) return;
      this.applyGizmoTransformToSelection();
    });

    const helper = tc.getHelper();
    helper.renderOrder = 999;
    this.helpersGroup.add(helper);
    this.transformControls = tc;
    this.syncGizmoAttachment();
  }

  private disposeTransformControls(): void {
    if (!this.transformControls) return;
    this.transformControls.detach();
    this.helpersGroup.remove(this.transformControls.getHelper());
    this.transformControls.dispose();
    this.transformControls = null;
  }

  private applySnapSettings(tc: TransformControls | null = this.transformControls): void {
    if (!tc) return;
    tc.setTranslationSnap(this.posSnap > 0 ? this.posSnap : null);
    tc.setRotationSnap(this.rotSnapDeg > 0 ? THREE.MathUtils.degToRad(this.rotSnapDeg) : null);
    tc.setScaleSnap(this.posSnap > 0 ? 0.1 : null);
  }

  public getIsOpen(): boolean {
    return this.isOpen;
  }

  public getIsDirty(): boolean {
    return this.isDirty;
  }

  public getWorkingConfig(): StageConfig {
    return cloneStageConfig(this.workingConfig);
  }

  public getActiveProfileKey(): StageProfileKey {
    return this.activeProfileKey;
  }

  public open(existingConfig?: StageConfig | null, preserveDirtyState: boolean = false, stageId: string = 'stage1'): void {
    const state = this.app.getSimulation().state;
    const def = getStageDefinition(stageId);
    this.currentStageId = existingConfig?.stageId || def.id;
    this.activeProfileKey = state.getActiveProfileKey();

    if (existingConfig) {
      this.workingConfig = cloneStageConfig(existingConfig);
    } else if (state.activeStageConfig) {
      this.workingConfig = cloneStageConfig(state.activeStageConfig);
    } else {
      const currentProfile = state.exportCurrentProfile();
      this.workingConfig = {
        schemaVersion: 1,
        stageId: def.id,
        stageNumber: def.stageNumber,
        stageName: state.stageName || def.name,
        profiles: {
          [this.activeProfileKey]: currentProfile
        }
      };
    }

    if (!this.workingConfig.profiles[this.activeProfileKey]) {
      this.workingConfig.profiles[this.activeProfileKey] = state.exportCurrentProfile();
    }

    if (!preserveDirtyState) {
      this.isDirty = false;
      this.undoStack = [];
      this.redoStack = [];
    }

    state.applyStageConfig(this.workingConfig, this.activeProfileKey);
    this.app.rebuildStageVisualsFromState();

    const sp = this.getActiveProfile().playerSpawn;
    const spElev = state.terrain.getElevation(sp.x, sp.y).height;
    this.camFocus.set(sp.x, spElev, sp.y - 160);
    this.camYaw = 0.22;
    this.camPitch = 0.68;
    this.camDist = 660;

    this.isOpen = true;
    this.app.getInputManager().inputSuppressed = true;
    this.app.getScene().add(this.helpersGroup);
    this.rebuildSpawnRegionHelpers();
    this.rebuildCollisionOverlay();
    this.syncMarkers();

    this.mountUI();
    this.attachEvents();
    this.initTransformControls();
    this.app.setEditorMode(true, (dt, now) => this.onEditorTick(dt, now));

    if (this.selectedRefs.length === 0) {
      this.selectSingle({ category: 'player_spawn', id: 'player_spawn' });
    } else {
      this.refreshSelectionUI();
    }
    this.refreshValidationUI();
  }

  public close(): void {
    if (!this.isOpen) return;
    this.isOpen = false;
    this.pendingCatalogItem = null;
    this.detachEvents();
    this.disposeTransformControls();
    this.app.getScene().remove(this.helpersGroup);
    this.app.getInputManager().inputSuppressed = false;
    this.app.setEditorMode(false, null);
    this.rootEl?.remove();
    this.rootEl = null;
  }

  private getActiveProfile(): StageLayoutProfile {
    return this.workingConfig.profiles[this.activeProfileKey];
  }

  private refKey(ref: SelectedObjectRef): string {
    return `${ref.category}:${ref.id}`;
  }

  private getPrimarySelected(): SelectedObjectRef | null {
    return this.selectedRefs.length > 0 ? this.selectedRefs[this.selectedRefs.length - 1] : null;
  }

  private pushUndo(): void {
    const snap = JSON.parse(JSON.stringify(this.getActiveProfile())) as StageLayoutProfile;
    this.undoStack.push(snap);
    if (this.undoStack.length > MAX_UNDO_HISTORY) {
      this.undoStack.shift();
    }
    this.redoStack = [];
    this.updateUndoRedoButtons();
  }

  public undo(): void {
    if (this.undoStack.length === 0) return;
    const current = JSON.parse(JSON.stringify(this.getActiveProfile())) as StageLayoutProfile;
    this.redoStack.push(current);
    const prev = this.undoStack.pop()!;
    this.restoreProfileSnapshot(prev);
    this.setStatus('Undo applied.', false);
  }

  public redo(): void {
    if (this.redoStack.length === 0) return;
    const current = JSON.parse(JSON.stringify(this.getActiveProfile())) as StageLayoutProfile;
    this.undoStack.push(current);
    const next = this.redoStack.pop()!;
    this.restoreProfileSnapshot(next);
    this.setStatus('Redo applied.', false);
  }

  private restoreProfileSnapshot(profile: StageLayoutProfile): void {
    this.workingConfig.profiles[this.activeProfileKey] = profile;
    this.selectedRefs = this.selectedRefs.filter((r) => !!this.getObjectData(r));
    this.markDirty();
    this.app.getSimulation().state.applyStageConfig(this.workingConfig, this.activeProfileKey);
    this.app.rebuildStageVisualsFromState();
    this.rebuildSpawnRegionHelpers();
    this.rebuildCollisionOverlay();
    this.syncMarkers();
    this.syncGizmoAttachment();
    this.refreshSelectionUI();
    this.refreshValidationUI();
    this.updateUndoRedoButtons();
  }

  private disposeGroupChildren(grp: THREE.Group): void {
    while (grp.children.length > 0) {
      const child = grp.children[0];
      grp.remove(child);
      child.traverse((obj: any) => {
        if (obj.geometry) obj.geometry.dispose?.();
        if (obj.material) {
          if (Array.isArray(obj.material)) obj.material.forEach((m: any) => m.dispose?.());
          else obj.material.dispose?.();
        }
      });
    }
  }

  private rebuildSpawnRegionHelpers(): void {
    this.disposeGroupChildren(this.spawnRegionsGroup);
    const state = this.app.getSimulation().state;
    const regions = this.getActiveProfile().enemySpawnRegions || [];
    for (const reg of regions) {
      const elev = state.terrain.getElevation(reg.x, reg.y).height;
      const boxGrp = new THREE.Group();
      boxGrp.position.set(reg.x, elev + (reg.zOffset ?? 0), reg.y);
      boxGrp.userData.editorRef = { category: 'enemy_region', id: reg.id };

      const isExclude = (reg.mode || 'include') === 'exclude';
      const w = Math.max(20, reg.width);
      const h = Math.max(20, reg.height);
      const r = Math.max(20, reg.radius || Math.max(w, h) * 0.5);
      const col = !reg.enabled ? 0x64748b : isExclude ? 0xef4444 : 0x22c55e;

      const fillGeo = reg.shape === 'circle'
        ? new THREE.CylinderGeometry(r, r, 22, 28)
        : new THREE.BoxGeometry(w, 22, h);
      const fillMat = new THREE.MeshBasicMaterial({
        color: col,
        transparent: true,
        opacity: reg.enabled ? 0.16 : 0.08,
        depthWrite: false
      });
      const fillMesh = new THREE.Mesh(fillGeo, fillMat);
      fillMesh.position.y = 11;
      fillMesh.userData.editorRef = { category: 'enemy_region', id: reg.id };
      boxGrp.add(fillMesh);

      const edges = new THREE.EdgesGeometry(fillGeo);
      const lineMat = new THREE.LineBasicMaterial({ color: col, transparent: true, opacity: 0.85 });
      const wire = new THREE.LineSegments(edges, lineMat);
      wire.position.y = 11;
      boxGrp.add(wire);

      this.spawnRegionsGroup.add(boxGrp);
    }
  }

  private rebuildCollisionOverlay(): void {
    this.disposeGroupChildren(this.collisionOverlayGroup);
    this.collisionOverlayGroup.visible = this.showCollisionOverlay;
    if (!this.showCollisionOverlay) return;

    const state = this.app.getSimulation().state;
    const profile = this.getActiveProfile();
    const wireMatObs = new THREE.MeshBasicMaterial({ color: 0xf97316, wireframe: true, transparent: true, opacity: 0.45 });
    const wireMatShip = new THREE.MeshBasicMaterial({ color: 0xef4444, wireframe: true, transparent: true, opacity: 0.4 });
    const wireMatPod = new THREE.MeshBasicMaterial({ color: 0xa855f7, wireframe: true, transparent: true, opacity: 0.55 });
    const wireMatEv = new THREE.MeshBasicMaterial({ color: 0x38bdf8, wireframe: true, transparent: true, opacity: 0.35 });

    const meshCol = state.terrain.meshCollider;
    if (meshCol && meshCol.allTriangles.length > 0) {
      const tris = meshCol.allTriangles;
      const linePos: number[] = [];
      const lineCol: number[] = [];
      const tmpC = new THREE.Color();
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

      for (let i = 0; i < tris.length; i++) {
        const t = tris[i];
        tmpC.setHex(catHex(t.category));
        const y0 = t.ay + 1.5;
        const y1 = t.by + 1.5;
        const y2 = t.cy + 1.5;
        linePos.push(
          t.ax, y0, t.az, t.bx, y1, t.bz,
          t.bx, y1, t.bz, t.cx, y2, t.cz,
          t.cx, y2, t.cz, t.ax, y0, t.az
        );
        for (let k = 0; k < 6; k++) lineCol.push(tmpC.r, tmpC.g, tmpC.b);
      }

      const geo = new THREE.BufferGeometry();
      geo.setAttribute('position', new THREE.Float32BufferAttribute(linePos, 3));
      geo.setAttribute('color', new THREE.Float32BufferAttribute(lineCol, 3));
      const lines = new THREE.LineSegments(
        geo,
        new THREE.LineBasicMaterial({ vertexColors: true, transparent: true, opacity: 0.58 })
      );
      this.collisionOverlayGroup.add(lines);

      const navSegs = meshCol.getNavDebugSegments();
      if (navSegs.length > 0) {
        const navPos: number[] = [];
        const navCol: number[] = [];
        for (const s of navSegs) {
          navPos.push(s.ax, s.ay + 6, s.az, s.bx, s.by + 6, s.bz);
          const r = s.isWater ? 0.1 : 0.9;
          const g = s.isWater ? 0.85 : 0.95;
          const b = s.isWater ? 1.0 : 0.25;
          navCol.push(r, g, b, r, g, b);
        }
        const navGeo = new THREE.BufferGeometry();
        navGeo.setAttribute('position', new THREE.Float32BufferAttribute(navPos, 3));
        navGeo.setAttribute('color', new THREE.Float32BufferAttribute(navCol, 3));
        this.collisionOverlayGroup.add(
          new THREE.LineSegments(navGeo, new THREE.LineBasicMaterial({ vertexColors: true, transparent: true, opacity: 0.85 }))
        );
      }
    }

    for (const obs of profile.obstacles || []) {
      if (!obs.enabled) continue;
      const elev = state.terrain.getElevation(obs.x, obs.y).height + (obs.zOffset ?? 0);
      const r = Math.max(6, obs.radius * (obs.scaleVar || 1));
      const cyl = new THREE.Mesh(
        new THREE.CylinderGeometry(r, r, 38, 12, 1, true),
        obs.id.startsWith('ship_') || obs.id.startsWith('test_ship_') ? wireMatShip : wireMatObs
      );
      cyl.position.set(obs.x, elev + 19, obs.y);
      this.collisionOverlayGroup.add(cyl);
    }

    for (const pod of profile.pods || []) {
      if (!pod.enabled) continue;
      const elev = state.terrain.getElevation(pod.x, pod.y).height + (pod.zOffset ?? 0);
      const cyl = new THREE.Mesh(new THREE.CylinderGeometry(pod.radius || 36, pod.radius || 36, 30, 14, 1, true), wireMatPod);
      cyl.position.set(pod.x, elev + 15, pod.y);
      this.collisionOverlayGroup.add(cyl);
    }

    for (const ev of profile.worldEvents || []) {
      if (!ev.enabled) continue;
      const elev = state.terrain.getElevation(ev.x, ev.y).height + (ev.zOffset ?? 0);
      const ring = new THREE.Mesh(new THREE.CylinderGeometry(ev.radius || 110, ev.radius || 110, 12, 24, 1, true), wireMatEv);
      ring.position.set(ev.x, elev + 6, ev.y);
      this.collisionOverlayGroup.add(ring);
    }
  }

  private syncGridDimensions(worldWidth: number, worldHeight: number): void {
    const span = Math.max(3600, Math.ceil(Math.max(worldWidth, worldHeight) / 200) * 200);
    if (span !== this.lastGridSpan && this.gridHelper) {
      this.helpersGroup.remove(this.gridHelper);
      this.gridHelper.geometry.dispose();
      const oldMats = Array.isArray(this.gridHelper.material) ? this.gridHelper.material : [this.gridHelper.material];
      oldMats.forEach((m) => m.dispose());
      const divs = Math.max(36, Math.round(span / 100));
      this.gridHelper = new THREE.GridHelper(span, divs, 0x38bdf8, 0x1e3a5f);
      const mats = Array.isArray(this.gridHelper.material) ? this.gridHelper.material : [this.gridHelper.material];
      mats.forEach((m) => {
        m.transparent = true;
        m.opacity = 0.24;
        m.depthWrite = false;
      });
      this.helpersGroup.add(this.gridHelper);
      this.lastGridSpan = span;
    }
    if (this.gridHelper) {
      this.gridHelper.position.set(worldWidth * 0.5, 2, worldHeight * 0.5);
    }
  }

  private syncMarkers(): void {
    const state = this.app.getSimulation().state;
    const profile = this.getActiveProfile();
    this.syncGridDimensions(state.worldWidth, state.worldHeight);

    const sp = profile.playerSpawn;
    const spY = state.terrain.getElevation(sp.x, sp.y).height + (sp.zOffset ?? 0);
    this.playerSpawnMarker.position.set(sp.x, spY, sp.y);
    this.playerSpawnMarker.visible = this.showSpawnMarkers && sp.enabled;

    const bp = profile.bossSpawn;
    const bpY = state.terrain.getElevation(bp.x, bp.y).height + (bp.zOffset ?? 0);
    this.bossSpawnMarker.position.set(bp.x, bpY, bp.y);
    this.bossSpawnMarker.visible = this.showSpawnMarkers && bp.enabled;

    this.spawnRegionsGroup.visible = this.showSpawnMarkers;
    this.gridHelper.visible = this.showGrid;
    this.gridHelper.position.y = state.terrain.isCustomTestMap ? 105.5 : 2.0;

    const primary = this.getPrimarySelected();
    if (primary) {
      const obj = this.getObjectData(primary);
      if (obj) {
        const y = state.terrain.getElevation(obj.x, obj.y).height + obj.zOffset;
        this.selectionHighlight.position.set(obj.x, y, obj.y);
        this.selectionHighlight.visible = true;
      } else {
        this.selectionHighlight.visible = false;
      }
    } else {
      this.selectionHighlight.visible = false;
    }

    // Secondary multi-selection rings
    this.disposeGroupChildren(this.multiSelectRingsGroup);
    if (this.selectedRefs.length > 1) {
      const mat = new THREE.MeshBasicMaterial({
        color: 0x38bdf8,
        side: THREE.DoubleSide,
        transparent: true,
        opacity: 0.78,
        depthTest: false
      });
      for (let i = 0; i < this.selectedRefs.length - 1; i++) {
        const obj = this.getObjectData(this.selectedRefs[i]);
        if (!obj) continue;
        const y = state.terrain.getElevation(obj.x, obj.y).height + obj.zOffset;
        const ring = new THREE.Mesh(new THREE.RingGeometry(28, 34, 32), mat);
        ring.rotation.x = -Math.PI / 2;
        ring.position.set(obj.x, y + 1.8, obj.y);
        this.multiSelectRingsGroup.add(ring);
      }
    }
  }

  private syncGizmoAttachment(): void {
    const tc = this.transformControls;
    if (!tc) return;
    if (this.selectedRefs.length === 0 || this.toolMode === 'select' || this.toolMode === 'place') {
      tc.detach();
      return;
    }

    const modeMap: Record<'move' | 'rotate' | 'scale', 'translate' | 'rotate' | 'scale'> = {
      move: 'translate',
      rotate: 'rotate',
      scale: 'scale'
    };
    tc.setMode(modeMap[this.toolMode]);

    const state = this.app.getSimulation().state;
    const primary = this.getPrimarySelected()!;
    const pData = this.getObjectData(primary);
    if (!pData) {
      tc.detach();
      return;
    }

    if (this.selectedRefs.length === 1) {
      const h = state.terrain.getElevation(pData.x, pData.y).height + pData.zOffset;
      this.gizmoProxy.position.set(pData.x, h, pData.y);
      this.gizmoProxy.rotation.set(0, pData.rotationY, 0);
      this.gizmoProxy.scale.set(1, 1, 1);
    } else {
      let cx = 0;
      let cy = 0;
      let ch = 0;
      let count = 0;
      for (const ref of this.selectedRefs) {
        const d = this.getObjectData(ref);
        if (!d) continue;
        cx += d.x;
        cy += d.y;
        ch += state.terrain.getElevation(d.x, d.y).height + d.zOffset;
        count++;
      }
      if (count > 0) {
        this.gizmoProxy.position.set(cx / count, ch / count, cy / count);
      }
      this.gizmoProxy.rotation.set(0, 0, 0);
      this.gizmoProxy.scale.set(1, 1, 1);
    }
    this.gizmoProxy.updateMatrixWorld();
    tc.attach(this.gizmoProxy);
  }

  private captureGizmoDragBaseline(): void {
    this.gizmoStartProxyPos.copy(this.gizmoProxy.position);
    this.gizmoStartStates.clear();
    for (const ref of this.selectedRefs) {
      const d = this.getObjectData(ref);
      if (!d) continue;
      this.gizmoStartStates.set(this.refKey(ref), {
        x: d.x,
        y: d.y,
        zOffset: d.zOffset,
        rotY: d.rotationY,
        scale: d.scale,
        width: d.region?.width,
        height: d.region?.height
      });
    }
  }

  private applyGizmoTransformToSelection(): void {
    const state = this.app.getSimulation().state;
    const dx = this.gizmoProxy.position.x - this.gizmoStartProxyPos.x;
    const dy = this.gizmoProxy.position.y - this.gizmoStartProxyPos.y;
    const dz = this.gizmoProxy.position.z - this.gizmoStartProxyPos.z;
    const movedXZ = Math.abs(dx) > 0.05 || Math.abs(dz) > 0.05;

    for (const ref of this.selectedRefs) {
      const base = this.gizmoStartStates.get(this.refKey(ref));
      const d = this.getObjectData(ref);
      if (!base || !d) continue;

      if (this.toolMode === 'move') {
        const rawPos = clampWorldPos({ x: base.x + dx, y: base.y + dz }, 20, state.worldWidth, state.worldHeight);
        const nx = this.posSnap > 0 ? Math.round(rawPos.x / this.posSnap) * this.posSnap : Math.round(rawPos.x * 100) / 100;
        const ny = this.posSnap > 0 ? Math.round(rawPos.y / this.posSnap) * this.posSnap : Math.round(rawPos.y * 100) / 100;
        const nextZOff = this.autoTerrainSnap && movedXZ ? base.zOffset : Math.round((base.zOffset + dy) * 100) / 100;
        d.setCoords(nx, ny, nextZOff);
        this.applyLiveMeshTransform(ref, nx, ny, nextZOff, d.rotationY, d.scale);
      } else if (this.toolMode === 'rotate' && this.selectedRefs.length === 1) {
        const rotY = Math.round(this.gizmoProxy.rotation.y * 1000) / 1000;
        d.setProps({ rotationY: rotY });
        this.applyLiveMeshTransform(ref, d.x, d.y, d.zOffset, rotY, d.scale);
      } else if (this.toolMode === 'scale' && this.selectedRefs.length === 1) {
        if (ref.category === 'enemy_region' && d.region && base.width && base.height) {
          d.region.width = Math.max(40, Math.round(base.width * Math.abs(this.gizmoProxy.scale.x)));
          d.region.height = Math.max(40, Math.round(base.height * Math.abs(this.gizmoProxy.scale.z)));
          d.region.radius = Math.max(20, Math.round(Math.max(d.region.width, d.region.height) * 0.5));
          this.rebuildSpawnRegionHelpers();
        } else {
          const avgScale = (Math.abs(this.gizmoProxy.scale.x) + Math.abs(this.gizmoProxy.scale.y) + Math.abs(this.gizmoProxy.scale.z)) / 3;
          const nextScale = Math.max(0.15, Math.round(base.scale * avgScale * 100) / 100);
          d.setProps({ scale: nextScale });
          this.applyLiveMeshTransform(ref, d.x, d.y, d.zOffset, d.rotationY, nextScale);
        }
      }
    }

    if (this.toolMode === 'move' && this.autoTerrainSnap && movedXZ && this.selectedRefs.length === 1) {
      const only = this.getObjectData(this.selectedRefs[0]);
      if (only) {
        this.gizmoProxy.position.y = state.terrain.getElevation(only.x, only.y).height + only.zOffset;
      }
    }

    this.markDirty();
    this.syncMarkers();
    this.updateLivePropertyInputs();
  }

  private applyLiveMeshTransform(
    ref: SelectedObjectRef,
    x: number,
    y: number,
    zOffset: number,
    rotationY: number,
    scale: number
  ): void {
    const state = this.app.getSimulation().state;
    const elev = state.terrain.getElevation(x, y).height + zOffset;
    if (ref.category === 'enemy_region') {
      const grp = this.spawnRegionsGroup.children.find((c) => c.userData?.editorRef?.id === ref.id);
      if (grp) grp.position.set(x, elev, y);
      return;
    }
    const mesh = this.app.getEditorObjectMesh(ref.category, ref.id);
    if (mesh) {
      mesh.position.set(x, elev, y);
      mesh.rotation.y = rotationY;
      if (ref.category === 'obstacle') {
        // Scale visuals relative to base mesh geometry on next rebuild; live feedback still updates position/rot cleanly
        mesh.scale.setScalar(scale);
      } else {
        mesh.scale.setScalar(scale);
      }
    }
  }

  private onEditorTick(dt: number, now: number): void {
    let fwd = 0;
    let right = 0;
    if (this.keysHeld['w'] || this.keysHeld['arrowup']) fwd += 1;
    if (this.keysHeld['s'] || this.keysHeld['arrowdown']) fwd -= 1;
    if (this.keysHeld['d'] || this.keysHeld['arrowright']) right += 1;
    if (this.keysHeld['a'] || this.keysHeld['arrowleft']) right -= 1;

    if (fwd !== 0 || right !== 0) {
      const st = this.app.getSimulation().state;
      const speed = (this.keysHeld['shift'] ? 1200 : 520) * dt;
      const fx = Math.sin(this.camYaw);
      const fz = Math.cos(this.camYaw);
      const rx = Math.cos(this.camYaw);
      const rz = -Math.sin(this.camYaw);
      this.camFocus.x = Math.max(0, Math.min(st.worldWidth, this.camFocus.x + (fx * fwd - rx * right) * speed));
      this.camFocus.z = Math.max(0, Math.min(st.worldHeight, this.camFocus.z + (fz * fwd - rz * right) * speed));
      const h = st.terrain.getElevation(this.camFocus.x, this.camFocus.z).height;
      this.camFocus.y += (h - this.camFocus.y) * Math.min(1, dt * 8);
    }

    const cam = this.app.getCamera();
    const eyeX = this.camFocus.x - this.camDist * Math.sin(this.camYaw) * Math.cos(this.camPitch);
    const eyeY = this.camFocus.y + this.camDist * Math.sin(this.camPitch);
    const eyeZ = this.camFocus.z - this.camDist * Math.cos(this.camYaw) * Math.cos(this.camPitch);
    cam.position.set(eyeX, eyeY, eyeZ);
    cam.lookAt(this.camFocus.x, this.camFocus.y + 15, this.camFocus.z);
    cam.updateMatrixWorld();

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
    this.isGizmoDragging = false;
  }

  private isInputFocused(e: KeyboardEvent): boolean {
    const tag = (e.target as HTMLElement | null)?.tagName;
    return tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT';
  }

  private handleKeyDown(e: KeyboardEvent): void {
    if (!this.isOpen || this.isInputFocused(e)) return;
    const k = e.key.toLowerCase();

    if ((e.ctrlKey || e.metaKey) && k === 'z') {
      e.preventDefault();
      if (e.shiftKey) this.redo();
      else this.undo();
      return;
    }
    if ((e.ctrlKey || e.metaKey) && k === 'y') {
      e.preventDefault();
      this.redo();
      return;
    }
    if ((e.ctrlKey || e.metaKey) && k === 'd') {
      e.preventDefault();
      this.duplicateSelected();
      return;
    }
    if ((e.ctrlKey || e.metaKey) && k === 's') {
      e.preventDefault();
      void this.handleSave();
      return;
    }

    if (k === 'escape') {
      if (this.pendingCatalogItem) {
        this.cancelPlacement();
      } else {
        this.selectedRefs = [];
        this.syncMarkers();
        this.syncGizmoAttachment();
        this.refreshSelectionUI();
      }
      return;
    }
    if (k === 'delete' || k === 'backspace') {
      this.deleteSelected();
      return;
    }
    if (!e.ctrlKey && !e.metaKey) {
      if (k === '1') this.setToolMode('select');
      else if (k === '2') this.setToolMode('move');
      else if (k === '3') this.setToolMode('rotate');
      else if (k === '4') this.setToolMode('scale');
    }

    this.keysHeld[k] = true;
    if (e.key === 'Shift') this.keysHeld['shift'] = true;
  }

  private handleKeyUp(e: KeyboardEvent): void {
    const k = e.key.toLowerCase();
    this.keysHeld[k] = false;
    if (e.key === 'Shift') this.keysHeld['shift'] = false;
  }

  private handleWheel(e: WheelEvent): void {
    if (!this.isOpen) return;
    e.preventDefault();
    const factor = 1 + Math.sign(e.deltaY) * 0.12;
    this.camDist = Math.max(120, Math.min(2200, this.camDist * factor));
  }

  private setRaycasterFromPointer(clientX: number, clientY: number): void {
    const rect = this.app.getRenderer().domElement.getBoundingClientRect();
    const ndcX = ((clientX - rect.left) / rect.width) * 2 - 1;
    const ndcY = -((clientY - rect.top) / rect.height) * 2 + 1;
    this.raycaster.setFromCamera(new THREE.Vector2(ndcX, ndcY), this.app.getCamera());
  }

  private pickEditorObject(clientX: number, clientY: number): SelectedObjectRef | null {
    this.setRaycasterFromPointer(clientX, clientY);
    const targets: THREE.Object3D[] = [this.playerSpawnMarker, this.bossSpawnMarker, ...this.spawnRegionsGroup.children];
    const scene = this.app.getScene();
    scene.traverse((obj) => {
      if (obj.userData?.editorRef && !obj.userData.editorIgnored) {
        targets.push(obj);
      }
    });

    const hits = this.raycaster.intersectObjects(targets, true);
    for (const hit of hits) {
      let cur: THREE.Object3D | null = hit.object;
      while (cur) {
        if (cur.userData?.editorRef) {
          return cur.userData.editorRef as SelectedObjectRef;
        }
        cur = cur.parent;
      }
    }
    return null;
  }

  private raycastTerrainXZ(clientX: number, clientY: number): { x: number; y: number; height: number } | null {
    this.setRaycasterFromPointer(clientX, clientY);
    const terrain = this.app.getThreeTerrain();
    const isCustom = this.app.getSimulation().state.terrain.isCustomTestMap;
    const terrainTarget = isCustom ? terrain.testMapGroup : terrain.stage1Group;
    const st = this.app.getSimulation().state;
    if (terrainTarget) {
      const hits = this.raycaster.intersectObject(terrainTarget, true);
      if (hits.length > 0) {
        const pt = hits[0].point;
        const clamped = clampWorldPos({ x: pt.x, y: pt.z }, 20, st.worldWidth, st.worldHeight);
        const h = st.terrain.getElevation(clamped.x, clamped.y).height;
        return { x: clamped.x, y: clamped.y, height: h };
      }
    }
    const pt = new THREE.Vector3();
    this.dragPlane.constant = -this.camFocus.y;
    if (this.raycaster.ray.intersectPlane(this.dragPlane, pt)) {
      const clamped = clampWorldPos({ x: pt.x, y: pt.z }, 20, st.worldWidth, st.worldHeight);
      const h = st.terrain.getElevation(clamped.x, clamped.y).height;
      return { x: clamped.x, y: clamped.y, height: h };
    }
    return null;
  }

  private handleCanvasPointerDown(e: PointerEvent): void {
    if (!this.isOpen || this.isGizmoDragging) return;
    this.lastPointerX = e.clientX;
    this.lastPointerY = e.clientY;

    if (e.button === 2) {
      this.pointerMode = 'orbit';
      return;
    }
    if (e.button === 1 || (e.button === 0 && e.altKey)) {
      this.pointerMode = 'pan';
      return;
    }

    if (e.button === 0) {
      // Placement Mode
      if (this.toolMode === 'place' && this.pendingCatalogItem) {
        const pt = this.raycastTerrainXZ(e.clientX, e.clientY);
        if (pt) {
          this.placeCatalogItemAt(this.pendingCatalogItem, pt.x, pt.y);
        }
        return;
      }

      const hit = this.pickEditorObject(e.clientX, e.clientY);
      if (hit) {
        if (e.shiftKey) {
          this.toggleSelection(hit);
        } else {
          const already = this.selectedRefs.some((r) => this.refKey(r) === this.refKey(hit));
          if (!already) {
            this.selectSingle(hit);
          }
        }

        if (this.toolMode === 'select' || this.toolMode === 'move') {
          const pt = this.raycastTerrainXZ(e.clientX, e.clientY);
          if (pt) {
            this.pointerMode = 'drag_object';
            this.dragUndoPushed = false;
            this.dragAnchorWorld = { x: pt.x, y: pt.y };
            this.dragStartCenters.clear();
            for (const r of this.selectedRefs) {
              const d = this.getObjectData(r);
              if (d) this.dragStartCenters.set(this.refKey(r), { x: d.x, y: d.y, zOffset: d.zOffset });
            }
          }
        }
      } else {
        if (!e.shiftKey) {
          this.selectedRefs = [];
          this.syncMarkers();
          this.syncGizmoAttachment();
          this.refreshSelectionUI();
        }
        this.pointerMode = 'pan';
      }
    }
  }

  private handleWindowPointerMove(e: PointerEvent): void {
    if (!this.isOpen || this.isGizmoDragging) return;
    const dx = e.clientX - this.lastPointerX;
    const dy = e.clientY - this.lastPointerY;
    this.lastPointerX = e.clientX;
    this.lastPointerY = e.clientY;

    if (this.pointerMode === 'orbit') {
      this.camYaw -= dx * 0.0055;
      this.camPitch = Math.max(0.22, Math.min(1.45, this.camPitch + dy * 0.0055));
      return;
    }

    if (this.pointerMode === 'pan') {
      const st = this.app.getSimulation().state;
      const panScale = this.camDist * 0.0014;
      const fx = Math.sin(this.camYaw);
      const fz = Math.cos(this.camYaw);
      const rx = Math.cos(this.camYaw);
      const rz = -Math.sin(this.camYaw);
      this.camFocus.x = Math.max(0, Math.min(st.worldWidth, this.camFocus.x + (rx * dx + fx * dy) * panScale));
      this.camFocus.z = Math.max(0, Math.min(st.worldHeight, this.camFocus.z + (rz * dx + fz * dy) * panScale));
      this.camFocus.y = st.terrain.getElevation(this.camFocus.x, this.camFocus.z).height;
      return;
    }

    if (this.pointerMode === 'drag_object' && this.selectedRefs.length > 0) {
      const pt = this.raycastTerrainXZ(e.clientX, e.clientY);
      if (!pt) return;
      const moveX = pt.x - this.dragAnchorWorld.x;
      const moveY = pt.y - this.dragAnchorWorld.y;
      if (!this.dragUndoPushed && Math.hypot(moveX, moveY) > 0.5) {
        this.pushUndo();
        this.dragUndoPushed = true;
      }
      if (!this.dragUndoPushed) return;

      for (const r of this.selectedRefs) {
        const start = this.dragStartCenters.get(this.refKey(r));
        const d = this.getObjectData(r);
        if (!start || !d) continue;
        const clamped = clampWorldPos({ x: start.x + moveX, y: start.y + moveY });
        const nx = this.posSnap > 0 ? Math.round(clamped.x / this.posSnap) * this.posSnap : Math.round(clamped.x * 100) / 100;
        const ny = this.posSnap > 0 ? Math.round(clamped.y / this.posSnap) * this.posSnap : Math.round(clamped.y * 100) / 100;
        const nextZOff = d.placementRule === 'water' ? this.computeWaterSnapOffset(nx, ny, start.zOffset) : start.zOffset;
        d.setCoords(nx, ny, nextZOff);
        this.applyLiveMeshTransform(r, nx, ny, nextZOff, d.rotationY, d.scale);
      }

      this.markDirty();
      this.syncMarkers();
      this.syncGizmoAttachment();
      this.updateLivePropertyInputs();
    }
  }

  private handleWindowPointerUp(): void {
    if (this.pointerMode === 'drag_object' && this.dragUndoPushed) {
      this.app.getSimulation().state.applyStageConfig(this.workingConfig, this.activeProfileKey);
      this.app.rebuildStageVisualsFromState();
      this.rebuildSpawnRegionHelpers();
      this.rebuildCollisionOverlay();
      this.syncMarkers();
      this.syncGizmoAttachment();
      this.refreshValidationUI();
    }
    this.pointerMode = 'none';
    this.dragUndoPushed = false;
  }

  private computeWaterSnapOffset(x: number, y: number, fallback: number): number {
    const state = this.app.getSimulation().state;
    const terrainH = state.terrain.getElevation(x, y).height;
    const waterLevel = state.terrain.isCustomTestMap ? 105 : 5.2;
    if (terrainH < waterLevel) {
      return Math.round((waterLevel - terrainH) * 100) / 100;
    }
    return fallback;
  }

  public setToolMode(mode: EditorToolMode): void {
    if (mode !== 'place') {
      this.pendingCatalogItem = null;
    }
    this.toolMode = mode;
    this.syncGizmoAttachment();
    this.refreshToolbarButtons();
    if (mode !== 'place') {
      this.setStatus(`Tool: ${mode.toUpperCase()} • Shift+Click Multi-select • Ctrl+Z Undo • Delete Remove`, false);
    }
  }

  private selectSingle(ref: SelectedObjectRef): void {
    this.selectedRefs = [ref];
    this.syncMarkers();
    this.syncGizmoAttachment();
    this.refreshSelectionUI();
  }

  private toggleSelection(ref: SelectedObjectRef): void {
    const key = this.refKey(ref);
    const idx = this.selectedRefs.findIndex((r) => this.refKey(r) === key);
    if (idx >= 0) {
      this.selectedRefs.splice(idx, 1);
    } else {
      this.selectedRefs.push(ref);
    }
    this.syncMarkers();
    this.syncGizmoAttachment();
    this.refreshSelectionUI();
  }

  private cancelPlacement(): void {
    this.pendingCatalogItem = null;
    this.setToolMode('move');
  }

  private makeUniqueId(prefix: string): string {
    const p = this.getActiveProfile();
    const used = new Set<string>([
      'player_spawn',
      'boss_spawn',
      'overseer_teleporter',
      ...p.worldEvents.map((e) => e.id),
      ...p.pods.map((pod) => pod.id),
      ...p.obstacles.map((o) => o.id),
      ...(p.enemySpawnRegions || []).map((r) => r.id)
    ]);
    let idx = 1;
    while (used.has(`${prefix}_${idx}`)) idx++;
    return `${prefix}_${idx}`;
  }

  private placeCatalogItemAt(item: StageCatalogItem, x: number, y: number): void {
    const state = this.app.getSimulation().state;
    const clamped = clampWorldPos({ x, y }, 24, state.worldWidth, state.worldHeight);
    const rx = this.posSnap > 0 ? Math.round(clamped.x / this.posSnap) * this.posSnap : Math.round(clamped.x * 100) / 100;
    const ry = this.posSnap > 0 ? Math.round(clamped.y / this.posSnap) * this.posSnap : Math.round(clamped.y * 100) / 100;

    this.pushUndo();
    const p = this.getActiveProfile();
    let newRef: SelectedObjectRef;

    if (item.kind === 'singleton' && item.singletonCategory) {
      if (item.singletonCategory === 'player_spawn') {
        p.playerSpawn.x = rx;
        p.playerSpawn.y = ry;
        newRef = { category: 'player_spawn', id: 'player_spawn' };
      } else if (item.singletonCategory === 'boss_spawn') {
        p.bossSpawn.x = rx;
        p.bossSpawn.y = ry;
        newRef = { category: 'boss_spawn', id: 'boss_spawn' };
      } else {
        p.teleporter.x = rx;
        p.teleporter.y = ry;
        newRef = { category: 'teleporter', id: 'overseer_teleporter' };
      }
    } else if (item.kind === 'enemy_region') {
      if (!p.enemySpawnRegions) p.enemySpawnRegions = [];
      const isExclude = item.key === 'region_enemy_exclusion';
      const id = this.makeUniqueId(isExclude ? 'exclude_region' : 'spawn_region');
      const newReg: StageEnemySpawnRegionConfig = {
        id,
        name: `${isExclude ? 'Exclusion Zone' : 'Spawn Zone'} ${p.enemySpawnRegions.length + 1}`,
        mode: isExclude ? 'exclude' : 'include',
        usage: isExclude ? 'both' : 'enemy',
        shape: 'rect',
        x: rx,
        y: ry,
        radius: 260,
        width: 520,
        height: 520,
        allowedTypes: ['crawler', 'spitter', 'wasp', 'elite'],
        spawnDensity: 1,
        maxActiveEnemies: 8,
        minPlayerDistance: 420,
        terrainRestriction: 'walkable',
        minElevation: -20,
        maxElevation: 900,
        enabled: true
      };
      p.enemySpawnRegions.push(newReg);
      newRef = { category: 'enemy_region', id };
    } else if (item.kind === 'world_event') {
      const evType: WorldEventType = item.eventType || 'primal_totem';
      const id = this.makeUniqueId(`event_${evType}`);
      p.worldEvents.push({
        id,
        type: evType,
        name: item.label,
        description: item.hint,
        x: rx,
        y: ry,
        zOffset: 0,
        rotationY: 0,
        scale: 1,
        radius: 110,
        enabled: true
      });
      newRef = { category: 'world_event', id };
    } else if (item.kind === 'pod') {
      const id = this.makeUniqueId('pod');
      p.pods.push({
        id,
        name: item.label,
        x: rx,
        y: ry,
        zOffset: 0,
        rotationY: 0,
        scale: 1,
        cost: item.podCost ?? 25,
        radius: 36,
        enabled: true
      });
      newRef = { category: 'pod', id };
    } else {
      const obsType = item.obstacleType || 'rock';
      const id = this.makeUniqueId(`obs_${obsType}`);
      const zOff = item.placementRule === 'water' ? this.computeWaterSnapOffset(rx, ry, 0) : 0;
      p.obstacles.push({
        id,
        name: formatObstacleDisplayName(obsType, id, item.variant),
        type: obsType,
        variant: item.variant ?? 0,
        x: rx,
        y: ry,
        zOffset: zOff,
        rotationY: 0,
        radius: item.radius ?? 22,
        scaleVar: item.scaleVar ?? 1,
        placementRule: item.placementRule ?? 'terrain',
        enabled: true
      });
      newRef = { category: 'obstacle', id };
    }

    this.markDirty();
    this.app.getSimulation().state.applyStageConfig(this.workingConfig, this.activeProfileKey);
    this.app.rebuildStageVisualsFromState();
    this.rebuildSpawnRegionHelpers();
    this.rebuildCollisionOverlay();
    this.pendingCatalogItem = null;
    this.toolMode = 'move';
    this.selectSingle(newRef);
    this.refreshToolbarButtons();
    this.refreshValidationUI();
    this.setStatus(`Placed ${item.label} at (${Math.round(rx)}, ${Math.round(ry)}).`, false);
  }

  public duplicateSelected(): void {
    if (this.selectedRefs.length === 0) return;
    const p = this.getActiveProfile();
    const created: SelectedObjectRef[] = [];
    let pushed = false;

    for (const ref of this.selectedRefs) {
      if (ref.category === 'player_spawn' || ref.category === 'boss_spawn' || ref.category === 'teleporter') {
        continue;
      }
      if (!pushed) {
        this.pushUndo();
        pushed = true;
      }
      const st = this.app.getSimulation().state;
      if (ref.category === 'pod') {
        const src = p.pods.find((x) => x.id === ref.id);
        if (!src) continue;
        const id = this.makeUniqueId('pod');
        const c = clampWorldPos({ x: src.x + 48, y: src.y + 48 }, 20, st.worldWidth, st.worldHeight);
        p.pods.push({ ...src, id, name: `${src.name || 'Biological Pod'} Copy`, x: c.x, y: c.y });
        created.push({ category: 'pod', id });
      } else if (ref.category === 'world_event') {
        const src = p.worldEvents.find((x) => x.id === ref.id);
        if (!src) continue;
        const id = this.makeUniqueId(`event_${src.type}`);
        const c = clampWorldPos({ x: src.x + 65, y: src.y + 65 }, 20, st.worldWidth, st.worldHeight);
        p.worldEvents.push({ ...src, id, name: `${src.name} Copy`, x: c.x, y: c.y });
        created.push({ category: 'world_event', id });
      } else if (ref.category === 'obstacle') {
        const src = p.obstacles.find((x) => x.id === ref.id);
        if (!src) continue;
        const id = this.makeUniqueId(`obs_${src.type}`);
        const c = clampWorldPos({ x: src.x + 45, y: src.y + 45 }, 20, st.worldWidth, st.worldHeight);
        p.obstacles.push({ ...src, id, name: `${src.name || src.type} Copy`, x: c.x, y: c.y });
        created.push({ category: 'obstacle', id });
      } else if (ref.category === 'enemy_region') {
        const src = (p.enemySpawnRegions || []).find((x) => x.id === ref.id);
        if (!src) continue;
        const id = this.makeUniqueId('spawn_region');
        const c = clampWorldPos({ x: src.x + 80, y: src.y + 80 }, 20, st.worldWidth, st.worldHeight);
        p.enemySpawnRegions.push({ ...src, allowedTypes: [...src.allowedTypes], id, name: `${src.name} Copy`, x: c.x, y: c.y });
        created.push({ category: 'enemy_region', id });
      }
    }

    if (created.length === 0) {
      this.setStatus('Singleton spawns (Player/Boss/Teleporter) cannot be duplicated.', true);
      return;
    }

    this.selectedRefs = created;
    this.markDirty();
    this.app.getSimulation().state.applyStageConfig(this.workingConfig, this.activeProfileKey);
    this.app.rebuildStageVisualsFromState();
    this.rebuildSpawnRegionHelpers();
    this.rebuildCollisionOverlay();
    this.syncMarkers();
    this.syncGizmoAttachment();
    this.refreshSelectionUI();
    this.refreshValidationUI();
    this.setStatus(`Duplicated ${created.length} object(s).`, false);
  }

  public deleteSelected(): void {
    if (this.selectedRefs.length === 0) return;
    const p = this.getActiveProfile();
    let deleted = 0;
    let skippedSingleton = false;

    const toDelete = this.selectedRefs.filter((r) => {
      if (r.category === 'player_spawn' || r.category === 'boss_spawn' || r.category === 'teleporter') {
        skippedSingleton = true;
        return false;
      }
      return true;
    });

    if (toDelete.length === 0) {
      if (skippedSingleton) {
        this.setStatus('Required stage singletons cannot be deleted; disable or move them instead.', true);
      }
      return;
    }

    this.pushUndo();
    for (const ref of toDelete) {
      if (ref.category === 'pod') {
        const idx = p.pods.findIndex((x) => x.id === ref.id);
        if (idx >= 0) { p.pods.splice(idx, 1); deleted++; }
      } else if (ref.category === 'world_event') {
        const idx = p.worldEvents.findIndex((x) => x.id === ref.id);
        if (idx >= 0) { p.worldEvents.splice(idx, 1); deleted++; }
      } else if (ref.category === 'obstacle') {
        const idx = p.obstacles.findIndex((x) => x.id === ref.id);
        if (idx >= 0) { p.obstacles.splice(idx, 1); deleted++; }
      } else if (ref.category === 'enemy_region') {
        const idx = (p.enemySpawnRegions || []).findIndex((x) => x.id === ref.id);
        if (idx >= 0) { p.enemySpawnRegions.splice(idx, 1); deleted++; }
      }
    }

    this.selectedRefs = [];
    this.markDirty();
    this.app.getSimulation().state.applyStageConfig(this.workingConfig, this.activeProfileKey);
    this.app.rebuildStageVisualsFromState();
    this.rebuildSpawnRegionHelpers();
    this.rebuildCollisionOverlay();
    this.syncMarkers();
    this.syncGizmoAttachment();
    this.refreshSelectionUI();
    this.refreshValidationUI();
    this.setStatus(`Deleted ${deleted} object(s).${skippedSingleton ? ' (Required singletons kept)' : ''}`, false);
  }

  private getObjectData(ref: SelectedObjectRef): EditableObjectAdapter | null {
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
      const pod = p.pods.find((x) => x.id === ref.id);
      if (!pod) return null;
      return {
        name: pod.name || pod.id,
        typeLabel: 'Biological Pod (Chest)',
        x: pod.x,
        y: pod.y,
        zOffset: pod.zOffset ?? 0,
        rotationY: pod.rotationY ?? 0,
        scale: pod.scale ?? 1,
        enabled: pod.enabled,
        extraLabel: 'Biomass Cost',
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
        name: obs.name || obs.id,
        typeLabel: `Obstacle (${obs.type})`,
        x: obs.x,
        y: obs.y,
        zOffset: obs.zOffset ?? 0,
        rotationY: obs.rotationY ?? 0,
        scale: obs.scaleVar,
        enabled: obs.enabled,
        placementRule: obs.placementRule ?? 'terrain',
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
          if (patch.placementRule !== undefined) obs.placementRule = patch.placementRule;
        }
      };
    }
    if (ref.category === 'enemy_region') {
      const reg = (p.enemySpawnRegions || []).find((r) => r.id === ref.id);
      if (!reg) return null;
      return {
        name: reg.name,
        typeLabel: 'Enemy Spawn Region',
        x: reg.x,
        y: reg.y,
        zOffset: reg.zOffset ?? 0,
        rotationY: 0,
        scale: 1,
        enabled: reg.enabled,
        region: reg,
        setCoords: (x, y, zOff) => {
          reg.x = x;
          reg.y = y;
          if (zOff !== undefined) reg.zOffset = zOff;
        },
        setProps: (patch) => {
          if (patch.name !== undefined) reg.name = patch.name;
          if (patch.enabled !== undefined) reg.enabled = patch.enabled;
        }
      };
    }
    return null;
  }

  private updateLivePropertyInputs(): void {
    const body = this.rootEl?.querySelector('#dev-ed-props-body');
    const primary = this.getPrimarySelected();
    if (!body || !primary || this.selectedRefs.length !== 1) return;
    const obj = this.getObjectData(primary);
    if (!obj) return;
    const xEl = body.querySelector('#prop-x') as HTMLInputElement | null;
    const yEl = body.querySelector('#prop-y') as HTMLInputElement | null;
    const zOffEl = body.querySelector('#prop-zoff') as HTMLInputElement | null;
    const rotEl = body.querySelector('#prop-rot') as HTMLInputElement | null;
    const scEl = body.querySelector('#prop-scale') as HTMLInputElement | null;
    if (xEl) xEl.value = String(Math.round(obj.x * 100) / 100);
    if (yEl) yEl.value = String(Math.round(obj.y * 100) / 100);
    if (zOffEl) zOffEl.value = String(Math.round(obj.zOffset * 100) / 100);
    if (rotEl) rotEl.value = String(Math.round(obj.rotationY * 1000) / 1000);
    if (scEl) scEl.value = String(Math.round(obj.scale * 100) / 100);
    if (obj.region) {
      const wEl = body.querySelector('#prop-reg-w') as HTMLInputElement | null;
      const hEl = body.querySelector('#prop-reg-h') as HTMLInputElement | null;
      if (wEl) wEl.value = String(obj.region.width);
      if (hEl) hEl.value = String(obj.region.height);
    }
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

  private updateUndoRedoButtons(): void {
    const undoBtn = this.rootEl?.querySelector('#dev-ed-undo') as HTMLButtonElement | null;
    const redoBtn = this.rootEl?.querySelector('#dev-ed-redo') as HTMLButtonElement | null;
    if (undoBtn) {
      undoBtn.disabled = this.undoStack.length === 0;
      undoBtn.textContent = `↶ Undo${this.undoStack.length ? ` (${this.undoStack.length})` : ''}`;
    }
    if (redoBtn) {
      redoBtn.disabled = this.redoStack.length === 0;
      redoBtn.textContent = `↷ Redo${this.redoStack.length ? ` (${this.redoStack.length})` : ''}`;
    }
  }

  private getCurrentValidationIssues(): StageValidationIssue[] {
    const state = this.app.getSimulation().state;
    return validateStageProfile(this.getActiveProfile(), state.terrain, state.worldWidth, state.worldHeight);
  }

  private refreshValidationUI(): void {
    const issues = this.getCurrentValidationIssues();
    const errs = issues.filter((i) => i.severity === 'error').length;
    const warns = issues.filter((i) => i.severity === 'warning').length;

    const btn = this.rootEl?.querySelector('#dev-ed-validate-btn');
    if (btn) {
      if (issues.length === 0) {
        btn.textContent = '✓ Valid';
        btn.className = 'sci-btn dev-ed-btn valid-ok';
      } else {
        btn.textContent = `⚠ ${errs}E / ${warns}W`;
        btn.className = `sci-btn dev-ed-btn ${errs > 0 ? 'danger-btn' : 'primary-gold'}`;
      }
    }

    const drawer = this.rootEl?.querySelector('#dev-ed-validation-drawer');
    if (!drawer) return;
    drawer.classList.toggle('hidden', !this.showValidationDrawer);
    if (!this.showValidationDrawer) return;

    if (issues.length === 0) {
      drawer.innerHTML = `<div style="color:#6ee7b7; font-weight:600; padding:6px;">✓ Zero placement or configuration issues found.</div>`;
      return;
    }

    drawer.innerHTML = issues
      .map(
        (it, i) => `
      <button class="dev-val-item dev-ed-val-row ${it.severity}" data-idx="${i}">
        <span>[${it.severity.toUpperCase()}] ${it.message}</span>
      </button>
    `
      )
      .join('');

    drawer.querySelectorAll<HTMLButtonElement>('.dev-ed-val-row').forEach((row) => {
      row.addEventListener('click', () => {
        const idx = Number(row.dataset.idx);
        const issue = issues[idx];
        if (issue?.category && issue?.objectId) {
          const id = issue.objectId === 'teleporter' ? 'overseer_teleporter' : issue.objectId;
          const ref: SelectedObjectRef = { category: issue.category, id };
          this.selectSingle(ref);
          const data = this.getObjectData(ref);
          if (data) {
            const h = this.app.getSimulation().state.terrain.getElevation(data.x, data.y).height;
            this.camFocus.set(data.x, h, data.y);
          }
        }
      });
    });
  }

  private async handleSave(): Promise<void> {
    const issues = this.getCurrentValidationIssues();
    const errors = issues.filter((i) => i.severity === 'error');
    if (errors.length > 0) {
      this.showValidationDrawer = true;
      this.refreshValidationUI();
      this.setStatus(`Save blocked (${errors.length} error): ${errors[0].message}`, true);
      return;
    }

    this.workingConfig.updatedAt = new Date().toISOString();
    this.setStatus(`Saving to public/stages/${this.currentStageId}.config.json...`, false);
    const res = await saveStageConfigToServer(this.currentStageId, this.workingConfig);
    if (!res.ok) {
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
    const fresh = await loadStageConfigFromServer(this.currentStageId);
    if (!fresh) {
      this.setStatus(`Reload failed: could not read ${this.currentStageId}.config.json from dev server.`, true);
      return;
    }
    this.undoStack = [];
    this.redoStack = [];
    this.workingConfig = cloneStageConfig(fresh);
    this.app.getSimulation().state.applyStageConfig(this.workingConfig, this.activeProfileKey);
    this.app.rebuildStageVisualsFromState();
    this.rebuildSpawnRegionHelpers();
    this.rebuildCollisionOverlay();
    this.syncMarkers();
    this.syncGizmoAttachment();
    this.clearDirty('✓ Reloaded');
    this.refreshSelectionUI();
    this.refreshValidationUI();
    this.updateUndoRedoButtons();
    this.setStatus(`Reloaded saved ${this.currentStageId}.config.json from disk.`, false);
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
          <span class="dev-ed-title">STAGE EDITOR</span>
          <span class="dev-ed-profile">Stage ${this.workingConfig.stageNumber}: ${this.workingConfig.stageName} [${this.activeProfileKey}]</span>
          <span id="dev-ed-dirty-badge" class="dev-ed-badge ${this.isDirty ? 'dirty' : 'clean'}">${this.isDirty ? '● Unsaved Changes' : '✓ Saved'}</span>
        </div>
        <div class="dev-ed-actions">
          <div class="dev-ed-toolgroup">
            <button id="tool-select" class="sci-btn dev-ed-btn" title="Select / Drag (1)">Select</button>
            <button id="tool-move" class="sci-btn dev-ed-btn" title="Move Gizmo (2)">Move</button>
            <button id="tool-rotate" class="sci-btn dev-ed-btn" title="Rotate Gizmo (3)">Rotate</button>
            <button id="tool-scale" class="sci-btn dev-ed-btn" title="Scale Gizmo (4)">Scale</button>
          </div>
          <div class="dev-ed-toolgroup">
            <button id="dev-ed-dup" class="sci-btn dev-ed-btn" title="Duplicate Selected (Ctrl+D)">Duplicate</button>
            <button id="dev-ed-del" class="sci-btn danger-btn dev-ed-btn" title="Delete Selected (Del)">Delete</button>
            <button id="dev-ed-undo" class="sci-btn dev-ed-btn" title="Undo (Ctrl+Z)">↶ Undo</button>
            <button id="dev-ed-redo" class="sci-btn dev-ed-btn" title="Redo (Ctrl+Y)">↷ Redo</button>
          </div>
          <div class="dev-ed-toolgroup">
            <button id="dev-ed-space" class="sci-btn dev-ed-btn" title="Toggle World/Local Gizmo">World</button>
            <button id="dev-ed-snap" class="sci-btn dev-ed-btn" title="Cycle Grid & Angle Snap">Snap: OFF</button>
            <button id="dev-ed-terrain-snap" class="sci-btn dev-ed-btn" title="Auto-follow terrain elevation during XY move">Ground: ON</button>
          </div>
          <div class="dev-ed-toolgroup">
            <button id="dev-ed-toggle-grid" class="sci-btn dev-ed-btn">Grid</button>
            <button id="dev-ed-toggle-spawns" class="sci-btn dev-ed-btn">Spawns</button>
            <button id="dev-ed-toggle-cols" class="sci-btn dev-ed-btn">Colliders</button>
            <button id="dev-ed-validate-btn" class="sci-btn dev-ed-btn">Validation</button>
          </div>
          <div class="dev-ed-toolgroup">
            <button id="dev-ed-load-big-map" class="sci-btn dev-ed-btn" title="Load Big Map Stage 1 GLB into custom_map profile">🏔 Big Map</button>
            <button id="dev-ed-load-map" class="sci-btn dev-ed-btn" title="Load a custom 3D map (.glb/.gltf/.dae/.obj/.stl) to edit">📂 Load Map</button>
            <button id="dev-ed-reset-map" class="sci-btn dev-ed-btn ${this.app.isTestMapActive ? '' : 'hidden'}" title="Revert to default procedural Stage 1 terrain">↩ Default Map</button>
            <input id="dev-ed-map-file" type="file" accept=".glb,.gltf,.dae,.obj,.stl" style="display:none;" />
            <button id="dev-ed-save" class="sci-btn primary-gold dev-ed-btn">💾 Save</button>
            <button id="dev-ed-reload" class="sci-btn dev-ed-btn">↻ Reload</button>
            <button id="dev-ed-playtest" class="sci-btn dev-ed-btn" style="border-color:#22c55e; color:#86efac;">▶ Playtest</button>
            <button id="dev-ed-back" class="sci-btn danger-btn dev-ed-btn">← Menu</button>
          </div>
        </div>
      </div>

      <div class="dev-ed-left interactive">
        <div class="dev-ed-tabs">
          <button id="tab-library" class="dev-ed-tab active">+ Library</button>
          <button id="tab-hierarchy" class="dev-ed-tab">☰ Hierarchy</button>
        </div>
        <div id="dev-ed-library-pane" class="dev-ed-tab-pane">
          <input id="dev-ed-lib-search" class="dev-ed-input" type="text" placeholder="Filter library assets..." />
          <div id="dev-ed-library-list" class="dev-ed-list"></div>
        </div>
        <div id="dev-ed-hierarchy-pane" class="dev-ed-tab-pane hidden">
          <input id="dev-ed-search" class="dev-ed-input" type="text" placeholder="Search stage objects..." />
          <label class="dev-ed-chk-line"><input id="dev-ed-show-ship" type="checkbox" /> Include Ship Hull Colliders</label>
          <div id="dev-ed-hierarchy-list" class="dev-ed-list"></div>
        </div>
      </div>

      <div class="dev-ed-right interactive">
        <div class="dev-ed-panel-header">OBJECT PROPERTIES <span id="dev-ed-sel-count" style="color:#94a3b8; font-weight:400;"></span></div>
        <div id="dev-ed-props-body" class="dev-ed-props-body"></div>
      </div>

      <div id="dev-ed-validation-drawer" class="dev-ed-val-drawer interactive hidden"></div>

      <div class="dev-ed-bottom interactive">
        <span id="dev-ed-status">Click object to select • Gizmo or drag on terrain to move • Right-drag Orbit • WASD/Alt+Drag Pan • Wheel Zoom</span>
      </div>
    `;

    document.body.appendChild(root);
    this.rootEl = root;

    root.querySelector('#tool-select')?.addEventListener('click', () => this.setToolMode('select'));
    root.querySelector('#tool-move')?.addEventListener('click', () => this.setToolMode('move'));
    root.querySelector('#tool-rotate')?.addEventListener('click', () => this.setToolMode('rotate'));
    root.querySelector('#tool-scale')?.addEventListener('click', () => this.setToolMode('scale'));

    root.querySelector('#dev-ed-dup')?.addEventListener('click', () => this.duplicateSelected());
    root.querySelector('#dev-ed-del')?.addEventListener('click', () => this.deleteSelected());
    root.querySelector('#dev-ed-undo')?.addEventListener('click', () => this.undo());
    root.querySelector('#dev-ed-redo')?.addEventListener('click', () => this.redo());

    root.querySelector('#dev-ed-space')?.addEventListener('click', (ev) => {
      this.gizmoSpace = this.gizmoSpace === 'world' ? 'local' : 'world';
      this.transformControls?.setSpace(this.gizmoSpace);
      (ev.currentTarget as HTMLElement).textContent = this.gizmoSpace === 'world' ? 'World' : 'Local';
    });

    root.querySelector('#dev-ed-snap')?.addEventListener('click', (ev) => {
      const steps = [0, 10, 25, 50];
      const degs = [0, 15, 30, 45];
      const nextIdx = (steps.indexOf(this.posSnap) + 1) % steps.length;
      this.posSnap = steps[nextIdx];
      this.rotSnapDeg = degs[nextIdx];
      this.applySnapSettings();
      (ev.currentTarget as HTMLElement).textContent = this.posSnap > 0 ? `Snap: ${this.posSnap}u/${this.rotSnapDeg}°` : 'Snap: OFF';
    });

    root.querySelector('#dev-ed-terrain-snap')?.addEventListener('click', (ev) => {
      this.autoTerrainSnap = !this.autoTerrainSnap;
      (ev.currentTarget as HTMLElement).textContent = `Ground: ${this.autoTerrainSnap ? 'ON' : 'OFF'}`;
    });

    root.querySelector('#dev-ed-toggle-grid')?.addEventListener('click', () => {
      this.showGrid = !this.showGrid;
      this.syncMarkers();
      this.refreshToolbarButtons();
    });
    root.querySelector('#dev-ed-toggle-spawns')?.addEventListener('click', () => {
      this.showSpawnMarkers = !this.showSpawnMarkers;
      this.syncMarkers();
      this.refreshToolbarButtons();
    });
    root.querySelector('#dev-ed-toggle-cols')?.addEventListener('click', () => {
      this.showCollisionOverlay = !this.showCollisionOverlay;
      this.rebuildCollisionOverlay();
      this.refreshToolbarButtons();
    });
    root.querySelector('#dev-ed-validate-btn')?.addEventListener('click', () => {
      this.showValidationDrawer = !this.showValidationDrawer;
      this.refreshValidationUI();
    });

    const syncAfterMapLoad = (fileName: string, triangleCount: number) => {
      const state = this.app.getSimulation().state;
      this.activeProfileKey = state.getActiveProfileKey();
      this.workingConfig.stageName = state.stageName;
      this.workingConfig.profiles[this.activeProfileKey] = state.exportCurrentProfile();
      this.selectedRefs = [{ category: 'player_spawn', id: 'player_spawn' }];
      this.undoStack = [];
      this.redoStack = [];
      this.markDirty();
      this.app.rebuildStageVisualsFromState();
      this.rebuildSpawnRegionHelpers();
      this.rebuildCollisionOverlay();
      this.syncMarkers();
      this.syncGizmoAttachment();
      this.refreshHierarchyUI();
      this.refreshSelectionUI();
      this.refreshValidationUI();
      this.updateUndoRedoButtons();
      const profEl = this.rootEl?.querySelector('.dev-ed-profile');
      if (profEl) profEl.textContent = `Stage ${this.workingConfig.stageNumber}: ${this.workingConfig.stageName} [${this.activeProfileKey}]`;
      this.rootEl?.querySelector('#dev-ed-reset-map')?.classList.remove('hidden');
      const sp = this.getActiveProfile().playerSpawn;
      const spElev = state.terrain.getElevation(sp.x, sp.y).height;
      this.camFocus.set(sp.x, spElev, sp.y - 160);
      this.setStatus(`Loaded "${fileName}" (${triangleCount.toLocaleString()} tris) into [${this.activeProfileKey}].`, false);
    };

    root.querySelector('#dev-ed-load-big-map')?.addEventListener('click', async () => {
      this.setStatus('Loading Blenderrr.glb Stage 1...', false);
      try {
        const loaded = await this.app.loadTestMapUrl('/assets/maps/Blenderrr.glb', 'Blenderrr.glb', 'auto');
        syncAfterMapLoad(loaded.fileName, loaded.triangleCount);
      } catch (err: any) {
        this.setStatus(err?.message || 'Failed to load Blenderrr.glb.', true);
      }
    });

    const mapFileInput = root.querySelector('#dev-ed-map-file') as HTMLInputElement | null;
    root.querySelector('#dev-ed-load-map')?.addEventListener('click', () => mapFileInput?.click());
    mapFileInput?.addEventListener('change', async () => {
      const file = mapFileInput.files?.[0];
      if (!file) return;
      this.setStatus(`Loading custom map "${file.name}"...`, false);
      try {
        const loaded = await this.app.loadTestMap(file, 'auto');
        syncAfterMapLoad(loaded.fileName, loaded.triangleCount);
      } catch (err: any) {
        this.setStatus(err?.message || 'Failed to load custom map.', true);
      } finally {
        mapFileInput.value = '';
      }
    });
    root.querySelector('#dev-ed-reset-map')?.addEventListener('click', () => {
      this.app.clearTestMap();
      const state = this.app.getSimulation().state;
      this.activeProfileKey = state.getActiveProfileKey();
      this.workingConfig.stageName = state.stageName;
      if (!this.workingConfig.profiles[this.activeProfileKey]) {
        this.workingConfig.profiles[this.activeProfileKey] = state.exportCurrentProfile();
      } else {
        state.applyStageConfig(this.workingConfig, this.activeProfileKey);
      }
      this.selectedRefs = [{ category: 'player_spawn', id: 'player_spawn' }];
      this.app.rebuildStageVisualsFromState();
      this.rebuildSpawnRegionHelpers();
      this.rebuildCollisionOverlay();
      this.syncMarkers();
      this.syncGizmoAttachment();
      this.refreshHierarchyUI();
      this.refreshSelectionUI();
      this.refreshValidationUI();
      const profEl = this.rootEl?.querySelector('.dev-ed-profile');
      if (profEl) profEl.textContent = `Stage ${this.workingConfig.stageNumber}: ${this.workingConfig.stageName} [${this.activeProfileKey}]`;
      this.rootEl?.querySelector('#dev-ed-reset-map')?.classList.add('hidden');
      this.setStatus('Restored default procedural Stage 1 map.', false);
    });

    root.querySelector('#dev-ed-save')?.addEventListener('click', () => void this.handleSave());
    root.querySelector('#dev-ed-reload')?.addEventListener('click', () => void this.handleReload());
    root.querySelector('#dev-ed-playtest')?.addEventListener('click', () => {
      if (this.onPlaytestRequested) {
        this.onPlaytestRequested(this.getWorkingConfig());
      } else {
        this.setStatus('Instant Playtest Mode activates in Phase 4.', false);
      }
    });
    root.querySelector('#dev-ed-back')?.addEventListener('click', () => {
      this.close();
      this.onReturnToDashboard?.();
    });

    root.querySelector('#tab-library')?.addEventListener('click', () => this.switchLeftTab('library'));
    root.querySelector('#tab-hierarchy')?.addEventListener('click', () => this.switchLeftTab('hierarchy'));
    root.querySelector('#dev-ed-lib-search')?.addEventListener('input', () => this.refreshLibraryUI());
    root.querySelector('#dev-ed-search')?.addEventListener('input', () => this.refreshHierarchyUI());
    root.querySelector('#dev-ed-show-ship')?.addEventListener('change', (ev) => {
      this.showShipColliders = (ev.currentTarget as HTMLInputElement).checked;
      this.refreshHierarchyUI();
    });

    this.refreshLibraryUI();
    this.refreshHierarchyUI();
    this.refreshSelectionUI();
    this.refreshToolbarButtons();
    this.updateUndoRedoButtons();
  }

  private switchLeftTab(tab: 'library' | 'hierarchy'): void {
    this.rootEl?.querySelector('#tab-library')?.classList.toggle('active', tab === 'library');
    this.rootEl?.querySelector('#tab-hierarchy')?.classList.toggle('active', tab === 'hierarchy');
    this.rootEl?.querySelector('#dev-ed-library-pane')?.classList.toggle('hidden', tab !== 'library');
    this.rootEl?.querySelector('#dev-ed-hierarchy-pane')?.classList.toggle('hidden', tab !== 'hierarchy');
  }

  private refreshToolbarButtons(): void {
    if (!this.rootEl) return;
    (['select', 'move', 'rotate', 'scale'] as const).forEach((m) => {
      this.rootEl?.querySelector(`#tool-${m}`)?.classList.toggle('active-tool', this.toolMode === m);
    });
    this.rootEl.querySelector('#dev-ed-toggle-grid')?.classList.toggle('active-tool', this.showGrid);
    this.rootEl.querySelector('#dev-ed-toggle-spawns')?.classList.toggle('active-tool', this.showSpawnMarkers);
    this.rootEl.querySelector('#dev-ed-toggle-cols')?.classList.toggle('active-tool', this.showCollisionOverlay);
  }

  private refreshLibraryUI(): void {
    const listEl = this.rootEl?.querySelector('#dev-ed-library-list');
    if (!listEl) return;
    const query = ((this.rootEl?.querySelector('#dev-ed-lib-search') as HTMLInputElement | null)?.value || '').toLowerCase();

    const groups = new Map<string, StageCatalogItem[]>();
    for (const item of STAGE_OBJECT_CATALOG) {
      if (query && !`${item.label} ${item.categoryLabel} ${item.hint}`.toLowerCase().includes(query)) continue;
      if (!groups.has(item.categoryLabel)) groups.set(item.categoryLabel, []);
      groups.get(item.categoryLabel)!.push(item);
    }

    let html = '';
    for (const [cat, items] of groups.entries()) {
      html += `<div class="dev-ed-lib-cat">${cat}</div>`;
      for (const it of items) {
        const isPending = this.toolMode === 'place' && this.pendingCatalogItem?.key === it.key;
        html += `<button class="dev-ed-lib-item ${isPending ? 'active' : ''}" data-key="${it.key}" title="${it.hint}">
          <span>${it.kind === 'singleton' ? '◎' : '+'} ${it.label}</span>
        </button>`;
      }
    }
    listEl.innerHTML = html || `<div class="dev-ed-empty">No matching stage assets.</div>`;

    listEl.querySelectorAll<HTMLButtonElement>('.dev-ed-lib-item').forEach((btn) => {
      btn.addEventListener('click', () => {
        const item = STAGE_OBJECT_CATALOG.find((x) => x.key === btn.dataset.key);
        if (!item) return;
        if (item.kind === 'singleton' && item.singletonCategory) {
          const idMap = {
            player_spawn: 'player_spawn',
            teleporter: 'overseer_teleporter',
            boss_spawn: 'boss_spawn'
          };
          const ref: SelectedObjectRef = { category: item.singletonCategory, id: idMap[item.singletonCategory] };
          this.selectSingle(ref);
          const d = this.getObjectData(ref);
          if (d) {
            const h = this.app.getSimulation().state.terrain.getElevation(d.x, d.y).height;
            this.camFocus.set(d.x, h, d.y);
          }
          this.pendingCatalogItem = item;
          this.toolMode = 'place';
          this.syncGizmoAttachment();
          this.refreshLibraryUI();
          this.refreshToolbarButtons();
          this.setStatus(`Selected ${item.label}. Click terrain to reposition it, or switch to Move tool (Esc to cancel).`, false);
          return;
        }
        this.pendingCatalogItem = item;
        this.toolMode = 'place';
        this.syncGizmoAttachment();
        this.refreshLibraryUI();
        this.refreshToolbarButtons();
        this.setStatus(`Placement Ready: Click anywhere on Stage 1 terrain to place "${item.label}" (Esc to cancel).`, false);
      });
    });
  }

  private refreshHierarchyUI(): void {
    const listEl = this.rootEl?.querySelector('#dev-ed-hierarchy-list');
    if (!listEl) return;
    const query = ((this.rootEl?.querySelector('#dev-ed-search') as HTMLInputElement | null)?.value || '').toLowerCase();
    const p = this.getActiveProfile();

    const items: Array<{ ref: SelectedObjectRef; label: string; tag: string; enabled: boolean }> = [
      { ref: { category: 'player_spawn', id: 'player_spawn' }, label: p.playerSpawn.name, tag: 'SPAWN', enabled: p.playerSpawn.enabled },
      { ref: { category: 'boss_spawn', id: 'boss_spawn' }, label: p.bossSpawn.name, tag: 'BOSS', enabled: p.bossSpawn.enabled },
      { ref: { category: 'teleporter', id: 'overseer_teleporter' }, label: p.teleporter.name, tag: 'PORTAL', enabled: p.teleporter.enabled },
      ...(p.enemySpawnRegions || []).map((r) => ({ ref: { category: 'enemy_region' as const, id: r.id }, label: r.name, tag: 'ZONE', enabled: r.enabled })),
      ...p.worldEvents.map((e) => ({ ref: { category: 'world_event' as const, id: e.id }, label: e.name, tag: 'EVENT', enabled: e.enabled })),
      ...p.pods.map((pod) => ({ ref: { category: 'pod' as const, id: pod.id }, label: pod.name || pod.id, tag: 'CHEST', enabled: pod.enabled })),
      ...p.obstacles
        .filter((o) => this.showShipColliders || (!o.id.startsWith('ship_') && !o.id.startsWith('test_ship_')))
        .map((o) => ({ ref: { category: 'obstacle' as const, id: o.id }, label: o.name || o.id, tag: o.type.toUpperCase(), enabled: o.enabled }))
    ];

    const filtered = query ? items.filter((it) => `${it.label} ${it.ref.id} ${it.tag}`.toLowerCase().includes(query)) : items;
    const selectedSet = new Set(this.selectedRefs.map((r) => this.refKey(r)));

    listEl.innerHTML = filtered
      .map((it) => {
        const active = selectedSet.has(this.refKey(it.ref));
        return `<button class="dev-ed-list-item ${active ? 'active' : ''} ${it.enabled ? '' : 'disabled-item'}" data-cat="${it.ref.category}" data-id="${it.ref.id}">
          <span class="dev-ed-tag">${it.tag}</span>
          <span class="dev-ed-item-name">${it.enabled ? '' : '[OFF] '}${it.label}</span>
        </button>`;
      })
      .join('');

    listEl.querySelectorAll<HTMLButtonElement>('.dev-ed-list-item').forEach((btn) => {
      btn.addEventListener('click', (ev) => {
        const ref: SelectedObjectRef = { category: btn.dataset.cat as StageObjectCategory, id: btn.dataset.id! };
        if (ev.shiftKey) {
          this.toggleSelection(ref);
        } else {
          this.selectSingle(ref);
          const data = this.getObjectData(ref);
          if (data) {
            const elev = this.app.getSimulation().state.terrain.getElevation(data.x, data.y).height;
            this.camFocus.set(data.x, elev, data.y);
          }
        }
      });
    });
  }

  private refreshSelectionUI(): void {
    this.refreshHierarchyUI();
    const countEl = this.rootEl?.querySelector('#dev-ed-sel-count');
    if (countEl) {
      countEl.textContent = this.selectedRefs.length > 1 ? `(${this.selectedRefs.length} selected)` : '';
    }

    const body = this.rootEl?.querySelector('#dev-ed-props-body');
    if (!body) return;

    if (this.selectedRefs.length === 0) {
      const meshCol = this.app.getSimulation().state.terrain.meshCollider;
      if (!meshCol) {
        body.innerHTML = `<div class="dev-ed-empty">Select an object in the 3D viewport or Hierarchy, or pick a category asset from "+ Library" to place on terrain.</div>`;
        return;
      }
      const cats: TerrainSurfaceCategory[] = [
        'ground',
        'water',
        'waterfall_rock',
        'bridge',
        'tower_ledge',
        'ship_walkable',
        'solid_obstacle',
        'cliff',
        'border',
        'tree_nonsolid'
      ];
      const summary = meshCol.getSourceSummary();
      const prof = this.getActiveProfile();
      const rowsHtml = summary
        .map(
          (row, idx) => `<div style="display:flex; flex-direction:column; gap:3px; padding:4px 0; border-bottom:1px solid rgba(148,163,184,0.14);">
            <div style="display:flex; justify-content:space-between; font-size:10px; color:#cbd5e1;">
              <span title="${row.sourceTag}" style="overflow:hidden; text-overflow:ellipsis; white-space:nowrap; max-width:165px;">${row.sourceTag}</span>
              <span style="color:#94a3b8;">${row.triCount} tris</span>
            </div>
            <select class="dev-ed-input dev-ed-tclass-sel" data-idx="${idx}" data-tag="${row.sourceTag.replace(/"/g, '&quot;')}">
              ${cats.map((c) => `<option value="${c}" ${row.activeCategory === c ? 'selected' : ''}>${c}${c === row.defaultCategory ? ' (auto)' : ''}</option>`).join('')}
            </select>
          </div>`
        )
        .join('');

      body.innerHTML = `
        <div class="dev-ed-empty">Select an object in 3D or adjust <b>Mesh Terrain Classifications</b> below:</div>
        <div class="dev-ed-panel-header" style="margin-top:6px;">TERRAIN CLASSES (${summary.length} groups)</div>
        <div style="max-height:360px; overflow-y:auto; padding-right:2px;">${rowsHtml}</div>
        <button id="dev-ed-tclass-reset" class="sci-btn dev-ed-btn" style="margin-top:6px; width:100%;">Reset Auto Classifications</button>
      `;

      body.querySelectorAll<HTMLSelectElement>('.dev-ed-tclass-sel').forEach((sel) => {
        sel.addEventListener('change', () => {
          const tag = sel.dataset.tag!;
          const val = sel.value as TerrainSurfaceCategory;
          if (!prof.terrainOverrides) prof.terrainOverrides = {};
          const entry = summary[Number(sel.dataset.idx)];
          if (entry && val === entry.defaultCategory) {
            delete prof.terrainOverrides[tag];
          } else {
            prof.terrainOverrides[tag] = val;
          }
          meshCol.applyOverrides(prof.terrainOverrides);
          this.markDirty();
          this.rebuildCollisionOverlay();
          this.setStatus(`Terrain class "${tag}" → ${val}`, false);
        });
      });

      body.querySelector('#dev-ed-tclass-reset')?.addEventListener('click', () => {
        prof.terrainOverrides = {};
        meshCol.applyOverrides({});
        this.markDirty();
        this.rebuildCollisionOverlay();
        this.refreshSelectionUI();
        this.setStatus('Reset all terrain surface classifications to automatic.', false);
      });
      return;
    }

    if (this.selectedRefs.length > 1) {
      body.innerHTML = `
        <div class="dev-ed-empty">${this.selectedRefs.length} objects selected (Shift+Click to add/remove).<br/>Drag in viewport or use the Move gizmo to move all together.</div>
        <div style="display:flex; flex-direction:column; gap:6px; margin-top:6px;">
          <button id="multi-snap-ground" class="sci-btn dev-ed-btn">Snap All to Terrain (Y Offset = 0)</button>
          <button id="multi-dup" class="sci-btn dev-ed-btn">Duplicate Selected</button>
          <button id="multi-del" class="sci-btn danger-btn dev-ed-btn">Delete Selected</button>
        </div>
      `;
      body.querySelector('#multi-snap-ground')?.addEventListener('click', () => {
        this.pushUndo();
        for (const r of this.selectedRefs) {
          const d = this.getObjectData(r);
          if (d) d.setCoords(d.x, d.y, 0);
        }
        this.markDirty();
        this.app.getSimulation().state.applyStageConfig(this.workingConfig, this.activeProfileKey);
        this.app.rebuildStageVisualsFromState();
        this.rebuildSpawnRegionHelpers();
        this.syncMarkers();
        this.syncGizmoAttachment();
      });
      body.querySelector('#multi-dup')?.addEventListener('click', () => this.duplicateSelected());
      body.querySelector('#multi-del')?.addEventListener('click', () => this.deleteSelected());
      return;
    }

    const primary = this.selectedRefs[0];
    const obj = this.getObjectData(primary);
    if (!obj) {
      body.innerHTML = `<div class="dev-ed-empty">Selected object not found.</div>`;
      return;
    }

    const terrainSample = this.app.getSimulation().state.terrain.getElevation(obj.x, obj.y);
    const totalElev = Math.round((terrainSample.height + obj.zOffset) * 100) / 100;

    let regionHtml = '';
    if (obj.region) {
      const reg = obj.region;
      const allTypes: EnemyType[] = ['crawler', 'spitter', 'wasp', 'elite'];
      regionHtml = `
        <div class="dev-ed-panel-header" style="margin-top:6px;">SPAWN REGION RULES</div>
        <div class="dev-ed-prop-grid">
          <div><label>Mode</label>
            <select id="prop-reg-mode" class="dev-ed-input">
              <option value="include" ${(reg.mode || 'include') === 'include' ? 'selected' : ''}>Include (Green)</option>
              <option value="exclude" ${reg.mode === 'exclude' ? 'selected' : ''}>Exclude (Red)</option>
            </select>
          </div>
          <div><label>Applies To</label>
            <select id="prop-reg-usage" class="dev-ed-input">
              <option value="enemy" ${(reg.usage || 'enemy') === 'enemy' ? 'selected' : ''}>Enemies</option>
              <option value="pod" ${reg.usage === 'pod' ? 'selected' : ''}>Bio-Pods</option>
              <option value="both" ${reg.usage === 'both' ? 'selected' : ''}>Both</option>
            </select>
          </div>
          <div><label>Shape</label>
            <select id="prop-reg-shape" class="dev-ed-input">
              <option value="rect" ${reg.shape === 'rect' ? 'selected' : ''}>Rect</option>
              <option value="circle" ${reg.shape === 'circle' ? 'selected' : ''}>Circle</option>
            </select>
          </div>
          <div><label>Radius</label><input id="prop-reg-r" class="dev-ed-input" type="number" step="20" min="20" value="${reg.radius}" /></div>
          <div><label>Width</label><input id="prop-reg-w" class="dev-ed-input" type="number" step="20" min="40" value="${reg.width}" /></div>
          <div><label>Height</label><input id="prop-reg-h" class="dev-ed-input" type="number" step="20" min="40" value="${reg.height}" /></div>
          <div><label>Density</label><input id="prop-reg-density" class="dev-ed-input" type="number" step="0.1" min="0.1" value="${reg.spawnDensity}" /></div>
          <div><label>Max Active</label><input id="prop-reg-max" class="dev-ed-input" type="number" step="1" min="1" value="${reg.maxActiveEnemies}" /></div>
          <div><label>Min Player Dist</label><input id="prop-reg-mindist" class="dev-ed-input" type="number" step="20" min="80" value="${reg.minPlayerDistance}" /></div>
          <div><label>Terrain Rule</label>
            <select id="prop-reg-restrict" class="dev-ed-input">
              <option value="walkable" ${reg.terrainRestriction === 'walkable' ? 'selected' : ''}>Walkable</option>
              <option value="near_water" ${reg.terrainRestriction === 'near_water' ? 'selected' : ''}>Near Water</option>
              <option value="any" ${reg.terrainRestriction === 'any' ? 'selected' : ''}>Any</option>
            </select>
          </div>
          <div><label>Min Elev</label><input id="prop-reg-minel" class="dev-ed-input" type="number" step="10" value="${reg.minElevation}" /></div>
          <div><label>Max Elev</label><input id="prop-reg-maxel" class="dev-ed-input" type="number" step="10" value="${reg.maxElevation}" /></div>
        </div>
        <div style="font-size:10px; color:#94a3b8; margin-top:4px;">Allowed Enemy Types:</div>
        <div class="dev-ed-type-grid">
          ${allTypes
            .map(
              (t) => `<label class="dev-ed-chk-line"><input type="checkbox" class="prop-reg-type" value="${t}" ${reg.allowedTypes.includes(t) ? 'checked' : ''} /> ${t}</label>`
            )
            .join('')}
        </div>
      `;
    }

    const canDelete = primary.category !== 'player_spawn' && primary.category !== 'boss_spawn' && primary.category !== 'teleporter';

    body.innerHTML = `
      <div class="dev-ed-prop-row"><label>ID</label><input class="dev-ed-input" type="text" value="${primary.id}" disabled /></div>
      <div class="dev-ed-prop-row"><label>Type</label><input class="dev-ed-input" type="text" value="${obj.typeLabel}" disabled /></div>
      <div class="dev-ed-prop-row"><label>Name</label><input id="prop-name" class="dev-ed-input" type="text" value="${obj.name}" /></div>
      <div class="dev-ed-prop-row"><label>Enabled</label><input id="prop-enabled" type="checkbox" ${obj.enabled ? 'checked' : ''} /></div>
      <div class="dev-ed-prop-grid">
        <div><label>X</label><input id="prop-x" class="dev-ed-input" type="number" step="5" value="${obj.x}" /></div>
        <div><label>Z (World Y)</label><input id="prop-y" class="dev-ed-input" type="number" step="5" value="${obj.y}" /></div>
        <div><label>Y Offset</label><input id="prop-zoff" class="dev-ed-input" type="number" step="1" value="${obj.zOffset}" /></div>
        <div><label>Elevation (${terrainSample.surfaceType})</label><input class="dev-ed-input" type="number" value="${totalElev}" disabled /></div>
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
      ${
        obj.placementRule
          ? `<div class="dev-ed-prop-row"><label>Snap Rule</label>
              <select id="prop-rule" class="dev-ed-input">
                <option value="terrain" ${obj.placementRule === 'terrain' ? 'selected' : ''}>Ground Surface</option>
                <option value="water" ${obj.placementRule === 'water' ? 'selected' : ''}>Water / Riverbank</option>
                <option value="free" ${obj.placementRule === 'free' ? 'selected' : ''}>Free</option>
              </select>
            </div>`
          : ''
      }
      ${regionHtml}
      <div style="display:flex; gap:6px; margin-top:8px;">
        <button id="prop-snap-ground" class="sci-btn dev-ed-btn" style="flex:1;">Snap Ground</button>
        <button id="prop-focus-cam" class="sci-btn dev-ed-btn">Focus</button>
      </div>
      ${
        canDelete
          ? `<div style="display:flex; gap:6px;">
              <button id="prop-dup-one" class="sci-btn dev-ed-btn" style="flex:1;">Duplicate</button>
              <button id="prop-del-one" class="sci-btn danger-btn dev-ed-btn" style="flex:1;">Delete</button>
            </div>`
          : ''
      }
    `;

    const applyUpdate = () => {
      this.pushUndo();
      const nameVal = (body.querySelector('#prop-name') as HTMLInputElement).value;
      const enabledVal = (body.querySelector('#prop-enabled') as HTMLInputElement).checked;
      const xVal = parseFloat((body.querySelector('#prop-x') as HTMLInputElement).value);
      const yVal = parseFloat((body.querySelector('#prop-y') as HTMLInputElement).value);
      const zOffVal = parseFloat((body.querySelector('#prop-zoff') as HTMLInputElement).value);
      const rotVal = parseFloat((body.querySelector('#prop-rot') as HTMLInputElement).value);
      const scaleVal = parseFloat((body.querySelector('#prop-scale') as HTMLInputElement).value);
      const extraEl = body.querySelector('#prop-extra') as HTMLInputElement | null;
      const extraVal = extraEl ? parseFloat(extraEl.value) : undefined;
      const ruleEl = body.querySelector('#prop-rule') as HTMLSelectElement | null;

      if (Number.isFinite(xVal) && Number.isFinite(yVal)) {
        const clamped = clampWorldPos({ x: xVal, y: yVal });
        obj.setCoords(clamped.x, clamped.y, Number.isFinite(zOffVal) ? zOffVal : 0);
      }
      obj.setProps({
        name: nameVal,
        enabled: enabledVal,
        rotationY: Number.isFinite(rotVal) ? rotVal : 0,
        scale: Number.isFinite(scaleVal) ? scaleVal : 1,
        extraValue: extraVal !== undefined && Number.isFinite(extraVal) ? extraVal : undefined,
        placementRule: ruleEl ? (ruleEl.value as 'terrain' | 'water' | 'free') : undefined
      });

      if (obj.region) {
        const reg = obj.region;
        const modeEl = body.querySelector('#prop-reg-mode') as HTMLSelectElement | null;
        const usageEl = body.querySelector('#prop-reg-usage') as HTMLSelectElement | null;
        const shapeEl = body.querySelector('#prop-reg-shape') as HTMLSelectElement | null;
        const rr = parseFloat((body.querySelector('#prop-reg-r') as HTMLInputElement)?.value || '');
        const rw = parseFloat((body.querySelector('#prop-reg-w') as HTMLInputElement).value);
        const rh = parseFloat((body.querySelector('#prop-reg-h') as HTMLInputElement).value);
        const rden = parseFloat((body.querySelector('#prop-reg-density') as HTMLInputElement).value);
        const rmax = parseInt((body.querySelector('#prop-reg-max') as HTMLInputElement).value, 10);
        const rmind = parseFloat((body.querySelector('#prop-reg-mindist') as HTMLInputElement).value);
        const rminel = parseFloat((body.querySelector('#prop-reg-minel') as HTMLInputElement).value);
        const rmaxel = parseFloat((body.querySelector('#prop-reg-maxel') as HTMLInputElement).value);
        const restEl = body.querySelector('#prop-reg-restrict') as HTMLSelectElement | null;
        if (modeEl) reg.mode = modeEl.value as 'include' | 'exclude';
        if (usageEl) reg.usage = usageEl.value as 'enemy' | 'pod' | 'both';
        if (shapeEl) reg.shape = shapeEl.value as 'circle' | 'rect';
        if (Number.isFinite(rr)) reg.radius = Math.max(20, rr);
        if (restEl) reg.terrainRestriction = restEl.value as 'any' | 'walkable' | 'near_water';
        if (Number.isFinite(rw)) reg.width = Math.max(40, rw);
        if (Number.isFinite(rh)) reg.height = Math.max(40, rh);
        if (Number.isFinite(rden)) reg.spawnDensity = Math.max(0.1, rden);
        if (Number.isFinite(rmax)) reg.maxActiveEnemies = Math.max(1, rmax);
        if (Number.isFinite(rmind)) reg.minPlayerDistance = Math.max(80, rmind);
        if (Number.isFinite(rminel)) reg.minElevation = rminel;
        if (Number.isFinite(rmaxel)) reg.maxElevation = rmaxel;
        const checkedTypes: EnemyType[] = [];
        body.querySelectorAll<HTMLInputElement>('.prop-reg-type').forEach((chk) => {
          if (chk.checked) checkedTypes.push(chk.value as EnemyType);
        });
        reg.allowedTypes = checkedTypes;
      }

      this.markDirty();
      this.app.getSimulation().state.applyStageConfig(this.workingConfig, this.activeProfileKey);
      this.app.rebuildStageVisualsFromState();
      this.rebuildSpawnRegionHelpers();
      this.rebuildCollisionOverlay();
      this.syncMarkers();
      this.syncGizmoAttachment();
      this.refreshValidationUI();
    };

    body.querySelectorAll('input, select').forEach((inp) => {
      inp.addEventListener('change', () => {
        applyUpdate();
        this.refreshSelectionUI();
      });
    });

    body.querySelector('#prop-snap-ground')?.addEventListener('click', () => {
      this.pushUndo();
      const zOff = obj.placementRule === 'water' ? this.computeWaterSnapOffset(obj.x, obj.y, 0) : 0;
      obj.setCoords(obj.x, obj.y, zOff);
      this.markDirty();
      this.app.getSimulation().state.applyStageConfig(this.workingConfig, this.activeProfileKey);
      this.app.rebuildStageVisualsFromState();
      this.rebuildSpawnRegionHelpers();
      this.syncMarkers();
      this.syncGizmoAttachment();
      this.refreshSelectionUI();
      this.refreshValidationUI();
    });

    body.querySelector('#prop-focus-cam')?.addEventListener('click', () => {
      const h = this.app.getSimulation().state.terrain.getElevation(obj.x, obj.y).height;
      this.camFocus.set(obj.x, h, obj.y);
    });
    body.querySelector('#prop-dup-one')?.addEventListener('click', () => this.duplicateSelected());
    body.querySelector('#prop-del-one')?.addEventListener('click', () => this.deleteSelected());
  }
}

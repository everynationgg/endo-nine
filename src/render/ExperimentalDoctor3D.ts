import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import type { InputSnapshot, PlayerState, Vector2 } from '../sim/types';
import {
  DEFAULT_EXPERIMENTAL_TUNING,
  type ExperimentalAnimState,
  type ExperimentalInspectorSnapshot,
  type ExperimentalTuningConfig
} from './ExperimentalCommander3D';
import type { ThreeVFX } from './ThreeVFX';

const DOCTOR_GLB_DEV_URL = '/__dev/doctor-3d.glb';
const DOCTOR_BASE_SCALE = 88.0; // Matches 0.98m sculpt -> ~86u world height
const DOCTOR_RUN_BASE_SPEED = 240;

const UPPER_BODY_BONES = new Set([
  'mixamorigSpine',
  'mixamorigSpine1',
  'mixamorigSpine2',
  'mixamorigNeck',
  'mixamorigHead',
  'Hair_01',
  'Hair_02',
  'Hair_03',
  'mixamorigLeftShoulder',
  'mixamorigLeftArm',
  'mixamorigLeftForeArm',
  'mixamorigLeftHand',
  'Weapon_L',
  'Muzzle_L',
  'mixamorigRightShoulder',
  'mixamorigRightArm',
  'mixamorigRightForeArm',
  'mixamorigRightHand',
  'Weapon_R',
  'Muzzle_R'
]);

interface ClipMeta {
  clip: THREE.AnimationClip;
  sourceName: string;
  originalDuration: number;
  loop: boolean;
}

/**
 * Localhost-only 3D skeletal animation controller for Doctor (`exports/doctor_3d_animated.glb`).
 * Follows Commander's experimental 3D pipeline: zero gameplay authority changes, dev-only
 * lazy loading, full-body + upper-body dual-pistol combat overlay, secondary hair/coat sway,
 * and immediate fallback to 2D Doctor sprites on error.
 */
export class ExperimentalDoctor3D {
  public readonly group: THREE.Group;
  private readonly modelRoot: THREE.Group;
  private readonly vfx: ThreeVFX;
  private readonly onFallbackCallback: ((reason: string) => void) | null;

  private gltfScene: THREE.Object3D | null = null;
  private locoMixer: THREE.AnimationMixer | null = null;
  private combatMixer: THREE.AnimationMixer | null = null;

  private boneMap = new Map<string, THREE.Object3D>();
  private upperBodyBones: THREE.Object3D[] = [];
  private savedUpperQuats: THREE.Quaternion[] = [];

  private spineNode: THREE.Object3D | null = null;
  private spine1Node: THREE.Object3D | null = null;
  private leftArmNode: THREE.Object3D | null = null;
  private rightArmNode: THREE.Object3D | null = null;
  private hairNodes: THREE.Object3D[] = [];
  private coatNodes: THREE.Object3D[] = [];
  private muzzleLNode: THREE.Object3D | null = null;
  private muzzleRNode: THREE.Object3D | null = null;

  private modelMaterials: THREE.MeshStandardMaterial[] = [];
  private modelGeometries: THREE.BufferGeometry[] = [];
  private modelTextures: THREE.Texture[] = [];

  private importedClips: THREE.AnimationClip[] = [];
  private clipRegistry = new Map<string, ClipMeta>();
  private locoActions = new Map<string, THREE.AnimationAction>();
  private combatActions = new Map<string, THREE.AnimationAction>();

  public isLoading = false;
  public isReady = false;
  public hasLoadError = false;
  public loadError: string | null = null;
  private loadPromise: Promise<boolean> | null = null;

  private boneCount = 0;
  private meshCount = 0;
  private triangleCount = 0;

  public tuning: ExperimentalTuningConfig;
  private currentState: ExperimentalAnimState = 'idle';
  private upperOverlayState: 'none' | 'lmb' | 'rmb' = 'none';
  private activeLocoKey = '';
  private activeCombatKey = '';
  private activeClipDisplayName = '';
  private activeOriginalDuration = 0;
  private activeEffectiveDuration = 0;
  private activePlaybackSpeed = 1;
  private activeIsLooping = true;

  private currentYaw = 0;
  private targetYaw = 0;
  private lmbTimer = 0;
  private lmbDuration = 0.24;
  private recoilLTimer = 0;
  private recoilRTimer = 0;
  private rmbTimer = 0;
  private rmbDuration = 0.42;
  private ultTimer = 0;
  private ultDuration = 0.80;
  private dashTimer = 0;
  private dashDuration = 0.26;
  private dashStreakTimer = 0;
  private jumpTakeoffTimer = 0;
  private jumpLandTimer = 0;
  private hitTimer = 0;
  private hasGlidedInAir = false;
  private wasGrounded = true;
  private isDead = false;

  private prevWorldX = 0;
  private prevWorldY = 0;
  private hasPrevWorldPos = false;
  private smoothedHorizSpeed = 0;
  private aimOverrideTarget: Vector2 | null = null;
  private aimOverrideTimer = 0;
  private upperOverlayWeight = 0;

  private previewState: ExperimentalAnimState | null = null;
  private previewTimer = 0;
  private isPausedPreview = false;

  // Dash trail pool (emerald/white)
  private dashStreakMeshes: Array<{ mesh: THREE.Mesh; life: number; maxLife: number }> = [];
  private readonly dashStreakGeo = new THREE.BoxGeometry(10, 44, 16);

  // Pre-allocated scratch math objects (zero GC churn)
  private readonly scratchAxisX = new THREE.Vector3(1, 0, 0);
  private readonly scratchAxisY = new THREE.Vector3(0, 1, 0);
  private readonly scratchQuat = new THREE.Quaternion();
  private readonly scratchWhite = new THREE.Color(0xffffff);
  private readonly scratchHitTint = new THREE.Color(0xff5555);
  private readonly scratchMuzzlePos = new THREE.Vector3();

  constructor(vfx: ThreeVFX, onFallback?: (reason: string) => void) {
    this.vfx = vfx;
    this.onFallbackCallback = onFallback || null;
    this.tuning = {
      ...DEFAULT_EXPERIMENTAL_TUNING,
      speedMultipliers: { ...DEFAULT_EXPERIMENTAL_TUNING.speedMultipliers }
    };

    this.group = new THREE.Group();
    this.group.name = 'ExperimentalDoctor3D_Group';
    this.group.visible = false;

    this.modelRoot = new THREE.Group();
    this.modelRoot.name = 'ExperimentalDoctor3D_ModelRoot';
    this.group.add(this.modelRoot);
  }

  public async ensureLoaded(): Promise<boolean> {
    if (!import.meta.env.DEV) return false;
    if (this.isReady) return true;
    if (this.loadPromise) return this.loadPromise;

    this.isLoading = true;
    this.hasLoadError = false;
    this.loadError = null;

    this.loadPromise = this.loadInternal();
    return this.loadPromise;
  }

  private async loadInternal(): Promise<boolean> {
    try {
      const loader = new GLTFLoader();
      const gltf = await loader.loadAsync(DOCTOR_GLB_DEV_URL);

      const scene = gltf.scene;
      if (!scene) throw new Error('Doctor 3D GLB missing scene');

      this.importedClips = gltf.animations || [];
      if (this.importedClips.length === 0) {
        throw new Error('Doctor 3D GLB contains zero animation clips');
      }

      const boneSet = new Set<string>();
      scene.traverse((obj) => {
        if ((obj as THREE.Bone).isBone) {
          boneSet.add(obj.name);
          this.boneMap.set(obj.name, obj);
          if (UPPER_BODY_BONES.has(obj.name)) {
            this.upperBodyBones.push(obj);
            this.savedUpperQuats.push(new THREE.Quaternion());
          }
        }
        if ((obj as THREE.Mesh).isMesh) {
          const mesh = obj as THREE.Mesh;
          mesh.frustumCulled = false;
          mesh.castShadow = false;
          mesh.receiveShadow = false;
          this.meshCount++;
          if (mesh.geometry) {
            this.modelGeometries.push(mesh.geometry);
            const idx = mesh.geometry.getIndex();
            const pos = mesh.geometry.getAttribute('position');
            if (idx) this.triangleCount += Math.floor(idx.count / 3);
            else if (pos) this.triangleCount += Math.floor(pos.count / 3);
          }
          const mats = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
          for (const m of mats) {
            const sm = m as THREE.MeshStandardMaterial;
            if (!sm) continue;
            if (sm.map) {
              sm.map.colorSpace = THREE.SRGBColorSpace;
              this.modelTextures.push(sm.map);
            }
            if (sm.normalMap) this.modelTextures.push(sm.normalMap);
            sm.roughness = 0.62;
            sm.metalness = 0.08;
            this.modelMaterials.push(sm);
          }
        }
      });
      this.boneCount = boneSet.size;

      this.spineNode = this.boneMap.get('mixamorigSpine') || null;
      this.spine1Node = this.boneMap.get('mixamorigSpine1') || null;
      this.leftArmNode = this.boneMap.get('mixamorigLeftArm') || null;
      this.rightArmNode = this.boneMap.get('mixamorigRightArm') || null;
      this.muzzleLNode = this.boneMap.get('Muzzle_L') || null;
      this.muzzleRNode = this.boneMap.get('Muzzle_R') || null;
      this.hairNodes = ['Hair_01', 'Hair_02', 'Hair_03']
        .map((n) => this.boneMap.get(n))
        .filter((b): b is THREE.Object3D => Boolean(b));
      this.coatNodes = ['Coat_FL', 'Coat_FR', 'Coat_BL', 'Coat_BR']
        .map((n) => this.boneMap.get(n))
        .filter((b): b is THREE.Object3D => Boolean(b));

      this.gltfScene = scene;
      this.modelRoot.add(scene);
      this.applyTransformTuning();

      this.locoMixer = new THREE.AnimationMixer(scene);
      this.combatMixer = new THREE.AnimationMixer(scene);
      this.buildClipBindings();

      this.isReady = true;
      this.isLoading = false;
      this.playLocoClip('idle', 1.0, 0.02, true);
      console.info(
        `[ExperimentalDoctor3D] Loaded ${this.importedClips.length} clips, ${this.boneCount} bones, ${this.meshCount} meshes (${this.triangleCount.toLocaleString()} tris).`
      );
      return true;
    } catch (err: any) {
      const msg = err?.message || 'Failed to load Doctor 3D GLB.';
      console.warn('[ExperimentalDoctor3D] Load failed, falling back to 2D:', msg);
      this.isReady = false;
      this.isLoading = false;
      this.hasLoadError = true;
      this.loadError = msg;
      this.onFallbackCallback?.(msg);
      return false;
    }
  }

  private findClip(name: string): THREE.AnimationClip | null {
    return (
      this.importedClips.find((c) => c.name === name) ||
      this.importedClips.find((c) => c.name.toLowerCase() === name.toLowerCase()) ||
      null
    );
  }

  private extractUpperClip(src: THREE.AnimationClip, name: string): THREE.AnimationClip {
    const tracks = src.tracks.filter((tr) => {
      const dot = tr.name.lastIndexOf('.');
      const node = dot >= 0 ? tr.name.slice(0, dot) : tr.name;
      return UPPER_BODY_BONES.has(node);
    });
    return new THREE.AnimationClip(name, src.duration, tracks);
  }

  private buildClipBindings(): void {
    const mappings: Array<{ key: string; clipName: string; loop: boolean }> = [
      { key: 'idle', clipName: 'Idle', loop: true },
      { key: 'walk', clipName: 'Walk', loop: true },
      { key: 'run', clipName: 'Run', loop: true },
      { key: 'jump_takeoff', clipName: 'Jump_Takeoff', loop: false },
      { key: 'jump_ascend', clipName: 'Jump_Ascend', loop: true },
      { key: 'jump_descend', clipName: 'Jump_Descend', loop: true },
      { key: 'jump_land', clipName: 'Jump_Land', loop: false },
      { key: 'glide', clipName: 'Glide', loop: true },
      { key: 'lmb_clip2', clipName: 'LMB_Shoot', loop: true },
      { key: 'rmb', clipName: 'RMB_Throw', loop: false },
      { key: 'dash', clipName: 'Dash', loop: false },
      { key: 'ultimate_clip1', clipName: 'Ultimate_Cast', loop: false },
      { key: 'hit', clipName: 'Hit_React', loop: false },
      { key: 'death', clipName: 'Death', loop: false }
    ];

    for (const m of mappings) {
      const clip = this.findClip(m.clipName) || this.importedClips[0];
      this.clipRegistry.set(m.key, {
        clip,
        sourceName: clip.name,
        originalDuration: clip.duration,
        loop: m.loop
      });
      if (this.locoMixer) {
        const act = this.locoMixer.clipAction(clip);
        act.setLoop(m.loop ? THREE.LoopRepeat : THREE.LoopOnce, m.loop ? Infinity : 1);
        act.clampWhenFinished = !m.loop;
        this.locoActions.set(m.key, act);
      }
    }

    const lmbSrc = this.findClip('LMB_Shoot');
    const rmbSrc = this.findClip('RMB_Throw');
    if (this.combatMixer && lmbSrc) {
      const upperLmb = this.extractUpperClip(lmbSrc, 'Doctor_Upper_LMB');
      const act = this.combatMixer.clipAction(upperLmb);
      act.setLoop(THREE.LoopRepeat, Infinity);
      this.combatActions.set('lmb_upper', act);
    }
    if (this.combatMixer && rmbSrc) {
      const upperRmb = this.extractUpperClip(rmbSrc, 'Doctor_Upper_RMB');
      const act = this.combatMixer.clipAction(upperRmb);
      act.setLoop(THREE.LoopOnce, 1);
      act.clampWhenFinished = true;
      this.combatActions.set('rmb_upper', act);
    }
  }

  public applyTransformTuning(): void {
    const scale = DOCTOR_BASE_SCALE * Math.max(0.35, Math.min(2.5, this.tuning.scaleMultiplier));
    this.modelRoot.scale.setScalar(scale);
    this.modelRoot.position.set(0, this.tuning.verticalOffset, 0);
  }

  public getMuzzleWorldPosition(hand: 'left' | 'right', out: THREE.Vector3): THREE.Vector3 {
    const node = hand === 'left' ? this.muzzleLNode : this.muzzleRNode;
    if (node && this.isReady) {
      node.getWorldPosition(out);
      return out;
    }
    return this.group.getWorldPosition(out).setY(out.y + 48);
  }

  public triggerLMB(duration: number = 0.24, targetPos?: Vector2, hand?: 'left' | 'right'): void {
    if (this.isDead || !this.isReady) return;
    this.lmbDuration = Math.max(0.10, duration);
    this.lmbTimer = this.lmbDuration;
    if (hand === 'left') this.recoilLTimer = 0.14;
    else if (hand === 'right') this.recoilRTimer = 0.14;
    else {
      if (this.recoilLTimer <= this.recoilRTimer) this.recoilLTimer = 0.14;
      else this.recoilRTimer = 0.14;
    }
    if (targetPos) {
      this.aimOverrideTarget = { x: targetPos.x, y: targetPos.y };
      this.aimOverrideTimer = Math.max(this.aimOverrideTimer, this.lmbDuration + 0.08);
    }
    if (this.currentState === 'run' || this.currentState === 'glide' || this.currentState.startsWith('jump_')) {
      this.startCombatOverlay('lmb');
    } else if (this.currentState !== 'ultimate' && this.currentState !== 'dash') {
      this.playLmbFullBody(false);
    }
  }

  public triggerRMB(duration: number = 0.38, slashAngle?: number, targetPos?: Vector2): void {
    if (this.isDead || !this.isReady) return;
    this.rmbDuration = Math.max(0.18, duration);
    this.rmbTimer = this.rmbDuration;
    if (targetPos) {
      this.aimOverrideTarget = { x: targetPos.x, y: targetPos.y };
      this.aimOverrideTimer = Math.max(this.aimOverrideTimer, this.rmbDuration + 0.12);
    } else if (slashAngle !== undefined) {
      this.targetYaw = Math.atan2(Math.cos(slashAngle), Math.sin(slashAngle));
    }
    if (this.currentState === 'run' || this.currentState === 'glide' || this.currentState.startsWith('jump_')) {
      this.startCombatOverlay('rmb');
    } else if (this.currentState !== 'ultimate' && this.currentState !== 'dash') {
      this.playRmbFullBody(true);
    }
  }

  public triggerDash(duration: number = 0.26, dashDir?: Vector2): void {
    if (this.isDead || !this.isReady) return;
    this.dashDuration = Math.max(0.14, duration);
    this.dashTimer = this.dashDuration;
    this.dashStreakTimer = 0;
    if (dashDir && (dashDir.x !== 0 || dashDir.y !== 0)) {
      this.targetYaw = Math.atan2(dashDir.x, dashDir.y);
      this.currentYaw = this.targetYaw;
    }
    this.stopCombatOverlay();
    this.playDashClip(true);
  }

  public triggerUltimate(duration: number = 0.80, targetPos?: Vector2): void {
    if (this.isDead || !this.isReady) return;
    this.ultDuration = Math.max(0.45, duration);
    this.ultTimer = this.ultDuration;
    if (targetPos) {
      this.aimOverrideTarget = { x: targetPos.x, y: targetPos.y };
      this.aimOverrideTimer = this.ultDuration;
    }
    this.stopCombatOverlay();
    this.playUltimateClip(true);
  }

  public triggerJump(isAirJump: boolean = false): void {
    if (this.isDead || !this.isReady) return;
    this.jumpLandTimer = 0;
    if (isAirJump) {
      this.jumpTakeoffTimer = 0;
      if (this.currentState !== 'ultimate' && this.currentState !== 'dash') {
        this.playLocoClip('jump_ascend', this.tuning.speedMultipliers.jump, 0.08, true);
      }
    } else {
      this.jumpTakeoffTimer = 0.14;
      if (this.currentState !== 'ultimate' && this.currentState !== 'dash') {
        this.playLocoClip('jump_takeoff', 1.15 * this.tuning.speedMultipliers.jump, 0.06, true);
      }
    }
  }

  public triggerGlideStart(): void {
    if (this.isDead || !this.isReady) return;
    this.hasGlidedInAir = true;
    this.jumpTakeoffTimer = 0;
    this.jumpLandTimer = 0;
  }

  public triggerLand(): void {
    if (this.isDead || !this.isReady) return;
    this.hasGlidedInAir = false;
    this.jumpTakeoffTimer = 0;
    this.jumpLandTimer = 0.14;
  }

  public triggerHit(duration: number = 0.18): void {
    if (this.isDead || !this.isReady) return;
    this.hitTimer = Math.max(this.hitTimer, duration);
  }

  public triggerDeath(): void {
    if (!this.isReady) return;
    this.isDead = true;
    this.stopCombatOverlay();
    this.playLocoClip('death', 1.0, 0.12, false);
  }

  public reset(): void {
    this.isDead = false;
    this.hasGlidedInAir = false;
    this.wasGrounded = true;
    this.hasPrevWorldPos = false;
    this.smoothedHorizSpeed = 0;
    this.lmbTimer = 0;
    this.recoilLTimer = 0;
    this.recoilRTimer = 0;
    this.rmbTimer = 0;
    this.ultTimer = 0;
    this.dashTimer = 0;
    this.jumpTakeoffTimer = 0;
    this.jumpLandTimer = 0;
    this.hitTimer = 0;
    this.aimOverrideTarget = null;
    this.aimOverrideTimer = 0;
    this.previewState = null;
    this.isPausedPreview = false;
    this.upperOverlayState = 'none';
    this.upperOverlayWeight = 0;
    this.clearDashStreaks();
    this.applyHitFlashTint(0);
    if (this.isReady) {
      this.playLocoClip('idle', 1.0, 0.05, true);
    }
  }

  public triggerPreviewState(state: ExperimentalAnimState): void {
    if (!this.isReady) return;
    this.previewState = state;
    this.isPausedPreview = false;
    this.stopCombatOverlay();
    if (state === 'dash') {
      this.previewTimer = 0.65;
      this.playDashClip(true);
    } else if (state === 'lmb') {
      this.previewTimer = 0.65;
      this.lmbTimer = 0.65;
      this.playLmbFullBody(true);
    } else if (state === 'rmb') {
      this.previewTimer = 0.75;
      this.rmbTimer = 0.75;
      this.playRmbFullBody(true);
    } else if (state === 'ultimate') {
      this.previewTimer = 1.4;
      this.ultTimer = 1.4;
      this.playUltimateClip(true);
    } else if (state === 'jump_takeoff' || state === 'jump_land' || state === 'hit' || state === 'death') {
      this.previewTimer = 0.85;
      this.playLocoClip(state, this.tuning.speedMultipliers.jump, this.tuning.crossfadeDuration, true);
    } else {
      this.previewTimer = 3.0;
      const mult =
        state === 'run'
          ? this.tuning.runCadence * this.tuning.speedMultipliers.run
          : state === 'glide'
            ? this.tuning.speedMultipliers.glide
            : state.startsWith('jump_')
              ? this.tuning.speedMultipliers.jump
              : this.tuning.speedMultipliers.idle;
      this.playLocoClip(state, mult, this.tuning.crossfadeDuration, true);
    }
  }

  public clearPreview(): void {
    this.previewState = null;
    this.previewTimer = 0;
    this.isPausedPreview = false;
  }

  public setPreviewPaused(paused: boolean): void {
    this.isPausedPreview = paused;
  }

  public getInspectorSnapshot(): ExperimentalInspectorSnapshot {
    return {
      loaded: this.isReady,
      loading: this.isLoading,
      loadError: this.loadError,
      clipCount: this.importedClips.length,
      boneCount: this.boneCount,
      meshCount: this.meshCount,
      triangleCount: this.triangleCount,
      currentState: this.currentState,
      upperOverlayState: this.upperOverlayState,
      activeClipName: this.activeClipDisplayName,
      originalDuration: this.activeOriginalDuration,
      effectiveDuration: this.activeEffectiveDuration,
      playbackSpeed: this.activePlaybackSpeed,
      isLooping: this.activeIsLooping,
      isPausedPreview: this.isPausedPreview,
      previewState: this.previewState,
      importedClipNames: this.importedClips.map((c) => c.name)
    };
  }

  public update(
    dt: number,
    p: PlayerState,
    input: InputSnapshot,
    aimWorldPos: Vector2,
    nowMs: number
  ): void {
    if (!this.isReady || !this.locoMixer) return;
    this.applyTransformTuning();
    this.updateDashStreaks(dt);

    if (this.previewState) {
      if (!this.isPausedPreview) {
        this.previewTimer -= dt;
        this.locoMixer.update(dt);
        if (this.previewTimer <= 0) this.previewState = null;
      }
      return;
    }

    if (this.lmbTimer > 0) this.lmbTimer = Math.max(0, this.lmbTimer - dt);
    if (this.recoilLTimer > 0) this.recoilLTimer = Math.max(0, this.recoilLTimer - dt);
    if (this.recoilRTimer > 0) this.recoilRTimer = Math.max(0, this.recoilRTimer - dt);
    if (this.rmbTimer > 0) this.rmbTimer = Math.max(0, this.rmbTimer - dt);
    if (this.ultTimer > 0) this.ultTimer = Math.max(0, this.ultTimer - dt);
    if (this.dashTimer > 0) this.dashTimer = Math.max(0, this.dashTimer - dt);
    if (this.jumpTakeoffTimer > 0) this.jumpTakeoffTimer = Math.max(0, this.jumpTakeoffTimer - dt);
    if (this.jumpLandTimer > 0) this.jumpLandTimer = Math.max(0, this.jumpLandTimer - dt);
    if (this.hitTimer > 0) this.hitTimer = Math.max(0, this.hitTimer - dt);
    if (this.aimOverrideTimer > 0) {
      this.aimOverrideTimer = Math.max(0, this.aimOverrideTimer - dt);
      if (this.aimOverrideTimer <= 0) this.aimOverrideTarget = null;
    }

    if (p.isGrounded && !this.wasGrounded) {
      this.hasGlidedInAir = false;
      this.jumpTakeoffTimer = 0;
      if (this.jumpLandTimer <= 0) this.jumpLandTimer = 0.14;
    } else if (!p.isGrounded && p.isGliding) {
      this.hasGlidedInAir = true;
    }
    this.wasGrounded = p.isGrounded;

    const dispX = this.hasPrevWorldPos ? p.pos.x - this.prevWorldX : 0;
    const dispY = this.hasPrevWorldPos ? p.pos.y - this.prevWorldY : 0;
    const dispDist = Math.hypot(dispX, dispY);
    const instantSpeed = dt > 0.0001 && this.hasPrevWorldPos ? dispDist / dt : 0;
    this.prevWorldX = p.pos.x;
    this.prevWorldY = p.pos.y;
    this.hasPrevWorldPos = true;
    this.smoothedHorizSpeed += (instantSpeed - this.smoothedHorizSpeed) * Math.min(1.0, dt * 16);

    const hasMoveInput = input.moveDir.x !== 0 || input.moveDir.y !== 0;
    const horizSpeed = Math.max(this.smoothedHorizSpeed, Math.hypot(p.velocity.x, p.velocity.y));
    const isMovingGround = p.isGrounded && (hasMoveInput || horizSpeed > 28);
    const isDeadNow = this.isDead || p.health <= 0;

    // 360-degree lower-body / dash steering + independent upper-body combat aiming
    let aimYaw = this.currentYaw;
    const aimPt = this.aimOverrideTarget || aimWorldPos;
    const adx = aimPt.x - p.pos.x;
    const adz = aimPt.y - p.pos.y;
    if (Math.hypot(adx, adz) > 2) {
      aimYaw = Math.atan2(adx, adz);
    }

    if (!isDeadNow) {
      if (this.ultTimer > 0 || ((this.lmbTimer > 0 || this.rmbTimer > 0) && !isMovingGround)) {
        this.targetYaw = aimYaw;
      } else if (p.isDashing && (p.dashDir.x !== 0 || p.dashDir.y !== 0)) {
        this.targetYaw = Math.atan2(p.dashDir.x, p.dashDir.y);
      } else if (dispDist > 0.25) {
        this.targetYaw = Math.atan2(dispX, dispY);
      } else if (hasMoveInput) {
        const rx = input.moveDir.x;
        const rz = -input.moveDir.y;
        if (input.cameraRight && input.cameraForward) {
          const wx = input.cameraRight.x * rx + input.cameraForward.x * rz;
          const wy = input.cameraRight.y * rx + input.cameraForward.y * rz;
          if (Math.hypot(wx, wy) > 0.01) this.targetYaw = Math.atan2(wx, wy);
        } else {
          this.targetYaw = Math.atan2(rx, -rz);
        }
      }

      let diff = this.targetYaw - this.currentYaw;
      while (diff < -Math.PI) diff += Math.PI * 2;
      while (diff > Math.PI) diff -= Math.PI * 2;
      this.currentYaw += diff * Math.min(1.0, dt * 18);
      this.modelRoot.rotation.y = this.currentYaw + THREE.MathUtils.degToRad(this.tuning.yawOffsetDeg);
    }

    let targetState: ExperimentalAnimState = 'idle';
    if (isDeadNow) {
      targetState = 'death';
      this.isDead = true;
    } else if (this.ultTimer > 0) {
      targetState = 'ultimate';
    } else if (p.isDashing || this.dashTimer > 0) {
      targetState = 'dash';
    } else if (!p.isGrounded && p.isGliding) {
      targetState = 'glide';
    } else if (!p.isGrounded) {
      if (this.jumpTakeoffTimer > 0) targetState = 'jump_takeoff';
      else if (p.vz >= 0 && !this.hasGlidedInAir) targetState = 'jump_ascend';
      else targetState = 'jump_descend';
    } else if (this.jumpLandTimer > 0 && !isMovingGround && this.lmbTimer <= 0 && this.rmbTimer <= 0) {
      targetState = 'jump_land';
    } else if (isMovingGround) {
      targetState = 'run';
    } else if (this.rmbTimer > 0) {
      targetState = 'rmb';
    } else if (this.lmbTimer > 0) {
      targetState = 'lmb';
    } else if (this.hitTimer > 0) {
      targetState = 'hit';
    } else {
      targetState = 'idle';
    }

    const canLayerCombat =
      targetState === 'run' ||
      targetState === 'glide' ||
      targetState === 'jump_takeoff' ||
      targetState === 'jump_ascend' ||
      targetState === 'jump_descend';

    if (targetState === 'run') {
      const speedScale = THREE.MathUtils.clamp(
        (horizSpeed / DOCTOR_RUN_BASE_SPEED) * this.tuning.runCadence * this.tuning.speedMultipliers.run,
        0.60,
        2.6
      );
      if (this.currentState !== 'run') this.playLocoClip('run', speedScale, this.tuning.crossfadeDuration, false);
      else this.updateActiveLocoSpeed(speedScale);
    } else if (targetState === 'glide') {
      const gs = this.tuning.speedMultipliers.glide;
      if (this.currentState !== 'glide') this.playLocoClip('glide', gs, this.tuning.crossfadeDuration, false);
      else this.updateActiveLocoSpeed(gs);
    } else if (targetState === 'jump_takeoff') {
      if (this.currentState !== 'jump_takeoff') this.playLocoClip('jump_takeoff', 1.15 * this.tuning.speedMultipliers.jump, 0.06, false);
    } else if (targetState === 'jump_ascend') {
      if (this.currentState !== 'jump_ascend') this.playLocoClip('jump_ascend', this.tuning.speedMultipliers.jump, 0.10, false);
    } else if (targetState === 'jump_descend') {
      if (this.currentState !== 'jump_descend') this.playLocoClip('jump_descend', this.tuning.speedMultipliers.jump, 0.12, false);
    } else if (targetState === 'jump_land') {
      if (this.currentState !== 'jump_land') this.playLocoClip('jump_land', this.tuning.speedMultipliers.jump, 0.06, true);
    } else if (targetState === 'dash') {
      if (this.currentState !== 'dash') this.playDashClip(false);
      this.dashStreakTimer -= dt;
      if (this.dashStreakTimer <= 0) {
        this.dashStreakTimer = 0.032;
        this.spawnDashStreak(p);
      }
    } else if (targetState === 'ultimate') {
      if (this.currentState !== 'ultimate') this.playUltimateClip(false);
    } else if (targetState === 'rmb') {
      if (this.currentState !== 'rmb') this.playRmbFullBody(false);
    } else if (targetState === 'lmb') {
      if (this.currentState !== 'lmb') this.playLmbFullBody(false);
    } else if (targetState === 'hit') {
      if (this.currentState !== 'hit') this.playLocoClip('hit', 1.0, 0.06, true);
    } else if (targetState === 'death') {
      if (this.currentState !== 'death') this.playLocoClip('death', 1.0, 0.12, true);
    } else {
      if (this.currentState !== 'idle') this.playLocoClip('idle', this.tuning.speedMultipliers.idle, this.tuning.crossfadeDuration, false);
      else this.updateActiveLocoSpeed(this.tuning.speedMultipliers.idle);
    }
    this.currentState = targetState;

    if (!this.isPausedPreview) {
      this.locoMixer.update(dt);
    }

    if (canLayerCombat && (this.rmbTimer > 0 || this.lmbTimer > 0)) {
      const desiredOverlay: 'lmb' | 'rmb' = this.rmbTimer > 0 ? 'rmb' : 'lmb';
      if (this.upperOverlayState !== desiredOverlay) this.startCombatOverlay(desiredOverlay);
      this.upperOverlayWeight = Math.min(1.0, this.upperOverlayWeight + dt * 16);
      this.applyCombatUpperOverlay(dt, this.upperOverlayWeight);
    } else if (this.upperOverlayState !== 'none') {
      this.upperOverlayWeight = Math.max(0, this.upperOverlayWeight - dt * 14);
      if (this.upperOverlayWeight <= 0.02) this.stopCombatOverlay();
      else this.applyCombatUpperOverlay(dt, this.upperOverlayWeight);
    }

    // Post-mixer procedural upper-body aim twist, dual-pistol recoil kick & hair/coat damping
    this.applyProceduralPolish(p, aimYaw, horizSpeed, nowMs);
    this.applyHitFlashTint(this.hitTimer > 0 ? Math.min(1.0, this.hitTimer / 0.16) : 0);
  }

  private applyProceduralPolish(p: PlayerState, aimYaw: number, horizSpeed: number, nowMs: number): void {
    // 1. Independent upper-body yaw twist toward target when shooting on the run
    if ((this.lmbTimer > 0 || this.rmbTimer > 0) && this.spine1Node) {
      let yawDelta = aimYaw - this.currentYaw;
      while (yawDelta < -Math.PI) yawDelta += Math.PI * 2;
      while (yawDelta > Math.PI) yawDelta -= Math.PI * 2;
      yawDelta = THREE.MathUtils.clamp(yawDelta, -0.95, 0.95);
      this.scratchQuat.setFromAxisAngle(this.scratchAxisY, yawDelta * 0.55);
      this.spine1Node.quaternion.multiply(this.scratchQuat);
    }

    // 2. Crisp alternating L/R pistol recoil kick
    if (this.recoilLTimer > 0 && this.leftArmNode) {
      const k = Math.sin((this.recoilLTimer / 0.14) * Math.PI) * 0.22;
      this.scratchQuat.setFromAxisAngle(this.scratchAxisX, -k);
      this.leftArmNode.quaternion.multiply(this.scratchQuat);
    }
    if (this.recoilRTimer > 0 && this.rightArmNode) {
      const k = Math.sin((this.recoilRTimer / 0.14) * Math.PI) * 0.22;
      this.scratchQuat.setFromAxisAngle(this.scratchAxisX, -k);
      this.rightArmNode.quaternion.multiply(this.scratchQuat);
    }

    // 3. Lightweight secondary motion on hair & coat skirt (zero cloth simulation cost)
    const speedRatio = Math.min(1.0, horizSpeed / 320);
    const t = nowMs * 0.006;
    const airFloat = p.isGrounded ? 0 : THREE.MathUtils.clamp(-p.vz * 0.0008, -0.18, 0.22);
    for (let i = 0; i < this.hairNodes.length; i++) {
      const sway = (0.04 + 0.06 * speedRatio) * Math.sin(t + i * 0.8) + airFloat * 0.6;
      this.scratchQuat.setFromAxisAngle(this.scratchAxisX, sway);
      this.hairNodes[i].quaternion.multiply(this.scratchQuat);
    }
    for (let i = 0; i < this.coatNodes.length; i++) {
      const flare = (0.03 + 0.05 * speedRatio) * Math.sin(t * 1.15 + i * 1.2) + Math.max(0, airFloat * 0.5);
      this.scratchQuat.setFromAxisAngle(this.scratchAxisX, flare);
      this.coatNodes[i].quaternion.multiply(this.scratchQuat);
    }
  }

  private playLocoClip(key: string, timeScale: number, fadeSec: number, forceRestart = false): void {
    const meta = this.clipRegistry.get(key);
    const nextAction = this.locoActions.get(key);
    if (!meta || !nextAction) return;
    const prevAction = this.activeLocoKey ? this.locoActions.get(this.activeLocoKey) : undefined;
    nextAction.enabled = true;
    nextAction.setEffectiveTimeScale(timeScale);
    nextAction.setEffectiveWeight(1.0);
    if (forceRestart || this.activeLocoKey !== key) {
      nextAction.reset();
      nextAction.play();
      if (prevAction && prevAction !== nextAction && fadeSec > 0.005) prevAction.crossFadeTo(nextAction, fadeSec, false);
      else if (prevAction && prevAction !== nextAction) prevAction.stop();
    }
    this.activeLocoKey = key;
    this.activeClipDisplayName = meta.sourceName;
    this.activeOriginalDuration = meta.originalDuration;
    this.activePlaybackSpeed = timeScale;
    this.activeEffectiveDuration = meta.clip.duration / Math.max(0.05, timeScale);
    this.activeIsLooping = meta.loop;
  }

  private updateActiveLocoSpeed(timeScale: number): void {
    if (!this.activeLocoKey) return;
    const action = this.locoActions.get(this.activeLocoKey);
    const meta = this.clipRegistry.get(this.activeLocoKey);
    if (!action || !meta) return;
    action.setEffectiveTimeScale(timeScale);
    this.activePlaybackSpeed = timeScale;
    this.activeEffectiveDuration = meta.clip.duration / Math.max(0.05, timeScale);
  }

  private playDashClip(forceRestart: boolean): void {
    const meta = this.clipRegistry.get('dash');
    if (!meta) return;
    this.playLocoClip('dash', (meta.clip.duration / Math.max(0.12, this.dashDuration)) * this.tuning.speedMultipliers.dash, 0.04, forceRestart);
  }

  private playLmbFullBody(forceRestart: boolean): void {
    const meta = this.clipRegistry.get('lmb_clip2');
    if (!meta) return;
    this.playLocoClip('lmb_clip2', (meta.clip.duration / Math.max(0.10, this.lmbDuration)) * this.tuning.speedMultipliers.lmb, 0.05, forceRestart);
  }

  private playRmbFullBody(forceRestart: boolean): void {
    const meta = this.clipRegistry.get('rmb');
    if (!meta) return;
    this.playLocoClip('rmb', (meta.clip.duration / Math.max(0.18, this.rmbDuration)) * this.tuning.speedMultipliers.rmb, 0.05, forceRestart);
  }

  private playUltimateClip(forceRestart: boolean): void {
    const meta = this.clipRegistry.get('ultimate_clip1');
    if (!meta) return;
    this.playLocoClip('ultimate_clip1', (meta.clip.duration / Math.max(0.35, this.ultDuration)) * this.tuning.speedMultipliers.ultimate, 0.08, forceRestart);
  }

  private startCombatOverlay(kind: 'lmb' | 'rmb'): void {
    if (!this.combatMixer) return;
    const key = kind === 'rmb' ? 'rmb_upper' : 'lmb_upper';
    const action = this.combatActions.get(key);
    if (!action) return;
    const prev = this.activeCombatKey ? this.combatActions.get(this.activeCombatKey) : undefined;
    if (prev && prev !== action) prev.stop();
    const dur = kind === 'rmb' ? Math.max(0.18, this.rmbDuration) : Math.max(0.12, this.lmbDuration);
    const mult = kind === 'rmb' ? this.tuning.speedMultipliers.rmb : this.tuning.speedMultipliers.lmb;
    action.enabled = true;
    action.setEffectiveTimeScale((action.getClip().duration / dur) * mult);
    action.setEffectiveWeight(1.0);
    action.reset();
    action.play();
    this.activeCombatKey = key;
    this.upperOverlayState = kind;
    this.upperOverlayWeight = Math.max(this.upperOverlayWeight, 0.72);
  }

  private stopCombatOverlay(): void {
    if (this.activeCombatKey) this.combatActions.get(this.activeCombatKey)?.stop();
    this.activeCombatKey = '';
    this.upperOverlayState = 'none';
    this.upperOverlayWeight = 0;
  }

  private applyCombatUpperOverlay(dt: number, weight: number): void {
    if (!this.combatMixer || this.upperBodyBones.length === 0) return;
    for (let i = 0; i < this.upperBodyBones.length; i++) this.savedUpperQuats[i].copy(this.upperBodyBones[i].quaternion);
    this.combatMixer.update(dt);
    for (let i = 0; i < this.upperBodyBones.length; i++) {
      this.upperBodyBones[i].quaternion.slerpQuaternions(this.savedUpperQuats[i], this.upperBodyBones[i].quaternion, weight);
    }
  }

  private applyHitFlashTint(amount: number): void {
    for (let i = 0; i < this.modelMaterials.length; i++) {
      const m = this.modelMaterials[i];
      if (amount > 0.01) m.color.copy(this.scratchWhite).lerp(this.scratchHitTint, amount * 0.75);
      else m.color.copy(this.scratchWhite);
    }
  }

  private spawnDashStreak(p: PlayerState): void {
    const intensity = this.tuning.dashVisualIntensity;
    if (intensity <= 0.05) return;
    const mat = new THREE.MeshBasicMaterial({
      color: Math.random() < 0.5 ? 0x10b981 : 0xe2e8f0,
      transparent: true,
      opacity: Math.min(0.85, 0.55 * intensity),
      blending: THREE.AdditiveBlending,
      depthWrite: false
    });
    const mesh = new THREE.Mesh(this.dashStreakGeo, mat);
    mesh.position.set((Math.random() - 0.5) * 18, 24 + Math.random() * 24, (Math.random() - 0.5) * 14);
    mesh.rotation.y = this.currentYaw;
    mesh.scale.set(0.85, 1.0 + intensity * 0.35, 1.8);
    mesh.position.x -= p.dashDir.x * 16;
    mesh.position.z -= p.dashDir.y * 16;
    this.group.add(mesh);
    this.dashStreakMeshes.push({ mesh, life: 0.24, maxLife: 0.24 });
  }

  private updateDashStreaks(dt: number): void {
    for (let i = this.dashStreakMeshes.length - 1; i >= 0; i--) {
      const entry = this.dashStreakMeshes[i];
      entry.life -= dt;
      const mat = entry.mesh.material as THREE.MeshBasicMaterial;
      if (entry.life <= 0) {
        this.group.remove(entry.mesh);
        mat.dispose();
        this.dashStreakMeshes.splice(i, 1);
      } else {
        mat.opacity = Math.max(0, (entry.life / entry.maxLife) * 0.55 * this.tuning.dashVisualIntensity);
      }
    }
  }

  private clearDashStreaks(): void {
    for (let i = 0; i < this.dashStreakMeshes.length; i++) {
      this.group.remove(this.dashStreakMeshes[i].mesh);
      (this.dashStreakMeshes[i].mesh.material as THREE.Material).dispose();
    }
    this.dashStreakMeshes = [];
  }

  public deactivateAndPause(): void {
    this.group.visible = false;
    this.stopCombatOverlay();
    this.clearDashStreaks();
  }

  public dispose(): void {
    this.deactivateAndPause();
    if (this.locoMixer) {
      this.locoMixer.stopAllAction();
      this.locoMixer.uncacheRoot(this.gltfScene || this.modelRoot);
      this.locoMixer = null;
    }
    if (this.combatMixer) {
      this.combatMixer.stopAllAction();
      this.combatMixer.uncacheRoot(this.gltfScene || this.modelRoot);
      this.combatMixer = null;
    }
    if (this.gltfScene) {
      this.modelRoot.remove(this.gltfScene);
      this.gltfScene = null;
    }
    for (const g of this.modelGeometries) g.dispose();
    for (const m of this.modelMaterials) m.dispose();
    for (const t of this.modelTextures) t.dispose();
    this.dashStreakGeo.dispose();
    this.modelGeometries = [];
    this.modelMaterials = [];
    this.modelTextures = [];
    this.clipRegistry.clear();
    this.locoActions.clear();
    this.combatActions.clear();
    this.boneMap.clear();
    this.upperBodyBones = [];
    this.savedUpperQuats = [];
    this.isReady = false;
    this.loadPromise = null;
  }
}

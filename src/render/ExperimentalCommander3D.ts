import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import type { InputSnapshot, PlayerState, Vector2 } from '../sim/types';
import type { ThreeVFX } from './ThreeVFX';

export type ExperimentalAnimState =
  | 'idle'
  | 'run'
  | 'jump_takeoff'
  | 'jump_ascend'
  | 'jump_descend'
  | 'jump_land'
  | 'glide'
  | 'dash'
  | 'lmb'
  | 'rmb'
  | 'ultimate'
  | 'hit'
  | 'death';

export type TuningSpeedKey =
  | 'idle'
  | 'run'
  | 'jump'
  | 'glide'
  | 'dash'
  | 'lmb'
  | 'rmb'
  | 'ultimate';

export interface ExperimentalTuningConfig {
  scaleMultiplier: number;
  yawOffsetDeg: number;
  verticalOffset: number;
  crossfadeDuration: number;
  runCadence: number;
  glideTorsoPitchDeg: number;
  dashVisualIntensity: number;
  lmbClipVariant: 'clip2_standing' | 'clip4_extended';
  ultClipVariant: 'clip1_right_arm' | 'clip5_left_arm';
  showGunProp: boolean;
  showSwordProp: boolean;
  speedMultipliers: Record<TuningSpeedKey, number>;
}

export interface ExperimentalInspectorSnapshot {
  loaded: boolean;
  loading: boolean;
  loadError: string | null;
  clipCount: number;
  boneCount: number;
  meshCount: number;
  triangleCount: number;
  currentState: ExperimentalAnimState;
  upperOverlayState: 'none' | 'lmb' | 'rmb';
  activeClipName: string;
  originalDuration: number;
  effectiveDuration: number;
  playbackSpeed: number;
  isLooping: boolean;
  isPausedPreview: boolean;
  previewState: ExperimentalAnimState | null;
  importedClipNames: string[];
}

export const DEFAULT_EXPERIMENTAL_TUNING: ExperimentalTuningConfig = {
  scaleMultiplier: 1.0,
  yawOffsetDeg: 0,
  verticalOffset: 0,
  crossfadeDuration: 0.12,
  runCadence: 1.0,
  glideTorsoPitchDeg: 18,
  dashVisualIntensity: 1.0,
  lmbClipVariant: 'clip2_standing',
  ultClipVariant: 'clip1_right_arm',
  showGunProp: true,
  showSwordProp: true,
  speedMultipliers: {
    idle: 1.0,
    run: 1.0,
    jump: 1.0,
    glide: 1.0,
    dash: 1.0,
    lmb: 1.0,
    rmb: 1.0,
    ultimate: 1.0
  }
};

const BASE_MODEL_SCALE = 106.0;
const RUN_CLIP_BASE_WORLD_SPEED = 203.6; // 1.921 m/s * 106.0 scale
const GLB_DEV_URL = '/assets/models/commander_3d.glb';

const UPPER_BODY_BONE_PREFIXES = [
  'mixamorigSpine1',
  'mixamorigSpine2',
  'mixamorigNeck',
  'mixamorigHead',
  'mixamorigLeftShoulder',
  'mixamorigLeftArm',
  'mixamorigLeftForeArm',
  'mixamorigLeftHand',
  'mixamorigRightShoulder',
  'mixamorigRightArm',
  'mixamorigRightForeArm',
  'mixamorigRightHand'
];

function normalizeBoneName(name: string): string {
  return name.replace(/:/g, '').trim();
}

function isUpperBodyBone(rawName: string): boolean {
  const norm = normalizeBoneName(rawName);
  for (let i = 0; i < UPPER_BODY_BONE_PREFIXES.length; i++) {
    if (norm.startsWith(UPPER_BODY_BONE_PREFIXES[i])) return true;
  }
  return false;
}

interface ClipMeta {
  clip: THREE.AnimationClip;
  sourceName: string;
  originalDuration: number;
  loop: boolean;
}

/**
 * ExperimentalCommander3D
 *
 * Localhost-only skeletal animation controller for the Tripo-exported 3D Commander GLB.
 * - Uses ONE shared SkinnedMesh rig (`exports/commander_tripo_animated.glb`) and
 *   `THREE.AnimationMixer` instances (full-body locomotion + optional upper-body combat overlay).
 * - Strips horizontal root displacement from `mixamorig:Hips` while preserving vertical bounce.
 * - Keeps the authoritative simulation in control of movement, jump height, dash distance,
 *   and skill timing; reverts cleanly to the 2D Commander on any load or runtime error.
 */
export class ExperimentalCommander3D {
  public readonly group: THREE.Group;
  private readonly modelRoot: THREE.Group;
  private readonly vfx: ThreeVFX;
  private readonly onFallbackTo2D?: (reason: string) => void;

  public isReady: boolean = false;
  public isLoading: boolean = false;
  public hasLoadError: boolean = false;
  public loadError: string | null = null;

  private loadPromise: Promise<boolean> | null = null;
  private gltfScene: THREE.Group | null = null;
  private importedClips: THREE.AnimationClip[] = [];

  private locoMixer: THREE.AnimationMixer | null = null;
  private combatMixer: THREE.AnimationMixer | null = null;
  private clipRegistry: Map<string, ClipMeta> = new Map();
  private locoActions: Map<string, THREE.AnimationAction> = new Map();
  private combatActions: Map<string, THREE.AnimationAction> = new Map();
  private activeLocoKey: string = '';
  private activeCombatKey: string = '';

  // Bone references & preallocated upper-body blend buffers (zero per-frame GC)
  private boneMap: Map<string, THREE.Object3D> = new Map();
  private upperBodyBones: THREE.Object3D[] = [];
  private savedUpperQuats: THREE.Quaternion[] = [];
  private spineNode: THREE.Object3D | null = null;
  private spine1Node: THREE.Object3D | null = null;
  private rightHandNode: THREE.Object3D | null = null;
  private leftHandNode: THREE.Object3D | null = null;

  // Materials for hit flash & cleanup
  private modelMaterials: THREE.MeshStandardMaterial[] = [];
  private modelGeometries: THREE.BufferGeometry[] = [];
  private modelTextures: THREE.Texture[] = [];

  // Optional weapon attachments (hidden when not firing/slashing)
  private gunPropGroup: THREE.Group | null = null;
  private swordPropGroup: THREE.Group | null = null;
  private propGeometries: THREE.BufferGeometry[] = [];
  private propMaterials: THREE.Material[] = [];

  // Dash visual streak pool
  private dashStreakMeshes: Array<{ mesh: THREE.Mesh; life: number; maxLife: number }> = [];
  private dashStreakTimer: number = 0;
  private readonly dashStreakGeo = new THREE.BoxGeometry(8, 22, 6);

  // Authoritative state mirrors & action timers
  public tuning: ExperimentalTuningConfig;
  private currentState: ExperimentalAnimState = 'idle';
  private upperOverlayState: 'none' | 'lmb' | 'rmb' = 'none';
  private upperOverlayWeight: number = 0;

  private currentYaw: number = 0;
  private targetYaw: number = 0;
  private prevWorldX: number = 0;
  private prevWorldY: number = 0;
  private hasPrevWorldPos: boolean = false;
  private smoothedHorizSpeed: number = 0;
  private lmbTimer: number = 0;
  private lmbDuration: number = 0.24;
  private rmbTimer: number = 0;
  private rmbDuration: number = 0.38;
  private rmbSecondSwingQueued: boolean = false;
  private ultTimer: number = 0;
  private ultDuration: number = 0.85;
  private dashTimer: number = 0;
  private dashDuration: number = 0.24;
  private jumpTakeoffTimer: number = 0;
  private jumpLandTimer: number = 0;
  private hitTimer: number = 0;
  private isDead: boolean = false;
  private hasGlidedInAir: boolean = false;
  private wasGrounded: boolean = true;
  private aimOverrideTarget: Vector2 | null = null;
  private aimOverrideTimer: number = 0;

  // Tuning panel preview controls
  private previewState: ExperimentalAnimState | null = null;
  private previewTimer: number = 0;
  private isPausedPreview: boolean = false;
  private activeClipDisplayName: string = 'None';
  private activeOriginalDuration: number = 0;
  private activeEffectiveDuration: number = 0;
  private activePlaybackSpeed: number = 1.0;
  private activeIsLooping: boolean = true;

  private meshCount: number = 0;
  private triangleCount: number = 0;
  private boneCount: number = 0;

  private readonly scratchQuatPitch = new THREE.Quaternion();
  private readonly scratchAxisX = new THREE.Vector3(1, 0, 0);
  private readonly scratchHitTint = new THREE.Color(0xff7777);
  private readonly scratchWhite = new THREE.Color(0xffffff);

  constructor(vfx: ThreeVFX, onFallbackTo2D?: (reason: string) => void) {
    this.vfx = vfx;
    this.onFallbackTo2D = onFallbackTo2D;
    this.group = new THREE.Group();
    this.group.name = 'ExperimentalCommander3D_Group';
    this.group.visible = false;

    this.modelRoot = new THREE.Group();
    this.modelRoot.name = 'ExperimentalCommander3D_ModelRoot';
    this.group.add(this.modelRoot);

    this.tuning = {
      ...DEFAULT_EXPERIMENTAL_TUNING,
      speedMultipliers: { ...DEFAULT_EXPERIMENTAL_TUNING.speedMultipliers }
    };
  }

  public async ensureLoaded(): Promise<boolean> {
    if (this.isReady) return true;
    if (this.hasLoadError) return false;
    if (this.loadPromise) return this.loadPromise;

    this.isLoading = true;
    this.loadPromise = this.loadInternal();
    return this.loadPromise;
  }

  private async loadInternal(): Promise<boolean> {
    try {
      const response = await fetch(GLB_DEV_URL);
      if (!response.ok) {
        throw new Error(`HTTP ${response.status} fetching ${GLB_DEV_URL}`);
      }
      const buffer = await response.arrayBuffer();
      const loader = new GLTFLoader();
      const gltf = await loader.parseAsync(buffer, '');

      if (!gltf.scene || !Array.isArray(gltf.animations) || gltf.animations.length === 0) {
        throw new Error('GLB loaded but contains no animations.');
      }

      this.gltfScene = gltf.scene;
      this.importedClips = gltf.animations;

      this.setupSceneGraphAndMaterials(gltf.scene);
      this.buildAnimationLibrary(gltf.animations);
      this.attachWeaponProps();

      this.isReady = true;
      this.isLoading = false;
      this.hasLoadError = false;
      this.loadError = null;

      this.applyTransformTuning();
      this.playLocoClip('idle', 1.0, 0);

      console.info(
        `[ExperimentalCommander3D] Loaded ${this.importedClips.length} animations, ${this.boneCount} bones, ${this.meshCount} meshes (${this.triangleCount.toLocaleString()} tris).`
      );
      return true;
    } catch (err: any) {
      const message = err?.message || 'Failed to load Experimental 3D Commander GLB.';
      console.warn('[ExperimentalCommander3D] Load failed, falling back to 2D:', message);
      this.isReady = false;
      this.isLoading = false;
      this.hasLoadError = true;
      this.loadError = message;
      this.loadPromise = null;
      this.onFallbackTo2D?.(message);
      return false;
    }
  }

  private setupSceneGraphAndMaterials(root: THREE.Group): void {
    this.boneMap.clear();
    this.upperBodyBones = [];
    this.savedUpperQuats = [];
    this.modelMaterials = [];
    this.modelGeometries = [];
    this.modelTextures = [];
    this.meshCount = 0;
    this.triangleCount = 0;
    this.boneCount = 0;

    const seenMaterials = new Set<THREE.Material>();
    const seenGeometries = new Set<THREE.BufferGeometry>();
    const seenTextures = new Set<THREE.Texture>();

    root.traverse((obj) => {
      if ((obj as THREE.Bone).isBone || normalizeBoneName(obj.name).startsWith('mixamorig')) {
        const norm = normalizeBoneName(obj.name);
        if (!this.boneMap.has(norm)) {
          this.boneMap.set(norm, obj);
          this.boneCount++;
          if (isUpperBodyBone(norm)) {
            this.upperBodyBones.push(obj);
            this.savedUpperQuats.push(new THREE.Quaternion());
          }
        }
      }

      if ((obj as THREE.Mesh).isMesh) {
        const mesh = obj as THREE.Mesh;
        mesh.frustumCulled = false;
        mesh.castShadow = false;
        mesh.receiveShadow = false;
        this.meshCount++;

        const geo = mesh.geometry;
        if (geo && !seenGeometries.has(geo)) {
          seenGeometries.add(geo);
          this.modelGeometries.push(geo);
          const idx = geo.getIndex();
          const pos = geo.getAttribute('position');
          if (idx) this.triangleCount += Math.floor(idx.count / 3);
          else if (pos) this.triangleCount += Math.floor(pos.count / 3);
        }

        const mats = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
        for (const mat of mats) {
          if (!mat || seenMaterials.has(mat)) continue;
          seenMaterials.add(mat);
          if ((mat as THREE.MeshStandardMaterial).isMeshStandardMaterial) {
            const std = mat as THREE.MeshStandardMaterial;
            // Balanced matte-satin response under moonlit night lighting
            std.roughness = 0.68;
            std.metalness = 0.12;
            std.emissive.setHex(0x0b101d);
            std.emissiveIntensity = 0.14;
            std.needsUpdate = true;
            this.modelMaterials.push(std);
            if (std.map && !seenTextures.has(std.map)) {
              seenTextures.add(std.map);
              this.modelTextures.push(std.map);
            }
            if (std.normalMap && !seenTextures.has(std.normalMap)) {
              seenTextures.add(std.normalMap);
              this.modelTextures.push(std.normalMap);
            }
          }
        }
      }
    });

    this.spineNode = this.boneMap.get('mixamorigSpine') || null;
    this.spine1Node = this.boneMap.get('mixamorigSpine1') || null;
    this.rightHandNode = this.boneMap.get('mixamorigRightHand') || null;
    this.leftHandNode = this.boneMap.get('mixamorigLeftHand') || null;

    this.modelRoot.add(root);
    this.locoMixer = new THREE.AnimationMixer(root);
    this.combatMixer = new THREE.AnimationMixer(root);
  }

  private findImportedClip(nameExactOrPrefix: string, fallbackIndex: number): THREE.AnimationClip {
    const lower = nameExactOrPrefix.toLowerCase();
    const exact = this.importedClips.find((c) => c.name.toLowerCase() === lower);
    if (exact) return exact;
    const partial = this.importedClips.find((c) => c.name.toLowerCase().includes(lower));
    if (partial) return partial;
    return this.importedClips[Math.min(fallbackIndex, this.importedClips.length - 1)];
  }

  /**
   * Removes horizontal root translation from `mixamorig:Hips` while preserving vertical bounce.
   * Also filters out constant scale tracks if unneeded to reduce mixer overhead.
   */
  private sanitizeClipRootMotion(
    sourceClip: THREE.AnimationClip,
    anchorX: number = 0.002,
    anchorZ: number = 0.098
  ): THREE.AnimationClip {
    const cloned = sourceClip.clone();
    const outTracks: THREE.KeyframeTrack[] = [];

    for (const track of cloned.tracks) {
      const dotIdx = track.name.lastIndexOf('.');
      const targetName = dotIdx >= 0 ? normalizeBoneName(track.name.slice(0, dotIdx)) : '';
      const prop = dotIdx >= 0 ? track.name.slice(dotIdx + 1) : '';

      if (targetName === 'mixamorigHips' && prop === 'position') {
        const vals = new Float32Array(track.values.length);
        for (let i = 0; i < vals.length; i += 3) {
          vals[i] = anchorX;
          vals[i + 1] = track.values[i + 1];
          vals[i + 2] = anchorZ;
        }
        outTracks.push(new THREE.VectorKeyframeTrack(track.name, Float32Array.from(track.times), vals));
      } else {
        outTracks.push(track);
      }
    }

    cloned.tracks = outTracks;
    return cloned;
  }

  private makeSubclip(
    source: THREE.AnimationClip,
    name: string,
    startSec: number,
    endSec: number,
    fps: number = 24
  ): THREE.AnimationClip {
    const startFrame = Math.max(0, Math.round(startSec * fps));
    const endFrame = Math.max(startFrame + 1, Math.round(endSec * fps));
    return THREE.AnimationUtils.subclip(source, name, startFrame, endFrame, fps);
  }

  private filterUpperBodyClip(source: THREE.AnimationClip, name: string): THREE.AnimationClip {
    const tracks = source.tracks
      .filter((t) => {
        const dotIdx = t.name.lastIndexOf('.');
        const nodePart = dotIdx >= 0 ? t.name.slice(0, dotIdx) : t.name;
        const prop = dotIdx >= 0 ? t.name.slice(dotIdx + 1) : '';
        return prop === 'quaternion' && isUpperBodyBone(nodePart);
      })
      .map((t) => t.clone());
    return new THREE.AnimationClip(name, source.duration, tracks);
  }

  /**
   * Samples all tracks of a clip at `sampleTime` to extract a clean pose dictionary.
   */
  private samplePoseAt(
    clip: THREE.AnimationClip,
    sampleTime: number
  ): Map<string, { pos?: number[]; quat?: number[] }> {
    const map = new Map<string, { pos?: number[]; quat?: number[] }>();
    for (const track of clip.tracks) {
      const dotIdx = track.name.lastIndexOf('.');
      if (dotIdx < 0) continue;
      const node = track.name.slice(0, dotIdx);
      const prop = track.name.slice(dotIdx + 1);
      const entry = map.get(node) || {};

      const times = track.times;
      let idx = 0;
      for (let i = 0; i < times.length; i++) {
        if (times[i] <= sampleTime) idx = i;
        else break;
      }

      if (prop === 'position') {
        const o = idx * 3;
        entry.pos = [track.values[o], track.values[o + 1], track.values[o + 2]];
      } else if (prop === 'quaternion') {
        const o = idx * 4;
        entry.quat = [track.values[o], track.values[o + 1], track.values[o + 2], track.values[o + 3]];
      }
      map.set(node, entry);
    }
    return map;
  }

  private buildIdleClipFromRest(standingClip: THREE.AnimationClip): THREE.AnimationClip {
    const basePose = this.samplePoseAt(standingClip, 0);
    const dur = 2.4;
    const times = [0, 1.2, 2.4];
    const tracks: THREE.KeyframeTrack[] = [];

    const breathPitchIn = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(1, 0, 0), 0.028);
    const armOutDeltaL = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 0, 1), 0.025);
    const armOutDeltaR = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 0, 1), -0.025);
    const qBase = new THREE.Quaternion();
    const qAlt = new THREE.Quaternion();

    for (const [node, tr] of basePose.entries()) {
      const norm = normalizeBoneName(node);
      if (tr.pos && norm === 'mixamorigHips') {
        const y0 = tr.pos[1];
        tracks.push(
          new THREE.VectorKeyframeTrack(
            `${node}.position`,
            times,
            [0.002, y0, 0.098, 0.002, y0 + 0.004, 0.098, 0.002, y0, 0.098]
          )
        );
      }
      if (tr.quat) {
        qBase.set(tr.quat[0], tr.quat[1], tr.quat[2], tr.quat[3]);
        qAlt.copy(qBase);
        if (norm === 'mixamorigSpine1' || norm === 'mixamorigSpine2') {
          qAlt.multiply(breathPitchIn);
        } else if (norm === 'mixamorigLeftArm') {
          qAlt.multiply(armOutDeltaL);
        } else if (norm === 'mixamorigRightArm') {
          qAlt.multiply(armOutDeltaR);
        }
        tracks.push(
          new THREE.QuaternionKeyframeTrack(
            `${node}.quaternion`,
            times,
            [
              qBase.x, qBase.y, qBase.z, qBase.w,
              qAlt.x, qAlt.y, qAlt.z, qAlt.w,
              qBase.x, qBase.y, qBase.z, qBase.w
            ]
          )
        );
      }
    }

    return new THREE.AnimationClip('idle_breathing', dur, tracks);
  }

  /**
   * Builds a clean 2-keyframe or 3-keyframe skeletal pose clip from existing rig poses
   * with optional additive Euler offsets on specific bones (for Jump & Glide phases).
   */
  private buildPoseClip(
    name: string,
    basePose: Map<string, { pos?: number[]; quat?: number[] }>,
    duration: number,
    boneOffsets: Record<string, [number, number, number]>,
    hipYOffset: number = 0,
    bobAmplitude: number = 0
  ): THREE.AnimationClip {
    const times = bobAmplitude !== 0 ? [0, duration * 0.5, duration] : [0, duration];
    const tracks: THREE.KeyframeTrack[] = [];
    const qBase = new THREE.Quaternion();
    const qOff = new THREE.Quaternion();
    const euler = new THREE.Euler();

    for (const [node, tr] of basePose.entries()) {
      const norm = normalizeBoneName(node);
      if (tr.pos && norm === 'mixamorigHips') {
        const y = tr.pos[1] + hipYOffset;
        if (times.length === 3) {
          tracks.push(
            new THREE.VectorKeyframeTrack(
              `${node}.position`,
              times,
              [0.002, y, 0.098, 0.002, y + bobAmplitude, 0.098, 0.002, y, 0.098]
            )
          );
        } else {
          tracks.push(
            new THREE.VectorKeyframeTrack(`${node}.position`, times, [0.002, y, 0.098, 0.002, y, 0.098])
          );
        }
      }
      if (tr.quat) {
        qBase.set(tr.quat[0], tr.quat[1], tr.quat[2], tr.quat[3]);
        const off = boneOffsets[norm];
        if (off) {
          euler.set(off[0], off[1], off[2], 'XYZ');
          qOff.setFromEuler(euler);
          qBase.multiply(qOff);
        }
        if (times.length === 3) {
          tracks.push(
            new THREE.QuaternionKeyframeTrack(
              `${node}.quaternion`,
              times,
              [
                qBase.x, qBase.y, qBase.z, qBase.w,
                qBase.x, qBase.y, qBase.z, qBase.w,
                qBase.x, qBase.y, qBase.z, qBase.w
              ]
            )
          );
        } else {
          tracks.push(
            new THREE.QuaternionKeyframeTrack(
              `${node}.quaternion`,
              times,
              [qBase.x, qBase.y, qBase.z, qBase.w, qBase.x, qBase.y, qBase.z, qBase.w]
            )
          );
        }
      }
    }

    return new THREE.AnimationClip(name, duration, tracks);
  }

  private buildAnimationLibrary(rawClips: THREE.AnimationClip[]): void {
    this.clipRegistry.clear();
    this.locoActions.clear();
    this.combatActions.clear();

    const rawRun = this.sanitizeClipRootMotion(this.findImportedClip('run', 3));
    const rawDash = this.sanitizeClipRootMotion(this.findImportedClip('dodge forward', 0));
    const rawLmbStanding = this.sanitizeClipRootMotion(
      rawClips.find((c) => c.name === 'shoot a gun while standing') || this.findImportedClip('shoot a gun', 2)
    );
    const rawLmbAlt = this.sanitizeClipRootMotion(
      rawClips.find((c) => c.name === 'shoot a gun while standing.001') || rawLmbStanding
    );
    const rawRmb = this.sanitizeClipRootMotion(this.findImportedClip('slash with sword', 6));
    const rawUltRight = this.sanitizeClipRootMotion(
      this.findImportedClip('character looks up and raises right arm', 1)
    );
    const rawUltLeft = this.sanitizeClipRootMotion(
      this.findImportedClip('Looks at right wrist', 5)
    );

    // 1. Idle (built from Frame 0 relaxed standing pose of rawUltRight)
    const idleClip = this.buildIdleClipFromRest(rawUltRight);
    this.registerClip('idle', idleClip, 'Idle (Stand + Breathing from Rig)', 2.4, true);

    // 2. Run (full 2-stride loop 0..1.25s)
    this.registerClip('run', rawRun, rawRun.name, rawRun.duration, true);

    // 3. Dash (trimmed active forward-step window 0.38s..1.42s of "dodge forward")
    const dashTrimmed = this.makeSubclip(rawDash, 'dash_quickstep', 0.38, 1.42, 24);
    this.registerClip('dash', dashTrimmed, `${rawDash.name} [0.38s–1.42s]`, rawDash.duration, false);

    // 4. LMB Gun Firing (both variants + upper-body overlays)
    const lmbTrimmed = this.makeSubclip(rawLmbStanding, 'lmb_gun_fire', 0.0, 0.88, 24);
    this.registerClip('lmb_clip2', lmbTrimmed, `${rawLmbStanding.name} [0.00s–0.88s]`, rawLmbStanding.duration, false);
    const lmbAltTrimmed = this.makeSubclip(rawLmbAlt, 'lmb_gun_fire_alt', 0.0, 1.0, 24);
    this.registerClip('lmb_clip4', lmbAltTrimmed, `${rawLmbAlt.name} [0.00s–1.00s]`, rawLmbAlt.duration, false);

    this.registerCombatOverlay('lmb_clip2_upper', this.filterUpperBodyClip(lmbTrimmed, 'lmb_clip2_upper'));
    this.registerCombatOverlay('lmb_clip4_upper', this.filterUpperBodyClip(lmbAltTrimmed, 'lmb_clip4_upper'));

    // 5. RMB Sword Slash (trimmed active sweep 0.08s..0.88s + upper-body overlay)
    const rmbTrimmed = this.makeSubclip(rawRmb, 'rmb_sword_slash', 0.08, 0.88, 24);
    this.registerClip('rmb', rmbTrimmed, `${rawRmb.name} [0.08s–0.88s]`, rawRmb.duration, false);
    this.registerCombatOverlay('rmb_upper', this.filterUpperBodyClip(rmbTrimmed, 'rmb_upper'));

    // 6. Ultimate Orbital Strike (trimmed upward arm raise)
    const ultRightTrimmed = this.makeSubclip(rawUltRight, 'ult_arm_raise_right', 0.18, 1.85, 24);
    this.registerClip(
      'ultimate_clip1',
      ultRightTrimmed,
      `${rawUltRight.name} [0.18s–1.85s]`,
      rawUltRight.duration,
      false
    );
    const ultLeftTrimmed = this.makeSubclip(rawUltLeft, 'ult_arm_raise_left', 0.12, 1.65, 24);
    this.registerClip(
      'ultimate_clip5',
      ultLeftTrimmed,
      `${rawUltLeft.name} [0.12s–1.65s]`,
      rawUltLeft.duration,
      false
    );

    // 7. Jump Phases & Jetpack Glide (cleanly derived from the Tripo rig poses because no Jump/Glide clip was exported)
    const standPose = this.samplePoseAt(rawUltRight, 0);
    const dashMidPose = this.samplePoseAt(rawDash, 0.72);
    const runAirPose = this.samplePoseAt(rawRun, 0.50);

    const jumpTakeoffClip = this.buildPoseClip(
      'jump_takeoff',
      dashMidPose,
      0.16,
      {
        mixamorigSpine: [0.12, 0, 0],
        mixamorigLeftArm: [-0.35, 0, 0.25],
        mixamorigRightArm: [-0.35, 0, -0.25]
      },
      -0.025
    );
    this.registerClip('jump_takeoff', jumpTakeoffClip, 'Rig Jump Takeoff (Adapted)', 0.16, false);

    const jumpAscendClip = this.buildPoseClip(
      'jump_ascend',
      runAirPose,
      0.45,
      {
        mixamorigSpine: [-0.08, 0, 0],
        mixamorigLeftUpLeg: [-0.35, 0, 0],
        mixamorigLeftLeg: [0.55, 0, 0],
        mixamorigRightUpLeg: [0.15, 0, 0],
        mixamorigRightLeg: [0.28, 0, 0],
        mixamorigLeftArm: [-0.45, 0, 0.35],
        mixamorigRightArm: [-0.45, 0, -0.35]
      },
      0.02
    );
    this.registerClip('jump_ascend', jumpAscendClip, 'Rig Airborne Ascent (Adapted)', 0.45, true);

    const jumpDescendClip = this.buildPoseClip(
      'jump_descend',
      standPose,
      0.45,
      {
        mixamorigSpine: [0.10, 0, 0],
        mixamorigLeftUpLeg: [-0.28, 0, 0.06],
        mixamorigLeftLeg: [0.42, 0, 0],
        mixamorigRightUpLeg: [-0.18, 0, -0.06],
        mixamorigRightLeg: [0.30, 0, 0],
        mixamorigLeftArm: [0.15, 0, 0.42],
        mixamorigRightArm: [0.15, 0, -0.42]
      },
      0.01
    );
    this.registerClip('jump_descend', jumpDescendClip, 'Rig Airborne Descent (Adapted)', 0.45, true);

    const jumpLandClip = this.buildPoseClip(
      'jump_land',
      dashMidPose,
      0.16,
      {
        mixamorigSpine: [0.22, 0, 0],
        mixamorigLeftArm: [0.20, 0, 0.24],
        mixamorigRightArm: [0.20, 0, -0.24]
      },
      -0.035
    );
    this.registerClip('jump_land', jumpLandClip, 'Rig Landing Recovery (Adapted)', 0.16, false);

    // 8. Glide (Controlled upright jetpack hover with subtle vertical hover pulse)
    const glideClip = this.buildPoseClip(
      'glide_jetpack',
      standPose,
      1.6,
      {
        mixamorigSpine: [0.18, 0, 0],
        mixamorigSpine1: [0.08, 0, 0],
        mixamorigHead: [-0.18, 0, 0],
        mixamorigLeftUpLeg: [-0.22, 0, 0.08],
        mixamorigLeftLeg: [0.36, 0, 0],
        mixamorigRightUpLeg: [-0.12, 0, -0.08],
        mixamorigRightLeg: [0.26, 0, 0],
        mixamorigLeftArm: [0.24, 0, 0.44],
        mixamorigRightArm: [0.24, 0, -0.44]
      },
      0.01,
      0.012
    );
    this.registerClip('glide', glideClip, 'Rig Jetpack Glide (Adapted)', 1.6, true);

    // 9. Hit & Death
    const hitClip = this.buildPoseClip(
      'hit_flinch',
      standPose,
      0.20,
      {
        mixamorigSpine: [-0.24, 0, 0],
        mixamorigHead: [-0.18, 0, 0],
        mixamorigLeftArm: [0.15, 0, 0.35],
        mixamorigRightArm: [0.15, 0, -0.35]
      },
      -0.01
    );
    this.registerClip('hit', hitClip, 'Rig Hit Flinch (Adapted)', 0.20, false);

    const deathClip = this.buildPoseClip(
      'death_collapse',
      dashMidPose,
      0.55,
      {
        mixamorigSpine: [0.95, 0, 0],
        mixamorigHead: [0.35, 0, 0],
        mixamorigLeftUpLeg: [-0.75, 0, 0],
        mixamorigLeftLeg: [1.15, 0, 0],
        mixamorigRightUpLeg: [-0.75, 0, 0],
        mixamorigRightLeg: [1.15, 0, 0],
        mixamorigLeftArm: [0.4, 0, 0.35],
        mixamorigRightArm: [0.4, 0, -0.35]
      },
      -0.28
    );
    this.registerClip('death', deathClip, 'Rig Defeat Collapse (Adapted)', 0.55, false);
  }

  private registerClip(
    key: string,
    clip: THREE.AnimationClip,
    sourceName: string,
    originalDuration: number,
    loop: boolean
  ): void {
    this.clipRegistry.set(key, { clip, sourceName, originalDuration, loop });
    if (this.locoMixer) {
      const action = this.locoMixer.clipAction(clip);
      action.setLoop(loop ? THREE.LoopRepeat : THREE.LoopOnce, loop ? Infinity : 1);
      action.clampWhenFinished = !loop;
      this.locoActions.set(key, action);
    }
  }

  private registerCombatOverlay(key: string, clip: THREE.AnimationClip): void {
    if (!this.combatMixer) return;
    const action = this.combatMixer.clipAction(clip);
    action.setLoop(THREE.LoopOnce, 1);
    action.clampWhenFinished = true;
    this.combatActions.set(key, action);
  }

  private attachWeaponProps(): void {
    this.propGeometries = [];
    this.propMaterials = [];

    // Compact Gold/Dark-Steel Sidearm attached to Right Hand during LMB
    if (this.rightHandNode) {
      const gun = new THREE.Group();
      gun.name = 'ExperimentalCommander_SidearmProp';

      const bodyMat = new THREE.MeshStandardMaterial({
        color: 0xf8fafc,
        roughness: 0.35,
        metalness: 0.45
      });
      const goldMat = new THREE.MeshStandardMaterial({
        color: 0xfacc15,
        emissive: 0xd97706,
        emissiveIntensity: 0.55,
        roughness: 0.28,
        metalness: 0.78
      });
      const gripMat = new THREE.MeshStandardMaterial({
        color: 0x1e293b,
        roughness: 0.65,
        metalness: 0.25
      });
      const barrelGeo = new THREE.BoxGeometry(0.026, 0.036, 0.14);
      const trimGeo = new THREE.BoxGeometry(0.030, 0.014, 0.11);
      const gripGeo = new THREE.BoxGeometry(0.022, 0.068, 0.032);
      const muzzleGeo = new THREE.SphereGeometry(0.012, 8, 8);

      const barrel = new THREE.Mesh(barrelGeo, bodyMat);
      barrel.position.set(0, 0.04, 0.055);
      const trim = new THREE.Mesh(trimGeo, goldMat);
      trim.position.set(0, 0.055, 0.055);
      const grip = new THREE.Mesh(gripGeo, gripMat);
      grip.position.set(0, 0.01, 0.01);
      grip.rotation.x = 0.22;
      const muzzle = new THREE.Mesh(muzzleGeo, goldMat);
      muzzle.position.set(0, 0.04, 0.125);

      gun.add(barrel, trim, grip, muzzle);
      gun.position.set(0.0, 0.055, 0.015);
      gun.rotation.set(Math.PI * 0.45, 0, 0);
      gun.visible = false;

      this.rightHandNode.add(gun);
      this.gunPropGroup = gun;
      this.propGeometries.push(barrelGeo, trimGeo, gripGeo, muzzleGeo);
      this.propMaterials.push(bodyMat, goldMat, gripMat);
    }

    // Golden-Amber Cross-Slash Energy Blade attached to Left Hand strictly during RMB
    if (this.leftHandNode) {
      const sword = this.vfx.createElectricSwordModel();
      sword.name = 'ExperimentalCommander_CrossSlashSword';
      // Retint plasma ribbon meshes to Commander's golden cross-slash palette
      sword.traverse((child) => {
        if ((child as THREE.Mesh).isMesh) {
          const m = (child as THREE.Mesh).material as THREE.MeshBasicMaterial;
          if (m && m.color) {
            if (m.opacity > 0.8) m.color.setHex(0xfef08a);
            else m.color.setHex(0xf59e0b);
          }
          if ((child as THREE.Mesh).geometry) this.propGeometries.push((child as THREE.Mesh).geometry);
          if (m) this.propMaterials.push(m);
        }
      });
      // Scale ~36-unit ribbon sword down into 0.98m Mixamo bone space (~0.52m blade)
      sword.scale.setScalar(0.0145);
      sword.position.set(0.0, 0.05, 0.02);
      sword.rotation.set(Math.PI * 0.48, 0, 0);
      sword.visible = false;

      this.leftHandNode.add(sword);
      this.swordPropGroup = sword;
    }
  }

  public applyTransformTuning(): void {
    const scale = BASE_MODEL_SCALE * Math.max(0.35, Math.min(2.5, this.tuning.scaleMultiplier));
    this.modelRoot.scale.setScalar(scale);
    this.modelRoot.position.set(0, this.tuning.verticalOffset, 0);
  }

  // --- Authoritative Game Event Triggers ---

  public triggerLMB(duration: number = 0.24, targetPos?: Vector2): void {
    if (this.isDead || !this.isReady) return;
    this.lmbDuration = Math.max(0.10, duration);
    this.lmbTimer = this.lmbDuration;
    if (targetPos) {
      this.aimOverrideTarget = { x: targetPos.x, y: targetPos.y };
      this.aimOverrideTimer = Math.max(this.aimOverrideTimer, this.lmbDuration + 0.08);
    }
    if (this.currentState === 'run' || this.currentState === 'glide' || this.currentState.startsWith('jump_')) {
      this.startCombatOverlay('lmb');
    } else if (this.currentState !== 'ultimate' && this.currentState !== 'dash') {
      this.playLmbFullBody(true);
    }
  }

  public triggerRMB(duration: number = 0.38, slashAngle?: number, targetPos?: Vector2): void {
    if (this.isDead || !this.isReady) return;
    this.rmbDuration = Math.max(0.18, duration);
    this.rmbTimer = this.rmbDuration;
    this.rmbSecondSwingQueued = true;
    if (targetPos) {
      this.aimOverrideTarget = { x: targetPos.x, y: targetPos.y };
      this.aimOverrideTimer = Math.max(this.aimOverrideTimer, this.rmbDuration + 0.12);
    } else if (slashAngle !== undefined) {
      // Face along slash angle (+PI/2 from X-axis into Three.js atan2(dx, dz))
      this.targetYaw = Math.atan2(Math.cos(slashAngle), Math.sin(slashAngle));
    }

    if (this.currentState === 'run' || this.currentState === 'glide' || this.currentState.startsWith('jump_')) {
      this.startCombatOverlay('rmb');
    } else if (this.currentState !== 'ultimate' && this.currentState !== 'dash') {
      this.playRmbFullBody(true);
    }
  }

  public triggerDash(duration: number = 0.24, dashDir?: Vector2): void {
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

  public triggerUltimate(duration: number = 0.85, targetPos?: Vector2): void {
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
      // Midair double/triple jumps skip the ground crouch takeoff and snap into aerial ascent tuck
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
    this.rmbTimer = 0;
    this.rmbSecondSwingQueued = false;
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

    if (this.gunPropGroup) this.gunPropGroup.visible = false;
    if (this.swordPropGroup) this.swordPropGroup.visible = false;
    this.applyHitFlashTint(0);

    if (this.isReady) {
      this.playLocoClip('idle', 1.0, 0.05, true);
    }
  }

  // --- Tuning Panel Preview API ---

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
      // Looping states: idle, run, glide, jump_ascend, jump_descend
      this.previewTimer = 3.0;
      const mult =
        state === 'run'
          ? 2.0 * this.tuning.runCadence * this.tuning.speedMultipliers.run
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

  // --- Main Per-Frame Update ---

  public update(
    dt: number,
    p: PlayerState,
    input: InputSnapshot,
    aimWorldPos: Vector2,
    _now: number
  ): void {
    if (!this.isReady || !this.locoMixer) return;

    this.applyTransformTuning();

    // Update dash streak particles regardless of preview
    this.updateDashStreaks(dt);

    // Handle active Tuning Panel preview override
    if (this.previewState) {
      if (!this.isPausedPreview) {
        this.previewTimer -= dt;
        this.locoMixer.update(dt);
        if (this.previewState === 'glide') {
          this.applyGlideTorsoAlignment();
        }
        if (this.previewTimer <= 0) {
          this.previewState = null;
        }
      }
      this.syncWeaponPropVisibility();
      return;
    }

    // 1. Tick action timers
    if (this.lmbTimer > 0) this.lmbTimer = Math.max(0, this.lmbTimer - dt);
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

    // Track ground/glide transitions
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

    // 2. Smooth 360-degree Yaw Steering (Authoritative facing / aim)
    if (!isDeadNow) {
      if (this.ultTimer > 0 || this.lmbTimer > 0 || this.rmbTimer > 0) {
        const aimPt = this.aimOverrideTarget || aimWorldPos;
        const dx = aimPt.x - p.pos.x;
        const dz = aimPt.y - p.pos.y;
        if (Math.hypot(dx, dz) > 2) {
          this.targetYaw = Math.atan2(dx, dz);
        }
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

    // 3. Resolve Authoritative Animation State Priority
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

    // 4. Drive Primary Locomotion / Full-Body Mixer
    const canLayerCombat =
      targetState === 'run' ||
      targetState === 'glide' ||
      targetState === 'jump_takeoff' ||
      targetState === 'jump_ascend' ||
      targetState === 'jump_descend';

    if (targetState === 'run') {
      const speedScale = THREE.MathUtils.clamp(
        (horizSpeed / RUN_CLIP_BASE_WORLD_SPEED) * this.tuning.runCadence * this.tuning.speedMultipliers.run,
        0.55,
        2.8
      );
      if (this.currentState !== 'run') {
        this.playLocoClip('run', speedScale, this.tuning.crossfadeDuration, false);
      } else {
        this.updateActiveLocoSpeed(speedScale);
      }
    } else if (targetState === 'glide') {
      const glideSpeed = this.tuning.speedMultipliers.glide;
      if (this.currentState !== 'glide') {
        this.playLocoClip('glide', glideSpeed, this.tuning.crossfadeDuration, false);
      } else {
        this.updateActiveLocoSpeed(glideSpeed);
      }
    } else if (targetState === 'jump_takeoff') {
      if (this.currentState !== 'jump_takeoff') {
        this.playLocoClip('jump_takeoff', 1.15 * this.tuning.speedMultipliers.jump, 0.06, false);
      }
    } else if (targetState === 'jump_ascend') {
      if (this.currentState !== 'jump_ascend') {
        this.playLocoClip('jump_ascend', this.tuning.speedMultipliers.jump, 0.10, false);
      }
    } else if (targetState === 'jump_descend') {
      if (this.currentState !== 'jump_descend') {
        this.playLocoClip('jump_descend', this.tuning.speedMultipliers.jump, 0.12, false);
      }
    } else if (targetState === 'jump_land') {
      if (this.currentState !== 'jump_land') {
        this.playLocoClip('jump_land', this.tuning.speedMultipliers.jump, 0.06, true);
      }
    } else if (targetState === 'dash') {
      if (this.currentState !== 'dash') {
        this.playDashClip(false);
      }
      if (this.tuning.dashVisualIntensity > 0.05) {
        this.dashStreakTimer -= dt;
        if (this.dashStreakTimer <= 0) {
          this.dashStreakTimer = 0.032;
          this.spawnDashStreak(p);
        }
      }
    } else if (targetState === 'ultimate') {
      if (this.currentState !== 'ultimate') {
        this.playUltimateClip(false);
      }
    } else if (targetState === 'rmb') {
      if (this.currentState !== 'rmb') {
        this.playRmbFullBody(false);
      }
    } else if (targetState === 'lmb') {
      if (this.currentState !== 'lmb') {
        this.playLmbFullBody(false);
      }
    } else if (targetState === 'hit') {
      if (this.currentState !== 'hit') {
        this.playLocoClip('hit', 1.0, 0.06, true);
      }
    } else if (targetState === 'death') {
      if (this.currentState !== 'death') {
        this.playLocoClip('death', 1.0, 0.12, true);
      }
    } else {
      if (this.currentState !== 'idle') {
        this.playLocoClip('idle', this.tuning.speedMultipliers.idle, this.tuning.crossfadeDuration, false);
      } else {
        this.updateActiveLocoSpeed(this.tuning.speedMultipliers.idle);
      }
    }

    this.currentState = targetState;

    // 5. Update Primary Mixer
    if (!this.isPausedPreview) {
      this.locoMixer.update(dt);
    }

    // 6. Optional Glide Torso Pitch Adjustment
    if (this.currentState === 'glide') {
      this.applyGlideTorsoAlignment();
    }

    // 7. Two-Slash RMB Second Swing Sync (represents the twin crossing blades cleanly)
    if (this.rmbSecondSwingQueued && this.rmbTimer > 0 && this.rmbTimer <= this.rmbDuration * 0.45) {
      this.rmbSecondSwingQueued = false;
      if (canLayerCombat) {
        this.startCombatOverlay('rmb');
      } else if (this.currentState === 'rmb') {
        this.playRmbFullBody(true);
      }
    }

    // 8. Upper-Body Attack Overlay during Movement / Jump / Glide
    if (canLayerCombat && (this.rmbTimer > 0 || this.lmbTimer > 0)) {
      const desiredOverlay: 'lmb' | 'rmb' = this.rmbTimer > 0 ? 'rmb' : 'lmb';
      if (this.upperOverlayState !== desiredOverlay) {
        this.startCombatOverlay(desiredOverlay);
      }
      this.upperOverlayWeight = Math.min(1.0, this.upperOverlayWeight + dt * 16);
      this.applyCombatUpperOverlay(dt, this.upperOverlayWeight);
    } else if (this.upperOverlayState !== 'none') {
      this.upperOverlayWeight = Math.max(0, this.upperOverlayWeight - dt * 14);
      if (this.upperOverlayWeight <= 0.02) {
        this.stopCombatOverlay();
      } else {
        this.applyCombatUpperOverlay(dt, this.upperOverlayWeight);
      }
    }

    // 9. Weapon Prop Visibility & Hit Flinch Tint
    this.syncWeaponPropVisibility();
    this.applyHitFlashTint(this.hitTimer > 0 ? Math.min(1.0, this.hitTimer / 0.16) : 0);
  }

  private playLocoClip(key: string, timeScale: number, fadeSec: number, forceRestart: boolean = false): void {
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
      if (prevAction && prevAction !== nextAction && fadeSec > 0.005) {
        prevAction.crossFadeTo(nextAction, fadeSec, false);
      } else if (prevAction && prevAction !== nextAction) {
        prevAction.stop();
      }
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
    const speed = (meta.clip.duration / Math.max(0.12, this.dashDuration)) * this.tuning.speedMultipliers.dash;
    this.playLocoClip('dash', speed, 0.04, forceRestart);
  }

  private playLmbFullBody(forceRestart: boolean): void {
    const key = this.tuning.lmbClipVariant === 'clip4_extended' ? 'lmb_clip4' : 'lmb_clip2';
    const meta = this.clipRegistry.get(key);
    if (!meta) return;
    const speed = (meta.clip.duration / Math.max(0.10, this.lmbDuration)) * this.tuning.speedMultipliers.lmb;
    this.playLocoClip(key, speed, 0.05, forceRestart);
  }

  private playRmbFullBody(forceRestart: boolean): void {
    const meta = this.clipRegistry.get('rmb');
    if (!meta) return;
    const speed =
      (meta.clip.duration / Math.max(0.14, this.rmbDuration * 0.55)) * this.tuning.speedMultipliers.rmb;
    this.playLocoClip('rmb', speed, 0.05, forceRestart);
  }

  private playUltimateClip(forceRestart: boolean): void {
    const key = this.tuning.ultClipVariant === 'clip5_left_arm' ? 'ultimate_clip5' : 'ultimate_clip1';
    const meta = this.clipRegistry.get(key);
    if (!meta) return;
    const speed = (meta.clip.duration / Math.max(0.35, this.ultDuration)) * this.tuning.speedMultipliers.ultimate;
    this.playLocoClip(key, speed, 0.08, forceRestart);
  }

  private startCombatOverlay(kind: 'lmb' | 'rmb'): void {
    if (!this.combatMixer) return;
    const key =
      kind === 'rmb'
        ? 'rmb_upper'
        : this.tuning.lmbClipVariant === 'clip4_extended'
          ? 'lmb_clip4_upper'
          : 'lmb_clip2_upper';

    const action = this.combatActions.get(key);
    if (!action) return;

    const prev = this.activeCombatKey ? this.combatActions.get(this.activeCombatKey) : undefined;
    if (prev && prev !== action) {
      prev.stop();
    }

    const dur = kind === 'rmb' ? Math.max(0.14, this.rmbDuration * 0.55) : Math.max(0.10, this.lmbDuration);
    const mult = kind === 'rmb' ? this.tuning.speedMultipliers.rmb : this.tuning.speedMultipliers.lmb;
    const speed = (action.getClip().duration / dur) * mult;

    action.enabled = true;
    action.setEffectiveTimeScale(speed);
    action.setEffectiveWeight(1.0);
    action.reset();
    action.play();

    this.activeCombatKey = key;
    this.upperOverlayState = kind;
    this.upperOverlayWeight = Math.max(this.upperOverlayWeight, 0.65);
  }

  private stopCombatOverlay(): void {
    if (this.activeCombatKey) {
      this.combatActions.get(this.activeCombatKey)?.stop();
    }
    this.activeCombatKey = '';
    this.upperOverlayState = 'none';
    this.upperOverlayWeight = 0;
  }

  private applyCombatUpperOverlay(dt: number, weight: number): void {
    if (!this.combatMixer || this.upperBodyBones.length === 0) return;

    // 1. Snapshot locomotion upper-body bone quaternions
    for (let i = 0; i < this.upperBodyBones.length; i++) {
      this.savedUpperQuats[i].copy(this.upperBodyBones[i].quaternion);
    }

    // 2. Evaluate combat upper-body action
    this.combatMixer.update(dt);

    // 3. Slerp blend upper-body bones between locomotion and combat gesture
    for (let i = 0; i < this.upperBodyBones.length; i++) {
      this.upperBodyBones[i].quaternion.slerpQuaternions(
        this.savedUpperQuats[i],
        this.upperBodyBones[i].quaternion,
        weight
      );
    }
  }

  private applyGlideTorsoAlignment(): void {
    const pitchRad = THREE.MathUtils.degToRad(this.tuning.glideTorsoPitchDeg - 18);
    if (Math.abs(pitchRad) < 0.002) return;
    if (this.spineNode) {
      this.scratchQuatPitch.setFromAxisAngle(this.scratchAxisX, pitchRad * 0.65);
      this.spineNode.quaternion.multiply(this.scratchQuatPitch);
    }
    if (this.spine1Node) {
      this.scratchQuatPitch.setFromAxisAngle(this.scratchAxisX, pitchRad * 0.35);
      this.spine1Node.quaternion.multiply(this.scratchQuatPitch);
    }
  }

  private syncWeaponPropVisibility(): void {
    const isLmbActive =
      this.currentState === 'lmb' ||
      this.upperOverlayState === 'lmb' ||
      this.previewState === 'lmb';
    const isRmbActive =
      this.currentState === 'rmb' ||
      this.upperOverlayState === 'rmb' ||
      this.previewState === 'rmb';

    if (this.gunPropGroup) {
      this.gunPropGroup.visible = this.tuning.showGunProp && isLmbActive && !isRmbActive;
    }
    if (this.swordPropGroup) {
      this.swordPropGroup.visible = this.tuning.showSwordProp && isRmbActive;
    }
  }

  private applyHitFlashTint(amount: number): void {
    for (let i = 0; i < this.modelMaterials.length; i++) {
      const mat = this.modelMaterials[i];
      if (amount > 0.01) {
        mat.color.copy(this.scratchWhite).lerp(this.scratchHitTint, amount * 0.75);
      } else {
        mat.color.copy(this.scratchWhite);
      }
    }
  }

  private spawnDashStreak(p: PlayerState): void {
    const intensity = this.tuning.dashVisualIntensity;
    if (intensity <= 0.05) return;

    const mat = new THREE.MeshBasicMaterial({
      color: Math.random() < 0.5 ? 0xfacc15 : 0x38bdf8,
      transparent: true,
      opacity: Math.min(0.85, 0.55 * intensity),
      blending: THREE.AdditiveBlending,
      depthWrite: false
    });
    const mesh = new THREE.Mesh(this.dashStreakGeo, mat);
    mesh.position.set(
      (Math.random() - 0.5) * 18,
      26 + Math.random() * 24,
      (Math.random() - 0.5) * 14
    );
    mesh.rotation.y = this.currentYaw;
    mesh.scale.set(0.9, 1.0 + intensity * 0.35, 1.8);
    // Attach in world-aligned player space by offsetting opposite dash direction
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
      const entry = this.dashStreakMeshes[i];
      this.group.remove(entry.mesh);
      (entry.mesh.material as THREE.Material).dispose();
    }
    this.dashStreakMeshes = [];
  }

  public deactivateAndPause(): void {
    this.group.visible = false;
    this.stopCombatOverlay();
    this.clearDashStreaks();
    if (this.gunPropGroup) this.gunPropGroup.visible = false;
    if (this.swordPropGroup) this.swordPropGroup.visible = false;
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
    for (const g of this.propGeometries) g.dispose();
    for (const m of this.propMaterials) m.dispose();
    this.dashStreakGeo.dispose();

    this.modelGeometries = [];
    this.modelMaterials = [];
    this.modelTextures = [];
    this.propGeometries = [];
    this.propMaterials = [];
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

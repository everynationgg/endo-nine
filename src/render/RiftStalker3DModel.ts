import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import * as SkeletonUtils from 'three/examples/jsm/utils/SkeletonUtils.js';
import type { EnemyState, Vector2 } from '../sim/types';
import type { TerrainSystem } from '../sim/TerrainSystem';

const RIFT_STALKER_GLB_URL = '/assets/models/rift_stalker_3d.glb';
const RIFT_STALKER_WORLD_SCALE = 410.0; // Scales ~0.95m tail arch -> ~390u & ~0.86m leg span -> ~350u

const LEG_PREFS = [
  { pref: 'Leg_Front_L', footOffX: 62, footOffZ: 142 },
  { pref: 'Leg_Front_R', footOffX: -69, footOffZ: 131 },
  { pref: 'Leg_MidSlash_L', footOffX: 169, footOffZ: 27 },
  { pref: 'Leg_MidSlash_R', footOffX: -169, footOffZ: -9 },
  { pref: 'Leg_Rear_L', footOffX: 35, footOffZ: -65 },
  { pref: 'Leg_Rear_R', footOffX: -32, footOffZ: -83 }
] as const;

interface CachedRiftStalkerAsset {
  scene: THREE.Object3D;
  clips: THREE.AnimationClip[];
}

/**
 * Animated 3D Boss Controller for Rift Stalker (`public/assets/models/rift_stalker_3d.glb`).
 * Combines:
 * - Pre-authored Blender skeletal clips (Idle, Walk_Tripod, Skill 1..4, Hit_React, Death)
 * - Terrain-aware 6-leg ground height adaptation & body tilt stabilization
 * - Procedural multi-segment tail aiming for Skill 3 (Tracking Tail Laser)
 * - Anatomical socket queries (`getTailEmitterWorldPos`) & zero per-frame allocations
 */
export class RiftStalker3DModel {
  private static assetCache: CachedRiftStalkerAsset | null = null;
  private static preloadPromise: Promise<CachedRiftStalkerAsset | null> | null = null;

  public readonly group: THREE.Group;
  private readonly modelRoot: THREE.Group;
  private readonly terrain: TerrainSystem | null;

  private instanceScene: THREE.Object3D | null = null;
  private mixer: THREE.AnimationMixer | null = null;
  private actions = new Map<string, THREE.AnimationAction>();
  private boneMap = new Map<string, THREE.Object3D>();
  private legFemurs: Array<{ node: THREE.Object3D; side: number; offX: number; offZ: number }> = [];
  private legTibias: Array<THREE.Object3D | null> = [];
  private tailChain: THREE.Object3D[] = [];
  private tailHeadNode: THREE.Object3D | null = null;
  private tailFiveNode: THREE.Object3D | null = null;
  private tailEmitterNode: THREE.Object3D | null = null;
  private dorsalSpineNodes: THREE.Object3D[] = [];
  private bodyCogNode: THREE.Object3D | null = null;

  private bodyMat: THREE.MeshStandardMaterial | null = null;
  private tailMat: THREE.MeshStandardMaterial | null = null;
  private allMaterials: THREE.MeshStandardMaterial[] = [];

  private activeClipKey = '';
  private currentYaw = 0;
  private smoothedGroundY = 0;
  private groundYInitialized = false;
  private smoothedPitch = 0;
  private smoothedRoll = 0;
  private footstepPhaseAccum = 0;
  private prevHealth = -1;
  private hitFlashTimer = 0;
  private disposed = false;

  // Scratch math (zero GC allocations)
  private readonly scratchQuat = new THREE.Quaternion();
  private readonly scratchWorldQ = new THREE.Quaternion();
  private readonly scratchParentWorldQ = new THREE.Quaternion();
  private readonly scratchDeltaQ = new THREE.Quaternion();
  private readonly scratchHeadPos = new THREE.Vector3();
  private readonly scratchEmitPos = new THREE.Vector3();
  private readonly scratchCurFwd = new THREE.Vector3();
  private readonly scratchDesiredDir = new THREE.Vector3();
  private readonly scratchTargetWorld = new THREE.Vector3();
  private readonly scratchFootH: number[] = [0, 0, 0, 0, 0, 0];
  private readonly scratchWhite = new THREE.Color(0xffffff);
  private readonly scratchHitTint = new THREE.Color(0xff4d6d);
  private readonly scratchEmissiveWhite = new THREE.Color(0xffffff);
  private readonly scratchEmissiveCyan = new THREE.Color(0x38bdf8);
  private readonly scratchEmissiveCrimson = new THREE.Color(0xf43f5e);

  public static preload(): Promise<CachedRiftStalkerAsset | null> {
    if (this.assetCache) return Promise.resolve(this.assetCache);
    if (this.preloadPromise) return this.preloadPromise;

    const loader = new GLTFLoader();
    this.preloadPromise = loader
      .loadAsync(RIFT_STALKER_GLB_URL)
      .then((gltf) => {
        gltf.scene.traverse((obj) => {
          if ((obj as THREE.Mesh).isMesh) {
            const mesh = obj as THREE.Mesh;
            mesh.frustumCulled = false;
            mesh.castShadow = false;
            mesh.receiveShadow = false;
            const mats = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
            for (const m of mats) {
              const sm = m as THREE.MeshStandardMaterial;
              if (!sm) continue;
              if (sm.map) sm.map.colorSpace = THREE.SRGBColorSpace;
              if (sm.emissiveMap) {
                sm.emissiveMap.colorSpace = THREE.SRGBColorSpace;
                sm.emissive.setHex(0xffffff);
                sm.emissiveIntensity = 1.45;
              }
            }
          }
        });
        this.assetCache = {
          scene: gltf.scene,
          clips: gltf.animations || []
        };
        return this.assetCache;
      })
      .catch((err) => {
        console.warn('[RiftStalker3DModel] Failed to preload GLB:', err);
        this.preloadPromise = null;
        return null;
      });
    return this.preloadPromise;
  }

  constructor(terrain?: TerrainSystem) {
    this.terrain = terrain || null;
    this.group = new THREE.Group();
    this.group.name = 'RiftStalker3D_Group';

    this.modelRoot = new THREE.Group();
    this.modelRoot.name = 'RiftStalker3D_ModelRoot';
    this.modelRoot.rotation.order = 'YXZ';
    this.modelRoot.scale.setScalar(RIFT_STALKER_WORLD_SCALE);
    this.group.add(this.modelRoot);

    void RiftStalker3DModel.preload().then((asset) => {
      if (!this.disposed && asset) {
        this.mountAsset(asset);
      }
    });
  }

  private mountAsset(asset: CachedRiftStalkerAsset): void {
    const clone = SkeletonUtils.clone(asset.scene);
    this.instanceScene = clone;
    this.modelRoot.add(clone);

    clone.traverse((obj) => {
      if ((obj as THREE.Bone).isBone) {
        this.boneMap.set(obj.name, obj);
      }
      if ((obj as THREE.Mesh).isMesh) {
        const mesh = obj as THREE.Mesh;
        mesh.frustumCulled = false;
        const mats = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
        const clonedMats = mats.map((m) => {
          const cm = (m as THREE.MeshStandardMaterial).clone();
          this.allMaterials.push(cm);
          if (mesh.name.includes('Body')) this.bodyMat = cm;
          if (mesh.name.includes('Tail')) this.tailMat = cm;
          return cm;
        });
        mesh.material = Array.isArray(mesh.material) ? clonedMats : clonedMats[0];
      }
    });

    this.bodyCogNode = this.boneMap.get('Body_COG') || null;
    this.tailHeadNode = this.boneMap.get('Tail_Head') || null;
    this.tailFiveNode = this.boneMap.get('Tail_05') || null;
    this.tailEmitterNode = this.boneMap.get('Tail_LaserEmitter') || this.tailHeadNode;
    this.tailChain = ['Tail_01', 'Tail_02', 'Tail_03', 'Tail_04', 'Tail_05', 'Tail_Head']
      .map((n) => this.boneMap.get(n))
      .filter((b): b is THREE.Object3D => Boolean(b));
    this.dorsalSpineNodes = ['DorsalSpine_FL', 'DorsalSpine_FR', 'DorsalSpine_RL', 'DorsalSpine_RR']
      .map((n) => this.boneMap.get(n))
      .filter((b): b is THREE.Object3D => Boolean(b));

    this.legFemurs = [];
    this.legTibias = [];
    for (const lp of LEG_PREFS) {
      const fem = this.boneMap.get(`${lp.pref}_Femur`);
      const tib = this.boneMap.get(`${lp.pref}_Tibia`) || null;
      if (fem) {
        this.legFemurs.push({
          node: fem,
          side: lp.pref.endsWith('_L') ? 1 : -1,
          offX: lp.footOffX,
          offZ: lp.footOffZ
        });
        this.legTibias.push(tib);
      }
    }

    this.mixer = new THREE.AnimationMixer(clone);
    const clipConfig: Array<{ name: string; loop: boolean }> = [
      { name: 'Idle', loop: true },
      { name: 'Walk_Tripod', loop: true },
      { name: 'Skill1_Leap_Slash', loop: false },
      { name: 'Skill2_Tail_Sweep', loop: false },
      { name: 'Skill3_Laser_Posture', loop: true },
      { name: 'Skill4_Spine_Barrage', loop: false },
      { name: 'Hit_React', loop: false },
      { name: 'Death', loop: false }
    ];

    for (const cfg of clipConfig) {
      const clip =
        asset.clips.find((c) => c.name === cfg.name) ||
        asset.clips.find((c) => c.name.toLowerCase() === cfg.name.toLowerCase());
      if (!clip) continue;
      const act = this.mixer.clipAction(clip);
      act.setLoop(cfg.loop ? THREE.LoopRepeat : THREE.LoopOnce, cfg.loop ? Infinity : 1);
      act.clampWhenFinished = !cfg.loop;
      this.actions.set(cfg.name, act);
    }

    this.playClip('Idle', 1.0, 0.05, true);
  }

  private playClip(name: string, speed: number, fadeSec: number, forceRestart: boolean): void {
    const next = this.actions.get(name);
    if (!next) return;
    const prev = this.activeClipKey ? this.actions.get(this.activeClipKey) : undefined;
    next.enabled = true;
    next.setEffectiveTimeScale(speed);
    next.setEffectiveWeight(1.0);
    if (forceRestart || this.activeClipKey !== name) {
      next.reset();
      next.play();
      if (prev && prev !== next && fadeSec > 0.005) {
        prev.crossFadeTo(next, fadeSec, false);
      } else if (prev && prev !== next) {
        prev.stop();
      }
    }
    this.activeClipKey = name;
  }

  public getTailEmitterWorldPos(out: THREE.Vector3): THREE.Vector3 {
    if (this.tailEmitterNode) {
      this.group.updateWorldMatrix(true, true);
      this.tailEmitterNode.getWorldPosition(out);
      return out;
    }
    // Fallback before async GLB finishes mounting
    const fwdX = Math.sin(this.currentYaw) * 95;
    const fwdZ = Math.cos(this.currentYaw) * 95;
    out.set(this.group.position.x + fwdX, this.group.position.y + 295, this.group.position.z + fwdZ);
    return out;
  }

  public getMouthWorldPos(out: THREE.Vector3): THREE.Vector3 {
    return this.getTailEmitterWorldPos(out);
  }

  public getDorsalSpineWorldPos(idx: number, out: THREE.Vector3): THREE.Vector3 {
    if (this.dorsalSpineNodes.length > 0) {
      const node = this.dorsalSpineNodes[idx % this.dorsalSpineNodes.length];
      node.getWorldPosition(out);
      return out;
    }
    out.set(this.group.position.x, this.group.position.y + 205, this.group.position.z);
    return out;
  }

  public update(
    e: EnemyState,
    dt: number,
    playerPos: Vector2,
    elapsedSec: number
  ): { footstepTriggered: boolean } {
    if (!this.groundYInitialized) {
      this.smoothedGroundY = e.z;
      this.groundYInitialized = true;
    }

    if (this.prevHealth >= 0 && e.health < this.prevHealth - 4) {
      this.hitFlashTimer = 0.14;
    }
    this.prevHealth = e.health;
    if (this.hitFlashTimer > 0) this.hitFlashTimer = Math.max(0, this.hitFlashTimer - dt);

    // 1. Smooth 360-degree Yaw Steering toward velocity / laser target / player
    let targetYaw = this.currentYaw;
    if (e.titanState === 'tail_laser' && e.titanLaserAngle !== undefined) {
      targetYaw = Math.atan2(Math.cos(e.titanLaserAngle), Math.sin(e.titanLaserAngle));
    } else if (e.titanState === 'walk' && Math.hypot(e.velocity.x, e.velocity.y) > 10) {
      targetYaw = Math.atan2(e.velocity.x, e.velocity.y);
    } else if (e.titanState !== 'dying') {
      const dx = playerPos.x - e.pos.x;
      const dy = playerPos.y - e.pos.y;
      if (Math.hypot(dx, dy) > 8) {
        targetYaw = Math.atan2(dx, dy);
      }
    }

    let diff = targetYaw - this.currentYaw;
    while (diff < -Math.PI) diff += Math.PI * 2;
    while (diff > Math.PI) diff -= Math.PI * 2;
    const turnSpeed = e.titanState === 'tail_laser' ? 5.2 : e.titanState === 'tail_sweep_shards' ? 3.5 : 5.2;
    this.currentYaw += diff * Math.min(1.0, dt * turnSpeed);

    // 2. 6-Foot Terrain Grounding & Slope Alignment (prevents floating on flat ground or slopes)
    this.applyTerrainFootAdaptation(e, dt);
    this.group.position.set(e.pos.x, this.smoothedGroundY, e.pos.y);
    this.modelRoot.rotation.set(this.smoothedPitch, this.currentYaw, this.smoothedRoll, 'YXZ');

    // 3. Drive skeletal AnimationMixer from authoritative Boss State
    let footstepTriggered = false;
    if (this.mixer) {
      const st = e.titanState || 'idle';
      if (st === 'dying') {
        this.playClip('Death', 1.0, 0.12, false);
      } else if (st === 'walk') {
        const speedMag = Math.hypot(e.velocity.x, e.velocity.y);
        const walkRate = Math.max(0.75, Math.min(1.85, speedMag / 105));
        this.playClip('Walk_Tripod', walkRate, 0.14, false);
        const prevPhase = Math.floor(this.footstepPhaseAccum);
        this.footstepPhaseAccum += dt * 2.4 * walkRate;
        if (Math.floor(this.footstepPhaseAccum) > prevPhase) {
          footstepTriggered = true;
        }
      } else if (st === 'leap_dual_slash' || st === 'leap') {
        this.playClip('Skill1_Leap_Slash', 1.0, 0.08, false);
      } else if (st === 'tail_sweep_shards') {
        this.playClip('Skill2_Tail_Sweep', 1.0, 0.08, false);
      } else if (st === 'tail_laser') {
        this.playClip('Skill3_Laser_Posture', 1.0, 0.12, false);
      } else if (st === 'dorsal_spine_barrage') {
        this.playClip('Skill4_Spine_Barrage', 1.0, 0.10, false);
      } else {
        this.playClip('Idle', 1.0, 0.16, false);
      }

      this.mixer.update(dt);

      // 4. Procedural World-Space Tail Head Aim (never twists intermediate tail arch sideways)
      if (st === 'tail_laser') {
        this.applyProceduralTailAim(e, dt, playerPos);
      }
      this.applyEmissiveAndHitFeedback(e, elapsedSec);
    }

    return { footstepTriggered };
  }

  private applyTerrainFootAdaptation(e: EnemyState, dt: number): void {
    const isAirborneOrEmerging = e.isBossLeaping || e.titanState === 'emerging' || e.titanState === 'dying';
    if (!this.terrain || isAirborneOrEmerging) {
      const targetY = e.titanState === 'emerging' ? e.z : e.z - 6.0;
      this.smoothedGroundY += (targetY - this.smoothedGroundY) * Math.min(1.0, dt * 16);
      this.smoothedPitch += (0 - this.smoothedPitch) * Math.min(1.0, dt * 8);
      this.smoothedRoll += (0 - this.smoothedRoll) * Math.min(1.0, dt * 8);
      return;
    }

    const cosY = Math.cos(this.currentYaw);
    const sinY = Math.sin(this.currentYaw);

    let sumFront = 0;
    let sumRear = 0;
    let sumLeft = 0;
    let sumRight = 0;
    let sumAll = 0;
    let lowestH = Infinity;

    for (let i = 0; i < LEG_PREFS.length; i++) {
      const lp = LEG_PREFS[i];
      const wx = e.pos.x + lp.footOffX * cosY + lp.footOffZ * sinY;
      const wy = e.pos.y + (-lp.footOffX * sinY + lp.footOffZ * cosY);
      const fh = this.terrain.getFastVisualHeight(wx, wy, e.groundZ + 80, 56);
      this.scratchFootH[i] = fh;
      sumAll += fh;
      if (fh < lowestH) lowestH = fh;
      if (i < 2) sumFront += fh;
      else if (i >= 4) sumRear += fh;
      if (i % 2 === 0) sumLeft += fh;
      else sumRight += fh;
    }

    const avgFront = sumFront * 0.5;
    const avgRear = sumRear * 0.5;
    const avgLeft = sumLeft * 0.5;
    const avgRight = sumRight * 0.5;

    // Fit pitch/roll plane across wide 6-foot stance so body hugs slopes cleanly
    const targetPitch = THREE.MathUtils.clamp(-Math.atan2(avgFront - avgRear, 215), -0.34, 0.34);
    const targetRoll = THREE.MathUtils.clamp(Math.atan2(avgLeft - avgRight, 210), -0.30, 0.30);

    // Anchor Y to lower support plane with 7u claw-contact sink so zero legs hover above flat ground or slopes
    const centerH = this.terrain.getFastVisualHeight(e.pos.x, e.pos.y, e.groundZ + 60, 56);
    const avgFootH = sumAll / LEG_PREFS.length;
    const supportBlend = Math.min(centerH, avgFootH * 0.65 + lowestH * 0.35);
    const targetGroundY = Math.max(centerH - 42, Math.min(centerH + 6, supportBlend)) - 7.0;

    const blend = Math.min(1.0, dt * 14.0);
    this.smoothedGroundY += (targetGroundY - this.smoothedGroundY) * blend;
    this.smoothedPitch += (targetPitch - this.smoothedPitch) * blend;
    this.smoothedRoll += (targetRoll - this.smoothedRoll) * blend;
  }

  private applyProceduralTailAim(e: EnemyState, dt: number, playerPos: Vector2): void {
    if (!this.tailHeadNode || !this.tailEmitterNode) return;
    this.group.updateWorldMatrix(true, true);

    this.tailHeadNode.getWorldPosition(this.scratchHeadPos);
    this.tailEmitterNode.getWorldPosition(this.scratchEmitPos);
    e.titanLaserOrigin = {
      x: this.scratchEmitPos.x,
      y: this.scratchEmitPos.z,
      z: this.scratchEmitPos.y
    };

    const t = e.titanLaserTarget;
    const tx = t ? t.x : playerPos.x;
    const ty = t ? t.z : e.z + 44;
    const tz = t ? t.y : playerPos.y;
    this.scratchTargetWorld.set(tx, ty, tz);

    this.scratchCurFwd.subVectors(this.scratchEmitPos, this.scratchHeadPos);
    if (this.scratchCurFwd.lengthSq() < 1e-4) return;
    this.scratchCurFwd.normalize();

    this.scratchDesiredDir.subVectors(this.scratchTargetWorld, this.scratchHeadPos);
    if (this.scratchDesiredDir.lengthSq() < 1e-4) return;
    this.scratchDesiredDir.normalize();

    // Clamp max world-space head bend to keep tail anatomy natural without neck snapping
    const dot = THREE.MathUtils.clamp(this.scratchCurFwd.dot(this.scratchDesiredDir), -1, 1);
    const fullAngle = Math.acos(dot);
    if (fullAngle > 0.002) {
      const clampedT = Math.min(1.0, 0.56 / fullAngle);
      if (clampedT < 1.0) {
        this.scratchDesiredDir.lerpVectors(this.scratchCurFwd, this.scratchDesiredDir, clampedT).normalize();
      }
      this.scratchDeltaQ.setFromUnitVectors(this.scratchCurFwd, this.scratchDesiredDir);

      // Apply 25% assist on Tail_05 and 100% remaining aim on Tail_Head in parent local space
      const applyBoneAim = (bone: THREE.Object3D, weight: number) => {
        if (!bone.parent) return;
        bone.getWorldQuaternion(this.scratchWorldQ);
        bone.parent.getWorldQuaternion(this.scratchParentWorldQ);
        this.scratchQuat.identity().slerp(this.scratchDeltaQ, weight);
        this.scratchWorldQ.premultiply(this.scratchQuat);
        this.scratchParentWorldQ.invert().multiply(this.scratchWorldQ);
        bone.quaternion.slerp(this.scratchParentWorldQ, Math.min(1.0, dt * 16.0));
        bone.updateMatrixWorld(true);
      };

      if (this.tailFiveNode) {
        applyBoneAim(this.tailFiveNode, 0.30);
        this.tailHeadNode.getWorldPosition(this.scratchHeadPos);
        this.tailEmitterNode.getWorldPosition(this.scratchEmitPos);
        this.scratchCurFwd.subVectors(this.scratchEmitPos, this.scratchHeadPos).normalize();
        this.scratchDesiredDir.subVectors(this.scratchTargetWorld, this.scratchHeadPos).normalize();
        this.scratchDeltaQ.setFromUnitVectors(this.scratchCurFwd, this.scratchDesiredDir);
      }
      applyBoneAim(this.tailHeadNode, 1.0);
      this.tailEmitterNode.getWorldPosition(this.scratchEmitPos);
      e.titanLaserOrigin = {
        x: this.scratchEmitPos.x,
        y: this.scratchEmitPos.z,
        z: this.scratchEmitPos.y
      };
    }
  }

  private applyEmissiveAndHitFeedback(e: EnemyState, elapsedSec: number): void {
    const hitAmt = this.hitFlashTimer > 0 ? this.hitFlashTimer / 0.14 : 0;
    for (let i = 0; i < this.allMaterials.length; i++) {
      const mat = this.allMaterials[i];
      if (hitAmt > 0.01) {
        mat.color.copy(this.scratchWhite).lerp(this.scratchHitTint, hitAmt * 0.65);
      } else {
        mat.color.copy(this.scratchWhite);
      }
    }

    const pulse = 0.5 + 0.5 * Math.sin(elapsedSec * 16.0);
    if (this.tailMat && this.tailMat.emissiveMap) {
      if (e.titanState === 'tail_laser') {
        this.tailMat.emissive.copy(this.scratchEmissiveWhite).lerp(this.scratchEmissiveCrimson, 0.6);
        this.tailMat.emissiveIntensity = e.titanSubPhase === 'charge' ? 1.8 + pulse * 1.6 : 2.6 + pulse * 0.8;
      } else if (e.titanState === 'tail_sweep_shards') {
        this.tailMat.emissive.copy(this.scratchEmissiveWhite).lerp(this.scratchEmissiveCyan, 0.55);
        this.tailMat.emissiveIntensity = 2.0 + pulse * 0.9;
      } else {
        this.tailMat.emissive.copy(this.scratchEmissiveWhite);
        this.tailMat.emissiveIntensity = 1.45;
      }
    }

    if (this.bodyMat && this.bodyMat.emissiveMap) {
      if (e.titanState === 'dorsal_spine_barrage') {
        this.bodyMat.emissive.copy(this.scratchEmissiveWhite).lerp(this.scratchEmissiveCyan, 0.65);
        this.bodyMat.emissiveIntensity = 2.2 + pulse * 1.4;
      } else {
        this.bodyMat.emissive.copy(this.scratchEmissiveWhite);
        this.bodyMat.emissiveIntensity = 1.45;
      }
    }
  }

  public dispose(): void {
    this.disposed = true;
    if (this.mixer) {
      this.mixer.stopAllAction();
      if (this.instanceScene) this.mixer.uncacheRoot(this.instanceScene);
      this.mixer = null;
    }
    if (this.instanceScene) {
      this.modelRoot.remove(this.instanceScene);
      this.instanceScene = null;
    }
    for (const m of this.allMaterials) m.dispose();
    this.allMaterials = [];
    this.actions.clear();
    this.boneMap.clear();
  }
}

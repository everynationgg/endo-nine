import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import * as SkeletonUtils from 'three/examples/jsm/utils/SkeletonUtils.js';
import type { EnemyState } from '../sim/types';
import { ENEMY_COMBAT_BALANCE } from '../sim/EnemyDefs';
import type { TerrainSystem } from '../sim/TerrainSystem';
import type { EnemyCombatVFX } from './EnemyCombatVFX';

type MigratedEnemyType = 'crawler' | 'wasp' | 'spitter' | 'elite' | 'boss' | 'broodling';

const MODEL_PATHS: Record<MigratedEnemyType, string> = {
  crawler: '/assets/models/oreblade_3d.glb',
  wasp: '/assets/models/driftworm_3d.glb',
  spitter: '/assets/models/slythven_3d.glb',
  elite: '/assets/models/magmir_3d.glb',
  boss: '/assets/models/brood_queen_3d.glb',
  broodling: '/assets/models/broodling_3d.glb'
};

const WORLD_SCALES: Record<MigratedEnemyType, number> = {
  crawler: 94.0,
  wasp: 94.0,
  spitter: 252.0,
  elite: 292.0,
  boss: 246.0,
  broodling: 183.0
};

interface CachedEnemyGLB {
  scene: THREE.Object3D;
  clips: THREE.AnimationClip[];
}

export interface Enemy3DFrameInfo {
  ready: boolean;
  hpTopOffset: number;
  spikePosL?: THREE.Vector3;
  spikePosR?: THREE.Vector3;
  birthPos?: THREE.Vector3;
}

interface TendrilChain {
  bones: THREE.Object3D[];
}

interface PooledEnemyRig {
  type: MigratedEnemyType;
  inUse: boolean;
  group: THREE.Group;
  modelRoot: THREE.Group;
  clone: THREE.Object3D;
  mixer: THREE.AnimationMixer;
  actions: Map<string, THREE.AnimationAction>;
  boneMap: Map<string, THREE.Object3D>;
  materials: THREE.MeshStandardMaterial[];
  baseEmissive: THREE.Color[];
  baseEmissiveIntensity: number[];
  activeClip: string;
  currentYaw: number;
  bladeSpinAngle: number;
  bladeBlurAccum: number;
  footstepAccum: number;
  hitFlashTimer: number;
  hitReactTimer: number;
  prevHealth: number;
  smoothedGroundY: number;
  groundYInit: boolean;
  smoothedPitch: number;
  smoothedRoll: number;
  slitherHistory: Float32Array;
  slitherCursor: number;
  slitherAccum: number;
  smokeAccum: number;
  punchSwungKey: string;
  // Dying state for smooth linger
  dying: boolean;
  deathTimer: number;
  deathDuration: number;
  // Cached anatomical bone refs
  bladeRingBone: THREE.Object3D | null;
  oralOrganBone: THREE.Object3D | null;
  spitSocketBone: THREE.Object3D | null;
  exhaustL: THREE.Object3D | null;
  exhaustR: THREE.Object3D | null;
  fistL: THREE.Object3D | null;
  fistR: THREE.Object3D | null;
  spikeL: THREE.Object3D | null;
  spikeR: THREE.Object3D | null;
  birthSocket: THREE.Object3D | null;
  tailChain: THREE.Object3D[];
  tendrilChains: TendrilChain[];
}

const SLITHER_HISTORY_LEN = 24;

export class Stage1Enemy3DManager {
  private static readonly cache = new Map<MigratedEnemyType, CachedEnemyGLB>();
  private static readonly pending = new Map<MigratedEnemyType, Promise<CachedEnemyGLB | null>>();
  private static preloadedAll = false;

  private readonly scene: THREE.Scene;
  private readonly terrain: TerrainSystem;
  private readonly vfx: EnemyCombatVFX;

  private readonly activeByEnemyId = new Map<string, PooledEnemyRig>();
  private readonly freePool = new Map<MigratedEnemyType, PooledEnemyRig[]>();
  private readonly dyingRigs: PooledEnemyRig[] = [];
  private disposed = false;

  // Shared zero-GC scratch objects
  private readonly scratchQ = new THREE.Quaternion();
  private readonly scratchAxisX = new THREE.Vector3(1, 0, 0);
  private readonly scratchAxisY = new THREE.Vector3(0, 1, 0);
  private readonly scratchAxisZ = new THREE.Vector3(0, 0, 1);
  private readonly scratchVecA = new THREE.Vector3();
  private readonly scratchVecB = new THREE.Vector3();
  private readonly scratchHitTint = new THREE.Color(0xff4d6d);
  private readonly scratchChillTint = new THREE.Color(0x67e8f9);
  private readonly scratchWhite = new THREE.Color(0xffffff);
  private readonly scratchSpitOut = new THREE.Vector3();
  private readonly scratchPunchOut = new THREE.Vector3();
  private readonly scratchSpikeLOut = new THREE.Vector3();
  private readonly scratchSpikeROut = new THREE.Vector3();
  private readonly scratchBirthOut = new THREE.Vector3();
  private frameCounter = 0;

  constructor(scene: THREE.Scene, terrain: TerrainSystem, vfx: EnemyCombatVFX) {
    this.scene = scene;
    this.terrain = terrain;
    this.vfx = vfx;
  }

  public static isMigratedType(e: EnemyState): boolean {
    if (e.isStage1Titan) return false;
    return (
      e.type === 'crawler' ||
      e.type === 'wasp' ||
      e.type === 'spitter' ||
      e.type === 'elite' ||
      e.type === 'boss' ||
      e.type === 'broodling'
    );
  }

  public static preloadAll(): Promise<void> {
    if (this.preloadedAll) return Promise.resolve();
    this.preloadedAll = true;
    const types: MigratedEnemyType[] = ['crawler', 'wasp', 'spitter', 'elite', 'boss', 'broodling'];
    return Promise.all(types.map((t) => this.preloadType(t))).then(() => undefined);
  }

  private static preloadType(type: MigratedEnemyType): Promise<CachedEnemyGLB | null> {
    const existing = this.cache.get(type);
    if (existing) return Promise.resolve(existing);
    const inFlight = this.pending.get(type);
    if (inFlight) return inFlight;

    const loader = new GLTFLoader();
    const prom = loader
      .loadAsync(MODEL_PATHS[type])
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
                sm.emissiveIntensity = 1.35;
              }
            }
          }
        });
        const entry: CachedEnemyGLB = {
          scene: gltf.scene,
          clips: gltf.animations || []
        };
        this.cache.set(type, entry);
        return entry;
      })
      .catch((err) => {
        console.warn(`[Stage1Enemy3DManager] Failed loading ${type}:`, err);
        this.pending.delete(type);
        return null;
      });
    this.pending.set(type, prom);
    return prom;
  }

  private createRig(type: MigratedEnemyType, asset: CachedEnemyGLB): PooledEnemyRig {
    const group = new THREE.Group();
    group.name = `Stage1Enemy3D_${type}`;
    const modelRoot = new THREE.Group();
    modelRoot.rotation.order = 'YXZ';
    modelRoot.scale.setScalar(WORLD_SCALES[type]);
    group.add(modelRoot);

    const clone = SkeletonUtils.clone(asset.scene);
    modelRoot.add(clone);

    const boneMap = new Map<string, THREE.Object3D>();
    const materials: THREE.MeshStandardMaterial[] = [];
    const baseEmissive: THREE.Color[] = [];
    const baseEmissiveIntensity: number[] = [];

    clone.traverse((obj) => {
      if (obj.name) {
        boneMap.set(obj.name, obj);
      }
      if ((obj as THREE.Mesh).isMesh) {
        const mesh = obj as THREE.Mesh;
        mesh.frustumCulled = false;
        mesh.castShadow = false;
        mesh.receiveShadow = false;
        const cloned = Array.isArray(mesh.material)
          ? mesh.material.map((m) => m.clone())
          : mesh.material.clone();
        mesh.material = cloned;
        const matArr = Array.isArray(cloned) ? cloned : [cloned];
        for (const mat of matArr) {
          const sm = mat as THREE.MeshStandardMaterial;
          if (!sm) continue;
          materials.push(sm);
          baseEmissive.push(sm.emissive ? sm.emissive.clone() : new THREE.Color(0x000000));
          baseEmissiveIntensity.push(sm.emissiveIntensity ?? 1.0);
        }
      }
    });

    const mixer = new THREE.AnimationMixer(clone);
    const actions = new Map<string, THREE.AnimationAction>();
    for (const clip of asset.clips) {
      const action = mixer.clipAction(clip);
      actions.set(clip.name, action);
    }

    const tailChain: THREE.Object3D[] = [];
    for (let t = 1; t <= 8; t++) {
      const tb = boneMap.get(`Tail_0${t}`);
      if (tb) tailChain.push(tb);
    }

    const tendrilChains: TendrilChain[] = [];
    for (const prefix of ['Tendril_FL', 'Tendril_FR', 'Tendril_SL', 'Tendril_SR', 'Tendril_RL', 'Tendril_RR']) {
      const b1 = boneMap.get(`${prefix}_01`);
      const b2 = boneMap.get(`${prefix}_02`);
      const b3 = boneMap.get(`${prefix}_03`);
      const list: THREE.Object3D[] = [];
      if (b1) list.push(b1);
      if (b2) list.push(b2);
      if (b3) list.push(b3);
      if (list.length > 0) tendrilChains.push({ bones: list });
    }

    const rig: PooledEnemyRig = {
      type,
      inUse: true,
      group,
      modelRoot,
      clone,
      mixer,
      actions,
      boneMap,
      materials,
      baseEmissive,
      baseEmissiveIntensity,
      activeClip: '',
      currentYaw: 0,
      bladeSpinAngle: Math.random() * Math.PI * 2,
      bladeBlurAccum: Math.random() * 0.1,
      footstepAccum: 0,
      hitFlashTimer: 0,
      hitReactTimer: 0,
      prevHealth: -1,
      smoothedGroundY: 0,
      groundYInit: false,
      smoothedPitch: 0,
      smoothedRoll: 0,
      slitherHistory: new Float32Array(SLITHER_HISTORY_LEN),
      slitherCursor: 0,
      slitherAccum: 0,
      smokeAccum: Math.random() * 0.1,
      punchSwungKey: '',
      dying: false,
      deathTimer: 0,
      deathDuration: 0.65,
      bladeRingBone: boneMap.get('Blade_Ring') || null,
      oralOrganBone: boneMap.get('Oral_Organ') || null,
      spitSocketBone: boneMap.get('Spit_Socket') || null,
      exhaustL: boneMap.get('Exhaust_Socket_L') || boneMap.get('Exhaust_L') || null,
      exhaustR: boneMap.get('Exhaust_Socket_R') || boneMap.get('Exhaust_R') || null,
      fistL: boneMap.get('Fist_Socket_L') || boneMap.get('Arm_L_Hand') || null,
      fistR: boneMap.get('Fist_Socket_R') || boneMap.get('Arm_R_Hand') || null,
      spikeL: boneMap.get('Spike_Socket_L') || boneMap.get('Head_Crown') || null,
      spikeR: boneMap.get('Spike_Socket_R') || boneMap.get('Head_Crown') || null,
      birthSocket: boneMap.get('Brood_Birth_Socket') || boneMap.get('Abdomen_02') || null,
      tailChain,
      tendrilChains
    };

    return rig;
  }

  private acquireRig(e: EnemyState): PooledEnemyRig | null {
    const existing = this.activeByEnemyId.get(e.id);
    if (existing) return existing;

    const type = e.type as MigratedEnemyType;
    const pool = this.freePool.get(type);
    let rig: PooledEnemyRig | undefined = pool?.pop();

    if (!rig) {
      const asset = Stage1Enemy3DManager.cache.get(type);
      if (!asset) {
        void Stage1Enemy3DManager.preloadType(type);
        return null;
      }
      rig = this.createRig(type, asset);
    }

    rig.inUse = true;
    rig.dying = false;
    rig.deathTimer = 0;
    rig.activeClip = '';
    rig.prevHealth = e.health;
    rig.hitFlashTimer = 0;
    rig.hitReactTimer = 0;
    rig.groundYInit = false;
    rig.smoothedPitch = 0;
    rig.smoothedRoll = 0;
    rig.punchSwungKey = '';
    const initYaw = Math.atan2(e.velocity.x || 0, e.velocity.y || 1);
    rig.currentYaw = initYaw;
    rig.slitherHistory.fill(initYaw);
    rig.group.visible = true;
    this.scene.add(rig.group);
    this.activeByEnemyId.set(e.id, rig);
    return rig;
  }

  private returnRigToPool(rig: PooledEnemyRig): void {
    rig.inUse = false;
    rig.dying = false;
    rig.group.visible = false;
    this.scene.remove(rig.group);
    let list = this.freePool.get(rig.type);
    if (!list) {
      list = [];
      this.freePool.set(rig.type, list);
    }
    list.push(rig);
  }

  public releaseEnemy(id: string, playDeath = true): void {
    const rig = this.activeByEnemyId.get(id);
    if (!rig) return;
    this.activeByEnemyId.delete(id);

    if (playDeath && rig.type !== 'broodling' && rig.actions.has('Death') && this.dyingRigs.length < 14) {
      rig.dying = true;
      rig.deathTimer = 0;
      rig.deathDuration = rig.type === 'elite' || rig.type === 'boss' ? 0.85 : 0.62;
      this.setClip(rig, 'Death', 0.08, false, 1.0);
      this.dyingRigs.push(rig);
      return;
    }

    this.returnRigToPool(rig);
  }

  private setClip(
    rig: PooledEnemyRig,
    clipName: string,
    fadeSec = 0.14,
    loop = true,
    timeScale = 1.0
  ): void {
    const next = rig.actions.get(clipName) || rig.actions.get('Idle');
    if (!next) return;
    const resolved = rig.actions.has(clipName) ? clipName : 'Idle';

    next.setEffectiveTimeScale(timeScale);
    if (rig.activeClip === resolved) return;

    const prev = rig.activeClip ? rig.actions.get(rig.activeClip) : null;
    next.reset();
    next.enabled = true;
    next.setLoop(loop ? THREE.LoopRepeat : THREE.LoopOnce, loop ? Infinity : 1);
    next.clampWhenFinished = !loop;
    next.play();
    if (prev && prev !== next) {
      prev.crossFadeTo(next, fadeSec, true);
    } else {
      next.fadeIn(fadeSec);
    }
    rig.activeClip = resolved;
  }

  public updateEnemy(
    e: EnemyState,
    dt: number,
    playerX: number,
    playerY: number,
    elapsedSec: number,
    outInfo: Enemy3DFrameInfo
  ): void {
    outInfo.ready = false;
    const rig = this.acquireRig(e);
    if (!rig) return;

    outInfo.ready = true;
    const safeDt = Math.min(Math.max(dt, 0.001), 0.05);

    // 1. Hit Detection & Material Feedback (preserved across idle/attack states)
    if (rig.prevHealth >= 0 && e.health < rig.prevHealth - 0.5) {
      rig.hitFlashTimer = 0.12;
      if (!e.isSpawning && (!e.enemyActionPhase || e.enemyActionPhase === 'none')) {
        rig.hitReactTimer = 0.22;
      }
    }
    rig.prevHealth = e.health;
    if (rig.hitFlashTimer > 0) rig.hitFlashTimer = Math.max(0, rig.hitFlashTimer - safeDt);
    if (rig.hitReactTimer > 0) rig.hitReactTimer = Math.max(0, rig.hitReactTimer - safeDt);

    // Tint materials (chilled frost tint & hit flash)
    const flash = rig.hitFlashTimer > 0 ? rig.hitFlashTimer / 0.12 : 0;
    for (let m = 0; m < rig.materials.length; m++) {
      const mat = rig.materials[m];
      if (e.isChilled) {
        mat.color.copy(this.scratchChillTint);
      } else {
        mat.color.copy(this.scratchWhite);
      }
      if (flash > 0) {
        mat.emissive.copy(rig.baseEmissive[m]).lerp(this.scratchHitTint, flash * 0.85);
        mat.emissiveIntensity = rig.baseEmissiveIntensity[m] + flash * 1.4;
      } else {
        mat.emissive.copy(rig.baseEmissive[m]);
        mat.emissiveIntensity = rig.baseEmissiveIntensity[m];
      }
    }

    // 2. Orientation & Spawn Emergence
    const emergeProgress = e.isSpawning ? Math.min(1, Math.max(0.05, e.spawnProgress || 0)) : 1.0;
    const baseScale = WORLD_SCALES[rig.type] * (e.isBoss && !e.isStage1Titan ? 1.04 : 1.0);
    const emergeScale = e.isSpawning ? 0.22 + 0.78 * emergeProgress : 1.0;

    let desiredDx = playerX - e.pos.x;
    let desiredDy = playerY - e.pos.y;
    if (e.lockedAttackDir && (Math.abs(e.lockedAttackDir.x) > 0.01 || Math.abs(e.lockedAttackDir.y) > 0.01)) {
      desiredDx = e.lockedAttackDir.x;
      desiredDy = e.lockedAttackDir.y;
    } else if (e.velocity.x * e.velocity.x + e.velocity.y * e.velocity.y > 100) {
      desiredDx = e.velocity.x;
      desiredDy = e.velocity.y;
    }

    const targetYaw = Math.atan2(desiredDx, desiredDy);
    let yawDiff = targetYaw - rig.currentYaw;
    while (yawDiff > Math.PI) yawDiff -= Math.PI * 2;
    while (yawDiff < -Math.PI) yawDiff += Math.PI * 2;
    const turnRate = rig.type === 'spitter' ? 6.5 : rig.type === 'elite' ? 5.2 : 9.0;
    const prevYaw = rig.currentYaw;
    rig.currentYaw += yawDiff * Math.min(1, safeDt * turnRate);
    const angularVel = (rig.currentYaw - prevYaw) / safeDt;

    // 3. Ground/Air Elevation & Terrain Slope Alignment
    let visualY = e.z;
    const isFlyer = rig.type === 'wasp' || rig.type === 'boss' || rig.type === 'broodling';
    if (!isFlyer) {
      if (!rig.groundYInit) {
        rig.smoothedGroundY = e.z;
        rig.groundYInit = true;
      } else {
        rig.smoothedGroundY += (e.z - rig.smoothedGroundY) * Math.min(1, safeDt * 14);
      }
      visualY = rig.smoothedGroundY;

      // Ground terrain slope for heavy/long creatures
      const fp = rig.type === 'elite' ? 56 : rig.type === 'spitter' ? 48 : 16;
      const fx = Math.sin(rig.currentYaw);
      const fz = Math.cos(rig.currentYaw);
      const rx = fz;
      const rz = -fx;
      const hF = this.terrain.getFastVisualHeight(e.pos.x + fx * fp, e.pos.y + fz * fp, e.groundZ, 48);
      const hB = this.terrain.getFastVisualHeight(e.pos.x - fx * fp, e.pos.y - fz * fp, e.groundZ, 48);
      const hL = this.terrain.getFastVisualHeight(e.pos.x + rx * fp, e.pos.y + rz * fp, e.groundZ, 48);
      const hR = this.terrain.getFastVisualHeight(e.pos.x - rx * fp, e.pos.y - rz * fp, e.groundZ, 48);
      const targetPitch = Math.max(-0.42, Math.min(0.42, -Math.atan2(hF - hB, fp * 2) * 0.72));
      const targetRoll = Math.max(-0.35, Math.min(0.35, Math.atan2(hL - hR, fp * 2) * 0.65));
      rig.smoothedPitch += (targetPitch - rig.smoothedPitch) * Math.min(1, safeDt * 8);
      rig.smoothedRoll += (targetRoll - rig.smoothedRoll) * Math.min(1, safeDt * 8);
    } else {
      // Flyers hover gracefully around sim air elevation with gentle vertical undulation
      const hoverAmp = rig.type === 'wasp' ? 5.5 : rig.type === 'broodling' ? 6.8 : 9.0;
      const hoverFreq = rig.type === 'wasp' ? 2.8 : 2.1;
      const bob = Math.sin(elapsedSec * hoverFreq + rig.bladeSpinAngle) * hoverAmp;
      visualY = Math.max(e.groundZ + 12, e.z - 22 + bob);
      const speedMag = Math.hypot(e.velocity.x, e.velocity.y);
      const targetPitch = Math.min(0.28, speedMag / 680);
      const targetRoll = Math.max(-0.34, Math.min(0.34, -angularVel * 0.085));
      rig.smoothedPitch += (targetPitch - rig.smoothedPitch) * Math.min(1, safeDt * 7);
      rig.smoothedRoll += (targetRoll - rig.smoothedRoll) * Math.min(1, safeDt * 7);
    }

    rig.group.position.set(e.pos.x, visualY, e.pos.y);
    rig.modelRoot.scale.setScalar(baseScale * emergeScale);
    rig.modelRoot.rotation.set(rig.smoothedPitch, rig.currentYaw, rig.smoothedRoll);

    // 4. Select Clip from Simulation Action State
    const speedSq = e.velocity.x * e.velocity.x + e.velocity.y * e.velocity.y;
    const isMoving = speedSq > 160;
    const phase = e.enemyActionPhase || 'none';
    const variant = phase !== 'none' ? e.enemyActionVariant : undefined;

    if (e.isSpawning) {
      this.setClip(rig, 'Spawn', 0.1, false, 1.0);
    } else if (variant === 'spin_charge') {
      if (phase === 'prep') this.setClip(rig, 'Attack_Prep', 0.1, false, 1.15);
      else if (phase === 'exec') this.setClip(rig, 'Attack_Exec', 0.06, true, 1.35);
      else this.setClip(rig, 'Attack_Recover', 0.12, false, 1.0);
    } else if (variant === 'water_bubble') {
      if (phase === 'prep') this.setClip(rig, 'Attack_Prep', 0.1, false, 1.1);
      else if (phase === 'exec') this.setClip(rig, 'Attack_Exec', 0.06, false, 1.25);
      else this.setClip(rig, 'Attack_Recover', 0.12, false, 1.0);
    } else if (variant === 'toxic_exhale') {
      if (phase === 'prep') this.setClip(rig, 'Attack_Prep', 0.14, false, 1.05);
      else if (phase === 'exec') this.setClip(rig, 'Attack_Exec', 0.12, true, 1.1);
      else this.setClip(rig, 'Attack_Recover', 0.16, false, 1.0);
    } else if (variant === 'ground_slam') {
      this.setClip(rig, 'Attack_Slam', 0.1, false, 1.05);
    } else if (variant === 'punch_l') {
      this.setClip(rig, 'Attack_Punch_L', 0.08, false, 1.15);
    } else if (variant === 'punch_r') {
      this.setClip(rig, 'Attack_Punch_R', 0.08, false, 1.15);
    } else if (variant === 'twin_spikes') {
      this.setClip(rig, 'Attack_TwinSpikes', 0.1, false, 1.15);
    } else if (variant === 'spawn_brood') {
      this.setClip(rig, 'Attack_SpawnBrood', 0.14, false, 1.05);
    } else if (variant === 'brood_dive' && phase === 'exec') {
      this.setClip(rig, 'Brood_Dive', 0.08, true, 1.4);
    } else if (rig.hitReactTimer > 0) {
      this.setClip(rig, 'Hit_React', 0.06, false, 1.25);
    } else if (Math.abs(yawDiff) > 0.72 && !isMoving && rig.actions.has('Turn')) {
      this.setClip(rig, 'Turn', 0.14, true, 1.1);
    } else if (isMoving) {
      const speedNorm = Math.min(1.5, Math.max(0.7, Math.sqrt(speedSq) / Math.max(40, e.speed)));
      this.setClip(rig, 'Walk', 0.16, true, speedNorm);
    } else {
      this.setClip(rig, 'Idle', 0.2, true, 1.0);
    }

    // 5. Distance-Aware Mixer Step & Update World Matrices
    const distSq = (e.pos.x - playerX) * (e.pos.x - playerX) + (e.pos.y - playerY) * (e.pos.y - playerY);
    const animStep = distSq > 1960000 && this.frameCounter % 2 === 1 ? 0 : distSq > 1960000 ? safeDt * 2 : safeDt;
    if (animStep > 0) {
      rig.mixer.update(animStep);
    }

    // 6. Procedural Biological Secondary Motion (Applied Post-Mixer, Zero Stiffness!)
    this.applyProceduralSecondaryMotion(rig, e, safeDt, elapsedSec, isMoving, angularVel, yawDiff, outInfo);

    rig.group.updateMatrixWorld(true);

    // 7. Refresh World Socket Queries Post-MatrixUpdate
    if (rig.type === 'boss') {
      if (rig.spikeL) {
        rig.spikeL.getWorldPosition(this.scratchSpikeLOut);
        outInfo.spikePosL = this.scratchSpikeLOut;
      }
      if (rig.spikeR) {
        rig.spikeR.getWorldPosition(this.scratchSpikeROut);
        outInfo.spikePosR = this.scratchSpikeROut;
      }
      if (rig.birthSocket) {
        rig.birthSocket.getWorldPosition(this.scratchBirthOut);
        outInfo.birthPos = this.scratchBirthOut;
      }
    }

    // Emit live Slythven dual exhaust smoke & Magmir step cues post-world-matrix!
    if (rig.type === 'spitter' && !e.isSpawning && rig.exhaustL && rig.exhaustR) {
      const isExhaling = variant === 'toxic_exhale' && (phase === 'exec' || phase === 'prep');
      rig.smokeAccum += safeDt;
      const rate = isExhaling ? 0.045 : 0.22;
      if (rig.smokeAccum >= rate) {
        rig.smokeAccum = 0;
        rig.exhaustL.getWorldPosition(this.scratchVecA);
        rig.exhaustR.getWorldPosition(this.scratchVecB);
        const fwdX = Math.sin(rig.currentYaw);
        const fwdY = Math.cos(rig.currentYaw);
        this.vfx.emitSlythvenVentPlume(
          this.scratchVecA,
          this.scratchVecB,
          e.pos.x,
          e.pos.y,
          e.z,
          fwdX,
          fwdY,
          ENEMY_COMBAT_BALANCE.slythvenGasRadius,
          variant === 'toxic_exhale' && phase === 'exec'
        );
      }
    } else if (rig.type === 'elite' && !e.isSpawning) {
      if (isMoving && distSq < 1400000) {
        rig.footstepAccum += safeDt;
        if (rig.footstepAccum >= 0.36) {
          rig.footstepAccum = 0;
          this.vfx.spawnMagmirFootstepDust(
            e.pos.x + (Math.random() - 0.5) * 52,
            e.pos.y + (Math.random() - 0.5) * 52,
            e.groundZ,
            2.2
          );
        }
      }
    }

    outInfo.hpTopOffset =
      rig.type === 'elite'
        ? 304
        : rig.type === 'boss'
          ? 244
          : rig.type === 'spitter'
            ? 244
            : rig.type === 'broodling'
              ? 132
              : 96;
  }

  private applyProceduralSecondaryMotion(
    rig: PooledEnemyRig,
    e: EnemyState,
    dt: number,
    elapsedSec: number,
    isMoving: boolean,
    angularVel: number,
    _yawDiff: number,
    _outInfo: Enemy3DFrameInfo
  ): void {
    const phase = e.enemyActionPhase || 'none';
    const variant = phase !== 'none' ? e.enemyActionVariant : undefined;

    if (rig.type === 'crawler' && rig.bladeRingBone) {
      // Smooth continuous biological blade assembly rotation independent of central chassis!
      const spinRate =
        variant === 'spin_charge' && phase === 'exec'
          ? 29.0
          : variant === 'spin_charge' && phase === 'prep'
            ? 20.5
            : isMoving
              ? 12.0
              : 7.5;
      rig.bladeSpinAngle = (rig.bladeSpinAngle + spinRate * dt) % (Math.PI * 2);
      // In Y-up GLTF bone space under Body_Core/Root, Blade_Ring local Y-axis is vertical spin axis
      this.scratchQ.setFromAxisAngle(this.scratchAxisY, rig.bladeSpinAngle);
      rig.bladeRingBone.quaternion.copy(this.scratchQ);

      if (variant === 'spin_charge' && (phase === 'prep' || phase === 'exec') && !e.isSpawning) {
        rig.bladeBlurAccum += dt;
        const rate = phase === 'exec' ? 0.055 : 0.11;
        if (rig.bladeBlurAccum >= rate) {
          rig.bladeBlurAccum = 0;
          this.vfx.spawnOrebladeSpinBlur(e.pos.x, e.pos.y, e.z, rig.bladeSpinAngle, phase === 'exec');
        }
      }
    } else if (rig.type === 'wasp') {
      // Floating Driftworm: delayed secondary bend across 6 tendril chains + Oral_Organ firing pulse
      const vxLocal =
        (e.velocity.x * Math.cos(rig.currentYaw) - e.velocity.y * Math.sin(rig.currentYaw)) / 180;
      const vzLocal =
        (e.velocity.x * Math.sin(rig.currentYaw) + e.velocity.y * Math.cos(rig.currentYaw)) / 180;
      for (let ti = 0; ti < rig.tendrilChains.length; ti++) {
        const chain = rig.tendrilChains[ti].bones;
        const sideSign = ti % 2 === 0 ? 1 : -1;
        for (let bi = 0; bi < chain.length; bi++) {
          const b = chain[bi];
          const phaseShift = elapsedSec * 3.8 + ti * 0.9 - bi * 0.55;
          const swayX = Math.sin(phaseShift) * (0.08 + bi * 0.045) - vzLocal * (0.1 + bi * 0.05);
          const swayZ =
            Math.cos(phaseShift * 0.85) * (0.06 + bi * 0.04) * sideSign + vxLocal * (0.08 + bi * 0.04);
          this.scratchQ.setFromAxisAngle(this.scratchAxisX, swayX);
          b.quaternion.multiply(this.scratchQ);
          this.scratchQ.setFromAxisAngle(this.scratchAxisZ, swayZ);
          b.quaternion.multiply(this.scratchQ);
        }
      }
      if (rig.oralOrganBone) {
        const pulse =
          variant === 'water_bubble' && phase === 'prep'
            ? 1.24 + Math.sin(elapsedSec * 22) * 0.08
            : variant === 'water_bubble' && phase === 'exec'
              ? 0.86
              : 1.0 + Math.sin(elapsedSec * 3.4) * 0.06;
        rig.oralOrganBone.scale.setScalar(pulse);
      }
    } else if (rig.type === 'spitter' && rig.tailChain.length > 0) {
      // Slythven: Delayed slithering yaw trail across Tail_01..08 so turning weaves the serpentine body!
      rig.slitherAccum += dt;
      if (rig.slitherAccum >= 0.028) {
        rig.slitherAccum = 0;
        rig.slitherCursor = (rig.slitherCursor + 1) % SLITHER_HISTORY_LEN;
        rig.slitherHistory[rig.slitherCursor] = rig.currentYaw;
      }
      for (let t = 0; t < rig.tailChain.length; t++) {
        const lagSlots = (t + 1) * 2;
        const idx = (rig.slitherCursor - lagSlots + SLITHER_HISTORY_LEN * 4) % SLITHER_HISTORY_LEN;
        let lagDelta = rig.slitherHistory[idx] - rig.currentYaw;
        while (lagDelta > Math.PI) lagDelta -= Math.PI * 2;
        while (lagDelta < -Math.PI) lagDelta += Math.PI * 2;
        const slitherWave = Math.sin(elapsedSec * (isMoving ? 5.2 : 2.1) - t * 0.65) * (isMoving ? 0.095 : 0.032);
        const turnLagBend = Math.max(-0.22, Math.min(0.22, lagDelta * 0.18));
        this.scratchQ.setFromAxisAngle(this.scratchAxisZ, slitherWave + turnLagBend - angularVel * 0.015);
        rig.tailChain[t].quaternion.multiply(this.scratchQ);
      }
    }
  }

  public getLiveSpitOrigin(enemyId: string, outPos: THREE.Vector3): boolean {
    const rig = this.activeByEnemyId.get(enemyId);
    if (!rig || !rig.spitSocketBone) return false;
    rig.spitSocketBone.getWorldPosition(this.scratchSpitOut);
    outPos.copy(this.scratchSpitOut);
    return true;
  }

  public getLiveBirthOrigin(enemyId: string, outPos: THREE.Vector3): boolean {
    const rig = this.activeByEnemyId.get(enemyId);
    if (!rig || !rig.birthSocket) return false;
    rig.birthSocket.getWorldPosition(this.scratchBirthOut);
    outPos.copy(this.scratchBirthOut);
    return true;
  }

  public getLiveFistOrigin(enemyId: string, isLeft: boolean, outPos: THREE.Vector3): boolean {
    const rig = this.activeByEnemyId.get(enemyId);
    if (!rig) return false;
    const bone = isLeft ? rig.fistL : rig.fistR;
    if (!bone) return false;
    bone.getWorldPosition(this.scratchPunchOut);
    outPos.copy(this.scratchPunchOut);
    return true;
  }

  public updateDying(dt: number): void {
    this.frameCounter = (this.frameCounter + 1) & 0xffff;
    const safeDt = Math.min(dt, 0.05);
    for (let i = this.dyingRigs.length - 1; i >= 0; i--) {
      const rig = this.dyingRigs[i];
      rig.deathTimer += safeDt;
      rig.mixer.update(safeDt);
      if (rig.deathTimer > rig.deathDuration * 0.65) {
        const sinkFrac = (rig.deathTimer - rig.deathDuration * 0.65) / (rig.deathDuration * 0.35);
        rig.modelRoot.scale.multiplyScalar(Math.max(0.01, 1 - sinkFrac * 0.12));
      }
      if (rig.deathTimer >= rig.deathDuration) {
        this.dyingRigs.splice(i, 1);
        this.returnRigToPool(rig);
      }
    }
  }

  public dispose(): void {
    this.disposed = true;
    for (const rig of this.activeByEnemyId.values()) {
      this.scene.remove(rig.group);
      rig.mixer.stopAllAction();
      for (const m of rig.materials) m.dispose();
    }
    this.activeByEnemyId.clear();
    for (const list of this.freePool.values()) {
      for (const rig of list) {
        this.scene.remove(rig.group);
        rig.mixer.stopAllAction();
        for (const m of rig.materials) m.dispose();
      }
    }
    this.freePool.clear();
    for (const rig of this.dyingRigs) {
      this.scene.remove(rig.group);
      rig.mixer.stopAllAction();
      for (const m of rig.materials) m.dispose();
    }
    this.dyingRigs.length = 0;
  }
}

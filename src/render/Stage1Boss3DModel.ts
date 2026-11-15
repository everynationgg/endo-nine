import * as THREE from 'three';
import { Enemy } from '../sim/types';
import { STAGE1_BOSS_CONFIG } from '../sim/Stage1BossConfig';

export interface DorsalTentacleEntry {
  mesh: THREE.Mesh;
  geo: THREE.BufferGeometry;
  spinePoints: THREE.Vector3[];
  rootLocal: THREE.Vector3;
  baseAngleX: number;
  baseAngleY: number;
  length: number;
  baseRadius: number;
  archHeight: number;
  spreadX: number;
  spreadZ: number;
  tipSpreadX: number;
  tipHeight: number;
  tipFwdZ: number;
  phase: number;
  stinger: THREE.Mesh;
}

/**
 * Procedural Sculpted 3D Articulated Rig for the Stage 1 Titan Boss (Colossal Bio-Cultivator).
 *
 * Anatomically reconstructed from the canonical Stage 1 Boss design:
 * - Hunched kaiju silhouette (~420+ units tall with full 10-tentacle dorsal crown)
 * - Sculpted iridescent lavender-bone carapace crest, hinged mandibles & glowing furnace throat
 * - Abyssal violet chitinous torso with pulsing magenta bioluminescent core fissures
 * - Massive knuckle-walking forelimbs with swept 3-blade chitinous gauntlets
 * - Planted 3-toed legs with synced stomp callbacks for footstep VFX & camera rumble
 * - 10 smooth tapered 3D dorsal tentacles with razor stingers that hold & unleash the 10 elemental orbs
 */
export class Stage1Boss3DModel {
  public readonly group: THREE.Group;
  private readonly rootGroup: THREE.Group;
  private readonly pelvis: THREE.Group;
  private readonly chestPivot: THREE.Group;
  private readonly neckPivot: THREE.Group;
  private readonly headGroup: THREE.Group;
  private readonly lowerJawPivot: THREE.Group;

  private readonly leftShoulder: THREE.Group;
  private readonly leftElbow: THREE.Group;
  private readonly rightShoulder: THREE.Group;
  private readonly rightElbow: THREE.Group;

  private readonly leftHip: THREE.Group;
  private readonly leftKnee: THREE.Group;
  private readonly rightHip: THREE.Group;
  private readonly rightKnee: THREE.Group;

  private readonly mouthSocket: THREE.Object3D;
  private readonly dorsalSocketAnchor: THREE.Object3D;
  private readonly dorsalTentacles: DorsalTentacleEntry[] = [];
  private readonly tipWorldPositions: THREE.Vector3[] = [];
  private readonly dorsalRootWorldCache: THREE.Vector3[] = [];

  private readonly fleshMat: THREE.MeshStandardMaterial;
  private readonly carapaceMat: THREE.MeshStandardMaterial;
  private readonly bladeEdgeMat: THREE.MeshStandardMaterial;
  private readonly coreGlowMat: THREE.MeshStandardMaterial;
  private readonly throatGlowMesh: THREE.Mesh;
  private readonly eyeGlowMat: THREE.MeshBasicMaterial;
  private readonly ownedGeos: THREE.BufferGeometry[] = [];
  private readonly ownedMats: THREE.Material[] = [];
  private readonly ownedTexs: THREE.Texture[] = [];

  // Animation state
  private currentYaw: number = 0;
  private walkPhase: number = 0;
  private breathPhase: number = 0;
  private lastStepHalfCycle: number = -1;
  private hitFlashTimer: number = 0;
  private lastHealth: number = 10000;

  // Scratch vectors to avoid per-frame GC allocations
  private readonly scratchT = new THREE.Vector3();
  private readonly scratchN = new THREE.Vector3();
  private readonly scratchB = new THREE.Vector3();
  private readonly scratchUp = new THREE.Vector3(0, 1, 0);
  private readonly scratchFallbackAxis = new THREE.Vector3(1, 0, 0);
  private readonly scratchRoot = new THREE.Vector3();
  private readonly scratchTip = new THREE.Vector3();
  private readonly scratchCtrl1 = new THREE.Vector3();
  private readonly scratchCtrl2 = new THREE.Vector3();
  private readonly scratchDir = new THREE.Vector3();
  private readonly scratchColor = new THREE.Color();

  constructor(tentacleSkinTex: THREE.Texture, tentacleEmissiveTex: THREE.Texture) {
    this.group = new THREE.Group();
    this.group.name = 'titan_3d_boss_group';
    this.group.userData = { isTitanPart: true };

    this.rootGroup = new THREE.Group();
    this.group.add(this.rootGroup);

    const { fleshMap, fleshEmissive, carapaceMap, carapaceBump } = this.buildOrganicSurfaceTextures();

    this.fleshMat = new THREE.MeshStandardMaterial({
      map: fleshMap,
      emissiveMap: fleshEmissive,
      emissive: new THREE.Color(0xd946ef),
      emissiveIntensity: 0.72,
      roughness: 0.34,
      metalness: 0.22
    });

    this.carapaceMat = new THREE.MeshStandardMaterial({
      map: carapaceMap,
      bumpMap: carapaceBump,
      bumpScale: 2.2,
      emissive: new THREE.Color(0x581c87),
      emissiveIntensity: 0.16,
      roughness: 0.36,
      metalness: 0.28
    });

    this.bladeEdgeMat = new THREE.MeshStandardMaterial({
      color: 0xd8b4fe,
      emissive: new THREE.Color(0xc026d3),
      emissiveIntensity: 0.55,
      roughness: 0.24,
      metalness: 0.35
    });

    this.coreGlowMat = new THREE.MeshStandardMaterial({
      color: 0xf5d0fe,
      emissive: new THREE.Color(0xe879f9),
      emissiveIntensity: 1.85,
      roughness: 0.15,
      metalness: 0.1
    });

    this.eyeGlowMat = new THREE.MeshBasicMaterial({
      color: 0xfef08a
    });

    const tentacleMat = new THREE.MeshStandardMaterial({
      map: tentacleSkinTex,
      emissiveMap: tentacleEmissiveTex,
      emissive: new THREE.Color(0xd946ef),
      emissiveIntensity: 0.9,
      roughness: 0.28,
      metalness: 0.35,
      side: THREE.DoubleSide
    });

    const stingerMat = new THREE.MeshStandardMaterial({
      color: 0x9f1239,
      emissive: new THREE.Color(0xf43f5e),
      emissiveIntensity: 1.05,
      roughness: 0.22,
      metalness: 0.42
    });

    this.ownedMats.push(
      this.fleshMat,
      this.carapaceMat,
      this.bladeEdgeMat,
      this.coreGlowMat,
      this.eyeGlowMat,
      tentacleMat,
      stingerMat
    );

    // ------------------------------------------------------------------
    // SKELETAL HIERARCHY (Feet at Y = 0, Shoulder Peak ~295, Tentacles ~425)
    // Facing +Z in local space
    // ------------------------------------------------------------------
    this.pelvis = new THREE.Group();
    this.pelvis.position.set(0, 122, -6);
    this.rootGroup.add(this.pelvis);

    const pelvisCore = this.addSculptedPart(this.pelvis, this.createTaperedOrganicGeo(46, 36, 48, 12, 8, 1.15, 0.92), this.fleshMat, [0, 2, 0]);
    pelvisCore.castShadow = false;

    // Armored groin & hip skirt plates
    this.addSculptedPart(this.pelvis, this.createCrestPlateGeo(36, 44, 14), this.carapaceMat, [0, -8, 28], [0.22, 0, 0]);
    for (const side of [-1, 1]) {
      this.addSculptedPart(this.pelvis, this.createCrestPlateGeo(28, 42, 12), this.carapaceMat, [side * 42, 6, 8], [0.1, side * 0.45, -side * 0.35]);
    }

    // Chest / Hunched Torso
    this.chestPivot = new THREE.Group();
    this.chestPivot.position.set(0, 24, 6);
    this.pelvis.add(this.chestPivot);

    // Upper torso muscular vault
    this.addSculptedPart(
      this.chestPivot,
      this.createTaperedOrganicGeo(44, 68, 108, 14, 10, 1.32, 0.95),
      this.fleshMat,
      [0, 56, 8],
      [0.24, 0, 0]
    );

    // Glowing Bio-Core Sternum Fissures (chevron chest reactor from spritesheet)
    for (let v = 0; v < 4; v++) {
      const yOff = 24 + v * 17;
      const w = 14 + v * 5.5;
      const zOff = 52 + v * 4.5;
      this.addSculptedPart(this.chestPivot, this.trackGeo(new THREE.OctahedronGeometry(w * 0.42, 1)), this.coreGlowMat, [0, yOff, zOff], [0.15, 0, Math.PI * 0.25], [1.4, 0.65, 0.5]);
      for (const side of [-1, 1]) {
        this.addSculptedPart(
          this.chestPivot,
          this.createCrestPlateGeo(18, 10, 8),
          this.coreGlowMat,
          [side * (16 + v * 4), yOff + 4, zOff - 4],
          [0.2, side * 0.3, side * 0.48]
        );
      }
    }

    // Broad Overhanging Back Carapace & Pauldron Crest Ridge
    this.addSculptedPart(
      this.chestPivot,
      this.createCrestPlateGeo(96, 118, 34),
      this.carapaceMat,
      [0, 84, -22],
      [0.48, 0, 0]
    );
    for (let sp = 0; sp < 4; sp++) {
      const sScale = 1.0 - sp * 0.16;
      this.addSculptedPart(
        this.chestPivot,
        this.createHornSpikeGeo(14 * sScale, 54 * sScale),
        this.carapaceMat,
        [0, 118 - sp * 24, -46 - sp * 8],
        [-0.55 - sp * 0.18, 0, 0]
      );
    }

    // Dorsal socket anchor (world base for tentacles & strike origin)
    this.dorsalSocketAnchor = new THREE.Object3D();
    this.dorsalSocketAnchor.position.set(0, 96, -12);
    this.chestPivot.add(this.dorsalSocketAnchor);

    // Massive Spiked Shoulder Pauldrons
    for (const side of [-1, 1]) {
      this.addSculptedPart(this.chestPivot, this.createCrestPlateGeo(52, 62, 24), this.carapaceMat, [side * 76, 86, 4], [0.22, -side * 0.35, -side * 0.55]);
      this.addSculptedPart(this.chestPivot, this.createHornSpikeGeo(16, 68), this.carapaceMat, [side * 96, 112, -2], [0.15, 0, -side * 0.72]);
      this.addSculptedPart(this.chestPivot, this.createHornSpikeGeo(12, 46), this.bladeEdgeMat, [side * 108, 86, 18], [0.35, 0, -side * 0.92]);
    }

    // ------------------------------------------------------------------
    // NECK, CROWNED HEAD SHIELD & HINGED ROARING JAWS
    // ------------------------------------------------------------------
    this.neckPivot = new THREE.Group();
    this.neckPivot.position.set(0, 102, 46);
    this.chestPivot.add(this.neckPivot);

    this.addSculptedPart(
      this.neckPivot,
      this.createTaperedOrganicGeo(34, 28, 44, 12, 6, 1.05, 1.1),
      this.fleshMat,
      [0, 14, 14],
      [0.42, 0, 0]
    );

    this.headGroup = new THREE.Group();
    this.headGroup.position.set(0, 26, 26);
    this.neckPivot.add(this.headGroup);

    // Tall Diamond/Crown Head Shield (matches boss_walk_front sharp peaked crest)
    this.addSculptedPart(this.headGroup, this.createCrestPlateGeo(48, 86, 28), this.carapaceMat, [0, 32, 8], [-0.26, 0, 0]);
    // Flanking Cheek Blades & Crown Spires
    for (const side of [-1, 1]) {
      this.addSculptedPart(this.headGroup, this.createCrestPlateGeo(24, 62, 16), this.carapaceMat, [side * 24, 16, 14], [0.12, side * 0.42, -side * 0.25]);
      this.addSculptedPart(this.headGroup, this.createHornSpikeGeo(11, 56), this.carapaceMat, [side * 20, 48, -6], [-0.35, 0, -side * 0.28]);
      // Fierce Slit Bio-Optics
      this.addSculptedPart(this.headGroup, this.trackGeo(new THREE.BoxGeometry(10, 3.2, 6)), this.eyeGlowMat, [side * 13, 10, 34], [0.1, side * 0.35, side * 0.42]);
    }

    // Upper Jaw Fang Crest
    this.addSculptedPart(this.headGroup, this.createCrestPlateGeo(28, 34, 16), this.carapaceMat, [0, -2, 26], [0.68, 0, 0]);
    for (const side of [-1, 1]) {
      this.addSculptedPart(this.headGroup, this.createHornSpikeGeo(5.5, 22), this.bladeEdgeMat, [side * 10, -14, 34], [Math.PI * 0.88, 0, -side * 0.14]);
    }

    // Glowing Inner Throat / Laser Furnace Core (exposes when jaw unhinges!)
    const throatGeo = this.trackGeo(new THREE.SphereGeometry(15, 14, 12));
    this.throatGlowMesh = new THREE.Mesh(throatGeo, this.coreGlowMat);
    this.throatGlowMesh.position.set(0, -10, 22);
    this.throatGlowMesh.scale.set(0.85, 1.15, 1.1);
    this.headGroup.add(this.throatGlowMesh);

    this.mouthSocket = new THREE.Object3D();
    this.mouthSocket.position.set(0, -12, 38);
    this.headGroup.add(this.mouthSocket);

    // Hinged Lower Jaw Mandible
    this.lowerJawPivot = new THREE.Group();
    this.lowerJawPivot.position.set(0, -16, 12);
    this.headGroup.add(this.lowerJawPivot);

    this.addSculptedPart(this.lowerJawPivot, this.createCrestPlateGeo(24, 32, 14), this.carapaceMat, [0, -10, 14], [1.18, 0, 0]);
    for (const side of [-1, 1]) {
      this.addSculptedPart(this.lowerJawPivot, this.createHornSpikeGeo(4.8, 18), this.bladeEdgeMat, [side * 8, -2, 24], [0.32, 0, -side * 0.18]);
    }

    // ------------------------------------------------------------------
    // MASSIVE KNUCKLE-WALKING CHITINOUS GAUNTLET FORELIMBS
    // ------------------------------------------------------------------
    this.leftShoulder = new THREE.Group();
    this.leftShoulder.position.set(-76, 76, 10);
    this.chestPivot.add(this.leftShoulder);
    this.leftElbow = this.buildArmLimb(this.leftShoulder, -1);

    this.rightShoulder = new THREE.Group();
    this.rightShoulder.position.set(76, 76, 10);
    this.chestPivot.add(this.rightShoulder);
    this.rightElbow = this.buildArmLimb(this.rightShoulder, 1);

    // ------------------------------------------------------------------
    // STOCKY ROOTED HIND LEGS & 3-TOED FEET
    // ------------------------------------------------------------------
    this.leftHip = new THREE.Group();
    this.leftHip.position.set(-40, -6, 0);
    this.pelvis.add(this.leftHip);
    this.leftKnee = this.buildLegLimb(this.leftHip, -1);

    this.rightHip = new THREE.Group();
    this.rightHip.position.set(40, -6, 0);
    this.pelvis.add(this.rightHip);
    this.rightKnee = this.buildLegLimb(this.rightHip, 1);

    // ------------------------------------------------------------------
    // 10 SMOOTH TAPERED 3D DORSAL TENTACLES (Shared Organic Aesthetic)
    // ------------------------------------------------------------------
    const tentacleLayouts: Array<{
      rx: number; ry: number; rz: number;
      tx: number; ty: number; tz: number;
      ax: number; az: number; radius: number; phase: number;
    }> = [
        // Right Crown Fan (5 tentacles matching Stage1BossConfig.tentacleTipOffsets spread)
        { rx: 52, ry: 96, rz: -18, tx: 162, ty: 245, tz: 44, ax: 132, az: -12, radius: 13.5, phase: 0.0 },
        { rx: 64, ry: 78, rz: -10, tx: 158, ty: 152, tz: 54, ax: 145, az: 16, radius: 12.0, phase: 0.8 },
        { rx: 32, ry: 108, rz: -22, tx: 76, ty: 278, tz: 52, ax: 64, az: -22, radius: 12.5, phase: 1.5 },
        { rx: 46, ry: 100, rz: -24, tx: 118, ty: 328, tz: 36, ax: 86, az: -28, radius: 14.0, phase: 2.2 },
        { rx: 14, ry: 112, rz: -26, tx: 36, ty: 356, tz: 38, ax: 24, az: -36, radius: 11.5, phase: 2.9 },
        // Left Crown Fan (5 mirrored tentacles)
        { rx: -52, ry: 96, rz: -18, tx: -162, ty: 245, tz: 44, ax: -132, az: -12, radius: 13.5, phase: 3.5 },
        { rx: -64, ry: 78, rz: -10, tx: -158, ty: 152, tz: 54, ax: -145, az: 16, radius: 12.0, phase: 4.2 },
        { rx: -32, ry: 108, rz: -22, tx: -76, ty: 278, tz: 52, ax: -64, az: -22, radius: 12.5, phase: 4.9 },
        { rx: -46, ry: 100, rz: -24, tx: -118, ty: 328, tz: 36, ax: -86, az: -28, radius: 14.0, phase: 5.5 },
        { rx: -14, ry: 112, rz: -26, tx: -36, ty: 356, tz: 38, ax: -24, az: -36, radius: 11.5, phase: 6.1 }
      ];

    const stingerGeo = this.trackGeo(new THREE.ConeGeometry(2.6, 18, 7));
    stingerGeo.rotateX(Math.PI / 2);

    const segs = 16;
    const radSegs = 8;
    for (let i = 0; i < 10; i++) {
      const cfg = tentacleLayouts[i];
      const geo = this.createTaperedTubeGeo(segs, radSegs);
      this.ownedGeos.push(geo);

      const mesh = new THREE.Mesh(geo, tentacleMat);
      mesh.frustumCulled = false;
      mesh.renderOrder = 295;
      this.chestPivot.add(mesh);

      const stinger = new THREE.Mesh(stingerGeo, stingerMat);
      stinger.frustumCulled = false;
      this.chestPivot.add(stinger);

      const spinePoints: THREE.Vector3[] = [];
      for (let s = 0; s <= segs; s++) {
        spinePoints.push(new THREE.Vector3());
      }

      this.dorsalTentacles.push({
        mesh,
        geo,
        spinePoints,
        rootLocal: new THREE.Vector3(cfg.rx, cfg.ry, cfg.rz),
        baseAngleX: 0,
        baseAngleY: 0,
        length: Math.hypot(cfg.tx - cfg.rx, cfg.ty - cfg.ry, cfg.tz - cfg.rz),
        baseRadius: cfg.radius,
        archHeight: cfg.ty,
        spreadX: cfg.ax,
        spreadZ: cfg.az,
        tipSpreadX: cfg.tx,
        tipHeight: cfg.ty,
        tipFwdZ: cfg.tz,
        phase: cfg.phase,
        stinger
      });

      this.tipWorldPositions.push(new THREE.Vector3());
      this.dorsalRootWorldCache.push(new THREE.Vector3());
    }
  }

  private buildArmLimb(shoulder: THREE.Group, side: -1 | 1): THREE.Group {
    // Bulky Deltoid/Upper Arm Flesh
    this.addSculptedPart(
      shoulder,
      this.createTaperedOrganicGeo(24, 22, 74, 10, 6, 1.0, 1.05),
      this.fleshMat,
      [-side * -6, -34, 4],
      [0.08, 0, side * 0.24]
    );
    // Outer Bicep Armor Plate
    this.addSculptedPart(
      shoulder,
      this.createCrestPlateGeo(28, 62, 16),
      this.carapaceMat,
      [side * 16, -28, 6],
      [0.08, side * 0.25, -side * 0.28]
    );

    const elbow = new THREE.Group();
    elbow.position.set(side * 18, -68, 12);
    shoulder.add(elbow);

    // Massive Swept Forearm Chitinous Gauntlet
    this.addSculptedPart(
      elbow,
      this.createTaperedOrganicGeo(22, 34, 92, 12, 7, 1.15, 1.2),
      this.fleshMat,
      [side * 4, -44, 10],
      [-0.18, 0, side * 0.08]
    );

    // Sculpted Armored Shield-Carapace on Outer Forearm
    this.addSculptedPart(
      elbow,
      this.createCrestPlateGeo(46, 98, 22),
      this.carapaceMat,
      [side * 22, -46, 14],
      [-0.22, side * 0.42, -side * 0.16]
    );
    // Dorsal Fin Blade on Gauntlet
    this.addSculptedPart(
      elbow,
      this.createHornSpikeGeo(11, 52),
      this.carapaceMat,
      [side * 26, -12, -14],
      [-0.62, side * 0.2, -side * 0.2]
    );

    // Three Sweeping Scythe Claw Blades Anchoring to the Ground
    for (let c = 0; c < 3; c++) {
      const spreadZ = (c - 1) * 16;
      const spreadX = (c - 1) * 6 * side;
      this.addSculptedPart(
        elbow,
        this.createHornSpikeGeo(9.5, 48),
        c === 1 ? this.bladeEdgeMat : this.carapaceMat,
        [side * 10 + spreadX, -98, 26 + spreadZ],
        [Math.PI * 0.72 + c * 0.06, side * 0.14, -side * 0.08]
      );
    }

    // Glowing Energy Vent Inside Gauntlet Hollow
    this.addSculptedPart(
      elbow,
      this.trackGeo(new THREE.OctahedronGeometry(10, 1)),
      this.coreGlowMat,
      [side * 2, -52, 26],
      [0, 0, 0],
      [0.65, 1.5, 0.55]
    );

    return elbow;
  }

  private buildLegLimb(hip: THREE.Group, side: -1 | 1): THREE.Group {
    // Muscular Thigh
    this.addSculptedPart(
      hip,
      this.createTaperedOrganicGeo(24, 19, 58, 10, 5, 1.05, 1.1),
      this.fleshMat,
      [side * 4, -26, 6],
      [-0.24, 0, side * 0.08]
    );
    // Thigh Crest Plate
    this.addSculptedPart(
      hip,
      this.createCrestPlateGeo(24, 48, 14),
      this.carapaceMat,
      [side * 10, -24, 18],
      [-0.22, side * 0.25, -side * 0.12]
    );

    const knee = new THREE.Group();
    knee.position.set(side * 6, -54, 18);
    hip.add(knee);

    // Knee Armor Spur
    this.addSculptedPart(knee, this.createHornSpikeGeo(10, 32), this.carapaceMat, [side * 2, 4, 14], [0.42, 0, 0]);

    // Planted Lower Shin
    this.addSculptedPart(
      knee,
      this.createTaperedOrganicGeo(18, 24, 58, 10, 5, 1.0, 1.15),
      this.fleshMat,
      [0, -30, -8],
      [0.18, 0, 0]
    );
    this.addSculptedPart(knee, this.createCrestPlateGeo(24, 48, 14), this.carapaceMat, [0, -26, 4], [0.16, 0, 0]);

    // Rooted 3-Toed Clawed Foot
    this.addSculptedPart(
      knee,
      this.createTaperedOrganicGeo(22, 26, 16, 10, 3, 1.2, 1.35),
      this.fleshMat,
      [0, -56, 2],
      [0, 0, 0]
    );
    for (const toe of [-1, 0, 1]) {
      this.addSculptedPart(
        knee,
        this.createHornSpikeGeo(6.5, 24),
        this.carapaceMat,
        [toe * 13, -58, 18 - Math.abs(toe) * 4],
        [Math.PI * 0.48, toe * 0.28, 0]
      );
    }

    return knee;
  }

  private addSculptedPart(
    parent: THREE.Object3D,
    geo: THREE.BufferGeometry,
    mat: THREE.Material,
    pos: [number, number, number],
    rot: [number, number, number] = [0, 0, 0],
    scale: [number, number, number] = [1, 1, 1]
  ): THREE.Mesh {
    const mesh = new THREE.Mesh(geo, mat);
    mesh.position.set(pos[0], pos[1], pos[2]);
    mesh.rotation.set(rot[0], rot[1], rot[2]);
    mesh.scale.set(scale[0], scale[1], scale[2]);
    mesh.userData = { isTitanPart: true };
    parent.add(mesh);
    return mesh;
  }

  private trackGeo<T extends THREE.BufferGeometry>(geo: T): T {
    this.ownedGeos.push(geo);
    return geo;
  }

  private createTaperedOrganicGeo(
    bottomR: number,
    topR: number,
    height: number,
    radialSegs: number,
    heightSegs: number,
    scaleX: number,
    scaleZ: number
  ): THREE.BufferGeometry {
    const geo = new THREE.CylinderGeometry(topR, bottomR, height, radialSegs, heightSegs);
    const pos = geo.getAttribute('position') as THREE.BufferAttribute;
    for (let i = 0; i < pos.count; i++) {
      const x = pos.getX(i);
      const y = pos.getY(i);
      const z = pos.getZ(i);
      const ny = y / (height * 0.5); // -1..1
      const bulge = 1.0 + 0.16 * (1.0 - ny * ny) + 0.05 * Math.sin(ny * Math.PI * 3.0);
      pos.setXYZ(i, x * scaleX * bulge, y, z * scaleZ * bulge);
    }
    geo.computeVertexNormals();
    return this.trackGeo(geo);
  }

  private createCrestPlateGeo(width: number, height: number, depth: number): THREE.BufferGeometry {
    const geo = new THREE.OctahedronGeometry(1, 2);
    const pos = geo.getAttribute('position') as THREE.BufferAttribute;
    for (let i = 0; i < pos.count; i++) {
      let x = pos.getX(i);
      let y = pos.getY(i);
      let z = pos.getZ(i);
      // Taper vertically into sharp diamond armor crest, convex front ridge
      const taper = Math.max(0.18, 1.0 - Math.pow(Math.abs(y), 1.6) * 0.78);
      x *= width * 0.5 * taper;
      y *= height * 0.5;
      z *= depth * 0.5 * taper;
      // Central chitin ridge pop forward
      z += (1.0 - Math.abs(pos.getX(i))) * depth * 0.22;
      pos.setXYZ(i, x, y, z);
    }
    geo.computeVertexNormals();
    return this.trackGeo(geo);
  }

  private createHornSpikeGeo(baseR: number, length: number): THREE.BufferGeometry {
    const geo = new THREE.ConeGeometry(baseR, length, 8, 5);
    const pos = geo.getAttribute('position') as THREE.BufferAttribute;
    for (let i = 0; i < pos.count; i++) {
      const x = pos.getX(i);
      const y = pos.getY(i);
      const z = pos.getZ(i);
      const t = (y + length * 0.5) / length; // 0 base -> 1 tip
      // Natural curved talon sweep along +Z / -Z
      const sweepZ = Math.pow(t, 1.8) * length * 0.24;
      pos.setXYZ(i, x * 0.85, y, z * 1.15 - sweepZ);
    }
    geo.computeVertexNormals();
    return this.trackGeo(geo);
  }

  private createTaperedTubeGeo(segments: number, radialSegments: number): THREE.BufferGeometry {
    const geo = new THREE.BufferGeometry();
    const vertexCount = (segments + 1) * radialSegments + 1;
    const positions = new Float32Array(vertexCount * 3);
    const normals = new Float32Array(vertexCount * 3);
    const uvs = new Float32Array(vertexCount * 2);
    const indices: number[] = [];

    for (let s = 0; s <= segments; s++) {
      const v = s / segments;
      for (let r = 0; r < radialSegments; r++) {
        const idx = s * radialSegments + r;
        uvs[idx * 2] = r / radialSegments;
        uvs[idx * 2 + 1] = v;
      }
    }
    const tipIdx = (segments + 1) * radialSegments;
    uvs[tipIdx * 2] = 0.5;
    uvs[tipIdx * 2 + 1] = 1.0;

    for (let s = 0; s < segments; s++) {
      for (let r = 0; r < radialSegments; r++) {
        const nextR = (r + 1) % radialSegments;
        const v0 = s * radialSegments + r;
        const v1 = s * radialSegments + nextR;
        const v2 = (s + 1) * radialSegments + r;
        const v3 = (s + 1) * radialSegments + nextR;
        indices.push(v0, v1, v2, v2, v1, v3);
      }
    }

    const lastRing = segments * radialSegments;
    for (let r = 0; r < radialSegments; r++) {
      indices.push(lastRing + r, lastRing + ((r + 1) % radialSegments), tipIdx);
    }

    geo.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    geo.setAttribute('normal', new THREE.BufferAttribute(normals, 3));
    geo.setAttribute('uv', new THREE.BufferAttribute(uvs, 2));
    geo.setIndex(indices);
    return geo;
  }

  private updateTubeGeometry(
    geo: THREE.BufferGeometry,
    spinePoints: THREE.Vector3[],
    baseRadius: number,
    radialSegments: number
  ): void {
    const posAttr = geo.getAttribute('position') as THREE.BufferAttribute;
    const normAttr = geo.getAttribute('normal') as THREE.BufferAttribute;
    if (!posAttr || !normAttr) return;

    const segments = spinePoints.length - 1;
    const T = this.scratchT;
    const N = this.scratchN;
    const B = this.scratchB;

    for (let s = 0; s <= segments; s++) {
      const pt = spinePoints[s];
      if (s < segments) T.subVectors(spinePoints[s + 1], pt).normalize();
      else T.subVectors(pt, spinePoints[s - 1]).normalize();
      if (T.lengthSq() < 0.0001) T.set(0, 1, 0);

      if (s === 0) {
        N.crossVectors(T, this.scratchUp).normalize();
        if (N.lengthSq() < 0.0001) N.crossVectors(T, this.scratchFallbackAxis).normalize();
      } else {
        const dot = N.dot(T);
        N.addScaledVector(T, -dot).normalize();
        if (N.lengthSq() < 0.0001) N.crossVectors(T, this.scratchUp).normalize();
      }
      B.crossVectors(T, N).normalize();

      const t = s / segments;
      const taper = Math.pow(1.0 - t * 0.88, 1.28);
      const ripple = 1.0 + 0.07 * Math.sin(t * Math.PI * 14.0);
      const radius = (baseRadius * taper + 1.8) * ripple;

      for (let r = 0; r < radialSegments; r++) {
        const theta = (r / radialSegments) * Math.PI * 2;
        const cosT = Math.cos(theta);
        const sinT = Math.sin(theta);

        const nx = N.x * cosT + B.x * sinT;
        const ny = N.y * cosT + B.y * sinT;
        const nz = N.z * cosT + B.z * sinT;

        const idx = s * radialSegments + r;
        posAttr.setXYZ(idx, pt.x + nx * radius, pt.y + ny * radius, pt.z + nz * radius);
        normAttr.setXYZ(idx, nx, ny, nz);
      }
    }

    const lastPt = spinePoints[segments];
    const prevPt = spinePoints[segments - 1];
    T.subVectors(lastPt, prevPt).normalize();
    const tipIdx = (segments + 1) * radialSegments;
    posAttr.setXYZ(tipIdx, lastPt.x + T.x * 7.0, lastPt.y + T.y * 7.0, lastPt.z + T.z * 7.0);
    normAttr.setXYZ(tipIdx, T.x, T.y, T.z);

    posAttr.needsUpdate = true;
    normAttr.needsUpdate = true;
    geo.computeBoundingSphere();
  }

  private buildOrganicSurfaceTextures(): {
    fleshMap: THREE.CanvasTexture;
    fleshEmissive: THREE.CanvasTexture;
    carapaceMap: THREE.CanvasTexture;
    carapaceBump: THREE.CanvasTexture;
  } {
    // 1. Abyssal Violet Muscle & Bio-Vein Flesh
    const fCanvas = document.createElement('canvas');
    fCanvas.width = 256;
    fCanvas.height = 256;
    const fCtx = fCanvas.getContext('2d')!;
    const fGrad = fCtx.createLinearGradient(0, 0, 0, 256);
    fGrad.addColorStop(0, '#3b1557');
    fGrad.addColorStop(0.5, '#290d42');
    fGrad.addColorStop(1, '#1a062b');
    fCtx.fillStyle = fGrad;
    fCtx.fillRect(0, 0, 256, 256);

    for (let y = 0; y < 256; y += 14) {
      fCtx.strokeStyle = 'rgba(139, 92, 246, 0.22)';
      fCtx.lineWidth = 2;
      fCtx.beginPath();
      for (let x = 0; x <= 256; x += 16) {
        const wy = y + Math.sin(x * 0.05 + y) * 5;
        if (x === 0) fCtx.moveTo(x, wy);
        else fCtx.lineTo(x, wy);
      }
      fCtx.stroke();
    }

    const fleshMap = new THREE.CanvasTexture(fCanvas);
    fleshMap.wrapS = fleshMap.wrapT = THREE.RepeatWrapping;
    fleshMap.colorSpace = THREE.SRGBColorSpace;

    const eCanvas = document.createElement('canvas');
    eCanvas.width = 256;
    eCanvas.height = 256;
    const eCtx = eCanvas.getContext('2d')!;
    eCtx.fillStyle = '#000000';
    eCtx.fillRect(0, 0, 256, 256);
    eCtx.strokeStyle = '#d946ef';
    eCtx.lineWidth = 3;
    for (let i = 0; i < 12; i++) {
      const sy = i * 22;
      eCtx.beginPath();
      for (let x = 0; x <= 256; x += 16) {
        const py = sy + Math.sin(x * 0.04 + i) * 7;
        if (x === 0) eCtx.moveTo(x, py);
        else eCtx.lineTo(x, py);
      }
      eCtx.stroke();
    }
    const fleshEmissive = new THREE.CanvasTexture(eCanvas);
    fleshEmissive.wrapS = fleshEmissive.wrapT = THREE.RepeatWrapping;

    // 2. Iridescent Lavender-Bone Carapace Armor Striations & Bump
    const cCanvas = document.createElement('canvas');
    cCanvas.width = 256;
    cCanvas.height = 256;
    const cCtx = cCanvas.getContext('2d')!;
    const cGrad = cCtx.createLinearGradient(0, 0, 0, 256);
    cGrad.addColorStop(0, '#e9d5ff');
    cGrad.addColorStop(0.55, '#c090c8');
    cGrad.addColorStop(1, '#7c4d8d');
    cCtx.fillStyle = cGrad;
    cCtx.fillRect(0, 0, 256, 256);

    const bCanvas = document.createElement('canvas');
    bCanvas.width = 256;
    bCanvas.height = 256;
    const bCtx = bCanvas.getContext('2d')!;
    bCtx.fillStyle = '#808080';
    bCtx.fillRect(0, 0, 256, 256);

    for (let i = 0; i < 18; i++) {
      const y = i * 14;
      cCtx.strokeStyle = 'rgba(255, 240, 255, 0.25)';
      cCtx.lineWidth = 1.6;
      cCtx.beginPath();
      cCtx.moveTo(0, y);
      cCtx.lineTo(256, y + 8);
      cCtx.stroke();

      bCtx.strokeStyle = i % 2 === 0 ? '#b8b8b8' : '#555555';
      bCtx.lineWidth = 3;
      bCtx.beginPath();
      bCtx.moveTo(0, y);
      bCtx.lineTo(256, y + 8);
      bCtx.stroke();
    }

    const carapaceMap = new THREE.CanvasTexture(cCanvas);
    carapaceMap.wrapS = carapaceMap.wrapT = THREE.RepeatWrapping;
    carapaceMap.colorSpace = THREE.SRGBColorSpace;
    const carapaceBump = new THREE.CanvasTexture(bCanvas);
    carapaceBump.wrapS = carapaceBump.wrapT = THREE.RepeatWrapping;

    this.ownedTexs.push(fleshMap, fleshEmissive, carapaceMap, carapaceBump);
    return { fleshMap, fleshEmissive, carapaceMap, carapaceBump };
  }

  /**
   * Updates skeletal posture, facing yaw, jaw aperture, 10 dorsal 3D tentacles, and status flashes.
   * Returns `true` on walk footstep contact frames so footsteps & camera trauma match strides.
   */
  public update(
    enemy: Enemy,
    dt: number,
    playerPos: { x: number; y: number },
    nowSec: number
  ): { footstepTriggered: boolean } {
    let footstepTriggered = false;

    // Position rooted at enemy ground/z base
    this.group.position.set(enemy.pos.x, enemy.z, enemy.pos.y);

    // Hit flash tracking
    if (enemy.health < this.lastHealth) {
      this.hitFlashTimer = 0.14;
    }
    this.lastHealth = enemy.health;
    if (this.hitFlashTimer > 0) {
      this.hitFlashTimer = Math.max(0, this.hitFlashTimer - dt);
    }

    // Target 360-degree facing yaw (local +Z points forward)
    let aimDx = playerPos.x - enemy.pos.x;
    let aimDz = playerPos.y - enemy.pos.y;
    if (enemy.titanState === 'laser_sweep' && enemy.titanLaserAngle !== undefined) {
      aimDx = Math.cos(enemy.titanLaserAngle);
      aimDz = Math.sin(enemy.titanLaserAngle);
    } else if (enemy.titanState === 'tentacle_strike' && enemy.titanTentacleTarget) {
      aimDx = enemy.titanTentacleTarget.x - enemy.pos.x;
      aimDz = enemy.titanTentacleTarget.y - enemy.pos.y;
    }

    if (aimDx * aimDx + aimDz * aimDz > 0.01) {
      const targetYaw = Math.atan2(aimDx, aimDz);
      let diff = targetYaw - this.currentYaw;
      while (diff > Math.PI) diff -= Math.PI * 2;
      while (diff < -Math.PI) diff += Math.PI * 2;
      const turnSpeed = enemy.titanState === 'laser_sweep' ? 14 : 6.5;
      this.currentYaw += diff * Math.min(1, dt * turnSpeed);
    }
    this.rootGroup.rotation.y = this.currentYaw;

    // Status tint & flash modulation
    const flash = this.hitFlashTimer / 0.14;
    const pulse = 0.72 + 0.22 * Math.sin(nowSec * 3.4);
    if (flash > 0) {
      this.fleshMat.emissive.setHex(0xffffff);
      this.fleshMat.emissiveIntensity = 0.75 + flash * 1.4;
      this.carapaceMat.emissive.setHex(0xf5d0fe);
      this.carapaceMat.emissiveIntensity = 0.25 + flash * 0.9;
    } else if (enemy.isChilled) {
      this.fleshMat.emissive.setHex(0x38bdf8);
      this.fleshMat.emissiveIntensity = 0.85;
      this.carapaceMat.emissive.setHex(0x0ea5e9);
      this.carapaceMat.emissiveIntensity = 0.35;
    } else if ((enemy.shredStacks ?? 0) > 0) {
      this.fleshMat.emissive.setHex(0xf97316);
      this.fleshMat.emissiveIntensity = 0.85;
      this.carapaceMat.emissive.setHex(0x9a3412);
      this.carapaceMat.emissiveIntensity = 0.3;
    } else {
      this.fleshMat.emissive.setHex(0xd946ef);
      this.fleshMat.emissiveIntensity = pulse;
      this.carapaceMat.emissive.setHex(0x581c87);
      this.carapaceMat.emissiveIntensity = 0.16;
    }

    this.breathPhase += dt * 2.4;
    const breath = Math.sin(this.breathPhase);
    const state = enemy.titanState || 'idle';

    // Reset default pose accumulators before state blending
    let jawOpen = 0.10 + breath * 0.04;
    let headPitch = 0.06;
    let chestPitch = 0.16 + breath * 0.03;
    let chestBobY = breath * 4.5;
    let tentacleSpreadFactor = 0.38;
    let tentacleWaveFreq = 2.6;
    let tentacleWaveAmp = 14.0;
    let throatScale = 0.75;

    if (state === 'emerging') {
      const emergeProg = 1.0 - Math.max(0, (enemy.titanTimer ?? 4.0) / 4.0);
      chestPitch = 0.55 * (1.0 - emergeProg) + 0.18;
      jawOpen = 0.35 * Math.sin(emergeProg * Math.PI);
      headPitch = -0.35 * Math.sin(emergeProg * Math.PI);
      tentacleSpreadFactor = 0.5 + 0.5 * emergeProg;
      tentacleWaveAmp = 24;
      this.rootGroup.scale.setScalar(Math.max(0.25, 0.35 + emergeProg * 0.65));
      this.lastStepHalfCycle = -1;
    } else if (state === 'dying') {
      const deathProg = 1.0 - Math.max(0, (enemy.titanTimer ?? 3.2) / 3.2);
      chestPitch = 0.25 + deathProg * 0.95;
      chestBobY = -deathProg * 95;
      jawOpen = 0.65 * (1 - deathProg * 0.6);
      tentacleSpreadFactor = Math.max(0.1, 0.45 * (1 - deathProg));
      this.rootGroup.scale.setScalar(Math.max(0.55, 1.0 - deathProg * 0.35));
      this.lastStepHalfCycle = -1;
    } else {
      this.rootGroup.scale.setScalar(1.0);
      if (state === 'walk') {
        const speedNorm = Math.min(1.5, Math.hypot(enemy.velocity.x, enemy.velocity.y) / Math.max(1, STAGE1_BOSS_CONFIG.speed));
        this.walkPhase += dt * (4.6 * Math.max(0.55, speedNorm));
        const halfCycle = Math.floor(this.walkPhase / Math.PI);
        if (halfCycle !== this.lastStepHalfCycle) {
          this.lastStepHalfCycle = halfCycle;
          footstepTriggered = true;
        }
        const stride = Math.sin(this.walkPhase);
        const liftL = Math.max(0, Math.cos(this.walkPhase));
        const liftR = Math.max(0, -Math.cos(this.walkPhase));

        chestBobY += Math.abs(stride) * 7.0;
        chestPitch = 0.22 + Math.abs(stride) * 0.05;
        this.chestPivot.rotation.z = stride * 0.055;
        this.chestPivot.rotation.y = stride * 0.06;

        // Alternate heavy gauntlet strides + hind legs
        this.leftShoulder.rotation.set(stride * 0.36 - liftL * 0.14, 0.12, -0.08);
        this.rightShoulder.rotation.set(-stride * 0.36 - liftR * 0.14, -0.12, 0.08);
        this.leftElbow.rotation.set(-0.22 - liftL * 0.25, 0, 0);
        this.rightElbow.rotation.set(-0.22 - liftR * 0.25, 0, 0);

        this.leftHip.rotation.set(-stride * 0.42 - liftL * 0.18, 0, 0);
        this.leftKnee.rotation.set(0.2 + liftL * 0.45, 0, 0);
        this.rightHip.rotation.set(stride * 0.42 - liftR * 0.18, 0, 0);
        this.rightKnee.rotation.set(0.2 + liftR * 0.45, 0, 0);
      } else if (state === 'laser_sweep') {
        this.lastStepHalfCycle = -1;
        // Rears head slightly back, jaws unhinge wide, arms plant firmly forward to brace beam recoil!
        chestPitch = 0.05;
        headPitch = -0.22;
        jawOpen = 0.78 + Math.sin(nowSec * 18) * 0.06;
        throatScale = 1.55 + Math.sin(nowSec * 24) * 0.22;
        tentacleSpreadFactor = 0.72;
        tentacleWaveFreq = 6.2;
        tentacleWaveAmp = 18;
        this.chestPivot.rotation.z = 0;
        this.chestPivot.rotation.y = 0;
        this.leftShoulder.rotation.set(-0.26, -0.15, 0.22);
        this.rightShoulder.rotation.set(-0.26, 0.15, -0.22);
        this.leftElbow.rotation.set(-0.18, 0, 0);
        this.rightElbow.rotation.set(-0.18, 0, 0);
        this.resetLegsStance();
      } else if (state === 'tentacle_strike') {
        this.lastStepHalfCycle = -1;
        // Aggressive forward lunge while channeling earth-impaling tentacles
        const isStrike = enemy.titanTentaclePhase === 'strike';
        chestPitch = isStrike ? 0.34 : 0.22;
        headPitch = isStrike ? 0.14 : -0.1;
        jawOpen = isStrike ? 0.56 : 0.32;
        throatScale = isStrike ? 1.25 : 0.95;
        tentacleSpreadFactor = isStrike ? 0.85 : 0.65;
        tentacleWaveFreq = 7.5;
        this.chestPivot.rotation.z = 0;
        this.chestPivot.rotation.y = 0;
        const armSwing = isStrike ? -0.45 : -0.22;
        this.leftShoulder.rotation.set(armSwing, 0.2, 0.15);
        this.rightShoulder.rotation.set(armSwing, -0.2, -0.15);
        this.leftElbow.rotation.set(-0.3, 0, 0);
        this.rightElbow.rotation.set(-0.3, 0, 0);
        this.resetLegsStance();
      } else if (state === 'elemental_barrage') {
        this.lastStepHalfCycle = -1;
        const chargeDur = STAGE1_BOSS_CONFIG.elemental.chargeDuration;
        const prog = Math.min(1.0, Math.max(0, (chargeDur - (enemy.titanTimer ?? 0)) / chargeDur));
        // Crown fans completely outward to cradle all 10 plasma spheres!
        chestPitch = 0.08 - prog * 0.14;
        chestBobY += prog * 14;
        headPitch = -0.18 - prog * 0.12;
        jawOpen = 0.25 + prog * 0.45;
        throatScale = 1.0 + prog * 0.5;
        tentacleSpreadFactor = 0.55 + prog * 0.55;
        tentacleWaveFreq = 4.5 + prog * 4.5;
        tentacleWaveAmp = 10 + prog * 12;
        this.chestPivot.rotation.z = 0;
        this.chestPivot.rotation.y = 0;
        this.leftShoulder.rotation.set(-0.2 - prog * 0.35, -0.1, 0.15 + prog * 0.25);
        this.rightShoulder.rotation.set(-0.2 - prog * 0.35, 0.1, -0.15 - prog * 0.25);
        this.leftElbow.rotation.set(-0.35, 0, 0);
        this.rightElbow.rotation.set(-0.35, 0, 0);
        this.resetLegsStance();
      } else {
        // Idle towering stance
        this.lastStepHalfCycle = -1;
        this.chestPivot.rotation.z = 0;
        this.chestPivot.rotation.y = Math.sin(this.breathPhase * 0.5) * 0.04;
        this.leftShoulder.rotation.set(breath * 0.06, 0, 0.05);
        this.rightShoulder.rotation.set(breath * 0.06, 0, -0.05);
        this.leftElbow.rotation.set(-0.18, 0, 0);
        this.rightElbow.rotation.set(-0.18, 0, 0);
        this.resetLegsStance();
      }
    }

    this.pelvis.position.y = 122 + chestBobY;
    this.chestPivot.rotation.x = chestPitch;
    this.neckPivot.rotation.x = -chestPitch * 0.45 + headPitch * 0.35;
    this.headGroup.rotation.x = headPitch;
    this.lowerJawPivot.rotation.x = jawOpen;
    this.throatGlowMesh.scale.set(0.85 * throatScale, 1.15 * throatScale, 1.1 * throatScale);
    this.coreGlowMat.emissiveIntensity = 1.65 + 0.55 * Math.sin(nowSec * 6.0);

    // Update world matrices once before computing tentacle spine curves & world sockets
    this.group.updateMatrixWorld(true);

    // Animate all 10 smooth tapered 3D dorsal tentacles in chest-local space, then cache world tips
    const segs = 16;
    for (let i = 0; i < 10; i++) {
      const t = this.dorsalTentacles[i];
      const root = this.scratchRoot.copy(t.rootLocal);

      const waveA = Math.sin(nowSec * tentacleWaveFreq + t.phase) * tentacleWaveAmp;
      const waveB = Math.cos(nowSec * (tentacleWaveFreq * 0.85) + t.phase * 1.4) * (tentacleWaveAmp * 0.7);

      const tip = this.scratchTip.set(
        t.tipSpreadX * (0.72 + 0.35 * tentacleSpreadFactor) + waveA,
        t.tipHeight + waveB * 0.65,
        t.tipFwdZ * (0.55 + 0.65 * tentacleSpreadFactor) + waveA * 0.35
      );
      const ctrl1 = this.scratchCtrl1.set(
        t.spreadX * 0.65,
        t.rootLocal.y + 68 + waveA * 0.3,
        t.spreadZ - 26
      );
      const ctrl2 = this.scratchCtrl2.set(
        t.spreadX * (0.85 + 0.25 * tentacleSpreadFactor) + waveB * 0.6,
        (t.rootLocal.y + t.tipHeight) * 0.62 + 48,
        t.spreadZ + 18 + waveA * 0.4
      );

      for (let s = 0; s <= segs; s++) {
        const u = s / segs;
        const inv = 1 - u;
        const b0 = inv * inv * inv;
        const b1 = 3 * inv * inv * u;
        const b2 = 3 * inv * u * u;
        const b3 = u * u * u;

        const pt = t.spinePoints[s];
        pt.set(
          b0 * root.x + b1 * ctrl1.x + b2 * ctrl2.x + b3 * tip.x,
          b0 * root.y + b1 * ctrl1.y + b2 * ctrl2.y + b3 * tip.y,
          b0 * root.z + b1 * ctrl1.z + b2 * ctrl2.z + b3 * tip.z
        );
        // Subtle serpentine mid-spine undulation
        const midEnv = Math.sin(u * Math.PI);
        pt.x += Math.sin(nowSec * 4.5 - u * 4.2 + t.phase) * 9.0 * midEnv;
        pt.z += Math.cos(nowSec * 3.8 - u * 3.8 + t.phase) * 7.0 * midEnv;
      }

      this.updateTubeGeometry(t.geo, t.spinePoints, t.baseRadius, 8);

      const lastPt = t.spinePoints[segs];
      const prevPt = t.spinePoints[segs - 1];
      t.stinger.position.copy(lastPt);
      this.scratchDir.subVectors(lastPt, prevPt).normalize();
      if (this.scratchDir.lengthSq() > 0.0001) {
        t.stinger.quaternion.setFromUnitVectors(new THREE.Vector3(0, 0, 1), this.scratchDir);
      }

      // Cache world coordinates for Elemental Orbs & Dorsal Strike Sockets
      this.tipWorldPositions[i].copy(lastPt);
      this.chestPivot.localToWorld(this.tipWorldPositions[i]);

      this.dorsalRootWorldCache[i].copy(t.rootLocal);
      this.chestPivot.localToWorld(this.dorsalRootWorldCache[i]);
    }

    return { footstepTriggered };
  }

  private resetLegsStance(): void {
    this.leftHip.rotation.set(-0.08, 0.12, 0.05);
    this.leftKnee.rotation.set(0.18, 0, 0);
    this.rightHip.rotation.set(-0.08, -0.12, -0.05);
    this.rightKnee.rotation.set(0.18, 0, 0);
  }

  public getYaw(): number {
    return this.currentYaw;
  }

  public getMouthWorldPos(out: THREE.Vector3): THREE.Vector3 {
    this.group.updateMatrixWorld(true);
    return this.mouthSocket.getWorldPosition(out);
  }

  public getTentacleTipWorldPos(index: number, out: THREE.Vector3): THREE.Vector3 {
    const clamped = ((index % 10) + 10) % 10;
    return out.copy(this.tipWorldPositions[clamped]);
  }

  public getCarapaceStrikeSocket(flankIndex: number, out: THREE.Vector3): THREE.Vector3 {
    // Map the 4 strike tentacles symmetrically across the outer/inner dorsal roots
    const socketIndices = [6, 5, 0, 1];
    const idx = socketIndices[flankIndex % socketIndices.length];
    return out.copy(this.dorsalRootWorldCache[idx]);
  }

  public dispose(): void {
    for (const g of this.ownedGeos) g.dispose();
    for (const m of this.ownedMats) m.dispose();
    for (const t of this.ownedTexs) t.dispose();
  }
}


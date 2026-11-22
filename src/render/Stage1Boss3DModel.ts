import * as THREE from 'three';
import { EnemyState } from '../sim/types';
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
 * Sculpted 3D Articulated Rig for the Stage 1 Titan Boss (Colossal Bio-Cultivator).
 *
 * Anatomically modeled after the 4-angle reference sprite sheets
 * (boss_walk_front/back/left, boss_laser_front, boss_elemental_front):
 * - Low, wide, forward-hunched kaiju stance with feet planted at Y = 0
 * - Swept diamond V-crest skull tucked low between shoulders (cranes upward to roar on laser)
 * - Stacked glowing magenta sternum chevrons & upper-back cascading bio-crystal petal mantle
 * - Massive wide-splayed curved crescent scythe-gauntlets with serrated bone-lavender outer blades
 *   and glowing magenta inner forearm energy fissures
 * - Flared bone-lavender shin greaves, V-shaped pelvic armor, and glowing shoulder/thigh bio-sacs
 * - 10 whip-thin sinuous dorsal tendrils fanning into a radial halo for the 10 elemental orbs
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
  private readonly podGlowMat: THREE.MeshStandardMaterial;
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
  private readonly scratchForward = new THREE.Vector3(0, 0, 1);

  constructor(tentacleSkinTex: THREE.Texture, tentacleEmissiveTex: THREE.Texture) {
    this.group = new THREE.Group();
    this.group.name = 'titan_3d_boss_group';
    this.group.userData = { isTitanPart: true };
    this.group.scale.setScalar(2.0);

    this.rootGroup = new THREE.Group();
    this.group.add(this.rootGroup);

    const { fleshMap, fleshEmissive, carapaceMap, carapaceBump } = this.buildOrganicSurfaceTextures();

    this.fleshMat = new THREE.MeshStandardMaterial({
      map: fleshMap,
      emissiveMap: fleshEmissive,
      emissive: new THREE.Color(0xc026d3),
      emissiveIntensity: 0.22,
      roughness: 0.54,
      metalness: 0.12
    });

    this.carapaceMat = new THREE.MeshStandardMaterial({
      color: 0xd8c2dc,
      map: carapaceMap,
      bumpMap: carapaceBump,
      bumpScale: 1.05,
      emissive: new THREE.Color(0x3b1750),
      emissiveIntensity: 0.12,
      roughness: 0.48,
      metalness: 0.16
    });

    this.bladeEdgeMat = new THREE.MeshStandardMaterial({
      color: 0xe9d5c0,
      emissive: new THREE.Color(0x6b21a8),
      emissiveIntensity: 0.18,
      roughness: 0.36,
      metalness: 0.22
    });

    this.coreGlowMat = new THREE.MeshStandardMaterial({
      color: 0xf0abfc,
      emissive: new THREE.Color(0xe879f9),
      emissiveIntensity: 1.55,
      roughness: 0.16,
      metalness: 0.06
    });

    this.podGlowMat = new THREE.MeshStandardMaterial({
      color: 0xe879f9,
      emissive: new THREE.Color(0xc026d3),
      emissiveIntensity: 1.45,
      roughness: 0.20,
      metalness: 0.10
    });

    // Fierce glowing magenta-violet eye slits matching boss_walk_front / boss_walk_left
    this.eyeGlowMat = new THREE.MeshBasicMaterial({
      color: 0xf0abfc
    });

    const tentacleMat = new THREE.MeshStandardMaterial({
      map: tentacleSkinTex,
      emissiveMap: tentacleEmissiveTex,
      emissive: new THREE.Color(0xc026d3),
      emissiveIntensity: 0.85,
      roughness: 0.30,
      metalness: 0.26,
      side: THREE.DoubleSide
    });

    const whipTipMat = new THREE.MeshStandardMaterial({
      color: 0xc084fc,
      emissive: new THREE.Color(0xe879f9),
      emissiveIntensity: 1.15,
      roughness: 0.22,
      metalness: 0.2
    });

    this.ownedMats.push(
      this.fleshMat,
      this.carapaceMat,
      this.bladeEdgeMat,
      this.coreGlowMat,
      this.podGlowMat,
      this.eyeGlowMat,
      tentacleMat,
      whipTipMat
    );

    // ------------------------------------------------------------------
    // SKELETAL HIERARCHY (Feet soles at Y = 0, Shoulder crest ~265, Tentacles ~410)
    // Facing +Z in local space
    // ------------------------------------------------------------------
    this.pelvis = new THREE.Group();
    this.pelvis.position.set(0, 114, -8);
    this.rootGroup.add(this.pelvis);

    // Muscular tapered waist & hip core
    const pelvisCore = this.addSculptedPart(
      this.pelvis,
      this.createTaperedOrganicGeo(34, 28, 48, 14, 8, 1.18, 0.92),
      this.fleshMat,
      [0, 6, 0]
    );
    pelvisCore.castShadow = false;

    // Sleek dark-chitin front groin cusp (subtle on front silhouette) + prominent Y/V pelvic armor on the BACK (boss_walk_back)
    this.addSculptedPart(
      this.pelvis,
      this.createPelvisShieldGeo(24, 34, 10),
      this.carapaceMat,
      [0, -2, 22],
      [0.16, 0, 0]
    );
    this.addSculptedPart(
      this.pelvis,
      this.createPelvisShieldGeo(48, 60, 16),
      this.carapaceMat,
      [0, 4, -24],
      [-0.24, Math.PI, 0]
    );
    for (const side of [-1, 1]) {
      this.addSculptedPart(
        this.pelvis,
        this.createCurvedFinGeo(22, 44, 10, 0.22),
        this.carapaceMat,
        [side * 38, 6, 2],
        [0.08, side * 0.56, -side * 0.42]
      );
    }

    // ------------------------------------------------------------------
    // HUNCHED MUSCULAR CHEST & BIOLUMINESCENT MANTLE
    // ------------------------------------------------------------------
    this.chestPivot = new THREE.Group();
    this.chestPivot.position.set(0, 22, 6);
    this.pelvis.add(this.chestPivot);

    // Broad V-tapered upper torso muscular vault (arched trapezius dome — zero flat cylinder lid!)
    this.addSculptedPart(
      this.chestPivot,
      this.createTaperedOrganicGeo(34, 56, 114, 16, 12, 1.16, 0.88, true),
      this.fleshMat,
      [0, 52, 8],
      [0.32, 0, 0]
    );

    // Sculpted deltoid/pectoral musculature flanking the center sternum fissure
    for (const side of [-1, 1]) {
      this.addSculptedPart(
        this.chestPivot,
        this.createTaperedOrganicGeo(20, 32, 84, 12, 8, 1.08, 0.90, true),
        this.fleshMat,
        [side * 38, 56, 10],
        [0.26, side * 0.18, -side * 0.24]
      );
    }

    // Stacked Glowing Magenta Sternum Chevrons (sleek glowing V-ribs embedded flush on chest!)
    for (let v = 0; v < 5; v++) {
      const t = v / 4;
      const yOff = 18 + v * 15.5;
      const zOff = 44 + v * 7.8;
      const width = 12 + t * 14;
      // Central glowing rib nodule
      this.addSculptedPart(
        this.chestPivot,
        this.createPetalPodGeo(width * 0.36, 13 + t * 4, 6),
        this.coreGlowMat,
        [0, yOff, zOff],
        [0.26, 0, Math.PI]
      );
      // Angled flanking chevron energy slits
      for (const side of [-1, 1]) {
        this.addSculptedPart(
          this.chestPivot,
          this.createPetalPodGeo(5.5 + t * 1.8, 22 + t * 12, 5),
          this.coreGlowMat,
          [side * (12 + t * 15), yOff + 5, zOff - 1],
          [0.28, side * 0.35, -side * 0.98]
        );
      }
    }

    // Broad Overhanging Spine Carapace + Serrated Bone-Lavender Back Plates
    this.addSculptedPart(
      this.chestPivot,
      this.createPelvisShieldGeo(98, 104, 28),
      this.carapaceMat,
      [0, 74, -22],
      [0.54, Math.PI, 0]
    );
    for (let sp = 0; sp < 4; sp++) {
      const sScale = 1.0 - sp * 0.14;
      this.addSculptedPart(
        this.chestPivot,
        this.createCurvedFinGeo(14 * sScale, 50 * sScale, 10 * sScale, 0.35),
        this.carapaceMat,
        [0, 106 - sp * 20, -34 - sp * 10],
        [-0.45 - sp * 0.16, Math.PI * 0.5, 0]
      );
    }

    // Iconic Upper-Back & Shoulder Cascading Bio-Crystal Petal Mantle (from boss_walk_back.png!)
    const mantleRows: Array<{ x: number; y: number; z: number; rx: number; ry: number; rz: number; s: number }> = [
      // Center spine petal cluster
      { x: 0, y: 102, z: -26, rx: -0.35, ry: Math.PI, rz: Math.PI, s: 1.15 },
      { x: -16, y: 92, z: -28, rx: -0.32, ry: Math.PI - 0.18, rz: Math.PI + 0.22, s: 1.05 },
      { x: 16, y: 92, z: -28, rx: -0.32, ry: Math.PI + 0.18, rz: Math.PI - 0.22, s: 1.05 },
      { x: -30, y: 78, z: -26, rx: -0.25, ry: Math.PI - 0.3, rz: Math.PI + 0.36, s: 0.95 },
      { x: 30, y: 78, z: -26, rx: -0.25, ry: Math.PI + 0.3, rz: Math.PI - 0.36, s: 0.95 },
      { x: -12, y: 72, z: -30, rx: -0.22, ry: Math.PI - 0.1, rz: Math.PI + 0.12, s: 0.9 },
      { x: 12, y: 72, z: -30, rx: -0.22, ry: Math.PI + 0.1, rz: Math.PI - 0.12, s: 0.9 },
      // Shoulder-slope glowing violet bio-pods (visible in back & side views)
      { x: -52, y: 90, z: -12, rx: -0.1, ry: -0.75, rz: 0.85, s: 1.0 },
      { x: 52, y: 90, z: -12, rx: -0.1, ry: 0.75, rz: -0.85, s: 1.0 },
      { x: -72, y: 78, z: -4, rx: 0.05, ry: -1.05, rz: 1.02, s: 0.92 },
      { x: 72, y: 78, z: -4, rx: 0.05, ry: 1.05, rz: -1.02, s: 0.92 }
    ];
    for (const pod of mantleRows) {
      this.addSculptedPart(
        this.chestPivot,
        this.createPetalPodGeo(16 * pod.s, 36 * pod.s, 11 * pod.s),
        this.podGlowMat,
        [pod.x, pod.y, pod.z],
        [pod.rx, pod.ry, pod.rz]
      );
    }

    // Dorsal socket anchor (world base for tentacles & strike origin)
    this.dorsalSocketAnchor = new THREE.Object3D();
    this.dorsalSocketAnchor.position.set(0, 96, -12);
    this.chestPivot.add(this.dorsalSocketAnchor);

    // Broad Curved Shoulder Mantle Cowl (seamless arch from upper torso onto deltoids, no needle quills!)
    for (const side of [-1, 1] as const) {
      this.addSculptedPart(
        this.chestPivot,
        this.createPauldronShellGeo(52, 68, 22, side),
        this.carapaceMat,
        [side * 64, 84, 14],
        [0.16, -side * 0.30, -side * 0.46]
      );
      this.addSculptedPart(
        this.chestPivot,
        this.createCurvedFinGeo(26, 62, 16, 0.34),
        this.carapaceMat,
        [side * 88, 94, 6],
        [0.22, side * 0.32, -side * 0.78]
      );
    }

    // ------------------------------------------------------------------
    // LOW-TUCKED V-CREST SKULL & HINGED LASER FURNACE JAW
    // ------------------------------------------------------------------
    this.neckPivot = new THREE.Group();
    // Tucked low & forward between shoulders (raises on laser_sweep!)
    this.neckPivot.position.set(0, 68, 52);
    this.chestPivot.add(this.neckPivot);

    this.addSculptedPart(
      this.neckPivot,
      this.createTaperedOrganicGeo(30, 24, 38, 12, 6, 1.04, 1.0, true),
      this.fleshMat,
      [0, 8, 10],
      [0.54, 0, 0]
    );

    this.headGroup = new THREE.Group();
    this.headGroup.position.set(0, 14, 28);
    this.neckPivot.add(this.headGroup);

    // Broad V-Crown Diamond Skull Shield + Layered Brow/Cheek Crest Fins
    this.addSculptedPart(
      this.headGroup,
      this.createHeadCrestGeo(),
      this.carapaceMat,
      [0, 14, 0],
      [0.08, 0, 0]
    );

    // Swept-back Brow Horns & Jagged Cheek Blades fanning wide like boss_walk_front
    for (const side of [-1, 1]) {
      this.addSculptedPart(
        this.headGroup,
        this.createCurvedFinGeo(18, 66, 12, 0.38),
        this.carapaceMat,
        [side * 22, 22, -2],
        [-0.38, side * 0.32, -side * 0.42]
      );
      this.addSculptedPart(
        this.headGroup,
        this.createCurvedFinGeo(14, 46, 10, 0.24),
        this.carapaceMat,
        [side * 24, 0, 14],
        [0.24, side * 0.56, -side * 0.28]
      );
      // Fierce Slanted Bio-Optic Eye Slit positioned cleanly OUTSIDE cheek ridge so it gleams brightly!
      this.addSculptedPart(
        this.headGroup,
        this.createEyeSlitGeo(),
        this.eyeGlowMat,
        [side * 16, 4, 29],
        [0.14, side * 0.30, side * 0.46]
      );
    }

    // Upper Jaw Snout & Downward Fangs
    this.addSculptedPart(
      this.headGroup,
      this.createPelvisShieldGeo(28, 34, 16),
      this.carapaceMat,
      [0, -4, 22],
      [0.72, 0, 0]
    );
    for (const side of [-1, 1]) {
      this.addSculptedPart(
        this.headGroup,
        this.createCurvedFinGeo(4.8, 22, 6, 0.22),
        this.bladeEdgeMat,
        [side * 10, -14, 29],
        [Math.PI * 0.92, side * 0.15, -side * 0.14]
      );
    }

    // Glowing Inner Throat / Laser Furnace Core (tucked cleanly inside closed jaw; blazes open on roar!)
    const throatGeo = this.trackGeo(new THREE.SphereGeometry(11, 14, 12));
    this.throatGlowMesh = new THREE.Mesh(throatGeo, this.coreGlowMat);
    this.throatGlowMesh.position.set(0, -10, 8);
    this.throatGlowMesh.scale.set(0.75, 0.95, 0.95);
    this.headGroup.add(this.throatGlowMesh);

    this.mouthSocket = new THREE.Object3D();
    this.mouthSocket.position.set(0, -12, 36);
    this.headGroup.add(this.mouthSocket);

    // Hinged Lower Jaw Mandible
    this.lowerJawPivot = new THREE.Group();
    this.lowerJawPivot.position.set(0, -15, 8);
    this.headGroup.add(this.lowerJawPivot);

    this.addSculptedPart(
      this.lowerJawPivot,
      this.createPelvisShieldGeo(24, 32, 14),
      this.carapaceMat,
      [0, -10, 14],
      [1.22, 0, 0]
    );
    for (const side of [-1, 1]) {
      this.addSculptedPart(
        this.lowerJawPivot,
        this.createCurvedFinGeo(4.5, 18, 5, 0.2),
        this.bladeEdgeMat,
        [side * 8, -2, 23],
        [0.34, side * 0.15, -side * 0.18]
      );
    }

    // ------------------------------------------------------------------
    // MASSIVE WIDE-SPLAYED CURVED SCYTHE-GAUNTLET FORELIMBS
    // ------------------------------------------------------------------
    this.leftShoulder = new THREE.Group();
    this.leftShoulder.position.set(-90, 74, 8);
    this.chestPivot.add(this.leftShoulder);
    this.leftElbow = this.buildArmLimb(this.leftShoulder, -1);

    this.rightShoulder = new THREE.Group();
    this.rightShoulder.position.set(90, 74, 8);
    this.chestPivot.add(this.rightShoulder);
    this.rightElbow = this.buildArmLimb(this.rightShoulder, 1);

    // ------------------------------------------------------------------
    // ATHLETIC MUSCULAR HIND LEGS, FLARED GREAVES & 3-TOED CLAWS
    // ------------------------------------------------------------------
    this.leftHip = new THREE.Group();
    this.leftHip.position.set(-40, -2, -2);
    this.pelvis.add(this.leftHip);
    this.leftKnee = this.buildLegLimb(this.leftHip, -1);

    this.rightHip = new THREE.Group();
    this.rightHip.position.set(40, -2, -2);
    this.pelvis.add(this.rightHip);
    this.rightKnee = this.buildLegLimb(this.rightHip, 1);

    // ------------------------------------------------------------------
    // 10 WHIP-THIN SINUOUS DORSAL TENDRILS (Matches boss_walk_front & boss_elemental_front)
    // ------------------------------------------------------------------
    const tentacleLayouts: Array<{
      rx: number; ry: number; rz: number;
      tx: number; ty: number; tz: number;
      ax: number; az: number; radius: number; phase: number;
    }> = [
        // Right Crown Fan (5 whip tendrils)
        { rx: 38, ry: 96, rz: -18, tx: 168, ty: 235, tz: 36, ax: 132, az: -18, radius: 7.8, phase: 0.0 },
        { rx: 52, ry: 80, rz: -12, tx: 172, ty: 158, tz: 44, ax: 148, az: 10, radius: 7.0, phase: 0.8 },
        { rx: 24, ry: 104, rz: -22, tx: 88, ty: 274, tz: 42, ax: 72, az: -26, radius: 7.4, phase: 1.5 },
        { rx: 34, ry: 98, rz: -24, tx: 126, ty: 318, tz: 28, ax: 92, az: -32, radius: 8.2, phase: 2.2 },
        { rx: 12, ry: 108, rz: -24, tx: 42, ty: 342, tz: 30, ax: 28, az: -38, radius: 6.8, phase: 2.9 },
        // Left Crown Fan (5 mirrored whip tendrils)
        { rx: -38, ry: 96, rz: -18, tx: -168, ty: 235, tz: 36, ax: -132, az: -18, radius: 7.8, phase: 3.5 },
        { rx: -52, ry: 80, rz: -12, tx: -172, ty: 158, tz: 44, ax: -148, az: 10, radius: 7.0, phase: 4.2 },
        { rx: -24, ry: 104, rz: -22, tx: -88, ty: 274, tz: 42, ax: -72, az: -26, radius: 7.4, phase: 4.9 },
        { rx: -34, ry: 98, rz: -24, tx: -126, ty: 318, tz: 28, ax: -92, az: -32, radius: 8.2, phase: 5.5 },
        { rx: -12, ry: 108, rz: -24, tx: -42, ty: 342, tz: 30, ax: -28, az: -38, radius: 6.8, phase: 6.1 }
      ];

    // Tiny sleek whip-tip cap (no bulky red cone!)
    const whipTipGeo = this.trackGeo(new THREE.ConeGeometry(1.1, 10, 6));
    whipTipGeo.rotateX(Math.PI / 2);

    const segs = 18;
    const radSegs = 8;
    for (let i = 0; i < 10; i++) {
      const cfg = tentacleLayouts[i];
      const geo = this.createTaperedTubeGeo(segs, radSegs);
      this.ownedGeos.push(geo);

      const mesh = new THREE.Mesh(geo, tentacleMat);
      mesh.frustumCulled = false;
      mesh.renderOrder = 295;
      this.chestPivot.add(mesh);

      const stinger = new THREE.Mesh(whipTipGeo, whipTipMat);
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
    // Sleek Muscular Deltoid/Upper Arm angled steeply outward from torso
    this.addSculptedPart(
      shoulder,
      this.createTaperedOrganicGeo(19, 17, 74, 12, 6, 1.04, 1.02),
      this.fleshMat,
      [side * 18, -30, 6],
      [0.08, 0, side * 0.44]
    );
    // Glowing Deltoid Bio-Sac (matches boss_walk_left glowing purple shoulder pods)
    this.addSculptedPart(
      shoulder,
      this.createPetalPodGeo(11, 22, 9),
      this.podGlowMat,
      [side * 24, -22, 14],
      [0.2, side * 0.4, -side * 0.48]
    );
    // Serrated Outer Bicep Armor Plate
    this.addSculptedPart(
      shoulder,
      this.createCurvedFinGeo(24, 68, 14, 0.30),
      this.carapaceMat,
      [side * 28, -24, 2],
      [0.14, side * 0.34, -side * 0.46]
    );

    const elbow = new THREE.Group();
    elbow.position.set(side * 42, -58, 14);
    shoulder.add(elbow);

    // Tapered Muscular Forearm Core sweeping wide and tapering down toward claw wrist
    this.addSculptedPart(
      elbow,
      this.createTaperedOrganicGeo(15, 25, 92, 12, 7, 1.05, 1.08, true),
      this.fleshMat,
      [side * 10, -46, 10],
      [-0.18, 0, -side * 0.22]
    );

    // Symmetric Sculpted 3D Crescent Scythe-Gauntlet Outer Carapace (closed manifold, 3 serrated outer barbs!)
    this.addSculptedPart(
      elbow,
      this.createScytheGauntletGeo(side),
      this.carapaceMat,
      [side * 22, -46, 12],
      [-0.18, -side * 0.24, -side * 0.22]
    );

    // Bright Glowing Magenta Energy Fissure Inside the Hollow of the Gauntlet
    this.addSculptedPart(
      elbow,
      this.createPetalPodGeo(10, 56, 8),
      this.coreGlowMat,
      [side * 2, -56, 22],
      [-0.18, side * 0.20, -side * 0.22]
    );

    // Thick Curved Mantis Pincer Scythe-Claws arcing steeply INWARD toward each other (matches boss_walk_front!)
    this.addSculptedPart(
      elbow,
      this.createCurvedFinGeo(26, 74, 13, 0.52),
      this.carapaceMat,
      [side * 2, -96, 22],
      [Math.PI * 0.78, -side * 0.22, -side * 0.48]
    );
    this.addSculptedPart(
      elbow,
      this.createCurvedFinGeo(19, 64, 11, 0.46),
      this.bladeEdgeMat,
      [-side * 8, -100, 28],
      [Math.PI * 0.75, -side * 0.14, -side * 0.54]
    );
    this.addSculptedPart(
      elbow,
      this.createCurvedFinGeo(16, 54, 10, 0.42),
      this.carapaceMat,
      [side * 10, -90, 10],
      [Math.PI * 0.80, -side * 0.30, -side * 0.42]
    );

    return elbow;
  }

  private buildLegLimb(hip: THREE.Group, side: -1 | 1): THREE.Group {
    // Sculpted Athletic Kaiju Thigh (slimmer, gnarled, splayed outward)
    this.addSculptedPart(
      hip,
      this.createTaperedOrganicGeo(17, 13.5, 58, 12, 5, 1.0, 1.12),
      this.fleshMat,
      [side * 5, -24, 6],
      [-0.26, 0, side * 0.12]
    );
    // Sleek Vertical Front-Outer Thigh Armor Crest (matches boss_walk_front thigh ridges!)
    this.addSculptedPart(
      hip,
      this.createCurvedFinGeo(14, 48, 10, 0.22),
      this.carapaceMat,
      [side * 10, -24, 17],
      [-0.24, side * 0.30, -side * 0.14]
    );
    this.addSculptedPart(
      hip,
      this.createPetalPodGeo(8, 18, 7),
      this.podGlowMat,
      [side * 15, -24, 2],
      [0.15, side * 0.85, 0]
    );

    const knee = new THREE.Group();
    knee.position.set(side * 8, -50, 18);
    hip.add(knee);

    // Sharp Knee Spur
    this.addSculptedPart(
      knee,
      this.createCurvedFinGeo(10, 30, 9, 0.30),
      this.carapaceMat,
      [side * 2, 6, 14],
      [0.44, 0, 0]
    );

    // Tapered Planted Lower Shin
    this.addSculptedPart(
      knee,
      this.createTaperedOrganicGeo(13, 17, 56, 12, 5, 0.98, 1.12),
      this.fleshMat,
      [0, -28, -8],
      [0.18, 0, 0]
    );

    // Sleek Narrow Jagged Front Shin-Crest Blade + Ankle Spur (NOT a cylindrical tin-can sleeve!)
    this.addSculptedPart(
      knee,
      this.createWrappedGreaveGeo(15, 52, side),
      this.carapaceMat,
      [side * 2, -25, 11],
      [0.18, side * 0.22, 0]
    );
    this.addSculptedPart(
      knee,
      this.createCurvedFinGeo(10, 34, 9, 0.32),
      this.carapaceMat,
      [side * 11, -36, -10],
      [-0.42, side * 0.55, 0]
    );

    // Arched Clawed Kaiju Foot (3 splayed muscular toes + armor claw tips + heel spur, sole at Y = 0)
    this.addSculptedPart(
      knee,
      this.createTaperedOrganicGeo(14, 15, 16, 10, 3, 1.12, 1.18),
      this.fleshMat,
      [0, -52, -4],
      [0, 0, 0]
    );
    // Heel spur
    this.addSculptedPart(
      knee,
      this.createCurvedFinGeo(12, 22, 10, 0.25),
      this.carapaceMat,
      [0, -54, -18],
      [-Math.PI * 0.48, Math.PI, 0]
    );
    // 3 stout forward splayed toes (muscular ridge + chitin claw)
    for (const toe of [-1, 0, 1]) {
      const toeX = toe * 13;
      const toeZ = 12 - Math.abs(toe) * 4;
      const yaw = toe * 0.34;
      this.addSculptedPart(
        knee,
        this.createTaperedOrganicGeo(8.5, 6.5, 22, 8, 3, 1.0, 0.92),
        this.fleshMat,
        [toeX * 0.72, -53, toeZ - 3],
        [Math.PI * 0.46, yaw, 0]
      );
      this.addSculptedPart(
        knee,
        this.createCurvedFinGeo(10, 22, 9.5, 0.30),
        this.carapaceMat,
        [toeX * 1.1, -55, toeZ + 11],
        [Math.PI * 0.50, yaw, 0]
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

  /**
   * Sculpted diamond V-crest skull shell matching boss_walk_front & boss_walk_left.
   */
  private createHeadCrestGeo(): THREE.BufferGeometry {
    const shape = new THREE.Shape();
    shape.moveTo(0, -16);
    shape.lineTo(30, 8);
    shape.lineTo(24, 38);
    shape.lineTo(0, 66);
    shape.lineTo(-24, 38);
    shape.lineTo(-30, 8);
    shape.closePath();

    const geo = new THREE.ExtrudeGeometry(shape, {
      depth: 22,
      bevelEnabled: true,
      bevelThickness: 8,
      bevelSize: 6,
      bevelSegments: 3
    });
    geo.translate(0, 0, -6);

    // Pull center ridge forward and curve crown backward
    const pos = geo.getAttribute('position') as THREE.BufferAttribute;
    for (let i = 0; i < pos.count; i++) {
      const x = pos.getX(i);
      const y = pos.getY(i);
      let z = pos.getZ(i);
      const centerWeight = Math.max(0, 1.0 - Math.abs(x) / 26);
      const heightNorm = Math.min(1, Math.max(0, (y + 14) / 82));
      z += centerWeight * 12.0;
      z -= Math.pow(heightNorm, 1.55) * 26.0;
      pos.setXYZ(i, x * (1.0 - heightNorm * 0.22), y, z);
    }
    geo.computeVertexNormals();
    return this.trackGeo(geo);
  }

  /**
   * Symmetric closed-manifold 3D curved crescent scythe-gauntlet carapace shield along the outer forearm
   * with 3 bold serrated dorsal barbs (guaranteed mirror-symmetric on both -1 and +1 arms!).
   */
  private createScytheGauntletGeo(side: -1 | 1): THREE.BufferGeometry {
    const height = 102;
    const geo = new THREE.BoxGeometry(22, height, 34, 4, 16, 4);
    const pos = geo.getAttribute('position') as THREE.BufferAttribute;

    for (let i = 0; i < pos.count; i++) {
      const x = pos.getX(i);
      const y = pos.getY(i);
      const z = pos.getZ(i);
      const ny = Math.min(1, Math.max(0, (y + height * 0.5) / height)); // 0 bottom wrist -> 1 top elbow

      // Sculpt outer edge (where sign(x) === side) into a sweeping curved multi-barbed crescent blade
      const outerT = Math.min(1, Math.max(0, (x * side + 11) / 22)); // 0 inner edge -> 1 outer spine edge
      const barb1 = Math.exp(-Math.pow((ny - 0.24) / 0.08, 2));
      const barb2 = Math.exp(-Math.pow((ny - 0.55) / 0.09, 2));
      const barb3 = Math.exp(-Math.pow((ny - 0.84) / 0.09, 2));
      const barbFlare = (barb1 * 22 + barb2 * 26 + barb3 * 22) * Math.pow(outerT, 1.4);

      const widthTaper = 0.62 + Math.sin(ny * Math.PI) * 0.55;
      const crescentCurve = Math.sin(ny * Math.PI) * 14 * side;
      const bowForwardZ = Math.sin(ny * Math.PI) * 10;

      // Narrow thickness sharply toward the outer razor spine (outerT -> 1)
      const edgePinch = 1.0 - Math.pow(outerT, 1.8) * 0.72;

      pos.setXYZ(
        i,
        x * widthTaper + crescentCurve + side * barbFlare,
        y + barbFlare * 0.42,
        z * edgePinch * widthTaper + bowForwardZ
      );
    }

    geo.computeVertexNormals();
    return this.trackGeo(geo);
  }

  /**
   * Narrow jagged V-ridge shin crest blade that hugs ONLY the front-outer calf without boxing the ankle.
   */
  private createWrappedGreaveGeo(width: number, height: number, side: -1 | 1): THREE.BufferGeometry {
    const geo = new THREE.CylinderGeometry(width * 0.5, width * 0.65, height, 8, 8, false, -Math.PI * 0.42, Math.PI * 0.84);
    const pos = geo.getAttribute('position') as THREE.BufferAttribute;
    for (let i = 0; i < pos.count; i++) {
      const x = pos.getX(i);
      const y = pos.getY(i);
      const z = pos.getZ(i);
      const ny = Math.min(1, Math.max(0, (y + height * 0.5) / height));
      const crest = Math.max(0, 1.0 - Math.abs(x) / (width * 0.48));
      const ankleFlare = Math.pow(Math.max(0, 0.25 - ny) / 0.25, 1.3) * 7;
      const kneePoint = Math.pow(Math.max(0, ny - 0.72) / 0.28, 1.4) * 14 * crest;
      pos.setXYZ(
        i,
        x * (0.72 + ankleFlare * 0.06) + side * (crest * 2 + ankleFlare * 0.35),
        y + kneePoint,
        z * 0.65 + crest * 8 + ankleFlare * 0.8
      );
    }
    geo.computeVertexNormals();
    return this.trackGeo(geo);
  }

  /**
   * Flared curved shoulder pauldron armor shell.
   */
  private createPauldronShellGeo(width: number, height: number, depth: number, side: -1 | 1): THREE.BufferGeometry {
    const s = side;
    const shape = new THREE.Shape();
    shape.moveTo(-s * width * 0.35, -height * 0.38);
    shape.quadraticCurveTo(0, -height * 0.15, s * width * 0.45, -height * 0.45);
    shape.quadraticCurveTo(s * width * 0.62, 0, s * width * 0.48, height * 0.48);
    shape.lineTo(0, height * 0.36);
    shape.lineTo(-s * width * 0.32, height * 0.18);
    shape.closePath();

    const geo = new THREE.ExtrudeGeometry(shape, {
      depth: depth * 0.6,
      bevelEnabled: true,
      bevelThickness: 6,
      bevelSize: 5,
      bevelSegments: 2
    });
    geo.translate(0, 0, -depth * 0.3);
    geo.computeVertexNormals();
    return this.trackGeo(geo);
  }

  /**
   * Diamond/V-tapered beveled armor plate (pelvis, back, chest, greaves).
   */
  private createPelvisShieldGeo(width: number, height: number, depth: number): THREE.BufferGeometry {
    const hw = width * 0.5;
    const hh = height * 0.5;
    const shape = new THREE.Shape();
    shape.moveTo(0, -hh);
    shape.lineTo(hw * 0.65, -hh * 0.15);
    shape.lineTo(hw, hh * 0.45);
    shape.lineTo(hw * 0.42, hh);
    shape.lineTo(0, hh * 0.78);
    shape.lineTo(-hw * 0.42, hh);
    shape.lineTo(-hw, hh * 0.45);
    shape.lineTo(-hw * 0.65, -hh * 0.15);
    shape.closePath();

    const geo = new THREE.ExtrudeGeometry(shape, {
      depth: depth * 0.55,
      bevelEnabled: true,
      bevelThickness: depth * 0.25,
      bevelSize: 4,
      bevelSegments: 2
    });
    geo.translate(0, 0, -depth * 0.28);

    const pos = geo.getAttribute('position') as THREE.BufferAttribute;
    for (let i = 0; i < pos.count; i++) {
      const x = pos.getX(i);
      const y = pos.getY(i);
      let z = pos.getZ(i);
      const centerRidge = Math.max(0, 1.0 - Math.abs(x) / (hw + 4));
      z += centerRidge * depth * 0.26;
      pos.setXYZ(i, x, y, z);
    }
    geo.computeVertexNormals();
    return this.trackGeo(geo);
  }

  /**
   * Glowing teardrop crystal-petal pod (for upper-back mantle & shoulder/thigh bio-sacs).
   */
  private createPetalPodGeo(width: number, height: number, depth: number): THREE.BufferGeometry {
    const geo = new THREE.OctahedronGeometry(1, 2);
    const pos = geo.getAttribute('position') as THREE.BufferAttribute;
    for (let i = 0; i < pos.count; i++) {
      const x = pos.getX(i);
      const y = pos.getY(i);
      const z = pos.getZ(i);
      const ny = Math.min(1, Math.max(0, (y + 1) * 0.5)); // 0 bottom tip -> 1 top rounded crown
      const teardrop = Math.sin(Math.pow(ny, 0.72) * Math.PI);
      pos.setXYZ(i, x * width * 0.5 * (0.45 + 0.65 * teardrop), y * height * 0.5, z * depth * 0.5 * (0.5 + 0.6 * teardrop));
    }
    geo.computeVertexNormals();
    return this.trackGeo(geo);
  }

  /**
   * Swept-back curved horn/claw/spine fin blade.
   */
  private createCurvedFinGeo(baseWidth: number, length: number, thickness: number, curveAmt: number): THREE.BufferGeometry {
    const geo = new THREE.ConeGeometry(baseWidth * 0.5, length, 8, 6);
    const pos = geo.getAttribute('position') as THREE.BufferAttribute;
    for (let i = 0; i < pos.count; i++) {
      const x = pos.getX(i);
      const y = pos.getY(i);
      const z = pos.getZ(i);
      const t = Math.min(1, Math.max(0, (y + length * 0.5) / length));
      const sweepZ = Math.pow(t, 1.75) * length * curveAmt;
      const bladeScaleZ = thickness / Math.max(1, baseWidth);
      pos.setXYZ(i, x * 0.75, y, z * bladeScaleZ * 1.15 - sweepZ);
    }
    geo.computeVertexNormals();
    return this.trackGeo(geo);
  }

  /**
   * Tapered diamond razor eye slit.
   */
  private createEyeSlitGeo(): THREE.BufferGeometry {
    const shape = new THREE.Shape();
    shape.moveTo(-7, 0);
    shape.lineTo(0, 2.6);
    shape.lineTo(7.5, 0.4);
    shape.lineTo(0, -1.8);
    shape.closePath();

    const geo = new THREE.ExtrudeGeometry(shape, {
      depth: 4,
      bevelEnabled: false
    });
    geo.translate(0, 0, -2);
    return this.trackGeo(geo);
  }

  private createTaperedOrganicGeo(
    bottomR: number,
    topR: number,
    height: number,
    radialSegs: number,
    heightSegs: number,
    scaleX: number,
    scaleZ: number,
    domeEnds: boolean = false
  ): THREE.BufferGeometry {
    const geo = new THREE.CylinderGeometry(topR, bottomR, height, radialSegs, heightSegs);
    const pos = geo.getAttribute('position') as THREE.BufferAttribute;
    for (let i = 0; i < pos.count; i++) {
      const x = pos.getX(i);
      const y = pos.getY(i);
      const z = pos.getZ(i);
      const ny = y / (height * 0.5);
      let bulge = 1.0 + 0.18 * (1.0 - ny * ny) + 0.05 * Math.sin(ny * Math.PI * 3.0);
      if (domeEnds && ny > 0.72) {
        const capT = Math.min(1, (ny - 0.72) / 0.28);
        bulge *= 1.0 - capT * 0.34;
      }
      pos.setXYZ(i, x * scaleX * bulge, y, z * scaleZ * bulge);
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
      // Sleek whip-like taper down to ~0.7px tip
      const taper = Math.pow(1.0 - t * 0.93, 1.38);
      const ripple = 1.0 + 0.06 * Math.sin(t * Math.PI * 14.0);
      const radius = (baseRadius * taper + 0.7) * ripple;

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
    posAttr.setXYZ(tipIdx, lastPt.x + T.x * 5.0, lastPt.y + T.y * 5.0, lastPt.z + T.z * 5.0);
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
    // 1. Deep Obsidian-Plum Muscle Flesh with subtle longitudinal muscle bundles (NO horizontal zebra stripes!)
    const fCanvas = document.createElement('canvas');
    fCanvas.width = 256;
    fCanvas.height = 256;
    const fCtx = fCanvas.getContext('2d')!;
    const fGrad = fCtx.createLinearGradient(0, 0, 0, 256);
    fGrad.addColorStop(0, '#3a1559');
    fGrad.addColorStop(0.5, '#240a3b');
    fGrad.addColorStop(1, '#130421');
    fCtx.fillStyle = fGrad;
    fCtx.fillRect(0, 0, 256, 256);

    // Subtle organic longitudinal muscle striations + mottled sinew shadows
    for (let x = 0; x < 256; x += 14) {
      fCtx.strokeStyle = x % 28 === 0 ? 'rgba(139, 92, 246, 0.14)' : 'rgba(8, 2, 18, 0.42)';
      fCtx.lineWidth = x % 28 === 0 ? 1.8 : 2.6;
      fCtx.beginPath();
      for (let y = 0; y <= 256; y += 16) {
        const wx = x + Math.sin(y * 0.05 + x * 0.15) * 4.2;
        if (y === 0) fCtx.moveTo(wx, y);
        else fCtx.lineTo(wx, y);
      }
      fCtx.stroke();
    }

    const fleshMap = new THREE.CanvasTexture(fCanvas);
    fleshMap.wrapS = fleshMap.wrapT = THREE.RepeatWrapping;
    fleshMap.colorSpace = THREE.SRGBColorSpace;

    // Deep subtle bio-vein glow map (very muted so core sternum/fissures/back-petals dominate!)
    const eCanvas = document.createElement('canvas');
    eCanvas.width = 256;
    eCanvas.height = 256;
    const eCtx = eCanvas.getContext('2d')!;
    eCtx.fillStyle = '#07010d';
    eCtx.fillRect(0, 0, 256, 256);
    eCtx.strokeStyle = 'rgba(168, 85, 247, 0.35)';
    eCtx.lineWidth = 1.6;
    for (let i = 0; i < 8; i++) {
      const sx = i * 32 + 12;
      eCtx.beginPath();
      for (let y = 0; y <= 256; y += 16) {
        const px = sx + Math.sin(y * 0.045 + i * 1.3) * 8;
        if (y === 0) eCtx.moveTo(px, y);
        else eCtx.lineTo(px, y);
      }
      eCtx.stroke();
    }
    const fleshEmissive = new THREE.CanvasTexture(eCanvas);
    fleshEmissive.wrapS = fleshEmissive.wrapT = THREE.RepeatWrapping;

    // 2. Painted Bone-Lavender Chitin Carapace with isotropic organic mottling (NO barcode bevel lines!)
    const cCanvas = document.createElement('canvas');
    cCanvas.width = 256;
    cCanvas.height = 256;
    const cCtx = cCanvas.getContext('2d')!;
    const cGrad = cCtx.createRadialGradient(128, 128, 12, 128, 128, 170);
    cGrad.addColorStop(0, '#edd9fa');
    cGrad.addColorStop(0.55, '#c49bd6');
    cGrad.addColorStop(1, '#7a4d91');
    cCtx.fillStyle = cGrad;
    cCtx.fillRect(0, 0, 256, 256);

    const bCanvas = document.createElement('canvas');
    bCanvas.width = 256;
    bCanvas.height = 256;
    const bCtx = bCanvas.getContext('2d')!;
    bCtx.fillStyle = '#808080';
    bCtx.fillRect(0, 0, 256, 256);

    // Isotropic organic chitin pores & mottled highlights
    for (let i = 0; i < 42; i++) {
      const cx = (i * 73 + 29) % 256;
      const cy = (i * 137 + 53) % 256;
      const rad = 12 + (i % 5) * 6;
      cCtx.fillStyle = i % 2 === 0 ? 'rgba(248, 232, 255, 0.16)' : 'rgba(65, 22, 88, 0.18)';
      cCtx.beginPath();
      cCtx.arc(cx, cy, rad, 0, Math.PI * 2);
      cCtx.fill();

      bCtx.fillStyle = i % 2 === 0 ? 'rgba(180, 180, 180, 0.28)' : 'rgba(72, 72, 72, 0.28)';
      bCtx.beginPath();
      bCtx.arc(cx, cy, rad * 0.85, 0, Math.PI * 2);
      bCtx.fill();
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
   * Updates skeletal posture, facing yaw, jaw aperture, 10 dorsal 3D tendrils, and status flashes.
   * Returns `true` on walk footstep contact frames so footsteps & camera trauma match strides.
   */
  public update(
    enemy: EnemyState,
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
    if (enemy.titanState === 'emerging' && enemy.bossEmergeOrigin && enemy.bossEmergeTarget) {
      aimDx = enemy.bossEmergeTarget.x - enemy.bossEmergeOrigin.x;
      aimDz = enemy.bossEmergeTarget.y - enemy.bossEmergeOrigin.y;
    } else if (enemy.titanState === 'laser_sweep' && enemy.titanLaserAngle !== undefined) {
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
    const pulse = 0.78 + 0.24 * Math.sin(nowSec * 3.4);
    if (flash > 0) {
      this.fleshMat.emissive.setHex(0xe879f9);
      this.fleshMat.emissiveIntensity = 0.22 + flash * 0.32;
      this.carapaceMat.emissive.setHex(0xa855f7);
      this.carapaceMat.emissiveIntensity = 0.14 + flash * 0.22;
    } else if (enemy.isChilled) {
      this.fleshMat.emissive.setHex(0x38bdf8);
      this.fleshMat.emissiveIntensity = 0.85;
      this.carapaceMat.emissive.setHex(0x0ea5e9);
      this.carapaceMat.emissiveIntensity = 0.35;
    } else if (enemy.isToxic) {
      this.fleshMat.emissive.setHex(0x84cc16);
      this.fleshMat.emissiveIntensity = 0.85;
      this.carapaceMat.emissive.setHex(0x365314);
      this.carapaceMat.emissiveIntensity = 0.3;
    } else if (enemy.isElectrified) {
      this.fleshMat.emissive.setHex(0xa855f7);
      this.fleshMat.emissiveIntensity = 1.05;
      this.carapaceMat.emissive.setHex(0x3b82f6);
      this.carapaceMat.emissiveIntensity = 0.35;
    } else {
      this.fleshMat.emissive.setHex(0xc026d3);
      this.fleshMat.emissiveIntensity = pulse * 0.26;
      this.carapaceMat.emissive.setHex(0x3b1256);
      this.carapaceMat.emissiveIntensity = 0.14;
    }

    this.breathPhase += dt * 2.4;
    const breath = Math.sin(this.breathPhase);
    const state = enemy.titanState || 'idle';

    // Default wide forward-hunched kaiju pose matching boss_walk_front / boss_walk_left
    let jawOpen = 0.08 + breath * 0.03;
    let neckLiftY = 74;
    let headPitch = 0.12;
    let chestPitch = 0.34 + breath * 0.03;
    let chestBobY = breath * 4.0;
    let tentacleSpreadFactor = 0.42;
    let tentacleWaveFreq = 2.8;
    let tentacleWaveAmp = 14.0;
    let throatScale = 0.72;

    if (state === 'emerging') {
      const emergeProg = Math.min(1.0, Math.max(0.0, 1.0 - (enemy.titanTimer ?? 3.6) / 3.6));
      const breachPulse = emergeProg >= 0.20 ? Math.sin(Math.min(1, (emergeProg - 0.20) / 0.68) * Math.PI) : 0;
      chestPitch = 0.56 * (1.0 - emergeProg) + 0.34;
      jawOpen = 0.14 + 0.52 * breachPulse;
      neckLiftY = 74 + 18 * breachPulse;
      headPitch = -0.32 * breachPulse;
      tentacleSpreadFactor = 0.48 + 0.55 * emergeProg;
      tentacleWaveAmp = 26;
      const emergeScale = emergeProg < 0.22 ? 0.56 + (emergeProg / 0.22) * 0.08 : 0.64 + ((emergeProg - 0.22) / 0.78) * 0.36;
      this.rootGroup.scale.setScalar(Math.min(1.0, emergeScale));
      this.leftShoulder.rotation.set(-0.55 * breachPulse, 0.24, -0.28 * breachPulse);
      this.rightShoulder.rotation.set(-0.55 * breachPulse, -0.24, 0.28 * breachPulse);
      this.lastStepHalfCycle = -1;
    } else if (state === 'dying') {
      const deathProg = 1.0 - Math.max(0, (enemy.titanTimer ?? 3.2) / 3.2);
      chestPitch = 0.34 + deathProg * 0.92;
      chestBobY = -deathProg * 90;
      jawOpen = 0.68 * (1 - deathProg * 0.6);
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

        chestBobY += Math.abs(stride) * 6.5;
        chestPitch = 0.36 + Math.abs(stride) * 0.05;
        this.chestPivot.rotation.z = stride * 0.055;
        this.chestPivot.rotation.y = stride * 0.065;

        // Heavy wide-splayed scythe-gauntlet stride
        this.leftShoulder.rotation.set(stride * 0.34 - liftL * 0.14, 0.14, -0.14);
        this.rightShoulder.rotation.set(-stride * 0.34 - liftR * 0.14, -0.14, 0.14);
        this.leftElbow.rotation.set(-0.24 - liftL * 0.22, 0, 0.08);
        this.rightElbow.rotation.set(-0.24 - liftR * 0.22, 0, -0.08);

        this.leftHip.rotation.set(-stride * 0.40 - liftL * 0.18, 0, 0);
        this.leftKnee.rotation.set(0.20 + liftL * 0.42, 0, 0);
        this.rightHip.rotation.set(stride * 0.40 - liftR * 0.18, 0, 0);
        this.rightKnee.rotation.set(0.20 + liftR * 0.42, 0, 0);
      } else if (state === 'leap') {
        this.lastStepHalfCycle = -1;
        const dur = Math.max(0.5, enemy.bossLeapDuration ?? 1.0);
        const prog = Math.min(1.0, Math.max(0, (enemy.bossLeapElapsed ?? 0) / dur));
        const airborneCurve = Math.sin(prog * Math.PI);
        chestPitch = 0.24 - airborneCurve * 0.42;
        neckLiftY = 82 + airborneCurve * 22;
        headPitch = -0.18 + prog * 0.35;
        jawOpen = 0.35 + airborneCurve * 0.45;
        throatScale = 1.15 + airborneCurve * 0.35;
        tentacleSpreadFactor = 0.72 + airborneCurve * 0.48;
        tentacleWaveFreq = 9.0;
        tentacleWaveAmp = 18;
        this.chestPivot.rotation.z = 0;
        this.chestPivot.rotation.y = 0;
        const armRaise = -0.75 * airborneCurve + 0.35 * prog;
        this.leftShoulder.rotation.set(armRaise, 0.25, 0.22);
        this.rightShoulder.rotation.set(armRaise, -0.25, -0.22);
        this.leftElbow.rotation.set(-0.45 * airborneCurve, 0, 0);
        this.rightElbow.rotation.set(-0.45 * airborneCurve, 0, 0);
        const legTuck = -0.55 * airborneCurve;
        this.leftHip.rotation.set(legTuck, 0, 0);
        this.rightHip.rotation.set(legTuck, 0, 0);
        this.leftKnee.rotation.set(0.65 * airborneCurve, 0, 0);
        this.rightKnee.rotation.set(0.65 * airborneCurve, 0, 0);
      } else if (state === 'laser_sweep') {
        this.lastStepHalfCycle = -1;
        // Cranes head & neck high, unhinges jaws wide, plants huge scythe gauntlets wide on the ground (boss_laser_front!)
        chestPitch = 0.10;
        neckLiftY = 98;
        headPitch = -0.34;
        jawOpen = 0.86 + Math.sin(nowSec * 18) * 0.06;
        throatScale = 1.65 + Math.sin(nowSec * 24) * 0.22;
        tentacleSpreadFactor = 0.78;
        tentacleWaveFreq = 6.5;
        tentacleWaveAmp = 18;
        this.chestPivot.rotation.z = 0;
        this.chestPivot.rotation.y = 0;
        this.leftShoulder.rotation.set(-0.18, -0.18, 0.26);
        this.rightShoulder.rotation.set(-0.18, 0.18, -0.26);
        this.leftElbow.rotation.set(-0.12, 0, -0.14);
        this.rightElbow.rotation.set(-0.12, 0, 0.14);
        this.resetLegsStance();
      } else if (state === 'tentacle_strike') {
        this.lastStepHalfCycle = -1;
        const isStrike = enemy.titanTentaclePhase === 'strike';
        chestPitch = isStrike ? 0.42 : 0.28;
        neckLiftY = isStrike ? 84 : 78;
        headPitch = isStrike ? 0.14 : -0.08;
        jawOpen = isStrike ? 0.56 : 0.30;
        throatScale = isStrike ? 1.25 : 0.92;
        tentacleSpreadFactor = isStrike ? 0.88 : 0.68;
        tentacleWaveFreq = 7.5;
        this.chestPivot.rotation.z = 0;
        this.chestPivot.rotation.y = 0;
        const armSwing = isStrike ? -0.42 : -0.18;
        this.leftShoulder.rotation.set(armSwing, 0.2, 0.18);
        this.rightShoulder.rotation.set(armSwing, -0.2, -0.18);
        this.leftElbow.rotation.set(-0.28, 0, 0);
        this.rightElbow.rotation.set(-0.28, 0, 0);
        this.resetLegsStance();
      } else if (state === 'elemental_barrage') {
        this.lastStepHalfCycle = -1;
        const chargeDur = STAGE1_BOSS_CONFIG.elemental.chargeDuration;
        const prog = Math.min(1.0, Math.max(0, (chargeDur - (enemy.titanTimer ?? 0)) / chargeDur));
        // Wide-planted roaring stance with all 10 tendrils fanned overhead (boss_elemental_front!)
        chestPitch = 0.22 - prog * 0.14;
        chestBobY += prog * 10;
        neckLiftY = 78 + prog * 14;
        headPitch = -0.18 - prog * 0.12;
        jawOpen = 0.26 + prog * 0.48;
        throatScale = 1.0 + prog * 0.55;
        tentacleSpreadFactor = 0.62 + prog * 0.56;
        tentacleWaveFreq = 4.6 + prog * 4.5;
        tentacleWaveAmp = 10 + prog * 12;
        this.chestPivot.rotation.z = 0;
        this.chestPivot.rotation.y = 0;
        this.leftShoulder.rotation.set(-0.14 - prog * 0.25, -0.12, 0.18 + prog * 0.24);
        this.rightShoulder.rotation.set(-0.14 - prog * 0.25, 0.12, -0.18 - prog * 0.24);
        this.leftElbow.rotation.set(-0.28, 0, 0);
        this.rightElbow.rotation.set(-0.28, 0, 0);
        this.resetLegsStance();
      } else {
        // Idle wide-planted hunched stance
        this.lastStepHalfCycle = -1;
        this.chestPivot.rotation.z = 0;
        this.chestPivot.rotation.y = Math.sin(this.breathPhase * 0.5) * 0.04;
        this.leftShoulder.rotation.set(breath * 0.05, 0, 0.08);
        this.rightShoulder.rotation.set(breath * 0.05, 0, -0.08);
        this.leftElbow.rotation.set(-0.16, 0, 0);
        this.rightElbow.rotation.set(-0.16, 0, 0);
        this.resetLegsStance();
      }
    }

    this.pelvis.position.y = 114 + chestBobY;
    this.chestPivot.rotation.x = chestPitch;
    this.neckPivot.position.y = neckLiftY;
    this.neckPivot.rotation.x = -chestPitch * 0.48 + headPitch * 0.35;
    this.headGroup.rotation.x = headPitch;
    this.lowerJawPivot.rotation.x = jawOpen;
    const activeThroatScale = jawOpen > 0.22 ? throatScale : 0.45;
    this.throatGlowMesh.scale.set(0.75 * activeThroatScale, 0.95 * activeThroatScale, 0.95 * activeThroatScale);
    this.coreGlowMat.emissiveIntensity = 1.18 + 0.35 * Math.sin(nowSec * 6.0);
    this.podGlowMat.emissiveIntensity = 1.12 + 0.30 * Math.sin(nowSec * 4.2 + 1.1);

    // Update world matrices once before computing tentacle spine curves & world sockets
    this.group.updateMatrixWorld(true);

    const segs = 18;
    for (let i = 0; i < 10; i++) {
      const t = this.dorsalTentacles[i];
      const root = this.scratchRoot.copy(t.rootLocal);

      const waveA = Math.sin(nowSec * tentacleWaveFreq + t.phase) * tentacleWaveAmp;
      const waveB = Math.cos(nowSec * (tentacleWaveFreq * 0.85) + t.phase * 1.4) * (tentacleWaveAmp * 0.7);

      const tip = this.scratchTip.set(
        t.tipSpreadX * (0.76 + 0.36 * tentacleSpreadFactor) + waveA,
        t.tipHeight + waveB * 0.65,
        t.tipFwdZ * (0.50 + 0.65 * tentacleSpreadFactor) + waveA * 0.35
      );
      const ctrl1 = this.scratchCtrl1.set(
        t.spreadX * 0.65,
        t.rootLocal.y + 64 + waveA * 0.3,
        t.spreadZ - 26
      );
      const ctrl2 = this.scratchCtrl2.set(
        t.spreadX * (0.88 + 0.25 * tentacleSpreadFactor) + waveB * 0.65,
        (t.rootLocal.y + t.tipHeight) * 0.62 + 44,
        t.spreadZ + 16 + waveA * 0.4
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
        // Sinuous whip-tendril undulation
        const midEnv = Math.sin(u * Math.PI);
        pt.x += Math.sin(nowSec * 4.5 - u * 4.4 + t.phase) * 10.5 * midEnv;
        pt.z += Math.cos(nowSec * 3.8 - u * 4.0 + t.phase) * 7.5 * midEnv;
      }

      this.updateTubeGeometry(t.geo, t.spinePoints, t.baseRadius, 8);

      const lastPt = t.spinePoints[segs];
      const prevPt = t.spinePoints[segs - 1];
      t.stinger.position.copy(lastPt);
      this.scratchDir.subVectors(lastPt, prevPt).normalize();
      if (this.scratchDir.lengthSq() > 0.0001) {
        t.stinger.quaternion.setFromUnitVectors(this.scratchForward, this.scratchDir);
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
    this.leftHip.rotation.set(-0.08, 0.14, 0.06);
    this.leftKnee.rotation.set(0.18, 0, 0);
    this.rightHip.rotation.set(-0.08, -0.14, -0.06);
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

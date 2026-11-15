import * as THREE from 'three';
import { PlayerState, InputSnapshot, Vector2 } from '../sim/types';

/**
 * Procedural 3D Character Rig & Skeletal Hierarchy for the Commander
 * Faithfully reconstructed from the 4-way reference sheets (front, back, left, right).
 * 
 * Features:
 * - Chibi / heroic anime proportions (~52 units tall, matching the 48x56 sprite scale)
 * - Articulated joints: Pelvis, Torso, Neck, Head, Hair locs bundle, Shoulders, Elbows, Hands, Hips, Knees, Feet, Coat Skirt Panels
 * - Authentic costume details: High-collared white military trench coat with gold trim, large golden eagle back insignia,
 *   golden eagle chest badge, curved pauldrons with gold rims, dark armored undersuit with gold stripes, hexagonal knee pads,
 *   chunky sci-fi boots with gold soles, gold utility belt with buckle, gold hoop earrings, and dreadlocks ponytail with gold cuffs.
 * - Procedural animations: Idle breathing/sway, Running stride & arm swing with torso bobbing, Combat aiming & recoil,
 *   Combat Dash forward lean & 3D trail, Taking Damage flinch, Death collapse.
 * - 3D Skill VFX: Rally Command holographic golden eagle crest, Defensive Protocol hexagonal forcefield dome,
 *   Combat Dash gold-violet energy trails.
 */
export class Commander3DModel {
  public group: THREE.Group;

  // Hierarchical Skeletal Joints
  public rootGroup: THREE.Group;
  public pelvis: THREE.Group;
  public torso: THREE.Group;
  public neck: THREE.Group;
  public headGroup: THREE.Group;
  public hairGroup: THREE.Group;
  public ponytailJoint: THREE.Group;
  public frontLockL: THREE.Group;
  public frontLockR: THREE.Group;

  public leftShoulder: THREE.Group;
  public leftElbow: THREE.Group;
  public leftHand: THREE.Group;
  public leftPauldron: THREE.Group;

  public rightShoulder: THREE.Group;
  public rightElbow: THREE.Group;
  public rightHand: THREE.Group;
  public rightPauldron: THREE.Group;

  public leftHip: THREE.Group;
  public leftKnee: THREE.Group;
  public leftAnkle: THREE.Group;

  public rightHip: THREE.Group;
  public rightKnee: THREE.Group;
  public rightAnkle: THREE.Group;

  // Coat Skirt Panels (Flowing trench coat tails)
  public coatBackLeft: THREE.Group;
  public coatBackRight: THREE.Group;
  public coatSideLeft: THREE.Group;
  public coatSideRight: THREE.Group;

  // 3D Skill VFX Elements
  public shieldDome: THREE.Mesh;
  public shieldInnerGlow: THREE.Mesh;
  public rallyHoloEagle: THREE.Sprite;
  public rallyRing: THREE.Mesh;
  private rallyVFXTimer: number = 0;
  private dashTrailMeshes: { mesh: THREE.Mesh; lifetime: number }[] = [];

  // Animation State Machine Variables
  private currentYaw: number = 0;
  private targetYaw: number = 0;
  private walkPhase: number = 0;
  private breathPhase: number = 0;
  private attackTimer: number = 0;
  private hitRecoilTimer: number = 0;
  private deathProgress: number = 0;
  private prevHealth: number = 100;
  private isAttacking: boolean = false;

  // Materials Registry for cleanup & hit flashes
  private materials: THREE.Material[] = [];
  private baseColors: Map<THREE.MeshStandardMaterial, number> = new Map();

  constructor() {
    this.group = new THREE.Group();
    this.rootGroup = new THREE.Group();
    this.group.add(this.rootGroup);

    // Load textures
    const texLoader = new THREE.TextureLoader();
    const faceTex = texLoader.load('/assets/commander/commander_3d_face.png');
    faceTex.colorSpace = THREE.SRGBColorSpace;
    const eagleTex = texLoader.load('/assets/commander/commander_3d_eagle.png');
    eagleTex.colorSpace = THREE.SRGBColorSpace;

    const coatTex = texLoader.load('/assets/commander/coat_fabric.png');
    coatTex.wrapS = THREE.RepeatWrapping;
    coatTex.wrapT = THREE.RepeatWrapping;
    coatTex.repeat.set(3, 3);
    coatTex.colorSpace = THREE.SRGBColorSpace;

    const suitTex = texLoader.load('/assets/commander/suit_carbon.png');
    suitTex.wrapS = THREE.RepeatWrapping;
    suitTex.wrapT = THREE.RepeatWrapping;
    suitTex.repeat.set(4, 4);
    suitTex.colorSpace = THREE.SRGBColorSpace;

    const goldTex = texLoader.load('/assets/commander/brushed_gold.png');
    goldTex.wrapS = THREE.RepeatWrapping;
    goldTex.wrapT = THREE.RepeatWrapping;
    goldTex.repeat.set(2, 2);
    goldTex.colorSpace = THREE.SRGBColorSpace;

    // 1. Shared High-Grade Stylized Materials (Textured Graphics)
    const whiteCoatMat = new THREE.MeshStandardMaterial({
      map: coatTex,
      color: 0xffffff,
      roughness: 0.45,
      metalness: 0.15,
      bumpMap: coatTex,
      bumpScale: 0.4,
      shadowSide: THREE.DoubleSide
    });
    this.registerMat(whiteCoatMat);

    const goldMat = new THREE.MeshStandardMaterial({
      map: goldTex,
      color: 0xffffff,
      roughness: 0.28,
      metalness: 0.85,
      bumpMap: goldTex,
      bumpScale: 0.6
    });
    this.registerMat(goldMat);

    const darkSuitMat = new THREE.MeshStandardMaterial({
      map: suitTex,
      color: 0xffffff,
      roughness: 0.62,
      metalness: 0.25,
      bumpMap: suitTex,
      bumpScale: 0.5
    });
    this.registerMat(darkSuitMat);

    const skinMat = new THREE.MeshStandardMaterial({
      color: 0x8c5539, // Warm golden dark skin tone
      roughness: 0.78,
      metalness: 0.04
    });
    this.registerMat(skinMat);

    const hairMat = new THREE.MeshStandardMaterial({
      color: 0x2e1e17, // Dark locs brown
      roughness: 0.88,
      metalness: 0.05
    });
    this.registerMat(hairMat);

    const bootGrayMat = new THREE.MeshStandardMaterial({
      map: suitTex,
      color: 0x64748b,
      roughness: 0.48,
      metalness: 0.4,
      bumpMap: suitTex,
      bumpScale: 0.6
    });
    this.registerMat(bootGrayMat);

    // 2. Build Skeletal Hierarchy
    // Pelvis (Hips base: Y = 21)
    this.pelvis = new THREE.Group();
    this.pelvis.position.set(0, 21, 0);
    this.rootGroup.add(this.pelvis);

    // Pelvis / Hips geometry (dark undersuit)
    const pelvisGeo = new THREE.CylinderGeometry(5.2, 4.6, 4.2, 16);
    const pelvisMesh = new THREE.Mesh(pelvisGeo, darkSuitMat);
    pelvisMesh.position.set(0, 0, 0);
    this.pelvis.add(pelvisMesh);

    // Gold Belt & Sci-Fi Rectangular Buckle
    const beltGeo = new THREE.CylinderGeometry(5.4, 5.4, 1.4, 16);
    const beltMesh = new THREE.Mesh(beltGeo, goldMat);
    beltMesh.position.set(0, 1.4, 0);
    this.pelvis.add(beltMesh);

    const buckleGeo = new THREE.BoxGeometry(2.8, 1.8, 0.9);
    const buckleMesh = new THREE.Mesh(buckleGeo, goldMat);
    buckleMesh.position.set(0, 1.4, 5.3);
    this.pelvis.add(buckleMesh);

    // 3. Coat Skirt Panels (Hanging from waist down to calves Y ~5)
    const skirtGeo = new THREE.PlaneGeometry(5.6, 14.5);
    const skirtTrimMat = new THREE.MeshStandardMaterial({
      color: 0xf8fafc,
      roughness: 0.5,
      metalness: 0.1,
      side: THREE.DoubleSide
    });
    this.registerMat(skirtTrimMat);

    // Split back tails with gold trim & dark hem
    this.coatBackLeft = new THREE.Group();
    this.coatBackLeft.position.set(-2.6, 0.8, -4.6);
    this.pelvis.add(this.coatBackLeft);
    const backLMesh = new THREE.Mesh(skirtGeo, skirtTrimMat);
    backLMesh.position.set(0, -7.2, 0);
    backLMesh.rotation.y = Math.PI;
    this.coatBackLeft.add(backLMesh);
    this.addCoatGoldBorders(this.coatBackLeft, 5.6, 14.5, goldMat, darkSuitMat);

    this.coatBackRight = new THREE.Group();
    this.coatBackRight.position.set(2.6, 0.8, -4.6);
    this.pelvis.add(this.coatBackRight);
    const backRMesh = new THREE.Mesh(skirtGeo, skirtTrimMat);
    backRMesh.position.set(0, -7.2, 0);
    backRMesh.rotation.y = Math.PI;
    this.coatBackRight.add(backRMesh);
    this.addCoatGoldBorders(this.coatBackRight, 5.6, 14.5, goldMat, darkSuitMat);

    // Flared side panels
    this.coatSideLeft = new THREE.Group();
    this.coatSideLeft.position.set(-5.0, 0.8, 0);
    this.coatSideLeft.rotation.y = -Math.PI / 2;
    this.coatSideLeft.rotation.z = -0.12;
    this.pelvis.add(this.coatSideLeft);
    const sideLMesh = new THREE.Mesh(skirtGeo, skirtTrimMat);
    sideLMesh.position.set(0, -7.2, 0);
    this.coatSideLeft.add(sideLMesh);
    this.addCoatGoldBorders(this.coatSideLeft, 5.6, 14.5, goldMat, darkSuitMat);

    this.coatSideRight = new THREE.Group();
    this.coatSideRight.position.set(5.0, 0.8, 0);
    this.coatSideRight.rotation.y = Math.PI / 2;
    this.coatSideRight.rotation.z = 0.12;
    this.pelvis.add(this.coatSideRight);
    const sideRMesh = new THREE.Mesh(skirtGeo, skirtTrimMat);
    sideRMesh.position.set(0, -7.2, 0);
    this.coatSideRight.add(sideRMesh);
    this.addCoatGoldBorders(this.coatSideRight, 5.6, 14.5, goldMat, darkSuitMat);

    // 4. Torso & Chest Armor (Y = +3 from Pelvis)
    this.torso = new THREE.Group();
    this.torso.position.set(0, 2.5, 0);
    this.pelvis.add(this.torso);

    // Dark armored undersuit torso
    const torsoGeo = new THREE.CylinderGeometry(5.0, 4.4, 9.5, 16);
    const torsoMesh = new THREE.Mesh(torsoGeo, darkSuitMat);
    torsoMesh.position.set(0, 4.8, 0);
    this.torso.add(torsoMesh);

    // White Military Cuirass & Chest Plate
    const chestPlateGeo = new THREE.CylinderGeometry(5.4, 4.8, 6.2, 16, 1, false, -Math.PI * 0.45, Math.PI * 0.9);
    const chestPlate = new THREE.Mesh(chestPlateGeo, whiteCoatMat);
    chestPlate.position.set(0, 6.4, 0);
    this.torso.add(chestPlate);

    // White Military Coat Back
    const coatBackPlateGeo = new THREE.CylinderGeometry(5.4, 4.8, 8.5, 16, 1, false, Math.PI * 0.55, Math.PI * 0.9);
    const coatBackPlate = new THREE.Mesh(coatBackPlateGeo, whiteCoatMat);
    coatBackPlate.position.set(0, 5.3, 0);
    this.torso.add(coatBackPlate);

    // Large Golden Eagle Insignia on Back of Coat
    const backEagleMat = new THREE.MeshBasicMaterial({
      map: eagleTex,
      transparent: true,
      side: THREE.DoubleSide,
      depthWrite: false
    });
    this.registerMat(backEagleMat);
    const backEagleGeo = new THREE.PlaneGeometry(6.8, 5.2);
    const backEagleMesh = new THREE.Mesh(backEagleGeo, backEagleMat);
    backEagleMesh.position.set(0, 6.4, -5.48);
    backEagleMesh.rotation.y = Math.PI;
    this.torso.add(backEagleMesh);

    // Left Chest Golden Eagle Emblem
    const chestEagleGeo = new THREE.PlaneGeometry(2.4, 1.8);
    const chestEagleMesh = new THREE.Mesh(chestEagleGeo, backEagleMat);
    chestEagleMesh.position.set(-2.0, 7.2, 5.46);
    this.torso.add(chestEagleMesh);

    // High Popped Military Collar (Flared behind neck with gold trim)
    const collarGeo = new THREE.CylinderGeometry(4.2, 3.8, 3.2, 16, 1, true, Math.PI * 0.35, Math.PI * 1.3);
    const collarMat = new THREE.MeshStandardMaterial({
      color: 0xf8fafc,
      roughness: 0.4,
      metalness: 0.1,
      side: THREE.DoubleSide
    });
    this.registerMat(collarMat);
    const collarMesh = new THREE.Mesh(collarGeo, collarMat);
    collarMesh.position.set(0, 10.4, -0.6);
    collarMesh.rotation.x = -0.15;
    this.torso.add(collarMesh);

    const collarRimGeo = new THREE.TorusGeometry(4.2, 0.35, 8, 16, Math.PI * 1.3);
    const collarRim = new THREE.Mesh(collarRimGeo, goldMat);
    collarRim.position.set(0, 11.8, -0.6);
    collarRim.rotation.x = Math.PI / 2 - 0.15;
    collarRim.rotation.z = Math.PI * 0.35;
    this.torso.add(collarRim);

    // 5. Neck & Head (Neck at Y = 9.8 from Torso)
    this.neck = new THREE.Group();
    this.neck.position.set(0, 9.8, 0);
    this.torso.add(this.neck);

    const neckGeo = new THREE.CylinderGeometry(2.4, 2.7, 2.4, 12);
    const neckMesh = new THREE.Mesh(neckGeo, skinMat);
    neckMesh.position.set(0, 1.2, 0);
    this.neck.add(neckMesh);

    this.headGroup = new THREE.Group();
    this.headGroup.position.set(0, 2.8, 0.4);
    this.neck.add(this.headGroup);

    // Stylized Anime Head Sphere (Radius 6.8, slightly elongated)
    const headGeo = new THREE.SphereGeometry(6.6, 24, 20);
    headGeo.scale(1.0, 1.06, 1.0);
    const headMesh = new THREE.Mesh(headGeo, skinMat);
    headMesh.position.set(0, 5.2, 0);
    this.headGroup.add(headMesh);

    // Expressive Anime Face Decal (Amber eyes, eyebrows, nose, mouth, razor stripes)
    const faceMat = new THREE.MeshBasicMaterial({
      map: faceTex,
      transparent: true,
      side: THREE.DoubleSide,
      depthWrite: false
    });
    this.registerMat(faceMat);
    const faceDecalGeo = new THREE.PlaneGeometry(10.8, 10.8);
    const faceDecal = new THREE.Mesh(faceDecalGeo, faceMat);
    faceDecal.position.set(0, 5.2, 6.45);
    this.headGroup.add(faceDecal);

    // Gold Hoop Earrings
    const earringGeo = new THREE.TorusGeometry(1.0, 0.22, 10, 16);
    const earringL = new THREE.Mesh(earringGeo, goldMat);
    earringL.position.set(-6.6, 4.4, 0.5);
    earringL.rotation.y = Math.PI / 2;
    this.headGroup.add(earringL);

    const earringR = new THREE.Mesh(earringGeo, goldMat);
    earringR.position.set(6.6, 4.4, 0.5);
    earringR.rotation.y = Math.PI / 2;
    this.headGroup.add(earringR);

    // 6. Braided Dreadlocks Hairstyle & Ponytail
    this.hairGroup = new THREE.Group();
    this.headGroup.add(this.hairGroup);

    // Scalp cap (Back & sides dread hair mass)
    const scalpCapGeo = new THREE.SphereGeometry(6.9, 18, 14, 0, Math.PI * 2, 0, Math.PI * 0.65);
    scalpCapGeo.scale(1.02, 1.05, 1.04);
    const scalpCap = new THREE.Mesh(scalpCapGeo, hairMat);
    scalpCap.position.set(0, 5.3, -0.4);
    scalpCap.rotation.x = -0.4;
    this.hairGroup.add(scalpCap);

    // Front Braid Locs Framing Face
    this.frontLockL = this.createBraidedLock(1.1, 8.5, hairMat, goldMat);
    this.frontLockL.position.set(-5.2, 5.0, 4.8);
    this.frontLockL.rotation.z = 0.25;
    this.frontLockL.rotation.x = 0.15;
    this.hairGroup.add(this.frontLockL);

    this.frontLockR = this.createBraidedLock(1.1, 7.5, hairMat, goldMat);
    this.frontLockR.position.set(4.8, 5.4, 4.8);
    this.frontLockR.rotation.z = -0.22;
    this.hairGroup.add(this.frontLockR);

    // High Side/Back Ponytail Joint
    this.ponytailJoint = new THREE.Group();
    this.ponytailJoint.position.set(2.8, 10.4, -4.2);
    this.headGroup.add(this.ponytailJoint);

    // Thick Gold Hair Cuff Ring binding the ponytail
    const baseCuffGeo = new THREE.CylinderGeometry(2.4, 2.2, 2.2, 16);
    const baseCuff = new THREE.Mesh(baseCuffGeo, goldMat);
    baseCuff.rotation.x = 0.5;
    this.ponytailJoint.add(baseCuff);

    // Ponytail Dread Bundle (7 thick cascading curved braids with gold cuffs)
    const braidOffsets = [
      { x: -0.8, y: -0.8, z: -1.2, len: 14, rotZ: -0.15, rotX: -0.35 },
      { x: 0.8, y: -0.6, z: -1.4, len: 15, rotZ: 0.18, rotX: -0.4 },
      { x: -1.6, y: -1.4, z: -0.5, len: 12, rotZ: -0.35, rotX: -0.2 },
      { x: 1.6, y: -1.2, z: -0.6, len: 13, rotZ: 0.35, rotX: -0.25 },
      { x: 0.0, y: -2.0, z: -1.6, len: 16, rotZ: 0.05, rotX: -0.5 },
      { x: -1.2, y: -2.2, z: -1.0, len: 13, rotZ: -0.2, rotX: -0.4 },
      { x: 1.2, y: -2.0, z: -1.0, len: 14, rotZ: 0.2, rotX: -0.42 }
    ];

    braidOffsets.forEach(cfg => {
      const lock = this.createBraidedLock(1.15, cfg.len, hairMat, goldMat);
      lock.position.set(cfg.x, cfg.y, cfg.z);
      lock.rotation.z = cfg.rotZ;
      lock.rotation.x = cfg.rotX;
      this.ponytailJoint.add(lock);
    });

    // 7. Shoulders & Arms (Left & Right)
    // Left Arm (X: -6.6, Y: 8.5)
    this.leftShoulder = new THREE.Group();
    this.leftShoulder.position.set(-6.4, 8.2, 0);
    this.torso.add(this.leftShoulder);

    this.leftPauldron = this.createPauldron(whiteCoatMat, goldMat, eagleTex, false);
    this.leftShoulder.add(this.leftPauldron);

    const upperArmGeo = new THREE.CylinderGeometry(1.9, 1.8, 6.0, 12);
    const upperArmL = new THREE.Mesh(upperArmGeo, darkSuitMat);
    upperArmL.position.set(0, -3.0, 0);
    this.leftShoulder.add(upperArmL);

    this.leftElbow = new THREE.Group();
    this.leftElbow.position.set(0, -6.0, 0);
    this.leftShoulder.add(this.leftElbow);

    const forearmGeo = new THREE.CylinderGeometry(2.1, 1.9, 5.5, 12);
    const forearmL = new THREE.Mesh(forearmGeo, whiteCoatMat);
    forearmL.position.set(0, -2.75, 0);
    this.leftElbow.add(forearmL);

    const wristCuffGeo = new THREE.CylinderGeometry(2.3, 2.3, 1.0, 12);
    const wristCuffL = new THREE.Mesh(wristCuffGeo, goldMat);
    wristCuffL.position.set(0, -4.8, 0);
    this.leftElbow.add(wristCuffL);

    this.leftHand = new THREE.Group();
    this.leftHand.position.set(0, -5.6, 0);
    this.leftElbow.add(this.leftHand);
    const handGeo = new THREE.BoxGeometry(2.4, 2.6, 1.8);
    const handL = new THREE.Mesh(handGeo, darkSuitMat);
    handL.position.set(0, -1.3, 0);
    this.leftHand.add(handL);

    // Right Arm (X: +6.4, Y: 8.2)
    this.rightShoulder = new THREE.Group();
    this.rightShoulder.position.set(6.4, 8.2, 0);
    this.torso.add(this.rightShoulder);

    this.rightPauldron = this.createPauldron(whiteCoatMat, goldMat, eagleTex, true);
    this.rightShoulder.add(this.rightPauldron);

    const upperArmR = new THREE.Mesh(upperArmGeo, darkSuitMat);
    upperArmR.position.set(0, -3.0, 0);
    this.rightShoulder.add(upperArmR);

    this.rightElbow = new THREE.Group();
    this.rightElbow.position.set(0, -6.0, 0);
    this.rightShoulder.add(this.rightElbow);

    const forearmR = new THREE.Mesh(forearmGeo, whiteCoatMat);
    forearmR.position.set(0, -2.75, 0);
    this.rightElbow.add(forearmR);

    const wristCuffR = new THREE.Mesh(wristCuffGeo, goldMat);
    wristCuffR.position.set(0, -4.8, 0);
    this.rightElbow.add(wristCuffR);

    this.rightHand = new THREE.Group();
    this.rightHand.position.set(0, -5.6, 0);
    this.rightElbow.add(this.rightHand);
    const handR = new THREE.Mesh(handGeo, darkSuitMat);
    handR.position.set(0, -1.3, 0);
    this.rightHand.add(handR);

    // 8. Hips & Legs (Left & Right)
    // Left Leg (X: -3.4, Y: -1.0 from Pelvis)
    this.leftHip = new THREE.Group();
    this.leftHip.position.set(-3.2, -1.0, 0);
    this.pelvis.add(this.leftHip);

    const thighGeo = new THREE.CylinderGeometry(2.4, 2.1, 7.8, 14);
    const thighL = new THREE.Mesh(thighGeo, darkSuitMat);
    thighL.position.set(0, -3.9, 0);
    this.leftHip.add(thighL);

    // Outer gold leg stripe
    const legStripeGeo = new THREE.BoxGeometry(0.35, 7.4, 1.2);
    const legStripeL = new THREE.Mesh(legStripeGeo, goldMat);
    legStripeL.position.set(-2.3, -3.9, 0);
    this.leftHip.add(legStripeL);

    this.leftKnee = new THREE.Group();
    this.leftKnee.position.set(0, -7.8, 0);
    this.leftHip.add(this.leftKnee);

    // Hexagonal Knee Guard
    const kneePad = this.createHexKneePad(goldMat, bootGrayMat);
    kneePad.position.set(0, 0, 2.3);
    this.leftKnee.add(kneePad);

    const shinGeo = new THREE.CylinderGeometry(2.3, 2.6, 7.2, 14);
    const shinL = new THREE.Mesh(shinGeo, whiteCoatMat);
    shinL.position.set(0, -3.6, 0);
    this.leftKnee.add(shinL);

    this.leftAnkle = new THREE.Group();
    this.leftAnkle.position.set(0, -7.2, 0);
    this.leftKnee.add(this.leftAnkle);

    const bootL = this.createFuturisticBoot(whiteCoatMat, goldMat, bootGrayMat);
    this.leftAnkle.add(bootL);

    // Right Leg (X: +3.2, Y: -1.0 from Pelvis)
    this.rightHip = new THREE.Group();
    this.rightHip.position.set(3.2, -1.0, 0);
    this.pelvis.add(this.rightHip);

    const thighR = new THREE.Mesh(thighGeo, darkSuitMat);
    thighR.position.set(0, -3.9, 0);
    this.rightHip.add(thighR);

    const legStripeR = new THREE.Mesh(legStripeGeo, goldMat);
    legStripeR.position.set(2.3, -3.9, 0);
    this.rightHip.add(legStripeR);

    this.rightKnee = new THREE.Group();
    this.rightKnee.position.set(0, -7.8, 0);
    this.rightHip.add(this.rightKnee);

    const kneePadR = this.createHexKneePad(goldMat, bootGrayMat);
    kneePadR.position.set(0, 0, 2.3);
    this.rightKnee.add(kneePadR);

    const shinR = new THREE.Mesh(shinGeo, whiteCoatMat);
    shinR.position.set(0, -3.6, 0);
    this.rightKnee.add(shinR);

    this.rightAnkle = new THREE.Group();
    this.rightAnkle.position.set(0, -7.2, 0);
    this.rightKnee.add(this.rightAnkle);

    const bootR = this.createFuturisticBoot(whiteCoatMat, goldMat, bootGrayMat);
    this.rightAnkle.add(bootR);

    // 9. 3D Skill Visual Effects
    // A. Defensive Protocol 3D Hexagonal Forcefield Dome
    const domeGeo = new THREE.IcosahedronGeometry(22, 2);
    const domeMat = new THREE.MeshBasicMaterial({
      color: 0xfacc15,
      wireframe: true,
      transparent: true,
      opacity: 0.0,
      depthWrite: false
    });
    this.registerMat(domeMat);
    this.shieldDome = new THREE.Mesh(domeGeo, domeMat);
    this.shieldDome.position.set(0, 24, 0);
    this.rootGroup.add(this.shieldDome);

    const innerDomeGeo = new THREE.SphereGeometry(21.4, 24, 18);
    const innerDomeMat = new THREE.MeshBasicMaterial({
      color: 0xc084fc, // Bio-kinetic violet glow
      transparent: true,
      opacity: 0.0,
      side: THREE.BackSide,
      depthWrite: false
    });
    this.registerMat(innerDomeMat);
    this.shieldInnerGlow = new THREE.Mesh(innerDomeGeo, innerDomeMat);
    this.shieldInnerGlow.position.set(0, 24, 0);
    this.rootGroup.add(this.shieldInnerGlow);

    // B. Rally Command Holographic Eagle Crest
    const holoEagleMat = new THREE.SpriteMaterial({
      map: eagleTex,
      color: 0xfde047,
      transparent: true,
      opacity: 0.0,
      depthWrite: false
    });
    this.registerMat(holoEagleMat);
    this.rallyHoloEagle = new THREE.Sprite(holoEagleMat);
    this.rallyHoloEagle.scale.set(22, 17, 1);
    this.rallyHoloEagle.position.set(0, 56, 0);
    this.rootGroup.add(this.rallyHoloEagle);

    const ringGeo = new THREE.RingGeometry(8, 10.5, 32);
    const ringMat = new THREE.MeshBasicMaterial({
      color: 0xfacc15,
      transparent: true,
      opacity: 0.0,
      side: THREE.DoubleSide
    });
    this.registerMat(ringMat);
    this.rallyRing = new THREE.Mesh(ringGeo, ringMat);
    this.rallyRing.rotation.x = -Math.PI / 2;
    this.rallyRing.position.set(0, 0.4, 0);
    this.rootGroup.add(this.rallyRing);
  }

  private registerMat(mat: THREE.Material): void {
    this.materials.push(mat);
    if ((mat as THREE.MeshStandardMaterial).color) {
      this.baseColors.set(mat as THREE.MeshStandardMaterial, (mat as THREE.MeshStandardMaterial).color.getHex());
    }
  }

  private createPauldron(coatMat: THREE.Material, goldMat: THREE.Material, eagleTex: THREE.Texture, isRight: boolean): THREE.Group {
    const grp = new THREE.Group();
    // Curved pauldron shell
    const shellGeo = new THREE.SphereGeometry(3.6, 16, 12, 0, Math.PI * 2, 0, Math.PI * 0.55);
    shellGeo.scale(1.2, 0.9, 1.3);
    const shell = new THREE.Mesh(shellGeo, coatMat);
    shell.position.set(isRight ? 0.6 : -0.6, 1.2, 0);
    shell.rotation.z = isRight ? -0.4 : 0.4;
    grp.add(shell);

    // Gold trim rim
    const rimGeo = new THREE.TorusGeometry(3.8, 0.4, 8, 20);
    const rim = new THREE.Mesh(rimGeo, goldMat);
    rim.position.set(isRight ? 0.6 : -0.6, 1.2, 0);
    rim.rotation.x = Math.PI / 2;
    rim.rotation.y = isRight ? 0.4 : -0.4;
    grp.add(rim);

    // Eagle decal on pauldron
    const badgeMat = new THREE.MeshBasicMaterial({
      map: eagleTex,
      transparent: true,
      depthWrite: false
    });
    this.registerMat(badgeMat);
    const badgeGeo = new THREE.PlaneGeometry(3.0, 2.2);
    const badge = new THREE.Mesh(badgeGeo, badgeMat);
    badge.position.set(isRight ? 3.6 : -3.6, 2.2, 0);
    badge.rotation.y = isRight ? Math.PI / 2 : -Math.PI / 2;
    grp.add(badge);

    return grp;
  }

  private createFuturisticBoot(whiteMat: THREE.Material, goldMat: THREE.Material, grayMat: THREE.Material): THREE.Group {
    const grp = new THREE.Group();
    // Chunky white armor boot shell
    const bootUpperGeo = new THREE.BoxGeometry(4.8, 4.4, 6.8);
    const bootUpper = new THREE.Mesh(bootUpperGeo, whiteMat);
    bootUpper.position.set(0, 2.2, 0.8);
    grp.add(bootUpper);

    // Heavy gold tread sole
    const soleGeo = new THREE.BoxGeometry(5.2, 1.4, 7.4);
    const sole = new THREE.Mesh(soleGeo, goldMat);
    sole.position.set(0, 0.7, 0.8);
    grp.add(sole);

    // Gold ankle strap
    const strapGeo = new THREE.CylinderGeometry(2.8, 2.8, 1.0, 14);
    const strap = new THREE.Mesh(strapGeo, goldMat);
    strap.position.set(0, 4.0, 0.2);
    grp.add(strap);

    // Charcoal toe cap accent
    const toeGeo = new THREE.BoxGeometry(4.2, 2.0, 2.2);
    const toe = new THREE.Mesh(toeGeo, grayMat);
    toe.position.set(0, 1.8, 3.4);
    grp.add(toe);

    return grp;
  }

  private createHexKneePad(goldMat: THREE.Material, grayMat: THREE.Material): THREE.Group {
    const grp = new THREE.Group();
    const hexOuterGeo = new THREE.CylinderGeometry(2.2, 2.2, 0.6, 6);
    const hexOuter = new THREE.Mesh(hexOuterGeo, goldMat);
    hexOuter.rotation.x = Math.PI / 2;
    grp.add(hexOuter);

    const hexInnerGeo = new THREE.CylinderGeometry(1.6, 1.6, 0.7, 6);
    const hexInner = new THREE.Mesh(hexInnerGeo, grayMat);
    hexInner.rotation.x = Math.PI / 2;
    grp.add(hexInner);

    return grp;
  }

  private createBraidedLock(radius: number, length: number, hairMat: THREE.Material, goldMat: THREE.Material): THREE.Group {
    const grp = new THREE.Group();
    // Capsule/cylinder braid strand
    const strandGeo = new THREE.CylinderGeometry(radius * 0.9, radius * 0.7, length, 8);
    const strand = new THREE.Mesh(strandGeo, hairMat);
    strand.position.set(0, -length / 2, 0);
    grp.add(strand);

    // Gold hair cuff band at midpoint
    const bandGeo = new THREE.CylinderGeometry(radius * 1.25, radius * 1.25, 1.2, 10);
    const band1 = new THREE.Mesh(bandGeo, goldMat);
    band1.position.set(0, -length * 0.45, 0);
    grp.add(band1);

    // Optional second gold band near tip
    if (length > 10) {
      const band2 = new THREE.Mesh(bandGeo, goldMat);
      band2.position.set(0, -length * 0.85, 0);
      grp.add(band2);
    }

    return grp;
  }

  private addCoatGoldBorders(panelGroup: THREE.Group, w: number, h: number, goldMat: THREE.Material, darkMat: THREE.Material): void {
    // Left & right gold borders
    const borderGeo = new THREE.BoxGeometry(0.45, h, 0.25);
    const borderL = new THREE.Mesh(borderGeo, goldMat);
    borderL.position.set(-w / 2 + 0.22, -h / 2, 0);
    panelGroup.add(borderL);

    const borderR = new THREE.Mesh(borderGeo, goldMat);
    borderR.position.set(w / 2 - 0.22, -h / 2, 0);
    panelGroup.add(borderR);

    // Bottom gold hem
    const hemGeo = new THREE.BoxGeometry(w, 1.2, 0.25);
    const hem = new THREE.Mesh(hemGeo, goldMat);
    hem.position.set(0, -h + 0.6, 0);
    panelGroup.add(hem);

    // Dark chevron accent above hem
    const chevGeo = new THREE.BoxGeometry(w * 0.65, 1.4, 0.26);
    const chev = new THREE.Mesh(chevGeo, darkMat);
    chev.position.set(0, -h + 2.0, 0);
    panelGroup.add(chev);
  }

  /**
   * Main Per-Frame Animation & State Synchronization
   */
  public update(
    dt: number,
    p: PlayerState,
    input: InputSnapshot,
    aimWorldPos: Vector2,
    now: number
  ): void {
    this.breathPhase += dt * 2.8;

    // Detect health loss to trigger hit flinch
    if (p.health < this.prevHealth && p.health > 0) {
      this.hitRecoilTimer = 0.24;
    }
    this.prevHealth = p.health;

    const isMoving = (input.moveDir.x !== 0 || input.moveDir.y !== 0) && (Math.hypot(p.velocity.x, p.velocity.y) > 10);
    const isDead = p.health <= 0;

    // 1. Smooth 360° Character Yaw Steering (Shortest arc slerp)
    if (!isDead) {
      if (this.attackTimer > 0) {
        // Aiming priority toward mouse crosshair
        const dx = aimWorldPos.x - p.pos.x;
        const dz = aimWorldPos.y - p.pos.y;
        this.targetYaw = Math.atan2(dx, dz);
      } else if (isMoving) {
        // Moving priority toward velocity heading
        this.targetYaw = Math.atan2(p.velocity.x, p.velocity.y);
      }

      // Shortest angle difference
      let diff = this.targetYaw - this.currentYaw;
      while (diff < -Math.PI) diff += Math.PI * 2;
      while (diff > Math.PI) diff -= Math.PI * 2;
      this.currentYaw += diff * Math.min(1.0, dt * 18);
      this.rootGroup.rotation.y = this.currentYaw;
    }

    // 2. State Machine Logic
    if (isDead) {
      this.animateDeath(dt);
      return;
    }

    if (this.hitRecoilTimer > 0) {
      this.hitRecoilTimer -= dt;
    }

    if (this.attackTimer > 0) {
      this.attackTimer -= dt;
      if (this.attackTimer <= 0) this.isAttacking = false;
    }

    if (p.isDashing) {
      this.animateDash(dt, p);
    } else if (p.isGliding) {
      this.animateGlide(dt);
    } else if (!p.isGrounded) {
      this.animateJump(dt, p);
    } else if (isMoving) {
      this.animateRun(dt, p);
    } else {
      this.animateIdle(dt);
    }

    // Overlay Upper-Body Combat Aim & Recoil if attacking
    if (this.isAttacking) {
      this.applyCombatAimPose(dt);
    }

    // Overlay Hit Recoil if recently damaged
    if (this.hitRecoilTimer > 0) {
      this.applyHitFlinch(dt);
    }

    // 3. Update 3D Skill Visual Effects
    this.updateSkillVFX(dt, p, now);
  }

  private animateIdle(dt: number): void {
    const breath = Math.sin(this.breathPhase);

    // Torso gentle lift and breathing
    this.torso.position.y = 2.5 + breath * 0.35;
    this.torso.rotation.x = breath * 0.02;
    this.torso.rotation.y = 0;
    this.torso.rotation.z = 0;

    this.headGroup.rotation.x = -breath * 0.02;
    this.headGroup.rotation.z = Math.sin(this.breathPhase * 0.5) * 0.02;

    // Relaxed arms at sides
    this.leftShoulder.rotation.x = Math.sin(this.breathPhase * 0.8) * 0.04;
    this.leftShoulder.rotation.z = 0.12;
    this.leftElbow.rotation.x = -0.25;

    this.rightShoulder.rotation.x = -Math.sin(this.breathPhase * 0.8) * 0.04;
    this.rightShoulder.rotation.z = -0.12;
    this.rightElbow.rotation.x = -0.25;

    // Legs straight in firm stance
    this.leftHip.rotation.set(0, 0, 0);
    this.leftKnee.rotation.set(0, 0, 0);
    this.leftAnkle.rotation.set(0, 0, 0);

    this.rightHip.rotation.set(0, 0, 0);
    this.rightKnee.rotation.set(0, 0, 0);
    this.rightAnkle.rotation.set(0, 0, 0);

    // Coat & hair subtle wind sway
    const wind = Math.sin(this.breathPhase * 1.5) * 0.06;
    this.coatBackLeft.rotation.x = wind;
    this.coatBackRight.rotation.x = wind * 1.1;
    this.ponytailJoint.rotation.x = wind * 0.8;
  }

  private animateRun(dt: number, p: PlayerState): void {
    const speed = Math.hypot(p.velocity.x, p.velocity.y);
    const cadence = (speed / 280) * 13;
    this.walkPhase += dt * cadence;

    const legSwing = Math.sin(this.walkPhase);
    const cosSwing = Math.cos(this.walkPhase);

    // Hips vertical bob and slight side sway
    this.pelvis.position.y = 21 + Math.abs(cosSwing) * 1.6;
    this.pelvis.rotation.y = -legSwing * 0.12;

    // Torso counter twist and forward lean
    this.torso.rotation.x = 0.14; // Forward athletic lean
    this.torso.rotation.y = legSwing * 0.14;

    // Head stays level
    this.headGroup.rotation.x = -0.08;
    this.headGroup.rotation.y = -legSwing * 0.06;

    // Alternating Leg articulation with knee flexion
    this.leftHip.rotation.x = legSwing * 0.78;
    this.leftKnee.rotation.x = legSwing > 0 ? legSwing * 0.95 : 0.08;
    this.leftAnkle.rotation.x = -this.leftHip.rotation.x * 0.4;

    this.rightHip.rotation.x = -legSwing * 0.78;
    this.rightKnee.rotation.x = legSwing < 0 ? -legSwing * 0.95 : 0.08;
    this.rightAnkle.rotation.x = -this.rightHip.rotation.x * 0.4;

    // Opposite Arm Swing with bent elbows
    if (!this.isAttacking) {
      this.leftShoulder.rotation.x = -legSwing * 0.65;
      this.leftShoulder.rotation.z = 0.15;
      this.leftElbow.rotation.x = -0.55 + Math.max(0, legSwing * 0.3);

      this.rightShoulder.rotation.x = legSwing * 0.65;
      this.rightShoulder.rotation.z = -0.15;
      this.rightElbow.rotation.x = -0.55 + Math.max(0, -legSwing * 0.3);
    }

    // Coat Tails flaring backward in the wind
    const coatFlutter = Math.sin(this.walkPhase * 2) * 0.12;
    this.coatBackLeft.rotation.x = 0.35 + Math.max(0, this.leftHip.rotation.x * 0.6) + coatFlutter;
    this.coatBackRight.rotation.x = 0.35 + Math.max(0, this.rightHip.rotation.x * 0.6) + coatFlutter;

    // Ponytail bouncing with stride
    this.ponytailJoint.rotation.x = 0.28 + Math.abs(cosSwing) * 0.18;
    this.ponytailJoint.rotation.y = -legSwing * 0.12;
  }

  private animateDash(dt: number, p: PlayerState): void {
    // Extreme forward aerodynamic lean
    this.pelvis.position.y = 17;
    this.torso.rotation.x = 0.75; // 43 degree forward lean

    // Limbs tucked and trailing behind
    this.leftHip.rotation.x = 0.55;
    this.leftKnee.rotation.x = 0.85;
    this.rightHip.rotation.x = 0.45;
    this.rightKnee.rotation.x = 0.75;

    this.leftShoulder.rotation.x = 1.1; // Arms swept back
    this.leftShoulder.rotation.z = 0.25;
    this.rightShoulder.rotation.x = 1.1;
    this.rightShoulder.rotation.z = -0.25;

    // Coat tails stream straight back horizontally
    this.coatBackLeft.rotation.x = 1.15;
    this.coatBackRight.rotation.x = 1.15;
    this.ponytailJoint.rotation.x = 1.25;

    // Spawn 3D Dash Trail Ribbon behind Commander
    this.spawnDashTrailGhost();
  }

  private animateJump(dt: number, p: PlayerState): void {
    this.torso.rotation.x = -0.05;
    // Upward reach pose
    this.leftHip.rotation.x = -0.3;
    this.leftKnee.rotation.x = 0.5;
    this.rightHip.rotation.x = -0.2;
    this.rightKnee.rotation.x = 0.4;

    this.leftShoulder.rotation.x = -0.6;
    this.rightShoulder.rotation.x = -0.6;

    // Coat flares down
    this.coatBackLeft.rotation.x = -0.15;
    this.coatBackRight.rotation.x = -0.15;
  }

  private animateGlide(dt: number): void {
    // Jetpack gliding pose: horizontal flight
    this.pelvis.position.y = 19;
    this.torso.rotation.x = 0.5;
    this.headGroup.rotation.x = -0.4; // Looking forward

    this.leftShoulder.rotation.set(-0.2, 0, 0.75); // Arms spread like glider wings
    this.rightShoulder.rotation.set(-0.2, 0, -0.75);

    this.leftHip.rotation.set(0.4, 0, 0);
    this.rightHip.rotation.set(0.4, 0, 0);

    this.coatBackLeft.rotation.x = 0.85;
    this.coatBackRight.rotation.x = 0.85;
    this.ponytailJoint.rotation.x = 0.95;
  }

  private applyCombatAimPose(dt: number): void {
    // Raise right arm pointing forward to shoot weapon
    this.rightShoulder.rotation.x = -1.45;
    this.rightShoulder.rotation.y = -0.18;
    this.rightShoulder.rotation.z = -0.12;
    this.rightElbow.rotation.x = -0.15;

    // Recoil kick impulse
    const recoil = Math.max(0, this.attackTimer / 0.22);
    this.rightShoulder.rotation.x += recoil * 0.35;
    this.rightElbow.rotation.x -= recoil * 0.25;
    this.torso.rotation.y += recoil * 0.08;
  }

  private applyHitFlinch(dt: number): void {
    const t = this.hitRecoilTimer / 0.24;
    // Torso flinches backward
    this.torso.rotation.x -= t * 0.25;
    this.headGroup.rotation.x += t * 0.15;
    this.pelvis.position.y -= t * 1.2;
  }

  private animateDeath(dt: number): void {
    this.deathProgress = Math.min(1.0, this.deathProgress + dt * 2.5);
    const p = this.deathProgress;

    // Hips drop to ground
    this.pelvis.position.y = 21 * (1 - p) + 3.5 * p;

    // Torso collapses forward onto terrain
    this.torso.rotation.x = p * 1.45;
    this.headGroup.rotation.x = p * 0.6;

    // Arms slump down
    this.leftShoulder.rotation.set(p * 0.8, 0, 0.4 * p);
    this.rightShoulder.rotation.set(p * 0.8, 0, -0.4 * p);

    // Knees buckle
    this.leftHip.rotation.x = -p * 1.2;
    this.leftKnee.rotation.x = p * 1.8;
    this.rightHip.rotation.x = -p * 1.2;
    this.rightKnee.rotation.x = p * 1.8;

    // Coat settles on ground
    this.coatBackLeft.rotation.x = p * 1.2;
    this.coatBackRight.rotation.x = p * 1.2;
  }

  /**
   * Called when player casts Primary Pulse or Secondary Wave
   */
  public triggerAttack(): void {
    this.isAttacking = true;
    this.attackTimer = 0.24;
  }

  /**
   * Called when Rally Command buff triggers
   */
  public triggerRallyVFX(): void {
    this.rallyVFXTimer = 1.2;
  }

  private updateSkillVFX(dt: number, p: PlayerState, now: number): void {
    // A. Defensive Protocol Hexagonal Shield (Active when defenseBonusTimer > 0)
    const isShieldActive = p.defenseBonusTimer > 0;
    const targetShieldOpacity = isShieldActive ? 0.75 : 0.0;
    const domeMat = this.shieldDome.material as THREE.MeshBasicMaterial;
    const glowMat = this.shieldInnerGlow.material as THREE.MeshBasicMaterial;

    domeMat.opacity += (targetShieldOpacity - domeMat.opacity) * Math.min(1.0, dt * 10);
    glowMat.opacity += ((isShieldActive ? 0.35 : 0.0) - glowMat.opacity) * Math.min(1.0, dt * 10);

    if (domeMat.opacity > 0.02) {
      this.shieldDome.visible = true;
      this.shieldInnerGlow.visible = true;
      this.shieldDome.rotation.y += dt * 0.85;
      this.shieldDome.rotation.z += dt * 0.4;
      const pulse = 1.0 + Math.sin(now * 0.008) * 0.05;
      this.shieldDome.scale.set(pulse, pulse, pulse);
    } else {
      this.shieldDome.visible = false;
      this.shieldInnerGlow.visible = false;
    }

    // B. Rally Command Holographic Eagle Crest
    if (this.rallyVFXTimer > 0) {
      this.rallyVFXTimer -= dt;
      const t = 1.0 - (this.rallyVFXTimer / 1.2);
      this.rallyHoloEagle.visible = true;
      this.rallyRing.visible = true;

      // Eagle floats upward and expands
      this.rallyHoloEagle.position.y = 52 + t * 16;
      (this.rallyHoloEagle.material as THREE.SpriteMaterial).opacity = Math.sin(t * Math.PI) * 0.95;
      this.rallyHoloEagle.scale.set(22 + t * 8, 17 + t * 6, 1);

      // Expanding golden ring at feet
      this.rallyRing.scale.set(1.0 + t * 4.2, 1.0 + t * 4.2, 1.0);
      (this.rallyRing.material as THREE.MeshBasicMaterial).opacity = (1.0 - t) * 0.85;
    } else {
      this.rallyHoloEagle.visible = false;
      this.rallyRing.visible = false;
    }

    // C. Update Dash Trail Silhouettes
    for (let i = this.dashTrailMeshes.length - 1; i >= 0; i--) {
      const trail = this.dashTrailMeshes[i];
      trail.lifetime -= dt;
      const mat = trail.mesh.material as THREE.MeshBasicMaterial;
      mat.opacity = Math.max(0, trail.lifetime / 0.35) * 0.6;
      if (trail.lifetime <= 0) {
        this.group.remove(trail.mesh);
        mat.dispose();
        trail.mesh.geometry.dispose();
        this.dashTrailMeshes.splice(i, 1);
      }
    }
  }

  private spawnDashTrailGhost(): void {
    if (Math.random() < 0.4) {
      const ghostGeo = new THREE.BoxGeometry(10, 24, 8);
      const ghostMat = new THREE.MeshBasicMaterial({
        color: Math.random() < 0.5 ? 0xfacc15 : 0xc084fc,
        transparent: true,
        opacity: 0.65,
        depthWrite: false
      });
      const ghostMesh = new THREE.Mesh(ghostGeo, ghostMat);
      ghostMesh.position.copy(this.rootGroup.position);
      ghostMesh.position.y += 18;
      ghostMesh.rotation.copy(this.rootGroup.rotation);
      this.group.add(ghostMesh);
      this.dashTrailMeshes.push({ mesh: ghostMesh, lifetime: 0.35 });
    }
  }

  public resetDeath(): void {
    this.deathProgress = 0;
    this.pelvis.position.y = 21;
    this.torso.rotation.set(0, 0, 0);
    this.headGroup.rotation.set(0, 0, 0);
  }

  public dispose(): void {
    for (const mat of this.materials) {
      mat.dispose();
    }
    this.materials = [];
    this.baseColors.clear();
  }
}


import * as THREE from 'three';
import { Vector2 } from '../sim/types';

const THREE_WHITE = new THREE.Color(0xffffff);
const _tmpCol1 = new THREE.Color();
const _tmpWhiteGhostTint = new THREE.Color(0xe6fff7);

interface ActiveRing {
  mesh: THREE.Mesh;
  maxRadius: number;
  currentRadius: number;
  lifetime: number;
  maxLifetime: number;
}

interface ActiveBeam {
  mesh: THREE.Mesh;
  lifetime: number;
  maxLifetime: number;
}

interface ActiveDamageText {
  sprite: THREE.Sprite;
  vy: number;
  lifetime: number;
  maxLifetime: number;
}

interface ActiveGhost {
  mesh: THREE.Mesh;
  lifetime: number;
  maxLifetime: number;
}

interface ActiveBloodDecal {
  mesh: THREE.Mesh;
  lifetime: number;
  maxLifetime: number;
}

interface ActiveTargetLock {
  group: THREE.Group;
  reticleMesh: THREE.Mesh;
  reticleMat: THREE.ShaderMaterial;
  pilotBeam: THREE.Mesh;
  pilotMat: THREE.MeshBasicMaterial;
  elapsed: number;
  strikeDelay: number;
  totalLifetime: number;
}

interface ActiveOrbitalSequence {
  group: THREE.Group;
  pos: Vector2;
  elevation: number;
  radius: number;
  elapsed: number;
  beamDuration: number;
  totalDuration: number;
  coreMesh: THREE.Mesh;
  coreMat: THREE.ShaderMaterial;
  midMesh: THREE.Mesh;
  midMat: THREE.ShaderMaterial;
  outerMesh: THREE.Mesh;
  outerMat: THREE.ShaderMaterial;
  apertureMesh: THREE.Mesh;
  apertureMat: THREE.ShaderMaterial;
  needlesGroup: THREE.Group;
  needleMats: THREE.MeshBasicMaterial[];
  impactFlashMesh: THREE.Mesh;
  impactFlashMat: THREE.ShaderMaterial;
  shockwaveMesh: THREE.Mesh;
  shockwaveMat: THREE.ShaderMaterial;
  scorchMesh: THREE.Mesh;
  scorchMat: THREE.ShaderMaterial;
  pointLight: THREE.PointLight;
  lightningLines: {
    line: THREE.Line;
    mat: THREE.LineBasicMaterial;
    isGroundArc: boolean;
    baseAngle: number;
  }[];
  arcJitterTimer: number;
}

interface ActiveOrbitalParticle {
  mesh: THREE.Mesh;
  kind: 'spark' | 'debris' | 'dust';
  vx: number;
  vy: number;
  vz: number;
  rotSpeedX: number;
  rotSpeedY: number;
  rotSpeedZ: number;
  baseScale: number;
  endScale: number;
  lifetime: number;
  maxLifetime: number;
  groundY: number;
}

interface ActiveSlashConvergence {
  group: THREE.Group;
  flashMesh: THREE.Mesh;
  flashMat: THREE.ShaderMaterial;
  leftBladeMesh: THREE.Mesh;
  leftBladeMat: THREE.Material;
  rightBladeMesh: THREE.Mesh;
  rightBladeMat: THREE.Material;
  compressionLines: THREE.LineSegments;
  compressionMat: THREE.LineBasicMaterial;
  elapsed: number;
  maxLifetime: number;
  // Scissor sweep fields
  isScissorSweep?: boolean;
  leftBladeGroup?: THREE.Group;
  rightBladeGroup?: THREE.Group;
  leftCoreMesh?: THREE.Mesh;
  leftCoreMat?: THREE.MeshBasicMaterial;
  rightCoreMesh?: THREE.Mesh;
  rightCoreMat?: THREE.MeshBasicMaterial;
  pos?: Vector2;
  focusPos?: Vector2;
  angle?: number;
  elevation?: number;
  radius?: number;
  sweepDuration?: number;
  hasCollided?: boolean;
  totalSlashes?: number;
  currentSlashIndex?: number;
}

interface ActiveDashTrail {
  group: THREE.Group;
  noseConeMesh: THREE.Mesh;
  noseConeMat: THREE.ShaderMaterial;
  streakMeshes: THREE.Mesh[];
  streakMats: THREE.MeshBasicMaterial[];
  dir: Vector2;
  elapsed: number;
  dashDuration: number;
  totalLifetime: number;
  dustTimer: number;
}

interface ActiveDashImpact {
  group: THREE.Group;
  flashMesh: THREE.Mesh;
  flashMat: THREE.ShaderMaterial;
  ringMesh: THREE.Mesh;
  ringMat: THREE.ShaderMaterial;
  spikesLine: THREE.LineSegments;
  spikesMat: THREE.LineBasicMaterial;
  cracksLine?: THREE.LineSegments;
  cracksMat?: THREE.LineBasicMaterial;
  elapsed: number;
  maxLifetime: number;
  radius: number;
}

interface ActiveSingularityVFX {
  group: THREE.Group;
  vortexDiscMesh: THREE.Mesh;
  vortexDiscMat: THREE.ShaderMaterial;
  coreSphereMesh: THREE.Mesh;
  coreSphereMat: THREE.MeshBasicMaterial;
  accretionRingMesh: THREE.Mesh;
  accretionRingMat: THREE.MeshBasicMaterial;
  debrisMeshes: {
    mesh: THREE.Mesh;
    mat: THREE.MeshBasicMaterial;
    angle: number;
    distRatio: number;
    heightOffset: number;
    orbitSpeed: number;
    rotSpeed: THREE.Vector3;
  }[];
  pointLight: THREE.PointLight;
  pos: Vector2;
  radius: number;
  baseElev: number;
  elapsed: number;
  duration: number;
}

interface ActiveConvergenceBarrageVFX {
  group: THREE.Group;
  spiralMesh: THREE.Mesh;
  spiralMat: THREE.ShaderMaterial;
  coreSphereMesh: THREE.Mesh;
  coreSphereMat: THREE.MeshBasicMaterial;
  coreCageMesh: THREE.Mesh;
  coreCageMat: THREE.MeshBasicMaterial;
  coreHaloMesh: THREE.Mesh;
  coreHaloMat: THREE.MeshBasicMaterial;
  debrisMeshes: {
    mesh: THREE.Mesh;
    mat: THREE.MeshBasicMaterial;
    angle: number;
    dist: number;
    baseY: number;
  }[];
  pointLight: THREE.PointLight;
  pos: Vector2;
  radius: number;
  baseElev: number;
  elapsed: number;
  duration: number;
}

interface ActiveCryogenicFieldVFX {
  group: THREE.Group;
  frostDiscMesh: THREE.Mesh;
  frostDiscMat: THREE.ShaderMaterial;
  crystalMeshes: {
    mesh: THREE.Mesh;
    mat: THREE.MeshBasicMaterial;
    targetScaleY: number;
  }[];
  snowParticles: {
    mesh: THREE.Mesh;
    mat: THREE.MeshBasicMaterial;
    angle: number;
    dist: number;
    yOffset: number;
    speedY: number;
    driftSpeed: number;
  }[];
  pointLight: THREE.PointLight;
  pos: Vector2;
  radius: number;
  baseElev: number;
  elapsed: number;
  duration: number;
}

// --- COMMANDER ENHANCED SKILL ACTIVE VFX CONTAINERS ---

interface TargetedElectricBranch {
  coreLine: THREE.Line;
  glowLine: THREE.Line;
  ribbonMesh?: THREE.Mesh;
  from: THREE.Vector3;
  to: THREE.Vector3;
}

interface ActiveElectricBolt {
  group: THREE.Group;
  coreLine: THREE.Line;
  glowLines: THREE.Line[];
  branchLines: THREE.Line[];
  targetedBranches?: TargetedElectricBranch[];
  ribbonMesh: THREE.Mesh;
  jitterTimer: number;
  elapsed: number;
  maxLifetime: number;
  from: THREE.Vector3;
  to: THREE.Vector3;
}

interface ChillProjectileBolt {
  group: THREE.Group;
  coreMesh: THREE.Mesh;
  sheathMesh: THREE.Mesh;
  trailMesh: THREE.Mesh;
  coreMat: THREE.MeshBasicMaterial;
  sheathMat: THREE.MeshBasicMaterial;
  trailMat: THREE.MeshBasicMaterial;
  spawnDelay: number;
  hasSpawned: boolean;
  hasImpacted: boolean;
  progress: number;
}

interface ActiveChillBeam {
  group: THREE.Group;
  bolts: ChillProjectileBolt[];
  elapsed: number;
  maxLifetime: number;
  from: THREE.Vector3;
  to: THREE.Vector3;
  dir: THREE.Vector3;
  totalDist: number;
  elevation: number;
  toElevation: number;
}

interface ActiveGroundIceSpire {
  mesh: THREE.Mesh;
  mat: THREE.MeshBasicMaterial;
  elapsed: number;
  maxLifetime: number;
  baseScaleY: number;
  targetScaleY: number;
}

interface ActiveCrescentSlashArc {
  group: THREE.Group;
  slashMesh: THREE.Mesh;
  slashMat: THREE.MeshBasicMaterial;
  coreMesh: THREE.Mesh;
  coreMat: THREE.MeshBasicMaterial;
  elapsed: number;
  maxLifetime: number;
  startScale: number;
  targetScale: number;
}

interface ActiveTentacleImpact {
  mesh: THREE.Mesh;
  mat: THREE.ShaderMaterial;
  elapsed: number;
  maxLifetime: number;
}

interface ActiveExplosionCloud {
  mesh: THREE.Mesh;
  mat: THREE.ShaderMaterial;
  vx: number;
  vy: number;
  vz: number;
  drag: number;
  lift: number;
  startScale: number;
  endScale: number;
  elapsed: number;
  duration: number;
}

interface ActiveSplatterDroplet {
  mesh: THREE.Mesh;
  mat: THREE.ShaderMaterial;
  vx: number;
  vy: number;
  vz: number;
  groundY: number;
  scale: number;
  splatColor: number;
  spawnedSplat: boolean;
  elapsed: number;
  duration: number;
}

interface ActiveLavaSwirlExplosion {
  group: THREE.Group;
  domeMesh: THREE.Mesh;
  domeMat: THREE.ShaderMaterial;
  poolMesh: THREE.Mesh;
  poolMat: THREE.ShaderMaterial;
  ringA: THREE.Mesh;
  ringAMat: THREE.MeshBasicMaterial;
  ringB: THREE.Mesh;
  ringBMat: THREE.MeshBasicMaterial;
  elapsed: number;
  maxLifetime: number;
  spinSign: number;
}

interface ActiveWhiteSilhouetteGhost {
  mesh: THREE.Mesh;
  mat: THREE.ShaderMaterial;
  lifetime: number;
  maxLifetime: number;
}

interface ActiveHealMote {
  mesh: THREE.Mesh;
  mat: THREE.MeshBasicMaterial;
  vy: number;
  vx: number;
  vz: number;
  lifetime: number;
  maxLifetime: number;
}

export class ThreeVFX {
  public group: THREE.Group;
  private rings: ActiveRing[] = [];
  private beams: ActiveBeam[] = [];
  private damageTexts: ActiveDamageText[] = [];
  private ghosts: ActiveGhost[] = [];
  private whiteGhosts: ActiveWhiteSilhouetteGhost[] = [];
  private healMotes: ActiveHealMote[] = [];
  private regionalFrostMotes: ActiveHealMote[] = [];
  private lightningLines: THREE.Line[] = [];
  private bloodDecals: ActiveBloodDecal[] = [];
  private bloodTexture: THREE.Texture | null = null;
  private bloodPlaneGeo = new THREE.PlaneGeometry(28, 28);

  // Terrain elevation callback (optional refY avoids snapping low-elevation VFX onto tower roofs/overhangs)
  private heightSampler: (x: number, z: number, refY?: number) => number = () => 0;

  // Orbital Strike 4-Phase Active Containers & Shared Geometries
  private targetLocks: ActiveTargetLock[] = [];
  public orbitalSequences: ActiveOrbitalSequence[] = [];
  private orbitalParticles: ActiveOrbitalParticle[] = [];
  public slashConvergences: ActiveSlashConvergence[] = [];
  public dashTrails: ActiveDashTrail[] = [];
  public dashImpacts: ActiveDashImpact[] = [];
  public blasterFlashes: ActiveBeam[] = [];
  public activeSingularities: ActiveSingularityVFX[] = [];
  public activeConvergences: ActiveConvergenceBarrageVFX[] = [];
  public activeCryoFields: ActiveCryogenicFieldVFX[] = [];
  public activeElectricBolts: ActiveElectricBolt[] = [];
  public activeChillBeams: ActiveChillBeam[] = [];
  public activeGroundSpikes: ActiveGroundIceSpire[] = [];
  public activeSlashArcs: ActiveCrescentSlashArc[] = [];
  private activeTentacleImpacts: ActiveTentacleImpact[] = [];
  private activeLavaSwirls: ActiveLavaSwirlExplosion[] = [];
  private explosionClouds: ActiveExplosionCloud[] = [];
  private splatterDroplets: ActiveSplatterDroplet[] = [];
  private sharedSparkGeo!: THREE.BufferGeometry;
  private sharedDebrisGeo!: THREE.BufferGeometry;
  private sharedDustGeo = new THREE.PlaneGeometry(1.0, 1.0);
  private sharedUnitPlaneGeo = new THREE.PlaneGeometry(1.0, 1.0);
  private sharedUnitPlaneXZGeo: THREE.BufferGeometry;
  private dustRadialTex: THREE.CanvasTexture | null = null;

  // Persistent compiled shader templates & object pools (prevents synchronous GPU shader recompilation & GC churn)
  private shaderTemplates: Map<string, THREE.ShaderMaterial> = new Map();
  private shaderPool: Map<string, THREE.ShaderMaterial[]> = new Map();
  private basicMatPool: THREE.MeshBasicMaterial[] = [];
  private damageTexCache: Map<string, THREE.CanvasTexture> = new Map();
  private damageSpritePool: THREE.Sprite[] = [];
  private coarseHeightBuf: Float32Array = new Float32Array(13 * 13);

  // Single persistent pooled PointLight for orbital strikes & ultimate detonations (avoids shader recompilation)
  public sharedOrbitalLight: THREE.PointLight;
  private sharedOrbitalLightTimer: number = 0;
  private sharedOrbitalLightMaxDuration: number = 0.5;
  private sharedOrbitalLightPeakIntensity: number = 0;

  // Pooled Blaster Bolt Resources (eliminates per-shot ShaderMaterial compilation freezes)
  private sharedBoltCoreGeo?: THREE.BufferGeometry;
  private sharedBoltTipGeo?: THREE.BufferGeometry;
  private sharedBoltGlowGeo?: THREE.BufferGeometry;
  private sharedBoltTrailGeoH?: THREE.PlaneGeometry;
  private sharedBoltTrailGeoV?: THREE.PlaneGeometry;
  private sharedBoltCoreMat?: THREE.MeshBasicMaterial;
  private sharedBoltTipMat?: THREE.MeshBasicMaterial;
  private sharedBoltGlowMat?: THREE.MeshBasicMaterial;
  private sharedBoltTrailMat?: THREE.ShaderMaterial;
  private sharedMuzzleFlashGeo?: THREE.PlaneGeometry;
  private sharedMuzzleFlashMat?: THREE.ShaderMaterial;
  private sharedImpactSparkGeo?: THREE.PlaneGeometry;
  private sharedImpactSparkMat?: THREE.ShaderMaterial;
  private sharedSparkMatYellow?: THREE.MeshBasicMaterial;
  private sharedSparkMatOrange?: THREE.MeshBasicMaterial;

  constructor(heightSampler?: (x: number, z: number, refY?: number) => number) {
    this.group = new THREE.Group();
    if (heightSampler) {
      this.heightSampler = heightSampler;
    }

    this.sharedOrbitalLight = new THREE.PointLight(0xffd700, 0, 750, 1.4);
    this.sharedOrbitalLight.position.set(0, -1000, 0);
    this.group.add(this.sharedOrbitalLight);

    if (typeof document !== 'undefined') {
      new THREE.TextureLoader().load('/assets/alien_blood_decal.png', (tex) => {
        tex.colorSpace = THREE.SRGBColorSpace;
        this.bloodTexture = tex;
      });
    }
    this.sharedSparkGeo = this.createOrganicSparkQuadGeo();
    this.sharedSparkGeo.userData.isSharedGeo = true;
    this.sharedDebrisGeo = this.createOrganicRockClusterGeo();
    this.sharedDebrisGeo.userData.isSharedGeo = true;
    this.sharedDustGeo.userData.isSharedGeo = true;
    this.sharedUnitPlaneGeo.userData.isSharedGeo = true;
    this.sharedUnitPlaneXZGeo = new THREE.PlaneGeometry(1.0, 1.0);
    this.sharedUnitPlaneXZGeo.rotateX(-Math.PI / 2);
    this.sharedUnitPlaneXZGeo.userData.isSharedGeo = true;
    this.bloodPlaneGeo.userData.isSharedGeo = true;
    this.dustRadialTex = this.createSoftSmokeTexture();
  }

  private getOrCompileShaderTemplate(
    key: string,
    buildConfig: () => THREE.ShaderMaterialParameters
  ): THREE.ShaderMaterial {
    let tpl = this.shaderTemplates.get(key);
    if (!tpl) {
      tpl = new THREE.ShaderMaterial(buildConfig());
      tpl.userData.isTemplate = true;
      this.shaderTemplates.set(key, tpl);
    }
    return tpl;
  }

  private acquireShader(
    key: string,
    buildConfig: () => THREE.ShaderMaterialParameters,
    uniformUpdates?: Record<string, unknown>
  ): THREE.ShaderMaterial {
    const pool = this.shaderPool.get(key);
    let mat: THREE.ShaderMaterial;
    if (pool && pool.length > 0) {
      mat = pool.pop()!;
    } else {
      mat = this.getOrCompileShaderTemplate(key, buildConfig).clone();
      mat.userData.poolKey = key;
    }
    if (uniformUpdates) {
      for (const uKey in uniformUpdates) {
        const u = mat.uniforms[uKey];
        if (!u) continue;
        const val = uniformUpdates[uKey];
        if (val instanceof THREE.Color) {
          if (u.value instanceof THREE.Color) u.value.copy(val);
          else u.value = val.clone();
        } else if (val instanceof THREE.Vector4) {
          if (u.value instanceof THREE.Vector4) u.value.copy(val);
          else u.value = val.clone();
        } else {
          u.value = val;
        }
      }
    }
    return mat;
  }

  private releaseMaterial(mat: THREE.Material | undefined | null): void {
    if (!mat || mat.userData?.isTemplate) return;
    const poolKey = mat.userData?.poolKey as string | undefined;
    if (poolKey && (mat as THREE.ShaderMaterial).isShaderMaterial) {
      let pool = this.shaderPool.get(poolKey);
      if (!pool) {
        pool = [];
        this.shaderPool.set(poolKey, pool);
      }
      if (pool.length < 128) {
        pool.push(mat as THREE.ShaderMaterial);
        return;
      }
    }
    if (mat.userData?.isPooledBasicMat && (mat as THREE.MeshBasicMaterial).isMeshBasicMaterial) {
      if (this.basicMatPool.length < 160) {
        const bm = mat as THREE.MeshBasicMaterial;
        bm.map = null;
        this.basicMatPool.push(bm);
        return;
      }
    }
    mat.dispose();
  }

  private acquireBasicMat(
    colorHex: number,
    opacity: number = 1.0,
    blending: THREE.Blending = THREE.NormalBlending,
    side: THREE.Side = THREE.FrontSide,
    depthWrite: boolean = true,
    map: THREE.Texture | null = null
  ): THREE.MeshBasicMaterial {
    let bm = this.basicMatPool.pop();
    if (!bm) {
      bm = new THREE.MeshBasicMaterial({ transparent: true });
      bm.userData.isPooledBasicMat = true;
    }
    bm.color.setHex(colorHex);
    bm.transparent = true;
    bm.opacity = opacity;
    bm.blending = blending;
    bm.side = side;
    bm.depthWrite = depthWrite;
    bm.map = map;
    bm.needsUpdate = map !== null;
    return bm;
  }

  public getActiveParticleCount(): number {
    return (
      this.rings.length +
      this.beams.length +
      this.damageTexts.length +
      this.ghosts.length +
      this.whiteGhosts.length +
      this.healMotes.length +
      this.regionalFrostMotes.length +
      this.lightningLines.length +
      this.bloodDecals.length +
      this.targetLocks.length +
      this.orbitalSequences.length +
      this.orbitalParticles.length +
      this.slashConvergences.length +
      this.dashTrails.length +
      this.dashImpacts.length +
      this.blasterFlashes.length +
      this.activeSingularities.length +
      this.activeConvergences.length +
      this.activeCryoFields.length +
      this.activeElectricBolts.length +
      this.activeChillBeams.length +
      this.activeGroundSpikes.length +
      this.activeSlashArcs.length +
      this.activeTentacleImpacts.length +
      this.activeLavaSwirls.length +
      this.explosionClouds.length +
      this.splatterDroplets.length
    );
  }

  public clear(): void {
    const toRemove: THREE.Object3D[] = [];
    this.group.children.forEach((child) => {
      if (child !== this.sharedOrbitalLight) {
        toRemove.push(child);
      }
    });
    toRemove.forEach((child) => {
      this.group.remove(child);
      if ((child as THREE.Sprite).isSprite && child.userData?.isPooledDamageSprite) {
        const sp = child as THREE.Sprite;
        if (this.damageSpritePool.length < 128) {
          this.damageSpritePool.push(sp);
          return;
        }
      }
      child.traverse((c) => {
        if ((c as THREE.Mesh).isMesh || (c as THREE.Line).isLine) {
          const m = c as THREE.Mesh;
          if (!m.userData?.isSharedGeo && !m.geometry?.userData?.isSharedGeo) m.geometry?.dispose();
          if (Array.isArray(m.material)) m.material.forEach((mat) => this.releaseMaterial(mat));
          else if (!m.userData?.isSharedMat) this.releaseMaterial(m.material);
        }
      });
    });

    this.rings = [];
    this.beams = [];
    this.damageTexts = [];
    this.ghosts = [];
    this.lightningLines = [];
    this.bloodDecals = [];
    this.targetLocks = [];
    this.orbitalSequences = [];
    this.orbitalParticles = [];
    this.slashConvergences = [];
    this.dashTrails = [];
    this.dashImpacts = [];
    this.blasterFlashes = [];
    this.activeSingularities = [];
    this.activeConvergences = [];
    this.activeCryoFields = [];
    this.activeElectricBolts = [];
    this.activeChillBeams = [];
    this.activeGroundSpikes = [];
    this.activeSlashArcs = [];
    this.activeTentacleImpacts = [];
    this.activeLavaSwirls = [];
    this.explosionClouds = [];
    this.splatterDroplets = [];
    this.whiteGhosts = [];
    this.healMotes = [];
    this.regionalFrostMotes = [];
  }

  /** Creates double-sided crossed tapered spark-streak quad blades (zero geometric octahedron). */
  private createOrganicSparkQuadGeo(): THREE.BufferGeometry {
    const geo = new THREE.BufferGeometry();
    const verts = new Float32Array([
      -0.45, -1.6, 0,  0.45, -0.2, 0,  0, 1.8, 0,
       0, 1.8, 0,      0.45, -0.2, 0, -0.45, -1.6, 0,
      -0.45, -1.6, 0,  0, 1.8, 0,     -0.25, 0.3, 0,
      -0.25, 0.3, 0,   0, 1.8, 0,     -0.45, -1.6, 0,
      0, -1.6, -0.45,  0, -0.2, 0.45,  0, 1.8, 0,
      0, 1.8, 0,       0, -0.2, 0.45,  0, -1.6, -0.45,
      0, -1.6, -0.45,  0, 1.8, 0,      0, 0.3, -0.25,
      0, 0.3, -0.25,   0, 1.8, 0,      0, -1.6, -0.45
    ]);
    geo.setAttribute('position', new THREE.BufferAttribute(verts, 3));
    geo.computeVertexNormals();
    return geo;
  }

  /** Creates an asymmetric noise-sculpted rocky mineral chunk (zero dodecahedron/octahedron). */
  private createOrganicRockClusterGeo(): THREE.BufferGeometry {
    const geo = new THREE.BufferGeometry();
    const positions: number[] = [];
    const lat = 4;
    const lon = 6;
    const samplePt = (i: number, j: number): THREE.Vector3 => {
      const phi = (i / lat) * Math.PI;
      const theta = (j / lon) * Math.PI * 2;
      const noise = 0.68 + 0.55 * Math.abs(Math.sin(i * 3.1 + j * 1.9 + 0.7));
      const r = noise;
      return new THREE.Vector3(
        Math.sin(phi) * Math.cos(theta) * r * 1.15,
        Math.cos(phi) * r * 0.85,
        Math.sin(phi) * Math.sin(theta) * r
      );
    };
    for (let i = 0; i < lat; i++) {
      for (let j = 0; j < lon; j++) {
        const p00 = samplePt(i, j);
        const p10 = samplePt(i + 1, j);
        const p01 = samplePt(i, (j + 1) % lon);
        const p11 = samplePt(i + 1, (j + 1) % lon);
        positions.push(p00.x, p00.y, p00.z, p10.x, p10.y, p10.z, p01.x, p01.y, p01.z);
        positions.push(p01.x, p01.y, p01.z, p10.x, p10.y, p10.z, p11.x, p11.y, p11.z);
      }
    }
    geo.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
    geo.computeVertexNormals();
    return geo;
  }

  /**
   * Builds an organic noise-perturbed energy plume / flame stream column (centered around Y in [-h/2, h/2]).
   * Replaces all geometric CylinderGeometry / ConeGeometry tubes with turbulent undulating organic profiles.
   */
  public createOrganicPlumeColumnGeo(
    rTop: number,
    rBottom: number,
    height: number,
    radialSegs: number = 18,
    heightSegs: number = 8,
    warpAmp: number = 0.16,
    twistTurns: number = 0.6
  ): THREE.BufferGeometry {
    const geo = new THREE.BufferGeometry();
    const positions: number[] = [];
    const uvs: number[] = [];
    const indices: number[] = [];

    for (let h = 0; h <= heightSegs; h++) {
      const v = h / heightSegs;
      const y = (v - 0.5) * height;
      const baseR = rBottom + (rTop - rBottom) * v;
      for (let s = 0; s <= radialSegs; s++) {
        const u = s / radialSegs;
        const ang = u * Math.PI * 2 + v * twistTurns * Math.PI * 2;
        const wave = 1.0 + warpAmp * (Math.sin(ang * 3.0 + v * 5.2) * 0.65 + Math.cos(ang * 5.0 - v * 7.5) * 0.35);
        const r = Math.max(0.05, baseR * wave);
        positions.push(Math.cos(ang) * r, y, Math.sin(ang) * r);
        uvs.push(u, v);
      }
    }

    const stride = radialSegs + 1;
    for (let h = 0; h < heightSegs; h++) {
      for (let s = 0; s < radialSegs; s++) {
        const i0 = h * stride + s;
        const i1 = i0 + stride;
        indices.push(i0, i1, i0 + 1);
        indices.push(i0 + 1, i1, i1 + 1);
      }
    }

    geo.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
    geo.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
    geo.setIndex(indices);
    geo.computeVertexNormals();
    return geo;
  }

  /**
   * Builds an irregular noise-carved crystal or jagged ice splinter spire pivoted at y = 0.
   * Zero OctahedronGeometry / ConeGeometry primitives.
   */
  public createJaggedShardGeo(
    radius: number,
    height: number,
    sides: number = 5,
    seed: number = 1
  ): THREE.BufferGeometry {
    const geo = new THREE.BufferGeometry();
    const positions: number[] = [];
    const indices: number[] = [];
    const ringT = [0.0, 0.28, 0.72];
    const ringR = [radius * 0.85, radius * 1.05, radius * 0.52];

    for (let r = 0; r < ringT.length; r++) {
      const y = ringT[r] * height;
      for (let s = 0; s <= sides; s++) {
        const a = (s / sides) * Math.PI * 2 + seed * 0.37;
        const asym = 0.78 + 0.44 * Math.abs(Math.sin(a * 2.3 + r * 1.7 + seed));
        positions.push(
          Math.cos(a) * ringR[r] * asym + Math.sin(seed + r) * radius * 0.14,
          y,
          Math.sin(a) * ringR[r] * asym + Math.cos(seed + r) * radius * 0.14
        );
      }
    }

    const stride = sides + 1;
    for (let r = 0; r < ringT.length - 1; r++) {
      for (let s = 0; s < sides; s++) {
        const a = r * stride + s;
        const b = a + stride;
        indices.push(a, b, a + 1);
        indices.push(a + 1, b, b + 1);
      }
    }

    const tipIdx = positions.length / 3;
    positions.push(
      Math.sin(seed * 1.9) * radius * 0.25,
      height,
      Math.cos(seed * 2.7) * radius * 0.25
    );
    const topBase = (ringT.length - 1) * stride;
    for (let s = 0; s < sides; s++) {
      indices.push(topBase + s, tipIdx, topBase + s + 1);
    }

    geo.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
    geo.setIndex(indices);
    geo.computeVertexNormals();
    return geo;
  }

  /** Domain-warped volumetric FBM fireball & dense dark smoke billboard shader. */
  private createExplosionPuffShader(
    coreHex: number,
    midHex: number,
    smokeHex: number,
    seed: number,
    additive: boolean = false
  ): THREE.ShaderMaterial {
    const tplKey = additive ? 'explosion_puff_add' : 'explosion_puff_normal';
    const mat = this.acquireShader(
      tplKey,
      () => ({
        transparent: true,
        depthWrite: false,
        side: THREE.DoubleSide,
        blending: additive ? THREE.AdditiveBlending : THREE.NormalBlending,
        uniforms: {
          uProgress: { value: 0.0 },
          uSeed: { value: 0.0 },
          uCoreCol: { value: new THREE.Color(0xffffff) },
          uMidCol: { value: new THREE.Color(0xffffff) },
          uSmokeCol: { value: new THREE.Color(0x000000) }
        },
        vertexShader: `
        varying vec2 vUv;
        void main() {
          vUv = uv * 2.0 - 1.0;
          gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
        }
      `,
        fragmentShader: `
        uniform float uProgress;
        uniform float uSeed;
        uniform vec3 uCoreCol;
        uniform vec3 uMidCol;
        uniform vec3 uSmokeCol;
        varying vec2 vUv;

        float eHash(vec2 p) {
          return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453123);
        }
        float eNoise(vec2 p) {
          vec2 i = floor(p);
          vec2 f = fract(p);
          f = f * f * (3.0 - 2.0 * f);
          return mix(
            mix(eHash(i), eHash(i + vec2(1.0, 0.0)), f.x),
            mix(eHash(i + vec2(0.0, 1.0)), eHash(i + vec2(1.0, 1.0)), f.x),
            f.y
          );
        }
        float eFbm(vec2 p) {
          float v = 0.0;
          float a = 0.52;
          for (int i = 0; i < 4; i++) {
            v += a * eNoise(p);
            p = p * 2.08 + vec2(7.3, 13.1);
            a *= 0.5;
          }
          return v;
        }

        void main() {
          float r = length(vUv);
          vec2 q = vUv * 2.4 + vec2(uSeed * 3.1, -uProgress * 1.4);
          float n1 = eFbm(q);
          float n2 = eFbm(q * 1.85 + vec2(n1 * 1.4, -uProgress * 2.1));
          // Domain-warped organic cloud silhouette (never a circular ball)
          float distortedR = r - (n2 - 0.45) * 0.65;
          if (distortedR > 0.96) discard;

          float density = smoothstep(0.96, 0.14, distortedR) * (0.55 + 0.75 * n1);
          float erosion = smoothstep(0.18, 0.65, n2 + (1.0 - r) * 0.42 - uProgress * 0.48);
          float heat = clamp((1.0 - smoothstep(0.05, 0.62, uProgress)) * (0.45 + n2 * 0.85), 0.0, 1.0);

          vec3 col = mix(uSmokeCol, uMidCol, smoothstep(0.18, 0.62, heat));
          col = mix(col, uCoreCol, smoothstep(0.55, 0.92, heat * (1.0 - r * 0.45)));

          float fade = pow(max(0.0, 1.0 - uProgress), 1.15);
          float alpha = clamp(density * erosion * fade, 0.0, 0.94);
          if (alpha < 0.015) discard;
          gl_FragColor = vec4(col, alpha);
        }
      `
      }),
      { uProgress: 0.0, uSeed: seed }
    );
    (mat.uniforms.uCoreCol.value as THREE.Color).setHex(coreHex);
    (mat.uniforms.uMidCol.value as THREE.Color).setHex(midHex);
    (mat.uniforms.uSmokeCol.value as THREE.Color).setHex(smokeHex);
    return mat;
  }

  /** Ragged visceral alien ichor droplet billboard shader for internal-rupture bursts. */
  private createSplatterDropletShader(
    coreHex: number,
    edgeHex: number,
    seed: number
  ): THREE.ShaderMaterial {
    const mat = this.acquireShader(
      'splatter_droplet',
      () => ({
        transparent: true,
        depthWrite: false,
        side: THREE.DoubleSide,
        uniforms: {
          uAlpha: { value: 0.95 },
          uSeed: { value: 0.0 },
          uCoreCol: { value: new THREE.Color(0xffffff) },
          uEdgeCol: { value: new THREE.Color(0xffffff) }
        },
        vertexShader: `
        varying vec2 vUv;
        void main() {
          vUv = uv * 2.0 - 1.0;
          gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
        }
      `,
        fragmentShader: `
        uniform float uAlpha;
        uniform float uSeed;
        uniform vec3 uCoreCol;
        uniform vec3 uEdgeCol;
        varying vec2 vUv;
        float sHash(vec2 p) {
          return fract(sin(dot(p, vec2(41.2, 289.1))) * 43758.5453);
        }
        float sNoise(vec2 p) {
          vec2 i = floor(p);
          vec2 f = fract(p);
          f = f * f * (3.0 - 2.0 * f);
          return mix(
            mix(sHash(i), sHash(i + vec2(1.0, 0.0)), f.x),
            mix(sHash(i + vec2(0.0, 1.0)), sHash(i + vec2(1.0, 1.0)), f.x),
            f.y
          );
        }
        void main() {
          vec2 p = vUv;
          float n = sNoise(p * 3.8 + vec2(uSeed * 5.2, uSeed * 2.7));
          float ang = atan(p.y, p.x);
          float lobe = 0.56 + 0.34 * sin(ang * 3.0 + uSeed) + 0.28 * n;
          // Elongated viscous droplet taper along Y
          vec2 stretched = vec2(p.x * 1.15, p.y * (p.y > 0.0 ? 0.72 : 1.05));
          float r = length(stretched);
          if (r > lobe) discard;
          float coreMask = smoothstep(lobe, 0.08, r);
          vec3 col = mix(uEdgeCol, uCoreCol, pow(coreMask, 1.4));
          gl_FragColor = vec4(col, clamp(coreMask * 1.35 * uAlpha, 0.0, 0.96));
        }
      `
      }),
      { uAlpha: 0.95, uSeed: seed }
    );
    (mat.uniforms.uCoreCol.value as THREE.Color).setHex(coreHex);
    (mat.uniforms.uEdgeCol.value as THREE.Color).setHex(edgeHex);
    return mat;
  }

  /** Organic turbulent shockwave vapor & flame gust shader (zero crisp geometric rings). */
  public createOrganicRippleShader(
    primaryHex: number,
    secondaryHex?: number,
    seed: number = 0
  ): THREE.ShaderMaterial {
    const mat = this.acquireShader(
      'organic_ripple',
      () => ({
        transparent: true,
        depthWrite: false,
        side: THREE.DoubleSide,
        blending: THREE.AdditiveBlending,
        uniforms: {
          uProgress: { value: 0.08 },
          uAlpha: { value: 1.0 },
          uSeed: { value: 0.0 },
          uPrimary: { value: new THREE.Color(0xffffff) },
          uSecondary: { value: new THREE.Color(0xffffff) }
        },
        vertexShader: `
        varying vec2 vUv;
        void main() {
          vUv = uv * 2.0 - 1.0;
          gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
        }
      `,
        fragmentShader: `
        uniform float uProgress;
        uniform float uAlpha;
        uniform float uSeed;
        uniform vec3 uPrimary;
        uniform vec3 uSecondary;
        varying vec2 vUv;

        float gHash(vec2 p) {
          return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453);
        }
        float gNoise(vec2 p) {
          vec2 i = floor(p);
          vec2 f = fract(p);
          f = f * f * (3.0 - 2.0 * f);
          return mix(
            mix(gHash(i), gHash(i + vec2(1.0, 0.0)), f.x),
            mix(gHash(i + vec2(0.0, 1.0)), gHash(i + vec2(1.0, 1.0)), f.x),
            f.y
          );
        }

        void main() {
          float r = length(vUv);
          vec2 dir = r > 0.001 ? vUv / r : vec2(1.0, 0.0);
          float wispNoise = gNoise(dir * 4.5 + vUv * 3.8 + vec2(uSeed * 2.7, -uProgress * 4.0)) * 0.65
                          + gNoise(vUv * 8.2 + vec2(uProgress * 3.0, uSeed)) * 0.35;
          float wavePos = mix(0.18, 0.78, uProgress) + (wispNoise - 0.5) * 0.34;
          float band = exp(-pow((r - wavePos) / 0.16, 2.0)) * smoothstep(0.15, 0.85, wispNoise);
          float core = smoothstep(0.55, 0.0, r + (wispNoise - 0.5) * 0.35) * (1.0 - uProgress) * 0.55;
          float outerMask = 1.0 - smoothstep(0.68, 1.0, r + (0.5 - wispNoise) * 0.25);
          float alpha = clamp((band * 0.95 + core) * outerMask * uAlpha, 0.0, 0.92);
          if (alpha < 0.012) discard;
          vec3 col = mix(uPrimary, uSecondary, smoothstep(0.35, 0.9, band + core));
          gl_FragColor = vec4(col, alpha);
        }
      `
      }),
      { uProgress: 0.08, uAlpha: 1.0, uSeed: seed }
    );
    const pCol = mat.uniforms.uPrimary.value as THREE.Color;
    const sCol = mat.uniforms.uSecondary.value as THREE.Color;
    pCol.setHex(primaryHex);
    if (secondaryHex !== undefined) {
      sCol.setHex(secondaryHex);
    } else {
      sCol.copy(pCol).lerp(THREE_WHITE, 0.38);
    }
    return mat;
  }

  /**
   * Unified realistic multi-layered volumetric explosion (billowing FBM fireballs, turbulent smoke clouds,
   * terrain shock-dust gusts, molten embers & ragged scorch decal). Zero geometric shapes.
   */
  public spawnRealisticExplosion(
    pos: Vector2,
    elevation: number = 0,
    radius: number = 120,
    theme: 'fire' | 'lava' | 'toxic' | 'cryo' | 'void' | 'emerald' = 'fire',
    impactZ?: number
  ): void {
    const baseElev = this.getTerrainHeight(pos.x, pos.y, elevation);
    const burstY = impactZ !== undefined ? Math.max(baseElev + 6, impactZ) : baseElev + 12;

    const paletteMap = {
      fire: { core: 0xfffbeb, mid: 0xf97316, smoke: 0x292524, dust: 0x57534e, light: 0xf97316 },
      lava: { core: 0xfef08a, mid: 0xea580c, smoke: 0x1c1917, dust: 0x44403c, light: 0xf97316 },
      toxic: { core: 0xecfccb, mid: 0x84cc16, smoke: 0x1a2e05, dust: 0x3f6212, light: 0x84cc16 },
      cryo: { core: 0xf0fdfa, mid: 0x38bdf8, smoke: 0x1e3a5f, dust: 0x64748b, light: 0x38bdf8 },
      void: { core: 0xfdf4ff, mid: 0xd946ef, smoke: 0x1e0b2e, dust: 0x4c1d95, light: 0xa855f7 },
      emerald: { core: 0xecfdf5, mid: 0x10b981, smoke: 0x064e3b, dust: 0x334155, light: 0x34d399 }
    };
    const pal = paletteMap[theme];

    this.triggerSharedOrbitalLight(pos, burstY, pal.light, Math.min(7.5, 3.0 + radius * 0.025), radius * 2.8, 0.55);

    while (this.explosionClouds.length > 90) {
      const oldest = this.explosionClouds.shift();
      if (oldest) {
        this.group.remove(oldest.mesh);
        if (!oldest.mesh.userData?.isSharedGeo) oldest.mesh.geometry.dispose();
        this.releaseMaterial(oldest.mat);
      }
    }

    // 1. Rising turbulent fireball & dense smoke puffs
    const fireballCount = Math.min(10, Math.max(5, Math.round(radius / 26)));
    for (let i = 0; i < fireballCount; i++) {
      const ang = (i / fireballCount) * Math.PI * 2 + (Math.random() - 0.5) * 0.5;
      const radialDist = (i === 0 ? 0.04 : 0.14 + Math.random() * 0.34) * radius;
      const puffSize = radius * (i === 0 ? 0.85 : 0.45 + Math.random() * 0.40);
      const mat = this.createExplosionPuffShader(pal.core, pal.mid, pal.smoke, Math.random() * 100, false);
      const mesh = new THREE.Mesh(this.sharedUnitPlaneGeo, mat);
      mesh.userData.isSharedGeo = true;
      mesh.scale.setScalar(0.36 * puffSize);
      mesh.position.set(
        pos.x + Math.cos(ang) * radialDist,
        burstY + puffSize * 0.18 + Math.random() * 16,
        pos.y + Math.sin(ang) * radialDist
      );
      this.group.add(mesh);

      const speedOut = (i === 0 ? 15 : 65 + Math.random() * 110) * Math.min(1.6, radius / 95);
      const duration = 0.58 + Math.random() * 0.36;
      this.explosionClouds.push({
        mesh,
        mat,
        vx: Math.cos(ang) * speedOut,
        vy: (i === 0 ? 75 : 42 + Math.random() * 88),
        vz: Math.sin(ang) * speedOut,
        drag: 3.4,
        lift: 32,
        startScale: 0.36 * puffSize,
        endScale: (1.45 + Math.random() * 0.45) * puffSize,
        elapsed: 0,
        duration
      });
    }

    // 2. Ground-hugging outward billowing shock-dust clouds
    const dustRingCount = Math.min(7, Math.max(4, Math.round(radius / 38)));
    for (let i = 0; i < dustRingCount; i++) {
      const ang = (i / dustRingCount) * Math.PI * 2 + (Math.random() - 0.5) * 0.4;
      const puffSize = radius * (0.42 + Math.random() * 0.28);
      const mat = this.createExplosionPuffShader(pal.mid, pal.dust, pal.smoke, Math.random() * 100, false);
      const mesh = new THREE.Mesh(this.sharedUnitPlaneGeo, mat);
      mesh.userData.isSharedGeo = true;
      mesh.scale.setScalar(0.45 * puffSize);
      mesh.position.set(
        pos.x + Math.cos(ang) * (radius * 0.18),
        baseElev + puffSize * 0.12,
        pos.y + Math.sin(ang) * (radius * 0.18)
      );
      this.group.add(mesh);
      this.explosionClouds.push({
        mesh,
        mat,
        vx: Math.cos(ang) * (radius * 1.15),
        vy: 14 + Math.random() * 24,
        vz: Math.sin(ang) * (radius * 1.15),
        drag: 3.8,
        lift: 10,
        startScale: 0.45 * puffSize,
        endScale: 1.65 * puffSize,
        elapsed: 0,
        duration: 0.65 + Math.random() * 0.30
      });
    }

    // 3. Hot sparks & shrapnel streaks erupting outward
    const sparkCount = Math.min(18, Math.max(8, Math.round(radius / 14)));
    for (let s = 0; s < sparkCount; s++) {
      const ang = Math.random() * Math.PI * 2;
      const spd = 110 + Math.random() * 230;
      const mat = this.acquireBasicMat(
        s % 3 === 0 ? pal.core : pal.mid,
        0.95,
        THREE.AdditiveBlending,
        THREE.DoubleSide,
        false
      );
      const spk = new THREE.Mesh(this.sharedSparkGeo, mat);
      spk.userData.isSharedGeo = true;
      spk.position.set(pos.x, burstY + 4, pos.y);
      const sc = 2.0 + Math.random() * 2.2;
      spk.scale.set(sc * 0.7, sc * 2.2, sc * 0.7);
      this.group.add(spk);
      this.orbitalParticles.push({
        mesh: spk,
        kind: 'spark',
        vx: Math.cos(ang) * spd,
        vy: 95 + Math.random() * 195,
        vz: Math.sin(ang) * spd,
        rotSpeedX: (Math.random() - 0.5) * 14,
        rotSpeedY: (Math.random() - 0.5) * 14,
        rotSpeedZ: (Math.random() - 0.5) * 14,
        baseScale: sc,
        endScale: 0.2,
        lifetime: 0.36 + Math.random() * 0.32,
        maxLifetime: 0.68,
        groundY: baseElev + 2
      });
    }

    // 4. Irregular turbulent pressure shock ripple across terrain
    this.spawnShockwaveRing(pos, radius, pal.mid, baseElev + 1.2, 0.38);
  }

  /**
   * Visceral internal-rupture explosion when an enemy or boss is killed:
   * bursts outward from the enemy's center with pressurized internal mist, ballistic 3D ichor droplets
   * obeying gravity and terrain collisions, and organic ground splatter stains.
   */
  public spawnEnemyInternalSplatterBurst(
    pos: Vector2,
    elevation: number = 0,
    enemyType: string = 'crawler',
    radius: number = 42,
    isBig: boolean = false
  ): void {
    const baseElev = this.getTerrainHeight(pos.x, pos.y, elevation);
    const torsoY = Math.max(baseElev + 18, elevation + radius * 0.62);

    let coreHex = 0xffccd5;
    let ichorHex = 0xe11d48;
    let mistHex = 0x4c1d95;
    if (enemyType === 'spitter') {
      coreHex = 0xecfccb;
      ichorHex = 0x84cc16;
      mistHex = 0x365314;
    } else if (enemyType === 'wasp') {
      coreHex = 0xa5f3fc;
      ichorHex = 0xc084fc;
      mistHex = 0x3b0764;
    } else if (enemyType === 'elite' || isBig) {
      coreHex = 0xfda4af;
      ichorHex = 0xd946ef;
      mistHex = 0x3b0764;
    }

    // 1. Central internal rupture flash & organic bioluminescent vapor clouds
    const mistCount = isBig ? 10 : 4;
    for (let i = 0; i < mistCount; i++) {
      const ang = (i / mistCount) * Math.PI * 2 + Math.random() * 0.6;
      const size = Math.max(46, radius * (isBig ? 1.5 : 1.15)) * (0.65 + Math.random() * 0.5);
      const mat = this.createExplosionPuffShader(coreHex, ichorHex, mistHex, Math.random() * 100, i === 0);
      const mesh = new THREE.Mesh(this.sharedUnitPlaneGeo, mat);
      mesh.userData.isSharedGeo = true;
      mesh.scale.setScalar(0.32 * size);
      mesh.position.set(
        pos.x + Math.cos(ang) * (i === 0 ? 0 : radius * 0.22),
        torsoY + (Math.random() - 0.3) * 14,
        pos.y + Math.sin(ang) * (i === 0 ? 0 : radius * 0.22)
      );
      this.group.add(mesh);

      const spd = i === 0 ? 10 : 85 + Math.random() * 130;
      this.explosionClouds.push({
        mesh,
        mat,
        vx: Math.cos(ang) * spd,
        vy: i === 0 ? 45 : 35 + Math.random() * 85,
        vz: Math.sin(ang) * spd,
        drag: 4.0,
        lift: 18,
        startScale: 0.32 * size,
        endScale: 1.55 * size,
        elapsed: 0,
        duration: isBig ? 0.72 + Math.random() * 0.35 : 0.42 + Math.random() * 0.22
      });
    }

    // 2. Ballistic 3D internal ichor droplets erupting outward under gravity
    while (this.splatterDroplets.length > 130) {
      const oldest = this.splatterDroplets.shift();
      if (oldest) {
        this.group.remove(oldest.mesh);
        if (!oldest.mesh.userData?.isSharedGeo) oldest.mesh.geometry.dispose();
        this.releaseMaterial(oldest.mat);
      }
    }

    const dropletCount = isBig ? 36 : 14;
    const baseSpeed = isBig ? 260 : 165;
    for (let d = 0; d < dropletCount; d++) {
      const ang = (d / dropletCount) * Math.PI * 2 + (Math.random() - 0.5) * 0.45;
      const spd = baseSpeed * (0.45 + Math.random() * 0.95);
      const dropSize = (isBig ? 18 : 11) + Math.random() * (isBig ? 18 : 11);
      const mat = this.createSplatterDropletShader(coreHex, ichorHex, Math.random() * 60);
      const mesh = new THREE.Mesh(this.sharedUnitPlaneGeo, mat);
      mesh.userData.isSharedGeo = true;
      mesh.scale.set(dropSize, dropSize, 1);
      mesh.position.set(
        pos.x + Math.cos(ang) * (radius * 0.25),
        torsoY + (Math.random() - 0.5) * 12,
        pos.y + Math.sin(ang) * (radius * 0.25)
      );
      this.group.add(mesh);

      this.splatterDroplets.push({
        mesh,
        mat,
        vx: Math.cos(ang) * spd,
        vy: (isBig ? 140 : 85) + Math.random() * (isBig ? 220 : 145),
        vz: Math.sin(ang) * spd,
        groundY: baseElev + 1.2,
        scale: dropSize,
        splatColor: ichorHex,
        spawnedSplat: false,
        elapsed: 0,
        duration: 0.68 + Math.random() * 0.38
      });
    }

    // 3. Initial center ichor splatter puddle under ruptured enemy (fades cleanly in ~5s)
    this.spawnAlienBloodSplatter(pos, baseElev, ichorHex, isBig ? 1.85 : 1.0);
    if (isBig) {
      this.spawnShockwaveRing(pos, Math.max(220, radius * 3.2), ichorHex, baseElev + 1.5, 0.72);
    }
  }

  private triggerSharedOrbitalLight(
    pos: Vector2,
    elevation: number,
    colorHex: number,
    intensity: number,
    distance: number,
    duration: number
  ): void {
    this.sharedOrbitalLight.color.setHex(colorHex);
    this.sharedOrbitalLight.position.set(pos.x, elevation + 42, pos.y);
    this.sharedOrbitalLight.distance = distance;
    this.sharedOrbitalLight.intensity = Math.max(this.sharedOrbitalLight.intensity, intensity);
    this.sharedOrbitalLightPeakIntensity = this.sharedOrbitalLight.intensity;
    this.sharedOrbitalLightTimer = Math.max(this.sharedOrbitalLightTimer, duration);
    this.sharedOrbitalLightMaxDuration = Math.max(0.1, duration);
  }

  public setHeightSampler(sampler: (x: number, z: number, refY?: number) => number): void {
    this.heightSampler = sampler;
  }

  private getTerrainHeight(x: number, z: number, fallback: number = 0): number {
    try {
      const refY = fallback !== 0 ? fallback : undefined;
      const h = this.heightSampler(x, z, refY);
      if (!Number.isFinite(h)) return fallback;
      // Never allow an elevation-anchored VFX to snap wildly upward onto an overhead tower roof or arch
      if (refY !== undefined && h > refY + 120) {
        return fallback;
      }
      return h;
    } catch {
      return fallback;
    }
  }

  private createSoftSmokeTexture(): THREE.CanvasTexture | null {
    if (typeof document === 'undefined') return null;
    const canvas = document.createElement('canvas');
    canvas.width = 64;
    canvas.height = 64;
    const ctx = canvas.getContext('2d');
    if (!ctx) return null;

    const grad = ctx.createRadialGradient(32, 32, 2, 32, 32, 30);
    grad.addColorStop(0.0, 'rgba(255, 238, 190, 0.95)');
    grad.addColorStop(0.35, 'rgba(215, 185, 145, 0.65)');
    grad.addColorStop(0.7, 'rgba(130, 118, 108, 0.28)');
    grad.addColorStop(1.0, 'rgba(80, 75, 70, 0.0)');
    ctx.fillStyle = grad;
    ctx.fillRect(0, 0, 64, 64);

    const tex = new THREE.CanvasTexture(canvas);
    tex.needsUpdate = true;
    return tex;
  }

  /**
   * Builds a subdivided horizontal plane centered at (centerX, centerZ) where every vertex Y
   * conforms to the actual terrain surface height + yOffset.
   */
  private createTerrainConformingGrid(
    centerX: number,
    centerZ: number,
    halfSize: number,
    segments: number,
    yOffset: number,
    fallbackElevation: number
  ): THREE.BufferGeometry {
    const geo = new THREE.PlaneGeometry(halfSize * 2, halfSize * 2, segments, segments);
    geo.rotateX(-Math.PI / 2);

    const posAttr = geo.attributes.position as THREE.BufferAttribute;
    const centerH = this.getTerrainHeight(centerX, centerZ, fallbackElevation);

    if (segments > 12 && halfSize > 0.001) {
      const coarseSegs = 12;
      const coarseSide = coarseSegs + 1;
      const fullSize = halfSize * 2;
      const invSize = coarseSegs / fullSize;
      for (let gz = 0; gz < coarseSide; gz++) {
        const wz = centerZ - halfSize + (gz / coarseSegs) * fullSize;
        const rowBase = gz * coarseSide;
        for (let gx = 0; gx < coarseSide; gx++) {
          const wx = centerX - halfSize + (gx / coarseSegs) * fullSize;
          let wy = this.getTerrainHeight(wx, wz, centerH);
          if (Math.abs(wy - centerH) > 42) {
            wy = centerH + Math.sign(wy - centerH) * 42;
          }
          this.coarseHeightBuf[rowBase + gx] = wy - centerH + yOffset;
        }
      }
      for (let i = 0; i < posAttr.count; i++) {
        const u = Math.max(0, Math.min(coarseSegs, (posAttr.getX(i) + halfSize) * invSize));
        const v = Math.max(0, Math.min(coarseSegs, (posAttr.getZ(i) + halfSize) * invSize));
        const x0 = Math.min(coarseSegs - 1, Math.floor(u));
        const z0 = Math.min(coarseSegs - 1, Math.floor(v));
        const fx = u - x0;
        const fz = v - z0;
        const row0 = z0 * coarseSide;
        const row1 = row0 + coarseSide;
        const h00 = this.coarseHeightBuf[row0 + x0];
        const h10 = this.coarseHeightBuf[row0 + x0 + 1];
        const h01 = this.coarseHeightBuf[row1 + x0];
        const h11 = this.coarseHeightBuf[row1 + x0 + 1];
        const h0 = h00 + (h10 - h00) * fx;
        const h1 = h01 + (h11 - h01) * fx;
        posAttr.setY(i, h0 + (h1 - h0) * fz);
      }
    } else {
      for (let i = 0; i < posAttr.count; i++) {
        const lx = posAttr.getX(i);
        const lz = posAttr.getZ(i);
        const wx = centerX + lx;
        const wz = centerZ + lz;
        let wy = this.getTerrainHeight(wx, wz, centerH);
        // Clamp extreme vertical cliff spikes so the decal doesn't stretch up sheer vertical walls
        if (Math.abs(wy - centerH) > 42) {
          wy = centerH + Math.sign(wy - centerH) * 42;
        }
        posAttr.setY(i, wy - centerH + yOffset);
      }
    }
    posAttr.needsUpdate = true;
    geo.computeVertexNormals();
    return geo;
  }

  // ============================================================================
  // PHASE ONE: ORBITAL TARGET LOCK (0.00s -> 0.40s strike, fades at 0.75s)
  // ============================================================================
  public spawnOrbitalTargetLock(
    pos: Vector2,
    radius: number,
    elevation: number = 0,
    strikeDelay: number = 0.40,
    variant: string = 'judgment'
  ): void {
    const baseElev = this.getTerrainHeight(pos.x, pos.y, elevation);
    const lockGroup = new THREE.Group();
    lockGroup.position.set(pos.x, baseElev, pos.y);

    // Palette per variant (default 'judgment' is brilliant white-gold / amber-gold)
    let primaryCol = new THREE.Color(0xfacc15);
    let accentCol = new THREE.Color(0xfffbeb);
    if (variant === 'nuke' || variant === 'lance') {
      primaryCol = new THREE.Color(0xf59e0b);
      accentCol = new THREE.Color(0xfef08a);
    } else if (variant === 'singularity') {
      primaryCol = new THREE.Color(0xa855f7);
      accentCol = new THREE.Color(0xf3e8ff);
    } else if (variant === 'chrono' || variant === 'cryo') {
      primaryCol = new THREE.Color(0x38bdf8);
      accentCol = new THREE.Color(0xe0f2fe);
    }

    const reticleRadius = radius * 0.62;
    const reticleGeo = this.createTerrainConformingGrid(
      pos.x,
      pos.y,
      reticleRadius,
      16,
      0.55,
      baseElev
    );

    const reticleMat = this.acquireShader(
      'orbital_reticle',
      () => ({
        transparent: true,
        depthWrite: false,
        side: THREE.DoubleSide,
        blending: THREE.AdditiveBlending,
        uniforms: {
          uTime: { value: 0.0 },
          uProgress: { value: 0.0 }, // 0 -> 1 during target lock, >1 after impact
          uAlpha: { value: 1.0 },
          uPrimaryColor: { value: new THREE.Color(0xfacc15) },
          uAccentColor: { value: new THREE.Color(0xfffbeb) }
        },
        vertexShader: `
          varying vec2 vUv;
          void main() {
            vUv = uv;
            gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
          }
        `,
        fragmentShader: `
          varying vec2 vUv;
          uniform float uTime;
          uniform float uProgress;
          uniform float uAlpha;
          uniform vec3 uPrimaryColor;
          uniform vec3 uAccentColor;

          float lHash(vec2 p) {
            return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453);
          }
          float lNoise(vec2 p) {
            vec2 i = floor(p);
            vec2 f = fract(p);
            f = f * f * (3.0 - 2.0 * f);
            return mix(
              mix(lHash(i), lHash(i + vec2(1.0, 0.0)), f.x),
              mix(lHash(i + vec2(0.0, 1.0)), lHash(i + vec2(1.0, 1.0)), f.x),
              f.y
            );
          }
          float lFbm(vec2 p) {
            return 0.55 * lNoise(p) + 0.30 * lNoise(p * 2.1 + vec2(4.2, 9.1)) + 0.15 * lNoise(p * 4.3 + vec2(1.7, 5.4));
          }

          void main() {
            vec2 p = (vUv - 0.5) * 2.0;
            float r = length(p);
            float lockIntensity = clamp(uProgress, 0.0, 1.0);
            float angle = atan(p.y, p.x);

            // Converging irregular plasma & ember wisps swirling inward (zero concentric circles/chevrons/crosshairs)
            float swirlA = angle + log(max(0.08, r)) * 2.4 - uTime * (2.6 + lockIntensity * 3.5);
            vec2 samplePos = vec2(cos(swirlA), sin(swirlA)) * r * 3.2;
            float n1 = lFbm(samplePos + vec2(uTime * 1.1, -uTime * 0.8));
            float n2 = lFbm(samplePos * 1.9 - vec2(uTime * 1.8, uTime * 1.2));
            float warpedR = r + (n1 - 0.5) * 0.42;
            if (warpedR > 1.0) discard;

            float wispTendrils = smoothstep(0.32, 0.88, n1 * 0.65 + n2 * 0.55) * smoothstep(1.0, 0.18, warpedR);
            float inwardFocus = smoothstep(0.65 - lockIntensity * 0.28, 0.0, warpedR) * (0.45 + 0.85 * lockIntensity);
            float edgeEmbers = smoothstep(0.08, 0.0, abs(warpedR - mix(0.76, 0.28, lockIntensity))) * n2;
            float totalIntensity = wispTendrils * 0.85 + inwardFocus + edgeEmbers * 1.35;

            vec3 col = mix(uPrimaryColor, uAccentColor, clamp(n2 * 0.6 + inwardFocus * 0.5, 0.0, 1.0));
            float alpha = clamp(totalIntensity * (0.55 + 0.65 * lockIntensity) * uAlpha, 0.0, 1.0);
            if (alpha < 0.015) discard;
            gl_FragColor = vec4(col * (1.2 + lockIntensity * 0.85), alpha);
          }
        `
      }),
      { uTime: 0.0, uProgress: 0.0, uAlpha: 1.0, uPrimaryColor: primaryCol, uAccentColor: accentCol }
    );

    const reticleMesh = new THREE.Mesh(reticleGeo, reticleMat);
    lockGroup.add(reticleMesh);

    // Thin organic undulating sky-to-ground flame-thread beam during lock-on (zero cylinder)
    const pilotGeo = this.createOrganicPlumeColumnGeo(1.0, 2.4, 1400, 10, 10, 0.35, 1.5);
    const pilotMat = this.acquireBasicMat(
      primaryCol.getHex(),
      0.25,
      THREE.AdditiveBlending,
      THREE.DoubleSide,
      false,
      null
    );
    const pilotBeam = new THREE.Mesh(pilotGeo, pilotMat);
    pilotBeam.position.y = 700;
    lockGroup.add(pilotBeam);

    this.group.add(lockGroup);

    this.targetLocks.push({
      group: lockGroup,
      reticleMesh,
      reticleMat,
      pilotBeam,
      pilotMat,
      elapsed: 0,
      strikeDelay: Math.max(0.1, strikeDelay),
      totalLifetime: strikeDelay + 0.38 // Remains visible under the beam impact flash!
    });
  }

  // ============================================================================
  // PHASES TWO, THREE & FOUR: DESCENDING BEAM, IMPACT EXPLOSION & GROUND AFTERMATH
  // ============================================================================
  public spawnOrbitalBlast(
    pos: Vector2,
    radius: number,
    elevation: number = 0,
    variant: string = 'judgment',
    impactZ?: number
  ): void {
    const baseElev = this.getTerrainHeight(pos.x, pos.y, elevation);

    // Stage 1 Titan Boss Elemental Ball: swirling molten bio-lava explosion (never a sky orbital beam)
    if (variant === 'void') {
      this.spawnLavaSwirlExplosion(pos, radius, baseElev, impactZ);
      return;
    }

    // Only explicit orbital-strike ultimates/events summon a sky-to-ground orbital beam.
    // Non-orbital impacts (Chain Reaction, Cryo/Acid/Vortex projectiles, Second Wind) render local volumetric bursts.
    const isTrueOrbitalStrike =
      variant === 'judgment' ||
      variant === 'nuke' ||
      variant === 'lance' ||
      variant === 'singularity' ||
      variant === 'chrono' ||
      variant === 'convergence_sub';
    if (!isTrueOrbitalStrike) {
      const theme: 'fire' | 'lava' | 'toxic' | 'cryo' | 'void' | 'emerald' =
        variant === 'cryo'
          ? 'cryo'
          : variant === 'acid'
            ? 'toxic'
            : variant === 'vortex'
              ? 'void'
              : variant === 'second_wind' || variant === 'emerald'
                ? 'emerald'
                : 'fire';
      this.spawnRealisticExplosion(pos, baseElev, Math.max(85, radius), theme, impactZ);
      return;
    }

    // Trigger volumetric billowing fireball + smoke cloud + embers on orbital impact
    this.spawnRealisticExplosion(pos, baseElev, Math.max(105, radius * 0.95), 'fire', baseElev + 16);

    // Enforce max 4 simultaneous full orbital sequences for standard casts, or up to 8 when spawning 5-strike convergence sub-beams
    const maxSequences = variant === 'convergence_sub' ? 8 : 4;
    while (this.orbitalSequences.length >= maxSequences) {
      const oldest = this.orbitalSequences.shift();
      if (oldest) this.disposeOrbitalSequence(oldest);
    }

    // Variant palette configuration (Default 'judgment' matches reference image white-gold / amber / orange)
    let coreCol = new THREE.Color(0xffffff);
    let midCol = new THREE.Color(0xfacc15);
    let outerCol = new THREE.Color(0xf97316);
    let lightHex = 0xffb703;
    let beamDuration = 0.68;
    let widthMult = 1.0;

    if (variant === 'convergence_sub') {
      widthMult = 0.78;
      beamDuration = 0.72;
    }

    if (variant === 'nuke') {
      coreCol = new THREE.Color(0xfef08a);
      midCol = new THREE.Color(0xf97316);
      outerCol = new THREE.Color(0xef4444);
      lightHex = 0xff5500;
      beamDuration = 0.75;
      widthMult = 1.15;
    } else if (variant === 'lance') {
      coreCol = new THREE.Color(0xffffff);
      midCol = new THREE.Color(0xfbbf24);
      outerCol = new THREE.Color(0xea580c);
      lightHex = 0xffaa00;
      beamDuration = 1.05;
      widthMult = 1.3;
    } else if (variant === 'singularity') {
      coreCol = new THREE.Color(0xf5d0fe);
      midCol = new THREE.Color(0xc084fc);
      outerCol = new THREE.Color(0x7c3aed);
      lightHex = 0xa855f7;
      beamDuration = 0.85;
      widthMult = 1.15;
    } else if (variant === 'chrono') {
      coreCol = new THREE.Color(0xe0f2fe);
      midCol = new THREE.Color(0x38bdf8);
      outerCol = new THREE.Color(0x0284c7);
      lightHex = 0x00e5ff;
      beamDuration = 0.95;
      widthMult = 1.1;
    }

    const seqGroup = new THREE.Group();
    seqGroup.position.set(pos.x, baseElev, pos.y);
    this.group.add(seqGroup);

    const beamHeight = 1400;
    const beamRadiusBase = Math.max(28, radius * 0.14 * widthMult);

    // ------------------------------------------------------------------------
    // 1. INNER CORE: Undulating plasma flame core (zero cylinder)
    // ------------------------------------------------------------------------
    const coreGeo = this.createOrganicPlumeColumnGeo(
      beamRadiusBase * 0.52,
      beamRadiusBase * 0.68,
      beamHeight,
      18,
      10,
      0.14,
      0.8
    );
    const coreMat = this.acquireShader(
      'orbital_beam_core',
      () => ({
        transparent: true,
        depthWrite: false,
        side: THREE.DoubleSide,
        blending: THREE.AdditiveBlending,
        uniforms: {
          uTime: { value: 0.0 },
          uIntensity: { value: 1.0 },
          uCoreColor: { value: new THREE.Color(0xffffff) },
          uMidColor: { value: new THREE.Color(0xfacc15) }
        },
        vertexShader: `
          varying vec2 vUv;
          varying vec3 vNormal;
          varying vec3 vViewDir;
          void main() {
            vUv = uv;
            vec4 mvPos = modelViewMatrix * vec4(position, 1.0);
            vNormal = normalize(normalMatrix * normal);
            vViewDir = normalize(-mvPos.xyz);
            gl_Position = projectionMatrix * mvPos;
          }
        `,
        fragmentShader: `
          varying vec2 vUv;
          varying vec3 vNormal;
          varying vec3 vViewDir;
          uniform float uTime;
          uniform float uIntensity;
          uniform vec3 uCoreColor;
          uniform vec3 uMidColor;

          void main() {
            float fresnel = abs(dot(vNormal, vViewDir));
            float coreDensity = pow(clamp(fresnel, 0.0, 1.0), 0.45);
            float pulse = 0.92 + 0.08 * sin(vUv.y * 45.0 + uTime * 38.0);
            vec3 col = mix(uMidColor, uCoreColor, pow(coreDensity, 0.65)) * 1.85 * pulse;
            float alpha = clamp(coreDensity * 1.35 * uIntensity, 0.0, 1.0);
            gl_FragColor = vec4(col, alpha);
          }
        `
      }),
      { uTime: 0.0, uIntensity: 1.0, uCoreColor: coreCol, uMidColor: midCol }
    );
    const coreMesh = new THREE.Mesh(coreGeo, coreMat);
    coreMesh.position.y = beamHeight * 0.5;
    seqGroup.add(coreMesh);

    // ------------------------------------------------------------------------
    // 2. MIDDLE ENERGY LAYER: Animated golden plasma striations & distortion
    // ------------------------------------------------------------------------
    const midGeo = this.createOrganicPlumeColumnGeo(
      beamRadiusBase * 0.95,
      beamRadiusBase * 1.32,
      beamHeight,
      22,
      12,
      0.20,
      1.1
    );
    const midMat = this.acquireShader(
      'orbital_beam_mid',
      () => ({
        transparent: true,
        depthWrite: false,
        side: THREE.DoubleSide,
        blending: THREE.AdditiveBlending,
        uniforms: {
          uTime: { value: 0.0 },
          uIntensity: { value: 1.0 },
          uCoreColor: { value: new THREE.Color(0xffffff) },
          uMidColor: { value: new THREE.Color(0xfacc15) },
          uOuterColor: { value: new THREE.Color(0xea580c) }
        },
        vertexShader: `
          varying vec2 vUv;
          varying vec3 vNormal;
          varying vec3 vViewDir;
          uniform float uTime;
          void main() {
            vUv = uv;
            // Subtle plasma width undulation along the column height
            vec3 displaced = position;
            float wave = sin(uv.y * 28.0 + uTime * 24.0) * 0.045 + cos(uv.y * 64.0 + uTime * 42.0) * 0.025;
            displaced.xz *= (1.0 + wave);
            vec4 mvPos = modelViewMatrix * vec4(displaced, 1.0);
            vNormal = normalize(normalMatrix * normal);
            vViewDir = normalize(-mvPos.xyz);
            gl_Position = projectionMatrix * mvPos;
          }
        `,
        fragmentShader: `
          varying vec2 vUv;
          varying vec3 vNormal;
          varying vec3 vViewDir;
          uniform float uTime;
          uniform float uIntensity;
          uniform vec3 uCoreColor;
          uniform vec3 uMidColor;
          uniform vec3 uOuterColor;

          float hash(vec2 p) {
            return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453123);
          }

          float noise(vec2 p) {
            vec2 i = floor(p);
            vec2 f = fract(p);
            f = f * f * (3.0 - 2.0 * f);
            float a = hash(i);
            float b = hash(i + vec2(1.0, 0.0));
            float c = hash(i + vec2(0.0, 1.0));
            float d = hash(i + vec2(1.0, 1.0));
            return mix(mix(a, b, f.x), mix(c, d, f.x), f.y);
          }

          void main() {
            float fresnel = pow(clamp(abs(dot(vNormal, vViewDir)), 0.0, 1.0), 1.15);
            // Downward-scrolling high-velocity vertical plasma streaks
            vec2 uv1 = vec2(vUv.x * 10.0, vUv.y * 18.0 + uTime * 16.0);
            vec2 uv2 = vec2(vUv.x * 20.0 - uTime * 1.5, vUv.y * 36.0 + uTime * 28.0);
            float n = noise(uv1) * 0.65 + noise(uv2) * 0.35;

            // Brighter concentration near the ground impact base (vUv.y near 0)
            float baseBoost = 1.0 + smoothstep(0.18, 0.0, vUv.y) * 0.85;
            vec3 col = mix(uOuterColor, uMidColor, n);
            col = mix(col, uCoreColor, smoothstep(0.68, 0.95, n * fresnel)) * 1.45 * baseBoost;

            float alpha = clamp(fresnel * (0.55 + 0.65 * n) * uIntensity, 0.0, 1.0);
            gl_FragColor = vec4(col, alpha);
          }
        `
      }),
      { uTime: 0.0, uIntensity: 1.0, uCoreColor: coreCol, uMidColor: midCol, uOuterColor: outerCol }
    );
    const midMesh = new THREE.Mesh(midGeo, midMat);
    midMesh.position.y = beamHeight * 0.5;
    seqGroup.add(midMesh);

    // ------------------------------------------------------------------------
    // 3. OUTER GLOW: Softer orange-gold energy halo with controlled bloom
    // ------------------------------------------------------------------------
    const outerGeo = this.createOrganicPlumeColumnGeo(
      beamRadiusBase * 1.65,
      beamRadiusBase * 2.35,
      beamHeight,
      18,
      8,
      0.24,
      -0.7
    );
    const outerMat = this.acquireShader(
      'orbital_beam_outer',
      () => ({
        transparent: true,
        depthWrite: false,
        side: THREE.DoubleSide,
        blending: THREE.AdditiveBlending,
        uniforms: {
          uIntensity: { value: 1.0 },
          uOuterColor: { value: new THREE.Color(0xea580c) },
          uMidColor: { value: new THREE.Color(0xfacc15) }
        },
        vertexShader: `
          varying vec2 vUv;
          varying vec3 vNormal;
          varying vec3 vViewDir;
          void main() {
            vUv = uv;
            vec4 mvPos = modelViewMatrix * vec4(position, 1.0);
            vNormal = normalize(normalMatrix * normal);
            vViewDir = normalize(-mvPos.xyz);
            gl_Position = projectionMatrix * mvPos;
          }
        `,
        fragmentShader: `
          varying vec2 vUv;
          varying vec3 vNormal;
          varying vec3 vViewDir;
          uniform float uIntensity;
          uniform vec3 uOuterColor;
          uniform vec3 uMidColor;

          void main() {
            float fresnel = pow(clamp(abs(dot(vNormal, vViewDir)), 0.0, 1.0), 2.1);
            float baseFlare = 1.0 + smoothstep(0.15, 0.0, vUv.y) * 0.75;
            vec3 col = mix(uOuterColor, uMidColor, fresnel * 0.5) * baseFlare;
            float alpha = clamp(fresnel * 0.48 * uIntensity, 0.0, 0.65);
            gl_FragColor = vec4(col, alpha);
          }
        `
      }),
      { uIntensity: 1.0, uOuterColor: outerCol, uMidColor: midCol }
    );
    const outerMesh = new THREE.Mesh(outerGeo, outerMat);
    outerMesh.position.y = beamHeight * 0.5;
    seqGroup.add(outerMesh);

    // ------------------------------------------------------------------------
    // 4. UPPER SKY ORBITAL APERTURE RING & DESCENDING LIGHT NEEDLES
    //    (Visible near the top of the gameplay camera view, matching reference!)
    // ------------------------------------------------------------------------
    const apertureHeight = 205;
    const apertureRadius = radius * 0.68;
    const apertureGeo = new THREE.PlaneGeometry(apertureRadius * 2, apertureRadius * 2);
    apertureGeo.rotateX(-Math.PI / 2);
    const apertureMat = this.acquireShader(
      'orbital_aperture',
      () => ({
        transparent: true,
        depthWrite: false,
        side: THREE.DoubleSide,
        blending: THREE.AdditiveBlending,
        uniforms: {
          uTime: { value: 0.0 },
          uIntensity: { value: 1.0 },
          uMidColor: { value: new THREE.Color(0xfacc15) },
          uCoreColor: { value: new THREE.Color(0xffffff) }
        },
        vertexShader: `
          varying vec2 vUv;
          void main() {
            vUv = uv;
            gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
          }
        `,
        fragmentShader: `
          varying vec2 vUv;
          uniform float uTime;
          uniform float uIntensity;
          uniform vec3 uMidColor;
          uniform vec3 uCoreColor;
          float apHash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
          float apNoise(vec2 p) {
            vec2 i = floor(p); vec2 f = fract(p); f = f * f * (3.0 - 2.0 * f);
            return mix(mix(apHash(i), apHash(i + vec2(1.0, 0.0)), f.x), mix(apHash(i + vec2(0.0, 1.0)), apHash(i + vec2(1.0, 1.0)), f.x), f.y);
          }
          void main() {
            vec2 p = (vUv - 0.5) * 2.0;
            float r = length(p);
            float a = atan(p.y, p.x);
            float swirl = apNoise(vec2(cos(a - uTime * 1.8), sin(a - uTime * 1.8)) * r * 3.5 + vec2(uTime * 1.2))
                        + 0.5 * apNoise(p * 6.0 - vec2(uTime * 2.4));
            float distortedR = r - (swirl - 0.7) * 0.42;
            if (distortedR > 1.0) discard;
            float cloudMask = smoothstep(1.0, 0.12, distortedR) * smoothstep(0.35, 1.15, swirl);
            float core = smoothstep(0.42, 0.0, distortedR) * 0.85;
            float mask = cloudMask + core;
            vec3 col = mix(uMidColor, uCoreColor, clamp(mask * 0.55, 0.0, 1.0)) * 1.35;
            gl_FragColor = vec4(col, clamp(mask * uIntensity * 0.82, 0.0, 1.0));
          }
        `
      }),
      { uTime: 0.0, uIntensity: 1.0, uMidColor: midCol, uCoreColor: coreCol }
    );
    const apertureMesh = new THREE.Mesh(apertureGeo, apertureMat);
    apertureMesh.position.y = apertureHeight;
    seqGroup.add(apertureMesh);

    // 8 turbulent descending golden flame wisps around the upper sky break
    const needlesGroup = new THREE.Group();
    const needleMats: THREE.MeshBasicMaterial[] = [];
    for (let i = 0; i < 8; i++) {
      const ang = (i / 8) * Math.PI * 2 + 0.2;
      const dist = apertureRadius * (0.42 + (i % 2) * 0.26);
      const needleLen = 95 + (i % 3) * 32;
      const nGeo = this.createOrganicPlumeColumnGeo(1.8, 0.25, needleLen, 6, 4, 0.32, 1.2);
      const nMat = this.acquireBasicMat(
        (i % 2 === 0 ? coreCol : midCol).getHex(),
        0.72,
        THREE.AdditiveBlending,
        THREE.DoubleSide,
        false,
        null
      );
      const nMesh = new THREE.Mesh(nGeo, nMat);
      nMesh.position.set(
        Math.cos(ang) * dist,
        apertureHeight - needleLen * 0.45,
        Math.sin(ang) * dist
      );
      needlesGroup.add(nMesh);
      needleMats.push(nMat);
    }
    seqGroup.add(needlesGroup);

    // ------------------------------------------------------------------------
    // 5. ELECTRIC ARCS: 5 Helical Beam Lightning Bolts + 4 Ground Radial Arcs
    //    (Optimized to 3 arcs for sub-strikes to reduce per-frame line overhead)
    // ------------------------------------------------------------------------
    const isSubStrike = variant === 'convergence_sub';
    const lightningLines: ActiveOrbitalSequence['lightningLines'] = [];
    const lightningCount = isSubStrike ? 3 : 9;
    for (let a = 0; a < lightningCount; a++) {
      const isGroundArc = a >= (isSubStrike ? 2 : 5);
      const baseAngle = (a / (isGroundArc ? (isSubStrike ? 1 : 4) : (isSubStrike ? 2 : 5))) * Math.PI * 2;
      const pts = this.generateOrbitalArcPoints(beamRadiusBase, radius, isGroundArc, baseAngle, 0);
      const lGeo = new THREE.BufferGeometry().setFromPoints(pts);
      const lMat = new THREE.LineBasicMaterial({
        color: a % 2 === 0 ? 0xffffff : 0xfef08a,
        transparent: true,
        opacity: 0.95,
        blending: THREE.AdditiveBlending
      });
      const line = new THREE.Line(lGeo, lMat);
      seqGroup.add(line);
      lightningLines.push({ line, mat: lMat, isGroundArc, baseAngle });
    }

    // ------------------------------------------------------------------------
    // 6. PHASE THREE: BASE IMPACT FLASH + TRANSIENT POINT LIGHT + SHOCKWAVE
    // ------------------------------------------------------------------------
    const flashRadius = radius * 0.65;
    const flashSegs = isSubStrike ? 8 : 12;
    const impactFlashGeo = this.createTerrainConformingGrid(
      pos.x,
      pos.y,
      flashRadius,
      flashSegs,
      1.1,
      baseElev
    );
    const impactFlashMat = this.acquireShader(
      'orbital_impact_flash',
      () => ({
        transparent: true,
        depthWrite: false,
        side: THREE.DoubleSide,
        blending: THREE.AdditiveBlending,
        uniforms: {
          uTime: { value: 0.0 },
          uIntensity: { value: 1.0 },
          uCoreColor: { value: new THREE.Color(0xffffff) },
          uMidColor: { value: new THREE.Color(0xfacc15) },
          uOuterColor: { value: new THREE.Color(0xea580c) }
        },
        vertexShader: `
          varying vec2 vUv;
          void main() {
            vUv = uv;
            gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
          }
        `,
        fragmentShader: `
          varying vec2 vUv;
          uniform float uTime;
          uniform float uIntensity;
          uniform vec3 uCoreColor;
          uniform vec3 uMidColor;
          uniform vec3 uOuterColor;
          void main() {
            vec2 p = (vUv - 0.5) * 2.0;
            float r = length(p);
            if (r > 1.0) discard;
            float a = atan(p.y, p.x);
            // Intense spiky starburst rays at the base of the beam
            float rays = pow(abs(sin(a * 12.0 + uTime * 8.0)), 3.0) * (1.0 - r);
            float rays2 = pow(abs(cos(a * 7.0 - uTime * 5.0)), 4.0) * (1.0 - r * 0.85);
            float coreBall = pow(max(0.0, 1.0 - r), 2.2) * 1.8;
            float total = coreBall + (rays * 0.75 + rays2 * 0.55) * smoothstep(1.0, 0.1, r);
            vec3 col = mix(uOuterColor, uMidColor, clamp(total * 0.6, 0.0, 1.0));
            col = mix(col, uCoreColor, clamp(coreBall * 0.85, 0.0, 1.0)) * 2.0;
            gl_FragColor = vec4(col, clamp(total * uIntensity, 0.0, 1.0));
          }
        `
      }),
      { uTime: 0.0, uIntensity: 1.0, uCoreColor: coreCol, uMidColor: midCol, uOuterColor: outerCol }
    );
    const impactFlashMesh = new THREE.Mesh(impactFlashGeo, impactFlashMat);
    seqGroup.add(impactFlashMesh);

    // Defined Expanding Shockwave Ring following the ultimate's exact AoE radius
    const waveSegs = isSubStrike ? 8 : 20;
    const shockwaveGeo = this.createTerrainConformingGrid(
      pos.x,
      pos.y,
      radius * 1.05,
      waveSegs,
      0.85,
      baseElev
    );
    const shockwaveMat = this.acquireShader(
      'orbital_shockwave',
      () => ({
        transparent: true,
        depthWrite: false,
        side: THREE.DoubleSide,
        blending: THREE.AdditiveBlending,
        uniforms: {
          uProgress: { value: 0.05 }, // 0 -> 1 as wave expands to AoE radius
          uAlpha: { value: 1.0 },
          uCoreColor: { value: new THREE.Color(0xffffff) },
          uMidColor: { value: new THREE.Color(0xfacc15) },
          uOuterColor: { value: new THREE.Color(0xea580c) }
        },
        vertexShader: `
          varying vec2 vUv;
          void main() {
            vUv = uv;
            gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
          }
        `,
        fragmentShader: `
          varying vec2 vUv;
          uniform float uProgress;
          uniform float uAlpha;
          uniform vec3 uCoreColor;
          uniform vec3 uMidColor;
          uniform vec3 uOuterColor;

          float swHash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
          float swNoise(vec2 p) {
            vec2 i = floor(p); vec2 f = fract(p); f = f * f * (3.0 - 2.0 * f);
            return mix(mix(swHash(i), swHash(i + vec2(1.0, 0.0)), f.x), mix(swHash(i + vec2(0.0, 1.0)), swHash(i + vec2(1.0, 1.0)), f.x), f.y);
          }

          void main() {
            vec2 p = (vUv - 0.5) * 2.0;
            float r = length(p);
            if (r > 1.0) discard;
            float n = swNoise(p * 4.5 + vec2(uProgress * 3.0)) * 0.6 + swNoise(p * 9.0) * 0.4;
            float waveR = clamp(uProgress, 0.08, 0.88) + (n - 0.5) * 0.32;
            float fireFront = exp(-pow((r - waveR) / 0.14, 2.0)) * smoothstep(0.15, 0.85, n);
            float emberWake = smoothstep(waveR - 0.35, waveR, r) * step(r, waveR) * n * 0.45;
            float outerMask = 1.0 - smoothstep(0.65, 1.0, r + (0.5 - n) * 0.3);
            float intensity = (fireFront * 1.45 + emberWake) * outerMask;
            if (intensity < 0.015) discard;
            vec3 col = mix(uOuterColor, uMidColor, clamp(fireFront + emberWake, 0.0, 1.0));
            col = mix(col, uCoreColor, pow(clamp(fireFront, 0.0, 1.0), 1.8) * 0.8);
            gl_FragColor = vec4(col * 1.45, clamp(intensity * uAlpha, 0.0, 1.0));
          }
        `
      }),
      { uProgress: 0.05, uAlpha: 1.0, uCoreColor: coreCol, uMidColor: midCol, uOuterColor: outerCol }
    );
    const shockwaveMesh = new THREE.Mesh(shockwaveGeo, shockwaveMat);
    seqGroup.add(shockwaveMesh);

    // Pooled Dynamic Terrain Illumination (avoids shader recompilation across lit materials)
    this.triggerSharedOrbitalLight(pos, baseElev, lightHex, 8.5, radius * 2.5, beamDuration);
    const pointLight = this.sharedOrbitalLight;

    // ------------------------------------------------------------------------
    // 7. PHASE FOUR: TERRAIN-CONFORMING SCORCHED CRATER & MOLTEN CRACKS DECAL
    // ------------------------------------------------------------------------
    const scorchRadius = radius * 0.96;
    const scorchSegs = isSubStrike ? 8 : 18;
    const scorchGeo = this.createTerrainConformingGrid(
      pos.x,
      pos.y,
      scorchRadius,
      scorchSegs,
      0.32,
      baseElev
    );

    const scorchFragShader = isSubStrike
      ? `
        varying vec2 vUv;
        uniform float uAge;
        uniform float uHeat;
        uniform vec3 uCoreColor;
        uniform vec3 uMidColor;
        uniform vec3 uOuterColor;

        void main() {
          vec2 p = (vUv - 0.5) * 2.0;
          float r = length(p);
          if (r > 1.0) discard;

          float a = atan(p.y, p.x);
          float radFault = abs(sin(a * 7.0 + r * 5.0));
          float crack = smoothstep(0.12, 0.01, radFault) * smoothstep(0.95, 0.15, r) * 0.75;
          float charMask = smoothstep(0.92, 0.15, r);
          vec3 charColor = vec3(0.09, 0.08, 0.075);

          float emberGlow = crack * uHeat;
          vec3 lavaCol = mix(uOuterColor, uMidColor, clamp(emberGlow * 1.2, 0.0, 1.0));
          lavaCol = mix(lavaCol, uCoreColor, pow(emberGlow, 2.2) * (1.0 - r * 0.5)) * (1.8 * uHeat + 0.25);
          float centerMolten = smoothstep(0.42, 0.0, r) * pow(uHeat, 1.5) * 0.9;
          vec3 finalCol = mix(charColor, lavaCol, clamp(emberGlow + centerMolten, 0.0, 1.0));

          float fadeOut = 1.0 - smoothstep(0.68, 1.0, uAge);
          float alpha = clamp((charMask * 0.78 + emberGlow * 0.95 + centerMolten) * fadeOut, 0.0, 0.96);

          gl_FragColor = vec4(finalCol, alpha);
        }
      `
      : `
        varying vec2 vUv;
        uniform float uAge;
        uniform float uHeat;
        uniform vec3 uCoreColor;
        uniform vec3 uMidColor;
        uniform vec3 uOuterColor;

        vec2 hash2(vec2 p) {
          return fract(sin(vec2(dot(p, vec2(127.1, 311.7)), dot(p, vec2(269.5, 183.3)))) * 43758.5453);
        }

        // Voronoi edge distance for sharp polygonal molten rock cracks
        float voronoiCracks(vec2 x) {
          vec2 n = floor(x);
          vec2 f = fract(x);
          vec2 mg, mr;
          float md = 8.0;
          for (int j = -1; j <= 1; j++) {
            for (int i = -1; i <= 1; i++) {
              vec2 g = vec2(float(i), float(j));
              vec2 o = hash2(n + g);
              vec2 r = g + o - f;
              float d = dot(r, r);
              if (d < md) {
                md = d;
                mr = r;
                mg = g;
              }
            }
          }
          md = 8.0;
          for (int j = -1; j <= 1; j++) {
            for (int i = -1; i <= 1; i++) {
              vec2 g = mg + vec2(float(i), float(j));
              vec2 o = hash2(n + g);
              vec2 r = g + o - f;
              if (dot(mr - r, mr - r) > 0.00001) {
                md = min(md, dot(0.5 * (mr + r), normalize(r - mr)));
              }
            }
          }
          return md;
        }

        void main() {
          vec2 p = (vUv - 0.5) * 2.0;
          float r = length(p);
          if (r > 1.0) discard;

          float a = atan(p.y, p.x);

          // Multi-scale Voronoi rock fractures + radial fault lines
          float v1 = voronoiCracks(p * 4.8);
          float v2 = voronoiCracks(p * 9.5 + vec2(3.7, 1.9));
          float radialFault = abs(sin(a * 9.0 + r * 4.5 + v1 * 2.2));

          float crack1 = smoothstep(0.065, 0.008, v1);
          float crack2 = smoothstep(0.05, 0.006, v2) * 0.65;
          float radialCrack = smoothstep(0.12, 0.01, radialFault) * smoothstep(0.95, 0.15, r) * 0.75;

          float crackMask = clamp(max(crack1, max(crack2, radialCrack)), 0.0, 1.0);
          // Fade cracks near the outer perimeter
          crackMask *= smoothstep(0.98, 0.22, r);

          // Dark charred crater soil underneath
          float charMask = smoothstep(0.92, 0.15, r + (v1 - 0.2) * 0.25);
          vec3 charColor = vec3(0.09, 0.08, 0.075);

          // Glowing golden-molten veins that cool over time
          float emberGlow = crackMask * uHeat;
          vec3 lavaCol = mix(uOuterColor, uMidColor, clamp(emberGlow * 1.2, 0.0, 1.0));
          lavaCol = mix(lavaCol, uCoreColor, pow(emberGlow, 2.2) * (1.0 - r * 0.5)) * (1.8 * uHeat + 0.25);

          // Central molten epicenter glow right after impact
          float centerMolten = smoothstep(0.42, 0.0, r) * pow(uHeat, 1.5) * 0.9;
          vec3 finalCol = mix(charColor, lavaCol, clamp(emberGlow + centerMolten, 0.0, 1.0));

          float fadeOut = 1.0 - smoothstep(0.68, 1.0, uAge);
          float alpha = clamp((charMask * 0.78 + emberGlow * 0.95 + centerMolten) * fadeOut, 0.0, 0.96);

          gl_FragColor = vec4(finalCol, alpha);
        }
      `;

    const scorchMat = this.acquireShader(
      isSubStrike ? 'orbital_scorch_sub' : 'orbital_scorch_full',
      () => ({
        transparent: true,
        depthWrite: false,
        side: THREE.DoubleSide,
        uniforms: {
          uAge: { value: 0.0 },        // 0 -> 1 over total 2.6s lifetime
          uHeat: { value: 1.0 },       // 1 -> 0 as molten cracks cool
          uCoreColor: { value: new THREE.Color(0xffffff) },
          uMidColor: { value: new THREE.Color(0xfacc15) },
          uOuterColor: { value: new THREE.Color(0xea580c) }
        },
        vertexShader: `
          varying vec2 vUv;
          void main() {
            vUv = uv;
            gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
          }
        `,
        fragmentShader: scorchFragShader
      }),
      { uAge: 0.0, uHeat: 1.0, uCoreColor: coreCol, uMidColor: midCol, uOuterColor: outerCol }
    );
    const scorchMesh = new THREE.Mesh(scorchGeo, scorchMat);
    // Render scorched decal underneath additive shockwaves and beams
    scorchMesh.renderOrder = -1;
    seqGroup.add(scorchMesh);

    // ------------------------------------------------------------------------
    // 8. SPAWN POOLED SPARKS, TUMBLING ROCK DEBRIS, AND BILLOWING DUST RING
    // ------------------------------------------------------------------------
    this.spawnOrbitalParticles(pos, baseElev, radius, coreCol, midCol, outerCol, isSubStrike);

    this.orbitalSequences.push({
      group: seqGroup,
      pos: { ...pos },
      elevation: baseElev,
      radius,
      elapsed: 0,
      beamDuration,
      totalDuration: 2.65,
      coreMesh,
      coreMat,
      midMesh,
      midMat,
      outerMesh,
      outerMat,
      apertureMesh,
      apertureMat,
      needlesGroup,
      needleMats,
      impactFlashMesh,
      impactFlashMat,
      shockwaveMesh,
      shockwaveMat,
      scorchMesh,
      scorchMat,
      pointLight,
      lightningLines,
      arcJitterTimer: 0
    });
  }

  private generateOrbitalArcPoints(
    beamRadius: number,
    aoeRadius: number,
    isGroundArc: boolean,
    baseAngle: number,
    timeSeed: number
  ): THREE.Vector3[] {
    const pts: THREE.Vector3[] = [];
    if (!isGroundArc) {
      // Helical lightning arc wrapping around the vertical beam column
      const segments = 14;
      const maxH = 250;
      for (let i = 0; i <= segments; i++) {
        const t = i / segments;
        const y = 3 + t * maxH;
        const spiralAngle = baseAngle + t * Math.PI * 3.2 + Math.sin(timeSeed * 15 + i) * 0.45;
        const radialJitter = beamRadius * (1.05 + (Math.random() - 0.35) * 0.95);
        pts.push(
          new THREE.Vector3(
            Math.cos(spiralAngle) * radialJitter,
            y,
            Math.sin(spiralAngle) * radialJitter
          )
        );
      }
    } else {
      // Ground-crawling electric arc branching outward from the beam impact point
      const segments = 9;
      const maxR = aoeRadius * 0.62;
      for (let i = 0; i <= segments; i++) {
        const t = i / segments;
        const r = 6 + t * maxR;
        const ang = baseAngle + (Math.random() - 0.5) * 0.42;
        const y = 2.0 + (1.0 - t) * 14.0 * Math.random();
        pts.push(new THREE.Vector3(Math.cos(ang) * r, y, Math.sin(ang) * r));
      }
    }
    return pts;
  }

  private spawnOrbitalParticles(
    pos: Vector2,
    baseElev: number,
    radius: number,
    coreCol: THREE.Color,
    midCol: THREE.Color,
    outerCol: THREE.Color,
    isSubStrike: boolean = false
  ): void {
    // Cap total active orbital particles to keep frame times ultra-fast
    while (this.orbitalParticles.length > 220) {
      const oldest = this.orbitalParticles.shift();
      if (oldest) {
        this.group.remove(oldest.mesh);
        (oldest.mesh.material as THREE.Material).dispose();
      }
    }

    const sparkCount = isSubStrike ? 6 : 32;
    const debrisCount = isSubStrike ? 4 : 18;
    const dustCount = isSubStrike ? 4 : 20;

    // 1. Concentrated Burst of Golden Sparks (32 particles base, 6 for sub-strike)
    for (let i = 0; i < sparkCount; i++) {
      const ang = Math.random() * Math.PI * 2;
      const speed = 95 + Math.random() * 240;
      const vy = 85 + Math.random() * 220;
      const mat = this.acquireBasicMat(
        (i % 3 === 0 ? coreCol : i % 2 === 0 ? midCol : outerCol).getHex(),
        0.98,
        THREE.AdditiveBlending,
        THREE.FrontSide,
        true,
        null
      );
      const mesh = new THREE.Mesh(this.sharedSparkGeo, mat);
      const startR = 6 + Math.random() * 24;
      mesh.position.set(
        pos.x + Math.cos(ang) * startR,
        baseElev + 4 + Math.random() * 14,
        pos.y + Math.sin(ang) * startR
      );
      const scale = 1.4 + Math.random() * 2.2;
      mesh.scale.set(scale * 0.6, scale * 2.4, scale * 0.6);
      this.group.add(mesh);

      const life = 0.45 + Math.random() * 0.55;
      this.orbitalParticles.push({
        mesh,
        kind: 'spark',
        vx: Math.cos(ang) * speed,
        vy,
        vz: Math.sin(ang) * speed,
        rotSpeedX: (Math.random() - 0.5) * 12,
        rotSpeedY: (Math.random() - 0.5) * 12,
        rotSpeedZ: (Math.random() - 0.5) * 12,
        baseScale: scale,
        endScale: 0.2,
        lifetime: life,
        maxLifetime: life,
        groundY: baseElev + 1.5
      });
    }

    // 2. Scattered Dark Rock Debris Chunks (18 ballistic chunks base, 4 for sub-strike)
    for (let i = 0; i < debrisCount; i++) {
      const ang = (i / debrisCount) * Math.PI * 2 + (Math.random() - 0.5) * 0.35;
      const speed = 75 + Math.random() * 195;
      const vy = 105 + Math.random() * 185;
      // Dark charred rock with warm golden-amber under-lit rim tint
      const rockColor = i % 3 === 0 ? 0x3f362e : i % 2 === 0 ? 0x292524 : 0x1c1917;
      const mat = this.acquireBasicMat(rockColor, 0.96, THREE.NormalBlending, THREE.FrontSide, true, null);
      const mesh = new THREE.Mesh(this.sharedDebrisGeo, mat);
      const startR = 12 + Math.random() * 34;
      mesh.position.set(
        pos.x + Math.cos(ang) * startR,
        baseElev + 5 + Math.random() * 12,
        pos.y + Math.sin(ang) * startR
      );
      const scale = 2.4 + Math.random() * 3.8;
      mesh.scale.set(scale, scale * (0.65 + Math.random() * 0.6), scale * 0.85);
      this.group.add(mesh);

      const life = 0.65 + Math.random() * 0.65;
      this.orbitalParticles.push({
        mesh,
        kind: 'debris',
        vx: Math.cos(ang) * speed,
        vy,
        vz: Math.sin(ang) * speed,
        rotSpeedX: (Math.random() - 0.5) * 14,
        rotSpeedY: (Math.random() - 0.5) * 14,
        rotSpeedZ: (Math.random() - 0.5) * 14,
        baseScale: scale,
        endScale: scale * 0.5,
        lifetime: life,
        maxLifetime: life,
        groundY: baseElev + 2.0
      });
    }

    // 3. Expanding Ring of Warm-Lit Dust & Smoke Plumes (20 puffs base, 4 for sub-strike)
    for (let i = 0; i < dustCount; i++) {
      const ang = (i / dustCount) * Math.PI * 2 + (Math.random() - 0.5) * 0.22;
      const speed = (radius * 0.55) + Math.random() * (radius * 0.45);
      const mat = this.acquireBasicMat(
        i % 2 === 0 ? 0xd6c7b2 : 0xfbbf24,
        0.52,
        THREE.NormalBlending,
        THREE.DoubleSide,
        false,
        this.dustRadialTex || null
      );
      const mesh = new THREE.Mesh(this.sharedDustGeo, mat);
      const startR = 18 + Math.random() * 28;
      mesh.position.set(
        pos.x + Math.cos(ang) * startR,
        baseElev + 8 + Math.random() * 8,
        pos.y + Math.sin(ang) * startR
      );
      const baseScale = 22 + Math.random() * 18;
      mesh.scale.set(baseScale, baseScale * 0.75, 1);
      this.group.add(mesh);

      const life = 0.75 + Math.random() * 0.55;
      this.orbitalParticles.push({
        mesh,
        kind: 'dust',
        vx: Math.cos(ang) * speed,
        vy: 14 + Math.random() * 18,
        vz: Math.sin(ang) * speed,
        rotSpeedX: 0,
        rotSpeedY: 0,
        rotSpeedZ: (Math.random() - 0.5) * 1.8,
        baseScale,
        endScale: baseScale * 2.35,
        lifetime: life,
        maxLifetime: life,
        groundY: baseElev + 4.0
      });
    }
  }

  private disposeOrbitalSequence(seq: ActiveOrbitalSequence): void {
    this.group.remove(seq.group);
    seq.coreMesh.geometry.dispose();
    this.releaseMaterial(seq.coreMat);
    seq.midMesh.geometry.dispose();
    this.releaseMaterial(seq.midMat);
    seq.outerMesh.geometry.dispose();
    this.releaseMaterial(seq.outerMat);
    seq.apertureMesh.geometry.dispose();
    this.releaseMaterial(seq.apertureMat);
    seq.needlesGroup.traverse((child) => {
      if ((child as THREE.Mesh).isMesh) {
        const m = child as THREE.Mesh;
        m.geometry.dispose();
        this.releaseMaterial(m.material as THREE.Material);
      }
    });
    seq.impactFlashMesh.geometry.dispose();
    this.releaseMaterial(seq.impactFlashMat);
    seq.shockwaveMesh.geometry.dispose();
    this.releaseMaterial(seq.shockwaveMat);
    seq.scorchMesh.geometry.dispose();
    this.releaseMaterial(seq.scorchMat);
    for (let i = 0; i < seq.lightningLines.length; i++) {
      seq.lightningLines[i].line.geometry.dispose();
      seq.lightningLines[i].mat.dispose();
    }
  }

  // Spawn transient bioluminescent alien ichor splatter puddle on the battlefield (organic noise-eroded edge)
  public spawnAlienBloodSplatter(
    pos: Vector2,
    elevation: number = 0,
    colorHex: number = 0xe11d48,
    scaleMult: number = 1.0
  ): void {
    if (this.bloodDecals.length > 48) {
      const oldest = this.bloodDecals.shift();
      if (oldest) {
        this.group.remove(oldest.mesh);
        if (!oldest.mesh.userData?.isSharedGeo) oldest.mesh.geometry.dispose();
        this.releaseMaterial(oldest.mesh.material as THREE.Material);
      }
    }

    const scale = (0.85 + Math.random() * 0.75) * scaleMult;
    const mat = this.createSplatterDropletShader(
      _tmpCol1.setHex(colorHex).lerp(THREE_WHITE, 0.25).getHex(),
      colorHex,
      Math.random() * 80
    );

    const mesh = new THREE.Mesh(this.sharedUnitPlaneGeo, mat);
    mesh.userData.isSharedGeo = true;
    mesh.rotation.x = -Math.PI / 2;
    mesh.rotation.z = Math.random() * Math.PI * 2;
    mesh.position.set(pos.x + (Math.random() - 0.5) * 14, elevation + 0.5, pos.y + (Math.random() - 0.5) * 14);
    mesh.scale.set(34 * scale, 34 * scale, 1);
    this.group.add(mesh);

    this.bloodDecals.push({
      mesh,
      lifetime: 5.5,
      maxLifetime: 5.5
    });
  }

  // 1. Landing Frost & Soil Vapor Gust on Ground (zero geometric RingGeometry)
  public spawnLandingRing(pos: Vector2, elevation: number = 0): void {
    this.spawnShockwaveRing(pos, 42, 0x67e8f9, elevation + 0.5, 0.35);
  }

  // Heavy thawed-earth dust & frost puff for Stage 1 Titan footsteps
  public spawnTitanFootstepPuff(pos: Vector2, elevation: number = 0): void {
    const baseElev = this.getTerrainHeight(pos.x, pos.y, elevation);
    this.spawnLandingRing(pos, baseElev);

    while (this.orbitalParticles.length > 220) {
      const oldest = this.orbitalParticles.shift();
      if (oldest) {
        this.group.remove(oldest.mesh);
        this.releaseMaterial(oldest.mesh.material as THREE.Material);
      }
    }

    const puffCount = 8;
    for (let i = 0; i < puffCount; i++) {
      const ang = (i / puffCount) * Math.PI * 2 + (Math.random() - 0.5) * 0.35;
      const speed = 38 + Math.random() * 44;
      const mat = this.acquireBasicMat(
        i % 2 === 0 ? 0xcbd5e1 : 0x7dd3fc,
        0.45,
        THREE.NormalBlending,
        THREE.DoubleSide,
        false,
        this.dustRadialTex || null
      );
      const mesh = new THREE.Mesh(this.sharedDustGeo, mat);
      mesh.userData.isSharedGeo = true;
      const startR = 26 + Math.random() * 26;
      mesh.position.set(
        pos.x + Math.cos(ang) * startR,
        baseElev + 7 + Math.random() * 6,
        pos.y + Math.sin(ang) * startR
      );
      const baseScale = 18 + Math.random() * 14;
      mesh.scale.set(baseScale, baseScale * 0.7, 1);
      this.group.add(mesh);

      const life = 0.5 + Math.random() * 0.35;
      this.orbitalParticles.push({
        mesh,
        kind: 'dust',
        vx: Math.cos(ang) * speed,
        vy: 10 + Math.random() * 14,
        vz: Math.sin(ang) * speed,
        rotSpeedX: 0,
        rotSpeedY: 0,
        rotSpeedZ: (Math.random() - 0.5) * 1.5,
        baseScale,
        endScale: baseScale * 2.1,
        lifetime: life,
        maxLifetime: life,
        groundY: baseElev + 3
      });
    }
  }

  /** Red Crystal radial fracture glow & jagged splinter beams before boss eruption */
  public spawnCrystalFractureFX(origin: { x: number; y: number; z: number }): void {
    const baseElev = origin.z;
    this.spawnShockwaveRing({ x: origin.x, y: origin.y }, 135, 0xf43f5e, baseElev, 0.75);

    const crackGeo = this.createJaggedShardGeo(2.4, 48, 5, 11);
    for (let i = 0; i < 10; i++) {
      const yaw = (i / 10) * Math.PI * 2 + (Math.random() - 0.5) * 0.25;
      const pitch = -0.45 + Math.random() * 0.9;
      const mat = new THREE.MeshBasicMaterial({
        color: i % 2 === 0 ? 0xfb7185 : 0xfef08a,
        transparent: true,
        opacity: 0.92,
        blending: THREE.AdditiveBlending
      });
      const beam = new THREE.Mesh(crackGeo, mat);
      beam.position.set(
        origin.x + Math.cos(yaw) * (24 + Math.random() * 34),
        baseElev + (Math.random() - 0.35) * 65,
        origin.y + Math.sin(yaw) * (24 + Math.random() * 34)
      );
      beam.rotation.set(pitch, yaw, (Math.random() - 0.5) * 0.9);
      this.group.add(beam);
      this.beams.push({
        mesh: beam,
        lifetime: 0.85,
        maxLifetime: 0.85
      });
    }
  }

  /** Shattering translucent ruby crystal shards + rock chunks + dust burst along emergence vector */
  public spawnCrystalShatterBurst(
    origin: { x: number; y: number; z: number },
    forwardDir: { x: number; y: number }
  ): void {
    const fLen = Math.hypot(forwardDir.x, forwardDir.y) || 1;
    const fx = forwardDir.x / fLen;
    const fy = forwardDir.y / fLen;
    const groundElev = this.getTerrainHeight(origin.x + fx * 180, origin.y + fy * 180, origin.z - 160);

    this.spawnRealisticExplosion({ x: origin.x, y: origin.y }, origin.z, 190, 'void', origin.z);

    while (this.orbitalParticles.length > 210) {
      const oldest = this.orbitalParticles.shift();
      if (oldest) {
        this.group.remove(oldest.mesh);
        if (!oldest.mesh.userData?.isSharedGeo) oldest.mesh.geometry.dispose();
        (oldest.mesh.material as THREE.Material).dispose();
      }
    }

    const shardGeo = this.createJaggedShardGeo(1.0, 2.2, 5, 7);
    // 22 translucent ruby crystal shards + 12 dark slate rock chunks
    for (let i = 0; i < 34; i++) {
      const isShard = i < 22;
      const spreadAngle = (Math.random() - 0.5) * 1.55;
      const dirX = fx * Math.cos(spreadAngle) - fy * Math.sin(spreadAngle);
      const dirY = fx * Math.sin(spreadAngle) + fy * Math.cos(spreadAngle);
      const speed = isShard ? 180 + Math.random() * 240 : 120 + Math.random() * 170;

      const mat = new THREE.MeshBasicMaterial({
        color: isShard ? (i % 3 === 0 ? 0xfda4af : 0xe11d48) : 0x475569,
        transparent: true,
        opacity: isShard ? 0.88 : 0.95
      });
      const mesh = new THREE.Mesh(isShard ? shardGeo : this.sharedDebrisGeo, mat);
      const s = isShard ? 6 + Math.random() * 11 : 7 + Math.random() * 10;
      mesh.scale.set(s * 0.65, s * (isShard ? 1.4 : 1.0), s * 0.65);
      mesh.position.set(
        origin.x + (Math.random() - 0.5) * 75 + fx * 25,
        origin.z + (Math.random() - 0.35) * 85,
        origin.y + (Math.random() - 0.5) * 75 + fy * 25
      );
      this.group.add(mesh);

      const life = 1.0 + Math.random() * 0.75;
      this.orbitalParticles.push({
        mesh,
        kind: 'debris',
        vx: dirX * speed,
        vy: 110 + Math.random() * 210,
        vz: dirY * speed,
        rotSpeedX: (Math.random() - 0.5) * 9,
        rotSpeedY: (Math.random() - 0.5) * 9,
        rotSpeedZ: (Math.random() - 0.5) * 9,
        baseScale: s,
        endScale: s,
        lifetime: life,
        maxLifetime: life,
        groundY: groundElev + 4
      });
    }

    // Crimson & rock-dust shock cloud around shattered facade
    for (let i = 0; i < 10; i++) {
      const ang = (i / 10) * Math.PI * 2 + (Math.random() - 0.5) * 0.4;
      const matParams: THREE.MeshBasicMaterialParameters = {
        color: i % 2 === 0 ? 0xfda4af : 0x94a3b8,
        transparent: true,
        opacity: 0.48,
        depthWrite: false,
        side: THREE.DoubleSide
      };
      if (this.dustRadialTex) matParams.map = this.dustRadialTex;
      const mesh = new THREE.Mesh(this.sharedDustGeo, new THREE.MeshBasicMaterial(matParams));
      mesh.position.set(
        origin.x + fx * 30 + Math.cos(ang) * 45,
        origin.z - 20 + Math.random() * 45,
        origin.y + fy * 30 + Math.sin(ang) * 45
      );
      const baseScale = 28 + Math.random() * 18;
      mesh.scale.set(baseScale, baseScale * 0.75, 1);
      this.group.add(mesh);
      const life = 0.65 + Math.random() * 0.35;
      this.orbitalParticles.push({
        mesh,
        kind: 'dust',
        vx: fx * 90 + Math.cos(ang) * 65,
        vy: 18 + Math.random() * 26,
        vz: fy * 90 + Math.sin(ang) * 65,
        rotSpeedX: 0,
        rotSpeedY: 0,
        rotSpeedZ: (Math.random() - 0.5) * 1.4,
        baseScale,
        endScale: baseScale * 2.2,
        lifetime: life,
        maxLifetime: life,
        groundY: groundElev + 2
      });
    }
  }

  /** Trailing crystal splinters and dust during boss diagonal crystal emergence */
  public spawnCrystalEmergeTrail(pos: Vector2, z: number): void {
    const baseElev = this.getTerrainHeight(pos.x, pos.y, z - 40);
    const shardGeo = this.createJaggedShardGeo(1.0, 2.0, 5, 19);
    for (let i = 0; i < 5; i++) {
      const isShard = i < 3;
      const ang = Math.random() * Math.PI * 2;
      const speed = 45 + Math.random() * 85;
      const mat = new THREE.MeshBasicMaterial({
        color: isShard ? 0xe11d48 : 0x64748b,
        transparent: true,
        opacity: isShard ? 0.85 : 0.9
      });
      const mesh = new THREE.Mesh(isShard ? shardGeo : this.sharedDebrisGeo, mat);
      const s = isShard ? 4.5 + Math.random() * 6 : 5 + Math.random() * 6;
      mesh.scale.set(s * 0.65, s * 1.4, s * 0.65);
      mesh.position.set(
        pos.x + (Math.random() - 0.5) * 65,
        z + 18 + Math.random() * 45,
        pos.y + (Math.random() - 0.5) * 65
      );
      this.group.add(mesh);
      const life = 0.6 + Math.random() * 0.45;
      this.orbitalParticles.push({
        mesh,
        kind: 'debris',
        vx: Math.cos(ang) * speed,
        vy: 60 + Math.random() * 90,
        vz: Math.sin(ang) * speed,
        rotSpeedX: (Math.random() - 0.5) * 8,
        rotSpeedY: (Math.random() - 0.5) * 8,
        rotSpeedZ: (Math.random() - 0.5) * 8,
        baseScale: s,
        endScale: s,
        lifetime: life,
        maxLifetime: life,
        groundY: baseElev + 3
      });
    }
  }

  /** Clear locked-direction attack telegraph for Void Goliath (0.6s), Brood Queen (0.8s), and Void Wasp (0.3s) */
  public spawnEnemyAttackTelegraph(
    origin: Vector2,
    originZ: number,
    aimDir: { x: number; y: number; z?: number },
    variant: string,
    duration: number
  ): void {
    const colorHex =
      variant === 'seismic_shard'
        ? 0xf97316
        : variant === 'spore_bomb'
          ? 0xd946ef
          : variant === 'stinger'
            ? 0xf43f5e
            : 0xc084fc;
    const baseElev = this.getTerrainHeight(origin.x, origin.y, originZ - 36);
    const ringRadius = variant === 'seismic_shard' ? 68 : variant === 'stinger' || variant === 'spore_bomb' ? 86 : 44;
    this.spawnShockwaveRing(origin, ringRadius, colorHex, baseElev + 1.5, duration);

    const len = Math.hypot(aimDir.x, aimDir.y);
    if (len < 1) return;
    const baseAng = Math.atan2(aimDir.y, aimDir.x);

    if (variant === 'spore_bomb') {
      const tx = origin.x + aimDir.x;
      const ty = origin.y + aimDir.y;
      const targetRefZ = originZ + (aimDir.z ?? 0);
      const tElev = this.getTerrainHeight(tx, ty, targetRefZ);
      this.spawnShockwaveRing({ x: tx, y: ty }, 86, 0xd946ef, tElev + 1.5, duration);
      return;
    }

    const lineOffsets = variant === 'stinger' ? [-0.38, 0.38] : [0];
    const lineLen = variant === 'stinger' ? 320 : variant === 'seismic_shard' ? 280 : 210;
    const len3D = Math.hypot(aimDir.x, aimDir.y, aimDir.z ?? 0) || 1;
    const dzPerUnit = (aimDir.z ?? 0) / len3D;
    for (let i = 0; i < lineOffsets.length; i++) {
      const ang = baseAng + lineOffsets[i];
      const dx = Math.cos(ang);
      const dy = Math.sin(ang);
      const guideGeo = this.createOrganicPlumeColumnGeo(1.1, 1.8, lineLen, 6, 8, 0.35, 1.5);
      guideGeo.rotateX(Math.PI / 2);
      const guideMat = new THREE.MeshBasicMaterial({
        color: colorHex,
        transparent: true,
        opacity: 0.42,
        blending: THREE.AdditiveBlending,
        side: THREE.DoubleSide
      });
      const guideMesh = new THREE.Mesh(guideGeo, guideMat);
      const startY = Math.max(baseElev + 14, originZ);
      const endX = origin.x + dx * lineLen;
      const endY = startY + dzPerUnit * lineLen;
      const endZ = origin.y + dy * lineLen;
      guideMesh.position.set(
        (origin.x + endX) * 0.5,
        (startY + endY) * 0.5,
        (origin.y + endZ) * 0.5
      );
      guideMesh.lookAt(endX, endY, endZ);
      this.group.add(guideMesh);
      this.beams.push({
        mesh: guideMesh,
        lifetime: duration,
        maxLifetime: duration
      });
    }
  }

  // 2c. Pre-fire Focusing Charge Telegraph (0.2s charge before Hyper-Laser blast)
  public spawnLaserCharge(from: Vector2, to: Vector2, elevation: number = 0, duration: number = 0.20): void {
    const dx = to.x - from.x;
    const dy = to.y - from.y;
    const length = Math.hypot(dx, dy) || 1;
    const midX = (from.x + to.x) / 2;
    const midZ = (from.y + to.y) / 2;
    const beamY = elevation + 18;
    const angle = Math.atan2(dx, dy);

    const guideGeo = this.createOrganicPlumeColumnGeo(1.1, 1.1, length, 6, 6, 0.35, 1.2);
    guideGeo.rotateX(Math.PI / 2);
    const guideMat = new THREE.MeshBasicMaterial({
      color: 0xe879f9,
      transparent: true,
      opacity: 0.65,
      blending: THREE.AdditiveBlending,
      side: THREE.DoubleSide
    });
    const guideMesh = new THREE.Mesh(guideGeo, guideMat);
    guideMesh.position.set(midX, beamY, midZ);
    guideMesh.rotation.y = angle;
    this.group.add(guideMesh);

    this.beams.push({
      mesh: guideMesh,
      lifetime: duration,
      maxLifetime: duration
    });

    this.spawnShockwaveRing(from, 30, 0xd946ef, elevation + 12, duration);
  }

  // 2c. Horizontal Piercing Hyper-Laser Beam with Turbulent Plasma Filaments (zero cylinders)
  public spawnLaserBeam(from: Vector2, to: Vector2, elevation: number = 0): void {
    const dx = to.x - from.x;
    const dy = to.y - from.y;
    const length = Math.hypot(dx, dy) || 1;
    const midX = (from.x + to.x) / 2;
    const midZ = (from.y + to.y) / 2;
    const beamY = elevation + 18;
    const angle = Math.atan2(dx, dy);

    const outerGeo = this.createOrganicPlumeColumnGeo(10.5, 6.5, length, 10, 10, 0.28, 1.8);
    outerGeo.rotateX(Math.PI / 2);
    const outerMat = new THREE.MeshBasicMaterial({
      color: 0xd946ef,
      transparent: true,
      opacity: 0.65,
      blending: THREE.AdditiveBlending,
      side: THREE.DoubleSide
    });
    const outerMesh = new THREE.Mesh(outerGeo, outerMat);
    outerMesh.position.set(midX, beamY, midZ);
    outerMesh.rotation.y = angle;
    this.group.add(outerMesh);

    const midSheathGeo = this.createOrganicPlumeColumnGeo(5.5, 4.0, length, 8, 10, 0.22, -1.6);
    midSheathGeo.rotateX(Math.PI / 2);
    const midSheathMat = new THREE.MeshBasicMaterial({
      color: 0xa855f7,
      transparent: true,
      opacity: 0.85,
      blending: THREE.AdditiveBlending,
      side: THREE.DoubleSide
    });
    const midSheathMesh = new THREE.Mesh(midSheathGeo, midSheathMat);
    midSheathMesh.position.set(midX, beamY, midZ);
    midSheathMesh.rotation.y = angle;
    this.group.add(midSheathMesh);

    const corePts = this.generateLightningPoints(
      new THREE.Vector3(from.x, beamY, from.y),
      new THREE.Vector3(to.x, beamY, to.y),
      18,
      7.5
    );
    const coreRibbonGeo = this.createJaggedRibbonGeometry(corePts, 7.2);
    const coreMat = new THREE.MeshBasicMaterial({
      color: 0xffffff,
      transparent: true,
      opacity: 0.98,
      blending: THREE.AdditiveBlending,
      side: THREE.DoubleSide,
      depthWrite: false
    });
    const coreMesh = new THREE.Mesh(coreRibbonGeo, coreMat);
    this.group.add(coreMesh);

    const trailGeo = this.createJaggedRibbonGeometry(corePts, 14.0);
    const trailMat = new THREE.MeshBasicMaterial({
      color: 0xf0abfc,
      transparent: true,
      opacity: 0.55,
      blending: THREE.AdditiveBlending,
      side: THREE.DoubleSide,
      depthWrite: false
    });
    const trailMesh = new THREE.Mesh(trailGeo, trailMat);
    this.group.add(trailMesh);

    this.beams.push({ mesh: outerMesh, lifetime: 0.42, maxLifetime: 0.42 });
    this.beams.push({ mesh: midSheathMesh, lifetime: 0.36, maxLifetime: 0.36 });
    this.beams.push({ mesh: coreMesh, lifetime: 0.28, maxLifetime: 0.28 });
    this.beams.push({ mesh: trailMesh, lifetime: 0.65, maxLifetime: 0.65 });

    this.spawnShockwaveRing(from, 38, 0xe879f9, elevation + 12, 0.26);
    this.spawnRealisticExplosion(to, elevation, 58, 'void', elevation + 14);
  }

  // 2d. Turbulent Scatter Blast Flame Muzzle Plume (zero cone)
  public spawnScatterBlast(from: Vector2, to: Vector2, elevation: number = 0): void {
    const dx = to.x - from.x;
    const dy = to.y - from.y;
    const angle = Math.atan2(dx, dy);

    const fanGeo = new THREE.PlaneGeometry(82, 86);
    fanGeo.rotateX(-Math.PI / 2);
    const fanMat = this.createExplosionPuffShader(0xfffbeb, 0xf97316, 0x9a3412, Math.random() * 50, true);
    fanMat.uniforms.uProgress.value = 0.12;
    const fanMesh = new THREE.Mesh(fanGeo, fanMat);
    fanMesh.position.set(
      from.x + Math.sin(angle) * 38,
      elevation + 18,
      from.y + Math.cos(angle) * 38
    );
    fanMesh.rotation.y = angle;
    this.group.add(fanMesh);

    this.beams.push({
      mesh: fanMesh,
      lifetime: 0.20,
      maxLifetime: 0.20
    });
  }

  // 2e. Phase Blink Warp Portal & Arrival Rift Clouds (zero cylinder)
  public spawnBlinkVFX(
    from: Vector2,
    fromZ: number,
    to: Vector2,
    toZ: number,
    radius: number = 95
  ): void {
    this.spawnShockwaveRing(from, 52, 0x38bdf8, fromZ, 0.32);
    this.spawnRealisticExplosion(to, toZ, Math.max(75, radius * 0.85), 'void', toZ + 12);

    const riftGeo = this.createOrganicPlumeColumnGeo(10, 26, 130, 12, 6, 0.34, 1.4);
    const riftMat = new THREE.MeshBasicMaterial({
      color: 0xc084fc,
      transparent: true,
      opacity: 0.72,
      side: THREE.DoubleSide,
      blending: THREE.AdditiveBlending,
      depthWrite: false
    });
    const riftMesh = new THREE.Mesh(riftGeo, riftMat);
    riftMesh.position.set(to.x, toZ + 65, to.y);
    this.group.add(riftMesh);

    this.beams.push({
      mesh: riftMesh,
      lifetime: 0.28,
      maxLifetime: 0.28
    });
  }

  // ============================================================================
  // PROCEDURAL VFX GEOMETRY & LIGHTNING HELPERS
  // ============================================================================

  public createCrescentBladeGeometry(
    innerRadius: number,
    width: number,
    angleSpan: number = 2.4,
    segments: number = 32
  ): THREE.BufferGeometry {
    const geo = new THREE.BufferGeometry();
    const positions: number[] = [];
    const uvs: number[] = [];
    const indices: number[] = [];

    const halfSpan = angleSpan / 2;
    for (let i = 0; i <= segments; i++) {
      const t = i / segments;
      const angle = -halfSpan + t * angleSpan;
      // Envelope tapers to 0 at ends so both tips are razor-sharp
      const envelope = Math.cos((angle / halfSpan) * (Math.PI / 2));
      const curWidth = Math.max(0, width * envelope);
      const rIn = innerRadius;
      const rOut = innerRadius + curWidth;

      const cosA = Math.cos(angle);
      const sinA = Math.sin(angle);

      // Inner vertex
      positions.push(cosA * rIn, 0, sinA * rIn);
      uvs.push(0, t);

      // Outer vertex
      positions.push(cosA * rOut, 0, sinA * rOut);
      uvs.push(1, t);

      if (i < segments) {
        const v0 = i * 2;
        const v1 = i * 2 + 1;
        const v2 = (i + 1) * 2;
        const v3 = (i + 1) * 2 + 1;
        indices.push(v0, v1, v2);
        indices.push(v2, v1, v3);
      }
    }

    geo.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
    geo.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
    geo.setIndex(indices);
    geo.computeVertexNormals();
    return geo;
  }

  public generateLightningPoints(
    from: THREE.Vector3,
    to: THREE.Vector3,
    segments: number = 26,
    maxOffset: number = 22
  ): THREE.Vector3[] {
    const points: THREE.Vector3[] = [];
    const dir = new THREE.Vector3().subVectors(to, from);
    const length = dir.length();
    if (length < 1) {
      points.push(from.clone(), to.clone());
      return points;
    }
    dir.normalize();

    const up = new THREE.Vector3(0, 1, 0);
    let perp1 = new THREE.Vector3().crossVectors(dir, up).normalize();
    if (perp1.lengthSq() < 0.01) {
      perp1 = new THREE.Vector3(1, 0, 0);
    }
    const perp2 = new THREE.Vector3().crossVectors(dir, perp1).normalize();

    points.push(from.clone());

    for (let i = 1; i < segments; i++) {
      const t = i / segments;
      const basePt = new THREE.Vector3().lerpVectors(from, to, t);
      // Bell-curve envelope: largest deviation in the middle, 0 at endpoints
      const envelope = Math.pow(Math.sin(t * Math.PI), 0.85);
      const offset1 = (Math.random() - 0.5) * 2 * maxOffset * envelope;
      const offset2 = (Math.random() - 0.5) * 2 * (maxOffset * 0.65) * envelope;

      basePt.addScaledVector(perp1, offset1);
      basePt.addScaledVector(perp2, offset2);
      points.push(basePt);
    }

    points.push(to.clone());
    return points;
  }

  public createJaggedRibbonGeometry(points: THREE.Vector3[], width: number = 7.5): THREE.BufferGeometry {
    const geo = new THREE.BufferGeometry();
    const positions: number[] = [];
    const uvs: number[] = [];
    const indices: number[] = [];

    const up = new THREE.Vector3(0, 1, 0);

    for (let i = 0; i < points.length; i++) {
      const pt = points[i];
      const dir = new THREE.Vector3();
      if (i < points.length - 1) {
        dir.subVectors(points[i + 1], pt).normalize();
      } else {
        dir.subVectors(pt, points[i - 1]).normalize();
      }

      let perp = new THREE.Vector3().crossVectors(dir, up).normalize();
      if (perp.lengthSq() < 0.01) {
        perp.set(1, 0, 0);
      }

      const t = i / (points.length - 1);
      const envelope = Math.pow(Math.sin(t * Math.PI), 0.7);
      const halfW = width * envelope * 0.5;

      // Left vertex
      positions.push(pt.x - perp.x * halfW, pt.y - perp.y * halfW, pt.z - perp.z * halfW);
      uvs.push(0, t);

      // Right vertex
      positions.push(pt.x + perp.x * halfW, pt.y + perp.y * halfW, pt.z + perp.z * halfW);
      uvs.push(1, t);

      if (i < points.length - 1) {
        const v0 = i * 2;
        const v1 = i * 2 + 1;
        const v2 = (i + 1) * 2;
        const v3 = (i + 1) * 2 + 1;
        indices.push(v0, v1, v2);
        indices.push(v2, v1, v3);
      }
    }

    geo.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
    geo.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
    geo.setIndex(indices);
    geo.computeVertexNormals();
    return geo;
  }

  public updateJaggedRibbonGeometry(geo: THREE.BufferGeometry, points: THREE.Vector3[], width: number = 7.5): void {
    const posAttr = geo.getAttribute('position') as THREE.BufferAttribute;
    if (!posAttr || posAttr.count !== points.length * 2) return;

    const up = new THREE.Vector3(0, 1, 0);
    const dir = new THREE.Vector3();
    const perp = new THREE.Vector3();
    let idx = 0;

    for (let i = 0; i < points.length; i++) {
      const pt = points[i];
      if (i < points.length - 1) {
        dir.subVectors(points[i + 1], pt).normalize();
      } else {
        dir.subVectors(pt, points[i - 1]).normalize();
      }

      perp.crossVectors(dir, up).normalize();
      if (perp.lengthSq() < 0.01) {
        perp.set(1, 0, 0);
      }

      const t = i / (points.length - 1);
      const envelope = Math.pow(Math.sin(t * Math.PI), 0.7);
      const halfW = width * envelope * 0.5;

      posAttr.setXYZ(idx++, pt.x - perp.x * halfW, pt.y - perp.y * halfW, pt.z - perp.z * halfW);
      posAttr.setXYZ(idx++, pt.x + perp.x * halfW, pt.y + perp.y * halfW, pt.z + perp.z * halfW);
    }
    posAttr.needsUpdate = true;
  }

  public generateBranchPoints(
    start: THREE.Vector3,
    mainDir: THREE.Vector3,
    branchLength: number = 55,
    segments: number = 5
  ): THREE.Vector3[] {
    const points: THREE.Vector3[] = [start.clone()];
    const sideAngle = (Math.random() > 0.5 ? 1 : -1) * (0.65 + Math.random() * 0.55);
    const cosA = Math.cos(sideAngle);
    const sinA = Math.sin(sideAngle);

    // Lateral direction rotated in horizontal plane
    const branchDir = new THREE.Vector3(
      mainDir.x * cosA - mainDir.z * sinA,
      (Math.random() - 0.5) * 0.5,
      mainDir.x * sinA + mainDir.z * cosA
    ).normalize();

    let cur = start.clone();
    const segLen = branchLength / segments;
    for (let s = 1; s <= segments; s++) {
      const next = cur.clone().addScaledVector(branchDir, segLen);
      next.x += (Math.random() - 0.5) * 14;
      next.y += (Math.random() - 0.5) * 8;
      next.z += (Math.random() - 0.5) * 14;
      points.push(next);
      cur = next;
    }
    return points;
  }

  // --- COMMANDER LMB UPGRADE 1: CHILL BEAM VFX (STREAM OF TRAVELING ICY BOLTS) ---
  public spawnChillBeam(from: Vector2, to: Vector2, elevation: number = 0, boltCount: number = 1): void {
    const from3 = new THREE.Vector3(from.x, elevation, from.y);
    const toElev = this.getTerrainHeight(to.x, to.y, elevation);
    const to3 = new THREE.Vector3(to.x, toElev + 46, to.y);
    const dx = to3.x - from3.x;
    const dy = to3.y - from3.y;
    const dz = to3.z - from3.z;
    const totalDist = Math.hypot(dx, dy, dz) || 1;
    const dir = new THREE.Vector3(dx / totalDist, dy / totalDist, dz / totalDist);

    const group = new THREE.Group();
    this.group.add(group);

    // Muzzle blast rings at firing position (2x scale)
    this.spawnShockwaveRing(from, 56, 0x38bdf8, elevation, 0.20);
    this.spawnShockwaveRing(from, 84, 0x00e5ff, elevation, 0.25);

    // Rapid sequence of separate, distinct traveling icy projectiles with visible gaps (1 + extraProjectiles)
    const bolts: ChillProjectileBolt[] = [];
    const count = Math.max(1, boltCount);

    for (let i = 0; i < count; i++) {
      const bGrp = new THREE.Group();
      bGrp.scale.setScalar(2.0);
      bGrp.visible = false;
      group.add(bGrp);

      // Irregular carved icy shard core (zero octahedron/cone)
      const coreGeo = this.createJaggedShardGeo(2.8, 18.0, 5, 3 + i * 7);
      coreGeo.rotateX(Math.PI / 2);
      coreGeo.translate(0, 0, -9);
      const coreMat = new THREE.MeshBasicMaterial({
        color: 0xf0fdfa,
        transparent: true,
        opacity: 0.98,
        blending: THREE.AdditiveBlending
      });
      const coreMesh = new THREE.Mesh(coreGeo, coreMat);
      bGrp.add(coreMesh);

      // Cyan outer frost aura flame sheath
      const sheathGeo = this.createOrganicPlumeColumnGeo(3.6, 0.8, 22, 8, 5, 0.32, 1.4);
      sheathGeo.rotateX(Math.PI / 2);
      const sheathMat = new THREE.MeshBasicMaterial({
        color: 0x00e5ff,
        transparent: true,
        opacity: 0.72,
        blending: THREE.AdditiveBlending,
        side: THREE.DoubleSide,
        depthWrite: false
      });
      const sheathMesh = new THREE.Mesh(sheathGeo, sheathMat);
      bGrp.add(sheathMesh);

      // Tapered icy-blue turbulent trailing ribbon
      const trailGeo = this.createOrganicPlumeColumnGeo(0.5, 3.8, 24, 6, 5, 0.35, -1.0);
      trailGeo.rotateX(Math.PI / 2);
      trailGeo.translate(0, 0, -14);
      const trailMat = new THREE.MeshBasicMaterial({
        color: 0x38bdf8,
        transparent: true,
        opacity: 0.65,
        blending: THREE.AdditiveBlending,
        side: THREE.DoubleSide,
        depthWrite: false
      });
      const trailMesh = new THREE.Mesh(trailGeo, trailMat);
      bGrp.add(trailMesh);

      // Orient projectile group along flight vector
      bGrp.quaternion.setFromUnitVectors(new THREE.Vector3(0, 0, 1), dir);

      bolts.push({
        group: bGrp,
        coreMesh,
        sheathMesh,
        trailMesh,
        coreMat,
        sheathMat,
        trailMat,
        spawnDelay: i * 0.055, // 55ms gap between projectiles creates distinct ~50 units distance gap
        hasSpawned: false,
        hasImpacted: false,
        progress: 0
      });
    }

    this.activeChillBeams.push({
      group,
      bolts,
      elapsed: 0,
      maxLifetime: Math.max(0.60, 0.35 + count * 0.055),
      from: from3,
      to: to3,
      dir,
      totalDist,
      elevation,
      toElevation: toElev
    });
  }

  // --- COMMANDER LMB UPGRADE 2: PIERCING ELECTRIC LASER VFX (TRUE CRACKLING LIGHTNING BOLT) ---
  public spawnPiercingElectricLaser(
    from: Vector2,
    to: Vector2,
    elevation: number = 0,
    branches: Array<{ from: Vector2; fromZ: number; to: Vector2; toZ: number }> = [],
    toElevation?: number
  ): void {
    const from3 = new THREE.Vector3(from.x, elevation, from.y);
    const to3 = new THREE.Vector3(to.x, toElevation !== undefined ? toElevation : elevation, to.y);
    const dir = new THREE.Vector3().subVectors(to3, from3).normalize();
    const length = from3.distanceTo(to3);

    const group = new THREE.Group();
    this.group.add(group);

    // 1. Blinding White Electric Core Line with High-Frequency Jagged Displacement
    const corePts = this.generateLightningPoints(from3, to3, 26, 36);
    const coreGeo = new THREE.BufferGeometry().setFromPoints(corePts);
    const coreMat = new THREE.LineBasicMaterial({
      color: 0xffffff,
      transparent: true,
      opacity: 1.0,
      blending: THREE.AdditiveBlending
    });
    const coreLine = new THREE.Line(coreGeo, coreMat);
    group.add(coreLine);

    // 2. Multi-line Violet & Hot Magenta Electric Corona Glow Lines
    const glowColors = [0xc084fc, 0xd946ef, 0xa855f7];
    const glowLines: THREE.Line[] = [];
    for (let g = 0; g < 3; g++) {
      const glowPts = this.generateLightningPoints(from3, to3, 24, 42);
      const gGeo = new THREE.BufferGeometry().setFromPoints(glowPts);
      const gMat = new THREE.LineBasicMaterial({
        color: glowColors[g],
        transparent: true,
        opacity: 0.88,
        blending: THREE.AdditiveBlending
      });
      const gLine = new THREE.Line(gGeo, gMat);
      group.add(gLine);
      glowLines.push(gLine);
    }

    // 3. Volumetric Jagged Electric Ribbon following the jagged lightning path (2x scale)
    const ribbonGeo = this.createJaggedRibbonGeometry(corePts, 16.0);
    const ribbonMat = new THREE.MeshBasicMaterial({
      color: 0xa855f7,
      transparent: true,
      opacity: 0.48,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
      side: THREE.DoubleSide
    });
    const ribbonMesh = new THREE.Mesh(ribbonGeo, ribbonMat);
    group.add(ribbonMesh);

    // 4. Branching Electric Lightning Forks arcing laterally into the air
    const branchLines: THREE.Line[] = [];
    const branchCount = Math.min(8, Math.max(4, Math.floor(length / 95)));
    for (let b = 0; b < branchCount; b++) {
      const nodeIdx = Math.floor(3 + (b / branchCount) * (corePts.length - 6));
      const branchOrigin = corePts[Math.min(nodeIdx, corePts.length - 1)];
      const bPts = this.generateBranchPoints(branchOrigin, dir, 85 + Math.random() * 75, 5);
      const bGeo = new THREE.BufferGeometry().setFromPoints(bPts);
      const bMat = new THREE.LineBasicMaterial({
        color: b % 2 === 0 ? 0xd946ef : 0xc084fc,
        transparent: true,
        opacity: 0.82,
        blending: THREE.AdditiveBlending
      });
      const bLine = new THREE.Line(bGeo, bMat);
      group.add(bLine);
      branchLines.push(bLine);
    }

    // 4b. Targeted Lightning Branches extending outward to non-targeted enemies (+1 Projectile stacks)
    const targetedBranches: TargetedElectricBranch[] = [];
    if (branches && branches.length > 0) {
      for (let br = 0; br < branches.length; br++) {
        const b = branches[br];
        const bFrom3 = new THREE.Vector3(b.from.x, b.fromZ, b.from.y);
        const bTo3 = new THREE.Vector3(b.to.x, b.toZ, b.to.y);

        // Blinding white core line for distinct lightning branch
        const bCorePts = this.generateLightningPoints(bFrom3, bTo3, 16, 14);
        const bGeo = new THREE.BufferGeometry().setFromPoints(bCorePts);
        const bMat = new THREE.LineBasicMaterial({
          color: 0xffffff,
          transparent: true,
          opacity: 1.0,
          blending: THREE.AdditiveBlending
        });
        const bLine = new THREE.Line(bGeo, bMat);
        group.add(bLine);

        // Vivid magenta/violet corona glow line
        const bGlowPts = this.generateLightningPoints(bFrom3, bTo3, 14, 18);
        const bGlowGeo = new THREE.BufferGeometry().setFromPoints(bGlowPts);
        const bGlowMat = new THREE.LineBasicMaterial({
          color: 0xd946ef,
          transparent: true,
          opacity: 0.88,
          blending: THREE.AdditiveBlending
        });
        const bGlowLine = new THREE.Line(bGlowGeo, bGlowMat);
        group.add(bGlowLine);

        // Volumetric 3D Jagged Electric Ribbon for Branch (Guarantees high visibility in 3D WebGL)
        const bRibbonGeo = this.createJaggedRibbonGeometry(bCorePts, 6.0);
        const bRibbonMat = new THREE.MeshBasicMaterial({
          color: 0xd946ef,
          transparent: true,
          opacity: 0.72,
          blending: THREE.AdditiveBlending,
          depthWrite: false,
          side: THREE.DoubleSide
        });
        const bRibbonMesh = new THREE.Mesh(bRibbonGeo, bRibbonMat);
        group.add(bRibbonMesh);

        targetedBranches.push({
          coreLine: bLine,
          glowLine: bGlowLine,
          ribbonMesh: bRibbonMesh,
          from: bFrom3,
          to: bTo3
        });

        // Distinct electric impact sparks & shockwave ring at branch target
        this.spawnBlasterImpactSpark(b.to, 26);
        this.spawnShockwaveRing(b.to, 32, 0xc084fc, b.toZ - 12, 0.22);
      }
    }

    // 5. Electric Hand Emitter Nova Rings & Piercing Shockwaves
    this.spawnShockwaveRing(from, 28, 0xd946ef, elevation + 14, 0.22);
    this.spawnShockwaveRing(from, 52, 0xc084fc, elevation + 14, 0.28);
    this.spawnShockwaveRing(to, 58, 0xa855f7, elevation + 14, 0.32);

    // 6. Erupt 24 Electric Sparks along the entire bolt
    const sparkCount = Math.min(24, Math.floor(length / 28));
    for (let s = 0; s < sparkCount; s++) {
      const t = (s + 0.5) / sparkCount;
      const sparkPos = new THREE.Vector3().lerpVectors(from3, to3, t);
      sparkPos.x += (Math.random() - 0.5) * 24;
      sparkPos.y += (Math.random() - 0.5) * 16;
      sparkPos.z += (Math.random() - 0.5) * 24;
      const m = new THREE.Mesh(this.sharedSparkGeo, new THREE.MeshBasicMaterial({
        color: s % 2 === 0 ? 0xffffff : 0xd946ef,
        transparent: true,
        opacity: 0.95,
        blending: THREE.AdditiveBlending
      }));
      m.position.copy(sparkPos);
      m.scale.setScalar(2.2 + Math.random() * 1.5);
      this.group.add(m);
      this.orbitalParticles.push({
        mesh: m,
        kind: 'spark',
        vx: (Math.random() - 0.5) * 160,
        vy: 40 + Math.random() * 140,
        vz: (Math.random() - 0.5) * 160,
        rotSpeedX: Math.random() * 8,
        rotSpeedY: Math.random() * 8,
        rotSpeedZ: 0,
        baseScale: 2.5,
        endScale: 0.2,
        lifetime: 0.28,
        maxLifetime: 0.28,
        groundY: elevation
      });
    }

    this.activeElectricBolts.push({
      group,
      coreLine,
      glowLines,
      branchLines,
      targetedBranches,
      ribbonMesh,
      jitterTimer: 0,
      elapsed: 0,
      maxLifetime: 0.24,
      from: from3,
      to: to3
    });
  }

  // --- COMMANDER LMB UPGRADE 3: EXTENDED SLASH VFX (RAZOR-TAPERED GOLDEN ENERGY BLADE) ---
  public spawnExtendedSlash(
    pos: Vector2,
    elevation: number,
    angle: number,
    step: number = 1,
    range: number = 340,
    slashCount: number = 1
  ): void {
    const count = Math.max(1, slashCount);
    for (let k = 0; k < count; k++) {
      const delay = k * 75; // 75ms gap between consecutive slashes
      const forwardDist = k * 20;
      const kPos = {
        x: pos.x + Math.cos(angle) * forwardDist,
        y: pos.y + Math.sin(angle) * forwardDist
      };
      const kStep = ((step - 1 + k) % 3) + 1;

      if (k === 0) {
        this.spawnSingleExtendedSlash(kPos, elevation, angle, kStep, range);
      } else {
        setTimeout(() => {
          this.spawnSingleExtendedSlash(kPos, elevation, angle, kStep, range);
        }, delay);
      }
    }
  }

  private spawnSingleExtendedSlash(
    pos: Vector2,
    elevation: number,
    angle: number,
    step: number = 1,
    range: number = 340
  ): void {
    const group = new THREE.Group();
    group.position.set(pos.x, elevation + 2.5, pos.y);
    group.rotation.y = Math.PI / 2 - angle;
    this.group.add(group);

    // Razor-tapered curved crescent blade geometry (2x scale)
    const innerRadius = range * 0.70;
    const bladeWidth = 125;
    const angleSpan = 2.4; // ~137 degrees
    const slashGeo = this.createCrescentBladeGeometry(innerRadius, bladeWidth, angleSpan, 32);

    const mainColor = step === 3 ? 0xf97316 : (step === 2 ? 0xf59e0b : 0xfbbf24);
    const slashMat = new THREE.MeshBasicMaterial({
      color: mainColor,
      transparent: true,
      opacity: 0.92,
      side: THREE.DoubleSide,
      blending: THREE.AdditiveBlending
    });
    const slashMesh = new THREE.Mesh(slashGeo, slashMat);
    group.add(slashMesh);

    // Razor-sharp brilliant white-gold core streak
    const coreGeo = this.createCrescentBladeGeometry(innerRadius + 24, 46, angleSpan * 0.85, 28);
    const coreMat = new THREE.MeshBasicMaterial({
      color: 0xfffbeb,
      transparent: true,
      opacity: 0.98,
      side: THREE.DoubleSide,
      blending: THREE.AdditiveBlending
    });
    const coreMesh = new THREE.Mesh(coreGeo, coreMat);
    coreMesh.position.y = 0.2;
    group.add(coreMesh);

    // Trailing golden ember motes along the crescent arc
    for (let s = 0; s < 14; s++) {
      const sparkAngle = (Math.random() - 0.5) * angleSpan * 0.8;
      const sparkDist = innerRadius + Math.random() * bladeWidth;
      const worldRot = (Math.PI / 2 - angle);
      const localX = Math.cos(sparkAngle) * sparkDist;
      const localZ = Math.sin(sparkAngle) * sparkDist;
      const wx = pos.x + localX * Math.cos(worldRot) + localZ * Math.sin(worldRot);
      const wz = pos.y - localX * Math.sin(worldRot) + localZ * Math.cos(worldRot);

      const m = new THREE.Mesh(this.sharedSparkGeo, new THREE.MeshBasicMaterial({
        color: s % 2 === 0 ? 0xfffbeb : 0xfbbf24,
        transparent: true,
        opacity: 0.92,
        blending: THREE.AdditiveBlending
      }));
      m.position.set(wx, elevation + 4.0, wz);
      m.scale.setScalar(2.4);
      this.group.add(m);
      this.orbitalParticles.push({
        mesh: m,
        kind: 'spark',
        vx: (Math.random() - 0.5) * 80 - Math.cos(angle) * 40,
        vy: 30 + Math.random() * 80,
        vz: (Math.random() - 0.5) * 80 - Math.sin(angle) * 40,
        rotSpeedX: Math.random() * 6,
        rotSpeedY: Math.random() * 6,
        rotSpeedZ: 0,
        baseScale: 2.4,
        endScale: 0.2,
        lifetime: 0.26,
        maxLifetime: 0.26,
        groundY: elevation
      });
    }

    this.activeSlashArcs.push({
      group,
      slashMesh,
      slashMat,
      coreMesh,
      coreMat,
      elapsed: 0,
      maxLifetime: 0.22,
      startScale: 0.85,
      targetScale: 1.15
    });
  }

  // --- COMMANDER RMB UPGRADE 1: SCISSOR SLASH VFX (VISIBLE CLOSING BLADES & GOLDEN STARBURST) ---
  public spawnScissorSlash(
    pos: Vector2,
    elevation: number,
    angle: number,
    focusPos: Vector2,
    radius: number = 125,
    totalSlashes: number = 1
  ): void {
    const baseElev = this.getTerrainHeight(focusPos.x, focusPos.y, elevation);
    const group = new THREE.Group();
    // Position at chest/waist height and tilt group towards isometric camera (2x scale)
    group.position.set(pos.x, baseElev + 36.0, pos.y);
    group.rotation.order = 'YXZ';
    group.rotation.y = Math.PI / 2 - angle;
    group.rotation.x = -0.38; // 22-degree tilt directly towards gameplay camera
    this.group.add(group);

    // Left and Right scissor blade groups
    const leftBladeGroup = new THREE.Group();
    const rightBladeGroup = new THREE.Group();
    group.add(leftBladeGroup);
    group.add(rightBladeGroup);

    // Large razor-sharp golden curved energy blade geometry (2x scale)
    const innerR = radius * 0.48;
    const bladeW = 90;
    const angleSpan = 2.4;
    const bladeGeo = this.createCrescentBladeGeometry(innerR, bladeW, angleSpan, 32);
    const coreGeo = this.createCrescentBladeGeometry(innerR + 20, 38, angleSpan * 0.88, 28);

    const leftSlashMat = new THREE.MeshBasicMaterial({
      color: 0xf59e0b,
      transparent: true,
      opacity: 0.95,
      side: THREE.DoubleSide,
      blending: THREE.AdditiveBlending
    });
    const leftCoreMat = new THREE.MeshBasicMaterial({
      color: 0xfffbeb,
      transparent: true,
      opacity: 0.98,
      side: THREE.DoubleSide,
      blending: THREE.AdditiveBlending
    });
    const leftBladeMesh = new THREE.Mesh(bladeGeo, leftSlashMat);
    const leftCoreMesh = new THREE.Mesh(coreGeo, leftCoreMat);
    leftCoreMesh.position.y = 0.2;
    leftBladeGroup.add(leftBladeMesh);
    leftBladeGroup.add(leftCoreMesh);

    const rightSlashMat = new THREE.MeshBasicMaterial({
      color: 0xf59e0b,
      transparent: true,
      opacity: 0.95,
      side: THREE.DoubleSide,
      blending: THREE.AdditiveBlending
    });
    const rightCoreMat = new THREE.MeshBasicMaterial({
      color: 0xfffbeb,
      transparent: true,
      opacity: 0.98,
      side: THREE.DoubleSide,
      blending: THREE.AdditiveBlending
    });
    const rightBladeMesh = new THREE.Mesh(bladeGeo, rightSlashMat);
    const rightCoreMesh = new THREE.Mesh(coreGeo, rightCoreMat);
    rightCoreMesh.position.y = 0.2;
    rightBladeGroup.add(rightBladeMesh);
    rightBladeGroup.add(rightCoreMesh);

    // Starting positions: wide open on left and right flanks (2x scale)
    const forwardDist = 140;
    leftBladeGroup.position.set(-115, 0, forwardDist * 0.35);
    leftBladeGroup.rotation.y = -0.95; // open outward

    rightBladeGroup.position.set(115, 0, forwardDist * 0.35);
    rightBladeGroup.rotation.y = 0.95; // open outward

    // Central starburst flash plane (hidden initially until blades meet)
    const burstSize = Math.min(250, radius * 1.05);
    const flashGeo = new THREE.PlaneGeometry(burstSize, burstSize);
    flashGeo.rotateX(-Math.PI * 0.35); // Tilted towards isometric camera
    const flashMat = this.acquireShader(
      'slash_convergence_flash',
      () => ({
        transparent: true,
        depthWrite: false,
        blending: THREE.AdditiveBlending,
        side: THREE.DoubleSide,
        uniforms: {
          uProgress: { value: 0.0 }
        },
        vertexShader: `
          varying vec2 vUv;
          void main() {
            vUv = uv * 2.0 - 1.0;
            gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
          }
        `,
        fragmentShader: `
          uniform float uProgress;
          varying vec2 vUv;
          void main() {
            float r = length(vUv);
            if (r > 1.0) discard;
            float a = atan(vUv.y, vUv.x);
            float crossSpikes = pow(abs(cos(a * 2.0)), 10.0) * smoothstep(1.0, 0.05, r);
            float minorSpikes = pow(abs(sin(a * 4.0)), 12.0) * smoothstep(0.75, 0.05, r);
            float core = smoothstep(0.38 * (1.0 - uProgress * 0.5), 0.0, r);
            float wispNoise = sin(a * 5.0 + r * 8.0 - uProgress * 6.0) * 0.5 + 0.5;
            float emberGlow = smoothstep(0.75, 0.15, r) * wispNoise * 0.48;
            float fade = pow(1.0 - uProgress, 1.35);
            float alpha = clamp((core + crossSpikes * 0.95 + minorSpikes * 0.6 + emberGlow) * fade, 0.0, 1.0);
            if (alpha < 0.01) discard;
            vec3 col = mix(vec3(0.98, 0.58, 0.10), vec3(1.0, 0.98, 0.85), core + crossSpikes * 0.5);
            gl_FragColor = vec4(col, alpha);
          }
        `
      }),
      { uProgress: 0.0 }
    );
    const flashMesh = new THREE.Mesh(flashGeo, flashMat);
    flashMesh.position.set(0, 1.0, forwardDist);
    flashMesh.visible = false;
    group.add(flashMesh);

    // Empty compression lines for interface compatibility
    const compGeo = new THREE.BufferGeometry();
    const compressionMat = new THREE.LineBasicMaterial({ visible: false });
    const compressionLines = new THREE.LineSegments(compGeo, compressionMat);
    group.add(compressionLines);

    const count = Math.max(1, totalSlashes);
    this.slashConvergences.push({
      group,
      flashMesh,
      flashMat,
      leftBladeMesh,
      leftBladeMat: leftSlashMat,
      rightBladeMesh,
      rightBladeMat: rightSlashMat,
      compressionLines,
      compressionMat,
      elapsed: 0,
      maxLifetime: 0.22 * count + 0.16,
      isScissorSweep: true,
      leftBladeGroup,
      rightBladeGroup,
      leftCoreMesh,
      leftCoreMat,
      rightCoreMesh,
      rightCoreMat,
      pos,
      focusPos,
      angle,
      elevation: baseElev,
      radius,
      sweepDuration: 0.22,
      hasCollided: false,
      totalSlashes: count,
      currentSlashIndex: 0
    });
  }

  // --- COMMANDER RMB UPGRADE 2: FROST BURST VFX (360-DEGREE RADIAL ICE EXPLOSION) ---
  public spawnFrostBurst(
    pos: Vector2,
    elevation: number,
    radius: number = 210,
    extraEruptions: number = 0,
    spikePositions: Array<{ pos: Vector2; delay: number }> = []
  ): void {
    const baseElev = this.getTerrainHeight(pos.x, pos.y, elevation);

    // 1. Instantaneous Freezing Mist Gusts centered on Commander (zero geometric ring)
    this.spawnRealisticExplosion(pos, baseElev, Math.max(95, radius * 0.85), 'cryo', baseElev + 12);

    // 2. Ring of 16 Asymmetric Carved Ice Shards erupting outward radially
    const spikeCount = 16;
    for (let c = 0; c < spikeCount; c++) {
      const cAngle = (c / spikeCount) * Math.PI * 2 + (Math.random() - 0.5) * 0.2;
      const cDist = 45 + Math.random() * (radius * 0.65);
      const cx = pos.x + Math.cos(cAngle) * cDist;
      const cz = pos.y + Math.sin(cAngle) * cDist;
      const cHeight = this.getTerrainHeight(cx, cz, elevation);

      const crystalGeo = this.createJaggedShardGeo(10.0 + Math.random() * 8.0, 56 + Math.random() * 24, 5, 100 + c);
      const crystalMat = new THREE.MeshBasicMaterial({
        color: c % 2 === 0 ? 0x38bdf8 : 0x00e5ff,
        transparent: true,
        opacity: 0.90,
        blending: THREE.AdditiveBlending
      });
      const crystalMesh = new THREE.Mesh(crystalGeo, crystalMat);
      crystalMesh.position.set(cx, cHeight - 2, cz);
      // Tilt spike radially outward from center
      const tiltAngle = 0.35 + Math.random() * 0.25;
      crystalMesh.rotation.set(
        Math.sin(cAngle) * tiltAngle,
        cAngle,
        -Math.cos(cAngle) * tiltAngle
      );
      this.group.add(crystalMesh);
      this.activeGroundSpikes.push({
        mesh: crystalMesh,
        mat: crystalMat,
        elapsed: 0,
        maxLifetime: 0.50,
        baseScaleY: 1.0,
        targetScaleY: 1.0
      });
    }

    // 3. 24 Radial Frost Fragments & Tumbling Ice Shards bursting outward in all directions
    for (let s = 0; s < 24; s++) {
      const sAngle = (s / 24) * Math.PI * 2 + (Math.random() - 0.5) * 0.3;
      const spd = 160 + Math.random() * 180;
      const m = new THREE.Mesh(this.sharedSparkGeo, new THREE.MeshBasicMaterial({
        color: s % 3 === 0 ? 0xffffff : (s % 3 === 1 ? 0x00e5ff : 0x7dd3fc),
        transparent: true,
        opacity: 0.95,
        blending: THREE.AdditiveBlending
      }));
      m.position.set(pos.x, baseElev + 10, pos.y);
      m.scale.setScalar(2.4 + Math.random() * 1.4);
      this.group.add(m);
      this.orbitalParticles.push({
        mesh: m,
        kind: 'spark',
        vx: Math.cos(sAngle) * spd,
        vy: 45 + Math.random() * 95,
        vz: Math.sin(sAngle) * spd,
        rotSpeedX: Math.random() * 8,
        rotSpeedY: Math.random() * 8,
        rotSpeedZ: Math.random() * 8,
        baseScale: 2.8,
        endScale: 0.2,
        lifetime: 0.36,
        maxLifetime: 0.36,
        groundY: baseElev
      });
    }

    // 4. Ground-level Icy Mist Cloud expanding in 360 degrees
    for (let d = 0; d < 12; d++) {
      const dAngle = (d / 12) * Math.PI * 2;
      const dSpeed = 90 + Math.random() * 80;
      const matParams: THREE.MeshBasicMaterialParameters = {
        color: 0xbae6fd,
        transparent: true,
        opacity: 0.40,
        depthWrite: false,
        blending: THREE.AdditiveBlending
      };
      if (this.dustRadialTex) matParams.map = this.dustRadialTex;
      const dustMat = new THREE.MeshBasicMaterial(matParams);
      const dustMesh = new THREE.Mesh(this.sharedDustGeo, dustMat);
      dustMesh.position.set(pos.x, baseElev + 6, pos.y);
      this.group.add(dustMesh);
      this.orbitalParticles.push({
        mesh: dustMesh,
        kind: 'dust',
        vx: Math.cos(dAngle) * dSpeed,
        vy: 10 + Math.random() * 20,
        vz: Math.sin(dAngle) * dSpeed,
        rotSpeedX: 0,
        rotSpeedY: (Math.random() - 0.5) * 2,
        rotSpeedZ: 0,
        baseScale: 34,
        endScale: 72,
        lifetime: 0.42,
        maxLifetime: 0.42,
        groundY: baseElev
      });
    }

    // 5. Additional Ice-Spike Eruptions distributed around cast position (+1 Projectile stacks)
    if (spikePositions && spikePositions.length > 0) {
      for (let ep = 0; ep < spikePositions.length; ep++) {
        const item = spikePositions[ep];
        setTimeout(() => {
          const subElev = this.getTerrainHeight(item.pos.x, item.pos.y, elevation);
          this.spawnShockwaveRing(item.pos, 104, 0x00e5ff, subElev + 1.2, 0.26);
          this.spawnShockwaveRing(item.pos, 64, 0xf0fdfa, subElev + 1.6, 0.20);
          for (let sp = 0; sp < 6; sp++) {
            const spAng = (sp / 6) * Math.PI * 2 + (Math.random() - 0.5) * 0.3;
            const spDist = 24 + Math.random() * 32;
            const spX = item.pos.x + Math.cos(spAng) * spDist;
            const spZ = item.pos.y + Math.sin(spAng) * spDist;
            const spH = this.getTerrainHeight(spX, spZ, elevation);
            const spireGeo = this.createJaggedShardGeo(8.5, 42, 5, 200 + sp);
            const spireMat = new THREE.MeshBasicMaterial({
              color: sp % 2 === 0 ? 0x38bdf8 : 0x00e5ff,
              transparent: true,
              opacity: 0.90,
              blending: THREE.AdditiveBlending
            });
            const spireMesh = new THREE.Mesh(spireGeo, spireMat);
            spireMesh.position.set(spX, spH - 2, spZ);
            this.group.add(spireMesh);
            this.activeGroundSpikes.push({
              mesh: spireMesh,
              mat: spireMat,
              elapsed: 0,
              maxLifetime: 0.45,
              baseScaleY: 1.0,
              targetScaleY: 1.0
            });
          }
        }, Math.round(item.delay * 1000));
      }
    }
  }

  // --- COMMANDER DASH UPGRADE 3: TELEPORT PORTALS VFX (ORGANIC VOID WISPS & RIFT SURGE) ---
  public spawnTeleportPortals(from: Vector2, fromZ: number, to: Vector2, toZ: number, radius: number = 190): void {
    // 1. Origin Dematerialization Rift Gust
    this.spawnShockwaveRing(from, 95, 0xa855f7, fromZ + 0.5, 0.32);

    // Origin Rising Arcane Flame Sparks (zero box geometry)
    for (let r = 0; r < 10; r++) {
      const rAngle = Math.random() * Math.PI * 2;
      const rDist = Math.random() * 48;
      const wispMat = new THREE.MeshBasicMaterial({
        color: r % 2 === 0 ? 0xf3e8ff : 0xc084fc,
        transparent: true,
        opacity: 0.92,
        blending: THREE.AdditiveBlending,
        side: THREE.DoubleSide
      });
      const wispMesh = new THREE.Mesh(this.sharedSparkGeo, wispMat);
      wispMesh.userData.isSharedGeo = true;
      wispMesh.scale.setScalar(4.0);
      wispMesh.position.set(from.x + Math.cos(rAngle) * rDist, fromZ + 12, from.y + Math.sin(rAngle) * rDist);
      this.group.add(wispMesh);
      this.orbitalParticles.push({
        mesh: wispMesh,
        kind: 'spark',
        vx: (Math.random() - 0.5) * 50,
        vy: 160 + Math.random() * 160,
        vz: (Math.random() - 0.5) * 50,
        rotSpeedX: Math.random() * 6,
        rotSpeedY: Math.random() * 6,
        rotSpeedZ: Math.random() * 6,
        baseScale: 4.0,
        endScale: 0.4,
        lifetime: 0.32,
        maxLifetime: 0.32,
        groundY: fromZ
      });
    }

    // 2. Destination Spatial Rematerialization Explosion Cloud & Energy Rift Column (zero cylinder)
    this.spawnRealisticExplosion(to, toZ, Math.max(95, radius * 0.72), 'void', toZ + 14);

    const riftGeo = this.createOrganicPlumeColumnGeo(12, 46, 260, 14, 8, 0.36, 1.5);
    const riftMat = new THREE.MeshBasicMaterial({
      color: 0xc084fc,
      transparent: true,
      opacity: 0.68,
      side: THREE.DoubleSide,
      blending: THREE.AdditiveBlending,
      depthWrite: false
    });
    const pillar = new THREE.Mesh(riftGeo, riftMat);
    pillar.position.set(to.x, toZ + 130, to.y);
    this.group.add(pillar);
    this.beams.push({ mesh: pillar, lifetime: 0.30, maxLifetime: 0.30 });

    // 3. Destination Sharp Radial Purple Energy Shock Spikes
    const spikeGeo = new THREE.BufferGeometry();
    const spikePts: number[] = [];
    const spikeCount = 8;
    for (let s = 0; s < spikeCount; s++) {
      const sa = (s / spikeCount) * Math.PI * 2;
      const sLen = radius * 1.05;
      spikePts.push(to.x, toZ + 2.0, to.y);
      spikePts.push(to.x + Math.cos(sa) * sLen, toZ + 2.0, to.y + Math.sin(sa) * sLen);
    }
    spikeGeo.setAttribute('position', new THREE.Float32BufferAttribute(spikePts, 3));
    const spikeMat = new THREE.LineBasicMaterial({
      color: 0xf3e8ff,
      transparent: true,
      opacity: 0.95,
      blending: THREE.AdditiveBlending
    });
    const spikeLines = new THREE.LineSegments(spikeGeo, spikeMat);
    this.group.add(spikeLines);
    setTimeout(() => {
      this.group.remove(spikeLines);
      spikeGeo.dispose();
      spikeMat.dispose();
    }, 280);
  }

  // 2b. Turbulent Shock-Gust Ripple Wave (zero geometric RingGeometry)
  public spawnShockwaveRing(
    pos: Vector2,
    maxRadius: number,
    colorHex: number = 0x38bdf8,
    elevation: number = 0,
    duration: number = 0.55
  ): void {
    if (!pos || typeof pos.x !== 'number' || typeof pos.y !== 'number') return;
    const mat = this.createOrganicRippleShader(colorHex, undefined, Math.random() * 40);
    const mesh = new THREE.Mesh(this.sharedUnitPlaneGeo, mat);
    mesh.userData.isSharedGeo = true;
    mesh.scale.set(2.2, 2.2, 1);
    mesh.rotation.x = -Math.PI / 2;
    mesh.position.set(pos.x, elevation + 0.9, pos.y);
    this.group.add(mesh);

    this.rings.push({
      mesh,
      maxRadius,
      currentRadius: 4,
      lifetime: duration,
      maxLifetime: duration
    });
  }

  // 3. Floating 3D Damage Text
  public spawnDamageNumber(
    pos: Vector2,
    amount: number,
    color: string = '#ffffff',
    elevation: number = 0,
    isCrit: boolean = false
  ): void {
    const rounded = Math.round(amount);
    const cacheKey = `${isCrit ? 'c' : 'n'}:${color}:${rounded}`;
    let texture = this.damageTexCache.get(cacheKey);
    if (!texture) {
      const canvas = document.createElement('canvas');
      canvas.width = 160;
      canvas.height = 80;
      const ctx = canvas.getContext('2d');
      if (ctx) {
        ctx.font = isCrit ? '900 44px "Orbitron", sans-serif' : 'bold 34px "Orbitron", sans-serif';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.lineWidth = isCrit ? 6 : 4;
        ctx.strokeStyle = 'rgba(0,0,0,0.9)';
        const text = isCrit ? `${rounded}!` : `${rounded}`;
        ctx.strokeText(text, 80, 40);
        ctx.fillStyle = color;
        ctx.fillText(text, 80, 40);
      }

      texture = new THREE.CanvasTexture(canvas);
      if (this.damageTexCache.size >= 512) {
        const firstKey = this.damageTexCache.keys().next().value;
        if (firstKey !== undefined) {
          const oldestTex = this.damageTexCache.get(firstKey);
          this.damageTexCache.delete(firstKey);
          oldestTex?.dispose();
        }
      }
      this.damageTexCache.set(cacheKey, texture);
    }

    let sprite = this.damageSpritePool.pop();
    if (sprite) {
      const sm = sprite.material as THREE.SpriteMaterial;
      sm.map = texture;
      sm.opacity = 1.0;
    } else {
      const mat = new THREE.SpriteMaterial({
        map: texture,
        transparent: true,
        depthTest: false
      });
      sprite = new THREE.Sprite(mat);
      sprite.userData.isPooledDamageSprite = true;
      sprite.userData.isSharedMat = true;
    }
    const scaleX = isCrit ? 52 : 34;
    const scaleY = isCrit ? 26 : 17;
    sprite.scale.set(scaleX, scaleY, 1);
    sprite.position.set(pos.x, elevation + 68, pos.y);
    this.group.add(sprite);

    this.damageTexts.push({
      sprite,
      vy: isCrit ? 64 : 52,
      lifetime: isCrit ? 0.95 : 0.7,
      maxLifetime: isCrit ? 0.95 : 0.7
    });
  }

  // 4. Dash Afterimage Ghost (2x hero sprite scale)
  public spawnDashGhost(pos: Vector2, mapTexture: THREE.Texture, elevation: number = 0): void {
    const mat = this.acquireBasicMat(0xffffff, 0.5, THREE.NormalBlending, THREE.FrontSide, false, mapTexture);
    const mesh = new THREE.Mesh(this.sharedUnitPlaneGeo, mat);
    mesh.userData.isSharedGeo = true;
    mesh.scale.set(104, 104, 1);
    mesh.position.set(pos.x, elevation + 52, pos.y);
    this.group.add(mesh);

    this.ghosts.push({
      mesh,
      lifetime: 0.25,
      maxLifetime: 0.25
    });
  }

  // 4B. Doctor Therapeutic Pass Crisp White Silhouette Afterimage Ghost
  public spawnWhiteSilhouetteGhost(
    pos: Vector2,
    mapTexture: THREE.Texture,
    elevation: number = 0,
    uvRect: { ox: number; oy: number; rx: number; ry: number } = { ox: 0, oy: 0, rx: 1, ry: 1 },
    duration: number = 0.34,
    initialOpacity: number = 0.72
  ): void {
    if (this.whiteGhosts.length >= 24) {
      const oldest = this.whiteGhosts.shift();
      if (oldest) {
        this.group.remove(oldest.mesh);
        if (!oldest.mesh.userData?.isSharedGeo) oldest.mesh.geometry.dispose();
        this.releaseMaterial(oldest.mat);
      }
    }

    const mat = this.acquireShader(
      'white_silhouette_ghost',
      () => ({
        uniforms: {
          uMap: { value: null },
          uUvRect: { value: new THREE.Vector4(0, 0, 1, 1) },
          uOpacity: { value: 0.72 },
          uTint: { value: new THREE.Color(0xe6fff7) }
        },
        vertexShader: `
          varying vec2 vUv;
          void main() {
            vUv = uv;
            gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
          }
        `,
        fragmentShader: `
          uniform sampler2D uMap;
          uniform vec4 uUvRect;
          uniform float uOpacity;
          uniform vec3 uTint;
          varying vec2 vUv;
          void main() {
            vec2 sampleUv = vUv * uUvRect.zw + uUvRect.xy;
            vec4 texel = texture2D(uMap, sampleUv);
            if (texel.a < 0.12) discard;
            gl_FragColor = vec4(uTint, texel.a * uOpacity);
          }
        `,
        transparent: true,
        depthWrite: false,
        side: THREE.DoubleSide
      }),
      {
        uMap: mapTexture,
        uOpacity: initialOpacity,
        uTint: _tmpWhiteGhostTint
      }
    );
    (mat.uniforms.uUvRect.value as THREE.Vector4).set(uvRect.ox, uvRect.oy, uvRect.rx, uvRect.ry);

    const mesh = new THREE.Mesh(this.sharedUnitPlaneGeo, mat);
    mesh.userData.isSharedGeo = true;
    mesh.scale.set(104, 104, 1);
    mesh.position.set(pos.x, elevation + 52, pos.y);
    mesh.renderOrder = 4;
    this.group.add(mesh);

    this.whiteGhosts.push({
      mesh,
      mat,
      lifetime: duration,
      maxLifetime: duration
    });
  }

  // 4C. Doctor Toxic Chain Bounce Bio-Arc (2x scale)
  public spawnToxicChainArc(from: Vector2, fromZ: number, to: Vector2, toZ: number): void {
    const points: THREE.Vector3[] = [];
    const segments = 6;
    for (let i = 0; i <= segments; i++) {
      const t = i / segments;
      const jitter = i > 0 && i < segments ? 22 : 0;
      points.push(
        new THREE.Vector3(
          from.x + (to.x - from.x) * t + (Math.random() - 0.5) * jitter,
          fromZ + (toZ - fromZ) * t + Math.sin(t * Math.PI) * 26 + (Math.random() - 0.5) * 10,
          from.y + (to.y - from.y) * t + (Math.random() - 0.5) * jitter
        )
      );
    }
    const curve = new THREE.CatmullRomCurve3(points);
    const tubeGeo = new THREE.TubeGeometry(curve, 10, 4.2, 5, false);
    const tubeMat = this.acquireBasicMat(0x4ade80, 0.92, THREE.AdditiveBlending, THREE.FrontSide, false, null);
    const mesh = new THREE.Mesh(tubeGeo, tubeMat);
    this.group.add(mesh);
    this.beams.push({ mesh, lifetime: 0.22, maxLifetime: 0.22 });
  }

  // 4D. Doctor Toxic Burst Explosion (Volumetric Chemical Fireball & Corrosive Cloud)
  public spawnToxicExplosion(pos: Vector2, elevation: number, radius: number): void {
    this.spawnRealisticExplosion(pos, elevation, Math.max(68, radius), 'toxic', elevation + 12);
  }

  // 4E. Doctor Heavenly Light Curtain (Divine Intervention Aurora Column — zero cylinder)
  public spawnHeavenlyLightBeam(pos: Vector2, elevation: number, duration: number = 0.85, colorHex: number = 0x6ee7b7): void {
    const colGeo = this.createOrganicPlumeColumnGeo(18, 44, 460, 12, 8, 0.34, 1.3);
    const colMat = this.acquireBasicMat(colorHex, 0.68, THREE.AdditiveBlending, THREE.DoubleSide, false, null);
    const colMesh = new THREE.Mesh(colGeo, colMat);
    colMesh.position.set(pos.x, elevation + 230, pos.y);
    this.group.add(colMesh);
    this.beams.push({ mesh: colMesh, lifetime: duration, maxLifetime: duration });
    this.spawnShockwaveRing(pos, 104, colorHex, elevation + 1.5, duration * 0.75);
  }

  // 4F. Doctor Emerald Healing Mote Burst (Organic Glow Wisps — zero CircleGeometry)
  public spawnHealMoteBurst(pos: Vector2, elevation: number, count: number = 4): void {
    const n = Math.min(count, 6);
    for (let i = 0; i < n; i++) {
      if (this.healMotes.length >= 28) break;
      const mat = this.acquireBasicMat(
        i % 2 === 0 ? 0x34d399 : 0xecfdf5,
        0.9,
        THREE.AdditiveBlending,
        THREE.DoubleSide,
        false,
        this.dustRadialTex || null
      );
      const mesh = new THREE.Mesh(this.sharedUnitPlaneGeo, mat);
      mesh.userData.isSharedGeo = true;
      mesh.scale.set(12, 12, 1);
      const ang = Math.random() * Math.PI * 2;
      const r = 16 + Math.random() * 26;
      mesh.position.set(pos.x + Math.cos(ang) * r, elevation + 24 + Math.random() * 36, pos.y + Math.sin(ang) * r);
      this.group.add(mesh);
      this.healMotes.push({
        mesh,
        mat,
        vx: (Math.random() - 0.5) * 32,
        vy: 56 + Math.random() * 42,
        vz: (Math.random() - 0.5) * 32,
        lifetime: 0.55,
        maxLifetime: 0.55
      });
    }
  }

  /** Restrained crystalline frost wisps along the advancing cosmetic refreezing wavefront. */
  public spawnRegionalFrostMotes(origin: Vector2, radius: number, count: number = 3): void {
    const n = Math.min(count, 5);
    const radialDist = Math.max(80, radius);
    for (let i = 0; i < n; i++) {
      if (this.regionalFrostMotes.length >= 36) break;
      const mat = this.acquireBasicMat(
        i % 2 === 0 ? 0xbae6fd : 0xe0f2fe,
        0.72,
        THREE.AdditiveBlending,
        THREE.DoubleSide,
        false,
        this.dustRadialTex || null
      );
      const mesh = new THREE.Mesh(this.sharedDustGeo, mat);
      mesh.userData.isSharedGeo = true;
      mesh.scale.setScalar(18 + Math.random() * 14);
      const ang = Math.random() * Math.PI * 2;
      const r = radialDist * (0.85 + Math.random() * 0.25);
      const wx = origin.x + Math.cos(ang) * r;
      const wy = origin.y + Math.sin(ang) * r;
      const groundY = this.heightSampler(wx, wy);
      mesh.position.set(wx, groundY + 18 + Math.random() * 38, wy);
      this.group.add(mesh);
      const life = 0.85 + Math.random() * 0.35;
      this.regionalFrostMotes.push({
        mesh,
        mat,
        vx: Math.cos(ang) * (24 + Math.random() * 24),
        vy: 28 + Math.random() * 24,
        vz: Math.sin(ang) * (24 + Math.random() * 24),
        lifetime: life,
        maxLifetime: life
      });
    }
  }

  // 4G. Experimental Drone Bio-Bolt Target Impact Burst
  public spawnDroneImpactBurst(pos: Vector2, elevation: number = 18): void {
    this.initSharedBlasterBoltResources();
    const sparkMat = this.acquireShader(
      'drone_impact_spark',
      () => ({
        transparent: true,
        depthWrite: false,
        blending: THREE.AdditiveBlending,
        side: THREE.DoubleSide,
        uniforms: { uSeed: { value: 0 } },
        vertexShader: `
          varying vec2 vUv;
          void main() {
            vUv = uv * 2.0 - 1.0;
            gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
          }
        `,
        fragmentShader: `
          uniform float uSeed;
          varying vec2 vUv;
          void main() {
            float r = length(vUv);
            if (r > 1.0) discard;
            float a = atan(vUv.y, vUv.x) + uSeed;
            float rays = pow(abs(cos(a * 4.0)), 6.0) * smoothstep(1.0, 0.05, r);
            float core = smoothstep(0.42, 0.0, r);
            float alpha = clamp(core + rays * 0.9, 0.0, 1.0);
            vec3 col = mix(vec3(0.06, 0.78, 0.52), vec3(0.86, 1.0, 0.92), core);
            gl_FragColor = vec4(col, alpha);
          }
        `
      }),
      { uSeed: Math.random() * 6.28 }
    );
    const flash = new THREE.Mesh(this.sharedImpactSparkGeo!, sparkMat);
    flash.userData.isSharedGeo = true;
    flash.position.set(pos.x, elevation, pos.y);
    flash.scale.setScalar(0.85);
    this.group.add(flash);
    this.blasterFlashes.push({ mesh: flash, lifetime: 0.14, maxLifetime: 0.14 });
    this.spawnHealMoteBurst(pos, Math.max(2, elevation - 6), 3);
  }

  // 5. Chain Lightning & Arc Cannon 3D Electric Bolt
  public drawChainLightning(from: Vector2, to: Vector2, elevation: number = 16): void {
    const points: THREE.Vector3[] = [];
    const segments = 6;
    for (let i = 0; i <= segments; i++) {
      const t = i / segments;
      const x = from.x + (to.x - from.x) * t + (i > 0 && i < segments ? (Math.random() - 0.5) * 20 : 0);
      const y = elevation + (i > 0 && i < segments ? (Math.random() - 0.5) * 10 : 0);
      const z = from.y + (to.y - from.y) * t + (i > 0 && i < segments ? (Math.random() - 0.5) * 20 : 0);
      points.push(new THREE.Vector3(x, y, z));
    }

    const curve = new THREE.CatmullRomCurve3(points);
    const tubeGeo = new THREE.TubeGeometry(curve, 12, 4.8, 6, false);
    const tubeMat = new THREE.MeshBasicMaterial({
      color: 0xa855f7,
      transparent: true,
      blending: THREE.AdditiveBlending,
      opacity: 0.95
    });
    const tubeMesh = new THREE.Mesh(tubeGeo, tubeMat);
    this.group.add(tubeMesh);

    this.beams.push({
      mesh: tubeMesh,
      lifetime: 0.22,
      maxLifetime: 0.22
    });

    const geo = new THREE.BufferGeometry().setFromPoints(points);
    const mat = new THREE.LineBasicMaterial({
      color: 0xf3e8ff,
      transparent: true,
      opacity: 0.98
    });
    const line = new THREE.Line(geo, mat);
    this.group.add(line);
    this.lightningLines.push(line);

    this.spawnShockwaveRing(to, 56, 0xc084fc, elevation - 14, 0.22);

    setTimeout(() => {
      this.group.remove(line);
      geo.dispose();
      mat.dispose();
    }, 160);
  }

  // ==========================================================================
  // COMMANDER SKILL 1 (LMB): GOLD BLASTER BOLT, MUZZLE FLASH & IMPACT SPARK
  // ==========================================================================

  private initSharedBlasterBoltResources(): void {
    if (this.sharedBoltCoreGeo) return;

    this.sharedBoltCoreGeo = this.createOrganicPlumeColumnGeo(0.8, 1.9, 22, 8, 4, 0.25, 0.9);
    this.sharedBoltCoreGeo.rotateX(Math.PI / 2);
    this.sharedBoltCoreMat = new THREE.MeshBasicMaterial({ color: 0xffffff, side: THREE.DoubleSide });

    this.sharedBoltTipGeo = this.createJaggedShardGeo(2.0, 10, 5, 5);
    this.sharedBoltTipGeo.rotateX(Math.PI / 2);
    this.sharedBoltTipGeo.translate(0, 0, 9);
    this.sharedBoltTipMat = new THREE.MeshBasicMaterial({ color: 0xfef08a });

    this.sharedBoltGlowGeo = this.createOrganicPlumeColumnGeo(1.1, 3.6, 28, 8, 4, 0.30, -1.1);
    this.sharedBoltGlowGeo.rotateX(Math.PI / 2);
    this.sharedBoltGlowGeo.translate(0, 0, -1);
    this.sharedBoltGlowMat = new THREE.MeshBasicMaterial({
      color: 0xf59e0b,
      transparent: true,
      opacity: 0.72,
      blending: THREE.AdditiveBlending,
      side: THREE.DoubleSide,
      depthWrite: false
    });

    this.sharedBoltTrailMat = new THREE.ShaderMaterial({
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      side: THREE.DoubleSide,
      uniforms: {
        uCoreCol: { value: new THREE.Color(0xfef08a) },
        uEdgeCol: { value: new THREE.Color(0xf97316) }
      },
      vertexShader: `
        varying vec2 vUv;
        void main() {
          vUv = uv;
          gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
        }
      `,
      fragmentShader: `
        uniform vec3 uCoreCol;
        uniform vec3 uEdgeCol;
        varying vec2 vUv;
        void main() {
          float along = clamp(vUv.y, 0.0, 1.0);
          float across = abs(vUv.x - 0.5) * 2.0;
          float widthTaper = mix(0.22, 1.0, along);
          float coreLine = smoothstep(0.38 * widthTaper, 0.0, across);
          float sideThread = smoothstep(0.12, 0.0, abs(across - 0.72 * widthTaper)) * smoothstep(0.15, 0.85, along);
          float alpha = (coreLine * 0.85 + sideThread * 0.65) * pow(along, 1.45);
          if (alpha < 0.01) discard;
          vec3 col = mix(uEdgeCol, uCoreCol, coreLine);
          gl_FragColor = vec4(col, alpha);
        }
      `
    });

    this.sharedBoltTrailGeoH = new THREE.PlaneGeometry(7.5, 36);
    this.sharedBoltTrailGeoH.rotateX(Math.PI / 2);
    this.sharedBoltTrailGeoH.translate(0, 0, -16);

    this.sharedBoltTrailGeoV = new THREE.PlaneGeometry(7.5, 36);
    this.sharedBoltTrailGeoV.rotateX(Math.PI / 2);
    this.sharedBoltTrailGeoV.rotateZ(Math.PI / 2);
    this.sharedBoltTrailGeoV.translate(0, 0, -16);

    this.sharedMuzzleFlashGeo = new THREE.PlaneGeometry(48, 48);
    this.sharedMuzzleFlashGeo.rotateX(-Math.PI / 2);
    this.sharedMuzzleFlashMat = new THREE.ShaderMaterial({
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      side: THREE.DoubleSide,
      uniforms: {
        uAngle: { value: 0 }
      },
      vertexShader: `
        varying vec2 vUv;
        void main() {
          vUv = uv * 2.0 - 1.0;
          gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
        }
      `,
      fragmentShader: `
        uniform float uAngle;
        varying vec2 vUv;
        void main() {
          float r = length(vUv);
          if (r > 1.0) discard;
          float a = atan(vUv.y, vUv.x) - uAngle;
          float spikes = pow(abs(cos(a * 3.0)), 6.0) * smoothstep(1.0, 0.08, r);
          float core = smoothstep(0.45, 0.0, r);
          float wisp = 0.5 + 0.5 * sin(a * 5.0 + r * 7.0);
          float alpha = clamp(core + spikes * 0.9 + wisp * smoothstep(0.85, 0.15, r) * 0.35, 0.0, 1.0);
          vec3 col = mix(vec3(0.98, 0.55, 0.08), vec3(1.0, 0.98, 0.82), core + spikes * 0.5);
          gl_FragColor = vec4(col, alpha);
        }
      `
    });

    this.sharedImpactSparkGeo = new THREE.PlaneGeometry(52, 52);
    this.sharedImpactSparkGeo.rotateX(-Math.PI / 2);
    this.sharedImpactSparkMat = new THREE.ShaderMaterial({
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      side: THREE.DoubleSide,
      uniforms: {
        uSeed: { value: 0 }
      },
      vertexShader: `
        varying vec2 vUv;
        void main() {
          vUv = uv * 2.0 - 1.0;
          gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
        }
      `,
      fragmentShader: `
        uniform float uSeed;
        varying vec2 vUv;
        void main() {
          float r = length(vUv);
          if (r > 1.0) discard;
          float a = atan(vUv.y, vUv.x) + uSeed;
          float rays = pow(abs(cos(a * 4.0)), 8.0) * smoothstep(1.0, 0.05, r);
          float core = smoothstep(0.38, 0.0, r);
          float alpha = clamp(core + rays * 0.95, 0.0, 1.0);
          vec3 col = mix(vec3(0.98, 0.58, 0.08), vec3(1.0, 0.98, 0.85), core);
          gl_FragColor = vec4(col, alpha);
        }
      `
    });

    this.sharedSparkMatYellow = new THREE.MeshBasicMaterial({
      color: 0xfef08a,
      transparent: true,
      opacity: 1.0,
      blending: THREE.AdditiveBlending
    });
    this.sharedSparkMatOrange = new THREE.MeshBasicMaterial({
      color: 0xf59e0b,
      transparent: true,
      opacity: 1.0,
      blending: THREE.AdditiveBlending
    });
  }

  public createGoldenBlasterBoltGroup(): THREE.Group {
    this.initSharedBlasterBoltResources();

    const grp = new THREE.Group();
    grp.userData.isPooled = true;

    // 1. Brilliant Yellow-White Tapered Energy Core
    grp.add(new THREE.Mesh(this.sharedBoltCoreGeo!, this.sharedBoltCoreMat!));
    // 2. Tip Cone
    grp.add(new THREE.Mesh(this.sharedBoltTipGeo!, this.sharedBoltTipMat!));
    // 3. Thin Golden-Orange Outer Glow Sheath
    grp.add(new THREE.Mesh(this.sharedBoltGlowGeo!, this.sharedBoltGlowMat!));
    // 4. Crossed Tracer Trail Planes (Reusing single compiled ShaderMaterial)
    grp.add(new THREE.Mesh(this.sharedBoltTrailGeoH!, this.sharedBoltTrailMat!));
    grp.add(new THREE.Mesh(this.sharedBoltTrailGeoV!, this.sharedBoltTrailMat!));

    return grp;
  }

  public spawnBlasterMuzzleFlash(
    pos: Vector2,
    elevation: number = 26,
    vx: number = 1,
    vy: number = 0
  ): void {
    this.initSharedBlasterBoltResources();
    const angle = Math.atan2(vx, vy);

    const flashMat = this.acquireShader(
      'blaster_muzzle_flash',
      () => ({
        transparent: true,
        depthWrite: false,
        blending: THREE.AdditiveBlending,
        side: THREE.DoubleSide,
        uniforms: { uAngle: { value: 0 } },
        vertexShader: this.sharedMuzzleFlashMat!.vertexShader,
        fragmentShader: this.sharedMuzzleFlashMat!.fragmentShader
      }),
      { uAngle: angle }
    );

    const flashMesh = new THREE.Mesh(this.sharedMuzzleFlashGeo!, flashMat);
    flashMesh.userData.isSharedGeo = true;
    flashMesh.position.set(pos.x, elevation, pos.y);
    this.group.add(flashMesh);
    this.blasterFlashes.push({ mesh: flashMesh, lifetime: 0.09, maxLifetime: 0.09 });
  }

  public spawnBlasterImpactSpark(pos: Vector2, elevation: number = 20): void {
    this.initSharedBlasterBoltResources();

    const sparkMat = this.acquireShader(
      'blaster_impact_spark',
      () => ({
        transparent: true,
        depthWrite: false,
        blending: THREE.AdditiveBlending,
        side: THREE.DoubleSide,
        uniforms: { uSeed: { value: 0 } },
        vertexShader: this.sharedImpactSparkMat!.vertexShader,
        fragmentShader: this.sharedImpactSparkMat!.fragmentShader
      }),
      { uSeed: Math.random() * 6.28 }
    );

    const sparkMesh = new THREE.Mesh(this.sharedImpactSparkGeo!, sparkMat);
    sparkMesh.userData.isSharedGeo = true;
    sparkMesh.position.set(pos.x, elevation + 4, pos.y);
    this.group.add(sparkMesh);
    this.blasterFlashes.push({ mesh: sparkMesh, lifetime: 0.12, maxLifetime: 0.12 });

    // 2. 6 Minimal Radial Micro-Sparks
    const groundY = this.getTerrainHeight(pos.x, pos.y, elevation);
    for (let i = 0; i < 6; i++) {
      const ang = (i / 6) * Math.PI * 2 + (Math.random() - 0.5) * 0.4;
      const spd = 95 + Math.random() * 85;
      const mat = this.acquireBasicMat(i % 2 === 0 ? 0xfef08a : 0xf59e0b, 1.0, THREE.AdditiveBlending, THREE.DoubleSide, true, null);
      const m = new THREE.Mesh(this.sharedSparkGeo, mat);
      m.userData.isSharedGeo = true;
      m.position.set(pos.x, elevation + 4, pos.y);
      m.scale.set(1.2, 1.2, 2.8);
      this.group.add(m);
      this.orbitalParticles.push({
        mesh: m,
        kind: 'spark',
        vx: Math.cos(ang) * spd,
        vy: 35 + Math.random() * 45,
        vz: Math.sin(ang) * spd,
        rotSpeedX: 8,
        rotSpeedY: 8,
        rotSpeedZ: 4,
        baseScale: 1.2,
        endScale: 0.2,
        lifetime: 0.15,
        maxLifetime: 0.15,
        groundY
      });
    }
  }

  // ==========================================================================
  // COMMANDER SKILL 2 (RMB): TWIN CONVERGING GOLDEN ENERGY SLASHES
  // ==========================================================================

  private createCrescentSlashMaterial(mirrorSide: number): THREE.ShaderMaterial {
    return this.acquireShader(
      'crescent_slash',
      () => ({
        transparent: true,
        depthWrite: false,
        blending: THREE.AdditiveBlending,
        side: THREE.DoubleSide,
        uniforms: {
          uMirror: { value: 1.0 },
          uTime: { value: 0 },
          uAlpha: { value: 1.0 }
        },
        vertexShader: `
          varying vec2 vUv;
          void main() {
            vUv = uv;
            gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
          }
        `,
        fragmentShader: `
          uniform float uMirror;
          uniform float uTime;
          uniform float uAlpha;
          varying vec2 vUv;

          void main() {
            // Map UV into local crescent space
            vec2 p = vUv * 2.0 - 1.0;
            p.x *= uMirror;

            // Curved crescent spine: x curves inward along y (-1..1)
            float spineX = 0.28 - 0.52 * (p.y * p.y);
            float distFromSpine = p.x - spineX;

            // Lengthwise tip taper at both ends of the crescent blade
            float tipFade = smoothstep(1.0, 0.25, abs(p.y));
            if (tipFade <= 0.001) discard;

            // Sharp leading outer edge (distFromSpine > 0) and softer inner wake (distFromSpine < 0)
            float outerWidth = 0.14 * tipFade;
            float innerWakeWidth = 0.48 * tipFade;

            float alpha = 0.0;
            float edgeFactor = 0.0;
            if (distFromSpine >= 0.0) {
              alpha = smoothstep(outerWidth, 0.0, distFromSpine);
              edgeFactor = smoothstep(outerWidth * 0.65, 0.0, distFromSpine);
            } else {
              float dIn = -distFromSpine;
              alpha = smoothstep(innerWakeWidth, 0.0, dIn) * 0.82;
              edgeFactor = smoothstep(innerWakeWidth * 0.18, 0.0, dIn);
            }

            // Flowing organic solar-flame plasma ripples in wake (zero geometric grid/hex pattern)
            float flameFlow = 0.5 + 0.5 * sin(p.y * 8.5 - uTime * 7.0 + sin(p.x * 11.0 + uTime * 4.5) * 1.4);
            float wispMask = flameFlow * smoothstep(innerWakeWidth, 0.04, -distFromSpine) * 0.42;

            alpha = clamp((alpha + wispMask) * tipFade * uAlpha, 0.0, 1.0);
            if (alpha < 0.02) discard;

            vec3 amberWake = vec3(0.96, 0.48, 0.08);
            vec3 goldMid = vec3(0.99, 0.78, 0.18);
            vec3 whiteGoldEdge = vec3(1.0, 0.98, 0.86);

            vec3 col = mix(amberWake, goldMid, clamp(alpha * 1.2, 0.0, 1.0));
            col = mix(col, whiteGoldEdge, edgeFactor);

            gl_FragColor = vec4(col, alpha);
          }
        `
      }),
      { uMirror: mirrorSide, uTime: 0, uAlpha: 1.0 }
    );
  }

  public createTwinSlashProjectileGroup(extraLayers: number = 0): THREE.Group {
    const grp = new THREE.Group();

    const bladeGeo = new THREE.PlaneGeometry(78, 125, 16, 24);
    bladeGeo.rotateX(-Math.PI / 2);

    const leftMat = this.createCrescentSlashMaterial(-1.0);
    const rightMat = this.createCrescentSlashMaterial(1.0);

    const layers: Array<{ leftMesh: THREE.Mesh; rightMesh: THREE.Mesh; yOffset: number }> = [];

    // Base Layer: y = 2
    const baseLeft = new THREE.Mesh(bladeGeo, leftMat);
    baseLeft.name = 'leftSlash_base';
    baseLeft.position.set(-52, 2, 0);
    grp.add(baseLeft);

    const baseRight = new THREE.Mesh(bladeGeo, rightMat);
    baseRight.name = 'rightSlash_base';
    baseRight.position.set(52, 2, 0);
    grp.add(baseRight);

    layers.push({ leftMesh: baseLeft, rightMesh: baseRight, yOffset: 2 });

    // Layer 1 (+2 Projectiles): Upper Layer at +14 Y (y = 16)
    if (extraLayers >= 1) {
      const upLeft = new THREE.Mesh(bladeGeo, leftMat);
      upLeft.name = 'leftSlash_up';
      upLeft.position.set(-52, 16, 0);
      grp.add(upLeft);

      const upRight = new THREE.Mesh(bladeGeo, rightMat);
      upRight.name = 'rightSlash_up';
      upRight.position.set(52, 16, 0);
      grp.add(upRight);

      layers.push({ leftMesh: upLeft, rightMesh: upRight, yOffset: 16 });
    }

    // Layer 2 (+4 Projectiles): Lower Layer at -14 Y (y = -12)
    if (extraLayers >= 2) {
      const downLeft = new THREE.Mesh(bladeGeo, leftMat);
      downLeft.name = 'leftSlash_down';
      downLeft.position.set(-52, -12, 0);
      grp.add(downLeft);

      const downRight = new THREE.Mesh(bladeGeo, rightMat);
      downRight.name = 'rightSlash_down';
      downRight.position.set(52, -12, 0);
      grp.add(downRight);

      layers.push({ leftMesh: downLeft, rightMesh: downRight, yOffset: -12 });
    }

    // Swirling Golden Ember Wisps (zero geometric chevrons)
    const chevGeo = new THREE.PlaneGeometry(24, 14);
    chevGeo.rotateX(-Math.PI / 2);
    const createChevronMat = (dirSign: number) =>
      this.acquireShader(
        'twin_slash_chevron',
        () => ({
          transparent: true,
          depthWrite: false,
          blending: THREE.AdditiveBlending,
          side: THREE.DoubleSide,
          uniforms: { uDir: { value: 1.0 }, uTime: { value: 0 } },
          vertexShader: `
            varying vec2 vUv;
            void main() {
              vUv = uv * 2.0 - 1.0;
              gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
            }
          `,
          fragmentShader: `
            uniform float uDir;
            uniform float uTime;
            varying vec2 vUv;
            void main() {
              float x = vUv.x * uDir;
              float stream = sin(x * 7.0 - uTime * 11.0 + vUv.y * 4.0) * 0.5 + 0.5;
              float fade = exp(-dot(vUv, vUv) * 2.2) * smoothstep(0.25, 0.9, stream);
              if (fade < 0.02) discard;
              gl_FragColor = vec4(1.0, 0.86, 0.34, fade * 0.78);
            }
          `
        }),
        { uDir: dirSign, uTime: 0 }
      );

    const leftChev = new THREE.Mesh(chevGeo, createChevronMat(1.0));
    leftChev.name = 'leftChevrons';
    leftChev.position.set(-28, 3, 0);
    grp.add(leftChev);

    const rightChev = new THREE.Mesh(chevGeo, createChevronMat(-1.0));
    rightChev.name = 'rightChevrons';
    rightChev.position.set(28, 3, 0);
    grp.add(rightChev);

    grp.userData = {
      elapsed: 0,
      trailTimer: 0,
      leftMesh: baseLeft,
      rightMesh: baseRight,
      layers,
      leftMat,
      rightMat,
      leftChev,
      rightChev
    };

    return grp;
  }

  public updateTwinSlashProjectileGroup(
    grp: THREE.Group,
    progress: number,
    dt: number,
    worldPos: Vector2,
    elevation: number
  ): void {
    const ud = grp.userData;
    if (!ud || !ud.leftMesh || !ud.rightMesh) return;

    ud.elapsed += dt;
    const clampedP = Math.max(0.0, Math.min(1.0, progress));
    // Phase 1 (Separated at ±54) -> Phase 2 (Sweeping inward to ±6 at convergence point)
    const pinchCurve = Math.pow(clampedP, 1.25);
    const lateralOffset = 54 * (1.0 - pinchCurve) + 6;
    const inwardCant = 0.18 + pinchCurve * 0.42;

    const layers: Array<{ leftMesh: THREE.Mesh; rightMesh: THREE.Mesh; yOffset: number }> =
      ud.layers || [{ leftMesh: ud.leftMesh, rightMesh: ud.rightMesh, yOffset: 2 }];

    for (let l = 0; l < layers.length; l++) {
      const lay = layers[l];
      lay.leftMesh.position.set(-lateralOffset, lay.yOffset, 0);
      lay.leftMesh.rotation.y = -inwardCant;
      lay.rightMesh.position.set(lateralOffset, lay.yOffset, 0);
      lay.rightMesh.rotation.y = inwardCant;
    }

    ud.leftMat.uniforms.uTime.value = ud.elapsed;
    ud.rightMat.uniforms.uTime.value = ud.elapsed;

    if (ud.leftChev && ud.rightChev) {
      const chevOffset = Math.max(12, lateralOffset * 0.58);
      ud.leftChev.position.set(-chevOffset, 3, 0);
      ud.rightChev.position.set(chevOffset, 3, 0);
      (ud.leftChev.material as THREE.ShaderMaterial).uniforms.uTime.value = ud.elapsed;
      (ud.rightChev.material as THREE.ShaderMaterial).uniforms.uTime.value = ud.elapsed;
    }

    // Subtle golden-amber particles following the two slash paths
    ud.trailTimer += dt;
    if (ud.trailTimer >= 0.035) {
      ud.trailTimer = 0;
      const groundY = this.getTerrainHeight(worldPos.x, worldPos.y, elevation);
      for (let side = -1; side <= 1; side += 2) {
        const mat = this.acquireBasicMat(side < 0 ? 0xfef08a : 0xf59e0b, 0.85, THREE.AdditiveBlending, THREE.FrontSide, true, null);
        const spark = new THREE.Mesh(this.sharedSparkGeo, mat);
        spark.userData.isSharedGeo = true;
        spark.position.set(
          worldPos.x + (Math.random() - 0.5) * 24,
          groundY + 14 + Math.random() * 10,
          worldPos.y + (Math.random() - 0.5) * 24
        );
        spark.scale.set(1.3, 1.3, 2.2);
        this.group.add(spark);
        this.orbitalParticles.push({
          mesh: spark,
          kind: 'spark',
          vx: (Math.random() - 0.5) * 45,
          vy: 15 + Math.random() * 25,
          vz: (Math.random() - 0.5) * 45,
          rotSpeedX: 6,
          rotSpeedY: 6,
          rotSpeedZ: 6,
          baseScale: 1.3,
          endScale: 0.2,
          lifetime: 0.18,
          maxLifetime: 0.18,
          groundY
        });
      }
    }
  }

  public createElectricSwordModel(): THREE.Group {
    const sword = new THREE.Group();

    // Sculpted Organic Living-Plasma Energy Blade (tapered ribbon silhouette — zero Box/Cone/Cylinder/Octahedron)
    const bladePts: THREE.Vector3[] = [];
    for (let i = 0; i <= 14; i++) {
      const t = i / 14;
      const sway = Math.sin(t * Math.PI * 1.6) * 1.4;
      bladePts.push(new THREE.Vector3(sway, -4 + t * 36, 0));
    }
    const coreGeo = this.createJaggedRibbonGeometry(bladePts, 4.8);
    const bladeMat = new THREE.MeshBasicMaterial({
      color: 0xf5d0fe,
      transparent: true,
      opacity: 0.95,
      blending: THREE.AdditiveBlending,
      side: THREE.DoubleSide
    });
    sword.add(new THREE.Mesh(coreGeo, bladeMat));

    const edgeGeo = this.createJaggedRibbonGeometry(bladePts, 7.6);
    const edgeMat = new THREE.MeshBasicMaterial({
      color: 0xc084fc,
      transparent: true,
      opacity: 0.62,
      blending: THREE.AdditiveBlending,
      side: THREE.DoubleSide,
      depthWrite: false
    });
    sword.add(new THREE.Mesh(edgeGeo, edgeMat));

    // Curved organic plasma guard ribbon
    const guardPts = [
      new THREE.Vector3(-7.5, -2.5, 0),
      new THREE.Vector3(-3.5, -4.2, 0.8),
      new THREE.Vector3(0, -4.8, 0),
      new THREE.Vector3(3.5, -4.2, -0.8),
      new THREE.Vector3(7.5, -2.5, 0)
    ];
    const guardGeo = this.createJaggedRibbonGeometry(guardPts, 3.0);
    sword.add(new THREE.Mesh(guardGeo, new THREE.MeshBasicMaterial({
      color: 0x9333ea,
      transparent: true,
      opacity: 0.88,
      blending: THREE.AdditiveBlending,
      side: THREE.DoubleSide
    })));

    // Organic pommel flame-shard
    const pommelGeo = this.createJaggedShardGeo(2.4, 8, 5, 33);
    pommelGeo.rotateX(Math.PI);
    const pommelMesh = new THREE.Mesh(pommelGeo, new THREE.MeshBasicMaterial({
      color: 0xa855f7,
      transparent: true,
      opacity: 0.95,
      blending: THREE.AdditiveBlending
    }));
    pommelMesh.position.set(0, -8, 0);
    sword.add(pommelMesh);

    // Crackling arcs hugging the edge
    const sparkGeo = new THREE.BufferGeometry();
    const sparkPos = new Float32Array(16 * 3);
    for (let i = 0; i < 8; i++) {
      const y = -2 + (i / 7) * 28;
      sparkPos[i * 6] = -2.4 + (Math.random() - 0.5) * 1.5;
      sparkPos[i * 6 + 1] = y;
      sparkPos[i * 6 + 2] = (Math.random() - 0.5) * 1.2;
      sparkPos[i * 6 + 3] = 2.4 + (Math.random() - 0.5) * 1.5;
      sparkPos[i * 6 + 4] = y + (Math.random() - 0.5) * 3;
      sparkPos[i * 6 + 5] = (Math.random() - 0.5) * 1.2;
    }
    sparkGeo.setAttribute('position', new THREE.BufferAttribute(sparkPos, 3));
    const sparkMat = new THREE.LineBasicMaterial({
      color: 0xe879f9,
      transparent: true,
      opacity: 0.85,
      blending: THREE.AdditiveBlending
    });
    sword.add(new THREE.LineSegments(sparkGeo, sparkMat));

    return sword;
  }

  public spawnTwinSlashConvergence(
    pos: Vector2,
    elevation: number = 0,
    radius: number = 125,
    angle: number = 0
  ): void {
    const baseElev = this.getTerrainHeight(pos.x, pos.y, elevation);
    const group = new THREE.Group();
    group.position.set(pos.x, baseElev + 2.0, pos.y);
    // Align with incoming slash direction
    group.rotation.y = Math.PI / 2 - angle;
    this.group.add(group);

    // 1. Compact Golden Collision Burst at the Convergence Center (Phase 3)
    const burstSize = Math.min(115, radius * 0.92);
    const flashGeo = new THREE.PlaneGeometry(burstSize, burstSize);
    flashGeo.rotateX(-Math.PI / 2);
    const flashMat = this.acquireShader(
      'slash_convergence_flash',
      () => ({
        transparent: true,
        depthWrite: false,
        blending: THREE.AdditiveBlending,
        side: THREE.DoubleSide,
        uniforms: {
          uProgress: { value: 0.0 }
        },
        vertexShader: `
          varying vec2 vUv;
          void main() {
            vUv = uv * 2.0 - 1.0;
            gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
          }
        `,
        fragmentShader: `
          uniform float uProgress;
          varying vec2 vUv;
          void main() {
            float r = length(vUv);
            if (r > 1.0) discard;
            float a = atan(vUv.y, vUv.x);
            // Cross-slash X-starburst + compact compression ring
            float crossSpikes = pow(abs(cos(a * 2.0)), 10.0) * smoothstep(1.0, 0.05, r);
            float minorSpikes = pow(abs(sin(a * 4.0)), 12.0) * smoothstep(0.75, 0.05, r);
            float core = smoothstep(0.38 * (1.0 - uProgress * 0.5), 0.0, r);
            float wispNoise = sin(a * 5.0 + r * 8.0 - uProgress * 6.0) * 0.5 + 0.5;
            float emberGlow = smoothstep(0.75, 0.15, r) * wispNoise * 0.48;
            float fade = pow(1.0 - uProgress, 1.35);
            float alpha = clamp((core + crossSpikes * 0.95 + minorSpikes * 0.6 + emberGlow) * fade, 0.0, 1.0);
            if (alpha < 0.01) discard;
            vec3 col = mix(vec3(0.98, 0.58, 0.10), vec3(1.0, 0.98, 0.85), core + crossSpikes * 0.5);
            gl_FragColor = vec4(col, alpha);
          }
        `
      }),
      { uProgress: 0.0 }
    );
    const flashMesh = new THREE.Mesh(flashGeo, flashMat);
    group.add(flashMesh);

    // 2. Final Converged Left & Right Crescent Blades Sweeping Across Center and Fading (Phase 3 -> Phase 4)
    const bladeGeo = new THREE.PlaneGeometry(72, 115, 12, 20);
    bladeGeo.rotateX(-Math.PI / 2);
    const leftBladeMat = this.createCrescentSlashMaterial(-1.0);
    const leftBladeMesh = new THREE.Mesh(bladeGeo, leftBladeMat);
    leftBladeMesh.position.set(-10, 1.5, 0);
    leftBladeMesh.rotation.y = -0.45;
    group.add(leftBladeMesh);

    const rightBladeMat = this.createCrescentSlashMaterial(1.0);
    const rightBladeMesh = new THREE.Mesh(bladeGeo, rightBladeMat);
    rightBladeMesh.position.set(10, 1.5, 0);
    rightBladeMesh.rotation.y = 0.45;
    group.add(rightBladeMesh);

    // 3. Directional Compression Lines Emphasizing Inward Convergence
    const linePts: THREE.Vector3[] = [];
    for (let i = 0; i < 10; i++) {
      const a = (i / 10) * Math.PI * 2;
      const rOuter = 42 + (i % 2) * 14;
      const rInner = 6;
      linePts.push(new THREE.Vector3(Math.cos(a) * rOuter, 3, Math.sin(a) * rOuter));
      linePts.push(new THREE.Vector3(Math.cos(a) * rInner, 3, Math.sin(a) * rInner));
    }
    const compGeo = new THREE.BufferGeometry().setFromPoints(linePts);
    const compressionMat = new THREE.LineBasicMaterial({
      color: 0xfef08a,
      transparent: true,
      opacity: 0.9,
      blending: THREE.AdditiveBlending
    });
    const compressionLines = new THREE.LineSegments(compGeo, compressionMat);
    group.add(compressionLines);

    this.slashConvergences.push({
      group,
      flashMesh,
      flashMat,
      leftBladeMesh,
      leftBladeMat,
      rightBladeMesh,
      rightBladeMat,
      compressionLines,
      compressionMat,
      elapsed: 0,
      maxLifetime: 0.30
    });

    // 4. 12 Compact Golden Collision Sparks
    for (let i = 0; i < 12; i++) {
      const a = (i / 12) * Math.PI * 2 + (Math.random() - 0.5) * 0.3;
      const spd = 75 + Math.random() * 95;
      const mat = this.acquireBasicMat(i % 2 === 0 ? 0xffffff : 0xfacc15, 1.0, THREE.AdditiveBlending, THREE.FrontSide, true, null);
      const m = new THREE.Mesh(this.sharedSparkGeo, mat);
      m.userData.isSharedGeo = true;
      m.position.set(pos.x, baseElev + 12, pos.y);
      m.scale.set(1.5, 1.5, 3.2);
      this.group.add(m);
      this.orbitalParticles.push({
        mesh: m,
        kind: 'spark',
        vx: Math.cos(a) * spd,
        vy: 45 + Math.random() * 55,
        vz: Math.sin(a) * spd,
        rotSpeedX: 9,
        rotSpeedY: 9,
        rotSpeedZ: 5,
        baseScale: 1.5,
        endScale: 0.2,
        lifetime: 0.22,
        maxLifetime: 0.22,
        groundY: baseElev
      });
    }
  }

  // ==========================================================================
  // COMMANDER SKILL 3 (DASH): KINETIC MOTION STREAKS & COLLISION IMPACT
  // ==========================================================================

  public spawnDashChargeTrail(
    pos: Vector2,
    elevation: number = 0,
    dir: Vector2 = { x: 0, y: 1 },
    dashDuration: number = 0.22
  ): void {
    const baseElev = this.getTerrainHeight(pos.x, pos.y, elevation);
    const group = new THREE.Group();
    group.position.set(pos.x, baseElev, pos.y);
    const angle = Math.atan2(dir.x, dir.y);
    group.rotation.y = angle;
    this.group.add(group);

    // 1. Forward Curved Turbulent Slipstream Flame Trail around Commander (zero ConeGeometry)
    const noseGeo = this.createOrganicPlumeColumnGeo(2, 22, 38, 12, 6, 0.28, 1.2);
    noseGeo.rotateX(Math.PI / 2);
    noseGeo.translate(0, 18, 10);
    const noseConeMat = this.acquireShader(
      'dash_nose_cone',
      () => ({
        transparent: true,
        depthWrite: false,
        blending: THREE.AdditiveBlending,
        side: THREE.DoubleSide,
        uniforms: {
          uAlpha: { value: 0.85 }
        },
        vertexShader: `
          varying vec2 vUv;
          void main() {
            vUv = uv;
            gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
          }
        `,
        fragmentShader: `
          uniform float uAlpha;
          varying vec2 vUv;
          void main() {
            float fade = pow(vUv.y, 1.4) * uAlpha;
            vec3 col = mix(vec3(0.96, 0.58, 0.08), vec3(1.0, 0.98, 0.82), vUv.y);
            gl_FragColor = vec4(col, fade * 0.72);
          }
        `
      }),
      { uAlpha: 0.85 }
    );
    const noseConeMesh = new THREE.Mesh(noseGeo, noseConeMat);
    group.add(noseConeMesh);

    // 2. Narrow Golden-White & Violet-Accented Motion Speed Lines Trailing Behind
    const streakMeshes: THREE.Mesh[] = [];
    const streakMats: THREE.MeshBasicMaterial[] = [];
    const streakOffsets = [
      { x: -16, y: 12, z: -34, len: 68, w: 2.6, col: 0xfef08a },
      { x: 16, y: 12, z: -34, len: 68, w: 2.6, col: 0xfef08a },
      { x: -9, y: 22, z: -42, len: 78, w: 2.0, col: 0xf59e0b },
      { x: 9, y: 22, z: -42, len: 78, w: 2.0, col: 0xf59e0b },
      { x: -22, y: 16, z: -28, len: 56, w: 1.8, col: 0xc084fc },
      { x: 22, y: 16, z: -28, len: 56, w: 1.8, col: 0xc084fc },
      { x: 0, y: 18, z: -46, len: 84, w: 3.0, col: 0xffffff }
    ];

    for (let i = 0; i < streakOffsets.length; i++) {
      const cfg = streakOffsets[i];
      const sGeo = new THREE.PlaneGeometry(cfg.w, cfg.len);
      sGeo.rotateX(-Math.PI / 2);
      const sMat = this.acquireBasicMat(cfg.col, 0.88, THREE.AdditiveBlending, THREE.DoubleSide, false, null);
      const sMesh = new THREE.Mesh(sGeo, sMat);
      sMesh.position.set(cfg.x, cfg.y, cfg.z);
      group.add(sMesh);
      streakMeshes.push(sMesh);
      streakMats.push(sMat);
    }

    this.dashTrails.push({
      group,
      noseConeMesh,
      noseConeMat,
      streakMeshes,
      streakMats,
      dir: { x: dir.x, y: dir.y },
      elapsed: 0,
      dashDuration,
      totalLifetime: dashDuration + 0.14,
      dustTimer: 0
    });
  }

  public updateDashChargeFollow(
    pos: Vector2,
    elevation: number,
    dir: Vector2,
    dt: number
  ): void {
    if (this.dashTrails.length === 0) return;
    const active = this.dashTrails[this.dashTrails.length - 1];
    const baseElev = this.getTerrainHeight(pos.x, pos.y, elevation);
    active.group.position.set(pos.x, baseElev, pos.y);
    if (dir.x !== 0 || dir.y !== 0) {
      active.group.rotation.y = Math.atan2(dir.x, dir.y);
      active.dir = { x: dir.x, y: dir.y };
    }

    // Minimal low-profile ground dust puffs kicked up behind boots during dash
    active.dustTimer += dt;
    if (active.dustTimer >= 0.045) {
      active.dustTimer = 0;
      const dustMat = this.acquireBasicMat(0xd6d3d1, 0.38, THREE.NormalBlending, THREE.FrontSide, false, this.dustRadialTex || null);
      const dustMesh = new THREE.Mesh(this.sharedDustGeo, dustMat);
      dustMesh.userData.isSharedGeo = true;
      dustMesh.position.set(
        pos.x - active.dir.x * 16 + (Math.random() - 0.5) * 14,
        baseElev + 6,
        pos.y - active.dir.y * 16 + (Math.random() - 0.5) * 14
      );
      this.group.add(dustMesh);
      this.orbitalParticles.push({
        mesh: dustMesh,
        kind: 'dust',
        vx: -active.dir.x * 45 + (Math.random() - 0.5) * 25,
        vy: 12 + Math.random() * 14,
        vz: -active.dir.y * 45 + (Math.random() - 0.5) * 25,
        rotSpeedX: 0,
        rotSpeedY: 0,
        rotSpeedZ: 1.5,
        baseScale: 10,
        endScale: 22,
        lifetime: 0.24,
        maxLifetime: 0.24,
        groundY: baseElev
      });
    }
  }

  public spawnDashKineticImpact(
    pos: Vector2,
    elevation: number = 0,
    radius: number = 115,
    dir: Vector2 = { x: 0, y: 1 }
  ): void {
    const baseElev = this.getTerrainHeight(pos.x, pos.y, elevation);
    const group = new THREE.Group();
    group.position.set(pos.x, baseElev + 2.0, pos.y);
    const impactAngle = Math.atan2(dir.x, dir.y);
    group.rotation.y = impactAngle;
    this.group.add(group);

    // 1. Concentrated Golden-White Starburst + Inner Tech Ring at Collision Point
    const flashSize = Math.min(130, radius * 1.1);
    const flashGeo = new THREE.PlaneGeometry(flashSize, flashSize);
    flashGeo.rotateX(-Math.PI / 2);
    const flashMat = this.acquireShader(
      'dash_kinetic_flash',
      () => ({
        transparent: true,
        depthWrite: false,
        blending: THREE.AdditiveBlending,
        side: THREE.DoubleSide,
        uniforms: {
          uProgress: { value: 0.0 }
        },
        vertexShader: `
          varying vec2 vUv;
          void main() {
            vUv = uv * 2.0 - 1.0;
            gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
          }
        `,
        fragmentShader: `
          uniform float uProgress;
          varying vec2 vUv;
          void main() {
            float r = length(vUv);
            if (r > 1.0) discard;
            float a = atan(vUv.y, vUv.x);
            float rays = pow(abs(cos(a * 6.0)), 8.0) * smoothstep(1.0, 0.12, r);
            float subRays = pow(abs(sin(a * 10.0)), 12.0) * smoothstep(0.85, 0.15, r);
            float wisp = 0.5 + 0.5 * sin(a * 5.0 + r * 9.0);
            float core = smoothstep(0.36, 0.0, r);
            float fade = pow(1.0 - uProgress, 1.3);
            float alpha = clamp((core + rays * 0.95 + subRays * 0.65 + wisp * smoothstep(0.75, 0.15, r) * 0.35) * fade, 0.0, 1.0);
            if (alpha < 0.01) discard;
            vec3 gold = vec3(1.0, 0.78, 0.18);
            vec3 violetAccent = vec3(0.78, 0.45, 0.98);
            vec3 col = mix(gold, violetAccent, subRays * 0.45);
            col = mix(col, vec3(1.0, 0.99, 0.90), core);
            gl_FragColor = vec4(col, alpha);
          }
        `
      }),
      { uProgress: 0.0 }
    );
    const flashMesh = new THREE.Mesh(flashGeo, flashMat);
    group.add(flashMesh);

    // 2. Turbulent Kinetic Shockwave Dust & Ember Gust (zero crisp circle)
    const ringSize = radius * 1.9;
    const ringGeo = new THREE.PlaneGeometry(ringSize, ringSize);
    ringGeo.rotateX(-Math.PI / 2);
    const ringMat = this.createOrganicRippleShader(0xf59e0b, 0xfef08a, Math.random() * 20);
    const ringMesh = new THREE.Mesh(ringGeo, ringMat);
    group.add(ringMesh);

    // 3. Sharp Outward-Directed Kinetic Force Lines Emphasizing Knockback
    const spikePts: THREE.Vector3[] = [];
    for (let i = 0; i < 14; i++) {
      // Fan predominantly forward & outward in the knockback hemisphere
      const fanAngle = ((i / 13) - 0.5) * Math.PI * 1.35;
      const rStart = 12 + (i % 2) * 6;
      const rEnd = 65 + (i % 3) * 22;
      spikePts.push(new THREE.Vector3(Math.sin(fanAngle) * rStart, 4, Math.cos(fanAngle) * rStart));
      spikePts.push(new THREE.Vector3(Math.sin(fanAngle) * rEnd, 6, Math.cos(fanAngle) * rEnd));
    }
    const spikesGeo = new THREE.BufferGeometry().setFromPoints(spikePts);
    const spikesMat = new THREE.LineBasicMaterial({
      color: 0xfef08a,
      transparent: true,
      opacity: 0.95,
      blending: THREE.AdditiveBlending
    });
    const spikesLine = new THREE.LineSegments(spikesGeo, spikesMat);
    group.add(spikesLine);

    // 4. Procedural Radial Ground-Breaking Fracture Cracks (Temporary Ground Decal)
    const fissurePts: number[] = [];
    const fissureCount = 8;
    for (let f = 0; f < fissureCount; f++) {
      const fAngle = (f / fissureCount) * Math.PI * 2 + (Math.random() - 0.5) * 0.4;
      const segCount = 4;
      let curX = 0;
      let curZ = 0;
      let curDist = 0;
      const maxFissureDist = radius * (0.65 + Math.random() * 0.35);
      const stepDist = maxFissureDist / segCount;

      for (let s = 0; s < segCount; s++) {
        const nextDist = curDist + stepDist;
        const jagAngle = fAngle + (Math.random() - 0.5) * 0.40;
        const nextX = Math.cos(jagAngle) * nextDist;
        const nextZ = Math.sin(jagAngle) * nextDist;
        fissurePts.push(curX, 0.4, curZ);
        fissurePts.push(nextX, 0.4, nextZ);
        // Small branchlet
        if (s === 2 && Math.random() < 0.7) {
          const brAngle = jagAngle + (Math.random() < 0.5 ? 0.6 : -0.6);
          fissurePts.push(nextX, 0.4, nextZ);
          fissurePts.push(nextX + Math.cos(brAngle) * (stepDist * 0.7), 0.4, nextZ + Math.sin(brAngle) * (stepDist * 0.7));
        }
        curX = nextX;
        curZ = nextZ;
        curDist = nextDist;
      }
    }
    const cracksGeo = new THREE.BufferGeometry();
    cracksGeo.setAttribute('position', new THREE.Float32BufferAttribute(fissurePts, 3));
    const cracksMat = new THREE.LineBasicMaterial({
      color: 0xfbbf24,
      transparent: true,
      opacity: 0.98,
      blending: THREE.AdditiveBlending
    });
    const cracksLine = new THREE.LineSegments(cracksGeo, cracksMat);
    group.add(cracksLine);

    // 5. Brief Ground-Level Golden Energy Burst Shockwave Ring
    this.spawnShockwaveRing(pos, radius * 1.05, 0xf59e0b, baseElev + 0.8, 0.30);
    this.spawnShockwaveRing(pos, radius * 0.60, 0xfffbeb, baseElev + 1.2, 0.22);

    this.dashImpacts.push({
      group,
      flashMesh,
      flashMat,
      ringMesh,
      ringMat,
      spikesLine,
      spikesMat,
      cracksLine,
      cracksMat,
      elapsed: 0,
      maxLifetime: 0.85,
      radius
    });

    // 6. Chunks of Rock, Dust & Debris Erupting Outward from Ground Fracture
    for (let i = 0; i < 16; i++) {
      const fanA = impactAngle + (Math.random() - 0.5) * Math.PI * 1.4;
      const spd = 120 + Math.random() * 150;
      const isRockChunk = i < 10;
      if (isRockChunk) {
        const debMat = new THREE.MeshBasicMaterial({
          color: i % 2 === 0 ? 0x292524 : 0x44403c, // dark fractured stone
          transparent: true,
          opacity: 0.95
        });
        const debMesh = new THREE.Mesh(this.sharedDebrisGeo, debMat);
        const s = 2.4 + Math.random() * 2.2;
        debMesh.scale.set(s, s * 0.75, s);
        debMesh.position.set(pos.x, baseElev + 4, pos.y);
        this.group.add(debMesh);
        this.orbitalParticles.push({
          mesh: debMesh,
          kind: 'debris',
          vx: Math.sin(fanA) * spd,
          vy: 90 + Math.random() * 85,
          vz: Math.cos(fanA) * spd,
          rotSpeedX: 10,
          rotSpeedY: 9,
          rotSpeedZ: 8,
          baseScale: s,
          endScale: s,
          lifetime: 0.45,
          maxLifetime: 0.45,
          groundY: baseElev + 0.5
        });
      } else {
        const matParams: THREE.MeshBasicMaterialParameters = {
          color: 0xd6d3d1,
          transparent: true,
          opacity: 0.50,
          depthWrite: false
        };
        if (this.dustRadialTex) {
          matParams.map = this.dustRadialTex;
        }
        const dustMat = new THREE.MeshBasicMaterial(matParams);
        const dustMesh = new THREE.Mesh(this.sharedDustGeo, dustMat);
        dustMesh.position.set(pos.x, baseElev + 6, pos.y);
        this.group.add(dustMesh);
        this.orbitalParticles.push({
          mesh: dustMesh,
          kind: 'dust',
          vx: Math.sin(fanA) * (spd * 0.8),
          vy: 18 + Math.random() * 25,
          vz: Math.cos(fanA) * (spd * 0.8),
          rotSpeedX: 0,
          rotSpeedY: 0,
          rotSpeedZ: 2,
          baseScale: 14,
          endScale: 28,
          lifetime: 0.42,
          maxLifetime: 0.42,
          groundY: baseElev + 0.5
        });
      }
    }
  }

  // ============================================================================
  // ULTIMATE ENHANCEMENT A: ORBITAL STRIKE — SINGULARITY (BLACK HOLE)
  // ============================================================================
  public spawnSingularityVFX(
    pos: Vector2,
    radius: number,
    elevation: number = 0,
    duration: number = 3.0
  ): void {
    const baseElev = this.getTerrainHeight(pos.x, pos.y, elevation);
    const group = new THREE.Group();

    const discGeo = this.createTerrainConformingGrid(
      pos.x,
      pos.y,
      radius * 1.12,
      36,
      1.1,
      baseElev
    );

    const vortexDiscMat = this.acquireShader(
      'singularity_vortex_disc',
      () => ({
        transparent: true,
        depthWrite: false,
        blending: THREE.AdditiveBlending,
        side: THREE.DoubleSide,
        uniforms: {
          uTime: { value: 0 },
          uProgress: { value: 0 },
          uAlpha: { value: 1.0 }
        },
        vertexShader: `
          varying vec2 vUv;
          void main() {
            vUv = uv;
            gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
          }
        `,
        fragmentShader: `
          uniform float uTime;
          uniform float uProgress;
          uniform float uAlpha;
          varying vec2 vUv;

          void main() {
            vec2 p = (vUv - 0.5) * 2.0;
            float r = length(p);
            if (r > 1.0) discard;

            float a = atan(p.y, p.x);

            // Swirling logarithmic spiral arms pulling inward (accelerates late-stage)
            float swirlSpeed = uTime * (uProgress > 0.73 ? 6.8 : 3.8);
            float swirlAngle = a + swirlSpeed + log(max(r, 0.04)) * 4.2;
            float spiral1 = pow(0.5 + 0.5 * sin(swirlAngle * 3.0), 2.2);
            float spiral2 = pow(0.5 + 0.5 * cos(swirlAngle * 5.0 - uTime * 2.5), 3.0);

            // Domain-warped organic void nebula & spiraling rift wisps (zero chevrons or geometric tech rings)
            float n1 = 0.5 + 0.5 * sin(p.x * 7.5 + sin(p.y * 6.0 + uTime * 3.0) * 1.4);
            float n2 = 0.5 + 0.5 * cos(p.y * 9.0 - cos(p.x * 8.0 - uTime * 2.4) * 1.3);
            float wisp = n1 * 0.6 + n2 * 0.4;
            float warpedR = r + (wisp - 0.5) * 0.36;
            if (warpedR > 1.0) discard;

            float innerHorizon = exp(-pow((warpedR - 0.22) / 0.08, 2.0)) * (1.2 + 0.7 * sin(a * 4.0 - uTime * 7.0));
            float vortexSmoke = smoothstep(0.95, 0.14, warpedR) * smoothstep(0.25, 0.88, wisp);

            vec3 deepVoid = vec3(0.18, 0.03, 0.38);
            vec3 electricPurple = vec3(0.68, 0.22, 0.98);
            vec3 magentaGlow = vec3(0.95, 0.45, 1.0);
            vec3 orbitalGold = vec3(1.0, 0.82, 0.28);

            float energy = spiral1 * 0.78 + spiral2 * 0.60 + vortexSmoke * 0.85 + innerHorizon;
            vec3 col = mix(deepVoid, electricPurple, clamp(energy, 0.0, 1.0));
            col = mix(col, magentaGlow, clamp(spiral2 * 0.7 + vortexSmoke * 0.45, 0.0, 1.0));
            col += orbitalGold * (innerHorizon * 0.95 + smoothstep(0.26, 0.04, warpedR) * 0.55);

            float radialEnvelope = smoothstep(1.0, 0.70, warpedR) * (0.28 + 0.72 * (1.0 - warpedR * 0.55));
            float collapseBoost = 1.0 + smoothstep(0.70, 1.0, uProgress) * 0.85;

            float alpha = clamp((energy * 0.82 + 0.18) * radialEnvelope * uAlpha, 0.0, 1.0);
            gl_FragColor = vec4(col * collapseBoost, alpha);
          }
        `
      }),
      { uTime: 0, uProgress: 0, uAlpha: 1.0 }
    );

    const vortexDiscMesh = new THREE.Mesh(discGeo, vortexDiscMat);
    vortexDiscMesh.position.set(pos.x, baseElev, pos.y);
    group.add(vortexDiscMesh);

    // Dark swirling void event-horizon funnel (zero TorusGeometry)
    const coreGeo = this.createOrganicPlumeColumnGeo(radius * 0.14, radius * 0.04, 14, 14, 5, 0.36, 1.8);
    const coreSphereMat = this.acquireBasicMat(0x090214, 0.92, THREE.NormalBlending, THREE.DoubleSide, true, null);
    const coreSphereMesh = new THREE.Mesh(coreGeo, coreSphereMat);
    coreSphereMesh.position.set(pos.x, baseElev + 4, pos.y);
    group.add(coreSphereMesh);

    // Swirling violet-magenta plasma tendril ribbons (zero TorusGeometry)
    const accGeo = this.createOrganicPlumeColumnGeo(radius * 0.24, radius * 0.16, 10, 14, 5, 0.42, 2.2);
    accGeo.rotateX(Math.PI * 0.38);
    const accretionRingMat = this.acquireBasicMat(0xd946ef, 0.78, THREE.AdditiveBlending, THREE.DoubleSide, false, null);
    const accretionRingMesh = new THREE.Mesh(accGeo, accretionRingMat);
    accretionRingMesh.position.set(pos.x, baseElev + 6, pos.y);
    group.add(accretionRingMesh);

    // 16 3D rock/debris chunks pulled inward in a spiral orbit
    const debrisMeshes: ActiveSingularityVFX['debrisMeshes'] = [];
    for (let i = 0; i < 16; i++) {
      const dMat = this.acquireBasicMat(i % 3 === 0 ? 0xa855f7 : 0x2e1a47, 0.92, THREE.NormalBlending, THREE.FrontSide, true, null);
      const dMesh = new THREE.Mesh(this.sharedDebrisGeo, dMat);
      dMesh.userData.isSharedGeo = true;
      const scale = 5.5 + (i % 4) * 2.4;
      dMesh.scale.set(scale, scale * 0.75, scale * 0.9);
      group.add(dMesh);
      debrisMeshes.push({
        mesh: dMesh,
        mat: dMat,
        angle: (i / 16) * Math.PI * 2,
        distRatio: 0.25 + ((i * 0.19) % 0.68),
        heightOffset: 6 + (i % 5) * 5.5,
        orbitSpeed: 2.2 + (i % 4) * 0.45,
        rotSpeed: new THREE.Vector3(2.5, 3.2, 1.8)
      });
    }

    this.triggerSharedOrbitalLight(pos, baseElev, 0xa855f7, 3.8, radius * 2.2, duration);
    const pointLight = this.sharedOrbitalLight;

    this.group.add(group);
    this.activeSingularities.push({
      group,
      vortexDiscMesh,
      vortexDiscMat,
      coreSphereMesh,
      coreSphereMat,
      accretionRingMesh,
      accretionRingMat,
      debrisMeshes,
      pointLight,
      pos: { x: pos.x, y: pos.y },
      radius,
      baseElev,
      elapsed: 0,
      duration: Math.max(0.5, duration)
    });
  }

  public spawnSingularityDetonationVFX(
    pos: Vector2,
    radius: number,
    elevation: number = 0
  ): void {
    const baseElev = this.getTerrainHeight(pos.x, pos.y, elevation);
    this.spawnRealisticExplosion(pos, baseElev, Math.max(95, radius), 'void', baseElev + 16);
  }

  // ============================================================================
  // ULTIMATE ENHANCEMENT B: ORBITAL STRIKE — CONVERGENCE BARRAGE (5-STRIKE)
  // ============================================================================
  public spawnConvergenceBarrageVFX(
    pos: Vector2,
    subStrikes: Vector2[],
    radius: number,
    elevation: number = 0,
    duration: number = 0.95
  ): void {
    const baseElev = this.getTerrainHeight(pos.x, pos.y, elevation);

    // 1. Spawn the 4 surrounding simultaneous Orbital Strike beams in formation
    const subRadius = Math.round(radius * 0.65);
    for (let i = 0; i < subStrikes.length; i++) {
      const sp = subStrikes[i];
      const subElev = this.getTerrainHeight(sp.x, sp.y, baseElev);
      this.spawnOrbitalBlast(sp, subRadius, subElev, 'convergence_sub');
    }

    // 2. Build the Phase 2 Inward Spiral Convergence & Phase 3 Imminent Core group
    const group = new THREE.Group();
    const totalRadius = radius * 1.38;
    const spiralGeo = this.createTerrainConformingGrid(
      pos.x,
      pos.y,
      totalRadius,
      36,
      1.25,
      baseElev
    );

    const spiralMat = this.acquireShader(
      'convergence_spiral',
      () => ({
        transparent: true,
        depthWrite: false,
        blending: THREE.AdditiveBlending,
        side: THREE.DoubleSide,
        uniforms: {
          uTime: { value: 0 },
          uProgress: { value: 0 },
          uAlpha: { value: 1.0 }
        },
        vertexShader: `
          varying vec2 vUv;
          void main() {
            vUv = uv;
            gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
          }
        `,
        fragmentShader: `
          uniform float uTime;
          uniform float uProgress;
          uniform float uAlpha;
          varying vec2 vUv;

          void main() {
            vec2 p = (vUv - 0.5) * 2.0;
            float r = length(p);
            if (r > 1.0) discard;

            float a = atan(p.y, p.x);

            // 4 prominent golden energy streams spiraling inward from the 4 outer strike sites
            float streamPhase = a - log(max(r, 0.05)) * 2.6 + uTime * 4.5;
            float fourStreams = pow(0.5 + 0.5 * cos(streamPhase * 4.0), 2.8);
            float streamCore = pow(0.5 + 0.5 * cos(streamPhase * 4.0), 7.0);

            float flameWisp = 0.5 + 0.5 * sin(p.x * 8.5 + cos(p.y * 7.5 - uTime * 4.5) * 1.6);
            float warpedR = r + (flameWisp - 0.5) * 0.34;
            if (warpedR > 1.0) discard;

            float maxReach = mix(0.95, 0.32, pow(uProgress, 1.35));
            float reachMask = smoothstep(maxReach + 0.16, maxReach - 0.20, warpedR) * smoothstep(0.03, 0.18, warpedR);
            float fireCore = smoothstep(0.45, 0.0, warpedR) * (0.65 + uProgress * 0.9) * (0.65 + 0.35 * flameWisp);

            vec3 amberEdge = vec3(0.98, 0.48, 0.08);
            vec3 goldMid = vec3(1.0, 0.82, 0.18);
            vec3 whiteCore = vec3(1.0, 0.98, 0.88);

            float intensity = (fourStreams * (0.75 + 0.65 * flameWisp)) * reachMask + fireCore;
            vec3 col = mix(amberEdge, goldMid, clamp(intensity * 0.85, 0.0, 1.0));
            col = mix(col, whiteCore, clamp(streamCore * reachMask + fireCore * 0.75, 0.0, 1.0));

            float alpha = clamp(intensity * uAlpha, 0.0, 1.0);
            gl_FragColor = vec4(col * (1.25 + uProgress * 0.75), alpha);
          }
        `
      }),
      { uTime: 0, uProgress: 0, uAlpha: 1.0 }
    );

    const spiralMesh = new THREE.Mesh(spiralGeo, spiralMat);
    spiralMesh.position.set(pos.x, baseElev, pos.y);
    group.add(spiralMesh);

    // Central Swirling Solar Flame Vortex Core (zero Sphere / Icosahedron / Torus geometry)
    const coreSphereGeo = this.createOrganicPlumeColumnGeo(radius * 0.14, radius * 0.26, radius * 0.36, 14, 6, 0.36, 1.8);
    const coreSphereMat = this.acquireBasicMat(0xfef08a, 0.85, THREE.AdditiveBlending, THREE.DoubleSide, false, null);
    const coreSphereMesh = new THREE.Mesh(coreSphereGeo, coreSphereMat);
    coreSphereMesh.position.set(pos.x, baseElev + 24, pos.y);
    coreSphereMesh.scale.setScalar(0.25);
    group.add(coreSphereMesh);

    const coreCageGeo = this.createOrganicPlumeColumnGeo(radius * 0.24, radius * 0.10, radius * 0.42, 10, 6, 0.44, -2.0);
    const coreCageMat = this.acquireBasicMat(0xffffff, 0.65, THREE.AdditiveBlending, THREE.DoubleSide, false, null);
    const coreCageMesh = new THREE.Mesh(coreCageGeo, coreCageMat);
    coreCageMesh.position.set(pos.x, baseElev + 24, pos.y);
    coreCageMesh.scale.setScalar(0.25);
    group.add(coreCageMesh);

    const coreHaloGeo = this.createOrganicPlumeColumnGeo(radius * 0.32, radius * 0.22, 12, 14, 4, 0.40, 2.2);
    const coreHaloMat = this.acquireBasicMat(0xfbbf24, 0.78, THREE.AdditiveBlending, THREE.DoubleSide, false, null);
    const coreHaloMesh = new THREE.Mesh(coreHaloGeo, coreHaloMat);
    coreHaloMesh.position.set(pos.x, baseElev + 24, pos.y);
    coreHaloMesh.scale.setScalar(0.25);
    group.add(coreHaloMesh);

    // 10 levitating dark-gold debris fragments drawn upward around the building core
    const debrisMeshes: ActiveConvergenceBarrageVFX['debrisMeshes'] = [];
    for (let i = 0; i < 10; i++) {
      const dMat = this.acquireBasicMat(i % 2 === 0 ? 0xf59e0b : 0x3b2f1e, 0.9, THREE.NormalBlending, THREE.FrontSide, true, null);
      const dMesh = new THREE.Mesh(this.sharedDebrisGeo, dMat);
      dMesh.userData.isSharedGeo = true;
      const s = 5.0 + (i % 3) * 2.5;
      dMesh.scale.set(s, s * 1.2, s * 0.8);
      group.add(dMesh);
      debrisMeshes.push({
        mesh: dMesh,
        mat: dMat,
        angle: (i / 10) * Math.PI * 2,
        dist: radius * (0.45 + (i % 3) * 0.16),
        baseY: baseElev + 8 + (i % 4) * 7
      });
    }

    this.triggerSharedOrbitalLight(pos, baseElev, 0xfbbf24, 4.2, radius * 2.4, duration);
    const pointLight = this.sharedOrbitalLight;

    this.group.add(group);
    this.activeConvergences.push({
      group,
      spiralMesh,
      spiralMat,
      coreSphereMesh,
      coreSphereMat,
      coreCageMesh,
      coreCageMat,
      coreHaloMesh,
      coreHaloMat,
      debrisMeshes,
      pointLight,
      pos: { x: pos.x, y: pos.y },
      radius,
      baseElev,
      elapsed: 0,
      duration: Math.max(0.3, duration)
    });
  }

  public spawnConvergenceDetonationVFX(
    pos: Vector2,
    radius: number,
    elevation: number = 0
  ): void {
    const baseElev = this.getTerrainHeight(pos.x, pos.y, elevation);
    this.spawnOrbitalBlast(pos, radius, baseElev, 'nuke');
    this.spawnShockwaveRing(pos, radius * 1.15, 0xfef08a, baseElev + 2, 0.55);
    this.spawnShockwaveRing(pos, radius * 0.90, 0xf97316, baseElev + 1, 0.42);
  }

  // ============================================================================
  // ULTIMATE ENHANCEMENT C: ORBITAL STRIKE — CRYOGENIC IMPACT (FREEZING FIELD)
  // ============================================================================
  public spawnCryogenicFieldVFX(
    pos: Vector2,
    radius: number,
    elevation: number = 0,
    duration: number = 4.0
  ): void {
    const baseElev = this.getTerrainHeight(pos.x, pos.y, elevation);
    const group = new THREE.Group();

    const frostGeo = this.createTerrainConformingGrid(
      pos.x,
      pos.y,
      radius * 1.08,
      36,
      1.05,
      baseElev
    );

    const frostDiscMat = this.acquireShader(
      'cryo_frost_disc',
      () => ({
        transparent: true,
        depthWrite: false,
        blending: THREE.AdditiveBlending,
        side: THREE.DoubleSide,
        uniforms: {
          uTime: { value: 0 },
          uProgress: { value: 0 },
          uAlpha: { value: 1.0 }
        },
        vertexShader: `
          varying vec2 vUv;
          void main() {
            vUv = uv;
            gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
          }
        `,
        fragmentShader: `
          uniform float uTime;
          uniform float uProgress;
          uniform float uAlpha;
          varying vec2 vUv;

          float hash(vec2 p) {
            return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453123);
          }

          // Voronoi cellular distance for crystalline ice fracture network
          float voronoiCracks(vec2 x) {
            vec2 n = floor(x);
            vec2 f = fract(x);
            float md = 8.0;
            vec2 mr = vec2(0.0);
            for (int j = -1; j <= 1; j++) {
              for (int i = -1; i <= 1; i++) {
                vec2 g = vec2(float(i), float(j));
                vec2 o = vec2(hash(n + g), hash(n + g + vec2(17.0, 31.0)));
                vec2 r = g + o - f;
                float d = dot(r, r);
                if (d < md) {
                  md = d;
                  mr = r;
                }
              }
            }
            return sqrt(md);
          }

          void main() {
            vec2 p = (vUv - 0.5) * 2.0;
            float r = length(p);
            if (r > 1.0) discard;

            // Rapid outward freeze expansion over the first 0.25s
            float expandR = smoothstep(0.0, 0.08, uProgress);
            if (r > expandR) discard;

            float a = atan(p.y, p.x);

            // Crystalline ice fracture lines & radial frost veins
            float cell = voronoiCracks(p * 6.5);
            float iceCracks = exp(-pow((cell - 0.48) / 0.045, 2.0)) * 1.25;
            float fineCracks = exp(-pow((voronoiCracks(p * 13.0) - 0.46) / 0.05, 2.0)) * 0.65;
            float radialVeins = pow(0.5 + 0.5 * cos(a * 16.0 + sin(r * 10.0) * 1.5), 6.0) * smoothstep(0.15, 0.85, r);

            // Organic fractured ice glaze (zero crisp concentric circles or tick marks)
            float innerMix = smoothstep(0.32, 0.0, r + (cell - 0.5) * 0.3) * 0.7;
            float outerRime = exp(-pow((r - 0.84 - (cell - 0.5) * 0.16) / 0.08, 2.0)) * 0.85;

            // Shimmering cold mist wave
            float mistPulse = 0.5 + 0.5 * sin(r * 14.0 - uTime * 2.4 + a * 2.0);

            vec3 deepGlacier = vec3(0.04, 0.32, 0.68);
            vec3 brightCyan = vec3(0.22, 0.78, 0.98);
            vec3 frostWhite = vec3(0.88, 0.97, 1.0);
            vec3 orbitalGold = vec3(1.0, 0.84, 0.32);

            float frostPattern = iceCracks + fineCracks + radialVeins * 0.65 + outerRime;
            vec3 col = mix(deepGlacier, brightCyan, clamp(frostPattern * 0.65 + mistPulse * 0.35, 0.0, 1.0));
            col = mix(col, frostWhite, clamp(iceCracks * 0.75 + outerRime * 0.6, 0.0, 1.0));
            col = mix(col, orbitalGold, clamp(innerMix * 0.45, 0.0, 1.0));

            float baseSheet = 0.28 * (1.0 - r * 0.42);
            float edgeSoft = smoothstep(1.0, 0.72, r + (cell - 0.5) * 0.25);
            float alpha = clamp((baseSheet + frostPattern * 0.68) * edgeSoft * uAlpha, 0.0, 1.0);

            gl_FragColor = vec4(col * 1.18, alpha);
          }
        `
      }),
      { uTime: 0, uProgress: 0, uAlpha: 1.0 }
    );

    const frostDiscMesh = new THREE.Mesh(frostGeo, frostDiscMat);
    frostDiscMesh.position.set(pos.x, baseElev, pos.y);
    group.add(frostDiscMesh);

    // 18 3D asymmetric carved crystalline ice shards (zero ConeGeometry)
    const crystalMeshes: ActiveCryogenicFieldVFX['crystalMeshes'] = [];
    const crystalGeo = this.createJaggedShardGeo(11.5, 58, 5, 77);

    for (let i = 0; i < 18; i++) {
      const isInner = i < 8;
      const ringAngle = isInner
        ? (i / 8) * Math.PI * 2
        : ((i - 8) / 10) * Math.PI * 2 + 0.18;
      const ringDist = isInner ? radius * 0.24 : radius * (0.65 + (i % 3) * 0.10);
      const cx = pos.x + Math.cos(ringAngle) * ringDist;
      const cz = pos.y + Math.sin(ringAngle) * ringDist;
      const cElev = this.getTerrainHeight(cx, cz, baseElev);

      const cMat = this.acquireBasicMat(i % 2 === 0 ? 0x7dd3fc : 0xbae6fd, 0.92, THREE.AdditiveBlending, THREE.DoubleSide, false, null);
      const cMesh = new THREE.Mesh(crystalGeo, cMat);
      cMesh.position.set(cx, cElev, cz);

      // Tilt ice spikes slightly outward from the center like a shatter crown
      const tiltAngle = isInner ? 0.35 : 0.22;
      cMesh.rotation.y = -ringAngle + Math.PI * 0.5;
      cMesh.rotation.x = Math.sin(ringAngle) * tiltAngle;
      cMesh.rotation.z = -Math.cos(ringAngle) * tiltAngle;

      const scaleXZ = isInner ? 1.25 : 1.05 + (i % 3) * 0.25;
      const targetScaleY = isInner ? 1.45 : 1.10 + (i % 4) * 0.35;
      cMesh.scale.set(scaleXZ, 0.05, scaleXZ);
      group.add(cMesh);

      crystalMeshes.push({
        mesh: cMesh,
        mat: cMat,
        targetScaleY
      });
    }

    // 20 drifting frost/snowflake diamond particles hovering above the frozen field
    const snowParticles: ActiveCryogenicFieldVFX['snowParticles'] = [];
    for (let i = 0; i < 20; i++) {
      const sMat = this.acquireBasicMat(0xe0f2fe, 0.85, THREE.AdditiveBlending, THREE.FrontSide, false, null);
      const sMesh = new THREE.Mesh(this.sharedSparkGeo, sMat);
      sMesh.userData.isSharedGeo = true;
      const sScale = 2.8 + (i % 3) * 1.4;
      sMesh.scale.set(sScale, sScale, sScale);
      group.add(sMesh);
      snowParticles.push({
        mesh: sMesh,
        mat: sMat,
        angle: (i / 20) * Math.PI * 2,
        dist: radius * (0.15 + ((i * 0.17) % 0.78)),
        yOffset: 8 + (i % 6) * 7,
        speedY: 10 + (i % 4) * 4,
        driftSpeed: 0.4 + (i % 3) * 0.25
      });
    }

    this.triggerSharedOrbitalLight(pos, baseElev, 0x38bdf8, 3.6, radius * 2.2, duration);
    const pointLight = this.sharedOrbitalLight;

    this.group.add(group);
    this.activeCryoFields.push({
      group,
      frostDiscMesh,
      frostDiscMat,
      crystalMeshes,
      snowParticles,
      pointLight,
      pos: { x: pos.x, y: pos.y },
      radius,
      baseElev,
      elapsed: 0,
      duration: Math.max(0.5, duration)
    });
  }

  // ============================================================================
  // STAGE 1 BOSS TENTACLE STRIKE — TERRAIN-CONFORMING BIO-SHOCKWAVE & DEBRIS
  // ============================================================================
  public spawnTentacleImpact(
    pos: Vector2,
    radius: number = 85,
    elevation: number = 0
  ): void {
    const baseElev = this.getTerrainHeight(pos.x, pos.y, elevation);
    this.spawnRealisticExplosion(pos, baseElev, Math.max(60, radius * 0.72), 'void', baseElev + 10);

    // 1. Terrain-Conforming Turbulent Crimson Bio-Tremor Mist & Fissure Rays (zero circular rings)
    const waveGeo = this.createTerrainConformingGrid(
      pos.x,
      pos.y,
      radius * 1.25,
      20,
      1.5,
      baseElev
    );
    const waveMat = this.acquireShader(
      'tentacle_impact_wave',
      () => ({
        transparent: true,
        depthWrite: false,
        blending: THREE.AdditiveBlending,
        side: THREE.DoubleSide,
        uniforms: {
          uProgress: { value: 0.05 },
          uAlpha: { value: 1.0 }
        },
        vertexShader: `
          varying vec2 vUv;
          void main() {
            vUv = uv * 2.0 - 1.0;
            gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
          }
        `,
        fragmentShader: `
          uniform float uProgress;
          uniform float uAlpha;
          varying vec2 vUv;
          void main() {
            float r = length(vUv);
            float a = atan(vUv.y, vUv.x);
            float wisp = 0.5 + 0.5 * sin(vUv.x * 8.0 + cos(vUv.y * 7.0 + uProgress * 5.0) * 1.4);
            float warpedR = r - (wisp - 0.5) * 0.36;
            if (warpedR > 1.0) discard;

            float wavePos = mix(0.15, 0.78, uProgress) + (wisp - 0.5) * 0.25;
            float bioGust = exp(-pow((warpedR - wavePos) / 0.14, 2.0)) * smoothstep(0.2, 0.85, wisp);
            float rays = pow(abs(cos(a * 6.0 + r * 4.5 + wisp * 2.0)), 8.0) * smoothstep(0.90, 0.08, warpedR) * (1.0 - uProgress);
            float outerMask = 1.0 - smoothstep(0.72, 1.0, warpedR);

            float intensity = (bioGust * 1.15 + rays * 0.85) * outerMask;
            if (intensity < 0.015) discard;

            vec3 magenta = vec3(0.85, 0.27, 0.94);
            vec3 crimson = vec3(0.98, 0.14, 0.38);
            vec3 coreWhite = vec3(1.0, 0.85, 0.92);

            vec3 col = mix(magenta, crimson, clamp(rays + bioGust * 0.5, 0.0, 1.0));
            col = mix(col, coreWhite, clamp(bioGust * 0.55, 0.0, 1.0));

            gl_FragColor = vec4(col * 1.1, clamp(intensity * uAlpha, 0.0, 1.0));
          }
        `
      }),
      { uProgress: 0.05, uAlpha: 1.0 }
    );
    const waveMesh = new THREE.Mesh(waveGeo, waveMat);
    waveMesh.position.set(pos.x, baseElev, pos.y);
    this.group.add(waveMesh);
    this.activeTentacleImpacts.push({
      mesh: waveMesh,
      mat: waveMat,
      elapsed: 0,
      maxLifetime: 0.45
    });

    // 2. Crimson & Magenta Bio-Sparks erupting outward from crater impact
    for (let s = 0; s < 14; s++) {
      const sAngle = (s / 14) * Math.PI * 2 + (Math.random() - 0.5) * 0.35;
      const spd = 120 + Math.random() * 170;
      const m = new THREE.Mesh(
        this.sharedSparkGeo,
        this.acquireBasicMat(s % 3 === 0 ? 0xffccd5 : s % 3 === 1 ? 0xf43f5e : 0xd946ef, 0.95, THREE.AdditiveBlending, THREE.FrontSide, true, null)
      );
      m.userData.isSharedGeo = true;
      m.position.set(pos.x, baseElev + 6, pos.y);
      const sc = 2.0 + Math.random() * 1.4;
      m.scale.setScalar(sc);
      this.group.add(m);
      this.orbitalParticles.push({
        mesh: m,
        kind: 'spark',
        vx: Math.cos(sAngle) * spd,
        vy: 90 + Math.random() * 140,
        vz: Math.sin(sAngle) * spd,
        rotSpeedX: 6,
        rotSpeedY: 8,
        rotSpeedZ: 0,
        baseScale: sc,
        endScale: 0.2,
        lifetime: 0.36 + Math.random() * 0.14,
        maxLifetime: 0.50,
        groundY: baseElev
      });
    }

    // 3. Tumbling crater soil & dark chitin shards
    for (let d = 0; d < 8; d++) {
      const dAngle = (d / 8) * Math.PI * 2 + Math.random() * 0.4;
      const spd = 85 + Math.random() * 110;
      const m = new THREE.Mesh(
        this.sharedDebrisGeo,
        new THREE.MeshBasicMaterial({
          color: d % 2 === 0 ? 0x3b183f : 0x262129,
          transparent: true,
          opacity: 0.92
        })
      );
      const rOff = 14 + Math.random() * 24;
      m.position.set(pos.x + Math.cos(dAngle) * rOff, baseElev + 5, pos.y + Math.sin(dAngle) * rOff);
      const sc = 3.2 + Math.random() * 2.2;
      m.scale.set(sc, sc * 0.75, sc * 1.1);
      this.group.add(m);
      this.orbitalParticles.push({
        mesh: m,
        kind: 'debris',
        vx: Math.cos(dAngle) * spd,
        vy: 140 + Math.random() * 110,
        vz: Math.sin(dAngle) * spd,
        rotSpeedX: 5 + Math.random() * 5,
        rotSpeedY: 6 + Math.random() * 5,
        rotSpeedZ: 4,
        baseScale: sc,
        endScale: sc,
        lifetime: 0.55 + Math.random() * 0.15,
        maxLifetime: 0.70,
        groundY: baseElev + 1.5
      });
    }
  }

  /**
   * Swirling molten bio-lava explosion for the Stage 1 Titan's Elemental Barrage balls.
   * Renders a boiling 3D spiral-vortex magma dome, terrain-conforming swirling lava ground pool,
   * twin counter-rotating swirl rings, and glowing molten globule embers.
   */
  public spawnLavaSwirlExplosion(
    pos: Vector2,
    radius: number = 65,
    elevation: number = 0,
    impactZ?: number
  ): void {
    const baseElev = this.getTerrainHeight(pos.x, pos.y, elevation);
    const burstY = impactZ !== undefined ? Math.max(baseElev + 8, impactZ) : baseElev + 12;
    const spinSign = Math.random() < 0.5 ? 1 : -1;

    // Volumetric magma fireball, billowing smoke plumes & fiery sparks
    this.spawnRealisticExplosion(pos, baseElev, Math.max(78, radius * 1.15), 'lava', impactZ);

    const grp = new THREE.Group();
    grp.position.set(pos.x, 0, pos.y);
    this.group.add(grp);

    // 1. Undulating Rising Molten Magma Plume Flame Column (zero SphereGeometry)
    const domeGeo = this.createOrganicPlumeColumnGeo(radius * 0.14, radius * 0.42, radius * 0.72, 16, 8, 0.34, 1.6);
    const domeMat = this.acquireShader(
      'lava_swirl_dome',
      () => ({
        transparent: true,
        depthWrite: false,
        blending: THREE.NormalBlending,
        side: THREE.DoubleSide,
        uniforms: {
          uTime: { value: 0 },
          uProgress: { value: 0 },
          uAlpha: { value: 1.0 },
          uSpin: { value: 1 }
        },
        vertexShader: `
          uniform float uTime;
          uniform float uProgress;
          varying vec3 vLocalPos;
          varying vec3 vViewNormal;
          varying vec3 vViewDir;

          void main() {
            // Boiling convective surface displacement
            float boil = sin(position.x * 0.16 + uTime * 11.0)
                       * cos(position.y * 0.18 - uTime * 9.5)
                       * sin(position.z * 0.16 + uTime * 10.2);
            vec3 displaced = position + normal * (boil * 3.2 * (1.0 - uProgress * 0.6));
            vLocalPos = normalize(position);
            vec4 mvPos = modelViewMatrix * vec4(displaced, 1.0);
            vViewNormal = normalize(normalMatrix * normal);
            vViewDir = normalize(-mvPos.xyz);
            gl_Position = projectionMatrix * mvPos;
          }
        `,
        fragmentShader: `
          uniform float uTime;
          uniform float uProgress;
          uniform float uAlpha;
          uniform float uSpin;
          varying vec3 vLocalPos;
          varying vec3 vViewNormal;
          varying vec3 vViewDir;

          void main() {
            float ndotv = clamp(abs(dot(normalize(vViewNormal), normalize(vViewDir))), 0.0, 1.0);
            float angle = atan(vLocalPos.z, vLocalPos.x);
            float lat = vLocalPos.y;

            // Helical swirling magma currents wrapping around the fireball
            float swirlCoord = angle * 3.0 * uSpin + lat * 7.5 - uTime * 8.5;
            float wave1 = sin(swirlCoord + sin(lat * 9.0 + uTime * 6.0) * 1.4);
            float wave2 = cos(angle * 5.0 * uSpin - lat * 11.0 + uTime * 7.2 + wave1 * 1.2);
            float magma = clamp(0.5 + 0.38 * wave1 + 0.28 * wave2, 0.0, 1.0);

            // High-contrast molten lava bands: dark volcanic crust -> deep crimson-red -> incandescent orange -> white-gold core
            vec3 darkCrust = vec3(0.04, 0.01, 0.02);
            vec3 deepLava = vec3(0.68, 0.08, 0.02);
            vec3 hotLava = vec3(0.96, 0.36, 0.03);
            vec3 coreWhite = vec3(1.0, 0.85, 0.28);

            float coolShift = uProgress * 0.35;
            float m = clamp(magma - coolShift * 0.45, 0.0, 1.0);
            vec3 col = mix(darkCrust, deepLava, smoothstep(0.24, 0.54, m));
            col = mix(col, hotLava, smoothstep(0.52, 0.80, m));
            col = mix(col, coreWhite, smoothstep(0.78, 0.96, m) * (1.0 - uProgress * 0.5));

            // Subtle dark-orange rim
            float rim = pow(1.0 - ndotv, 2.2);
            col = mix(col, darkCrust, rim * 0.55);

            float alpha = smoothstep(0.05, 0.35, ndotv) * (0.78 + 0.22 * m) * uAlpha;
            gl_FragColor = vec4(col * 0.92, clamp(alpha, 0.0, 1.0));
          }
        `
      }),
      { uTime: 0, uProgress: 0, uAlpha: 1.0, uSpin: spinSign }
    );
    const domeMesh = new THREE.Mesh(domeGeo, domeMat);
    domeMesh.position.set(0, burstY - 4, 0);
    domeMesh.scale.setScalar(0.25);
    grp.add(domeMesh);

    // 2. Terrain-Conforming Swirling Molten Lava Crater Pool (dark volcanic rock crust rim + incandescent spiral magma core)
    const poolGeo = this.createTerrainConformingGrid(
      pos.x,
      pos.y,
      radius * 1.65,
      24,
      1.6,
      baseElev
    );
    const poolMat = this.acquireShader(
      'lava_swirl_pool',
      () => ({
        transparent: true,
        depthWrite: false,
        blending: THREE.NormalBlending,
        side: THREE.DoubleSide,
        uniforms: {
          uTime: { value: 0 },
          uProgress: { value: 0 },
          uAlpha: { value: 1.0 },
          uSpin: { value: 1 }
        },
        vertexShader: `
          varying vec2 vUv;
          void main() {
            vUv = uv * 2.0 - 1.0;
            gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
          }
        `,
        fragmentShader: `
          uniform float uTime;
          uniform float uProgress;
          uniform float uAlpha;
          uniform float uSpin;
          varying vec2 vUv;

          void main() {
            float r = length(vUv);
            float a = atan(vUv.y, vUv.x);

            // Jagged organic volcanic crater edge
            float edgeJagged = 0.07 * sin(a * 9.0 + 1.3) + 0.04 * cos(a * 15.0 - 0.8);
            float rw = r + edgeJagged * smoothstep(0.35, 0.95, r);
            if (rw > 0.98) discard;

            // Logarithmic spiral lava vortex arms rotating around the blast crater
            float spiralA = sin(a * 4.0 * uSpin - r * 12.5 + uTime * 8.5 + sin(r * 9.5 - uTime * 5.5) * 1.2);
            float spiralB = cos(a * 7.0 * uSpin - r * 18.0 + uTime * 11.0);
            float swirl = clamp(0.5 + 0.36 * spiralA + 0.24 * spiralB, 0.0, 1.0);

            // Expanding outer crater radius
            float expandR = mix(0.28, 0.92, 1.0 - pow(1.0 - min(1.0, uProgress * 2.2), 2.0));
            if (rw > expandR + 0.06) discard;

            // Dark obsidian volcanic rock crust rim + glowing spiral magma channels
            vec3 obsidianCrust = vec3(0.05, 0.03, 0.04);
            vec3 deepMagma = vec3(0.75, 0.10, 0.03);
            vec3 orangeLava = vec3(1.0, 0.46, 0.06);
            vec3 whiteGold = vec3(1.0, 0.94, 0.52);

            // Center is hot boiling magma; outer ring (rw > 0.58) cools into dark volcanic rock with glowing cracks
            float coreHeat = smoothstep(expandR * 0.95, 0.08, rw);
            float lavaFactor = clamp(swirl * (0.45 + 0.85 * coreHeat) - uProgress * 0.28, 0.0, 1.0);

            vec3 col = mix(obsidianCrust, deepMagma, smoothstep(0.26, 0.52, lavaFactor));
            col = mix(col, orangeLava, smoothstep(0.50, 0.78, lavaFactor));
            col = mix(col, whiteGold, smoothstep(0.76, 0.96, lavaFactor) * coreHeat);

            float hdrBoost = 0.78 + 0.42 * smoothstep(0.58, 0.92, lavaFactor);
            float outerFade = smoothstep(expandR + 0.05, expandR - 0.14, rw);
            float alpha = clamp((0.92 * outerFade) * uAlpha, 0.0, 1.0);
            gl_FragColor = vec4(col * hdrBoost, alpha);
          }
        `
      }),
      { uTime: 0, uProgress: 0, uAlpha: 1.0, uSpin: spinSign }
    );
    const poolMesh = new THREE.Mesh(poolGeo, poolMat);
    poolMesh.position.set(0, baseElev, 0);
    grp.add(poolMesh);

    // 3. Swirling Molten Ember Whisker Ribbons (zero RingGeometry)
    const ribbonPtsA: THREE.Vector3[] = [];
    const ribbonPtsB: THREE.Vector3[] = [];
    for (let k = 0; k <= 12; k++) {
      const a = (k / 12) * Math.PI * 1.4;
      const rA = radius * (0.28 + (k / 12) * 0.18);
      ribbonPtsA.push(new THREE.Vector3(Math.cos(a) * rA, k * 2.5, Math.sin(a) * rA));
      const rB = radius * (0.18 + (k / 12) * 0.16);
      ribbonPtsB.push(new THREE.Vector3(Math.cos(-a) * rB, k * 3.0, Math.sin(-a) * rB));
    }
    const ringGeoA = this.createJaggedRibbonGeometry(ribbonPtsA, 6.5);
    const ringAMat = this.acquireBasicMat(0xff9e2c, 0.48, THREE.AdditiveBlending, THREE.DoubleSide, false, null);
    const ringA = new THREE.Mesh(ringGeoA, ringAMat);
    ringA.position.set(0, burstY + 2, 0);
    grp.add(ringA);

    const ringGeoB = this.createJaggedRibbonGeometry(ribbonPtsB, 5.2);
    const ringBMat = this.acquireBasicMat(0xfef08a, 0.45, THREE.AdditiveBlending, THREE.DoubleSide, false, null);
    const ringB = new THREE.Mesh(ringGeoB, ringBMat);
    ringB.position.set(0, burstY + 5, 0);
    grp.add(ringB);

    this.activeLavaSwirls.push({
      group: grp,
      domeMesh,
      domeMat,
      poolMesh,
      poolMat,
      ringA,
      ringAMat,
      ringB,
      ringBMat,
      elapsed: 0,
      maxLifetime: 1.45,
      spinSign
    });

    // 4. Rising Molten Globules / Glowing Magma Embers
    for (let s = 0; s < 10; s++) {
      const sAngle = (s / 10) * Math.PI * 2 + (Math.random() - 0.5) * 0.4;
      const spd = 95 + Math.random() * 145;
      const m = new THREE.Mesh(
        this.sharedSparkGeo,
        this.acquireBasicMat(
          s % 3 === 0 ? 0xfef08a : s % 3 === 1 ? 0xf43f5e : 0xe879f9,
          0.95,
          THREE.AdditiveBlending,
          THREE.FrontSide,
          true,
          null
        )
      );
      m.userData.isSharedGeo = true;
      m.position.set(pos.x, burstY, pos.y);
      const sc = 2.4 + Math.random() * 1.8;
      m.scale.setScalar(sc);
      this.group.add(m);
      this.orbitalParticles.push({
        mesh: m,
        kind: 'spark',
        vx: Math.cos(sAngle) * spd,
        vy: 110 + Math.random() * 130,
        vz: Math.sin(sAngle) * spd,
        rotSpeedX: 7,
        rotSpeedY: 9,
        rotSpeedZ: 5,
        baseScale: sc,
        endScale: 0.25,
        lifetime: 0.42 + Math.random() * 0.18,
        maxLifetime: 0.60,
        groundY: baseElev
      });
    }
  }

  public update(dt: number, camera: THREE.Camera): void {
    // 0. Update pooled shared orbital PointLight decay (smooth single light without recompilations)
    if (this.sharedOrbitalLightTimer > 0) {
      this.sharedOrbitalLightTimer = Math.max(0, this.sharedOrbitalLightTimer - dt);
      const t = this.sharedOrbitalLightTimer / this.sharedOrbitalLightMaxDuration;
      this.sharedOrbitalLight.intensity = this.sharedOrbitalLightPeakIntensity * t * t;
    } else {
      this.sharedOrbitalLight.intensity = 0;
    }

    // 0A. Update Phase One: Orbital Target Locks
    for (let i = this.targetLocks.length - 1; i >= 0; i--) {
      const lock = this.targetLocks[i];
      lock.elapsed += dt;
      if (lock.elapsed >= lock.totalLifetime) {
        this.group.remove(lock.group);
        lock.reticleMesh.geometry.dispose();
        this.releaseMaterial(lock.reticleMat);
        lock.pilotBeam.geometry.dispose();
        this.releaseMaterial(lock.pilotMat);
        this.targetLocks.splice(i, 1);
        continue;
      }

      const progress = lock.elapsed / lock.strikeDelay;
      lock.reticleMat.uniforms.uTime.value = lock.elapsed;
      lock.reticleMat.uniforms.uProgress.value = progress;

      if (lock.elapsed <= lock.strikeDelay) {
        lock.reticleMat.uniforms.uAlpha.value = Math.min(1.0, 0.35 + progress * 0.75);
        lock.pilotMat.opacity = Math.min(0.65, 0.15 + progress * 0.5);
        const s = 1.0 - Math.min(1.0, progress) * 0.55;
        lock.pilotBeam.scale.set(s, 1, s);
      } else {
        // Persist briefly under the descending beam impact, then fade smoothly
        const postT = (lock.elapsed - lock.strikeDelay) / (lock.totalLifetime - lock.strikeDelay);
        lock.reticleMat.uniforms.uAlpha.value = Math.max(0.0, 1.0 - postT);
        lock.pilotMat.opacity = 0.0;
      }
    }

    // 0B. Update Phases Two, Three & Four: Orbital Beam, Shockwave, Light & Scorch Aftermath
    for (let i = this.orbitalSequences.length - 1; i >= 0; i--) {
      const seq = this.orbitalSequences[i];
      seq.elapsed += dt;
      if (seq.elapsed >= seq.totalDuration) {
        this.disposeOrbitalSequence(seq);
        this.orbitalSequences.splice(i, 1);
        continue;
      }

      const tBeam = seq.elapsed / seq.beamDuration;
      if (tBeam <= 1.0) {
        // Rapid initial strike punch, brief peak plateau (0.05..0.45), smooth fade (0.45..1.0)
        const punch = tBeam < 0.08 ? tBeam / 0.08 : 1.0;
        const decay = tBeam > 0.42 ? 1.0 - (tBeam - 0.42) / 0.58 : 1.0;
        const beamIntensity = Math.max(0.0, punch * Math.pow(decay, 1.25));
        const widthScale = 0.35 + 0.65 * Math.sin(Math.min(1.0, tBeam * 1.1) * Math.PI * 0.5) * decay;

        seq.coreMat.uniforms.uTime.value = seq.elapsed;
        seq.coreMat.uniforms.uIntensity.value = beamIntensity;
        seq.coreMesh.scale.set(widthScale, 1, widthScale);

        seq.midMat.uniforms.uTime.value = seq.elapsed;
        seq.midMat.uniforms.uIntensity.value = beamIntensity;
        seq.midMesh.scale.set(0.55 + 0.45 * decay, 1, 0.55 + 0.45 * decay);

        seq.outerMat.uniforms.uIntensity.value = beamIntensity;
        seq.apertureMat.uniforms.uTime.value = seq.elapsed;
        seq.apertureMat.uniforms.uIntensity.value = beamIntensity;

        for (let n = 0; n < seq.needleMats.length; n++) {
          seq.needleMats[n].opacity = 0.75 * beamIntensity;
        }

        // Re-jitter electric arcs (35ms for standard strike, 70ms for lightweight sub-strikes)
        seq.arcJitterTimer += dt;
        const beamRadiusBase = Math.max(28, seq.radius * 0.14);
        const jitterInterval = seq.lightningLines.length <= 3 ? 0.07 : 0.035;
        if (seq.arcJitterTimer >= jitterInterval) {
          seq.arcJitterTimer = 0;
          for (let a = 0; a < seq.lightningLines.length; a++) {
            const arc = seq.lightningLines[a];
            const pts = this.generateOrbitalArcPoints(
              beamRadiusBase,
              seq.radius,
              arc.isGroundArc,
              arc.baseAngle,
              seq.elapsed
            );
            arc.line.geometry.setFromPoints(pts);
            arc.mat.opacity = 0.95 * beamIntensity;
          }
        }
      } else {
        seq.coreMesh.visible = false;
        seq.midMesh.visible = false;
        seq.outerMesh.visible = false;
        seq.apertureMesh.visible = false;
        seq.needlesGroup.visible = false;
        for (let a = 0; a < seq.lightningLines.length; a++) {
          seq.lightningLines[a].line.visible = false;
        }
      }

      // Impact Flash (0.00s -> 0.50s)
      const tFlash = seq.elapsed / 0.50;
      if (tFlash <= 1.0) {
        seq.impactFlashMat.uniforms.uTime.value = seq.elapsed;
        seq.impactFlashMat.uniforms.uIntensity.value = Math.pow(1.0 - tFlash, 1.35);
        if (seq.pointLight !== this.sharedOrbitalLight) {
          seq.pointLight.intensity = 8.5 * Math.pow(1.0 - tFlash, 1.5);
        }
      } else {
        seq.impactFlashMesh.visible = false;
        if (seq.pointLight !== this.sharedOrbitalLight) {
          seq.pointLight.intensity = 0;
        }
      }

      // Expanding Shockwave Ring (0.00s -> 0.78s)
      const tWave = seq.elapsed / 0.78;
      if (tWave <= 1.0) {
        // Ease-out expansion to the ultimate's AoE radius
        const easedProgress = 1.0 - Math.pow(1.0 - tWave, 2.1);
        seq.shockwaveMat.uniforms.uProgress.value = Math.max(0.06, easedProgress * 0.95);
        seq.shockwaveMat.uniforms.uAlpha.value = Math.pow(1.0 - tWave, 1.15);
      } else {
        seq.shockwaveMesh.visible = false;
      }

      // Scorched Ground & Molten Cracks Aftermath (0.00s -> 2.65s)
      const tScorch = seq.elapsed / seq.totalDuration;
      seq.scorchMat.uniforms.uAge.value = tScorch;
      seq.scorchMat.uniforms.uHeat.value = Math.max(0.0, Math.pow(1.0 - Math.min(1.0, seq.elapsed / 1.85), 1.4));
    }

    // 0C. Update Pooled Orbital Particles (Sparks, Debris, Dust)
    for (let i = this.orbitalParticles.length - 1; i >= 0; i--) {
      const p = this.orbitalParticles[i];
      p.lifetime -= dt;
      if (p.lifetime <= 0) {
        this.group.remove(p.mesh);
        this.releaseMaterial(p.mesh.material as THREE.Material);
        this.orbitalParticles.splice(i, 1);
        continue;
      }

      const ageRatio = 1.0 - p.lifetime / p.maxLifetime;
      p.mesh.position.x += p.vx * dt;
      p.mesh.position.y += p.vy * dt;
      p.mesh.position.z += p.vz * dt;

      if (p.kind === 'spark') {
        p.vy -= 360 * dt;
        p.vx *= 0.98;
        p.vz *= 0.98;
        p.mesh.rotation.x += p.rotSpeedX * dt;
        p.mesh.rotation.y += p.rotSpeedY * dt;
        (p.mesh.material as THREE.MeshBasicMaterial).opacity = Math.pow(1.0 - ageRatio, 1.1);
      } else if (p.kind === 'debris') {
        p.vy -= 480 * dt;
        if (p.mesh.position.y < p.groundY) {
          p.mesh.position.y = p.groundY;
          p.vy = Math.abs(p.vy) * 0.35;
          p.vx *= 0.65;
          p.vz *= 0.65;
        }
        p.mesh.rotation.x += p.rotSpeedX * dt;
        p.mesh.rotation.y += p.rotSpeedY * dt;
        p.mesh.rotation.z += p.rotSpeedZ * dt;
        (p.mesh.material as THREE.MeshBasicMaterial).opacity = 1.0 - Math.pow(ageRatio, 2.2);
      } else if (p.kind === 'dust') {
        p.vx *= 0.93;
        p.vz *= 0.93;
        const s = p.baseScale + (p.endScale - p.baseScale) * ageRatio;
        p.mesh.scale.set(s, s * 0.78, 1);
        p.mesh.quaternion.copy(camera.quaternion);
        (p.mesh.material as THREE.MeshBasicMaterial).opacity = 0.52 * (1.0 - ageRatio);
      }
    }

    // 1. Update expanding organic ripple waves
    for (let i = this.rings.length - 1; i >= 0; i--) {
      const r = this.rings[i];
      r.lifetime -= dt;
      if (r.lifetime <= 0) {
        this.group.remove(r.mesh);
        if (!r.mesh.userData?.isSharedGeo) r.mesh.geometry.dispose();
        this.releaseMaterial(r.mesh.material as THREE.Material);
        this.rings.splice(i, 1);
        continue;
      }
      const t = 1 - r.lifetime / r.maxLifetime;
      const mat = r.mesh.material as THREE.ShaderMaterial | THREE.MeshBasicMaterial;
      if ((mat as THREE.ShaderMaterial).uniforms?.uProgress) {
        const sm = mat as THREE.ShaderMaterial;
        sm.uniforms.uProgress.value = t;
        sm.uniforms.uAlpha.value = Math.pow(1 - t, 1.15);
        const s = r.maxRadius * (0.45 + 0.65 * Math.pow(t, 0.72)) * (r.mesh.userData?.isSharedGeo ? 2.2 : 1.0);
        r.mesh.scale.set(s, s, 1);
      } else {
        const s = (1 + t * (r.maxRadius / r.currentRadius)) * (r.mesh.userData?.isSharedGeo ? 2.2 : 1.0);
        r.mesh.scale.set(s, s, s);
        (mat as THREE.MeshBasicMaterial).opacity = (1 - t) * 0.9;
      }
    }

    // 1B. Update Realistic Volumetric Explosion Fireballs & Smoke Clouds
    for (let i = this.explosionClouds.length - 1; i >= 0; i--) {
      const cl = this.explosionClouds[i];
      cl.elapsed += dt;
      if (cl.elapsed >= cl.duration) {
        this.group.remove(cl.mesh);
        if (!cl.mesh.userData?.isSharedGeo) cl.mesh.geometry.dispose();
        this.releaseMaterial(cl.mat);
        this.explosionClouds.splice(i, 1);
        continue;
      }
      const p = cl.elapsed / cl.duration;
      const damp = Math.exp(-cl.drag * dt);
      cl.vx *= damp;
      cl.vz *= damp;
      cl.vy = cl.vy * Math.exp(-1.8 * dt) + cl.lift * dt;
      cl.mesh.position.x += cl.vx * dt;
      cl.mesh.position.y += cl.vy * dt;
      cl.mesh.position.z += cl.vz * dt;
      cl.mesh.quaternion.copy(camera.quaternion);
      const scale = cl.startScale + (cl.endScale - cl.startScale) * (1 - Math.pow(1 - p, 2.1));
      cl.mesh.scale.setScalar(scale);
      cl.mat.uniforms.uProgress.value = p;
    }

    // 1C. Update Ballistic Internal-Rupture Ichor Splatter Droplets
    for (let i = this.splatterDroplets.length - 1; i >= 0; i--) {
      const dr = this.splatterDroplets[i];
      dr.elapsed += dt;
      if (dr.elapsed >= dr.duration) {
        this.group.remove(dr.mesh);
        if (!dr.mesh.userData?.isSharedGeo) dr.mesh.geometry.dispose();
        this.releaseMaterial(dr.mat);
        this.splatterDroplets.splice(i, 1);
        continue;
      }
      dr.vy -= 740 * dt;
      dr.mesh.position.x += dr.vx * dt;
      dr.mesh.position.y += dr.vy * dt;
      dr.mesh.position.z += dr.vz * dt;

      if (dr.mesh.position.y <= dr.groundY) {
        dr.mesh.position.y = dr.groundY;
        dr.vy = 0;
        dr.vx *= 0.25;
        dr.vz *= 0.25;
        if (!dr.spawnedSplat) {
          dr.spawnedSplat = true;
          this.spawnAlienBloodSplatter(
            { x: dr.mesh.position.x, y: dr.mesh.position.z },
            dr.groundY,
            dr.splatColor,
            0.55 + Math.random() * 0.45
          );
        }
      }
      dr.mesh.quaternion.copy(camera.quaternion);
      const p = dr.elapsed / dr.duration;
      const speed2 = Math.hypot(dr.vx, dr.vy, dr.vz);
      const stretchY = Math.min(2.2, 1.0 + speed2 * 0.003);
      dr.mesh.scale.set(dr.scale / Math.sqrt(stretchY), dr.scale * stretchY, 1);
      dr.mat.uniforms.uAlpha.value = Math.max(0, 0.95 * (1 - Math.pow(p, 1.8)));
    }

    // 2. Update beams & organic rift plumes
    for (let i = this.beams.length - 1; i >= 0; i--) {
      const b = this.beams[i];
      b.lifetime -= dt;
      if (b.lifetime <= 0) {
        this.group.remove(b.mesh);
        b.mesh.geometry.dispose();
        this.releaseMaterial(b.mesh.material as THREE.Material);
        this.beams.splice(i, 1);
        continue;
      }
      const t = 1 - b.lifetime / b.maxLifetime;
      const mat = b.mesh.material as THREE.ShaderMaterial | THREE.MeshBasicMaterial;
      if ((mat as THREE.ShaderMaterial).uniforms?.uProgress) {
        (mat as THREE.ShaderMaterial).uniforms.uProgress.value = t;
      } else {
        (mat as THREE.MeshBasicMaterial).opacity = (1 - t) * 0.85;
      }
    }

    // 3. Update floating damage numbers
    for (let i = this.damageTexts.length - 1; i >= 0; i--) {
      const d = this.damageTexts[i];
      d.lifetime -= dt;
      if (d.lifetime <= 0) {
        this.group.remove(d.sprite);
        if (this.damageSpritePool.length < 128) {
          this.damageSpritePool.push(d.sprite);
        } else {
          d.sprite.material.dispose();
        }
        this.damageTexts.splice(i, 1);
        continue;
      }
      d.sprite.position.y += d.vy * dt;
      const t = 1 - d.lifetime / d.maxLifetime;
      d.sprite.material.opacity = 1 - t;
    }

    // 4. Update dash ghosts
    for (let i = this.ghosts.length - 1; i >= 0; i--) {
      const g = this.ghosts[i];
      g.lifetime -= dt;
      if (g.lifetime <= 0) {
        this.group.remove(g.mesh);
        if (!g.mesh.userData?.isSharedGeo) g.mesh.geometry.dispose();
        this.releaseMaterial(g.mesh.material as THREE.Material);
        this.ghosts.splice(i, 1);
        continue;
      }
      g.mesh.quaternion.copy(camera.quaternion);
      const t = 1 - g.lifetime / g.maxLifetime;
      (g.mesh.material as THREE.MeshBasicMaterial).opacity = (1 - t) * 0.5;
    }

    // 5. Update alien blood decals
    for (let i = this.bloodDecals.length - 1; i >= 0; i--) {
      const b = this.bloodDecals[i];
      b.lifetime -= dt;
      if (b.lifetime <= 0) {
        this.group.remove(b.mesh);
        if (!b.mesh.userData?.isSharedGeo) b.mesh.geometry.dispose();
        this.releaseMaterial(b.mesh.material as THREE.Material);
        this.bloodDecals.splice(i, 1);
        continue;
      }
      if (b.lifetime < 2.2) {
        const mat = b.mesh.material as THREE.ShaderMaterial | THREE.MeshBasicMaterial;
        const alphaVal = (b.lifetime / 2.2) * 0.88;
        if ((mat as THREE.ShaderMaterial).uniforms?.uAlpha) {
          (mat as THREE.ShaderMaterial).uniforms.uAlpha.value = alphaVal;
        } else {
          (mat as THREE.MeshBasicMaterial).opacity = alphaVal;
        }
      }
    }

    // 6. Update LMB Blaster Muzzle Flashes & Impact Sparks
    for (let i = this.blasterFlashes.length - 1; i >= 0; i--) {
      const f = this.blasterFlashes[i];
      f.lifetime -= dt;
      if (f.lifetime <= 0) {
        this.group.remove(f.mesh);
        if (!f.mesh.userData?.isSharedGeo) {
          f.mesh.geometry.dispose();
        }
        this.releaseMaterial(f.mesh.material as THREE.Material);
        this.blasterFlashes.splice(i, 1);
        continue;
      }
      const s = 0.65 + (1.0 - f.lifetime / f.maxLifetime) * 0.65;
      f.mesh.scale.set(s, 1, s);
    }

    // 7. Update RMB Twin Slash Convergence Bursts (Phase 3 Collision -> Phase 4 Dissipation)
    for (let i = this.slashConvergences.length - 1; i >= 0; i--) {
      const sc = this.slashConvergences[i];
      sc.elapsed += dt;
      if (sc.elapsed >= sc.maxLifetime) {
        this.group.remove(sc.group);
        sc.flashMesh.geometry.dispose();
        this.releaseMaterial(sc.flashMat);
        sc.leftBladeMesh.geometry.dispose();
        this.releaseMaterial(sc.leftBladeMat);
        sc.rightBladeMesh.geometry.dispose();
        this.releaseMaterial(sc.rightBladeMat);
        sc.compressionLines.geometry.dispose();
        sc.compressionMat.dispose();
        if (sc.leftCoreMesh) {
          sc.leftCoreMesh.geometry.dispose();
          this.releaseMaterial(sc.leftCoreMat);
        }
        if (sc.rightCoreMesh) {
          sc.rightCoreMesh.geometry.dispose();
          this.releaseMaterial(sc.rightCoreMat);
        }
        this.slashConvergences.splice(i, 1);
        continue;
      }

      if (sc.isScissorSweep && sc.leftBladeGroup && sc.rightBladeGroup) {
        const sweepDur = sc.sweepDuration || 0.22;
        const total = sc.totalSlashes || 1;
        const currentIdx = Math.min(total - 1, Math.floor(sc.elapsed / sweepDur));
        const currentCycleElapsed = sc.elapsed - currentIdx * sweepDur;
        const sweepProgress = Math.min(1.0, currentCycleElapsed / (sweepDur * 0.90));
        const ease = 1.0 - Math.pow(1.0 - sweepProgress, 2.0);

        if (currentIdx < total - 1 || sweepProgress < 1.0) {
          // Both blades visibly sweep inward toward the center forward focal point
          const curXLeft = -60 * (1.0 - ease) + 8 * ease;
          const curXRight = 60 * (1.0 - ease) - 8 * ease;
          sc.leftBladeGroup.position.x = curXLeft;
          sc.rightBladeGroup.position.x = curXRight;
          sc.leftBladeGroup.position.z = 24 + ease * 46; // advance to forward focus
          sc.rightBladeGroup.position.z = 24 + ease * 46;
          sc.leftBladeGroup.rotation.y = -0.95 * (1.0 - ease) + 0.35 * ease;
          sc.rightBladeGroup.rotation.y = 0.95 * (1.0 - ease) - 0.35 * ease;

          // Trailing golden sparks along cutting edges
          if (Math.random() < 0.45) {
            for (let side = -1; side <= 1; side += 2) {
              const spkMesh = new THREE.Mesh(
                this.sharedSparkGeo,
                this.acquireBasicMat(Math.random() < 0.5 ? 0xfffbeb : 0xfbbf24, 0.95, THREE.AdditiveBlending, THREE.FrontSide, true, null)
              );
              spkMesh.userData.isSharedGeo = true;
              const sideX = side < 0 ? curXLeft : curXRight;
              spkMesh.position.set(sc.group.position.x + sideX, sc.group.position.y + 2, sc.group.position.z + 40);
              spkMesh.scale.setScalar(2.0);
              this.group.add(spkMesh);
              this.orbitalParticles.push({
                mesh: spkMesh,
                kind: 'spark',
                vx: (Math.random() - 0.5) * 60,
                vy: 20 + Math.random() * 40,
                vz: (Math.random() - 0.5) * 60,
                rotSpeedX: 4,
                rotSpeedY: 4,
                rotSpeedZ: 0,
                baseScale: 2.0,
                endScale: 0.2,
                lifetime: 0.22,
                maxLifetime: 0.22,
                groundY: sc.elevation || 0
              });
            }
          }
        } else {
          // Final scissor blade meeting! Trigger golden central collision impact
          if (!sc.hasCollided) {
            sc.hasCollided = true;
            sc.flashMesh.visible = true;
            if (sc.focusPos) {
              this.spawnShockwaveRing(sc.focusPos, (sc.radius || 125) * 1.05, 0xfbbf24, (sc.elevation || 0) + 1.5, 0.35);
              this.spawnShockwaveRing(sc.focusPos, (sc.radius || 125) * 0.60, 0xfffbeb, (sc.elevation || 0) + 2.0, 0.25);
              // 18 explosive collision sparks
              for (let s = 0; s < 18; s++) {
                const sAngle = Math.random() * Math.PI * 2;
                const sSpeed = 140 + Math.random() * 180;
                const m = new THREE.Mesh(this.sharedSparkGeo, new THREE.MeshBasicMaterial({
                  color: s % 2 === 0 ? 0xfffbeb : 0xf59e0b,
                  transparent: true,
                  opacity: 0.95,
                  blending: THREE.AdditiveBlending
                }));
                m.position.set(sc.focusPos.x, (sc.elevation || 0) + 8, sc.focusPos.y);
                m.scale.setScalar(2.8);
                this.group.add(m);
                this.orbitalParticles.push({
                  mesh: m,
                  kind: 'spark',
                  vx: Math.cos(sAngle) * sSpeed,
                  vy: 60 + Math.random() * 120,
                  vz: Math.sin(sAngle) * sSpeed,
                  rotSpeedX: 8,
                  rotSpeedY: 8,
                  rotSpeedZ: 0,
                  baseScale: 2.8,
                  endScale: 0.2,
                  lifetime: 0.34,
                  maxLifetime: 0.34,
                  groundY: sc.elevation || 0
                });
              }
            }
          }

          // Follow-through and fade after collision
          const fadeProgress = (sc.elapsed - sweepDur) / (sc.maxLifetime - sweepDur);
          const fade = Math.max(0, 1.0 - fadeProgress);
          sc.flashMat.uniforms.uProgress.value = fadeProgress;
          (sc.leftBladeMat as THREE.MeshBasicMaterial).opacity = 0.95 * fade;
          (sc.rightBladeMat as THREE.MeshBasicMaterial).opacity = 0.95 * fade;
          if (sc.leftCoreMat) sc.leftCoreMat.opacity = 0.98 * fade;
          if (sc.rightCoreMat) sc.rightCoreMat.opacity = 0.98 * fade;
          sc.leftBladeGroup.position.x = 8 + fadeProgress * 14;
          sc.rightBladeGroup.position.x = -8 - fadeProgress * 14;
        }
      } else {
        const p = sc.elapsed / sc.maxLifetime;
        sc.flashMat.uniforms.uProgress.value = p;
        (sc.leftBladeMat as THREE.ShaderMaterial).uniforms.uTime.value = sc.elapsed;
        (sc.leftBladeMat as THREE.ShaderMaterial).uniforms.uAlpha.value = Math.max(0, 1.0 - p * 1.25);
        (sc.rightBladeMat as THREE.ShaderMaterial).uniforms.uTime.value = sc.elapsed;
        (sc.rightBladeMat as THREE.ShaderMaterial).uniforms.uAlpha.value = Math.max(0, 1.0 - p * 1.25);
        // Blades cross inward slightly as they dissipate
        sc.leftBladeMesh.position.x = -10 + p * 16;
        sc.rightBladeMesh.position.x = 10 - p * 16;
        sc.compressionMat.opacity = Math.max(0, (1.0 - p) * 0.9);
        const compScale = 1.0 - p * 0.45;
        sc.compressionLines.scale.set(compScale, 1, compScale);
      }
    }

    // 8. Update Dash Motion Streaks (Phase 1 Acceleration -> Phase 2 Charge -> Phase 4 Recovery)
    for (let i = this.dashTrails.length - 1; i >= 0; i--) {
      const dtTrail = this.dashTrails[i];
      dtTrail.elapsed += dt;
      if (dtTrail.elapsed >= dtTrail.totalLifetime) {
        this.group.remove(dtTrail.group);
        dtTrail.noseConeMesh.geometry.dispose();
        this.releaseMaterial(dtTrail.noseConeMat);
        for (let s = 0; s < dtTrail.streakMeshes.length; s++) {
          dtTrail.streakMeshes[s].geometry.dispose();
          this.releaseMaterial(dtTrail.streakMats[s]);
        }
        this.dashTrails.splice(i, 1);
        continue;
      }
      const fadeStart = dtTrail.dashDuration;
      const alpha =
        dtTrail.elapsed <= fadeStart
          ? 1.0
          : Math.max(0, 1.0 - (dtTrail.elapsed - fadeStart) / (dtTrail.totalLifetime - fadeStart));
      dtTrail.noseConeMat.uniforms.uAlpha.value = alpha * 0.85;
      for (let s = 0; s < dtTrail.streakMats.length; s++) {
        dtTrail.streakMats[s].opacity = alpha * 0.88;
        dtTrail.streakMeshes[s].scale.set(1, 1, 0.75 + 0.35 * Math.sin(dtTrail.elapsed * 28 + s));
      }
    }

    // 9. Update Dash Kinetic Collision Impacts (Phase 3 Impact -> Phase 4 Recovery)
    for (let i = this.dashImpacts.length - 1; i >= 0; i--) {
      const imp = this.dashImpacts[i];
      imp.elapsed += dt;
      if (imp.elapsed >= imp.maxLifetime) {
        this.group.remove(imp.group);
        imp.flashMesh.geometry.dispose();
        this.releaseMaterial(imp.flashMat);
        imp.ringMesh.geometry.dispose();
        this.releaseMaterial(imp.ringMat);
        imp.spikesLine.geometry.dispose();
        imp.spikesMat.dispose();
        if (imp.cracksLine) {
          imp.cracksLine.geometry.dispose();
          imp.cracksMat?.dispose();
        }
        this.dashImpacts.splice(i, 1);
        continue;
      }
      const p = imp.elapsed / imp.maxLifetime;
      const eased = 1.0 - Math.pow(1.0 - p, 2.0);
      imp.flashMat.uniforms.uProgress.value = p;
      imp.ringMat.uniforms.uProgress.value = 0.12 + eased * 0.82;
      imp.ringMat.uniforms.uAlpha.value = Math.pow(1.0 - p, 1.25);
      imp.spikesMat.opacity = Math.pow(1.0 - p, 1.15);
      const spikeExpand = 0.65 + eased * 0.65;
      imp.spikesLine.scale.set(spikeExpand, 1, spikeExpand);

      // Procedural radial ground fracture cracks expansion and linger
      if (imp.cracksLine && imp.cracksMat) {
        const crackExpand = Math.min(1.0, imp.elapsed / 0.12);
        const easedCrack = 1.0 - Math.pow(1.0 - crackExpand, 2.5);
        imp.cracksLine.scale.set(easedCrack, 1, easedCrack);
        imp.cracksMat.opacity = Math.pow(Math.max(0, 1.0 - p), 1.4) * 0.98;
      }
    }

    // 10. Update Ultimate Enhancement A: Active Singularities (Black Hole)
    for (let i = this.activeSingularities.length - 1; i >= 0; i--) {
      const sing = this.activeSingularities[i];
      sing.elapsed += dt;
      if (sing.elapsed >= sing.duration) {
        this.group.remove(sing.group);
        sing.vortexDiscMesh.geometry.dispose();
        this.releaseMaterial(sing.vortexDiscMat);
        sing.coreSphereMesh.geometry.dispose();
        this.releaseMaterial(sing.coreSphereMat);
        sing.accretionRingMesh.geometry.dispose();
        this.releaseMaterial(sing.accretionRingMat);
        for (let d = 0; d < sing.debrisMeshes.length; d++) {
          this.releaseMaterial(sing.debrisMeshes[d].mat);
        }
        this.activeSingularities.splice(i, 1);
        continue;
      }

      const p = sing.elapsed / sing.duration;
      sing.vortexDiscMat.uniforms.uTime.value = sing.elapsed;
      sing.vortexDiscMat.uniforms.uProgress.value = p;
      const fadeOut = p > 0.90 ? (1.0 - p) / 0.10 : Math.min(1.0, sing.elapsed / 0.18);
      sing.vortexDiscMat.uniforms.uAlpha.value = fadeOut;

      // Pulse event horizon sphere & spin accretion ring
      const speedMult = p > 0.73 ? 1.8 : 1.0;
      const lateShake = p > 0.73 ? Math.sin(sing.elapsed * 48.0) * 0.14 : 0;
      const corePulse = (1.0 + 0.18 * Math.sin(sing.elapsed * 14.0) + p * 0.25 + lateShake);
      sing.coreSphereMesh.scale.setScalar(corePulse);
      sing.accretionRingMesh.rotation.z += dt * (4.5 * speedMult);
      sing.accretionRingMesh.rotation.y += dt * (2.2 * speedMult);
      sing.pointLight.intensity = (3.5 + Math.sin(sing.elapsed * 18.0) * 0.8) * fadeOut;

      // Spiral 3D debris chunks inward toward the event horizon (continuous cycling)
      for (let d = 0; d < sing.debrisMeshes.length; d++) {
        const deb = sing.debrisMeshes[d];
        deb.angle += deb.orbitSpeed * (1.0 + p * 1.4) * speedMult * dt;
        deb.distRatio -= 0.28 * speedMult * dt;
        if (deb.distRatio < 0.10) deb.distRatio = 0.92;
        const curR = sing.radius * deb.distRatio;
        const dx = sing.pos.x + Math.cos(deb.angle) * curR;
        const dz = sing.pos.y + Math.sin(deb.angle) * curR;
        const groundH = this.getTerrainHeight(dx, dz, sing.baseElev);
        deb.mesh.position.set(dx, groundH + deb.heightOffset * (0.5 + 0.5 * deb.distRatio), dz);
        deb.mesh.rotation.x += deb.rotSpeed.x * dt;
        deb.mesh.rotation.y += deb.rotSpeed.y * dt;
        const edgeFade = Math.min(1.0, Math.max(0.0, (deb.distRatio - 0.10) / 0.12)) * Math.min(1.0, Math.max(0.0, (0.95 - deb.distRatio) / 0.15));
        deb.mat.opacity = 0.92 * edgeFade * fadeOut;
      }
    }

    // 11. Update Ultimate Enhancement B: Active Convergence Barrages (5-Strike Inward Spiral & Core)
    for (let i = this.activeConvergences.length - 1; i >= 0; i--) {
      const conv = this.activeConvergences[i];
      conv.elapsed += dt;
      if (conv.elapsed >= conv.duration) {
        this.group.remove(conv.group);
        conv.spiralMesh.geometry.dispose();
        this.releaseMaterial(conv.spiralMat);
        conv.coreSphereMesh.geometry.dispose();
        this.releaseMaterial(conv.coreSphereMat);
        conv.coreCageMesh.geometry.dispose();
        this.releaseMaterial(conv.coreCageMat);
        conv.coreHaloMesh.geometry.dispose();
        this.releaseMaterial(conv.coreHaloMat);
        for (let d = 0; d < conv.debrisMeshes.length; d++) {
          this.releaseMaterial(conv.debrisMeshes[d].mat);
        }
        this.activeConvergences.splice(i, 1);
        continue;
      }

      const p = conv.elapsed / conv.duration;
      conv.spiralMat.uniforms.uTime.value = conv.elapsed;
      conv.spiralMat.uniforms.uProgress.value = p;
      conv.spiralMat.uniforms.uAlpha.value = Math.min(1.0, conv.elapsed / 0.12);

      // Grow the central golden core from 0.25x to 1.45x as the 5 strikes converge
      const coreScale = 0.25 + Math.pow(p, 1.25) * 1.25;
      conv.coreSphereMesh.scale.setScalar(coreScale);
      conv.coreCageMesh.scale.setScalar(coreScale * 1.08);
      conv.coreCageMesh.rotation.y += dt * 3.8;
      conv.coreCageMesh.rotation.x += dt * 2.4;
      conv.coreHaloMesh.scale.setScalar(coreScale * 1.15);
      conv.coreHaloMesh.rotation.x = Math.PI * 0.35 + conv.elapsed * 2.5;
      conv.coreHaloMesh.rotation.y = conv.elapsed * 3.2;
      conv.pointLight.intensity = 3.5 + p * 4.5;

      // Levitate & draw debris fragments inward toward the swelling golden core
      for (let d = 0; d < conv.debrisMeshes.length; d++) {
        const deb = conv.debrisMeshes[d];
        deb.angle += dt * (2.0 + p * 3.0);
        const curDist = deb.dist * (1.0 - p * 0.55);
        const dx = conv.pos.x + Math.cos(deb.angle) * curDist;
        const dz = conv.pos.y + Math.sin(deb.angle) * curDist;
        deb.mesh.position.set(dx, deb.baseY + p * 26, dz);
        deb.mesh.rotation.x += dt * 3.0;
        deb.mesh.rotation.y += dt * 4.0;
      }
    }

    // 12. Update Ultimate Enhancement C: Active Cryogenic Fields (Freezing Zone)
    for (let i = this.activeCryoFields.length - 1; i >= 0; i--) {
      const cryo = this.activeCryoFields[i];
      cryo.elapsed += dt;
      if (cryo.elapsed >= cryo.duration) {
        this.group.remove(cryo.group);
        if (cryo.crystalMeshes.length > 0) {
          cryo.crystalMeshes[0].mesh.geometry.dispose();
        }
        for (let c = 0; c < cryo.crystalMeshes.length; c++) {
          this.releaseMaterial(cryo.crystalMeshes[c].mat);
        }
        for (let s = 0; s < cryo.snowParticles.length; s++) {
          this.releaseMaterial(cryo.snowParticles[s].mat);
        }
        cryo.frostDiscMesh.geometry.dispose();
        this.releaseMaterial(cryo.frostDiscMat);
        this.activeCryoFields.splice(i, 1);
        continue;
      }

      const p = cryo.elapsed / cryo.duration;
      const fadeOut = p > 0.88 ? (1.0 - p) / 0.12 : 1.0;
      cryo.frostDiscMat.uniforms.uTime.value = cryo.elapsed;
      cryo.frostDiscMat.uniforms.uProgress.value = p;
      cryo.frostDiscMat.uniforms.uAlpha.value = fadeOut;
      cryo.pointLight.intensity = (3.2 + 0.5 * Math.sin(cryo.elapsed * 6.0)) * fadeOut;

      // Erupt 3D ice spikes over the first 0.22s, then shimmer and fade out at expiration
      const eruptRatio = Math.min(1.0, cryo.elapsed / 0.22);
      const easedErupt = 1.0 - Math.pow(1.0 - eruptRatio, 3.0);
      for (let c = 0; c < cryo.crystalMeshes.length; c++) {
        const cm = cryo.crystalMeshes[c];
        cm.mesh.scale.y = cm.targetScaleY * easedErupt * fadeOut;
        cm.mat.opacity = 0.86 * fadeOut;
      }

      // Swirl cold snowflake/frost particles across the field
      for (let s = 0; s < cryo.snowParticles.length; s++) {
        const sp = cryo.snowParticles[s];
        sp.angle += sp.driftSpeed * dt;
        sp.yOffset += Math.sin(cryo.elapsed * 3.0 + s) * 6.0 * dt;
        const sx = cryo.pos.x + Math.cos(sp.angle) * sp.dist;
        const sz = cryo.pos.y + Math.sin(sp.angle) * sp.dist;
        const sh = this.getTerrainHeight(sx, sz, cryo.baseElev);
        sp.mesh.position.set(sx, sh + sp.yOffset, sz);
        sp.mesh.rotation.y += dt * 2.5;
        sp.mesh.rotation.x += dt * 1.8;
        sp.mat.opacity = 0.82 * fadeOut;
      }
    }

    // 0G. Update Commander LMB Upgrade 2: Active Electric Lightning Bolts (Dynamic Crackle & Jitter)
    for (let i = this.activeElectricBolts.length - 1; i >= 0; i--) {
      const bolt = this.activeElectricBolts[i];
      bolt.elapsed += dt;
      bolt.jitterTimer += dt;

      if (bolt.elapsed >= bolt.maxLifetime) {
        this.group.remove(bolt.group);
        bolt.coreLine.geometry.dispose();
        (bolt.coreLine.material as THREE.Material).dispose();
        for (let g = 0; g < bolt.glowLines.length; g++) {
          bolt.glowLines[g].geometry.dispose();
          (bolt.glowLines[g].material as THREE.Material).dispose();
        }
        for (let b = 0; b < bolt.branchLines.length; b++) {
          bolt.branchLines[b].geometry.dispose();
          (bolt.branchLines[b].material as THREE.Material).dispose();
        }
        if (bolt.targetedBranches) {
          for (const tb of bolt.targetedBranches) {
            tb.coreLine.geometry.dispose();
            (tb.coreLine.material as THREE.Material).dispose();
            tb.glowLine.geometry.dispose();
            (tb.glowLine.material as THREE.Material).dispose();
          }
        }
        bolt.ribbonMesh.geometry.dispose();
        (bolt.ribbonMesh.material as THREE.Material).dispose();
        this.activeElectricBolts.splice(i, 1);
        continue;
      }

      const fade = Math.max(0, 1.0 - bolt.elapsed / bolt.maxLifetime);

      // High-frequency violent re-jittering every 0.035s (in-place buffer update, zero GC churn)
      if (bolt.jitterTimer >= 0.035) {
        bolt.jitterTimer = 0;
        const newCorePts = this.generateLightningPoints(bolt.from, bolt.to, 26, 22);
        bolt.coreLine.geometry.setFromPoints(newCorePts);
        this.updateJaggedRibbonGeometry(bolt.ribbonMesh.geometry, newCorePts, 8.5);
        for (let g = 0; g < bolt.glowLines.length; g++) {
          const newGlowPts = this.generateLightningPoints(bolt.from, bolt.to, 24, 25);
          bolt.glowLines[g].geometry.setFromPoints(newGlowPts);
        }
        if (bolt.targetedBranches) {
          for (const tb of bolt.targetedBranches) {
            const bCorePts = this.generateLightningPoints(tb.from, tb.to, 16, 14);
            tb.coreLine.geometry.setFromPoints(bCorePts);
            if (tb.ribbonMesh) {
              this.updateJaggedRibbonGeometry(tb.ribbonMesh.geometry, bCorePts, 6.0);
            }
            const bGlowPts = this.generateLightningPoints(tb.from, tb.to, 14, 18);
            tb.glowLine.geometry.setFromPoints(bGlowPts);
          }
        }
      }

      (bolt.coreLine.material as THREE.LineBasicMaterial).opacity = fade;
      for (let g = 0; g < bolt.glowLines.length; g++) {
        (bolt.glowLines[g].material as THREE.LineBasicMaterial).opacity = 0.88 * fade;
      }
      for (let b = 0; b < bolt.branchLines.length; b++) {
        (bolt.branchLines[b].material as THREE.LineBasicMaterial).opacity = 0.82 * fade;
      }
      if (bolt.targetedBranches) {
        for (const tb of bolt.targetedBranches) {
          (tb.coreLine.material as THREE.LineBasicMaterial).opacity = fade;
          (tb.glowLine.material as THREE.LineBasicMaterial).opacity = 0.88 * fade;
          if (tb.ribbonMesh) {
            (tb.ribbonMesh.material as THREE.MeshBasicMaterial).opacity = 0.72 * fade;
          }
        }
      }
      (bolt.ribbonMesh.material as THREE.MeshBasicMaterial).opacity = 0.48 * fade;
    }

    // 0H. Update Commander LMB Upgrade 1: Traveling Icy Projectiles with Trails & Frost Particles
    for (let i = this.activeChillBeams.length - 1; i >= 0; i--) {
      const beam = this.activeChillBeams[i];
      beam.elapsed += dt;

      let allDone = true;
      for (let b = 0; b < beam.bolts.length; b++) {
        const bolt = beam.bolts[b];
        if (beam.elapsed < bolt.spawnDelay) {
          allDone = false;
          continue;
        }

        if (!bolt.hasSpawned) {
          bolt.hasSpawned = true;
          bolt.group.visible = true;
          bolt.group.position.copy(beam.from);
        }

        if (!bolt.hasImpacted) {
          allDone = false;
          const flightTime = beam.elapsed - bolt.spawnDelay;
          const speed = 1050; // units/sec
          bolt.progress = Math.min(1.0, (flightTime * speed) / beam.totalDist);

          // Update position along travel vector
          bolt.group.position.lerpVectors(beam.from, beam.to, bolt.progress);

          // Emit small floating frost particles along trail
          if (Math.random() < 0.35) {
            const m = new THREE.Mesh(
              this.sharedSparkGeo,
              this.acquireBasicMat(Math.random() < 0.5 ? 0xffffff : 0x7dd3fc, 0.85, THREE.AdditiveBlending, THREE.FrontSide, true, null)
            );
            m.userData.isSharedGeo = true;
            m.position.copy(bolt.group.position);
            m.position.x += (Math.random() - 0.5) * 6;
            m.position.y += (Math.random() - 0.5) * 6;
            m.position.z += (Math.random() - 0.5) * 6;
            m.scale.setScalar(1.6);
            this.group.add(m);
            this.orbitalParticles.push({
              mesh: m,
              kind: 'spark',
              vx: (Math.random() - 0.5) * 40,
              vy: 10 + Math.random() * 25,
              vz: (Math.random() - 0.5) * 40,
              rotSpeedX: 4,
              rotSpeedY: 4,
              rotSpeedZ: 0,
              baseScale: 1.6,
              endScale: 0.2,
              lifetime: 0.20,
              maxLifetime: 0.20,
              groundY: beam.elevation
            });
          }

          if (bolt.progress >= 1.0) {
            bolt.hasImpacted = true;
            bolt.group.visible = false;

            // Spawn icy impact effects at target
            this.spawnShockwaveRing(
              { x: beam.to.x, y: beam.to.z },
              35,
              0x00e5ff,
              beam.toElevation + 14,
              0.22
            );

            // Impact sparks
            for (let s = 0; s < 5; s++) {
              const m = new THREE.Mesh(
                this.sharedSparkGeo,
                this.acquireBasicMat(s % 2 === 0 ? 0xffffff : 0x38bdf8, 0.92, THREE.AdditiveBlending, THREE.FrontSide, true, null)
              );
              m.userData.isSharedGeo = true;
              m.position.set(beam.to.x, beam.toElevation + 16, beam.to.z);
              m.scale.setScalar(1.8);
              this.group.add(m);
              this.orbitalParticles.push({
                mesh: m,
                kind: 'spark',
                vx: (Math.random() - 0.5) * 120,
                vy: 30 + Math.random() * 90,
                vz: (Math.random() - 0.5) * 120,
                rotSpeedX: Math.random() * 6,
                rotSpeedY: Math.random() * 6,
                rotSpeedZ: 0,
                baseScale: 1.8,
                endScale: 0.2,
                lifetime: 0.25,
                maxLifetime: 0.25,
                groundY: beam.toElevation
              });
            }

            // On final projectile, spawn ground ice spires
            if (b === beam.bolts.length - 1) {
              for (let c = 0; c < 5; c++) {
                const cAngle = (c / 5) * Math.PI * 2 + Math.random() * 0.4;
                const cDist = 12 + Math.random() * 24;
                const cx = beam.to.x + Math.cos(cAngle) * cDist;
                const cz = beam.to.z + Math.sin(cAngle) * cDist;
                const cHeight = this.getTerrainHeight(cx, cz, beam.elevation);
                const crystalGeo = this.createJaggedShardGeo(5.5 + Math.random() * 4.0, 26 + Math.random() * 12, 5, 300 + c);
                const crystalMat = this.acquireBasicMat(0x38bdf8, 0.82, THREE.AdditiveBlending, THREE.FrontSide, true, null);
                const crystalMesh = new THREE.Mesh(crystalGeo, crystalMat);
                crystalMesh.position.set(cx, cHeight - 1, cz);
                crystalMesh.rotation.set((Math.random() - 0.5) * 0.4, Math.random() * Math.PI, (Math.random() - 0.5) * 0.4);
                this.group.add(crystalMesh);
                this.activeGroundSpikes.push({
                  mesh: crystalMesh,
                  mat: crystalMat,
                  elapsed: 0,
                  maxLifetime: 0.45,
                  baseScaleY: 1.0,
                  targetScaleY: 1.0
                });
              }
            }
          }
        }
      }

      if (allDone || beam.elapsed >= beam.maxLifetime) {
        this.group.remove(beam.group);
        for (let b = 0; b < beam.bolts.length; b++) {
          const bolt = beam.bolts[b];
          bolt.coreMesh.geometry.dispose();
          bolt.coreMat.dispose();
          bolt.sheathMesh.geometry.dispose();
          bolt.sheathMat.dispose();
          bolt.trailMesh.geometry.dispose();
          bolt.trailMat.dispose();
        }
        this.activeChillBeams.splice(i, 1);
      }
    }

    // 0I. Update Active Ground Ice Spires (Chill Beam & Frost Burst)
    for (let i = this.activeGroundSpikes.length - 1; i >= 0; i--) {
      const spire = this.activeGroundSpikes[i];
      spire.elapsed += dt;
      if (spire.elapsed >= spire.maxLifetime) {
        this.group.remove(spire.mesh);
        spire.mesh.geometry.dispose();
        this.releaseMaterial(spire.mat);
        this.activeGroundSpikes.splice(i, 1);
        continue;
      }

      const growRatio = Math.min(1.0, spire.elapsed / 0.12);
      const easedGrow = 1.0 - Math.pow(1.0 - growRatio, 3.0);
      const fadeOut = spire.elapsed > spire.maxLifetime * 0.75
        ? (spire.maxLifetime - spire.elapsed) / (spire.maxLifetime * 0.25)
        : 1.0;

      spire.mesh.scale.y = spire.targetScaleY * easedGrow * fadeOut;
      spire.mat.opacity = 0.92 * fadeOut;
    }

    // 0J. Update Active Crescent Slash Arcs (LMB Upgrade 3: Extended Slash)
    for (let i = this.activeSlashArcs.length - 1; i >= 0; i--) {
      const slash = this.activeSlashArcs[i];
      slash.elapsed += dt;
      if (slash.elapsed >= slash.maxLifetime) {
        this.group.remove(slash.group);
        slash.slashMesh.geometry.dispose();
        slash.slashMat.dispose();
        slash.coreMesh.geometry.dispose();
        slash.coreMat.dispose();
        this.activeSlashArcs.splice(i, 1);
        continue;
      }

      const p = slash.elapsed / slash.maxLifetime;
      const curScale = slash.startScale + (slash.targetScale - slash.startScale) * p;
      slash.group.scale.set(curScale, 1.0, curScale);
      const fade = Math.pow(1.0 - p, 1.2);
      slash.slashMat.opacity = 0.92 * fade;
      slash.coreMat.opacity = 0.98 * fade;
    }

    // 0K. Update Stage 1 Boss Tentacle Terrain-Conforming Impact Shockwaves
    for (let i = this.activeTentacleImpacts.length - 1; i >= 0; i--) {
      const imp = this.activeTentacleImpacts[i];
      imp.elapsed += dt;
      if (imp.elapsed >= imp.maxLifetime) {
        this.group.remove(imp.mesh);
        imp.mesh.geometry.dispose();
        this.releaseMaterial(imp.mat);
        this.activeTentacleImpacts.splice(i, 1);
        continue;
      }
      const p = imp.elapsed / imp.maxLifetime;
      const eased = 1.0 - Math.pow(1.0 - p, 2.2);
      imp.mat.uniforms.uProgress.value = 0.08 + eased * 0.88;
      imp.mat.uniforms.uAlpha.value = Math.pow(1.0 - p, 1.35);
    }

    // 0L. Update Doctor White Silhouette Afterimage Ghosts
    for (let i = this.whiteGhosts.length - 1; i >= 0; i--) {
      const wg = this.whiteGhosts[i];
      wg.lifetime -= dt;
      if (wg.lifetime <= 0) {
        this.group.remove(wg.mesh);
        if (!wg.mesh.userData?.isSharedGeo) wg.mesh.geometry.dispose();
        this.releaseMaterial(wg.mat);
        this.whiteGhosts.splice(i, 1);
        continue;
      }
      wg.mesh.quaternion.copy(camera.quaternion);
      const t = wg.lifetime / wg.maxLifetime;
      wg.mat.uniforms.uOpacity.value = 0.72 * t * t;
    }

    // 0M. Update Doctor Emerald Healing Motes
    for (let i = this.healMotes.length - 1; i >= 0; i--) {
      const hm = this.healMotes[i];
      hm.lifetime -= dt;
      if (hm.lifetime <= 0) {
        this.group.remove(hm.mesh);
        if (!hm.mesh.userData?.isSharedGeo) hm.mesh.geometry.dispose();
        this.releaseMaterial(hm.mat);
        this.healMotes.splice(i, 1);
        continue;
      }
      hm.mesh.position.x += hm.vx * dt;
      hm.mesh.position.y += hm.vy * dt;
      hm.mesh.position.z += hm.vz * dt;
      hm.mesh.quaternion.copy(camera.quaternion);
      hm.mat.opacity = 0.9 * (hm.lifetime / hm.maxLifetime);
    }

    // 0M2. Update Regional Refreeze Frost Motes
    for (let i = this.regionalFrostMotes.length - 1; i >= 0; i--) {
      const fm = this.regionalFrostMotes[i];
      fm.lifetime -= dt;
      if (fm.lifetime <= 0) {
        this.group.remove(fm.mesh);
        this.releaseMaterial(fm.mat);
        this.regionalFrostMotes.splice(i, 1);
        continue;
      }
      fm.mesh.position.x += fm.vx * dt;
      fm.mesh.position.y += fm.vy * dt;
      fm.mesh.position.z += fm.vz * dt;
      fm.mesh.quaternion.copy(camera.quaternion);
      fm.mat.opacity = 0.72 * (fm.lifetime / fm.maxLifetime);
    }

    // 0N. Update Stage 1 Boss Swirling Molten Bio-Lava Ball Explosions
    for (let i = this.activeLavaSwirls.length - 1; i >= 0; i--) {
      const fx = this.activeLavaSwirls[i];
      fx.elapsed += dt;
      if (fx.elapsed >= fx.maxLifetime) {
        this.group.remove(fx.group);
        fx.domeMesh.geometry.dispose();
        this.releaseMaterial(fx.domeMat);
        fx.poolMesh.geometry.dispose();
        this.releaseMaterial(fx.poolMat);
        fx.ringA.geometry.dispose();
        this.releaseMaterial(fx.ringAMat);
        fx.ringB.geometry.dispose();
        this.releaseMaterial(fx.ringBMat);
        this.activeLavaSwirls.splice(i, 1);
        continue;
      }

      const p = fx.elapsed / fx.maxLifetime;
      const bloom = 1.0 - Math.pow(1.0 - Math.min(1.0, p * 2.2), 2.5);
      const fade = p < 0.25 ? 1.0 : Math.pow(1.0 - (p - 0.25) / 0.75, 1.35);

      fx.domeMesh.scale.setScalar(0.28 + bloom * 1.15);
      fx.domeMesh.rotation.y += dt * 4.5 * fx.spinSign;
      fx.domeMat.uniforms.uTime.value = fx.elapsed;
      fx.domeMat.uniforms.uProgress.value = p;
      fx.domeMat.uniforms.uAlpha.value = fade;

      fx.poolMat.uniforms.uTime.value = fx.elapsed;
      fx.poolMat.uniforms.uProgress.value = p;
      fx.poolMat.uniforms.uAlpha.value = p < 0.2 ? 1.0 : Math.pow(1.0 - (p - 0.2) / 0.8, 1.15);

      const ringScaleA = 0.35 + bloom * 1.15;
      fx.ringA.scale.setScalar(ringScaleA);
      fx.ringA.rotation.z += dt * 5.2 * fx.spinSign;
      fx.ringAMat.opacity = 0.85 * fade;

      const ringScaleB = 0.25 + bloom * 1.35;
      fx.ringB.scale.setScalar(ringScaleB);
      fx.ringB.rotation.z -= dt * 6.4 * fx.spinSign;
      fx.ringBMat.opacity = 0.78 * fade;
    }
  }
}

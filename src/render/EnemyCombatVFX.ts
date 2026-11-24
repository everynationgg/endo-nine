import * as THREE from 'three';

type ParticleTile = 0 | 1 | 2 | 3; // 0: Smoke Billow, 1: Water Droplet/Splash, 2: Soil/Dust Puff, 3: Chitin Spark/Spore

interface PooledParticle {
  active: boolean;
  age: number;
  life: number;
  x: number;
  y: number;
  z: number;
  vx: number;
  vy: number;
  vz: number;
  gravity: number;
  drag: number;
  sizeStart: number;
  sizeEnd: number;
  rot: number;
  rotSpeed: number;
  alpha: number;
  r: number;
  g: number;
  b: number;
  emissive: number;
  tile: ParticleTile;
}

interface PooledClod {
  active: boolean;
  age: number;
  life: number;
  x: number;
  y: number;
  z: number;
  vx: number;
  vy: number;
  vz: number;
  rx: number;
  ry: number;
  rz: number;
  vrx: number;
  vry: number;
  scale: number;
  r: number;
  g: number;
  b: number;
}

interface PooledDecal {
  active: boolean;
  age: number;
  life: number;
  mesh: THREE.Mesh;
  mat: THREE.MeshBasicMaterial;
  startScale: number;
  endScale: number;
  maxAlpha: number;
  fadeInFrac: number;
}

interface PooledSwipe {
  active: boolean;
  age: number;
  life: number;
  mesh: THREE.Mesh;
  mat: THREE.MeshBasicMaterial;
  startScale: number;
  endScale: number;
  spinSpeed: number;
  maxAlpha: number;
}

const MAX_PARTICLES = 420;
const MAX_CLODS = 56;
const MAX_DECALS = 24;
const MAX_SWIPES = 16;

export class EnemyCombatVFX {
  private readonly scene: THREE.Scene;
  private readonly sampleTerrainY: (x: number, z: number, refY?: number) => number;
  private readonly addCameraTrauma?: (amount: number) => void;

  // Textures & Shared Materials
  private readonly atlasTex: THREE.CanvasTexture;
  private readonly fiberTex: THREE.CanvasTexture;
  private readonly crackTex: THREE.CanvasTexture;
  private readonly warnTex: THREE.CanvasTexture;
  private readonly bladeGlowTex: THREE.CanvasTexture;

  private readonly boneSpikeGeo: THREE.BufferGeometry;
  private readonly boneSpikeMat: THREE.MeshStandardMaterial;
  private readonly waterBubbleGeo: THREE.IcosahedronGeometry;
  private readonly waterCoreGeo: THREE.IcosahedronGeometry;
  private readonly waterCoreMat: THREE.MeshBasicMaterial;

  // Single-draw-call Instanced Billboard Particle System
  private readonly particles: PooledParticle[] = [];
  private particleCursor = 0;
  private readonly particleMesh: THREE.InstancedMesh;
  private readonly particleColorAlphaAttr: THREE.InstancedBufferAttribute;
  private readonly particleTileRotAttr: THREE.InstancedBufferAttribute;
  private readonly particleMat: THREE.ShaderMaterial;

  // Single-draw-call Instanced Ballistic Thawed Soil Clods
  private readonly clods: PooledClod[] = [];
  private clodCursor = 0;
  private readonly clodMesh: THREE.InstancedMesh;
  private readonly clodColor = new THREE.Color();

  // Decals & Organic Blade/Punch Swipes
  private readonly decals: PooledDecal[] = [];
  private readonly swipes: PooledSwipe[] = [];

  // Scratch math
  private readonly dummyObj = new THREE.Object3D();
  private readonly camRight = new THREE.Vector3();
  private readonly camUp = new THREE.Vector3();
  private readonly velDirScratch = new THREE.Vector3();
  private readonly upScratch = new THREE.Vector3(0, 1, 0);
  private readonly dropletTimerMap = new WeakMap<THREE.Group, number>();

  constructor(
    scene: THREE.Scene,
    sampleTerrainY: (x: number, z: number, refY?: number) => number,
    addCameraTrauma?: (amount: number) => void
  ) {
    this.scene = scene;
    this.sampleTerrainY = sampleTerrainY;
    this.addCameraTrauma = addCameraTrauma;

    this.atlasTex = this.createOrganicAtlasTexture();
    this.fiberTex = this.createTaperedFiberTexture();
    this.crackTex = this.createGroundCrackTexture();
    this.warnTex = this.createFeatheredWarningTexture();
    this.bladeGlowTex = this.createBladeMotionRingTexture();

    this.boneSpikeGeo = this.createBoneSpikeGeometry();
    this.boneSpikeMat = new THREE.MeshStandardMaterial({
      color: new THREE.Color(0xe7d6dc),
      emissive: new THREE.Color(0x5b1238),
      emissiveIntensity: 0.55,
      roughness: 0.42,
      metalness: 0.14
    });

    this.waterBubbleGeo = new THREE.IcosahedronGeometry(16, 3);
    this.waterCoreGeo = new THREE.IcosahedronGeometry(8.6, 2);
    this.waterCoreMat = new THREE.MeshBasicMaterial({
      color: 0x7ce8ff,
      transparent: true,
      opacity: 0.34,
      depthWrite: false
    });

    // Build Particle InstancedMesh
    const quadGeo = new THREE.PlaneGeometry(1, 1);
    const colorAlphaArr = new Float32Array(MAX_PARTICLES * 4);
    const tileRotArr = new Float32Array(MAX_PARTICLES * 4);
    this.particleColorAlphaAttr = new THREE.InstancedBufferAttribute(colorAlphaArr, 4);
    this.particleTileRotAttr = new THREE.InstancedBufferAttribute(tileRotArr, 4);
    this.particleColorAlphaAttr.setUsage(THREE.DynamicDrawUsage);
    this.particleTileRotAttr.setUsage(THREE.DynamicDrawUsage);
    quadGeo.setAttribute('aColorAlpha', this.particleColorAlphaAttr);
    quadGeo.setAttribute('aTileRot', this.particleTileRotAttr);

    this.particleMat = new THREE.ShaderMaterial({
      uniforms: {
        uAtlas: { value: this.atlasTex },
        uCamRight: { value: new THREE.Vector3(1, 0, 0) },
        uCamUp: { value: new THREE.Vector3(0, 1, 0) }
      },
      vertexShader: /* glsl */ `
        attribute vec4 aColorAlpha;
        attribute vec4 aTileRot;
        uniform vec3 uCamRight;
        uniform vec3 uCamUp;
        varying vec2 vUv;
        varying vec4 vColorAlpha;
        varying float vEmissive;

        void main() {
          vColorAlpha = aColorAlpha;
          vEmissive = aTileRot.w;
          vec3 worldCenter = vec3(instanceMatrix[3][0], instanceMatrix[3][1], instanceMatrix[3][2]);
          float scaleX = length(vec3(instanceMatrix[0][0], instanceMatrix[0][1], instanceMatrix[0][2]));
          float ang = aTileRot.z;
          float c = cos(ang);
          float s = sin(ang);
          vec2 rp = vec2(position.x * c - position.y * s, position.x * s + position.y * c) * max(scaleX, 0.001);
          vec3 wp = worldCenter + uCamRight * rp.x + uCamUp * rp.y;
          vec2 tile = aTileRot.xy;
          vUv = uv * 0.48 + tile * 0.5 + 0.01;
          gl_Position = projectionMatrix * viewMatrix * vec4(wp, 1.0);
        }
      `,
      fragmentShader: /* glsl */ `
        uniform sampler2D uAtlas;
        varying vec2 vUv;
        varying vec4 vColorAlpha;
        varying float vEmissive;

        void main() {
          vec4 tex = texture2D(uAtlas, vUv);
          float a = tex.a * vColorAlpha.a;
          if (a < 0.012) discard;
          vec3 col = tex.rgb * vColorAlpha.rgb * (1.0 + vEmissive * 0.65);
          col = min(col, vec3(2.2));
          gl_FragColor = vec4(col, clamp(a, 0.0, 1.0));
        }
      `,
      transparent: true,
      depthWrite: false,
      side: THREE.DoubleSide
    });

    this.particleMesh = new THREE.InstancedMesh(quadGeo, this.particleMat, MAX_PARTICLES);
    this.particleMesh.frustumCulled = false;
    this.particleMesh.count = MAX_PARTICLES;
    this.particleMesh.renderOrder = 14;
    this.scene.add(this.particleMesh);

    for (let i = 0; i < MAX_PARTICLES; i++) {
      this.particles.push({
        active: false,
        age: 0,
        life: 1,
        x: 0,
        y: -9999,
        z: 0,
        vx: 0,
        vy: 0,
        vz: 0,
        gravity: 0,
        drag: 1,
        sizeStart: 1,
        sizeEnd: 1,
        rot: 0,
        rotSpeed: 0,
        alpha: 0,
        r: 1,
        g: 1,
        b: 1,
        emissive: 0,
        tile: 0
      });
      this.dummyObj.position.set(0, -9999, 0);
      this.dummyObj.scale.set(0.001, 0.001, 0.001);
      this.dummyObj.updateMatrix();
      this.particleMesh.setMatrixAt(i, this.dummyObj.matrix);
    }

    // Build Ballistic Soil Clod InstancedMesh
    const clodGeo = new THREE.DodecahedronGeometry(4.2, 0);
    const clodMat = new THREE.MeshStandardMaterial({
      color: 0xffffff,
      roughness: 0.92,
      metalness: 0.04
    });
    this.clodMesh = new THREE.InstancedMesh(clodGeo, clodMat, MAX_CLODS);
    this.clodMesh.frustumCulled = false;
    this.clodMesh.count = MAX_CLODS;
    this.scene.add(this.clodMesh);
    for (let i = 0; i < MAX_CLODS; i++) {
      this.clods.push({
        active: false,
        age: 0,
        life: 1,
        x: 0,
        y: -9999,
        z: 0,
        vx: 0,
        vy: 0,
        vz: 0,
        rx: 0,
        ry: 0,
        rz: 0,
        vrx: 0,
        vry: 0,
        scale: 0.001,
        r: 0.25,
        g: 0.2,
        b: 0.17
      });
      this.dummyObj.position.set(0, -9999, 0);
      this.dummyObj.scale.set(0.001, 0.001, 0.001);
      this.dummyObj.updateMatrix();
      this.clodMesh.setMatrixAt(i, this.dummyObj.matrix);
      this.clodMesh.setColorAt(i, this.clodColor.setRGB(0.28, 0.22, 0.18));
    }

    // Preallocate Decals
    const decalGeo = new THREE.PlaneGeometry(2, 2);
    for (let i = 0; i < MAX_DECALS; i++) {
      const mat = new THREE.MeshBasicMaterial({
        map: this.crackTex,
        transparent: true,
        opacity: 0,
        depthWrite: false,
        polygonOffset: true,
        polygonOffsetFactor: -2,
        polygonOffsetUnits: -2
      });
      const mesh = new THREE.Mesh(decalGeo, mat);
      mesh.rotation.x = -Math.PI / 2;
      mesh.visible = false;
      mesh.renderOrder = 6;
      this.scene.add(mesh);
      this.decals.push({
        active: false,
        age: 0,
        life: 1,
        mesh,
        mat,
        startScale: 1,
        endScale: 1,
        maxAlpha: 0.7,
        fadeInFrac: 0.1
      });
    }

    // Preallocate Swipes (Blade blur ribbons & Magmir heavy punch arcs)
    const swipeGeo = new THREE.PlaneGeometry(2, 2);
    for (let i = 0; i < MAX_SWIPES; i++) {
      const mat = new THREE.MeshBasicMaterial({
        map: this.fiberTex,
        transparent: true,
        opacity: 0,
        depthWrite: false,
        side: THREE.DoubleSide,
        blending: THREE.AdditiveBlending
      });
      const mesh = new THREE.Mesh(swipeGeo, mat);
      mesh.visible = false;
      mesh.renderOrder = 12;
      this.scene.add(mesh);
      this.swipes.push({
        active: false,
        age: 0,
        life: 0.25,
        mesh,
        mat,
        startScale: 1,
        endScale: 1,
        spinSpeed: 8,
        maxAlpha: 0.8
      });
    }
  }

  // ---------------------------------------------------------------------------
  // PROCEDURAL ORGANIC TEXTURE GENERATORS
  // ---------------------------------------------------------------------------

  private createOrganicAtlasTexture(): THREE.CanvasTexture {
    const size = 512;
    const canvas = document.createElement('canvas');
    canvas.width = size;
    canvas.height = size;
    const ctx = canvas.getContext('2d')!;
    ctx.clearRect(0, 0, size, size);

    const drawTile = (tx: number, ty: number, fn: (ox: number, oy: number, w: number) => void) => {
      ctx.save();
      const ox = tx * 256;
      const oy = ty * 256;
      ctx.beginPath();
      ctx.rect(ox + 2, oy + 2, 252, 252);
      ctx.clip();
      fn(ox, oy, 256);
      ctx.restore();
    };

    // Tile 0 (0,0): Soft asymmetric organic billow smoke puff (for toxic fumes & dust)
    drawTile(0, 0, (ox, oy, w) => {
      const lobes = [
        [0.5, 0.5, 0.36, 0.45],
        [0.36, 0.44, 0.24, 0.38],
        [0.64, 0.46, 0.23, 0.36],
        [0.48, 0.34, 0.22, 0.34],
        [0.54, 0.65, 0.24, 0.32],
        [0.42, 0.58, 0.21, 0.28]
      ];
      for (const [lx, ly, lr, alpha] of lobes) {
        const cx = ox + lx * w;
        const cy = oy + ly * w;
        const r = lr * w;
        const grad = ctx.createRadialGradient(cx, cy, r * 0.06, cx, cy, r);
        grad.addColorStop(0, `rgba(255,255,255,${alpha})`);
        grad.addColorStop(0.55, `rgba(225,225,225,${alpha * 0.48})`);
        grad.addColorStop(1, 'rgba(200,200,200,0)');
        ctx.fillStyle = grad;
        ctx.beginPath();
        ctx.arc(cx, cy, r, 0, Math.PI * 2);
        ctx.fill();
      }
    });

    // Tile 1 (1,0): Translucent water droplet / meniscus mist
    drawTile(1, 0, (ox, oy, w) => {
      const cx = ox + w * 0.5;
      const cy = oy + w * 0.52;
      const r = w * 0.34;
      const grad = ctx.createRadialGradient(cx - r * 0.22, cy - r * 0.25, r * 0.08, cx, cy, r);
      grad.addColorStop(0, 'rgba(255,255,255,0.95)');
      grad.addColorStop(0.32, 'rgba(185,245,255,0.58)');
      grad.addColorStop(0.75, 'rgba(110,210,245,0.22)');
      grad.addColorStop(1, 'rgba(90,190,235,0)');
      ctx.fillStyle = grad;
      ctx.beginPath();
      ctx.ellipse(cx, cy, r * 0.85, r * 1.1, 0, 0, Math.PI * 2);
      ctx.fill();
      // Rim specular highlight
      ctx.strokeStyle = 'rgba(255,255,255,0.75)';
      ctx.lineWidth = 5;
      ctx.beginPath();
      ctx.arc(cx - r * 0.14, cy - r * 0.12, r * 0.56, Math.PI * 1.1, Math.PI * 1.75);
      ctx.stroke();
    });

    // Tile 2 (0,1): Coarse thawed earth dust / crater silt puff
    drawTile(0, 1, (ox, oy, w) => {
      for (let i = 0; i < 14; i++) {
        const a = (i / 14) * Math.PI * 2 + (i % 3) * 0.3;
        const dist = (0.1 + (i % 4) * 0.055) * w;
        const lx = ox + w * 0.5 + Math.cos(a) * dist;
        const ly = oy + w * 0.5 + Math.sin(a) * dist * 0.82;
        const r = (0.14 + (i % 3) * 0.05) * w;
        const g = ctx.createRadialGradient(lx, ly, r * 0.1, lx, ly, r);
        g.addColorStop(0, 'rgba(245,235,222,0.34)');
        g.addColorStop(0.6, 'rgba(195,180,168,0.16)');
        g.addColorStop(1, 'rgba(150,140,130,0)');
        ctx.fillStyle = g;
        ctx.beginPath();
        ctx.arc(lx, ly, r, 0, Math.PI * 2);
        ctx.fill();
      }
    });

    // Tile 3 (1,1): Sharp directional chitin spark / bio-fleck
    drawTile(1, 1, (ox, oy, w) => {
      const cx = ox + w * 0.5;
      const cy = oy + w * 0.5;
      const grad = ctx.createRadialGradient(cx, cy, 4, cx, cy, w * 0.36);
      grad.addColorStop(0, 'rgba(255,255,255,1)');
      grad.addColorStop(0.35, 'rgba(255,220,245,0.65)');
      grad.addColorStop(1, 'rgba(255,170,220,0)');
      ctx.fillStyle = grad;
      ctx.beginPath();
      ctx.ellipse(cx, cy, w * 0.38, w * 0.14, -0.35, 0, Math.PI * 2);
      ctx.fill();
    });

    const tex = new THREE.CanvasTexture(canvas);
    tex.colorSpace = THREE.SRGBColorSpace;
    tex.minFilter = THREE.LinearMipmapLinearFilter;
    tex.magFilter = THREE.LinearFilter;
    tex.generateMipmaps = true;
    return tex;
  }

  private createTaperedFiberTexture(): THREE.CanvasTexture {
    const canvas = document.createElement('canvas');
    canvas.width = 256;
    canvas.height = 256;
    const ctx = canvas.getContext('2d')!;
    const cx = 128;
    const cy = 128;

    // Curved crescent fibrous motion streak
    for (let strand = 0; strand < 7; strand++) {
      const radius = 72 + strand * 7.5;
      const startA = -Math.PI * (0.48 - strand * 0.03);
      const endA = Math.PI * (0.36 - strand * 0.02);
      const g = ctx.createLinearGradient(
        cx + Math.cos(startA) * radius,
        cy + Math.sin(startA) * radius,
        cx + Math.cos(endA) * radius,
        cy + Math.sin(endA) * radius
      );
      g.addColorStop(0, 'rgba(255,255,255,0)');
      g.addColorStop(0.35, `rgba(255,245,255,${0.28 - strand * 0.025})`);
      g.addColorStop(0.75, `rgba(255,215,245,${0.55 - strand * 0.05})`);
      g.addColorStop(1, 'rgba(255,255,255,0)');
      ctx.strokeStyle = g;
      ctx.lineWidth = 7 - strand * 0.6;
      ctx.lineCap = 'round';
      ctx.beginPath();
      ctx.arc(cx, cy, radius, startA, endA);
      ctx.stroke();
    }

    const tex = new THREE.CanvasTexture(canvas);
    tex.colorSpace = THREE.SRGBColorSpace;
    tex.minFilter = THREE.LinearMipmapLinearFilter;
    return tex;
  }

  private createBladeMotionRingTexture(): THREE.CanvasTexture {
    const canvas = document.createElement('canvas');
    canvas.width = 256;
    canvas.height = 256;
    const ctx = canvas.getContext('2d')!;
    const cx = 128;
    const cy = 128;
    // Serrated multi-arc rotational blur wisps — transparent inner & outer edges
    for (let blade = 0; blade < 8; blade++) {
      const a0 = (blade / 8) * Math.PI * 2;
      for (let s = 0; s < 3; s++) {
        const r = 74 + s * 16;
        const grad = ctx.createRadialGradient(cx, cy, 56, cx, cy, 122);
        grad.addColorStop(0, 'rgba(180,90,220,0)');
        grad.addColorStop(0.55, 'rgba(230,130,255,0.45)');
        grad.addColorStop(0.85, 'rgba(255,150,210,0.22)');
        grad.addColorStop(1, 'rgba(180,90,220,0)');
        ctx.strokeStyle = grad;
        ctx.lineWidth = 6 - s * 1.4;
        ctx.beginPath();
        ctx.arc(cx, cy, r, a0, a0 + 0.48 - s * 0.08);
        ctx.stroke();
      }
    }
    const tex = new THREE.CanvasTexture(canvas);
    tex.colorSpace = THREE.SRGBColorSpace;
    tex.minFilter = THREE.LinearMipmapLinearFilter;
    return tex;
  }

  private createGroundCrackTexture(): THREE.CanvasTexture {
    const canvas = document.createElement('canvas');
    canvas.width = 256;
    canvas.height = 256;
    const ctx = canvas.getContext('2d')!;
    const cx = 128;
    const cy = 128;

    // Soft dark impact char center
    const core = ctx.createRadialGradient(cx, cy, 4, cx, cy, 62);
    core.addColorStop(0, 'rgba(18,12,10,0.72)');
    core.addColorStop(0.5, 'rgba(32,20,14,0.34)');
    core.addColorStop(1, 'rgba(32,20,14,0)');
    ctx.fillStyle = core;
    ctx.beginPath();
    ctx.arc(cx, cy, 62, 0, Math.PI * 2);
    ctx.fill();

    // Jagged branching tectonic fissures
    const seedFissures = [0.2, 1.15, 2.05, 3.0, 3.9, 4.95, 5.75];
    for (let i = 0; i < seedFissures.length; i++) {
      let ang = seedFissures[i];
      let px = cx + Math.cos(ang) * 10;
      let py = cy + Math.sin(ang) * 10;
      ctx.strokeStyle = 'rgba(24,14,10,0.86)';
      ctx.lineWidth = 3.2;
      ctx.beginPath();
      ctx.moveTo(px, py);
      for (let seg = 1; seg <= 6; seg++) {
        ang += ((seg % 2 === 0 ? 1 : -1) * 0.24) + (i % 2 === 0 ? 0.05 : -0.05);
        const step = 15.5;
        px += Math.cos(ang) * step;
        py += Math.sin(ang) * step;
        ctx.lineTo(px, py);
      }
      ctx.stroke();
    }

    const tex = new THREE.CanvasTexture(canvas);
    tex.colorSpace = THREE.SRGBColorSpace;
    tex.minFilter = THREE.LinearMipmapLinearFilter;
    return tex;
  }

  private createFeatheredWarningTexture(): THREE.CanvasTexture {
    const canvas = document.createElement('canvas');
    canvas.width = 256;
    canvas.height = 256;
    const ctx = canvas.getContext('2d')!;
    const cx = 128;
    const cy = 128;

    // Subtle soft hazard wash inside perimeter
    const wash = ctx.createRadialGradient(cx, cy, 38, cx, cy, 120);
    wash.addColorStop(0, 'rgba(255,255,255,0.02)');
    wash.addColorStop(0.75, 'rgba(255,255,255,0.12)');
    wash.addColorStop(0.92, 'rgba(255,255,255,0.42)');
    wash.addColorStop(1, 'rgba(255,255,255,0)');
    ctx.fillStyle = wash;
    ctx.beginPath();
    ctx.arc(cx, cy, 120, 0, Math.PI * 2);
    ctx.fill();

    // Organic segmented edge ticks
    ctx.strokeStyle = 'rgba(255,255,255,0.62)';
    ctx.lineWidth = 3;
    for (let i = 0; i < 16; i++) {
      const a0 = (i / 16) * Math.PI * 2;
      ctx.beginPath();
      ctx.arc(cx, cy, 111, a0 + 0.05, a0 + 0.27);
      ctx.stroke();
    }

    const tex = new THREE.CanvasTexture(canvas);
    tex.colorSpace = THREE.SRGBColorSpace;
    tex.minFilter = THREE.LinearMipmapLinearFilter;
    return tex;
  }

  // ---------------------------------------------------------------------------
  // CUSTOM NON-PRIMITIVE PROJECTILE MESHES (DRIFTWORM & BROOD QUEEN)
  // ---------------------------------------------------------------------------

  private createBoneSpikeGeometry(): THREE.BufferGeometry {
    // Tapered 6-sided chitinous spike aligned along +Z (forward in projectile orientation)
    const radial = 6;
    const rings = [
      { z: -22, rx: 2.2, ry: 2.2 },
      { z: -12, rx: 4.8, ry: 5.4 },
      { z: 0, rx: 3.6, ry: 4.2 },
      { z: 14, rx: 1.8, ry: 2.0 },
      { z: 28, rx: 0.15, ry: 0.15 }
    ];
    const positions: number[] = [];
    const indices: number[] = [];

    for (let ri = 0; ri < rings.length; ri++) {
      const ring = rings[ri];
      for (let si = 0; si < radial; si++) {
        const ang = (si / radial) * Math.PI * 2;
        // Fluted dorsal crest & slight backward barbs at middle ring
        const crestBoost = si === 1 ? 1.28 : 1.0;
        positions.push(
          Math.cos(ang) * ring.rx * crestBoost,
          Math.sin(ang) * ring.ry * crestBoost,
          ring.z
        );
      }
    }

    for (let ri = 0; ri < rings.length - 1; ri++) {
      for (let si = 0; si < radial; si++) {
        const nextS = (si + 1) % radial;
        const a = ri * radial + si;
        const b = ri * radial + nextS;
        const c = (ri + 1) * radial + si;
        const d = (ri + 1) * radial + nextS;
        indices.push(a, c, b);
        indices.push(b, c, d);
      }
    }
    // Tip & tail caps
    const tailCenter = positions.length / 3;
    positions.push(0, 0, -24);
    for (let si = 0; si < radial; si++) {
      indices.push(tailCenter, si, (si + 1) % radial);
    }

    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
    geo.setIndex(indices);
    geo.computeVertexNormals();
    return geo;
  }

  public createWaterBubbleMesh(radius: number): THREE.Group {
    const grp = new THREE.Group();
    const scale = Math.max(0.55, radius / 16);

    const fluidMat = new THREE.ShaderMaterial({
      uniforms: {
        uTime: { value: 0 },
        uPhase: { value: Math.random() * 6.28 }
      },
      vertexShader: /* glsl */ `
        uniform float uTime;
        uniform float uPhase;
        varying vec3 vNormalV;
        varying vec3 vViewPos;
        varying vec3 vObjPos;

        void main() {
          float t = uTime * 4.4 + uPhase;
          vec3 p = position;
          float nLen = max(length(p), 1e-4);
          vec3 dir = p / nLen;
          // Continuous multi-harmonic fluid surface distortion (zero sphere stiffness)
          float wobble = sin(dir.x * 4.2 + t) * cos(dir.y * 3.7 - t * 1.15) * 1.65
                       + sin(dir.z * 5.1 - t * 1.35) * 1.15;
          vec3 displaced = p + dir * wobble;
          vObjPos = displaced;
          vec4 mv = modelViewMatrix * vec4(displaced, 1.0);
          vViewPos = -mv.xyz;
          vNormalV = normalize(normalMatrix * normal);
          gl_Position = projectionMatrix * mv;
        }
      `,
      fragmentShader: /* glsl */ `
        uniform float uTime;
        uniform float uPhase;
        varying vec3 vNormalV;
        varying vec3 vViewPos;
        varying vec3 vObjPos;

        void main() {
          float nLen = length(vNormalV);
          vec3 N = nLen > 1e-4 ? vNormalV / nLen : vec3(0.0, 1.0, 0.0);
          float vLen = length(vViewPos);
          vec3 V = vLen > 1e-4 ? vViewPos / vLen : vec3(0.0, 0.0, 1.0);

          float ndv = clamp(abs(dot(N, V)), 0.0, 1.0);
          float fresnel = pow(max(1.0 - ndv, 1e-4), 2.35);

          float t = uTime * 3.2 + uPhase;
          float caustic = 0.5 + 0.5 * sin(vObjPos.x * 0.28 + t) * cos(vObjPos.y * 0.31 - t * 1.2)
                        + 0.35 * sin(vObjPos.z * 0.35 + t * 0.8);
          caustic = clamp(caustic * 0.72, 0.0, 1.0);

          vec3 deepWater = vec3(0.06, 0.42, 0.62);
          vec3 surfaceCyan = vec3(0.32, 0.88, 1.05);
          vec3 rimGlint = vec3(0.85, 0.98, 1.22);

          vec3 col = mix(deepWater, surfaceCyan, clamp(caustic * 0.65 + fresnel * 0.75, 0.0, 1.0));
          col += rimGlint * fresnel * 0.55;
          col = min(col, vec3(1.55));
          float alpha = clamp(0.38 + fresnel * 0.54 + caustic * 0.14, 0.28, 0.92);
          gl_FragColor = vec4(col, alpha);
        }
      `,
      transparent: true,
      depthWrite: false
    });

    const outer = new THREE.Mesh(this.waterBubbleGeo, fluidMat);
    outer.scale.setScalar(scale);
    grp.add(outer);

    const core = new THREE.Mesh(this.waterCoreGeo, this.waterCoreMat);
    core.scale.setScalar(scale * 0.88);
    grp.add(core);

    grp.userData.fluidMat = fluidMat;
    grp.userData.baseScale = scale;
    grp.userData.coreMesh = core;
    return grp;
  }

  public updateWaterBubbleMesh(
    grp: THREE.Group,
    elapsedSec: number,
    vx: number,
    vy: number,
    vz: number,
    dt: number,
    emitTrail: boolean
  ): void {
    const fluidMat = grp.userData.fluidMat as THREE.ShaderMaterial | undefined;
    if (fluidMat) {
      fluidMat.uniforms.uTime.value = elapsedSec;
    }
    const baseScale = (grp.userData.baseScale as number) || 1;
    const speedSq = vx * vx + vy * vy + vz * vz;
    if (speedSq > 25) {
      this.velDirScratch.set(vx, vz, vy).normalize();
      grp.quaternion.setFromUnitVectors(this.upScratch, this.velDirScratch);
      // Slight aquatic elongation along motion axis + rhythmic core pulse
      const stretch = 1.08 + Math.sin(elapsedSec * 11) * 0.05;
      const squash = 1.0 / Math.sqrt(stretch);
      grp.scale.set(squash * baseScale, stretch * baseScale, squash * baseScale);
    }

    const core = grp.userData.coreMesh as THREE.Mesh | undefined;
    if (core) {
      const wobbleOffset = Math.sin(elapsedSec * 9.5) * 1.4;
      core.position.set(0, wobbleOffset, 0);
    }

    if (emitTrail) {
      const nextAccum = (this.dropletTimerMap.get(grp) ?? 0) + dt;
      if (nextAccum >= 0.048) {
        this.dropletTimerMap.set(grp, 0);
        this.spawnParticle({
          x: grp.position.x + (Math.random() - 0.5) * 9,
          y: grp.position.y + (Math.random() - 0.5) * 7,
          z: grp.position.z + (Math.random() - 0.5) * 9,
          vx: -vx * 0.08 + (Math.random() - 0.5) * 28,
          vy: 14 + Math.random() * 24,
          vz: -vy * 0.08 + (Math.random() - 0.5) * 28,
          gravity: 240,
          drag: 0.94,
          sizeStart: 8 + Math.random() * 5,
          sizeEnd: 2.5,
          life: 0.34 + Math.random() * 0.16,
          alpha: 0.72,
          r: 0.45,
          g: 0.92,
          b: 1.0,
          emissive: 0.25,
          tile: 1
        });
      } else {
        this.dropletTimerMap.set(grp, nextAccum);
      }
    }
  }

  public createBoneSpikeMesh(): THREE.Group {
    const grp = new THREE.Group();
    const spike = new THREE.Mesh(this.boneSpikeGeo, this.boneSpikeMat);
    grp.add(spike);
    return grp;
  }

  public updateBoneSpikeMesh(
    grp: THREE.Group,
    px: number,
    py: number,
    pz: number,
    vx: number,
    vy: number,
    vz: number,
    dt: number,
    elapsedSec: number
  ): void {
    const speedSq = vx * vx + vy * vy + vz * vz;
    if (speedSq > 4) {
      this.velDirScratch.set(vx, vz, vy).normalize();
      grp.lookAt(px + this.velDirScratch.x * 24, pz + this.velDirScratch.y * 24, py + this.velDirScratch.z * 24);
      grp.rotateZ(elapsedSec * 9.0);
    }
    const nextAccum = (this.dropletTimerMap.get(grp) ?? 0) + dt;
    if (nextAccum >= 0.055) {
      this.dropletTimerMap.set(grp, 0);
      this.spawnParticle({
        x: px + (Math.random() - 0.5) * 6,
        y: pz + (Math.random() - 0.5) * 6,
        z: py + (Math.random() - 0.5) * 6,
        vx: -vx * 0.06 + (Math.random() - 0.5) * 24,
        vy: 10 + Math.random() * 18,
        vz: -vy * 0.06 + (Math.random() - 0.5) * 24,
        gravity: 25,
        drag: 0.9,
        sizeStart: 10.5,
        sizeEnd: 2.2,
        life: 0.24,
        alpha: 0.42,
        r: 0.92,
        g: 0.48,
        b: 0.72,
        emissive: 0.25,
        tile: 3
      });
    } else {
      this.dropletTimerMap.set(grp, nextAccum);
    }
  }

  // ---------------------------------------------------------------------------
  // ARCHETYPE-SPECIFIC ORGANIC COMBAT EFFECTS
  // ---------------------------------------------------------------------------

  public spawnWaterBubbleImpact(x: number, y: number, z: number): void {
    // 1. Dark damp water splash stain on terrain (no glowing ring)
    const groundY = this.sampleTerrainY(x, y, z) + 0.35;
    this.spawnDecal(this.warnTex, x, groundY, y, 22, 42, 0.75, 0.22, 0x38bdf8, 0.08);

    // 2. Crown splash droplets arcing outward + falling under gravity
    const count = 16;
    for (let i = 0; i < count; i++) {
      const ang = (i / count) * Math.PI * 2 + Math.random() * 0.35;
      const spd = 75 + Math.random() * 135;
      this.spawnParticle({
        x: x + Math.cos(ang) * 4,
        y: z + 4,
        z: y + Math.sin(ang) * 4,
        vx: Math.cos(ang) * spd,
        vy: 85 + Math.random() * 120,
        vz: Math.sin(ang) * spd,
        gravity: 440,
        drag: 0.96,
        sizeStart: 10 + Math.random() * 6,
        sizeEnd: 3.5,
        life: 0.36 + Math.random() * 0.2,
        alpha: 0.84,
        r: 0.55,
        g: 0.95,
        b: 1.0,
        emissive: 0.2,
        tile: 1
      });
    }

    // 3. Soft aerated cool vapor mist puffs
    for (let i = 0; i < 6; i++) {
      const ang = Math.random() * Math.PI * 2;
      const spd = 25 + Math.random() * 55;
      this.spawnParticle({
        x,
        y: z + 6,
        z: y,
        vx: Math.cos(ang) * spd,
        vy: 30 + Math.random() * 35,
        vz: Math.sin(ang) * spd,
        gravity: 10,
        drag: 0.9,
        sizeStart: 18,
        sizeEnd: 46,
        life: 0.42,
        alpha: 0.34,
        r: 0.72,
        g: 0.96,
        b: 1.0,
        emissive: 0.08,
        tile: 0
      });
    }
  }

  public spawnOrebladeSpinBlur(x: number, y: number, z: number, yaw: number, fast: boolean): void {
    this.spawnSwipe(
      this.bladeGlowTex,
      x,
      z + 24,
      y,
      -Math.PI / 2,
      yaw,
      0,
      36,
      fast ? 52 : 42,
      fast ? 0.14 : 0.2,
      fast ? 16 : 9,
      fast ? 0.48 : 0.22,
      0xd946ef
    );
  }

  public spawnOrebladeChargeBurst(x: number, y: number, z: number, dirX: number, dirY: number): void {
    // Thawed earth & grit kicked behind blades on lunge acceleration
    for (let i = 0; i < 10; i++) {
      const spread = (Math.random() - 0.5) * 1.3;
      const ca = Math.cos(spread);
      const sa = Math.sin(spread);
      const rx = -dirX * ca + dirY * sa;
      const ry = -dirX * sa - dirY * ca;
      const spd = 70 + Math.random() * 95;
      this.spawnParticle({
        x: x + (Math.random() - 0.5) * 16,
        y: z + 5,
        z: y + (Math.random() - 0.5) * 16,
        vx: rx * spd,
        vy: 35 + Math.random() * 55,
        vz: ry * spd,
        gravity: 220,
        drag: 0.92,
        sizeStart: 14,
        sizeEnd: 32,
        life: 0.42,
        alpha: 0.5,
        r: 0.38,
        g: 0.32,
        b: 0.29,
        emissive: 0,
        tile: 2
      });
    }
  }

  public spawnOrebladeContactSparks(x: number, y: number, z: number, dirX: number, dirY: number): void {
    // Razor chitin spark flecks (no explosion)
    for (let i = 0; i < 12; i++) {
      const ang = Math.atan2(-dirY, -dirX) + (Math.random() - 0.5) * 2.1;
      const spd = 120 + Math.random() * 190;
      this.spawnParticle({
        x,
        y: z + 22,
        z: y,
        vx: Math.cos(ang) * spd,
        vy: 60 + Math.random() * 110,
        vz: Math.sin(ang) * spd,
        gravity: 340,
        drag: 0.95,
        sizeStart: 11,
        sizeEnd: 2.5,
        life: 0.24 + Math.random() * 0.14,
        alpha: 0.88,
        r: 0.96,
        g: 0.42,
        b: 0.85,
        emissive: 0.55,
        tile: 3
      });
    }
  }

  public emitSlythvenVentPlume(
    socketL: THREE.Vector3,
    socketR: THREE.Vector3,
    centerX: number,
    centerY: number,
    centerZ: number,
    forwardX: number,
    forwardY: number,
    radius: number,
    isActiveExhale: boolean
  ): void {
    // Emit from BOTH distinct anatomical exhaust vents simultaneously!
    const emitFromVent = (sx: number, sy: number, sz: number, sideSign: number) => {
      const count = isActiveExhale ? 2 : 1;
      for (let k = 0; k < count; k++) {
        // Fan sideways from each exhaust opening and gently curl outward within radius
        const perpX = -forwardY * sideSign;
        const perpY = forwardX * sideSign;
        const spreadAng = (Math.random() - 0.5) * 1.1;
        const mixFwd = Math.cos(spreadAng) * 0.35;
        const lat = 0.65 + Math.random() * 0.45;
        const radialBoost = isActiveExhale ? 210 + Math.random() * 135 : 60 + Math.random() * 45;
        const greenTone = Math.random();
        this.spawnParticle({
          x: sx + (Math.random() - 0.5) * 10,
          y: sy + 4,
          z: sz + (Math.random() - 0.5) * 10,
          vx: (perpX * lat - forwardX * mixFwd) * radialBoost,
          vy: isActiveExhale ? 95 + Math.random() * 80 : 58 + Math.random() * 38,
          vz: (perpY * lat - forwardY * mixFwd) * radialBoost,
          gravity: isActiveExhale ? 150 : -22, // Exhale billows up then settles low around 2x Slythven!
          drag: isActiveExhale ? 0.89 : 0.93,
          sizeStart: isActiveExhale ? 32 : 18,
          sizeEnd: isActiveExhale ? 108 + Math.random() * 52 : 40,
          life: isActiveExhale ? 1.05 + Math.random() * 0.35 : 0.58,
          alpha: isActiveExhale ? 0.42 : 0.24,
          r: 0.42 + greenTone * 0.32,
          g: 0.86 + greenTone * 0.14,
          b: 0.14,
          emissive: 0.22,
          tile: 0
        });
      }
    };

    emitFromVent(socketL.x, socketL.y, socketL.z, -1);
    emitFromVent(socketR.x, socketR.y, socketR.z, 1);

    // Subtle low swirling toxic ground mist inside AoE perimeter during active exhale
    if (isActiveExhale && Math.random() < 0.72) {
      const ang = Math.random() * Math.PI * 2;
      const dist = (0.32 + Math.random() * 0.62) * radius;
      const px = centerX + Math.cos(ang) * dist;
      const pz = centerY + Math.sin(ang) * dist;
      const py = this.sampleTerrainY(px, pz, centerZ) + 14;
      this.spawnParticle({
        x: px,
        y: py,
        z: pz,
        vx: -Math.sin(ang) * 56,
        vy: 24 + Math.random() * 22,
        vz: Math.cos(ang) * 56,
        gravity: 6,
        drag: 0.94,
        sizeStart: 60,
        sizeEnd: 124,
        life: 0.92,
        alpha: 0.26,
        r: 0.36,
        g: 0.78,
        b: 0.16,
        emissive: 0.14,
        tile: 0
      });
    }
  }

  public spawnMagmirSlamTelegraph(x: number, y: number, z: number, radius: number, duration: number): void {
    const gy = this.sampleTerrainY(x, y, z) + 0.4;
    this.spawnDecal(this.warnTex, x, gy, y, radius * 0.88, radius * 1.0, Math.max(0.35, duration), 0.34, 0xf97316, 0.2);
  }

  public spawnMagmirSlamImpact(x: number, y: number, z: number, radius: number): void {
    const gy = this.sampleTerrainY(x, y, z) + 0.45;
    // 1. Persistent crater fissure decal (never a glowing ring)
    this.spawnDecal(this.crackTex, x, gy, y, radius * 0.65, radius * 0.92, 2.4, 0.82, 0x3b261d, 0.04);

    // 2. Dense outward thawed earth & cinder dust billows around rim (2x Scale)
    const dustCount = 28;
    for (let i = 0; i < dustCount; i++) {
      const ang = (i / dustCount) * Math.PI * 2 + Math.random() * 0.25;
      const spd = 240 + Math.random() * 290;
      const hot = i % 5 === 0;
      this.spawnParticle({
        x: x + Math.cos(ang) * 40,
        y: gy + 16,
        z: y + Math.sin(ang) * 40,
        vx: Math.cos(ang) * spd,
        vy: 68 + Math.random() * 105,
        vz: Math.sin(ang) * spd,
        gravity: 120,
        drag: 0.88,
        sizeStart: 56,
        sizeEnd: 152,
        life: 0.8 + Math.random() * 0.28,
        alpha: hot ? 0.55 : 0.62,
        r: hot ? 0.98 : 0.38,
        g: hot ? 0.44 : 0.31,
        b: hot ? 0.14 : 0.27,
        emissive: hot ? 0.45 : 0,
        tile: hot ? 0 : 2
      });
    }

    // 3. Ballistic thawed rock/soil clods arcing & bouncing physically
    const clodCount = 20;
    for (let i = 0; i < clodCount; i++) {
      const ang = Math.random() * Math.PI * 2;
      const spd = 180 + Math.random() * 260;
      this.spawnClod({
        x: x + Math.cos(ang) * 32,
        y: gy + 18,
        z: y + Math.sin(ang) * 32,
        vx: Math.cos(ang) * spd,
        vy: 220 + Math.random() * 220,
        vz: Math.sin(ang) * spd,
        scale: 1.6 + Math.random() * 2.2,
        life: 1.0 + Math.random() * 0.35
      });
    }

    if (this.addCameraTrauma) {
      this.addCameraTrauma(0.36);
    }
  }

  public spawnMagmirFootstepDust(x: number, y: number, z: number, scale = 1): void {
    const gy = this.sampleTerrainY(x, y, z) + 5;
    for (let i = 0; i < 4; i++) {
      const ang = Math.random() * Math.PI * 2;
      const spd = 25 + Math.random() * 35;
      this.spawnParticle({
        x: x + Math.cos(ang) * 6,
        y: gy,
        z: y + Math.sin(ang) * 6,
        vx: Math.cos(ang) * spd,
        vy: 18 + Math.random() * 20,
        vz: Math.sin(ang) * spd,
        gravity: 35,
        drag: 0.9,
        sizeStart: 12 * scale,
        sizeEnd: 28 * scale,
        life: 0.42,
        alpha: 0.36,
        r: 0.36,
        g: 0.3,
        b: 0.26,
        emissive: 0,
        tile: 2
      });
    }
  }

  public spawnMagmirPunchSwing(
    handX: number,
    handY: number,
    handZ: number,
    dirX: number,
    dirY: number,
    isLeft: boolean
  ): void {
    const yaw = Math.atan2(dirX, dirY);
    this.spawnSwipe(
      this.fiberTex,
      handX + dirX * 44,
      handY + 24,
      handZ + dirY * 44,
      -Math.PI / 2 + (isLeft ? 0.26 : -0.26),
      yaw + (isLeft ? -0.35 : 0.35),
      isLeft ? 0.22 : -0.22,
      52,
      92,
      0.22,
      isLeft ? 6.5 : -6.5,
      0.66,
      0xfb923c
    );
    // Ember grit punch cloud (2x Scale)
    for (let i = 0; i < 8; i++) {
      const spd = 130 + Math.random() * 150;
      const ang = yaw + (Math.random() - 0.5) * 1.1;
      this.spawnParticle({
        x: handX,
        y: handY,
        z: handZ,
        vx: Math.sin(ang) * spd,
        vy: 48 + Math.random() * 72,
        vz: Math.cos(ang) * spd,
        gravity: 140,
        drag: 0.91,
        sizeStart: 28,
        sizeEnd: 60,
        life: 0.4,
        alpha: 0.56,
        r: 0.95,
        g: 0.45,
        b: 0.16,
        emissive: 0.38,
        tile: 2
      });
    }
  }

  public spawnBroodBirthMist(x: number, y: number, z: number): void {
    for (let i = 0; i < 10; i++) {
      const ang = Math.random() * Math.PI * 2;
      const spd = 38 + Math.random() * 82;
      this.spawnParticle({
        x,
        y: z,
        z: y,
        vx: Math.cos(ang) * spd,
        vy: -36 + Math.random() * 68,
        vz: Math.sin(ang) * spd,
        gravity: 28,
        drag: 0.9,
        sizeStart: 21,
        sizeEnd: 51,
        life: 0.52,
        alpha: 0.48,
        r: 0.78,
        g: 0.32,
        b: 0.68,
        emissive: 0.24,
        tile: i % 3 === 0 ? 1 : 0
      });
    }
  }

  public spawnBroodRuptureMist(x: number, y: number, z: number): void {
    // Sacrificial Brood disintegrates in organic violet-crimson ichor vapor (no fire blast)
    for (let i = 0; i < 16; i++) {
      const ang = (i / 16) * Math.PI * 2 + Math.random() * 0.3;
      const spd = 112 + Math.random() * 210;
      const isDroplet = i % 2 === 0;
      this.spawnParticle({
        x,
        y: z,
        z: y,
        vx: Math.cos(ang) * spd,
        vy: 82 + Math.random() * 170,
        vz: Math.sin(ang) * spd,
        gravity: isDroplet ? 360 : 50,
        drag: 0.93,
        sizeStart: isDroplet ? 16.5 : 27,
        sizeEnd: isDroplet ? 4.5 : 63,
        life: isDroplet ? 0.38 : 0.56,
        alpha: isDroplet ? 0.82 : 0.46,
        r: 0.88,
        g: 0.26,
        b: 0.66,
        emissive: 0.32,
        tile: isDroplet ? 1 : 0
      });
    }
  }

  // ---------------------------------------------------------------------------
  // POOL MANAGEMENT & FRAME UPDATE
  // ---------------------------------------------------------------------------

  private spawnParticle(cfg: Omit<PooledParticle, 'active' | 'age' | 'rot' | 'rotSpeed'>): void {
    const p = this.particles[this.particleCursor];
    this.particleCursor = (this.particleCursor + 1) % MAX_PARTICLES;
    p.active = true;
    p.age = 0;
    p.life = cfg.life;
    p.x = cfg.x;
    p.y = cfg.y;
    p.z = cfg.z;
    p.vx = cfg.vx;
    p.vy = cfg.vy;
    p.vz = cfg.vz;
    p.gravity = cfg.gravity;
    p.drag = cfg.drag;
    p.sizeStart = cfg.sizeStart;
    p.sizeEnd = cfg.sizeEnd;
    p.rot = Math.random() * Math.PI * 2;
    p.rotSpeed = (Math.random() - 0.5) * 3.4;
    p.alpha = cfg.alpha;
    p.r = cfg.r;
    p.g = cfg.g;
    p.b = cfg.b;
    p.emissive = cfg.emissive;
    p.tile = cfg.tile;
  }

  private spawnClod(cfg: {
    x: number;
    y: number;
    z: number;
    vx: number;
    vy: number;
    vz: number;
    scale: number;
    life: number;
  }): void {
    const c = this.clods[this.clodCursor];
    this.clodCursor = (this.clodCursor + 1) % MAX_CLODS;
    c.active = true;
    c.age = 0;
    c.life = cfg.life;
    c.x = cfg.x;
    c.y = cfg.y;
    c.z = cfg.z;
    c.vx = cfg.vx;
    c.vy = cfg.vy;
    c.vz = cfg.vz;
    c.rx = Math.random() * 6.28;
    c.ry = Math.random() * 6.28;
    c.rz = Math.random() * 6.28;
    c.vrx = (Math.random() - 0.5) * 14;
    c.vry = (Math.random() - 0.5) * 14;
    c.scale = cfg.scale;
    const tone = 0.2 + Math.random() * 0.14;
    c.r = tone * 1.15;
    c.g = tone * 0.92;
    c.b = tone * 0.8;
  }

  private spawnDecal(
    tex: THREE.CanvasTexture,
    x: number,
    y: number,
    z: number,
    startScale: number,
    endScale: number,
    life: number,
    maxAlpha: number,
    tintHex: number,
    fadeInFrac: number
  ): void {
    let slot = this.decals.find((d) => !d.active);
    if (!slot) {
      slot = this.decals.reduce((a, b) => (a.age / a.life > b.age / b.life ? a : b));
    }
    slot.active = true;
    slot.age = 0;
    slot.life = life;
    slot.startScale = startScale;
    slot.endScale = endScale;
    slot.maxAlpha = maxAlpha;
    slot.fadeInFrac = fadeInFrac;
    slot.mat.map = tex;
    slot.mat.color.setHex(tintHex);
    slot.mat.opacity = 0;
    slot.mat.needsUpdate = true;
    slot.mesh.position.set(x, y, z);
    slot.mesh.rotation.set(-Math.PI / 2, 0, Math.random() * Math.PI * 2);
    slot.mesh.scale.set(startScale, startScale, 1);
    slot.mesh.visible = true;
  }

  private spawnSwipe(
    tex: THREE.CanvasTexture,
    x: number,
    y: number,
    z: number,
    rx: number,
    ry: number,
    rz: number,
    startScale: number,
    endScale: number,
    life: number,
    spinSpeed: number,
    maxAlpha: number,
    tintHex: number
  ): void {
    let slot = this.swipes.find((s) => !s.active);
    if (!slot) {
      slot = this.swipes.reduce((a, b) => (a.age / a.life > b.age / b.life ? a : b));
    }
    slot.active = true;
    slot.age = 0;
    slot.life = life;
    slot.startScale = startScale;
    slot.endScale = endScale;
    slot.spinSpeed = spinSpeed;
    slot.maxAlpha = maxAlpha;
    slot.mat.map = tex;
    slot.mat.color.setHex(tintHex);
    slot.mat.opacity = maxAlpha;
    slot.mat.needsUpdate = true;
    slot.mesh.position.set(x, y, z);
    slot.mesh.rotation.set(rx, ry, rz);
    slot.mesh.scale.set(startScale, startScale, 1);
    slot.mesh.visible = true;
  }

  public update(dt: number, camera: THREE.Camera): void {
    const safeDt = Math.min(dt, 0.05);
    this.camRight.setFromMatrixColumn(camera.matrixWorld, 0).normalize();
    this.camUp.setFromMatrixColumn(camera.matrixWorld, 1).normalize();
    (this.particleMat.uniforms.uCamRight.value as THREE.Vector3).copy(this.camRight);
    (this.particleMat.uniforms.uCamUp.value as THREE.Vector3).copy(this.camUp);

    const dragPow = Math.pow(0.5, safeDt * 6);
    const caArr = this.particleColorAlphaAttr.array as Float32Array;
    const trArr = this.particleTileRotAttr.array as Float32Array;
    let pDirty = false;

    for (let i = 0; i < MAX_PARTICLES; i++) {
      const p = this.particles[i];
      if (!p.active) {
        if (caArr[i * 4 + 3] !== 0) {
          caArr[i * 4 + 3] = 0;
          this.dummyObj.position.set(0, -9999, 0);
          this.dummyObj.scale.set(0.001, 0.001, 0.001);
          this.dummyObj.updateMatrix();
          this.particleMesh.setMatrixAt(i, this.dummyObj.matrix);
          pDirty = true;
        }
        continue;
      }

      p.age += safeDt;
      if (p.age >= p.life) {
        p.active = false;
        caArr[i * 4 + 3] = 0;
        this.dummyObj.position.set(0, -9999, 0);
        this.dummyObj.scale.set(0.001, 0.001, 0.001);
        this.dummyObj.updateMatrix();
        this.particleMesh.setMatrixAt(i, this.dummyObj.matrix);
        pDirty = true;
        continue;
      }

      const d = p.drag < 1 ? Math.pow(p.drag, safeDt * 60) : dragPow;
      p.vx *= d;
      p.vz *= d;
      p.vy = p.vy * d - p.gravity * safeDt;
      p.x += p.vx * safeDt;
      p.y += p.vy * safeDt;
      p.z += p.vz * safeDt;
      p.rot += p.rotSpeed * safeDt;

      const t = p.age / p.life;
      const sz = p.sizeStart + (p.sizeEnd - p.sizeStart) * t;
      const env = t < 0.14 ? t / 0.14 : Math.max(0, 1 - (t - 0.14) / 0.86);

      this.dummyObj.position.set(p.x, p.y, p.z);
      this.dummyObj.rotation.set(0, 0, 0);
      this.dummyObj.scale.set(sz, sz, 1);
      this.dummyObj.updateMatrix();
      this.particleMesh.setMatrixAt(i, this.dummyObj.matrix);

      const idx4 = i * 4;
      caArr[idx4] = p.r;
      caArr[idx4 + 1] = p.g;
      caArr[idx4 + 2] = p.b;
      caArr[idx4 + 3] = p.alpha * env;
      trArr[idx4] = p.tile % 2;
      trArr[idx4 + 1] = p.tile < 2 ? 1 : 0; // flip V since Canvas origin is top-left
      trArr[idx4 + 2] = p.rot;
      trArr[idx4 + 3] = p.emissive;
      pDirty = true;
    }

    if (pDirty) {
      this.particleMesh.instanceMatrix.needsUpdate = true;
      this.particleColorAlphaAttr.needsUpdate = true;
      this.particleTileRotAttr.needsUpdate = true;
    }

    // Update Ballistic Soil Clods
    let cDirty = false;
    for (let i = 0; i < MAX_CLODS; i++) {
      const c = this.clods[i];
      if (!c.active) continue;
      c.age += safeDt;
      if (c.age >= c.life) {
        c.active = false;
        this.dummyObj.position.set(0, -9999, 0);
        this.dummyObj.scale.set(0.001, 0.001, 0.001);
        this.dummyObj.updateMatrix();
        this.clodMesh.setMatrixAt(i, this.dummyObj.matrix);
        cDirty = true;
        continue;
      }

      c.vy -= 520 * safeDt;
      c.x += c.vx * safeDt;
      c.y += c.vy * safeDt;
      c.z += c.vz * safeDt;
      const gy = this.sampleTerrainY(c.x, c.z, c.y);
      if (c.y < gy + 2) {
        c.y = gy + 2;
        if (c.vy < -30) {
          c.vy = -c.vy * 0.35;
          c.vx *= 0.6;
          c.vz *= 0.6;
        } else {
          c.vy = 0;
          c.vx *= 0.8;
          c.vz *= 0.8;
        }
      }
      c.rx += c.vrx * safeDt;
      c.ry += c.vry * safeDt;

      const fade = c.age > c.life * 0.72 ? Math.max(0.001, 1 - (c.age - c.life * 0.72) / (c.life * 0.28)) : 1;
      this.dummyObj.position.set(c.x, c.y, c.z);
      this.dummyObj.rotation.set(c.rx, c.ry, c.rz);
      this.dummyObj.scale.setScalar(c.scale * fade);
      this.dummyObj.updateMatrix();
      this.clodMesh.setMatrixAt(i, this.dummyObj.matrix);
      this.clodMesh.setColorAt(i, this.clodColor.setRGB(c.r, c.g, c.b));
      cDirty = true;
    }
    if (cDirty) {
      this.clodMesh.instanceMatrix.needsUpdate = true;
      if (this.clodMesh.instanceColor) this.clodMesh.instanceColor.needsUpdate = true;
    }

    // Update Decals
    for (const d of this.decals) {
      if (!d.active) continue;
      d.age += safeDt;
      if (d.age >= d.life) {
        d.active = false;
        d.mesh.visible = false;
        continue;
      }
      const t = d.age / d.life;
      const s = d.startScale + (d.endScale - d.startScale) * Math.min(1, t * 1.4);
      d.mesh.scale.set(s, s, 1);
      const env = t < d.fadeInFrac ? t / Math.max(0.01, d.fadeInFrac) : Math.max(0, 1 - (t - d.fadeInFrac) / (1 - d.fadeInFrac));
      d.mat.opacity = d.maxAlpha * env;
    }

    // Update Swipes
    for (const sw of this.swipes) {
      if (!sw.active) continue;
      sw.age += safeDt;
      if (sw.age >= sw.life) {
        sw.active = false;
        sw.mesh.visible = false;
        continue;
      }
      const t = sw.age / sw.life;
      const s = sw.startScale + (sw.endScale - sw.startScale) * t;
      sw.mesh.scale.set(s, s, 1);
      sw.mesh.rotation.y += sw.spinSpeed * safeDt;
      sw.mat.opacity = sw.maxAlpha * Math.max(0, 1 - t * t);
    }
  }

  public dispose(): void {
    this.scene.remove(this.particleMesh);
    this.scene.remove(this.clodMesh);
    this.particleMesh.geometry.dispose();
    this.particleMat.dispose();
    this.clodMesh.geometry.dispose();
    (this.clodMesh.material as THREE.Material).dispose();
    for (const d of this.decals) {
      this.scene.remove(d.mesh);
      d.mat.dispose();
    }
    if (this.decals[0]) this.decals[0].mesh.geometry.dispose();
    for (const sw of this.swipes) {
      this.scene.remove(sw.mesh);
      sw.mat.dispose();
    }
    if (this.swipes[0]) this.swipes[0].mesh.geometry.dispose();
    this.boneSpikeGeo.dispose();
    this.boneSpikeMat.dispose();
    this.waterBubbleGeo.dispose();
    this.waterCoreGeo.dispose();
    this.waterCoreMat.dispose();
    this.atlasTex.dispose();
    this.fiberTex.dispose();
    this.crackTex.dispose();
    this.warnTex.dispose();
    this.bladeGlowTex.dispose();
  }
}

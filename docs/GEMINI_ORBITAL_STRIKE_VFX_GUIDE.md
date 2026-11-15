# ENDO NINE — Commander Orbital Strike VFX Overhaul Guide (For Gemini 3.8)

> **Role & Objective:** You are executing the step-by-step real-time 3D VFX overhaul for Commander's **Orbital Strike (`Orbital Judgment`)** ultimate ability in `Endo Nine`.
> Follow Steps 1 through 4 in exact order. **Do NOT alter any gameplay balance, damage values, AoE radius, cooldowns, targeting rules, or character sprite animations.**

---

## Architecture Overview

| Phase | Timing (Relative to Cast) | Commander Animation Sync | Real-Time 3D VFX Components (`src/render/ThreeVFX.ts`) |
|---|---|---|---|
| **Phase 1: Orbital Target Lock** | `t = 0.00s → 0.40s` (persists under impact until `0.75s`) | **Frame 1 (`0.00s–0.20s`):** Wristwatch Activated<br>**Frames 2–3 (`0.20s–0.40s`):** Hand Raised | Terrain-conforming `16×16` subdivided reticle mesh with custom GLSL shader (`OrbitalTargetLock`): concentric rings, counter-rotating segmented arcs, **4 cardinal triangular lock indicators (`◀ ▶ ▲ ▼`)**, central sigil, intensifying golden glow, and thin vertical sky-to-ground pilot laser thread. |
| **Phase 2: Descending Orbital Beam** | `t = 0.40s → 1.05s` (`0.65s` duration) | **Frame 4 (`0.40s`):** Downward Command | **1. Inner Core:** High-contrast, nearly opaque white-yellow core (`#FFFFFF` / `#FEF08A`).<br>**2. Middle Plasma Layer:** Custom GLSL scrolling golden-amber plasma shader (`#FACC15` / `#F59E0B`) with Fresnel edge softness.<br>**3. Outer Glow + Sky Aperture:** Soft orange-gold halo (`#F97316`) + upper **Orbital Aperture Ring** near top of view with `8` descending vertical light needles.<br>**4. Electric Arcs:** `5` helical 3D lightning bolts wrapping the beam + `4` ground radial lightning arcs, re-jittering every `35ms`. |
| **Phase 3: Impact Explosion & Shockwave** | `t = 0.40s → 1.35s` | **Frame 4 (`0.40s`):** Exact Strike Event (`isOrbitalBlast`) | **1. Base Impact Flash:** Brilliant white-gold starburst flare at ground contact + transient `THREE.PointLight` (`intensity: 8.5 → 0` over `0.45s`).<br>**2. Expanding Shockwave:** Terrain-conforming GLSL shockwave ring expanding to exact `radius` (`260`) with crisp golden leading edge & radial streaks.<br>**3. Pooled Particles:** `36` golden sparks + `20` tumbling dark rock debris chunks with gravity + `22` billowing warm-lit dust puffs. |
| **Phase 4: Ground Aftermath** | `t = 0.40s → 2.80s` (`2.40s` post-impact fade) | **Frame 5 (`0.50s+`):** Post-Impact Recovery | Terrain-conforming `16×16` subdivided scorch decal (`createTerrainConformingGrid`) with procedural GLSL **Voronoi Molten Fissures & Charred Earth** shader, cooling from white-gold to ember-orange and fading out cleanly with zero memory leaks. |

---

## Step 1: Upgrade `src/render/ThreeVFX.ts` with the 4-Phase Orbital Strike System

Replace the contents of `src/render/ThreeVFX.ts` with the complete, modular implementation below. It preserves **all** existing VFX methods (`spawnAlienBloodSplatter`, `spawnLandingRing`, `spawnLaserCharge`, `spawnLaserBeam`, `spawnScatterBlast`, `spawnBlinkVFX`, `spawnShockwaveRing`, `spawnDamageNumber`, `spawnDashGhost`, `drawChainLightning`) while upgrading `spawnOrbitalTargetLock` and `spawnOrbitalBlast` to the 4-phase real-time shader + particle system.

```typescript
import * as THREE from 'three';
import { Vector2 } from '../sim/types';

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

export class ThreeVFX {
  public group: THREE.Group;
  private rings: ActiveRing[] = [];
  private beams: ActiveBeam[] = [];
  private damageTexts: ActiveDamageText[] = [];
  private ghosts: ActiveGhost[] = [];
  private lightningLines: THREE.Line[] = [];
  private bloodDecals: ActiveBloodDecal[] = [];
  private bloodTexture: THREE.Texture | null = null;
  private bloodPlaneGeo = new THREE.PlaneGeometry(28, 28);

  // Terrain elevation callback so decals, target locks, and shockwaves hug slopes
  private heightSampler: (x: number, z: number) => number = () => 0;

  // Orbital Strike 4-Phase Active Containers & Shared Geometries
  private targetLocks: ActiveTargetLock[] = [];
  private orbitalSequences: ActiveOrbitalSequence[] = [];
  private orbitalParticles: ActiveOrbitalParticle[] = [];
  private sharedSparkGeo = new THREE.OctahedronGeometry(1.0, 0);
  private sharedDebrisGeo = new THREE.DodecahedronGeometry(1.0, 0);
  private sharedDustGeo = new THREE.PlaneGeometry(1.0, 1.0);
  private dustRadialTex: THREE.CanvasTexture | null = null;

  constructor(heightSampler?: (x: number, z: number) => number) {
    this.group = new THREE.Group();
    if (heightSampler) {
      this.heightSampler = heightSampler;
    }
    new THREE.TextureLoader().load('/assets/alien_blood_decal.png', (tex) => {
      tex.colorSpace = THREE.SRGBColorSpace;
      this.bloodTexture = tex;
    });
    this.dustRadialTex = this.createSoftSmokeTexture();
  }

  public setHeightSampler(sampler: (x: number, z: number) => number): void {
    this.heightSampler = sampler;
  }

  private getTerrainHeight(x: number, z: number, fallback: number = 0): number {
    try {
      const h = this.heightSampler(x, z);
      return Number.isFinite(h) ? h : fallback;
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

    const reticleMat = new THREE.ShaderMaterial({
      transparent: true,
      depthWrite: false,
      side: THREE.DoubleSide,
      blending: THREE.AdditiveBlending,
      uniforms: {
        uTime: { value: 0.0 },
        uProgress: { value: 0.0 }, // 0 -> 1 during target lock, >1 after impact
        uAlpha: { value: 1.0 },
        uPrimaryColor: { value: primaryCol },
        uAccentColor: { value: accentCol }
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

        #define PI 3.14159265359

        void main() {
          vec2 p = (vUv - 0.5) * 2.0;
          float r = length(p);
          if (r > 1.0) discard;

          float angle = atan(p.y, p.x);
          float lockIntensity = clamp(uProgress, 0.0, 1.0);
          float rotSpeed = 1.6 + lockIntensity * 2.8;

          // 1. Thin concentric orbital rings
          float outerRing = smoothstep(0.018, 0.003, abs(r - 0.88));
          float midRing   = smoothstep(0.015, 0.003, abs(r - 0.72));
          float innerRing = smoothstep(0.014, 0.003, abs(r - 0.38));

          // 2. Counter-rotating segmented orbital markings
          float segAngle1 = angle + uTime * rotSpeed;
          float segMask1 = step(0.15, sin(segAngle1 * 8.0)) * smoothstep(0.028, 0.006, abs(r - 0.80));

          float segAngle2 = angle - uTime * (rotSpeed * 1.25);
          float segMask2 = step(0.25, cos(segAngle2 * 12.0)) * smoothstep(0.022, 0.005, abs(r - 0.56));

          // Fine degree ticks around outer perimeter
          float tickMask = step(0.75, cos(angle * 36.0)) * smoothstep(0.032, 0.006, abs(r - 0.93));

          // 3. Four Cardinal Radial Triangle Lock Chevrons (matching reference image!)
          vec2 ap = abs(p);
          float axisCoord = max(ap.x, ap.y);
          float perpCoord = min(ap.x, ap.y);
          float chevCenter = mix(0.94, 0.82, lockIntensity);
          float dR = axisCoord - chevCenter; // 0 at tip, positive outward
          float chevMask = 0.0;
          if (dR >= 0.0 && dR <= 0.14) {
            float halfW = dR * 0.68 + 0.006;
            chevMask = smoothstep(halfW, halfW * 0.35, perpCoord);
          }

          // 4. Radial axis hairlines + Central targeting symbol
          float crossLines = smoothstep(0.012, 0.002, perpCoord) * step(0.18, axisCoord) * step(axisCoord, 0.70);
          float centerDot = smoothstep(0.09, 0.02, r);
          float centerRing = smoothstep(0.016, 0.003, abs(r - 0.16));

          // 5. Converging lock-on pulse ring
          float sweepR = fract(1.0 - uTime * 2.2) * 0.88;
          float sweepRing = smoothstep(0.04, 0.005, abs(r - sweepR)) * (0.4 + 0.6 * lockIntensity);

          // Combine geometric layers
          float pattern = outerRing * 1.1
                        + midRing * 0.95
                        + innerRing * 0.85
                        + segMask1 * 0.85
                        + segMask2 * 0.70
                        + tickMask * 0.65
                        + chevMask * 1.65
                        + crossLines * 0.55
                        + centerDot * 1.35
                        + centerRing * 1.0
                        + sweepRing * 0.75;

          // Subtle warm radial glow floor that intensifies as the strike approaches
          float baseGlow = (1.0 - r * r) * (0.12 + 0.26 * lockIntensity);
          float totalIntensity = pattern + baseGlow;

          vec3 col = mix(uPrimaryColor, uAccentColor, clamp(pattern * 0.65 + lockIntensity * 0.35, 0.0, 1.0));
          float alpha = clamp(totalIntensity * (0.65 + 0.55 * lockIntensity) * uAlpha, 0.0, 1.0);

          gl_FragColor = vec4(col * (1.2 + lockIntensity * 0.9), alpha);
        }
      `
    });

    const reticleMesh = new THREE.Mesh(reticleGeo, reticleMat);
    lockGroup.add(reticleMesh);

    // Thin vertical sky-to-ground targeting pilot laser thread during lock-on
    const pilotGeo = new THREE.CylinderGeometry(1.2, 2.2, 1400, 12, 1, true);
    const pilotMat = new THREE.MeshBasicMaterial({
      color: primaryCol,
      transparent: true,
      opacity: 0.25,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
      side: THREE.DoubleSide
    });
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
    variant: string = 'judgment'
  ): void {
    const baseElev = this.getTerrainHeight(pos.x, pos.y, elevation);

    // Support special non-beam variants (Cryo / Vortex / Bomb) cleanly while upgrading full Orbital Strikes
    if (variant === 'cryo' || variant === 'vortex') {
      const domeColor = variant === 'cryo' ? 0x06b6d4 : 0x7c3aed;
      const domeGeo = new THREE.SphereGeometry(radius * 0.55, 24, 16, 0, Math.PI * 2, 0, Math.PI / 2);
      const domeMat = new THREE.MeshBasicMaterial({
        color: domeColor,
        transparent: true,
        opacity: 0.75,
        blending: THREE.AdditiveBlending,
        side: THREE.DoubleSide
      });
      const domeMesh = new THREE.Mesh(domeGeo, domeMat);
      domeMesh.position.set(pos.x, baseElev + 0.5, pos.y);
      this.group.add(domeMesh);
      this.beams.push({ mesh: domeMesh, lifetime: 0.65, maxLifetime: 0.65 });
      this.spawnShockwaveRing(pos, radius, domeColor, baseElev, 0.55);
      return;
    }

    // Enforce max 4 simultaneous full orbital sequences (FIFO cleanup for zero leaks under rapid cast)
    if (this.orbitalSequences.length >= 4) {
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
    // 1. INNER CORE: Narrow, high-contrast, nearly opaque white-yellow center
    // ------------------------------------------------------------------------
    const coreGeo = new THREE.CylinderGeometry(
      beamRadiusBase * 0.52,
      beamRadiusBase * 0.68,
      beamHeight,
      24,
      1,
      true
    );
    const coreMat = new THREE.ShaderMaterial({
      transparent: true,
      depthWrite: false,
      side: THREE.DoubleSide,
      blending: THREE.AdditiveBlending,
      uniforms: {
        uTime: { value: 0.0 },
        uIntensity: { value: 1.0 },
        uCoreColor: { value: coreCol },
        uMidColor: { value: midCol }
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
    });
    const coreMesh = new THREE.Mesh(coreGeo, coreMat);
    coreMesh.position.y = beamHeight * 0.5;
    seqGroup.add(coreMesh);

    // ------------------------------------------------------------------------
    // 2. MIDDLE ENERGY LAYER: Animated golden plasma striations & distortion
    // ------------------------------------------------------------------------
    const midGeo = new THREE.CylinderGeometry(
      beamRadiusBase * 0.95,
      beamRadiusBase * 1.32,
      beamHeight,
      32,
      8,
      true
    );
    const midMat = new THREE.ShaderMaterial({
      transparent: true,
      depthWrite: false,
      side: THREE.DoubleSide,
      blending: THREE.AdditiveBlending,
      uniforms: {
        uTime: { value: 0.0 },
        uIntensity: { value: 1.0 },
        uCoreColor: { value: coreCol },
        uMidColor: { value: midCol },
        uOuterColor: { value: outerCol }
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
    });
    const midMesh = new THREE.Mesh(midGeo, midMat);
    midMesh.position.y = beamHeight * 0.5;
    seqGroup.add(midMesh);

    // ------------------------------------------------------------------------
    // 3. OUTER GLOW: Softer orange-gold energy halo with controlled bloom
    // ------------------------------------------------------------------------
    const outerGeo = new THREE.CylinderGeometry(
      beamRadiusBase * 1.65,
      beamRadiusBase * 2.35,
      beamHeight,
      24,
      1,
      true
    );
    const outerMat = new THREE.ShaderMaterial({
      transparent: true,
      depthWrite: false,
      side: THREE.DoubleSide,
      blending: THREE.AdditiveBlending,
      uniforms: {
        uIntensity: { value: 1.0 },
        uOuterColor: { value: outerCol },
        uMidColor: { value: midCol }
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
    });
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
    const apertureMat = new THREE.ShaderMaterial({
      transparent: true,
      depthWrite: false,
      side: THREE.DoubleSide,
      blending: THREE.AdditiveBlending,
      uniforms: {
        uTime: { value: 0.0 },
        uIntensity: { value: 1.0 },
        uMidColor: { value: midCol },
        uCoreColor: { value: coreCol }
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
        void main() {
          vec2 p = (vUv - 0.5) * 2.0;
          float r = length(p);
          if (r > 1.0) discard;
          float a = atan(p.y, p.x);
          float r1 = smoothstep(0.025, 0.004, abs(r - 0.92));
          float r2 = smoothstep(0.035, 0.006, abs(r - 0.76)) * step(0.1, sin(a * 10.0 - uTime * 3.0));
          float r3 = smoothstep(0.022, 0.004, abs(r - 0.54));
          float core = smoothstep(0.32, 0.0, r) * 0.65;
          float mask = r1 + r2 + r3 + core;
          vec3 col = mix(uMidColor, uCoreColor, clamp(mask * 0.6, 0.0, 1.0)) * 1.4;
          gl_FragColor = vec4(col, clamp(mask * uIntensity * 0.85, 0.0, 1.0));
        }
      `
    });
    const apertureMesh = new THREE.Mesh(apertureGeo, apertureMat);
    apertureMesh.position.y = apertureHeight;
    seqGroup.add(apertureMesh);

    // 8 thin descending golden light needles around the upper aperture
    const needlesGroup = new THREE.Group();
    const needleMats: THREE.MeshBasicMaterial[] = [];
    for (let i = 0; i < 8; i++) {
      const ang = (i / 8) * Math.PI * 2 + 0.2;
      const dist = apertureRadius * (0.48 + (i % 2) * 0.26);
      const needleLen = 95 + (i % 3) * 32;
      const nGeo = new THREE.CylinderGeometry(1.3, 0.25, needleLen, 6, 1, true);
      const nMat = new THREE.MeshBasicMaterial({
        color: i % 2 === 0 ? coreCol : midCol,
        transparent: true,
        opacity: 0.72,
        blending: THREE.AdditiveBlending,
        depthWrite: false
      });
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
    // ------------------------------------------------------------------------
    const lightningLines: ActiveOrbitalSequence['lightningLines'] = [];
    for (let a = 0; a < 9; a++) {
      const isGroundArc = a >= 5;
      const baseAngle = (a / (isGroundArc ? 4 : 5)) * Math.PI * 2;
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
    const impactFlashGeo = this.createTerrainConformingGrid(
      pos.x,
      pos.y,
      flashRadius,
      12,
      1.1,
      baseElev
    );
    const impactFlashMat = new THREE.ShaderMaterial({
      transparent: true,
      depthWrite: false,
      side: THREE.DoubleSide,
      blending: THREE.AdditiveBlending,
      uniforms: {
        uTime: { value: 0.0 },
        uIntensity: { value: 1.0 },
        uCoreColor: { value: coreCol },
        uMidColor: { value: midCol },
        uOuterColor: { value: outerCol }
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
    });
    const impactFlashMesh = new THREE.Mesh(impactFlashGeo, impactFlashMat);
    seqGroup.add(impactFlashMesh);

    // Defined Expanding Shockwave Ring following the ultimate's exact AoE radius
    const shockwaveGeo = this.createTerrainConformingGrid(
      pos.x,
      pos.y,
      radius * 1.05,
      20,
      0.85,
      baseElev
    );
    const shockwaveMat = new THREE.ShaderMaterial({
      transparent: true,
      depthWrite: false,
      side: THREE.DoubleSide,
      blending: THREE.AdditiveBlending,
      uniforms: {
        uProgress: { value: 0.05 }, // 0 -> 1 as wave expands to AoE radius
        uAlpha: { value: 1.0 },
        uCoreColor: { value: coreCol },
        uMidColor: { value: midCol },
        uOuterColor: { value: outerCol }
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

        void main() {
          vec2 p = (vUv - 0.5) * 2.0;
          float r = length(p);
          if (r > 1.0) discard;
          float a = atan(p.y, p.x);

          float waveR = clamp(uProgress, 0.08, 0.96);
          // Crisp leading edge + warm trailing wake
          float distToWave = r - waveR;
          float leadingEdge = smoothstep(0.035, 0.0, abs(distToWave));
          float trailingWake = smoothstep(waveR - 0.24, waveR, r) * step(r, waveR) * 0.45;

          // Secondary inner pressure ripple
          float innerR = waveR * 0.68;
          float innerRipple = smoothstep(0.025, 0.0, abs(r - innerR)) * 0.45;

          // Radial energy streaks along the expanding ring
          float streaks = (0.65 + 0.35 * sin(a * 24.0)) * (leadingEdge + trailingWake);

          float intensity = leadingEdge * 1.35 + trailingWake + innerRipple + streaks * 0.35;
          vec3 col = mix(uOuterColor, uMidColor, clamp(leadingEdge + innerRipple, 0.0, 1.0));
          col = mix(col, uCoreColor, pow(leadingEdge, 2.0) * 0.85) * 1.55;

          gl_FragColor = vec4(col, clamp(intensity * uAlpha, 0.0, 1.0));
        }
      `
    });
    const shockwaveMesh = new THREE.Mesh(shockwaveGeo, shockwaveMat);
    seqGroup.add(shockwaveMesh);

    // Transient Dynamic Terrain Illumination (single PointLight, decays smoothly)
    const pointLight = new THREE.PointLight(lightHex, 8.5, radius * 2.5, 1.4);
    pointLight.position.set(0, 38, 0);
    seqGroup.add(pointLight);

    // ------------------------------------------------------------------------
    // 7. PHASE FOUR: TERRAIN-CONFORMING SCORCHED CRATER & MOLTEN CRACKS DECAL
    // ------------------------------------------------------------------------
    const scorchRadius = radius * 0.96;
    const scorchGeo = this.createTerrainConformingGrid(
      pos.x,
      pos.y,
      scorchRadius,
      18,
      0.32,
      baseElev
    );
    const scorchMat = new THREE.ShaderMaterial({
      transparent: true,
      depthWrite: false,
      side: THREE.DoubleSide,
      uniforms: {
        uAge: { value: 0.0 },        // 0 -> 1 over total 2.6s lifetime
        uHeat: { value: 1.0 },       // 1 -> 0 as molten cracks cool
        uCoreColor: { value: coreCol },
        uMidColor: { value: midCol },
        uOuterColor: { value: outerCol }
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
      `
    });
    const scorchMesh = new THREE.Mesh(scorchGeo, scorchMat);
    // Render scorched decal underneath additive shockwaves and beams
    scorchMesh.renderOrder = -1;
    seqGroup.add(scorchMesh);

    // ------------------------------------------------------------------------
    // 8. SPAWN POOLED SPARKS, TUMBLING ROCK DEBRIS, AND BILLOWING DUST RING
    // ------------------------------------------------------------------------
    this.spawnOrbitalParticles(pos, baseElev, radius, coreCol, midCol, outerCol);

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
    outerCol: THREE.Color
  ): void {
    // Cap total active orbital particles to keep frame times ultra-fast
    while (this.orbitalParticles.length > 140) {
      const oldest = this.orbitalParticles.shift();
      if (oldest) {
        this.group.remove(oldest.mesh);
        (oldest.mesh.material as THREE.Material).dispose();
      }
    }

    // 1. Concentrated Burst of Golden Sparks (32 particles)
    for (let i = 0; i < 32; i++) {
      const ang = Math.random() * Math.PI * 2;
      const speed = 95 + Math.random() * 240;
      const vy = 85 + Math.random() * 220;
      const mat = new THREE.MeshBasicMaterial({
        color: i % 3 === 0 ? coreCol : i % 2 === 0 ? midCol : outerCol,
        transparent: true,
        opacity: 0.98,
        blending: THREE.AdditiveBlending
      });
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

    // 2. Scattered Dark Rock Debris Chunks (18 ballistic chunks)
    for (let i = 0; i < 18; i++) {
      const ang = (i / 18) * Math.PI * 2 + (Math.random() - 0.5) * 0.35;
      const speed = 75 + Math.random() * 195;
      const vy = 105 + Math.random() * 185;
      // Dark charred rock with warm golden-amber under-lit rim tint
      const rockColor = i % 3 === 0 ? 0x3f362e : i % 2 === 0 ? 0x292524 : 0x1c1917;
      const mat = new THREE.MeshBasicMaterial({
        color: rockColor,
        transparent: true,
        opacity: 0.96
      });
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

    // 3. Expanding Ring of Warm-Lit Dust & Smoke Plumes (20 puffs)
    for (let i = 0; i < 20; i++) {
      const ang = (i / 20) * Math.PI * 2 + (Math.random() - 0.5) * 0.22;
      const speed = (radius * 0.55) + Math.random() * (radius * 0.45);
      const mat = new THREE.MeshBasicMaterial({
        map: this.dustRadialTex || undefined,
        color: i % 2 === 0 ? 0xd6c7b2 : 0xfbbf24,
        transparent: true,
        opacity: 0.52,
        depthWrite: false,
        side: THREE.DoubleSide
      });
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
    seq.coreMat.dispose();
    seq.midMesh.geometry.dispose();
    seq.midMat.dispose();
    seq.outerMesh.geometry.dispose();
    seq.outerMat.dispose();
    seq.apertureMesh.geometry.dispose();
    seq.apertureMat.dispose();
    seq.needlesGroup.traverse((child) => {
      if ((child as THREE.Mesh).isMesh) {
        const m = child as THREE.Mesh;
        m.geometry.dispose();
        (m.material as THREE.Material).dispose();
      }
    });
    seq.impactFlashMesh.geometry.dispose();
    seq.impactFlashMat.dispose();
    seq.shockwaveMesh.geometry.dispose();
    seq.shockwaveMat.dispose();
    seq.scorchMesh.geometry.dispose();
    seq.scorchMat.dispose();
    for (let i = 0; i < seq.lightningLines.length; i++) {
      seq.lightningLines[i].line.geometry.dispose();
      seq.lightningLines[i].mat.dispose();
    }
  }

  // Spawn persistent bioluminescent alien blood / ichor puddle on the battlefield
  public spawnAlienBloodSplatter(pos: Vector2, elevation: number = 0, colorHex: number = 0x22d3ee): void {
    if (this.bloodDecals.length > 80) {
      const oldest = this.bloodDecals.shift();
      if (oldest) {
        this.group.remove(oldest.mesh);
        (oldest.mesh.material as THREE.Material).dispose();
      }
    }

    const scale = 0.8 + Math.random() * 0.9;
    const mat = new THREE.MeshBasicMaterial({
      map: this.bloodTexture,
      color: colorHex,
      transparent: true,
      opacity: 0.88,
      depthWrite: false
    });

    const mesh = new THREE.Mesh(this.bloodPlaneGeo, mat);
    mesh.rotation.x = -Math.PI / 2;
    mesh.rotation.z = Math.random() * Math.PI * 2;
    mesh.position.set(pos.x + (Math.random() - 0.5) * 12, elevation + 0.15, pos.y + (Math.random() - 0.5) * 12);
    mesh.scale.set(scale, scale, 1);
    this.group.add(mesh);

    this.bloodDecals.push({
      mesh,
      lifetime: 22,
      maxLifetime: 22
    });
  }

  // 1. Landing Frost Shockwave Ring on Ground
  public spawnLandingRing(pos: Vector2, elevation: number = 0): void {
    const geo = new THREE.RingGeometry(1, 3, 32);
    const mat = new THREE.MeshBasicMaterial({
      color: 0x67e8f9,
      side: THREE.DoubleSide,
      transparent: true,
      opacity: 0.85
    });
    const mesh = new THREE.Mesh(geo, mat);
    mesh.rotation.x = -Math.PI / 2;
    mesh.position.set(pos.x, elevation + 0.3, pos.y);
    this.group.add(mesh);

    this.rings.push({
      mesh,
      maxRadius: 38,
      currentRadius: 2,
      lifetime: 0.35,
      maxLifetime: 0.35
    });
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

    const guideGeo = new THREE.CylinderGeometry(0.85, 0.85, length, 8);
    guideGeo.rotateX(Math.PI / 2);
    const guideMat = new THREE.MeshBasicMaterial({
      color: 0xe879f9,
      transparent: true,
      opacity: 0.65,
      blending: THREE.AdditiveBlending
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

  // 2c. Horizontal Piercing Hyper-Laser Beam with Lingering Residual Heat Channel (No Strobe)
  public spawnLaserBeam(from: Vector2, to: Vector2, elevation: number = 0): void {
    const dx = to.x - from.x;
    const dy = to.y - from.y;
    const length = Math.hypot(dx, dy) || 1;
    const midX = (from.x + to.x) / 2;
    const midZ = (from.y + to.y) / 2;
    const beamY = elevation + 18;
    const angle = Math.atan2(dx, dy);

    const outerGeo = new THREE.CylinderGeometry(9.5, 9.5, length, 16);
    outerGeo.rotateX(Math.PI / 2);
    const outerMat = new THREE.MeshBasicMaterial({
      color: 0xd946ef,
      transparent: true,
      opacity: 0.68,
      blending: THREE.AdditiveBlending
    });
    const outerMesh = new THREE.Mesh(outerGeo, outerMat);
    outerMesh.position.set(midX, beamY, midZ);
    outerMesh.rotation.y = angle;
    this.group.add(outerMesh);

    const midSheathGeo = new THREE.CylinderGeometry(5.2, 5.2, length, 14);
    midSheathGeo.rotateX(Math.PI / 2);
    const midSheathMat = new THREE.MeshBasicMaterial({
      color: 0xa855f7,
      transparent: true,
      opacity: 0.85,
      blending: THREE.AdditiveBlending
    });
    const midSheathMesh = new THREE.Mesh(midSheathGeo, midSheathMat);
    midSheathMesh.position.set(midX, beamY, midZ);
    midSheathMesh.rotation.y = angle;
    this.group.add(midSheathMesh);

    const coreGeo = new THREE.CylinderGeometry(2.4, 2.4, length, 12);
    coreGeo.rotateX(Math.PI / 2);
    const coreMat = new THREE.MeshBasicMaterial({
      color: 0xffffff,
      transparent: true,
      opacity: 0.98,
      blending: THREE.AdditiveBlending
    });
    const coreMesh = new THREE.Mesh(coreGeo, coreMat);
    coreMesh.position.set(midX, beamY, midZ);
    coreMesh.rotation.y = angle;
    this.group.add(coreMesh);

    const trailGeo = new THREE.CylinderGeometry(1.6, 1.6, length, 10);
    trailGeo.rotateX(Math.PI / 2);
    const trailMat = new THREE.MeshBasicMaterial({
      color: 0xf0abfc,
      transparent: true,
      opacity: 0.55,
      blending: THREE.AdditiveBlending
    });
    const trailMesh = new THREE.Mesh(trailGeo, trailMat);
    trailMesh.position.set(midX, beamY, midZ);
    trailMesh.rotation.y = angle;
    this.group.add(trailMesh);

    this.beams.push({ mesh: outerMesh, lifetime: 0.42, maxLifetime: 0.42 });
    this.beams.push({ mesh: midSheathMesh, lifetime: 0.36, maxLifetime: 0.36 });
    this.beams.push({ mesh: coreMesh, lifetime: 0.28, maxLifetime: 0.28 });
    this.beams.push({ mesh: trailMesh, lifetime: 0.65, maxLifetime: 0.65 });

    this.spawnShockwaveRing(from, 38, 0xe879f9, elevation + 12, 0.26);
    this.spawnShockwaveRing(to, 52, 0xc084fc, elevation + 12, 0.32);
  }

  // 2d. Wide Cone Scatter Blast Muzzle Flash
  public spawnScatterBlast(from: Vector2, to: Vector2, elevation: number = 0): void {
    const dx = to.x - from.x;
    const dy = to.y - from.y;
    const angle = Math.atan2(dx, dy);

    const coneGeo = new THREE.ConeGeometry(42, 75, 16, 1, true);
    coneGeo.rotateX(-Math.PI / 2);
    const coneMat = new THREE.MeshBasicMaterial({
      color: 0xfbbf24,
      transparent: true,
      opacity: 0.78,
      side: THREE.DoubleSide,
      blending: THREE.AdditiveBlending
    });
    const coneMesh = new THREE.Mesh(coneGeo, coneMat);
    coneMesh.position.set(
      from.x + Math.sin(angle) * 35,
      elevation + 18,
      from.y + Math.cos(angle) * 35
    );
    coneMesh.rotation.y = angle;
    this.group.add(coneMesh);

    this.beams.push({
      mesh: coneMesh,
      lifetime: 0.16,
      maxLifetime: 0.16
    });
  }

  // 2e. Phase Blink Warp Portal & Arrival Nova
  public spawnBlinkVFX(
    from: Vector2,
    fromZ: number,
    to: Vector2,
    toZ: number,
    radius: number = 95
  ): void {
    this.spawnShockwaveRing(from, 48, 0x38bdf8, fromZ, 0.32);
    this.spawnShockwaveRing(to, radius, 0xa855f7, toZ, 0.42);
    this.spawnShockwaveRing(to, radius * 0.65, 0x38bdf8, toZ + 4, 0.35);

    const pillarGeo = new THREE.CylinderGeometry(8, 22, 140, 16, 1, true);
    const pillarMat = new THREE.MeshBasicMaterial({
      color: 0xc084fc,
      transparent: true,
      opacity: 0.8,
      side: THREE.DoubleSide,
      blending: THREE.AdditiveBlending
    });
    const pillar = new THREE.Mesh(pillarGeo, pillarMat);
    pillar.position.set(to.x, toZ + 70, to.y);
    this.group.add(pillar);

    this.beams.push({
      mesh: pillar,
      lifetime: 0.28,
      maxLifetime: 0.28
    });
  }

  // 2b. Custom Colored Shockwave Ring (Artifact Pulses, Pod Unlocks, Level Up)
  public spawnShockwaveRing(
    pos: Vector2,
    maxRadius: number,
    colorHex: number = 0x38bdf8,
    elevation: number = 0,
    duration: number = 0.55
  ): void {
    const geo = new THREE.RingGeometry(2, 6, 48);
    const mat = new THREE.MeshBasicMaterial({
      color: colorHex,
      side: THREE.DoubleSide,
      transparent: true,
      opacity: 0.9
    });
    const mesh = new THREE.Mesh(geo, mat);
    mesh.rotation.x = -Math.PI / 2;
    mesh.position.set(pos.x, elevation + 0.6, pos.y);
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
      const text = isCrit ? `${Math.round(amount)}!` : `${Math.round(amount)}`;
      ctx.strokeText(text, 80, 40);
      ctx.fillStyle = color;
      ctx.fillText(text, 80, 40);
    }

    const texture = new THREE.CanvasTexture(canvas);
    const mat = new THREE.SpriteMaterial({
      map: texture,
      transparent: true,
      depthTest: false
    });
    const sprite = new THREE.Sprite(mat);
    const scaleX = isCrit ? 34 : 22;
    const scaleY = isCrit ? 17 : 11;
    sprite.scale.set(scaleX, scaleY, 1);
    sprite.position.set(pos.x, elevation + 28, pos.y);
    this.group.add(sprite);

    this.damageTexts.push({
      sprite,
      vy: isCrit ? 48 : 38,
      lifetime: isCrit ? 0.95 : 0.7,
      maxLifetime: isCrit ? 0.95 : 0.7
    });
  }

  // 4. Dash Afterimage Ghost
  public spawnDashGhost(pos: Vector2, mapTexture: THREE.Texture, elevation: number = 0): void {
    const geo = new THREE.PlaneGeometry(36, 36);
    const mat = new THREE.MeshBasicMaterial({
      map: mapTexture,
      transparent: true,
      opacity: 0.5,
      depthWrite: false
    });
    const mesh = new THREE.Mesh(geo, mat);
    mesh.position.set(pos.x, elevation + 18, pos.y);
    this.group.add(mesh);

    this.ghosts.push({
      mesh,
      lifetime: 0.25,
      maxLifetime: 0.25
    });
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
    const tubeGeo = new THREE.TubeGeometry(curve, 12, 2.6, 6, false);
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

    this.spawnShockwaveRing(to, 28, 0xc084fc, elevation - 14, 0.22);

    setTimeout(() => {
      this.group.remove(line);
      geo.dispose();
      mat.dispose();
    }, 160);
  }

  public update(dt: number, camera: THREE.Camera): void {
    // 0A. Update Phase One: Orbital Target Locks
    for (let i = this.targetLocks.length - 1; i >= 0; i--) {
      const lock = this.targetLocks[i];
      lock.elapsed += dt;
      if (lock.elapsed >= lock.totalLifetime) {
        this.group.remove(lock.group);
        lock.reticleMesh.geometry.dispose();
        lock.reticleMat.dispose();
        lock.pilotBeam.geometry.dispose();
        lock.pilotMat.dispose();
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

        // Re-jitter electric arcs every 35ms for crackling golden lightning
        seq.arcJitterTimer += dt;
        const beamRadiusBase = Math.max(28, seq.radius * 0.14);
        if (seq.arcJitterTimer >= 0.035) {
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
        seq.pointLight.intensity = 8.5 * Math.pow(1.0 - tFlash, 1.5);
      } else {
        seq.impactFlashMesh.visible = false;
        seq.pointLight.intensity = 0;
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
        (p.mesh.material as THREE.Material).dispose();
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

    // 1. Update expanding rings
    for (let i = this.rings.length - 1; i >= 0; i--) {
      const r = this.rings[i];
      r.lifetime -= dt;
      if (r.lifetime <= 0) {
        this.group.remove(r.mesh);
        r.mesh.geometry.dispose();
        (r.mesh.material as THREE.Material).dispose();
        this.rings.splice(i, 1);
        continue;
      }
      const t = 1 - r.lifetime / r.maxLifetime;
      const s = 1 + t * (r.maxRadius / r.currentRadius);
      r.mesh.scale.set(s, s, s);
      (r.mesh.material as THREE.MeshBasicMaterial).opacity = (1 - t) * 0.9;
    }

    // 2. Update orbital beams
    for (let i = this.beams.length - 1; i >= 0; i--) {
      const b = this.beams[i];
      b.lifetime -= dt;
      if (b.lifetime <= 0) {
        this.group.remove(b.mesh);
        b.mesh.geometry.dispose();
        (b.mesh.material as THREE.Material).dispose();
        this.beams.splice(i, 1);
        continue;
      }
      const t = 1 - b.lifetime / b.maxLifetime;
      (b.mesh.material as THREE.MeshBasicMaterial).opacity = (1 - t) * 0.85;
    }

    // 3. Update floating damage numbers
    for (let i = this.damageTexts.length - 1; i >= 0; i--) {
      const d = this.damageTexts[i];
      d.lifetime -= dt;
      if (d.lifetime <= 0) {
        this.group.remove(d.sprite);
        d.sprite.material.map?.dispose();
        d.sprite.material.dispose();
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
        g.mesh.geometry.dispose();
        (g.mesh.material as THREE.Material).dispose();
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
        (b.mesh.material as THREE.Material).dispose();
        this.bloodDecals.splice(i, 1);
        continue;
      }
      if (b.lifetime < 5) {
        (b.mesh.material as THREE.MeshBasicMaterial).opacity = (b.lifetime / 5) * 0.88;
      }
    }
  }
}
```

---

## Step 2: Wire `ThreeVFX` Terrain Height Sampler & Phase 1 Target Lock in `src/render/ThreeApp.ts`

Make two surgical edits in `src/render/ThreeApp.ts`:

### Edit 2A: Pass Terrain Height Sampler to `ThreeVFX` (Around Line 179)

In `src/render/ThreeApp.ts`, locate:
```typescript
    // 7. 3D VFX
    this.vfx = new ThreeVFX();
    this.scene.add(this.vfx.group);
```
Replace it with:
```typescript
    // 7. 3D VFX (with terrain height sampler so target locks, shockwaves, and scorch decals hug slopes)
    this.vfx = new ThreeVFX((x, z) => this.simulation.state.terrain.getElevation(x, z).height);
    this.scene.add(this.vfx.group);
```

### Edit 2B: Trigger `spawnOrbitalTargetLock` on `ultimate_fired` (Around Lines 2306–2326)

In `src/render/ThreeApp.ts`, locate the `case 'ultimate_fired':` handler:
```typescript
        case 'ultimate_fired':
          if (!this.use3DCommander && this.simulation.state.player.heroId === 'commander') {
            this.spriteAnimator.triggerUltimate(
              e.data?.duration || 0.60,
              e.data?.facing,
              e.data?.fps || 10
            );
          }
          if (e.data.variant === 'emergency_protocol') {
            this.soundManager.playOrbitalStrike();
            const elev = this.simulation.state.terrain.getElevation(e.data.pos.x, e.data.pos.y).height;
            this.vfx.spawnShockwaveRing(e.data.pos, e.data.radius, 0x10b981, elev, 1.2);
            this.vfx.spawnOrbitalBlast(e.data.pos, e.data.radius, elev, 'cryo');
            this.addCameraTrauma(0.6);
          } else if (e.data.variant === 'judgment' && e.data.pos) {
            const elev = this.simulation.state.terrain.getElevation(e.data.pos.x, e.data.pos.y).height;
            this.vfx.spawnShockwaveRing(e.data.pos, (e.data.radius || 260) * 0.45, 0xfacc15, elev, 0.38);
          } else {
            this.soundManager.playOrbitalStrike();
          }
          break;
```
Replace it with:
```typescript
        case 'ultimate_fired':
          if (!this.use3DCommander && this.simulation.state.player.heroId === 'commander') {
            this.spriteAnimator.triggerUltimate(
              e.data?.duration || 0.60,
              e.data?.facing,
              e.data?.fps || 10
            );
          }
          if (e.data.variant === 'emergency_protocol') {
            this.soundManager.playOrbitalStrike();
            const elev = this.simulation.state.terrain.getElevation(e.data.pos.x, e.data.pos.y).height;
            this.vfx.spawnShockwaveRing(e.data.pos, e.data.radius, 0x10b981, elev, 1.2);
            this.vfx.spawnOrbitalBlast(e.data.pos, e.data.radius, elev, 'cryo');
            this.addCameraTrauma(0.6);
          } else {
            const targetPos = e.data.pos || e.data.target;
            if (targetPos) {
              const elev = this.simulation.state.terrain.getElevation(targetPos.x, targetPos.y).height;
              const strikeDelay = e.data.strikeDelay ?? 0.40;
              this.vfx.spawnOrbitalTargetLock(
                targetPos,
                e.data.radius || 260,
                elev,
                strikeDelay,
                e.data.variant || 'judgment'
              );
            }
          }
          break;
```

---

## Step 3: Create and Run Automated Verification Script (`scratch/verify_orbital_strike_vfx.ts`)

Create `scratch/verify_orbital_strike_vfx.ts` to verify all 11 requirements from the specification (target lock synchronization, 4-layer beam & electric arcs, impact flash + shockwave, terrain-conforming scorch decal, elevated terrain support, memory cleanup across repeated casts, and zero gameplay/damage/cooldown regressions):

```typescript
import * as THREE from 'three';
import { Simulation } from '../src/sim/Simulation';
import { ThreeVFX } from '../src/render/ThreeVFX';
import { InputSnapshot } from '../src/sim/types';

let passed = 0;
let failed = 0;
function assert(cond: boolean, msg: string) {
  if (cond) {
    passed++;
    console.log(`  ✅ ${msg}`);
  } else {
    failed++;
    console.error(`  ❌ FAIL: ${msg}`);
  }
}

function emptyInput(overrides: Partial<InputSnapshot> = {}): InputSnapshot {
  return {
    moveDir: { x: 0, y: 0 },
    aimWorldPos: { x: 4000, y: 4000 },
    aimWorldZ: 0,
    castPrimary: false,
    castSecondary: false,
    castUtility: false,
    castUltimate: false,
    interact: false,
    jump: false,
    cameraYaw: 0,
    ...overrides
  };
}

console.log('=== VERIFYING COMMANDER ORBITAL STRIKE VFX OVERHAUL ===\n');

const sim = new Simulation();
sim.selectHero('commander');
sim.startRun();
sim.state.projectiles = [];
sim.state.orbitalStrikes = [];

const vfx = new ThreeVFX((x, z) => sim.state.terrain.getElevation(x, z).height);
const dummyCam = new THREE.PerspectiveCamera(50, 16 / 9, 2, 8000);

// 1. Place an enemy at a known target position and trigger Ultimate (R)
const p = sim.state.player;
p.primaryCooldownRemaining = 99;
p.secondaryCooldownRemaining = 99;
p.ultimateCooldownRemaining = 0;

const targetPos = { x: p.pos.x + 140, y: p.pos.y - 120 };
const targetElev = sim.state.terrain.getElevation(targetPos.x, targetPos.y).height;
sim.state.enemies = [
  {
    id: 'test_orbital_victim',
    type: 'crawler',
    pos: { ...targetPos },
    z: targetElev,
    vz: 0,
    isGrounded: true,
    velocity: { x: 0, y: 0 },
    health: 1000,
    maxHealth: 1000,
    speed: 0,
    touchDamage: 0,
    attackRange: 10,
    attackCooldown: 10,
    attackTimer: 10,
    currencyReward: 5,
    radius: 18,
    isElite: false
  }
];

const eventsCast = sim.tick(0.016, emptyInput({ castUltimate: true, aimWorldPos: targetPos, aimWorldZ: targetElev }));
const ultFired = eventsCast.find(e => e.type === 'ultimate_fired');
assert(!!ultFired, 'ultimate_fired event emitted on R cast');
assert(ultFired?.data?.strikeDelay === 0.40, 'strikeDelay is preserved at 0.40s (synchronized with Frame 4 Downward Command)');
assert(Math.abs(p.ultimateCooldownRemaining - (12.0 - 0.016)) < 0.05, 'Existing 12.0s Ultimate cooldown preserved');

// 2. Spawn Phase 1 Target Lock and verify terrain-conforming geometry & shader uniforms
vfx.spawnOrbitalTargetLock(targetPos, ultFired!.data.radius, targetElev, ultFired!.data.strikeDelay, 'judgment');
const activeLocks = (vfx as any).targetLocks as any[];
assert(activeLocks.length === 1, 'Phase 1: Active Orbital Target Lock created');
assert(
  Math.abs(activeLocks[0].group.position.x - targetPos.x) < 0.01 &&
    Math.abs(activeLocks[0].group.position.z - targetPos.y) < 0.01 &&
    Math.abs(activeLocks[0].group.position.y - targetElev) < 0.01,
  'Phase 1: Target Lock positioned at exact target coordinates and terrain elevation'
);

// Advance through Wristwatch (0.10s) and Hand Raised (0.25s)
vfx.update(0.25, dummyCam);
assert(
  activeLocks[0].reticleMat.uniforms.uProgress.value > 0.5,
  'Phase 1: Target Lock shader uProgress intensifies during Commander raised-hand phase'
);
assert(sim.state.enemies[0].health === 1000, 'No premature damage before 0.40s strike event');

// 3. Advance simulation to t = 0.40s (Downward Command strike event)
let strikeEvent: any = null;
for (let step = 0; step < 30; step++) {
  const evs = sim.tick(0.016, emptyInput({ aimWorldPos: targetPos }));
  const hit = evs.find(e => e.type === 'damage_dealt' && e.data?.isOrbitalBlast);
  if (hit) {
    strikeEvent = hit;
    break;
  }
}
assert(!!strikeEvent, 'Orbital Strike impact event emitted at t = 0.40s');
assert(sim.state.enemies[0].health === 1000 - 180, `Exact 180 Ultimate damage preserved (enemy HP = ${sim.state.enemies[0].health})`);

// 4. Spawn Phases 2, 3, 4 via spawnOrbitalBlast
vfx.spawnOrbitalBlast(strikeEvent.data.pos, strikeEvent.data.radius, strikeEvent.data.elevation, 'judgment');
const activeSeqs = (vfx as any).orbitalSequences as any[];
const activeParticles = (vfx as any).orbitalParticles as any[];
assert(activeSeqs.length === 1, 'Orbital Strike sequence spawned on strike event');

const seq = activeSeqs[0];
assert(!!seq.coreMesh && !!seq.midMesh && !!seq.outerMesh, 'Phase 2: 3-layer beam (Inner Core, Middle Plasma, Outer Glow) created');
assert(!!seq.apertureMesh && seq.needleMats.length === 8, 'Phase 2: Upper Sky Orbital Aperture Ring + 8 light needles created');
assert(seq.lightningLines.length === 9, 'Phase 2: 5 helical beam lightning arcs + 4 ground radial electric arcs created');
assert(!!seq.impactFlashMesh && !!seq.pointLight && seq.pointLight.intensity === 8.5, 'Phase 3: Base impact flash + transient PointLight created');
assert(!!seq.shockwaveMesh, 'Phase 3: Defined expanding shockwave ring created');
assert(activeParticles.length === 70, `Phase 3: 70 pooled particles spawned (32 sparks + 18 rock debris + 20 dust puffs, got ${activeParticles.length})`);
assert(!!seq.scorchMesh, 'Phase 4: Terrain-conforming scorch & molten fissure decal created');

// 5. Advance to t = 0.80s post-impact: beam should finish, scorch aftermath should still be glowing & cooling
for (let i = 0; i < 20; i++) {
  vfx.update(0.04, dummyCam);
}
assert(!seq.coreMesh.visible && !seq.midMesh.visible, 'Phase 2: Beam column cleanly hides after 0.68s beamDuration');
assert(seq.scorchMesh.visible && seq.scorchMat.uniforms.uHeat.value > 0, 'Phase 4: Scorched crater & molten cracks remain visible after beam finishes');

// 6. Advance past 2.65s total sequence lifetime and verify complete cleanup (zero leaks)
for (let i = 0; i < 60; i++) {
  vfx.update(0.04, dummyCam);
}
assert(activeLocks.length === 0, 'Phase 1: Target Lock automatically cleaned up');
assert(activeSeqs.length === 0, 'Phases 2-4: Orbital Strike sequence automatically cleaned up after 2.65s');
assert(activeParticles.length === 0, 'Phase 3: All sparks, debris, and dust particles cleaned up');

// 7. Test on elevated mountain terrain & rapid repeated casts (FIFO cap check)
const highPos = { x: 3400, y: 3400 };
const highElev = sim.state.terrain.getElevation(highPos.x, highPos.y).height;
for (let c = 0; c < 6; c++) {
  vfx.spawnOrbitalBlast(highPos, 260, highElev, 'judgment');
}
assert(activeSeqs.length <= 4, `Memory protection: Repeated rapid casts capped at <= 4 active sequences (got ${activeSeqs.length})`);

console.log(`\n=== SUMMARY: ${passed} passed, ${failed} failed ===`);
if (failed > 0) process.exit(1);
```

Run it via:
```powershell
npx tsx scratch/verify_orbital_strike_vfx.ts
```
And run the existing combat animation test suite to confirm zero regressions:
```powershell
npx tsx scratch/verify_commander_combat_anim.ts
```

---

## Step 4: Capture Live In-Game Screenshots of All 4 Phases (`scripts/capture-orbital-strike-vfx.cjs`)

Create `scripts/capture-orbital-strike-vfx.cjs` to launch the running game in headless Chrome (with SwiftShader WebGL), walk Commander into the open valley of Loop Stage 1, trigger Orbital Strike (`R`), and capture **two high-resolution in-game screenshots**:
1. `scratch/orbital_strike_beam_impact.png` — Captured right at **Beam Impact (`t = 0.44s`)**, showing the multi-layered white-gold beam, electric arcs, upper orbital aperture ring, impact flash, expanding shockwave, flying rock debris/sparks, and glowing ground cracks.
2. `scratch/orbital_strike_target_and_aftermath.png` — A side-by-side composite (`1920×540` or two `960×540` panels) showing **Phase 1: Orbital Target Lock (`t = 0.25s`)** on the left and **Phase 4: Scorched Ground & Molten Cracks Aftermath (`t = 1.15s`)** on the right.

```javascript
const { spawn } = require('child_process');
const path = require('path');
const fs = require('fs');
const sharp = require('sharp');

const CHROME_PATH = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
const URL = 'http://localhost:5173/';

function sleep(ms) {
  return new Promise(r => setTimeout(r, ms));
}

async function captureOrbitalStrikeScreenshots() {
  const userDataDir = path.resolve('scratch/chrome_profile_' + Date.now());
  const port = 9255;

  const chrome = spawn(CHROME_PATH, [
    `--remote-debugging-port=${port}`,
    `--user-data-dir=${userDataDir}`,
    '--headless=new',
    '--window-size=1280,720',
    '--enable-webgl',
    '--ignore-gpu-blocklist',
    '--use-gl=angle',
    '--use-angle=swiftshader',
    '--no-sandbox',
    '--disable-background-timer-throttling',
    '--disable-renderer-backgrounding',
    URL
  ]);

  try {
    let wsUrl = null;
    for (let i = 0; i < 30; i++) {
      await sleep(400);
      try {
        const res = await fetch(`http://127.0.0.1:${port}/json`);
        const tabs = await res.json();
        const page = tabs.find(t => t.type === 'page');
        if (page && page.webSocketDebuggerUrl) {
          wsUrl = page.webSocketDebuggerUrl;
          break;
        }
      } catch {}
    }

    if (!wsUrl) throw new Error('Could not connect to Chrome DevTools');

    const ws = new WebSocket(wsUrl);
    await new Promise((resolve, reject) => {
      ws.onopen = resolve;
      ws.onerror = reject;
    });

    let msgId = 1;
    function sendCmd(method, params = {}) {
      return new Promise((resolve, reject) => {
        const id = msgId++;
        const listener = (event) => {
          const data = JSON.parse(event.data);
          if (data.id === id) {
            ws.removeEventListener('message', listener);
            if (data.error) reject(data.error);
            else resolve(data.result);
          }
        };
        ws.addEventListener('message', listener);
        ws.send(JSON.stringify({ id, method, params }));
      });
    }

    await sendCmd('Page.enable');
    await sendCmd('Runtime.enable');
    await sleep(2500);

    // Click DEPLOY / START RUN button
    await sendCmd('Runtime.evaluate', {
      expression: `
        (() => {
          const btns = Array.from(document.querySelectorAll('button'));
          const startBtn = btns.find(b => /deploy|start|launch|play/i.test(b.textContent || ''));
          if (startBtn) startBtn.click();
        })()
      `
    });
    await sleep(1200);

    // Walk Commander forward (W) for 1.2s into the open valley away from the spawn arch
    await sendCmd('Runtime.evaluate', {
      expression: `window.dispatchEvent(new KeyboardEvent('keydown', { code: 'KeyW', key: 'w' }));`
    });
    await sleep(1200);
    await sendCmd('Runtime.evaluate', {
      expression: `window.dispatchEvent(new KeyboardEvent('keyup', { code: 'KeyW', key: 'w' }));`
    });
    await sleep(300);

    // Move mouse cursor slightly ahead and to the right of Commander so both Commander and the full Orbital Strike are framed clearly
    await sendCmd('Runtime.evaluate', {
      expression: `
        window.dispatchEvent(new MouseEvent('mousemove', {
          clientX: Math.round(window.innerWidth * 0.62),
          clientY: Math.round(window.innerHeight * 0.48),
          bubbles: true
        }));
      `
    });
    await sleep(100);

    // Press R to cast Orbital Strike!
    await sendCmd('Runtime.evaluate', {
      expression: `
        window.dispatchEvent(new KeyboardEvent('keydown', { code: 'KeyR', key: 'r', bubbles: true }));
        window.dispatchEvent(new KeyboardEvent('keyup', { code: 'KeyR', key: 'r', bubbles: true }));
      `
    });

    // 1. Capture Phase 1: Orbital Target Lock (~220ms after R press, before 400ms strike)
    await sleep(220);
    const shotTargetLock = await sendCmd('Page.captureScreenshot', { format: 'png' });
    const bufTargetLock = Buffer.from(shotTargetLock.data, 'base64');
    fs.writeFileSync('scratch/orbital_strike_target_lock.png', bufTargetLock);

    // 2. Capture Phase 2 & 3: Descending Beam + Impact Flash + Expanding Shockwave (~240ms later -> ~460ms total)
    await sleep(240);
    const shotBeamImpact = await sendCmd('Page.captureScreenshot', { format: 'png' });
    const bufBeamImpact = Buffer.from(shotBeamImpact.data, 'base64');
    fs.writeFileSync('scratch/orbital_strike_beam_impact.png', bufBeamImpact);

    // 3. Capture Phase 4: Scorched Ground & Molten Cracks Aftermath (~800ms later -> ~1260ms total, after beam fades)
    await sleep(800);
    const shotAftermath = await sendCmd('Page.captureScreenshot', { format: 'png' });
    const bufAftermath = Buffer.from(shotAftermath.data, 'base64');
    fs.writeFileSync('scratch/orbital_strike_aftermath.png', bufAftermath);

    // Build side-by-side Target Lock + Ground Aftermath composite image
    const leftImg = await sharp(bufTargetLock).resize(640, 360).toBuffer();
    const rightImg = await sharp(bufAftermath).resize(640, 360).toBuffer();
    await sharp({
      create: {
        width: 1280,
        height: 360,
        channels: 4,
        background: { r: 10, g: 14, b: 22, alpha: 1 }
      }
    })
      .composite([
        { input: leftImg, left: 0, top: 0 },
        { input: rightImg, left: 640, top: 0 }
      ])
      .png()
      .toFile('scratch/orbital_strike_target_and_aftermath.png');

    console.log('Saved all Orbital Strike VFX screenshots to scratch/!');
    ws.close();
  } finally {
    chrome.kill();
  }
}

captureOrbitalStrikeScreenshots().catch(err => {
  console.error(err);
  process.exit(1);
});
```

Run the capture script via:
```powershell
node scripts/capture-orbital-strike-vfx.cjs
```
Then inspect `scratch/orbital_strike_beam_impact.png` and `scratch/orbital_strike_target_and_aftermath.png` with `read_file`, copy both to the brain artifact directory, and embed them in your final summary!


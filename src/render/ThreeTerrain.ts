import * as THREE from 'three';
import { TerrainSystem } from '../sim/TerrainSystem';

export class ThreeTerrain {
  public group: THREE.Group;
  public stage1Group: THREE.Group;
  public testMapGroup: THREE.Group;
  public terrainMeshes: THREE.Object3D[] = [];
  private riverMesh: THREE.Mesh | null = null;
  private riverUniforms: { uTime: { value: number } } = { uTime: { value: 0 } };
  private freezeUniforms = {
    uFreezeProgress: { value: 0 },
    uFreezeOriginXZ: { value: new THREE.Vector2(1400, 1050) },
    uFreezeMaxRadius: { value: 4200 }
  };
  private textureLoader: THREE.TextureLoader;

  // 2.5D Billboarded Crashed Colony Shipwreck
  public shipHull: THREE.Mesh | null = null;
  public shipPos: THREE.Vector3 = new THREE.Vector3(1800, 0, 2960);

  private testMapAnimatedUniforms: Array<{ uTime: { value: number } }> = [];

  constructor(terrain: TerrainSystem, textureLoader?: THREE.TextureLoader) {
    this.group = new THREE.Group();
    this.stage1Group = new THREE.Group();
    this.testMapGroup = new THREE.Group();
    this.testMapGroup.visible = false;
    this.group.add(this.stage1Group, this.testMapGroup);
    this.textureLoader = textureLoader || new THREE.TextureLoader();
    this.buildTerrain(terrain);
  }

  public setTestMapGroup(
    model: THREE.Object3D | null,
    animatedUniforms?: Array<{ uTime: { value: number } }>
  ): void {
    this.testMapAnimatedUniforms = animatedUniforms ? [...animatedUniforms] : [];
    while (this.testMapGroup.children.length > 0) {
      const child = this.testMapGroup.children[0];
      this.testMapGroup.remove(child);
      child.traverse((obj) => {
        const mesh = obj as THREE.Mesh;
        if (mesh.isMesh) {
          mesh.geometry?.dispose();
          if (Array.isArray(mesh.material)) {
            mesh.material.forEach((m) => m.dispose());
          } else {
            mesh.material?.dispose();
          }
        }
      });
    }

    if (model) {
      this.testMapGroup.add(model);
      this.testMapGroup.visible = true;
      this.stage1Group.visible = false;
    } else {
      this.testMapGroup.visible = false;
      this.stage1Group.visible = true;
    }
  }

  public setRegionalFreeze(progress: number, originX?: number, originY?: number, maxRadius?: number): void {
    this.freezeUniforms.uFreezeProgress.value = Math.max(0, Math.min(1, progress));
    if (originX !== undefined && originY !== undefined) {
      this.freezeUniforms.uFreezeOriginXZ.value.set(originX, originY);
    }
    if (maxRadius !== undefined) {
      this.freezeUniforms.uFreezeMaxRadius.value = Math.max(1000, maxRadius);
    }
  }

  public update(dt: number, timeMs: number, camera?: THREE.Camera): void {
    const timeSec = timeMs * 0.001;
    this.riverUniforms.uTime.value = timeSec;
    for (let i = 0; i < this.testMapAnimatedUniforms.length; i++) {
      this.testMapAnimatedUniforms[i].uTime.value = timeSec;
    }

    // Constrained Billboarding: Continuously rotate on vertical Y-axis to face active gameplay camera horizontally
    if (this.shipHull && camera) {
      const dx = camera.position.x - this.shipPos.x;
      const dz = camera.position.z - this.shipPos.z;
      const angle = Math.atan2(dx, dz);
      this.shipHull.rotation.y = angle;
    }
  }

  private buildTerrain(terrain: TerrainSystem): void {
    // 1. Multi-Level Heightfield Mesh (160x160 segments = 25,600 vertices for smooth curves with high GPU performance)
    const segs = 160;
    const groundGeo = new THREE.PlaneGeometry(terrain.worldWidth, terrain.worldHeight, segs, segs);

    const posAttr = groundGeo.attributes.position;
    const vertexCount = posAttr.count;
    const halfW = terrain.worldWidth / 2;
    const halfH = terrain.worldHeight / 2;

    for (let i = 0; i < vertexCount; i++) {
      const lx = posAttr.getX(i);
      const ly = posAttr.getY(i);
      const wx = lx + halfW;
      const wy = -ly + halfH;
      const height = terrain.calculateHeight(wx, wy);
      posAttr.setZ(i, height);
    }

    posAttr.needsUpdate = true;
    groundGeo.computeVertexNormals();

    // 2. Load Multi-Layer Authoritative Stage 1 Ground Textures derived from reference
    const texThawedEarth = this.textureLoader.load('/assets/environment/floor_ref_thawed_earth.png?v=2.0');
    texThawedEarth.colorSpace = THREE.SRGBColorSpace;
    texThawedEarth.wrapS = THREE.RepeatWrapping;
    texThawedEarth.wrapT = THREE.RepeatWrapping;
    texThawedEarth.minFilter = THREE.LinearMipmapLinearFilter;
    texThawedEarth.magFilter = THREE.LinearFilter;
    texThawedEarth.anisotropy = 8;

    const texRockyFissure = this.textureLoader.load('/assets/environment/floor_ref_rocky_fissure.png?v=2.0');
    texRockyFissure.colorSpace = THREE.SRGBColorSpace;
    texRockyFissure.wrapS = THREE.RepeatWrapping;
    texRockyFissure.wrapT = THREE.RepeatWrapping;
    texRockyFissure.minFilter = THREE.LinearMipmapLinearFilter;
    texRockyFissure.magFilter = THREE.LinearFilter;
    texRockyFissure.anisotropy = 8;

    const texOrganicMoss = this.textureLoader.load('/assets/environment/floor_ref_organic_moss.png?v=2.0');
    texOrganicMoss.colorSpace = THREE.SRGBColorSpace;
    texOrganicMoss.wrapS = THREE.RepeatWrapping;
    texOrganicMoss.wrapT = THREE.RepeatWrapping;
    texOrganicMoss.minFilter = THREE.LinearMipmapLinearFilter;
    texOrganicMoss.magFilter = THREE.LinearFilter;
    texOrganicMoss.anisotropy = 8;

    const texMacroCrater = this.textureLoader.load('/assets/environment/floor_ref_macro_crater.png?v=2.0');
    texMacroCrater.colorSpace = THREE.SRGBColorSpace;
    texMacroCrater.wrapS = THREE.RepeatWrapping;
    texMacroCrater.wrapT = THREE.RepeatWrapping;
    texMacroCrater.minFilter = THREE.LinearMipmapLinearFilter;
    texMacroCrater.magFilter = THREE.LinearFilter;
    texMacroCrater.anisotropy = 8;

    const groundMat = new THREE.MeshLambertMaterial({
      color: 0xffffff,
      map: texThawedEarth
    });
    groundMat.customProgramCacheKey = () => 'proc_stage1_terrain_v2';

    groundMat.onBeforeCompile = (shader) => {
      shader.uniforms.uTexThawedEarth = { value: texThawedEarth };
      shader.uniforms.uTexRockyFissure = { value: texRockyFissure };
      shader.uniforms.uTexOrganicMoss = { value: texOrganicMoss };
      shader.uniforms.uTexMacroCrater = { value: texMacroCrater };
      shader.uniforms.uCrashSite = { value: new THREE.Vector2(1800, 2960) };
      shader.uniforms.uFreezeProgress = this.freezeUniforms.uFreezeProgress;
      shader.uniforms.uFreezeOriginXZ = this.freezeUniforms.uFreezeOriginXZ;
      shader.uniforms.uFreezeMaxRadius = this.freezeUniforms.uFreezeMaxRadius;

      shader.vertexShader =
        `
        varying vec3 vCustomWorldPos;
        varying vec3 vCustomWorldNorm;
      ` + shader.vertexShader;

      shader.vertexShader = shader.vertexShader.replace(
        '#include <worldpos_vertex>',
        `
        #include <worldpos_vertex>
        vCustomWorldPos = (modelMatrix * vec4(transformed, 1.0)).xyz;
        vCustomWorldNorm = normalize((modelMatrix * vec4(objectNormal, 0.0)).xyz);
        `
      );

      shader.fragmentShader =
        `
        uniform sampler2D uTexThawedEarth;
        uniform sampler2D uTexRockyFissure;
        uniform sampler2D uTexOrganicMoss;
        uniform sampler2D uTexMacroCrater;
        uniform vec2 uCrashSite;
        uniform float uFreezeProgress;
        uniform vec2 uFreezeOriginXZ;
        uniform float uFreezeMaxRadius;

        varying vec3 vCustomWorldPos;
        varying vec3 vCustomWorldNorm;

        float hash21(vec2 p) {
          p = fract(p * vec2(123.34, 456.21));
          p += dot(p, p + 45.32);
          return fract(p.x * p.y);
        }

        float vnoise(vec2 p) {
          vec2 i = floor(p);
          vec2 f = fract(p);
          f = f * f * (3.0 - 2.0 * f);
          float a = hash21(i);
          float b = hash21(i + vec2(1.0, 0.0));
          float c = hash21(i + vec2(0.0, 1.0));
          float d = hash21(i + vec2(1.0, 1.0));
          return mix(mix(a, b, f.x), mix(c, d, f.x), f.y);
        }

        float fbm(vec2 p) {
          float v = 0.0;
          float a = 0.5;
          mat2 rot = mat2(0.8, -0.6, 0.6, 0.8);
          for (int i = 0; i < 3; i++) {
            v += a * vnoise(p);
            p = rot * p * 2.02 + vec2(13.5, 7.8);
            a *= 0.5;
          }
          return v;
        }
      ` + shader.fragmentShader;

      shader.fragmentShader = shader.fragmentShader.replace(
        '#include <map_fragment>',
        `
        // 1. TRIPLANAR TEXTURE MAPPING & SLOPE BLENDING
        // Calculates projection weights to eliminate vertical stretching on steep cliffs and slopes
        vec3 absNorm = abs(vCustomWorldNorm);
        vec3 triWeights = pow(absNorm, vec3(4.5));
        triWeights /= (triWeights.x + triWeights.y + triWeights.z + 0.00001);

        // Multi-scale domain warp (eliminates repeating grid tiles and straight edges)
        vec2 warp1 = vec2(fbm(vCustomWorldPos.xz * 0.0016), fbm(vCustomWorldPos.xz * 0.0016 + vec2(19.3, 37.1))) * 140.0;
        vec2 warp2 = vec2(fbm(vCustomWorldPos.xz * 0.0055 + vec2(7.8, 12.3)), fbm(vCustomWorldPos.xz * 0.0055 + vec2(21.4, 9.7))) * 35.0;
        vec2 warpedTopXZ = vCustomWorldPos.xz + warp1 + warp2;

        // TOP (Y-AXIS) PROJECTION: Horizontal and gently rolling ground
        vec2 uvTopMicro = warpedTopXZ * 0.0030;
        mat2 rotMeso = mat2(0.7826, -0.6225, 0.6225, 0.7826);
        vec2 uvTopMeso = (rotMeso * warpedTopXZ) * 0.00118 + vec2(0.42, 0.68);
        vec2 uvMacro = warpedTopXZ * 0.00045;

        float blendS = smoothstep(0.35, 0.65, fbm(warpedTopXZ * 0.0028));

        // Top layer samples: Thawed earth peat & crimson mycelium
        vec3 topThawed1 = texture2D(uTexThawedEarth, uvTopMicro).rgb;
        vec3 topThawed2 = texture2D(uTexThawedEarth, uvTopMeso).rgb;
        vec3 topThawedCol = mix(topThawed1, topThawed2, blendS * 0.48);

        // Top layer samples: Frost web lace & olivine moss
        vec3 topMoss1 = texture2D(uTexOrganicMoss, uvTopMicro * 0.95).rgb;
        vec3 topMoss2 = texture2D(uTexOrganicMoss, uvTopMeso * 1.05).rgb;
        vec3 topMossCol = mix(topMoss1, topMoss2, blendS * 0.48);

        // Top layer samples: Macro continental variation
        vec3 topMacroCol = texture2D(uTexMacroCrater, uvMacro).rgb;

        // Natural frost lace hollow pooling on flat/gentle ground (slope < 0.26)
        float slope = 1.0 - absNorm.y;
        float frostPattern = smoothstep(0.42, 0.70, fbm(warpedTopXZ * 0.0032 + vec2(5.5, 9.1)));
        float slopeFrostAtten = smoothstep(0.30, 0.06, slope);
        vec3 topSurfaceCol = mix(topThawedCol, topMossCol, frostPattern * slopeFrostAtten * 0.80);

        // Continental color modulation
        float macroMask = smoothstep(0.30, 0.70, fbm(warpedTopXZ * 0.00075 + vec2(33.1, 14.8)));
        topSurfaceCol = mix(topSurfaceCol, topMacroCol, macroMask * 0.24);

        // SIDE (X & Z AXES) PROJECTIONS: Steep slopes & towering mountain cliffs
        // Projected along world Y so horizontal geological strata and crags stay crisp with NO vertical stretching
        vec2 uvSideX = vec2(vCustomWorldPos.z * 0.0020, vCustomWorldPos.y * 0.0032);
        vec2 uvSideZ = vec2(vCustomWorldPos.x * 0.0020, vCustomWorldPos.y * 0.0032);
        vec3 sideRockX = texture2D(uTexRockyFissure, uvSideX).rgb;
        vec3 sideRockZ = texture2D(uTexRockyFissure, uvSideZ).rgb;
        float sideWeightSum = triWeights.x + triWeights.z + 0.0001;
        vec3 cliffCol = (sideRockX * triWeights.x + sideRockZ * triWeights.z) / sideWeightSum;

        // Triplanar blend: Smoothly transition from rolling thawed turf into stratified rock faces
        vec3 groundCol = mix(cliffCol, topSurfaceCol, triWeights.y);

        // 2. SHIPWRECK IMPACT SCORCH ZONE around uCrashSite (1800, 2870)
        float distToShip = length(vCustomWorldPos.xz - uCrashSite);
        float scorchNoise = fbm(warpedTopXZ * 0.006 + vec2(11.3, 7.9)) * 55.0;
        float scorchMask = smoothstep(280.0, 45.0, distToShip + scorchNoise);

        if (scorchMask > 0.001) {
          // Heat vaporizes white frost, revealing charred, blackened, ash-burned earth
          float ashVariation = 0.8 + 0.4 * fbm(warpedTopXZ * 0.022);
          vec3 charredSoil = vec3(0.070, 0.060, 0.065) * ashVariation;
          groundCol = mix(groundCol, charredSoil, scorchMask * 0.88);

          // Impact thermal fissures & glowing embers
          float fissureMask = smoothstep(0.66, 0.90, fbm(warpedTopXZ * 0.026 + vec2(4.2, 8.6)));
          vec3 emberGlow = vec3(1.15, 0.42, 0.08) * 2.2;
          groundCol += emberGlow * (fissureMask * scorchMask * 0.85);

          // Gouged skid trench ruts leading into the breach
          float skidX = 1.0 - smoothstep(12.0, 75.0, abs(vCustomWorldPos.x - 1800.0));
          float skidZ = smoothstep(2720.0, 2920.0, vCustomWorldPos.z) * (1.0 - smoothstep(3100.0, 3280.0, vCustomWorldPos.z));
          groundCol = mix(groundCol, vec3(0.035, 0.030, 0.030), skidX * skidZ * 0.70);
        }

        float pFreezeDist = length(vCustomWorldPos.xz - uFreezeOriginXZ);
        float pFreezeFront = uFreezeProgress * uFreezeMaxRadius * 1.15;
        float pFreezeNoise = fbm(vCustomWorldPos.xz * 0.008) * 260.0;
        float pFreezeWave = clamp(1.0 - smoothstep(pFreezeFront - 360.0, pFreezeFront + 120.0, pFreezeDist + pFreezeNoise), 0.0, 1.0);
        float pFreezeActive = smoothstep(0.0, 0.04, uFreezeProgress) * pFreezeWave;
        float pFreezeBand = exp(-pow((pFreezeDist + pFreezeNoise - pFreezeFront) / 145.0, 2.0)) * smoothstep(0.0, 0.08, uFreezeProgress) * (1.0 - smoothstep(0.88, 1.0, uFreezeProgress));
        vec3 pFrostTint = mix(vec3(0.68, 0.84, 0.96), vec3(0.84, 0.93, 1.0), clamp(vCustomWorldNorm.y, 0.0, 1.0));
        groundCol = mix(groundCol, pFrostTint, pFreezeActive * 0.60);
        groundCol = mix(groundCol, vec3(0.64, 0.88, 1.0), pFreezeBand * 0.34);

        diffuseColor.rgb = groundCol;
        `
      );
    };

    const groundMesh = new THREE.Mesh(groundGeo, groundMat);
    groundMesh.rotation.x = -Math.PI / 2;
    groundMesh.position.set(halfW, 0, halfH);
    this.stage1Group.add(groundMesh);
    this.terrainMeshes.push(groundMesh);

    // 3. Substantial 3D Layered Crashed Spaceship Landmark (Stage 1 Crash Site)
    this.createCrashedSpaceship(terrain);

    // 4. Clean Stylized Valley River Ribbon (Nested inside western gorge)
    this.createValleyRiver(terrain);
  }

  private createCrashedSpaceship(terrain: TerrainSystem): void {
    const shipGroup = new THREE.Group();
    const shipX = 1800;
    const shipY = 2960;
    const groundElev = terrain.getElevation(shipX, shipY).height;
    this.shipPos.set(shipX, groundElev, shipY);

    // Position fixed at crash site furrow
    shipGroup.position.set(shipX, groundElev, shipY);
    shipGroup.rotation.set(0, 0, 0);

    // 1. Soft Ambient Occlusion Contact Shadow on Furrow Floor
    const shadowTex = this.textureLoader.load('/assets/shadow.png');
    const shadowGeo = new THREE.PlaneGeometry(520, 340);
    const shadowMat = new THREE.MeshBasicMaterial({
      map: shadowTex,
      transparent: true,
      opacity: 0.85,
      depthWrite: false
    });
    const groundShadow = new THREE.Mesh(shadowGeo, shadowMat);
    groundShadow.rotation.x = -Math.PI / 2;
    groundShadow.position.set(0, 0.3, 0);
    shipGroup.add(groundShadow);

    // 2. Load the Authentic High-Res Crashed Colony Vessel Texture
    const shipTex = this.textureLoader.load('/assets/environment/Crashed Colony Ship Wreck with Cyan Interior Glow.png?v=3.2');
    shipTex.colorSpace = THREE.SRGBColorSpace;
    shipTex.minFilter = THREE.LinearMipmapLinearFilter;
    shipTex.magFilter = THREE.LinearFilter;

    const shipWidth = 420;
    const shipHeight = 315;

    // Upright 2.5D billboarded crashed colony vessel mesh (rotates horizontally on Y axis to always face camera)
    const shipHullGeo = new THREE.PlaneGeometry(shipWidth, shipHeight);
    const shipHullMat = new THREE.MeshStandardMaterial({
      map: shipTex,
      transparent: true,
      alphaTest: 0.15,
      side: THREE.DoubleSide,
      roughness: 0.45,
      metalness: 0.65,
      depthWrite: true
    });
    this.shipHull = new THREE.Mesh(shipHullGeo, shipHullMat);
    // Ground the base of the hull solidly into the terrain furrow without clipping away the entrance opening
    this.shipHull.position.set(0, shipHeight * 0.44, 0);
    this.shipHull.rotation.set(0, Math.PI, 0); // Initially facing south toward default camera
    shipGroup.add(this.shipHull);

    // 3. Dynamic Volumetric Reactor Core and Interior Deck Lighting
    // Attached to shipHull so lighting dynamically rotates with the opening
    const cyanCoreLight = new THREE.PointLight(0x00f0ff, 4.5, 420);
    cyanCoreLight.position.set(-15, -shipHeight * 0.44 + 65, 15);
    this.shipHull.add(cyanCoreLight);

    const interiorAmberLight = new THREE.PointLight(0xff9922, 3.0, 300);
    interiorAmberLight.position.set(45, -shipHeight * 0.44 + 50, -10);
    this.shipHull.add(interiorAmberLight);

    const exteriorGroundGlow = new THREE.PointLight(0x38bdf8, 2.5, 220);
    exteriorGroundGlow.position.set(0, 10, 50);
    shipGroup.add(exteriorGroundGlow);

    this.stage1Group.add(shipGroup);
  }

  private createValleyRiver(terrain: TerrainSystem): void {
    // Confine water strictly to the low southwestern crater basin (never climbing hills or plateaus)
    const lengthSegs = 64;
    const widthSegs = 16;
    const riverWidth = 140;
    const riverLength = 1000;
    const riverGeo = new THREE.PlaneGeometry(riverWidth, riverLength, widthSegs, lengthSegs);
    const pos = riverGeo.attributes.position;
    const depthAttr = new Float32Array(pos.count);

    const waterLevel = 5.2; // True hydrostatic basin level

    for (let i = 0; i < pos.count; i++) {
      const lx = pos.getX(i);
      const ly = pos.getY(i);
      // Basin coordinates: spans lower valley basin from wy 2100 to 3100
      const wy = 2600 - (ly / (riverLength / 2)) * 500;
      const streamCenterX = 1300 + Math.sin(wy * 0.0035) * 80 + Math.cos(wy * 0.0018) * 40;
      const wx = streamCenterX + lx;
      const groundH = terrain.calculateHeight(wx, wy);

      // Water height stays flat at waterLevel, but smoothly dips down to meet ground if ground rises above waterLevel
      const submerged = Math.max(0.0, waterLevel - groundH);
      const waterH = Math.min(waterLevel, groundH + 0.1);
      pos.setXYZ(i, wx, groundH < waterLevel ? waterLevel : waterH, wy);
      depthAttr[i] = submerged;
    }

    riverGeo.setAttribute('aDepth', new THREE.BufferAttribute(depthAttr, 1));
    riverGeo.computeVertexNormals();

    // Animated water shader with directional flow, shallow-to-deep depth gradient, and specular ripples
    const riverMat = new THREE.ShaderMaterial({
      uniforms: {
        uTime: this.riverUniforms.uTime,
        uFreezeProgress: this.freezeUniforms.uFreezeProgress,
        uFreezeOriginXZ: this.freezeUniforms.uFreezeOriginXZ,
        uFreezeMaxRadius: this.freezeUniforms.uFreezeMaxRadius
      },
      vertexShader: `
        attribute float aDepth;
        varying vec2 vUv;
        varying vec3 vWorldPos;
        varying vec3 vNormal;
        varying float vDepth;

        void main() {
          vUv = uv;
          vDepth = aDepth;
          vNormal = normalize(normalMatrix * normal);
          vec4 worldPos = modelMatrix * vec4(position, 1.0);
          vWorldPos = worldPos.xyz;
          gl_Position = projectionMatrix * viewMatrix * worldPos;
        }
      `,
      fragmentShader: `
        uniform float uTime;
        uniform float uFreezeProgress;
        uniform vec2 uFreezeOriginXZ;
        uniform float uFreezeMaxRadius;
        varying vec2 vUv;
        varying vec3 vWorldPos;
        varying vec3 vNormal;
        varying float vDepth;

        float hash(vec2 p) {
          return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453);
        }

        float noise(vec2 p) {
          vec2 i = floor(p);
          vec2 f = fract(p);
          f = f * f * (3.0 - 2.0 * f);
          return mix(mix(hash(i), hash(i + vec2(1.0, 0.0)), f.x),
                     mix(hash(i + vec2(0.0, 1.0)), hash(i + vec2(1.0, 1.0)), f.x), f.y);
        }

        void main() {
          // If completely above the natural water table, discard
          if (vDepth <= 0.05) discard;

          // Downstream directional flow along the river UV
          vec2 flowUv1 = vec2(vUv.x * 2.5, vUv.y * 8.0 - uTime * 0.55);
          vec2 flowUv2 = vec2(vUv.x * 4.0 + 1.3, vUv.y * 11.0 - uTime * 0.75);

          float n1 = noise(flowUv1);
          float n2 = noise(flowUv2);
          float wave = (n1 + n2) * 0.5;

          // Cold glacial water depth gradient based on real depth above terrain
          float depthFactor = clamp(vDepth / 3.5, 0.0, 1.0);
          vec3 deepGlacialBlue = vec3(0.06, 0.20, 0.42);
          vec3 shallowCyanWater = vec3(0.24, 0.68, 0.88);
          vec3 coldWaterCol = mix(shallowCyanWater, deepGlacialBlue, depthFactor * 0.85);

          // Shoreline foam fringe where depth is shallow (< 0.6 units)
          float shorelineFoam = smoothstep(0.65, 0.08, vDepth) * (0.6 + 0.4 * n1);
          vec3 foamColor = vec3(0.92, 0.98, 1.0);
          vec3 finalColor = mix(coldWaterCol, foamColor, shorelineFoam * 0.70);

          // Specular wave glint
          float specular = pow(max(0.0, wave * 1.25), 4.0) * 0.35;
          finalColor += vec3(specular);

          // Cosmetic radial regional refreezing wave after Stage 1 Boss containment
          float rFreezeDist = length(vWorldPos.xz - uFreezeOriginXZ);
          float rFreezeFront = uFreezeProgress * uFreezeMaxRadius * 1.15;
          float rFreezeJitter = (n1 - 0.5) * 200.0;
          float rFreezeWave = clamp(1.0 - smoothstep(rFreezeFront - 340.0, rFreezeFront + 110.0, rFreezeDist + rFreezeJitter), 0.0, 1.0);
          float rFreezeActive = smoothstep(0.0, 0.04, uFreezeProgress) * rFreezeWave;
          float rFreezeBand = exp(-pow((rFreezeDist + rFreezeJitter - rFreezeFront) / 140.0, 2.0)) * smoothstep(0.0, 0.08, uFreezeProgress) * (1.0 - smoothstep(0.88, 1.0, uFreezeProgress));
          vec3 iceSurfaceCol = mix(vec3(0.46, 0.72, 0.88), vec3(0.82, 0.94, 1.0), 0.35 + 0.45 * n2);
          finalColor = mix(finalColor, iceSurfaceCol, rFreezeActive * 0.84) + vec3(0.24, 0.46, 0.62) * rFreezeBand;

          // Alpha fade smoothly at shorelines
          float alpha = clamp(mix(vDepth / 0.45, 0.94, rFreezeActive * 0.65), 0.0, 0.94);
          gl_FragColor = vec4(finalColor, alpha);
        }
      `,
      transparent: true,
      depthWrite: false,
      side: THREE.DoubleSide
    });

    this.riverMesh = new THREE.Mesh(riverGeo, riverMat);
    this.stage1Group.add(this.riverMesh);
  }
}

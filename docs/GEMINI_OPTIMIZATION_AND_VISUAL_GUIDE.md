# ENDO NINE — Performance & Visual Polish Implementation Guide (For Gemini)

> **INSTRUCTIONS FOR GEMINI:**
> Execute the 5 steps below **in exact order**.
> - Do **NOT** modify `src/sim/` (do not touch `TerrainSystem.ts`, `NavGrid.ts`, `Simulation.ts`, `HeroDefs.ts`, or `SkillDefs.ts`). All gameplay, elevation math, pathfinding, and the playable Doctor/Commander heroes are already working and tested.
> - Only modify [`src/render/ThreeTerrain.ts`](../src/render/ThreeTerrain.ts) and [`src/render/ThreeApp.ts`](../src/render/ThreeApp.ts).
> - Observe [`docs/LORE_CANON.md`](./LORE_CANON.md): Loop Stage 1 is a living, vibrant alien ecosystem (*Titanic Plains* / *Risk of Rain 2* aesthetic).

---

## STEP 1: Overhaul `src/render/ThreeTerrain.ts` (Smooth RoR2 Gradient Terrain + Zero Texture Splatting + Instanced Props)

### Why:
Currently `ThreeTerrain.ts` loads 5 noisy 750KB textures (`alien_grass.png`, `rocky_cliff_face.png`, `organic_dark_mud.png`, `permafrost_soil.png`, `rock_texture.png`), runs 5 `texture2D` lookups per pixel in a custom shader, and creates ~185 separate unbatched meshes in loops for mushrooms, crystals, and boulders.

### Action:
Replace the contents of [`src/render/ThreeTerrain.ts`](../src/render/ThreeTerrain.ts) with the following clean, *Risk of Rain 2*-inspired procedural color-gradient terrain and `InstancedMesh` prop implementation:

```typescript
import * as THREE from 'three';
import { TerrainSystem } from '../sim/TerrainSystem';

export class ThreeTerrain {
  public group: THREE.Group;
  public terrainMeshes: THREE.Object3D[] = [];
  private grassMesh: THREE.InstancedMesh | null = null;
  private riverMesh: THREE.Mesh | null = null;

  constructor(terrain: TerrainSystem, _textureLoader?: THREE.TextureLoader) {
    this.group = new THREE.Group();
    this.buildTerrain(terrain);
  }

  private buildTerrain(terrain: TerrainSystem): void {
    // 1. Multi-Level Heightfield Mesh (3600x3600, 90x90 segments = 8,100 vertices)
    const segs = 90;
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

    // 2. Risk of Rain 2 Smooth Stylized Gradient Terrain Shader (Zero noisy texture lookups!)
    // - Flat walkable plateaus: smooth painterly sage/emerald-teal turf with subtle macro-variation
    // - Steep cliff walls (driven by surface normal): cool slate-indigo stone
    // - Riverbanks & lower valley paths: warm sandy loam transition
    const groundMat = new THREE.MeshLambertMaterial({
      color: 0xffffff
    });

    groundMat.onBeforeCompile = (shader) => {
      shader.vertexShader = `
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

      shader.fragmentShader = `
        varying vec3 vCustomWorldPos;
        varying vec3 vCustomWorldNorm;
      ` + shader.fragmentShader;

      shader.fragmentShader = shader.fragmentShader.replace(
        '#include <map_fragment>',
        `
        float slope = 1.0 - abs(vCustomWorldNorm.y);
        float h = vCustomWorldPos.y;

        // Smooth macro organic wave (no high-frequency noise!)
        float macroWave = sin(vCustomWorldPos.x * 0.0045) * cos(vCustomWorldPos.z * 0.0045) * 0.5 + 0.5;

        // RoR2 Titanic Plains Color Palette:
        vec3 valleyGrass  = vec3(0.24, 0.55, 0.34); // Lush valley emerald-sage
        vec3 plateauGrass = vec3(0.32, 0.62, 0.36); // Sunlit highland olive-green
        vec3 summitTurf   = vec3(0.28, 0.52, 0.44); // Cool alpine teal-sage
        vec3 riverBank    = vec3(0.38, 0.44, 0.36); // Smooth mossy riverbank stone
        vec3 cliffSlate   = vec3(0.22, 0.30, 0.42); // Cool RoR2 blue-slate cliff face
        vec3 deepCliff    = vec3(0.16, 0.22, 0.33); // Shaded lower cliff strata

        // 1. Flat surface color by elevation
        vec3 flatCol = mix(valleyGrass, plateauGrass, macroWave * 0.65);
        if (h < 18.0) {
          float t = clamp(h / 18.0, 0.0, 1.0);
          flatCol = mix(riverBank, flatCol, t);
        } else if (h > 340.0) {
          float t = clamp((h - 340.0) / 220.0, 0.0, 1.0);
          flatCol = mix(flatCol, summitTurf, t);
        }

        // 2. Cliff face color by normal slope
        vec3 rockCol = mix(deepCliff, cliffSlate, clamp(h / 450.0, 0.0, 1.0));
        // Subtle horizontal rock strata bands on vertical cliffs
        float strata = sin(h * 0.08 + vCustomWorldPos.x * 0.005) * 0.025;
        rockCol += vec3(strata);

        float rockFactor = smoothstep(0.22, 0.42, slope);
        vec3 finalSurface = mix(flatCol, rockCol, rockFactor);

        diffuseColor.rgb = finalSurface;
        `
      );
    };

    const groundMesh = new THREE.Mesh(groundGeo, groundMat);
    groundMesh.rotation.x = -Math.PI / 2;
    groundMesh.position.set(halfW, 0, halfH);
    this.group.add(groundMesh);
    this.terrainMeshes.push(groundMesh);

    // 3. Clean Stylized Valley River Ribbon
    this.createValleyRiver(terrain);

    // 4. Instanced Alien Grass Blades (1 draw call)
    this.createGrassField(terrain);

    // 5. Instanced Stylized Low-Poly Cliff Boulders (1 draw call)
    this.createOrganicBoulders(terrain);
  }

  private createValleyRiver(terrain: TerrainSystem): void {
    const lengthSegs = 64;
    const riverWidth = 115;
    const riverLength = 2500;
    const riverGeo = new THREE.PlaneGeometry(riverWidth, riverLength, 6, lengthSegs);
    const pos = riverGeo.attributes.position;

    for (let i = 0; i < pos.count; i++) {
      const lx = pos.getX(i);
      const ly = pos.getY(i);
      const wy = 1950 - (ly / (riverLength / 2)) * 1200;
      const riverCenterX =
        1620 +
        Math.sin((wy - 1800) * 0.0022) * 260 +
        Math.cos((wy - 1200) * 0.0014) * 120;
      const wx = riverCenterX + lx;
      const groundH = terrain.calculateHeight(wx, wy);
      const waterH = Math.max(2.2, groundH + 1.4);
      pos.setXYZ(i, wx, waterH, wy);
    }

    riverGeo.computeVertexNormals();

    const riverMat = new THREE.MeshLambertMaterial({
      color: 0x38bdf8,
      emissive: 0x0c4a6e,
      emissiveIntensity: 0.35,
      transparent: true,
      opacity: 0.78,
      side: THREE.DoubleSide
    });

    this.riverMesh = new THREE.Mesh(riverGeo, riverMat);
    this.group.add(this.riverMesh);
  }

  private createGrassField(terrain: TerrainSystem): void {
    const grassCount = 900;
    const p1 = new THREE.PlaneGeometry(14, 18);
    const p2 = new THREE.PlaneGeometry(14, 18);
    p2.rotateY(Math.PI / 2);

    const geo = new THREE.BufferGeometry();
    const pos1 = p1.attributes.position.array;
    const pos2 = p2.attributes.position.array;
    const combinedPos = new Float32Array(pos1.length + pos2.length);
    combinedPos.set(pos1, 0);
    combinedPos.set(pos2, pos1.length);
    geo.setAttribute('position', new THREE.BufferAttribute(combinedPos, 3));
    geo.computeVertexNormals();

    const grassMat = new THREE.MeshLambertMaterial({
      color: 0x4ca65a,
      side: THREE.DoubleSide
    });

    this.grassMesh = new THREE.InstancedMesh(geo, grassMat, grassCount);
    const dummy = new THREE.Object3D();
    let placed = 0;
    let attempts = 0;

    while (placed < grassCount && attempts < grassCount * 3) {
      attempts++;
      const gx = 300 + Math.random() * (terrain.worldWidth - 600);
      const gz = 300 + Math.random() * (terrain.worldHeight - 600);
      const elev = terrain.getElevation(gx, gz);
      if (!elev.isWalkable || elev.height > 620 || elev.height < 8) continue;

      const hE = terrain.calculateHeight(gx + 10, gz);
      const hW = terrain.calculateHeight(gx - 10, gz);
      const hS = terrain.calculateHeight(gx, gz + 10);
      const hN = terrain.calculateHeight(gx, gz - 10);
      const slope = Math.hypot((hE - hW) / 20, (hS - hN) / 20);
      if (slope > 0.3) continue;

      dummy.position.set(gx, elev.height + 8, gz);
      dummy.rotation.set(0, Math.random() * Math.PI, 0);
      const s = 0.8 + Math.random() * 0.6;
      dummy.scale.set(s, s, s);
      dummy.updateMatrix();
      this.grassMesh.setMatrixAt(placed, dummy.matrix);
      placed++;
    }

    this.grassMesh.count = placed;
    this.grassMesh.instanceMatrix.needsUpdate = true;
    this.group.add(this.grassMesh);
  }

  private createOrganicBoulders(terrain: TerrainSystem): void {
    const centers = [
      { x: 1950, cy: 2450 },
      { x: 2450, cy: 1900 },
      { x: 2300, cy: 1550 },
      { x: 1550, cy: 1100 },
      { x: 1450, cy: 2500 },
      { x: 2100, cy: 1800 },
      { x: 2200, cy: 2200 },
      { x: 1500, cy: 1400 },
      { x: 1850, cy: 1100 }
    ];

    const totalBoulders = centers.length * 4;
    const geo = new THREE.DodecahedronGeometry(16, 0);
    // Clean slate-blue rock matching the terrain cliff shader (no noisy bump map!)
    const boulderMat = new THREE.MeshLambertMaterial({
      color: 0x384b66,
      flatShading: true
    });

    const instancedBoulders = new THREE.InstancedMesh(geo, boulderMat, totalBoulders);
    const dummy = new THREE.Object3D();
    let idx = 0;

    for (const c of centers) {
      for (let k = 0; k < 4; k++) {
        const ox = (Math.random() - 0.5) * 140;
        const oy = (Math.random() - 0.5) * 140;
        const wx = c.x + ox;
        const wy = c.cy + oy;
        const elev = terrain.getElevation(wx, wy).height;
        const s = 0.8 + Math.random() * 0.9;

        dummy.position.set(wx, elev + 10 * s, wy);
        dummy.rotation.set(Math.random() * Math.PI, Math.random() * Math.PI, Math.random() * Math.PI);
        dummy.scale.set(s * 1.2, s * 0.85, s * 1.1);
        dummy.updateMatrix();
        instancedBoulders.setMatrixAt(idx++, dummy.matrix);
      }
    }

    instancedBoulders.count = idx;
    instancedBoulders.instanceMatrix.needsUpdate = true;
    this.group.add(instancedBoulders);
  }

  public update(_time: number): void {
    // Static instanced environment requires zero CPU-to-GPU buffer uploads per frame!
  }
}
```

---

## STEP 2: Fix `updateMouseRaycast` in `src/render/ThreeApp.ts` (Eliminate 16,200-Triangle Raycast Lag)

### Why:
In [`src/render/ThreeApp.ts`](../src/render/ThreeApp.ts#L455-L487), `this.raycaster.intersectObjects(this.terrain.terrainMeshes, true)` tests 16,200 triangles in JS on every mousemove and every frame.

### Action:
Replace `updateMouseRaycast` (around lines 455–487 of `src/render/ThreeApp.ts`) with fast analytical heightfield ray-marching:

```typescript
  private updateMouseRaycast(screenX: number, screenY: number): void {
    const ndcX = (screenX / window.innerWidth) * 2 - 1;
    const ndcY = -(screenY / window.innerHeight) * 2 + 1;

    this.raycaster.setFromCamera(new THREE.Vector2(ndcX, ndcY), this.camera);
    const origin = this.raycaster.ray.origin;
    const dir = this.raycaster.ray.direction;
    const terrain = this.simulation.state.terrain;

    // Fast analytical ray-march against mathematical heightfield (0 triangle checks!)
    if (dir.y < -0.01) {
      const maxDist = 2200;
      const steps = 24;
      const stepSize = maxDist / steps;
      let prevT = 0;

      for (let i = 1; i <= steps; i++) {
        const t = i * stepSize;
        const rx = origin.x + dir.x * t;
        const ry = origin.y + dir.y * t;
        const rz = origin.z + dir.z * t;
        const h = terrain.calculateHeight(rx, rz);

        if (ry <= h) {
          // One binary-refinement midpoint step for sub-unit accuracy
          const midT = (prevT + t) * 0.5;
          const hitX = origin.x + dir.x * midT;
          const hitZ = origin.z + dir.z * midT;
          const hitY = terrain.calculateHeight(hitX, hitZ);

          this.inputManager.mouseWorldPos.x = hitX;
          this.inputManager.mouseWorldPos.y = hitZ;
          this.inputManager.mouseWorldPos3D = { x: hitX, y: hitZ, z: hitY };
          return;
        }
        prevT = t;
      }
    }

    // Fallback to plane at player's current vertical elevation
    const pZ = this.simulation.state.player.z + 26;
    const elevationPlane = new THREE.Plane(new THREE.Vector3(0, 1, 0), -pZ);
    const point = new THREE.Vector3();
    this.raycaster.ray.intersectPlane(elevationPlane, point);

    if (point) {
      this.inputManager.mouseWorldPos.x = point.x;
      this.inputManager.mouseWorldPos.y = point.z;
      this.inputManager.mouseWorldPos3D = {
        x: point.x,
        y: point.z,
        z: point.y
      };
    }
  }
```

---

## STEP 3: Disable Dynamic Shadow Map Recalculation & Extra PointLights in `src/render/ThreeApp.ts`

### Why:
The game already uses ground shadow decals (`shadow.png`) under every sprite, pod, and obstacle. Rendering a moving $2048 \times 2048$ `PCFSoftShadowMap` plus 5+ dynamic `PointLight`s halves the framerate and adds muddy shadow artifacts.

### Action in `src/render/ThreeApp.ts`:
1. In the constructor (around lines 135–176):
   - Set `this.renderer.shadowMap.enabled = false;`
   - Set `this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 1.5));`
   - Set `this.scene.background = new THREE.Color(0x8ec5e8);`
   - Set `this.scene.fog = new THREE.FogExp2(0x8ec5e8, 0.00028);` (slightly richer atmospheric aerial perspective so distant cliffs blend softly into the sky like RoR2).
   - On `this.sunLight`, set `this.sunLight.castShadow = false;` and remove the `this.sunLight.shadow.*` lines.
2. In `renderLoop` (around lines 1413–1468):
   - Remove the duplicate `this.terrain.update(now);` at line 1413.
   - Remove the per-frame CPU buffer loop on `this.sporePoints` (`posAttr.needsUpdate = true` at lines 1420–1427) and instead simply gently rotate/bob the `sporePoints` object itself:
     ```typescript
     if (this.sporePoints) {
       this.sporePoints.position.y = Math.sin(now * 0.0012) * 6;
     }
     ```
   - Remove lines 1465–1467 (`this.sunLight.position.set(...)` and `this.sunLight.target...`). A directional light in Three.js without shadow maps has infinite parallel rays—moving it every frame does nothing except dirty scene matrices!
3. Remove the unnecessary `THREE.PointLight` instances:
   - In constructor (around line 213): do not add `this.heroLight` to `this.playerGroup`.
   - In `createArtifact()` (around lines 778–781): remove the `new THREE.PointLight(...)` from the artifact group.
   - In `createWorldEvents()` (around lines 990, 1071, 1161): remove the 3 `new THREE.PointLight(...)` instances from the world events.

---

## STEP 4: Clean Up Skybox & Skybeam Clutter in `src/render/ThreeApp.ts` (RoR2 Horizon Aesthetic)

### Why:
Look at the *Risk of Rain 2* reference screenshot:
- There is **no** cylinder panorama texture (`alien_horizon_panorama.png`) and **no** circle of 36 cone mountains (`mCount = 36`).
- Instead, there are iconic **giant flat-shaded stone arches** (`TorusGeometry`) and clean distant silhouettes fading into the sky fog, with **one** primary objective beam.

### Action in `src/render/ThreeApp.ts`:
1. In `createSkyElements()` (lines 489–681):
   - **Remove** section `0. Panoramic 360-degree Alien Vista Skybox Cylinder` (`this.horizonMesh` and `/assets/alien_horizon_panorama.png`).
   - **Remove** section `2. Distant 3D Alien Mountain Range encircling the entire horizon` (the `for (let i = 0; i < 36; i++)` cone loop at lines 621–644).
   - **Update** `stoneArchMat` (lines 528–539) on the 3 Colossal Stone Arches (`northArch`, `eastArch`, `ridgeArch`) so it does **not** use the noisy `rock_texture.png` bump map. Instead, give it a clean, flat-shaded slate-blue material that harmonizes with the terrain cliffs and atmospheric fog:
     ```typescript
     const stoneArchMat = new THREE.MeshLambertMaterial({
       color: 0x3b506b,
       flatShading: true
     });
     ```
2. Tone down the secondary skybeams so only the main Stage Objective (`Artifact`) reaches the clouds:
   - In `createPods()` (line 828): reduce the loot pod beacon height from `340` to `90` (`new THREE.CylinderGeometry(1.0, 2.5, 90, 12, 1, true)` at `elevation + 45`, opacity `0.35`).
   - In `createWorldEvents()` (lines 954, 1047, 1137): reduce the 3 secondary World Event beams from height `2200` (`position.y = 1100`) to a clean low-profile column of height `180` (`position.y = 90`, opacity `0.35`). That way the Golden Artifact Teleporter Beam is the unmistakable primary landmark on the skyline, just like the Red Teleporter Beam in *Risk of Rain 2*.
3. In `createObstacles()` (lines 1241–1248):
   - Replace `rockMat` (which uses `rock_texture` + `bumpMap`) with a clean flat-shaded `THREE.MeshLambertMaterial({ color: 0x384b66, flatShading: true })` so 3D rocks match the stylized terrain.

---

## STEP 5: Verification Checklist

After applying Steps 1–4, run:
1. `npm run build` — verify zero TypeScript or Vite bundle errors.
2. `npx tsx scratch/verify_doctor.ts` — verify all 43 gameplay/character assertions still pass.
3. Reload `http://localhost:5173/` and confirm:
   - Smooth 60 FPS with instant mouse aiming.
   - Clean, painterly *Risk of Rain 2* green plateaus and slate-blue cliffs fading into soft sky fog.
   - Zero noisy bump-map grain or cone-ring clutter on the horizon.


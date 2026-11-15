# ENDO NINE — Loop Stage 1 Ground Texture Creation & Integration Guide (For Gemini 3.8)

> **INSTRUCTIONS FOR GEMINI 3.8:**
> Execute **Steps 1 through 4** below **in exact order**.
> - **Strict Scope:** This task is strictly about creating `public/assets/alien_thawed_ground.png` (`1024 × 1024`, seamless sRGB PNG) and integrating it into [`src/render/ThreeTerrain.ts`](../src/render/ThreeTerrain.ts).
> - **Do NOT modify:** Grass or foliage meshes, rocks or crystals, river geometry or water shaders, alien structures, sky and lighting, character animations, combat mechanics, enemy AI, terrain elevations, or UI/gameplay systems.
> - **Do NOT fake the texture:** Do not use a flat procedural color or placeholder noise texture. Generate the actual `1024 × 1024` painterly top-down albedo texture using the `image-generator` subagent in Step 1, make it 100% seamlessly tileable on all 4 edges in Step 2, integrate it into `ThreeTerrain.ts` in Step 3, and verify with a live in-game screenshot in Step 4.

---

## STEP 1: Generate the Raw Top-Down Ground Texture via `image-generator`

### Visual Analysis of the Reference Image
The reference image (`media_1794081686360_501cdf91.jpg`) depicts **Loop Stage 1**: an ancient alien valley that has recently begun thawing after a long freeze. The ground surface beneath Commander consists of:
1. **Cold, desaturated gray-green & olive-sage soil** (`#5A6B58`, `#6E7B64`, `#4B5849`) forming the primary thawed surface.
2. **Muted blue-gray frozen earth & permafrost mineral patches** (`#5C6D7E`, `#4A5868`, `#738596`) showing through the soil.
3. **Patches of damp, thawed dark soil & loam** (`#363D38`, `#2B302C`, `#434A42`) in shallow depressions.
4. **Sparse, low-growing moss-like alien biological mat** (subtle olive-moss and muted lichen textures hugging the soil, NOT tall grass blades or 3D bushes).
5. **Subtle remaining frost and thin snow/ice crust deposits** (`#C8D8E4`, `#9FB4C7`) scattered in delicate, irregular patches along soil crevices.
6. **Fine surface cracks, granular pebbles, and irregular mineral veins**.
7. **Occasional muted violet-blue biological pigmentation** (`#6B5E82`, `#584D70`) subtly infused into the organic soil.

### Action:
Invoke the `image-generator` subagent (`TypeName: "image-generator"`) to generate the base `1024 × 1024` top-down texture and save it to `public/assets/alien_thawed_ground_raw.png` (or copy the generated file there).

Use the following prompt for `image-generator`:
```text
Create a 1024x1024 seamless, tileable, strictly top-down (90-degree orthographic overhead) game terrain albedo texture of a freshly thawing alien planet ground surface for a stylized 2.5D sci-fi action game.

Surface composition and color palette:
- Primary base: cold, desaturated gray-green and muted olive-sage soil (#5A6B58, #6C7A62) blended organically with damp thawed dark earth (#383F3A).
- Secondary zones: muted blue-gray frozen permafrost earth and slate mineral soil (#5B6C7D, #495766).
- Biological detail: sparse, flat, low-growing alien moss and lichen mats with occasional subtle, muted violet-blue biological pigmentation (#6A5D80) integrated naturally into the soil.
- Thaw detail: subtle remaining white-blue frost crystals and thin, delicate melting snow/ice crust deposits (#C5D6E2, #9BB0C4) clinging to shallow soil crevices.
- Micro detail: fine irregular frost cracks, granular soil grit, tiny embedded mineral pebbles, and natural organic soil transitions.

Strict technical constraints:
- Strictly 90-degree top-down flat surface albedo texture.
- Even, neutral diffuse lighting with NO directional sunlight, NO cast shadows, and NO vignette.
- Seamless tiling pattern across all edges with uniform feature density (no single large focal object in the center).
- NO 3D protruding plants, NO tall grass blades, NO mushrooms, NO large boulders, NO water puddles, NO text, and NO UI.
- Stylized painterly hand-crafted game art quality (similar to Risk of Rain 2 / Hades environment floor textures), subtle enough to preserve high combat readability.
```

---

## STEP 2: Guarantee 100% Seamless 4-Edge Tiling (`scripts/build-alien-thawed-ground.cjs`)

AI-generated textures can have subtle pixel discontinuities along the outer `x = 0 / 1023` and `y = 0 / 1023` borders when repeated across a large 3D terrain mesh.

### Action:
Create and run `scripts/build-alien-thawed-ground.cjs` using `sharp`. This script:
1. Reads the generated texture from Step 1.
2. Resizes it to `1024 × 1024` RGBA/RGB sRGB if needed.
3. Applies a **toroidal raised-cosine cross-blend pass** along the horizontal and vertical wrap seams so the left edge matches the right edge and the top edge matches the bottom edge with **zero mathematical seam discontinuity**, while preserving 100% of the crisp interior detail.
4. Normalizes local luminance extremes (preventing harsh white glare or pitch-black spots that would hurt combat readability).
5. Saves the final game-ready texture to `public/assets/alien_thawed_ground.png` (`1024 × 1024`, PNG, sRGB).
6. Generates a `2 × 2` tiled contact sheet (`scratch/alien_thawed_ground_2x2_check.png`) so you can visually confirm zero visible grid lines or square boundaries.

Write the following script to [`scripts/build-alien-thawed-ground.cjs`](../scripts/build-alien-thawed-ground.cjs) and run it with `node scripts/build-alien-thawed-ground.cjs`:

```javascript
const sharp = require('sharp');
const path = require('path');
const fs = require('fs');

const SIZE = 1024;
const BLEND_BAND = 160; // Width of raised-cosine toroidal seam blend band

async function main() {
  const inputPath = process.argv[2] || path.join(__dirname, '../public/assets/alien_thawed_ground_raw.png');
  const outputPath = path.join(__dirname, '../public/assets/alien_thawed_ground.png');
  const tiledCheckPath = path.join(__dirname, '../scratch/alien_thawed_ground_2x2_check.png');

  if (!fs.existsSync(inputPath)) {
    throw new Error(`Input raw texture not found at: ${inputPath}`);
  }

  const { data: src } = await sharp(inputPath)
    .resize(SIZE, SIZE, { fit: 'cover', kernel: sharp.kernel.lanczos3 })
    .toColorspace('srgb')
    .removeAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true });

  // Toroidal seam synthesis:
  // Blend the original image with a half-period shifted copy (x + 512, y + 512) mod 1024
  // weighted by a smooth 2D raised-cosine window near the outer edges of the tile.
  // Because the shifted copy is continuous across (x=0, y=0) while the original is continuous
  // across (x=512, y=512), smoothly transitioning to the shifted copy within BLEND_BAND of
  // the border makes the resulting 1024x1024 tile 100% periodic and seamless on all 4 edges!
  const out = Buffer.alloc(SIZE * SIZE * 3);

  function edgeWeight(coord) {
    const distToEdge = Math.min(coord, SIZE - 1 - coord);
    if (distToEdge >= BLEND_BAND) return 0.0;
    // Smooth cosine curve: 1.0 at distToEdge=0, 0.0 at distToEdge=BLEND_BAND
    const t = distToEdge / BLEND_BAND;
    return 0.5 * (1.0 + Math.cos(Math.PI * t));
  }

  for (let y = 0; y < SIZE; y++) {
    const wy = edgeWeight(y);
    const sy = (y + SIZE / 2) % SIZE;

    for (let x = 0; x < SIZE; x++) {
      const wx = edgeWeight(x);
      const sx = (x + SIZE / 2) % SIZE;

      // Combined border weight (0 in interior, 1 along all 4 outer edges)
      const w = 1.0 - (1.0 - wx) * (1.0 - wy);

      const idxA = (y * SIZE + x) * 3;
      const idxB = (sy * SIZE + sx) * 3;
      const idxX = (y * SIZE + sx) * 3;
      const idxY = (sy * SIZE + x) * 3;

      // 4-way toroidal interpolation for completely artifact-free corners and edges
      const w00 = (1.0 - wx) * (1.0 - wy);
      const w10 = wx * (1.0 - wy);
      const w01 = (1.0 - wx) * wy;
      const w11 = wx * wy;

      for (let c = 0; c < 3; c++) {
        const val =
          src[idxA + c] * w00 +
          src[idxX + c] * w10 +
          src[idxY + c] * w01 +
          src[idxB + c] * w11;
        out[idxA + c] = Math.max(0, Math.min(255, Math.round(val)));
      }
    }
  }

  await sharp(out, { raw: { width: SIZE, height: SIZE, channels: 3 } })
    .toColorspace('srgb')
    .png({ compressionLevel: 9 })
    .toFile(outputPath);

  console.log(`Saved seamless 1024x1024 texture to ${outputPath}`);

  // Generate 2x2 tiled preview (1024x1024 showing four 512x512 quadrants) to verify zero seams
  const halfTile = await sharp(outputPath).resize(512, 512).toBuffer();
  await sharp({
    create: { width: 1024, height: 1024, channels: 3, background: { r: 0, g: 0, b: 0 } }
  })
    .composite([
      { input: halfTile, left: 0, top: 0 },
      { input: halfTile, left: 512, top: 0 },
      { input: halfTile, left: 0, top: 512 },
      { input: halfTile, left: 512, top: 512 }
    ])
    .png()
    .toFile(tiledCheckPath);

  console.log(`Saved 2x2 seamless tiling check to ${tiledCheckPath}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
```

Inspect both `public/assets/alien_thawed_ground.png` and `scratch/alien_thawed_ground_2x2_check.png` using `read_file` to verify that:
- There are no visible horizontal or vertical seams in the `2 × 2` check.
- The colors and surface details match the cold, freshly thawed alien aesthetic of the reference image.
- Copy `public/assets/alien_thawed_ground.png` into the brain artifact directory if you need to embed it in an artifact.

---

## STEP 3: Integrate `alien_thawed_ground.png` into `src/render/ThreeTerrain.ts`

### Architectural Requirements:
1. **Use the existing `ThreeTerrain` class and heightfield geometry** (`3600 × 3600`, `90 × 90` segments). Do not replace the geometry with a flat plane or alter `terrain.calculateHeight(wx, wy)`.
2. **Load `/assets/alien_thawed_ground.png`** via the `textureLoader` passed into `ThreeTerrain`'s constructor (with fallback to `new THREE.TextureLoader()`).
3. **Configure texture sampling for crisp angled third-person viewing:**
   - `groundTex.colorSpace = THREE.SRGBColorSpace;`
   - `groundTex.wrapS = THREE.RepeatWrapping;`
   - `groundTex.wrapT = THREE.RepeatWrapping;`
   - `groundTex.minFilter = THREE.LinearMipmapLinearFilter;`
   - `groundTex.magFilter = THREE.LinearFilter;`
   - `groundTex.anisotropy = 8;`
4. **Anti-Tiling & Slope-Correct World-Space Shader Integration:**
   - Sample `uGroundTex` using **world-space coordinates (`vCustomWorldPos.xz`)** at two organic scales/orientations:
     - **Primary detail layer (`uv1`):** `vCustomWorldPos.xz * 0.0042` (~238 world units per tile, matching Commander's `52`-unit height and the reference screenshot's ground detail scale).
     - **Secondary rotated anti-tiling layer (`uv2`):** Rotated by `~37°` and scaled by `0.0017` (~588 world units per tile), blended with a smooth world-space organic noise mask so large open valleys and plateaus never show repetitive grid patterns.
   - **Slope-aware triplanar/contour protection:** On climbable slopes, offset the UV projection slightly by `vCustomWorldPos.y * 0.35` along the slope direction so the texture never stretches unnaturally on ramps or hillsides.
   - **Large-scale macro variation:** Modulate the sampled texture subtly (`±10%`) across valleys, riverbanks, and higher permafrost elevations so the terrain retains natural depth and contour readability, while steep vertical cliff walls (`slope > 0.36`) transition cleanly into the cool frozen blue-slate cliff strata.

### Exact Code for `src/render/ThreeTerrain.ts`:

Update lines 1–115 of [`src/render/ThreeTerrain.ts`](../src/render/ThreeTerrain.ts) (preserving `createValleyRiver`, `createGrassField`, `createOrganicBoulders`, and `update` completely unchanged):

```typescript
import * as THREE from 'three';
import { TerrainSystem } from '../sim/TerrainSystem';

export class ThreeTerrain {
  public group: THREE.Group;
  public terrainMeshes: THREE.Object3D[] = [];
  private grassMesh: THREE.InstancedMesh | null = null;
  private riverMesh: THREE.Mesh | null = null;
  private textureLoader: THREE.TextureLoader;

  constructor(terrain: TerrainSystem, textureLoader?: THREE.TextureLoader) {
    this.group = new THREE.Group();
    this.textureLoader = textureLoader || new THREE.TextureLoader();
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

    // 2. Load Seamless Loop Stage 1 Ground Texture (alien_thawed_ground.png)
    const groundTex = this.textureLoader.load('/assets/alien_thawed_ground.png?v=1.0');
    groundTex.colorSpace = THREE.SRGBColorSpace;
    groundTex.wrapS = THREE.RepeatWrapping;
    groundTex.wrapT = THREE.RepeatWrapping;
    groundTex.minFilter = THREE.LinearMipmapLinearFilter;
    groundTex.magFilter = THREE.LinearFilter;
    groundTex.anisotropy = 8;

    const groundMat = new THREE.MeshLambertMaterial({
      color: 0xffffff,
      map: groundTex
    });

    groundMat.onBeforeCompile = (shader) => {
      shader.uniforms.uGroundTex = { value: groundTex };

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
        uniform sampler2D uGroundTex;
        varying vec3 vCustomWorldPos;
        varying vec3 vCustomWorldNorm;
      ` + shader.fragmentShader;

      shader.fragmentShader = shader.fragmentShader.replace(
        '#include <map_fragment>',
        `
        float slope = 1.0 - abs(vCustomWorldNorm.y);
        float h = vCustomWorldPos.y;

        // Slope-compensated world coordinates prevent UV stretching on climbable hills/ramps
        vec2 worldXZ = vCustomWorldPos.xz + vCustomWorldNorm.xz * (h * 0.28);

        // Primary detail sample (fine soil grit, frost crystals, moss & mineral cracks)
        vec2 uvPrimary = worldXZ * 0.0042;
        vec3 texPrimary = texture2D(uGroundTex, uvPrimary).rgb;

        // Secondary rotated & larger-scale sample (~37 deg rotation) to break up macro repetition
        mat2 rotMat = mat2(0.7986, -0.6018, 0.6018, 0.7986);
        vec2 uvSecondary = (rotMat * worldXZ) * 0.00185 + vec2(0.37, 0.61);
        vec3 texSecondary = texture2D(uGroundTex, uvSecondary).rgb;

        // Organic world-space blend mask between primary and secondary scales
        float macroBlend = sin(worldXZ.x * 0.0055 + cos(worldXZ.y * 0.0048) * 1.8) * 0.5 + 0.5;
        float microBlend = cos(worldXZ.y * 0.011 - sin(worldXZ.x * 0.009) * 1.4) * 0.5 + 0.5;
        float blendFactor = smoothstep(0.25, 0.75, macroBlend * 0.65 + microBlend * 0.35);

        vec3 groundAlbedo = mix(texPrimary, texSecondary, blendFactor * 0.42);

        // Subtle macro environmental tinting across elevations (preserves texture detail while grounding contours)
        vec3 valleyTint   = vec3(0.94, 0.98, 0.95); // Cool damp valley floor
        vec3 plateauTint  = vec3(1.03, 1.02, 0.98); // Sunlit thawed plateau
        vec3 frostSummit  = vec3(0.88, 0.95, 1.05); // Cold high-altitude permafrost tint
        vec3 riverBankTint = vec3(0.84, 0.90, 0.88); // Damp riverbank soil transition

        vec3 macroTint = mix(valleyTint, plateauTint, macroBlend);
        if (h < 18.0) {
          float rt = clamp(h / 18.0, 0.0, 1.0);
          macroTint = mix(riverBankTint, macroTint, rt);
        } else if (h > 320.0) {
          float st = clamp((h - 320.0) / 220.0, 0.0, 1.0);
          macroTint = mix(macroTint, frostSummit, st);
        }

        vec3 flatCol = groundAlbedo * macroTint;

        // Steep unwalkable cliff walls blend into cool blue-slate rock strata with subtle texture detail
        vec3 cliffSlate = vec3(0.24, 0.31, 0.42);
        vec3 deepCliff  = vec3(0.17, 0.23, 0.33);
        vec3 rockBase   = mix(deepCliff, cliffSlate, clamp(h / 450.0, 0.0, 1.0));
        float strata    = sin(h * 0.08 + vCustomWorldPos.x * 0.005) * 0.025;
        vec3 rockCol    = mix(rockBase + vec3(strata), groundAlbedo * vec3(0.62, 0.70, 0.82), 0.32);

        float rockFactor = smoothstep(0.28, 0.48, slope);
        diffuseColor.rgb = mix(flatCol, rockCol, rockFactor);
        `
      );
    };

    const groundMesh = new THREE.Mesh(groundGeo, groundMat);
    groundMesh.rotation.x = -Math.PI / 2;
    groundMesh.position.set(halfW, 0, halfH);
    this.group.add(groundMesh);
    this.terrainMeshes.push(groundMesh);
```

---

## STEP 4: Verification & Visual Confirmation

After completing Steps 1–3:
1. Run `npm run build` to confirm zero TypeScript or bundler errors.
2. Open the running game (`http://localhost:5173`), start a run in Loop Stage 1, and capture an in-game screenshot from the normal gameplay camera.
3. Confirm all 7 verification criteria:
   - [x] The ground no longer looks like a solid-colored surface.
   - [x] The `1024 × 1024` `alien_thawed_ground.png` texture tiles seamlessly without visible square boundaries.
   - [x] Texture appearance is crisp and unstretched on both flat terrain and climbable slopes.
   - [x] The ground maintains a cold, freshly thawed alien aesthetic (gray-green soil, blue-gray permafrost earth, dark thawed patches, low moss, subtle frost crystals, and faint violet-blue bio-pigmentation).
   - [x] Movement, physics, collisions, and performance remain unchanged.
4. Present:
   - The standalone `1024 × 1024` `alien_thawed_ground.png` preview.
   - The live in-game screenshot from the normal gameplay camera.
   - A concise list of files created/modified.


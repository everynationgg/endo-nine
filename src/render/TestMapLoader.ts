import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { ColladaLoader } from 'three/examples/jsm/loaders/ColladaLoader.js';
import { OBJLoader } from 'three/examples/jsm/loaders/OBJLoader.js';
import { STLLoader } from 'three/examples/jsm/loaders/STLLoader.js';
import { MapObstacle, TerrainSurfaceCategory, Vector2 } from '../sim/types';
import { ColliderTri, MeshTerrainCollider } from '../sim/MeshTerrainCollider';
import { WaterFreezeProfile, buildWaterFreezeProfile, WATER_FREEZE_KNOTS } from '../sim/WaterFreezeProfile';

export type TestMapScaleMode = 'auto' | 'x100' | 'x25' | 'x1';

export interface RedCrystalMaterialEntry {
  material: THREE.MeshPhysicalMaterial;
  baseEmissiveIntensity: number;
  baseOpacity: number;
}

export interface LoadedTestMap {
  root: THREE.Group;
  heightGrid: Float32Array;
  meshCollider: MeshTerrainCollider;
  worldWidth: number;
  worldHeight: number;
  walkableBounds: { minX: number; maxX: number; minY: number; maxY: number };
  terrainBounds: { minX: number; maxX: number; minZ: number; maxZ: number };
  circularBounds: { cx: number; cz: number; radius: number } | null;
  spawnPos: Vector2;
  bossSpawnPos: Vector2;
  redCrystalMouthPos: { x: number; y: number; z: number } | null;
  redCrystalBox: { minX: number; maxX: number; minY: number; maxY: number; minZ: number; maxZ: number } | null;
  redCrystalMaterials: RedCrystalMaterialEntry[];
  artifactPos: Vector2;
  doubleJumpPos: { x: number; y: number; z?: number } | null;
  shipCenter?: { x: number; y: number; z: number } | null;
  shipBox?: { minX: number; maxX: number; minY: number; maxY: number; minZ: number; maxZ: number } | null;
  worldEventPositions: Vector2[];
  podPositions: Vector2[];
  shipObstacles: MapObstacle[];
  propObstacles: MapObstacle[];
  minHeight: number;
  maxHeight: number;
  appliedScale: number;
  meshCount: number;
  triangleCount: number;
  fileName: string;
  allowTestMapNarrative?: boolean;
  waterFreezeProfile?: WaterFreezeProfile | null;
  animatedUniforms?: Array<{ uTime: { value: number } }>;
  setRegionalFreeze?: (progress: number, originX?: number, originY?: number) => void;
}

const DEFAULT_WORLD_SIZE = 3600;
const GRID_RES = 361;

export async function loadTestMapFromUrl(
  url: string,
  fileName: string,
  scaleMode: TestMapScaleMode = 'auto'
): Promise<LoadedTestMap> {
  const res = await fetch(url);
  if (!res.ok) {
    throw new Error(`Could not fetch "${url}" (${res.status}).`);
  }
  const buffer = await res.arrayBuffer();
  return parseAndPrepareTestMap(buffer, fileName, scaleMode);
}

export async function loadTestMapFromFile(
  file: File,
  scaleMode: TestMapScaleMode = 'auto'
): Promise<LoadedTestMap> {
  const buffer = await file.arrayBuffer();
  return parseAndPrepareTestMap(buffer, file.name, scaleMode);
}

async function parseAndPrepareTestMap(
  buffer: ArrayBuffer,
  fileName: string,
  scaleMode: TestMapScaleMode
): Promise<LoadedTestMap> {
  const ext = fileName.split('.').pop()?.toLowerCase() || '';
  let model: THREE.Object3D;

  if (ext === 'glb' || ext === 'gltf') {
    const loader = new GLTFLoader();
    const gltf = await loader.parseAsync(buffer, '');
    model = gltf.scene;
  } else if (ext === 'dae') {
    const loader = new ColladaLoader();
    const text = new TextDecoder().decode(buffer);
    const collada = loader.parse(text, '');
    if (!collada || !collada.scene) {
      throw new Error('Failed to parse COLLADA (.dae) scene.');
    }
    model = collada.scene;
  } else if (ext === 'obj') {
    const loader = new OBJLoader();
    const text = new TextDecoder().decode(buffer);
    model = loader.parse(text);
  } else if (ext === 'stl') {
    const loader = new STLLoader();
    const geo = loader.parse(buffer);
    geo.computeVertexNormals();
    const mat = new THREE.MeshLambertMaterial({ color: 0x6b8e78 });
    model = new THREE.Mesh(geo, mat);
  } else {
    throw new Error(`Unsupported map format ".${ext}". Please export as .glb, .gltf, .dae, .obj, or .stl.`);
  }

  let meshCount = 0;
  let triangleCount = 0;
  const roleMatCache = new Map<string, THREE.Material>();
  const redCrystalMaterials: RedCrystalMaterialEntry[] = [];
  model.traverse((obj) => {
    const normalizedName = obj.name.trim().replace(/[\s_]+/g, ' ');
    if (
      /^sree$/i.test(normalizedName) ||
      /walking support post|walkway arm|column walkway/i.test(normalizedName)
    ) {
      obj.visible = false;
      return;
    }

    const mesh = obj as THREE.Mesh;
    if (!mesh.isMesh) return;

    if (isSkydomeObject(mesh)) {
      const mats = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
      const isGlassBase = mats.some((m) => m && /translucent_glass_green_dark/i.test(m.name || ''));
      if (isGlassBase) {
        mesh.visible = false;
        return;
      }

      meshCount++;
      const geo = mesh.geometry as THREE.BufferGeometry;
      if (geo) {
        triangleCount += geo.index ? Math.floor(geo.index.count / 3) : Math.floor((geo.attributes.position?.count || 0) / 3);
      }
      mesh.castShadow = false;
      mesh.receiveShadow = false;

      const skySide = geo ? detectSkydomeSide(geo) : THREE.FrontSide;
      const toUnlitSky = (m: THREE.Material | undefined) => {
        const std = m as THREE.MeshStandardMaterial | undefined;
        return new THREE.MeshBasicMaterial({
          name: std?.name || 'SkydomeUnlit',
          map: std?.map || null,
          color: 0xffffff,
          side: skySide,
          fog: false
        });
      };
      mesh.material = Array.isArray(mesh.material)
        ? mesh.material.map(toUnlitSky)
        : toUnlitSky(mesh.material);
      return;
    }

    meshCount++;
    const geo = mesh.geometry as THREE.BufferGeometry;
    if (geo) {
      triangleCount += geo.index ? Math.floor(geo.index.count / 3) : Math.floor((geo.attributes.position?.count || 0) / 3);
      if (!geo.attributes.normal) {
        geo.computeVertexNormals();
      }
    }

    if (isWaterMesh(mesh)) {
      const mats = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
      const fixedMats = mats.map((m) => {
        const std = m as THREE.MeshStandardMaterial | undefined;
        return new THREE.MeshStandardMaterial({
          name: std?.name || 'WaterSurface',
          map: std?.map || null,
          color: std?.map ? 0xdbeafe : 0x2b85cc,
          emissive: 0x0a2e4d,
          emissiveIntensity: 0.35,
          roughness: 0.25,
          metalness: 0.08,
          transparent: true,
          opacity: 0.85,
          side: THREE.DoubleSide,
          depthWrite: false,
          depthTest: true,
          polygonOffset: true,
          polygonOffsetFactor: -2,
          polygonOffsetUnits: -2
        });
      });
      mesh.material = Array.isArray(mesh.material) ? fixedMats : fixedMats[0];
      mesh.receiveShadow = true;
      mesh.renderOrder = 2;
      return;
    }

    const isTreeMesh = isTreeObject(mesh);
    const isRedCrystal = isRedBossCrystalObject(mesh);
    const isRightCrystal = isRightCrystalObject(mesh);
    const isTower = isTowerObject(mesh);
    const fixMat = (m: THREE.Material): THREE.Material => {
      const matLow = (m.name || '').toLowerCase();
      // Preserve intentional translucent ship glass / engine thrusters only
      if (matLow.includes('nc wnd trnsp') || matLow.includes('nc impulse trs')) {
        m.side = THREE.DoubleSide;
        m.transparent = true;
        m.depthWrite = false;
        mesh.renderOrder = 2;
        m.needsUpdate = true;
        return m;
      }
      // Red Boss Crystal Formation (skpAB2B > crystal_cave): ruby-red faceted crystalline formation
      if (isRedCrystal) {
        const key = `red_crystal:${m.uuid}`;
        let phys = roleMatCache.get(key) as THREE.MeshPhysicalMaterial | undefined;
        if (!phys) {
          phys = new THREE.MeshPhysicalMaterial({
            name: `${m.name || 'crystal'}_ruby`,
            color: new THREE.Color(0xe11d48),
            emissive: new THREE.Color(0x881337),
            emissiveIntensity: 0.56,
            metalness: 0.08,
            roughness: 0.14,
            clearcoat: 1.0,
            clearcoatRoughness: 0.08,
            reflectivity: 0.92,
            flatShading: true,
            transparent: true,
            opacity: 0.86,
            depthWrite: true,
            depthTest: true,
            side: THREE.DoubleSide
          });
          applyHeroCrystalDetailShader(phys, 'ruby');
          redCrystalMaterials.push({
            material: phys,
            baseEmissiveIntensity: 0.56,
            baseOpacity: 0.86
          });
          roleMatCache.set(key, phys);
        }
        mesh.renderOrder = 3;
        return phys;
      }
      // Right-Side Crystal Formation (Untitled#3): amethyst-sapphire faceted crystalline formation
      if (isRightCrystal) {
        const key = `right_crystal:${m.uuid}`;
        let phys = roleMatCache.get(key) as THREE.MeshPhysicalMaterial | undefined;
        if (!phys) {
          phys = new THREE.MeshPhysicalMaterial({
            name: `${m.name || 'crystal'}_amethyst`,
            color: new THREE.Color(0x818cf8),
            emissive: new THREE.Color(0x312e81),
            emissiveIntensity: 0.42,
            metalness: 0.08,
            roughness: 0.12,
            clearcoat: 1.0,
            clearcoatRoughness: 0.08,
            reflectivity: 0.92,
            flatShading: true,
            transparent: true,
            opacity: 0.84,
            depthWrite: true,
            depthTest: true,
            side: THREE.DoubleSide
          });
          applyHeroCrystalDetailShader(phys, 'amethyst');
          roleMatCache.set(key, phys);
        }
        mesh.renderOrder = 3;
        return phys;
      }
      // First Artifact Tower: preserve authored Blender PBR materials (Concrete_02_1K / Asphalt_02_1K),
      // or apply cool light slate gray #A7ADB5 for legacy SketchUp Warm_Toned_Rammed_Earth towers
      if (isTower && !matLow.includes('concrete') && !matLow.includes('asphalt')) {
        const key = `tower:${m.uuid}`;
        let cloned = roleMatCache.get(key);
        if (!cloned) {
          cloned = m.clone();
          if (cloned instanceof THREE.MeshStandardMaterial) {
            if (matLow.includes('metal')) {
              cloned.color.setHex(0x474e57);
              cloned.metalness = 0.28;
              cloned.roughness = 0.58;
            } else {
              if (cloned.map) {
                cloned.map = createCoolSlateStoneTexture(cloned.map) ?? cloned.map;
              }
              cloned.color.setHex(0xa7adb5);
              cloned.metalness = 0.08;
              cloned.roughness = 0.84;
            }
          }
          cloned.transparent = false;
          cloned.opacity = 1.0;
          cloned.alphaTest = 0;
          cloned.depthWrite = true;
          cloned.depthTest = true;
          cloned.side = THREE.DoubleSide;
          cloned.needsUpdate = true;
          roleMatCache.set(key, cloned);
        }
        return cloned;
      }
      // Foliage cutouts stay in opaque pass using alphaTest so they never cause crystal-transparency sorting bugs
      if (isTreeMesh && (matLow.includes('folhas') || matLow.includes('pineneedle') || matLow.includes('pinebranch'))) {
        m.transparent = false;
        m.opacity = 1.0;
        m.alphaTest = 0.45;
        m.depthWrite = true;
        m.depthTest = true;
        m.side = THREE.DoubleSide;
        m.needsUpdate = true;
        return m;
      }
      if (m instanceof THREE.MeshStandardMaterial) {
        // Ensure crisp anisotropic filtering and seamless repeat wrapping on all PBR texture maps
        const texList = [m.map, m.normalMap, m.roughnessMap, m.aoMap, m.metalnessMap];
        for (const tex of texList) {
          if (tex) {
            tex.wrapS = THREE.RepeatWrapping;
            tex.wrapT = THREE.RepeatWrapping;
            tex.anisotropy = 8;
          }
        }
        // Fix SimLab / SketchUp GLTF metallic=0.5..1.0 on non-metallic soil/concrete/asphalt/stone materials
        // (without an HDRI envMap, metalness=0.5 dims diffuse lighting by 50% and makes terrain look dark/muddy)
        if (
          matLow.includes('soil') ||
          matLow.includes('concrete') ||
          matLow.includes('asphalt') ||
          matLow.includes('stone') ||
          matLow.includes('earth') ||
          matLow.includes('bark')
        ) {
          m.metalness = 0.04;
          m.metalnessMap = null;
          m.roughness = Math.max(m.roughness || 0.82, 0.78);
        } else if (!m.metalnessMap && m.metalness >= 0.85) {
          m.metalness = matLow.includes('nc ') ? 0.38 : 0.08;
          m.roughness = Math.max(m.roughness, 0.48);
        }
        // Prevent coplanar Z-fighting where the flat Soil_04_1K base plane meets Y=0 vertices of Soil_03_1K
        if (matLow.includes('soil_04')) {
          m.polygonOffset = true;
          m.polygonOffsetFactor = 2;
          m.polygonOffsetUnits = 2;
        }
      }
      // Force ALL SketchUp/Blender terrain/rock/mountain/tower/bridge/hull materials fully opaque & smooth-shaded
      if ('flatShading' in m) {
        (m as THREE.MeshStandardMaterial).flatShading = false;
      }
      m.transparent = false;
      m.opacity = 1.0;
      m.alphaTest = 0;
      m.depthWrite = true;
      m.depthTest = true;
      m.side = THREE.DoubleSide;
      m.needsUpdate = true;
      return m;
    };
    if (Array.isArray(mesh.material)) {
      mesh.material = mesh.material.map(fixMat);
    } else if (mesh.material) {
      mesh.material = fixMat(mesh.material);
    } else {
      mesh.material = new THREE.MeshLambertMaterial({ color: 0x5c7a67, side: THREE.DoubleSide });
    }
    if (!isRedCrystal && !isRightCrystal) {
      mesh.renderOrder = 0;
    }
  });

  if (meshCount === 0) {
    throw new Error('The exported file contains no 3D meshes.');
  }

  model.updateMatrixWorld(true);

  // Detect if map contains a sculpted Soil_03 heightfield and/or a flat Soil_04 plane (e.g. Blenderrr.glb).
  // When sculpted Soil_03 terrain is present, Soil_04 is a giant flat plane at Y~0 that visually slices across
  // and buries all sculpted craters, valleys, and potholes — hide Soil_04 so the authored non-flat terrain shows through.
  let baseFloorModelY: number | null = null;
  let hasSculptedSoil03 = false;
  const soil04Meshes: THREE.Mesh[] = [];
  model.traverse((obj) => {
    const mesh = obj as THREE.Mesh;
    if (!mesh.isMesh || !mesh.geometry) return;
    const mats = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
    if (mats.some((m) => (m?.name || '').toLowerCase().includes('soil_03'))) {
      hasSculptedSoil03 = true;
    }
    if (mats.some((m) => (m?.name || '').toLowerCase().includes('soil_04'))) {
      soil04Meshes.push(mesh);
      mesh.geometry.computeBoundingBox();
      if (mesh.geometry.boundingBox) {
        const b = mesh.geometry.boundingBox.clone().applyMatrix4(mesh.matrixWorld);
        baseFloorModelY = b.max.y;
      }
    }
  });

  if (hasSculptedSoil03 && soil04Meshes.length > 0) {
    for (const sm of soil04Meshes) {
      sm.visible = false;
    }
  }

  if (hasSculptedSoil03) {
    model.traverse((obj) => {
      const mesh = obj as THREE.Mesh;
      if (!mesh.isMesh || !mesh.geometry) return;
      const mats = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
      if (!mats.some((m) => (m?.name || '').toLowerCase().includes('soil_03'))) return;

      const geo = mesh.geometry as THREE.BufferGeometry;
      // Refine stretched UV tiling on large scaled Blender terrain planes so detail stays crisp across hills & potholes
      const uv = geo.attributes.uv as THREE.BufferAttribute | undefined;
      if (uv && uv.count > 0) {
        let minU = Infinity;
        let maxU = -Infinity;
        for (let i = 0; i < uv.count; i++) {
          const u = uv.getX(i);
          if (u < minU) minU = u;
          if (u > maxU) maxU = u;
        }
        if (maxU - minU > 0 && maxU - minU < 30) {
          const uvScale = 10;
          for (let i = 0; i < uv.count; i++) {
            uv.setXY(i, uv.getX(i) * uvScale, uv.getY(i) * uvScale);
          }
          uv.needsUpdate = true;
        }
      }
    });
  }

  // Recompute position-welded smooth vertex normals across split-vertex terrain & curved architecture
  // so hills, potholes, riverbanks, and the cylindrical Tower render smoothly instead of flat polygon facets.
  model.traverse((obj) => {
    if (!isObjectVisibleInTree(obj) || isSkydomeObject(obj)) return;
    const mesh = obj as THREE.Mesh;
    if (!mesh.isMesh || !mesh.geometry) return;
    if (isWaterMesh(mesh) || isTreeObject(mesh) || isShipObject(mesh)) return;
    if (isRedBossCrystalObject(mesh) || isRightCrystalObject(mesh)) return;

    const mats = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
    const matLow = (mats[0]?.name || '').toLowerCase();
    if (matLow.includes('soil_04')) return;

    const geo = mesh.geometry as THREE.BufferGeometry;
    const pos = geo.attributes.position;
    if (!pos || pos.count < 9) return;

    if (isTowerObject(mesh)) {
      // Smooth curved concrete cylinder walls & spiral asphalt ramps while keeping 90-deg stair edges sharp
      smoothSplitVertexNormals(geo, 48, true);
    } else {
      // Organic sculpted terrain (Soil_03_1K), cliffs, potholes, bridges & waterfall rocks:
      // wide crease angle with hemisphere alignment eliminates facets AND prevents dark seams on flipped faces
      smoothSplitVertexNormals(geo, 88, true);
    }
  });

  // Measure authored solid terrain bounds (excluding oversized protruding water planes & skydomes)
  const rawBox = new THREE.Box3();
  const terrainOnlyBox = new THREE.Box3();
  model.traverse((obj) => {
    if (!isObjectVisibleInTree(obj) || isSkydomeObject(obj)) return;
    const mesh = obj as THREE.Mesh;
    if (mesh.isMesh && mesh.geometry) {
      mesh.geometry.computeBoundingBox();
      if (mesh.geometry.boundingBox) {
        const b = mesh.geometry.boundingBox.clone().applyMatrix4(mesh.matrixWorld);
        if (!isWaterMesh(mesh)) {
          rawBox.union(b);
          if (!isTreeObject(mesh) && !isShipObject(mesh) && !isTowerObject(mesh)) {
            terrainOnlyBox.union(b);
          }
        }
      }
    }
  });
  if (rawBox.isEmpty()) {
    rawBox.setFromObject(model);
  }

  const fitBox = !terrainOnlyBox.isEmpty() ? terrainOnlyBox : rawBox;
  const anchorSize = new THREE.Vector3();
  const anchorCenter = new THREE.Vector3();
  fitBox.getSize(anchorSize);
  fitBox.getCenter(anchorCenter);

  const maxHoriz = Math.max(anchorSize.x, anchorSize.z, 0.001);
  let appliedScale = 1;
  if (scaleMode === 'auto') {
    // Keep large maps (e.g. 220m x 232m or 400m x 400m) at true 1m = 25 game units instead of shrinking them into 3600!
    appliedScale = maxHoriz >= 145 ? 25 : DEFAULT_WORLD_SIZE / maxHoriz;
  } else if (scaleMode === 'x100') {
    appliedScale = 100;
  } else if (scaleMode === 'x25') {
    appliedScale = 25;
  } else {
    appliedScale = 1;
  }

  const worldWidth = Math.max(DEFAULT_WORLD_SIZE, Math.ceil((anchorSize.x * appliedScale + 200) / 100) * 100);
  const worldHeight = Math.max(DEFAULT_WORLD_SIZE, Math.ceil((anchorSize.z * appliedScale + 200) / 100) * 100);

  const detectedBaseFloorY = baseFloorModelY as number | null;
  const useFlatBaseFloor = !hasSculptedSoil03 && detectedBaseFloorY !== null;
  const groundMinY = useFlatBaseFloor ? (detectedBaseFloorY as number) : fitBox.min.y;
  const seaLevelWorldY =
    detectedBaseFloorY !== null ? 10 + (detectedBaseFloorY - groundMinY) * appliedScale : 10;
  const root = new THREE.Group();
  root.name = 'CustomMap_Root';
  model.scale.multiplyScalar(appliedScale);
  model.position.set(
    worldWidth * 0.5 - anchorCenter.x * appliedScale,
    10 - groundMinY * appliedScale,
    worldHeight * 0.5 - anchorCenter.z * appliedScale
  );
  root.add(model);
  root.updateMatrixWorld(true);

  // Compute exact transformed solid-terrain bounds in world units so protruding water planes can be clipped cleanly
  const worldTerrainBox = new THREE.Box3();
  root.traverse((obj) => {
    if (!isObjectVisibleInTree(obj) || isSkydomeObject(obj)) return;
    const mesh = obj as THREE.Mesh;
    if (!mesh.isMesh || !mesh.geometry || isWaterMesh(mesh) || isTreeObject(mesh) || isShipObject(mesh) || isTowerObject(mesh)) return;
    mesh.geometry.computeBoundingBox();
    if (mesh.geometry.boundingBox) {
      worldTerrainBox.union(mesh.geometry.boundingBox.clone().applyMatrix4(mesh.matrixWorld));
    }
  });

  const terrainBounds = {
    minX: worldTerrainBox.min.x,
    maxX: worldTerrainBox.max.x,
    minZ: worldTerrainBox.min.z,
    maxZ: worldTerrainBox.max.z
  };

  const clipInset = hasSculptedSoil03 || baseFloorModelY !== null ? 4 : 14;
  const clipBounds = {
    minX: worldTerrainBox.min.x + clipInset,
    maxX: worldTerrainBox.max.x - clipInset,
    minZ: worldTerrainBox.min.z + clipInset,
    maxZ: worldTerrainBox.max.z - clipInset
  };

  // Visually and physically clip overflowing river/water meshes to the authored rocky map border
  clipWaterMeshesToBounds(root, clipBounds);

  // Non-destructively widen the exterior Artifact Tower spiral steps before building terrain colliders
  widenArtifactTowerSteps(root);
  root.updateMatrixWorld(true);

  // Derive narrow flowing river-channel / waterfall plunge-pool freeze profile (mostly frozen ice)
  const waterFreezeProfile = extractWaterFreezeProfileFromScene(root);

  // Build True-3D Classified Spatial Triangle Collider
  const { collider, heightGrid, minHeight, maxHeight } = buildMeshColliderAndFallbackGrid(
    root,
    worldWidth,
    worldHeight,
    clipBounds,
    useFlatBaseFloor,
    hasSculptedSoil03,
    seaLevelWorldY,
    waterFreezeProfile
  );

  // Locate key authored landmarks directly from the transformed GLB hierarchy
  const layout = extractMapLandmarksAndLayout(root, collider, worldWidth, worldHeight, clipBounds);

  // Apply real-texture triplanar height/slope terrain blend shader, frozen-ice shader, & Overseer Tower glyph shader
  const waterLevelY = waterFreezeProfile ? waterFreezeProfile.waterLevelY : seaLevelWorldY;
  const waterTimeUniform = { value: 0 };
  const freezeUniforms = {
    uFreezeProgress: { value: 0 },
    uFreezeOriginXZ: { value: new THREE.Vector2(layout.artifactPos.x, layout.artifactPos.y) },
    uFreezeMaxRadius: { value: Math.max(4200, Math.hypot(worldWidth, worldHeight)) }
  };
  applyStage1TerrainBlendShader(
    root,
    {
      waterLevelY,
      minWorldY: worldTerrainBox.min.y,
      maxWorldY: worldTerrainBox.max.y
    },
    freezeUniforms
  );
  applyFrozenWaterShader(root, waterFreezeProfile, waterTimeUniform, freezeUniforms);
  applyOverseerTowerShader(root, waterTimeUniform, { x: layout.artifactPos.x, z: layout.artifactPos.y }, freezeUniforms);
  batchStaticMapMeshesByMaterial(root);

  return {
    root,
    heightGrid,
    meshCollider: collider,
    worldWidth,
    worldHeight,
    walkableBounds: collider.playableBounds,
    terrainBounds,
    circularBounds: null,
    ...layout,
    redCrystalMaterials,
    minHeight,
    maxHeight,
    appliedScale,
    meshCount,
    triangleCount,
    fileName,
    allowTestMapNarrative: true,
    waterFreezeProfile,
    animatedUniforms: [{ uTime: waterTimeUniform }],
    setRegionalFreeze: (progress: number, originX?: number, originY?: number) => {
      freezeUniforms.uFreezeProgress.value = Math.max(0, Math.min(1, progress));
      if (originX !== undefined && originY !== undefined) {
        freezeUniforms.uFreezeOriginXZ.value.set(originX, originY);
      }
    }
  };
}

function normName(n: string): string {
  return (n || '').toLowerCase().replace(/[\s_#-]+/g, ' ').replace(/\s+/g, ' ').trim();
}

/**
 * Computes area-weighted, crease-angle-aware smooth vertex normals for split-vertex (non-indexed)
 * or indexed meshes without altering vertex positions, UVs, or collider geometry.
 * When `hemisphereAlign` is true, coincident triangles with inverted winding (common in Blender/SketchUp
 * DoubleSide exports) are aligned into each triangle's own winding hemisphere so WebGL's `gl_FrontFacing`
 * flip produces continuous smooth shading with zero dark lighting seams.
 */
function smoothSplitVertexNormals(
  geo: THREE.BufferGeometry,
  creaseAngleDeg: number,
  hemisphereAlign: boolean
): void {
  const pos = geo.attributes.position;
  if (!pos || pos.count < 3) return;

  const idx = geo.index;
  const vertCount = pos.count;
  const triCount = idx ? Math.floor(idx.count / 3) : Math.floor(vertCount / 3);
  if (triCount <= 0) return;

  // Quantize local vertex coordinates to weld coincident split corners across UV seams
  geo.computeBoundingBox();
  const bb = geo.boundingBox;
  const extent = bb
    ? Math.max(bb.max.x - bb.min.x, bb.max.y - bb.min.y, bb.max.z - bb.min.z, 1)
    : 100;
  // Quantization step ~ 1/100,000 of mesh extent (e.g. ~0.004m on a 400m terrain) so shared corners weld cleanly
  const invStep = Math.min(2000, Math.max(50, Math.round(100000 / extent)));

  const groupMap = new Map<string, number>();
  const vertGroup = new Int32Array(vertCount);
  let uniqueCount = 0;

  for (let i = 0; i < vertCount; i++) {
    const qx = Math.round(pos.getX(i) * invStep);
    const qy = Math.round(pos.getY(i) * invStep);
    const qz = Math.round(pos.getZ(i) * invStep);
    const key = `${qx},${qy},${qz}`;
    let g = groupMap.get(key);
    if (g === undefined) {
      g = uniqueCount++;
      groupMap.set(key, g);
    }
    vertGroup[i] = g;
  }

  // Compute area-weighted face normals (fn) & unit face normals (un) + flat linked-list adjacency per position group
  const fnX = new Float32Array(triCount);
  const fnY = new Float32Array(triCount);
  const fnZ = new Float32Array(triCount);
  const unX = new Float32Array(triCount);
  const unY = new Float32Array(triCount);
  const unZ = new Float32Array(triCount);

  const head = new Int32Array(uniqueCount);
  head.fill(-1);
  const slotCount = triCount * 3;
  const slotTri = new Int32Array(slotCount);
  const slotNext = new Int32Array(slotCount);
  let slotPtr = 0;

  for (let t = 0; t < triCount; t++) {
    const i0 = idx ? idx.getX(t * 3) : t * 3;
    const i1 = idx ? idx.getX(t * 3 + 1) : t * 3 + 1;
    const i2 = idx ? idx.getX(t * 3 + 2) : t * 3 + 2;

    const ax = pos.getX(i0), ay = pos.getY(i0), az = pos.getZ(i0);
    const bx = pos.getX(i1), by = pos.getY(i1), bz = pos.getZ(i1);
    const cx = pos.getX(i2), cy = pos.getY(i2), cz = pos.getZ(i2);

    const e1x = bx - ax, e1y = by - ay, e1z = bz - az;
    const e2x = cx - ax, e2y = cy - ay, e2z = cz - az;

    const nx = e1y * e2z - e1z * e2y;
    const ny = e1z * e2x - e1x * e2z;
    const nz = e1x * e2y - e1y * e2x;
    const len = Math.hypot(nx, ny, nz);

    if (len > 1e-10) {
      fnX[t] = nx;
      fnY[t] = ny;
      fnZ[t] = nz;
      const invLen = 1 / len;
      unX[t] = nx * invLen;
      unY[t] = ny * invLen;
      unZ[t] = nz * invLen;
    }

    const g0 = vertGroup[i0];
    const g1 = vertGroup[i1];
    const g2 = vertGroup[i2];

    slotTri[slotPtr] = t;
    slotNext[slotPtr] = head[g0];
    head[g0] = slotPtr++;

    if (g1 !== g0) {
      slotTri[slotPtr] = t;
      slotNext[slotPtr] = head[g1];
      head[g1] = slotPtr++;
    }
    if (g2 !== g0 && g2 !== g1) {
      slotTri[slotPtr] = t;
      slotNext[slotPtr] = head[g2];
      head[g2] = slotPtr++;
    }
  }

  const cosCrease = Math.cos((creaseAngleDeg * Math.PI) / 180);
  const outNormals = new Float32Array(vertCount * 3);

  // Detect whether each triangle corner has its own dedicated vertex index (common in GLTF exports
  // that populate geo.index = [0,1,2,...] even when vertices are split per face).
  let hasUniqueCorners = !idx;
  if (idx && idx.count <= vertCount) {
    const seen = new Uint8Array(vertCount);
    hasUniqueCorners = true;
    for (let k = 0; k < idx.count; k++) {
      const vi = idx.getX(k);
      if (seen[vi]) {
        hasUniqueCorners = false;
        break;
      }
      seen[vi] = 1;
    }
  }

  if (hasUniqueCorners) {
    // Per-corner crease-aware & triangle-hemisphere-aligned path:
    // Each corner belongs to a unique triangle `t`, preserving hard creases above creaseAngleDeg
    // while aligning opposite-wound neighbors into `t`'s hemisphere so DoubleSide gl_FrontFacing stays seamless.
    for (let t = 0; t < triCount; t++) {
      const tux = unX[t], tuy = unY[t], tuz = unZ[t];
      for (let c = 0; c < 3; c++) {
        const vi = idx ? idx.getX(t * 3 + c) : t * 3 + c;
        const g = vertGroup[vi];
        let sx = 0, sy = 0, sz = 0;
        for (let p = head[g]; p !== -1; p = slotNext[p]) {
          const t2 = slotTri[p];
          const dot = tux * unX[t2] + tuy * unY[t2] + tuz * unZ[t2];
          if (hemisphereAlign) {
            if (Math.abs(dot) >= cosCrease) {
              const s = dot < 0 ? -1 : 1;
              sx += fnX[t2] * s;
              sy += fnY[t2] * s;
              sz += fnZ[t2] * s;
            }
          } else if (dot >= cosCrease) {
            sx += fnX[t2];
            sy += fnY[t2];
            sz += fnZ[t2];
          }
        }
        const sLen = Math.hypot(sx, sy, sz);
        if (sLen > 1e-10) {
          const inv = 1 / sLen;
          outNormals[vi * 3] = sx * inv;
          outNormals[vi * 3 + 1] = sy * inv;
          outNormals[vi * 3 + 2] = sz * inv;
        } else if (tux !== 0 || tuy !== 0 || tuz !== 0) {
          outNormals[vi * 3] = tux;
          outNormals[vi * 3 + 1] = tuy;
          outNormals[vi * 3 + 2] = tuz;
        } else {
          outNormals[vi * 3 + 1] = 1;
        }
      }
    }
  } else {
    // Indexed fallback: accumulate area-weighted group normals
    for (let vi = 0; vi < vertCount; vi++) {
      const g = vertGroup[vi];
      let rx = 0, ry = 0, rz = 0;
      let sx = 0, sy = 0, sz = 0;
      for (let p = head[g]; p !== -1; p = slotNext[p]) {
        const t2 = slotTri[p];
        const ux = unX[t2], uy = unY[t2], uz = unZ[t2];
        if (rx === 0 && ry === 0 && rz === 0) {
          rx = ux; ry = uy; rz = uz;
        }
        const dot = rx * ux + ry * uy + rz * uz;
        if (hemisphereAlign) {
          const s = dot < 0 ? -1 : 1;
          sx += fnX[t2] * s;
          sy += fnY[t2] * s;
          sz += fnZ[t2] * s;
        } else {
          sx += fnX[t2];
          sy += fnY[t2];
          sz += fnZ[t2];
        }
      }
      const sLen = Math.hypot(sx, sy, sz);
      if (sLen > 1e-10) {
        const inv = 1 / sLen;
        outNormals[vi * 3] = sx * inv;
        outNormals[vi * 3 + 1] = sy * inv;
        outNormals[vi * 3 + 2] = sz * inv;
      } else {
        outNormals[vi * 3 + 1] = 1;
      }
    }
  }

  geo.setAttribute('normal', new THREE.BufferAttribute(outNormals, 3));
  geo.attributes.normal.needsUpdate = true;
}

function getAncestryNames(obj: THREE.Object3D): string[] {
  const names: string[] = [];
  let cur: THREE.Object3D | null = obj;
  while (cur) {
    if (cur.name) names.push(cur.name.trim());
    cur = cur.parent;
  }
  return names;
}

function isTreeObject(obj: THREE.Object3D): boolean {
  const names = getAncestryNames(obj).map(normName);
  return names.some(
    (n) =>
      n.includes('pinetree') ||
      n.includes('pineneedle') ||
      n.includes('pinebranch') ||
      n.includes('palm tree') ||
      n.includes('arvumbras')
  );
}

function isShipObject(obj: THREE.Object3D): boolean {
  const names = getAncestryNames(obj).map(normName);
  return names.some(
    (n) =>
      n === 'ship' ||
      n.includes('starship') ||
      n.includes('geom3d ship') ||
      n.includes('bhutto') ||
      n.includes('sally ride') ||
      n.includes('ncc 55121') ||
      n.includes('obama half')
  );
}

function isRedBossCrystalObject(obj: THREE.Object3D): boolean {
  const names = getAncestryNames(obj).map(normName);
  return names.some((n) => n.includes('crystal cave') || n.includes('skpab2b'));
}

function isRightCrystalObject(obj: THREE.Object3D): boolean {
  if (isRedBossCrystalObject(obj)) return false;
  const names = getAncestryNames(obj).map(normName);
  return names.some((n) => n.includes('untitled 3'));
}

function isTowerObject(obj: THREE.Object3D): boolean {
  const names = getAncestryNames(obj).map(normName);
  return names.some((n) => n.includes('first artifact tower'));
}

/**
 * Extracts normalized neutral stone grain/crevice shading from a SketchUp diffuse map
 * so #A7ADB5 cool slate gray recoloring preserves masonry seams without warm brown tinting.
 */
function createCoolSlateStoneTexture(sourceTex: THREE.Texture): THREE.Texture | null {
  if (typeof document === 'undefined' || !sourceTex.image) return null;
  const img = sourceTex.image as { width?: number; height?: number; naturalWidth?: number; naturalHeight?: number };
  const w = Math.min(256, img.naturalWidth || img.width || 0);
  const h = Math.min(256, img.naturalHeight || img.height || 0);
  if (w <= 0 || h <= 0) return null;

  try {
    const canvas = document.createElement('canvas');
    canvas.width = w;
    canvas.height = h;
    const ctx = canvas.getContext('2d');
    if (!ctx) return null;
    ctx.drawImage(img as CanvasImageSource, 0, 0, w, h);
    const imgData = ctx.getImageData(0, 0, w, h);
    const data = imgData.data;

    let lumSum = 0;
    const count = w * h;
    for (let i = 0; i < data.length; i += 4) {
      lumSum += 0.299 * data[i] + 0.587 * data[i + 1] + 0.114 * data[i + 2];
    }
    const meanLum = Math.max(24, lumSum / Math.max(1, count));
    const scale = 236 / meanLum;

    for (let i = 0; i < data.length; i += 4) {
      const lum = 0.299 * data[i] + 0.587 * data[i + 1] + 0.114 * data[i + 2];
      // Compress highlights near 240 while keeping dark mortar cracks contrasted (~175..245)
      const centered = 232 + (lum - meanLum) * scale * 0.42;
      const v = Math.max(148, Math.min(255, Math.round(centered)));
      data[i] = v;
      data[i + 1] = v;
      data[i + 2] = Math.min(255, v + 3);
    }
    ctx.putImageData(imgData, 0, 0);

    const out = new THREE.CanvasTexture(canvas);
    out.wrapS = sourceTex.wrapS;
    out.wrapT = sourceTex.wrapT;
    out.repeat.copy(sourceTex.repeat);
    out.offset.copy(sourceTex.offset);
    out.colorSpace = THREE.SRGBColorSpace;
    out.needsUpdate = true;
    return out;
  } catch {
    return null;
  }
}

function isWaterMesh(mesh: THREE.Mesh): boolean {
  const mats = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
  return mats.some((m) => {
    if (!m) return false;
    const n = (m.name || '').trim();
    const low = n.toLowerCase();
    return n === '*' || low.includes('water');
  });
}

function classifyMeshSource(mesh: THREE.Mesh, matName: string): {
  baseRole: 'ground' | 'water' | 'waterfall_rock' | 'bridge' | 'tower' | 'ship' | 'solid_obstacle' | 'tree';
  sourceTag: string;
} {
  if (isTreeObject(mesh)) {
    return { baseRole: 'tree', sourceTag: 'trees' };
  }

  const names = getAncestryNames(mesh).map(normName);
  const matLow = (matName || '').toLowerCase();

  if (names.some((n) => n.includes('crystal cave') || n.includes('skpab2b'))) {
    return { baseRole: 'solid_obstacle', sourceTag: 'node:crystal_cave' };
  }
  if (names.some((n) => n === 'untitled 3' || n === 'untitled3' || n.includes('untitled 3'))) {
    return { baseRole: 'solid_obstacle', sourceTag: 'node:right_formation' };
  }
  if (names.some((n) => n.includes('first artifact tower'))) {
    if (matLow.includes('asphalt')) {
      return { baseRole: 'tower', sourceTag: 'node:tower_walkway' };
    }
    return { baseRole: 'tower', sourceTag: 'node:first_artifact_tower' };
  }
  if (names.some((n) => n.includes('landscape arch'))) {
    return { baseRole: 'bridge', sourceTag: 'node:landscape_arch_bridge' };
  }
  if (names.some((n) => n.includes('ayers rock') || n.includes('uluru'))) {
    return { baseRole: 'bridge', sourceTag: 'node:right_organic_bridge' };
  }
  if (names.some((n) => n.includes('waterfall'))) {
    if (matLow.includes('water') || matName.trim() === '*') {
      return { baseRole: 'water', sourceTag: 'node:waterfall_water' };
    }
    return { baseRole: 'waterfall_rock', sourceTag: 'node:waterfall_rocks' };
  }
  if (isShipObject(mesh)) {
    return { baseRole: 'ship', sourceTag: 'node:ship' };
  }
  if (matLow.includes('water') || matName.trim() === '*') {
    return { baseRole: 'water', sourceTag: 'water:river' };
  }
  if (matLow.includes('soil_04')) {
    return { baseRole: 'ground', sourceTag: 'terrain:base_floor' };
  }
  return { baseRole: 'ground', sourceTag: 'terrain:ground' };
}

/**
 * Samples clipped horizontal water meshes in world coordinates to locate the longest
 * river sheet and any waterfall plunge pools, freezing quiet lakes and riverbanks into ice.
 */
function extractWaterFreezeProfileFromScene(root: THREE.Group): WaterFreezeProfile | null {
  const waterMeshes: Array<{ mesh: THREE.Mesh; box: THREE.Box3; span: number; isWaterfall: boolean }> = [];
  const meshBox = new THREE.Box3();
  const meshSize = new THREE.Vector3();

  root.traverse((obj) => {
    if (!isObjectVisibleInTree(obj) || isSkydomeObject(obj)) return;
    const mesh = obj as THREE.Mesh;
    if (!mesh.isMesh || !mesh.geometry || !isWaterMesh(mesh)) return;
    mesh.geometry.computeBoundingBox();
    if (!mesh.geometry.boundingBox) return;
    meshBox.copy(mesh.geometry.boundingBox).applyMatrix4(mesh.matrixWorld);
    meshBox.getSize(meshSize);
    const isWaterfall = getAncestryNames(mesh).some((n) => n.toLowerCase().includes('waterfall'));
    waterMeshes.push({
      mesh,
      box: meshBox.clone(),
      span: Math.max(meshSize.x, meshSize.z),
      isWaterfall
    });
  });

  if (waterMeshes.length === 0) return null;

  let mainRiverMesh: THREE.Mesh | null = null;
  let maxRiverSpan = -1;
  for (const entry of waterMeshes) {
    if (!entry.isWaterfall && entry.span > maxRiverSpan) {
      maxRiverSpan = entry.span;
      mainRiverMesh = entry.mesh;
    }
  }

  const waterfallPools: Array<{ x: number; z: number; radius: number }> = [];
  const waterPoints: Array<{ x: number; z: number; y: number; isMainRiver: boolean }> = [];
  const vTmp = new THREE.Vector3();
  const cTmp = new THREE.Vector3();
  const szTmp = new THREE.Vector3();

  for (const entry of waterMeshes) {
    if (entry.isWaterfall) {
      entry.box.getCenter(cTmp);
      entry.box.getSize(szTmp);
      waterfallPools.push({
        x: cTmp.x,
        z: cTmp.z,
        radius: Math.max(260, Math.min(480, Math.max(szTmp.x, szTmp.z) * 0.7))
      });
      continue;
    }

    const pos = entry.mesh.geometry.attributes.position;
    if (!pos || pos.count === 0) continue;
    const stride = Math.max(1, Math.floor(pos.count / 2400));
    const isMain = entry.mesh === mainRiverMesh;
    for (let i = 0; i < pos.count; i += stride) {
      vTmp.fromBufferAttribute(pos, i).applyMatrix4(entry.mesh.matrixWorld);
      waterPoints.push({
        x: vTmp.x,
        z: vTmp.z,
        y: vTmp.y,
        isMainRiver: isMain
      });
    }
  }

  return buildWaterFreezeProfile(waterPoints, waterfallPools);
}

const stage1EnvTexCache = new Map<string, THREE.Texture>();
let stage1FallbackWhiteTex: THREE.DataTexture | null = null;

function getStage1EnvTexture(url: string): { tex: THREE.Texture; isReal: boolean } {
  const canLoadTex = typeof window !== 'undefined' && typeof Image !== 'undefined';
  if (!canLoadTex) {
    if (!stage1FallbackWhiteTex) {
      stage1FallbackWhiteTex = new THREE.DataTexture(new Uint8Array([255, 255, 255, 255]), 1, 1);
      stage1FallbackWhiteTex.needsUpdate = true;
    }
    return { tex: stage1FallbackWhiteTex, isReal: false };
  }

  let cached = stage1EnvTexCache.get(url);
  if (!cached) {
    const loader = new THREE.TextureLoader();
    cached = loader.load(url);
    cached.wrapS = THREE.RepeatWrapping;
    cached.wrapT = THREE.RepeatWrapping;
    cached.colorSpace = THREE.SRGBColorSpace;
    cached.minFilter = THREE.LinearMipmapLinearFilter;
    cached.magFilter = THREE.LinearFilter;
    cached.anisotropy = 8;
    stage1EnvTexCache.set(url, cached);
  }
  return { tex: cached, isReal: true };
}

/**
 * Injects world-space triplanar real-texture height, slope, and organic detail blending into Soil_03 terrain
 * (thawed soil on low flats, fractured basalt rock on slopes/cliffs, crystalline permafrost/snow on high ridges
 * and shaded slopes, and delicate organic bioluminescent moss veins near riverbanks).
 */
/**
 * Adds faceted crystal plane variation, fine striations, crisp prism edge highlights,
 * and internal luminous core glow to Stage 1 ruby/amethyst crystal formations.
 */
function applyHeroCrystalDetailShader(
  phys: THREE.MeshPhysicalMaterial,
  variant: 'ruby' | 'amethyst'
): void {
  const isRuby = variant === 'ruby';
  phys.customProgramCacheKey = () => `stage1_hero_crystal_v1_${variant}`;
  phys.onBeforeCompile = (shader) => {
    shader.vertexShader = shader.vertexShader
      .replace(
        'void main() {',
        `varying vec3 vHeroCrystalWorldPos;\nvoid main() {`
      )
      .replace(
        '#include <begin_vertex>',
        `#include <begin_vertex>\nvHeroCrystalWorldPos = (modelMatrix * vec4(transformed, 1.0)).xyz;`
      );

    shader.fragmentShader = shader.fragmentShader
      .replace(
        'void main() {',
        `varying vec3 vHeroCrystalWorldPos;

float hcHash3(vec3 p) {
  p = fract(p * vec3(127.1, 311.7, 74.7));
  p += dot(p, p.yxz + 19.19);
  return fract((p.x + p.y) * p.z);
}

float hcNoise3(vec3 p) {
  vec3 i = floor(p);
  vec3 f = fract(p);
  f = f * f * (3.0 - 2.0 * f);
  float n000 = hcHash3(i);
  float n100 = hcHash3(i + vec3(1.0, 0.0, 0.0));
  float n010 = hcHash3(i + vec3(0.0, 1.0, 0.0));
  float n110 = hcHash3(i + vec3(1.0, 1.0, 0.0));
  float n001 = hcHash3(i + vec3(0.0, 0.0, 1.0));
  float n101 = hcHash3(i + vec3(1.0, 0.0, 1.0));
  float n011 = hcHash3(i + vec3(0.0, 1.0, 1.0));
  float n111 = hcHash3(i + vec3(1.0, 1.0, 1.0));
  return mix(
    mix(mix(n000, n100, f.x), mix(n010, n110, f.x), f.y),
    mix(mix(n001, n101, f.x), mix(n011, n111, f.x), f.y),
    f.z
  );
}

void main() {`
      )
      .replace(
        '#include <color_fragment>',
        `#include <color_fragment>
  vec3 hcDpdx = dFdx(vHeroCrystalWorldPos);
  vec3 hcDpdy = dFdy(vHeroCrystalWorldPos);
  vec3 hcCross = cross(hcDpdx, hcDpdy);
  float hcLen = length(hcCross);
  vec3 hcFaceN = hcLen > 1e-5 ? (hcCross / hcLen) : vec3(0.0, 1.0, 0.0);
  if (!gl_FrontFacing) hcFaceN = -hcFaceN;

  vec3 hcViewDir = normalize(cameraPosition - vHeroCrystalWorldPos);
  float hcNdotV = clamp(abs(dot(hcFaceN, hcViewDir)), 0.0, 1.0);
  float hcFacetRand = hcHash3(floor(hcFaceN * 10.0 + vec3(11.3, 19.7, 5.1)));
  float hcFacetShade = mix(0.78, 1.28, hcFacetRand * 0.6 + clamp(dot(hcFaceN, normalize(vec3(0.4, 0.85, -0.35))) * 0.5 + 0.5, 0.0, 1.0) * 0.4);

  // Fine crystalline growth striations & sharp facet edges
  float hcStrCoord = vHeroCrystalWorldPos.y * 0.14 + dot(vHeroCrystalWorldPos.xz, vec2(0.045, -0.035));
  float hcStriation = smoothstep(0.64, 0.96, sin(hcStrCoord + hcFacetRand * 6.2831) * 0.5 + 0.5);
  float hcEdge = clamp(length(fwidth(hcFaceN)) * 1.35 + pow(clamp(1.0 - hcNdotV, 0.0, 1.0), 2.5) * 0.48, 0.0, 1.0);
  float hcCaustic = hcNoise3(vHeroCrystalWorldPos * 0.032 + hcFaceN * 1.8);
  float hcInternalCore = pow(hcNdotV, 1.4) * (0.45 + 0.55 * hcCaustic);

  vec3 hcEdgeTint = ${isRuby ? 'vec3(1.0, 0.68, 0.78)' : 'vec3(0.76, 0.84, 1.0)'};
  diffuseColor.rgb = mix(diffuseColor.rgb * hcFacetShade, hcEdgeTint, clamp(hcEdge * 0.48 + hcStriation * 0.18 + hcInternalCore * 0.28, 0.0, 1.0));`
      )
      .replace(
        '#include <roughnessmap_fragment>',
        `#include <roughnessmap_fragment>
  roughnessFactor = mix(0.11, 0.24, hcFacetRand);`
      )
      .replace(
        '#include <emissivemap_fragment>',
        `#include <emissivemap_fragment>
  vec3 hcCoreCol = ${isRuby ? 'vec3(0.78, 0.12, 0.28)' : 'vec3(0.32, 0.38, 0.88)'};
  totalEmissiveRadiance = max(totalEmissiveRadiance, hcCoreCol * 0.26);
  totalEmissiveRadiance += hcCoreCol * (hcInternalCore * 0.42 + hcFacetRand * 0.12) + hcEdgeTint * (hcEdge * 0.24 + hcStriation * 0.10);`
      );
  };
}

function applyStage1TerrainBlendShader(
  root: THREE.Group,
  opts: { waterLevelY: number; minWorldY: number; maxWorldY: number },
  freezeUniforms?: {
    uFreezeProgress: { value: number };
    uFreezeOriginXZ: { value: THREE.Vector2 };
    uFreezeMaxRadius: { value: number };
  }
): void {
  const localFreezeUniforms = freezeUniforms || {
    uFreezeProgress: { value: 0 },
    uFreezeOriginXZ: { value: new THREE.Vector2(0, 0) },
    uFreezeMaxRadius: { value: 10000 }
  };
  const processedMats = new Set<string>();
  const earthRes = getStage1EnvTexture('/assets/environment/floor_ref_thawed_earth.png');
  const rockRes = getStage1EnvTexture('/assets/environment/floor_ref_rocky_fissure.png');
  const frostRes = getStage1EnvTexture('/assets/environment/Icy%20Alien%20Frostland%20Texture.png');
  const mossRes = getStage1EnvTexture('/assets/environment/floor_ref_organic_moss.png');
  const hasRealTex = earthRes.isReal ? 1.0 : 0.0;

  root.traverse((obj) => {
    if (!isObjectVisibleInTree(obj) || isSkydomeObject(obj)) return;
    const mesh = obj as THREE.Mesh;
    if (!mesh.isMesh || !mesh.geometry) return;
    if (isWaterMesh(mesh) || isTreeObject(mesh) || isShipObject(mesh) || isTowerObject(mesh)) return;
    if (isRedBossCrystalObject(mesh) || isRightCrystalObject(mesh)) return;

    const mats = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
    for (const m of mats) {
      if (!m || !(m as THREE.MeshStandardMaterial).isMeshStandardMaterial) continue;
      const { baseRole, sourceTag } = classifyMeshSource(mesh, m.name || '');
      if (baseRole !== 'ground' || sourceTag !== 'terrain:ground') continue;
      if (processedMats.has(m.uuid)) continue;
      processedMats.add(m.uuid);

      const stdMat = m as THREE.MeshStandardMaterial;
      stdMat.customProgramCacheKey = () => 'stage1_terrain_blend_v3';
      stdMat.onBeforeCompile = (shader) => {
        shader.uniforms.uWaterLevelY = { value: opts.waterLevelY };
        shader.uniforms.uMinY = { value: opts.minWorldY };
        shader.uniforms.uMaxY = { value: opts.maxWorldY };
        shader.uniforms.uHasDetailTex = { value: hasRealTex };
        shader.uniforms.uTexEarth = { value: earthRes.tex };
        shader.uniforms.uTexRock = { value: rockRes.tex };
        shader.uniforms.uTexFrost = { value: frostRes.tex };
        shader.uniforms.uTexMoss = { value: mossRes.tex };
        shader.uniforms.uFreezeProgress = localFreezeUniforms.uFreezeProgress;
        shader.uniforms.uFreezeOriginXZ = localFreezeUniforms.uFreezeOriginXZ;
        shader.uniforms.uFreezeMaxRadius = localFreezeUniforms.uFreezeMaxRadius;

        shader.vertexShader = shader.vertexShader
          .replace(
            'void main() {',
            `varying vec3 vTerrainWorldPos;\nvarying vec3 vTerrainWorldNormal;\nvoid main() {`
          )
          .replace(
            '#include <beginnormal_vertex>',
            `#include <beginnormal_vertex>\nvTerrainWorldNormal = normalize(mat3(modelMatrix) * objectNormal);`
          )
          .replace(
            '#include <begin_vertex>',
            `#include <begin_vertex>\nvTerrainWorldPos = (modelMatrix * vec4(transformed, 1.0)).xyz;`
          );

        shader.fragmentShader = shader.fragmentShader
          .replace(
            'void main() {',
            `uniform float uWaterLevelY;
uniform float uMinY;
uniform float uMaxY;
uniform float uHasDetailTex;
uniform sampler2D uTexEarth;
uniform sampler2D uTexRock;
uniform sampler2D uTexFrost;
uniform sampler2D uTexMoss;
uniform float uFreezeProgress;
uniform vec2 uFreezeOriginXZ;
uniform float uFreezeMaxRadius;
varying vec3 vTerrainWorldPos;
varying vec3 vTerrainWorldNormal;

float tHash21(vec2 p) {
  p = fract(p * vec2(123.34, 456.21));
  p += dot(p, p + 45.32);
  return fract(p.x * p.y);
}

float tNoise2(vec2 p) {
  vec2 i = floor(p);
  vec2 f = fract(p);
  f = f * f * (3.0 - 2.0 * f);
  float a = tHash21(i);
  float b = tHash21(i + vec2(1.0, 0.0));
  float c = tHash21(i + vec2(0.0, 1.0));
  float d = tHash21(i + vec2(1.0, 1.0));
  return mix(mix(a, b, f.x), mix(c, d, f.x), f.y);
}

float tFbm2(vec2 p) {
  float v = 0.0;
  v += 0.62 * tNoise2(p);
  v += 0.38 * tNoise2(p * 2.13 + vec2(11.7, 5.3));
  return v;
}

vec3 tSampleTriplanar(sampler2D tex, vec3 wPos, vec3 triW, float scale) {
  vec2 uvTopA = wPos.xz * scale;
  vec2 uvTopB = (mat2(0.78, -0.62, 0.62, 0.78) * wPos.xz) * (scale * 0.43) + vec2(0.37, 0.71);
  vec3 cY = mix(texture2D(tex, uvTopA).rgb, texture2D(tex, uvTopB).rgb, 0.42);
  vec3 cX = texture2D(tex, wPos.zy * (scale * 0.92)).rgb;
  vec3 cZ = texture2D(tex, wPos.xy * (scale * 0.92)).rgb;
  return cY * triW.y + cX * triW.x + cZ * triW.z;
}

void main() {`
          )
          .replace(
            '#include <map_fragment>',
            `#include <map_fragment>
  vec3 tWN = normalize(vTerrainWorldNormal) * (gl_FrontFacing ? 1.0 : -1.0);
  vec3 tAbsN = abs(tWN);
  vec3 tTriW = pow(tAbsN, vec3(4.0));
  tTriW /= (tTriW.x + tTriW.y + tTriW.z + 0.0001);
  float tUpDot = clamp(tAbsN.y, 0.0, 1.0);
  float tTexLum = dot(diffuseColor.rgb, vec3(0.299, 0.587, 0.114));
  float tDetail = mix(0.80, 1.22, clamp(tTexLum * 1.45, 0.0, 1.0));

  float tNMacro = tFbm2(vTerrainWorldPos.xz * 0.0019);
  float tNMicro = tNoise2(vTerrainWorldPos.xz * 0.016) * 0.60 + tNoise2(vTerrainWorldPos.xz * 0.062) * 0.40;
  float tStrata = sin(vTerrainWorldPos.y * 0.024 + tNMacro * 4.5) * 0.5 + 0.5;

  // 1. Thawed Crater Soil (bright enough under moonlight to show puddles, potholes & trails cleanly)
  vec3 tSoilProc = mix(vec3(0.11, 0.088, 0.076), vec3(0.24, 0.20, 0.175), tNMicro) * tDetail;
  vec3 tSoilCol = tSoilProc;
  if (uHasDetailTex > 0.5) {
    vec3 eTex = tSampleTriplanar(uTexEarth, vTerrainWorldPos, tTriW, 0.0024);
    tSoilCol = eTex * vec3(0.52, 0.48, 0.50) * mix(0.82, 1.18, tNMicro);
  }

  // 2. Exposed Crater Rock (slopes & steep cliff faces via triplanar projection)
  vec3 tRockProc = mix(vec3(0.12, 0.145, 0.195), vec3(0.26, 0.30, 0.38), tStrata * 0.65 + tNMicro * 0.35) * mix(0.85, 1.15, tDetail);
  vec3 tRockCol = tRockProc;
  if (uHasDetailTex > 0.5) {
    vec3 rTex = tSampleTriplanar(uTexRock, vTerrainWorldPos, tTriW, 0.0020);
    tRockCol = rTex * vec3(0.52, 0.58, 0.68) * mix(0.84, 1.16, tStrata * 0.55 + tNMicro * 0.45);
  }
  float tRockMask = smoothstep(0.80, 0.52, tUpDot);

  // 3. Frost & Snow Crust (high ridges, north/shaded faces, and patchy crater drifts)
  float tHeightSnow = smoothstep(880.0, 1460.0, vTerrainWorldPos.y + (tNMacro - 0.5) * 420.0);
  float tShadeBias = smoothstep(-0.05, -0.55, tWN.z) * 0.46 * smoothstep(590.0, 940.0, vTerrainWorldPos.y);
  float tFrostPatch = smoothstep(0.54, 0.76, tNMacro + tNMicro * 0.22) * smoothstep(610.0, 900.0, vTerrainWorldPos.y) * 0.58;
  float tSnowMask = clamp(max(tHeightSnow, max(tShadeBias, tFrostPatch)), 0.0, 1.0) * smoothstep(0.38, 0.68, tUpDot);
  vec3 tSnowCol = mix(vec3(0.36, 0.46, 0.60), vec3(0.64, 0.74, 0.88), tNMicro * 0.6 + 0.4);
  if (uHasDetailTex > 0.5) {
    vec3 fTex = tSampleTriplanar(uTexFrost, vTerrainWorldPos, tTriW, 0.0022);
    tSnowCol = fTex * vec3(0.68, 0.78, 0.92);
  }

  // 4. Delicate Organic Alien Moss Veins along moist riverbanks (sharp filaments, never blurry blotches)
  float tNearWater = smoothstep(uWaterLevelY - 25.0, uWaterLevelY + 25.0, vTerrainWorldPos.y) *
                     (1.0 - smoothstep(uWaterLevelY + 90.0, uWaterLevelY + 220.0, vTerrainWorldPos.y));
  float tPatchNoise = smoothstep(0.55, 0.78, tFbm2(vTerrainWorldPos.xz * 0.0042 + vec2(3.1, 7.4)));
  float tVeinSharp = pow(1.0 - abs(tNoise2(vTerrainWorldPos.xz * 0.022 + vec2(1.7, 4.9)) * 2.0 - 1.0), 3.0);
  vec3 tMossCol = vec3(0.05, 0.16, 0.18);
  if (uHasDetailTex > 0.5) {
    vec3 mTex = texture2D(uTexMoss, vTerrainWorldPos.xz * 0.0028).rgb;
    float mLum = dot(mTex, vec3(0.299, 0.587, 0.114));
    tVeinSharp = smoothstep(0.42, 0.72, mLum);
    tMossCol = mTex * vec3(0.32, 0.62, 0.68);
  }
  float tMossMask = tNearWater * tPatchNoise * tVeinSharp * smoothstep(0.60, 0.84, tUpDot) * (1.0 - tSnowMask * 0.88);

  vec3 tBlended = mix(tSoilCol, tRockCol, tRockMask);
  tBlended = mix(tBlended, tSnowCol, tSnowMask);
  tBlended = mix(tBlended, tMossCol, tMossMask * 0.85);
  float tFreezeDist = length(vTerrainWorldPos.xz - uFreezeOriginXZ);
  float tFreezeFront = uFreezeProgress * uFreezeMaxRadius * 1.15;
  float tFreezeJitter = (tPatchNoise - 0.5) * 340.0;
  float tFreezeWave = clamp(1.0 - smoothstep(tFreezeFront - 560.0, tFreezeFront + 180.0, tFreezeDist + tFreezeJitter), 0.0, 1.0);
  float tFreezeActive = smoothstep(0.0, 0.04, uFreezeProgress) * tFreezeWave;
  float tFreezeBand = exp(-pow((tFreezeDist + tFreezeJitter - tFreezeFront) / 240.0, 2.0)) * smoothstep(0.0, 0.08, uFreezeProgress) * (1.0 - smoothstep(0.88, 1.0, uFreezeProgress));
  vec3 tRefrozenFrost = mix(tSnowCol, tSnowCol * vec3(0.92, 0.98, 1.08) + vec3(0.06, 0.11, 0.17), 0.48);
  tBlended = mix(tBlended, tRefrozenFrost, tFreezeActive * (0.64 + 0.18 * smoothstep(0.35, 0.88, tUpDot)));
  tBlended = mix(tBlended, vec3(0.66, 0.88, 1.0), tFreezeBand * 0.28);
  diffuseColor.rgb = tBlended;`
          )
          .replace(
            '#include <roughnessmap_fragment>',
            `#include <roughnessmap_fragment>
  float tBaseRough = mix(mix(0.88, 0.80, tRockMask), 0.54, tSnowMask);
  roughnessFactor = mix(tBaseRough, 0.38, tFreezeActive * 0.62);`
          )
          .replace(
            '#include <emissivemap_fragment>',
            `#include <emissivemap_fragment>
  totalEmissiveRadiance += vec3(0.030, 0.160, 0.190) * tMossMask * (1.0 - tFreezeActive * 0.45);
  totalEmissiveRadiance += vec3(0.14, 0.36, 0.54) * tFreezeBand * 0.32;`
          );
      };
      stdMat.needsUpdate = true;
    }
  });
}

/**
 * Replaces water materials with a real-textured frozen-ice / open-channel shader driven by
 * the 16-knot WaterFreezeProfile: icy crystal grain & sharp fracture lines on lakes/banks
 * and crisp directional moonlight ripples on the narrow flowing meltwater channel.
 */
function applyFrozenWaterShader(
  root: THREE.Group,
  profile: WaterFreezeProfile | null,
  timeUniform: { value: number },
  freezeUniforms?: {
    uFreezeProgress: { value: number };
    uFreezeOriginXZ: { value: THREE.Vector2 };
    uFreezeMaxRadius: { value: number };
  }
): void {
  const localFreezeUniforms = freezeUniforms || {
    uFreezeProgress: { value: 0 },
    uFreezeOriginXZ: { value: new THREE.Vector2(0, 0) },
    uFreezeMaxRadius: { value: 10000 }
  };
  const centers = new Float32Array(WATER_FREEZE_KNOTS);
  const halfWidths = new Float32Array(WATER_FREEZE_KNOTS);
  if (profile) {
    for (let i = 0; i < WATER_FREEZE_KNOTS; i++) {
      centers[i] = profile.centerSamples[i] ?? 0;
      halfWidths[i] = profile.halfWidthSamples[i] ?? 135;
    }
  } else {
    centers.fill(0);
    halfWidths.fill(99999);
  }

  const pools: THREE.Vector4[] = [];
  for (let i = 0; i < 4; i++) {
    const p = profile?.waterfallPools[i];
    pools.push(p ? new THREE.Vector4(p.x, p.z, p.radius, 1) : new THREE.Vector4(0, 0, 1, 0));
  }

  const frostRes = getStage1EnvTexture('/assets/environment/Icy%20Alien%20Frostland%20Texture.png');

  root.traverse((obj) => {
    if (!isObjectVisibleInTree(obj) || isSkydomeObject(obj)) return;
    const mesh = obj as THREE.Mesh;
    if (!mesh.isMesh || !mesh.geometry || !isWaterMesh(mesh)) return;

    const isWaterfall = getAncestryNames(mesh).some((n) => n.toLowerCase().includes('waterfall'));
    const mat = new THREE.MeshStandardMaterial({
      name: isWaterfall ? 'WaterfallMeltwater' : 'FrozenIceWater',
      color: 0xffffff,
      roughness: 0.28,
      metalness: 0.06,
      transparent: true,
      opacity: 0.94,
      side: THREE.DoubleSide,
      depthWrite: false,
      depthTest: true,
      polygonOffset: true,
      polygonOffsetFactor: -2,
      polygonOffsetUnits: -2
    });

    mat.customProgramCacheKey = () =>
      isWaterfall ? 'stage1_open_waterfall_v3' : 'stage1_frozen_water_v3';

    mat.onBeforeCompile = (shader) => {
      shader.uniforms.uTime = timeUniform;
      shader.uniforms.uAxisIsZ = { value: profile?.axis === 'x' ? 0.0 : 1.0 };
      shader.uniforms.uMinAxis = { value: profile ? profile.minAxis : 0.0 };
      shader.uniforms.uMaxAxis = { value: profile ? profile.maxAxis : 10000.0 };
      shader.uniforms.uCenters = { value: centers };
      shader.uniforms.uHalfWidths = { value: halfWidths };
      shader.uniforms.uPools = { value: pools };
      shader.uniforms.uForceOpen = { value: isWaterfall || !profile ? 1.0 : 0.0 };
      shader.uniforms.uHasIceTex = { value: frostRes.isReal ? 1.0 : 0.0 };
      shader.uniforms.uTexFrost = { value: frostRes.tex };
      shader.uniforms.uFreezeProgress = localFreezeUniforms.uFreezeProgress;
      shader.uniforms.uFreezeOriginXZ = localFreezeUniforms.uFreezeOriginXZ;
      shader.uniforms.uFreezeMaxRadius = localFreezeUniforms.uFreezeMaxRadius;

      shader.vertexShader = shader.vertexShader
        .replace(
          'void main() {',
          `varying vec3 vWaterWorldPos;\nvoid main() {`
        )
        .replace(
          '#include <begin_vertex>',
          `#include <begin_vertex>\nvWaterWorldPos = (modelMatrix * vec4(transformed, 1.0)).xyz;`
        );

      shader.fragmentShader = shader.fragmentShader
        .replace(
          'void main() {',
          `uniform float uTime;
uniform float uAxisIsZ;
uniform float uMinAxis;
uniform float uMaxAxis;
uniform float uCenters[16];
uniform float uHalfWidths[16];
uniform vec4 uPools[4];
uniform float uForceOpen;
uniform float uHasIceTex;
uniform sampler2D uTexFrost;
uniform float uFreezeProgress;
uniform vec2 uFreezeOriginXZ;
uniform float uFreezeMaxRadius;
varying vec3 vWaterWorldPos;

float wHash21(vec2 p) {
  p = fract(p * vec2(127.1, 311.7));
  p += dot(p, p + 34.2);
  return fract(p.x * p.y);
}

float wNoise2(vec2 p) {
  vec2 i = floor(p);
  vec2 f = fract(p);
  f = f * f * (3.0 - 2.0 * f);
  float a = wHash21(i);
  float b = wHash21(i + vec2(1.0, 0.0));
  float c = wHash21(i + vec2(0.0, 1.0));
  float d = wHash21(i + vec2(1.0, 1.0));
  return mix(mix(a, b, f.x), mix(c, d, f.x), f.y);
}

float sampleOpenWaterFactorGLSL(float wx, float wz) {
  if (uForceOpen > 0.5) return 1.0;

  float poolOpen = 0.0;
  for (int i = 0; i < 4; i++) {
    if (uPools[i].w > 0.5) {
      float d = length(vec2(wx - uPools[i].x, wz - uPools[i].y));
      float r = uPools[i].z;
      poolOpen = max(poolOpen, 1.0 - smoothstep(r - 45.0, r + 45.0, d));
    }
  }

  float axisCoord = mix(wx, wz, uAxisIsZ);
  float perpCoord = mix(wz, wx, uAxisIsZ);
  float edgeFade = 0.0;

  if (axisCoord >= uMinAxis - 80.0 && axisCoord <= uMaxAxis + 80.0) {
    float span = max(1.0, uMaxAxis - uMinAxis);
    float u = clamp((axisCoord - uMinAxis) / span, 0.0, 1.0);
    float f = u * 15.0;
    float center = 0.0;
    float halfW = 0.0;
    for (int i = 0; i < 16; i++) {
      float w = max(0.0, 1.0 - abs(f - float(i)));
      center += uCenters[i] * w;
      halfW += uHalfWidths[i] * w;
    }
    float meander = sin(axisCoord * 0.0045) * 28.0 + sin(axisCoord * 0.011 + 1.7) * 14.0;
    float visualEdgeJagged = (wNoise2(vec2(wx, wz) * 0.035) - 0.5) * 16.0;
    float dist = abs(perpCoord - (center + meander)) + visualEdgeJagged;
    edgeFade = 1.0 - smoothstep(halfW - 22.0, halfW + 22.0, dist);
  }

  return max(poolOpen, edgeFade);
}

void main() {`
        )
        .replace(
          '#include <map_fragment>',
          `#include <map_fragment>
  float wOpenMask = sampleOpenWaterFactorGLSL(vWaterWorldPos.x, vWaterWorldPos.z);

  // Real-texture crystalline glacier ice sheet with crisp fracture fissures
  float wFrostNoise = wNoise2(vWaterWorldPos.xz * 0.018);
  float wCrackLine = pow(1.0 - abs(wNoise2(vWaterWorldPos.xz * 0.015 + vec2(1.4, -2.9)) * 2.0 - 1.0), 6.0);
  vec3 wIceCol = mix(vec3(0.28, 0.44, 0.60), vec3(0.56, 0.72, 0.86), wFrostNoise);
  if (uHasIceTex > 0.5) {
    vec2 iUvA = vWaterWorldPos.xz * 0.0026;
    vec2 iUvB = (mat2(0.80, -0.60, 0.60, 0.80) * vWaterWorldPos.xz) * 0.0011;
    vec3 iTex = mix(texture2D(uTexFrost, iUvA).rgb, texture2D(uTexFrost, iUvB).rgb, 0.45);
    wIceCol = iTex * vec3(0.68, 0.82, 0.96);
  }
  wIceCol = mix(wIceCol, vec3(0.18, 0.30, 0.44), wCrackLine * 0.42);

  // Crisp fractured ice shelf rim where frozen surface meets flowing channel
  float wRim = smoothstep(0.22, 0.46, wOpenMask) * (1.0 - smoothstep(0.46, 0.70, wOpenMask));
  wIceCol = mix(wIceCol, vec3(0.72, 0.86, 0.96), wRim * 0.65);

  // Flowing dark cold meltwater channel with crisp directional ripple streaks
  vec2 flowCoord = mix(vec2(vWaterWorldPos.x - uTime * 78.0, vWaterWorldPos.z), vec2(vWaterWorldPos.x, vWaterWorldPos.z - uTime * 78.0), uAxisIsZ);
  float wStreakA = wNoise2(flowCoord * vec2(0.045, 0.014));
  float wStreakB = wNoise2(flowCoord * vec2(0.085, 0.024) + vec2(3.7, -uTime * 1.6));
  float wRipple = clamp(wStreakA * 0.58 + wStreakB * 0.42, 0.0, 1.0);
  float wCrest = smoothstep(0.70, 0.92, wRipple);
  vec3 wOpenCol = mix(vec3(0.018, 0.055, 0.095), vec3(0.045, 0.130, 0.200), wRipple) + vec3(0.07, 0.19, 0.26) * wCrest;

  diffuseColor.rgb = mix(wIceCol, wOpenCol, wOpenMask);
  float wFreezeDist = length(vWaterWorldPos.xz - uFreezeOriginXZ);
  float wFreezeFront = uFreezeProgress * uFreezeMaxRadius * 1.15;
  float wFreezeJitter = (wFrostNoise - 0.5) * 260.0;
  float wFreezeWave = clamp(1.0 - smoothstep(wFreezeFront - 500.0, wFreezeFront + 160.0, wFreezeDist + wFreezeJitter), 0.0, 1.0);
  float wFreezeActive = smoothstep(0.0, 0.04, uFreezeProgress) * wFreezeWave;
  float wFreezeBand = exp(-pow((wFreezeDist + wFreezeJitter - wFreezeFront) / 210.0, 2.0)) * smoothstep(0.0, 0.08, uFreezeProgress) * (1.0 - smoothstep(0.88, 1.0, uFreezeProgress));
  float wEffOpen = wOpenMask * mix(1.0, 1.0 - wFreezeActive * 0.90, 1.0 - uForceOpen * 0.72);
  vec3 wRefrozenIce = mix(wIceCol, vec3(0.68, 0.86, 0.98), wFreezeActive * 0.34) + vec3(0.18, 0.34, 0.48) * wFreezeBand;
  diffuseColor.rgb = mix(wRefrozenIce, wOpenCol, wEffOpen);
  diffuseColor.a = mix(0.95, 0.86, wEffOpen);`
        )
        .replace(
          '#include <roughnessmap_fragment>',
          `#include <roughnessmap_fragment>
  float wIceRough = mix(0.22, 0.46, wFrostNoise);
  roughnessFactor = mix(wIceRough, 0.14, wEffOpen);`
        )
        .replace(
          '#include <emissivemap_fragment>',
          `#include <emissivemap_fragment>
  vec3 wIceGlow = vec3(0.065, 0.110, 0.165) * (1.0 - wEffOpen) + vec3(0.09, 0.24, 0.38) * wFreezeBand;
  vec3 wChannelGlow = vec3(0.025, 0.110, 0.155) * wCrest * wEffOpen;
  totalEmissiveRadiance += wIceGlow + wChannelGlow;`
        );
    };

    mat.needsUpdate = true;
    mesh.material = mat;
    mesh.receiveShadow = false;
    mesh.renderOrder = 2;
  });
}

/**
 * Transforms the First Artifact Tower from plain grey concrete into an ancient weathered
 * Overseer monument etched with upward-pulsing cyan-gold glyph seams and spiral step guide lines.
 */
function applyOverseerTowerShader(
  root: THREE.Group,
  timeUniform: { value: number },
  towerCenterXZ: { x: number; z: number },
  freezeUniforms?: {
    uFreezeProgress: { value: number };
    uFreezeOriginXZ: { value: THREE.Vector2 };
    uFreezeMaxRadius: { value: number };
  }
): void {
  const localFreezeUniforms = freezeUniforms || {
    uFreezeProgress: { value: 0 },
    uFreezeOriginXZ: { value: new THREE.Vector2(towerCenterXZ.x, towerCenterXZ.z) },
    uFreezeMaxRadius: { value: 10000 }
  };
  const processedMats = new Set<string>();
  const rockRes = getStage1EnvTexture('/assets/environment/floor_ref_rocky_fissure.png');
  const frostRes = getStage1EnvTexture('/assets/environment/Icy%20Alien%20Frostland%20Texture.png');
  const mossRes = getStage1EnvTexture('/assets/environment/floor_ref_organic_moss.png');
  const hasDetailTex = rockRes.isReal ? 1.0 : 0.0;

  root.traverse((obj) => {
    if (!isObjectVisibleInTree(obj) || isSkydomeObject(obj)) return;
    const mesh = obj as THREE.Mesh;
    if (!mesh.isMesh || !mesh.geometry || !isTowerObject(mesh)) return;

    const mats = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
    for (const m of mats) {
      if (!m || !(m as THREE.MeshStandardMaterial).isMeshStandardMaterial) continue;
      if (processedMats.has(m.uuid)) continue;
      processedMats.add(m.uuid);

      const stdMat = m as THREE.MeshStandardMaterial;
      const matLow = (stdMat.name || '').toLowerCase();
      const isWalkway = matLow.includes('asphalt');

      stdMat.customProgramCacheKey = () =>
        isWalkway ? 'stage1_tower_walkway_v3' : 'stage1_tower_stone_v3';

      stdMat.onBeforeCompile = (shader) => {
        shader.uniforms.uTime = timeUniform;
        shader.uniforms.uTowerCenterXZ = { value: new THREE.Vector2(towerCenterXZ.x, towerCenterXZ.z) };
        shader.uniforms.uIsWalkway = { value: isWalkway ? 1.0 : 0.0 };
        shader.uniforms.uHasDetailTex = { value: hasDetailTex };
        shader.uniforms.uTexRock = { value: rockRes.tex };
        shader.uniforms.uTexFrost = { value: frostRes.tex };
        shader.uniforms.uTexMoss = { value: mossRes.tex };
        shader.uniforms.uFreezeProgress = localFreezeUniforms.uFreezeProgress;
        shader.uniforms.uFreezeOriginXZ = localFreezeUniforms.uFreezeOriginXZ;
        shader.uniforms.uFreezeMaxRadius = localFreezeUniforms.uFreezeMaxRadius;

        shader.vertexShader = shader.vertexShader
          .replace(
            'void main() {',
            `varying vec3 vTowerWorldPos;\nvarying vec3 vTowerWorldNormal;\nvoid main() {`
          )
          .replace(
            '#include <beginnormal_vertex>',
            `#include <beginnormal_vertex>\nvTowerWorldNormal = normalize(mat3(modelMatrix) * objectNormal);`
          )
          .replace(
            '#include <begin_vertex>',
            `#include <begin_vertex>\nvTowerWorldPos = (modelMatrix * vec4(transformed, 1.0)).xyz;`
          );

        shader.fragmentShader = shader.fragmentShader
          .replace(
            'void main() {',
            `uniform float uTime;
uniform vec2 uTowerCenterXZ;
uniform float uIsWalkway;
uniform float uHasDetailTex;
uniform sampler2D uTexRock;
uniform sampler2D uTexFrost;
uniform sampler2D uTexMoss;
uniform float uFreezeProgress;
uniform vec2 uFreezeOriginXZ;
uniform float uFreezeMaxRadius;
varying vec3 vTowerWorldPos;
varying vec3 vTowerWorldNormal;

float twHash3(vec3 p) {
  p = fract(p * vec3(0.1031, 0.1030, 0.0973));
  p += dot(p, p.yxz + 33.33);
  return fract((p.x + p.y) * p.z);
}

float twNoise3(vec3 p) {
  vec3 i = floor(p);
  vec3 f = fract(p);
  f = f * f * (3.0 - 2.0 * f);
  float n000 = twHash3(i + vec3(0.0, 0.0, 0.0));
  float n100 = twHash3(i + vec3(1.0, 0.0, 0.0));
  float n010 = twHash3(i + vec3(0.0, 1.0, 0.0));
  float n110 = twHash3(i + vec3(1.0, 1.0, 0.0));
  float n001 = twHash3(i + vec3(0.0, 0.0, 1.0));
  float n101 = twHash3(i + vec3(1.0, 0.0, 1.0));
  float n011 = twHash3(i + vec3(0.0, 1.0, 1.0));
  float n111 = twHash3(i + vec3(1.0, 1.0, 1.0));
  float nx00 = mix(n000, n100, f.x);
  float nx10 = mix(n010, n110, f.x);
  float nx01 = mix(n001, n101, f.x);
  float nx11 = mix(n011, n111, f.x);
  return mix(mix(nx00, nx10, f.y), mix(nx01, nx11, f.y), f.z);
}

float twFbm(vec3 p) {
  float v = 0.55 * twNoise3(p);
  v += 0.30 * twNoise3(p * 2.13 + vec3(11.7, 5.3, 19.1));
  v += 0.15 * twNoise3(p * 4.41 + vec3(3.1, 17.4, 7.9));
  return v;
}

vec3 twTriplanar(sampler2D tex, vec3 wp, vec3 wn, float sc) {
  vec3 bw = abs(wn);
  bw = pow(bw, vec3(3.0));
  bw /= max(bw.x + bw.y + bw.z, 0.0001);
  vec3 cx = texture2D(tex, wp.zy * sc).rgb;
  vec3 cy = texture2D(tex, wp.xz * sc).rgb;
  vec3 cz = texture2D(tex, wp.xy * sc).rgb;
  return cx * bw.x + cy * bw.y + cz * bw.z;
}

void main() {`
          )
          .replace(
            '#include <map_fragment>',
            `#include <map_fragment>
  vec3 twMapN = normalize(vTowerWorldNormal) * (gl_FrontFacing ? 1.0 : -1.0);
  float twMacro = twFbm(vTowerWorldPos * 0.0031);
  float twMicro = twFbm(vTowerWorldPos * 0.015 + vec3(twMacro * 1.4));
  vec3 twRockSample = uHasDetailTex > 0.5
    ? mix(twTriplanar(uTexRock, vTowerWorldPos, twMapN, 0.0042), twTriplanar(uTexRock, vTowerWorldPos + vec3(47.0), twMapN, 0.0125), 0.45)
    : vec3(mix(0.65, 1.25, twMicro));
  float twRockLuma = dot(twRockSample, vec3(0.299, 0.587, 0.114));

  vec3 twCarvedSlate = uIsWalkway > 0.5
    ? vec3(0.095, 0.112, 0.145) * mix(0.70, 1.25, twRockLuma) * mix(0.84, 1.18, twMacro)
    : vec3(0.145, 0.165, 0.205) * mix(0.66, 1.32, twRockLuma) * mix(0.78, 1.22, twMacro);

  // Ancient moss staining near lower base and snow/frost patina on upper weathered ledges
  float twBaseWet = (1.0 - smoothstep(420.0, 1080.0, vTowerWorldPos.y)) * smoothstep(0.25, 0.78, twMacro);
  vec3 twMossTex = uHasDetailTex > 0.5 ? twTriplanar(uTexMoss, vTowerWorldPos, twMapN, 0.0068) : vec3(0.08, 0.14, 0.12);
  twCarvedSlate = mix(twCarvedSlate, twMossTex * vec3(0.32, 0.46, 0.40), twBaseWet * 0.55);

  float twUpSlope = smoothstep(0.35, 0.88, twMapN.y);
  float twAltFrost = smoothstep(1600.0, 3850.0, vTowerWorldPos.y) * 0.45 + 0.55;
  float twFrostMask = clamp(twUpSlope * twAltFrost * smoothstep(0.36, 0.76, twMacro + twMicro * 0.28), 0.0, 0.72);
  vec3 twFrostTex = uHasDetailTex > 0.5 ? twTriplanar(uTexFrost, vTowerWorldPos, twMapN, 0.0055) : vec3(0.55, 0.65, 0.78);
  vec3 twBaseCol = mix(twCarvedSlate, twFrostTex * vec3(0.52, 0.62, 0.76), twFrostMask);
  float twFreezeDist = length(vTowerWorldPos.xz - uFreezeOriginXZ);
  float twFreezeFront = uFreezeProgress * uFreezeMaxRadius * 1.15;
  float twFreezeWave = smoothstep(0.0, 0.04, uFreezeProgress) * clamp(1.0 - smoothstep(twFreezeFront - 520.0, twFreezeFront + 180.0, twFreezeDist), 0.0, 1.0);
  diffuseColor.rgb = mix(twBaseCol, twFrostTex * vec3(0.68, 0.80, 0.94), twFreezeWave * 0.34);`
          )
          .replace(
            '#include <emissivemap_fragment>',
            `#include <emissivemap_fragment>
  vec3 twEmN = normalize(vTowerWorldNormal) * (gl_FrontFacing ? 1.0 : -1.0);
  vec3 twWarp = vec3(
    twFbm(vTowerWorldPos * 0.0036 + vec3(3.7, 1.2, 9.4)),
    twFbm(vTowerWorldPos * 0.0036 + vec3(14.1, 7.8, 2.5)),
    twFbm(vTowerWorldPos * 0.0036 + vec3(6.3, 19.2, 5.1))
  );
  // Organic meandering mineral hairline fractures in ancient monolith rock (zero geometric grid lines)
  float twVeinField = twFbm(vTowerWorldPos * 0.0052 + twWarp * 2.25);
  float twHairlineVein = smoothstep(0.024, 0.0, abs(twVeinField - 0.52)) * smoothstep(0.45, 0.85, twWarp.y);
  float twPulse = 0.68 + 0.32 * sin(uTime * 1.4 + twWarp.x * 6.2831853);
  float twSummitAura = smoothstep(3940.0, 4080.0, vTowerWorldPos.y) * smoothstep(0.75, 0.15, abs(twEmN.y));
  vec3 twVeinCol = mix(vec3(0.05, 0.28, 0.36), vec3(0.28, 0.24, 0.12), twWarp.z);
  float twContainmentActive = smoothstep(0.0, 0.08, uFreezeProgress);
  totalEmissiveRadiance += twVeinCol * (twHairlineVein * 0.34 + twSummitAura * 0.42) * twPulse;
  totalEmissiveRadiance += vec3(0.16, 0.58, 0.88) * twContainmentActive * (0.14 + twSummitAura * 0.22);`
          );
      };
      stdMat.needsUpdate = true;
    }
  });
}

/**
 * Non-destructively widens the exterior spiral steps and step risers of the First Artifact Tower
 * at runtime before collider generation, preserving the gray stone material aesthetic, vertical
 * spiral progression, inner core cylinder, and summit teleporter circle.
 */
function widenArtifactTowerSteps(root: THREE.Object3D): void {
  const towerMeshes: Array<{ mesh: THREE.Mesh; isWalkway: boolean }> = [];
  const towerBox = new THREE.Box3();
  const v = new THREE.Vector3();

  root.traverse((obj) => {
    if (!isObjectVisibleInTree(obj) || isSkydomeObject(obj)) return;
    const mesh = obj as THREE.Mesh;
    if (!mesh.isMesh || !mesh.geometry || !isTowerObject(mesh)) return;
    const mats = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
    const isWalkway = mats.some((m) => (m?.name || '').toLowerCase().includes('asphalt'));
    towerMeshes.push({ mesh, isWalkway });
    mesh.geometry.computeBoundingBox();
    if (mesh.geometry.boundingBox) {
      towerBox.union(mesh.geometry.boundingBox.clone().applyMatrix4(mesh.matrixWorld));
    }
  });

  if (towerMeshes.length === 0 || towerBox.isEmpty()) return;

  const tcX = (towerBox.min.x + towerBox.max.x) * 0.5;
  const tcZ = (towerBox.min.z + towerBox.max.z) * 0.5;
  const tMinY = towerBox.min.y;
  const tMaxY = towerBox.max.y;
  const heightSpan = Math.max(100, tMaxY - tMinY);
  const SLICE_COUNT = 48;
  const sliceHeight = heightSpan / SLICE_COUNT;

  const walkwayRadiiBySlice: number[][] = Array.from({ length: SLICE_COUNT }, () => []);

  for (const entry of towerMeshes) {
    if (!entry.isWalkway) continue;
    const pos = entry.mesh.geometry.attributes.position as THREE.BufferAttribute | undefined;
    if (!pos) continue;
    for (let i = 0; i < pos.count; i++) {
      v.fromBufferAttribute(pos, i).applyMatrix4(entry.mesh.matrixWorld);
      const r = Math.hypot(v.x - tcX, v.z - tcZ);
      const s = Math.max(0, Math.min(SLICE_COUNT - 1, Math.floor((v.y - tMinY) / sliceHeight)));
      walkwayRadiiBySlice[s].push(r);
    }
  }

  const rawInnerR = new Float32Array(SLICE_COUNT);
  rawInnerR.fill(Infinity);
  for (let s = 0; s < SLICE_COUNT; s++) {
    const arr = walkwayRadiiBySlice[s];
    if (arr.length === 0) continue;
    arr.sort((a, b) => a - b);
    const pIdx = Math.min(arr.length - 1, Math.floor(arr.length * 0.08));
    rawInnerR[s] = arr[pIdx];
  }

  const sliceInnerR = new Float32Array(SLICE_COUNT);
  let lastKnownR = 540;
  for (let s = 0; s < SLICE_COUNT; s++) {
    if (Number.isFinite(rawInnerR[s])) {
      lastKnownR = rawInnerR[s];
      sliceInnerR[s] = lastKnownR;
    } else {
      let nextKnownR = lastKnownR;
      for (let k = s + 1; k < SLICE_COUNT; k++) {
        if (Number.isFinite(rawInnerR[k])) {
          nextKnownR = rawInnerR[k];
          break;
        }
      }
      sliceInnerR[s] = Math.min(lastKnownR, nextKnownR);
    }
  }

  const smoothstep01 = (x: number): number => {
    const t = Math.max(0, Math.min(1, x));
    return t * t * (3 - 2 * t);
  };

  const sampleInnerRadius = (wy: number): number => {
    const f = Math.max(0, Math.min(SLICE_COUNT - 1, (wy - tMinY) / sliceHeight - 0.5));
    const i0 = Math.floor(f);
    const i1 = Math.min(SLICE_COUNT - 1, i0 + 1);
    const alpha = f - i0;
    return sliceInnerR[i0] * (1 - alpha) + sliceInnerR[i1] * alpha;
  };

  const EXPANSION_FACTOR = 0.65;
  const CONSTANT_PIVOT_R = 300;
  const invMat = new THREE.Matrix4();

  for (const entry of towerMeshes) {
    const geo = entry.mesh.geometry as THREE.BufferGeometry;
    const pos = geo.attributes.position as THREE.BufferAttribute | undefined;
    if (!pos) continue;
    invMat.copy(entry.mesh.matrixWorld).invert();

    for (let i = 0; i < pos.count; i++) {
      v.fromBufferAttribute(pos, i).applyMatrix4(entry.mesh.matrixWorld);
      const dx = v.x - tcX;
      const dz = v.z - tcZ;
      const r = Math.hypot(dx, dz);
      if (r <= CONSTANT_PIVOT_R) continue;

      // Preserve the sub-ground base roots and taper smoothly back into the original Summit circle.
      // Using a height-invariant CONSTANT_PIVOT_R ensures vertical walls remain strictly vertical without leaning over steps.
      const bottomEnv = smoothstep01((v.y - (tMinY - 10)) / 70);
      const topEnv = 1 - smoothstep01((v.y - (tMaxY - 150)) / 95);
      const env = bottomEnv * topEnv;
      if (env <= 1e-4) continue;

      const rExpanded = r + (r - CONSTANT_PIVOT_R) * EXPANSION_FACTOR * env;
      const scale = rExpanded / r;
      v.x = tcX + dx * scale;
      v.z = tcZ + dz * scale;
      v.applyMatrix4(invMat);
      pos.setXYZ(i, v.x, v.y, v.z);
    }

    pos.needsUpdate = true;
    smoothSplitVertexNormals(geo, 48, true);
    geo.computeBoundingBox();
    geo.computeBoundingSphere();
  }
}

/**
 * Clips overflowing river water meshes cleanly inside the authored rocky map boundaries
 * so no water plane protrudes past the borders into empty space.
 */
function clipWaterMeshesToBounds(
  root: THREE.Group,
  bounds: { minX: number; maxX: number; minZ: number; maxZ: number }
): void {
  const clipPoly = (poly: number[][], axis: 'x' | 'z', val: number, keepGreater: boolean): number[][] => {
    const out: number[][] = [];
    if (poly.length === 0) return out;
    const coordIdx = axis === 'x' ? 0 : 2;
    const isInside = (pt: number[]) => (keepGreater ? pt[coordIdx] >= val : pt[coordIdx] <= val);
    const intersect = (a: number[], b: number[]): number[] => {
      const da = a[coordIdx] - val;
      const db = b[coordIdx] - val;
      const t = da / (da - db || 1e-6);
      const res: number[] = [];
      for (let k = 0; k < a.length; k++) {
        res.push(a[k] + (b[k] - a[k]) * t);
      }
      return res;
    };

    for (let i = 0; i < poly.length; i++) {
      const cur = poly[i];
      const prev = poly[(i + poly.length - 1) % poly.length];
      const curIn = isInside(cur);
      const prevIn = isInside(prev);
      if (curIn) {
        if (!prevIn) out.push(intersect(prev, cur));
        out.push(cur);
      } else if (prevIn) {
        out.push(intersect(prev, cur));
      }
    }
    return out;
  };

  root.traverse((obj) => {
    const mesh = obj as THREE.Mesh;
    if (!mesh.isMesh || !mesh.geometry || !isWaterMesh(mesh)) return;
    if (getAncestryNames(mesh).some((n) => n.toLowerCase().includes('waterfall'))) return;

    const geo = mesh.geometry as THREE.BufferGeometry;
    const pos = geo.attributes.position;
    if (!pos) return;
    geo.computeBoundingBox();
    if (!geo.boundingBox) return;

    const worldBox = geo.boundingBox.clone().applyMatrix4(mesh.matrixWorld);
    if (
      worldBox.min.x >= bounds.minX &&
      worldBox.max.x <= bounds.maxX &&
      worldBox.min.z >= bounds.minZ &&
      worldBox.max.z <= bounds.maxZ
    ) {
      return;
    }

    const uv = geo.attributes.uv;
    const norm = geo.attributes.normal;
    const idx = geo.index;
    const triCount = idx ? Math.floor(idx.count / 3) : Math.floor(pos.count / 3);
    const invMat = mesh.matrixWorld.clone().invert();

    const newPos: number[] = [];
    const newNorm: number[] = [];
    const newUv: number[] = [];
    const tmpV = new THREE.Vector3();

    const readV = (vi: number): number[] => {
      tmpV.fromBufferAttribute(pos, vi).applyMatrix4(mesh.matrixWorld);
      const u = uv ? uv.getX(vi) : 0;
      const v = uv ? uv.getY(vi) : 0;
      const nx = norm ? norm.getX(vi) : 0;
      const ny = norm ? norm.getY(vi) : 1;
      const nz = norm ? norm.getZ(vi) : 0;
      return [tmpV.x, tmpV.y, tmpV.z, u, v, nx, ny, nz];
    };

    for (let t = 0; t < triCount; t++) {
      const i0 = idx ? idx.getX(t * 3) : t * 3;
      const i1 = idx ? idx.getX(t * 3 + 1) : t * 3 + 1;
      const i2 = idx ? idx.getX(t * 3 + 2) : t * 3 + 2;

      let poly = [readV(i0), readV(i1), readV(i2)];
      poly = clipPoly(poly, 'x', bounds.minX, true);
      poly = clipPoly(poly, 'x', bounds.maxX, false);
      poly = clipPoly(poly, 'z', bounds.minZ, true);
      poly = clipPoly(poly, 'z', bounds.maxZ, false);
      if (poly.length < 3) continue;

      for (let k = 1; k < poly.length - 1; k++) {
        const triVerts = [poly[0], poly[k], poly[k + 1]];
        for (const tv of triVerts) {
          tmpV.set(tv[0], tv[1], tv[2]).applyMatrix4(invMat);
          newPos.push(tmpV.x, tmpV.y, tmpV.z);
          newUv.push(tv[3], tv[4]);
          newNorm.push(tv[5], tv[6], tv[7]);
        }
      }
    }

    const clippedGeo = new THREE.BufferGeometry();
    clippedGeo.setAttribute('position', new THREE.Float32BufferAttribute(newPos, 3));
    if (norm) clippedGeo.setAttribute('normal', new THREE.Float32BufferAttribute(newNorm, 3));
    if (uv) clippedGeo.setAttribute('uv', new THREE.Float32BufferAttribute(newUv, 2));
    clippedGeo.computeBoundingBox();
    clippedGeo.computeBoundingSphere();
    mesh.geometry.dispose();
    mesh.geometry = clippedGeo;
  });
}

function buildMeshColliderAndFallbackGrid(
  root: THREE.Group,
  worldWidth: number,
  worldHeight: number,
  clipBounds: { minX: number; maxX: number; minZ: number; maxZ: number },
  hasBaseFloor: boolean = false,
  hasSculptedSoil03: boolean = false,
  seaLevelWorldY: number = 10,
  waterFreezeProfile: WaterFreezeProfile | null = null
): {
  collider: MeshTerrainCollider;
  heightGrid: Float32Array;
  minHeight: number;
  maxHeight: number;
} {
  const triangles: ColliderTri[] = [];
  const vA = new THREE.Vector3();
  const vB = new THREE.Vector3();
  const vC = new THREE.Vector3();
  const e1 = new THREE.Vector3();
  const e2 = new THREE.Vector3();
  const nrm = new THREE.Vector3();
  const meshBox = new THREE.Box3();
  const meshSize = new THREE.Vector3();

  let minH = Infinity;
  let maxH = -Infinity;
  let baseFloorBox: THREE.Box3 | null = null;
  let baseFloorWorldY = 10;
  let towerWorldBox: THREE.Box3 | null = null;
  let hasTowerWalkway = false;

  // Pre-pass: locate Soil_04 base floor plane and First Artifact Tower bounds before classifying triangles
  root.traverse((obj) => {
    if (!isObjectVisibleInTree(obj) || isSkydomeObject(obj)) return;
    const mesh = obj as THREE.Mesh;
    if (!mesh.isMesh || !mesh.geometry) return;
    const mats = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
    for (let m = 0; m < mats.length; m++) {
      const matName = mats[m]?.name || '';
      const { baseRole, sourceTag } = classifyMeshSource(mesh, matName);
      if (sourceTag === 'terrain:base_floor') {
        mesh.geometry.computeBoundingBox();
        if (mesh.geometry.boundingBox) {
          meshBox.copy(mesh.geometry.boundingBox).applyMatrix4(mesh.matrixWorld);
          baseFloorBox = baseFloorBox ? baseFloorBox.union(meshBox.clone()) : meshBox.clone();
          baseFloorWorldY = meshBox.max.y;
        }
      } else if (baseRole === 'tower') {
        if (sourceTag === 'node:tower_walkway') hasTowerWalkway = true;
        mesh.geometry.computeBoundingBox();
        if (mesh.geometry.boundingBox) {
          meshBox.copy(mesh.geometry.boundingBox).applyMatrix4(mesh.matrixWorld);
          towerWorldBox = towerWorldBox ? towerWorldBox.union(meshBox.clone()) : meshBox.clone();
        }
      }
    }
  });

  const towerCenter = towerWorldBox
    ? {
        x: ((towerWorldBox as THREE.Box3).min.x + (towerWorldBox as THREE.Box3).max.x) * 0.5,
        z: ((towerWorldBox as THREE.Box3).min.z + (towerWorldBox as THREE.Box3).max.z) * 0.5,
        minY: (towerWorldBox as THREE.Box3).min.y,
        maxY: (towerWorldBox as THREE.Box3).max.y
      }
    : null;

  root.traverse((obj) => {
    if (!isObjectVisibleInTree(obj) || isSkydomeObject(obj)) return;
    const mesh = obj as THREE.Mesh;
    if (!mesh.isMesh || !mesh.geometry) return;

    const geo = mesh.geometry as THREE.BufferGeometry;
    const pos = geo.attributes.position;
    if (!pos) return;

    const mats = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
    const matName = mats[0]?.name || '';
    const { baseRole, sourceTag } = classifyMeshSource(mesh, matName);

    // Trees are completely non-solid and pass-through
    if (baseRole === 'tree' || sourceTag === 'terrain:base_floor') return;

    geo.computeBoundingBox();
    if (geo.boundingBox) {
      meshBox.copy(geo.boundingBox).applyMatrix4(mesh.matrixWorld);
      meshBox.getSize(meshSize);

      // Skip tiny decorative ship trim/windows/bolts so ship collider stays lightweight & fast
      if (baseRole === 'ship' && meshSize.length() < 26) {
        return;
      }

      // Skip decorative golden arch hoop on top of First Artifact Tower
      if (
        baseRole === 'tower' &&
        (matName.toLowerCase().includes('metal_perforated') ||
          (meshSize.x < 18 && meshBox.min.y > (towerCenter ? towerCenter.maxY - 600 : 950)))
      ) {
        return;
      }
    }

    const mat = mesh.matrixWorld;
    const idx = geo.index;
    const groups = geo.groups && geo.groups.length > 0
      ? geo.groups
      : [{ start: 0, count: idx ? idx.count : pos.count, materialIndex: 0 }];

    for (const grp of groups) {
      const grpMatName = mats[grp.materialIndex ?? 0]?.name || matName;
      const grpInfo = classifyMeshSource(mesh, grpMatName);
      if (grpInfo.baseRole === 'tree' || grpInfo.sourceTag === 'terrain:base_floor') continue;

      const triStart = Math.floor(grp.start / 3);
      const triEnd = triStart + Math.floor(grp.count / 3);

      for (let t = triStart; t < triEnd; t++) {
        const i0 = idx ? idx.getX(t * 3) : t * 3;
        const i1 = idx ? idx.getX(t * 3 + 1) : t * 3 + 1;
        const i2 = idx ? idx.getX(t * 3 + 2) : t * 3 + 2;

        vA.fromBufferAttribute(pos, i0).applyMatrix4(mat);
        vB.fromBufferAttribute(pos, i1).applyMatrix4(mat);
        vC.fromBufferAttribute(pos, i2).applyMatrix4(mat);

        // When a flat Soil_04 base floor plane exists at Y=10, cull only triangles that are 100% below the base floor.
        if (hasBaseFloor && grpInfo.sourceTag === 'terrain:ground') {
          const rawMaxY = Math.max(vA.y, vB.y, vC.y);
          if (rawMaxY <= baseFloorWorldY + 0.2) {
            continue;
          }
        }

        e1.subVectors(vB, vA);
        e2.subVectors(vC, vA);
        nrm.crossVectors(e1, e2);
        const len = nrm.length();
        if (len < 1e-4) continue;
        nrm.divideScalar(len);

        // Ensure normal points consistently outward/upward for horizontal checks
        const nyAbs = Math.abs(nrm.y);
        const minX = Math.min(vA.x, vB.x, vC.x);
        const maxX = Math.max(vA.x, vB.x, vC.x);
        const minY = Math.min(vA.y, vB.y, vC.y);
        const maxY = Math.max(vA.y, vB.y, vC.y);
        const minZ = Math.min(vA.z, vB.z, vC.z);
        const maxZ = Math.max(vA.z, vB.z, vC.z);

        let category: TerrainSurfaceCategory;
        const triCx = (vA.x + vB.x + vC.x) / 3;
        const triCz = (vA.z + vB.z + vC.z) / 3;
        const distFromTower = towerCenter ? Math.hypot(triCx - towerCenter.x, triCz - towerCenter.z) : Infinity;

        if (grpInfo.baseRole === 'solid_obstacle') {
          category = 'solid_obstacle';
        } else if (grpInfo.baseRole === 'water') {
          // Vertical waterfall curtains act as solid blocking walls; horizontal water stays traversable water
          category = nyAbs >= 0.45 ? 'water' : 'cliff';
        } else if (grpInfo.baseRole === 'bridge') {
          // Every solid surface of every bridge is walkable so bridges are 100% climbable without holes
          category = 'bridge';
        } else if (grpInfo.baseRole === 'waterfall_rock') {
          // Every solid surface of rocks/stepping stones is walkable without holes
          category = 'waterfall_rock';
        } else if (grpInfo.baseRole === 'tower') {
          if (grpInfo.sourceTag === 'node:tower_walkway') {
            // Exterior Asphalt spiral walkway: accept both normal and inverted-winding treads/ramps so no stair drops through
            category = nyAbs >= 0.08 ? 'tower_ledge' : 'cliff';
          } else if (hasTowerWalkway && towerCenter) {
            // Tower concrete walls & interior core below the summit remain non-walkable;
            // allow the summit deck (where Teleporter sits) and all exterior spiral concrete steps/landings
            // (including sloped ny >= 0.32 treads and flipped-winding exterior steps strictly outside the hollow shaft).
            const isSummitDeck = minY >= towerCenter.maxY - 220 && nyAbs >= 0.35 && nrm.y >= -0.05;
            const isOuterSpiralPad =
              minY >= towerCenter.minY + 140 &&
              nyAbs >= 0.26 &&
              (nrm.y >= 0.08 || (distFromTower >= 540 && minY < towerCenter.maxY - 220));
            category = isSummitDeck || isOuterSpiralPad ? 'tower_ledge' : 'cliff';
          } else {
            category = nyAbs >= 0.25 ? 'tower_ledge' : 'cliff';
          }
        } else if (grpInfo.baseRole === 'ship') {
          category = nyAbs >= 0.25 ? 'ship_walkable' : 'cliff';
        } else {
          // Ground / sculpted bridges / rocks / hills / potholes:
          // Keep steep outer perimeter cliffs as border; keep all authored non-flat terrain walkable
          const nearPerimeter =
            minX <= clipBounds.minX + 90 ||
            maxX >= clipBounds.maxX - 90 ||
            minZ <= clipBounds.minZ + 90 ||
            maxZ >= clipBounds.maxZ - 90;
          if (nearPerimeter && maxY > seaLevelWorldY + 610 && nyAbs < 0.22) {
            category = 'border';
          } else {
            category = 'ground';
          }
        }

        if (minY < minH) minH = minY;
        if (maxY > maxH) maxH = maxY;

        triangles.push({
          ax: vA.x, ay: vA.y, az: vA.z,
          bx: vB.x, by: vB.y, bz: vB.z,
          cx: vC.x, cy: vC.y, cz: vC.z,
          nx: nrm.x, ny: nyAbs, nySigned: nrm.y, nz: nrm.z,
          minX, maxX, minY, maxY, minZ, maxZ,
          category,
          baseCategory: category,
          sourceTag: grpInfo.sourceTag
        });
      }
    }
  });

  // Subdivide a flat Soil_04 base floor plane ONLY when no sculpted Soil_03 terrain exists
  if (hasBaseFloor && baseFloorBox) {
    const bfb = baseFloorBox as THREE.Box3;
    const gridN = 64;
    const fx0 = bfb.min.x;
    const fz0 = bfb.min.z;
    const stepX = (bfb.max.x - bfb.min.x) / gridN;
    const stepZ = (bfb.max.z - bfb.min.z) / gridN;
    const fy = baseFloorWorldY;
    if (fy < minH) minH = fy;
    if (fy > maxH) maxH = fy;

    for (let gz = 0; gz < gridN; gz++) {
      const z0 = fz0 + gz * stepZ;
      const z1 = z0 + stepZ;
      for (let gx = 0; gx < gridN; gx++) {
        const x0 = fx0 + gx * stepX;
        const x1 = x0 + stepX;

        triangles.push(
          {
            ax: x0, ay: fy, az: z0,
            bx: x0, by: fy, bz: z1,
            cx: x1, cy: fy, cz: z1,
            nx: 0, ny: 1, nySigned: 1, nz: 0,
            minX: x0, maxX: x1, minY: fy, maxY: fy, minZ: z0, maxZ: z1,
            category: 'ground',
            baseCategory: 'ground',
            sourceTag: 'terrain:base_floor'
          },
          {
            ax: x0, ay: fy, az: z0,
            bx: x1, by: fy, bz: z1,
            cx: x1, cy: fy, cz: z0,
            nx: 0, ny: 1, nySigned: 1, nz: 0,
            minX: x0, maxX: x1, minY: fy, maxY: fy, minZ: z0, maxZ: z1,
            category: 'ground',
            baseCategory: 'ground',
            sourceTag: 'terrain:base_floor'
          }
        );
      }
    }
  }

  const edgeInset = hasBaseFloor || hasSculptedSoil03 ? 22 : 75;
  const playableBounds = {
    minX: Math.max(40, clipBounds.minX + edgeInset),
    maxX: Math.min(worldWidth - 40, clipBounds.maxX - edgeInset),
    minY: Math.max(40, clipBounds.minZ + edgeInset),
    maxY: Math.min(worldHeight - 40, clipBounds.maxZ - edgeInset)
  };

  const collider = new MeshTerrainCollider(
    triangles,
    worldWidth,
    worldHeight,
    playableBounds,
    undefined,
    waterFreezeProfile
  );

  // Sample fallback heightGrid across [0..worldWidth, 0..worldHeight] for legacy minimap/utility consumers
  const heightGrid = new Float32Array(GRID_RES * GRID_RES);
  for (let gz = 0; gz < GRID_RES; gz++) {
    const wz = (gz / (GRID_RES - 1)) * worldHeight;
    const rowOff = gz * GRID_RES;
    for (let gx = 0; gx < GRID_RES; gx++) {
      const wx = (gx / (GRID_RES - 1)) * worldWidth;
      const sup = collider.querySupport(wx, wz, 1e6, 22);
      heightGrid[rowOff + gx] = sup.hit ? sup.height : 280;
    }
  }

  return {
    collider,
    heightGrid,
    minHeight: Number.isFinite(minH) ? minH : 10,
    maxHeight: Number.isFinite(maxH) ? maxH : 600
  };
}

function extractMapLandmarksAndLayout(
  root: THREE.Group,
  collider: MeshTerrainCollider,
  worldWidth: number,
  worldHeight: number,
  clipBounds: { minX: number; maxX: number; minZ: number; maxZ: number }
): {
  spawnPos: Vector2;
  bossSpawnPos: Vector2;
  redCrystalMouthPos: { x: number; y: number; z: number } | null;
  redCrystalBox: { minX: number; maxX: number; minY: number; maxY: number; minZ: number; maxZ: number } | null;
  artifactPos: Vector2;
  doubleJumpPos: { x: number; y: number; z?: number } | null;
  shipCenter: { x: number; y: number; z: number } | null;
  shipBox: { minX: number; maxX: number; minY: number; maxY: number; minZ: number; maxZ: number } | null;
  worldEventPositions: Vector2[];
  podPositions: Vector2[];
  shipObstacles: MapObstacle[];
  propObstacles: MapObstacle[];
} {
  let towerBox: THREE.Box3 | null = null;
  let waterfallBox: THREE.Box3 | null = null;
  let shipBox: THREE.Box3 | null = null;
  let redCrystalBox3: THREE.Box3 | null = null;

  root.traverse((obj) => {
    const low = normName(obj.name || '');
    if (!towerBox && low.includes('first artifact tower')) {
      towerBox = new THREE.Box3().setFromObject(obj);
    }
    if (!waterfallBox && low.includes('waterfall')) {
      waterfallBox = new THREE.Box3().setFromObject(obj);
    }
    if (
      !shipBox &&
      (low === 'ship' || low.includes('starship') || low.includes('bhutto') || low.includes('sally ride'))
    ) {
      shipBox = new THREE.Box3().setFromObject(obj);
    }
    if (low.includes('crystal cave') || low.includes('skpab2b')) {
      const box = new THREE.Box3().setFromObject(obj);
      redCrystalBox3 = redCrystalBox3 ? redCrystalBox3.union(box) : box;
    }
  });

  const bounds = collider.playableBounds;
  const pickNearestValidGround = (target: Vector2, fallback: Vector2): Vector2 => {
    const candidates = collider.validEnemySpawnPositions;
    if (candidates.length === 0) return fallback;
    let best = candidates[0];
    let bestD = Infinity;
    for (let i = 0; i < candidates.length; i++) {
      const c = candidates[i];
      const d = Math.hypot(c.x - target.x, c.y - target.y);
      if (d < bestD) {
        bestD = d;
        best = c;
      }
    }
    return { x: Math.round(best.x), y: Math.round(best.y) };
  };

  // Teleporter on First Artifact Tower summit (or upper center fallback)
  let artifactPos: Vector2 = { x: worldWidth * 0.5, y: bounds.minY + (bounds.maxY - bounds.minY) * 0.22 };
  if (towerBox) {
    const tc = new THREE.Vector3();
    (towerBox as THREE.Box3).getCenter(tc);
    artifactPos = { x: Math.round(tc.x), y: Math.round(tc.z) };
  }

  // Guaranteed Free Double Jump pickup placed directly on the open exterior first step of the Teleporter Tower
  let doubleJumpPos: { x: number; y: number; z?: number } | null = null;
  {
    const towerCenter = towerBox
      ? (() => {
          const tc = new THREE.Vector3();
          (towerBox as THREE.Box3).getCenter(tc);
          return { x: tc.x, z: tc.z };
        })()
      : { x: artifactPos.x, z: artifactPos.y };

    const walkwayTris = collider.allTriangles.filter(
      (t) => t.sourceTag === 'node:tower_walkway' && t.ny >= 0.72 && (t.nySigned ?? 1) > 0.25
    );
    const towerCandidates =
      walkwayTris.length > 0
        ? walkwayTris
        : collider.allTriangles.filter(
            (t) => t.category === 'tower_ledge' && t.ny >= 0.65 && (t.nySigned ?? 1) > 0.25
          );

    if (towerCandidates.length > 0) {
      let minStepY = Infinity;
      for (let i = 0; i < towerCandidates.length; i++) {
        const cy = (towerCandidates[i].ay + towerCandidates[i].by + towerCandidates[i].cy) / 3;
        if (cy < minStepY) minStepY = cy;
      }
      const firstStepTris = towerCandidates.filter(
        (t) => (t.ay + t.by + t.cy) / 3 <= minStepY + 18
      );
      if (firstStepTris.length > 0) {
        let maxR = 0;
        const pts = firstStepTris.map((t) => {
          const cx = (t.ax + t.bx + t.cx) / 3;
          const cy = (t.ay + t.by + t.cy) / 3;
          const cz = (t.az + t.bz + t.cz) / 3;
          const r = Math.hypot(cx - towerCenter.x, cz - towerCenter.z);
          if (r > maxR) maxR = r;
          return { cx, cy, cz, r, ang: Math.atan2(cz - towerCenter.z, cx - towerCenter.x) };
        });

        // Stay strictly on the outer walkway tread (never average a curved arc into the hollow tower interior)
        const minOuterR = maxR * 0.82;
        const outerPts = pts.filter((p) => p.r >= minOuterR);
        const pool = outerPts.length > 0 ? outerPts : pts;

        // Filter candidates with zero horizontal blocking walls nearby at 2x player chest height
        const clearPool = pool.filter((p) => {
          const check = collider.checkHorizontalMove(
            { x: p.cx, y: p.cz },
            { x: p.cx, y: p.cz },
            p.cy + 4,
            30,
            90,
            56,
            false
          );
          return check.allowed;
        });

        const finalPool = (clearPool.length > 0 ? clearPool : pool).slice().sort((a, b) => a.ang - b.ang);
        const midPt = finalPool[Math.floor(finalPool.length * 0.5)];
        const idealR = maxR * 0.90;
        let bestPt = midPt;
        let bestScore = Infinity;
        for (let i = 0; i < finalPool.length; i++) {
          const cand = finalPool[i];
          const score = Math.abs(cand.ang - midPt.ang) * 500 + Math.abs(cand.r - idealR);
          if (score < bestScore) {
            bestScore = score;
            bestPt = cand;
          }
        }

        doubleJumpPos = {
          x: Math.round(bestPt.cx),
          y: Math.round(bestPt.cz),
          z: Math.round(bestPt.cy)
        };
      }
    }
    if (!doubleJumpPos && towerBox) {
      const tc = new THREE.Vector3();
      (towerBox as THREE.Box3).getCenter(tc);
      const fb = pickNearestValidGround({ x: tc.x, y: tc.z }, { x: tc.x, y: tc.z });
      const elev = collider.querySupport(fb.x, fb.y, 1e6, 22).height;
      doubleJumpPos = { x: fb.x, y: fb.y, z: Math.round(elev) };
    }
  }

  // Player Spawn on clean ground in the clearing alongside the Ship
  let desiredSpawn: Vector2;
  if (shipBox) {
    const sb = shipBox as THREE.Box3;
    const shipCenterX = (sb.min.x + sb.max.x) * 0.5;
    const spawnSideX = shipCenterX < worldWidth * 0.5 ? sb.max.x + 260 : sb.min.x - 240;
    desiredSpawn = {
      x: spawnSideX,
      y: (sb.min.z + sb.max.z) * 0.5
    };
  } else {
    desiredSpawn = {
      x: bounds.minX + (bounds.maxX - bounds.minX) * 0.35,
      y: bounds.minY + (bounds.maxY - bounds.minY) * 0.80
    };
  }
  const spawnPos = pickNearestValidGround(desiredSpawn, { x: worldWidth * 0.5, y: worldHeight * 0.78 });

  // Boss Spawn on the open clearing directly in front (-Z / north side) of the Red Boss Crystal formation
  let bossSpawnPos: Vector2;
  let redCrystalMouthPos: { x: number; y: number; z: number } | null = null;
  let redCrystalBox: { minX: number; maxX: number; minY: number; maxY: number; minZ: number; maxZ: number } | null = null;

  if (redCrystalBox3) {
    const rcb = redCrystalBox3 as THREE.Box3;
    redCrystalBox = {
      minX: rcb.min.x,
      maxX: rcb.max.x,
      minY: rcb.min.y,
      maxY: rcb.max.y,
      minZ: rcb.min.z,
      maxZ: rcb.max.z
    };
    const crystalCenterX = (rcb.min.x + rcb.max.x) * 0.5;
    const clearingTarget: Vector2 = {
      x: crystalCenterX,
      y: rcb.min.z - 340
    };
    // Prefer walkable valid ground in the open north clearing directly facing the crystal mouth
    const northCandidates = collider.validEnemySpawnPositions.filter(
      (c) => c.y <= rcb.min.z - 120 && c.y >= rcb.min.z - 720 && Math.abs(c.x - crystalCenterX) <= 520
    );
    if (northCandidates.length > 0) {
      let best = northCandidates[0];
      let bestD = Infinity;
      for (const c of northCandidates) {
        const d = Math.hypot(c.x - clearingTarget.x, c.y - clearingTarget.y);
        if (d < bestD) {
          bestD = d;
          best = c;
        }
      }
      bossSpawnPos = { x: Math.round(best.x), y: Math.round(best.y) };
    } else {
      bossSpawnPos = pickNearestValidGround(clearingTarget, clearingTarget);
    }

    const clearingGroundZ = collider.querySupport(bossSpawnPos.x, bossSpawnPos.y, rcb.max.y, 22).height || (rcb.min.y + 4);
    const mouthX = Math.round(crystalCenterX);
    const mouthY = Math.round(rcb.min.z + Math.max(8, (rcb.max.z - rcb.min.z) * 0.04));
    const horizDist = Math.max(40, Math.hypot(bossSpawnPos.x - mouthX, bossSpawnPos.y - mouthY));
    const rcbHeight = Math.max(10, rcb.max.y - rcb.min.y);
    // Smooth 30-deg diagonal emergence from recessed Red Crystal mouth down onto open ground
    const diagRise = Math.max(rcbHeight * 0.22, horizDist * Math.tan((30 * Math.PI) / 180));
    const mouthZ = Math.round(Math.min(rcb.max.y - rcbHeight * 0.12, clearingGroundZ + diagRise));
    redCrystalMouthPos = { x: mouthX, y: mouthY, z: mouthZ };
  } else {
    bossSpawnPos = pickNearestValidGround(
      {
        x: bounds.minX + (bounds.maxX - bounds.minX) * 0.25,
        y: bounds.minY + (bounds.maxY - bounds.minY) * 0.30
      },
      { x: worldWidth * 0.3, y: worldHeight * 0.3 }
    );
  }

  // 4 World Events spread across valid walkable ground sectors
  const spanX = clipBounds.maxX - clipBounds.minX;
  const spanZ = clipBounds.maxZ - clipBounds.minZ;
  const eventTargets: Vector2[] = [
    { x: clipBounds.minX + spanX * 0.24, y: clipBounds.minZ + spanZ * 0.78 },
    { x: clipBounds.minX + spanX * 0.76, y: clipBounds.minZ + spanZ * 0.72 },
    { x: clipBounds.minX + spanX * 0.22, y: clipBounds.minZ + spanZ * 0.28 },
    { x: clipBounds.minX + spanX * 0.78, y: clipBounds.minZ + spanZ * 0.28 }
  ];
  const worldEventPositions = eventTargets.map((t) => pickNearestValidGround(t, t));

  // 10 Organic Pods across valid walkable ground
  const podTargets: Vector2[] = [
    { x: clipBounds.minX + spanX * 0.18, y: clipBounds.minZ + spanZ * 0.84 },
    { x: clipBounds.minX + spanX * 0.38, y: clipBounds.minZ + spanZ * 0.80 },
    { x: clipBounds.minX + spanX * 0.62, y: clipBounds.minZ + spanZ * 0.82 },
    { x: clipBounds.minX + spanX * 0.84, y: clipBounds.minZ + spanZ * 0.65 },
    { x: clipBounds.minX + spanX * 0.20, y: clipBounds.minZ + spanZ * 0.55 },
    { x: clipBounds.minX + spanX * 0.75, y: clipBounds.minZ + spanZ * 0.52 },
    { x: clipBounds.minX + spanX * 0.30, y: clipBounds.minZ + spanZ * 0.38 },
    { x: clipBounds.minX + spanX * 0.70, y: clipBounds.minZ + spanZ * 0.38 },
    { x: clipBounds.minX + spanX * 0.36, y: clipBounds.minZ + spanZ * 0.18 },
    { x: clipBounds.minX + spanX * 0.64, y: clipBounds.minZ + spanZ * 0.18 }
  ];
  const podPositions = podTargets.map((t) => pickNearestValidGround(t, t));

  const shipCenter = shipBox
    ? {
        x: Math.round(((shipBox as THREE.Box3).min.x + (shipBox as THREE.Box3).max.x) * 0.5),
        y: Math.round(((shipBox as THREE.Box3).min.z + (shipBox as THREE.Box3).max.z) * 0.5),
        z: Math.round((shipBox as THREE.Box3).min.y)
      }
    : null;
  const serializedShipBox = shipBox
    ? {
        minX: (shipBox as THREE.Box3).min.x,
        maxX: (shipBox as THREE.Box3).max.x,
        minY: (shipBox as THREE.Box3).min.y,
        maxY: (shipBox as THREE.Box3).max.y,
        minZ: (shipBox as THREE.Box3).min.z,
        maxZ: (shipBox as THREE.Box3).max.z
      }
    : null;

  return {
    spawnPos,
    bossSpawnPos,
    redCrystalMouthPos,
    redCrystalBox,
    artifactPos,
    doubleJumpPos,
    shipCenter,
    shipBox: serializedShipBox,
    worldEventPositions,
    podPositions,
    shipObstacles: [],
    propObstacles: []
  };
}

function isObjectVisibleInTree(obj: THREE.Object3D): boolean {
  let cur: THREE.Object3D | null = obj;
  while (cur) {
    if (!cur.visible) return false;
    cur = cur.parent;
  }
  return true;
}

function detectSkydomeSide(geo: THREE.BufferGeometry): THREE.Side {
  const pos = geo.attributes.position as THREE.BufferAttribute | undefined;
  if (!pos || pos.count < 3) return THREE.FrontSide;

  geo.computeBoundingBox();
  const center = new THREE.Vector3();
  if (geo.boundingBox) geo.boundingBox.getCenter(center);

  const idx = geo.index;
  const triCount = idx ? Math.floor(idx.count / 3) : Math.floor(pos.count / 3);
  const sampleCount = Math.min(120, triCount);
  const step = Math.max(1, Math.floor(triCount / sampleCount));

  const a = new THREE.Vector3();
  const b = new THREE.Vector3();
  const c = new THREE.Vector3();
  const ab = new THREE.Vector3();
  const ac = new THREE.Vector3();
  const n = new THREE.Vector3();
  let outward = 0;
  let inward = 0;

  for (let t = 0; t < triCount; t += step) {
    const i0 = idx ? idx.getX(t * 3) : t * 3;
    const i1 = idx ? idx.getX(t * 3 + 1) : t * 3 + 1;
    const i2 = idx ? idx.getX(t * 3 + 2) : t * 3 + 2;
    a.fromBufferAttribute(pos, i0);
    b.fromBufferAttribute(pos, i1);
    c.fromBufferAttribute(pos, i2);
    ab.subVectors(b, a);
    ac.subVectors(c, a);
    n.crossVectors(ab, ac);
    a.sub(center);
    if (a.dot(n) >= 0) outward++;
    else inward++;
  }

  return outward > inward ? THREE.BackSide : THREE.FrontSide;
}

/**
 * Merges hundreds/thousands of static opaque child meshes inside imported GLB maps
 * into one world-space mesh per material + attribute layout so WebGL draw calls drop
 * dramatically (~1,479 -> ~25-35) without changing visuals, shaders, or colliders.
 */
function batchStaticMapMeshesByMaterial(root: THREE.Group): void {
  root.updateMatrixWorld(true);
  const buckets = new Map<string, THREE.Mesh[]>();

  root.traverse((obj) => {
    const mesh = obj as THREE.Mesh;
    if (!mesh.isMesh || !mesh.geometry) return;
    mesh.castShadow = false;
    mesh.receiveShadow = false;
    if (!isObjectVisibleInTree(mesh)) return;
    if ((mesh as any).isSkinnedMesh || (mesh as any).isInstancedMesh) return;
    if (isWaterMesh(mesh) || isRedBossCrystalObject(mesh) || isRightCrystalObject(mesh) || isSkydomeObject(mesh)) {
      return;
    }
    if (Array.isArray(mesh.material) || !mesh.material || mesh.material.transparent) return;

    const attrKeys = Object.keys(mesh.geometry.attributes)
      .filter((k) => k === 'position' || k === 'normal' || k === 'uv' || k === 'uv1' || k === 'color')
      .sort()
      .join('+');
    if (!mesh.geometry.attributes.position) return;

    const bucketKey = `${mesh.material.uuid}|${mesh.renderOrder}|${attrKeys}`;
    let list = buckets.get(bucketKey);
    if (!list) {
      list = [];
      buckets.set(bucketKey, list);
    }
    list.push(mesh);
  });

  if (buckets.size === 0) return;

  const batchedGroup = new THREE.Group();
  batchedGroup.name = 'StaticMapMergedBatches';
  let mergedBatchCount = 0;
  let mergedSourceCount = 0;

  for (const [, list] of buckets.entries()) {
    if (list.length < 2) continue;
    const mat = list[0].material as THREE.Material;
    const renderOrder = list[0].renderOrder;

    const hasIndexed = list.some((m) => m.geometry.index !== null);
    const hasNonIndexed = list.some((m) => m.geometry.index === null);
    const convertNonIndexed = hasIndexed && hasNonIndexed;

    const bakedGeos: THREE.BufferGeometry[] = [];
    for (let i = 0; i < list.length; i++) {
      const m = list[i];
      let g = m.geometry.clone();
      for (const attr of Object.keys(g.attributes)) {
        if (attr !== 'position' && attr !== 'normal' && attr !== 'uv' && attr !== 'uv1' && attr !== 'color') {
          g.deleteAttribute(attr);
        }
      }
      if (convertNonIndexed && g.index) {
        const nonIdx = g.toNonIndexed();
        g.dispose();
        g = nonIdx;
      }
      g.applyMatrix4(m.matrixWorld);
      bakedGeos.push(g);
    }

    const merged = mergeGeometries(bakedGeos, false);
    for (const g of bakedGeos) g.dispose();
    if (!merged) continue;

    merged.computeBoundingBox();
    merged.computeBoundingSphere();

    const batchMesh = new THREE.Mesh(merged, mat);
    batchMesh.name = `MergedStaticBatch_${mergedBatchCount}`;
    batchMesh.castShadow = false;
    batchMesh.receiveShadow = false;
    batchMesh.renderOrder = renderOrder;
    batchMesh.frustumCulled = true;
    batchedGroup.add(batchMesh);
    mergedBatchCount++;

    for (let i = 0; i < list.length; i++) {
      const src = list[i];
      src.parent?.remove(src);
      src.geometry.dispose();
      mergedSourceCount++;
    }
  }

  if (mergedBatchCount > 0) {
    root.add(batchedGroup);
    root.updateMatrixWorld(true);
    console.info(
      `[TestMapLoader] Batched ${mergedSourceCount} static map meshes into ${mergedBatchCount} merged draw calls.`
    );
  }
}

function isSkydomeObject(obj: THREE.Object3D): boolean {
  let cur: THREE.Object3D | null = obj;
  while (cur) {
    const name = (cur.name || '').toLowerCase().replace(/[\s_]+/g, ' ');
    if (
      name.includes('skydome') ||
      name.includes('skybox') ||
      name.includes('céu-sky') ||
      name.includes('ceu-sky') ||
      name.includes('atmos')
    ) {
      return true;
    }
    cur = cur.parent;
  }
  const mesh = obj as THREE.Mesh;
  if (mesh.isMesh && mesh.material) {
    const mats = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
    for (const m of mats) {
      const matName = (m?.name || '').toLowerCase();
      if (
        matName.includes('atmos') ||
        matName.includes('skydome') ||
        matName.includes('skybox')
      ) {
        return true;
      }
    }
  }
  return false;
}

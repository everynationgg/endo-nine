import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { ColladaLoader } from 'three/examples/jsm/loaders/ColladaLoader.js';
import { OBJLoader } from 'three/examples/jsm/loaders/OBJLoader.js';
import { STLLoader } from 'three/examples/jsm/loaders/STLLoader.js';
import { MapObstacle, Vector2 } from '../sim/types';

export type TestMapScaleMode = 'auto' | 'x100' | 'x25' | 'x1';

export interface LoadedTestMap {
  root: THREE.Group;
  heightGrid: Float32Array;
  walkableBounds: { minX: number; maxX: number; minY: number; maxY: number };
  circularBounds: { cx: number; cz: number; radius: number } | null;
  spawnPos: Vector2;
  bossSpawnPos: Vector2;
  artifactPos: Vector2;
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
  isUntitledCraterMap?: boolean;
  allowTestMapNarrative?: boolean;
  enemySpawnMask?: Uint8Array | null;
  waterMask?: Uint8Array | null;
  towerStepBounds?: { minX: number; maxX: number; minY: number; maxY: number } | null;
}

const WORLD_SIZE = 3600;
const GRID_RES = 361;
const CELL_SIZE = 10;

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

/**
 * Loads a SketchUp / Blender exported map (.glb, .gltf, .dae, .obj, .stl),
 * scales and centers it into Endo Nine's 3600x3600 world footprint, and
 * samples a 361x361 top-surface heightGrid so walking, jumping, slopes, and
 * mouse aiming work directly on the custom geometry.
 */
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

  // Detect Untitled.glb crater map vs Dome map up front so axes & water styling can be prepared cleanly
  let hasCeuSky = false;
  let hasSkydomeMe = false;
  let hasTdfSar = false;
  model.traverse((obj) => {
    const lowerName = (obj.name || '').toLowerCase();
    if (lowerName.includes('céu-sky') || lowerName.includes('ceu-sky')) hasCeuSky = true;
    if (lowerName.includes('skydome_me') || lowerName.includes('me sd')) hasSkydomeMe = true;
    if (lowerName.includes('tdf sar')) hasTdfSar = true;
  });
  const isUntitledCraterMap = hasSkydomeMe || hasTdfSar || /^untitled\.(glb|gltf)$/i.test(fileName);
  const isDomeMap = !isUntitledCraterMap && (hasCeuSky || /dome/i.test(fileName));

  // SketchUp Untitled.glb exports X as North->South; rotating -90deg around Y puts Tower North (-Z), Ship South (+Z), and open water East (+X)
  if (isUntitledCraterMap) {
    model.rotation.y = -Math.PI / 2;
    model.updateMatrixWorld(true);
  }

  let meshCount = 0;
  let triangleCount = 0;
  model.traverse((obj) => {
    const normalizedName = obj.name.trim().replace(/[\s_]+/g, ' ');
    // Hide SketchUp's default 2D human reference cutout ("Sree") and 3D Warehouse skydome helper parts
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

      // Render skydome unlit, immune to scene distance fog, and single-sided inward
      // so backing the camera past the outer rim never blocks the view of the arena
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

    // Untitled.glb water surface is an untextured semi-transparent white mesh (`*`) — tint it alien glacial blue
    if (isUntitledCraterMap && isUntitledWaterMesh(mesh)) {
      mesh.material = new THREE.MeshStandardMaterial({
        name: 'UntitledWaterSurface',
        color: 0x2b85cc,
        emissive: 0x0a2e4d,
        emissiveIntensity: 0.45,
        roughness: 0.22,
        metalness: 0.08,
        transparent: true,
        opacity: 0.78,
        side: THREE.DoubleSide,
        depthWrite: false
      });
      mesh.receiveShadow = true;
      return;
    }

    const fixMat = (m: THREE.Material) => {
      m.side = THREE.DoubleSide;
      m.needsUpdate = true;
    };
    if (Array.isArray(mesh.material)) {
      mesh.material.forEach(fixMat);
    } else if (mesh.material) {
      fixMat(mesh.material);
    } else {
      mesh.material = new THREE.MeshLambertMaterial({ color: 0x5c7a67, side: THREE.DoubleSide });
    }
  });

  if (meshCount === 0) {
    throw new Error('The exported file contains no 3D meshes.');
  }

  model.updateMatrixWorld(true);

  // Compute bounding box using visible non-skydome meshes so surrounding sky domes never shrink the playable island.
  // Also track the ~36m core island separately in case outer horizon skirts extend outward to meet the skydome,
  // and track walkable terrain alone so overhanging ships/smoke/grass don't shift the arena off-center.
  const rawBox = new THREE.Box3();
  const coreBox = new THREE.Box3();
  const terrainOnlyBox = new THREE.Box3();
  const bSize = new THREE.Vector3();
  model.traverse((obj) => {
    if (!isObjectVisibleInTree(obj) || isSkydomeObject(obj)) return;
    const mesh = obj as THREE.Mesh;
    if (mesh.isMesh && mesh.geometry) {
      mesh.geometry.computeBoundingBox();
      if (mesh.geometry.boundingBox) {
        const b = mesh.geometry.boundingBox.clone().applyMatrix4(mesh.matrixWorld);
        if (!isNonWalkableProp(mesh, isUntitledCraterMap)) {
          terrainOnlyBox.union(b);
          rawBox.union(b);
        } else if (!isUntitledCraterMap) {
          rawBox.union(b);
        }
        b.getSize(bSize);
        if (Math.max(bSize.x, bSize.z) <= 42) {
          coreBox.union(b);
        }
      }
    }
  });
  if (rawBox.isEmpty()) {
    rawBox.setFromObject(model);
  }

  const rawSize = new THREE.Vector3();
  const rawCenter = new THREE.Vector3();
  rawBox.getSize(rawSize);
  rawBox.getCenter(rawCenter);

  let anchorSize = rawSize;
  let anchorCenter = rawCenter;
  if ((isDomeMap || isUntitledCraterMap) && !terrainOnlyBox.isEmpty()) {
    terrainOnlyBox.getSize(anchorSize);
    terrainOnlyBox.getCenter(anchorCenter);
  } else if (!coreBox.isEmpty()) {
    const coreSize = new THREE.Vector3();
    const coreCenter = new THREE.Vector3();
    coreBox.getSize(coreSize);
    coreBox.getCenter(coreCenter);
    const rawHoriz = Math.max(rawSize.x, rawSize.z);
    const coreHoriz = Math.max(coreSize.x, coreSize.z);
    if (coreHoriz > 20 && rawHoriz > coreHoriz * 1.15) {
      anchorSize = coreSize;
      // Preserve southern ship shoreline alignment if northern gravel extends into the outer horizon skirt
      if (rawBox.min.z < coreBox.min.z - 2 && coreSize.z < coreSize.x) {
        coreCenter.z = coreBox.max.z - coreHoriz * 0.5;
      }
      anchorCenter = coreCenter;
    }
  }

  const maxHoriz = Math.max(anchorSize.x, anchorSize.z, 0.001);
  let appliedScale = 1;
  if (scaleMode === 'auto') {
    appliedScale = WORLD_SIZE / maxHoriz;
  } else if (scaleMode === 'x100') {
    appliedScale = 100;
  } else if (scaleMode === 'x25') {
    appliedScale = 25;
  } else {
    appliedScale = 1;
  }

  const groundMinY = ((isDomeMap || isUntitledCraterMap) && !terrainOnlyBox.isEmpty()) ? terrainOnlyBox.min.y : rawBox.min.y;
  const root = new THREE.Group();
  root.name = isUntitledCraterMap ? 'Untitled_Stage1_TestMap_Root' : 'SketchUp_TestMap_Root';
  model.scale.multiplyScalar(appliedScale);
  model.position.set(
    WORLD_SIZE * 0.5 - anchorCenter.x * appliedScale,
    10 - groundMinY * appliedScale,
    WORLD_SIZE * 0.5 - anchorCenter.z * appliedScale
  );
  root.add(model);
  root.updateMatrixWorld(true);

  const sampled = sampleMeshToHeightGrid(root, isUntitledCraterMap);
  const circularBounds = isDomeMap
    ? { cx: WORLD_SIZE * 0.5, cz: WORLD_SIZE * 0.5, radius: WORLD_SIZE * 0.5 - 100 }
    : null;
  const layout = isUntitledCraterMap
    ? buildUntitledStage1LayoutFromDiagram(root, sampled.walkableBounds, sampled.heightGrid)
    : isDomeMap
      ? buildDomeStage1LayoutFromDiagram(root, circularBounds!)
      : buildStage1LayoutFromDiagram(root, sampled.walkableBounds);

  const towerStepBounds = isUntitledCraterMap
    ? { minX: 1180, maxX: 2420, minY: 190, maxY: 1430 }
    : null;

  return {
    root,
    heightGrid: sampled.heightGrid,
    walkableBounds: sampled.walkableBounds,
    circularBounds,
    ...layout,
    minHeight: sampled.minHeight,
    maxHeight: sampled.maxHeight,
    appliedScale,
    meshCount,
    triangleCount,
    fileName,
    isUntitledCraterMap,
    allowTestMapNarrative: isUntitledCraterMap,
    enemySpawnMask: sampled.enemySpawnMask,
    waterMask: sampled.waterMask,
    towerStepBounds
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

function isSkydomeObject(obj: THREE.Object3D): boolean {
  let cur: THREE.Object3D | null = obj;
  while (cur) {
    const name = (cur.name || '').toLowerCase().replace(/[\s_]+/g, ' ');
    if (
      name.includes('skydome') ||
      name.includes('skybox') ||
      name.includes('céu-sky') ||
      name.includes('ceu-sky') ||
      name.includes('me sd') ||
      name.includes('atmos') ||
      name.includes('sphere inside') ||
      name.includes('sphere outside') ||
      name.includes('walking support post')
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
        matName.includes('skybox') ||
        matName.includes('cloud1') ||
        matName.includes('translucent_glass_green_dark')
      ) {
        return true;
      }
    }
  }
  return false;
}

function isUntitledWaterMesh(mesh: THREE.Mesh): boolean {
  const mats = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
  return mats.some((m) => {
    if (!m) return false;
    const n = (m.name || '').trim();
    return n === '*' || n === 'UntitledWaterSurface' || /water/i.test(n);
  });
}

function isNonWalkableProp(obj: THREE.Object3D, isUntitledCraterMap: boolean = false): boolean {
  if (isSkydomeObject(obj)) return true;
  let cur: THREE.Object3D | null = obj;
  while (cur) {
    const name = (cur.name || '').toLowerCase().replace(/[\s_]+/g, ' ');
    // Exclude ship, tower superstructure ("turm"), decorative smoke/grass/tree/flower/wall-art/fountain props,
    // SketchUp scale figure, and camera placeholder from terrain height sampling
    if (
      name.includes('ship') ||
      name.includes('tdf sar') ||
      name.includes('turm') ||
      name.includes('sree') ||
      name.includes('active view') ||
      name.includes('smoke') ||
      name.includes('grass') ||
      name.includes('gracillimus') ||
      name.includes('cone tree') ||
      name.includes('unbenannt') ||
      name.includes('wall art') ||
      name.includes('fountain')
    ) {
      return true;
    }
    cur = cur.parent;
  }
  const mesh = obj as THREE.Mesh;
  if (mesh.isMesh && mesh.material) {
    if (isUntitledCraterMap && isUntitledWaterMesh(mesh)) return true;
    const mats = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
    for (const m of mats) {
      const matLower = (m.name || '').toLowerCase();
      if (matLower.includes('water') || matLower.includes('skp avat flo')) return true;
    }
  }
  return false;
}

function buildShipObstacles(shipNode: THREE.Object3D | null): MapObstacle[] {
  const shipObstacles: MapObstacle[] = [];
  if (!shipNode) return shipObstacles;

  const shipBox = new THREE.Box3().setFromObject(shipNode);
  const shipCenter = new THREE.Vector3();
  const shipSize = new THREE.Vector3();
  shipBox.getCenter(shipCenter);
  shipBox.getSize(shipSize);

  const majorR = Math.min(shipSize.x, shipSize.z) * 0.24;
  const steps = 3;
  for (let i = 0; i < steps; i++) {
    const t = (i / (steps - 1)) - 0.5;
    shipObstacles.push({
      id: `test_ship_${i}`,
      type: 'rock',
      pos: {
        x: shipCenter.x + t * (shipSize.x * 0.55),
        y: shipCenter.z + t * (shipSize.z * 0.45)
      },
      radius: Math.max(45, majorR),
      scaleVar: 1.0
    });
  }
  return shipObstacles;
}

function buildDomeStage1LayoutFromDiagram(
  root: THREE.Object3D,
  circularBounds: { cx: number; cz: number; radius: number }
): {
  spawnPos: Vector2;
  bossSpawnPos: Vector2;
  artifactPos: Vector2;
  worldEventPositions: Vector2[];
  podPositions: Vector2[];
  shipObstacles: MapObstacle[];
  propObstacles: MapObstacle[];
} {
  const clampToCircle = (x: number, y: number, margin: number = 40): Vector2 => {
    const maxR = Math.max(40, circularBounds.radius - margin);
    const dx = x - circularBounds.cx;
    const dy = y - circularBounds.cz;
    const dist = Math.hypot(dx, dy);
    if (dist > maxR && dist > 0.0001) {
      return {
        x: circularBounds.cx + (dx / dist) * maxR,
        y: circularBounds.cz + (dy / dist) * maxR
      };
    }
    return { x, y };
  };

  let shipNode: THREE.Object3D | null = null;
  let coneTreeNode: THREE.Object3D | null = null;
  let blueTreeNode: THREE.Object3D | null = null;
  let summitPatchNode: THREE.Object3D | null = null;
  const tmpBox = new THREE.Box3();
  const tmpSize = new THREE.Vector3();
  const tmpCenter = new THREE.Vector3();

  root.traverse((obj) => {
    const lower = (obj.name || '').toLowerCase();
    if (!shipNode && lower.includes('ship')) shipNode = obj;
    if (!coneTreeNode && lower.includes('cone tree')) coneTreeNode = obj;
    if (!blueTreeNode && lower.includes('unbenannt')) blueTreeNode = obj;
    if (!summitPatchNode && lower.includes('node_2001')) summitPatchNode = obj;

    if (!summitPatchNode && (obj as THREE.Mesh).isMesh && !isNonWalkableProp(obj)) {
      const mats = Array.isArray((obj as THREE.Mesh).material)
        ? ((obj as THREE.Mesh).material as THREE.Material[])
        : [(obj as THREE.Mesh).material as THREE.Material];
      const isSoil = mats.some((m) => /soil_04/i.test(m?.name || ''));
      if (isSoil) {
        tmpBox.setFromObject(obj);
        tmpBox.getSize(tmpSize);
        tmpBox.getCenter(tmpCenter);
        if (
          tmpCenter.x >= 1800 && tmpCenter.x <= 2800 &&
          tmpCenter.z >= 1200 && tmpCenter.z <= 1750 &&
          tmpBox.max.y > 850 && tmpSize.x < 1400
        ) {
          summitPatchNode = obj;
        }
      }
    }
  });

  const shipObstacles = buildShipObstacles(shipNode);
  const propObstacles: MapObstacle[] = [];
  if (coneTreeNode) {
    const treeBox = new THREE.Box3().setFromObject(coneTreeNode);
    const treeCenter = new THREE.Vector3();
    treeBox.getCenter(treeCenter);
    propObstacles.push({
      id: 'test_dome_cone_tree',
      type: 'tree',
      pos: { x: treeCenter.x, y: treeCenter.z },
      radius: 95,
      scaleVar: 1.0
    });
  }
  if (blueTreeNode) {
    const treeBox = new THREE.Box3().setFromObject(blueTreeNode);
    const treeCenter = new THREE.Vector3();
    treeBox.getCenter(treeCenter);
    propObstacles.push({
      id: 'test_dome_blue_tree',
      type: 'tree',
      pos: { x: treeCenter.x, y: treeCenter.z },
      radius: 105,
      scaleVar: 1.0
    });
  }

  // T — Teleporter: Summit patch below green tree (node_2001)
  let artifactPos: Vector2 = { x: 2365, y: 1500 };
  if (summitPatchNode) {
    const platBox = new THREE.Box3().setFromObject(summitPatchNode);
    const platCenter = new THREE.Vector3();
    platBox.getCenter(platCenter);
    artifactPos = clampToCircle(platCenter.x, platCenter.z, 60);
  }

  // P — Player Spawn: West, just above the crashed ship
  const spawnPos: Vector2 = clampToCircle(380, 1580, 40);
  // B — Boss Spawn: East-southeast river mouth
  const bossSpawnPos: Vector2 = clampToCircle(3160, 2560, 60);
  // Events 1–4 matching the uploaded Spawn Layout diagram
  const worldEventPositions: Vector2[] = [
    clampToCircle(2440, 3260, 60), // EVENT 1: Southern dry riverbank
    clampToCircle(1600, 2120, 60), // EVENT 2: Middle of the map
    clampToCircle(1540, 1690, 60), // EVENT 3: Just north of center
    clampToCircle(3270, 1850, 60)  // EVENT 4: Beside the blue tree
  ];

  // Organic Pods distributed on dry, walkable ground (including the 3 northern guide patches)
  const podPositions: Vector2[] = [
    clampToCircle(910, 960, 50),   // NW walkable guide patch
    clampToCircle(1830, 550, 50),  // N walkable guide patch
    clampToCircle(2740, 960, 50),  // NE walkable guide patch
    clampToCircle(1250, 3380, 50), // SW dry riverbank
    clampToCircle(1950, 3360, 50), // South dry riverbank
    clampToCircle(2620, 3200, 50), // SE dry riverbank
    clampToCircle(950, 1850, 50),  // West clearing
    clampToCircle(1950, 2220, 50), // Central-south clearing
    clampToCircle(2750, 1950, 50), // East clearing
    clampToCircle(1250, 1280, 50)  // NW mid-clearing
  ];

  return {
    spawnPos,
    bossSpawnPos,
    artifactPos,
    worldEventPositions,
    podPositions,
    shipObstacles,
    propObstacles
  };
}

function buildStage1LayoutFromDiagram(
  root: THREE.Object3D,
  bounds: { minX: number; maxX: number; minY: number; maxY: number }
): {
  spawnPos: Vector2;
  bossSpawnPos: Vector2;
  artifactPos: Vector2;
  worldEventPositions: Vector2[];
  podPositions: Vector2[];
  shipObstacles: MapObstacle[];
  propObstacles: MapObstacle[];
} {
  const clampToBounds = (x: number, y: number, margin: number = 40): Vector2 => ({
    x: Math.max(bounds.minX + margin, Math.min(bounds.maxX - margin, x)),
    y: Math.max(bounds.minY + margin, Math.min(bounds.maxY - margin, y))
  });

  let shipNode: THREE.Object3D | null = null;
  let turmNode: THREE.Object3D | null = null;
  let arenaRingNode: THREE.Object3D | null = null;
  const tmpBox = new THREE.Box3();
  const tmpSize = new THREE.Vector3();
  const tmpCenter = new THREE.Vector3();

  root.traverse((obj) => {
    const lower = (obj.name || '').toLowerCase();
    if (!shipNode && lower.includes('ship')) shipNode = obj;
    if (!turmNode && lower.includes('turm')) turmNode = obj;

    if (!turmNode && !arenaRingNode && (obj as THREE.Mesh).isMesh && !isNonWalkableProp(obj)) {
      tmpBox.setFromObject(obj);
      tmpBox.getSize(tmpSize);
      tmpBox.getCenter(tmpCenter);
      if (
        tmpSize.x >= 500 &&
        tmpSize.x <= 900 &&
        tmpSize.z >= 500 &&
        tmpSize.z <= 900 &&
        Math.abs(tmpSize.x - tmpSize.z) < 120 &&
        tmpBox.max.y > 900 &&
        tmpCenter.x >= 1650 &&
        tmpCenter.x <= 2550 &&
        tmpCenter.z >= 1250 &&
        tmpCenter.z <= 2150
      ) {
        arenaRingNode = obj;
      }
    }
  });

  // Ship collision circles matching the diagonal vessel in the southwest sector
  const shipObstacles = buildShipObstacles(shipNode);

  // Teleporter positioned at the exact center of the elevated circular platform ("Turm" or central arena ring)
  let artifactPos: Vector2 = { x: 2119, y: 1716 };
  const targetPlatform = turmNode || arenaRingNode;
  if (targetPlatform) {
    const platBox = new THREE.Box3().setFromObject(targetPlatform);
    const platCenter = new THREE.Vector3();
    platBox.getCenter(platCenter);
    artifactPos = clampToBounds(platCenter.x, platCenter.z, 60);
  }

  // Exact layout positions matching the Level Design Map diagram (safely inside impassable edge walls):
  // - PLAYER SPAWN: South-West right outside the crashed ship
  const spawnPos: Vector2 = clampToBounds(760, 3310, 40);
  // - BOSS SPAWN: Top-Left flat plateau
  const bossSpawnPos: Vector2 = clampToBounds(400, 350, 60);
  // - EVENT 01..04:
  const worldEventPositions: Vector2[] = [
    clampToBounds(430, 2320, 60),  // EVENT 01: Western lagoon bay
    clampToBounds(2320, 2600, 60), // EVENT 02: Eastern river/lagoon
    clampToBounds(2700, 1650, 60), // EVENT 03: Eastern clearing east of Teleporter plateau
    clampToBounds(660, 1540, 60)   // EVENT 04: Western terrace west of ramp
  ];

  // Organic Pods placed cleanly along key exploration routes
  const podPositions: Vector2[] = [
    clampToBounds(1120, 3320, 50),
    clampToBounds(380, 3050, 50),
    clampToBounds(1560, 2460, 50),
    clampToBounds(2880, 2620, 50),
    clampToBounds(3180, 2280, 50),
    clampToBounds(2850, 1520, 50),
    clampToBounds(1180, 1480, 50),
    clampToBounds(1620, 580, 50),
    clampToBounds(2560, 660, 50),
    clampToBounds(780, 580, 50)
  ];

  // Trees and rocks are intentionally omitted in Test Map mode (authoring vegetation directly in SketchUp)
  const propObstacles: MapObstacle[] = [];

  return {
    spawnPos,
    bossSpawnPos,
    artifactPos,
    worldEventPositions,
    podPositions,
    shipObstacles,
    propObstacles
  };
}

function buildUntitledStage1LayoutFromDiagram(
  root: THREE.Object3D,
  walkableBounds: { minX: number; maxX: number; minY: number; maxY: number },
  heightGrid: Float32Array
): {
  spawnPos: Vector2;
  bossSpawnPos: Vector2;
  artifactPos: Vector2;
  worldEventPositions: Vector2[];
  podPositions: Vector2[];
  shipObstacles: MapObstacle[];
  propObstacles: MapObstacle[];
} {
  let shipNode: THREE.Object3D | null = null;
  const blueTreeNodes: THREE.Object3D[] = [];
  const grassTuftNodes: THREE.Object3D[] = [];

  root.traverse((obj) => {
    const norm = (obj.name || '').toLowerCase().replace(/[\s_]+/g, ' ').trim();
    if (!shipNode && (norm.includes('tdf sar') || norm.includes('ship'))) {
      shipNode = obj;
    }
    if (/^unbenannt(\s+\d+)?$/i.test(norm)) {
      blueTreeNodes.push(obj);
    }
    if (norm.includes('misc gracillimus') && !norm.includes('blades') && obj !== shipNode) {
      // Only push each tuft group root (children end up inside same subtree; deduplicate by proximity below)
      grassTuftNodes.push(obj);
    }
  });

  // Tight hull-accurate ship obstacles along the diagonally crashed fuselage (nose NW -> stern SE)
  const shipObstacles: MapObstacle[] = shipNode
    ? (() => {
        const sBox = new THREE.Box3().setFromObject(shipNode);
        const minX = sBox.min.x;
        const maxX = sBox.max.x;
        const minZ = sBox.min.z;
        const maxZ = sBox.max.z;
        const hullCenters = [0.22, 0.44, 0.66, 0.84];
        return hullCenters.map((t, idx) => ({
          id: `test_ship_${idx}`,
          type: 'rock' as const,
          pos: {
            x: minX + (maxX - minX) * t,
            y: minZ + (maxZ - minZ) * t
          },
          radius: 122,
          scaleVar: 1.0
        }));
      })()
    : [];
  const propObstacles: MapObstacle[] = [];

  // Register both blue alien trees with exact centers so collision + flora dialogue trigger accurately
  blueTreeNodes.forEach((treeObj, idx) => {
    const treeBox = new THREE.Box3().setFromObject(treeObj);
    const treeCenter = new THREE.Vector3();
    const treeSize = new THREE.Vector3();
    treeBox.getCenter(treeCenter);
    treeBox.getSize(treeSize);
    propObstacles.push({
      id: `untitled_blue_tree_${idx}`,
      type: 'tree',
      pos: { x: treeCenter.x, y: treeCenter.z },
      radius: Math.max(85, Math.min(130, Math.min(treeSize.x, treeSize.z) * 0.24)),
      scaleVar: 1.0
    });
  });

  // Register unique thawing alien grass tufts as lightweight flora triggers
  const seenTuftCenters: Vector2[] = [];
  grassTuftNodes.forEach((tuftObj) => {
    const tBox = new THREE.Box3().setFromObject(tuftObj);
    const tCenter = new THREE.Vector3();
    tBox.getCenter(tCenter);
    if (tCenter.x >= 50 && tCenter.x <= WORLD_SIZE - 50 && tCenter.z >= 50 && tCenter.z <= WORLD_SIZE - 50) {
      const duplicate = seenTuftCenters.some((p) => Math.hypot(p.x - tCenter.x, p.y - tCenter.z) < 80);
      if (!duplicate) {
        seenTuftCenters.push({ x: tCenter.x, y: tCenter.z });
        propObstacles.push({
          id: `untitled_flora_tuft_${seenTuftCenters.length - 1}`,
          type: 'flora',
          pos: { x: tCenter.x, y: tCenter.z },
          radius: 14,
          scaleVar: 1.0
        });
      }
    }
  });

  const clampToBounds = (x: number, y: number, margin: number = 60): Vector2 => ({
    x: Math.max(walkableBounds.minX + margin, Math.min(walkableBounds.maxX - margin, x)),
    y: Math.max(walkableBounds.minY + margin, Math.min(walkableBounds.maxY - margin, y))
  });

  // Sample grid elevation helper to ensure events/pods sit on flat walkable light-brown terrain
  const sampleGridH = (wx: number, wy: number): number => {
    const gx = Math.max(0, Math.min(GRID_RES - 1, Math.round(wx / CELL_SIZE)));
    const gz = Math.max(0, Math.min(GRID_RES - 1, Math.round(wy / CELL_SIZE)));
    return heightGrid[gz * GRID_RES + gx];
  };

  // 1. PLAYER SPAWN: Southern dark-brown terrain right at the foot of the crashed ship (only spawn on dark-brown terrain)
  const spawnPos = clampToBounds(1625, 3395, 60);

  // 2. MAIN TELEPORTER: Exact geometric center of the tower's circular summit platform (Y ~ 2266)
  const artifactPos: Vector2 = { x: 1849, y: 683 };

  // 3. STAGE BOSS SPAWN: Large open eastern water formation (right side, clear of trees, rocks, and shore)
  const bossSpawnPos = clampToBounds(2900, 2500, 80);

  // 4. FOUR EVENTS: All on flat walkable light-brown terrain per placement plan
  const worldEventPositions: Vector2[] = [
    clampToBounds(2740, 1260, 70), // Event 1: Upper-right, east of the central tower
    clampToBounds(740, 1260, 70),  // Event 2: Upper-left, west of the central tower
    clampToBounds(1380, 1740, 70), // Event 3: Middle-left, slightly west of central axis, below tower
    clampToBounds(2280, 1740, 70)  // Event 4: Middle-right, slightly east of central axis, below tower
  ];

  // Pods distributed solely across valid light-brown terrain (never on dark-brown southern hills or water)
  const candidatePods: [number, number][] = [
    [980, 1620],
    [2580, 1560],
    [3060, 1420],
    [3120, 780],
    [2640, 560],
    [1140, 460],
    [520, 680],
    [540, 1680],
    [1780, 1780],
    [2140, 1460],
    [2480, 920],
    [920, 980]
  ];
  const podPositions: Vector2[] = candidatePods
    .map(([x, y]) => clampToBounds(x, y, 60))
    .filter((p) => sampleGridH(p.x, p.y) >= 100 && sampleGridH(p.x, p.y) <= 135);

  return {
    spawnPos,
    bossSpawnPos,
    artifactPos,
    worldEventPositions,
    podPositions,
    shipObstacles,
    propObstacles
  };
}

/**
 * Rasterizes the topmost walkable terrain surface onto the 361x361 TerrainSystem grid
 * using exact 2D barycentric interpolation in the XZ plane, and returns impassable inner bounds.
 */
function sampleMeshToHeightGrid(root: THREE.Object3D, isUntitledCraterMap: boolean = false): {
  heightGrid: Float32Array;
  minHeight: number;
  maxHeight: number;
  walkableBounds: { minX: number; maxX: number; minY: number; maxY: number };
  waterMask: Uint8Array | null;
  enemySpawnMask: Uint8Array | null;
} {
  const heightGrid = new Float32Array(GRID_RES * GRID_RES);
  const NEG_INF = -1e9;
  heightGrid.fill(NEG_INF);

  const waterGrid = isUntitledCraterMap ? new Float32Array(GRID_RES * GRID_RES).fill(NEG_INF) : null;
  const darkTerrainGrid = isUntitledCraterMap ? new Float32Array(GRID_RES * GRID_RES).fill(NEG_INF) : null;

  let tMinX = WORLD_SIZE;
  let tMaxX = 0;
  let tMinZ = WORLD_SIZE;
  let tMaxZ = 0;

  const vA = new THREE.Vector3();
  const vB = new THREE.Vector3();
  const vC = new THREE.Vector3();
  const edge1 = new THREE.Vector3();
  const edge2 = new THREE.Vector3();
  const triNorm = new THREE.Vector3();
  const meshBox = new THREE.Box3();
  const meshSize = new THREE.Vector3();

  root.traverse((obj) => {
    if (!isObjectVisibleInTree(obj)) return;
    const mesh = obj as THREE.Mesh;
    if (!mesh.isMesh || !mesh.geometry) return;

    const isWater = Boolean(isUntitledCraterMap && isUntitledWaterMesh(mesh));
    if (!isWater && isNonWalkableProp(obj, isUntitledCraterMap)) return;

    const geo = mesh.geometry as THREE.BufferGeometry;
    const pos = geo.attributes.position;
    if (!pos) return;

    geo.computeBoundingBox();
    let isDarkSouthernMesh = false;
    let isTowerMesh = false;
    if (isUntitledCraterMap && geo.boundingBox) {
      meshBox.copy(geo.boundingBox).applyMatrix4(mesh.matrixWorld);
      meshBox.getSize(meshSize);
      // Skip upright decorative ring arch perched at tower summit so teleporter platform stays flat at Y ~ 2266
      if (meshBox.min.y > 1900 && meshSize.y > 240 && meshSize.z < 60) {
        return;
      }
      if (!isWater && meshBox.min.z > 2400 && meshBox.max.z > 3350 && meshSize.x > 2000) {
        isDarkSouthernMesh = true;
      }
      if (!isWater && meshBox.max.y > 600 && meshBox.min.x >= 1100 && meshBox.max.x <= 2500 && meshBox.max.z <= 1550) {
        isTowerMesh = true;
      }
    }

    const mat = mesh.matrixWorld;
    const idx = geo.index;
    const triCount = idx ? Math.floor(idx.count / 3) : Math.floor(pos.count / 3);

    for (let t = 0; t < triCount; t++) {
      const i0 = idx ? idx.getX(t * 3) : t * 3;
      const i1 = idx ? idx.getX(t * 3 + 1) : t * 3 + 1;
      const i2 = idx ? idx.getX(t * 3 + 2) : t * 3 + 2;

      vA.fromBufferAttribute(pos, i0).applyMatrix4(mat);
      vB.fromBufferAttribute(pos, i1).applyMatrix4(mat);
      vC.fromBufferAttribute(pos, i2).applyMatrix4(mat);

      // Inside the stepped tower, discard purely vertical wall faces so wall edges never obscure step treads
      if (isTowerMesh) {
        edge1.subVectors(vB, vA);
        edge2.subVectors(vC, vA);
        triNorm.crossVectors(edge1, edge2);
        const nLen = triNorm.length();
        if (nLen <= 1e-6 || Math.abs(triNorm.y / nLen) < 0.30) {
          continue;
        }
      }

      const minX = Math.min(vA.x, vB.x, vC.x);
      const maxX = Math.max(vA.x, vB.x, vC.x);
      const minZ = Math.min(vA.z, vB.z, vC.z);
      const maxZ = Math.max(vA.z, vB.z, vC.z);

      if (maxX < 0 || minX > WORLD_SIZE || maxZ < 0 || minZ > WORLD_SIZE) continue;

      if (!isWater) {
        if (minX < tMinX) tMinX = Math.max(0, minX);
        if (maxX > tMaxX) tMaxX = Math.min(WORLD_SIZE, maxX);
        if (minZ < tMinZ) tMinZ = Math.max(0, minZ);
        if (maxZ > tMaxZ) tMaxZ = Math.min(WORLD_SIZE, maxZ);
      }

      const denom = (vB.z - vC.z) * (vA.x - vC.x) + (vC.x - vB.x) * (vA.z - vC.z);
      if (Math.abs(denom) < 1e-4) continue;

      const gx0 = Math.max(0, Math.floor(minX / CELL_SIZE));
      const gx1 = Math.min(GRID_RES - 1, Math.ceil(maxX / CELL_SIZE));
      const gz0 = Math.max(0, Math.floor(minZ / CELL_SIZE));
      const gz1 = Math.min(GRID_RES - 1, Math.ceil(maxZ / CELL_SIZE));

      for (let gz = gz0; gz <= gz1; gz++) {
        const pz = gz * CELL_SIZE;
        const rowOffset = gz * GRID_RES;
        for (let gx = gx0; gx <= gx1; gx++) {
          const px = gx * CELL_SIZE;
          const w0 = ((vB.z - vC.z) * (px - vC.x) + (vC.x - vB.x) * (pz - vC.z)) / denom;
          if (w0 < -0.002) continue;
          const w1 = ((vC.z - vA.z) * (px - vC.x) + (vA.x - vC.x) * (pz - vC.z)) / denom;
          if (w1 < -0.002) continue;
          const w2 = 1.0 - w0 - w1;
          if (w2 < -0.002) continue;

          const y = w0 * vA.y + w1 * vB.y + w2 * vC.y;
          const cell = rowOffset + gx;
          if (isWater && waterGrid) {
            if (y > waterGrid[cell]) waterGrid[cell] = y;
          } else {
            if (y > heightGrid[cell]) heightGrid[cell] = y;
            if (isDarkSouthernMesh && darkTerrainGrid && y > darkTerrainGrid[cell]) {
              darkTerrainGrid[cell] = y;
            }
          }
        }
      }
    }
  });

  // Inset playable boundary 100 units inside the actual terrain edge so map edges are impassable
  const edgeMargin = 100;
  const walkableBounds = {
    minX: Math.min(WORLD_SIZE * 0.4, Math.max(edgeMargin, tMinX + edgeMargin)),
    maxX: Math.max(WORLD_SIZE * 0.6, Math.min(WORLD_SIZE - edgeMargin, tMaxX - edgeMargin)),
    minY: Math.min(WORLD_SIZE * 0.4, Math.max(edgeMargin, tMinZ + edgeMargin)),
    maxY: Math.max(WORLD_SIZE * 0.6, Math.min(WORLD_SIZE - edgeMargin, tMaxZ - edgeMargin))
  };

  for (let i = 0; i < heightGrid.length; i++) {
    if (heightGrid[i] <= NEG_INF * 0.5) {
      heightGrid[i] = 10;
    }
  }

  let waterMask: Uint8Array | null = null;
  let enemySpawnMask: Uint8Array | null = null;

  if (isUntitledCraterMap && waterGrid && darkTerrainGrid) {
    waterMask = new Uint8Array(GRID_RES * GRID_RES);
    enemySpawnMask = new Uint8Array(GRID_RES * GRID_RES);

    // 1. Identify open water surface and raise the submerged trench bed to shallow wadeable depth (waterY - 11)
    // so both the Player and emerging Stage Boss wade/emerge smoothly at the waterline rather than falling into an abyss.
    for (let i = 0; i < heightGrid.length; i++) {
      const wy = waterGrid[i];
      if (wy > NEG_INF * 0.5 && wy > heightGrid[i] + 1.0 && darkTerrainGrid[i] <= wy + 0.5) {
        waterMask[i] = 1;
        heightGrid[i] = Math.max(heightGrid[i], wy - 11);
      }
    }

    // 2. Seamless collision bridge ONLY at the 4 tight protruding-pillar pinch points on the spiral staircase
    // (preserves every visual mesh untouched while making the side steps climbable from ground Y~108 to summit Y~2266).
    const raiseStepCell = (gx: number, gz: number, targetY: number) => {
      if (gx < 0 || gx >= GRID_RES || gz < 0 || gz >= GRID_RES) return;
      const idx = gz * GRID_RES + gx;
      if (heightGrid[idx] < targetY && heightGrid[idx] < targetY + 120) {
        heightGrid[idx] = targetY;
      }
    };
    // Pinch A (East lower): 405 -> 516 along Z=590..620, X=2350..2370
    for (let gx = 235; gx <= 237; gx++) {
      raiseStepCell(gx, 61, 442);
      raiseStepCell(gx, 60, 480);
      raiseStepCell(gx, 59, 516);
    }
    // Pinch A2 (South-East mid): 1196 -> 1231 along Z=1260..1290, X=2020..2040
    for (let gx = 202; gx <= 204; gx++) {
      if (heightGrid[128 * GRID_RES + gx] < 1850) {
        heightGrid[128 * GRID_RES + gx] = Math.max(heightGrid[128 * GRID_RES + gx], 1208);
      }
      if (heightGrid[127 * GRID_RES + gx] < 1850) {
        heightGrid[127 * GRID_RES + gx] = Math.max(heightGrid[127 * GRID_RES + gx], 1220);
      }
    }
    // Pinch B (East mid): 1303 -> 1399 around protruding 1935 buttress along X=2290..2310, Z=680..750
    for (let gz = 75; gz >= 68; gz--) {
      const frac = (76 - gz) / 8;
      const stepY = 1303 + frac * (1399 - 1303);
      for (let gx = 229; gx <= 231; gx++) {
        if (heightGrid[gz * GRID_RES + gx] < 1500) {
          heightGrid[gz * GRID_RES + gx] = Math.max(heightGrid[gz * GRID_RES + gx], stepY);
        }
      }
    }
    // Pinch B2 (North-East mid): 1399 -> 1480 around protruding 1988 buttress along Z=480..540, X=2190..2260
    const pinchB2Steps: Array<[number, number, number]> = [
      [53, 224, 1412], [53, 225, 1412],
      [52, 224, 1426], [52, 225, 1426],
      [51, 222, 1440], [51, 223, 1440], [51, 224, 1440],
      [50, 221, 1454], [50, 222, 1454], [50, 223, 1454],
      [49, 219, 1468], [49, 220, 1468], [49, 221, 1468],
      [48, 219, 1480], [48, 220, 1480]
    ];
    for (const [gz, gx, stepY] of pinchB2Steps) {
      if (heightGrid[gz * GRID_RES + gx] < 1600) {
        heightGrid[gz * GRID_RES + gx] = Math.max(heightGrid[gz * GRID_RES + gx], stepY);
      }
    }
    // Pinch C (North mid): 1480 -> 1553 around protruding 2041/2100 buttress along Z=320..350, X=1870..1960
    for (let gx = 196; gx >= 187; gx--) {
      const frac = (197 - gx) / 10;
      const stepY = 1480 + frac * (1553 - 1480);
      const maxGz = gx <= 188 ? 35 : 34;
      for (let gz = 32; gz <= maxGz; gz++) {
        if (heightGrid[gz * GRID_RES + gx] < 1650) {
          heightGrid[gz * GRID_RES + gx] = Math.max(heightGrid[gz * GRID_RES + gx], stepY);
        }
      }
    }
    // Pinch D (West mid): 1628 -> 1679 around protruding 2143 buttress along exterior lip X=1410..1450, Z=590..670
    for (let gz = 59; gz <= 66; gz++) {
      const frac = (gz - 58) / 9;
      const stepY = 1628 + frac * (1679 - 1628);
      for (let gx = 141; gx <= 142; gx++) {
        if (heightGrid[gz * GRID_RES + gx] < 1850) {
          heightGrid[gz * GRID_RES + gx] = Math.max(heightGrid[gz * GRID_RES + gx], stepY);
        }
      }
    }
    for (let gx = 143; gx <= 145; gx++) {
      for (let gz = 65; gz <= 67; gz++) {
        if (heightGrid[gz * GRID_RES + gx] < 1850) {
          heightGrid[gz * GRID_RES + gx] = Math.max(heightGrid[gz * GRID_RES + gx], 1679);
        }
      }
    }

    // 3. Build Enemy Spawn Mask strictly on valid walkable LIGHT-BROWN terrain around the tower:
    // excludes water, dark-brown southern terrain, steep tower cliffs, and a 2-cell coastal buffer.
    for (let gz = 14; gz <= GRID_RES - 15; gz++) {
      const pz = gz * CELL_SIZE;
      if (pz >= 2720) continue; // Strictly exclude dark-brown southern half
      for (let gx = 14; gx <= GRID_RES - 15; gx++) {
        const px = gx * CELL_SIZE;
        if (px < walkableBounds.minX + 35 || px > walkableBounds.maxX - 35 || pz < walkableBounds.minY + 35) continue;
        const c = gz * GRID_RES + gx;
        const h = heightGrid[c];
        if (waterMask[c] || darkTerrainGrid[c] > NEG_INF * 0.5 || h > 155 || h < 98) continue;

        let blockedNeighbor = false;
        for (let oz = -2; oz <= 2 && !blockedNeighbor; oz++) {
          for (let ox = -2; ox <= 2; ox++) {
            const nc = (gz + oz) * GRID_RES + (gx + ox);
            if (waterMask[nc] || darkTerrainGrid[nc] > NEG_INF * 0.5 || Math.abs(heightGrid[nc] - h) > 18) {
              blockedNeighbor = true;
              break;
            }
          }
        }
        if (!blockedNeighbor) {
          enemySpawnMask[c] = 1;
        }
      }
    }
  }

  let minHeight = Infinity;
  let maxHeight = -Infinity;
  for (let i = 0; i < heightGrid.length; i++) {
    if (heightGrid[i] < minHeight) minHeight = heightGrid[i];
    if (heightGrid[i] > maxHeight) maxHeight = heightGrid[i];
  }

  return { heightGrid, minHeight, maxHeight, walkableBounds, waterMask, enemySpawnMask };
}

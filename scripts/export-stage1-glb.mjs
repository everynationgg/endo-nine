import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { stripTypeScriptTypes } from 'node:module';
import * as THREE from 'three';
import { GLTFExporter } from 'three/examples/jsm/exporters/GLTFExporter.js';
import sharp from 'sharp';

const ROOT = process.cwd();
const OUT_DIR = path.join(ROOT, 'exports');
const TMP_DIR = path.join(OUT_DIR, '.tmp');
fs.mkdirSync(OUT_DIR, { recursive: true });
fs.mkdirSync(TMP_DIR, { recursive: true });

// Polyfill FileReader for GLTFExporter binary (.glb) mode in Node
if (typeof globalThis.FileReader === 'undefined') {
  globalThis.FileReader = class FileReader {
    readAsArrayBuffer(blob) {
      blob.arrayBuffer().then((buf) => {
        this.result = buf;
        if (this.onloadend) this.onloadend({ target: this });
        else if (this.onload) this.onload({ target: this });
      });
    }
    readAsDataURL(blob) {
      blob.arrayBuffer().then((buf) => {
        const base64 = Buffer.from(buf).toString('base64');
        this.result = `data:${blob.type || 'application/octet-stream'};base64,${base64}`;
        if (this.onloadend) this.onloadend({ target: this });
        else if (this.onload) this.onload({ target: this });
      });
    }
  };
}

// Strip TS types using Node 24's built-in stripTypeScriptTypes and rewrite local imports to .mjs
for (const rel of ['ItemDefs.ts', 'TerrainSystem.ts']) {
  const srcText = fs.readFileSync(path.join(ROOT, 'src/sim', rel), 'utf8');
  let jsText = stripTypeScriptTypes(srcText, { mode: 'strip' });
  jsText = jsText.replace(/import\s+\{[^}]*\}\s+from\s+['"]\.\/types['"];?/g, '');
  jsText = jsText.replace(/from\s+['"]\.\/ItemDefs['"]/g, "from './ItemDefs.mjs'");
  fs.writeFileSync(path.join(TMP_DIR, rel.replace(/\.ts$/, '.mjs')), jsText);
}

const { TerrainSystem } = await import(pathToFileURL(path.join(TMP_DIR, 'TerrainSystem.mjs')).href);
fs.rmSync(TMP_DIR, { recursive: true, force: true });

const seedArg = Number(process.argv[2]);
const seed = Number.isFinite(seedArg) && seedArg > 0 ? seedArg : 133799;
const terrain = new TerrainSystem(seed);

const halfW = terrain.worldWidth / 2;
const halfH = terrain.worldHeight / 2;

const scene = new THREE.Scene();
scene.name = 'EndoNine_Stage1_Scene';

// 1. Playable Terrain Mesh (matches ThreeTerrain.ts: 160x160 grid, 3600x3600)
const segs = 160;
const groundGeo = new THREE.PlaneGeometry(terrain.worldWidth, terrain.worldHeight, segs, segs);
const posAttr = groundGeo.attributes.position;

for (let i = 0; i < posAttr.count; i++) {
  const lx = posAttr.getX(i);
  const ly = posAttr.getY(i);
  const wx = lx + halfW;
  const wy = -ly + halfH;
  const height = terrain.calculateHeight(wx, wy);
  posAttr.setZ(i, height);
}
posAttr.needsUpdate = true;
groundGeo.computeVertexNormals();

// Color vertices by slope & elevation for easy visual navigation in Blender
const normAttr = groundGeo.attributes.normal;
const colors = new Float32Array(posAttr.count * 3);
for (let i = 0; i < posAttr.count; i++) {
  const h = posAttr.getZ(i);
  // Note: before -PI/2 X rotation, local Z is world Y (up)
  const nz = Math.abs(normAttr.getZ(i));
  const slope = 1.0 - nz;

  let r = 0.24, g = 0.42, b = 0.30; // Valley thawed soil/moss
  if (h > 550) {
    r = 0.36; g = 0.56; b = 0.52; // Upper summit
  } else if (h > 210) {
    r = 0.32; g = 0.52; b = 0.34; // Middle plateau
  } else if (h < 6) {
    r = 0.16; g = 0.34; b = 0.46; // Riverbed
  }
  if (slope > 0.28 || h >= 750) {
    // Steep cliff / impassable boundary
    r = 0.28; g = 0.34; b = 0.44;
  }
  colors[i * 3] = r;
  colors[i * 3 + 1] = g;
  colors[i * 3 + 2] = b;
}
groundGeo.setAttribute('color', new THREE.BufferAttribute(colors, 3));

const groundMat = new THREE.MeshStandardMaterial({
  vertexColors: true,
  roughness: 0.85,
  metalness: 0.05
});
const groundMesh = new THREE.Mesh(groundGeo, groundMat);
groundMesh.name = 'Playable_Terrain';
groundMesh.rotation.x = -Math.PI / 2;
groundMesh.position.set(halfW, 0, halfH);
scene.add(groundMesh);

// 2. Valley River Mesh (matches ThreeTerrain.ts)
const riverWidth = 140;
const riverLength = 1000;
const riverGeo = new THREE.PlaneGeometry(riverWidth, riverLength, 16, 64);
const rPos = riverGeo.attributes.position;
const waterLevel = 5.2;
for (let i = 0; i < rPos.count; i++) {
  const lx = rPos.getX(i);
  const ly = rPos.getY(i);
  const wy = 2600 - (ly / (riverLength / 2)) * 500;
  const streamCenterX = 1300 + Math.sin(wy * 0.0035) * 80 + Math.cos(wy * 0.0018) * 40;
  const wx = streamCenterX + lx;
  const groundH = terrain.calculateHeight(wx, wy);
  const waterH = Math.min(waterLevel, groundH + 0.1);
  rPos.setXYZ(i, wx, groundH < waterLevel ? waterLevel : waterH, wy);
}
riverGeo.computeVertexNormals();
const riverMesh = new THREE.Mesh(
  riverGeo,
  new THREE.MeshStandardMaterial({ color: 0x38bdf8, roughness: 0.2 })
);
riverMesh.name = 'Stage1_Valley_River';
scene.add(riverMesh);

// 3. Landmark Reference Markers (so you can see spawn, ship, artifact, plateaus, and rim in Blender)
const markersGroup = new THREE.Group();
markersGroup.name = 'Reference_Landmarks';

const addMarker = (name, wx, wy, colorHex, radius, height) => {
  const elev = terrain.calculateHeight(wx, wy);
  const geo = new THREE.CylinderGeometry(radius, radius, height, 16);
  const mat = new THREE.MeshStandardMaterial({ color: colorHex, roughness: 0.5 });
  const mesh = new THREE.Mesh(geo, mat);
  mesh.name = name;
  mesh.position.set(wx, elev + height * 0.5, wy);
  markersGroup.add(mesh);
};

addMarker('Marker_PlayerSpawn', 1800, 2480, 0x22c55e, 24, 60);
addMarker('Marker_CrashedShip_Hull', 1800, 2960, 0x38bdf8, 120, 140);
addMarker('Marker_MiddlePlateau', terrain.middlePlateauCenter.x, terrain.middlePlateauCenter.y, 0xfacc15, 45, 70);
addMarker('Marker_UpperSummit_Artifact', terrain.upperPlateauCenter.x, terrain.upperPlateauCenter.y, 0xa855f7, 50, 120);

// Rim guide ring at r = 1500 around (1800, 1800)
const rimGeo = new THREE.RingGeometry(1490, 1510, 64);
const rimMat = new THREE.MeshBasicMaterial({ color: 0xef4444, side: THREE.DoubleSide });
const rimMesh = new THREE.Mesh(rimGeo, rimMat);
rimMesh.name = 'Guide_CraterRim_r1500';
rimMesh.rotation.x = -Math.PI / 2;
rimMesh.position.set(halfW, 40, halfH);
markersGroup.add(rimMesh);

scene.add(markersGroup);

// 4. Export GLB
const exporter = new GLTFExporter();
const glbBuffer = await exporter.parseAsync(scene, { binary: true });
const glbPath = path.join(OUT_DIR, 'stage1_map.glb');
fs.writeFileSync(glbPath, Buffer.from(glbBuffer));

// 5. Export 16-bit Heightmap PNG + Metadata
const gridSize = 361;
let minH = Infinity;
let maxH = -Infinity;
for (let i = 0; i < terrain.heightGrid.length; i++) {
  const v = terrain.heightGrid[i];
  if (v < minH) minH = v;
  if (v > maxH) maxH = v;
}
const hSpan = Math.max(1, maxH - minH);
const u16 = new Uint16Array(gridSize * gridSize);
for (let i = 0; i < terrain.heightGrid.length; i++) {
  const norm = (terrain.heightGrid[i] - minH) / hSpan;
  u16[i] = Math.max(0, Math.min(65535, Math.round(norm * 65535)));
}

// sharp expects big-endian or native uint16 buffer via raw({ width, height, channels: 1 })
const heightmapPath = path.join(OUT_DIR, 'stage1_heightmap_16bit.png');
await sharp(Buffer.from(u16.buffer), {
  raw: { width: gridSize, height: gridSize, channels: 1, depth: 'ushort' }
})
  .png({ bitdepth: 16, compressionLevel: 9 })
  .toFile(heightmapPath);

const metaPath = path.join(OUT_DIR, 'stage1_metadata.json');
fs.writeFileSync(
  metaPath,
  JSON.stringify(
    {
      seed,
      worldWidth: terrain.worldWidth,
      worldHeight: terrain.worldHeight,
      gridResolution: gridSize,
      minHeight: minH,
      maxHeight: maxH,
      heightSpan: hSpan,
      middlePlateauCenter: terrain.middlePlateauCenter,
      upperPlateauCenter: terrain.upperPlateauCenter,
      spawnPos: { x: 1800, y: 2480 },
      shipPos: { x: 1800, y: 2960 },
      blenderTip: 'Import stage1_map.glb directly in Blender (File -> Import -> glTF 2.0). Scene coordinates are 1:1 in game units (3600x3600). In Blender, press Home or adjust Clip End to 20000 in the N-panel View tab so the full 3600x3600 map stays visible.'
    },
    null,
    2
  )
);

console.log('Exported:', glbPath, fs.statSync(glbPath).size, 'bytes');
console.log('Exported:', heightmapPath, fs.statSync(heightmapPath).size, 'bytes');
console.log('Exported:', metaPath);

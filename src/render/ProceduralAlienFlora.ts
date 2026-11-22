import * as THREE from 'three';
import { MeshTerrainCollider } from '../sim/MeshTerrainCollider';
import { LoadedTestMap } from './TestMapLoader';
import { SeededRandom } from '../sim/ItemDefs';

export interface ProceduralFloraBuildResult {
  group: THREE.Group;
  lightAnchors: Array<{ pos: THREE.Vector3; color: number }>;
  floraPositions: Array<{ x: number; y: number; z: number }>;
  stats: {
    trees: number;
    crystals: number;
    rocks: number;
    mushrooms: number;
    shorelines: number;
    batchMeshCount: number;
    totalVertices: number;
  };
}

interface MeshBufferBuilder {
  positions: number[];
  normals: number[];
  colors: number[];
  indices: number[];
}

function createBuilder(): MeshBufferBuilder {
  return { positions: [], normals: [], colors: [], indices: [] };
}

function finalizeBuilderGeometry(b: MeshBufferBuilder): THREE.BufferGeometry {
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(b.positions, 3));
  geo.setAttribute('normal', new THREE.Float32BufferAttribute(b.normals, 3));
  geo.setAttribute('color', new THREE.Float32BufferAttribute(b.colors, 3));
  geo.setIndex(b.indices);
  geo.computeVertexNormals();
  geo.computeBoundingSphere();
  return geo;
}

/** Deterministic spatial hash in [-1, 1] for unique per-instance organic surface displacement. */
function hash3(x: number, y: number, z: number, seed: number): number {
  const h = Math.sin(x * 12.9898 + y * 78.233 + z * 37.719 + seed * 19.313) * 43758.5453;
  return (h - Math.floor(h)) * 2 - 1;
}

/** Appends a multi-ring organic bent & tapered tube (roots, trunks, branches, fungal stems). */
function appendOrganicTube(
  b: MeshBufferBuilder,
  spine: THREE.Vector3[],
  radii: number[],
  radialSegments: number,
  colorAt: (t: number, ringAngle: number, ringIdx: number) => THREE.Color,
  warpAmp: number,
  seed: number,
  capTop: boolean = true
): void {
  if (spine.length < 2) return;
  const baseVertex = b.positions.length / 3;
  const up = new THREE.Vector3(0, 1, 0);
  const altUp = new THREE.Vector3(1, 0, 0);
  const tangent = new THREE.Vector3();
  const normal = new THREE.Vector3();
  const binormal = new THREE.Vector3();

  for (let i = 0; i < spine.length; i++) {
    const t = i / (spine.length - 1);
    const p = spine[i];
    if (i === 0) {
      tangent.subVectors(spine[1], spine[0]).normalize();
    } else if (i === spine.length - 1) {
      tangent.subVectors(spine[i], spine[i - 1]).normalize();
    } else {
      tangent.subVectors(spine[i + 1], spine[i - 1]).normalize();
    }

    const refAxis = Math.abs(tangent.dot(up)) > 0.92 ? altUp : up;
    normal.crossVectors(tangent, refAxis).normalize();
    binormal.crossVectors(tangent, normal).normalize();

    const rBase = radii[i];
    for (let j = 0; j <= radialSegments; j++) {
      const ang = (j / radialSegments) * Math.PI * 2;
      const noise = 1 + warpAmp * hash3(p.x * 0.08 + Math.cos(ang), p.y * 0.08, p.z * 0.08 + Math.sin(ang), seed + i * 7);
      const r = Math.max(0.4, rBase * noise);
      const cx = Math.cos(ang) * r;
      const cz = Math.sin(ang) * r;

      const vx = p.x + normal.x * cx + binormal.x * cz;
      const vy = p.y + normal.y * cx + binormal.y * cz;
      const vz = p.z + normal.z * cx + binormal.z * cz;

      b.positions.push(vx, vy, vz);
      const nx = normal.x * Math.cos(ang) + binormal.x * Math.sin(ang);
      const ny = normal.y * Math.cos(ang) + binormal.y * Math.sin(ang);
      const nz = normal.z * Math.cos(ang) + binormal.z * Math.sin(ang);
      b.normals.push(nx, ny, nz);

      const c = colorAt(t, ang, i);
      b.colors.push(c.r, c.g, c.b);
    }
  }

  const stride = radialSegments + 1;
  for (let i = 0; i < spine.length - 1; i++) {
    for (let j = 0; j < radialSegments; j++) {
      const a = baseVertex + i * stride + j;
      const d = baseVertex + (i + 1) * stride + j;
      const bIdx = a + 1;
      const cIdx = d + 1;
      b.indices.push(a, d, bIdx);
      b.indices.push(bIdx, d, cIdx);
    }
  }

  if (capTop) {
    const tip = spine[spine.length - 1];
    const tipCol = colorAt(1, 0, spine.length - 1);
    const tipIdx = b.positions.length / 3;
    b.positions.push(tip.x, tip.y, tip.z);
    b.normals.push(tangent.x, tangent.y, tangent.z);
    b.colors.push(tipCol.r, tipCol.g, tipCol.b);
    const lastRing = baseVertex + (spine.length - 1) * stride;
    for (let j = 0; j < radialSegments; j++) {
      b.indices.push(lastRing + j, tipIdx, lastRing + j + 1);
    }
  }
}

/** Appends a noise-sculpted asymmetric organic blob (for unique tree foliage lobes & boulders). */
function appendWarpedBlob(
  b: MeshBufferBuilder,
  center: THREE.Vector3,
  scaleX: number,
  scaleY: number,
  scaleZ: number,
  detail: number,
  seed: number,
  warpAmp: number,
  colorFn: (dir: THREE.Vector3, localYNorm: number, nVal: number) => THREE.Color,
  squashFlatBottom: boolean = false
): void {
  const unit = new THREE.IcosahedronGeometry(1, detail);
  const nonIndexed = unit.index ? unit.toNonIndexed() : unit;
  const posAttr = nonIndexed.getAttribute('position') as THREE.BufferAttribute;
  const phaseA = (seed % 97) * 0.41;
  const phaseB = (seed % 53) * 0.73;

  const baseIdx = b.positions.length / 3;
  const dir = new THREE.Vector3();
  for (let i = 0; i < posAttr.count; i++) {
    dir.set(posAttr.getX(i), posAttr.getY(i), posAttr.getZ(i)).normalize();

    const wave1 = Math.sin(dir.x * 3.1 + phaseA) * Math.cos(dir.z * 2.7 + phaseB);
    const wave2 = Math.sin(dir.y * 4.3 + phaseB) * Math.cos(dir.x * 3.9 - phaseA);
    const hVal = hash3(dir.x * 2.4, dir.y * 2.4, dir.z * 2.4, seed);
    const disp = 1 + warpAmp * (wave1 * 0.48 + wave2 * 0.30 + hVal * 0.22);

    let lx = dir.x * scaleX * disp;
    let ly = dir.y * scaleY * disp;
    let lz = dir.z * scaleZ * disp;
    if (squashFlatBottom && ly < -scaleY * 0.35) {
      ly = -scaleY * 0.35 + (ly + scaleY * 0.35) * 0.22;
    }

    b.positions.push(center.x + lx, center.y + ly, center.z + lz);
    b.normals.push(dir.x, dir.y, dir.z);

    const c = colorFn(dir, dir.y, disp);
    b.colors.push(c.r, c.g, c.b);
  }

  for (let i = 0; i < posAttr.count; i += 3) {
    b.indices.push(baseIdx + i, baseIdx + i + 1, baseIdx + i + 2);
  }
  unit.dispose();
  if (nonIndexed !== unit) nonIndexed.dispose();
}

/** Appends a single tapered multi-faceted alien crystal spire oriented along a tilted axis. */
function appendCrystalSpire(
  b: MeshBufferBuilder,
  base: THREE.Vector3,
  dir: THREE.Vector3,
  length: number,
  baseRadius: number,
  sides: number,
  baseCol: THREE.Color,
  tipCol: THREE.Color,
  seed: number
): void {
  const ax = dir.clone().normalize();
  const ref = Math.abs(ax.y) > 0.9 ? new THREE.Vector3(1, 0, 0) : new THREE.Vector3(0, 1, 0);
  const u = new THREE.Vector3().crossVectors(ax, ref).normalize();
  const v = new THREE.Vector3().crossVectors(ax, u).normalize();

  const rings = 3; // base, mid-shoulder, narrow-shoulder
  const shoulderT = [0, 0.24, 0.78];
  const shoulderR = [baseRadius * 0.85, baseRadius * 1.05, baseRadius * 0.62];
  const baseVtx = b.positions.length / 3;
  const col = new THREE.Color();

  for (let r = 0; r < rings; r++) {
    const t = shoulderT[r];
    const center = base.clone().addScaledVector(ax, length * t);
    const rad = shoulderR[r];
    col.copy(baseCol).lerp(tipCol, t * 0.85);
    for (let s = 0; s <= sides; s++) {
      const a = (s / sides) * Math.PI * 2 + (seed % 7) * 0.25;
      const asym = 0.82 + 0.36 * (0.5 + 0.5 * hash3(Math.cos(a), r, Math.sin(a), seed));
      const px = center.x + (u.x * Math.cos(a) + v.x * Math.sin(a)) * rad * asym;
      const py = center.y + (u.y * Math.cos(a) + v.y * Math.sin(a)) * rad * asym;
      const pz = center.z + (u.z * Math.cos(a) + v.z * Math.sin(a)) * rad * asym;
      b.positions.push(px, py, pz);
      b.normals.push(u.x * Math.cos(a) + v.x * Math.sin(a), u.y * Math.cos(a) + v.y * Math.sin(a), u.z * Math.cos(a) + v.z * Math.sin(a));
      b.colors.push(col.r, col.g, col.b);
    }
  }

  const stride = sides + 1;
  for (let r = 0; r < rings - 1; r++) {
    for (let s = 0; s < sides; s++) {
      const i0 = baseVtx + r * stride + s;
      const i1 = i0 + stride;
      b.indices.push(i0, i1, i0 + 1);
      b.indices.push(i0 + 1, i1, i1 + 1);
    }
  }

  // Asymmetric chisel tip point
  const tipOffset = hash3(base.x, length, seed, 99) * baseRadius * 0.32;
  const tip = base
    .clone()
    .addScaledVector(ax, length)
    .addScaledVector(u, tipOffset);
  const tipIdx = b.positions.length / 3;
  b.positions.push(tip.x, tip.y, tip.z);
  b.normals.push(ax.x, ax.y, ax.z);
  b.colors.push(tipCol.r, tipCol.g, tipCol.b);
  const topRing = baseVtx + (rings - 1) * stride;
  for (let s = 0; s < sides; s++) {
    b.indices.push(topRing + s, tipIdx, topRing + s + 1);
  }
}

/** Appends a curved fungal cap or organic tendril cluster on damp thawed terrain. */
function appendAlienMushroom(
  stemBuilder: MeshBufferBuilder,
  capBuilder: MeshBufferBuilder,
  rootPos: THREE.Vector3,
  height: number,
  capRadius: number,
  leanX: number,
  leanZ: number,
  stemCol: THREE.Color,
  capInnerCol: THREE.Color,
  capRimCol: THREE.Color,
  seed: number
): void {
  const spine = [
    new THREE.Vector3(rootPos.x, rootPos.y - 6, rootPos.z),
    new THREE.Vector3(rootPos.x + leanX * 0.45, rootPos.y + height * 0.45, rootPos.z + leanZ * 0.45),
    new THREE.Vector3(rootPos.x + leanX, rootPos.y + height * 0.92, rootPos.z + leanZ)
  ];
  const stemR = Math.max(2.2, capRadius * 0.22);
  appendOrganicTube(
    stemBuilder,
    spine,
    [stemR * 1.45, stemR * 0.85, stemR * 0.72],
    6,
    (t) => stemCol.clone().lerp(capInnerCol, t * 0.4),
    0.16,
    seed,
    false
  );

  // Sculpted organic domed / bell mushroom cap (warped half-ovoid skirt + crown)
  const capCenter = spine[2].clone();
  const radialSegs = 9;
  const latRings = 4;
  const baseIdx = capBuilder.positions.length / 3;
  const capTiltX = Math.atan2(leanZ, height) * 0.45;
  const capTiltZ = -Math.atan2(leanX, height) * 0.45;
  const tiltQuat = new THREE.Quaternion().setFromEuler(new THREE.Euler(capTiltX, 0, capTiltZ));
  const vLocal = new THREE.Vector3();
  const nLocal = new THREE.Vector3();

  for (let lr = 0; lr < latRings; lr++) {
    const phi = (lr / (latRings - 1)) * (Math.PI * 0.56);
    const rRing = Math.sin(phi) * capRadius;
    const yRing = Math.cos(phi) * capRadius * 0.58;
    const tCol = capInnerCol.clone().lerp(capRimCol, lr / (latRings - 1));
    for (let s = 0; s <= radialSegs; s++) {
      const ang = (s / radialSegs) * Math.PI * 2;
      const frill = 1 + 0.22 * hash3(Math.cos(ang) * 2, lr, Math.sin(ang) * 2, seed);
      vLocal.set(Math.cos(ang) * rRing * frill, yRing - (lr === latRings - 1 ? 3 : 0), Math.sin(ang) * rRing * frill);
      vLocal.applyQuaternion(tiltQuat).add(capCenter);
      nLocal.set(Math.cos(ang) * Math.sin(phi), Math.cos(phi), Math.sin(ang) * Math.sin(phi)).normalize().applyQuaternion(tiltQuat);
      capBuilder.positions.push(vLocal.x, vLocal.y, vLocal.z);
      capBuilder.normals.push(nLocal.x, nLocal.y, nLocal.z);
      capBuilder.colors.push(tCol.r, tCol.g, tCol.b);
    }
  }

  const stride = radialSegs + 1;
  for (let lr = 0; lr < latRings - 1; lr++) {
    for (let s = 0; s < radialSegs; s++) {
      const a = baseIdx + lr * stride + s;
      const d = a + stride;
      capBuilder.indices.push(a, d, a + 1);
      capBuilder.indices.push(a + 1, d, d + 1);
    }
  }
}

/** Creates Material with soft per-vertex bioluminescence emission that requires zero external textures. */
function makeBiolumFloraMaterial(emissiveGain: number, roughness: number, metalness: number): THREE.MeshStandardMaterial {
  const mat = new THREE.MeshStandardMaterial({
    vertexColors: true,
    roughness,
    metalness
  });
  mat.customProgramCacheKey = () => `stage1_flora_glow_v1_${emissiveGain.toFixed(2)}`;
  mat.onBeforeCompile = (shader) => {
    shader.uniforms.uGlowGain = { value: emissiveGain };
    shader.fragmentShader = shader.fragmentShader
      .replace(
        'void main() {',
        `uniform float uGlowGain;\nvoid main() {`
      )
      .replace(
        '#include <emissivemap_fragment>',
        `#include <emissivemap_fragment>
  #ifdef USE_COLOR
    totalEmissiveRadiance += vColor.rgb * uGlowGain;
  #endif`
      );
  };
  return mat;
}

/** Builds a single batched Stage 1 procedural flora/mineral environment group with unique 3D organisms. */
export function buildStage1ProceduralFlora(
  col: MeshTerrainCollider,
  loaded: LoadedTestMap,
  seed: number = 948271
): ProceduralFloraBuildResult {
  const group = new THREE.Group();
  group.name = 'stage1_procedural_flora_root';
  const lightAnchors: Array<{ pos: THREE.Vector3; color: number }> = [];
  const floraPositions: Array<{ x: number; y: number; z: number }> = [];
  const rng = new SeededRandom(seed);

  const bounds = loaded.walkableBounds;
  const minX = bounds.minX + 120;
  const maxX = bounds.maxX - 120;
  const minY = bounds.minY + 120;
  const maxY = bounds.maxY - 120;

  const isClearOfKeyLandmarks = (wx: number, wy: number): boolean => {
    if (Math.hypot(wx - loaded.spawnPos.x, wy - loaded.spawnPos.y) < 220) return false;
    if (Math.hypot(wx - loaded.artifactPos.x, wy - loaded.artifactPos.y) < 860) return false;
    if (loaded.shipBox) {
      const sb = loaded.shipBox;
      if (wx >= sb.minX - 95 && wx <= sb.maxX + 95 && wy >= sb.minZ - 95 && wy <= sb.maxZ + 95) {
        return false;
      }
    }
    return true;
  };

  const trunkBuilder = createBuilder();
  const blossomBuilder = createBuilder();
  const boulderBuilder = createBuilder();
  const crystalBuilder = createBuilder();
  const floraGlowBuilder = createBuilder();
  const shadowBuilder = createBuilder();

  const addGroundAO = (wx: number, wy: number, wz: number, radius: number, alpha: number): void => {
    const segs = 8;
    const centerIdx = shadowBuilder.positions.length / 3;
    shadowBuilder.positions.push(wx, wz + 1.0, wy);
    shadowBuilder.normals.push(0, 1, 0);
    shadowBuilder.colors.push(alpha, 0, 0);
    for (let s = 0; s < segs; s++) {
      const a = (s / segs) * Math.PI * 2;
      const sx = wx + Math.cos(a) * radius;
      const sz = wy + Math.sin(a) * radius;
      const edgeSup = col.querySupport(sx, sz, wz + 40, 40);
      const ey = edgeSup.hit ? edgeSup.height + 0.8 : wz + 0.8;
      shadowBuilder.positions.push(sx, ey, sz);
      shadowBuilder.normals.push(0, 1, 0);
      shadowBuilder.colors.push(0, 0, 0);
    }
    for (let s = 0; s < segs; s++) {
      shadowBuilder.indices.push(centerIdx, centerIdx + 1 + ((s + 1) % segs), centerIdx + 1 + s);
    }
  };

  // 1. Unique Procedural Alien Trees (each seed yields distinct curvature, limb topology & bioluminescent canopy)
  const treePalettes = [
    { barkA: 0x1d2838, barkB: 0x2c4257, leafBase: 0x1b6e82, leafTip: 0x5be4ff, light: 0x38bdf8 },
    { barkA: 0x291a2d, barkB: 0x452242, leafBase: 0x731d47, leafTip: 0xfb7185, light: 0xf43f5e },
    { barkA: 0x211d36, barkB: 0x362b5c, leafBase: 0x4c2482, leafTip: 0xc084fc, light: 0xa855f7 },
    { barkA: 0x182b2a, barkB: 0x244644, leafBase: 0x146b5c, leafTip: 0x34d399, light: 0x2dd4bf }
  ];

  let treeCount = 0;
  for (let attempt = 0; attempt < 950 && treeCount < 130; attempt++) {
    const wx = rng.range(minX, maxX);
    const wy = rng.range(minY, maxY);
    if (!isClearOfKeyLandmarks(wx, wy)) continue;
    const sup = col.querySupport(wx, wy, 1e6, 56);
    if (!sup.hit || sup.category !== 'ground' || sup.isInWater) continue;
    if (sup.sourceTag === 'water:frozen_ice' || sup.sourceTag === 'node:tower_walkway') continue;
    if (sup.normalY < 0.66 || sup.height < 566 || sup.height > 1350) continue;

    const pal = treePalettes[Math.floor(rng.next() * treePalettes.length)];
    const treeSeed = seed + attempt * 31 + treeCount * 137;
    const height = rng.range(185, 325);
    const baseR = rng.range(9.5, 16.5);
    const leanX = rng.range(-36, 36);
    const leanZ = rng.range(-36, 36);
    const twist = rng.range(-0.9, 0.9);
    const barkBaseCol = new THREE.Color(pal.barkA);
    const barkMidCol = new THREE.Color(pal.barkB);
    const frostHighlight = new THREE.Color(0x9bb8d6);
    const leafBaseCol = new THREE.Color(pal.leafBase);
    const leafTipCol = new THREE.Color(pal.leafTip);

    // Sinuous multi-segment main trunk rooted -16u into soil
    const trunkPts: THREE.Vector3[] = [];
    const trunkRadii: number[] = [];
    const segCount = 5;
    for (let s = 0; s < segCount; s++) {
      const t = s / (segCount - 1);
      const waveX = Math.sin(t * Math.PI * 1.4 + treeSeed * 0.1) * 10 * t;
      const waveZ = Math.cos(t * Math.PI * 1.2 + treeSeed * 0.2) * 10 * t;
      trunkPts.push(
        new THREE.Vector3(
          wx + leanX * Math.pow(t, 1.15) + waveX,
          sup.height - 16 + t * (height * 0.68),
          wy + leanZ * Math.pow(t, 1.15) + waveZ
        )
      );
      trunkRadii.push(baseR * (1 - 0.68 * Math.pow(t, 0.85)));
    }

    appendOrganicTube(
      trunkBuilder,
      trunkPts,
      trunkRadii,
      7,
      (t, ang) => {
        const c = barkBaseCol.clone().lerp(barkMidCol, t);
        if (Math.sin(ang + twist) > 0.45 && t > 0.25) c.lerp(frostHighlight, 0.18);
        return c;
      },
      0.22,
      treeSeed,
      true
    );

    // 3..5 Unique flaring buttress roots gripping crater rock/soil
    const rootCount = 3 + Math.floor(rng.next() * 3);
    for (let r = 0; r < rootCount; r++) {
      const rAng = (r / rootCount) * Math.PI * 2 + rng.range(-0.42, 0.42);
      const rSpan = baseR * rng.range(1.9, 3.0);
      const rx = wx + Math.cos(rAng) * rSpan;
      const rz = wy + Math.sin(rAng) * rSpan;
      const tipSup = col.querySupport(rx, rz, sup.height + 40, 60);
      const tipY = tipSup.hit ? tipSup.height - 10 : sup.height - 12;
      const midR = rSpan * 0.55;
      appendOrganicTube(
        trunkBuilder,
        [
          new THREE.Vector3(wx + Math.cos(rAng) * baseR * 0.35, sup.height + rng.range(18, 38), wy + Math.sin(rAng) * baseR * 0.35),
          new THREE.Vector3(wx + Math.cos(rAng) * midR, sup.height + 6, wy + Math.sin(rAng) * midR),
          new THREE.Vector3(rx, tipY, rz)
        ],
        [baseR * 0.45, baseR * 0.32, baseR * 0.14],
        5,
        () => barkBaseCol,
        0.18,
        treeSeed + r * 19,
        true
      );
    }

    // 3..6 Unique asymmetrical canopy limbs + organic bioluminescent foliage lobes
    const limbCount = 3 + Math.floor(rng.next() * 4);
    const trunkTop = trunkPts[trunkPts.length - 1];
    for (let b = 0; b < limbCount; b++) {
      const attachT = rng.range(0.55, 1.0);
      const attachIdx = Math.min(trunkPts.length - 1, Math.floor(attachT * (trunkPts.length - 1)));
      const origin = trunkPts[attachIdx];
      const bAng = (b / limbCount) * Math.PI * 2 + rng.range(-0.55, 0.55) + twist;
      const reach = rng.range(36, 78);
      const rise = rng.range(28, 72);
      const bendY = rng.range(-10, 18);
      const limbMid = new THREE.Vector3(
        origin.x + Math.cos(bAng) * reach * 0.52,
        origin.y + rise * 0.55 + bendY,
        origin.z + Math.sin(bAng) * reach * 0.52
      );
      const limbTip = new THREE.Vector3(
        origin.x + Math.cos(bAng + rng.range(-0.3, 0.3)) * reach,
        origin.y + rise,
        origin.z + Math.sin(bAng + rng.range(-0.3, 0.3)) * reach
      );
      const rStart = baseR * rng.range(0.28, 0.40);
      appendOrganicTube(
        trunkBuilder,
        [origin, limbMid, limbTip],
        [rStart, rStart * 0.62, rStart * 0.25],
        5,
        (t) => barkMidCol.clone().lerp(leafBaseCol, t * 0.45),
        0.20,
        treeSeed + 100 + b * 23,
        true
      );

      // Unique noise-warped bioluminescent canopy cluster at each limb tip (and sub-lobe)
      const clusterRadius = rng.range(26, 48);
      appendWarpedBlob(
        blossomBuilder,
        limbTip,
        clusterRadius * rng.range(0.95, 1.35),
        clusterRadius * rng.range(0.52, 0.85),
        clusterRadius * rng.range(0.95, 1.35),
        1,
        treeSeed + b * 41,
        0.34,
        (dir, _y, nVal) => {
          const c = leafBaseCol.clone().lerp(leafTipCol, Math.max(0, Math.min(1, 0.35 + dir.y * 0.45 + (nVal - 1) * 0.9)));
          if (dir.y > 0.52) c.lerp(frostHighlight, 0.24);
          return c;
        }
      );

      if (rng.next() < 0.6) {
        const subOffset = new THREE.Vector3(
          Math.cos(bAng + 0.7) * rng.range(14, 28),
          rng.range(-8, 16),
          Math.sin(bAng + 0.7) * rng.range(14, 28)
        );
        const subR = clusterRadius * rng.range(0.55, 0.78);
        appendWarpedBlob(
          blossomBuilder,
          limbTip.clone().add(subOffset),
          subR * 1.15,
          subR * 0.65,
          subR * 1.15,
          1,
          treeSeed + b * 71 + 7,
          0.36,
          (dir) => leafBaseCol.clone().lerp(leafTipCol, Math.max(0, 0.45 + dir.y * 0.4))
        );
      }
    }

    // Crown cluster atop trunk
    const crownR = rng.range(30, 52);
    appendWarpedBlob(
      blossomBuilder,
      new THREE.Vector3(trunkTop.x, trunkTop.y + crownR * 0.55, trunkTop.z),
      crownR * 1.2,
      crownR * 0.75,
      crownR * 1.2,
      1,
      treeSeed + 503,
      0.32,
      (dir) => leafBaseCol.clone().lerp(leafTipCol, Math.max(0, 0.5 + dir.y * 0.45))
    );

    addGroundAO(wx, wy, sup.height, baseR * 4.4, 0.52);

    if (treeCount % 4 === 0 && lightAnchors.length < 28) {
      lightAnchors.push({
        pos: new THREE.Vector3(trunkTop.x, trunkTop.y + 12, trunkTop.z),
        color: pal.light
      });
    }
    floraPositions.push({ x: wx, y: wy, z: sup.height });
    treeCount++;
  }

  // 2. Unique Faceted Crystal Clusters & Irregular Crater Boulders along hills & rims
  const crystalPalettes = [
    { base: 0x3b1764, tip: 0xd8b4fe, light: 0xc084fc },
    { base: 0x0c4a6e, tip: 0x67e8f9, light: 0x38bdf8 },
    { base: 0x78350f, tip: 0xfcd34d, light: 0xf59e0b },
    { base: 0x7f1d1d, tip: 0xfda4af, light: 0xf43f5e }
  ];
  const boulderDark = new THREE.Color(0x1f252e);
  const boulderMid = new THREE.Color(0x3a404a);
  const boulderFrost = new THREE.Color(0x88a4c2);

  let crystalCount = 0;
  let rockCount = 0;
  for (let attempt = 0; attempt < 1150 && crystalCount + rockCount < 170; attempt++) {
    const wx = rng.range(minX, maxX);
    const wy = rng.range(minY, maxY);
    if (!isClearOfKeyLandmarks(wx, wy)) continue;
    const sup = col.querySupport(wx, wy, 1e6, 56);
    if (!sup.hit || sup.category !== 'ground' || sup.isInWater) continue;
    if (sup.sourceTag === 'water:frozen_ice' || sup.sourceTag === 'node:tower_walkway') continue;
    if (sup.normalY < 0.45 || sup.height > 1650) continue;

    const itemSeed = seed + 40000 + attempt * 29;
    if ((crystalCount + rockCount) % 2 === 0) {
      // Unique multi-spire crystal formation
      const cp = crystalPalettes[Math.floor(rng.next() * crystalPalettes.length)];
      const baseCol = new THREE.Color(cp.base);
      const tipCol = new THREE.Color(cp.tip);
      const spireCount = 3 + Math.floor(rng.next() * 5);
      const clusterScale = rng.range(48, 128);

      for (let s = 0; s < spireCount; s++) {
        const sAng = (s / spireCount) * Math.PI * 2 + rng.range(-0.45, 0.45);
        const tilt = s === 0 ? rng.range(0.04, 0.22) : rng.range(0.22, 0.64);
        const dir = new THREE.Vector3(
          Math.cos(sAng) * Math.sin(tilt),
          Math.cos(tilt),
          Math.sin(sAng) * Math.sin(tilt)
        );
        const offsetR = s === 0 ? 0 : rng.range(6, 22);
        const origin = new THREE.Vector3(
          wx + Math.cos(sAng) * offsetR,
          sup.height - 10,
          wy + Math.sin(sAng) * offsetR
        );
        const len = s === 0 ? clusterScale : clusterScale * rng.range(0.45, 0.85);
        const rad = s === 0 ? rng.range(11, 20) : rng.range(6, 13);
        const sides = 5 + (s % 2);
        appendCrystalSpire(crystalBuilder, origin, dir, len, rad, sides, baseCol, tipCol, itemSeed + s * 17);
      }

      // Seated rock collar under crystals
      appendWarpedBlob(
        boulderBuilder,
        new THREE.Vector3(wx, sup.height - 4, wy),
        rng.range(18, 30),
        rng.range(10, 18),
        rng.range(18, 30),
        1,
        itemSeed + 99,
        0.35,
        (dir) => boulderDark.clone().lerp(boulderMid, Math.max(0, dir.y * 0.5 + 0.3)),
        true
      );
      addGroundAO(wx, wy, sup.height, 36, 0.42);

      if (lightAnchors.length < 44 && crystalCount % 3 === 0) {
        lightAnchors.push({ pos: new THREE.Vector3(wx, sup.height + 65, wy), color: cp.light });
      }
      crystalCount++;
    } else {
      // Unique jagged crater boulder (plus occasional satellite pebble)
      const rx = rng.range(24, 62);
      const ry = rng.range(18, 46);
      const rz = rng.range(24, 62);
      appendWarpedBlob(
        boulderBuilder,
        new THREE.Vector3(wx, sup.height + ry * 0.32 - 8, wy),
        rx,
        ry,
        rz,
        1,
        itemSeed,
        0.38,
        (dir, _y, nVal) => {
          const c = boulderDark.clone().lerp(boulderMid, Math.max(0, Math.min(1, 0.35 + dir.y * 0.45 + (nVal - 1) * 0.8)));
          if (dir.y > 0.48) c.lerp(boulderFrost, 0.38 * (dir.y - 0.48) * 2);
          return c;
        },
        true
      );
      if (rng.next() < 0.55) {
        const oAng = rng.range(0, Math.PI * 2);
        const oDist = Math.max(rx, rz) * 0.85;
        const ox = wx + Math.cos(oAng) * oDist;
        const oz = wy + Math.sin(oAng) * oDist;
        const osup = col.querySupport(ox, oz, sup.height + 35, 50);
        const oy = osup.hit ? osup.height : sup.height;
        const sr = rng.range(12, 24);
        appendWarpedBlob(
          boulderBuilder,
          new THREE.Vector3(ox, oy + sr * 0.25 - 5, oz),
          sr * 1.15,
          sr * 0.78,
          sr,
          1,
          itemSeed + 13,
          0.42,
          (dir) => boulderDark.clone().lerp(boulderFrost, dir.y > 0.55 ? 0.32 : 0.08),
          true
        );
      }
      addGroundAO(wx, wy, sup.height, Math.max(rx, rz) * 1.15, 0.40);
      rockCount++;
    }
  }

  // 3. Unique Bioluminescent Mushroom Clusters & Curved Alien Shoreline Tendrils along thawed banks
  const stemCol = new THREE.Color(0x9be7dc);
  const mushPalettes = [
    { inner: 0x0f766e, rim: 0x5eead4 },
    { inner: 0x4338ca, rim: 0xa5b4fc },
    { inner: 0x701a75, rim: 0xf0abfc }
  ];
  const tendrilBase = new THREE.Color(0x134e4a);
  const tendrilTip = new THREE.Color(0x6ee7b7);

  let mushroomCount = 0;
  let shorelineCount = 0;
  for (let attempt = 0; attempt < 1550 && mushroomCount + shorelineCount < 160; attempt++) {
    const nearRiver = attempt < 1150;
    const wx = nearRiver ? rng.range(Math.max(minX, 3850), Math.min(maxX, 8250)) : rng.range(minX, maxX);
    const wy = rng.range(minY, maxY);
    if (!isClearOfKeyLandmarks(wx, wy)) continue;
    const sup = col.querySupport(wx, wy, 1e6, 56);
    if (!sup.hit || sup.category !== 'ground' || sup.isInWater) continue;
    if (sup.sourceTag === 'water:frozen_ice' || sup.sourceTag === 'node:tower_walkway') continue;
    if (sup.normalY < 0.58) continue;
    if (nearRiver && (sup.height < 562 || sup.height > 710)) continue;

    const clusterSeed = seed + 90000 + attempt * 41;
    if ((mushroomCount + shorelineCount) % 3 === 0) {
      const mp = mushPalettes[Math.floor(rng.next() * mushPalettes.length)];
      const innerCol = new THREE.Color(mp.inner);
      const rimCol = new THREE.Color(mp.rim);
      const capCount = 2 + Math.floor(rng.next() * 4);
      for (let m = 0; m < capCount; m++) {
        const ang = (m / capCount) * Math.PI * 2 + rng.range(-0.5, 0.5);
        const dist = m === 0 ? 0 : rng.range(10, 24);
        const mx = wx + Math.cos(ang) * dist;
        const mz = wy + Math.sin(ang) * dist;
        const mSup = m === 0 ? sup : col.querySupport(mx, mz, sup.height + 30, 45);
        const my = mSup.hit ? mSup.height : sup.height;
        const h = (m === 0 ? rng.range(38, 68) : rng.range(20, 44));
        const cr = h * rng.range(0.36, 0.58);
        appendAlienMushroom(
          floraGlowBuilder,
          floraGlowBuilder,
          new THREE.Vector3(mx, my, mz),
          h,
          cr,
          Math.cos(ang) * rng.range(4, 16),
          Math.sin(ang) * rng.range(4, 16),
          stemCol,
          innerCol,
          rimCol,
          clusterSeed + m * 23
        );
      }
      if (mushroomCount % 3 === 0 && lightAnchors.length < 56) {
        lightAnchors.push({ pos: new THREE.Vector3(wx, sup.height + 46, wy), color: 0x2dd4bf });
      }
      floraPositions.push({ x: wx, y: wy, z: sup.height });
      mushroomCount++;
    } else {
      // Unique sweeping shoreline organic fern/kelp/tendril fronds
      const frondCount = 3 + Math.floor(rng.next() * 4);
      for (let f = 0; f < frondCount; f++) {
        const fAng = (f / frondCount) * Math.PI * 2 + rng.range(-0.4, 0.4);
        const h = rng.range(24, 52);
        const arch = rng.range(12, 32);
        appendOrganicTube(
          floraGlowBuilder,
          [
            new THREE.Vector3(wx, sup.height - 6, wy),
            new THREE.Vector3(wx + Math.cos(fAng) * arch * 0.4, sup.height + h * 0.55, wy + Math.sin(fAng) * arch * 0.4),
            new THREE.Vector3(wx + Math.cos(fAng) * arch, sup.height + h * 0.92, wy + Math.sin(fAng) * arch),
            new THREE.Vector3(wx + Math.cos(fAng) * (arch * 1.25), sup.height + h * 0.80, wy + Math.sin(fAng) * (arch * 1.25))
          ],
          [3.6, 2.5, 1.4, 0.4],
          5,
          (t) => tendrilBase.clone().lerp(tendrilTip, t),
          0.14,
          clusterSeed + f * 37,
          true
        );
      }
      floraPositions.push({ x: wx, y: wy, z: sup.height });
      shorelineCount++;
    }
  }

  let totalVertices = 0;
  let batchMeshCount = 0;

  const addBatch = (
    name: string,
    builder: MeshBufferBuilder,
    material: THREE.Material
  ): void => {
    if (builder.positions.length === 0 || builder.indices.length === 0) return;
    const geo = finalizeBuilderGeometry(builder);
    totalVertices += geo.getAttribute('position').count;
    const mesh = new THREE.Mesh(geo, material);
    mesh.name = name;
    group.add(mesh);
    batchMeshCount++;
  };

  addBatch(
    'procedural_trees_trunks',
    trunkBuilder,
    new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.86, metalness: 0.05 })
  );
  addBatch(
    'procedural_trees_blossoms',
    blossomBuilder,
    makeBiolumFloraMaterial(0.32, 0.48, 0.04)
  );
  addBatch(
    'procedural_boulders',
    boulderBuilder,
    new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.92, metalness: 0.08 })
  );
  addBatch(
    'procedural_crystals',
    crystalBuilder,
    makeBiolumFloraMaterial(0.58, 0.22, 0.25)
  );
  addBatch(
    'procedural_shoreline_mushrooms',
    floraGlowBuilder,
    makeBiolumFloraMaterial(0.42, 0.52, 0.04)
  );

  if (shadowBuilder.positions.length > 0 && shadowBuilder.indices.length > 0) {
    const sGeo = new THREE.BufferGeometry();
    sGeo.setAttribute('position', new THREE.Float32BufferAttribute(shadowBuilder.positions, 3));
    sGeo.setAttribute('aShadowColor', new THREE.Float32BufferAttribute(shadowBuilder.colors, 3));
    sGeo.setIndex(shadowBuilder.indices);
    totalVertices += sGeo.getAttribute('position').count;
    const shadowMat = new THREE.ShaderMaterial({
      transparent: true,
      depthWrite: false,
      vertexShader: `
        attribute vec3 aShadowColor;
        varying float vAlpha;
        void main() {
          vAlpha = aShadowColor.r;
          gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
        }
      `,
      fragmentShader: `
        varying float vAlpha;
        void main() {
          float a = clamp(vAlpha, 0.0, 0.65);
          if (a < 0.01) discard;
          gl_FragColor = vec4(0.02, 0.04, 0.08, a);
        }
      `
    });
    const shadowMesh = new THREE.Mesh(sGeo, shadowMat);
    shadowMesh.name = 'procedural_ground_shadows';
    group.add(shadowMesh);
    batchMeshCount++;
  }

  return {
    group,
    lightAnchors,
    floraPositions,
    stats: {
      trees: treeCount,
      crystals: crystalCount,
      rocks: rockCount,
      mushrooms: mushroomCount,
      shorelines: shorelineCount,
      batchMeshCount,
      totalVertices
    }
  };
}

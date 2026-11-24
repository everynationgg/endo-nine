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
  extras: number[];
  indices: number[];
}

function createBuilder(): MeshBufferBuilder {
  return { positions: [], normals: [], colors: [], extras: [], indices: [] };
}

function finalizeBuilderGeometry(b: MeshBufferBuilder, extraAttrName?: string): THREE.BufferGeometry {
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(b.positions, 3));
  geo.setAttribute('normal', new THREE.Float32BufferAttribute(b.normals, 3));
  geo.setAttribute('color', new THREE.Float32BufferAttribute(b.colors, 3));
  if (extraAttrName && b.extras.length === b.positions.length) {
    geo.setAttribute(extraAttrName, new THREE.Float32BufferAttribute(b.extras, 3));
  }
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
  capTop: boolean = true,
  extraAt?: (t: number, ringAngle: number, ringIdx: number) => [number, number, number]
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
      if (extraAt) {
        const ex = extraAt(t, ang, i);
        b.extras.push(ex[0], ex[1], ex[2]);
      }
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
    if (extraAt) {
      const ex = extraAt(1, 0, spine.length - 1);
      b.extras.push(ex[0], ex[1], ex[2]);
    }
    const lastRing = baseVertex + (spine.length - 1) * stride;
    for (let j = 0; j < radialSegments; j++) {
      b.indices.push(lastRing + j, tipIdx, lastRing + j + 1);
    }
  }
}

/**
 * Appends an umbrella/parasol-shaped bioluminescent alien canopy with a broad scalloped dome,
 * sweeping overarching brim, concave underside vault, and pronounced radial gill ribs.
 */
function appendUmbrellaCanopy(
  b: MeshBufferBuilder,
  center: THREE.Vector3,
  radiusX: number,
  radiusZ: number,
  domeHeight: number,
  tiltX: number,
  tiltZ: number,
  ribCount: number,
  seed: number,
  capTopCol: THREE.Color,
  capMidCol: THREE.Color,
  capGillCol: THREE.Color,
  frostHighlight: THREE.Color
): void {
  const radSegs = Math.max(16, ribCount * 2);
  const rings = 5; // concentric rings from hub to outer scalloped rim
  const phase = (seed % 89) * 0.37;

  // Tilt frame so secondary sub-canopies angle gracefully outward from their limb
  const up = new THREE.Vector3(tiltX, 1, tiltZ).normalize();
  const ref = Math.abs(up.x) > 0.85 ? new THREE.Vector3(0, 0, 1) : new THREE.Vector3(1, 0, 0);
  const right = new THREE.Vector3().crossVectors(up, ref).normalize();
  const fwd = new THREE.Vector3().crossVectors(right, up).normalize();

  const buildShell = (isUnderside: boolean): void => {
    const hubIdx = b.positions.length / 3;
    const hubYLocal = isUnderside ? -domeHeight * 0.24 : domeHeight * 0.62;
    const hubPos = center.clone().addScaledVector(up, hubYLocal);
    const hubCol = isUnderside ? capGillCol.clone().lerp(new THREE.Color(0xffffff), 0.18) : capTopCol.clone();
    b.positions.push(hubPos.x, hubPos.y, hubPos.z);
    b.normals.push(isUnderside ? -up.x : up.x, isUnderside ? -up.y : up.y, isUnderside ? -up.z : up.z);
    b.colors.push(hubCol.r, hubCol.g, hubCol.b);
    b.extras.push(0, isUnderside ? -0.95 : 0.95, 0);

    const ringStart = b.positions.length / 3;
    const colScratch = new THREE.Color();

    for (let r = 1; r <= rings; r++) {
      const u = r / rings; // 0..1 radial from hub to outer rim
      for (let s = 0; s <= radSegs; s++) {
        const ang = (s / radSegs) * Math.PI * 2;
        const scallopWave = Math.sin(ang * ribCount + phase);
        const asym = 1 + 0.10 * Math.sin(ang * 2 + phase * 1.3) + 0.06 * Math.cos(ang * 3 - phase);
        const rimScallop = 1 + 0.075 * Math.pow(u, 1.8) * scallopWave;
        const radScale = u * asym * rimScallop;

        const rx = Math.cos(ang) * radiusX * radScale;
        const rz = Math.sin(ang) * radiusZ * radScale;

        // Smooth overarching parasol dome curve + slight downturned brim lip
        let yLocal: number;
        const gillRidge = Math.pow(0.5 + 0.5 * Math.cos(ang * ribCount + phase), 1.8);
        if (isUnderside) {
          // Concave vaulted underside rising slightly before dipping to meet the rim lip,
          // with sculpted radial gill struts underneath
          const arch = Math.sin(u * Math.PI * 0.58) * domeHeight * 0.24 - Math.pow(u, 2.6) * domeHeight * 0.26;
          const gillDrop = gillRidge * (1 - u * 0.35) * Math.sin(u * Math.PI) * domeHeight * 0.16;
          yLocal = -domeHeight * 0.24 + arch - gillDrop;
        } else {
          // Broad arched parasol top with subtle radial rib undulations near rim
          const crown = Math.cos(u * Math.PI * 0.5) * domeHeight * 0.62;
          const brimDip = -Math.pow(u, 2.2) * domeHeight * 0.26;
          const ribBump = gillRidge * Math.pow(u, 1.4) * domeHeight * 0.065;
          yLocal = crown + brimDip + ribBump;
        }

        const worldPos = center
          .clone()
          .addScaledVector(right, rx)
          .addScaledVector(fwd, rz)
          .addScaledVector(up, yLocal);

        b.positions.push(worldPos.x, worldPos.y, worldPos.z);

        const nyApprox = isUnderside ? -0.78 : Math.max(0.25, 1 - u * 0.65);
        const nVec = right
          .clone()
          .multiplyScalar(Math.cos(ang) * u * 0.55)
          .addScaledVector(fwd, Math.sin(ang) * u * 0.55)
          .addScaledVector(up, nyApprox)
          .normalize();
        b.normals.push(nVec.x, nVec.y, nVec.z);

        if (isUnderside) {
          colScratch
            .copy(capGillCol)
            .lerp(capMidCol, u * 0.65)
            .lerp(capGillCol, gillRidge * 0.48 * (1 - u * 0.4));
        } else {
          colScratch.copy(capTopCol).lerp(capMidCol, Math.pow(u, 1.15));
          if (u < 0.48) {
            colScratch.lerp(frostHighlight, 0.10 * (1 - u * 2.0));
          }
        }
        b.colors.push(colScratch.r, colScratch.g, colScratch.b);

        // Encode canopy-relative direction so makeAlienCanopyMaterial activates underside gills & rim glow cleanly
        const localDirY = isUnderside ? -(0.88 - u * 0.62) : (0.92 - u * 0.72);
        b.extras.push(Math.cos(ang) * u, localDirY, Math.sin(ang) * u);
      }
    }

    const stride = radSegs + 1;
    // Inner fan around hub
    for (let s = 0; s < radSegs; s++) {
      const i1 = ringStart + s;
      const i2 = ringStart + s + 1;
      if (isUnderside) {
        b.indices.push(hubIdx, i1, i2);
      } else {
        b.indices.push(hubIdx, i2, i1);
      }
    }
    // Outer concentric quad rings
    for (let r = 0; r < rings - 1; r++) {
      for (let s = 0; s < radSegs; s++) {
        const a = ringStart + r * stride + s;
        const bIdx = a + stride;
        const cIdx = bIdx + 1;
        const dIdx = a + 1;
        if (isUnderside) {
          b.indices.push(a, bIdx, dIdx);
          b.indices.push(dIdx, bIdx, cIdx);
        } else {
          b.indices.push(a, dIdx, bIdx);
          b.indices.push(dIdx, cIdx, bIdx);
        }
      }
    }
  };

  buildShell(false);
  buildShell(true);
}

/** Appends a noise-sculpted asymmetric organic blob (for boulders and mineral mounds). */
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
  squashFlatBottom: boolean = false,
  recordLocalMeta: boolean = false
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

    const lx = dir.x * scaleX * disp;
    let ly = dir.y * scaleY * disp;
    const lz = dir.z * scaleZ * disp;
    if (squashFlatBottom && ly < -scaleY * 0.35) {
      ly = -scaleY * 0.35 + (ly + scaleY * 0.35) * 0.22;
    }

    b.positions.push(center.x + lx, center.y + ly, center.z + lz);
    b.normals.push(dir.x, dir.y, dir.z);

    const c = colorFn(dir, dir.y, disp);
    b.colors.push(c.r, c.g, c.b);
    if (recordLocalMeta) {
      b.extras.push(dir.x, dir.y, dir.z);
    }
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
      b.extras.push(s / sides, t, asym);
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
  b.extras.push(0.5, 1.0, 1.0);
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

/** Creates organic bioluminescent bark material with twisted fibers, grooves, and matching canopy-tinted veins. */
function makeAlienBarkMaterial(): THREE.MeshStandardMaterial {
  const mat = new THREE.MeshStandardMaterial({
    vertexColors: true,
    roughness: 0.86,
    metalness: 0.04
  });
  mat.customProgramCacheKey = () => 'stage1_alien_bark_v1';
  mat.onBeforeCompile = (shader) => {
    shader.vertexShader = shader.vertexShader
      .replace(
        'void main() {',
        `attribute vec3 aBarkVeinColor;
varying vec3 vBarkVeinColor;
varying vec3 vBarkWorldPos;
varying vec3 vBarkWorldNormal;
void main() {`
      )
      .replace(
        '#include <beginnormal_vertex>',
        `#include <beginnormal_vertex>
vBarkWorldNormal = normalize(mat3(modelMatrix) * objectNormal);`
      )
      .replace(
        '#include <begin_vertex>',
        `#include <begin_vertex>
vBarkVeinColor = aBarkVeinColor;
vBarkWorldPos = (modelMatrix * vec4(transformed, 1.0)).xyz;`
      );

    shader.fragmentShader = shader.fragmentShader
      .replace(
        'void main() {',
        `varying vec3 vBarkVeinColor;
varying vec3 vBarkWorldPos;
varying vec3 vBarkWorldNormal;

float bkHash3(vec3 p) {
  p = fract(p * vec3(127.1, 311.7, 74.7));
  p += dot(p, p.yxz + 19.19);
  return fract((p.x + p.y) * p.z);
}

float bkNoise3(vec3 p) {
  vec3 i = floor(p);
  vec3 f = fract(p);
  f = f * f * (3.0 - 2.0 * f);
  float n000 = bkHash3(i);
  float n100 = bkHash3(i + vec3(1.0, 0.0, 0.0));
  float n010 = bkHash3(i + vec3(0.0, 1.0, 0.0));
  float n110 = bkHash3(i + vec3(1.0, 1.0, 0.0));
  float n001 = bkHash3(i + vec3(0.0, 0.0, 1.0));
  float n101 = bkHash3(i + vec3(1.0, 0.0, 1.0));
  float n011 = bkHash3(i + vec3(0.0, 1.0, 1.0));
  float n111 = bkHash3(i + vec3(1.0, 1.0, 1.0));
  return mix(
    mix(mix(n000, n100, f.x), mix(n010, n110, f.x), f.y),
    mix(mix(n001, n101, f.x), mix(n011, n111, f.x), f.y),
    f.z
  );
}

float bkFbm3(vec3 p) {
  return 0.60 * bkNoise3(p) + 0.40 * bkNoise3(p * 2.17 + vec3(7.3, 4.1, 9.7));
}

void main() {`
      )
      .replace(
        '#include <color_fragment>',
        `#include <color_fragment>
  vec3 bkWN = normalize(vBarkWorldNormal) * (gl_FrontFacing ? 1.0 : -1.0);
  float bkWarp = bkFbm3(vBarkWorldPos * 0.036);
  float bkPhi = atan(bkWN.z, bkWN.x) * 3.0 + vBarkWorldPos.y * 0.068 + bkWarp * 3.4;
  float bkMicro = bkNoise3(vBarkWorldPos * 0.14);
  float bkGrain = sin(bkPhi * 3.0 + bkMicro * 2.4) * 0.5 + 0.5;
  float bkSecondary = sin(bkPhi * 6.5 - vBarkWorldPos.y * 0.04 + bkWarp * 5.0) * 0.5 + 0.5;
  float bkGroove = smoothstep(0.16, 0.84, bkGrain * 0.72 + bkSecondary * 0.28);
  float bkCrevice = pow(clamp(1.0 - bkGroove, 0.0, 1.0), 2.2);
  float bkRidge = pow(bkGroove, 1.6);

  // Thin bioluminescent veins threading organically through twisted bark fissures
  float bkVeinSin = abs(sin(bkPhi * 1.5 + bkWarp * 2.1));
  float bkVeinPath = pow(clamp(1.0 - bkVeinSin, 0.0, 1.0), 11.0);
  float bkVeinBreak = smoothstep(0.36, 0.78, bkNoise3(vBarkWorldPos * 0.022 + vec3(4.1, 1.7, 8.3)));
  float bkVeinMask = bkVeinPath * bkVeinBreak;

  diffuseColor.rgb = diffuseColor.rgb * mix(0.54, 1.32, bkGroove) - diffuseColor.rgb * (bkCrevice * 0.22);
  diffuseColor.rgb += vBarkVeinColor * (bkVeinMask * 0.28);`
      )
      .replace(
        '#include <roughnessmap_fragment>',
        `#include <roughnessmap_fragment>
  roughnessFactor = mix(0.94, 0.70, bkRidge);`
      )
      .replace(
        '#include <emissivemap_fragment>',
        `#include <emissivemap_fragment>
  totalEmissiveRadiance += vBarkVeinColor * (bkVeinMask * 0.68 + bkRidge * 0.02);`
      );
  };
  return mat;
}

/** Creates organic bioluminescent canopy material with radial underside gills, fine veins, and translucent rim glow. */
function makeAlienCanopyMaterial(): THREE.MeshStandardMaterial {
  const mat = new THREE.MeshStandardMaterial({
    vertexColors: true,
    roughness: 0.44,
    metalness: 0.04
  });
  mat.customProgramCacheKey = () => 'stage1_alien_canopy_v1';
  mat.onBeforeCompile = (shader) => {
    shader.vertexShader = shader.vertexShader
      .replace(
        'void main() {',
        `attribute vec3 aCanopyLocal;
varying vec3 vCanopyLocal;
varying vec3 vCanopyWorldPos;
varying vec3 vCanopyWorldNormal;
void main() {`
      )
      .replace(
        '#include <beginnormal_vertex>',
        `#include <beginnormal_vertex>
vCanopyWorldNormal = normalize(mat3(modelMatrix) * objectNormal);`
      )
      .replace(
        '#include <begin_vertex>',
        `#include <begin_vertex>
vCanopyLocal = aCanopyLocal;
vCanopyWorldPos = (modelMatrix * vec4(transformed, 1.0)).xyz;`
      );

    shader.fragmentShader = shader.fragmentShader
      .replace(
        'void main() {',
        `varying vec3 vCanopyLocal;
varying vec3 vCanopyWorldPos;
varying vec3 vCanopyWorldNormal;

float acHash3(vec3 p) {
  p = fract(p * vec3(127.1, 311.7, 74.7));
  p += dot(p, p.yxz + 19.19);
  return fract((p.x + p.y) * p.z);
}

float acNoise3(vec3 p) {
  vec3 i = floor(p);
  vec3 f = fract(p);
  f = f * f * (3.0 - 2.0 * f);
  float n000 = acHash3(i);
  float n100 = acHash3(i + vec3(1.0, 0.0, 0.0));
  float n010 = acHash3(i + vec3(0.0, 1.0, 0.0));
  float n110 = acHash3(i + vec3(1.0, 1.0, 0.0));
  float n001 = acHash3(i + vec3(0.0, 0.0, 1.0));
  float n101 = acHash3(i + vec3(1.0, 0.0, 1.0));
  float n011 = acHash3(i + vec3(0.0, 1.0, 1.0));
  float n111 = acHash3(i + vec3(1.0, 1.0, 1.0));
  return mix(
    mix(mix(n000, n100, f.x), mix(n010, n110, f.x), f.y),
    mix(mix(n001, n101, f.x), mix(n011, n111, f.x), f.y),
    f.z
  );
}

float acFbm3(vec3 p) {
  return 0.58 * acNoise3(p) + 0.42 * acNoise3(p * 2.23 + vec3(5.7, 3.1, 11.4));
}

void main() {`
      )
      .replace(
        '#include <color_fragment>',
        `#include <color_fragment>
  vec3 acWN = normalize(vCanopyWorldNormal) * (gl_FrontFacing ? 1.0 : -1.0);
  vec3 acViewDir = normalize(cameraPosition - vCanopyWorldPos);
  float acNdotV = clamp(abs(dot(acWN, acViewDir)), 0.0, 1.0);

  vec3 acLocalDir = normalize(vCanopyLocal + vec3(0.0001));
  float acRadial = clamp(length(acLocalDir.xz), 0.0, 1.0);
  float acAng = atan(acLocalDir.z, acLocalDir.x);
  float acUnder = smoothstep(0.24, -0.58, acLocalDir.y);
  float acTop = smoothstep(-0.12, 0.72, acLocalDir.y);

  float acMottle = acFbm3(vCanopyWorldPos * 0.044 + acLocalDir * 1.8);
  float acDetailN = acNoise3(vCanopyWorldPos * 0.12);

  // Soft radial pattern & luminous underside gills spreading from canopy center
  float acAngWarp = acAng + (acMottle - 0.5) * 0.42;
  float acGillPrimary = pow(0.5 + 0.5 * cos(acAngWarp * 16.0), 2.4);
  float acGillSecondary = pow(0.5 + 0.5 * cos(acAngWarp * 32.0 + acRadial * 3.2), 3.0);
  float acRadialGill = (acGillPrimary * 0.65 + acGillSecondary * 0.35) * smoothstep(0.08, 0.85, acRadial);

  // Fine bioluminescent vein network breaking up flat canopy facets
  float acVeinWaveA = sin(acRadial * 11.5 - acMottle * 4.8 + cos(acAng * 3.0) * 1.4);
  float acVeinWaveB = sin((vCanopyWorldPos.x * 0.075 - vCanopyWorldPos.z * 0.070) + acDetailN * 4.6);
  float acVeinNet = max(
    pow(clamp(1.0 - abs(acVeinWaveA), 0.0, 1.0), 5.0),
    pow(clamp(1.0 - abs(acVeinWaveB), 0.0, 1.0), 5.5) * 0.78
  );

  // Soft underside core channel glow where trunk/limbs meet canopy
  float acUnderCore = acUnder * smoothstep(0.76, 0.04, acRadial);
  // Subtle translucent-looking rim highlight
  float acRim = pow(clamp(1.0 - acNdotV, 0.0, 1.0), 2.15) * (0.45 + 0.55 * acRadial);

  vec3 acBasePigment = diffuseColor.rgb;
  vec3 acBrightHue = mix(acBasePigment * 1.42, vec3(dot(acBasePigment, vec3(0.3, 0.6, 0.1))) + acBasePigment, 0.35);
  diffuseColor.rgb = mix(acBasePigment * 0.76, acBrightHue, clamp(acMottle * 0.55 + acRadial * 0.25 + acVeinNet * 0.35, 0.0, 1.0));
  diffuseColor.rgb += acBrightHue * (acRadialGill * (0.14 + 0.26 * acUnder) + acRim * 0.22);`
      )
      .replace(
        '#include <roughnessmap_fragment>',
        `#include <roughnessmap_fragment>
  roughnessFactor = mix(0.54, 0.26, clamp(acVeinNet * 0.6 + acUnderCore * 0.5, 0.0, 1.0));`
      )
      .replace(
        '#include <emissivemap_fragment>',
        `#include <emissivemap_fragment>
  #ifdef USE_COLOR
    vec3 acGlowTint = mix(vColor.rgb, acBrightHue, 0.45);
    float acGlowStrength = 0.18 + acUnderCore * 0.44 + acRadialGill * (0.12 + 0.24 * acUnder) + acVeinNet * (0.28 + 0.12 * acTop) + acRim * 0.24;
    totalEmissiveRadiance += acGlowTint * acGlowStrength;
  #endif`
      );
  };
  return mat;
}

/** Creates faceted, striated, internally luminous alien crystal material with sharp edge highlights. */
function makeAlienCrystalMaterial(): THREE.MeshPhysicalMaterial {
  const mat = new THREE.MeshPhysicalMaterial({
    vertexColors: true,
    flatShading: true,
    roughness: 0.16,
    metalness: 0.14,
    clearcoat: 0.88,
    clearcoatRoughness: 0.09,
    transparent: true,
    opacity: 0.92,
    depthWrite: true,
    side: THREE.FrontSide
  });
  mat.customProgramCacheKey = () => 'stage1_alien_crystal_v1';
  mat.onBeforeCompile = (shader) => {
    shader.vertexShader = shader.vertexShader
      .replace(
        'void main() {',
        `attribute vec3 aCrystalMeta;
varying vec3 vCrystalMeta;
varying vec3 vCrystalWorldPos;
void main() {`
      )
      .replace(
        '#include <begin_vertex>',
        `#include <begin_vertex>
vCrystalMeta = aCrystalMeta;
vCrystalWorldPos = (modelMatrix * vec4(transformed, 1.0)).xyz;`
      );

    shader.fragmentShader = shader.fragmentShader
      .replace(
        'void main() {',
        `varying vec3 vCrystalMeta;
varying vec3 vCrystalWorldPos;

float crHash3(vec3 p) {
  p = fract(p * vec3(127.1, 311.7, 74.7));
  p += dot(p, p.yxz + 19.19);
  return fract((p.x + p.y) * p.z);
}

float crNoise3(vec3 p) {
  vec3 i = floor(p);
  vec3 f = fract(p);
  f = f * f * (3.0 - 2.0 * f);
  float n000 = crHash3(i);
  float n100 = crHash3(i + vec3(1.0, 0.0, 0.0));
  float n010 = crHash3(i + vec3(0.0, 1.0, 0.0));
  float n110 = crHash3(i + vec3(1.0, 1.0, 0.0));
  float n001 = crHash3(i + vec3(0.0, 0.0, 1.0));
  float n101 = crHash3(i + vec3(1.0, 0.0, 1.0));
  float n011 = crHash3(i + vec3(0.0, 1.0, 1.0));
  float n111 = crHash3(i + vec3(1.0, 1.0, 1.0));
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
  vec3 crDpdx = dFdx(vCrystalWorldPos);
  vec3 crDpdy = dFdy(vCrystalWorldPos);
  vec3 crCross = cross(crDpdx, crDpdy);
  float crCrossLen = length(crCross);
  vec3 crFaceN = crCrossLen > 1e-5 ? (crCross / crCrossLen) : vec3(0.0, 1.0, 0.0);
  if (!gl_FrontFacing) crFaceN = -crFaceN;

  vec3 crViewDir = normalize(cameraPosition - vCrystalWorldPos);
  float crNdotV = clamp(abs(dot(crFaceN, crViewDir)), 0.0, 1.0);
  float crFacetRand = crHash3(floor(crFaceN * 10.0 + vec3(17.3, 5.9, 31.1)));

  // Faceted color shift & crisp facet shade contrast
  float crDirShade = clamp(dot(crFaceN, normalize(vec3(0.45, 0.82, -0.35))) * 0.5 + 0.5, 0.0, 1.0);
  float crFacetGain = mix(0.76, 1.30, crFacetRand * 0.55 + crDirShade * 0.45);

  // Fine crystalline quartz growth striations across prism facets
  float crStriationWave = sin(vCrystalMeta.y * 52.0 + vCrystalWorldPos.y * 0.48 + sin(vCrystalMeta.x * 18.84955) * 0.9 + crFacetRand * 6.2831);
  float crStriation = smoothstep(0.62, 0.96, crStriationWave * 0.5 + 0.5);

  // Sharp prism edge highlights from normal discontinuities & rim grazing
  float crEdgeDeriv = clamp(length(fwidth(crFaceN)) * 1.45, 0.0, 1.0);
  float crPrismRim = pow(clamp(1.0 - crNdotV, 0.0, 1.0), 2.5);
  float crEdgeHighlight = clamp(crEdgeDeriv * 0.85 + crPrismRim * 0.55, 0.0, 1.0);

  // Simulated internal caustic reflection & subsurface luminous core
  float crCaustic = crNoise3(vCrystalWorldPos * 0.095 + crFaceN * 2.4);
  float crInternalCore = pow(crNdotV, 1.35) * (0.45 + 0.55 * crCaustic) * (1.0 - vCrystalMeta.y * 0.42);

  vec3 crRichTint = diffuseColor.rgb * crFacetGain;
  vec3 crSpecTint = mix(crRichTint * 1.45 + vec3(0.18, 0.24, 0.30), vec3(0.88, 0.96, 1.0), 0.32);
  diffuseColor.rgb = mix(crRichTint, crSpecTint, clamp(crEdgeHighlight * 0.58 + crStriation * 0.22 + crInternalCore * 0.35, 0.0, 1.0));`
      )
      .replace(
        '#include <roughnessmap_fragment>',
        `#include <roughnessmap_fragment>
  roughnessFactor = mix(0.12, 0.26, crFacetRand);`
      )
      .replace(
        '#include <emissivemap_fragment>',
        `#include <emissivemap_fragment>
  #ifdef USE_COLOR
    vec3 crCoreColor = mix(vColor.rgb, vec3(0.82, 0.95, 1.0), 0.22);
    vec3 crFloorGlow = max(vColor.rgb * 0.36, vec3(0.06, 0.08, 0.12));
    totalEmissiveRadiance += crFloorGlow + vColor.rgb * (crInternalCore * 0.54 + crFacetRand * 0.16) + crCoreColor * (crEdgeHighlight * 0.34 + crStriation * 0.12);
  #endif`
      );
  };
  return mat;
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

  // 1. Unique Umbrella-Shaped Bioluminescent Alien Trees matching Stage 1 visual direction
  const treePalettes = [
    // Signature Electric Cyan / Aqua Parasol
    { barkA: 0x162436, barkB: 0x26445c, capTop: 0x0b5ea8, capMid: 0x00c8ff, capGill: 0x8ef9ff, light: 0x00d8ff },
    // Bioluminescent Coral-Rose / Magenta Parasol
    { barkA: 0x261a2e, barkB: 0x452847, capTop: 0x9e1b52, capMid: 0xf43f75, capGill: 0xffb3c8, light: 0xf43f75 },
    // Electric Violet / Indigo Parasol
    { barkA: 0x1e1836, barkB: 0x352a61, capTop: 0x431888, capMid: 0x8b5cf6, capGill: 0xdfb8ff, light: 0x9d4edd }
  ];

  let treeCount = 0;
  let validTreeCandidateIdx = 0;
  const maxTreeCount = 117; // 130 reduced by 10%
  for (let attempt = 0; attempt < 950 && treeCount < maxTreeCount; attempt++) {
    const wx = rng.range(minX, maxX);
    const wy = rng.range(minY, maxY);
    if (!isClearOfKeyLandmarks(wx, wy)) continue;
    const sup = col.querySupport(wx, wy, 1e6, 56);
    if (!sup.hit || sup.category !== 'ground' || sup.isInWater) continue;
    if (sup.sourceTag === 'water:frozen_ice' || sup.sourceTag === 'node:tower_walkway') continue;
    if (sup.normalY < 0.66 || sup.height < 566 || sup.height > 1350) continue;

    validTreeCandidateIdx++;
    if (validTreeCandidateIdx % 10 === 0) continue;

    const pal = treePalettes[Math.floor(rng.next() * treePalettes.length)];
    const treeSeed = seed + attempt * 31 + treeCount * 137;
    const height = rng.range(190, 325);
    const baseR = rng.range(10.5, 17.5);
    const leanX = rng.range(-42, 42);
    const leanZ = rng.range(-42, 42);
    const twist = rng.range(-0.9, 0.9);
    const barkBaseCol = new THREE.Color(pal.barkA);
    const barkMidCol = new THREE.Color(pal.barkB);
    const barkVeinCol = new THREE.Color(pal.light);
    const barkVeinTuple: [number, number, number] = [barkVeinCol.r, barkVeinCol.g, barkVeinCol.b];
    const frostHighlight = new THREE.Color(0xa6c8eb);
    const capTopCol = new THREE.Color(pal.capTop);
    const capMidCol = new THREE.Color(pal.capMid);
    const capGillCol = new THREE.Color(pal.capGill);

    // Sinuous multi-segment main trunk rooted -16u into soil
    const trunkPts: THREE.Vector3[] = [];
    const trunkRadii: number[] = [];
    const segCount = 5;
    for (let s = 0; s < segCount; s++) {
      const t = s / (segCount - 1);
      const waveX = Math.sin(t * Math.PI * 1.4 + treeSeed * 0.1) * 12 * t;
      const waveZ = Math.cos(t * Math.PI * 1.2 + treeSeed * 0.2) * 12 * t;
      trunkPts.push(
        new THREE.Vector3(
          wx + leanX * Math.pow(t, 1.15) + waveX,
          sup.height - 16 + t * (height * 0.72),
          wy + leanZ * Math.pow(t, 1.15) + waveZ
        )
      );
      trunkRadii.push(baseR * (1 - 0.62 * Math.pow(t, 0.85)));
    }

    appendOrganicTube(
      trunkBuilder,
      trunkPts,
      trunkRadii,
      7,
      (t, ang) => {
        const c = barkBaseCol.clone().lerp(barkMidCol, t);
        if (Math.sin(ang + twist) > 0.45 && t > 0.25) c.lerp(frostHighlight, 0.16);
        return c;
      },
      0.22,
      treeSeed,
      true,
      () => barkVeinTuple
    );

    // 3..5 Flaring buttress roots gripping crater rock/soil
    const rootCount = 3 + Math.floor(rng.next() * 3);
    for (let r = 0; r < rootCount; r++) {
      const rAng = (r / rootCount) * Math.PI * 2 + rng.range(-0.42, 0.42);
      const rSpan = baseR * rng.range(1.9, 3.1);
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
        [baseR * 0.46, baseR * 0.32, baseR * 0.14],
        5,
        () => barkBaseCol,
        0.18,
        treeSeed + r * 19,
        true,
        () => barkVeinTuple
      );
    }

    // Dominant primary umbrella parasol canopy atop the gnarled trunk with flaring cradle struts
    const trunkTop = trunkPts[trunkPts.length - 1];
    const primaryCapR = height * rng.range(0.36, 0.45);
    const primaryDomeH = primaryCapR * rng.range(0.42, 0.52);
    const primaryRibs = 9 + Math.floor(rng.next() * 4);
    const crownCenter = new THREE.Vector3(trunkTop.x, trunkTop.y + primaryDomeH * 0.25, trunkTop.z);
    const crownTiltX = leanX * 0.0028 + rng.range(-0.10, 0.10);
    const crownTiltZ = leanZ * 0.0028 + rng.range(-0.10, 0.10);

    // 3..4 short flaring branch struts anchoring into the underside gill hub
    const cradleCount = 3 + Math.floor(rng.next() * 2);
    for (let c = 0; c < cradleCount; c++) {
      const cAng = (c / cradleCount) * Math.PI * 2 + twist;
      const strutOrigin = trunkPts[Math.max(1, trunkPts.length - 2)];
      const strutMid = new THREE.Vector3(
        THREE.MathUtils.lerp(strutOrigin.x, crownCenter.x, 0.5) + Math.cos(cAng) * primaryCapR * 0.16,
        THREE.MathUtils.lerp(strutOrigin.y, crownCenter.y, 0.5),
        THREE.MathUtils.lerp(strutOrigin.z, crownCenter.z, 0.5) + Math.sin(cAng) * primaryCapR * 0.16
      );
      const strutTip = new THREE.Vector3(
        crownCenter.x + Math.cos(cAng) * primaryCapR * 0.28,
        crownCenter.y - primaryDomeH * 0.04,
        crownCenter.z + Math.sin(cAng) * primaryCapR * 0.28
      );
      appendOrganicTube(
        trunkBuilder,
        [strutOrigin, strutMid, strutTip],
        [baseR * 0.28, baseR * 0.20, baseR * 0.12],
        5,
        (t) => barkMidCol.clone().lerp(capGillCol, t * 0.55),
        0.16,
        treeSeed + 80 + c * 17,
        true,
        () => barkVeinTuple
      );
    }

    appendUmbrellaCanopy(
      blossomBuilder,
      crownCenter,
      primaryCapR * rng.range(0.95, 1.08),
      primaryCapR * rng.range(0.95, 1.08),
      primaryDomeH,
      crownTiltX,
      crownTiltZ,
      primaryRibs,
      treeSeed + 503,
      capTopCol,
      capMidCol,
      capGillCol,
      frostHighlight
    );

    // 1..2 Secondary tiered side-umbrella canopies branching from lower limbs
    const subCanopyCount = rng.next() < 0.72 ? 2 : 1;
    const baseSubAng = rng.range(0, Math.PI * 2);
    for (let b = 0; b < subCanopyCount; b++) {
      const attachIdx = b === 0 ? Math.max(1, segCount - 3) : Math.max(1, segCount - 2);
      const origin = trunkPts[attachIdx];
      const bAng = baseSubAng + b * rng.range(2.2, 3.6);
      const reach = primaryCapR * rng.range(0.75, 1.05);
      const rise = height * rng.range(0.14, 0.24) - b * 14;
      const limbMid = new THREE.Vector3(
        origin.x + Math.cos(bAng) * reach * 0.52,
        origin.y + rise * 0.48,
        origin.z + Math.sin(bAng) * reach * 0.52
      );
      const limbTip = new THREE.Vector3(
        origin.x + Math.cos(bAng + rng.range(-0.18, 0.18)) * reach,
        origin.y + rise,
        origin.z + Math.sin(bAng + rng.range(-0.18, 0.18)) * reach
      );
      const rStart = baseR * rng.range(0.28, 0.36);
      appendOrganicTube(
        trunkBuilder,
        [origin, limbMid, limbTip],
        [rStart, rStart * 0.65, rStart * 0.34],
        5,
        (t) => barkMidCol.clone().lerp(capGillCol, t * 0.5),
        0.18,
        treeSeed + 140 + b * 29,
        true,
        () => barkVeinTuple
      );

      const subR = primaryCapR * rng.range(0.52, 0.70);
      const subH = subR * rng.range(0.42, 0.54);
      appendUmbrellaCanopy(
        blossomBuilder,
        new THREE.Vector3(limbTip.x, limbTip.y + subH * 0.2, limbTip.z),
        subR * rng.range(0.95, 1.08),
        subR * rng.range(0.95, 1.08),
        subH,
        Math.cos(bAng) * 0.22,
        Math.sin(bAng) * 0.22,
        8 + (b % 3),
        treeSeed + b * 71 + 7,
        capTopCol,
        capMidCol,
        capGillCol,
        frostHighlight
      );
    }

    addGroundAO(wx, wy, sup.height, baseR * 4.6, 0.52);

    if (treeCount % 4 === 0 && lightAnchors.length < 28) {
      lightAnchors.push({
        pos: new THREE.Vector3(crownCenter.x, crownCenter.y - 8, crownCenter.z),
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
    material: THREE.Material,
    extraAttrName?: string
  ): void => {
    if (builder.positions.length === 0 || builder.indices.length === 0) return;
    const geo = finalizeBuilderGeometry(builder, extraAttrName);
    totalVertices += geo.getAttribute('position').count;
    const mesh = new THREE.Mesh(geo, material);
    mesh.name = name;
    group.add(mesh);
    batchMeshCount++;
  };

  addBatch(
    'procedural_trees_trunks',
    trunkBuilder,
    makeAlienBarkMaterial(),
    'aBarkVeinColor'
  );
  addBatch(
    'procedural_trees_blossoms',
    blossomBuilder,
    makeAlienCanopyMaterial(),
    'aCanopyLocal'
  );
  addBatch(
    'procedural_boulders',
    boulderBuilder,
    new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.92, metalness: 0.08 })
  );
  addBatch(
    'procedural_crystals',
    crystalBuilder,
    makeAlienCrystalMaterial(),
    'aCrystalMeta'
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

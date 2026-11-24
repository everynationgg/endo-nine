import * as THREE from 'three';
import { ColliderTri, MeshTerrainCollider } from '../sim/MeshTerrainCollider';
import { Vector2 } from '../sim/types';

export interface CelestialShortcutBridgeController {
  group: THREE.Group;
  isActive: boolean;
  isMaterialized: boolean;
  startPoint: THREE.Vector3;
  endPoint: THREE.Vector3;
  activate(): void;
  reset(): void;
  update(dt: number, elapsedSec: number, playerWorldPos: THREE.Vector3): void;
  dispose(): void;
}

const BRIDGE_VERT = `
  uniform float uTime;
  uniform float uMaterializeProgress;
  attribute vec2 aBridgeUv;
  attribute float aEdgeFactor;
  varying vec2 vBridgeUv;
  varying float vEdgeFactor;
  varying vec3 vWorldPos;
  varying vec3 vWorldNormal;

  void main() {
    vBridgeUv = aBridgeUv;
    vEdgeFactor = aEdgeFactor;

    vec3 pos = position;
    // Gentle celestial ribbon levitation shimmer along outer margins once materialized
    float settle = smoothstep(0.0, 0.25, uMaterializeProgress - aBridgeUv.x * 0.75);
    float wave = sin(aBridgeUv.x * 16.0 - uTime * 2.4 + aBridgeUv.y * 5.0) * 1.4 * aEdgeFactor * settle;
    pos.y += wave;

    vec4 wp = modelMatrix * vec4(pos, 1.0);
    vWorldPos = wp.xyz;
    vWorldNormal = normalize(mat3(modelMatrix) * normal);
    gl_Position = projectionMatrix * viewMatrix * wp;
  }
`;

const BRIDGE_FRAG = `
  uniform float uTime;
  uniform float uMaterializeProgress;
  uniform vec3 uPlayerWorldPos;
  varying vec2 vBridgeUv;
  varying float vEdgeFactor;
  varying vec3 vWorldPos;
  varying vec3 vWorldNormal;

  float csHash(vec2 p) {
    p = fract(p * vec2(123.34, 456.21));
    p += dot(p, p + 45.32);
    return fract(p.x * p.y);
  }

  float csNoise(vec2 p) {
    vec2 i = floor(p);
    vec2 f = fract(p);
    f = f * f * (3.0 - 2.0 * f);
    float a = csHash(i);
    float b = csHash(i + vec2(1.0, 0.0));
    float c = csHash(i + vec2(0.0, 1.0));
    float d = csHash(i + vec2(1.0, 1.0));
    return mix(mix(a, b, f.x), mix(c, d, f.x), f.y);
  }

  float csFbm(vec2 p) {
    float v = 0.55 * csNoise(p);
    v += 0.30 * csNoise(p * 2.17 + vec2(5.1, 8.7));
    v += 0.15 * csNoise(p * 4.31 + vec2(13.4, 2.9));
    return v;
  }

  void main() {
    float spanU = vBridgeUv.x;
    // Progressive wave sweeping from Tower Summit (u=0) toward High Rock Formation (u=1)
    float waveJitter = (csNoise(vec2(spanU * 14.0, vBridgeUv.y * 5.0)) - 0.5) * 0.09;
    float frontier = uMaterializeProgress * 1.12;
    float revealed = smoothstep(frontier - 0.10, frontier, spanU + waveJitter);
    float alphaReveal = 1.0 - revealed;
    if (alphaReveal < 0.015) discard;

    // Leading starlight-forge wavefront glow while bridge materializes
    float edgeBand = smoothstep(frontier - 0.14, frontier - 0.03, spanU + waveJitter) * alphaReveal;
    float endSoft = smoothstep(0.0, 0.035, spanU) * smoothstep(1.0, 0.965, spanU);

    // Flowing nebula & aurora currents using Endo Nine logo palette
    vec2 flowUv1 = vec2(spanU * 7.5 - uTime * 0.18, vBridgeUv.y * 2.6 + sin(spanU * 8.0 + uTime * 0.35) * 0.25);
    vec2 flowUv2 = vec2(spanU * 13.0 + uTime * 0.12, vBridgeUv.y * 4.5 - uTime * 0.22);
    float neb1 = csFbm(flowUv1);
    float neb2 = csFbm(flowUv2);
    float auroraRibbon = smoothstep(0.42, 0.85, neb1 * 0.62 + neb2 * 0.38);

    // Subtle longitudinal filigree guide veins
    float latDist = abs(vBridgeUv.y - 0.5) * 2.0;
    float centerVeins = smoothstep(0.05, 0.0, abs(latDist - 0.24)) * 0.35 + smoothstep(0.04, 0.0, abs(latDist)) * 0.25;
    float railGlow = pow(smoothstep(0.68, 1.0, latDist), 1.6);

    // Embedded twinkling starlight motes
    vec2 starGrid = vec2(spanU * 46.0, vBridgeUv.y * 14.0);
    vec2 cell = floor(starGrid);
    vec2 cellUv = fract(starGrid) - 0.5;
    float rnd = csHash(cell);
    float starMask = step(0.76, rnd);
    float starTwinkle = 0.45 + 0.55 * sin(uTime * (2.5 + rnd * 4.0) + rnd * 6.2831);
    float starDot = starMask * smoothstep(0.32, 0.02, length(cellUv)) * starTwinkle;

    // Subtle proximity shimmer beneath player's boots
    float playerDist = length(vWorldPos.xz - uPlayerWorldPos.xz);
    float footAura = smoothstep(220.0, 15.0, playerDist) * smoothstep(150.0, 0.0, abs(vWorldPos.y - uPlayerWorldPos.y));

    vec3 deepCosmos = vec3(0.008, 0.018, 0.085); // #020518
    vec3 elecCyan   = vec3(0.0, 0.753, 1.0);     // #00c0ff
    vec3 elecBlue   = vec3(0.188, 0.376, 1.0);   // #3060ff
    vec3 elecViolet = vec3(0.439, 0.063, 1.0);   // #7010ff
    vec3 magWisp    = vec3(0.627, 0.0, 1.0);     // #a000ff
    vec3 starWhite  = vec3(0.86, 0.96, 1.0);

    vec3 baseCol = mix(deepCosmos, elecBlue * 0.55, neb1 * 0.75);
    baseCol = mix(baseCol, elecViolet * 0.85, auroraRibbon * smoothstep(0.25, 0.95, neb2));
    baseCol += mix(elecCyan, magWisp, latDist * 0.65) * (centerVeins * 0.45 + railGlow * 0.95);
    baseCol += elecCyan * footAura * 0.45;
    baseCol += starWhite * (starDot * 1.35 + edgeBand * 1.15);

    // Underside/edge Fresnel lift
    vec3 viewDir = normalize(cameraPosition - vWorldPos);
    float fresnel = pow(1.0 - abs(dot(normalize(vWorldNormal), viewDir)), 2.2);
    baseCol += mix(elecCyan, elecViolet, 0.5) * fresnel * 0.55;

    float alpha = clamp((0.68 + auroraRibbon * 0.18 + railGlow * 0.25 + edgeBand * 0.35) * mix(0.65, 1.0, endSoft), 0.0, 0.95) * alphaReveal;
    gl_FragColor = vec4(baseCol, alpha);
  }
`;

/**
 * Selects the optimal high-elevation rock landing anchor between the First Artifact Tower
 * and the Stage 1 Boss arena, returning the summit rim start and rock plateau end points.
 */
function findBridgeAnchors(
  col: MeshTerrainCollider,
  artifactPos: Vector2,
  bossSpawnPos: Vector2
): { startPoint: THREE.Vector3; endPoint: THREE.Vector3 } {
  const tower = col.getTowerBounds();
  const centerX = tower.hasTowerMesh ? tower.centerX : artifactPos.x;
  const centerZ = tower.hasTowerMesh ? tower.centerZ : artifactPos.y;

  const summitSup = col.querySupport(artifactPos.x, artifactPos.y, 1e6, 22);
  const summitY = summitSup.hit ? summitSup.height : (tower.hasTowerMesh ? tower.maxY : 4050);

  let dirX = bossSpawnPos.x - centerX;
  let dirZ = bossSpawnPos.y - centerZ;
  const dirLen = Math.hypot(dirX, dirZ) || 1;
  dirX /= dirLen;
  dirZ /= dirLen;

  let bestScore = -Infinity;
  let bestEnd: THREE.Vector3 | null = null;

  const scanCandidateSet = (minAlong: number, maxAlong: number, maxPerp: number, minHeight: number): void => {
    const tris = col.allTriangles;
    const stepStride = Math.max(1, Math.floor(tris.length / 45000));
    for (let i = 0; i < tris.length; i += stepStride) {
      const tri = tris[i];
      if (
        tri.sourceTag === 'node:first_artifact_tower' ||
        tri.sourceTag === 'node:tower_walkway' ||
        tri.sourceTag === 'node:ship' ||
        tri.sourceTag === 'celestial_bridge'
      ) {
        continue;
      }
      if (tri.category !== 'ground' && tri.category !== 'waterfall_rock' && tri.category !== 'bridge') continue;
      if (tri.ny < 0.62 || (tri.nySigned ?? 1) < 0.28) continue;

      const cx = (tri.ax + tri.bx + tri.cx) / 3;
      const cy = (tri.ay + tri.by + tri.cy) / 3;
      const cz = (tri.az + tri.bz + tri.cz) / 3;
      if (cy < minHeight || cy > summitY - 120) continue;

      const rx = cx - centerX;
      const rz = cz - centerZ;
      const along = rx * dirX + rz * dirZ;
      if (along < minAlong || along > maxAlong) continue;

      const perp = Math.abs(rx * -dirZ + rz * dirX);
      if (perp > maxPerp) continue;

      // Require clean player footing and clearance at this rock formation
      const sup = col.querySupport(cx, cz, cy + 28, 36);
      if (!sup.hit || sup.isInWater || Math.abs(sup.height - cy) > 36) continue;
      if (!col.checkHorizontalMove({ x: cx, y: cz }, { x: cx, y: cz }, sup.height + 4, 24, 88, 22, false).allowed) {
        continue;
      }

      // Favor elevated rocky overlooks at a natural shortcut span (~1600-2700u from tower center)
      const distPenalty = Math.abs(along - 2150) * 0.28 + perp * 0.22;
      const slopeBonus = tri.ny * 180;
      const score = sup.height * 1.45 + slopeBonus - distPenalty;
      if (score > bestScore) {
        bestScore = score;
        bestEnd = new THREE.Vector3(cx, sup.height, cz);
      }
    }
  };

  const baseTowerY = tower.hasTowerMesh ? tower.minY : 300;
  scanCandidateSet(1250, 3400, 1850, baseTowerY + 620);
  if (!bestEnd) {
    scanCandidateSet(1050, 4200, 2600, baseTowerY + 260);
  }

  // Fallback directly toward the boss ridge if map lacks high rock geometry
  if (!bestEnd) {
    const fbX = centerX + dirX * 1950;
    const fbZ = centerZ + dirZ * 1950;
    const fbSup = col.querySupport(fbX, fbZ, 1e6, 22);
    bestEnd = new THREE.Vector3(fbX, fbSup.hit ? fbSup.height : baseTowerY + 420, fbZ);
  }

  // Locate the outer walkable edge of the upper tower summit facing the chosen rock landing
  let spanDirX = bestEnd.x - centerX;
  let spanDirZ = bestEnd.z - centerZ;
  const spanLen = Math.hypot(spanDirX, spanDirZ) || 1;
  spanDirX /= spanLen;
  spanDirZ /= spanLen;

  let rimDist = 360;
  let rimY = summitY;
  for (let r = 220; r <= 620; r += 20) {
    const px = centerX + spanDirX * r;
    const pz = centerZ + spanDirZ * r;
    const sup = col.querySupport(px, pz, summitY + 24, 48);
    if (sup.hit && sup.category === 'tower_ledge' && sup.height >= summitY - 120) {
      rimDist = r;
      rimY = sup.height;
    }
  }
  const anchorR = Math.max(200, rimDist - 32);
  const startPoint = new THREE.Vector3(
    centerX + spanDirX * anchorR,
    rimY,
    centerZ + spanDirZ * anchorR
  );

  return { startPoint, endPoint: bestEnd };
}

function makeColliderTri(
  ax: number,
  ay: number,
  az: number,
  bx: number,
  by: number,
  bz: number,
  cx: number,
  cy: number,
  cz: number,
  category: 'bridge' | 'cliff'
): ColliderTri {
  const e1x = bx - ax;
  const e1y = by - ay;
  const e1z = bz - az;
  const e2x = cx - ax;
  const e2y = cy - ay;
  const e2z = cz - az;
  let nx = e1y * e2z - e1z * e2y;
  let ny = e1z * e2x - e1x * e2z;
  let nz = e1x * e2y - e1y * e2x;
  const len = Math.hypot(nx, ny, nz) || 1;
  nx /= len;
  ny /= len;
  nz /= len;

  return {
    ax, ay, az,
    bx, by, bz,
    cx, cy, cz,
    nx,
    ny: Math.abs(ny),
    nySigned: ny,
    nz,
    minX: Math.min(ax, bx, cx),
    maxX: Math.max(ax, bx, cx),
    minY: Math.min(ay, by, cy),
    maxY: Math.max(ay, by, cy),
    minZ: Math.min(az, bz, cz),
    maxZ: Math.max(az, bz, cz),
    category,
    baseCategory: category,
    sourceTag: 'celestial_bridge'
  };
}

/**
 * Builds the Stage 1 Celestial Shortcut Bridge linking the upper Artifact Tower platform
 * to the closest high rock formation along the route to the Boss Arena.
 * Inactive and non-solid until Stage 1 teleporter activation triggers Boss emergence.
 */
export function createCelestialShortcutBridge(
  col: MeshTerrainCollider,
  artifactPos: Vector2,
  bossSpawnPos: Vector2
): CelestialShortcutBridgeController {
  const { startPoint, endPoint } = findBridgeAnchors(col, artifactPos, bossSpawnPos);

  const group = new THREE.Group();
  group.name = 'Stage1_Celestial_Shortcut_Bridge';
  group.visible = false;

  const spanVec = new THREE.Vector3().subVectors(endPoint, startPoint);
  const horizLen = Math.hypot(spanVec.x, spanVec.z) || 1;
  const fwdXZ = new THREE.Vector3(spanVec.x / horizLen, 0, spanVec.z / horizLen);
  const rightXZ = new THREE.Vector3(-fwdXZ.z, 0, fwdXZ.x);

  const halfWidth = 112;
  const archLift = Math.max(45, Math.min(130, horizLen * 0.055));

  const sampleBridgePoint = (u: number): THREE.Vector3 => {
    const smoothU = u * u * (3 - 2 * u);
    const x = THREE.MathUtils.lerp(startPoint.x, endPoint.x, u);
    const z = THREE.MathUtils.lerp(startPoint.z, endPoint.z, u);
    // Gentle organic S-curve sway + parabolic sky arch, tucked slightly into landing surfaces at tips
    const lateralSway = Math.sin(u * Math.PI) * 58 * (u - 0.5) * 2.0;
    const tipSeat = (u < 0.06 ? (1 - u / 0.06) : u > 0.94 ? (u - 0.94) / 0.06 : 0) * -4.0;
    const y = THREE.MathUtils.lerp(startPoint.y, endPoint.y, smoothU) + Math.sin(u * Math.PI) * archLift + tipSeat;
    return new THREE.Vector3(x + rightXZ.x * lateralSway, y, z + rightXZ.z * lateralSway);
  };

  const SEGS_U = 44;
  const SEGS_V = 8;

  const positions: number[] = [];
  const normals: number[] = [];
  const bridgeUvs: number[] = [];
  const edgeFactors: number[] = [];
  const indices: number[] = [];

  // Build top & bottom volumetric aurora ribbon
  const centerLine: THREE.Vector3[] = [];
  const tangents: THREE.Vector3[] = [];
  const rights: THREE.Vector3[] = [];
  for (let iu = 0; iu <= SEGS_U; iu++) {
    centerLine.push(sampleBridgePoint(iu / SEGS_U));
  }
  for (let iu = 0; iu <= SEGS_U; iu++) {
    const prev = centerLine[Math.max(0, iu - 1)];
    const next = centerLine[Math.min(SEGS_U, iu + 1)];
    const tang = new THREE.Vector3().subVectors(next, prev).normalize();
    tangents.push(tang);
    const r = new THREE.Vector3().crossVectors(tang, new THREE.Vector3(0, 1, 0)).normalize();
    rights.push(r);
  }

  // Top Deck Surface
  const topStride = SEGS_V + 1;
  for (let iu = 0; iu <= SEGS_U; iu++) {
    const u = iu / SEGS_U;
    const flare = 1 + 0.24 * Math.pow(1 - Math.sin(u * Math.PI), 2.5);
    const w = halfWidth * flare;
    const c = centerLine[iu];
    const rVec = rights[iu];
    for (let iv = 0; iv <= SEGS_V; iv++) {
      const v = iv / SEGS_V;
      const lat = (v - 0.5) * 2.0; // -1..1
      const camber = (1 - lat * lat) * 3.5;
      const px = c.x + rVec.x * lat * w;
      const py = c.y + camber;
      const pz = c.z + rVec.z * lat * w;
      positions.push(px, py, pz);
      normals.push(0, 1, 0);
      bridgeUvs.push(u, v);
      edgeFactors.push(Math.abs(lat));
    }
  }
  for (let iu = 0; iu < SEGS_U; iu++) {
    for (let iv = 0; iv < SEGS_V; iv++) {
      const a = iu * topStride + iv;
      const b = (iu + 1) * topStride + iv;
      const c = (iu + 1) * topStride + (iv + 1);
      const d = iu * topStride + (iv + 1);
      indices.push(a, b, c, a, c, d);
    }
  }

  // Underside Crystalline Keel Belly
  const botBase = positions.length / 3;
  for (let iu = 0; iu <= SEGS_U; iu++) {
    const u = iu / SEGS_U;
    const flare = 1 + 0.24 * Math.pow(1 - Math.sin(u * Math.PI), 2.5);
    const w = halfWidth * flare;
    const c = centerLine[iu];
    const rVec = rights[iu];
    for (let iv = 0; iv <= SEGS_V; iv++) {
      const v = iv / SEGS_V;
      const lat = (v - 0.5) * 2.0;
      const keelDepth = 20 * (1 - lat * lat * 0.85) + 4;
      const px = c.x + rVec.x * lat * w;
      const py = c.y - keelDepth;
      const pz = c.z + rVec.z * lat * w;
      positions.push(px, py, pz);
      normals.push(0, -1, 0);
      bridgeUvs.push(u, v);
      edgeFactors.push(Math.abs(lat));
    }
  }
  for (let iu = 0; iu < SEGS_U; iu++) {
    for (let iv = 0; iv < SEGS_V; iv++) {
      const a = botBase + iu * topStride + iv;
      const b = botBase + (iu + 1) * topStride + iv;
      const c = botBase + (iu + 1) * topStride + (iv + 1);
      const d = botBase + iu * topStride + (iv + 1);
      indices.push(a, c, b, a, d, c);
    }
  }

  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geo.setAttribute('normal', new THREE.Float32BufferAttribute(normals, 3));
  geo.setAttribute('aBridgeUv', new THREE.Float32BufferAttribute(bridgeUvs, 2));
  geo.setAttribute('aEdgeFactor', new THREE.Float32BufferAttribute(edgeFactors, 1));
  geo.setIndex(indices);
  geo.computeVertexNormals();
  geo.computeBoundingSphere();

  const material = new THREE.ShaderMaterial({
    transparent: true,
    depthWrite: true,
    side: THREE.DoubleSide,
    uniforms: {
      uTime: { value: 0 },
      uMaterializeProgress: { value: 0 },
      uPlayerWorldPos: { value: new THREE.Vector3() }
    },
    vertexShader: BRIDGE_VERT,
    fragmentShader: BRIDGE_FRAG
  });

  const mesh = new THREE.Mesh(geo, material);
  mesh.name = 'Celestial_Shortcut_Ribbon_Mesh';
  mesh.renderOrder = 4;
  group.add(mesh);

  // Floating Starlight Edge Motes along the aurora bridge rails
  const moteCount = 180;
  const motePos = new Float32Array(moteCount * 3);
  const moteCol = new Float32Array(moteCount * 3);
  const moteMeta: Array<{ u: number; side: number; offsetH: number; phase: number; baseX: number; baseY: number; baseZ: number }> = [];
  const cCyan = new THREE.Color(0x00c0ff);
  const cViolet = new THREE.Color(0x7010ff);
  const cWhite = new THREE.Color(0xe0f2fe);
  for (let i = 0; i < moteCount; i++) {
    const u = (i + 0.5) / moteCount;
    const iu = Math.min(SEGS_U, Math.floor(u * SEGS_U));
    const c = centerLine[iu];
    const rVec = rights[iu];
    const side = i % 2 === 0 ? 1 : -1;
    const flare = 1 + 0.24 * Math.pow(1 - Math.sin(u * Math.PI), 2.5);
    const edgeDist = halfWidth * flare * (0.85 + ((i * 19) % 10) * 0.025);
    const bx = c.x + rVec.x * side * edgeDist;
    const by = c.y + 8 + ((i * 31) % 38);
    const bz = c.z + rVec.z * side * edgeDist;
    motePos[i * 3] = bx;
    motePos[i * 3 + 1] = by;
    motePos[i * 3 + 2] = bz;
    const colMix = i % 5 === 0 ? cWhite : cCyan.clone().lerp(cViolet, (i % 7) / 6);
    moteCol[i * 3] = colMix.r;
    moteCol[i * 3 + 1] = colMix.g;
    moteCol[i * 3 + 2] = colMix.b;
    moteMeta.push({ u, side, offsetH: 8 + ((i * 31) % 38), phase: i * 0.73, baseX: bx, baseY: by, baseZ: bz });
  }
  const moteGeo = new THREE.BufferGeometry();
  moteGeo.setAttribute('position', new THREE.BufferAttribute(motePos, 3));
  moteGeo.setAttribute('color', new THREE.BufferAttribute(moteCol, 3));
  const moteMat = new THREE.PointsMaterial({
    size: 11,
    vertexColors: true,
    transparent: true,
    opacity: 0,
    blending: THREE.AdditiveBlending,
    depthWrite: false
  });
  const motePoints = new THREE.Points(moteGeo, moteMat);
  motePoints.frustumCulled = false;
  group.add(motePoints);

  // Build simplified collision triangles (inactive until bridge materializes)
  const colTris: ColliderTri[] = [];
  const COL_U = 34;
  for (let iu = 0; iu < COL_U; iu++) {
    const u0 = iu / COL_U;
    const u1 = (iu + 1) / COL_U;
    const p0 = sampleBridgePoint(u0);
    const p1 = sampleBridgePoint(u1);
    const tang = new THREE.Vector3().subVectors(p1, p0).normalize();
    const rVec = new THREE.Vector3().crossVectors(tang, new THREE.Vector3(0, 1, 0)).normalize();
    const flare0 = 1 + 0.24 * Math.pow(1 - Math.sin(u0 * Math.PI), 2.5);
    const flare1 = 1 + 0.24 * Math.pow(1 - Math.sin(u1 * Math.PI), 2.5);
    const w0 = (halfWidth + 8) * flare0;
    const w1 = (halfWidth + 8) * flare1;

    const l0 = new THREE.Vector3(p0.x - rVec.x * w0, p0.y, p0.z - rVec.z * w0);
    const r0 = new THREE.Vector3(p0.x + rVec.x * w0, p0.y, p0.z + rVec.z * w0);
    const l1 = new THREE.Vector3(p1.x - rVec.x * w1, p1.y, p1.z - rVec.z * w1);
    const r1 = new THREE.Vector3(p1.x + rVec.x * w1, p1.y, p1.z + rVec.z * w1);

    // Ensure upward-facing triangle winding (+Y)
    const tA = makeColliderTri(l0.x, l0.y, l0.z, r1.x, r1.y, r1.z, r0.x, r0.y, r0.z, 'bridge');
    const tB = makeColliderTri(l0.x, l0.y, l0.z, l1.x, l1.y, l1.z, r1.x, r1.y, r1.z, 'bridge');
    if ((tA.nySigned ?? 1) < 0) {
      colTris.push(makeColliderTri(l0.x, l0.y, l0.z, r0.x, r0.y, r0.z, r1.x, r1.y, r1.z, 'bridge'));
    } else {
      colTris.push(tA);
    }
    if ((tB.nySigned ?? 1) < 0) {
      colTris.push(makeColliderTri(l0.x, l0.y, l0.z, r1.x, r1.y, r1.z, l1.x, l1.y, l1.z, 'bridge'));
    } else {
      colTris.push(tB);
    }

    // Subtle lateral guard rails along the elevated span (open at entry & exit aprons)
    if (u0 >= 0.08 && u1 <= 0.92) {
      const curbH = 72;
      colTris.push(
        makeColliderTri(l0.x, l0.y, l0.z, l0.x, l0.y + curbH, l0.z, l1.x, l1.y + curbH, l1.z, 'cliff'),
        makeColliderTri(l0.x, l0.y, l0.z, l1.x, l1.y + curbH, l1.z, l1.x, l1.y, l1.z, 'cliff'),
        makeColliderTri(r0.x, r0.y, r0.z, r1.x, r1.y + curbH, r1.z, r0.x, r0.y + curbH, r0.z, 'cliff'),
        makeColliderTri(r0.x, r0.y, r0.z, r1.x, r1.y, r1.z, r1.x, r1.y + curbH, r1.z, 'cliff')
      );
    }
  }

  col.registerCelestialBridgeTriangles(colTris);
  col.setCelestialBridgeActive(false);

  let isActive = false;
  let isMaterialized = false;
  let progress = 0;

  return {
    group,
    get isActive() {
      return isActive;
    },
    get isMaterialized() {
      return isMaterialized;
    },
    startPoint,
    endPoint,
    activate() {
      if (isActive) return;
      isActive = true;
      group.visible = true;
    },
    reset() {
      isActive = false;
      isMaterialized = false;
      progress = 0;
      group.visible = false;
      material.uniforms.uMaterializeProgress.value = 0;
      moteMat.opacity = 0;
      col.setCelestialBridgeActive(false);
    },
    update(dt: number, elapsedSec: number, playerWorldPos: THREE.Vector3) {
      if (!isActive) return;
      material.uniforms.uTime.value = elapsedSec;
      material.uniforms.uPlayerWorldPos.value.copy(playerWorldPos);

      if (progress < 1) {
        progress = Math.min(1, progress + dt / 2.45);
        material.uniforms.uMaterializeProgress.value = progress;
        moteMat.opacity = Math.min(0.88, progress * 1.15);
        if (progress >= 0.92 && !isMaterialized) {
          isMaterialized = true;
          col.setCelestialBridgeActive(true);
        }
      } else {
        if (!isMaterialized) {
          isMaterialized = true;
          col.setCelestialBridgeActive(true);
        }
        moteMat.opacity = 0.78 + 0.12 * Math.sin(elapsedSec * 2.2);
      }

      const attr = moteGeo.getAttribute('position') as THREE.BufferAttribute;
      const arr = attr.array as Float32Array;
      for (let i = 0; i < moteMeta.length; i++) {
        const m = moteMeta[i];
        const lift = ((elapsedSec * 14 + m.phase * 12) % 36);
        arr[i * 3 + 1] = m.baseY + lift;
      }
      attr.needsUpdate = true;
    },
    dispose() {
      col.setCelestialBridgeActive(false);
      geo.dispose();
      material.dispose();
      moteGeo.dispose();
      moteMat.dispose();
      group.parent?.remove(group);
    }
  };
}

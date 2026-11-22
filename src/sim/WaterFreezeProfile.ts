export const WATER_FREEZE_KNOTS = 16;

export interface WaterFreezeProfile {
  axis: 'z' | 'x';
  minAxis: number;
  maxAxis: number;
  centerSamples: number[];
  halfWidthSamples: number[];
  waterfallPools: Array<{ x: number; z: number; radius: number }>;
  waterLevelY: number;
}

function clamp(v: number, lo: number, hi: number): number {
  return v < lo ? lo : v > hi ? hi : v;
}

function smoothstep(edge0: number, edge1: number, x: number): number {
  const denom = edge1 - edge0;
  const t = clamp(Math.abs(denom) > 1e-6 ? (x - edge0) / denom : 0, 0, 1);
  return t * t * (3 - 2 * t);
}

/**
 * Analyzes world-space water mesh sample points to derive a smooth 16-knot centerline
 * and half-width profile for the flowing open-water river channel, freezing lakes and banks.
 */
export function buildWaterFreezeProfile(
  waterPoints: Array<{ x: number; z: number; y: number; isMainRiver: boolean }>,
  waterfallPools: Array<{ x: number; z: number; radius: number }>
): WaterFreezeProfile | null {
  if (waterPoints.length === 0) return null;

  const yVals = waterPoints.map((p) => p.y).sort((a, b) => a - b);
  const waterLevelY = yVals[Math.floor(yVals.length * 0.5)];

  const mainPts = waterPoints.filter((p) => p.isMainRiver);
  const srcPts = mainPts.length >= 12 ? mainPts : waterPoints;

  let minX = Infinity;
  let maxX = -Infinity;
  let minZ = Infinity;
  let maxZ = -Infinity;
  for (let i = 0; i < srcPts.length; i++) {
    const p = srcPts[i];
    if (p.x < minX) minX = p.x;
    if (p.x > maxX) maxX = p.x;
    if (p.z < minZ) minZ = p.z;
    if (p.z > maxZ) maxZ = p.z;
  }

  const axis: 'z' | 'x' = maxZ - minZ >= maxX - minX ? 'z' : 'x';
  const minAxis = axis === 'z' ? minZ : minX;
  const maxAxis = axis === 'z' ? maxZ : maxX;
  const axisSpan = Math.max(1, maxAxis - minAxis);

  const bins: number[][] = Array.from({ length: WATER_FREEZE_KNOTS }, () => []);
  for (let i = 0; i < srcPts.length; i++) {
    const p = srcPts[i];
    const axisVal = axis === 'z' ? p.z : p.x;
    const perpVal = axis === 'z' ? p.x : p.z;
    const u = clamp((axisVal - minAxis) / axisSpan, 0, 0.999999);
    const binIdx = Math.min(WATER_FREEZE_KNOTS - 1, Math.floor(u * WATER_FREEZE_KNOTS));
    bins[binIdx].push(perpVal);
  }

  const rawCenters = new Array<number>(WATER_FREEZE_KNOTS).fill(NaN);
  const rawHalfWidths = new Array<number>(WATER_FREEZE_KNOTS).fill(NaN);

  for (let k = 0; k < WATER_FREEZE_KNOTS; k++) {
    const arr = bins[k];
    if (arr.length === 0) continue;
    arr.sort((a, b) => a - b);
    const med = arr[Math.floor(arr.length * 0.5)];
    const span = arr[arr.length - 1] - arr[0];
    rawCenters[k] = med;
    rawHalfWidths[k] = clamp(span * 0.14, 95, 185);
  }

  // Fallback global median in case all bins were sparse
  const fallbackCenter =
    axis === 'z' ? (minX + maxX) * 0.5 : (minZ + maxZ) * 0.5;
  const fallbackHalfW = 135;

  // Fill empty bins via linear interpolation from nearest populated neighbors
  for (let k = 0; k < WATER_FREEZE_KNOTS; k++) {
    if (Number.isFinite(rawCenters[k])) continue;
    let prev = k - 1;
    while (prev >= 0 && !Number.isFinite(rawCenters[prev])) prev--;
    let next = k + 1;
    while (next < WATER_FREEZE_KNOTS && !Number.isFinite(rawCenters[next])) next++;

    if (prev >= 0 && next < WATER_FREEZE_KNOTS) {
      const t = (k - prev) / (next - prev);
      rawCenters[k] = rawCenters[prev] + (rawCenters[next] - rawCenters[prev]) * t;
      rawHalfWidths[k] = rawHalfWidths[prev] + (rawHalfWidths[next] - rawHalfWidths[prev]) * t;
    } else if (prev >= 0) {
      rawCenters[k] = rawCenters[prev];
      rawHalfWidths[k] = rawHalfWidths[prev];
    } else if (next < WATER_FREEZE_KNOTS) {
      rawCenters[k] = rawCenters[next];
      rawHalfWidths[k] = rawHalfWidths[next];
    } else {
      rawCenters[k] = fallbackCenter;
      rawHalfWidths[k] = fallbackHalfW;
    }
  }

  // Two passes of [0.25, 0.5, 0.25] smoothing for a gentle serpentine channel
  let centers = rawCenters;
  let halfWidths = rawHalfWidths;
  for (let pass = 0; pass < 2; pass++) {
    const nextC = new Array<number>(WATER_FREEZE_KNOTS);
    const nextW = new Array<number>(WATER_FREEZE_KNOTS);
    for (let k = 0; k < WATER_FREEZE_KNOTS; k++) {
      const km = Math.max(0, k - 1);
      const kp = Math.min(WATER_FREEZE_KNOTS - 1, k + 1);
      nextC[k] = centers[km] * 0.25 + centers[k] * 0.5 + centers[kp] * 0.25;
      nextW[k] = halfWidths[km] * 0.25 + halfWidths[k] * 0.5 + halfWidths[kp] * 0.25;
    }
    centers = nextC;
    halfWidths = nextW;
  }

  return {
    axis,
    minAxis,
    maxAxis,
    centerSamples: centers,
    halfWidthSamples: halfWidths,
    waterfallPools: waterfallPools.map((p) => ({ ...p })),
    waterLevelY
  };
}

/**
 * Evaluates openness in [0, 1] at world position (wx, wz):
 * 0 = solid frozen ice, 1 = flowing open meltwater channel or waterfall plunge pool.
 * Must match the GLSL `sampleOpenWaterFactorGLSL` math in TestMapLoader verbatim.
 */
export function sampleOpenWaterFactor(wx: number, wz: number, profile: WaterFreezeProfile): number {
  let poolOpen = 0;
  for (let i = 0; i < profile.waterfallPools.length; i++) {
    const pool = profile.waterfallPools[i];
    const d = Math.hypot(wx - pool.x, wz - pool.z);
    const po = 1 - smoothstep(pool.radius - 45, pool.radius + 45, d);
    if (po > poolOpen) poolOpen = po;
  }

  const axisCoord = profile.axis === 'z' ? wz : wx;
  const perpCoord = profile.axis === 'z' ? wx : wz;

  let edgeFade = 0;
  if (axisCoord >= profile.minAxis - 80 && axisCoord <= profile.maxAxis + 80) {
    const u = clamp((axisCoord - profile.minAxis) / Math.max(1, profile.maxAxis - profile.minAxis), 0, 1);
    const fIdx = u * (WATER_FREEZE_KNOTS - 1);
    const i0 = Math.min(WATER_FREEZE_KNOTS - 2, Math.floor(fIdx));
    const frac = fIdx - i0;
    const center =
      profile.centerSamples[i0] + (profile.centerSamples[i0 + 1] - profile.centerSamples[i0]) * frac;
    const halfW =
      profile.halfWidthSamples[i0] + (profile.halfWidthSamples[i0 + 1] - profile.halfWidthSamples[i0]) * frac;

    const meander = Math.sin(axisCoord * 0.0045) * 28.0 + Math.sin(axisCoord * 0.011 + 1.7) * 14.0;
    const dist = Math.abs(perpCoord - (center + meander));
    edgeFade = 1 - smoothstep(halfW - 26, halfW + 26, dist);
  }

  return poolOpen > edgeFade ? poolOpen : edgeFade;
}

export function isPointInOpenWater(wx: number, wz: number, profile: WaterFreezeProfile): boolean {
  return sampleOpenWaterFactor(wx, wz, profile) >= 0.5;
}

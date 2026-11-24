import { TerrainSurfaceCategory, Vector2 } from './types';
import { WaterFreezeProfile, isPointInOpenWater } from './WaterFreezeProfile';

export interface ColliderTri {
  ax: number;
  ay: number;
  az: number;
  bx: number;
  by: number;
  bz: number;
  cx: number;
  cy: number;
  cz: number;
  nx: number;
  ny: number;
  nySigned?: number;
  nz: number;
  minX: number;
  maxX: number;
  minY: number;
  maxY: number;
  minZ: number;
  maxZ: number;
  category: TerrainSurfaceCategory;
  baseCategory: TerrainSurfaceCategory;
  sourceTag: string;
}

export interface SupportQueryResult {
  hit: boolean;
  height: number;
  category: TerrainSurfaceCategory;
  isWalkable: boolean;
  isInWater: boolean;
  normalY: number;
  sourceTag: string;
}

export interface HorizontalMoveResult {
  allowed: boolean;
  newPos: Vector2;
  surfaceNormal: Vector2;
  reason?: string;
}

export interface RejectedMoveRecord {
  fromX: number;
  fromY: number;
  toX: number;
  toY: number;
  z: number;
  reason: string;
}

export interface Raycast3DResult {
  hit: boolean;
  t: number;
  point?: { x: number; y: number; z: number };
  category?: TerrainSurfaceCategory;
  sourceTag?: string;
}

export interface NavWaypointQueryResult {
  waypoint: Vector2;
  isReachable: boolean;
  isAtStandoff: boolean;
  status: 'direct' | 'pathfinding' | 'unreachable_standoff' | 'unreachable_patrol';
  standoffPos?: Vector2;
}

const WALKABLE_CATEGORIES = new Set<TerrainSurfaceCategory>([
  'ground',
  'waterfall_rock',
  'bridge',
  'tower_ledge',
  'ship_walkable',
  'water'
]);

const BLOCKING_CATEGORIES = new Set<TerrainSurfaceCategory>([
  'cliff',
  'solid_obstacle',
  'border'
]);

const SEAM_OFFSETS: ReadonlyArray<readonly [number, number]> = [
  [4.0, 0],
  [-4.0, 0],
  [0, 4.0],
  [0, -4.0],
  [3.5, 3.5],
  [-3.5, 3.5],
  [3.5, -3.5],
  [-3.5, -3.5]
];

const LIP_OFFSETS: ReadonlyArray<readonly [number, number]> = [
  [10, 0], [-10, 0], [0, 10], [0, -10],
  [7.1, 7.1], [-7.1, 7.1], [7.1, -7.1], [-7.1, -7.1],
  [18, 0], [-18, 0], [0, 18], [0, -18],
  [12.7, 12.7], [-12.7, 12.7], [12.7, -12.7], [-12.7, -12.7]
];

const CEILING_OFFSETS: ReadonlyArray<readonly [number, number]> = [
  [18, 0],
  [-18, 0],
  [0, 18],
  [0, -18],
  [26, 26],
  [-26, 26],
  [26, -26],
  [-26, -26]
];

const SLICE_PTS = new Float64Array(12);
const SLICE_SEG = { x1: 0, z1: 0, x2: 0, z2: 0 };
const SLICE_Y_VALS = new Float64Array(3);
const OVERLAP_HIT = { pen: 0, nx: 0, nz: 0 };

interface NavLayerNode {
  id: number;
  gx: number;
  gz: number;
  x: number;
  y: number;
  z: number; // elevation
  category: TerrainSurfaceCategory;
  neighbors: Array<{ id: number; cost: number }>;
}

/**
 * Spatial-accelerated true-3D static triangle collider and navigation builder
 * for imported SketchUp / GLB maps. Supports multi-layer geometry (bridges over water,
 * waterfall stepping stones, tower ledges, ship decks, solid crystals, and pass-through trees).
 */
export class MeshTerrainCollider {
  public readonly worldWidth: number;
  public readonly worldHeight: number;
  public readonly cellSize: number;
  public readonly cols: number;
  public readonly rows: number;
  public readonly buckets: ColliderTri[][];
  public readonly allTriangles: ColliderTri[];
  public readonly sourceTags: string[];
  public overrides: Record<string, TerrainSurfaceCategory> = {};
  public waterFreezeProfile: WaterFreezeProfile | null = null;

  public playableBounds: { minX: number; maxX: number; minY: number; maxY: number };

  // Multi-layer 3D NavGraph & pre-allocated A* scratch buffers
  private navCellSize: number = 64;
  private navCols: number = 0;
  private navRows: number = 0;
  private navNodes: NavLayerNode[] = [];
  private navCellBuckets: number[][] = [];
  public validEnemySpawnPositions: Vector2[] = [];
  private astarGScore: Float32Array = new Float32Array(0);
  private astarFScore: Float32Array = new Float32Array(0);
  private astarCameFrom: Int32Array = new Int32Array(0);
  private astarVisitedGen: Int32Array = new Int32Array(0);
  private astarClosedGen: Int32Array = new Int32Array(0);
  private astarInOpenGen: Int32Array = new Int32Array(0);
  private astarHeapPos: Int32Array = new Int32Array(0);
  private astarHeap: Int32Array = new Int32Array(0);
  private astarSearchGen: number = 0;

  // Dynamic Tower core & bottom-cap bounds computed from loaded mesh triangles
  private readonly towerBottomCapMaxY: number;
  private readonly hasTowerMesh: boolean;
  private readonly towerCenterX: number;
  private readonly towerCenterZ: number;
  private readonly towerMinY: number;
  private readonly towerMaxY: number;
  private readonly towerOuterMaxR: number;
  private readonly towerCoreRadiusSlices: Float32Array;
  private readonly towerSliceHeight: number = 100;

  // Dynamic Celestial Shortcut Bridge state (inactive until Stage 1 Teleporter Boss Trigger)
  private celestialBridgeActive: boolean = false;
  private celestialBridgeTris: ColliderTri[] = [];

  // Reusable scratch containers to keep per-frame heap allocations near zero
  private readonly visitedTriSet: Set<ColliderTri> = new Set();

  // Developer-only ring buffer of recent rejected player-sized horizontal movement probes
  public recentRejectedMoves: RejectedMoveRecord[] = [];

  constructor(
    triangles: ColliderTri[],
    worldWidth: number,
    worldHeight: number,
    playableBounds: { minX: number; maxX: number; minY: number; maxY: number },
    overrides?: Record<string, TerrainSurfaceCategory>,
    waterFreezeProfile?: WaterFreezeProfile | null
  ) {
    this.worldWidth = worldWidth;
    this.worldHeight = worldHeight;
    this.playableBounds = { ...playableBounds };
    this.waterFreezeProfile = waterFreezeProfile ?? null;
    this.cellSize = 48;
    this.cols = Math.max(1, Math.ceil(worldWidth / this.cellSize));
    this.rows = Math.max(1, Math.ceil(worldHeight / this.cellSize));
    this.buckets = Array.from({ length: this.cols * this.rows }, () => []);
    this.allTriangles = triangles;

    let minTowerY = Infinity;
    let maxTowerY = -Infinity;
    let minTowerX = Infinity;
    let maxTowerX = -Infinity;
    let minTowerZ = Infinity;
    let maxTowerZ = -Infinity;
    const tagSet = new Set<string>();
    for (let i = 0; i < triangles.length; i++) {
      const tri = triangles[i];
      tagSet.add(tri.sourceTag);
      if (tri.sourceTag === 'node:first_artifact_tower' || tri.sourceTag === 'node:tower_walkway') {
        if (tri.minY < minTowerY) minTowerY = tri.minY;
        if (tri.maxY > maxTowerY) maxTowerY = tri.maxY;
        if (tri.minX < minTowerX) minTowerX = tri.minX;
        if (tri.maxX > maxTowerX) maxTowerX = tri.maxX;
        if (tri.minZ < minTowerZ) minTowerZ = tri.minZ;
        if (tri.maxZ > maxTowerZ) maxTowerZ = tri.maxZ;
      }

      const c0 = Math.max(0, Math.min(this.cols - 1, Math.floor(tri.minX / this.cellSize)));
      const c1 = Math.max(0, Math.min(this.cols - 1, Math.floor(tri.maxX / this.cellSize)));
      const r0 = Math.max(0, Math.min(this.rows - 1, Math.floor(tri.minZ / this.cellSize)));
      const r1 = Math.max(0, Math.min(this.rows - 1, Math.floor(tri.maxZ / this.cellSize)));

      for (let r = r0; r <= r1; r++) {
        const rowOff = r * this.cols;
        for (let c = c0; c <= c1; c++) {
          this.buckets[rowOff + c].push(tri);
        }
      }
    }

    this.hasTowerMesh = Number.isFinite(minTowerY) && Number.isFinite(maxTowerY);
    this.towerMinY = this.hasTowerMesh ? minTowerY : 0;
    this.towerMaxY = this.hasTowerMesh ? maxTowerY : 0;
    this.towerCenterX = this.hasTowerMesh ? (minTowerX + maxTowerX) * 0.5 : 0;
    this.towerCenterZ = this.hasTowerMesh ? (minTowerZ + maxTowerZ) * 0.5 : 0;
    this.towerOuterMaxR = this.hasTowerMesh
      ? Math.hypot(maxTowerX - minTowerX, maxTowerZ - minTowerZ) * 0.55 + 80
      : 0;
    this.towerBottomCapMaxY = this.hasTowerMesh ? minTowerY + 350 : 720;

    // Build slice-by-slice solid inner core radius table for the Tower shaft (strictly inside exterior spiral walkways)
    const sliceCount = this.hasTowerMesh
      ? Math.max(1, Math.ceil((this.towerMaxY - this.towerMinY + 200) / this.towerSliceHeight))
      : 1;
    this.towerCoreRadiusSlices = new Float32Array(sliceCount);
    if (this.hasTowerMesh) {
      const minWalkRBySlice = new Float32Array(sliceCount);
      minWalkRBySlice.fill(Infinity);
      for (let i = 0; i < triangles.length; i++) {
        const tri = triangles[i];
        if (tri.sourceTag !== 'node:tower_walkway') continue;
        if (tri.ny < 0.45 || (tri.nySigned ?? 1) <= 0.1) continue;
        const cx = (tri.ax + tri.bx + tri.cx) / 3;
        const cy = (tri.ay + tri.by + tri.cy) / 3;
        const cz = (tri.az + tri.bz + tri.cz) / 3;
        const r = Math.hypot(cx - this.towerCenterX, cz - this.towerCenterZ);
        const sIdx = Math.max(0, Math.min(sliceCount - 1, Math.floor((cy - this.towerMinY) / this.towerSliceHeight)));
        if (r < minWalkRBySlice[sIdx]) {
          minWalkRBySlice[sIdx] = r;
        }
      }
      // Fill slices that have no direct walkway steps by interpolating from neighboring slices,
      // and leave a generous 18u margin inside the inner stair edge so spiral walking never catches.
      let lastKnown = 560;
      for (let s = 0; s < sliceCount; s++) {
        const sliceTopY = this.towerMinY + (s + 1) * this.towerSliceHeight;
        if (sliceTopY >= this.towerMaxY - 120) {
          // Summit deck region: never block Summit surface via cylinder check (overhead roof check seals the shaft lip)
          this.towerCoreRadiusSlices[s] = 0;
          continue;
        }
        if (Number.isFinite(minWalkRBySlice[s])) {
          lastKnown = Math.max(0, minWalkRBySlice[s] - 18);
          this.towerCoreRadiusSlices[s] = lastKnown;
        } else {
          // Look ahead to find tighter upper core radius if stepping inward
          let nextKnown = lastKnown;
          for (let k = s + 1; k < sliceCount; k++) {
            if (Number.isFinite(minWalkRBySlice[k])) {
              nextKnown = Math.max(0, minWalkRBySlice[k] - 18);
              break;
            }
          }
          this.towerCoreRadiusSlices[s] = Math.min(lastKnown, nextKnown);
        }
      }
    }

    this.sourceTags = Array.from(tagSet).sort();
    if (overrides) {
      this.applyOverrides(overrides);
    } else {
      this.rebuildNavigationGraph();
    }
  }

  public applyOverrides(overrides: Record<string, TerrainSurfaceCategory>): void {
    this.overrides = { ...overrides };
    for (let i = 0; i < this.allTriangles.length; i++) {
      const tri = this.allTriangles[i];
      const ov = this.overrides[tri.sourceTag];
      if (ov) {
        if ((ov === 'tower_ledge' || ov === 'ship_walkable') && tri.sourceTag !== 'node:tower_walkway' && tri.ny < 0.20) {
          tri.category = 'cliff';
        } else {
          tri.category = ov;
        }
      } else {
        tri.category = tri.baseCategory;
      }
    }
    this.rebuildNavigationGraph();
  }

  public getTowerBounds(): {
    hasTowerMesh: boolean;
    centerX: number;
    centerZ: number;
    minY: number;
    maxY: number;
    outerMaxR: number;
    bottomCapMaxY: number;
  } {
    return {
      hasTowerMesh: this.hasTowerMesh,
      centerX: this.towerCenterX,
      centerZ: this.towerCenterZ,
      minY: this.towerMinY,
      maxY: this.towerMaxY,
      outerMaxR: this.towerOuterMaxR,
      bottomCapMaxY: this.towerBottomCapMaxY
    };
  }

  public registerCelestialBridgeTriangles(tris: ColliderTri[]): void {
    this.celestialBridgeTris = [];
    for (let i = 0; i < tris.length; i++) {
      const tri: ColliderTri = { ...tris[i], sourceTag: 'celestial_bridge' };
      this.celestialBridgeTris.push(tri);
      this.allTriangles.push(tri);
      const c0 = Math.max(0, Math.min(this.cols - 1, Math.floor(tri.minX / this.cellSize)));
      const c1 = Math.max(0, Math.min(this.cols - 1, Math.floor(tri.maxX / this.cellSize)));
      const r0 = Math.max(0, Math.min(this.rows - 1, Math.floor(tri.minZ / this.cellSize)));
      const r1 = Math.max(0, Math.min(this.rows - 1, Math.floor(tri.maxZ / this.cellSize)));
      for (let r = r0; r <= r1; r++) {
        const rowOff = r * this.cols;
        for (let c = c0; c <= c1; c++) {
          this.buckets[rowOff + c].push(tri);
        }
      }
    }
    if (tris.length > 0 && !this.sourceTags.includes('celestial_bridge')) {
      this.sourceTags.push('celestial_bridge');
      this.sourceTags.sort();
    }
  }

  public setCelestialBridgeActive(active: boolean): void {
    this.celestialBridgeActive = active;
  }

  public isCelestialBridgeEnabled(): boolean {
    return this.celestialBridgeActive;
  }

  public getSourceSummary(): Array<{ sourceTag: string; defaultCategory: TerrainSurfaceCategory; activeCategory: TerrainSurfaceCategory; triCount: number }> {
    const map = new Map<string, { defaultCategory: TerrainSurfaceCategory; activeCategory: TerrainSurfaceCategory; triCount: number }>();
    for (let i = 0; i < this.allTriangles.length; i++) {
      const tri = this.allTriangles[i];
      let entry = map.get(tri.sourceTag);
      if (!entry) {
        entry = {
          defaultCategory: tri.baseCategory,
          activeCategory: this.overrides[tri.sourceTag] || tri.baseCategory,
          triCount: 0
        };
        map.set(tri.sourceTag, entry);
      }
      entry.triCount++;
    }
    return Array.from(map.entries())
      .map(([sourceTag, info]) => ({ sourceTag, ...info }))
      .sort((a, b) => a.sourceTag.localeCompare(b.sourceTag));
  }

  /**
   * True 3D ground support query at world (wx, wy) relative to entity's current elevation entityZ.
   * Correctly resolves bridges over water, ship hulls, waterfall stones, and tower ledges.
   */
  public querySupport(wx: number, wy: number, entityZ: number, stepUpLimit: number = 22): SupportQueryResult {
    if (!Number.isFinite(wx) || !Number.isFinite(wy) || !Number.isFinite(entityZ)) {
      return {
        hit: false,
        height: 0,
        category: 'border',
        isWalkable: false,
        isInWater: false,
        normalY: 1,
        sourceTag: 'none'
      };
    }
    const col = Math.max(0, Math.min(this.cols - 1, Math.floor(wx / this.cellSize)));
    const row = Math.max(0, Math.min(this.rows - 1, Math.floor(wy / this.cellSize)));
    const tris = this.buckets[row * this.cols + col];

    let bestSolidY = -Infinity;
    let bestSolidTri: ColliderTri | null = null;
    let bestBaseFloorY = -Infinity;
    let bestBaseFloorTri: ColliderTri | null = null;
    let bestHighGroundY = -Infinity;
    let bestHighGroundTri: ColliderTri | null = null;
    let bestWaterY = -Infinity;
    let bestWaterTri: ColliderTri | null = null;
    let bestDryGroundAboveWaterY = -Infinity;
    let bestIgnoredAboveCeilingY = -Infinity;
    let bestIgnoredAboveCeilingTri: ColliderTri | null = null;
    let maxUpwardGroundY = -Infinity;
    let bestFlippedGroundY = -Infinity;
    let bestFlippedGroundTri: ColliderTri | null = null;
    let bestCrestGroundY = -Infinity;
    let bestCrestGroundTri: ColliderTri | null = null;

    // Fallback in case entity slipped slightly under all triangles
    let anyFloorY = -Infinity;
    let anyFloorTri: ColliderTri | null = null;

    const isTopDownQuery = entityZ >= 1e5;
    const effectiveReach = Math.max(stepUpLimit, 56);
    const structureReachY = entityZ + effectiveReach;
    const groundReachY = entityZ + effectiveReach;

    // Pass 1: Detect any downward-facing ceiling/underside above the entity (bridges, arches, cliff overhangs)
    let minGroundCeilingY = Infinity;
    if (!isTopDownQuery) {
      for (let i = 0; i < tris.length; i++) {
        const tri = tris[i];
        if (!this.celestialBridgeActive && tri.sourceTag === 'celestial_bridge') continue;
        if (
          tri.sourceTag !== 'terrain:ground' &&
          tri.category !== 'bridge' &&
          tri.category !== 'waterfall_rock'
        ) {
          continue;
        }
        if ((tri.nySigned ?? 1) >= -0.05) continue;
        if (tri.maxY < entityZ + 32) continue;
        if (wx < tri.minX - 0.8 || wx > tri.maxX + 0.8 || wy < tri.minZ - 0.8 || wy > tri.maxZ + 0.8) continue;
        const ceilY = this.barycentricY(tri, wx, wy, -0.025);
        if (ceilY !== null && ceilY >= entityZ + 32 && ceilY < minGroundCeilingY) {
          minGroundCeilingY = ceilY;
        }
      }
    }

    // Pass 2: Evaluate walkable floors strictly below minGroundCeilingY
    for (let i = 0; i < tris.length; i++) {
      const tri = tris[i];
      if (!this.celestialBridgeActive && tri.sourceTag === 'celestial_bridge') continue;
      if (tri.category === 'tree_nonsolid') continue;

      // Track highest sculpted terrain (ground OR steep hillside cliff) at (wx, wy)
      // so buried water sheets poking underneath hillsides/cliffs/tower are strictly discarded
      if (
        tri.sourceTag === 'terrain:ground' &&
        wx >= tri.minX - 0.8 &&
        wx <= tri.maxX + 0.8 &&
        wy >= tri.minZ - 0.8 &&
        wy <= tri.maxZ + 0.8
      ) {
        const dryY = this.barycentricY(tri, wx, wy, -0.03);
        if (dryY !== null && dryY > bestDryGroundAboveWaterY) {
          bestDryGroundAboveWaterY = dryY;
        }
      }

      if (!WALKABLE_CATEGORIES.has(tri.category)) continue;
      if (wx < tri.minX - 0.8 || wx > tri.maxX + 0.8 || wy < tri.minZ - 0.8 || wy > tri.maxZ + 0.8) continue;

      const nyS = tri.nySigned ?? 1;
      if (
        nyS < -0.15 &&
        (tri.sourceTag === 'terrain:ground' || tri.category === 'bridge' || tri.category === 'waterfall_rock')
      ) {
        // Track exposed flipped-winding Soil_03 top-skin triangles (rendered DoubleSide visually)
        // so inverted hill/ridge patches do not drop players through solid-looking ground,
        // while genuine arch/bridge undersides remain ignored whenever upward terrain sits above them.
        if (tri.sourceTag === 'terrain:ground' && tri.ny >= 0.20) {
          const flipHitY = this.barycentricY(tri, wx, wy, -0.03);
          if (flipHitY !== null && (isTopDownQuery || flipHitY <= groundReachY) && flipHitY > bestFlippedGroundY) {
            bestFlippedGroundY = flipHitY;
            bestFlippedGroundTri = tri;
          }
        }
        continue;
      }

      const hitY = this.barycentricY(tri, wx, wy, -0.03);
      if (hitY === null) continue;

      if (tri.sourceTag === 'terrain:ground' && tri.ny >= 0.05 && hitY > maxUpwardGroundY) {
        maxUpwardGroundY = hitY;
      }

      if (tri.category === 'water') {
        if (hitY > bestWaterY) {
          bestWaterY = hitY;
          bestWaterTri = tri;
        }
        continue;
      }

      if (hitY > anyFloorY && (!isTopDownQuery ? hitY < minGroundCeilingY - 6 : true)) {
        anyFloorY = hitY;
        anyFloorTri = tri;
      }

      // Skip nearly vertical ribbon walls for normal floor footing unless nothing else exists,
      // while recording reachable ridge-crest terrain triangles so folded peaks don't drop through.
      if (!isTopDownQuery && tri.ny < 0.05 && tri.sourceTag !== 'node:tower_walkway') {
        if (tri.sourceTag === 'terrain:ground' && hitY <= groundReachY && hitY >= entityZ - 85 && hitY > bestCrestGroundY) {
          bestCrestGroundY = hitY;
          bestCrestGroundTri = tri;
        }
        continue;
      }

      const isMultiStoryStructure = tri.category === 'tower_ledge' || tri.category === 'ship_walkable';
      if (isMultiStoryStructure) {
        if (hitY <= structureReachY && hitY > bestSolidY) {
          bestSolidY = hitY;
          bestSolidTri = tri;
        }
        continue;
      }

      if (tri.sourceTag === 'terrain:base_floor') {
        if (hitY < minGroundCeilingY - 6 && hitY > bestBaseFloorY) {
          bestBaseFloorY = hitY;
          bestBaseFloorTri = tri;
        }
        continue;
      }

      // Natural ground, sculpted bridges, and rocks: ignore surfaces overhead above an arch/bridge ceiling,
      // while recording reachable local ground in case minGroundCeilingY is a local fold with no tunnel floor below.
      if (!isTopDownQuery && hitY >= minGroundCeilingY - 6) {
        if (hitY <= groundReachY && hitY >= entityZ - 120 && hitY > bestIgnoredAboveCeilingY) {
          bestIgnoredAboveCeilingY = hitY;
          bestIgnoredAboveCeilingTri = tri;
        }
        continue;
      }

      if (isTopDownQuery || hitY <= groundReachY) {
        if (hitY > bestSolidY) {
          bestSolidY = hitY;
          bestSolidTri = tri;
        }
      } else if (hitY > bestHighGroundY) {
        bestHighGroundY = hitY;
        bestHighGroundTri = tri;
      }
    }

    // Discard buried water triangles inside closed mountains/hills (no overhead open arch ceiling).
    // Open river water flowing underneath tall rock bridges/arches remains 100% traversable.
    let buriedWaterSurfaceY = -Infinity;
    if (bestWaterTri) {
      const waterOver = this.analyzeTerrainOverhead(wx, wy, bestWaterY, 88, 8);
      if (waterOver.insideClosedHill || waterOver.headroomBlocked) {
        buriedWaterSurfaceY = bestWaterY;
        bestWaterTri = null;
        bestWaterY = -Infinity;
      }
    }

    // Promote exposed flipped-winding Soil_03 top surfaces (no upward terrain layer overhead)
    // so inverted-normal hills/ridges hold solid instead of dropping players into cavities below.
    if (
      bestFlippedGroundTri &&
      bestFlippedGroundY >= maxUpwardGroundY - 8 &&
      (!bestSolidTri || bestFlippedGroundY > bestSolidY)
    ) {
      bestSolidY = bestFlippedGroundY;
      bestSolidTri = bestFlippedGroundTri;
    }

    // Merge buried flat base_floor with reachable sculpted ground (higher visible floor wins)
    if (bestBaseFloorTri && (!bestSolidTri || bestBaseFloorY > bestSolidY)) {
      bestSolidY = bestBaseFloorY;
      bestSolidTri = bestBaseFloorTri;
    }

    // If a local mesh crease/bridge-lip triggered minGroundCeilingY yet there is NO real tunnel floor within 260u below,
    // restore the reachable ground/bridge deck so entities on top never fall through a hole.
    if (!isTopDownQuery && bestIgnoredAboveCeilingTri) {
      const hasRealTunnelFloorBelow =
        (bestSolidTri !== null &&
          bestSolidTri.sourceTag !== 'terrain:base_floor' &&
          bestSolidY >= entityZ - 260) ||
        (bestWaterTri !== null && bestWaterY >= entityZ - 260);
      if (!hasRealTunnelFloorBelow && (!bestSolidTri || bestIgnoredAboveCeilingY > bestSolidY)) {
        bestSolidY = bestIgnoredAboveCeilingY;
        bestSolidTri = bestIgnoredAboveCeilingTri;
      }
    }

    // Only allow high-ground fallback on explicit top-down queries; never wall-teleport grounded entities up cliffs
    if (isTopDownQuery && bestHighGroundTri && (!bestSolidTri || bestHighGroundY > bestSolidY)) {
      bestSolidY = bestHighGroundY;
      bestSolidTri = bestHighGroundTri;
    }

    // Micro-seam fallback for all walkable solid surfaces across nearby buckets
    if (!bestSolidTri || (bestWaterTri && bestSolidY < bestWaterY - 3.0)) {
      const scanDelta = bestSolidTri && bestWaterTri ? 0 : 1;
      for (let dr = -scanDelta; dr <= scanDelta; dr++) {
        const rr = row + dr;
        if (rr < 0 || rr >= this.rows) continue;
        for (let dc = -scanDelta; dc <= scanDelta; dc++) {
          const cc = col + dc;
          if (cc < 0 || cc >= this.cols) continue;
          const nTris = this.buckets[rr * this.cols + cc];
          for (let i = 0; i < nTris.length; i++) {
            const tri = nTris[i];
            if (!this.celestialBridgeActive && tri.sourceTag === 'celestial_bridge') continue;
            if (tri.category === 'tree_nonsolid' || tri.category === 'water') continue;
            if (!WALKABLE_CATEGORIES.has(tri.category)) continue;
            const nyS = tri.nySigned ?? 1;
            if (
              nyS < -0.15 &&
              (tri.sourceTag === 'terrain:ground' || tri.category === 'bridge' || tri.category === 'waterfall_rock')
            ) {
              continue;
            }
            const isMultiStoryStructure = tri.category === 'tower_ledge' || tri.category === 'ship_walkable';
            if (isMultiStoryStructure && tri.minY > structureReachY) continue;
            for (let k = 0; k < SEAM_OFFSETS.length; k++) {
              const sx = wx + SEAM_OFFSETS[k][0];
              const sz = wy + SEAM_OFFSETS[k][1];
              if (sx < tri.minX - 0.8 || sx > tri.maxX + 0.8 || sz < tri.minZ - 0.8 || sz > tri.maxZ + 0.8) continue;
              const hitY = this.barycentricY(tri, sx, sz, -0.03);
              if (hitY === null) continue;
              if (
                tri.sourceTag === 'terrain:ground' &&
                minGroundCeilingY === Infinity &&
                (tri.nySigned ?? 1) >= -0.05 &&
                hitY > bestDryGroundAboveWaterY &&
                hitY > bestWaterY + 48
              ) {
                bestDryGroundAboveWaterY = hitY;
              }
              if (hitY > anyFloorY && (!isTopDownQuery ? hitY < minGroundCeilingY - 6 : true)) {
                anyFloorY = hitY;
                anyFloorTri = tri;
              }
              if (isMultiStoryStructure) {
                if (hitY <= structureReachY && hitY > bestSolidY) {
                  bestSolidY = hitY;
                  bestSolidTri = tri;
                }
              } else if (isTopDownQuery || (hitY < minGroundCeilingY - 6 && hitY <= groundReachY)) {
                if (hitY > bestSolidY) {
                  bestSolidY = hitY;
                  bestSolidTri = tri;
                }
              }
            }
          }
        }
      }
    }

    // Tower outer-lip capsule footing retention: when standing on or stepping across an elevated tower step
    // and the single-point ray slips off the narrow outer bevel onto ground far below, probe within the
    // player's 30u foot footprint (10u and 18u rings) for valid nearby tower_ledge footing at step height.
    if (
      !isTopDownQuery &&
      this.hasTowerMesh &&
      entityZ >= this.towerMinY - 40 &&
      (!bestSolidTri || (bestSolidTri.category !== 'tower_ledge' && bestSolidY < entityZ - stepUpLimit - 12)) &&
      Math.hypot(wx - this.towerCenterX, wy - this.towerCenterZ) <= this.towerOuterMaxR + 180
    ) {
      let lipBestY = -Infinity;
      let lipBestTri: ColliderTri | null = null;
      for (let k = 0; k < LIP_OFFSETS.length; k++) {
        const sx = wx + LIP_OFFSETS[k][0];
        const sz = wy + LIP_OFFSETS[k][1];
        const sCol = Math.max(0, Math.min(this.cols - 1, Math.floor(sx / this.cellSize)));
        const sRow = Math.max(0, Math.min(this.rows - 1, Math.floor(sz / this.cellSize)));
        const nTris = this.buckets[sRow * this.cols + sCol];
        for (let i = 0; i < nTris.length; i++) {
          const tri = nTris[i];
          if (tri.category !== 'tower_ledge') continue;
          if ((tri.nySigned ?? 1) < 0.05 && tri.sourceTag !== 'node:tower_walkway') continue;
          if (sx < tri.minX - 0.8 || sx > tri.maxX + 0.8 || sz < tri.minZ - 0.8 || sz > tri.maxZ + 0.8) continue;
          const hitY = this.barycentricY(tri, sx, sz, -0.03);
          if (
            hitY !== null &&
            hitY >= entityZ - stepUpLimit - 12 &&
            hitY <= structureReachY &&
            hitY > lipBestY
          ) {
            lipBestY = hitY;
            lipBestTri = tri;
          }
        }
        // Prefer inner 10u ring match before expanding to 18u ring
        if (k === 7 && lipBestTri) break;
      }
      if (lipBestTri) {
        bestSolidY = lipBestY;
        bestSolidTri = lipBestTri;
      }
    }

    // If a closed hill/cliff rises strictly overhead above buried water, also reject the hollow submerged riverbed below it
    if (
      !isTopDownQuery &&
      buriedWaterSurfaceY > -Infinity &&
      minGroundCeilingY === Infinity &&
      bestDryGroundAboveWaterY > buriedWaterSurfaceY + 48
    ) {
      if (bestSolidTri && bestSolidY < buriedWaterSurfaceY + 4) {
        bestSolidTri = null;
        bestSolidY = -Infinity;
      }
      if (anyFloorTri && anyFloorY < buriedWaterSurfaceY + 4) {
        anyFloorTri = null;
        anyFloorY = -Infinity;
      }
    }

    // Crest fallback: if a sharp terrain ridge crest was skipped by the near-vertical filter, keep it solid
    if (!isTopDownQuery && bestCrestGroundTri && (!bestSolidTri || bestCrestGroundY - bestSolidY > 120)) {
      bestSolidY = bestCrestGroundY;
      bestSolidTri = bestCrestGroundTri;
    }

    // Check water interaction:
    // Sub-mountain cavity guard: if a folded upper Soil_03 hill/ridge rises above reach AND there is NO open
    // arch ceiling overhead AND the only floor below reach sits inside a hollow cavity (< entityZ - 90),
    // return the upper hill surface so horizontal checks block/slide cleanly instead of dropping into the cavity.
    if (
      !isTopDownQuery &&
      minGroundCeilingY === Infinity &&
      bestHighGroundTri &&
      bestHighGroundTri.sourceTag === 'terrain:ground' &&
      ((!bestSolidTri && !bestWaterTri) ||
        (bestSolidTri !== null &&
          bestSolidTri.sourceTag === 'terrain:ground' &&
          bestSolidY < entityZ - 90 &&
          bestHighGroundY - bestSolidY > 120) ||
        (!bestSolidTri &&
          bestWaterTri !== null &&
          bestWaterY < entityZ - 90 &&
          bestHighGroundY - bestWaterY > 120))
    ) {
      return {
        hit: true,
        height: bestHighGroundY,
        category: bestHighGroundTri.category,
        isWalkable: true,
        isInWater: false,
        normalY: bestHighGroundTri.ny,
        sourceTag: bestHighGroundTri.sourceTag
      };
    }

    // If standing on a solid bridge/rock/ship/ground higher than or level with water, NOT in water.
    if (bestSolidTri && (!bestWaterTri || bestSolidY >= bestWaterY - 3.0)) {
      return {
        hit: true,
        height: bestSolidY,
        category: bestSolidTri.category,
        isWalkable: true,
        isInWater: false,
        normalY: bestSolidTri.ny,
        sourceTag: bestSolidTri.sourceTag
      };
    }

    if (bestWaterTri) {
      const isWaterfallTri = bestWaterTri.sourceTag === 'node:waterfall_water';
      const isOpenWater =
        isWaterfallTri ||
        !this.waterFreezeProfile ||
        isPointInOpenWater(wx, wy, this.waterFreezeProfile);

      if (!isOpenWater) {
        return {
          hit: true,
          height: bestWaterY,
          category: 'ground',
          isWalkable: true,
          isInWater: false,
          normalY: bestWaterTri.ny,
          sourceTag: 'water:frozen_ice'
        };
      }

      // Submerged bed depth cap so characters wade naturally in water rather than sinking out of sight
      const wadeFloor = bestSolidTri && bestWaterY - bestSolidY <= 18
        ? Math.max(bestSolidY, bestWaterY - 8)
        : bestWaterY - 6;
      const isInWater = entityZ <= bestWaterY + 10;
      return {
        hit: true,
        height: wadeFloor,
        category: 'water',
        isWalkable: true,
        isInWater,
        normalY: bestWaterTri.ny,
        sourceTag: bestWaterTri.sourceTag
      };
    }

    if (anyFloorTri) {
      return {
        hit: true,
        height: anyFloorY,
        category: anyFloorTri.category,
        isWalkable: true,
        isInWater: false,
        normalY: anyFloorTri.ny,
        sourceTag: anyFloorTri.sourceTag
      };
    }

    return {
      hit: false,
      height: 0,
      category: 'border',
      isWalkable: false,
      isInWater: false,
      normalY: 1,
      sourceTag: 'none'
    };
  }

  /**
   * Fast single-bucket terrain height lookup for purely visual effects (VFX decals, shadows, laser rays).
   * Bypasses overhead arch analysis, 72-probe micro-seams, and lip retention while matching ground/bridge/water elevation.
   */
  public queryFastGroundHeight(wx: number, wy: number, refY?: number, stepUpLimit: number = 56): number {
    if (!Number.isFinite(wx) || !Number.isFinite(wy)) return 0;
    const col = Math.max(0, Math.min(this.cols - 1, Math.floor(wx / this.cellSize)));
    const row = Math.max(0, Math.min(this.rows - 1, Math.floor(wy / this.cellSize)));
    const tris = this.buckets[row * this.cols + col];

    const isTopDown = refY === undefined || !Number.isFinite(refY) || refY >= 1e5;
    const reachY = isTopDown ? Infinity : (refY as number) + Math.max(stepUpLimit, 56);

    let bestSolidY = -Infinity;
    let bestHighY = -Infinity;
    let bestWaterY = -Infinity;

    for (let i = 0; i < tris.length; i++) {
      const tri = tris[i];
      if (!this.celestialBridgeActive && tri.sourceTag === 'celestial_bridge') continue;
      if (tri.category === 'tree_nonsolid') continue;
      if (!WALKABLE_CATEGORIES.has(tri.category)) continue;
      if (wx < tri.minX - 0.8 || wx > tri.maxX + 0.8 || wy < tri.minZ - 0.8 || wy > tri.maxZ + 0.8) continue;

      const nyS = tri.nySigned ?? 1;
      if (
        nyS < -0.15 &&
        !(tri.sourceTag === 'terrain:ground' && tri.ny >= 0.20)
      ) {
        continue;
      }

      const hitY = this.barycentricY(tri, wx, wy, -0.03);
      if (hitY === null) continue;

      if (tri.category === 'water') {
        if (hitY > bestWaterY) bestWaterY = hitY;
        continue;
      }

      if (hitY <= reachY) {
        if (hitY > bestSolidY) bestSolidY = hitY;
      } else if (hitY > bestHighY) {
        bestHighY = hitY;
      }
    }

    if (bestSolidY > -Infinity) {
      if (bestWaterY > -Infinity && bestWaterY > bestSolidY + 3.0) {
        return bestWaterY - 4;
      }
      return bestSolidY;
    }
    if (bestWaterY > -Infinity) return bestWaterY - 4;
    if (bestHighY > -Infinity) return bestHighY;
    return refY !== undefined && Number.isFinite(refY) && refY < 1e5 ? refY : 0;
  }

  private hasGroundCeilingNearby(wx: number, wy: number, entityZ: number, maxHeight: number): boolean {
    for (let k = 0; k < CEILING_OFFSETS.length; k++) {
      const sx = wx + CEILING_OFFSETS[k][0];
      const sz = wy + CEILING_OFFSETS[k][1];
      const col = Math.max(0, Math.min(this.cols - 1, Math.floor(sx / this.cellSize)));
      const row = Math.max(0, Math.min(this.rows - 1, Math.floor(sz / this.cellSize)));
      const tris = this.buckets[row * this.cols + col];
      for (let i = 0; i < tris.length; i++) {
        const tri = tris[i];
        if (!this.celestialBridgeActive && tri.sourceTag === 'celestial_bridge') continue;
        if (
          (tri.nySigned ?? 1) >= -0.15 ||
          (tri.sourceTag !== 'terrain:ground' && tri.category !== 'bridge' && tri.category !== 'waterfall_rock')
        ) {
          continue;
        }
        if (tri.maxY < entityZ + 44 || tri.minY > maxHeight) continue;
        if (sx < tri.minX - 0.8 || sx > tri.maxX + 0.8 || sz < tri.minZ - 0.8 || sz > tri.maxZ + 0.8) continue;
        const cy = this.barycentricY(tri, sx, sz, -0.02);
        if (cy !== null && cy >= entityZ + 44 && cy <= maxHeight) {
          return true;
        }
      }
    }
    return false;
  }

  /**
   * Returns the lowest downward-facing solid ceiling above footZ at (wx, wy), or Infinity if open sky.
   */
  public queryCeiling(wx: number, wy: number, footZ: number): number {
    if (!Number.isFinite(wx) || !Number.isFinite(wy) || !Number.isFinite(footZ)) {
      return Infinity;
    }
    const col = Math.max(0, Math.min(this.cols - 1, Math.floor(wx / this.cellSize)));
    const row = Math.max(0, Math.min(this.rows - 1, Math.floor(wy / this.cellSize)));
    const tris = this.buckets[row * this.cols + col];

    const distFromTower = this.hasTowerMesh ? Math.hypot(wx - this.towerCenterX, wy - this.towerCenterZ) : Infinity;

    let minCeilY = Infinity;
    for (let i = 0; i < tris.length; i++) {
      const tri = tris[i];
      if (!this.celestialBridgeActive && tri.sourceTag === 'celestial_bridge') continue;
      if (tri.category === 'tower_ledge') continue;
      if (
        tri.sourceTag !== 'terrain:ground' &&
        tri.category !== 'bridge' &&
        tri.category !== 'waterfall_rock' &&
        tri.sourceTag !== 'node:first_artifact_tower' &&
        tri.sourceTag !== 'node:ship'
      ) {
        continue;
      }
      if (
        tri.sourceTag === 'node:first_artifact_tower' &&
        distFromTower >= 420 &&
        tri.maxY > this.towerBottomCapMaxY
      ) {
        continue;
      }
      if ((tri.nySigned ?? 1) >= -0.05) continue;
      if (tri.maxY < footZ + 20) continue;
      if (wx < tri.minX - 1.0 || wx > tri.maxX + 1.0 || wy < tri.minZ - 1.0 || wy > tri.maxZ + 1.0) continue;
      const hitY = this.barycentricY(tri, wx, wy, -0.025);
      if (hitY !== null && hitY >= footZ + 20 && hitY < minCeilY) {
        minCeilY = hitY;
      }
    }
    return minCeilY;
  }

  private hasNearbyOverheadArchCeiling(
    wx: number,
    wy: number,
    minCeilingY: number,
    maxCeilingY: number,
    searchRadius: number = 96
  ): boolean {
    const c0 = Math.max(0, Math.min(this.cols - 1, Math.floor((wx - searchRadius) / this.cellSize)));
    const c1 = Math.max(0, Math.min(this.cols - 1, Math.floor((wx + searchRadius) / this.cellSize)));
    const r0 = Math.max(0, Math.min(this.rows - 1, Math.floor((wy - searchRadius) / this.cellSize)));
    const r1 = Math.max(0, Math.min(this.rows - 1, Math.floor((wy + searchRadius) / this.cellSize)));
    const rSq = searchRadius * searchRadius;

    for (let r = r0; r <= r1; r++) {
      const rowOff = r * this.cols;
      for (let c = c0; c <= c1; c++) {
        const tris = this.buckets[rowOff + c];
        for (let i = 0; i < tris.length; i++) {
          const tri = tris[i];
          if (!this.celestialBridgeActive && tri.sourceTag === 'celestial_bridge') continue;
          if ((tri.nySigned ?? 1) >= -0.05) continue;
          if (
            tri.sourceTag !== 'terrain:ground' &&
            tri.category !== 'bridge' &&
            tri.category !== 'waterfall_rock'
          ) {
            continue;
          }
          if (tri.maxY < minCeilingY || tri.minY > maxCeilingY) continue;
          if (
            wx + searchRadius < tri.minX ||
            wx - searchRadius > tri.maxX ||
            wy + searchRadius < tri.minZ ||
            wy - searchRadius > tri.maxZ
          ) {
            continue;
          }
          const cx = (tri.ax + tri.bx + tri.cx) / 3;
          const cy = (tri.ay + tri.by + tri.cy) / 3;
          const cz = (tri.az + tri.bz + tri.cz) / 3;
          const dMin = Math.min(
            (tri.ax - wx) * (tri.ax - wx) + (tri.az - wy) * (tri.az - wy),
            (tri.bx - wx) * (tri.bx - wx) + (tri.bz - wy) * (tri.bz - wy),
            (tri.cx - wx) * (tri.cx - wx) + (tri.cz - wy) * (tri.cz - wy),
            (cx - wx) * (cx - wx) + (cz - wy) * (cz - wy)
          );
          if (dMin <= rSq && cy >= minCeilingY && cy <= maxCeilingY) {
            return true;
          }
        }
      }
    }
    return false;
  }

  private analyzeTerrainOverhead(
    wx: number,
    wy: number,
    floorZ: number,
    entityHeight: number,
    minUpOffset: number = 45
  ): {
    hasOpenArch: boolean;
    headroomBlocked: boolean;
    insideClosedHill: boolean;
    downCeilY: number;
    upAboveY: number;
  } {
    const col = Math.max(0, Math.min(this.cols - 1, Math.floor(wx / this.cellSize)));
    const row = Math.max(0, Math.min(this.rows - 1, Math.floor(wy / this.cellSize)));
    const tris = this.buckets[row * this.cols + col];

    let minDownCeilY = Infinity;
    let minUpAboveY = Infinity;
    for (let i = 0; i < tris.length; i++) {
      const tri = tris[i];
      if (!this.celestialBridgeActive && tri.sourceTag === 'celestial_bridge') continue;
      if (
        tri.sourceTag !== 'terrain:ground' &&
        tri.category !== 'bridge' &&
        tri.category !== 'waterfall_rock'
      ) {
        continue;
      }
      if (wx < tri.minX - 1.0 || wx > tri.maxX + 1.0 || wy < tri.minZ - 1.0 || wy > tri.maxZ + 1.0) continue;
      const nyS = tri.nySigned ?? 1;
      if (nyS < -0.05) {
        if (tri.maxY <= floorZ + 4) continue;
        const hitY = this.barycentricY(tri, wx, wy, -0.025);
        if (hitY !== null && hitY > floorZ + 4 && hitY < minDownCeilY) {
          minDownCeilY = hitY;
        }
      } else {
        if (tri.maxY <= floorZ + minUpOffset) continue;
        const hitY = this.barycentricY(tri, wx, wy, -0.025);
        if (hitY !== null && hitY > floorZ + minUpOffset && hitY < minUpAboveY) {
          minUpAboveY = hitY;
        }
      }
    }

    // Any downward-facing ceiling above entityHeight headroom forms a valid open arch/bridge,
    // including high arch bevels where upper surface bevel triangles slightly overlap the underside.
    // Also treat upper overhang lips within 96u horizontally of a downward arch ceiling as open air.
    const headroomClear = minDownCeilY < Infinity && minDownCeilY >= floorZ + entityHeight;
    const isDirectArch = headroomClear && minDownCeilY <= minUpAboveY + 24;
    const isArchOverhangLip =
      minDownCeilY === Infinity &&
      minUpAboveY < Infinity &&
      minUpAboveY >= floorZ + entityHeight &&
      this.hasNearbyOverheadArchCeiling(wx, wy, floorZ + entityHeight, minUpAboveY + 120, 96);

    const hasOpenArch = isDirectArch || isArchOverhangLip;
    const headroomBlocked = minDownCeilY < Infinity && minDownCeilY < floorZ + entityHeight;
    const insideClosedHill = !hasOpenArch && minUpAboveY < Infinity && minUpAboveY > floorZ + minUpOffset;
    return {
      hasOpenArch,
      headroomBlocked,
      insideClosedHill,
      downCeilY: minDownCeilY,
      upAboveY: minUpAboveY
    };
  }

  public isPositionOutsideHollowInterior(
    wx: number,
    wy: number,
    entityZ: number,
    clearance: number = 16,
    entityHeight: number = 90
  ): boolean {
    return !this.hasSolidInteriorCover(wx, wy, entityZ, clearance, entityHeight);
  }

  /**
   * Checks whether point (wx, wy) at height entityZ sits inside the hollow First Artifact Tower shaft
   * (strictly inside the solid concrete core radius or directly under the Summit cap
   * with no walkable exterior stair/ledge support at entityZ), underneath a closed hillside skin,
   * or under a rock pinch with less vertical clearance than entityHeight.
   * Tall bridges, arches, and hanging rocks with >= entityHeight headroom remain 100% passable.
   */
  private hasSolidInteriorCover(
    wx: number,
    wy: number,
    entityZ: number,
    clearance: number = 16,
    entityHeight: number = 90
  ): boolean {
    const col = Math.max(0, Math.min(this.cols - 1, Math.floor(wx / this.cellSize)));
    const row = Math.max(0, Math.min(this.rows - 1, Math.floor(wy / this.cellSize)));
    const tris = this.buckets[row * this.cols + col];

    // 1. Tower hollow interior & Summit underside shaft protection (strictly within the core cylinder)
    if (this.hasTowerMesh) {
      const r = Math.hypot(wx - this.towerCenterX, wy - this.towerCenterZ);
      if (r <= this.towerOuterMaxR) {
        const sIdx = Math.max(
          0,
          Math.min(
            this.towerCoreRadiusSlices.length - 1,
            Math.floor((entityZ - this.towerMinY) / this.towerSliceHeight)
          )
        );
        const coreR = this.towerCoreRadiusSlices[sIdx] ?? 0;
        // Seal the entire concrete core cylinder at each elevation up to the inner spiral stair margin,
        // preventing entry into both the central chimney and any lower annular foundation cavities.
        const innerCoreLimit = coreR > 0 ? Math.max(0, coreR - 6) : 340;
        const shaftRoofMaxR = entityZ >= this.towerMaxY - 280 ? Math.max(innerCoreLimit, 410) : innerCoreLimit;

        let hasOverheadTowerRoof = false;
        let hasReachableLocalWalkway = false;

        for (let i = 0; i < tris.length; i++) {
          const tri = tris[i];
          if (tri.sourceTag !== 'node:first_artifact_tower' && tri.sourceTag !== 'node:tower_walkway') continue;
          if (wx < tri.minX - 1.5 || wx > tri.maxX + 1.5 || wy < tri.minZ - 1.5 || wy > tri.maxZ + 1.5) continue;
          const hitY = this.barycentricY(tri, wx, wy, -0.025);
          if (hitY === null) continue;

          if (
            tri.category === 'tower_ledge' &&
            ((tri.nySigned ?? 1) > 0.05 || tri.sourceTag === 'node:tower_walkway') &&
            hitY >= entityZ - 150 &&
            hitY <= entityZ + 62
          ) {
            hasReachableLocalWalkway = true;
          }

          if (
            r <= shaftRoofMaxR &&
            tri.sourceTag === 'node:first_artifact_tower' &&
            (tri.ny >= 0.35 || (tri.nySigned ?? 1) < -0.5) &&
            hitY >= entityZ + clearance + 28
          ) {
            hasOverheadTowerRoof = true;
          }
        }

        // Directly underneath the Summit deck / Tower shaft roof inside the hollow shaft -> blocked!
        if (hasOverheadTowerRoof && !hasReachableLocalWalkway) {
          return true;
        }

        // Inside the solid concrete Tower core cylinder below the Summit with no walkway tread -> hollow core!
        if (entityZ < this.towerMaxY - 110 && !hasReachableLocalWalkway) {
          if (coreR > 0 && r < innerCoreLimit) {
            return true;
          }
        }
      }
    }

    // 2. Allow passing underneath bridges, rock arches, and tall hanging rocks when headroom >= entityHeight,
    // while blocking low rock pinches (< entityHeight) and closed hollow hillside skins.
    for (let i = 0; i < tris.length; i++) {
      const tri = tris[i];
      if (tri.category !== 'bridge' && tri.category !== 'waterfall_rock') continue;
      if (wx < tri.minX - 1.0 || wx > tri.maxX + 1.0 || wy < tri.minZ - 1.0 || wy > tri.maxZ + 1.0) continue;
      const hitY = this.barycentricY(tri, wx, wy, -0.025);
      if (hitY !== null && Math.abs(hitY - entityZ) <= 55) {
        return false;
      }
    }

    const charHeight = Math.max(entityHeight, 88);
    const over = this.analyzeTerrainOverhead(wx, wy, entityZ, charHeight, 45);
    if (over.headroomBlocked) {
      return true;
    }
    if (over.hasOpenArch) {
      return false;
    }
    if (over.insideClosedHill && over.upAboveY >= entityZ + 45) {
      return true;
    }

    return false;
  }

  private recordRejectedMove(fromPos: Vector2, toPos: Vector2, entityZ: number, reason: string): void {
    const last = this.recentRejectedMoves[this.recentRejectedMoves.length - 1];
    if (last && Math.hypot(last.toX - toPos.x, last.toY - toPos.y) < 4 && last.reason === reason) {
      return;
    }
    this.recentRejectedMoves.push({
      fromX: fromPos.x,
      fromY: fromPos.y,
      toX: toPos.x,
      toY: toPos.y,
      z: entityZ,
      reason
    });
    if (this.recentRejectedMoves.length > 32) {
      this.recentRejectedMoves.shift();
    }
  }

  /**
   * True 3D horizontal movement & wall collision check against steep cliffs,
   * solid crystals, border mountains, tower walls, waterfall rock sides, and ship walls.
   */
  public checkHorizontalMove(
    fromPos: Vector2,
    toPos: Vector2,
    entityZ: number,
    radius: number,
    entityHeight: number = 46,
    stepUpLimit: number = 20,
    isAirborne: boolean = false
  ): HorizontalMoveResult {
    const stepDx = toPos.x - fromPos.x;
    const stepDy = toPos.y - fromPos.y;
    const totalDist = Math.hypot(stepDx, stepDy);
    // Sweep fast steps / dashes into <= 8u substeps so entities cannot tunnel through thin wall faces
    if (totalDist > 8) {
      const subSteps = Math.min(16, Math.ceil(totalDist / 8));
      let curFrom = { x: fromPos.x, y: fromPos.y };
      for (let s = 1; s <= subSteps; s++) {
        const t = s / subSteps;
        const subTo = { x: fromPos.x + stepDx * t, y: fromPos.y + stepDy * t };
        const subRes = this.checkSingleHorizontalStep(
          curFrom,
          subTo,
          entityZ,
          radius,
          entityHeight,
          stepUpLimit,
          isAirborne
        );
        if (!subRes.allowed) {
          if (radius >= 20) {
            this.recordRejectedMove(curFrom, subTo, entityZ, subRes.reason || 'blocked');
          }
          return {
            allowed: false,
            newPos: s === 1 ? subRes.newPos : curFrom,
            surfaceNormal: subRes.surfaceNormal,
            reason: subRes.reason
          };
        }
        curFrom = subTo;
      }
      return { allowed: true, newPos: { x: toPos.x, y: toPos.y }, surfaceNormal: { x: 0, y: 0 } };
    }

    const res = this.checkSingleHorizontalStep(fromPos, toPos, entityZ, radius, entityHeight, stepUpLimit, isAirborne);
    if (!res.allowed && radius >= 20) {
      this.recordRejectedMove(fromPos, toPos, entityZ, res.reason || 'blocked');
    }
    return res;
  }

  private checkSingleHorizontalStep(
    fromPos: Vector2,
    toPos: Vector2,
    entityZ: number,
    radius: number,
    entityHeight: number,
    stepUpLimit: number,
    isAirborne: boolean
  ): HorizontalMoveResult {
    if (
      toPos.x < this.playableBounds.minX ||
      toPos.x > this.playableBounds.maxX ||
      toPos.y < this.playableBounds.minY ||
      toPos.y > this.playableBounds.maxY
    ) {
      const clampedX = Math.max(this.playableBounds.minX, Math.min(this.playableBounds.maxX, toPos.x));
      const clampedY = Math.max(this.playableBounds.minY, Math.min(this.playableBounds.maxY, toPos.y));
      const nx = toPos.x < this.playableBounds.minX ? 1 : toPos.x > this.playableBounds.maxX ? -1 : 0;
      const ny = toPos.y < this.playableBounds.minY ? 1 : toPos.y > this.playableBounds.maxY ? -1 : 0;
      return { allowed: false, newPos: { x: clampedX, y: clampedY }, surfaceNormal: { x: nx, y: ny }, reason: 'playable_bounds' };
    }

    const rPad = radius + 4;
    const c0 = Math.max(0, Math.min(this.cols - 1, Math.floor((toPos.x - rPad) / this.cellSize)));
    const c1 = Math.max(0, Math.min(this.cols - 1, Math.floor((toPos.x + rPad) / this.cellSize)));
    const r0 = Math.max(0, Math.min(this.rows - 1, Math.floor((toPos.y - rPad) / this.cellSize)));
    const r1 = Math.max(0, Math.min(this.rows - 1, Math.floor((toPos.y + rPad) / this.cellSize)));

    const support = this.querySupport(toPos.x, toPos.y, entityZ, stepUpLimit);
    if (!support.hit || support.height > entityZ + Math.max(stepUpLimit, 56)) {
      const dx = fromPos.x - toPos.x;
      const dy = fromPos.y - toPos.y;
      const dLen = Math.hypot(dx, dy) || 1;
      return {
        allowed: false,
        newPos: { x: fromPos.x, y: fromPos.y },
        surfaceNormal: { x: dx / dLen, y: dy / dLen },
        reason: !support.hit ? 'no_support' : 'step_too_high'
      };
    }
    const fromSupport = this.querySupport(fromPos.x, fromPos.y, entityZ, stepUpLimit);
    const effectiveFromZ = fromSupport.hit ? Math.max(entityZ, Math.min(fromSupport.height, entityZ + stepUpLimit)) : entityZ;
    const effectiveFootZ = Math.max(entityZ, Math.min(support.height, entityZ + stepUpLimit));
    const onTowerWalkway =
      support.category === 'tower_ledge' ||
      (fromSupport.hit && fromSupport.category === 'tower_ledge') ||
      (isAirborne &&
        this.hasTowerMesh &&
        entityZ >= this.towerMinY + 60 &&
        Math.hypot(toPos.x - this.towerCenterX, toPos.y - this.towerCenterZ) <= this.towerOuterMaxR + 60);
    const towerSliceIdx = this.hasTowerMesh
      ? Math.max(0, Math.min(this.towerCoreRadiusSlices.length - 1, Math.floor((effectiveFootZ - this.towerMinY) / this.towerSliceHeight)))
      : 0;
    const walkwayCoreR = this.hasTowerMesh ? (this.towerCoreRadiusSlices[towerSliceIdx] ?? 0) : 0;

    // Prevent entering hollow interior space underneath tower deck/core, folded hillside skins,
    // or low rock pinches shorter than the character's solid body height (evaluated at destination footZ so
    // climbing up onto an arch deck never false-blocks on the arch underside just beneath effectiveFootZ).
    const interiorClearance = isAirborne ? 12 : 16;
    const fromInsideCover = this.hasSolidInteriorCover(fromPos.x, fromPos.y, effectiveFromZ, interiorClearance, entityHeight);
    const toInsideCover = this.hasSolidInteriorCover(toPos.x, toPos.y, effectiveFootZ, interiorClearance, entityHeight);
    if (toInsideCover) {
      const movingIntoTowerCore =
        this.hasTowerMesh &&
        Math.hypot(toPos.x - this.towerCenterX, toPos.y - this.towerCenterZ) <
        Math.hypot(fromPos.x - this.towerCenterX, fromPos.y - this.towerCenterZ) - 0.25;
      if (!fromInsideCover || movingIntoTowerCore) {
        const dx = fromPos.x - toPos.x;
        const dy = fromPos.y - toPos.y;
        const dLen = Math.hypot(dx, dy) || 1;
        return {
          allowed: false,
          newPos: { x: fromPos.x, y: fromPos.y },
          surfaceNormal: { x: dx / dLen, y: dy / dLen },
          reason: 'interior_cover'
        };
      }
    }

    // Analytical radial tower-core seal below the summit deck so hollow cavities inside the core cylinder remain unreachable
    if (this.hasTowerMesh && effectiveFootZ < this.towerMaxY - 190 && walkwayCoreR > 0) {
      const minCoreClearR = Math.max(290, walkwayCoreR - 4) + Math.min(18, radius * 0.45);
      const fromDist = Math.hypot(fromPos.x - this.towerCenterX, fromPos.y - this.towerCenterZ);
      const toDist = Math.hypot(toPos.x - this.towerCenterX, toPos.y - this.towerCenterZ);
      if (toDist < minCoreClearR && (toDist < fromDist - 0.1 || fromDist >= minCoreClearR)) {
        const outLen = toDist > 1e-4 ? toDist : 1;
        return {
          allowed: false,
          newPos: { x: fromPos.x, y: fromPos.y },
          surfaceNormal: {
            x: (toPos.x - this.towerCenterX) / outLen,
            y: (toPos.y - this.towerCenterZ) / outLen
          },
          reason: 'tower_core_seal'
        };
      }
    }

    // Allow stepping over curbs/ledges/steps up to step clearance while still catching tall solid walls
    const bodyBottom = effectiveFootZ + 36;
    const bodyTop = effectiveFootZ + Math.max(entityHeight, 88);

    let blocked = false;
    let bestPen = 0;
    let bestNx = 0;
    let bestNz = 0;
    let bestReason = 'wall_triangle';

    this.visitedTriSet.clear();

    for (let r = r0; r <= r1; r++) {
      const rowOff = r * this.cols;
      for (let c = c0; c <= c1; c++) {
        const tris = this.buckets[rowOff + c];
        for (let i = 0; i < tris.length; i++) {
          const tri = tris[i];
          if (this.visitedTriSet.has(tri)) continue;
          this.visitedTriSet.add(tri);

          // Support.height > entityZ + stepUpLimit already prevents stepping up cliffs;
          // open terrain triangles never act as horizontal invisible walls.
          if (!this.celestialBridgeActive && tri.sourceTag === 'celestial_bridge') continue;
          if (!BLOCKING_CATEGORIES.has(tri.category)) continue;
          const isTowerWall = tri.sourceTag === 'node:first_artifact_tower';
          const effectiveRadius = onTowerWalkway && isTowerWall ? Math.min(radius, 18) : radius;
          // Seal lower tower foundation & rock seams right down to ankle height (+12u) so players cannot slip into under-wall cavities
          const triBodyBottom = isTowerWall ? effectiveFootZ + (onTowerWalkway ? 22 : 12) : bodyBottom;
          // Allow walking cleanly underneath raised outer ship overhangs (>52u above feet) while keeping the grounded hull solid
          if (tri.sourceTag === 'node:ship' && tri.minY >= effectiveFootZ + 52) {
            continue;
          }
          // Prevent walking/climbing up into the solid concrete bottom cap of the tower (C663)
          if (
            isTowerWall &&
            (tri.nySigned ?? 1) < -0.5 &&
            tri.maxY <= this.towerBottomCapMaxY &&
            support.hit &&
            support.sourceTag === 'terrain:ground' &&
            effectiveFootZ >= tri.minY - Math.max(entityHeight, 88) &&
            effectiveFootZ <= tri.maxY + 40 &&
            (entityZ + Math.max(entityHeight, 88) < tri.minY || effectiveFootZ > entityZ + 0.5) &&
            toPos.x >= tri.minX - 2 &&
            toPos.x <= tri.maxX + 2 &&
            toPos.y >= tri.minZ - 2 &&
            toPos.y <= tri.maxZ + 2 &&
            this.barycentricY(tri, toPos.x, toPos.y, -0.02) !== null
          ) {
            const dx = fromPos.x - toPos.x;
            const dy = fromPos.y - toPos.y;
            const dLen = Math.hypot(dx, dy) || 1;
            return {
              allowed: false,
              newPos: { x: fromPos.x, y: fromPos.y },
              surfaceNormal: { x: dx / dLen, y: dy / dLen },
              reason: 'tower_bottom_cap'
            };
          }
          if (tri.maxY <= triBodyBottom || tri.minY >= bodyTop) continue;
          // Never allow exterior spiral walkway risers to block climbing the teleporter steps,
          // while keeping solid Concrete tower walls strictly blocking at all heights and outer walls sealed
          if (
            tri.sourceTag === 'node:tower_walkway' &&
            tri.maxY <= Math.max(entityZ, effectiveFootZ) + stepUpLimit
          ) {
            continue;
          }
          if (
            isTowerWall &&
            onTowerWalkway &&
            support.category === 'tower_ledge' &&
            tri.maxY <= Math.max(entityZ, effectiveFootZ) + stepUpLimit + 6
          ) {
            continue;
          }
          if (
            toPos.x + effectiveRadius < tri.minX ||
            toPos.x - effectiveRadius > tri.maxX ||
            toPos.y + effectiveRadius < tri.minZ ||
            toPos.y - effectiveRadius > tri.maxZ
          ) {
            continue;
          }

          const yLo = Math.max(tri.minY, triBodyBottom);
          const yHi = Math.min(tri.maxY, bodyTop);
          const hit = this.triangleHorizontalOverlap(tri, toPos.x, toPos.y, effectiveRadius, yLo, yHi);
          if (hit) {
            const hitPen = hit.pen;
            const hitNx = hit.nx;
            const hitNz = hit.nz;
            // Escape-from-penetration rule: if the entity already touches this face at fromPos and
            // moving to toPos strictly reduces penetration, allow moving away so players never glue in place.
            const fromHit = this.triangleHorizontalOverlap(tri, fromPos.x, fromPos.y, effectiveRadius, yLo, yHi);
            if (fromHit && hitPen < fromHit.pen - 0.05) {
              continue;
            }
            if (hitPen > bestPen) {
              blocked = true;
              bestPen = hitPen;
              bestNx = hitNx;
              bestNz = hitNz;
              bestReason = `wall:${tri.sourceTag}`;
            }
          }
        }
      }
    }

    if (!blocked) {
      if (!support.hit) {
        const dx = fromPos.x - toPos.x;
        const dy = fromPos.y - toPos.y;
        const dLen = Math.hypot(dx, dy) || 1;
        return {
          allowed: false,
          newPos: { x: fromPos.x, y: fromPos.y },
          surfaceNormal: { x: dx / dLen, y: dy / dLen },
          reason: 'no_support'
        };
      }
      return { allowed: true, newPos: { x: toPos.x, y: toPos.y }, surfaceNormal: { x: 0, y: 0 } };
    }

    return {
      allowed: false,
      newPos: { x: fromPos.x, y: fromPos.y },
      surfaceNormal: { x: bestNx, y: bestNz },
      reason: bestReason
    };
  }

  public pushOutOfWalls(
    pos: Vector2,
    entityZ: number,
    radius: number,
    entityHeight: number = 46,
    stepUpLimit: number = 20
  ): void {
    // If entity clipped inside a hollow tower or folded overhang volume, eject cleanly outward
    if (this.hasSolidInteriorCover(pos.x, pos.y, entityZ, 16, entityHeight)) {
      const baseAngle = this.hasTowerMesh
        ? Math.atan2(pos.y - this.towerCenterZ, pos.x - this.towerCenterX)
        : 0;
      const radii = [24, 48, 72, 100, 140, 190, 260, 340, 440];
      let escaped = false;
      for (let ri = 0; ri < radii.length && !escaped; ri++) {
        const rr = radii[ri];
        for (let ai = 0; ai < 16; ai++) {
          const ang = baseAngle + (ai / 16) * Math.PI * 2;
          const tx = pos.x + Math.cos(ang) * rr;
          const ty = pos.y + Math.sin(ang) * rr;
          if (
            tx < this.playableBounds.minX ||
            tx > this.playableBounds.maxX ||
            ty < this.playableBounds.minY ||
            ty > this.playableBounds.maxY
          ) {
            continue;
          }
          if (!this.hasSolidInteriorCover(tx, ty, entityZ, 16, entityHeight)) {
            const sup = this.querySupport(tx, ty, entityZ + 30, 30);
            if (sup.hit && Math.abs(sup.height - entityZ) <= 110) {
              pos.x = tx;
              pos.y = ty;
              escaped = true;
              break;
            }
          }
        }
      }
    }

    const rPad = radius + 4;
    const c0 = Math.max(0, Math.min(this.cols - 1, Math.floor((pos.x - rPad) / this.cellSize)));
    const c1 = Math.max(0, Math.min(this.cols - 1, Math.floor((pos.x + rPad) / this.cellSize)));
    const r0 = Math.max(0, Math.min(this.rows - 1, Math.floor((pos.y - rPad) / this.cellSize)));
    const r1 = Math.max(0, Math.min(this.rows - 1, Math.floor((pos.y + rPad) / this.cellSize)));

    const support = this.querySupport(pos.x, pos.y, entityZ, stepUpLimit);
    const inWaterNow = support.hit && (support.category === 'water' || support.sourceTag === 'water:frozen_ice');
    const effectiveFootZ = support.hit ? Math.max(entityZ, Math.min(support.height, entityZ + stepUpLimit)) : entityZ;
    const pushOnTowerWalkway =
      (support.hit && support.category === 'tower_ledge') ||
      (this.hasTowerMesh &&
        entityZ >= this.towerMinY + 60 &&
        (!support.hit || entityZ > support.height + 16) &&
        Math.hypot(pos.x - this.towerCenterX, pos.y - this.towerCenterZ) <= this.towerOuterMaxR + 60);
    const pushSliceIdx = this.hasTowerMesh
      ? Math.max(0, Math.min(this.towerCoreRadiusSlices.length - 1, Math.floor((effectiveFootZ - this.towerMinY) / this.towerSliceHeight)))
      : 0;
    const pushCoreR = this.hasTowerMesh ? (this.towerCoreRadiusSlices[pushSliceIdx] ?? 0) : 0;
    if (this.hasTowerMesh && effectiveFootZ < this.towerMaxY - 190 && pushCoreR > 0) {
      const minCoreClearR = Math.max(290, pushCoreR - 4) + Math.min(18, radius * 0.45);
      const dx = pos.x - this.towerCenterX;
      const dy = pos.y - this.towerCenterZ;
      const dist = Math.hypot(dx, dy);
      if (dist > 1e-4 && dist < minCoreClearR) {
        pos.x = this.towerCenterX + (dx / dist) * minCoreClearR;
        pos.y = this.towerCenterZ + (dy / dist) * minCoreClearR;
      }
    }
    const bodyBottom = effectiveFootZ + 36;
    const bodyTop = effectiveFootZ + Math.max(entityHeight, 88);

    this.visitedTriSet.clear();
    for (let r = r0; r <= r1; r++) {
      const rowOff = r * this.cols;
      for (let c = c0; c <= c1; c++) {
        const tris = this.buckets[rowOff + c];
        for (let i = 0; i < tris.length; i++) {
          const tri = tris[i];
          if (this.visitedTriSet.has(tri)) continue;
          this.visitedTriSet.add(tri);

          if (!this.celestialBridgeActive && tri.sourceTag === 'celestial_bridge') continue;
          if (!BLOCKING_CATEGORIES.has(tri.category)) continue;
          const isTowerWall = tri.sourceTag === 'node:first_artifact_tower';
          const effectiveRadius =
            pushOnTowerWalkway && isTowerWall ? Math.min(radius, 18) : radius;
          const triBodyBottom = isTowerWall ? effectiveFootZ + (pushOnTowerWalkway ? 22 : 12) : bodyBottom;
          if (tri.sourceTag === 'node:ship' && tri.minY >= effectiveFootZ + 52) {
            continue;
          }
          if (tri.maxY <= triBodyBottom || tri.minY >= bodyTop) continue;
          if (
            tri.sourceTag === 'node:tower_walkway' &&
            tri.maxY <= Math.max(entityZ, effectiveFootZ) + stepUpLimit
          ) {
            continue;
          }
          if (
            isTowerWall &&
            pushOnTowerWalkway &&
            support.hit &&
            support.category === 'tower_ledge' &&
            tri.maxY <= Math.max(entityZ, effectiveFootZ) + stepUpLimit + 6
          ) {
            continue;
          }
          if (
            pos.x + effectiveRadius < tri.minX ||
            pos.x - effectiveRadius > tri.maxX ||
            pos.y + effectiveRadius < tri.minZ ||
            pos.y - effectiveRadius > tri.maxZ
          ) {
            continue;
          }

          const yLo = Math.max(tri.minY, triBodyBottom);
          const yHi = Math.min(tri.maxY, bodyTop);
          const hit = this.triangleHorizontalOverlap(tri, pos.x, pos.y, effectiveRadius, yLo, yHi);
          if (hit && hit.pen > 0.2) {
            const push = Math.min(hit.pen, 10);
            pos.x += hit.nx * push;
            pos.y += hit.nz * push;
          }
        }
      }
    }
  }

  /**
   * True 3D segment-triangle raycast for projectiles and 3D line-of-sight.
   * Water and non-solid trees are ignored; cliffs, crystals, borders, bridges, tower, and ship solid faces block.
   */
  public raycast3D(
    from: { x: number; y: number; z: number },
    to: { x: number; y: number; z: number },
    ignoreWater: boolean = true
  ): Raycast3DResult {
    const dx = to.x - from.x;
    const dy = to.z - from.z; // sim z -> 3D Y
    const dz = to.y - from.y; // sim y -> 3D Z
    const segLen = Math.hypot(dx, dy, dz);
    if (segLen < 1e-4) return { hit: false, t: 1 };

    const steps = Math.max(1, Math.ceil(Math.hypot(dx, dz) / (this.cellSize * 0.6)));
    this.visitedTriSet.clear();

    let bestT = 1.0001;
    let bestTri: ColliderTri | null = null;

    for (let s = 0; s <= steps; s++) {
      const u = s / steps;
      const sx = from.x + dx * u;
      const sz = from.y + dz * u;
      const c0 = Math.max(0, Math.min(this.cols - 1, Math.floor((sx - 8) / this.cellSize)));
      const c1 = Math.max(0, Math.min(this.cols - 1, Math.floor((sx + 8) / this.cellSize)));
      const r0 = Math.max(0, Math.min(this.rows - 1, Math.floor((sz - 8) / this.cellSize)));
      const r1 = Math.max(0, Math.min(this.rows - 1, Math.floor((sz + 8) / this.cellSize)));

      for (let r = r0; r <= r1; r++) {
        const rowOff = r * this.cols;
        for (let c = c0; c <= c1; c++) {
          const tris = this.buckets[rowOff + c];
          for (let i = 0; i < tris.length; i++) {
            const tri = tris[i];
            if (this.visitedTriSet.has(tri)) continue;
            this.visitedTriSet.add(tri);

            if (!this.celestialBridgeActive && tri.sourceTag === 'celestial_bridge') continue;
            if (tri.category === 'tree_nonsolid') continue;
            if (ignoreWater && tri.category === 'water') continue;

            const tHit = this.intersectSegmentTriangle(
              from.x, from.z, from.y,
              dx, dy, dz,
              tri
            );
            if (tHit !== null && tHit < bestT) {
              bestT = tHit;
              bestTri = tri;
            }
          }
        }
      }
    }

    if (bestTri && bestT <= 1.0) {
      return {
        hit: true,
        t: bestT,
        point: {
          x: from.x + dx * bestT,
          y: from.y + dz * bestT,
          z: from.z + dy * bestT
        },
        category: bestTri.category,
        sourceTag: bestTri.sourceTag
      };
    }

    return { hit: false, t: 1 };
  }

  public isDirectlyTraversable(from: Vector2, to: Vector2, isAirborne: boolean = false): boolean {
    if (isAirborne) return true;
    const dx = to.x - from.x;
    const dy = to.y - from.y;
    const dist = Math.hypot(dx, dy);
    if (dist < 20) return true;

    const startSup = this.querySupport(from.x, from.y, 1e6, 0);
    if (!startSup.hit) return false;
    let curZ = startSup.height;

    const steps = Math.min(18, Math.max(2, Math.ceil(dist / 36)));
    const stepLen = dist / steps;

    for (let i = 1; i <= steps; i++) {
      const t = i / steps;
      const sx = from.x + dx * t;
      const sy = from.y + dy * t;
      const prevPt = { x: from.x + dx * ((i - 1) / steps), y: from.y + dy * ((i - 1) / steps) };
      const nextPt = { x: sx, y: sy };

      const moveCheck = this.checkHorizontalMove(prevPt, nextPt, curZ, 12, 44, 24, false);
      if (!moveCheck.allowed) return false;

      const sup = this.querySupport(sx, sy, curZ, 26);
      if (!sup.hit) return false;
      if (Math.abs(sup.height - curZ) / stepLen > 0.85 && sup.height - curZ > 26) {
        return false;
      }
      curZ = sup.height;
    }
    return true;
  }

  public isPointValidEnemySpawn(wx: number, wy: number): boolean {
    if (
      wx < this.playableBounds.minX + 50 ||
      wx > this.playableBounds.maxX - 50 ||
      wy < this.playableBounds.minY + 50 ||
      wy > this.playableBounds.maxY - 50
    ) {
      return false;
    }
    const sup = this.querySupport(wx, wy, 1e6, 0);
    if (!sup.hit || sup.isInWater) return false;
    if (sup.category !== 'ground') return false;
    // Ensure not jammed inside solid crystal / cliff / border
    const check = this.checkHorizontalMove({ x: wx, y: wy }, { x: wx, y: wy }, sup.height, 24, 44, 22, false);
    return check.allowed;
  }

  public rebuildNavigationGraph(): void {
    this.navNodes = [];
    this.navCols = Math.max(1, Math.ceil(this.worldWidth / this.navCellSize));
    this.navRows = Math.max(1, Math.ceil(this.worldHeight / this.navCellSize));
    this.navCellBuckets = Array.from({ length: this.navCols * this.navRows }, () => []);
    this.validEnemySpawnPositions = [];

    // Sample up to 2 vertical layers per cell (ground/water layer + elevated bridge layer)
    for (let gz = 0; gz < this.navRows; gz++) {
      const wy = (gz + 0.5) * this.navCellSize;
      if (wy < this.playableBounds.minY + 40 || wy > this.playableBounds.maxY - 40) continue;

      for (let gx = 0; gx < this.navCols; gx++) {
        const wx = (gx + 0.5) * this.navCellSize;
        if (wx < this.playableBounds.minX + 40 || wx > this.playableBounds.maxX - 40) continue;

        const bucket = this.navCellBuckets[gz * this.navCols + gx];

        // Topmost layer (bridge / ground / rock)
        const topSup = this.querySupport(wx, wy, 1e6, 0);
        if (topSup.hit && topSup.category !== 'tower_ledge' && topSup.category !== 'ship_walkable') {
          const wallOk = this.checkHorizontalMove({ x: wx, y: wy }, { x: wx, y: wy }, topSup.height, 14, 42, 24, false).allowed;
          if (wallOk) {
            const node: NavLayerNode = {
              id: this.navNodes.length,
              gx,
              gz,
              x: wx,
              y: wy,
              z: topSup.height,
              category: topSup.category,
              neighbors: []
            };
            this.navNodes.push(node);
            bucket.push(node.id);

            if (topSup.category === 'ground' && !topSup.isInWater) {
              this.validEnemySpawnPositions.push({ x: wx, y: wy });
            }
          }
        }

        // Check lower layer under elevated bridge (e.g. river under Landscape_Arch / Ayers Rock)
        if (topSup.hit && topSup.category === 'bridge') {
          const underSup = this.querySupport(wx, wy, topSup.height - 32, 16);
          if (underSup.hit && underSup.height < topSup.height - 28) {
            const wallOk = this.checkHorizontalMove({ x: wx, y: wy }, { x: wx, y: wy }, underSup.height, 14, 42, 24, false).allowed;
            if (wallOk) {
              const underNode: NavLayerNode = {
                id: this.navNodes.length,
                gx,
                gz,
                x: wx,
                y: wy,
                z: underSup.height,
                category: underSup.category,
                neighbors: []
              };
              this.navNodes.push(underNode);
              bucket.push(underNode.id);
            }
          }
        }
      }
    }

    // Connect 8-neighbor nav transitions with elevation & cliff validation
    const dirs = [
      [1, 0], [-1, 0], [0, 1], [0, -1],
      [1, 1], [1, -1], [-1, 1], [-1, -1]
    ];

    for (let i = 0; i < this.navNodes.length; i++) {
      const a = this.navNodes[i];
      for (let d = 0; d < dirs.length; d++) {
        const nx = a.gx + dirs[d][0];
        const ny = a.gz + dirs[d][1];
        if (nx < 0 || nx >= this.navCols || ny < 0 || ny >= this.navRows) continue;
        const candIds = this.navCellBuckets[ny * this.navCols + nx];
        for (let c = 0; c < candIds.length; c++) {
          const b = this.navNodes[candIds[c]];
          const dz = Math.abs(b.z - a.z);
          if (dz > 34) continue;
          const midX = (a.x + b.x) * 0.5;
          const midY = (a.y + b.y) * 0.5;
          const midOk = this.checkHorizontalMove(
            { x: a.x, y: a.y },
            { x: midX, y: midY },
            (a.z + b.z) * 0.5,
            12,
            40,
            24,
            false
          ).allowed;
          if (!midOk) continue;

          const baseDist = Math.hypot(b.x - a.x, b.y - a.y);
          const waterWeight = b.category === 'water' ? 2.1 : 1.0;
          a.neighbors.push({ id: b.id, cost: baseDist * waterWeight });
        }
      }
    }

    const nodeCount = this.navNodes.length;
    this.astarGScore = new Float32Array(nodeCount);
    this.astarFScore = new Float32Array(nodeCount);
    this.astarCameFrom = new Int32Array(nodeCount);
    this.astarVisitedGen = new Int32Array(nodeCount);
    this.astarClosedGen = new Int32Array(nodeCount);
    this.astarInOpenGen = new Int32Array(nodeCount);
    this.astarHeapPos = new Int32Array(nodeCount);
    this.astarHeap = new Int32Array(nodeCount);
    this.astarSearchGen = 0;
  }

  private findNearestNavNode(pos: Vector2, zHint?: number): NavLayerNode | null {
    const gx0 = Math.max(0, Math.min(this.navCols - 1, Math.floor(pos.x / this.navCellSize)));
    const gz0 = Math.max(0, Math.min(this.navRows - 1, Math.floor(pos.y / this.navCellSize)));
    let best: NavLayerNode | null = null;
    let bestScore = Infinity;

    for (let rad = 0; rad <= 4; rad++) {
      for (let dz = -rad; dz <= rad; dz++) {
        for (let dx = -rad; dx <= rad; dx++) {
          if (rad > 0 && Math.abs(dx) < rad && Math.abs(dz) < rad) continue;
          const gx = gx0 + dx;
          const gz = gz0 + dz;
          if (gx < 0 || gx >= this.navCols || gz < 0 || gz >= this.navRows) continue;
          const ids = this.navCellBuckets[gz * this.navCols + gx];
          for (let k = 0; k < ids.length; k++) {
            const node = this.navNodes[ids[k]];
            const horiz = Math.hypot(node.x - pos.x, node.y - pos.y);
            const vert = zHint !== undefined ? Math.abs(node.z - zHint) * 2.5 : 0;
            const score = horiz + vert;
            if (score < bestScore) {
              bestScore = score;
              best = node;
            }
          }
        }
      }
      if (best) return best;
    }
    return best;
  }

  public findNextNavWaypoint(
    from: Vector2,
    to: Vector2,
    fromZ?: number,
    toZ?: number,
    isAirborne: boolean = false
  ): NavWaypointQueryResult {
    if (isAirborne || this.isDirectlyTraversable(from, to, isAirborne)) {
      return {
        waypoint: { x: to.x, y: to.y },
        isReachable: true,
        isAtStandoff: false,
        status: 'direct'
      };
    }

    const start = this.findNearestNavNode(from, fromZ);
    const goal = this.findNearestNavNode(to, toZ);
    if (!start || !goal) {
      return {
        waypoint: { x: from.x, y: from.y },
        isReachable: false,
        isAtStandoff: true,
        status: 'unreachable_standoff',
        standoffPos: { x: from.x, y: from.y }
      };
    }
    if (start.id === goal.id) {
      return {
        waypoint: { x: to.x, y: to.y },
        isReachable: true,
        isAtStandoff: false,
        status: 'pathfinding'
      };
    }

    // Zero-allocation bounded A* on precomputed navNodes using generation-tagged typed arrays & binary min-heap
    if (this.astarSearchGen >= 0x7ffffff0) {
      this.astarVisitedGen.fill(0);
      this.astarClosedGen.fill(0);
      this.astarInOpenGen.fill(0);
      this.astarSearchGen = 0;
    }
    const gen = ++this.astarSearchGen;
    const gScore = this.astarGScore;
    const fScore = this.astarFScore;
    const cameFrom = this.astarCameFrom;
    const visitedGen = this.astarVisitedGen;
    const closedGen = this.astarClosedGen;
    const inOpenGen = this.astarInOpenGen;
    const heapPos = this.astarHeapPos;
    const heap = this.astarHeap;

    const siftUp = (idx: number) => {
      const nodeId = heap[idx];
      const f = fScore[nodeId];
      while (idx > 0) {
        const parentIdx = (idx - 1) >> 1;
        const parentId = heap[parentIdx];
        if (f >= fScore[parentId]) break;
        heap[idx] = parentId;
        heapPos[parentId] = idx;
        idx = parentIdx;
      }
      heap[idx] = nodeId;
      heapPos[nodeId] = idx;
    };

    const siftDown = (idx: number, size: number) => {
      const nodeId = heap[idx];
      const f = fScore[nodeId];
      const half = size >> 1;
      while (idx < half) {
        let childIdx = (idx << 1) + 1;
        let childId = heap[childIdx];
        const rightIdx = childIdx + 1;
        if (rightIdx < size && fScore[heap[rightIdx]] < fScore[childId]) {
          childIdx = rightIdx;
          childId = heap[rightIdx];
        }
        if (f <= fScore[childId]) break;
        heap[idx] = childId;
        heapPos[childId] = idx;
        idx = childIdx;
      }
      heap[idx] = nodeId;
      heapPos[nodeId] = idx;
    };

    let heapSize = 1;
    heap[0] = start.id;
    heapPos[start.id] = 0;
    visitedGen[start.id] = gen;
    inOpenGen[start.id] = gen;
    cameFrom[start.id] = -1;
    gScore[start.id] = 0;
    const startGoalDist = Math.hypot(goal.x - start.x, goal.y - start.y);
    fScore[start.id] = startGoalDist;

    let bestVisited = start;
    let bestVisitedDist = startGoalDist;
    let iterations = 0;
    const maxIterations = 650;
    let reachedGoal = false;

    while (heapSize > 0 && iterations < maxIterations) {
      iterations++;
      const curId = heap[0];
      heapSize--;
      if (heapSize > 0) {
        const lastId = heap[heapSize];
        heap[0] = lastId;
        heapPos[lastId] = 0;
        siftDown(0, heapSize);
      }
      inOpenGen[curId] = 0;

      if (curId === goal.id) {
        reachedGoal = true;
        break;
      }
      closedGen[curId] = gen;

      const cur: NavLayerNode = this.navNodes[curId];
      const dToGoal = Math.hypot(goal.x - cur.x, goal.y - cur.y);
      if (dToGoal < bestVisitedDist) {
        bestVisitedDist = dToGoal;
        bestVisited = cur;
      }

      const curG = gScore[curId];
      const neighbors: NavLayerNode['neighbors'] = cur.neighbors;
      for (let n = 0; n < neighbors.length; n++) {
        const edge: { id: number; cost: number } = neighbors[n];
        const nbId = edge.id;
        if (closedGen[nbId] === gen) continue;
        const nb = this.navNodes[nbId];
        const tentativeG = curG + edge.cost;
        const prevG = visitedGen[nbId] === gen ? gScore[nbId] : Infinity;
        if (tentativeG < prevG) {
          visitedGen[nbId] = gen;
          cameFrom[nbId] = curId;
          gScore[nbId] = tentativeG;
          fScore[nbId] = tentativeG + Math.hypot(goal.x - nb.x, goal.y - nb.y);
          if (inOpenGen[nbId] === gen) {
            siftUp(heapPos[nbId]);
          } else {
            inOpenGen[nbId] = gen;
            heap[heapSize] = nbId;
            heapPos[nbId] = heapSize;
            siftUp(heapSize);
            heapSize++;
          }
        }
      }
    }

    const endId = reachedGoal ? goal.id : bestVisited.id;
    if (endId === start.id) {
      return {
        waypoint: { x: start.x, y: start.y },
        isReachable: false,
        isAtStandoff: true,
        status: 'unreachable_standoff',
        standoffPos: { x: start.x, y: start.y }
      };
    }

    let stepId = endId;
    while (visitedGen[stepId] === gen && cameFrom[stepId] !== -1 && cameFrom[stepId] !== start.id) {
      stepId = cameFrom[stepId];
    }
    const nextNode = this.navNodes[stepId];
    return {
      waypoint: { x: nextNode.x, y: nextNode.y },
      isReachable: reachedGoal,
      isAtStandoff: !reachedGoal,
      status: reachedGoal ? 'pathfinding' : 'unreachable_standoff',
      standoffPos: reachedGoal ? undefined : { x: bestVisited.x, y: bestVisited.y }
    };
  }

  public getNavDebugSegments(): Array<{ ax: number; ay: number; az: number; bx: number; by: number; bz: number; isWater: boolean }> {
    const segs: Array<{ ax: number; ay: number; az: number; bx: number; by: number; bz: number; isWater: boolean }> = [];
    for (let i = 0; i < this.navNodes.length; i++) {
      const a = this.navNodes[i];
      for (let j = 0; j < a.neighbors.length; j++) {
        const b = this.navNodes[a.neighbors[j].id];
        if (b.id > a.id) {
          segs.push({
            ax: a.x,
            ay: a.z,
            az: a.y,
            bx: b.x,
            by: b.z,
            bz: b.y,
            isWater: a.category === 'water' || b.category === 'water'
          });
        }
      }
    }
    return segs;
  }

  private barycentricY(tri: ColliderTri, px: number, pz: number, edgeTol: number = -0.015): number | null {
    const denom = (tri.bz - tri.cz) * (tri.ax - tri.cx) + (tri.cx - tri.bx) * (tri.az - tri.cz);
    if (Math.abs(denom) < 1e-5) return null;
    const w0 = ((tri.bz - tri.cz) * (px - tri.cx) + (tri.cx - tri.bx) * (pz - tri.cz)) / denom;
    if (w0 < edgeTol) return null;
    const w1 = ((tri.cz - tri.az) * (px - tri.cx) + (tri.ax - tri.cx) * (pz - tri.cz)) / denom;
    if (w1 < edgeTol) return null;
    const w2 = 1.0 - w0 - w1;
    if (w2 < edgeTol) return null;
    // Clamp barycentric weights inside [0, 1] so negative edgeTol on vertical wall slivers never extrapolates height spikes
    const cw0 = Math.max(0, w0);
    const cw1 = Math.max(0, w1);
    const cw2 = Math.max(0, w2);
    const wSum = cw0 + cw1 + cw2 || 1;
    return (cw0 * tri.ay + cw1 * tri.by + cw2 * tri.cy) / wSum;
  }

  private triangleHorizontalOverlap(
    tri: ColliderTri,
    px: number,
    pz: number,
    radius: number,
    yLo: number,
    yHi: number
  ): { pen: number; nx: number; nz: number } | null {
    if (yHi < yLo) return null;
    let sliceCount = 1;
    if (yHi - yLo < 4) {
      SLICE_Y_VALS[0] = 0.5 * (yLo + yHi);
    } else {
      sliceCount = 3;
      SLICE_Y_VALS[0] = yLo + 0.5;
      SLICE_Y_VALS[1] = 0.5 * (yLo + yHi);
      SLICE_Y_VALS[2] = yHi - 0.5;
    }
    let maxPen = 0;
    let outNx = 0;
    let outNz = 0;

    for (let s = 0; s < sliceCount; s++) {
      const y = SLICE_Y_VALS[s];
      const seg = this.sliceTriangleAtY(tri, y);
      if (!seg) continue;

      const abx = seg.x2 - seg.x1;
      const abz = seg.z2 - seg.z1;
      const abLen2 = abx * abx + abz * abz;
      let t = 0;
      if (abLen2 > 1e-6) {
        t = Math.max(0, Math.min(1, ((px - seg.x1) * abx + (pz - seg.z1) * abz) / abLen2));
      }
      const cx = seg.x1 + abx * t;
      const cz = seg.z1 + abz * t;
      const dx = px - cx;
      const dz = pz - cz;
      const dist = Math.hypot(dx, dz);

      if (dist < radius) {
        const pen = radius - dist;
        if (pen > maxPen) {
          maxPen = pen;
          if (dist > 1e-4) {
            outNx = dx / dist;
            outNz = dz / dist;
          } else {
            const nLen = Math.hypot(tri.nx, tri.nz);
            outNx = nLen > 1e-4 ? tri.nx / nLen : 0;
            outNz = nLen > 1e-4 ? tri.nz / nLen : 1;
          }
        }
      }
    }

    if (maxPen > 0) {
      OVERLAP_HIT.pen = maxPen;
      OVERLAP_HIT.nx = outNx;
      OVERLAP_HIT.nz = outNz;
      return OVERLAP_HIT;
    }
    return null;
  }

  private sliceTriangleAtY(
    tri: ColliderTri,
    y: number
  ): { x1: number; z1: number; x2: number; z2: number } | null {
    let ptLen = 0;
    const testEdge = (
      x0: number, y0: number, z0: number,
      x1: number, y1: number, z1: number
    ) => {
      const d0 = y0 - y;
      const d1 = y1 - y;
      if ((d0 <= 0 && d1 >= 0) || (d0 >= 0 && d1 <= 0)) {
        const dy = y1 - y0;
        if (Math.abs(dy) < 1e-6) {
          if (ptLen + 4 <= 12) {
            SLICE_PTS[ptLen++] = x0;
            SLICE_PTS[ptLen++] = z0;
            SLICE_PTS[ptLen++] = x1;
            SLICE_PTS[ptLen++] = z1;
          }
        } else if (ptLen + 2 <= 12) {
          const t = (y - y0) / dy;
          SLICE_PTS[ptLen++] = x0 + (x1 - x0) * t;
          SLICE_PTS[ptLen++] = z0 + (z1 - z0) * t;
        }
      }
    };
    testEdge(tri.ax, tri.ay, tri.az, tri.bx, tri.by, tri.bz);
    testEdge(tri.bx, tri.by, tri.bz, tri.cx, tri.cy, tri.cz);
    testEdge(tri.cx, tri.cy, tri.cz, tri.ax, tri.ay, tri.az);
    if (ptLen < 4) return null;
    SLICE_SEG.x1 = SLICE_PTS[0];
    SLICE_SEG.z1 = SLICE_PTS[1];
    SLICE_SEG.x2 = SLICE_PTS[2];
    SLICE_SEG.z2 = SLICE_PTS[3];
    return SLICE_SEG;
  }

  private intersectSegmentTriangle(
    ox: number, oy: number, oz: number,
    dx: number, dy: number, dz: number,
    tri: ColliderTri
  ): number | null {
    const e1x = tri.bx - tri.ax;
    const e1y = tri.by - tri.ay;
    const e1z = tri.bz - tri.az;
    const e2x = tri.cx - tri.ax;
    const e2y = tri.cy - tri.ay;
    const e2z = tri.cz - tri.az;

    const hx = dy * e2z - dz * e2y;
    const hy = dz * e2x - dx * e2z;
    const hz = dx * e2y - dy * e2x;
    const a = e1x * hx + e1y * hy + e1z * hz;
    if (Math.abs(a) < 1e-6) return null;

    const f = 1.0 / a;
    const sx = ox - tri.ax;
    const sy = oy - tri.ay;
    const sz = oz - tri.az;
    const u = f * (sx * hx + sy * hy + sz * hz);
    if (u < -0.002 || u > 1.002) return null;

    const qx = sy * e1z - sz * e1y;
    const qy = sz * e1x - sx * e1z;
    const qz = sx * e1y - sy * e1x;
    const v = f * (dx * qx + dy * qy + dz * qz);
    if (v < -0.002 || u + v > 1.004) return null;

    const t = f * (e2x * qx + e2y * qy + e2z * qz);
    if (t >= 0 && t <= 1.0) return t;
    return null;
  }
}

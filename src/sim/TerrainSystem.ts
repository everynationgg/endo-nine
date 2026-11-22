import { DashEventPlatform, TerrainSurfaceCategory, Vector2 } from './types';
import { SeededRandom } from './ItemDefs';
import { MeshTerrainCollider, SupportQueryResult } from './MeshTerrainCollider';

export interface PlateauDef {
  id: string;
  name: string;
  x: number;
  y: number;
  w: number;
  h: number;
  elevation: number;
}

export interface ChasmDef {
  id: string;
  name: string;
  x: number;
  y: number;
  w: number;
  h: number;
  depth: number;
}

export interface BridgeDef {
  id: string;
  x: number;
  y: number;
  w: number;
  h: number;
  elevation: number;
}

export interface RampDef {
  id: string;
  x: number;
  y: number;
  w: number;
  h: number;
  direction: 'north' | 'south' | 'east' | 'west';
  bottomZ: number;
  topZ: number;
}

export interface NavNode {
  id: string;
  pos: Vector2;
  neighbors: string[];
  height?: number;
  tier?: number;
}

export interface NavWaypointResult {
  waypoint: Vector2;
  isReachable: boolean;
  isAtStandoff: boolean;
  status: 'direct' | 'pathfinding' | 'unreachable_standoff' | 'unreachable_patrol';
  standoffPos?: Vector2;
}

export interface TerrainSample {
  height: number;
  surfaceType: 'valley' | 'plateau' | 'ramp' | 'chasm' | 'bridge';
  isWalkable: boolean;
  isInWater?: boolean;
  category?: TerrainSurfaceCategory;
  sourceTag?: string;
}

export class TerrainSystem {
  // Compact, vertically layered 3D world (RoR2 scale: 3600x3600, 600+ unit verticality)
  public worldWidth: number = 3600;
  public worldHeight: number = 3600;

  // Preserved for backwards compatibility with any existing queries
  public plateaus: PlateauDef[] = [];
  public chasms: ChasmDef[] = [];
  public bridges: BridgeDef[] = [];
  public ramps: RampDef[] = [];

  public seed: number = 133799;
  public middlePlateauCenter: Vector2 = { x: 2550, y: 1800 };
  public middlePlateauRadius: number = 450;
  public middlePlateauElevation: number = 255;

  public upperPlateauCenter: Vector2 = { x: 1400, y: 1050 };
  public upperPlateauRadius: number = 390;
  public upperPlateauElevation: number = 615;

  // Connecting climbable ramps definitions
  public ramp1 = { x0: 1950, y0: 2450, x1: 2450, y1: 1900, h0: 18, h1: 255, roadW: 65, blendW: 130 };
  public ramp2 = { x0: 2300, y0: 1550, x1: 1550, y1: 1100, h0: 255, h1: 615, roadW: 65, blendW: 135 };
  public ramp3 = { x0: 1450, y0: 2500, x1: 1050, y1: 1950, h0: 15, h1: 220, roadW: 60, blendW: 120 };

  public navNodes: Record<string, NavNode> = {};
  public heightGrid: Float32Array = new Float32Array(361 * 361);
  public isCustomTestMap: boolean = false;
  public testSpawnPos: Vector2 | null = null;
  public testBossSpawnPos: Vector2 | null = null;
  public testRedCrystalMouthPos: { x: number; y: number; z: number } | null = null;
  public testWalkableBounds: { minX: number; maxX: number; minY: number; maxY: number } | null = null;
  public testCircularBounds: { cx: number; cz: number; radius: number } | null = null;
  public testTowerStepBounds: { minX: number; maxX: number; minY: number; maxY: number } | null = null;
  public testEnemySpawnMask: Uint8Array | null = null;
  public testEnemySpawnCells: number[] = [];
  public testWaterMask: Uint8Array | null = null;
  public allowTestMapNarrative: boolean = false;
  public testFloraAnchors: Array<{ x: number; y: number; z: number }> = [];
  public meshCollider: MeshTerrainCollider | null = null;
  public testDoubleJumpPos: { x: number; y: number; z?: number } | null = null;
  public testShipBox: { minX: number; maxX: number; minY: number; maxY: number; minZ: number; maxZ: number } | null = null;
  public activeDashPlatforms: DashEventPlatform[] = [];

  constructor(seed: number = 133799) {
    this.rebuildWithSeed(seed);
  }

  public getPlayableBounds(defaultPad: number = 45): { minX: number; maxX: number; minY: number; maxY: number } {
    if (this.isCustomTestMap && this.testWalkableBounds) {
      return {
        minX: Math.max(defaultPad, this.testWalkableBounds.minX),
        maxX: Math.min(this.worldWidth - defaultPad, this.testWalkableBounds.maxX),
        minY: Math.max(defaultPad, this.testWalkableBounds.minY),
        maxY: Math.min(this.worldHeight - defaultPad, this.testWalkableBounds.maxY)
      };
    }
    return {
      minX: defaultPad,
      maxX: this.worldWidth - defaultPad,
      minY: defaultPad,
      maxY: this.worldHeight - defaultPad
    };
  }

  public clampToPlayableBounds(
    pos: Vector2,
    defaultPad: number = 45
  ): { pos: Vector2; clamped: boolean; normal: Vector2 } {
    const b = this.getPlayableBounds(defaultPad);
    let x = pos.x;
    let y = pos.y;
    let clamped = false;
    let nx = 0;
    let ny = 0;

    if (x < b.minX) {
      x = b.minX;
      nx = 1;
      clamped = true;
    } else if (x > b.maxX) {
      x = b.maxX;
      nx = -1;
      clamped = true;
    }
    if (y < b.minY) {
      y = b.minY;
      ny = 1;
      clamped = true;
    } else if (y > b.maxY) {
      y = b.maxY;
      ny = -1;
      clamped = true;
    }

    if (this.isCustomTestMap && this.testCircularBounds) {
      const cb = this.testCircularBounds;
      const effectiveRadius = Math.max(40, cb.radius - defaultPad);
      const dx = x - cb.cx;
      const dy = y - cb.cz;
      const dist = Math.hypot(dx, dy);
      if (dist > effectiveRadius && dist > 0.0001) {
        const inv = 1 / dist;
        x = cb.cx + dx * inv * effectiveRadius;
        y = cb.cz + dy * inv * effectiveRadius;
        nx = -dx * inv;
        ny = -dy * inv;
        clamped = true;
      }
    } else if (clamped) {
      const nLen = Math.hypot(nx, ny);
      if (nLen > 0) {
        nx /= nLen;
        ny /= nLen;
      }
    }

    return { pos: { x, y }, clamped, normal: { x: nx, y: ny } };
  }

  public isInsidePlayableBounds(wx: number, wy: number, defaultPad: number = 0): boolean {
    if (this.isCustomTestMap && this.testWalkableBounds) {
      const b = this.getPlayableBounds(defaultPad);
      if (wx < b.minX || wx > b.maxX || wy < b.minY || wy > b.maxY) return false;
    }
    if (this.isCustomTestMap && this.testCircularBounds) {
      const cb = this.testCircularBounds;
      const effectiveRadius = Math.max(40, cb.radius - defaultPad);
      if (Math.hypot(wx - cb.cx, wy - cb.cz) > effectiveRadius) return false;
    }
    return true;
  }

  public setCustomHeightGrid(
    grid: Float32Array | null,
    spawnPos?: Vector2,
    bossSpawnPos?: Vector2,
    walkableBounds?: { minX: number; maxX: number; minY: number; maxY: number } | null,
    circularBounds?: { cx: number; cz: number; radius: number } | null,
    options?: {
      towerStepBounds?: { minX: number; maxX: number; minY: number; maxY: number } | null;
      enemySpawnMask?: Uint8Array | null;
      waterMask?: Uint8Array | null;
      allowTestMapNarrative?: boolean;
      meshCollider?: MeshTerrainCollider | null;
      worldWidth?: number;
      worldHeight?: number;
      testDoubleJumpPos?: { x: number; y: number; z?: number } | null;
      testRedCrystalMouthPos?: { x: number; y: number; z: number } | null;
      testShipBox?: { minX: number; maxX: number; minY: number; maxY: number; minZ: number; maxZ: number } | null;
    }
  ): void {
    if (!grid) {
      this.isCustomTestMap = false;
      this.worldWidth = 3600;
      this.worldHeight = 3600;
      this.meshCollider = null;
      this.testDoubleJumpPos = null;
      this.testShipBox = null;
      this.testSpawnPos = null;
      this.testBossSpawnPos = null;
      this.testRedCrystalMouthPos = null;
      this.testWalkableBounds = null;
      this.testCircularBounds = null;
      this.testTowerStepBounds = null;
      this.testEnemySpawnMask = null;
      this.testEnemySpawnCells = [];
      this.testWaterMask = null;
      this.allowTestMapNarrative = false;
      this.testFloraAnchors = [];
      this.rebuildWithSeed(this.seed);
      return;
    }
    this.isCustomTestMap = true;
    this.worldWidth = options?.worldWidth ?? 3600;
    this.worldHeight = options?.worldHeight ?? 3600;
    this.meshCollider = options?.meshCollider ?? null;
    this.testDoubleJumpPos = options?.testDoubleJumpPos ? { ...options.testDoubleJumpPos } : null;
    this.testShipBox = options?.testShipBox ? { ...options.testShipBox } : null;
    this.testSpawnPos = spawnPos ? { ...spawnPos } : { x: this.worldWidth * 0.5, y: this.worldHeight * 0.5 };
    this.testBossSpawnPos = bossSpawnPos ? { ...bossSpawnPos } : { x: 340, y: 440 };
    this.testRedCrystalMouthPos = options?.testRedCrystalMouthPos ? { ...options.testRedCrystalMouthPos } : null;
    this.testWalkableBounds = walkableBounds ? { ...walkableBounds } : null;
    this.testCircularBounds = circularBounds ? { ...circularBounds } : null;
    this.testTowerStepBounds = options?.towerStepBounds ? { ...options.towerStepBounds } : null;
    this.testEnemySpawnMask = options?.enemySpawnMask ? new Uint8Array(options.enemySpawnMask) : null;
    this.testEnemySpawnCells = [];
    if (this.testEnemySpawnMask) {
      for (let i = 0; i < this.testEnemySpawnMask.length; i++) {
        if (this.testEnemySpawnMask[i]) this.testEnemySpawnCells.push(i);
      }
    }
    this.testWaterMask = options?.waterMask ? new Uint8Array(options.waterMask) : null;
    this.allowTestMapNarrative = Boolean(options?.allowTestMapNarrative);

    if (this.heightGrid.length !== grid.length) {
      this.heightGrid = new Float32Array(grid.length);
    }
    this.heightGrid.set(grid);
    if (!this.meshCollider) {
      this.updateNavNodes();
    }
  }

  public isInTowerStepZone(wx: number, wy: number): boolean {
    if (!this.isCustomTestMap || !this.testTowerStepBounds) return false;
    const b = this.testTowerStepBounds;
    return wx >= b.minX && wx <= b.maxX && wy >= b.minY && wy <= b.maxY;
  }

  public getStepUpLimitAt(_wx: number, _wy: number, _targetHeight?: number): number {
    // Knee/waist step height for 2x-scaled characters (~104u tall): walks smoothly over slopes,
    // bridges, and potholes without ever wall-teleporting up vertical cliffs or walls.
    return this.isCustomTestMap ? 56.0 : 28.0;
  }

  public isPointValidEnemySpawn(wx: number, wy: number): boolean {
    if (this.meshCollider) {
      return this.meshCollider.isPointValidEnemySpawn(wx, wy);
    }
    if (!this.isInsidePlayableBounds(wx, wy, 40)) return false;
    if (this.testEnemySpawnMask) {
      const gx = Math.max(0, Math.min(360, Math.round(wx / 10)));
      const gz = Math.max(0, Math.min(360, Math.round(wy / 10)));
      return this.testEnemySpawnMask[gz * 361 + gx] === 1;
    }
    return this.getElevation(wx, wy).isWalkable;
  }

  public isPointNearWater(wx: number, wy: number): boolean {
    if (this.meshCollider) {
      for (let ox = -24; ox <= 24; ox += 24) {
        for (let oy = -24; oy <= 24; oy += 24) {
          const s = this.meshCollider.querySupport(wx + ox, wy + oy, 1e6, 22);
          if (s.hit && (s.isInWater || s.category === 'water')) return true;
        }
      }
      return false;
    }
    if (!this.testWaterMask) {
      for (let ox = -24; ox <= 24; ox += 24) {
        for (let oy = -24; oy <= 24; oy += 24) {
          if (this.calculateHeight(wx + ox, wy + oy) <= 5.5) return true;
        }
      }
      return false;
    }
    const gx = Math.max(0, Math.min(360, Math.round(wx / 10)));
    const gz = Math.max(0, Math.min(360, Math.round(wy / 10)));
    for (let dz = -2; dz <= 2; dz++) {
      for (let dx = -2; dx <= 2; dx++) {
        const nx = gx + dx;
        const nz = gz + dz;
        if (nx >= 0 && nx <= 360 && nz >= 0 && nz <= 360 && this.testWaterMask[nz * 361 + nx] === 1) {
          return true;
        }
      }
    }
    return false;
  }

  public rebuildWithSeed(seed: number): void {
    this.isCustomTestMap = false;
    this.testSpawnPos = null;
    this.testBossSpawnPos = null;
    this.testRedCrystalMouthPos = null;
    this.testWalkableBounds = null;
    this.testCircularBounds = null;
    this.testTowerStepBounds = null;
    this.testShipBox = null;
    this.testEnemySpawnMask = null;
    this.testEnemySpawnCells = [];
    this.testWaterMask = null;
    this.allowTestMapNarrative = false;
    this.testFloraAnchors = [];
    this.seed = seed;
    const rng = new SeededRandom(seed);

    // 1. Randomize Middle Combat Plateau position & radius within validated sector
    const mpX = 2450 + (rng.next() - 0.5) * 260;
    const mpY = 1800 + (rng.next() - 0.5) * 260;
    const mpRadius = 420 + (rng.next() - 0.5) * 60;
    const mpElev = 255;
    this.middlePlateauCenter = { x: mpX, y: mpY };
    this.middlePlateauRadius = mpRadius;
    this.middlePlateauElevation = mpElev;

    // 2. Randomize Upper Summit Plateau position & radius within validated sector
    const upX = 1400 + (rng.next() - 0.5) * 240;
    const upY = 1050 + (rng.next() - 0.5) * 200;
    const upRadius = 380 + (rng.next() - 0.5) * 50;
    const upElev = 615;
    this.upperPlateauCenter = { x: upX, y: upY };
    this.upperPlateauRadius = upRadius;
    this.upperPlateauElevation = upElev;

    // 3. Dynamically compute climbable connecting ramps
    // Keep Ramp 1 base in the eastern valley (x0 >= 1960) to protect the crash site deck
    const r1X0 = Math.max(1960, mpX - mpRadius - 30);
    const r1Y0 = Math.min(2380, Math.max(2150, mpY + 260));
    this.ramp1 = {
      x0: r1X0,
      y0: r1Y0,
      x1: mpX - 60,
      y1: mpY + 40,
      h0: 18,
      h1: mpElev,
      roadW: 65,
      blendW: 130
    };

    this.ramp2 = {
      x0: mpX - 180,
      y0: mpY - mpRadius * 0.5,
      x1: upX + upRadius * 0.45,
      y1: upY + 45,
      h0: mpElev,
      h1: upElev,
      roadW: 65,
      blendW: 135
    };

    this.ramp3 = {
      x0: 1450,
      y0: 2500,
      x1: 1050,
      y1: 1950,
      h0: 15,
      h1: 220,
      roadW: 60,
      blendW: 120
    };

    this.updateNavNodes();

    // Fast O(1) Heightfield Cache (361x361 grid, 10 units per cell)
    // Eliminates thousands of per-frame transcendental function evaluations across AI and collision
    const res = 10;
    const size = 361;
    if (this.heightGrid.length !== size * size) {
      this.heightGrid = new Float32Array(size * size);
    }
    for (let gy = 0; gy < size; gy++) {
      const wy = gy * res;
      const row = gy * size;
      for (let gx = 0; gx < size; gx++) {
        const wx = gx * res;
        this.heightGrid[row + gx] = this.calculateRawHeight(wx, wy);
      }
    }
  }

  /**
   * Fast bilinear-interpolated height query using the precomputed height cache.
   * Runs in ~3ns instead of computing 50+ lines of transcendental trigonometry.
   */
  public calculateHeight(wx: number, wy: number): number {
    if (this.meshCollider) {
      const sup = this.meshCollider.querySupport(wx, wy, 1e6, 22);
      if (sup.hit) return sup.height;
    }
    if (!this.heightGrid || this.heightGrid.length === 0) {
      return this.calculateRawHeight(wx, wy);
    }
    const maxW = Math.max(1, this.worldWidth);
    const maxH = Math.max(1, this.worldHeight);
    const cx = (Math.max(0, Math.min(maxW, wx)) / maxW) * 360;
    const cy = (Math.max(0, Math.min(maxH, wy)) / maxH) * 360;
    const x0 = Math.floor(cx);
    const y0 = Math.floor(cy);
    const x1 = Math.min(360, x0 + 1);
    const y1 = Math.min(360, y0 + 1);
    const fx = cx - x0;
    const fy = cy - y0;

    const row0 = y0 * 361;
    const row1 = y1 * 361;
    const h00 = this.heightGrid[row0 + x0];
    const h10 = this.heightGrid[row0 + x1];
    const h01 = this.heightGrid[row1 + x0];
    const h11 = this.heightGrid[row1 + x1];

    const top = h00 + (h10 - h00) * fx;
    const bot = h01 + (h11 - h01) * fx;
    return top + (bot - top) * fy;
  }

  /**
   * Risk of Rain 2 inspired multi-tier vertical heightfield function.
   * Produces a compact, vertically interconnected landscape with real, substantial elevation:
   * - Lower Valley & Riverbed: Base elevation Z ~ 0 - 15 (0 to 0.3 player heights)
   * - Middle Combat Plateau: Elevation Z ~ 255 (5.0 player heights, 4-6 target)
   * - Upper Summit Plateau: Elevation Z ~ 615 (11.8 player heights, 10-15 target)
   * - Elevated Shortcut: Stone Spire ledge Z ~ 420 (jump/glide accessible)
   * - 3 gradual, naturally climbable ramps/slopes connecting each tier without jumping
   * - Asymmetric mountain layout with wide open southern & eastern horizons (no enclosing crater!)
   */
  public calculateRawHeight(wx: number, wy: number): number {
    // 1. Asymmetric Alien Mountain Formations (Breaks up the crater appearance, creating expansive open horizon views)
    let boundaryHeight = 0;

    // 1a. Towering Northern Alpine Massif (Towers dramatically behind Upper Summit Plateau framing the Monolith)
    // Active only in wy < 380, wx in [450, 2500]
    if (wy < 380 && wx >= 450 && wx <= 2500) {
      const tY = 1 - wy / 380;
      let edgeFade = 1.0;
      if (wx < 750) edgeFade = (wx - 450) / 300;
      else if (wx > 2150) edgeFade = (2500 - wx) / 350;
      boundaryHeight = Math.max(boundaryHeight, tY * tY * 850 * Math.max(0, Math.min(1, edgeFade)));
    }

    // 1b. Rugged Western Ridge
    // Active along wx < 350, wy in [600, 2400]
    if (wx < 350 && wy >= 600 && wy <= 2400) {
      const tX = 1 - wx / 350;
      let edgeFade = 1.0;
      if (wy < 900) edgeFade = (wy - 600) / 300;
      else if (wy > 2100) edgeFade = (2400 - wy) / 300;
      boundaryHeight = Math.max(boundaryHeight, tX * tX * 680 * Math.max(0, Math.min(1, edgeFade)));
    }

    // 1c. Eastern Ridge (Flanking Middle Plateau)
    // Active along wx > 3280, wy in [1100, 2400]
    if (wx > 3280 && wy >= 1100 && wy <= 2400) {
      const tX = (wx - 3280) / 320;
      let edgeFade = 1.0;
      if (wy < 1400) edgeFade = (wy - 1100) / 300;
      else if (wy > 2100) edgeFade = (2400 - wy) / 300;
      boundaryHeight = Math.max(boundaryHeight, tX * tX * 520 * Math.max(0, Math.min(1, edgeFade)));
    }
    // Notice: South (wy > 2800), Southeast (wx > 2800, wy > 2400), Northeast Pass (wx > 2500, wy < 600),
    // and Southwest Estuary have boundaryHeight = 0, giving unobstructed panoramic sightlines!

    // 2. Base rolling alien turf with genuine curved elevation, undulating mounds, and amphitheater dish
    const distFromCenter = Math.hypot(wx - 1800, wy - 1800);
    // Organic amphitheater dish curvature (rises gently by up to 38 units toward the outer crater walls)
    const craterDish = Math.pow(Math.min(1.0, distFromCenter / 1400), 1.6) * 38.0;

    // Multi-frequency undulating rolling mounds (meso-relief: gentle, visible slopes, 100% walkable)
    const warpX = Math.sin(wy * 0.004) * 40;
    const warpY = Math.cos(wx * 0.004) * 40;
    const macroMounds = Math.sin((wx + warpX) * 0.009) * 14.0 + Math.cos((wy + warpY) * 0.0085) * 14.0;
    const mesoKnolls = Math.sin(wx * 0.018 + wy * 0.014) * 7.0 + Math.cos(wy * 0.020 - wx * 0.013) * 7.0;
    const microSwells = Math.sin(wx * 0.036 - wy * 0.028) * 3.0 + Math.cos(wy * 0.040 + wx * 0.030) * 3.0;
    const naturalBaseHeight = 16.0 + craterDish + macroMounds + mesoKnolls + microSwells;

    // 3. Thawing Glacial Melt-Pool & Basin Stream (confined strictly to lowest southwestern crater basin)
    let riverBed = 0;
    if (wy >= 2050 && wy <= 3150 && wx >= 1050 && wx <= 1550) {
      const riverCenterX = 1300 + Math.sin(wy * 0.0035) * 80 + Math.cos(wy * 0.0018) * 40;
      const riverDist = Math.abs(wx - riverCenterX);
      const riverWidth = 110 + Math.sin(wy * 0.003) * 25;
      if (riverDist < riverWidth) {
        const rt = 1 - riverDist / riverWidth;
        // Natural shallow bowl incision down to water table (Z ~ 4-5)
        riverBed = -9.0 * rt * rt;
      }
    }

    // 4. Middle Combat Plateau (Elevation ~255 units, ~5 player-heights)
    const mpDx = (wx - this.middlePlateauCenter.x + Math.sin(wy * 0.005) * 70);
    const mpDy = (wy - this.middlePlateauCenter.y + Math.cos(wx * 0.005) * 70);
    const mpAngle = Math.atan2(mpDy, mpDx);
    const mpRadius = this.middlePlateauRadius + Math.sin(mpAngle * 3) * 65 + Math.cos(mpAngle * 5) * 35;
    const mpDist = Math.hypot(mpDx, mpDy);
    let middlePlateau = 0;
    if (mpDist < mpRadius + 75) {
      if (mpDist <= mpRadius - 20) {
        middlePlateau = this.middlePlateauElevation;
      } else {
        const t = (mpRadius + 75 - mpDist) / 95;
        const st = t * t * (3 - 2 * t);
        middlePlateau = this.middlePlateauElevation * st;
      }
    }

    // 5. Upper Summit Plateau (Elevation ~615 units, ~12 player-heights)
    const upDx = (wx - this.upperPlateauCenter.x + Math.cos(wy * 0.0055) * 60);
    const upDy = (wy - this.upperPlateauCenter.y + Math.sin(wx * 0.0055) * 60);
    const upAngle = Math.atan2(upDy, upDx);
    const upRadius = this.upperPlateauRadius + Math.sin(upAngle * 4) * 60 + Math.cos(upAngle * 2) * 40;
    const upDist = Math.hypot(upDx, upDy);
    let upperPlateau = 0;
    if (upDist < upRadius + 85) {
      if (upDist <= upRadius - 25) {
        upperPlateau = this.upperPlateauElevation;
      } else {
        const t = (upRadius + 85 - upDist) / 110;
        const st = t * t * (3 - 2 * t);
        upperPlateau = this.upperPlateauElevation * st;
      }
    }

    // 6. Elevated Shortcut: Rocky Spire Promontory (Jump / Jetpack Glide accessible)
    // Located at (1950, 1320), elevation ~420
    const scDx = wx - 1950;
    const scDy = wy - 1320;
    const scDist = Math.hypot(scDx, scDy);
    let shortcutLedge = 0;
    if (scDist < 105) {
      if (scDist <= 45) {
        shortcutLedge = 420;
      } else {
        const t = (105 - scDist) / 60;
        const st = t * t * (3 - 2 * t);
        shortcutLedge = 420 * st;
      }
    }

    // 7. Crash site furrow gouge and raised earthen berms around (1800, 2960) at cliff edge
    let skidTrench = 0;
    let crashBerms = 0;
    if (wy >= 2720 && wy <= 3250) {
      const latDist = Math.abs(wx - 1800);
      const longT = (wy - 2720) / (3250 - 2720);
      const trenchFade = Math.sin(longT * Math.PI); // Smooth envelope along skid track

      // Central gouged furrow
      if (latDist < 75) {
        const tf = 1.0 - (latDist / 75);
        skidTrench = -14.0 * tf * tf * trenchFade;
      }

      // Raised lateral mounds / berms thrown up on both sides of the furrow
      if (latDist >= 55 && latDist <= 175) {
        const bermPeak = Math.sin(((latDist - 55) / 120) * Math.PI);
        crashBerms = 20.0 * bermPeak * trenchFade;
      }
    }

    // 8. Natural enclosing crater rim around outer perimeter
    const distRim = Math.hypot(wx - 1800, wy - 1800);
    let craterRim = 0;
    if (distRim > 1500) {
      const rimT = Math.min(1.0, (distRim - 1500) / 280);
      const rimAng = Math.atan2(wy - 1800, wx - 1800);
      let rimVar = 0.85 + Math.sin(rimAng * 4 + (this.seed % 100)) * 0.20 + Math.cos(rimAng * 2) * 0.15;
      if (wy > 2750 && Math.abs(wx - 1800) < 380) {
        rimVar *= 0.20;
      }
      craterRim = rimT * rimT * 750 * rimVar;
    }

    let h = naturalBaseHeight + riverBed + skidTrench + crashBerms + Math.max(middlePlateau, upperPlateau, shortcutLedge);

    // Smooth starting deck around player spawn (1800, 2480)
    const distSpawn = Math.hypot(wx - 1800, wy - 2480);
    if (distSpawn < 80) {
      if (distSpawn <= 28) {
        h = 16.0;
      } else {
        const st = (distSpawn - 28) / (80 - 28);
        const smoothT = st * st * (3 - 2 * st);
        h = (1 - smoothT) * 16.0 + smoothT * h;
      }
    }

    // 7. Apply Continuous Ramp Carving (Ramps override terrain with smooth climbable roadways)
    // Ramp 1 (Valley -> Middle Plateau)
    {
      const r = this.ramp1;
      const dx = r.x1 - r.x0;
      const dy = r.y1 - r.y0;
      const len2 = dx * dx + dy * dy;
      const u = ((wx - r.x0) * dx + (wy - r.y0) * dy) / len2;
      const projX = r.x0 + u * dx;
      const projY = r.y0 + u * dy;
      const dist = Math.hypot(wx - projX, wy - projY);

      if (u >= -0.08 && u <= 1.08 && dist <= r.blendW) {
        const cu = Math.max(0, Math.min(1, u));
        const targetH = r.h0 + cu * (r.h1 - r.h0);
        let endFade = 1.0;
        if (u < 0) endFade = 1 + u / 0.08;
        else if (u > 1) endFade = 1 - (u - 1) / 0.08;

        let latBlend = 1.0;
        if (dist > r.roadW) {
          const lt = 1 - (dist - r.roadW) / (r.blendW - r.roadW);
          latBlend = lt * lt * (3 - 2 * lt);
        }
        const w = Math.max(0, Math.min(1, endFade * latBlend));
        h = (1 - w) * h + w * targetH;
      }
    }

    // Ramp 2 (Middle Plateau -> Upper Summit)
    {
      const r = this.ramp2;
      const dx = r.x1 - r.x0;
      const dy = r.y1 - r.y0;
      const len2 = dx * dx + dy * dy;
      const u = ((wx - r.x0) * dx + (wy - r.y0) * dy) / len2;
      const projX = r.x0 + u * dx;
      const projY = r.y0 + u * dy;
      const dist = Math.hypot(wx - projX, wy - projY);

      if (u >= -0.08 && u <= 1.08 && dist <= r.blendW) {
        const cu = Math.max(0, Math.min(1, u));
        const targetH = r.h0 + cu * (r.h1 - r.h0);
        let endFade = 1.0;
        if (u < 0) endFade = 1 + u / 0.08;
        else if (u > 1) endFade = 1 - (u - 1) / 0.08;

        let latBlend = 1.0;
        if (dist > r.roadW) {
          const lt = 1 - (dist - r.roadW) / (r.blendW - r.roadW);
          latBlend = lt * lt * (3 - 2 * lt);
        }
        const w = Math.max(0, Math.min(1, endFade * latBlend));
        h = (1 - w) * h + w * targetH;
      }
    }

    // Ramp 3 (Valley -> Western Ridge)
    {
      const r = this.ramp3;
      const dx = r.x1 - r.x0;
      const dy = r.y1 - r.y0;
      const len2 = dx * dx + dy * dy;
      const u = ((wx - r.x0) * dx + (wy - r.y0) * dy) / len2;
      const projX = r.x0 + u * dx;
      const projY = r.y0 + u * dy;
      const dist = Math.hypot(wx - projX, wy - projY);

      if (u >= -0.08 && u <= 1.08 && dist <= r.blendW) {
        const cu = Math.max(0, Math.min(1, u));
        const targetH = r.h0 + cu * (r.h1 - r.h0);
        let endFade = 1.0;
        if (u < 0) endFade = 1 + u / 0.08;
        else if (u > 1) endFade = 1 - (u - 1) / 0.08;

        let latBlend = 1.0;
        if (dist > r.roadW) {
          const lt = 1 - (dist - r.roadW) / (r.blendW - r.roadW);
          latBlend = lt * lt * (3 - 2 * lt);
        }
        const w = Math.max(0, Math.min(1, endFade * latBlend));
        h = (1 - w) * h + w * targetH;
      }
    }

    // Enforce smooth landing deck at player spawn (1800, 2480)
    if (distSpawn < 80) {
      if (distSpawn <= 28) {
        h = 16.0;
      } else {
        const st = (distSpawn - 28) / (80 - 28);
        const smoothT = st * st * (3 - 2 * st);
        h = (1 - smoothT) * 16.0 + smoothT * h;
      }
    }

    return h + boundaryHeight + craterRim;
  }

  /**
   * Fast query for the ground elevation and surface type at (wx, wy)
   */
  public getElevation(wx: number, wy: number, entityZ?: number, stepUpLimit?: number): TerrainSample {
    let baseSample: TerrainSample;
    if (this.meshCollider) {
      const sup: SupportQueryResult = this.meshCollider.querySupport(wx, wy, entityZ ?? 1e6, stepUpLimit ?? 22);
      const st: 'valley' | 'plateau' | 'ramp' | 'chasm' | 'bridge' =
        sup.category === 'bridge' ? 'bridge'
        : sup.category === 'water' ? 'chasm'
        : sup.category === 'tower_ledge' || sup.category === 'ship_walkable' ? 'plateau'
        : 'valley';
      baseSample = {
        height: sup.height,
        surfaceType: st,
        isWalkable: sup.isWalkable && this.isInsidePlayableBounds(wx, wy, 0),
        isInWater: sup.isInWater,
        category: sup.category,
        sourceTag: sup.sourceTag
      };
    } else {
      const height = this.calculateHeight(wx, wy);

      let surfaceType: 'valley' | 'plateau' | 'ramp' | 'chasm' | 'bridge' = 'valley';
      if (height > 400) {
        surfaceType = 'plateau'; // Upper Summit Plateau / Overseer Altar
      } else if (height > 180) {
        surfaceType = 'plateau'; // Middle Combat Plateau
      } else if (height < 6) {
        surfaceType = 'chasm'; // Valley riverbed depression
      } else {
        surfaceType = 'valley'; // Lower Valley floor & foothills
      }

      let isWalkable = height < 750; // Walkable everywhere except insurmountable boundary mountain peaks
      if (this.isCustomTestMap) {
        isWalkable = this.isInsidePlayableBounds(wx, wy, 0);
      }

      baseSample = {
        height,
        surfaceType,
        isWalkable
      };
    }

    // One-way jump-through support for active Dash Event platforms (never blocks ground or underside paths)
    if (this.activeDashPlatforms.length > 0 && entityZ !== undefined && entityZ < 1e5) {
      let bestPlatZ = baseSample.height;
      let hitPlatform = false;
      for (let i = 0; i < this.activeDashPlatforms.length; i++) {
        const plat = this.activeDashPlatforms[i];
        if (plat.z <= bestPlatZ) continue;
        if (entityZ >= plat.z - 16 && Math.hypot(wx - plat.x, wy - plat.y) <= plat.radius) {
          bestPlatZ = plat.z;
          hitPlatform = true;
        }
      }
      if (hitPlatform) {
        return {
          height: bestPlatZ,
          surfaceType: 'bridge',
          isWalkable: true,
          isInWater: false,
          category: 'bridge',
          sourceTag: 'event:dash_platform'
        };
      }
    }

    return baseSample;
  }

  /**
   * Projects a point onto a ramp segment and returns the projection scalar u along the centerline
   * and lateral distance to the centerline.
   */
  public getRampU(ramp: { x0: number; y0: number; x1: number; y1: number }, pos: Vector2): { u: number; dist: number } {
    const dx = ramp.x1 - ramp.x0;
    const dy = ramp.y1 - ramp.y0;
    const len2 = dx * dx + dy * dy;
    const u = ((pos.x - ramp.x0) * dx + (pos.y - ramp.y0) * dy) / len2;
    const projX = ramp.x0 + u * dx;
    const projY = ramp.y0 + u * dy;
    const dist = Math.hypot(pos.x - projX, pos.y - projY);
    return { u, dist };
  }

  /**
   * Checks whether a ground path between from and to is directly walkable without scaling steep cliffs.
   */
  public isDirectlyTraversable(from: Vector2, to: Vector2, isAirborne: boolean = false): boolean {
    if (this.meshCollider) {
      return this.meshCollider.isDirectlyTraversable(from, to, isAirborne);
    }
    if (this.isCustomTestMap) {
      if (!this.isInsidePlayableBounds(from.x, from.y, 0) || !this.isInsidePlayableBounds(to.x, to.y, 0)) {
        return false;
      }
    }
    if (isAirborne) return true;
    const dx = to.x - from.x;
    const dy = to.y - from.y;
    const dist = Math.hypot(dx, dy);
    if (dist < 15) return true;

    const fromH = this.calculateHeight(from.x, from.y);
    const toH = this.calculateHeight(to.x, to.y);
    if (!this.isCustomTestMap && (fromH > 750 || toH > 750)) return false; // Insurmountable boundary peaks

    // Fast check: if overall slope between endpoints exceeds walkable limit, cannot traverse
    const overallSlope = Math.abs(toH - fromH) / dist;
    if (overallSlope > 0.50) return false;

    // Fast check for short-to-medium distance paths on similar elevation (common valley/plateau roaming)
    if (dist < 200 && Math.abs(toH - fromH) < 24) {
      const midH = this.calculateHeight(from.x + dx * 0.5, from.y + dy * 0.5);
      if (Math.abs(midH - fromH) < 28 && (this.isCustomTestMap || midH < 750)) {
        return true;
      }
    }

    const steps = Math.min(16, Math.max(2, Math.ceil(dist / 32)));
    let prevH = fromH;

    for (let i = 1; i <= steps; i++) {
      const t = i / steps;
      const sx = from.x + dx * t;
      const sy = from.y + dy * t;
      const curH = this.calculateHeight(sx, sy);
      if (!this.isCustomTestMap && curH > 750) return false;

      const stepDist = dist / steps;
      const slope = Math.abs(curH - prevH) / stepDist;
      if (slope > 0.50) {
        return false; // Sheer cliff blocks walking
      }
      prevH = curH;
    }
    return true;
  }

  /**
   * True 3D Line-of-Sight query through world geometry.
   * Tests whether the 3D ray segment between 'from' and 'to' passes through solid mountains or cliffs.
   */
  public checkLineOfSight3D(
    from: { x: number; y: number; z: number },
    to: { x: number; y: number; z: number }
  ): boolean {
    if (this.meshCollider) {
      return !this.meshCollider.raycast3D(from, to, true).hit;
    }
    const dx = to.x - from.x;
    const dy = to.y - from.y;
    const dz = to.z - from.z;
    const dist3D = Math.hypot(dx, dy, dz);
    if (dist3D < 12) return true;

    // Fast height bounds check: if both endpoints are well above peak mountain, line of sight is clear
    if (from.z > 720 && to.z > 720) return true;

    const steps = Math.min(18, Math.max(3, Math.ceil(dist3D / 28)));
    for (let i = 1; i < steps; i++) {
      const t = i / steps;
      const sx = from.x + dx * t;
      const sy = from.y + dy * t;
      const sz = from.z + dz * t;
      const terrainH = this.calculateHeight(sx, sy);
      if (sz <= terrainH - 1.5) {
        return false; // 3D ray passes inside solid terrain/cliff face
      }
    }
    return true;
  }

  /**
   * Calculates the maximum local gradient/slope in any direction around (x, y).
   */
  public getSurfaceSlope(x: number, y: number, sampleDist: number = 22): number {
    const centerH = this.calculateHeight(x, y);
    const hN = this.calculateHeight(x, y - sampleDist);
    const hS = this.calculateHeight(x, y + sampleDist);
    const hW = this.calculateHeight(x - sampleDist, y);
    const hE = this.calculateHeight(x + sampleDist, y);

    const slopeX = Math.max(Math.abs(hE - centerH), Math.abs(hW - centerH)) / sampleDist;
    const slopeY = Math.max(Math.abs(hS - centerH), Math.abs(hN - centerH)) / sampleDist;
    return Math.max(slopeX, slopeY);
  }

  /**
   * Validates whether a location is sufficiently flat, accessible, and safe for event/chest spawning.
   * - Must not be on a steep slope (slope <= 0.25)
   * - Must not be inside high boundary mountain walls (height < 680)
   * - Must not be submerged in deep riverbed (height > 6)
   * - Must have adequate clearance from steep cliffs
   */
  public isValidEventSpawn(x: number, y: number, clearance: number = 45): boolean {
    const pad = 140;
    if (x < pad || x > this.worldWidth - pad || y < pad || y > this.worldHeight - pad) {
      return false;
    }

    const centerH = this.calculateHeight(x, y);
    if (centerH < 6 || centerH > 680) {
      return false; // Waterbed or boundary mountain peak
    }

    // Check center slope (must be walkable terrain with slope <= 0.25)
    if (this.getSurfaceSlope(x, y, 20) > 0.25) {
      return false;
    }

    // Check surrounding clearance perimeter for steep drop-offs or cliff faces
    const angles = [0, Math.PI * 0.5, Math.PI, Math.PI * 1.5];
    for (let i = 0; i < angles.length; i++) {
      const cx = x + Math.cos(angles[i]) * clearance;
      const cy = y + Math.sin(angles[i]) * clearance;
      const ch = this.calculateHeight(cx, cy);
      if (Math.abs(ch - centerH) > clearance * 0.40) {
        return false; // Too close to cliff edge or steep drop-off
      }
    }

    return true;
  }

  public isSegmentClearForNav(
    from: Vector2,
    to: Vector2,
    sampleStep: number = 24,
    allowDownhill: boolean = false,
    valleyCeiling: number = 125
  ): boolean {
    const dx = to.x - from.x;
    const dy = to.y - from.y;
    const dist = Math.hypot(dx, dy);
    if (dist < 16) return true;

    const fromH = this.calculateHeight(from.x, from.y);
    const toH = this.calculateHeight(to.x, to.y);
    if (fromH > 720 || toH > 720) return false;

    const bothValley = !allowDownhill && fromH < 115 && toH < 115;
    const bothPlateau = !allowDownhill && Math.min(fromH, toH) >= 180 && Math.abs(fromH - toH) < 75;
    const minH = Math.min(fromH, toH);
    const maxH = Math.max(fromH, toH);

    const steps = Math.min(64, Math.max(2, Math.ceil(dist / sampleStep)));
    const stepLen = dist / steps;
    let prevH = fromH;
    for (let i = 1; i <= steps; i++) {
      const t = i / steps;
      const sx = from.x + dx * t;
      const sy = from.y + dy * t;
      const curH = this.calculateHeight(sx, sy);
      if (curH > 720) return false;
      if (bothValley && curH > valleyCeiling) return false;
      if (bothPlateau && (curH < minH - 65 || curH > maxH + 85)) return false;
      const dh = allowDownhill ? (curH - prevH) : Math.abs(curH - prevH);
      if (dh / stepLen > 0.72) return false;
      if (allowDownhill && curH > maxH + 28) return false;
      prevH = curH;
    }
    return true;
  }

  public updateNavNodes(): void {
    const mp = this.middlePlateauCenter;
    const up = this.upperPlateauCenter;
    const r1 = this.ramp1;
    const r2 = this.ramp2;
    const r3 = this.ramp3;
    const mpR = this.middlePlateauRadius + 215;
    const upR = this.upperPlateauRadius + 205;
    const clampX = (x: number) => Math.max(120, Math.min(this.worldWidth - 120, x));
    const clampY = (y: number) => Math.max(120, Math.min(this.worldHeight - 120, y));

    const findSkirtPos = (cx: number, cy: number, radius: number, ux: number, uy: number): Vector2 | null => {
      for (let extra = 0; extra <= 210; extra += 70) {
        const px = clampX(cx + ux * (radius + extra));
        const py = clampY(cy + uy * (radius + extra));
        const h = this.calculateHeight(px, py);
        if (h < 82 && this.getSurfaceSlope(px, py, 16) < 0.38) {
          return { x: px, y: py };
        }
      }
      const fallbackX = clampX(cx + ux * radius);
      const fallbackY = clampY(cy + uy * radius);
      return this.calculateHeight(fallbackX, fallbackY) < 130 ? { x: fallbackX, y: fallbackY } : null;
    };

    const diag = Math.SQRT1_2;

    this.navNodes = {
      // 1. Valley Floor Network (Tier 1)
      valley_south: { id: 'valley_south', pos: { x: 1800, y: 3100 }, tier: 1, neighbors: ['valley_center', 'valley_southeast', 'valley_west_river', 'valley_southwest'] },
      valley_southwest: { id: 'valley_southwest', pos: { x: 1200, y: 3100 }, tier: 1, neighbors: ['valley_south', 'valley_west', 'valley_wsw'] },
      valley_center: { id: 'valley_center', pos: { x: 1800, y: 2550 }, tier: 1, neighbors: ['valley_south', 'ramp1_bottom', 'valley_west_river', 'valley_southeast'] },
      valley_southeast: { id: 'valley_southeast', pos: { x: 2700, y: 2700 }, tier: 1, neighbors: ['valley_south', 'valley_center', 'valley_east', 'mp_skirt_south', 'mp_skirt_se'] },
      valley_east: { id: 'valley_east', pos: { x: 3100, y: 1900 }, tier: 1, neighbors: ['valley_southeast', 'valley_northeast'] },
      valley_northeast: { id: 'valley_northeast', pos: { x: 2900, y: 1000 }, tier: 1, neighbors: ['valley_east', 'valley_north'] },
      valley_north: { id: 'valley_north', pos: { x: 2200, y: 700 }, tier: 1, neighbors: ['valley_northeast', 'valley_north_mid', 'valley_northwest'] },
      valley_north_mid: { id: 'valley_north_mid', pos: { x: 1820, y: 520 }, tier: 1, neighbors: ['valley_north', 'valley_northwest'] },
      valley_northwest: { id: 'valley_northwest', pos: { x: 1500, y: 550 }, tier: 1, neighbors: ['valley_north_mid', 'valley_north', 'valley_wnw'] },
      valley_wnw: { id: 'valley_wnw', pos: { x: 650, y: 800 }, tier: 1, neighbors: ['valley_northwest', 'valley_wmid'] },
      valley_wmid: { id: 'valley_wmid', pos: { x: 550, y: 1800 }, tier: 1, neighbors: ['valley_wnw', 'valley_wsw'] },
      valley_wsw: { id: 'valley_wsw', pos: { x: 650, y: 2700 }, tier: 1, neighbors: ['valley_wmid', 'valley_west', 'valley_southwest'] },
      valley_west_river: { id: 'valley_west_river', pos: { x: 1450, y: 2500 }, tier: 1, neighbors: ['valley_south', 'valley_center', 'valley_west', 'ramp3_bottom'] },
      valley_west: { id: 'valley_west', pos: { x: 1100, y: 2500 }, tier: 1, neighbors: ['valley_west_river', 'ramp3_bottom', 'valley_southwest', 'valley_wsw'] },

      // 2. Ramp 1: Valley <-> Middle Plateau
      ramp1_bottom: { id: 'ramp1_bottom', pos: { x: r1.x0, y: r1.y0 }, tier: 1, neighbors: ['valley_center', 'mp_skirt_sw', 'mp_skirt_west', 'ramp1_mid'] },
      ramp1_mid: { id: 'ramp1_mid', pos: { x: (r1.x0 + r1.x1) * 0.5, y: (r1.y0 + r1.y1) * 0.5 }, tier: 1.5, neighbors: ['ramp1_bottom', 'ramp1_top'] },
      ramp1_top: { id: 'ramp1_top', pos: { x: r1.x1, y: r1.y1 }, tier: 2, neighbors: ['ramp1_mid', 'middle_center', 'middle_south', 'middle_east', 'middle_west'] },

      // 3. Middle Combat Plateau (Tier 2)
      middle_center: { id: 'middle_center', pos: { x: mp.x, y: mp.y }, tier: 2, neighbors: ['ramp1_top', 'middle_north', 'middle_south', 'middle_east', 'middle_west', 'middle_northwest'] },
      middle_north: { id: 'middle_north', pos: { x: r2.x0, y: r2.y0 }, tier: 2, neighbors: ['middle_center', 'ramp2_mid', 'middle_northwest'] },
      middle_south: { id: 'middle_south', pos: { x: mp.x, y: mp.y + this.middlePlateauRadius * 0.45 }, tier: 2, neighbors: ['middle_center', 'ramp1_top', 'middle_east', 'middle_west'] },
      middle_east: { id: 'middle_east', pos: { x: mp.x + this.middlePlateauRadius * 0.45, y: mp.y }, tier: 2, neighbors: ['middle_center', 'ramp1_top', 'middle_south'] },
      middle_west: { id: 'middle_west', pos: { x: mp.x - this.middlePlateauRadius * 0.42, y: mp.y }, tier: 2, neighbors: ['middle_center', 'ramp1_top', 'middle_south', 'middle_northwest'] },
      middle_northwest: { id: 'middle_northwest', pos: { x: mp.x - this.middlePlateauRadius * 0.35, y: mp.y - this.middlePlateauRadius * 0.35 }, tier: 2, neighbors: ['middle_center', 'middle_north', 'middle_west'] },

      // 4. Ramp 2: Middle Plateau <-> Upper Summit
      ramp2_mid: { id: 'ramp2_mid', pos: { x: (r2.x0 + r2.x1) * 0.5, y: (r2.y0 + r2.y1) * 0.5 }, tier: 2.5, neighbors: ['middle_north', 'ramp2_top'] },
      ramp2_top: { id: 'ramp2_top', pos: { x: r2.x1, y: r2.y1 }, tier: 3, neighbors: ['ramp2_mid', 'summit_center', 'summit_east', 'summit_south', 'summit_north', 'summit_west'] },

      // 5. Upper Summit Plateau (Tier 3)
      summit_center: { id: 'summit_center', pos: { x: up.x, y: up.y }, tier: 3, neighbors: ['ramp2_top', 'summit_south', 'summit_east', 'summit_west', 'summit_north'] },
      summit_south: { id: 'summit_south', pos: { x: up.x, y: up.y + this.upperPlateauRadius * 0.45 }, tier: 3, neighbors: ['summit_center', 'ramp2_top', 'summit_east', 'summit_west'] },
      summit_north: { id: 'summit_north', pos: { x: up.x, y: up.y - this.upperPlateauRadius * 0.45 }, tier: 3, neighbors: ['summit_center', 'summit_east', 'summit_west'] },
      summit_east: { id: 'summit_east', pos: { x: up.x + this.upperPlateauRadius * 0.45, y: up.y }, tier: 3, neighbors: ['summit_center', 'ramp2_top', 'summit_north', 'summit_south'] },
      summit_west: { id: 'summit_west', pos: { x: up.x - this.upperPlateauRadius * 0.45, y: up.y }, tier: 3, neighbors: ['summit_center', 'ramp2_top', 'summit_north', 'summit_south'] },

      // 6. Ramp 3: Valley <-> Western Ridge
      ramp3_bottom: { id: 'ramp3_bottom', pos: { x: r3.x0, y: r3.y0 }, tier: 1, neighbors: ['valley_west_river', 'valley_west', 'ramp3_mid'] },
      ramp3_mid: { id: 'ramp3_mid', pos: { x: (r3.x0 + r3.x1) * 0.5, y: (r3.y0 + r3.y1) * 0.5 }, tier: 1.5, neighbors: ['ramp3_bottom', 'ramp3_top'] },
      ramp3_top: { id: 'ramp3_top', pos: { x: r3.x1, y: r3.y1 }, tier: 2, neighbors: ['ramp3_mid', 'ridge_center', 'ridge_north', 'ridge_south'] },

      // 7. Western Ridge (Tier 2)
      ridge_center: { id: 'ridge_center', pos: { x: r3.x1, y: r3.y1 }, tier: 2, neighbors: ['ramp3_top', 'ridge_north', 'ridge_south'] },
      ridge_north: { id: 'ridge_north', pos: { x: 1050, y: 1600 }, tier: 2, neighbors: ['ridge_center'] },
      ridge_south: { id: 'ridge_south', pos: { x: 1050, y: 2300 }, tier: 2, neighbors: ['ridge_center'] }
    };

    // 8. Octagonal Valley Skirt Rings around Middle Plateau & Upper Summit (cliff-clear!)
    const mpRingSpecs: [string, number, number, string[]][] = [
      ['mp_skirt_north', 0, -1, ['valley_north', 'valley_northeast']],
      ['mp_skirt_ne', diag, -diag, ['valley_northeast', 'valley_north']],
      ['mp_skirt_east', 1, 0, ['valley_east']],
      ['mp_skirt_se', diag, diag, ['valley_southeast', 'valley_east']],
      ['mp_skirt_south', 0, 1, ['valley_southeast', 'valley_south', 'valley_center']],
      ['mp_skirt_sw', -diag, diag, ['ramp1_bottom', 'valley_center']],
      ['mp_skirt_west', -1, 0, ['valley_center', 'valley_west_river', 'ramp1_bottom']]
    ];
    const validMpRing: string[] = [];
    for (const [id, ux, uy, links] of mpRingSpecs) {
      const pos = findSkirtPos(mp.x, mp.y, mpR, ux, uy);
      if (pos) {
        this.navNodes[id] = { id, pos, tier: 1, neighbors: [...links] };
        validMpRing.push(id);
      }
    }
    for (let i = 0; i < validMpRing.length - 1; i++) {
      this.navNodes[validMpRing[i]].neighbors.push(validMpRing[i + 1]);
    }

    const upRingSpecs: [string, number, number, string[]][] = [
      ['up_skirt_east', 1, 0, ['valley_north', 'valley_northeast', 'mp_skirt_north']],
      ['up_skirt_ne', diag, -diag, ['valley_north', 'valley_north_mid']],
      ['up_skirt_north', 0, -1, ['valley_north_mid', 'valley_northwest']],
      ['up_skirt_nw', -diag, -diag, ['valley_northwest', 'valley_wnw']],
      ['up_skirt_west', -1, 0, ['valley_wnw', 'valley_wmid']],
      ['up_skirt_sw', -diag, diag, ['valley_wmid', 'valley_west', 'valley_west_river']],
      ['up_skirt_south', 0, 1, ['valley_west_river', 'valley_center', 'mp_skirt_west']]
    ];
    const validUpRing: string[] = [];
    for (const [id, ux, uy, links] of upRingSpecs) {
      const pos = findSkirtPos(up.x, up.y, upR, ux, uy);
      if (pos) {
        this.navNodes[id] = { id, pos, tier: 1, neighbors: [...links] };
        validUpRing.push(id);
      }
    }
    for (let i = 0; i < validUpRing.length - 1; i++) {
      this.navNodes[validUpRing[i]].neighbors.push(validUpRing[i + 1]);
    }

    // Calculate node heights and guarantee clean reciprocal graph edge connections
    for (const [id, node] of Object.entries(this.navNodes)) {
      node.height = this.calculateHeight(node.pos.x, node.pos.y);
      for (let i = 0; i < node.neighbors.length; i++) {
        const nId = node.neighbors[i];
        const target = this.navNodes[nId];
        if (!target) continue;
        // Prune cliff-crossing chords between flat non-ramp nodes on the same elevation tier
        // (using stricter 110 valley ceiling on graph edges so live 125 string-pulling retains safety margin)
        if (!id.startsWith('ramp') && !nId.startsWith('ramp') && node.tier === target.tier) {
          if (!this.isSegmentClearForNav(node.pos, target.pos, 20, false, 110)) {
            continue;
          }
        }
        if (!target.neighbors.includes(id)) {
          target.neighbors.push(id);
        }
      }
      node.neighbors = node.neighbors.filter((nId) => {
        const target = this.navNodes[nId];
        if (!target) return false;
        if (!id.startsWith('ramp') && !nId.startsWith('ramp') && node.tier === target.tier) {
          return this.isSegmentClearForNav(node.pos, target.pos, 20, false, 110);
        }
        return true;
      });
    }
  }

  /**
   * Finds shortest path of waypoints between two graph nodes using A*.
   * Returns empty array if unreachable.
   */
  public findGraphPath(startNodeId: string, goalNodeId: string): { path: Vector2[]; nodeIds: string[]; found: boolean } {
    if (startNodeId === goalNodeId) {
      const node = this.navNodes[goalNodeId];
      return { path: node ? [{ ...node.pos }] : [], nodeIds: node ? [goalNodeId] : [], found: true };
    }
    const frontier: { id: string; cost: number; priority: number }[] = [];
    frontier.push({ id: startNodeId, cost: 0, priority: 0 });
    const cameFrom: Record<string, string | null> = { [startNodeId]: null };
    const costSoFar: Record<string, number> = { [startNodeId]: 0 };

    const goalPos = this.navNodes[goalNodeId]?.pos;
    if (!goalPos) return { path: [], nodeIds: [], found: false };

    while (frontier.length > 0) {
      frontier.sort((a, b) => a.priority - b.priority);
      const current = frontier.shift()!.id;
      if (current === goalNodeId) break;

      const neighbors = this.navNodes[current]?.neighbors || [];
      for (let i = 0; i < neighbors.length; i++) {
        const nextId = neighbors[i];
        const nextNode = this.navNodes[nextId];
        if (!nextNode) continue;
        const curPos = this.navNodes[current].pos;
        const nxtPos = nextNode.pos;
        const stepCost = Math.hypot(nxtPos.x - curPos.x, nxtPos.y - curPos.y);
        const newCost = costSoFar[current] + stepCost;

        if (costSoFar[nextId] === undefined || newCost < costSoFar[nextId]) {
          costSoFar[nextId] = newCost;
          const h = Math.hypot(goalPos.x - nxtPos.x, goalPos.y - nxtPos.y);
          frontier.push({ id: nextId, cost: newCost, priority: newCost + h });
          cameFrom[nextId] = current;
        }
      }
    }

    if (!cameFrom[goalNodeId]) {
      return { path: [], nodeIds: [], found: false };
    }

    const path: Vector2[] = [];
    const nodeIds: string[] = [];
    let curr: string | null = goalNodeId;
    while (curr) {
      path.unshift({ ...this.navNodes[curr].pos });
      nodeIds.unshift(curr);
      curr = cameFrom[curr];
    }
    return { path, nodeIds, found: true };
  }

  /**
   * Finds the closest navigation node that is directly traversable from pos,
   * prioritizing nodes on the matching elevation tier.
   */
  public getClosestTraversableNodeInfo(pos: Vector2, maxCandidates: number = 14): { id: string; directlyTraversable: boolean } {
    const posH = this.calculateHeight(pos.x, pos.y);
    const posTier = posH < 120 ? 1 : posH < 420 ? 2 : 3;

    const candidates: { id: string; dist2D: number; tierDiff: number; score: number }[] = [];
    for (const [id, node] of Object.entries(this.navNodes)) {
      const d = Math.hypot(node.pos.x - pos.x, node.pos.y - pos.y);
      const tierDiff = Math.abs((node.tier || 1) - posTier);
      const hDiff = Math.abs((node.height || 0) - posH);
      const score = d + (tierDiff > 0.6 ? 2500 : 0) + hDiff * 2.5;
      candidates.push({ id, dist2D: d, tierDiff, score });
    }
    candidates.sort((a, b) => a.score - b.score);

    for (let i = 0; i < Math.min(maxCandidates, candidates.length); i++) {
      const cand = candidates[i];
      if (this.isSegmentClearForNav(pos, this.navNodes[cand.id].pos)) {
        return { id: cand.id, directlyTraversable: true };
      }
    }

    // Cliff/slope escape: when no same-tier node is clear (e.g. enemy on a plateau outer cliff wall),
    // search all nodes by pure 2D distance (ignoring tier penalty) allowing downhill descent to skirt/ramp bases.
    const byDist = [...candidates].sort((a, b) => a.dist2D - b.dist2D);
    for (let i = 0; i < Math.min(20, byDist.length); i++) {
      const cand = byDist[i];
      const node = this.navNodes[cand.id];
      const nodeH = node.height ?? this.calculateHeight(node.pos.x, node.pos.y);
      if (nodeH <= posH + 18 && this.isSegmentClearForNav(pos, node.pos, 24, true)) {
        return { id: cand.id, directlyTraversable: true };
      }
    }
    for (let i = 0; i < Math.min(20, byDist.length); i++) {
      const cand = byDist[i];
      if (this.isSegmentClearForNav(pos, this.navNodes[cand.id].pos, 24, true)) {
        return { id: cand.id, directlyTraversable: true };
      }
    }

    const fallbackId = byDist[0]?.id || 'valley_center';
    return { id: fallbackId, directlyTraversable: false };
  }

  public getClosestTraversableNode(pos: Vector2): string {
    return this.getClosestTraversableNodeInfo(pos).id;
  }

  /**
   * Computes tactical standoff / containment position for enemies when the target is on unreachable terrain.
   * Pulls enemies back from the sheer cliff face to a vantage perimeter (160-220 units) with line of sight.
   */
  public getUnreachableStandoff(fromPos: Vector2, targetPos: Vector2): NavWaypointResult {
    const dx = fromPos.x - targetPos.x;
    const dy = fromPos.y - targetPos.y;
    const dist = Math.hypot(dx, dy) || 1;
    const dirX = dx / dist;
    const dirY = dy / dist;

    // Tactical standoff distance: 160-220 units back from cliff base in open terrain
    const desiredDist = 180;
    const isAtStandoff = dist >= 140 && dist <= 280;

    let standoffX = targetPos.x + dirX * desiredDist;
    let standoffY = targetPos.y + dirY * desiredDist;

    standoffX = Math.max(80, Math.min(this.worldWidth - 80, standoffX));
    standoffY = Math.max(80, Math.min(this.worldHeight - 80, standoffY));

    return {
      waypoint: { x: standoffX, y: standoffY },
      isReachable: false,
      isAtStandoff,
      status: isAtStandoff ? 'unreachable_standoff' : 'unreachable_patrol',
      standoffPos: { x: standoffX, y: standoffY }
    };
  }

  /**
   * Comprehensive terrain-aware waypoint calculation:
   * - Flying enemies head directly to target in 3D.
   * - If on same tier & directly walkable, head directly toward target.
   * - If on elevated terrain or across cliffs, routes via A* waypoint network through accessible ramps and passes.
   * - If target is inaccessible / unreachable, transitions to tactical standoff perimeter with line-of-sight.
   */
  public getNavWaypointInfo(
    fromPos: Vector2,
    targetPos: Vector2,
    isAirborne: boolean = false,
    fromZ?: number,
    toZ?: number
  ): NavWaypointResult {
    if (this.meshCollider) {
      return this.meshCollider.findNextNavWaypoint(fromPos, targetPos, fromZ, toZ, isAirborne);
    }
    if (isAirborne) {
      return {
        waypoint: targetPos,
        isReachable: true,
        isAtStandoff: false,
        status: 'direct'
      };
    }

    const fromH = this.calculateHeight(fromPos.x, fromPos.y);
    const targetH = this.calculateHeight(targetPos.x, targetPos.y);
    const heightDiff = Math.abs(targetH - fromH);

    // 1. Direct walk check: If terrain between enemy and target has no steep cliffs or large height difference
    if (heightDiff < 28 && this.isSegmentClearForNav(fromPos, targetPos)) {
      return {
        waypoint: targetPos,
        isReachable: true,
        isAtStandoff: false,
        status: 'direct'
      };
    }

    // 2. Check if target itself is on an insurmountable perimeter alpine peak
    if (targetH > 720) {
      return this.getUnreachableStandoff(fromPos, targetPos);
    }

    // 3. Find navigation nodes for start and target
    const startNodeRes = this.getClosestTraversableNodeInfo(fromPos);
    const goalNodeRes = this.getClosestTraversableNodeInfo(targetPos);

    // Only enter standoff if target is genuinely isolated on an unreachable cliff spike with high slope
    const targetSlope = this.getSurfaceSlope(targetPos.x, targetPos.y, 16);
    if (!goalNodeRes.directlyTraversable && targetSlope > 0.68 && heightDiff > 60) {
      return this.getUnreachableStandoff(fromPos, targetPos);
    }

    // 4. Find path in graph (always route along ramp graph when target is on playable terrain)
    const pathRes = this.findGraphPath(startNodeRes.id, goalNodeRes.id);
    if (!pathRes.found || pathRes.path.length === 0) {
      return this.getUnreachableStandoff(fromPos, targetPos);
    }

    // Path found! Advance forward along waypoints without backtracking to startNode
    const path = pathRes.path;
    const nodeIds = pathRes.nodeIds;
    let targetIdx = 0;
    while (targetIdx < path.length - 1) {
      const cur = path[targetIdx];
      const curId = nodeIds[targetIdx] || '';
      const nxt = path[targetIdx + 1];
      const nxtId = nodeIds[targetIdx + 1] || '';
      const distToCur = Math.hypot(cur.x - fromPos.x, cur.y - fromPos.y);

      // Preserve explicit entry onto narrow ramp mouths/mids unless already aligned past cur along the ramp
      const isRampStep = curId.startsWith('ramp') || nxtId.includes('_mid') || nxtId.includes('_top');
      if (isRampStep) {
        if (distToCur <= 34) {
          targetIdx++;
          continue;
        }
        const segDx = nxt.x - cur.x;
        const segDy = nxt.y - cur.y;
        const segLen = Math.hypot(segDx, segDy) || 1;
        const along = ((fromPos.x - cur.x) * segDx + (fromPos.y - cur.y) * segDy) / segLen;
        const perp = Math.abs((fromPos.x - cur.x) * (-segDy / segLen) + (fromPos.y - cur.y) * (segDx / segLen));
        const nxtH = this.calculateHeight(nxt.x, nxt.y);
        if (along > 12 && perp < 45 && Math.abs(nxtH - fromH) < 150 && this.isSegmentClearForNav(fromPos, nxt, 16)) {
          targetIdx++;
          continue;
        }
        break;
      }

      const nxtH = this.calculateHeight(nxt.x, nxt.y);
      if (distToCur <= 34 || (Math.abs(nxtH - fromH) < 55 && this.isSegmentClearForNav(fromPos, nxt))) {
        targetIdx++;
        continue;
      }
      break;
    }

    if (targetIdx === path.length - 1) {
      const finalWp = path[targetIdx];
      const distToFinal = Math.hypot(finalWp.x - fromPos.x, finalWp.y - fromPos.y);
      if ((distToFinal <= 34 || heightDiff < 42) && this.isSegmentClearForNav(fromPos, targetPos)) {
        return {
          waypoint: targetPos,
          isReachable: true,
          isAtStandoff: false,
          status: 'direct'
        };
      }
    }

    return {
      waypoint: path[targetIdx],
      isReachable: true,
      isAtStandoff: false,
      status: 'pathfinding'
    };
  }

  public getNextNavWaypoint(fromPos: Vector2, targetPos: Vector2, isAirborne: boolean = false): Vector2 {
    return this.getNavWaypointInfo(fromPos, targetPos, isAirborne).waypoint;
  }

  /**
   * Fast finite-difference terrain slope gradient calculation.
   * Returns horizontal gradient vector and steepness magnitude.
   */
  public getSlopeGradient(wx: number, wy: number): { gx: number; gy: number; slope: number } {
    const eps = 4.0;
    const hL = this.calculateHeight(wx - eps, wy);
    const hR = this.calculateHeight(wx + eps, wy);
    const hD = this.calculateHeight(wx, wy - eps);
    const hU = this.calculateHeight(wx, wy + eps);
    const gx = (hR - hL) / (2 * eps);
    const gy = (hU - hD) / (2 * eps);
    const slope = Math.hypot(gx, gy);
    return { gx, gy, slope };
  }

  /**
   * Samples center + perimeter offsets around a collider circle to find the
   * highest terrain point touching its footprint (including a +4 unit cliff margin).
   */
  public sampleColliderMaxHeight(
    cx: number,
    cy: number,
    radius: number,
    dirX: number = 0,
    dirY: number = 1
  ): { maxH: number; maxX: number; maxY: number } {
    const dLen = Math.hypot(dirX, dirY);
    const ux = dLen > 0.001 ? dirX / dLen : 0;
    const uy = dLen > 0.001 ? dirY / dLen : 1;
    const lx = -uy;
    const ly = ux;
    const r = radius + 4;
    const diag = r * 0.7071;

    let maxH = this.calculateHeight(cx, cy);
    let maxX = cx;
    let maxY = cy;

    // Forward, forward-left, forward-right, and +/- lateral perimeter probes
    const offsetsX = [
      ux * r,
      ux * diag + lx * diag,
      ux * diag - lx * diag,
      lx * r,
      -lx * r
    ];
    const offsetsY = [
      uy * r,
      uy * diag + ly * diag,
      uy * diag - ly * diag,
      ly * r,
      -ly * r
    ];

    for (let i = 0; i < 5; i++) {
      const px = cx + offsetsX[i];
      const py = cy + offsetsY[i];
      const ph = this.calculateHeight(px, py);
      if (ph > maxH) {
        maxH = ph;
        maxX = px;
        maxY = py;
      }
    }

    return { maxH, maxX, maxY };
  }

  /**
   * Pushes an entity position downhill if obstacle/crowd separation shoved it
   * into an impassable steep cliff or above step-up limits.
   */
  public pushOutOfSteepTerrain(pos: Vector2, z: number, radius: number): boolean {
    if (this.meshCollider) {
      this.meshCollider.pushOutOfWalls(pos, z, radius, 90, this.getStepUpLimitAt(pos.x, pos.y));
      return true;
    }
    const inTowerZone = this.isInTowerStepZone(pos.x, pos.y);
    const maxWalkSlope = this.isCustomTestMap ? 1.05 : 0.84;
    const effectiveRadius = inTowerZone ? Math.min(radius, 6) : radius;
    let moved = false;

    for (let iter = 0; iter < 3; iter++) {
      const centerH = this.calculateHeight(pos.x, pos.y);
      const stepUpLimit = this.getStepUpLimitAt(pos.x, pos.y, centerH);
      if (inTowerZone && centerH <= z + stepUpLimit) {
        // On a valid tower spiral step tread, never push player sideways off the narrow outer lip due to adjacent spire walls
        break;
      }

      const probe = this.sampleColliderMaxHeight(pos.x, pos.y, effectiveRadius);
      const hitX = probe.maxH > centerH ? probe.maxX : pos.x;
      const hitY = probe.maxH > centerH ? probe.maxY : pos.y;
      const highestH = Math.max(centerH, probe.maxH);

      if (highestH <= z + this.getStepUpLimitAt(hitX, hitY, highestH)) break;

      const grad = this.getSlopeGradient(hitX, hitY);
      if (centerH <= z + stepUpLimit && grad.slope <= maxWalkSlope) break;

      const gLen = Math.hypot(grad.gx, grad.gy);
      if (gLen <= 0.001) break;

      const step = Math.min(18, Math.max(6, radius * 0.55));
      const clamped = this.clampToPlayableBounds(
        { x: pos.x - (grad.gx / gLen) * step, y: pos.y - (grad.gy / gLen) * step },
        30
      );
      pos.x = clamped.pos.x;
      pos.y = clamped.pos.y;
      moved = true;
    }

    return moved;
  }

  /**
   * Swept 3D terrain traversability and collision resolution.
   * Performs continuous swept checks along the movement trajectory with multi-point perimeter probes.
   * Prevents tunneling, diagonal ledge clipping, stepping through sheer cliff walls, and passing through solid rock.
   */
  public checkTraversable(
    from: Vector2,
    to: Vector2,
    currentZ: number,
    isAirborne: boolean,
    colliderRadius: number = 18
  ): { allowed: boolean; newPos: Vector2; blockedByCliff: boolean; surfaceNormal: Vector2 } {
    if (this.meshCollider) {
      const dx = to.x - from.x;
      const dy = to.y - from.y;
      const dist = Math.hypot(dx, dy);
      if (dist < 0.0001) {
        return { allowed: true, newPos: to, blockedByCliff: false, surfaceNormal: { x: 0, y: 0 } };
      }
      const numSteps = Math.max(1, Math.ceil(dist / 10));
      let curPos = { x: from.x, y: from.y };
      const stepLimit = isAirborne ? 56 : this.getStepUpLimitAt(from.x, from.y);
      for (let s = 1; s <= numSteps; s++) {
        const t = s / numSteps;
        const nextPt = { x: from.x + dx * t, y: from.y + dy * t };
        const res = this.meshCollider.checkHorizontalMove(curPos, nextPt, currentZ, colliderRadius, 90, stepLimit, isAirborne);
        if (!res.allowed) {
          return {
            allowed: false,
            newPos: curPos,
            blockedByCliff: true,
            surfaceNormal: res.surfaceNormal
          };
        }
        curPos = res.newPos;
      }
      return { allowed: true, newPos: curPos, blockedByCliff: false, surfaceNormal: { x: 0, y: 0 } };
    }

    // 1. World / Custom Test Map Boundary bounds (strictly impassable edges with wall-sliding normal)
    const boundaryCheck = this.clampToPlayableBounds(to, 50);
    if (boundaryCheck.clamped) {
      return {
        allowed: false,
        newPos: boundaryCheck.pos,
        blockedByCliff: true,
        surfaceNormal: boundaryCheck.normal
      };
    }

    const dx = to.x - from.x;
    const dy = to.y - from.y;
    const dist = Math.hypot(dx, dy);
    if (dist < 0.0001) {
      return { allowed: true, newPos: to, blockedByCliff: false, surfaceNormal: { x: 0, y: 0 } };
    }

    const dirX = dx / dist;
    const dirY = dy / dist;

    // Swept sub-step resolution: test segments of at most 8 units to prevent tunneling
    const maxStepLen = 8.0;
    const numSteps = Math.max(1, Math.ceil(dist / maxStepLen));
    const stepDt = 1.0 / numSteps;

    const fromH = this.calculateHeight(from.x, from.y);
    let lastValidPos = { x: from.x, y: from.y };

    const maxWalkSlope = this.isCustomTestMap ? 1.05 : 0.84; // Allow slightly steeper test slopes in custom SketchUp maps

    for (let s = 1; s <= numSteps; s++) {
      const t = s * stepDt;
      const curX = from.x + dx * t;
      const curY = from.y + dy * t;
      const curH = this.calculateHeight(curX, curY);
      const inTowerZone = this.isInTowerStepZone(curX, curY);
      const stepUpLimit = this.getStepUpLimitAt(curX, curY, curH);

      // Boundary mountain check: Insurmountable alpine peaks (Z > 720) — bypassed on custom test maps
      if (!this.isCustomTestMap && curH > 720) {
        const grad = this.getSlopeGradient(curX, curY);
        const gLen = Math.hypot(grad.gx, grad.gy) || 1;
        return { allowed: false, newPos: lastValidPos, blockedByCliff: true, surfaceNormal: { x: -grad.gx / gLen, y: -grad.gy / gLen } };
      }

      // Narrow perimeter probe inside tower spiral zone so adjacent rock spire faces don't snag lateral probes
      const probeRadius = inTowerZone ? Math.min(colliderRadius, 5) : colliderRadius;
      const probe = this.sampleColliderMaxHeight(curX, curY, probeRadius, dirX, dirY);
      const probeStepLimit = this.getStepUpLimitAt(probe.maxX, probe.maxY, probe.maxH);

      if (isAirborne) {
        // Airborne collision: cannot pass horizontally into solid cliff or mountain higher than entity elevation + stepUpLimit
        if (curH > currentZ + stepUpLimit || probe.maxH > currentZ + probeStepLimit) {
          const hitX = probe.maxH > curH ? probe.maxX : curX;
          const hitY = probe.maxH > curH ? probe.maxY : curY;
          const grad = this.getSlopeGradient(hitX, hitY);
          const gLen = Math.hypot(grad.gx, grad.gy) || 1;
          return { allowed: false, newPos: lastValidPos, blockedByCliff: true, surfaceNormal: { x: -grad.gx / gLen, y: -grad.gy / gLen } };
        }
      } else {
        // Grounded collision: cannot step up sheer cliffs, vertical rock faces, or mountain walls
        const subDist = Math.max(dist * t, 0.001);
        const deltaH = curH - fromH;
        const probeDeltaH = probe.maxH - fromH;

        // Tower step-up: consecutive steps up to 142u are steppable directly; sheer >142u walls still block
        if (inTowerZone) {
          if (deltaH > stepUpLimit) {
            const grad = this.getSlopeGradient(curX, curY);
            const gLen = Math.hypot(grad.gx, grad.gy) || 1;
            return { allowed: false, newPos: lastValidPos, blockedByCliff: true, surfaceNormal: { x: -grad.gx / gLen, y: -grad.gy / gLen } };
          }
        } else {
          // If ground rises by more than stepUpLimit, verify whether the incline is walkable
          if (deltaH > stepUpLimit && (deltaH / subDist) > maxWalkSlope) {
            const grad = this.getSlopeGradient(curX, curY);
            const gLen = Math.hypot(grad.gx, grad.gy) || 1;
            return { allowed: false, newPos: lastValidPos, blockedByCliff: true, surfaceNormal: { x: -grad.gx / gLen, y: -grad.gy / gLen } };
          }

          // Perimeter collider probe touching sheer cliff face or steep lateral wall
          if (probeDeltaH > probeStepLimit && (probeDeltaH / (subDist + probeRadius + 4)) > maxWalkSlope) {
            const grad = this.getSlopeGradient(probe.maxX, probe.maxY);
            const gLen = Math.hypot(grad.gx, grad.gy) || 1;
            return { allowed: false, newPos: lastValidPos, blockedByCliff: true, surfaceNormal: { x: -grad.gx / gLen, y: -grad.gy / gLen } };
          }
        }
      }

      lastValidPos = { x: curX, y: curY };
    }

    return { allowed: true, newPos: to, blockedByCliff: false, surfaceNormal: { x: 0, y: 0 } };
  }
}

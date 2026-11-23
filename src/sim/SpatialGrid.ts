import { EnemyState, Vector2 } from './types';

export class SpatialGrid {
  private cellSize: number;
  private invCellSize: number;
  private grid: Map<number, EnemyState[]> = new Map();
  private activeBuckets: EnemyState[][] = [];

  constructor(cellSize: number = 150) {
    this.cellSize = cellSize;
    this.invCellSize = 1 / cellSize;
  }

  public clear(): void {
    for (let i = 0; i < this.activeBuckets.length; i++) {
      this.activeBuckets[i].length = 0;
    }
    this.activeBuckets.length = 0;
    if (this.grid.size > 4096) {
      this.grid.clear();
    }
  }

  private getKey(cx: number, cy: number): number {
    return (((cx + 32768) & 0xffff) << 16) | ((cy + 32768) & 0xffff);
  }

  public insert(enemy: EnemyState): void {
    const cx = Math.floor(enemy.pos.x * this.invCellSize);
    const cy = Math.floor(enemy.pos.y * this.invCellSize);
    const key = this.getKey(cx, cy);
    let list = this.grid.get(key);
    if (!list) {
      list = [];
      this.grid.set(key, list);
    }
    if (list.length === 0) {
      this.activeBuckets.push(list);
    }
    list.push(enemy);
  }

  /**
   * Populates `out` with enemies within `radius` of `pos` and returns `out` (zero-allocation when reused).
   */
  public getNearbyInto(pos: Vector2, radius: number, out: EnemyState[]): EnemyState[] {
    out.length = 0;
    const minCx = Math.floor((pos.x - radius) * this.invCellSize);
    const maxCx = Math.floor((pos.x + radius) * this.invCellSize);
    const minCy = Math.floor((pos.y - radius) * this.invCellSize);
    const maxCy = Math.floor((pos.y + radius) * this.invCellSize);
    const r2 = radius * radius;

    for (let cx = minCx; cx <= maxCx; cx++) {
      const shiftedX = ((cx + 32768) & 0xffff) << 16;
      for (let cy = minCy; cy <= maxCy; cy++) {
        const list = this.grid.get(shiftedX | ((cy + 32768) & 0xffff));
        if (!list || list.length === 0) continue;
        for (let i = 0; i < list.length; i++) {
          const e = list[i];
          const dx = e.pos.x - pos.x;
          const dy = e.pos.y - pos.y;
          if (dx * dx + dy * dy <= r2) {
            out.push(e);
          }
        }
      }
    }

    return out;
  }

  public getNearby(pos: Vector2, radius: number): EnemyState[] {
    return this.getNearbyInto(pos, radius, []);
  }

  public findNearest(pos: Vector2, maxRange: number): EnemyState | null {
    const minCx = Math.floor((pos.x - maxRange) * this.invCellSize);
    const maxCx = Math.floor((pos.x + maxRange) * this.invCellSize);
    const minCy = Math.floor((pos.y - maxRange) * this.invCellSize);
    const maxCy = Math.floor((pos.y + maxRange) * this.invCellSize);

    let nearest: EnemyState | null = null;
    let minD2 = maxRange * maxRange;

    for (let cx = minCx; cx <= maxCx; cx++) {
      const shiftedX = ((cx + 32768) & 0xffff) << 16;
      for (let cy = minCy; cy <= maxCy; cy++) {
        const list = this.grid.get(shiftedX | ((cy + 32768) & 0xffff));
        if (!list || list.length === 0) continue;
        for (let i = 0; i < list.length; i++) {
          const e = list[i];
          const dx = e.pos.x - pos.x;
          const dy = e.pos.y - pos.y;
          const d2 = dx * dx + dy * dy;
          if (d2 < minD2) {
            minD2 = d2;
            nearest = e;
          }
        }
      }
    }

    return nearest;
  }
}


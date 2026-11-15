import { EnemyState, Vector2 } from './types';

export class SpatialGrid {
  private cellSize: number;
  private grid: Map<string, EnemyState[]> = new Map();

  constructor(cellSize: number = 150) {
    this.cellSize = cellSize;
  }

  public clear(): void {
    this.grid.clear();
  }

  private getKey(cx: number, cy: number): string {
    return `${cx},${cy}`;
  }

  public insert(enemy: EnemyState): void {
    const cx = Math.floor(enemy.pos.x / this.cellSize);
    const cy = Math.floor(enemy.pos.y / this.cellSize);
    const key = this.getKey(cx, cy);
    let list = this.grid.get(key);
    if (!list) {
      list = [];
      this.grid.set(key, list);
    }
    list.push(enemy);
  }

  public getNearby(pos: Vector2, radius: number): EnemyState[] {
    const minCx = Math.floor((pos.x - radius) / this.cellSize);
    const maxCx = Math.floor((pos.x + radius) / this.cellSize);
    const minCy = Math.floor((pos.y - radius) / this.cellSize);
    const maxCy = Math.floor((pos.y + radius) / this.cellSize);

    const results: EnemyState[] = [];
    const r2 = radius * radius;

    for (let cx = minCx; cx <= maxCx; cx++) {
      for (let cy = minCy; cy <= maxCy; cy++) {
        const list = this.grid.get(this.getKey(cx, cy));
        if (!list) continue;
        for (let i = 0; i < list.length; i++) {
          const e = list[i];
          const dx = e.pos.x - pos.x;
          const dy = e.pos.y - pos.y;
          if (dx * dx + dy * dy <= r2) {
            results.push(e);
          }
        }
      }
    }

    return results;
  }

  public findNearest(pos: Vector2, maxRange: number): EnemyState | null {
    const nearby = this.getNearby(pos, maxRange);
    let nearest: EnemyState | null = null;
    let minD2 = maxRange * maxRange;

    for (let i = 0; i < nearby.length; i++) {
      const e = nearby[i];
      const dx = e.pos.x - pos.x;
      const dy = e.pos.y - pos.y;
      const d2 = dx * dx + dy * dy;
      if (d2 < minD2) {
        minD2 = d2;
        nearest = e;
      }
    }

    return nearest;
  }
}


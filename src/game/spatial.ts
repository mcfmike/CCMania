import { TILE } from './constants';
import type { Entity } from './entity';

const CELL = TILE * 2;

/** Uniform grid rebuilt every tick; buildings are inserted into every cell they cover. */
export class SpatialHash {
  private cells: Entity[][];
  private readonly cw: number;
  private readonly ch: number;
  private stamp = 1;
  private stamps = new Map<number, number>();

  constructor(worldW: number, worldH: number) {
    this.cw = Math.ceil(worldW / CELL) + 1;
    this.ch = Math.ceil(worldH / CELL) + 1;
    this.cells = Array.from({ length: this.cw * this.ch }, () => []);
  }

  clear(): void {
    for (const c of this.cells) c.length = 0;
  }

  insert(e: Entity): void {
    if (e.isUnit) {
      const cx = Math.max(0, Math.min(this.cw - 1, Math.floor(e.x / CELL)));
      const cy = Math.max(0, Math.min(this.ch - 1, Math.floor(e.y / CELL)));
      this.cells[cy * this.cw + cx].push(e);
      return;
    }
    const x0 = Math.floor((e.tx * TILE) / CELL);
    const y0 = Math.floor((e.ty * TILE) / CELL);
    const x1 = Math.floor(((e.tx + e.b.w) * TILE - 1) / CELL);
    const y1 = Math.floor(((e.ty + e.b.h) * TILE - 1) / CELL);
    for (let y = y0; y <= y1; y++) {
      for (let x = x0; x <= x1; x++) {
        if (x >= 0 && y >= 0 && x < this.cw && y < this.ch) this.cells[y * this.cw + x].push(e);
      }
    }
  }

  /** Entities whose centre (units) or footprint (buildings) may lie within r of (x,y). */
  query(x: number, y: number, r: number, out: Entity[] = []): Entity[] {
    out.length = 0;
    const s = ++this.stamp;
    const x0 = Math.max(0, Math.floor((x - r) / CELL));
    const y0 = Math.max(0, Math.floor((y - r) / CELL));
    const x1 = Math.min(this.cw - 1, Math.floor((x + r) / CELL));
    const y1 = Math.min(this.ch - 1, Math.floor((y + r) / CELL));
    for (let cy = y0; cy <= y1; cy++) {
      for (let cx = x0; cx <= x1; cx++) {
        for (const e of this.cells[cy * this.cw + cx]) {
          if (e.dead) continue;
          if (e.isBuilding) {
            if (this.stamps.get(e.id) === s) continue;
            this.stamps.set(e.id, s);
            if (e.distTo(x, y) <= r) out.push(e);
          } else if (Math.abs(e.x - x) <= r + e.radius && Math.abs(e.y - y) <= r + e.radius) {
            out.push(e);
          }
        }
      }
    }
    return out;
  }
}

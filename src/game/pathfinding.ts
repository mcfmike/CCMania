import { PassClass } from './constants';
import type { GameMap } from './map';

/**
 * Flow fields: one Dijkstra pass from a goal cell gives every unit heading
 * there a path for free, which is what makes moving hundreds of units cheap.
 */
export class FlowField {
  readonly cost: Float32Array;
  lastUsed = 0;
  builtAt = 0;
  constructor(
    readonly gx: number,
    readonly gy: number,
    readonly cls: PassClass,
    readonly version: number,
    size: number,
  ) {
    this.cost = new Float32Array(size);
  }
}

const DIRS: ReadonlyArray<readonly [number, number, number]> = [
  [1, 0, 1],
  [-1, 0, 1],
  [0, 1, 1],
  [0, -1, 1],
  [1, 1, Math.SQRT2],
  [-1, 1, Math.SQRT2],
  [1, -1, Math.SQRT2],
  [-1, -1, Math.SQRT2],
];

// Shared scratch heap (typed arrays, grown on demand) to keep GC quiet.
let heapIdx = new Int32Array(1 << 16);
let heapPri = new Float32Array(1 << 16);

/** Dijkstra from one or more seed cells. Seeds may be impassable (e.g. a building footprint). */
export function buildField(map: GameMap, seeds: number[], cls: PassClass): FlowField {
  const w = map.w;
  const h = map.h;
  const gx = seeds[0] % w;
  const gy = (seeds[0] - gx) / w;
  const f = new FlowField(gx, gy, cls, map.version, w * h);
  const cost = f.cost;
  cost.fill(Infinity);
  const pass = map.passMask(cls);
  if (heapIdx.length < w * h * 4) {
    heapIdx = new Int32Array(w * h * 4);
    heapPri = new Float32Array(w * h * 4);
  }
  const hi = heapIdx;
  const hp = heapPri;
  let n = 0;
  const push = (i: number, p: number) => {
    let k = n++;
    while (k > 0) {
      const parent = (k - 1) >> 1;
      if (hp[parent] <= p) break;
      hi[k] = hi[parent];
      hp[k] = hp[parent];
      k = parent;
    }
    hi[k] = i;
    hp[k] = p;
  };
  for (const s of seeds) {
    cost[s] = 0;
    push(s, 0);
  }
  const S2 = Math.SQRT2;
  while (n > 0) {
    const i = hi[0];
    const c = hp[0];
    // pop
    n--;
    if (n > 0) {
      const li = hi[n];
      const lp = hp[n];
      let k = 0;
      for (;;) {
        const l = k * 2 + 1;
        if (l >= n) break;
        const r = l + 1;
        const m = r < n && hp[r] < hp[l] ? r : l;
        if (hp[m] >= lp) break;
        hi[k] = hi[m];
        hp[k] = hp[m];
        k = m;
      }
      hi[k] = li;
      hp[k] = lp;
    }
    if (c > cost[i]) continue;
    const x = i % w;
    const y = (i - x) / w;
    const l = x > 0;
    const r = x < w - 1;
    const u = y > 0;
    const d = y < h - 1;
    const pl = l && pass[i - 1] === 1;
    const pr = r && pass[i + 1] === 1;
    const pu = u && pass[i - w] === 1;
    const pd = d && pass[i + w] === 1;
    let nc = c + 1;
    if (pl && nc < cost[i - 1]) {
      cost[i - 1] = nc;
      push(i - 1, nc);
    }
    if (pr && nc < cost[i + 1]) {
      cost[i + 1] = nc;
      push(i + 1, nc);
    }
    if (pu && nc < cost[i - w]) {
      cost[i - w] = nc;
      push(i - w, nc);
    }
    if (pd && nc < cost[i + w]) {
      cost[i + w] = nc;
      push(i + w, nc);
    }
    nc = c + S2;
    if (pl && pu && pass[i - w - 1] === 1 && nc < cost[i - w - 1]) {
      cost[i - w - 1] = nc;
      push(i - w - 1, nc);
    }
    if (pr && pu && pass[i - w + 1] === 1 && nc < cost[i - w + 1]) {
      cost[i - w + 1] = nc;
      push(i - w + 1, nc);
    }
    if (pl && pd && pass[i + w - 1] === 1 && nc < cost[i + w - 1]) {
      cost[i + w - 1] = nc;
      push(i + w - 1, nc);
    }
    if (pr && pd && pass[i + w + 1] === 1 && nc < cost[i + w + 1]) {
      cost[i + w + 1] = nc;
      push(i + w + 1, nc);
    }
  }
  return f;
}

/** Fields survive map changes this long before being rebuilt (units slide around new obstacles meanwhile). */
const STALE_TICKS = 60;

export class FlowCache {
  private fields = new Map<string, FlowField>();
  private clock = 0;
  /** Current sim tick, set by the world each step. */
  now = 0;

  private fresh(f: FlowField | undefined, map: GameMap): f is FlowField {
    return !!f && (f.version === map.version || this.now - f.builtAt < STALE_TICKS);
  }

  get(map: GameMap, gx: number, gy: number, cls: PassClass): FlowField {
    gx = Math.max(0, Math.min(map.w - 1, gx));
    gy = Math.max(0, Math.min(map.h - 1, gy));
    const key = `${gx},${gy},${cls}`;
    let f = this.fields.get(key);
    if (!this.fresh(f, map)) {
      f = buildField(map, [map.idx(gx, gy)], cls);
      f.builtAt = this.now;
      this.fields.set(key, f);
      if (this.fields.size > 96) this.evict();
    }
    f.lastUsed = ++this.clock;
    return f;
  }

  /** Field whose goal is a whole rectangle of cells (used to walk up to buildings). */
  getRect(map: GameMap, tx: number, ty: number, w: number, h: number, cls: PassClass): FlowField {
    const key = `r${tx},${ty},${w},${h},${cls}`;
    let f = this.fields.get(key);
    if (!this.fresh(f, map)) {
      const seeds: number[] = [];
      for (let y = ty; y < ty + h; y++) for (let x = tx; x < tx + w; x++) if (map.inBounds(x, y)) seeds.push(map.idx(x, y));
      f = buildField(map, seeds, cls);
      f.builtAt = this.now;
      this.fields.set(key, f);
      if (this.fields.size > 96) this.evict();
    }
    f.lastUsed = ++this.clock;
    return f;
  }

  private evict(): void {
    const entries = [...this.fields.entries()].sort((a, b) => a[1].lastUsed - b[1].lastUsed);
    for (let i = 0; i < 32; i++) this.fields.delete(entries[i][0]);
  }

  clear(): void {
    this.fields.clear();
  }
}

/**
 * Best neighbouring cell to step into from (x,y) following the field,
 * or null when already at a local minimum / unreachable.
 */
export function nextStep(map: GameMap, f: FlowField, x: number, y: number): { x: number; y: number } | null {
  const w = map.w;
  let best = f.cost[y * w + x];
  let bx = -1;
  let by = -1;
  for (const [dx, dy] of DIRS) {
    const nx = x + dx;
    const ny = y + dy;
    if (!map.inBounds(nx, ny)) continue;
    const c = f.cost[ny * w + nx];
    if (c >= best) continue;
    if (dx !== 0 && dy !== 0) {
      if (!map.passable(x + dx, y, f.cls) || !map.passable(x, y + dy, f.cls)) continue;
    }
    best = c;
    bx = nx;
    by = ny;
  }
  return bx < 0 ? null : { x: bx, y: by };
}

/** Breadth-first search for the nearest cell matching a predicate. */
export function findNearestCell(
  map: GameMap,
  sx: number,
  sy: number,
  cls: PassClass,
  maxDist: number,
  pred: (x: number, y: number) => boolean,
): { x: number; y: number } | null {
  if (!map.inBounds(sx, sy)) return null;
  const seen = new Uint8Array(map.w * map.h);
  const queue: number[] = [map.idx(sx, sy)];
  seen[queue[0]] = 1;
  let head = 0;
  while (head < queue.length) {
    const i = queue[head++];
    const x = i % map.w;
    const y = (i - x) / map.w;
    if (pred(x, y)) return { x, y };
    if (Math.abs(x - sx) > maxDist || Math.abs(y - sy) > maxDist) continue;
    for (let d = 0; d < 4; d++) {
      const [dx, dy] = DIRS[d];
      const nx = x + dx;
      const ny = y + dy;
      if (!map.inBounds(nx, ny)) continue;
      const ni = ny * map.w + nx;
      if (seen[ni]) continue;
      seen[ni] = 1;
      if (map.passableIdx(ni, cls)) queue.push(ni);
    }
  }
  return null;
}

/** Nearest cell (ring search) that is passable for the class. */
export function nearestPassable(map: GameMap, x: number, y: number, cls: PassClass, maxR = 12): { x: number; y: number } | null {
  x = Math.max(0, Math.min(map.w - 1, x));
  y = Math.max(0, Math.min(map.h - 1, y));
  if (map.passable(x, y, cls)) return { x, y };
  for (let r = 1; r <= maxR; r++) {
    let best: { x: number; y: number } | null = null;
    let bd = Infinity;
    for (let dy = -r; dy <= r; dy++) {
      for (let dx = -r; dx <= r; dx++) {
        if (Math.max(Math.abs(dx), Math.abs(dy)) !== r) continue;
        if (!map.passable(x + dx, y + dy, cls)) continue;
        const d = dx * dx + dy * dy;
        if (d < bd) {
          bd = d;
          best = { x: x + dx, y: y + dy };
        }
      }
    }
    if (best) return best;
  }
  return null;
}

import { PassClass } from './constants';
import { GameMap, ORE_MAX, T, type Point } from './map';
import { RNG, fbm, hash2 } from './rng';

export type Symmetry = 'none' | 'mirror' | 'rotate' | 'quad';

export interface GenParams {
  width: number;
  height: number;
  seed: number;
  players: number;
  symmetry: Symmetry;
  /** 0..1 amounts. */
  water: number;
  cliffs: number;
  forest: number;
  ore: number;
  name?: string;
}

export const DEFAULT_GEN: GenParams = {
  width: 96,
  height: 96,
  seed: 1,
  players: 2,
  symmetry: 'rotate',
  water: 0.35,
  cliffs: 0.4,
  forest: 0.4,
  ore: 0.5,
};

/**
 * Procedural skirmish map generator. Everything is painted through the
 * chosen symmetry so mirrored maps are perfectly fair.
 */
export function generateMap(params: GenParams): GameMap {
  const p = { ...params };
  if (p.players === 3 && p.symmetry !== 'none') p.symmetry = 'none';
  const { width: w, height: h, seed } = p;
  const m = new GameMap(w, h);
  m.name = p.name ?? `Random #${seed}`;
  m.author = 'CC Mania generator';
  m.description = `${p.players}-player ${p.symmetry} map. Seed ${seed}.`;
  const rng = new RNG(seed);

  const canon = (x: number, y: number): [number, number] => {
    switch (p.symmetry) {
      case 'mirror':
        return [Math.min(x, w - 1 - x), y];
      case 'rotate':
        return y < h / 2 ? [x, y] : [w - 1 - x, h - 1 - y];
      case 'quad':
        return [Math.min(x, w - 1 - x), Math.min(y, h - 1 - y)];
      default:
        return [x, y];
    }
  };
  const images = (x: number, y: number): Point[] => {
    const out: Point[] = [{ x, y }];
    const add = (ax: number, ay: number) => {
      if (!out.some((q) => q.x === ax && q.y === ay)) out.push({ x: ax, y: ay });
    };
    if (p.symmetry === 'mirror') add(w - 1 - x, y);
    else if (p.symmetry === 'rotate') add(w - 1 - x, h - 1 - y);
    else if (p.symmetry === 'quad') {
      add(w - 1 - x, y);
      add(x, h - 1 - y);
      add(w - 1 - x, h - 1 - y);
    }
    return out;
  };
  const setT = (x: number, y: number, t: T) => {
    for (const q of images(x, y)) if (m.inBounds(q.x, q.y)) m.terrain[m.idx(q.x, q.y)] = t;
  };
  const setOre = (x: number, y: number, v: number) => {
    for (const q of images(x, y)) if (m.inBounds(q.x, q.y)) m.ore[m.idx(q.x, q.y)] = v;
  };

  // 1. Base terrain from noise sampled in the fundamental domain.
  const waterLevel = 0.22 + p.water * 0.26;
  const rockLevel = 0.8 - p.cliffs * 0.12;
  const treeLevel = 0.72 - p.forest * 0.22;
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const [cx, cy] = canon(x, y);
      const e = fbm(cx / 16, cy / 16, seed, 5);
      const moist = fbm(cx / 9, cy / 9, seed + 77, 3);
      const ridge = Math.abs(fbm(cx / 20, cy / 20, seed + 33, 3) * 2 - 1);
      const dirt = fbm(cx / 7, cy / 7, seed + 151, 2);
      let t: T = T.Grass;
      if (e < waterLevel) t = T.Water;
      else if (e < waterLevel + 0.035) t = T.Sand;
      else if (e > rockLevel || (ridge < p.cliffs * 0.05 && e > waterLevel + 0.08)) t = T.Rock;
      else if (moist > treeLevel && hash2(cx, cy, seed) > 0.25) t = T.Tree;
      else if (dirt > 0.62) t = T.Dirt;
      m.terrain[y * w + x] = t;
    }
  }

  // 2. Start positions.
  const margin = Math.max(8, Math.round(Math.min(w, h) * 0.1));
  const jitter = () => (p.symmetry === 'none' ? rng.int(-3, 3) : 0);
  let canonStarts: Point[];
  if (p.players === 2) {
    if (p.symmetry === 'mirror') canonStarts = [{ x: margin, y: Math.floor(h / 2) }];
    else if (p.symmetry === 'none')
      canonStarts = [
        { x: margin + jitter(), y: margin + jitter() },
        { x: w - 1 - margin + jitter(), y: h - 1 - margin + jitter() },
      ];
    else canonStarts = [{ x: margin, y: margin }];
  } else if (p.players === 3) {
    canonStarts = [
      { x: margin + jitter(), y: margin + jitter() },
      { x: w - 1 - margin + jitter(), y: margin + jitter() },
      { x: Math.floor(w / 2) + jitter(), y: h - 1 - margin + jitter() },
    ];
  } else {
    if (p.symmetry === 'quad') canonStarts = [{ x: margin, y: margin }];
    else if (p.symmetry === 'mirror')
      canonStarts = [
        { x: margin, y: margin },
        { x: margin, y: h - 1 - margin },
      ];
    else if (p.symmetry === 'rotate')
      canonStarts = [
        { x: margin, y: margin },
        { x: w - 1 - margin, y: margin },
      ];
    else
      canonStarts = [
        { x: margin + jitter(), y: margin + jitter() },
        { x: w - 1 - margin + jitter(), y: margin + jitter() },
        { x: margin + jitter(), y: h - 1 - margin + jitter() },
        { x: w - 1 - margin + jitter(), y: h - 1 - margin + jitter() },
      ];
  }
  const starts: Point[] = [];
  for (const s of canonStarts) for (const q of images(s.x, s.y)) if (!starts.some((o) => o.x === q.x && o.y === q.y)) starts.push(q);
  // Put the first two starts far apart so 1v1 games use opposite corners.
  if (starts.length > 2) {
    const far = starts.slice(1).sort((a, b) => Math.hypot(b.x - starts[0].x, b.y - starts[0].y) - Math.hypot(a.x - starts[0].x, a.y - starts[0].y))[0];
    starts.splice(starts.indexOf(far), 1);
    starts.splice(1, 0, far);
  }
  m.starts = starts.slice(0, p.players);

  const center = { x: Math.floor(w / 2), y: Math.floor(h / 2) };

  // 3. Clear bases and carve roads towards the centre.
  const carve = (from: Point, to: Point, width: number, r: RNG) => {
    let x = from.x;
    let y = from.y;
    let guard = 0;
    while ((Math.abs(x - to.x) > 1 || Math.abs(y - to.y) > 1) && guard++ < w * h) {
      const dx = Math.sign(to.x - x);
      const dy = Math.sign(to.y - y);
      if (r.chance(0.25)) {
        if (r.chance(0.5)) x += r.int(-1, 1);
        else y += r.int(-1, 1);
      } else if (Math.abs(to.x - x) > Math.abs(to.y - y) ? r.chance(0.8) : r.chance(0.2)) x += dx;
      else y += dy;
      x = Math.max(1, Math.min(w - 2, x));
      y = Math.max(1, Math.min(h - 2, y));
      for (let oy = -width; oy <= width; oy++)
        for (let ox = -width; ox <= width; ox++) {
          const cx = x + ox;
          const cy = y + oy;
          if (!m.inBounds(cx, cy)) continue;
          const t = m.t(cx, cy);
          if (t === T.Water) setT(cx, cy, T.Sand);
          else if (t === T.Rock || t === T.Tree) setT(cx, cy, T.Dirt);
        }
    }
  };
  for (const s of canonStarts) {
    for (let dy = -8; dy <= 8; dy++)
      for (let dx = -8; dx <= 8; dx++) {
        const d = Math.hypot(dx, dy);
        if (d > 8) continue;
        const x = s.x + dx;
        const y = s.y + dy;
        if (!m.inBounds(x, y)) continue;
        setT(x, y, d < 2.5 ? T.Concrete : d < 4 ? T.Dirt : T.Grass);
        setOre(x, y, 0);
      }
    carve(s, center, 1, new RNG(seed ^ (s.x * 977 + s.y)));
  }

  // 4. Veridium fields: one safe field per base, rich contested fields in between.
  const field = (cx: number, cy: number, radius: number, richness: number, blossom: boolean) => {
    for (let dy = -radius - 1; dy <= radius + 1; dy++)
      for (let dx = -radius - 1; dx <= radius + 1; dx++) {
        const x = cx + dx;
        const y = cy + dy;
        if (!m.inBounds(x, y)) continue;
        const d = Math.hypot(dx, dy) + (hash2(x, y, seed + 5) - 0.5) * 1.6;
        if (d > radius) continue;
        const t = m.t(x, y);
        if (t !== T.Grass && t !== T.Dirt && t !== T.Sand) continue;
        if (m.starts.some((s) => Math.hypot(s.x - x, s.y - y) < 5.5)) continue;
        const v = Math.round(ORE_MAX * richness * (1 - (d / radius) * 0.6));
        setOre(x, y, Math.max(60, Math.min(ORE_MAX, v)));
      }
    if (blossom) for (const q of images(cx, cy)) if (!m.blossoms.some((b) => b.x === q.x && b.y === q.y)) m.blossoms.push(q);
  };
  const richness = 0.4 + p.ore * 0.6;
  for (const s of canonStarts) {
    const ang = Math.atan2(center.y - s.y, center.x - s.x) + rng.range(-0.9, 0.9);
    const dist = 10 + rng.int(0, 2);
    field(Math.round(s.x + Math.cos(ang) * dist), Math.round(s.y + Math.sin(ang) * dist), 3 + Math.round(p.ore * 2), richness, false);
    const ang2 = ang + (rng.chance(0.5) ? 1 : -1) * rng.range(1.2, 1.8);
    if (p.ore > 0.3) field(Math.round(s.x + Math.cos(ang2) * 11), Math.round(s.y + Math.sin(ang2) * 11), 2 + Math.round(p.ore * 2), richness * 0.8, false);
  }
  const contested = 1 + Math.round(p.ore * 3);
  for (let i = 0; i < contested; i++) {
    const cx = i === 0 ? center.x : rng.int(margin + 6, w - margin - 6);
    const cy = i === 0 ? center.y : rng.int(margin + 6, h - margin - 6);
    field(cx, cy, 3 + Math.round(p.ore * 3), Math.min(1, richness + 0.2), p.ore >= 0.3);
  }

  // 5. Make sure every base can drive to every other base.
  for (let attempt = 0; attempt < 6; attempt++) {
    const reach = flood(m, m.starts[0]);
    const cut = m.starts.filter((s) => !reach[m.idx(s.x, s.y)]);
    if (!cut.length) break;
    for (const s of canonStarts) carve(s, center, 1 + attempt, new RNG(seed + attempt * 31 + s.x));
  }
  return m;
}

function flood(m: GameMap, s: Point): Uint8Array {
  const seen = new Uint8Array(m.w * m.h);
  const q = [m.idx(s.x, s.y)];
  seen[q[0]] = 1;
  while (q.length) {
    const i = q.pop()!;
    const x = i % m.w;
    const y = (i - x) / m.w;
    for (const [dx, dy] of [
      [1, 0],
      [-1, 0],
      [0, 1],
      [0, -1],
    ]) {
      const nx = x + dx;
      const ny = y + dy;
      if (!m.inBounds(nx, ny)) continue;
      const ni = m.idx(nx, ny);
      if (seen[ni] || !m.terrainPassable(m.terrain[ni] as T, PassClass.Vehicle)) continue;
      seen[ni] = 1;
      q.push(ni);
    }
  }
  return seen;
}

/** Curated built-in maps (deterministic generator presets). */
export const BUILTIN_MAPS: GenParams[] = [
  { ...DEFAULT_GEN, name: 'Green Valley Showdown', seed: 1337, symmetry: 'rotate', water: 0.25, cliffs: 0.3, forest: 0.4, ore: 0.55 },
  { ...DEFAULT_GEN, name: 'Twin Rivers', seed: 4242, symmetry: 'mirror', water: 0.6, cliffs: 0.2, forest: 0.3, ore: 0.5 },
  { ...DEFAULT_GEN, name: 'Crystal Fever', seed: 777, symmetry: 'rotate', water: 0.15, cliffs: 0.5, forest: 0.2, ore: 1 },
  { ...DEFAULT_GEN, name: 'Four Corners of Mayhem', seed: 2024, width: 112, height: 112, players: 4, symmetry: 'quad', water: 0.3, cliffs: 0.5, forest: 0.4, ore: 0.7 },
  { ...DEFAULT_GEN, name: 'Triangle of Doom', seed: 31337, width: 104, height: 104, players: 3, symmetry: 'none', water: 0.35, cliffs: 0.35, forest: 0.5, ore: 0.6 },
  { ...DEFAULT_GEN, name: 'MANIA: Mega Arena', seed: 9001, width: 144, height: 144, players: 4, symmetry: 'quad', water: 0.2, cliffs: 0.3, forest: 0.3, ore: 1 },
];

import { TILE } from '../game/constants';
import { T, type GameMap } from '../game/map';
import { hash2 } from '../game/rng';
import { canvas } from './color';
import { treeSprite } from './sprites';

const CH = 16; // tiles per chunk side
const CPX = CH * TILE;
const TEX = 64;

/** Average colours, also used by the minimap and PNG export. */
export const TERRAIN_RGB: [number, number, number][] = [
  [74, 124, 52], // grass
  [124, 98, 64], // dirt
  [206, 184, 130], // sand
  [112, 106, 98], // rock
  [36, 82, 140], // water
  [40, 76, 32], // trees
  [150, 150, 146], // concrete
];

function tileNoise(x: number, y: number, period: number, seed: number): number {
  const x0 = Math.floor(x);
  const y0 = Math.floor(y);
  const fx = x - x0;
  const fy = y - y0;
  const sx = fx * fx * (3 - 2 * fx);
  const sy = fy * fy * (3 - 2 * fy);
  const h = (a: number, b: number) => hash2(((a % period) + period) % period, ((b % period) + period) % period, seed);
  const a = h(x0, y0);
  const b = h(x0 + 1, y0);
  const c = h(x0, y0 + 1);
  const d = h(x0 + 1, y0 + 1);
  return a + (b - a) * sx + (c - a) * sy + (a - b - c + d) * sx * sy;
}

function makeTextures(): Float32Array[] {
  const out: Float32Array[] = [];
  for (let t = 0; t < 7; t++) {
    const tex = new Float32Array(TEX * TEX * 3);
    const [br, bg, bb] = TERRAIN_RGB[t];
    for (let y = 0; y < TEX; y++) {
      for (let x = 0; x < TEX; x++) {
        const n1 = tileNoise(x / 16, y / 16, 4, 11 + t);
        const n2 = tileNoise(x / 4, y / 4, 16, 23 + t);
        const n3 = hash2(x, y, 37 + t);
        let k = 1 + (n1 - 0.5) * 0.25 + (n2 - 0.5) * 0.18;
        let r = br;
        let g = bg;
        let b = bb;
        switch (t) {
          case T.Grass:
          case T.Tree:
            if (n3 > 0.93) k += 0.18;
            else if (n3 < 0.05) k -= 0.15;
            g += (n1 - 0.5) * 18;
            break;
          case T.Dirt:
            if (n3 > 0.95) k += 0.25;
            break;
          case T.Sand:
            k += Math.sin((x + n1 * 20) * 0.6) * 0.03;
            break;
          case T.Rock:
            k += (n2 > 0.72 ? -0.25 : 0) + (n3 - 0.5) * 0.12;
            break;
          case T.Water:
            k += Math.sin((x + y * 0.5 + n1 * 30) * 0.35) * 0.05;
            break;
          case T.Concrete:
            k = 1 + (n2 - 0.5) * 0.08 + (n3 - 0.5) * 0.05;
            if (x % 32 === 0 || y % 32 === 0) k -= 0.22;
            if (x % 32 === 1 || y % 32 === 1) k += 0.08;
            break;
        }
        r *= k;
        g *= k;
        b *= k;
        const i = (y * TEX + x) * 3;
        tex[i] = r;
        tex[i + 1] = g;
        tex[i + 2] = b;
      }
    }
    out.push(tex);
  }
  return out;
}

let textures: Float32Array[] | null = null;
let noiseTex: Float32Array | null = null;

function getNoise(): Float32Array {
  if (!noiseTex) {
    noiseTex = new Float32Array(256 * 256);
    for (let y = 0; y < 256; y++)
      for (let x = 0; x < 256; x++) noiseTex[y * 256 + x] = tileNoise(x / 9, y / 9, 256 / 9, 5) * 0.7 + tileNoise(x / 3, y / 3, 256 / 3, 9) * 0.3;
  }
  return noiseTex;
}

interface Decal {
  kind: 'scorch' | 'crater' | 'rubble';
  x: number;
  y: number;
  size: number;
}

export class TerrainRenderer {
  private chunks: (HTMLCanvasElement | null)[];
  private pending: Decal[][];
  private readonly cw: number;
  private readonly chh: number;

  constructor(private map: GameMap) {
    this.cw = Math.ceil(map.w / CH);
    this.chh = Math.ceil(map.h / CH);
    this.chunks = new Array(this.cw * this.chh).fill(null);
    this.pending = Array.from({ length: this.cw * this.chh }, () => []);
    textures ??= makeTextures();
  }

  invalidateAll(): void {
    this.chunks.fill(null);
  }

  /** Mark tiles (inclusive range) for re-render, e.g. after editor painting. */
  invalidateTiles(x0: number, y0: number, x1: number, y1: number): void {
    const cx0 = Math.max(0, Math.floor((x0 - 2) / CH));
    const cy0 = Math.max(0, Math.floor((y0 - 2) / CH));
    const cx1 = Math.min(this.cw - 1, Math.floor((x1 + 2) / CH));
    const cy1 = Math.min(this.chh - 1, Math.floor((y1 + 2) / CH));
    for (let cy = cy0; cy <= cy1; cy++) for (let cx = cx0; cx <= cx1; cx++) this.chunks[cy * this.cw + cx] = null;
  }

  addDecal(kind: Decal['kind'], x: number, y: number, size: number): void {
    const r = size * TILE;
    const cx0 = Math.max(0, Math.floor((x - r) / CPX));
    const cy0 = Math.max(0, Math.floor((y - r) / CPX));
    const cx1 = Math.min(this.cw - 1, Math.floor((x + r) / CPX));
    const cy1 = Math.min(this.chh - 1, Math.floor((y + r) / CPX));
    const d = { kind, x, y, size };
    for (let cy = cy0; cy <= cy1; cy++)
      for (let cx = cx0; cx <= cx1; cx++) {
        const i = cy * this.cw + cx;
        const ch = this.chunks[i];
        if (ch) this.paintDecal(ch.getContext('2d')!, d, cx * CPX, cy * CPX);
        else this.pending[i].push(d);
      }
  }

  draw(ctx: CanvasRenderingContext2D, x0: number, y0: number, x1: number, y1: number): void {
    const cx0 = Math.max(0, Math.floor(x0 / CPX));
    const cy0 = Math.max(0, Math.floor(y0 / CPX));
    const cx1 = Math.min(this.cw - 1, Math.floor(x1 / CPX));
    const cy1 = Math.min(this.chh - 1, Math.floor(y1 / CPX));
    for (let cy = cy0; cy <= cy1; cy++)
      for (let cx = cx0; cx <= cx1; cx++) {
        const i = cy * this.cw + cx;
        let ch = this.chunks[i];
        if (!ch) {
          ch = this.renderChunk(cx, cy);
          this.chunks[i] = ch;
          const c = ch.getContext('2d')!;
          for (const d of this.pending[i]) this.paintDecal(c, d, cx * CPX, cy * CPX);
          this.pending[i] = [];
        }
        ctx.drawImage(ch, cx * CPX, cy * CPX);
      }
  }

  private terr(x: number, y: number): number {
    const m = this.map;
    x = x < 0 ? 0 : x >= m.w ? m.w - 1 : x;
    y = y < 0 ? 0 : y >= m.h ? m.h - 1 : y;
    return m.terrain[y * m.w + x];
  }

  private renderChunk(cx: number, cy: number): HTMLCanvasElement {
    const [cv, ctx] = canvas(CPX, CPX);
    const img = ctx.createImageData(CPX, CPX);
    const data = img.data;
    const tex = textures!;
    const noise = getNoise();
    const B = CPX + 2;
    const rockW = new Float32Array(B * B);
    const waterW = new Float32Array(B * B);
    const col = new Float32Array(CPX * CPX * 3);
    const X0 = cx * CPX;
    const Y0 = cy * CPX;
    for (let py = -1; py <= CPX; py++) {
      const wy = (Y0 + py + 0.5) / TILE - 0.5;
      const ty = Math.floor(wy);
      const fy0 = wy - ty;
      for (let px = -1; px <= CPX; px++) {
        const wx = (X0 + px + 0.5) / TILE - 0.5;
        const tx = Math.floor(wx);
        const fx0 = wx - tx;
        const gx = (X0 + px) & 255;
        const gy = (Y0 + py) & 255;
        const n = noise[gy * 256 + gx] - 0.5;
        const n2 = noise[((gy + 97) & 255) * 256 + ((gx + 41) & 255)] - 0.5;
        let fx = fx0 + n * 0.7;
        let fy = fy0 + n2 * 0.7;
        fx = fx < 0 ? 0 : fx > 1 ? 1 : fx;
        fy = fy < 0 ? 0 : fy > 1 ? 1 : fy;
        fx = fx * fx * (3 - 2 * fx);
        fy = fy * fy * (3 - 2 * fy);
        const t00 = this.terr(tx, ty);
        const t10 = this.terr(tx + 1, ty);
        const t01 = this.terr(tx, ty + 1);
        const t11 = this.terr(tx + 1, ty + 1);
        const w00 = (1 - fx) * (1 - fy);
        const w10 = fx * (1 - fy);
        const w01 = (1 - fx) * fy;
        const w11 = fx * fy;
        const bi = (py + 1) * B + (px + 1);
        rockW[bi] = (t00 === T.Rock ? w00 : 0) + (t10 === T.Rock ? w10 : 0) + (t01 === T.Rock ? w01 : 0) + (t11 === T.Rock ? w11 : 0);
        waterW[bi] = (t00 === T.Water ? w00 : 0) + (t10 === T.Water ? w10 : 0) + (t01 === T.Water ? w01 : 0) + (t11 === T.Water ? w11 : 0);
        if (px < 0 || py < 0 || px >= CPX || py >= CPX) continue;
        const ti = (((Y0 + py) & 63) * TEX + ((X0 + px) & 63)) * 3;
        const ci = (py * CPX + px) * 3;
        if (t00 === t10 && t00 === t01 && t00 === t11) {
          const tt = tex[t00];
          col[ci] = tt[ti];
          col[ci + 1] = tt[ti + 1];
          col[ci + 2] = tt[ti + 2];
        } else {
          const a = tex[t00];
          const b = tex[t10];
          const c = tex[t01];
          const d = tex[t11];
          col[ci] = a[ti] * w00 + b[ti] * w10 + c[ti] * w01 + d[ti] * w11;
          col[ci + 1] = a[ti + 1] * w00 + b[ti + 1] * w10 + c[ti + 1] * w01 + d[ti + 1] * w11;
          col[ci + 2] = a[ti + 2] * w00 + b[ti + 2] * w10 + c[ti + 2] * w01 + d[ti + 2] * w11;
        }
      }
    }
    // Lighting pass: raised cliffs, cast shadows, water depth and foam.
    for (let py = 0; py < CPX; py++) {
      for (let px = 0; px < CPX; px++) {
        const bi = (py + 1) * B + (px + 1);
        const ci = (py * CPX + px) * 3;
        const di = (py * CPX + px) * 4;
        let r = col[ci];
        let g = col[ci + 1];
        let b = col[ci + 2];
        const rw = rockW[bi];
        if (rw > 0.02) {
          const slope = rockW[bi - B - 1] - rockW[bi + B + 1];
          const k = 1 + slope * 3.2 + (rw - 0.5) * 0.25;
          r *= k;
          g *= k;
          b *= k;
        }
        const up = py >= 2 && px >= 2 ? rockW[bi - 2 * B - 2] : rockW[bi - B - 1];
        if (up > rw + 0.05) {
          const s = 1 - Math.min(0.45, (up - rw) * 0.7);
          r *= s;
          g *= s;
          b *= s;
        }
        const ww = waterW[bi];
        if (ww > 0.02) {
          const depth = ww * ww;
          r = r * (1 - depth * 0.35);
          g = g * (1 - depth * 0.2);
          b = b * (1 - depth * 0.05) + depth * 20;
          if (ww > 0.32 && ww < 0.5) {
            const f = 1 - Math.abs(ww - 0.41) / 0.09;
            r += f * 70;
            g += f * 80;
            b += f * 80;
          }
        }
        data[di] = r;
        data[di + 1] = g;
        data[di + 2] = b;
        data[di + 3] = 255;
      }
    }
    ctx.putImageData(img, 0, 0);
    // Trees, including those from neighbouring tiles that overhang this chunk.
    const tx0 = cx * CH - 1;
    const ty0 = cy * CH - 1;
    for (let ty = ty0; ty <= ty0 + CH + 1; ty++) {
      for (let tx = tx0; tx <= tx0 + CH + 1; tx++) {
        if (!this.map.inBounds(tx, ty) || this.map.t(tx, ty) !== T.Tree) continue;
        const count = 1 + Math.floor(hash2(tx, ty, 71) * 2.2);
        for (let k = 0; k < count; k++) {
          const ox = hash2(tx, ty, 100 + k) * 18 - 4;
          const oy = hash2(tx, ty, 200 + k) * 18 - 4;
          const v = Math.floor(hash2(tx, ty, 300 + k) * 6);
          ctx.drawImage(treeSprite(v), tx * TILE - X0 + ox - 4, ty * TILE - Y0 + oy - 4);
        }
      }
    }
    return cv;
  }

  private paintDecal(ctx: CanvasRenderingContext2D, d: Decal, ox: number, oy: number): void {
    const x = d.x - ox;
    const y = d.y - oy;
    const r = d.size * TILE * (d.kind === 'scorch' ? 0.7 : 0.6);
    ctx.save();
    if (d.kind === 'scorch' || d.kind === 'rubble') {
      const g = ctx.createRadialGradient(x, y, 0, x, y, r);
      g.addColorStop(0, 'rgba(15,10,5,0.75)');
      g.addColorStop(0.6, 'rgba(25,18,10,0.35)');
      g.addColorStop(1, 'rgba(0,0,0,0)');
      ctx.fillStyle = g;
      ctx.beginPath();
      ctx.arc(x, y, r, 0, Math.PI * 2);
      ctx.fill();
    }
    if (d.kind === 'crater') {
      const g = ctx.createRadialGradient(x, y, 0, x, y, r);
      g.addColorStop(0, 'rgba(10,8,6,0.85)');
      g.addColorStop(0.65, 'rgba(40,30,20,0.6)');
      g.addColorStop(0.8, 'rgba(150,130,100,0.35)');
      g.addColorStop(1, 'rgba(0,0,0,0)');
      ctx.fillStyle = g;
      ctx.beginPath();
      ctx.arc(x, y, r, 0, Math.PI * 2);
      ctx.fill();
    }
    if (d.kind === 'rubble') {
      let s = Math.floor(d.x * 7 + d.y * 13);
      const rnd = () => ((s = (s * 16807) % 2147483647) / 2147483647);
      for (let i = 0; i < d.size * 14; i++) {
        const a = rnd() * Math.PI * 2;
        const dist = rnd() * r * 0.9;
        const sz = 2 + rnd() * 5;
        ctx.fillStyle = rnd() > 0.5 ? '#3d3a36' : '#6a655d';
        ctx.fillRect(x + Math.cos(a) * dist, y + Math.sin(a) * dist, sz, sz * 0.7);
      }
    }
    ctx.restore();
  }
}

/** One pixel per tile overview, used by the minimap and editor. */
export function terrainOverview(map: GameMap): HTMLCanvasElement {
  const [cv, ctx] = canvas(map.w, map.h);
  const img = ctx.createImageData(map.w, map.h);
  for (let i = 0; i < map.w * map.h; i++) {
    const [r, g, b] = TERRAIN_RGB[map.terrain[i]];
    img.data[i * 4] = r;
    img.data[i * 4 + 1] = g;
    img.data[i * 4 + 2] = b;
    img.data[i * 4 + 3] = 255;
  }
  ctx.putImageData(img, 0, 0);
  return cv;
}

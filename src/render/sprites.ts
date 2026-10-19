import { TILE } from '../game/constants';
import { BUILDINGS, UNITS, type Faction } from '../game/defs';
import { canvas, shade } from './color';
import { barrel, centered, lin, rad, rr, type Ctx } from './draw';
import { bodyFrames, drawBody, drawInfantryFrame, drawInfantryPortrait, drawTurret, hasTurretArt, palette } from './unitArt';

/**
 * Every sprite in the game is drawn procedurally here, so the project ships
 * without a single binary asset. Results are cached per type + team colour.
 */

export interface UnitSprite {
  body: HTMLCanvasElement[];
  turret: HTMLCanvasElement | null;
  size: number;
  /** Black silhouette for aircraft ground shadows. */
  shadow?: HTMLCanvasElement;
}

export interface BuildingSprite {
  img: HTMLCanvasElement;
  /** Offset from the footprint's top-left corner. */
  ox: number;
  oy: number;
}

const unitCache = new Map<string, UnitSprite>();
const buildingCache = new Map<string, BuildingSprite>();
const misc = new Map<string, HTMLCanvasElement>();

/** Faction body colour used on structures (team colour is used for trim). */
function structureBase(faction: Faction): string {
  return faction === 'ember' ? '#3a3d44' : '#b39257';
}

/** Unit sprites are rasterised at this multiple so they stay crisp when zoomed in. */
const RES = 2;

function hires(size: number, draw: (c: Ctx) => void): HTMLCanvasElement {
  return centered(size * RES, (c) => {
    c.scale(RES, RES);
    draw(c);
  });
}

export function unitSprite(type: string, color: string, faction: Faction = 'vanguard'): UnitSprite {
  const def = UNITS[type];
  const fac = def.faction ?? faction;
  const key = `${type}|${color}|${fac}`;
  const hit = unitCache.get(key);
  if (hit) return hit;
  const pal = palette(fac, color);
  let s: UnitSprite;
  if (def.cls === 'infantry') {
    const size = Math.ceil(def.radius * 2.9 * (def.hero ? 1.5 : 1.2)) + 12;
    const frames = [0, 1, 2].map((f) => hires(size, (c) => drawInfantryFrame(c, type, pal, f)));
    s = { body: frames, turret: null, size };
  } else {
    // Long barrels and wings poke out of the hull, so leave generous room.
    const size = Math.ceil(def.radius * 3.4);
    const frames = Array.from({ length: bodyFrames(type) }, (_, f) => hires(size, (c) => drawBody(c, type, pal, f)));
    const turret = def.turret && hasTurretArt(type) ? hires(size, (c) => drawTurret(c, type, pal)) : null;
    s = { body: frames, turret, size };
  }
  if (def.air) {
    const [sh, sc] = canvas(s.size * RES, s.size * RES);
    sc.drawImage(s.body[s.body.length > 2 ? 2 : 0], 0, 0);
    sc.globalCompositeOperation = 'source-in';
    sc.fillStyle = '#000';
    sc.fillRect(0, 0, s.size * RES, s.size * RES);
    s.shadow = sh;
  }
  unitCache.set(key, s);
  return s;
}

// ------------------------------------------------------------------ buildings

function slab(c: Ctx, W: number, H: number): void {
  c.fillStyle = lin(c, 0, 0, 0, H, [
    [0, '#8a8e92'],
    [1, '#55595e'],
  ]);
  rr(c, 1, 1, W - 2, H - 2, 3);
  c.fill();
  c.strokeStyle = '#33363a';
  c.lineWidth = 1.5;
  c.stroke();
  c.fillStyle = '#3b3e42';
  for (const [x, y] of [
    [4, 4],
    [W - 6, 4],
    [4, H - 6],
    [W - 6, H - 6],
  ])
    c.fillRect(x, y, 2, 2);
}

function block(c: Ctx, x: number, y: number, w: number, h: number, color: string, lift = 6, team?: string): void {
  c.fillStyle = 'rgba(0,0,0,0.35)';
  rr(c, x + 3, y + 4, w, h, 3);
  c.fill();
  c.fillStyle = shade(color, -0.55);
  rr(c, x, y + h - lift, w, lift, 2);
  c.fill();
  c.fillStyle = lin(c, x, y, x + w, y + h, [
    [0, shade(color, 0.3)],
    [1, shade(color, -0.25)],
  ]);
  rr(c, x, y, w, h - lift + 1, 3);
  c.fill();
  c.strokeStyle = shade(color, -0.6);
  c.lineWidth = 1;
  c.stroke();
  if (team) {
    c.fillStyle = team;
    c.fillRect(x + 2, y + 2, w - 4, 3);
    c.fillStyle = 'rgba(255,255,255,0.25)';
    c.fillRect(x + 2, y + 2, w - 4, 1);
  }
}

function hazard(c: Ctx, x: number, y: number, w: number, h: number): void {
  c.save();
  c.beginPath();
  c.rect(x, y, w, h);
  c.clip();
  c.fillStyle = '#e8c21a';
  c.fillRect(x, y, w, h);
  c.fillStyle = '#1a1a1a';
  for (let i = -h; i < w; i += 8) {
    c.beginPath();
    c.moveTo(x + i, y + h);
    c.lineTo(x + i + 4, y + h);
    c.lineTo(x + i + 4 + h, y);
    c.lineTo(x + i + h, y);
    c.fill();
  }
  c.restore();
}

function light(c: Ctx, x: number, y: number, col: string): void {
  c.fillStyle = rad(c, x, y, 0, 4, [
    [0, '#fff'],
    [0.4, col],
    [1, 'rgba(0,0,0,0)'],
  ]);
  c.beginPath();
  c.arc(x, y, 4, 0, Math.PI * 2);
  c.fill();
}

const BUILDING_DRAW: Record<string, (c: Ctx, W: number, H: number, col: string, base: string) => void> = {
  conyard(c, W, H, col, base) {
    slab(c, W, H);
    block(c, 8, 10, 56, 54, base, 8, col);
    c.strokeStyle = shade(base, -0.45);
    for (let x = 16; x < 60; x += 10) {
      c.beginPath();
      c.moveTo(x, 13);
      c.lineTo(x, 54);
      c.stroke();
    }
    hazard(c, 18, H - 22, 40, 10);
    // crane
    c.fillStyle = '#3a3a3a';
    c.fillRect(72, 12, 14, 70);
    c.strokeStyle = '#e8c21a';
    c.lineWidth = 3;
    c.beginPath();
    c.moveTo(79, 18);
    c.lineTo(36, 30);
    c.stroke();
    c.strokeStyle = '#1a1a1a';
    c.lineWidth = 1;
    c.beginPath();
    c.moveTo(40, 30);
    c.lineTo(40, 46);
    c.stroke();
    c.fillStyle = '#e8c21a';
    c.fillRect(37, 46, 6, 4);
    light(c, 79, 16, '#ff3030');
    light(c, 12, 14, col);
  },
  power(c, W, H, col, base) {
    slab(c, W, H);
    for (const x of [19, 45]) {
      c.fillStyle = 'rgba(0,0,0,0.35)';
      c.beginPath();
      c.arc(x + 3, 24, 13, 0, Math.PI * 2);
      c.fill();
      c.fillStyle = rad(c, x - 4, 16, 2, 14, [
        [0, '#d7dade'],
        [1, '#6f747a'],
      ]);
      c.beginPath();
      c.arc(x, 21, 12, 0, Math.PI * 2);
      c.fill();
      c.fillStyle = rad(c, x, 21, 1, 8, [
        [0, '#20262c'],
        [1, '#4b5157'],
      ]);
      c.beginPath();
      c.arc(x, 21, 7, 0, Math.PI * 2);
      c.fill();
    }
    block(c, 8, 38, 48, 20, base, 5, col);
    c.fillStyle = '#7ff7ff';
    c.fillRect(14, 44, 36, 3);
    light(c, 32, 45, '#4fe8ff');
  },
  refinery(c, W, H, col, base) {
    slab(c, W, H);
    for (const [x, y] of [
      [22, 22],
      [22, 54],
    ]) {
      c.fillStyle = 'rgba(0,0,0,0.35)';
      c.beginPath();
      c.arc(x + 3, y + 3, 14, 0, Math.PI * 2);
      c.fill();
      c.fillStyle = rad(c, x - 5, y - 5, 2, 15, [
        [0, '#c9ffd9'],
        [0.5, '#3fbf6a'],
        [1, '#1d5a33'],
      ]);
      c.beginPath();
      c.arc(x, y, 13, 0, Math.PI * 2);
      c.fill();
      c.strokeStyle = '#2b2f33';
      c.lineWidth = 2;
      c.stroke();
    }
    block(c, 44, 10, 44, 56, base, 7, col);
    c.fillStyle = shade(col, -0.4);
    c.fillRect(50, 18, 32, 4);
    c.fillRect(50, 28, 32, 4);
    hazard(c, 30, H - 18, 36, 14);
    light(c, 84, 14, '#5dff8a');
  },
  barracks(c, W, H, col, base) {
    c.fillStyle = '#a08a5a';
    rr(c, 1, 1, W - 2, H - 2, 10);
    c.fill();
    c.strokeStyle = '#6a5a38';
    c.lineWidth = 3;
    c.setLineDash([5, 3]);
    c.stroke();
    c.setLineDash([]);
    block(c, 10, 10, 44, 38, base, 7, col);
    c.strokeStyle = shade(col, 0.4);
    c.lineWidth = 2;
    c.beginPath();
    c.moveTo(12, 24);
    c.lineTo(52, 24);
    c.stroke();
    c.fillStyle = '#222';
    c.fillRect(26, 42, 12, 8);
    c.fillStyle = '#444';
    c.fillRect(52, 4, 2, 18);
    c.fillStyle = col;
    c.fillRect(54, 4, 9, 6);
  },
  factory(c, W, H, col, base) {
    slab(c, W, H);
    c.fillStyle = 'rgba(0,0,0,0.35)';
    rr(c, 10, 10, 80, 66, 8);
    c.fill();
    c.fillStyle = lin(c, 6, 0, 86, 0, [
      [0, shade(base, -0.4)],
      [0.3, shade(base, 0.25)],
      [0.6, base],
      [1, shade(base, -0.5)],
    ]);
    rr(c, 6, 6, 80, 62, 8);
    c.fill();
    c.strokeStyle = shade(base, -0.6);
    c.lineWidth = 1;
    c.stroke();
    c.fillStyle = col;
    c.fillRect(10, 8, 72, 4);
    for (let y = 14; y < 64; y += 8) {
      c.strokeStyle = 'rgba(0,0,0,0.25)';
      c.beginPath();
      c.moveTo(8, y);
      c.lineTo(84, y);
      c.stroke();
    }
    c.fillStyle = '#26292d';
    c.fillRect(28, 62, 40, 30);
    hazard(c, 26, 60, 44, 5);
    light(c, 12, 12, '#ffcc33');
    light(c, 80, 12, '#ffcc33');
  },
  radar(c, W, H, col, base) {
    slab(c, W, H);
    block(c, 8, 26, 48, 30, base, 6, col);
    c.fillStyle = '#333';
    c.fillRect(28, 14, 8, 16);
    light(c, 50, 30, '#5df');
  },
  guard(c, W, H) {
    c.fillStyle = 'rgba(0,0,0,0.35)';
    c.beginPath();
    c.arc(W / 2 + 2, H / 2 + 3, 13, 0, Math.PI * 2);
    c.fill();
    c.fillStyle = rad(c, W / 2 - 4, H / 2 - 4, 2, 15, [
      [0, '#b9b4a6'],
      [1, '#5d594f'],
    ]);
    c.beginPath();
    c.arc(W / 2, H / 2, 13, 0, Math.PI * 2);
    c.fill();
    c.strokeStyle = '#3a372f';
    c.lineWidth = 1.5;
    c.stroke();
  },
  bastion(c, W, H, col, base) {
    c.fillStyle = 'rgba(0,0,0,0.35)';
    c.fillRect(5, 6, W - 6, H - 6);
    c.fillStyle = lin(c, 0, 0, W, H, [
      [0, '#a9adb2'],
      [1, '#55595e'],
    ]);
    c.fillRect(2, 2, W - 4, H - 4);
    c.strokeStyle = col;
    c.lineWidth = 2;
    c.strokeRect(3, 3, W - 6, H - 6);
  },
  spire(c, W, H, col, base) {
    // Drawn taller than its footprint; the sprite is offset upwards.
    const cx = W / 2;
    c.fillStyle = 'rgba(0,0,0,0.4)';
    c.beginPath();
    c.ellipse(cx + 8, H - 6, 16, 6, 0, 0, Math.PI * 2);
    c.fill();
    c.fillStyle = lin(c, cx - 10, 0, cx + 10, 0, [
      [0, '#3a0d0d'],
      [0.45, '#7a1e1e'],
      [0.55, '#2a0808'],
      [1, '#120303'],
    ]);
    c.beginPath();
    c.moveTo(cx, 2);
    c.lineTo(cx + 10, H - 10);
    c.lineTo(cx, H - 4);
    c.lineTo(cx - 10, H - 10);
    c.closePath();
    c.fill();
    c.strokeStyle = shade(col, -0.2);
    c.lineWidth = 1;
    c.stroke();
    light(c, cx, 6, '#ff2a2a');
  },
  tech(c, W, H, col, base) {
    slab(c, W, H);
    c.fillStyle = 'rgba(0,0,0,0.35)';
    c.beginPath();
    c.arc(W / 2 + 3, H / 2 + 4, 24, 0, Math.PI * 2);
    c.fill();
    c.fillStyle = rad(c, W / 2 - 8, H / 2 - 8, 3, 26, [
      [0, '#eef6ff'],
      [0.4, '#8fb5d9'],
      [1, '#2f4f6f'],
    ]);
    c.beginPath();
    c.arc(W / 2, H / 2, 23, 0, Math.PI * 2);
    c.fill();
    c.strokeStyle = col;
    c.lineWidth = 3;
    c.stroke();
    c.strokeStyle = '#333';
    c.lineWidth = 1.5;
    c.beginPath();
    c.moveTo(W / 2, H / 2);
    c.lineTo(W / 2 + 12, H / 2 - 20);
    c.stroke();
    light(c, W / 2 + 12, H / 2 - 20, '#ff5050');
  },
  ion(c, W, H, col, base) {
    slab(c, W, H);
    for (let r = 26; r > 4; r -= 5) {
      c.fillStyle = r % 10 === 6 ? '#c8ced6' : '#7b838d';
      c.beginPath();
      c.arc(W / 2, H / 2, r, 0, Math.PI * 2);
      c.fill();
    }
    c.fillStyle = rad(c, W / 2, H / 2, 0, 10, [
      [0, '#ffffff'],
      [0.4, '#6ff3ff'],
      [1, 'rgba(0,120,255,0)'],
    ]);
    c.beginPath();
    c.arc(W / 2, H / 2, 10, 0, Math.PI * 2);
    c.fill();
    c.strokeStyle = col;
    c.lineWidth = 2;
    c.beginPath();
    c.arc(W / 2, H / 2, 27, 0, Math.PI * 2);
    c.stroke();
  },
  silo(c, W, H, col, base) {
    slab(c, W, H);
    hazard(c, 6, 6, W - 12, H - 12);
    c.fillStyle = '#2a2d31';
    c.fillRect(12, 12, W / 2 - 13, H - 24);
    c.fillRect(W / 2 + 1, 12, W / 2 - 13, H - 24);
    c.strokeStyle = '#55595e';
    c.strokeRect(12, 12, W - 24, H - 24);
    c.fillStyle = col;
    c.fillRect(W / 2 - 1, 12, 2, H - 24);
    light(c, 8, 8, '#ff2020');
    light(c, W - 8, H - 8, '#ff2020');
  },
  wall(c, W, H) {
    c.fillStyle = 'rgba(0,0,0,0.35)';
    c.fillRect(4, 5, W - 4, H - 4);
    c.fillStyle = lin(c, 0, 0, 0, H, [
      [0, '#c2c2bc'],
      [1, '#6d6d67'],
    ]);
    c.fillRect(1, 1, W - 3, H - 3);
    c.strokeStyle = '#4a4a45';
    c.lineWidth = 1;
    c.strokeRect(1.5, 1.5, W - 4, H - 4);
    c.beginPath();
    c.moveTo(1, H / 2);
    c.lineTo(W - 2, H / 2);
    c.stroke();
  },
};

export function buildingSprite(type: string, color: string, faction: Faction = 'vanguard'): BuildingSprite {
  const key = `${type}|${color}|${faction}`;
  const hit = buildingCache.get(key);
  if (hit) return hit;
  const def = BUILDINGS[type];
  const W = def.w * TILE;
  const H = def.h * TILE;
  // The spire towers above its footprint, so its sprite is taller and offset upwards.
  const extraTop = type === 'spire' ? 34 : 0;
  const [cv, c] = canvas(W + 8, H + 8 + extraTop);
  (BUILDING_DRAW[type] ?? BUILDING_DRAW.wall)(c, W, H + extraTop, color, structureBase(BUILDINGS[type].faction ?? faction));
  const s = { img: cv, ox: 0, oy: -extraTop };
  buildingCache.set(key, s);
  return s;
}

/** Rotating parts drawn on top of buildings. */
export function buildingTurret(type: string, color: string): HTMLCanvasElement | null {
  const key = `turret|${type}|${color}`;
  if (misc.has(key)) return misc.get(key)!;
  let img: HTMLCanvasElement | null = null;
  if (type === 'guard') {
    img = centered(30, (c) => {
      barrel(c, 2, 12, 3);
      c.fillStyle = '#4a463d';
      c.beginPath();
      c.arc(0, 0, 6, 0, Math.PI * 2);
      c.fill();
      c.fillStyle = color;
      c.fillRect(-2, -2, 4, 4);
    });
  } else if (type === 'bastion') {
    img = centered(30, (c) => {
      c.fillStyle = '#3a3d42';
      rr(c, -7, -9, 16, 7, 2);
      c.fill();
      rr(c, -7, 2, 16, 7, 2);
      c.fill();
      c.fillStyle = '#d33';
      for (let i = 0; i < 3; i++) {
        c.fillRect(6, -8 + i * 2, 3, 1.3);
        c.fillRect(6, 3 + i * 2, 3, 1.3);
      }
      c.fillStyle = color;
      c.beginPath();
      c.arc(0, 0, 4, 0, Math.PI * 2);
      c.fill();
    });
  } else if (type === 'radar') {
    img = centered(40, (c) => {
      c.fillStyle = lin(c, -14, 0, 14, 0, [
        [0, '#e6e9ec'],
        [1, '#80868d'],
      ]);
      c.beginPath();
      c.ellipse(0, 0, 6, 16, 0, -Math.PI / 2, Math.PI / 2);
      c.fill();
      c.strokeStyle = '#444';
      c.lineWidth = 1.5;
      c.stroke();
      c.beginPath();
      c.moveTo(0, 0);
      c.lineTo(10, 0);
      c.stroke();
      c.fillStyle = color;
      c.beginPath();
      c.arc(10, 0, 2, 0, Math.PI * 2);
      c.fill();
    });
  }
  if (img) misc.set(key, img);
  return img;
}

// ------------------------------------------------------------------ nature

export function oreSprites(): HTMLCanvasElement[][] {
  const key = 'ore';
  const cached = misc.get(key) as unknown as HTMLCanvasElement[][] | undefined;
  if (cached) return cached;
  const levels: HTMLCanvasElement[][] = [];
  for (let lvl = 0; lvl < 4; lvl++) {
    const variants: HTMLCanvasElement[] = [];
    for (let v = 0; v < 4; v++) {
      const [cv, c] = canvas(TILE, TILE);
      let seed = lvl * 31 + v * 7 + 1;
      const rnd = () => (seed = (seed * 16807) % 2147483647) / 2147483647;
      const n = 2 + lvl * 2;
      for (let i = 0; i < n; i++) {
        const x = 5 + rnd() * 22;
        const y = 8 + rnd() * 20;
        const h = 4 + rnd() * (4 + lvl * 3);
        const w = 2 + rnd() * 3;
        const g = lin(c, x - w, y - h, x + w, y, [
          [0, '#eaffe9'],
          [0.35, '#59ff7c'],
          [1, '#0b7a2a'],
        ]);
        c.fillStyle = 'rgba(0,0,0,0.3)';
        c.beginPath();
        c.ellipse(x + 2, y, w + 1, 1.6, 0, 0, Math.PI * 2);
        c.fill();
        c.fillStyle = g;
        c.beginPath();
        c.moveTo(x, y - h);
        c.lineTo(x + w, y - h * 0.3);
        c.lineTo(x + w * 0.6, y);
        c.lineTo(x - w * 0.6, y);
        c.lineTo(x - w, y - h * 0.3);
        c.closePath();
        c.fill();
      }
      variants.push(cv);
    }
    levels.push(variants);
  }
  misc.set(key, levels as unknown as HTMLCanvasElement);
  return levels;
}

export function blossomSprite(): HTMLCanvasElement {
  const key = 'blossom';
  if (misc.has(key)) return misc.get(key)!;
  const [cv, c] = canvas(64, 64);
  c.fillStyle = 'rgba(0,0,0,0.35)';
  c.beginPath();
  c.ellipse(36, 50, 18, 6, 0, 0, Math.PI * 2);
  c.fill();
  for (let i = 0; i < 9; i++) {
    const a = -Math.PI / 2 + (i - 4) * 0.32;
    const len = 18 + (i % 3) * 6;
    const x1 = 32 + Math.cos(a) * len;
    const y1 = 48 + Math.sin(a) * len;
    c.strokeStyle = lin(c, 32, 48, x1, y1, [
      [0, '#0b5a20'],
      [1, '#9dffb0'],
    ]);
    c.lineWidth = 4 - (i % 2);
    c.beginPath();
    c.moveTo(32, 48);
    c.lineTo(x1, y1);
    c.stroke();
  }
  c.fillStyle = rad(c, 32, 40, 1, 12, [
    [0, '#ffffff'],
    [0.3, '#7dff9a'],
    [1, 'rgba(20,160,60,0)'],
  ]);
  c.beginPath();
  c.arc(32, 40, 12, 0, Math.PI * 2);
  c.fill();
  misc.set(key, cv);
  return cv;
}

export function treeSprite(variant: number): HTMLCanvasElement {
  const key = `tree${variant}`;
  if (misc.has(key)) return misc.get(key)!;
  const [cv, c] = canvas(40, 40);
  const r = 9 + (variant % 3) * 2;
  c.fillStyle = 'rgba(0,0,0,0.35)';
  c.beginPath();
  c.ellipse(24, 26, r, r * 0.7, 0, 0, Math.PI * 2);
  c.fill();
  const hue = variant % 2 === 0 ? ['#7fbf4d', '#2f6b23', '#173d12'] : ['#9ccf5a', '#3f7a2a', '#1c4416'];
  for (let i = 0; i < 4; i++) {
    const x = 18 + Math.cos(i * 1.7 + variant) * 4;
    const y = 18 + Math.sin(i * 1.7 + variant) * 4;
    c.fillStyle = rad(c, x - 3, y - 3, 1, r, [
      [0, hue[0]],
      [0.6, hue[1]],
      [1, hue[2]],
    ]);
    c.beginPath();
    c.arc(x, y, r * 0.75, 0, Math.PI * 2);
    c.fill();
  }
  misc.set(key, cv);
  return cv;
}

// ------------------------------------------------------------------ icons

/**
 * Sidebar cameo for a buildable item: the unit posed at a three-quarter angle
 * against a dusty battlefield backdrop, in a bevelled metal frame.
 */
export function iconFor(id: string, color: string, faction: Faction = 'vanguard'): HTMLCanvasElement {
  const key = `icon|${id}|${color}|${faction}`;
  if (misc.has(key)) return misc.get(key)!;
  const [cv, c] = canvas(64, 48);
  const ember = (UNITS[id]?.faction ?? BUILDINGS[id]?.faction ?? faction) === 'ember';
  // Hazy sky over cracked desert ground.
  c.fillStyle = lin(c, 0, 0, 0, 48, [
    [0, ember ? '#3a2c2a' : '#6d5e43'],
    [0.55, ember ? '#5a443a' : '#9a8460'],
    [0.56, ember ? '#3d2f28' : '#6f5a3c'],
    [1, ember ? '#1f1714' : '#3d3020'],
  ]);
  c.fillRect(0, 0, 64, 48);
  c.strokeStyle = 'rgba(0,0,0,0.25)';
  c.lineWidth = 0.8;
  for (let i = 0; i < 6; i++) {
    c.beginPath();
    c.moveTo((i * 13) % 64, 30 + ((i * 7) % 18));
    c.lineTo(((i * 13) % 64) + 9, 33 + ((i * 11) % 14));
    c.stroke();
  }
  const u = UNITS[id];
  if (u && u.cls === 'infantry') {
    // Standing portrait with a ground shadow.
    c.fillStyle = 'rgba(0,0,0,0.35)';
    c.beginPath();
    c.ellipse(33, 45, 12, 3, 0, 0, Math.PI * 2);
    c.fill();
    c.save();
    c.translate(32, 22);
    c.scale(0.95, 0.95);
    drawInfantryPortrait(c, id, palette(u.faction ?? faction, color));
    c.restore();
  } else if (u) {
    const s = unitSprite(id, color, faction);
    const pal = palette(u.faction ?? faction, color);
    // Infantry art is tiny, so zoom it right in; draw the vector art directly so it stays sharp.
    const scale = u.cls === 'infantry' ? (u.hero ? 2.6 : 3.1) : Math.min(2.6, 54 / s.size) * 1.2;
    // Fake a three-quarter view: rotate, then squash vertically.
    c.save();
    c.translate(32, u.air ? 22 : 26);
    c.scale(1, 0.72);
    c.fillStyle = 'rgba(0,0,0,0.35)';
    c.beginPath();
    c.ellipse(3, u.air ? 18 : 6, s.size * scale * 0.32, s.size * scale * 0.18, 0, 0, Math.PI * 2);
    c.fill();
    c.rotate(-Math.PI / 5);
    c.scale(scale, scale);
    if (u.cls === 'infantry') drawInfantryFrame(c, id, pal, 2);
    else {
      drawBody(c, id, pal, 0);
      if (s.turret) drawTurret(c, id, pal);
    }
    c.restore();
  } else if (BUILDINGS[id]) {
    const s = buildingSprite(id, color, faction);
    const scale = Math.min(44 / s.img.height, 58 / s.img.width, 1.2);
    c.drawImage(s.img, 32 - (s.img.width * scale) / 2, 24 - (s.img.height * scale) / 2, s.img.width * scale, s.img.height * scale);
    const t = buildingTurret(id, color);
    if (t && id !== 'radar') c.drawImage(t, 32 - 15 * scale, 24 - 15 * scale, 30 * scale, 30 * scale);
  }
  // Vignette and bevel frame.
  c.fillStyle = rad(c, 32, 24, 18, 44, [
    [0, 'rgba(0,0,0,0)'],
    [1, 'rgba(0,0,0,0.55)'],
  ]);
  c.fillRect(0, 0, 64, 48);
  c.strokeStyle = 'rgba(255,255,255,0.18)';
  c.lineWidth = 1;
  c.strokeRect(0.5, 0.5, 63, 47);
  c.strokeStyle = 'rgba(0,0,0,0.6)';
  c.strokeRect(1.5, 1.5, 61, 45);
  misc.set(key, cv);
  return cv;
}

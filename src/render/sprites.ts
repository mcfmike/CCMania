import { TILE } from '../game/constants';
import { BUILDINGS, UNITS } from '../game/defs';
import { canvas, shade } from './color';

/**
 * Every sprite in the game is drawn procedurally here, so the project ships
 * without a single binary asset. Results are cached per type + team colour.
 */

type Ctx = CanvasRenderingContext2D;

export interface UnitSprite {
  body: HTMLCanvasElement[];
  turret: HTMLCanvasElement | null;
  size: number;
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

function rr(c: Ctx, x: number, y: number, w: number, h: number, r: number): void {
  c.beginPath();
  c.roundRect(x, y, w, h, r);
}

function lin(c: Ctx, x0: number, y0: number, x1: number, y1: number, stops: [number, string][]): CanvasGradient {
  const g = c.createLinearGradient(x0, y0, x1, y1);
  for (const [o, col] of stops) g.addColorStop(o, col);
  return g;
}

function rad(c: Ctx, x: number, y: number, r0: number, r1: number, stops: [number, string][]): CanvasGradient {
  const g = c.createRadialGradient(x, y, r0, x, y, r1);
  for (const [o, col] of stops) g.addColorStop(o, col);
  return g;
}

function tracks(c: Ctx, len: number, w: number, gap: number): void {
  for (const sy of [-1, 1]) {
    const y = sy > 0 ? gap : -gap - w;
    c.fillStyle = '#1d1f22';
    rr(c, -len / 2, y, len, w, 2);
    c.fill();
    c.strokeStyle = '#3c4046';
    c.lineWidth = 1;
    for (let x = -len / 2 + 2; x < len / 2; x += 3) {
      c.beginPath();
      c.moveTo(x, y + 0.5);
      c.lineTo(x, y + w - 0.5);
      c.stroke();
    }
  }
}

function hull(c: Ctx, len: number, wid: number, color: string, r = 3): void {
  c.fillStyle = lin(c, 0, -wid / 2, 0, wid / 2, [
    [0, shade(color, 0.35)],
    [0.5, color],
    [1, shade(color, -0.45)],
  ]);
  rr(c, -len / 2, -wid / 2, len, wid, r);
  c.fill();
  c.strokeStyle = shade(color, -0.6);
  c.lineWidth = 1;
  c.stroke();
}

function barrel(c: Ctx, x0: number, len: number, w: number, y = 0): void {
  c.fillStyle = lin(c, 0, y - w / 2, 0, y + w / 2, [
    [0, '#9aa0a6'],
    [1, '#2d3035'],
  ]);
  c.fillRect(x0, y - w / 2, len, w);
  c.fillStyle = '#1a1c1f';
  c.fillRect(x0 + len - 2, y - w / 2 - 0.5, 2, w + 1);
}

function centered(size: number, draw: (c: Ctx) => void): HTMLCanvasElement {
  const [cv, c] = canvas(size, size);
  c.translate(size / 2, size / 2);
  draw(c);
  return cv;
}

function drawInfantry(c: Ctx, color: string, type: string, frame: number): void {
  c.scale(1.35, 1.35);
  const leg = frame === 0 ? 2 : frame === 1 ? -2 : 0;
  c.fillStyle = '#2b2b26';
  c.fillRect(-2 + leg, -3, 3, 2);
  c.fillRect(-2 - leg, 1, 3, 2);
  if (type === 'flamer') {
    c.fillStyle = '#d0661c';
    rr(c, -5, -2.5, 3, 5, 1);
    c.fill();
  }
  c.fillStyle = shade(color, -0.1);
  c.beginPath();
  c.ellipse(0, 0, 3, 3.8, 0, 0, Math.PI * 2);
  c.fill();
  c.strokeStyle = shade(color, -0.6);
  c.lineWidth = 0.8;
  c.stroke();
  // weapon
  c.fillStyle = '#222';
  if (type === 'rocketeer') {
    c.fillStyle = '#556b2f';
    c.fillRect(-3, -3.5, 10, 2.2);
  } else if (type === 'engineer') {
    c.fillStyle = '#ffd400';
    c.fillRect(1, 1, 3, 3);
  } else if (type === 'flamer') {
    c.fillRect(1, 0.5, 6, 1.4);
    c.fillStyle = '#ff7a1a';
    c.fillRect(6.5, 0.4, 1.5, 1.6);
  } else if (type === 'commando') {
    c.fillRect(0, 0.5, 9, 1.2);
  } else {
    c.fillRect(1, 0.6, 6, 1.2);
  }
  // head / helmet
  c.fillStyle = type === 'engineer' ? '#ffd400' : type === 'commando' ? '#1a1a1a' : shade(color, -0.35);
  c.beginPath();
  c.arc(0.5, 0, 2, 0, Math.PI * 2);
  c.fill();
  if (type === 'commando') {
    c.fillStyle = '#d42020';
    c.fillRect(-1.5, -0.6, 1.4, 1.2);
  }
}

export function unitSprite(type: string, color: string): UnitSprite {
  const key = `${type}|${color}`;
  const hit = unitCache.get(key);
  if (hit) return hit;
  const def = UNITS[type];
  const size = Math.ceil(def.radius * 2.9);
  let s: UnitSprite;
  if (def.cls === 'infantry') {
    const frames = [0, 1, 2].map((f) => centered(size + 10, (c) => drawInfantry(c, color, type, f)));
    s = { body: frames, turret: null, size: size + 10 };
  } else {
    let turret: HTMLCanvasElement | null = null;
    const body = centered(size, (c) => {
      switch (type) {
        case 'lancer':
          tracks(c, 26, 5, 6);
          hull(c, 22, 14, color);
          c.fillStyle = shade(color, -0.3);
          c.fillRect(7, -6, 3, 12);
          break;
        case 'titan':
          tracks(c, 34, 7, 8);
          hull(c, 30, 18, color, 4);
          c.fillStyle = shade(color, -0.3);
          c.fillRect(10, -8, 4, 16);
          c.fillStyle = '#ffcc33';
          c.fillRect(-14, -1, 3, 2);
          break;
        case 'harvester':
          tracks(c, 30, 6, 8);
          c.fillStyle = lin(c, 0, -10, 0, 10, [
            [0, '#d8c27a'],
            [1, '#7a6a35'],
          ]);
          rr(c, -15, -9, 22, 18, 3);
          c.fill();
          c.fillStyle = 'rgba(80,255,140,0.55)';
          rr(c, -12, -6, 14, 12, 2);
          c.fill();
          c.strokeStyle = '#2a2a1a';
          c.lineWidth = 1;
          for (let x = -10; x < 2; x += 3) {
            c.beginPath();
            c.moveTo(x, -6);
            c.lineTo(x, 6);
            c.stroke();
          }
          c.fillStyle = color;
          c.fillRect(-15, -9, 22, 3);
          c.fillStyle = '#444';
          rr(c, 7, -8, 6, 16, 2);
          c.fill();
          c.fillStyle = '#9a9a9a';
          for (let y = -8; y < 8; y += 3) c.fillRect(13, y, 3, 2);
          break;
        case 'raider':
          c.fillStyle = '#111';
          for (const [x, y] of [
            [-7, -8],
            [5, -8],
            [-7, 5],
            [5, 5],
          ])
            c.fillRect(x, y, 6, 3);
          hull(c, 20, 11, color, 4);
          c.strokeStyle = '#222';
          c.lineWidth = 1.5;
          c.strokeRect(-5, -4, 8, 8);
          barrel(c, 0, 10, 2);
          break;
        case 'howitzer':
          tracks(c, 24, 5, 5);
          hull(c, 20, 11, color);
          c.fillStyle = shade(color, -0.25);
          rr(c, -6, -5, 10, 10, 2);
          c.fill();
          barrel(c, 0, 18, 3.5);
          break;
        case 'wraith':
          tracks(c, 24, 4, 6);
          c.fillStyle = lin(c, 0, -8, 0, 8, [
            [0, '#4a4f57'],
            [1, '#15171a'],
          ]);
          c.beginPath();
          c.moveTo(13, 0);
          c.lineTo(-11, -9);
          c.lineTo(-8, 0);
          c.lineTo(-11, 9);
          c.closePath();
          c.fill();
          c.strokeStyle = color;
          c.lineWidth = 1.5;
          c.stroke();
          c.fillStyle = '#26292e';
          c.fillRect(-4, -8, 9, 3);
          c.fillRect(-4, 5, 9, 3);
          c.fillStyle = color;
          c.fillRect(3, -8, 2, 3);
          c.fillRect(3, 5, 2, 3);
          break;
      }
    });
    if (def.turret) {
      turret = centered(size, (c) => {
        if (type === 'titan') {
          barrel(c, 2, 18, 3, -3);
          barrel(c, 2, 18, 3, 3);
          c.fillStyle = lin(c, 0, -8, 0, 8, [
            [0, shade(color, 0.4)],
            [1, shade(color, -0.4)],
          ]);
          rr(c, -9, -8, 16, 16, 4);
          c.fill();
          c.strokeStyle = shade(color, -0.6);
          c.stroke();
          c.fillStyle = '#3a3d42';
          c.fillRect(-7, -12, 9, 4);
          c.fillRect(-7, 8, 9, 4);
          c.fillStyle = '#d33';
          for (let i = 0; i < 3; i++) {
            c.fillRect(-6 + i * 3, -11, 1.5, 2);
            c.fillRect(-6 + i * 3, 9, 1.5, 2);
          }
        } else {
          barrel(c, 2, 14, 3);
          c.fillStyle = rad(c, -1, -1, 1, 7, [
            [0, shade(color, 0.45)],
            [1, shade(color, -0.35)],
          ]);
          c.beginPath();
          c.arc(0, 0, 6, 0, Math.PI * 2);
          c.fill();
          c.strokeStyle = shade(color, -0.6);
          c.lineWidth = 1;
          c.stroke();
          c.fillStyle = shade(color, -0.5);
          c.beginPath();
          c.arc(-2, 0, 1.6, 0, Math.PI * 2);
          c.fill();
        }
      });
    }
    s = { body: [body], turret, size };
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

function block(c: Ctx, x: number, y: number, w: number, h: number, color: string, lift = 6): void {
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

const BUILDING_DRAW: Record<string, (c: Ctx, W: number, H: number, col: string) => void> = {
  conyard(c, W, H, col) {
    slab(c, W, H);
    block(c, 8, 10, 56, 54, col, 8);
    c.strokeStyle = shade(col, -0.45);
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
  power(c, W, H, col) {
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
    block(c, 8, 38, 48, 20, col, 5);
    c.fillStyle = '#7ff7ff';
    c.fillRect(14, 44, 36, 3);
    light(c, 32, 45, '#4fe8ff');
  },
  refinery(c, W, H, col) {
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
    block(c, 44, 10, 44, 56, col, 7);
    c.fillStyle = shade(col, -0.4);
    c.fillRect(50, 18, 32, 4);
    c.fillRect(50, 28, 32, 4);
    hazard(c, 30, H - 18, 36, 14);
    light(c, 84, 14, '#5dff8a');
  },
  barracks(c, W, H, col) {
    c.fillStyle = '#a08a5a';
    rr(c, 1, 1, W - 2, H - 2, 10);
    c.fill();
    c.strokeStyle = '#6a5a38';
    c.lineWidth = 3;
    c.setLineDash([5, 3]);
    c.stroke();
    c.setLineDash([]);
    block(c, 10, 10, 44, 38, col, 7);
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
  factory(c, W, H, col) {
    slab(c, W, H);
    c.fillStyle = 'rgba(0,0,0,0.35)';
    rr(c, 10, 10, 80, 66, 8);
    c.fill();
    c.fillStyle = lin(c, 6, 0, 86, 0, [
      [0, shade(col, -0.4)],
      [0.3, shade(col, 0.25)],
      [0.6, col],
      [1, shade(col, -0.5)],
    ]);
    rr(c, 6, 6, 80, 62, 8);
    c.fill();
    c.strokeStyle = shade(col, -0.6);
    c.lineWidth = 1;
    c.stroke();
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
  radar(c, W, H, col) {
    slab(c, W, H);
    block(c, 8, 26, 48, 30, col, 6);
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
  bastion(c, W, H, col) {
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
  spire(c, W, H, col) {
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
  tech(c, W, H, col) {
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
  ion(c, W, H, col) {
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
  silo(c, W, H, col) {
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

export function buildingSprite(type: string, color: string): BuildingSprite {
  const key = `${type}|${color}`;
  const hit = buildingCache.get(key);
  if (hit) return hit;
  const def = BUILDINGS[type];
  const W = def.w * TILE;
  const H = def.h * TILE;
  // The spire towers above its footprint, so its sprite is taller and offset upwards.
  const extraTop = type === 'spire' ? 34 : 0;
  const [cv, c] = canvas(W + 8, H + 8 + extraTop);
  (BUILDING_DRAW[type] ?? BUILDING_DRAW.wall)(c, W, H + extraTop, color);
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
      const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
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

/** Sidebar cameo for a buildable item. */
export function iconFor(id: string, color: string): HTMLCanvasElement {
  const key = `icon|${id}|${color}`;
  if (misc.has(key)) return misc.get(key)!;
  const [cv, c] = canvas(64, 48);
  c.fillStyle = lin(c, 0, 0, 0, 48, [
    [0, '#2a3238'],
    [1, '#0d1114'],
  ]);
  c.fillRect(0, 0, 64, 48);
  if (UNITS[id]) {
    const s = unitSprite(id, color);
    const scale = Math.min(2.4, 40 / s.size);
    c.save();
    c.translate(32, 26);
    c.rotate(-Math.PI / 6);
    c.scale(scale, scale);
    c.drawImage(s.body[0], -s.size / 2, -s.size / 2);
    if (s.turret) c.drawImage(s.turret, -s.size / 2, -s.size / 2);
    c.restore();
  } else if (BUILDINGS[id]) {
    const s = buildingSprite(id, color);
    const scale = Math.min(44 / s.img.height, 58 / s.img.width, 1.2);
    c.drawImage(s.img, 32 - (s.img.width * scale) / 2, 24 - (s.img.height * scale) / 2, s.img.width * scale, s.img.height * scale);
    const t = buildingTurret(id, color);
    if (t && id !== 'radar') c.drawImage(t, 32 - 15 * scale, 24 - 15 * scale, 30 * scale, 30 * scale);
  }
  misc.set(key, cv);
  return cv;
}

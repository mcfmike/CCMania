import { canvas } from './color';

export const enum Sprite {
  Smoke = 0,
  DarkSmoke,
  Fire,
  Spark,
  Flash,
  Green,
  Cyan,
  Red,
  Debris,
  Blood,
}

function soft(stops: [number, string][], size = 64): HTMLCanvasElement {
  const [cv, c] = canvas(size, size);
  const g = c.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2);
  for (const [o, col] of stops) g.addColorStop(o, col);
  c.fillStyle = g;
  c.fillRect(0, 0, size, size);
  return cv;
}

let sprites: HTMLCanvasElement[] | null = null;
function getSprites(): HTMLCanvasElement[] {
  if (sprites) return sprites;
  const debris = canvas(8, 8);
  debris[1].fillStyle = '#2b2622';
  debris[1].fillRect(1, 2, 6, 4);
  debris[1].fillStyle = '#5a524a';
  debris[1].fillRect(1, 2, 3, 2);
  sprites = [
    soft([
      [0, 'rgba(120,118,112,0.8)'],
      [0.5, 'rgba(95,92,88,0.45)'],
      [1, 'rgba(80,80,80,0)'],
    ]),
    soft([
      [0, 'rgba(25,22,20,0.9)'],
      [0.5, 'rgba(30,28,25,0.5)'],
      [1, 'rgba(20,20,20,0)'],
    ]),
    soft([
      [0, 'rgba(255,250,210,1)'],
      [0.25, 'rgba(255,190,60,0.95)'],
      [0.6, 'rgba(240,80,10,0.5)'],
      [1, 'rgba(200,30,0,0)'],
    ]),
    soft(
      [
        [0, 'rgba(255,255,255,1)'],
        [0.3, 'rgba(255,220,90,0.9)'],
        [1, 'rgba(255,150,0,0)'],
      ],
      16,
    ),
    soft([
      [0, 'rgba(255,255,255,1)'],
      [0.2, 'rgba(255,245,200,0.9)'],
      [0.5, 'rgba(255,190,80,0.35)'],
      [1, 'rgba(255,120,0,0)'],
    ]),
    soft(
      [
        [0, 'rgba(240,255,240,1)'],
        [0.3, 'rgba(90,255,130,0.8)'],
        [1, 'rgba(0,200,60,0)'],
      ],
      32,
    ),
    soft(
      [
        [0, 'rgba(255,255,255,1)'],
        [0.3, 'rgba(120,230,255,0.85)'],
        [1, 'rgba(0,120,255,0)'],
      ],
      32,
    ),
    soft(
      [
        [0, 'rgba(255,255,255,1)'],
        [0.3, 'rgba(255,80,60,0.85)'],
        [1, 'rgba(200,0,0,0)'],
      ],
      32,
    ),
    debris[0],
    soft(
      [
        [0, 'rgba(110,10,10,0.9)'],
        [1, 'rgba(80,0,0,0)'],
      ],
      16,
    ),
  ];
  return sprites;
}

const ADDITIVE = new Set<number>([Sprite.Fire, Sprite.Spark, Sprite.Flash, Sprite.Green, Sprite.Cyan, Sprite.Red]);

export interface SpawnOpts {
  vx?: number;
  vy?: number;
  vz?: number;
  z?: number;
  life?: number;
  size?: number;
  grow?: number;
  alpha?: number;
  gravity?: number;
  drag?: number;
  spin?: number;
}

export interface Beam {
  x1: number;
  y1: number;
  x2: number;
  y2: number;
  life: number;
  max: number;
  color: string;
  width: number;
  glow: boolean;
}

export interface Ring {
  x: number;
  y: number;
  r0: number;
  r1: number;
  life: number;
  max: number;
  color: string;
  width: number;
}

/** Structure-of-arrays particle pool; thousands of particles stay cheap. */
export class Particles {
  readonly max = 14000;
  n = 0;
  private x = new Float32Array(this.max);
  private y = new Float32Array(this.max);
  private z = new Float32Array(this.max);
  private vx = new Float32Array(this.max);
  private vy = new Float32Array(this.max);
  private vz = new Float32Array(this.max);
  private life = new Float32Array(this.max);
  private maxLife = new Float32Array(this.max);
  private size = new Float32Array(this.max);
  private grow = new Float32Array(this.max);
  private alpha = new Float32Array(this.max);
  private gravity = new Float32Array(this.max);
  private drag = new Float32Array(this.max);
  private rot = new Float32Array(this.max);
  private spin = new Float32Array(this.max);
  private sprite = new Uint8Array(this.max);
  beams: Beam[] = [];
  rings: Ring[] = [];

  spawn(s: Sprite, x: number, y: number, o: SpawnOpts = {}): void {
    if (this.n >= this.max) return;
    const i = this.n++;
    this.sprite[i] = s;
    this.x[i] = x;
    this.y[i] = y;
    this.z[i] = o.z ?? 0;
    this.vx[i] = o.vx ?? 0;
    this.vy[i] = o.vy ?? 0;
    this.vz[i] = o.vz ?? 0;
    this.life[i] = this.maxLife[i] = o.life ?? 1;
    this.size[i] = o.size ?? 10;
    this.grow[i] = o.grow ?? 0;
    this.alpha[i] = o.alpha ?? 1;
    this.gravity[i] = o.gravity ?? 0;
    this.drag[i] = o.drag ?? 0;
    this.rot[i] = Math.random() * 6.28;
    this.spin[i] = o.spin ?? 0;
  }

  beam(b: Omit<Beam, 'life'>): void {
    this.beams.push({ ...b, life: b.max });
  }

  ring(r: Omit<Ring, 'life'>): void {
    this.rings.push({ ...r, life: r.max });
  }

  update(dt: number): void {
    let i = 0;
    while (i < this.n) {
      this.life[i] -= dt;
      if (this.life[i] <= 0) {
        this.n--;
        this.copy(this.n, i);
        continue;
      }
      const d = 1 - this.drag[i] * dt;
      this.vx[i] *= d;
      this.vy[i] *= d;
      this.x[i] += this.vx[i] * dt;
      this.y[i] += this.vy[i] * dt;
      if (this.gravity[i] !== 0) {
        this.vz[i] -= this.gravity[i] * dt;
        this.z[i] += this.vz[i] * dt;
        if (this.z[i] < 0) {
          this.z[i] = 0;
          this.vz[i] *= -0.35;
          this.vx[i] *= 0.6;
          this.vy[i] *= 0.6;
        }
      } else this.z[i] += this.vz[i] * dt;
      this.size[i] += this.grow[i] * dt;
      this.rot[i] += this.spin[i] * dt;
      i++;
    }
    for (const b of this.beams) b.life -= dt;
    this.beams = this.beams.filter((b) => b.life > 0);
    for (const r of this.rings) r.life -= dt;
    this.rings = this.rings.filter((r) => r.life > 0);
  }

  private copy(from: number, to: number): void {
    this.x[to] = this.x[from];
    this.y[to] = this.y[from];
    this.z[to] = this.z[from];
    this.vx[to] = this.vx[from];
    this.vy[to] = this.vy[from];
    this.vz[to] = this.vz[from];
    this.life[to] = this.life[from];
    this.maxLife[to] = this.maxLife[from];
    this.size[to] = this.size[from];
    this.grow[to] = this.grow[from];
    this.alpha[to] = this.alpha[from];
    this.gravity[to] = this.gravity[from];
    this.drag[to] = this.drag[from];
    this.rot[to] = this.rot[from];
    this.spin[to] = this.spin[from];
    this.sprite[to] = this.sprite[from];
  }

  draw(ctx: CanvasRenderingContext2D, x0: number, y0: number, x1: number, y1: number): void {
    const sp = getSprites();
    for (const pass of [0, 1]) {
      ctx.globalCompositeOperation = pass === 0 ? 'source-over' : 'lighter';
      for (let i = 0; i < this.n; i++) {
        const s = this.sprite[i];
        if (ADDITIVE.has(s) !== (pass === 1)) continue;
        const x = this.x[i];
        const y = this.y[i] - this.z[i];
        const size = this.size[i];
        if (x + size < x0 || x - size > x1 || y + size < y0 || y - size > y1) continue;
        const t = this.life[i] / this.maxLife[i];
        ctx.globalAlpha = Math.max(0, Math.min(1, this.alpha[i] * (s === Sprite.Smoke || s === Sprite.DarkSmoke ? Math.min(1, t * 1.5) : t)));
        if (s === Sprite.Debris) {
          ctx.save();
          ctx.translate(x, y);
          ctx.rotate(this.rot[i]);
          ctx.drawImage(sp[s], -size / 2, -size / 2, size, size);
          ctx.restore();
        } else ctx.drawImage(sp[s], x - size / 2, y - size / 2, size, size);
      }
    }
    ctx.globalAlpha = 1;
    ctx.globalCompositeOperation = 'lighter';
    for (const b of this.beams) {
      const t = b.life / b.max;
      ctx.globalAlpha = t;
      ctx.lineCap = 'round';
      if (b.glow) {
        ctx.strokeStyle = b.color;
        ctx.lineWidth = b.width * 3;
        ctx.globalAlpha = t * 0.35;
        ctx.beginPath();
        ctx.moveTo(b.x1, b.y1);
        ctx.lineTo(b.x2, b.y2);
        ctx.stroke();
        ctx.globalAlpha = t;
      }
      ctx.strokeStyle = b.glow ? '#ffffff' : b.color;
      ctx.lineWidth = b.width;
      ctx.beginPath();
      ctx.moveTo(b.x1, b.y1);
      ctx.lineTo(b.x2, b.y2);
      ctx.stroke();
    }
    for (const r of this.rings) {
      const t = 1 - r.life / r.max;
      ctx.globalAlpha = (1 - t) * 0.9;
      ctx.strokeStyle = r.color;
      ctx.lineWidth = r.width * (1 - t) + 1;
      ctx.beginPath();
      ctx.arc(r.x, r.y, r.r0 + (r.r1 - r.r0) * Math.sqrt(t), 0, Math.PI * 2);
      ctx.stroke();
    }
    ctx.globalAlpha = 1;
    ctx.globalCompositeOperation = 'source-over';
  }
}

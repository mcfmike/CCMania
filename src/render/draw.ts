import { canvas } from './color';

/** Small canvas drawing helpers shared by the procedural sprite modules. */

export type Ctx = CanvasRenderingContext2D;

export function rr(c: Ctx, x: number, y: number, w: number, h: number, r: number): void {
  c.beginPath();
  c.roundRect(x, y, w, h, r);
}

export function lin(c: Ctx, x0: number, y0: number, x1: number, y1: number, stops: [number, string][]): CanvasGradient {
  const g = c.createLinearGradient(x0, y0, x1, y1);
  for (const [o, col] of stops) g.addColorStop(o, col);
  return g;
}

export function rad(c: Ctx, x: number, y: number, r0: number, r1: number, stops: [number, string][]): CanvasGradient {
  const g = c.createRadialGradient(x, y, r0, x, y, r1);
  for (const [o, col] of stops) g.addColorStop(o, col);
  return g;
}

export function poly(c: Ctx, pts: number[]): void {
  c.beginPath();
  c.moveTo(pts[0], pts[1]);
  for (let i = 2; i < pts.length; i += 2) c.lineTo(pts[i], pts[i + 1]);
  c.closePath();
}

export function centered(size: number, draw: (c: Ctx) => void): HTMLCanvasElement {
  const [cv, c] = canvas(size, size);
  c.translate(size / 2, size / 2);
  draw(c);
  return cv;
}

export function barrel(c: Ctx, x0: number, len: number, w: number, y = 0): void {
  c.fillStyle = lin(c, 0, y - w / 2, 0, y + w / 2, [
    [0, '#a3a9af'],
    [0.5, '#5d6268'],
    [1, '#24272b'],
  ]);
  c.fillRect(x0, y - w / 2, len, w);
  c.fillStyle = '#16181a';
  c.fillRect(x0 + len - 2, y - w / 2 - 0.5, 2, w + 1);
}

export function tracks(c: Ctx, len: number, w: number, gap: number): void {
  for (const sy of [-1, 1]) {
    const y = sy > 0 ? gap : -gap - w;
    c.fillStyle = '#1b1c1e';
    rr(c, -len / 2, y, len, w, 2);
    c.fill();
    c.strokeStyle = '#43464b';
    c.lineWidth = 1;
    for (let x = -len / 2 + 2; x < len / 2; x += 3) {
      c.beginPath();
      c.moveTo(x, y + 0.5);
      c.lineTo(x, y + w - 0.5);
      c.stroke();
    }
  }
}

export function glow(c: Ctx, x: number, y: number, r: number, col: string): void {
  c.fillStyle = rad(c, x, y, 0, r, [
    [0, '#ffffff'],
    [0.35, col],
    [1, 'rgba(0,0,0,0)'],
  ]);
  c.beginPath();
  c.arc(x, y, r, 0, Math.PI * 2);
  c.fill();
}

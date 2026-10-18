import { TILE } from '../game/constants';
import { BUILDINGS } from '../game/defs';
import type { Entity, GameEvent } from '../game/entity';
import { ORE_MAX } from '../game/map';
import { hash2 } from '../game/rng';
import type { World } from '../game/world';
import { canvas, withAlpha } from './color';
import { Particles, Sprite } from './particles';
import { blossomSprite, buildingSprite, buildingTurret, oreSprites, unitSprite } from './sprites';
import { TerrainRenderer } from './terrain';

export interface Placement {
  id: string;
  tx: number;
  ty: number;
  ok: boolean;
}

export interface ViewState {
  selected: Set<number>;
  hoverId: number;
  placement: Placement | null;
  dragBox: { x0: number; y0: number; x1: number; y1: number } | null;
  cursor: 'none' | 'super' | 'sell' | 'repair' | 'attack' | 'move' | 'enter';
  mouse: { x: number; y: number };
}

interface Special {
  kind: 'ion' | 'nukeUp' | 'nukeDown';
  x: number;
  y: number;
  x2: number;
  y2: number;
  t: number;
  dur: number;
  done?: boolean;
}

interface Marker {
  x: number;
  y: number;
  t: number;
  color: string;
}

export class Renderer {
  readonly ctx: CanvasRenderingContext2D;
  cam = { x: 0, y: 0, zoom: 1 };
  vw = 800;
  vh = 600;
  dpr = 1;
  particles = new Particles();
  terrain: TerrainRenderer;
  private shake = 0;
  flash = 0;
  private time = 0;
  private specials: Special[] = [];
  private markers: Marker[] = [];
  private shroud: HTMLCanvasElement;
  private shroudCtx: CanvasRenderingContext2D;
  private shroudImg: ImageData;
  private shroudTick = -1;
  private trailTimer = 0;

  constructor(
    readonly el: HTMLCanvasElement,
    readonly world: World,
  ) {
    this.ctx = el.getContext('2d')!;
    this.terrain = new TerrainRenderer(world.map);
    [this.shroud, this.shroudCtx] = canvas(world.map.w, world.map.h);
    this.shroudImg = this.shroudCtx.createImageData(world.map.w, world.map.h);
    this.resize();
  }

  resize(): void {
    const r = this.el.getBoundingClientRect();
    this.dpr = Math.min(2, window.devicePixelRatio || 1);
    this.vw = Math.max(1, r.width);
    this.vh = Math.max(1, r.height);
    this.el.width = Math.round(this.vw * this.dpr);
    this.el.height = Math.round(this.vh * this.dpr);
    this.clampCam();
  }

  screenToWorld(sx: number, sy: number): { x: number; y: number } {
    return { x: this.cam.x + sx / this.cam.zoom, y: this.cam.y + sy / this.cam.zoom };
  }

  centerOn(x: number, y: number): void {
    this.cam.x = x - this.vw / this.cam.zoom / 2;
    this.cam.y = y - this.vh / this.cam.zoom / 2;
    this.clampCam();
  }

  clampCam(): void {
    const ww = this.world.map.w * TILE;
    const wh = this.world.map.h * TILE;
    const vw = this.vw / this.cam.zoom;
    const vh = this.vh / this.cam.zoom;
    this.cam.x = vw >= ww ? (ww - vw) / 2 : Math.max(0, Math.min(ww - vw, this.cam.x));
    this.cam.y = vh >= wh ? (wh - vh) / 2 : Math.max(0, Math.min(wh - vh, this.cam.y));
  }

  zoomAt(sx: number, sy: number, factor: number): void {
    const before = this.screenToWorld(sx, sy);
    this.cam.zoom = Math.max(0.4, Math.min(2.5, this.cam.zoom * factor));
    this.cam.x = before.x - sx / this.cam.zoom;
    this.cam.y = before.y - sy / this.cam.zoom;
    this.clampCam();
  }

  marker(x: number, y: number, color: string): void {
    this.markers.push({ x, y, t: 0, color });
  }

  // ---------------------------------------------------------------- events -> effects

  consume(events: GameEvent[]): void {
    for (const e of events) {
      if (e.t === 'fx') this.effect(e.kind, e.x, e.y, e.x2 ?? e.x, e.y2 ?? e.y, e.size ?? 1, e.color);
      else if (e.t === 'decal') this.terrain.addDecal(e.kind, e.x, e.y, e.size);
      else if (e.t === 'shake') this.shake = Math.min(40, this.shake + e.amount);
    }
  }

  private explosion(x: number, y: number, size: number, big: boolean): void {
    const p = this.particles;
    const r = Math.random;
    p.spawn(Sprite.Flash, x, y, { size: 40 * size + 20, life: 0.18 });
    const fire = Math.round((big ? 10 : 5) * size + 3);
    for (let i = 0; i < fire; i++) {
      const a = r() * Math.PI * 2;
      const s = r() * 40 * size;
      p.spawn(Sprite.Fire, x + Math.cos(a) * 4 * size, y + Math.sin(a) * 4 * size, { vx: Math.cos(a) * s, vy: Math.sin(a) * s, vz: 10 + r() * 30, size: 14 * size + r() * 10, grow: 12, life: 0.35 + r() * 0.4, drag: 2 });
    }
    for (let i = 0; i < fire; i++) {
      const a = r() * Math.PI * 2;
      const s = r() * 25 * size;
      p.spawn(i % 3 ? Sprite.Smoke : Sprite.DarkSmoke, x, y, { vx: Math.cos(a) * s, vy: Math.sin(a) * s - 6, vz: 15 + r() * 20, size: 12 * size + 8, grow: 18 + 10 * size, life: 1.4 + r() * 1.6, alpha: 0.8, drag: 1.5 });
    }
    for (let i = 0; i < 10 * size; i++) {
      const a = r() * Math.PI * 2;
      const s = 60 + r() * 140 * size;
      p.spawn(Sprite.Spark, x, y, { vx: Math.cos(a) * s, vy: Math.sin(a) * s, vz: 30 + r() * 120, gravity: 260, size: 4 + r() * 3, life: 0.4 + r() * 0.5, drag: 1 });
    }
    if (big)
      for (let i = 0; i < 6 * size; i++) {
        const a = r() * Math.PI * 2;
        const s = 40 + r() * 100 * size;
        p.spawn(Sprite.Debris, x, y, { vx: Math.cos(a) * s, vy: Math.sin(a) * s, vz: 80 + r() * 150, gravity: 400, size: 4 + r() * 5, life: 1.2 + r(), spin: (r() - 0.5) * 20, drag: 0.5 });
      }
    p.ring({ x, y, r0: 4, r1: 30 * size + 10, max: 0.35, color: 'rgba(255,220,160,0.8)', width: 3 });
  }

  private effect(kind: string, x: number, y: number, x2: number, y2: number, size: number, color?: string): void {
    const p = this.particles;
    const r = Math.random;
    switch (kind) {
      case 'explosion':
        this.explosion(x, y, size, false);
        break;
      case 'bigExplosion':
        this.explosion(x, y, size, true);
        break;
      case 'smallHit':
        p.spawn(Sprite.Flash, x, y, { size: 10 + size * 10, life: 0.1 });
        for (let i = 0; i < 3 + size * 2; i++) {
          const a = r() * Math.PI * 2;
          p.spawn(Sprite.Spark, x, y, { vx: Math.cos(a) * 80, vy: Math.sin(a) * 80, vz: 40, gravity: 300, size: 3, life: 0.25 });
        }
        if (size > 0.6) p.spawn(Sprite.Smoke, x, y, { size: 10 * size, grow: 20, life: 0.8, alpha: 0.6, vz: 10 });
        break;
      case 'muzzle': {
        const a = Math.atan2(y2 - y, x2 - x);
        p.spawn(Sprite.Flash, x + Math.cos(a) * 3, y + Math.sin(a) * 3, { size: 9 * size + 4, life: 0.07 });
        if (size > 1) p.spawn(Sprite.Smoke, x, y, { size: 14, grow: 25, life: 1, alpha: 0.6, vx: Math.cos(a) * 20, vy: Math.sin(a) * 20 });
        break;
      }
      case 'tracer':
        p.beam({ x1: x, y1: y, x2, y2, max: 0.06, color: color ?? '#ffe58a', width: 1.2, glow: false });
        break;
      case 'laser':
        p.beam({ x1: x, y1: y, x2, y2, max: 0.35, color: '#ff3020', width: 3, glow: true });
        p.spawn(Sprite.Red, x, y, { size: 30, life: 0.35 });
        p.spawn(Sprite.Red, x2, y2, { size: 40, life: 0.4 });
        for (let i = 0; i < 6; i++) p.spawn(Sprite.Fire, x2, y2, { vx: (r() - 0.5) * 60, vy: (r() - 0.5) * 60, size: 12, grow: 10, life: 0.4 });
        break;
      case 'flame': {
        const a = Math.atan2(y2 - y, x2 - x);
        const d = Math.hypot(x2 - x, y2 - y);
        for (let i = 0; i < 14; i++) {
          const s = d * (1.6 + r() * 0.8);
          const aa = a + (r() - 0.5) * 0.35;
          p.spawn(Sprite.Fire, x, y, { vx: Math.cos(aa) * s, vy: Math.sin(aa) * s, size: 6 + r() * 6, grow: 26, life: 0.45 + r() * 0.1, drag: 1.5 });
        }
        break;
      }
      case 'smoke':
        p.spawn(Sprite.Smoke, x, y, { size: 12, grow: 20, life: 1.5, alpha: 0.7, vz: 20 });
        break;
      case 'infantryDeath':
        p.spawn(Sprite.Blood, x, y, { size: 10, life: 8, alpha: 0.7 });
        p.spawn(Sprite.Smoke, x, y, { size: 6, grow: 8, life: 0.6, alpha: 0.5 });
        break;
      case 'crush':
        for (let i = 0; i < 4; i++) p.spawn(Sprite.Blood, x + (r() - 0.5) * 8, y + (r() - 0.5) * 8, { size: 10 + r() * 6, life: 10, alpha: 0.8 });
        break;
      case 'sparkle':
        for (let i = 0; i < 6 * size; i++) {
          const a = r() * Math.PI * 2;
          p.spawn(color === '#7fd1ff' ? Sprite.Cyan : color === '#ffd84a' ? Sprite.Spark : Sprite.Green, x, y, { vx: Math.cos(a) * 30, vy: Math.sin(a) * 30, vz: 20 + r() * 30, size: 6 + r() * 4, life: 0.6 + r() * 0.4 });
        }
        break;
      case 'sell':
      case 'capture':
        for (let i = 0; i < 20 * size; i++) {
          const a = r() * Math.PI * 2;
          p.spawn(kind === 'sell' ? Sprite.Smoke : Sprite.Cyan, x + Math.cos(a) * size * 12, y + Math.sin(a) * size * 12, { vz: 20 + r() * 30, size: 10 + r() * 10, grow: 10, life: 1 + r() });
        }
        p.ring({ x, y, r0: 4, r1: size * 30, max: 0.7, color: color ?? '#9ff', width: 3 });
        break;
      case 'c4':
        for (let i = 0; i < 5; i++) p.spawn(Sprite.Red, x, y, { size: 16, life: 0.5 * (i + 1), alpha: 1 });
        break;
      case 'ion':
        this.specials.push({ kind: 'ion', x, y, x2, y2, t: 0, dur: 2.6 });
        break;
      case 'nukeLaunch':
        this.specials.push({ kind: 'nukeUp', x, y, x2, y2, t: 0, dur: 1.4 });
        this.specials.push({ kind: 'nukeDown', x: x2, y: y2, x2, y2, t: -1.6, dur: 1.6 });
        for (let i = 0; i < 30; i++) p.spawn(Sprite.Smoke, x + (r() - 0.5) * 30, y + (r() - 0.5) * 30, { size: 20, grow: 30, life: 2 + r() * 2, alpha: 0.8 });
        break;
      case 'nuke':
        this.nukeBlast(x, y);
        break;
    }
  }

  private nukeBlast(x: number, y: number): void {
    const p = this.particles;
    const r = Math.random;
    this.flash = 1;
    p.spawn(Sprite.Flash, x, y, { size: 900, life: 0.9 });
    for (let k = 0; k < 4; k++) p.ring({ x, y, r0: 10, r1: 260 + k * 90, max: 1 + k * 0.4, color: k % 2 ? 'rgba(255,240,200,0.9)' : 'rgba(255,140,60,0.9)', width: 10 });
    for (let i = 0; i < 180; i++) {
      const a = r() * Math.PI * 2;
      const s = r() * 220;
      p.spawn(Sprite.Fire, x, y, { vx: Math.cos(a) * s, vy: Math.sin(a) * s * 0.7, vz: r() * 40, size: 30 + r() * 30, grow: 30, life: 0.8 + r() * 1.2, drag: 1.5 });
    }
    // Mushroom column and cap.
    for (let i = 0; i < 120; i++) {
      const h = r() * 220;
      p.spawn(i % 2 ? Sprite.Fire : Sprite.DarkSmoke, x + (r() - 0.5) * 30, y, { z: h * 0.3, vz: 60 + h * 0.6, size: 30 + r() * 20, grow: 25, life: 2.5 + r() * 2, drag: 0.6, alpha: 0.9 });
    }
    for (let i = 0; i < 90; i++) {
      const a = r() * Math.PI * 2;
      p.spawn(Sprite.Smoke, x + Math.cos(a) * 30, y + Math.sin(a) * 15, { z: 160, vz: 25, vx: Math.cos(a) * 60, vy: Math.sin(a) * 30, size: 50, grow: 30, life: 4 + r() * 2, alpha: 0.85, drag: 0.6 });
    }
    for (let i = 0; i < 60; i++) {
      const a = r() * Math.PI * 2;
      const s = 150 + r() * 350;
      p.spawn(Sprite.Debris, x, y, { vx: Math.cos(a) * s, vy: Math.sin(a) * s, vz: 150 + r() * 250, gravity: 400, size: 5 + r() * 6, life: 2 + r(), spin: (r() - 0.5) * 20 });
    }
  }

  private ionBlast(x: number, y: number): void {
    const p = this.particles;
    const r = Math.random;
    this.flash = Math.max(this.flash, 0.5);
    p.spawn(Sprite.Cyan, x, y, { size: 400, life: 0.6 });
    for (let k = 0; k < 3; k++) p.ring({ x, y, r0: 10, r1: 140 + k * 60, max: 0.8 + k * 0.3, color: 'rgba(140,240,255,0.9)', width: 8 });
    for (let i = 0; i < 120; i++) {
      const a = r() * Math.PI * 2;
      const s = r() * 260;
      p.spawn(i % 3 ? Sprite.Cyan : Sprite.Spark, x, y, { vx: Math.cos(a) * s, vy: Math.sin(a) * s, vz: r() * 200, gravity: 200, size: 6 + r() * 10, life: 0.6 + r() });
    }
    this.explosion(x, y, 3, true);
  }

  // ---------------------------------------------------------------- frame

  render(view: ViewState, dt: number): void {
    const ctx = this.ctx;
    this.time += dt;
    this.particles.update(dt);
    this.updateSpecials(dt);
    this.shake *= Math.pow(0.02, dt);
    this.flash = Math.max(0, this.flash - dt * 1.2);

    const z = this.cam.zoom;
    const sx = this.shake > 0.3 ? (Math.random() - 0.5) * this.shake : 0;
    const sy = this.shake > 0.3 ? (Math.random() - 0.5) * this.shake : 0;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.fillStyle = '#000';
    ctx.fillRect(0, 0, this.el.width, this.el.height);
    const s = this.dpr * z;
    ctx.setTransform(s, 0, 0, s, (-this.cam.x + sx) * s, (-this.cam.y + sy) * s);
    const x0 = this.cam.x - 40;
    const y0 = this.cam.y - 40;
    const x1 = this.cam.x + this.vw / z + 40;
    const y1 = this.cam.y + this.vh / z + 40;

    this.terrain.draw(ctx, x0, y0, x1, y1);
    this.drawOre(ctx, x0, y0, x1, y1);
    this.drawMarkers(ctx, dt);
    this.drawEntities(ctx, view, x0, y0, x1, y1, dt);
    this.drawProjectiles(ctx, dt);
    this.particles.draw(ctx, x0, y0, x1, y1);
    this.drawSpecials(ctx);
    this.drawShroud(ctx);
    this.drawOverlays(ctx, view);

    if (this.flash > 0) {
      ctx.setTransform(1, 0, 0, 1, 0, 0);
      ctx.fillStyle = `rgba(255,250,235,${Math.min(1, this.flash)})`;
      ctx.fillRect(0, 0, this.el.width, this.el.height);
    }
  }

  private drawOre(ctx: CanvasRenderingContext2D, x0: number, y0: number, x1: number, y1: number): void {
    const m = this.world.map;
    const ore = oreSprites();
    const tx0 = Math.max(0, Math.floor(x0 / TILE));
    const ty0 = Math.max(0, Math.floor(y0 / TILE));
    const tx1 = Math.min(m.w - 1, Math.floor(x1 / TILE));
    const ty1 = Math.min(m.h - 1, Math.floor(y1 / TILE));
    for (let ty = ty0; ty <= ty1; ty++) {
      for (let tx = tx0; tx <= tx1; tx++) {
        const o = m.ore[ty * m.w + tx];
        if (!o) continue;
        const lvl = o < ORE_MAX * 0.2 ? 0 : o < ORE_MAX * 0.45 ? 1 : o < ORE_MAX * 0.75 ? 2 : 3;
        const v = Math.floor(hash2(tx, ty, 9) * 4);
        ctx.drawImage(ore[lvl][v], tx * TILE, ty * TILE);
      }
    }
    const bs = blossomSprite();
    for (const b of m.blossoms) {
      const bx = b.x * TILE + TILE / 2;
      const by = b.y * TILE + TILE / 2;
      if (bx < x0 || bx > x1 || by < y0 || by > y1) continue;
      ctx.drawImage(bs, bx - 32, by - 48);
      const pulse = 0.5 + 0.5 * Math.sin(this.time * 3 + b.x);
      ctx.globalCompositeOperation = 'lighter';
      ctx.globalAlpha = 0.25 + pulse * 0.35;
      ctx.fillStyle = '#3dff70';
      ctx.beginPath();
      ctx.arc(bx, by - 8, 10 + pulse * 6, 0, Math.PI * 2);
      ctx.fill();
      ctx.globalAlpha = 1;
      ctx.globalCompositeOperation = 'source-over';
      if (Math.random() < 0.03) this.particles.spawn(Sprite.Green, bx + (Math.random() - 0.5) * 30, by - 10, { vz: 30, size: 6, life: 1.2 });
    }
  }

  private drawEntities(ctx: CanvasRenderingContext2D, view: ViewState, x0: number, y0: number, x1: number, y1: number, dt: number): void {
    const w = this.world;
    const list: Entity[] = [];
    for (const e of w.entities) {
      if (e.dead) continue;
      const r = e.radius + 40;
      if (e.x + r < x0 || e.x - r > x1 || e.y + r < y0 || e.y - r > y1) continue;
      list.push(e);
    }
    list.sort((a, b) => (a.isBuilding ? (a.ty + a.b.h) * TILE - 8 : a.y) - (b.isBuilding ? (b.ty + b.b.h) * TILE - 8 : b.y));
    for (const e of list) {
      const vis = w.visibleToHuman(e);
      const own = e.owner === w.humanIndex;
      if (!vis && !(own && e.cloaked)) continue;
      const color = w.players[e.owner].color;
      let alpha = 1;
      if (e.cloaked) alpha = own ? 0.4 : 0.22 + 0.1 * Math.sin(this.time * 12);
      ctx.globalAlpha = alpha;
      if (e.isBuilding) this.drawBuilding(ctx, e, color, dt);
      else this.drawUnit(ctx, e, color, dt);
      ctx.globalAlpha = 1;
    }
    // Selection / health overlays on top of everything.
    for (const e of list) {
      if (!w.visibleToHuman(e) && e.owner !== w.humanIndex) continue;
      const sel = view.selected.has(e.id);
      const hover = view.hoverId === e.id;
      const recent = w.tick - e.lastDamaged < 90;
      if (sel) this.drawBrackets(ctx, e);
      if (sel || hover || (recent && e.hp < e.maxHp)) this.drawHealth(ctx, e);
      if (e.isUnit && e.rank > 0) this.drawRank(ctx, e);
      if (e.isBuilding && e.owner === w.humanIndex) {
        if (e.repairing && Math.floor(this.time * 3) % 2 === 0) this.drawIcon(ctx, e.x, e.y, '🔧');
        else if (w.players[e.owner].lowPower && e.b.power < 0 && Math.floor(this.time * 2) % 2 === 0) this.drawIcon(ctx, e.x, e.y, '⚡');
      }
      if (sel && e.isBuilding && e.rallyX >= 0) {
        ctx.strokeStyle = 'rgba(120,255,120,0.7)';
        ctx.setLineDash([6, 6]);
        ctx.lineWidth = 1.5;
        ctx.beginPath();
        ctx.moveTo(e.x, e.y);
        ctx.lineTo(e.rallyX, e.rallyY);
        ctx.stroke();
        ctx.setLineDash([]);
        ctx.fillStyle = '#7f7';
        ctx.fillRect(e.rallyX, e.rallyY - 12, 2, 12);
        ctx.fillRect(e.rallyX + 2, e.rallyY - 12, 7, 5);
      }
    }
  }

  private drawUnit(ctx: CanvasRenderingContext2D, e: Entity, color: string, dt: number): void {
    const s = unitSprite(e.type, color);
    const d = e.u;
    if (d.cls === 'vehicle') {
      ctx.fillStyle = 'rgba(0,0,0,0.28)';
      ctx.beginPath();
      ctx.ellipse(e.x + 3, e.y + 4, d.radius * 1.05, d.radius * 0.8, 0, 0, Math.PI * 2);
      ctx.fill();
    }
    let frame = 0;
    if (d.cls === 'infantry') frame = e.moving ? Math.floor(e.walk / 5) % 2 : 2;
    ctx.save();
    ctx.translate(e.x, e.y);
    ctx.rotate(e.angle);
    ctx.drawImage(s.body[frame], -s.size / 2, -s.size / 2);
    ctx.restore();
    if (s.turret) {
      ctx.save();
      ctx.translate(e.x, e.y);
      ctx.rotate(e.turret);
      ctx.drawImage(s.turret, -s.size / 2, -s.size / 2);
      ctx.restore();
    }
    if (e.flash > 0) {
      ctx.globalCompositeOperation = 'lighter';
      ctx.fillStyle = 'rgba(255,255,255,0.35)';
      ctx.beginPath();
      ctx.arc(e.x, e.y, d.radius, 0, Math.PI * 2);
      ctx.fill();
      ctx.globalCompositeOperation = 'source-over';
    }
    // Ambient effects.
    if (d.harvester && e.harvestState === 'harvesting' && Math.random() < dt * 8) {
      this.particles.spawn(Sprite.Green, e.x + Math.cos(e.angle) * 14, e.y + Math.sin(e.angle) * 14, { vz: 20, vx: (Math.random() - 0.5) * 30, size: 6, life: 0.5 });
      this.particles.spawn(Sprite.Smoke, e.x + Math.cos(e.angle) * 14, e.y + Math.sin(e.angle) * 14, { size: 8, grow: 10, life: 0.6, alpha: 0.3 });
    }
    if (d.cls === 'vehicle' && e.moving && Math.random() < dt * 6) {
      this.particles.spawn(Sprite.Smoke, e.x - Math.cos(e.angle) * d.radius, e.y - Math.sin(e.angle) * d.radius, { size: 6, grow: 12, life: 0.7, alpha: 0.25 });
    }
    if (e.hp < e.maxHp * 0.35 && d.cls === 'vehicle' && Math.random() < dt * 10) {
      this.particles.spawn(Sprite.DarkSmoke, e.x, e.y, { vz: 30, size: 8, grow: 14, life: 1.2, alpha: 0.6 });
    }
  }

  private drawBuilding(ctx: CanvasRenderingContext2D, e: Entity, color: string, dt: number): void {
    const s = buildingSprite(e.type, color);
    const px = e.tx * TILE + s.ox;
    const py = e.ty * TILE + s.oy;
    if (e.built < 1) {
      const h = s.img.height * e.built;
      ctx.drawImage(s.img, 0, s.img.height - h, s.img.width, h, px, py + s.img.height - h, s.img.width, h);
      ctx.strokeStyle = 'rgba(255,220,80,0.8)';
      ctx.lineWidth = 1;
      ctx.strokeRect(e.tx * TILE + 1, e.ty * TILE + 1, e.b.w * TILE - 2, e.b.h * TILE - 2);
      if (Math.random() < dt * 20) this.particles.spawn(Sprite.Spark, px + Math.random() * e.b.w * TILE, py + s.img.height - h, { vz: 40, gravity: 200, size: 4, life: 0.4 });
      return;
    }
    ctx.drawImage(s.img, px, py);
    const turret = buildingTurret(e.type, color);
    if (turret) {
      ctx.save();
      ctx.translate(e.x, e.type === 'radar' ? e.y - 10 : e.y);
      ctx.rotate(e.type === 'radar' ? this.time * 1.5 : e.turret);
      ctx.drawImage(turret, -turret.width / 2, -turret.height / 2);
      ctx.restore();
    }
    if (e.c4At && Math.floor(this.time * 8) % 2 === 0) {
      ctx.fillStyle = '#ff2020';
      ctx.beginPath();
      ctx.arc(e.x, e.y, 4, 0, Math.PI * 2);
      ctx.fill();
    }
    if (e.flash > 0) {
      ctx.globalCompositeOperation = 'lighter';
      ctx.fillStyle = 'rgba(255,255,255,0.12)';
      ctx.fillRect(e.tx * TILE, e.ty * TILE, e.b.w * TILE, e.b.h * TILE);
      ctx.globalCompositeOperation = 'source-over';
    }
    const rnd = Math.random;
    if (e.type === 'power' && rnd() < dt * 3 && !this.world.players[e.owner].lowPower) {
      const x = e.tx * TILE + (rnd() < 0.5 ? 19 : 45);
      this.particles.spawn(Sprite.Smoke, x, e.ty * TILE + 21, { vz: 25, vx: 6, size: 10, grow: 14, life: 2, alpha: 0.35 });
    }
    if (e.type === 'refinery' && rnd() < dt * 2) this.particles.spawn(Sprite.Green, e.tx * TILE + 22, e.ty * TILE + 22, { vz: 20, size: 8, life: 1 });
    const ratio = e.hp / e.maxHp;
    if (ratio < 0.5 && rnd() < dt * (ratio < 0.25 ? 14 : 5)) {
      const x = e.tx * TILE + rnd() * e.b.w * TILE;
      const y = e.ty * TILE + rnd() * e.b.h * TILE;
      this.particles.spawn(Sprite.DarkSmoke, x, y, { vz: 30, vx: 8, size: 12, grow: 18, life: 2, alpha: 0.6 });
      if (ratio < 0.25) this.particles.spawn(Sprite.Fire, x, y, { vz: 30, size: 12, grow: 6, life: 0.5 });
    }
  }

  private drawBrackets(ctx: CanvasRenderingContext2D, e: Entity): void {
    let x: number;
    let y: number;
    let w: number;
    let h: number;
    if (e.isBuilding) {
      x = e.tx * TILE;
      y = e.ty * TILE;
      w = e.b.w * TILE;
      h = e.b.h * TILE;
    } else {
      const r = e.radius + 3;
      x = e.x - r;
      y = e.y - r;
      w = h = r * 2;
    }
    const l = Math.min(8, w / 3);
    ctx.strokeStyle = '#ffffff';
    ctx.lineWidth = 1.2;
    ctx.beginPath();
    for (const [cx, cy, dx, dy] of [
      [x, y, 1, 1],
      [x + w, y, -1, 1],
      [x, y + h, 1, -1],
      [x + w, y + h, -1, -1],
    ]) {
      ctx.moveTo(cx + dx * l, cy);
      ctx.lineTo(cx, cy);
      ctx.lineTo(cx, cy + dy * l);
    }
    ctx.stroke();
  }

  private drawHealth(ctx: CanvasRenderingContext2D, e: Entity): void {
    const ratio = Math.max(0, e.hp / e.maxHp);
    const w = e.isBuilding ? e.b.w * TILE - 6 : Math.max(16, e.radius * 2);
    const x = e.isBuilding ? e.tx * TILE + 3 : e.x - w / 2;
    const y = e.isBuilding ? e.ty * TILE - 6 : e.y - e.radius - 8;
    ctx.fillStyle = 'rgba(0,0,0,0.7)';
    ctx.fillRect(x - 1, y - 1, w + 2, 5);
    ctx.fillStyle = ratio > 0.5 ? '#3cff4a' : ratio > 0.25 ? '#ffd23c' : '#ff3c3c';
    ctx.fillRect(x, y, w * ratio, 3);
    if (e.isUnit && e.u.harvester) {
      const pips = Math.round((e.cargo / 700) * 6);
      for (let i = 0; i < 6; i++) {
        ctx.fillStyle = i < pips ? '#5dff8a' : 'rgba(0,0,0,0.6)';
        ctx.fillRect(x + i * (w / 6), y + 5, w / 6 - 1, 2);
      }
    }
  }

  private drawRank(ctx: CanvasRenderingContext2D, e: Entity): void {
    const x = e.x + e.radius;
    const y = e.y - e.radius - 2;
    ctx.fillStyle = '#ffd84a';
    ctx.strokeStyle = '#000';
    ctx.lineWidth = 0.8;
    for (let i = 0; i < e.rank; i++) {
      ctx.beginPath();
      ctx.moveTo(x - 3, y + i * 3);
      ctx.lineTo(x, y + i * 3 + 2);
      ctx.lineTo(x + 3, y + i * 3);
      ctx.lineTo(x + 3, y + i * 3 + 1.5);
      ctx.lineTo(x, y + i * 3 + 3.5);
      ctx.lineTo(x - 3, y + i * 3 + 1.5);
      ctx.closePath();
      ctx.fill();
      ctx.stroke();
    }
  }

  private drawIcon(ctx: CanvasRenderingContext2D, x: number, y: number, icon: string): void {
    ctx.font = '16px sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(icon, x, y);
  }

  private drawProjectiles(ctx: CanvasRenderingContext2D, dt: number): void {
    this.trailTimer += dt;
    const trail = this.trailTimer > 0.025;
    if (trail) this.trailTimer = 0;
    for (const p of this.world.projectiles) {
      if (p.dead) continue;
      if (p.kind === 'artillery') {
        const k = p.t / p.dur;
        const dist = Math.hypot(p.tx - p.sx, p.ty - p.sy);
        const h = Math.sin(Math.PI * k) * Math.min(180, dist * 0.4);
        ctx.fillStyle = 'rgba(0,0,0,0.35)';
        ctx.beginPath();
        ctx.arc(p.x, p.y, 2.5, 0, Math.PI * 2);
        ctx.fill();
        ctx.fillStyle = '#ffe9a0';
        ctx.beginPath();
        ctx.arc(p.x, p.y - h, 3, 0, Math.PI * 2);
        ctx.fill();
        if (trail) this.particles.spawn(Sprite.Smoke, p.x, p.y - h, { size: 5, grow: 8, life: 0.6, alpha: 0.4 });
      } else if (p.kind === 'rocket') {
        const a = Math.atan2(p.ty - p.y, p.tx - p.x);
        ctx.strokeStyle = '#ddd';
        ctx.lineWidth = 2.5;
        ctx.beginPath();
        ctx.moveTo(p.x - Math.cos(a) * 6, p.y - Math.sin(a) * 6);
        ctx.lineTo(p.x, p.y);
        ctx.stroke();
        ctx.globalCompositeOperation = 'lighter';
        ctx.fillStyle = 'rgba(255,170,60,0.9)';
        ctx.beginPath();
        ctx.arc(p.x - Math.cos(a) * 7, p.y - Math.sin(a) * 7, 2.5, 0, Math.PI * 2);
        ctx.fill();
        ctx.globalCompositeOperation = 'source-over';
        if (trail) this.particles.spawn(Sprite.Smoke, p.x - Math.cos(a) * 8, p.y - Math.sin(a) * 8, { size: 5, grow: 12, life: 0.7, alpha: 0.55 });
      } else {
        const a = Math.atan2(p.ty - p.sy, p.tx - p.sx);
        ctx.globalCompositeOperation = 'lighter';
        ctx.strokeStyle = 'rgba(255,220,120,0.9)';
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.moveTo(p.x - Math.cos(a) * 8, p.y - Math.sin(a) * 8);
        ctx.lineTo(p.x, p.y);
        ctx.stroke();
        ctx.globalCompositeOperation = 'source-over';
      }
    }
  }

  private updateSpecials(dt: number): void {
    for (const s of this.specials) {
      s.t += dt;
      if (s.kind === 'ion' && !s.done && s.t >= 1.6) {
        s.done = true;
        this.ionBlast(s.x, s.y);
      }
    }
    this.specials = this.specials.filter((s) => s.t < s.dur);
  }

  private drawSpecials(ctx: CanvasRenderingContext2D): void {
    ctx.globalCompositeOperation = 'lighter';
    for (const s of this.specials) {
      if (s.t < 0) continue;
      if (s.kind === 'ion') {
        const top = this.cam.y - 50;
        const charge = Math.min(1, s.t / 1.6);
        const width = s.t < 1.6 ? 2 + charge * 6 : 30 * Math.max(0, 1 - (s.t - 1.6) / 1.0);
        ctx.strokeStyle = 'rgba(120,230,255,0.35)';
        ctx.lineWidth = width * 3;
        ctx.beginPath();
        ctx.moveTo(s.x, top);
        ctx.lineTo(s.x, s.y);
        ctx.stroke();
        ctx.strokeStyle = 'rgba(255,255,255,0.9)';
        ctx.lineWidth = width;
        ctx.stroke();
        if (s.t < 1.6) {
          ctx.strokeStyle = `rgba(120,230,255,${0.4 + charge * 0.5})`;
          ctx.lineWidth = 2;
          for (let k = 0; k < 3; k++) {
            ctx.beginPath();
            ctx.arc(s.x, s.y, (1 - ((s.t * 1.5 + k / 3) % 1)) * 90, 0, Math.PI * 2);
            ctx.stroke();
          }
        }
      } else {
        const k = s.t / s.dur;
        const topY = this.cam.y - 60;
        const mx = s.kind === 'nukeUp' ? s.x : s.x2;
        const my = s.kind === 'nukeUp' ? s.y + (topY - s.y) * k * k : topY + (s.y2 - topY) * k * k;
        ctx.fillStyle = 'rgba(255,200,90,0.9)';
        ctx.beginPath();
        ctx.arc(mx, my + (s.kind === 'nukeUp' ? 14 : -14), 7, 0, Math.PI * 2);
        ctx.fill();
        ctx.globalCompositeOperation = 'source-over';
        ctx.fillStyle = '#e8e8e8';
        ctx.fillRect(mx - 3, my - 10, 6, 20);
        ctx.fillStyle = '#c22';
        ctx.fillRect(mx - 3, s.kind === 'nukeUp' ? my - 10 : my + 6, 6, 4);
        ctx.globalCompositeOperation = 'lighter';
        if (Math.random() < 0.8) this.particles.spawn(Sprite.Smoke, mx, my + (s.kind === 'nukeUp' ? 16 : -16), { size: 12, grow: 20, life: 1.2, alpha: 0.6 });
        if (s.kind === 'nukeDown') {
          ctx.strokeStyle = `rgba(255,40,40,${0.5 + 0.5 * Math.sin(this.time * 20)})`;
          ctx.lineWidth = 2;
          ctx.beginPath();
          ctx.arc(s.x2, s.y2, 5.5 * TILE, 0, Math.PI * 2);
          ctx.stroke();
        }
      }
    }
    ctx.globalCompositeOperation = 'source-over';
  }

  private drawShroud(ctx: CanvasRenderingContext2D): void {
    const w = this.world;
    if (w.humanIndex < 0) return;
    const p = w.players[w.humanIndex];
    if (this.shroudTick !== w.tick) {
      this.shroudTick = w.tick;
      const d = this.shroudImg.data;
      const fog = w.cfg.fog;
      for (let i = 0; i < p.explored.length; i++) {
        d[i * 4 + 3] = !p.explored[i] ? 255 : fog && !p.visible[i] ? 120 : 0;
      }
      this.shroudCtx.putImageData(this.shroudImg, 0, 0);
    }
    ctx.imageSmoothingEnabled = true;
    ctx.drawImage(this.shroud, 0, 0, w.map.w, w.map.h, -TILE / 2, -TILE / 2, w.map.w * TILE + TILE, w.map.h * TILE + TILE);
  }

  private drawMarkers(ctx: CanvasRenderingContext2D, dt: number): void {
    for (const m of this.markers) {
      m.t += dt;
      const k = m.t / 0.6;
      ctx.strokeStyle = withAlpha(m.color, 1 - k);
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.ellipse(m.x, m.y, 14 * (1 - k) + 3, 9 * (1 - k) + 2, 0, 0, Math.PI * 2);
      ctx.stroke();
    }
    this.markers = this.markers.filter((m) => m.t < 0.6);
  }

  private drawOverlays(ctx: CanvasRenderingContext2D, view: ViewState): void {
    const pl = view.placement;
    if (pl) {
      const def = BUILDINGS[pl.id];
      const w = this.world;
      const player = w.players[w.humanIndex];
      for (let y = 0; y < def.h; y++)
        for (let x = 0; x < def.w; x++) {
          const ok = w.map.buildable(pl.tx + x, pl.ty + y) && pl.ok;
          ctx.fillStyle = ok ? 'rgba(60,255,90,0.35)' : 'rgba(255,50,50,0.45)';
          ctx.fillRect((pl.tx + x) * TILE, (pl.ty + y) * TILE, TILE, TILE);
        }
      const s = buildingSprite(pl.id, player.color);
      ctx.globalAlpha = 0.6;
      ctx.drawImage(s.img, pl.tx * TILE + s.ox, pl.ty * TILE + s.oy);
      ctx.globalAlpha = 1;
    }
    if (view.dragBox) {
      const b = view.dragBox;
      ctx.strokeStyle = '#7dff7d';
      ctx.lineWidth = 1 / this.cam.zoom;
      ctx.fillStyle = 'rgba(120,255,120,0.08)';
      ctx.fillRect(Math.min(b.x0, b.x1), Math.min(b.y0, b.y1), Math.abs(b.x1 - b.x0), Math.abs(b.y1 - b.y0));
      ctx.strokeRect(Math.min(b.x0, b.x1), Math.min(b.y0, b.y1), Math.abs(b.x1 - b.x0), Math.abs(b.y1 - b.y0));
    }
    if (view.cursor === 'super') {
      const { x, y } = view.mouse;
      const p = this.world.players[this.world.humanIndex];
      const r = (p.superType === 'nuke' ? 5.5 : 3.5) * TILE;
      ctx.strokeStyle = `rgba(255,60,60,${0.6 + 0.4 * Math.sin(this.time * 10)})`;
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.arc(x, y, r, 0, Math.PI * 2);
      ctx.moveTo(x - r - 10, y);
      ctx.lineTo(x + r + 10, y);
      ctx.moveTo(x, y - r - 10);
      ctx.lineTo(x, y + r + 10);
      ctx.stroke();
    }
  }
}

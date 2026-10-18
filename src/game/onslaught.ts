import { PassClass, TICK_RATE, TILE } from './constants';
import { UNITS } from './defs';
import type { Entity, Player } from './entity';
import { nearestPassable } from './pathfinding';
import type { World } from './world';

/** Unit pool unlocked as the waves climb: [type, first wave, weight]. */
const POOL: [string, number, number][] = [
  ['rifleman', 1, 5],
  ['rocketeer', 1, 3],
  ['raider', 2, 3],
  ['flamer', 3, 2],
  ['lancer', 3, 4],
  ['howitzer', 6, 2],
  ['engineer', 7, 1],
  ['wraith', 8, 2],
  ['titan', 10, 2],
  ['commando', 12, 0.5],
];

/**
 * Survival mode: no enemy base, just endless escalating waves pouring in from
 * the map edges. Every 5th wave is a boss wave; every 10th wave also brings a
 * nuclear strike on your base.
 */
export class Onslaught {
  wave = 0;
  nextAt: number;
  private readonly interval: number;

  constructor(
    private world: World,
    readonly horde: Player,
  ) {
    const m = world.cfg.mania ? 0.6 : 1;
    this.interval = Math.round(70 * m * TICK_RATE);
    this.nextAt = Math.round(100 * m * TICK_RATE);
  }

  get secondsToNext(): number {
    return Math.max(0, Math.ceil((this.nextAt - this.world.tick) / TICK_RATE));
  }

  update(): void {
    const w = this.world;
    if (w.result !== 'playing') return;
    if (w.tick === this.nextAt - 10 * TICK_RATE && w.humanIndex >= 0) w.eva(w.humanIndex, 'wavewarn', 'Warning: enemy forces approaching', 1);
    if (w.tick >= this.nextAt) {
      this.spawnWave();
      this.nextAt = w.tick + this.interval;
    }
    if (w.tick % 45 === 0) this.retarget();
  }

  private spawnWave(): void {
    const w = this.world;
    this.wave++;
    const boss = this.wave % 5 === 0;
    let budget = Math.round(900 * Math.pow(1.32, this.wave - 1) * (w.cfg.mania ? 1.8 : 1) * (boss ? 1.6 : 1));
    const pool = POOL.filter(([, first]) => first <= this.wave + (boss ? 3 : 0));
    const spawned: Entity[] = [];
    const edges = this.spawnPoints(boss ? 3 : this.wave > 6 ? 2 : 1);
    let guard = 0;
    while (budget > 0 && guard++ < 400 && w.unitsOf(this.horde.index).length < w.unitCap()) {
      const type = boss && w.rng.chance(0.5) ? (this.wave >= 10 ? 'titan' : 'lancer') : this.pick(pool);
      const def = UNITS[type];
      budget -= def.cost;
      const at = edges[spawned.length % edges.length];
      const e = w.spawnNear(this.horde.index, def, at.x + w.rng.int(-2, 2), at.y + w.rng.int(-2, 2));
      if (e) {
        // Later waves arrive battle-hardened.
        if (this.wave >= 8) e.rank = this.wave >= 15 ? 2 : 1;
        spawned.push(e);
      }
    }
    w.message(boss ? `☠ BOSS WAVE ${this.wave}: ${spawned.length} hostiles inbound!` : `Wave ${this.wave}: ${spawned.length} hostiles inbound`);
    if (w.humanIndex >= 0) w.eva(w.humanIndex, 'wave', boss ? 'Warning: massive enemy force detected' : 'Enemy reinforcements have arrived', 1);
    this.attack(spawned);
    if (this.wave % 10 === 0) {
      const target = this.humanBuilding(w.map.w * TILE * 0.5, w.map.h * TILE * 0.5);
      if (target) {
        this.horde.superType = 'nuke';
        this.horde.superReady = true;
        w.fireSuper(this.horde, target.x, target.y);
      }
    }
  }

  private pick(pool: [string, number, number][]): string {
    const total = pool.reduce((s, p) => s + p[2], 0);
    let r = this.world.rng.next() * total;
    for (const [id, , weight] of pool) {
      r -= weight;
      if (r <= 0) return id;
    }
    return pool[0][0];
  }

  /** Edge cells far away from the player's base. */
  private spawnPoints(n: number): { x: number; y: number }[] {
    const w = this.world;
    const m = w.map;
    const home = m.starts[w.startOf[w.humanIndex]] ?? { x: 0, y: 0 };
    const pts: { x: number; y: number; d: number }[] = [];
    for (let i = 0; i < 64; i++) {
      const side = w.rng.int(0, 3);
      const t = w.rng.next();
      const x = side === 0 ? 1 : side === 1 ? m.w - 2 : Math.floor(t * m.w);
      const y = side === 2 ? 1 : side === 3 ? m.h - 2 : Math.floor(t * m.h);
      const c = nearestPassable(m, x, y, PassClass.Vehicle, 8);
      if (c) pts.push({ ...c, d: Math.hypot(c.x - home.x, c.y - home.y) });
    }
    pts.sort((a, b) => b.d - a.d);
    const top = pts.slice(0, Math.max(n * 4, 8));
    const out: { x: number; y: number }[] = [];
    for (let i = 0; i < n && top.length; i++) out.push(top.splice(w.rng.int(0, top.length - 1), 1)[0]);
    return out.length ? out : [{ x: 1, y: 1 }];
  }

  private humanBuilding(x: number, y: number): Entity | null {
    const w = this.world;
    let best: Entity | null = null;
    let bd = Infinity;
    for (const b of w.buildings) {
      if (b.dead || !w.isEnemy(b.owner, this.horde.index)) continue;
      const d = Math.hypot(b.x - x, b.y - y) + (b.b.wall ? 2000 : 0);
      if (d < bd) {
        bd = d;
        best = b;
      }
    }
    return best;
  }

  private attack(units: Entity[]): void {
    const w = this.world;
    for (const u of units) {
      const t = this.humanBuilding(u.x, u.y);
      if (!t) continue;
      if (u.u.engineer || u.u.commando) w.commandAttack([u.id], t.id);
      else w.commandMove([u.id], t.x, t.y, 'attackMove');
    }
  }

  private retarget(): void {
    const idle = this.world.unitsOf(this.horde.index).filter((u) => !u.order);
    if (idle.length) this.attack(idle);
  }
}

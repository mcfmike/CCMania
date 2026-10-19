import { PassClass, TICK_RATE, TILE } from './constants';
import { BUILDINGS } from './defs';
import type { Entity, Player } from './entity';
import { findNearestCell, nearestPassable } from './pathfinding';
import type { World } from './world';

interface Tuning {
  wave: number;
  growth: number;
  firstAttack: number;
  interval: number;
  refineries: number;
  factories: number;
  towers: number;
  reserve: number;
  superweapon: boolean;
  repair: boolean;
}

const TUNING: Record<Player['cfg']['difficulty'], Tuning> = {
  easy: { wave: 5, growth: 1, firstAttack: 420, interval: 150, refineries: 1, factories: 1, towers: 1, reserve: 600, superweapon: false, repair: false },
  normal: { wave: 8, growth: 2, firstAttack: 300, interval: 120, refineries: 2, factories: 1, towers: 2, reserve: 300, superweapon: true, repair: true },
  hard: { wave: 10, growth: 3, firstAttack: 220, interval: 100, refineries: 3, factories: 2, towers: 3, reserve: 150, superweapon: true, repair: true },
  insane: { wave: 14, growth: 5, firstAttack: 150, interval: 70, refineries: 3, factories: 2, towers: 4, reserve: 0, superweapon: true, repair: true },
};

// Weighted build mixes; units the faction can't build are filtered out at pick time.
const INFANTRY_MIX: [string, number][] = [
  ['rifleman', 4],
  ['grenadier', 3],
  ['dragoon', 3],
  ['medic', 0.8],
  ['cyborg', 2],
  ['jumpjet', 1.5],
  ['tactician', 0.6],
  ['engineer', 0.4],
  ['ghost', 0.5],
  ['vega', 0.6],
  ['ankha', 0.6],
];
const VEHICLE_MIX: [string, number][] = [
  ['badger', 2],
  ['raider', 2],
  ['titan', 5],
  ['raptor', 5],
  ['apc', 2],
  ['termite', 1.2],
  ['mrls', 2],
  ['artillery', 2],
  ['disruptor', 2],
  ['stealth', 2.5],
  ['inferno', 2],
  ['mammoth', 2.5],
  ['repairbot', 0.6],
  ['ecm', 0.5],
  ['sensor', 0.3],
];
const AIR_MIX: [string, number][] = [
  ['orca', 3],
  ['cicada', 1.5],
  ['harpy', 3],
  ['banshee', 2],
];

/** Skirmish opponent: builds a base, keeps harvesters busy and throws escalating waves at you. */
export class AI {
  private t: Tuning;
  private waveSize: number;
  private nextWaveAt: number;
  private attackers = new Set<number>();
  private blocked = new Map<string, number>();
  private home: { x: number; y: number };

  constructor(
    private world: World,
    readonly player: Player,
  ) {
    this.t = TUNING[player.cfg.difficulty];
    this.waveSize = this.t.wave;
    const m = world.cfg.mania ? 0.5 : 1;
    this.nextWaveAt = Math.round(this.t.firstAttack * m * TICK_RATE);
    const s = world.map.starts[world.startOf[player.index]];
    this.home = { x: s.x, y: s.y };
  }

  update(): void {
    const w = this.world;
    if ((w.tick + this.player.index * 5) % 15 !== 0) return;
    this.manageStructures();
    this.manageProduction();
    this.manageArmy();
    if (w.tick % 60 === 0) {
      this.manageSuper();
      this.manageRepair();
    }
  }

  // ---------------------------------------------------------------- base building

  private manageStructures(): void {
    const w = this.world;
    const p = this.player;
    const q = p.queues.structure;
    if (q.ready) {
      const id = q.items[0];
      const spot = this.findSpot(id);
      if (spot) w.placeBuilding(p, id, spot.x, spot.y);
      else {
        this.blocked.set(id, w.tick + 60 * TICK_RATE);
        w.cancelBuild(p, id);
      }
      return;
    }
    if (q.items.length) return;
    const next = this.chooseBuilding();
    if (next) w.queueBuild(p, next);
  }

  private chooseBuilding(): string | null {
    const w = this.world;
    const p = this.player;
    const own = (id: string) => p.owned[id] ?? 0;
    const ok = (id: string) => w.canBuild(p, id) && (this.blocked.get(id) ?? 0) < w.tick;
    const tower = p.faction === 'vanguard' ? 'bastion' : 'spire';
    const sup = p.faction === 'vanguard' ? 'ion' : 'silo';
    const plan: [string, number][] = [
      ['refinery', 1],
      ['barracks', 1],
      ['factory', 1],
      ['refinery', Math.min(2, this.t.refineries)],
      ['radar', 1],
      ['guard', 2],
      [tower, Math.min(2, this.t.towers)],
      ['tech', 1],
      ['airfield', 1],
      [sup, this.t.superweapon ? 1 : 0],
      ['refinery', this.t.refineries],
      ['factory', this.t.factories],
      ['barracks', 2],
      [tower, this.t.towers],
      ['guard', 4],
      [tower, this.t.towers * 2],
    ];
    for (const [id, n] of plan) {
      if (own(id) >= n || !ok(id)) continue;
      const need = -(BUILDINGS[id].power ?? 0);
      if (p.powerOut - p.powerIn < need + 10 && ok('power')) return 'power';
      return id;
    }
    if (p.powerOut - p.powerIn < 50 && ok('power')) return 'power';
    return null;
  }

  private findSpot(id: string): { x: number; y: number } | null {
    const w = this.world;
    const p = this.player;
    const def = BUILDINGS[id];
    const base = this.baseCenter();
    if (!base) return null;
    const enemy = this.enemyHome();
    const ex = enemy ? enemy.x - base.x : 0;
    const ey = enemy ? enemy.y - base.y : 0;
    const el = Math.hypot(ex, ey) || 1;
    let ore: { x: number; y: number } | null = null;
    if (def.refinery) ore = findNearestCell(w.map, base.x, base.y, PassClass.Vehicle, 30, (x, y) => w.map.ore[w.map.idx(x, y)] > 0);
    let best: { x: number; y: number } | null = null;
    let bestScore = Infinity;
    for (let r = 2; r <= 16; r++) {
      for (let dy = -r; dy <= r; dy++) {
        for (let dx = -r; dx <= r; dx++) {
          if (Math.max(Math.abs(dx), Math.abs(dy)) !== r) continue;
          const tx = base.x + dx - Math.floor(def.w / 2);
          const ty = base.y + dy - Math.floor(def.h / 2);
          if (!w.canPlace(p, id, tx, ty)) continue;
          if (!def.defense && !this.gapOk(tx, ty, def.w, def.h)) continue;
          let score: number;
          if (def.defense) {
            const along = (dx * ex + dy * ey) / el;
            score = Math.abs(r - 7) * 2 - along * 0.8 + w.rng.next() * 2;
          } else if (ore) {
            score = Math.hypot(tx + def.w / 2 - ore.x, ty + def.h / 2 - ore.y) + r * 0.3;
          } else {
            score = r + w.rng.next();
          }
          if (score < bestScore) {
            bestScore = score;
            best = { x: tx, y: ty };
          }
        }
      }
      if (best && !def.defense && !def.refinery && r > 4) break;
    }
    return best;
  }

  /** Keep a one-tile corridor around structures so units never get boxed in. */
  private gapOk(tx: number, ty: number, bw: number, bh: number): boolean {
    const m = this.world.map;
    for (let y = ty - 1; y <= ty + bh; y++) {
      for (let x = tx - 1; x <= tx + bw; x++) {
        if (x >= tx && x < tx + bw && y >= ty && y < ty + bh) continue;
        if (!m.inBounds(x, y)) return false;
        const occ = m.occupant[m.idx(x, y)];
        if (occ !== 0) {
          const b = this.world.get(occ);
          if (b && !b.b.wall && !b.b.defense) return false;
        }
      }
    }
    // Leave the exit row under producers / refinery docks clear.
    for (let x = tx; x < tx + bw; x++) {
      const y = ty + bh + 1;
      if (m.inBounds(x, y) && m.occupant[m.idx(x, y)] !== 0) return false;
    }
    return true;
  }

  private baseCenter(): { x: number; y: number } | null {
    const w = this.world;
    const cy = w.buildings.find((b) => !b.dead && b.owner === this.player.index && b.type === 'conyard');
    const b = cy ?? w.buildings.find((b) => !b.dead && b.owner === this.player.index);
    if (!b) return null;
    return { x: b.tx + Math.floor(b.b.w / 2), y: b.ty + Math.floor(b.b.h / 2) };
  }

  private enemyHome(): { x: number; y: number } | null {
    const w = this.world;
    let best: { x: number; y: number } | null = null;
    let bd = Infinity;
    for (const o of w.players) {
      if (o.defeated || !w.isEnemy(o.index, this.player.index)) continue;
      const s = w.map.starts[w.startOf[o.index]];
      const d = Math.hypot(s.x - this.home.x, s.y - this.home.y);
      if (d < bd) {
        bd = d;
        best = s;
      }
    }
    return best;
  }

  // ---------------------------------------------------------------- production

  private manageProduction(): void {
    const w = this.world;
    const p = this.player;
    const harvesters = p.unitsByType.harvester ?? 0;
    const refineries = p.owned.refinery ?? 0;
    const vq = p.queues.vehicle;
    const wantHarv = Math.min(refineries * (p.cfg.difficulty === 'insane' ? 2 : 1) + (refineries > 0 ? 1 : 0), 8);
    if (refineries && harvesters + vq.items.filter((i) => i === 'harvester').length < wantHarv && w.canBuild(p, 'harvester')) {
      if (vq.items.length === 0 || vq.items[0] !== 'harvester') {
        vq.items.splice(vq.items.length ? 1 : 0, 0, 'harvester');
      }
    }
    // Let structures finish before pouring money into units (unless under attack).
    const sq = p.queues.structure;
    const saving = sq.items.length > 0 && !sq.ready && p.credits < 600 && w.tick - p.lastHit > 10 * TICK_RATE && p.cfg.difficulty !== 'insane';
    p.queues.infantry.onHold = saving;
    vq.onHold = saving && vq.items[0] !== 'harvester';
    if (p.credits < this.t.reserve) return;
    const iq = p.queues.infantry;
    if (iq.items.length < 2) {
      const id = this.pick(INFANTRY_MIX);
      if (id) w.queueBuild(p, id);
    }
    if (vq.items.length < 2) {
      const id = this.pick(VEHICLE_MIX);
      if (id) w.queueBuild(p, id);
    }
    const aq = p.queues.aircraft;
    if (aq.items.length < 1) {
      const id = this.pick(AIR_MIX);
      if (id) w.queueBuild(p, id);
    }
  }

  private pick(mix: [string, number][]): string | null {
    const w = this.world;
    const avail = mix.filter(([id]) => w.canBuild(this.player, id) && (id !== 'engineer' || this.player.cfg.difficulty !== 'easy'));
    const total = avail.reduce((s, [, n]) => s + n, 0);
    if (!total) return null;
    let r = w.rng.next() * total;
    for (const [id, n] of avail) {
      r -= n;
      if (r <= 0) return id;
    }
    return avail[0][0];
  }

  // ---------------------------------------------------------------- army

  private manageArmy(): void {
    const w = this.world;
    const p = this.player;
    const units = w.unitsOf(p.index).filter((u) => !u.u.harvester);
    for (const id of [...this.attackers]) if (!w.get(id)) this.attackers.delete(id);

    // Defend the base when it is hit.
    if (w.tick - p.lastHit < 3 * TICK_RATE) {
      const threat = this.findThreat();
      if (threat) {
        const defenders = units.filter((u) => !this.attackers.has(u.id) && u.u.weapons.length && (!u.order || u.order.type !== 'attack'));
        if (defenders.length)
          w.commandMove(
            defenders.map((u) => u.id),
            threat.x,
            threat.y,
            'attackMove',
          );
      }
    }

    const rally = this.rallyPoint();
    const idle = units.filter((u) => !this.attackers.has(u.id) && !u.order);
    for (const u of idle) {
      if (u.u.engineer) {
        const target = this.nearestEnemyBuilding(u.x, u.y, 14 * TILE);
        if (target) {
          w.commandAttack([u.id], target.id);
          continue;
        }
      }
      if (rally && Math.hypot(u.x - rally.x, u.y - rally.y) > TILE * 5) w.commandMove([u.id], rally.x, rally.y, 'attackMove');
    }

    const ready = units.filter((u) => !this.attackers.has(u.id) && (u.u.weapons.length || u.u.engineer || u.u.heal || u.u.jammer || u.u.detector));
    if (w.tick >= this.nextWaveAt && ready.length >= this.waveSize) {
      const base = this.baseCenter();
      const target = this.nearestEnemyBuilding((base?.x ?? this.home.x) * TILE, (base?.y ?? this.home.y) * TILE, Infinity);
      if (target) {
        const fighters = ready.filter((u) => !u.u.engineer).map((u) => u.id);
        w.commandMove(fighters, target.x, target.y, 'attackMove');
        const engineers = ready.filter((u) => u.u.engineer).map((u) => u.id);
        if (engineers.length) w.commandAttack(engineers, target.id);
        for (const u of ready) this.attackers.add(u.id);
        this.waveSize += this.t.growth;
        this.nextWaveAt = w.tick + Math.round(this.t.interval * (w.cfg.mania ? 0.5 : 1) * TICK_RATE);
        if (w.humanIndex >= 0 && w.isEnemy(p.index, w.humanIndex)) w.message(`${p.name} is launching an attack with ${ready.length} units!`);
      }
    }

    // Attack groups keep pushing to the next structure once their target falls.
    for (const id of this.attackers) {
      const u = w.get(id);
      if (!u || u.order) continue;
      const target = this.nearestEnemyBuilding(u.x, u.y, Infinity);
      if (target) {
        if (u.u.engineer) w.commandAttack([u.id], target.id);
        else w.commandMove([u.id], target.x, target.y, 'attackMove');
      }
    }
  }

  private rallyPoint(): { x: number; y: number } | null {
    const base = this.baseCenter();
    const enemy = this.enemyHome();
    if (!base) return null;
    let x = base.x;
    let y = base.y;
    if (enemy) {
      const dx = enemy.x - base.x;
      const dy = enemy.y - base.y;
      const d = Math.hypot(dx, dy) || 1;
      x = Math.round(base.x + (dx / d) * 7);
      y = Math.round(base.y + (dy / d) * 7);
    }
    const c = nearestPassable(this.world.map, x, y, PassClass.Vehicle, 8);
    return c ? { x: c.x * TILE + TILE / 2, y: c.y * TILE + TILE / 2 } : null;
  }

  private findThreat(): Entity | null {
    const w = this.world;
    const base = this.baseCenter();
    if (!base) return null;
    const near = w.spatial.query(base.x * TILE, base.y * TILE, 16 * TILE, []);
    let best: Entity | null = null;
    let bd = Infinity;
    for (const e of near) {
      if (!w.canTarget(this.player.index, e)) continue;
      const d = Math.hypot(e.x - base.x * TILE, e.y - base.y * TILE);
      if (d < bd) {
        bd = d;
        best = e;
      }
    }
    return best;
  }

  private nearestEnemyBuilding(x: number, y: number, maxDist: number): Entity | null {
    const w = this.world;
    let best: Entity | null = null;
    let bd = maxDist;
    for (const b of w.buildings) {
      if (b.dead || !w.isEnemy(b.owner, this.player.index)) continue;
      let d = Math.hypot(b.x - x, b.y - y);
      if (b.b.wall) d += 40 * TILE;
      if (d < bd) {
        bd = d;
        best = b;
      }
    }
    return best;
  }

  // ---------------------------------------------------------------- extras

  private manageSuper(): void {
    const w = this.world;
    const p = this.player;
    if (!p.superReady) return;
    let best: Entity | null = null;
    let bestScore = 0;
    for (const b of w.buildings) {
      if (b.dead || !w.isEnemy(b.owner, p.index)) continue;
      let score = 0;
      for (const n of w.spatial.query(b.x, b.y, 4 * TILE, [])) if (w.isEnemy(n.owner, p.index)) score += n.cost;
      if (score > bestScore) {
        bestScore = score;
        best = b;
      }
    }
    if (best) w.fireSuper(p, best.x, best.y);
  }

  private manageRepair(): void {
    if (!this.t.repair) return;
    const w = this.world;
    const p = this.player;
    if (p.credits < 800) return;
    for (const b of w.buildings) {
      if (!b.dead && b.owner === p.index && !b.repairing && b.hp < b.maxHp * 0.6) w.toggleRepair(p, b.id);
    }
  }
}

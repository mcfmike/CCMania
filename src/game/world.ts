import { AI } from './ai';
import { Onslaught } from './onslaught';
import { DT, PassClass, TICK_RATE, TILE } from './constants';
import {
  ARMOR_INDEX,
  BUILDINGS,
  SUPER_CHARGE,
  UNITS,
  categoryOf,
  type BuildingDef,
  type ProdCategory,
  type UnitDef,
  type WeaponDef,
} from './defs';
import { Entity, Player, type FxKind, type GameEvent, type Order, type PlayerConfig, resetEntityIds } from './entity';
import { ORE_MAX, T, type GameMap } from './map';
import { FlowCache, findNearestCell, nearestPassable, nextStep } from './pathfinding';
import { RNG } from './rng';
import { SpatialHash } from './spatial';

export interface GameConfig {
  players: PlayerConfig[];
  mania: boolean;
  fog: boolean;
  startCredits: number;
  seed: number;
  shuffleStarts: boolean;
  /** 'onslaught' = survive endless waves against a base-less horde. */
  mode?: 'skirmish' | 'onslaught';
}

export interface Projectile {
  kind: 'shell' | 'rocket' | 'artillery';
  owner: number;
  srcId: number;
  targetId: number;
  x: number;
  y: number;
  sx: number;
  sy: number;
  tx: number;
  ty: number;
  t: number;
  dur: number;
  speed: number;
  weapon: WeaponDef;
  mult: number;
  dead: boolean;
}

export type GameResult = 'playing' | 'victory' | 'defeat';

const HARVEST_CAP = 700;
const SCOOP = 25;

const DIFFICULTY = {
  easy: { build: 0.6, income: 0.8 },
  normal: { build: 1, income: 1 },
  hard: { build: 1.3, income: 1.3 },
  insane: { build: 2, income: 2 },
};

function angleDiff(a: number, b: number): number {
  let d = a - b;
  while (d > Math.PI) d -= Math.PI * 2;
  while (d < -Math.PI) d += Math.PI * 2;
  return d;
}

const circleCache = new Map<number, Int16Array>();
function circleOffsets(r: number): Int16Array {
  let c = circleCache.get(r);
  if (!c) {
    const pts: number[] = [];
    for (let dy = -r; dy <= r; dy++) for (let dx = -r; dx <= r; dx++) if (dx * dx + dy * dy <= r * r + r) pts.push(dx, dy);
    c = Int16Array.from(pts);
    circleCache.set(r, c);
  }
  return c;
}

export class World {
  readonly map: GameMap;
  readonly cfg: GameConfig;
  readonly players: Player[];
  entities: Entity[] = [];
  units: Entity[] = [];
  buildings: Entity[] = [];
  byId = new Map<number, Entity>();
  projectiles: Projectile[] = [];
  tick = 0;
  rng: RNG;
  events: GameEvent[] = [];
  spatial: SpatialHash;
  flow = new FlowCache();
  humanIndex = -1;
  result: GameResult = 'playing';
  ais: AI[] = [];
  onslaught: Onslaught | null = null;
  /** Set when the game ends so the player can spectate the whole map. */
  revealAll = false;
  /** Which map start each player was given. */
  startOf: number[] = [];
  private timers: { at: number; fn: () => void }[] = [];
  private nextMoveId = 1;
  private tmp: Entity[] = [];
  private evaTimes = new Map<string, number>();

  constructor(map: GameMap, cfg: GameConfig) {
    resetEntityIds();
    this.map = map;
    this.cfg = cfg;
    this.rng = new RNG(cfg.seed);
    this.spatial = new SpatialHash(map.w * TILE, map.h * TILE);
    this.players = cfg.players.map((pc, i) => new Player(i, pc, map.w * map.h));
    this.humanIndex = this.players.findIndex((p) => p.human);
    this.setup();
  }

  // ---------------------------------------------------------------- setup

  private setup(): void {
    const starts = this.map.starts;
    const based = this.players.filter((p) => !p.cfg.horde);
    if (starts.length < based.length) throw new Error(`Map has ${starts.length} start positions but ${based.length} players`);
    const order = starts.map((_, i) => i).slice(0, Math.max(starts.length, this.players.length));
    if (this.cfg.shuffleStarts) {
      for (let i = order.length - 1; i > 0; i--) {
        const j = this.rng.int(0, i);
        [order[i], order[j]] = [order[j], order[i]];
      }
    }
    let next = 0;
    this.startOf = this.players.map((p) => (p.cfg.horde ? -1 : order[next++]));

    for (const p of this.players) {
      if (p.cfg.horde) {
        this.onslaught = new Onslaught(this, p);
        continue;
      }
      const d = DIFFICULTY[p.cfg.difficulty];
      if (!p.human) {
        p.buildSpeed = d.build;
        p.incomeMult = d.income;
      }
      p.credits = this.cfg.startCredits * (!p.human && p.cfg.difficulty === 'insane' ? 2 : 1);
      const s = starts[this.startOf[p.index]];
      this.createBuilding(p.index, BUILDINGS.conyard, s.x - 1, s.y - 1, true);
      const army: [string, number][] = this.cfg.mania
        ? [['lancer', 6], ['rifleman', 8], ['rocketeer', 4], ['howitzer', 2], ['raider', 3]]
        : [['rifleman', 3], ['rocketeer', 1], ['lancer', 1]];
      // Spread the starting army out in rows in front of the Construction Yard.
      let slot = 0;
      for (const [type, n] of army)
        for (let k = 0; k < n; k++, slot++) {
          const dir = s.y < this.map.h / 2 ? 1 : -1;
          this.spawnNear(p.index, UNITS[type], s.x - 3 + (slot % 7), s.y + dir * (3 + Math.floor(slot / 7)));
        }
      if (!p.human) this.ais.push(new AI(this, p));
    }

    for (const me of this.map.entities) {
      const pi = this.startOf.indexOf(me.owner);
      if (pi < 0) continue;
      if (me.kind === 'building') {
        const def = BUILDINGS[me.type];
        if (def && this.footprintFree(me.x, me.y, def)) this.createBuilding(pi, def, me.x, me.y, true);
      } else {
        const def = UNITS[me.type];
        if (def) this.spawnNear(pi, def, me.x, me.y);
      }
    }
    this.refreshLists();
    for (const p of this.players) this.updateVision(p);
  }

  private footprintFree(tx: number, ty: number, def: BuildingDef): boolean {
    for (let y = ty; y < ty + def.h; y++)
      for (let x = tx; x < tx + def.w; x++) if (!this.map.inBounds(x, y) || this.map.occupant[this.map.idx(x, y)] !== 0) return false;
    return true;
  }

  // ---------------------------------------------------------------- helpers

  emit(e: GameEvent): void {
    this.events.push(e);
  }
  sfx(name: string, x: number, y: number): void {
    this.events.push({ t: 'sfx', name, x, y });
  }
  fx(kind: FxKind, x: number, y: number, extra: Partial<{ x2: number; y2: number; size: number; color: string }> = {}): void {
    this.events.push({ t: 'fx', kind, x, y, ...extra });
  }
  eva(owner: number, key: string, text: string, cooldown = 4): void {
    if (owner !== this.humanIndex) return;
    const last = this.evaTimes.get(key) ?? -1e9;
    if (this.tick - last < cooldown * TICK_RATE) return;
    this.evaTimes.set(key, this.tick);
    this.events.push({ t: 'eva', key, text });
  }
  message(text: string): void {
    this.events.push({ t: 'message', text });
  }
  after(seconds: number, fn: () => void): void {
    this.timers.push({ at: this.tick + Math.round(seconds * TICK_RATE), fn });
  }

  get(id: number): Entity | undefined {
    const e = this.byId.get(id);
    return e && !e.dead ? e : undefined;
  }

  isEnemy(a: number, b: number): boolean {
    return this.players[a].team !== this.players[b].team;
  }

  canTarget(owner: number, t: Entity | undefined): t is Entity {
    if (!t || t.dead || !this.isEnemy(owner, t.owner)) return false;
    return !t.cloaked || t.detected;
  }

  /** Is the entity visible to the human player (fog + stealth)? */
  visibleToHuman(e: Entity): boolean {
    if (this.humanIndex < 0) return true;
    const hp = this.players[this.humanIndex];
    if (!this.isEnemy(e.owner, hp.index)) return true;
    if (e.cloaked && !e.detected) return false;
    const cx = Math.floor(e.x / TILE);
    const cy = Math.floor(e.y / TILE);
    if (!this.map.inBounds(cx, cy)) return false;
    if (e.isBuilding) return hp.explored[this.map.idx(cx, cy)] === 1;
    return hp.visible[this.map.idx(cx, cy)] === 1;
  }

  weaponsOf(e: Entity): WeaponDef[] {
    return e.isUnit ? e.u.weapons : e.b.weapon ? [e.b.weapon] : [];
  }

  passClass(e: Entity): PassClass {
    return e.isUnit && e.u.cls === 'infantry' ? PassClass.Infantry : PassClass.Vehicle;
  }

  buildingsOf(owner: number): Entity[] {
    return this.buildings.filter((b) => b.owner === owner && !b.dead);
  }

  unitsOf(owner: number): Entity[] {
    return this.units.filter((u) => u.owner === owner && !u.dead);
  }

  private add(e: Entity): Entity {
    this.entities.push(e);
    this.byId.set(e.id, e);
    if (e.isUnit) this.units.push(e);
    else this.buildings.push(e);
    return e;
  }

  // ---------------------------------------------------------------- creation

  createBuilding(owner: number, def: BuildingDef, tx: number, ty: number, instant = false): Entity {
    const e = new Entity(def, owner, (tx + def.w / 2) * TILE, (ty + def.h / 2) * TILE);
    e.tx = tx;
    e.ty = ty;
    e.built = instant ? 1 : 0;
    e.turret = Math.PI / 2;
    for (let y = ty; y < ty + def.h; y++)
      for (let x = tx; x < tx + def.w; x++) if (this.map.inBounds(x, y)) this.map.occupant[this.map.idx(x, y)] = e.id;
    this.map.version++;
    this.add(e);
    const p = this.players[owner];
    p.owned[def.id] = (p.owned[def.id] ?? 0) + 1;
    if (def.refinery) {
      const h = this.spawnNear(owner, UNITS.harvester, tx + 1, ty + def.h);
      if (h) this.orderHarvest(h);
    }
    return e;
  }

  spawnNear(owner: number, def: UnitDef, cx: number, cy: number): Entity | null {
    const cls = def.cls === 'infantry' ? PassClass.Infantry : PassClass.Vehicle;
    const c = nearestPassable(this.map, cx, cy, cls, 16);
    if (!c) return null;
    const jitter = def.cls === 'infantry' ? 8 : 2;
    const e = new Entity(def, owner, c.x * TILE + TILE / 2 + this.rng.range(-jitter, jitter), c.y * TILE + TILE / 2 + this.rng.range(-jitter, jitter));
    e.angle = Math.PI / 2;
    e.turret = e.angle;
    this.add(e);
    const p = this.players[owner];
    p.unitCount++;
    p.unitsByType[def.id] = (p.unitsByType[def.id] ?? 0) + 1;
    return e;
  }

  // ---------------------------------------------------------------- production API

  defOf(id: string): UnitDef | BuildingDef | undefined {
    return UNITS[id] ?? BUILDINGS[id];
  }

  unitCap(): number {
    return this.cfg.mania ? 1500 : 400;
  }

  canBuild(p: Player, id: string): boolean {
    const def = this.defOf(id);
    if (!def) return false;
    if (def.faction && def.faction !== p.faction) return false;
    if ((def as BuildingDef).buildable === false) return false;
    for (const req of def.prereq) if (!p.owned[req]) return false;
    const u = UNITS[id];
    if (u) {
      if (u.limit !== undefined) {
        const queued = p.queues[categoryOf(id)].items.filter((i) => i === id).length;
        if ((p.unitsByType[id] ?? 0) + queued >= u.limit) return false;
      }
      if (p.unitCount >= this.unitCap()) return false;
    }
    return true;
  }

  queueBuild(p: Player, id: string): boolean {
    if (!this.canBuild(p, id) || BUILDINGS[id]?.wall) return false;
    const cat = categoryOf(id);
    const q = p.queues[cat];
    if (cat === 'structure' ? q.items.length > 0 : q.items.length >= 12) return false;
    q.items.push(id);
    if (q.items.length === 1) this.eva(p.index, cat === 'structure' ? 'building' : 'training', cat === 'structure' ? 'Building' : 'Training', 1);
    return true;
  }

  cancelBuild(p: Player, id: string): void {
    const q = p.queues[categoryOf(id)];
    const i = q.items.lastIndexOf(id);
    if (i < 0) return;
    if (i === 0) {
      p.credits += q.paid;
      q.paid = 0;
      q.progress = 0;
      q.ready = false;
      this.eva(p.index, 'cancel', 'Cancelled', 1);
    }
    q.items.splice(i, 1);
  }

  private producerCount(p: Player, cat: ProdCategory): number {
    if (cat === 'structure') return p.owned.conyard ?? 0;
    return p.owned[cat === 'infantry' ? 'barracks' : 'factory'] ?? 0;
  }

  private updateProduction(p: Player): void {
    for (const cat of ['structure', 'infantry', 'vehicle'] as ProdCategory[]) {
      const q = p.queues[cat];
      if (!q.items.length || q.ready || q.onHold) continue;
      const producers = this.producerCount(p, cat);
      if (!producers) continue;
      const def = this.defOf(q.items[0])!;
      const speed = p.buildSpeed * (1 + 0.5 * (producers - 1)) * (this.cfg.mania ? 3 : 1) * (p.lowPower ? 0.5 : 1);
      const step = Math.min(speed / (def.buildTime * TICK_RATE), 1 - q.progress);
      const pay = def.cost * step;
      if (p.credits < pay) {
        if (!q.stalled) this.eva(p.index, 'funds', 'Insufficient funds', 8);
        q.stalled = true;
        continue;
      }
      q.stalled = false;
      p.credits -= pay;
      q.paid += pay;
      q.progress += step;
      if (q.progress >= 1 - 1e-9) {
        q.progress = 1;
        if (cat === 'structure') {
          q.ready = true;
          this.eva(p.index, 'complete', 'Construction complete', 1);
        } else if (this.spawnProduced(p, UNITS[q.items[0]])) {
          q.items.shift();
          q.progress = 0;
          q.paid = 0;
          p.stats.unitsBuilt++;
          this.eva(p.index, 'unitready', 'Unit ready', 2);
        }
      }
    }
  }

  private spawnProduced(p: Player, def: UnitDef): boolean {
    const type = def.cls === 'infantry' ? 'barracks' : 'factory';
    const key = def.cls === 'infantry' ? 'infantry' : 'vehicle';
    let prod = this.get(p.primary[key]);
    if (!prod || prod.owner !== p.index || prod.type !== type) {
      prod = this.buildings.find((b) => !b.dead && b.owner === p.index && b.type === type);
      if (prod) p.primary[key] = prod.id;
    }
    if (!prod) return false;
    const e = this.spawnNear(p.index, def, prod.tx + Math.floor(prod.b.w / 2), prod.ty + prod.b.h);
    if (!e) return false;
    if (def.harvester) this.orderHarvest(e);
    else if (prod.rallyX >= 0) this.commandMove([e.id], prod.rallyX, prod.rallyY, 'move');
    return true;
  }

  canPlace(p: Player, id: string, tx: number, ty: number): boolean {
    const def = BUILDINGS[id];
    if (!def) return false;
    for (let y = ty; y < ty + def.h; y++) for (let x = tx; x < tx + def.w; x++) if (!this.map.buildable(x, y)) return false;
    // No units in the footprint.
    const near = this.spatial.query((tx + def.w / 2) * TILE, (ty + def.h / 2) * TILE, (Math.max(def.w, def.h) * TILE) / 2 + TILE, this.tmp);
    for (const e of near) {
      if (!e.isUnit) continue;
      const cx = Math.floor(e.x / TILE);
      const cy = Math.floor(e.y / TILE);
      if (cx >= tx && cx < tx + def.w && cy >= ty && cy < ty + def.h) return false;
    }
    // Must be close to an existing structure.
    const reach = 3;
    for (const b of this.buildings) {
      if (b.dead || b.owner !== p.index) continue;
      if (tx <= b.tx + b.b.w - 1 + reach && tx + def.w - 1 >= b.tx - reach && ty <= b.ty + b.b.h - 1 + reach && ty + def.h - 1 >= b.ty - reach) return true;
    }
    return false;
  }

  placeBuilding(p: Player, id: string, tx: number, ty: number): boolean {
    const q = p.queues.structure;
    if (!q.ready || q.items[0] !== id || !this.canPlace(p, id, tx, ty)) return false;
    this.createBuilding(p.index, BUILDINGS[id], tx, ty);
    q.items.shift();
    q.ready = false;
    q.progress = 0;
    q.paid = 0;
    p.stats.structuresBuilt++;
    this.sfx('place', (tx + 1) * TILE, (ty + 1) * TILE);
    return true;
  }

  buildWall(p: Player, tx: number, ty: number): boolean {
    const def = BUILDINGS.wall;
    if (!this.canBuild(p, 'wall') || p.credits < def.cost || !this.canPlace(p, 'wall', tx, ty)) return false;
    p.credits -= def.cost;
    this.createBuilding(p.index, def, tx, ty);
    return true;
  }

  sell(p: Player, id: number): void {
    const b = this.get(id);
    if (!b || !b.isBuilding || b.owner !== p.index) return;
    p.credits += Math.round(b.cost * 0.5 * (b.hp / b.maxHp));
    this.fx('sell', b.x, b.y, { size: b.b.w });
    this.sfx('sell', b.x, b.y);
    const survivors = b.b.wall ? 0 : Math.min(3, Math.ceil(b.cost / 800));
    for (let i = 0; i < survivors; i++) this.spawnNear(b.owner, UNITS.rifleman, b.tx + 1, b.ty + b.b.h);
    this.removeBuilding(b);
  }

  toggleRepair(p: Player, id: number): void {
    const b = this.get(id);
    if (!b || !b.isBuilding || b.owner !== p.index) return;
    b.repairing = !b.repairing && b.hp < b.maxHp;
  }

  setRally(p: Player, id: number, x: number, y: number): void {
    const b = this.get(id);
    if (!b || b.owner !== p.index || !b.isBuilding || !b.b.produces || b.b.produces === 'structure') return;
    b.rallyX = x;
    b.rallyY = y;
    p.primary[b.b.produces] = b.id;
  }

  // ---------------------------------------------------------------- orders API

  commandMove(ids: number[], x: number, y: number, type: 'move' | 'attackMove'): void {
    const us = ids.map((id) => this.get(id)).filter((e): e is Entity => !!e && e.isUnit);
    if (!us.length) return;
    const moveId = this.nextMoveId++;
    let cx = 0;
    let cy = 0;
    for (const u of us) {
      cx += u.x;
      cy += u.y;
    }
    cx /= us.length;
    cy /= us.length;
    const groupRadius = TILE * 0.6 * Math.sqrt(us.length) + 6;
    const tcx = Math.floor(x / TILE);
    const tcy = Math.floor(y / TILE);
    for (const u of us) {
      const cls = this.passClass(u);
      const goal = nearestPassable(this.map, tcx, tcy, cls, 20) ?? { x: tcx, y: tcy };
      let ox = u.x - cx;
      let oy = u.y - cy;
      const ol = Math.hypot(ox, oy);
      if (ol > groupRadius) {
        ox *= groupRadius / ol;
        oy *= groupRadius / ol;
      }
      let ex = goal.x * TILE + TILE / 2 + (goal.x === tcx && goal.y === tcy ? x - (tcx * TILE + TILE / 2) : 0) + ox * 0.8;
      let ey = goal.y * TILE + TILE / 2 + (goal.x === tcx && goal.y === tcy ? y - (tcy * TILE + TILE / 2) : 0) + oy * 0.8;
      if (!this.map.passable(Math.floor(ex / TILE), Math.floor(ey / TILE), cls)) {
        ex = goal.x * TILE + TILE / 2;
        ey = goal.y * TILE + TILE / 2;
      }
      u.order = { type, x: ex, y: ey, gx: goal.x, gy: goal.y, target: 0, moveId, groupRadius };
      u.targetId = 0;
      u.stuck = 0;
      if (u.u.harvester) u.harvestState = 'wait';
    }
  }

  commandAttack(ids: number[], targetId: number): void {
    const t = this.get(targetId);
    if (!t) return;
    for (const id of ids) {
      const u = this.get(id);
      if (!u || !u.isUnit || !this.isEnemy(u.owner, t.owner)) continue;
      if ((u.u.engineer || u.u.commando) && t.isBuilding && !t.b.wall) {
        u.order = this.mkOrder('enter', t.x, t.y, t.id);
        continue;
      }
      if (!u.u.weapons.length) continue;
      u.order = this.mkOrder('attack', t.x, t.y, t.id);
      u.targetId = t.id;
    }
  }

  commandStop(ids: number[]): void {
    for (const id of ids) {
      const u = this.get(id);
      if (!u || !u.isUnit) continue;
      u.order = null;
      u.targetId = 0;
      if (u.u.harvester) u.harvestState = 'wait';
    }
  }

  orderHarvest(e: Entity, oreX = -1, oreY = -1): void {
    e.order = this.mkOrder('harvest', e.x, e.y, 0);
    e.harvestState = 'seek';
    e.oreX = oreX;
    e.oreY = oreY;
  }

  /** Order harvesters to go back to work, optionally at a specific ore cell. */
  commandHarvest(ids: number[], x: number, y: number): void {
    for (const id of ids) {
      const u = this.get(id);
      if (u?.isUnit && u.u.harvester) this.orderHarvest(u, Math.floor(x / TILE), Math.floor(y / TILE));
    }
  }

  private mkOrder(type: Order['type'], x: number, y: number, target: number): Order {
    return { type, x, y, gx: Math.floor(x / TILE), gy: Math.floor(y / TILE), target, moveId: this.nextMoveId++, groupRadius: TILE };
  }

  // ---------------------------------------------------------------- superweapons

  superChargeTicks(): number {
    return (this.cfg.mania ? SUPER_CHARGE.mania : SUPER_CHARGE.normal) * TICK_RATE;
  }

  private updateSuper(p: Player): void {
    const type = p.owned.ion ? 'ion' : p.owned.silo ? 'nuke' : null;
    p.superType = type;
    if (!type) {
      p.superCharge = 0;
      p.superReady = false;
      return;
    }
    if (p.superReady || p.lowPower) return;
    p.superCharge++;
    if (p.superCharge >= this.superChargeTicks()) {
      p.superReady = true;
      this.eva(p.index, 'superready', type === 'ion' ? 'Ion cannon ready' : 'Nuclear missile ready', 1);
    }
  }

  fireSuper(p: Player, x: number, y: number): boolean {
    if (!p.superReady || !p.superType) return false;
    p.superReady = false;
    p.superCharge = 0;
    const type = p.superType;
    this.reveal(p, x, y, 7);
    for (const other of this.players) {
      if (!other.human) continue;
      if (other.index === p.index) this.eva(other.index, 'superfire', type === 'ion' ? 'Ion cannon activated' : 'Nuclear missile launched', 1);
      else this.eva(other.index, 'superwarn', type === 'ion' ? 'Warning: enemy ion cannon activated' : 'Warning: nuclear launch detected', 1);
    }
    if (type === 'ion') {
      this.fx('ion', x, y);
      this.sfx('ionCharge', x, y);
      this.after(1.6, () => {
        this.sfx('ionBlast', x, y);
        this.emit({ t: 'shake', amount: 14 });
        this.emit({ t: 'decal', kind: 'crater', x, y, size: 3.5 });
        this.blast(x, y, 3.5, 750, p.index);
      });
    } else {
      const silo = this.buildings.find((b) => !b.dead && b.owner === p.index && b.type === 'silo');
      this.fx('nukeLaunch', silo?.x ?? x, silo?.y ?? y, { x2: x, y2: y });
      this.sfx('nukeLaunch', silo?.x ?? x, silo?.y ?? y);
      this.after(3.2, () => {
        this.fx('nuke', x, y);
        this.sfx('nukeBlast', x, y);
        this.emit({ t: 'shake', amount: 30 });
        this.emit({ t: 'decal', kind: 'crater', x, y, size: 5 });
        this.blast(x, y, 5.5, 1000, p.index);
        // Nukes also vaporise crystals at ground zero.
        const r = 3;
        const cx = Math.floor(x / TILE);
        const cy = Math.floor(y / TILE);
        for (let dy = -r; dy <= r; dy++)
          for (let dx = -r; dx <= r; dx++) if (this.map.inBounds(cx + dx, cy + dy) && dx * dx + dy * dy <= r * r) this.map.ore[this.map.idx(cx + dx, cy + dy)] = 0;
        this.map.oreDirty = true;
      });
    }
    return true;
  }

  /** Permanently uncover the shroud around a point for a player's team. */
  reveal(p: Player, x: number, y: number, r: number): void {
    const cx = Math.floor(x / TILE);
    const cy = Math.floor(y / TILE);
    for (const q of this.players) {
      if (q.team !== p.team) continue;
      const offs = circleOffsets(r);
      for (let i = 0; i < offs.length; i += 2) {
        const tx = cx + offs[i];
        const ty = cy + offs[i + 1];
        if (this.map.inBounds(tx, ty)) q.explored[this.map.idx(tx, ty)] = 1;
      }
    }
  }

  /** Area damage that hurts everybody, friend or foe. */
  blast(x: number, y: number, radiusTiles: number, damage: number, owner: number): void {
    const R = radiusTiles * TILE;
    const near = this.spatial.query(x, y, R, []);
    for (const e of near) {
      const d = e.distTo(x, y);
      const f = Math.max(0.15, 1 - d / R);
      this.damage(e, damage * f, null, owner);
    }
  }

  // ---------------------------------------------------------------- damage

  damage(t: Entity, amount: number, attacker: Entity | null, attackerOwner: number): void {
    if (t.dead || amount <= 0) return;
    t.hp -= amount;
    t.lastDamaged = this.tick;
    t.flash = 3;
    const p = this.players[t.owner];
    if (attackerOwner >= 0 && this.isEnemy(attackerOwner, t.owner)) {
      p.lastHit = this.tick;
      if (t.isBuilding) this.eva(t.owner, 'baseattack', 'Our base is under attack', 25);
      else if (t.u.harvester) this.eva(t.owner, 'harvattack', 'Harvester under attack', 20);
      if (attacker && !attacker.dead) {
        t.lastAttacker = attacker.id;
        // Idle units shoot back.
        if (t.isUnit && !t.order && t.u.weapons.length && !t.u.harvester && this.canTarget(t.owner, attacker)) {
          if (attacker.distTo(t.x, t.y) < t.sight * TILE * 1.5) t.order = this.mkOrder('attack', attacker.x, attacker.y, attacker.id);
        }
      }
    }
    if (t.hp <= 0) this.kill(t, attacker, attackerOwner);
  }

  private damageWeapon(t: Entity, w: WeaponDef, mult: number, attacker: Entity | null, owner: number): void {
    const armor = t.isUnit ? t.u.armor : 'building';
    this.damage(t, w.damage * w.vs[ARMOR_INDEX[armor]] * mult, attacker, owner);
  }

  kill(t: Entity, attacker: Entity | null, attackerOwner: number, quiet = false): void {
    if (t.dead) return;
    t.dead = true;
    t.hp = 0;
    const p = this.players[t.owner];
    if (attacker && !attacker.dead && attacker.isUnit) {
      attacker.kills++;
      attacker.xp += t.cost;
      const c = attacker.cost;
      const newRank = attacker.xp >= c * 3 ? 2 : attacker.xp >= c * 1.2 ? 1 : 0;
      if (newRank > attacker.rank) {
        attacker.rank = newRank;
        this.fx('sparkle', attacker.x, attacker.y, { color: '#ffd84a', size: 1.5 });
        if (attacker.owner === this.humanIndex) this.eva(attacker.owner, 'promoted', 'Unit promoted', 6);
      }
    }
    if (attackerOwner >= 0 && attackerOwner !== t.owner) this.players[attackerOwner].stats.kills++;
    if (t.isUnit) {
      p.unitCount--;
      p.unitsByType[t.type] = (p.unitsByType[t.type] ?? 1) - 1;
      p.stats.unitsLost++;
      if (!quiet) {
        if (t.u.cls === 'infantry') {
          this.fx('infantryDeath', t.x, t.y, { color: p.color });
          this.sfx('scream', t.x, t.y);
        } else {
          const big = t.u.radius >= 14;
          this.fx(big ? 'bigExplosion' : 'explosion', t.x, t.y, { size: t.u.radius / 12 });
          this.sfx('explode', t.x, t.y);
          this.emit({ t: 'decal', kind: 'scorch', x: t.x, y: t.y, size: t.u.radius / 12 });
          if (big) this.emit({ t: 'shake', amount: 4 });
          if (t.u.harvester && t.cargo > 0) {
            // Loaded harvesters go up in a crystal fireball.
            this.blast(t.x, t.y, 1.5, 80 + t.cargo / 4, t.owner);
          }
        }
        this.eva(t.owner, 'unitlost', 'Unit lost', 6);
      }
    } else {
      p.stats.structuresLost++;
      this.removeBuilding(t);
      const size = Math.max(t.b.w, t.b.h);
      this.fx('bigExplosion', t.x, t.y, { size });
      this.sfx('buildingExplode', t.x, t.y);
      this.emit({ t: 'shake', amount: 4 + size * 3 });
      this.emit({ t: 'decal', kind: 'rubble', x: t.x, y: t.y, size });
      for (let i = 0; i < size * 2; i++) {
        const ox = this.rng.range(-0.5, 0.5) * t.b.w * TILE;
        const oy = this.rng.range(-0.5, 0.5) * t.b.h * TILE;
        this.after(0.12 * i, () => this.fx('explosion', t.x + ox, t.y + oy, { size: 1 }));
      }
      if (this.cfg.mania && !t.b.wall) {
        // Chain reactions: structures detonate and take neighbours with them.
        this.after(0.3, () => this.blast(t.x, t.y, size * 0.9 + 1, 150 * size, t.owner));
      }
      if (!t.b.wall && t.owner === this.humanIndex) this.eva(t.owner, 'structlost', 'Structure destroyed', 5);
    }
  }

  private removeBuilding(b: Entity): void {
    b.dead = true;
    for (let y = b.ty; y < b.ty + b.b.h; y++)
      for (let x = b.tx; x < b.tx + b.b.w; x++) {
        const i = this.map.idx(x, y);
        if (this.map.occupant[i] === b.id) this.map.occupant[i] = 0;
      }
    this.map.version++;
    const p = this.players[b.owner];
    p.owned[b.type] = Math.max(0, (p.owned[b.type] ?? 1) - 1);
  }

  private capture(b: Entity, newOwner: number): void {
    const old = this.players[b.owner];
    old.owned[b.type] = Math.max(0, (old.owned[b.type] ?? 1) - 1);
    this.eva(b.owner, 'lostbuilding', 'Structure captured by enemy', 3);
    b.owner = newOwner;
    b.repairing = false;
    b.rallyX = -1;
    const np = this.players[newOwner];
    np.owned[b.type] = (np.owned[b.type] ?? 0) + 1;
    this.eva(newOwner, 'captured', 'Building captured', 2);
    this.fx('capture', b.x, b.y, { size: b.b.w, color: np.color });
    this.sfx('capture', b.x, b.y);
  }

  // ---------------------------------------------------------------- main step

  step(): void {
    this.tick++;
    this.flow.now = this.tick;
    this.refreshLists();

    for (const p of this.players) {
      if (p.defeated) continue;
      this.updatePower(p);
      this.updateProduction(p);
      this.updateSuper(p);
    }

    this.spatial.clear();
    for (const e of this.entities) if (!e.dead) this.spatial.insert(e);

    if (this.tick % 10 === 0) this.updateDetection();

    for (const u of this.units) if (!u.dead) this.updateUnit(u);
    this.separate();
    for (const b of this.buildings) if (!b.dead) this.updateBuilding(b);
    this.updateProjectiles();

    if (this.timers.length) {
      const due = this.timers.filter((t) => t.at <= this.tick);
      if (due.length) {
        this.timers = this.timers.filter((t) => t.at > this.tick);
        for (const t of due) t.fn();
      }
    }

    if (this.tick % (this.cfg.mania ? 15 : 45) === 0) this.growOre();
    if (this.tick % 6 === 0) for (const p of this.players) if (p.human || this.tick % 30 === 0) this.updateVision(p);
    for (const ai of this.ais) if (!ai.player.defeated) ai.update();
    this.onslaught?.update();
    if (this.tick % 30 === 0) this.checkDefeat();
  }

  private refreshLists(): void {
    if (this.entities.some((e) => e.dead)) {
      this.entities = this.entities.filter((e) => {
        if (e.dead) this.byId.delete(e.id);
        return !e.dead;
      });
      this.units = this.units.filter((e) => !e.dead);
      this.buildings = this.buildings.filter((e) => !e.dead);
    }
  }

  private updatePower(p: Player): void {
    let out = 0;
    let use = 0;
    for (const b of this.buildings) {
      if (b.dead || b.owner !== p.index || b.built < 1) continue;
      const pw = b.b.power;
      if (pw > 0) out += pw * Math.max(0.3, b.hp / b.maxHp);
      else use -= pw;
    }
    const wasLow = p.lowPower;
    p.powerOut = Math.round(out);
    p.powerIn = use;
    if (!wasLow && p.lowPower) this.eva(p.index, 'lowpower', 'Low power', 10);
  }

  private updateDetection(): void {
    for (const u of this.units) {
      if (u.dead || !u.cloaked) {
        u.detected = false;
        continue;
      }
      u.detected = false;
      const near = this.spatial.query(u.x, u.y, TILE * 2.5, this.tmp);
      for (const n of near) {
        if (this.isEnemy(n.owner, u.owner)) {
          u.detected = true;
          break;
        }
      }
    }
  }

  private updateVision(p: Player): void {
    const vis = p.visible;
    if (this.revealAll) {
      vis.fill(1);
      p.explored.fill(1);
      return;
    }
    vis.fill(0);
    const { w, h } = this.map;
    for (const e of this.entities) {
      if (e.dead || this.players[e.owner].team !== p.team) continue;
      const cx = Math.floor(e.x / TILE);
      const cy = Math.floor(e.y / TILE);
      const r = Math.round(e.sight + (e.isBuilding ? Math.max(e.b.w, e.b.h) / 2 : 0));
      const offs = circleOffsets(r);
      for (let i = 0; i < offs.length; i += 2) {
        const x = cx + offs[i];
        const y = cy + offs[i + 1];
        if (x < 0 || y < 0 || x >= w || y >= h) continue;
        const k = y * w + x;
        vis[k] = 1;
        p.explored[k] = 1;
      }
    }
    if (!this.cfg.fog) vis.set(p.explored);
  }

  private checkDefeat(): void {
    for (const p of this.players) {
      if (p.defeated || p.cfg.horde) continue;
      const alive = this.buildings.some((b) => !b.dead && b.owner === p.index && !b.b.wall);
      if (alive) continue;
      p.defeated = true;
      this.message(`${p.name} has been eliminated!`);
      // Leaderless armies self-destruct, staggered for maximum spectacle.
      const left = this.unitsOf(p.index);
      left.forEach((u, i) => this.after(0.05 * i + this.rng.range(0, 0.5), () => this.kill(u, null, -1)));
      for (const b of this.buildingsOf(p.index)) this.after(this.rng.range(0, 2), () => this.kill(b, null, -1));
    }
    if (this.result !== 'playing' || this.humanIndex < 0) return;
    const me = this.players[this.humanIndex];
    if (me.defeated) {
      this.result = 'defeat';
      this.revealAll = true;
      this.eva(me.index, 'lose', 'Mission failed', 0);
    } else if (!this.onslaught && this.players.every((p) => p.defeated || p.team === me.team)) {
      this.result = 'victory';
      this.revealAll = true;
      this.eva(me.index, 'win', 'Mission accomplished', 0);
    }
  }

  // ---------------------------------------------------------------- ore

  private growOre(): void {
    const m = this.map;
    const n = Math.floor((m.w * m.h) / 12);
    const grow = this.cfg.mania ? 40 : 20;
    for (let k = 0; k < n; k++) {
      const i = this.rng.int(0, m.w * m.h - 1);
      const o = m.ore[i];
      if (o === 0 && !m.oreField[i]) continue;
      if (m.occupant[i] !== 0) continue;
      if (o < ORE_MAX) m.ore[i] = Math.min(ORE_MAX, o + grow);
      if (o > ORE_MAX * 0.6 && this.rng.chance(0.12)) {
        const x = (i % m.w) + this.rng.int(-1, 1);
        const y = Math.floor(i / m.w) + this.rng.int(-1, 1);
        if (this.canGrowOre(x, y)) {
          m.ore[m.idx(x, y)] = Math.max(m.ore[m.idx(x, y)], grow);
          m.oreField[m.idx(x, y)] = 1;
        }
      }
    }
    for (const b of m.blossoms) {
      for (let k = 0; k < 3; k++) {
        const x = b.x + this.rng.int(-4, 4);
        const y = b.y + this.rng.int(-4, 4);
        if (this.canGrowOre(x, y)) {
          const i = m.idx(x, y);
          m.ore[i] = Math.min(ORE_MAX, m.ore[i] + 60);
          m.oreField[i] = 1;
        }
      }
    }
    m.oreDirty = true;
  }

  private canGrowOre(x: number, y: number): boolean {
    const m = this.map;
    if (!m.inBounds(x, y)) return false;
    const i = m.idx(x, y);
    if (m.occupant[i] !== 0) return false;
    const t = m.terrain[i];
    return t === T.Grass || t === T.Dirt || t === T.Sand;
  }

  // ---------------------------------------------------------------- units

  private updateUnit(e: Entity): void {
    const d = e.u;
    if (e.flash > 0) e.flash--;
    for (let i = 0; i < e.cooldown.length; i++) if (e.cooldown[i] > 0) e.cooldown[i]--;
    if (this.tick % 30 === 0 && e.hp < e.maxHp) {
      if (d.selfRepair && e.hp < e.maxHp * 0.6) e.hp = Math.min(e.maxHp, e.hp + e.maxHp * 0.015);
      if (e.rank >= 2) e.hp = Math.min(e.maxHp, e.hp + e.maxHp * 0.01);
    }
    if (d.stealth) e.cloaked = this.tick - e.lastFired > 75 && this.tick - e.lastDamaged > 45;
    e.moving = false;

    if (d.harvester) {
      if (e.order?.type === 'harvest') this.harvesterLogic(e);
      else if (e.order) this.runMoveOrder(e, e.order);
      return;
    }

    const o = e.order;
    if (!o) this.idle(e);
    else if (o.type === 'move') this.runMoveOrder(e, o);
    else if (o.type === 'attackMove') this.runAttackMove(e, o);
    else if (o.type === 'attack') this.runAttack(e, o);
    else if (o.type === 'enter') this.runEnter(e, o);

    // Turreted vehicles may shoot while driving; everybody else must stop.
    if (e.order?.type === 'move' && !d.turret) e.targetId = 0;
    if (e.moving && d.turret && this.tick % 8 === (e.id & 7) && !this.validTarget(e, this.get(e.targetId))) {
      e.targetId = this.findTarget(e, this.maxRange(e))?.id ?? 0;
    }
    this.fireControl(e);
  }

  private maxRange(e: Entity): number {
    let r = 0;
    for (const w of this.weaponsOf(e)) r = Math.max(r, w.range);
    return r;
  }

  private validTarget(e: Entity, t: Entity | undefined): t is Entity {
    return this.canTarget(e.owner, t);
  }

  private idle(e: Entity): void {
    if (!e.u.weapons.length) return;
    const t = this.get(e.targetId);
    if (this.validTarget(e, t) && t.distTo(e.x, e.y) <= (this.maxRange(e) + 0.5) * TILE) return;
    if (this.tick % 8 === (e.id & 7)) e.targetId = this.findTarget(e, this.maxRange(e) + 0.5)?.id ?? 0;
  }

  private runMoveOrder(e: Entity, o: Order): void {
    const r = this.moveToward(e, o.gx, o.gy, o.x, o.y, o.groupRadius, o.moveId);
    if (r !== 'moving') {
      e.order = null;
      e.lastMoveId = o.moveId;
    }
  }

  private runAttackMove(e: Entity, o: Order): void {
    let t = this.get(e.targetId);
    if (!this.validTarget(e, t) || t.distTo(e.x, e.y) > e.sight * TILE * 1.3) {
      t = undefined;
      e.targetId = 0;
      if (this.tick % 8 === (e.id & 7)) {
        t = this.findTarget(e, Math.max(e.sight, this.maxRange(e))) ?? undefined;
        e.targetId = t?.id ?? 0;
      }
    }
    if (t && e.u.weapons.length) {
      if (!this.inRangeAny(e, t)) this.chase(e, t);
      return;
    }
    this.runMoveOrder(e, o);
  }

  private runAttack(e: Entity, o: Order): void {
    const t = this.get(o.target);
    if (!this.validTarget(e, t)) {
      e.order = null;
      e.targetId = 0;
      return;
    }
    e.targetId = t.id;
    if (!this.inRangeAny(e, t)) this.chase(e, t);
  }

  private runEnter(e: Entity, o: Order): void {
    const t = this.get(o.target);
    if (!t || !t.isBuilding || !this.isEnemy(e.owner, t.owner)) {
      e.order = null;
      return;
    }
    if (t.distTo(e.x, e.y) <= TILE * 0.8) {
      e.order = null;
      if (e.u.engineer) {
        this.capture(t, e.owner);
        this.kill(e, null, -1, true);
      } else if (e.u.commando && !t.c4At) {
        t.c4At = this.tick;
        this.fx('c4', t.x, t.y);
        this.sfx('c4', t.x, t.y);
        this.after(2.5, () => {
          if (!t.dead) this.kill(t, e.dead ? null : e, e.owner);
        });
      }
      return;
    }
    this.chase(e, t);
  }

  private chase(e: Entity, t: Entity): void {
    if (t.isBuilding) {
      const f = this.flow.getRect(this.map, t.tx, t.ty, t.b.w, t.b.h, this.passClass(e));
      this.followField(e, f, t.x, t.y);
    } else {
      const d = Math.hypot(t.x - e.x, t.y - e.y);
      if (d < TILE * 4) {
        this.steer(e, t.x, t.y, d);
        return;
      }
      // Quantise the goal so a pack chasing a moving target shares one field.
      const q = d < TILE * 12 ? 1 : 3;
      const cls = this.passClass(e);
      const gx = Math.floor(t.x / TILE / q) * q + (q >> 1);
      const gy = Math.floor(t.y / TILE / q) * q + (q >> 1);
      const g = nearestPassable(this.map, gx, gy, cls, 3) ?? { x: Math.floor(t.x / TILE), y: Math.floor(t.y / TILE) };
      this.moveToward(e, g.x, g.y, t.x, t.y, 0, 0);
    }
  }

  private inRangeAny(e: Entity, t: Entity): boolean {
    for (const w of this.weaponsOf(e)) if (this.inRange(e, t, w)) return true;
    return false;
  }

  private inRange(e: Entity, t: Entity, w: WeaponDef): boolean {
    const d = t.distTo(e.x, e.y) - (t.isUnit ? t.radius * 0.5 : 0) - (e.isBuilding ? TILE * 0.3 : 0);
    if (d > w.range * TILE) return false;
    if (w.minRange && d < w.minRange * TILE) return false;
    return true;
  }

  findTarget(e: Entity, rangeTiles: number): Entity | null {
    const weapons = this.weaponsOf(e);
    if (!weapons.length) return null;
    const w = weapons[0];
    const near = this.spatial.query(e.x, e.y, rangeTiles * TILE + 16, this.tmp);
    let best: Entity | null = null;
    let bestScore = Infinity;
    for (const n of near) {
      if (!this.canTarget(e.owner, n)) continue;
      const d = n.distTo(e.x, e.y);
      if (d > rangeTiles * TILE + (n.isUnit ? n.radius : 0)) continue;
      if (w.minRange && d < w.minRange * TILE) continue;
      const armor = n.isUnit ? n.u.armor : 'building';
      const eff = w.vs[ARMOR_INDEX[armor]];
      if (eff <= 0.01) continue;
      let score = d / (0.15 + eff);
      if (n.isBuilding) score *= n.b.wall ? 20 : n.b.weapon ? 1.2 : 3;
      else if (n.u.weapons.length) score *= 0.7;
      if (score < bestScore) {
        bestScore = score;
        best = n;
      }
    }
    return best;
  }

  /** Steps the unit along the shared flow field. Returns 'arrived', 'blocked' or 'moving'. */
  private moveToward(e: Entity, gx: number, gy: number, ex: number, ey: number, groupRadius: number, moveId: number): 'arrived' | 'blocked' | 'moving' {
    const dist = Math.hypot(ex - e.x, ey - e.y);
    if (dist <= 3) return 'arrived';
    const f = this.flow.get(this.map, gx, gy, this.passClass(e));
    const r = this.followField(e, f, ex, ey);
    if (r === 'blocked') return 'blocked';
    if (moveId && dist < groupRadius) {
      const near = this.spatial.query(e.x, e.y, e.radius + 14, this.tmp);
      for (const n of near) {
        if (n === e || !n.isUnit || n.moving || n.order) continue;
        if (n.lastMoveId === moveId && Math.hypot(n.x - e.x, n.y - e.y) < e.radius + n.radius + 3) return 'arrived';
      }
    }
    if (this.tick % 15 === 0) {
      if (Math.hypot(e.x - e.lastX, e.y - e.lastY) < 3) e.stuck += 15;
      else e.stuck = 0;
      e.lastX = e.x;
      e.lastY = e.y;
      if (moveId && e.stuck >= 45 && dist < groupRadius * 1.5 + TILE) return 'arrived';
      if (e.stuck >= 240) return 'blocked';
    }
    return 'moving';
  }

  private followField(e: Entity, f: ReturnType<FlowCache['get']>, ex: number, ey: number): 'moving' | 'blocked' {
    const m = this.map;
    const cx = Math.floor(e.x / TILE);
    const cy = Math.floor(e.y / TILE);
    if (!m.inBounds(cx, cy)) return 'blocked';
    const c = f.cost[m.idx(cx, cy)];
    let tx = ex;
    let ty = ey;
    if (!(cx === f.gx && cy === f.gy) && c > 1.5) {
      const s = nextStep(m, f, cx, cy);
      if (!s) {
        if (c === Infinity) {
          // Squeezed onto an impassable cell? Step off it.
          const free = nearestPassable(m, cx, cy, f.cls, 3);
          if (!free || (free.x === cx && free.y === cy)) return 'blocked';
          tx = free.x * TILE + TILE / 2;
          ty = free.y * TILE + TILE / 2;
        }
      } else {
        tx = s.x * TILE + TILE / 2;
        ty = s.y * TILE + TILE / 2;
        const s2 = nextStep(m, f, s.x, s.y);
        if (s2) {
          tx = (tx + s2.x * TILE + TILE / 2) / 2;
          ty = (ty + s2.y * TILE + TILE / 2) / 2;
        }
      }
    }
    this.steer(e, tx, ty, Math.hypot(ex - e.x, ey - e.y));
    return 'moving';
  }

  private steer(e: Entity, tx: number, ty: number, remaining: number): void {
    const d = e.u;
    const desired = Math.atan2(ty - e.y, tx - e.x);
    const speed = (d.speed * TILE) / TICK_RATE;
    let step: number;
    let dir: number;
    if (d.cls === 'infantry') {
      e.angle = desired;
      dir = desired;
      step = speed;
    } else {
      const diff = angleDiff(desired, e.angle);
      const maxTurn = d.turnRate * DT;
      e.angle += Math.max(-maxTurn, Math.min(maxTurn, diff));
      const ad = Math.abs(diff);
      step = ad < 0.5 ? speed : ad < 1.3 ? speed * 0.35 : 0;
      dir = e.angle;
      if (!d.turret) e.turret = e.angle;
    }
    step = Math.min(step, remaining);
    if (step <= 0) {
      e.moving = true;
      return;
    }
    this.tryMove(e, e.x + Math.cos(dir) * step, e.y + Math.sin(dir) * step);
    e.moving = true;
    e.walk += step;
  }

  private tryMove(e: Entity, nx: number, ny: number): void {
    const cls = this.passClass(e);
    const m = this.map;
    if (m.passable(Math.floor(nx / TILE), Math.floor(ny / TILE), cls)) {
      e.x = nx;
      e.y = ny;
    } else if (m.passable(Math.floor(nx / TILE), Math.floor(e.y / TILE), cls)) {
      e.x = nx;
    } else if (m.passable(Math.floor(e.x / TILE), Math.floor(ny / TILE), cls)) {
      e.y = ny;
    }
  }

  /** Soft collision between units, plus the classic tank-crushes-infantry. */
  private separate(): void {
    const near: Entity[] = [];
    for (const e of this.units) {
      if (e.dead) continue;
      this.spatial.query(e.x, e.y, e.radius + 16, near);
      for (const n of near) {
        if (n.id <= e.id || !n.isUnit || n.dead) continue;
        const dx = n.x - e.x;
        const dy = n.y - e.y;
        const dist = Math.hypot(dx, dy) || 0.01;
        const minD = (e.radius + n.radius) * 0.85;
        if (dist >= minD) continue;
        if (this.tryCrush(e, n) || this.tryCrush(n, e)) continue;
        const overlap = (minD - dist) * 0.5;
        const ux = dx / dist;
        const uy = dy / dist;
        let we = e.moving && !n.moving ? 0.3 : !e.moving && n.moving ? 0.7 : 0.5;
        // Vehicles shove infantry aside.
        if (e.u.cls === 'vehicle' && n.u.cls === 'infantry') we = 0.05;
        else if (n.u.cls === 'vehicle' && e.u.cls === 'infantry') we = 0.95;
        this.tryMove(e, e.x - ux * overlap * we, e.y - uy * overlap * we);
        this.tryMove(n, n.x + ux * overlap * (1 - we), n.y + uy * overlap * (1 - we));
      }
    }
  }

  private tryCrush(v: Entity, i: Entity): boolean {
    if (!v.u.crusher || !v.moving || i.u.cls !== 'infantry' || !this.isEnemy(v.owner, i.owner)) return false;
    if (Math.hypot(v.x - i.x, v.y - i.y) > v.radius * 0.8) return false;
    this.fx('crush', i.x, i.y, { color: this.players[i.owner].color });
    this.sfx('crush', i.x, i.y);
    this.kill(i, v, v.owner, true);
    this.eva(i.owner, 'unitlost', 'Unit lost', 6);
    return true;
  }

  // ---------------------------------------------------------------- harvesting

  private harvesterLogic(e: Entity): void {
    const m = this.map;
    const p = this.players[e.owner];
    switch (e.harvestState) {
      case 'wait':
      case 'seek': {
        if (e.harvestState === 'wait' && this.tick % 45 !== 0) return;
        if (e.cargo >= HARVEST_CAP) {
          e.harvestState = 'return';
          return;
        }
        const known = e.oreX >= 0 && e.oreY >= 0;
        const sx = known ? e.oreX : Math.floor(e.x / TILE);
        const sy = known ? e.oreY : Math.floor(e.y / TILE);
        const c = findNearestCell(m, sx, sy, PassClass.Vehicle, 45, (x, y) => m.ore[m.idx(x, y)] > 0 && m.passable(x, y, PassClass.Vehicle));
        if (!c) {
          e.harvestState = e.cargo > 0 ? 'return' : 'wait';
          return;
        }
        e.oreX = c.x;
        e.oreY = c.y;
        e.stuck = 0;
        e.harvestState = 'toOre';
        return;
      }
      case 'toOre': {
        const cx = Math.floor(e.x / TILE);
        const cy = Math.floor(e.y / TILE);
        if ((cx === e.oreX && cy === e.oreY) || (m.ore[m.idx(cx, cy)] > 0 && Math.abs(cx - e.oreX) + Math.abs(cy - e.oreY) <= 1)) {
          e.harvestState = 'harvesting';
          e.harvestTimer = 0;
          return;
        }
        if (m.ore[m.idx(e.oreX, e.oreY)] === 0) {
          e.harvestState = 'seek';
          return;
        }
        const r = this.moveToward(e, e.oreX, e.oreY, e.oreX * TILE + TILE / 2, e.oreY * TILE + TILE / 2, 0, 0);
        if (r === 'blocked') {
          e.oreX = -1;
          e.harvestState = 'seek';
        }
        return;
      }
      case 'harvesting': {
        const cx = Math.floor(e.x / TILE);
        const cy = Math.floor(e.y / TILE);
        const i = m.idx(cx, cy);
        if (m.ore[i] === 0) {
          const c = findNearestCell(m, cx, cy, PassClass.Vehicle, 3, (x, y) => m.ore[m.idx(x, y)] > 0);
          if (c) {
            e.oreX = c.x;
            e.oreY = c.y;
            e.harvestState = 'toOre';
          } else e.harvestState = e.cargo > 0 ? 'return' : 'seek';
          return;
        }
        if (++e.harvestTimer % 8 === 0) {
          const take = Math.min(SCOOP, m.ore[i], HARVEST_CAP - e.cargo);
          m.ore[i] -= take;
          e.cargo += take;
          m.oreDirty = true;
          e.angle += 0.15 * Math.sin(this.tick / 6);
          if (this.tick % 16 === 0) this.fx('sparkle', e.x, e.y, { color: '#5dff8a' });
          if (e.cargo >= HARVEST_CAP) e.harvestState = 'return';
        }
        return;
      }
      case 'return': {
        const ref = this.nearestRefinery(e);
        if (!ref) {
          e.harvestState = 'wait';
          return;
        }
        const dx = ref.tx + 1;
        const dy = ref.ty + ref.b.h;
        const px = dx * TILE + TILE / 2;
        const py = dy * TILE + TILE / 2;
        const dist = Math.hypot(px - e.x, py - e.y);
        if (dist < 8 || (dist < TILE * 2 && e.stuck >= 30)) {
          e.harvestState = 'unloading';
          e.harvestTimer = 0;
          return;
        }
        this.moveToward(e, dx, dy, px, py, 0, 0);
        if (this.tick % 15 === 0 && e.stuck >= 240) e.stuck = 0;
        return;
      }
      case 'unloading': {
        e.angle += angleDiff(-Math.PI / 2, e.angle) * 0.1;
        if (++e.harvestTimer % 3 === 0) {
          const amt = Math.min(SCOOP, e.cargo);
          e.cargo -= amt;
          const credits = amt * p.incomeMult * (this.cfg.mania ? 2 : 1);
          p.credits += credits;
          p.stats.harvested += credits;
          if (e.cargo <= 0) {
            e.cargo = 0;
            e.harvestState = 'seek';
          }
        }
        return;
      }
    }
  }

  private nearestRefinery(e: Entity): Entity | null {
    let best: Entity | null = null;
    let bd = Infinity;
    for (const b of this.buildings) {
      if (b.dead || b.owner !== e.owner || !b.b.refinery) continue;
      const d = Math.hypot(b.x - e.x, b.y - e.y);
      if (d < bd) {
        bd = d;
        best = b;
      }
    }
    return best;
  }

  // ---------------------------------------------------------------- buildings

  private updateBuilding(b: Entity): void {
    const p = this.players[b.owner];
    if (b.flash > 0) b.flash--;
    if (b.built < 1) {
      b.built = Math.min(1, b.built + 1 / TICK_RATE);
      return;
    }
    if (b.repairing && this.tick % 10 === 0) {
      const heal = b.maxHp * 0.025;
      const price = b.cost * 0.025 * 0.3;
      if (b.hp >= b.maxHp) b.repairing = false;
      else if (p.credits >= price) {
        p.credits -= price;
        b.hp = Math.min(b.maxHp, b.hp + heal);
        if (this.tick % 30 === 0) this.fx('sparkle', b.x + this.rng.range(-10, 10), b.y + this.rng.range(-10, 10), { color: '#7fd1ff' });
      } else b.repairing = false;
    }
    const w = b.b.weapon;
    if (!w) return;
    for (let i = 0; i < b.cooldown.length; i++) if (b.cooldown[i] > 0) b.cooldown[i]--;
    if (w.needsPower && p.lowPower) return;
    const t = this.get(b.targetId);
    if (!this.validTarget(b, t) || !this.inRange(b, t, w)) {
      b.targetId = 0;
      if (this.tick % 8 === (b.id & 7)) b.targetId = this.findTarget(b, w.range)?.id ?? 0;
    }
    this.fireControl(b);
  }

  // ---------------------------------------------------------------- combat

  private fireControl(e: Entity): void {
    const weapons = this.weaponsOf(e);
    if (!weapons.length) return;
    const t = this.get(e.targetId);
    if (!this.validTarget(e, t)) {
      e.targetId = 0;
      for (let i = 0; i < weapons.length; i++) e.burstLeft[i] = 0;
      return;
    }
    const desired = Math.atan2(t.y - e.y, t.x - e.x);
    let aimed = false;
    if (e.isBuilding) {
      e.turret += Math.max(-0.25, Math.min(0.25, angleDiff(desired, e.turret)));
      aimed = Math.abs(angleDiff(desired, e.turret)) < 0.2;
    } else if (e.u.cls === 'infantry') {
      if (e.moving) return;
      e.angle = desired;
      e.turret = desired;
      aimed = true;
    } else if (e.u.turret) {
      const tr = e.u.turnRate * 1.8 * DT;
      e.turret += Math.max(-tr, Math.min(tr, angleDiff(desired, e.turret)));
      aimed = Math.abs(angleDiff(desired, e.turret)) < 0.15;
    } else {
      if (e.moving) return;
      const tr = e.u.turnRate * DT;
      e.angle += Math.max(-tr, Math.min(tr, angleDiff(desired, e.angle)));
      e.turret = e.angle;
      aimed = Math.abs(angleDiff(desired, e.angle)) < 0.2;
    }
    const rof = e.rank === 2 ? 0.75 : e.rank === 1 ? 0.88 : 1;
    for (let i = 0; i < weapons.length; i++) {
      const w = weapons[i];
      if (e.burstLeft[i] > 0) {
        if (--e.burstTimer[i] <= 0) {
          e.burstLeft[i]--;
          e.burstTimer[i] = 5;
          this.fire(e, t, w, i);
        }
        continue;
      }
      if (e.cooldown[i] > 0 || !aimed || !this.inRange(e, t, w)) continue;
      e.cooldown[i] = Math.round(w.cooldown * TICK_RATE * rof);
      if (w.burst && w.burst > 1) {
        e.burstLeft[i] = w.burst - 1;
        e.burstTimer[i] = 5;
      }
      this.fire(e, t, w, i);
    }
  }

  private fire(e: Entity, t: Entity, w: WeaponDef, wi: number): void {
    e.lastFired = this.tick;
    e.cloaked = false;
    const mult = e.rank === 2 ? 1.5 : e.rank === 1 ? 1.25 : 1;
    const a = e.isUnit && e.u.cls === 'infantry' ? e.angle : e.turret;
    const reach = e.isUnit ? e.radius + 2 : TILE * 0.4;
    const side = wi === 1 || (e.burstLeft[wi] ?? 0) % 2 === 1 ? 4 : -4;
    const mx = e.x + Math.cos(a) * reach + Math.cos(a + Math.PI / 2) * (w.burst ? side : 0);
    const my = e.y + Math.sin(a) * reach + Math.sin(a + Math.PI / 2) * (w.burst ? side : 0) - (e.isBuilding ? 8 : 0);
    this.sfx(w.sound, mx, my);
    const jitter = t.isBuilding ? TILE * 0.6 : 3;
    const hx = t.x + this.rng.range(-jitter, jitter);
    const hy = t.y + this.rng.range(-jitter, jitter);
    switch (w.projectile) {
      case 'bullet':
      case 'sniper':
        this.fx('muzzle', mx, my, { x2: hx, y2: hy });
        this.fx('tracer', mx, my, { x2: hx, y2: hy, color: w.projectile === 'sniper' ? '#fffbe0' : '#ffe58a' });
        this.fx('smallHit', hx, hy);
        this.damageWeapon(t, w, mult, e, e.owner);
        break;
      case 'laser':
        this.fx('laser', mx, my - 10, { x2: hx, y2: hy, color: this.players[e.owner].color });
        this.applySplash(hx, hy, w, mult, e, t.id);
        break;
      case 'flame':
        this.fx('flame', mx, my, { x2: hx, y2: hy });
        this.applySplash(hx, hy, w, mult, e, t.id);
        break;
      default: {
        this.fx('muzzle', mx, my, { x2: hx, y2: hy, size: w.projectile === 'artillery' ? 2 : 1 });
        const dist = Math.hypot(hx - mx, hy - my);
        const speed = ((w.speed ?? 10) * TILE) / TICK_RATE;
        const scatter = w.projectile === 'artillery' ? TILE * 0.7 : 0;
        const tx = hx + this.rng.range(-scatter, scatter);
        const ty = hy + this.rng.range(-scatter, scatter);
        this.projectiles.push({
          kind: w.projectile as Projectile['kind'],
          owner: e.owner,
          srcId: e.id,
          targetId: t.id,
          x: mx,
          y: my,
          sx: mx,
          sy: my,
          tx,
          ty,
          t: 0,
          dur: Math.max(2, Math.round(dist / speed)),
          speed,
          weapon: w,
          mult,
          dead: false,
        });
      }
    }
  }

  private updateProjectiles(): void {
    for (const p of this.projectiles) {
      p.t++;
      if (p.kind === 'rocket') {
        const t = this.get(p.targetId);
        if (t) {
          p.tx = t.x;
          p.ty = t.y;
        }
        const dx = p.tx - p.x;
        const dy = p.ty - p.y;
        const d = Math.hypot(dx, dy);
        if (d <= p.speed || p.t > 150) {
          p.x = p.tx;
          p.y = p.ty;
          this.explode(p);
        } else {
          p.x += (dx / d) * p.speed;
          p.y += (dy / d) * p.speed;
        }
      } else {
        const k = p.t / p.dur;
        p.x = p.sx + (p.tx - p.sx) * k;
        p.y = p.sy + (p.ty - p.sy) * k;
        if (p.t >= p.dur) this.explode(p);
      }
    }
    if (this.projectiles.some((p) => p.dead)) this.projectiles = this.projectiles.filter((p) => !p.dead);
  }

  private explode(p: Projectile): void {
    p.dead = true;
    const w = p.weapon;
    const size = Math.max(0.5, (w.splash ?? 0.3) * 1.6);
    this.fx(p.kind === 'artillery' ? 'explosion' : 'smallHit', p.tx, p.ty, { size });
    if (p.kind === 'artillery') {
      this.emit({ t: 'decal', kind: 'crater', x: p.tx, y: p.ty, size: 0.8 });
      this.sfx('explode', p.tx, p.ty);
    } else this.sfx('hit', p.tx, p.ty);
    const src = this.get(p.srcId) ?? null;
    this.applySplash(p.tx, p.ty, w, p.mult, src, p.targetId, p.owner);
  }

  private applySplash(x: number, y: number, w: WeaponDef, mult: number, attacker: Entity | null, directId: number, owner = attacker?.owner ?? -1): void {
    const R = (w.splash ?? 0) * TILE;
    if (R <= 0) {
      const t = this.get(directId);
      if (t && t.distTo(x, y) <= t.radius + 10) this.damageWeapon(t, w, mult, attacker, owner);
      return;
    }
    const near = this.spatial.query(x, y, R + 16, []);
    for (const n of near) {
      const enemy = owner < 0 || this.isEnemy(owner, n.owner);
      if (!enemy && !(this.cfg.mania && R >= TILE)) continue;
      const d = n.distTo(x, y) - (n.isUnit ? n.radius : 0);
      if (n.id !== directId && d > R) continue;
      const f = n.id === directId ? 1 : Math.max(0.3, 1 - Math.max(0, d) / R);
      this.damageWeapon(n, w, mult * f * (enemy ? 1 : 0.5), attacker, owner);
    }
  }
}

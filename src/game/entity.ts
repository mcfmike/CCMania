import { TILE } from './constants';
import type { BuildingDef, Faction, ProdCategory, UnitDef } from './defs';
import { isUnitDef } from './defs';

export type OrderType = 'move' | 'attack' | 'attackMove' | 'enter' | 'harvest';

export interface Order {
  type: OrderType;
  /** Exact destination (px). */
  x: number;
  y: number;
  /** Shared flow-field goal cell for the group. */
  gx: number;
  gy: number;
  target: number;
  moveId: number;
  groupRadius: number;
}

export type HarvestState = 'seek' | 'toOre' | 'harvesting' | 'return' | 'unloading' | 'wait';

let nextEntityId = 1;
export function resetEntityIds(): void {
  nextEntityId = 1;
}

export class Entity {
  readonly id = nextEntityId++;
  readonly kind: 'unit' | 'building';
  readonly type: string;
  owner: number;
  x: number;
  y: number;
  hp: number;
  maxHp: number;
  dead = false;

  // Unit state
  angle = 0;
  turret = 0;
  order: Order | null = null;
  targetId = 0;
  cooldown: number[] = [];
  burstLeft: number[] = [];
  burstTimer: number[] = [];
  scanTimer = 0;
  stuck = 0;
  lastX = 0;
  lastY = 0;
  lastMoveId = 0;
  moving = false;
  walk = 0;
  xp = 0;
  rank = 0;
  kills = 0;
  lastFired = -9999;
  lastDamaged = -9999;
  lastAttacker = 0;
  cloaked = false;
  detected = false;
  flash = 0;

  // Harvester state
  cargo = 0;
  harvestState: HarvestState = 'seek';
  harvestTimer = 0;
  oreX = -1;
  oreY = -1;

  // Building state
  tx = 0;
  ty = 0;
  built = 1;
  repairing = false;
  rallyX = -1;
  rallyY = -1;
  c4At = 0;

  constructor(
    readonly def: UnitDef | BuildingDef,
    owner: number,
    x: number,
    y: number,
  ) {
    this.kind = isUnitDef(def) ? 'unit' : 'building';
    this.type = def.id;
    this.owner = owner;
    this.x = x;
    this.y = y;
    this.hp = def.hp;
    this.maxHp = def.hp;
    const weapons = isUnitDef(def) ? def.weapons : def.weapon ? [def.weapon] : [];
    this.cooldown = weapons.map(() => 0);
    this.burstLeft = weapons.map(() => 0);
    this.burstTimer = weapons.map(() => 0);
    this.lastX = x;
    this.lastY = y;
  }

  get u(): UnitDef {
    return this.def as UnitDef;
  }
  get b(): BuildingDef {
    return this.def as BuildingDef;
  }
  get isUnit(): boolean {
    return this.kind === 'unit';
  }
  get isBuilding(): boolean {
    return this.kind === 'building';
  }
  get radius(): number {
    return this.isUnit ? this.u.radius : (Math.max(this.b.w, this.b.h) * TILE) / 2;
  }
  get sight(): number {
    return this.def.sight;
  }
  get cost(): number {
    return this.def.cost;
  }

  /** Distance from a point to this entity's footprint edge (buildings) or centre (units). */
  distTo(px: number, py: number): number {
    if (this.isUnit) return Math.hypot(px - this.x, py - this.y);
    const x0 = this.tx * TILE;
    const y0 = this.ty * TILE;
    const x1 = x0 + this.b.w * TILE;
    const y1 = y0 + this.b.h * TILE;
    const dx = Math.max(x0 - px, 0, px - x1);
    const dy = Math.max(y0 - py, 0, py - y1);
    return Math.hypot(dx, dy);
  }
}

export class ProdQueue {
  items: string[] = [];
  progress = 0;
  paid = 0;
  ready = false;
  stalled = false;
  onHold = false;
}

export type Difficulty = 'easy' | 'normal' | 'hard' | 'insane';

export interface PlayerConfig {
  name: string;
  faction: Faction;
  color: string;
  team: number;
  human: boolean;
  difficulty: Difficulty;
}

export class Player {
  credits = 0;
  powerOut = 0;
  powerIn = 0;
  queues: Record<ProdCategory, ProdQueue> = {
    structure: new ProdQueue(),
    infantry: new ProdQueue(),
    vehicle: new ProdQueue(),
  };
  superCharge = 0;
  superReady = false;
  superType: 'ion' | 'nuke' | null = null;
  defeated = false;
  /** Buildings owned per type (refreshed every tick). */
  owned: Record<string, number> = {};
  unitCount = 0;
  unitsByType: Record<string, number> = {};
  primary: Record<'infantry' | 'vehicle', number> = { infantry: 0, vehicle: 0 };
  visible: Uint8Array;
  explored: Uint8Array;
  buildSpeed = 1;
  incomeMult = 1;
  stats = { unitsBuilt: 0, unitsLost: 0, kills: 0, structuresBuilt: 0, structuresLost: 0, harvested: 0 };
  lastHit = -9999;

  constructor(
    readonly index: number,
    readonly cfg: PlayerConfig,
    mapSize: number,
  ) {
    this.visible = new Uint8Array(mapSize);
    this.explored = new Uint8Array(mapSize);
  }

  get name(): string {
    return this.cfg.name;
  }
  get faction(): Faction {
    return this.cfg.faction;
  }
  get color(): string {
    return this.cfg.color;
  }
  get team(): number {
    return this.cfg.team;
  }
  get human(): boolean {
    return this.cfg.human;
  }
  get lowPower(): boolean {
    return this.powerIn > this.powerOut;
  }
}

export type FxKind =
  | 'explosion'
  | 'bigExplosion'
  | 'smallHit'
  | 'muzzle'
  | 'tracer'
  | 'laser'
  | 'flame'
  | 'smoke'
  | 'infantryDeath'
  | 'crush'
  | 'ion'
  | 'nukeLaunch'
  | 'nuke'
  | 'sparkle'
  | 'sell'
  | 'capture'
  | 'c4';

export type GameEvent =
  | { t: 'sfx'; name: string; x: number; y: number }
  | { t: 'eva'; key: string; text: string }
  | { t: 'fx'; kind: FxKind; x: number; y: number; x2?: number; y2?: number; size?: number; color?: string }
  | { t: 'shake'; amount: number }
  | { t: 'decal'; kind: 'scorch' | 'crater' | 'rubble'; x: number; y: number; size: number }
  | { t: 'message'; text: string };

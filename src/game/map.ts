import { PassClass } from './constants';

/** Terrain types. The char in TERRAIN_CHARS is the code used in map files. */
export const enum T {
  Grass = 0,
  Dirt = 1,
  Sand = 2,
  Rock = 3,
  Water = 4,
  Tree = 5,
  Concrete = 6,
}
export const TERRAIN_CHARS = 'gdsrwtc';
export const TERRAIN_NAMES = ['Grass', 'Dirt', 'Sand', 'Rock / cliff', 'Water', 'Trees', 'Concrete'];
export const TERRAIN_COUNT = 7;

/** Credits stored per ore density step (map files use digits 0-9). */
export const ORE_PER_LEVEL = 60;
export const ORE_MAX = 9 * ORE_PER_LEVEL;

export interface MapEntity {
  kind: 'unit' | 'building';
  type: string;
  /** Start-position index that owns it (0-3). */
  owner: number;
  x: number;
  y: number;
}

export interface Point {
  x: number;
  y: number;
}

/** Plain-JSON map file. Terrain and ore rows are readable ASCII so maps can be hand-edited. */
export interface MapData {
  format: 'ccmania-map';
  version: 1;
  name: string;
  author: string;
  description: string;
  width: number;
  height: number;
  terrain: string[];
  ore: string[];
  starts: Point[];
  blossoms: Point[];
  entities: MapEntity[];
}

export class GameMap {
  readonly w: number;
  readonly h: number;
  name = 'Untitled';
  author = '';
  description = '';
  terrain: Uint8Array;
  ore: Uint16Array;
  /** Cells that belong to a Veridium field; depleted field cells slowly regrow. */
  oreField: Uint8Array;
  /** Building id occupying each cell, 0 when free. */
  occupant: Int32Array;
  starts: Point[] = [];
  blossoms: Point[] = [];
  entities: MapEntity[] = [];
  /** Bumped whenever passability changes, used to invalidate flow fields. */
  version = 0;
  private masks: (Uint8Array | null)[] = [null, null, null];
  private maskVersion = [-1, -1, -1];

  /** 1 where the class can stand, cached per map version. */
  passMask(cls: PassClass): Uint8Array {
    if (this.maskVersion[cls] !== this.version || !this.masks[cls]) {
      const m = this.masks[cls] ?? new Uint8Array(this.w * this.h);
      for (let i = 0; i < m.length; i++) m[i] = this.passableIdx(i, cls) ? 1 : 0;
      this.masks[cls] = m;
      this.maskVersion[cls] = this.version;
    }
    return this.masks[cls]!;
  }

  /** Cells whose ore changed since the renderer last looked. */
  oreDirty = true;

  constructor(w: number, h: number) {
    this.w = w;
    this.h = h;
    this.terrain = new Uint8Array(w * h);
    this.ore = new Uint16Array(w * h);
    this.oreField = new Uint8Array(w * h);
    this.occupant = new Int32Array(w * h);
  }

  inBounds(x: number, y: number): boolean {
    return x >= 0 && y >= 0 && x < this.w && y < this.h;
  }

  idx(x: number, y: number): number {
    return y * this.w + x;
  }

  t(x: number, y: number): T {
    return this.terrain[y * this.w + x] as T;
  }

  terrainPassable(t: T, cls: PassClass): boolean {
    if (t === T.Rock) return false;
    if (t === T.Water) return cls === PassClass.Hover;
    if (t === T.Tree) return cls === PassClass.Infantry;
    return true;
  }

  passable(x: number, y: number, cls: PassClass): boolean {
    if (!this.inBounds(x, y)) return false;
    const i = y * this.w + x;
    if (this.occupant[i] !== 0) return false;
    return this.terrainPassable(this.terrain[i] as T, cls);
  }

  passableIdx(i: number, cls: PassClass): boolean {
    if (this.occupant[i] !== 0) return false;
    return this.terrainPassable(this.terrain[i] as T, cls);
  }

  buildable(x: number, y: number): boolean {
    if (!this.inBounds(x, y)) return false;
    const i = y * this.w + x;
    if (this.occupant[i] !== 0 || this.ore[i] > 0) return false;
    const t = this.terrain[i];
    return t === T.Grass || t === T.Dirt || t === T.Sand || t === T.Concrete;
  }

  static fromData(d: MapData): GameMap {
    const m = new GameMap(d.width, d.height);
    m.name = d.name;
    m.author = d.author ?? '';
    m.description = d.description ?? '';
    for (let y = 0; y < d.height; y++) {
      const row = d.terrain[y] ?? '';
      const ore = d.ore?.[y] ?? '';
      for (let x = 0; x < d.width; x++) {
        const code = TERRAIN_CHARS.indexOf(row[x] ?? 'g');
        m.terrain[y * d.width + x] = code < 0 ? T.Grass : code;
        const digit = parseInt(ore[x] ?? '0', 10);
        m.ore[y * d.width + x] = Number.isFinite(digit) ? digit * ORE_PER_LEVEL : 0;
      }
    }
    for (let i = 0; i < m.ore.length; i++) if (m.ore[i] > 0) m.oreField[i] = 1;
    m.starts = (d.starts ?? []).map((p) => ({ x: p.x, y: p.y }));
    m.blossoms = (d.blossoms ?? []).map((p) => ({ x: p.x, y: p.y }));
    m.entities = (d.entities ?? []).map((e) => ({ ...e }));
    return m;
  }

  toData(): MapData {
    const terrain: string[] = [];
    const ore: string[] = [];
    for (let y = 0; y < this.h; y++) {
      let row = '';
      let orow = '';
      for (let x = 0; x < this.w; x++) {
        const i = y * this.w + x;
        row += TERRAIN_CHARS[this.terrain[i]];
        orow += Math.min(9, Math.round(this.ore[i] / ORE_PER_LEVEL)).toString();
      }
      terrain.push(row);
      ore.push(orow);
    }
    return {
      format: 'ccmania-map',
      version: 1,
      name: this.name,
      author: this.author,
      description: this.description,
      width: this.w,
      height: this.h,
      terrain,
      ore,
      starts: this.starts.map((p) => ({ ...p })),
      blossoms: this.blossoms.map((p) => ({ ...p })),
      entities: this.entities.map((e) => ({ ...e })),
    };
  }

  clone(): GameMap {
    return GameMap.fromData(this.toData());
  }
}

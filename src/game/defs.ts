export type Armor = 'infantry' | 'light' | 'heavy' | 'building';
export const ARMOR_INDEX: Record<Armor, number> = { infantry: 0, light: 1, heavy: 2, building: 3 };

export type Faction = 'vanguard' | 'ember';
export type ProjectileKind = 'bullet' | 'shell' | 'rocket' | 'flame' | 'laser' | 'artillery' | 'sniper';

export interface WeaponDef {
  id: string;
  damage: number;
  /** Range in tiles. */
  range: number;
  minRange?: number;
  /** Seconds between shots. */
  cooldown: number;
  burst?: number;
  projectile: ProjectileKind;
  /** Projectile speed in tiles per second (ignored for instant weapons). */
  speed?: number;
  /** Splash radius in tiles. */
  splash?: number;
  /** Damage multiplier vs [infantry, light, heavy, building]. */
  vs: [number, number, number, number];
  sound: string;
  /** Can this weapon hit air? (Reserved, no air units yet.) */
  needsPower?: boolean;
}

export type UnitClass = 'infantry' | 'vehicle';
export type ProdCategory = 'structure' | 'infantry' | 'vehicle';

export interface UnitDef {
  id: string;
  name: string;
  desc: string;
  cls: UnitClass;
  cost: number;
  buildTime: number;
  hp: number;
  armor: Armor;
  /** Tiles per second. */
  speed: number;
  /** Radians per second. */
  turnRate: number;
  sight: number;
  radius: number;
  weapons: WeaponDef[];
  turret?: boolean;
  crusher?: boolean;
  prereq: string[];
  faction?: Faction;
  harvester?: boolean;
  engineer?: boolean;
  commando?: boolean;
  stealth?: boolean;
  selfRepair?: boolean;
  limit?: number;
}

export interface BuildingDef {
  id: string;
  name: string;
  desc: string;
  w: number;
  h: number;
  cost: number;
  buildTime: number;
  hp: number;
  power: number;
  sight: number;
  prereq: string[];
  faction?: Faction;
  weapon?: WeaponDef;
  produces?: 'infantry' | 'vehicle' | 'structure';
  refinery?: boolean;
  superweapon?: 'ion' | 'nuke';
  wall?: boolean;
  radar?: boolean;
  defense?: boolean;
  buildable?: boolean;
}

const W = {
  rifle: { id: 'rifle', damage: 12, range: 4.5, cooldown: 0.8, projectile: 'bullet', vs: [1, 0.35, 0.15, 0.2], sound: 'rifle' },
  mg: { id: 'mg', damage: 9, range: 5, cooldown: 0.25, projectile: 'bullet', vs: [1, 0.45, 0.15, 0.15], sound: 'mg' },
  towerMg: { id: 'towerMg', damage: 12, range: 5.5, cooldown: 0.3, projectile: 'bullet', vs: [1, 0.5, 0.2, 0.15], sound: 'mg' },
  rockets: { id: 'rockets', damage: 45, range: 6, cooldown: 2.2, projectile: 'rocket', speed: 9, splash: 0.4, vs: [0.3, 1, 0.9, 0.55], sound: 'rocket' },
  flame: { id: 'flame', damage: 38, range: 2.6, cooldown: 1.1, projectile: 'flame', splash: 1.0, vs: [1.3, 0.5, 0.3, 0.9], sound: 'flame' },
  sniper: { id: 'sniper', damage: 250, range: 7.5, cooldown: 1.6, projectile: 'sniper', vs: [1, 0.05, 0.02, 0], sound: 'sniper' },
  cannon: { id: 'cannon', damage: 38, range: 5, cooldown: 1.5, projectile: 'shell', speed: 18, splash: 0.35, vs: [0.35, 1, 0.8, 0.6], sound: 'cannon' },
  bigCannon: { id: 'bigCannon', damage: 60, range: 5.5, cooldown: 2.0, burst: 2, projectile: 'shell', speed: 18, splash: 0.45, vs: [0.4, 1, 1, 0.75], sound: 'bigCannon' },
  titanMissile: { id: 'titanMissile', damage: 40, range: 7, cooldown: 3.2, burst: 2, projectile: 'rocket', speed: 10, splash: 0.5, vs: [0.6, 0.9, 1, 0.6], sound: 'rocket' },
  artillery: { id: 'artillery', damage: 120, range: 11, minRange: 3, cooldown: 4.5, projectile: 'artillery', speed: 7, splash: 1.5, vs: [1, 0.7, 0.45, 0.85], sound: 'artillery' },
  stealthMissile: { id: 'stealthMissile', damage: 34, range: 6, cooldown: 2.4, burst: 2, projectile: 'rocket', speed: 11, splash: 0.35, vs: [0.3, 1, 0.85, 0.6], sound: 'rocket' },
  bastion: { id: 'bastion', damage: 40, range: 7.5, cooldown: 2.0, burst: 2, projectile: 'rocket', speed: 12, splash: 0.4, vs: [0.6, 1, 0.9, 0.5], sound: 'rocket', needsPower: true },
  laser: { id: 'laser', damage: 230, range: 7.5, cooldown: 3.6, projectile: 'laser', splash: 0.3, vs: [1, 1, 1, 0.8], sound: 'laser', needsPower: true },
} satisfies Record<string, WeaponDef>;

export const WEAPONS: Record<string, WeaponDef> = W;

const unitList: UnitDef[] = [
  { id: 'rifleman', name: 'Rifleman', desc: 'Cheap, fast to train. Good vs infantry.', cls: 'infantry', cost: 100, buildTime: 4, hp: 50, armor: 'infantry', speed: 1.3, turnRate: 12, sight: 5, radius: 5, weapons: [W.rifle], prereq: ['barracks'] },
  { id: 'rocketeer', name: 'Rocket Soldier', desc: 'Anti-armor rockets. Shreds tanks.', cls: 'infantry', cost: 300, buildTime: 6, hp: 45, armor: 'infantry', speed: 1.1, turnRate: 12, sight: 6, radius: 5, weapons: [W.rockets], prereq: ['barracks'] },
  { id: 'flamer', name: 'Flame Trooper', desc: 'Short-range flamethrower. Burns infantry and structures.', cls: 'infantry', cost: 350, buildTime: 7, hp: 70, armor: 'infantry', speed: 1.2, turnRate: 12, sight: 5, radius: 5, weapons: [W.flame], prereq: ['barracks'] },
  { id: 'engineer', name: 'Engineer', desc: 'Captures enemy structures. Unarmed.', cls: 'infantry', cost: 500, buildTime: 8, hp: 40, armor: 'infantry', speed: 1.2, turnRate: 12, sight: 4, radius: 5, weapons: [], prereq: ['barracks'], engineer: true },
  { id: 'commando', name: 'Commando', desc: 'One-shots infantry from range, plants C4 on structures. Limit 1.', cls: 'infantry', cost: 1500, buildTime: 20, hp: 160, armor: 'infantry', speed: 1.6, turnRate: 12, sight: 8, radius: 6, weapons: [W.sniper], prereq: ['barracks', 'tech'], commando: true, limit: 1 },
  { id: 'raider', name: 'Raider Buggy', desc: 'Fast scout with machine gun.', cls: 'vehicle', cost: 400, buildTime: 7, hp: 160, armor: 'light', speed: 3.4, turnRate: 6, sight: 7, radius: 10, weapons: [W.mg], prereq: ['factory'] },
  { id: 'harvester', name: 'Harvester', desc: 'Collects Veridium crystals for credits.', cls: 'vehicle', cost: 1400, buildTime: 14, hp: 700, armor: 'heavy', speed: 1.7, turnRate: 3, sight: 4, radius: 14, weapons: [], prereq: ['factory', 'refinery'], harvester: true, crusher: true },
  { id: 'lancer', name: 'Lancer Tank', desc: 'Main battle tank. Solid all-rounder.', cls: 'vehicle', cost: 700, buildTime: 10, hp: 320, armor: 'heavy', speed: 2.0, turnRate: 4, sight: 6, radius: 12, weapons: [W.cannon], turret: true, crusher: true, prereq: ['factory'] },
  { id: 'howitzer', name: 'Howitzer', desc: 'Long-range artillery. Fragile up close.', cls: 'vehicle', cost: 900, buildTime: 13, hp: 140, armor: 'light', speed: 1.4, turnRate: 3, sight: 6, radius: 12, weapons: [W.artillery], prereq: ['factory', 'radar'] },
  { id: 'titan', name: 'Titan Tank', desc: 'Twin cannons + missile pods. Self-repairs. Vanguard only.', cls: 'vehicle', cost: 1800, buildTime: 22, hp: 950, armor: 'heavy', speed: 1.1, turnRate: 2.5, sight: 7, radius: 16, weapons: [W.bigCannon, W.titanMissile], turret: true, crusher: true, prereq: ['factory', 'tech'], faction: 'vanguard', selfRepair: true },
  { id: 'wraith', name: 'Wraith Stealth Tank', desc: 'Cloaks when not firing. Ember only.', cls: 'vehicle', cost: 1000, buildTime: 14, hp: 240, armor: 'light', speed: 2.7, turnRate: 5, sight: 7, radius: 12, weapons: [W.stealthMissile], prereq: ['factory', 'tech'], faction: 'ember', stealth: true, crusher: true },
];

const buildingList: BuildingDef[] = [
  { id: 'conyard', name: 'Construction Yard', desc: 'Builds all structures.', w: 3, h: 3, cost: 3500, buildTime: 30, hp: 2200, power: 0, sight: 6, prereq: [], produces: 'structure', buildable: false },
  { id: 'power', name: 'Power Plant', desc: 'Generates 100 power.', w: 2, h: 2, cost: 300, buildTime: 6, hp: 600, power: 100, sight: 4, prereq: ['conyard'] },
  { id: 'refinery', name: 'Refinery', desc: 'Processes Veridium. Comes with a free harvester.', w: 3, h: 3, cost: 2000, buildTime: 14, hp: 1000, power: -40, sight: 5, prereq: ['power'], refinery: true },
  { id: 'barracks', name: 'Barracks', desc: 'Trains infantry.', w: 2, h: 2, cost: 300, buildTime: 8, hp: 700, power: -20, sight: 5, prereq: ['power'], produces: 'infantry' },
  { id: 'factory', name: 'War Factory', desc: 'Builds vehicles.', w: 3, h: 3, cost: 2000, buildTime: 16, hp: 1300, power: -30, sight: 5, prereq: ['refinery'], produces: 'vehicle' },
  { id: 'radar', name: 'Comm Center', desc: 'Enables the radar minimap.', w: 2, h: 2, cost: 1000, buildTime: 12, hp: 800, power: -40, sight: 10, prereq: ['refinery'], radar: true },
  { id: 'guard', name: 'Guard Tower', desc: 'Machine-gun bunker. Anti-infantry.', w: 1, h: 1, cost: 500, buildTime: 6, hp: 550, power: -10, sight: 7, prereq: ['barracks'], weapon: W.towerMg, defense: true },
  { id: 'bastion', name: 'Rocket Bastion', desc: 'Twin rocket launcher. Needs power. Vanguard only.', w: 1, h: 1, cost: 1000, buildTime: 10, hp: 750, power: -30, sight: 8, prereq: ['radar'], weapon: W.bastion, defense: true, faction: 'vanguard' },
  { id: 'spire', name: 'Spire of Light', desc: 'Devastating laser tower. Needs power. Ember only.', w: 1, h: 1, cost: 1500, buildTime: 12, hp: 650, power: -75, sight: 8, prereq: ['radar'], weapon: W.laser, defense: true, faction: 'ember' },
  { id: 'tech', name: 'Tech Center', desc: 'Unlocks advanced units and superweapons.', w: 2, h: 2, cost: 1500, buildTime: 16, hp: 900, power: -100, sight: 5, prereq: ['factory', 'radar'] },
  { id: 'ion', name: 'Ion Uplink', desc: 'Orbital ion cannon. Vanguard superweapon.', w: 2, h: 2, cost: 5000, buildTime: 40, hp: 1200, power: -150, sight: 5, prereq: ['tech'], superweapon: 'ion', faction: 'vanguard' },
  { id: 'silo', name: 'Doom Silo', desc: 'Tactical nuclear missile. Ember superweapon.', w: 2, h: 2, cost: 5000, buildTime: 40, hp: 1200, power: -150, sight: 5, prereq: ['tech'], superweapon: 'nuke', faction: 'ember' },
  { id: 'wall', name: 'Concrete Wall', desc: 'Blocks movement. Cheap. Drag to build lines.', w: 1, h: 1, cost: 50, buildTime: 1, hp: 450, power: 0, sight: 1, prereq: ['conyard'], wall: true },
];

export const UNITS: Record<string, UnitDef> = Object.fromEntries(unitList.map((u) => [u.id, u]));
export const BUILDINGS: Record<string, BuildingDef> = Object.fromEntries(buildingList.map((b) => [b.id, b]));
export const UNIT_LIST = unitList;
export const BUILDING_LIST = buildingList;

export function isUnitDef(d: UnitDef | BuildingDef): d is UnitDef {
  return (d as UnitDef).cls !== undefined;
}

export function categoryOf(id: string): ProdCategory {
  const u = UNITS[id];
  if (u) return u.cls === 'infantry' ? 'infantry' : 'vehicle';
  return 'structure';
}

/** Seconds a superweapon takes to charge. */
export const SUPER_CHARGE = { normal: 300, mania: 60 };

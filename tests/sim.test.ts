import { describe, expect, it } from 'vitest';
import { PassClass } from '../src/game/constants';
import { parseMapJson } from '../src/game/mapio';
import type { MapData } from '../src/game/map';
import { buildField } from '../src/game/pathfinding';
import { TICK_RATE, TILE } from '../src/game/constants';
import { UNITS } from '../src/game/defs';
import { GameMap } from '../src/game/map';
import { BUILTIN_MAPS, DEFAULT_GEN, generateMap } from '../src/game/mapgen';
import { World, type GameConfig } from '../src/game/world';

function aiConfig(n: number, difficulty: 'normal' | 'insane' = 'normal', mania = false): GameConfig {
  const colors = ['#3d8bff', '#ff3b30', '#ffb000', '#b04dff'];
  return {
    players: Array.from({ length: n }, (_, i) => ({
      name: `AI ${i + 1}`,
      faction: i % 2 === 0 ? 'vanguard' : 'ember',
      color: colors[i],
      team: i,
      human: false,
      difficulty,
    })),
    mania,
    fog: true,
    startCredits: 5000,
    seed: 42,
    shuffleStarts: false,
  };
}

describe('map generator', () => {
  it('produces the requested starts and survives a JSON round trip', () => {
    for (const preset of BUILTIN_MAPS) {
      const m = generateMap(preset);
      expect(m.starts.length).toBe(preset.players);
      const back = GameMap.fromData(JSON.parse(JSON.stringify(m.toData())));
      expect(back.toData()).toEqual(m.toData());
    }
  });

  it('is deterministic for a seed', () => {
    const a = generateMap({ ...DEFAULT_GEN, seed: 99 }).toData();
    const b = generateMap({ ...DEFAULT_GEN, seed: 99 }).toData();
    expect(a).toEqual(b);
  });
});

describe('simulation', () => {
  it('two AIs build bases, harvest and fight for 8 minutes without errors', () => {
    const map = generateMap({ ...DEFAULT_GEN, seed: 7 });
    const w = new World(map, aiConfig(2));
    for (let i = 0; i < 8 * 60 * TICK_RATE; i++) {
      w.step();
      w.events.length = 0;
    }
    for (const p of w.players) {
      expect(p.owned.refinery ?? 0).toBeGreaterThan(0);
      expect(p.stats.harvested).toBeGreaterThan(1000);
      expect(p.stats.unitsBuilt).toBeGreaterThan(5);
    }
    const kills = w.players.reduce((s, p) => s + p.stats.kills, 0);
    expect(kills).toBeGreaterThan(0);
  }, 60_000);

  it('handles a 4-player insane mania brawl', () => {
    const map = generateMap(BUILTIN_MAPS[3]);
    const w = new World(map, aiConfig(4, 'insane', true));
    for (let i = 0; i < 5 * 60 * TICK_RATE; i++) {
      w.step();
      w.events.length = 0;
    }
    expect(w.units.length + w.buildings.length).toBeGreaterThan(0);
  }, 120_000);
});

describe('onslaught', () => {
  it('spawns escalating waves until the idle player falls', () => {
    const map = generateMap({ ...DEFAULT_GEN, seed: 3 });
    const w = new World(map, {
      players: [
        { name: 'You', faction: 'vanguard', color: '#3d8bff', team: 0, human: true, difficulty: 'normal' },
        { name: 'Horde', faction: 'ember', color: '#ff3b30', team: 1, human: false, difficulty: 'insane', horde: true },
      ],
      mania: false,
      fog: true,
      startCredits: 5000,
      seed: 1,
      shuffleStarts: false,
      mode: 'onslaught',
    });
    for (let i = 0; i < 10 * 60 * TICK_RATE && w.result === 'playing'; i++) {
      w.step();
      w.events.length = 0;
    }
    expect(w.onslaught!.wave).toBeGreaterThan(1);
    expect(w.result).toBe('defeat');
  }, 60_000);
});

describe('hand-made maps in /maps', () => {
  const files = Object.entries(import.meta.glob('../maps/*.json', { eager: true, import: 'default' }) as Record<string, MapData>);
  it.each(files)('%s is valid and every start can reach every other', (_file, data) => {
    const map = parseMapJson(JSON.stringify(data));
    expect(map.starts.length).toBeGreaterThanOrEqual(2);
    const field = buildField(map, [map.idx(map.starts[0].x, map.starts[0].y)], PassClass.Vehicle);
    for (const s of map.starts) expect(field.cost[map.idx(s.x, s.y)]).toBeLessThan(Infinity);
    // And the map can actually host a game.
    const w = new World(map, aiConfig(map.starts.length));
    for (let i = 0; i < 60 * TICK_RATE; i++) w.step();
    expect(w.buildings.length).toBeGreaterThan(map.starts.length);
  });
});

describe('new roster mechanics', () => {
  function duel() {
    const map = generateMap({ ...DEFAULT_GEN, seed: 11 });
    return new World(map, aiConfig(2));
  }

  it('MCVs deploy into a Construction Yard', () => {
    const w = duel();
    const s = w.map.starts[0];
    const mcv = w.spawnNear(0, UNITS.mcv, s.x, s.y + 6)!;
    w.step();
    const before = w.players[0].owned.conyard;
    // Find a clear spot by trying a few positions.
    let deployed = 0;
    for (let dx = -6; dx <= 6 && !deployed; dx += 3) {
      mcv.x = (s.x + dx) * TILE + 16;
      mcv.y = (s.y + 7) * TILE + 16;
      w.step();
      deployed = w.deploy([mcv.id]);
    }
    expect(deployed).toBe(1);
    expect(w.players[0].owned.conyard).toBe(before + 1);
  });

  it('medics heal wounded infantry', () => {
    const w = duel();
    const s = w.map.starts[0];
    const hurt = w.spawnNear(0, UNITS.rifleman, s.x + 4, s.y + 5)!;
    w.spawnNear(0, UNITS.medic, s.x + 5, s.y + 5);
    hurt.hp = 10;
    for (let i = 0; i < 4 * TICK_RATE; i++) w.step();
    expect(hurt.hp).toBeGreaterThan(30);
  });

  it('hover units can cross water, tanks cannot', () => {
    const w = duel();
    const water = w.map.terrain.indexOf(4);
    expect(water).toBeGreaterThanOrEqual(0);
    expect(w.map.passMask(PassClass.Hover)[water]).toBe(1);
    expect(w.map.passMask(PassClass.Vehicle)[water]).toBe(0);
  });

  it('ground-only weapons cannot target aircraft', () => {
    const w = duel();
    const s = w.map.starts[0];
    const orca = w.spawnNear(0, UNITS.orca, s.x + 4, s.y + 4)!;
    const tank = w.spawnNear(1, UNITS.raptor, s.x + 5, s.y + 4)!;
    const aa = w.spawnNear(1, UNITS.dragoon, s.x + 5, s.y + 5)!;
    w.step();
    expect(w.canHit(tank, orca)).toBe(false);
    expect(w.canHit(aa, orca)).toBe(true);
  });
});

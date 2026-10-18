import { describe, expect, it } from 'vitest';
import { TICK_RATE } from '../src/game/constants';
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

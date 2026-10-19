import './styles.css';
import { AudioEngine } from './audio/audio';
import type { GameMap } from './game/map';
import { World, type GameConfig } from './game/world';
import { EditorScreen } from './ui/editor';
import { GameScreen } from './ui/game';
import { SetupScreen, TEAM_COLORS, TitleScreen } from './ui/menu';
import { randomSeed } from './game/rng';

const app = document.getElementById('app')!;
const audio = new AudioEngine();
let current: { destroy(): void } | null = null;
let lastGame: { map: GameMap; config: GameConfig } | null = null;
let editorMap: GameMap | undefined;

function swap(next: () => { destroy(): void }): void {
  current?.destroy();
  current = null;
  app.innerHTML = '';
  current = next();
}

function title(): void {
  audio.stopMusic();
  swap(() => new TitleScreen(app, audio, { skirmish: setup, editor: () => editor() }));
}

function setup(): void {
  swap(() => new SetupScreen(app, { start: (r) => play(r.map, r.config), back: title }));
}

function editor(map?: GameMap): void {
  audio.stopMusic();
  swap(() => new EditorScreen(app, { back: title, play: (m) => playTest(m) }, map ?? editorMap));
}

function playTest(map: GameMap): void {
  editorMap = map.clone();
  const n = Math.min(4, map.starts.length);
  const config: GameConfig = {
    players: Array.from({ length: n }, (_, i) => ({
      name: i === 0 ? 'You' : `Test AI ${i}`,
      faction: i % 2 === 0 ? 'vanguard' : 'ember',
      color: TEAM_COLORS[i],
      team: i === 0 ? 0 : 1,
      human: i === 0,
      difficulty: 'normal',
    })),
    mania: false,
    fog: true,
    startCredits: 7500,
    seed: randomSeed(),
    shuffleStarts: false,
  };
  play(map, config, true);
}

function play(map: GameMap, config: GameConfig, fromEditor = false): void {
  lastGame = { map: map.clone(), config };
  audio.init();
  audio.startMusic();
  swap(() => {
    const world = new World(map.clone(), { ...config, seed: randomSeed() });
    return new GameScreen(app, world, audio, {
      onExit: fromEditor ? () => editor(editorMap) : title,
      onRestart: () => lastGame && play(lastGame.map, lastGame.config, fromEditor),
    });
  });
}

// Debug handle for poking at the running game from the browser console.
(window as unknown as { ccmania: unknown }).ccmania = {
  get screen() {
    return current;
  },
};

title();

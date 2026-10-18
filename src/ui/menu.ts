import type { AudioEngine } from '../audio/audio';
import { TICK_RATE, TILE } from '../game/constants';
import type { Difficulty, PlayerConfig } from '../game/entity';
import type { Faction } from '../game/defs';
import { GameMap, type MapData } from '../game/map';
import { BUILTIN_MAPS, DEFAULT_GEN, generateMap, type GenParams, type Symmetry } from '../game/mapgen';
import { listStoredMaps, mapFromImageData, parseMapJson, readFile } from '../game/mapio';
import { randomSeed } from '../game/rng';
import { World, type GameConfig } from '../game/world';
import { Renderer } from '../render/renderer';
import { terrainOverview } from '../render/terrain';
import { controlsHelp } from './game';
import { el } from './dom';

/** Any JSON map dropped into /maps shows up as a built-in map. */
const FILE_MAPS = Object.values(import.meta.glob('../../maps/*.json', { eager: true, import: 'default' }) as Record<string, MapData>);

const BUILTINS: { label: string; make: () => GameMap }[] = [
  ...FILE_MAPS.map((d) => ({ label: `${d.name} (${d.starts.length}p, ${d.width}×${d.height}, hand-made)`, make: () => GameMap.fromData(d) })),
  ...BUILTIN_MAPS.map((p) => ({ label: `${p.name} (${p.players}p, ${p.width}×${p.height})`, make: () => generateMap(p) })),
];

export const TEAM_COLORS = ['#3d8bff', '#ff3b30', '#ffb000', '#b04dff', '#2ee6a8', '#ff6ad5'];
const AI_NAMES = ['General Kessler', 'Overlord Vex', 'Marshal Ironside', 'The Prophet', 'Commander Rook', 'Colonel Ash'];

/** Title screen with a live AI-vs-AI battle raging in the background. */
export class TitleScreen {
  readonly root: HTMLElement;
  private world: World;
  private renderer: Renderer;
  private raf = 0;
  private last = performance.now();
  private acc = 0;
  private camTarget = { x: 0, y: 0 };
  private camTimer = 0;
  private endTimer = 0;
  private canvas: HTMLCanvasElement;

  constructor(host: HTMLElement, audio: AudioEngine, actions: { skirmish: () => void; editor: () => void }) {
    this.root = el('div', { class: 'title-screen' });
    const canvas = el('canvas', { class: 'attract' }) as HTMLCanvasElement;
    this.root.appendChild(canvas);
    const skirmish = el('button', { class: 'btn big primary' }, '⚔  Skirmish');
    const editor = el('button', { class: 'btn big' }, '🗺  Map Editor');
    const help = el('button', { class: 'btn big' }, '❓  How to Play');
    const helpPanel = el('div', { class: 'panel help-panel hidden' }, el('h2', {}, 'How to play'), howToPlay(), controlsHelp());
    skirmish.onclick = () => {
      audio.init();
      actions.skirmish();
    };
    editor.onclick = () => {
      audio.init();
      actions.editor();
    };
    help.onclick = () => helpPanel.classList.toggle('hidden');
    const menu = el(
      'div',
      { class: 'title-menu' },
      el('div', { class: 'logo' }, el('span', { class: 'logo-cc' }, 'CC'), el('span', { class: 'logo-mania' }, 'MANIA')),
      el('div', { class: 'tagline' }, 'A single-player RTS homage to Command & Conquer'),
      skirmish,
      editor,
      help,
      el('div', { class: 'fineprint' }, 'Fan-made tribute. Not affiliated with EA or Westwood. All art & audio generated in code.'),
    );
    this.root.append(menu, helpPanel);
    host.appendChild(this.root);

    this.canvas = canvas;
    [this.world, this.renderer] = this.newBattle();
    window.addEventListener('resize', this.onResize);
    this.raf = requestAnimationFrame((t) => this.frame(t));
  }

  private newBattle(): [World, Renderer] {
    const map = generateMap({ ...DEFAULT_GEN, seed: randomSeed(), width: 64, height: 64 });
    const world = new World(map, {
      players: [0, 1].map((i) => ({
        name: AI_NAMES[i],
        faction: i ? 'ember' : 'vanguard',
        color: TEAM_COLORS[i],
        team: i,
        human: false,
        difficulty: 'insane' as Difficulty,
      })),
      mania: true,
      fog: false,
      startCredits: 20000,
      seed: randomSeed(),
      shuffleStarts: false,
    });
    const renderer = new Renderer(this.canvas, world);
    renderer.cam.zoom = 1.2;
    renderer.centerOn((map.w * TILE) / 2, (map.h * TILE) / 2);
    // Fast-forward so the base-building is already under way.
    for (let i = 0; i < 40 * TICK_RATE; i++) world.step();
    world.events.length = 0;
    this.endTimer = 0;
    return [world, renderer];
  }

  private onResize = () => this.renderer.resize();

  private frame(now: number): void {
    const dt = Math.min(0.1, (now - this.last) / 1000);
    this.last = now;
    this.acc += dt;
    while (this.acc >= 1 / TICK_RATE) {
      this.world.step();
      this.acc -= 1 / TICK_RATE;
    }
    for (const e of this.world.events)
      if (e.t === 'fx' && (e.kind === 'explosion' || e.kind === 'bigExplosion') && this.camTimer <= 0) {
        this.camTarget = { x: e.x, y: e.y };
        this.camTimer = 4;
      }
    this.camTimer -= dt;
    this.renderer.consume(this.world.events.filter((e) => e.t !== 'shake'));
    this.world.events.length = 0;
    const r = this.renderer;
    const cx = r.cam.x + r.vw / r.cam.zoom / 2;
    const cy = r.cam.y + r.vh / r.cam.zoom / 2;
    r.centerOn(cx + (this.camTarget.x - cx) * dt * 0.6, cy + (this.camTarget.y - cy) * dt * 0.6);
    r.render({ selected: new Set(), hoverId: 0, placement: null, dragBox: null, cursor: 'none', mouse: { x: 0, y: 0 } }, dt);
    // Start a fresh demo battle a few seconds after one side falls.
    if (this.world.players.some((p) => p.defeated) && (this.endTimer += dt) > 6) [this.world, this.renderer] = this.newBattle();
    this.raf = requestAnimationFrame((t) => this.frame(t));
  }

  destroy(): void {
    cancelAnimationFrame(this.raf);
    window.removeEventListener('resize', this.onResize);
    this.root.remove();
  }
}

function howToPlay(): HTMLElement {
  return el(
    'div',
    { class: 'howto' },
    el('p', {}, 'Build a base, harvest green Veridium crystals for credits, raise an army and wipe out every enemy structure.'),
    el(
      'p',
      {},
      'Start with Power Plants, then a Refinery (comes with a Harvester), Barracks and War Factory. A Comm Center switches on your radar; the Tech Center unlocks Titans / Wraiths, the Commando and your superweapon.',
    ),
    el('p', {}, 'Watch the power bar: low power halves production, disables radar, Rocket Bastions and Spires, and stalls superweapons.'),
    el('p', {}, 'MANIA mode: 3× build speed, double income, 60-second superweapons, bigger starting armies and buildings that explode in chain reactions.'),
  );
}

// ------------------------------------------------------------------ skirmish setup

export interface SetupResult {
  map: GameMap;
  config: GameConfig;
}

type Source = 'builtin' | 'random' | 'saved' | 'file';

export class SetupScreen {
  readonly root: HTMLElement;
  private source: Source = 'builtin';
  private builtin = 0;
  private gen: GenParams = { ...DEFAULT_GEN, seed: randomSeed() };
  private saved = 0;
  private fileMap: GameMap | null = null;
  private map: GameMap;
  private preview: HTMLCanvasElement;
  private opponents: { difficulty: Difficulty; faction: Faction }[] = [{ difficulty: 'normal', faction: 'ember' }];
  private faction: Faction = 'vanguard';
  private color = 0;
  private teamMode: 'vsYou' | 'ffa' | 'allied' = 'vsYou';
  private credits = 7500;
  private mania = false;
  private fog = true;
  private shuffle = false;
  private mode: 'skirmish' | 'onslaught' = 'skirmish';
  private oppSection!: HTMLElement;
  private sourcePanel: HTMLElement;
  private oppPanel: HTMLElement;
  private mapInfo: HTMLElement;

  constructor(host: HTMLElement, actions: { start: (r: SetupResult) => void; back: () => void }) {
    this.root = el('div', { class: 'setup-screen' });
    this.preview = el('canvas', { class: 'preview', width: '256', height: '256' }) as HTMLCanvasElement;
    this.sourcePanel = el('div', { class: 'source-panel' });
    this.oppPanel = el('div', { class: 'opp-panel' });
    this.mapInfo = el('div', { class: 'map-info' });
    this.map = BUILTINS[0].make();

    const sources = el('div', { class: 'seg' });
    for (const [s, label] of [
      ['builtin', 'Built-in'],
      ['random', 'Random'],
      ['saved', 'My maps'],
      ['file', 'Import'],
    ] as [Source, string][]) {
      const b = el('button', { class: 'seg-btn' }, label);
      b.dataset.src = s;
      b.onclick = () => {
        this.source = s;
        this.renderSource();
        this.rebuildMap();
      };
      sources.appendChild(b);
    }

    const start = el('button', { class: 'btn big primary' }, '▶  START BATTLE');
    start.onclick = () => {
      const r = this.result();
      if (r) actions.start(r);
    };
    const back = el('button', { class: 'btn' }, '← Back');
    back.onclick = actions.back;

    const you = el(
      'div',
      { class: 'field' },
      el('label', {}, 'Your faction'),
      this.select(
        ['vanguard', 'ember'],
        ['Vanguard Accord (Ion cannon, Titan)', 'Order of the Ember (Nuke, Stealth, Spire)'],
        this.faction,
        (v) => (this.faction = v as Faction),
      ),
    );
    const colors = el('div', { class: 'swatches' });
    TEAM_COLORS.forEach((c, i) => {
      const s = el('button', { class: `swatch ${i === this.color ? 'on' : ''}`, style: `background:${c}` });
      s.onclick = () => {
        this.color = i;
        colors.querySelectorAll('.swatch').forEach((x, j) => x.classList.toggle('on', j === i));
      };
      colors.appendChild(s);
    });
    const modeSel = this.select(['skirmish', 'onslaught'], ['Skirmish — destroy all enemy bases', 'Onslaught — survive endless waves'], this.mode, (v) => {
      this.mode = v as typeof this.mode;
      this.oppSection.classList.toggle('hidden', this.mode === 'onslaught');
    });
    const options = el(
      'div',
      { class: 'options' },
      el('div', { class: 'field' }, el('label', {}, 'Game mode'), modeSel),
      you,
      el('div', { class: 'field' }, el('label', {}, 'Colour'), colors),
      el(
        'div',
        { class: 'field' },
        el('label', {}, 'Teams'),
        this.select(
          ['vsYou', 'ffa', 'allied'],
          ['Everyone vs you', 'Free-for-all', 'You + first AI as ally'],
          this.teamMode,
          (v) => (this.teamMode = v as typeof this.teamMode),
        ),
      ),
      el(
        'div',
        { class: 'field' },
        el('label', {}, 'Starting credits'),
        this.select(['5000', '7500', '15000', '50000'], ['$5,000', '$7,500', '$15,000', '$50,000'], String(this.credits), (v) => (this.credits = Number(v))),
      ),
      this.check(
        'MANIA MODE',
        'Triple build speed, double income, 60s superweapons, starting armies, chain-reaction explosions.',
        this.mania,
        (v) => (this.mania = v),
        'mania',
      ),
      this.check('Fog of war', 'Hide enemy units outside your sight range.', this.fog, (v) => (this.fog = v)),
      this.check('Random start positions', 'Shuffle who starts where.', this.shuffle, (v) => (this.shuffle = v)),
    );

    this.root.append(
      el('h1', {}, 'Skirmish'),
      el(
        'div',
        { class: 'setup-grid' },
        el('div', { class: 'panel' }, el('h3', {}, 'Battlefield'), sources, this.sourcePanel, this.preview, this.mapInfo),
        el('div', { class: 'panel' }, el('h3', {}, 'Commanders'), options, (this.oppSection = el('div', {}, el('h3', {}, 'Opponents'), this.oppPanel))),
      ),
      el('div', { class: 'row' }, back, start),
    );
    host.appendChild(this.root);
    this.renderSource();
    this.rebuildMap();
    this.renderOpponents();
  }

  destroy(): void {
    this.root.remove();
  }

  private select(values: string[], labels: string[], current: string, onChange: (v: string) => void): HTMLSelectElement {
    const s = el('select') as HTMLSelectElement;
    values.forEach((v, i) => s.appendChild(el('option', { value: v }, labels[i])));
    s.value = current;
    s.onchange = () => onChange(s.value);
    return s;
  }

  private check(label: string, hint: string, value: boolean, onChange: (v: boolean) => void, cls = ''): HTMLElement {
    const input = el('input', { type: 'checkbox' }) as HTMLInputElement;
    input.checked = value;
    input.onchange = () => onChange(input.checked);
    return el('label', { class: `check ${cls}` }, input, el('span', {}, el('b', {}, label), el('small', {}, hint)));
  }

  private slider(label: string, value: number, onChange: (v: number) => void): HTMLElement {
    const input = el('input', { type: 'range', min: '0', max: '1', step: '0.05' }) as HTMLInputElement;
    input.value = String(value);
    input.onchange = () => {
      onChange(Number(input.value));
      this.rebuildMap();
    };
    return el('label', { class: 'slider' }, el('span', {}, label), input);
  }

  private renderSource(): void {
    const p = this.sourcePanel;
    p.innerHTML = '';
    this.root.querySelectorAll<HTMLElement>('.seg-btn').forEach((b) => b.classList.toggle('on', b.dataset.src === this.source));
    if (this.source === 'builtin') {
      p.appendChild(
        this.select(
          BUILTINS.map((_, i) => String(i)),
          BUILTINS.map((m) => m.label),
          String(this.builtin),
          (v) => {
            this.builtin = Number(v);
            this.rebuildMap();
          },
        ),
      );
    } else if (this.source === 'random') {
      const g = this.gen;
      const seed = el('input', { type: 'number', value: String(g.seed) }) as HTMLInputElement;
      seed.onchange = () => {
        g.seed = Number(seed.value) >>> 0;
        this.rebuildMap();
      };
      const dice = el('button', { class: 'btn small' }, '🎲');
      dice.onclick = () => {
        g.seed = randomSeed();
        seed.value = String(g.seed);
        this.rebuildMap();
      };
      p.append(
        el('div', { class: 'row tight' }, el('label', {}, 'Seed'), seed, dice),
        el(
          'div',
          { class: 'row tight' },
          this.select(['64', '96', '128', '160'], ['Small 64²', 'Medium 96²', 'Large 128²', 'Huge 160²'], String(g.width), (v) => {
            g.width = g.height = Number(v);
            this.rebuildMap();
          }),
          this.select(['2', '3', '4'], ['2 players', '3 players', '4 players'], String(g.players), (v) => {
            g.players = Number(v);
            this.rebuildMap();
          }),
          this.select(['rotate', 'mirror', 'quad', 'none'], ['Rotational symmetry', 'Mirror symmetry', '4-way symmetry', 'No symmetry'], g.symmetry, (v) => {
            g.symmetry = v as Symmetry;
            this.rebuildMap();
          }),
        ),
        this.slider('Water', g.water, (v) => (g.water = v)),
        this.slider('Cliffs', g.cliffs, (v) => (g.cliffs = v)),
        this.slider('Forest', g.forest, (v) => (g.forest = v)),
        this.slider('Veridium', g.ore, (v) => (g.ore = v)),
      );
    } else if (this.source === 'saved') {
      const maps = listStoredMaps();
      if (!maps.length) p.appendChild(el('div', { class: 'muted' }, 'No saved maps yet. Make one in the Map Editor!'));
      else
        p.appendChild(
          this.select(
            maps.map((_, i) => String(i)),
            maps.map((m) => m.name),
            String(Math.min(this.saved, maps.length - 1)),
            (v) => {
              this.saved = Number(v);
              this.rebuildMap();
            },
          ),
        );
    } else {
      const input = el('input', { type: 'file', accept: '.json,.ccmap,.png,.gif,.bmp,.webp' }) as HTMLInputElement;
      input.onchange = async () => {
        const f = input.files?.[0];
        if (!f) return;
        try {
          const r = await readFile(f);
          this.fileMap = r.image ? mapFromImageData(r.image, f.name.replace(/\.[^.]+$/, '')) : parseMapJson(r.text!);
          this.rebuildMap();
        } catch (e) {
          alert(`Could not load map: ${(e as Error).message}`);
        }
      };
      p.append(
        input,
        el(
          'div',
          { class: 'muted' },
          'Load a .json map from the editor, or a PNG painted with the editor palette (1 pixel = 1 tile, red pixels = start positions).',
        ),
      );
    }
  }

  private rebuildMap(): void {
    try {
      if (this.source === 'builtin') this.map = BUILTINS[this.builtin].make();
      else if (this.source === 'random') this.map = generateMap(this.gen);
      else if (this.source === 'saved') {
        const maps = listStoredMaps();
        if (maps.length) this.map = parseMapJson(maps[Math.min(this.saved, maps.length - 1)].json);
      } else if (this.fileMap) this.map = this.fileMap;
    } catch (e) {
      alert(`Map error: ${(e as Error).message}`);
    }
    this.drawPreview();
    const maxOpp = Math.max(1, this.map.starts.length - 1);
    while (this.opponents.length > maxOpp) this.opponents.pop();
    this.renderOpponents();
  }

  private drawPreview(): void {
    const c = this.preview;
    const ctx = c.getContext('2d')!;
    const m = this.map;
    ctx.fillStyle = '#000';
    ctx.fillRect(0, 0, c.width, c.height);
    const s = Math.min(c.width / m.w, c.height / m.h);
    const ox = (c.width - m.w * s) / 2;
    const oy = (c.height - m.h * s) / 2;
    ctx.imageSmoothingEnabled = false;
    ctx.drawImage(terrainOverview(m), ox, oy, m.w * s, m.h * s);
    ctx.fillStyle = '#3cff5a';
    for (let i = 0; i < m.ore.length; i++) if (m.ore[i]) ctx.fillRect(ox + (i % m.w) * s, oy + Math.floor(i / m.w) * s, s, s);
    ctx.font = 'bold 14px sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    m.starts.forEach((st, i) => {
      ctx.fillStyle = '#000';
      ctx.beginPath();
      ctx.arc(ox + st.x * s, oy + st.y * s, 9, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = '#fff';
      ctx.fillText(String(i + 1), ox + st.x * s, oy + st.y * s + 1);
    });
    this.mapInfo.textContent = `${m.name} — ${m.w}×${m.h}, ${m.starts.length} start positions${m.author ? ' — by ' + m.author : ''}`;
  }

  private renderOpponents(): void {
    const p = this.oppPanel;
    p.innerHTML = '';
    this.opponents.forEach((o, i) => {
      const row = el(
        'div',
        { class: 'opp-row' },
        el('span', { class: 'dot', style: `background:${TEAM_COLORS[(this.color + i + 1) % TEAM_COLORS.length]}` }),
        el('span', { class: 'opp-name' }, AI_NAMES[i]),
        this.select(['easy', 'normal', 'hard', 'insane'], ['Easy', 'Normal', 'Hard', '☠ INSANE'], o.difficulty, (v) => (o.difficulty = v as Difficulty)),
        this.select(['vanguard', 'ember'], ['Vanguard', 'Ember'], o.faction, (v) => (o.faction = v as Faction)),
      );
      if (this.opponents.length > 1) {
        const rm = el('button', { class: 'btn small' }, '✕');
        rm.onclick = () => {
          this.opponents.splice(i, 1);
          this.renderOpponents();
        };
        row.appendChild(rm);
      }
      p.appendChild(row);
    });
    if (this.opponents.length < this.map.starts.length - 1) {
      const add = el('button', { class: 'btn small' }, '+ Add opponent');
      add.onclick = () => {
        this.opponents.push({ difficulty: 'normal', faction: this.opponents.length % 2 ? 'ember' : 'vanguard' });
        this.renderOpponents();
      };
      p.appendChild(add);
    }
    const insane = el('button', { class: 'btn small danger' }, '☠ Make it insane');
    insane.onclick = () => {
      this.opponents = Array.from({ length: Math.max(1, this.map.starts.length - 1) }, (_, i) => ({
        difficulty: 'insane' as Difficulty,
        faction: (i % 2 ? 'vanguard' : 'ember') as Faction,
      }));
      this.mania = true;
      this.teamMode = 'vsYou';
      this.root.querySelectorAll<HTMLInputElement>('.check.mania input').forEach((x) => (x.checked = true));
      this.renderOpponents();
    };
    p.appendChild(insane);
  }

  private result(): SetupResult | null {
    const m = this.map;
    const players: PlayerConfig[] = [{ name: 'You', faction: this.faction, color: TEAM_COLORS[this.color], team: 0, human: true, difficulty: 'normal' }];
    if (this.mode === 'onslaught') {
      if (m.starts.length < 1) {
        alert('This map needs a start position.');
        return null;
      }
      players.push({
        name: 'The Horde',
        faction: this.faction === 'vanguard' ? 'ember' : 'vanguard',
        color: TEAM_COLORS[(this.color + 1) % TEAM_COLORS.length],
        team: 1,
        human: false,
        difficulty: 'insane',
        horde: true,
      });
      return {
        map: m.clone(),
        config: { players, mania: this.mania, fog: this.fog, startCredits: this.credits, seed: randomSeed(), shuffleStarts: this.shuffle, mode: 'onslaught' },
      };
    }
    if (m.starts.length < 2) {
      alert('This map needs at least 2 start positions.');
      return null;
    }
    this.opponents.forEach((o, i) => {
      const team = this.teamMode === 'vsYou' ? 1 : this.teamMode === 'allied' && i === 0 ? 0 : i + 1;
      players.push({
        name: AI_NAMES[i],
        faction: o.faction,
        color: TEAM_COLORS[(this.color + i + 1) % TEAM_COLORS.length],
        team,
        human: false,
        difficulty: o.difficulty,
      });
    });
    if (this.teamMode === 'allied' && players.every((p) => p.team === 0)) players[players.length - 1].team = 1;
    return {
      map: m.clone(),
      config: { players, mania: this.mania, fog: this.fog, startCredits: this.credits, seed: randomSeed(), shuffleStarts: this.shuffle },
    };
  }
}

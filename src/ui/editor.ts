import { TILE } from '../game/constants';
import { BUILDINGS, BUILDING_LIST, UNITS, UNIT_LIST } from '../game/defs';
import { GameMap, ORE_PER_LEVEL, T, TERRAIN_NAMES, type MapData } from '../game/map';
import { DEFAULT_GEN, generateMap, type GenParams, type Symmetry } from '../game/mapgen';
import { deleteStoredMap, download, listStoredMaps, mapFromImageData, mapToImageData, mapToJson, parseMapJson, readFile, storeMap } from '../game/mapio';
import { hash2, randomSeed } from '../game/rng';
import { canvas } from '../render/color';
import { blossomSprite, buildingSprite, oreSprites, unitSprite } from '../render/sprites';
import { TERRAIN_RGB, TerrainRenderer, terrainOverview } from '../render/terrain';
import { el } from './dom';
import { TEAM_COLORS } from './menu';

type Tool = 'terrain' | 'ore' | 'fill' | 'blossom' | 'start' | 'entity' | 'erase';
type Sym = 'none' | 'mirrorX' | 'mirrorY' | 'quad' | 'rotate';

export interface EditorActions {
  back: () => void;
  play: (map: GameMap) => void;
}

/** Full in-game map editor. */
export class EditorScreen {
  readonly root: HTMLElement;
  private map: GameMap;
  private terrain: TerrainRenderer;
  private canvas: HTMLCanvasElement;
  private ctx: CanvasRenderingContext2D;
  private cam = { x: 0, y: 0, zoom: 0.75 };
  private tool: Tool = 'terrain';
  private brush = 2;
  private terrainType: T = T.Rock;
  private oreLevel = 7;
  private sym: Sym = 'none';
  private startIdx = 0;
  private entityType = 'raptor';
  private entityOwner = 0;
  private grid = false;
  private undo: string[] = [];
  private redo: string[] = [];
  private painting = false;
  private panning: { sx: number; sy: number; cx: number; cy: number } | null = null;
  private lastCell: { x: number; y: number } | null = null;
  private mouse = { x: 0, y: 0, inside: false };
  private dirty: { x0: number; y0: number; x1: number; y1: number } | null = null;
  private overview: HTMLCanvasElement;
  private overviewDirty = true;
  private raf = 0;
  private time = 0;
  private last = performance.now();
  private status: HTMLElement;
  private props!: { name: HTMLInputElement; author: HTMLInputElement; desc: HTMLTextAreaElement };
  private toolPanel: HTMLElement;
  private mini: HTMLCanvasElement;
  private abort = new AbortController();

  constructor(
    host: HTMLElement,
    private actions: EditorActions,
    initial?: GameMap,
  ) {
    this.map = initial ?? generateMap({ ...DEFAULT_GEN, seed: randomSeed() });
    this.root = el('div', { class: 'editor-screen' });
    this.canvas = el('canvas', { class: 'editor-canvas' }) as HTMLCanvasElement;
    this.ctx = this.canvas.getContext('2d')!;
    this.terrain = new TerrainRenderer(this.map);
    this.overview = terrainOverview(this.map);
    this.status = el('div', { class: 'editor-status' });
    this.toolPanel = el('div', { class: 'tool-options' });
    this.mini = el('canvas', { class: 'minimap', width: '200', height: '200' }) as HTMLCanvasElement;

    const left = this.buildLeft();
    const right = this.buildRight();
    const center = el('div', { class: 'editor-center' }, this.canvas, this.status);
    this.root.append(left, center, right);
    host.appendChild(this.root);
    this.setTool(this.tool);
    this.bind();
    this.resize();
    this.cam.x = (this.map.w * TILE) / 2 - this.canvas.clientWidth / this.cam.zoom / 2;
    this.cam.y = (this.map.h * TILE) / 2 - this.canvas.clientHeight / this.cam.zoom / 2;
    this.raf = requestAnimationFrame((t) => this.frame(t));
  }

  destroy(): void {
    cancelAnimationFrame(this.raf);
    this.abort.abort();
    this.root.remove();
  }

  // ---------------------------------------------------------------- layout

  private buildLeft(): HTMLElement {
    const tools: [Tool, string, string][] = [
      ['terrain', '🖌', 'Paint terrain'],
      ['fill', '🪣', 'Flood fill terrain'],
      ['ore', '💎', 'Paint Veridium (0 erases)'],
      ['blossom', '🌿', 'Veridium blossom (spreads crystals)'],
      ['start', '🚩', 'Start positions'],
      ['entity', '🛡', 'Pre-placed units & structures'],
      ['erase', '✖', 'Erase starts / blossoms / objects'],
    ];
    const toolRow = el('div', { class: 'tool-grid' });
    for (const [t, icon, title] of tools) {
      const b = el('button', { class: 'tool-btn', title }, icon);
      b.dataset.tool = t;
      b.onclick = () => this.setTool(t);
      toolRow.appendChild(b);
    }
    const symSel = el('select') as HTMLSelectElement;
    for (const [v, l] of [
      ['none', 'No symmetry'],
      ['mirrorX', 'Mirror left/right'],
      ['mirrorY', 'Mirror top/bottom'],
      ['quad', '4-way mirror'],
      ['rotate', 'Rotate 180°'],
    ])
      symSel.appendChild(el('option', { value: v }, l));
    symSel.onchange = () => (this.sym = symSel.value as Sym);
    const brush = el('input', { type: 'range', min: '0', max: '8', step: '1', value: String(this.brush) }) as HTMLInputElement;
    const brushLbl = el('span', {}, `Brush ${this.brush * 2 + 1}`);
    brush.oninput = () => {
      this.brush = Number(brush.value);
      brushLbl.textContent = `Brush ${this.brush * 2 + 1}`;
    };
    const gridCb = el('input', { type: 'checkbox' }) as HTMLInputElement;
    gridCb.onchange = () => (this.grid = gridCb.checked);
    const undo = el('button', { class: 'btn small' }, '↶ Undo');
    undo.onclick = () => this.doUndo();
    const redo = el('button', { class: 'btn small' }, '↷ Redo');
    redo.onclick = () => this.doRedo();
    const panel = el(
      'aside',
      { class: 'editor-left' },
      el('h3', {}, 'Tools'),
      toolRow,
      this.toolPanel,
      el('label', { class: 'slider' }, brushLbl, brush),
      el('label', {}, 'Symmetry ', symSel),
      el('label', { class: 'check' }, gridCb, el('span', {}, 'Show grid')),
      el('div', { class: 'row tight' }, undo, redo),
      el('div', { class: 'muted small' }, 'Left: paint · Right-drag: pan · Wheel: zoom · Ctrl+Z / Ctrl+Y'),
    );
    this.setTool('terrain');
    return panel;
  }

  private buildRight(): HTMLElement {
    const name = el('input', { type: 'text', value: this.map.name }) as HTMLInputElement;
    const author = el('input', { type: 'text', value: this.map.author }) as HTMLInputElement;
    const desc = el('textarea', { rows: '2' }) as HTMLTextAreaElement;
    desc.value = this.map.description;
    name.onchange = () => (this.map.name = name.value || 'Untitled');
    author.onchange = () => (this.map.author = author.value);
    desc.onchange = () => (this.map.description = desc.value);
    this.props = { name, author, desc };

    const btn = (label: string, fn: () => void, cls = 'btn small') => {
      const b = el('button', { class: cls }, label);
      b.onclick = fn;
      return b;
    };
    const fileIn = el('input', { type: 'file', accept: '.json,.ccmap,.png,.gif,.bmp,.webp', class: 'hidden' }) as HTMLInputElement;
    fileIn.onchange = async () => {
      const f = fileIn.files?.[0];
      fileIn.value = '';
      if (!f) return;
      try {
        const r = await readFile(f);
        this.load(r.image ? mapFromImageData(r.image, f.name.replace(/\.[^.]+$/, '')) : parseMapJson(r.text!));
        this.flash(`Imported ${f.name}`);
      } catch (e) {
        this.flash(`Import failed: ${(e as Error).message}`);
      }
    };
    const savedList = el('div', { class: 'saved-list' });
    const refreshSaved = () => {
      savedList.innerHTML = '';
      for (const s of listStoredMaps()) {
        const open = btn(
          s.name,
          () => {
            this.load(parseMapJson(s.json));
            this.flash(`Loaded ${s.name}`);
          },
          'link',
        );
        // Two-click delete: the first click arms the button.
        const del = btn('✕', () => {
          if (del.dataset.armed) {
            deleteStoredMap(s.name);
            refreshSaved();
          } else {
            del.dataset.armed = '1';
            del.textContent = 'Delete?';
            setTimeout(() => {
              delete del.dataset.armed;
              del.textContent = '✕';
            }, 3000);
          }
        });
        savedList.appendChild(el('div', { class: 'saved-row' }, open, del));
      }
      if (!savedList.children.length) savedList.appendChild(el('div', { class: 'muted small' }, 'Nothing saved yet'));
    };
    refreshSaved();

    const genPanel = this.buildGenerator();
    const newSize = el('select') as HTMLSelectElement;
    for (const s of [48, 64, 96, 128, 160, 200]) newSize.appendChild(el('option', { value: String(s) }, `${s}×${s}`));
    newSize.value = '96';
    const newFill = el('select') as HTMLSelectElement;
    TERRAIN_NAMES.forEach((n, i) => {
      if (i !== T.Rock && i !== T.Tree) newFill.appendChild(el('option', { value: String(i) }, n));
    });

    return el(
      'aside',
      { class: 'editor-right' },
      el('h3', {}, 'Map'),
      el('label', {}, 'Name', name),
      el('label', {}, 'Author', author),
      el('label', {}, 'Description', desc),
      this.mini,
      el(
        'div',
        { class: 'row wrap' },
        btn('▶ Play test', () => this.playTest(), 'btn small primary'),
        btn('💾 Save', () => {
          this.syncProps();
          this.flash(storeMap(this.map) ? `Saved "${this.map.name}" to this browser` : 'Saving failed (storage full?)');
          refreshSaved();
        }),
        btn('⬇ JSON', () => {
          this.syncProps();
          this.showExport('json');
        }),
        btn('⬇ PNG', () => this.showExport('png')),
        btn('⬆ Import', () => fileIn.click()),
        fileIn,
      ),
      el('h3', {}, 'New / generate'),
      el(
        'div',
        { class: 'row tight' },
        newSize,
        newFill,
        btn('New blank', () => this.newBlank(Number(newSize.value), Number(newFill.value) as T)),
      ),
      genPanel,
      el('h3', {}, 'Saved in browser'),
      savedList,
      btn('← Main menu', () => this.actions.back(), 'btn'),
    );
  }

  private buildGenerator(): HTMLElement {
    const g: GenParams = { ...DEFAULT_GEN, seed: randomSeed(), width: this.map.w, height: this.map.h };
    const seed = el('input', { type: 'number', value: String(g.seed) }) as HTMLInputElement;
    const sel = (vals: string[], labels: string[], cur: string, set: (v: string) => void) => {
      const s = el('select') as HTMLSelectElement;
      vals.forEach((v, i) => s.appendChild(el('option', { value: v }, labels[i])));
      s.value = cur;
      s.onchange = () => set(s.value);
      return s;
    };
    const sl = (label: string, key: 'water' | 'cliffs' | 'forest' | 'ore') => {
      const i = el('input', { type: 'range', min: '0', max: '1', step: '0.05', value: String(g[key]) }) as HTMLInputElement;
      i.oninput = () => (g[key] = Number(i.value));
      return el('label', { class: 'slider' }, el('span', {}, label), i);
    };
    const go = el('button', { class: 'btn small' }, '🎲 Generate');
    go.onclick = () => {
      g.seed = Number(seed.value) >>> 0;
      g.width = g.height = this.map.w;
      this.load(generateMap(g));
      seed.value = String(randomSeed());
    };
    return el(
      'div',
      { class: 'gen-panel' },
      el('div', { class: 'row tight' }, el('span', {}, 'Seed'), seed),
      el(
        'div',
        { class: 'row tight' },
        sel(['2', '3', '4'], ['2p', '3p', '4p'], String(g.players), (v) => (g.players = Number(v))),
        sel(['rotate', 'mirror', 'quad', 'none'], ['Rotate', 'Mirror', '4-way', 'None'], g.symmetry, (v) => (g.symmetry = v as Symmetry)),
      ),
      sl('Water', 'water'),
      sl('Cliffs', 'cliffs'),
      sl('Forest', 'forest'),
      sl('Veridium', 'ore'),
      go,
    );
  }

  private setTool(t: Tool): void {
    this.tool = t;
    this.root?.querySelectorAll<HTMLElement>('.tool-btn').forEach((b) => b.classList.toggle('on', b.dataset.tool === t));
    const p = this.toolPanel;
    p.innerHTML = '';
    if (t === 'terrain' || t === 'fill') {
      const sw = el('div', { class: 'terrain-swatches' });
      TERRAIN_NAMES.forEach((n, i) => {
        const [r, g, b] = TERRAIN_RGB[i];
        const s = el('button', { class: `tswatch ${i === this.terrainType ? 'on' : ''}`, style: `background:rgb(${r},${g},${b})`, title: n }, n);
        s.onclick = () => {
          this.terrainType = i as T;
          sw.querySelectorAll('.tswatch').forEach((x, j) => x.classList.toggle('on', j === i));
        };
        sw.appendChild(s);
      });
      p.appendChild(sw);
    } else if (t === 'ore') {
      const r = el('input', { type: 'range', min: '0', max: '9', step: '1', value: String(this.oreLevel) }) as HTMLInputElement;
      const l = el('span', {}, `Density ${this.oreLevel}`);
      r.oninput = () => {
        this.oreLevel = Number(r.value);
        l.textContent = `Density ${this.oreLevel}`;
      };
      p.appendChild(el('label', { class: 'slider' }, l, r));
    } else if (t === 'start') {
      const row = el('div', { class: 'row tight' });
      for (let i = 0; i < 4; i++) {
        const b = el('button', { class: `btn small ${i === this.startIdx ? 'on' : ''}`, style: `border-color:${TEAM_COLORS[i]}` }, `P${i + 1}`);
        b.onclick = () => {
          this.startIdx = i;
          row.querySelectorAll('button').forEach((x, j) => x.classList.toggle('on', j === i));
        };
        row.appendChild(b);
      }
      p.append(row, el('div', { class: 'muted small' }, 'Click to place. With symmetry on, mirrored starts are added automatically.'));
    } else if (t === 'entity') {
      const type = el('select') as HTMLSelectElement;
      const og1 = el('optgroup', { label: 'Units' });
      for (const u of UNIT_LIST) og1.appendChild(el('option', { value: u.id }, u.name));
      const og2 = el('optgroup', { label: 'Structures' });
      for (const b of BUILDING_LIST) og2.appendChild(el('option', { value: b.id }, b.name));
      type.append(og1, og2);
      type.value = this.entityType;
      type.onchange = () => (this.entityType = type.value);
      const owner = el('select') as HTMLSelectElement;
      for (let i = 0; i < 4; i++) owner.appendChild(el('option', { value: String(i) }, `Owned by start P${i + 1}`));
      owner.value = String(this.entityOwner);
      owner.onchange = () => (this.entityOwner = Number(owner.value));
      p.append(type, owner, el('div', { class: 'muted small' }, 'Objects belong to whoever spawns at that start position.'));
    } else if (t === 'blossom') {
      p.appendChild(el('div', { class: 'muted small' }, 'Blossoms seed Veridium around themselves forever.'));
    }
  }

  // ---------------------------------------------------------------- map ops

  private snapshot(): string {
    return JSON.stringify(this.map.toData());
  }

  private pushUndo(): void {
    this.undo.push(this.snapshot());
    if (this.undo.length > 60) this.undo.shift();
    this.redo = [];
  }

  private restore(s: string): void {
    const m = GameMap.fromData(JSON.parse(s) as MapData);
    this.map.terrain.set(m.terrain);
    this.map.ore.set(m.ore);
    this.map.oreField.set(m.oreField);
    this.map.starts = m.starts;
    this.map.blossoms = m.blossoms;
    this.map.entities = m.entities;
    this.terrain.invalidateAll();
    this.overviewDirty = true;
  }

  private doUndo(): void {
    const s = this.undo.pop();
    if (!s) return;
    this.redo.push(this.snapshot());
    this.restore(s);
  }

  private doRedo(): void {
    const s = this.redo.pop();
    if (!s) return;
    this.undo.push(this.snapshot());
    this.restore(s);
  }

  private load(m: GameMap): void {
    this.map = m;
    this.terrain = new TerrainRenderer(m);
    this.undo = [];
    this.redo = [];
    this.overviewDirty = true;
    this.props.name.value = m.name;
    this.props.author.value = m.author;
    this.props.desc.value = m.description;
    this.clampCam();
  }

  private newBlank(size: number, fill: T): void {
    const m = new GameMap(size, size);
    m.terrain.fill(fill);
    m.name = 'New map';
    m.author = this.props.author.value;
    this.load(m);
  }

  private syncProps(): void {
    this.map.name = this.props.name.value || 'Untitled';
    this.map.author = this.props.author.value;
    this.map.description = this.props.desc.value;
  }

  private images(x: number, y: number): { x: number; y: number }[] {
    const { w, h } = this.map;
    const out = [{ x, y }];
    const add = (ax: number, ay: number) => {
      if (!out.some((p) => p.x === ax && p.y === ay)) out.push({ x: ax, y: ay });
    };
    if (this.sym === 'mirrorX' || this.sym === 'quad') add(w - 1 - x, y);
    if (this.sym === 'mirrorY' || this.sym === 'quad') add(x, h - 1 - y);
    if (this.sym === 'quad') add(w - 1 - x, h - 1 - y);
    if (this.sym === 'rotate') add(w - 1 - x, h - 1 - y);
    return out;
  }

  private markDirty(x0: number, y0: number, x1: number, y1: number): void {
    const d = this.dirty;
    this.dirty = d ? { x0: Math.min(d.x0, x0), y0: Math.min(d.y0, y0), x1: Math.max(d.x1, x1), y1: Math.max(d.y1, y1) } : { x0, y0, x1, y1 };
    this.overviewDirty = true;
  }

  private paintAt(cx: number, cy: number): void {
    const m = this.map;
    const r = this.brush;
    for (const c of this.images(cx, cy)) {
      for (let dy = -r; dy <= r; dy++)
        for (let dx = -r; dx <= r; dx++) {
          if (dx * dx + dy * dy > r * r + r) continue;
          const x = c.x + dx;
          const y = c.y + dy;
          if (!m.inBounds(x, y)) continue;
          const i = m.idx(x, y);
          if (this.tool === 'terrain') {
            m.terrain[i] = this.terrainType;
            if (this.terrainType === T.Rock || this.terrainType === T.Water || this.terrainType === T.Tree) m.ore[i] = 0;
          } else if (this.tool === 'ore') {
            const t = m.terrain[i];
            if (t === T.Grass || t === T.Dirt || t === T.Sand) {
              // Soft brush edges.
              const edge = Math.hypot(dx, dy) / (r + 1);
              const lvl = Math.round(this.oreLevel * (1 - edge * 0.5));
              m.ore[i] = this.oreLevel === 0 ? 0 : Math.max(ORE_PER_LEVEL, lvl * ORE_PER_LEVEL);
              m.oreField[i] = m.ore[i] > 0 ? 1 : 0;
            }
          }
        }
      this.markDirty(c.x - r, c.y - r, c.x + r, c.y + r);
    }
  }

  private fillAt(cx: number, cy: number): void {
    const m = this.map;
    for (const c of this.images(cx, cy)) {
      if (!m.inBounds(c.x, c.y)) continue;
      const from = m.t(c.x, c.y);
      if (from === this.terrainType) continue;
      const stack = [m.idx(c.x, c.y)];
      while (stack.length) {
        const i = stack.pop()!;
        if (m.terrain[i] !== from) continue;
        m.terrain[i] = this.terrainType;
        const x = i % m.w;
        const y = (i - x) / m.w;
        if (x > 0) stack.push(i - 1);
        if (x < m.w - 1) stack.push(i + 1);
        if (y > 0) stack.push(i - m.w);
        if (y < m.h - 1) stack.push(i + m.w);
      }
    }
    this.terrain.invalidateAll();
    this.overviewDirty = true;
  }

  private clickObject(cx: number, cy: number): void {
    const m = this.map;
    const imgs = this.images(cx, cy);
    if (this.tool === 'blossom') {
      for (const c of imgs) if (!m.blossoms.some((b) => b.x === c.x && b.y === c.y)) m.blossoms.push(c);
    } else if (this.tool === 'start') {
      imgs.forEach((c, k) => {
        const idx = this.startIdx + k;
        if (idx > 3) return;
        while (m.starts.length < idx) m.starts.push({ x: c.x, y: c.y });
        m.starts[idx] = { x: c.x, y: c.y };
      });
    } else if (this.tool === 'entity') {
      const isB = !!BUILDINGS[this.entityType];
      imgs.forEach((c, k) => {
        const owner = Math.min(3, this.entityOwner + k);
        m.entities.push({
          kind: isB ? 'building' : 'unit',
          type: this.entityType,
          owner,
          x: isB ? c.x - Math.floor(BUILDINGS[this.entityType].w / 2) : c.x,
          y: isB ? c.y - Math.floor(BUILDINGS[this.entityType].h / 2) : c.y,
        });
      });
    } else if (this.tool === 'erase') {
      for (const c of imgs) {
        const near = (p: { x: number; y: number }) => Math.abs(p.x - c.x) <= 1 && Math.abs(p.y - c.y) <= 1;
        m.blossoms = m.blossoms.filter((b) => !near(b));
        m.starts = m.starts.filter((s) => !near(s));
        m.entities = m.entities.filter((e) => {
          const b = BUILDINGS[e.type];
          if (e.kind === 'building' && b) return !(c.x >= e.x && c.x < e.x + b.w && c.y >= e.y && c.y < e.y + b.h);
          return !near(e);
        });
      }
    }
    this.overviewDirty = true;
  }

  private playTest(): void {
    this.syncProps();
    if (this.map.starts.length < 2) {
      this.flash('Place at least 2 start positions (🚩 tool) before play-testing.');
      return;
    }
    this.actions.play(this.map.clone());
  }

  /**
   * Export panel. Downloads can be blocked (e.g. inside an embedded frame), so the
   * JSON is also shown as copyable text and the PNG as an image you can save directly.
   */
  private showExport(kind: 'json' | 'png'): void {
    const overlay = el('div', { class: 'overlay' });
    const panel = el('div', { class: 'panel export-panel' });
    const close = el('button', { class: 'btn small' }, 'Close');
    close.onclick = () => overlay.remove();
    const dl = el('button', { class: 'btn small' }, '⬇ Download file');
    // Embedded frames (e.g. a published artifact) block downloads, so only offer copy / save-image there.
    if (window.self !== window.top) dl.classList.add('hidden');
    const status = el('div', { class: 'muted small' });
    if (kind === 'json') {
      const json = mapToJson(this.map);
      const text = el('textarea', { rows: '12', readonly: '', class: 'export-text' }) as HTMLTextAreaElement;
      text.value = json;
      const copy = el('button', { class: 'btn small primary' }, '📋 Copy JSON');
      const selectFallback = () => {
        text.select();
        status.textContent = 'Copy is blocked here, so the text is selected: press Ctrl+C.';
      };
      copy.onclick = () => {
        if (!navigator.clipboard) return selectFallback();
        navigator.clipboard
          .writeText(json)
          .then(() => (status.textContent = 'Copied. Save it as a .json file, or drop it into /maps in the repo.'), selectFallback);
      };
      dl.onclick = () => download(`${slug(this.map.name)}.json`, new Blob([json], { type: 'application/json' }));
      panel.append(el('h3', {}, 'Export map JSON'), text, el('div', { class: 'row tight' }, copy, dl, close), status);
    } else {
      const [c, ctx] = canvas(this.map.w, this.map.h);
      ctx.putImageData(mapToImageData(this.map), 0, 0);
      const img = el('img', { class: 'export-img', alt: `${this.map.name} as a 1-pixel-per-tile PNG`, src: c.toDataURL('image/png') });
      dl.onclick = () => c.toBlob((b) => b && download(`${slug(this.map.name)}.png`, b), 'image/png');
      panel.append(
        el('h3', {}, 'Export map PNG'),
        img,
        el(
          'div',
          { class: 'muted small' },
          'One pixel per tile. Right-click or long-press the image to save it, then edit it in any paint program and import it back.',
        ),
        el('div', { class: 'row tight' }, dl, close),
      );
    }
    overlay.appendChild(panel);
    overlay.onclick = (ev) => ev.target === overlay && overlay.remove();
    this.root.appendChild(overlay);
  }

  private flash(text: string): void {
    this.status.textContent = text;
    this.status.classList.add('show');
    setTimeout(() => this.status.classList.remove('show'), 2500);
  }

  // ---------------------------------------------------------------- input

  private onResize = () => this.resize();

  private onKey = (ev: KeyboardEvent) => {
    const tag = (ev.target as HTMLElement)?.tagName;
    if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return;
    if ((ev.ctrlKey || ev.metaKey) && ev.key.toLowerCase() === 'z') {
      ev.preventDefault();
      if (ev.shiftKey) this.doRedo();
      else this.doUndo();
    } else if ((ev.ctrlKey || ev.metaKey) && ev.key.toLowerCase() === 'y') {
      ev.preventDefault();
      this.doRedo();
    } else if (ev.key === '[') this.brush = Math.max(0, this.brush - 1);
    else if (ev.key === ']') this.brush = Math.min(8, this.brush + 1);
    else if (ev.key === 'g') this.grid = !this.grid;
  };

  private resize(): void {
    const r = this.canvas.getBoundingClientRect();
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    this.canvas.width = Math.max(1, Math.round(r.width * dpr));
    this.canvas.height = Math.max(1, Math.round(r.height * dpr));
  }

  private toCell(ev: MouseEvent): { x: number; y: number } {
    const r = this.canvas.getBoundingClientRect();
    const wx = this.cam.x + (ev.clientX - r.left) / this.cam.zoom;
    const wy = this.cam.y + (ev.clientY - r.top) / this.cam.zoom;
    return { x: Math.floor(wx / TILE), y: Math.floor(wy / TILE) };
  }

  private clampCam(): void {
    const vw = this.canvas.clientWidth / this.cam.zoom;
    const vh = this.canvas.clientHeight / this.cam.zoom;
    const ww = this.map.w * TILE;
    const wh = this.map.h * TILE;
    this.cam.x = vw >= ww ? (ww - vw) / 2 : Math.max(-64, Math.min(ww - vw + 64, this.cam.x));
    this.cam.y = vh >= wh ? (wh - vh) / 2 : Math.max(-64, Math.min(wh - vh + 64, this.cam.y));
  }

  private bind(): void {
    const c = this.canvas;
    window.addEventListener('resize', this.onResize, { signal: this.abort.signal });
    window.addEventListener('keydown', this.onKey, { signal: this.abort.signal });
    c.addEventListener('contextmenu', (e) => e.preventDefault(), { signal: this.abort.signal });
    c.addEventListener('mouseenter', () => (this.mouse.inside = true), { signal: this.abort.signal });
    c.addEventListener('mouseleave', () => (this.mouse.inside = false), { signal: this.abort.signal });
    c.addEventListener(
      'wheel',
      (ev) => {
        ev.preventDefault();
        const r = c.getBoundingClientRect();
        const sx = ev.clientX - r.left;
        const sy = ev.clientY - r.top;
        const wx = this.cam.x + sx / this.cam.zoom;
        const wy = this.cam.y + sy / this.cam.zoom;
        this.cam.zoom = Math.max(0.2, Math.min(2.5, this.cam.zoom * (ev.deltaY < 0 ? 1.15 : 1 / 1.15)));
        this.cam.x = wx - sx / this.cam.zoom;
        this.cam.y = wy - sy / this.cam.zoom;
        this.clampCam();
      },
      { passive: false, signal: this.abort.signal },
    );
    c.addEventListener('mousedown', (ev) => {
      if (ev.button === 2 || ev.button === 1) {
        this.panning = { sx: ev.clientX, sy: ev.clientY, cx: this.cam.x, cy: this.cam.y };
        return;
      }
      if (ev.button !== 0) return;
      const cell = this.toCell(ev);
      this.pushUndo();
      if (this.tool === 'terrain' || this.tool === 'ore') {
        this.painting = true;
        this.lastCell = cell;
        this.paintAt(cell.x, cell.y);
      } else if (this.tool === 'fill') this.fillAt(cell.x, cell.y);
      else this.clickObject(cell.x, cell.y);
    });
    window.addEventListener(
      'mousemove',
      (ev) => {
        const r = c.getBoundingClientRect();
        this.mouse.x = ev.clientX - r.left;
        this.mouse.y = ev.clientY - r.top;
        if (this.panning) {
          this.cam.x = this.panning.cx - (ev.clientX - this.panning.sx) / this.cam.zoom;
          this.cam.y = this.panning.cy - (ev.clientY - this.panning.sy) / this.cam.zoom;
          this.clampCam();
        }
        if (this.painting && this.lastCell) {
          const cell = this.toCell(ev);
          const steps = Math.max(Math.abs(cell.x - this.lastCell.x), Math.abs(cell.y - this.lastCell.y));
          for (let i = 1; i <= steps; i++) {
            const t = i / steps;
            this.paintAt(Math.round(this.lastCell.x + (cell.x - this.lastCell.x) * t), Math.round(this.lastCell.y + (cell.y - this.lastCell.y) * t));
          }
          this.lastCell = cell;
        }
      },
      { signal: this.abort.signal },
    );
    window.addEventListener(
      'mouseup',
      () => {
        this.painting = false;
        this.panning = null;
        this.lastCell = null;
      },
      { signal: this.abort.signal },
    );
    this.mini.addEventListener('mousedown', (ev) => {
      const r = this.mini.getBoundingClientRect();
      const s = Math.min(this.mini.width / this.map.w, this.mini.height / this.map.h);
      const x = (((ev.clientX - r.left) / r.width) * this.mini.width) / s;
      const y = (((ev.clientY - r.top) / r.height) * this.mini.height) / s;
      this.cam.x = x * TILE - this.canvas.clientWidth / this.cam.zoom / 2;
      this.cam.y = y * TILE - this.canvas.clientHeight / this.cam.zoom / 2;
      this.clampCam();
    });
  }

  // ---------------------------------------------------------------- render

  private frame(now: number): void {
    const dt = Math.min(0.1, (now - this.last) / 1000);
    this.last = now;
    this.time += dt;
    if (this.dirty) {
      this.terrain.invalidateTiles(this.dirty.x0, this.dirty.y0, this.dirty.x1, this.dirty.y1);
      this.dirty = null;
    }
    if (this.overviewDirty && Math.floor(this.time * 4) !== Math.floor((this.time - dt) * 4)) {
      this.overview = terrainOverview(this.map);
      this.overviewDirty = false;
      this.drawMini();
    }
    this.render();
    this.raf = requestAnimationFrame((t) => this.frame(t));
  }

  private drawMini(): void {
    const c = this.mini;
    const ctx = c.getContext('2d')!;
    const m = this.map;
    ctx.fillStyle = '#000';
    ctx.fillRect(0, 0, c.width, c.height);
    const s = Math.min(c.width / m.w, c.height / m.h);
    ctx.imageSmoothingEnabled = false;
    ctx.drawImage(this.overview, 0, 0, m.w * s, m.h * s);
    ctx.fillStyle = '#3cff5a';
    for (let i = 0; i < m.ore.length; i++) if (m.ore[i]) ctx.fillRect((i % m.w) * s, Math.floor(i / m.w) * s, s, s);
    m.starts.forEach((p, i) => {
      ctx.fillStyle = TEAM_COLORS[i];
      ctx.fillRect(p.x * s - 3, p.y * s - 3, 7, 7);
    });
  }

  private render(): void {
    const ctx = this.ctx;
    const m = this.map;
    const dpr = this.canvas.width / Math.max(1, this.canvas.clientWidth);
    const z = this.cam.zoom;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.fillStyle = '#0b0d0f';
    ctx.fillRect(0, 0, this.canvas.width, this.canvas.height);
    ctx.setTransform(dpr * z, 0, 0, dpr * z, -this.cam.x * dpr * z, -this.cam.y * dpr * z);
    const x0 = this.cam.x - 32;
    const y0 = this.cam.y - 32;
    const x1 = this.cam.x + this.canvas.clientWidth / z + 32;
    const y1 = this.cam.y + this.canvas.clientHeight / z + 32;
    this.terrain.draw(ctx, x0, y0, x1, y1);
    // Ore
    const ore = oreSprites();
    const tx0 = Math.max(0, Math.floor(x0 / TILE));
    const ty0 = Math.max(0, Math.floor(y0 / TILE));
    const tx1 = Math.min(m.w - 1, Math.floor(x1 / TILE));
    const ty1 = Math.min(m.h - 1, Math.floor(y1 / TILE));
    for (let ty = ty0; ty <= ty1; ty++)
      for (let tx = tx0; tx <= tx1; tx++) {
        const o = m.ore[ty * m.w + tx];
        if (!o) continue;
        const lvl = Math.min(3, Math.floor(o / ORE_PER_LEVEL / 2.5));
        ctx.drawImage(ore[lvl][Math.floor(hash2(tx, ty, 9) * 4)], tx * TILE, ty * TILE);
      }
    const bs = blossomSprite();
    for (const b of m.blossoms) ctx.drawImage(bs, b.x * TILE + 16 - 32, b.y * TILE + 16 - 48);
    // Pre-placed objects
    for (const e of m.entities) {
      const color = TEAM_COLORS[e.owner] ?? '#888';
      if (e.kind === 'building' && BUILDINGS[e.type]) {
        const s = buildingSprite(e.type, color, e.owner % 2 ? 'ember' : 'vanguard');
        ctx.drawImage(s.img, e.x * TILE + s.ox, e.y * TILE + s.oy);
      } else if (UNITS[e.type]) {
        const s = unitSprite(e.type, color, e.owner % 2 ? 'ember' : 'vanguard');
        ctx.save();
        ctx.translate(e.x * TILE + 16, e.y * TILE + 16);
        ctx.rotate(Math.PI / 2);
        ctx.drawImage(s.body[s.body.length > 2 ? 2 : 0], -s.size / 2, -s.size / 2, s.size, s.size);
        if (s.turret) ctx.drawImage(s.turret, -s.size / 2, -s.size / 2, s.size, s.size);
        ctx.restore();
      }
    }
    // Start positions (with the 3x3 Construction Yard footprint)
    m.starts.forEach((p, i) => {
      ctx.fillStyle = TEAM_COLORS[i] + '55';
      ctx.fillRect((p.x - 1) * TILE, (p.y - 1) * TILE, TILE * 3, TILE * 3);
      ctx.strokeStyle = TEAM_COLORS[i];
      ctx.lineWidth = 2;
      ctx.strokeRect((p.x - 1) * TILE, (p.y - 1) * TILE, TILE * 3, TILE * 3);
      ctx.fillStyle = '#fff';
      ctx.font = 'bold 22px sans-serif';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText(`P${i + 1}`, p.x * TILE + 16, p.y * TILE + 16);
    });
    // Grid
    if (this.grid) {
      ctx.strokeStyle = 'rgba(255,255,255,0.12)';
      ctx.lineWidth = 1 / z;
      ctx.beginPath();
      for (let x = tx0; x <= tx1 + 1; x++) {
        ctx.moveTo(x * TILE, ty0 * TILE);
        ctx.lineTo(x * TILE, (ty1 + 1) * TILE);
      }
      for (let y = ty0; y <= ty1 + 1; y++) {
        ctx.moveTo(tx0 * TILE, y * TILE);
        ctx.lineTo((tx1 + 1) * TILE, y * TILE);
      }
      ctx.stroke();
    }
    // Map border + symmetry axes
    ctx.strokeStyle = '#ffd400';
    ctx.lineWidth = 2 / z;
    ctx.strokeRect(0, 0, m.w * TILE, m.h * TILE);
    ctx.setLineDash([10 / z, 8 / z]);
    ctx.strokeStyle = 'rgba(255,80,200,0.7)';
    ctx.beginPath();
    if (this.sym === 'mirrorX' || this.sym === 'quad') {
      ctx.moveTo((m.w * TILE) / 2, 0);
      ctx.lineTo((m.w * TILE) / 2, m.h * TILE);
    }
    if (this.sym === 'mirrorY' || this.sym === 'quad') {
      ctx.moveTo(0, (m.h * TILE) / 2);
      ctx.lineTo(m.w * TILE, (m.h * TILE) / 2);
    }
    if (this.sym === 'rotate') ctx.arc((m.w * TILE) / 2, (m.h * TILE) / 2, 10 / z, 0, Math.PI * 2);
    ctx.stroke();
    ctx.setLineDash([]);
    // Brush cursor (and its mirrored copies)
    if (this.mouse.inside) {
      const wx = this.cam.x + this.mouse.x / z;
      const wy = this.cam.y + this.mouse.y / z;
      const cx = Math.floor(wx / TILE);
      const cy = Math.floor(wy / TILE);
      ctx.strokeStyle = '#fff';
      ctx.lineWidth = 1.5 / z;
      const brush = this.tool === 'terrain' || this.tool === 'ore' ? this.brush : 0;
      for (const p of this.images(cx, cy)) {
        ctx.beginPath();
        if (brush > 0) ctx.arc(p.x * TILE + 16, p.y * TILE + 16, (brush + 0.5) * TILE, 0, Math.PI * 2);
        else ctx.rect(p.x * TILE, p.y * TILE, TILE, TILE);
        ctx.stroke();
      }
      ctx.setTransform(1, 0, 0, 1, 0, 0);
      ctx.fillStyle = 'rgba(0,0,0,0.6)';
      ctx.fillRect(8 * dpr, 8 * dpr, 230 * dpr, 22 * dpr);
      ctx.fillStyle = '#7dff7d';
      ctx.font = `${12 * dpr}px monospace`;
      ctx.textAlign = 'left';
      ctx.textBaseline = 'middle';
      const t = m.inBounds(cx, cy) ? TERRAIN_NAMES[m.t(cx, cy)] : '—';
      ctx.fillText(`${cx},${cy}  ${t}  ${m.w}×${m.h}`, 14 * dpr, 19 * dpr);
    }
  }
}

function slug(s: string): string {
  return (
    s
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-|-$/g, '') || 'map'
  );
}

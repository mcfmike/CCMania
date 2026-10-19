import type { AudioEngine } from '../audio/audio';
import { TICK_RATE, TILE } from '../game/constants';
import { BUILDINGS, BUILDING_LIST, UNITS, UNIT_LIST, categoryOf, type ProdCategory } from '../game/defs';
import type { Entity, GameEvent } from '../game/entity';
import type { World } from '../game/world';
import { Renderer, type ViewState } from '../render/renderer';
import { iconFor } from '../render/sprites';
import { terrainOverview } from '../render/terrain';
import { el, fmt } from './dom';

export interface GameScreenOptions {
  onExit: () => void;
  onRestart: () => void;
}

type Mode = 'normal' | 'place' | 'wall' | 'sell' | 'repair' | 'super' | 'attackMove';

const SPEEDS = [0.5, 1, 1.5, 2, 3];

export class GameScreen {
  readonly root: HTMLElement;
  readonly renderer: Renderer;
  private canvas: HTMLCanvasElement;
  private view: ViewState = { selected: new Set(), hoverId: 0, placement: null, dragBox: null, cursor: 'none', mouse: { x: 0, y: 0 } };
  private mode: Mode = 'normal';
  private placingId = '';
  private groups = new Map<number, number[]>();
  private lastGroupKey = { key: -1, time: 0 };
  private speedIdx = 1;
  private paused = false;
  private running = true;
  private raf = 0;
  private lastFrame = 0;
  private acc = 0;
  private tab: ProdCategory = 'structure';
  private keys = new Set<string>();
  private mouseScreen = { x: -1, y: -1, inside: false };
  private drag: { button: number; sx: number; sy: number; wx: number; wy: number; moved: boolean; camX: number; camY: number } | null = null;
  private wallStart: { x: number; y: number } | null = null;
  private lastClick = { time: 0, id: 0 };
  private uiTimer = 0;
  private miniTimer = 0;
  private shownCredits = 0;
  private endShown = false;
  private lastAlert: { x: number; y: number } | null = null;
  private miniBase: HTMLCanvasElement;
  private intensityAcc = 0;
  private abort = new AbortController();
  private ui!: {
    credits: HTMLElement;
    powerFill: HTMLElement;
    powerUse: HTMLElement;
    powerText: HTMLElement;
    minimap: HTMLCanvasElement;
    grid: HTMLElement;
    tabs: Record<ProdCategory, HTMLElement>;
    superBtn: HTMLElement;
    info: HTMLElement;
    messages: HTMLElement;
    tooltip: HTMLElement;
    pause: HTMLElement;
    end: HTMLElement;
    speed: HTMLElement;
    sell: HTMLElement;
    repair: HTMLElement;
    banner: HTMLElement;
  };
  private buttons = new Map<string, { btn: HTMLElement; clock: HTMLElement; badge: HTMLElement; label: HTMLElement }>();

  constructor(
    host: HTMLElement,
    readonly world: World,
    private audio: AudioEngine,
    private opts: GameScreenOptions,
  ) {
    this.root = el('div', { class: 'game-screen' });
    host.appendChild(this.root);
    const viewEl = el('div', { class: 'game-view' });
    this.canvas = el('canvas', { class: 'game-canvas' }) as HTMLCanvasElement;
    viewEl.appendChild(this.canvas);
    this.root.appendChild(viewEl);
    this.buildSidebar();
    this.ui.messages = el('div', { class: 'messages' });
    viewEl.appendChild(this.ui.messages);
    this.ui.banner = el('div', { class: `banner ${world.onslaught ? '' : 'hidden'}` });
    viewEl.appendChild(this.ui.banner);
    this.ui.tooltip = el('div', { class: 'tooltip hidden' });
    this.root.appendChild(this.ui.tooltip);
    this.ui.pause = this.buildPause();
    this.ui.end = el('div', { class: 'overlay hidden' });
    this.root.appendChild(this.ui.pause);
    this.root.appendChild(this.ui.end);

    this.renderer = new Renderer(this.canvas, world);
    this.miniBase = terrainOverview(world.map);
    const me = world.players[world.humanIndex];
    const base = world.buildings.find((b) => b.owner === me.index);
    if (base) this.renderer.centerOn(base.x, base.y);
    this.shownCredits = me.credits;
    this.bindInput();
    this.message(`Welcome back, Commander. ${world.map.name}`);
    audio.say('Welcome back, Commander');
    this.lastFrame = performance.now();
    this.raf = requestAnimationFrame((t) => this.frame(t));
  }

  destroy(): void {
    this.running = false;
    cancelAnimationFrame(this.raf);
    this.abort.abort();
    this.root.remove();
  }

  private get me() {
    return this.world.players[this.world.humanIndex];
  }

  // ---------------------------------------------------------------- loop

  private frame(now: number): void {
    if (!this.running) return;
    const realDt = Math.min(0.1, (now - this.lastFrame) / 1000);
    this.lastFrame = now;
    if (!this.paused) {
      this.acc += realDt * SPEEDS[this.speedIdx];
      let steps = 0;
      while (this.acc >= 1 / TICK_RATE && steps < 8) {
        this.world.step();
        this.acc -= 1 / TICK_RATE;
        steps++;
      }
      if (steps === 8) this.acc = 0;
    }
    this.handleEvents(this.world.events);
    this.world.events.length = 0;
    this.edgeScroll(realDt);
    this.updateHover();
    this.renderer.render(this.view, this.paused ? 0 : realDt * SPEEDS[this.speedIdx]);
    this.uiTimer -= realDt;
    if (this.uiTimer <= 0) {
      this.uiTimer = 0.1;
      this.updateSidebar();
    }
    this.miniTimer -= realDt;
    if (this.miniTimer <= 0) {
      this.miniTimer = 0.15;
      this.drawMinimap();
    }
    this.animateCredits(realDt);
    this.audio.intensity += (Math.min(1, this.intensityAcc / 12) - this.audio.intensity) * Math.min(1, realDt * 0.8);
    this.intensityAcc *= Math.pow(0.3, realDt);
    if (this.world.result !== 'playing' && !this.endShown) {
      this.endShown = true;
      setTimeout(() => this.showEnd(), 2500);
    }
    this.raf = requestAnimationFrame((t) => this.frame(t));
  }

  private handleEvents(events: GameEvent[]): void {
    const r = this.renderer;
    const cx = r.cam.x + r.vw / r.cam.zoom / 2;
    const cy = r.cam.y + r.vh / r.cam.zoom / 2;
    const reach = Math.hypot(r.vw, r.vh) / r.cam.zoom;
    for (const e of events) {
      if (e.t === 'sfx') {
        const d = Math.hypot(e.x - cx, e.y - cy);
        if (d > reach * 1.2) continue;
        const big = e.name === 'nukeBlast' || e.name === 'ionBlast' || e.name === 'nukeLaunch' || e.name === 'ionCharge';
        this.audio.play(e.name, big ? 1 : Math.max(0.1, 1 - d / reach));
        if (e.name !== 'place' && e.name !== 'sell') this.intensityAcc += 0.25;
      } else if (e.t === 'eva') {
        this.audio.say(e.text);
        this.message(e.text, 'eva');
        if (e.key === 'baseattack' || e.key === 'harvattack') {
          const hit = [...this.world.entities].filter((x) => x.owner === this.world.humanIndex).sort((a, b) => b.lastDamaged - a.lastDamaged)[0];
          if (hit) this.lastAlert = { x: hit.x, y: hit.y };
        }
      } else if (e.t === 'message') this.message(e.text);
    }
    r.consume(events);
  }

  private message(text: string, kind = ''): void {
    const m = el('div', { class: `msg ${kind}` }, text);
    this.ui.messages.appendChild(m);
    while (this.ui.messages.children.length > 6) this.ui.messages.firstChild!.remove();
    setTimeout(() => m.classList.add('fade'), 5000);
    setTimeout(() => m.remove(), 6000);
  }

  // ---------------------------------------------------------------- sidebar

  private buildSidebar(): void {
    const side = el('aside', { class: 'sidebar' });
    const credits = el('div', { class: 'credits' }, '0');
    const powerText = el('div', { class: 'power-text' });
    const powerFill = el('div', { class: 'power-fill' });
    const powerUse = el('div', { class: 'power-use' });
    const power = el('div', { class: 'power-bar' }, powerFill, powerUse);
    const minimap = el('canvas', { class: 'minimap', width: '200', height: '200' }) as HTMLCanvasElement;
    const sell = el('button', { class: 'tool', title: 'Sell structure (Q)' }, '$ Sell');
    const repair = el('button', { class: 'tool', title: 'Repair structure (R)' }, '🔧 Repair');
    const speed = el('button', { class: 'tool', title: 'Game speed (+/-)' }, '1x');
    const menu = el('button', { class: 'tool', title: 'Menu (Esc)' }, '☰');
    sell.onclick = () => this.setMode(this.mode === 'sell' ? 'normal' : 'sell');
    repair.onclick = () => this.setMode(this.mode === 'repair' ? 'normal' : 'repair');
    speed.onclick = () => this.changeSpeed(1, true);
    menu.onclick = () => this.togglePause();
    const tools = el('div', { class: 'tools' }, sell, repair, speed, menu);
    const superBtn = el('button', { class: 'super hidden' }, '');
    superBtn.onclick = () => {
      if (this.me.superReady) this.setMode('super');
      else this.audio.play('deny');
    };
    const tabs = {} as Record<ProdCategory, HTMLElement>;
    const tabRow = el('div', { class: 'tabs' });
    for (const [cat, label] of [
      ['structure', 'Build'],
      ['infantry', 'Infantry'],
      ['vehicle', 'Vehicles'],
      ['aircraft', 'Air'],
    ] as [ProdCategory, string][]) {
      const t = el('button', { class: 'tab' }, label);
      t.onclick = () => {
        this.tab = cat;
        this.audio.play('click');
        this.refreshGrid();
      };
      tabs[cat] = t;
      tabRow.appendChild(t);
    }
    const grid = el('div', { class: 'build-grid' });
    const info = el('div', { class: 'sel-info' });
    side.append(credits, powerText, power, minimap, tools, superBtn, tabRow, grid, info);
    this.root.appendChild(side);
    this.ui = { credits, powerFill, powerUse, powerText, minimap, grid, tabs, superBtn, info, speed, sell, repair } as unknown as typeof this.ui;
    this.bindMinimap(minimap);
    this.refreshGrid();
  }

  private refreshGrid(): void {
    const grid = this.ui.grid;
    grid.innerHTML = '';
    this.buttons.clear();
    for (const [cat, t] of Object.entries(this.ui.tabs)) t.classList.toggle('active', cat === this.tab);
    const me = this.me;
    const items =
      this.tab === 'structure'
        ? BUILDING_LIST.filter((b) => b.buildable !== false && (!b.faction || b.faction === me.faction)).map((b) => b.id)
        : UNIT_LIST.filter((u) => categoryOf(u.id) === this.tab && (!u.faction || u.faction === me.faction)).map((u) => u.id);
    for (const id of items) {
      const def = UNITS[id] ?? BUILDINGS[id];
      const btn = el('div', { class: 'build-btn' });
      const icon = iconFor(id, me.color, me.faction);
      const img = el('canvas', { width: '64', height: '48' }) as HTMLCanvasElement;
      img.getContext('2d')!.drawImage(icon, 0, 0);
      const clock = el('div', { class: 'clock' });
      const badge = el('div', { class: 'badge' });
      const label = el('div', { class: 'label' });
      const name = el('div', { class: 'name' }, def.name);
      btn.append(img, clock, name, label, badge);
      btn.onmousedown = (ev) => {
        ev.preventDefault();
        if (ev.button === 0) this.clickBuild(id, ev.shiftKey ? 5 : 1);
        else if (ev.button === 2) this.cancelBuild(id);
      };
      btn.oncontextmenu = (ev) => ev.preventDefault();
      btn.onmouseenter = () => this.showTooltip(btn, id);
      btn.onmouseleave = () => this.ui.tooltip.classList.add('hidden');
      grid.appendChild(btn);
      this.buttons.set(id, { btn, clock, badge, label });
    }
  }

  private showTooltip(btn: HTMLElement, id: string): void {
    const def = UNITS[id] ?? BUILDINGS[id];
    const me = this.me;
    const missing = def.prereq.filter((r) => !me.owned[r]).map((r) => BUILDINGS[r]?.name ?? r);
    const b = BUILDINGS[id];
    const power = b ? (b.power > 0 ? `+${b.power} power` : b.power < 0 ? `${b.power} power` : '') : '';
    this.ui.tooltip.innerHTML = '';
    this.ui.tooltip.append(
      el('div', { class: 'tt-name' }, def.name),
      el('div', { class: 'tt-cost' }, `$${def.cost}  ·  ${def.buildTime}s ${power ? ' · ' + power : ''}`),
      el('div', { class: 'tt-desc' }, def.desc),
      missing.length ? el('div', { class: 'tt-req' }, `Requires: ${missing.join(', ')}`) : el('div'),
      el('div', { class: 'tt-hint' }, 'Left-click: build · Shift: x5 · Right-click: cancel'),
    );
    const r = btn.getBoundingClientRect();
    this.ui.tooltip.style.top = `${Math.max(8, r.top)}px`;
    this.ui.tooltip.style.right = `${window.innerWidth - r.left + 8}px`;
    this.ui.tooltip.classList.remove('hidden');
  }

  private clickBuild(id: string, times: number): void {
    const w = this.world;
    const me = this.me;
    this.audio.init();
    if (BUILDINGS[id]?.wall) {
      if (w.canBuild(me, 'wall')) this.setMode('wall');
      else this.audio.play('deny');
      return;
    }
    const q = me.queues[categoryOf(id)];
    if (categoryOf(id) === 'structure' && q.ready && q.items[0] === id) {
      this.placingId = id;
      this.setMode('place');
      return;
    }
    if (q.onHold && q.items[0] === id) {
      q.onHold = false;
      this.audio.play('click');
      return;
    }
    let ok = false;
    for (let i = 0; i < times; i++) ok = w.queueBuild(me, id) || ok;
    this.audio.play(ok ? 'click' : 'deny');
    if (!ok && !w.canBuild(me, id)) this.message('Cannot build that yet');
  }

  private cancelBuild(id: string): void {
    const q = this.me.queues[categoryOf(id)];
    if (q.items[0] === id && !q.onHold && !q.ready && q.progress > 0 && categoryOf(id) !== 'structure') {
      q.onHold = true;
      this.world.eva(this.me.index, 'hold', 'On hold', 1);
    } else this.world.cancelBuild(this.me, id);
    if (this.mode === 'place' && this.placingId === id) this.setMode('normal');
    this.audio.play('click');
  }

  private updateSidebar(): void {
    const w = this.world;
    const me = this.me;
    // Power
    const out = me.powerOut;
    const use = me.powerIn;
    const maxP = Math.max(out, use, 100);
    this.ui.powerFill.style.width = `${(out / maxP) * 100}%`;
    this.ui.powerUse.style.left = `${(use / maxP) * 100}%`;
    this.ui.powerFill.classList.toggle('low', me.lowPower);
    this.ui.powerText.textContent = `⚡ Power ${out}  ·  Drain ${use}`;
    this.ui.powerText.classList.toggle('low', me.lowPower);
    // Buttons
    for (const [id, b] of this.buttons) {
      const cat = categoryOf(id);
      const q = me.queues[cat];
      const can = w.canBuild(me, id);
      const queued = q.items.filter((i) => i === id).length;
      const active = q.items[0] === id;
      b.btn.classList.toggle('disabled', !can && !queued);
      b.btn.classList.toggle('busy', !active && cat === 'structure' && q.items.length > 0);
      const prog = active ? q.progress : 0;
      b.clock.style.background = active && prog < 1 ? `conic-gradient(transparent ${prog * 360}deg, rgba(0,0,0,0.65) ${prog * 360}deg)` : 'transparent';
      b.badge.textContent = queued > 1 ? String(queued) : '';
      b.label.textContent = active && q.ready ? 'READY' : active && q.onHold ? 'ON HOLD' : active && q.stalled ? '$$$' : '';
      b.btn.classList.toggle('ready', active && q.ready);
    }
    // Superweapon
    if (me.superType) {
      const pct = Math.min(1, me.superCharge / w.superChargeTicks());
      const name = me.superType === 'ion' ? 'ION CANNON' : 'NUKE';
      this.ui.superBtn.classList.remove('hidden');
      this.ui.superBtn.classList.toggle('ready', me.superReady);
      const secs = Math.ceil((w.superChargeTicks() - me.superCharge) / TICK_RATE);
      this.ui.superBtn.textContent = me.superReady ? `☢ ${name} READY` : `${name} ${Math.floor(secs / 60)}:${String(secs % 60).padStart(2, '0')}`;
      this.ui.superBtn.style.backgroundSize = `${pct * 100}% 100%`;
    } else this.ui.superBtn.classList.add('hidden');
    const os = w.onslaught;
    if (os) {
      const s = os.secondsToNext;
      const boss = (os.wave + 1) % 5 === 0;
      this.ui.banner.textContent = `WAVE ${os.wave}  ·  ${boss ? '☠ BOSS WAVE' : 'next wave'} in ${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
      this.ui.banner.classList.toggle('urgent', s <= 10);
    }
    this.ui.speed.textContent = `${SPEEDS[this.speedIdx]}x`;
    this.ui.sell.classList.toggle('on', this.mode === 'sell');
    this.ui.repair.classList.toggle('on', this.mode === 'repair');
    this.updateInfo();
  }

  private animateCredits(dt: number): void {
    const target = Math.floor(this.me.credits);
    const diff = target - this.shownCredits;
    if (Math.abs(diff) < 1) this.shownCredits = target;
    else this.shownCredits += Math.sign(diff) * Math.max(1, Math.min(Math.abs(diff), Math.abs(diff) * dt * 6 + 20 * dt * 60));
    this.ui.credits.textContent = `$ ${fmt(Math.round(this.shownCredits))}`;
  }

  private updateInfo(): void {
    const sel = [...this.view.selected].map((id) => this.world.get(id)).filter((e): e is Entity => !!e);
    const info = this.ui.info;
    if (!sel.length) {
      info.innerHTML = '';
      const me = this.me;
      info.append(el('div', { class: 'muted' }, `Units ${me.unitCount} · Kills ${me.stats.kills} · Lost ${me.stats.unitsLost}`));
      return;
    }
    info.innerHTML = '';
    if (sel.length === 1) {
      const e = sel[0];
      const owner = this.world.players[e.owner];
      const rank = e.rank === 2 ? ' ★★ Elite' : e.rank === 1 ? ' ★ Veteran' : '';
      info.append(
        el('div', { class: 'sel-name' }, `${e.def.name}${rank}`),
        el('div', { class: 'muted' }, `${owner.name} · HP ${Math.ceil(e.hp)}/${e.maxHp}${e.isUnit ? ` · Kills ${e.kills}` : ''}`),
      );
      if (e.isUnit && e.u.harvester) info.append(el('div', { class: 'muted' }, `Cargo ${e.cargo}/700 · ${e.harvestState}`));
      if (e.isUnit && e.u.deploys && e.owner === this.world.humanIndex) {
        const b = el('button', { class: 'btn small primary' }, 'Deploy (D)');
        // The info panel re-renders every 100ms, so act on press rather than click.
        b.onmousedown = (ev) => {
          ev.preventDefault();
          this.deploySelected();
        };
        info.append(b);
      }
      return;
    }
    const counts = new Map<string, number>();
    for (const e of sel) counts.set(e.type, (counts.get(e.type) ?? 0) + 1);
    info.append(el('div', { class: 'sel-name' }, `${sel.length} selected`));
    info.append(el('div', { class: 'muted' }, [...counts.entries()].map(([t, n]) => `${n}× ${(UNITS[t] ?? BUILDINGS[t]).name}`).join(', ')));
  }

  // ---------------------------------------------------------------- minimap

  private drawMinimap(): void {
    const c = this.ui.minimap;
    const ctx = c.getContext('2d')!;
    const w = this.world;
    const me = this.me;
    const m = w.map;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.fillStyle = '#000';
    ctx.fillRect(0, 0, c.width, c.height);
    const online = (me.owned.radar ?? 0) > 0 && !me.lowPower;
    if (!online) {
      const img = ctx.createImageData(c.width, c.height);
      for (let i = 0; i < img.data.length; i += 4) {
        const v = Math.random() * 60;
        img.data[i] = v;
        img.data[i + 1] = v * 1.2;
        img.data[i + 2] = v;
        img.data[i + 3] = 255;
      }
      ctx.putImageData(img, 0, 0);
      ctx.fillStyle = '#7dff7d';
      ctx.font = 'bold 13px monospace';
      ctx.textAlign = 'center';
      ctx.fillText((me.owned.radar ?? 0) > 0 ? 'RADAR: LOW POWER' : 'NO RADAR', c.width / 2, c.height / 2 - 6);
      ctx.font = '10px monospace';
      ctx.fillText('Build a Comm Center', c.width / 2, c.height / 2 + 10);
      return;
    }
    const s = Math.min(c.width / m.w, c.height / m.h);
    const ox = (c.width - m.w * s) / 2;
    const oy = (c.height - m.h * s) / 2;
    ctx.imageSmoothingEnabled = false;
    ctx.drawImage(this.miniBase, ox, oy, m.w * s, m.h * s);
    ctx.fillStyle = '#3cff5a';
    for (let i = 0; i < m.ore.length; i++) {
      if (!m.ore[i]) continue;
      const x = i % m.w;
      const y = (i - x) / m.w;
      ctx.fillRect(ox + x * s, oy + y * s, s, s);
    }
    for (const e of w.entities) {
      if (e.dead || !w.visibleToHuman(e)) continue;
      ctx.fillStyle = w.players[e.owner].color;
      if (e.isBuilding) ctx.fillRect(ox + e.tx * s, oy + e.ty * s, e.b.w * s, e.b.h * s);
      else ctx.fillRect(ox + (e.x / TILE) * s - 1, oy + (e.y / TILE) * s - 1, 2.5, 2.5);
    }
    // Shroud
    ctx.fillStyle = '#000';
    for (let i = 0; i < m.w * m.h; i++) {
      if (me.explored[i]) continue;
      const x = i % m.w;
      const y = (i - x) / m.w;
      ctx.fillRect(ox + x * s, oy + y * s, s + 0.5, s + 0.5);
    }
    const r = this.renderer;
    ctx.strokeStyle = '#fff';
    ctx.lineWidth = 1;
    ctx.strokeRect(ox + (r.cam.x / TILE) * s, oy + (r.cam.y / TILE) * s, (r.vw / r.cam.zoom / TILE) * s, (r.vh / r.cam.zoom / TILE) * s);
  }

  private minimapToWorld(ev: MouseEvent): { x: number; y: number } {
    const c = this.ui.minimap;
    const rect = c.getBoundingClientRect();
    const m = this.world.map;
    const s = Math.min(c.width / m.w, c.height / m.h);
    const ox = (c.width - m.w * s) / 2;
    const oy = (c.height - m.h * s) / 2;
    const px = ((ev.clientX - rect.left) / rect.width) * c.width;
    const py = ((ev.clientY - rect.top) / rect.height) * c.height;
    return { x: ((px - ox) / s) * TILE, y: ((py - oy) / s) * TILE };
  }

  private bindMinimap(c: HTMLCanvasElement): void {
    let down = false;
    c.addEventListener('mousedown', (ev) => {
      ev.preventDefault();
      const p = this.minimapToWorld(ev);
      if (ev.button === 2) {
        this.commandAt(p.x, p.y, false);
        return;
      }
      down = true;
      this.renderer.centerOn(p.x, p.y);
    });
    c.addEventListener('mousemove', (ev) => {
      if (!down) return;
      const p = this.minimapToWorld(ev);
      this.renderer.centerOn(p.x, p.y);
    });
    window.addEventListener('mouseup', () => (down = false), { signal: this.abort.signal });
    c.addEventListener('contextmenu', (ev) => ev.preventDefault(), { signal: this.abort.signal });
  }

  // ---------------------------------------------------------------- pause / end

  private buildPause(): HTMLElement {
    const o = el('div', { class: 'overlay hidden' });
    const panel = el('div', { class: 'panel' });
    const resume = el('button', { class: 'btn primary' }, 'Resume');
    resume.onclick = () => this.togglePause();
    const restart = el('button', { class: 'btn' }, 'Restart');
    restart.onclick = () => this.opts.onRestart();
    const quit = el('button', { class: 'btn' }, 'Quit to menu');
    quit.onclick = () => this.opts.onExit();
    const sliders = el('div', { class: 'settings' });
    const s = this.audio.settings;
    const slider = (label: string, get: () => number, set: (v: number) => void) => {
      const input = el('input', { type: 'range', min: '0', max: '1', step: '0.05' }) as HTMLInputElement;
      input.value = String(get());
      input.oninput = () => {
        set(Number(input.value));
        this.audio.applySettings();
      };
      sliders.append(el('label', {}, label, input));
    };
    slider(
      'Effects',
      () => s.sfx,
      (v) => (s.sfx = v),
    );
    slider(
      'Music',
      () => s.music,
      (v) => (s.music = v),
    );
    const voice = el('input', { type: 'checkbox' }) as HTMLInputElement;
    voice.checked = s.voice;
    voice.onchange = () => (s.voice = voice.checked);
    sliders.append(el('label', {}, 'EVA voice', voice));
    panel.append(el('h2', {}, 'Paused'), sliders, resume, restart, quit, controlsHelp());
    o.appendChild(panel);
    return o;
  }

  private togglePause(): void {
    this.paused = !this.paused;
    this.ui.pause.classList.toggle('hidden', !this.paused);
  }

  private showEnd(): void {
    const w = this.world;
    const win = w.result === 'victory';
    const o = this.ui.end;
    o.innerHTML = '';
    const panel = el('div', { class: `panel end ${win ? 'win' : 'lose'}` });
    const rows = w.players.map((p) =>
      el(
        'tr',
        {},
        el('td', { style: `color:${p.color}` }, p.name + (p.human ? ' (you)' : '')),
        el('td', {}, String(p.stats.unitsBuilt)),
        el('td', {}, String(p.stats.kills)),
        el('td', {}, String(p.stats.unitsLost)),
        el('td', {}, String(p.stats.structuresLost)),
        el('td', {}, fmt(Math.round(p.stats.harvested))),
      ),
    );
    const table = el(
      'table',
      { class: 'stats' },
      el('tr', {}, ...['Commander', 'Built', 'Kills', 'Lost', 'Structures lost', 'Harvested'].map((h) => el('th', {}, h))),
      ...rows,
    );
    const mins = Math.floor(w.tick / TICK_RATE / 60);
    const secs = Math.floor(w.tick / TICK_RATE) % 60;
    const watch = el('button', { class: 'btn' }, 'Keep watching');
    watch.onclick = () => o.classList.add('hidden');
    const again = el('button', { class: 'btn primary' }, 'Play again');
    again.onclick = () => this.opts.onRestart();
    const menu = el('button', { class: 'btn' }, 'Main menu');
    menu.onclick = () => this.opts.onExit();
    const survived = w.onslaught ? el('div', { class: 'survived' }, `You survived ${Math.max(0, w.onslaught.wave - 1)} waves`) : el('div');
    panel.append(
      el('h1', {}, win ? 'MISSION ACCOMPLISHED' : 'MISSION FAILED'),
      survived,
      el('div', { class: 'muted' }, `Battle time ${mins}:${String(secs).padStart(2, '0')}`),
      table,
      el('div', { class: 'row' }, again, watch, menu),
    );
    o.appendChild(panel);
    o.classList.remove('hidden');
  }

  // ---------------------------------------------------------------- input

  private setMode(m: Mode): void {
    this.mode = m;
    if (m !== 'place') this.view.placement = null;
    if (m !== 'wall') this.wallStart = null;
    this.view.cursor = m === 'super' ? 'super' : m === 'sell' ? 'sell' : m === 'repair' ? 'repair' : 'none';
    this.canvas.dataset.mode = m;
    this.audio.play('click');
  }

  private changeSpeed(d: number, wrap = false): void {
    this.speedIdx = wrap ? (this.speedIdx + d) % SPEEDS.length : Math.max(0, Math.min(SPEEDS.length - 1, this.speedIdx + d));
    this.message(`Game speed ${SPEEDS[this.speedIdx]}x`);
  }

  private onResize = () => this.renderer.resize();

  private onKeyDown = (ev: KeyboardEvent) => {
    if ((ev.target as HTMLElement)?.tagName === 'INPUT') return;
    this.keys.add(ev.key);
    const w = this.world;
    const sel = this.selectedUnits();
    const k = ev.key.toLowerCase();
    if (/^[0-9]$/.test(ev.key)) {
      const n = Number(ev.key);
      if (ev.ctrlKey || ev.metaKey) {
        ev.preventDefault();
        this.groups.set(n, [...this.view.selected]);
        this.message(`Group ${n} assigned (${this.view.selected.size})`);
      } else {
        const g = (this.groups.get(n) ?? []).filter((id) => w.get(id));
        if (!g.length) return;
        if (ev.shiftKey) g.forEach((id) => this.view.selected.add(id));
        else this.view.selected = new Set(g);
        const now = performance.now();
        if (this.lastGroupKey.key === n && now - this.lastGroupKey.time < 400) {
          const e = w.get(g[0]);
          if (e) this.renderer.centerOn(e.x, e.y);
        }
        this.lastGroupKey = { key: n, time: now };
      }
      return;
    }
    switch (k) {
      case 'escape':
        if (this.mode !== 'normal') this.setMode('normal');
        else if (this.view.selected.size) this.view.selected.clear();
        else this.togglePause();
        break;
      case 'p':
      case 'pause':
        this.togglePause();
        break;
      case 'a':
        if (sel.length) this.setMode('attackMove');
        break;
      case 's':
        if (sel.length) {
          w.commandStop(sel.map((u) => u.id));
          this.audio.play('ack');
        }
        break;
      case 'x':
        for (const u of sel) {
          const a = Math.random() * Math.PI * 2;
          w.commandMove([u.id], u.x + Math.cos(a) * TILE * 2.5, u.y + Math.sin(a) * TILE * 2.5, 'move');
        }
        break;
      case 'h': {
        const cy = w.buildings.find((b) => b.owner === w.humanIndex && b.type === 'conyard') ?? w.buildings.find((b) => b.owner === w.humanIndex);
        if (cy) this.renderer.centerOn(cy.x, cy.y);
        break;
      }
      case ' ':
        ev.preventDefault();
        if (this.lastAlert) this.renderer.centerOn(this.lastAlert.x, this.lastAlert.y);
        break;
      case 'q':
        this.setMode(this.mode === 'sell' ? 'normal' : 'sell');
        break;
      case 'r':
        this.setMode(this.mode === 'repair' ? 'normal' : 'repair');
        break;
      case 'e':
        this.selectSameTypeOnScreen();
        break;
      case 'tab': {
        ev.preventDefault();
        const order: ProdCategory[] = ['structure', 'infantry', 'vehicle', 'aircraft'];
        this.tab = order[(order.indexOf(this.tab) + 1) % order.length];
        this.refreshGrid();
        break;
      }
      case '+':
      case '=':
        this.changeSpeed(1);
        break;
      case '-':
        this.changeSpeed(-1);
        break;
      case 'm':
        this.audio.settings.music = this.audio.settings.music > 0 ? 0 : 0.45;
        this.audio.applySettings();
        break;
      case 'n':
        if (this.me.superReady) this.setMode('super');
        break;
      case 'd':
        this.deploySelected();
        break;
    }
  };

  private onKeyUp = (ev: KeyboardEvent) => {
    this.keys.delete(ev.key);
  };

  private bindInput(): void {
    const c = this.canvas;
    window.addEventListener('keydown', this.onKeyDown, { signal: this.abort.signal });
    window.addEventListener('keyup', this.onKeyUp, { signal: this.abort.signal });
    window.addEventListener('resize', this.onResize, { signal: this.abort.signal });
    c.addEventListener('contextmenu', (ev) => ev.preventDefault(), { signal: this.abort.signal });
    c.addEventListener('mouseenter', () => (this.mouseScreen.inside = true), { signal: this.abort.signal });
    c.addEventListener('mouseleave', () => (this.mouseScreen.inside = false), { signal: this.abort.signal });
    c.addEventListener(
      'wheel',
      (ev) => {
        ev.preventDefault();
        const r = c.getBoundingClientRect();
        this.renderer.zoomAt(ev.clientX - r.left, ev.clientY - r.top, ev.deltaY < 0 ? 1.12 : 1 / 1.12);
      },
      { passive: false, signal: this.abort.signal },
    );
    c.addEventListener(
      'mousedown',
      (ev) => {
        this.audio.init();
        this.audio.startMusic();
        const p = this.toWorld(ev);
        this.drag = { button: ev.button, sx: ev.clientX, sy: ev.clientY, wx: p.x, wy: p.y, moved: false, camX: this.renderer.cam.x, camY: this.renderer.cam.y };
        if (ev.button === 0) this.leftDown(p.x, p.y, ev);
      },
      { signal: this.abort.signal },
    );
    window.addEventListener(
      'mousemove',
      (ev) => {
        const r = c.getBoundingClientRect();
        this.mouseScreen.x = ev.clientX - r.left;
        this.mouseScreen.y = ev.clientY - r.top;
        const p = this.renderer.screenToWorld(this.mouseScreen.x, this.mouseScreen.y);
        this.view.mouse = p;
        const d = this.drag;
        if (d) {
          if (Math.hypot(ev.clientX - d.sx, ev.clientY - d.sy) > 6) d.moved = true;
          if ((d.button === 2 || d.button === 1) && d.moved) {
            const z = this.renderer.cam.zoom;
            this.renderer.cam.x = d.camX - (ev.clientX - d.sx) / z;
            this.renderer.cam.y = d.camY - (ev.clientY - d.sy) / z;
            this.renderer.clampCam();
          }
          if (d.button === 0 && d.moved && this.mode === 'normal') this.view.dragBox = { x0: d.wx, y0: d.wy, x1: p.x, y1: p.y };
        }
        this.updatePlacement();
      },
      { signal: this.abort.signal },
    );
    window.addEventListener(
      'mouseup',
      (ev) => {
        const d = this.drag;
        this.drag = null;
        if (!d || d.button !== ev.button) return;
        if (!this.root.isConnected) return;
        const p = this.renderer.screenToWorld(this.mouseScreen.x, this.mouseScreen.y);
        if (ev.button === 0) this.leftUp(p.x, p.y, d.moved, ev);
        else if (ev.button === 2 && !d.moved && ev.target === c) this.rightClick(p.x, p.y);
      },
      { signal: this.abort.signal },
    );
  }

  private toWorld(ev: MouseEvent): { x: number; y: number } {
    const r = this.canvas.getBoundingClientRect();
    return this.renderer.screenToWorld(ev.clientX - r.left, ev.clientY - r.top);
  }

  private deploySelected(): void {
    const mcvs = this.selectedUnits().filter((u) => u.u.deploys);
    if (!mcvs.length) return;
    this.audio.play(this.world.deploy(mcvs.map((u) => u.id)) ? 'place' : 'deny');
  }

  private entityAt(x: number, y: number): Entity | undefined {
    const w = this.world;
    let best: Entity | undefined;
    let bd = Infinity;
    for (const e of w.entities) {
      if (e.dead || !w.visibleToHuman(e)) continue;
      const d = e.isBuilding ? e.distTo(x, y) : Math.hypot(e.x - x, e.y - y + e.alt) - e.radius - 4;
      if (d <= 0 && (e.isUnit ? d - 100 : d) < bd) {
        bd = e.isUnit ? d - 100 : d;
        best = e;
      }
    }
    return best;
  }

  private updateHover(): void {
    if (!this.mouseScreen.inside) {
      this.view.hoverId = 0;
      return;
    }
    const e = this.entityAt(this.view.mouse.x, this.view.mouse.y);
    this.view.hoverId = e?.id ?? 0;
    let cur = 'default';
    if (this.mode === 'normal' && e) {
      const mine = e.owner === this.world.humanIndex;
      const sel = this.selectedUnits();
      if (!mine && sel.length && this.world.isEnemy(e.owner, this.world.humanIndex)) cur = 'crosshair';
      else cur = 'pointer';
    }
    this.canvas.style.cursor = this.mode === 'normal' ? cur : '';
  }

  private updatePlacement(): void {
    if (this.mode !== 'place' && this.mode !== 'wall') return;
    const id = this.mode === 'wall' ? 'wall' : this.placingId;
    const def = BUILDINGS[id];
    const tx = Math.floor(this.view.mouse.x / TILE - def.w / 2 + 0.5);
    const ty = Math.floor(this.view.mouse.y / TILE - def.h / 2 + 0.5);
    this.view.placement = { id, tx, ty, ok: this.world.canPlace(this.me, id, tx, ty) };
  }

  private leftDown(x: number, y: number, ev: MouseEvent): void {
    const w = this.world;
    const me = this.me;
    switch (this.mode) {
      case 'place': {
        const pl = this.view.placement;
        if (pl && w.placeBuilding(me, pl.id, pl.tx, pl.ty)) {
          this.setMode('normal');
        } else this.audio.play('deny');
        this.drag = null;
        return;
      }
      case 'wall': {
        const pl = this.view.placement;
        if (pl) this.wallStart = { x: pl.tx, y: pl.ty };
        return;
      }
      case 'sell':
      case 'repair': {
        const e = this.entityAt(x, y);
        if (e && e.isBuilding && e.owner === me.index) {
          if (this.mode === 'sell') w.sell(me, e.id);
          else w.toggleRepair(me, e.id);
          this.audio.play('click');
          if (!ev.shiftKey) this.setMode('normal');
        } else this.audio.play('deny');
        this.drag = null;
        return;
      }
      case 'super':
        if (w.fireSuper(me, x, y)) this.setMode('normal');
        this.drag = null;
        return;
      case 'attackMove': {
        const ids = this.selectedUnits().map((u) => u.id);
        const target = this.entityAt(x, y);
        if (target && w.isEnemy(target.owner, me.index)) w.commandAttack(ids, target.id);
        else w.commandMove(ids, x, y, 'attackMove');
        this.renderer.marker(x, y, '#ff5050');
        this.audio.play('ack');
        this.setMode('normal');
        this.drag = null;
        return;
      }
    }
  }

  private leftUp(x: number, y: number, moved: boolean, ev: MouseEvent): void {
    const w = this.world;
    if (this.mode === 'wall') {
      const pl = this.view.placement;
      if (this.wallStart && pl) {
        const cells = lineCells(this.wallStart.x, this.wallStart.y, pl.tx, pl.ty);
        let built = 0;
        for (const c of cells) if (w.buildWall(this.me, c.x, c.y)) built++;
        this.audio.play(built ? 'place' : 'deny');
      }
      this.wallStart = null;
      if (!ev.shiftKey) this.setMode('normal');
      return;
    }
    if (this.mode !== 'normal') return;
    const box = this.view.dragBox;
    this.view.dragBox = null;
    if (moved && box) {
      const x0 = Math.min(box.x0, box.x1);
      const x1 = Math.max(box.x0, box.x1);
      const y0 = Math.min(box.y0, box.y1);
      const y1 = Math.max(box.y0, box.y1);
      const picked = w.units.filter((u) => !u.dead && u.owner === w.humanIndex && u.x >= x0 && u.x <= x1 && u.y >= y0 && u.y <= y1);
      // Prefer combat units over harvesters in a box select.
      const combat = picked.filter((u) => !u.u.harvester);
      const final = combat.length ? combat : picked;
      if (!ev.shiftKey) this.view.selected.clear();
      for (const u of final) this.view.selected.add(u.id);
      if (final.length) this.audio.play('ack');
      return;
    }
    const e = this.entityAt(x, y);
    const now = performance.now();
    if (e && e.id === this.lastClick.id && now - this.lastClick.time < 350 && e.owner === w.humanIndex) {
      this.selectSameTypeOnScreen(e.type);
      return;
    }
    this.lastClick = { time: now, id: e?.id ?? 0 };
    if (!e) {
      if (!ev.shiftKey) this.view.selected.clear();
      return;
    }
    if (ev.shiftKey && e.owner === w.humanIndex) {
      if (this.view.selected.has(e.id)) this.view.selected.delete(e.id);
      else this.view.selected.add(e.id);
    } else this.view.selected = new Set([e.id]);
    if (e.owner === w.humanIndex) this.audio.play('click');
  }

  private rightClick(x: number, y: number): void {
    if (this.mode !== 'normal') {
      this.setMode('normal');
      return;
    }
    this.commandAt(x, y, true);
  }

  private commandAt(x: number, y: number, useTarget: boolean): void {
    const w = this.world;
    const me = this.me;
    const units = this.selectedUnits();
    const buildings = [...this.view.selected].map((id) => w.get(id)).filter((e): e is Entity => !!e && e.isBuilding && e.owner === me.index);
    if (!units.length) {
      for (const b of buildings) if (b.b.produces && b.b.produces !== 'structure') w.setRally(me, b.id, x, y);
      if (buildings.length) this.renderer.marker(x, y, '#7dff7d');
      return;
    }
    const target = useTarget ? this.entityAt(x, y) : undefined;
    const ids = units.map((u) => u.id);
    if (target && w.isEnemy(target.owner, me.index)) {
      w.commandAttack(ids, target.id);
      this.renderer.marker(target.x, target.y, '#ff4040');
    } else {
      const cx = Math.floor(x / TILE);
      const cy = Math.floor(y / TILE);
      const onOre = w.map.inBounds(cx, cy) && w.map.ore[w.map.idx(cx, cy)] > 0;
      const harvesters = units.filter((u) => u.u.harvester);
      if (onOre && harvesters.length)
        w.commandHarvest(
          harvesters.map((u) => u.id),
          x,
          y,
        );
      const others = onOre ? units.filter((u) => !u.u.harvester) : units;
      if (others.length)
        w.commandMove(
          others.map((u) => u.id),
          x,
          y,
          'move',
        );
      this.renderer.marker(x, y, '#7dff7d');
    }
    this.audio.play('ack');
  }

  private selectedUnits(): Entity[] {
    return [...this.view.selected].map((id) => this.world.get(id)).filter((e): e is Entity => !!e && e.isUnit && e.owner === this.world.humanIndex);
  }

  private selectSameTypeOnScreen(type?: string): void {
    const r = this.renderer;
    const t = type ?? this.selectedUnits()[0]?.type;
    if (!t) return;
    const x0 = r.cam.x;
    const y0 = r.cam.y;
    const x1 = x0 + r.vw / r.cam.zoom;
    const y1 = y0 + r.vh / r.cam.zoom;
    this.view.selected = new Set(
      this.world.units
        .filter((u) => !u.dead && u.owner === this.world.humanIndex && u.type === t && u.x >= x0 && u.x <= x1 && u.y >= y0 && u.y <= y1)
        .map((u) => u.id),
    );
  }

  private edgeScroll(dt: number): void {
    const r = this.renderer;
    let dx = 0;
    let dy = 0;
    const m = this.mouseScreen;
    const edge = 14;
    if (m.inside && !this.drag) {
      if (m.x < edge) dx = -1;
      else if (m.x > r.vw - edge) dx = 1;
      if (m.y < edge) dy = -1;
      else if (m.y > r.vh - edge) dy = 1;
    }
    if (this.keys.has('ArrowLeft')) dx = -1;
    if (this.keys.has('ArrowRight')) dx = 1;
    if (this.keys.has('ArrowUp')) dy = -1;
    if (this.keys.has('ArrowDown')) dy = 1;
    if (!dx && !dy) return;
    const speed = 900 / r.cam.zoom;
    r.cam.x += dx * speed * dt;
    r.cam.y += dy * speed * dt;
    r.clampCam();
    this.updatePlacement();
  }
}

function lineCells(x0: number, y0: number, x1: number, y1: number): { x: number; y: number }[] {
  // Walls snap to straight horizontal / vertical lines.
  const out: { x: number; y: number }[] = [];
  if (Math.abs(x1 - x0) >= Math.abs(y1 - y0)) {
    for (let x = Math.min(x0, x1); x <= Math.max(x0, x1); x++) out.push({ x, y: y0 });
  } else {
    for (let y = Math.min(y0, y1); y <= Math.max(y0, y1); y++) out.push({ x: x0, y });
  }
  return out;
}

export function controlsHelp(): HTMLElement {
  const rows: [string, string][] = [
    ['Left click / drag', 'Select units'],
    ['Right click', 'Move · attack · harvest · set rally point'],
    ['Right / middle drag', 'Pan camera'],
    ['Mouse wheel', 'Zoom'],
    ['Double-click / E', 'Select all of that type on screen'],
    ['Ctrl+1-9 / 1-9', 'Assign / recall group (tap twice to jump)'],
    ['A', 'Attack-move'],
    ['S / X', 'Stop / scatter'],
    ['Q / R', 'Sell / repair mode'],
    ['N', 'Fire superweapon'],
    ['D', 'Deploy M.C.V. into a Construction Yard'],
    ['H / Space', 'Jump to base / last alert'],
    ['Tab', 'Cycle build tabs'],
    ['+ / -', 'Game speed'],
    ['M', 'Toggle music'],
    ['Esc / P', 'Cancel · pause menu'],
  ];
  return el('table', { class: 'help' }, ...rows.map(([k, v]) => el('tr', {}, el('td', { class: 'key' }, k), el('td', {}, v))));
}

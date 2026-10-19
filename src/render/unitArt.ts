import type { Faction } from '../game/defs';
import { shade } from './color';
import { barrel, glow, lin, poly, rad, rr, tracks, type Ctx } from './draw';

/**
 * Top-down unit art, modelled on the classic two-faction look: Vanguard in
 * desert-gold camo, Ember in gunmetal black with red trim. Team colour is
 * used for markings. Everything faces +x and is centred on the origin.
 */

export interface Pal {
  body: string;
  light: string;
  dark: string;
  metal: string;
  glow: string;
  team: string;
  ember: boolean;
}

export function palette(faction: Faction, team: string): Pal {
  return faction === 'ember'
    ? { body: '#33363c', light: '#6a6f78', dark: '#111214', metal: '#80858d', glow: '#ff4a3a', team, ember: true }
    : { body: '#b89a5c', light: '#ead7a0', dark: '#5a4824', metal: '#8e9197', glow: '#7fe7ff', team, ember: false };
}

// ------------------------------------------------------------------ shared pieces

/** A lit armour plate with an outline; desert camo blotches on Vanguard, red trim on Ember. */
function plate(c: Ctx, pal: Pal, draw: () => void, base = pal.body, camo = true): void {
  draw();
  c.fillStyle = lin(c, -14, -12, 14, 12, [
    [0, shade(base, 0.32)],
    [0.55, base],
    [1, shade(base, -0.42)],
  ]);
  c.fill();
  if (camo && !pal.ember) {
    c.save();
    c.clip();
    c.fillStyle = shade(base, -0.22, 0.7);
    for (const [x, y, r] of [
      [-6, -3, 4],
      [5, 4, 3.5],
      [9, -5, 2.5],
      [-12, 5, 3],
    ]) {
      c.beginPath();
      c.ellipse(x, y, r * 1.4, r, 0.6, 0, Math.PI * 2);
      c.fill();
    }
    c.restore();
    draw();
  }
  c.strokeStyle = shade(base, -0.65);
  c.lineWidth = 1;
  c.stroke();
}

function stripe(c: Ctx, pal: Pal, x: number, y: number, w: number, h: number): void {
  c.fillStyle = pal.team;
  c.fillRect(x, y, w, h);
  c.fillStyle = 'rgba(255,255,255,0.25)';
  c.fillRect(x, y, w, Math.max(0.6, h * 0.35));
}

function wheel(c: Ctx, x: number, y: number, w: number, h: number): void {
  c.fillStyle = '#151617';
  rr(c, x - w / 2, y - h / 2, w, h, 1.5);
  c.fill();
  c.fillStyle = '#3b3e42';
  for (let i = -w / 2 + 1; i < w / 2; i += 2) c.fillRect(x + i, y - h / 2, 0.8, h);
}

function hoverSkirt(c: Ctx, pal: Pal, len: number, wid: number): void {
  c.fillStyle = rad(c, 0, 0, 2, Math.max(len, wid) * 0.6, [
    [0, pal.ember ? 'rgba(255,90,60,0.55)' : 'rgba(110,220,255,0.55)'],
    [1, 'rgba(0,0,0,0)'],
  ]);
  c.beginPath();
  c.ellipse(0, 0, len * 0.62, wid * 0.66, 0, 0, Math.PI * 2);
  c.fill();
  c.fillStyle = '#1b1c1f';
  rr(c, -len / 2, -wid / 2, len, wid, wid / 2.2);
  c.fill();
}

function canopy(c: Ctx, x: number, y: number, rx: number, ry: number, col = '#9fe3ff'): void {
  c.fillStyle = lin(c, x - rx, y - ry, x + rx, y + ry, [
    [0, '#ffffff'],
    [0.3, col],
    [1, shade(col, -0.6)],
  ]);
  c.beginPath();
  c.ellipse(x, y, rx, ry, 0, 0, Math.PI * 2);
  c.fill();
}

// ------------------------------------------------------------------ infantry

interface InfLook {
  armor: string;
  helmet: string;
  weapon: 'rifle' | 'launcher' | 'grenade' | 'sniper' | 'pistol' | 'chaingun' | 'plasma2' | 'laser' | 'none';
  pack?: 'jet' | 'medkit' | 'tools' | 'radio';
  bulk?: number;
  visor?: string;
  cape?: string;
  pads?: boolean;
  cross?: boolean;
}

function infLook(type: string, pal: Pal): InfLook {
  const armor = pal.ember ? '#2e3136' : '#a98d52';
  switch (type) {
    case 'grenadier':
      return { armor, helmet: shade(armor, -0.35), weapon: 'grenade', pads: true };
    case 'dragoon':
      return { armor, helmet: '#1b1c1f', weapon: 'launcher', pads: true, visor: '#ff5a3a' };
    case 'engineer':
      return { armor, helmet: '#ffd21a', weapon: 'none', pack: 'tools' };
    case 'medic':
      return { armor: '#e4e1d6', helmet: '#f2f0ea', weapon: 'none', pack: 'medkit', cross: true };
    case 'cyborg':
      return { armor: '#8c929b', helmet: '#5d6269', weapon: 'chaingun', bulk: 1.3, visor: '#ff2a1a', pads: true };
    case 'jumpjet':
      return { armor, helmet: shade(armor, -0.3), weapon: 'rifle', pack: 'jet', visor: '#7fe7ff' };
    case 'tactician':
      return { armor: '#22252a', helmet: pal.team, weapon: 'pistol', pack: 'radio' };
    case 'ghost':
      return { armor: '#3c4a2c', helmet: '#26301c', weapon: 'sniper', pack: 'radio' };
    case 'vega':
      return { armor: '#e6bd4a', helmet: '#f5d570', weapon: 'laser', bulk: 1.2, visor: '#7fe7ff', cape: pal.team, pads: true };
    case 'ankha':
      return { armor: '#7c1414', helmet: '#1a0c0c', weapon: 'plasma2', bulk: 1.15, visor: '#ff3a3a', cape: '#151515', pads: true };
    default:
      return { armor, helmet: shade(armor, -0.3), weapon: 'rifle', pads: pal.ember };
  }
}

function drawInfantry(c: Ctx, type: string, pal: Pal, frame: number): void {
  const L = infLook(type, pal);
  c.scale(1.35 * (L.bulk ?? 1), 1.35 * (L.bulk ?? 1));
  const leg = frame === 0 ? 2 : frame === 1 ? -2 : 0;
  // Cape and legs sit underneath.
  if (L.cape) {
    c.fillStyle = shade(L.cape, -0.25);
    poly(c, [-1, -2.6, -1, 2.6, -4.8, 3.2, -5.2, -3.2]);
    c.fill();
  }
  c.fillStyle = '#26241f';
  c.fillRect(-2 + leg, -2.8, 3.2, 1.8);
  c.fillRect(-2 - leg, 1, 3.2, 1.8);
  // Backpack
  if (L.pack === 'jet') {
    c.fillStyle = '#3a3d42';
    rr(c, -5.5, -3, 3, 6, 1);
    c.fill();
    glow(c, -6, -1.6, 1.8, '#7fe7ff');
    glow(c, -6, 1.6, 1.8, '#7fe7ff');
  } else if (L.pack === 'medkit') {
    c.fillStyle = '#f2f0ea';
    rr(c, -5, -2.2, 2.6, 4.4, 0.8);
    c.fill();
    c.fillStyle = '#d42020';
    c.fillRect(-4.3, -0.4, 1.4, 0.8);
    c.fillRect(-4, -0.9, 0.8, 1.8);
  } else if (L.pack === 'tools') {
    c.fillStyle = '#c75b1a';
    rr(c, -5, -2, 2.4, 4, 0.6);
    c.fill();
  } else if (L.pack === 'radio') {
    c.fillStyle = '#2a2c22';
    rr(c, -4.8, -1.8, 2.2, 3.6, 0.6);
    c.fill();
    c.strokeStyle = '#111';
    c.lineWidth = 0.4;
    c.beginPath();
    c.moveTo(-4.4, -1.6);
    c.lineTo(-6.5, -4);
    c.stroke();
  }
  // Torso
  c.fillStyle = lin(c, -3, -4, 3, 4, [
    [0, shade(L.armor, 0.35)],
    [0.6, L.armor],
    [1, shade(L.armor, -0.4)],
  ]);
  c.beginPath();
  c.ellipse(0, 0, 3, 3.9, 0, 0, Math.PI * 2);
  c.fill();
  c.strokeStyle = shade(L.armor, -0.65);
  c.lineWidth = 0.6;
  c.stroke();
  if (L.pads) {
    c.fillStyle = pal.team;
    c.beginPath();
    c.arc(0.2, -3.4, 1.2, 0, Math.PI * 2);
    c.arc(0.2, 3.4, 1.2, 0, Math.PI * 2);
    c.fill();
  }
  // Weapon held forward
  switch (L.weapon) {
    case 'rifle':
      c.fillStyle = '#1d1e20';
      c.fillRect(1, 0.6, 6.5, 1.2);
      break;
    case 'grenade':
      c.fillStyle = '#1d1e20';
      c.fillRect(1, 0.8, 4.5, 1);
      c.fillStyle = '#4f5a2a';
      c.beginPath();
      c.arc(2.5, -2.2, 1.2, 0, Math.PI * 2);
      c.fill();
      break;
    case 'launcher':
      c.fillStyle = '#3c3f44';
      c.fillRect(-3.5, -3.6, 10, 2.2);
      c.fillStyle = pal.team;
      c.fillRect(5.5, -3.6, 1.2, 2.2);
      break;
    case 'sniper':
      c.fillStyle = '#1a1a1a';
      c.fillRect(0, 0.5, 10, 1);
      c.fillRect(3, 0.1, 2.5, 0.6);
      break;
    case 'pistol':
      c.fillStyle = '#1a1a1a';
      c.fillRect(2, 1, 3, 0.9);
      break;
    case 'chaingun':
      c.fillStyle = '#2a2c30';
      rr(c, 0.5, 0.2, 7.5, 2.4, 0.6);
      c.fill();
      c.fillStyle = '#5c6066';
      c.fillRect(6.5, 0.5, 2, 1.8);
      break;
    case 'plasma2':
      c.fillStyle = '#2a0a0a';
      c.fillRect(1.5, -2.6, 4, 1);
      c.fillRect(1.5, 1.6, 4, 1);
      glow(c, 5.8, -2.1, 1.3, '#ff3a3a');
      glow(c, 5.8, 2.1, 1.3, '#ff3a3a');
      break;
    case 'laser':
      c.fillStyle = '#b8902a';
      c.fillRect(0, 0.4, 10, 1.5);
      glow(c, 10, 1.1, 1.5, '#ffe27a');
      break;
  }
  // Head / helmet with visor
  c.fillStyle = lin(c, -1, -2, 2, 2, [
    [0, shade(L.helmet, 0.4)],
    [1, shade(L.helmet, -0.35)],
  ]);
  c.beginPath();
  c.arc(0.4, 0, 2.1, 0, Math.PI * 2);
  c.fill();
  if (L.cross) {
    c.fillStyle = '#d42020';
    c.fillRect(-0.3, -0.35, 1.4, 0.7);
    c.fillRect(0.05, -0.7, 0.7, 1.4);
  }
  if (L.visor) {
    c.strokeStyle = L.visor;
    c.lineWidth = 0.8;
    c.beginPath();
    c.arc(0.4, 0, 1.7, -0.9, 0.9);
    c.stroke();
  }
}

// ------------------------------------------------------------------ vehicles

type BodyDraw = (c: Ctx, pal: Pal, frame: number) => void;

const BODY: Record<string, BodyDraw> = {
  badger(c, pal) {
    for (const [x, y] of [
      [-7, -8],
      [6, -8],
      [-7, 8],
      [6, 8],
    ])
      wheel(c, x, y, 6, 3.6);
    plate(c, pal, () => poly(c, [-11, -5, 6, -6, 11, -2, 11, 2, 6, 6, -11, 5]));
    c.strokeStyle = '#202124';
    c.lineWidth = 1.4;
    c.strokeRect(-6, -4.5, 8, 9);
    stripe(c, pal, -11, -1, 6, 2);
    barrel(c, 1, 10, 2);
    c.fillStyle = '#3a3c40';
    c.beginPath();
    c.arc(1, 0, 2.2, 0, Math.PI * 2);
    c.fill();
  },
  raider(c, pal) {
    for (const [x, y] of [
      [-7, -8],
      [6, -8],
      [-7, 8],
      [6, 8],
    ])
      wheel(c, x, y, 6, 3.4);
    plate(c, pal, () => poly(c, [-11, -6, 4, -6, 12, 0, 4, 6, -11, 6]));
    stripe(c, pal, -4, -6, 3, 12);
    canopy(c, 0, 0, 3, 3, '#ff7a6a');
    barrel(c, 4, 9, 2, -3);
    barrel(c, 4, 9, 2, 3);
  },
  repairbot(c, pal) {
    hoverSkirt(c, pal, 16, 16);
    for (const a of [0.8, 2.35, 3.9, 5.5]) {
      const x = Math.cos(a) * 8;
      const y = Math.sin(a) * 8;
      c.strokeStyle = '#2a2c30';
      c.lineWidth = 2;
      c.beginPath();
      c.moveTo(0, 0);
      c.lineTo(x, y);
      c.stroke();
      c.fillStyle = 'rgba(200,210,220,0.35)';
      c.beginPath();
      c.arc(x, y, 3.2, 0, Math.PI * 2);
      c.fill();
    }
    plate(c, pal, () => {
      c.beginPath();
      c.arc(0, 0, 5.5, 0, Math.PI * 2);
    });
    glow(c, 2, 0, 3, '#5dff8a');
    stripe(c, pal, -4, -1, 3, 2);
  },
  apc(c, pal) {
    for (const x of [-9, -1, 7]) {
      wheel(c, x, -9.5, 5.5, 3.4);
      wheel(c, x, 9.5, 5.5, 3.4);
    }
    plate(c, pal, () => poly(c, [-14, -8.5, 7, -8.5, 14, -4, 14, 4, 7, 8.5, -14, 8.5]));
    c.strokeStyle = 'rgba(0,0,0,0.35)';
    c.beginPath();
    c.moveTo(7, -8.5);
    c.lineTo(7, 8.5);
    c.stroke();
    stripe(c, pal, -13, -8.5, 4, 17);
    c.fillStyle = '#2a2c30';
    rr(c, -8, -4, 7, 8, 1.5);
    c.fill();
    c.fillStyle = shade(pal.body, -0.2);
    c.beginPath();
    c.arc(3, 0, 3.4, 0, Math.PI * 2);
    c.fill();
    barrel(c, 4, 8, 1.8);
  },
  termite(c, pal, frame) {
    const k = frame === 0 ? 1.5 : -1.5;
    c.strokeStyle = '#151515';
    c.lineWidth = 1.3;
    for (const [x, s] of [
      [-3, 1],
      [0.5, -1],
      [4, 1],
    ]) {
      for (const sy of [-1, 1]) {
        c.beginPath();
        c.moveTo(x, sy * 2);
        c.lineTo(x + s * k * sy, sy * 7);
        c.stroke();
      }
    }
    plate(c, pal, () => {
      c.beginPath();
      c.ellipse(0, 0, 6, 4, 0, 0, Math.PI * 2);
    });
    stripe(c, pal, -5, -0.8, 3, 1.6);
    glow(c, 5.5, 0, 2.6, '#ff3a2a');
  },
  harvester(c, pal) {
    tracks(c, 30, 6, 8);
    plate(c, pal, () => rr(c, -15, -9, 22, 18, 3), pal.ember ? '#4a4d54' : '#c7a865');
    c.fillStyle = 'rgba(80,255,140,0.55)';
    rr(c, -12, -6, 14, 12, 2);
    c.fill();
    c.strokeStyle = '#2a2a1a';
    c.lineWidth = 1;
    for (let x = -10; x < 2; x += 3) {
      c.beginPath();
      c.moveTo(x, -6);
      c.lineTo(x, 6);
      c.stroke();
    }
    stripe(c, pal, -15, -9, 22, 2.5);
    c.fillStyle = '#3b3d40';
    rr(c, 7, -8, 6, 16, 2);
    c.fill();
    c.fillStyle = '#a5a7aa';
    for (let y = -8; y < 8; y += 3) c.fillRect(13, y, 3, 2);
  },
  titan(c, pal, frame) {
    // Two big walker legs swinging out of phase.
    const swing = [5, 0, -5, 0][frame] ?? 0;
    for (const [sy, s] of [
      [-1, swing],
      [1, -swing],
    ]) {
      c.fillStyle = '#26282c';
      rr(c, -4 + s, sy * 8 - 2.5, 9, 5, 2);
      c.fill();
      c.fillStyle = shade(pal.body, -0.3);
      rr(c, -1 + s * 0.5, sy * 6 - 2, 5, 4, 1.5);
      c.fill();
      c.fillStyle = '#1a1b1d';
      c.fillRect(4 + s, sy * 8 - 3, 2.5, 6);
    }
    c.fillStyle = '#2c2e32';
    c.beginPath();
    c.arc(0, 0, 5.5, 0, Math.PI * 2);
    c.fill();
  },
  raptor(c, pal) {
    tracks(c, 27, 5, 6.5);
    plate(c, pal, () => poly(c, [-12, -7, 8, -7, 13, -3, 13, 3, 8, 7, -12, 7]));
    stripe(c, pal, -12, -7, 3, 14);
    c.fillStyle = 'rgba(0,0,0,0.3)';
    c.fillRect(-9, -1, 7, 2);
  },
  mrls(c, pal) {
    hoverSkirt(c, pal, 24, 18);
    plate(c, pal, () => rr(c, -11, -7, 22, 14, 6));
    stripe(c, pal, -11, -1.2, 5, 2.4);
  },
  artillery(c, pal) {
    tracks(c, 24, 5, 5);
    plate(c, pal, () => rr(c, -10, -5.5, 20, 11, 2));
    c.fillStyle = shade(pal.body, -0.25);
    rr(c, -6, -5, 10, 10, 2);
    c.fill();
    barrel(c, 0, 19, 3.6);
    c.fillStyle = '#1e1f22';
    c.fillRect(-14, -6, 3, 3);
    c.fillRect(-14, 3, 3, 3);
    stripe(c, pal, -10, -5.5, 3, 11);
  },
  ecm(c, pal) {
    tracks(c, 24, 5, 6);
    plate(c, pal, () => rr(c, -11, -6.5, 22, 13, 3));
    stripe(c, pal, -11, -6.5, 3, 13);
    for (const r of [6, 4, 2]) {
      c.strokeStyle = r === 2 ? pal.glow : '#9aa0a8';
      c.lineWidth = 1.2;
      c.beginPath();
      c.arc(2, 0, r, 0, Math.PI * 2);
      c.stroke();
    }
    glow(c, 2, 0, 2.5, pal.glow);
  },
  sensor(c, pal) {
    for (const x of [-9, -2, 6]) {
      wheel(c, x, -8.5, 5, 3);
      wheel(c, x, 8.5, 5, 3);
    }
    plate(c, pal, () => rr(c, -13, -7, 26, 14, 2));
    c.fillStyle = shade(pal.body, -0.25);
    rr(c, 6, -6, 7, 12, 2);
    c.fill();
    canopy(c, 10, 0, 2, 4.5);
    stripe(c, pal, -13, -7, 3, 14);
    c.fillStyle = '#26282b';
    c.beginPath();
    c.arc(-3, 0, 3, 0, Math.PI * 2);
    c.fill();
  },
  disruptor(c, pal) {
    tracks(c, 32, 6.5, 8);
    plate(c, pal, () => poly(c, [-15, -9, 9, -9, 15, -4, 15, 4, 9, 9, -15, 9]));
    stripe(c, pal, -15, -9, 3, 18);
  },
  stealth(c, pal) {
    tracks(c, 24, 4, 6);
    c.fillStyle = lin(c, 0, -8, 0, 8, [
      [0, '#4a4f57'],
      [1, '#121417'],
    ]);
    poly(c, [13, 0, -11, -9, -8, 0, -11, 9]);
    c.fill();
    c.strokeStyle = pal.team;
    c.lineWidth = 1.5;
    c.stroke();
    c.fillStyle = '#25282d';
    c.fillRect(-4, -8, 9, 3);
    c.fillRect(-4, 5, 9, 3);
    c.fillStyle = pal.team;
    c.fillRect(3, -8, 2, 3);
    c.fillRect(3, 5, 2, 3);
  },
  inferno(c, pal) {
    tracks(c, 28, 5.5, 7);
    plate(c, pal, () => rr(c, -13, -8, 26, 16, 3));
    for (const y of [-4, 4]) {
      c.fillStyle = rad(c, -6, y - 1, 0.5, 4.5, [
        [0, '#ff9a7a'],
        [0.5, '#c22a1a'],
        [1, '#5a0d08'],
      ]);
      c.beginPath();
      c.arc(-6, y, 3.8, 0, Math.PI * 2);
      c.fill();
      barrel(c, 6, 9, 2.2, y * 0.8);
      glow(c, 15, y * 0.8, 2, '#ff8a2a');
    }
    stripe(c, pal, -1, -8, 3, 16);
  },
  mammoth(c, pal) {
    tracks(c, 36, 7.5, 8.5);
    plate(c, pal, () => rr(c, -16, -9.5, 32, 19, 4));
    stripe(c, pal, -16, -9.5, 3, 19);
    c.fillStyle = 'rgba(0,0,0,0.25)';
    c.fillRect(10, -8, 4, 16);
  },
  mcv(c, pal) {
    for (const x of [-14, -6, 2, 10]) {
      wheel(c, x, -10, 6, 3.4);
      wheel(c, x, 10, 6, 3.4);
    }
    plate(c, pal, () => rr(c, -18, -9, 36, 18, 3));
    c.fillStyle = shade(pal.body, -0.2);
    rr(c, 9, -8, 9, 16, 2);
    c.fill();
    canopy(c, 15, 0, 2.2, 5);
    // Folded crane and deck hazard stripes
    c.fillStyle = '#e8c21a';
    c.fillRect(-15, -2, 22, 4);
    c.fillStyle = '#1a1a1a';
    for (let x = -15; x < 7; x += 4) c.fillRect(x, -2, 2, 4);
    c.fillStyle = '#3a3c40';
    rr(c, -16, -7, 8, 14, 2);
    c.fill();
    stripe(c, pal, -18, -9, 26, 2);
  },
  // ---- aircraft
  orca(c, pal) {
    plate(c, pal, () => poly(c, [16, 0, 6, -5, -8, -4, -14, -1.5, -14, 1.5, -8, 4, 6, 5]));
    for (const sy of [-1, 1]) {
      c.fillStyle = '#2b2d31';
      rr(c, -6, sy * 10 - 4, 12, 8, 3);
      c.fill();
      glow(c, 0, sy * 10, 3.5, '#7fe7ff');
      c.strokeStyle = shade(pal.body, -0.5);
      c.lineWidth = 2;
      c.beginPath();
      c.moveTo(-1, sy * 3);
      c.lineTo(-1, sy * 6);
      c.stroke();
    }
    canopy(c, 8, 0, 4, 2.6);
    stripe(c, pal, -12, -1, 6, 2);
  },
  carryall(c, pal) {
    // Twin-boom heavy lifter: four tilt-engines around an open cargo cradle.
    for (const sy of [-1, 1]) {
      plate(c, pal, () => rr(c, -17, sy * 7 - 2.5, 30, 5, 2.5));
      for (const x of [-11, 7]) {
        c.fillStyle = '#2b2d31';
        c.beginPath();
        c.arc(x, sy * 12, 4.5, 0, Math.PI * 2);
        c.fill();
        glow(c, x, sy * 12, 3, '#7fe7ff');
        c.strokeStyle = shade(pal.body, -0.5);
        c.lineWidth = 2;
        c.beginPath();
        c.moveTo(x, sy * 9);
        c.lineTo(x, sy * 7.5);
        c.stroke();
      }
    }
    plate(c, pal, () => poly(c, [20, 0, 13, -5, 6, -5, 6, 5, 13, 5]));
    canopy(c, 14, 0, 3.6, 2.4);
    // Cargo cradle with yellow clamps.
    c.strokeStyle = '#26282b';
    c.lineWidth = 1.5;
    c.strokeRect(-14, -4.5, 19, 9);
    c.fillStyle = '#e8c21a';
    for (const [x, y] of [
      [-14, -4.5],
      [3, -4.5],
      [-14, 2.5],
      [3, 2.5],
    ])
      c.fillRect(x, y, 2, 2);
    stripe(c, pal, -17, -9.5, 8, 1.6);
    stripe(c, pal, -17, 7.9, 8, 1.6);
  },
  cicada(c, pal) {
    for (const sy of [-1, 1]) {
      c.fillStyle = shade(pal.body, -0.15);
      poly(c, [2, sy * 3, -4, sy * 14, -9, sy * 14, -6, sy * 3]);
      c.fill();
      c.fillStyle = '#2b2d31';
      rr(c, -8, sy * 12 - 2.5, 6, 5, 2);
      c.fill();
    }
    plate(c, pal, () => rr(c, -17, -6, 34, 12, 6));
    c.fillStyle = '#26282b';
    rr(c, -6, -3, 10, 6, 1.5);
    c.fill();
    canopy(c, 13, 0, 3.5, 3.5);
    stripe(c, pal, -16, -1.2, 6, 2.4);
    for (const x of [11, -12]) {
      c.fillStyle = '#1d1e20';
      c.beginPath();
      c.arc(x, 0, 2.5, 0, Math.PI * 2);
      c.fill();
    }
  },
  harpy(c, pal) {
    c.fillStyle = shade(pal.body, -0.2);
    rr(c, -20, -1.2, 14, 2.4, 1);
    c.fill();
    c.fillStyle = '#2a2c30';
    c.fillRect(-21, -4, 2, 8);
    plate(c, pal, () => poly(c, [13, 0, 8, -4.5, -6, -4, -8, 0, -6, 4, 8, 4.5]));
    for (const sy of [-1, 1]) {
      c.fillStyle = '#26282b';
      c.fillRect(-1, sy * 5 - 1, 7, 2);
      barrel(c, 5, 6, 1.6, sy * 5);
    }
    canopy(c, 8, 0, 3.4, 2.4, '#ff8a7a');
    stripe(c, pal, -16, -1.2, 4, 2.4);
  },
  banshee(c, pal) {
    plate(c, pal, () => poly(c, [18, 0, 4, -3, -6, -15, -12, -15, -9, -3, -13, 0, -9, 3, -12, 15, -6, 15, 4, 3]));
    c.fillStyle = pal.team;
    poly(c, [-6, -15, -12, -15, -10, -11, -5, -11]);
    c.fill();
    poly(c, [-6, 15, -12, 15, -10, 11, -5, 11]);
    c.fill();
    canopy(c, 7, 0, 4, 1.8, '#5dff8a');
    glow(c, -13, -2, 2.6, '#5dff8a');
    glow(c, -13, 2, 2.6, '#5dff8a');
  },
};

/** Rotating turret parts, drawn over the body. */
const TURRET: Record<string, (c: Ctx, pal: Pal) => void> = {
  titan(c, pal) {
    plate(c, pal, () => rr(c, -8, -7, 15, 14, 4));
    canopy(c, 4, 0, 2.2, 4, pal.ember ? '#ff7a6a' : '#9fe3ff');
    barrel(c, 2, 18, 3.4, 5);
    barrel(c, 2, 8, 1.6, -5);
    stripe(c, pal, -8, -1.2, 4, 2.4);
  },
  raptor(c, pal) {
    barrel(c, 2, 16, 3);
    plate(c, pal, () => poly(c, [7, -4, 7, 4, 0, 6.5, -7, 5, -7, -5, 0, -6.5]), shade(pal.body, 0.08));
    c.fillStyle = pal.team;
    c.fillRect(-6, -1, 3, 2);
  },
  mrls(c, pal) {
    plate(c, pal, () => rr(c, -6, -6, 12, 12, 2), shade(pal.body, -0.1));
    c.fillStyle = '#18191b';
    for (let i = 0; i < 3; i++)
      for (let j = 0; j < 2; j++) {
        c.beginPath();
        c.arc(4, -3.5 + i * 3.5, 1.2, 0, Math.PI * 2);
        c.fill();
        c.beginPath();
        c.arc(1, -3.5 + j * 7, 1.2, 0, Math.PI * 2);
        c.fill();
      }
    c.fillStyle = pal.team;
    c.fillRect(-5, -1, 3, 2);
  },
  disruptor(c, pal) {
    plate(c, pal, () => {
      c.beginPath();
      c.arc(0, 0, 8, 0, Math.PI * 2);
    });
    for (const a of [-0.5, 0, 0.5]) {
      c.strokeStyle = '#3d4046';
      c.lineWidth = 2;
      c.beginPath();
      c.moveTo(Math.cos(a) * 6, Math.sin(a) * 6);
      c.lineTo(Math.cos(a) * 15, Math.sin(a) * 15);
      c.stroke();
    }
    for (const r of [5, 3]) {
      c.strokeStyle = '#7fe7ff';
      c.lineWidth = 1;
      c.beginPath();
      c.arc(0, 0, r, 0, Math.PI * 2);
      c.stroke();
    }
    glow(c, 0, 0, 3.5, '#7fe7ff');
  },
  mammoth(c, pal) {
    barrel(c, 2, 18, 3.2, -3.2);
    barrel(c, 2, 18, 3.2, 3.2);
    plate(c, pal, () => rr(c, -9, -8, 16, 16, 4), shade(pal.body, 0.05));
    for (const sy of [-1, 1]) {
      c.fillStyle = '#34363a';
      rr(c, -8, sy * 10 - 2.5, 10, 5, 1.5);
      c.fill();
      c.fillStyle = '#d33';
      for (let i = 0; i < 3; i++) c.fillRect(-7 + i * 3, sy * 10 - 1, 1.5, 2);
    }
    stripe(c, pal, -9, -1.2, 4, 2.4);
  },
};

export function bodyFrames(type: string): number {
  if (type === 'titan') return 4;
  if (type === 'termite') return 2;
  return 1;
}

export function drawBody(c: Ctx, type: string, pal: Pal, frame: number): void {
  (BODY[type] ?? BODY.raptor)(c, pal, frame);
}

export function hasTurretArt(type: string): boolean {
  return !!TURRET[type];
}

export function drawTurret(c: Ctx, type: string, pal: Pal): void {
  TURRET[type]?.(c, pal);
}

export function drawInfantryFrame(c: Ctx, type: string, pal: Pal, frame: number): void {
  drawInfantry(c, type, pal, frame);
}

/**
 * Standing three-quarter portrait for sidebar cameos (top-down infantry are
 * just helmets, so the buttons get a proper figure instead). Origin = chest.
 */
export function drawInfantryPortrait(c: Ctx, type: string, pal: Pal): void {
  const L = infLook(type, pal);
  const k = L.bulk ?? 1;
  c.save();
  c.scale(k, k);
  const armorFill = (x0: number, x1: number) =>
    lin(c, x0, 0, x1, 0, [
      [0, shade(L.armor, 0.35)],
      [0.55, L.armor],
      [1, shade(L.armor, -0.45)],
    ]);
  // Cape / jetpack behind the body
  if (L.cape) {
    c.fillStyle = shade(L.cape, -0.2);
    poly(c, [-7, -8, 7, -8, 10, 18, -10, 18]);
    c.fill();
  }
  if (L.pack === 'jet') {
    c.fillStyle = '#3a3d42';
    rr(c, -10, -9, 6, 14, 2);
    c.fill();
    rr(c, 4, -9, 6, 14, 2);
    c.fill();
    glow(c, -7, 8, 4, '#7fe7ff');
    glow(c, 7, 8, 4, '#7fe7ff');
  }
  // Legs and boots
  c.fillStyle = shade(L.armor, -0.35);
  rr(c, -6, 7, 5, 13, 1.5);
  c.fill();
  rr(c, 1, 7, 5, 13, 1.5);
  c.fill();
  c.fillStyle = '#1c1b18';
  rr(c, -7, 18, 6.5, 3.5, 1);
  c.fill();
  rr(c, 0.5, 18, 6.5, 3.5, 1);
  c.fill();
  // Torso
  c.fillStyle = armorFill(-8, 8);
  rr(c, -8, -9, 16, 18, 4);
  c.fill();
  c.strokeStyle = shade(L.armor, -0.6);
  c.lineWidth = 0.8;
  c.stroke();
  c.strokeStyle = 'rgba(0,0,0,0.25)';
  c.beginPath();
  c.moveTo(-5, -1);
  c.lineTo(5, -1);
  c.moveTo(0, -8);
  c.lineTo(0, 8);
  c.stroke();
  if (L.cross) {
    c.fillStyle = '#d42020';
    c.fillRect(-2.5, -5, 5, 1.8);
    c.fillRect(-0.9, -6.6, 1.8, 5);
  }
  if (L.pads) {
    c.fillStyle = pal.team;
    for (const x of [-8.5, 8.5]) {
      c.beginPath();
      c.ellipse(x, -7, 3.6, 2.8, 0, 0, Math.PI * 2);
      c.fill();
    }
  }
  if (L.pack === 'tools') {
    c.fillStyle = '#c75b1a';
    rr(c, -8, 6, 16, 3, 1);
    c.fill();
  }
  // Weapon held across the body
  c.save();
  c.rotate(-0.35);
  switch (L.weapon) {
    case 'rifle':
      c.fillStyle = '#1d1e20';
      c.fillRect(-10, 1, 24, 3);
      c.fillRect(-2, 3, 3, 4);
      break;
    case 'grenade':
      c.fillStyle = '#1d1e20';
      c.fillRect(-8, 2, 16, 2.6);
      c.fillStyle = '#4f5a2a';
      c.beginPath();
      c.arc(10, -6, 3, 0, Math.PI * 2);
      c.fill();
      break;
    case 'launcher':
      c.fillStyle = '#3c3f44';
      c.fillRect(-14, -12, 30, 6);
      c.fillStyle = pal.team;
      c.fillRect(13, -12, 3, 6);
      break;
    case 'sniper':
      c.fillStyle = '#1a1a1a';
      c.fillRect(-12, 1, 32, 2.4);
      c.fillRect(-1, -1.5, 7, 2);
      break;
    case 'pistol':
      c.fillStyle = '#1a1a1a';
      c.fillRect(6, 2, 8, 2.4);
      break;
    case 'chaingun':
      c.fillStyle = '#2a2c30';
      rr(c, -8, -1, 24, 7, 2);
      c.fill();
      c.fillStyle = '#5c6066';
      c.fillRect(14, 0, 6, 5);
      break;
    case 'plasma2':
      c.fillStyle = '#2a0a0a';
      c.fillRect(6, -5, 10, 3);
      c.fillRect(6, 4, 10, 3);
      glow(c, 17, -3.5, 3.5, '#ff3a3a');
      glow(c, 17, 5.5, 3.5, '#ff3a3a');
      break;
    case 'laser':
      c.fillStyle = '#b8902a';
      c.fillRect(-12, 0, 32, 4);
      glow(c, 20, 2, 4, '#ffe27a');
      break;
  }
  c.restore();
  // Arms
  c.fillStyle = shade(L.armor, -0.15);
  rr(c, -10, -6, 4, 11, 2);
  c.fill();
  rr(c, 6, -6, 4, 11, 2);
  c.fill();
  // Head, helmet, visor
  c.fillStyle = '#c99a78';
  c.beginPath();
  c.arc(0, -13, 4.3, 0, Math.PI * 2);
  c.fill();
  c.fillStyle = lin(c, -5, -19, 5, -10, [
    [0, shade(L.helmet, 0.45)],
    [1, shade(L.helmet, -0.35)],
  ]);
  c.beginPath();
  c.arc(0, -14, 5.2, Math.PI, 0);
  c.lineTo(5.2, -12.5);
  c.lineTo(-5.2, -12.5);
  c.closePath();
  c.fill();
  if (L.visor) {
    c.fillStyle = L.visor;
    c.fillRect(-4.2, -13.2, 8.4, 1.8);
    glow(c, 0, -12.3, 3, L.visor);
  }
  if (L.cross) {
    c.fillStyle = '#d42020';
    c.fillRect(-1.6, -17.5, 3.2, 1.2);
    c.fillRect(-0.6, -18.5, 1.2, 3.2);
  }
  if (L.pack === 'radio') {
    c.strokeStyle = '#111';
    c.lineWidth = 0.8;
    c.beginPath();
    c.moveTo(6, -8);
    c.lineTo(9, -22);
    c.stroke();
  }
  c.restore();
}

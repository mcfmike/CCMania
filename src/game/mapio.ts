import { TERRAIN_RGB } from '../render/terrain';
import { GameMap, ORE_PER_LEVEL, T, type MapData } from './map';

const STORAGE_KEY = 'ccmania.maps.v1';

export function parseMapJson(text: string): GameMap {
  const d = JSON.parse(text) as MapData;
  if (d.format !== 'ccmania-map') throw new Error('Not a CC Mania map file (missing "format": "ccmania-map")');
  if (!d.width || !d.height || !Array.isArray(d.terrain)) throw new Error('Map file is missing width/height/terrain');
  if (d.width < 16 || d.height < 16 || d.width > 256 || d.height > 256) throw new Error('Map size must be between 16 and 256 tiles');
  return GameMap.fromData(d);
}

export function mapToJson(m: GameMap): string {
  return JSON.stringify(m.toData(), null, 1);
}

// ------------------------------------------------------------------ PNG import / export

/** Palette for "paint a map in any image editor". Exported maps use exactly these colours. */
export const PNG_PALETTE = {
  terrain: TERRAIN_RGB,
  ore: [60, 255, 60] as [number, number, number],
  blossom: [255, 0, 255] as [number, number, number],
  start: [255, 0, 0] as [number, number, number],
};

function dist2(a: [number, number, number], r: number, g: number, b: number): number {
  return (a[0] - r) ** 2 + (a[1] - g) ** 2 + (a[2] - b) ** 2;
}

/**
 * One pixel = one tile. Nearest palette colour wins, so hand-painted images
 * with anti-aliasing still work. Red pixels become start positions, magenta
 * pixels become Veridium blossoms and bright green pixels become ore fields.
 */
export function mapFromImageData(img: ImageData, name: string): GameMap {
  const w = Math.min(256, img.width);
  const h = Math.min(256, img.height);
  const m = new GameMap(w, h);
  m.name = name;
  m.description = 'Imported from image';
  const starts: { x: number; y: number }[] = [];
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const i = (y * img.width + x) * 4;
      const r = img.data[i];
      const g = img.data[i + 1];
      const b = img.data[i + 2];
      const k = m.idx(x, y);
      const specials: [number, string][] = [
        [dist2(PNG_PALETTE.start, r, g, b), 'start'],
        [dist2(PNG_PALETTE.blossom, r, g, b), 'blossom'],
        [dist2(PNG_PALETTE.ore, r, g, b), 'ore'],
      ];
      let best = Infinity;
      let bestT = 0;
      PNG_PALETTE.terrain.forEach((c, t) => {
        const d = dist2(c, r, g, b);
        if (d < best) {
          best = d;
          bestT = t;
        }
      });
      const special = specials.sort((a, c) => a[0] - c[0])[0];
      if (special[0] < best && special[0] < 6000) {
        m.terrain[k] = T.Grass;
        if (special[1] === 'start') starts.push({ x, y });
        else if (special[1] === 'blossom') {
          m.blossoms.push({ x, y });
          m.ore[k] = 6 * ORE_PER_LEVEL;
        } else m.ore[k] = 7 * ORE_PER_LEVEL;
        m.oreField[k] = m.ore[k] > 0 ? 1 : 0;
      } else m.terrain[k] = bestT;
    }
  }
  // Merge clusters of start pixels into single starts.
  for (const s of starts) if (!m.starts.some((o) => Math.abs(o.x - s.x) <= 4 && Math.abs(o.y - s.y) <= 4)) m.starts.push(s);
  m.starts = m.starts.slice(0, 4);
  // Bases need room: clear a pad around each start.
  for (const s of m.starts)
    for (let dy = -2; dy <= 2; dy++)
      for (let dx = -2; dx <= 2; dx++)
        if (m.inBounds(s.x + dx, s.y + dy)) {
          const k = m.idx(s.x + dx, s.y + dy);
          if (m.terrain[k] !== T.Concrete) m.terrain[k] = T.Dirt;
          m.ore[k] = 0;
        }
  return m;
}

export function mapToImageData(m: GameMap): ImageData {
  const img = new ImageData(m.w, m.h);
  for (let i = 0; i < m.w * m.h; i++) {
    let c = PNG_PALETTE.terrain[m.terrain[i]];
    if (m.ore[i] > 0) c = PNG_PALETTE.ore;
    img.data.set([c[0], c[1], c[2], 255], i * 4);
  }
  const put = (x: number, y: number, c: [number, number, number]) => {
    if (m.inBounds(x, y)) img.data.set([c[0], c[1], c[2], 255], m.idx(x, y) * 4);
  };
  for (const b of m.blossoms) put(b.x, b.y, PNG_PALETTE.blossom);
  for (const s of m.starts) put(s.x, s.y, PNG_PALETTE.start);
  return img;
}

// ------------------------------------------------------------------ browser storage

export interface StoredMap {
  name: string;
  savedAt: number;
  json: string;
}

export function listStoredMaps(): StoredMap[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    return raw ? (JSON.parse(raw) as StoredMap[]) : [];
  } catch {
    return [];
  }
}

export function storeMap(m: GameMap): boolean {
  try {
    const maps = listStoredMaps().filter((s) => s.name !== m.name);
    maps.unshift({ name: m.name, savedAt: Date.now(), json: JSON.stringify(m.toData()) });
    localStorage.setItem(STORAGE_KEY, JSON.stringify(maps.slice(0, 50)));
    return true;
  } catch {
    return false;
  }
}

export function deleteStoredMap(name: string): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(listStoredMaps().filter((s) => s.name !== name)));
  } catch {
    // Storage unavailable; nothing to delete.
  }
}

export function download(filename: string, data: Blob): void {
  const a = document.createElement('a');
  a.href = URL.createObjectURL(data);
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 2000);
}

export function readFile(file: File): Promise<{ text?: string; image?: ImageData }> {
  return new Promise((resolve, reject) => {
    if (file.type.startsWith('image/') || /\.(png|gif|bmp|webp)$/i.test(file.name)) {
      const img = new Image();
      img.onload = () => {
        const c = document.createElement('canvas');
        c.width = img.width;
        c.height = img.height;
        const ctx = c.getContext('2d')!;
        ctx.drawImage(img, 0, 0);
        resolve({ image: ctx.getImageData(0, 0, img.width, img.height) });
        URL.revokeObjectURL(img.src);
      };
      img.onerror = () => reject(new Error('Could not read image'));
      img.src = URL.createObjectURL(file);
    } else {
      file.text().then((text) => resolve({ text }), reject);
    }
  });
}

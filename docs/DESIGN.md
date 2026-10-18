# CC Mania — design notes

## 1. Engine choice

The brief: a single-player homage to Command & Conquer, made as over-the-top as possible.

| Option | Strengths | Why it wasn't picked |
| --- | --- | --- |
| **OpenRA** (C#, GPLv3) | Already *is* a C&C engine: pathfinding, fog, sidebar, map editor, Lua missions. | You'd be modding someone else's engine and inheriting its GPL licence, its SHP/palette art pipeline and its limits. The result reads as "a C&C mod" rather than an homage of our own. Players have to download it. |
| **Godot 4** | Strong general-purpose engine with a built-in TileMap editor; exports to desktop and web. | Every RTS system (hundreds of units pathing at once, fog of war, production queues, AI) still has to be written by hand. Web exports weigh tens of MB, and the game is hard to test headlessly in CI. |
| **Unity / Unreal** | Industrial tooling. | Far more engine than a 2D RTS needs, plus licence terms and a heavy toolchain. |
| **Custom TypeScript + Canvas 2D** ✅ | Nothing to install: it runs in any browser and can be shared as a link on GitHub Pages. Single player means no lockstep netcode, so the browser is plenty. We control every system, which is what makes 1,500-unit battles and chain-reaction explosions possible. | We write the engine ourselves. That's fine, because a 2D RTS needs only a small engine and it is all game-specific code anyway. |

**Decision: a custom TypeScript engine on HTML5 Canvas, built with Vite.** Supporting points:

- **Everything is code.** Sprites are drawn procedurally (`src/render/sprites.ts`) and sound and music are synthesised with WebAudio (`src/audio/audio.ts`). There's no asset pipeline and no licensing grey area, and the whole game is about 60 KB gzipped.
- **The simulation doesn't touch the DOM.** `src/game/` runs fine under Node, so the vitest suite plays full AI-vs-AI games headlessly. That keeps balance and AI regressions testable.
- **Room to move later.** Because the sim and the renderer are separate, the renderer could be swapped for PixiJS/WebGL if we ever want shaders, and the whole thing can be wrapped in Tauri or Electron for a desktop build.

### Architecture

```
src/game/      deterministic simulation (no DOM)
  world.ts       entities, orders, combat, economy, production, superweapons
  pathfinding.ts flow fields (one Dijkstra per destination serves the whole group)
  ai.ts          skirmish AI: build order, harvesting, defence, escalating waves
  onslaught.ts   survival mode wave director
  mapgen.ts      procedural, symmetry-aware map generator
  mapio.ts       JSON / PNG import-export, browser storage
src/render/    canvas renderer, chunked terrain, particles, procedural sprites
src/audio/     synthesised SFX, dynamic music, EVA announcer (speech synthesis)
src/ui/        title (live demo battle), skirmish setup, in-game HUD, map editor
maps/          hand-made JSON maps (auto-listed as built-ins)
```

The sim runs at a fixed 30 ticks per second. In testing, a 4-player insane MANIA game with about 450 units cost around 2.5 ms per tick.

## 2. Map creation options

Six ways to make a battlefield, from zero effort to full control. **1–4 are built**; 5–6 are suggested next steps.

### 1. Procedural generator (built)
`Skirmish → Random`, or `Map Editor → Generate`.
- Parameters: size (64–200), seed, 2–4 players, symmetry (rotational, mirror, 4-way, none), water, cliffs, forest and Veridium richness.
- Every edit goes through the symmetry, so mirrored maps are fair to every player.
- It guarantees that every base can drive to every other base, carving fords and passes where needed.
- Seeds are deterministic: share a seed and you share the map. The "built-in" generated maps are just curated presets (`BUILTIN_MAPS` in `mapgen.ts`).

### 2. In-game map editor (built)
`Main menu → Map Editor`.
- Brushes for the 7 terrain types, flood fill, a Veridium density brush (0–9), Veridium blossoms, start positions, and pre-placed units and structures for any player.
- **Live symmetry painting**: mirror left/right, mirror top/bottom, 4-way, or 180° rotation. Paint one side and the others follow.
- Undo and redo (Ctrl+Z / Ctrl+Y), grid, zoom and pan, minimap.
- **▶ Play test** drops you straight into a game on the map.
- Save to the browser, export and import JSON, export and import PNG.

Suggested workflow: generate a starting point, then fix it up in the editor with symmetry on, then play-test, then export the JSON.

### 3. Paint a PNG in any image editor (built)
One pixel is one tile. Import it from `Skirmish → Import` or the editor's `⬆ Import` button. The nearest palette colour wins, so anti-aliased brushes still work.

| Paint this | Colour |
| --- | --- |
| Grass | `#4a7c34` |
| Dirt | `#7c6240` |
| Sand | `#ceb882` |
| Rock / cliff (impassable) | `#706a62` |
| Water (impassable) | `#24528c` |
| Trees (block vehicles, not infantry) | `#284c20` |
| Concrete | `#969692` |
| Veridium ore | `#3cff3c` |
| Veridium blossom | `#ff00ff` |
| Start position | `#ff0000` |

The editor's `⬇ PNG` button exports a map in exactly this palette, so you can round-trip a map through Photoshop, Aseprite or GIMP.

### 4. Hand-write / version-control JSON (built)
Maps are plain JSON with **ASCII rows**, so they diff nicely in git and can be edited in any text editor:

```jsonc
{
  "format": "ccmania-map", "version": 1,
  "name": "River Fortress", "author": "you", "description": "…",
  "width": 64, "height": 64,
  "terrain": ["gggrrrwwwss…", "…"],   // g grass, d dirt, s sand, r rock, w water, t trees, c concrete
  "ore":     ["0000099990…", "…"],    // Veridium density per tile, 0-9
  "starts":   [{ "x": 10, "y": 32 }, { "x": 53, "y": 32 }],
  "blossoms": [{ "x": 22, "y": 14 }],
  "entities": [{ "kind": "building", "type": "guard", "owner": 0, "x": 20, "y": 29 }]
}
```

**Any `.json` file dropped into `/maps` shows up automatically as a built-in map**, and the test suite checks that it parses, that every start can reach every other, and that a game actually runs on it. `maps/river-fortress.json` is a worked example.

### 5. Tiled (mapeditor.org) importer (suggested)
Use this if you want tile-art-driven maps with layers, stamps and Wang autotiling. It would need a 7-tile tileset PNG (one tile per terrain type), a converter that reads a Tiled `.tmj` tile layer named `terrain` and an object layer for starts, blossoms and units, and an `ore` layer. About 100 lines in `mapio.ts`. It's left out for now because options 2 and 3 already cover the same ground without an extra tool.

### 6. "Describe a map" with Claude (suggested)
Because the format is ASCII, a language model can write maps directly: *"a 4-player map with a volcanic crater in the middle and a river on each edge"*. You could wire this into the editor through the Claude API, which returns JSON, then validate it with the same checks as the `/maps` tests.

## 3. What makes it "insane"

- **MANIA mode**: triple build speed, double income, 60-second superweapons, a starting army for everyone, and buildings that explode in chain reactions. Big splash weapons hit friends as well.
- **☠ INSANE AI**: double build speed and income, attacks within about 2.5 minutes, waves that grow by 5 units each time, and it uses its superweapon.
- **"Make it insane" button**: every free start slot becomes an insane AI, all of them against you, with MANIA turned on.
- **Onslaught survival**: endless waves from the map edges, a boss wave every 5th wave, a nuclear strike every 10th wave, and veteran enemies from wave 8.
- **Up to 1,500 units** per player in MANIA, kept cheap by flow-field pathfinding.
- **Superweapons**: an orbital ion cannon and a nuclear missile, with full-screen flash, shockwaves and mushroom clouds.
- **Classic touches**: tanks crush infantry; the EVA voice announces "Construction complete" and "Our base is under attack"; veterancy chevrons; selling a structure spawns survivors; engineers capture buildings; the commando plants C4; the stealth tank cloaks; the radar needs a Comm Center and power.
- **Dynamic soundtrack**: a procedural industrial loop that adds distorted power chords as the fighting heats up.
- **The title screen** is a live insane-vs-insane AI battle.

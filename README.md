# CC Mania

**A single-player real-time strategy homage to Command & Conquer.** Build a base, harvest glowing Veridium crystals, raise an army and flatten the enemy, or survive an endless Onslaught. It runs in the browser with nothing to install, and every sprite, sound and music track is generated in code.

> Fan-made tribute. Not affiliated with Electronic Arts or Westwood Studios.

## Quick start

```bash
npm install
npm run dev        # http://localhost:5173
```

Other scripts: `npm test` (headless AI-vs-AI simulation tests), `npm run typecheck`, `npm run build` (static site in `dist/`), `npm run preview`.

To publish on GitHub Pages: go to Settings → Pages → Source: **GitHub Actions**, then run the **Deploy to GitHub Pages** workflow.

## What's in the box

- **Two factions**, styled after the classic desert-gold vs black-and-red rivalry:
  - **Vanguard Accord** (gold camo): Light Infantry, Grenadier, Medic, Jumpjet, Ghost, hero **Vega**; Badger, Repair Bot, Titan walker, Hover MRLS, Disruptor sonic tank, Mammoth Tank; Orca VTOL and Cicada Bomber; Ion Cannon, Rocket Bastion.
  - **Order of the Ember** (black and red): Light Infantry, Dragoon, Cyborg, Tactician, hero **Ankha**; Raider, Armored APC, Termite Mine, Raptor Tank, Artillery, Mobile ECM, Stealth Tank, Inferno Flametank; Harpy gunship and Banshee Fighter; Doom Silo nuke, Spire of Light.
  - Both: Engineer, Harvester, Mobile Sensor Array (reveals cloaked units), M.C.V. (press `D` to deploy a new base).
- **Air war**: aircraft fly over terrain and can only be hit by anti-air weapons (rockets, machine guns, missiles); hover units cross water.
- **The C&C formula**: Construction Yard, power, refinery and harvesters, barracks, war factory, Comm Center radar, tech center, walls, sell and repair, rally points, veterancy, tank-crushes-infantry, engineers capturing buildings, commando C4.
- **Modes**:
  - **Skirmish** against 1–3 AIs (Easy, Normal, Hard, ☠ Insane), as everyone vs you, free-for-all, or with an AI ally.
  - **Onslaught**: survive endless escalating waves.
- **MANIA mode**: 3× build speed, 2× income, 60-second superweapons, starting armies, chain-reaction explosions, up to 1,500 units each.
- **Map making**: procedural generator, a full in-game editor with live symmetry painting and play-testing, PNG import and export, hand-editable ASCII JSON, and drop-in maps in [`/maps`](maps).
- **Audio**: synthesised weapons and explosions, an EVA-style announcer (browser speech synthesis), and a dynamic industrial soundtrack.

See [docs/DESIGN.md](docs/DESIGN.md) for the engine decision, the architecture and the full guide to map creation options.

## Controls

| Input | Action |
| --- | --- |
| Left click / drag | Select units |
| Right click | Move, attack, harvest, or set a rally point (with a factory selected) |
| Right / middle drag, arrows, screen edge | Pan |
| Mouse wheel | Zoom |
| Double-click / `E` | Select all units of that type on screen |
| `Ctrl+1-9` / `1-9` | Assign / recall a control group (tap twice to jump to it) |
| `A` | Attack-move |
| `S` / `X` | Stop / scatter |
| `Q` / `R` | Sell / repair mode |
| `N` | Fire superweapon |
| `D` | Deploy M.C.V. |
| `H` / `Space` | Jump to base / last alert |
| `Tab` | Cycle build tabs |
| `+` / `-` | Game speed |
| `M` | Toggle music |
| `Esc` / `P` | Cancel / pause menu |

Sidebar: left-click a cameo to build it (Shift+click queues 5), and right-click to put it on hold or cancel. When a structure says **READY**, click it and then place it on the map.

## Project layout

```
src/game     simulation: world, AI, flow-field pathfinding, map generator, map I/O, Onslaught
src/render   canvas renderer, chunked terrain, particles, procedural sprites
src/audio    WebAudio SFX + music, EVA voice
src/ui       title screen, skirmish setup, in-game HUD, map editor
maps/        hand-made JSON maps (auto-listed as built-ins, validated by the tests)
tests/       headless simulation and map tests (vitest)
```

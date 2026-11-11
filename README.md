# FORZA HORIZON 6 — Unofficial Fan Tribute

An open-world arcade-sim racing game that runs in a browser tab, built with vanilla JavaScript ES modules and Three.js. It's also packaged as an Android APK. Everything is generated in code: the island, roads, cars, textures, engine sounds, music and UI. There are no asset downloads and no build step.

> **Disclaimer:** This is a non-commercial fan project made as a tribute. It is not affiliated with, endorsed by, or connected to Microsoft, Xbox Game Studios, Playground Games or the Forza franchise. All car makes and models are fictional parodies, and "Forza Horizon" is a trademark of its owners.

## Play it

- **Desktop browser:** serve the folder with any static server, for example `python3 -m http.server`, then open `http://localhost:8000/`. Browsers block ES modules from `file://`, so opening the file directly won't work. Three.js loads from unpkg, and online play loads PeerJS on demand.
- **Android:** download `FH6-Fan-Tribute.apk` from the latest [GitHub Release](../../releases), allow "Install unknown apps", and install it (Android 8.0 or newer). Three.js and PeerJS are bundled inside the APK, so single-player works fully offline.

## Architecture plan

The game is split into five files, each a plain ES module.

- `data.js` holds the pure data and maths: 389 procedurally specified cars and bikes, engine firing orders, tyre compounds, the upgrade and tuning model, the PI/class calculator, event types and drivatar names.
- `sim.js` holds the simulation side:
  - a raycast-wheel vehicle with Pacejka-style tyre curves, load transfer, aero, drivetrain, gearbox, clutch, differentials, damage and assists
  - world and vehicle collision
  - the unified keyboard, mouse, Gamepad API and touch input layer with remapping
  - the Web Audio engine synthesizer, which builds each engine sound from its cylinder count and firing order
- `world.js` builds the 8 km × 8 km island:
  - a noise-based heightfield with six biomes
  - a road graph of about 97 km with splined meshes
  - chunk streaming with LOD and instanced vegetation
  - landmarks, destructibles, AI traffic and seasons
  - day/night, weather and post-processing
  - procedural low-poly car models with liveries
- `game.js` holds the orchestration:
  - a fixed 120 Hz physics loop decoupled from rendering, with interpolation, capped at 8 sub-steps
  - cameras, the HUD and minimap
  - events and AI drivatars, skill chains, PR stunts and progression
  - every menu screen through one controller-navigable UI stack
  - photo mode, replay and rewind
  - save slots
  - netcode over BroadcastChannel and WebRTC
- `index.html` contains the CSS, the HUD DOM and the boot and fallback scripts.

### Netcode

- **Host-authoritative:** the host validates every client state. It snaps clients back if they're impossibly fast or teleporting, and it owns event start, finish and results.
- **Bandwidth:** clients send 28-byte quantized binary entity snapshots at 20 Hz. This keeps it at about 0.5 kB/s per peer.
- **Smoothing:** remote cars render 100 ms in the past with interpolation, plus short extrapolation if packets go missing.
- **Prediction:** the local player is predicted and reconciled against host corrections.
- **Transports:** same-device tabs connect instantly over BroadcastChannel. Remote players connect over WebRTC data channels, using the public PeerJS signalling relay with room codes `fh6t-room-<CODE>`. The lobby browser uses well-known slots `fh6t-lobby-0..15`.
- **Fallback:** if WebRTC or the relay is blocked, the game switches to Ghost Leaderboard mode instead of showing an error.

## Feature overview

- **Driving:** 120 Hz physics, per-wheel slip, surface grip (tarmac, gravel, dirt, sand, snow, mud, water), kerbs, jumps, drafting, visual and mechanical damage, ABS, TCS and STM, manual and manual-with-clutch shifting, and the rewind assist.
- **Cars:** 389 vehicles across 15 categories, including hypercars, rally cars, trucks, EVs, drift cars, retro cars and motorcycles. Each has full upgrade trees covering engine swaps, forced induction, tyres, aero and more. Tuning covers tyre pressure, gearing, alignment, springs, damping, anti-roll bars, aero, brakes and differentials. The livery editor offers paint finish, primary and secondary HSL colour, decals, rims and tint.
- **World:** six biomes, about 97 km of streamed roads, AI traffic, smashables, a day/night cycle, dynamic weather, a weekly season rotation, a minimap, a full map with fast travel, and GPS routing.
- **Progression:**
  - 33 events across road, dirt, cross-country, street, stadium, drag, drift, Horizon Arcade and Showcase
  - speed traps, speed zones, drift zones, danger signs and trailblazers
  - barn finds, skill chains, car mastery, wheelspins and super wheelspins
  - the Autoshow, the auction house and seasonal championships
  - accolades, photo mode with an album, replays, and character and festival customization
- **Online:**
  - host or join with a room code, or pick a lobby from the browser
  - convoys, online races, drift trains and co-op showcases
  - quick-chat radial, horns, nameplates, voice and talk indicators, and ghost mode
  - ghost leaderboards
- **Controls:**
  - keyboard and mouse
  - any standard gamepad, with hot-swap and rumble
  - touch controls with optional tilt steering
  - full remapping
- **Settings:**
  - quality presets, including a Low preset for integrated GPUs, adaptive resolution that targets 45+ FPS, and a performance overlay (F3)
  - HUD toggles
  - accessibility options: colour-blind palettes, reduced flashing, subtitles and UI scale
  - three autosaving slots with JSON export and import

## Controls

| Action | Keyboard | Gamepad |
|---|---|---|
| Throttle / Brake | W / S (or arrows) | RT / LT |
| Steer | A / D (or arrows) | Left stick |
| Handbrake / Clutch | Space / Left Shift | A / LB |
| Shift up / down | E / Q | B / X |
| Change camera / Look back | C / B | RB / RS |
| Rewind | R | Y |
| Reset car | Backspace | D-pad right |
| Map / Pause | M / Esc | View / Menu |
| Photo mode / Instant replay | P / Y | D-pad left / — |
| Horn / Headlights / Quick chat | H / L / T | LS / D-pad down / D-pad up |
| Set GPS to nearest event | G | — |
| Start event at a beacon | Enter | Y |
| Performance overlay / Help | F3 / F1 | — |
| Touch (phones/tablets) | On-screen pedals, steer buttons or tilt, and a top bar for menu, map, camera, reset, horn, chat and photo | |

The in-game Help panel (F1 or Pause → Help) lists the live bindings, including any you remap.

## Build log (decisions)

1. **Single file vs. modules.** At about 560 KB of code, one file was unwieldy, so the game ships as `index.html` plus four sibling modules (5 files total).
2. **Physics.** The fixed 120 Hz step is capped at 8 sub-steps per frame, and any leftover backlog is dropped instead of spiralling. Rendering interpolates between the last two physics states.
3. **World scale.** The island is 8 × 8 km with streamed 256 m chunks. The Low preset uses a shorter draw distance, no shadows or post-processing, less traffic and 60% resolution.
4. **"Several hundred cars."** These are generated from about 130 hand-specified base rows plus trim, era and tuner variants. That gives 389 cars, each with its own specs and a procedurally built model.
5. **Signalling.** A public relay is required for internet WebRTC, so the game uses the free PeerJS cloud server. No API key is needed. If it's unreachable, the game falls back to the ghost leaderboard.
6. **Authority.** Lobbies are host-authoritative, because no dedicated server is allowed. The host validates client states and owns event results.
7. **APK.** The APK is a minimal Java WebView shell. It serves the game from assets through `WebViewAssetLoader` at a secure `https://appassets.androidplatform.net` origin, so ES modules, localStorage, WebRTC and gamepads work. A small JS bridge saves exports and photos to Downloads and Pictures. The Android back button maps to Esc. GitHub Actions builds the APK and attaches it to a release.
8. **Testing.** Testing used headless Chromium with SwiftShader. It covered:
   - boot, a new save, the intro, and choosing a starter car
   - driving, the first event, results and credits
   - upgrades, tuning, livery and wheelspin
   - Autoshow purchases, photo mode, replay and the map
   - Arcade events, quit to title, and reloading the save
   - two-client multiplayer over BroadcastChannel and over real WebRTC between two separate browser processes
   - a mobile and touch layout at 915 × 412

   The test runs logged zero console errors.

## Repository layout

```
index.html, game.js, sim.js, world.js, data.js   ← the game
android/                                          ← WebView shell (Gradle, AGP 8.5)
.github/workflows/android.yml                     ← CI: bundles assets, builds APK, publishes release
```

# OpenTower Architecture

OpenTower is a deterministic, single-page air traffic control simulation that
runs entirely in the browser. There are no LLM agents, no backend and no
service layer.

This document describes the module boundaries enforced by the v1.1.0 release
refactor. The rules are covered by `tests/architecture.test.mjs`.

## Layer map

| Layer | Files | Responsibility | May import |
| ----- | ----- | -------------- | ---------- |
| 1. Shell / platform | `index.html`, `styles.css`, `manifest.webmanifest`, `sw.js`, icons | Markup, layout, PWA install, offline cache, update flow | none |
| 2. Composition root | `src/main.js` | Instantiates concrete engines/renderers and starts the app | layers 3, 4, 5 |
| 3. UI orchestration | `src/ui.js`, `src/i18n.js`, `src/voice.js` | DOM wiring, render loop, strips, radio log, language, TTS/STT | layers 1, 4, 5, 6 |
| 4. Domain data and rules | `src/config.js`, `src/airport.js`, `src/phraseology.js`, `src/scenarios.js`, `src/scenario-state.js`, `src/weather.js` | Aircraft/airport data, taxi geometry, intent parser, scenarios, METAR | `config.js` |
| 5. Simulation engines | `src/engine.js`, `src/tracon.js` (`TraconEngine`) | Time, movement, clearances, conflicts, separation, scoring | layer 4 |
| 6. Presentation | `src/scope-renderer.js` (`ScopeRenderer`), `src/render.js` (`Renderer`), `src/tracon-renderer.js` (`TraconRenderer`) | Shared canvas projection, tower drawing, approach drawing | layer 4 |

## Enforced boundaries

- **`main.js` is a composition root.** It only wires `SimEngine`/`TraconEngine`
  and `Renderer`/`TraconRenderer` into `createApp()`. It contains no DOM code,
  no event listeners and no simulation logic.
- **`TraconEngine` is DOM-free.** `src/tracon.js` imports only domain modules
  and never references `document`, `window`, a canvas or `getContext`.
  `TraconRenderer` lives in `src/tracon-renderer.js`.
- **Both scopes share one projection.** `ScopeRenderer` owns the constructor,
  resize, projection, clamping and hit-testing. `Renderer` uses a top-left
  origin with `y` growing downward; `TraconRenderer` uses a north-up origin with
  `y` growing upward. Neither subclass copies the base methods.
- **Language state is isolated.** `i18n.js` owns the dictionary, translator
  factory, static-DOM application and `applyLanguage()`. `ui.js` supplies the
  callback that refreshes live strips, radio, weather and speech.
- **Voice is injectable.** `voice.js` keeps the pure speech helpers and adds
  `VoiceController`, which owns SpeechRecognition, TTS, the mic/voice buttons and
  the toast. It receives its document, engine and language getter from `ui.js`.
- **Engines and renderers are injected.** `ui.js` never imports a concrete
  engine or renderer. `main.js` chooses the pair for tower or TRACON mode.

## Data flow

```
keyboard / Web Speech
        |
        v
phraseology.parseInstruction()  ->  intent
        |
        v
SimEngine.command() / TraconEngine.command()
        |
        v
aircraft state  ->  Renderer / TraconRenderer  ->  canvas
        |
        v
scoring + debrief  ->  localStorage (best score)
```

The simulation advances on a fixed-step tick driven by `ui.js`; rendering is a
separate `requestAnimationFrame` loop. This keeps physics independent of frame
rate and lets the user change simulation speed without breaking determinism.

## Tests

- `tests/*.test.mjs` are dependency-free Node tests for engines, parser,
  geometry, i18n, scenario state, voice helpers, the voice controller and the
  architecture boundaries.
- `tests/smoke.spec.js` runs Chromium through Playwright. It boots the real
  page, starts a shift, spawns aircraft, issues a vector, clears an ILS,
  hands off to tower and lands an arrival in the tower scope.
- `tests/mobile.spec.js` verifies the 320 px portrait and short-landscape
  layouts, the STRIPS/RADIO tabs, touch targets and the in-viewport CTA.
- `tests/pwa.spec.js` reloads the app with the browser offline to prove the
  service-worker shell works. `tests/pwa.test.mjs` checks asset/cache integrity.
- `npm test` runs the Node suite. `npm run test:e2e` runs the browser suite.
  CI runs both.

## Regenerating the graph

```bash
graphify .              # writes graphify-out/graph.html, graph.json, GRAPH_REPORT.md
```

Do not commit `graphify-out/`; it contains local machine paths. The graph is a
useful post-refactor check for new import cycles and accidental god objects.

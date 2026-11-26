# OpenTower Architecture

This document describes the architecture that the code actually implements, as
verified against the Graphify knowledge graph on 2026-11-26 (commit `82b06bc`).
It replaces any assumption that OpenTower is a multi-agent system: it is not.
There are no LLM agents, no backend and no service layer. It is a deterministic,
single-page simulation that runs entirely in the browser.

## Layer map

| Layer | Files | Responsibility | May import |
| ----- | ----- | -------------- | ---------- |
| 1. Shell / platform | `index.html`, `styles.css`, `manifest.webmanifest`, `sw.js`, icons | Markup, layout, PWA install, offline cache, update flow | none |
| 2. UI orchestration | `src/main.js`, `src/i18n.js`, `src/voice.js` | DOM wiring, render loop, strips, radio log, language, TTS/STT | layers 1, 3, 4, 5 |
| 3. Domain data and rules | `src/config.js`, `src/airport.js`, `src/phraseology.js`, `src/scenarios.js`, `src/scenario-state.js`, `src/weather.js` | Aircraft/airport data, taxi geometry, intent parser, scenarios, METAR | `config.js` |
| 4. Simulation engines | `src/engine.js`, `src/tracon.js` (`TraconEngine`) | Time, movement, clearances, conflicts, separation, scoring | layers 3 |
| 5. Presentation | `src/render.js` (`Renderer`), `src/tracon.js` (`TraconRenderer`) | Canvas projection and drawing | layers 3 |

`src/main.js` is the composition root. It is the only module that wires the
engines, renderers, i18n and voice together, and it owns all DOM access. That
high fan-out is expected for a composition root, not a layering violation.

## Verified import rules

- **No import cycles.** Graphify reports `Import Cycles: None detected`.
- `src/engine.js` imports only `config.js`, `phraseology.js` and `weather.js`.
  It does not touch `document`, `window` or a canvas.
- `src/render.js` imports `config.js` and `airport.js`; it receives the engine
  through `setEngine()` instead of importing it. Rendering does not own state.
- `src/tracon.js` contains both `TraconEngine` (DOM-free) and `TraconRenderer`
  (canvas and `window`). This is a known structural compromise, documented
  below.
- `src/config.js` is the shared data hub (7 importers). It holds constants and
  pure geometry helpers, so the coupling is deliberate and cheap.
- Dark launch and weather are the only outbound requests; there is no backend.

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

The simulation advances on a fixed-step tick driven by `main.js`; rendering is a
separate `requestAnimationFrame` loop. This keeps physics independent of frame
rate and lets the user change simulation speed without breaking determinism.

## Graph snapshot

Rebuilt with `graphify .` (AST for code, semantic extraction for `README.md` and
`index.html`); `graphify-out/` is git-ignored because it contains local paths.

- 352 nodes, 755 edges, 13 communities, 0 import cycles.
- God nodes: `SimEngine` (48 edges), `TraconEngine` (33), `startShift()` (22),
  `Renderer` (20), `TraconRenderer` (16), `applyLanguage()` (14), `tr()` (12).
- `SimEngine` and `TraconEngine` are the cross-community bridges: every mode
  routes through them.
- Surprising but healthy edges: tests import the real engines (`makeEngine()` →
  `SimEngine`/`TraconEngine`), and `main.js` composes the engine directly
  (`startShift()` → `SimEngine`).
- The weakest communities are "UI Orchestration, i18n and Voice" (cohesion 0.05)
  and "Core Modules and Tests" (0.07). This reflects `main.js` being a large
  composition root, not a missing dependency.
- The 8 isolated nodes are documentation concepts (license, browser matrix,
  scope limits), not orphaned code.

## Known technical debt

| Item | Severity | Decision |
| ---- | -------- | -------- |
| `TraconRenderer` lives in `tracon.js` next to the engine | Medium | Accepted for 1.0.0; the engine class itself stays DOM-free. A future `tracon-render.js` split is a follow-up, not a release blocker. |
| `Renderer` and `TraconRenderer` repeat constructor, `sx`, `pick` and resize boilerplate | Low | Accepted. Their coordinate systems differ (`y` grows down in the tower scope and up in the radar), so a shared base class would couple two unrelated projections for little gain. |
| `main.js` is ~1,100 lines | Medium | Accepted. It is the composition root; extract modules only with browser-level regression tests, which the project does not yet have. |
| No browser/E2E tests for canvas rendering | Medium | Known gap. Logic is covered by Node tests; rendering is verified manually. |

None of these items affect the public contract, security or determinism of the
simulator. They are listed so contributors do not mistake the graph's low
cohesion scores for an emergency.

## Regenerating the graph

```bash
graphify .              # writes graphify-out/graph.html, graph.json, GRAPH_REPORT.md
```

Do not commit `graphify-out/`. Use the graph to check for new import cycles and
to confirm that `SimEngine` and `TraconEngine` remain the only god nodes.

# Changelog

All notable changes to OpenTower are documented here.

The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/) and
this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [1.1.0] - 2026-11-28

### Added

- Mobile-first layout: a collapsible side panel with **STRIPS / RADIO** tabs,
  compact radar labels, a compact final-approach readout, larger touch targets,
  16 px command input and a primary CTA that stays above the fold on short
  phones.
- Playwright coverage for 320×568 portrait, short landscape, i18n switching,
  PWA offline reload and the full tower/TRACON loops.
- PWA asset integrity test that verifies every `src/*.js` module and manifest
  icon is cached by the service worker.
- Regression tests for multi-aircraft conflict flags, TRACON separation rings,
  go-around visibility, short-final separation and whole-number debrief counts.
- Accessible labels for the scenario selector, side-panel tabs and radio/strip
  regions, plus reduced-motion and focus-visible styles.

### Changed

- Replaced real airline names/codes and manufacturer names in the game data
  with fictional equivalents. ICAO aircraft type designators remain standard.
- A departure now needs 1.5 NM of final separation before a takeoff or line-up
  clearance, instead of 0.5 NM.
- Ground/Tower radio entries use the actual transmission frequency instead of
  labelling every tower-mode call as TWR.
- The debrief reports whole aircraft counts; fractional denominators are gone.
- Removed unused tower safety categories (`air`, `lowAlt`, `unresolved`) so the
  score no longer promises checks the tower engine does not perform.
- The start button now reflects the selected scenario, and the scenario
  description refreshes when the language changes.
- The command placeholder and tutorial use the active mode/runway instead of a
  hard-coded runway 27.
- Refreshed the public screenshots and demo GIF with the fictional traffic and
  current mobile/desktop UI.

### Fixed

- Multi-aircraft ground conflicts no longer lose their red conflict flags when
  a later pair is clear.
- TRACON separation losses now mark both targets and draw a red conflict ring.
- Go-arounds remain visible on the TRACON scope while they climb out.
- The mobile final inset no longer covers the airport; it is replaced by a
  compact final-distance readout.
- The primary CTA is visible without scrolling on 320×568 and short landscape.
- Spanish language switching no longer leaves the scenario description stale.

### Security

- GitHub's merged PR #1 hidden ref and cached commit views still contain the old
  analysis document. GitHub Support must dereference the PR and run server-side
  garbage collection; `git-filter-repo` cannot delete `refs/pull/*`.

## [1.0.0] - 2026-11-28

### Added

- Tower and Ground simulation at the fictional Copper Mesa (KXCM) airport.
- Active runway 09/27, inactive runway 12/30 and the north-ramp crossing.
- Approach (TRACON) mode with vectors, descent, ILS, go-around and handoff.
- Deterministic seeded traffic, local pilot "brain" and ATC phraseology parser.
- English and Spanish radio, readbacks, quick replies and phonetic alphabet.
- Local text-to-speech and browser speech-recognition fallback.
- Live KPHX METAR from the National Weather Service with simulated fallback.
- Shift scoring (Safety 40 / Communication 30 / Traffic 30) and debrief.
- Six built-in scenarios and per-scenario best scores in `localStorage`.
- Installable offline PWA with controlled service-worker cache updates.
- Playwright Chromium smoke test covering shift start, spawning, vectors, ILS
  clearance, tower handoff and touchdown.
- `CONTRIBUTING.md`, `CODE_OF_CONDUCT.md`, `SECURITY.md` and this changelog.
- `docs/ARCHITECTURE.md` with the enforced module boundaries.
- `tests/architecture.test.mjs` to keep engines DOM-free, prevent duplicated
  renderer projection code and keep `main.js` a thin composition root.
- Explicit `npm run lint`, `npm test`, `npm run test:e2e` and `npm run test:all`
  scripts, plus a CI browser-smoke job.

### Changed

- Split `TraconRenderer` out of `tracon.js` into `src/tracon-renderer.js`, so
  `TraconEngine` is fully DOM-free.
- Added `src/scope-renderer.js` and removed duplicated constructor, `resize`,
  `sx`, `sy`, `pick` and hit-testing code from both radar renderers.
- Split the former 1,100-line `main.js` into `src/ui.js` (UI/game loop),
  `src/i18n.js` (language runtime), `src/voice.js` (voice controller) and a
  ~20-line composition root in `src/main.js`.
- `package.json` now declares repository, homepage, bugs, keywords and Node
  engine metadata for public release.

### Removed

- Tracked `opencode.json`, `.opencode/`, `AGENT.md` and
  `docs/ENGINE-ANALYSIS.md` from every repository branch and tag.
- Local agent/Ralph setup from the release history; it remains ignored on the
  development machine.

### Security

- Purged the reverse-engineering analysis document from all branches and
  commits under repository control.
- Documented the private disclosure process in `SECURITY.md`.

[1.1.0]: https://github.com/TheAlexUbe/opentower/releases/tag/v1.1.0
[1.0.0]: https://github.com/TheAlexUbe/opentower/releases/tag/v1.0.0

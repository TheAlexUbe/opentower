# Changelog

All notable changes to OpenTower are documented here.

The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/) and
this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

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
  `docs/ENGINE-ANALYSIS.md` from the public tree and from all Git history.
- Local agent/Ralph setup from the release history; it remains ignored on the
  development machine.

### Security

- Purged the reverse-engineering analysis document from every branch and commit.
- Documented the private disclosure process in `SECURITY.md`.

[1.0.0]: https://github.com/TheAlexUbe/opentower/releases/tag/v1.0.0

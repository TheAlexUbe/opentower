# Changelog

All notable changes to OpenTower are documented here.

The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/) and
this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Added

- `CONTRIBUTING.md`, `CODE_OF_CONDUCT.md`, `SECURITY.md` and this changelog.
- `docs/ARCHITECTURE.md` with the verified module layering and the Graphify
  god-node/coupling findings.
- Explicit `npm run lint` script (`node --check`) and CI lint step.
- JSDoc for public functions, classes and the composition root across `src/`.
- Defensive `.gitignore` entries for local env files and build output.

### Changed

- `package.json` now declares repository, homepage, bugs, keywords and Node
  engine metadata for public release.

### Removed

- Tracked `opencode.json` (local Ralph/OpenCode provider wiring) from the public
  tree; it remains available locally and is now ignored.

### Security

- Documented the private disclosure process in `SECURITY.md`.

## [1.0.0] - 2026-11-26

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
- Test suite (25 groups) and GitHub Actions CI with syntax checks.

[Unreleased]: https://github.com/TheAlexUbe/opentower/compare/v1.0.0...HEAD
[1.0.0]: https://github.com/TheAlexUbe/opentower/releases/tag/v1.0.0

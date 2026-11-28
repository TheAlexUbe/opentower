# Contributing to OpenTower

_Gracias por ayudar. OpenTower es un simulador ATC original, sin backend y sin
dependencias de runtime; cualquier cambio debe conservar ese carácter._

## Before you start

- Read `AGENTS.md` / `AGENT.md` if present and `docs/ARCHITECTURE.md`.
- Open an issue for anything larger than a typo or a one-line fix. Describe the
  scenario, the expected behaviour and the actual behaviour.
- Do not copy code, art, data or text from Towerline or any commercial ATC
  product. Contributions must be original.

## Development setup

Requirements: Node.js 20 or newer and any static file server.

```bash
git clone https://github.com/TheAlexUbe/opentower.git
cd opentower
npm test
npm run test:e2e   # Chromium smoke/mobile/offline tests
python3 -m http.server 8080   # open http://127.0.0.1:8080
```

There is no build step and no `npm install` requirement for the app itself.
`node_modules/`, `graphify-out/`, `.opencode/`, `AGENT.md` and `.ralph-rlm/` are
local tooling and must not be committed.

## Tests

Every change must keep the suite green:

```bash
npm test
npm run test:e2e
npm run lint
```

Add a regression test for every bug fix and for new simulation behaviour. The
Node suite uses plain assertions and must not need a browser or network; the
Playwright suite covers real browser layout, PWA/offline and the control loop.

## Code style

- Native ES modules, two-space indentation, semicolons, single quotes.
- Keep `src/engine.js` and the `TraconEngine` class free of DOM access.
- Escape dynamic HTML in `src/ui.js` with `esc()`.
- Keep the seeded PRNG deterministic: same seed, same traffic.
- Add every user-facing string to both `en` and `es` in `src/i18n.js`.
- Preserve the existing ATC phraseology and readback style.
- Document public functions and classes with JSDoc.
- If you change PWA shell assets, bump `CACHE` in `sw.js`.
- Do not add runtime dependencies, a framework or a bundler.

## Commits and pull requests

- Use [Conventional Commits](https://www.conventionalcommits.org/), for example
  `fix: reject inactive runway clearances`, `docs: add contributing guide`.
- One logical change per pull request. Keep unrelated refactors out.
- Update `CHANGELOG.md` under `[Unreleased]`.
- Describe how you tested the change, including the scenario and difficulty.
- Do not commit generated artifacts, editor files or secrets.

## Reporting security issues

Do not open a public issue. Follow `SECURITY.md`.

## Community

By participating you agree to follow `CODE_OF_CONDUCT.md`. Be precise, be kind,
and assume good faith.

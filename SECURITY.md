# Security Policy

## Supported versions

| Version | Supported |
| ------- | --------- |
| 1.x     | Yes       |

OpenTower is a static, client-side web application. It has no backend, no
accounts, no database and no runtime dependencies. The only network request it
makes is to the public National Weather Service API for the KPHX METAR.

## Reporting a vulnerability

Please do **not** open a public issue for a security problem.

- Preferred: use GitHub private vulnerability reporting at
  <https://github.com/TheAlexUbe/opentower/security/advisories/new>.
- If that is unavailable, contact the maintainer [@TheAlexUbe](https://github.com/TheAlexUbe)
  privately and ask for a secure channel before sharing details.

Include the affected version or commit, a minimal reproduction, the impact you
believe it has, and any suggested fix. Please allow a reasonable window for a
fix before public disclosure.

## Scope

In scope:

- Cross-site scripting or HTML injection through radio text, callsigns,
  scenario names, weather data or `localStorage`.
- Service-worker cache poisoning or stale-asset behaviour that serves attacker
  controlled content.
- Leaks of local data (best scores, stored radio language) to third parties.
- Supply-chain issues in the development toolchain that affect the shipped app.

Out of scope:

- Vulnerabilities in the browser, operating system or the user's speech APIs.
- Denial of service caused by the user's own static file server.
- Social engineering and physical access.
- Findings that require an attacker to already control the served files.

## Handling of secrets

The project does not ship API keys, tokens, passwords or private endpoints.
If you find a credential in the repository or its history, report it privately
so it can be revoked and purged before any public discussion.

## Safe harbour

Good-faith research that follows this policy will not be pursued or reported.
We will credit reporters who want to be named once a fix is available.

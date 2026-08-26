# Changelog

All notable changes to ChatAI are documented here. The format follows [Keep a Changelog](https://keepachangelog.com/), and this project adheres to [Semantic Versioning](https://semver.org/).

## [1.0.0] - 2026-08-25

### Added

- Stable `/api/v1` contract freeze with OpenAPI fingerprint tests and widget routes documented (`config`, `feedback`, `widget/sign`)
- Semver + migration guarantees (`VERSION`, versioning docs, migration CI script)
- Load-test harness for chat and widget config (`loadtest/`)
- Community infrastructure: Discussions contact link, issue labels, public roadmap, security policy, code of conduct
- Release checklist and GitHub release workflow scaffolding

### Stabilized

- Widget embed: 30 kB gzip budget in CI, graceful degradation when the API is unreachable, CSP-friendly shadow DOM
- Security/privacy controls from v0.8 (domain allowlist, rate limits, signed widgets, retention, audit log)
- Self-hosting Docker path with automatic Drizzle migrations on boot

### Changed

- OpenAPI `info.version` aligned to product `1.0.0`
- Contributing docs updated for the v1.0 release train
- NightZeros brand attribution across web app, docs, README, and package metadata (no API or widget behavior changes)

## [0.8.0] - Unreleased (pre-1.0)

Security, privacy, and UI refresh work landed on the `feat/v0.8-*` branches before the 1.0 freeze.

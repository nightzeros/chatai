# Changelog

All notable changes to ChatAI are documented here. The format follows [Keep a Changelog](https://keepachangelog.com/), and this project adheres to [Semantic Versioning](https://semver.org/).

## [1.2.0] - 2026-10-09

ChatAI's server, not the voice model, now decides what Voice (preview) says. The `/api/v1` contract stays backward compatible for text chat and the REST API; Voice minting needs the 1.2.0 widget packages (see Changed).

### Added

- Voice (preview) playback gate: ChatAI's server decides who answers each utterance. Only greetings, thanks, goodbyes and short acknowledgements may be answered by the voice model; everything else goes through the text answer pipeline (Scope Router, Purpose, Profile, history, retrieval, output guard), and the widget plays the model's audio and captions only after ChatAI approves them. New `POST /api/v1/voice/sessions/:sessionId/gate` NDJSON stream, authorized by the session's control token.
- Server-forced Voice turns: when the voice model does not hand a non-social turn to ChatAI, or starts answering it itself, ChatAI runs the answer pipeline anyway and has the model speak only that answer. A late hand-off for the same turn is adopted, never answered or billed twice.
- Conversation Review labels voice-model replies the visitor never heard as **Withheld (not heard)**, and marks server-forced lookups.
- `@nightzeros/chatai-widget-core`: playback-gate client (`playback_gate` capability, gate stream with reconnects, local close on new visitor speech).
- `@nightzeros/chatai-sdk`: `playback_gate` capability, `playbackGate` in the mint response, and gate stream schemas.

### Changed

- **Breaking for Voice on older widgets:** minting a Voice session now requires the `playback_gate` capability. npm `@nightzeros/chatai-widget` / `@nightzeros/chatai-react` 1.1.0 get the neutral "Voice isn't available right now" refusal (text chat is unaffected); upgrade them to 1.2.0. The hosted `chat.js` updates with the server.
- The voice model's instructions now list only the four small-talk cases it may handle and explicitly hand off statements, single words, feelings, clarifications, repeats and topic changes. They are a backup to the server-side gate, not the boundary.
- Voice stays a preview.

### Fixed

- A Voice turn that failed before its usage reservation (for example, an assistant whose model provider isn't configured) now ends with a spoken apology instead of silence.

## [1.1.0] - 2026-10-07

First public preview release. The `/api/v1` contract stays backward compatible: every API change below is additive.

### Added

- **Voice (preview)** in the widget and React component: a microphone button when the assistant offers Voice, live transcript, switching between typing and speaking in one conversation, recording consent prompt, and visitor-safe "Voice isn't available right now" handling. Hide it per page with `data-voice="off"` or `voice={false}`.
- Voice (preview) server side: GPT-Live realtime provider (`VOICE_*` settings), session minting with the same allowlist, rate-limit and signing checks as text chat (`POST /api/v1/voice/sessions`, `.../heartbeat`, `.../end`), a control plane with heartbeats and crash recovery, graceful drain on shutdown, and delegation of factual turns to the text answer pipeline so spoken answers use the assistant's Knowledge.
- Voice recordings (opt-in, needs object storage) with owner playback and a transcript timeline in Conversation Review, recording lifecycle and retention, and a separate "Save Voice transcripts" setting.
- Voice usage minutes: per-plan allowance, reservation and settlement per session, concurrency limits, and an optional `voice` API key scope.
- **Assistant Purpose and scope enforcement**: owners describe what the assistant is for (focused or general); a shared Scope Router handles text and delegated Voice turns, isolates the in-scope part of partial requests, and redirects out-of-scope requests. A selective output scope guard checks replies, and the owner-only `out_of_scope` outcome is recorded.
- **Assistant Profile and Key Facts**: a Profile page with owner Purpose, review-gated Key facts suggested from Knowledge (owner approves or rejects each), and a background refresh worker. Profile answers stay behind `PROFILE_ANSWER_ROUTE`, off by default.
- **Hosted plans and usage controls**: hosting accounts, Free / Starter / Pro / Business entitlements, per-model pricing, usage reservation and reconciliation for chat, ingestion and eval jobs, `shadow` or `enforce` modes (`HOSTED_USAGE_ENFORCEMENT`), the Usage dashboard, and `/api/v1/account/usage/*` endpoints.
- **Polar billing** (optional): checkout, customer portal, idempotent webhooks (`/api/webhooks/polar`), and the Billing dashboard.
- Admin account endpoints under `/api/admin/accounts` for instance operators listed in `ADMIN_USER_IDS`.
- Markdown rendering for welcome messages and assistant replies in the widget, and new feedback icons.
- `@nightzeros/chatai-widget-core`: Voice session, state, transcript and control-health APIs.
- `@nightzeros/chatai-sdk`: Voice session request/response schemas and optional `history` on chat requests.
- Production VPS deployment: Compose stack with Caddy, GHCR image builds, deploy and rollback scripts, and uploads backup procedures.
- npm packages README and LICENSE files, a Voice (preview) docs page, an upgrade guide, a production checklist, and a complete environment variable reference.

### Changed

- License is Apache-2.0 (previously MIT).
- Public npm packages are published under the `@nightzeros` scope with npm Trusted Publishing (GitHub Actions OIDC) and provenance.
- The repository moved to [`nightzeros/chatai`](https://github.com/nightzeros/chatai); the hosted service's container image is `ghcr.io/nightzeros/chatai`.
- NightZeros branding across the web app and documentation site, and app fonts are self-hosted.
- `.env.production.example` defaults usage enforcement to `shadow` so self-hosters do not inherit hosted plan limits.

### Fixed

- Scope Router and output guard hardening: timed-out guard checks are aborted, long replies are checked at head and tail, partial and recent-redirect cases fail closed, and profile titles and facts are passed only as sanitized hints.
- Voice answer authority: the backend answer stays canonical (the spoken rendering is kept for debugging), and client-supplied and live Voice replies are treated as unverified history.
- Voice acknowledgements no longer supersede an in-flight lookup, and superseded delegations are closed.
- Usage reconciliation: accrued usage settles exactly once on error, abort or disconnect; eval jobs reserve, meter and reconcile hosted cost and are unlocked even when cleanup fails; hosted chat cost is estimated from the real prompt.
- Playground ownership is verified server side, so the effective request source cannot be spoofed.
- Visitors no longer see billing or usage details in refusals, and the widget security policy runs before account checks.
- Profile worker reliability: fenced job claims, failure after exhausted retries, timeouts, backoff and bounded polling.
- Key facts whose names, emails or URLs are missing from the quoted source are rejected, and facts from deleted documents are pruned.
- Docker image builds now install every workspace package (including Voice and billing dependencies), and the migrate runtime includes `dotenv`.
- Production deploys run migrations with the `node` entrypoint and fall back to a local health check when the server cannot resolve its own hostname.

### Database

Migrations `0007` to `0020` apply automatically (see the upgrade guide):

| Migration                         | Change                                                                                                                                        |
| --------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------- |
| `0007_round_star_brand`           | `hosting_accounts`                                                                                                                            |
| `0008_greedy_texas_twister`       | `plan_entitlements`, `usage_events`, `usage_period_balances` (with default plan rows)                                                         |
| `0009_lethal_guardian`            | `model_pricing` (with default prices)                                                                                                         |
| `0010_stripe_billing`             | Billing events table and paid plan rows                                                                                                       |
| `0011_polar_billing`              | Renames the `0010` billing columns and table to Polar names                                                                                   |
| `0012_saas_plans`                 | Plan ladder: updates plan rows, moves `team` accounts to `business` and removes the `team` row, refreshes current-period limits               |
| `0013_voice_foundation`           | `voice_sessions`, `voice_events`, `voice_recordings`; `assistants.voice_settings`; `messages.modality`, `was_interrupted`, `voice_session_id` |
| `0014_conversation_turn_outcomes` | `message_outcome` values `conversational`, `answered_from_history`                                                                            |
| `0015_voice_recording_lifecycle`  | Recording status, duration, expiry and deletion columns                                                                                       |
| `0016_voice_usage_minutes`        | Voice seconds on usage balances; metering columns on Voice sessions; Voice allowance per plan                                                 |
| `0017_message_audio_offset`       | `messages.audio_offset_ms`                                                                                                                    |
| `0018_voice_control_plane`        | Voice runtime and recovery columns; recording timeline version                                                                                |
| `0019_scope_outcome`              | `message_outcome` value `out_of_scope`                                                                                                        |
| `0020_assistant_profile`          | `assistant_profiles`, `assistant_profile_jobs`                                                                                                |

Changes to tables that existed in 1.0.0 are additive: new tables, new columns that are nullable or have defaults, new enum values and foreign keys. The renames in `0011` and the row updates in `0012` and `0016` only touch tables created earlier in this release. There are no down migrations; see the upgrade guide for rollback.

### Upgrade notes

Read [Upgrading to 1.1](https://docs.nightzeros.com/docs/self-hosting/upgrade-1-1) before upgrading a self-hosted instance. npm users need `1.1.0` or later for Voice (preview).

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

[1.2.0]: https://github.com/nightzeros/chatai/releases/tag/v1.2.0
[1.1.0]: https://github.com/nightzeros/chatai/releases/tag/v1.1.0

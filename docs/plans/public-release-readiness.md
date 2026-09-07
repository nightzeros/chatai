# Public release readiness

Audit branch: `chore/public-release-security-audit`  
Intended public base (pre-audit): `origin/main` @ `b0081e9`  
Date: 2026-09-07

ChatAI (“Your knowledge. Your AI. Anywhere.”) — NightZeros open-source project.

This document is the launch checklist from the pre-public security/licensing audit.  
**Do not print secrets here. Do not make the repo public until Critical / Must-do items are done.**

---

## A. Critical blockers

1. **Rotate credentials that exist on developer machines / chat transcripts / VPS**, even though Git history is clean:
   - Local `.env` (untracked) was found by working-tree scanners to contain live-looking AI, Polar, DB, Resend, and GitHub PAT material.
   - Treat those as **compromised for operational hygiene** (rotate/revoke) before or immediately after public launch.
   - Confirm VPS `/opt/chatai/.env.production` never entered git (history scan: never tracked).
2. **Apache-2.0 licensing** — remediated on this audit branch (was MIT). Confirm legal owner is comfortable with the copyright line in `LICENSE` before merge.
3. **Polar production payments** — org must be payment-ready (`Finance → Account` / Go Live). Otherwise public users hit “Payments are currently unavailable” on Polar checkout (product issue, not a git leak).

---

## B. Must-do before public

- [ ] Merge this audit PR (or equivalent remediations) into `main`
- [ ] Rotate any live keys that lived in local `.env` / shared channels
- [ ] Confirm `.env` / `.env.production` / SSH private keys remain untracked (`git status`, `git check-ignore`)
- [ ] Confirm ChatAI Cloud VPS has `HOSTED_USAGE_ENFORCEMENT=enforce` and Polar production vars (not sandbox). The committed `.env.production.example` defaults to `shadow` so self-hosters who copy it are not blocked by free-plan limits.
- [ ] Enable GitHub secret scanning + push protection (section C)
- [ ] Decide whether GitHub org/repo rename from `master-tecs` → NightZeros is required for brand (optional; docs currently match real owner)
- [ ] Smoke: clean clone → `pnpm install` → `pnpm build` / docs quickstart
- [ ] npm: confirm published packages will pick up `Apache-2.0` on next release (metadata already updated on branch)

---

## C. GitHub settings after visibility → public

Enable/configure:

- [ ] Secret scanning
- [ ] Push protection
- [ ] Private vulnerability reporting (SECURITY.md already points here)
- [ ] Dependabot alerts + security updates
- [ ] Code scanning (CodeQL) optional but recommended
- [ ] Branch protection / ruleset on `main`: required CI, required review, no force-push
- [ ] Environments: `production` (deploy) and `npm` (publish) with required reviewers
- [ ] Actions: restrict default GITHUB_TOKEN; disallow fork workflow write to prod secrets
- [ ] Confirm deploy/publish workflows remain gated (`github.repository == 'master-tecs/chatai'` where required)

---

## D. Production deployment checks (NightZeros Cloud)

- [ ] Image built with explicit `NEXT_PUBLIC_APP_URL` / `NEXT_PUBLIC_DOCS_URL` build-args (CI already sets these)
- [ ] `/opt/chatai/.env.production`: DB, auth, AI keys, `HOSTED_USAGE_ENFORCEMENT=enforce`, Polar production
- [ ] Webhook `https://app.nightzeros.com/api/webhooks/polar` verified
- [ ] Health `https://app.nightzeros.com/api/health`
- [ ] Billing upgrades create Polar checkout; payments enabled on Polar org

---

## E. Polar checks

- [ ] Access token + webhook secret **server-only** (never `NEXT_PUBLIC_*`)
- [ ] Checkout uses `planCode` → server product map
- [ ] Unknown products do not grant plans
- [ ] Soft-disable when token unset (503 + UI “Billing unavailable”)
- [ ] Sandbox vs production env consistency

---

## F. npm checks

Packages: `@nightzeros/chatai-widget-core`, `@nightzeros/chatai-widget`, `@nightzeros/chatai-react`, `@nightzeros/chatai-sdk`

- [ ] `license: Apache-2.0`
- [ ] Trusted Publishing / OIDC (no routine `NPM_TOKEN`)
- [ ] `pnpm packages:verify` / dry-run pack before tag
- [ ] Token-fallback workflow remains `if: false` unless emergency

---

## G. Docs / community

Present: `LICENSE`, `README`, `CONTRIBUTING`, `SECURITY`, `CODE_OF_CONDUCT`, `CHANGELOG`, `ROADMAP`, issue/PR templates.

- [ ] README clearly distinguishes **self-host (BYO keys)** vs **ChatAI Cloud**
- [ ] SECURITY.md private reporting only (verified)
- [ ] Optional: package-level READMEs for the four public packages
- [ ] Optional: NOTICE if/when vendoring notice-requiring code (not required today)

---

## H. Nice-to-have after launch

- SHA-pin GitHub Actions
- CodeQL on schedule
- Soften remaining NightZeros hostnames in `deploy/Caddyfile` / scripts via comments for self-hosters
- Clean historical `@chatai/react` mentions in `docs/superpowers/**`
- Add CLA/DCO note to CONTRIBUTING if desired

---

## Audit findings summary (non-secret)

| Area | Result |
|------|--------|
| Git history secrets (gitleaks + pattern scan) | **No leaks found** in 75–90 commits |
| Working-tree secrets | Local `.env` / `.next` caches only (gitignored / build artifacts) |
| History rewrite | **Not required** for git (rotate local/VPS secrets instead) |
| License (pre-audit) | MIT everywhere |
| License (this branch) | Apache-2.0 root + public packages + README |
| Stripe remnants | Migration rename history only; no Stripe npm dep |
| Client secret imports | No `use client` → `env`/Polar/db; `server-only` added to `env.ts` |
| Dockerfile public URL defaults | Changed to localhost (CI still overrides for NightZeros) |
| `.gitignore` | Now ignores `.env.*` except `*.example` |
| Deploy workflow | Repository lock added |
| CI permissions | `contents: read` |
| Telemetry to NightZeros | No product telemetry SDK found |
| Self-host AI key fallback | Requires user-supplied keys / hosted account path |

---

## Manual rotation list (types only — no values)

If present on any machine or VPS, rotate:

1. GitHub PAT (`ghp_` / fine-grained)
2. OpenAI / AI provider API keys
3. Neon / Postgres credentials (if ever shared beyond VPS)
4. Polar access tokens + webhook secrets (sandbox and production)
5. Resend API keys
6. Better Auth secret (if leaked)
7. Cohere / other provider keys
8. VPS root/SSH passwords if shared in plaintext channels

---

## Verdict gate

Return **READY TO MAKE PUBLIC** only when:

- This branch (or equivalent) is on `main`
- Local/shared credentials rotated
- GitHub secret scanning + push protection on
- Polar payment-ready for any advertised paid plans
- Cloud `HOSTED_USAGE_ENFORCEMENT=enforce` confirmed on VPS

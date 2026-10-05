# Production VPS deployment

Deploy ChatAI to a single Ubuntu 24.04 VPS at **https://app.nightzeros.com** using Docker, Caddy, external Neon Postgres, and immutable images from **GHCR**.

**Repository:** [github.com/nightzeros/chatai](https://github.com/nightzeros/chatai)  
**Container image:** `ghcr.io/nightzeros/chatai:<immutable-tag>`

NightZeros marketing and docs are deployed separately. This VPS runs only the ChatAI application and its in-process workers.

## Architecture

```text
app.nightzeros.com
        ↓
Cloudflare DNS only (grey cloud)
        ↓
VPS (UFW: 22, 80, 443)
        ↓
Caddy (:80 / :443 — only public ports)
        ↓
ChatAI (:3000 internal)
        ↓
Neon Postgres + AI providers
```

```text
GitHub tag (v*) OR approved workflow_dispatch
        ↓
GitHub Actions (production environment approval)
        ↓
Build Docker image once
        ↓
Push immutable image to ghcr.io/nightzeros/chatai
        ↓
VPS pulls exact tag (no build on VPS)
        ↓
Run migrations once
        ↓
Start container
        ↓
Health check (fail deploy if unhealthy — manual rollback only)
```

## Server requirements

| Resource | Minimum |
| --- | --- |
| OS | Ubuntu 24.04 LTS |
| CPU | 2 vCPU |
| RAM | 4 GB (8 GB recommended for builds elsewhere) |
| Disk | 40 GB+ (Docker images, logs, uploads volume) |
| Ports | 22, 80, 443 public; **3000 not exposed** |

## Initial VPS setup

### 1. Bootstrap

On a fresh VPS as root:

```bash
sudo bash scripts/vps/bootstrap-ubuntu.sh
```

Creates user `deploy`, installs Docker, configures UFW, creates `/opt/chatai`.

### 2. SSH hardening

1. Add your SSH public key to `/home/deploy/.ssh/authorized_keys`
2. Confirm login: `ssh deploy@<VPS_IP>`
3. Disable password auth:

```bash
sudo sed -i 's/^PasswordAuthentication.*/PasswordAuthentication no/' /etc/ssh/sshd_config
sudo systemctl reload ssh
```

Never commit SSH private keys to the repository.

### 3. DNS (Cloudflare DNS-only)

| Type | Name | Value |
| --- | --- | --- |
| A | app | `<VPS_PUBLIC_IP>` |

Use **DNS only** (grey cloud) initially so Caddy obtains Let's Encrypt certificates directly. Orange-cloud proxy is a post-v1 option — test SSE, uploads, and timeouts before enabling.

### 4. Install deployment files on VPS

```bash
sudo mkdir -p /opt/chatai/backups
sudo chown deploy:deploy /opt/chatai
cd /opt/chatai

# Copy from repo checkout or sync these paths:
#   docker-compose.prod.yml
#   deploy/Caddyfile
#   scripts/deploy.sh
#   scripts/health-check.sh
#   scripts/rollback.sh
#   scripts/backup-uploads.sh
#   scripts/verify-uploads-backup.sh

chmod +x scripts/*.sh
```

### 5. Production secrets

```bash
cp .env.production.example .env.production
chmod 600 .env.production
# Edit with Neon URLs, BETTER_AUTH_*, AI keys, ENCRYPTION_KEY if needed
```

**Never commit `.env.production`.**

### 6. GHCR pull access

```bash
echo "<read-only-github-pat>" | docker login ghcr.io -u <github-username> --password-stdin
```

Use a fine-grained PAT with `read:packages` for `ghcr.io/nightzeros/chatai`.

Images built before the repository moved from `master-tecs/chatai` live at `ghcr.io/master-tecs/chatai` and were not moved with it. `docker-compose.prod.yml` on the VPS must use the new image path, and `rollback.sh` can only reach tags published under `ghcr.io/nightzeros/chatai`.

## Environment variables

### Build-time (baked into GHCR image by GitHub Actions)

| Variable | Production value |
| --- | --- |
| `NEXT_PUBLIC_DOCS_URL` | `https://docs.nightzeros.com` |
| `NEXT_PUBLIC_APP_URL` | `https://app.nightzeros.com` |

### Runtime (`.env.production` on VPS only)

| Variable | Required | Notes |
| --- | --- | --- |
| `DATABASE_URL` | Yes | Neon **pooled** URL |
| `DATABASE_URL_UNPOOLED` | Recommended | Direct URL for migrations/workers |
| `BETTER_AUTH_URL` | Yes | `https://app.nightzeros.com` (no trailing slash) |
| `BETTER_AUTH_SECRET` | Yes | `openssl rand -base64 32` |
| `ENCRYPTION_KEY` | When storing provider keys | `openssl rand -base64 32` |
| `UPLOAD_DIR` | Yes | `/app/uploads` |
| `AI_API_KEY` | For default provider | Server-only |
| `SEED_DEMO_ON_START` | **Must be unset** | Never in production |

See [.env.production.example](../../.env.production.example) and [.env.example](../../.env.example) for the full list.

## Deploy

### Automated (GitHub Actions)

Workflow: [.github/workflows/deploy-production.yml](../../.github/workflows/deploy-production.yml)

**Triggers:**

| Trigger | Image tag |
| --- | --- |
| Push tag `v*` (must match [VERSION](../../VERSION)) | `v1.0.0` |
| `workflow_dispatch` | Input `image_tag` or git SHA |

Requires GitHub **Environment** `production` with reviewers and secrets:

| Secret | Purpose |
| --- | --- |
| `VPS_HOST` | VPS IP or hostname |
| `VPS_USER` | `deploy` |
| `VPS_SSH_KEY` | Private key for SSH deploy |

App runtime secrets stay on the VPS only.

### Manual (on VPS)

```bash
cd /opt/chatai
CHATAI_IMAGE_TAG=v1.0.0 ./scripts/deploy.sh
```

**Deploy sequence:**

1. Pull exact GHCR tag
2. Run migrations once (`migrate.mjs`)
3. `docker compose up -d`
4. Health check `https://app.nightzeros.com/api/health`

On failure, the script **does not auto-rollback**. See [Rollback](#rollback).

## Database migrations

- Tool: Drizzle ([packages/database/scripts/migrate.mjs](../../packages/database/scripts/migrate.mjs))
- Uses `DATABASE_URL_UNPOOLED` when set, else `DATABASE_URL`
- Production: migrations run **once per deploy** via `deploy.sh`, not on every container start (`RUN_MIGRATIONS=0`)

**If migration fails:** deploy aborts before switching the app. The running container stays on the previous image.

**Neon recovery:** use Neon backups, branches, or PITR per your plan. Destructive migrations have no automatic rollback.

## Migration compatibility (read before rollback)

Application rollback and database rollback are **separate**.

Before running `./scripts/rollback.sh`:

1. Check whether migrations from the failed deploy **already applied** (Neon table `drizzle.__drizzle_migrations`).
2. If a new migration applied successfully but the new app is unhealthy, rolling back to an **older app image** may fail against the newer schema.
3. **Safe app rollback** when:
   - Migrations did not complete (deploy.sh aborted before `up -d`), or
   - You know the old app version is compatible with the current schema (forward-only additive migrations).
4. **Never** assume `rollback.sh` reverses database state.
5. For destructive schema changes, use Neon PITR/branch restore instead of app rollback.

## Rollback

**v1: manual operator action only.**

```bash
cd /opt/chatai
# Uses previous_tag from .deploy-state, or set explicitly:
CHATAI_IMAGE_TAG=v1.0.0 ./scripts/rollback.sh
```

Rollback pulls the previous image and restarts **without running migrations**. Read [Migration compatibility](#migration-compatibility-read-before-rollback) first.

## Uploads backup (local disk)

Source documents are stored in Docker volume `chatai_chatai_uploads` at `/app/uploads`. Neon holds metadata and embeddings only.

**Post-v1 improvement:** migrate to Cloudflare R2 / S3-compatible object storage.

### Backup

```bash
cd /opt/chatai
./scripts/backup-uploads.sh
# → backups/chatai-uploads-YYYYMMDD-HHMMSS.tgz
# → backups/chatai-uploads-YYYYMMDD-HHMMSS.tgz.sha256
```

### Verify (run after every backup)

```bash
./scripts/verify-uploads-backup.sh backups/chatai-uploads-YYYYMMDD-HHMMSS.tgz
```

Exits 0 when: checksum matches, tarball lists cleanly, dry-run extract succeeds.

### Restore (maintenance window)

```bash
./scripts/backup-uploads.sh restore backups/chatai-uploads-YYYYMMDD-HHMMSS.tgz
```

Copy `.tgz` + `.sha256` off-VPS for disaster recovery.

## Logs and monitoring

```bash
docker compose -f docker-compose.prod.yml logs -f chatai
docker compose -f docker-compose.prod.yml logs -f caddy
docker stats
df -h
free -h
uptime
```

External uptime: monitor `https://app.nightzeros.com/api/health` (UptimeRobot, Better Stack, etc.).

Docker log rotation is configured in `docker-compose.prod.yml` (`max-size: 10m`, `max-file: 5`).

Safe image cleanup:

```bash
docker image prune
```

**Do not** run `docker volume prune` on production.

## Reboot test

After deploy:

```bash
sudo reboot
```

Verify (no manual steps):

- Docker starts
- Caddy serves HTTPS
- `curl -fsS https://app.nightzeros.com/api/health`

## Background workers

In-process workers (ingest, eval, privacy/retention) run inside the web container via [apps/web/src/instrumentation.ts](../../apps/web/src/instrumentation.ts). Acceptable for single-instance v1. Dedicated worker containers are a post-v1 scaling step.

## Widget and security

- Widget: `https://app.nightzeros.com/widget/chat.js`
- Verify: `pnpm widget:check` (CI) and embed smoke tests after deploy
- Security controls (domain allowlist, rate limits, HMAC signing, audit logging) are unchanged — do not loosen CORS or bypass policies for deployment

## Disaster recovery

```text
new VPS + GitHub repo + .env.production backup + Neon + uploads backup = restored ChatAI
```

1. Provision replacement VPS
2. Run `bootstrap-ubuntu.sh`
3. Restore `/opt/chatai/.env.production` (encrypted backup)
4. Restore deployment files
5. `docker login ghcr.io`
6. Restore uploads: `./scripts/backup-uploads.sh restore …`
7. Deploy known GHCR tag: `CHATAI_IMAGE_TAG=v1.0.0 ./scripts/deploy.sh`
8. Point DNS to new VPS
9. Health, auth, widget smoke tests

## Production smoke checklist

After first deploy:

- [ ] HTTPS and HTTP→HTTPS redirect
- [ ] `/api/health` returns `{"status":"ok","db":"ok"}`
- [ ] Signup / login / logout
- [ ] Create assistant, upload document, ingest
- [ ] Playground streaming chat
- [ ] Widget load, signing, blocked origin
- [ ] Safe load smoke: `BASE_URL=https://app.nightzeros.com pnpm loadtest:smoke`

## Related docs

- [Self-hosting Docker (local Compose + Postgres)](../../apps/docs/content/docs/self-hosting/docker.mdx)
- [Backup and upgrades (local Compose)](../../apps/docs/content/docs/self-hosting/backup-upgrade.mdx)
- [Release checklist](../RELEASE.md)

# Production Deployment — DigitalOcean (single droplet)

The live POS backend runs on **one DigitalOcean droplet** as a Docker Compose
stack: **Caddy** (public :80/:443, automatic HTTPS) → **API** (:5000) →
**Postgres** (internal only). This is the cheap, always-on production host.
(The AWS Terraform stack under `infra/` is a separate portfolio/"build-and-park"
exercise — see `docs/deploy-aws.md`.)

## Topology
```
cm-api.devmau.site  (A record at Hostinger -> droplet IP)
   -> Caddy  (Let's Encrypt TLS, reverse proxy)
      -> api container (:5000)
         -> db container (Postgres, internal Docker network only)
```
- Web admin (Vercel) at `mphar-web.devmau.site` — allow-listed via `CLIENT_URL`.
- Mobile POS (Expo) — native app, not subject to CORS; gated by JWT.

## One-time server setup
1. Create droplet: Ubuntu 24.04, Singapore (SGP1), 1 vCPU / 1 GB, SSH key auth.
2. Install Docker + Compose: `curl -fsSL https://get.docker.com | sh`.
3. Add swap (2 GB) and firewall (allow OpenSSH, 80, 443 via `ufw`).
4. Clone + configure:
   ```bash
   cd /opt && git clone -b feat/drizzle-rds-migration \
     https://github.com/maumaun30/CM-Pharmacy-API.git
   cd CM-Pharmacy-API
   cp .env.production.example .env    # fill in real secrets (see below)
   docker compose -f docker-compose.prod.yml up -d --build
   ```
5. Load schema (fresh DB):
   ```bash
   for f in supabase/migrations/*.sql db/functions/*.sql; do
     docker compose -f docker-compose.prod.yml exec -T db \
       psql -v ON_ERROR_STOP=1 -U cmpharmacy -d cm_pharmacy < "$f"
   done
   ```
6. Seed an admin (hash with the container's bcryptjs, then insert) — see project history.

## Secrets (`/opt/CM-Pharmacy-API/.env`, gitignored)
`POSTGRES_USER`, `POSTGRES_PASSWORD`, `POSTGRES_DB`, `JWT_SECRET`,
`JWT_EXPIRES_IN`, `CLIENT_URL` (comma-separated allow-list of web origins).
Generate strong values with `openssl rand -hex 16/32`. Lock it down: `chmod 600 .env`.

## Manual deploy
```bash
cd /opt/CM-Pharmacy-API
git pull
docker compose -f docker-compose.prod.yml up -d --build
```

## Automated deploy (GitHub Actions)
`.github/workflows/deploy.yml` deploys on every push to the production branch.
It SSHes into the droplet, `git reset --hard` to the branch, and rebuilds.

Required repo secrets (Settings -> Secrets and variables -> Actions):
| Secret | Value |
|---|---|
| `DROPLET_HOST` | droplet public IP |
| `DROPLET_USER` | `root` (or a deploy user) |
| `DROPLET_SSH_KEY` | **private** key whose public half is in the droplet's `~/.ssh/authorized_keys` |

Use a **dedicated CI deploy key** (not your personal key):
```bash
ssh-keygen -t ed25519 -f cm-deploy -C "github-actions" -N ""
# add cm-deploy.pub to the droplet:
#   cat cm-deploy.pub | ssh root@<IP> 'cat >> ~/.ssh/authorized_keys'
# paste the PRIVATE key (cm-deploy) into the DROPLET_SSH_KEY secret
```

## Backups
`scripts/backup-db.sh` runs nightly via cron (2 AM PHT / 18:00 UTC), gzipping a
`pg_dump` to `/opt/backups` with 14-day retention. On-box only — add off-box
copies (DigitalOcean Spaces / scp) for disaster recovery.

## Logs / ops
```bash
docker compose -f docker-compose.prod.yml ps
docker compose -f docker-compose.prod.yml logs -f api      # or db / caddy
docker compose -f docker-compose.prod.yml restart api
```

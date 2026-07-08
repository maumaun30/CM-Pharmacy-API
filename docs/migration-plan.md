# API Migration: Supabase → Self-hosted Postgres (Drizzle) → AWS

**Branch:** `feat/drizzle-rds-migration`
**Status:** In progress
**Owner:** (you)
**Last updated:** 2026-07-08

## Why

The API used Supabase purely as a **remote Postgres database** — no Supabase
Auth (we issue our own JWTs), no Storage, no Realtime (we run our own
Socket.IO). Every controller call was a `.from()`/`.rpc()` HTTP round-trip
through PostgREST to a database in a distant region. That round-trip latency —
multiplied across the several sequential queries a request like the dashboard
makes — is what made Supabase feel slow versus an internal DB.

Moving to a Postgres we host (locally now, **AWS RDS** in Phase 2) and
**colocating** the API with it collapses that latency from tens/hundreds of ms
per query to sub-millisecond. It also unblocks the real goal: a horizontally
scalable, resume-worthy AWS deployment.

## Decisions (agreed)

| Decision | Choice | Rationale |
|---|---|---|
| Data layer | **Drizzle ORM** (fresh, not the old Sequelize branch) | SQL-first, typed, lightweight; maps cleanly onto the existing raw DDL. The `postgres-sequelize` branch was 14 feature commits behind and uses the heaviest ORM. |
| Sequencing | **Local Postgres first**, then AWS | De-risk the code migration against a free local DB; the only new variables at cloud time are infra, not code. |
| Target host | **AWS** (RDS Postgres + ECS Fargate + ALB) | Managed, scalable, idiomatic — see `architecture.md`. |
| Auth | Unchanged — own JWT | Never depended on Supabase Auth. |
| Realtime | Unchanged — own Socket.IO | Never depended on Supabase Realtime. |

## What stays the same

- **Postgres schema** — `supabase/migrations/*.sql` are plain Postgres DDL and
  are reused verbatim as the local/RDS schema. No schema rewrite.
- **RPCs** — `create_sale` and `get_top_products` are Postgres functions living
  in the DB. Drizzle calls them via `sql`-tagged raw queries. They are the
  source of truth for sale/stock atomicity and are **not** reimplemented in JS.
- **Controllers' behavior, routes, middleware, socket events** — only the data
  access lines change (`supabase.from(...)` → Drizzle query builder).

## Phases

### Phase 1 — Data layer (this branch)
1. ✅ **Local Postgres** via `docker-compose.yml` (host port 5544); schema
   loaded by `db/bootstrap.sh` (all migrations + `create_sale`).
2. ✅ **Drizzle** installed; schema introspected into `db/schema.js`; the two
   data-type conventions applied (PK `mode:number`, numeric `mode:number`).
3. ✅ **DB client** (`config/db.js`) — pooled `pg` + Drizzle. Smoke-tested.
4. ✅ **Reference controller** `categoryController` migrated + integration-tested
   (create/read/nested/update/delete + count all verified against local PG).
5. **Remaining controllers** migrated off supabase-js:
   - ✅ middleware: `authMiddleware.js`, `logMiddleware.js` (auth flow tested)
   - ✅ `authController` (register/login/PIN/profile/switch-branch — tested)
   - ✅ `categoryController` (reference — tested)
   - ✅ `logController` (+ `get_log_stats` RPC materialized — tested)
   - ✅ `userController` (tested)
   - ✅ `branchController` (tested)
   - ✅ `productController`, `discountController`, `branchStockController`,
     `stockController`, `refundController`, `saleController` (RPC),
     `dashboardController` — all migrated + integration-tested
6. ✅ **Cutover** — `server.js` health check uses the pool; removed
   `@supabase/supabase-js` and `config/supabase.js`. Verified end-to-end over
   HTTP (login → JWT → /auth/me → /products → /dashboard/stats, all 200).

**Phase 1 is complete.** The API runs entirely on self-hosted Postgres via
Drizzle with zero Supabase references. RPCs materialized into `db/functions/`:
`create_sale`, `process_refund`, `transfer_branch_stock`, `get_log_stats`.
Next: Phase 2 (AWS) — see `architecture.md`.

### Phase 2 — AWS (separate branch/effort)
See `architecture.md`. RDS Postgres (Multi-AZ), Express on ECS Fargate behind an
ALB, all in one VPC in `ap-southeast-1` (Singapore, nearest mature region to
PH). Provisioned with IaC (Terraform or CDK), deployed via GitHub Actions.
Data migrated from Supabase with `pg_dump`/`pg_restore`.

## Env changes

`.env` gains a standard Postgres connection string and (Phase 1) can drop the
Supabase vars once cutover is complete:

```
# New
DATABASE_URL=postgres://cmpharmacy:cmpharmacy@localhost:5432/cm_pharmacy

# Removed after cutover
# SUPABASE_URL=...
# SUPABASE_SERVICE_ROLE_KEY=...
```

## Rollback

`main` still runs on Supabase and is untouched. If Phase 1 needs to pause,
`main` is the working production baseline. This branch is additive until the
final cutover commit removes `@supabase/supabase-js`.

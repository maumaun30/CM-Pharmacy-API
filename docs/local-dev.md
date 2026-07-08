# Local Development — Database & Data Layer

The API now talks to a **self-hosted Postgres** via **Drizzle ORM** (was Supabase).
For local dev, Postgres runs in Docker.

## Prerequisites
- Docker Desktop running
- Node 22+

## First-time / reset

```bash
npm run db:up          # start Postgres (docker-compose.yml) on host port 5544
npm run db:bootstrap   # load schema: all supabase/migrations/*.sql + create_sale RPC
```

`npm run db:reset` wipes the volume and rebuilds from scratch.

Set in `.env`:
```
DATABASE_URL=postgres://cmpharmacy:cmpharmacy@localhost:5544/cm_pharmacy
```
> Host port is **5544**, not 5432, to avoid colliding with a native Postgres
> that may already own 5432/5433 on this machine.

## How the data layer is wired

| File | Role |
|---|---|
| `docker-compose.yml` | Local Postgres 16 container (`cm-pharmacy-db`). |
| `db/bootstrap.sh` | Applies migrations + `create_sale` into the container. |
| `db/functions/create_sale.sql` | The atomic sale RPC (mirror of the comment in `saleController.js`). |
| `db/schema.js` | Drizzle table/enum definitions. **Generated** from the live DB. |
| `drizzle.config.js` | drizzle-kit config (used by `db:pull`). |
| `config/db.js` | Shared `pg` Pool + Drizzle instance. Exports `{ db, pool, schema }`. Replaces `config/supabase.js`. |

## Regenerating the schema after a DB change

1. Change the SQL (a new file under `supabase/migrations/`), re-bootstrap.
2. `npm run db:pull` → regenerates `drizzle/schema.ts`.
3. Convert to CommonJS `db/schema.js`. The generated file is ESM/TS; this JS
   project needs `require`/`module.exports`. See the transform used originally
   (import→require, `export const`→`const`, append `module.exports`).
4. **Re-apply the two data-type conventions below** (drizzle-kit does not emit
   them, and they are load-bearing).

## ⚠ Two data-type conventions (do not lose these on a re-pull)

Both were found via smoke tests; both keep API responses compatible with the
Next.js/Expo clients that previously consumed Supabase (PostgREST) JSON.

1. **Primary keys → `mode: "number"`.**
   drizzle-kit introspects PKs as `bigserial({ mode: "bigint" })`, which returns
   JavaScript **BigInt** — and `JSON.stringify` **throws** on BigInt, 500-ing
   every endpoint. We use `mode: "number"` (safe well below 2^53 rows).

2. **Money columns → `numeric(..., { mode: "number" })`.**
   node-postgres returns `numeric` as a **string**; the clients expect
   **numbers**. `config/db.js` also sets a global numeric type-parser so raw SQL
   (dashboard/RPC queries) returns numbers too.

## Controller migration pattern (supabase-js → Drizzle)

`categoryController.js` is the reference. Cheat-sheet:

| supabase-js | Drizzle |
|---|---|
| `supabase.from("t").select("*")` | `db.select().from(t)` |
| `.eq("id", x)` | `.where(eq(t.id, x))` |
| `.order("name")` | `.orderBy(asc(t.name))` |
| `.maybeSingle()` | `.limit(1)` then `const [row] = ...` |
| `.insert(v).select().single()` | `db.insert(t).values(v).returning()` → `[row]` |
| `.update(v).eq("id",x).select().single()` | `db.update(t).set(v).where(eq(t.id,x)).returning()` → `[row]` |
| `.delete().eq("id",x)` | `db.delete(t).where(eq(t.id,x))` |
| `.select("id",{count:"exact",head:true})` | `db.select({ n: count() }).from(t).where(...)` |
| `supabase.rpc("create_sale", {...})` | ``db.execute(sql`select create_sale(...)`)`` |

Notes:
- Column refs use **camelCase** Drizzle properties (`products.categoryId`),
  which map to snake_case DB columns (`category_id`).
- Import helpers from `drizzle-orm`: `eq, and, or, asc, desc, count, sql, inArray, gte, lte, ne`.
- Keep `createLog(...)` calls and socket emits exactly as-is — only data access changes.

### ⚠ Preserve each endpoint's exact response keys (casing)

supabase-js returned the **literal column names** you selected — i.e. snake_case
(`first_name`, `branch_id`, `is_active`). Drizzle returns **camelCase** property
names. The frontend reads a mix of both depending on endpoint, so a naïve
`db.select().from(t)` (camelCase) would silently break clients.

**Rule:** wherever a controller returns raw DB columns to a client, project them
back to snake_case explicitly. Shared projections live in `db/projections.js`
(`branchFull`, `userProfile`); add more there as needed.

```js
// returns { first_name, branch_id, ... } — matches the old supabase output
const [user] = await db.select(userProfile).from(users).where(eq(users.id, id)).limit(1);
```

Relationship aliases keep their camelCase alias names (`branch`, `currentBranch`)
and collapse to `null` when there's no related row (supabase nested-select
semantics) — see `authController.getCurrentUser`.

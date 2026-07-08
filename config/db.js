require("dotenv").config();
const pg = require("pg");
const { Pool } = pg;
const { drizzle } = require("drizzle-orm/node-postgres");
const schema = require("../db/schema");

// node-postgres returns `numeric`/`decimal` (OID 1700) as strings by default.
// supabase-js gave the clients numbers, and the frontend does JS math on money
// fields, so parse numerics to JS numbers to preserve API compatibility.
// (Typed Drizzle columns also use { mode: "number" }; this covers raw SQL too.)
pg.types.setTypeParser(1700, (v) => (v === null ? null : parseFloat(v)));

// Single shared connection pool for the whole API process.
// Replaces config/supabase.js. In Phase 2 (AWS), DATABASE_URL points at RDS;
// keep `max` modest so (Fargate tasks × pool size) stays under RDS
// max_connections — or front RDS with RDS Proxy when task count grows.
const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  max: Number(process.env.DB_POOL_MAX || 10),
  idleTimeoutMillis: 30_000,
  // Managed Postgres (RDS) terminates SSL; enable it outside local dev.
  ssl:
    process.env.DB_SSL === "true"
      ? { rejectUnauthorized: false }
      : false,
});

// `db` is the Drizzle query builder; `schema` re-exported for convenience so
// controllers can `const { db, schema } = require("../config/db")`.
const db = drizzle(pool, { schema });

module.exports = { db, pool, schema };

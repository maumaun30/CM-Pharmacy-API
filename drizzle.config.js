require("dotenv").config();
const { defineConfig } = require("drizzle-kit");

// Drizzle Kit config — used for `pull` (introspect existing DB) and, if we ever
// author schema changes in Drizzle, `generate`/`migrate`.
// The runtime data layer lives in db/schema.js + config/db.js; this file is
// tooling-only.
module.exports = defineConfig({
  dialect: "postgresql",
  schema: "./db/schema.js",
  out: "./drizzle",
  dbCredentials: {
    url: process.env.DATABASE_URL,
  },
});

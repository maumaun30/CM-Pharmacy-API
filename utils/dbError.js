// Drizzle wraps driver errors in a DrizzleQueryError whose `.message` is
// "Failed query: ..." — the meaningful Postgres message (e.g. a RAISE from an
// RPC like "Insufficient stock for product X") lives on `.cause.message`.
// supabase-js surfaced that Postgres message directly; use this to preserve
// the same client-facing error text, which the POS relies on.
const dbErrorMessage = (error) => error?.cause?.message || error?.message;

module.exports = { dbErrorMessage };

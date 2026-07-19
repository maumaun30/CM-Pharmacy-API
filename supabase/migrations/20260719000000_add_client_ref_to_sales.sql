-- Offline POS sync support: sales carry an optional client-generated UUID so
-- replaying a queued offline sale is idempotent (unique constraint rejects the
-- duplicate; the API returns the already-created sale instead).
ALTER TABLE sales ADD COLUMN client_ref uuid UNIQUE;

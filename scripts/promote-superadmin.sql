-- One-off promotion script: make an existing account THE superadmin.
-- The API never assigns this role; run this manually via psql.
-- The users_one_superadmin partial unique index guarantees only one can exist —
-- a second promotion attempt fails until the first is demoted.
--
-- Usage: edit the username below, then:
--   psql "$DATABASE_URL" -f scripts/promote-superadmin.sql
--
-- On next WEB login the account is forced through TOTP setup before receiving
-- a full token. Mobile POS and Maun Admin reject superadmin logins.

update users set role = 'superadmin' where username = '<chosen-username>';

-- Demote (if ever needed):
-- update users set role = 'admin', totp_enabled = false, totp_secret = null, totp_backup_codes = null where role = 'superadmin';

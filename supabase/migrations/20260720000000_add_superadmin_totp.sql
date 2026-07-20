-- Superadmin role + TOTP 2FA (see docs/superpowers/specs/2026-07-17-superadmin-totp-design.md)
--
-- `role` is plain text, so no enum DDL is needed for the new 'superadmin' value.
-- Promotion is a one-off manual script (scripts/promote-superadmin.sql) — the API
-- never assigns the superadmin role.
--
-- Recovery (last resort, authenticator + backup codes lost):
--   update users set totp_enabled = false, totp_secret = null, totp_backup_codes = null where role = 'superadmin';

alter table users
  add column if not exists totp_secret text,
  add column if not exists totp_enabled boolean not null default false,
  add column if not exists totp_backup_codes jsonb;

comment on column users.totp_secret is 'Base32 TOTP secret; null until 2FA enrollment starts';
comment on column users.totp_enabled is 'True once TOTP setup has been verified';
comment on column users.totp_backup_codes is 'Array of bcrypt hashes of unused one-time backup codes';

-- Exactly one superadmin account, enforced at the DB level.
create unique index if not exists users_one_superadmin on users ((role)) where role = 'superadmin';

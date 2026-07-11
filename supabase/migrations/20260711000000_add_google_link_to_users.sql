-- supabase/migrations/20260711000000_add_google_link_to_users.sql
--
-- Google account linking for staff logins (web + mobile).
-- google_sub is Google's stable subject id and is the ONLY key used to
-- authenticate a Google login. google_email is kept for audit/display only and
-- is never trusted as an identity claim. Accounts are still admin-provisioned;
-- Google can log in an existing user but can never create one.

alter table users add column if not exists google_sub       text unique;
alter table users add column if not exists google_email      text;
alter table users add column if not exists google_linked_at  timestamptz;

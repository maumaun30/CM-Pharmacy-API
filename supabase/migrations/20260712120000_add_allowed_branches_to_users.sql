-- Managers can be granted access to a SUBSET of branches (admins reach all).
-- allowed_branch_ids holds the branch ids a manager may switch between; empty /
-- null for admins (all branches) and cashiers (single home branch only).
alter table users
  add column if not exists allowed_branch_ids bigint[] not null default '{}'::bigint[];

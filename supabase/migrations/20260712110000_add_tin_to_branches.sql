-- Per-branch TIN (Tax Identification Number) for BIR-compliant receipt headers.
-- Each branch prints its own address (already stored) + TIN.
alter table branches
  add column if not exists tin text;

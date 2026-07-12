-- Capture the discount beneficiary on a sale (Senior Citizen / PWD purchases
-- require recording the customer's name + ID number for BIR compliance).
-- All nullable: a normal walk-in sale has no customer record.
alter table sales
  add column if not exists customer_name          text,
  add column if not exists customer_id_number     text,
  add column if not exists customer_discount_type  text;  -- 'SENIOR_CITIZEN' | 'PWD' | null

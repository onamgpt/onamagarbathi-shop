-- ===========================================================================
-- 0006 — Two-sided collection tracking
-- This is not the books; Tally is. This only bridges rep and owner: the rep
-- says money came in, the owner confirms or disputes it. Both sides are kept
-- separately and neither overwrites the other, so a disagreement stays on
-- the screen until somebody resolves it.
-- ===========================================================================

create table if not exists collection_claims (
  id          bigserial primary key,
  order_no    text not null,
  side        text not null,              -- rep | office
  actor       text,                       -- rep code, or 'office'
  amount      numeric not null,
  mode        text,                       -- cash | cheque | upi | neft | other
  reference   text,                       -- cheque no, UTR, whatever he was given
  note        text,
  proof_url   text,
  created_at  timestamptz default now()
);
create index if not exists idx_collection_claims_order on collection_claims (order_no);
alter table collection_claims enable row level security;

-- Each side's running total is held on the order, plus the dispute flag.
alter table trade_orders add column if not exists claimed_amount   numeric default 0;
alter table trade_orders add column if not exists confirmed_amount numeric default 0;
alter table trade_orders add column if not exists disputed         boolean default false;
alter table trade_orders add column if not exists dispute_note     text;
alter table trade_orders add column if not exists last_claim_at    timestamptz;

-- collected_amount from 0004 becomes the confirmed figure; keep them aligned
-- so nothing already recorded is lost.
update trade_orders set confirmed_amount = coalesce(collected_amount, 0)
 where confirmed_amount = 0 and coalesce(collected_amount, 0) > 0;

notify pgrst, 'reload schema';

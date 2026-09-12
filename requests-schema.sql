-- ===========================================================================
-- Buyer product requests. A buyer can ask for an item that is not yet in
-- their catalogue; it becomes a real product only when you approve it and
-- set the rate. Run once in Supabase → SQL Editor.
-- ===========================================================================
create table if not exists export_requests (
  id          bigserial primary key,
  buyer_code  text not null,
  sku         text,
  name        text not null,
  note        text,
  status      text default 'open',   -- open | approved | declined
  created_at  timestamptz default now()
);
create index if not exists idx_export_requests_buyer on export_requests(buyer_code, status);
alter table export_requests enable row level security;

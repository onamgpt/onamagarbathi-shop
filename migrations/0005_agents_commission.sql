-- ===========================================================================
-- 0005 — Agents and incidental commission
-- Commission is not a standing rate per rep: it is occasional and varies by
-- order. It is therefore captured per order, with an agent attached. The only
-- standing rate today is Rupesh (agent 2) at 14% of the pre-GST value.
-- ===========================================================================

-- Commission belongs to the order, not the rep.
alter table trade_reps drop column if exists commission_pct;

alter table trade_orders add column if not exists agent text;
alter table trade_orders add column if not exists commission_base numeric default 0;  -- pre-GST value used

create table if not exists trade_agents (
  id           bigserial primary key,
  name         text unique not null,
  default_pct  numeric default 0,      -- applied to the pre-GST (taxable) value
  note         text,
  active       boolean default true,
  created_at   timestamptz default now()
);
alter table trade_agents enable row level security;

insert into trade_agents (name, default_pct, note) values
  ('Rupesh (agent 2)', 14.0, 'Charges 14% before GST')
on conflict (name) do update set default_pct = excluded.default_pct, note = excluded.note;

create index if not exists idx_trade_orders_agent on trade_orders (agent);

notify pgrst, 'reload schema';

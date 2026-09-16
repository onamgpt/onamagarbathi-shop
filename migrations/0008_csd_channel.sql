-- ===========================================================================
-- 0008 — CSD as a first-class channel
-- Channels stop being hardcoded. Each one carries its own default trade
-- discount, so a new channel can be added later without touching code.
-- ===========================================================================
create table if not exists trade_channels (
  code             text primary key,
  name             text not null,
  default_disc_pct numeric default 0,
  sort_order       int default 0,
  active           boolean default true
);
alter table trade_channels enable row level security;

insert into trade_channels (code, name, default_disc_pct, sort_order) values
  ('TRADE', 'General Trade', 11, 1),
  ('CPC',   'CPC',            0, 2),
  ('CSD',   'CSD',            0, 3)
on conflict (code) do update
  set name = excluded.name, sort_order = excluded.sort_order, active = true;

-- Reps carry all three: the team picks up CPC and CSD while visiting trade.
update trade_reps set channels = '{TRADE,CPC,CSD}';

notify pgrst, 'reload schema';

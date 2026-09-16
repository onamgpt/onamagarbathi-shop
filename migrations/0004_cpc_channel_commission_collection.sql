-- ===========================================================================
-- 0004 — CPC channel, rep channels, commission and collection tracking
-- CPC is a separate channel with its own rate list. Its SKUs are the same
-- ONAONA... codes Spectrum's profit master uses, so margin works directly.
-- CPC rates are net per case: no trade discount, no scheme.
-- ===========================================================================

alter table trade_products add column if not exists channel text default 'TRADE';
alter table trade_products add column if not exists rate_per_case numeric;

-- The same SKU can now exist in more than one channel, so uniqueness moves
-- from sku alone to (channel, sku).
alter table trade_products drop constraint if exists trade_products_sku_key;
create unique index if not exists trade_products_channel_sku
  on trade_products (channel, sku);

update trade_products set channel = 'TRADE' where channel is null;

-- A rep may carry more than one channel: the team picks up CPC orders while
-- visiting trade outlets.
alter table trade_reps add column if not exists channels text[] default '{TRADE}';
alter table trade_reps add column if not exists commission_pct numeric default 0;
update trade_reps set channels = '{TRADE,CPC}' where channels is null or channels = '{TRADE}';

-- Order-level: which channel, what commission was earned, and what has been
-- collected against it.
alter table trade_orders add column if not exists channel text default 'TRADE';
alter table trade_orders add column if not exists commission_pct numeric default 0;
alter table trade_orders add column if not exists commission_amount numeric default 0;
alter table trade_orders add column if not exists collected_amount numeric default 0;
alter table trade_orders add column if not exists collection_status text default 'pending';
alter table trade_orders add column if not exists collected_at timestamptz;
alter table trade_orders add column if not exists spectrum_id text;

create index if not exists idx_trade_orders_collection
  on trade_orders (collection_status, channel);

-- --------------------------------------------------------------------------
-- CPC rate list (19 SKUs). Stored per dozen for consistency with the trade
-- list; rate_per_case is kept alongside because CPC buys by the case.
-- --------------------------------------------------------------------------
delete from trade_products where channel = 'CPC';
insert into trade_products
  (channel, sku, name, rate_per_doz, doz_per_ctn, sort_order) values
  ('CPC','ONAONA002380','Onam vaishak 100 gms',364.56,12.0,1),
  ('CPC','ONAONA002382','Onam Black Gem 100 gms',364.56,12.0,2),
  ('CPC','ONAONA002384','Onam Mysore Royal Sandal 115 gms',430.8,12.0,3),
  ('CPC','ONAONA002386','Onam Gulab 110 gms',364.56,12.0,4),
  ('CPC','ONAONA002388','Onam Lavender 100 Sticks',364.56,12.0,5),
  ('CPC','ONAONA002390','Onam Musk 90 gms',364.56,12.0,6),
  ('CPC','ONAONA002391','Onam Golden Buddha 50 gms',497.16,20.0,7),
  ('CPC','ONAONA002377','Onam Janthar Manthar 50 Sticks',198.84,30.0,8),
  ('CPC','ONAONA002376','Onam Kathakali 50 gms',198.84,30.0,9),
  ('CPC','ONAONA017954','Onam Vaishak Special 20 Sticks',132.6,30.0,10),
  ('CPC','ONAONA017961','Onam Nagarjuna 25 gms',132.6,30.0,11),
  ('CPC','ONAONA002378','Onam Mrignayani (3 x 1 ) 15 Sticks',99.48,30.0,12),
  ('CPC','ONAONA002381','Onam Nag Sambrani 8 Sticks',99.48,30.0,13),
  ('CPC','ONAONA017962','Onam Black gem 50 grams  Dhoop cones',310.8,12.0,14),
  ('CPC','ONAONA002385','Onam Mysore Royal Sandal 50 gms Dhoops Cones',310.8,12.0,15),
  ('CPC','ONAONA002387','Onam Gulab 50 gms Dhoop Cones',310.8,12.0,16),
  ('CPC','ONAONA002389','Onam Kalash 50 gms Dhoop Cones',310.8,12.0,17),
  ('CPC','ONAONA002392','Onam 50 gms Dhoop Cones',310.8,12.0,18),
  ('CPC','ONAONA002379','Onam Chandan 50 gms Cones',310.8,12.0,19);

update trade_products
   set rate_per_case = round(rate_per_doz * doz_per_ctn, 2),
       trade_disc_pct = 0,      -- CPC rates are net
       scheme_pct = 0,
       scheme_approved = false,
       moq_cartons = 1
 where channel = 'CPC';

notify pgrst, 'reload schema';

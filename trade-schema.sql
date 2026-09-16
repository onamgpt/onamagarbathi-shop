-- ===========================================================================
-- ONAM AGARBATHI — DOMESTIC TRADE ORDER PORTAL
-- Sales team order collection. Separate from the export tables so nothing
-- here can affect the export flow. Run once in Supabase -> SQL Editor.
-- ===========================================================================

create table if not exists trade_reps (
  id          bigserial primary key,
  code        text unique not null,
  name        text not null,
  territory   text,
  pin         text not null,
  active      boolean default true,
  created_at  timestamptz default now()
);

create table if not exists trade_products (
  id              bigserial primary key,
  sku             text unique not null,
  name            text not null,
  rate_per_doz    numeric not null,          -- list rate, before any discount
  doz_per_ctn     numeric not null,
  trade_disc_pct  numeric default 11,        -- standard trade discount
  scheme_pct      numeric default 0,         -- extra scheme, on top of trade
  scheme_from     date,
  scheme_to       date,
  scheme_approved boolean default false,     -- a scheme is dead until this is ticked
  moq_cartons     int default 1,
  hsn             text default '33074100',
  gst_pct         numeric default 5,
  image_url       text,
  sort_order      int default 0,
  active          boolean default true
);

create table if not exists trade_orders (
  id              bigserial primary key,
  order_no        text unique not null,
  rep_code        text not null,
  party_name      text not null,
  party_town      text,
  party_phone     text,
  party_gstin     text,
  lines           jsonb not null,
  total_cartons   int,
  gross_amount    numeric,     -- at list rate, before discount
  discount_amount numeric,     -- trade + scheme together
  net_amount      numeric,     -- taxable value
  gst_amount      numeric,
  grand_total     numeric,
  status          text default 'placed',  -- placed | confirmed | dispatched | cancelled
  notes           text,
  created_at      timestamptz default now()
);

create index if not exists idx_trade_orders_rep   on trade_orders(rep_code);
create index if not exists idx_trade_orders_party on trade_orders(party_name);

alter table trade_reps     enable row level security;
alter table trade_products enable row level security;
alter table trade_orders   enable row level security;

-- --------------------------------------------------------------------------
-- Price list (38 SKUs). Rates are per dozen, before the 11 percent discount.
-- --------------------------------------------------------------------------
delete from trade_products;
insert into trade_products (sku, name, rate_per_doz, doz_per_ctn, sort_order) values
  ('AN-3F-10-STICKS','AN 3F 10 STICKS',63.25,54.0,1),
  ('ONAM-SMALL-4-STICKS','ONAM SMALL 4 STICKS',24.0,96.0,2),
  ('ONAM-BIG-8-STICKS','ONAM BIG 8 STICKS',35.75,84.0,3),
  ('ONAM-KRISHNA-15-STICKS','ONAM KRISHNA 15 STICKS',30.0,87.0,4),
  ('DAY-NIGHT-40-GMS','DAY & NIGHT 40 GMS',144.0,20.0,5),
  ('ONAM-12-STICKS','ONAM 12 STICKS',77.0,30.0,6),
  ('GANESH-FLORA-12-STICKS','GANESH FLORA 12 STICKS',87.0,30.0,7),
  ('VAISHAK-12-STICKS','VAISHAK 12 STICKS',87.0,30.0,8),
  ('SANDAL-HEX-10-STICKS','SANDAL HEX 10 STICKS',74.5,24.0,9),
  ('SURBAHAR-HEX-15-STICKS','SURBAHAR HEX 15 STICKS',77.0,28.0,10),
  ('VAMANA-TUBE-30-STICKS','VAMANA TUBE 30 STICKS',30.0,84.25,11),
  ('NIRAMALA-TUBE-30-STICKS','NIRAMALA TUBE 30 STICKS',30.0,84.25,12),
  ('SARANAM','SARANAM',270.0,20.0,13),
  ('ONAM-100-STICKS','ONAM 100 STICKS',325.0,20.0,14),
  ('CHAMPA-100-STICKS','CHAMPA 100 STICKS',325.0,20.0,15),
  ('LAVENDER-100-STICKS','LAVENDER 100 STICKS',325.0,20.0,16),
  ('MUSK-100-STICKS','MUSK 100 STICKS',325.0,20.0,17),
  ('CHANDAN-100-STICKS','CHANDAN 100 STICKS',325.0,20.0,18),
  ('ABHISHEK-100-STICKS','ABHISHEK 100 STICKS',325.0,20.0,19),
  ('SANDAL-100-STICKS','SANDAL 100 STICKS',325.0,20.0,20),
  ('VISMAYA-ROSE-12-STICKS','VISMAYA ROSE 12 STICKS',82.0,30.0,21),
  ('VISMAYA-LAVENDER-12-STICKS','VISMAYA LAVENDER 12 STICKS',82.0,30.0,22),
  ('VISMAYA-SANDAL-12-STICKS','VISMAYA SANDAL 12 STICKS',82.0,30.0,23),
  ('VISMAYA-JASMINE-12-STICKS','VISMAYA JASMINE 12 STICKS',82.0,30.0,24),
  ('VISMAYA-CHAMPA-12-STICKS','VISMAYA CHAMPA 12 STICKS',82.0,30.0,25),
  ('VAISHAK-SPECIAL-100-GM','VAISHAK SPECIAL 100 GM',375.0,12.0,26),
  ('DARK-ANGEL-100-GM','DARK ANGEL 100 GM',375.0,12.0,27),
  ('BLACK-GEM-100-GM','BLACK GEM 100 GM',375.0,12.0,28),
  ('VISMAYA-ROSE-90-GM','VISMAYA ROSE 90 GM',375.0,12.0,29),
  ('VISMAYA-JASMINE-90-GM','VISMAYA JASMINE 90 GM',375.0,12.0,30),
  ('VISMAYA-CHAMPA-90-GM','VISMAYA CHAMPA 90 GM',375.0,12.0,31),
  ('LAVENDER-90-GMS','LAVENDER 90 GMS',375.0,12.0,32),
  ('SURABHI-90-GMS','SURABHI 90 GMS',375.0,12.0,33),
  ('OCEAN-90-GM','OCEAN 90 GM',375.0,12.0,34),
  ('SANDAL-80-GMS','SANDAL 80 GMS',375.0,12.0,35),
  ('GANESH-FLORA-80-GM','GANESH FLORA 80 GM',375.0,12.0,36),
  ('KESAR-CHANDAN-50-GM','KESAR CHANDAN 50 GM',450.0,14.0,37),
  ('SANDAL-45-GM','SANDAL 45 GM',180.0,28.0,38);

-- Example scheme, left switched off. Tick scheme_approved in the admin screen
-- to make it live, and it still only applies inside its date window.
update trade_products
   set scheme_pct = 8.33, scheme_from = '2026-09-16', scheme_to = '2026-10-30',
       scheme_approved = false
 where sku = 'ONAM-100-STICKS';

-- A first rep so you can sign in and test. Change the PIN in the admin screen.
insert into trade_reps (code, name, territory, pin)
values ('RK', 'Ravikiran Karapakala', 'All India', '2471')
on conflict (code) do nothing;

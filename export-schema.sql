-- ===========================================================================
-- ONAM AGARBATHI — EXPORT PORTAL SCHEMA (Supabase)
-- Run once in Supabase → SQL Editor → New query → Run.
-- Safe to re-run: every statement is idempotent.
-- ===========================================================================

create table if not exists export_buyers (
  id            bigserial primary key,
  code          text unique not null,
  name          text not null,
  country       text,
  pin           text not null,
  terms         text not null default 'on_arrival',   -- advance | deposit | on_arrival
  deposit_pct   numeric default 0,
  currency      text default 'USD',
  incoterm      text default 'C&F',
  port          text,
  active        boolean default true,
  created_at    timestamptz default now()
);

create table if not exists export_products (
  id               bigserial primary key,
  buyer_code       text not null,
  sku              text not null,
  name             text not null,
  units_per_carton int  default 24,
  rate_per_unit    numeric not null,
  moq_cartons      int  default 1,
  hs_code          text default '33074100',
  image_url        text,
  sort_order       int  default 0,
  active           boolean default true
);

create table if not exists export_orders (
  id               bigserial primary key,
  order_no         text unique not null,
  buyer_code       text not null,
  lines            jsonb not null,
  total_cartons    int,
  total_units      int,
  total_usd        numeric,
  terms            text,
  deposit_pct      numeric,
  deposit_usd      numeric,
  balance_usd      numeric,
  status           text default 'placed',   -- placed | deposit_paid | dispatched | closed
  shipping_bill_no text,
  notes            text,
  created_at       timestamptz default now()
);

create table if not exists export_payments (
  id                  bigserial primary key,
  order_no            text not null,
  leg                 text not null,          -- advance | balance
  purpose_code        text not null,          -- P0103 (pre-shipment) | P0102 (post-shipment)
  amount_usd          numeric,
  amount_inr          numeric,
  razorpay_order_id   text,
  razorpay_payment_id text,
  status              text default 'created',
  paid_at             timestamptz,
  created_at          timestamptz default now()
);

create index if not exists idx_export_products_buyer on export_products(buyer_code);
create index if not exists idx_export_orders_buyer   on export_orders(buyer_code);
create index if not exists idx_export_payments_order on export_payments(order_no);

-- Lock the tables to the service key only. The browser never touches Supabase
-- directly; everything goes through /.netlify/functions/export-api.
alter table export_buyers   enable row level security;
alter table export_products enable row level security;
alter table export_orders   enable row level security;
alter table export_payments enable row level security;

-- --------------------------------------------------------------------------
-- SEED: Dubai — Al Nasamat Gen. Trading Co. LLC
-- --------------------------------------------------------------------------
insert into export_buyers (code, name, country, pin, terms, deposit_pct, currency, incoterm, port)
values ('DUBAI', 'M/s. Al Nasamat Gen. Trading Co. LLC', 'United Arab Emirates',
        '4021', 'on_arrival', 0, 'USD', 'C&F', 'Jebel Ali')
on conflict (code) do nothing;

delete from export_products where buyer_code = 'DUBAI';
insert into export_products (buyer_code, sku, name, units_per_carton, rate_per_unit, moq_cartons, sort_order) values
 ('DUBAI','ONAM-3FRAG-100','ONAM 3 FRAGRANCE 100 STICKS',24,2.28,5,1),
 ('DUBAI','ONAM-ABHI-100','ONAM ABHISHEK 100 STICKS',24,2.28,5,2),
 ('DUBAI','ONAM-BLUE-100','ONAM BLUE 100 STICKS',24,2.28,5,3),
 ('DUBAI','ONAM-CHAMPA-100','ONAM CHAMPA 100 STICKS',24,2.28,5,4),
 ('DUBAI','ONAM-CHANDAN-100','ONAM CHANDAN 100 STICKS',24,2.28,5,5),
 ('DUBAI','ONAM-CINN-100','ONAM CINNAMON 100 STICKS',24,2.28,5,6),
 ('DUBAI','ONAM-CLOVE-100','ONAM CLOVE 100 STICKS',24,2.28,5,7),
 ('DUBAI','ONAM-GOLD-100','ONAM GOLD 100 STICKS',24,2.28,5,8),
 ('DUBAI','ONAM-LAV-100','ONAM LAVENDER 100 STICKS',24,2.28,5,9),
 ('DUBAI','ONAM-LILLY-100','ONAM LILLY 100 STICKS BOX',24,2.28,5,10),
 ('DUBAI','ONAM-LOBAN-100','ONAM LOBAN 100 STICKS',24,2.28,5,11),
 ('DUBAI','ONAM-LOTUS-100','ONAM LOTUS 100 STICKS',24,2.28,5,12),
 ('DUBAI','ONAM-MOGRA-100','ONAM MOGRA 100 STICKS',24,2.28,5,13),
 ('DUBAI','ONAM-MUSK-100','ONAM MUSK 100 STICKS',24,2.28,5,14),
 ('DUBAI','ONAM-PARI-100','ONAM PARIJATHA 100 STICKS',24,2.28,5,15),
 ('DUBAI','ONAM-SANDAL-100','ONAM SANDAL 100 STICKS',24,2.28,5,16),
 ('DUBAI','ONAM-SUPER-100','ONAM SUPERCLASS 100 STICKS',24,2.28,5,17),
 ('DUBAI','ONAM-TUBE-100','ONAM TUBEROSE 100 STICKS',24,2.28,5,18),
 ('DUBAI','ONAM-VISHU-100','ONAM VISHU 100 STICKS',24,2.28,5,19),
 ('DUBAI','ONAM-BUDDHA-100','ONAM GOLDEN BUDDHA 100 STICKS',24,2.50,5,20);

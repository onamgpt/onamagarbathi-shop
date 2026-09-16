-- ===========================================================================
-- 0009 — CSD price list and office-entered channels
-- CSD price revision Ref 4/GS/GP-II/6274-A/PR-2026-27, w.e.f. 17 Aug 2026.
--
-- CSD prices per EACH with a case pack, not per dozen. Stored per dozen so
-- every channel computes the same way, with the per-each and per-case figures
-- kept alongside for display, since that is how CSD talks about them.
--
-- CSD orders are not booked by a rep in the field: the depot raises a supply
-- order and the office enters it. entry_mode carries that distinction.
-- ===========================================================================

alter table trade_channels add column if not exists entry_mode text default 'rep';  -- rep | office
alter table trade_channels add column if not exists unit_label text default 'Dozen';
update trade_channels set entry_mode = 'office', unit_label = 'Each' where code = 'CSD';
update trade_channels set entry_mode = 'rep' where code in ('TRADE','CPC');

alter table trade_products add column if not exists rate_per_each  numeric;
alter table trade_products add column if not exists units_per_case numeric;
alter table trade_products add column if not exists mrp            numeric;
alter table trade_products add column if not exists trade_rate     numeric;
alter table trade_products add column if not exists index_no       text;
alter table trade_products add column if not exists effective_from date;

delete from trade_products where channel = 'CSD';
insert into trade_products
  (channel, sku, index_no, name, rate_per_each, units_per_case,
   rate_per_doz, doz_per_ctn, rate_per_case, mrp, trade_rate,
   trade_disc_pct, gst_pct, moq_cartons, effective_from, sort_order) values
 ('CSD','CSD-13094','13094','ONAM AGARBATTI SANDAL 7.5" LONG 100 ST',
   38.60, 240, 463.20, 20, 9264.00, 120.00, 69.25, 0, 5, 1, '2026-08-17', 1),
 ('CSD','CSD-13095','13095','ONAM A/BATTI 15 STICKS',
    7.83, 720,  93.96, 60, 5637.60,  25.00, 14.25, 0, 5, 1, '2026-08-17', 2),
 ('CSD','CSD-13130','13130','ONAM AGARBATTI ROSE 7.5" (100 STICKS)',
   40.78, 240, 489.36, 20, 9787.20, 125.00, 72.00, 0, 5, 1, '2026-08-17', 3),
 ('CSD','CSD-13132','13132','ONAM AGARBATTI 3 FRAGRANCE 7 1/2" (100 STICKS)',
   42.41, 240, 508.92, 20,10178.40, 130.00, 75.00, 0, 5, 1, '2026-08-17', 4);

notify pgrst, 'reload schema';

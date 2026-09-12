-- ===========================================================================
-- TRINIDAD — M/s. Little Store Ltd, Curepe, Trinidad and Tobago
-- Rates from proforma REF: EXP/22/26-27 dated 25.04.2026, CIF Port of Spain.
-- Unit = one pack; 25 packs per carton. Terms: 50% advance, 50% against
-- original bill of lading and invoice.
-- Run once in Supabase → SQL Editor. Safe to re-run.
-- ===========================================================================

update export_buyers
   set name        = 'M/s. Little Store Ltd',
       country     = 'Trinidad and Tobago',
       terms       = 'deposit',
       deposit_pct = 50,
       incoterm    = 'CIF',
       port        = 'Port of Spain',
       currency    = 'USD'
 where code = 'TRINIDAD';

-- If the buyer was not created in the admin screen, create it (PIN 7188).
insert into export_buyers (code, name, country, pin, terms, deposit_pct, currency, incoterm, port)
select 'TRINIDAD', 'M/s. Little Store Ltd', 'Trinidad and Tobago', '7188',
       'deposit', 50, 'USD', 'CIF', 'Port of Spain'
 where not exists (select 1 from export_buyers where code = 'TRINIDAD');

delete from export_products where buyer_code = 'TRINIDAD';
insert into export_products
  (buyer_code, sku, name, units_per_carton, rate_per_unit, moq_cartons, hs_code, sort_order) values
 ('TRINIDAD','ONAM-DURGA-9','ONAM DURGA 9 INCHES INCENSE POUCH',            25,1.600,10,'33074100',1),
 ('TRINIDAD','ONAM-GANESHA-9','ONAM GANESHA 9 INCHES INCENSE POUCH',        25,1.600,10,'33074100',2),
 ('TRINIDAD','ONAM-GANGAMATA-9','ONAM GANGA MATA 9 INCHES INCENSE POUCH',   25,1.600,10,'33074100',3),
 ('TRINIDAD','ONAM-HANUMAN-9','ONAM HANUMAN 9 INCHES INCENSE POUCH',        25,1.600,10,'33074100',4),
 ('TRINIDAD','ONAM-KALABAIRAV-9','ONAM KALABAIRAV 9 INCHES INCENSE POUCH',  25,1.600,10,'33074100',5),
 ('TRINIDAD','ONAM-KRISHNA-9','ONAM KRISHNA 9 INCHES INCENSE POUCH',        25,1.600,10,'33074100',6),
 ('TRINIDAD','ONAM-LAXMI-9','ONAM LAXMI 9 INCHES INCENSE POUCH',            25,1.600,10,'33074100',7),
 ('TRINIDAD','ONAM-JESUS-9','ONAM LORD JESUS 9 INCHES INCENSE POUCH',       25,1.600,10,'33074100',8),
 ('TRINIDAD','ONAM-MONEYDRAW-9','ONAM MONEY DRAWING 9 INCHES INCENSE POUCH',25,1.600,10,'33074100',9),
 ('TRINIDAD','ONAM-SARASWATI-9','ONAM SARASWATI 9 INCHES INCENSE POUCH',    25,1.600,10,'33074100',10),
 ('TRINIDAD','ONAM-SHIVA-9','ONAM SHIVA 9 INCHES INCENSE POUCH',            25,1.600,10,'33074100',11),
 ('TRINIDAD','ONAM-STANTHONY-9','ONAM ST. ANTHONY 9 INCHES INCENSE POUCH',  25,1.600,10,'33074100',12),
 ('TRINIDAD','ONAM-STJOSEPH-9','ONAM ST. JOSEPH 9 INCHES INCENSE POUCH',    25,1.600,10,'33074100',13),
 ('TRINIDAD','ONAM-STMICHAEL-9','ONAM ST. MICHAEL 9 INCHES INCENSE POUCH',  25,1.600,10,'33074100',14),
 ('TRINIDAD','ONAM-SURUJNARINE-9','ONAM SURUJNARINE 9 INCHES INCENSE POUCH',25,1.600,10,'33074100',15),
 ('TRINIDAD','ONAM-DEEBABA-9','ONAM DEE BABA 9 INCHES INCENSE POUCH',       25,1.600,10,'33074100',16),
 ('TRINIDAD','ONAM-8LONG','ONAM 8 LONG INCENSE STICKS',                     25,4.000, 5,'33074100',17);

-- Export catalogue product images — run once in the Supabase SQL editor
-- Uploaded to onamagarbathi.com/catalog-images/export/ on 13 Sep 2026

update export_products set image_url='/catalog-images/export/ONAM-BUDDHA-100.jpg' where sku='ONAM-BUDDHA-100';
update export_products set image_url='/catalog-images/export/ONAM-GANESHA-9.jpg' where sku='ONAM-GANESHA-9';
update export_products set image_url='/catalog-images/export/ONAM-GANGAMATA-9.jpg' where sku='ONAM-GANGAMATA-9';
update export_products set image_url='/catalog-images/export/ONAM-HANUMAN-9.jpg' where sku='ONAM-HANUMAN-9';
update export_products set image_url='/catalog-images/export/ONAM-JESUS-9.jpg' where sku='ONAM-JESUS-9';
update export_products set image_url='/catalog-images/export/ONAM-KRISHNA-9.jpg' where sku='ONAM-KRISHNA-9';
update export_products set image_url='/catalog-images/export/ONAM-LAXMI-9.jpg' where sku='ONAM-LAXMI-9';
update export_products set image_url='/catalog-images/export/ONAM-LOBAN-100.jpg' where sku='ONAM-LOBAN-100';
update export_products set image_url='/catalog-images/export/ONAM-MONEYDRAW-9.jpg' where sku='ONAM-MONEYDRAW-9';
update export_products set image_url='/catalog-images/export/ONAM-SARASWATI-9.jpg' where sku='ONAM-SARASWATI-9';
update export_products set image_url='/catalog-images/export/ONAM-SHIVA-9.jpg' where sku='ONAM-SHIVA-9';
update export_products set image_url='/catalog-images/export/ONAM-STANTHONY-9.jpg' where sku='ONAM-STANTHONY-9';
update export_products set image_url='/catalog-images/export/ONAM-STJOSEPH-9.jpg' where sku='ONAM-STJOSEPH-9';
update export_products set image_url='/catalog-images/export/ONAM-STMICHAEL-9.jpg' where sku='ONAM-STMICHAEL-9';

select sku, name, image_url from export_products order by buyer_code, sort_order;
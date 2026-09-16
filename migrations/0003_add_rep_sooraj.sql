-- Add Sooraj as a sales rep. Territory left blank; set it in the admin screen.
insert into trade_reps (code, name, territory, pin, active)
values ('SOORAJ', 'Sooraj', '', '5830', true)
on conflict (code) do update
   set name = excluded.name, pin = excluded.pin, active = true;

notify pgrst, 'reload schema';

-- ===========================================================================
-- 0007 — Storage for collection proof photos
-- Reps photograph the receipt or the UPI screen. The bucket is public-read so
-- the image opens from a plain link in the admin screen; the path carries a
-- timestamp so URLs are not guessable in practice.
-- ===========================================================================
insert into storage.buckets (id, name, public)
values ('collection-proofs', 'collection-proofs', true)
on conflict (id) do update set public = true;

notify pgrst, 'reload schema';

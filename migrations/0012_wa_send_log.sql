-- Customer WhatsApp send log (21 Nov 2026). Already applied directly; idempotent.
create table if not exists public.wa_send_log (
  id bigserial primary key,
  at timestamptz not null default now(),
  to_phone text, template text, order_id text, source text,
  ok boolean, wamid text, error text, status text, status_at timestamptz, fallback text
);
create index if not exists wa_send_log_wamid on public.wa_send_log (wamid);
create index if not exists wa_send_log_at on public.wa_send_log (at desc);
alter table public.wa_send_log enable row level security;

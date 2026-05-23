-- Run this once in Supabase → SQL Editor to create the videos table.

create table if not exists videos (
  id           uuid primary key default gen_random_uuid(),
  url          text not null,
  status       text not null default 'pending',  -- pending | processing | done | error
  transcript   text,
  error        text,
  chat_id      text,                             -- Telegram chat ID for notifications
  created_at   timestamptz default now(),
  processed_at timestamptz
);

-- Add column if upgrading from an older schema
alter table videos add column if not exists chat_id text;

-- Enable Realtime for this table (required for the WebSocket push to work)
alter publication supabase_realtime add table videos;

-- ── Row-Level Security ─────────────────────────────────────────────────────────
-- Allow the anon key to insert, select, and update rows (single-user app).
alter table videos enable row level security;

create policy "anon can insert"
  on videos for insert
  to anon
  with check (true);

create policy "anon can select"
  on videos for select
  to anon
  using (true);

create policy "anon can update"
  on videos for update
  to anon
  using (true);

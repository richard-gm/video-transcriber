-- Run this once in Supabase → SQL Editor to create the videos table.

create table if not exists videos (
  id           uuid primary key default gen_random_uuid(),
  url          text not null,
  status       text not null default 'pending',  -- pending | processing | done | error
  transcript   text,
  error        text,
  created_at   timestamptz default now(),
  processed_at timestamptz
);

-- Enable Realtime for this table (required for the WebSocket push to work)
alter publication supabase_realtime add table videos;

-- Migration 003: Niches lookup table
-- Run in Supabase → SQL Editor after 002_star_schema.sql

-- ── niches ────────────────────────────────────────────────────────────────────
create table if not exists niches (
  id           text primary key,
  display_name text not null
);

insert into niches (id, display_name) values
  ('business',   'Business'),
  ('ai',         'AI & Technology'),
  ('finance',    'Finance'),
  ('fitness',    'Fitness & Health'),
  ('lifestyle',  'Lifestyle'),
  ('education',  'Education'),
  ('marketing',  'Marketing'),
  ('other',      'Other')
on conflict (id) do nothing;

alter table niches enable row level security;
create policy "anon can select niches" on niches for select to anon using (true);
create policy "anon can insert niches" on niches for insert to anon with check (true);

-- ── Add niche FK to viral_references ─────────────────────────────────────────
alter table viral_references add column if not exists niche text references niches(id);

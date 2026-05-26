-- Migration 002: Star schema refactor
-- Run in Supabase → SQL Editor
-- Splits the monolithic videos table into a star schema.

-- ── 1. Platforms lookup table ──────────────────────────────────────────────────
create table if not exists platforms (
  id           text primary key,
  display_name text not null,
  viral_weights jsonb not null default '{}'
);

insert into platforms (id, display_name, viral_weights) values
  ('youtube',   'YouTube',   '{"hook_weight":0.20,"pacing_weight":0.15,"emotional_arc_weight":0.20,"cta_weight":0.15,"shareability_weight":0.15,"story_structure_weight":0.15}'),
  ('tiktok',    'TikTok',    '{"hook_weight":0.35,"pacing_weight":0.20,"emotional_arc_weight":0.15,"cta_weight":0.10,"shareability_weight":0.15,"story_structure_weight":0.05}'),
  ('instagram', 'Instagram', '{"hook_weight":0.30,"pacing_weight":0.15,"emotional_arc_weight":0.20,"cta_weight":0.10,"shareability_weight":0.20,"story_structure_weight":0.05}'),
  ('twitter',   'Twitter/X', '{"hook_weight":0.35,"pacing_weight":0.25,"emotional_arc_weight":0.15,"cta_weight":0.10,"shareability_weight":0.15,"story_structure_weight":0.00}'),
  ('facebook',  'Facebook',  '{"hook_weight":0.25,"pacing_weight":0.15,"emotional_arc_weight":0.20,"cta_weight":0.15,"shareability_weight":0.20,"story_structure_weight":0.05}'),
  ('linkedin',  'LinkedIn',  '{"hook_weight":0.20,"pacing_weight":0.15,"emotional_arc_weight":0.15,"cta_weight":0.20,"shareability_weight":0.15,"story_structure_weight":0.15}'),
  ('unknown',   'Unknown',   '{"hook_weight":0.25,"pacing_weight":0.15,"emotional_arc_weight":0.20,"cta_weight":0.15,"shareability_weight":0.15,"story_structure_weight":0.10}')
on conflict (id) do nothing;

alter table platforms enable row level security;
create policy "anon can select platforms" on platforms for select to anon using (true);

-- ── 2. Add platform FK to videos ───────────────────────────────────────────────
alter table videos add column if not exists platform text references platforms(id) default 'unknown';

-- ── 3. video_analysis satellite table ─────────────────────────────────────────
create table if not exists video_analysis (
  video_id        uuid primary key references videos(id) on delete cascade,
  summary         text,
  key_takeaways   jsonb,
  tips_and_tricks jsonb,
  category        text,
  tags            jsonb,
  chapters        jsonb,
  quotes          jsonb,
  action_items    jsonb,
  tone            text,
  analysed_at     timestamptz default now()
);

-- Migrate existing AI data out of videos
insert into video_analysis (
  video_id, summary, key_takeaways, tips_and_tricks,
  category, tags, chapters, quotes, action_items, tone, analysed_at
)
select
  id, summary, key_takeaways, tips_and_tricks,
  category, tags, chapters, quotes, action_items, tone,
  coalesce(processed_at, now())
from videos
where summary is not null
   or key_takeaways is not null
   or category is not null
on conflict (video_id) do nothing;

-- Drop old AI columns from videos
alter table videos drop column if exists summary;
alter table videos drop column if exists key_takeaways;
alter table videos drop column if exists tips_and_tricks;
alter table videos drop column if exists category;
alter table videos drop column if exists tags;
alter table videos drop column if exists chapters;
alter table videos drop column if exists quotes;
alter table videos drop column if exists action_items;
alter table videos drop column if exists tone;

alter table video_analysis enable row level security;
create policy "anon can select video_analysis"  on video_analysis for select  to anon using (true);
create policy "anon can insert video_analysis"  on video_analysis for insert  to anon with check (true);
create policy "anon can update video_analysis"  on video_analysis for update  to anon using (true);
create policy "anon can delete video_analysis"  on video_analysis for delete  to anon using (true);

-- ── 4. video_viral_scores satellite table ─────────────────────────────────────
create table if not exists video_viral_scores (
  video_id                uuid primary key references videos(id) on delete cascade,
  absolute_score          integer check (absolute_score between 0 and 100),
  platform_adjusted_score integer check (platform_adjusted_score between 0 and 100),
  hook_strength           integer check (hook_strength between 0 and 100),
  pacing_score            integer check (pacing_score between 0 and 100),
  emotional_arc_score     integer check (emotional_arc_score between 0 and 100),
  cta_score               integer check (cta_score between 0 and 100),
  shareability_score      integer check (shareability_score between 0 and 100),
  story_structure_score   integer check (story_structure_score between 0 and 100),
  hooks                   jsonb,   -- [{type, timestamp_s, text, score}]
  improvement_suggestions jsonb,   -- [{area, suggestion, potential_gain}]
  scored_at               timestamptz default now()
);

alter table video_viral_scores enable row level security;
create policy "anon can select video_viral_scores" on video_viral_scores for select to anon using (true);
create policy "anon can insert video_viral_scores" on video_viral_scores for insert to anon with check (true);
create policy "anon can update video_viral_scores" on video_viral_scores for update to anon using (true);

-- ── 5. viral_references baseline corpus ───────────────────────────────────────
create table if not exists viral_references (
  id             uuid primary key default gen_random_uuid(),
  platform       text references platforms(id),
  url            text not null,
  view_count     bigint,
  source_site    text,
  hooks          jsonb,
  viral_analysis jsonb,
  added_at       timestamptz default now()
);

alter table viral_references enable row level security;
create policy "anon can select viral_references" on viral_references for select to anon using (true);
create policy "anon can insert viral_references" on viral_references for insert to anon with check (true);
create policy "anon can update viral_references" on viral_references for update to anon using (true);

-- ── 6. Persistent chat tables ──────────────────────────────────────────────────
create table if not exists chat_sessions (
  id         uuid primary key default gen_random_uuid(),
  title      text,
  created_at timestamptz default now()
);

create table if not exists chat_messages (
  id         uuid primary key default gen_random_uuid(),
  session_id uuid not null references chat_sessions(id) on delete cascade,
  role       text not null check (role in ('user', 'assistant')),
  content    text not null,
  created_at timestamptz default now()
);

create index if not exists chat_messages_session_idx on chat_messages (session_id, created_at);

alter table chat_sessions enable row level security;
create policy "anon can select chat_sessions" on chat_sessions for select to anon using (true);
create policy "anon can insert chat_sessions" on chat_sessions for insert to anon with check (true);
create policy "anon can update chat_sessions" on chat_sessions for update to anon using (true);
create policy "anon can delete chat_sessions" on chat_sessions for delete to anon using (true);

alter table chat_messages enable row level security;
create policy "anon can select chat_messages" on chat_messages for select to anon using (true);
create policy "anon can insert chat_messages" on chat_messages for insert to anon with check (true);
create policy "anon can delete chat_messages" on chat_messages for delete to anon using (true);

-- ── 7. video_frames stub (TODO: frame-level vision analysis) ───────────────────
create table if not exists video_frames (
  id             uuid primary key default gen_random_uuid(),
  video_id       uuid not null references videos(id) on delete cascade,
  timestamp_ms   integer not null,
  storage_path   text,
  scene_type     text,
  frame_analysis jsonb,
  created_at     timestamptz default now()
);

create index if not exists video_frames_video_idx on video_frames (video_id, timestamp_ms);

alter table video_frames enable row level security;
create policy "anon can select video_frames" on video_frames for select to anon using (true);
create policy "anon can insert video_frames" on video_frames for insert to anon with check (true);
create policy "anon can update video_frames" on video_frames for update to anon using (true);

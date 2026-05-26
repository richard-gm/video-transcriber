-- Complete schema — run this on a fresh Supabase project.
-- For existing projects, run migrations/002_star_schema.sql instead.

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

-- ── platforms ──────────────────────────────────────────────────────────────────
create table if not exists platforms (
  id            text primary key,
  display_name  text not null,
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

-- ── videos (core fact table) ───────────────────────────────────────────────────
create table if not exists videos (
  id           uuid primary key default gen_random_uuid(),
  url          text not null,
  status       text not null default 'pending', -- pending|processing|done|error|cancelled
  transcript   text,
  error        text,
  chat_id      text,
  progress     jsonb default '{}',              -- {percentage, stage, message, eta}
  platform     text references platforms(id) default 'unknown',
  created_at   timestamptz default now(),
  processed_at timestamptz
);

create index if not exists videos_status_idx   on videos (status);
create index if not exists videos_platform_idx on videos (platform);

alter publication supabase_realtime add table videos;

alter table videos enable row level security;
create policy "anon can insert" on videos for insert to anon with check (true);
create policy "anon can select" on videos for select to anon using (true);
create policy "anon can update" on videos for update to anon using (true);
create policy "anon can delete" on videos for delete to anon using (true);

-- ── video_analysis (AI content analysis, 1:1 with videos) ─────────────────────
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

alter table video_analysis enable row level security;
create policy "anon can select video_analysis" on video_analysis for select to anon using (true);
create policy "anon can insert video_analysis" on video_analysis for insert to anon with check (true);
create policy "anon can update video_analysis" on video_analysis for update to anon using (true);
create policy "anon can delete video_analysis" on video_analysis for delete to anon using (true);

-- ── video_viral_scores (viral scoring, 1:1 with videos) ───────────────────────
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

-- ── viral_references (baseline corpus of known viral videos) ──────────────────
create table if not exists viral_references (
  id             uuid primary key default gen_random_uuid(),
  platform       text references platforms(id),
  niche          text references niches(id),
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

-- ── chat_sessions + chat_messages (persistent in-app chat) ────────────────────
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

-- ── video_frames (TODO: frame-level vision analysis) ──────────────────────────
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

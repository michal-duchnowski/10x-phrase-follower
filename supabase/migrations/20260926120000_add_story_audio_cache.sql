-- Narrative voice is persisted with story settings. Cached audio is deliberately
-- short-lived: stories are transient UI output and are not a media library.
alter table story_settings
  add column if not exists tts_voice_id text not null default 'en-GB-Chirp3-HD-Kore';

create table story_audio_cache (
  id uuid primary key,
  user_id uuid not null references users(id) on delete cascade,
  content_hash text not null,
  voice_id text not null,
  path text not null,
  expires_at timestamptz not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint story_audio_cache_hash_length check (char_length(content_hash) = 64),
  constraint story_audio_cache_unique_content_voice unique (user_id, content_hash, voice_id)
);

alter table story_audio_cache enable row level security;

create policy story_audio_cache_owner
  on story_audio_cache for all
  to authenticated
  using (user_id = auth.uid())
  with check (user_id = auth.uid());

create index story_audio_cache_expiry_idx on story_audio_cache (user_id, expires_at);

comment on table story_audio_cache is 'One-hour cache of generated Chirp 3 story narration.';

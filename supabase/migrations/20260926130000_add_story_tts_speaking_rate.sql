alter table story_settings
  add column if not exists tts_speaking_rate real not null default 1.0,
  add constraint story_settings_tts_speaking_rate_range
    check (tts_speaking_rate between 0.25 and 2.0);

comment on column story_settings.tts_speaking_rate is 'Chirp 3: HD narration pace, from 0.25x to 2.0x.';

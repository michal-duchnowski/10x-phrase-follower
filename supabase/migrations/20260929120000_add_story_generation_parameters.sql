alter table story_settings
  add column if not exists temperature double precision not null default 0.8,
  add column if not exists max_tokens integer not null default 800,
  add column if not exists thinking_enabled boolean not null default false,
  add constraint story_settings_temperature_range check (temperature between 0 and 2),
  add constraint story_settings_max_tokens_range check (max_tokens between 100 and 4000);

comment on column story_settings.temperature is 'DeepSeek sampling temperature for story generation.';
comment on column story_settings.max_tokens is 'Maximum DeepSeek completion tokens for story generation.';
comment on column story_settings.thinking_enabled is 'Whether to enable DeepSeek reasoning mode for story generation.';

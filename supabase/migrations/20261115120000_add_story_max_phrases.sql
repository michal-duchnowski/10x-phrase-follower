alter table story_settings
  add column max_phrases integer not null default 30,
  add constraint story_settings_max_phrases_range check (max_phrases between 3 and 100);

comment on column story_settings.max_phrases is 'Maximum expressions per story; larger selections are randomly sampled.';

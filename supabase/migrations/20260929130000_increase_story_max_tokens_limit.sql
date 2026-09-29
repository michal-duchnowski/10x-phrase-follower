alter table story_settings
  drop constraint if exists story_settings_max_tokens_range,
  add constraint story_settings_max_tokens_range check (max_tokens between 100 and 64000);

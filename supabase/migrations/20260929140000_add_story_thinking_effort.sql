alter table story_settings
  add column if not exists thinking_effort text not null default 'low',
  add constraint story_settings_thinking_effort_check check (thinking_effort in ('low', 'high', 'max'));

comment on column story_settings.thinking_effort is 'DeepSeek reasoning effort when story thinking mode is enabled.';

alter table flashcard_settings
  add column drill_repetitions integer not null default 3
  check (drill_repetitions between 1 and 10);

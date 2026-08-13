alter table flashcard_settings
  add column difficult_cards_per_training integer not null default 10
  check (difficult_cards_per_training between 1 and 100);

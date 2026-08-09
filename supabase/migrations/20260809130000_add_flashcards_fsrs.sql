create extension if not exists pgcrypto;

create type flashcard_direction_enum as enum ('en_to_pl', 'pl_to_en');
create type flashcard_status_enum as enum ('active', 'archived');
create type fsrs_card_state_enum as enum ('New', 'Learning', 'Review', 'Relearning');
create type fsrs_rating_enum as enum ('Again', 'Hard', 'Good', 'Easy');
create type answer_match_kind_enum as enum ('exact', 'contains', 'typo', 'incorrect', 'manual');

create table flashcards (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references users(id) on delete cascade,
  phrase_id uuid not null references phrases(id) on delete cascade,
  status flashcard_status_enum not null default 'active',
  added_at timestamptz not null default now(),
  archived_at timestamptz,
  unique (user_id, phrase_id)
);

create table flashcard_directions (
  id uuid primary key default gen_random_uuid(),
  flashcard_id uuid not null references flashcards(id) on delete cascade,
  direction flashcard_direction_enum not null,
  fsrs_state fsrs_card_state_enum not null default 'New',
  due_at timestamptz not null default now(),
  stability double precision not null default 0,
  difficulty double precision not null default 0,
  scheduled_days integer not null default 0,
  elapsed_days integer not null default 0,
  learning_steps integer not null default 0,
  reps integer not null default 0,
  lapses integer not null default 0,
  last_review_at timestamptz,
  reset_at timestamptz,
  unique (flashcard_id, direction)
);

create table flashcard_reviews (
  id uuid primary key default gen_random_uuid(),
  flashcard_direction_id uuid references flashcard_directions(id) on delete set null,
  flashcard_id uuid references flashcards(id) on delete set null,
  phrase_id uuid references phrases(id) on delete set null,
  user_id uuid not null references users(id) on delete cascade,
  direction flashcard_direction_enum not null,
  reviewed_at timestamptz not null default now(),
  fsrs_rating fsrs_rating_enum not null,
  answer_match_kind answer_match_kind_enum not null,
  user_answer text,
  expected_answer text not null,
  prompt_text text not null,
  previous_card jsonb not null,
  next_card jsonb not null,
  fsrs_log jsonb not null
);

create table flashcard_settings (
  user_id uuid primary key references users(id) on delete cascade,
  new_phrases_per_batch integer not null default 5 check (new_phrases_per_batch between 0 and 100),
  review_cards_per_batch integer not null default 50 check (review_cards_per_batch between 1 and 500),
  request_retention double precision not null default 0.9 check (request_retention between 0.7 and 0.98),
  updated_at timestamptz not null default now()
);

create index flashcards_idx_user_status on flashcards(user_id, status);
create index flashcard_directions_idx_due on flashcard_directions(due_at);
create index flashcard_reviews_idx_user_reviewed on flashcard_reviews(user_id, reviewed_at desc);

alter table flashcards enable row level security;
alter table flashcard_directions enable row level security;
alter table flashcard_reviews enable row level security;
alter table flashcard_settings enable row level security;

create policy flashcards_owner on flashcards for all to authenticated using (user_id = auth.uid()) with check (user_id = auth.uid());
create policy flashcard_settings_owner on flashcard_settings for all to authenticated using (user_id = auth.uid()) with check (user_id = auth.uid());
create policy flashcard_reviews_owner on flashcard_reviews for all to authenticated using (user_id = auth.uid()) with check (user_id = auth.uid());
create policy flashcard_directions_owner on flashcard_directions for all to authenticated
  using (exists (select 1 from flashcards f where f.id = flashcard_directions.flashcard_id and f.user_id = auth.uid()))
  with check (exists (select 1 from flashcards f where f.id = flashcard_directions.flashcard_id and f.user_id = auth.uid()));

create or replace function record_flashcard_review(
  p_direction_id uuid, p_user_id uuid, p_rating fsrs_rating_enum, p_match answer_match_kind_enum,
  p_user_answer text, p_expected text, p_prompt text, p_previous jsonb, p_next jsonb, p_log jsonb
) returns void language plpgsql security invoker as $$
declare v_flashcard_id uuid; v_phrase_id uuid; v_direction flashcard_direction_enum;
begin
  select d.flashcard_id, f.phrase_id, d.direction into v_flashcard_id, v_phrase_id, v_direction
  from flashcard_directions d join flashcards f on f.id = d.flashcard_id
  where d.id = p_direction_id and f.user_id = p_user_id and f.status = 'active' for update;
  if not found then raise exception 'Flashcard direction not found'; end if;
  update flashcard_directions set due_at = (p_next->>'due_at')::timestamptz, stability = (p_next->>'stability')::double precision,
    difficulty = (p_next->>'difficulty')::double precision, scheduled_days = (p_next->>'scheduled_days')::integer,
    elapsed_days = (p_next->>'elapsed_days')::integer, learning_steps = (p_next->>'learning_steps')::integer,
    reps = (p_next->>'reps')::integer, lapses = (p_next->>'lapses')::integer,
    fsrs_state = (p_next->>'fsrs_state')::fsrs_card_state_enum, last_review_at = nullif(p_next->>'last_review_at', '')::timestamptz
  where id = p_direction_id;
  insert into flashcard_reviews (flashcard_direction_id, flashcard_id, phrase_id, user_id, direction, fsrs_rating, answer_match_kind, user_answer, expected_answer, prompt_text, previous_card, next_card, fsrs_log)
  values (p_direction_id, v_flashcard_id, v_phrase_id, p_user_id, v_direction, p_rating, p_match, p_user_answer, p_expected, p_prompt, p_previous, p_next, p_log);
end; $$;

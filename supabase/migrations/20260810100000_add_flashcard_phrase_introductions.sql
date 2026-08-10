create table flashcard_phrase_introductions (
  user_id uuid not null references users(id) on delete cascade,
  phrase_id uuid not null references phrases(id) on delete cascade,
  introduced_on date not null,
  introduced_at timestamptz not null default now(),
  primary key (user_id, phrase_id)
);

create index flashcard_phrase_introductions_user_day_idx
  on flashcard_phrase_introductions(user_id, introduced_on);

alter table flashcard_phrase_introductions enable row level security;

create policy flashcard_phrase_introductions_owner on flashcard_phrase_introductions for all to authenticated
  using (user_id = auth.uid()) with check (user_id = auth.uid());

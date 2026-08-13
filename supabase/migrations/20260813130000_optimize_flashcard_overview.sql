-- Covers the overview's join from a user's active flashcards to their directions.
create index if not exists flashcard_directions_idx_flashcard_overview
  on flashcard_directions(flashcard_id, fsrs_state, due_at)
  include (reps);

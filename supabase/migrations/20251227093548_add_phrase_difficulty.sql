-- Add difficulty column to phrases table
-- Difficulty is a nullable text field with check constraint: 'easy', 'medium', 'hard', or NULL (unset)

ALTER TABLE phrases ADD COLUMN difficulty text NULL;

-- Add check constraint to ensure only valid values
ALTER TABLE phrases ADD CONSTRAINT phrases_difficulty_check 
  CHECK (difficulty IS NULL OR difficulty IN ('easy', 'medium', 'hard'));

-- Add composite index for efficient filtering by notebook_id, difficulty, and position
CREATE INDEX phrases_idx_notebook_difficulty_position 
  ON phrases(notebook_id, difficulty, position);

-- Add comment
COMMENT ON COLUMN phrases.difficulty IS 'Difficulty level: easy, medium, hard, or NULL (unset)';


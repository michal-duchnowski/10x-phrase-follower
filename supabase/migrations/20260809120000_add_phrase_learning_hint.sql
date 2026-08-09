-- Add optional Markdown learning hints for phrases.

ALTER TABLE phrases ADD COLUMN learning_hint_markdown text NULL;

ALTER TABLE phrases ADD CONSTRAINT phrases_learning_hint_markdown_length_check
  CHECK (learning_hint_markdown IS NULL OR char_length(learning_hint_markdown) <= 12000);

COMMENT ON COLUMN phrases.learning_hint_markdown IS 'Optional educational note in Markdown. Not part of the answer text.';

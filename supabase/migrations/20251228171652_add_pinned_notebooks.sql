-- Add pinned_notebooks table for user-pinned notebooks
-- Allows users to pin 2-5 notebooks for quick access

CREATE TABLE pinned_notebooks (
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  notebook_id uuid NOT NULL REFERENCES notebooks(id) ON DELETE CASCADE,
  created_at timestamptz NOT NULL DEFAULT now(),
  
  -- Constraints
  PRIMARY KEY (user_id, notebook_id)
);

-- Enable RLS: users can only access their own pins
ALTER TABLE pinned_notebooks ENABLE ROW LEVEL SECURITY;

-- RLS policy: users can only see their own pinned notebooks
CREATE POLICY pinned_notebooks_select_own ON pinned_notebooks
  FOR SELECT
  USING (auth.uid() = user_id);

-- RLS policy: users can only insert their own pins
CREATE POLICY pinned_notebooks_insert_own ON pinned_notebooks
  FOR INSERT
  WITH CHECK (auth.uid() = user_id);

-- RLS policy: users can only delete their own pins
CREATE POLICY pinned_notebooks_delete_own ON pinned_notebooks
  FOR DELETE
  USING (auth.uid() = user_id);

-- Index for efficient lookups
CREATE INDEX pinned_notebooks_user_id_idx ON pinned_notebooks(user_id);
CREATE INDEX pinned_notebooks_notebook_id_idx ON pinned_notebooks(notebook_id);

-- Comments
COMMENT ON TABLE pinned_notebooks IS 'User-pinned notebooks for quick access';
COMMENT ON COLUMN pinned_notebooks.user_id IS 'User who pinned the notebook';
COMMENT ON COLUMN pinned_notebooks.notebook_id IS 'Pinned notebook ID';
COMMENT ON COLUMN pinned_notebooks.created_at IS 'When the notebook was pinned';


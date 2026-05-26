ALTER TABLE execution_history
  ADD COLUMN original_bytes INTEGER;

ALTER TABLE execution_history
  ADD COLUMN final_bytes INTEGER;

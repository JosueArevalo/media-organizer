ALTER TABLE execution_history
ADD COLUMN compression_active_duration_ms INTEGER;

ALTER TABLE execution_history
ADD COLUMN compression_active_started_at TEXT;

BEGIN TRANSACTION;

ALTER TABLE execution_history
  ADD COLUMN verification_json TEXT;

COMMIT;

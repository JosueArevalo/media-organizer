BEGIN TRANSACTION;

ALTER TABLE export_jobs ADD COLUMN execution_id TEXT;
ALTER TABLE export_jobs ADD COLUMN destination_label TEXT;
ALTER TABLE export_jobs ADD COLUMN eligible_items INTEGER NOT NULL DEFAULT 0;
ALTER TABLE export_jobs ADD COLUMN eligible_albums INTEGER NOT NULL DEFAULT 0;

CREATE INDEX IF NOT EXISTS idx_export_jobs_execution_id ON export_jobs(execution_id);

UPDATE export_jobs
SET execution_id = (
  SELECT execution_history.id
  FROM execution_history
  WHERE execution_history.output_root = export_jobs.source_root
)
WHERE execution_id IS NULL
  AND (
    SELECT COUNT(*)
    FROM execution_history
    WHERE execution_history.output_root = export_jobs.source_root
  ) = 1;

UPDATE export_jobs
SET destination_label = target_path
WHERE target_type = 'network-folder'
  AND destination_label IS NULL;

UPDATE export_jobs
SET eligible_items = total_items
WHERE eligible_items = 0;

UPDATE export_jobs
SET destination_label = (
  SELECT google_photos_accounts.email
  FROM export_items
  JOIN export_google_photos_items ON export_google_photos_items.item_id = export_items.id
  JOIN google_photos_accounts ON google_photos_accounts.id = export_google_photos_items.account_id
  WHERE export_items.job_id = export_jobs.id
  LIMIT 1
)
WHERE target_type = 'google-photos'
  AND destination_label IS NULL
  AND (
    SELECT COUNT(DISTINCT export_google_photos_items.account_id)
    FROM export_items
    JOIN export_google_photos_items ON export_google_photos_items.item_id = export_items.id
    WHERE export_items.job_id = export_jobs.id
  ) = 1;

UPDATE export_jobs
SET eligible_items = (
  SELECT COUNT(*)
  FROM export_items
  WHERE export_items.job_id = export_jobs.id
    AND NOT (
      export_items.status = 'skipped'
      AND export_items.last_error = 'File type is not supported by Google Photos.'
    )
),
eligible_albums = (
  SELECT COUNT(DISTINCT destination_path)
  FROM export_items
  WHERE export_items.job_id = export_jobs.id
    AND NOT (
      export_items.status = 'skipped'
      AND export_items.last_error = 'File type is not supported by Google Photos.'
    )
)
WHERE target_type = 'google-photos';

COMMIT;

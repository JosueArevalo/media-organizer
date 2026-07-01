ALTER TABLE execution_history
  ADD COLUMN image_quality INTEGER;

UPDATE execution_history
SET image_quality = (
  SELECT CAST(
    json_extract(
      CASE WHEN json_valid(session_checkpoints.payload_json) THEN session_checkpoints.payload_json END,
      '$.manifest.imageQuality'
    ) AS INTEGER
  )
  FROM session_checkpoints
  WHERE session_checkpoints.session_id = execution_history.session_id
    AND session_checkpoints.stage = 'compress'
    AND json_valid(session_checkpoints.payload_json)
  LIMIT 1
)
WHERE image_quality IS NULL
  AND EXISTS (
    SELECT 1
    FROM session_checkpoints
    WHERE session_checkpoints.session_id = execution_history.session_id
      AND session_checkpoints.stage = 'compress'
      AND json_valid(session_checkpoints.payload_json)
      AND json_type(
        CASE WHEN json_valid(session_checkpoints.payload_json) THEN session_checkpoints.payload_json END,
        '$.manifest.imageQuality'
      ) IN ('integer', 'real')
  );

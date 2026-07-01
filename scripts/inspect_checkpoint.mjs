import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { DatabaseSync } from 'node:sqlite';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const dbPath = path.resolve(__dirname, '..', 'apps', 'backend', '.data', 'media-organizer.sqlite');

try {
  const db = new DatabaseSync(dbPath);
  const row = db.prepare("SELECT id, job_id, stage, payload_json, updated_at FROM job_checkpoints WHERE stage = 'compress' ORDER BY updated_at DESC LIMIT 1;").get();

  if (!row) {
    console.error('No compress checkpoint row found');
    process.exit(2);
  }

  console.log('--- CHECKPOINT METADATA ---');
  console.log('id:', row.id);
  console.log('job_id:', row.job_id);
  console.log('stage:', row.stage);
  console.log('updated_at:', row.updated_at);
  console.log('--- PAYLOAD_JSON START ---');
  console.log(row.payload_json);
  console.log('--- PAYLOAD_JSON END ---');
  process.exit(0);
} catch (err) {
  console.error('Error reading DB:', err && err.message ? err.message : err);
  process.exit(1);
}

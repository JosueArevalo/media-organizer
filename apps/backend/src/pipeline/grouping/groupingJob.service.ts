import fs from 'node:fs';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { getDb } from '../../state/db.js';
import { runMigrations } from '../../state/migrations/runMigrations.js';
import type { SessionCheckpointRecord, SessionRecord } from '../../state/dto/state.types.js';
import type {
  GroupingProgressData,
  GroupingSessionLaunchResult,
  GroupingSessionManifest,
  GroupingSessionRequest
} from './grouping.types.js';

const nowIso = () => new Date().toISOString();

const ensureDirectory = (directoryPath: string) => {
  fs.mkdirSync(directoryPath, { recursive: true });
};

const buildGroupingSessionOutputRoot = (outputDir: string, _timestamp: string) => outputDir;

const buildGroupingManifestPath = (outputRoot: string) => path.join(outputRoot, '.media-organizer', 'grouping-manifest.json');

const toSessionRecord = (row: {
  id: string;
  name: string | null;
  source_dir: string;
  output_dir: string;
  status: SessionRecord['status'];
  created_at: string;
  updated_at: string;
  last_opened_at: string | null;
}): SessionRecord => ({
  id: row.id,
  name: row.name,
  sourceDir: row.source_dir,
  outputDir: row.output_dir,
  status: row.status,
  createdAt: row.created_at,
  updatedAt: row.updated_at,
  lastOpenedAt: row.last_opened_at
});

const toCheckpointRecord = (row: {
  id: string;
  session_id: string;
  stage: SessionCheckpointRecord['stage'];
  cursor: string | null;
  payload_json: string | null;
  updated_at: string;
}): SessionCheckpointRecord => ({
  id: row.id,
  sessionId: row.session_id,
  stage: row.stage,
  cursor: row.cursor,
  payloadJson: row.payload_json,
  updatedAt: row.updated_at
});

const upsertSession = (request: GroupingSessionRequest, sessionId: string, timestamp: string): SessionRecord => {
  const db = getDb();

  db.prepare(
    `
      INSERT INTO sessions (id, name, source_dir, output_dir, status, created_at, updated_at, last_opened_at)
      VALUES (?, ?, ?, ?, 'running', ?, ?, ?)
      ON CONFLICT(id) DO UPDATE SET
        name = excluded.name,
        source_dir = excluded.source_dir,
        output_dir = excluded.output_dir,
        status = excluded.status,
        updated_at = excluded.updated_at,
        last_opened_at = excluded.last_opened_at
    `
  ).run(sessionId, request.name ?? null, request.sourceDir, request.outputDir, timestamp, timestamp, timestamp);

  const row = db
    .prepare('SELECT id, name, source_dir, output_dir, status, created_at, updated_at, last_opened_at FROM sessions WHERE id = ?')
    .get(sessionId) as Parameters<typeof toSessionRecord>[0];

  return toSessionRecord(row);
};

const upsertGroupingCheckpoint = (
  sessionId: string,
  outputRoot: string,
  manifest: GroupingSessionManifest,
  timestamp: string
): SessionCheckpointRecord => {
  const db = getDb();

  db.prepare(
    `
      INSERT INTO session_checkpoints (id, session_id, stage, cursor, payload_json, updated_at)
      VALUES (?, ?, 'group', NULL, ?, ?)
      ON CONFLICT(session_id, stage) DO UPDATE SET
        payload_json = excluded.payload_json,
        updated_at = excluded.updated_at
    `
  ).run(randomUUID(), sessionId, JSON.stringify({ outputRoot, manifest, totalCount: 0, summary: { completedItems: 0, failedItems: 0 } }), timestamp);

  const row = db
    .prepare('SELECT id, session_id, stage, cursor, payload_json, updated_at FROM session_checkpoints WHERE session_id = ? AND stage = ?')
    .get(sessionId, 'group') as Parameters<typeof toCheckpointRecord>[0];

  return toCheckpointRecord(row);
};

const getGroupingSourceSessionId = (sessionId: string) => {
  const db = getDb();
  const row = db
    .prepare('SELECT payload_json FROM session_checkpoints WHERE session_id = ? AND stage = ?')
    .get(sessionId, 'group') as { payload_json: string | null } | undefined;

  if (!row?.payload_json) {
    return sessionId;
  }

  try {
    const payload = JSON.parse(row.payload_json) as { manifest?: { compressionSessionId?: string | null } };
    return payload.manifest?.compressionSessionId ?? sessionId;
  } catch {
    return sessionId;
  }
};

export const startGroupingSession = (request: GroupingSessionRequest): GroupingSessionLaunchResult => {
  runMigrations();

  const sessionId = randomUUID();
  const timestamp = nowIso();
  const outputRoot = buildGroupingSessionOutputRoot(request.outputDir, timestamp);
  const manifestPath = buildGroupingManifestPath(outputRoot);
  const manifest: GroupingSessionManifest = {
    sessionId,
    sourceDir: request.sourceDir,
    outputDir: request.outputDir,
    outputRoot,
    compressionSessionId: request.compressionSessionId ?? null,
    strategy: request.strategy ?? 'date',
    autoRename: request.autoRename ?? true,
    createdAt: timestamp
  };

  ensureDirectory(outputRoot);
  ensureDirectory(path.dirname(manifestPath));
  fs.writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`, 'utf8');

  const session = upsertSession(request, sessionId, timestamp);
  const checkpoint = upsertGroupingCheckpoint(sessionId, outputRoot, manifest, timestamp);

  return {
    session,
    checkpoint,
    manifest,
    outputRoot,
    manifestPath
  };
};

export const getGroupingSession = (sessionId: string) => {
  runMigrations();
  const db = getDb();

  const sessionRow = db
    .prepare('SELECT id, name, source_dir, output_dir, status, created_at, updated_at, last_opened_at FROM sessions WHERE id = ?')
    .get(sessionId) as Parameters<typeof toSessionRecord>[0] | undefined;

  if (!sessionRow) {
    return null;
  }

  const checkpointRow = db
    .prepare('SELECT id, session_id, stage, cursor, payload_json, updated_at FROM session_checkpoints WHERE session_id = ? AND stage = ?')
    .get(sessionId, 'group') as Parameters<typeof toCheckpointRecord>[0] | undefined;

  return {
    session: toSessionRecord(sessionRow),
    checkpoint: checkpointRow ? toCheckpointRecord(checkpointRow) : null
  };
};

export const getGroupingProgress = (sessionId: string): GroupingProgressData | null => {
  runMigrations();
  const db = getDb();

  const session = db
    .prepare('SELECT id, status FROM sessions WHERE id = ?')
    .get(sessionId) as { id: string; status: string } | undefined;

  if (!session) {
    return null;
  }

  const sourceSessionId = getGroupingSourceSessionId(sessionId);

  const totals = db
    .prepare(
      `
        SELECT
          COUNT(*) AS total,
          SUM(CASE WHEN iss.status = 'completed' THEN 1 ELSE 0 END) AS completed,
          SUM(CASE WHEN iss.status = 'failed' THEN 1 ELSE 0 END) AS failed
        FROM item_decisions decision
        LEFT JOIN item_stage_status iss
          ON iss.session_id = ?
          AND iss.item_id = decision.item_id
          AND iss.stage = 'group'
        WHERE decision.session_id = ?
          AND decision.selected_for_output = 1
      `
    )
    .get(sessionId, sourceSessionId) as { total: number; completed: number | null; failed: number | null };

  const groupRows = db
    .prepare(
      `
        SELECT
          COALESCE(decision.target_group_label, 'Ungrouped') AS label,
          COUNT(*) AS total,
          SUM(CASE WHEN iss.status = 'completed' THEN 1 ELSE 0 END) AS completed,
          SUM(CASE WHEN iss.status = 'failed' THEN 1 ELSE 0 END) AS failed
        FROM item_decisions decision
        LEFT JOIN item_stage_status iss
          ON iss.session_id = ?
          AND iss.item_id = decision.item_id
          AND iss.stage = 'group'
        WHERE decision.session_id = ?
          AND decision.selected_for_output = 1
        GROUP BY COALESCE(decision.target_group_label, 'Ungrouped')
        ORDER BY label ASC
      `
    )
    .all(sessionId, sourceSessionId) as Array<{ label: string; total: number; completed: number | null; failed: number | null }>;

  const processedItems = db
    .prepare(
      `
        SELECT mi.id, mi.source_path, decision.target_group_label, iss.status
        FROM item_stage_status iss
        JOIN media_items mi ON mi.id = iss.item_id
        LEFT JOIN item_decisions decision
          ON decision.session_id = ?
          AND decision.item_id = iss.item_id
        WHERE iss.session_id = ?
          AND iss.stage = 'group'
          AND iss.status IN ('completed', 'failed', 'skipped')
        ORDER BY iss.updated_at DESC
        LIMIT 50
      `
    )
    .all(sourceSessionId, sessionId) as Array<{
    id: string;
    source_path: string;
    target_group_label: string | null;
    status: 'completed' | 'failed' | 'skipped';
  }>;

  return {
    sessionId,
    status: session.status,
    total: totals.total,
    completed: totals.completed ?? 0,
    failed: totals.failed ?? 0,
    groups: groupRows.map((row) => ({
      label: row.label,
      total: row.total,
      completed: row.completed ?? 0,
      failed: row.failed ?? 0
    })),
    processedItems: processedItems.map((item) => ({
      id: item.id,
      sourcePath: item.source_path,
      targetGroupLabel: item.target_group_label,
      status: item.status
    }))
  };
};

const updateGroupingSessionStatus = (sessionId: string, status: SessionRecord['status']) => {
  runMigrations();
  const db = getDb();
  const timestamp = nowIso();

  db.prepare('UPDATE sessions SET status = ?, updated_at = ?, last_opened_at = ? WHERE id = ?').run(status, timestamp, timestamp, sessionId);

  return getGroupingSession(sessionId);
};

export const pauseGroupingSession = (sessionId: string) => updateGroupingSessionStatus(sessionId, 'paused');

export const resumeGroupingSession = (sessionId: string) => updateGroupingSessionStatus(sessionId, 'running');

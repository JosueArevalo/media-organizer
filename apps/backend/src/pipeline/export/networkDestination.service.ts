import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { getDb } from '../../state/db.js';
import { runMigrations } from '../../state/migrations/runMigrations.js';
import type {
  NetworkAuthRequest,
  NetworkBrowseRequest,
  NetworkBrowseResult,
  NetworkCreateFolderRequest,
  NetworkCredentials,
  NetworkDestinationRecord,
  NetworkDestinationRequest
} from './export.types.js';

const nowIso = () => new Date().toISOString();

export class NetworkPathError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'NetworkPathError';
  }
}

const toDestinationRecord = (row: {
  id: string;
  name: string;
  root_path: string;
  username: string | null;
  created_at: string;
  updated_at: string;
  last_used_at: string | null;
}): NetworkDestinationRecord => ({
  id: row.id,
  name: row.name,
  rootPath: row.root_path,
  username: row.username,
  createdAt: row.created_at,
  updatedAt: row.updated_at,
  lastUsedAt: row.last_used_at
});

const assertWindows = () => {
  if (os.platform() !== 'win32') {
    throw new NetworkPathError('Network folder authentication and browsing are currently supported on Windows only.');
  }
};

export const parseUncPath = (value: string) => {
  const trimmed = value.trim().replace(/\//g, '\\').replace(/\\+$/, '');
  const match = trimmed.match(/^\\\\([^\\]+)(?:\\([^\\]+)(.*)?)?$/);

  if (!match) {
    throw new NetworkPathError('Use a UNC path such as \\\\server\\share.');
  }

  const segments = trimmed.split('\\').filter(Boolean);

  if (segments.some((segment) => segment === '.' || segment === '..')) {
    throw new NetworkPathError('UNC paths cannot contain relative path segments.');
  }

  return {
    normalized: trimmed,
    host: match[1],
    share: match[2] ?? null,
    tail: match[3] ?? ''
  };
};

const getConnectionTarget = (uncPath: string) => {
  const parsed = parseUncPath(uncPath);
  return parsed.share ? `\\\\${parsed.host}\\${parsed.share}` : `\\\\${parsed.host}\\IPC$`;
};

const hasShareSegment = (uncPath: string) => Boolean(parseUncPath(uncPath).share);

const getParentUncPath = (uncPath: string) => {
  const parsed = parseUncPath(uncPath);

  if (!parsed.share) {
    return null;
  }

  const segments = parsed.normalized.split('\\').filter(Boolean);

  if (segments.length <= 2) {
    return `\\\\${parsed.host}`;
  }

  return `\\\\${segments.slice(0, -1).join('\\')}`;
};

const isSameOrUnderRoot = (rootPath: string | undefined, candidatePath: string) => {
  if (!rootPath?.trim()) {
    return true;
  }

  const root = parseUncPath(rootPath).normalized.toLowerCase();
  const candidate = parseUncPath(candidatePath).normalized.toLowerCase();

  return candidate === root || candidate.startsWith(`${root}\\`);
};

const runWindowsCommand = async (command: string, args: string[]) => {
  assertWindows();

  return await new Promise<{ stdout: string; stderr: string }>((resolve, reject) => {
    const child = spawn(command, args, {
      windowsHide: true,
      stdio: ['ignore', 'pipe', 'pipe']
    });
    const stdoutChunks: Buffer[] = [];
    const stderrChunks: Buffer[] = [];

    child.stdout.on('data', (chunk) => stdoutChunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk)));
    child.stderr.on('data', (chunk) => stderrChunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk)));
    child.on('error', reject);
    child.on('close', (code) => {
      const stdout = Buffer.concat(stdoutChunks).toString('utf8');
      const stderr = Buffer.concat(stderrChunks).toString('utf8');

      if (code !== 0) {
        reject(new NetworkPathError((stderr || stdout || `Command failed with code ${code}.`).trim()));
        return;
      }

      resolve({ stdout, stderr });
    });
  });
};

export const authenticateNetworkPath = async (request: NetworkAuthRequest) => {
  const username = request.credentials.username?.trim();
  const password = request.credentials.password ?? '';

  if (!username || !password) {
    throw new NetworkPathError('Username and password are required to authenticate this network path.');
  }

  const target = getConnectionTarget(request.path);
  const persistence = request.credentials.rememberInWindows ? '/persistent:yes' : '/persistent:no';

  await runWindowsCommand('net.exe', ['use', target, password, `/user:${username}`, persistence]);

  return {
    ok: true,
    message: request.credentials.rememberInWindows
      ? 'Authenticated. Windows may remember these credentials.'
      : 'Authenticated for the current Windows session.'
  };
};

const maybeAuthenticate = async (networkPath: string, credentials?: NetworkCredentials) => {
  if (credentials?.username?.trim() || credentials?.password) {
    await authenticateNetworkPath({ path: networkPath, credentials });
  }
};

const parseNetViewShares = (stdout: string, host: string) => {
  const lines = stdout.split(/\r?\n/);
  const entries: Array<{ name: string; path: string; kind: 'share' }> = [];
  let inTable = false;

  for (const line of lines) {
    const trimmed = line.trim();

    if (!trimmed) {
      continue;
    }

    if (/^-{3,}/.test(trimmed)) {
      inTable = true;
      continue;
    }

    if (!inTable || /command completed|comando se complet/i.test(trimmed)) {
      continue;
    }

    const shareName = trimmed.split(/\s{2,}|\t/)[0]?.trim();

    if (!shareName || shareName.endsWith('$')) {
      continue;
    }

    entries.push({
      name: shareName,
      path: `\\\\${host}\\${shareName}`,
      kind: 'share'
    });
  }

  return entries;
};

export const browseNetworkPath = async (request: NetworkBrowseRequest): Promise<NetworkBrowseResult> => {
  const parsed = parseUncPath(request.path);

  if (!isSameOrUnderRoot(request.rootPath, parsed.normalized)) {
    throw new NetworkPathError('Browse path must stay under the selected saved destination root.');
  }

  await maybeAuthenticate(parsed.normalized, request.credentials);

  if (!parsed.share) {
    const { stdout } = await runWindowsCommand('net.exe', ['view', `\\\\${parsed.host}`]);

    return {
      path: parsed.normalized,
      parentPath: null,
      entries: parseNetViewShares(stdout, parsed.host),
      canCreateFolder: false
    };
  }

  const entries = fs
    .readdirSync(parsed.normalized, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => ({
      name: entry.name,
      path: path.join(parsed.normalized, entry.name),
      kind: 'directory' as const
    }))
    .sort((a, b) => a.name.localeCompare(b.name));

  return {
    path: parsed.normalized,
    parentPath: getParentUncPath(parsed.normalized),
    entries,
    canCreateFolder: true
  };
};

export const createNetworkFolder = async (request: NetworkCreateFolderRequest) => {
  const parsed = parseUncPath(request.parentPath);
  const folderName = request.folderName.trim();

  if (!parsed.share) {
    throw new NetworkPathError('Choose a share before creating folders.');
  }

  if (!/^[^\\/:*?"<>|]+$/.test(folderName)) {
    throw new NetworkPathError('Folder name contains characters that are not allowed on Windows.');
  }

  if (!isSameOrUnderRoot(request.rootPath, parsed.normalized)) {
    throw new NetworkPathError('Folder must stay under the selected saved destination root.');
  }

  await maybeAuthenticate(parsed.normalized, request.credentials);

  const nextPath = path.join(parsed.normalized, folderName);
  fs.mkdirSync(nextPath, { recursive: false });

  return {
    path: nextPath,
    name: folderName
  };
};

export const listNetworkDestinations = () => {
  runMigrations();
  const db = getDb();
  const rows = db
    .prepare('SELECT id, name, root_path, username, created_at, updated_at, last_used_at FROM network_destinations ORDER BY updated_at DESC')
    .all() as Array<Parameters<typeof toDestinationRecord>[0]>;

  return rows.map(toDestinationRecord);
};

export const saveNetworkDestination = (request: NetworkDestinationRequest) => {
  runMigrations();
  const rootPath = parseUncPath(request.rootPath).normalized;
  const timestamp = nowIso();
  const name = request.name?.trim() || rootPath;
  const username = request.username?.trim() || null;
  const db = getDb();

  db.prepare(
    `
      INSERT INTO network_destinations (id, name, root_path, username, created_at, updated_at, last_used_at)
      VALUES (?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(root_path) DO UPDATE SET
        name = excluded.name,
        username = excluded.username,
        updated_at = excluded.updated_at
    `
  ).run(randomUUID(), name, rootPath, username, timestamp, timestamp, timestamp);

  const row = db
    .prepare('SELECT id, name, root_path, username, created_at, updated_at, last_used_at FROM network_destinations WHERE root_path = ?')
    .get(rootPath) as Parameters<typeof toDestinationRecord>[0];

  return toDestinationRecord(row);
};

export const deleteNetworkDestination = (id: string) => {
  runMigrations();
  const db = getDb();
  const result = db.prepare('DELETE FROM network_destinations WHERE id = ?').run(id);
  return result.changes > 0;
};

export const markNetworkDestinationUsed = (rootPath: string) => {
  runMigrations();
  const timestamp = nowIso();
  const db = getDb();

  try {
    const normalized = parseUncPath(rootPath).normalized;
    db.prepare('UPDATE network_destinations SET last_used_at = ?, updated_at = ? WHERE root_path = ?').run(timestamp, timestamp, normalized);
  } catch {
    // Ignore non-UNC paths here; request validation handles user-facing errors.
  }
};

export const getNetworkErrorMessage = (error: unknown) => {
  const detail = error instanceof Error ? error.message : 'Unknown network error.';
  const requiresAuthentication = /logon|credential|password|access is denied|acceso denegado|unknown|1326|1219|53/i.test(detail);

  return {
    ok: false,
    message: requiresAuthentication
      ? 'Authentication is required or expired for this network path.'
      : 'Network path is not reachable.',
    details: detail,
    requiresAuthentication
  };
};

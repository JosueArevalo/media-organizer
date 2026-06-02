import { createHash, randomBytes, randomUUID } from 'node:crypto';
import { URLSearchParams } from 'node:url';
import { getDb } from '../../state/db.js';
import { runMigrations } from '../../state/migrations/runMigrations.js';
import type {
  GooglePhotosAccountRecord,
  GooglePhotosAuthStartResult,
  GooglePhotosOAuthConfigRequest,
  GooglePhotosOAuthConfigSource,
  GooglePhotosOAuthConfigStatus
} from './export.types.js';
import type { StoredGooglePhotosAccount } from './googlePhotos.types.js';

const GOOGLE_AUTH_URL = 'https://accounts.google.com/o/oauth2/v2/auth';
const GOOGLE_TOKEN_URL = 'https://oauth2.googleapis.com/token';
const GOOGLE_USERINFO_URL = 'https://openidconnect.googleapis.com/v1/userinfo';

export const googlePhotosOAuthScopes = [
  'openid',
  'email',
  'profile',
  'https://www.googleapis.com/auth/photoslibrary.appendonly',
  'https://www.googleapis.com/auth/photoslibrary.readonly.appcreateddata'
];

export class GooglePhotosOAuthNotConfiguredError extends Error {
  constructor() {
    super('Google Photos OAuth is not configured.');
    this.name = 'GooglePhotosOAuthNotConfiguredError';
  }
}

const nowIso = () => new Date().toISOString();

const base64UrlEncode = (input: Buffer) =>
  input.toString('base64').replaceAll('+', '-').replaceAll('/', '_').replaceAll('=', '');

const defaultRedirectUri = () => {
  const port = Number(process.env.PORT ?? 4000);
  return `http://localhost:${port}/api/export/google-photos/oauth/callback`;
};

const getRedirectUri = () => process.env.GOOGLE_PHOTOS_REDIRECT_URI?.trim() || defaultRedirectUri();

const getStoredOAuthConfig = () => {
  runMigrations();
  const db = getDb();
  return db.prepare("SELECT client_id, client_secret FROM google_photos_oauth_config WHERE id = 'default'").get() as
    | { client_id: string; client_secret: string | null }
    | undefined;
};

const getOAuthClientConfig = (): {
  clientId: string;
  clientSecret: string;
  source: GooglePhotosOAuthConfigSource;
} => {
  const stored = getStoredOAuthConfig();
  const storedClientId = stored?.client_id.trim() ?? '';

  if (storedClientId) {
    return {
      clientId: storedClientId,
      clientSecret: stored?.client_secret?.trim() ?? '',
      source: 'local-db'
    };
  }

  const envClientId = process.env.GOOGLE_PHOTOS_CLIENT_ID?.trim() ?? '';

  if (envClientId) {
    return {
      clientId: envClientId,
      clientSecret: process.env.GOOGLE_PHOTOS_CLIENT_SECRET?.trim() ?? '',
      source: 'env'
    };
  }

  return {
    clientId: '',
    clientSecret: '',
    source: 'none'
  };
};

export const getGooglePhotosOAuthConfigStatus = (): GooglePhotosOAuthConfigStatus => {
  const config = getOAuthClientConfig();

  return {
    configured: Boolean(config.clientId),
    source: config.source,
    redirectUri: getRedirectUri(),
    requiredScopes: googlePhotosOAuthScopes,
    hasClientSecret: Boolean(config.clientSecret)
  };
};

export const saveGooglePhotosOAuthConfig = (request: GooglePhotosOAuthConfigRequest): GooglePhotosOAuthConfigStatus => {
  runMigrations();
  const clientId = request.clientId.trim();
  const clientSecret = request.clientSecret?.trim() || null;

  if (!clientId) {
    throw new Error('Google Photos OAuth Client ID is required.');
  }

  const db = getDb();
  const timestamp = nowIso();

  db.prepare(
    `
      INSERT INTO google_photos_oauth_config (id, client_id, client_secret, created_at, updated_at)
      VALUES ('default', ?, ?, ?, ?)
      ON CONFLICT(id) DO UPDATE SET
        client_id = excluded.client_id,
        client_secret = excluded.client_secret,
        updated_at = excluded.updated_at
    `
  ).run(clientId, clientSecret, timestamp, timestamp);

  return getGooglePhotosOAuthConfigStatus();
};

export const deleteGooglePhotosOAuthConfig = () => {
  runMigrations();
  const db = getDb();
  db.prepare("DELETE FROM google_photos_oauth_config WHERE id = 'default'").run();
  return getGooglePhotosOAuthConfigStatus();
};

const toPublicAccount = (account: StoredGooglePhotosAccount): GooglePhotosAccountRecord => ({
  id: account.id,
  email: account.email,
  displayName: account.displayName,
  expiresAt: account.expiresAt,
  createdAt: account.createdAt,
  updatedAt: account.updatedAt,
  lastConnectedAt: account.lastConnectedAt
});

const toStoredAccount = (row: {
  id: string;
  email: string;
  display_name: string | null;
  access_token: string;
  refresh_token: string | null;
  expires_at: string;
  scope: string | null;
  created_at: string;
  updated_at: string;
  last_connected_at: string;
}): StoredGooglePhotosAccount => ({
  id: row.id,
  email: row.email,
  displayName: row.display_name,
  accessToken: row.access_token,
  refreshToken: row.refresh_token,
  expiresAt: row.expires_at,
  scope: row.scope,
  createdAt: row.created_at,
  updatedAt: row.updated_at,
  lastConnectedAt: row.last_connected_at
});

const readJsonResponse = async <T>(response: Response, fallbackMessage: string): Promise<T> => {
  const body = await response.text();

  if (!response.ok) {
    throw new Error(body || fallbackMessage);
  }

  return JSON.parse(body) as T;
};

export const listGooglePhotosAccounts = (): GooglePhotosAccountRecord[] => {
  runMigrations();
  const db = getDb();
  const rows = db
    .prepare('SELECT * FROM google_photos_accounts ORDER BY last_connected_at DESC')
    .all() as Array<Parameters<typeof toStoredAccount>[0]>;

  return rows.map((row) => toPublicAccount(toStoredAccount(row)));
};

export const getGooglePhotosAccount = (accountId: string): StoredGooglePhotosAccount | null => {
  runMigrations();
  const db = getDb();
  const row = db.prepare('SELECT * FROM google_photos_accounts WHERE id = ?').get(accountId) as
    | Parameters<typeof toStoredAccount>[0]
    | undefined;

  return row ? toStoredAccount(row) : null;
};

export const deleteGooglePhotosAccount = (accountId: string) => {
  runMigrations();
  const db = getDb();
  return db.prepare('DELETE FROM google_photos_accounts WHERE id = ?').run(accountId).changes > 0;
};

export const startGooglePhotosOAuth = (): GooglePhotosAuthStartResult => {
  runMigrations();

  const config = getOAuthClientConfig();

  if (!config.clientId) {
    throw new GooglePhotosOAuthNotConfiguredError();
  }

  const codeVerifier = base64UrlEncode(randomBytes(48));
  const challenge = base64UrlEncode(createHash('sha256').update(codeVerifier).digest());
  const state = randomUUID();
  const redirectUri = getRedirectUri();
  const timestamp = nowIso();

  const db = getDb();
  db.prepare(
    `
      INSERT INTO google_photos_oauth_sessions (state, code_verifier, redirect_uri, created_at)
      VALUES (?, ?, ?, ?)
    `
  ).run(state, codeVerifier, redirectUri, timestamp);

  const params = new URLSearchParams({
    client_id: config.clientId,
    redirect_uri: redirectUri,
    response_type: 'code',
    scope: googlePhotosOAuthScopes.join(' '),
    access_type: 'offline',
    prompt: 'consent',
    include_granted_scopes: 'true',
    code_challenge: challenge,
    code_challenge_method: 'S256',
    state
  });

  return {
    authUrl: `${GOOGLE_AUTH_URL}?${params.toString()}`,
    state
  };
};

export const completeGooglePhotosOAuth = async (code: string, state: string): Promise<GooglePhotosAccountRecord> => {
  runMigrations();

  const config = getOAuthClientConfig();

  if (!config.clientId) {
    throw new GooglePhotosOAuthNotConfiguredError();
  }

  const db = getDb();
  const session = db
    .prepare('SELECT * FROM google_photos_oauth_sessions WHERE state = ?')
    .get(state) as { code_verifier: string; redirect_uri: string } | undefined;

  if (!session) {
    throw new Error('Google Photos OAuth session was not found or has expired.');
  }

  const tokenParams = new URLSearchParams({
    client_id: config.clientId,
    code,
    code_verifier: session.code_verifier,
    grant_type: 'authorization_code',
    redirect_uri: session.redirect_uri
  });

  if (config.clientSecret) {
    tokenParams.set('client_secret', config.clientSecret);
  }

  const tokenResponse = await fetch(GOOGLE_TOKEN_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: tokenParams
  });

  const tokenBody = await readJsonResponse<{
    access_token: string;
    refresh_token?: string;
    expires_in: number;
    scope?: string;
  }>(tokenResponse, 'Google Photos OAuth token exchange failed.');

  const userResponse = await fetch(GOOGLE_USERINFO_URL, {
    headers: { Authorization: `Bearer ${tokenBody.access_token}` }
  });
  const userBody = await readJsonResponse<{ email?: string; name?: string }>(userResponse, 'Could not read Google account profile.');

  if (!userBody.email) {
    throw new Error('Google did not return an email for the connected account.');
  }

  const existing = db.prepare('SELECT id, refresh_token FROM google_photos_accounts WHERE email = ?').get(userBody.email) as
    | { id: string; refresh_token: string | null }
    | undefined;
  const accountId = existing?.id ?? randomUUID();
  const timestamp = nowIso();
  const expiresAt = new Date(Date.now() + tokenBody.expires_in * 1000).toISOString();

  db.exec('BEGIN TRANSACTION');
  try {
    db.prepare(
      `
        INSERT INTO google_photos_accounts (
          id, email, display_name, access_token, refresh_token, expires_at, scope, created_at, updated_at, last_connected_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(email) DO UPDATE SET
          display_name = excluded.display_name,
          access_token = excluded.access_token,
          refresh_token = COALESCE(excluded.refresh_token, google_photos_accounts.refresh_token),
          expires_at = excluded.expires_at,
          scope = excluded.scope,
          updated_at = excluded.updated_at,
          last_connected_at = excluded.last_connected_at
      `
    ).run(
      accountId,
      userBody.email,
      userBody.name ?? null,
      tokenBody.access_token,
      tokenBody.refresh_token ?? existing?.refresh_token ?? null,
      expiresAt,
      tokenBody.scope ?? null,
      timestamp,
      timestamp,
      timestamp
    );

    db.prepare('DELETE FROM google_photos_oauth_sessions WHERE state = ?').run(state);
    db.exec('COMMIT');
  } catch (error) {
    db.exec('ROLLBACK');
    throw error;
  }

  const account = getGooglePhotosAccount(accountId);

  if (!account) {
    throw new Error('Google Photos account was not saved.');
  }

  return toPublicAccount(account);
};

export const getValidGooglePhotosAccessToken = async (accountId: string): Promise<string> => {
  const account = getGooglePhotosAccount(accountId);

  if (!account) {
    throw new Error('Connect a Google Photos account before starting this export.');
  }

  const expiresAt = Date.parse(account.expiresAt);

  if (Number.isFinite(expiresAt) && expiresAt - Date.now() > 60_000) {
    return account.accessToken;
  }

  if (!account.refreshToken) {
    throw new Error('Google Photos account needs to be reconnected.');
  }

  const config = getOAuthClientConfig();

  if (!config.clientId) {
    throw new GooglePhotosOAuthNotConfiguredError();
  }

  const tokenParams = new URLSearchParams({
    client_id: config.clientId,
    refresh_token: account.refreshToken,
    grant_type: 'refresh_token'
  });

  if (config.clientSecret) {
    tokenParams.set('client_secret', config.clientSecret);
  }

  const response = await fetch(GOOGLE_TOKEN_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: tokenParams
  });

  const body = await readJsonResponse<{ access_token: string; expires_in: number; scope?: string }>(
    response,
    'Google Photos token refresh failed.'
  );
  const timestamp = nowIso();
  const expiresAtIso = new Date(Date.now() + body.expires_in * 1000).toISOString();
  const db = getDb();

  db.prepare(
    `
      UPDATE google_photos_accounts
      SET access_token = ?,
          expires_at = ?,
          scope = COALESCE(?, scope),
          updated_at = ?,
          last_connected_at = ?
      WHERE id = ?
    `
  ).run(body.access_token, expiresAtIso, body.scope ?? null, timestamp, timestamp, accountId);

  return body.access_token;
};

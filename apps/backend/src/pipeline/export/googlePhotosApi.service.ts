import fs from 'node:fs';
import { randomUUID } from 'node:crypto';
import { getDb } from '../../state/db.js';
import { runMigrations } from '../../state/migrations/runMigrations.js';
import { getValidGooglePhotosAccessToken } from './googlePhotosAuth.service.js';
import type {
  GooglePhotosAlbumRecord,
  GooglePhotosApiAlbum,
  GooglePhotosBatchCreateResult,
  GooglePhotosItemMetadata
} from './googlePhotos.types.js';

const GOOGLE_PHOTOS_API_URL = 'https://photoslibrary.googleapis.com/v1';
const GOOGLE_PHOTOS_LOG_PREFIX = '[google-photos]';
const GOOGLE_ERROR_BODY_LIMIT = 4000;

const nowIso = () => new Date().toISOString();

export const inferGooglePhotosContentType = (filePath: string) => {
  const dotIndex = filePath.lastIndexOf('.');
  const extension = dotIndex >= 0 ? filePath.slice(dotIndex).toLocaleLowerCase() : '';

  const contentTypes: Record<string, string> = {
    '.jpg': 'image/jpeg',
    '.jpeg': 'image/jpeg',
    '.png': 'image/png',
    '.gif': 'image/gif',
    '.webp': 'image/webp',
    '.heic': 'image/heic',
    '.heif': 'image/heif',
    '.tif': 'image/tiff',
    '.tiff': 'image/tiff',
    '.bmp': 'image/bmp',
    '.mp4': 'video/mp4',
    '.m4v': 'video/mp4',
    '.mov': 'video/quicktime',
    '.avi': 'video/x-msvideo',
    '.mkv': 'video/x-matroska',
    '.mts': 'video/mp2t',
    '.m2ts': 'video/mp2t',
    '.3gp': 'video/3gpp',
    '.3g2': 'video/3gpp2'
  };

  return contentTypes[extension] ?? 'application/octet-stream';
};

export const redactGooglePhotosUploadToken = (uploadToken: string | null | undefined) => {
  if (!uploadToken) {
    return 'none';
  }

  if (uploadToken.length <= 12) {
    return `${uploadToken.slice(0, 3)}...${uploadToken.slice(-3)}`;
  }

  return `${uploadToken.slice(0, 6)}...${uploadToken.slice(-6)}`;
};

const getGooglePhotosEndpointLabel = (url: string) => {
  try {
    const parsed = new URL(url);
    return parsed.pathname;
  } catch {
    return url;
  }
};

const formatGooglePhotosResponseBody = (body: string) => {
  const trimmed = body.trim();

  if (!trimmed) {
    return null;
  }

  try {
    const serialized = JSON.stringify(JSON.parse(trimmed));
    return serialized.length > GOOGLE_ERROR_BODY_LIMIT
      ? `${serialized.slice(0, GOOGLE_ERROR_BODY_LIMIT)}...`
      : serialized;
  } catch {
    return trimmed.length > GOOGLE_ERROR_BODY_LIMIT
      ? `${trimmed.slice(0, GOOGLE_ERROR_BODY_LIMIT)}...`
      : trimmed;
  }
};

const formatGooglePhotosHttpError = (fallbackMessage: string, body: string) => {
  const googleBody = formatGooglePhotosResponseBody(body);
  return googleBody ? `${fallbackMessage} Google response: ${googleBody}` : fallbackMessage;
};

export const normalizeGooglePhotosAlbumTitle = (title: string) => title.trim().replace(/\s+/g, ' ').toLocaleLowerCase();

const toAlbumRecord = (row: {
  id: string;
  account_id: string;
  google_album_id: string;
  title: string;
  normalized_title: string;
  product_url: string | null;
  created_at: string;
  updated_at: string;
}): GooglePhotosAlbumRecord => ({
  id: row.id,
  accountId: row.account_id,
  googleAlbumId: row.google_album_id,
  title: row.title,
  normalizedTitle: row.normalized_title,
  productUrl: row.product_url,
  createdAt: row.created_at,
  updatedAt: row.updated_at
});

export const toGooglePhotosItemMetadata = (row: {
  item_id: string;
  account_id: string;
  local_album_title: string;
  google_album_id: string | null;
  upload_token: string | null;
  upload_token_created_at: string | null;
  media_item_id: string | null;
  product_url: string | null;
  phase: GooglePhotosItemMetadata['phase'];
  updated_at: string;
}): GooglePhotosItemMetadata => ({
  itemId: row.item_id,
  accountId: row.account_id,
  localAlbumTitle: row.local_album_title,
  googleAlbumId: row.google_album_id,
  uploadToken: row.upload_token,
  uploadTokenCreatedAt: row.upload_token_created_at,
  mediaItemId: row.media_item_id,
  productUrl: row.product_url,
  phase: row.phase,
  updatedAt: row.updated_at
});

const requestJson = async <T>(accountId: string, url: string, fallbackMessage: string, init: RequestInit = {}): Promise<T> => {
  const accessToken = await getValidGooglePhotosAccessToken(accountId);
  const response = await fetch(url, {
    ...init,
    headers: {
      Authorization: `Bearer ${accessToken}`,
      ...(init.headers ?? {})
    }
  });
  const body = await response.text();

  if (!response.ok) {
    const message = formatGooglePhotosHttpError(fallbackMessage, body);
    console.warn(`${GOOGLE_PHOTOS_LOG_PREFIX} HTTP request failed endpoint=${getGooglePhotosEndpointLabel(url)} status=${response.status} message="${message}"`);
    throw new Error(message);
  }

  return JSON.parse(body) as T;
};

export const cacheGooglePhotosAlbum = (
  accountId: string,
  album: { id: string; title: string; productUrl?: string | null }
): GooglePhotosAlbumRecord => {
  runMigrations();
  const db = getDb();
  const timestamp = nowIso();
  const normalizedTitle = normalizeGooglePhotosAlbumTitle(album.title);

  db.prepare(
    `
      INSERT INTO google_photos_albums (
        id, account_id, google_album_id, title, normalized_title, product_url, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(account_id, google_album_id) DO UPDATE SET
        title = excluded.title,
        normalized_title = excluded.normalized_title,
        product_url = excluded.product_url,
        updated_at = excluded.updated_at
    `
  ).run(randomUUID(), accountId, album.id, album.title, normalizedTitle, album.productUrl ?? null, timestamp, timestamp);

  const row = db
    .prepare('SELECT * FROM google_photos_albums WHERE account_id = ? AND google_album_id = ?')
    .get(accountId, album.id) as Parameters<typeof toAlbumRecord>[0];

  return toAlbumRecord(row);
};

export const getCachedGooglePhotosAlbumByTitle = (accountId: string, title: string): GooglePhotosAlbumRecord | null => {
  runMigrations();
  const db = getDb();
  const row = db
    .prepare('SELECT * FROM google_photos_albums WHERE account_id = ? AND normalized_title = ?')
    .get(accountId, normalizeGooglePhotosAlbumTitle(title)) as Parameters<typeof toAlbumRecord>[0] | undefined;

  return row ? toAlbumRecord(row) : null;
};

export const listGooglePhotosAppCreatedAlbums = async (accountId: string): Promise<GooglePhotosAlbumRecord[]> => {
  const albums: GooglePhotosAlbumRecord[] = [];
  let pageToken: string | undefined;

  do {
    const params = new URLSearchParams({ pageSize: '50' });
    if (pageToken) {
      params.set('pageToken', pageToken);
    }

    const body = await requestJson<{ albums?: GooglePhotosApiAlbum[]; nextPageToken?: string }>(
      accountId,
      `${GOOGLE_PHOTOS_API_URL}/albums?${params.toString()}`,
      'Could not list Google Photos albums.'
    );

    for (const album of body.albums ?? []) {
      albums.push(cacheGooglePhotosAlbum(accountId, album));
    }

    pageToken = body.nextPageToken;
  } while (pageToken);

  return albums;
};

export const getOrCreateGooglePhotosAlbum = async (accountId: string, title: string): Promise<GooglePhotosAlbumRecord> => {
  const cached = getCachedGooglePhotosAlbumByTitle(accountId, title);

  if (cached) {
    console.info(`${GOOGLE_PHOTOS_LOG_PREFIX} Reusing cached album albumId=${cached.googleAlbumId} title="${cached.title}"`);
    return cached;
  }

  await listGooglePhotosAppCreatedAlbums(accountId);
  const fromRemoteList = getCachedGooglePhotosAlbumByTitle(accountId, title);

  if (fromRemoteList) {
    console.info(`${GOOGLE_PHOTOS_LOG_PREFIX} Reusing app-created album albumId=${fromRemoteList.googleAlbumId} title="${fromRemoteList.title}"`);
    return fromRemoteList;
  }

  console.info(`${GOOGLE_PHOTOS_LOG_PREFIX} Creating album title="${title}"`);
  const body = await requestJson<{ id: string; title: string; productUrl?: string }>(
    accountId,
    `${GOOGLE_PHOTOS_API_URL}/albums`,
    'Could not create Google Photos album.',
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ album: { title } })
    }
  );

  const album = cacheGooglePhotosAlbum(accountId, body);
  console.info(`${GOOGLE_PHOTOS_LOG_PREFIX} Created album albumId=${album.googleAlbumId} title="${album.title}"`);
  return album;
};

export const ensureGooglePhotosItemMetadata = (
  itemId: string,
  accountId: string,
  localAlbumTitle: string
): GooglePhotosItemMetadata => {
  runMigrations();
  const db = getDb();
  const timestamp = nowIso();

  db.prepare(
    `
      INSERT OR IGNORE INTO export_google_photos_items (
        item_id, account_id, local_album_title, google_album_id, upload_token, upload_token_created_at,
        media_item_id, product_url, phase, updated_at
      ) VALUES (?, ?, ?, NULL, NULL, NULL, NULL, NULL, 'planned', ?)
    `
  ).run(itemId, accountId, localAlbumTitle, timestamp);

  const row = db.prepare('SELECT * FROM export_google_photos_items WHERE item_id = ?').get(itemId) as
    | Parameters<typeof toGooglePhotosItemMetadata>[0]
    | undefined;

  if (!row) {
    throw new Error('Google Photos item metadata could not be created.');
  }

  return toGooglePhotosItemMetadata(row);
};

export const updateGooglePhotosItemUploaded = (
  itemId: string,
  googleAlbumId: string,
  uploadToken: string,
  uploadTokenCreatedAt: string
) => {
  const db = getDb();
  db.prepare(
    `
      UPDATE export_google_photos_items
      SET google_album_id = ?,
          upload_token = ?,
          upload_token_created_at = ?,
          phase = 'uploaded',
          updated_at = ?
      WHERE item_id = ?
    `
  ).run(googleAlbumId, uploadToken, uploadTokenCreatedAt, nowIso(), itemId);
};

export const updateGooglePhotosItemCreated = (
  itemId: string,
  mediaItemId: string,
  productUrl: string | null
) => {
  const db = getDb();
  db.prepare(
    `
      UPDATE export_google_photos_items
      SET media_item_id = ?,
          product_url = ?,
          phase = 'created',
          updated_at = ?
      WHERE item_id = ?
    `
  ).run(mediaItemId, productUrl, nowIso(), itemId);
};

export const isUploadTokenFresh = (metadata: GooglePhotosItemMetadata) => {
  if (!metadata.uploadToken || !metadata.uploadTokenCreatedAt) {
    return false;
  }

  const createdAt = Date.parse(metadata.uploadTokenCreatedAt);
  return Number.isFinite(createdAt) && Date.now() - createdAt < 23 * 60 * 60 * 1000;
};

export const uploadGooglePhotosMedia = async (
  accountId: string,
  filePath: string,
  fileName: string
): Promise<{ uploadToken: string; createdAt: string }> => {
  const accessToken = await getValidGooglePhotosAccessToken(accountId);
  const file = fs.readFileSync(filePath);
  const contentType = inferGooglePhotosContentType(filePath);
  console.info(`${GOOGLE_PHOTOS_LOG_PREFIX} Uploading media bytes file="${fileName}" sizeBytes=${file.byteLength} contentType=${contentType}`);
  const response = await fetch(`${GOOGLE_PHOTOS_API_URL}/uploads`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${accessToken}`,
      'Content-Type': 'application/octet-stream',
      'X-Goog-Upload-Content-Type': contentType,
      'X-Goog-Upload-File-Name': encodeURIComponent(fileName),
      'X-Goog-Upload-Protocol': 'raw'
    },
    body: file
  });
  const body = await response.text();

  if (!response.ok) {
    const message = formatGooglePhotosHttpError('Could not upload media bytes to Google Photos.', body);
    console.warn(`${GOOGLE_PHOTOS_LOG_PREFIX} Upload failed file="${fileName}" status=${response.status} message="${message}"`);
    throw new Error(message);
  }

  console.info(`${GOOGLE_PHOTOS_LOG_PREFIX} Uploaded media bytes file="${fileName}" sizeBytes=${file.byteLength} uploadToken=${redactGooglePhotosUploadToken(body)}`);

  return {
    uploadToken: body,
    createdAt: nowIso()
  };
};

export const createGooglePhotosMediaItems = async (
  accountId: string,
  albumId: string,
  items: Array<{ uploadToken: string; fileName: string }>
): Promise<GooglePhotosBatchCreateResult[]> => {
  console.info(`${GOOGLE_PHOTOS_LOG_PREFIX} Creating media items albumId=${albumId} count=${items.length}`);
  const body = await requestJson<{ newMediaItemResults?: GooglePhotosBatchCreateResult[] }>(
    accountId,
    `${GOOGLE_PHOTOS_API_URL}/mediaItems:batchCreate`,
    'Could not create Google Photos media items.',
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        albumId,
        newMediaItems: items.map((item) => ({
          simpleMediaItem: {
            uploadToken: item.uploadToken,
            fileName: item.fileName
          }
        }))
      })
    }
  );

  return body.newMediaItemResults ?? [];
};

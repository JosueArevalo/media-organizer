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

const nowIso = () => new Date().toISOString();

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
    throw new Error(body || fallbackMessage);
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
    return cached;
  }

  await listGooglePhotosAppCreatedAlbums(accountId);
  const fromRemoteList = getCachedGooglePhotosAlbumByTitle(accountId, title);

  if (fromRemoteList) {
    return fromRemoteList;
  }

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

  return cacheGooglePhotosAlbum(accountId, body);
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
  const response = await fetch(`${GOOGLE_PHOTOS_API_URL}/uploads`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${accessToken}`,
      'Content-Type': 'application/octet-stream',
      'X-Goog-Upload-File-Name': encodeURIComponent(fileName),
      'X-Goog-Upload-Protocol': 'raw'
    },
    body: fs.readFileSync(filePath)
  });
  const body = await response.text();

  if (!response.ok) {
    throw new Error(body || 'Could not upload media bytes to Google Photos.');
  }

  return {
    uploadToken: body,
    createdAt: nowIso()
  };
};

export const createGooglePhotosMediaItems = async (
  accountId: string,
  albumId: string,
  items: Array<{ uploadToken: string; description: string }>
): Promise<GooglePhotosBatchCreateResult[]> => {
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
          description: item.description,
          simpleMediaItem: { uploadToken: item.uploadToken }
        }))
      })
    }
  );

  return body.newMediaItemResults ?? [];
};

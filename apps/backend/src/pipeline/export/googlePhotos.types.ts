import type { GooglePhotosAccountRecord } from './export.types.js';

export type StoredGooglePhotosAccount = GooglePhotosAccountRecord & {
  accessToken: string;
  refreshToken: string | null;
  scope: string | null;
};

export type GooglePhotosAlbumRecord = {
  id: string;
  accountId: string;
  googleAlbumId: string;
  title: string;
  normalizedTitle: string;
  productUrl: string | null;
  createdAt: string;
  updatedAt: string;
};

export type GooglePhotosItemMetadata = {
  itemId: string;
  accountId: string;
  localAlbumTitle: string;
  googleAlbumId: string | null;
  uploadToken: string | null;
  uploadTokenCreatedAt: string | null;
  mediaItemId: string | null;
  productUrl: string | null;
  phase: 'planned' | 'uploaded' | 'created';
  updatedAt: string;
};

export type GooglePhotosApiAlbum = {
  id: string;
  title: string;
  productUrl?: string;
};

export type GooglePhotosBatchCreateResult = {
  uploadToken: string;
  status?: {
    code?: number;
    message?: string;
  };
  mediaItem?: {
    id: string;
    productUrl?: string;
  };
};

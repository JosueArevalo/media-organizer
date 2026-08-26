import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  createGooglePhotosItemState,
  deriveGooglePhotosAlbumView,
  mergeGooglePhotosProgressItems
} from '../src/pages/googlePhotosProgressView';
import type {
  ExportItem,
  GooglePhotosAlbumPreview,
  GooglePhotosExportPreview
} from '../src/services/export.service';

const album = (count: number): GooglePhotosAlbumPreview => ({
  folderName: 'Album A',
  albumTitle: 'Album A',
  status: 'new',
  uploadStatus: 'pending',
  itemCount: count,
  items: Array.from({ length: count }, (_, index) => ({
    relativePath: `Album A/photo-${String(index + 1).padStart(3, '0')}.jpg`,
    sizeBytes: index + 1,
    supported: true
  }))
});

const preview = (albumPreview: GooglePhotosAlbumPreview): GooglePhotosExportPreview => ({
  account: {
    id: 'account-1',
    email: 'user@example.com',
    displayName: null,
    expiresAt: '2026-08-27T00:00:00.000Z',
    createdAt: '2026-08-26T00:00:00.000Z',
    updatedAt: '2026-08-26T00:00:00.000Z',
    lastConnectedAt: '2026-08-26T00:00:00.000Z'
  },
  albums: [albumPreview],
  supportedItems: albumPreview.itemCount,
  unsupportedItems: 0
});

const progressItem = (
  index: number,
  status: ExportItem['status'],
  options: Partial<ExportItem> = {}
): ExportItem => ({
  id: options.id ?? `item-${index}`,
  jobId: options.jobId ?? 'job-1',
  sourcePath: options.sourcePath ?? `C:/media/photo-${index}.jpg`,
  relativePath: options.relativePath ?? `Album A/photo-${String(index).padStart(3, '0')}.jpg`,
  destinationPath: options.destinationPath ?? 'Album A',
  sizeBytes: options.sizeBytes ?? index,
  status,
  attemptCount: options.attemptCount ?? 1,
  lastError: options.lastError ?? null,
  updatedAt: options.updatedAt ?? `2026-08-26T10:00:${String(index % 60).padStart(2, '0')}.000Z`
});

test('accumulates more than 50 completed items across rolling recent-item windows', () => {
  const albumPreview = album(60);
  let state = createGooglePhotosItemState(preview(albumPreview));

  state = mergeGooglePhotosProgressItems(
    state,
    Array.from({ length: 50 }, (_, index) => progressItem(index + 1, 'completed'))
  );
  state = mergeGooglePhotosProgressItems(
    state,
    Array.from({ length: 50 }, (_, index) => progressItem(index + 11, 'completed'))
  );

  const view = deriveGooglePhotosAlbumView({ album: albumPreview, itemState: state, isPaused: false });
  assert.equal(view.completedCount, 60);
  assert.equal(view.derivedStatus, 'completed');
  assert.equal(view.isComplete, true);
});

test('resolves rolling progress for more than 60 items across several albums', () => {
  const albums = ['Album A', 'Album B', 'Album C'].map((albumTitle) => ({
    ...album(21),
    folderName: albumTitle,
    albumTitle,
    items: album(21).items.map((item) => ({
      ...item,
      relativePath: item.relativePath.replace('Album A', albumTitle)
    }))
  }));
  const multiAlbumPreview: GooglePhotosExportPreview = {
    ...preview(albums[0]),
    albums,
    supportedItems: 63
  };
  const allItems = albums.flatMap((albumPreview, albumIndex) =>
    albumPreview.items.map((item, itemIndex) => progressItem(albumIndex * 21 + itemIndex + 1, 'completed', {
      destinationPath: albumPreview.albumTitle,
      relativePath: item.relativePath
    }))
  );
  let state = createGooglePhotosItemState(multiAlbumPreview);

  state = mergeGooglePhotosProgressItems(state, allItems.slice(0, 50));
  state = mergeGooglePhotosProgressItems(state, allItems.slice(13));

  for (const albumPreview of albums) {
    const view = deriveGooglePhotosAlbumView({ album: albumPreview, itemState: state, isPaused: false });
    assert.equal(view.completedCount, 21);
    assert.equal(view.derivedStatus, 'completed');
  }
});

test('ignores an older response for the same item', () => {
  const albumPreview = album(1);
  let state = createGooglePhotosItemState(preview(albumPreview));
  state = mergeGooglePhotosProgressItems(state, [progressItem(1, 'completed', { updatedAt: '2026-08-26T10:00:02.000Z' })]);
  state = mergeGooglePhotosProgressItems(state, [progressItem(1, 'running', { updatedAt: '2026-08-26T10:00:01.000Z' })]);

  assert.equal(state['Album A/photo-001.jpg']?.status, 'completed');
});

test('a later retry job resolves a previous failure while preserving retry metadata', () => {
  const albumPreview = album(2);
  let state = createGooglePhotosItemState(preview(albumPreview));
  state = mergeGooglePhotosProgressItems(state, [
    progressItem(1, 'completed', { updatedAt: '2026-08-26T10:00:01.000Z' }),
    progressItem(2, 'failed', {
      id: 'failed-item',
      jobId: 'job-1',
      lastError: 'Temporary failure',
      updatedAt: '2026-08-26T10:00:02.000Z'
    })
  ]);

  assert.equal(state['Album A/photo-002.jpg']?.id, 'failed-item');
  assert.equal(state['Album A/photo-002.jpg']?.jobId, 'job-1');
  assert.equal(state['Album A/photo-002.jpg']?.lastError, 'Temporary failure');

  state = mergeGooglePhotosProgressItems(state, [
    progressItem(2, 'pending', { id: 'retry-item', jobId: 'job-2', updatedAt: '2026-08-26T10:01:00.000Z' }),
    progressItem(2, 'running', { id: 'retry-item', jobId: 'job-2', updatedAt: '2026-08-26T10:01:01.000Z' }),
    progressItem(2, 'completed', { id: 'retry-item', jobId: 'job-2', updatedAt: '2026-08-26T10:01:02.000Z' })
  ]);

  const view = deriveGooglePhotosAlbumView({ album: albumPreview, itemState: state, isPaused: false });
  assert.equal(view.derivedStatus, 'completed');
  assert.equal(view.completedCount, 2);
  assert.equal(state['Album A/photo-002.jpg']?.jobId, 'job-2');
  assert.equal(state['Album A/photo-002.jpg']?.lastError, null);
});

test('a completed source cannot be downgraded by a different stale job item', () => {
  const albumPreview = album(1);
  let state = createGooglePhotosItemState(preview(albumPreview));
  state = mergeGooglePhotosProgressItems(state, [
    progressItem(1, 'completed', { id: 'completed-item', jobId: 'job-2', updatedAt: '2026-08-26T10:02:00.000Z' })
  ]);
  state = mergeGooglePhotosProgressItems(state, [
    progressItem(1, 'failed', {
      id: 'old-failed-item',
      jobId: 'job-1',
      lastError: 'Old failure',
      updatedAt: '2026-08-26T10:03:00.000Z'
    })
  ]);

  assert.equal(state['Album A/photo-001.jpg']?.status, 'completed');
  assert.equal(state['Album A/photo-001.jpg']?.jobId, 'job-2');
});

test('a completed source cannot be downgraded by a newer update for the same item', () => {
  const albumPreview = album(1);
  let state = createGooglePhotosItemState(preview(albumPreview));
  state = mergeGooglePhotosProgressItems(state, [
    progressItem(1, 'completed', { id: 'same-item', updatedAt: '2026-08-26T10:02:00.000Z' })
  ]);
  state = mergeGooglePhotosProgressItems(state, [
    progressItem(1, 'running', { id: 'same-item', updatedAt: '2026-08-26T10:03:00.000Z' })
  ]);

  assert.equal(state['Album A/photo-001.jpg']?.status, 'completed');
});

test('album progress supplements running activity without replacing complete item history', () => {
  const albumPreview = album(2);
  let state = createGooglePhotosItemState(preview(albumPreview));
  state = mergeGooglePhotosProgressItems(state, [progressItem(1, 'completed')]);

  const runningView = deriveGooglePhotosAlbumView({
    album: albumPreview,
    itemState: state,
    albumProgress: {
      albumTitle: 'Album A',
      total: 1,
      completed: 0,
      failed: 0,
      skipped: 0,
      pending: 1,
      status: 'running'
    },
    isPaused: false
  });
  assert.equal(runningView.derivedStatus, 'running');
  assert.equal(runningView.completedCount, 1);

  state = mergeGooglePhotosProgressItems(state, [progressItem(2, 'completed', { jobId: 'job-2' })]);
  const completeView = deriveGooglePhotosAlbumView({ album: albumPreview, itemState: state, isPaused: false });
  assert.equal(completeView.derivedStatus, 'completed');
});

import assert from 'node:assert/strict';
import { test } from 'node:test';
import { getExportJobGroupSelection, getExportJobTarget, withExportGroupSelection } from '../src/services/export-workflow';
import { createExportItemState, deriveExportGroupView, mergeExportProgressItems } from '../src/services/export-progress-view';
import type { ExportJobSnapshot, ExportPreview } from '../src/services/export.service';

const preview: ExportPreview = {
  supportedItems: 2, unsupportedItems: 0,
  groups: ['folder:A', 'root:'].map((id) => ({
    id, label: id === 'root:' ? '' : 'A', isRoot: id === 'root:', exportStatus: 'pending', itemCount: 1,
    items: [{ relativePath: id === 'root:' ? 'root.jpg' : 'A/file.jpg', supported: true, sizeBytes: 1 }]
  }))
};
const job = (target: unknown) => ({ checkpoint: { payloadJson: JSON.stringify({ target }) } }) as ExportJobSnapshot;

test('network selection distinguishes legacy absent scopes from explicitly empty scopes', () => {
  assert.deepEqual([...getExportJobGroupSelection(preview, job({ type: 'network-folder' }))], ['folder:A', 'root:']);
  assert.deepEqual([...getExportJobGroupSelection(preview, job({ type: 'network-folder', groupIds: [] }))], []);
  assert.deepEqual([...getExportJobGroupSelection(preview, job({ type: 'network-folder', groupIds: ['root:'] }))], ['root:']);
});

test('Google Photos adapter preserves album titles including spaces and translates stable identifiers', () => {
  const target = { type: 'google-photos' as const, accountId: 'account' };
  assert.deepEqual(withExportGroupSelection(target, ['album:Trip: summer', 'album:Another']), {
    ...target, albumTitles: ['Trip: summer', 'Another']
  });
  assert.deepEqual([...getExportJobGroupSelection(preview, job({ ...target, albumTitles: [] }))], []);
  assert.deepEqual(withExportGroupSelection({ type: 'network-folder', destinationPath: '/mnt/share' }, []), {
    type: 'network-folder', destinationPath: '/mnt/share', groupIds: []
  });
});

test('invalid checkpoints do not crash restoration', () => {
  assert.equal(getExportJobTarget({ checkpoint: { payloadJson: '{' } } as ExportJobSnapshot), null);
  assert.deepEqual([...getExportJobGroupSelection(preview, null)], ['folder:A', 'root:']);
});

test('network previews can reset completed state when a verified output disappears', () => {
  const done: ExportPreview = { ...preview, groups: [{ ...preview.groups[0], exportStatus: 'completed',
    items: [{ ...preview.groups[0].items[0], status: 'completed', updatedAt: '2026-10-04T10:00:00Z' }] }] };
  const view = deriveExportGroupView({ group: done.groups[0], itemState: createExportItemState(done), isPaused: false });
  assert.equal(view.isComplete, true);
  // A fresh authoritative preview replaces the item map; rolling progress alone never downgrades completion.
  const refreshed = deriveExportGroupView({ group: preview.groups[0], itemState: createExportItemState(preview), isPaused: false });
  assert.equal(refreshed.isComplete, false);
});

test('preview timestamps reject older progress and groups retain stable IDs', () => {
  const initial: ExportPreview = { ...preview, groups: [{ ...preview.groups[0], items: [{ ...preview.groups[0].items[0],
    id: 'item', jobId: 'job', status: 'running', updatedAt: '2026-10-04T12:00:00Z' }] }] };
  const state = mergeExportProgressItems(createExportItemState(initial), [{
    id: 'item', jobId: 'job', relativePath: 'A/file.jpg', sourcePath: '/source/A/file.jpg', destinationPath: '/dest/A/file.jpg',
    status: 'pending', sizeBytes: 1, lastError: null, updatedAt: '2026-10-04T11:00:00Z', attemptCount: 1
  }]);
  const view = deriveExportGroupView({ group: initial.groups[0], itemState: state, isPaused: true });
  assert.equal(view.id, 'folder:A');
  assert.equal(view.items[0].status, 'paused');
});

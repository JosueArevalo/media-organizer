// Compatibility for callers using the original Google Photos view model.
import { createExportItemState, deriveExportGroupView, mergeExportProgressItems } from '../services/export-progress-view';
import type { ExportItemState, ExportTrackedItem, ExportRenderStatus } from '../services/export-progress-view';
import type { GooglePhotosAlbumPreview, GooglePhotosAlbumProgress, GooglePhotosExportPreview } from '../services/export.service';
export type GooglePhotosItemState = ExportItemState;
export type GooglePhotosTrackedItem = ExportTrackedItem;
export type GooglePhotosRenderStatus = ExportRenderStatus;
const group = (album: GooglePhotosAlbumPreview) => ({
  id: 'album:' + album.albumTitle, label: album.albumTitle, destinationStatus: album.status,
  exportStatus: album.uploadStatus, itemCount: album.itemCount, items: album.items
});
export const createGooglePhotosItemState = (preview: GooglePhotosExportPreview) => createExportItemState({
  groups: preview.albums.map(group), supportedItems: preview.supportedItems, unsupportedItems: preview.unsupportedItems
});
export const mergeGooglePhotosProgressItems = mergeExportProgressItems;
export const deriveGooglePhotosAlbumView = (input: {
  album: GooglePhotosAlbumPreview; itemState: ExportItemState; albumProgress?: GooglePhotosAlbumProgress; isPaused: boolean;
}) => ({
  ...input.album,
  ...deriveExportGroupView({ group: group(input.album), itemState: input.itemState,
    groupProgress: input.albumProgress ? { ...input.albumProgress, groupId: 'album:' + input.album.albumTitle } : undefined,
    isPaused: input.isPaused }),
  albumType: input.album.status,
  albumProgress: input.albumProgress
});
export type GooglePhotosDerivedAlbumView = ReturnType<typeof deriveGooglePhotosAlbumView>;

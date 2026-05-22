# Google Photos Export Spike

## Purpose

Google Photos is intentionally not exposed as a production export target in the MVP.

This spike exists to validate the risky parts first:

- OAuth desktop/local flow for a single user.
- Creating an app-created album named after a grouped folder.
- Uploading supported image/video files into that album.
- Handling batch limits, retries, partial failures, and storage warnings.

## API Shape To Validate

Use the Google Photos Library API with the `photoslibrary.appendonly` scope.

Upload flow:

1. Upload file bytes to `POST https://photoslibrary.googleapis.com/v1/uploads`.
2. Use returned upload tokens with `POST https://photoslibrary.googleapis.com/v1/mediaItems:batchCreate`.
3. Include `albumId` when adding items to an album created by this app.

Important constraints:

- `mediaItems.batchCreate` accepts at most 50 items per request.
- `batchCreate` should run serially for a single user.
- Upload tokens expire after one day.
- App-created album/media access is the reliable scope after the 2025 Google Photos API changes.
- Uploads are stored at original quality and may count against the user's Google Account storage.

## Acceptance Criteria For Enabling UI

- A local OAuth setup can be completed without storing raw Google credentials.
- One grouped folder can become one Google Photos album with the same folder name.
- Partial failures are persisted per file and can be retried.
- The implementation reports unsupported file types before upload.
- The user sees a storage/quota warning before starting.

## Non-Goals For MVP

- Reading or reorganizing the user's existing Google Photos library.
- Managing shared albums.
- Syncing deleted or renamed files after export.
- Exposing Google Photos as a production target before the spike proves reliable.

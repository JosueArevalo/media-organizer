# Google Photos Export Notes

## Purpose

Google Photos export is part of the implemented Media Organizer workflow.

This document captures the design constraints and product boundaries that still matter for maintaining or extending that integration:

- OAuth desktop/local flow for a single user.
- Creating or reusing app-created albums named after grouped folders.
- Uploading supported image/video files into those albums.
- Handling batch limits, retries, partial failures, and storage warnings.

## API Shape

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

## Current Behavior Expectations

- A local OAuth setup can be completed without storing raw Google credentials.
- One grouped folder can become one Google Photos album with the same folder name.
- Partial failures are persisted per file and can be retried.
- The implementation reports unsupported file types before upload.
- The user sees a storage or quota warning before starting.

## Product Boundaries

- The integration is upload-focused, not a full Google Photos sync client.
- Reading or reorganizing the user's existing Google Photos library remains out of scope.
- Managing shared albums remains out of scope.
- Syncing deleted or renamed local files back to Google Photos remains out of scope.
- Public documentation should describe the feature as a built-in export target with `append-only` constraints, not as two-way cloud synchronization.

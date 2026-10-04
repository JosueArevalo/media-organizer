# Shared export workflow

Connection setup remains provider-specific. Google Photos and Network Folder share
the preview, selection, file details, progress, pause/resume and retry UI. Adding a
provider requires an adapter and its backend transport; it does not require copying
the workflow. Google Drive remains a placeholder.

## Interfaces

`POST /api/export/preview` accepts:

```json
{
  "sourceRoot": "/organized",
  "groupingSessionId": "grouping-session-id",
  "target": { "type": "network-folder", "destinationPath": "/mnt/nas/photos" }
}
```

The response contains `groups`, `supportedItems` and `unsupportedItems`. Each group
has a stable `id`, display `label`, `exportStatus`, `itemCount` and complete item
states. `isRoot` identifies loose source-root files; `destinationStatus` is an
optional destination badge and `selectionLocked` protects an in-progress group's
scope. IDs are opaque UI values: `folder:<first-level name>`, `root:`, or
`album:<Google Photos title>`. Nested paths are preserved inside their parent group.

An optional `jobId` restores complete persisted states in the current preview,
including files outside the progress endpoint's 50-item rolling window. The server
checks its provider, source, execution and destination/account. `jobOnly: true`
requires `jobId` and returns the original persisted job files for historical views,
even if the source is no longer available. It does not query a remote provider.

`PATCH /api/export/jobs/:id/scope` accepts `{ "groupIds": ["folder:Trip"] }` and
returns the updated job snapshot. Read the effective selection from its checkpoint:
the backend retains protected groups even if a client attempts to remove them.
Invalid scopes return 400; runners still finishing an item return 409. Missing jobs
return 404. Existing Google Photos preview and `google-photos-scope` endpoints remain
available with their original shapes.

Network job creation adds optional `target.groupIds`; Google Photos continues to
use `target.albumTitles`. Absent selection means the legacy full scope. Explicitly
empty selections cannot create a job. An empty draft/paused editable scope stays
draft/paused so users can select groups later. Plans with no pending files are
terminal without starting a runner. Progress adds `groupProgress` to the existing
response and preserves Google Photos `albumProgress`.
The HTTP progress response also exposes `runnerActive`: a paused UI continues to
poll until the current transfer finishes before enabling scope changes or resume.

## Persistence and recovery

- Scope is stored in existing checkpoint JSON; no SQL migration is needed.
- Only draft/paused jobs can change scope. Groups with results, previous attempts,
  running files or Google Photos upload/create metadata are protected. Network
  mutations wait for the runner to finish its current file.
- Scope writes are serialized in the shared hook. Start is blocked until confirmed;
  failed writes recover the effective scope from the backend.
- Restore and terminal reconciliation are read operations and never start/resume
  jobs. Responses from a previous source, execution, destination/account or
  unmounted screen are ignored. Progress polling is sequential.
- Frontend snapshots remain provider-specific and execution/source-scoped. Backend
  state remains authoritative; terminal timestamps survive progress refreshes.

## Network exports

All previously eligible files are retained, including non-media files; internal
`.media-organizer` content is excluded. Each immediate child directory is a selectable
group containing its descendants. Loose root files form a separate group. Empty
directories do not create export groups, matching the existing file-copy behavior.

Only one nonterminal job is allowed per execution and equivalent network destination.
Terminal jobs remain in history and allow a new job for pending files. There is still
only one active network runner globally. Completed/skipped historical files are
omitted from a new plan only after checking the current source and destination
contents with the existing equality check. New, modified or missing copies become
pending. Existing unrelated destination files are not deleted.

Job progress describes its selected files. Network `eligibleItems` describes the
full current source so completing a partial job does not mark global provider
coverage complete. Google Photos keeps its existing selected-album coverage rules.

## Validation

Run backend and frontend suites, the root build, `npm run test:interaction` (Firefox
and Electron), and `npm run desktop:build` followed by `npm run desktop:smoke`.
Interaction fixtures mock export APIs; backend tests use owned temporary directories
and mocked Google calls. No real account or NAS export is required for these checks.

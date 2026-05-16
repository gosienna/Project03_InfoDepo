# Drive synchronization

InfoDepo synchronization is based on owner folders plus item-level sharing metadata (`sharedWith`).

## Code map

| File | Role |
|------|------|
| `utils/libraryDriveSync.js` | `runOwnerSyncPipeline` and `runViewerDeskSyncPipeline` orchestration |
| `utils/driveSync.js` | `classifyChanges`, `backupChangedItems`, `pullChangedItems`, `syncFolderAssetsAndSidecars`; single-item helpers |
| `utils/ownerIndex.js` | write/read `_infodepo_index.json`; `updateOwnerIndexEntry` for per-edit patches |
| `utils/peerSync.js` | peer discovery/download/prune for shared content |
| `components/Library.js` | owner `runOwnerSync` (manual Sync + one startup run per page load); per-edit desk debounce; registers sync functions with `App.js` |
| `App.js` | Header **Sync** calls the owner sync function registered from `Library` (`syncFnRef`); gates first desk display until initial sync resolves; `Library` stays mounted (hidden) so Sync works from desk/reader views; `setSharedWithFnRef` routes Desk sharing changes through the full `handleSetSharedWith` flow |

---

## Owner pipeline

`runOwnerSyncPipeline(...)` executes seven steps sequentially:

### Step 1 — Fetch + merge Drive index

Fetches `_infodepo_index.json` from Drive (one API call). For each entry, compares `sharedWith` against the local IDB record. If they differ, patches the local record via `mergeItem/Channel/DeskSharedWithByDriveId`. The fetched `driveIndex` object is held in memory for Step 2.

### Step 2 — Classify changes (`classifyChanges`)

`classifyChanges(driveIndex, syncItems, syncChannels, syncDesks)` is a **pure function** (no I/O) that compares the Drive index against local arrays to produce two lists:

| List | Criteria |
|------|----------|
| `toBackup` | No `driveId` locally, OR `driveId` not in index, OR `localModifiedAt > indexEntry.modifiedTime` |
| `toPull` | `indexEntry.modifiedTime > local.modifiedTime`, OR driveId present in index but absent locally |

Items with `idbStore === 'images'` are excluded from `toBackup` (standalone image files are handled by Step 6). Duplicates in `toPull` are deduplicated by `driveId`.

### Step 3 — Backup changed items (`backupChangedItems`)

Uploads only the pre-classified `toBackup` list. Each entry is processed according to its `storeName`:

| Type | Logic |
|------|-------|
| Items (books, notes, videos) | `noteBundleNeedsBackup` safety gate; note bundles → create/reuse folder; simple files → PATCH or POST |
| Channels | Serialize with `_type: 'infodepo-channel'`; PATCH or POST |
| Desks | Delegate to `backupSingleDesk`; PATCH or POST |

PDF annotation sidecars and cover image sidecars iterate the **full** items list (these can become dirty independently of the main blob). Returns `{ backed, failed, updatedEntries }` where `updatedEntries` is `[{ id, storeName, driveId, modifiedTime, driveFolderId? }]`.

After this step, `syncItems/syncChannels/syncDesks` are patched with the new driveIds and modifiedTimes from `updatedEntries` so the index write in Step 4 is accurate.

### Step 4 — Write owner index

Writes `_infodepo_index.json` with the merged + patched state. **Skipped** unless:
- At least one local item has a `driveId` (guards against overwriting a valid Drive index on first sync), AND
- Either something was backed up (`backupResult.updatedEntries.length > 0`) OR `sharedWith` was patched in Step 1.

The index entry for each item now includes `driveFolderId` for note bundles, enabling Step 5 to list the correct subfolder without a root folder scan.

### Step 5 — Pull changed items (`pullChangedItems`)

Downloads only the `toPull` entries by fetching each `driveId` directly — no full folder listing. Files are dispatched by entry type:

| Type | Action |
|------|--------|
| `infodepo-channel` | Fetch JSON → `upsertDriveChannel` |
| `infodepo-desk` | Fetch JSON → `upsertDriveDesk` |
| Note (`.md`) with `driveFolderId` | List subfolder, download `.md` + image assets → `upsertDriveBook` |
| Note without `driveFolderId` | Download `.md` directly (degraded: no assets) |
| Binary (EPUB, PDF, TXT) with `lazyBooks` | Metadata only (`data: null`) → `upsertDriveBook` |
| YouTube (`.youtube`) | Fetch JSON, parse URL → rewrite to `application/x-youtube` blob |
| Other JSON | Fetch and pass directly → `upsertDriveBook` |

`sharedWith` and `tags` from the index entry are embedded in the `driveFile` object passed to upsert callbacks, so no separate `withIndexMeta` wrapper is needed.

### Step 6 — Sync images and sidecars (`syncFolderAssetsAndSidecars`)

Lists the root Drive folder once to discover files not tracked by the index:

| Phase | Content |
|-------|---------|
| PDF annotation sidecars | JSON files matching `.infodepo-pdf-annotations.json` pattern |
| User images (Phase 3) | Non-cover image files; matched to parent notes by markdown `![](filename)` scan |
| Cover sidecars (Phase 4) | Silent; not counted in progress; skip if `coverImageDriveId` already matches |

Note bundle image assets in subfolders are handled by `pullChangedItems` (Step 5), not here.

### Step 7 — Peer sync (`syncSharedFromPeers`)

Downloads content shared by other owners. Uses a two-phase approach (index gather → prune + download). See [Viewer shared-content sync](#viewer-shared-content-sync) for details.

---

## Dirty detection

| Field | Set when | Used for |
|-------|----------|----------|
| `localModifiedAt` | User edits locally (IDB write) | Backup dirty check in `classifyChanges` |
| `modifiedTime` | After backup upload (Drive response) or after download from Drive | Pull skip check in `classifyChanges` |

Invariant after successful backup or download: `localModifiedAt ≤ modifiedTime`, so the item is clean on the next sync.

`classifyChanges` compares `localModifiedAt` against the **index** `modifiedTime` (not local `modifiedTime`). This is more correct than the previous approach — it detects when Drive was updated by another device even if the local `modifiedTime` hasn't been written yet.

Helper functions in `utils/driveSync.js`:
- `itemNeedsBackupUpload(item)` — requires blob; checks `driveId` missing or `localModifiedAt > modifiedTime`.
- `deskNeedsBackupUpload(desk)` — same logic without blob requirement.
- `channelNeedsBackupUpload(ch)` — same as desk.

---

## Desk backup and sync

Desk records are serialized as `<name>.desk.json` with `_type: 'infodepo-desk'` marker:

```json
{
  "_type": "infodepo-desk",
  "name": "My Desk",
  "layout": { "notes:3": { "x": 120, "y": 80 } },
  "connections": [],
  "tags": [],
  "sharedWith": [],
  "ownerEmail": "user@example.com"
}
```

### Per-edit auto-upload (debounced)

Every user edit on the Desk canvas calls one of three commit functions (`commitLayout`, `commitConnections`, `commitTextItems`). Each commit:

1. Writes the change to IDB (`setDeskLayout` / `setDeskConnections` / `setDeskTextItems`), bumping `localModifiedAt`.
2. Calls `onDeskModified(desk.id)` → `itemBackupFnRef.current(id, 'desks')` in App.js → `triggerDeskBackup(id)` in Library.js.
3. A **3-second debounce** per desk ID resets on each call. Only after 3 s of inactivity on that desk does the upload fire.
4. At fire time, the latest desk is read from `desksRef.current` (a ref kept in sync with the `desks` prop), so rapid edits collapse to a single upload of the final state.
5. `backupSingleDesk(desk, { accessToken, folderId, onSetDriveId })` uploads to Drive (PATCH or POST), then writes `modifiedTime` back to IDB.
6. After a successful backup, `updateOwnerIndexEntry(driveId, { modifiedTime, name, type, sharedWith, tags }, ...)` patches the Drive index so the next sync on any device sees the updated timestamp immediately.

The per-edit path is guarded: only `master` / `editor` roles trigger it; viewers never upload via this path.

### Full pipeline upload

`backupChangedItems` now handles desks by delegating to `backupSingleDesk` (no code duplication). It runs as Step 3 of `runOwnerSyncPipeline` on manual Sync and on startup.

### Pull from Drive

`pullChangedItems` Step 5 downloads desk JSON files and calls `upsertDriveDesk`. The record is updated only if `driveFile.modifiedTime > existing.modifiedTime`; otherwise `'skipped'` is returned.

Because **backup runs before pull** in the pipeline, dirty local desks are normally uploaded first; the pull step then compares against the updated `modifiedTime` from the upload response.

---

## Initial desk sync gate

When the app first loads and auto-selects the most-recently-visited desk, a targeted Drive pull is performed **before the Desk component renders**, preventing a stale local copy from being accidentally edited before reconciliation:

1. `currentDesk` is set in state (invisible to user — `initialDeskSyncing = true` shows a loading spinner instead).
2. `initialDeskSyncFnRef.current(desk)` is called (registered from Library.js via `onRegisterInitialDeskSync`).
3. Library fetches `GET /drive/v3/files/{driveId}?fields=modifiedTime`. If Drive is newer, downloads the desk JSON and calls `upsertDriveDesk`.
4. On completion (or any error), `initialDeskSyncing = false` — the Desk renders with fresh data.

This gate fires **only once** per page load (`firstDeskDisplayedRef.current` flag). Subsequent desk switches are not gated. Desks with no `driveId` (local-only) and offline/no-credential cases skip the sync immediately and clear the spinner.

---

## Lazy book loading

Binary book files (EPUB, PDF, TXT — anything with a non-JSON, non-Markdown MIME type) are synced in **metadata-only mode** during both owner pull and peer sync. The blob is not downloaded at sync time; only Drive metadata (name, driveId, mimeType, size, modifiedTime) is stored with `data: null`.

**On click**, `App.js`'s `openItem` handler detects `data === null && driveId` and downloads the blob in the library tab before opening the reader tab. This keeps the user on the library page during the download so the progress overlay on the DataTile is visible.

**Visual indicator**: `DataTile` renders a cloud-download icon on tiles with `data === null && driveId`. During download, the icon is replaced by a progress overlay driven by `itemDownloadProgress` — a per-blobKey progress map passed from `App.js` to both `Library` and `Desk`.

**Exceptions — always downloaded eagerly:**
- `application/json` (must be parsed to detect type)
- `text/markdown` notes (small text files)
- Cover image sidecars (needed for tile thumbnails)
- PDF annotation sidecars (small JSON)

---

## Viewer shared-content sync

For `viewer`, `Library.js` triggers `syncSharedFromPeers` once after role/config are ready. Two-phase approach:

**Phase 1 — index gathering:**
1. List peers from `config.users` that have `folderId`.
2. Fetch each peer's `_infodepo_index.json`.
3. Filter entries where `sharedWith` contains the viewer email.
4. Accumulate `peerData[]` and compute `globalTotal`.

**Phase 2 — prune + download:**
5. For each peer: prune local rows whose `driveId` is no longer in the peer's shared set.
6. For each shared entry: upsert — binary books as metadata-only (`lazyBooks: true`), JSON eagerly.
7. For each entry with `coverImageDriveId`, download the cover sidecar.

---

## Viewer desk sync

Viewers back up their own desks to a personal Drive folder (folder ID set by master in Manage Users). `runViewerDeskSyncPipeline` uses the same classification-based approach as the owner pipeline, but desks-only:

1. **Fetch** — `fetchOwnerIndex` with viewer's `folderId` (may be null on first run).
2. **Classify** — `classifyChanges(driveIndex, [], [], desks)` — only desks.
3. **Backup** — `backupChangedItems(toBackup, ...)` — dirty desks only.
4. **Write index** — if anything was backed up, write the viewer's `_infodepo_index.json`.
5. **Pull** — `pullChangedItems(toPull, { upsertDriveDesk })` — desks only.

No folder listing (`syncFolderAssetsAndSidecars`) is performed for the viewer folder, as it contains only desk JSON files.

---

## Cover image sidecar backup and sync

**Filename:** `${item.name}.infodepo-cover.${ext}` (`isCoverSidecarFilename` detects these).

**Backup:** `backupChangedItems` iterates all items looking for `coverImage.data && !coverImageDriveId` → POST blob → `onSetCoverImageDriveSync` persists Drive ID.

**Pull (Phase 4 in `syncFolderAssetsAndSidecars`):** `upsertDriveCoverImage({ driveId, parentItemName, mimeType, modifiedTime }, blob)` — parent item found by stripping the sidecar suffix from the filename.

**Peer sync:** if `entry.coverImageDriveId` is set, cover blob is fetched after the main item.

---

## Sync progress display

Both owner and viewer syncs show a unified `X / N` counter in the Library's in-body banner and Header Sync button text while `isSyncing` is true.

`pullChangedItems` counts total entries (`toPull.length`) before any downloads start and emits `idx / total` per item. `syncFolderAssetsAndSidecars` emits progress per image. Cover sidecars are excluded from counting.

Neither `pullChangedItems` nor `syncFolderAssetsAndSidecars` clears the progress message on completion — the `finally` block in `Library.js` is the sole clearer via `setSyncProgress('')`.

---

## Rendering strategy during sync

Sync paths use silent upserts (`{ silent: true }`) and a final `loadAll()` flush at the end of the pipeline. This avoids repeated re-renders during long sync runs. The per-edit desk debounce path does NOT use silent mode — each `backupSingleDesk` call writes `modifiedTime` back immediately so the item is marked clean.

---

## ACL + index refresh on sharing updates

When the owner changes an item's `sharedWith` — from either Library tiles or Desk tiles — the full three-step flow runs:

1. Local `setItemSharedWith` (IDB write)
2. Targeted ACL reconcile (`applySharedWithToDriveFiles`)
3. Owner index rewrite (`writeOwnerIndex`) so viewers can discover changes immediately

`handleSetSharedWith` in `Library.js` implements this flow. The Desk component receives it through a ref registration pattern (`setSharedWithFnRef` in `App.js`, registered via `onRegisterSetSharedWith`), identical to how `syncFnRef` and `itemBackupFnRef` are wired. This ensures Desk tiles never bypass ACL reconcile or index rewrite.

When a desk's `sharedWith` is updated, newly added emails are also propagated to every item in the desk layout that already has a `driveId`. Removal does **not** revoke item-level access (items may be independently shared elsewhere).

---

## Index consistency

The index lives only on Drive (`_infodepo_index.json`). After `pullChangedItems` downloads an item, the local IDB record's `modifiedTime` is updated to match the Drive file's timestamp. On the next sync cycle, `fetchOwnerIndex` re-reads the Drive index (unchanged since pull), compares against the now-updated local `modifiedTime` → item is clean. No additional write needed after pulling.

After `backupChangedItems`, `syncItems/syncChannels/syncDesks` are patched with `updatedEntries` before the index is written, ensuring newly uploaded items (with freshly assigned driveIds) appear in the index immediately.

---

## Related docs

- [sharing-mechanism.md](sharing-mechanism.md)
- [google-drive-integration.md](google-drive-integration.md)
- [data-stores.md](data-stores.md)

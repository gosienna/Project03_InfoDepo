# Sync Improvement Plan — Notes images & Desk conflict merging

Status: proposed (not yet implemented). Scope of this document: **Phase 1** (stop
data loss) and **Phase 2** (correct desk sync with conflict merging). Phases 3–4
are summarized at the end for context but intentionally left undetailed.

> Companion reference: [`drive-synchronization.md`](drive-synchronization.md),
> [`data-stores.md`](data-stores.md).

Line numbers below are anchors against the current code and may drift — rely on
the **function names** first.

---

## 0. Background: how sync works today

- **Drive is the source of truth.** One `_infodepo_index.json` per owner folder
  lists every Drive-backed record as
  `{ driveId (=Google file id), modifiedTime, sharedWith, tags, driveFolderId?, coverImageDriveId? }`.
- **One pipeline** — `runOwnerSyncPipeline` (`utils/libraryDriveSync.js`):
  fetch+merge index → `classifyChanges` → `backupChangedItems` → `writeOwnerIndex`
  → `pullChangedItems` → `syncFolderAssetsAndSidecars` → peer sync.
- **Dirty detection** (`classifyChanges`, `utils/driveSync.js`) compares local
  `localModifiedAt` (set on every IDB edit, **local wall clock**) against the
  index `modifiedTime` (**Drive server clock**).
- **Desk per-edit path**: each canvas edit → 3 s debounce → `backupSingleDesk`
  → write `modifiedTime` locally → `updateOwnerIndexEntry` (read-modify-write of
  the whole index). Wired in `components/Library.js` `triggerDeskBackup`.
- **Sync only fires** on: the manual **Sync** button, one startup run, and a
  **one-time** initial-desk gate. There is **no periodic, focus-based, or
  real-time sync** — `visibilitychange` only calls `loadItems()` (no network).

---

## Issue 1 — Note images lost after closing the editor

**1a. No autosave; the image *reference* is written only on explicit save.**
`insertImage` (`components/MarkdownEditor.js` ~1600) persists the image *blob*
into `note.assets` immediately (via `onAddImage` → `addImage`,
`hooks/useIndexedDB.js` ~726) and bumps `localModifiedAt`. But the markdown
reference `![](name)` is written into the note's `data` blob only inside
`handleSave` (~1521), which fires only on Ctrl+S / Save. In HTML mode the image
exists **only as an `<img>` in the contentEditable DOM** (a `blob:` URL revoked
on unmount, ~560). Closing without saving orphans the asset blob and the
reference never reaches `note.data` → image gone on reopen.

**1b. Assets are never uploaded to Drive (temp-id bug).** `addImage` assigns
`driveId: makeTempDriveId('note-asset')` (a `local:note-asset:…` value). Backup
code treats **any truthy `asset.driveId` as "already on Drive"**:
`noteBundleNeedsBackup` flags an asset new only when `driveId` is empty
(`utils/driveSync.js` ~490), and the upload loops do
`if (asset.driveId) { …; continue; }` (~1198, ~1218, and the
`backupAllToGDrive` twins ~780, ~801). So the image file is never POSTed;
`setNoteFolderData` stores the local temp id as the asset's "Drive id". On
another device, `pullChangedItems` lists the bundle subfolder, finds no image,
and the reference is broken there too.

**1c. Fragile asset↔note association.** The folder asset scan matches images to
notes by regex-scanning markdown for `![](filename)` into a `Map` keyed by
filename (`utils/driveSync.js` ~1607). Duplicate filenames across notes
collide; any reference lost via 1a can never be re-matched.

---

## Issue 2 — Desk sync unstable / conflicts with no merge

**2a. Last-writer-wins, no merge (core gap).** `upsertDriveDesk` replaces the
whole record (`{ ...existing, ...deskData }`, `hooks/useIndexedDB.js` ~1612)
when Drive is newer. `classifyChanges` puts a record in **either** `toBackup`
**or** `toPull`, never both — the backup branch returns before the pull check
(`utils/driveSync.js` ~1042). So a device with local edits *and* a newer Drive
copy uploads and **overwrites the remote entirely**. No field/element-level
merge of `layout` / `connections` / `textItems`.

**2b. No timely propagation.** Changes reach other devices only via manual Sync,
the one startup sync, or the **one-time** initial-desk gate. A device with a
desk open never receives remote edits.

**2c. Index writes have no concurrency control.** `updateOwnerIndexEntry` and
`writeOwnerIndex` (`utils/ownerIndex.js` ~94, ~13) fetch → mutate → PATCH the
whole file with **no ETag/If-Match**. Concurrent writers clobber each other's
entries; a desk's `modifiedTime` can revert → other devices stop pulling it.

**2d. Clock-skew-sensitive dirty detection.** Correctness depends on comparing a
**local wall clock** (`localModifiedAt`) to a **Drive server clock**
(`modifiedTime`). Skew → false-clean (edits never uploaded) or false-dirty
(spurious re-upload that clobbers a remote edit).

**2e. Blob upload and index patch are non-atomic.** The per-edit path uploads
the blob, writes local `modifiedTime`, then patches the index in a separate
best-effort call (`components/Library.js` ~941, only logged on failure). If the
patch fails, Drive has the new blob but the index shows the old `modifiedTime`
— and pull is index-driven, so other devices never fetch it.

**2f. Latent bug — viewer pipeline patch.** `runViewerDeskSyncPipeline`
(`utils/libraryDriveSync.js` ~353) keys its patch map on `e.id`/`d.id` and reads
`p.driveId`, but `updatedEntries` use `{ localDriveId, driveFileId, modifiedTime }`
and records have no `id`. The map collapses to a single `undefined` key →
multi-desk viewer backups can stamp the wrong `modifiedTime`.

**2g. Related risk — deletions can resurrect.** `classifyChanges` pulls any
index entry whose `driveId` is absent locally (`utils/driveSync.js` ~1055). A
local delete that doesn't atomically remove both the Drive file and its index
entry will be re-downloaded. No tombstone mechanism exists. (Addressed in Phase 4.)

---

# Phase 1 — Stop the data loss (low risk, self-contained)

Goal: a note's images survive editor close on the same device, and reach Drive /
other devices. No schema migration required.

### Files to touch

| File | Change |
|------|--------|
| `components/MarkdownEditor.js` | Autosave + flush on exit; write image reference atomically with the blob |
| `utils/driveSync.js` | Treat temp asset `driveId` as not-yet-uploaded (use `isTempDriveId`) |
| `hooks/useIndexedDB.js` | (optional) keep `assetId` separate from Drive `driveId`; self-heal on note open |

### 1.1 Note autosave + atomic reference write

**MarkdownEditor.js**

1. **Flush on exit.** Add an effect that saves when dirty on unmount and on
   `visibilitychange→hidden` / `beforeunload`. Reuse the existing save logic
   (which already converts HTML→MD via `htmlToMarkdown()`):

   ```js
   // keep latest dirty state + serializer in refs so the cleanup closure is current
   const isDirtyRef = useRef(false); useEffect(() => { isDirtyRef.current = isDirty; }, [isDirty]);

   useEffect(() => {
     const flush = () => { if (isDirtyRef.current && !isSavingRef.current) handleSave(); };
     const onHide = () => { if (document.hidden) flush(); };
     document.addEventListener('visibilitychange', onHide);
     window.addEventListener('beforeunload', flush);
     return () => {
       document.removeEventListener('visibilitychange', onHide);
       window.removeEventListener('beforeunload', flush);
       flush(); // unmount = editor closed
     };
   }, []); // mount once; relies on refs
   ```
   Note: `handleSave` is async; on `beforeunload` the IDB write may not finish.
   The debounced autosave below is the primary guarantee — exit-flush is backup.

2. **Debounced autosave.** On every edit that sets `isDirty`, schedule a save
   ~800–1500 ms later (clear/reset the timer on each keystroke). This means the
   `![](name)` reference is persisted shortly after an image is inserted, even if
   the user never presses Save.

3. **Atomic reference (belt-and-suspenders).** In `insertImage`, after
   `onAddImage(...)`, also ensure the reference is in the persisted text, not only
   the DOM. Simplest: in HTML mode, after inserting the `<img>`, set
   `htmlPristine.current = false; setIsDirty(true)` (already done) **and** kick the
   debounced autosave immediately so the DOM→MD conversion runs and `note.data` is
   written. In Markdown mode the reference is already appended to `text`.

**Acceptance:** insert image → wait ~1.5 s (or close editor) → reopen note → image
still renders. No explicit Ctrl+S needed.

### 1.2 Fix asset upload (temp-id)

The bug: temp `driveId` (`local:note-asset:…`) is mistaken for a real Drive id.
Use `isTempDriveId` (already exported from `utils/driveRecordKey.js`).

**utils/driveSync.js**

- Import: `import { hasDriveCopy, isTempDriveId, parseDeskLayoutKey } from './driveRecordKey.js';` (file already imports the first/third — just add `isTempDriveId` if missing).

- `noteBundleNeedsBackup` (~485): an asset is "new" when it has data and **no real
  Drive id**:
  ```js
  const anyNew = item.assets.some((a) => a?.data && (!a.driveId || isTempDriveId(a.driveId)));
  ```

- In **every** asset upload loop (`backupChangedItems` ~1198 and ~1218;
  `backupAllToGDrive` ~780 and ~801), change the "already uploaded" guard from
  `if (asset.driveId)` / `if (String(asset.driveId||'').trim())` to:
  ```js
  const realId = String(asset.driveId || '').trim();
  if (realId && !isTempDriveId(realId)) { assetDriveIds.push({ name: asset.name, driveId: realId }); continue; }
  // else: POST the asset, then push the returned Drive id
  ```
  The POST already returns the real id (`af.id`); that flows into
  `onSetNoteFolderData` → `setNoteFolderData`, which overwrites the temp id with
  the real one (`hooks/useIndexedDB.js` ~919). No change needed there.

**Acceptance:** add image to a note, run Sync → the image file appears in the
note's Drive subfolder; a second device pulls and renders it.

### 1.3 Robust association + self-heal (optional but recommended)

- On note open, reconcile `note.assets` against the `![](name)` references in
  `note.data`: warn on missing assets, and offer to drop dead references / keep
  orphaned assets. Cheap to add in the load effect (`MarkdownEditor.js` ~525).
- De-dupe filename collisions in the Phase-3 scan map
  (`utils/driveSync.js` ~1607 and ~391): key by `noteDriveId + name`, not `name`
  alone, when a note context is known.

### Phase 1 testing
- Manual: the two acceptance checks above.
- Add a Playwright case: create note → insert image → navigate back to Library
  (no Save) → reopen → assert `<img>`/`![]()` present.

---

# Phase 2 — Correct desk sync with conflict merging

Goal: concurrent edits on two devices **merge** instead of overwriting; index
and blob writes are race-safe; dirty detection no longer depends on cross-clock
comparison. This is the "merging process which is currently lacking."

### New data (desk record + desk JSON)

Add to the desk record in IDB and to the serialized `*.desk.json`:

| Field | Where | Meaning |
|-------|-------|---------|
| `rev` | desk JSON + IDB | monotonic integer, incremented on each committed local edit |
| `dirty` | IDB only | boolean; true after a local edit, cleared after confirmed upload |
| `baseSnapshot` | IDB only | last-synced `{ layout, connections, textItems, rev }` — the merge base |
| `driveHeadRevisionId` | IDB only | Drive `headRevisionId` of the last fetched/uploaded version (for If-Match) |

`baseSnapshot` and `dirty`/`driveHeadRevisionId` are local-only and never
serialized to Drive. `rev` travels in the desk JSON so peers can compare.

No IndexedDB schema-version bump is required (these are new properties on
existing `desks` records); guard for their absence (treat missing `rev` as 0,
missing `baseSnapshot` as "no base → fall back to last-writer-wins for that one
sync, then snapshot").

### Files to touch

| File | Change |
|------|--------|
| `utils/deskMerge.js` (new) | 3-way merge of `layout` / `connections` / `textItems` |
| `utils/driveSync.js` | `classifyChanges`: detect `conflict`; `backupSingleDesk`/PATCH: send `If-Match`; surface 412 |
| `utils/ownerIndex.js` | `uploadIndexPayload`: `If-Match` + serialized writes; return new ETag |
| `hooks/useIndexedDB.js` | `upsertDriveDesk`: merge path; set/clear `dirty`, `rev`, `baseSnapshot` |
| `components/Library.js` | `triggerDeskBackup`: clear `dirty` only after both blob + index succeed |
| `utils/libraryDriveSync.js` | wire conflict handling into owner + viewer pipelines; fix 2f |

### 2.1 Replace clock comparison with `dirty` + `rev`

- On every desk commit (`setDeskLayout` / `setDeskConnections` / `setDeskTextItems`,
  `hooks/useIndexedDB.js` ~1492+): set `dirty: true` and `rev: (existing.rev||0)+1`
  in addition to the existing `localModifiedAt` bump.
- `deskNeedsBackupUpload` (`utils/driveSync.js` ~496): return `record.dirty === true`
  (fallback to the old time comparison only when `dirty` is undefined for legacy
  records). This removes clock-skew (2d) for desks.
- Clear `dirty` (and refresh `baseSnapshot` + `driveHeadRevisionId`) **only** after
  a confirmed upload **and** index update (see 2.4) — not before.

### 2.2 Conflict detection in `classifyChanges`

Today a record is `toBackup` XOR `toPull`. Add a third bucket:

```js
// inside checkRecord(), for desks (and later, any mergeable type):
const localDirty   = record.dirty === true; // or lm > im fallback
const remoteNewer  = im != null && dm != null && im > dm; // index newer than local
if (localDirty && remoteNewer) { toMerge.push({ record, entry, storeName }); return; }
if (localDirty)  { toBackup.push({ record, storeName }); return; }
if (remoteNewer) { toPull.push(entry); return; }
```

Return `{ toBackup, toPull, toMerge }`. Non-desk types can keep XOR behavior
initially (push to `toBackup`) to limit blast radius; expand later.

### 2.3 The merge engine — `utils/deskMerge.js` (new)

3-way merge using `baseSnapshot` as the common ancestor. Pure functions, no I/O.

```js
// layout: object keyed by `drive:{id}` → { x, y, driveFileId? }
export function mergeLayout(base = {}, local = {}, remote = {}) {
  const keys = new Set([...Object.keys(base), ...Object.keys(local), ...Object.keys(remote)]);
  const out = {};
  for (const k of keys) {
    const b = base[k], l = local[k], r = remote[k];
    const lChanged = JSON.stringify(l) !== JSON.stringify(b);
    const rChanged = JSON.stringify(r) !== JSON.stringify(b);
    // deletions
    if (l === undefined && lChanged) { if (!rChanged) continue; /* local deleted, remote untouched → delete */ }
    if (r === undefined && rChanged) { if (!lChanged) continue; /* remote deleted, local untouched → delete */ }
    // both present: prefer the side that changed; if both changed, prefer local move (tie-break) or last rev
    if (lChanged && !rChanged) out[k] = l;
    else if (rChanged && !lChanged) out[k] = r;
    else if (lChanged && rChanged) out[k] = l ?? r;   // both moved same tile → keep local; document the choice
    else if (l !== undefined) out[k] = l;             // unchanged on both
    else if (r !== undefined) out[k] = r;
  }
  return out;
}

// connections / textItems: arrays of objects with stable `id`
export function mergeById(base = [], local = [], remote = []) {
  const byId = (arr) => new Map(arr.map((x) => [x.id, x]));
  const [B, L, R] = [byId(base), byId(local), byId(remote)];
  const ids = new Set([...B.keys(), ...L.keys(), ...R.keys()]);
  const out = [];
  for (const id of ids) {
    const b = B.get(id), l = L.get(id), r = R.get(id);
    const lChanged = JSON.stringify(l) !== JSON.stringify(b);
    const rChanged = JSON.stringify(r) !== JSON.stringify(b);
    if (l === undefined && lChanged && !rChanged) continue; // local deleted
    if (r === undefined && rChanged && !lChanged) continue; // remote deleted
    if (lChanged && !rChanged) { if (l) out.push(l); }
    else if (rChanged && !lChanged) { if (r) out.push(r); }
    else if (lChanged && rChanged) { if (l || r) out.push(l ?? r); }
    else if (l ?? r) out.push(l ?? r);
  }
  return out;
}

export function mergeDesk(base, local, remote) {
  return {
    ...remote, ...local,             // scalar fields: prefer local; adjust per field as needed
    layout:      mergeLayout(base?.layout, local?.layout, remote?.layout),
    connections: mergeById(base?.connections, local?.connections, remote?.connections),
    textItems:   mergeById(base?.textItems,   local?.textItems,   remote?.textItems),
    rev:         Math.max(local?.rev || 0, remote?.rev || 0) + 1,
  };
}
```

Tie-break policy (both sides moved the same tile / edited the same connection)
should be **documented and deterministic**. Start with "local wins on
position, remote wins on additive structure"; revisit if users report surprise.

When `baseSnapshot` is missing (legacy record, first run after deploy): skip the
3-way merge for that single cycle, take remote, then write a fresh
`baseSnapshot`. This degrades gracefully to current behavior exactly once.

### 2.4 Merge flow + race-safe writes

**Pull/merge in IDB** (`hooks/useIndexedDB.js` `upsertDriveDesk`): add a
`mode: 'merge'` path that, given the remote `deskData`, computes
`mergeDesk(existing.baseSnapshot, existing, remoteDeskData)`, stores the result,
marks `dirty: true` (the merged result must be re-uploaded), and updates
`baseSnapshot` to the **remote** content (the new common ancestor for next time).

**Pipeline** (`utils/libraryDriveSync.js`): after `classifyChanges`, process
`toMerge`: download each remote desk JSON, call the merge upsert, then include the
merged desks in the subsequent `backupChangedItems` run so the merged result is
pushed back to Drive.

**Optimistic concurrency** (`utils/driveSync.js` + `utils/ownerIndex.js`):
- On desk fetch, capture `headRevisionId` (request `fields=...,headRevisionId`).
- On `drivePatchMultipart` for desks and on `uploadIndexPayload`, send
  `If-Match: <etag>` (Drive supports `If-Match` against the file ETag). On `412`,
  re-fetch, re-merge, retry (bounded, e.g. 3 attempts with small backoff).
- Serialize index writes with a module-level promise chain (mutex) so
  `updateOwnerIndexEntry` and `writeOwnerIndex` cannot interleave (fixes 2c).

**Atomic clear of `dirty`** (`components/Library.js` `triggerDeskBackup` ~920):
only clear `dirty` / refresh `baseSnapshot` after **both** the blob upload **and**
`updateOwnerIndexEntry` succeed. If the index patch fails, leave `dirty: true` so
the next sync rewrites the index (fixes 2e). Today the index failure is only
logged.

### 2.5 Fix the viewer pipeline patch (2f)

`utils/libraryDriveSync.js` `runViewerDeskSyncPipeline` (~352): key the patch map
on `localDriveId` and read `driveFileId`, matching `updatedEntries`' real shape:

```js
const patchById = new Map(backupResult.updatedEntries.map(e => [e.localDriveId, e]));
syncDesks = syncDesks.map(d => {
  const p = patchById.get(d.driveId);
  return p ? { ...d, driveFileId: p.driveFileId, modifiedTime: p.modifiedTime } : d;
});
```

### Phase 2 testing
- Unit-test `utils/deskMerge.js` (pure): disjoint moves merge; same-tile move uses
  tie-break; add/remove connection both survive; deletion vs untouched deletes;
  deletion vs concurrent edit keeps the edit.
- Playwright two-context test: two browser contexts open the same desk, each moves
  a different tile, both sync → both tiles end at their moved positions on both
  devices (no loss). Then both move the **same** tile → deterministic tie-break.
- Concurrency: fire two `updateOwnerIndexEntry` calls in parallel → assert both
  entries survive (serialized writer / If-Match retry).

---

## Later phases (summary only — not in scope here)

- **Phase 3 — Timely propagation:** sync on `visibilitychange→visible` / window
  `focus` / `online`; re-pull the open desk on focus; periodic background sync
  (~30–60 s); flush pending desk uploads on `beforeunload`/blur; optionally adopt
  the Drive `changes.list` feed (stored `startPageToken`) for near-real-time pull
  without folder scans.
- **Phase 4 — Cross-cutting:** tombstones in the index so deletions propagate and
  don't resurrect (2g); extend conflict/merge to other mergeable types; broaden
  the two-device Playwright suite.

---

## Suggested order of work

1. Phase 1.2 (asset upload fix) — one-line-ish, unblocks cross-device images.
2. Phase 1.1 (autosave/flush) — stops same-device loss.
3. Phase 2.1 + 2.5 (dirty/rev flag, viewer-patch fix) — small, prerequisite.
4. Phase 2.3 (`deskMerge.js` + unit tests) — the merge engine in isolation.
5. Phase 2.2 + 2.4 (conflict bucket, merge flow, If-Match, atomic dirty clear).

Each step is independently shippable and testable.

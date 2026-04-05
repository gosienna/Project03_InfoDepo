---
name: Unified DataTile component
overview: Replace `VideoCard.js` and `ChannelCard.js` with a single `DataTile.js` that branches on record type (library item vs channel), reuses one tag UI for both, and extends IndexedDB + Library so channels support tags and `setRecordTags` refreshes the channels list.
todos:
  - id: datatile-file
    content: Add DataTile.js (UploadButton + tag row + item + channel layouts from VideoCard/ChannelCard)
    status: completed
  - id: idb-channels-tags
    content: "useIndexedDB: tags on channels, loadChannels normalization, setRecordTags -> loadChannels for store channels"
    status: completed
  - id: library-youtube
    content: "Library + YoutubeChannelViewer: import DataTile; extend availableTags from channels; remove old imports"
    status: completed
  - id: delete-old
    content: Delete VideoCard.js and ChannelCard.js
    status: completed
  - id: docs
    content: Update data-stores.md, components.md, architecture.md, CLAUDE.md references
    status: completed
isProject: false
---

# Unified `DataTile` for library + channels

## Scope

- **Add** `[components/DataTile.js](components/DataTile.js)`: one component that renders library grid tiles and channel strip tiles, with **format-specific** header/thumbnail/badge (YouTube vs book/note vs channel) and a **shared tag row** (chips + add/remove + dropdown + “New tag”, matching current `[VideoCard.js](components/VideoCard.js)` behavior).
- **Remove** `[components/VideoCard.js](components/VideoCard.js)` and `[components/ChannelCard.js](components/ChannelCard.js)`.
- **Wire** `[components/Library.js](components/Library.js)` and `[components/YoutubeChannelViewer.js](components/YoutubeChannelViewer.js)` to `DataTile`.
- **Data layer** so “all data formats” can persist tags for channels (channels did not have `tags` in practice; `[setRecordTags](hooks/useIndexedDB.js)` only refreshes `loadItems()` today).

## API shape (recommended)

Use an explicit discriminator so parents stay clear:

- **Library items** (books / notes / videos): `tileType: 'item'` and pass the same object shape as today (including `idbStore`, `type`, `name`, `data`, `tags`, …) plus existing callbacks: `onSelect`, `onDelete`, `onUpload`, `uploadStatus`, `onSetTags`, `readOnly`, `availableTags`.
- **Channels**: `tileType: 'channel'` and pass `channel` plus `onSelect`, `onSetTags`, `readOnly`, `availableTags` (no upload/delete on the strip unless you choose to add them later).

Internally, `DataTile` mirrors current `VideoCard` branching:

- `type === 'application/x-youtube'` → YouTube thumb from blob URL parse + red “YouTube” badge.
- Else → `BookIcon` + extension badge (unchanged).
- `tileType === 'channel'` → channel avatar row + “N videos” + chevron; **not** a full `<button>` wrapping tags (invalid HTML). Use a **wrapper `div`** with a **clickable top row** (`button` or `div` + `onClick`) and a **tag row** with `stopPropagation`, same pattern as `[VideoCard](components/VideoCard.js)` lines 159–211.

Move `**UploadButton`** into `DataTile.js` as a local helper (same as today) to avoid an extra file.

## IndexedDB / hook changes (`[hooks/useIndexedDB.js](hooks/useIndexedDB.js)`)

1. `**tags` on channels**
  - `addChannel`: merge `tags: Array.isArray(record.tags) ? record.tags : []` (or `normalizeTagsList` if you prefer strictness).
  - `loadChannels`: normalize each row: `tags: Array.isArray(r.tags) ? r.tags : []`.
  - `upsertDriveChannel`: when merging with `existing`, preserve `tags: existing.tags` if API payload does not include tags.
2. `**setRecordTags`**
  - After successful `put`, if `storeName === 'channels'` call `**loadChannels()`**; otherwise keep current behavior (`loadItems()` for non-`images` stores). Today channels never refresh after tag writes.

## Library (`[components/Library.js](components/Library.js)`)

- Replace imports/usages of `VideoCard` / `ChannelCard` with `DataTile`.
- **Tag union for `availableTags`**: extend the `useEffect` that builds `availableTags` to also scan `channels` for `tags` (not only `items`), so channel tags appear in suggestions and Tag sharing flows stay consistent.
- Channel strip: pass `onSetTags` in owner mode, e.g. `(ch, tags) => setRecordTags(ch.id, 'channels', tags)` (mirror item line ~772). Shared mode: `readOnly` / omit `onSetTags` like items.

## YoutubeChannelViewer (`[components/YoutubeChannelViewer.js](components/YoutubeChannelViewer.js)`)

- Swap `VideoCard` → `DataTile` with `tileType: 'item'` and the same synthetic `item` objects from `videoToLibraryItem` (no tag editing there unless you add real DB ids; current code passes no `onSetTags` — behavior unchanged).

## Docs (touch only what references old components)

- Update `[documents/data-stores.md](documents/data-stores.md)` channel schema with `tags: string[]` and replace `ChannelCard` reference with `DataTile`.
- Update `[documents/components.md](documents/components.md)`, `[documents/architecture.md](documents/architecture.md)`, and `[CLAUDE.md](CLAUDE.md)` where `VideoCard` / `ChannelCard` are listed.

## Files to delete

- `[components/VideoCard.js](components/VideoCard.js)`
- `[components/ChannelCard.js](components/ChannelCard.js)`

## Risk / UX note

Channel strip tiles will grow vertically once tags are shown; keep tag styling identical to grid tiles (compact `[10px]` controls). If the strip feels cramped, optional follow-up: `max-h` + scroll on tag row or slightly wider `min-w` on each channel tile — only if needed after visual check.
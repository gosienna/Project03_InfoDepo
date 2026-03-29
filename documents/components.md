# Web App Structure & React Components

## Startup Sequence

### 1. Browser loads `index.html`

```
index.html
├── <script> Tailwind CSS (CDN)
├── <script> JSZip (CDN)
├── <script> EPUB.js (CDN)
├── <script> Google Identity Services — gsi/client (CDN, async)
├── <script> Google API — api.js (CDN, async)
├── <script type="importmap"> — maps React bare imports to esm.sh CDN URLs
└── <script type="module" src="./index.js"> — app entry point
```

CDN libraries load in parallel. React is resolved via the importmap — no bundling step.

### 2. `index.js` — React mount

```js
const root = ReactDOM.createRoot(document.getElementById('root'));
root.render(
  React.StrictMode
    └── App
);
```

`React.StrictMode` causes effects to run twice in development (intentional React behaviour for catching side effects).

### 3. `App.js` — first render

On mount, two things happen in parallel:

```
App mounts
├── useIndexedDB() hook initialises
│     └── indexedDB.open('InfoDepo', 1)
│           ├── onupgradeneeded → creates 'books' object store (first run only)
│           └── onsuccess → db instance ready → loadBooks() → setIsInitialized(true)
└── React renders loading spinner (isInitialized = false)
```

Once `isInitialized` becomes `true`, the spinner is replaced with the Library view.

### 4. Loading states

```
isInitialized = false  →  "Initializing Database..." spinner (full screen)
isInitialized = true   →  Library view rendered
```

---

## Page Structure

### Main App (`index.html` + React)

```
<body>
  <div id="root">                        ← React mounts here
    <App>
      <Header />                         ← always visible
      <main>
        <Library />                      ← view = 'library'
        OR
        <Reader />                       ← view = 'reader' (PDF / TXT)
      </main>
    </App>
  </div>
```

### EPUB Reader (`reader.html`)

Standalone page, no React. Opens in a new browser tab.

```
<body>
  <header>                               ← book title, page counter, close button
  <div id="viewer">                      ← EPUB.js renders here (full page height)
  <div id="loading">                     ← overlay, hidden after render
  <footer>                               ← Prev / Next buttons
```

---

## Component Reference

### `App.js`
**Role:** Root component. Owns view state and book selection routing.

**State:**
| State | Type | Purpose |
|-------|------|---------|
| `view` | `'library' \| 'reader'` | Which view is shown |
| `currentBook` | `object \| null` | Book being read (PDF/TXT only) |

**Key logic:**
- `handleSelectBook(book)` — if EPUB, calls `window.open('/reader.html?id=X', '_blank')` and returns. PDF/TXT sets `currentBook` and switches to reader view.
- Delegates all IndexedDB operations to `useIndexedDB` hook.

---

### `Header.js`
**Role:** Top navigation bar.

**Props:**
| Prop | Type | Purpose |
|------|------|---------|
| `onBack` | `function \| undefined` | If provided, shows back arrow (reader view only) |

**Renders:** App logo + title. Back button appears only when reading PDF/TXT.

---

### `Library.js`
**Role:** Book grid, file import, dev Drive browser.

**Props:**
| Prop | Type | Purpose |
|------|------|---------|
| `books` | `array` | List of books from IndexedDB |
| `onSelectBook` | `function` | Called when a book card is clicked |
| `onAddBook` | `function` | Saves a new book to IndexedDB |
| `onDeleteBook` | `function` | Deletes a book by ID |
| `onClearLibrary` | `function` | Clears all books |

**State:**
| State | Purpose |
|-------|---------|
| `isDevBrowserOpen` | Toggles `DevDriveBrowser` modal |

**File upload flow:**
```
"Add Book" clicked
  → hidden <input type="file"> triggered via ref
  → user selects file
  → handleFileChange(e)
  → onAddBook(file.name, file.type, file)   ← File extends Blob, stored directly
  → input value reset (allows re-selecting same file)
```

**Empty state:** When `books.length === 0`, shows a centred placeholder with an "Add Your First Book" button.

**Dev mode:** `import.meta.env.DEV` renders the yellow "DEV: Test Folder" button. Stripped in production.

---

### `BookCard.js`
**Role:** Single book item in the grid.

**Props:**
| Prop | Type | Purpose |
|------|------|---------|
| `book` | `object` | `{id, name, type, data, size, added}` |
| `onSelect` | `function` | Opens the book |
| `onDelete` | `function` | Deletes the book |

**Renders:**
```
Card (clickable)
├── Cover area (gray bg, book icon, format badge top-right)
│   └── Delete button (bottom-right, visible on hover)
└── Info area
    ├── Book name (truncated)
    └── File size (formatted: KB / MB)
```

Format badge (`EPUB`, `PDF`, `TXT`) derived from filename extension.

---

### `Reader.js`
**Role:** Format dispatcher for PDF and TXT. EPUB is handled separately via `reader.html`.

**Props:**
| Prop | Type | Purpose |
|------|------|---------|
| `book` | `object` | Full book record from IndexedDB |

**Routing logic:**
```js
ext = getFileExtension(book.name)
   || MIME_TO_EXT[book.type]   // fallback for Drive files without extension

switch(ext):
  'pdf'  → PdfViewer
  'txt'  → TxtViewer
  else   → UnsupportedViewer
```

---

### `PdfViewer.js`
**Role:** Renders a PDF Blob in an iframe.

**Props:** `data` (Blob)

**How it works:**
```js
objectUrl = URL.createObjectURL(data)  // memoized
<iframe src={objectUrl} />             // browser's built-in PDF renderer
```

`useMemo` ensures the object URL is only created once per book, not on every render.

---

### `TxtViewer.js`
**Role:** Reads and displays plain text.

**Props:** `data` (Blob)

**State:** `text` (string), `isLoading` (bool)

**How it works:**
```js
FileReader.readAsText(data)
  onload → setText(result) → setIsLoading(false)
```

Displays text in a `<pre>` tag with `whitespace-pre-wrap` to preserve formatting.

---

### `DevDriveBrowser.js` *(dev only)*
**Role:** Modal overlay — OAuth login + file list from Google Drive folder.

**Props:**
| Prop | Type | Purpose |
|------|------|---------|
| `onFileSelect` | `function` | Called with `(name, mimeType, blob)` on import |
| `onClose` | `function` | Closes the modal |

**Credentials:** Read from `import.meta.env.VITE_TEST_*` — never from user input or `localStorage`.

**Flow:** See [google-drive-integration.md](google-drive-integration.md).

---

### `EpubViewer.js` *(legacy, not used for routing)*
**Role:** Inline EPUB renderer. Kept in codebase but EPUB routing now goes to `reader.html`.

---

## `useIndexedDB` Hook

Located at `hooks/useIndexedDB.js`. Encapsulates all database logic.

**Database:** `InfoDepo` (version 1)
**Object store:** `books`
**Schema:** `{ id (auto), name, type, data (Blob), size, added (Date) }`
**Sort order:** Newest first (`added` timestamp descending)

**Returned API:**
| | Type | Description |
|--|------|-------------|
| `books` | `array` | All books, sorted newest-first |
| `isInitialized` | `bool` | False until DB is open and books are loaded |
| `addBook(name, type, data)` | `async fn` | Adds a book, reloads list |
| `deleteBook(id)` | `fn` | Deletes by ID, reloads list |
| `clearBooks()` | `fn` | Removes all books |

---

## State Flow Diagram

```
Browser opens app
       │
       ▼
  index.html loads CDNs + importmap
       │
       ▼
  index.js → ReactDOM.createRoot → renders App
       │
       ▼
  App mounts → useIndexedDB initialises IndexedDB
       │
  isInitialized = false
       │  (DB opens, books loaded)
       ▼
  isInitialized = true → Library rendered
       │
  ┌────┴──────────────┐
  │                   │
User uploads file   User clicks book
  │                   │
  ▼                   ├── EPUB → window.open(reader.html?id=X)
addBook() →         │
IndexedDB write →   └── PDF/TXT → Reader.js → PdfViewer / TxtViewer
loadBooks() →
books state updates →
BookCard re-renders
```

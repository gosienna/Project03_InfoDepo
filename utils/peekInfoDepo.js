import { INFO_DEPO_DB_NAME, INFO_DEPO_DB_VERSION } from './infodepoDb.js';

/** Read-only row counts + short row previews (helps when DevTools table UI looks empty). */
export function peekInfoDepo() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(INFO_DEPO_DB_NAME, INFO_DEPO_DB_VERSION);
    req.onerror = () => reject(req.error);
    req.onsuccess = () => {
      const db = req.result;
      const meta = { origin: location.origin, name: db.name, version: db.version };
      const names = [...db.objectStoreNames];
      if (names.length === 0) {
        db.close();
        resolve({ ...meta, counts: {}, preview: {} });
        return;
      }
      const counts = {};
      const preview = {};
      let pending = names.length;
      const done = () => {
        pending--;
        if (pending === 0) {
          db.close();
          resolve({ ...meta, counts, preview });
        }
      };
      names.forEach((storeName) => {
        const tx = db.transaction(storeName, 'readonly');
        const q = tx.objectStore(storeName).getAll();
        q.onsuccess = () => {
          const rows = q.result;
          counts[storeName] = rows.length;
          preview[storeName] = rows.slice(0, 10).map((r) => ({
            id: r.id,
            name: r.name,
            type: r.type,
            bytes: r.data != null && typeof r.data.size === 'number' ? r.data.size : null,
          }));
          done();
        };
        q.onerror = () => reject(q.error);
      });
    };
  });
}

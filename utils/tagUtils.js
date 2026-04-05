/** Normalize a tag string for storage and manifest keys. */
export function normalizeTag(raw) {
  if (raw == null || typeof raw !== 'string') return '';
  return raw.trim().toLowerCase().replace(/\s+/g, '_');
}

/** Deduplicate normalized tags. */
export function normalizeTagsList(tags) {
  const out = [];
  const seen = new Set();
  for (const t of tags || []) {
    const n = normalizeTag(t);
    if (!n || seen.has(n)) continue;
    seen.add(n);
    out.push(n);
  }
  return out;
}

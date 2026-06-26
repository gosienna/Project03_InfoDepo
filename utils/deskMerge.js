/**
 * 3-way merge for desk records. Pure functions — no I/O.
 *
 * Tie-break policy: local wins on position and scalar fields; additive
 * structure (connections, textItems) preserves both sides' changes.
 */

function jsonEq(a, b) {
  return JSON.stringify(a) === JSON.stringify(b);
}

/**
 * Merge layout objects (keyed by `drive:{id}` → { x, y, ... }).
 * @param {object} base   - Last-synced snapshot (common ancestor)
 * @param {object} local  - Current local state
 * @param {object} remote - Remote state from Drive
 */
export function mergeLayout(base = {}, local = {}, remote = {}) {
  const keys = new Set([...Object.keys(base), ...Object.keys(local), ...Object.keys(remote)]);
  const out = {};
  for (const k of keys) {
    const b = base[k], l = local[k], r = remote[k];
    const lChanged = !jsonEq(l, b);
    const rChanged = !jsonEq(r, b);
    if (l === undefined && lChanged && !rChanged) continue; // local deleted, remote untouched
    if (r === undefined && rChanged && !lChanged) continue; // remote deleted, local untouched
    if (lChanged && !rChanged) { if (l !== undefined) out[k] = l; }
    else if (rChanged && !lChanged) { if (r !== undefined) out[k] = r; }
    else if (lChanged && rChanged) { if (l !== undefined) out[k] = l; else if (r !== undefined) out[k] = r; } // local wins tie
    else if (l !== undefined) out[k] = l;
    else if (r !== undefined) out[k] = r;
  }
  return out;
}

/**
 * Merge arrays of objects that each have a stable `id` field.
 * @param {Array} base   - Last-synced snapshot
 * @param {Array} local  - Current local array
 * @param {Array} remote - Remote array from Drive
 */
export function mergeById(base = [], local = [], remote = []) {
  const byId = (arr) => new Map(arr.map((x) => [x.id, x]));
  const [B, L, R] = [byId(base), byId(local), byId(remote)];
  const ids = new Set([...B.keys(), ...L.keys(), ...R.keys()]);
  const out = [];
  for (const id of ids) {
    const b = B.get(id), l = L.get(id), r = R.get(id);
    const lChanged = !jsonEq(l, b);
    const rChanged = !jsonEq(r, b);
    if (l === undefined && lChanged && !rChanged) continue; // local deleted
    if (r === undefined && rChanged && !lChanged) continue; // remote deleted
    if (lChanged && !rChanged) { if (l) out.push(l); }
    else if (rChanged && !lChanged) { if (r) out.push(r); }
    else if (lChanged && rChanged) { out.push(l ?? r); } // local wins tie
    else if (l ?? r) out.push(l ?? r);
  }
  return out;
}

/**
 * Merge two desk records using `base` as the common ancestor.
 * When `base` is undefined (legacy record, first sync), all fields are
 * treated as changed on both sides — local wins everywhere, which matches
 * the previous last-writer-wins behaviour for that one cycle.
 */
export function mergeDesk(base, local, remote) {
  return {
    ...remote,
    ...local,
    layout:      mergeLayout(base?.layout,      local?.layout,      remote?.layout),
    connections: mergeById(base?.connections,   local?.connections, remote?.connections),
    textItems:   mergeById(base?.textItems,     local?.textItems,   remote?.textItems),
    rev: Math.max(local?.rev || 0, remote?.rev || 0) + 1,
  };
}

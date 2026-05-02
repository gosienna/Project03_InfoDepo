
import React, { useState, useEffect, useRef, useCallback, useMemo } from 'react';
import { DataTile } from './DataTile.js';
import { DeskTile } from './DeskTile.js';
import { AddContentDropdown } from './AddContentDropdown.js';
import { normalizeTag } from '../utils/tagUtils.js';

const CARD_W = 250;
const DRAG_BAR_H = 26;
const DEFAULT_ZOOM_MIN = 0.1;
const DEFAULT_ZOOM_MAX = 5;
const GRID_SIZE = 40;
const CARD_H = 220;

const snapToGrid = (v) => Math.round(v / GRID_SIZE) * GRID_SIZE;
const snapPoint = (p) => ({ x: snapToGrid(p.x), y: snapToGrid(p.y) });
const connectionId = () => `conn-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
const fullWidthCharRe = /[\u1100-\u115F\u2E80-\uA4CF\u3400-\u4DBF\u4E00-\u9FFF\uAC00-\uD7A3\uF900-\uFAFF\uFE10-\uFE19\uFE30-\uFE6F\uFF00-\uFF60\uFFE0-\uFFE6]/;
const measureLineUnits = (line) => {
  let units = 0;
  for (const ch of String(line || '')) units += fullWidthCharRe.test(ch) ? 1 : 0.58;
  return units;
};
const estimateTextBounds = (item) => {
  const fontSize = item?.fontSize || 16;
  const text = String(item?.text || '');
  const lines = text.split('\n');
  const widestUnits = lines.reduce((m, line) => Math.max(m, measureLineUnits(line)), 0);
  const estimatedWidth = Math.max(40, widestUnits * fontSize + 16);
  const estimatedHeight = Math.max(fontSize + 8, lines.length * fontSize * 1.4 + 8);
  const width = Math.max(40, Number(item?.width) || estimatedWidth);
  const height = Math.max(fontSize + 8, Number(item?.height) || estimatedHeight);
  return {
    left: item.x,
    right: item.x + width,
    top: item.y,
    bottom: item.y + height,
  };
};

// --- Key helpers ---

export const itemEntryKey = (item) => `${item.idbStore}:${item.id}`;
export const channelEntryKey = (ch) => `channel:${ch.id}`;
export const deskEntryKey = (d) => `desk:${d.id}`;

function resolveEntry(key, items, channels, desks) {
  if (key.startsWith('channel:')) {
    const id = Number(key.slice(8));
    const ch = channels.find((c) => c.id === id);
    return ch ? { ...ch, _entryType: 'channel' } : null;
  }
  if (key.startsWith('desk:')) {
    const id = Number(key.slice(5));
    const d = (desks || []).find((x) => x.id === id);
    return d ? { ...d, _entryType: 'desk' } : null;
  }
  const sep = key.lastIndexOf(':');
  const store = key.slice(0, sep);
  const id = Number(key.slice(sep + 1));
  const item = items.find((i) => i.idbStore === store && i.id === id);
  return item ? { ...item, _entryType: 'item' } : null;
}

const cardBoxFor = (pos) => ({
  left: pos.x,
  right: pos.x + CARD_W,
  top: pos.y,
  bottom: pos.y + CARD_H,
  cx: pos.x + CARD_W / 2,
  cy: pos.y + CARD_H / 2,
});

const edgeAnchors = (box) => ([
  { edge: 'left', x: box.left, y: box.cy },
  { edge: 'right', x: box.right, y: box.cy },
  { edge: 'top', x: box.cx, y: box.top },
  { edge: 'bottom', x: box.cx, y: box.bottom },
]);

const autoRoute = (from, to) => {
  const f = snapPoint(from);
  const t = snapPoint(to);
  const mx = snapToGrid((f.x + t.x) / 2);
  return [f, { x: mx, y: f.y }, { x: mx, y: t.y }, t];
};

const closestAnchors = (fromPos, toPos) => {
  const fromBox = cardBoxFor(fromPos);
  const toBox = cardBoxFor(toPos);
  const a = edgeAnchors(fromBox);
  const b = edgeAnchors(toBox);
  const dx = toBox.cx - fromBox.cx;
  const dy = toBox.cy - fromBox.cy;
  const horizontal = Math.abs(dx) >= Math.abs(dy);
  const preferredFrom = horizontal ? (dx >= 0 ? 'right' : 'left') : (dy >= 0 ? 'bottom' : 'top');
  const preferredTo = horizontal ? (dx >= 0 ? 'left' : 'right') : (dy >= 0 ? 'top' : 'bottom');
  let best = null;
  for (const p1 of a) {
    for (const p2 of b) {
      const d = Math.abs(p2.x - p1.x) + Math.abs(p2.y - p1.y);
      const penalty = (p1.edge === preferredFrom ? 0 : GRID_SIZE * 4) + (p2.edge === preferredTo ? 0 : GRID_SIZE * 4);
      const score = d + penalty;
      if (!best || score < best.score) best = { score, from: p1, to: p2 };
    }
  }
  return best ? { from: best.from, to: best.to } : null;
};

const pointsToPath = (points) => {
  if (!points || points.length < 2) return '';
  return `M ${points[0].x} ${points[0].y} ${points.slice(1).map((p) => `L ${p.x} ${p.y}`).join(' ')}`;
};

const connectionPointsFor = (conn, layout) => {
  const fromPos = layout?.[conn.fromKey];
  const toPos = layout?.[conn.toKey];
  if (!fromPos || !toPos) return null;
  const anchors = closestAnchors(fromPos, toPos);
  if (!anchors) return null;
  const start = snapPoint(anchors.from);
  const end = snapPoint(anchors.to);
  if (conn.route?.mode === 'manual') {
    const mids = Array.isArray(conn.route.points) ? conn.route.points.map(snapPoint) : [];
    return [start, ...mids, end];
  }
  return autoRoute(start, end);
};

// --- Dot grid background ---

const DotGrid = ({ panX, panY, zoom }) => {
  const scaled = GRID_SIZE * zoom;
  const ox = ((panX % scaled) + scaled) % scaled;
  const oy = ((panY % scaled) + scaled) % scaled;
  return React.createElement(
    'svg',
    { style: { position: 'absolute', inset: 0, width: '100%', height: '100%', pointerEvents: 'none' } },
    React.createElement(
      'defs', null,
      React.createElement('pattern', {
        id: 'desk-dot-grid', x: ox, y: oy, width: scaled, height: scaled, patternUnits: 'userSpaceOnUse',
      }, React.createElement('circle', { cx: 0, cy: 0, r: 1.2, fill: '#374151' }))
    ),
    React.createElement('rect', { width: '100%', height: '100%', fill: 'url(#desk-dot-grid)' })
  );
};

// --- Desk selector dropdown ---

const DeskSelector = ({ desks, currentDeskId, onSelect, onRename }) => {
  const [open, setOpen] = useState(false);
  const [editingId, setEditingId] = useState(null);
  const [editValue, setEditValue] = useState('');
  const editingRef = useRef(false);
  const current = desks.find((d) => d.id === currentDeskId);

  const startEdit = (e, d) => {
    e.preventDefault();
    e.stopPropagation();
    editingRef.current = true;
    setEditingId(d.id);
    setEditValue(d.name || '');
  };

  const commitEdit = (id) => {
    const trimmed = editValue.trim();
    if (trimmed && onRename) onRename(id, trimmed);
    editingRef.current = false;
    setEditingId(null);
  };

  const cancelEdit = () => {
    editingRef.current = false;
    setEditingId(null);
  };

  return React.createElement(
    'div',
    { style: { position: 'relative' }, onClick: (e) => e.stopPropagation() },
    React.createElement(
      'button',
      {
        onClick: () => setOpen((v) => !v),
        onBlur: () => setTimeout(() => { if (!editingRef.current) setOpen(false); }, 150),
        style: {
          background: 'none', border: 'none', borderRadius: 10,
          padding: '4px 10px', fontSize: 20, fontWeight: 700, color: '#e5e7eb',
          cursor: desks.length > 1 ? 'pointer' : 'default',
          display: 'flex', alignItems: 'center', gap: 8,
          letterSpacing: '-0.02em',
        },
      },
      React.createElement('span', { style: { overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' } }, current?.name || 'Desk'),
      desks.length > 1 && React.createElement(
        'svg',
        { xmlns: 'http://www.w3.org/2000/svg', width: 14, height: 14, fill: 'none', viewBox: '0 0 24 24', stroke: '#6b7280', strokeWidth: 2.5, style: { flexShrink: 0 } },
        React.createElement('path', { strokeLinecap: 'round', strokeLinejoin: 'round', d: 'M19 9l-7 7-7-7' })
      )
    ),
    open && desks.length > 1 && React.createElement(
      'div',
      {
        style: {
          position: 'absolute', top: 'calc(100% + 4px)', left: '50%', transform: 'translateX(-50%)',
          background: '#1f2937', border: '1px solid #374151', borderRadius: 10,
          boxShadow: '0 8px 24px rgba(0,0,0,0.4)', zIndex: 50,
          minWidth: 220, maxHeight: 300, overflowY: 'auto',
        },
      },
      desks.map((d) =>
        React.createElement(
          'div',
          {
            key: d.id,
            style: {
              display: 'flex', alignItems: 'center', gap: 6,
              background: d.id === currentDeskId ? '#374151' : 'none',
              borderBottom: '1px solid #111827',
              padding: editingId === d.id ? '4px 8px' : '0',
            },
          },
          editingId === d.id
            // Inline edit mode
            ? React.createElement(
                React.Fragment, null,
                React.createElement('input', {
                  autoFocus: true,
                  value: editValue,
                  onChange: (e) => setEditValue(e.target.value),
                  onKeyDown: (e) => {
                    if (e.key === 'Enter') { e.preventDefault(); commitEdit(d.id); }
                    if (e.key === 'Escape') { e.preventDefault(); cancelEdit(); }
                  },
                  onBlur: () => commitEdit(d.id),
                  style: {
                    flex: 1, background: '#111827', border: '1px solid #4f46e5',
                    borderRadius: 6, padding: '4px 8px', fontSize: 13, color: '#e5e7eb',
                    outline: 'none', minWidth: 0,
                  },
                }),
                React.createElement(
                  'button',
                  {
                    onMouseDown: (e) => { e.preventDefault(); commitEdit(d.id); },
                    style: { background: 'none', border: 'none', cursor: 'pointer', padding: '2px 4px', color: '#818cf8', flexShrink: 0 },
                    title: 'Save',
                  },
                  React.createElement(
                    'svg', { xmlns: 'http://www.w3.org/2000/svg', width: 13, height: 13, fill: 'none', viewBox: '0 0 24 24', stroke: 'currentColor', strokeWidth: 2.5 },
                    React.createElement('path', { strokeLinecap: 'round', strokeLinejoin: 'round', d: 'M5 13l4 4L19 7' })
                  )
                ),
                React.createElement(
                  'button',
                  {
                    onMouseDown: (e) => { e.preventDefault(); cancelEdit(); },
                    style: { background: 'none', border: 'none', cursor: 'pointer', padding: '2px 4px', color: '#6b7280', flexShrink: 0 },
                    title: 'Cancel',
                  },
                  React.createElement(
                    'svg', { xmlns: 'http://www.w3.org/2000/svg', width: 13, height: 13, fill: 'none', viewBox: '0 0 24 24', stroke: 'currentColor', strokeWidth: 2.5 },
                    React.createElement('path', { strokeLinecap: 'round', strokeLinejoin: 'round', d: 'M6 18L18 6M6 6l12 12' })
                  )
                )
              )
            // Normal row
            : React.createElement(
                React.Fragment, null,
                React.createElement(
                  'button',
                  {
                    onMouseDown: (e) => { e.preventDefault(); onSelect(d); setOpen(false); },
                    style: {
                      flex: 1, textAlign: 'left', padding: '8px 10px 8px 12px',
                      background: 'none', border: 'none',
                      color: d.id === currentDeskId ? '#a5b4fc' : '#e5e7eb',
                      fontSize: 13, cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 8,
                      minWidth: 0,
                    },
                    onMouseEnter: (e) => { if (d.id !== currentDeskId) e.currentTarget.closest('div').style.background = '#2d3748'; },
                    onMouseLeave: (e) => { if (d.id !== currentDeskId) e.currentTarget.closest('div').style.background = 'none'; },
                  },
                  d.id === currentDeskId && React.createElement('span', { style: { color: '#818cf8', fontSize: 8, lineHeight: 1, flexShrink: 0 } }, '●'),
                  React.createElement('span', { style: { overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' } }, d.name || 'Untitled Desk')
                ),
                onRename && React.createElement(
                  'button',
                  {
                    onMouseDown: (e) => startEdit(e, d),
                    style: {
                      background: 'none', border: 'none', cursor: 'pointer',
                      padding: '8px 10px', color: '#4b5563', flexShrink: 0,
                    },
                    title: 'Rename desk',
                    onMouseEnter: (e) => { e.currentTarget.style.color = '#9ca3af'; },
                    onMouseLeave: (e) => { e.currentTarget.style.color = '#4b5563'; },
                  },
                  React.createElement(
                    'svg', { xmlns: 'http://www.w3.org/2000/svg', width: 12, height: 12, fill: 'none', viewBox: '0 0 24 24', stroke: 'currentColor', strokeWidth: 2 },
                    React.createElement('path', { strokeLinecap: 'round', strokeLinejoin: 'round', d: 'M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z' })
                  )
                )
              )
        )
      )
    )
  );
};

// --- Inline search to add existing items to desk ---

const subColor = (sub) => {
  if (sub === 'channel') return 'bg-red-900/60 text-red-200';
  if (sub === 'desk') return 'bg-indigo-900/60 text-indigo-200';
  if (sub === 'notes') return 'bg-emerald-900/60 text-emerald-200';
  return 'bg-gray-700 text-gray-300';
};

const FILTER_TABS = [
  { key: 'all',     label: 'All' },
  { key: 'books',   label: 'Books' },
  { key: 'notes',   label: 'Notes' },
  { key: 'videos',  label: 'Videos' },
  { key: 'images',  label: 'Images' },
  { key: 'channel', label: 'Channels' },
  { key: 'desk',    label: 'Desks' },
];

const InlineAddSearch = ({ items, channels, desks, currentDeskId, currentLayout, onAdd }) => {
  const [query, setQuery] = useState('');
  const [open, setOpen] = useState(false);
  const [filter, setFilter] = useState('all');
  const [tagFilters, setTagFilters] = useState([]);
  const inputRef = useRef(null);

  const q = query.trim().toLowerCase();

  const allRows = useMemo(() => {
    const inLayout = new Set(Object.keys(currentLayout));
    const rows = [];
    for (const item of items) {
      const key = itemEntryKey(item);
      if (inLayout.has(key)) continue;
      const label = (item.name || '').replace(/\.youtube$/i, '');
      rows.push({ key, label, sub: item.idbStore, tags: item.tags || [] });
    }
    for (const ch of channels) {
      const key = channelEntryKey(ch);
      if (inLayout.has(key)) continue;
      rows.push({ key, label: ch.name || ch.handle || '', sub: 'channel', tags: ch.tags || [] });
    }
    for (const d of (desks || [])) {
      if (d.id === currentDeskId) continue;
      const key = deskEntryKey(d);
      if (inLayout.has(key)) continue;
      rows.push({ key, label: d.name || 'Untitled Desk', sub: 'desk', tags: d.tags || [] });
    }
    return rows;
  }, [items, channels, desks, currentDeskId, currentLayout]);

  // Tags matching the current query text (for suggestion pills)
  const matchingTags = useMemo(() => {
    if (!q) return [];
    const set = new Set();
    allRows.forEach((r) => r.tags.forEach((t) => { if (t.toLowerCase().includes(q)) set.add(t.toLowerCase()); }));
    return [...set].filter((t) => !tagFilters.includes(t)).sort().slice(0, 8);
  }, [allRows, q, tagFilters]);

  const activeSubs = useMemo(() => new Set(allRows.map((r) => r.sub)), [allRows]);

  const available = useMemo(() => {
    return allRows
      .filter((r) => filter === 'all' || r.sub === filter)
      .filter((r) => !q || r.label.toLowerCase().includes(q) || r.tags.some((t) => t.toLowerCase().includes(q)))
      .filter((r) => tagFilters.every((t) => r.tags.some((rt) => rt.toLowerCase() === t)))
      .slice(0, 12);
  }, [allRows, filter, q, tagFilters]);

  const visibleTabs = FILTER_TABS.filter((t) => t.key === 'all' || activeSubs.has(t.key));
  const showDropdown = open && allRows.length > 0;

  const addTagFilter = (tag) => {
    setTagFilters((prev) => prev.includes(tag) ? prev : [...prev, tag]);
    setQuery('');
    inputRef.current?.focus();
  };

  const removeTagFilter = (tag) => {
    setTagFilters((prev) => prev.filter((t) => t !== tag));
    inputRef.current?.focus();
  };

  return React.createElement(
    'div',
    { style: { position: 'relative' }, onClick: (e) => e.stopPropagation() },
    React.createElement(
      'div',
      { style: { position: 'relative' } },
      React.createElement('input', {
        ref: inputRef,
        type: 'text',
        value: query,
        placeholder: 'Search by name or tag…',
        onChange: (e) => { setQuery(e.target.value); setOpen(true); },
        onFocus: () => setOpen(true),
        onBlur: () => setTimeout(() => setOpen(false), 150),
        style: {
          background: '#1f2937', border: '1px solid #374151', borderRadius: 10,
          padding: '8px 32px 8px 12px', fontSize: 13, color: '#e5e7eb',
          outline: 'none', width: 210,
        },
      }),
      React.createElement(
        'svg',
        { xmlns: 'http://www.w3.org/2000/svg', width: 14, height: 14, fill: 'none', viewBox: '0 0 24 24', stroke: '#6b7280', strokeWidth: 2, style: { position: 'absolute', right: 10, top: '50%', transform: 'translateY(-50%)', pointerEvents: 'none' } },
        React.createElement('path', { strokeLinecap: 'round', strokeLinejoin: 'round', d: 'M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z' })
      )
    ),
    showDropdown && React.createElement(
      'div',
      {
        style: {
          position: 'absolute', top: 'calc(100% + 4px)', right: 0,
          background: '#1f2937', border: '1px solid #374151', borderRadius: 10,
          boxShadow: '0 8px 24px rgba(0,0,0,0.4)', zIndex: 50,
          width: 300,
        },
      },
      // Active tag filters
      tagFilters.length > 0 && React.createElement(
        'div',
        { style: { display: 'flex', flexWrap: 'wrap', gap: 4, padding: '8px 10px', borderBottom: '1px solid #111827' } },
        tagFilters.map((t) =>
          React.createElement(
            'button',
            {
              key: t,
              onMouseDown: (e) => { e.preventDefault(); removeTagFilter(t); },
              style: {
                display: 'flex', alignItems: 'center', gap: 3,
                padding: '2px 6px', borderRadius: 5, fontSize: 11, fontWeight: 600,
                background: '#312e81', color: '#a5b4fc', border: '1px solid #4338ca',
                cursor: 'pointer',
              },
              title: 'Remove tag filter',
            },
            t,
            React.createElement('span', { style: { fontSize: 10, opacity: 0.7 } }, ' ×')
          )
        )
      ),
      // Tag suggestions matching the current query
      matchingTags.length > 0 && React.createElement(
        'div',
        { style: { padding: '6px 10px', borderBottom: '1px solid #111827' } },
        React.createElement('p', { style: { fontSize: 10, color: '#6b7280', marginBottom: 4, textTransform: 'uppercase', letterSpacing: '0.05em' } }, 'Tags'),
        React.createElement(
          'div',
          { style: { display: 'flex', flexWrap: 'wrap', gap: 4 } },
          matchingTags.map((t) =>
            React.createElement(
              'button',
              {
                key: t,
                onMouseDown: (e) => { e.preventDefault(); addTagFilter(t); },
                style: {
                  padding: '2px 7px', borderRadius: 5, fontSize: 11, fontWeight: 600,
                  background: '#1e1b4b', color: '#818cf8', border: '1px solid #3730a3',
                  cursor: 'pointer',
                },
              },
              t
            )
          )
        )
      ),
      // Type filter tabs
      visibleTabs.length > 2 && React.createElement(
        'div',
        { style: { display: 'flex', gap: 4, padding: '8px 8px', flexWrap: 'wrap', borderBottom: '1px solid #111827' } },
        visibleTabs.map(({ key, label }) =>
          React.createElement(
            'button',
            {
              key,
              onMouseDown: (e) => { e.preventDefault(); setFilter(key); },
              style: {
                padding: '3px 8px', borderRadius: 6, fontSize: 11, fontWeight: 600,
                cursor: 'pointer', border: 'none',
                background: filter === key ? '#4f46e5' : '#374151',
                color: filter === key ? '#fff' : '#9ca3af',
              },
            },
            label
          )
        )
      ),
      // Results
      React.createElement(
        'div',
        { style: { maxHeight: 240, overflowY: 'auto' } },
        available.length === 0
          ? React.createElement('p', { style: { color: '#6b7280', fontSize: 13, textAlign: 'center', padding: '16px' } },
              tagFilters.length || q ? 'No matches.' : 'All items are on this desk.')
          : available.map(({ key, label, sub, tags }) =>
              React.createElement(
                'button',
                {
                  key,
                  onMouseDown: (e) => { e.preventDefault(); onAdd(key); setQuery(''); setTagFilters([]); setOpen(false); },
                  style: {
                    width: '100%', display: 'flex', alignItems: 'center', gap: 8,
                    padding: '8px 12px', background: 'none', border: 'none', cursor: 'pointer',
                    textAlign: 'left', color: '#d1d5db', fontSize: 13, borderBottom: '1px solid #111827',
                  },
                  onMouseEnter: (e) => { e.currentTarget.style.background = '#374151'; },
                  onMouseLeave: (e) => { e.currentTarget.style.background = 'none'; },
                },
                React.createElement('span', { className: `text-[10px] font-semibold px-1.5 py-0.5 rounded shrink-0 ${subColor(sub)}` }, sub),
                React.createElement('span', { style: { flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' } }, label),
                tags.length > 0 && React.createElement(
                  'span',
                  { style: { display: 'flex', gap: 3, flexShrink: 0 } },
                  tags.slice(0, 2).map((t) =>
                    React.createElement(
                      'span',
                      { key: t, style: { fontSize: 10, color: '#818cf8', background: '#1e1b4b', borderRadius: 4, padding: '1px 4px' } },
                      t
                    )
                  )
                )
              )
            )
      )
    )
  );
};

// --- Main Desk canvas ---

const TEXT_FONT_SIZES = [12, 14, 16, 20, 24, 32, 40, 48, 64];
const textItemId = () => `text-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

export const Desk = ({
  desk,
  items,
  channels,
  desks,
  onSelectItem,
  onSelectChannel,
  onSelectDesk,
  onUpdateLayout,
  onUpdateConnections,
  onUpdateTextItems,
  onRenameDesk,
  onSetTags,
  onSetSharedWith,
  canShareRecord,
  shareableEmails,
  onRenameItem,
  onRenameChannel,
  onSetNoteCoverImage,
  readOnly,
  role,
  onOpenNewNote,
  onOpenYoutube,
  onOpenChannel,
  onOpenFile,
  onOpenUrl,
}) => {
  const viewportRef = useRef(null);
  const historyRef = useRef({ past: [], future: [] });

  // Refs for real-time drag values (avoids stale closures in event handlers)
  const panRef = useRef({ x: 0, y: 0 });
  const zoomRef = useRef(1);
  const [renderTick, setRenderTick] = useState(0);
  const rerender = useCallback(() => setRenderTick((n) => n + 1), []);

  // Layout: layoutRef is the live truth during drag; state is committed on drag-end
  const layoutRef = useRef(desk?.layout || {});
  const connectionsRef = useRef(Array.isArray(desk?.connections) ? desk.connections : []);
  const cloneLayout = useCallback((layout) => {
    const src = layout || {};
    const out = {};
    Object.entries(src).forEach(([k, p]) => { out[k] = { x: p.x, y: p.y }; });
    return out;
  }, []);
  const cloneConnections = useCallback((connections) => {
    return (connections || []).map((c) => ({
      ...c,
      route: {
        mode: c?.route?.mode || 'auto',
        points: Array.isArray(c?.route?.points) ? c.route.points.map((p) => ({ x: p.x, y: p.y })) : [],
      },
    }));
  }, []);
  const snapshotState = useCallback(() => ({
    layout: cloneLayout(layoutRef.current),
    connections: cloneConnections(connectionsRef.current),
  }), [cloneConnections, cloneLayout]);
  useEffect(() => {
    // Reset undo/redo only when switching to a different desk.
    historyRef.current = { past: [], future: [] };
  }, [desk?.id]);

  // Text items on the canvas
  const textItemsRef = useRef(Array.isArray(desk?.textItems) ? desk.textItems : []);

  useEffect(() => {
    // Sync refs when desk data changes (e.g. after persistence round-trip).
    layoutRef.current = desk?.layout || {};
    connectionsRef.current = Array.isArray(desk?.connections) ? desk.connections : [];
    textItemsRef.current = Array.isArray(desk?.textItems) ? desk.textItems : [];
    rerender();
  }, [desk?.layout, desk?.connections, desk?.textItems]); // eslint-disable-line react-hooks/exhaustive-deps

  const commitLayout = useCallback((newLayout, options = {}) => {
    if (options.recordHistory !== false) {
      historyRef.current.past.push(snapshotState());
      historyRef.current.future = [];
    }
    layoutRef.current = newLayout;
    if (onUpdateLayout && desk?.id != null) onUpdateLayout(desk.id, newLayout);
    rerender();
  }, [onUpdateLayout, desk?.id, rerender, snapshotState]);

  const commitConnections = useCallback((next, options = {}) => {
    if (options.recordHistory !== false) {
      historyRef.current.past.push(snapshotState());
      historyRef.current.future = [];
    }
    connectionsRef.current = Array.isArray(next) ? next : [];
    if (onUpdateConnections && desk?.id != null) onUpdateConnections(desk.id, connectionsRef.current);
    rerender();
  }, [onUpdateConnections, desk?.id, rerender, snapshotState]);

  const commitTextItems = useCallback((next) => {
    textItemsRef.current = Array.isArray(next) ? next : [];
    if (onUpdateTextItems && desk?.id != null) onUpdateTextItems(desk.id, textItemsRef.current);
    rerender();
  }, [onUpdateTextItems, desk?.id, rerender]);

  const applyDeskState = useCallback((state) => {
    layoutRef.current = cloneLayout(state?.layout);
    connectionsRef.current = cloneConnections(state?.connections);
    if (desk?.id != null) {
      if (onUpdateLayout) onUpdateLayout(desk.id, layoutRef.current);
      if (onUpdateConnections) onUpdateConnections(desk.id, connectionsRef.current);
    }
    rerender();
  }, [cloneConnections, cloneLayout, desk?.id, onUpdateConnections, onUpdateLayout, rerender]);

  const undoDesk = useCallback(() => {
    const prev = historyRef.current.past.pop();
    if (!prev) return;
    historyRef.current.future.push(snapshotState());
    applyDeskState(prev);
  }, [applyDeskState, snapshotState]);

  const redoDesk = useCallback(() => {
    const next = historyRef.current.future.pop();
    if (!next) return;
    historyRef.current.past.push(snapshotState());
    applyDeskState(next);
  }, [applyDeskState, snapshotState]);


  // --- Pan ---
  const panningRef = useRef(null);
  const spaceRef = useRef(false);
  const [connectMode, setConnectMode] = useState(false);
  const [connectStartKey, setConnectStartKey] = useState(null);
  const [selectedItemKeys, setSelectedItemKeys] = useState([]);
  const [selectedTextIds, setSelectedTextIds] = useState([]);
  const [selectedConnectionIds, setSelectedConnectionIds] = useState([]);
  const [selectedNodeIds, setSelectedNodeIds] = useState([]);
  const selectedNodeIdsRef = useRef([]);
  const mouseRef = useRef({ x: 120, y: 120 });
  const [slashMenu, setSlashMenu] = useState({ open: false, x: 120, y: 120 });
  const [editingTextId, setEditingTextId] = useState(null);
  const [textFontSizeMenu, setTextFontSizeMenu] = useState(null);
  const lineDragRef = useRef(null);
  const activePointersRef = useRef(new Map());
  const pinchStartRef = useRef(null);
  useEffect(() => {
    selectedNodeIdsRef.current = selectedNodeIds;
  }, [selectedNodeIds]);

  const marqueeRef = useRef(null);
  const [marqueeBox, setMarqueeBox] = useState(null);

  useEffect(() => {
    const down = (e) => {
      if (e.code === 'Space' && e.target === document.body) { e.preventDefault(); spaceRef.current = true; rerender(); }
    };
    const up = (e) => { if (e.code === 'Space') { spaceRef.current = false; rerender(); } };
    window.addEventListener('keydown', down);
    window.addEventListener('keyup', up);
    return () => { window.removeEventListener('keydown', down); window.removeEventListener('keyup', up); };
  }, [rerender]);

  useEffect(() => {
    const onKeyDown = (e) => {
      if (readOnly) return;
      const t = e.target;
      const tag = t?.tagName?.toLowerCase?.() || '';
      if (tag === 'input' || tag === 'textarea' || t?.isContentEditable) return;
      const key = String(e.key || '').toLowerCase();
      const slashPressed = e.code === 'Slash' || key === '/' || key === '?';
      if (slashPressed && !e.ctrlKey && !e.metaKey && !e.altKey) {
        e.preventDefault();
        if (slashMenu.open || connectMode) {
          setSlashMenu((prev) => ({ ...prev, open: false }));
          setConnectMode(false);
          setConnectStartKey(null);
        } else {
          const rect = viewportRef.current?.getBoundingClientRect();
          if (!rect) return;
          const x = Math.max(12, Math.min(mouseRef.current.x, rect.width - 232));
          const y = Math.max(12, Math.min(mouseRef.current.y, rect.height - 160));
          setSlashMenu({ open: true, x, y });
          setConnectMode(true);
        }
        return;
      }
      if ((key === 'backspace' || key === 'delete') && (selectedConnectionIds.length > 0 || selectedItemKeys.length > 0 || selectedTextIds.length > 0)) {
        e.preventDefault();
        const selectedLineSet = new Set(selectedConnectionIds);
        const selectedItemSet = new Set(selectedItemKeys);
        const selectedTextSet = new Set(selectedTextIds);
        if (selectedItemSet.size > 0) {
          const nextLayout = { ...(layoutRef.current || {}) };
          selectedItemSet.forEach((k) => { delete nextLayout[k]; });
          commitLayout(nextLayout);
          const nextConnections = (connectionsRef.current || []).filter((c) =>
            !selectedLineSet.has(c.id) && !selectedItemSet.has(c.fromKey) && !selectedItemSet.has(c.toKey)
          );
          commitConnections(nextConnections, { recordHistory: false });
        } else {
          commitConnections((connectionsRef.current || []).filter((c) => !selectedLineSet.has(c.id)));
        }
        if (selectedTextSet.size > 0) {
          const nextTextItems = (textItemsRef.current || []).filter((t) => !selectedTextSet.has(t.id));
          commitTextItems(nextTextItems);
        }
        setSelectedConnectionIds([]);
        setSelectedItemKeys([]);
        setSelectedTextIds([]);
        setSelectedNodeIds([]);
        return;
      }
      const mod = e.ctrlKey || e.metaKey;
      if (!mod) return;
      if (key === 'z' && !e.shiftKey) {
        e.preventDefault();
        undoDesk();
        return;
      }
      if ((key === 'z' && e.shiftKey) || key === 'y') {
        e.preventDefault();
        redoDesk();
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [commitConnections, commitLayout, commitTextItems, connectMode, readOnly, redoDesk, selectedConnectionIds, selectedItemKeys, selectedTextIds, slashMenu.open, undoDesk]);

  const onViewportPointerDown = useCallback((e) => {
    activePointersRef.current.set(e.pointerId, { clientX: e.clientX, clientY: e.clientY });

    if (activePointersRef.current.size >= 2) {
      marqueeRef.current = null;
      setMarqueeBox(null);
      panningRef.current = null;
      const pts = [...activePointersRef.current.values()];
      const dx = pts[1].clientX - pts[0].clientX;
      const dy = pts[1].clientY - pts[0].clientY;
      const distance = Math.sqrt(dx * dx + dy * dy);
      const rect = viewportRef.current?.getBoundingClientRect();
      const midX = (pts[0].clientX + pts[1].clientX) / 2 - (rect?.left || 0);
      const midY = (pts[0].clientY + pts[1].clientY) / 2 - (rect?.top || 0);
      pinchStartRef.current = { distance, midX, midY, originPanX: panRef.current.x, originPanY: panRef.current.y, originZoom: zoomRef.current };
      viewportRef.current?.setPointerCapture(e.pointerId);
      return;
    }

    if (e.pointerType === 'touch' && e.target === e.currentTarget) {
      panningRef.current = { startX: e.clientX, startY: e.clientY, originX: panRef.current.x, originY: panRef.current.y };
      viewportRef.current?.setPointerCapture(e.pointerId);
      return;
    }

    if (e.target === e.currentTarget && e.button === 0 && !spaceRef.current) {
      const rect = viewportRef.current?.getBoundingClientRect();
      const startX = e.clientX - (rect?.left || 0);
      const startY = e.clientY - (rect?.top || 0);
      marqueeRef.current = { startX, startY, currentX: startX, currentY: startY, moved: false };
      setMarqueeBox({ x: startX, y: startY, w: 0, h: 0 });
      setSelectedConnectionIds([]);
      setSelectedItemKeys([]);
      setSelectedTextIds([]);
      setSelectedNodeIds([]);
      setSlashMenu((prev) => prev.open ? { ...prev, open: false } : prev);
      setConnectMode(false);
      setConnectStartKey(null);
    }
    if (e.button === 1 || (e.button === 0 && spaceRef.current)) {
      e.preventDefault();
      panningRef.current = { startX: e.clientX, startY: e.clientY, originX: panRef.current.x, originY: panRef.current.y };
      viewportRef.current?.setPointerCapture(e.pointerId);
    }
  }, []);

  const onViewportPointerMove = useCallback((e) => {
    if (activePointersRef.current.has(e.pointerId)) {
      activePointersRef.current.set(e.pointerId, { clientX: e.clientX, clientY: e.clientY });
    }

    if (pinchStartRef.current && activePointersRef.current.size >= 2) {
      const pts = [...activePointersRef.current.values()];
      const dx = pts[1].clientX - pts[0].clientX;
      const dy = pts[1].clientY - pts[0].clientY;
      const newDistance = Math.sqrt(dx * dx + dy * dy);
      const { distance, midX, midY, originPanX, originPanY, originZoom } = pinchStartRef.current;
      const scale = newDistance / distance;
      const newZoom = Math.max(DEFAULT_ZOOM_MIN, Math.min(DEFAULT_ZOOM_MAX, originZoom * scale));
      panRef.current = {
        x: midX - (midX - originPanX) * (newZoom / originZoom),
        y: midY - (midY - originPanY) * (newZoom / originZoom),
      };
      zoomRef.current = newZoom;
      rerender();
      return;
    }

    if (viewportRef.current) {
      const rect = viewportRef.current.getBoundingClientRect();
      const localX = e.clientX - rect.left;
      const localY = e.clientY - rect.top;
      mouseRef.current = { x: localX, y: localY };
      if (marqueeRef.current) {
        marqueeRef.current.currentX = localX;
        marqueeRef.current.currentY = localY;
        marqueeRef.current.moved = true;
        const x = Math.min(marqueeRef.current.startX, localX);
        const y = Math.min(marqueeRef.current.startY, localY);
        const w = Math.abs(localX - marqueeRef.current.startX);
        const h = Math.abs(localY - marqueeRef.current.startY);
        setMarqueeBox({ x, y, w, h });
      }
    }
    if (!panningRef.current) return;
    panRef.current = {
      x: panningRef.current.originX + (e.clientX - panningRef.current.startX),
      y: panningRef.current.originY + (e.clientY - panningRef.current.startY),
    };
    rerender();
  }, [rerender]);

  const onViewportPointerUp = useCallback((e) => {
    activePointersRef.current.delete(e.pointerId);
    if (activePointersRef.current.size < 2) pinchStartRef.current = null;
    const pan = panningRef.current;
    panningRef.current = null;
    if (e.pointerType === 'touch' && pan && !marqueeRef.current) {
      const dx = Math.abs(e.clientX - pan.startX);
      const dy = Math.abs(e.clientY - pan.startY);
      if (dx < 8 && dy < 8) {
        setSelectedConnectionIds([]);
        setSelectedItemKeys([]);
        setSelectedTextIds([]);
        setSelectedNodeIds([]);
      }
    }
    if (!marqueeRef.current || !viewportRef.current) return;
    const m = marqueeRef.current;
    marqueeRef.current = null;
    const rect = viewportRef.current.getBoundingClientRect();
    const x1 = Math.min(m.startX, m.currentX);
    const y1 = Math.min(m.startY, m.currentY);
    const x2 = Math.max(m.startX, m.currentX);
    const y2 = Math.max(m.startY, m.currentY);
    setMarqueeBox(null);
    if (!m.moved || (x2 - x1 < 4 && y2 - y1 < 4)) return;
    const worldA = { x: (x1 - panRef.current.x) / zoomRef.current, y: (y1 - panRef.current.y) / zoomRef.current };
    const worldB = { x: (x2 - panRef.current.x) / zoomRef.current, y: (y2 - panRef.current.y) / zoomRef.current };
    const sx = Math.min(worldA.x, worldB.x);
    const sy = Math.min(worldA.y, worldB.y);
    const ex = Math.max(worldA.x, worldB.x);
    const ey = Math.max(worldA.y, worldB.y);

    const itemKeys = Object.entries(layoutRef.current || {})
      .filter(([, pos]) => {
        const bx1 = pos.x;
        const by1 = pos.y;
        const bx2 = pos.x + CARD_W;
        const by2 = pos.y + CARD_H;
        return bx1 <= ex && bx2 >= sx && by1 <= ey && by2 >= sy;
      })
      .map(([key]) => key);
    setSelectedItemKeys(itemKeys);
    const textIds = (textItemsRef.current || [])
      .filter((item) => {
        const b = estimateTextBounds(item);
        return b.left <= ex && b.right >= sx && b.top <= ey && b.bottom >= sy;
      })
      .map((item) => item.id);
    setSelectedTextIds(textIds);

    const connIds = (connectionsRef.current || [])
      .map((conn) => ({ conn, points: connectionPointsFor(conn, layoutRef.current || {}) }))
      .filter((row) => row.points && row.points.length >= 2)
      .filter(({ points }) => {
        const xs = points.map((p) => p.x);
        const ys = points.map((p) => p.y);
        const bx1 = Math.min(...xs);
        const by1 = Math.min(...ys);
        const bx2 = Math.max(...xs);
        const by2 = Math.max(...ys);
        return bx1 <= ex && bx2 >= sx && by1 <= ey && by2 >= sy;
      })
      .map(({ conn }) => conn.id);
    setSelectedConnectionIds(connIds);
    const nodeIds = [];
    (connectionsRef.current || []).forEach((conn) => {
      const pts = connectionPointsFor(conn, layoutRef.current || {});
      if (!pts || pts.length < 3) return;
      const mids = conn.route?.mode === 'manual'
        ? (Array.isArray(conn.route?.points) ? conn.route.points : [])
        : pts.slice(1, -1);
      mids.forEach((p, idx) => {
        if (p.x >= sx && p.x <= ex && p.y >= sy && p.y <= ey) {
          nodeIds.push(`${conn.id}:${idx}`);
        }
      });
    });
    setSelectedNodeIds(nodeIds);
  }, []);

  // --- Zoom ---
  const onWheel = useCallback((e) => {
    e.preventDefault();
    const factor = e.deltaY < 0 ? 1.1 : 0.9;
    const oldZoom = zoomRef.current;
    const newZoom = Math.max(DEFAULT_ZOOM_MIN, Math.min(DEFAULT_ZOOM_MAX, oldZoom * factor));
    const rect = viewportRef.current.getBoundingClientRect();
    const cx = e.clientX - rect.left;
    const cy = e.clientY - rect.top;
    panRef.current = {
      x: cx - (cx - panRef.current.x) * (newZoom / oldZoom),
      y: cy - (cy - panRef.current.y) * (newZoom / oldZoom),
    };
    zoomRef.current = newZoom;
    rerender();
  }, [rerender]);

  useEffect(() => {
    const el = viewportRef.current;
    if (!el) return;
    el.addEventListener('wheel', onWheel, { passive: false });
    return () => el.removeEventListener('wheel', onWheel);
  }, [onWheel]);

  // --- Item drag ---
  const itemDragRef = useRef(null);
  const pointerToWorld = useCallback((e) => {
    const rect = viewportRef.current?.getBoundingClientRect();
    const localX = e.clientX - (rect?.left || 0);
    const localY = e.clientY - (rect?.top || 0);
    return {
      x: (localX - panRef.current.x) / zoomRef.current,
      y: (localY - panRef.current.y) / zoomRef.current,
    };
  }, []);

  const onHandlePointerDown = useCallback((e, key) => {
    e.stopPropagation();
    const world = pointerToWorld(e);
    const selected = selectedItemKeys.includes(key) ? selectedItemKeys : [key];
    const startPositions = {};
    selected.forEach((k) => { startPositions[k] = layoutRef.current[k] || { x: 0, y: 0 }; });
    const selectedTexts = selectedItemKeys.includes(key) ? selectedTextIds : [];
    const startTextPositions = {};
    selectedTexts.forEach((textId) => {
      const item = (textItemsRef.current || []).find((t) => t.id === textId);
      if (item) startTextPositions[textId] = { x: item.x, y: item.y };
    });
    itemDragRef.current = {
      keys: selected,
      textIds: selectedTexts,
      startWorldX: world.x,
      startWorldY: world.y,
      startPositions,
      startTextPositions,
    };
    setSelectedItemKeys(selected);
    e.currentTarget.setPointerCapture(e.pointerId);
  }, [pointerToWorld, selectedItemKeys, selectedTextIds]);

  const onHandlePointerMove = useCallback((e, key) => {
    const drag = itemDragRef.current;
    if (!drag || !drag.keys.includes(key)) return;
    const world = pointerToWorld(e);
    const dx = world.x - drag.startWorldX;
    const dy = world.y - drag.startWorldY;
    const nextLayout = { ...layoutRef.current };
    drag.keys.forEach((k) => {
      const base = drag.startPositions[k] || { x: 0, y: 0 };
      nextLayout[k] = { x: snapToGrid(base.x + dx), y: snapToGrid(base.y + dy) };
    });
    layoutRef.current = nextLayout;
    if (Array.isArray(drag.textIds) && drag.textIds.length > 0) {
      const nextTexts = (textItemsRef.current || []).map((t) => {
        if (!drag.textIds.includes(t.id)) return t;
        const base = drag.startTextPositions[t.id] || { x: t.x, y: t.y };
        return { ...t, x: snapToGrid(base.x + dx), y: snapToGrid(base.y + dy) };
      });
      textItemsRef.current = nextTexts;
    }
    rerender();
  }, [pointerToWorld, rerender]);

  const onHandlePointerUp = useCallback((e, key) => {
    if (!itemDragRef.current || !itemDragRef.current.keys.includes(key)) return;
    commitLayout({ ...layoutRef.current });
    if (Array.isArray(itemDragRef.current.textIds) && itemDragRef.current.textIds.length > 0) {
      commitTextItems([...(textItemsRef.current || [])]);
    }
    itemDragRef.current = null;
  }, [commitLayout, commitTextItems]);

  // --- Add item to desk ---
  const addItemToDesk = useCallback((key) => {
    const el = viewportRef.current;
    const w = el ? el.clientWidth : 800;
    const h = el ? el.clientHeight : 600;
    const centerX = (w / 2 - panRef.current.x) / zoomRef.current;
    const centerY = (h / 2 - panRef.current.y) / zoomRef.current;
    const offset = Object.keys(layoutRef.current).length * 20;
    const newLayout = { ...layoutRef.current, [key]: { x: snapToGrid(centerX - CARD_W / 2 + offset % 200), y: snapToGrid(centerY - 150 + offset % 100) } };
    commitLayout(newLayout);
  }, [commitLayout]);

  // --- Remove item from desk ---
  const removeFromDesk = useCallback((key) => {
    const newLayout = { ...layoutRef.current };
    delete newLayout[key];
    const nextConnections = (connectionsRef.current || []).filter((c) => c.fromKey !== key && c.toKey !== key);
    commitLayout(newLayout);
    commitConnections(nextConnections, { recordHistory: false });
  }, [commitConnections, commitLayout]);

  // --- Text items ---
  const measuredTextSize = useCallback((el, fallback, fontSize) => {
    const fs = fontSize || 16;
    const nextWidth = Math.max(120, Math.ceil(el?.scrollWidth || el?.offsetWidth || Number(fallback?.width) || 180));
    const nextHeight = Math.max(fs + 16, Math.ceil(el?.scrollHeight || el?.offsetHeight || Number(fallback?.height) || 40));
    return { width: nextWidth, height: nextHeight };
  }, []);

  const addTextItem = useCallback(() => {
    const rect = viewportRef.current?.getBoundingClientRect();
    if (!rect) return;
    const mx = mouseRef.current.x;
    const my = mouseRef.current.y;
    const worldX = (mx - panRef.current.x) / zoomRef.current;
    const worldY = (my - panRef.current.y) / zoomRef.current;
    const snapped = snapPoint({ x: worldX, y: worldY });
    const id = textItemId();
    const newItem = { id, text: '', x: snapped.x, y: snapped.y, fontSize: 16, width: 180, height: 40 };
    const next = [...(textItemsRef.current || []), newItem];
    commitTextItems(next);
    setEditingTextId(id);
    setSlashMenu((prev) => ({ ...prev, open: false }));
    setConnectMode(false);
    setConnectStartKey(null);
  }, [commitTextItems]);

  const addTextItemAtCenter = useCallback(() => {
    const el = viewportRef.current;
    const w = el ? el.clientWidth : 800;
    const h = el ? el.clientHeight : 600;
    const worldX = (w / 2 - panRef.current.x) / zoomRef.current;
    const worldY = (h / 2 - panRef.current.y) / zoomRef.current;
    const snapped = snapPoint({ x: worldX, y: worldY });
    const id = textItemId();
    const newItem = { id, text: '', x: snapped.x, y: snapped.y, fontSize: 16, width: 180, height: 40 };
    const next = [...(textItemsRef.current || []), newItem];
    commitTextItems(next);
    setEditingTextId(id);
    setSlashMenu((prev) => ({ ...prev, open: false }));
    setConnectMode(false);
    setConnectStartKey(null);
  }, [commitTextItems]);

  const updateTextItem = useCallback((id, updates) => {
    const next = (textItemsRef.current || []).map((t) =>
      t.id === id ? { ...t, ...updates } : t
    );
    commitTextItems(next);
  }, [commitTextItems]);

  const deleteTextItem = useCallback((id) => {
    const next = (textItemsRef.current || []).filter((t) => t.id !== id);
    commitTextItems(next);
    if (editingTextId === id) setEditingTextId(null);
    setSelectedTextIds((prev) => prev.filter((x) => x !== id));
  }, [commitTextItems, editingTextId]);

  const textItemDragRef = useRef(null);

  const onTextHandlePointerDown = useCallback((e, id) => {
    e.stopPropagation();
    const world = pointerToWorld(e);
    const selected = selectedTextIds.includes(id) ? selectedTextIds : [id];
    const startPositions = {};
    selected.forEach((textId) => {
      const item = (textItemsRef.current || []).find((t) => t.id === textId);
      if (item) startPositions[textId] = { x: item.x, y: item.y };
    });
    const selectedItems = selectedTextIds.includes(id) ? selectedItemKeys : [];
    const startItemPositions = {};
    selectedItems.forEach((k) => {
      startItemPositions[k] = layoutRef.current[k] || { x: 0, y: 0 };
    });
    textItemDragRef.current = {
      ids: selected,
      itemKeys: selectedItems,
      startWorldX: world.x,
      startWorldY: world.y,
      startPositions,
      startItemPositions,
    };
    setSelectedTextIds(selected);
    setSelectedConnectionIds([]);
    setSelectedNodeIds([]);
    e.currentTarget.setPointerCapture(e.pointerId);
  }, [pointerToWorld, selectedItemKeys, selectedTextIds]);

  const onTextHandlePointerMove = useCallback((e, id) => {
    const drag = textItemDragRef.current;
    if (!drag || !drag.ids.includes(id)) return;
    const world = pointerToWorld(e);
    const dx = world.x - drag.startWorldX;
    const dy = world.y - drag.startWorldY;
    const next = (textItemsRef.current || []).map((t) =>
      drag.ids.includes(t.id) ? { ...t, x: snapToGrid((drag.startPositions[t.id]?.x || t.x) + dx), y: snapToGrid((drag.startPositions[t.id]?.y || t.y) + dy) } : t
    );
    textItemsRef.current = next;
    if (Array.isArray(drag.itemKeys) && drag.itemKeys.length > 0) {
      const nextLayout = { ...layoutRef.current };
      drag.itemKeys.forEach((k) => {
        const base = drag.startItemPositions[k] || layoutRef.current[k] || { x: 0, y: 0 };
        nextLayout[k] = { x: snapToGrid(base.x + dx), y: snapToGrid(base.y + dy) };
      });
      layoutRef.current = nextLayout;
    }
    rerender();
  }, [pointerToWorld, rerender]);

  const onTextHandlePointerUp = useCallback((e, id) => {
    if (!textItemDragRef.current || !textItemDragRef.current.ids.includes(id)) return;
    commitTextItems([...(textItemsRef.current || [])]);
    if (Array.isArray(textItemDragRef.current.itemKeys) && textItemDragRef.current.itemKeys.length > 0) {
      commitLayout({ ...layoutRef.current });
    }
    textItemDragRef.current = null;
  }, [commitLayout, commitTextItems]);

  const { x: panX, y: panY } = panRef.current;
  const zoom = zoomRef.current;
  const isPanning = !!panningRef.current;

  const layoutEntries = useMemo(() => {
    const layout = layoutRef.current;
    return Object.entries(layout).map(([key, pos]) => {
      const entry = resolveEntry(key, items, channels, desks);
      return entry ? { key, pos, entry } : null;
    }).filter(Boolean);
  }, [renderTick, items, channels, desks]); // eslint-disable-line react-hooks/exhaustive-deps

  const availableTags = useMemo(() => {
    const set = new Set();
    for (const it of items || []) {
      for (const t of it.tags || []) {
        const n = normalizeTag(t);
        if (n) set.add(n);
      }
    }
    for (const ch of channels || []) {
      for (const t of ch.tags || []) {
        const n = normalizeTag(t);
        if (n) set.add(n);
      }
    }
    return [...set].sort();
  }, [items, channels]);

  const routePointsFor = useCallback((conn) => {
    return connectionPointsFor(conn, layoutRef.current || {});
  }, []);

  const visibleConnections = useMemo(() => {
    const keys = new Set(Object.keys(layoutRef.current || {}));
    return (connectionsRef.current || [])
      .filter((conn) => keys.has(conn.fromKey) && keys.has(conn.toKey) && conn.fromKey !== conn.toKey)
      .map((conn) => ({ conn, points: routePointsFor(conn) }))
      .filter((row) => row.points && row.points.length >= 2);
  }, [renderTick, routePointsFor]);

  const handlePickConnectionNode = useCallback((key) => {
    if (!connectMode) return false;
    if (!connectStartKey) {
      setConnectStartKey(key);
      return true;
    }
    if (connectStartKey === key) {
      setConnectStartKey(null);
      return true;
    }
    const exists = (connectionsRef.current || []).some(
      (c) => (c.fromKey === connectStartKey && c.toKey === key) || (c.fromKey === key && c.toKey === connectStartKey)
    );
    if (!exists) {
      commitConnections([
        ...(connectionsRef.current || []),
        { id: connectionId(), fromKey: connectStartKey, toKey: key, route: { mode: 'auto', points: [] } },
      ]);
    }
    setConnectStartKey(null);
    return true;
  }, [commitConnections, connectMode, connectStartKey]);

  const beginDragLineHandle = useCallback((e, connId, handleIndex, initialPoint, kind = 'mid', edge = null) => {
    e.stopPropagation();
    const world = pointerToWorld(e);
    const key = `${connId}:${handleIndex}`;
    const currentSelected = selectedNodeIdsRef.current || [];
    const activeNodeIds = currentSelected.includes(key) ? currentSelected : [key];
    const activeHandles = activeNodeIds.map((id) => {
      const [cid, idxStr] = id.split(':');
      const idx = Number(idxStr);
      const conn = (connectionsRef.current || []).find((c) => c.id === cid);
      if (!conn || Number.isNaN(idx)) return null;
      const pts = conn.route?.mode === 'manual'
        ? (Array.isArray(conn.route?.points) ? conn.route.points : [])
        : ((routePointsFor(conn) || []).slice(1, -1));
      if (!pts[idx]) return null;
      return { connId: cid, handleIndex: idx, initialPoint: { x: pts[idx].x, y: pts[idx].y } };
    }).filter(Boolean);
    setSelectedNodeIds(activeNodeIds);
    lineDragRef.current = {
      connId,
      handleIndex,
      kind,
      edge,
      startWorldX: world.x,
      startWorldY: world.y,
      startSnap: snapPoint({ x: world.x, y: world.y }),
      initialPoint: initialPoint ? { x: initialPoint.x, y: initialPoint.y } : null,
      activeHandles,
    };
    e.currentTarget.setPointerCapture(e.pointerId);
  }, [pointerToWorld, routePointsFor]);

  const moveDragLineHandle = useCallback((e) => {
    const drag = lineDragRef.current;
    if (!drag) return;
    const world = pointerToWorld(e);
    const snappedMouse = snapPoint({ x: world.x, y: world.y });
    const dx = snappedMouse.x - drag.startSnap.x;
    const dy = snappedMouse.y - drag.startSnap.y;
    const next = (connectionsRef.current || []).map((conn) => {
      const points = conn.route?.mode === 'manual'
        ? (Array.isArray(conn.route?.points) ? [...conn.route.points] : [])
        : ((routePointsFor(conn) || []).slice(1, -1));
      const related = (drag.activeHandles || []).filter((h) => h.connId === conn.id);
      if (!related.length) return conn;
      related.forEach((h) => {
        if (!points[h.handleIndex]) return;
        points[h.handleIndex] = snapPoint({ x: h.initialPoint.x + dx, y: h.initialPoint.y + dy });
      });
      return { ...conn, route: { mode: 'manual', points } };
    });
    connectionsRef.current = next;
    rerender();
  }, [pointerToWorld, rerender, routePointsFor]);

  const endDragLineHandle = useCallback(() => {
    if (!lineDragRef.current) return;
    commitConnections([...(connectionsRef.current || [])]);
    lineDragRef.current = null;
  }, [commitConnections]);

  return React.createElement(
    'div',
    {
      ref: viewportRef,
      className: 'flex-1 min-h-0 w-full',
      style: {
        position: 'relative', overflow: 'hidden',
        background: '#111827',
        cursor: isPanning ? 'grabbing' : spaceRef.current ? 'grab' : 'default',
        touchAction: 'none',
      },
      onPointerDown: onViewportPointerDown,
      onPointerMove: onViewportPointerMove,
      onPointerUp: onViewportPointerUp,
      onPointerCancel: (e) => {
        activePointersRef.current.delete(e.pointerId);
        if (activePointersRef.current.size < 2) pinchStartRef.current = null;
        panningRef.current = null;
        marqueeRef.current = null;
        setMarqueeBox(null);
      },
    },
    // Dot grid background
    React.createElement(DotGrid, { panX, panY, zoom }),
    marqueeBox && React.createElement('div', {
      style: {
        position: 'absolute',
        left: marqueeBox.x,
        top: marqueeBox.y,
        width: marqueeBox.w,
        height: marqueeBox.h,
        border: '1px dashed #a78bfa',
        background: 'rgba(99,102,241,0.12)',
        pointerEvents: 'none',
        zIndex: 34,
      },
    }),
    // Canvas container — transform applied here
    React.createElement(
      'div',
      {
        style: {
          position: 'absolute', top: 0, left: 0,
          transformOrigin: '0 0',
          transform: `translate(${panX}px,${panY}px) scale(${zoom})`,
          willChange: 'transform',
        },
      },
      React.createElement(
        'svg',
        { style: { position: 'absolute', inset: 0, overflow: 'visible', pointerEvents: 'none' } },
        React.createElement(
          'defs',
          null,
          React.createElement(
            'marker',
            {
              id: 'desk-conn-arrow',
              markerWidth: 8,
              markerHeight: 8,
              refX: 7,
              refY: 3,
              orient: 'auto',
              markerUnits: 'strokeWidth',
            },
            React.createElement('path', { d: 'M0,0 L0,6 L7,3 z', fill: '#60a5fa' })
          ),
          React.createElement(
            'marker',
            {
              id: 'desk-conn-arrow-selected',
              markerWidth: 8,
              markerHeight: 8,
              refX: 7,
              refY: 3,
              orient: 'auto',
              markerUnits: 'strokeWidth',
            },
            React.createElement('path', { d: 'M0,0 L0,6 L7,3 z', fill: '#c4b5fd' })
          )
        ),
        visibleConnections.map(({ conn, points }) =>
          React.createElement(
            'g',
            { key: conn.id },
            React.createElement('path', {
              d: pointsToPath(points),
              stroke: selectedConnectionIds.includes(conn.id) ? '#c4b5fd' : '#60a5fa',
              strokeWidth: selectedConnectionIds.includes(conn.id) ? 3 : 2,
              fill: 'none',
              markerEnd: selectedConnectionIds.includes(conn.id) ? 'url(#desk-conn-arrow-selected)' : 'url(#desk-conn-arrow)',
              pointerEvents: connectMode ? 'stroke' : 'none',
              style: { pointerEvents: connectMode ? 'stroke' : 'none' },
              onPointerDown: (e) => {
                if (readOnly || !connectMode) return;
                e.stopPropagation();
                setSelectedConnectionIds([conn.id]);
              },
            }),
            !readOnly && connectMode && React.createElement('path', {
              d: pointsToPath(points),
              stroke: 'transparent',
              strokeWidth: 16,
              fill: 'none',
              pointerEvents: 'stroke',
              onPointerDown: (e) => {
                e.stopPropagation();
                setSelectedConnectionIds([conn.id]);
              },
            }),
            !readOnly && connectMode && (conn.route?.mode === 'manual'
              ? (Array.isArray(conn.route?.points) ? conn.route.points : [])
              : points.slice(1, -1)
            ).map((p, idx) =>
              React.createElement('circle', {
                key: `${conn.id}-h-${idx}`,
                cx: p.x,
                cy: p.y,
                r: 6,
                fill: selectedNodeIds.includes(`${conn.id}:${idx}`) ? '#4c1d95' : '#111827',
                stroke: selectedNodeIds.includes(`${conn.id}:${idx}`) ? '#ddd6fe' : '#93c5fd',
                strokeWidth: selectedNodeIds.includes(`${conn.id}:${idx}`) ? 2.6 : 2,
                style: { cursor: 'grab', pointerEvents: 'all' },
                onPointerDown: (e) => {
                  setSelectedConnectionIds([conn.id]);
                  const nodeId = `${conn.id}:${idx}`;
                  const additive = e.shiftKey || e.metaKey || e.ctrlKey;
                  if (additive) {
                    setSelectedNodeIds((prev) => prev.includes(nodeId) ? prev.filter((id) => id !== nodeId) : [...prev, nodeId]);
                  }
                  beginDragLineHandle(e, conn.id, idx, p);
                },
                onPointerMove: moveDragLineHandle,
                onPointerUp: endDragLineHandle,
              })
            )
          )
        )
      ),
      layoutEntries.map(({ key, pos, entry }) =>
        React.createElement(
          'div',
          {
            key,
            style: {
              position: 'absolute',
              left: pos.x,
              top: pos.y,
              width: CARD_W,
              userSelect: 'none',
              outline: selectedItemKeys.includes(key) ? '2px solid #c4b5fd' : 'none',
              outlineOffset: 2,
              borderRadius: 10,
            },
            onClick: (e) => {
              setSelectedConnectionIds([]);
              setSelectedNodeIds([]);
              setSelectedTextIds([]);
              setSlashMenu((prev) => prev.open ? { ...prev, open: false } : prev);
              if (!connectMode) return;
              e.preventDefault();
              e.stopPropagation();
              handlePickConnectionNode(key);
            },
          },
          // Drag handle bar
          !readOnly && React.createElement(
            'div',
            {
              style: {
                height: DRAG_BAR_H, background: '#1f2937', borderRadius: '8px 8px 0 0',
                border: '1px solid #374151', borderBottom: 'none',
                cursor: 'grab', display: 'flex', alignItems: 'center', justifyContent: 'space-between',
                padding: '0 8px', color: '#4b5563', touchAction: 'none',
              },
              onPointerDown: (e) => onHandlePointerDown(e, key),
              onPointerMove: (e) => onHandlePointerMove(e, key),
              onPointerUp: (e) => onHandlePointerUp(e, key),
            },
            React.createElement('span', { style: { fontSize: 14, letterSpacing: '0.2em', pointerEvents: 'none' } }, '· · ·'),
            React.createElement(
              'button',
              {
                onClick: (e) => { e.stopPropagation(); removeFromDesk(key); },
                style: { color: '#6b7280', cursor: 'pointer', fontSize: 16, lineHeight: 1, background: 'none', border: 'none', padding: '0 2px' },
                title: 'Remove from desk',
                onPointerDown: (e) => e.stopPropagation(),
              },
              '×'
            )
          ),
          // Tile content
          React.createElement(
            'div',
            {
              style: {
                borderRadius: readOnly ? 8 : '0 0 8px 8px',
                overflow: 'hidden',
                outline: connectMode && connectStartKey === key ? '2px solid #818cf8' : 'none',
              },
            },
            entry._entryType === 'item'
              ? React.createElement(DataTile, {
                  tileType: 'item',
                  item: entry,
                  onSelect: onSelectItem,
                  readOnly,
                  onSetTags: onSetTags ? (v, tags) => onSetTags(v, v.idbStore, tags) : undefined,
                  onSetSharedWith: onSetSharedWith ? (v, emails) => onSetSharedWith(v, v.idbStore, emails) : undefined,
                  canShare: typeof canShareRecord === 'function' ? canShareRecord(entry) : !readOnly,
                  shareableEmails: shareableEmails || [],
                  onRename: onRenameItem ? (v, name) => onRenameItem(v, v.idbStore, name) : undefined,
                  onSetNoteCoverImage: onSetNoteCoverImage,
                  availableTags,
                })
              : entry._entryType === 'channel'
              ? React.createElement(DataTile, {
                  tileType: 'channel',
                  channel: entry,
                  onSelect: onSelectChannel,
                  readOnly,
                  onSetTags: onSetTags ? (c, tags) => onSetTags(c, 'channels', tags) : undefined,
                  onSetSharedWith: onSetSharedWith ? (c, emails) => onSetSharedWith(c, 'channels', emails) : undefined,
                  canShare: typeof canShareRecord === 'function' ? canShareRecord(entry) : !readOnly,
                  shareableEmails: shareableEmails || [],
                  onRename: onRenameChannel ? (c, name) => onRenameChannel(c, 'channels', name) : undefined,
                  availableTags,
                })
              : React.createElement(DeskTile, { desk: entry, onSelect: onSelectDesk, readOnly: true })
          )
        )
      ),
      // Text items on canvas (top-left corner anchors to grid)
      (textItemsRef.current || []).map((ti) =>
        React.createElement(
          'div',
          {
            key: ti.id,
            style: {
              position: 'absolute',
              left: ti.x,
              top: ti.y,
              userSelect: 'none',
              width: Math.max(40, Number(ti.width) || 180),
              height: Math.max((ti.fontSize || 16) + 8, Number(ti.height) || 40),
            },
            onClick: (e) => {
              e.stopPropagation();
              if (editingTextId === ti.id) return;
              setSelectedTextIds([ti.id]);
              setSelectedItemKeys([]);
              setSelectedConnectionIds([]);
              setSelectedNodeIds([]);
            },
          },
          // Drag handle
          !readOnly && React.createElement(
            'div',
            {
              style: {
                height: 18, display: 'flex', alignItems: 'center', justifyContent: 'space-between',
                padding: '0 4px', cursor: 'grab', color: '#4b5563', fontSize: 10,
                background: editingTextId === ti.id ? '#1f2937' : 'transparent',
                borderRadius: '6px 6px 0 0',
                border: editingTextId === ti.id ? '1px solid #374151' : 'none',
                borderBottom: 'none', touchAction: 'none',
              },
              onPointerDown: (e) => onTextHandlePointerDown(e, ti.id),
              onPointerMove: (e) => onTextHandlePointerMove(e, ti.id),
              onPointerUp: (e) => onTextHandlePointerUp(e, ti.id),
            },
            React.createElement('span', { style: { letterSpacing: '0.15em', pointerEvents: 'none' } }, '· · ·'),
            React.createElement(
              'div',
              { style: { display: 'flex', gap: 4, alignItems: 'center' } },
              // Font size button
              React.createElement(
                'button',
                {
                  onClick: (e) => { e.stopPropagation(); setTextFontSizeMenu(textFontSizeMenu === ti.id ? null : ti.id); },
                  style: {
                    background: 'none', border: 'none', cursor: 'pointer',
                    color: '#9ca3af', fontSize: 10, padding: '0 3px',
                  },
                  title: 'Font size',
                  onPointerDown: (e) => e.stopPropagation(),
                },
                `${ti.fontSize || 16}px`
              ),
              // Delete button
              React.createElement(
                'button',
                {
                  onClick: (e) => { e.stopPropagation(); deleteTextItem(ti.id); },
                  style: { background: 'none', border: 'none', cursor: 'pointer', color: '#6b7280', fontSize: 12, lineHeight: 1, padding: '0 2px' },
                  title: 'Remove text',
                  onPointerDown: (e) => e.stopPropagation(),
                },
                '×'
              )
            )
          ),
          // Font size picker dropdown
          !readOnly && textFontSizeMenu === ti.id && React.createElement(
            'div',
            {
              style: {
                position: 'absolute', top: 18, right: 0, zIndex: 50,
                background: '#1f2937', border: '1px solid #374151', borderRadius: 8,
                boxShadow: '0 4px 16px rgba(0,0,0,0.4)', padding: 4,
                display: 'flex', flexWrap: 'wrap', gap: 2, width: 140,
              },
              onPointerDown: (e) => e.stopPropagation(),
            },
            TEXT_FONT_SIZES.map((sz) =>
              React.createElement(
                'button',
                {
                  key: sz,
                  onClick: (e) => { e.stopPropagation(); updateTextItem(ti.id, { fontSize: sz }); setTextFontSizeMenu(null); },
                  style: {
                    padding: '3px 7px', borderRadius: 5, fontSize: 11, fontWeight: 600,
                    cursor: 'pointer', border: 'none',
                    background: (ti.fontSize || 16) === sz ? '#4f46e5' : '#374151',
                    color: (ti.fontSize || 16) === sz ? '#fff' : '#9ca3af',
                  },
                },
                `${sz}px`
              )
            )
          ),
          // Text content: editable textarea or display
          editingTextId === ti.id
            ? React.createElement('textarea', {
                autoFocus: true,
                value: ti.text || '',
                onFocus: (e) => {
                  const size = measuredTextSize(e.currentTarget, ti, ti.fontSize || 16);
                  const next = (textItemsRef.current || []).map((t) =>
                    t.id === ti.id ? { ...t, ...size } : t
                  );
                  textItemsRef.current = next;
                  rerender();
                },
                onChange: (e) => {
                  const el = e.currentTarget;
                  const size = measuredTextSize(el, ti, ti.fontSize || 16);
                  const next = (textItemsRef.current || []).map((t) =>
                    t.id === ti.id
                      ? {
                          ...t,
                          text: e.target.value,
                          ...size,
                        }
                      : t
                  );
                  textItemsRef.current = next;
                  rerender();
                },
                onBlur: (e) => {
                  const el = e.currentTarget;
                  const size = measuredTextSize(el, ti, ti.fontSize || 16);
                  const next = (textItemsRef.current || []).map((t) =>
                    t.id === ti.id
                      ? {
                          ...t,
                          ...size,
                        }
                      : t
                  );
                  commitTextItems(next);
                  setEditingTextId(null);
                  setTextFontSizeMenu(null);
                },
                onKeyDown: (e) => {
                  if (e.key === 'Escape') {
                    commitTextItems([...(textItemsRef.current || [])]);
                    setEditingTextId(null);
                    setTextFontSizeMenu(null);
                    return;
                  }
                  if (e.key === 'Enter' && !e.shiftKey) {
                    e.preventDefault();
                    const size = measuredTextSize(e.currentTarget, ti, ti.fontSize || 16);
                    const next = (textItemsRef.current || []).map((t) =>
                      t.id === ti.id ? { ...t, ...size } : t
                    );
                    commitTextItems(next);
                    setEditingTextId(null);
                    setTextFontSizeMenu(null);
                  }
                },
                onMouseUp: (e) => {
                  const el = e.currentTarget;
                  const size = measuredTextSize(el, ti, ti.fontSize || 16);
                  const next = (textItemsRef.current || []).map((t) =>
                    t.id === ti.id
                      ? {
                          ...t,
                          ...size,
                        }
                      : t
                  );
                  textItemsRef.current = next;
                  rerender();
                },
                style: {
                  background: '#111827',
                  border: selectedTextIds.includes(ti.id) ? '2px solid #c4b5fd' : '1px solid #4f46e5',
                  borderRadius: 6,
                  padding: '4px 8px', fontSize: ti.fontSize || 16, color: '#e5e7eb',
                  outline: 'none', minWidth: 120, minHeight: (ti.fontSize || 16) + 16,
                  width: Math.max(120, Number(ti.width) || 180),
                  height: Math.max((ti.fontSize || 16) + 16, Number(ti.height) || 40),
                  resize: 'both', fontFamily: 'inherit', lineHeight: 1.4,
                  boxSizing: 'border-box',
                  overflow: 'hidden',
                },
              })
            : React.createElement(
                'div',
                {
                  onDoubleClick: () => { if (!readOnly) setEditingTextId(ti.id); },
                  style: {
                    fontSize: ti.fontSize || 16, color: '#e5e7eb', whiteSpace: 'pre-wrap',
                    cursor: readOnly ? 'default' : 'text', padding: '4px 8px',
                    minWidth: 40, minHeight: (ti.fontSize || 16) + 8,
                    width: Math.max(40, Number(ti.width) || 180),
                    height: Math.max((ti.fontSize || 16) + 8, Number(ti.height) || 40),
                    borderRadius: 4,
                    border: selectedTextIds.includes(ti.id) ? '2px solid #c4b5fd' : '1px solid transparent',
                    lineHeight: 1.4,
                    boxSizing: 'border-box',
                    overflow: 'hidden',
                  },
                  onMouseEnter: (e) => { if (!readOnly) e.currentTarget.style.border = '1px dashed #374151'; },
                  onMouseLeave: (e) => { e.currentTarget.style.border = '1px solid transparent'; },
                },
                ti.text || (readOnly ? '' : 'Double-click to edit')
              )
        )
      ),
      !readOnly && connectMode && React.createElement(
        'svg',
        { style: { position: 'absolute', inset: 0, overflow: 'visible', pointerEvents: 'none' } },
        visibleConnections.map(({ conn, points }) =>
          React.createElement(
            'g',
            { key: `edge-${conn.id}` },
            React.createElement('circle', {
              cx: points[0].x,
              cy: points[0].y,
              r: 5.5,
              fill: '#1e293b',
              stroke: '#60a5fa',
              strokeWidth: 2,
              style: { pointerEvents: 'none' },
            }),
            React.createElement('circle', {
              cx: points[points.length - 1].x,
              cy: points[points.length - 1].y,
              r: 5.5,
              fill: '#1e293b',
              stroke: '#60a5fa',
              strokeWidth: 2,
              style: { pointerEvents: 'none' },
            })
          )
        )
      )
    ),
    // Top-center: desk title (always shown)
    React.createElement(
      'div',
      {
        style: { position: 'absolute', top: 16, left: '50%', transform: 'translateX(-50%)', zIndex: 35 },
        onClick: (e) => e.stopPropagation(),
      },
      React.createElement(DeskSelector, {
        desks: desks || [],
        currentDeskId: desk?.id,
        onSelect: onSelectDesk,
        onRename: onRenameDesk,
      })
    ),
    // Top-right toolbar: search to add existing items + add new content
    !readOnly && React.createElement(
      'div',
      {
        style: {
          position: 'absolute', top: 16, right: 16, zIndex: 35,
          display: 'flex', alignItems: 'center', gap: 8,
        },
      },
      React.createElement(InlineAddSearch, {
        items,
        channels,
        desks,
        currentDeskId: desk?.id,
        currentLayout: layoutRef.current,
        onAdd: addItemToDesk,
      }),
      role !== 'viewer' && React.createElement(
        'button',
        {
          onClick: addTextItemAtCenter,
          title: 'Add text (T)',
          style: {
            background: '#1f2937', border: '1px solid #374151', borderRadius: 10,
            padding: '7px 12px', fontSize: 13, color: '#e5e7eb',
            cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 5,
            touchAction: 'manipulation',
          },
          onMouseEnter: (e) => { e.currentTarget.style.background = '#374151'; },
          onMouseLeave: (e) => { e.currentTarget.style.background = '#1f2937'; },
        },
        React.createElement(
          'svg', { xmlns: 'http://www.w3.org/2000/svg', width: 14, height: 14, fill: 'none', viewBox: '0 0 24 24', stroke: 'currentColor', strokeWidth: 2.5 },
          React.createElement('path', { strokeLinecap: 'round', strokeLinejoin: 'round', d: 'M3 5h18M12 5v14' })
        ),
        'Text'
      ),
      role !== 'viewer' && (onOpenNewNote || onOpenFile) && React.createElement(AddContentDropdown, {
        onNewNote: onOpenNewNote,
        onAddYoutube: onOpenYoutube,
        onAddChannel: onOpenChannel,
        onAddFile: onOpenFile,
        onAddUrl: onOpenUrl,
      })
    ),
    // Slash menu ("/" at mouse location)
    !readOnly && slashMenu.open && React.createElement(
      'div',
      {
        style: {
          position: 'absolute',
          top: slashMenu.y,
          left: slashMenu.x,
          width: 220,
          zIndex: 40,
          background: '#1f2937',
          border: '1px solid #374151',
          borderRadius: 10,
          padding: 10,
          boxShadow: '0 8px 24px rgba(0,0,0,0.35)',
        },
        onPointerDown: (e) => e.stopPropagation(),
      },
      // Text input option
      React.createElement(
        'button',
        {
          onClick: addTextItem,
          style: {
            width: '100%', display: 'flex', alignItems: 'center', gap: 8,
            border: '1px solid #374151', borderRadius: 8, background: '#111827',
            color: '#e5e7eb', padding: '8px 10px', fontSize: 13, cursor: 'pointer',
            marginBottom: 8, textAlign: 'left',
          },
          onMouseEnter: (e) => { e.currentTarget.style.background = '#1e293b'; },
          onMouseLeave: (e) => { e.currentTarget.style.background = '#111827'; },
        },
        React.createElement(
          'svg', { xmlns: 'http://www.w3.org/2000/svg', width: 14, height: 14, fill: 'none', viewBox: '0 0 24 24', stroke: 'currentColor', strokeWidth: 2 },
          React.createElement('path', { strokeLinecap: 'round', strokeLinejoin: 'round', d: 'M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-7-10h6m-3 0v12' })
        ),
        'Text'
      ),
      // Connections section
      React.createElement('p', { style: { color: '#9ca3af', fontSize: 11, marginBottom: 8, textTransform: 'uppercase', letterSpacing: '0.05em' } }, 'Connections'),
      React.createElement('p', { style: { color: '#a5b4fc', fontSize: 11, lineHeight: 1.5, marginBottom: 8 } }, 'Line edit mode is active. Press "/" again to exit.'),
      connectMode && React.createElement('p', { style: { color: '#a5b4fc', fontSize: 11, lineHeight: 1.5, marginBottom: 8 } }, connectStartKey ? 'Select the second item to complete line.' : 'Click first item, then second item.'),
      connectMode && connectStartKey && React.createElement(
        'button',
        {
          onClick: () => {
            setConnectStartKey(null);
            setSlashMenu((prev) => ({ ...prev, open: false }));
          },
          style: {
            width: '100%',
            border: '1px solid #374151',
            borderRadius: 8,
            background: '#111827',
            color: '#9ca3af',
            padding: '6px 8px',
            fontSize: 12,
            cursor: 'pointer',
            marginBottom: 8,
          },
        },
        'Cancel Selection'
      )
    ),
    // Zoom indicator
    React.createElement(
      'div',
      {
        style: {
          position: 'absolute', bottom: 16, left: 16, zIndex: 30, background: '#1f2937',
          border: '1px solid #374151', borderRadius: 8, padding: '4px 10px',
          color: '#9ca3af', fontSize: 12, fontFamily: 'monospace', pointerEvents: 'none',
        },
      },
      `${Math.round(zoom * 100)}%`
    ),
    // Empty state
    layoutEntries.length === 0 && React.createElement(
      'div',
      {
        style: {
          position: 'absolute', inset: 0, display: 'flex', flexDirection: 'column',
          alignItems: 'center', justifyContent: 'center', pointerEvents: 'none',
        },
      },
      React.createElement('p', { style: { color: '#4b5563', fontSize: 18, fontWeight: 600, marginBottom: 8 } }, desk?.name || 'Desk'),
      React.createElement(
        'p',
        { style: { color: '#374151', fontSize: 14, maxWidth: 360, textAlign: 'center', lineHeight: 1.5 } },
        'This desk is empty. Use the search bar or ',
        React.createElement('span', { style: { color: '#a5b4fc', fontWeight: 600 } }, '+ Add Content'),
        ' (top-right) to place items here.'
      )
    )
  );
};

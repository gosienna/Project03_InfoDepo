
import React, { useState, useEffect, useRef, useCallback, useMemo } from 'react';
import { DataTile } from './DataTile.js';
import { DeskTile } from './DeskTile.js';
import { AddContentDropdown } from './AddContentDropdown.js';
import { normalizeTag } from '../utils/tagUtils.js';

const CARD_W = 250;
const DRAG_BAR_H = 26;
const DEFAULT_ZOOM_MIN = 0.1;
const DEFAULT_ZOOM_MAX = 5;

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

// --- Dot grid background ---

const DotGrid = ({ panX, panY, zoom }) => {
  const gridSize = 40;
  const scaled = gridSize * zoom;
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

export const Desk = ({
  desk,
  items,
  channels,
  desks,
  onSelectItem,
  onSelectChannel,
  onSelectDesk,
  onUpdateLayout,
  onRenameDesk,
  onSetTags,
  onSetSharedWith,
  canShareRecord,
  shareableEmails,
  onRenameItem,
  onRenameChannel,
  onSetNoteCoverImage,
  readOnly,
  onOpenNewNote,
  onOpenYoutube,
  onOpenChannel,
  onOpenFile,
}) => {
  const viewportRef = useRef(null);

  // Refs for real-time drag values (avoids stale closures in event handlers)
  const panRef = useRef({ x: 0, y: 0 });
  const zoomRef = useRef(1);
  const [renderTick, setRenderTick] = useState(0);
  const rerender = useCallback(() => setRenderTick((n) => n + 1), []);

  // Layout: layoutRef is the live truth during drag; state is committed on drag-end
  const layoutRef = useRef(desk?.layout || {});
  useEffect(() => {
    // Sync ref when desk prop changes (e.g. after a save)
    layoutRef.current = desk?.layout || {};
    rerender();
  }, [desk?.layout]); // eslint-disable-line react-hooks/exhaustive-deps

  const commitLayout = useCallback((newLayout) => {
    layoutRef.current = newLayout;
    if (onUpdateLayout && desk?.id != null) onUpdateLayout(desk.id, newLayout);
    rerender();
  }, [onUpdateLayout, desk?.id, rerender]);


  // --- Pan ---
  const panningRef = useRef(null);
  const spaceRef = useRef(false);

  useEffect(() => {
    const down = (e) => {
      if (e.code === 'Space' && e.target === document.body) { e.preventDefault(); spaceRef.current = true; rerender(); }
    };
    const up = (e) => { if (e.code === 'Space') { spaceRef.current = false; rerender(); } };
    window.addEventListener('keydown', down);
    window.addEventListener('keyup', up);
    return () => { window.removeEventListener('keydown', down); window.removeEventListener('keyup', up); };
  }, [rerender]);

  const onViewportPointerDown = useCallback((e) => {
    if (e.button === 1 || (e.button === 0 && spaceRef.current)) {
      e.preventDefault();
      panningRef.current = { startX: e.clientX, startY: e.clientY, originX: panRef.current.x, originY: panRef.current.y };
      viewportRef.current?.setPointerCapture(e.pointerId);
    }
  }, []);

  const onViewportPointerMove = useCallback((e) => {
    if (!panningRef.current) return;
    panRef.current = {
      x: panningRef.current.originX + (e.clientX - panningRef.current.startX),
      y: panningRef.current.originY + (e.clientY - panningRef.current.startY),
    };
    rerender();
  }, [rerender]);

  const onViewportPointerUp = useCallback(() => { panningRef.current = null; }, []);

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

  const onHandlePointerDown = useCallback((e, key) => {
    e.stopPropagation();
    const worldX = (e.clientX - panRef.current.x) / zoomRef.current;
    const worldY = (e.clientY - panRef.current.y) / zoomRef.current;
    const pos = layoutRef.current[key] || { x: 0, y: 0 };
    itemDragRef.current = { key, startWorldX: worldX, startWorldY: worldY, startItemX: pos.x, startItemY: pos.y };
    e.currentTarget.setPointerCapture(e.pointerId);
  }, []);

  const onHandlePointerMove = useCallback((e, key) => {
    const drag = itemDragRef.current;
    if (!drag || drag.key !== key) return;
    const worldX = (e.clientX - panRef.current.x) / zoomRef.current;
    const worldY = (e.clientY - panRef.current.y) / zoomRef.current;
    layoutRef.current = {
      ...layoutRef.current,
      [key]: { x: drag.startItemX + worldX - drag.startWorldX, y: drag.startItemY + worldY - drag.startWorldY },
    };
    rerender();
  }, [rerender]);

  const onHandlePointerUp = useCallback((e, key) => {
    if (!itemDragRef.current || itemDragRef.current.key !== key) return;
    commitLayout({ ...layoutRef.current });
    itemDragRef.current = null;
  }, [commitLayout]);

  // --- Add item to desk ---
  const addItemToDesk = useCallback((key) => {
    const el = viewportRef.current;
    const w = el ? el.clientWidth : 800;
    const h = el ? el.clientHeight : 600;
    const centerX = (w / 2 - panRef.current.x) / zoomRef.current;
    const centerY = (h / 2 - panRef.current.y) / zoomRef.current;
    const offset = Object.keys(layoutRef.current).length * 20;
    const newLayout = { ...layoutRef.current, [key]: { x: centerX - CARD_W / 2 + offset % 200, y: centerY - 150 + offset % 100 } };
    commitLayout(newLayout);
  }, [commitLayout]);

  // --- Remove item from desk ---
  const removeFromDesk = useCallback((key) => {
    const newLayout = { ...layoutRef.current };
    delete newLayout[key];
    commitLayout(newLayout);
  }, [commitLayout]);

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

  return React.createElement(
    'div',
    {
      ref: viewportRef,
      className: 'flex-1 min-h-0 w-full',
      style: {
        position: 'relative', overflow: 'hidden',
        background: '#111827',
        cursor: isPanning ? 'grabbing' : spaceRef.current ? 'grab' : 'default',
      },
      onPointerDown: onViewportPointerDown,
      onPointerMove: onViewportPointerMove,
      onPointerUp: onViewportPointerUp,
    },
    // Dot grid background
    React.createElement(DotGrid, { panX, panY, zoom }),
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
      layoutEntries.map(({ key, pos, entry }) =>
        React.createElement(
          'div',
          {
            key,
            style: { position: 'absolute', left: pos.x, top: pos.y, width: CARD_W, userSelect: 'none' },
          },
          // Drag handle bar
          !readOnly && React.createElement(
            'div',
            {
              style: {
                height: DRAG_BAR_H, background: '#1f2937', borderRadius: '8px 8px 0 0',
                border: '1px solid #374151', borderBottom: 'none',
                cursor: 'grab', display: 'flex', alignItems: 'center', justifyContent: 'space-between',
                padding: '0 8px', color: '#4b5563',
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
            { style: { borderRadius: readOnly ? 8 : '0 0 8px 8px', overflow: 'hidden' } },
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
      (onOpenNewNote || onOpenFile) && React.createElement(AddContentDropdown, {
        onNewNote: onOpenNewNote,
        onAddYoutube: onOpenYoutube,
        onAddChannel: onOpenChannel,
        onAddFile: onOpenFile,
      })
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

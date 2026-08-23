
import React, { useState, useEffect, useRef, useCallback, useMemo } from 'react';
import { DataTile } from './DataTile.js';
import { CoverImagePickerModal } from './CoverImagePickerModal.js';
import { AddContentDropdown } from './AddContentDropdown.js';
import { normalizeTag } from '../utils/tagUtils.js';
import { useDriveTileUpload, channelUploadKey } from '../hooks/useDriveTileUpload.js';
import { libraryItemKey } from '../utils/libraryItemKey.js';
import {
  itemEntryKey,
  channelEntryKey,
  deskEntryKey,
  resolveLayoutEntry,
  normalizeDeskLayoutV11,
} from '../utils/deskEntryKeys.js';

const CARD_W = 250;
const DRAG_BAR_H = 26;
const DEFAULT_ZOOM_MIN = 0.1;
const DEFAULT_ZOOM_MAX = 5;
const GRID_SIZE = 40;
const CARD_H = 220;
const SECTION_HEADER_H = 22;
const MIN_SECTION_W = 160;
const MIN_SECTION_H = 120;
// Auto-expand grows a section a bit past the item's actual edge, so the new
// boundary sits with breathing room around it instead of flush against it.
const SECTION_EXPAND_PADDING = 20;

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

// `size` is the actually-rendered card footprint (measured via ResizeObserver);
// falls back to the nominal CARD_W/CARD_H before the first measurement lands.
const cardBoxFor = (pos, size) => {
  const w = size?.width || CARD_W;
  const h = size?.height || CARD_H;
  return {
    left: pos.x,
    right: pos.x + w,
    top: pos.y,
    bottom: pos.y + h,
    cx: pos.x + w / 2,
    cy: pos.y + h / 2,
  };
};

// Section geometry helpers. Sections are {id, x, y, width, height, label}
// rectangles; membership (which items sit inside one) is never persisted,
// only computed live from current positions.
const sectionBoxFor = (s) => ({
  left: s.x,
  top: s.y,
  right: s.x + s.width,
  bottom: s.y + s.height,
});

const boxContainedIn = (box, sectionBox) =>
  box.left >= sectionBox.left && box.right <= sectionBox.right &&
  box.top >= sectionBox.top && box.bottom <= sectionBox.bottom;

// True when the two boxes share any area — used to gate auto-expand so a
// section only grows for an item actually straddling its edge, never for one
// dragged clean away (otherwise the section would balloon out to keep
// re-engulfing anything that ever touched it, trapping it permanently).
const boxesOverlap = (a, b) =>
  a.left < b.right && a.right > b.left && a.top < b.bottom && a.bottom > b.top;

// Grow-only union: expands `section` just enough to contain `box` plus a
// little padding, so the new boundary has breathing room around the item
// instead of sitting flush against its edge. Never shrinks. Returns the same
// reference when nothing changed, so callers can cheaply detect a no-op.
const expandSectionToContain = (section, box) => {
  const left = Math.min(section.x, box.left - SECTION_EXPAND_PADDING);
  const top = Math.min(section.y, box.top - SECTION_EXPAND_PADDING);
  const right = Math.max(section.x + section.width, box.right + SECTION_EXPAND_PADDING);
  const bottom = Math.max(section.y + section.height, box.bottom + SECTION_EXPAND_PADDING);
  if (left === section.x && top === section.y && right === section.x + section.width && bottom === section.y + section.height) {
    return section;
  }
  return { ...section, x: left, y: top, width: right - left, height: bottom - top };
};

const edgeAnchors = (box) => ([
  { edge: 'left', x: box.left, y: box.cy },
  { edge: 'right', x: box.right, y: box.cy },
  { edge: 'top', x: box.cx, y: box.top },
  { edge: 'bottom', x: box.cx, y: box.bottom },
]);

const autoRoute = (from, to) => {
  const f = snapPoint(from);
  const t = snapPoint(to);
  const fromVertical = from.edge === 'top' || from.edge === 'bottom';
  const toVertical = to.edge === 'top' || to.edge === 'bottom';
  if (fromVertical && toVertical) {
    const my = snapToGrid((f.y + t.y) / 2);
    return [f, { x: f.x, y: my }, { x: t.x, y: my }, t];
  }
  if (fromVertical !== toVertical) {
    // Mixed exit/entry edges: bend once, leaving along the source edge's
    // axis and arriving along the target edge's axis so the arrowhead at
    // the end always points along the direction it actually enters from.
    const corner = fromVertical ? { x: f.x, y: t.y } : { x: t.x, y: f.y };
    return [f, corner, t];
  }
  const mx = snapToGrid((f.x + t.x) / 2);
  return [f, { x: mx, y: f.y }, { x: mx, y: t.y }, t];
};

const closestAnchors = (fromPos, toPos, fromSize, toSize) => {
  const fromBox = cardBoxFor(fromPos, fromSize);
  const toBox = cardBoxFor(toPos, toSize);
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
  // Drop consecutive duplicate points so the final segment is never
  // zero-length — a zero-length last segment leaves the `orient="auto"`
  // arrowhead marker with no direction to follow, and it falls back to
  // pointing along the positive x-axis (i.e. always to the right).
  const deduped = points.reduce((acc, p) => {
    const prev = acc[acc.length - 1];
    if (!prev || prev.x !== p.x || prev.y !== p.y) acc.push(p);
    return acc;
  }, []);
  if (deduped.length < 2) return '';
  return `M ${deduped[0].x} ${deduped[0].y} ${deduped.slice(1).map((p) => `L ${p.x} ${p.y}`).join(' ')}`;
};

const connectionPointsFor = (conn, layout, sizes) => {
  const fromPos = layout?.[conn.fromKey];
  const toPos = layout?.[conn.toKey];
  if (!fromPos || !toPos) return null;
  const anchors = closestAnchors(fromPos, toPos, sizes?.[conn.fromKey], sizes?.[conn.toKey]);
  if (!anchors) return null;
  const start = snapPoint(anchors.from);
  const end = snapPoint(anchors.to);
  if (conn.route?.mode === 'manual') {
    const mids = Array.isArray(conn.route.points) ? conn.route.points.map(snapPoint) : [];
    return [start, ...mids, end];
  }
  return autoRoute({ ...start, edge: anchors.from.edge }, { ...end, edge: anchors.to.edge });
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
      }, React.createElement('circle', { cx: 0, cy: 0, r: 1.2, fill: '#d1d5db' }))
    ),
    React.createElement('rect', { width: '100%', height: '100%', fill: 'url(#desk-dot-grid)' })
  );
};

// --- Desk selector dropdown ---

const DeskSelector = ({ desks, currentDeskId, onSelect, onRename }) => {
  const [open, setOpen] = useState(false);
  const [editingId, setEditingId] = useState(null);
  const [editValue, setEditValue] = useState('');
  const [searchQuery, setSearchQuery] = useState('');
  const editingRef = useRef(false);
  const containerRef = useRef(null);
  const current = desks.find((d) => d.driveId === currentDeskId);

  useEffect(() => { if (!open) setSearchQuery(''); }, [open]);

  const filteredDesks = searchQuery.trim()
    ? desks.filter((d) => (d.name || 'Untitled Desk').toLowerCase().includes(searchQuery.trim().toLowerCase()))
    : desks;

  const headerEditing = Boolean(
    onRename && currentDeskId && editingId === currentDeskId && !open
  );

  const startEdit = (e, d) => {
    e.preventDefault();
    e.stopPropagation();
    editingRef.current = true;
    setEditingId(d.driveId);
    setEditValue(d.name || '');
  };

  const startHeaderEdit = (e) => {
    e.preventDefault();
    e.stopPropagation();
    if (!onRename || !currentDeskId) return;
    editingRef.current = true;
    setOpen(false);
    setEditingId(currentDeskId);
    setEditValue(current?.name || '');
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

  const titleStyle = {
    overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
    fontSize: 20, fontWeight: 700, color: 'rgb(var(--theme-900))', letterSpacing: '-0.02em',
    maxWidth: 'min(50vw, 420px)',
  };

  return React.createElement(
    'div',
    { ref: containerRef, style: { position: 'relative' }, onClick: (e) => e.stopPropagation() },
    headerEditing
      ? React.createElement(
          'div',
          {
            style: {
              display: 'flex', alignItems: 'center', gap: 8,
              padding: '4px 10px', borderRadius: 10,
            },
          },
          React.createElement('input', {
            autoFocus: true,
            value: editValue,
            onChange: (e) => setEditValue(e.target.value),
            onKeyDown: (e) => {
              if (e.key === 'Enter') { e.preventDefault(); commitEdit(currentDeskId); }
              if (e.key === 'Escape') { e.preventDefault(); cancelEdit(); }
            },
            onBlur: () => commitEdit(currentDeskId),
            style: {
              minWidth: 160, maxWidth: 'min(50vw, 420px)',
              background: 'rgb(var(--theme-100))', border: '1px solid rgb(var(--theme-600))',
              borderRadius: 6, padding: '6px 10px', fontSize: 18, fontWeight: 700,
              color: 'rgb(var(--theme-900))', outline: 'none',
            },
          }),
          React.createElement(
            'button',
            {
              type: 'button',
              onMouseDown: (e) => { e.preventDefault(); commitEdit(currentDeskId); },
              style: { background: 'none', border: 'none', cursor: 'pointer', padding: '2px 4px', color: 'rgb(var(--theme-600))', flexShrink: 0 },
              title: 'Save',
            },
            React.createElement(
              'svg', { xmlns: 'http://www.w3.org/2000/svg', width: 16, height: 16, fill: 'none', viewBox: '0 0 24 24', stroke: 'currentColor', strokeWidth: 2.5 },
              React.createElement('path', { strokeLinecap: 'round', strokeLinejoin: 'round', d: 'M5 13l4 4L19 7' })
            )
          ),
          React.createElement(
            'button',
            {
              type: 'button',
              onMouseDown: (e) => { e.preventDefault(); cancelEdit(); },
              style: { background: 'none', border: 'none', cursor: 'pointer', padding: '2px 4px', color: '#6b7280', flexShrink: 0 },
              title: 'Cancel',
            },
            React.createElement(
              'svg', { xmlns: 'http://www.w3.org/2000/svg', width: 16, height: 16, fill: 'none', viewBox: '0 0 24 24', stroke: 'currentColor', strokeWidth: 2.5 },
              React.createElement('path', { strokeLinecap: 'round', strokeLinejoin: 'round', d: 'M6 18L18 6M6 6l12 12' })
            )
          )
        )
      : React.createElement(
          'div',
          {
            style: {
              display: 'flex', alignItems: 'center', gap: 8,
              padding: '4px 10px', borderRadius: 10,
            },
          },
          React.createElement(
            'span',
            {
              onClick: () => { if (open) setOpen(false); },
              onDoubleClick: startHeaderEdit,
              title: onRename ? 'Double-click to rename' : undefined,
              style: {
                ...titleStyle,
                cursor: onRename ? 'text' : 'default',
                userSelect: onRename ? 'text' : 'none',
              },
            },
            current?.name || 'Desk'
          ),
          desks.length > 1 && React.createElement(
            'button',
            {
              type: 'button',
              onClick: () => setOpen((v) => !v),
              onBlur: () => setTimeout(() => { if (!editingRef.current && !containerRef.current?.contains(document.activeElement)) setOpen(false); }, 150),
              style: {
                background: 'none', border: 'none', borderRadius: 8,
                padding: '4px 6px', cursor: 'pointer', flexShrink: 0,
                display: 'flex', alignItems: 'center', color: '#6b7280',
              },
              'aria-expanded': open,
              'aria-label': 'Switch desk',
            },
            React.createElement(
              'svg',
              { xmlns: 'http://www.w3.org/2000/svg', width: 14, height: 14, fill: 'none', viewBox: '0 0 24 24', stroke: 'currentColor', strokeWidth: 2.5 },
              React.createElement('path', { strokeLinecap: 'round', strokeLinejoin: 'round', d: 'M19 9l-7 7-7-7' })
            )
          )
        ),
    open && desks.length > 1 && React.createElement(
      'div',
      {
        style: {
          position: 'absolute', top: 'calc(100% + 4px)', left: '50%', transform: 'translateX(-50%)',
          background: 'rgb(var(--theme-50))', border: '1px solid #e5e7eb', borderRadius: 10,
          boxShadow: '0 8px 24px rgba(0,0,0,0.4)', zIndex: 50,
          minWidth: 220,
        },
      },
      React.createElement(
        'div',
        { style: { padding: '8px', borderBottom: '1px solid #e5e7eb', position: 'relative' } },
        React.createElement('input', {
          autoFocus: true,
          type: 'text',
          value: searchQuery,
          onChange: (e) => setSearchQuery(e.target.value),
          onKeyDown: (e) => { if (e.key === 'Escape') { e.preventDefault(); setOpen(false); } },
          onBlur: () => setTimeout(() => { if (!containerRef.current?.contains(document.activeElement)) setOpen(false); }, 150),
          placeholder: 'Search desks…',
          style: {
            width: '100%', boxSizing: 'border-box',
            background: 'rgb(var(--theme-100))', border: '1px solid #e5e7eb',
            borderRadius: 6, padding: '5px 28px 5px 10px', fontSize: 12, color: 'rgb(var(--theme-900))',
            outline: 'none',
          },
        }),
        React.createElement(
          'svg',
          { xmlns: 'http://www.w3.org/2000/svg', width: 12, height: 12, fill: 'none', viewBox: '0 0 24 24', stroke: '#6b7280', strokeWidth: 2, style: { position: 'absolute', right: 18, top: '50%', transform: 'translateY(-50%)', pointerEvents: 'none' } },
          React.createElement('path', { strokeLinecap: 'round', strokeLinejoin: 'round', d: 'M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z' })
        )
      ),
      React.createElement(
        'div',
        { style: { maxHeight: 260, overflowY: 'auto' } },
        filteredDesks.length === 0
          ? React.createElement('p', { style: { color: '#6b7280', fontSize: 12, textAlign: 'center', padding: '12px 16px' } }, 'No desks found.')
          : filteredDesks.map((d) =>
        React.createElement(
          'div',
          {
            key: d.driveId,
            style: {
              display: 'flex', alignItems: 'center', gap: 6,
              background: d.driveId === currentDeskId ? 'rgb(var(--theme-100))' : 'none',
              borderBottom: '1px solid #e5e7eb',
              padding: editingId === d.driveId ? '4px 8px' : '0',
            },
          },
          editingId === d.driveId
            // Inline edit mode
            ? React.createElement(
                React.Fragment, null,
                React.createElement('input', {
                  autoFocus: true,
                  value: editValue,
                  onChange: (e) => setEditValue(e.target.value),
                  onKeyDown: (e) => {
                    if (e.key === 'Enter') { e.preventDefault(); commitEdit(d.driveId); }
                    if (e.key === 'Escape') { e.preventDefault(); cancelEdit(); }
                  },
                  onBlur: () => commitEdit(d.driveId),
                  style: {
                    flex: 1, background: 'rgb(var(--theme-100))', border: '1px solid rgb(var(--theme-600))',
                    borderRadius: 6, padding: '4px 8px', fontSize: 13, color: 'rgb(var(--theme-900))',
                    outline: 'none', minWidth: 0,
                  },
                }),
                React.createElement(
                  'button',
                  {
                    onMouseDown: (e) => { e.preventDefault(); commitEdit(d.driveId); },
                    style: { background: 'none', border: 'none', cursor: 'pointer', padding: '2px 4px', color: 'rgb(var(--theme-600))', flexShrink: 0 },
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
                      color: d.driveId === currentDeskId ? 'rgb(var(--theme-700))' : 'rgb(var(--theme-900))',
                      fontSize: 13, cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 8,
                      minWidth: 0,
                    },
                    onMouseEnter: (e) => { if (d.driveId !== currentDeskId) e.currentTarget.closest('div').style.background = '#f3f4f6'; },
                    onMouseLeave: (e) => { if (d.driveId !== currentDeskId) e.currentTarget.closest('div').style.background = 'none'; },
                  },
                  d.driveId === currentDeskId && React.createElement('span', { style: { color: 'rgb(var(--theme-600))', fontSize: 8, lineHeight: 1, flexShrink: 0 } }, '●'),
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
                    onMouseEnter: (e) => { e.currentTarget.style.color = '#111827'; },
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
    )
  );
};

// --- Inline search to add existing items to desk ---

const subColor = (sub) => {
  if (sub === 'channel') return 'bg-red-100 text-red-700';
  if (sub === 'desk') return 'bg-theme-100 text-theme-700';
  if (sub === 'notes') return 'bg-emerald-100 text-emerald-700';
  return 'bg-gray-200 text-gray-700';
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

const InlineAddSearch = ({ items, channels, desks, googleUserEmail, currentDeskId, currentLayout, onAdd }) => {
  const [query, setQuery] = useState('');
  const [open, setOpen] = useState(false);
  const [filter, setFilter] = useState('all');
  const [tagFilters, setTagFilters] = useState([]);
  const inputRef = useRef(null);

  const q = query.trim().toLowerCase();
  const normalizedUserEmail = String(googleUserEmail || '').trim().toLowerCase();

  const allRows = useMemo(() => {
    const inLayout = new Set(Object.keys(currentLayout));
    const rows = [];
    for (const item of items) {
      const key = itemEntryKey(item);
      if (inLayout.has(key)) continue;
      const itemOwner = String(item.ownerEmail || '').trim().toLowerCase();
      if (itemOwner && itemOwner !== normalizedUserEmail) continue;
      const label = (item.name || '').replace(/\.youtube$/i, '');
      rows.push({ key, label, sub: item.idbStore, tags: item.tags || [], lastVisitedAt: item.lastVisitedAt });
    }
    for (const ch of channels) {
      const key = channelEntryKey(ch);
      if (inLayout.has(key)) continue;
      const chOwner = String(ch.ownerEmail || '').trim().toLowerCase();
      if (chOwner && chOwner !== normalizedUserEmail) continue;
      rows.push({ key, label: ch.name || ch.handle || '', sub: 'channel', tags: ch.tags || [], lastVisitedAt: ch.lastVisitedAt });
    }
    for (const d of (desks || [])) {
      if (d.driveId === currentDeskId) continue;
      const key = deskEntryKey(d);
      if (inLayout.has(key)) continue;
      const deskOwner = String(d.ownerEmail || '').trim().toLowerCase();
      if (deskOwner && deskOwner !== normalizedUserEmail) continue;
      rows.push({ key, label: d.name || 'Untitled Desk', sub: 'desk', tags: d.tags || [], lastVisitedAt: d.lastVisitedAt });
    }
    rows.sort((a, b) => {
      const ta = a.lastVisitedAt ? new Date(a.lastVisitedAt).getTime() : 0;
      const tb = b.lastVisitedAt ? new Date(b.lastVisitedAt).getTime() : 0;
      return tb - ta;
    });
    return rows;
  }, [items, channels, desks, normalizedUserEmail, currentDeskId, currentLayout]);

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
      .filter((r) => tagFilters.every((t) => r.tags.some((rt) => rt.toLowerCase() === t)));
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
          background: 'rgb(var(--theme-50))', border: '1px solid #e5e7eb', borderRadius: 10,
          padding: '8px 32px 8px 12px', fontSize: 13, color: 'rgb(var(--theme-900))',
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
          background: 'rgb(var(--theme-50))', border: '1px solid #e5e7eb', borderRadius: 10,
          boxShadow: '0 8px 24px rgba(0,0,0,0.4)', zIndex: 50,
          width: 300,
        },
      },
      // Active tag filters
      tagFilters.length > 0 && React.createElement(
        'div',
        { style: { display: 'flex', flexWrap: 'wrap', gap: 4, padding: '8px 10px', borderBottom: '1px solid #e5e7eb' } },
        tagFilters.map((t) =>
          React.createElement(
            'button',
            {
              key: t,
              onMouseDown: (e) => { e.preventDefault(); removeTagFilter(t); },
              style: {
                display: 'flex', alignItems: 'center', gap: 3,
                padding: '2px 6px', borderRadius: 5, fontSize: 11, fontWeight: 600,
                background: 'rgb(var(--theme-100))', color: 'rgb(var(--theme-700))', border: '1px solid rgb(var(--theme-300))',
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
        { style: { padding: '6px 10px', borderBottom: '1px solid #e5e7eb' } },
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
                  background: 'rgb(var(--theme-100))', color: 'rgb(var(--theme-700))', border: '1px solid rgb(var(--theme-300))',
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
        { style: { display: 'flex', gap: 4, padding: '8px 8px', flexWrap: 'wrap', borderBottom: '1px solid #e5e7eb' } },
        visibleTabs.map(({ key, label }) =>
          React.createElement(
            'button',
            {
              key,
              onMouseDown: (e) => { e.preventDefault(); setFilter(key); },
              style: {
                padding: '3px 8px', borderRadius: 6, fontSize: 11, fontWeight: 600,
                cursor: 'pointer', border: 'none',
                background: filter === key ? 'rgb(var(--theme-600))' : '#e5e7eb',
                color: filter === key ? 'rgb(var(--theme-button-text))' : '#4b5563',
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
                    textAlign: 'left', color: 'rgb(var(--theme-900))', fontSize: 13, borderBottom: '1px solid #e5e7eb',
                  },
                  onMouseEnter: (e) => { e.currentTarget.style.background = '#f3f4f6'; },
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
                      { key: t, style: { fontSize: 10, color: 'rgb(var(--theme-700))', background: 'rgb(var(--theme-100))', borderRadius: 4, padding: '1px 4px' } },
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
const sectionId = () => `section-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

// Resize-handle configuration: which edge(s) each handle drags, and whether
// dragging it moves the section's left/top origin (vs. only its size).
const SECTION_RESIZE_HANDLES = [
  { id: 'nw', cursor: 'nwse-resize', hx: 0, hy: 0, growLeft: true, growTop: true },
  { id: 'n', cursor: 'ns-resize', hx: 0.5, hy: 0, growLeft: false, growTop: true },
  { id: 'ne', cursor: 'nesw-resize', hx: 1, hy: 0, growLeft: false, growTop: true },
  { id: 'e', cursor: 'ew-resize', hx: 1, hy: 0.5, growLeft: false, growTop: false },
  { id: 'se', cursor: 'nwse-resize', hx: 1, hy: 1, growLeft: false, growTop: false },
  { id: 's', cursor: 'ns-resize', hx: 0.5, hy: 1, growLeft: false, growTop: false },
  { id: 'sw', cursor: 'nesw-resize', hx: 0, hy: 1, growLeft: true, growTop: false },
  { id: 'w', cursor: 'ew-resize', hx: 0, hy: 0.5, growLeft: true, growTop: false },
];

export const Desk = ({
  desk,
  items,
  channels,
  desks,
  googleUserEmail,
  onSelectItem,
  onSelectChannel,
  onSelectDesk,
  onUpdateLayout,
  onMigrateDeskLayout,
  onUpdateConnections,
  onUpdateTextItems,
  onUpdateSections,
  onDeskModified,
  onRenameDesk,
  onSetTags,
  onSetSharedWith,
  canShareRecord,
  shareableEmails,
  onRenameItem,
  onRenameChannel,
  onSetNoteCoverImage,
  libraryImages,
  readOnly,
  role,
  onOpenNewNote,
  onOpenYoutube,
  onOpenChannel,
  onOpenFile,
  onOpenUrl,
  onSetItemDriveId,
  getBookByDriveId,
  onRequestDeleteItem,
  onRequestDeleteChannel,
  onCreateDesk,
  onPullMissingLayoutRefs,
  itemDownloadProgress,
}) => {
  const { uploadStatuses, handleUpload, handleChannelUpload } = useDriveTileUpload({
    onSetDriveId: onSetItemDriveId || (async () => {}),
    getRecordByDriveId: getBookByDriveId,
    scheduleShareAclReconcile: undefined,
  });

  const autoUploadTriggeredRef = useRef(new Set());
  const layoutSyncTriggeredRef = useRef(new Set());
  const previousDeskIdRef = useRef(desk?.driveId ?? null);

  const viewportRef = useRef(null);
  const historyRef = useRef({ past: [], future: [] });

  // Real, rendered card footprints (drag bar + content), keyed by layout key.
  // Connection routing uses these instead of the nominal CARD_W/CARD_H so
  // arrowheads land on the card's actual edge rather than partway into it.
  const cardSizeRef = useRef({});
  const cardResizeObserverRef = useRef(null);
  const sizeTickRafRef = useRef(null);
  const [sizeTick, setSizeTick] = useState(0);
  const scheduleSizeTick = useCallback(() => {
    if (sizeTickRafRef.current) return;
    sizeTickRafRef.current = requestAnimationFrame(() => {
      sizeTickRafRef.current = null;
      setSizeTick((n) => n + 1);
    });
  }, []);

  useEffect(() => {
    cardResizeObserverRef.current = new ResizeObserver((entries) => {
      let changed = false;
      for (const entry of entries) {
        const key = entry.target.getAttribute('data-desk-card-key');
        if (!key) continue;
        const { width, height } = entry.contentRect;
        const prev = cardSizeRef.current[key];
        if (!prev || Math.abs(prev.width - width) > 0.5 || Math.abs(prev.height - height) > 0.5) {
          cardSizeRef.current = { ...cardSizeRef.current, [key]: { width, height } };
          changed = true;
        }
      }
      if (changed) scheduleSizeTick();
    });
    return () => {
      cardResizeObserverRef.current?.disconnect();
      cardResizeObserverRef.current = null;
      if (sizeTickRafRef.current) cancelAnimationFrame(sizeTickRafRef.current);
    };
  }, [scheduleSizeTick]);

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
  const cloneSections = useCallback((sections) => {
    return (sections || []).map((s) => ({ ...s }));
  }, []);
  const snapshotState = useCallback(() => ({
    layout: cloneLayout(layoutRef.current),
    connections: cloneConnections(connectionsRef.current),
    sections: cloneSections(sectionsRef.current),
  }), [cloneConnections, cloneLayout, cloneSections]);
  useEffect(() => {
    // Reset undo/redo only when switching to a different desk.
    historyRef.current = { past: [], future: [] };
  }, [desk?.driveId]);

  // Text items on the canvas
  const textItemsRef = useRef(Array.isArray(desk?.textItems) ? desk.textItems : []);
  const textFontWheelTimerRef = useRef(null);
  // Holds the latest onTextItemFontWheel closure so the canvas-level native
  // wheel listener (registered once, below) can call into it without a
  // stale-closure/TDZ dance — assigned on every render, read only from events.
  const onTextItemFontWheelRef = useRef(null);

  // Sections: rounded-rect grouping containers. Membership is computed live
  // from layoutRef/textItemsRef, never persisted.
  const sectionsRef = useRef(Array.isArray(desk?.sections) ? desk.sections : []);
  const [selectedSectionIds, setSelectedSectionIds] = useState([]);
  const [editingSectionId, setEditingSectionId] = useState(null);
  const sectionDragRef = useRef(null);
  const sectionResizeRef = useRef(null);
  const sectionFontWheelTimerRef = useRef(null);
  // See onTextItemFontWheelRef above — same reason.
  const onSectionTitleWheelRef = useRef(null);

  useEffect(() => {
    // Sync refs when desk data changes; normalize layout keys in the same pass so
    // we never briefly apply a stale prop layout over a migrated ref.
    const nextDeskId = desk?.driveId ?? null;
    const deskChanged = previousDeskIdRef.current !== nextDeskId;
    previousDeskIdRef.current = nextDeskId;
    let layout = desk?.layout && typeof desk.layout === 'object' ? desk.layout : {};
    let connections = Array.isArray(desk?.connections) ? desk.connections : [];
    const migrated = normalizeDeskLayoutV11(layout, connections, items, channels, desks);
    if (migrated.changed && !readOnly && desk?.driveId != null) {
      layout = migrated.layout;
      connections = migrated.connections;
      layoutRef.current = layout;
      connectionsRef.current = connections;
      // Use the migration path (no localModifiedAt bump) when available; fall back to
      // the regular update only if the migration callback isn't wired up.
      if (onMigrateDeskLayout) {
        onMigrateDeskLayout(desk.driveId, layout, connections);
      } else {
        if (onUpdateLayout) onUpdateLayout(desk.driveId, layout);
        if (onUpdateConnections) onUpdateConnections(desk.driveId, connections);
      }
    } else {
      // Don't advance layoutRef to a desk.layout that has drive: keys which can't
      // yet be resolved — this happens in the brief window between loadDesks() and
      // loadItems() completing after setItemDriveId. Keep the current layoutRef so
      // the tile stays visible (pending-upload state) until items confirm the driveId.
      const hasUnresolvableDriveKey = Object.keys(layout).some(
        (k) => k.startsWith('drive:') && resolveLayoutEntry(k, items, channels, desks, layout[k])._entryType === 'pending'
      );
      // Always apply when switching desks. The unresolved-drive guard is only for
      // same-desk refreshes to avoid briefly hiding tiles during async loads.
      if (deskChanged || !hasUnresolvableDriveKey) layoutRef.current = layout;
      connectionsRef.current = connections;
    }
    textItemsRef.current = Array.isArray(desk?.textItems) ? desk.textItems : [];
    sectionsRef.current = Array.isArray(desk?.sections) ? desk.sections : [];
    rerender();
  }, [desk?.layout, desk?.connections, desk?.textItems, desk?.sections, items, channels, desks, readOnly, desk?.driveId, onUpdateLayout, onMigrateDeskLayout, onUpdateConnections, rerender]); // eslint-disable-line react-hooks/exhaustive-deps

  const commitLayout = useCallback((newLayout, options = {}) => {
    if (options.recordHistory !== false) {
      historyRef.current.past.push(snapshotState());
      historyRef.current.future = [];
    }
    layoutRef.current = newLayout;
    if (onUpdateLayout && desk?.driveId != null) onUpdateLayout(desk.driveId, newLayout);
    if (desk?.driveId != null) onDeskModified?.(desk.driveId);
    rerender();
  }, [onUpdateLayout, onDeskModified, desk?.driveId, rerender, snapshotState]);

  const commitConnections = useCallback((next, options = {}) => {
    if (options.recordHistory !== false) {
      historyRef.current.past.push(snapshotState());
      historyRef.current.future = [];
    }
    connectionsRef.current = Array.isArray(next) ? next : [];
    if (onUpdateConnections && desk?.driveId != null) onUpdateConnections(desk.driveId, connectionsRef.current);
    if (desk?.driveId != null) onDeskModified?.(desk.driveId);
    rerender();
  }, [onUpdateConnections, onDeskModified, desk?.driveId, rerender, snapshotState]);

  const commitTextItems = useCallback((next) => {
    textItemsRef.current = Array.isArray(next) ? next : [];
    if (onUpdateTextItems && desk?.driveId != null) onUpdateTextItems(desk.driveId, textItemsRef.current);
    if (desk?.driveId != null) onDeskModified?.(desk.driveId);
    rerender();
  }, [onUpdateTextItems, onDeskModified, desk?.driveId, rerender]);

  const commitSections = useCallback((next, options = {}) => {
    if (options.recordHistory !== false) {
      historyRef.current.past.push(snapshotState());
      historyRef.current.future = [];
    }
    sectionsRef.current = Array.isArray(next) ? next : [];
    if (onUpdateSections && desk?.driveId != null) onUpdateSections(desk.driveId, sectionsRef.current);
    if (desk?.driveId != null) onDeskModified?.(desk.driveId);
    rerender();
  }, [onUpdateSections, onDeskModified, desk?.driveId, rerender, snapshotState]);

  // Grow-only auto-expand: given the boxes of items that just moved (or were
  // placed), expand any section a box actually overlaps so it fully contains
  // it. A box that doesn't overlap a section at all leaves it untouched —
  // otherwise an item once inside could never be dragged back out, since the
  // section would just keep growing to re-engulf it wherever it went. Mutates
  // sectionsRef.current in place; never shrinks.
  const growSectionsForBoxes = useCallback((boxes) => {
    if (!boxes.length || !(sectionsRef.current || []).length) return false;
    let sections = sectionsRef.current;
    let changed = false;
    boxes.forEach((box) => {
      sections = sections.map((s) => {
        if (!boxesOverlap(box, sectionBoxFor(s))) return s;
        const grown = expandSectionToContain(s, box);
        if (grown !== s) changed = true;
        return grown;
      });
    });
    if (changed) sectionsRef.current = sections;
    return changed;
  }, []);

  const applyDeskState = useCallback((state) => {
    layoutRef.current = cloneLayout(state?.layout);
    connectionsRef.current = cloneConnections(state?.connections);
    sectionsRef.current = cloneSections(state?.sections);
    if (desk?.driveId != null) {
      if (onUpdateLayout) onUpdateLayout(desk.driveId, layoutRef.current);
      if (onUpdateConnections) onUpdateConnections(desk.driveId, connectionsRef.current);
      if (onUpdateSections) onUpdateSections(desk.driveId, sectionsRef.current);
      onDeskModified?.(desk.driveId);
    }
    rerender();
  }, [cloneConnections, cloneLayout, cloneSections, desk?.driveId, onUpdateConnections, onUpdateLayout, onUpdateSections, onDeskModified, rerender]);

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
  const [coverPickerTarget, setCoverPickerTarget] = useState(null);
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
  // id of whichever text item / section title is currently moused-over — the
  // small "16px" readout only renders while its owner is this value, so it
  // stays out of the way until the user is actually pointing at that text.
  const [hoveredFontTarget, setHoveredFontTarget] = useState(null);
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
      if ((key === 'backspace' || key === 'delete') && (selectedConnectionIds.length > 0 || selectedItemKeys.length > 0 || selectedTextIds.length > 0 || selectedSectionIds.length > 0)) {
        e.preventDefault();
        const selectedLineSet = new Set(selectedConnectionIds);
        const selectedItemSet = new Set(selectedItemKeys);
        const selectedTextSet = new Set(selectedTextIds);
        const selectedSectionSet = new Set(selectedSectionIds);
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
        if (selectedSectionSet.size > 0) {
          // Deletes only the section rectangle — contained items are never touched.
          const nextSections = (sectionsRef.current || []).filter((s) => !selectedSectionSet.has(s.id));
          commitSections(nextSections, { recordHistory: false });
        }
        setSelectedConnectionIds([]);
        setSelectedItemKeys([]);
        setSelectedTextIds([]);
        setSelectedNodeIds([]);
        setSelectedSectionIds([]);
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
  }, [commitConnections, commitLayout, commitTextItems, commitSections, connectMode, readOnly, redoDesk, selectedConnectionIds, selectedItemKeys, selectedTextIds, selectedSectionIds, slashMenu.open, undoDesk]);

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
      setSelectedSectionIds([]);
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
        setSelectedSectionIds([]);
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
      .map((item) => item.driveId);
    setSelectedTextIds(textIds);

    const sectionIds = (sectionsRef.current || [])
      .filter((s) => {
        const b = sectionBoxFor(s);
        return b.left <= ex && b.right >= sx && b.top <= ey && b.bottom >= sy;
      })
      .map((s) => s.id);
    setSelectedSectionIds(sectionIds);

    const connIds = (connectionsRef.current || [])
      .map((conn) => ({ conn, points: connectionPointsFor(conn, layoutRef.current || {}, cardSizeRef.current) }))
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
      const pts = connectionPointsFor(conn, layoutRef.current || {}, cardSizeRef.current);
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
  // A single native (non-passive) listener on the viewport handles all wheel
  // events for the canvas, including scroll-to-resize over a text item's
  // content or a section's title — routing has to happen here, in the one
  // listener that's guaranteed to see the event first, rather than via a
  // React onWheel further down the tree: this listener is attached directly
  // to an ancestor DOM node, so it always fires before React's synthetic
  // (root-delegated) dispatch would reach a descendant's onWheel handler.
  const onWheel = useCallback((e) => {
    const textTarget = e.target.closest?.('[data-text-font-id]');
    if (textTarget) {
      onTextItemFontWheelRef.current?.(e, textTarget.getAttribute('data-text-font-id'));
      return;
    }
    const sectionTarget = e.target.closest?.('[data-section-font-id]');
    if (sectionTarget) {
      onSectionTitleWheelRef.current?.(e, sectionTarget.getAttribute('data-section-font-id'));
      return;
    }
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
      startSections: sectionsRef.current,
    };
    setSelectedItemKeys(selected);
    setSelectedSectionIds([]);
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
      const moved = { x: snapToGrid(base.x + dx), y: snapToGrid(base.y + dy) };
      if (base.driveFileId) moved.driveFileId = base.driveFileId;
      nextLayout[k] = moved;
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
    const drag = itemDragRef.current;
    if (!drag || !drag.keys.includes(key)) return;
    // Auto-expand is evaluated once here, against the final dropped position —
    // not live during the drag — so a section only grows on drop, and never
    // visibly balloons out while the user is still mid-drag.
    const droppedBoxes = drag.keys.map((k) => cardBoxFor(layoutRef.current[k], cardSizeRef.current[k]));
    growSectionsForBoxes(droppedBoxes);
    // A click-to-select (pointerdown immediately followed by pointerup, no
    // intervening move) still reaches here. Only commit — and thus mark the
    // desk dirty / queue a Drive upload — when a position actually changed;
    // otherwise this fires on every plain click.
    const layoutMoved = drag.keys.some((k) => {
      const start = drag.startPositions[k] || { x: 0, y: 0 };
      const cur = layoutRef.current[k] || start;
      return cur.x !== start.x || cur.y !== start.y;
    });
    const sectionsGrew = sectionsRef.current !== drag.startSections;
    if (sectionsGrew) commitSections([...sectionsRef.current], { recordHistory: false });
    if (layoutMoved) commitLayout({ ...layoutRef.current });
    const textMoved = Array.isArray(drag.textIds) && drag.textIds.length > 0 && drag.textIds.some((id) => {
      const start = drag.startTextPositions[id];
      const cur = (textItemsRef.current || []).find((t) => t.id === id);
      return start && cur && (cur.x !== start.x || cur.y !== start.y);
    });
    if (textMoved) commitTextItems([...(textItemsRef.current || [])]);
    itemDragRef.current = null;
  }, [commitLayout, commitTextItems, commitSections, growSectionsForBoxes]);

  // --- Add item to desk ---
  const addItemToDesk = useCallback((key) => {
    const el = viewportRef.current;
    const w = el ? el.clientWidth : 800;
    const h = el ? el.clientHeight : 600;
    const centerX = (w / 2 - panRef.current.x) / zoomRef.current;
    const centerY = (h / 2 - panRef.current.y) / zoomRef.current;
    const offset = Object.keys(layoutRef.current).length * 20;
    const pos = { x: snapToGrid(centerX - CARD_W / 2 + offset % 200), y: snapToGrid(centerY - 150 + offset % 100) };
    const newLayout = { ...layoutRef.current, [key]: pos };
    if (growSectionsForBoxes([cardBoxFor(pos, cardSizeRef.current[key])])) {
      commitSections([...sectionsRef.current], { recordHistory: false });
    }
    commitLayout(newLayout);

    // Propagate desk's sharedWith to the newly added record
    const deskRecipients = Array.isArray(desk?.sharedWith) ? desk.sharedWith : [];
    if (deskRecipients.length > 0 && onSetSharedWith) {
      const entry = resolveLayoutEntry(key, items, channels, desks, layoutRef.current[key]);
      if (entry?._entryType && entry._entryType !== 'pending') {
        const storeName =
          entry._entryType === 'channel' ? 'channels'
          : entry._entryType === 'desk' ? 'desks'
          : (entry.idbStore || 'books');
        const current = Array.isArray(entry.sharedWith) ? entry.sharedWith : [];
        const merged = [...new Set([...current, ...deskRecipients])];
        if (merged.length > current.length) {
          onSetSharedWith(entry, storeName, merged).catch((e) => console.warn('[InfoDepo] auto-share on desk add failed:', e));
        }
      }
    }
  }, [commitLayout, commitSections, growSectionsForBoxes, desk, items, channels, desks, onSetSharedWith]);

  const handleCreateDesk = useCallback(async () => {
    if (!onCreateDesk) return;
    const id = await onCreateDesk('New Desk');
    if (id == null) return;
    addItemToDesk(deskEntryKey({ id }));
    // The new desk isn't in state yet when addItemToDesk runs resolveLayoutEntry,
    // so propagate desk recipients directly using the known id.
    const deskRecipients = Array.isArray(desk?.sharedWith) ? desk.sharedWith : [];
    if (deskRecipients.length > 0 && onSetSharedWith) {
      onSetSharedWith({ id }, 'desks', deskRecipients).catch((e) => console.warn('[InfoDepo] auto-share new nested desk failed:', e));
    }
  }, [onCreateDesk, addItemToDesk, desk, onSetSharedWith]);

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
    if (growSectionsForBoxes([estimateTextBounds(newItem)])) {
      commitSections([...sectionsRef.current], { recordHistory: false });
    }
    const next = [...(textItemsRef.current || []), newItem];
    commitTextItems(next);
    setEditingTextId(id);
    setSlashMenu((prev) => ({ ...prev, open: false }));
    setConnectMode(false);
    setConnectStartKey(null);
  }, [commitTextItems, commitSections, growSectionsForBoxes]);

  const addTextItemAtCenter = useCallback(() => {
    const el = viewportRef.current;
    const w = el ? el.clientWidth : 800;
    const h = el ? el.clientHeight : 600;
    const worldX = (w / 2 - panRef.current.x) / zoomRef.current;
    const worldY = (h / 2 - panRef.current.y) / zoomRef.current;
    const snapped = snapPoint({ x: worldX, y: worldY });
    const id = textItemId();
    const newItem = { id, text: '', x: snapped.x, y: snapped.y, fontSize: 16, width: 180, height: 40 };
    if (growSectionsForBoxes([estimateTextBounds(newItem)])) {
      commitSections([...sectionsRef.current], { recordHistory: false });
    }
    const next = [...(textItemsRef.current || []), newItem];
    commitTextItems(next);
    setEditingTextId(id);
    setSlashMenu((prev) => ({ ...prev, open: false }));
    setConnectMode(false);
    setConnectStartKey(null);
  }, [commitTextItems, commitSections, growSectionsForBoxes]);

  const updateTextItem = useCallback((id, updates) => {
    const next = (textItemsRef.current || []).map((t) =>
      t.id === id ? { ...t, ...updates } : t
    );
    commitTextItems(next);
  }, [commitTextItems]);

  // Scroll-to-resize while hovering the text item's own content area — mutates
  // the ref + rerenders immediately, then persists via a debounced commit once
  // scrolling settles, so rapid wheel ticks don't spam IndexedDB writes.
  const onTextItemFontWheel = useCallback((e, id) => {
    if (readOnly) return;
    e.preventDefault();
    e.stopPropagation();
    const current = (textItemsRef.current || []).find((t) => t.id === id);
    if (!current) return;
    const prevSize = current.fontSize || 16;
    const nextSize = Math.max(8, Math.min(96, prevSize + (e.deltaY < 0 ? 1 : -1)));
    if (nextSize === prevSize) return;
    textItemsRef.current = (textItemsRef.current || []).map((t) => (t.id === id ? { ...t, fontSize: nextSize } : t));
    rerender();
    clearTimeout(textFontWheelTimerRef.current);
    textFontWheelTimerRef.current = setTimeout(() => {
      commitTextItems([...(textItemsRef.current || [])]);
    }, 300);
  }, [readOnly, rerender, commitTextItems]);
  onTextItemFontWheelRef.current = onTextItemFontWheel;

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
      startSections: sectionsRef.current,
    };
    setSelectedTextIds(selected);
    setSelectedConnectionIds([]);
    setSelectedNodeIds([]);
    setSelectedSectionIds([]);
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
        const moved = { x: snapToGrid(base.x + dx), y: snapToGrid(base.y + dy) };
        if (base.driveFileId) moved.driveFileId = base.driveFileId;
        nextLayout[k] = moved;
      });
      layoutRef.current = nextLayout;
    }
    rerender();
  }, [pointerToWorld, rerender]);

  const onTextHandlePointerUp = useCallback((e, id) => {
    const drag = textItemDragRef.current;
    if (!drag || !drag.ids.includes(id)) return;
    // Auto-expand is evaluated once here, against the final dropped position —
    // not live during the drag — so a section only grows on drop.
    const droppedTextBoxes = (textItemsRef.current || []).filter((t) => drag.ids.includes(t.id)).map((t) => estimateTextBounds(t));
    if (Array.isArray(drag.itemKeys) && drag.itemKeys.length > 0) {
      drag.itemKeys.forEach((k) => droppedTextBoxes.push(cardBoxFor(layoutRef.current[k], cardSizeRef.current[k])));
    }
    growSectionsForBoxes(droppedTextBoxes);
    // Same no-op-click guard as onHandlePointerUp: only commit (and mark the
    // desk dirty) when something actually moved.
    const textMoved = drag.ids.some((tid) => {
      const start = drag.startPositions[tid];
      const cur = (textItemsRef.current || []).find((t) => t.id === tid);
      return start && cur && (cur.x !== start.x || cur.y !== start.y);
    });
    const sectionsGrew = sectionsRef.current !== drag.startSections;
    if (sectionsGrew) commitSections([...sectionsRef.current], { recordHistory: false });
    if (textMoved) commitTextItems([...(textItemsRef.current || [])]);
    const itemsMoved = Array.isArray(drag.itemKeys) && drag.itemKeys.length > 0 && drag.itemKeys.some((k) => {
      const start = drag.startItemPositions[k] || { x: 0, y: 0 };
      const cur = layoutRef.current[k] || start;
      return cur.x !== start.x || cur.y !== start.y;
    });
    if (itemsMoved) commitLayout({ ...layoutRef.current });
    textItemDragRef.current = null;
  }, [commitLayout, commitTextItems, commitSections, growSectionsForBoxes]);

  // --- Sections ---
  const addSectionAtCenter = useCallback(() => {
    const el = viewportRef.current;
    const w = el ? el.clientWidth : 800;
    const h = el ? el.clientHeight : 600;
    const worldX = (w / 2 - panRef.current.x) / zoomRef.current;
    const worldY = (h / 2 - panRef.current.y) / zoomRef.current;
    const defaultW = 400;
    const defaultH = 300;
    const snapped = snapPoint({ x: worldX - defaultW / 2, y: worldY - defaultH / 2 });
    const newSection = { id: sectionId(), x: snapped.x, y: snapped.y, width: defaultW, height: defaultH, label: 'Section' };
    commitSections([...(sectionsRef.current || []), newSection]);
    setEditingSectionId(newSection.id);
    setSelectedSectionIds([newSection.id]);
    setSlashMenu((prev) => ({ ...prev, open: false }));
    setConnectMode(false);
    setConnectStartKey(null);
  }, [commitSections]);

  const renameSection = useCallback((id, label) => {
    const next = (sectionsRef.current || []).map((s) => (s.id === id ? { ...s, label } : s));
    commitSections(next);
  }, [commitSections]);

  // Scroll-to-resize: mutates the ref + rerenders immediately for smooth
  // feedback, then persists via a debounced commit once scrolling settles
  // (mirrors the drag handles, which also commit once at the end of the
  // gesture rather than on every intermediate frame).
  const onSectionTitleWheel = useCallback((e, id) => {
    if (readOnly) return;
    e.preventDefault();
    e.stopPropagation();
    const current = (sectionsRef.current || []).find((s) => s.id === id);
    if (!current) return;
    const prevSize = current.fontSize || 12;
    const nextSize = Math.max(10, Math.min(100, prevSize + (e.deltaY < 0 ? 1 : -1)));
    if (nextSize === prevSize) return;
    sectionsRef.current = (sectionsRef.current || []).map((s) => (s.id === id ? { ...s, fontSize: nextSize } : s));
    rerender();
    clearTimeout(sectionFontWheelTimerRef.current);
    sectionFontWheelTimerRef.current = setTimeout(() => {
      commitSections([...(sectionsRef.current || [])], { recordHistory: false });
    }, 300);
  }, [readOnly, rerender, commitSections]);
  onSectionTitleWheelRef.current = onSectionTitleWheel;

  const deleteSection = useCallback((id) => {
    const next = (sectionsRef.current || []).filter((s) => s.id !== id);
    commitSections(next);
    if (editingSectionId === id) setEditingSectionId(null);
    setSelectedSectionIds((prev) => prev.filter((x) => x !== id));
  }, [commitSections, editingSectionId]);

  const onSectionHandlePointerDown = useCallback((e, id) => {
    e.stopPropagation();
    const world = pointerToWorld(e);
    const section = (sectionsRef.current || []).find((s) => s.id === id);
    if (!section) return;
    const sBox = sectionBoxFor(section);
    // Membership computed once, at drag-start — not re-evaluated mid-drag.
    const itemKeys = Object.entries(layoutRef.current || {})
      .filter(([k, pos]) => boxContainedIn(cardBoxFor(pos, cardSizeRef.current[k]), sBox))
      .map(([k]) => k);
    const textIds = (textItemsRef.current || [])
      .filter((t) => boxContainedIn(estimateTextBounds(t), sBox))
      .map((t) => t.id);
    // Other sections nested inside this one move along with it too. A flat
    // containment check against this section's box is enough even for
    // multiple levels of nesting — a section nested two levels deep is still
    // geometrically contained in the outermost one being dragged.
    const childSectionIds = (sectionsRef.current || [])
      .filter((other) => other.id !== id && boxContainedIn(sectionBoxFor(other), sBox))
      .map((other) => other.id);
    const startItemPositions = {};
    itemKeys.forEach((k) => { startItemPositions[k] = layoutRef.current[k] || { x: 0, y: 0 }; });
    const startTextPositions = {};
    textIds.forEach((tid) => {
      const t = (textItemsRef.current || []).find((x) => x.id === tid);
      if (t) startTextPositions[tid] = { x: t.x, y: t.y };
    });
    const startChildSectionPositions = {};
    childSectionIds.forEach((cid) => {
      const cs = (sectionsRef.current || []).find((x) => x.id === cid);
      if (cs) startChildSectionPositions[cid] = { x: cs.x, y: cs.y };
    });
    sectionDragRef.current = {
      id,
      startWorldX: world.x,
      startWorldY: world.y,
      startSection: { x: section.x, y: section.y },
      itemKeys,
      textIds,
      childSectionIds,
      startItemPositions,
      startTextPositions,
      startChildSectionPositions,
    };
    setSelectedSectionIds([id]);
    setSelectedItemKeys([]);
    setSelectedTextIds([]);
    setSelectedConnectionIds([]);
    setSelectedNodeIds([]);
    e.currentTarget.setPointerCapture(e.pointerId);
  }, [pointerToWorld]);

  const onSectionHandlePointerMove = useCallback((e, id) => {
    const drag = sectionDragRef.current;
    if (!drag || drag.id !== id) return;
    const world = pointerToWorld(e);
    const dx = world.x - drag.startWorldX;
    const dy = world.y - drag.startWorldY;
    const nextSections = (sectionsRef.current || []).map((s) => {
      if (s.id === id) return { ...s, x: snapToGrid(drag.startSection.x + dx), y: snapToGrid(drag.startSection.y + dy) };
      if (drag.childSectionIds.includes(s.id)) {
        const base = drag.startChildSectionPositions[s.id] || { x: s.x, y: s.y };
        return { ...s, x: snapToGrid(base.x + dx), y: snapToGrid(base.y + dy) };
      }
      return s;
    });
    sectionsRef.current = nextSections;
    if (drag.itemKeys.length > 0) {
      const nextLayout = { ...layoutRef.current };
      drag.itemKeys.forEach((k) => {
        const base = drag.startItemPositions[k] || { x: 0, y: 0 };
        const moved = { x: snapToGrid(base.x + dx), y: snapToGrid(base.y + dy) };
        if (base.driveFileId) moved.driveFileId = base.driveFileId;
        nextLayout[k] = moved;
      });
      layoutRef.current = nextLayout;
    }
    if (drag.textIds.length > 0) {
      const nextTexts = (textItemsRef.current || []).map((t) => {
        if (!drag.textIds.includes(t.id)) return t;
        const base = drag.startTextPositions[t.id] || { x: t.x, y: t.y };
        return { ...t, x: snapToGrid(base.x + dx), y: snapToGrid(base.y + dy) };
      });
      textItemsRef.current = nextTexts;
    }
    rerender();
  }, [pointerToWorld, rerender]);

  const onSectionHandlePointerUp = useCallback((e, id) => {
    const drag = sectionDragRef.current;
    if (!drag || drag.id !== id) return;
    const section = (sectionsRef.current || []).find((s) => s.id === id);
    const sectionMoved = !!section && (section.x !== drag.startSection.x || section.y !== drag.startSection.y);
    if (sectionMoved) commitSections([...sectionsRef.current], { recordHistory: false });
    if (drag.itemKeys.length > 0) commitLayout({ ...layoutRef.current });
    if (drag.textIds.length > 0) commitTextItems([...(textItemsRef.current || [])]);
    sectionDragRef.current = null;
  }, [commitLayout, commitTextItems, commitSections]);

  const onSectionResizePointerDown = useCallback((e, id, handleId) => {
    e.stopPropagation();
    e.preventDefault();
    const world = pointerToWorld(e);
    const section = (sectionsRef.current || []).find((s) => s.id === id);
    const handle = SECTION_RESIZE_HANDLES.find((h) => h.id === handleId);
    if (!section || !handle) return;
    sectionResizeRef.current = {
      id,
      handle,
      startWorldX: world.x,
      startWorldY: world.y,
      start: { x: section.x, y: section.y, width: section.width, height: section.height },
    };
    setSelectedSectionIds([id]);
    e.currentTarget.setPointerCapture(e.pointerId);
  }, [pointerToWorld]);

  const onSectionResizePointerMove = useCallback((e, id) => {
    const drag = sectionResizeRef.current;
    if (!drag || drag.id !== id) return;
    const world = pointerToWorld(e);
    const dx = world.x - drag.startWorldX;
    const dy = world.y - drag.startWorldY;
    const { start, handle } = drag;
    // Only the axis this handle actually controls gets touched — snapping (or
    // even re-writing) the other axis would silently drift it to the nearest
    // grid line on every drag, even though the user never moved that edge.
    const affectsX = handle.growLeft || handle.hx !== 0.5;
    const affectsY = handle.growTop || handle.hy !== 0.5;
    let x = start.x;
    let width = start.width;
    if (affectsX) {
      if (handle.growLeft) {
        width = Math.max(MIN_SECTION_W, start.width - dx);
        x = start.x + start.width - width;
      } else {
        width = Math.max(MIN_SECTION_W, start.width + dx);
      }
      x = snapToGrid(x);
      width = Math.max(MIN_SECTION_W, snapToGrid(width));
    }
    let y = start.y;
    let height = start.height;
    if (affectsY) {
      if (handle.growTop) {
        height = Math.max(MIN_SECTION_H, start.height - dy);
        y = start.y + start.height - height;
      } else {
        height = Math.max(MIN_SECTION_H, start.height + dy);
      }
      y = snapToGrid(y);
      height = Math.max(MIN_SECTION_H, snapToGrid(height));
    }
    const nextSections = (sectionsRef.current || []).map((s) =>
      s.id === id ? { ...s, x, y, width, height } : s
    );
    sectionsRef.current = nextSections;
    rerender();
  }, [pointerToWorld, rerender]);

  const onSectionResizePointerUp = useCallback((e, id) => {
    const drag = sectionResizeRef.current;
    if (!drag || drag.id !== id) return;
    const section = (sectionsRef.current || []).find((s) => s.id === id);
    const resized = !!section && (
      section.x !== drag.start.x || section.y !== drag.start.y ||
      section.width !== drag.start.width || section.height !== drag.start.height
    );
    if (resized) commitSections([...sectionsRef.current]);
    sectionResizeRef.current = null;
  }, [commitSections]);

  const { x: panX, y: panY } = panRef.current;
  const zoom = zoomRef.current;
  const isPanning = !!panningRef.current;

  const layoutEntries = useMemo(() => {
    const layout = layoutRef.current;
    return Object.entries(layout).map(([key, pos]) => {
      const entry = resolveLayoutEntry(key, items, channels, desks, pos);
      return { key, pos, entry };
    });
  }, [renderTick, items, channels, desks]); // eslint-disable-line react-hooks/exhaustive-deps

  // Attach the size observer to any card DOM node not already tracked (new
  // items dropped on the desk, or ones that just re-mounted).
  useEffect(() => {
    const observer = cardResizeObserverRef.current;
    const root = viewportRef.current;
    if (!observer || !root) return;
    root.querySelectorAll('[data-desk-card-key]').forEach((el) => observer.observe(el));
  }, [layoutEntries]);

  // Pull layout tiles that reference real Drive ids not yet in IndexedDB.
  useEffect(() => {
    if (readOnly || !onPullMissingLayoutRefs || !desk?.driveId) return;
    const syncKeys = layoutEntries
      .filter(({ entry }) => entry._entryType === 'pending' && entry._pendingKind === 'sync')
      .map(({ key }) => key)
      .sort()
      .join('|');
    if (!syncKeys) return;
    const sig = `${desk.driveId}:${syncKeys}`;
    if (layoutSyncTriggeredRef.current.has(sig)) return;
    layoutSyncTriggeredRef.current.add(sig);
    onPullMissingLayoutRefs(desk).catch((e) => {
      layoutSyncTriggeredRef.current.delete(sig);
      console.warn('[InfoDepo] desk layout sync failed:', e?.message || e);
    });
  }, [layoutEntries, desk, onPullMissingLayoutRefs, readOnly]);

  useEffect(() => {
    layoutSyncTriggeredRef.current.clear();
  }, [desk?.driveId]);

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
    return connectionPointsFor(conn, layoutRef.current || {}, cardSizeRef.current);
  }, []);

  const visibleConnections = useMemo(() => {
    const keys = new Set(Object.keys(layoutRef.current || {}));
    return (connectionsRef.current || [])
      .filter((conn) => keys.has(conn.fromKey) && keys.has(conn.toKey) && conn.fromKey !== conn.toKey)
      .map((conn) => ({ conn, points: routePointsFor(conn) }))
      .filter((row) => row.points && row.points.length >= 2);
  }, [renderTick, sizeTick, routePointsFor]);

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
    const drag = lineDragRef.current;
    if (!drag) return;
    // Same no-op-click guard: only commit when a handle's point actually moved.
    const moved = (drag.activeHandles || []).some((h) => {
      const conn = (connectionsRef.current || []).find((c) => c.id === h.connId);
      const points = conn?.route?.mode === 'manual' && Array.isArray(conn.route.points) ? conn.route.points : [];
      const cur = points[h.handleIndex];
      return cur && (cur.x !== h.initialPoint.x || cur.y !== h.initialPoint.y);
    });
    if (moved) commitConnections([...(connectionsRef.current || [])]);
    lineDragRef.current = null;
  }, [commitConnections]);

  return React.createElement(
    React.Fragment,
    null,
    coverPickerTarget && React.createElement(CoverImagePickerModal, {
      images: (libraryImages || []).filter((i) => i.data instanceof Blob),
      onClose: () => setCoverPickerTarget(null),
      onSelect: async (imageItem) => {
        const target = coverPickerTarget;
        setCoverPickerTarget(null);
        if (!onSetNoteCoverImage || !target) return;
        try {
          const file = new File([imageItem.data], imageItem.name, { type: imageItem.type });
          await onSetNoteCoverImage(target, file);
        } catch (err) {
          window.alert(err?.message || 'Could not set cover image.');
        }
      },
    }),
    React.createElement(
    'div',
    {
      ref: viewportRef,
      className: 'flex-1 min-h-0 w-full',
      style: {
        position: 'relative', overflow: 'hidden',
        background: 'rgb(var(--theme-100))',
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
        border: '1px dashed rgb(var(--theme-500))',
        background: 'rgb(var(--theme-500) / 0.12)',
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
      // Sections — rendered first so they paint behind items/text/connections.
      (sectionsRef.current || []).map((s) =>
        React.createElement(
          'div',
          {
            key: s.id,
            style: {
              position: 'absolute',
              left: s.x,
              top: s.y,
              width: s.width,
              height: s.height,
              background: 'rgb(var(--theme-900) / 0.08)',
              border: selectedSectionIds.includes(s.id) ? '2px solid rgb(var(--theme-500))' : '1px solid rgb(var(--theme-900) / 0.12)',
              borderRadius: 14,
              pointerEvents: 'none',
            },
          },
          // Header strip: label + group-drag handle
          React.createElement(
            'div',
            {
              style: {
                position: 'absolute', top: 0, left: 0, right: 0, height: Math.max(SECTION_HEADER_H, (s.fontSize || 12) + 10),
                display: 'flex', alignItems: 'center', padding: '0 8px',
                cursor: readOnly ? 'default' : 'grab', pointerEvents: 'auto', touchAction: 'none',
              },
              onClick: (e) => {
                e.stopPropagation();
                setSelectedSectionIds([s.id]);
                setSelectedItemKeys([]);
                setSelectedTextIds([]);
                setSelectedConnectionIds([]);
                setSelectedNodeIds([]);
              },
              onPointerDown: readOnly ? undefined : (e) => onSectionHandlePointerDown(e, s.id),
              onPointerMove: readOnly ? undefined : (e) => onSectionHandlePointerMove(e, s.id),
              onPointerUp: readOnly ? undefined : (e) => onSectionHandlePointerUp(e, s.id),
              // Picked up by the canvas-level native wheel listener (see onWheel
              // above) — a React onWheel prop here would fire too late, after
              // that ancestor listener has already handled the event as a zoom.
              'data-section-font-id': readOnly ? undefined : s.id,
              title: readOnly ? undefined : 'Scroll to resize title',
              onMouseEnter: readOnly ? undefined : () => setHoveredFontTarget(s.id),
              onMouseLeave: readOnly ? undefined : () => setHoveredFontTarget((cur) => (cur === s.id ? null : cur)),
            },
            editingSectionId === s.id
              ? React.createElement('input', {
                  autoFocus: true,
                  value: s.label || '',
                  onClick: (e) => e.stopPropagation(),
                  onPointerDown: (e) => e.stopPropagation(),
                  onChange: (e) => {
                    sectionsRef.current = (sectionsRef.current || []).map((x) => x.id === s.id ? { ...x, label: e.target.value } : x);
                    rerender();
                  },
                  onBlur: () => {
                    renameSection(s.id, (sectionsRef.current || []).find((x) => x.id === s.id)?.label || '');
                    setEditingSectionId(null);
                  },
                  onKeyDown: (e) => {
                    if (e.key === 'Enter') e.currentTarget.blur();
                    if (e.key === 'Escape') setEditingSectionId(null);
                  },
                  style: {
                    fontSize: s.fontSize || 12, fontWeight: 600, background: 'transparent', border: 'none', outline: 'none',
                    color: 'rgb(var(--theme-900))', width: '100%',
                  },
                })
              : React.createElement(
                  'span',
                  {
                    onClick: (e) => { e.stopPropagation(); if (!readOnly) setEditingSectionId(s.id); },
                    onPointerDown: (e) => e.stopPropagation(),
                    style: { fontSize: s.fontSize || 12, fontWeight: 600, color: 'rgb(var(--theme-900))', cursor: readOnly ? 'default' : 'text', userSelect: 'none' },
                    title: readOnly ? undefined : 'Click to rename (scroll to resize)',
                  },
                  s.label || 'Section'
                ),
            !readOnly && hoveredFontTarget === s.id && React.createElement(
              'span',
              {
                style: {
                  fontSize: 10, color: '#6b7280', padding: '0 3px', marginLeft: 6,
                  flexShrink: 0, userSelect: 'none', pointerEvents: 'none',
                },
              },
              `${s.fontSize || 12}px`
            ),
            !readOnly && React.createElement(
              'button',
              {
                onClick: (e) => { e.stopPropagation(); deleteSection(s.id); },
                onPointerDown: (e) => e.stopPropagation(),
                style: { color: '#6b7280', cursor: 'pointer', fontSize: 14, lineHeight: 1, background: 'none', border: 'none', padding: '0 2px', marginLeft: 4 },
                title: 'Remove section',
              },
              '×'
            )
          ),
          // Resize handles: corners are small squares; edges are full-length
          // strips along that side (not just a point at the midpoint) so the
          // whole border is grabbable, not only the four corners.
          !readOnly && SECTION_RESIZE_HANDLES.map((h) => {
            const isEdge = h.hx === 0.5 || h.hy === 0.5;
            const CORNER = 14;
            const THICKNESS = 10;
            const MARGIN = CORNER / 2;
            let style;
            if (h.hx === 0.5) {
              // 'n' / 's' — horizontal strip spanning the width between the corners.
              style = {
                left: MARGIN, width: Math.max(0, s.width - MARGIN * 2), height: THICKNESS,
                top: h.hy === 0 ? -THICKNESS / 2 : s.height - THICKNESS / 2,
              };
            } else if (h.hy === 0.5) {
              // 'e' / 'w' — vertical strip spanning the height between the corners.
              style = {
                top: MARGIN, height: Math.max(0, s.height - MARGIN * 2), width: THICKNESS,
                left: h.hx === 0 ? -THICKNESS / 2 : s.width - THICKNESS / 2,
              };
            } else {
              // corner
              style = {
                width: CORNER, height: CORNER,
                left: h.hx * s.width - CORNER / 2,
                top: h.hy * s.height - CORNER / 2,
              };
            }
            return React.createElement('div', {
              key: h.id,
              style: {
                position: 'absolute',
                ...style,
                cursor: h.cursor,
                pointerEvents: 'auto',
                touchAction: 'none',
                zIndex: isEdge ? 1 : 2,
              },
              onPointerDown: (e) => onSectionResizePointerDown(e, s.id, h.id),
              onPointerMove: (e) => onSectionResizePointerMove(e, s.id),
              onPointerUp: (e) => onSectionResizePointerUp(e, s.id),
            });
          })
        )
      ),
      layoutEntries
        .filter(({ entry }) => !(entry._entryType === 'pending' && entry._pendingKind === 'upload'))
        .map(({ key, pos, entry }) =>
        React.createElement(
          'div',
          {
            key,
            'data-desk-card-key': key,
            style: {
              position: 'absolute',
              left: pos.x,
              top: pos.y,
              width: CARD_W,
              userSelect: 'none',
              outline: selectedItemKeys.includes(key) ? '2px solid #7c3aed' : 'none',
              outlineOffset: 2,
              borderRadius: 10,
            },
            onClick: (e) => {
              setSelectedConnectionIds([]);
              setSelectedNodeIds([]);
              setSelectedTextIds([]);
              setSelectedSectionIds([]);
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
                height: DRAG_BAR_H, background: 'rgb(var(--theme-50))', borderRadius: '8px 8px 0 0',
                border: '1px solid #e5e7eb', borderBottom: 'none',
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
                outline: connectMode && connectStartKey === key ? '2px solid rgb(var(--theme-600))' : 'none',
              },
            },
            entry._entryType === 'pending'
              ? (() => {
                  const kind = entry._pendingKind || 'unknown';
                  const isSync = kind === 'sync';
                  const statusLabel = isSync
                    ? 'Syncing from Drive…'
                    : 'Not available on this device';
                  const showSpinner = isSync;
                  return React.createElement(
                    'div',
                    {
                      style: {
                        width: CARD_W,
                        height: CARD_H,
                        display: 'flex',
                        flexDirection: 'column',
                        alignItems: 'center',
                        justifyContent: 'center',
                        gap: 8,
                        background: 'rgb(var(--theme-50))',
                        borderRadius: readOnly ? 8 : '0 0 8px 8px',
                        border: '1px dashed #d1d5db',
                        color: '#6b7280',
                      },
                    },
                    showSpinner && React.createElement(
                      'svg',
                      {
                        className: 'animate-spin',
                        style: { width: 28, height: 28, flexShrink: 0 },
                        viewBox: '0 0 24 24',
                        fill: 'none',
                      },
                      React.createElement('circle', { cx: 12, cy: 12, r: 10, stroke: '#e5e7eb', strokeWidth: 3 }),
                      React.createElement('path', {
                        d: 'M12 2a10 10 0 0 1 10 10',
                        stroke: 'rgb(var(--theme-600))',
                        strokeWidth: 3,
                        strokeLinecap: 'round',
                      }),
                    ),
                    React.createElement(
                      'span',
                      { style: { fontSize: 11, color: '#6b7280', textAlign: 'center', padding: '0 16px' } },
                      statusLabel,
                    ),
                  );
                })()
              : entry._entryType === 'item'
              ? React.createElement(DataTile, {
                  tileType: 'item',
                  item: entry,
                  onSelect: onSelectItem,
                  readOnly,
                  onDelete: !readOnly && onRequestDeleteItem ? onRequestDeleteItem : undefined,
                  onUpload: !readOnly && onSetItemDriveId ? handleUpload : undefined,
                  uploadStatus: uploadStatuses[libraryItemKey(entry)] ?? null,
                  onSetTags: onSetTags ? (v, tags) => onSetTags(v, v.idbStore, tags) : undefined,
                  onSetSharedWith: onSetSharedWith ? (v, emails) => onSetSharedWith(v, v.idbStore, emails) : undefined,
                  canShare: typeof canShareRecord === 'function' ? canShareRecord(entry) : !readOnly,
                  shareableEmails: shareableEmails || [],
                  onRename: onRenameItem ? (v, name) => onRenameItem(v, v.idbStore, name) : undefined,
                  onSetNoteCoverImage: onSetNoteCoverImage,
                  onSetCoverFromLibrary: !readOnly ? (v) => setCoverPickerTarget(v) : undefined,
                  availableTags,
                  itemDownloadProgress,
                })
              : entry._entryType === 'channel'
              ? React.createElement(DataTile, {
                  tileType: 'channel',
                  channel: entry,
                  onSelect: onSelectChannel,
                  readOnly,
                  onDelete: !readOnly && onRequestDeleteChannel ? onRequestDeleteChannel : undefined,
                  onUpload: !readOnly && onSetItemDriveId ? handleChannelUpload : undefined,
                  uploadStatus: uploadStatuses[channelUploadKey(entry)] ?? null,
                  onSetTags: onSetTags ? (c, tags) => onSetTags(c, 'channels', tags) : undefined,
                  onSetSharedWith: onSetSharedWith ? (c, emails) => onSetSharedWith(c, 'channels', emails) : undefined,
                  canShare: typeof canShareRecord === 'function' ? canShareRecord(entry) : !readOnly,
                  shareableEmails: shareableEmails || [],
                  onRename: onRenameChannel ? (c, name) => onRenameChannel(c, 'channels', name) : undefined,
                  availableTags,
                })
              : React.createElement(DataTile, { tileType: 'desk', desk: entry, onSelect: onSelectDesk, readOnly: true })
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
              setSelectedSectionIds([]);
            },
            onMouseEnter: readOnly ? undefined : () => setHoveredFontTarget(ti.id),
            onMouseLeave: readOnly ? undefined : () => setHoveredFontTarget((cur) => (cur === ti.id ? null : cur)),
          },
          // Drag handle
          !readOnly && React.createElement(
            'div',
            {
              style: {
                height: 18, display: 'flex', alignItems: 'center', justifyContent: 'space-between',
                padding: '0 4px', cursor: 'grab', color: '#4b5563', fontSize: 10,
                background: editingTextId === ti.id ? 'rgb(var(--theme-50))' : 'transparent',
                borderRadius: '6px 6px 0 0',
                border: editingTextId === ti.id ? '1px solid #e5e7eb' : 'none',
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
              // Font size button — only shown while hovering the item (or while
              // its own preset menu is open, so the toggle stays reachable).
              (hoveredFontTarget === ti.id || textFontSizeMenu === ti.id) && React.createElement(
                'button',
                {
                  onClick: (e) => { e.stopPropagation(); setTextFontSizeMenu(textFontSizeMenu === ti.id ? null : ti.id); },
                  style: {
                    background: 'none', border: 'none', cursor: 'pointer',
                    color: '#6b7280', fontSize: 10, padding: '0 3px',
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
                background: 'rgb(var(--theme-50))', border: '1px solid #e5e7eb', borderRadius: 8,
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
                    background: (ti.fontSize || 16) === sz ? 'rgb(var(--theme-600))' : '#e5e7eb',
                    color: (ti.fontSize || 16) === sz ? 'rgb(var(--theme-button-text))' : '#4b5563',
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
                // Picked up by the canvas-level native wheel listener (see
                // onWheel above) rather than handled here directly.
                'data-text-font-id': readOnly ? undefined : ti.id,
                title: readOnly ? undefined : 'Scroll to resize text',
                style: {
                  background: 'rgb(var(--theme-100))',
                  border: selectedTextIds.includes(ti.id) ? '2px solid #7c3aed' : '1px solid rgb(var(--theme-600))',
                  borderRadius: 6,
                  padding: '4px 8px', fontSize: ti.fontSize || 16, color: 'rgb(var(--theme-900))',
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
                  // Picked up by the canvas-level native wheel listener (see
                  // onWheel above) rather than handled here directly.
                  'data-text-font-id': readOnly ? undefined : ti.id,
                  title: readOnly ? undefined : 'Double-click to edit (scroll to resize)',
                  style: {
                    fontSize: ti.fontSize || 16, color: 'rgb(var(--theme-900))', whiteSpace: 'pre-wrap',
                    cursor: readOnly ? 'default' : 'text', padding: '4px 8px',
                    minWidth: 40, minHeight: (ti.fontSize || 16) + 8,
                    width: Math.max(40, Number(ti.width) || 180),
                    height: Math.max((ti.fontSize || 16) + 8, Number(ti.height) || 40),
                    borderRadius: 4,
                    border: selectedTextIds.includes(ti.id) ? '2px solid #7c3aed' : '1px solid transparent',
                    lineHeight: 1.4,
                    boxSizing: 'border-box',
                    overflow: 'hidden',
                  },
                  onMouseEnter: (e) => { if (!readOnly) e.currentTarget.style.border = '1px dashed #9ca3af'; },
                  onMouseLeave: (e) => { e.currentTarget.style.border = '1px solid transparent'; },
                },
                ti.text || (readOnly ? '' : 'Double-click to edit')
              )
        )
      ),
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
            React.createElement('path', { d: 'M0,0 L0,6 L7,3 z', fill: 'rgb(var(--theme-700))' })
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
            React.createElement('path', { d: 'M0,0 L0,6 L7,3 z', fill: 'rgb(var(--theme-900))' })
          )
        ),
        visibleConnections.map(({ conn, points }) =>
          React.createElement(
            'g',
            { key: conn.id },
            React.createElement('path', {
              d: pointsToPath(points),
              stroke: selectedConnectionIds.includes(conn.id) ? 'rgb(var(--theme-900))' : 'rgb(var(--theme-700))',
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
                fill: selectedNodeIds.includes(`${conn.id}:${idx}`) ? 'rgb(var(--theme-700))' : 'rgb(var(--theme-100))',
                stroke: selectedNodeIds.includes(`${conn.id}:${idx}`) ? 'rgb(var(--theme-900))' : 'rgb(var(--theme-700))',
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
              stroke: 'rgb(var(--theme-700))',
              strokeWidth: 2,
              style: { pointerEvents: 'none' },
            }),
            React.createElement('circle', {
              cx: points[points.length - 1].x,
              cy: points[points.length - 1].y,
              r: 5.5,
              fill: '#1e293b',
              stroke: 'rgb(var(--theme-700))',
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
        currentDeskId: desk?.driveId,
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
        googleUserEmail,
        currentDeskId: desk?.driveId,
        currentLayout: layoutRef.current,
        onAdd: addItemToDesk,
      }),
      role !== 'viewer' && React.createElement(
        'button',
        {
          onClick: addTextItemAtCenter,
          title: 'Add text (T)',
          style: {
            background: 'rgb(var(--theme-50))', border: '1px solid #e5e7eb', borderRadius: 10,
            padding: '7px 12px', fontSize: 13, color: 'rgb(var(--theme-900))',
            cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 5,
            touchAction: 'manipulation',
          },
          onMouseEnter: (e) => { e.currentTarget.style.background = 'rgb(var(--theme-100))'; },
          onMouseLeave: (e) => { e.currentTarget.style.background = 'rgb(var(--theme-50))'; },
        },
        React.createElement(
          'svg', { xmlns: 'http://www.w3.org/2000/svg', width: 14, height: 14, fill: 'none', viewBox: '0 0 24 24', stroke: 'currentColor', strokeWidth: 2.5 },
          React.createElement('path', { strokeLinecap: 'round', strokeLinejoin: 'round', d: 'M3 5h18M12 5v14' })
        ),
        'Text'
      ),
      role !== 'viewer' && (onOpenNewNote || onOpenFile || onCreateDesk) && React.createElement(AddContentDropdown, {
        onNewNote: onOpenNewNote,
        onAddYoutube: onOpenYoutube,
        onAddChannel: onOpenChannel,
        onAddFile: onOpenFile,
        onAddUrl: onOpenUrl,
        onAddDesk: onCreateDesk ? handleCreateDesk : undefined,
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
          background: 'rgb(var(--theme-50))',
          border: '1px solid #e5e7eb',
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
            border: '1px solid #e5e7eb', borderRadius: 8, background: 'rgb(var(--theme-100))',
            color: 'rgb(var(--theme-900))', padding: '8px 10px', fontSize: 13, cursor: 'pointer',
            marginBottom: 8, textAlign: 'left',
          },
          onMouseEnter: (e) => { e.currentTarget.style.background = 'rgb(var(--theme-200))'; },
          onMouseLeave: (e) => { e.currentTarget.style.background = 'rgb(var(--theme-100))'; },
        },
        React.createElement(
          'svg', { xmlns: 'http://www.w3.org/2000/svg', width: 14, height: 14, fill: 'none', viewBox: '0 0 24 24', stroke: 'currentColor', strokeWidth: 2 },
          React.createElement('path', { strokeLinecap: 'round', strokeLinejoin: 'round', d: 'M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-7-10h6m-3 0v12' })
        ),
        'Text'
      ),
      // New section option
      React.createElement(
        'button',
        {
          onClick: addSectionAtCenter,
          style: {
            width: '100%', display: 'flex', alignItems: 'center', gap: 8,
            border: '1px solid #e5e7eb', borderRadius: 8, background: 'rgb(var(--theme-100))',
            color: 'rgb(var(--theme-900))', padding: '8px 10px', fontSize: 13, cursor: 'pointer',
            marginBottom: 8, textAlign: 'left',
          },
          onMouseEnter: (e) => { e.currentTarget.style.background = 'rgb(var(--theme-200))'; },
          onMouseLeave: (e) => { e.currentTarget.style.background = 'rgb(var(--theme-100))'; },
        },
        React.createElement(
          'svg', { xmlns: 'http://www.w3.org/2000/svg', width: 14, height: 14, fill: 'none', viewBox: '0 0 24 24', stroke: 'currentColor', strokeWidth: 2 },
          React.createElement('rect', { x: 3, y: 5, width: 18, height: 14, rx: 3 })
        ),
        'Section'
      ),
      // Connections section
      React.createElement('p', { style: { color: '#6b7280', fontSize: 11, marginBottom: 8, textTransform: 'uppercase', letterSpacing: '0.05em' } }, 'Connections'),
      React.createElement('p', { style: { color: 'rgb(var(--theme-700))', fontSize: 11, lineHeight: 1.5, marginBottom: 8 } }, 'Line edit mode is active. Press "/" again to exit.'),
      connectMode && React.createElement('p', { style: { color: 'rgb(var(--theme-700))', fontSize: 11, lineHeight: 1.5, marginBottom: 8 } }, connectStartKey ? 'Select the second item to complete line.' : 'Click first item, then second item.'),
      connectMode && connectStartKey && React.createElement(
        'button',
        {
          onClick: () => {
            setConnectStartKey(null);
            setSlashMenu((prev) => ({ ...prev, open: false }));
          },
          style: {
            width: '100%',
            border: '1px solid #e5e7eb',
            borderRadius: 8,
            background: 'rgb(var(--theme-100))',
            color: '#6b7280',
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
          position: 'absolute', bottom: 16, left: 16, zIndex: 30, background: 'rgb(var(--theme-50))',
          border: '1px solid #e5e7eb', borderRadius: 8, padding: '4px 10px',
          color: '#6b7280', fontSize: 12, fontFamily: 'monospace', pointerEvents: 'none',
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
        React.createElement('span', { style: { color: 'rgb(var(--theme-700))', fontWeight: 600 } }, '+ Add Content'),
        ' (top-right) to place items here.'
      )
    )
    ) // close viewport div
  ); // close Fragment
};

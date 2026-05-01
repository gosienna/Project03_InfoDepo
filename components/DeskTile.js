
import React, { useState, useRef, useEffect } from 'react';
import { TrashIcon } from './icons/TrashIcon.js';

const TILE_SHELL =
  'bg-gray-800 rounded-lg shadow-lg overflow-hidden cursor-pointer w-full group transition-all duration-300 transform hover:-translate-y-1 hover:shadow-indigo-500/30';

export const DeskTile = ({ desk, onSelect, onDelete, onRename, readOnly }) => {
  const [isEditingName, setIsEditingName] = useState(false);
  const [nameInput, setNameInput] = useState('');
  const [isSavingName, setIsSavingName] = useState(false);
  const nameInputRef = useRef(null);

  const itemCount = Object.keys(desk?.layout || {}).length;

  useEffect(() => {
    if (isEditingName && nameInputRef.current) {
      nameInputRef.current.focus();
      nameInputRef.current.select();
    }
  }, [isEditingName]);

  const beginRename = (e) => {
    e.stopPropagation();
    if (readOnly || !onRename) return;
    setNameInput(desk.name || '');
    setIsEditingName(true);
  };

  const cancelRename = (e) => {
    e?.stopPropagation?.();
    setIsEditingName(false);
    setNameInput('');
  };

  const commitRename = async (e) => {
    e?.stopPropagation?.();
    if (!onRename || isSavingName) return;
    const trimmed = String(nameInput || '').trim();
    if (!trimmed || trimmed === String(desk.name || '').trim()) { setIsEditingName(false); return; }
    setIsSavingName(true);
    try {
      await onRename(desk, trimmed);
      setIsEditingName(false);
      setNameInput('');
    } catch (err) {
      window.alert(err?.message || 'Could not rename desk.');
    } finally {
      setIsSavingName(false);
    }
  };

  const handleDelete = (e) => {
    e.stopPropagation();
    if (onDelete) onDelete(desk);
  };

  return React.createElement(
    'div',
    { className: TILE_SHELL, onClick: () => onSelect(desk) },
    // Hero
    React.createElement(
      'div',
      { className: 'relative p-4 bg-gray-700 h-40 flex items-center justify-center overflow-hidden' },
      // Background pattern
      React.createElement(
        'svg',
        { className: 'absolute inset-0 w-full h-full opacity-10', xmlns: 'http://www.w3.org/2000/svg' },
        React.createElement('defs', null,
          React.createElement('pattern', { id: `grid-${desk.id}`, x: 0, y: 0, width: 20, height: 20, patternUnits: 'userSpaceOnUse' },
            React.createElement('circle', { cx: 0, cy: 0, r: 1, fill: '#818cf8' })
          )
        ),
        React.createElement('rect', { width: '100%', height: '100%', fill: `url(#grid-${desk.id})` })
      ),
      // Desk icon
      React.createElement(
        'svg',
        { xmlns: 'http://www.w3.org/2000/svg', className: 'h-16 w-16 text-indigo-400/70 group-hover:text-indigo-400 transition-colors duration-300', fill: 'none', viewBox: '0 0 24 24', stroke: 'currentColor' },
        React.createElement('path', { strokeLinecap: 'round', strokeLinejoin: 'round', strokeWidth: 1.5, d: 'M4 5a1 1 0 011-1h4a1 1 0 011 1v4a1 1 0 01-1 1H5a1 1 0 01-1-1V5zM14 5a1 1 0 011-1h4a1 1 0 011 1v4a1 1 0 01-1 1h-4a1 1 0 01-1-1V5zM4 15a1 1 0 011-1h4a1 1 0 011 1v4a1 1 0 01-1 1H5a1 1 0 01-1-1v-4zM14 15a1 1 0 011-1h4a1 1 0 011 1v4a1 1 0 01-1 1h-4a1 1 0 01-1-1v-4z' })
      ),
      // "Desk" badge
      React.createElement(
        'span',
        { className: 'absolute top-2 right-2 bg-indigo-600 text-white text-xs font-bold px-2 py-1 rounded' },
        'Desk'
      ),
      // Delete button
      !readOnly && onDelete && React.createElement(
        'button',
        {
          type: 'button',
          onClick: handleDelete,
          className: 'absolute bottom-2 right-2 p-2 rounded-full bg-red-600/50 text-white opacity-0 group-hover:opacity-100 hover:bg-red-600 transition-all duration-300',
          title: 'Remove desk',
        },
        React.createElement(TrashIcon, { className: 'h-4 w-4' })
      )
    ),
    // Body
    React.createElement(
      'div',
      { className: 'p-4' },
      React.createElement(
        'div',
        { className: 'flex items-start gap-2', onClick: (e) => e.stopPropagation() },
        isEditingName
          ? React.createElement('input', {
              ref: nameInputRef,
              type: 'text',
              value: nameInput,
              onChange: (e) => setNameInput(e.target.value),
              onClick: (e) => e.stopPropagation(),
              onKeyDown: (e) => {
                if (e.key === 'Enter') { e.preventDefault(); commitRename(e); }
                if (e.key === 'Escape') { e.preventDefault(); cancelRename(e); }
              },
              className: 'flex-1 min-w-0 bg-gray-900 border border-indigo-600/60 rounded px-2 py-1 text-sm text-gray-100',
              placeholder: 'Desk name',
              disabled: isSavingName,
            })
          : React.createElement('h3', { className: 'font-bold text-md text-gray-100 truncate flex-1 min-w-0', title: desk.name }, desk.name || 'Untitled Desk'),
        !readOnly && onRename && React.createElement(
          'div',
          { className: 'shrink-0 flex items-center gap-1' },
          isEditingName
            ? React.createElement(
                React.Fragment, null,
                React.createElement('button', {
                  type: 'button', onClick: commitRename,
                  disabled: isSavingName || !String(nameInput || '').trim(),
                  className: 'text-xs px-2 py-1 rounded bg-indigo-600/80 text-white hover:bg-indigo-600 disabled:opacity-50',
                }, isSavingName ? 'Saving…' : 'Save'),
                React.createElement('button', {
                  type: 'button', onClick: cancelRename, disabled: isSavingName,
                  className: 'text-xs px-2 py-1 rounded bg-gray-700 text-gray-200 hover:bg-gray-600',
                }, 'Cancel')
              )
            : React.createElement('button', {
                type: 'button', onClick: beginRename,
                className: 'text-xs px-2 py-1 rounded bg-gray-700/80 text-gray-200 hover:bg-gray-600 opacity-0 group-hover:opacity-100 transition-opacity',
                title: 'Rename desk',
              }, 'Rename')
        )
      ),
      React.createElement(
        'p',
        { className: 'text-sm text-gray-400 mt-0.5' },
        itemCount,
        ' ',
        itemCount === 1 ? 'item' : 'items'
      )
    )
  );
};

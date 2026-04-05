
import React from 'react';
import { DataTile } from './DataTile.js';
import { libraryItemKey } from '../utils/libraryItemKey.js';

/**
 * Full-screen modal showing the shared content (explicitRefs) of a share.
 * Each referenced item renders as a DataTile in the same grid layout as the library.
 */
export const SharedContentViewer = ({
  share,
  items,
  channels,
  onSelectItem,
  onSelectChannel,
  onClose,
  onEdit,
}) => {
  if (!share) return null;
  const refs = share.explicitRefs || [];
  const isOwner = share.role !== 'receiver';

  const resolvedItems = [];
  const resolvedChannels = [];
  const unresolvedRefs = [];

  for (const ref of refs) {
    const driveId = String(ref.driveId || '').trim();
    if (!driveId) continue;
    const item = (items || []).find((it) => it.driveId === driveId);
    if (item) { resolvedItems.push(item); continue; }
    const ch = (channels || []).find((c) => c.driveId === driveId);
    if (ch) { resolvedChannels.push(ch); continue; }
    unresolvedRefs.push(ref);
  }

  const totalResolved = resolvedChannels.length + resolvedItems.length;

  return React.createElement(
    'div',
    {
      className: 'fixed inset-0 bg-black/70 z-50 overflow-y-auto',
      onClick: (e) => { if (e.target === e.currentTarget) onClose(); },
    },
    React.createElement(
      'div',
      { className: 'min-h-full p-4 sm:p-6 lg:p-8' },

      React.createElement(
        'div',
        { className: 'flex items-center justify-between mb-6 flex-wrap gap-2' },
        React.createElement(
          'div',
          { className: 'min-w-0' },
          React.createElement(
            'h2',
            { className: 'text-2xl font-bold text-gray-100' },
            'Shared Content'
          ),
          React.createElement(
            'p',
            { className: 'text-sm text-gray-500 truncate mt-0.5', title: share.driveFileName },
            share.driveFileName,
            ' · ',
            isOwner ? 'Owner' : 'Receiver',
            ' · ',
            (share.recipients || []).length,
            ' recipient',
            (share.recipients || []).length === 1 ? '' : 's'
          )
        ),
        React.createElement(
          'div',
          { className: 'flex items-center gap-2 shrink-0' },
          React.createElement(
            'span',
            { className: 'text-sm text-gray-500 font-medium bg-gray-800 px-3 py-1 rounded-full border border-gray-700' },
            `${totalResolved + unresolvedRefs.length} Item${refs.length === 1 ? '' : 's'}`
          ),
          isOwner && onEdit &&
            React.createElement(
              'button',
              {
                type: 'button',
                onClick: onEdit,
                className: 'text-sm font-bold px-4 py-2 rounded-xl bg-gray-700 hover:bg-gray-600 text-gray-200 transition-colors',
              },
              'Edit share'
            ),
          React.createElement(
            'button',
            {
              type: 'button',
              onClick: onClose,
              className: 'text-sm font-bold px-4 py-2 rounded-xl bg-gray-800 hover:bg-gray-700 border border-gray-600 text-gray-300 transition-colors',
            },
            'Close'
          )
        )
      ),

      refs.length === 0
        ? React.createElement(
            'div',
            { className: 'text-center py-20 px-6 border-2 border-dashed border-gray-800 rounded-2xl bg-gray-800/20' },
            React.createElement('h3', { className: 'text-xl font-semibold text-gray-400' }, 'No content in this share yet'),
            isOwner &&
              React.createElement(
                'p',
                { className: 'text-gray-500 mt-2 max-w-sm mx-auto' },
                'Add tags or pick items in the share editor, then Save & upload.'
              )
          )
        : React.createElement(
            React.Fragment,
            null,

            resolvedChannels.length > 0 &&
              React.createElement(
                'div',
                { className: 'mb-6' },
                React.createElement(
                  'div',
                  {
                    className:
                      'grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 gap-6',
                  },
                  resolvedChannels.map((ch) =>
                    React.createElement(DataTile, {
                      key: ch.id,
                      tileType: 'channel',
                      channel: ch,
                      onSelect: onSelectChannel,
                      readOnly: true,
                    })
                  )
                )
              ),

            resolvedItems.length > 0 &&
              React.createElement(
                'div',
                {
                  className:
                    'grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 gap-6',
                },
                resolvedItems.map((item) =>
                  React.createElement(DataTile, {
                    key: libraryItemKey(item),
                    tileType: 'item',
                    item,
                    onSelect: onSelectItem,
                    readOnly: true,
                  })
                )
              ),

            unresolvedRefs.length > 0 &&
              React.createElement(
                'div',
                { className: 'mt-6 border-t border-gray-700 pt-4' },
                React.createElement('p', { className: 'text-xs text-gray-500 mb-2' }, 'Not synced locally'),
                React.createElement(
                  'div',
                  { className: 'flex flex-wrap gap-2' },
                  unresolvedRefs.map((ref) =>
                    React.createElement(
                      'span',
                      {
                        key: ref.driveId || ref.name,
                        className: 'inline-flex items-center gap-1 px-3 py-1.5 rounded-lg bg-gray-800 border border-gray-700 text-xs text-gray-400',
                        title: `Drive ID: ${ref.driveId}`,
                      },
                      ref.name || ref.driveId
                    )
                  )
                )
              )
          ),

      (share.includeTags || []).length > 0 &&
        React.createElement(
          'div',
          { className: 'mt-6 pt-4 border-t border-gray-700' },
          React.createElement('p', { className: 'text-xs text-gray-500 mb-2' }, 'Included by tags'),
          React.createElement(
            'div',
            { className: 'flex flex-wrap gap-1' },
            (share.includeTags || []).map((t) =>
              React.createElement(
                'span',
                {
                  key: t,
                  className: 'inline-block px-2 py-0.5 rounded-md bg-gray-700 text-[10px] text-gray-300 font-mono',
                },
                t
              )
            )
          )
        )
    )
  );
};

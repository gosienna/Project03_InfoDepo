
import React, { useState, useEffect, useRef } from 'react';
import { formatBytes, getFileExtension } from '../utils/fileUtils.js';
import { BookIcon } from './icons/BookIcon.js';
import { TrashIcon } from './icons/TrashIcon.js';
import { UploadIcon } from './icons/UploadIcon.js';
import { normalizeTag } from '../utils/tagUtils.js';

const YT_VIDEO_ID_RE = /(?:youtube\.com\/(?:watch\?(?:.*&)?v=|embed\/|shorts\/)|youtu\.be\/)([a-zA-Z0-9_-]{11})/;

const NEW_TAG_OPTION = '__infodepo_new_tag__';

/** Shared by `item` and `channel` tiles so width/height track the same layout (grid column + `h-40` hero). */
const DATA_TILE_SHELL =
  'bg-gray-800 rounded-lg shadow-lg overflow-hidden cursor-pointer w-full group transition-all duration-300 transform hover:-translate-y-1 hover:shadow-indigo-500/30';

const UploadButton = ({ status, onClick }) => {
  if (status === 'uploading') {
    return React.createElement(
      'div',
      { className: 'p-2 rounded-full bg-indigo-600/50 text-white', title: 'Uploading...' },
      React.createElement('div', { className: 'h-4 w-4 border-2 border-white border-t-transparent rounded-full animate-spin' })
    );
  }
  if (status === 'success') {
    return React.createElement(
      'div',
      { className: 'p-2 rounded-full bg-green-600/70 text-white', title: 'Uploaded to Drive' },
      React.createElement(
        'svg',
        { xmlns: 'http://www.w3.org/2000/svg', className: 'h-4 w-4', fill: 'none', viewBox: '0 0 24 24', stroke: 'currentColor' },
        React.createElement('path', { strokeLinecap: 'round', strokeLinejoin: 'round', strokeWidth: 2, d: 'M5 13l4 4L19 7' })
      )
    );
  }
  if (status === 'error') {
    return React.createElement(
      'button',
      {
        onClick,
        title: 'Upload failed — click to retry',
        className: 'p-2 rounded-full bg-red-600/70 text-white hover:bg-red-600 transition-colors',
      },
      React.createElement(
        'svg',
        { xmlns: 'http://www.w3.org/2000/svg', className: 'h-4 w-4', fill: 'none', viewBox: '0 0 24 24', stroke: 'currentColor' },
        React.createElement('path', { strokeLinecap: 'round', strokeLinejoin: 'round', strokeWidth: 2, d: 'M12 9v2m0 4h.01M12 3a9 9 0 110 18A9 9 0 0112 3z' })
      )
    );
  }
  return React.createElement(
    'button',
    {
      onClick,
      title: 'Upload to Google Drive',
      className: 'p-2 rounded-full bg-indigo-600/50 text-white opacity-0 group-hover:opacity-100 hover:bg-indigo-600 transition-all duration-300',
    },
    React.createElement(UploadIcon, { className: 'h-4 w-4' })
  );
};

/**
 * Library tile: merged books / notes / videos (`tileType: 'item'`), YouTube channel (`tileType: 'channel'`), or Drive share (`tileType: 'share'`).
 */
export const DataTile = ({
  tileType,
  item,
  channel,
  share,
  onSelect,
  onDelete,
  onUpload,
  uploadStatus,
  onSetTags,
  readOnly,
  availableTags,
}) => {
  const isChannel = tileType === 'channel';
  const isShare = tileType === 'share';
  const video = item;
  const ch = channel;
  const sh = share;
  const record = isChannel ? ch : isShare ? sh : video;
  const recordId = record?.id;

  const fileExtension = !isChannel && video?.name ? getFileExtension(video.name) : '';
  const isYoutube = !isChannel && video?.type === 'application/x-youtube';
  const [thumbVideoId, setThumbVideoId] = useState(null);
  const [tagInput, setTagInput] = useState('');
  const [tagPickerMode, setTagPickerMode] = useState('select');
  const newTagInputRef = useRef(null);

  const tags = Array.isArray(record?.tags) ? record.tags : [];
  const tagSuggestions = (availableTags || []).filter((t) => !tags.includes(t));

  useEffect(() => {
    if (isChannel || isShare || !isYoutube || !video?.data) {
      setThumbVideoId(null);
      return;
    }
    const reader = new FileReader();
    reader.onload = (e) => {
      try {
        const { url } = JSON.parse(e.target.result);
        const m = (url || '').match(YT_VIDEO_ID_RE);
        setThumbVideoId(m ? m[1] : null);
      } catch {}
    };
    reader.readAsText(video.data);
  }, [isChannel, isShare, video?.id, video?.type, isYoutube, video?.size, video?.data]);

  useEffect(() => {
    setTagInput('');
    setTagPickerMode('select');
  }, [recordId, isChannel]);

  useEffect(() => {
    if (tagPickerMode === 'input' && newTagInputRef.current) {
      newTagInputRef.current.focus();
    }
  }, [tagPickerMode]);

  const tagSubject = () => record;

  const addTagFromSelect = (e) => {
    e.stopPropagation();
    const v = e.target.value;
    if (!v) return;
    if (v === NEW_TAG_OPTION) {
      setTagPickerMode('input');
      return;
    }
    if (!onSetTags) return;
    const t = normalizeTag(v);
    if (!t || tags.includes(t)) return;
    onSetTags(tagSubject(), [...tags, t]);
  };

  const cancelNewTagInput = (e) => {
    e?.stopPropagation?.();
    setTagInput('');
    setTagPickerMode('select');
  };

  const commitNewTag = (e) => {
    e?.stopPropagation?.();
    if (!onSetTags) return;
    const t = normalizeTag(tagInput);
    if (!t || tags.includes(t)) return;
    onSetTags(tagSubject(), [...tags, t]);
    setTagInput('');
    setTagPickerMode('select');
  };

  const removeTag = (e, tag) => {
    e.stopPropagation();
    if (!onSetTags) return;
    onSetTags(tagSubject(), tags.filter((x) => x !== tag));
  };

  const idPrefix = isChannel ? `ch-${recordId}` : isShare ? `share-${recordId}` : `item-${recordId}`;

  const addTagControlsHidden =
    'opacity-0 pointer-events-none transition-opacity duration-150 group-hover/tagadd:opacity-100 group-hover/tagadd:pointer-events-auto focus-within:opacity-100 focus-within:pointer-events-auto';

  const tagRow =
    !isShare &&
    (tags.length > 0 || !readOnly) &&
    React.createElement(
      'div',
      {
        className:
          'mt-2 flex flex-wrap gap-1 items-center group/tagadd' + (!readOnly ? ' min-h-[2.25rem]' : ''),
        onClick: (e) => e.stopPropagation(),
      },
      tags.map((tag) =>
        React.createElement(
          'span',
          {
            key: tag,
            className: 'inline-flex items-center gap-0.5 pl-2 pr-1 py-0.5 rounded-md bg-gray-700 text-[10px] text-gray-300 font-mono',
          },
          tag,
          !readOnly &&
            React.createElement(
              'button',
              {
                type: 'button',
                onClick: (e) => removeTag(e, tag),
                className: 'text-gray-500 hover:text-red-400 px-0.5',
                title: 'Remove tag',
              },
              '×'
            )
        )
      ),
      !readOnly &&
        React.createElement(
          'span',
          { className: `inline-flex items-center gap-1 flex-wrap min-w-0 ${addTagControlsHidden}` },
          tagPickerMode === 'input'
            ? React.createElement(
                React.Fragment,
                null,
                React.createElement('input', {
                  ref: newTagInputRef,
                  id: `tag-new-${idPrefix}`,
                  type: 'text',
                  value: tagInput,
                  onChange: (e) => setTagInput(e.target.value),
                  onKeyDown: (e) => {
                    if (e.key === 'Enter') {
                      e.preventDefault();
                      commitNewTag(e);
                    }
                    if (e.key === 'Escape') {
                      e.preventDefault();
                      cancelNewTagInput(e);
                    }
                  },
                  onClick: (e) => e.stopPropagation(),
                  placeholder: 'Type tag…',
                  title: 'Enter to save, Esc to cancel',
                  className:
                    'min-w-[7rem] max-w-[12rem] bg-gray-900 border border-indigo-600/60 rounded px-2 py-1 text-sm text-gray-200 placeholder-gray-600',
                  'aria-label': 'New tag name',
                  autoComplete: 'off',
                }),
                React.createElement(
                  'button',
                  {
                    type: 'button',
                    onClick: cancelNewTagInput,
                    className: 'text-xs text-gray-500 hover:text-gray-300 px-1',
                    title: 'Cancel',
                  },
                  '✕'
                )
              )
            : React.createElement(
                'select',
                {
                  id: `tag-pick-${idPrefix}`,
                  key: `tag-select-${idPrefix}-${tags.join(',')}`,
                  value: '',
                  onChange: addTagFromSelect,
                  onClick: (e) => e.stopPropagation(),
                  title: 'Choose a tag (adds immediately), or New tag to type one',
                  className:
                    'min-w-[7.5rem] max-w-[12rem] bg-gray-900 border border-gray-600 rounded px-2 py-1 text-sm text-gray-200 cursor-pointer shrink-0',
                  'aria-label': 'Add tag',
                },
                React.createElement('option', { value: '' }, 'Choose tag…'),
                tagSuggestions.map((t) => React.createElement('option', { key: t, value: t }, t)),
                React.createElement('option', { value: NEW_TAG_OPTION }, 'New tag…')
              )
        )
    );

  if (isShare) {
    const handleShareDelete = (e) => {
      e.stopPropagation();
      if (!onDelete) return;
      if (window.confirm(`Remove share "${sh.driveFileName}" from this device?`)) {
        onDelete(sh);
      }
    };

    const nRec = (sh.recipients || []).length;
    const nTags = (sh.includeTags || []).length;
    const nExplicit = (sh.explicitRefs || []).length;
    const driveOk = !!(sh.driveFileId && String(sh.driveFileId).trim());

    return React.createElement(
      'div',
      {
        className: DATA_TILE_SHELL,
        onClick: () => onSelect(sh),
      },
      React.createElement(
        'div',
        { className: 'relative p-4 bg-gray-700 h-40 flex items-center justify-center overflow-hidden' },
        React.createElement(
          'div',
          { className: 'flex items-center justify-center w-full h-full' },
          React.createElement(
            'svg',
            {
              xmlns: 'http://www.w3.org/2000/svg',
              className: 'h-20 w-20 text-teal-500/80',
              fill: 'none',
              viewBox: '0 0 24 24',
              stroke: 'currentColor',
            },
            React.createElement('path', {
              strokeLinecap: 'round',
              strokeLinejoin: 'round',
              strokeWidth: 1.5,
              d: 'M8.684 13.342C8.886 12.938 9 12.482 9 12c0-.482-.114-.938-.316-1.342m0 2.684a3 3 0 110-2.684m0 2.684l6.632 3.316m-6.632-6l6.632-3.316m0 0a3 3 0 105.367-2.684 3 3 0 00-5.367 2.684zm0 9.316a3 3 0 105.368 2.684 3 3 0 00-5.368-2.684z',
            })
          )
        ),
        React.createElement(
          'span',
          {
            className: 'absolute top-2 right-2 bg-teal-700 text-white text-xs font-bold px-2 py-1 rounded',
          },
          sh.role === 'receiver' ? 'Share · In' : 'Share'
        ),
        React.createElement(
          'div',
          { className: 'absolute bottom-2 right-2 flex items-center gap-1.5' },
          !readOnly &&
            onDelete &&
            React.createElement(
              'button',
              {
                type: 'button',
                onClick: handleShareDelete,
                className:
                  'p-2 rounded-full bg-red-600/50 text-white opacity-0 group-hover:opacity-100 hover:bg-red-600 transition-all duration-300',
                title: 'Remove share',
              },
              React.createElement(TrashIcon, { className: 'h-4 w-4' })
            )
        )
      ),
      React.createElement(
        'div',
        { className: 'p-4' },
        React.createElement('h3', { className: 'font-bold text-md text-gray-100 truncate', title: sh.driveFileName }, sh.driveFileName),
        React.createElement(
          'p',
          { className: 'text-sm text-gray-400' },
          sh.role === 'receiver' ? 'Receiver' : 'Owner',
          ' · ',
          nRec,
          nRec === 1 ? ' recipient' : ' recipients',
          (nTags > 0 || nExplicit > 0) &&
            ` · ${[nTags && `${nTags} tag${nTags === 1 ? '' : 's'}`, nExplicit && `${nExplicit} pick${nExplicit === 1 ? '' : 's'}`]
              .filter(Boolean)
              .join(' · ')}`
        ),
        driveOk
          ? React.createElement('p', { className: 'text-xs text-teal-500/90 mt-1' }, 'Linked to Drive')
          : React.createElement('p', { className: 'text-xs text-amber-500/90 mt-1' }, 'Not uploaded yet')
      )
    );
  }

  if (isChannel) {
    const handleChannelDelete = (e) => {
      e.stopPropagation();
      if (!onDelete) return;
      onDelete(ch);
    };

    const handleChannelUpload = (e) => {
      e.stopPropagation();
      if (onUpload) onUpload(ch);
    };

    const channelThumb = ch.thumbnailUrl
      ? React.createElement('img', {
          src: ch.thumbnailUrl,
          alt: ch.name,
          className: 'w-full h-full object-cover',
        })
      : React.createElement(
          'div',
          { className: 'flex items-center justify-center w-full h-full' },
          React.createElement(
            'svg',
            { xmlns: 'http://www.w3.org/2000/svg', className: 'h-16 w-16 text-red-500/70', fill: 'currentColor', viewBox: '0 0 24 24' },
            React.createElement('path', {
              d: 'M19.615 3.184c-3.604-.246-11.631-.245-15.23 0-3.897.266-4.356 2.62-4.385 8.816.029 6.185.484 8.549 4.385 8.816 3.6.245 11.626.246 15.23 0 3.897-.266 4.356-2.62 4.385-8.816-.029-6.185-.484-8.549-4.385-8.816zm-10.615 12.816v-8l8 3.993-8 4.007z',
            })
          )
        );

    return React.createElement(
      'div',
      {
        className: DATA_TILE_SHELL,
        onClick: () => onSelect(ch),
      },
      React.createElement(
        'div',
        { className: 'relative p-4 bg-gray-700 h-40 flex items-center justify-center overflow-hidden' },
        channelThumb,
        React.createElement(
          'span',
          {
            className: 'absolute top-2 right-2 bg-red-600 text-white text-xs font-bold px-2 py-1 rounded',
          },
          'Channel'
        ),
        React.createElement(
          'div',
          { className: 'absolute bottom-2 right-2 flex items-center gap-1.5' },
          !readOnly && onUpload && React.createElement(UploadButton, { status: uploadStatus, onClick: handleChannelUpload }),
          !readOnly &&
            onDelete &&
            React.createElement(
              'button',
              {
                type: 'button',
                onClick: handleChannelDelete,
                className:
                  'p-2 rounded-full bg-red-600/50 text-white opacity-0 group-hover:opacity-100 hover:bg-red-600 transition-all duration-300',
                title: 'Remove channel',
              },
              React.createElement(TrashIcon, { className: 'h-4 w-4' })
            )
        )
      ),
      React.createElement(
        'div',
        { className: 'p-4' },
        React.createElement('h3', { className: 'font-bold text-md text-gray-100 truncate', title: ch.name }, ch.name),
        React.createElement(
          'p',
          { className: 'text-sm text-gray-400' },
          (ch.videos || []).length,
          ' video',
          (ch.videos || []).length === 1 ? '' : 's'
        ),
        ch.handle &&
          React.createElement('p', { className: 'text-xs text-gray-500 truncate mt-0.5', title: ch.handle }, ch.handle),
        tagRow
      )
    );
  }

  const handleDelete = (e) => {
    e.stopPropagation();
    if (!onDelete) return;
    onDelete(video);
  };

  const handleUpload = (e) => {
    e.stopPropagation();
    onUpload(video);
  };

  const thumbnailContent = isYoutube
    ? thumbVideoId
      ? React.createElement('img', {
          src: `https://img.youtube.com/vi/${thumbVideoId}/mqdefault.jpg`,
          alt: video.name,
          className: 'w-full h-full object-cover',
        })
      : React.createElement(
          'div',
          { className: 'flex items-center justify-center w-full h-full' },
          React.createElement(
            'svg',
            { xmlns: 'http://www.w3.org/2000/svg', className: 'h-16 w-16 text-red-500/70', fill: 'currentColor', viewBox: '0 0 24 24' },
            React.createElement('path', {
              d: 'M19.615 3.184c-3.604-.246-11.631-.245-15.23 0-3.897.266-4.356 2.62-4.385 8.816.029 6.185.484 8.549 4.385 8.816 3.6.245 11.626.246 15.23 0 3.897-.266 4.356-2.62 4.385-8.816-.029-6.185-.484-8.549-4.385-8.816zm-10.615 12.816v-8l8 3.993-8 4.007z',
            })
          )
        )
    : React.createElement(BookIcon, {
        className: 'h-20 w-20 text-gray-500 group-hover:text-indigo-400 transition-colors duration-300',
      });

  return React.createElement(
    'div',
    {
      className: DATA_TILE_SHELL,
      onClick: () => onSelect(video),
    },
    React.createElement(
      'div',
      { className: 'relative p-4 bg-gray-700 h-40 flex items-center justify-center overflow-hidden' },
      thumbnailContent,
      React.createElement(
        'span',
        {
          className: isYoutube
            ? 'absolute top-2 right-2 bg-red-600 text-white text-xs font-bold px-2 py-1 rounded'
            : 'absolute top-2 right-2 bg-indigo-600 text-white text-xs font-bold px-2 py-1 rounded',
        },
        isYoutube ? 'YouTube' : fileExtension.toUpperCase()
      ),
      React.createElement(
        'div',
        { className: 'absolute bottom-2 right-2 flex items-center gap-1.5' },
        !readOnly && React.createElement(UploadButton, { status: uploadStatus, onClick: handleUpload }),
        !readOnly &&
          React.createElement(
            'button',
            {
              onClick: handleDelete,
              className:
                'p-2 rounded-full bg-red-600/50 text-white opacity-0 group-hover:opacity-100 hover:bg-red-600 transition-all duration-300',
              title: 'Delete',
            },
            React.createElement(TrashIcon, { className: 'h-4 w-4' })
          )
      )
    ),
    React.createElement(
      'div',
      { className: 'p-4' },
      React.createElement(
        'h3',
        { className: 'font-bold text-md text-gray-100 truncate', title: video.name },
        isYoutube ? video.name.replace(/\.youtube$/i, '') : video.name
      ),
      React.createElement('p', { className: 'text-sm text-gray-400' }, formatBytes(video.size)),
      tagRow,
      (() => {
        const mdLike =
          video.type === 'text/markdown' ||
          (typeof video.name === 'string' && /\.(md|markdown|mdown|mkd)$/i.test(video.name));
        return (
          mdLike &&
          video.idbStore &&
          React.createElement(
            'p',
            {
              className: 'text-[10px] text-gray-500 mt-1 font-mono',
              title:
                'Chrome: Application → Storage → IndexedDB → InfoDepo → object store "' +
                video.idbStore +
                '". Row "data" is a Blob; use the refresh icon on the DB tree if the table is stale.',
            },
            'IndexedDB table: ',
            video.idbStore
          )
        );
      })()
    )
  );
};

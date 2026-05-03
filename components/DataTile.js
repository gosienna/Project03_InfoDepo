import '../utils/mapGetOrInsertComputedPolyfill.js';
import React, { useState, useEffect, useRef } from 'react';

/**
 * iOS Safari IDB blobs can become unreadable after the transaction closes.
 * FileReader is a more reliable path for these blobs than blob.arrayBuffer().
 */
function readBlobAsArrayBuffer(blob) {
  return new Promise((resolve, reject) => {
    const fr = new FileReader();
    fr.onload = () => resolve(fr.result);
    fr.onerror = () => reject(fr.error || new Error('FileReader failed'));
    fr.readAsArrayBuffer(blob);
  });
}
import * as pdfjsLib from 'pdfjs-dist';
import pdfWorker from '../utils/pdfjsWorkerEntry.js?worker&url';
import JSZip from 'jszip';
import { formatBytes, getFileExtension } from '../utils/fileUtils.js';
import { BookIcon } from './icons/BookIcon.js';
import { TrashIcon } from './icons/TrashIcon.js';
import { UploadIcon } from './icons/UploadIcon.js';
import { normalizeTag } from '../utils/tagUtils.js';

const YT_VIDEO_ID_RE = /(?:youtube\.com\/(?:watch\?(?:.*&)?v=|embed\/|shorts\/)|youtu\.be\/)([a-zA-Z0-9_-]{11})/;

const NEW_TAG_OPTION = '__infodepo_new_tag__';

pdfjsLib.GlobalWorkerOptions.workerSrc = pdfWorker;

function formatViewCount(n) {
  const x = typeof n === 'number' && !Number.isNaN(n) ? n : 0;
  if (x >= 1_000_000) return (x / 1_000_000).toFixed(1).replace(/\.0$/, '') + 'M';
  if (x >= 1_000) return (x / 1_000).toFixed(1).replace(/\.0$/, '') + 'K';
  return String(x);
}

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
 * Library tile: merged books / notes / videos (`tileType: 'item'`) or YouTube channel (`tileType: 'channel'`).
 */
export const DataTile = ({
  tileType,
  item,
  channel,
  onSelect,
  onDelete,
  onUpload,
  onSetNoteCoverImage,
  uploadStatus,
  onSetTags,
  onSetSharedWith,
  canShare,
  shareableEmails,
  onRename,
  readOnly,
  availableTags,
}) => {
  const isChannel = tileType === 'channel';
  const video = item;
  const ch = channel;
  const record = isChannel ? ch : video;
  const recordId = record?.id;

  const fileExtension = !isChannel && video?.name ? getFileExtension(video.name) : '';
  const isYoutube = !isChannel && video?.type === 'application/x-youtube';
  const isUrl = !isChannel && video?.type === 'application/x-url';
  const isBookTile = !isChannel && video?.idbStore === 'books' && !isUrl;
  const isMarkdownNote = !isChannel && video?.idbStore === 'notes';
  const isPdfBook =
    isBookTile &&
    (video?.type === 'application/pdf' || (typeof video?.name === 'string' && /\.pdf$/i.test(video.name)));
  const isEpubBook =
    isBookTile &&
    (video?.type === 'application/epub+zip' || (typeof video?.name === 'string' && /\.epub$/i.test(video.name)));
  const [thumbVideoId, setThumbVideoId] = useState(null);
  const [featuredChannelVideoId, setFeaturedChannelVideoId] = useState(null);
  const [bookFirstPageThumb, setBookFirstPageThumb] = useState(null);
  const [tagInput, setTagInput] = useState('');
  const [tagPickerMode, setTagPickerMode] = useState('select');
  const [isEditingName, setIsEditingName] = useState(false);
  const [nameInput, setNameInput] = useState('');
  const [isSavingName, setIsSavingName] = useState(false);
  const [noteCoverUrl, setNoteCoverUrl] = useState(null);
  const newTagInputRef = useRef(null);
  const nameInputRef = useRef(null);
  const noteCoverInputRef = useRef(null);

  const tags = Array.isArray(record?.tags) ? record.tags : [];
  const tagSuggestions = (availableTags || []).filter((t) => !tags.includes(t));
  const sharedWith = Array.isArray(record?.sharedWith) ? record.sharedWith : [];
  const shareSuggestions = (shareableEmails || []).filter((email) => !sharedWith.includes(email));

  useEffect(() => {
    if (isChannel || !isYoutube || !video?.data) {
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
  }, [isChannel, video?.id, video?.type, isYoutube, video?.size, video?.data]);

  useEffect(() => {
    if (!isChannel) {
      setFeaturedChannelVideoId(null);
      return;
    }
    const vids = Array.isArray(ch?.videos) ? ch.videos.filter((v) => typeof v?.videoId === 'string' && v.videoId.trim()) : [];
    if (!vids.length) {
      setFeaturedChannelVideoId(null);
      return;
    }
    const idx = Math.floor(Math.random() * vids.length);
    setFeaturedChannelVideoId(vids[idx].videoId);
  }, [isChannel, ch?.id, ch?.videos?.length]);

  useEffect(() => {
    let cancelled = false;
    let loadingTask = null;
    if (!isPdfBook || !video?.data) {
      setBookFirstPageThumb(null);
      return () => {};
    }
    (async () => {
      try {
        const buffer = await readBlobAsArrayBuffer(video.data);
        if (cancelled) return;
        loadingTask = pdfjsLib.getDocument({ data: new Uint8Array(buffer) });
        const pdfDoc = await loadingTask.promise;
        if (cancelled) {
          try { await pdfDoc.destroy(); } catch {}
          return;
        }
        const firstPage = await pdfDoc.getPage(1);
        const base = firstPage.getViewport({ scale: 1 });
        const targetWidth = 260;
        const scale = targetWidth / Math.max(1, base.width);
        const viewport = firstPage.getViewport({ scale });
        const canvas = document.createElement('canvas');
        canvas.width = Math.max(1, Math.floor(viewport.width));
        canvas.height = Math.max(1, Math.floor(viewport.height));
        const ctx = canvas.getContext('2d');
        if (!ctx) throw new Error('Canvas context unavailable');
        await firstPage.render({ canvasContext: ctx, viewport }).promise;
        if (cancelled) return;
        setBookFirstPageThumb(canvas.toDataURL('image/jpeg', 0.9));
        try { await pdfDoc.destroy(); } catch {}
      } catch {
        if (!cancelled) setBookFirstPageThumb(null);
      } finally {
        if (loadingTask) {
          try { loadingTask.destroy(); } catch {}
        }
      }
    })();
    return () => {
      cancelled = true;
      if (loadingTask) {
        try { loadingTask.destroy(); } catch {}
      }
    };
  }, [isPdfBook, video?.id, video?.data, video?.size]);

  useEffect(() => {
    if (!isEpubBook || !video?.data) {
      setBookFirstPageThumb(null);
      return () => {};
    }
    let cancelled = false;
    let objectUrl = null;
    (async () => {
      try {
        const buffer = await video.data.arrayBuffer();
        if (cancelled) return;
        const zip = await JSZip.loadAsync(buffer);
        if (cancelled) return;

        // 1. Locate the OPF file via META-INF/container.xml
        const containerXml = await zip.file('META-INF/container.xml')?.async('string');
        if (cancelled || !containerXml) return;
        const containerDoc = new DOMParser().parseFromString(containerXml, 'application/xml');
        const opfPath = containerDoc.querySelector('rootfile')?.getAttribute('full-path');
        if (!opfPath) return;

        const opfXml = await zip.file(opfPath)?.async('string');
        if (cancelled || !opfXml) return;
        const opfDoc = new DOMParser().parseFromString(opfXml, 'application/xml');

        // 2. Find the cover image item in the manifest
        // Strategy A: item with properties="cover-image"
        let coverHref = opfDoc.querySelector('item[properties~="cover-image"]')?.getAttribute('href');

        // Strategy B: <meta name="cover"> pointing to a manifest item id
        if (!coverHref) {
          const coverId = opfDoc.querySelector('meta[name="cover"]')?.getAttribute('content');
          if (coverId) {
            coverHref = opfDoc.querySelector(`item[id="${coverId}"]`)?.getAttribute('href');
          }
        }

        if (!coverHref) return;

        // 3. Resolve path relative to the OPF directory
        const opfDir = opfPath.includes('/') ? opfPath.substring(0, opfPath.lastIndexOf('/') + 1) : '';
        const coverPath = opfDir + coverHref;

        const coverData = await zip.file(coverPath)?.async('uint8array');
        if (cancelled || !coverData) return;

        // Determine MIME type from extension
        const ext = coverPath.split('.').pop().toLowerCase();
        const mime = ext === 'png' ? 'image/png' : ext === 'gif' ? 'image/gif' : ext === 'webp' ? 'image/webp' : 'image/jpeg';
        const url = URL.createObjectURL(new Blob([coverData], { type: mime }));
        if (cancelled) { URL.revokeObjectURL(url); return; }
        objectUrl = url;
        setBookFirstPageThumb(objectUrl);
      } catch {
        if (!cancelled) setBookFirstPageThumb(null);
      }
    })();
    return () => {
      cancelled = true;
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    };
  }, [isEpubBook, video?.id, video?.data, video?.size]);

  useEffect(() => {
    setTagInput('');
    setTagPickerMode('select');
    setIsEditingName(false);
    setNameInput('');
    setIsSavingName(false);
  }, [recordId, isChannel]);

  useEffect(() => {
    if (tagPickerMode === 'input' && newTagInputRef.current) {
      newTagInputRef.current.focus();
    }
  }, [tagPickerMode]);

  useEffect(() => {
    if (isEditingName && nameInputRef.current) {
      nameInputRef.current.focus();
      nameInputRef.current.select();
    }
  }, [isEditingName]);

  useEffect(() => {
    if (!isMarkdownNote || !video?.coverImage?.data) {
      setNoteCoverUrl(null);
      return () => {};
    }
    const blob = video.coverImage.data;
    if (!(blob instanceof Blob)) {
      setNoteCoverUrl(null);
      return () => {};
    }
    const objectUrl = URL.createObjectURL(blob);
    setNoteCoverUrl(objectUrl);
    return () => URL.revokeObjectURL(objectUrl);
  }, [isMarkdownNote, video?.id, video?.coverImage?.data]);

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

  const addSharedUserFromSelect = async (e) => {
    e.stopPropagation();
    const email = String(e.target.value || '').trim().toLowerCase();
    if (!email) return;
    if (!onSetSharedWith) return;
    if (sharedWith.includes(email)) return;
    await onSetSharedWith(record, [...sharedWith, email]);
  };

  const removeSharedUser = async (e, email) => {
    e.stopPropagation();
    if (!onSetSharedWith) return;
    await onSetSharedWith(record, sharedWith.filter((x) => x !== email));
  };

  const renameTarget = isChannel ? ch : video;

  const beginRename = (e) => {
    e.stopPropagation();
    if (readOnly || !onRename || !renameTarget) return;
    setNameInput(renameTarget.name || '');
    setIsEditingName(true);
  };

  const cancelRename = (e) => {
    e?.stopPropagation?.();
    setIsEditingName(false);
    setNameInput('');
    setIsSavingName(false);
  };

  const commitRename = async (e) => {
    e?.stopPropagation?.();
    if (!onRename || !renameTarget || isSavingName) return;
    const trimmed = String(nameInput || '').trim();
    if (!trimmed) return;
    if (trimmed === String(renameTarget.name || '').trim()) {
      setIsEditingName(false);
      return;
    }
    setIsSavingName(true);
    try {
      await onRename(renameTarget, trimmed);
      setIsEditingName(false);
      setNameInput('');
    } catch (err) {
      window.alert(err?.message || 'Could not rename item.');
    } finally {
      setIsSavingName(false);
    }
  };

  const idPrefix = isChannel ? `ch-${recordId}` : `item-${recordId}`;

  const addTagControlsHidden =
    'opacity-0 pointer-events-none transition-opacity duration-150 group-hover/tagadd:opacity-100 group-hover/tagadd:pointer-events-auto focus-within:opacity-100 focus-within:pointer-events-auto';
  const addShareControlsHidden =
    'opacity-0 pointer-events-none transition-opacity duration-150 group-hover/shareadd:opacity-100 group-hover/shareadd:pointer-events-auto focus-within:opacity-100 focus-within:pointer-events-auto';
  const collapsibleMetaRow =
    'overflow-hidden max-h-0 opacity-0 pointer-events-none mt-0 transition-all duration-200 group-hover:max-h-40 group-hover:opacity-100 group-hover:pointer-events-auto group-hover:mt-2 focus-within:max-h-40 focus-within:opacity-100 focus-within:pointer-events-auto focus-within:mt-2';

  const tagRow =
    (tags.length > 0 || !readOnly) &&
    React.createElement(
      'div',
      {
        className:
          `flex flex-wrap gap-1 items-center group/tagadd ${collapsibleMetaRow}`,
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

  const shareRow =
    canShare &&
    React.createElement(
      'div',
      {
        className: `flex flex-wrap gap-1 items-center group/shareadd ${collapsibleMetaRow}`,
        onClick: (e) => e.stopPropagation(),
      },
      React.createElement(
        'span',
        {
          className: 'inline-flex items-center px-2 py-0.5 rounded-md bg-indigo-900/40 text-[10px] text-indigo-200 font-semibold',
        },
        'Shared with'
      ),
      sharedWith.map((email) =>
        React.createElement(
          'span',
          {
            key: email,
            className: 'inline-flex items-center gap-1 pl-2 pr-1 py-0.5 rounded-md bg-gray-700 text-[10px] text-gray-200 font-mono',
            title: email,
          },
          email,
          React.createElement(
            'button',
            {
              type: 'button',
              onClick: (e) => {
                removeSharedUser(e, email).catch((err) => {
                  window.alert(err?.message || 'Could not update shared recipients.');
                });
              },
              className: 'text-gray-500 hover:text-red-400 px-0.5',
              title: 'Remove recipient',
            },
            '×'
          )
        )
      ),
      React.createElement(
        'span',
        { className: `inline-flex items-center min-w-0 ${addShareControlsHidden}` },
        React.createElement(
          'select',
          {
            id: `share-pick-${idPrefix}`,
            key: `share-select-${idPrefix}-${sharedWith.join(',')}`,
            value: '',
            onChange: (e) => {
              addSharedUserFromSelect(e).catch((err) => {
                window.alert(err?.message || 'Could not update shared recipients.');
              });
            },
            onClick: (e) => e.stopPropagation(),
            title: 'Choose a user to share this item with',
            className:
              'min-w-[8rem] max-w-[16rem] bg-gray-900 border border-gray-600 rounded px-2 py-1 text-sm text-gray-200 cursor-pointer shrink-0',
            'aria-label': 'Share with user',
          },
          React.createElement('option', { value: '' }, shareSuggestions.length ? 'Share with…' : 'No users left'),
          shareSuggestions.map((email) => React.createElement('option', { key: email, value: email }, email))
        )
      )
    );

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

    const channelOverlayThumb = ch.thumbnailUrl
      ? React.createElement('img', {
          src: ch.thumbnailUrl,
          alt: ch.name,
          className: 'h-16 w-16 rounded-full object-cover border-2 border-gray-100/80 shadow-lg',
        })
      : React.createElement(
          'div',
          { className: 'h-16 w-16 rounded-full bg-gray-800/90 border-2 border-gray-100/60 shadow-lg flex items-center justify-center' },
          React.createElement(
            'svg',
            { xmlns: 'http://www.w3.org/2000/svg', className: 'h-8 w-8 text-red-500/80', fill: 'currentColor', viewBox: '0 0 24 24' },
            React.createElement('path', {
              d: 'M19.615 3.184c-3.604-.246-11.631-.245-15.23 0-3.897.266-4.356 2.62-4.385 8.816.029 6.185.484 8.549 4.385 8.816 3.6.245 11.626.246 15.23 0 3.897-.266 4.356-2.62 4.385-8.816-.029-6.185-.484-8.549-4.385-8.816zm-10.615 12.816v-8l8 3.993-8 4.007z',
            })
          )
        );

    const channelHero = featuredChannelVideoId
      ? React.createElement('img', {
          src: `https://img.youtube.com/vi/${featuredChannelVideoId}/mqdefault.jpg`,
          alt: `${ch.name} featured video`,
          className: 'absolute inset-0 w-full h-full object-cover',
          loading: 'lazy',
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

    const featuredChannelVideoTitle = featuredChannelVideoId
      ? (Array.isArray(ch.videos) ? ch.videos.find((v) => v.videoId === featuredChannelVideoId)?.title : '') || ''
      : '';

    return React.createElement(
      'div',
      {
        className: DATA_TILE_SHELL,
        onClick: () => onSelect({ ...ch, _featuredVideoId: featuredChannelVideoId || undefined }),
      },
      featuredChannelVideoTitle &&
        React.createElement(
          'p',
          {
            className: 'px-4 pt-3 pb-2 text-sm font-semibold text-white truncate',
            title: featuredChannelVideoTitle,
          },
          featuredChannelVideoTitle
        ),
      React.createElement(
        'div',
        { className: 'relative p-4 bg-gray-700 h-40 flex items-center justify-center overflow-hidden' },
        channelHero,
        React.createElement('div', { className: 'absolute inset-0 bg-gradient-to-t from-black/50 via-transparent to-transparent pointer-events-none' }),
        React.createElement(
          'span',
          {
            className: 'absolute top-2 right-2 z-20 bg-red-600 text-white text-xs font-bold px-2 py-1 rounded',
          },
          'Channel'
        ),
        React.createElement(
          'div',
          { className: 'absolute bottom-2 left-2 z-20 flex items-center gap-1.5' },
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
        ),
        React.createElement('div', { className: 'absolute bottom-2 right-2 z-20 pointer-events-none' }, channelOverlayThumb)
      ),
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
                  if (e.key === 'Enter') {
                    e.preventDefault();
                    commitRename(e);
                  }
                  if (e.key === 'Escape') {
                    e.preventDefault();
                    cancelRename(e);
                  }
                },
                className:
                  'flex-1 min-w-0 bg-gray-900 border border-indigo-600/60 rounded px-2 py-1 text-sm text-gray-100 placeholder-gray-500',
                placeholder: 'Enter channel name',
                'aria-label': 'Rename channel',
                disabled: isSavingName,
              })
            : React.createElement(
                'h3',
                { className: 'font-bold text-md text-gray-100 whitespace-normal break-words flex-1 min-w-0', title: ch.name },
                ch.name
              ),
          !readOnly &&
            onRename &&
            React.createElement(
              'div',
              { className: 'shrink-0 flex items-center gap-1' },
              isEditingName
                ? React.createElement(
                    React.Fragment,
                    null,
                    React.createElement(
                      'button',
                      {
                        type: 'button',
                        onClick: commitRename,
                        disabled: isSavingName || !String(nameInput || '').trim(),
                        className:
                          'text-xs px-2 py-1 rounded bg-indigo-600/80 text-white hover:bg-indigo-600 disabled:opacity-50 disabled:cursor-not-allowed',
                        title: 'Save name',
                      },
                      isSavingName ? 'Saving…' : 'Save'
                    ),
                    React.createElement(
                      'button',
                      {
                        type: 'button',
                        onClick: cancelRename,
                        disabled: isSavingName,
                        className: 'text-xs px-2 py-1 rounded bg-gray-700 text-gray-200 hover:bg-gray-600',
                        title: 'Cancel rename',
                      },
                      'Cancel'
                    )
                  )
                : React.createElement(
                    'button',
                    {
                      type: 'button',
                      onClick: beginRename,
                      className:
                        'text-xs px-2 py-1 rounded bg-gray-700/80 text-gray-200 hover:bg-gray-600 opacity-0 group-hover:opacity-100 transition-opacity',
                      title: 'Rename channel',
                    },
                    'Rename'
                  )
            )
        ),
        React.createElement(
          'p',
          { className: 'text-sm text-gray-400' },
          (ch.videos || []).length,
          ' video',
          (ch.videos || []).length === 1 ? '' : 's'
        ),
        ch.handle &&
          React.createElement('p', { className: 'text-xs text-gray-500 truncate mt-0.5', title: ch.handle }, ch.handle),
        tagRow,
        shareRow
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
    if (onUpload) onUpload(video);
  };

  const handlePickNoteCover = (e) => {
    e.stopPropagation();
    noteCoverInputRef.current?.click();
  };

  const handleNoteCoverFileChange = async (e) => {
    e.stopPropagation();
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file || !onSetNoteCoverImage) return;
    try {
      await onSetNoteCoverImage(video, file);
    } catch (err) {
      window.alert(err?.message || 'Could not save note cover image.');
    }
  };

  const thumbnailContent = isUrl
    ? React.createElement(
        'div',
        { className: 'flex items-center justify-center w-full h-full' },
        React.createElement(
          'svg',
          { xmlns: 'http://www.w3.org/2000/svg', className: 'h-16 w-16 text-cyan-400/70', fill: 'none', viewBox: '0 0 24 24', stroke: 'currentColor' },
          React.createElement('path', { strokeLinecap: 'round', strokeLinejoin: 'round', strokeWidth: 1.5, d: 'M13.828 10.172a4 4 0 00-5.656 0l-4 4a4 4 0 105.656 5.656l1.102-1.101m-.758-4.899a4 4 0 005.656 0l4-4a4 4 0 00-5.656-5.656l-1.1 1.1' })
        )
      )
    : isYoutube
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
    : isBookTile && bookFirstPageThumb
      ? React.createElement('img', {
          src: bookFirstPageThumb,
          alt: `${video?.name || 'Book'} first page`,
          className: 'w-full h-full object-cover',
          loading: 'lazy',
        })
    : isMarkdownNote && noteCoverUrl
      ? React.createElement('img', {
          src: noteCoverUrl,
          alt: `${video?.name || 'Note'} cover`,
          className: 'w-full h-full object-cover',
          loading: 'lazy',
        })
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
            : isUrl
              ? 'absolute top-2 right-2 bg-cyan-700 text-white text-xs font-bold px-2 py-1 rounded'
              : 'absolute top-2 right-2 bg-indigo-600 text-white text-xs font-bold px-2 py-1 rounded',
        },
        isYoutube ? 'YouTube' : isUrl ? 'URL' : fileExtension.toUpperCase()
      ),
      React.createElement(
        'div',
        { className: 'absolute bottom-2 left-2 flex items-center gap-1.5' },
        !readOnly &&
          isMarkdownNote &&
          onSetNoteCoverImage &&
          React.createElement(
            React.Fragment,
            null,
            React.createElement('input', {
              ref: noteCoverInputRef,
              type: 'file',
              accept: 'image/*',
              className: 'hidden',
              onClick: (e) => e.stopPropagation(),
              onChange: handleNoteCoverFileChange,
            }),
            React.createElement(
              'button',
              {
                type: 'button',
                onClick: handlePickNoteCover,
                className:
                  'px-2 py-1 rounded bg-gray-900/70 text-xs text-gray-200 opacity-0 group-hover:opacity-100 hover:bg-gray-900 transition-all duration-300',
                title: noteCoverUrl ? 'Change note cover image' : 'Add note cover image',
              },
              noteCoverUrl ? 'Cover' : 'Add Cover'
            )
          )
      ),
      React.createElement(
        'div',
        { className: 'absolute bottom-2 right-2 flex items-center gap-1.5' },
        !readOnly && onUpload && React.createElement(UploadButton, { status: uploadStatus, onClick: handleUpload }),
        !readOnly &&
          onDelete &&
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
                if (e.key === 'Enter') {
                  e.preventDefault();
                  commitRename(e);
                }
                if (e.key === 'Escape') {
                  e.preventDefault();
                  cancelRename(e);
                }
              },
              className:
                'flex-1 min-w-0 bg-gray-900 border border-indigo-600/60 rounded px-2 py-1 text-sm text-gray-100 placeholder-gray-500',
              placeholder: 'Enter item name',
              'aria-label': 'Rename item',
              disabled: isSavingName,
            })
          : React.createElement(
              'h3',
              { className: 'font-bold text-md text-gray-100 whitespace-normal break-words flex-1 min-w-0', title: video.name },
              isYoutube ? video.name.replace(/\.youtube$/i, '') : video.name
            ),
        !readOnly &&
          onRename &&
          React.createElement(
            'div',
            { className: 'shrink-0 flex items-center gap-1' },
            isEditingName
              ? React.createElement(
                  React.Fragment,
                  null,
                  React.createElement(
                    'button',
                    {
                      type: 'button',
                      onClick: commitRename,
                      disabled: isSavingName || !String(nameInput || '').trim(),
                      className:
                        'text-xs px-2 py-1 rounded bg-indigo-600/80 text-white hover:bg-indigo-600 disabled:opacity-50 disabled:cursor-not-allowed',
                      title: 'Save name',
                    },
                    isSavingName ? 'Saving…' : 'Save'
                  ),
                  React.createElement(
                    'button',
                    {
                      type: 'button',
                      onClick: cancelRename,
                      disabled: isSavingName,
                      className: 'text-xs px-2 py-1 rounded bg-gray-700 text-gray-200 hover:bg-gray-600',
                      title: 'Cancel rename',
                    },
                    'Cancel'
                  )
                )
              : React.createElement(
                  'button',
                  {
                    type: 'button',
                    onClick: beginRename,
                    className:
                      'text-xs px-2 py-1 rounded bg-gray-700/80 text-gray-200 hover:bg-gray-600 opacity-0 group-hover:opacity-100 transition-opacity',
                    title: 'Rename item',
                  },
                  'Rename'
                )
          )
      ),
      isYoutube && video._channelVideo
        ? React.createElement(
            'p',
            { className: 'text-xs text-gray-500 mt-0.5' },
            formatViewCount(video._channelVideo.viewCount),
            ' views',
            video._channelVideo.publishedAt
              ? ` · ${new Date(video._channelVideo.publishedAt).toLocaleDateString()}`
              : ''
          )
        : React.createElement('p', { className: 'text-sm text-gray-400' }, formatBytes(video.size)),
      tagRow,
      shareRow,
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

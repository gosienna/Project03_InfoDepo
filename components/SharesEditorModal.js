
import React, { useState, useEffect, useMemo } from 'react';
import { normalizeExplicitRefs } from '../utils/sharesDriveJson.js';
import { normalizeTag } from '../utils/tagUtils.js';

const parseEmails = (s) =>
  [...new Set(String(s || '').split(/[\s,;]+/).map((e) => e.trim().toLowerCase()).filter(Boolean))];

/**
 * @param {object} props
 * @param {import('../utils/sharesDriveJson.js').ShareClientRecord | null} props.share
 * @param {boolean} props.readOnly — receiver viewer
 * @param {string[]} props.availableTags
 * @param {Array<{ key: string, label: string, driveId: string }>} props.pickableWithDriveId
 * @param {() => void} props.onClose
 * @param {(record: import('../utils/sharesDriveJson.js').ShareClientRecord) => Promise<void>} [props.onSaveOwner]
 * @param {() => Promise<void>} [props.onRefreshReceiver]
 */
export const SharesEditorModal = ({
  share,
  readOnly,
  availableTags,
  pickableWithDriveId,
  onClose,
  onSaveOwner,
  onRefreshReceiver,
  allItems,
  allChannels,
}) => {
  const [driveFileName, setDriveFileName] = useState('');
  const [recipientsStr, setRecipientsStr] = useState('');
  const [includeTags, setIncludeTags] = useState([]);
  const [tagInput, setTagInput] = useState('');
  const [explicitRefs, setExplicitRefs] = useState([]);
  const [saving, setSaving] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState(null);
  const [linkCopied, setLinkCopied] = useState(false);

  const shareFileViewUrl = useMemo(() => {
    const id = String(share?.driveFileId || '').trim();
    if (!id) return '';
    return `https://drive.google.com/file/d/${id}/view`;
  }, [share?.driveFileId]);

  useEffect(() => {
    if (!share) return;
    setDriveFileName(share.driveFileName || '');
    setRecipientsStr((share.recipients || []).join(', '));
    setIncludeTags([...(share.includeTags || [])]);
    setExplicitRefs(normalizeExplicitRefs(share.explicitRefs));
    setError(null);
    setLinkCopied(false);
  }, [share?.id, share?.updatedAt, share?.driveFileId]);

  if (!share) return null;

  const tagSet = useMemo(
    () => new Set((includeTags || []).map((t) => normalizeTag(t)).filter(Boolean)),
    [includeTags]
  );

  const tagMatchedDriveIds = useMemo(() => {
    if (tagSet.size === 0) return new Set();
    const ids = new Set();
    for (const it of allItems || []) {
      if (!it.driveId) continue;
      const itTags = (it.tags || []).map((t) => normalizeTag(t));
      if (itTags.some((t) => tagSet.has(t))) ids.add(it.driveId);
    }
    for (const ch of allChannels || []) {
      if (!ch.driveId) continue;
      const chTags = (ch.tags || []).map((t) => normalizeTag(t));
      if (chTags.some((t) => tagSet.has(t))) ids.add(ch.driveId);
    }
    return ids;
  }, [tagSet, allItems, allChannels]);

  const recipientEmails = parseEmails(recipientsStr);
  const combinedExplicitCount = (() => {
    const ids = new Set();
    for (const r of normalizeExplicitRefs(explicitRefs)) ids.add(r.driveId);
    for (const id of tagMatchedDriveIds) ids.add(id);
    return ids.size;
  })();
  const hasShareScope = tagSet.size > 0 || combinedExplicitCount > 0;
  const showRecipientWarning = !readOnly && hasShareScope && recipientEmails.length === 0;

  const toggleTag = (t) => {
    if (readOnly) return;
    const n = String(t).trim();
    if (!n) return;
    setIncludeTags((prev) => (prev.includes(n) ? prev.filter((x) => x !== n) : [...prev, n]));
  };

  const addTagFromInput = () => {
    if (readOnly) return;
    const n = tagInput.trim();
    if (!n) return;
    if (!includeTags.includes(n)) setIncludeTags((p) => [...p, n]);
    setTagInput('');
  };

  const toggleExplicit = (ref) => {
    if (readOnly) return;
    const id = String(ref.driveId || '').trim();
    if (!id) return;
    setExplicitRefs((prev) => {
      const exists = prev.some((r) => String(r.driveId || '').trim() === id);
      if (exists) return prev.filter((r) => String(r.driveId || '').trim() !== id);
      return [...prev, { name: String(ref.label || 'Untitled').trim() || 'Untitled', driveId: id }];
    });
  };

  const handleSave = async () => {
    if (readOnly || !onSaveOwner) return;
    setError(null);
    setSaving(true);
    try {
      const nextRecipients = parseEmails(recipientsStr);
      const nextExplicit = normalizeExplicitRefs(explicitRefs);
      const rec = {
        ...share,
        driveFileName: driveFileName.trim() || share.driveFileName,
        recipients: nextRecipients,
        includeTags,
        explicitRefs: nextExplicit,
        updatedAt: new Date().toISOString(),
      };
      await onSaveOwner(rec);
      onClose();
    } catch (e) {
      setError(e?.message || String(e));
    } finally {
      setSaving(false);
    }
  };

  const handleRefresh = async () => {
    if (!onRefreshReceiver) return;
    setRefreshing(true);
    setError(null);
    try {
      await onRefreshReceiver();
    } catch (e) {
      setError(e?.message || String(e));
    } finally {
      setRefreshing(false);
    }
  };

  const handleCopyShareLink = async () => {
    if (!shareFileViewUrl) return;
    try {
      await navigator.clipboard.writeText(shareFileViewUrl);
      setLinkCopied(true);
      window.setTimeout(() => setLinkCopied(false), 2000);
    } catch {
      setError('Could not copy to the clipboard.');
    }
  };

  return React.createElement(
    'div',
    {
      className: 'fixed inset-0 bg-black/70 flex items-center justify-center z-50 p-4 overflow-y-auto',
      onClick: (e) => { if (e.target === e.currentTarget) onClose(); },
    },
    React.createElement(
      'div',
      { className: 'bg-gray-800 rounded-2xl shadow-2xl w-full max-w-lg border border-gray-700 my-8' },
      React.createElement(
        'div',
        { className: 'flex items-center justify-between px-6 py-4 border-b border-gray-700' },
        React.createElement(
          'h2',
          { className: 'text-lg font-bold text-gray-100' },
          readOnly ? 'Shared content (view only)' : 'Edit share'
        ),
        React.createElement(
          'button',
          {
            type: 'button',
            onClick: onClose,
            className: 'text-gray-400 hover:text-gray-200 p-1 rounded-lg hover:bg-gray-700',
          },
          '×'
        )
      ),
      React.createElement(
        'div',
        { className: 'p-6 flex flex-col gap-4 max-h-[70vh] overflow-y-auto' },
        error && React.createElement(
          'div',
          { className: 'text-sm text-red-300 bg-red-900/30 border border-red-800/50 rounded-lg px-3 py-2' },
          error
        ),
        React.createElement(
          'label',
          { className: 'flex flex-col gap-1' },
          React.createElement('span', { className: 'text-sm text-gray-400' }, 'Drive file name'),
          React.createElement('input', {
            type: 'text',
            value: driveFileName,
            onChange: (e) => !readOnly && setDriveFileName(e.target.value),
            disabled: readOnly,
            className: 'bg-gray-900 border border-gray-600 rounded-lg px-3 py-2 text-gray-100 text-sm disabled:opacity-60',
          })
        ),
        React.createElement(
          'label',
          { className: 'flex flex-col gap-1' },
          React.createElement('span', { className: 'text-sm text-gray-400' }, 'Recipients (emails, comma-separated)'),
          React.createElement('textarea', {
            value: recipientsStr,
            onChange: (e) => !readOnly && setRecipientsStr(e.target.value),
            disabled: readOnly,
            rows: 2,
            className: 'bg-gray-900 border border-gray-600 rounded-lg px-3 py-2 text-gray-100 text-sm disabled:opacity-60',
            placeholder: 'friend@gmail.com, colleague@company.org',
          }),
          !readOnly &&
            React.createElement(
              'p',
              { className: 'text-xs text-gray-500' },
              'Only email addresses are used for Drive sharing.'
            ),
          showRecipientWarning &&
            React.createElement(
              'p',
              { className: 'text-xs text-amber-500/95 mt-1' },
              'Add at least one recipient so Drive can grant readers access to your tagged files and picks below. You can still save; ACLs apply once recipients are set.'
            )
        ),
        !readOnly &&
          !shareFileViewUrl &&
          React.createElement(
            'p',
            { className: 'text-xs text-gray-500' },
            'After the first Save & upload, reopen this share from the library to copy the link below. Receivers use Library → Link share… and paste that URL or the file ID.'
          ),
        shareFileViewUrl &&
          React.createElement(
            'div',
            { className: 'flex flex-col gap-2' },
            React.createElement(
              'span',
              { className: 'text-sm text-gray-400' },
              readOnly ? 'Share file (Google Drive)' : 'Link to send receivers'
            ),
            React.createElement(
              'p',
              { className: 'text-xs text-gray-500 leading-relaxed' },
              readOnly
                ? 'Receivers open this file in InfoDepo via Library → Link share…'
                : 'They paste this URL (or the file ID from it) in Library → Link share… after you have granted them access in Drive or via recipients above.'
            ),
            React.createElement(
              'div',
              { className: 'flex gap-2' },
              React.createElement('input', {
                type: 'text',
                readOnly: true,
                value: shareFileViewUrl,
                onFocus: (e) => e.target.select(),
                className:
                  'flex-1 min-w-0 bg-gray-900 border border-gray-600 rounded-lg px-3 py-2 text-gray-100 text-xs font-mono',
              }),
              React.createElement(
                'button',
                {
                  type: 'button',
                  onClick: handleCopyShareLink,
                  className:
                    'shrink-0 px-3 py-2 rounded-lg text-sm font-medium ' +
                    (linkCopied ? 'bg-teal-900 text-teal-200 border border-teal-600' : 'bg-gray-700 hover:bg-gray-600 text-gray-200'),
                },
                linkCopied ? 'Copied' : 'Copy'
              )
            )
          ),
        React.createElement(
          'div',
          { className: 'flex flex-col gap-2' },
          React.createElement('span', { className: 'text-sm text-gray-400' }, 'Include by tag'),
          !readOnly &&
            React.createElement(
              'p',
              { className: 'text-xs text-gray-500 leading-relaxed' },
              'Select tags to auto-include all matching library items (must be backed up to Drive). ',
              'Matching items appear checked in the list below. On Save & upload they are merged into the share and recipients get access.'
            ),
          React.createElement(
            'div',
            { className: 'flex flex-wrap gap-2' },
            availableTags.map((t) =>
              React.createElement(
                'button',
                {
                  key: t,
                  type: 'button',
                  disabled: readOnly,
                  onClick: () => toggleTag(t),
                  className:
                    'px-2 py-1 rounded-lg text-xs font-medium border transition-colors ' +
                    (includeTags.includes(t)
                      ? 'bg-teal-800 border-teal-500 text-white'
                      : 'bg-gray-900 border-gray-600 text-gray-400 hover:border-gray-500'),
                },
                t
              )
            )
          ),
          !readOnly &&
            React.createElement(
              'div',
              { className: 'flex gap-2' },
              React.createElement('input', {
                type: 'text',
                value: tagInput,
                onChange: (e) => setTagInput(e.target.value),
                onKeyDown: (e) => e.key === 'Enter' && (e.preventDefault(), addTagFromInput()),
                placeholder: 'Add tag…',
                className: 'flex-1 bg-gray-900 border border-gray-600 rounded-lg px-3 py-1.5 text-sm text-gray-100',
              }),
              React.createElement(
                'button',
                {
                  type: 'button',
                  onClick: addTagFromInput,
                  className: 'px-3 py-1.5 rounded-lg bg-gray-700 text-sm text-gray-200',
                },
                'Add'
              )
            )
        ),
        React.createElement(
          'div',
          { className: 'flex flex-col gap-2' },
          React.createElement('span', { className: 'text-sm text-gray-400' }, 'Include specific items (with Drive ID)'),
          !readOnly &&
            React.createElement(
              'p',
              { className: 'text-xs text-gray-500 leading-relaxed' },
              'Items matching selected tags above are auto-included (teal badge). You can also hand-pick additional items.'
            ),
          React.createElement(
            'div',
            { className: 'max-h-40 overflow-y-auto border border-gray-700 rounded-lg p-2 space-y-1' },
            pickableWithDriveId.length === 0 &&
              React.createElement('p', { className: 'text-xs text-gray-500' }, 'Back up items to Drive first to pick them here.'),
            pickableWithDriveId.map((p) => {
              const pid = String(p.driveId || '').trim();
              const manuallyPicked = explicitRefs.some((r) => String(r.driveId || '').trim() === pid);
              const tagMatched = tagMatchedDriveIds.has(pid);
              const included = manuallyPicked || tagMatched;
              return React.createElement(
                'button',
                {
                  key: p.key,
                  type: 'button',
                  disabled: readOnly,
                  onClick: () => toggleExplicit(p),
                  className:
                    'flex w-full items-center gap-2 text-left text-sm rounded-lg px-2 py-1.5 transition-colors ' +
                    (included ? 'bg-teal-900/40 text-white border border-teal-600/50' : 'text-gray-300 hover:bg-gray-900/80 border border-transparent'),
                },
                React.createElement('span', {
                  className:
                    'flex h-4 w-4 shrink-0 items-center justify-center rounded border text-[10px] leading-none ' +
                    (included ? 'border-teal-400 bg-teal-600 text-white' : 'border-gray-500'),
                },
                included ? '✓' : ''),
                React.createElement('span', { className: 'truncate' }, p.label),
                tagMatched && !manuallyPicked &&
                  React.createElement('span', { className: 'ml-auto shrink-0 text-[10px] text-teal-400 font-semibold' }, 'tag')
              );
            })
          ),
          combinedExplicitCount > 0 &&
            React.createElement(
              'p',
              { className: 'text-xs text-gray-500 mt-1' },
              `${combinedExplicitCount} item${combinedExplicitCount === 1 ? '' : 's'} will be shared on Save & upload`
            )
        ),
        readOnly &&
          onRefreshReceiver &&
          React.createElement(
            'button',
            {
              type: 'button',
              onClick: handleRefresh,
              disabled: refreshing,
              className: 'py-2 rounded-xl bg-gray-700 hover:bg-gray-600 text-sm text-gray-200 disabled:opacity-50',
            },
            refreshing ? 'Refreshing…' : 'Refresh from Drive'
          ),
        !readOnly &&
          React.createElement(
            'div',
            { className: 'flex justify-end gap-2 pt-2 border-t border-gray-700' },
            React.createElement(
              'button',
              {
                type: 'button',
                onClick: onClose,
                className: 'px-4 py-2 rounded-xl text-sm text-gray-300 hover:bg-gray-700',
              },
              'Cancel'
            ),
            React.createElement(
              'button',
              {
                type: 'button',
                onClick: handleSave,
                disabled: saving,
                className: 'px-4 py-2 rounded-xl text-sm font-bold bg-teal-700 hover:bg-teal-600 text-white disabled:opacity-50',
              },
              saving ? 'Saving…' : 'Save & upload'
            )
          )
      )
    )
  );
};

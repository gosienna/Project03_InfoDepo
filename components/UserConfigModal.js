
import React, { useState } from 'react';
import { invalidateUserConfigCache } from '../utils/userConfig.js';
import { getDriveAccessTokenForScope } from '../utils/driveAccessToken.js';
import { CONFIG_MANAGE_SCOPE } from '../utils/driveScopes.js';

async function saveConfigToDrive(accessToken, fileId, config) {
  const body = JSON.stringify(config, null, 2);
  const blob = new Blob([body], { type: 'application/json' });
  const form = new FormData();
  form.append('metadata', new Blob([JSON.stringify({ mimeType: 'application/json' })], { type: 'application/json' }));
  form.append('file', blob);
  const res = await fetch(
    `https://www.googleapis.com/upload/drive/v3/files/${encodeURIComponent(fileId)}?uploadType=multipart&fields=id`,
    { method: 'PATCH', headers: { Authorization: `Bearer ${accessToken}` }, body: form }
  );
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err.error?.message || res.statusText);
  }
}

async function syncDrivePermissions(accessToken, fileId, emails) {
  const listRes = await fetch(
    `https://www.googleapis.com/drive/v3/files/${encodeURIComponent(fileId)}/permissions?fields=permissions(id,type,emailAddress,role)&pageSize=100`,
    { headers: { Authorization: `Bearer ${accessToken}` } }
  );
  const listData = listRes.ok ? await listRes.json() : { permissions: [] };
  const current = (listData.permissions || []).filter(
    (p) => p.type === 'user' && p.role === 'reader'
  );

  const desired = new Set(emails.map((e) => e.trim().toLowerCase()).filter(Boolean));

  for (const p of current) {
    const email = (p.emailAddress || '').trim().toLowerCase();
    if (!desired.has(email)) {
      await fetch(
        `https://www.googleapis.com/drive/v3/files/${encodeURIComponent(fileId)}/permissions/${encodeURIComponent(p.id)}`,
        { method: 'DELETE', headers: { Authorization: `Bearer ${accessToken}` } }
      ).catch(() => {});
    }
  }

  const existing = new Set(current.map((p) => (p.emailAddress || '').trim().toLowerCase()));
  for (const email of desired) {
    if (existing.has(email)) continue;
    await fetch(
      `https://www.googleapis.com/drive/v3/files/${encodeURIComponent(fileId)}/permissions?sendNotificationEmail=false&fields=id`,
      {
        method: 'POST',
        headers: { Authorization: `Bearer ${accessToken}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ type: 'user', role: 'reader', emailAddress: email }),
      }
    ).catch(() => {});
  }
}

const ROLE_OPTIONS = ['editor', 'viewer'];

function UserRow({ email, entry, onChange, onRemove, isMaster }) {
  if (isMaster) {
    return React.createElement(
      'div',
      { className: 'flex items-center gap-2 bg-gray-700/50 border border-gray-600/40 rounded-lg px-3 py-1.5' },
      React.createElement(
        'svg',
        { xmlns: 'http://www.w3.org/2000/svg', className: 'h-4 w-4 text-yellow-400 shrink-0', fill: 'none', viewBox: '0 0 24 24', stroke: 'currentColor' },
        React.createElement('path', { strokeLinecap: 'round', strokeLinejoin: 'round', strokeWidth: 2, d: 'M5 3l14 9-14 9V3z' })
      ),
      React.createElement('span', { className: 'text-sm text-gray-300 flex-1 min-w-0 truncate' }, email),
      React.createElement('span', { className: 'text-xs text-yellow-400/80 font-medium shrink-0' }, 'master'),
      React.createElement('input', {
        type: 'text',
        value: entry.folderId || '',
        onChange: (e) => onChange(email, { ...entry, role: 'master', folderId: e.target.value }),
        placeholder: 'Folder ID',
        className: 'w-28 bg-gray-800 border border-gray-600 text-gray-200 text-xs rounded px-2 py-1 placeholder-gray-500 font-mono',
        title: 'Google Drive folder ID for master',
      })
    );
  }

  return React.createElement(
    'div',
    { className: 'flex items-center gap-2 bg-gray-700 rounded-lg px-3 py-1.5' },
    React.createElement('span', { className: 'text-sm text-gray-200 flex-1 min-w-0 truncate', title: email }, email),
    React.createElement(
      'select',
      {
        value: entry.role,
        onChange: (e) => onChange(email, { ...entry, role: e.target.value }),
        className: 'bg-gray-800 border border-gray-600 text-gray-200 text-xs rounded px-2 py-1 cursor-pointer shrink-0',
      },
      ROLE_OPTIONS.map((r) => React.createElement('option', { key: r, value: r }, r))
    ),
    entry.role !== 'viewer'
      ? React.createElement('input', {
          type: 'text',
          value: entry.folderId || '',
          onChange: (e) => onChange(email, { ...entry, folderId: e.target.value }),
          placeholder: 'Folder ID',
          className: 'w-28 bg-gray-800 border border-gray-600 text-gray-200 text-xs rounded px-2 py-1 placeholder-gray-500 font-mono',
          title: 'Google Drive folder ID for this user',
        })
      : React.createElement(
          'span',
          {
            className: 'w-28 text-center bg-gray-800 border border-gray-600 text-gray-400 text-[11px] rounded px-2 py-1',
            title: 'Viewer does not require a folder ID',
          },
          'N/A'
        ),
    React.createElement(
      'button',
      {
        onClick: () => onRemove(email),
        className: 'text-gray-400 hover:text-red-400 transition-colors shrink-0',
        title: 'Remove',
      },
      React.createElement(
        'svg',
        { xmlns: 'http://www.w3.org/2000/svg', className: 'h-4 w-4', fill: 'none', viewBox: '0 0 24 24', stroke: 'currentColor' },
        React.createElement('path', { strokeLinecap: 'round', strokeLinejoin: 'round', strokeWidth: 2, d: 'M6 18L18 6M6 6l12 12' })
      )
    )
  );
}

export const UserConfigModal = ({ config, onClose, onSaved }) => {
  const masterEmail = (import.meta.env.VITE_MASTER || '').trim().toLowerCase();
  const configFileId = import.meta.env.VITE_CONFIG || '';

  const initialUsers = { ...(config.users || {}) };
  if (masterEmail && !initialUsers[masterEmail]) {
    initialUsers[masterEmail] = { role: 'master' };
  }
  const [users, setUsers] = useState(initialUsers);
  const [newEmail, setNewEmail] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState(null);

  const sortedEmails = Object.keys(users).sort((a, b) => {
    if (a === masterEmail) return -1;
    if (b === masterEmail) return 1;
    return a.localeCompare(b);
  });

  const handleChange = (email, entry) => {
    setUsers((prev) => ({ ...prev, [email]: entry }));
  };

  const handleRemove = (email) => {
    setUsers((prev) => {
      const next = { ...prev };
      delete next[email];
      return next;
    });
  };

  const handleAdd = () => {
    const e = newEmail.trim().toLowerCase();
    if (!e || users[e]) { setNewEmail(''); return; }
    setUsers((prev) => ({ ...prev, [e]: { role: 'editor' } }));
    setNewEmail('');
  };

  const handleSave = async () => {
    if (!configFileId) { setError('VITE_CONFIG is not set.'); return; }
    setSaving(true);
    setError(null);
    try {
      const token = await getDriveAccessTokenForScope(CONFIG_MANAGE_SCOPE);
      const newConfig = { master: masterEmail, users };
      await saveConfigToDrive(token, configFileId, newConfig);
      const allEmails = Object.keys(users).filter((e) => e !== masterEmail);
      await syncDrivePermissions(token, configFileId, allEmails);
      invalidateUserConfigCache();
      onSaved(newConfig);
    } catch (err) {
      console.error('[UserConfigModal] save failed', err);
      const msg = String(err?.message || '');
      if (msg.includes('write access to the file')) {
        setError('Google Drive did not grant write access to this config file. Please try Save again and accept the permission prompt.');
      } else {
        setError(msg || 'Failed to save config.');
      }
    } finally {
      setSaving(false);
    }
  };

  return React.createElement(
    'div',
    {
      className: 'fixed inset-0 bg-black/70 flex items-center justify-center z-50 p-4',
      onClick: (e) => { if (e.target === e.currentTarget) onClose(); },
    },
    React.createElement(
      'div',
      { className: 'bg-gray-800 rounded-2xl shadow-2xl w-full max-w-lg flex flex-col border border-gray-700' },

      React.createElement(
        'div',
        { className: 'flex items-center justify-between px-6 py-4 border-b border-gray-700' },
        React.createElement('h2', { className: 'text-lg font-bold text-gray-100' }, 'Manage Users'),
        React.createElement(
          'button',
          {
            onClick: onClose,
            className: 'text-gray-400 hover:text-gray-200 p-1 rounded-lg hover:bg-gray-700 transition-colors',
          },
          React.createElement(
            'svg',
            { xmlns: 'http://www.w3.org/2000/svg', className: 'h-5 w-5', fill: 'none', viewBox: '0 0 24 24', stroke: 'currentColor' },
            React.createElement('path', { strokeLinecap: 'round', strokeLinejoin: 'round', strokeWidth: 2, d: 'M6 18L18 6M6 6l12 12' })
          )
        )
      ),

      React.createElement(
        'div',
        { className: 'flex flex-col gap-3 p-6 overflow-y-auto max-h-[60vh]' },
        sortedEmails.map((email) =>
          React.createElement(UserRow, {
            key: email,
            email,
            entry: users[email],
            onChange: handleChange,
            onRemove: handleRemove,
            isMaster: email === masterEmail,
          })
        ),
        React.createElement(
          'div',
          { className: 'flex gap-2 mt-2' },
          React.createElement('input', {
            type: 'email',
            value: newEmail,
            onChange: (e) => setNewEmail(e.target.value),
            onKeyDown: (e) => { if (e.key === 'Enter') { e.preventDefault(); handleAdd(); } },
            placeholder: 'user@example.com',
            className: 'flex-1 bg-gray-700 border border-gray-600 text-gray-100 rounded-lg px-3 py-1.5 text-sm focus:outline-none focus:border-indigo-500 placeholder-gray-500',
          }),
          React.createElement(
            'button',
            {
              onClick: handleAdd,
              className: 'px-3 py-1.5 bg-indigo-600 hover:bg-indigo-500 text-white text-sm rounded-lg transition-colors',
            },
            'Add'
          )
        ),
        error && React.createElement('p', { className: 'text-xs text-red-400' }, error)
      ),

      React.createElement(
        'div',
        { className: 'flex items-center justify-end gap-3 px-6 py-4 border-t border-gray-700' },
        React.createElement(
          'button',
          {
            onClick: onClose,
            className: 'px-5 py-2 rounded-xl text-sm font-medium text-gray-300 hover:text-gray-100 hover:bg-gray-700 transition-colors',
          },
          'Cancel'
        ),
        React.createElement(
          'button',
          {
            onClick: handleSave,
            disabled: saving,
            className: 'px-5 py-2 rounded-xl text-sm font-bold bg-indigo-600 hover:bg-indigo-500 text-white transition-colors disabled:opacity-40 disabled:cursor-not-allowed flex items-center gap-2',
          },
          saving && React.createElement('div', { className: 'h-4 w-4 border-2 border-white border-t-transparent rounded-full animate-spin' }),
          saving ? 'Saving…' : 'Save'
        )
      )
    )
  );
};

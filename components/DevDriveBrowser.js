
import React, { useState, useEffect, useCallback, useRef } from 'react';
import { Spinner } from './Spinner.js';

const SCOPES = 'https://www.googleapis.com/auth/drive.readonly';
const SUPPORTED_MIME_TYPES = [
  'application/epub+zip',
  'application/pdf',
  'text/plain',
];

export const DevDriveBrowser = ({ onFileSelect, onClose }) => {
  const [status, setStatus] = useState('Connecting...');
  const [error, setError] = useState(null);
  const [files, setFiles] = useState([]);
  const [downloading, setDownloading] = useState(null);
  const oauthToken = useRef(null);

  const clientId = import.meta.env.VITE_TEST_CLIENT_ID;
  const apiKey = import.meta.env.VITE_TEST_API_KEY;
  const folderId = import.meta.env.VITE_TEST_DRIVE_FOLDER_ID;

  const listFiles = useCallback(async (token) => {
    setStatus('Loading files...');
    try {
      const query = encodeURIComponent(`'${folderId}' in parents and trashed = false`);
      const fields = encodeURIComponent('files(id,name,mimeType,size)');
      const res = await fetch(
        `https://www.googleapis.com/drive/v3/files?q=${query}&fields=${fields}&key=${apiKey}`,
        { headers: { Authorization: `Bearer ${token}` } }
      );
      if (!res.ok) {
        const err = await res.json();
        throw new Error(err.error?.message || res.statusText);
      }
      const data = await res.json();
      const supported = (data.files || []).filter(f => SUPPORTED_MIME_TYPES.includes(f.mimeType));
      setFiles(supported);
      setStatus(supported.length ? '' : 'No supported files found in test folder.');
    } catch (err) {
      setError(err.message);
    }
  }, [folderId, apiKey]);

  useEffect(() => {
    if (!clientId || !apiKey || !folderId) {
      setError('Missing env vars. Fill VITE_TEST_CLIENT_ID, VITE_TEST_API_KEY, and VITE_TEST_DRIVE_FOLDER_ID in .env');
      return;
    }

    const init = () => {
      if (typeof google === 'undefined' || !google.accounts) {
        setTimeout(init, 100);
        return;
      }
      try {
        const tokenClient = google.accounts.oauth2.initTokenClient({
          client_id: clientId,
          scope: SCOPES,
          callback: (res) => {
            if (res.error) {
              setError(`Auth failed: ${res.error_description || res.error}`);
              return;
            }
            oauthToken.current = res.access_token;
            listFiles(res.access_token);
          },
        });
        tokenClient.requestAccessToken({ prompt: '' });
      } catch (err) {
        setError(err.message);
      }
    };
    init();
  }, [clientId, apiKey, folderId, listFiles]);

  const handleDownload = async (file) => {
    setDownloading(file.id);
    try {
      const res = await fetch(
        `https://www.googleapis.com/drive/v3/files/${file.id}?alt=media`,
        { headers: { Authorization: `Bearer ${oauthToken.current}` } }
      );
      if (!res.ok) {
        const err = await res.json();
        throw new Error(err.error?.message || res.statusText);
      }
      const blob = await res.blob();
      await onFileSelect(file.name, file.mimeType, blob);
      onClose();
    } catch (err) {
      setError(`Failed to download "${file.name}": ${err.message}`);
    } finally {
      setDownloading(null);
    }
  };

  const formatSize = (bytes) => {
    if (!bytes) return '';
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  };

  return React.createElement(
    'div',
    { className: 'fixed inset-0 bg-black/80 flex items-center justify-center z-50 p-4 backdrop-blur-sm' },
    React.createElement(
      'div',
      { className: 'bg-gray-800 rounded-2xl shadow-2xl w-full max-w-lg border border-gray-700 overflow-hidden' },
      // Header
      React.createElement(
        'div',
        { className: 'flex items-center justify-between px-6 py-4 border-b border-gray-700' },
        React.createElement(
          'div',
          null,
          React.createElement('h2', { className: 'text-lg font-bold text-white' }, 'Test Drive Folder'),
          React.createElement('p', { className: 'text-xs text-yellow-400 font-mono mt-0.5' }, 'DEV MODE')
        ),
        React.createElement(
          'button',
          { onClick: onClose, className: 'text-gray-500 hover:text-white' },
          React.createElement(
            'svg',
            { xmlns: 'http://www.w3.org/2000/svg', className: 'h-6 w-6', fill: 'none', viewBox: '0 0 24 24', stroke: 'currentColor' },
            React.createElement('path', { strokeLinecap: 'round', strokeLinejoin: 'round', strokeWidth: 2, d: 'M6 18L18 6M6 6l12 12' })
          )
        )
      ),
      // Body
      React.createElement(
        'div',
        { className: 'p-6' },
        error
          ? React.createElement('p', { className: 'text-red-400 text-sm' }, error)
          : files.length === 0
          ? React.createElement(
              'div',
              { className: 'flex flex-col items-center gap-3 py-6' },
              React.createElement(Spinner, null),
              React.createElement('p', { className: 'text-gray-400 text-sm' }, status)
            )
          : React.createElement(
              'ul',
              { className: 'space-y-2 max-h-80 overflow-y-auto' },
              files.map((file) =>
                React.createElement(
                  'li',
                  { key: file.id, className: 'flex items-center justify-between gap-3 bg-gray-900/60 rounded-xl px-4 py-3 border border-gray-700' },
                  React.createElement(
                    'div',
                    { className: 'min-w-0' },
                    React.createElement('p', { className: 'text-sm font-medium text-white truncate' }, file.name),
                    React.createElement('p', { className: 'text-xs text-gray-500 mt-0.5' }, formatSize(parseInt(file.size)))
                  ),
                  React.createElement(
                    'button',
                    {
                      onClick: () => handleDownload(file),
                      disabled: !!downloading,
                      className: 'shrink-0 bg-indigo-600 hover:bg-indigo-500 disabled:opacity-50 text-white text-xs font-bold px-4 py-2 rounded-lg transition-colors'
                    },
                    downloading === file.id ? 'Loading...' : 'Import'
                  )
                )
              )
            )
      )
    )
  );
};

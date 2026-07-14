import { useEffect, useRef } from 'react';
import { itemNeedsBackupUpload } from '../utils/driveSync.js';
import { getDriveCredentials } from '../utils/driveCredentials.js';

export function useUnloadGuard({ isSyncing, items, channels, desks }) {
  const stateRef = useRef({ isSyncing, items, channels, desks });
  stateRef.current = { isSyncing, items, channels, desks };

  useEffect(() => {
    const hasCredentials = !!getDriveCredentials().clientId?.trim();
    if (!hasCredentials) return;

    const handler = (e) => {
      const { isSyncing: syncing, items: itms, channels: chs, desks: dks } = stateRef.current;
      if (syncing) {
        e.preventDefault();
        e.returnValue = '';
        return;
      }
      const hasDirtyItems = Array.isArray(itms) && itms.some((i) => itemNeedsBackupUpload(i));
      const hasDirtyChannels = Array.isArray(chs) && chs.some((c) => itemNeedsBackupUpload(c));
      const hasDirtyDesks = Array.isArray(dks) && dks.some((d) => d.dirty === true);
      if (hasDirtyItems || hasDirtyChannels || hasDirtyDesks) {
        e.preventDefault();
        e.returnValue = '';
      }
    };
    window.addEventListener('beforeunload', handler);
    return () => window.removeEventListener('beforeunload', handler);
  }, []);
}

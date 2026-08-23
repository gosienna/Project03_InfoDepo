
import React, { useState } from 'react';
import { BookIcon } from './icons/BookIcon.js';
import { UserConfigModal } from './UserConfigModal.js';
import { fetchUserConfig } from '../utils/userConfig.js';
import { getOwnerDriveAccessToken } from '../utils/driveAccessToken.js';

export const Header = ({ onBack, userEmail, mode, onModeChange, showModeToggle, userType, onSystemSettings, onSync, isSyncing, syncProgress }) => {
  const [userConfigOpen, setUserConfigOpen] = useState(false);
  const [configData, setConfigData] = useState(null);
  const normalizedRole = String(userType || '').trim().toLowerCase();
  const roleLabel = normalizedRole ? normalizedRole[0].toUpperCase() + normalizedRole.slice(1) : '';
  const roleBadgeClass =
    normalizedRole === 'master'
      ? 'bg-yellow-100 text-yellow-700 border-yellow-200'
      : normalizedRole === 'editor'
        ? 'bg-blue-100 text-blue-700 border-blue-200'
        : normalizedRole === 'viewer'
          ? 'bg-emerald-100 text-emerald-700 border-emerald-200'
          : 'bg-gray-100 text-gray-700 border-gray-200';

  const openUserConfig = async () => {
    try {
      const token = await getOwnerDriveAccessToken();
      const cfg = await fetchUserConfig(token);
      setConfigData(cfg);
      setUserConfigOpen(true);
    } catch (err) {
      console.error('[Header] failed to load user config', err);
      window.alert(err?.message || 'Could not load user config.');
    }
  };

  return React.createElement(
    React.Fragment,
    null,
    React.createElement(
      "header",
      { className: "sticky top-0 z-[100] bg-theme-50 shadow-xl p-4 flex items-center justify-between gap-4 border-b border-gray-200" },
      React.createElement(
        "div",
        { className: "flex items-center min-w-0 flex-1" },
        onBack &&
          React.createElement(
            "button",
            {
              onClick: () => onBack(),
              className: "p-2 -ml-2 mr-2 text-gray-600 hover:text-gray-900 transition-colors duration-200 rounded-full hover:bg-gray-100 cursor-pointer flex-shrink-0",
              "aria-label": "Back to Library"
            },
            React.createElement(
              "svg",
              { xmlns: "http://www.w3.org/2000/svg", className: "h-6 w-6 pointer-events-none", fill: "none", viewBox: "0 0 24 24", stroke: "currentColor" },
              React.createElement("path", { strokeLinecap: "round", strokeLinejoin: "round", strokeWidth: 2, d: "M15 19l-7-7 7-7" })
            )
          ),
        React.createElement(
          "div",
          { className: "flex items-center space-x-2 min-w-0" },
          React.createElement(BookIcon, { className: "h-8 w-8 text-theme-600 pointer-events-none flex-shrink-0" }),
          React.createElement(
            "h1",
            { className: "text-xl sm:text-2xl font-bold text-theme-900 tracking-tight pointer-events-none truncate" },
            "Personal Information Depository"
          )
        )
      ),
      showModeToggle &&
        React.createElement(
          "div",
          { className: "flex items-center gap-1 bg-gray-200 rounded-lg p-1 flex-shrink-0" },
          React.createElement(
            "button",
            {
              onClick: () => onModeChange('library'),
              className: `px-3 py-1 text-sm rounded-md transition-colors duration-150 ${
                mode === 'library'
                  ? 'bg-theme-500 text-buttontext font-medium'
                  : 'text-gray-600 hover:text-gray-900 hover:bg-gray-300'
              }`,
            },
            "Library"
          ),
          React.createElement(
            "button",
            {
              onClick: () => onModeChange('desk'),
              className: `px-3 py-1 text-sm rounded-md transition-colors duration-150 ${
                mode === 'desk'
                  ? 'bg-theme-500 text-buttontext font-medium'
                  : 'text-gray-600 hover:text-gray-900 hover:bg-gray-300'
              }`,
            },
            "Desk"
          ),
          React.createElement(
            "button",
            {
              onClick: () => onModeChange('explorer'),
              className: `px-3 py-1 text-sm rounded-md transition-colors duration-150 ${
                mode === 'explorer'
                  ? 'bg-theme-500 text-buttontext font-medium'
                  : 'text-gray-600 hover:text-gray-900 hover:bg-gray-300'
              }`,
            },
            "Explorer"
          )
        ),
      React.createElement(
        "div",
        { className: "flex items-center gap-2 flex-shrink-0" },
        onSync &&
          React.createElement(
            "button",
            {
              onClick: onSync,
              disabled: isSyncing,
              className: "flex items-center gap-1.5 bg-theme-500 hover:bg-theme-600 disabled:opacity-50 text-buttontext text-sm font-bold py-2 px-4 rounded-xl transition-all active:scale-95",
              title: isSyncing && syncProgress
                ? syncProgress
                : "Back up local items to Drive, then sync Drive → local",
            },
            React.createElement(
              "svg",
              {
                xmlns: "http://www.w3.org/2000/svg",
                className: `h-4 w-4${isSyncing ? ' animate-spin' : ''}`,
                fill: "none",
                viewBox: "0 0 24 24",
                stroke: "currentColor",
              },
              React.createElement("path", { strokeLinecap: "round", strokeLinejoin: "round", strokeWidth: 2, d: "M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" })
            ),
            isSyncing ? "Syncing..." : "Sync"
          ),
        onSystemSettings &&
          React.createElement(
            "button",
            {
              onClick: onSystemSettings,
              className: "text-gray-600 hover:text-gray-800 p-2 rounded-xl hover:bg-gray-100 transition-colors",
              title: "System settings",
            },
            React.createElement(
              "svg",
              { xmlns: "http://www.w3.org/2000/svg", className: "h-5 w-5", fill: "none", viewBox: "0 0 24 24", stroke: "currentColor" },
              React.createElement("path", { strokeLinecap: "round", strokeLinejoin: "round", strokeWidth: 2, d: "M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.065 2.572c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.572 1.065c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.065-2.572c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z" }),
              React.createElement("path", { strokeLinecap: "round", strokeLinejoin: "round", strokeWidth: 2, d: "M15 12a3 3 0 11-6 0 3 3 0 016 0z" })
            )
          ),
        userType === 'master' &&
          React.createElement(
            "button",
            {
              onClick: openUserConfig,
              className: "flex items-center gap-1.5 text-xs font-medium text-yellow-700 hover:text-yellow-800 bg-yellow-100 hover:bg-yellow-200 px-3 py-1.5 rounded-lg transition-colors",
              title: "Manage users",
            },
            React.createElement(
              "svg",
              { xmlns: "http://www.w3.org/2000/svg", className: "h-4 w-4", fill: "none", viewBox: "0 0 24 24", stroke: "currentColor" },
              React.createElement("path", { strokeLinecap: "round", strokeLinejoin: "round", strokeWidth: 2, d: "M17 20h5v-2a3 3 0 00-5.356-1.857M17 20H7m10 0v-2c0-.656-.126-1.283-.356-1.857M7 20H2v-2a3 3 0 015.356-1.857M7 20v-2c0-.656.126-1.283.356-1.857m0 0a5.002 5.002 0 019.288 0M15 7a3 3 0 11-6 0 3 3 0 016 0z" })
            ),
            "Manage Users"
          ),
        userEmail &&
          React.createElement(
            "div",
            { className: "text-right flex flex-col items-end gap-1" },
            roleLabel &&
              React.createElement(
                "span",
                {
                  className: `inline-flex items-center px-2 py-0.5 rounded-md text-[10px] uppercase tracking-wide font-semibold border ${roleBadgeClass}`,
                  title: `Role: ${roleLabel}`,
                },
                roleLabel
              ),
            React.createElement(
              "span",
              {
                className: "text-xs sm:text-sm text-gray-600 block truncate max-w-[10rem] sm:max-w-xs",
                title: userEmail,
              },
              userEmail
            )
          )
      )
    ),
    userConfigOpen && configData &&
      React.createElement(UserConfigModal, {
        config: configData,
        onClose: () => setUserConfigOpen(false),
        onSaved: (newConfig) => {
          setConfigData(newConfig);
          setUserConfigOpen(false);
        },
      })
  );
};

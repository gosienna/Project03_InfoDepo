
import React, { useState } from 'react';
import { BookIcon } from './icons/BookIcon.js';
import { UserConfigModal } from './UserConfigModal.js';
import { fetchUserConfig } from '../utils/userConfig.js';
import { getOwnerDriveAccessToken } from '../utils/driveAccessToken.js';

export const Header = ({ onBack, userEmail, mode, onModeChange, showModeToggle, userType }) => {
  const [userConfigOpen, setUserConfigOpen] = useState(false);
  const [configData, setConfigData] = useState(null);
  const normalizedRole = String(userType || '').trim().toLowerCase();
  const roleLabel = normalizedRole ? normalizedRole[0].toUpperCase() + normalizedRole.slice(1) : '';
  const roleBadgeClass =
    normalizedRole === 'master'
      ? 'bg-yellow-900/40 text-yellow-300 border-yellow-700/50'
      : normalizedRole === 'editor'
        ? 'bg-blue-900/40 text-blue-300 border-blue-700/50'
        : normalizedRole === 'viewer'
          ? 'bg-emerald-900/40 text-emerald-300 border-emerald-700/50'
          : 'bg-gray-700/40 text-gray-300 border-gray-600/50';

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
      { className: "sticky top-0 z-[100] bg-gray-800 shadow-xl p-4 flex items-center justify-between gap-4 border-b border-gray-700/50" },
      React.createElement(
        "div",
        { className: "flex items-center min-w-0 flex-1" },
        onBack &&
          React.createElement(
            "button",
            {
              onClick: () => onBack(),
              className: "p-2 -ml-2 mr-2 text-gray-400 hover:text-white transition-colors duration-200 rounded-full hover:bg-gray-700 cursor-pointer flex-shrink-0",
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
          React.createElement(BookIcon, { className: "h-8 w-8 text-indigo-400 pointer-events-none flex-shrink-0" }),
          React.createElement(
            "h1",
            { className: "text-xl sm:text-2xl font-bold text-white tracking-tight pointer-events-none truncate" },
            "Personal Information Depository"
          )
        )
      ),
      showModeToggle && userType !== 'viewer' &&
        React.createElement(
          "div",
          { className: "flex items-center gap-1 bg-gray-700 rounded-lg p-1 flex-shrink-0" },
          React.createElement(
            "button",
            {
              onClick: () => onModeChange('library'),
              className: `px-3 py-1 text-sm rounded-md transition-colors duration-150 ${
                mode === 'library'
                  ? 'bg-indigo-600 text-white font-medium'
                  : 'text-gray-400 hover:text-white hover:bg-gray-600'
              }`,
            },
            "Library"
          ),
          React.createElement(
            "button",
            {
              onClick: () => onModeChange('explorer'),
              className: `px-3 py-1 text-sm rounded-md transition-colors duration-150 ${
                mode === 'explorer'
                  ? 'bg-indigo-600 text-white font-medium'
                  : 'text-gray-400 hover:text-white hover:bg-gray-600'
              }`,
            },
            "Explorer"
          )
        ),
      React.createElement(
        "div",
        { className: "flex items-center gap-2 flex-shrink-0" },
        userType === 'master' &&
          React.createElement(
            "button",
            {
              onClick: openUserConfig,
              className: "flex items-center gap-1.5 text-xs font-medium text-yellow-400 hover:text-yellow-300 bg-yellow-400/10 hover:bg-yellow-400/20 px-3 py-1.5 rounded-lg transition-colors",
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
                className: "text-xs sm:text-sm text-gray-400 block truncate max-w-[10rem] sm:max-w-xs",
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

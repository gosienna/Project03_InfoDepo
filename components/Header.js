
import React from 'react';
import { BookIcon } from './icons/BookIcon.js';

export const Header = ({ onBack, userEmail, mode, onModeChange, showModeToggle }) => {
  return React.createElement(
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
    showModeToggle &&
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
    userEmail &&
      React.createElement(
        "div",
        { className: "flex-shrink-0 text-right" },
        React.createElement(
          "span",
          {
            className: "text-xs sm:text-sm text-gray-400 block truncate max-w-[10rem] sm:max-w-xs",
            title: userEmail,
          },
          userEmail
        )
      )
  );
};

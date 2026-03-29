
import React from 'react';
import { BookIcon } from './icons/BookIcon.js';

export const Header = ({ onBack }) => {
  return React.createElement(
    "header",
    { className: "relative z-[100] bg-gray-800 shadow-xl p-4 flex items-center border-b border-gray-700/50" },
    onBack &&
      React.createElement(
        "button",
        {
          onClick: () => onBack(),
          className: "p-2 -ml-2 mr-2 text-gray-400 hover:text-white transition-colors duration-200 rounded-full hover:bg-gray-700 cursor-pointer",
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
      { className: "flex items-center space-x-2" },
      React.createElement(BookIcon, { className: "h-8 w-8 text-indigo-400 pointer-events-none" }),
      React.createElement(
        "h1",
        { className: "text-xl sm:text-2xl font-bold text-white tracking-tight pointer-events-none" },
        "Zenith Reader"
      )
    )
  );
};
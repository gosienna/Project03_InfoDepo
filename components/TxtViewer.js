
import React, { useState, useEffect, useRef } from 'react';
import { Spinner } from './Spinner.js';

export const TxtViewer = ({ data, itemId, initialReadingPosition, onSaveReadingPosition, storeName }) => {
  const [text, setText] = useState('');
  const [isLoading, setIsLoading] = useState(true);
  const containerRef = useRef(null);
  const saveDebounceRef = useRef(null);
  const lastSavedScrollTopRef = useRef(null);

  useEffect(() => {
    setIsLoading(true);
    const reader = new FileReader();
    reader.onload = (e) => {
      setText(e.target?.result);
      setIsLoading(false);
    };
    reader.onerror = () => {
      setText('Error reading file.');
      setIsLoading(false);
    }
    reader.readAsText(data);
  }, [data]);

  useEffect(() => {
    if (isLoading) return;
    const mount = containerRef.current;
    if (!mount) return;
    const savedScrollTop = Number(initialReadingPosition?.txtScrollTop);
    if (Number.isFinite(savedScrollTop) && savedScrollTop >= 0) {
      mount.scrollTop = savedScrollTop;
      requestAnimationFrame(() => { mount.scrollTop = savedScrollTop; });
    }
  }, [isLoading, initialReadingPosition]);

  useEffect(() => {
    if (!onSaveReadingPosition || !storeName || !itemId) return undefined;
    const mount = containerRef.current;
    if (!mount) return undefined;
    const saveNow = () => {
      const scrollTop = Math.max(0, Math.round(mount.scrollTop));
      if (lastSavedScrollTopRef.current === scrollTop) return;
      lastSavedScrollTopRef.current = scrollTop;
      onSaveReadingPosition(itemId, storeName, { kind: 'txt', txtScrollTop: scrollTop }).catch(() => {});
    };
    const onScroll = () => {
      if (saveDebounceRef.current) clearTimeout(saveDebounceRef.current);
      saveDebounceRef.current = setTimeout(saveNow, 250);
    };
    mount.addEventListener('scroll', onScroll, { passive: true });
    return () => {
      mount.removeEventListener('scroll', onScroll);
      if (saveDebounceRef.current) clearTimeout(saveDebounceRef.current);
      saveNow();
    };
  }, [itemId, onSaveReadingPosition, storeName]);

  return React.createElement(
    "div",
    { ref: containerRef, className: "w-full h-full bg-gray-800 p-6 rounded-lg shadow-lg overflow-y-auto" },
    isLoading ? (
      React.createElement(
        "div",
        { className: "flex items-center justify-center h-full" },
        React.createElement(Spinner, null)
      )
    ) : (
      React.createElement(
        "pre",
        { className: "whitespace-pre-wrap text-gray-200 font-serif text-lg leading-relaxed" },
        text
      )
    )
  );
};
import React, { useState, useEffect, useRef, useCallback } from 'react';

const COLOR_SWATCHES = [
  '#ef4444', // red
  '#3b82f6', // blue
  '#facc15', // yellow
  '#22c55e', // green
  '#ffffff', // white
  '#000000', // black
];

export const ImageEditor = ({
  src,
  filename,
  onSave,
  onClose,
  isBlank = false,
  initialWidth = 800,
  initialHeight = 600,
  backgroundColor = '#ffffff',
}) => {
  const canvasRef      = useRef(null);
  const imgRef         = useRef(null);
  const isDrawingRef   = useRef(false);
  const lastPosRef     = useRef({ x: 0, y: 0 });
  const activePointerIdRef = useRef(null);

  const [tool,       setTool]       = useState('pen');   // 'pen' | 'text'
  const [color,      setColor]      = useState('#ef4444');
  const [lineWidth,  setLineWidth]  = useState(3);
  const [fontSize,   setFontSize]   = useState(20);
  const [undoStack,  setUndoStack]  = useState([]);      // ImageData[]
  const [inputState, setInputState] = useState(null);    // { x, y, value } | null
  const [isSaving,   setIsSaving]   = useState(false);
  const [loaded,     setLoaded]     = useState(false);

  const initBlankCanvas = useCallback((w, h, keepCurrent = false) => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const safeW = Math.max(64, Math.min(4096, Number(w) || 800));
    const safeH = Math.max(64, Math.min(4096, Number(h) || 600));
    const prev = keepCurrent ? canvas.toDataURL('image/png') : null;
    canvas.width = safeW;
    canvas.height = safeH;
    const ctx = canvas.getContext('2d');
    ctx.fillStyle = backgroundColor || '#ffffff';
    ctx.fillRect(0, 0, safeW, safeH);
    if (prev) {
      const previous = new window.Image();
      previous.onload = () => {
        ctx.drawImage(previous, 0, 0, safeW, safeH);
        setUndoStack([ctx.getImageData(0, 0, safeW, safeH)]);
        setLoaded(true);
      };
      previous.src = prev;
    } else {
      setUndoStack([ctx.getImageData(0, 0, safeW, safeH)]);
      setLoaded(true);
    }
  }, [backgroundColor]);

  // Load image onto canvas on mount
  useEffect(() => {
    if (isBlank) {
      initBlankCanvas(initialWidth, initialHeight, false);
      return;
    }
    const img = new window.Image();
    img.crossOrigin = 'anonymous';
    img.onload = () => {
      imgRef.current = img;
      const canvas = canvasRef.current;
      if (!canvas) return;
      const MAX = 1200;
      const scale = Math.min(1, MAX / Math.max(img.naturalWidth, img.naturalHeight, 1));
      canvas.width  = Math.round(img.naturalWidth  * scale);
      canvas.height = Math.round(img.naturalHeight * scale);
      const ctx = canvas.getContext('2d');
      ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
      setUndoStack([ctx.getImageData(0, 0, canvas.width, canvas.height)]);
      setLoaded(true);
    };
    img.onerror = () => setLoaded(true); // show blank canvas on error
    img.src = src;
  }, [src, isBlank, initialWidth, initialHeight, initBlankCanvas]);

  // Get canvas-relative position from pointer event
  const getCanvasPos = useCallback((e) => {
    const canvas = canvasRef.current;
    if (!canvas) return { x: 0, y: 0 };
    const rect = canvas.getBoundingClientRect();
    const scaleX = canvas.width  / rect.width;
    const scaleY = canvas.height / rect.height;
    return {
      x: (e.clientX - rect.left) * scaleX,
      y: (e.clientY - rect.top)  * scaleY,
    };
  }, []);

  // Push current canvas state onto undo stack
  const pushUndo = useCallback(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    setUndoStack(prev => [...prev, ctx.getImageData(0, 0, canvas.width, canvas.height)]);
  }, []);

  // ── Pointer handlers (mouse/touch/stylus) ─────────────────────
  const handlePointerDown = useCallback((e) => {
    // Only left button for mouse; allow touch/stylus.
    if (e.pointerType === 'mouse' && e.button !== 0) return;
    e.preventDefault();
    activePointerIdRef.current = e.pointerId;
    e.currentTarget.setPointerCapture?.(e.pointerId);
    const pos = getCanvasPos(e);

    if (tool === 'text') {
      setInputState({ x: e.clientX, y: e.clientY, canvasX: pos.x, canvasY: pos.y, value: '' });
      return;
    }

    // pen
    pushUndo();
    isDrawingRef.current = true;
    lastPosRef.current   = pos;
    const canvas = canvasRef.current;
    const ctx    = canvas.getContext('2d');
    ctx.beginPath();
    ctx.moveTo(pos.x, pos.y);
    ctx.strokeStyle = color;
    ctx.lineWidth   = lineWidth;
    ctx.lineCap     = 'round';
    ctx.lineJoin    = 'round';
  }, [tool, color, lineWidth, getCanvasPos, pushUndo]);

  const handlePointerMove = useCallback((e) => {
    if (activePointerIdRef.current !== null && e.pointerId !== activePointerIdRef.current) return;
    if (!isDrawingRef.current) return;
    e.preventDefault();
    const pos = getCanvasPos(e);
    const ctx = canvasRef.current?.getContext('2d');
    if (!ctx) return;
    ctx.lineTo(pos.x, pos.y);
    ctx.stroke();
    lastPosRef.current = pos;
  }, [getCanvasPos]);

  const handlePointerUp = useCallback((e) => {
    if (activePointerIdRef.current !== null && e.pointerId !== activePointerIdRef.current) return;
    isDrawingRef.current = false;
    activePointerIdRef.current = null;
    e.currentTarget.releasePointerCapture?.(e.pointerId);
  }, []);

  // ── Text tool: stamp text on canvas ────────────────────────────
  const commitText = useCallback(() => {
    if (!inputState || !inputState.value.trim()) { setInputState(null); return; }
    pushUndo();
    const canvas = canvasRef.current;
    const ctx    = canvas.getContext('2d');
    ctx.font         = `bold ${fontSize}px sans-serif`;
    ctx.fillStyle    = color;
    ctx.fillText(inputState.value, inputState.canvasX, inputState.canvasY);
    setInputState(null);
  }, [inputState, color, fontSize, pushUndo]);

  // ── Undo ────────────────────────────────────────────────────────
  const handleUndo = useCallback(() => {
    if (undoStack.length <= 1) return;
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx    = canvas.getContext('2d');
    const prev   = undoStack[undoStack.length - 2];
    ctx.putImageData(prev, 0, 0);
    setUndoStack(s => s.slice(0, -1));
  }, [undoStack]);

  // ── Clear ───────────────────────────────────────────────────────
  const handleClear = useCallback(() => {
    const canvas = canvasRef.current;
    if (!canvas || !imgRef.current) return;
    const ctx = canvas.getContext('2d');
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    ctx.drawImage(imgRef.current, 0, 0, canvas.width, canvas.height);
    setUndoStack([ctx.getImageData(0, 0, canvas.width, canvas.height)]);
  }, []);

  // ── Save ────────────────────────────────────────────────────────
  const handleSave = useCallback(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    setIsSaving(true);
    canvas.toBlob(blob => {
      if (blob) onSave(blob, filename);
      setIsSaving(false);
    }, 'image/png');
  }, [filename, onSave]);

  // ── Keyboard shortcuts ──────────────────────────────────────────
  useEffect(() => {
    const handler = (e) => {
      if (e.key === 'Escape') {
        if (inputState) { setInputState(null); return; }
        onClose();
      }
      if ((e.metaKey || e.ctrlKey) && e.key === 'z') { e.preventDefault(); handleUndo(); }
      if ((e.metaKey || e.ctrlKey) && e.key === 's') { e.preventDefault(); handleSave(); }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [inputState, onClose, handleUndo, handleSave]);

  const toolBtn = (id, label, icon) =>
    React.createElement(
      'button',
      {
        onClick: () => setTool(id),
        title: label,
        className: `flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-sm font-medium transition-colors ${
          tool === id
            ? 'bg-indigo-600 text-white'
            : 'bg-gray-700 hover:bg-gray-600 text-gray-200'
        }`,
      },
      icon,
      label
    );

  return React.createElement(
    // Backdrop
    'div',
    {
      className: 'fixed inset-0 z-[1000] flex items-start justify-center bg-black/70 backdrop-blur-sm p-4 pt-20',
      onMouseDown: (e) => { if (e.target === e.currentTarget) onClose(); },
    },

    // Modal panel
    React.createElement(
      'div',
      {
        className: 'flex flex-col bg-gray-900 rounded-2xl shadow-2xl border border-gray-700 overflow-hidden',
        style: { maxWidth: '92vw', maxHeight: 'calc(100vh - 6rem)', width: 'max-content' },
        onMouseDown: (e) => e.stopPropagation(),
      },

      // ── Header / Toolbar ────────────────────────────────────────
      React.createElement(
        'div',
        { className: 'flex flex-wrap items-center gap-2 px-4 py-3 border-b border-gray-700 bg-gray-800 shrink-0' },

        // Title
        React.createElement(
          'span',
          { className: 'text-sm font-semibold text-gray-200 mr-2 max-w-40 truncate', title: filename },
          filename
        ),

        // Divider
        React.createElement('div', { className: 'w-px h-5 bg-gray-600' }),

        // Tool toggles
        toolBtn('pen',  'Pen',  React.createElement('svg', { xmlns: 'http://www.w3.org/2000/svg', className: 'h-3.5 w-3.5', fill: 'none', viewBox: '0 0 24 24', stroke: 'currentColor' }, React.createElement('path', { strokeLinecap: 'round', strokeLinejoin: 'round', strokeWidth: 2, d: 'M15.232 5.232l3.536 3.536m-2.036-5.036a2.5 2.5 0 113.536 3.536L6.5 21.036H3v-3.572L16.732 3.732z' }))),
        toolBtn('text', 'Text', React.createElement('svg', { xmlns: 'http://www.w3.org/2000/svg', className: 'h-3.5 w-3.5', fill: 'none', viewBox: '0 0 24 24', stroke: 'currentColor' }, React.createElement('path', { strokeLinecap: 'round', strokeLinejoin: 'round', strokeWidth: 2, d: 'M4 6h16M4 12h8m-8 6h16' }))),

        // Divider
        React.createElement('div', { className: 'w-px h-5 bg-gray-600' }),

        // Color swatches
        ...COLOR_SWATCHES.map(c =>
          React.createElement(
            'button',
            {
              key: c,
              onClick: () => setColor(c),
              title: c,
              style: { background: c, width: 20, height: 20, borderRadius: '50%', border: color === c ? '2px solid white' : '2px solid transparent', outline: color === c ? '2px solid #6366f1' : 'none', flexShrink: 0 },
            }
          )
        ),
        // Custom color picker
        React.createElement(
          'label',
          {
            title: 'Custom color',
            className: 'flex items-center justify-center w-5 h-5 rounded-full bg-gray-700 hover:bg-gray-600 cursor-pointer overflow-hidden border-2',
            style: { borderColor: '#6b7280' },
          },
          React.createElement('input', {
            type: 'color',
            value: color,
            onChange: (e) => setColor(e.target.value),
            className: 'opacity-0 w-0 h-0 absolute',
          }),
          React.createElement('svg', { xmlns: 'http://www.w3.org/2000/svg', className: 'h-3 w-3 text-gray-300', fill: 'none', viewBox: '0 0 24 24', stroke: 'currentColor' }, React.createElement('path', { strokeLinecap: 'round', strokeLinejoin: 'round', strokeWidth: 2, d: 'M12 4v16m8-8H4' }))
        ),

        // Divider
        React.createElement('div', { className: 'w-px h-5 bg-gray-600' }),

        // Line width (pen) or font size (text)
        tool === 'pen'
          ? React.createElement(
              'label',
              { className: 'flex items-center gap-1.5 text-xs text-gray-300' },
              'Width',
              React.createElement('input', {
                type: 'range', min: 1, max: 16, value: lineWidth,
                onChange: (e) => setLineWidth(Number(e.target.value)),
                className: 'w-20 accent-indigo-500',
              }),
              React.createElement('span', { className: 'w-5 text-center font-mono' }, lineWidth)
            )
          : React.createElement(
              'label',
              { className: 'flex items-center gap-1.5 text-xs text-gray-300' },
              'Size',
              React.createElement('input', {
                type: 'range', min: 10, max: 72, value: fontSize,
                onChange: (e) => setFontSize(Number(e.target.value)),
                className: 'w-20 accent-indigo-500',
              }),
              React.createElement('span', { className: 'w-6 text-center font-mono' }, fontSize)
            ),

        // Spacer
        React.createElement('div', { className: 'flex-1' }),

        // Undo
        React.createElement(
          'button',
          {
            onClick: handleUndo,
            disabled: undoStack.length <= 1,
            title: 'Undo (⌘Z)',
            className: 'flex items-center gap-1 px-2.5 py-1.5 rounded-lg text-sm text-gray-200 bg-gray-700 hover:bg-gray-600 transition-colors disabled:opacity-40 disabled:cursor-not-allowed',
          },
          React.createElement('svg', { xmlns: 'http://www.w3.org/2000/svg', className: 'h-3.5 w-3.5', fill: 'none', viewBox: '0 0 24 24', stroke: 'currentColor' }, React.createElement('path', { strokeLinecap: 'round', strokeLinejoin: 'round', strokeWidth: 2, d: 'M3 10h10a8 8 0 018 8v2M3 10l6 6m-6-6l6-6' })),
          'Undo'
        ),

        // Clear
        React.createElement(
          'button',
          {
            onClick: handleClear,
            title: 'Clear all annotations',
            className: 'flex items-center gap-1 px-2.5 py-1.5 rounded-lg text-sm text-gray-200 bg-gray-700 hover:bg-gray-600 transition-colors',
          },
          React.createElement('svg', { xmlns: 'http://www.w3.org/2000/svg', className: 'h-3.5 w-3.5', fill: 'none', viewBox: '0 0 24 24', stroke: 'currentColor' }, React.createElement('path', { strokeLinecap: 'round', strokeLinejoin: 'round', strokeWidth: 2, d: 'M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16' })),
          'Clear'
        ),

        // Save
        React.createElement(
          'button',
          {
            onClick: handleSave,
            disabled: isSaving,
            title: 'Save (⌘S)',
            className: 'flex items-center gap-1 px-3 py-1.5 rounded-lg text-sm font-bold bg-emerald-700 hover:bg-emerald-600 text-white transition-colors disabled:opacity-40',
          },
          isSaving
            ? React.createElement('div', { className: 'h-3.5 w-3.5 border-2 border-white border-t-transparent rounded-full animate-spin' })
            : React.createElement('svg', { xmlns: 'http://www.w3.org/2000/svg', className: 'h-3.5 w-3.5', fill: 'none', viewBox: '0 0 24 24', stroke: 'currentColor' }, React.createElement('path', { strokeLinecap: 'round', strokeLinejoin: 'round', strokeWidth: 2, d: 'M8 7H5a2 2 0 00-2 2v9a2 2 0 002 2h14a2 2 0 002-2V9a2 2 0 00-2-2h-3m-1 4l-3 3m0 0l-3-3m3 3V4' })),
          isSaving ? 'Saving…' : 'Save'
        ),

        // Close
        React.createElement(
          'button',
          {
            onClick: onClose,
            title: 'Cancel (Esc)',
            className: 'flex items-center justify-center w-8 h-8 rounded-lg text-gray-400 hover:bg-gray-700 hover:text-gray-200 transition-colors',
          },
          React.createElement('svg', { xmlns: 'http://www.w3.org/2000/svg', className: 'h-4 w-4', fill: 'none', viewBox: '0 0 24 24', stroke: 'currentColor' }, React.createElement('path', { strokeLinecap: 'round', strokeLinejoin: 'round', strokeWidth: 2, d: 'M6 18L18 6M6 6l12 12' }))
        ),
      ),

      // ── Canvas area ──────────────────────────────────────────────
      React.createElement(
        'div',
        {
          className: 'overflow-auto flex-1 bg-gray-950',
          style: { position: 'relative', minHeight: 200 },
        },

        !loaded && React.createElement(
          'div',
          { className: 'flex items-center justify-center h-48 text-gray-500 text-sm' },
          React.createElement('div', { className: 'h-6 w-6 border-2 border-gray-500 border-t-indigo-400 rounded-full animate-spin mr-2' }),
          'Loading image…'
        ),

        React.createElement('canvas', {
          ref: canvasRef,
          style: {
            display: loaded ? 'block' : 'none',
            cursor: tool === 'pen' ? 'crosshair' : 'text',
            maxWidth: '100%',
            touchAction: 'none',
          },
          onPointerDown: handlePointerDown,
          onPointerMove: handlePointerMove,
          onPointerUp: handlePointerUp,
          onPointerCancel: handlePointerUp,
          onPointerLeave: handlePointerUp,
        }),

        // Floating text input overlay
        inputState && React.createElement(
          'div',
          {
            style: {
              position: 'fixed',
              top:  inputState.y - 18,
              left: inputState.x,
              zIndex: 200,
            },
          },
          React.createElement('input', {
            autoFocus: true,
            value: inputState.value,
            onChange: (e) => setInputState(s => ({ ...s, value: e.target.value })),
            onKeyDown: (e) => {
              if (e.key === 'Enter')  { e.preventDefault(); commitText(); }
              if (e.key === 'Escape') { setInputState(null); }
            },
            onBlur: commitText,
            style: {
              background: 'transparent',
              border: 'none',
              borderBottom: `2px solid ${color}`,
              outline: 'none',
              color: color,
              fontSize: `${fontSize}px`,
              fontWeight: 'bold',
              fontFamily: 'sans-serif',
              minWidth: 80,
              padding: '0 2px',
              caretColor: color,
            },
            placeholder: 'Type text…',
          })
        ),
      ),

      // ── Hint bar ─────────────────────────────────────────────────
      React.createElement(
        'div',
        { className: 'px-4 py-1.5 text-xs text-gray-600 border-t border-gray-800 shrink-0 bg-gray-900' },
        tool === 'pen'
          ? 'Click and drag to draw. ⌘Z to undo.'
          : 'Click to place text, type, then press Enter to stamp. ⌘Z to undo.'
      ),
    )
  );
};

export default ImageEditor;

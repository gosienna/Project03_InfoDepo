
import React, { useState, useEffect, useRef } from 'react';

// Inline markdown: bold, italic, code, links, images
// Image size syntax: ![alt|300](file) → width:300px  |  ![alt|300x200](file) → 300×200px
const inlineMarkdown = (text, assetUrls) =>
  text
    .replace(/!\[([^\]]*)\]\(([^)]+)\)/g, (_, alt, src) => {
      const url = (assetUrls && assetUrls[src]) || src;
      const sizeMatch = alt.match(/\|(\d+)(?:x(\d+))?$/);
      const displayAlt = sizeMatch ? alt.slice(0, alt.lastIndexOf('|')) : alt;
      const sizeStyle = sizeMatch
        ? `width:${sizeMatch[1]}px;${sizeMatch[2] ? `height:${sizeMatch[2]}px;object-fit:cover;` : ''}max-width:100%;`
        : 'max-width:100%;';
      return `<img alt="${escapeHtml(displayAlt)}" src="${url}" style="${sizeStyle}border-radius:6px;margin:4px 0;display:block" />`;
    })
    .replace(/`([^`]+)`/g, '<code style="background:#374151;padding:2px 5px;border-radius:3px;font-size:.9em">$1</code>')
    .replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
    .replace(/\*(.+?)\*/g,     '<em>$1</em>')
    .replace(/\[([^\]]+)\]\(([^)]+)\)/g, '<a href="$2" style="color:#818cf8;text-decoration:underline">$1</a>');

// Line-based Markdown → HTML renderer — properly wraps lists in <ol>/<ul>
// Margins are intentionally minimal so each source line maps to one visual line,
// keeping the transparent textarea caret aligned with the rendered output.
const renderMarkdown = (text, assetUrls) => {
  const lines  = text.split('\n');
  const output = [];
  let i = 0;

  while (i < lines.length) {
    const line = lines[i];

    // Fenced code block
    if (line.startsWith('```')) {
      const codeLines = [];
      i++;
      while (i < lines.length && !lines[i].startsWith('```')) {
        codeLines.push(lines[i]);
        i++;
      }
      i++; // skip closing ```
      output.push(`<pre style="background:#1a1a2e;padding:12px;border-radius:6px;overflow:auto;margin:0"><code>${escapeHtml(codeLines.join('\n'))}</code></pre>`);
      continue;
    }

    // Unordered list item — render marker as visible gray text so caret aligns with raw source
    if (/^([-*]) /.test(line)) {
      const marker = line[0];
      const content = line.slice(2);
      output.push(`<div style="margin:0"><span style="color:#6b7280">${marker} </span>${inlineMarkdown(content, assetUrls)}</div>`);
      i++;
      continue;
    }

    // Ordered list item — same approach, show number prefix in gray
    if (/^\d+\. /.test(line)) {
      const numMatch = line.match(/^(\d+\.) /);
      const prefix = numMatch[1];
      const content = line.slice(prefix.length + 1);
      output.push(`<div style="margin:0"><span style="color:#6b7280">${prefix} </span>${inlineMarkdown(content, assetUrls)}</div>`);
      i++;
      continue;
    }

    // Headings — same line-height as body text to avoid vertical drift; bold + underline for visual distinction
    const hMatch = line.match(/^(#{1,3}) (.+)$/);
    if (hMatch) {
      const lvl    = hMatch[1].length;
      const styles = [
        'font-weight:800;text-decoration:underline;text-underline-offset:3px;margin:0',
        'font-weight:700;border-bottom:1px solid #4b5563;margin:0',
        'font-weight:700;color:#c7d2fe;margin:0',
      ];
      output.push(`<div style="${styles[lvl - 1]}">${inlineMarkdown(hMatch[2], assetUrls)}</div>`);
      i++;
      continue;
    }

    // Horizontal rule
    if (line.trim() === '---') {
      output.push('<hr style="border-color:#374151;margin:0" />');
      i++;
      continue;
    }

    // Blank line — height matches one textarea line so caret stays in sync
    if (line.trim() === '') {
      output.push('<div style="margin:0">&nbsp;</div>');
      i++;
      continue;
    }

    // Regular paragraph line
    output.push(`<div style="margin:0">${inlineMarkdown(line, assetUrls)}</div>`);
    i++;
  }

  return output.join('\n') || '';
};

const escapeHtml = (str) =>
  str.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

// Slash command definitions
// imageSize: null = full width, number = pixel width for the |size suffix
const SLASH_COMMANDS = [
  { id: 'h1',       label: 'Title',          hint: '# Heading',    insert: '# ',  imageSize: undefined },
  { id: 'h2',       label: 'Heading 2',      hint: '## Heading',   insert: '## ', imageSize: undefined },
  { id: 'h3',       label: 'Heading 3',      hint: '### Heading',  insert: '### ', imageSize: undefined },
  { id: 'ul',       label: 'List item',      hint: '- item',       insert: '- ',  imageSize: undefined },
  { id: 'ol',       label: 'Numbered list',  hint: '1. item',      insert: '1. ', imageSize: undefined },
  { id: 'image',    label: 'Image',          hint: 'full width',   insert: null,  imageSize: null  },
  { id: 'image-sm', label: 'Image — Small',  hint: '300 px',       insert: null,  imageSize: 300   },
  { id: 'image-md', label: 'Image — Medium', hint: '500 px',       insert: null,  imageSize: 500   },
  { id: 'image-lg', label: 'Image — Large',  hint: '800 px',       insert: null,  imageSize: 800   },
];

// Returns viewport-fixed coordinates just below the caret — safe against overflow:hidden ancestors
function getCaretCoords(textarea, pos) {
  const tRect = textarea.getBoundingClientRect();
  const cs    = window.getComputedStyle(textarea);

  // Place mirror exactly over the textarea in the viewport
  const mirror = document.createElement('div');
  [
    'fontFamily', 'fontSize', 'fontWeight', 'lineHeight', 'letterSpacing',
    'paddingTop', 'paddingRight', 'paddingBottom', 'paddingLeft',
    'borderTopWidth', 'borderRightWidth', 'borderBottomWidth', 'borderLeftWidth',
    'boxSizing', 'whiteSpace', 'wordWrap', 'overflowWrap', 'tabSize',
  ].forEach(p => { mirror.style[p] = cs[p]; });
  mirror.style.position      = 'fixed';
  mirror.style.top           = tRect.top + 'px';
  mirror.style.left          = tRect.left + 'px';
  mirror.style.width         = tRect.width + 'px';
  mirror.style.height        = tRect.height + 'px';
  mirror.style.overflow      = 'hidden';
  mirror.style.visibility    = 'hidden';
  mirror.style.pointerEvents = 'none';
  document.body.appendChild(mirror);
  mirror.scrollTop = textarea.scrollTop;

  mirror.appendChild(document.createTextNode(textarea.value.substring(0, pos)));
  const marker = document.createElement('span');
  marker.textContent = '\u200b';
  mirror.appendChild(marker);

  const mRect = marker.getBoundingClientRect();
  document.body.removeChild(mirror);

  const lineHeight = parseFloat(cs.lineHeight) || 20;
  return {
    top:  mRect.top  + lineHeight,
    left: Math.max(8, Math.min(mRect.left, window.innerWidth - 240)),
  };
}

export const MarkdownEditor = ({ book, onUpdateBook, onAddAsset, onGetAssets }) => {
  const [text,      setText]      = useState('');
  const [isLoading, setIsLoading] = useState(true);
  const [isDirty,   setIsDirty]   = useState(false);
  const [isSaving,  setIsSaving]  = useState(false);
  const [saveMsg,   setSaveMsg]   = useState(null); // 'saved' | 'error'
  const [assetUrls, setAssetUrls] = useState({});   // { filename → objectURL }
  // slashMenu: null | { slashPos, filter, activeIdx }
  const [slashMenu, setSlashMenu] = useState(null);
  const [showRaw,   setShowRaw]   = useState(false);
  const imageInputRef        = useRef(null);
  const textareaRef          = useRef(null);
  const pendingSlashPos      = useRef(null); // set in keydown, consumed in onChange
  const pendingImageSize     = useRef(undefined); // null = full width, number = px width

  // Load note text + assets
  useEffect(() => {
    setIsLoading(true);
    setIsDirty(false);
    setSlashMenu(null);

    const reader = new FileReader();
    reader.onload = (e) => {
      setText(e.target?.result ?? '');
      setIsLoading(false);
    };
    reader.onerror = () => {
      setText('');
      setIsLoading(false);
    };
    reader.readAsText(book.data);

    if (onGetAssets) {
      onGetAssets(book.id).then(assets => {
        const urls = {};
        assets.forEach(a => { urls[a.filename] = URL.createObjectURL(a.data); });
        setAssetUrls(urls);
      }).catch(() => {});
    }
  }, [book.id]);

  // Revoke object URLs when the map is replaced or component unmounts
  useEffect(() => {
    const urls = assetUrls;
    return () => { Object.values(urls).forEach(u => URL.revokeObjectURL(u)); };
  }, [assetUrls]);

  const filteredCommands = (filter) => {
    if (!filter) return SLASH_COMMANDS;
    const q = filter.toLowerCase();
    return SLASH_COMMANDS.filter(c =>
      c.label.toLowerCase().includes(q) || c.id.replace(/-/g, '').includes(q.replace(/-/g, ''))
    );
  };

  const applySlashCommand = (cmd) => {
    if (!cmd || !textareaRef.current) return;
    const ta    = textareaRef.current;
    const end   = ta.selectionStart;
    const start = slashMenu.slashPos;

    setSlashMenu(null);

    if (cmd.insert === null) {
      // Image command — remove '/' + filter text, store size, open file picker
      const newText = text.slice(0, start) + text.slice(end);
      setText(newText);
      setIsDirty(true);
      pendingImageSize.current = cmd.imageSize;
      requestAnimationFrame(() => {
        ta.selectionStart = ta.selectionEnd = start;
        ta.focus();
      });
      imageInputRef.current?.click();
      return;
    }

    // Replace '/' + filter with the insert snippet
    const newText  = text.slice(0, start) + cmd.insert + text.slice(end);
    const newCursor = start + cmd.insert.length;
    setText(newText);
    setIsDirty(true);
    requestAnimationFrame(() => {
      ta.selectionStart = ta.selectionEnd = newCursor;
      ta.focus();
    });
  };

  const handleChange = (e) => {
    const val = e.target.value;
    setText(val);
    setIsDirty(true);
    setSaveMsg(null);

    // Consume a pending slash trigger set in onKeyDown
    if (pendingSlashPos.current !== null) {
      const slashPos = pendingSlashPos.current;
      pendingSlashPos.current = null;
      if (val[slashPos] === '/') {
        setSlashMenu({ slashPos, filter: '', activeIdx: 0 });
        return;
      }
    }

    // Update existing slash menu filter, or close if '/' was deleted
    if (slashMenu !== null) {
      const pos = e.target.selectionStart;
      if (pos <= slashMenu.slashPos || val[slashMenu.slashPos] !== '/') {
        setSlashMenu(null);
      } else {
        const filter = val.slice(slashMenu.slashPos + 1, pos);
        setSlashMenu(prev => ({ ...prev, filter, activeIdx: 0 }));
      }
    }
  };

  const handleKeyDown = (e) => {
    // Detect '/' at start of line — read selectionStart here before React re-renders
    if (e.key === '/' && slashMenu === null) {
      const ta = textareaRef.current;
      if (ta) {
        const pos = ta.selectionStart;
        const val = ta.value;
        const lineStart = val.lastIndexOf('\n', pos - 1) + 1;
        const beforeCursor = val.slice(lineStart, pos);
        if (beforeCursor.trim() === '') {
          pendingSlashPos.current = pos; // '/' will land at this index
        }
      }
    }

    if (slashMenu !== null) {
      const visible = filteredCommands(slashMenu.filter);
      if (e.key === 'ArrowDown') {
        e.preventDefault();
        setSlashMenu(prev => ({ ...prev, activeIdx: (prev.activeIdx + 1) % visible.length }));
        return;
      }
      if (e.key === 'ArrowUp') {
        e.preventDefault();
        setSlashMenu(prev => ({ ...prev, activeIdx: (prev.activeIdx - 1 + visible.length) % visible.length }));
        return;
      }
      if (e.key === 'Enter' || e.key === 'Tab') {
        e.preventDefault();
        applySlashCommand(visible[slashMenu.activeIdx]);
        return;
      }
      if (e.key === 'Escape') {
        e.preventDefault();
        setSlashMenu(null);
        return;
      }
    }

    // List continuation on Enter
    if (e.key === 'Enter' && slashMenu === null) {
      const ta = textareaRef.current;
      if (ta) {
        const pos = ta.selectionStart;
        const val = ta.value;
        const lineStart = val.lastIndexOf('\n', pos - 1) + 1;
        const lineEnd = val.indexOf('\n', pos);
        const fullLine = val.slice(lineStart, lineEnd === -1 ? val.length : lineEnd);

        const ulMatch = fullLine.match(/^([-*]) (.*)$/);
        const olMatch = !ulMatch && fullLine.match(/^(\d+)\. (.*)$/);

        if (ulMatch || olMatch) {
          const isEmpty = ulMatch ? ulMatch[2].trim() === '' : olMatch[2].trim() === '';

          if (isEmpty) {
            // Empty list item → exit list: remove marker, just insert a newline
            e.preventDefault();
            const newText = val.slice(0, lineStart) + '\n' + val.slice(lineEnd === -1 ? val.length : lineEnd);
            setText(newText);
            setIsDirty(true);
            requestAnimationFrame(() => { ta.selectionStart = ta.selectionEnd = lineStart + 1; });
          } else {
            // Continue list with next marker
            e.preventDefault();
            const marker = ulMatch
              ? `${ulMatch[1]} `
              : `${parseInt(olMatch[1]) + 1}. `;
            const insert = '\n' + marker;
            const newText = val.slice(0, pos) + insert + val.slice(pos);
            setText(newText);
            setIsDirty(true);
            requestAnimationFrame(() => { ta.selectionStart = ta.selectionEnd = pos + insert.length; });
          }
          return;
        }
      }
    }

    if ((e.metaKey || e.ctrlKey) && e.key === 's') {
      e.preventDefault();
      if (isDirty && !isSaving) handleSave();
    }
  };

  const handleSave = async () => {
    setIsSaving(true);
    setSaveMsg(null);
    try {
      const blob = new Blob([text], { type: 'text/markdown' });
      await onUpdateBook(book.id, blob);
      setIsDirty(false);
      setSaveMsg('saved');
      setTimeout(() => setSaveMsg(null), 2000);
    } catch (err) {
      console.error('Failed to save note:', err);
      setSaveMsg('error');
    } finally {
      setIsSaving(false);
    }
  };

  const handleExport = async () => {
    const zip = new JSZip();
    const assets = await (onGetAssets ? onGetAssets(book.id) : Promise.resolve([]));

    let exportText = text;
    assets.forEach(a => {
      exportText = exportText.replaceAll(`](${a.filename})`, `](images/${a.filename})`);
    });

    const noteName = book.name.endsWith('.md') ? book.name : book.name + '.md';
    zip.file(noteName, exportText);
    if (assets.length > 0) {
      const imgFolder = zip.folder('images');
      assets.forEach(a => imgFolder.file(a.filename, a.data));
    }

    const blob = await zip.generateAsync({ type: 'blob' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = noteName.replace(/\.md$/, '.zip');
    a.click();
    URL.revokeObjectURL(url);
  };

  const insertImage = async (file) => {
    if (!file || !onAddAsset) return;
    try {
      await onAddAsset(book.id, file.name, file, file.type);
      const url = URL.createObjectURL(file);
      setAssetUrls(prev => ({ ...prev, [file.name]: url }));
      const size = pendingImageSize.current;
      pendingImageSize.current = undefined;
      const altText = size != null ? `${file.name}|${size}` : file.name;
      setText(prev => prev + `\n![${altText}](${file.name})`);
      setIsDirty(true);
    } catch (err) {
      console.error('Failed to insert image:', err);
    }
  };

  if (isLoading) {
    return React.createElement(
      'div',
      { className: 'flex items-center justify-center h-full' },
      React.createElement('div', { className: 'animate-spin rounded-full h-6 w-6 border-b-2 border-indigo-400' })
    );
  }

  // Slash command dropdown
  const visible = slashMenu ? filteredCommands(slashMenu.filter) : [];
  const coords  = slashMenu && textareaRef.current
    ? getCaretCoords(textareaRef.current, slashMenu.slashPos)
    : { top: 0, left: 0 };

  return React.createElement(
    'div',
    { className: 'w-full h-full flex flex-col bg-gray-800 rounded-lg shadow-lg overflow-hidden' },

    // Toolbar
    React.createElement(
      'div',
      { className: 'flex items-center justify-between px-4 py-2 border-b border-gray-700 bg-gray-800/80 shrink-0' },

      React.createElement(
        'span',
        { className: 'text-sm text-gray-400 font-mono truncate max-w-xs', title: book.name },
        book.name
      ),

      React.createElement(
        'div',
        { className: 'flex items-center gap-3' },

        saveMsg === 'saved' && React.createElement('span', { className: 'text-xs text-emerald-400 font-medium' }, 'Saved'),
        saveMsg === 'error' && React.createElement('span', { className: 'text-xs text-red-400 font-medium' }, 'Save failed'),
        isDirty && !saveMsg && React.createElement('span', { className: 'text-xs text-gray-500' }, 'Unsaved changes'),

        // Export as ZIP
        React.createElement(
          'button',
          {
            onClick: handleExport,
            title: 'Export as ZIP (note + images)',
            className: 'flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-sm font-medium bg-gray-700 hover:bg-gray-600 text-gray-200 transition-colors',
          },
          React.createElement(
            'svg',
            { xmlns: 'http://www.w3.org/2000/svg', className: 'h-3.5 w-3.5', fill: 'none', viewBox: '0 0 24 24', stroke: 'currentColor' },
            React.createElement('path', { strokeLinecap: 'round', strokeLinejoin: 'round', strokeWidth: 2, d: 'M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4' })
          ),
          'Export'
        ),

        // Raw / debug toggle
        React.createElement(
          'button',
          {
            onClick: () => setShowRaw(v => !v),
            title: showRaw ? 'Hide raw markdown' : 'Show raw markdown',
            className: `flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-sm font-medium transition-colors ${showRaw ? 'bg-indigo-700 text-white' : 'bg-gray-700 hover:bg-gray-600 text-gray-200'}`,
          },
          React.createElement(
            'svg',
            { xmlns: 'http://www.w3.org/2000/svg', className: 'h-3.5 w-3.5', fill: 'none', viewBox: '0 0 24 24', stroke: 'currentColor' },
            React.createElement('path', { strokeLinecap: 'round', strokeLinejoin: 'round', strokeWidth: 2, d: 'M10 20l4-16m4 4l4 4-4 4M6 16l-4-4 4-4' })
          ),
          'Raw'
        ),

        // Save
        React.createElement(
          'button',
          {
            onClick: handleSave,
            disabled: !isDirty || isSaving,
            title: 'Save (⌘S / Ctrl+S)',
            className: 'flex items-center gap-1.5 px-4 py-1.5 rounded-lg text-sm font-bold bg-emerald-700 hover:bg-emerald-600 text-white transition-colors disabled:opacity-40 disabled:cursor-not-allowed',
          },
          isSaving
            ? React.createElement('div', { className: 'h-3.5 w-3.5 border-2 border-white border-t-transparent rounded-full animate-spin' })
            : React.createElement(
                'svg',
                { xmlns: 'http://www.w3.org/2000/svg', className: 'h-3.5 w-3.5', fill: 'none', viewBox: '0 0 24 24', stroke: 'currentColor' },
                React.createElement('path', { strokeLinecap: 'round', strokeLinejoin: 'round', strokeWidth: 2, d: 'M8 7H5a2 2 0 00-2 2v9a2 2 0 002 2h14a2 2 0 002-2V9a2 2 0 00-2-2h-3m-1 4l-3 3m0 0l-3-3m3 3V4' })
              ),
          isSaving ? 'Saving…' : 'Save'
        ),

        // Hidden image file input
        React.createElement('input', {
          ref: imageInputRef,
          type: 'file',
          accept: 'image/*',
          className: 'hidden',
          onChange: (e) => { const f = e.target.files[0]; if (f) { insertImage(f); e.target.value = ''; } },
        })
      )
    ),

    // Content area: preview+textarea (left) + optional raw panel (right)
    React.createElement(
      'div',
      { className: 'flex flex-grow overflow-hidden' },

    // Left: preview layer + transparent textarea overlay
    React.createElement(
      'div',
      {
        className: 'relative',
        style: { flex: 1, minWidth: 0, overflow: 'visible' },
        onClick: () => textareaRef.current?.focus(),
      },

      // Preview layer — always rendered
      React.createElement('div', {
        className: 'absolute inset-0 bg-gray-900 text-gray-100 text-sm leading-relaxed p-6 overflow-auto pointer-events-none select-none overflow-clip',
        dangerouslySetInnerHTML: {
          __html: text
            ? renderMarkdown(text, assetUrls)
            : '<p style="color:#4b5563;font-style:italic">Start typing, or press <kbd style="background:#374151;padding:1px 5px;border-radius:4px;font-style:normal;font-size:.85em">/</kbd> at the start of a line to insert…</p>'
        },
      }),

      // Transparent textarea on top
      React.createElement('textarea', {
        ref: textareaRef,
        value: text,
        onChange: handleChange,
        onKeyDown: handleKeyDown,
        onBlur: () => setTimeout(() => setSlashMenu(null), 150),
        onDragOver: (e) => e.preventDefault(),
        onDrop: (e) => {
          e.preventDefault();
          const f = e.dataTransfer.files[0];
          if (f?.type.startsWith('image/')) insertImage(f);
        },
        onPaste: (e) => {
          const item = Array.from(e.clipboardData.items).find(i => i.type.startsWith('image/'));
          if (item) { e.preventDefault(); insertImage(item.getAsFile()); }
        },
        spellCheck: false,
        className: 'absolute inset-0 w-full h-full bg-transparent resize-none focus:outline-none p-6 text-sm leading-relaxed overflow-auto',
        style: { color: 'transparent', caretColor: '#a5b4fc' },
      }),

      // Slash command dropdown
      slashMenu && visible.length > 0 && React.createElement(
        'div',
        {
          style: { position: 'fixed', top: coords.top, left: coords.left, zIndex: 9999 },
          className: 'bg-gray-800 border border-gray-600 rounded-xl shadow-2xl py-1 min-w-52',
          onMouseDown: (e) => e.preventDefault(), // keep textarea focused
        },
        // Header hint
        React.createElement(
          'div',
          { className: 'px-3 py-1.5 text-xs text-gray-500 border-b border-gray-700' },
          slashMenu.filter ? `"${slashMenu.filter}"` : 'Type to filter…'
        ),
        visible.map((cmd, i) =>
          React.createElement(
            'button',
            {
              key: cmd.id,
              onMouseDown: (e) => { e.preventDefault(); applySlashCommand(cmd); },
              className: `w-full flex items-center justify-between px-3 py-2 text-sm transition-colors text-left ${
                i === slashMenu.activeIdx
                  ? 'bg-indigo-600 text-white'
                  : 'text-gray-200 hover:bg-gray-700'
              }`,
            },
            React.createElement('span', { className: 'font-medium' }, cmd.label),
            React.createElement(
              'span',
              { className: `text-xs font-mono ml-4 ${i === slashMenu.activeIdx ? 'text-indigo-200' : 'text-gray-500'}` },
              cmd.hint
            )
          )
        )
      )
    ),  // end left pane

    // Right: raw markdown panel (debug)
    showRaw && React.createElement(
      'div',
      { className: 'w-80 shrink-0 flex flex-col border-l border-gray-700 bg-gray-950' },
      React.createElement(
        'div',
        { className: 'px-3 py-2 border-b border-gray-700 flex items-center gap-2 shrink-0' },
        React.createElement(
          'svg',
          { xmlns: 'http://www.w3.org/2000/svg', className: 'h-3.5 w-3.5 text-indigo-400', fill: 'none', viewBox: '0 0 24 24', stroke: 'currentColor' },
          React.createElement('path', { strokeLinecap: 'round', strokeLinejoin: 'round', strokeWidth: 2, d: 'M10 20l4-16m4 4l4 4-4 4M6 16l-4-4 4-4' })
        ),
        React.createElement('span', { className: 'text-xs font-mono text-gray-400' }, 'raw markdown'),
        React.createElement('span', { className: 'ml-auto text-xs text-gray-600' }, `${text.length} chars`)
      ),
      React.createElement('pre', {
        className: 'flex-grow overflow-auto p-4 text-xs font-mono text-gray-300 leading-relaxed whitespace-pre-wrap break-words',
      }, text || React.createElement('span', { className: 'text-gray-600 italic' }, 'empty'))
    )

  )  // end outer flex
  );
};

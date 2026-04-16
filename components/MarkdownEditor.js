
import React, { useState, useEffect, useRef } from 'react';
import { ImageEditor } from './ImageEditor.js';

// \x00 is a transient cursor marker inserted at cursorPos before rendering; never saved to disk.
const CURSOR_SPAN = '<span data-cursor="1" style="display:inline-block;width:2px;height:1.1em;background:#a5b4fc;border-radius:1px;animation:md-blink 1.2s step-end infinite;vertical-align:text-bottom"></span>';

// Inline markdown: bold, italic, code, links, images
// Image size syntax: ![alt|300](file) → width:300px  |  ![alt|300x200](file) → 300×200px
// \x00 cursor marker is rendered last so it survives all replacements.
const inlineMarkdown = (text, assetUrls) =>
  text
    .replace(/!\[([^\]]*)\]\(([^)]+)\)/g, (match, alt, src) => {
      const cleanAlt = alt.replace(/\x00/g, '');
      const cleanSrc = src.replace(/\x00/g, '');
      const hasCursor = match.includes('\x00');
      const url = (assetUrls && assetUrls[cleanSrc]) || cleanSrc;
      const sizeMatch = cleanAlt.match(/\|(\d+)(?:x(\d+))?$/);
      const displayAlt = sizeMatch ? cleanAlt.slice(0, cleanAlt.lastIndexOf('|')) : cleanAlt;
      const sizeStyle = sizeMatch
        ? `width:${sizeMatch[1]}px;${sizeMatch[2] ? `height:${sizeMatch[2]}px;object-fit:cover;` : ''}max-width:100%;`
        : 'max-width:100%;';
      const imgHtml = `<img data-img-file="${escapeHtml(cleanSrc)}" alt="${escapeHtml(displayAlt)}" src="${url}" style="${sizeStyle}border-radius:6px;margin:4px 0;display:block" />`;
      return hasCursor ? imgHtml + CURSOR_SPAN : imgHtml;
    })
    .replace(/`([^`]+)`/g, '<code style="background:#374151;padding:2px 5px;border-radius:3px;font-size:.9em">$1</code>')
    .replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
    .replace(/\*(.+?)\*/g,     '<em>$1</em>')
    .replace(
      /\[([^\]]+)\]\((https?:\/\/(?:www\.)?(?:youtube\.com\/watch\?(?:[^)]*&)?v=|youtu\.be\/)([a-zA-Z0-9_-]{11})[^)]*)\)/g,
      (_, text, url, videoId) =>
        `<a href="${url}" target="_blank" rel="noopener noreferrer" style="display:inline-flex;align-items:center;gap:6px;text-decoration:none;background:#1f2937;border:1px solid #374151;border-radius:8px;padding:4px 8px 4px 4px;margin:2px 0">` +
        `<img src="https://img.youtube.com/vi/${videoId}/mqdefault.jpg" alt="" style="width:80px;height:45px;object-fit:cover;border-radius:4px;flex-shrink:0" />` +
        `<span style="color:#ef4444;font-size:.8em;font-weight:600">▶ ${escapeHtml(text)}</span>` +
        `</a>`
    )
    .replace(/\[([^\]]+)\]\(([^)]+)\)/g, '<a href="$2" style="color:#818cf8;text-decoration:underline">$1</a>')
    .replace(/\x00/g, CURSOR_SPAN);

// Line-based Markdown → HTML renderer.
// Accepts \x00 as a transient cursor marker — renders it as a blinking cursor span.
// Block image lines get the cursor appended after the <img>; all other lines pass \x00
// through to inlineMarkdown which renders it at the correct inline position.
const renderMarkdown = (text, assetUrls) => {
  const lines  = text.split('\n');
  const output = [];
  let i = 0;

  while (i < lines.length) {
    const line      = lines[i];
    const cleanLine = line.replace(/\x00/g, ''); // strip cursor for pattern matching
    const hasCursor = line !== cleanLine;

    // Fenced code block
    if (cleanLine.startsWith('```')) {
      const codeLines = [];
      i++;
      while (i < lines.length && !lines[i].replace(/\x00/g, '').startsWith('```')) {
        codeLines.push(lines[i].replace(/\x00/g, '')); // cursor not shown inside code
        i++;
      }
      i++; // skip closing ```
      output.push(`<pre style="background:#1a1a2e;padding:12px;border-radius:6px;overflow:auto;margin:0"><code>${escapeHtml(codeLines.join('\n'))}</code></pre>`);
      continue;
    }

    // Block image line — cursor goes after the <img> so it appears below it
    if (/^!\[[^\]]*\]\([^)]+\)$/.test(cleanLine)) {
      const rendered = inlineMarkdown(cleanLine, assetUrls);
      output.push(`<div style="margin:0">${rendered}${hasCursor ? CURSOR_SPAN : ''}</div>`);
      i++;
      continue;
    }

    // Unordered list item (supports nesting via 4-space indentation)
    const ulRenderMatch = cleanLine.match(/^((?:    )*)([-*]) /);
    if (ulRenderMatch) {
      const level   = ulRenderMatch[1].length / 4;
      const marker  = ulRenderMatch[2];
      const content = line.slice(ulRenderMatch[0].length); // preserve \x00
      const indent  = level > 0 ? `padding-left:${level * 20}px;` : '';
      output.push(`<div style="margin:0;${indent}"><span style="color:#6b7280">${marker} </span>${inlineMarkdown(content, assetUrls)}</div>`);
      i++;
      continue;
    }

    // Ordered list item (supports nesting via 4-space indentation)
    const olRenderMatch = cleanLine.match(/^((?:    )*)(\d+\.) /);
    if (olRenderMatch) {
      const level   = olRenderMatch[1].length / 4;
      const prefix  = olRenderMatch[2];
      const content = line.slice(olRenderMatch[0].length); // preserve \x00
      const indent  = level > 0 ? `padding-left:${level * 20}px;` : '';
      output.push(`<div style="margin:0;${indent}"><span style="color:#6b7280">${prefix} </span>${inlineMarkdown(content, assetUrls)}</div>`);
      i++;
      continue;
    }

    // Headings
    const hMatch = cleanLine.match(/^(#{1,3}) (.+)$/);
    if (hMatch) {
      const lvl     = hMatch[1].length;
      const styles  = [
        'font-weight:800;text-decoration:underline;text-underline-offset:3px;margin:0',
        'font-weight:700;border-bottom:1px solid #4b5563;margin:0',
        'font-weight:700;color:#c7d2fe;margin:0',
      ];
      const content = line.slice(hMatch[1].length + 1); // preserve \x00
      output.push(`<div style="${styles[lvl - 1]}">${inlineMarkdown(content, assetUrls)}</div>`);
      i++;
      continue;
    }

    // Horizontal rule
    if (cleanLine.trim() === '---') {
      output.push('<hr style="border-color:#374151;margin:0" />');
      i++;
      continue;
    }

    // Blank line (cursor shown as standalone caret on the empty line)
    if (cleanLine.trim() === '') {
      output.push(`<div style="margin:0">${hasCursor ? CURSOR_SPAN : ''}&nbsp;</div>`);
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

// Maps a viewport click (x, y) inside previewEl to a character offset in raw markdown text.
function clickToMarkdownPos(previewEl, x, y, text) {
  let domNode = null, domOffset = 0;
  if (document.caretPositionFromPoint) {
    const p = document.caretPositionFromPoint(x, y);
    if (p) { domNode = p.offsetNode; domOffset = p.offset; }
  } else if (document.caretRangeFromPoint) {
    const r = document.caretRangeFromPoint(x, y);
    if (r) { domNode = r.startContainer; domOffset = r.startOffset; }
  }
  if (!domNode) return text.length;

  // Walk up to find the direct child of previewEl (= one rendered line)
  let lineEl = domNode.nodeType === Node.ELEMENT_NODE ? domNode : domNode.parentElement;
  while (lineEl && lineEl.parentElement !== previewEl) lineEl = lineEl.parentElement;
  if (!lineEl) return text.length;

  const lineIdx = Array.from(previewEl.children).indexOf(lineEl);
  if (lineIdx === -1) return text.length;

  // Count text-node chars inside lineEl up to the clicked node
  let charsBeforeClick = 0;
  const walk = (node) => {
    if (node === domNode) { charsBeforeClick += domOffset; return true; }
    if (node.nodeType === Node.TEXT_NODE) { charsBeforeClick += node.textContent.length; return false; }
    for (const child of node.childNodes) { if (walk(child)) return true; }
    return false;
  };
  walk(lineEl);

  const mdLines   = text.split('\n');
  const mdLineStart = mdLines.slice(0, lineIdx).reduce((s, l) => s + l.length + 1, 0);
  const mdLine    = mdLines[lineIdx] ?? '';
  const renderedLen = lineEl.textContent.length;
  const ratio     = renderedLen > 0 ? charsBeforeClick / renderedLen : 0;
  return mdLineStart + Math.min(Math.round(ratio * mdLine.length), mdLine.length);
}

// Atomic strings — \x00 cursor marker must not be inserted inside these; snap to nearest boundary.
// Each entry is a RegExp with the 'g' flag.
const ATOMIC_PATTERNS = [
  /\r\n/g,                        // CRLF line ending (2-char sequence, cursor can land between \r and \n)
  /!\[[^\]]*\]\([^)]*\)/g,        // image markdown: ![alt|size](filename)
];

// Returns cursorPos snapped to the head or tail of any atomic pattern that contains it.
function snapCursorPos(text, cursorPos) {
  for (const re of ATOMIC_PATTERNS) {
    re.lastIndex = 0;
    let m;
    while ((m = re.exec(text)) !== null) {
      const start = m.index;
      const end   = m.index + m[0].length;
      if (cursorPos > start && cursorPos < end) {
        return (cursorPos - start <= end - cursorPos) ? start : end;
      }
    }
  }
  return cursorPos;
}

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
  { id: 'youtube',  label: 'YouTube embed',  hint: 'paste URL',    insert: '[Video Title](https://youtube.com/watch?v=)', imageSize: undefined },
];

// Saves go through onUpdateItem → useIndexedDB.updateItem (routes by `video.type`: `notes` vs `books`).

export const MarkdownEditor = ({ video, onUpdateItem, onAddImage, onGetImages, readOnly }) => {
  const [text,      setText]      = useState('');
  const [isLoading, setIsLoading] = useState(true);
  const [isDirty,   setIsDirty]   = useState(false);
  const [isSaving,  setIsSaving]  = useState(false);
  const [saveMsg,   setSaveMsg]   = useState(null); // 'saved' | 'error'
  const [assetUrls, setAssetUrls] = useState({});   // { filename → objectURL }
  // slashMenu: null | { slashPos, filter, activeIdx }
  const [slashMenu, setSlashMenu] = useState(null);
  const [showRaw,   setShowRaw]   = useState(false);
  const [cursorPos, setCursorPos] = useState(0);
  const [isFocused, setIsFocused] = useState(false);
  const [hoveredImg, setHoveredImg] = useState(null); // { filename, rect } | null
  const [editingImg, setEditingImg] = useState(null); // { src, filename } | null
  const hoveredImgClearTimer = useRef(null);
  const imageInputRef        = useRef(null);
  const textareaRef          = useRef(null);
  const previewRef           = useRef(null);
  const pendingSlashPos      = useRef(null); // set in keydown, consumed in onChange
  const pendingImageSize     = useRef(undefined); // null = full width, number = px width
  const historyRef           = useRef([]);   // undo stack: [{ text, cursorPos }, ...]
  const historyIdxRef        = useRef(-1);   // current position in stack

  // Load note text + assets
  useEffect(() => {
    setIsLoading(true);
    setIsDirty(false);
    setSlashMenu(null);

    historyRef.current    = [];
    historyIdxRef.current = -1;

    const reader = new FileReader();
    reader.onload = (e) => {
      const loaded = e.target?.result ?? '';
      setText(loaded);
      historyRef.current    = [{ text: loaded, cursorPos: 0 }];
      historyIdxRef.current = 0;
      setIsLoading(false);
    };
    reader.onerror = () => {
      setText('');
      setIsLoading(false);
    };
    reader.readAsText(video.data);

    if (onGetImages) {
      onGetImages(video.id).then(assets => {
        const urls = {};
        assets.forEach(a => { urls[a.name] = URL.createObjectURL(a.data); });
        setAssetUrls(urls);
      }).catch(() => {});
    }
  }, [video.id]);

  // Revoke object URLs when the map is replaced or component unmounts
  useEffect(() => {
    const urls = assetUrls;
    return () => { Object.values(urls).forEach(u => URL.revokeObjectURL(u)); };
  }, [assetUrls]);

  // Inject blink keyframe for custom image caret (once)
  useEffect(() => {
    if (document.getElementById('md-caret-style')) return;
    const style = document.createElement('style');
    style.id = 'md-caret-style';
    style.textContent = '@keyframes md-blink{0%,100%{opacity:1}50%{opacity:0}}';
    document.head.appendChild(style);
  }, []);

  const updateCursor = () => {
    if (textareaRef.current) setCursorPos(textareaRef.current.selectionStart);
  };

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
      requestAnimationFrame(() => { ta.selectionStart = ta.selectionEnd = start; ta.focus(); pushHistory(newText, start); });
      imageInputRef.current?.click();
      return;
    }

    // Replace '/' + filter with the insert snippet
    const newText  = text.slice(0, start) + cmd.insert + text.slice(end);
    const newCursor = start + cmd.insert.length;
    setText(newText);
    setIsDirty(true);
    requestAnimationFrame(() => { ta.selectionStart = ta.selectionEnd = newCursor; ta.focus(); pushHistory(newText, newCursor); });
  };

  const pushHistory = (text, cursorPos) => {
    // Discard any forward history beyond current index, then append
    historyRef.current = historyRef.current.slice(0, historyIdxRef.current + 1);
    historyRef.current.push({ text, cursorPos });
    if (historyRef.current.length > 200) historyRef.current.shift(); // cap size
    else historyIdxRef.current++;
  };

  const handleChange = (e) => {
    const val = e.target.value;
    setText(val);
    setIsDirty(true);
    setSaveMsg(null);
    requestAnimationFrame(() => { updateCursor(); pushHistory(val, textareaRef.current?.selectionStart ?? 0); });

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
    const ta = textareaRef.current;

    // Detect '/' at start of line — read selectionStart here before React re-renders
    if (e.key === '/' && slashMenu === null) {
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

    // Delete entire image line when Backspace is pressed on or just after an image
    if (e.key === 'Backspace' && ta && ta.selectionStart === ta.selectionEnd) {
      const pos  = ta.selectionStart;
      const val  = ta.value;
      const lineStart = val.lastIndexOf('\n', pos - 1) + 1;
      const lineEnd   = val.indexOf('\n', pos);
      const currentLine = val.slice(lineStart, lineEnd === -1 ? val.length : lineEnd);

      // Case 1: cursor is anywhere on a line that is entirely an image markdown
      if (/^!\[[^\]]*\]\([^)]+\)$/.test(currentLine)) {
        e.preventDefault();
        let delStart, delEnd;
        if (lineStart > 0) {
          delStart = lineStart - 1; // include preceding \n
          delEnd   = lineEnd === -1 ? val.length : lineEnd;
        } else {
          delStart = 0;
          delEnd   = lineEnd === -1 ? val.length : lineEnd + 1; // include trailing \n
        }
        const newText1 = val.slice(0, delStart) + val.slice(delEnd);
        setText(newText1);
        setIsDirty(true);
        requestAnimationFrame(() => { ta.selectionStart = ta.selectionEnd = delStart; ta.focus(); pushHistory(newText1, delStart); });
        return;
      }

      // Case 2: cursor is at the very start of a line and the previous line is an image
      if (pos === lineStart && lineStart > 0) {
        const prevLineEnd   = lineStart - 1;
        const prevLineStart = val.lastIndexOf('\n', prevLineEnd - 1) + 1;
        const prevLine      = val.slice(prevLineStart, prevLineEnd);
        if (/^!\[[^\]]*\]\([^)]+\)$/.test(prevLine)) {
          e.preventDefault();
          const delStart     = prevLineStart > 0 ? prevLineStart - 1 : 0;
          const charsDeleted = prevLineEnd - delStart;
          const newText2     = val.slice(0, delStart) + val.slice(prevLineEnd);
          const newPos2      = pos - charsDeleted;
          setText(newText2);
          setIsDirty(true);
          requestAnimationFrame(() => { ta.selectionStart = ta.selectionEnd = newPos2; ta.focus(); pushHistory(newText2, newPos2); });
          return;
        }
      }

      // Case 3: unindent one level when cursor is inside the indent spaces OR
      //         the entire line is an empty nested list item (cursor anywhere after lineStart).
      //         Covers the common case where Enter-on-empty-nested leaves the cursor
      //         right after the marker — e.g. "    - |" — which is outside the indent range.
      const nestMatch = currentLine.match(/^((?:    )+)([-*]|\d+\.) (.*)/);
      if (nestMatch && pos > lineStart) {
        const isEmptyItem    = nestMatch[3].trim() === '';
        const cursorInIndent = pos <= lineStart + nestMatch[1].length;
        if (isEmptyItem || cursorInIndent) {
          e.preventDefault();
          const newLine    = currentLine.slice(4);
          const lineEndIdx = lineEnd === -1 ? val.length : lineEnd;
          const newText3   = val.slice(0, lineStart) + newLine + val.slice(lineEndIdx);
          // For empty items, place cursor at end of unindented marker; otherwise shift back 4.
          const newPos3    = isEmptyItem ? lineStart + newLine.length : Math.max(lineStart, pos - 4);
          setText(newText3);
          setIsDirty(true);
          requestAnimationFrame(() => { ta.selectionStart = ta.selectionEnd = newPos3; ta.focus(); pushHistory(newText3, newPos3); });
          return;
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

    // Tab / Shift-Tab to indent or unindent list items
    if (e.key === 'Tab' && slashMenu === null && ta) {
      const pos     = ta.selectionStart;
      const val     = ta.value;
      const lineStart  = val.lastIndexOf('\n', pos - 1) + 1;
      const lineEnd    = val.indexOf('\n', pos);
      const fullLine   = val.slice(lineStart, lineEnd === -1 ? val.length : lineEnd);
      if (/^(    )*([-*]|\d+\.) /.test(fullLine)) {
        e.preventDefault();
        const lineEndIdx = lineEnd === -1 ? val.length : lineEnd;
        if (e.shiftKey) {
          if (fullLine.startsWith('    ')) {
            const newLine = fullLine.slice(4);
            const newText = val.slice(0, lineStart) + newLine + val.slice(lineEndIdx);
            const newPos  = Math.max(lineStart, pos - 4);
            setText(newText); setIsDirty(true);
            requestAnimationFrame(() => { ta.selectionStart = ta.selectionEnd = newPos; pushHistory(newText, newPos); });
          }
        } else {
          const newLine = '    ' + fullLine;
          const newText = val.slice(0, lineStart) + newLine + val.slice(lineEndIdx);
          const newPos  = pos + 4;
          setText(newText); setIsDirty(true);
          requestAnimationFrame(() => { ta.selectionStart = ta.selectionEnd = newPos; pushHistory(newText, newPos); });
        }
        return;
      }
    }

    // Arrow up → end of previous line; arrow down → end of next line
    if ((e.key === 'ArrowUp' || e.key === 'ArrowDown') && slashMenu === null && ta) {
      e.preventDefault();
      const pos = ta.selectionStart;
      const val = ta.value;
      let newPos;
      if (e.key === 'ArrowUp') {
        const lineStart = val.lastIndexOf('\n', pos - 1) + 1;
        newPos = lineStart > 0 ? lineStart - 1 : 0; // end of previous line (before its \n)
      } else {
        const lineEnd = val.indexOf('\n', pos);
        if (lineEnd === -1) { newPos = val.length; }
        else {
          const nextLineEnd = val.indexOf('\n', lineEnd + 1);
          newPos = nextLineEnd === -1 ? val.length : nextLineEnd; // end of next line
        }
      }
      ta.selectionStart = ta.selectionEnd = newPos;
      updateCursor();
      return;
    }

    // List continuation on Enter
    if (e.key === 'Enter' && slashMenu === null) {
      if (ta) {
        const pos = ta.selectionStart;
        const val = ta.value;
        const lineStart = val.lastIndexOf('\n', pos - 1) + 1;
        const lineEnd = val.indexOf('\n', pos);
        const fullLine = val.slice(lineStart, lineEnd === -1 ? val.length : lineEnd);

        const ulMatch = fullLine.match(/^((?:    )*)([-*]) (.*)$/);
        const olMatch = !ulMatch && fullLine.match(/^((?:    )*)(\d+)\. (.*)$/);

        if (ulMatch || olMatch) {
          const indent  = ulMatch ? ulMatch[1] : olMatch[1];
          const isEmpty = ulMatch ? ulMatch[3].trim() === '' : olMatch[3].trim() === '';

          if (isEmpty) {
            e.preventDefault();
            if (indent.length >= 4) {
              // Nested empty item → unindent one level
              const newIndent  = indent.slice(4);
              const marker     = ulMatch ? `${ulMatch[2]} ` : `${olMatch[2]}. `;
              const lineEndIdx = lineEnd === -1 ? val.length : lineEnd;
              const newText    = val.slice(0, lineStart) + newIndent + marker + val.slice(lineEndIdx);
              const newPos     = lineStart + newIndent.length + marker.length;
              setText(newText);
              setIsDirty(true);
              requestAnimationFrame(() => { ta.selectionStart = ta.selectionEnd = newPos; pushHistory(newText, newPos); });
            } else {
              // Top-level empty item → exit list
              const newText = val.slice(0, lineStart) + '\n' + val.slice(lineEnd === -1 ? val.length : lineEnd);
              const newPos  = lineStart + 1;
              setText(newText);
              setIsDirty(true);
              requestAnimationFrame(() => { ta.selectionStart = ta.selectionEnd = newPos; pushHistory(newText, newPos); });
            }
          } else {
            // Continue list with next marker (preserving indent)
            e.preventDefault();
            const marker  = ulMatch ? `${ulMatch[2]} ` : `${parseInt(olMatch[2]) + 1}. `;
            const insert  = '\n' + indent + marker;
            const newText = val.slice(0, pos) + insert + val.slice(pos);
            const newPos  = pos + insert.length;
            setText(newText);
            setIsDirty(true);
            requestAnimationFrame(() => { ta.selectionStart = ta.selectionEnd = newPos; pushHistory(newText, newPos); });
          }
          return;
        }
      }
    }

    if ((e.metaKey || e.ctrlKey) && e.key === 'z') {
      e.preventDefault();
      const isRedo = e.shiftKey;
      const idx    = historyIdxRef.current;
      const stack  = historyRef.current;
      const target = isRedo ? idx + 1 : idx - 1;
      if (target < 0 || target >= stack.length) return;
      historyIdxRef.current = target;
      const { text: t, cursorPos: pos } = stack[target];
      setText(t);
      setCursorPos(pos);
      setIsDirty(true);
      requestAnimationFrame(() => {
        if (ta) { ta.selectionStart = ta.selectionEnd = pos; }
      });
      return;
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
      await onUpdateItem(video.id, blob, video.type);
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
    const assets = await (onGetImages ? onGetImages(video.id) : Promise.resolve([]));

    let exportText = text;
    assets.forEach(a => {
      exportText = exportText.replaceAll(`](${a.name})`, `](images/${a.name})`);
    });

    const noteName = video.name.endsWith('.md') ? video.name : video.name + '.md';
    zip.file(noteName, exportText);
    if (assets.length > 0) {
      const imgFolder = zip.folder('images');
      assets.forEach(a => imgFolder.file(a.name, a.data));
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
    if (!file || !onAddImage) return;
    try {
      await onAddImage(video.id, file.name, file, file.type);
      const url = URL.createObjectURL(file);
      setAssetUrls(prev => ({ ...prev, [file.name]: url }));
      const size = pendingImageSize.current;
      pendingImageSize.current = undefined;
      const altText = size != null ? `${file.name}|${size}` : file.name;
      const newText = text + `\n![${altText}](${file.name})`;
      setText(newText);
      setIsDirty(true);
      pushHistory(newText, newText.length);
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

  if (readOnly) {
    return React.createElement(
      'div',
      { className: 'w-full h-full flex flex-col bg-gray-800 rounded-lg shadow-lg overflow-hidden' },
      React.createElement(
        'div',
        { className: 'flex items-center justify-between px-4 py-2 border-b border-gray-700 bg-gray-800/80 shrink-0' },
        React.createElement(
          'span',
          { className: 'text-sm text-gray-400 font-mono truncate max-w-xs', title: video.name },
          video.name
        ),
        React.createElement('span', { className: 'text-xs text-amber-400 font-medium' }, 'Read-only')
      ),
      React.createElement('div', {
        className: 'bg-gray-900 text-gray-100 text-sm leading-relaxed p-6 overflow-auto flex-1',
        dangerouslySetInnerHTML: {
          __html: text ? renderMarkdown(text, assetUrls) : '<p class="text-gray-500">Empty note</p>',
        },
      })
    );
  }

  // Slash command dropdown — position from the rendered cursor span in the preview
  const visible = slashMenu ? filteredCommands(slashMenu.filter) : [];
  const coords  = (() => {
    if (!slashMenu || !previewRef.current) return { top: 0, left: 0 };
    const span = previewRef.current.querySelector('[data-cursor]');
    if (!span) return { top: 0, left: 0 };
    const r = span.getBoundingClientRect();
    return { top: r.bottom + 4, left: Math.max(8, Math.min(r.left, window.innerWidth - 240)) };
  })();

  // Insert cursor marker into text before rendering (only when focused)
  const snappedCursorPos = snapCursorPos(text, cursorPos);
  const textWithCursor = isFocused
    ? text.slice(0, snappedCursorPos) + '\x00' + text.slice(snappedCursorPos)
    : text;

  return React.createElement(
    'div',
    { className: 'w-full h-full flex flex-col bg-gray-800 rounded-lg shadow-lg overflow-hidden' },

    // Toolbar
    React.createElement(
      'div',
      { className: 'flex items-center justify-between px-4 py-2 border-b border-gray-700 bg-gray-800/80 shrink-0' },

      React.createElement(
        'span',
        { className: 'text-sm text-gray-400 font-mono truncate max-w-xs', title: video.name },
        video.name
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

    // Left: single rendered preview div (cursor marker embedded in HTML)
    React.createElement(
      'div',
      {
        ref: previewRef,
        className: 'bg-gray-900 text-gray-100 text-sm leading-relaxed p-6 overflow-auto',
        style: { flex: 1, minWidth: 0, cursor: 'text' },
        onClick: (e) => {
          const pos = clickToMarkdownPos(previewRef.current, e.clientX, e.clientY, text);
          // Set textarea selectionStart/End then focus it
          const ta = textareaRef.current;
          if (ta) {
            ta.focus();
            requestAnimationFrame(() => { ta.selectionStart = ta.selectionEnd = pos; updateCursor(); });
          }
        },
        onMouseMove: (e) => {
          if (hoveredImgClearTimer.current) { clearTimeout(hoveredImgClearTimer.current); hoveredImgClearTimer.current = null; }
          const img = e.target.closest('img[data-img-file]');
          if (img) {
            const filename = img.dataset.imgFile;
            const rect = img.getBoundingClientRect();
            setHoveredImg(prev =>
              prev && prev.filename === filename && Math.abs(prev.rect.top - rect.top) < 1 ? prev : { filename, rect }
            );
          } else {
            setHoveredImg(null);
          }
        },
        onMouseLeave: () => {
          hoveredImgClearTimer.current = setTimeout(() => setHoveredImg(null), 120);
        },
        onDragOver: (e) => e.preventDefault(),
        onDrop: (e) => {
          e.preventDefault();
          const f = e.dataTransfer.files[0];
          if (f?.type.startsWith('image/')) { textareaRef.current?.focus(); insertImage(f); }
        },
        dangerouslySetInnerHTML: {
          __html: textWithCursor
            ? renderMarkdown(textWithCursor, assetUrls)
            : '<p style="color:#4b5563;font-style:italic">Start typing, or press <kbd style="background:#374151;padding:1px 5px;border-radius:4px;font-style:normal;font-size:.85em">/</kbd> at the start of a line to insert…</p>'
        },
      }
    ),

    // Hidden textarea — sole input capture surface; never visible
    React.createElement('textarea', {
      ref: textareaRef,
      value: text,
      onChange: handleChange,
      onKeyDown: handleKeyDown,
      onSelect: updateCursor,
      onFocus: () => { setIsFocused(true); updateCursor(); },
      onBlur: () => { setIsFocused(false); setTimeout(() => setSlashMenu(null), 150); },
      onPaste: (e) => {
        const item = Array.from(e.clipboardData.items).find(i => i.type.startsWith('image/'));
        if (item) { e.preventDefault(); insertImage(item.getAsFile()); }
      },
      spellCheck: false,
      'aria-hidden': true,
      style: { position: 'fixed', top: '-9999px', left: '-9999px', width: '1px', height: '1px', opacity: 0, overflow: 'hidden' },
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
      ),

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
      React.createElement('textarea', {
        value: text,
        onChange: (e) => { setText(e.target.value); setIsDirty(true); setSaveMsg(null); },
        spellCheck: false,
        placeholder: 'empty',
        className: 'flex-grow overflow-auto p-4 text-xs font-mono text-gray-300 leading-relaxed resize-none bg-transparent focus:outline-none',
        style: { caretColor: '#a5b4fc' },
      })
    )

  ),  // end outer flex

  // ── Image hover overlay button ─────────────────────────────────
  hoveredImg && React.createElement(
    'button',
    {
      style: {
        position: 'fixed',
        top:  hoveredImg.rect.top + 6,
        left: hoveredImg.rect.right - 80,
        zIndex: 100,
        pointerEvents: 'auto',
      },
      className: 'flex items-center gap-1 px-2.5 py-1 rounded-lg text-xs font-semibold bg-indigo-600 hover:bg-indigo-500 text-white shadow-lg transition-colors',
      onMouseEnter: () => { if (hoveredImgClearTimer.current) { clearTimeout(hoveredImgClearTimer.current); hoveredImgClearTimer.current = null; } },
      onMouseLeave: () => { hoveredImgClearTimer.current = setTimeout(() => setHoveredImg(null), 80); },
      onClick: (e) => {
        e.stopPropagation();
        const { filename } = hoveredImg;
        setEditingImg({ src: assetUrls[filename] || filename, filename });
        setHoveredImg(null);
      },
    },
    React.createElement('svg', { xmlns: 'http://www.w3.org/2000/svg', className: 'h-3 w-3', fill: 'none', viewBox: '0 0 24 24', stroke: 'currentColor' },
      React.createElement('path', { strokeLinecap: 'round', strokeLinejoin: 'round', strokeWidth: 2, d: 'M15.232 5.232l3.536 3.536m-2.036-5.036a2.5 2.5 0 113.536 3.536L6.5 21.036H3v-3.572L16.732 3.732z' })
    ),
    'Edit'
  ),

  // ── ImageEditor modal ──────────────────────────────────────────
  editingImg && React.createElement(ImageEditor, {
    src:      editingImg.src,
    filename: editingImg.filename,
    onSave:   async (blob, fname) => {
      try {
        await onAddImage(video.id, fname, blob, 'image/png');
        const newUrl = URL.createObjectURL(blob);
        setAssetUrls(prev => {
          if (prev[fname]) URL.revokeObjectURL(prev[fname]);
          return { ...prev, [fname]: newUrl };
        });
      } catch (err) {
        console.error('ImageEditor save failed:', err);
      }
      setEditingImg(null);
    },
    onClose: () => setEditingImg(null),
  })

  );
};

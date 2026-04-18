
import React, { useState, useEffect, useRef } from 'react';
import { ImageEditor } from './ImageEditor.js';

// Module-level WASM singleton (mirrors Explorer.js pattern)
let _wasmModule = null;
let _wasmInitPromise = null;

function loadWasm() {
  if (_wasmModule) return Promise.resolve(_wasmModule);
  if (window.__trafilaturaWasm) { _wasmModule = window.__trafilaturaWasm; return Promise.resolve(_wasmModule); }
  if (_wasmInitPromise) return _wasmInitPromise;
  _wasmInitPromise = new Promise((resolve, reject) => {
    const script = document.createElement('script');
    script.type = 'module';
    script.textContent = `
      import init, { extract_markdown } from '/wasm/trafilatura_wasm.js';
      init('/wasm/trafilatura_wasm_bg.wasm').then(() => {
        window.__trafilaturaWasm = { extract_markdown };
        window.dispatchEvent(new CustomEvent('trafilatura-ready'));
      }).catch(e => window.dispatchEvent(new CustomEvent('trafilatura-error', { detail: e.message })));
    `;
    window.addEventListener('trafilatura-ready', () => { _wasmModule = window.__trafilaturaWasm; resolve(_wasmModule); }, { once: true });
    window.addEventListener('trafilatura-error', (e) => reject(new Error(e.detail)), { once: true });
    document.head.appendChild(script);
  });
  return _wasmInitPromise;
}

// Inline markdown: bold, italic, code, links, images
// Image size syntax: ![alt|300](file) → width:300px  |  ![alt|300x200](file) → 300×200px
const inlineMarkdown = (text, assetUrls) =>
  text
    .replace(/!\[([^\]]*)\]\(([^)]+)\)/g, (match, alt, src) => {
      const url = (assetUrls && assetUrls[src]) || src;
      const sizeMatch = alt.match(/\|(\d+)(?:x(\d+))?$/);
      const displayAlt = sizeMatch ? alt.slice(0, alt.lastIndexOf('|')) : alt;
      const sizeStyle = sizeMatch
        ? `width:${sizeMatch[1]}px;${sizeMatch[2] ? `height:${sizeMatch[2]}px;object-fit:cover;` : ''}max-width:100%;`
        : 'max-width:100%;';
      return `<img data-img-file="${escapeHtml(src)}" alt="${escapeHtml(displayAlt)}" src="${url}" style="${sizeStyle}border-radius:6px;margin:4px 0;display:block" />`;
    })
    .replace(/`([^`]+)`/g, '<code style="background:#374151;padding:2px 5px;border-radius:3px;font-size:.9em">$1</code>')
    .replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
    .replace(/\*(.+?)\*/g,     '<em>$1</em>')
    .replace(
      /\[([^\]]+)\]\((https?:\/\/(?:www\.)?(?:youtube\.com\/watch\?(?:[^)]*&)?v=|youtu\.be\/)([a-zA-Z0-9_-]{11})[^)]*)\)/g,
      (_, linkText, url, videoId) =>
        `<a href="${url}" target="_blank" rel="noopener noreferrer" style="display:inline-flex;align-items:center;gap:6px;text-decoration:none;background:#1f2937;border:1px solid #374151;border-radius:8px;padding:4px 8px 4px 4px;margin:2px 0">` +
        `<img src="https://img.youtube.com/vi/${videoId}/mqdefault.jpg" alt="" style="width:80px;height:45px;object-fit:cover;border-radius:4px;flex-shrink:0" />` +
        `<span style="color:#ef4444;font-size:.8em;font-weight:600">▶ ${escapeHtml(linkText)}</span>` +
        `</a>`
    )
    .replace(/\[([^\]]+)\]\(([^)]+)\)/g, '<a href="$2" style="color:#818cf8;text-decoration:underline">$1</a>');

// Line-based Markdown → HTML renderer
const renderMarkdown = (text, assetUrls) => {
  const lines  = text.split('\n');
  const output = [];
  const headingSlugSeen = new Map();
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
      i++;
      output.push(`<pre style="background:#1a1a2e;padding:12px;border-radius:6px;overflow:auto;margin:0"><code>${escapeHtml(codeLines.join('\n'))}</code></pre>`);
      continue;
    }

    // Block image line
    if (/^!\[[^\]]*\]\([^)]+\)$/.test(line)) {
      output.push(`<div style="margin:0">${inlineMarkdown(line, assetUrls)}</div>`);
      i++;
      continue;
    }

    // List block — consume consecutive list items and build nested <ul>/<ol>
    const listMatch = line.match(/^((?:    )*)([-*+]|\d+\.) /);
    if (listMatch) {
      const listLines = [];
      while (i < lines.length) {
        const lm = lines[i].match(/^((?:    )*)([-*+]|\d+\.) /);
        if (!lm) break;
        listLines.push({ indent: lm[1].length / 4, marker: lm[2], content: lines[i].slice(lm[0].length) });
        i++;
      }

      const buildList = (items, start, depth) => {
        let html = '';
        let idx = start;
        while (idx < items.length && items[idx].indent >= depth) {
          if (items[idx].indent > depth) {
            const sub = buildList(items, idx, items[idx].indent);
            html += sub.html;
            idx = sub.next;
            continue;
          }
          const isOl = /^\d+\./.test(items[idx].marker);
          const tag = isOl ? 'ol' : 'ul';
          html += `<${tag} style="margin:0;padding-left:20px;list-style-type:${isOl ? 'decimal' : 'disc'}" data-md-marker="${items[idx].marker}">`;
          while (idx < items.length && items[idx].indent === depth) {
            const isNextOl = /^\d+\./.test(items[idx].marker);
            if ((isOl && !isNextOl) || (!isOl && isNextOl)) break;
            html += `<li style="margin:0">${inlineMarkdown(items[idx].content, assetUrls)}`;
            idx++;
            if (idx < items.length && items[idx].indent > depth) {
              const sub = buildList(items, idx, items[idx].indent);
              html += sub.html;
              idx = sub.next;
            }
            html += '</li>';
          }
          html += `</${tag}>`;
        }
        return { html, next: idx };
      };
      output.push(buildList(listLines, 0, 0).html);
      continue;
    }

    // Headings
    const hMatch = line.match(/^(#{1,3}) (.+)$/);
    if (hMatch) {
      const lvl    = hMatch[1].length;
      const hStyles = [
        'font-weight:800;text-decoration:underline;text-underline-offset:3px;margin:0',
        'font-weight:700;border-bottom:1px solid #4b5563;margin:0',
        'font-weight:700;color:#c7d2fe;margin:0',
      ];
      const content = line.slice(hMatch[1].length + 1);
      const base    = slugify(stripInlineMarkdown(content));
      const cnt     = (headingSlugSeen.get(base) || 0) + 1;
      headingSlugSeen.set(base, cnt);
      const slug    = cnt === 1 ? base : `${base}-${cnt}`;
      output.push(`<h${lvl} id="${slug}" style="${hStyles[lvl - 1]}">${inlineMarkdown(content, assetUrls)}</h${lvl}>`);
      i++;
      continue;
    }

    // Horizontal rule
    if (line.trim() === '---') {
      output.push('<hr style="border-color:#374151;margin:0" />');
      i++;
      continue;
    }

    // Blank line
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

const unescapeHtml = (str) =>
  str.replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"');

// Reverse of renderMarkdown — walks the contentEditable DOM and reconstructs
// the original markdown text, preserving images, blank lines, headings, lists,
// code blocks, inline formatting, and YouTube embeds.
const htmlDivsToMarkdown = (containerEl, assetUrls) => {
  const urlToFilename = Object.fromEntries(
    Object.entries(assetUrls || {}).map(([name, url]) => [url, name])
  );

  const inlineToMd = (node) => {
    if (!node) return '';
    if (node.nodeType === Node.TEXT_NODE) return node.textContent;
    if (node.nodeType !== Node.ELEMENT_NODE) return '';
    const tag = node.tagName.toLowerCase();
    if (tag === 'br') return '\n';
    if (tag === 'strong' || tag === 'b') return `**${childrenToMd(node)}**`;
    if (tag === 'em' || tag === 'i') return `*${childrenToMd(node)}*`;
    if (tag === 'code' && !node.closest('pre')) return `\`${node.textContent}\``;
    if (tag === 'img') {
      if (node.src && /img\.youtube\.com/.test(node.src)) return '';
      const filename = node.dataset?.imgFile || urlToFilename[node.src] || node.getAttribute('src') || '';
      let altText = node.alt || '';
      const w = node.style?.width?.match(/^(\d+)px$/);
      const h = node.style?.height?.match(/^(\d+)px$/);
      if (w) altText = h ? `${altText}|${w[1]}x${h[1]}` : `${altText}|${w[1]}`;
      return `![${altText}](${filename})`;
    }
    if (tag === 'a') {
      const href = node.getAttribute('href') || '';
      const ytImg = node.querySelector('img[src*="youtube"]');
      if (ytImg) {
        const span = node.querySelector('span');
        const linkText = span ? span.textContent.replace(/^▶\s*/, '') : node.textContent;
        return `[${linkText}](${href})`;
      }
      return `[${childrenToMd(node)}](${href})`;
    }
    if (tag === 'ul' || tag === 'ol') return '';
    return childrenToMd(node);
  };

  const childrenToMd = (el) =>
    Array.from(el.childNodes).map(inlineToMd).join('');

  const getContent = (el, skipMarkerSpan) => {
    const nodes = Array.from(el.childNodes);
    let start = 0;
    if (skipMarkerSpan && nodes[0]?.nodeType === Node.ELEMENT_NODE && nodes[0].tagName === 'SPAN') start = 1;
    return nodes.slice(start).map(inlineToMd).join('');
  };

  const lines = [];
  for (const node of containerEl.childNodes) {
    if (node.nodeType === Node.TEXT_NODE) {
      const t = node.textContent;
      if (t.trim()) lines.push(t);
      // Whitespace-only text nodes between block elements are HTML formatting
      // from renderMarkdown's output.join('\n'), not content — skip them.
      continue;
    }
    if (node.nodeType !== Node.ELEMENT_NODE) continue;
    const tag = node.tagName.toLowerCase();

    if (tag === 'br')  { lines.push(''); continue; }
    if (tag === 'hr')  { lines.push('---'); continue; }

    if (tag === 'pre') {
      const code = node.querySelector('code');
      lines.push('```');
      lines.push(unescapeHtml(code ? code.innerHTML : node.textContent));
      lines.push('```');
      continue;
    }

    if (/^h[1-3]$/.test(tag)) {
      const hText = getContent(node).trim();
      lines.push(hText ? `${'#'.repeat(parseInt(tag[1]))} ${hText}` : `${'#'.repeat(parseInt(tag[1]))} `);
      continue;
    }

    if (tag === 'ul' || tag === 'ol') {
      const walkList = (listEl, depth) => {
        const defaultMarker = listEl.tagName === 'OL' ? null : (listEl.dataset.mdMarker || '-');
        let olIdx = 1;
        for (const li of listEl.children) {
          if (li.tagName !== 'LI') continue;
          const indent = '    '.repeat(depth);
          const marker = defaultMarker || `${olIdx}.`;
          const content = getContent(li).replace(/\n+$/, '');
          lines.push(`${indent}${marker} ${content}`);
          if (!defaultMarker) olIdx++;
          for (const child of li.children) {
            if (child.tagName === 'UL' || child.tagName === 'OL') walkList(child, depth + 1);
          }
        }
      };
      walkList(node, 0);
      continue;
    }

    if (tag === 'div') {
      if (node.innerHTML === '&nbsp;' || (node.textContent.trim() === '' && !node.querySelector('img'))) {
        lines.push('');
        continue;
      }

      const img = node.querySelector('img[data-img-file]');
      if (img && node.children.length === 1 && node.childNodes.length <= 2) {
        lines.push(inlineToMd(img));
        continue;
      }

      lines.push(getContent(node));
      continue;
    }

    lines.push(node.textContent);
  }
  return lines.join('\n');
};

const stripInlineMarkdown = (s) =>
  s.replace(/\*\*(.+?)\*\*/g, '$1').replace(/\*(.+?)\*/g, '$1').replace(/`([^`]+)`/g, '$1');

const slugify = (s) =>
  s.toLowerCase().replace(/[^a-z0-9\s-]/g, '').trim().replace(/\s+/g, '-') || 'section';

const extractHeadings = (text) => {
  const seen = new Map();
  return text.split('\n').reduce((acc, line, i) => {
    const m = line.match(/^(#{1,3}) (.+)$/);
    if (!m) return acc;
    const title = stripInlineMarkdown(m[2]);
    const base  = slugify(title);
    const cnt   = (seen.get(base) || 0) + 1;
    seen.set(base, cnt);
    const slug  = cnt === 1 ? base : `${base}-${cnt}`;
    acc.push({ level: m[1].length, title, lineIdx: i, slug });
    return acc;
  }, []);
};

const extractHeadingsFromDom = (container) => {
  if (!container) return [];
  const seen = new Map();
  const headings = container.querySelectorAll('h1, h2, h3');
  return Array.from(headings).map((el) => {
    const level = parseInt(el.tagName[1]);
    const title = el.textContent.trim();
    const base  = slugify(title || 'section');
    const cnt   = (seen.get(base) || 0) + 1;
    seen.set(base, cnt);
    const slug  = el.id || (cnt === 1 ? base : `${base}-${cnt}`);
    return { level, title, slug, el };
  });
};

const escapeRegExp = (str) => str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/** Cursor-aware slash-command trigger for the markdown textarea (controlled inputs can report selection late in onChange). */
function computeSlashMenuFromTextarea(ta) {
  if (!ta) return null;
  const val = ta.value;
  let pos = ta.selectionStart;
  if (typeof pos !== 'number' || pos < 0) pos = val.length;
  let slashPos = -1;
  if (pos > 0 && val.charAt(pos - 1) === '/') slashPos = pos - 1;
  else if (val.length >= 1 && val.charAt(0) === '/' && pos === 0) slashPos = 0;
  if (slashPos < 0) return null;
  const lineStart = val.lastIndexOf('\n', slashPos - 1) + 1;
  const beforeSlash = val.slice(lineStart, slashPos);
  return { slashPos, filter: '', activeIdx: 0, atLineStart: beforeSlash.trim() === '' };
}

function setImageWidthInMarkdown(markdown, filename, widthPx) {
  const safeName = escapeRegExp(filename);
  const imageRe  = new RegExp(`!\\[([^\\]]*)\\]\\(${safeName}\\)`, 'g');
  let replaced   = false;
  return markdown.replace(imageRe, (full, alt) => {
    if (replaced) return full;
    replaced = true;
    const cleanAlt = (alt || '').replace(/\|\d+(?:x\d+)?$/, '').trim();
    return `![${cleanAlt || filename}|${widthPx}](${filename})`;
  });
}

// Slash command definitions
const SLASH_COMMANDS = [
  { id: 'h1',       label: 'Title',          hint: '# Heading',       insert: '# ',   blockOnly: true },
  { id: 'h2',       label: 'Heading 2',      hint: '## Heading',      insert: '## ',  blockOnly: true },
  { id: 'h3',       label: 'Heading 3',      hint: '### Heading',     insert: '### ', blockOnly: true },
  { id: 'ul-dash',  label: 'List — dash',     hint: '- item',          insert: '- ',   blockOnly: true, listMarker: '-'  },
  { id: 'ul-star',  label: 'List — star',     hint: '* item',          insert: '* ',   blockOnly: true, listMarker: '*'  },
  { id: 'ul-plus',  label: 'List — plus',     hint: '+ item',          insert: '+ ',   blockOnly: true, listMarker: '+'  },
  { id: 'ol',       label: 'Numbered list',   hint: '1. item',         insert: '1. ',  blockOnly: true },
  { id: 'image',    label: 'Image',          hint: 'full width',      insert: null,   imageSize: null  },
  { id: 'image-sm', label: 'Image — Small',  hint: '300 px',          insert: null,   imageSize: 300   },
  { id: 'image-md', label: 'Image — Medium', hint: '500 px',          insert: null,   imageSize: 500   },
  { id: 'image-lg', label: 'Image — Large',  hint: '800 px',          insert: null,   imageSize: 800   },
  { id: 'youtube',  label: 'YouTube embed',  hint: 'paste URL',       insert: '[Video Title](https://youtube.com/watch?v=)' },
  { id: 'goto',     label: 'Go to section',  hint: 'jump to heading', insert: null,   gotoSection: true },
];

export const MarkdownEditor = ({ video, onUpdateItem, onAddImage, onGetImages, readOnly, onRename }) => {
  const [text,        setText]        = useState('');
  const [isLoading,   setIsLoading]   = useState(true);
  const [isDirty,     setIsDirty]     = useState(false);
  const [isSaving,    setIsSaving]    = useState(false);
  const [saveMsg,     setSaveMsg]     = useState(null);
  const [assetUrls,   setAssetUrls]   = useState({});
  const [slashMenu,   setSlashMenu]   = useState(null);
  const [editMode,    setEditMode]    = useState('html');  // 'html' | 'markdown'
  const [hoveredImg,  setHoveredImg]  = useState(null);
  const [resizingImg, setResizingImg] = useState(null);
  const [editingImg,  setEditingImg]  = useState(null);
  const [showToc,     setShowToc]     = useState(false);
  const [headingMenu, setHeadingMenu] = useState(null);
  const [displayName, setDisplayName] = useState(video.name);
  const [isEditingName, setIsEditingName] = useState(false);

  const hoveredImgClearTimer = useRef(null);
  const tocButtonRef         = useRef(null);
  const textRef              = useRef('');
  const imageInputRef        = useRef(null);
  const mdTextareaRef        = useRef(null);   // visible markdown textarea (MD Edit mode)
  const previewRef           = useRef(null);   // read-only preview pane (MD Edit mode)
  const contentEditableRef   = useRef(null);   // editable div (HTML Edit mode)
  const pendingImageSize     = useRef(undefined);
  const historyRef           = useRef([]);
  const historyIdxRef        = useRef(-1);
  const htmlPristine         = useRef(true);   // true = contenteditable not yet edited by user
  const htmlSlashRef         = useRef(null);   // { node, offset } — tracks '/' position in contentEditable for slash commands

  useEffect(() => { textRef.current = text; }, [text]);

  // Load note text + assets
  useEffect(() => {
    setIsLoading(true);
    setIsDirty(false);
    setSlashMenu(null);
    setEditMode('html');
    setDisplayName(video.name);
    setIsEditingName(false);
    htmlPristine.current   = true;
    historyRef.current     = [];
    historyIdxRef.current  = -1;

    const reader = new FileReader();
    reader.onload = (e) => {
      const loaded = e.target?.result ?? '';
      setText(loaded);
      historyRef.current    = [{ text: loaded, cursorPos: 0 }];
      historyIdxRef.current = 0;
      setIsLoading(false);
    };
    reader.onerror = () => { setText(''); setIsLoading(false); };
    reader.readAsText(video.data);

    if (onGetImages) {
      onGetImages(video.id).then(assets => {
        const urls = {};
        assets.forEach(a => { urls[a.name] = URL.createObjectURL(a.data); });
        setAssetUrls(urls);
      }).catch(() => {});
    }
  }, [video.id]);

  // Revoke object URLs on cleanup
  useEffect(() => {
    const urls = assetUrls;
    return () => { Object.values(urls).forEach(u => URL.revokeObjectURL(u)); };
  }, [assetUrls]);

  useEffect(() => {
    const style = document.createElement('style');
    style.textContent = '[contenteditable="true"] a[href^="#"] { cursor: pointer !important; }';
    document.head.appendChild(style);
    return () => style.remove();
  }, []);

  // Populate contenteditable when in html mode and pristine (on load, asset update, or mode switch)
  useEffect(() => {
    if (!isLoading && editMode === 'html' && htmlPristine.current && contentEditableRef.current) {
      contentEditableRef.current.innerHTML = renderMarkdown(textRef.current, assetUrls);
    }
  }, [isLoading, assetUrls, editMode]);

  const pushHistory = (t, cursorPos) => {
    historyRef.current = historyRef.current.slice(0, historyIdxRef.current + 1);
    historyRef.current.push({ text: t, cursorPos });
    if (historyRef.current.length > 200) historyRef.current.shift();
    else historyIdxRef.current++;
  };

  // Convert current markdown → HTML and switch to html mode
  const switchToHtml = () => {
    htmlPristine.current = true;
    setSlashMenu(null);
    htmlSlashRef.current = null;
    setHeadingMenu(null);
    setShowToc(false);
    setEditMode('html');
    requestAnimationFrame(() => contentEditableRef.current?.focus());
  };

  const convertEditableToMd = () => {
    if (!contentEditableRef.current) return textRef.current;
    return htmlDivsToMarkdown(contentEditableRef.current, assetUrls);
  };

  // Read contenteditable DOM → convert to markdown → switch to markdown mode
  const switchToMarkdown = () => {
    if (!contentEditableRef.current) return;
    setSlashMenu(null);
    htmlSlashRef.current = null;
    const md = convertEditableToMd();
    setText(md);
    setIsDirty(true);
    pushHistory(md, 0);
    setEditMode('markdown');
  };

  // Helper: run DOM→MD conversion without switching mode (used by save + export)
  const htmlToMarkdown = () => convertEditableToMd();

  // Image resize (only active in markdown mode)
  useEffect(() => {
    if (!resizingImg) return;
    const minWidth = 120, maxWidth = 1600;

    const container = editMode === 'html' ? contentEditableRef.current : previewRef.current;

    const onMove = (e) => {
      const delta = e.clientX - resizingImg.startX;
      const next  = Math.max(minWidth, Math.min(maxWidth, Math.round(resizingImg.startWidth + delta)));
      setResizingImg(prev => prev ? { ...prev, width: next } : prev);
      const img = container?.querySelector(`img[data-img-file="${CSS.escape(resizingImg.filename)}"]`);
      if (img) { img.style.width = `${next}px`; img.style.maxWidth = 'none'; }
    };

    const onUp = () => {
      if (editMode === 'html') {
        htmlPristine.current = false;
        setIsDirty(true);
      } else {
        const updated = setImageWidthInMarkdown(textRef.current, resizingImg.filename, resizingImg.width);
        if (updated !== textRef.current) {
          setText(updated);
          setIsDirty(true);
          requestAnimationFrame(() => pushHistory(updated, mdTextareaRef.current?.selectionStart ?? updated.length));
        }
      }
      setResizingImg(null);
    };

    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup',  onUp);
    return () => { window.removeEventListener('mousemove', onMove); window.removeEventListener('mouseup', onUp); };
  }, [resizingImg, editMode]);

  const filteredCommands = (filter, atLineStart = true) => {
    const pool = atLineStart ? SLASH_COMMANDS : SLASH_COMMANDS.filter(c => c.gotoSection);
    if (!filter) return pool;
    const q = filter.toLowerCase();
    return pool.filter(c =>
      c.label.toLowerCase().includes(q) || c.id.replace(/-/g, '').includes(q.replace(/-/g, ''))
    );
  };

  const tryOpenSlashMenu = (ta) => {
    const state = computeSlashMenuFromTextarea(ta);
    if (!state) return;
    setSlashMenu((prev) => (prev === null ? state : prev));
  };

  const applySlashCommand = (cmd) => {
    if (!cmd || !mdTextareaRef.current) return;
    const ta    = mdTextareaRef.current;
    const end   = ta.selectionStart;
    const start = slashMenu.slashPos;
    setSlashMenu(null);

    if (cmd.gotoSection) {
      const newText = text.slice(0, start) + text.slice(end);
      setText(newText); setIsDirty(true);
      requestAnimationFrame(() => { ta.selectionStart = ta.selectionEnd = start; ta.focus(); pushHistory(newText, start); });
      const headings = extractHeadings(newText);
      if (headings.length > 0) setHeadingMenu({ insertPos: start, activeIdx: 0 });
      return;
    }

    if (cmd.insert === null) {
      const newText = text.slice(0, start) + text.slice(end);
      setText(newText); setIsDirty(true);
      pendingImageSize.current = cmd.imageSize;
      requestAnimationFrame(() => { ta.selectionStart = ta.selectionEnd = start; ta.focus(); pushHistory(newText, start); });
      imageInputRef.current?.click();
      return;
    }

    const newText   = text.slice(0, start) + cmd.insert + text.slice(end);
    const newCursor = start + cmd.insert.length;
    setText(newText); setIsDirty(true);
    requestAnimationFrame(() => { ta.selectionStart = ta.selectionEnd = newCursor; ta.focus(); pushHistory(newText, newCursor); });
  };

  // ── HTML-mode slash command helpers ────────────────────────────────

  const HEADING_STYLES = {
    h1: 'font-weight:800;text-decoration:underline;text-underline-offset:3px;margin:0',
    h2: 'font-weight:700;border-bottom:1px solid #4b5563;margin:0',
    h3: 'font-weight:700;color:#c7d2fe;margin:0',
  };

  const getLineDiv = (node) => {
    let el = node.nodeType === Node.TEXT_NODE ? node.parentElement : node;
    while (el && el.parentElement !== contentEditableRef.current) el = el.parentElement;
    return el && el !== contentEditableRef.current ? el : null;
  };

  const handleHtmlInput = () => {
    htmlPristine.current = false;
    setIsDirty(true);
    setSaveMsg(null);

    const sel = window.getSelection();
    if (!sel || !sel.rangeCount || !sel.isCollapsed) {
      if (htmlSlashRef.current) { htmlSlashRef.current = null; setSlashMenu(null); }
      return;
    }
    const node   = sel.focusNode;
    const offset = sel.focusOffset;
    if (!node || node.nodeType !== Node.TEXT_NODE) {
      if (htmlSlashRef.current) { htmlSlashRef.current = null; setSlashMenu(null); }
      return;
    }

    if (htmlSlashRef.current) {
      const { node: sNode, offset: sOff } = htmlSlashRef.current;
      if (node === sNode && offset > sOff && sOff < sNode.textContent.length && sNode.textContent.charAt(sOff) === '/') {
        const filter = sNode.textContent.slice(sOff + 1, offset);
        setSlashMenu(prev => prev ? { ...prev, filter, activeIdx: 0 } : prev);
      } else {
        htmlSlashRef.current = null;
        setSlashMenu(null);
      }
      return;
    }

    if (offset > 0 && node.textContent.charAt(offset - 1) === '/') {
      const before   = node.textContent.slice(0, offset - 1).trim();
      const isFirst  = !node.previousSibling;
      htmlSlashRef.current = { node, offset: offset - 1 };
      setSlashMenu({ slashPos: 0, filter: '', activeIdx: 0, atLineStart: before === '' && isFirst });
    }
  };

  const handleHtmlKeyDown = (e) => {
    if ((e.metaKey || e.ctrlKey) && e.key === 's') {
      e.preventDefault();
      if (isDirty && !isSaving) handleSave();
      return;
    }

    if (headingMenu !== null) {
      const headings = extractHeadingsFromDom(contentEditableRef.current);
      if (e.key === 'ArrowDown') { e.preventDefault(); setHeadingMenu(prev => ({ ...prev, activeIdx: (prev.activeIdx + 1) % headings.length })); return; }
      if (e.key === 'ArrowUp')   { e.preventDefault(); setHeadingMenu(prev => ({ ...prev, activeIdx: (prev.activeIdx - 1 + headings.length) % headings.length })); return; }
      if (e.key === 'Enter' || e.key === 'Tab') { e.preventDefault(); applyHeadingMenuHtml(headings[headingMenu.activeIdx]); return; }
      if (e.key === 'Escape') { e.preventDefault(); setHeadingMenu(null); return; }
    }

    if (slashMenu !== null && htmlSlashRef.current) {
      const visible = filteredCommands(slashMenu.filter, slashMenu.atLineStart);
      if (visible.length === 0) {
        if (e.key === 'Escape') { e.preventDefault(); setSlashMenu(null); htmlSlashRef.current = null; }
        return;
      }
      if (e.key === 'ArrowDown') { e.preventDefault(); setSlashMenu(prev => ({ ...prev, activeIdx: (prev.activeIdx + 1) % visible.length })); return; }
      if (e.key === 'ArrowUp')   { e.preventDefault(); setSlashMenu(prev => ({ ...prev, activeIdx: (prev.activeIdx - 1 + visible.length) % visible.length })); return; }
      if (e.key === 'Enter' || e.key === 'Tab') { e.preventDefault(); applyHtmlSlashCommand(visible[slashMenu.activeIdx]); return; }
      if (e.key === 'Escape') { e.preventDefault(); setSlashMenu(null); htmlSlashRef.current = null; return; }
    }

    // Enter key handling in HTML mode
    if (e.key === 'Enter' && !slashMenu) {
      const sel = window.getSelection();
      if (!sel || !sel.isCollapsed || !contentEditableRef.current) return;
      const focusNode = sel.focusNode;
      const lineDiv = getLineDiv(focusNode);

      // Enter after a heading → new plain div
      if (lineDiv && /^h[1-3]$/i.test(lineDiv.tagName)) {
        e.preventDefault();
        const newDiv = document.createElement('div');
        newDiv.style.margin = '0';
        newDiv.appendChild(document.createElement('br'));
        lineDiv.after(newDiv);
        const range = document.createRange();
        range.setStart(newDiv, 0);
        range.collapse(true);
        sel.removeAllRanges();
        sel.addRange(range);
        htmlPristine.current = false;
        setIsDirty(true);
        return;
      }

      // Enter inside a list item (<li>) → continue the list
      let liEl = focusNode.nodeType === Node.TEXT_NODE ? focusNode.parentElement : focusNode;
      while (liEl && liEl.tagName !== 'LI' && liEl !== contentEditableRef.current) liEl = liEl.parentElement;
      if (liEl && liEl.tagName === 'LI') {
        const listEl = liEl.parentElement;
        if (!listEl || (listEl.tagName !== 'UL' && listEl.tagName !== 'OL')) return;

        const isEmpty = liEl.textContent.trim() === '';
        e.preventDefault();

        if (isEmpty) {
          // Empty list item → exit the list, insert a plain div after the list
          const topList = listEl.closest('ul, ol') || listEl;
          // Walk up to the top-level list
          let top = listEl;
          while (top.parentElement && top.parentElement.tagName !== 'LI'
                 && top.parentElement !== contentEditableRef.current) top = top.parentElement;
          if (top.parentElement && top.parentElement.tagName === 'LI') top = top.parentElement.parentElement;

          liEl.remove();
          if (listEl.children.length === 0) listEl.remove();

          const newDiv = document.createElement('div');
          newDiv.style.margin = '0';
          newDiv.appendChild(document.createElement('br'));
          top.after(newDiv);
          const range = document.createRange();
          range.setStart(newDiv, 0);
          range.collapse(true);
          sel.removeAllRanges();
          sel.addRange(range);
        } else {
          // Non-empty → insert a new <li> after the current one
          const newLi = document.createElement('li');
          newLi.setAttribute('style', 'margin:0');
          newLi.appendChild(document.createElement('br'));

          // If this is an <ol>, the browser handles numbering automatically
          liEl.after(newLi);

          const range = document.createRange();
          range.setStart(newLi, 0);
          range.collapse(true);
          sel.removeAllRanges();
          sel.addRange(range);
        }

        htmlPristine.current = false;
        setIsDirty(true);
        return;
      }
    }

    // Tab / Shift-Tab to indent/unindent list items in HTML mode
    if (e.key === 'Tab' && !slashMenu) {
      const sel = window.getSelection();
      if (!sel || !sel.isCollapsed || !contentEditableRef.current) return;
      let liEl = sel.focusNode;
      if (liEl.nodeType === Node.TEXT_NODE) liEl = liEl.parentElement;
      while (liEl && liEl.tagName !== 'LI' && liEl !== contentEditableRef.current) liEl = liEl.parentElement;
      if (!liEl || liEl.tagName !== 'LI') return;

      const parentList = liEl.parentElement;
      if (!parentList) return;

      e.preventDefault();

      if (e.shiftKey) {
        // Outdent: move <li> out of its parent <ul>/<ol> up one level
        const grandparentLi = parentList.parentElement;
        if (grandparentLi && grandparentLi.tagName === 'LI') {
          grandparentLi.after(liEl);
          // Wrap the outdented <li> needs to be in the grandparent list
          const gpList = grandparentLi.parentElement;
          if (gpList && (gpList.tagName === 'UL' || gpList.tagName === 'OL')) {
            // li is now a sibling of grandparentLi inside gpList — correct
          }
          if (parentList.children.length === 0) parentList.remove();
        }
      } else {
        // Indent: wrap <li> in a new sub-list inside the previous sibling <li>
        const prevLi = liEl.previousElementSibling;
        if (prevLi && prevLi.tagName === 'LI') {
          let subList = prevLi.querySelector(':scope > ul, :scope > ol');
          if (!subList) {
            subList = document.createElement(parentList.tagName.toLowerCase());
            subList.setAttribute('style', `margin:0;padding-left:20px;list-style-type:${parentList.tagName === 'OL' ? 'decimal' : 'disc'}`);
            if (parentList.dataset.mdMarker) subList.dataset.mdMarker = parentList.dataset.mdMarker;
            prevLi.appendChild(subList);
          }
          subList.appendChild(liEl);
        }
      }

      placeCursor(liEl, 0);
      htmlPristine.current = false;
      setIsDirty(true);
    }
  };

  const applyHtmlSlashCommand = (cmd) => {
    if (!cmd || !htmlSlashRef.current || !contentEditableRef.current) return;
    const { node, offset } = htmlSlashRef.current;
    const sel = window.getSelection();
    const cursorEnd = (sel?.focusNode === node) ? sel.focusOffset : offset + 1;

    setSlashMenu(null);
    htmlSlashRef.current = null;

    // Find the line element BEFORE modifying the text node
    let lineDiv = getLineDiv(node);
    if (!lineDiv && node.parentElement === contentEditableRef.current) {
      const wrapper = document.createElement('div');
      wrapper.style.margin = '0';
      node.parentElement.insertBefore(wrapper, node);
      wrapper.appendChild(node);
      lineDiv = wrapper;
    }

    // Remove '/' and any filter text from the DOM text node
    const before = node.textContent.slice(0, offset);
    const after  = node.textContent.slice(cursorEnd);
    node.textContent = before + after;

    // Place cursor inside the given element at a text position
    const placeCursor = (el, pos) => {
      try {
        let target = el;
        // Walk into the first text node if el is an element
        if (target.nodeType !== Node.TEXT_NODE) {
          const walker = document.createTreeWalker(target, NodeFilter.SHOW_TEXT);
          target = walker.firstChild() || target;
        }
        const r = document.createRange();
        if (target.nodeType === Node.TEXT_NODE) {
          r.setStart(target, Math.min(pos, target.textContent.length));
        } else {
          r.setStart(target, 0);
        }
        r.collapse(true);
        sel.removeAllRanges();
        sel.addRange(r);
      } catch (_) {}
    };

    if (cmd.insert === null && !cmd.gotoSection) {
      placeCursor(node, offset);
      pendingImageSize.current = cmd.imageSize;
      imageInputRef.current?.click();
      htmlPristine.current = false;
      setIsDirty(true);
      return;
    }

    if (cmd.gotoSection) {
      placeCursor(node, offset);
      const headings = extractHeadingsFromDom(contentEditableRef.current);
      if (headings.length > 0) setHeadingMenu({ activeIdx: 0 });
      htmlPristine.current = false;
      setIsDirty(true);
      return;
    }

    if (cmd.id === 'h1' || cmd.id === 'h2' || cmd.id === 'h3') {
      const lvl = cmd.id.charAt(1);
      const heading = document.createElement(`h${lvl}`);
      heading.setAttribute('style', HEADING_STYLES[cmd.id]);

      // Collect any meaningful text left on this line (excluding the removed slash)
      const leftover = before + after;

      if (lineDiv) {
        lineDiv.replaceWith(heading);
      } else {
        contentEditableRef.current.appendChild(heading);
      }

      // Populate: either the leftover text or a <br> for visible height
      if (leftover) {
        heading.textContent = leftover;
      } else {
        heading.appendChild(document.createElement('br'));
      }

      placeCursor(heading, leftover ? Math.min(offset, leftover.length) : 0);
      htmlPristine.current = false;
      setIsDirty(true);
      return;
    }

    if (cmd.listMarker || cmd.id === 'ol') {
      const isOl = cmd.id === 'ol';
      const tag = isOl ? 'ol' : 'ul';
      const list = document.createElement(tag);
      list.setAttribute('style', `margin:0;padding-left:20px;list-style-type:${isOl ? 'decimal' : 'disc'}`);
      if (!isOl) list.dataset.mdMarker = cmd.listMarker;
      const li = document.createElement('li');
      li.setAttribute('style', 'margin:0');

      const leftover = before + after;
      if (leftover) {
        li.textContent = leftover;
      } else {
        li.appendChild(document.createElement('br'));
      }

      list.appendChild(li);

      if (lineDiv) {
        lineDiv.replaceWith(list);
      } else {
        contentEditableRef.current.appendChild(list);
      }

      placeCursor(li, leftover ? Math.min(offset, leftover.length) : 0);
      htmlPristine.current = false;
      setIsDirty(true);
      return;
    }

    if (cmd.insert) {
      setCursor();
      document.execCommand('insertText', false, cmd.insert);
      htmlPristine.current = false;
      setIsDirty(true);
    }
  };

  const handleChange = (e) => {
    const ta = e.target;
    const val = ta.value;
    const pos = typeof ta.selectionStart === 'number' ? ta.selectionStart : val.length;
    setText(val);
    setIsDirty(true);
    setSaveMsg(null);
    pushHistory(val, pos);

    // Open slash menu when '/' is at the cursor (sync + next frame — selection can lag behind value in controlled textareas)
    tryOpenSlashMenu(ta);
    requestAnimationFrame(() => {
      if (mdTextareaRef.current) tryOpenSlashMenu(mdTextareaRef.current);
    });

    // Update slash menu filter or close if '/' was deleted
    if (slashMenu !== null) {
      if (pos <= slashMenu.slashPos || val[slashMenu.slashPos] !== '/') {
        setSlashMenu(null);
      } else {
        const filter = val.slice(slashMenu.slashPos + 1, pos);
        setSlashMenu(prev => ({ ...prev, filter, activeIdx: 0 }));
      }
    }
  };

  const handleKeyDown = (e) => {
    const ta = mdTextareaRef.current;

    // Slash menu: also re-check after '/' is applied (covers selection quirks with controlled textarea)
    if (
      ta &&
      (e.key === '/' || e.code === 'NumpadDivide') &&
      !e.ctrlKey &&
      !e.metaKey &&
      !e.altKey &&
      !e.isComposing
    ) {
      requestAnimationFrame(() => {
        if (document.activeElement === ta) tryOpenSlashMenu(ta);
      });
    }

    // Delete entire image line on Backspace
    if (e.key === 'Backspace' && ta && ta.selectionStart === ta.selectionEnd) {
      const pos         = ta.selectionStart;
      const val         = ta.value;
      const lineStart   = val.lastIndexOf('\n', pos - 1) + 1;
      const lineEnd     = val.indexOf('\n', pos);
      const currentLine = val.slice(lineStart, lineEnd === -1 ? val.length : lineEnd);

      if (/^!\[[^\]]*\]\([^)]+\)$/.test(currentLine)) {
        e.preventDefault();
        const delStart = lineStart > 0 ? lineStart - 1 : 0;
        const delEnd   = lineStart > 0 ? (lineEnd === -1 ? val.length : lineEnd) : (lineEnd === -1 ? val.length : lineEnd + 1);
        const newText  = val.slice(0, delStart) + val.slice(delEnd);
        setText(newText); setIsDirty(true);
        requestAnimationFrame(() => { ta.selectionStart = ta.selectionEnd = delStart; ta.focus(); pushHistory(newText, delStart); });
        return;
      }

      if (pos === lineStart && lineStart > 0) {
        const prevLineEnd   = lineStart - 1;
        const prevLineStart = val.lastIndexOf('\n', prevLineEnd - 1) + 1;
        const prevLine      = val.slice(prevLineStart, prevLineEnd);
        if (/^!\[[^\]]*\]\([^)]+\)$/.test(prevLine)) {
          e.preventDefault();
          const delStart     = prevLineStart > 0 ? prevLineStart - 1 : 0;
          const charsDeleted = prevLineEnd - delStart;
          const newText      = val.slice(0, delStart) + val.slice(prevLineEnd);
          const newPos       = pos - charsDeleted;
          setText(newText); setIsDirty(true);
          requestAnimationFrame(() => { ta.selectionStart = ta.selectionEnd = newPos; ta.focus(); pushHistory(newText, newPos); });
          return;
        }
      }

      const nestMatch = currentLine.match(/^((?:    )+)([-*+]|\d+\.) (.*)/);
      if (nestMatch && pos > lineStart) {
        const isEmptyItem    = nestMatch[3].trim() === '';
        const cursorInIndent = pos <= lineStart + nestMatch[1].length;
        if (isEmptyItem || cursorInIndent) {
          e.preventDefault();
          const newLine    = currentLine.slice(4);
          const lineEndIdx = lineEnd === -1 ? val.length : lineEnd;
          const newText    = val.slice(0, lineStart) + newLine + val.slice(lineEndIdx);
          const newPos     = isEmptyItem ? lineStart + newLine.length : Math.max(lineStart, pos - 4);
          setText(newText); setIsDirty(true);
          requestAnimationFrame(() => { ta.selectionStart = ta.selectionEnd = newPos; ta.focus(); pushHistory(newText, newPos); });
          return;
        }
      }
    }

    if (slashMenu !== null) {
      const visible = filteredCommands(slashMenu.filter, slashMenu.atLineStart);
      if (visible.length === 0) {
        if (e.key === 'Escape') { e.preventDefault(); setSlashMenu(null); }
        return;
      }
      if (e.key === 'ArrowDown') { e.preventDefault(); setSlashMenu(prev => ({ ...prev, activeIdx: (prev.activeIdx + 1) % visible.length })); return; }
      if (e.key === 'ArrowUp')   { e.preventDefault(); setSlashMenu(prev => ({ ...prev, activeIdx: (prev.activeIdx - 1 + visible.length) % visible.length })); return; }
      if (e.key === 'Enter' || e.key === 'Tab') { e.preventDefault(); applySlashCommand(visible[slashMenu.activeIdx]); return; }
      if (e.key === 'Escape') { e.preventDefault(); setSlashMenu(null); return; }
    }

    if (headingMenu !== null) {
      const headings = extractHeadings(text);
      if (e.key === 'ArrowDown') { e.preventDefault(); setHeadingMenu(prev => ({ ...prev, activeIdx: (prev.activeIdx + 1) % headings.length })); return; }
      if (e.key === 'ArrowUp')   { e.preventDefault(); setHeadingMenu(prev => ({ ...prev, activeIdx: (prev.activeIdx - 1 + headings.length) % headings.length })); return; }
      if (e.key === 'Enter' || e.key === 'Tab') { e.preventDefault(); applyHeadingMenu(headings[headingMenu.activeIdx]); return; }
      if (e.key === 'Escape') { e.preventDefault(); setHeadingMenu(null); return; }
    }

    // Tab / Shift-Tab to indent or unindent list items
    if (e.key === 'Tab' && slashMenu === null && ta) {
      const pos      = ta.selectionStart;
      const val      = ta.value;
      const lineStart  = val.lastIndexOf('\n', pos - 1) + 1;
      const lineEnd    = val.indexOf('\n', pos);
      const fullLine   = val.slice(lineStart, lineEnd === -1 ? val.length : lineEnd);
      if (/^(    )*([-*+]|\d+\.) /.test(fullLine)) {
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

    // Arrow up/down navigation
    if ((e.key === 'ArrowUp' || e.key === 'ArrowDown') && slashMenu === null && ta) {
      e.preventDefault();
      const pos = ta.selectionStart;
      const val = ta.value;
      let newPos;
      if (e.key === 'ArrowUp') {
        const lineStart = val.lastIndexOf('\n', pos - 1) + 1;
        newPos = lineStart > 0 ? lineStart - 1 : 0;
      } else {
        const lineEnd = val.indexOf('\n', pos);
        if (lineEnd === -1) { newPos = val.length; }
        else {
          const nextLineEnd = val.indexOf('\n', lineEnd + 1);
          newPos = nextLineEnd === -1 ? val.length : nextLineEnd;
        }
      }
      ta.selectionStart = ta.selectionEnd = newPos;
      return;
    }

    // List continuation on Enter
    if (e.key === 'Enter' && slashMenu === null && ta) {
      const pos       = ta.selectionStart;
      const val       = ta.value;
      const lineStart = val.lastIndexOf('\n', pos - 1) + 1;
      const lineEnd   = val.indexOf('\n', pos);
      const fullLine  = val.slice(lineStart, lineEnd === -1 ? val.length : lineEnd);
      const ulMatch   = fullLine.match(/^((?:    )*)([-*+]) (.*)$/);
      const olMatch   = !ulMatch && fullLine.match(/^((?:    )*)(\d+)\. (.*)$/);

      if (ulMatch || olMatch) {
        const indent  = ulMatch ? ulMatch[1] : olMatch[1];
        const isEmpty = ulMatch ? ulMatch[3].trim() === '' : olMatch[3].trim() === '';
        if (isEmpty) {
          e.preventDefault();
          if (indent.length >= 4) {
            const newIndent  = indent.slice(4);
            const marker     = ulMatch ? `${ulMatch[2]} ` : `${olMatch[2]}. `;
            const lineEndIdx = lineEnd === -1 ? val.length : lineEnd;
            const newText    = val.slice(0, lineStart) + newIndent + marker + val.slice(lineEndIdx);
            const newPos     = lineStart + newIndent.length + marker.length;
            setText(newText); setIsDirty(true);
            requestAnimationFrame(() => { ta.selectionStart = ta.selectionEnd = newPos; pushHistory(newText, newPos); });
          } else {
            const newText = val.slice(0, lineStart) + '\n' + val.slice(lineEnd === -1 ? val.length : lineEnd);
            const newPos  = lineStart + 1;
            setText(newText); setIsDirty(true);
            requestAnimationFrame(() => { ta.selectionStart = ta.selectionEnd = newPos; pushHistory(newText, newPos); });
          }
        } else {
          e.preventDefault();
          const marker  = ulMatch ? `${ulMatch[2]} ` : `${parseInt(olMatch[2]) + 1}. `;
          const insert  = '\n' + indent + marker;
          const newText = val.slice(0, pos) + insert + val.slice(pos);
          const newPos  = pos + insert.length;
          setText(newText); setIsDirty(true);
          requestAnimationFrame(() => { ta.selectionStart = ta.selectionEnd = newPos; pushHistory(newText, newPos); });
        }
        return;
      }
    }

    // Undo / Redo
    if ((e.metaKey || e.ctrlKey) && e.key === 'z') {
      e.preventDefault();
      const isRedo = e.shiftKey;
      const target = historyIdxRef.current + (isRedo ? 1 : -1);
      if (target < 0 || target >= historyRef.current.length) return;
      historyIdxRef.current = target;
      const { text: t, cursorPos: pos } = historyRef.current[target];
      setText(t); setIsDirty(true);
      requestAnimationFrame(() => { if (ta) { ta.selectionStart = ta.selectionEnd = pos; } });
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
      let mdToSave = text;
      if (editMode === 'html') {
        mdToSave = htmlToMarkdown();
        setText(mdToSave);
      }
      const blob = new Blob([mdToSave], { type: 'text/markdown' });
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

  const scrollToHeading = (slug) => {
    setShowToc(false);
    const container = editMode === 'html' ? contentEditableRef.current : previewRef.current;
    container?.querySelector(`#${CSS.escape(slug)}`)?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  };

  const applyHeadingMenu = (heading) => {
    if (!heading || !mdTextareaRef.current) return;
    const ta        = mdTextareaRef.current;
    const insertPos = headingMenu.insertPos;
    const link      = `[go to section](#${heading.slug})`;
    const newText   = text.slice(0, insertPos) + link + text.slice(insertPos);
    const newCursor = insertPos + link.length;
    setText(newText); setIsDirty(true);
    setHeadingMenu(null);
    requestAnimationFrame(() => { ta.selectionStart = ta.selectionEnd = newCursor; ta.focus(); pushHistory(newText, newCursor); });
  };

  const applyHeadingMenuHtml = (heading) => {
    if (!heading || !contentEditableRef.current) return;
    const link = document.createElement('a');
    link.href = `#${heading.slug}`;
    link.textContent = heading.title || 'go to section';
    link.style.cssText = 'color:#818cf8;text-decoration:underline;cursor:pointer;';

    const sel = window.getSelection();
    if (sel && sel.rangeCount > 0) {
      const range = sel.getRangeAt(0);
      range.deleteContents();
      range.insertNode(link);
      range.setStartAfter(link);
      range.collapse(true);
      sel.removeAllRanges();
      sel.addRange(range);
    } else {
      contentEditableRef.current.appendChild(link);
    }
    htmlPristine.current = false;
    setIsDirty(true);
    setHeadingMenu(null);
    contentEditableRef.current.focus();
  };

  const handleExport = async () => {
    const zip    = new JSZip();
    const assets = await (onGetImages ? onGetImages(video.id) : Promise.resolve([]));

    let exportText = text;
    if (editMode === 'html') {
      try { exportText = htmlToMarkdown(); } catch (_) {}
    }
    assets.forEach(a => { exportText = exportText.replaceAll(`](${a.name})`, `](images/${a.name})`); });

    const noteName  = displayName.endsWith('.md') ? displayName : displayName + '.md';
    zip.file(noteName, exportText);
    if (assets.length > 0) {
      const imgFolder = zip.folder('images');
      assets.forEach(a => imgFolder.file(a.name, a.data));
    }

    const blob = await zip.generateAsync({ type: 'blob' });
    const url  = URL.createObjectURL(blob);
    const a    = document.createElement('a');
    a.href = url; a.download = noteName.replace(/\.md$/, '.zip'); a.click();
    URL.revokeObjectURL(url);
  };

  const insertImage = async (file) => {
    if (!file || !onAddImage) return;
    try {
      await onAddImage(video.id, file.name, file, file.type);
      const url  = URL.createObjectURL(file);
      const size = pendingImageSize.current;
      pendingImageSize.current = undefined;

      if (editMode === 'html' && contentEditableRef.current) {
        const img = document.createElement('img');
        img.setAttribute('src', url);
        img.setAttribute('alt', file.name);
        img.dataset.imgFile = file.name;
        if (size != null) {
          img.style.width = `${size}px`;
          img.style.maxWidth = 'none';
        } else {
          img.style.maxWidth = '100%';
        }
        img.style.borderRadius = '6px';

        const wrapper = document.createElement('div');
        wrapper.style.margin = '0';
        wrapper.appendChild(img);

        const sel = window.getSelection();
        const lineDiv = sel?.focusNode ? getLineDiv(sel.focusNode) : null;
        if (lineDiv) {
          lineDiv.after(wrapper);
        } else {
          contentEditableRef.current.appendChild(wrapper);
        }
        htmlPristine.current = false;
        setIsDirty(true);
      } else {
        const altText = size != null ? `${file.name}|${size}` : file.name;
        const newText = textRef.current + `\n![${altText}](${file.name})`;
        setText(newText); setIsDirty(true);
        pushHistory(newText, newText.length);
      }
      setAssetUrls(prev => ({ ...prev, [file.name]: url }));
    } catch (err) {
      console.error('Failed to insert image:', err);
    }
  };

  const commitNameEdit = (val) => {
    const trimmed = (val || '').trim();
    setIsEditingName(false);
    if (!trimmed || trimmed === displayName) return;
    const nextName = trimmed.endsWith('.md') ? trimmed : trimmed + '.md';
    setDisplayName(nextName);
    if (onRename) onRename(nextName).catch(err => console.error('Rename failed:', err));
  };

  const nameDisplay = isEditingName && !readOnly && onRename
    ? React.createElement('input', {
        autoFocus: true,
        defaultValue: displayName.replace(/\.md$/, ''),
        className: 'text-sm text-gray-200 font-mono bg-gray-700 border border-indigo-500 rounded px-2 py-0.5 outline-none focus:ring-1 focus:ring-indigo-400 max-w-xs',
        onBlur: (e) => commitNameEdit(e.target.value),
        onKeyDown: (e) => {
          if (e.key === 'Enter') { e.preventDefault(); commitNameEdit(e.target.value); }
          if (e.key === 'Escape') { e.preventDefault(); setIsEditingName(false); }
        },
        onClick: (e) => e.stopPropagation(),
      })
    : React.createElement(
        'span',
        {
          className: `text-sm text-gray-400 font-mono truncate max-w-xs ${!readOnly && onRename ? 'cursor-pointer hover:text-gray-200 transition-colors' : ''}`,
          title: readOnly || !onRename ? displayName : 'Click to rename',
          onClick: !readOnly && onRename ? () => setIsEditingName(true) : undefined,
        },
        displayName
      );

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
        nameDisplay,
        React.createElement('span', { className: 'text-xs text-amber-400 font-medium' }, 'Read-only')
      ),
      React.createElement('div', {
        className: 'bg-gray-900 text-gray-100 text-sm leading-relaxed p-6 overflow-auto flex-1',
        dangerouslySetInnerHTML: { __html: text ? renderMarkdown(text, assetUrls) : '<p class="text-gray-500">Empty note</p>' },
      })
    );
  }

  // Slash menu — works in both HTML and Markdown modes
  const visibleCmds = slashMenu
    ? filteredCommands(slashMenu.filter, slashMenu.atLineStart)
    : [];
  const dropdownCoords = (() => {
    if (!(slashMenu || headingMenu)) return { top: 0, left: 0 };
    if (editMode === 'html') {
      const sel = window.getSelection();
      if (sel && sel.rangeCount > 0) {
        const rect = sel.getRangeAt(0).getBoundingClientRect();
        if (rect.top > 0 || rect.left > 0)
          return { top: rect.bottom + 4, left: Math.max(8, Math.min(rect.left, window.innerWidth - 240)) };
      }
      if (contentEditableRef.current) {
        const r = contentEditableRef.current.getBoundingClientRect();
        return { top: r.top + 28, left: Math.max(8, Math.min(r.left + 16, window.innerWidth - 240)) };
      }
    }
    if (!mdTextareaRef.current) return { top: 0, left: 0 };
    const r = mdTextareaRef.current.getBoundingClientRect();
    return { top: r.top + 28, left: Math.max(8, Math.min(r.left + 16, window.innerWidth - 240)) };
  })();

  return React.createElement(
    'div',
    { className: 'w-full h-full flex flex-col bg-gray-800 rounded-lg shadow-lg overflow-hidden' },

    // ── Toolbar ─────────────────────────────────────────────────────
    React.createElement(
      'div',
      { className: 'flex items-center justify-between px-4 py-2 border-b border-gray-700 bg-gray-800/80 shrink-0' },

      nameDisplay,

      React.createElement(
        'div',
        { className: 'flex items-center gap-3' },

        saveMsg === 'saved' && React.createElement('span', { className: 'text-xs text-emerald-400 font-medium' }, 'Saved'),
        saveMsg === 'error' && React.createElement('span', { className: 'text-xs text-red-400 font-medium' }, 'Save failed'),
        isDirty && !saveMsg && React.createElement('span', { className: 'text-xs text-gray-500' }, 'Unsaved changes'),


        // Mode toggle
        React.createElement(
          'button',
          {
            onClick: editMode === 'html' ? switchToMarkdown : switchToHtml,
            disabled: isSaving,
            title: editMode === 'html' ? 'Switch to Markdown edit mode' : 'Switch to HTML edit mode',
            className: `flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-sm font-medium transition-colors disabled:opacity-40 disabled:cursor-not-allowed ${
              editMode === 'html'
                ? 'bg-violet-700 hover:bg-violet-600 text-white'
                : 'bg-gray-700 hover:bg-gray-600 text-gray-200'
            }`,
          },
          React.createElement('svg', { xmlns: 'http://www.w3.org/2000/svg', className: 'h-3.5 w-3.5', fill: 'none', viewBox: '0 0 24 24', stroke: 'currentColor' },
            React.createElement('path', { strokeLinecap: 'round', strokeLinejoin: 'round', strokeWidth: 2, d: 'M10 20l4-16m4 4l4 4-4 4M6 16l-4-4 4-4' })
          ),
          editMode === 'html' ? 'MD Edit' : 'HTML Edit'
        ),

        // Export
        React.createElement(
          'button',
          {
            onClick: handleExport,
            title: 'Export as ZIP (note + images)',
            className: 'flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-sm font-medium bg-gray-700 hover:bg-gray-600 text-gray-200 transition-colors',
          },
          React.createElement('svg', { xmlns: 'http://www.w3.org/2000/svg', className: 'h-3.5 w-3.5', fill: 'none', viewBox: '0 0 24 24', stroke: 'currentColor' },
            React.createElement('path', { strokeLinecap: 'round', strokeLinejoin: 'round', strokeWidth: 2, d: 'M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4' })
          ),
          'Export'
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
            : React.createElement('svg', { xmlns: 'http://www.w3.org/2000/svg', className: 'h-3.5 w-3.5', fill: 'none', viewBox: '0 0 24 24', stroke: 'currentColor' },
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

    // ── Content area ─────────────────────────────────────────────────
    React.createElement(
      'div',
      { className: 'flex flex-grow overflow-hidden' },

      // ── HTML Edit mode: single contenteditable div ──
      editMode === 'html' && React.createElement(
        'div',
        {
          ref: contentEditableRef,
          contentEditable: true,
          suppressContentEditableWarning: true,
          className: 'bg-gray-900 text-gray-100 text-sm leading-relaxed p-6 overflow-auto flex-1 outline-none',
          style: { minWidth: 0, wordBreak: 'break-word' },
          onInput: handleHtmlInput,
          onKeyDown: handleHtmlKeyDown,
          onClick: (e) => {
            const anchor = e.target.closest('a[href^="#"]');
            if (anchor) {
              e.preventDefault();
              const slug = anchor.getAttribute('href').slice(1);
              contentEditableRef.current?.querySelector(`#${CSS.escape(slug)}`)?.scrollIntoView({ behavior: 'smooth', block: 'start' });
            }
          },
          onBlur: () => setTimeout(() => { setSlashMenu(null); setHeadingMenu(null); htmlSlashRef.current = null; }, 150),
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
          onMouseMove: (e) => {
            if (resizingImg) return;
            if (hoveredImgClearTimer.current) { clearTimeout(hoveredImgClearTimer.current); hoveredImgClearTimer.current = null; }
            const img = e.target.closest('img[data-img-file]');
            if (img) {
              const filename = img.dataset.imgFile;
              const rect = img.getBoundingClientRect();
              setHoveredImg(prev => prev && prev.filename === filename && Math.abs(prev.rect.top - rect.top) < 1 ? prev : { filename, rect });
            } else {
              setHoveredImg(null);
            }
          },
          onMouseLeave: () => {
            if (resizingImg) return;
            hoveredImgClearTimer.current = setTimeout(() => setHoveredImg(null), 120);
          },
        }
      ),

      // ── Markdown Edit mode: textarea (left) + preview (right) ──
      editMode === 'markdown' && React.createElement(
        React.Fragment,
        null,

        React.createElement('textarea', {
          ref: mdTextareaRef,
          value: text,
          onChange: handleChange,
          onKeyDown: handleKeyDown,
          onBlur: () => setTimeout(() => { setSlashMenu(null); setHeadingMenu(null); setShowToc(false); }, 150),
          onPaste: (e) => {
            const item = Array.from(e.clipboardData.items).find(i => i.type.startsWith('image/'));
            if (item) { e.preventDefault(); insertImage(item.getAsFile()); }
          },
          spellCheck: false,
          placeholder: 'Type markdown here… or press / to insert',
          className: 'bg-gray-950 text-gray-300 text-sm font-mono leading-relaxed p-4 resize-none focus:outline-none border-r border-gray-700 overflow-auto',
          style: { width: '40%', flexShrink: 0, caretColor: '#a5b4fc' },
        }),

        React.createElement('div', {
          ref: previewRef,
          className: 'bg-gray-900 text-gray-100 text-sm leading-relaxed p-6 overflow-auto flex-1',
          style: { minWidth: 0 },
          onClick: (e) => {
            const anchor = e.target.closest('a[href^="#"]');
            if (anchor) {
              e.preventDefault();
              const slug = anchor.getAttribute('href').slice(1);
              previewRef.current?.querySelector(`#${CSS.escape(slug)}`)?.scrollIntoView({ behavior: 'smooth', block: 'start' });
            }
          },
          onMouseMove: (e) => {
            if (resizingImg) return;
            if (hoveredImgClearTimer.current) { clearTimeout(hoveredImgClearTimer.current); hoveredImgClearTimer.current = null; }
            const img = e.target.closest('img[data-img-file]');
            if (img) {
              const filename = img.dataset.imgFile;
              const rect = img.getBoundingClientRect();
              setHoveredImg(prev => prev && prev.filename === filename && Math.abs(prev.rect.top - rect.top) < 1 ? prev : { filename, rect });
            } else {
              setHoveredImg(null);
            }
          },
          onMouseLeave: () => {
            if (resizingImg) return;
            hoveredImgClearTimer.current = setTimeout(() => setHoveredImg(null), 120);
          },
          dangerouslySetInnerHTML: {
            __html: text
              ? renderMarkdown(text, assetUrls)
              : '<p style="color:#4b5563;font-style:italic">Start typing markdown on the left…</p>',
          },
        })
      ),


      // Heading picker dropdown (both modes)
      headingMenu !== null && (() => {
        const headings = editMode === 'html'
          ? extractHeadingsFromDom(contentEditableRef.current)
          : extractHeadings(text);
        const applyFn = editMode === 'html' ? applyHeadingMenuHtml : applyHeadingMenu;
        return React.createElement(
          'div',
          {
            style: { position: 'fixed', top: dropdownCoords.top, left: dropdownCoords.left, zIndex: 9999 },
            className: 'bg-gray-800 border border-gray-600 rounded-xl shadow-2xl py-1 min-w-56 max-h-80 overflow-y-auto',
            onMouseDown: (e) => e.preventDefault(),
          },
          React.createElement('div', { className: 'px-3 py-1.5 text-xs text-gray-500 border-b border-gray-700' }, 'Insert link to section'),
          headings.map((h, i) =>
            React.createElement('button', {
              key: h.slug,
              onMouseDown: (e) => { e.preventDefault(); applyFn(h); },
              className: `w-full flex items-center px-3 py-2 text-sm transition-colors text-left ${i === headingMenu.activeIdx ? 'bg-indigo-600 text-white' : 'text-gray-200 hover:bg-gray-700'}`,
              style: { paddingLeft: `${(h.level - 1) * 16 + 12}px` },
            },
              React.createElement('span', { className: h.level === 1 ? 'font-bold' : h.level === 2 ? 'font-medium' : 'text-gray-400' }, h.title),
              React.createElement('span', { className: `text-xs font-mono ml-auto pl-4 ${i === headingMenu.activeIdx ? 'text-indigo-200' : 'text-gray-600'}` }, `#${h.slug}`)
            )
          )
        );
      })(),

      // Slash command dropdown (both modes)
      slashMenu && visibleCmds.length > 0 && React.createElement(
        'div',
        {
          style: { position: 'fixed', top: dropdownCoords.top, left: dropdownCoords.left, zIndex: 9999 },
          className: 'bg-gray-800 border border-gray-600 rounded-xl shadow-2xl py-1 min-w-52',
          onMouseDown: (e) => e.preventDefault(),
        },
        React.createElement('div', { className: 'px-3 py-1.5 text-xs text-gray-500 border-b border-gray-700' },
          slashMenu.filter ? `"${slashMenu.filter}"` : 'Type to filter…'
        ),
        visibleCmds.map((cmd, i) =>
          React.createElement('button', {
            key: cmd.id,
            onMouseDown: (e) => { e.preventDefault(); editMode === 'html' ? applyHtmlSlashCommand(cmd) : applySlashCommand(cmd); },
            className: `w-full flex items-center justify-between px-3 py-2 text-sm transition-colors text-left ${i === slashMenu.activeIdx ? 'bg-indigo-600 text-white' : 'text-gray-200 hover:bg-gray-700'}`,
          },
            React.createElement('span', { className: 'font-medium' }, cmd.label),
            React.createElement('span', { className: `text-xs font-mono ml-4 ${i === slashMenu.activeIdx ? 'text-indigo-200' : 'text-gray-500'}` }, cmd.hint)
          )
        )
      )
    ),

    // ── Image resize handle ─────────────────────
    (hoveredImg || resizingImg) && React.createElement(
      'div',
      {
        style: (() => {
          const activeFilename = resizingImg?.filename || hoveredImg?.filename;
          if (!activeFilename) return { display: 'none' };
          const container = editMode === 'html' ? contentEditableRef.current : previewRef.current;
          const liveImg = container?.querySelector(`img[data-img-file="${CSS.escape(activeFilename)}"]`);
          const rect    = liveImg?.getBoundingClientRect() || hoveredImg?.rect;
          if (!rect) return { display: 'none' };
          return { position: 'fixed', top: rect.top + rect.height / 2 - 16, left: rect.right - 8, zIndex: 120, width: 16, height: 32, pointerEvents: 'auto', cursor: 'ew-resize' };
        })(),
        className: 'rounded-md bg-indigo-500/90 border border-indigo-200 shadow-lg hover:bg-indigo-400',
        title: resizingImg ? `Width: ${resizingImg.width}px` : 'Drag to resize image',
        onMouseEnter: () => { if (hoveredImgClearTimer.current) { clearTimeout(hoveredImgClearTimer.current); hoveredImgClearTimer.current = null; } },
        onMouseLeave: () => { if (resizingImg) return; hoveredImgClearTimer.current = setTimeout(() => setHoveredImg(null), 120); },
        onMouseDown: (e) => {
          e.preventDefault(); e.stopPropagation();
          if (!hoveredImg) return;
          setResizingImg({ filename: hoveredImg.filename, startX: e.clientX, startWidth: Math.round(hoveredImg.rect.width), width: Math.round(hoveredImg.rect.width) });
        },
      }
    ),

    // ── Image hover edit button ─────────────────
    hoveredImg && React.createElement(
      'button',
      {
        style: { position: 'fixed', top: hoveredImg.rect.top + 6, left: hoveredImg.rect.right - 80, zIndex: 100, pointerEvents: 'auto' },
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

    // ── ImageEditor modal ────────────────────────────────────────────
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
          if (editMode === 'html' && contentEditableRef.current) {
            const img = contentEditableRef.current.querySelector(`img[data-img-file="${CSS.escape(fname)}"]`);
            if (img) { img.src = newUrl; htmlPristine.current = false; setIsDirty(true); }
          }
        } catch (err) { console.error('ImageEditor save failed:', err); }
        setEditingImg(null);
      },
      onClose: () => setEditingImg(null),
    })
  );
};

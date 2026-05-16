
import React, { useMemo, useState, useEffect } from 'react';
import { getFileExtension } from '../utils/fileUtils.js';
import { FoliateViewer } from './FoliateViewer.js';
import { PdfViewer } from './PdfViewer.js';
import { TxtViewer } from './TxtViewer.js';
import { MarkdownEditor } from './MarkdownEditor.js';
import { YoutubeViewer } from './YoutubeViewer.js';
import { UnsupportedViewer } from './UnsupportedViewer.js';

const MIME_TO_EXT = {
  'application/epub+zip': 'epub',
  'application/x-mobipocket-ebook': 'mobi',
  'application/vnd.amazon.ebook': 'azw',
  'application/vnd.amazon.mobi8-ebook': 'azw3',
  'application/pdf': 'pdf',
  'text/plain': 'txt',
  'text/markdown': 'md',
  'application/x-youtube': 'youtube',
};

export const Reader = ({
  video,
  onUpdateItem,
  onSaveReadingPosition,
  getPdfAnnotationSidecar,
  putPdfAnnotationsForItem,
  onAddImage,
  onGetImages,
  readOnly,
  onSelectChannel,
  onAddChannel,
  onRename,
}) => {
  const fileExtension = useMemo(() => {
    const ext = getFileExtension(video.name);
    return ext || MIME_TO_EXT[video.type] || '';
  }, [video.name, video.type]);

  const [pdfAnnotations, setPdfAnnotations] = useState([]);
  const [pdfAnnotationsReady, setPdfAnnotationsReady] = useState(false);

  useEffect(() => {
    if (fileExtension !== 'pdf' || !getPdfAnnotationSidecar || !putPdfAnnotationsForItem || !onSaveReadingPosition) {
      setPdfAnnotations([]);
      setPdfAnnotationsReady(true);
      return undefined;
    }
    let cancelled = false;
    setPdfAnnotationsReady(false);
    (async () => {
      try {
        const sc = await getPdfAnnotationSidecar(video.driveId, video.driveIdbStore);
        let anns = Array.isArray(sc?.annotations) ? sc.annotations : [];
        const legacy = video.readingPosition?.pdfAnnotations;
        if (Array.isArray(legacy) && legacy.length > 0 && anns.length === 0) {
          anns = legacy;
          await putPdfAnnotationsForItem(
            video.driveId,
            video.driveIdbStore,
            anns,
            String(video.driveId || '').trim()
          );
          const rp = video.readingPosition || {};
          const { pdfAnnotations: _drop, ...rest } = rp;
          await onSaveReadingPosition(video.driveId, video.driveIdbStore, {
            ...rest,
            kind: 'pdf',
          });
        }
        if (!cancelled) {
          setPdfAnnotations(anns);
          setPdfAnnotationsReady(true);
        }
      } catch (e) {
        console.warn('[Reader] PDF annotation load failed:', e);
        if (!cancelled) {
          setPdfAnnotations([]);
          setPdfAnnotationsReady(true);
        }
      }
    })();
    return () => { cancelled = true; };
  }, [
    fileExtension,
    video.driveId,
    video.driveIdbStore,
    video.driveId,
    getPdfAnnotationSidecar,
    putPdfAnnotationsForItem,
    onSaveReadingPosition,
  ]);

  const renderContent = () => {
    switch (fileExtension) {
      case 'epub':
      case 'mobi':
      case 'azw':
      case 'azw3':
        return React.createElement(FoliateViewer, {
          data: video.data,
          name: video.name,
          type: video.type,
          itemDriveId: video.driveId,
          initialReadingPosition: video.readingPosition,
          onSaveReadingPosition,
          storeName: video.driveIdbStore,
        });
      case 'pdf':
        if (!pdfAnnotationsReady) {
          return React.createElement(
            'div',
            { className: 'flex flex-1 items-center justify-center p-8 text-gray-400' },
            'Loading annotations…'
          );
        }
        return React.createElement(PdfViewer, {
          data: video.data,
          itemDriveId: video.driveId,
          initialReadingPosition: video.readingPosition,
          initialAnnotations: pdfAnnotations,
          pdfDriveId: String(video.driveId || '').trim(),
          exportBaseName: String(video.name || 'document').replace(/\.pdf$/i, '') || 'document',
          onUpdateItem,
          onSaveReadingPosition,
          onSavePdfAnnotations: putPdfAnnotationsForItem,
          storeName: video.driveIdbStore,
          readOnly,
          topOffset: 70,
        });
      case 'txt':
        return React.createElement(TxtViewer, {
          data: video.data,
          itemDriveId: video.driveId,
          initialReadingPosition: video.readingPosition,
          onSaveReadingPosition,
          storeName: video.driveIdbStore,
        });
      case 'md':
        return React.createElement(MarkdownEditor, {
          video, onUpdateItem, onAddImage, onGetImages, readOnly,
          onRename: onRename && !readOnly ? (newName) => onRename(video.driveId, video.driveIdbStore, newName) : null,
        });
      case 'youtube':
        return React.createElement(YoutubeViewer, { video, onSelectChannel, onAddChannel });
      default:
        return React.createElement(UnsupportedViewer, { filename: video.name });
    }
  };

  return React.createElement(
    "div",
    { className: "w-full flex-1 min-h-0 flex flex-col items-stretch" },
    renderContent()
  );
};

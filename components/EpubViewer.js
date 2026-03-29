
import React, { useEffect, useRef, useState } from 'react';

export const EpubViewer = ({ data }) => {
  const viewerRef = useRef(null);
  const renditionRef = useRef(null);
  const bookRef = useRef(null);
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    if (data && viewerRef.current) {
      setIsLoading(true);
      const arrayBufferPromise = data.arrayBuffer();

      arrayBufferPromise.then(arrayBuffer => {
        const book = ePub(arrayBuffer);
        bookRef.current = book;
        const rendition = book.renderTo(viewerRef.current, {
          width: '100%',
          height: '100%',
          spread: 'auto',
          flow: "paginated",
          allowScriptedContent: true, // required for EPUB.js iframe navigation; sandbox warning is expected
        });
        renditionRef.current = rendition;
        
        rendition.display().then(() => {
          setIsLoading(false);
        });

      }).catch(err => {
        console.error("Error loading epub: ", err);
        setIsLoading(false);
      });

      return () => {
        if(bookRef.current) {
            bookRef.current.destroy();
        }
      };
    }
  }, [data]);

  const goToNextPage = () => {
    if (renditionRef.current) {
      renditionRef.current.next();
    }
  };

  const goToPrevPage = () => {
    if (renditionRef.current) {
      renditionRef.current.prev();
    }
  };

  return React.createElement(
    "div",
    { className: "w-full h-full flex flex-col relative bg-gray-900" },
    isLoading && React.createElement(
      "div",
      { className: "absolute inset-0 flex items-center justify-center bg-gray-900 z-20" },
      React.createElement(
        "p",
        null,
        "Loading E-book..."
      )
    ),
    React.createElement("div", { ref: viewerRef, className: "flex-grow w-full h-full bg-white text-black overflow-hidden", style: { height: 'calc(100% - 4rem)' } }),
    React.createElement(
      "div",
      { className: "flex justify-center items-center h-16 bg-gray-800 gap-4" },
      React.createElement(
        "button",
        { onClick: goToPrevPage, className: "px-4 py-2 bg-indigo-600 text-white rounded hover:bg-indigo-700 transition-colors" },
        "Previous"
      ),
      React.createElement(
        "button",
        { onClick: goToNextPage, className: "px-4 py-2 bg-indigo-600 text-white rounded hover:bg-indigo-700 transition-colors" },
        "Next"
      )
    )
  );
};
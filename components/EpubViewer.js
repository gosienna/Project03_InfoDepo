
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

  const viewerShellStyle = { height: "calc(100% - 4rem)" };

  const edgeNavClass =
    "pointer-events-auto z-10 h-full min-w-[44px] w-[28%] max-w-[200px] shrink-0 border-0 p-0 cursor-pointer select-none touch-manipulation [-webkit-tap-highlight-color:transparent] bg-transparent active:bg-black/5 sm:hover:bg-black/[0.03]";

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
    React.createElement(
      "div",
      { className: "relative flex-grow w-full overflow-hidden", style: viewerShellStyle },
      React.createElement("div", {
        ref: viewerRef,
        className: "absolute inset-0 bg-white text-black overflow-hidden",
      }),
      !isLoading &&
        React.createElement(
          "div",
          {
            className:
              "absolute inset-0 z-10 flex pointer-events-none",
            "aria-hidden": true,
          },
          React.createElement("button", {
            type: "button",
            onClick: goToPrevPage,
            className: edgeNavClass,
            "aria-label": "Previous page",
            title: "Previous page",
          }),
          React.createElement("div", { className: "flex-1 min-w-0 pointer-events-none" }),
          React.createElement("button", {
            type: "button",
            onClick: goToNextPage,
            className: edgeNavClass,
            "aria-label": "Next page",
            title: "Next page",
          })
        )
    ),
    React.createElement(
      "div",
      { className: "flex justify-center items-center h-16 bg-gray-800 gap-4 shrink-0" },
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
import React, { useState, useEffect } from 'react';
import { HomePage } from './pages/HomePage';
import { SheetViewPage } from './pages/SheetViewPage';
import { SheetBinaryCodec } from './utils/SheetBinaryCodec';
import { dbClient } from './db/dbClient';

export const App: React.FC = () => {
  const [currentSheetId, setCurrentSheetId] = useState<number | null>(() => {
    const hash = window.location.hash;
    const match = hash.match(/^#\/sheet\/(\d+)$/);
    return match ? Number(match[1]) : null;
  });

  // Keep hash and currentSheetId in sync so browser Back / Forward works
  useEffect(() => {
    const handleHashChange = () => {
      const hash = window.location.hash;
      const match = hash.match(/^#\/sheet\/(\d+)$/);
      setCurrentSheetId(match ? Number(match[1]) : null);
    };

    window.addEventListener('hashchange', handleHashChange);
    return () => window.removeEventListener('hashchange', handleHashChange);
  }, []);

  const handleOpenSheet = (id: number) => {
    window.location.hash = `#/sheet/${id}`;
    setCurrentSheetId(id);
  };

  const handleBackHome = () => {
    window.location.hash = '#/';
    setCurrentSheetId(null);
  };

  // Drag and Drop .bsplit & PWA File Handler (launchQueue) support
  useEffect(() => {
    // Chromium PWA File Handling API (opens .bsplit when double-clicked on desktop)
    if ('launchQueue' in window && typeof (window as unknown as { launchQueue: { setConsumer: (cb: (params: { files: FileSystemFileHandle[] }) => void) => void } }).launchQueue?.setConsumer === 'function') {
      (window as unknown as { launchQueue: { setConsumer: (cb: (params: { files: FileSystemFileHandle[] }) => void) => void } }).launchQueue.setConsumer(async (launchParams) => {
        if (!launchParams.files || launchParams.files.length === 0) return;
        try {
          const fileHandle = launchParams.files[0];
          const file = await fileHandle.getFile();
          if (file && (file.name.endsWith('.bsplit') || file.type === 'application/octet-stream')) {
            const buffer = await file.arrayBuffer();
            const decoded = await SheetBinaryCodec.decode(new Uint8Array(buffer));
            const importedId = await dbClient.importSheet(decoded);
            handleOpenSheet(importedId);
          }
        } catch (err) {
          console.error('[LaunchQueue] Import failed:', err);
        }
      });
    }

    const handleDragOver = (e: DragEvent) => {
      e.preventDefault();
    };

    const handleDrop = async (e: DragEvent) => {
      e.preventDefault();
      const file = e.dataTransfer?.files?.[0];
      if (file && (file.name.endsWith('.bsplit') || file.type === 'application/octet-stream')) {
        try {
          const buffer = await file.arrayBuffer();
          const decoded = await SheetBinaryCodec.decode(new Uint8Array(buffer));
          const importedId = await dbClient.importSheet(decoded);
          handleOpenSheet(importedId);
        } catch (err) {
          alert(`Import failed: ${(err as Error).message || 'Invalid .bsplit file'}`);
        }
      }
    };

    window.addEventListener('dragover', handleDragOver);
    window.addEventListener('drop', handleDrop);
    return () => {
      window.removeEventListener('dragover', handleDragOver);
      window.removeEventListener('drop', handleDrop);
    };
  }, []);

  // System Dark Mode Follower
  useEffect(() => {
    const matchMedia = window.matchMedia('(prefers-color-scheme: dark)');
    const updateTheme = (e: MediaQueryListEvent | MediaQueryList) => {
      if (e.matches) {
        document.documentElement.classList.add('dark');
      } else {
        document.documentElement.classList.remove('dark');
      }
    };

    updateTheme(matchMedia);
    matchMedia.addEventListener('change', updateTheme);
    return () => matchMedia.removeEventListener('change', updateTheme);
  }, []);

  // Real-time visual viewport tracking for on-screen keyboard resizing
  useEffect(() => {
    const updateViewport = () => {
      const vv = window.visualViewport;
      const height = vv ? vv.height : window.innerHeight;
      document.documentElement.style.setProperty('--app-height', `${height}px`);
    };

    updateViewport();
    const vv = window.visualViewport;
    if (vv) {
      vv.addEventListener('resize', updateViewport);
      vv.addEventListener('scroll', updateViewport);
    }
    window.addEventListener('resize', updateViewport);

    return () => {
      if (vv) {
        vv.removeEventListener('resize', updateViewport);
        vv.removeEventListener('scroll', updateViewport);
      }
      window.removeEventListener('resize', updateViewport);
    };
  }, []);

  return (
    <div
      className="w-full flex flex-col overflow-hidden bg-gradient-to-b from-bgStart to-bgEnd text-textPrimary"
      style={{ height: 'var(--app-height, 100dvh)', maxHeight: 'var(--app-height, 100dvh)' }}
    >
      {currentSheetId ? (
        <SheetViewPage sheetId={currentSheetId} onBack={handleBackHome} />
      ) : (
        <HomePage onOpenSheet={handleOpenSheet} />
      )}
    </div>
  );
};

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

  // Drag and Drop .bsplit support onto the app
  useEffect(() => {
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

  return (
    <div className="w-full min-h-screen bg-gradient-to-b from-bgStart to-bgEnd text-textPrimary">
      {currentSheetId ? (
        <SheetViewPage sheetId={currentSheetId} onBack={handleBackHome} />
      ) : (
        <HomePage onOpenSheet={handleOpenSheet} />
      )}
    </div>
  );
};

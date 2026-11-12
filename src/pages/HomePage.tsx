import React, { useState, useMemo, useRef } from 'react';
import {
  ArrowUpDown,
  Search,
  X,
  Plus,
  MoreVertical,
  FileUp,
  FolderPlus,
} from 'lucide-react';
import { useSheets } from '../hooks/useSheets';
import { dbClient } from '../db/dbClient';
import { SheetBinaryCodec } from '../utils/SheetBinaryCodec';
import { formatCurrency, toExportFileName } from '../utils/formatters';
import type { SheetWithContributorsAndItems, SheetExportData } from '../types/models';
import { ITEM_TYPE } from '../types/models';

import { SortDialog, type SheetSortBy, type SortOrder } from '../components/SortDialog';
import { AddEditSheetDialog } from '../components/AddEditSheetDialog';
import { CloneOptionsDialog } from '../components/CloneOptionsDialog';
import { ExportSheetDialog } from '../components/ExportSheetDialog';
import { SheetDetailsDialog } from '../components/SheetDetailsDialog';
import { ConfirmDialog } from '../components/ConfirmDialog';

interface HomePageProps {
  onOpenSheet: (sheetId: number) => void;
}

export const HomePage: React.FC<HomePageProps> = ({ onOpenSheet }) => {
  const { sheets, loading } = useSheets();

  // Search & Sorting
  const [searchQuery, setSearchQuery] = useState('');
  const [sortBy, setSortBy] = useState<SheetSortBy>(() => {
    return (localStorage.getItem('BillSplitterPrefs_sortBy') as SheetSortBy) || 'dateModified';
  });
  const [sortOrder, setSortOrder] = useState<SortOrder>(() => {
    return (localStorage.getItem('BillSplitterPrefs_sortOrder') as SortOrder) || 'desc';
  });

  // Dialog states
  const [isSortOpen, setIsSortOpen] = useState(false);
  const [isAddSheetOpen, setIsAddSheetOpen] = useState(false);
  const [editingSheet, setEditingSheet] = useState<SheetWithContributorsAndItems | null>(null);
  const [cloningSheet, setCloningSheet] = useState<SheetWithContributorsAndItems | null>(null);
  const [carryoverBalances, setCarryoverBalances] = useState<
    Array<{ id: number; name: string; balance: number }> | null
  >(null);
  const [exportingSheet, setExportingSheet] = useState<SheetWithContributorsAndItems | null>(null);
  const [detailsSheet, setDetailsSheet] = useState<SheetWithContributorsAndItems | null>(null);
  const [deletingSheet, setDeletingSheet] = useState<SheetWithContributorsAndItems | null>(null);

  // FAB Popover Menu
  const [isFabMenuOpen, setIsFabMenuOpen] = useState(false);
  const [activeMenuSheetId, setActiveMenuSheetId] = useState<number | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // Filter & Sort
  const filteredAndSortedSheets = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    let list = sheets;

    if (q) {
      list = list.filter((item) => {
        return (
          item.sheet.sheetName.toLowerCase().includes(q) ||
          Boolean(item.sheet.notes?.toLowerCase().includes(q)) ||
          item.contributors.some((c) => c.contributorName.toLowerCase().includes(q))
        );
      });
    }

    return [...list].sort((a, b) => {
      let cmp = 0;
      switch (sortBy) {
        case 'name':
          cmp = a.sheet.sheetName.toLowerCase().localeCompare(b.sheet.sheetName.toLowerCase());
          break;
        case 'contributors':
          cmp = a.contributors.length - b.contributors.length;
          break;
        case 'dateCreated':
          cmp = a.sheet.dateCreated - b.sheet.dateCreated;
          break;
        case 'dateModified':
        default:
          cmp = a.sheet.dateModified - b.sheet.dateModified;
          break;
      }
      return sortOrder === 'asc' ? cmp : -cmp;
    });
  }, [sheets, searchQuery, sortBy, sortOrder]);

  const handleApplySort = (newSortBy: SheetSortBy, newSortOrder: SortOrder) => {
    setSortBy(newSortBy);
    setSortOrder(newSortOrder);
    localStorage.setItem('BillSplitterPrefs_sortBy', newSortBy);
    localStorage.setItem('BillSplitterPrefs_sortOrder', newSortOrder);
  };

  // Actions
  const handleSaveSheet = async (
    name: string,
    notes: string | null,
    contributorsToSave: Array<{ id: number; name: string; carryoverBalance: number }>
  ) => {
    if (editingSheet) {
      const map: Record<number, string> = {};
      contributorsToSave.forEach((c) => (map[c.id] = c.name));
      await dbClient.updateSheet(editingSheet.sheet.sheetID, name, notes, map);
      setEditingSheet(null);
    } else if (cloningSheet && carryoverBalances) {
      const newSheetId = await dbClient.addClonedSheetWithBalances(
        name,
        notes,
        contributorsToSave.map((c) => ({ name: c.name, balance: c.carryoverBalance })),
        cloningSheet.sheet.sheetName
      );
      setCloningSheet(null);
      setCarryoverBalances(null);
      onOpenSheet(newSheetId);
    } else {
      const newSheetId = await dbClient.addSheet(
        name,
        notes,
        contributorsToSave.map((c) => c.name)
      );
      setCloningSheet(null);
      onOpenSheet(newSheetId);
    }
  };

  const handleDeleteSheetConfirm = async () => {
    if (deletingSheet) {
      await dbClient.deleteSheet(deletingSheet.sheet.sheetID);
      setDeletingSheet(null);
    }
  };

  const handleCloneSelectOption = async (option: 'empty' | 'with-balances') => {
    if (!cloningSheet) return;
    if (option === 'empty') {
      setCarryoverBalances(null);
      setIsAddSheetOpen(true);
    } else {
      const nonZero = await dbClient.getNonZeroCarryoverBalances(cloningSheet.sheet.sheetID);
      if (nonZero.length === 0) {
        alert(`All members in "${cloningSheet.sheet.sheetName}" are already settled up.`);
      }
      setCarryoverBalances(nonZero);
      setIsAddSheetOpen(true);
    }
  };

  const handleExportSheet = async (makeReadOnly: boolean, action: 'share' | 'save') => {
    if (!exportingSheet) return;
    const baseExport = await dbClient.getExportData(exportingSheet.sheet.sheetID);
    if (!baseExport) return;

    const exportData: SheetExportData = {
      ...baseExport,
      sheet: {
        ...baseExport.sheet,
        isReadOnly: baseExport.sheet.isReadOnly || makeReadOnly,
      },
    };

    const encoded = await SheetBinaryCodec.encode(exportData);
    const fileName = `${toExportFileName(exportData.sheet.sheetName)}.bsplit`;

    if (action === 'share' && navigator.canShare && navigator.canShare({ files: [new File([encoded as any], fileName)] })) {
      try {
        const file = new File([encoded as any], fileName, { type: 'application/octet-stream' });
        await navigator.share({
          files: [file],
          title: fileName,
        });
        return;
      } catch (err) {
        if ((err as Error).name !== 'AbortError') {
          console.warn('[Share] Falling back to download:', err);
        } else {
          return;
        }
      }
    }

    // Download fallback
    const blob = new Blob([encoded as any], { type: 'application/octet-stream' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = fileName;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  };

  const handleImportFile = async (file: File) => {
    try {
      const buffer = await file.arrayBuffer();
      const decoded = await SheetBinaryCodec.decode(new Uint8Array(buffer));
      const importedId = await dbClient.importSheet(decoded);
      onOpenSheet(importedId);
    } catch (err) {
      alert(`Import failed: ${(err as Error).message || 'Invalid or corrupted .bsplit file'}`);
    }
  };

  return (
    <div
      className="min-h-screen max-w-xl mx-auto flex flex-col px-4 pt-4 pb-28 relative"
      onClick={() => {
        setIsFabMenuOpen(false);
        setActiveMenuSheetId(null);
      }}
    >
      {/* Hidden file input for .bsplit */}
      <input
        type="file"
        ref={fileInputRef}
        accept=".bsplit,application/octet-stream"
        className="hidden"
        onChange={(e) => {
          const file = e.target.files?.[0];
          if (file) handleImportFile(file);
          e.target.value = '';
        }}
      />

      {/* Top Header */}
      <header className="flex items-center justify-between pt-3 pb-4">
        <h1 className="text-3xl font-extrabold tracking-tight text-textPrimary">Bill Sheets</h1>
        {sheets.length >= 2 && (
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation();
              setIsSortOpen(true);
            }}
            className="p-2.5 rounded-full hover:bg-surfaceAlt text-iconTint transition-colors"
            title="Sort sheets"
          >
            <ArrowUpDown className="w-5 h-5 stroke-[2.2]" />
          </button>
        )}
      </header>

      {/* Search Bar */}
      <div className="relative mb-4">
        <div className="flex items-center h-12 px-4 rounded-2xl bg-surface border border-cardStroke shadow-sm">
          <Search className="w-4 h-4 text-textHint shrink-0" />
          <input
            type="text"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder="Search sheets or people..."
            className="w-full ml-3 bg-transparent text-sm text-textPrimary placeholder:text-textHint focus:outline-none"
          />
          {searchQuery && (
            <button
              type="button"
              onClick={() => setSearchQuery('')}
              className="p-1 rounded-full text-textHint hover:text-textPrimary"
            >
              <X className="w-4 h-4" />
            </button>
          )}
        </div>
      </div>

      {/* Sheet List */}
      <main className="flex-1 space-y-3">
        {loading ? (
          <div className="py-20 text-center text-sm font-medium text-textHint">
            Loading sheets...
          </div>
        ) : filteredAndSortedSheets.length === 0 ? (
          <div className="py-16 px-6 text-center rounded-3xl bg-surface border border-cardStroke shadow-sm">
            <p className="text-sm font-semibold text-textSecondary">
              {searchQuery ? 'No sheets match your search' : 'No bill sheets yet'}
            </p>
            {!searchQuery && (
              <p className="text-xs text-textHint mt-1">
                Tap the + button below to create your first sheet or import a .bsplit file.
              </p>
            )}
          </div>
        ) : (
          filteredAndSortedSheets.map((item) => {
            const { sheet, contributors, items } = item;
            const sortedNames = [...contributors]
              .map((c) => c.contributorName)
              .sort()
              .join(', ');

            // Calculate total spent only on TYPE_EXPENSE (0)
            const totalExpense = items
              .filter((it) => it.itemType === ITEM_TYPE.TYPE_EXPENSE)
              .reduce((sum, it) => sum + it.amount, 0);

            const isMenuOpen = activeMenuSheetId === sheet.sheetID;

            return (
              <div
                key={sheet.sheetID}
                onClick={() => onOpenSheet(sheet.sheetID)}
                className="relative p-5 rounded-3xl bg-surface border border-cardStroke shadow-sm hover:shadow-md transition-all cursor-pointer group"
              >
                <div className="flex items-start justify-between gap-3">
                  <div className="flex-1 min-w-0">
                    <h2 className="text-lg font-bold text-textPrimary tracking-tight truncate">
                      {sheet.sheetName}
                    </h2>
                    <p className="text-xs text-textSecondary truncate mt-1">
                      {sortedNames || 'No contributors yet'}
                    </p>
                  </div>

                  {/* 3-dot overflow menu button */}
                  <div className="relative">
                    <button
                      type="button"
                      onClick={(e) => {
                        e.stopPropagation();
                        setActiveMenuSheetId(isMenuOpen ? null : sheet.sheetID);
                      }}
                      className="p-1.5 rounded-full hover:bg-surfaceAlt text-textHint hover:text-textPrimary transition-colors"
                    >
                      <MoreVertical className="w-5 h-5" />
                    </button>

                    {/* Overflow Dropdown */}
                    {isMenuOpen && (
                      <div
                        className="absolute right-0 top-8 z-30 w-44 rounded-2xl bg-surface p-1.5 shadow-xl border border-cardStroke animate-morph-in"
                        onClick={(e) => e.stopPropagation()}
                      >
                        {!sheet.isReadOnly && (
                          <button
                            type="button"
                            onClick={() => {
                              setActiveMenuSheetId(null);
                              setEditingSheet(item);
                              setIsAddSheetOpen(true);
                            }}
                            className="w-full text-left px-3.5 py-2.5 rounded-xl text-xs font-semibold text-textPrimary hover:bg-surfaceAlt flex items-center gap-2.5 transition-colors"
                          >
                            Edit
                          </button>
                        )}

                        <button
                          type="button"
                          onClick={() => {
                            setActiveMenuSheetId(null);
                            setExportingSheet(item);
                          }}
                          className="w-full text-left px-3.5 py-2.5 rounded-xl text-xs font-semibold text-textPrimary hover:bg-surfaceAlt flex items-center gap-2.5 transition-colors"
                        >
                          Share / Export
                        </button>

                        {!sheet.isReadOnly && (
                          <button
                            type="button"
                            onClick={() => {
                              setActiveMenuSheetId(null);
                              setCloningSheet(item);
                            }}
                            className="w-full text-left px-3.5 py-2.5 rounded-xl text-xs font-semibold text-textPrimary hover:bg-surfaceAlt flex items-center gap-2.5 transition-colors"
                          >
                            Clone
                          </button>
                        )}

                        <button
                          type="button"
                          onClick={() => {
                            setActiveMenuSheetId(null);
                            setDetailsSheet(item);
                          }}
                          className="w-full text-left px-3.5 py-2.5 rounded-xl text-xs font-semibold text-textPrimary hover:bg-surfaceAlt flex items-center gap-2.5 transition-colors"
                        >
                          Details
                        </button>

                        <div className="my-1 border-t border-cardStroke" />

                        <button
                          type="button"
                          onClick={() => {
                            setActiveMenuSheetId(null);
                            setDeletingSheet(item);
                          }}
                          className="w-full text-left px-3.5 py-2.5 rounded-xl text-xs font-semibold text-giveText hover:bg-giveText/10 flex items-center gap-2.5 transition-colors"
                        >
                          Delete
                        </button>
                      </div>
                    )}
                  </div>
                </div>

                <div className="mt-4 pt-3 border-t border-cardStroke/60 flex items-center justify-between">
                  <span
                    className={`text-[11px] font-extrabold uppercase tracking-wider ${
                      sheet.isReadOnly
                        ? 'text-carryAccent'
                        : items.length === 0
                        ? 'text-receiveText'
                        : 'text-receiveText'
                    }`}
                  >
                    {sheet.isReadOnly
                      ? 'READ ONLY'
                      : items.length === 0
                      ? 'READY TO SPLIT'
                      : 'ACTIVE SHEET'}
                  </span>

                  <span className="text-base font-extrabold text-textPrimary">
                    {formatCurrency(totalExpense)}
                  </span>
                </div>
              </div>
            );
          })
        )}
      </main>

      {/* Bottom Floating Action Button */}
      <div className="fixed bottom-6 right-6 z-40">
        <div className="relative">
          {isFabMenuOpen && (
            <div
              className="absolute bottom-16 right-0 w-48 rounded-2xl bg-surface p-1.5 shadow-2xl border border-cardStroke animate-morph-in mb-2 space-y-1"
              onClick={(e) => e.stopPropagation()}
            >
              <button
                type="button"
                onClick={() => {
                  setIsFabMenuOpen(false);
                  setEditingSheet(null);
                  setCloningSheet(null);
                  setCarryoverBalances(null);
                  setIsAddSheetOpen(true);
                }}
                className="w-full text-left px-3.5 py-2.5 rounded-xl text-xs font-bold text-textPrimary hover:bg-surfaceAlt flex items-center gap-2.5 transition-colors"
              >
                <FolderPlus className="w-4 h-4 text-textHint" />
                New Sheet
              </button>

              <button
                type="button"
                onClick={() => {
                  setIsFabMenuOpen(false);
                  fileInputRef.current?.click();
                }}
                className="w-full text-left px-3.5 py-2.5 rounded-xl text-xs font-bold text-textPrimary hover:bg-surfaceAlt flex items-center gap-2.5 transition-colors"
              >
                <FileUp className="w-4 h-4 text-textHint" />
                Import Sheet (.bsplit)
              </button>
            </div>
          )}

          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation();
              setIsFabMenuOpen(!isFabMenuOpen);
            }}
            className="w-14 h-14 rounded-full bg-btnPrimaryBg text-btnPrimaryText shadow-xl flex items-center justify-center hover:opacity-90 active:scale-95 transition-all"
            title="Add or import sheet"
          >
            <Plus className="w-6 h-6 stroke-[2.5]" />
          </button>
        </div>
      </div>

      {/* Dialogs */}
      <SortDialog
        isOpen={isSortOpen}
        sortBy={sortBy}
        sortOrder={sortOrder}
        onApply={handleApplySort}
        onClose={() => setIsSortOpen(false)}
      />

      <AddEditSheetDialog
        isOpen={isAddSheetOpen}
        itemToEdit={editingSheet}
        cloneSource={cloningSheet}
        carryoverBalances={carryoverBalances}
        onSave={handleSaveSheet}
        onClose={() => {
          setIsAddSheetOpen(false);
          setEditingSheet(null);
          setCloningSheet(null);
          setCarryoverBalances(null);
        }}
      />

      <CloneOptionsDialog
        isOpen={Boolean(cloningSheet) && !isAddSheetOpen}
        sourceSheet={cloningSheet}
        onSelectOption={handleCloneSelectOption}
        onClose={() => setCloningSheet(null)}
      />

      <ExportSheetDialog
        isOpen={Boolean(exportingSheet)}
        item={exportingSheet}
        onExport={handleExportSheet}
        onClose={() => setExportingSheet(null)}
      />

      <SheetDetailsDialog
        isOpen={Boolean(detailsSheet)}
        item={detailsSheet}
        onClose={() => setDetailsSheet(null)}
      />

      <ConfirmDialog
        isOpen={Boolean(deletingSheet)}
        title="Delete sheet?"
        message={
          deletingSheet && deletingSheet.items.length > 0
            ? `Are you sure you want to delete "${deletingSheet.sheet.sheetName}"? All ${deletingSheet.items.length} item(s) and balances in this sheet will be permanently deleted.`
            : `Are you sure you want to delete "${deletingSheet?.sheet.sheetName}"? This action cannot be undone.`
        }
        confirmText="Delete"
        onConfirm={handleDeleteSheetConfirm}
        onCancel={() => setDeletingSheet(null)}
      />
    </div>
  );
};

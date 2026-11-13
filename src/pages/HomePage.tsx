import React, { useState, useMemo, useRef } from 'react';
import {
  ArrowUpDown,
  Search,
  X,
  Plus,
  MoreVertical,
  FileUp,
  Pencil,
  Share2,
  Copy,
  Info,
  Trash2,
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
import { useMorphPresence } from '../hooks/useMorphPresence';

interface HomePageProps {
  onOpenSheet: (sheetId: number) => void;
}

const SheetCardMenu: React.FC<{
  isOpen: boolean;
  item: SheetWithContributorsAndItems;
  onEdit: () => void;
  onExport: () => void;
  onClone: () => void;
  onDetails: () => void;
  onDelete: () => void;
}> = ({ isOpen, item, onEdit, onExport, onClone, onDetails, onDelete }) => {
  const { shouldRender, isClosing } = useMorphPresence(isOpen, 150);
  if (!shouldRender) return null;

  return (
    <div
      className={`absolute right-0 top-8 z-30 w-44 rounded-2xl bg-surface py-1.5 shadow-xl border border-cardStroke origin-top-right ${
        isClosing ? 'animate-popup-morph-exit' : 'animate-popup-morph-enter'
      }`}
      onClick={(e) => e.stopPropagation()}
    >
      {!item.sheet.isReadOnly && (
        <button
          type="button"
          onClick={onEdit}
          className="w-full text-left px-3.5 py-2.5 text-sm font-medium text-textPrimary hover:bg-surfaceAlt flex items-center gap-3 transition-colors"
        >
          <Pencil className="w-4 h-4 text-textSecondary" />
          <span>Edit</span>
        </button>
      )}

      {!item.sheet.isReadOnly && <div className="border-t border-cardStroke" />}

      <button
        type="button"
        onClick={onExport}
        className="w-full text-left px-3.5 py-2.5 text-sm font-medium text-textPrimary hover:bg-surfaceAlt flex items-center gap-3 transition-colors"
      >
        <Share2 className="w-4 h-4 text-textSecondary" />
        <span>Export</span>
      </button>

      {!item.sheet.isReadOnly && (
        <>
          <div className="border-t border-cardStroke" />
          <button
            type="button"
            onClick={onClone}
            className="w-full text-left px-3.5 py-2.5 text-sm font-medium text-textPrimary hover:bg-surfaceAlt flex items-center gap-3 transition-colors"
          >
            <Copy className="w-4 h-4 text-textSecondary" />
            <span>Clone</span>
          </button>
        </>
      )}

      <div className="border-t border-cardStroke" />

      <button
        type="button"
        onClick={onDetails}
        className="w-full text-left px-3.5 py-2.5 text-sm font-medium text-textPrimary hover:bg-surfaceAlt flex items-center gap-3 transition-colors"
      >
        <Info className="w-4 h-4 text-textSecondary" />
        <span>Details</span>
      </button>

      <div className="border-t border-cardStroke" />

      <button
        type="button"
        onClick={onDelete}
        className="w-full text-left px-3.5 py-2.5 text-sm font-medium text-giveText hover:bg-giveText/10 flex items-center gap-3 transition-colors"
      >
        <Trash2 className="w-4 h-4 text-giveText" />
        <span>Delete</span>
      </button>
    </div>
  );
};

const FabMenu: React.FC<{
  isOpen: boolean;
  onNewSheet: () => void;
  onImportSheet: () => void;
}> = ({ isOpen, onNewSheet, onImportSheet }) => {
  const { shouldRender, isClosing } = useMorphPresence(isOpen, 150);
  if (!shouldRender) return null;

  return (
    <div
      className={`absolute bottom-16 right-0 w-52 rounded-2xl bg-surface py-1.5 shadow-2xl border border-cardStroke origin-bottom-right mb-2 ${
        isClosing ? 'animate-popup-morph-exit' : 'animate-popup-morph-enter'
      }`}
      onClick={(e) => e.stopPropagation()}
    >
      <button
        type="button"
        onClick={onNewSheet}
        className="w-full text-left px-4 py-3 text-sm font-semibold text-textPrimary hover:bg-surfaceAlt flex items-center gap-3 transition-colors"
      >
        <Plus className="w-4 h-4 text-textSecondary" />
        <span>New Sheet</span>
      </button>

      <div className="border-t border-cardStroke" />

      <button
        type="button"
        onClick={onImportSheet}
        className="w-full text-left px-4 py-3 text-sm font-semibold text-textPrimary hover:bg-surfaceAlt flex items-center gap-3 transition-colors"
      >
        <FileUp className="w-4 h-4 text-textSecondary" />
        <span>Import Sheet (.bsplit)</span>
      </button>
    </div>
  );
};

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
      className="h-full max-h-dvh max-w-xl w-full mx-auto flex flex-col overflow-hidden relative select-none animate-activity-morph-enter"
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

      {/* Top Header & Search Bar matching activity_main.xml (pinned top area) */}
      <div className="shrink-0 px-4 pt-4 pb-2 z-10 bg-gradient-to-b from-bgStart via-bgStart to-transparent">
        <header className="flex items-center justify-between pb-3 px-1">
          <div className="flex items-center gap-3">
            <img
              src={`${import.meta.env.BASE_URL}logo.svg`}
              alt="Bill Splitter"
              className="w-8 h-8 object-contain shrink-0 select-none"
            />
            <h1 className="text-[34px] font-bold tracking-tight text-textPrimary leading-none">
              Bill Sheets
            </h1>
          </div>
          {sheets.length >= 2 && (
            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation();
                setIsSortOpen(true);
              }}
              className="w-10 h-10 rounded-full flex items-center justify-center hover:bg-surfaceAlt text-iconTint active:scale-95 transition-all"
              title="Sort sheets"
            >
              <ArrowUpDown className="w-5 h-5 stroke-[2]" />
            </button>
          )}
        </header>

        {/* Search Bar matching searchSheetsContainer in activity_main.xml */}
        <div className="relative">
          <div className="flex items-center h-[46px] px-3.5 rounded-2xl bg-surface border border-cardStroke shadow-sm focus-within:border-textPrimary transition-colors">
            <Search className="w-4 h-4 text-textHint shrink-0" />
            <input
              type="text"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="Search sheets or people..."
              className="w-full ml-2.5 bg-transparent text-sm text-textPrimary placeholder:text-textHint focus:outline-none focus:ring-0"
            />
            {searchQuery && (
              <button
                type="button"
                onClick={() => setSearchQuery('')}
                className="w-7 h-7 rounded-full flex items-center justify-center text-textHint hover:text-textPrimary shrink-0"
              >
                <X className="w-4 h-4" />
              </button>
            )}
          </div>
        </div>
      </div>

      {/* Sheet List matching recyclerView in activity_main.xml */}
      <main className="flex-1 overflow-y-auto px-4 pt-1 pb-28 space-y-3 overscroll-contain">
        {loading ? (
          <div className="py-20 text-center text-sm font-medium text-textHint">
            Loading sheets...
          </div>
        ) : filteredAndSortedSheets.length === 0 ? (
          <div className="py-14 px-6 text-center rounded-2xl bg-surface border border-cardStroke shadow-sm flex flex-col items-center">
            {!searchQuery && (
              <img
                src={`${import.meta.env.BASE_URL}logo.svg`}
                alt="Bill Splitter"
                className="w-16 h-16 mb-4 object-contain opacity-90 select-none drop-shadow-sm"
              />
            )}
            <p className="text-sm font-bold text-textSecondary">
              {searchQuery ? 'No sheets match your search' : 'No bill sheets yet'}
            </p>
            {!searchQuery && (
              <p className="text-xs text-textHint mt-1 leading-relaxed max-w-[260px]">
                Tap the + button below to create your first sheet or import a .bsplit file.
              </p>
            )}
          </div>
        ) : (
          filteredAndSortedSheets.map((item) => {
            const { sheet, contributors, items } = item;
            const sortedNames = [...contributors]
              .map((c) => c.contributorName)
              .sort((a, b) => a.localeCompare(b))
              .join(', ');

            // Calculate total spent only on TYPE_EXPENSE (0)
            const totalExpense = items
              .filter((it) => it.itemType === ITEM_TYPE.TYPE_EXPENSE)
              .reduce((sum, it) => sum + it.amount, 0);

            const isMenuOpen = activeMenuSheetId === sheet.sheetID;

            const statusText = sheet.isReadOnly
              ? 'READ ONLY'
              : items.length === 0
              ? 'READY TO SPLIT'
              : 'ACTIVE SHEET';

            const statusColor = sheet.isReadOnly
              ? 'text-carryAccent'
              : 'text-receiveText';

            return (
              <div
                key={sheet.sheetID}
                onClick={() => onOpenSheet(sheet.sheetID)}
                className="relative p-[18px] rounded-2xl bg-surface border border-cardStroke shadow-sm hover:shadow-md active:scale-[0.99] transition-all cursor-pointer group"
              >
                {/* Row 1: Status Badge on Left, 3-dot Menu on Right matching sheet_card.xml */}
                <div className="flex items-center justify-between">
                  <span
                    className={`text-[10px] font-extrabold tracking-[0.08em] uppercase ${statusColor}`}
                  >
                    {statusText}
                  </span>

                  <div className="relative">
                    <button
                      type="button"
                      onClick={(e) => {
                        e.stopPropagation();
                        setActiveMenuSheetId(isMenuOpen ? null : sheet.sheetID);
                      }}
                      className="w-8 h-8 rounded-full flex items-center justify-center hover:bg-surfaceAlt text-textHint hover:text-textPrimary transition-colors"
                      title="Sheet options"
                    >
                      <MoreVertical className="w-5 h-5" />
                    </button>

                    {/* 3-dot Overflow Dropdown with morph enter & exit */}
                    <SheetCardMenu
                      isOpen={isMenuOpen}
                      item={item}
                      onEdit={() => {
                        setActiveMenuSheetId(null);
                        setEditingSheet(item);
                        setIsAddSheetOpen(true);
                      }}
                      onExport={() => {
                        setActiveMenuSheetId(null);
                        setExportingSheet(item);
                      }}
                      onClone={() => {
                        setActiveMenuSheetId(null);
                        setCloningSheet(item);
                      }}
                      onDetails={() => {
                        setActiveMenuSheetId(null);
                        setDetailsSheet(item);
                      }}
                      onDelete={() => {
                        setActiveMenuSheetId(null);
                        setDeletingSheet(item);
                      }}
                    />
                  </div>
                </div>

                {/* Row 2: Sheet Name + Amount Chip matching sheet_card.xml */}
                <div className="flex items-center justify-between gap-3 mt-2">
                  <h2 className="text-[20px] font-bold text-textPrimary tracking-tight truncate flex-1">
                    {sheet.sheetName}
                  </h2>

                  <div className="shrink-0 min-w-[88px] text-center px-3 py-1.5 rounded-[10px] bg-surfaceAlt border border-cardStroke">
                    <span className="text-base font-bold text-textPrimary">
                      {formatCurrency(totalExpense)}
                    </span>
                  </div>
                </div>

                {/* Row 3: Contributor List Panel matching bg_nested_panel in sheet_card.xml */}
                <div className="mt-3.5 px-3 py-2.5 rounded-[10px] bg-surfaceAlt truncate text-[13px] text-textSecondary font-medium">
                  {sortedNames || 'No contributors yet'}
                </div>
              </div>
            );
          })
        )}
      </main>

      {/* Bottom Floating Action Button matching FloatingActionButton in activity_main.xml */}
      <div className="absolute bottom-6 right-5 z-40">
        <div className="relative">
          {/* FAB Popover Menu with morph enter & exit */}
          <FabMenu
            isOpen={isFabMenuOpen}
            onNewSheet={() => {
              setIsFabMenuOpen(false);
              setEditingSheet(null);
              setCloningSheet(null);
              setCarryoverBalances(null);
              setIsAddSheetOpen(true);
            }}
            onImportSheet={() => {
              setIsFabMenuOpen(false);
              fileInputRef.current?.click();
            }}
          />

          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation();
              setIsFabMenuOpen(!isFabMenuOpen);
            }}
            className="w-14 h-14 rounded-full bg-btnPrimaryBg text-btnPrimaryText shadow-lg flex items-center justify-center active:scale-95 transition-all"
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
        isOpen={Boolean(cloningSheet && !isAddSheetOpen)}
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
        message={`Are you sure you want to permanently delete "${deletingSheet?.sheet.sheetName}" and all of its items?`}
        confirmText="Delete"
        onConfirm={handleDeleteSheetConfirm}
        onCancel={() => setDeletingSheet(null)}
      />
    </div>
  );
};

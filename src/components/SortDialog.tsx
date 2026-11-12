import React, { useState } from 'react';

export type SheetSortBy = 'dateModified' | 'dateCreated' | 'name' | 'contributors';
export type SortOrder = 'desc' | 'asc';

interface SortDialogProps {
  isOpen: boolean;
  sortBy: SheetSortBy;
  sortOrder: SortOrder;
  onApply: (sortBy: SheetSortBy, sortOrder: SortOrder) => void;
  onClose: () => void;
}

export const SortDialog: React.FC<SortDialogProps> = ({
  isOpen,
  sortBy: initialSortBy,
  sortOrder: initialSortOrder,
  onApply,
  onClose,
}) => {
  const [selectedSortBy, setSelectedSortBy] = useState<SheetSortBy>(initialSortBy);
  const [selectedSortOrder, setSelectedSortOrder] = useState<SortOrder>(initialSortOrder);

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm animate-fade-in">
      <div
        className="w-full max-w-sm rounded-2xl bg-surface p-6 shadow-2xl border border-cardStroke animate-morph-in"
        onClick={(e) => e.stopPropagation()}
      >
        <h3 className="text-lg font-bold text-textPrimary tracking-tight">Sort Sheets</h3>

        <div className="mt-4">
          <label className="text-xs font-bold uppercase tracking-wider text-textHint">Sort By</label>
          <div className="mt-2 space-y-1.5">
            {[
              { id: 'dateModified', label: 'Date Modified' },
              { id: 'dateCreated', label: 'Date Created' },
              { id: 'name', label: 'Sheet Name' },
              { id: 'contributors', label: 'Number of Contributors' },
            ].map((opt) => (
              <label
                key={opt.id}
                className="flex items-center gap-3 p-2.5 rounded-xl cursor-pointer hover:bg-surfaceAlt transition-colors"
              >
                <input
                  type="radio"
                  name="sheetSortBy"
                  value={opt.id}
                  checked={selectedSortBy === opt.id}
                  onChange={() => setSelectedSortBy(opt.id as SheetSortBy)}
                  className="w-4 h-4 text-btnPrimaryBg accent-textPrimary"
                />
                <span className="text-sm font-medium text-textPrimary">{opt.label}</span>
              </label>
            ))}
          </div>
        </div>

        <div className="mt-5 border-t border-cardStroke pt-4">
          <label className="text-xs font-bold uppercase tracking-wider text-textHint">Order</label>
          <div className="mt-2 space-y-1.5">
            {[
              { id: 'desc', label: 'Descending' },
              { id: 'asc', label: 'Ascending' },
            ].map((opt) => (
              <label
                key={opt.id}
                className="flex items-center gap-3 p-2.5 rounded-xl cursor-pointer hover:bg-surfaceAlt transition-colors"
              >
                <input
                  type="radio"
                  name="sheetSortOrder"
                  value={opt.id}
                  checked={selectedSortOrder === opt.id}
                  onChange={() => setSelectedSortOrder(opt.id as SortOrder)}
                  className="w-4 h-4 text-btnPrimaryBg accent-textPrimary"
                />
                <span className="text-sm font-medium text-textPrimary">{opt.label}</span>
              </label>
            ))}
          </div>
        </div>

        <div className="mt-6 flex justify-end gap-3">
          <button
            type="button"
            onClick={onClose}
            className="px-4 py-2.5 rounded-xl text-sm font-semibold text-textSecondary bg-surfaceAlt hover:bg-surfaceHigh transition-colors"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={() => {
              onApply(selectedSortBy, selectedSortOrder);
              onClose();
            }}
            className="px-5 py-2.5 rounded-xl text-sm font-semibold text-btnPrimaryText bg-btnPrimaryBg hover:opacity-90 transition-opacity"
          >
            Apply
          </button>
        </div>
      </div>
    </div>
  );
};

import React, { useState } from 'react';
import { X } from 'lucide-react';

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
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm animate-backdrop-in"
      onClick={onClose}
    >
      <div
        className="w-full max-w-[360px] rounded-2xl bg-surface p-5 sm:p-6 shadow-2xl border border-cardStroke animate-dialog-morph-enter my-auto"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between pb-2 border-b border-cardStroke">
          <h3 className="text-lg font-bold text-textPrimary tracking-tight">Sort Sheets</h3>
          <button
            type="button"
            onClick={onClose}
            className="w-8 h-8 rounded-full flex items-center justify-center text-textHint hover:text-textPrimary transition-colors"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        <div className="mt-3">
          <span className="text-[11px] font-bold tracking-[0.12em] text-textHint uppercase block mb-1">
            SORT BY
          </span>
          <div className="space-y-1">
            {[
              { id: 'name', label: 'Name' },
              { id: 'contributors', label: 'Number of contributors' },
              { id: 'dateCreated', label: 'Date Created' },
              { id: 'dateModified', label: 'Date Modified' },
            ].map((opt) => (
              <label
                key={opt.id}
                className="flex items-center gap-3 px-3 py-2 rounded-xl cursor-pointer hover:bg-surfaceAlt transition-colors select-none"
              >
                <input
                  type="radio"
                  name="sheetSortBy"
                  value={opt.id}
                  checked={selectedSortBy === opt.id}
                  onChange={() => setSelectedSortBy(opt.id as SheetSortBy)}
                  className="w-4 h-4 text-btnPrimaryBg accent-btnPrimaryBg cursor-pointer"
                />
                <span className="text-[15px] font-medium text-textPrimary">{opt.label}</span>
              </label>
            ))}
          </div>
        </div>

        <div className="mt-4 pt-3 border-t border-cardStroke">
          <span className="text-[11px] font-bold tracking-[0.12em] text-textHint uppercase block mb-1">
            ORDER
          </span>
          <div className="space-y-1">
            {[
              { id: 'asc', label: 'Ascending' },
              { id: 'desc', label: 'Descending' },
            ].map((opt) => (
              <label
                key={opt.id}
                className="flex items-center gap-3 px-3 py-2 rounded-xl cursor-pointer hover:bg-surfaceAlt transition-colors select-none"
              >
                <input
                  type="radio"
                  name="sheetSortOrder"
                  value={opt.id}
                  checked={selectedSortOrder === opt.id}
                  onChange={() => setSelectedSortOrder(opt.id as SortOrder)}
                  className="w-4 h-4 text-btnPrimaryBg accent-btnPrimaryBg cursor-pointer"
                />
                <span className="text-[15px] font-medium text-textPrimary">{opt.label}</span>
              </label>
            ))}
          </div>
        </div>

        <div className="mt-5">
          <button
            type="button"
            onClick={() => {
              onApply(selectedSortBy, selectedSortOrder);
              onClose();
            }}
            className="w-full h-[46px] rounded-xl text-sm font-bold text-btnPrimaryText bg-btnPrimaryBg hover:opacity-90 transition-opacity shadow-sm"
          >
            Apply
          </button>
        </div>
      </div>
    </div>
  );
};

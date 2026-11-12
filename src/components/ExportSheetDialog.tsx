import React, { useState } from 'react';
import { X, Share2, Download, Lock } from 'lucide-react';
import type { SheetWithContributorsAndItems } from '../types/models';

interface ExportSheetDialogProps {
  isOpen: boolean;
  item: SheetWithContributorsAndItems | null;
  onExport: (readOnly: boolean, action: 'share' | 'save') => void;
  onClose: () => void;
}

export const ExportSheetDialog: React.FC<ExportSheetDialogProps> = ({
  isOpen,
  item,
  onExport,
  onClose,
}) => {
  const isOriginallyReadOnly = Boolean(item?.sheet.isReadOnly);
  const [makeReadOnly, setMakeReadOnly] = useState(isOriginallyReadOnly);

  if (!isOpen || !item) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm animate-fade-in">
      <div
        className="w-full max-w-sm rounded-3xl bg-surface p-6 shadow-2xl border border-cardStroke animate-morph-in"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between pb-3 border-b border-cardStroke">
          <div>
            <h2 className="text-lg font-bold text-textPrimary tracking-tight">Export Sheet</h2>
            <p className="text-xs text-textSecondary truncate max-w-[220px]">
              {item.sheet.sheetName}
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="p-1.5 rounded-full hover:bg-surfaceAlt text-textHint hover:text-textPrimary transition-colors"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Read-Only Option */}
        <div className="mt-5 p-4 rounded-2xl bg-surfaceAlt border border-cardStroke">
          <label className="flex items-start gap-3 cursor-pointer">
            <input
              type="checkbox"
              checked={isOriginallyReadOnly || makeReadOnly}
              disabled={isOriginallyReadOnly}
              onChange={(e) => setMakeReadOnly(e.target.checked)}
              className="mt-0.5 w-4 h-4 rounded text-btnPrimaryBg accent-textPrimary"
            />
            <div>
              <div className="flex items-center gap-1.5">
                <span className="text-sm font-bold text-textPrimary">Export as read-only</span>
                <Lock className="w-3.5 h-3.5 text-textSecondary" />
              </div>
              <p className="mt-1 text-xs text-textSecondary leading-relaxed">
                {isOriginallyReadOnly
                  ? 'This sheet is strictly read-only and can only be exported as read-only.'
                  : 'Recipients can view expenses and balances, but cannot edit, add, or delete items.'}
              </p>
            </div>
          </label>
        </div>

        {/* Action Buttons */}
        <div className="mt-5 space-y-2.5">
          <button
            type="button"
            onClick={() => {
              onExport(isOriginallyReadOnly || makeReadOnly, 'share');
              onClose();
            }}
            className="w-full py-3 px-4 rounded-2xl bg-btnPrimaryBg text-btnPrimaryText font-semibold text-sm flex items-center justify-center gap-2 hover:opacity-90 transition-opacity"
          >
            <Share2 className="w-4 h-4" />
            Share (.bsplit)
          </button>

          <button
            type="button"
            onClick={() => {
              onExport(isOriginallyReadOnly || makeReadOnly, 'save');
              onClose();
            }}
            className="w-full py-3 px-4 rounded-2xl bg-surfaceAlt hover:bg-surfaceHigh text-textPrimary font-semibold text-sm flex items-center justify-center gap-2 border border-cardStroke transition-colors"
          >
            <Download className="w-4 h-4" />
            Save to Device
          </button>
        </div>
      </div>
    </div>
  );
};

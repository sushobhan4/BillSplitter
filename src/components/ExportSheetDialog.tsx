import React, { useState, useEffect } from 'react';
import { X, Share2, Download, Lock } from 'lucide-react';
import type { SheetWithContributorsAndItems } from '../types/models';
import { useMorphPresence } from '../hooks/useMorphPresence';

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
  const { shouldRender, isClosing } = useMorphPresence(isOpen && Boolean(item), 180);

  useEffect(() => {
    if (isOpen && item) {
      setMakeReadOnly(Boolean(item.sheet.isReadOnly));
    }
  }, [isOpen, item]);

  if (!shouldRender || !item) return null;

  return (
    <div
      className={`fixed inset-0 z-50 flex items-center justify-center p-3 sm:p-4 bg-black/60 backdrop-blur-sm overflow-y-auto ${
        isClosing ? 'animate-backdrop-out' : 'animate-backdrop-in'
      }`}
      style={{
        height: 'var(--app-height, 100dvh)',
        maxHeight: 'var(--app-height, 100dvh)',
      }}
      onClick={onClose}
    >
      <div
        className={`w-full max-w-sm rounded-2xl bg-surface p-5 sm:p-6 shadow-2xl border border-cardStroke m-auto ${
          isClosing ? 'animate-dialog-morph-exit' : 'animate-dialog-morph-enter'
        }`}
        style={{
          maxHeight: 'calc(var(--app-height, 100dvh) - 24px)',
        }}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between pb-3 border-b border-cardStroke">
          <div className="min-w-0 pr-2">
            <h2 className="text-lg font-bold text-textPrimary tracking-tight">Export Sheet</h2>
            <p className="text-xs text-textSecondary truncate">
              {item.sheet.sheetName}
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="w-8 h-8 rounded-full flex items-center justify-center text-textHint hover:text-textPrimary transition-colors shrink-0"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Action Buttons matching btnExportShare & btnExportSave in dialog_export_sheet.xml */}
        <div className="mt-4 space-y-2.5">
          <button
            type="button"
            onClick={() => {
              onExport(isOriginallyReadOnly || makeReadOnly, 'share');
              onClose();
            }}
            className="w-full p-4 rounded-xl bg-surfaceAlt hover:bg-surfaceHigh border border-cardStroke flex items-center gap-3.5 transition-colors text-left"
          >
            <Share2 className="w-5 h-5 text-textPrimary shrink-0" />
            <div className="flex-1 min-w-0">
              <span className="text-base font-bold text-textPrimary block">Share</span>
              <span className="text-xs text-textSecondary block mt-0.5">Send .bsplit file via another app</span>
            </div>
          </button>

          <button
            type="button"
            onClick={() => {
              onExport(isOriginallyReadOnly || makeReadOnly, 'save');
              onClose();
            }}
            className="w-full p-4 rounded-xl bg-surfaceAlt hover:bg-surfaceHigh border border-cardStroke flex items-center gap-3.5 transition-colors text-left"
          >
            <Download className="w-5 h-5 text-textPrimary shrink-0" />
            <div className="flex-1 min-w-0">
              <span className="text-base font-bold text-textPrimary block">Save to device</span>
              <span className="text-xs text-textSecondary block mt-0.5">Save .bsplit file to your phone storage</span>
            </div>
          </button>
        </div>

        {/* Read-Only Option matching rowExportReadOnly in dialog_export_sheet.xml */}
        <div className="mt-3 p-3.5 rounded-xl bg-surfaceAlt border border-cardStroke">
          <label className="flex items-start gap-3 cursor-pointer select-none">
            <input
              type="checkbox"
              checked={isOriginallyReadOnly || makeReadOnly}
              disabled={isOriginallyReadOnly}
              onChange={(e) => setMakeReadOnly(e.target.checked)}
              className="mt-0.5 w-4 h-4 rounded text-btnPrimaryBg accent-btnPrimaryBg shrink-0"
            />
            <div>
              <div className="flex items-center gap-1.5">
                <span className="text-sm font-bold text-textPrimary">Read only</span>
                {isOriginallyReadOnly && <Lock className="w-3.5 h-3.5 text-textSecondary" />}
              </div>
              <p className="mt-0.5 text-xs text-textSecondary leading-relaxed">
                {isOriginallyReadOnly
                  ? 'This sheet is strictly read-only and can only be exported as read-only.'
                  : 'Block editing, adding, deleting, and cloning after import'}
              </p>
            </div>
          </label>
        </div>
      </div>
    </div>
  );
};

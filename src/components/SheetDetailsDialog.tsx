import React from 'react';
import { X } from 'lucide-react';
import type { SheetWithContributorsAndItems } from '../types/models';
import { formatDateTime } from '../utils/formatters';
import { useMorphPresence } from '../hooks/useMorphPresence';

interface SheetDetailsDialogProps {
  isOpen: boolean;
  item: SheetWithContributorsAndItems | null;
  onClose: () => void;
}

export const SheetDetailsDialog: React.FC<SheetDetailsDialogProps> = ({
  isOpen,
  item,
  onClose,
}) => {
  const { shouldRender, isClosing } = useMorphPresence(isOpen && Boolean(item), 180);

  if (!shouldRender || !item) return null;

  const { sheet, contributors } = item;

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
          <h2 className="text-lg font-bold text-textPrimary tracking-tight">Sheet Details</h2>
          <button
            type="button"
            onClick={onClose}
            className="w-8 h-8 rounded-full flex items-center justify-center text-textHint hover:text-textPrimary transition-colors"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        <div className="mt-4 space-y-3 text-sm">
          <div>
            <span className="text-[11px] font-bold tracking-[0.1em] uppercase text-textHint">Name</span>
            <p className="mt-0.5 font-bold text-textPrimary text-base">{sheet.sheetName}</p>
          </div>

          <div>
            <span className="text-[11px] font-bold tracking-[0.1em] uppercase text-textHint">Created</span>
            <p className="mt-0.5 text-textSecondary">{formatDateTime(sheet.dateCreated)}</p>
          </div>

          <div>
            <span className="text-[11px] font-bold tracking-[0.1em] uppercase text-textHint">Modified</span>
            <p className="mt-0.5 text-textSecondary">{formatDateTime(sheet.dateModified)}</p>
          </div>

          <div>
            <span className="text-[11px] font-bold tracking-[0.1em] uppercase text-textHint">
              Contributors ({contributors.length})
            </span>
            <p className="mt-0.5 text-textSecondary leading-relaxed">
              {contributors.map((c) => c.contributorName).join(', ') || 'No contributors'}
            </p>
          </div>

          {(sheet.notes || sheet.isReadOnly) && (
            <div>
              <span className="text-[11px] font-bold tracking-[0.1em] uppercase text-textHint">Notes</span>
              <p className="mt-0.5 text-textSecondary whitespace-pre-wrap leading-relaxed">
                {[
                  sheet.notes?.trim() || null,
                  sheet.isReadOnly ? 'Access: Read-only' : null,
                ]
                  .filter(Boolean)
                  .join('\n\n')}
              </p>
            </div>
          )}
        </div>

        <div className="mt-6 pt-3 border-t border-cardStroke flex justify-end">
          <button
            type="button"
            onClick={onClose}
            className="h-[42px] px-5 rounded-xl text-sm font-bold text-textPrimary bg-surfaceAlt hover:bg-surfaceHigh border border-cardStroke transition-colors"
          >
            Close
          </button>
        </div>
      </div>
    </div>
  );
};

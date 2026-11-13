import React from 'react';
import { X, RefreshCw, Users } from 'lucide-react';
import type { SheetWithContributorsAndItems } from '../types/models';
import { useMorphPresence } from '../hooks/useMorphPresence';

interface CloneOptionsDialogProps {
  isOpen: boolean;
  sourceSheet: SheetWithContributorsAndItems | null;
  onSelectOption: (option: 'empty' | 'with-balances') => void;
  onClose: () => void;
}

export const CloneOptionsDialog: React.FC<CloneOptionsDialogProps> = ({
  isOpen,
  sourceSheet,
  onSelectOption,
  onClose,
}) => {
  const { shouldRender, isClosing } = useMorphPresence(isOpen && Boolean(sourceSheet), 180);

  if (!shouldRender || !sourceSheet) return null;

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
            <h2 className="text-lg font-bold text-textPrimary tracking-tight">Clone Sheet</h2>
            <p className="text-xs text-textSecondary truncate">
              {sourceSheet.sheet.sheetName}
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

        <div className="mt-4 space-y-3">
          <button
            type="button"
            onClick={() => onSelectOption('empty')}
            className="w-full text-left p-3.5 rounded-xl bg-surfaceAlt hover:bg-surfaceHigh border border-cardStroke transition-all flex items-start gap-3.5 group"
          >
            <div className="p-2.5 rounded-xl bg-surface border border-cardStroke text-textPrimary shrink-0">
              <Users className="w-5 h-5" />
            </div>
            <div className="min-w-0">
              <p className="text-sm font-bold text-textPrimary">
                Start Fresh (Same Members)
              </p>
              <p className="mt-0.5 text-xs text-textSecondary leading-relaxed">
                Copies all {sourceSheet.contributors.length} members with zero balances.
              </p>
            </div>
          </button>

          <button
            type="button"
            onClick={() => onSelectOption('with-balances')}
            className="w-full text-left p-3.5 rounded-xl bg-surfaceAlt hover:bg-surfaceHigh border border-cardStroke transition-all flex items-start gap-3.5 group"
          >
            <div className="p-2.5 rounded-xl bg-carryPanel text-carryAccent border border-carryStroke shrink-0">
              <RefreshCw className="w-5 h-5" />
            </div>
            <div className="min-w-0">
              <p className="text-sm font-bold text-textPrimary">
                Carry Forward Balances
              </p>
              <p className="mt-0.5 text-xs text-textSecondary leading-relaxed">
                Carries forward unsettled net balances as previous balances in the new sheet.
              </p>
            </div>
          </button>
        </div>
      </div>
    </div>
  );
};

import React from 'react';
import { X, RefreshCw, Users } from 'lucide-react';
import type { SheetWithContributorsAndItems } from '../types/models';

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
  if (!isOpen || !sourceSheet) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm animate-fade-in">
      <div
        className="w-full max-w-sm rounded-3xl bg-surface p-6 shadow-2xl border border-cardStroke animate-morph-in"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between pb-3 border-b border-cardStroke">
          <div>
            <h2 className="text-lg font-bold text-textPrimary tracking-tight">Clone Sheet</h2>
            <p className="text-xs text-textSecondary truncate max-w-[220px]">
              {sourceSheet.sheet.sheetName}
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

        <div className="mt-5 space-y-3">
          <button
            type="button"
            onClick={() => onSelectOption('empty')}
            className="w-full text-left p-4 rounded-2xl bg-surfaceAlt hover:bg-surfaceHigh border border-cardStroke transition-all flex items-start gap-3.5 group"
          >
            <div className="p-2.5 rounded-xl bg-surface border border-cardStroke text-textPrimary">
              <Users className="w-5 h-5" />
            </div>
            <div>
              <p className="text-sm font-bold text-textPrimary group-hover:text-textPrimary">
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
            className="w-full text-left p-4 rounded-2xl bg-surfaceAlt hover:bg-surfaceHigh border border-cardStroke transition-all flex items-start gap-3.5 group"
          >
            <div className="p-2.5 rounded-xl bg-carryPanel text-carryAccent border border-carryStroke">
              <RefreshCw className="w-5 h-5" />
            </div>
            <div>
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

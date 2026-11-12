import React from 'react';
import { X } from 'lucide-react';
import type { ItemWithPayerAndConsumers } from '../types/models';
import { formatCurrency, formatDateTime } from '../utils/formatters';

interface ExpenseDetailsDialogProps {
  isOpen: boolean;
  item: ItemWithPayerAndConsumers | null;
  onClose: () => void;
}

export const ExpenseDetailsDialog: React.FC<ExpenseDetailsDialogProps> = ({
  isOpen,
  item,
  onClose,
}) => {
  if (!isOpen || !item) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm animate-fade-in">
      <div
        className="w-full max-w-sm rounded-3xl bg-surface p-6 shadow-2xl border border-cardStroke animate-morph-in"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between pb-3 border-b border-cardStroke">
          <h2 className="text-lg font-bold text-textPrimary tracking-tight">Details</h2>
          <button
            type="button"
            onClick={onClose}
            className="p-1.5 rounded-full hover:bg-surfaceAlt text-textHint hover:text-textPrimary transition-colors"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        <div className="mt-4 space-y-3 text-sm">
          <div>
            <span className="text-xs font-bold uppercase tracking-wider text-textHint">Item</span>
            <p className="mt-0.5 font-semibold text-textPrimary">{item.item.itemName}</p>
          </div>

          <div>
            <span className="text-xs font-bold uppercase tracking-wider text-textHint">Amount</span>
            <p className="mt-0.5 font-bold text-textPrimary">{formatCurrency(item.item.amount)}</p>
          </div>

          <div>
            <span className="text-xs font-bold uppercase tracking-wider text-textHint">Paid by</span>
            <p className="mt-0.5 text-textSecondary font-medium">{item.payer.contributorName}</p>
          </div>

          <div>
            <span className="text-xs font-bold uppercase tracking-wider text-textHint">Created</span>
            <p className="mt-0.5 text-textSecondary">{formatDateTime(item.item.dateCreated)}</p>
          </div>

          <div>
            <span className="text-xs font-bold uppercase tracking-wider text-textHint">Modified</span>
            <p className="mt-0.5 text-textSecondary">{formatDateTime(item.item.dateModified)}</p>
          </div>

          <div>
            <span className="text-xs font-bold uppercase tracking-wider text-textHint">
              Consumers ({item.consumers.length})
            </span>
            <p className="mt-0.5 text-textSecondary leading-relaxed">
              {item.consumers.map((c) => c.contributorName).join(', ') || 'None'}
            </p>
          </div>

          {item.item.notes && (
            <div>
              <span className="text-xs font-bold uppercase tracking-wider text-textHint">Notes</span>
              <p className="mt-0.5 text-textSecondary whitespace-pre-wrap leading-relaxed">
                {item.item.notes}
              </p>
            </div>
          )}
        </div>

        <div className="mt-6 pt-3 border-t border-cardStroke flex justify-end">
          <button
            type="button"
            onClick={onClose}
            className="px-5 py-2.5 rounded-2xl text-sm font-semibold text-textSecondary bg-surfaceAlt hover:bg-surfaceHigh transition-colors"
          >
            Close
          </button>
        </div>
      </div>
    </div>
  );
};

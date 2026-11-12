import React, { useState, useEffect } from 'react';
import { X, ArrowRightLeft } from 'lucide-react';
import type { Contributor, ItemWithPayerAndConsumers } from '../types/models';
import { ITEM_TYPE } from '../types/models';

interface MoneyTransferDialogProps {
  isOpen: boolean;
  contributors: Contributor[];
  itemToEdit: ItemWithPayerAndConsumers | null;
  onSave: (
    fromId: number,
    toId: number,
    amount: number,
    itemType: typeof ITEM_TYPE.TYPE_MONEY_TRANSFER | typeof ITEM_TYPE.TYPE_SETTLEMENT
  ) => void;
  onClose: () => void;
}

export const MoneyTransferDialog: React.FC<MoneyTransferDialogProps> = ({
  isOpen,
  contributors,
  itemToEdit,
  onSave,
  onClose,
}) => {
  const sortedContributors = [...contributors].sort((a, b) =>
    a.contributorName.toLowerCase().localeCompare(b.contributorName.toLowerCase())
  );

  const [amountStr, setAmountStr] = useState('');
  const [fromId, setFromId] = useState<number | ''>('');
  const [toId, setToId] = useState<number | ''>('');
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  useEffect(() => {
    if (!isOpen) return;

    if (itemToEdit) {
      setAmountStr(itemToEdit.item.amount.toString());
      setFromId(itemToEdit.payer.contributorID);
      const firstConsumer = itemToEdit.consumers[0];
      setToId(firstConsumer ? firstConsumer.contributorID : '');
    } else {
      setAmountStr('');
      setFromId('');
      setToId('');
    }
    setErrorMsg(null);
  }, [isOpen, itemToEdit]);

  if (!isOpen) return null;

  const title =
    itemToEdit?.item.itemType === ITEM_TYPE.TYPE_SETTLEMENT
      ? 'Edit Payment'
      : itemToEdit
      ? 'Edit Money Transfer'
      : 'Money Transfer';

  const fromCandidates = sortedContributors.filter((c) => c.contributorID !== toId);
  const toCandidates = sortedContributors.filter((c) => c.contributorID !== fromId);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    const amount = parseFloat(amountStr) || 0;
    if (amount <= 0) {
      setErrorMsg('Invalid amount.');
      return;
    }
    if (!fromId) {
      setErrorMsg('Select who sent the money (From).');
      return;
    }
    if (!toId) {
      setErrorMsg('Select who received the money (To).');
      return;
    }
    if (fromId === toId) {
      setErrorMsg('From and To must be different people.');
      return;
    }

    const itemType =
      itemToEdit?.item.itemType === ITEM_TYPE.TYPE_SETTLEMENT
        ? ITEM_TYPE.TYPE_SETTLEMENT
        : ITEM_TYPE.TYPE_MONEY_TRANSFER;

    onSave(Number(fromId), Number(toId), amount, itemType);
    onClose();
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm animate-fade-in">
      <div
        className="w-full max-w-sm rounded-3xl bg-surface p-6 shadow-2xl border border-cardStroke animate-morph-in"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between pb-3 border-b border-cardStroke">
          <div className="flex items-center gap-2">
            <div className="p-2 rounded-xl bg-transferPanel text-transferAccent">
              <ArrowRightLeft className="w-4 h-4" />
            </div>
            <h2 className="text-lg font-bold text-textPrimary tracking-tight">{title}</h2>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="p-1.5 rounded-full hover:bg-surfaceAlt text-textHint hover:text-textPrimary transition-colors"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        <form onSubmit={handleSubmit} className="mt-4 space-y-4">
          <div>
            <label className="text-xs font-bold uppercase tracking-wider text-textHint">
              Amount (₹) *
            </label>
            <input
              type="number"
              step="0.01"
              min="0"
              value={amountStr}
              onChange={(e) => {
                setAmountStr(e.target.value);
                setErrorMsg(null);
              }}
              placeholder="0.00"
              className="mt-1.5 w-full px-4 py-2.5 rounded-2xl bg-surfaceAlt border border-cardStroke text-textPrimary placeholder:text-textHint text-sm font-semibold focus:outline-none focus:ring-2 focus:ring-textPrimary"
              autoFocus
            />
          </div>

          <div>
            <label className="text-xs font-bold uppercase tracking-wider text-textHint">
              From (Sender) *
            </label>
            <select
              value={fromId}
              onChange={(e) => {
                setFromId(e.target.value ? Number(e.target.value) : '');
                setErrorMsg(null);
              }}
              className="mt-1.5 w-full px-4 py-2.5 rounded-2xl bg-surfaceAlt border border-cardStroke text-textPrimary text-sm font-medium focus:outline-none focus:ring-2 focus:ring-textPrimary cursor-pointer"
            >
              <option value="">Select Sender</option>
              {fromCandidates.map((c) => (
                <option key={c.contributorID} value={c.contributorID}>
                  {c.contributorName}
                </option>
              ))}
            </select>
          </div>

          <div>
            <label className="text-xs font-bold uppercase tracking-wider text-textHint">
              To (Recipient) *
            </label>
            <select
              value={toId}
              onChange={(e) => {
                setToId(e.target.value ? Number(e.target.value) : '');
                setErrorMsg(null);
              }}
              className="mt-1.5 w-full px-4 py-2.5 rounded-2xl bg-surfaceAlt border border-cardStroke text-textPrimary text-sm font-medium focus:outline-none focus:ring-2 focus:ring-textPrimary cursor-pointer"
            >
              <option value="">Select Recipient</option>
              {toCandidates.map((c) => (
                <option key={c.contributorID} value={c.contributorID}>
                  {c.contributorName}
                </option>
              ))}
            </select>
          </div>

          {errorMsg && (
            <p className="text-xs font-semibold text-giveText animate-fade-in">{errorMsg}</p>
          )}

          <div className="pt-3 border-t border-cardStroke flex gap-3">
            <button
              type="button"
              onClick={onClose}
              className="flex-1 py-3 rounded-2xl text-sm font-semibold text-textSecondary bg-surfaceAlt hover:bg-surfaceHigh transition-colors"
            >
              Cancel
            </button>
            <button
              type="submit"
              className="flex-1 py-3 rounded-2xl text-sm font-semibold text-btnPrimaryText bg-btnPrimaryBg hover:opacity-90 transition-opacity"
            >
              Save
            </button>
          </div>
        </form>
      </div>
    </div>
  );
};

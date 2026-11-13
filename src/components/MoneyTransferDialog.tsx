import React, { useState, useEffect } from 'react';
import type { Contributor, ItemWithPayerAndConsumers } from '../types/models';
import { ITEM_TYPE } from '../types/models';
import { useMorphPresence } from '../hooks/useMorphPresence';
import { CustomSelect } from './CustomSelect';

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

  const { shouldRender, isClosing } = useMorphPresence(isOpen, 180);

  useEffect(() => {
    if (!isOpen) return;

    if (itemToEdit) {
      setAmountStr(itemToEdit.item.amount > 0 ? itemToEdit.item.amount.toString() : '');
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

  if (!shouldRender) return null;

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
        className={`w-full max-w-[400px] flex flex-col rounded-2xl bg-surface p-5 sm:p-6 shadow-2xl border border-cardStroke m-auto ${
          isClosing ? 'animate-dialog-morph-exit' : 'animate-dialog-morph-enter'
        }`}
        style={{
          maxHeight: 'calc(var(--app-height, 100dvh) - 24px)',
        }}
        onClick={(e) => e.stopPropagation()}
      >
        {/* Title: Centered 19sp bold */}
        <h2 className="text-[19px] font-bold text-center text-textPrimary tracking-tight shrink-0">
          {title}
        </h2>

        <form onSubmit={handleSubmit} className="flex-1 flex flex-col overflow-hidden mt-2">
          <div className="flex-1 overflow-y-auto px-1 py-1 space-y-3.5">
            {/* Amount Section matching Android et_transfer_amount */}
            <div className="flex flex-col items-center pt-2">
              <span className="text-[11px] font-bold tracking-[0.12em] text-textHint uppercase">
                AMOUNT
              </span>
              <div className="w-full flex items-center justify-center mt-1">
                <input
                  type="number"
                  step="0.01"
                  min="0"
                  value={amountStr}
                  onChange={(e) => {
                    setAmountStr(e.target.value);
                    setErrorMsg(null);
                  }}
                  onFocus={(e) => e.target.scrollIntoView({ block: 'nearest', behavior: 'smooth' })}
                  placeholder="0.00"
                  className="w-full text-center text-[40px] font-bold bg-transparent text-textPrimary placeholder:text-textHint outline-none border-none py-1 leading-none tracking-tight focus:outline-none focus:ring-0"
                  autoFocus={!itemToEdit}
                />
              </div>
            </div>

            {/* FROM Dropdown matching spinner_transfer_from */}
            <div>
              <label className="text-[11px] font-bold tracking-[0.08em] text-textHint uppercase block mb-1">
                FROM
              </label>
              <CustomSelect
                value={fromId}
                placeholder="From"
                options={fromCandidates.map((c) => ({
                  value: c.contributorID,
                  label: c.contributorName,
                }))}
                onChange={(val) => {
                  setFromId(val ? Number(val) : '');
                  setErrorMsg(null);
                }}
              />
            </div>

            {/* TO Dropdown matching spinner_transfer_to */}
            <div>
              <label className="text-[11px] font-bold tracking-[0.08em] text-textHint uppercase block mb-1">
                TO
              </label>
              <CustomSelect
                value={toId}
                placeholder="To"
                options={toCandidates.map((c) => ({
                  value: c.contributorID,
                  label: c.contributorName,
                }))}
                onChange={(val) => {
                  setToId(val ? Number(val) : '');
                  setErrorMsg(null);
                }}
              />
            </div>

            {errorMsg && (
              <p className="text-xs font-semibold text-giveText leading-relaxed pt-1">
                {errorMsg}
              </p>
            )}
          </div>

          {/* Bottom Action Buttons pinned at bottom of card */}
          <div className="shrink-0 pt-3 flex gap-3">
            <button
              type="button"
              onClick={onClose}
              className="flex-1 h-[46px] rounded-xl text-sm font-bold text-textPrimary bg-surfaceAlt hover:bg-surfaceHigh border border-cardStroke transition-colors"
            >
              Cancel
            </button>
            <button
              type="submit"
              className="flex-1 h-[46px] rounded-xl text-sm font-bold text-btnPrimaryText bg-btnPrimaryBg hover:opacity-90 transition-opacity"
            >
              Save
            </button>
          </div>
        </form>
      </div>
    </div>
  );
};

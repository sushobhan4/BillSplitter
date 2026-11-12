import React, { useState, useEffect, useRef } from 'react';
import { X } from 'lucide-react';
import type { Contributor, ItemWithPayerAndConsumers, ItemConsumer } from '../types/models';
import { ITEM_TYPE } from '../types/models';
import { dbClient } from '../db/dbClient';

interface AddEditExpenseDialogProps {
  isOpen: boolean;
  contributors: Contributor[];
  itemToEdit: ItemWithPayerAndConsumers | null;
  onSave: (
    itemName: string,
    amount: number,
    payerId: number,
    consumerWeights: Array<{ contributorId: number; weight: number }>,
    notes: string | null
  ) => void;
  onClose: () => void;
}

export const AddEditExpenseDialog: React.FC<AddEditExpenseDialogProps> = ({
  isOpen,
  contributors,
  itemToEdit,
  onSave,
  onClose,
}) => {
  const sortedContributors = [...contributors].sort((a, b) =>
    a.contributorName.toLowerCase().localeCompare(b.contributorName.toLowerCase())
  );

  const [itemName, setItemName] = useState('');
  const [totalAmountStr, setTotalAmountStr] = useState('');
  const [notes, setNotes] = useState('');
  const [payerId, setPayerId] = useState<number | ''>('');
  const [isEqualSplit, setIsEqualSplit] = useState(true);
  const [checkedIds, setCheckedIds] = useState<Set<number>>(new Set());
  const [rowAmounts, setRowAmounts] = useState<Record<number, string>>({});
  const [rowPercentages, setRowPercentages] = useState<Record<number, string>>({});
  const [warningMsg, setWarningMsg] = useState<string | null>(null);

  const isUpdatingProgrammatically = useRef(false);
  const manualEntries = useRef<Record<number, boolean>>({});

  // Initialize form state
  useEffect(() => {
    if (!isOpen) return;

    if (itemToEdit) {
      setItemName(itemToEdit.item.itemName);
      setTotalAmountStr(itemToEdit.item.amount.toString());
      setNotes(itemToEdit.item.notes || '');
      setPayerId(itemToEdit.payer.contributorID);

      // Fetch weights to determine equal or custom split
      dbClient.getItemConsumers(itemToEdit.item.itemID).then((consumers: ItemConsumer[]) => {
        const cIds = new Set(consumers.map((c) => c.contributorID));
        setCheckedIds(cIds);

        const areEqual =
          consumers.length <= 1 ||
          (() => {
            const first = consumers[0].weight;
            return consumers.every((c) => Math.abs(c.weight - first) < 0.01);
          })();

        setIsEqualSplit(areEqual);

        const newRowAmts: Record<number, string> = {};
        const newRowPercs: Record<number, string> = {};
        const newManual: Record<number, boolean> = {};

        consumers.forEach((c) => {
          newRowAmts[c.contributorID] = c.weight.toFixed(2);
          const perc =
            itemToEdit.item.amount > 0 ? (c.weight / itemToEdit.item.amount) * 100 : 0;
          newRowPercs[c.contributorID] = perc.toFixed(2);
          if (!areEqual) {
            newManual[c.contributorID] = true;
          }
        });

        setRowAmounts(newRowAmts);
        setRowPercentages(newRowPercs);
        manualEntries.current = newManual;
      });
    } else {
      setItemName('');
      setTotalAmountStr('');
      setNotes('');
      setPayerId('');
      setIsEqualSplit(true);
      setCheckedIds(new Set());
      setRowAmounts({});
      setRowPercentages({});
      manualEntries.current = {};
      setWarningMsg(null);
    }
  }, [isOpen, itemToEdit]);

  if (!isOpen) return null;

  const totalAmount = parseFloat(totalAmountStr) || 0.0;
  const checkedList = sortedContributors.filter((c) => checkedIds.has(c.contributorID));

  const allSelected =
    sortedContributors.length > 0 && checkedIds.size === sortedContributors.length;

  const handleSelectAllToggle = () => {
    isUpdatingProgrammatically.current = true;
    if (allSelected) {
      setCheckedIds(new Set());
      setRowAmounts({});
      setRowPercentages({});
      manualEntries.current = {};
    } else {
      const all = new Set(sortedContributors.map((c) => c.contributorID));
      setCheckedIds(all);
      manualEntries.current = {};
      if (isEqualSplit && totalAmount > 0) {
        const share = (totalAmount / sortedContributors.length).toFixed(2);
        const amounts: Record<number, string> = {};
        sortedContributors.forEach((c) => (amounts[c.contributorID] = share));
        setRowAmounts(amounts);
      }
    }
    isUpdatingProgrammatically.current = false;
  };

  const handleCheckboxChange = (id: number) => {
    const next = new Set(checkedIds);
    if (next.has(id)) {
      next.delete(id);
      delete manualEntries.current[id];
      const newAmts = { ...rowAmounts };
      const newPercs = { ...rowPercentages };
      delete newAmts[id];
      delete newPercs[id];
      setRowAmounts(newAmts);
      setRowPercentages(newPercs);
    } else {
      next.add(id);
    }
    setCheckedIds(next);
    setWarningMsg(null);
  };

  const handleEqualSwitchChange = (checked: boolean) => {
    if (!checked) {
      if (totalAmount <= 0) {
        setWarningMsg('Please enter the total Amount before custom splitting.');
        return;
      }
      // Reset flags for custom mode
      manualEntries.current = {};
      const newAmts: Record<number, string> = {};
      const newPercs: Record<number, string> = {};
      checkedIds.forEach((id) => {
        newAmts[id] = '';
        newPercs[id] = '';
      });
      setRowAmounts(newAmts);
      setRowPercentages(newPercs);
    }
    setIsEqualSplit(checked);
    setWarningMsg(null);
  };

  // Main custom split auto-balancing algorithm ported from SheetViewActivity.kt
  const distributeAmounts = (
    sourceId: number,
    sourceAmount: number,
    currentAmounts: Record<number, string>
  ) => {
    if (totalAmount <= 0.001) return;

    manualEntries.current[sourceId] = true;

    const checkedArr = Array.from(checkedIds);
    let lockedIds = checkedArr.filter((id) => manualEntries.current[id]);
    let floatingIds = checkedArr.filter((id) => !manualEntries.current[id]);

    // If all are locked, unlock everyone else except current source
    if (floatingIds.length === 0 && checkedArr.length > 1) {
      checkedArr.forEach((id) => {
        if (id !== sourceId) {
          manualEntries.current[id] = false;
        }
      });
      lockedIds = checkedArr.filter((id) => manualEntries.current[id]);
      floatingIds = checkedArr.filter((id) => !manualEntries.current[id]);
    }

    // Sum locked rows
    let sumLocked = 0;
    lockedIds.forEach((id) => {
      const val = id === sourceId ? sourceAmount : parseFloat(currentAmounts[id] || '0') || 0;
      sumLocked += val;
    });

    const remaining = totalAmount - sumLocked;
    const updatedAmts = { ...currentAmounts, [sourceId]: sourceAmount.toFixed(2) };
    const updatedPercs = {
      ...rowPercentages,
      [sourceId]: ((sourceAmount / totalAmount) * 100).toFixed(2),
    };

    if (floatingIds.length > 0) {
      let amountPerFloating = remaining / floatingIds.length;
      if (amountPerFloating < 0) amountPerFloating = 0;

      floatingIds.forEach((id) => {
        updatedAmts[id] = amountPerFloating.toFixed(2);
        updatedPercs[id] = ((amountPerFloating / totalAmount) * 100).toFixed(2);
      });
    }

    // Final Penny/Overflow correction
    let currentTotalSum = 0;
    checkedArr.forEach((id) => {
      currentTotalSum += parseFloat(updatedAmts[id] || '0') || 0;
    });

    const diff = totalAmount - currentTotalSum;
    if (Math.abs(diff) > 0.001) {
      const targetId =
        floatingIds.length > 0
          ? floatingIds[floatingIds.length - 1]
          : checkedArr.find((id) => id !== sourceId);

      if (targetId !== undefined) {
        const oldVal = parseFloat(updatedAmts[targetId] || '0') || 0;
        let newVal = oldVal + diff;
        if (newVal < 0) newVal = 0;

        updatedAmts[targetId] = newVal.toFixed(2);
        updatedPercs[targetId] = ((newVal / totalAmount) * 100).toFixed(2);
      }
    }

    setRowAmounts(updatedAmts);
    setRowPercentages(updatedPercs);
  };

  const handlePercentageChange = (id: number, valStr: string) => {
    if (isUpdatingProgrammatically.current) return;
    const perc = parseFloat(valStr) || 0;
    const amt = totalAmount * (perc / 100.0);
    const updatedPercs = { ...rowPercentages, [id]: valStr };
    setRowPercentages(updatedPercs);
    distributeAmounts(id, amt, rowAmounts);
  };

  const handleRowAmountChange = (id: number, valStr: string) => {
    if (isUpdatingProgrammatically.current) return;
    const amt = parseFloat(valStr) || 0;
    distributeAmounts(id, amt, { ...rowAmounts, [id]: valStr });
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    const cleanName = itemName.trim();
    if (!cleanName) {
      setWarningMsg('Item name cannot be empty.');
      return;
    }
    if (totalAmount <= 0) {
      setWarningMsg('Invalid amount.');
      return;
    }
    if (!payerId) {
      setWarningMsg('Select a valid payer.');
      return;
    }
    if (checkedIds.size === 0) {
      setWarningMsg('Select at least one consumer.');
      return;
    }

    const consumerWeights: Array<{ contributorId: number; weight: number }> = [];

    if (isEqualSplit) {
      const share = totalAmount / checkedIds.size;
      checkedIds.forEach((id) => {
        consumerWeights.push({ contributorId: id, weight: share });
      });
    } else {
      let sumFromRows = 0;
      for (const id of checkedIds) {
        const w = parseFloat(rowAmounts[id] || '0') || 0;
        sumFromRows += w;
        consumerWeights.push({ contributorId: id, weight: w });
      }

      if (Math.abs(sumFromRows - totalAmount) > 0.01) {
        setWarningMsg(
          `The sum of individual amounts must equal the total amount. (Current sum: ₹${sumFromRows.toFixed(2)})`
        );
        return;
      }
    }

    onSave(cleanName, totalAmount, Number(payerId), consumerWeights, notes.trim() || null);
    onClose();
  };

  const dialogTitle =
    itemToEdit?.item.itemType === ITEM_TYPE.TYPE_CARRYOVER
      ? 'Edit Carried Balance'
      : itemToEdit
      ? 'Edit Expense'
      : 'Add Expense';

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm animate-fade-in overflow-y-auto">
      <div
        className="w-full max-w-lg max-h-[94vh] flex flex-col rounded-3xl bg-surface p-6 shadow-2xl border border-cardStroke animate-morph-in"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center justify-between pb-3 border-b border-cardStroke">
          <h2 className="text-xl font-bold text-textPrimary tracking-tight">{dialogTitle}</h2>
          <button
            type="button"
            onClick={onClose}
            className="p-1.5 rounded-full hover:bg-surfaceAlt text-textHint hover:text-textPrimary transition-colors"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Form */}
        <form onSubmit={handleSubmit} className="flex-1 overflow-y-auto mt-4 pr-1 space-y-4">
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div>
              <label className="text-xs font-bold uppercase tracking-wider text-textHint">
                Item Name *
              </label>
              <input
                type="text"
                value={itemName}
                onChange={(e) => {
                  setItemName(e.target.value);
                  setWarningMsg(null);
                }}
                placeholder="e.g. Dinner, Taxi, Groceries"
                className="mt-1.5 w-full px-4 py-2.5 rounded-2xl bg-surfaceAlt border border-cardStroke text-textPrimary placeholder:text-textHint text-sm focus:outline-none focus:ring-2 focus:ring-textPrimary"
                autoFocus
              />
            </div>

            <div>
              <label className="text-xs font-bold uppercase tracking-wider text-textHint">
                Total Amount (₹) *
              </label>
              <input
                type="number"
                step="0.01"
                min="0"
                value={totalAmountStr}
                onChange={(e) => {
                  setTotalAmountStr(e.target.value);
                  setWarningMsg(null);
                }}
                placeholder="0.00"
                className="mt-1.5 w-full px-4 py-2.5 rounded-2xl bg-surfaceAlt border border-cardStroke text-textPrimary placeholder:text-textHint text-sm font-semibold focus:outline-none focus:ring-2 focus:ring-textPrimary"
              />
            </div>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div>
              <label className="text-xs font-bold uppercase tracking-wider text-textHint">
                Paid By *
              </label>
              <select
                value={payerId}
                onChange={(e) => {
                  setPayerId(e.target.value ? Number(e.target.value) : '');
                  setWarningMsg(null);
                }}
                className="mt-1.5 w-full px-4 py-2.5 rounded-2xl bg-surfaceAlt border border-cardStroke text-textPrimary text-sm font-medium focus:outline-none focus:ring-2 focus:ring-textPrimary cursor-pointer"
              >
                <option value="">Paid By</option>
                {sortedContributors.map((c) => (
                  <option key={c.contributorID} value={c.contributorID}>
                    {c.contributorName}
                  </option>
                ))}
              </select>
            </div>

            <div>
              <label className="text-xs font-bold uppercase tracking-wider text-textHint">
                Notes (Optional)
              </label>
              <input
                type="text"
                value={notes}
                onChange={(e) => setNotes(e.target.value)}
                placeholder="Receipt info, tags..."
                className="mt-1.5 w-full px-4 py-2.5 rounded-2xl bg-surfaceAlt border border-cardStroke text-textPrimary placeholder:text-textHint text-sm focus:outline-none focus:ring-2 focus:ring-textPrimary"
              />
            </div>
          </div>

          {/* Split Mode Controls */}
          <div className="p-3.5 rounded-2xl bg-surfaceAlt border border-cardStroke flex items-center justify-between">
            <div className="flex items-center gap-3">
              <span className="text-sm font-bold text-textPrimary">Equal Split</span>
              <label className="relative inline-flex items-center cursor-pointer">
                <input
                  type="checkbox"
                  checked={isEqualSplit}
                  onChange={(e) => handleEqualSwitchChange(e.target.checked)}
                  className="sr-only peer"
                />
                <div className="w-11 h-6 bg-surfaceHigh peer-focus:outline-none rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-gray-300 after:border after:rounded-full after:h-5 after:w-5 after:transition-all peer-checked:bg-btnPrimaryBg"></div>
              </label>
            </div>

            <button
              type="button"
              onClick={handleSelectAllToggle}
              className="px-3 py-1.5 rounded-xl bg-surface hover:bg-surfaceHigh text-textPrimary text-xs font-semibold border border-cardStroke transition-colors"
            >
              {allSelected ? 'Deselect all' : 'Select all'}
            </button>
          </div>

          {/* Consumers Checkbox List */}
          <div className="space-y-2 max-h-52 overflow-y-auto pr-1">
            {sortedContributors.map((c) => {
              const isChecked = checkedIds.has(c.contributorID);
              const equalShare =
                isEqualSplit && checkedList.length > 0 && totalAmount > 0
                  ? (totalAmount / checkedList.length).toFixed(2)
                  : '0.00';

              return (
                <div
                  key={c.contributorID}
                  className={`flex items-center justify-between p-3 rounded-2xl border transition-all ${
                    isChecked
                      ? 'bg-surface border-textPrimary/20 shadow-sm'
                      : 'bg-surfaceAlt/60 border-cardStroke opacity-60'
                  }`}
                >
                  <label className="flex items-center gap-3 cursor-pointer flex-1">
                    <input
                      type="checkbox"
                      checked={isChecked}
                      onChange={() => handleCheckboxChange(c.contributorID)}
                      className="w-4 h-4 rounded text-btnPrimaryBg accent-textPrimary"
                    />
                    <span className="text-sm font-medium text-textPrimary truncate">
                      {c.contributorName}
                    </span>
                  </label>

                  {isChecked && (
                    <div className="flex items-center gap-2">
                      {isEqualSplit ? (
                        <span className="text-sm font-bold text-textPrimary">
                          ₹{equalShare}
                        </span>
                      ) : (
                        <div className="flex items-center gap-1.5">
                          <div className="flex items-center w-20 px-2 py-1 rounded-xl bg-surfaceAlt border border-cardStroke">
                            <input
                              type="number"
                              step="0.01"
                              value={rowPercentages[c.contributorID] ?? ''}
                              onChange={(e) =>
                                handlePercentageChange(c.contributorID, e.target.value)
                              }
                              placeholder="0"
                              className="w-full text-xs font-semibold bg-transparent text-right text-textPrimary focus:outline-none"
                            />
                            <span className="text-xs text-textHint ml-0.5">%</span>
                          </div>

                          <div className="flex items-center w-24 px-2 py-1 rounded-xl bg-surfaceAlt border border-cardStroke">
                            <span className="text-xs text-textHint mr-0.5">₹</span>
                            <input
                              type="number"
                              step="0.01"
                              value={rowAmounts[c.contributorID] ?? ''}
                              onChange={(e) =>
                                handleRowAmountChange(c.contributorID, e.target.value)
                              }
                              placeholder="0.00"
                              className="w-full text-xs font-semibold bg-transparent text-right text-textPrimary focus:outline-none"
                            />
                          </div>
                        </div>
                      )}
                    </div>
                  )}
                </div>
              );
            })}
          </div>

          {warningMsg && (
            <p className="text-xs font-semibold text-giveText animate-fade-in leading-relaxed">
              {warningMsg}
            </p>
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
              Done
            </button>
          </div>
        </form>
      </div>
    </div>
  );
};

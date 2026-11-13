import React, { useState, useEffect, useRef } from 'react';
import type { Contributor, ItemWithPayerAndConsumers, ItemConsumer } from '../types/models';
import { ITEM_TYPE } from '../types/models';
import { dbClient } from '../db/dbClient';
import { MaterialSwitch } from './MaterialSwitch';
import { useMorphPresence } from '../hooks/useMorphPresence';
import { CustomSelect } from './CustomSelect';

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

  const { shouldRender, isClosing } = useMorphPresence(isOpen, 180);

  // Initialize form state
  useEffect(() => {
    if (!isOpen) return;

    if (itemToEdit) {
      setItemName(itemToEdit.item.itemName);
      setTotalAmountStr(itemToEdit.item.amount > 0 ? itemToEdit.item.amount.toString() : '');
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

  // Main custom split auto-balancing algorithm (exact 1:1 match with Android SheetViewActivity.kt distributeAmounts)
  const distributeAmounts = (
    sourceId: number,
    sourceAmount: number,
    sourceValStr: string,
    isAmountSource: boolean,
    currentAmts: Record<number, string>,
    currentPercs: Record<number, string>
  ) => {
    if (totalAmount <= 0.001) return;

    manualEntries.current[sourceId] = true;

    const checkedArr = Array.from(checkedIds);
    let lockedIds = checkedArr.filter((id) => manualEntries.current[id]);
    let floatingIds = checkedArr.filter((id) => !manualEntries.current[id]);

    // NEW LOGIC from Android: If ALL are locked, unlock everyone else except current source (the new Anchor)
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
      const val = id === sourceId ? sourceAmount : parseFloat(currentAmts[id] || '0') || 0;
      sumLocked += val;
    });

    const remaining = totalAmount - sumLocked;

    // Build next amounts & percentages maps
    const updatedAmts: Record<number, string> = { ...currentAmts };
    const updatedPercs: Record<number, string> = { ...currentPercs };

    // For the source row: keep EXACT typed string without prematurely formatting to .toFixed(2)
    if (isAmountSource) {
      updatedAmts[sourceId] = sourceValStr;
      const perc = totalAmount > 0 ? (sourceAmount / totalAmount) * 100.0 : 0;
      updatedPercs[sourceId] = perc.toFixed(2);
    } else {
      updatedPercs[sourceId] = sourceValStr;
      updatedAmts[sourceId] = sourceAmount.toFixed(2);
    }

    if (floatingIds.length > 0) {
      let amountPerFloating = remaining / floatingIds.length;
      if (amountPerFloating < 0) amountPerFloating = 0;

      floatingIds.forEach((id) => {
        updatedAmts[id] = amountPerFloating.toFixed(2);
        const perc = totalAmount > 0 ? (amountPerFloating / totalAmount) * 100.0 : 0;
        updatedPercs[id] = perc.toFixed(2);
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
        const newPerc = totalAmount > 0 ? (newVal / totalAmount) * 100.0 : 0;
        updatedPercs[targetId] = newPerc.toFixed(2);
      }
    }

    setRowAmounts(updatedAmts);
    setRowPercentages(updatedPercs);
  };

  const handlePercentageChange = (id: number, valStr: string) => {
    if (isUpdatingProgrammatically.current) return;
    const perc = parseFloat(valStr) || 0;
    const amt = totalAmount * (perc / 100.0);
    distributeAmounts(id, amt, valStr, false, rowAmounts, rowPercentages);
  };

  const handleRowAmountChange = (id: number, valStr: string) => {
    if (isUpdatingProgrammatically.current) return;
    const amt = parseFloat(valStr) || 0;
    distributeAmounts(id, amt, valStr, true, rowAmounts, rowPercentages);
  };

  const handleRowAmountBlur = (id: number) => {
    const raw = rowAmounts[id];
    if (raw !== undefined && raw !== '') {
      const val = parseFloat(raw) || 0;
      setRowAmounts((prev) => ({ ...prev, [id]: val.toFixed(2) }));
    }
  };

  const handleRowPercentageBlur = (id: number) => {
    const raw = rowPercentages[id];
    if (raw !== undefined && raw !== '') {
      const val = parseFloat(raw) || 0;
      setRowPercentages((prev) => ({ ...prev, [id]: val.toFixed(2) }));
    }
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    const cleanName = itemName.trim();
    if (!cleanName) {
      setWarningMsg('Expense description cannot be empty.');
      return;
    }
    if (totalAmount <= 0) {
      setWarningMsg('Please enter a valid amount.');
      return;
    }
    if (!payerId) {
      setWarningMsg('Select who paid for this expense.');
      return;
    }
    if (checkedIds.size === 0) {
      setWarningMsg('Select at least one member to split with.');
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
          `Total of splits (₹${sumFromRows.toFixed(2)}) must equal ₹${totalAmount.toFixed(2)}`
        );
        return;
      }
    }

    onSave(cleanName, totalAmount, Number(payerId), consumerWeights, notes.trim() || null);
    onClose();
  };

  if (!shouldRender) return null;

  const dialogTitle =
    itemToEdit?.item.itemType === ITEM_TYPE.TYPE_CARRYOVER
      ? 'Edit Carried Balance'
      : itemToEdit
      ? 'Edit Expense'
      : 'Add Expense';

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
        className={`w-full max-w-[420px] flex flex-col rounded-2xl bg-surface p-5 sm:p-6 shadow-2xl border border-cardStroke m-auto ${
          isClosing ? 'animate-dialog-morph-exit' : 'animate-dialog-morph-enter'
        }`}
        style={{
          maxHeight: 'calc(var(--app-height, 100dvh) - 24px)',
        }}
        onClick={(e) => e.stopPropagation()}
      >
        {/* Android Title: Centered 19sp bold */}
        <h2 className="text-[19px] font-bold text-center text-textPrimary tracking-tight shrink-0">
          {dialogTitle}
        </h2>

        {/* Scrollable Form Content */}
        <form onSubmit={handleSubmit} className="flex-1 flex flex-col overflow-hidden mt-2">
          <div className="flex-1 overflow-y-auto px-1 py-1 space-y-3.5">
          {/* Amount Section matching Android et_amount */}
          <div className="flex flex-col items-center pt-2">
            <span className="text-[11px] font-bold tracking-[0.12em] text-textHint uppercase">
              AMOUNT
            </span>
            <div className="w-full flex items-center justify-center mt-1">
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
                className="w-full text-center text-[40px] font-bold bg-transparent text-textPrimary placeholder:text-textHint outline-none border-none py-1 leading-none tracking-tight focus:outline-none focus:ring-0"
                autoFocus={!itemToEdit}
              />
            </div>
          </div>

          {/* Description Input matching et_item_name */}
          <div>
            <input
              type="text"
              value={itemName}
              onChange={(e) => {
                setItemName(e.target.value);
                setWarningMsg(null);
              }}
              placeholder="Expense description"
              className="w-full h-[50px] px-3.5 rounded-xl bg-surfaceAlt border border-cardStroke text-textPrimary placeholder:text-textHint text-[15px] focus:outline-none focus:border-textPrimary focus:ring-0 transition-colors"
            />
          </div>

          {/* Payer Custom Select matching Android theme */}
          <div>
            <CustomSelect
              value={payerId}
              placeholder="Paid By"
              options={sortedContributors.map((c) => ({
                value: c.contributorID,
                label: c.contributorName,
              }))}
              onChange={(val) => {
                setPayerId(val ? Number(val) : '');
                setWarningMsg(null);
              }}
            />
          </div>

          {/* Notes Input matching et_notes */}
          <div>
            <textarea
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              placeholder="Add a note (optional)..."
              rows={2}
              className="w-full min-h-[64px] p-3.5 rounded-xl bg-surfaceAlt border border-cardStroke text-textPrimary placeholder:text-textHint text-sm resize-none focus:outline-none focus:border-textPrimary focus:ring-0 leading-normal transition-colors"
            />
          </div>

          {/* Split Mode Header Row matching splitHeaderRow */}
          <div className="flex items-center justify-between pt-1">
            <span className="text-[11px] font-bold tracking-[0.08em] text-textHint uppercase flex-1 truncate mr-2">
              SPLIT BETWEEN
            </span>

            <div className="flex items-center gap-2.5 shrink-0">
              <button
                type="button"
                onClick={handleSelectAllToggle}
                className="h-[32px] px-2.5 rounded-[10px] bg-surfaceAlt hover:bg-surfaceHigh text-textPrimary text-xs font-semibold border border-cardStroke transition-colors"
              >
                {allSelected ? 'Deselect all' : 'Select all'}
              </button>

              <span className="text-sm font-medium text-textPrimary">Equal</span>

              <MaterialSwitch
                checked={isEqualSplit}
                onChange={handleEqualSwitchChange}
                aria-label="Equal Split"
              />
            </div>
          </div>

          {/* Contributors List matching contributorsScrollWrapper & contributor_percentage_item.xml */}
          <div className="space-y-1.5 max-h-[190px] overflow-y-auto pr-0.5">
            {sortedContributors.map((c) => {
              const isChecked = checkedIds.has(c.contributorID);
              const equalShare =
                isEqualSplit && checkedList.length > 0 && totalAmount > 0
                  ? (totalAmount / checkedList.length).toFixed(2)
                  : '0.00';

              return (
                <div
                  key={c.contributorID}
                  className="flex items-center justify-between px-3 py-2 rounded-[10px] bg-surfaceAlt transition-colors gap-2"
                >
                  <label className="flex items-center gap-2.5 cursor-pointer flex-1 min-w-0 py-0.5 select-none">
                    <input
                      type="checkbox"
                      checked={isChecked}
                      onChange={() => handleCheckboxChange(c.contributorID)}
                      className="w-4 h-4 rounded text-btnPrimaryBg accent-btnPrimaryBg cursor-pointer shrink-0"
                    />
                    <span className="text-[15px] font-bold text-textPrimary truncate">
                      {c.contributorName}
                    </span>
                  </label>

                  {isChecked && (
                    <div className="flex items-center gap-1.5 shrink-0">
                      {isEqualSplit ? (
                        <span className="text-sm font-bold text-textPrimary pr-1">
                          ₹{equalShare}
                        </span>
                      ) : (
                        <div className="flex items-center gap-1.5">
                          {/* Percentage Input matching et_percentage */}
                          <input
                            type="number"
                            step="0.01"
                            value={rowPercentages[c.contributorID] ?? ''}
                            onChange={(e) =>
                              handlePercentageChange(c.contributorID, e.target.value)
                            }
                            onFocus={(e) => {
                              e.target.select();
                              e.target.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
                            }}
                            onClick={(e) => (e.target as HTMLInputElement).select()}
                            onBlur={() => handleRowPercentageBlur(c.contributorID)}
                            placeholder="%"
                            className="w-[70px] h-[32px] px-1 rounded-lg bg-surface border border-cardStroke text-center text-xs font-bold text-textPrimary placeholder:text-textHint focus:outline-none focus:border-textPrimary focus:ring-0"
                          />

                          {/* Amount Input matching et_amount */}
                          <input
                            type="number"
                            step="0.01"
                            value={rowAmounts[c.contributorID] ?? ''}
                            onChange={(e) =>
                              handleRowAmountChange(c.contributorID, e.target.value)
                            }
                            onFocus={(e) => {
                              e.target.select();
                              e.target.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
                            }}
                            onClick={(e) => (e.target as HTMLInputElement).select()}
                            onBlur={() => handleRowAmountBlur(c.contributorID)}
                            placeholder="amount"
                            className="w-[84px] h-[32px] px-1 rounded-lg bg-surface border border-cardStroke text-center text-xs font-bold text-textPrimary placeholder:text-textHint focus:outline-none focus:border-textPrimary focus:ring-0"
                          />
                        </div>
                      )}
                    </div>
                  )}
                </div>
              );
            })}
          </div>

          {warningMsg && (
            <p className="text-xs font-semibold text-giveText leading-relaxed">
              {warningMsg}
            </p>
          )}
          </div>

          {/* Bottom Action Buttons matching expenseActionButtons pinned at bottom of card */}
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

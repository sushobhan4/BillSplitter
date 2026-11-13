import React, { useState, useRef, useEffect } from 'react';
import { X, Trash2 } from 'lucide-react';
import type { SheetWithContributorsAndItems } from '../types/models';
import { ConfirmDialog } from './ConfirmDialog';
import { formatCurrency } from '../utils/formatters';
import { useMorphPresence } from '../hooks/useMorphPresence';

interface ContributorRow {
  tempId: number;
  originalId: number; // 0 or negative for newly added, > 0 for existing
  name: string;
  carryoverBalance: number;
}

interface AddEditSheetDialogProps {
  isOpen: boolean;
  itemToEdit: SheetWithContributorsAndItems | null;
  cloneSource?: SheetWithContributorsAndItems | null;
  carryoverBalances?: Array<{ id: number; name: string; balance: number }> | null;
  onSave: (
    sheetName: string,
    notes: string | null,
    contributorsToSave: Array<{ id: number; name: string; carryoverBalance: number }>
  ) => void;
  onClose: () => void;
}

export const AddEditSheetDialog: React.FC<AddEditSheetDialogProps> = ({
  isOpen,
  itemToEdit,
  cloneSource,
  carryoverBalances,
  onSave,
  onClose,
}) => {
  const nextIdRef = useRef(-1);

  const getInitialRows = (): ContributorRow[] => {
    nextIdRef.current = -1;
    if (itemToEdit) {
      const editRows = itemToEdit.contributors.map((c) => ({
        tempId: c.contributorID,
        originalId: c.contributorID,
        name: c.contributorName,
        carryoverBalance: 0,
      }));
      while (editRows.length < 2) {
        editRows.push({
          tempId: nextIdRef.current--,
          originalId: 0,
          name: '',
          carryoverBalance: 0,
        });
      }
      return editRows;
    }

    if (cloneSource) {
      if (carryoverBalances && carryoverBalances.length > 0) {
        const rows = carryoverBalances.map((cb) => ({
          tempId: nextIdRef.current--,
          originalId: 0,
          name: cb.name,
          carryoverBalance: cb.balance,
        }));
        while (rows.length < 2) {
          rows.push({
            tempId: nextIdRef.current--,
            originalId: 0,
            name: '',
            carryoverBalance: 0,
          });
        }
        return rows;
      }

      const rows = cloneSource.contributors.map((c) => ({
        tempId: nextIdRef.current--,
        originalId: 0,
        name: c.contributorName,
        carryoverBalance: 0,
      }));
      while (rows.length < 2) {
        rows.push({
          tempId: nextIdRef.current--,
          originalId: 0,
          name: '',
          carryoverBalance: 0,
        });
      }
      return rows;
    }

    // Fresh new sheet: start with 2 empty rows
    return [
      { tempId: nextIdRef.current--, originalId: 0, name: '', carryoverBalance: 0 },
      { tempId: nextIdRef.current--, originalId: 0, name: '', carryoverBalance: 0 },
    ];
  };

  const [sheetName, setSheetName] = useState(
    itemToEdit?.sheet.sheetName || cloneSource?.sheet.sheetName || ''
  );
  const [sheetNotes, setSheetNotes] = useState(
    itemToEdit?.sheet.notes || cloneSource?.sheet.notes || ''
  );
  const [rows, setRows] = useState<ContributorRow[]>(getInitialRows);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  // Confirm delete states
  const [pendingDeleteRow, setPendingDeleteRow] = useState<ContributorRow | null>(null);
  const [deleteConfirmInfo, setDeleteConfirmInfo] = useState<{
    title: string;
    message: string;
  } | null>(null);

  const { shouldRender, isClosing } = useMorphPresence(isOpen, 180);

  useEffect(() => {
    if (!isOpen) return;

    setSheetName(itemToEdit?.sheet.sheetName || cloneSource?.sheet.sheetName || '');
    setSheetNotes(itemToEdit?.sheet.notes || cloneSource?.sheet.notes || '');
    setRows(getInitialRows());
    setErrorMsg(null);
    setPendingDeleteRow(null);
    setDeleteConfirmInfo(null);
  }, [isOpen, itemToEdit, cloneSource, carryoverBalances]);

  if (!shouldRender) return null;

  const isEditing = Boolean(itemToEdit);

  const handleAddRow = () => {
    setRows((prev) => [
      ...prev,
      {
        tempId: nextIdRef.current--,
        originalId: 0,
        name: '',
        carryoverBalance: 0,
      },
    ]);
  };

  const handleRowNameChange = (tempId: number, val: string) => {
    setRows((prev) =>
      prev.map((r) => (r.tempId === tempId ? { ...r, name: val } : r))
    );
    setErrorMsg(null);
  };

  const requestRemoveRow = (row: ContributorRow) => {
    // If cloned with carryover and non-zero balance
    if (Math.abs(row.carryoverBalance) >= 0.005) {
      setPendingDeleteRow(row);
      setDeleteConfirmInfo({
        title: 'Drop carried balance?',
        message: `${row.name || 'This member'} has an unsettled balance of ₹${Math.abs(
          row.carryoverBalance
        ).toFixed(2)}. Dropping them will exclude their balance from the cloned sheet.`,
      });
      return;
    }

    // If editing and existing member
    if (isEditing && row.originalId > 0 && row.name.trim().length > 0) {
      setPendingDeleteRow(row);
      setDeleteConfirmInfo({
        title: 'Remove member?',
        message: `Are you sure you want to remove "${row.name}" from this sheet?`,
      });
      return;
    }

    // Otherwise remove directly
    setRows((prev) => prev.filter((r) => r.tempId !== row.tempId));
  };

  const confirmRemoveRow = () => {
    if (pendingDeleteRow) {
      setRows((prev) => prev.filter((r) => r.tempId !== pendingDeleteRow.tempId));
      setPendingDeleteRow(null);
      setDeleteConfirmInfo(null);
    }
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    const cleanSheetName = sheetName.trim();
    if (!cleanSheetName) {
      setErrorMsg('Sheet name cannot be empty.');
      return;
    }

    // Extract valid contributors
    const validContributors = rows
      .map((r) => ({
        id: r.originalId,
        name: r.name.trim(),
        carryoverBalance: r.carryoverBalance,
      }))
      .filter((r) => r.name.length > 0);

    if (validContributors.length < 2) {
      setErrorMsg('A sheet requires at least 2 members with non-empty names.');
      return;
    }

    // Case-insensitive uniqueness check
    const nameSet = new Set<string>();
    for (const c of validContributors) {
      const lower = c.name.toLowerCase();
      if (nameSet.has(lower)) {
        setErrorMsg(`Member "${c.name}" is duplicated. Member names must be unique.`);
        return;
      }
      nameSet.add(lower);
    }

    onSave(cleanSheetName, sheetNotes.trim() || null, validContributors);
    onClose();
  };

  return (
    <>
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
          {/* Header matching add_sheet.xml */}
          <div className="flex items-center justify-between pb-3 shrink-0">
            <h2 className="text-[20px] font-bold text-textPrimary tracking-tight">
              {isEditing ? 'Edit Sheet' : 'Create Sheet'}
            </h2>
            <button
              type="button"
              onClick={onClose}
              className="w-8 h-8 rounded-full flex items-center justify-center text-textHint hover:text-textPrimary transition-colors"
            >
              <X className="w-5 h-5" />
            </button>
          </div>

          {/* Form */}
          <form onSubmit={handleSubmit} className="flex-1 flex flex-col overflow-hidden mt-1">
            <div className="flex-1 overflow-y-auto px-1 py-1 space-y-3.5">
              <div>
                <input
                  type="text"
                  value={sheetName}
                  onChange={(e) => {
                    setSheetName(e.target.value);
                    setErrorMsg(null);
                  }}
                  onFocus={(e) => e.target.scrollIntoView({ block: 'nearest', behavior: 'smooth' })}
                  placeholder="Sheet Name"
                  className="w-full h-[52px] px-3.5 rounded-xl bg-surfaceAlt border border-cardStroke text-textPrimary placeholder:text-textHint text-base focus:outline-none focus:border-textPrimary focus:ring-0 transition-colors"
                  autoFocus={!isEditing}
                />
              </div>

              <div>
                <textarea
                  value={sheetNotes}
                  onChange={(e) => setSheetNotes(e.target.value)}
                  onFocus={(e) => e.target.scrollIntoView({ block: 'nearest', behavior: 'smooth' })}
                  placeholder="Description (Optional)"
                  rows={2}
                  className="w-full min-h-[64px] p-3.5 rounded-xl bg-surfaceAlt border border-cardStroke text-textPrimary placeholder:text-textHint text-sm resize-none focus:outline-none focus:border-textPrimary focus:ring-0 leading-normal transition-colors"
                />
              </div>

              {/* Contributors Section */}
              <div>
                <span className="text-[11px] font-bold tracking-[0.12em] text-textHint uppercase block mb-2">
                  CONTRIBUTORS
                </span>

                <div className="space-y-2 max-h-[180px] overflow-y-auto px-0.5 py-0.5">
                  {rows.map((row) => (
                    <div key={row.tempId} className="flex items-center gap-2">
                      <div className="flex-1 flex items-center h-[48px] px-3.5 rounded-xl bg-surfaceAlt border border-cardStroke focus-within:border-textPrimary focus-within:ring-0 transition-colors">
                        <input
                          type="text"
                          value={row.name}
                          onChange={(e) => handleRowNameChange(row.tempId, e.target.value)}
                          onFocus={(e) => e.target.scrollIntoView({ block: 'nearest', behavior: 'smooth' })}
                          placeholder={`Name`}
                          className="flex-1 bg-transparent text-textPrimary placeholder:text-textHint text-[15px] focus:outline-none focus:ring-0 min-w-0"
                        />
                        {Math.abs(row.carryoverBalance) >= 0.005 && (
                          <span
                            className={`shrink-0 ml-2 text-xs font-bold ${
                              row.carryoverBalance > 0 ? 'text-receiveText' : 'text-giveText'
                            }`}
                          >
                            {row.carryoverBalance > 0 ? '+' : ''}
                            {formatCurrency(row.carryoverBalance)}
                          </span>
                        )}
                      </div>

                      {/* Delete button (red trash) matching item_contributor.xml */}
                      {rows.length > 2 && (
                        <button
                          type="button"
                          onClick={() => requestRemoveRow(row)}
                          className="w-10 h-10 rounded-xl flex items-center justify-center text-giveText hover:bg-giveText/10 transition-colors shrink-0"
                          title="Delete Contributor"
                        >
                          <Trash2 className="w-5 h-5" />
                        </button>
                      )}
                    </div>
                  ))}
                </div>
              </div>

              {errorMsg && (
                <p className="text-xs font-semibold text-giveText leading-relaxed pt-1">
                  {errorMsg}
                </p>
              )}
            </div>

            {/* Bottom Buttons matching layoutButtons in add_sheet.xml pinned at bottom of card */}
            <div className="shrink-0 pt-3 flex gap-3">
              <button
                type="button"
                onClick={handleAddRow}
                className="flex-1 h-[48px] rounded-xl text-sm font-bold text-textPrimary bg-surfaceAlt hover:bg-surfaceHigh border border-cardStroke transition-colors"
              >
                + Add Person
              </button>
              <button
                type="submit"
                className="flex-1 h-[48px] rounded-xl text-sm font-bold text-btnPrimaryText bg-btnPrimaryBg hover:opacity-90 transition-opacity"
              >
                {isEditing ? 'Save' : 'Create'}
              </button>
            </div>
          </form>
        </div>
      </div>

      <ConfirmDialog
        isOpen={Boolean(deleteConfirmInfo)}
        title={deleteConfirmInfo?.title || ''}
        message={deleteConfirmInfo?.message || ''}
        confirmText="Remove"
        onConfirm={confirmRemoveRow}
        onCancel={() => {
          setPendingDeleteRow(null);
          setDeleteConfirmInfo(null);
        }}
      />
    </>
  );
};

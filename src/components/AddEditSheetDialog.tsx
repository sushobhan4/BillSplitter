import React, { useState, useRef } from 'react';
import { X, Plus, Trash2 } from 'lucide-react';
import type { SheetWithContributorsAndItems } from '../types/models';
import { ConfirmDialog } from './ConfirmDialog';
import { formatCurrency } from '../utils/formatters';

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
    if (itemToEdit) {
      return itemToEdit.contributors.map((c) => ({
        tempId: c.contributorID,
        originalId: c.contributorID,
        name: c.contributorName,
        carryoverBalance: 0,
      }));
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

  if (!isOpen) return null;

  const isEditing = Boolean(itemToEdit);

  const handleAddRow = () => {
    setRows((prev) => [
      ...prev,
      { tempId: nextIdRef.current--, originalId: 0, name: '', carryoverBalance: 0 },
    ]);
  };

  const handleRowNameChange = (tempId: number, val: string) => {
    setRows((prev) =>
      prev.map((r) => (r.tempId === tempId ? { ...r, name: val } : r))
    );
    setErrorMsg(null);
  };

  const requestRemoveRow = (row: ContributorRow) => {
    const trimmedName = row.name.trim();

    if (Math.abs(row.carryoverBalance) >= 0.005) {
      const formatted = formatCurrency(Math.abs(row.carryoverBalance));
      const displayName = trimmedName || 'This member';
      const msg =
        row.carryoverBalance > 0
          ? `${displayName} will receive ${formatted} from the previous sheet. Deleting them will drop their carried-over balance.`
          : `${displayName} owes ${formatted} from the previous sheet. Deleting them will drop their carried-over balance.`;
      setPendingDeleteRow(row);
      setDeleteConfirmInfo({ title: 'Drop carried balance?', message: msg });
      return;
    }

    if (row.originalId > 0 || trimmedName.length > 0) {
      const displayName = trimmedName || 'this member';
      setPendingDeleteRow(row);
      setDeleteConfirmInfo({
        title: 'Remove member?',
        message: `Are you sure you want to remove "${displayName}" from this sheet?`,
      });
      return;
    }

    // Empty unsaved row: remove directly
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
    const cleanName = sheetName.trim();
    if (!cleanName) {
      setErrorMsg('Enter sheet name');
      return;
    }

    const validRows: Array<{ id: number; name: string; carryoverBalance: number }> = [];
    const nameSet = new Set<string>();

    for (const r of rows) {
      const trimmed = r.name.trim();
      if (!trimmed) {
        setErrorMsg('All member names are required');
        return;
      }
      const lower = trimmed.toLowerCase();
      if (nameSet.has(lower)) {
        setErrorMsg('Contributor names must be unique.');
        return;
      }
      nameSet.add(lower);
      validRows.push({
        id: r.originalId,
        name: trimmed,
        carryoverBalance: r.carryoverBalance,
      });
    }

    if (validRows.length < 2) {
      setErrorMsg('Need at least 2 valid contributors');
      return;
    }

    onSave(cleanName, sheetNotes.trim() || null, validRows);
    onClose();
  };

  return (
    <>
      <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm animate-fade-in overflow-y-auto">
        <div
          className="w-full max-w-md max-h-[92vh] flex flex-col rounded-3xl bg-surface p-6 shadow-2xl border border-cardStroke animate-morph-in"
          onClick={(e) => e.stopPropagation()}
        >
          {/* Header */}
          <div className="flex items-center justify-between pb-4 border-b border-cardStroke">
            <h2 className="text-xl font-bold text-textPrimary tracking-tight">
              {isEditing ? 'Edit Sheet' : 'Create Sheet'}
            </h2>
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
            <div>
              <label className="text-xs font-bold uppercase tracking-wider text-textHint">
                Sheet Name *
              </label>
              <input
                type="text"
                value={sheetName}
                onChange={(e) => {
                  setSheetName(e.target.value);
                  setErrorMsg(null);
                }}
                placeholder="e.g. Goa Trip, Flat 402"
                className="mt-1.5 w-full px-4 py-3 rounded-2xl bg-surfaceAlt border border-cardStroke text-textPrimary placeholder:text-textHint text-sm focus:outline-none focus:ring-2 focus:ring-textPrimary"
                autoFocus
              />
            </div>

            <div>
              <label className="text-xs font-bold uppercase tracking-wider text-textHint">
                Notes (Optional)
              </label>
              <textarea
                value={sheetNotes}
                onChange={(e) => setSheetNotes(e.target.value)}
                placeholder="Add any details, notes or guidelines..."
                rows={2}
                className="mt-1.5 w-full px-4 py-2.5 rounded-2xl bg-surfaceAlt border border-cardStroke text-textPrimary placeholder:text-textHint text-sm focus:outline-none focus:ring-2 focus:ring-textPrimary resize-none"
              />
            </div>

            {/* Contributors Section */}
            <div>
              <div className="flex items-center justify-between mb-2">
                <label className="text-xs font-bold uppercase tracking-wider text-textHint">
                  Members (Min 2) *
                </label>
                <button
                  type="button"
                  onClick={handleAddRow}
                  className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-surfaceAlt hover:bg-surfaceHigh text-textPrimary text-xs font-semibold transition-colors"
                >
                  <Plus className="w-3.5 h-3.5" />
                  Add Member
                </button>
              </div>

              <div className="space-y-2 max-h-56 overflow-y-auto pr-1">
                {rows.map((row, index) => (
                  <div key={row.tempId} className="flex items-center gap-2">
                    <div className="flex-1 relative">
                      <input
                        type="text"
                        value={row.name}
                        onChange={(e) => handleRowNameChange(row.tempId, e.target.value)}
                        placeholder={`Member ${index + 1}`}
                        className="w-full px-4 py-2.5 rounded-2xl bg-surfaceAlt border border-cardStroke text-textPrimary placeholder:text-textHint text-sm focus:outline-none focus:ring-2 focus:ring-textPrimary"
                      />
                      {Math.abs(row.carryoverBalance) >= 0.005 && (
                        <span
                          className={`absolute right-3 top-1/2 -translate-y-1/2 text-xs font-semibold ${
                            row.carryoverBalance > 0 ? 'text-receiveText' : 'text-giveText'
                          }`}
                        >
                          {row.carryoverBalance > 0 ? '+' : ''}
                          {formatCurrency(row.carryoverBalance)}
                        </span>
                      )}
                    </div>
                    {/* Delete button only visible when rows.length > 2 */}
                    {rows.length > 2 && (
                      <button
                        type="button"
                        onClick={() => requestRemoveRow(row)}
                        className="p-2.5 rounded-xl hover:bg-giveText/10 text-textHint hover:text-giveText transition-colors"
                        title="Remove member"
                      >
                        <Trash2 className="w-4 h-4" />
                      </button>
                    )}
                  </div>
                ))}
              </div>
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
                {isEditing ? 'Save' : 'Create Sheet'}
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

import React, { useState, useMemo, useRef } from 'react';
import {
  ArrowLeft,
  ArrowUpDown,
  Search,
  X,
  Plus,
  MoreVertical,
  ArrowRightLeft,
  Receipt,
  Pencil,
  Info,
  Trash2,
  ChevronDown,
} from 'lucide-react';
import { useSheetDetails } from '../hooks/useSheetDetails';
import { dbClient } from '../db/dbClient';
import { formatCurrency, formatExpenseDate } from '../utils/formatters';
import type { ItemWithPayerAndConsumers } from '../types/models';
import { ITEM_TYPE } from '../types/models';
import { BalanceCalculator } from '../utils/BalanceCalculator';

import { SortExpenseDialog, type ExpenseSortBy, type SortOrder } from '../components/SortExpenseDialog';
import { AddEditExpenseDialog } from '../components/AddEditExpenseDialog';
import { MoneyTransferDialog } from '../components/MoneyTransferDialog';
import { ExpenseDetailsDialog } from '../components/ExpenseDetailsDialog';
import { BalancesDialog } from '../components/BalancesDialog';
import { ConfirmDialog } from '../components/ConfirmDialog';
import { useMorphPresence } from '../hooks/useMorphPresence';

interface SheetViewPageProps {
  sheetId: number;
  onBack: () => void;
}

const ExpenseCardMenu: React.FC<{
  isOpen: boolean;
  isReadOnly: boolean;
  onEdit: () => void;
  onDetails: () => void;
  onDelete: () => void;
}> = ({ isOpen, isReadOnly, onEdit, onDetails, onDelete }) => {
  const { shouldRender, isClosing } = useMorphPresence(isOpen, 150);
  if (!shouldRender) return null;

  return (
    <div
      className={`absolute right-4 top-12 z-30 w-36 rounded-2xl bg-surface py-1.5 shadow-xl border border-cardStroke origin-top-right ${
        isClosing ? 'animate-popup-morph-exit' : 'animate-popup-morph-enter'
      }`}
      onClick={(e) => e.stopPropagation()}
    >
      {!isReadOnly && (
        <button
          type="button"
          onClick={onEdit}
          className="w-full text-left px-3.5 py-2.5 text-xs font-semibold text-textPrimary hover:bg-surfaceAlt flex items-center gap-2.5 transition-colors"
        >
          <Pencil className="w-3.5 h-3.5 text-textSecondary" />
          <span>Edit</span>
        </button>
      )}

      {!isReadOnly && <div className="border-t border-cardStroke" />}

      <button
        type="button"
        onClick={onDetails}
        className="w-full text-left px-3.5 py-2.5 text-xs font-semibold text-textPrimary hover:bg-surfaceAlt flex items-center gap-2.5 transition-colors"
      >
        <Info className="w-3.5 h-3.5 text-textSecondary" />
        <span>Details</span>
      </button>

      {!isReadOnly && (
        <>
          <div className="border-t border-cardStroke" />
          <button
            type="button"
            onClick={onDelete}
            className="w-full text-left px-3.5 py-2.5 text-xs font-semibold text-giveText hover:bg-giveText/10 flex items-center gap-2.5 transition-colors"
          >
            <Trash2 className="w-3.5 h-3.5 text-giveText" />
            <span>Delete</span>
          </button>
        </>
      )}
    </div>
  );
};

const AddExpenseOptionsPopover: React.FC<{
  isOpen: boolean;
  onAddExpense: () => void;
  onMoneyTransfer: () => void;
}> = ({ isOpen, onAddExpense, onMoneyTransfer }) => {
  const { shouldRender, isClosing } = useMorphPresence(isOpen, 150);
  if (!shouldRender) return null;

  return (
    <div
      className={`absolute bottom-16 right-0 w-48 rounded-2xl bg-surface py-1.5 shadow-2xl border border-cardStroke origin-bottom-right mb-2 z-40 ${
        isClosing ? 'animate-popup-morph-exit' : 'animate-popup-morph-enter'
      }`}
      onClick={(e) => e.stopPropagation()}
    >
      <button
        type="button"
        onClick={(e) => {
          e.stopPropagation();
          onAddExpense();
        }}
        className="w-full text-left px-4 py-3 text-sm font-semibold text-textPrimary hover:bg-surfaceAlt flex items-center gap-3 transition-colors"
      >
        <Receipt className="w-4 h-4 text-textSecondary" />
        <span>Add Expense</span>
      </button>

      <div className="border-t border-cardStroke" />

      <button
        type="button"
        onClick={(e) => {
          e.stopPropagation();
          onMoneyTransfer();
        }}
        className="w-full text-left px-4 py-3 text-sm font-semibold text-textPrimary hover:bg-surfaceAlt flex items-center gap-3 transition-colors"
      >
        <ArrowRightLeft className="w-4 h-4 text-textSecondary" />
        <span>Money Transfer</span>
      </button>
    </div>
  );
};

export const SheetViewPage: React.FC<SheetViewPageProps> = ({ sheetId, onBack }) => {
  const { sheet, contributors, itemsWithDetails, totalSpent, loading } = useSheetDetails(sheetId);

  // Search & Sorting
  const [searchQuery, setSearchQuery] = useState('');
  const [sortBy, setSortBy] = useState<ExpenseSortBy>(() => {
    return (
      (localStorage.getItem(`BillSplitterPrefs_Sheet_${sheetId}_sortBy`) as ExpenseSortBy) ||
      'dateModified'
    );
  });
  const [sortOrder, setSortOrder] = useState<SortOrder>(() => {
    return (
      (localStorage.getItem(`BillSplitterPrefs_Sheet_${sheetId}_sortOrder`) as SortOrder) ||
      'desc'
    );
  });

  // Dialog states
  const [isSortOpen, setIsSortOpen] = useState(false);
  const [isAddExpenseOpen, setIsAddExpenseOpen] = useState(false);
  const [isMoneyTransferOpen, setIsMoneyTransferOpen] = useState(false);
  const [isBalancesOpen, setIsBalancesOpen] = useState(false);
  const [editingItem, setEditingItem] = useState<ItemWithPayerAndConsumers | null>(null);
  const [detailsItem, setDetailsItem] = useState<ItemWithPayerAndConsumers | null>(null);
  const [deletingItem, setDeletingItem] = useState<ItemWithPayerAndConsumers | null>(null);

  // Menu popup
  const [activeMenuItemId, setActiveMenuItemId] = useState<number | null>(null);
  const [isAddOptionsOpen, setIsAddOptionsOpen] = useState(false);

  // Long press handling for + Add Expense button
  const longPressTimer = useRef<number | null>(null);
  const didLongPressRef = useRef(false);

  const isReadOnly = Boolean(sheet?.isReadOnly);

  // Filter & Sort
  const filteredAndSortedItems = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    let list = itemsWithDetails;

    if (q) {
      list = list.filter((it) => {
        return (
          it.item.itemName.toLowerCase().includes(q) ||
          Boolean(it.item.notes?.toLowerCase().includes(q)) ||
          it.payer.contributorName.toLowerCase().includes(q) ||
          it.consumers.some((c) => c.contributorName.toLowerCase().includes(q)) ||
          it.item.amount.toFixed(2).includes(q)
        );
      });
    }

    return [...list].sort((a, b) => {
      let cmp = 0;
      switch (sortBy) {
        case 'name':
          cmp = a.item.itemName.toLowerCase().localeCompare(b.item.itemName.toLowerCase());
          break;
        case 'amount':
          cmp = a.item.amount - b.item.amount;
          break;
        case 'dateCreated':
          cmp = a.item.dateCreated - b.item.dateCreated;
          break;
        case 'dateModified':
        default:
          cmp = a.item.dateModified - b.item.dateModified;
          break;
      }
      return sortOrder === 'asc' ? cmp : -cmp;
    });
  }, [itemsWithDetails, searchQuery, sortBy, sortOrder]);

  const handleApplySort = (newSortBy: ExpenseSortBy, newSortOrder: SortOrder) => {
    setSortBy(newSortBy);
    setSortOrder(newSortOrder);
    localStorage.setItem(`BillSplitterPrefs_Sheet_${sheetId}_sortBy`, newSortBy);
    localStorage.setItem(`BillSplitterPrefs_Sheet_${sheetId}_sortOrder`, newSortOrder);
  };

  // Balance calculation map for BalancesDialog
  const currentBalancesMap = useMemo(() => {
    const balances: Record<string, number> = {};
    contributors.forEach((c) => (balances[c.contributorName] = 0.0));

    // Flat consumer list
    const allConsumers: Array<{ itemID: number; contributorID: number; weight: number }> = [];
    itemsWithDetails.forEach((it) => {
      it.consumers.forEach((c) => {
        const share = it.consumers.length > 0 ? it.item.amount / it.consumers.length : 0;
        allConsumers.push({
          itemID: it.item.itemID,
          contributorID: c.contributorID,
          weight: share,
        });
      });
    });

    const netMap = BalanceCalculator.calculateNetBalancesById(
      contributors,
      itemsWithDetails.map((it) => it.item),
      allConsumers
    );

    // Remap ID to Name
    const contributorIdMap = new Map<number, string>();
    contributors.forEach((c) => contributorIdMap.set(c.contributorID, c.contributorName));

    netMap.forEach((bal, id) => {
      const name = contributorIdMap.get(id);
      if (name) balances[name] = bal;
    });

    return balances;
  }, [contributors, itemsWithDetails]);

  // Actions
  const handleSaveExpense = async (
    name: string,
    amount: number,
    payerId: number,
    weights: Array<{ contributorId: number; weight: number }>,
    notes: string | null
  ) => {
    if (editingItem) {
      await dbClient.updateItem(
        sheetId,
        editingItem.item.itemID,
        name,
        amount,
        payerId,
        weights,
        notes
      );
      setEditingItem(null);
    } else {
      await dbClient.insertItem(
        sheetId,
        name,
        amount,
        payerId,
        Date.now(),
        weights,
        notes,
        ITEM_TYPE.TYPE_EXPENSE
      );
    }
  };

  const handleSaveMoneyTransfer = async (
    fromId: number,
    toId: number,
    amount: number,
    itemType: typeof ITEM_TYPE.TYPE_MONEY_TRANSFER | typeof ITEM_TYPE.TYPE_SETTLEMENT
  ) => {
    const fromName = contributors.find((c) => c.contributorID === fromId)?.contributorName || 'Sender';
    const toName = contributors.find((c) => c.contributorID === toId)?.contributorName || 'Receiver';

    const itemName =
      itemType === ITEM_TYPE.TYPE_SETTLEMENT
        ? `${fromName} paid ${toName}`
        : `${fromName} → ${toName}`;

    const notes = itemType === ITEM_TYPE.TYPE_SETTLEMENT ? 'Recorded settlement' : 'Direct transfer';

    if (editingItem) {
      await dbClient.updateItem(
        sheetId,
        editingItem.item.itemID,
        itemName,
        amount,
        fromId,
        [{ contributorId: toId, weight: amount }],
        notes
      );
      setEditingItem(null);
    } else {
      await dbClient.insertItem(
        sheetId,
        itemName,
        amount,
        fromId,
        Date.now(),
        [{ contributorId: toId, weight: amount }],
        notes,
        itemType
      );
    }
  };

  const handleDeleteItemConfirm = async () => {
    if (deletingItem) {
      await dbClient.deleteItem(sheetId, deletingItem.item.itemID);
      setDeletingItem(null);
    }
  };

  const handleRecordSettlement = async (debtorName: string, receiverName: string, amount: number) => {
    const debtor = contributors.find((c) => c.contributorName.toLowerCase() === debtorName.toLowerCase());
    const receiver = contributors.find((c) => c.contributorName.toLowerCase() === receiverName.toLowerCase());

    if (!debtor || !receiver) return;

    await dbClient.insertItem(
      sheetId,
      `${debtor.contributorName} paid ${receiver.contributorName}`,
      amount,
      debtor.contributorID,
      Date.now(),
      [{ contributorId: receiver.contributorID, weight: amount }],
      'Marked as paid',
      ITEM_TYPE.TYPE_SETTLEMENT
    );
  };

  const getDeleteWarning = (item: ItemWithPayerAndConsumers) => {
    switch (item.item.itemType) {
      case ITEM_TYPE.TYPE_SETTLEMENT:
        return {
          title: 'Delete payment record?',
          message: `Deleting this payment will revert member balances. Are you sure you want to delete "${item.item.itemName}"?`,
        };
      case ITEM_TYPE.TYPE_MONEY_TRANSFER:
        return {
          title: 'Delete money transfer?',
          message: `Are you sure you want to delete "${item.item.itemName}"?`,
        };
      case ITEM_TYPE.TYPE_CARRYOVER:
        return {
          title: 'Delete carried balance?',
          message: `This balance was carried forward from a cloned sheet. Deleting it will drop the carried balance. Proceed?`,
        };
      default:
        return {
          title: 'Delete expense?',
          message: `Are you sure you want to delete "${item.item.itemName}" (${formatCurrency(item.item.amount)})?`,
        };
    }
  };

  return (
    <div
      className="h-full max-h-dvh max-w-xl w-full mx-auto flex flex-col overflow-hidden relative select-none animate-activity-morph-enter"
      onClick={() => {
        setActiveMenuItemId(null);
        setIsAddOptionsOpen(false);
      }}
    >
      {/* Pinned Top Bar + Hero Card + Search Bar + EXPENSES label matching sheet_view.xml */}
      <div className="shrink-0 px-4 pt-2 pb-1 z-10 bg-gradient-to-b from-bgStart via-bgStart to-transparent">
        {/* Top Bar matching sheetTopBar in sheet_view.xml */}
        <header className="flex items-center justify-between h-[52px] px-1">
          <button
            type="button"
            onClick={onBack}
            className="w-10 h-10 rounded-full flex items-center justify-center hover:bg-surfaceAlt text-iconTint active:scale-95 transition-all shrink-0"
            title="Back to sheets"
            aria-label="Back to sheets"
          >
            <ArrowLeft className="w-5 h-5 stroke-[2.2]" />
          </button>

          <div className="flex-1 min-w-0 mx-2 overflow-x-auto no-scrollbar">
            <h1 className="text-[18px] font-bold text-textPrimary tracking-tight truncate whitespace-nowrap">
              {sheet?.sheetName || 'Sheet'}
            </h1>
          </div>

          {itemsWithDetails.length >= 2 ? (
            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation();
                setIsSortOpen(true);
              }}
              className="w-10 h-10 rounded-full flex items-center justify-center hover:bg-surfaceAlt text-iconTint active:scale-95 transition-all shrink-0"
              title="Sort expenses"
            >
              <ArrowUpDown className="w-5 h-5 stroke-[2]" />
            </button>
          ) : (
            <div className="w-10 h-10 shrink-0" />
          )}
        </header>

        {/* Hero Card matching summaryCard in sheet_view.xml */}
        <div className="rounded-2xl p-[18px] sm:p-[20px] bg-gradient-to-br from-[#111827] via-[#182132] to-[#1F2937] dark:from-[#161F30] dark:via-[#1B2538] dark:to-[#222E44] shadow-md border border-cardStroke/20 my-1">
          <div className="flex items-center justify-between">
            <span className="text-[11px] font-bold tracking-[0.12em] text-white/60 uppercase">
              TOTAL SPENT
            </span>
            {isReadOnly && (
              <span className="px-2.5 py-1 rounded-[10px] bg-white/10 text-carryAccent text-[10px] font-extrabold tracking-[0.1em] uppercase">
                READ ONLY
              </span>
            )}
          </div>

          <div className="text-[34px] sm:text-[36px] font-bold text-white tracking-tight leading-none mt-2">
            {formatCurrency(totalSpent)}
          </div>
        </div>

        {/* Search Expenses Bar matching searchExpensesContainer in sheet_view.xml */}
        <div className="relative my-2">
          <div className="flex items-center h-[46px] px-3.5 rounded-2xl bg-surface border border-cardStroke shadow-sm focus-within:border-textPrimary transition-colors">
            <Search className="w-4 h-4 text-textHint shrink-0" />
            <input
              type="text"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="Search expenses, payer, or people..."
              className="w-full ml-2.5 bg-transparent text-sm text-textPrimary placeholder:text-textHint focus:outline-none focus:ring-0"
            />
            {searchQuery && (
              <button
                type="button"
                onClick={() => setSearchQuery('')}
                className="w-7 h-7 rounded-full flex items-center justify-center text-textHint hover:text-textPrimary shrink-0"
              >
                <X className="w-4 h-4" />
              </button>
            )}
          </div>
        </div>

        {/* Section Header matching tv_recent_expenses_label */}
        <div className="px-1 mt-1 mb-1">
          <span className="text-[11px] font-bold tracking-[0.12em] text-textHint uppercase">
            EXPENSES
          </span>
        </div>
      </div>

      {/* Expense List matching expense_card.xml in Android */}
      <main className="flex-1 overflow-y-auto px-4 py-1 space-y-2.5 overscroll-contain">
        {loading ? (
          <div className="py-20 text-center text-sm font-medium text-textHint">
            Loading expenses...
          </div>
        ) : filteredAndSortedItems.length === 0 ? (
          <div className="py-14 px-6 text-center rounded-2xl bg-surface border border-cardStroke shadow-sm">
            <p className="text-sm font-semibold text-textSecondary">
              {searchQuery
                ? 'No expenses match your search'
                : 'Long press expense card to see more options'}
            </p>
          </div>
        ) : (
          filteredAndSortedItems.map((item) => {
            const { item: expense, payer, consumers } = item;
            const isMenuOpen = activeMenuItemId === expense.itemID;

            // Style variations matching expense_card.xml & Android colors
            let cardBg = 'bg-surface border-cardStroke';
            let iconText = '₹';
            let iconBg = 'bg-surfaceAlt border border-cardStroke text-textPrimary';
            let amountColor = 'text-textPrimary';
            let payerLabel = 'Paid by';
            let splitLabel = 'Split between';

            let consumersDisplay =
              consumers.length > 3
                ? `Everyone (${consumers.length})`
                : consumers.map((c) => c.contributorName).join(', ');

            if (expense.itemType === ITEM_TYPE.TYPE_SETTLEMENT) {
              cardBg = 'bg-settleCard border-settleStroke';
              iconText = '✓';
              iconBg = 'bg-settlePanel text-settleAccent';
              amountColor = 'text-settleAccent';
              payerLabel = 'Paid by';
              splitLabel = 'Paid to';
              consumersDisplay = consumers.map((c) => c.contributorName).join(', ');
            } else if (expense.itemType === ITEM_TYPE.TYPE_MONEY_TRANSFER) {
              cardBg = 'bg-transferCard border-transferStroke';
              iconText = '⇄';
              iconBg = 'bg-transferPanel text-transferAccent';
              amountColor = 'text-transferAccent';
              payerLabel = 'From';
              splitLabel = 'To';
              consumersDisplay = consumers.map((c) => c.contributorName).join(', ');
            } else if (expense.itemType === ITEM_TYPE.TYPE_CARRYOVER) {
              cardBg = 'bg-carryCard border-carryStroke';
              iconText = '↺';
              iconBg = 'bg-carryPanel text-carryAccent';
              amountColor = 'text-carryAccent';
              payerLabel = 'Owed to';
              splitLabel = 'Owed by';
              consumersDisplay = consumers.map((c) => c.contributorName).join(', ');
            }

            return (
              <div
                key={expense.itemID}
                onClick={() => setActiveMenuItemId(isMenuOpen ? null : expense.itemID)}
                onContextMenu={(e) => {
                  e.preventDefault();
                  setActiveMenuItemId(expense.itemID);
                }}
                className={`relative p-4 rounded-2xl border shadow-sm hover:shadow-md active:scale-[0.99] transition-all cursor-pointer ${cardBg}`}
              >
                {/* Header row: Icon bubble + Name & Date + Amount & 3-dot */}
                <div className="flex items-start justify-between gap-3">
                  <div className="flex items-start gap-3 flex-1 min-w-0">
                    {/* 42x42dp bubble matching bg_icon_bubble */}
                    <div
                      className={`w-[42px] h-[42px] rounded-xl flex items-center justify-center font-bold text-lg shrink-0 ${iconBg}`}
                    >
                      {iconText}
                    </div>

                    <div className="min-w-0 flex-1 pt-0.5">
                      <h3 className="text-[17px] font-bold text-textPrimary tracking-tight truncate leading-snug">
                        {expense.itemName}
                      </h3>
                      <p className="text-[12px] text-textHint mt-0.5">
                        {formatExpenseDate(expense.dateCreated)}
                      </p>
                    </div>
                  </div>

                  <div className="flex items-center gap-1 shrink-0 pt-0.5">
                    <span className={`text-[17px] font-bold ${amountColor}`}>
                      {formatCurrency(expense.amount)}
                    </span>
                    <button
                      type="button"
                      onClick={(e) => {
                        e.stopPropagation();
                        setActiveMenuItemId(isMenuOpen ? null : expense.itemID);
                      }}
                      className="w-7 h-7 rounded-full flex items-center justify-center text-textHint hover:text-textPrimary"
                    >
                      <MoreVertical className="w-4 h-4" />
                    </button>
                  </div>
                </div>

                {/* Nested Meta Panel matching bg_nested_panel in expense_card.xml */}
                <div className="mt-3.5 p-3 rounded-[10px] bg-surfaceAlt/80 border border-cardStroke/30 space-y-2">
                  <div className="flex items-center justify-between text-[13px] gap-2">
                    <span className="text-textSecondary">{payerLabel}</span>
                    <span className="font-bold text-textPrimary truncate max-w-[180px]">
                      {payer.contributorName}
                    </span>
                  </div>

                  <div className="flex items-center justify-between text-[13px] gap-2">
                    <span className="text-textSecondary">{splitLabel}</span>
                    <span className="font-bold text-textPrimary truncate max-w-[180px]">
                      {consumersDisplay || 'Everyone'}
                    </span>
                  </div>
                </div>

                {/* Card Overflow Menu with morph enter & exit */}
                <ExpenseCardMenu
                  isOpen={isMenuOpen}
                  isReadOnly={isReadOnly}
                  onEdit={() => {
                    setActiveMenuItemId(null);
                    setEditingItem(item);
                    if (
                      expense.itemType === ITEM_TYPE.TYPE_EXPENSE ||
                      expense.itemType === ITEM_TYPE.TYPE_CARRYOVER
                    ) {
                      setIsAddExpenseOpen(true);
                    } else {
                      setIsMoneyTransferOpen(true);
                    }
                  }}
                  onDetails={() => {
                    setActiveMenuItemId(null);
                    setDetailsItem(item);
                  }}
                  onDelete={() => {
                    setActiveMenuItemId(null);
                    setDeletingItem(item);
                  }}
                />
              </div>
            );
          })
        )}
      </main>

      {/* Bottom Sticky Action Bar matching sheet_view.xml */}
      <footer className="shrink-0 p-4 pb-[max(1.25rem,env(safe-area-inset-bottom))] bg-gradient-to-t from-bgEnd via-bgEnd to-transparent z-20">
        <div className="flex items-center gap-3">
          {itemsWithDetails.length > 0 && (
            <button
              type="button"
              onClick={() => setIsBalancesOpen(true)}
              className="flex-1 h-[52px] px-4 rounded-xl bg-surface hover:bg-surfaceAlt text-textPrimary font-bold text-[15px] shadow-sm border border-cardStroke active:scale-[0.98] transition-all"
            >
              Calculate
            </button>
          )}

          {!isReadOnly && (
            <div className="relative flex-1">
              {/* Outside backdrop when popover is open */}
              {isAddOptionsOpen && (
                <div
                  className="fixed inset-0 z-30 bg-transparent"
                  onClick={(e) => {
                    e.stopPropagation();
                    setIsAddOptionsOpen(false);
                  }}
                  onTouchStart={(e) => {
                    e.stopPropagation();
                    setIsAddOptionsOpen(false);
                  }}
                />
              )}

              {/* Popover options for + Add Expense with morph enter & exit */}
              <AddExpenseOptionsPopover
                isOpen={isAddOptionsOpen}
                onAddExpense={() => {
                  setIsAddOptionsOpen(false);
                  setEditingItem(null);
                  setIsAddExpenseOpen(true);
                }}
                onMoneyTransfer={() => {
                  setIsAddOptionsOpen(false);
                  setEditingItem(null);
                  setIsMoneyTransferOpen(true);
                }}
              />

              <div className="relative flex items-center">
                <button
                  type="button"
                  onClick={(e) => {
                    e.stopPropagation();
                    if (didLongPressRef.current) {
                      didLongPressRef.current = false;
                      return;
                    }
                    setEditingItem(null);
                    setIsAddExpenseOpen(true);
                  }}
                  onContextMenu={(e) => {
                    e.preventDefault();
                    e.stopPropagation();
                    if (didLongPressRef.current) return;
                    setIsAddOptionsOpen((prev) => !prev);
                  }}
                  onTouchStart={() => {
                    didLongPressRef.current = false;
                    if (longPressTimer.current) clearTimeout(longPressTimer.current);
                    longPressTimer.current = window.setTimeout(() => {
                      didLongPressRef.current = true;
                      try {
                        navigator.vibrate?.(40);
                      } catch {}
                      setIsAddOptionsOpen(true);
                    }, 400);
                  }}
                  onTouchMove={() => {
                    if (longPressTimer.current) {
                      clearTimeout(longPressTimer.current);
                      longPressTimer.current = null;
                    }
                  }}
                  onTouchEnd={(e) => {
                    if (longPressTimer.current) {
                      clearTimeout(longPressTimer.current);
                      longPressTimer.current = null;
                    }
                    if (didLongPressRef.current) {
                      e.preventDefault();
                    }
                  }}
                  className="w-full h-[52px] pl-4 pr-11 rounded-xl bg-btnPrimaryBg text-btnPrimaryText font-bold text-[15px] shadow-md hover:opacity-90 active:scale-[0.98] transition-all flex items-center justify-center gap-2"
                >
                  <Plus className="w-4 h-4 stroke-[2.5]" />
                  <span>Add Expense</span>
                </button>

                {/* Secondary affordance icon to easily open options on tap/click */}
                <button
                  type="button"
                  onClick={(e) => {
                    e.stopPropagation();
                    setIsAddOptionsOpen((prev) => !prev);
                  }}
                  title="More options"
                  aria-label="More options"
                  className="absolute right-1 w-10 h-10 rounded-lg flex items-center justify-center text-btnPrimaryText/70 hover:text-btnPrimaryText hover:bg-white/10 active:scale-95 transition-all"
                >
                  <ChevronDown className="w-4 h-4" />
                </button>
              </div>
            </div>
          )}
        </div>
      </footer>

      {/* Dialogs */}
      <SortExpenseDialog
        isOpen={isSortOpen}
        sortBy={sortBy}
        sortOrder={sortOrder}
        onApply={handleApplySort}
        onClose={() => setIsSortOpen(false)}
      />

      <AddEditExpenseDialog
        isOpen={isAddExpenseOpen}
        contributors={contributors}
        itemToEdit={editingItem}
        onSave={handleSaveExpense}
        onClose={() => {
          setIsAddExpenseOpen(false);
          setEditingItem(null);
        }}
      />

      <MoneyTransferDialog
        isOpen={isMoneyTransferOpen}
        contributors={contributors}
        itemToEdit={editingItem}
        onSave={handleSaveMoneyTransfer}
        onClose={() => {
          setIsMoneyTransferOpen(false);
          setEditingItem(null);
        }}
      />

      <ExpenseDetailsDialog
        isOpen={Boolean(detailsItem)}
        item={detailsItem}
        onClose={() => setDetailsItem(null)}
      />

      <BalancesDialog
        isOpen={isBalancesOpen}
        initialBalances={currentBalancesMap}
        isReadOnly={isReadOnly}
        onRecordSettlement={handleRecordSettlement}
        onClose={() => setIsBalancesOpen(false)}
      />

      <ConfirmDialog
        isOpen={Boolean(deletingItem)}
        title={deletingItem ? getDeleteWarning(deletingItem).title : ''}
        message={deletingItem ? getDeleteWarning(deletingItem).message : ''}
        confirmText="Delete"
        onConfirm={handleDeleteItemConfirm}
        onCancel={() => setDeletingItem(null)}
      />
    </div>
  );
};

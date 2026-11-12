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

interface SheetViewPageProps {
  sheetId: number;
  onBack: () => void;
}

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

    const contribMap = new Map<number, string>(contributors.map((c) => [c.contributorID, c.contributorName]));
    for (const [cId, bal] of netMap.entries()) {
      const name = contribMap.get(cId);
      if (name) balances[name] = bal;
    }
    return balances;
  }, [contributors, itemsWithDetails]);

  // Actions
  const handleSaveExpense = async (
    itemName: string,
    amount: number,
    payerId: number,
    consumerWeights: Array<{ contributorId: number; weight: number }>,
    notes: string | null
  ) => {
    if (editingItem) {
      await dbClient.updateItem(
        sheetId,
        editingItem.item.itemID,
        itemName,
        amount,
        payerId,
        consumerWeights,
        notes
      );
      setEditingItem(null);
    } else {
      await dbClient.insertItem(
        sheetId,
        itemName,
        amount,
        payerId,
        Date.now(),
        consumerWeights,
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
    const fromName = contributors.find((c) => c.contributorID === fromId)?.contributorName || '';
    const toName = contributors.find((c) => c.contributorID === toId)?.contributorName || '';
    const transferTitle =
      itemType === ITEM_TYPE.TYPE_SETTLEMENT ? `${fromName} paid ${toName}` : `${fromName} → ${toName}`;

    if (editingItem) {
      await dbClient.updateItem(
        sheetId,
        editingItem.item.itemID,
        transferTitle,
        amount,
        fromId,
        [{ contributorId: toId, weight: amount }],
        itemType === ITEM_TYPE.TYPE_SETTLEMENT ? 'Marked as paid' : 'Money transfer'
      );
      setEditingItem(null);
    } else {
      await dbClient.insertItem(
        sheetId,
        transferTitle,
        amount,
        fromId,
        Date.now(),
        [{ contributorId: toId, weight: amount }],
        itemType === ITEM_TYPE.TYPE_SETTLEMENT ? 'Marked as paid' : 'Money transfer',
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

  const handleRecordSettlement = async (
    debtorName: string,
    receiverName: string,
    amount: number
  ) => {
    const debtor = contributors.find((c) => c.contributorName === debtorName);
    const receiver = contributors.find((c) => c.contributorName === receiverName);
    if (!debtor || !receiver) return;

    await dbClient.insertItem(
      sheetId,
      `${debtorName} paid ${receiverName}`,
      amount,
      debtor.contributorID,
      Date.now(),
      [{ contributorId: receiver.contributorID, weight: amount }],
      'Marked as paid',
      ITEM_TYPE.TYPE_SETTLEMENT
    );
  };

  const getDeleteWarning = (it: ItemWithPayerAndConsumers) => {
    const formatted = formatCurrency(it.item.amount);
    switch (it.item.itemType) {
      case ITEM_TYPE.TYPE_SETTLEMENT:
        return {
          title: 'Delete payment?',
          message: `Are you sure you want to delete payment "${it.item.itemName}" (${formatted})? Sheet balances will be recalculated.`,
        };
      case ITEM_TYPE.TYPE_MONEY_TRANSFER:
        return {
          title: 'Delete money transfer?',
          message: `Are you sure you want to delete transfer "${it.item.itemName}" (${formatted})? Sheet balances will be recalculated.`,
        };
      case ITEM_TYPE.TYPE_CARRYOVER:
        return {
          title: 'Delete carried balance?',
          message: `Are you sure you want to delete carried balance "${it.item.itemName}" (${formatted})? Carried balances from the previous sheet will change.`,
        };
      default:
        return {
          title: 'Delete expense?',
          message: `Are you sure you want to delete "${it.item.itemName}" (${formatted})? Sheet balances will be recalculated.`,
        };
    }
  };

  return (
    <div
      className="min-h-screen max-w-xl mx-auto flex flex-col px-4 pt-3 pb-24 relative"
      onClick={() => {
        setActiveMenuItemId(null);
        setIsAddOptionsOpen(false);
      }}
    >
      {/* Top Bar */}
      <header className="flex items-center justify-between h-14">
        <button
          type="button"
          onClick={onBack}
          className="p-2 rounded-full hover:bg-surfaceAlt text-iconTint transition-colors"
          title="Back to sheets"
        >
          <ArrowLeft className="w-5 h-5 stroke-[2.2]" />
        </button>

        <div className="flex-1 overflow-x-auto no-scrollbar mx-2">
          <h1 className="text-lg font-bold text-textPrimary tracking-tight whitespace-nowrap">
            {sheet?.sheetName || 'Sheet'}
          </h1>
        </div>

        {itemsWithDetails.length >= 2 && (
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation();
              setIsSortOpen(true);
            }}
            className="p-2 rounded-full hover:bg-surfaceAlt text-iconTint transition-colors shrink-0"
            title="Sort expenses"
          >
            <ArrowUpDown className="w-5 h-5 stroke-[2.2]" />
          </button>
        )}
      </header>

      {/* Hero Card: TOTAL SPENT */}
      <div className="mt-2 p-6 rounded-3xl [background:var(--hero-gradient)] shadow-xl text-white relative overflow-hidden">
        <div className="flex items-center justify-between">
          <span className="text-[11px] font-extrabold uppercase tracking-[0.14em] text-white/70">
            TOTAL SPENT
          </span>
          {isReadOnly && (
            <span className="px-2.5 py-1 rounded-xl bg-surface/15 text-[10px] font-extrabold tracking-wider text-carryAccent border border-carryAccent/30 backdrop-blur-sm">
              READ ONLY
            </span>
          )}
        </div>
        <p className="mt-2 text-4xl font-extrabold tracking-tight text-white">
          {formatCurrency(totalSpent)}
        </p>
      </div>

      {/* Search Bar */}
      <div className="relative mt-4">
        <div className="flex items-center h-12 px-4 rounded-2xl bg-surface border border-cardStroke shadow-sm">
          <Search className="w-4 h-4 text-textHint shrink-0" />
          <input
            type="text"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder="Search expenses, payer, or people..."
            className="w-full ml-3 bg-transparent text-sm text-textPrimary placeholder:text-textHint focus:outline-none"
          />
          {searchQuery && (
            <button
              type="button"
              onClick={() => setSearchQuery('')}
              className="p-1 rounded-full text-textHint hover:text-textPrimary"
            >
              <X className="w-4 h-4" />
            </button>
          )}
        </div>
      </div>

      {/* Section Header */}
      <div className="mt-4 mb-2 px-1">
        <span className="text-[11px] font-extrabold uppercase tracking-[0.12em] text-textHint">
          EXPENSES
        </span>
      </div>

      {/* Expenses List */}
      <main className="flex-1 space-y-3">
        {loading ? (
          <div className="py-20 text-center text-sm font-medium text-textHint">
            Loading expenses...
          </div>
        ) : filteredAndSortedItems.length === 0 ? (
          <div className="py-14 px-6 text-center rounded-3xl bg-surface border border-cardStroke shadow-sm">
            <p className="text-sm font-semibold text-textSecondary">
              {itemsWithDetails.length === 0
                ? 'Long press expense card to see more options'
                : 'No expenses match your search'}
            </p>
          </div>
        ) : (
          filteredAndSortedItems.map((item) => {
            const { item: expense, payer, consumers } = item;
            const isMenuOpen = activeMenuItemId === expense.itemID;

            // Card styling by itemType
            let cardBg = 'bg-surface border-cardStroke';
            let iconText = '₹';
            let iconBg = 'bg-surfaceAlt text-textPrimary';
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
                className={`relative p-4 rounded-3xl border shadow-sm hover:shadow-md transition-all cursor-pointer ${cardBg}`}
              >
                <div className="flex items-start justify-between gap-3">
                  <div className="flex items-start gap-3 flex-1 min-w-0">
                    <div
                      className={`w-9 h-9 rounded-2xl flex items-center justify-center font-bold text-base shrink-0 ${iconBg}`}
                    >
                      {iconText}
                    </div>
                    <div className="min-w-0 flex-1">
                      <h3 className="text-base font-bold text-textPrimary tracking-tight truncate">
                        {expense.itemName}
                      </h3>
                      <p className="text-[11px] text-textHint mt-0.5">
                        {formatExpenseDate(expense.dateCreated)}
                      </p>
                    </div>
                  </div>

                  <div className="flex items-center gap-1 shrink-0">
                    <span className={`text-base font-extrabold ${amountColor}`}>
                      {formatCurrency(expense.amount)}
                    </span>
                    <button
                      type="button"
                      onClick={(e) => {
                        e.stopPropagation();
                        setActiveMenuItemId(isMenuOpen ? null : expense.itemID);
                      }}
                      className="p-1 rounded-full text-textHint hover:text-textPrimary"
                    >
                      <MoreVertical className="w-4 h-4" />
                    </button>
                  </div>
                </div>

                {/* Meta panel */}
                <div className="mt-3.5 p-3 rounded-2xl bg-surface/50 border border-cardStroke/40 text-xs flex flex-wrap items-center justify-between gap-2">
                  <div>
                    <span className="text-textHint">{payerLabel} </span>
                    <span className="font-bold text-textPrimary">{payer.contributorName}</span>
                  </div>
                  <div>
                    <span className="text-textHint">{splitLabel} </span>
                    <span className="font-bold text-textPrimary">{consumersDisplay || 'None'}</span>
                  </div>
                </div>

                {/* Card Overflow Menu */}
                {isMenuOpen && (
                  <div
                    className="absolute right-4 top-12 z-30 w-36 rounded-2xl bg-surface p-1.5 shadow-xl border border-cardStroke animate-morph-in"
                    onClick={(e) => e.stopPropagation()}
                  >
                    {!isReadOnly && (
                      <button
                        type="button"
                        onClick={() => {
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
                        className="w-full text-left px-3 py-2 rounded-xl text-xs font-semibold text-textPrimary hover:bg-surfaceAlt transition-colors"
                      >
                        Edit
                      </button>
                    )}

                    <button
                      type="button"
                      onClick={() => {
                        setActiveMenuItemId(null);
                        setDetailsItem(item);
                      }}
                      className="w-full text-left px-3 py-2 rounded-xl text-xs font-semibold text-textPrimary hover:bg-surfaceAlt transition-colors"
                    >
                      Details
                    </button>

                    {!isReadOnly && (
                      <>
                        <div className="my-1 border-t border-cardStroke" />
                        <button
                          type="button"
                          onClick={() => {
                            setActiveMenuItemId(null);
                            setDeletingItem(item);
                          }}
                          className="w-full text-left px-3 py-2 rounded-xl text-xs font-semibold text-giveText hover:bg-giveText/10 transition-colors"
                        >
                          Delete
                        </button>
                      </>
                    )}
                  </div>
                )}
              </div>
            );
          })
        )}
      </main>

      {/* Bottom Sticky Action Bar */}
      <footer className="fixed bottom-0 left-0 right-0 z-30 p-4 bg-gradient-to-t from-bgEnd via-bgEnd/90 to-transparent">
        <div className="max-w-xl mx-auto flex items-center gap-3">
          {itemsWithDetails.length > 0 && (
            <button
              type="button"
              onClick={() => setIsBalancesOpen(true)}
              className="flex-1 h-13 py-3.5 px-4 rounded-2xl bg-surface hover:bg-surfaceAlt text-textPrimary font-bold text-sm shadow-md border border-cardStroke active:scale-[0.98] transition-all"
            >
              Calculate
            </button>
          )}

          {!isReadOnly && (
            <div className="relative flex-1">
              {isAddOptionsOpen && (
                <div
                  className="absolute bottom-16 right-0 w-48 rounded-2xl bg-surface p-1.5 shadow-2xl border border-cardStroke animate-morph-in mb-2 space-y-1"
                  onClick={(e) => e.stopPropagation()}
                >
                  <button
                    type="button"
                    onClick={() => {
                      setIsAddOptionsOpen(false);
                      setEditingItem(null);
                      setIsAddExpenseOpen(true);
                    }}
                    className="w-full text-left px-3.5 py-2.5 rounded-xl text-xs font-bold text-textPrimary hover:bg-surfaceAlt flex items-center gap-2.5 transition-colors"
                  >
                    <Receipt className="w-4 h-4 text-textHint" />
                    Add Expense
                  </button>

                  <button
                    type="button"
                    onClick={() => {
                      setIsAddOptionsOpen(false);
                      setEditingItem(null);
                      setIsMoneyTransferOpen(true);
                    }}
                    className="w-full text-left px-3.5 py-2.5 rounded-xl text-xs font-bold text-textPrimary hover:bg-surfaceAlt flex items-center gap-2.5 transition-colors"
                  >
                    <ArrowRightLeft className="w-4 h-4 text-textHint" />
                    Money Transfer
                  </button>
                </div>
              )}

              <button
                type="button"
                onClick={() => {
                  setEditingItem(null);
                  setIsAddExpenseOpen(true);
                }}
                onContextMenu={(e) => {
                  e.preventDefault();
                  setIsAddOptionsOpen(!isAddOptionsOpen);
                }}
                onTouchStart={() => {
                  longPressTimer.current = window.setTimeout(() => {
                    setIsAddOptionsOpen(true);
                  }, 500);
                }}
                onTouchEnd={() => {
                  if (longPressTimer.current) clearTimeout(longPressTimer.current);
                }}
                className="w-full h-13 py-3.5 px-4 rounded-2xl bg-btnPrimaryBg text-btnPrimaryText font-bold text-sm shadow-lg hover:opacity-90 active:scale-[0.98] transition-all flex items-center justify-center gap-2"
              >
                <Plus className="w-4 h-4 stroke-[2.5]" />
                Add Expense
              </button>
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

import React, { useState, useMemo } from 'react';
import { X } from 'lucide-react';
import { BalanceCalculator, roundToPlaces } from '../utils/BalanceCalculator';
import { formatCurrency } from '../utils/formatters';
import { useMorphPresence } from '../hooks/useMorphPresence';

interface BalancesDialogProps {
  isOpen: boolean;
  initialBalances: Record<string, number>;
  isReadOnly: boolean;
  onRecordSettlement: (debtorName: string, receiverName: string, amount: number) => Promise<void>;
  onClose: () => void;
}

export const BalancesDialog: React.FC<BalancesDialogProps> = ({
  isOpen,
  initialBalances,
  isReadOnly,
  onRecordSettlement,
  onClose,
}) => {
  const [activeTab, setActiveTab] = useState<'balances' | 'settlePlan'>('balances');
  const [currentBalances, setCurrentBalances] = useState<Record<string, number>>(initialBalances);
  const [isSubmitting, setIsSubmitting] = useState(false);

  // Recipient selection dialog state matching dialog_select_recipient.xml
  const [recipientPrompt, setRecipientPrompt] = useState<{
    debtorName: string;
    amountOwed: number;
    receivers: Array<{ name: string; amountOwed: number }>;
  } | null>(null);

  React.useEffect(() => {
    setCurrentBalances(initialBalances);
  }, [initialBalances]);

  const sortedBalanceEntries = useMemo(() => {
    return BalanceCalculator.sortBalanceEntries(currentBalances);
  }, [currentBalances]);

  const settlementTransfers = useMemo(() => {
    return BalanceCalculator.generateSettlementTransfers(currentBalances);
  }, [currentBalances]);

  const { shouldRender, isClosing } = useMorphPresence(isOpen, 180);

  if (!shouldRender) return null;

  const handleMarkAsPaidFromBalances = (debtorName: string, amountOwed: number) => {
    if (isReadOnly || isSubmitting) return;

    const receivers = Object.entries(currentBalances)
      .filter(([_, val]) => val > 0.005)
      .map(([name, val]) => ({ name, amountOwed: val }));

    if (receivers.length === 0) return;

    if (receivers.length === 1) {
      handleExecuteSettlement(debtorName, receivers[0].name, Math.min(amountOwed, receivers[0].amountOwed));
    } else {
      setRecipientPrompt({ debtorName, amountOwed, receivers });
    }
  };

  const handleExecuteSettlement = async (
    debtorName: string,
    receiverName: string,
    amount: number
  ) => {
    if (isSubmitting) return;
    setIsSubmitting(true);
    try {
      await onRecordSettlement(debtorName, receiverName, amount);

      // Optimistically update local balances
      const next = { ...currentBalances };
      next[debtorName] = roundToPlaces((next[debtorName] ?? 0) + amount, 2);
      next[receiverName] = roundToPlaces((next[receiverName] ?? 0) - amount, 2);
      setCurrentBalances(next);
      setRecipientPrompt(null);
    } catch (err) {
      console.error('[BalancesDialog] recordSettlement failed:', err);
    } finally {
      setIsSubmitting(false);
    }
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
          {/* Header matching dialog_balances.xml */}
          <div className="flex items-center justify-between pb-3">
            <h2 className="text-[20px] font-bold text-textPrimary tracking-tight">Balances</h2>
            <button
              type="button"
              onClick={onClose}
              aria-label="Close balances"
              className="w-8 h-8 rounded-full flex items-center justify-center text-textHint hover:text-textPrimary transition-colors"
            >
              <X className="w-5 h-5" />
            </button>
          </div>

          {/* Tabs matching llBalanceTabs in dialog_balances.xml */}
          <div className="bg-surfaceAlt rounded-[10px] p-1 flex gap-1 mt-1">
            <button
              type="button"
              onClick={() => setActiveTab('balances')}
              className={`flex-1 h-[38px] rounded-lg text-[13px] font-bold transition-all ${
                activeTab === 'balances'
                  ? 'bg-btnPrimaryBg text-btnPrimaryText shadow-sm'
                  : 'text-textSecondary hover:text-textPrimary'
              }`}
            >
              Balances
            </button>
            <button
              type="button"
              onClick={() => setActiveTab('settlePlan')}
              className={`flex-1 h-[38px] rounded-lg text-[13px] font-bold transition-all ${
                activeTab === 'settlePlan'
                  ? 'bg-btnPrimaryBg text-btnPrimaryText shadow-sm'
                  : 'text-textSecondary hover:text-textPrimary'
              }`}
            >
              Who Pays Whom
            </button>
          </div>

          {/* Tab 1: Net Balances List */}
          {activeTab === 'balances' && (
            <div className="mt-3 space-y-2 max-h-[290px] overflow-y-auto pr-0.5">
              {sortedBalanceEntries.map(([name, balance]) => {
                const isReceiver = balance > 0.005;
                const isGiver = balance < -0.005;
                const absBalance = Math.abs(balance);

                return (
                  <div
                    key={name}
                    className="flex items-center justify-between px-4 py-3 rounded-[10px] bg-surfaceAlt gap-3"
                  >
                    <div className="flex-1 min-w-0">
                      <p className="text-base font-bold text-textPrimary truncate">{name}</p>
                      <p
                        className={`text-[13px] font-bold mt-0.5 ${
                          isReceiver
                            ? 'text-receiveText'
                            : isGiver
                            ? 'text-giveText'
                            : 'text-textHint font-medium'
                        }`}
                      >
                        {isReceiver
                          ? `Will receive ${formatCurrency(balance)}`
                          : isGiver
                          ? `Will give ${formatCurrency(absBalance)}`
                          : 'Settled up'}
                      </p>
                    </div>

                    {!isReadOnly && isGiver && (
                      <button
                        type="button"
                        disabled={isSubmitting}
                        onClick={() => handleMarkAsPaidFromBalances(name, absBalance)}
                        className="h-9 px-3 rounded-[10px] bg-settleBtnBg border border-settleBtnStroke text-settleAccent hover:opacity-90 active:scale-95 text-xs font-bold transition-all shrink-0 shadow-sm"
                      >
                        Mark as Paid
                      </button>
                    )}
                  </div>
                );
              })}
            </div>
          )}

          {/* Tab 2: Who Pays Whom List */}
          {activeTab === 'settlePlan' && (
            <div className="mt-3 space-y-2 max-h-[290px] overflow-y-auto pr-0.5">
              {settlementTransfers.length === 0 ? (
                <div className="p-6 rounded-[10px] bg-surfaceAlt text-center">
                  <p className="text-sm font-bold text-settleAccent">
                    Everyone is settled up!
                  </p>
                </div>
              ) : (
                settlementTransfers.map((transfer, idx) => (
                  <div
                    key={`${transfer.fromName}-${transfer.toName}-${idx}`}
                    className="flex items-center justify-between px-4 py-3 rounded-[10px] bg-surfaceAlt gap-3"
                  >
                    <div className="flex-1 min-w-0">
                      <p className="text-[15px] font-bold text-textPrimary truncate">
                        {transfer.fromName} → {transfer.toName}
                      </p>
                      <p className="text-[13px] font-bold text-giveText mt-0.5">
                        {formatCurrency(transfer.amount)}
                      </p>
                    </div>

                    {!isReadOnly && (
                      <button
                        type="button"
                        disabled={isSubmitting}
                        onClick={() =>
                          handleExecuteSettlement(
                            transfer.fromName,
                            transfer.toName,
                            transfer.amount
                          )
                        }
                        className="h-9 px-3 rounded-[10px] bg-settleBtnBg border border-settleBtnStroke text-settleAccent hover:opacity-90 active:scale-95 text-xs font-bold transition-all shrink-0 shadow-sm"
                      >
                        Mark as Paid
                      </button>
                    )}
                  </div>
                ))
              )}
            </div>
          )}
        </div>
      </div>

      {/* Recipient Prompt Modal matching dialog_select_recipient.xml */}
      {recipientPrompt && (
        <div
          className="fixed inset-0 z-60 flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm animate-backdrop-in"
          onClick={() => setRecipientPrompt(null)}
        >
          <div
            className="w-full max-w-[360px] rounded-2xl bg-surface p-5 sm:p-6 shadow-2xl border border-cardStroke animate-dialog-morph-enter my-auto"
            onClick={(e) => e.stopPropagation()}
          >
            <h3 className="text-[19px] font-bold text-textPrimary tracking-tight">
              Paid to whom?
            </h3>
            <p className="text-xs text-textSecondary mt-1 leading-relaxed">
              Who did <span className="font-bold text-textPrimary">{recipientPrompt.debtorName}</span> pay?
            </p>

            <div className="mt-4 space-y-2 max-h-56 overflow-y-auto pr-0.5">
              {recipientPrompt.receivers.map((rec) => {
                const payAmount = roundToPlaces(
                  Math.min(recipientPrompt.amountOwed, rec.amountOwed),
                  2
                );
                return (
                  <button
                    key={rec.name}
                    type="button"
                    onClick={() =>
                      handleExecuteSettlement(
                        recipientPrompt.debtorName,
                        rec.name,
                        payAmount
                      )
                    }
                    className="w-full text-left p-3 rounded-xl bg-surfaceAlt hover:bg-surfaceHigh border border-cardStroke flex items-center justify-between transition-colors"
                  >
                    <span className="text-sm font-bold text-textPrimary truncate mr-2">
                      {rec.name}
                    </span>
                    <span className="text-xs font-bold text-receiveText shrink-0">
                      Up to {formatCurrency(payAmount)}
                    </span>
                  </button>
                );
              })}
            </div>

            <button
              type="button"
              onClick={() => setRecipientPrompt(null)}
              className="mt-4 w-full h-[44px] rounded-xl text-sm font-bold text-textPrimary bg-surfaceAlt hover:bg-surfaceHigh border border-cardStroke transition-colors"
            >
              Cancel
            </button>
          </div>
        </div>
      )}
    </>
  );
};

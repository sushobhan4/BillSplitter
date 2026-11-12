import React, { useState, useMemo } from 'react';
import { X, Check } from 'lucide-react';
import { BalanceCalculator, roundToPlaces } from '../utils/BalanceCalculator';
import { formatCurrency } from '../utils/formatters';
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

  // Recipient selection dialog state
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

  if (!isOpen) return null;

  const handleMarkAsPaidFromBalances = (debtorName: string, amountOwed: number) => {
    if (isReadOnly || isSubmitting) return;

    const receivers = Object.entries(currentBalances)
      .filter(([_, val]) => val > 0.005)
      .map(([name, val]) => ({ name, amountOwed: val }));

    if (receivers.length === 0) return;

    if (receivers.length === 1) {
      handleExecuteSettlement(debtorName, receivers[0].name, amountOwed);
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
      <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm animate-fade-in overflow-y-auto">
        <div
          className="w-full max-w-md max-h-[92vh] flex flex-col rounded-3xl bg-surface p-6 shadow-2xl border border-cardStroke animate-morph-in"
          onClick={(e) => e.stopPropagation()}
        >
          {/* Header */}
          <div className="flex items-center justify-between pb-3 border-b border-cardStroke">
            <h2 className="text-xl font-bold text-textPrimary tracking-tight">Balances</h2>
            <button
              type="button"
              onClick={onClose}
              className="p-1.5 rounded-full hover:bg-surfaceAlt text-textHint hover:text-textPrimary transition-colors"
            >
              <X className="w-5 h-5" />
            </button>
          </div>

          {/* Segmented Tabs */}
          <div className="mt-4 p-1 rounded-2xl bg-surfaceAlt border border-cardStroke flex gap-1">
            <button
              type="button"
              onClick={() => setActiveTab('balances')}
              className={`flex-1 py-2 rounded-xl text-xs font-bold tracking-tight transition-all ${
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
              className={`flex-1 py-2 rounded-xl text-xs font-bold tracking-tight transition-all ${
                activeTab === 'settlePlan'
                  ? 'bg-btnPrimaryBg text-btnPrimaryText shadow-sm'
                  : 'text-textSecondary hover:text-textPrimary'
              }`}
            >
              Who Pays Whom
            </button>
          </div>

          {/* Content */}
          <div className="flex-1 overflow-y-auto mt-4 pr-1 space-y-2.5 max-h-[58vh]">
            {activeTab === 'balances' ? (
              sortedBalanceEntries.map(([name, balance]) => {
                const isReceiver = balance > 0.005;
                const isGiver = balance < -0.005;
                const owed = Math.abs(balance);

                return (
                  <div
                    key={name}
                    className="flex items-center justify-between p-3.5 rounded-2xl bg-surfaceAlt border border-cardStroke"
                  >
                    <div>
                      <p className="text-sm font-bold text-textPrimary">{name}</p>
                      <p
                        className={`text-xs font-semibold mt-0.5 ${
                          isReceiver
                            ? 'text-receiveText'
                            : isGiver
                            ? 'text-giveText'
                            : 'text-textHint'
                        }`}
                      >
                        {isReceiver && `Will receive ${formatCurrency(balance)}`}
                        {isGiver && `Will give ${formatCurrency(owed)}`}
                        {!isReceiver && !isGiver && 'Settled up'}
                      </p>
                    </div>

                    {isGiver && !isReadOnly && (
                      <button
                        type="button"
                        onClick={() => handleMarkAsPaidFromBalances(name, owed)}
                        disabled={isSubmitting}
                        className="px-3 py-1.5 rounded-xl bg-settleCard text-settleAccent border border-settleStroke hover:opacity-90 text-xs font-bold transition-opacity"
                      >
                        Mark as paid
                      </button>
                    )}
                  </div>
                );
              })
            ) : settlementTransfers.length === 0 ? (
              <div className="py-10 text-center rounded-2xl bg-surfaceAlt border border-cardStroke">
                <div className="inline-flex p-3 rounded-full bg-settlePanel text-settleAccent mb-2">
                  <Check className="w-6 h-6 stroke-[2.5]" />
                </div>
                <p className="text-sm font-bold text-settleAccent">Everyone is settled up!</p>
              </div>
            ) : (
              settlementTransfers.map((t, idx) => (
                <div
                  key={`${t.fromName}-${t.toName}-${idx}`}
                  className="flex items-center justify-between p-3.5 rounded-2xl bg-surfaceAlt border border-cardStroke"
                >
                  <div>
                    <p className="text-sm font-bold text-textPrimary">
                      {t.fromName} → {t.toName}
                    </p>
                    <p className="text-xs font-semibold text-textSecondary mt-0.5">
                      Pay {formatCurrency(t.amount)}
                    </p>
                  </div>

                  {!isReadOnly && (
                    <button
                      type="button"
                      onClick={() => handleExecuteSettlement(t.fromName, t.toName, t.amount)}
                      disabled={isSubmitting}
                      className="px-3 py-1.5 rounded-xl bg-settleCard text-settleAccent border border-settleStroke hover:opacity-90 text-xs font-bold transition-opacity"
                    >
                      Mark as paid
                    </button>
                  )}
                </div>
              ))
            )}
          </div>
        </div>
      </div>

      {/* Recipient Picker Dialog */}
      {recipientPrompt && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm animate-fade-in">
          <div
            className="w-full max-w-sm rounded-3xl bg-surface p-6 shadow-2xl border border-cardStroke animate-morph-in"
            onClick={(e) => e.stopPropagation()}
          >
            <h3 className="text-lg font-bold text-textPrimary tracking-tight">
              Who did {recipientPrompt.debtorName} pay?
            </h3>
            <p className="text-xs text-textSecondary mt-1">
              Total to pay: {formatCurrency(recipientPrompt.amountOwed)}
            </p>

            <div className="mt-4 space-y-2 max-h-56 overflow-y-auto">
              {recipientPrompt.receivers.map((r) => {
                const payAmount = roundToPlaces(
                  Math.min(recipientPrompt.amountOwed, r.amountOwed),
                  2
                );

                return (
                  <button
                    key={r.name}
                    type="button"
                    onClick={() =>
                      handleExecuteSettlement(
                        recipientPrompt.debtorName,
                        r.name,
                        payAmount
                      )
                    }
                    className="w-full text-left p-3 rounded-2xl bg-surfaceAlt hover:bg-surfaceHigh border border-cardStroke transition-colors flex items-center justify-between group"
                  >
                    <div>
                      <p className="text-sm font-bold text-textPrimary">{r.name}</p>
                      <p className="text-xs font-semibold text-settleAccent mt-0.5">
                        Pay {formatCurrency(payAmount)} (owed {formatCurrency(r.amountOwed)})
                      </p>
                    </div>
                  </button>
                );
              })}
            </div>

            <div className="mt-5 pt-3 border-t border-cardStroke flex justify-end">
              <button
                type="button"
                onClick={() => setRecipientPrompt(null)}
                className="px-4 py-2 rounded-xl text-sm font-semibold text-textSecondary bg-surfaceAlt hover:bg-surfaceHigh transition-colors"
              >
                Cancel
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
};

import type {
  Contributor,
  Item,
  ItemConsumer,
  CarryoverTransfer,
  SettlementTransfer,
} from '../types/models';

export const EPSILON = 0.005;

export function roundToPlaces(value: number, places: number = 2): number {
  const factor = Math.pow(10, places);
  return Math.round((value + Number.EPSILON) * factor) / factor;
}

export class BalanceCalculator {
  static calculateNetBalancesById(
    contributors: Contributor[],
    items: Item[],
    itemConsumers: ItemConsumer[]
  ): Map<number, number> {
    const balances = new Map<number, number>();
    for (const c of contributors) {
      balances.set(c.contributorID, 0.0);
    }

    const consumersByItem = new Map<number, ItemConsumer[]>();
    for (const ic of itemConsumers) {
      const list = consumersByItem.get(ic.itemID);
      if (list) {
        list.push(ic);
      } else {
        consumersByItem.set(ic.itemID, [ic]);
      }
    }

    for (const item of items) {
      const amount = item.amount;
      if (amount <= 0.0) continue;

      const payerId = item.payerID;
      const consumersForItem = consumersByItem.get(item.itemID) || [];

      if (consumersForItem.length === 0) {
        balances.set(payerId, (balances.get(payerId) ?? 0.0) + amount);
        continue;
      }

      const useWeighted =
        consumersForItem.length > 1 &&
        (() => {
          const firstWeight = consumersForItem[0].weight;
          return !consumersForItem.every(
            (it) => Math.abs(it.weight - firstWeight) < 0.01
          );
        })();

      if (useWeighted) {
        const sumWeights = consumersForItem.reduce((acc, ic) => acc + ic.weight, 0);
        if (sumWeights > 0.0) {
          for (const ic of consumersForItem) {
            const share = (ic.weight / sumWeights) * amount;
            balances.set(
              ic.contributorID,
              (balances.get(ic.contributorID) ?? 0.0) - share
            );
          }
        } else {
          const share = amount / consumersForItem.length;
          for (const ic of consumersForItem) {
            balances.set(
              ic.contributorID,
              (balances.get(ic.contributorID) ?? 0.0) - share
            );
          }
        }
      } else {
        const share = amount / consumersForItem.length;
        for (const ic of consumersForItem) {
          balances.set(
            ic.contributorID,
            (balances.get(ic.contributorID) ?? 0.0) - share
          );
        }
      }

      balances.set(payerId, (balances.get(payerId) ?? 0.0) + amount);
    }

    const result = new Map<number, number>();
    for (const [id, v] of balances.entries()) {
      const rounded = roundToPlaces(v, 2);
      result.set(id, Math.abs(rounded) < EPSILON ? 0.0 : rounded);
    }
    return result;
  }

  /**
   * Generates minimal debtor -> creditor carryover entries such that inside the new sheet,
   * creditorId acts as payer and debtorId acts as sole consumer, reproducing the exact net balances.
   */
  static generateCarryoverTransfers(
    netBalancesById: Map<number, number>
  ): CarryoverTransfer[] {
    const creditors: Array<{ id: number; balance: number }> = [];
    const debtors: Array<{ id: number; balance: number }> = [];

    for (const [id, val] of netBalancesById.entries()) {
      if (val >= EPSILON) {
        creditors.push({ id, balance: val });
      } else if (val <= -EPSILON) {
        debtors.push({ id, balance: Math.abs(val) });
      }
    }

    creditors.sort((a, b) => b.balance - a.balance);
    debtors.sort((a, b) => b.balance - a.balance);

    const transfers: CarryoverTransfer[] = [];
    let cIdx = 0;
    let dIdx = 0;

    while (cIdx < creditors.length && dIdx < debtors.length) {
      const creditor = creditors[cIdx];
      const debtor = debtors[dIdx];

      const transferAmount = roundToPlaces(
        Math.min(creditor.balance, debtor.balance),
        2
      );
      if (transferAmount >= EPSILON) {
        transfers.push({
          creditorId: creditor.id,
          debtorId: debtor.id,
          amount: transferAmount,
        });
      }

      const nextCredit = roundToPlaces(creditor.balance - transferAmount, 2);
      const nextDebt = roundToPlaces(debtor.balance - transferAmount, 2);

      if (nextCredit < EPSILON) {
        cIdx++;
      } else {
        creditor.balance = nextCredit;
      }

      if (nextDebt < EPSILON) {
        dIdx++;
      } else {
        debtor.balance = nextDebt;
      }
    }

    return transfers;
  }

  /**
   * Generates a minimal list of 1-to-1 settlement transfers ("Who Pays Whom")
   * from net balances where positive = will receive and negative = will give.
   */
  static generateSettlementTransfers(
    netBalances: Map<string, number> | Record<string, number>
  ): SettlementTransfer[] {
    interface Entry {
      name: string;
      cents: number;
    }

    const entriesMap =
      netBalances instanceof Map
        ? Array.from(netBalances.entries())
        : Object.entries(netBalances);

    const creditors: Entry[] = [];
    const debtors: Entry[] = [];

    for (const [name, val] of entriesMap) {
      if (val >= EPSILON) {
        const cents = Math.round(val * 100.0);
        if (cents > 0) creditors.push({ name, cents });
      } else if (val <= -EPSILON) {
        const cents = Math.round(Math.abs(val) * 100.0);
        if (cents > 0) debtors.push({ name, cents });
      }
    }

    const sortFn = (a: Entry, b: Entry) => {
      if (b.cents !== a.cents) return b.cents - a.cents;
      return a.name.toLowerCase().localeCompare(b.name.toLowerCase());
    };

    creditors.sort(sortFn);
    debtors.sort(sortFn);

    const transfers: SettlementTransfer[] = [];

    // Pass 1: Exact 1-to-1 matches first to minimize split payments
    for (const debtor of debtors) {
      if (debtor.cents <= 0) continue;
      const exactCreditor = creditors.find((c) => c.cents === debtor.cents);
      if (exactCreditor) {
        transfers.push({
          fromName: debtor.name,
          toName: exactCreditor.name,
          amount: debtor.cents / 100.0,
        });
        debtor.cents = 0;
        exactCreditor.cents = 0;
      }
    }

    // Pass 2: Greedy largest-to-largest matching for remaining balances
    const remCreditors = creditors.filter((c) => c.cents > 0);
    const remDebtors = debtors.filter((d) => d.cents > 0);

    let cIdx = 0;
    let dIdx = 0;
    while (cIdx < remCreditors.length && dIdx < remDebtors.length) {
      const creditor = remCreditors[cIdx];
      const debtor = remDebtors[dIdx];
      const transferCents = Math.min(creditor.cents, debtor.cents);

      if (transferCents > 0) {
        transfers.push({
          fromName: debtor.name,
          toName: creditor.name,
          amount: transferCents / 100.0,
        });
        creditor.cents -= transferCents;
        debtor.cents -= transferCents;
      }

      if (creditor.cents <= 0) cIdx++;
      if (debtor.cents <= 0) dIdx++;
    }

    return transfers;
  }

  /**
   * Groups all receivers (> 0.005) first (largest first), followed by all givers (< -0.005)
   * (largest owed first), followed by settled-up members.
   */
  static sortBalanceEntries(
    balances: Map<string, number> | Record<string, number>
  ): Array<[string, number]> {
    const list =
      balances instanceof Map
        ? Array.from(balances.entries())
        : Object.entries(balances);

    return list.sort(([nameA, valA], [nameB, valB]) => {
      const group = (v: number) => {
        if (v > EPSILON) return 0;
        if (v < -EPSILON) return 1;
        return 2;
      };

      const groupA = group(valA);
      const groupB = group(valB);
      if (groupA !== groupB) return groupA - groupB;

      if (groupA === 0) {
        // Receivers: highest positive first
        if (valB !== valA) return valB - valA;
      } else if (groupA === 1) {
        // Givers: largest owed (most negative) first -> abs(valA) > abs(valB)
        if (valA !== valB) return valA - valB;
      }

      return nameA.toLowerCase().localeCompare(nameB.toLowerCase());
    });
  }
}

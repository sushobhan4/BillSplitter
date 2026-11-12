import { describe, it, expect } from 'vitest';
import { BalanceCalculator, roundToPlaces } from './BalanceCalculator';
import type { Contributor, Item, ItemConsumer } from '../types/models';
import { ITEM_TYPE } from '../types/models';

describe('BalanceCalculator', () => {
  it('carryoverExcludesSettledContributorsAndPreservesUnsettledBalances', () => {
    const now = 1_700_000_000_000;
    const contributors: Contributor[] = [
      { contributorID: 1, contributorName: 'Alice', sheetID: 1 },
      { contributorID: 2, contributorName: 'Bob', sheetID: 1 },
      { contributorID: 3, contributorName: 'Charlie', sheetID: 1 },
      { contributorID: 4, contributorName: 'Dana', sheetID: 1 },
    ];

    const items: Item[] = [
      {
        itemID: 10,
        sheetID: 1,
        itemName: 'Dinner',
        amount: 300.0,
        payerID: 1,
        dateCreated: now,
        dateModified: now,
        notes: null,
        itemType: ITEM_TYPE.TYPE_EXPENSE,
      },
      {
        itemID: 11,
        sheetID: 1,
        itemName: 'Partial',
        amount: 50.0,
        payerID: 2,
        dateCreated: now,
        dateModified: now,
        notes: null,
        itemType: ITEM_TYPE.TYPE_SETTLEMENT,
      },
    ];

    const itemConsumers: ItemConsumer[] = [
      { itemID: 10, contributorID: 1, weight: 100.0 },
      { itemID: 10, contributorID: 2, weight: 100.0 },
      { itemID: 10, contributorID: 3, weight: 100.0 },
      { itemID: 11, contributorID: 1, weight: 50.0 },
    ];

    const netBalances = BalanceCalculator.calculateNetBalancesById(
      contributors,
      items,
      itemConsumers
    );

    expect(netBalances.get(1)).toBeCloseTo(150.0, 2);
    expect(netBalances.get(2)).toBeCloseTo(-50.0, 2);
    expect(netBalances.get(3)).toBeCloseTo(-100.0, 2);
    expect(netBalances.get(4)).toBe(0.0);

    const unsettledOnly = new Map<number, number>();
    for (const [k, v] of netBalances.entries()) {
      if (Math.abs(v) >= 0.005) unsettledOnly.set(k, v);
    }

    expect(unsettledOnly.has(4)).toBe(false);
    expect(unsettledOnly.has(1)).toBe(true);
    expect(unsettledOnly.has(2)).toBe(true);
    expect(unsettledOnly.has(3)).toBe(true);

    const transfers = BalanceCalculator.generateCarryoverTransfers(unsettledOnly);
    const newContributors = contributors.filter((c) =>
      unsettledOnly.has(c.contributorID)
    );
    const newItems: Item[] = transfers.map((t, idx) => ({
      itemID: 100 + idx,
      sheetID: 2,
      itemName: 'Previous balance',
      amount: t.amount,
      payerID: t.creditorId,
      dateCreated: now,
      dateModified: now,
      notes: null,
      itemType: ITEM_TYPE.TYPE_CARRYOVER,
    }));
    const newConsumers: ItemConsumer[] = transfers.map((t, idx) => ({
      itemID: 100 + idx,
      contributorID: t.debtorId,
      weight: t.amount,
    }));

    const recomputed = BalanceCalculator.calculateNetBalancesById(
      newContributors,
      newItems,
      newConsumers
    );
    expect(recomputed.get(1)).toBeCloseTo(150.0, 2);
    expect(recomputed.get(2)).toBeCloseTo(-50.0, 2);
    expect(recomputed.get(3)).toBeCloseTo(-100.0, 2);
  });

  it('carryoverSupportsMultipleCreditorsAndMultipleDebtors', () => {
    const now = 1_700_000_000_000;
    const netBalances = new Map<number, number>([
      [1, 120.0],
      [2, 80.0],
      [3, -150.0],
      [4, -50.0],
    ]);

    const transfers = BalanceCalculator.generateCarryoverTransfers(netBalances);
    const contributors: Contributor[] = Array.from(netBalances.keys()).map(
      (id) => ({
        contributorID: id,
        contributorName: `User${id}`,
        sheetID: 10,
      })
    );
    const items: Item[] = transfers.map((t, idx) => ({
      itemID: 200 + idx,
      sheetID: 10,
      itemName: 'Previous balance',
      amount: t.amount,
      payerID: t.creditorId,
      dateCreated: now,
      dateModified: now,
      notes: null,
      itemType: ITEM_TYPE.TYPE_CARRYOVER,
    }));
    const consumers: ItemConsumer[] = transfers.map((t, idx) => ({
      itemID: 200 + idx,
      contributorID: t.debtorId,
      weight: t.amount,
    }));

    const recomputed = BalanceCalculator.calculateNetBalancesById(
      contributors,
      items,
      consumers
    );
    expect(recomputed.get(1)).toBeCloseTo(120.0, 2);
    expect(recomputed.get(2)).toBeCloseTo(80.0, 2);
    expect(recomputed.get(3)).toBeCloseTo(-150.0, 2);
    expect(recomputed.get(4)).toBeCloseTo(-50.0, 2);
  });

  it('settlementPlanMatchesTenPersonMultiCreditorAndMultiDebtorScenario', () => {
    const initialBalances: Record<string, number> = {
      Suso: 2835.9,
      Aritra: -284.1,
      Jagannath: -484.1,
      Soham: -304.1,
      Apurba: 386.9,
      Ankit: -484.1,
      Amit: -444.1,
      Debanjan: -254.1,
      Subhadip: -484.1,
      Swaraj: -484.1,
    };

    const transfers = BalanceCalculator.generateSettlementTransfers(initialBalances);
    expect(transfers.length).toBeGreaterThan(0);
    expect(
      transfers.every((t) => t.amount > 0.0 && t.fromName !== t.toName)
    ).toBe(true);

    const mutable: Record<string, number> = { ...initialBalances };
    for (const t of transfers) {
      mutable[t.fromName] = roundToPlaces(mutable[t.fromName] + t.amount, 2);
      mutable[t.toName] = roundToPlaces(mutable[t.toName] - t.amount, 2);
    }

    for (const [name, bal] of Object.entries(mutable)) {
      expect(Math.abs(bal), `${name} should be settled to 0`).toBeLessThan(0.01);
    }
  });

  it('settlementPlanPrioritizesExactAmountMatches', () => {
    const balances: Record<string, number> = {
      Alice: 150.0,
      Bob: 100.0,
      Cam: -100.0,
      Dan: -150.0,
    };
    const transfers = BalanceCalculator.generateSettlementTransfers(balances);
    expect(transfers.length).toBe(2);
    expect(
      transfers.some(
        (t) =>
          t.fromName === 'Dan' &&
          t.toName === 'Alice' &&
          Math.abs(t.amount - 150.0) < 0.01
      )
    ).toBe(true);
    expect(
      transfers.some(
        (t) =>
          t.fromName === 'Cam' &&
          t.toName === 'Bob' &&
          Math.abs(t.amount - 100.0) < 0.01
      )
    ).toBe(true);
  });

  it('sortBalanceEntriesPlacesAllReceiversBeforeAllGivers', () => {
    const mixed = new Map<string, number>([
      ['Aritra', -284.1],
      ['Suso', 2835.9],
      ['Jagannath', -484.1],
      ['Zero', 0.0],
      ['Apurba', 386.9],
      ['Debanjan', -254.1],
    ]);

    const sorted = BalanceCalculator.sortBalanceEntries(mixed);
    expect(sorted.map(([name]) => name)).toEqual([
      'Suso',
      'Apurba',
      'Jagannath',
      'Aritra',
      'Debanjan',
      'Zero',
    ]);
  });
});

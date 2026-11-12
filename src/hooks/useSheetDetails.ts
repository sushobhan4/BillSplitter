import { useState, useEffect, useCallback, useMemo } from 'react';
import { dbClient } from '../db/dbClient';
import type { Sheet, Contributor, ItemWithPayerAndConsumers } from '../types/models';
import { ITEM_TYPE } from '../types/models';

export function useSheetDetails(sheetId: number) {
  const [sheet, setSheet] = useState<Sheet | null>(null);
  const [contributors, setContributors] = useState<Contributor[]>([]);
  const [itemsWithDetails, setItemsWithDetails] = useState<ItemWithPayerAndConsumers[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const fetchDetails = useCallback(async () => {
    if (isNaN(sheetId) || sheetId <= 0) return;
    try {
      const data = await dbClient.getSheetDetails(sheetId);
      setSheet(data.sheet);
      setContributors(data.contributors);
      setItemsWithDetails(data.itemsWithDetails);
      setError(null);
    } catch (err) {
      console.error('[useSheetDetails] fetch failed:', err);
      setError((err as Error).message);
    } finally {
      setLoading(false);
    }
  }, [sheetId]);

  useEffect(() => {
    fetchDetails();
    const unsubscribe = dbClient.subscribeDbChanges(fetchDetails);
    return unsubscribe;
  }, [fetchDetails]);

  // Total spent calculation: ONLY sum items where itemType === TYPE_EXPENSE (0)
  const totalSpent = useMemo(() => {
    return itemsWithDetails
      .filter((it) => it.item.itemType === ITEM_TYPE.TYPE_EXPENSE)
      .reduce((sum, it) => sum + it.item.amount, 0);
  }, [itemsWithDetails]);

  return {
    sheet,
    contributors,
    itemsWithDetails,
    totalSpent,
    loading,
    error,
    refresh: fetchDetails,
  };
}

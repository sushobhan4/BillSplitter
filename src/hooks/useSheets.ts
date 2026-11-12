import { useState, useEffect, useCallback } from 'react';
import { dbClient } from '../db/dbClient';
import type { SheetWithContributorsAndItems } from '../types/models';

export function useSheets() {
  const [sheets, setSheets] = useState<SheetWithContributorsAndItems[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const fetchSheets = useCallback(async () => {
    try {
      const data = await dbClient.getAllSheets();
      setSheets(data);
      setError(null);
    } catch (err) {
      console.error('[useSheets] fetch failed:', err);
      setError((err as Error).message);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchSheets();
    const unsubscribe = dbClient.subscribeDbChanges(fetchSheets);
    return unsubscribe;
  }, [fetchSheets]);

  return { sheets, loading, error, refresh: fetchSheets };
}

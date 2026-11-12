import type {
  SheetWithContributorsAndItems,
  Contributor,
  ItemWithPayerAndConsumers,
  ItemConsumer,
  SheetExportData,
  Sheet,
} from '../types/models';
import { ITEM_TYPE } from '../types/models';

type ChangeListener = () => void;

class DbClient {
  private worker: Worker | null = null;
  private reqId = 1;
  private pending = new Map<
    number,
    { resolve: (val: any) => void; reject: (err: Error) => void }
  >();
  private listeners = new Set<ChangeListener>();
  private isPersistRequested = false;

  private getWorker(): Worker {
    if (!this.worker) {
      this.worker = new Worker(
        new URL('./sqlite.worker.ts', import.meta.url),
        { type: 'module' }
      );

      this.worker.onmessage = (e: MessageEvent) => {
        const data = e.data;
        if (data.type === 'db-changed') {
          for (const listener of this.listeners) {
            listener();
          }
          return;
        }

        const handler = this.pending.get(data.id);
        if (handler) {
          this.pending.delete(data.id);
          if (data.success) {
            handler.resolve(data.result);
          } else {
            handler.reject(new Error(data.error || 'Unknown SQLite worker error'));
          }
        }
      };

      this.worker.onerror = (err) => {
        console.error('[DbClient] Worker encountered an error:', err);
      };

      // Request persistent storage
      if (!this.isPersistRequested && typeof navigator !== 'undefined' && navigator.storage?.persist) {
        this.isPersistRequested = true;
        navigator.storage.persist().then((persistent) => {
          console.log(`[DbClient] Persistent storage granted: ${persistent}`);
        }).catch((err) => {
          console.warn('[DbClient] Failed to request persistent storage:', err);
        });
      }
    }
    return this.worker;
  }

  private call<T>(type: string, payload?: any): Promise<T> {
    const worker = this.getWorker();
    const id = this.reqId++;
    return new Promise<T>((resolve, reject) => {
      this.pending.set(id, { resolve, reject });
      worker.postMessage({ id, type, payload });
    });
  }

  subscribeDbChanges(listener: ChangeListener): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  async getAllSheets(): Promise<SheetWithContributorsAndItems[]> {
    return this.call<SheetWithContributorsAndItems[]>('getAllSheetsWithDetails');
  }

  async getSheetDetails(sheetId: number): Promise<{
    sheet: Sheet | null;
    contributors: Contributor[];
    itemsWithDetails: ItemWithPayerAndConsumers[];
  }> {
    return this.call('getSheetDetails', { sheetId });
  }

  async getItemConsumers(itemId: number): Promise<ItemConsumer[]> {
    return this.call<ItemConsumer[]>('getItemConsumers', { itemId });
  }

  async addSheet(
    sheetName: string,
    notes: string | null,
    contributorNames: string[]
  ): Promise<number> {
    return this.call<number>('addSheet', { sheetName, notes, contributorNames });
  }

  async updateSheet(
    sheetId: number,
    sheetName: string,
    notes: string | null,
    contributorsToUpdate: Record<number, string>
  ): Promise<void> {
    return this.call<void>('updateSheet', {
      sheetId,
      sheetName,
      notes,
      contributorsToUpdate,
    });
  }

  async deleteSheet(sheetId: number): Promise<void> {
    return this.call<void>('deleteSheet', { sheetId });
  }

  async insertItem(
    sheetId: number,
    itemName: string,
    amount: number,
    payerId: number,
    dateMs: number,
    consumerWeights: Array<{ contributorId: number; weight: number }>,
    notes: string | null,
    itemType: number = ITEM_TYPE.TYPE_EXPENSE
  ): Promise<number> {
    return this.call<number>('insertItem', {
      sheetId,
      itemName,
      amount,
      payerId,
      dateMs,
      consumerWeights,
      notes,
      itemType,
    });
  }

  async updateItem(
    sheetId: number,
    itemId: number,
    itemName: string,
    amount: number,
    payerId: number,
    consumerWeights: Array<{ contributorId: number; weight: number }>,
    notes: string | null
  ): Promise<void> {
    return this.call<void>('updateItem', {
      sheetId,
      itemId,
      itemName,
      amount,
      payerId,
      consumerWeights,
      notes,
    });
  }

  async deleteItem(sheetId: number, itemId: number): Promise<void> {
    return this.call<void>('deleteItem', { sheetId, itemId });
  }

  async getExportData(sheetId: number): Promise<SheetExportData | null> {
    return this.call<SheetExportData | null>('getExportData', { sheetId });
  }

  async importSheet(exportData: SheetExportData): Promise<number> {
    return this.call<number>('importSheet', { exportData });
  }

  async getNonZeroCarryoverBalances(
    sheetId: number
  ): Promise<Array<{ id: number; name: string; balance: number }>> {
    return this.call('getNonZeroCarryoverBalances', { sheetId });
  }

  async addClonedSheetWithBalances(
    sheetName: string,
    notes: string | null,
    contributorsWithBalances: Array<{ name: string; balance: number }>,
    sourceSheetName: string
  ): Promise<number> {
    return this.call<number>('addClonedSheetWithBalances', {
      sheetName,
      notes,
      contributorsWithBalances,
      sourceSheetName,
    });
  }
}

export const dbClient = new DbClient();

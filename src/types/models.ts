export interface Sheet {
  sheetID: number;
  sheetName: string;
  dateCreated: number; // Unix timestamp ms
  dateModified: number; // Unix timestamp ms
  notes: string | null;
  isReadOnly: boolean;
}

export interface Contributor {
  contributorID: number;
  contributorName: string;
  sheetID: number;
}

export const ITEM_TYPE = {
  TYPE_EXPENSE: 0,
  TYPE_SETTLEMENT: 1,
  TYPE_MONEY_TRANSFER: 2,
  TYPE_CARRYOVER: 3,
} as const;

export type ItemType = typeof ITEM_TYPE[keyof typeof ITEM_TYPE];

export interface Item {
  itemID: number;
  sheetID: number;
  itemName: string;
  amount: number;
  payerID: number;
  dateCreated: number;
  dateModified: number;
  notes: string | null;
  itemType: ItemType;
}

export interface ItemConsumer {
  itemID: number;
  contributorID: number;
  weight: number; // Monetary share in currency units
}

export interface ItemWithPayerAndConsumers {
  item: Item;
  payer: Contributor;
  consumers: Contributor[];
}

export interface SheetWithContributorsAndItems {
  sheet: Sheet;
  contributors: Contributor[];
  items: Item[];
}

export interface SheetExportData {
  sheet: Sheet;
  contributors: Contributor[];
  items: Item[];
  itemConsumers: ItemConsumer[];
}

export interface CarryoverTransfer {
  creditorId: number;
  debtorId: number;
  amount: number;
}

export interface SettlementTransfer {
  fromName: string;
  toName: string;
  amount: number;
}

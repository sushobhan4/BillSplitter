import sqlite3InitModule from '@sqlite.org/sqlite-wasm';
import type {
  Sheet,
  Contributor,
  Item,
  ItemConsumer,
  SheetExportData,
  SheetWithContributorsAndItems,
  ItemWithPayerAndConsumers,
} from '../types/models';
import { ITEM_TYPE } from '../types/models';
import { BalanceCalculator } from '../utils/BalanceCalculator';

interface WorkerRequest {
  id: number;
  type: string;
  payload?: any;
}

interface WorkerResponse {
  id: number;
  success: boolean;
  result?: any;
  error?: string;
}

let dbInstance: any = null;
let initPromise: Promise<any> | null = null;

const SCHEMA_VERSION = 6;

async function initDb(): Promise<any> {
  if (dbInstance) return dbInstance;
  if (initPromise) return initPromise;

  initPromise = (async () => {
    const sqlite3 = await (sqlite3InitModule as any)({
      print: console.log,
      printErr: console.error,
    });

    let db: any = null;

    if ('installOpfsSAHPoolVfs' in sqlite3) {
      try {
        const poolUtil = await sqlite3.installOpfsSAHPoolVfs({
          name: 'billsplitter-sahpool',
          directory: '.billsplitter',
        });
        db = new poolUtil.OpfsSAHPoolDb('/bill_splitter_database.sqlite3');
        console.log('[SQLite Worker] Opened DB using OPFS SAHPool VFS');
      } catch (e) {
        console.warn('[SQLite Worker] SAHPool VFS failed, attempting standard OpfsDb:', e);
      }
    }

    if (!db && 'oo1' in sqlite3 && 'OpfsDb' in sqlite3.oo1) {
      try {
        db = new sqlite3.oo1.OpfsDb('/bill_splitter_database.sqlite3');
        console.log('[SQLite Worker] Opened DB using OpfsDb');
      } catch (e) {
        console.warn('[SQLite Worker] OpfsDb failed, falling back to in-memory DB:', e);
      }
    }

    if (!db) {
      db = new sqlite3.oo1.DB('/bill_splitter_database.sqlite3', 'c');
      console.warn('[SQLite Worker] Using in-memory/ephemeral SQLite DB');
    }

    // CRITICAL: Always enable foreign keys
    db.exec('PRAGMA foreign_keys = ON;');

    // Run schema migrations
    setupSchema(db);

    dbInstance = db;
    return db;
  })();

  return initPromise;
}

function setupSchema(db: any) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS sheets (
      sheetID INTEGER PRIMARY KEY AUTOINCREMENT,
      sheetName TEXT NOT NULL,
      dateCreated INTEGER NOT NULL,
      dateModified INTEGER NOT NULL DEFAULT 0,
      notes TEXT,
      isReadOnly INTEGER NOT NULL DEFAULT 0
    );

    CREATE TABLE IF NOT EXISTS contributors (
      contributorID INTEGER PRIMARY KEY AUTOINCREMENT,
      contributorName TEXT NOT NULL,
      sheetID INTEGER NOT NULL,
      FOREIGN KEY (sheetID) REFERENCES sheets(sheetID) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS items (
      itemID INTEGER PRIMARY KEY AUTOINCREMENT,
      sheetID INTEGER NOT NULL,
      itemName TEXT NOT NULL,
      amount REAL NOT NULL,
      payerID INTEGER NOT NULL,
      dateCreated INTEGER NOT NULL DEFAULT 0,
      dateModified INTEGER NOT NULL,
      notes TEXT,
      itemType INTEGER NOT NULL DEFAULT 0,
      FOREIGN KEY (sheetID) REFERENCES sheets(sheetID) ON DELETE CASCADE,
      FOREIGN KEY (payerID) REFERENCES contributors(contributorID) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS item_consumers (
      itemID INTEGER NOT NULL,
      contributorID INTEGER NOT NULL,
      weight REAL NOT NULL,
      PRIMARY KEY (itemID, contributorID),
      FOREIGN KEY (itemID) REFERENCES items(itemID) ON DELETE CASCADE,
      FOREIGN KEY (contributorID) REFERENCES contributors(contributorID) ON DELETE CASCADE
    );
  `);

  db.exec(`PRAGMA user_version = ${SCHEMA_VERSION};`);
}

function queryAll(db: any, sql: string, bind: any[] = []): any[] {
  const rows: any[] = [];
  db.exec({
    sql,
    bind,
    rowMode: 'object',
    callback: (row: any) => {
      rows.push(row);
    },
  });
  return rows;
}

function queryOne(db: any, sql: string, bind: any[] = []): any | null {
  const rows = queryAll(db, sql, bind);
  return rows.length > 0 ? rows[0] : null;
}

// -------------------------------------------------------------
// DAO operations mirroring BillSplitterDao & ViewModels
// -------------------------------------------------------------

function getAllSheetsWithDetails(db: any): SheetWithContributorsAndItems[] {
  const sheetsRaw = queryAll(db, `SELECT * FROM sheets ORDER BY dateModified DESC`);
  const results: SheetWithContributorsAndItems[] = [];

  for (const s of sheetsRaw) {
    const sheet: Sheet = {
      sheetID: s.sheetID,
      sheetName: s.sheetName,
      dateCreated: s.dateCreated,
      dateModified: s.dateModified,
      notes: s.notes ?? null,
      isReadOnly: Boolean(s.isReadOnly),
    };

    const contributorsRaw = queryAll(
      db,
      `SELECT * FROM contributors WHERE sheetID = ? ORDER BY contributorName ASC`,
      [sheet.sheetID]
    );
    const contributors: Contributor[] = contributorsRaw.map((c) => ({
      contributorID: c.contributorID,
      contributorName: c.contributorName,
      sheetID: c.sheetID,
    }));

    const itemsRaw = queryAll(
      db,
      `SELECT * FROM items WHERE sheetID = ? ORDER BY dateModified DESC`,
      [sheet.sheetID]
    );
    const items: Item[] = itemsRaw.map((it) => ({
      itemID: it.itemID,
      sheetID: it.sheetID,
      itemName: it.itemName,
      amount: it.amount,
      payerID: it.payerID,
      dateCreated: it.dateCreated,
      dateModified: it.dateModified,
      notes: it.notes ?? null,
      itemType: it.itemType as Item['itemType'],
    }));

    results.push({ sheet, contributors, items });
  }

  return results;
}

function getSheetDetails(db: any, sheetId: number): {
  sheet: Sheet | null;
  contributors: Contributor[];
  itemsWithDetails: ItemWithPayerAndConsumers[];
} {
  const s = queryOne(db, `SELECT * FROM sheets WHERE sheetID = ?`, [sheetId]);
  if (!s) {
    return { sheet: null, contributors: [], itemsWithDetails: [] };
  }

  const sheet: Sheet = {
    sheetID: s.sheetID,
    sheetName: s.sheetName,
    dateCreated: s.dateCreated,
    dateModified: s.dateModified,
    notes: s.notes ?? null,
    isReadOnly: Boolean(s.isReadOnly),
  };

  const contribRaw = queryAll(
    db,
    `SELECT * FROM contributors WHERE sheetID = ? ORDER BY contributorName ASC`,
    [sheetId]
  );
  const contributors: Contributor[] = contribRaw.map((c) => ({
    contributorID: c.contributorID,
    contributorName: c.contributorName,
    sheetID: c.sheetID,
  }));
  const contribMap = new Map<number, Contributor>(contributors.map((c) => [c.contributorID, c]));

  const itemsRaw = queryAll(
    db,
    `SELECT * FROM items WHERE sheetID = ? ORDER BY dateModified DESC`,
    [sheetId]
  );

  const itemsWithDetails: ItemWithPayerAndConsumers[] = [];
  for (const it of itemsRaw) {
    const item: Item = {
      itemID: it.itemID,
      sheetID: it.sheetID,
      itemName: it.itemName,
      amount: it.amount,
      payerID: it.payerID,
      dateCreated: it.dateCreated,
      dateModified: it.dateModified,
      notes: it.notes ?? null,
      itemType: it.itemType as Item['itemType'],
    };

    const payer = contribMap.get(item.payerID) || {
      contributorID: item.payerID,
      contributorName: 'Unknown',
      sheetID: sheetId,
    };

    const consumersRaw = queryAll(
      db,
      `SELECT contributorID, weight FROM item_consumers WHERE itemID = ?`,
      [item.itemID]
    );

    const consumers: Contributor[] = [];
    const consumerWeights: ItemConsumer[] = [];
    for (const c of consumersRaw) {
      consumerWeights.push({
        itemID: item.itemID,
        contributorID: c.contributorID,
        weight: c.weight,
      });
      const found = contribMap.get(c.contributorID);
      if (found) {
        consumers.push(found);
      }
    }

    itemsWithDetails.push({ item, payer, consumers, consumerWeights });
  }

  return { sheet, contributors, itemsWithDetails };
}

function getItemConsumers(db: any, itemId: number): ItemConsumer[] {
  const rows = queryAll(db, `SELECT * FROM item_consumers WHERE itemID = ?`, [itemId]);
  return rows.map((r) => ({
    itemID: r.itemID,
    contributorID: r.contributorID,
    weight: r.weight,
  }));
}

function addSheet(
  db: any,
  sheetName: string,
  notes: string | null,
  contributorNames: string[]
): number {
  const now = Date.now();
  db.exec({
    sql: `INSERT INTO sheets (sheetName, dateCreated, dateModified, notes, isReadOnly) VALUES (?, ?, ?, ?, 0)`,
    bind: [sheetName, now, now, notes],
  });
  const sheetId = queryOne(db, `SELECT last_insert_rowid() AS id`).id;

  for (const name of contributorNames) {
    db.exec({
      sql: `INSERT INTO contributors (contributorName, sheetID) VALUES (?, ?)`,
      bind: [name, sheetId],
    });
  }

  return sheetId;
}

function updateSheet(
  db: any,
  sheetId: number,
  sheetName: string,
  notes: string | null,
  contributorsToUpdate: Record<number, string>
) {
  const existingSheet = queryOne(db, `SELECT isReadOnly FROM sheets WHERE sheetID = ?`, [sheetId]);
  if (!existingSheet || existingSheet.isReadOnly) return;

  const now = Date.now();
  db.exec({
    sql: `UPDATE sheets SET sheetName = ?, notes = ?, dateModified = ? WHERE sheetID = ?`,
    bind: [sheetName, notes, now, sheetId],
  });

  // Contributors logic
  const existingContributors = queryAll(
    db,
    `SELECT * FROM contributors WHERE sheetID = ?`,
    [sheetId]
  );
  const updatedIds = new Set(Object.keys(contributorsToUpdate).map(Number));

  // 1. Delete unused
  for (const c of existingContributors) {
    if (!updatedIds.has(c.contributorID)) {
      const payerCount = queryOne(
        db,
        `SELECT COUNT(*) as count FROM items WHERE payerID = ?`,
        [c.contributorID]
      ).count;
      const consumerCount = queryOne(
        db,
        `SELECT COUNT(*) as count FROM item_consumers WHERE contributorID = ?`,
        [c.contributorID]
      ).count;
      if (payerCount === 0 && consumerCount === 0) {
        db.exec({
          sql: `DELETE FROM contributors WHERE contributorID = ?`,
          bind: [c.contributorID],
        });
      }
    }
  }

  // 2. Add new (id <= 0) and update existing (id > 0)
  for (const [idStr, name] of Object.entries(contributorsToUpdate)) {
    const id = Number(idStr);
    if (id <= 0) {
      db.exec({
        sql: `INSERT INTO contributors (contributorName, sheetID) VALUES (?, ?)`,
        bind: [name, sheetId],
      });
    } else {
      db.exec({
        sql: `UPDATE contributors SET contributorName = ? WHERE contributorID = ?`,
        bind: [name, id],
      });
    }
  }
}

function deleteSheet(db: any, sheetId: number) {
  const id = Number(sheetId);
  if (isNaN(id) || id <= 0) return;

  const existingSheet = queryOne(db, `SELECT * FROM sheets WHERE sheetID = ?`, [id]);
  if (!existingSheet) return;

  // Turn foreign keys off during sheet cascade delete to eliminate any cyclic or cross-sheet constraint lock
  db.exec('PRAGMA foreign_keys = OFF;');
  db.exec('BEGIN TRANSACTION;');
  try {
    // 1. Delete all item consumers for items belonging to this sheet
    db.exec({
      sql: `DELETE FROM item_consumers WHERE itemID IN (SELECT itemID FROM items WHERE sheetID = ?)`,
      bind: [id],
    });

    // 2. Delete all item consumers referencing contributors belonging to this sheet
    db.exec({
      sql: `DELETE FROM item_consumers WHERE contributorID IN (SELECT contributorID FROM contributors WHERE sheetID = ?)`,
      bind: [id],
    });

    // 3. Delete all items in this sheet
    db.exec({
      sql: `DELETE FROM items WHERE sheetID = ?`,
      bind: [id],
    });

    // 4. Delete all items whose payer belongs to this sheet
    db.exec({
      sql: `DELETE FROM items WHERE payerID IN (SELECT contributorID FROM contributors WHERE sheetID = ?)`,
      bind: [id],
    });

    // 5. Delete all contributors in this sheet
    db.exec({
      sql: `DELETE FROM contributors WHERE sheetID = ?`,
      bind: [id],
    });

    // 6. Delete the sheet row itself
    db.exec({
      sql: `DELETE FROM sheets WHERE sheetID = ?`,
      bind: [id],
    });

    db.exec('COMMIT;');
  } catch (err) {
    db.exec('ROLLBACK;');
    throw err;
  } finally {
    db.exec('PRAGMA foreign_keys = ON;');
  }
}

function insertItem(
  db: any,
  sheetId: number,
  itemName: string,
  amount: number,
  payerId: number,
  dateMs: number,
  consumerWeights: Array<{ contributorId: number; weight: number }>,
  notes: string | null,
  itemType: number = ITEM_TYPE.TYPE_EXPENSE
): number {
  const existingSheet = queryOne(db, `SELECT isReadOnly FROM sheets WHERE sheetID = ?`, [sheetId]);
  if (!existingSheet || existingSheet.isReadOnly) {
    throw new Error('This sheet is read-only.');
  }

  const now = Date.now();
  db.exec({
    sql: `INSERT INTO items (sheetID, itemName, amount, payerID, dateCreated, dateModified, notes, itemType)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    bind: [sheetId, itemName, amount, payerId, dateMs, now, notes, itemType],
  });
  const itemId = queryOne(db, `SELECT last_insert_rowid() AS id`).id;

  for (const cw of consumerWeights) {
    db.exec({
      sql: `INSERT INTO item_consumers (itemID, contributorID, weight) VALUES (?, ?, ?)`,
      bind: [itemId, cw.contributorId, cw.weight],
    });
  }

  db.exec({
    sql: `UPDATE sheets SET dateModified = ? WHERE sheetID = ?`,
    bind: [now, sheetId],
  });

  return itemId;
}

function updateItem(
  db: any,
  sheetId: number,
  itemId: number,
  itemName: string,
  amount: number,
  payerId: number,
  consumerWeights: Array<{ contributorId: number; weight: number }>,
  notes: string | null
) {
  const existingSheet = queryOne(db, `SELECT isReadOnly FROM sheets WHERE sheetID = ?`, [sheetId]);
  if (!existingSheet || existingSheet.isReadOnly) {
    throw new Error('This sheet is read-only.');
  }

  const now = Date.now();
  db.exec({
    sql: `UPDATE items SET itemName = ?, amount = ?, payerID = ?, dateModified = ?, notes = ? WHERE itemID = ?`,
    bind: [itemName, amount, payerId, now, notes, itemId],
  });

  db.exec({
    sql: `DELETE FROM item_consumers WHERE itemID = ?`,
    bind: [itemId],
  });

  for (const cw of consumerWeights) {
    db.exec({
      sql: `INSERT INTO item_consumers (itemID, contributorID, weight) VALUES (?, ?, ?)`,
      bind: [itemId, cw.contributorId, cw.weight],
    });
  }

  db.exec({
    sql: `UPDATE sheets SET dateModified = ? WHERE sheetID = ?`,
    bind: [now, sheetId],
  });
}

function deleteItem(db: any, sheetId: number, itemId: number) {
  const existingSheet = queryOne(db, `SELECT isReadOnly FROM sheets WHERE sheetID = ?`, [sheetId]);
  if (!existingSheet || existingSheet.isReadOnly) {
    throw new Error('This sheet is read-only.');
  }

  db.exec({
    sql: `DELETE FROM item_consumers WHERE itemID = ?`,
    bind: [itemId],
  });

  db.exec({
    sql: `DELETE FROM items WHERE itemID = ?`,
    bind: [itemId],
  });

  db.exec({
    sql: `UPDATE sheets SET dateModified = ? WHERE sheetID = ?`,
    bind: [Date.now(), sheetId],
  });
}

function getExportData(db: any, sheetId: number): SheetExportData | null {
  const s = queryOne(db, `SELECT * FROM sheets WHERE sheetID = ?`, [sheetId]);
  if (!s) return null;

  const sheet: Sheet = {
    sheetID: s.sheetID,
    sheetName: s.sheetName,
    dateCreated: s.dateCreated,
    dateModified: s.dateModified,
    notes: s.notes ?? null,
    isReadOnly: Boolean(s.isReadOnly),
  };

  const contribRaw = queryAll(db, `SELECT * FROM contributors WHERE sheetID = ?`, [sheetId]);
  const contributors: Contributor[] = contribRaw.map((c) => ({
    contributorID: c.contributorID,
    contributorName: c.contributorName,
    sheetID: c.sheetID,
  }));

  const itemsRaw = queryAll(db, `SELECT * FROM items WHERE sheetID = ?`, [sheetId]);
  const items: Item[] = itemsRaw.map((it) => ({
    itemID: it.itemID,
    sheetID: it.sheetID,
    itemName: it.itemName,
    amount: it.amount,
    payerID: it.payerID,
    dateCreated: it.dateCreated,
    dateModified: it.dateModified,
    notes: it.notes ?? null,
    itemType: it.itemType as Item['itemType'],
  }));

  const consumersRaw = queryAll(
    db,
    `SELECT ic.* FROM item_consumers ic INNER JOIN items i ON ic.itemID = i.itemID WHERE i.sheetID = ?`,
    [sheetId]
  );
  const itemConsumers: ItemConsumer[] = consumersRaw.map((ic) => ({
    itemID: ic.itemID,
    contributorID: ic.contributorID,
    weight: ic.weight,
  }));

  return { sheet, contributors, items, itemConsumers };
}

function importSheet(db: any, exportData: SheetExportData): number {
  let newSheetId = 0;
  db.exec('BEGIN TRANSACTION;');
  try {
    const s = exportData.sheet;
    db.exec({
      sql: `INSERT INTO sheets (sheetName, dateCreated, dateModified, notes, isReadOnly) VALUES (?, ?, ?, ?, ?)`,
      bind: [s.sheetName, s.dateCreated, s.dateModified, s.notes, s.isReadOnly ? 1 : 0],
    });
    newSheetId = queryOne(db, `SELECT last_insert_rowid() AS id`).id;

    const contributorIdMap = new Map<number, number>();
    const itemIdMap = new Map<number, number>();

    const sortedContributors = [...exportData.contributors].sort(
      (a, b) => a.contributorID - b.contributorID
    );
    for (const c of sortedContributors) {
      db.exec({
        sql: `INSERT INTO contributors (contributorName, sheetID) VALUES (?, ?)`,
        bind: [c.contributorName, newSheetId],
      });
      const newContribId = queryOne(db, `SELECT last_insert_rowid() AS id`).id;
      contributorIdMap.set(c.contributorID, newContribId);
    }

    const sortedItems = [...exportData.items].sort((a, b) => a.itemID - b.itemID);
    for (const it of sortedItems) {
      const newPayerId = contributorIdMap.get(it.payerID);
      if (!newPayerId) {
        throw new Error('The sheet file is missing a payer.');
      }
      db.exec({
        sql: `INSERT INTO items (sheetID, itemName, amount, payerID, dateCreated, dateModified, notes, itemType)
              VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
        bind: [
          newSheetId,
          it.itemName,
          it.amount,
          newPayerId,
          it.dateCreated,
          it.dateModified,
          it.notes,
          it.itemType ?? ITEM_TYPE.TYPE_EXPENSE,
        ],
      });
      const newItemId = queryOne(db, `SELECT last_insert_rowid() AS id`).id;
      itemIdMap.set(it.itemID, newItemId);
    }

    for (const ic of exportData.itemConsumers) {
      const newItemId = itemIdMap.get(ic.itemID);
      if (!newItemId) throw new Error('The sheet file is missing an expense item.');
      const newContribId = contributorIdMap.get(ic.contributorID);
      if (!newContribId) throw new Error('The sheet file is missing a consumer contributor.');

      db.exec({
        sql: `INSERT INTO item_consumers (itemID, contributorID, weight) VALUES (?, ?, ?)`,
        bind: [newItemId, newContribId, ic.weight],
      });
    }

    db.exec('COMMIT;');
    return newSheetId;
  } catch (err) {
    db.exec('ROLLBACK;');
    throw err;
  }
}

function getNonZeroCarryoverBalances(db: any, sheetId: number): Array<{ id: number; name: string; balance: number }> {
  const contribRaw = queryAll(db, `SELECT * FROM contributors WHERE sheetID = ?`, [sheetId]);
  const contributors: Contributor[] = contribRaw.map((c) => ({
    contributorID: c.contributorID,
    contributorName: c.contributorName,
    sheetID: c.sheetID,
  }));

  const itemsRaw = queryAll(db, `SELECT * FROM items WHERE sheetID = ?`, [sheetId]);
  const items: Item[] = itemsRaw.map((it) => ({
    itemID: it.itemID,
    sheetID: it.sheetID,
    itemName: it.itemName,
    amount: it.amount,
    payerID: it.payerID,
    dateCreated: it.dateCreated,
    dateModified: it.dateModified,
    notes: it.notes ?? null,
    itemType: it.itemType as Item['itemType'],
  }));

  const consumersRaw = queryAll(
    db,
    `SELECT ic.* FROM item_consumers ic INNER JOIN items i ON ic.itemID = i.itemID WHERE i.sheetID = ?`,
    [sheetId]
  );
  const itemConsumers: ItemConsumer[] = consumersRaw.map((ic) => ({
    itemID: ic.itemID,
    contributorID: ic.contributorID,
    weight: ic.weight,
  }));

  const balancesMap = BalanceCalculator.calculateNetBalancesById(
    contributors,
    items,
    itemConsumers
  );

  const results: Array<{ id: number; name: string; balance: number }> = [];
  for (const c of contributors) {
    const bal = balancesMap.get(c.contributorID) ?? 0.0;
    if (Math.abs(bal) >= 0.005) {
      results.push({ id: c.contributorID, name: c.contributorName, balance: bal });
    }
  }
  return results;
}

function addClonedSheetWithBalances(
  db: any,
  sheetName: string,
  notes: string | null,
  contributorsWithBalances: Array<{ name: string; balance: number }>,
  sourceSheetName: string
): number {
  let newSheetId = 0;
  db.exec('BEGIN TRANSACTION;');
  try {
    const now = Date.now();
    db.exec({
      sql: `INSERT INTO sheets (sheetName, dateCreated, dateModified, notes, isReadOnly) VALUES (?, ?, ?, ?, 0)`,
      bind: [sheetName, now, now, notes],
    });
    newSheetId = queryOne(db, `SELECT last_insert_rowid() AS id`).id;

    const balanceByNewContributorId = new Map<number, number>();
    for (const item of contributorsWithBalances) {
      db.exec({
        sql: `INSERT INTO contributors (contributorName, sheetID) VALUES (?, ?)`,
        bind: [item.name, newSheetId],
      });
      const newContribId = queryOne(db, `SELECT last_insert_rowid() AS id`).id;
      if (Math.abs(item.balance) >= 0.005) {
        balanceByNewContributorId.set(newContribId, item.balance);
      }
    }

    const carryoverTransfers = BalanceCalculator.generateCarryoverTransfers(
      balanceByNewContributorId
    );
    const carryNote = sourceSheetName.trim()
      ? `Carried forward from ${sourceSheetName}`
      : 'Carried forward balance';

    for (const transfer of carryoverTransfers) {
      db.exec({
        sql: `INSERT INTO items (sheetID, itemName, amount, payerID, dateCreated, dateModified, notes, itemType)
              VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
        bind: [
          newSheetId,
          'Previous balance',
          transfer.amount,
          transfer.creditorId,
          now,
          now,
          carryNote,
          ITEM_TYPE.TYPE_CARRYOVER,
        ],
      });
      const newItemId = queryOne(db, `SELECT last_insert_rowid() AS id`).id;

      db.exec({
        sql: `INSERT INTO item_consumers (itemID, contributorID, weight) VALUES (?, ?, ?)`,
        bind: [newItemId, transfer.debtorId, transfer.amount],
      });
    }

    db.exec('COMMIT;');
    return newSheetId;
  } catch (err) {
    db.exec('ROLLBACK;');
    throw err;
  }
}

// -------------------------------------------------------------
// Web Worker message listener
// -------------------------------------------------------------

self.onmessage = async (e: MessageEvent<WorkerRequest>) => {
  const { id, type, payload } = e.data;
  try {
    const db = await initDb();
    let result: any = null;
    let notifyDbChange = false;

    switch (type) {
      case 'getAllSheetsWithDetails':
        result = getAllSheetsWithDetails(db);
        break;

      case 'getSheetDetails':
        result = getSheetDetails(db, payload.sheetId);
        break;

      case 'getItemConsumers':
        result = getItemConsumers(db, payload.itemId);
        break;

      case 'addSheet':
        result = addSheet(db, payload.sheetName, payload.notes, payload.contributorNames);
        notifyDbChange = true;
        break;

      case 'updateSheet':
        updateSheet(
          db,
          payload.sheetId,
          payload.sheetName,
          payload.notes,
          payload.contributorsToUpdate
        );
        notifyDbChange = true;
        break;

      case 'deleteSheet':
        deleteSheet(db, payload.sheetId);
        notifyDbChange = true;
        break;

      case 'insertItem':
        result = insertItem(
          db,
          payload.sheetId,
          payload.itemName,
          payload.amount,
          payload.payerId,
          payload.dateMs,
          payload.consumerWeights,
          payload.notes,
          payload.itemType
        );
        notifyDbChange = true;
        break;

      case 'updateItem':
        updateItem(
          db,
          payload.sheetId,
          payload.itemId,
          payload.itemName,
          payload.amount,
          payload.payerId,
          payload.consumerWeights,
          payload.notes
        );
        notifyDbChange = true;
        break;

      case 'deleteItem':
        deleteItem(db, payload.sheetId, payload.itemId);
        notifyDbChange = true;
        break;

      case 'getExportData':
        result = getExportData(db, payload.sheetId);
        break;

      case 'importSheet':
        result = importSheet(db, payload.exportData);
        notifyDbChange = true;
        break;

      case 'getNonZeroCarryoverBalances':
        result = getNonZeroCarryoverBalances(db, payload.sheetId);
        break;

      case 'addClonedSheetWithBalances':
        result = addClonedSheetWithBalances(
          db,
          payload.sheetName,
          payload.notes,
          payload.contributorsWithBalances,
          payload.sourceSheetName
        );
        notifyDbChange = true;
        break;

      default:
        throw new Error(`Unknown worker command: ${type}`);
    }

    const response: WorkerResponse = { id, success: true, result };
    self.postMessage(response);

    if (notifyDbChange) {
      self.postMessage({ id: -1, type: 'db-changed' });
    }
  } catch (error) {
    const response: WorkerResponse = {
      id,
      success: false,
      error: (error as Error).message || String(error),
    };
    self.postMessage(response);
  }
};

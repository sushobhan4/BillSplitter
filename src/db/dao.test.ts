import { describe, it, expect } from 'vitest';
import sqlite3InitModule from '@sqlite.org/sqlite-wasm';

describe('SQLite WASM core engine', () => {
  it('initializes SQLite in-memory and verifies foreign key cascade', async () => {
    const sqlite3 = await (sqlite3InitModule as any)();
    const db = new sqlite3.oo1.DB(':memory:', 'c');

    db.exec('PRAGMA foreign_keys = ON;');

    db.exec(`
      CREATE TABLE sheets (
        sheetID INTEGER PRIMARY KEY AUTOINCREMENT,
        sheetName TEXT NOT NULL,
        dateCreated INTEGER NOT NULL,
        dateModified INTEGER NOT NULL DEFAULT 0,
        notes TEXT,
        isReadOnly INTEGER NOT NULL DEFAULT 0
      );

      CREATE TABLE contributors (
        contributorID INTEGER PRIMARY KEY AUTOINCREMENT,
        contributorName TEXT NOT NULL,
        sheetID INTEGER NOT NULL,
        FOREIGN KEY (sheetID) REFERENCES sheets(sheetID) ON DELETE CASCADE
      );

      CREATE TABLE items (
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

      CREATE TABLE item_consumers (
        itemID INTEGER NOT NULL,
        contributorID INTEGER NOT NULL,
        weight REAL NOT NULL,
        PRIMARY KEY (itemID, contributorID),
        FOREIGN KEY (itemID) REFERENCES items(itemID) ON DELETE CASCADE,
        FOREIGN KEY (contributorID) REFERENCES contributors(contributorID) ON DELETE CASCADE
      );
    `);

    // Insert sheet
    db.exec({
      sql: `INSERT INTO sheets (sheetName, dateCreated, dateModified, notes, isReadOnly) VALUES (?, ?, ?, ?, ?)`,
      bind: ['Goa Trip', 1000, 1000, 'Fun trip', 0],
    });

    let row = db.selectObject('SELECT last_insert_rowid() AS id');
    const sheetId = row.id;
    expect(sheetId).toBe(1);

    // Insert 2 contributors
    db.exec({
      sql: `INSERT INTO contributors (contributorName, sheetID) VALUES (?, ?), (?, ?)`,
      bind: ['Alice', sheetId, 'Bob', sheetId],
    });

    const contribs = db.selectObjects('SELECT * FROM contributors WHERE sheetID = ?', [sheetId]);
    expect(contribs.length).toBe(2);
    const aliceId = contribs[0].contributorID;
    const bobId = contribs[1].contributorID;

    // Insert 1 item paid by Alice, consumed by Alice & Bob
    db.exec({
      sql: `INSERT INTO items (sheetID, itemName, amount, payerID, dateCreated, dateModified, notes, itemType)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      bind: [sheetId, 'Dinner', 200.0, aliceId, 1000, 1000, 'Tasty food', 0],
    });
    const itemId = db.selectObject('SELECT last_insert_rowid() AS id').id;

    db.exec({
      sql: `INSERT INTO item_consumers (itemID, contributorID, weight) VALUES (?, ?, ?), (?, ?, ?)`,
      bind: [itemId, aliceId, 100.0, itemId, bobId, 100.0],
    });

    let consumers = db.selectObjects('SELECT * FROM item_consumers WHERE itemID = ?', [itemId]);
    expect(consumers.length).toBe(2);

    // Insert 1 carryover item: paid by Alice (creditor), consumed by Bob (debtor)
    db.exec({
      sql: `INSERT INTO items (sheetID, itemName, amount, payerID, dateCreated, dateModified, notes, itemType)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      bind: [sheetId, 'Previous balance', 100.0, aliceId, 1000, 1000, 'Carried forward', 3],
    });
    const carryItemId = db.selectObject('SELECT last_insert_rowid() AS id').id;

    db.exec({
      sql: `INSERT INTO item_consumers (itemID, contributorID, weight) VALUES (?, ?, ?)`,
      bind: [carryItemId, bobId, 100.0],
    });

    // Delete sheet -> verify cascade delete of contributors, items, and item_consumers!
    db.exec({
      sql: `DELETE FROM sheets WHERE sheetID = ?`,
      bind: [sheetId],
    });

    expect(db.selectObjects('SELECT * FROM sheets').length).toBe(0);
    expect(db.selectObjects('SELECT * FROM contributors').length).toBe(0);
    expect(db.selectObjects('SELECT * FROM items').length).toBe(0);
    expect(db.selectObjects('SELECT * FROM item_consumers').length).toBe(0);

    db.close();
  });

  it('reproduces cloning and deleting cloned sheet while main sheet exists', async () => {
    const sqlite3 = await (sqlite3InitModule as any)();
    const db = new sqlite3.oo1.DB(':memory:', 'c');
    db.exec('PRAGMA foreign_keys = ON;');

    db.exec(`
      CREATE TABLE sheets (
        sheetID INTEGER PRIMARY KEY AUTOINCREMENT,
        sheetName TEXT NOT NULL,
        dateCreated INTEGER NOT NULL,
        dateModified INTEGER NOT NULL DEFAULT 0,
        notes TEXT,
        isReadOnly INTEGER NOT NULL DEFAULT 0
      );

      CREATE TABLE contributors (
        contributorID INTEGER PRIMARY KEY AUTOINCREMENT,
        contributorName TEXT NOT NULL,
        sheetID INTEGER NOT NULL,
        FOREIGN KEY (sheetID) REFERENCES sheets(sheetID) ON DELETE CASCADE
      );

      CREATE TABLE items (
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

      CREATE TABLE item_consumers (
        itemID INTEGER NOT NULL,
        contributorID INTEGER NOT NULL,
        weight REAL NOT NULL,
        PRIMARY KEY (itemID, contributorID),
        FOREIGN KEY (itemID) REFERENCES items(itemID) ON DELETE CASCADE,
        FOREIGN KEY (contributorID) REFERENCES contributors(contributorID) ON DELETE CASCADE
      );
    `);

    // Helper functions mirroring sqlite.worker.ts
    function queryAll(sql: string, bind: any[] = []): any[] {
      const rows: any[] = [];
      db.exec({
        sql,
        bind,
        rowMode: 'object',
        callback: (row: any) => rows.push(row),
      });
      return rows;
    }

    function queryOne(sql: string, bind: any[] = []): any | null {
      const rows = queryAll(sql, bind);
      return rows.length > 0 ? rows[0] : null;
    }

    function deleteSheet(sheetId: number) {
      const id = Number(sheetId);
      if (isNaN(id) || id <= 0) return;
      const existingSheet = queryOne(`SELECT * FROM sheets WHERE sheetID = ?`, [id]);
      if (!existingSheet) return;

      db.exec('PRAGMA foreign_keys = OFF;');
      db.exec('BEGIN TRANSACTION;');
      try {
        db.exec({
          sql: `DELETE FROM item_consumers WHERE itemID IN (SELECT itemID FROM items WHERE sheetID = ?)`,
          bind: [id],
        });
        db.exec({
          sql: `DELETE FROM item_consumers WHERE contributorID IN (SELECT contributorID FROM contributors WHERE sheetID = ?)`,
          bind: [id],
        });
        db.exec({
          sql: `DELETE FROM items WHERE sheetID = ?`,
          bind: [id],
        });
        db.exec({
          sql: `DELETE FROM items WHERE payerID IN (SELECT contributorID FROM contributors WHERE sheetID = ?)`,
          bind: [id],
        });
        db.exec({
          sql: `DELETE FROM contributors WHERE sheetID = ?`,
          bind: [id],
        });
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

    // 1. Create main sheet
    db.exec({
      sql: `INSERT INTO sheets (sheetName, dateCreated, dateModified, notes, isReadOnly) VALUES (?, ?, ?, ?, ?)`,
      bind: ['Main Sheet', 1000, 1000, '', 0],
    });
    const mainSheetId = queryOne('SELECT last_insert_rowid() AS id').id;

    db.exec({
      sql: `INSERT INTO contributors (contributorName, sheetID) VALUES (?, ?), (?, ?)`,
      bind: ['Alice', mainSheetId, 'Bob', mainSheetId],
    });
    const aliceMainId = queryOne(`SELECT contributorID FROM contributors WHERE sheetID = ? AND contributorName = ?`, [mainSheetId, 'Alice']).contributorID;
    const bobMainId = queryOne(`SELECT contributorID FROM contributors WHERE sheetID = ? AND contributorName = ?`, [mainSheetId, 'Bob']).contributorID;

    // Add item in main sheet
    db.exec({
      sql: `INSERT INTO items (sheetID, itemName, amount, payerID, dateCreated, dateModified, notes, itemType)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      bind: [mainSheetId, 'Lunch', 60.0, aliceMainId, 1000, 1000, '', 0],
    });
    const mainItemId = queryOne('SELECT last_insert_rowid() AS id').id;
    db.exec({
      sql: `INSERT INTO item_consumers (itemID, contributorID, weight) VALUES (?, ?, ?), (?, ?, ?)`,
      bind: [mainItemId, aliceMainId, 30.0, mainItemId, bobMainId, 30.0],
    });

    // 2. Clone sheet (Empty clone)
    db.exec({
      sql: `INSERT INTO sheets (sheetName, dateCreated, dateModified, notes, isReadOnly) VALUES (?, ?, ?, ?, ?)`,
      bind: ['Empty Clone', 2000, 2000, '', 0],
    });
    const emptyCloneId = queryOne('SELECT last_insert_rowid() AS id').id;
    db.exec({
      sql: `INSERT INTO contributors (contributorName, sheetID) VALUES (?, ?), (?, ?)`,
      bind: ['Alice', emptyCloneId, 'Bob', emptyCloneId],
    });

    // Try deleting empty clone while main sheet exists
    expect(() => deleteSheet(emptyCloneId)).not.toThrow();

    // 3. Clone sheet WITH CARRYOVER BALANCES
    db.exec({
      sql: `INSERT INTO sheets (sheetName, dateCreated, dateModified, notes, isReadOnly) VALUES (?, ?, ?, ?, ?)`,
      bind: ['Carryover Clone', 3000, 3000, '', 0],
    });
    const carryCloneId = queryOne('SELECT last_insert_rowid() AS id').id;
    db.exec({
      sql: `INSERT INTO contributors (contributorName, sheetID) VALUES (?, ?), (?, ?)`,
      bind: ['Alice', carryCloneId, 'Bob', carryCloneId],
    });
    const aliceCarryId = queryOne(`SELECT contributorID FROM contributors WHERE sheetID = ? AND contributorName = ?`, [carryCloneId, 'Alice']).contributorID;
    const bobCarryId = queryOne(`SELECT contributorID FROM contributors WHERE sheetID = ? AND contributorName = ?`, [carryCloneId, 'Bob']).contributorID;

    // Add carryover item
    db.exec({
      sql: `INSERT INTO items (sheetID, itemName, amount, payerID, dateCreated, dateModified, notes, itemType)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      bind: [carryCloneId, 'Previous balance', 30.0, aliceCarryId, 3000, 3000, 'Carried forward', 3],
    });
    const carryItemId = queryOne('SELECT last_insert_rowid() AS id').id;
    db.exec({
      sql: `INSERT INTO item_consumers (itemID, contributorID, weight) VALUES (?, ?, ?)`,
      bind: [carryItemId, bobCarryId, 30.0],
    });

    // Try deleting carryover clone while main sheet exists
    expect(() => deleteSheet(carryCloneId)).not.toThrow();

    // Verify main sheet and its items/consumers still exist and are untouched
    expect(queryOne('SELECT COUNT(*) as count FROM sheets WHERE sheetID = ?', [mainSheetId]).count).toBe(1);
    expect(queryOne('SELECT COUNT(*) as count FROM items WHERE sheetID = ?', [mainSheetId]).count).toBe(1);
    expect(queryOne('SELECT COUNT(*) as count FROM contributors WHERE sheetID = ?', [mainSheetId]).count).toBe(2);

    // Verify carryover clone and all its items/consumers/contributors are completely gone
    expect(queryOne('SELECT COUNT(*) as count FROM sheets WHERE sheetID = ?', [carryCloneId]).count).toBe(0);
    expect(queryOne('SELECT COUNT(*) as count FROM items WHERE sheetID = ?', [carryCloneId]).count).toBe(0);
    expect(queryOne('SELECT COUNT(*) as count FROM contributors WHERE sheetID = ?', [carryCloneId]).count).toBe(0);

    // 4. Test deleting main sheet
    expect(() => deleteSheet(mainSheetId)).not.toThrow();
    expect(queryOne('SELECT COUNT(*) as count FROM sheets').count).toBe(0);
    expect(queryOne('SELECT COUNT(*) as count FROM contributors').count).toBe(0);
    expect(queryOne('SELECT COUNT(*) as count FROM items').count).toBe(0);
    expect(queryOne('SELECT COUNT(*) as count FROM item_consumers').count).toBe(0);

    db.close();
  });
});

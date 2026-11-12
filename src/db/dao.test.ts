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
});

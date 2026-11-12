# BillSplitter Universal PWA — Agent Guide (`agents.md`)

## 1. Project Overview & Goal
**BillSplitter Universal (`web-universal/`)** is an offline-first Progressive Web App (PWA) built with **React + TypeScript** that provides a **1-to-1 functional, visual, and file-format clone** of the native Android application in [`../android-app/`](../android-app/).

Users can track shared group expenses across "sheets" (trips, events, household ledgers), split costs equally or by custom amounts/percentages, record settlements and direct money transfers, clone sheets with carryover balances, compute minimal "Who Pays Whom" settlement plans, and import/export encrypted `.bsplit` files seamlessly between Android and any desktop or mobile browser.

- **Source of Truth for Parity**: [`../android-app/`](../android-app/) (Room DB v6, `.bsplit` Binary Codec v4).
- **Primary Currency Display**: Indian Rupees (`₹` / `\u20B9`) formatted with thousands separators and 2 decimals (`₹1,250.00`), matching the Android app.
- **Offline-First Guarantee**: All application assets (including the SQLite `.wasm` binary) are precached by a Service Worker, and all user data lives locally in a persistent **SQLite database backed by OPFS** (Origin Private File System).

---

## 2. Tech Stack & Tooling

### Core Stack
- **Build Tool**: Vite + TypeScript (strict mode)
- **UI Framework**: React 18/19 + React Router (or hash/history routing for `/` and `/sheet/:sheetId`)
- **Icons**: `lucide-react` (matches Android's Lucide `24x24` `strokeWidth=2` round cap/join `VectorDrawable` assets)
- **Database**: `@sqlite.org/sqlite-wasm` running inside a **Dedicated Web Worker**
- **SQLite Persistence**: **OPFS** via the `opfs-sahpool` VFS
- **PWA**: `vite-plugin-pwa` (Workbox) configured to precache `.wasm`, JS, CSS, HTML, and icons
- **Crypto (`.bsplit`)**: Browser-native **Web Crypto API** (`crypto.subtle`) + `DataView` / `TextEncoder` / `TextDecoder`
- **Testing**: Vitest (unit tests for domain logic, binary codec, and SQL queries) + Playwright (E2E persistence across reloads & offline mode)

### Why `opfs-sahpool` VFS?
- Standard `@sqlite.org/sqlite-wasm` `opfs` VFS requires `SharedArrayBuffer`, which requires `Cross-Origin-Opener-Policy: same-origin` and `Cross-Origin-Embedder-Policy: require-corp` HTTP headers. Many static hosts (e.g., GitHub Pages) do not allow custom response headers.
- **`opfs-sahpool`** provides synchronous, high-performance OPFS persistence inside a Web Worker **without requiring COOP/COEP headers**.
- **Trade-off to manage**: `opfs-sahpool` acquires an exclusive `SyncAccessHandle` lock per origin. A single active tab/worker must own the connection (see Section 4).

---

## 3. Database Schema & Migrations (`SQLite WASM`)

Mirror the Android Room v6 schema (`bill_splitter_database`) verbatim so SQL semantics, constraints, and `.bsplit` mapping remain 1-to-1.

### Mandatory Connection Pragmas
Every time the SQLite Worker opens the database connection, it **MUST** execute:
```sql
PRAGMA foreign_keys = ON;
```
> **Critical**: Room enables foreign keys automatically, whereas raw SQLite defaults to `foreign_keys = OFF`. Without this pragma, `ON DELETE CASCADE` will silently fail and leave orphan rows.

### Tables (Schema Version 6)

1. **`sheets`**
   ```sql
   CREATE TABLE IF NOT EXISTS sheets (
     sheetID INTEGER PRIMARY KEY AUTOINCREMENT,
     sheetName TEXT NOT NULL,
     dateCreated INTEGER NOT NULL,
     dateModified INTEGER NOT NULL DEFAULT 0,
     notes TEXT,
     isReadOnly INTEGER NOT NULL DEFAULT 0
   );
   ```
   - `dateCreated` and `dateModified`: Unix epoch milliseconds (`number` / JS `Date.getTime()`).
   - `isReadOnly`: `0` (editable) or `1` (strictly read-only).

2. **`contributors`**
   ```sql
   CREATE TABLE IF NOT EXISTS contributors (
     contributorID INTEGER PRIMARY KEY AUTOINCREMENT,
     contributorName TEXT NOT NULL,
     sheetID INTEGER NOT NULL,
     FOREIGN KEY (sheetID) REFERENCES sheets(sheetID) ON DELETE CASCADE
   );
   ```

3. **`items`**
   ```sql
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
   ```
   - `itemType` enum constants (must match [`Item.kt`](../android-app/app/src/main/java/com/raptor/billsplitter/data/Item.kt)):
     - `0` = `TYPE_EXPENSE` (normal shared expense)
     - `1` = `TYPE_SETTLEMENT` (recorded balance payment, e.g., `"Alice paid Bob"`)
     - `2` = `TYPE_MONEY_TRANSFER` (direct transfer, e.g., `"Alice → Bob"`)
     - `3` = `TYPE_CARRYOVER` (carried forward balance from a cloned sheet)

4. **`item_consumers`**
   ```sql
   CREATE TABLE IF NOT EXISTS item_consumers (
     itemID INTEGER NOT NULL,
     contributorID INTEGER NOT NULL,
     weight REAL NOT NULL,
     PRIMARY KEY (itemID, contributorID),
     FOREIGN KEY (itemID) REFERENCES items(itemID) ON DELETE CASCADE,
     FOREIGN KEY (contributorID) REFERENCES contributors(contributorID) ON DELETE CASCADE
   );
   ```
   - **Important**: `weight` stores the **monetary share** (currency amount, not percentage) assigned to that consumer for the item.

### Versioning & Future Migrations
- Track schema version with `PRAGMA user_version` (initialize new DBs at `PRAGMA user_version = 6;`).
- If future tables/columns are added, increment `user_version` and run transactional `MIGRATION_X_Y` SQL steps on startup, keeping compatibility with Android's Room migrations (`1→2` `sheets.dateModified`, `2→3` `item_consumers.weight`, `3→4` `items.dateCreated`, `4→5` `items.itemType`, `5→6` `sheets.isReadOnly`).

---

## 4. SQLite Worker, OPFS Persistence & Multi-Tab Safety

### Worker Architecture
- Never run SQLite WASM on the UI main thread (`opfs-sahpool` requires a Dedicated Worker).
- Structure:
  - `src/db/sqlite.worker.ts` — Initializes `sqlite3InitModule`, installs the `opfs-sahpool` VFS, opens `/bill_splitter_database.sqlite3`, runs `PRAGMA foreign_keys = ON`, runs migrations, and handles typed RPC requests (`query`, `execute`, `transaction`, `exportRawDb`).
  - `src/db/dbClient.ts` — Main-thread promise/RPC wrapper (e.g., typed `postMessage` or `comlink`) + lightweight event emitter (`onDbChanged`) so React hooks/stores automatically re-query affected views after any write (mirroring Room's reactive `Flow`).
  - `src/db/dao.ts` — Clean repository/DAO methods mirroring [`BillSplitterDao.kt`](../android-app/app/src/main/java/com/raptor/billsplitter/data/BillSplitterDao.ts), `MainViewModel.kt`, and `SheetViewModel.kt`.

### Persistence & Multi-Tab Coordination
1. **Persistent Storage Request**:
   - Call `navigator.storage?.persist?.()` once after DB initialization so browsers do not evict OPFS data under disk pressure.
2. **Multi-Tab Guard (`navigator.locks` + `BroadcastChannel`)**:
   - Because `opfs-sahpool` locks OPFS handles to one Worker, wrap Worker DB initialization in `navigator.locks.request('billsplitter-opfs-db', { ifAvailable: true }, ...)`.
   - If the lock is unavailable (the app is already open in another tab), show a clear non-destructive banner/state (`"BillSplitter is open in another tab. Switch to that tab or click 'Take Over Here'."`) or proxy RPC calls over `BroadcastChannel` to the leader tab. Never silently fall back to an ephemeral in-memory DB without warning the user.
3. **Optional Raw DB Backup**:
   - Expose `sqlite3.capi.sqlite3_js_db_export(db)` (or `opfs-sahpool` export) in Settings/menu if the user wants a full-database backup alongside per-sheet `.bsplit` files.

---

## 5. `.bsplit` Binary Codec Specification (100% Android Interop)

The PWA **MUST** read and write `.bsplit` files byte-for-byte compatible with [`SheetBinaryCodec.kt`](../android-app/app/src/main/java/com/raptor/billsplitter/data/SheetBinaryCodec.kt).

### Envelope Layout (Big-Endian)
1. `header` (8 bytes):
   - `MAGIC`: 4-byte int32 `0x4253504C` (`"BSPL"`)
   - `VERSION`: 4-byte int32 (`4` for encoding; accept `2..4` when decoding)
2. `iv`: 12 random bytes (`crypto.getRandomValues(new Uint8Array(12))`)
3. `ciphertextLen`: 4-byte int32 (length of `ciphertext`, must be `16 <= ciphertextLen <= 64 MiB` and match remaining envelope length)
4. `ciphertext`: AES-GCM encrypted payload + 16-byte (128-bit) GCM auth tag, with `header` (8 bytes) passed as **Additional Authenticated Data (AAD)**
5. `signature`: 32-byte **HMAC-SHA256** computed over all preceding bytes (`header + iv + ciphertextLen + ciphertext`). Verify in constant time (`subtle.verify`) **before** decrypting.

### Key Derivation (`deriveMaterial(domain)`)
Using Web Crypto `crypto.subtle.digest('SHA-256', buffer)`:
- Inputs:
  - `seedMaskA` (32 bytes): `[0x4b, 0x91, 0x2c, 0xe7, 0x18, 0x6f, 0xb3, 0x05, 0xd4, 0x7a, 0x39, 0xc2, 0x5e, 0x80, 0xf1, 0x16, 0x9d, 0x24, 0x63, 0xab, 0x0c, 0xef, 0x48, 0x71, 0xd9, 0x32, 0x85, 0x1a, 0xc7, 0x50, 0x6e, 0xbe]`
  - `seedMaskB` (32 bytes): `[0x19, 0xc4, 0x7f, 0x38, 0x6d, 0xa2, 0x51, 0xe9, 0x04, 0xb8, 0x62, 0x1d, 0xf3, 0x47, 0x90, 0x2b, 0xce, 0x56, 0x11, 0x7c, 0x8a, 0x35, 0xd0, 0x9f, 0x26, 0x64, 0xe1, 0x43, 0x9b, 0x0e, 0x77, 0x55]`
- Important Java byte signedness detail when porting from Kotlin:
  - In Kotlin, `Byte` is signed (`-128..127`), `toInt()` sign-extends, `xor` operates on 32-bit ints, `.plus(i * 13 + domain).toByte()` truncates to the low 8 bits.
  - Because `xor`, addition, and truncation to `uint8` (`& 0xFF`) are identical under 2's complement for the low 8 bits:
    ```ts
    const input = new Uint8Array(1 + seedMaskA.length);
    input[0] = domain & 0xff;
    for (let i = 0; i < seedMaskA.length; i++) {
      const a = (seedMaskA[i] << 24) >> 24; // signed byte (optional; & 0xff works identically)
      const b = (seedMaskB[(i * 7 + domain) % seedMaskB.length] << 24) >> 24;
      input[1 + i] = ((a ^ b) + (i * 13 + domain)) & 0xff;
    }
    // SHA-256(input) -> 32-byte key
    ```
  - **AES-GCM Key**: `deriveMaterial(0x3A)` (32 bytes = AES-256-GCM)
  - **HMAC-SHA256 Key**: `deriveMaterial(0x7C)` (32 bytes)

### Decrypted Plaintext Payload Layout (Big-Endian)
- Primitive encoders/decoders (using `DataView` with `littleEndian = false`):
  - `writeInt`: 32-bit signed big-endian integer
  - `writeLong`: 64-bit signed big-endian integer (`BigInt` via `setBigInt64` / `getBigInt64`)
  - `writeDouble`: 64-bit IEEE 754 float (`setFloat64` / `getFloat64`)
  - `writeBoolean`: 1 byte (`0x00` or `0x01`)
  - `writeString`: `int32` byte length (`0 <= size <= 1_000_000`) + UTF-8 bytes (`TextEncoder` / `TextDecoder('utf-8', { fatal: true })`)
  - `writeNullableString`: `boolean` (`isPresent`) + if true `writeString`
  - `MAX_RECORDS = 100_000`
- Record order:
  1. `Sheet`: `sheetID (int)`, `sheetName (string)`, `dateCreated (long ms)`, `dateModified (long ms)`, `notes (nullableString)`, `isReadOnly (boolean, read if version >= 4 else false)`
  2. `contributors` (sorted by `contributorID`): `count (int)` + `count × [contributorID (int), contributorName (string), sheetID (int)]`
  3. `items` (sorted by `itemID`): `count (int)` + `count × [itemID (int), sheetID (int), itemName (string), amount (double), payerID (int), dateCreated (long ms), dateModified (long ms), notes (nullableString), itemType (int, read if version >= 3 else 0)]`
  4. `itemConsumers` (sorted by `itemID`, then `contributorID`): `count (int)` + `count × [itemID (int), contributorID (int), weight (double)]`
- Assert exact EOF (`offset === plaintext.byteLength`) after decoding.

### Transactional Import (`importSheet`)
Runs inside a single SQLite `BEGIN ... COMMIT` transaction:
1. Insert `Sheet` (ignoring original `sheetID`, preserving `isReadOnly`, `sheetName`, `notes`, `dateCreated`, `dateModified`).
2. Insert `contributors` sorted by original `contributorID`, building `contributorIdMap: Map<oldId, newId>`.
3. Insert `items` sorted by original `itemID`, remapping `payerID` via `contributorIdMap` (throw if missing), building `itemIdMap: Map<oldId, newId>`.
4. Insert `itemConsumers`, remapping `itemID` and `contributorID` (throw if missing).
5. Navigate directly to `/sheet/${newSheetId}`.

---

## 6. Domain Logic & Invariants

### 6.1 Sheet & Contributor Validation
- Sheet requires a non-blank `sheetName` and **at least 2 valid contributors** with **case-insensitive unique names** within the sheet.
- **Editing an existing sheet**:
  - Blocked if `sheet.isReadOnly === true`.
  - New rows get temporary negative IDs (`-1, -2, ...`) and are inserted as new `contributors`.
  - Existing rows (`id > 0`) update `contributorName` in place to preserve FK references.
  - Removed rows (`id > 0`) are **only deleted if unused** (`getPayerUsageCount(id) === 0 && getConsumerUsageCount(id) === 0`), silently preserving contributors referenced by existing expenses.
  - Confirm dialog when removing an existing/non-empty member (`"Remove member?"`), or `"Drop carried balance?"` when cloning with carryover and deleting a member with `abs(balance) >= 0.005`.

### 6.2 Total Spent Calculation
- Both the `Bill Sheets` card total and the `Sheet View` hero `"TOTAL SPENT"` card **ONLY sum items where `itemType === 0` (`TYPE_EXPENSE`)**.
- Settlements (`1`), money transfers (`2`), and carryovers (`3`) affect member balances, **not** Total Spent.

### 6.3 Expense Splitting & Auto-Balance (`Add/Edit Expense`)
- **Equal Split (`Equal Split` toggle ON)**:
  - Each checked consumer receives `amount / checkedCount` as `ItemConsumer.weight`.
- **Custom Split (`Equal Split` toggle OFF)**:
  - Requires total `amount > 0` before toggling off (show toast `"Please enter the total Amount before custom splitting."` and keep toggle ON if missing/invalid).
  - Each checked row shows synchronized `Percentage (%)` and `Amount (₹)` inputs.
  - Editing `totalAmount` while in Custom Split preserves each checked row's percentage and updates its row amount (`newTotal * (perc / 100)`).
  - Editing a row's percentage or amount marks that row as **manually locked** (`manualEntries[index] = true`):
    - Remainder (`totalAmount - sumLocked`) is divided equally across untouched ("floating") checked rows (clamped `>= 0`).
    - If **all** checked rows are locked and `checkedIndices.length > 1`, unlock all other checked rows except the currently edited row so they rebalance.
    - Penny rounding or over-allocation remainder (`abs(diff) > 0.001`) is applied to the last floating row (or the first checked neighbor if none are floating), clamped `>= 0`.
  - On Save, enforce `Math.abs(sum(rowAmounts) - amount) <= 0.01`; otherwise display inline warning with current sum.
- **Edit Mode Inference**:
  - When opening an existing expense/carryover to edit, set Equal Split ON if `itemConsumers.length <= 1` or all `weight` values are within `0.01` of `itemConsumers[0].weight`.
  - Note: `TYPE_CARRYOVER` opens in the Expense modal titled `"Edit Carried Balance"`. `TYPE_SETTLEMENT` (`"Edit Payment"`) and `TYPE_MONEY_TRANSFER` (`"Edit Money Transfer"`) open in the Money Transfer modal.

### 6.4 Balance Calculation, Sorting & Settlement Plan
Port [`BalanceCalculator.kt`](../android-app/app/src/main/java/com/raptor/billsplitter/data/BalanceCalculator.kt) identically:
- `EPSILON = 0.005`
- **Net balances (`calculateNetBalancesById`)**:
  - Initialize every contributor in the sheet to `0.0`.
  - For each item with `amount > 0`:
    - If no consumers: credit `payerId` by `+amount`.
    - Otherwise, `useWeighted` is true when `consumers.length > 1` and not all weights are within `0.01` of the first weight.
    - If `useWeighted && sumWeights > 0`: debit each consumer by `(ic.weight / sumWeights) * amount`.
    - Else: debit each consumer by `amount / consumers.length`.
    - Credit `payerId` by `+amount`.
  - Round each balance to 2 decimal places (`Math.round(v * 100) / 100`), normalizing `abs(v) < 0.005` to `0.0`.
- **Balance Display Sorting (`sortBalanceEntries`)**:
  1. Receivers (`balance > 0.005`) sorted descending by amount (`"Will receive ₹..."`, `--receive-text`)
  2. Givers (`balance < -0.005`) sorted descending by owed magnitude (`"Will give ₹..."`, `--give-text`)
  3. Settled (`abs <= 0.005`, `"Settled up"`, `--text-hint`)
  - Tie-breaker: case-insensitive alphabetical by contributor name.
- **Who Pays Whom (`generateSettlementTransfers`)**:
  - Convert to integer cents (`Math.round(abs(val) * 100)`), sorted descending by cents then case-insensitive name.
  - **Pass 1**: Exact 1-to-1 cent matches first (`debtor.cents === creditor.cents`) to minimize split payments.
  - **Pass 2**: Greedy largest-to-largest matching for remaining balances.
- **Record Settlement ("Mark as paid")**:
  - From **Balances** tab on a giver row: if 1 receiver exists, immediately record settlement; if >1 receivers exist, show `"Who did <debtor> pay?"` recipient picker (`payAmount = round(min(amountOwed, receiverOwed), 2)`).
  - From **Who Pays Whom** tab: immediately record settlement for `transfer.fromName → transfer.toName` of `transfer.amount`.
  - Inserts an `Item` with `itemType = TYPE_SETTLEMENT`, `itemName = "${debtor} paid ${receiver}"`, `payerID = debtorId`, single `ItemConsumer(receiverId, roundedAmount)`, `notes = "Marked as paid"`, updates `sheet.dateModified`, recomputes balances in place, and shows toast.

### 6.5 Sheet Cloning (`Clone`)
- Blocked for `isReadOnly` sheets.
- Options dialog:
  1. **Start Fresh (Same Members)**: Opens Create Sheet prefilled with source sheet name, notes, and contributors (fresh IDs).
  2. **Carry Forward Balances**: Filters to unsettled contributors (`abs(balance) >= 0.005`), opens Create Sheet with those contributors (warn `"All members in ... are already settled up."` if none), and upon creation generates minimal `TYPE_CARRYOVER` items via `generateCarryoverTransfers` (`itemName = "Previous balance"`, `payerID = creditorId`, sole consumer `debtorId`, `notes = "Carried forward from <sourceSheetName>"`).

### 6.6 Read-Only Sheets
- Export dialog offers an `"Export as read-only"` checkbox (forced checked & disabled if the sheet is already `isReadOnly`).
- When `sheet.isReadOnly === true`:
  - Main list card shows `"READ ONLY"` status badge (`--carryover-accent`) instead of `"READY TO SPLIT"` / `"ACTIVE SHEET"`, and hides `Edit` & `Clone` in the card menu.
  - Sheet View shows `"READ ONLY"` badge on the hero card, hides the `+ Add Expense` button (making `Calculate` full-width), disables/hides `Edit` & `Delete` on expense cards, and hides `"Mark as paid"` buttons in the Balances / Who Pays Whom modal.

---

## 7. UI, Navigation & Visual Parity

### Routes & Screens
1. **`/` — Bill Sheets (Home)**
   - Header: `"Bill Sheets"` (bold, `34px`-scale tracking `-0.02em`) + Sort button (visible when `sheets.length >= 2`).
   - Search bar: `"Search sheets or people..."` (matches sheet name, notes, or any contributor name, case-insensitive) with clear `X` button.
   - Sheet cards: Sheet name, sorted contributor list (or `"No contributors yet"`), status badge (`READ ONLY` / `READY TO SPLIT` / `ACTIVE SHEET`), total expense (`₹...`), and 3-dot overflow menu (`Edit`, `Share / Export`, `Clone`, `Details`, `Delete`).
   - Bottom-right FAB (`+`): Opens popover menu with **New Sheet** and **Import Sheet (`.bsplit`)**. Also support drag-and-drop `.bsplit` onto the window and PWA `file_handlers`.
2. **`/sheet/:sheetId` — Sheet View**
   - Top bar: Back arrow, horizontally scrollable sheet title, Sort button (visible when `items.length >= 2`).
   - Hero gradient card: `"TOTAL SPENT"`, optional `"READ ONLY"` badge, large formatted total (`₹...`).
   - Search bar: `"Search expenses, payer, or people..."` (matches item name, notes, payer name, consumer names, or `amount.toFixed(2)`).
   - `"EXPENSES"` section label + list of cards (or empty state `"Long press expense card to see more options"` / `"No expenses match your search"`):
     - **Expense (`0`)**: Default surface card, icon `₹`, `"Paid by"` / `"Split between"` (show `"Everyone (N)"` if `consumers.length > 3`).
     - **Settlement (`1`)**: Emerald/green tinted card, icon `✓`, `"Paid by"` / `"Paid to"`.
     - **Money Transfer (`2`)**: Red/coral tinted card, icon `⇄`, `"From"` / `"To"`.
     - **Carryover (`3`)**: Blue tinted card, icon `↺`, `"Owed to"` / `"Owed by"`.
     - Click or context-menu/long-press on any card opens menu (`Edit`, `Details`, `Delete` — respecting `isReadOnly`).
   - Bottom sticky action bar: `Calculate` (visible when `items.length > 0`) and `+ Add Expense` (hidden when `isReadOnly`).
     - Clicking `+ Add Expense` opens Add Expense modal.
     - Long-pressing / right-clicking `+ Add Expense` (plus an accessible secondary affordance/split icon on desktop so mouse users don't have to guess long-press!) opens the options popover: **Add Expense** vs **Money Transfer**.

### Sort Preferences Persistence (`localStorage`)
- Home (`BillSplitterPrefs`): `sortBy` (`dateModified` | `dateCreated` | `name` | `contributors`), `sortOrder` (`desc` | `asc`). Default: `dateModified` descending.
- Per-Sheet (`BillSplitterPrefs_Sheet_${sheetId}`): `sortBy` (`dateModified` | `dateCreated` | `name` | `amount`), `sortOrder` (`desc` | `asc`). Default: `dateModified` descending.

### Theme & Color Tokens
Support automatic system theme (`prefers-color-scheme`) plus an optional manual override, using the exact tokens from [`colors.xml`](../android-app/app/src/main/res/values/colors.xml) and [`values-night/colors.xml`](../android-app/app/src/main/res/values-night/colors.xml):

| Token | Light | Dark |
| :--- | :--- | :--- |
| `--bg-start` / `--bg-end` | `#F8F9FB` / `#F4F5F8` | `#0B0F17` / `#090D14` |
| `--surface-card` / `--surface-card-alt` | `#FFFFFF` / `#F2F4F7` | `#131924` / `#1A2230` |
| `--card-stroke` | `#E4E7EC` | `#263042` |
| `--hero-gradient` | `#111827 → #182132 → #1F2937` | `#161F30 → #1B2538 → #222E44` |
| `--text-primary` / `--text-secondary` / `--text-hint` | `#111827` / `#4B5563` / `#9CA3AF` | `#F3F4F6` / `#9CA3AF` / `#6B7280` |
| `--btn-primary-bg` / `--btn-primary-text` | `#18181B` / `#FFFFFF` | `#F3F4F6` / `#111827` |
| `--receive-text` / `--give-text` | `#059669` / `#DC2626` | `#34D399` / `#F87171` |
| Settlement card (`bg` / `stroke` / `panel` / `accent`) | `#ECFDF5` / `#A7F3D0` / `#D1FAE5` / `#059669` | `#0E231C` / `#1B4332` / `#143026` / `#34D399` |
| Transfer card (`bg` / `stroke` / `panel` / `accent`) | `#FEF2F2` / `#FECACA` / `#FEE2E2` / `#DC2626` | `#261217` / `#522029` / `#32181F` / `#F87171` |
| Carryover card (`bg` / `stroke` / `panel` / `accent`) | `#EFF6FF` / `#BFDBFE` / `#DBEAFE` / `#2563EB` | `#101E33` / `#243B61` / `#162945` / `#60A5FA` |

---

## 8. PWA & Web Platform Requirements

- **Manifest (`manifest.webmanifest`)**:
  - `display: "standalone"`, app name `"Bill Splitter"`, icons (192x192, 512x512, maskable).
  - `file_handlers` for `.bsplit` (`application/octet-stream` / `.bsplit`) with `window.launchQueue` consumer on supported Chromium browsers.
- **Service Worker (`vite-plugin-pwa`)**:
  - `registerType: 'autoUpdate'` (or prompt to reload without interrupting open modal edits).
  - Workbox `globPatterns` **must include `wasm`** (`**/*.{js,css,html,ico,png,svg,wasm}`) and set `maximumFileSizeToCacheInBytes` high enough for `sqlite3.wasm` (~1–2 MB, default Workbox limit is 2 MiB — raise to `5 * 1024 * 1024` to be safe).
- **File Export / Share**:
  - **Save to Device**: Universal `<a download>` Blob download (with optional `window.showSaveFilePicker` enhancement on desktop Chromium).
  - **Share**: Use `navigator.share({ files: [new File([bytes], filename, { type: 'application/octet-stream' })] })` when `navigator.canShare?.({ files })` is true, falling back cleanly to Blob download.
- **Mobile & Desktop Ergonomics**:
  - Respect `env(safe-area-inset-top)` and `env(safe-area-inset-bottom)` for iOS/Android installed PWAs.
  - Constrain desktop max-width (e.g., centered `max-w-2xl` container) so cards and dialogs don't stretch unreadably on ultrawide monitors while remaining edge-to-edge on mobile.
  - Because web browsers don't communicate long-press as intuitively as Android on desktop, support both **long-press / right-click** AND clear click/icon affordances (e.g., an explicit `"Money Transfer"` quick button or split menu on `+ Add Expense` alongside long-press).

---

## 9. Testing & Verification Checklist

Before considering any milestone complete, verify:
1. **Binary Codec Interop Tests**:
   - Port all test cases from [`SheetBinaryCodecTest.kt`](../android-app/app/src/test/java/com/raptor/billsplitter/data/SheetBinaryCodecTest.kt) (round-trip all 4 `itemType`s, `isReadOnly`, random IV, tampered-byte rejection, invalid file rejection).
   - Cross-verify with a real `.bsplit` fixture exported from `android-app` and vice versa.
2. **Balance & Settlement Tests**:
   - Port all test cases from [`BalanceCalculatorTest.kt`](../android-app/app/src/test/java/com/raptor/billsplitter/data/BalanceCalculatorTest.kt) (carryover exclusion of settled users, multi-creditor/multi-debtor carryover, 10-person settlement plan, exact match prioritization, `sortBalanceEntries`).
3. **SQLite WASM + OPFS E2E Tests**:
   - Create sheet → add expenses (equal + custom split) → reload page → verify data persists in OPFS.
   - Delete sheet → verify `contributors`, `items`, and `item_consumers` cascade-delete (`PRAGMA foreign_keys = ON`).
   - Go offline (Service Worker / network disabled) → reload app → verify full CRUD and `.bsplit` export/import continue working.
4. **Watchouts**:
   - Never use `localStorage.toLocaleString()` strings for parsing numbers back to `float`; always parse normalized `.` decimals cleanly.
   - Never ignore `isReadOnly` checks in UI *or* DAO/service methods (enforce in both).
   - Never skip `PRAGMA foreign_keys = ON` on any SQLite connection.

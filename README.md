# BillSplitter (Android)

> **Branch note:** This `android-app` branch hosts the native Android Kotlin application (`com.raptor.billsplitter`). The `main` branch is kept clean for the upcoming universal BillSplitter app.

BillSplitter is an offline-first Android expense-splitting app for group trips, shared households, and events. Track shared expenses, record direct money transfers, minimize group repayments, carry unsettled balances into new sheets, and share tamper-protected `.bsplit` files (with optional strict read-only locks).

---

## Features

### Sheets & Members
- **Sheet Management:** Create, edit, inspect details, search (by sheet name, notes, or member name), sort (name, member count, date created, date modified), and delete bill sheets with confirmation prompts.
- **Member Safeguards:** Enforces at least 2 members per sheet and prompts before removing saved/named members or dropping carried-over balances.
- **Clone & Clone with Balance:**
  - **Clone:** Prefills a new sheet with the existing name, notes, and all members without copying old transactions.
  - **Clone with balance:** Automatically settles out 0-balance members and carries forward net unsettled balances as distinct carried-balance entries.

### Expenses, Transfers & Settlements
- **Flexible Expense Splits:** Split equally with one-tap **Select all** or distribute custom per-person amounts and percentages with real-time validation. Only actual expenses count toward **Total Spent**.
- **Money Transfers:** Long-press **+ Add Expense** to record direct `From → To` transfers (mutually exclusive person selectors, excluded from **Total Spent**).
- **In-Place Settlements (`Mark as Paid`):** Record `Mark as Paid` payments directly from the balance dialog as greenish settlement cards, live-updating all balances without inflating **Total Spent**.
- **Search & Sort Inside Sheets:** Filter items by title, notes, payer, participants, or amount, and sort by name, amount, date created, or date modified.
- **Delete Confirmations:** Destructive actions across sheets, expenses, transfers, settlements, carried balances, and named members require confirmation.

### Smart Balances & Settlement Plan
- **Balances Tab:** Groups all receivers (`Will receive`) at the top followed by all givers (`Will give`), ordered by amount, with **Mark as Paid** actions.
- **Who Pays Whom Tab:** Computes a minimal list of 1-to-1 transfers using integer cent/paise arithmetic and exact-match prioritization (`giver == receiver` first), with direct **Mark as Paid** buttons on each transfer row.

### Encrypted `.bsplit` Export, Import & Read-Only Mode
- **Authenticated Binary `.bsplit` Format:** Exports and imports complete sheets (expenses, split weights, transfers, settlements, carried balances, and read-only status) encrypted with `AES/GCM/NoPadding` and signed with `HMAC-SHA256` (backwards-compatible across format versions 2–4).
- **Share or Save to Device:** Choosing **Export** from a sheet's 3-dot menu lets you **Share** via Android's share sheet or **Save to device** via the system file picker, with a **Read only** checkbox.
- **Strict Read-Only Protection:** Imported read-only sheets display `READ ONLY` badges, strip out **+ Add Expense**, **Edit**, **Clone**, and **Mark as Paid** controls, restrict item menus to **Details** only, lock re-exports to read-only, and enforce read-only guards in the ViewModel layer while keeping **Calculate** (`Balances` & `Who Pays Whom`) usable.

### UI & UX
- Adaptive light and dark Material theme (`MODE_NIGHT_FOLLOW_SYSTEM`).
- Morph transition animations on dynamic dialogs, tabs, and controls.
- Viewport-safe anchored popups and scrollable dialogs across small and large screens.

---

## Tech Stack

- **Language:** Kotlin `2.0.21` (JVM 11)
- **Android SDK:** `minSdk 24` (Android 7.0+), `compileSdk 36`, `targetSdk 36`
- **Build System:** Android Gradle Plugin `8.13.1`, KSP `2.0.21-1.0.28`
- **Persistence:** Room `2.8.3` (SQLite with schema migrations v1 → v6)
- **Architecture & UI:** AndroidX Lifecycle / ViewModel (`2.8.3`), Material Components (`1.13.0`), ConstraintLayout (`2.2.1`), RecyclerView (`1.4.0`), ViewBinding

---

## Project Structure

```text
app/src/main/java/com/raptor/billsplitter/
├── MainActivity.kt               # Sheet list, search/sort, clone, import/export (.bsplit)
├── MainViewModel.kt              # Sheet CRUD, carryover cloning, .bsplit import/export queries
├── Adapter.kt                    # Sheet cards & read-only/menu enforcement
├── SheetViewActivity.kt          # Expense ledger, transfers, Calculate & Who Pays Whom dialogs
├── SheetViewModel.kt             # Item CRUD with read-only mutation guards
├── ExpenseAdapter.kt             # Color-coded cards (expense, settlement, transfer, carryover)
├── BalanceAdapter.kt             # Grouped receivers-first net balance rows
├── SettlementPlanAdapter.kt      # Minimal 1-to-1 transfer plan rows
├── UiSizing.kt                   # Morph transitions, confirm dialogs, viewport-safe popups/dialogs
└── data/
    ├── AppDatabase.kt            # Room database (v6) and migrations
    ├── BillSplitterDao.kt        # Queries and snapshots
    ├── BalanceCalculator.kt      # Net balance solver, grouped sorting & settlement transfer solver
    ├── SheetBinaryCodec.kt       # AES-GCM + HMAC-SHA256 .bsplit encoder/decoder (v2–v4)
    └── Sheet.kt / Item.kt / Contributor.kt / ItemConsumer.kt / SheetExportData.kt
```

---

## Build & Test

Run Gradle from the repository root (`D:\BillSplitter`):

```bash
# Build debug APK
./gradlew assembleDebug

# Run local JVM unit tests (balance calculation, sorting, settlement plan, .bsplit codec)
./gradlew testDebugUnitTest

# Build release APK
./gradlew assembleRelease
```

On Windows PowerShell, use `.\gradlew.bat` instead of `./gradlew`.

---

## License

See [LICENSE](LICENSE).

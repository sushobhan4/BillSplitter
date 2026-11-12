# BillSplitter Universal (PWA)

An offline-first Progressive Web App clone of the **BillSplitter** Android application, built with **React**, **TypeScript**, **SQLite WASM**, and **OPFS** persistence.

> **Branch note:** The native Android Kotlin app lives on the [`android-app`](https://github.com/sushobhan4/BillSplitter/tree/android-app) branch. This `main` branch hosts the Universal Web PWA, configured for deployment via GitHub Pages.

## Overview

BillSplitter Universal brings 1-to-1 feature and file compatibility with the native Android app to any modern browser (desktop, Android, iOS) as an installable PWA — with zero backend servers or accounts required.

### Tech Stack
- **Frontend**: React + TypeScript + Vite
- **Database**: SQLite WASM (`@sqlite.org/sqlite-wasm`) running in a Dedicated Web Worker
- **Persistence**: Origin Private File System (**OPFS** via `opfs-sahpool` VFS)
- **Offline / Installable**: PWA Service Worker (`vite-plugin-pwa`)
- **Crypto / File Sharing**: Web Crypto API (`AES-GCM` + `HMAC-SHA256`) for `.bsplit` interoperability

### Key Features
- **Bill Sheets**: Create, edit, search, sort, and clone shared expense ledgers.
- **Flexible Splitting**: Split expenses equally or by custom amounts and percentages with real-time auto-balancing.
- **Balances & Settlement Plan**: View net balances (`Will receive` / `Will give` / `Settled up`) and an optimized **Who Pays Whom** transfer plan with one-tap **Mark as paid**.
- **Money Transfers & Carryover**: Record direct member-to-member transfers or clone unsettled balances into a new sheet.
- **Cross-Platform `.bsplit` Import/Export**: Share and open encrypted `.bsplit` files seamlessly between the Android app and the Web PWA, including optional **Read-Only** exports.
- **Light & Dark Themes**: Matches the Android app's minimalist light and dark palettes.

## Project Documentation

- [`agents.md`](./agents.md) — Complete architecture, SQLite schema, OPFS worker design, `.bsplit` binary codec specification, domain invariants, UI parity spec, and testing checklist.

## Status

Specification and architecture documented. Application scaffolding and implementation live in this directory (`web-universal/`).

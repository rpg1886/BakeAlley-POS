# Project Architectural Rules: Baking Supply POS System

## Tech Stack & Core Architecture
- **Desktop Runtime:** Electron with React + TypeScript + Tailwind CSS.
- **Local Database (Client):** SQLite using `better-sqlite3` for offline storage.
- **Cloud Database (Server):** PostgreSQL with Node.js/Express REST API.
- **Data Sync Pattern:** Local-First Transactional Outbox. Client writes to SQLite domain tables AND a `sync_queue` table atomically, then pushes batches to PostgreSQL.

## Domain Rules (Baking Supply Store)
1. **Primary Keys:** ALWAYS use UUID v4 strings for primary keys across all client and server entities. NEVER use auto-incrementing integer IDs.
2. **Weight & Fractional Quantities:** Quantity fields for weighed items must use high-precision decimals (`NUMERIC(12, 4)` in SQL, `number` in TypeScript formatted explicitly).
3. **Food Safety & FEFO:** Lot tracking is required for ingredients. Stock deductions must enforce First-Expired, First-Out (FEFO) order using `inventory_lots.expiration_date`.
4. **Pricing Tiers:** Support retail pricing and wholesale customer account pricing tiers.

## Coding Standards
- Write clean, modular, strictly typed TypeScript code.
- Avoid external sync libraries; implement direct SQL queries and explicit API contracts.
- Handle offline state gracefully using defensive error handling.

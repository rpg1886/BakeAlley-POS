# Pre-Production Improvements & Feature Roadmap

**Project:** Bake Alley Cloud POS  
**Target Completion:** Pre-Production Hardening & Enterprise Feature Expansion  
**Document Version:** 1.0  

---

## Executive Summary

The Bake Alley Cloud POS system has achieved approximately **85% production readiness**. The core architectural components—including Node.js/Express API server, Neon PostgreSQL database, React Progressive Web Application (PWA), and Electron desktop companion—are established and hardened. Critical business logic such as FEFO (First-Expired, First-Out) inventory lot allocation, multi-tier pricing, shift cash drawer reconciliation, split payments, order discounts, and soft deletion (archiving) is fully operational.

This document outlines the remaining pre-production blockers required prior to store deployment, followed by an enterprise feature expansion roadmap designed to turn Bake Alley POS into a comprehensive, multi-store cloud retail solution.

---

## 1. Pre-Production Blockers & Hardening Phase

Before launching in live retail store environments, the following technical items must be completed to ensure 100% reliability and offline resilience:

### 1.1 Service Worker & PWA Asset Pre-Caching
- **Objective:** Enable full offline application loading for static assets (`HTML`, `JS`, `CSS`, images, fonts).
- **Tasks:**
  - Configure `vite-plugin-pwa` in `vite.config.ts` to register a Service Worker.
  - Set up CacheFirst strategies for static bundle assets and StaleWhileRevalidate for API catalog snapshots.
  - Test offline application launch when network connectivity is completely disabled.

### 1.2 Background Sync Worker & Offline Replay Queue
- **Objective:** Automatically replay offline orders saved in IndexedDB (`web/offlineStore.ts`) once network connectivity returns.
- **Tasks:**
  - Wire background `SyncManager` API / Service Worker message handlers to process outbox queues (`bakealley_offline_orders`).
  - Implement idempotent backend order processing (`order_id` deduplication) to prevent duplicate transactions upon reconnect.
  - Provide visual sync status indicators (e.g., `🟢 Online | 3 Outbox Pending`) on the POS header bar.

### 1.3 Database Migration Consolidation
- **Objective:** Eliminate runtime `ALTER TABLE` statements and standardize schema migration tracking.
- **Tasks:**
  - Consolidate startup runtime column additions (`ensureShiftColumns()`, `is_active` additions) into a single, versioned migration file: `server/migrations/002_reservations_and_shifts.sql`.
  - Ensure local SQLite companion schemas and cloud PostgreSQL schemas maintain 1:1 structure parity.

### 1.4 Automated Testing & Load Validation
- **Objective:** Prevent regressions in critical checkout, pricing, and stock deduction logic.
- **Tasks:**
  - **Unit & Integration Tests:** Add Jest / Vitest test coverage for FEFO lot allocation logic, tax/discount calculations, and split-payment validation.
  - **Concurrent Load Testing:** Run k6 / Artillery scripts simulating multi-cashier peak sales hours to ensure PostgreSQL connection pool efficiency and concurrency lock safety under heavy load.

---

## 2. Comprehensive Cloud POS Feature Roadmap

To scale Bake Alley POS from a single-store platform into an enterprise-grade cloud POS solution, the following modules are recommended:

### 2.1 Inventory & Supply Chain Management

#### A. Multi-Store & Multi-Warehouse Tracking
- Upgrade from the simple `attributes.warehouse` text tag to dedicated `locations` and `store_inventory` tables.
- Support real-time stock balances across multiple retail branches and central baking commissaries.
- Add Stock Transfer Workflows (`Transfer Out` -> `In-Transit` -> `Transfer In`) with manager verification.

#### B. Vendor & Purchase Order (PO) System
- **Supplier Directory:** Manage ingredient and packaging supplier accounts, contact details, and payment terms.
- **Purchase Order Workflow:** Create POs, track pending deliveries, and record incoming shipments.
- **Auto-Restock & Lot Entry:** Receiving a PO automatically generates new `inventory_lots` with expiration dates, updates unit costs, and recalculates weighted average initial capital.

#### C. Manual Inventory Adjustment Audit Log
- Replace simple direct edits with a dedicated `inventory_adjustments` audit log.
- Track every stock change with attributes: `adjusted_by`, `variant_id`, `quantity_change`, `reason` (e.g., *Spoilage*, *Damaged Package*, *Recount*, *Sampling*), and `timestamp`.

---

### 2.2 Financials & Advanced Sales Operations

#### A. Customer Credit Limit & Balance Enforcement
- Enforce existing `customers.credit_limit` and `customers.current_balance` fields during **Account / Charge** checkouts.
- Automatically block sales if an account checkout exceeds the approved credit threshold, requiring Admin override.

#### B. Store Overhead & Expense Tracking (True P&L)
- Create an **Expense Tracking Module** to record operational expenditures (rent, electricity, store packaging, staff wages).
- Provide a **True Net Profit Statement** combining Gross Revenue - COGS (Actual Lot Cost) - Operational Expenses.

#### C. Order Voids, Refunds, & Credit Memos
- Formalize the refund/void workflow requiring Admin PIN authorization.
- Provide options to return items to inventory or mark as damaged.
- Generate digital Credit Memos or store credit balances for CRM customer profiles.

---

### 2.3 Hardware & Payment Integration

#### A. Direct Thermal Printing & Cash Drawer Triggers
- Connect the PWA directly to network thermal receipt printers via Web USB / Web Bluetooth or the local companion bridge.
- Auto-print customer receipts upon transaction completion and send raw ESC/POS pulse commands (`1B 70 00 19 96`) to trigger automatic cash drawer opening.

#### B. Automated Payment Gateway Webhooks (GCash / PayMongo)
- Replace manual cashier text entry for GCash and Card payments with direct PayMongo / Maya API QR generation.
- Receive instant payment notification webhooks to automatically mark orders as paid without manual reference input.

#### C. Customer Loyalty & Promotional Engine
- Implement Buy-X-Get-Y (BOGO), seasonal bundle discounts, and spend-based reward points.
- Allow CRM customers to redeem earned loyalty points directly during checkout.

---

## 3. Implementation Matrix & Timeline

| Phase | Milestone | Focus Areas | Key Deliverables |
| :--- | :--- | :--- | :--- |
| **Phase 1** | Pre-Prod Hardening | SW Pre-caching, Offline Sync, Migration Consolidation | Complete offline PWA, versioned SQL migrations, Vitest suite |
| **Phase 2** | Operations & Hardware | Thermal Printer ESC/POS, Adjustments Audit Log, Credit Limits | Direct thermal receipt printing, inventory adjustment log |
| **Phase 3** | Supply Chain & B2B | Purchase Orders (PO), Supplier Management, Multi-Store | PO Receiving workflow, vendor directory |
| **Phase 4** | Advanced Commerce | PayMongo GCash Webhooks, Expense Module, Loyalty Program | Automated QR payments, P&L statement, spend points |
---

# Software Design Document (SDD): Bake Alley Cloud POS System

**System Version:** 1.0.0 (Cloud-Native PWA / Hybrid Architecture)  
**Readiness Status:** ~85% Production Ready  
**Primary Reference:** `repomix-output.txt`  
**Target Architecture:** React 18 PWA + Node.js/Express REST API + Neon PostgreSQL + Electron Scale Companion  

---

## 1. Executive Summary & System Overview

The **Bake Alley Cloud POS** is a specialized, cloud-capable Point of Sale (POS) and inventory management platform designed specifically for commercial baking supply stores and retail bakeries. It transitions legacy desktop POS workflows into a modern, cloud-native Progressive Web Application (PWA) backed by a high-concurrency PostgreSQL database hosted on Neon.tech and an Express REST API hosted on Railway/Render.

### 1.1 Core Architectural Principles
* **Hybrid Web/Desktop Topology:** The core sales, inventory, CRM, and analytics modules run natively in any modern browser as a PWA, while an optional Electron companion app bridges local RS-232 digital serial scales and ESC/POS hardware.
* **FEFO Inventory Discipline:** Enforces First-Expired, First-Out (FEFO) automated lot allocation to ensure food safety compliance and minimize ingredient spoilage.
* **Fractional Precision:** Handles high-precision decimal quantities (`NUMERIC(12,4)`) for weight-based items weighed live on digital scales.
* **Blind Cash Drawer Auditing:** Enforces blind physical cash counts during shift clock-out to detect shortages, overages, and cashier discrepancies.
* **Soft-Delete Resilience:** Uses soft-deletion (`is_active = FALSE`) across catalog items and employee accounts to preserve full relational integrity for historical audit logs and sales reporting.

---

## 2. System Component Architecture

```
[ Browser / PWA Client ] ────────┐
  ├── React 18 / Tailwind CSS    │
  ├── IndexedDB Outbox Queue     │ (HTTPS / REST)
  └── Service Worker Cache       ▼
                       [ Express REST API ]
                         ├── Zod Validation
                         ├── Auth & Session Guard
                         └── FEFO Allocation Engine
                                 │
                                 ▼
                       [ Neon PostgreSQL DB ]
```

### 2.1 Frontend Architecture (React PWA)
* **Framework:** React 18 with TypeScript, styled with Tailwind CSS.
* **State Management:** Reactive component state combined with persistent browser storage (`localStorage` for session tokens, `IndexedDB` via `web/offlineStore.ts` for transactional outbox queueing).
* **Views & Routing:** Single-Page Application (SPA) segmented into dedicated views:
  * `CheckoutScreen`: Fast barcode/SKU scanning, live weight polling, tier pricing, split payment calculations, and pre-orders.
  * `InventoryView`: Real-time stock valuation, lot expiration monitoring, and item archiving.
  * `BiView`: Business Intelligence analytics, 3-channel revenue split, fast/slow stock velocity, and peak store purchasing hours.
  * `SalesView`: Daily sales journal, itemized receipt breakdown, and discount auditing.
  * `CrmView` & `EmployeesView`: Customer account tier management and staff shift roster management.

### 2.2 Backend Architecture (Node.js / Express API)
* **Runtime:** Node.js v20+ executing Express.js with async handler wrappers.
* **Security & Auth:** `scrypt` key derivation for password hashing, Express session middleware, CORS origin filtering, and Express `rate-limit`.
* **Validation Layer:** Zod schema validation (`server/validation.js`) enforcing strict runtime types before query execution.
* **Logging Subsystem:** Structured JSON logging via Winston (`server/logger.js`).

### 2.3 Database Tier (Neon PostgreSQL)
* **Connection Pooling:** `pg.Pool` managing connections to Neon.tech managed serverless PostgreSQL.
* **Concurrency Control:** Row-level locking (`SELECT ... FOR UPDATE`) during checkout lot deduction to prevent race conditions during concurrent transactions.

---

## 3. Detailed Schema Design

The database consists of 12 core tables enforcing relational constraints, decimal precision, and UUID primary keys.

```
+--------------------+        +---------------------+        +-----------------------+
|     categories     |◄───────|      products       |◄───────|   product_variants    |
+--------------------+        +---------------------+        +-----------------------+
                                         │                               │
                                         ▼                               ▼
                              +---------------------+        +-----------------------+
                              |  units_of_measure   |        |    inventory_lots     |
                              +---------------------+        +-----------------------+
                                                                         │
                                                                         ▼
                                                             +-----------------------+
                                                             |      order_items      |
                                                             +-----------------------+
                                                                         │
                                                                         ▼
+--------------------+        +---------------------+        +-----------------------+
|     customers      |◄───────|       orders        |───────►|    employee_shifts    |
+--------------------+        +---------------------+        +-----------------------+
                                         │
                                         ▼
                              +---------------------+
                              |     price_tiers     |
                              +---------------------+
                                         │
                                         ▼
                              +---------------------+
                              |   product_prices    |
                              +---------------------+
```

### 3.1 Data Dictionary

#### `categories`
* `category_id` (UUID, PK): Unique identifier.
* `name` (TEXT, UNIQUE): Category name (e.g. Flour, Sugar, Packaging).
* `created_at` / `updated_at` (TIMESTAMPTZ): Timestamps.

#### `products`
* `product_id` (UUID, PK): Unique master product ID.
* `category_id` (UUID, FK -> categories.category_id): Parent category.
* `name` (TEXT): Master product title.
* `base_uom_id` (UUID, FK -> units_of_measure.uom_id): Base measurement unit.
* `is_sold_by_weight` (BOOLEAN): True if item uses live digital scale.
* `requires_lot_tracking` (BOOLEAN): True if lot tracking is active.
* `initial_cost` (NUMERIC(12,2)): Base unit cost price.

#### `product_variants`
* `variant_id` (UUID, PK): Unique SKU variant ID.
* `product_id` (UUID, FK -> products.product_id): Parent product reference.
* `sku` (TEXT, UNIQUE): Stock Keeping Unit string.
* `barcode` (TEXT, UNIQUE): Barcode string for scanner.
* `variant_name` (TEXT): Full item variant display name.
* `is_active` (BOOLEAN, DEFAULT TRUE): Soft-delete flag.

#### `inventory_lots`
* `lot_id` (UUID, PK): Unique lot batch ID.
* `variant_id` (UUID, FK -> product_variants.variant_id): Target variant.
* `lot_number` (TEXT): Lot identifier code.
* `expiration_date` (DATE): Expiration date for FEFO sorting.
* `quantity_on_hand` (NUMERIC(12,4)): Current available stock.

#### `orders`
* `order_id` (UUID, PK): Unique sales order identifier.
* `customer_id` (UUID, FK -> customers.customer_id, NULLABLE): Linked customer.
* `employee_id` (UUID, FK -> app_users.user_id): Cashier reference.
* `status` (TEXT): `completed`, `cancelled`, or `open`.
* `total_amount` (NUMERIC(12,2)): Final order total.
* `payment_method` (TEXT): `cash`, `card`, `gcash`, `account`, or `split`.
* `payments` (JSONB): Structured breakdown of multi-tender transactions.
* `order_mode` (TEXT): `immediate` vs `reservation`.
* `deposit_amount` / `balance_due` (NUMERIC(12,2)): Pre-order tracking fields.

#### `order_items`
* `order_item_id` (UUID, PK): Unique line item ID.
* `order_id` (UUID, FK -> orders.order_id): Parent order.
* `variant_id` (UUID, FK -> product_variants.variant_id): Sold item variant.
* `lot_id` (UUID, FK -> inventory_lots.lot_id): Allocated lot.
* `quantity` (NUMERIC(12,4)): Quantity purchased.
* `unit_price` / `total_price` (NUMERIC(12,2)): Price points.

---

## 4. Key Subsystem Algorithms & Business Logic

### 4.1 FEFO (First-Expired, First-Out) Allocation Engine
When a sale is finalized, the system deducts inventory from available lots ordered by expiration date (`expiration_date ASC NULLS LAST`).

```
Request Qty: 12.5 kg
  │
  ├─► Lot A (Exp: 2026-11-01, Available: 5.0 kg) ──► Depleted 5.0 kg (0.0 kg left)
  │
  └─► Lot B (Exp: 2026-12-15, Available: 10.0 kg) ─► Deducted 7.5 kg (2.5 kg left)
```

```javascript
// SQL Row Locking & Allocation Pattern
const lots = await client.query(
  `SELECT lot_id, quantity_on_hand 
   FROM inventory_lots 
   WHERE variant_id = $1 AND quantity_on_hand > 0 
   ORDER BY expiration_date ASC NULLS LAST, lot_id 
   FOR UPDATE`,
  [item.variantId]
);
```

### 4.2 Blind Cash Drawer Reconciliation Algorithm
At shift closing, the cashier performs a blind physical cash count without seeing system-calculated expected totals.

$$	ext{Expected Cash} = 	ext{Opening Float} + 	ext{Cash Sales} + 	ext{Reservation Cash Deposits} - 	ext{Cash Refunds}$$
$$	ext{Cash Discrepancy} = 	ext{Closing Physical Count} - 	ext{Expected Cash}$$

* **Discrepancy = 0:** Balanced shift.
* **Discrepancy < 0:** Shortage logged in `employee_shifts.cash_discrepancy`.
* **Discrepancy > 0:** Overage logged in `employee_shifts.cash_discrepancy`.

### 4.3 Soft-Delete (Archiving) Protocol
To delete an inventory item without destroying historical sales reports or violating foreign keys in `order_items`:
1. `product_variants.is_active` is set to `FALSE`.
2. Available `inventory_lots.quantity_on_hand` is set to `0`.
3. `GET /api/v1/products/search` filters queries with `WHERE (v.is_active IS TRUE OR v.is_active IS NULL)`.
4. Cashier checkout search and barcode scanner return `No Records Found` for archived items.

---

## 5. Hardware & Peripheral Integration

```
┌─────────────────────────┐       RS-232 / USB       ┌──────────────────────────┐
│  Digital Scale (RS-232) ├─────────────────────────►│ Electron Companion App   │
└─────────────────────────┘                          └────────────┬─────────────┘
                                                                  │ WebSocket / HTTP
┌─────────────────────────┐      Virtual Keyboard                 │
│  Barcode Scanner (USB)  ├───────────────────────────────────────┼──────────────┐
└─────────────────────────┘                                       ▼              │
                                                     ┌──────────────────────────┐│
                                                     │   Browser PWA Client     │◄┘
                                                     └──────────────────────────┘
```

* **Digital Weight Scale:** Connected via RS-232 COM port. The Electron companion app reads serial streams (NCI/Mettler-Toledo format), parses raw ASCII weight readings (`W01000g`), and transmits live readings to the PWA checkout screen via local HTTP/WebSocket polling.
* **Barcode Scanner:** Emulates USB HID keyboard input. Scans directly into the active checkout search field with automatic `Enter` key execution to add items to the cart instantly.
* **Cash Drawer:** Connected via RJ11 cable to the thermal printer. Sending an ESC/POS pulse command (`27,112,0,25,250`) to the printer driver triggers the drawer to open automatically upon cash checkout.

---

## 6. Pre-Production Roadmap & Remaining Improvements

While the codebase is **~85% production ready**, the following roadmap outlines the critical hardening tasks and enterprise feature modules required for complete store deployment.

```
===================================================================================
                       PRE-PRODUCTION IMPLEMENTATION ROADMAP
===================================================================================

[ PHASE 1: PRE-LAUNCH HARDENING (BLOCKERS) ]
   ├── Task 1.1: PWA Service Worker Asset Pre-Caching (vite-plugin-pwa)
   ├── Task 1.2: Background Sync Worker for IndexedDB Outbox Replay
   ├── Task 1.3: SQL Schema Migration Consolidation (Versioned SQL Scripts)
   └── Task 1.4: Automated Testing Suite (Jest Unit Tests & k6 Load Testing)

[ PHASE 2: ENTERPRISE POS FEATURE EXPANSION ]
   ├── Module A: Multi-Warehouse & Location Stock Transfers
   ├── Module B: Purchase Order (PO) & Vendor Receiving Workflow
   ├── Module C: Customer Credit Limit Enforcement Engine
   ├── Module D: True P&L Expense & Overhead Tracking
   ├── Module E: Direct ESC/POS Thermal Receipt Printing & Cash Drawer Kicks
   ├── Module F: GCash & PayMongo Automated QR Webhooks
   └── Module G: Promotional Discounts & Loyalty Point Redemption
===================================================================================
```

### 6.1 Phase 1: Pre-Launch Hardening Tasks (Blockers)

#### 1. PWA Service Worker Asset Pre-Caching
* **Goal:** Ensure the PWA loads instantly during complete internet outages without relying on browser HTTP cache.
* **Action:** Configure `vite-plugin-pwa` in `vite.config.ts` to generate a custom Workbox service worker caching all static bundles (`JS`, `CSS`, `Images`, `Web Fonts`).

#### 2. Background Sync Queue Worker
* **Goal:** Automatically replay transactions stored in IndexedDB (`web/offlineStore.ts`) when network connectivity is restored.
* **Action:** Register a Service Worker `sync` event listener (`background-sync`) that iterates over pending offline checkout orders in IndexedDB and posts them sequentially to `POST /api/v1/sync/push`.

#### 3. SQL Schema Migration Consolidation
* **Goal:** Replace startup `ALTER TABLE` statements in `server/app.js` with structured migration management.
* **Action:** Consolidate runtime table alterations (`is_active`, `payments`, `employee_shifts` audit columns) into a single, versioned migration file `server/migrations/002_shift_and_archiving_schema.sql`.

#### 4. Automated Testing & Load Validation
* **Goal:** Verify transactional consistency under high store traffic.
* **Action:** Implement Jest API tests for FEFO multi-lot allocation edge cases and execute k6 load testing scripts simulating 50 concurrent cashier checkouts.

---

### 6.2 Phase 2: Enterprise POS Feature Roadmap

#### Module A: Multi-Warehouse & Location Stock Transfers
* **Description:** Expand stock tracking beyond single-store inventories by introducing `locations` and `stock_transfers` tables.
* **Workflow:** Allows stock managers to transfer ingredients between a central warehouse and retail branch stores with transfer slip approval states (`pending`, `in-transit`, `received`).

#### Module B: Purchase Order (PO) & Vendor Receiving
* **Description:** Complete supply chain management for bakery raw materials.
* **Workflow:** Create POs for suppliers, track delivery receipts, automatically update `inventory_lots` upon receiving goods, and recalibrate product cost prices via weighted average cost.

#### Module C: Customer Credit Limit Enforcement Engine
* **Description:** Enforce strict credit controls for wholesale B2B buyers.
* **Workflow:** When a cashier selects "Account" (Charge) as the payment method, the server evaluates `customers.current_balance + order_total <= customers.credit_limit`. If exceeded, the transaction is blocked until manager override.

#### Module D: True P&L Expense & Overhead Tracking
* **Description:** Calculate net store profit beyond basic Gross Margin / COGS.
* **Workflow:** Add an Expenses ledger (rent, electricity, water, labor, packaging) to deduct operating expenses from gross sales revenue in the BI tab to display **True Net Operating Profit**.

#### Module E: Direct ESC/POS Thermal Printing & Cash Drawer Kicks
* **Description:** Web-native direct hardware communication.
* **Workflow:** Use WebUSB / WebBluetooth APIs or local companion HTTP bridge to send raw ESC/POS commands directly to thermal printers, printing 80mm receipts and firing the cash drawer RJ11 pulse.

#### Module F: Automated QR Payment Webhooks (GCash / PayMongo)
* **Description:** Eliminate manual cashier reference number entry for e-wallet payments.
* **Workflow:** Generate dynamic GCash QR codes on the customer-facing screen and automatically fulfill checkouts upon receiving a web-hook notification from PayMongo.

#### Module G: Promotional Discounts & Loyalty Program
* **Description:** Increase customer retention for retail bakeries.
* **Workflow:** Support "Buy 1 Take 1" promotions, mix-and-match discounts, and points accumulation where retail buyers earn 1 point per ₱100 spent to redeem as store credit.

---

## 7. Document Approval & Control

| Role | Responsibility | Status | Date |
| :--- | :--- | :--- | :--- |
| **Lead Systems Architect** | Architecture & SDD Creation | Approved | Oct 15, 2026 |
| **Lead Developer** | Codebase Integration & Review | Approved | Oct 15, 2026 |
| **QA & Operations** | Pre-Production Testing Plan | Pending Phase 1 | Oct 15, 2026 |

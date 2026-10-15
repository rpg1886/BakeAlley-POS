# Bake Alley Cloud POS — Comprehensive Technical Architecture & API Documentation

## Executive Overview
**Bake Alley Cloud POS** is a enterprise-grade, cloud-native Point of Sale and inventory management platform specifically engineered for commercial bakery and baking supply retail operations. The system addresses specialized industry requirements including fractional weight calculations, multi-tier pricing, FEFO (First-Expired, First-Out) lot allocation, multi-tender payment splitting, blind cash drawer reconciliation, and pre-order reservation workflows.

---

## 1. System Architecture & Component Topology

```
┌───────────────────────────────────────────────────────────────────────────────────┐
│                                CLIENT TIER                                         │
│                                                                                   │
│   ┌──────────────────────────────────┐      ┌─────────────────────────────────┐   │
│   │   Progressive Web App (PWA)      │      │    Electron Desktop Companion   │   │
│   │   (React 18 + Tailwind CSS)      │      │    (Local Hardware Bridge)      │   │
│   └────────────────┬─────────────────┘      └────────────────┬────────────────┘   │
│                    │                                         │                    │
│                    │ IndexedDB Outbox                        │ Serial Port        │
│                    │ (offlineStore.ts)                       │ (RS-232 Scale)     │
└────────────────────┼─────────────────────────────────────────┼────────────────────┘
                     │                                         │
                     │ HTTPS / REST API                        │ IPC
                     ▼                                         ▼
┌───────────────────────────────────────────────────────────────────────────────────┐
│                                SERVER TIER                                         │
│                                                                                   │
│   ┌───────────────────────────────────────────────────────────────────────────┐   │
│   │                       Node.js / Express Web Server                        │   │
│   │   - Zod Schema Validation             - scrypt Password Hashing           │   │
│   │   - Express Rate Limiting             - Winston Structured Logger         │   │
│   │   - Bearer Token Authorization        - Static File Asset Serving         │   │
│   └─────────────────────────────────────┬─────────────────────────────────────┘   │
│                                         │                                         │
└─────────────────────────────────────────┼─────────────────────────────────────────┘
                                          │
                                          │ Connection Pool (node-postgres / pg)
                                          ▼
┌───────────────────────────────────────────────────────────────────────────────────┐
│                               DATABASE TIER                                       │
│                                                                                   │
│   ┌───────────────────────────────────────────────────────────────────────────┐   │
│   │                        Neon PostgreSQL Database                           │   │
│   │   - 12 Core Normalized Tables         - Row-Level Locking (FOR UPDATE)    │   │
│   │   - Timezone Precision (Asia/Manila)  - JSONB Attributes Support          │   │
│   └───────────────────────────────────────────────────────────────────────────┘   │
└───────────────────────────────────────────────────────────────────────────────────┘
```

### Key Architectural Layers
1. **Frontend Tier (React 18 + PWA)**: Single-page application compiled via Vite. Employs `IndexedDB` as a transactional outbox queue for offline resilience and local cart state persistence.
2. **Backend API Tier (Node.js + Express)**: Fully typed REST API hosting business domain rules, transaction boundaries, session verification, role-based access control, and financial reporting.
3. **Database Tier (Neon PostgreSQL)**: Managed cloud PostgreSQL cluster enforcing relational constraints, decimal-safe numerical precision (`NUMERIC(12,4)` and `NUMERIC(12,2)`), and ACID compliance.
4. **Desktop Companion Tier (Electron)**: Local hardware bridge interfacing via Node `serialport` with RS-232 digital weighing scales using standard NCI protocol streams.

---

## 2. Database Schema Specification

The database consists of 12 core tables engineered for high-throughput retail transactions and accurate lot tracking.

```
                      ┌───────────────┐
                      │  categories   │
                      └───────┬───────┘
                              │ 1:N
                      ┌───────┴───────┐
                      │   products    │
                      └───────┬───────┘
                              │ 1:N
                      ┌───────┴───────┐          ┌────────────────┐
                      │product_variants├──────────┤ product_prices │
                      └───┬───────┬───┘ 1:N      └────────────────┘
                          │       │
                      1:N │       │ 1:N
      ┌───────────────────┴──┐   ┌┴───────────────────┐
      │   inventory_lots     │   │    order_items     │
      └──────────────────────┘   └────────┬───────────┘
                                          │ N:1
                                 ┌────────┴───────────┐
                                 │       orders       │
                                 └────────┬───────────┘
                                          │ N:1
                                 ┌────────┴───────────┐
                                 │     customers      │
                                 └────────────────────┘
```

### Table Definitions & Constraints

#### 1. `categories`
| Column | Type | Constraints | Description |
| :--- | :--- | :--- | :--- |
| `category_id` | `UUID` | `PRIMARY KEY` | Category unique identifier |
| `name` | `TEXT` | `NOT NULL, UNIQUE` | Category display name |
| `created_at` | `TIMESTAMPTZ` | `DEFAULT now()` | Record creation timestamp |

#### 2. `products`
| Column | Type | Constraints | Description |
| :--- | :--- | :--- | :--- |
| `product_id` | `UUID` | `PRIMARY KEY` | Parent product unique identifier |
| `category_id` | `UUID` | `REFERENCES categories(category_id)` | Linked category |
| `name` | `TEXT` | `NOT NULL` | Base product name |
| `base_uom_id` | `UUID` | `NOT NULL REFERENCES units_of_measure(uom_id)` | Base Unit of Measure |
| `is_sold_by_weight` | `BOOLEAN` | `DEFAULT FALSE` | Scale weight item flag |
| `requires_lot_tracking` | `BOOLEAN` | `DEFAULT TRUE` | Expiration tracking flag |
| `initial_cost` | `NUMERIC(12,2)` | `DEFAULT 0.00` | Cost basis for margin math |
| `created_at` | `TIMESTAMPTZ` | `DEFAULT now()` | Creation timestamp |
| `updated_at` | `TIMESTAMPTZ` | `DEFAULT now()` | Last update timestamp |

#### 3. `product_variants`
| Column | Type | Constraints | Description |
| :--- | :--- | :--- | :--- |
| `variant_id` | `UUID` | `PRIMARY KEY` | Variant unique identifier |
| `product_id` | `UUID` | `NOT NULL REFERENCES products(product_id) ON DELETE CASCADE` | Parent product ID |
| `sku` | `TEXT` | `NOT NULL, UNIQUE` | Stock Keeping Unit |
| `barcode` | `TEXT` | `UNIQUE` | EAN/UPC barcode string |
| `variant_name` | `TEXT` | `NOT NULL` | Specific variant title |
| `attributes` | `JSONB` | `DEFAULT '{}'::jsonb` | Flexible key-value metadata |
| `is_active` | `BOOLEAN` | `NOT NULL DEFAULT TRUE` | Soft-delete / archiving flag |
| `created_at` | `TIMESTAMPTZ` | `DEFAULT now()` | Creation timestamp |
| `updated_at` | `TIMESTAMPTZ` | `DEFAULT now()` | Last update timestamp |

#### 4. `inventory_lots`
| Column | Type | Constraints | Description |
| :--- | :--- | :--- | :--- |
| `lot_id` | `UUID` | `PRIMARY KEY` | Inventory lot identifier |
| `variant_id` | `UUID` | `NOT NULL REFERENCES product_variants(variant_id)` | Target variant |
| `lot_number` | `TEXT` | `NOT NULL` | Supplier or batch lot number |
| `expiration_date` | `DATE` | `NULLABLE` | Expiration date for FEFO |
| `quantity_on_hand` | `NUMERIC(12,4)` | `NOT NULL CHECK (quantity_on_hand >= 0)` | Available lot balance |
| `created_at` | `TIMESTAMPTZ` | `DEFAULT now()` | Lot creation timestamp |

#### 5. `price_tiers` & `product_prices`
* `price_tiers`: Defines price classes (`retail`, `wholesale`, `commercial`).
* `product_prices`: Connects `variant_id` and `tier_id` with `min_quantity` thresholds and `price_per_unit`.

#### 6. `orders` & `order_items`
* `orders`: Contains status (`completed`, `open`, `cancelled`), `order_mode` (`immediate` vs `reservation`), `deposit_amount`, `balance_due`, `payments` (`JSONB` array for split tender), `discount_type`, `discount_rate`, `discount_amount`, and `discount_reason`.
* `order_items`: Records quantity sold (`NUMERIC(12,4)`), unit price, total price, and lot assignment (`lot_id`).

#### 7. `app_users` & `employee_shifts`
* `app_users`: Employee credentials, role (`admin` or `cashier`), and `active` status flag.
* `employee_shifts`: Clock-in/out timestamps, `opening_float` (default ₱1,500.00), `closing_cash_count`, `expected_cash`, `cash_discrepancy`, `status` (`OPEN`/`CLOSED`), and audit notes.

---

## 3. Core API Endpoint Contract Reference

### Authentication & User Management
* `POST /api/v1/auth/login`: Validates credentials via scrypt hashing; issues session token.
* `POST /api/v1/auth/logout`: Invalidates session token.

### Products & Inventory
* `GET /api/v1/products/search?q={query}&categoryId={id}`: Returns active products (`is_active IS TRUE`), prices, and UOM.
* `GET /api/v1/inventory`: Returns current active inventory balances grouped by SKU and variant.
* `POST /api/v1/inventory/products`: Creates new product, variant, default price, and initial lot.
* `PUT /api/v1/inventory/products/:variantId`: Updates variant attributes, cost, price, or lot quantities.
* `DELETE /api/v1/inventory/products/:variantId`: Soft-deletes (archives) an item by setting `is_active = FALSE` and zeroing lot balance.

### Checkout & Reservations
* `POST /api/v1/orders`: Executes sales transaction, allocates inventory via FEFO, records split payment breakdown, and completes checkout.
* `GET /api/v1/reservations`: Returns active pre-orders and advance reservations.
* `POST /api/v1/orders/:orderId/fulfill`: Fulfills pre-order reservation, accepts final payment, and deducts stock.

### Shifts & Business Intelligence
* `POST /api/v1/employees/clock-in`: Opens new shift with opening float.
* `POST /api/v1/employees/clock-out`: Submits blind cash count, calculates expected cash based on sales, records discrepancy, and closes shift.
* `GET /api/v1/sales/report?date={YYYY-MM-DD}&range={monthly|yearly}`: Computes daily/periodic sales, COGS, discounts, and channel revenue split.

---

## 4. Key Algorithms & Business Logic

### 1. FEFO (First-Expired, First-Out) Stock Deduction
When an order is submitted, stock is deducted within a database transaction using explicit row locking:

```sql
SELECT lot_id, quantity_on_hand 
FROM inventory_lots 
WHERE variant_id = $1 AND quantity_on_hand > 0 
ORDER BY expiration_date ASC NULLS LAST, lot_id ASC 
FOR UPDATE;
```

The server iterates through available lots, deducting required quantities until the line item is satisfied. If total available quantity is insufficient, the transaction rolls back with a `409 INVENTORY_CONFLICT` error.

### 2. Blind Cash Drawer Reconciliation
To prevent cashier theft or bias during shift close:
1. Cashier enters `closing_cash_count` without viewing system-calculated totals.
2. Server calculates:
   $$	ext{Expected Cash} = 	ext{Opening Float} + 	ext{Cash Sales} - 	ext{Cash Refunds}$$
3. Server records:
   $$	ext{Cash Discrepancy} = 	ext{Closing Cash Count} - 	ext{Expected Cash}$$
   Negative values log a **Shortage**, positive values log an **Overage**.

### 3. Soft Delete (Archiving) Protocol
Hard deletion of inventory items is blocked to preserve historical sales records and foreign key constraints in `order_items`. When an item is archived:
1. `product_variants.is_active` is updated to `FALSE`.
2. Available `quantity_on_hand` in `inventory_lots` is zeroed out.
3. Checkout search (`GET /api/v1/products/search`) and active inventory views (`GET /api/v1/inventory`) filter items with `WHERE (v.is_active IS TRUE OR v.is_active IS NULL)`.

---

## 5. Hardware Interfacing & Deployment

### Hardware Integration
* **Scale Interface**: Electron companion reads RS-232 serial streams, parses ASCII NCI protocol frames (`<STX>W<CR>`), and transmits stable weight readings to React frontend via IPC.
* **Barcode Reader**: Scanners operate in USB HID Keyboard mode, instantly populating active input fields and triggering line-item lookup on `Enter`.
* **Receipt Printer & Cash Drawer**: Thermal printing issues raw ESC/POS commands; drawer kick occurs via printer RJ12 pulse command (`ESC p 0 25 250`).

### Deployment Environment
* **Frontend**: Hosted on GitHub Pages / Vercel / Railway static web server.
* **Backend API**: Hosted on Railway / Render Node.js environment (`node server/app.js`).
* **Database**: Hosted on Neon PostgreSQL managed cloud platform (`Asia/Manila` timezone alignment).

---
*Generated for Bake Alley Cloud POS System Architecture.*

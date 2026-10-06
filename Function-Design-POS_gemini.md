# Bake Alley Cloud POS — Master Functional Design & System Architecture

## 1. Executive Purpose & System Scope

Bake Alley POS is an omnichannel point-of-sale platform migrating from a standalone desktop application (Electron, React, Vite, Tailwind CSS, `better-sqlite3`) to a cloud-ready, multi-device Progressive Web App (PWA) backed by Node.js, Express, and PostgreSQL.

### Core Objectives
* **Omnichannel Multi-Device Availability**: Support seamless store operations on desktop browsers, tablets, and mobile phones, while retaining the desktop Electron application as an optional hardware companion for physical store peripherals (RS-232 weight scales, thermal receipt printers, cash drawers).
* **Remote Store Administration**: Enable store owners and managers to monitor live transactions, inspect financial reconciliation statements, manage inventory catalogs, and audit cashier shifts remotely from any browser.
* **Offline-First Resilience**: Guarantee uninterrupted store checkout during internet outages through IndexedDB local caching, transactional outboxes, and idempotent synchronization.
* **Strict Domain & Compliance Rules**: Enforce First-Expired, First-Out (FEFO) inventory lot deductions, exact decimal currency/weight precision, strict role-based access control (RBAC), and staff accountability.

---

## 2. Architecture & Migration Baseline

### Target System Architecture
```text
Desktop / Tablet / Mobile Browser
              │
       React + Vite + Tailwind PWA
              │
       Node.js / Express REST API
              │
      Managed PostgreSQL (Neon.tech)
              │
 Optional Local Desktop Companion (Electron)
              │
       RS-232 Scale / Thermal Printer
```

### Offline-First Synchronization Flow
```text
React PWA ──> Local IndexedDB ──> Transactional Outbox ──> Idempotent Batch Sync ──> Express API ──> PostgreSQL
```

### Separation of Concerns
* **Reusable UI Components**: Checkout cart, product grids, inventory management tables, sales report cards, CRM profiles, and shift management panels depend on platform-neutral TypeScript contracts.
* **Desktop Hardware Adapters**: Electron `main` process, `src/preload.ts`, `better-sqlite3`, `serialport`, and ESC/POS thermal printing routines remain encapsulated as optional desktop-only bridges.
* **Server Authority**: The Express/PostgreSQL backend remains authoritative for pricing calculations, money operations, inventory deductions, employee authentication, and session control.

---

## 3. PostgreSQL Database Schema & Data Models

All primary keys across SQLite, IndexedDB, and PostgreSQL use UUID v4 strings (`crypto.randomUUID()` or `gen_random_uuid()`). Money fields use `NUMERIC(12,2)` with `CHECK >= 0`, and quantity/weight fields use `NUMERIC(12,4)`.

### Core Data Models

#### `app_users`
Stores user accounts for administrators and cashiers, supporting soft deletion and session controls.
```sql
CREATE TABLE IF NOT EXISTS app_users (
  user_id UUID PRIMARY KEY,
  username TEXT NOT NULL UNIQUE,
  display_name TEXT NOT NULL,
  role TEXT NOT NULL CHECK (role IN ('admin', 'cashier')),
  password_salt TEXT NOT NULL,
  password_hash TEXT NOT NULL,
  active BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
```

#### `sessions`
Persists active user bearer token sessions across server restarts with hourly expiration cleanup.
```sql
CREATE TABLE IF NOT EXISTS sessions (
  session_id UUID PRIMARY KEY,
  user_id UUID NOT NULL REFERENCES app_users(user_id) ON DELETE CASCADE,
  token TEXT NOT NULL UNIQUE,
  expires_at TIMESTAMPTZ NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
```

#### `employee_shifts`
Tracks shift clock-ins, starting cash floats, blind cash counts, expected totals, and cash discrepancies.
```sql
CREATE TABLE IF NOT EXISTS employee_shifts (
  shift_id UUID PRIMARY KEY,
  user_id UUID NOT NULL REFERENCES app_users(user_id) ON DELETE CASCADE,
  clock_in TIMESTAMPTZ NOT NULL DEFAULT now(),
  clock_out TIMESTAMPTZ,
  opening_float NUMERIC(12,2) DEFAULT 1500.00,
  closing_cash_count NUMERIC(12,2),
  expected_cash NUMERIC(12,2),
  cash_discrepancy NUMERIC(12,2),
  status TEXT DEFAULT 'OPEN',
  notes TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
```

#### `orders`
Stores order headers including single-tender and multi-tender split payment details.
```sql
CREATE TABLE IF NOT EXISTS orders (
  order_id UUID PRIMARY KEY,
  customer_id UUID REFERENCES customers(customer_id) ON DELETE SET NULL,
  pricing_tier_id UUID NOT NULL REFERENCES price_tiers(tier_id),
  employee_id UUID REFERENCES app_users(user_id) ON DELETE SET NULL,
  order_type TEXT NOT NULL CHECK (order_type IN ('retail', 'commercial')),
  status TEXT NOT NULL DEFAULT 'completed' CHECK (status IN ('open', 'completed', 'voided')),
  subtotal NUMERIC(12,2) NOT NULL CHECK (subtotal >= 0),
  tax_amount NUMERIC(12,2) NOT NULL DEFAULT 0 CHECK (tax_amount >= 0),
  total_amount NUMERIC(12,2) NOT NULL CHECK (total_amount >= 0),
  payment_method TEXT NOT NULL CHECK (payment_method IN ('cash', 'card', 'gcash', 'account', 'split')),
  cash_received NUMERIC(12,2) NOT NULL DEFAULT 0 CHECK (cash_received >= 0),
  change_due NUMERIC(12,2) NOT NULL DEFAULT 0 CHECK (change_due >= 0),
  payments JSONB,
  created_at TIMESTAMPTZ NOT NULL,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
```

#### `order_items`
Itemized transaction line items linked directly to FEFO inventory lots.
```sql
CREATE TABLE IF NOT EXISTS order_items (
  order_item_id UUID PRIMARY KEY,
  order_id UUID NOT NULL REFERENCES orders(order_id) ON DELETE CASCADE,
  variant_id UUID NOT NULL REFERENCES product_variants(variant_id),
  lot_id UUID REFERENCES inventory_lots(lot_id),
  quantity NUMERIC(12,4) NOT NULL CHECK (quantity > 0),
  unit_price NUMERIC(12,2) NOT NULL CHECK (unit_price >= 0),
  total_price NUMERIC(12,2) NOT NULL CHECK (total_price >= 0)
);
```

---

## 4. API Specification & Endpoint Directory

All Express API endpoints enforce strict JSON schema validation via Zod, rate limiting via `express-rate-limit`, structured logging via Winston, and CORS origin whitelisting.

| Method | Endpoint Path | Auth Guard | Purpose & Description |
| :--- | :--- | :--- | :--- |
| `POST` | `/api/v1/auth/login` | Public | Validates user credentials with `crypto.scryptSync`, creates bearer session token in `sessions` table (24-hour expiry). |
| `POST` | `/api/v1/auth/logout` | Session | Removes bearer token from `sessions` table. |
| `GET` | `/api/v1/health` | Public | System health and connectivity probe. |
| `GET` | `/api/v1/version` | Public | Returns application build and version metadata. |
| `GET` | `/api/v1/categories` | Session | Fetches product categories list. |
| `GET` | `/api/v1/products/search` | Session | Full-text search for product variants by SKU, barcode, or name with tier pricing. |
| `GET` | `/api/v1/units-of-measure` | Session | Fetches unit of measure reference definitions. |
| `GET` | `/api/v1/customers` | Session | Fetches customer profiles with pricing tier assignments. |
| `POST` | `/api/v1/customers` | Session | Creates new customer record with pricing tier assignment. |
| `DELETE` | `/api/v1/customers/:id` | Admin | Deletes customer profile (protected; blocks deletion if customer has completed orders). |
| `GET` | `/api/v1/inventory` | Session | Fetches aggregated inventory levels, FEFO lot expiration dates, capital costs, and retail prices. |
| `POST` | `/api/v1/inventory/adjust` | Session | Restocks or adjusts lot quantity and retail price in a single transaction. |
| `POST` | `/api/v1/inventory/products` | Admin | Creates new product, variant, pricing tier entry, and initial lot atomically. |
| `PUT` | `/api/v1/inventory/products/:variantId` | Admin | Updates variant name, SKU, retail price, initial cost, quantity, or FEFO lot expiration. |
| `GET` | `/api/v1/employees` | Session | Fetches employee roster with date-filtered sales totals and active status. |
| `POST` | `/api/v1/employees` | Admin | Creates new employee or reactivates soft-deleted account (`active = TRUE`) with new password hash. |
| `DELETE` | `/api/v1/employees/:userId` | Admin | Soft-deletes employee account (`active = FALSE`) and purges active sessions (`DELETE FROM sessions`). |
| `POST` | `/api/v1/employees/:userId/reset-password` | Admin | Admin-only password reset with 12+ char validation and active session purge. |
| `POST` | `/api/v1/employees/clock-in` | Session | Starts employee shift with opening cash float validation (default ₱1,500.00). |
| `POST` | `/api/v1/employees/clock-out` | Session | Ends employee shift with blind cash count audit and discrepancy calculation. |
| `GET` | `/api/v1/employees/shifts` | Session | Fetches date-filtered shift calendar and cash reconciliation logs. |
| `POST` | `/api/v1/orders` | Session | Processes orders with FEFO lot locks, price validation (±0.005 tolerance), multi-tender split processing, and idempotency. |
| `GET` | `/api/v1/sales/report` | Session | Fetches daily transaction audits, itemized sales, split tender breakdowns, and period summaries. |
| `GET` | `/api/v1/sales/monthly` | Session | Fetches 12-month comparative analytics, gross profit, actual COGS, and split sales breakdowns. |

---

## 5. Major Feature Implementations & Technical Evolution

### A. Employee Account Soft Delete & Session Revocation System (2026-10-05)
To preserve historical audit trails on sales reports and shift logs, hard deletion of user accounts was replaced with a soft-delete architecture:
* **Soft Delete Pattern**: Account removal executes `UPDATE app_users SET active = FALSE, updated_at = now() WHERE user_id = $1`.
* **Immediate Access Revocation**: Deactivating an employee immediately purges all active session tokens (`DELETE FROM sessions WHERE user_id = $1`), revoking login access instantly across all active browser sessions.
* **Account Reactivation**: Re-creating an employee with a previously soft-deleted username reactivates the account (`active = TRUE`) and updates display name, role, salt, and hash rather than failing on duplicate username constraints.
* **Self-Deactivation Guard**: Prevents logged-in admin accounts from deactivating themselves (`CANNOT_DELETE_SELF`).
* **Session Middleware Integration**: `requireSession` SQL lookup includes `AND u.active = TRUE`, immediately rejecting requests from deactivated staff.
* **UI Controls**: In `web/CloudApp.tsx`, the action button was updated from "Delete" to "Deactivate", triggering a confirmation modal explaining account deactivation and login revocation.

### B. Admin-Only Employee Password Reset (2026-10-05)
Implemented a dedicated route and UI workflow for administrators to reset employee credentials:
* **Endpoint & RBAC Guard**: `POST /api/v1/employees/:userId/reset-password` guarded by `auth.requireSession` and `auth.requireAdmin`.
* **Security Standards**: Validates minimum 12-character password length, generates a fresh random 16-byte salt (`crypto.randomBytes`), computes scrypt hash (`crypto.scryptSync`), and purges active user sessions (`DELETE FROM sessions WHERE user_id = $1`) to force re-authentication.
* **UI Controls**: Amber-styled "Reset Password" button added to `EmployeesView` table for admins, configured with flex container spacing (`gap-2`) alongside "Deactivate". Triggers a modal dialog with password validation and real-time state feedback.

### C. Multi-Tender Split & Partial Payment Architecture (2026-10-05 to 2026-10-06)
Developed a complete multi-tender split payment engine supporting custom partial payments across Cash, GCash, Card, and Commercial Accounts:
* **Multi-Tender Engine**: Allows single orders to be settled across multiple payment methods (e.g., ₱600 GCash + ₱500 Cash for a ₱1,000 order).
* **Validation Schema**: `orderPayloadSchema` accepts `paymentMethod: 'split'` and a `payments` JSON array schema (`[{ method, amount, cashReceived? }]`).
* **Database Representation**: `orders.payments` column stores the full JSON breakdown array. Constraint updated to `CHECK (payment_method IN ('cash', 'card', 'gcash', 'account', 'split'))`.
* **Checkout UI Engine (`src/components/CheckoutScreen.tsx`)**:
  * Payment modal supports entering partial payment amounts.
  * "Add Partial Payment" button records partial amounts, keeps modal open, displays a "Recorded Partial Payments" list, and dynamically calculates remaining balance needed (`totalAmount - totalPaidSoFar`).
  * Real-time calculation of change due or amount still needed per cash entry (`cashTendered - remainingBalance`).
  * Confirmation button displays total change due upon completing cash or split-cash transactions (`Confirm & Complete payment (Change Due: ₱X.XX)`).
  * Post-checkout banner displays exact change due to the customer.
* **Backend Server-Side Split Change Calculation (`server/app.js`)**:
  * Calculates `changeDue` from the cash component of split payments (`totalCashTenderedInSplit - totalCashNeeded`).
* **Financials & Sales Reporting Integration**:
  * `GET /api/v1/sales/report` returns `payments` JSON array parsed as typed objects.
  * `GET /api/v1/sales/monthly` parses `payments` JSON to allocate split transaction amounts across `cashSales`, `gcashSales`, `cardSales`, and `accountSales`.
  * Financials tab "Register Cash Drawer vs Digital Tender" aggregates split payment items per tender type (`paymentBreakdownDaily`) without duplicate counting.
  * Sales tab transaction audit table displays detailed split tender breakdown pills (e.g. `🔀 Split: 📱 GCash: ₱500.00 · 💵 Cash: ₱300.00 · 💳 Card: ₱200.00`) and displays **Cash Received** & **Change Given** for split-cash orders.

### D. Bug Remediation & Infrastructure Hardening (2026-10-05 to 2026-10-06)
* **Inventory Update UUID Regex Fix**: Corrected escaped dollar sign (`\$`) in UUID validation regex inside `server/app.js` (`/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i`) that previously caused `INVALID_VARIANT_ID` (Error 400) during inventory adjustments.
* **SQL Parameter Placeholder Un-Escaping**: Fixed escaped backslashes in SQL queries (e.g., `\$1`, `app\_users`) that caused PostgreSQL Syntax Error `42601` during session validation, employee deletion, and order processing.
* **Variable Reference Fix**: Resolved `totalcashReceived` vs `totalCashReceived` variable casing mismatch in `server/app.js` that previously caused a `ReferenceError` (500 Internal Error) on non-cash payments.
* **CI/CD Deployment Workflow Hardening**: Updated `.github/workflows/deploy-pages.yml` with build output verification (`ls -la dist/cloud`) and documented switching GitHub Pages deployment source setting to `GitHub Actions` to resolve `Found 0 artifact(s)` deployment errors.

---

## 6. Deployment & Environment Reference

### Production Infrastructure Stack
* **API Web Service**: Railway.app (Node.js runtime, custom Start Command `node server/app.js`, Port forwarding 8080)
* **Database Management**: Neon.tech (Managed PostgreSQL instance with connection pooling)
* **PWA Frontend Hosting**: GitHub Pages (`https://rpg1886.github.io/BakeAlley-POS/`, GitHub Actions deployment workflow)

### Production Deployment Verification
- [x] Session persistence via PostgreSQL `sessions` table with hourly expiration cleanup
- [x] Server-side `changeDue` calculation for single cash and multi-tender split orders
- [x] Zod schema validation across all 15 API endpoints
- [x] Winston structured logging with daily file rotation and console output
- [x] Rate limiting configured (Login: 5 req/15min, API: 100 req/1min)
- [x] Price tolerance verification set to ±0.005 (half-cent boundary)
- [x] GitHub Pages Actions workflow configured and verified (`ls -la dist/cloud`)

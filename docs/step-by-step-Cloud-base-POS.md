# Step-by-Step Cloud-Based POS Plan

## Goal

Migrate Bake Alley POS from the current Electron/SQLite desktop application to a cloud-based POS that works on desktop browsers, tablets, and mobile phones while preserving the existing Electron client, local data, scales, and receipt printers.

The end state should support:

- Store checkout from desktop and tablet browsers
- Mobile access for monitoring and lightweight operations
- Offline checkout with safe synchronization
- Remote sales, inventory, finance, CRM, and employee monitoring from home
- Admin and cashier permissions
- Philippine timezone reporting and PHP currency display
- RS-232 scales and thermal printers through a local hardware companion

## Repository and Branch Strategy

Keep the current desktop POS stable on `main`. Create a dedicated migration branch:

```powershell
git switch -c cloud-pos
```

Do not delete or overwrite the Electron implementation. Use additive adapters, shared contracts, database migrations, and platform-neutral repositories.

A separate repository is only needed later if the cloud system requires independent teams, permissions, deployment lifecycle, or release management.

## Target Architecture

```text
Desktop / tablet / mobile browser
              |
       React + Vite + Tailwind PWA
              |
       Node.js / Express API
              |
           PostgreSQL
              |
 Optional local hardware companion
              |
        RS-232 scale / printer
```

Offline browser flow:

```text
PWA + IndexedDB -> transactional outbox -> batch sync -> PostgreSQL
```

## Phase 0: Protect the Current POS

Tasks:

- Create the `cloud-pos` branch.
- Confirm Electron main and renderer builds pass.
- Back up the local SQLite database.
- Keep `run-pos.bat` working.
- Add regression tests around checkout, payment, FEFO, CRM, employees, and reports.
- Remove demo credentials before production deployment.

Acceptance criteria:

- Existing desktop checkout remains usable.
- Existing SQLite records are preserved.
- A failed cloud experiment cannot damage the local POS.

## Phase 1: Extract Shared Contracts

Create platform-neutral contracts for:

- Products and product variants
- Units of measure
- Pricing tiers and quantity thresholds
- Customers and CRM
- Inventory lots
- Orders and order items
- Payments
- Users and roles
- Employees and shifts
- Sales reports
- Sync events and idempotency keys

The Electron application and web application should consume these contracts without sharing Electron, SQLite, or browser-specific code.

## Phase 2: PostgreSQL Schema and Migrations

Create versioned PostgreSQL migrations for:

- Units and UOM conversions
- Categories, products, and variants
- Initial costs and prices
- Price tiers
- Customers, contact fields, tags, and loyalty
- Inventory lots
- Orders, order items, and payment details
- Users and roles
- Employee shifts and order attribution
- Sync events and sync state
- Audit logs

Rules:

- UUID v4 identifiers
- `NUMERIC(12, 4)` for quantities, rates, and weights
- `NUMERIC(12, 2)` for prices and money
- FEFO indexes
- Reporting indexes by business date
- Foreign keys and parameterized queries
- Non-destructive migrations

Acceptance criteria:

- PostgreSQL can be created from an empty database using migrations.
- SQLite and PostgreSQL record counts can be compared during migration.
- A rollback plan exists for every production migration.

## Phase 3: Cloud Authentication and Authorization

Implement server-backed authentication:

- Secure password hashes using Argon2id or scrypt
- Short-lived sessions or tokens
- Secure refresh strategy
- HTTPS in production
- Server-side role checks on every protected route
- Audit logging
- Forced password change for first-run accounts

Roles:

- **Cashier:** checkout, customer lookup/creation, inventory read, daily transaction detail, own clock in/out
- **Admin:** all cashier permissions plus inventory import, customer deletion subject to order protection, employee creation, role assignment, sales summaries, markup reports, and shift calendar

Acceptance criteria:

- A cashier cannot call admin endpoints directly.
- An admin can access administrative workflows.
- No production default credentials remain.

## Phase 4: API and Server-Owned Business Rules

Build the Express API:

```text
POST /api/v1/auth/login
POST /api/v1/auth/logout
GET  /api/v1/products/search
GET  /api/v1/customers
POST /api/v1/customers
DELETE /api/v1/customers/:id
POST /api/v1/orders
GET  /api/v1/inventory
POST /api/v1/inventory/import
GET  /api/v1/sales/report
GET  /api/v1/employees
POST /api/v1/employees
POST /api/v1/employees/clock-in
POST /api/v1/employees/clock-out
GET  /api/v1/employees/shifts
POST /api/v1/sync/push
GET  /api/v1/sync/pull
GET  /api/v1/health
GET  /api/v1/version
```

Move authoritative operations behind the API:

- Price resolution
- Cash tender and change validation
- Order creation
- FEFO inventory deduction with row locks
- Inventory imports
- Customer deletion protection
- Employee permissions
- Sales and finance reports
- Sync conflict handling

The browser may preview values, but the API must recalculate and validate them before committing.

## Phase 5: First Cloud Vertical Slice

Build the smallest useful cloud workflow first:

1. User login with admin/cashier roles.
2. Product search from PostgreSQL.
3. Customer lookup and creation.
4. Online checkout.
5. Server-side pricing validation.
6. Server-side FEFO inventory deduction.
7. Payment method, cash received, and change due persistence.
8. Daily transaction report using `Asia/Manila` boundaries.
9. Remote daily sales monitoring from a browser.

Acceptance criteria:

- A store device can complete an online order.
- A remote browser can see the completed transaction.
- Inventory is deducted once.
- Duplicate sync/order submission is idempotent.
- The Electron desktop POS remains functional.

## Phase 6: Responsive PWA Frontend

Create a browser frontend with:

- React, TypeScript, Vite, and Tailwind
- PWA manifest and service worker
- Responsive desktop, tablet, and mobile layouts
- Login and role-aware navigation
- Checkout
- Inventory
- Sales
- CRM
- Employees
- Admin inventory import
- Offline and sync status indicators

Device expectations:

- **Desktop:** keyboard workflows, reports, barcode scanners, administration
- **Tablet:** primary checkout device with touch-friendly layout
- **Mobile:** monitoring, quick lookup, inventory, and lightweight checkout

Users should not need Node.js, Electron, Python, Visual Studio Build Tools, or native SQLite dependencies to use the PWA.

## Phase 7: IndexedDB Offline Support

Recommended browser stores:

- `catalog_cache`
- `customer_cache`
- `inventory_cache`
- `draft_orders`
- `sync_queue`
- `sync_state`
- `auth_session`
- `device_settings`

Implement:

- Local transactional order/outbox writes
- Batch size capped at 50
- Network availability checks
- Exponential backoff
- Pending, processing, synced, and failed states
- Safe replay after browser restart
- Visible pending-sync count and last sync time
- Conflict and retry UI

Server inventory remains authoritative when devices reconnect.

## Phase 8: CRM, Employees, and Admin Workflows

CRM:

- Customer profiles
- Email and phone
- Tags
- Loyalty points
- Purchase count
- Lifetime value
- Last purchase
- Admin-only deletion with order protection

Employees:

- Admin creates employees
- Role limited to `admin` or `cashier`
- Cashier sees only own shift controls
- Admin sees employee team and selected-day performance
- Clock-in/out records
- Shift calendar
- Sales attribution by employee

## Phase 9: Hardware Companion

A browser cannot reliably access every RS-232 scale or USB thermal printer.

Use a local Electron/Node companion for:

- NCI/Toledo scale readings
- Device status
- ESC/POS printing
- Cash drawer signals if required

Alternative options:

- Web Serial/WebUSB in controlled browsers
- Network-enabled scales and printers
- Bluetooth peripherals

The companion must not expose arbitrary filesystem, SQLite, or Node access to the browser.

## Phase 10: Offline, Concurrency, and Failure Testing

Add focused tests for:

- Online checkout
- Offline checkout and replay
- Duplicate order submission
- Batch sync up to 50 records
- Exponential retry/backoff
- FEFO concurrent sales
- Insufficient inventory
- Cash tender and change due
- Admin/cashier authorization
- Customer deletion protection
- Employee clock-in/out
- Philippine timezone day boundaries
- Sales payment-method reporting
- PWA update with pending offline transactions

## Phase 11: Staging and Pilot

Create separate environments:

```text
development
staging
production
```

Staging must test:

- Multiple checkout devices
- Desktop, tablet, and mobile browsers
- Offline periods
- Concurrent inventory deductions
- Browser refresh and service-worker updates
- Role enforcement
- Scale and printer bridge
- Database restore and migration rollback

Pilot with one store, one tablet, one admin, one cashier, and one hardware setup. Keep Electron and cloud POS running in parallel during the pilot.

## Phase 12: Production Deployment and Updates

Production requirements:

- HTTPS
- Hosted frontend
- Hosted API
- Managed PostgreSQL
- Database backups
- CI build and test pipeline
- Health checks
- Monitoring and error tracking
- Version endpoint
- Hashed frontend assets
- Service-worker cache invalidation
- New-version notification
- Backward-compatible API rollout
- Rollback plan

Cloud users receive updates after frontend/API redeployment and reload/service-worker activation. Electron users require a rebuilt installer or Electron auto-updater.

## Hardware and Device Checklist

For normal browser checkout:

- Modern browser
- HTTPS
- Reliable internet or installed PWA for offline mode
- Bluetooth barcode scanner or camera scanning
- Tablet, desktop, or mobile device

For scales and printers:

- Local hardware bridge, network device, or supported Web Serial/WebUSB device
- Device permissions
- Store LAN access where applicable

## Definition of Done

The cloud POS is ready for rollout when:

- It works in desktop and tablet browsers.
- Mobile behavior is tested and documented.
- Offline checkout works and replays safely.
- Server-side roles and business rules are enforced.
- PostgreSQL migrations are repeatable.
- Remote sales and monitoring work from outside the store.
- Inventory concurrency is safe.
- Hardware integration works through the selected bridge.
- Electron has not regressed.
- Data migration and rollback procedures are tested.

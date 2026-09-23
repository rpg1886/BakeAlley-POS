# Bake Alley Cloud POS Functional Design

## Purpose

Bake Alley POS is migrating from a local Electron/SQLite application to a cloud-capable POS that works on desktop browsers, tablets, and mobile phones. The current Electron application remains supported during migration and may continue serving as a hardware companion for scales and printers.

The cloud product must support remote monitoring from home, shared store transactions, offline checkout, safe synchronization, inventory and FEFO rules, CRM, employee management, sales reporting, payments, and administrative controls.

## Current Baseline

The current repository contains a working Electron desktop shell with:

- React, Vite, and Tailwind renderer
- Electron main process and preload bridge
- `better-sqlite3` local database
- Transactional local outbox
- Checkout with customer pricing, payment methods, cash tender, and change due
- Inventory lots and FEFO deductions
- Admin inventory import
- Sales reporting with Philippine timezone and PHP display formatting
- CRM customer profiles and employee shift/performance features
- RS-232 scale parsing through `serialport`
- PostgreSQL sync ingestion route

The cloud migration must be additive. The Electron desktop POS on `main` must remain runnable while cloud work is developed on a dedicated migration branch.

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

## Reusable Components

The following areas can be reused with limited changes:

- Checkout layout and cart interaction patterns
- Inventory and Sales presentation components
- CRM and Employee presentation concepts
- Product, pricing, customer, order, inventory, and employee TypeScript contracts
- Decimal rounding and currency display rules
- FEFO domain rules and sales-report definitions
- Role names and permission concepts
- Sync worker batching and exponential backoff behavior

These components should depend on platform-neutral interfaces rather than Electron IPC directly.

## Electron-Specific Adapters

The following modules should remain desktop-only or become optional hardware adapters:

- Electron `BrowserWindow` startup
- `src/preload.ts`
- `better-sqlite3` access
- `serialport` scale access
- ESC/POS USB/serial printing
- Electron-specific launch and native-module packaging

The web frontend must not import these modules. Browser components should call typed HTTP/API and IndexedDB repositories.

## PostgreSQL Migration Scope

PostgreSQL migrations must cover the current domain and new cloud requirements:

- Units of measure and conversions
- Categories, products, and product variants
- Initial cost and retail/wholesale product prices
- Customers, contact fields, tiers, tags, loyalty accounts
- Inventory lots and expiration dates
- Orders, order items, payment method, cash received, and change due
- Users, roles, password hashes, and active state
- Employee shifts and employee order attribution
- Sync events, idempotency keys, and sync state
- Audit events for admin actions

Use UUID v4 identifiers, numeric precision rules, indexes for FEFO and reporting, and versioned migrations. Preserve existing IDs and transaction history when importing SQLite data.

## API Ownership

Business operations that must move behind the API:

- Authentication and role authorization
- Product and customer lookup
- Customer creation and protected deletion
- Price resolution
- Order creation and payment validation
- FEFO inventory deduction with row locking
- Inventory imports
- Daily and period sales reports
- Employee creation, permissions, clock events, and performance
- Sync push/pull and conflict handling

The browser may preview data but the server remains authoritative for money, pricing, inventory, permissions, and order acceptance.

## Browser Offline Stores

Use IndexedDB through a typed repository layer. Recommended stores:

- `catalog_cache`
- `customer_cache`
- `inventory_cache`
- `draft_orders`
- `sync_queue`
- `sync_state`
- `auth_session`
- `device_settings`

A checkout should write its local order event and sync queue record in one IndexedDB transaction. The sync worker should claim at most 50 records, push idempotent batches, apply capped exponential backoff, expose pending/error status, and safely resume after browser restart.

## Hardware Companion

A browser cannot reliably access every RS-232 scale or USB thermal printer. Prefer a local Electron/Node companion over localhost WebSocket or HTTP for:

- NCI/Toledo scale readings
- Device connection status
- ESC/POS printing
- Cash drawer signals where needed

Web Serial/WebUSB and network hardware may be supported where device and browser compatibility are controlled.

## Roles and Access

- **Cashier:** checkout, customer lookup/creation, inventory read, daily transaction detail, own clock in/out
- **Admin:** all cashier features plus inventory import, customer deletion subject to order protection, employee creation, role assignment, sales summaries, markup reports, and shift calendar

Enforce these permissions in the API, not only in React controls.

## First Vertical Slice

The smallest useful cloud migration slice is:

1. PostgreSQL migrations for users, products, customers, orders, order items, and inventory lots.
2. Server authentication with cashier/admin role checks.
3. Product and customer API reads.
4. API-backed checkout with server-side price and FEFO validation.
5. Browser IndexedDB draft/outbox storage.
6. Sync push/pull with idempotency and batch size 50.
7. Remote daily Sales report with explicit `Asia/Manila` date bounds.
8. Responsive desktop/tablet/mobile checkout and transaction view.

This slice enables a store checkout device and a remote administrator to use the same cloud data before migrating every admin feature.

## Device Support

- **Desktop:** keyboard, Bluetooth barcode scanner, reports, admin workflows
- **Tablet:** recommended checkout form factor with touch-friendly cart and payment layouts
- **Mobile:** quick lookup, inventory, CRM, lightweight checkout, and remote monitoring

Users need a modern browser, HTTPS, network access for synchronization, and browser storage. They do not need Node.js, Electron, Python, Visual Studio Build Tools, or native SQLite for the PWA.

## Deployment and Updates

Cloud deployment should use:

- HTTPS frontend hosting
- Hosted Node.js API
- Managed PostgreSQL with backups
- CI build/test pipeline
- Versioned migrations
- Staging and production environments
- Health checks and monitoring
- Version endpoint and hashed assets
- Service-worker cache invalidation
- New-version notification and controlled reload
- Backward-compatible API rollout and rollback plan

Redeploying the cloud frontend/API updates users after reload and service-worker activation. The installed Electron client still requires packaging or auto-update separately.

## Risks and Controls

- **Offline conflicts:** server idempotency, inventory locks, and explicit conflict states
- **Timezone errors:** use `Asia/Manila` business-day bounds, never database-local date functions
- **Unauthorized admin actions:** API role checks and audit events
- **Native hardware limitations:** local hardware companion
- **Data migration:** dry-run SQLite export, validation counts, backups, and reversible migrations
- **Stale PWA assets:** version endpoint, hashed bundles, and update prompt
- **Money errors:** decimal-safe helpers and PostgreSQL numeric types

## Definition of Done

A cloud feature is complete when it works on desktop and tablet browsers, has a documented mobile behavior, supports required offline behavior, synchronizes safely, enforces server-side roles, has PostgreSQL migrations, includes focused tests, does not regress Electron, and has deployment/rollback documentation.

## Change Rule

Any cloud implementation that changes behavior, contracts, schema, synchronization, security, deployment, or hardware integration must update this document in the same change set.

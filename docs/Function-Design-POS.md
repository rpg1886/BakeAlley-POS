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

## Initial Cloud Slice Implementation

The first cloud slice now includes a PostgreSQL migration at `server/migrations/001_cloud_pos.sql`, a pooled database/migration helper at `server/db.js`, authentication middleware at `server/auth.js`, and an Express API bootstrap at `server/app.js`.

Implemented API behavior:

- User login/logout with bearer sessions
- Product search
- Customer lookup
- Inventory lookup
- Server-authoritative order creation
- Cash validation and payment persistence
- FEFO inventory deduction with row locks
- Idempotent order creation by `order_id`
- Philippine timezone-compatible daily sales query
- Health and version endpoints

The cloud API is started with `npm run cloud:start` after `DATABASE_URL` is configured. The existing Electron startup and local SQLite workflow remain unchanged. PostgreSQL user/product seed data and production deployment secrets are still required before a remote pilot.

Cloud prerequisite scaffolding is now present: `.env.example`, the `cloud:seed-admin` command, `web/apiClient.ts`, and `web/offlineStore.ts`. The browser adapters are intentionally separate from the Electron build; they provide typed API access and an IndexedDB outbox foundation without exposing SQLite or Node APIs to browser code.

The first browser-facing PWA slice is now present under `web/`: a Vite entry, cloud login, API-backed customer/product access, and an adapted checkout surface. Its build is separate from the Electron renderer through `npm run cloud:build`. Hardware readings currently require the optional local companion; PostgreSQL credentials and a deployed API are still required for runtime use.

An additive local-data bridge is now available as `npm run cloud:import-local`. It reads the existing Electron SQLite database (or `SQLITE_PATH`) and idempotently imports units, categories, tiers, products, variants, prices, customers, and inventory lots into PostgreSQL. It does not modify or delete the SQLite source and does not overwrite cloud user credentials.

The cloud browser shell now includes responsive Checkout, Sales, Inventory, CRM, and Employees tabs. Cloud CRM supports customer creation and protected admin deletion; Employees supports role-filtered listing, admin creation, clock in/out, sales totals, and recent shifts. The API migration adds `employee_shifts`; the existing Electron tabs and SQLite workflows remain unchanged.

The cloud dashboard now supports manual inventory maintenance for admins. Inventory exposes a refresh action, CSV export, retail price, variant identity, and an add/adjust form that creates or replaces a specific lot quantity and retail price through a transactional server endpoint. Sales uses the `Asia/Manila` business date and can be refreshed after checkout; CRM and Employees also expose explicit refresh actions.

Cloud parity follow-up adds a selectable transaction date to Sales, admin-only week/month/year summaries, server-normalized inventory money/quantity values, visible success and error states for inventory and CRM saves, full CRM contact columns, an employee add form with password validation, explicit open/closed shift controls, and date-filtered shift history. Electron remains the reference implementation and is not modified by these browser changes.

The inventory catalog path now also supports admin creation of a new product/SKU, variant, first lot, retail price, and initial cost through `POST /api/v1/inventory/products`. Sales cards defensively normalize numeric values in the browser, while the API returns Manila-based period summaries for admin sessions. The adjustment 404 is resolved by restarting the cloud API so the current route set is loaded.

The cloud parity pass now presents Employees in the Electron order: admin add-employee form, employee roster with explicit clock controls, then a date-selected shift calendar. Inventory presents expiration dates without exposing lot numbers in the browser; lot identity remains an internal FEFO/server concern. `CheckoutScreen` has an opt-out `scaleEnabled` prop defaulting to true, so Electron retains scale support while the cloud checkout disables weighing UI and automation.

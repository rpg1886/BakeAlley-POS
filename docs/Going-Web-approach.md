# Going Web: Bake Alley POS Approach

## Objective

Make Bake Alley POS usable from Windows desktops, tablets, and mobile devices while preserving offline checkout, inventory controls, sales reporting, role-based access, scales, and thermal printers.

## Recommended Architecture

```text
Desktop / tablet / mobile browser
                |
                v
       React + Vite responsive PWA
                |
                v
          Node.js / Express API
                |
                v
             PostgreSQL
```

For offline operation:

```text
Browser PWA + IndexedDB local store
                |
       Local transactional outbox
                |
       Background synchronization
                |
          PostgreSQL API
```

The current Electron application can remain as an optional hardware companion for devices that need direct USB, RS-232, or thermal-printer access.

## Frontend

Keep React and Tailwind CSS, but move the browser-facing application to a normal Vite web build.

The web frontend should contain:

- Login and role-aware navigation
- Checkout
- Inventory
- Sales reports
- Admin inventory import
- Customer and pricing selection
- Offline status indicator
- Sync status and retry information

The layout should be responsive across three primary form factors:

- Desktop: dense checkout workspace with keyboard and barcode-scanner support
- Tablet: touch-friendly two-column checkout layout
- Mobile: stacked checkout flow with compact cart and payment steps

The current renderer components can be reused, but their direct Electron preload dependencies must be replaced with an HTTP client abstraction.

## Backend API

Create a central Node.js/Express API. The browser should never connect directly to PostgreSQL.

Recommended API groups:

```text
POST   /api/v1/auth/login
POST   /api/v1/auth/logout
GET    /api/v1/products/search
GET    /api/v1/customers
POST   /api/v1/orders
GET    /api/v1/inventory
POST   /api/v1/inventory/import
GET    /api/v1/sales/report
POST   /api/v1/sync/push
GET    /api/v1/sync/pull
```

The server must enforce permissions independently of the UI:

- Cashier: checkout, customer lookup, inventory read, sales read
- Admin: all cashier permissions plus inventory import, pricing, product management, and user administration

The existing PostgreSQL sync route should become part of this API rather than remaining an isolated integration endpoint.

## Database Strategy

PostgreSQL should become the shared system of record for multi-device deployments.

The schema should preserve the current domain rules:

- UUID v4 text-compatible identifiers
- `NUMERIC(12, 4)` for quantities, weights, and rates
- `NUMERIC(12, 2)` for prices and money
- Lot tracking and FEFO deductions
- UOM conversion tables
- Pricing tiers and quantity thresholds
- Users and role-based permissions
- Orders, order items, payment method, cash received, and change due
- Synchronization metadata and idempotency keys

Use versioned PostgreSQL migrations. Do not rely on the SQLite initialization script as a production server schema.

## Offline-First Browser Storage

A browser cannot use `better-sqlite3` directly. The web client should use IndexedDB through a small typed repository layer.

Recommended local stores:

- `catalog_cache`
- `customer_cache`
- `inventory_cache`
- `draft_orders`
- `sync_queue`
- `sync_state`
- `auth_session`

Checkout should write the order draft, inventory reservation/deduction event, and sync queue record in one logical local transaction. IndexedDB transactions should cover the local write set.

When online, the sync worker should:

1. Detect network availability.
2. Claim up to 50 pending records.
3. Push an idempotent batch to the API.
4. Mark acknowledged records as synchronized.
5. Apply exponential backoff to failed records.
6. Pull server changes and update local caches.

## Conflict and Inventory Rules

Inventory must be validated on the server because multiple devices may sell the same lot concurrently.

The server should:

- Lock inventory rows during deduction.
- Deduct tracked inventory in FEFO order.
- Reject insufficient stock atomically.
- Return a stable conflict response for duplicate or already-applied orders.
- Use the client order UUID and event UUID as idempotency keys.

The client should keep the local transaction marked as pending until the server acknowledges it or returns a defined conflict result.

## Hardware Integration

A browser-only POS has limited access to USB, serial scales, and thermal printers.

Recommended options:

### Option A: Local Hardware Companion

Keep a small Electron or Node.js companion running on the checkout computer. It provides a localhost WebSocket or HTTP bridge for:

- RS-232/NCI/Toledo scales
- USB or serial ESC/POS printers
- Device status and reconnect events

This is the most reliable option for retail hardware.

### Option B: Web Serial and WebUSB

Use Web Serial or WebUSB where supported by the browser and device. This is appropriate for controlled Chrome/Edge environments but has browser permissions, HTTPS, and device compatibility constraints.

### Option C: Network Hardware

Prefer network-enabled scales and printers when available. The API or local bridge can address them over the store LAN.

## Authentication and Security

Replace the current local Electron-only session map with server-backed authentication.

Recommended controls:

- Password hashes using a strong password hashing algorithm such as Argon2id or scrypt
- Short-lived access tokens and refresh tokens
- Secure, HTTP-only cookies for browser sessions
- CSRF protection when using cookies
- TLS in every non-local environment
- Server-side role checks on every admin endpoint
- Audit log for inventory imports, pricing changes, user changes, and voids
- No default passwords in production documentation or seed data
- Forced password change for first-run admin accounts

The current demo credentials must be removed or replaced before deployment.

## Inventory Import

The admin inventory upload should be processed by the API rather than directly by the browser database.

Accepted formats:

```text
sku, lot_number, expiration_date, quantity_on_hand
```

The server should validate the entire file before committing any rows. A failed row must roll back the complete import or be reported through an explicit row-level error workflow.

## Deployment Choices

### Small Store / Single Location

- Hosted frontend or local LAN web server
- Node.js API on a store computer or small server
- PostgreSQL on the same server
- Local hardware companion per checkout station
- IndexedDB offline cache per browser/device

### Multi-Location

- Managed PostgreSQL
- Hosted API with monitoring and backups
- Hosted PWA frontend
- Store-level hardware bridges
- Centralized authentication and audit logs
- Store/device identifiers on every sync event

## Migration Plan

1. Add PostgreSQL migrations matching the current SQLite domain model.
2. Extract shared TypeScript contracts for products, orders, inventory, auth, and sync events.
3. Implement REST API authentication and role checks.
4. Move catalog, customers, inventory, and sales reads to API endpoints.
5. Move checkout order creation to an API-backed repository.
6. Add IndexedDB local persistence and an offline transactional outbox.
7. Replace direct preload calls in the renderer with a platform-neutral repository interface.
8. Add PWA manifest, service worker, install support, and offline status UI.
9. Keep Electron preload integration as a hardware adapter only.
10. Add automated tests for online checkout, offline checkout, sync retries, FEFO concurrency, and role permissions.
11. Package the optional hardware companion separately.
12. Deploy a pilot to one checkout station before broad rollout.

## Recommended End State

The strongest long-term design is:

- React/Tailwind responsive PWA for all user-facing screens
- Node.js/Express API for business rules and authorization
- PostgreSQL for shared authoritative data
- IndexedDB for offline browser operation
- Transactional sync outbox for eventual consistency
- Optional Electron/Node hardware companion for scales and printers
- Centralized authentication, audit logging, backups, and monitoring

This approach supports desktop, tablet, and mobile use without forcing every device to install Node.js, Electron, Python, Visual Studio Build Tools, or native SQLite dependencies.

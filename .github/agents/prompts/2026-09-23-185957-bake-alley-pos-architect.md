# Prompt Tracking: Bake Alley POS Architect

## Timestamp

2026-09-23 18:59:57 local time

## User Prompt

Create a reusable custom agent for a Lead Full-Stack Architect and Desktop POS Engineer specializing in the Bake Alley local-first baking-supply POS. The agent must cover Electron, React, TypeScript, Tailwind, Vite, better-sqlite3, PostgreSQL, Express, transactional outbox synchronization, UUID keys, decimal precision, FEFO lot tracking, UOM conversions, pricing tiers, scale and thermal-printer integrations, strict typing, and documentation updates. Also create or update `docs/Functional-design.md` and create a timestamped tracking file under `.github/agents/prompts`.

## Reasoning Summary

- The requested behavior is a workspace-specific reusable persona, so a `.github/agents/*.agent.md` custom agent is the correct customization primitive.
- The agent receives only the tools needed for implementation and validation: read, search, edit, and execute.
- Existing repository guidance in `instructions.md` was treated as the source of local architecture rules.
- The functional design records the canonical architecture, domain entities, numerical guarantees, FEFO behavior, transactional outbox workflow, and hardware boundaries.
- The existing `database/init.sql` is documented as the current baseline while noting that future schema work should converge on the canonical blueprint.

## Generated Artifacts

- `.github/agents/bake-alley-pos-architect.agent.md`
- `docs/Functional-design.md`
- `.github/agents/prompts/2026-09-23-185957-bake-alley-pos-architect.md`

## Validation

- Verified the requested workspace directories were created through the file edits.
- Existing SQLite validation remains available through the installed Python and SQLite tooling.

## Follow-up Implementation

The Phase 1 SQLite initializer was implemented in `src/db/schema.ts` using `better-sqlite3`. It defines UUID text keys, four-decimal quantity checks, catalog and UOM entities, product variants, pricing tiers, customers, inventory lots, orders, order items, the transactional outbox queue, and sync state. The functional design was updated to identify this file as the application initializer.

Validation completed:

- `npm run typecheck` passed under strict TypeScript settings.
- An in-memory `better-sqlite3` smoke test passed for table creation, tracked-lot enforcement, and quantity precision checks.

## Follow-up Implementation

The offline sync worker was implemented in `src/sync/syncWorker.ts`. It atomically claims due queue records, limits requests to 50 items, posts JSON batches to an injected endpoint, marks acknowledged records as `SYNCED`, and persists capped exponential backoff for network failures or partial acknowledgements.

Validation completed:

- `npm run typecheck` passed.
- An in-memory worker smoke test passed for 50-item batching, 55-item draining, successful status updates, and retry scheduling.

## Follow-up Implementation

The Electron main-process scale service was implemented in `src/main/hardware/scale.ts`. It parses chunked NCI/Toledo-style ASCII readings, converts kilograms to grams, tracks stable status, handles serial errors and close events, reconnects with capped backoff, and registers renderer IPC handlers for read, status, connect, and disconnect operations.

## Follow-up Implementation

The checkout renderer was implemented in `src/components/CheckoutScreen.tsx`. It provides barcode/SKU search, a tier-aware cart, live scale polling for weight-based products, totals, payment method selection, and an injected `createOrderWithOutbox` callback for atomic order and outbox persistence.

## Follow-up Implementation

The remaining Electron integration was implemented in `src/main/checkout/checkoutService.ts`, `src/main/checkout/checkoutIpc.ts`, and `src/preload.ts`. The main process now owns catalog search, price validation, FEFO lot allocation, atomic order and outbox writes, and the preload exposes catalog, order, and scale-read APIs to the renderer.

The IPC channel constants were moved to `src/shared/ipcChannels.ts` so the preload does not import main-only serial or database modules.

The scale integration now has the requested `src/main/hardware/scaleService.ts` entry point. It re-exports the existing serial implementation and adds renderer push events through `scale:reading`, while preserving the existing pull-based `scale:read` IPC contract.

The sync worker now has the requested `src/sync/PosSyncWorker.ts` entry point. The existing worker behavior is preserved, with optional injected network-status polling added before synchronization attempts.

The checkout now has the requested `src/renderer/components/Checkout.tsx` entry point, re-exporting the existing fully implemented `CheckoutScreen` without duplicating or changing its behavior.

## Follow-up Implementation

The POS is now launchable offline through `npm start`. Added the Electron main entry, Vite/Tailwind renderer entry, local SQLite seed data, customer loading IPC, and build configuration. Seed validation passed for three products, one commercial customer, and six prices; the production main and renderer builds completed successfully.

The blank-window startup issue was fixed by disabling Electron's preload sandbox while retaining context isolation and disabled Node integration. Electron logging confirmed the preload now loads without the previous `module not found: ./shared/ipcChannels` error.

Authentication and inventory administration were added. The app now gates checkout behind local scrypt-hashed user login, distinguishes admin and cashier roles, and restricts CSV/XLSX/XLS inventory imports to admins. Imports are transactional and enqueue inventory-lot changes for sync. Existing databases receive the new users table and demo accounts without resetting existing data.

Added a separate Inventory tab backed by an authenticated `inventory:list` IPC query. It displays live product variants, SKUs, lot numbers, expiration dates, units, and quantities on hand without granting cashiers inventory modification rights.

Moved the admin inventory import panel into the Inventory tab so checkout remains focused on sales while admin stock management stays with inventory viewing.

Added a Sales tab with authenticated daily item detail, gross/net totals, calendar week/month/year summaries, date selection, and admin-only markup input. Reports read completed local orders without modifying checkout behavior.

Updated checkout payment confirmation to require cash received, calculate change due, persist payment method on orders, and show cash/card/account on Sales item rows. Existing SQLite databases receive the payment column with a cash default through the schema migration.

Expanded Inventory to show every catalog product, not only products with lots. Added initial capital migration/seed values and displayed quantity, markup amount and percentage, and retail price using `retail = initial capital + markup`.

The combined `registerMainProcessServices` bootstrap was added in `src/main/bootstrap.ts` so the Electron entry point can register checkout and scale IPC handlers together.

## Follow-up Implementation

The PostgreSQL sync ingestion route was added at `server/routes/sync.js`. It validates batches up to 50 records, runs order and order-item ingestion plus lot deductions in one `pg` transaction, uses `ON CONFLICT DO NOTHING` for idempotency, and acknowledges queue IDs only after commit.
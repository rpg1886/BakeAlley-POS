# Fix GCash Type Incompatibility Tracking

## User Prompt

perform this next steps Next Smallest Migration Step

What code modification or test would you like to execute first under this agent persona?

Option A (Recommended): Fix the 'gcash' type incompatibility in src/main/checkout/checkoutService.ts and src/db/schema.ts so npm run build:main and npm run typecheck pass with 0 errors.
Option B: Work on another specific feature, route, or test you have in mind.

## Specialized Role

Lead Cloud POS Architect and Full-Stack Engineer for Bake Alley.

## Action Taken & Reasoning

- Resolved the `'gcash'` type incompatibility across the Electron main process, IPC bridge, and SQLite persistence layer to restore full compilation and build stability for the Electron desktop client:
  1. Updated `CreateOrderInput` in `src/main/checkout/checkoutService.ts` to include `'gcash'` in `paymentMethod: 'cash' | 'card' | 'gcash' | 'account'`.
  2. Updated `isCreateOrderInput` in `src/main/checkout/checkoutIpc.ts` to validate candidate objects with `candidate.paymentMethod === 'gcash'`.
  3. Updated `SalesItemSummary` in `src/main/sales/salesReportService.ts` to include `'gcash'` in `paymentMethod`.
  4. Updated SQLite schema in `src/db/schema.ts`:
     - Updated `orders` table `payment_method` column constraint to `CHECK (payment_method IN ('cash', 'card', 'gcash', 'account'))`.
     - Added an automatic schema migration in `initializeSchema` to detect existing `orders` tables without `'gcash'` and safely recreate the table with the expanded constraint without losing existing orders data.
  5. Updated `server/routes/sync.js` (`applyOrder`) to include `payment_method`, `cash_received`, and `change_due` in the PostgreSQL `INSERT INTO orders` statement, resolving schema mismatch with `001_cloud_pos.sql`.

## Generated / Updated Artifacts

- `src/main/checkout/checkoutService.ts`
- `src/main/checkout/checkoutIpc.ts`
- `src/main/sales/salesReportService.ts`
- `src/db/schema.ts`
- `server/routes/sync.js`
- `.github/agents/prompts/2026-09-30-163410-fix-gcash-type-incompatibility.md`

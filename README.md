Phase 1: Database Setup & Local Outbox
​Prompt 1 (Copilot Chat):
@workspace Create the SQLite initialization script for our local desktop app in src/db/schema.ts using better-sqlite3. Include tables for products, product_variants, units_of_measure, customers, orders, order_items, inventory_lots, sync_queue, and sync_state. Ensure all primary keys use TEXT (UUID v4) and quantity fields support up to 4 decimal places.
​Phase 2: Offline Sync Engine
​Prompt 2 (Copilot Chat):
@workspace Write a TypeScript class PosSyncWorker in src/sync/syncWorker.ts that manages background replication between local SQLite and cloud PostgreSQL. It must poll the sync_queue table, batch up to 50 PENDING records, execute HTTP POST requests to an external API, handle exponential backoff retries on network failures, and mark records as SYNCED upon success.
​Phase 3: Hardware Scale Integration (Serial Port)
​Prompt 3 (Copilot Chat):
@workspace Write a Electron main-process hardware service in src/main/hardware/scale.ts using node-serialport that connects to an RS-232 trade scale. It should listen for continuous ASCII weight streams (e.g., NCI/Toledo format), parse live weight values in grams/kilograms, handle disconnection errors, and expose IPC handlers for the React renderer.
​Phase 4: Main Checkout UI Component
​Prompt 4 (Copilot Chat):
@workspace Build a React component src/components/CheckoutScreen.tsx using Tailwind CSS. It should feature a fast barcode/SKU search input, a live transaction cart table, a real-time scale reading indicator for weight-based items, a customer selector that updates pricing based on their tier, and a payment modal that writes the order and outbox queue to SQLite in a single transaction.
​Phase 5: Cloud Backend API (PostgreSQL Ingestion)
​Prompt 5 (Copilot Chat):
@workspace Write a Node.js Express route POST /api/v1/sync/push in server/routes/sync.js that accepts a batch of synced JSON items from local POS clients. Execute an atomic PostgreSQL transaction using node-postgres (pg) that upserts incoming orders, inserts order_items, and subtracts sold quantities from server inventory_lots using ON CONFLICT DO NOTHING for idempotency.
​Pro-Tips for Copilot Prompting

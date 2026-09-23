import Database from 'better-sqlite3';

const schemaSql = `
CREATE TABLE IF NOT EXISTS units_of_measure (
    uom_id TEXT PRIMARY KEY NOT NULL,
    name TEXT NOT NULL UNIQUE,
    symbol TEXT NOT NULL UNIQUE
);

CREATE TABLE IF NOT EXISTS uom_conversions (
    conversion_id TEXT PRIMARY KEY NOT NULL,
    from_uom_id TEXT NOT NULL,
    to_uom_id TEXT NOT NULL,
    conversion_factor NUMERIC NOT NULL
        CHECK (conversion_factor > 0 AND conversion_factor = round(conversion_factor, 4)),
    FOREIGN KEY (from_uom_id) REFERENCES units_of_measure (uom_id) ON DELETE RESTRICT,
    FOREIGN KEY (to_uom_id) REFERENCES units_of_measure (uom_id) ON DELETE RESTRICT,
    UNIQUE (from_uom_id, to_uom_id)
);

CREATE TABLE IF NOT EXISTS categories (
    category_id TEXT PRIMARY KEY NOT NULL,
    name TEXT NOT NULL UNIQUE
);

CREATE TABLE IF NOT EXISTS products (
    product_id TEXT PRIMARY KEY NOT NULL,
    category_id TEXT,
    name TEXT NOT NULL,
    base_uom_id TEXT NOT NULL,
    is_sold_by_weight INTEGER NOT NULL DEFAULT 0 CHECK (is_sold_by_weight IN (0, 1)),
    requires_lot_tracking INTEGER NOT NULL DEFAULT 0 CHECK (requires_lot_tracking IN (0, 1)),
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    FOREIGN KEY (category_id) REFERENCES categories (category_id) ON DELETE SET NULL,
    FOREIGN KEY (base_uom_id) REFERENCES units_of_measure (uom_id) ON DELETE RESTRICT
);

CREATE TABLE IF NOT EXISTS product_variants (
    variant_id TEXT PRIMARY KEY NOT NULL,
    product_id TEXT NOT NULL,
    sku TEXT NOT NULL UNIQUE,
    barcode TEXT UNIQUE,
    variant_name TEXT NOT NULL,
    attributes TEXT NOT NULL DEFAULT '{}' CHECK (json_valid(attributes)),
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    FOREIGN KEY (product_id) REFERENCES products (product_id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS price_tiers (
    tier_id TEXT PRIMARY KEY NOT NULL,
    tier_name TEXT NOT NULL UNIQUE
);

CREATE TABLE IF NOT EXISTS product_prices (
    product_price_id TEXT PRIMARY KEY NOT NULL,
    variant_id TEXT NOT NULL,
    tier_id TEXT NOT NULL,
    price_per_unit NUMERIC NOT NULL
        CHECK (price_per_unit >= 0 AND price_per_unit = round(price_per_unit, 2)),
    min_quantity NUMERIC NOT NULL DEFAULT 0.0000
        CHECK (min_quantity >= 0 AND min_quantity = round(min_quantity, 4)),
    FOREIGN KEY (variant_id) REFERENCES product_variants (variant_id) ON DELETE CASCADE,
    FOREIGN KEY (tier_id) REFERENCES price_tiers (tier_id) ON DELETE CASCADE,
    UNIQUE (variant_id, tier_id, min_quantity)
);

CREATE TABLE IF NOT EXISTS customers (
    customer_id TEXT PRIMARY KEY NOT NULL,
    company_name TEXT,
    contact_name TEXT NOT NULL,
    tier_id TEXT NOT NULL,
    credit_limit NUMERIC NOT NULL DEFAULT 0.00
        CHECK (credit_limit >= 0 AND credit_limit = round(credit_limit, 2)),
    current_balance NUMERIC NOT NULL DEFAULT 0.00
        CHECK (current_balance >= 0 AND current_balance = round(current_balance, 2)),
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    FOREIGN KEY (tier_id) REFERENCES price_tiers (tier_id) ON DELETE RESTRICT
);

CREATE TABLE IF NOT EXISTS inventory_lots (
    lot_id TEXT PRIMARY KEY NOT NULL,
    variant_id TEXT NOT NULL,
    lot_number TEXT NOT NULL,
    expiration_date TEXT,
    quantity_on_hand NUMERIC NOT NULL DEFAULT 0.0000
        CHECK (quantity_on_hand >= 0 AND quantity_on_hand = round(quantity_on_hand, 4)),
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    FOREIGN KEY (variant_id) REFERENCES product_variants (variant_id) ON DELETE RESTRICT,
    UNIQUE (variant_id, lot_number)
);

CREATE TABLE IF NOT EXISTS orders (
    order_id TEXT PRIMARY KEY NOT NULL,
    customer_id TEXT,
    pricing_tier_id TEXT NOT NULL,
    order_type TEXT NOT NULL CHECK (order_type IN ('retail', 'commercial')),
    status TEXT NOT NULL DEFAULT 'completed'
        CHECK (status IN ('open', 'completed', 'voided')),
    subtotal NUMERIC NOT NULL DEFAULT 0.00
        CHECK (subtotal >= 0 AND subtotal = round(subtotal, 2)),
    tax_amount NUMERIC NOT NULL DEFAULT 0.00
        CHECK (tax_amount >= 0 AND tax_amount = round(tax_amount, 2)),
    total_amount NUMERIC NOT NULL DEFAULT 0.00
        CHECK (total_amount >= 0 AND total_amount = round(total_amount, 2)),
    payment_method TEXT NOT NULL DEFAULT 'cash'
        CHECK (payment_method IN ('cash', 'card', 'account')),
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    FOREIGN KEY (customer_id) REFERENCES customers (customer_id) ON DELETE SET NULL,
    FOREIGN KEY (pricing_tier_id) REFERENCES price_tiers (tier_id) ON DELETE RESTRICT
);

CREATE TABLE IF NOT EXISTS order_items (
    order_item_id TEXT PRIMARY KEY NOT NULL,
    order_id TEXT NOT NULL,
    variant_id TEXT NOT NULL,
    lot_id TEXT,
    quantity NUMERIC NOT NULL
        CHECK (quantity > 0 AND quantity = round(quantity, 4)),
    unit_price NUMERIC NOT NULL
        CHECK (unit_price >= 0 AND unit_price = round(unit_price, 2)),
    total_price NUMERIC NOT NULL
        CHECK (total_price >= 0 AND total_price = round(total_price, 2)),
    FOREIGN KEY (order_id) REFERENCES orders (order_id) ON DELETE CASCADE,
    FOREIGN KEY (variant_id) REFERENCES product_variants (variant_id) ON DELETE RESTRICT,
    FOREIGN KEY (lot_id) REFERENCES inventory_lots (lot_id) ON DELETE RESTRICT
);

CREATE TABLE IF NOT EXISTS sync_queue (
    queue_id TEXT PRIMARY KEY NOT NULL,
    entity_type TEXT NOT NULL,
    entity_id TEXT NOT NULL,
    operation TEXT NOT NULL CHECK (operation IN ('create', 'update', 'delete')),
    payload TEXT NOT NULL CHECK (json_valid(payload)),
    status TEXT NOT NULL DEFAULT 'PENDING'
        CHECK (status IN ('PENDING', 'PROCESSING', 'SYNCED', 'FAILED')),
    retry_count INTEGER NOT NULL DEFAULT 0 CHECK (retry_count >= 0),
    next_attempt_at TEXT,
    last_error TEXT,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS sync_state (
    entity_type TEXT PRIMARY KEY NOT NULL,
    last_synced_at TEXT
);

CREATE TABLE IF NOT EXISTS users (
    user_id TEXT PRIMARY KEY NOT NULL,
    username TEXT NOT NULL UNIQUE,
    display_name TEXT NOT NULL,
    role TEXT NOT NULL CHECK (role IN ('admin', 'cashier')),
    password_salt TEXT NOT NULL,
    password_hash TEXT NOT NULL,
    active INTEGER NOT NULL DEFAULT 1 CHECK (active IN (0, 1)),
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_inventory_lots_fefo
    ON inventory_lots (variant_id, expiration_date, lot_id)
    WHERE quantity_on_hand > 0;

CREATE INDEX IF NOT EXISTS idx_product_variants_product ON product_variants (product_id);
CREATE INDEX IF NOT EXISTS idx_product_prices_lookup
    ON product_prices (variant_id, tier_id, min_quantity DESC);
CREATE INDEX IF NOT EXISTS idx_orders_customer ON orders (customer_id);
CREATE INDEX IF NOT EXISTS idx_order_items_order ON order_items (order_id);
CREATE INDEX IF NOT EXISTS idx_sync_queue_pending
    ON sync_queue (status, next_attempt_at, created_at)
    WHERE status IN ('PENDING', 'FAILED');

CREATE TRIGGER IF NOT EXISTS validate_tracked_order_item_lot
BEFORE INSERT ON order_items
WHEN EXISTS (
    SELECT 1
    FROM products AS product
    JOIN product_variants AS variant ON variant.product_id = product.product_id
    WHERE variant.variant_id = NEW.variant_id
      AND product.requires_lot_tracking = 1
)
AND NEW.lot_id IS NULL
BEGIN
    SELECT RAISE(ABORT, 'Lot is required for this product variant');
END;
`;

export function initializeSchema(database: Database.Database): void {
    database.pragma('foreign_keys = ON');
    database.pragma('journal_mode = WAL');
    database.pragma('synchronous = NORMAL');

    const initialize = database.transaction(() => {
        database.exec(schemaSql);
        const orderColumns = database.prepare('PRAGMA table_info(orders)').all() as Array<{ name: string }>;
        if (!orderColumns.some((column) => column.name === 'payment_method')) {
            database.exec("ALTER TABLE orders ADD COLUMN payment_method TEXT NOT NULL DEFAULT 'cash' CHECK (payment_method IN ('cash', 'card', 'account'))");
        }
    });

    initialize();
}
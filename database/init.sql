PRAGMA foreign_keys = ON;
PRAGMA journal_mode = WAL;
PRAGMA synchronous = NORMAL;

BEGIN TRANSACTION;

CREATE TABLE IF NOT EXISTS customers (
    id TEXT PRIMARY KEY NOT NULL,
    name TEXT NOT NULL,
    email TEXT,
    phone TEXT,
    pricing_tier TEXT NOT NULL DEFAULT 'retail'
        CHECK (pricing_tier IN ('retail', 'wholesale')),
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS products (
    id TEXT PRIMARY KEY NOT NULL,
    sku TEXT NOT NULL UNIQUE,
    name TEXT NOT NULL,
    description TEXT,
    unit TEXT NOT NULL,
    is_weighed INTEGER NOT NULL DEFAULT 0 CHECK (is_weighed IN (0, 1)),
    retail_price NUMERIC NOT NULL CHECK (retail_price >= 0),
    wholesale_price NUMERIC CHECK (wholesale_price IS NULL OR wholesale_price >= 0),
    active INTEGER NOT NULL DEFAULT 1 CHECK (active IN (0, 1)),
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS inventory_lots (
    id TEXT PRIMARY KEY NOT NULL,
    product_id TEXT NOT NULL,
    lot_number TEXT NOT NULL,
    expiration_date TEXT NOT NULL,
    quantity NUMERIC NOT NULL CHECK (quantity >= 0),
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    FOREIGN KEY (product_id) REFERENCES products (id) ON DELETE RESTRICT,
    UNIQUE (product_id, lot_number)
);

CREATE TABLE IF NOT EXISTS sales (
    id TEXT PRIMARY KEY NOT NULL,
    customer_id TEXT,
    status TEXT NOT NULL DEFAULT 'completed'
        CHECK (status IN ('open', 'completed', 'voided')),
    subtotal NUMERIC NOT NULL DEFAULT 0 CHECK (subtotal >= 0),
    total NUMERIC NOT NULL DEFAULT 0 CHECK (total >= 0),
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    FOREIGN KEY (customer_id) REFERENCES customers (id) ON DELETE SET NULL
);

CREATE TABLE IF NOT EXISTS sale_items (
    id TEXT PRIMARY KEY NOT NULL,
    sale_id TEXT NOT NULL,
    product_id TEXT NOT NULL,
    quantity NUMERIC NOT NULL CHECK (quantity > 0),
    unit_price NUMERIC NOT NULL CHECK (unit_price >= 0),
    line_total NUMERIC NOT NULL CHECK (line_total >= 0),
    FOREIGN KEY (sale_id) REFERENCES sales (id) ON DELETE CASCADE,
    FOREIGN KEY (product_id) REFERENCES products (id) ON DELETE RESTRICT
);

CREATE TABLE IF NOT EXISTS sale_item_lots (
    id TEXT PRIMARY KEY NOT NULL,
    sale_item_id TEXT NOT NULL,
    inventory_lot_id TEXT NOT NULL,
    quantity NUMERIC NOT NULL CHECK (quantity > 0),
    FOREIGN KEY (sale_item_id) REFERENCES sale_items (id) ON DELETE CASCADE,
    FOREIGN KEY (inventory_lot_id) REFERENCES inventory_lots (id) ON DELETE RESTRICT
);

CREATE TABLE IF NOT EXISTS inventory_movements (
    id TEXT PRIMARY KEY NOT NULL,
    inventory_lot_id TEXT NOT NULL,
    sale_item_id TEXT,
    quantity NUMERIC NOT NULL CHECK (quantity <> 0),
    movement_type TEXT NOT NULL
        CHECK (movement_type IN ('receipt', 'sale', 'adjustment', 'return')),
    created_at TEXT NOT NULL,
    FOREIGN KEY (inventory_lot_id) REFERENCES inventory_lots (id) ON DELETE RESTRICT,
    FOREIGN KEY (sale_item_id) REFERENCES sale_items (id) ON DELETE SET NULL
);

CREATE TABLE IF NOT EXISTS sync_queue (
    id TEXT PRIMARY KEY NOT NULL,
    entity_type TEXT NOT NULL,
    entity_id TEXT NOT NULL,
    operation TEXT NOT NULL CHECK (operation IN ('create', 'update', 'delete')),
    payload TEXT NOT NULL CHECK (json_valid(payload)),
    status TEXT NOT NULL DEFAULT 'pending'
        CHECK (status IN ('pending', 'processing', 'failed')),
    attempts INTEGER NOT NULL DEFAULT 0 CHECK (attempts >= 0),
    last_error TEXT,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_inventory_lots_fefo
    ON inventory_lots (product_id, expiration_date, id)
    WHERE quantity > 0;

CREATE INDEX IF NOT EXISTS idx_sales_customer ON sales (customer_id);
CREATE INDEX IF NOT EXISTS idx_sale_items_sale ON sale_items (sale_id);
CREATE INDEX IF NOT EXISTS idx_sale_items_product ON sale_items (product_id);
CREATE INDEX IF NOT EXISTS idx_sale_item_lots_item ON sale_item_lots (sale_item_id);
CREATE INDEX IF NOT EXISTS idx_inventory_movements_lot ON inventory_movements (inventory_lot_id);
CREATE INDEX IF NOT EXISTS idx_sync_queue_pending
    ON sync_queue (status, created_at)
    WHERE status IN ('pending', 'failed');

COMMIT;
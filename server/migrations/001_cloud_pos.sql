CREATE EXTENSION IF NOT EXISTS pgcrypto;

CREATE TABLE IF NOT EXISTS units_of_measure (
    uom_id UUID PRIMARY KEY,
    name TEXT NOT NULL UNIQUE,
    symbol TEXT NOT NULL UNIQUE
);

CREATE TABLE IF NOT EXISTS categories (
    category_id UUID PRIMARY KEY,
    name TEXT NOT NULL UNIQUE
);

CREATE TABLE IF NOT EXISTS products (
    product_id UUID PRIMARY KEY,
    category_id UUID REFERENCES categories(category_id) ON DELETE SET NULL,
    name TEXT NOT NULL,
    base_uom_id UUID NOT NULL REFERENCES units_of_measure(uom_id),
    is_sold_by_weight BOOLEAN NOT NULL DEFAULT FALSE,
    requires_lot_tracking BOOLEAN NOT NULL DEFAULT FALSE,
    initial_cost NUMERIC(12, 2) NOT NULL DEFAULT 0 CHECK (initial_cost >= 0),
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS product_variants (
    variant_id UUID PRIMARY KEY,
    product_id UUID NOT NULL REFERENCES products(product_id) ON DELETE CASCADE,
    sku TEXT NOT NULL UNIQUE,
    barcode TEXT UNIQUE,
    variant_name TEXT NOT NULL,
    attributes JSONB NOT NULL DEFAULT '{}'::jsonb,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS price_tiers (
    tier_id UUID PRIMARY KEY,
    tier_name TEXT NOT NULL UNIQUE
);

CREATE TABLE IF NOT EXISTS product_prices (
    product_price_id UUID PRIMARY KEY,
    variant_id UUID NOT NULL REFERENCES product_variants(variant_id) ON DELETE CASCADE,
    tier_id UUID NOT NULL REFERENCES price_tiers(tier_id) ON DELETE CASCADE,
    price_per_unit NUMERIC(12, 2) NOT NULL CHECK (price_per_unit >= 0),
    min_quantity NUMERIC(12, 4) NOT NULL DEFAULT 0 CHECK (min_quantity >= 0),
    UNIQUE (variant_id, tier_id, min_quantity)
);

CREATE TABLE IF NOT EXISTS customers (
    customer_id UUID PRIMARY KEY,
    company_name TEXT,
    contact_name TEXT NOT NULL,
    email TEXT,
    phone TEXT,
    tier_id UUID NOT NULL REFERENCES price_tiers(tier_id),
    credit_limit NUMERIC(12, 2) NOT NULL DEFAULT 0 CHECK (credit_limit >= 0),
    current_balance NUMERIC(12, 2) NOT NULL DEFAULT 0 CHECK (current_balance >= 0),
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS inventory_lots (
    lot_id UUID PRIMARY KEY,
    variant_id UUID NOT NULL REFERENCES product_variants(variant_id),
    lot_number TEXT NOT NULL,
    expiration_date DATE,
    quantity_on_hand NUMERIC(12, 4) NOT NULL DEFAULT 0 CHECK (quantity_on_hand >= 0),
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE (variant_id, lot_number)
);

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

CREATE TABLE IF NOT EXISTS employee_shifts (
    shift_id UUID PRIMARY KEY,
    user_id UUID NOT NULL REFERENCES app_users(user_id) ON DELETE CASCADE,
    clock_in TIMESTAMPTZ NOT NULL,
    clock_out TIMESTAMPTZ,
    notes TEXT
);

CREATE TABLE IF NOT EXISTS orders (
    order_id UUID PRIMARY KEY,
    customer_id UUID REFERENCES customers(customer_id) ON DELETE SET NULL,
    pricing_tier_id UUID NOT NULL REFERENCES price_tiers(tier_id),
    employee_id UUID REFERENCES app_users(user_id) ON DELETE SET NULL,
    order_type TEXT NOT NULL CHECK (order_type IN ('retail', 'commercial')),
    status TEXT NOT NULL DEFAULT 'completed' CHECK (status IN ('open', 'completed', 'voided')),
    subtotal NUMERIC(12, 2) NOT NULL CHECK (subtotal >= 0),
    tax_amount NUMERIC(12, 2) NOT NULL DEFAULT 0 CHECK (tax_amount >= 0),
    total_amount NUMERIC(12, 2) NOT NULL CHECK (total_amount >= 0),
    payment_method TEXT NOT NULL CHECK (payment_method IN ('cash', 'card', 'account')),
    cash_received NUMERIC(12, 2) NOT NULL DEFAULT 0 CHECK (cash_received >= 0),
    change_due NUMERIC(12, 2) NOT NULL DEFAULT 0 CHECK (change_due >= 0),
    created_at TIMESTAMPTZ NOT NULL,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS order_items (
    order_item_id UUID PRIMARY KEY,
    order_id UUID NOT NULL REFERENCES orders(order_id) ON DELETE CASCADE,
    variant_id UUID NOT NULL REFERENCES product_variants(variant_id),
    lot_id UUID REFERENCES inventory_lots(lot_id),
    quantity NUMERIC(12, 4) NOT NULL CHECK (quantity > 0),
    unit_price NUMERIC(12, 2) NOT NULL CHECK (unit_price >= 0),
    total_price NUMERIC(12, 2) NOT NULL CHECK (total_price >= 0)
);

CREATE TABLE IF NOT EXISTS sync_events (
    event_id UUID PRIMARY KEY,
    entity_type TEXT NOT NULL,
    entity_id UUID NOT NULL,
    operation TEXT NOT NULL CHECK (operation IN ('create', 'update', 'delete')),
    payload JSONB NOT NULL,
    idempotency_key TEXT NOT NULL UNIQUE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_product_variants_search ON product_variants(sku, barcode, variant_name);
CREATE INDEX IF NOT EXISTS idx_inventory_lots_fefo ON inventory_lots(variant_id, expiration_date, lot_id) WHERE quantity_on_hand > 0;
CREATE INDEX IF NOT EXISTS idx_orders_created_at ON orders(created_at);
CREATE INDEX IF NOT EXISTS idx_orders_customer ON orders(customer_id);
CREATE INDEX IF NOT EXISTS idx_order_items_order ON order_items(order_id);
CREATE INDEX IF NOT EXISTS idx_orders_employee ON orders(employee_id, created_at);
CREATE INDEX IF NOT EXISTS idx_employee_shifts_user_open ON employee_shifts(user_id, clock_out);

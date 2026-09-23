const path = require('node:path');
const Database = require('better-sqlite3');
const { pool, migrate } = require('../db');

const sqlitePath = process.env.SQLITE_PATH ?? path.join(process.env.APPDATA ?? '', 'bakealley-pos', 'bakealley.sqlite');

async function importLocal() {
  await migrate();
  const sqlite = new Database(sqlitePath, { readonly: true });
  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    for (const row of sqlite.prepare('SELECT uom_id, name, symbol FROM units_of_measure').all()) {
      await client.query('INSERT INTO units_of_measure (uom_id, name, symbol) VALUES ($1, $2, $3) ON CONFLICT (uom_id) DO UPDATE SET name=EXCLUDED.name, symbol=EXCLUDED.symbol', [row.uom_id, row.name, row.symbol]);
    }
    for (const row of sqlite.prepare('SELECT category_id, name FROM categories').all()) {
      await client.query('INSERT INTO categories (category_id, name) VALUES ($1, $2) ON CONFLICT (category_id) DO UPDATE SET name=EXCLUDED.name', [row.category_id, row.name]);
    }
    for (const row of sqlite.prepare('SELECT tier_id, tier_name FROM price_tiers').all()) {
      await client.query('INSERT INTO price_tiers (tier_id, tier_name) VALUES ($1, $2) ON CONFLICT (tier_id) DO UPDATE SET tier_name=EXCLUDED.tier_name', [row.tier_id, row.tier_name]);
    }
    for (const row of sqlite.prepare('SELECT product_id, category_id, name, base_uom_id, is_sold_by_weight, requires_lot_tracking, created_at, updated_at FROM products').all()) {
      const cost = sqlite.prepare('SELECT COALESCE(MIN(initial_cost), 0) AS initial_cost FROM product_variants WHERE product_id = ?').get(row.product_id).initial_cost;
      await client.query(`INSERT INTO products (product_id, category_id, name, base_uom_id, is_sold_by_weight, requires_lot_tracking, initial_cost, created_at, updated_at)
        VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)
        ON CONFLICT (product_id) DO UPDATE SET category_id=EXCLUDED.category_id, name=EXCLUDED.name, base_uom_id=EXCLUDED.base_uom_id, is_sold_by_weight=EXCLUDED.is_sold_by_weight, requires_lot_tracking=EXCLUDED.requires_lot_tracking, initial_cost=EXCLUDED.initial_cost, updated_at=EXCLUDED.updated_at`, [row.product_id, row.category_id, row.name, row.base_uom_id, Boolean(row.is_sold_by_weight), Boolean(row.requires_lot_tracking), cost, row.created_at, row.updated_at]);
    }
    for (const row of sqlite.prepare('SELECT variant_id, product_id, sku, barcode, variant_name, attributes, created_at, updated_at FROM product_variants').all()) {
      await client.query(`INSERT INTO product_variants (variant_id, product_id, sku, barcode, variant_name, attributes, created_at, updated_at)
        VALUES ($1,$2,$3,$4,$5,$6::jsonb,$7,$8)
        ON CONFLICT (variant_id) DO UPDATE SET product_id=EXCLUDED.product_id, sku=EXCLUDED.sku, barcode=EXCLUDED.barcode, variant_name=EXCLUDED.variant_name, attributes=EXCLUDED.attributes, updated_at=EXCLUDED.updated_at`, [row.variant_id, row.product_id, row.sku, row.barcode, row.variant_name, row.attributes || '{}', row.created_at, row.updated_at]);
    }
    for (const row of sqlite.prepare('SELECT product_price_id, variant_id, tier_id, price_per_unit, min_quantity FROM product_prices').all()) {
      await client.query(`INSERT INTO product_prices (product_price_id, variant_id, tier_id, price_per_unit, min_quantity)
        VALUES ($1,$2,$3,$4,$5)
        ON CONFLICT (product_price_id) DO UPDATE SET variant_id=EXCLUDED.variant_id, tier_id=EXCLUDED.tier_id, price_per_unit=EXCLUDED.price_per_unit, min_quantity=EXCLUDED.min_quantity`, [row.product_price_id, row.variant_id, row.tier_id, row.price_per_unit, row.min_quantity]);
    }
    for (const row of sqlite.prepare('SELECT customer_id, company_name, contact_name, email, phone, tier_id, credit_limit, current_balance, created_at, updated_at FROM customers').all()) {
      await client.query(`INSERT INTO customers (customer_id, company_name, contact_name, email, phone, tier_id, credit_limit, current_balance, created_at, updated_at)
        VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)
        ON CONFLICT (customer_id) DO UPDATE SET company_name=EXCLUDED.company_name, contact_name=EXCLUDED.contact_name, email=EXCLUDED.email, phone=EXCLUDED.phone, tier_id=EXCLUDED.tier_id, credit_limit=EXCLUDED.credit_limit, current_balance=EXCLUDED.current_balance, updated_at=EXCLUDED.updated_at`, [row.customer_id, row.company_name, row.contact_name, row.email, row.phone, row.tier_id, row.credit_limit, row.current_balance, row.created_at, row.updated_at]);
    }
    for (const row of sqlite.prepare('SELECT lot_id, variant_id, lot_number, expiration_date, quantity_on_hand, created_at, updated_at FROM inventory_lots').all()) {
      await client.query(`INSERT INTO inventory_lots (lot_id, variant_id, lot_number, expiration_date, quantity_on_hand, created_at, updated_at)
        VALUES ($1,$2,$3,$4,$5,$6,$7)
        ON CONFLICT (lot_id) DO UPDATE SET variant_id=EXCLUDED.variant_id, lot_number=EXCLUDED.lot_number, expiration_date=EXCLUDED.expiration_date, quantity_on_hand=EXCLUDED.quantity_on_hand, updated_at=EXCLUDED.updated_at`, [row.lot_id, row.variant_id, row.lot_number, row.expiration_date, row.quantity_on_hand, row.created_at, row.updated_at]);
    }

    await client.query('COMMIT');
    const counts = {};
    for (const table of ['products', 'product_variants', 'product_prices', 'customers', 'inventory_lots']) counts[table] = (await client.query(`SELECT COUNT(*)::int AS count FROM ${table}`)).rows[0].count;
    console.log(`Imported local SQLite catalog from ${sqlitePath}`);
    console.log(JSON.stringify(counts));
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
    sqlite.close();
    await pool.end();
  }
}

importLocal().catch((error) => { console.error(error); process.exitCode = 1; });

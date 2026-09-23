import Database from 'better-sqlite3';
import { randomBytes, scryptSync } from 'node:crypto';

const SEED_TIMESTAMP = '2026-09-23T00:00:00.000Z';
const RETAIL_TIER_ID = '2f8c8d4e-8d28-4d4d-9f41-7a52c5f2e101';
const WHOLESALE_TIER_ID = '2f8c8d4e-8d28-4d4d-9f41-7a52c5f2e102';

function passwordRecord(password: string): { salt: string; hash: string } {
    const salt = randomBytes(16).toString('hex');
    return { salt, hash: scryptSync(password, salt, 64).toString('hex') };
}

export function seedDatabase(database: Database.Database): void {
    const seed = database.transaction(() => {
        const insertUser = database.prepare(`
            INSERT OR IGNORE INTO users (user_id, username, display_name, role, password_salt, password_hash, created_at, updated_at)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?)
        `);
        const adminPassword = passwordRecord('BakeAlleyAdmin123!');
        const cashierPassword = passwordRecord('BakeAlleyCashier123!');
        insertUser.run('2f8c8d4e-8d28-4d4d-9f41-7a52c5f2e901', 'admin', 'Bake Alley Admin', 'admin', adminPassword.salt, adminPassword.hash, SEED_TIMESTAMP, SEED_TIMESTAMP);
        insertUser.run('2f8c8d4e-8d28-4d4d-9f41-7a52c5f2e902', 'cashier', 'Front Counter', 'cashier', cashierPassword.salt, cashierPassword.hash, SEED_TIMESTAMP, SEED_TIMESTAMP);

        if (database.prepare('SELECT 1 FROM products LIMIT 1').get()) {
            database.prepare('UPDATE product_variants SET initial_cost = CASE sku WHEN ? THEN ? WHEN ? THEN ? WHEN ? THEN ? ELSE initial_cost END WHERE initial_cost = 0').run('FLOUR-25KG', 1.75, 'VANILLA-118', 6.00, 'BOX-CAKE-10', 8.00);
            return;
        }

        const insertUom = database.prepare('INSERT INTO units_of_measure (uom_id, name, symbol) VALUES (?, ?, ?)');
        insertUom.run('2f8c8d4e-8d28-4d4d-9f41-7a52c5f2e201', 'Kilogram', 'kg');
        insertUom.run('2f8c8d4e-8d28-4d4d-9f41-7a52c5f2e202', 'Each', 'ea');

        database.prepare('INSERT INTO price_tiers (tier_id, tier_name) VALUES (?, ?)').run(RETAIL_TIER_ID, 'Retail');
        database.prepare('INSERT INTO price_tiers (tier_id, tier_name) VALUES (?, ?)').run(WHOLESALE_TIER_ID, 'Wholesale');

        const insertCategory = database.prepare('INSERT INTO categories (category_id, name) VALUES (?, ?)');
        insertCategory.run('2f8c8d4e-8d28-4d4d-9f41-7a52c5f2e301', 'Flours and Baking Staples');
        insertCategory.run('2f8c8d4e-8d28-4d4d-9f41-7a52c5f2e302', 'Decorations and Packaging');

        const insertProduct = database.prepare(`
            INSERT INTO products (product_id, category_id, name, base_uom_id, is_sold_by_weight, requires_lot_tracking, created_at, updated_at)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?)
        `);
        insertProduct.run('2f8c8d4e-8d28-4d4d-9f41-7a52c5f2e401', '2f8c8d4e-8d28-4d4d-9f41-7a52c5f2e301', 'Bread Flour', '2f8c8d4e-8d28-4d4d-9f41-7a52c5f2e201', 1, 1, SEED_TIMESTAMP, SEED_TIMESTAMP);
        insertProduct.run('2f8c8d4e-8d28-4d4d-9f41-7a52c5f2e402', '2f8c8d4e-8d28-4d4d-9f41-7a52c5f2e302', 'Vanilla Extract', '2f8c8d4e-8d28-4d4d-9f41-7a52c5f2e202', 0, 0, SEED_TIMESTAMP, SEED_TIMESTAMP);
        insertProduct.run('2f8c8d4e-8d28-4d4d-9f41-7a52c5f2e403', '2f8c8d4e-8d28-4d4d-9f41-7a52c5f2e302', 'White Cake Boxes', '2f8c8d4e-8d28-4d4d-9f41-7a52c5f2e202', 0, 0, SEED_TIMESTAMP, SEED_TIMESTAMP);

        const insertVariant = database.prepare(`
            INSERT INTO product_variants (variant_id, product_id, sku, barcode, variant_name, attributes, initial_cost, created_at, updated_at)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
        `);
        insertVariant.run('2f8c8d4e-8d28-4d4d-9f41-7a52c5f2e501', '2f8c8d4e-8d28-4d4d-9f41-7a52c5f2e401', 'FLOUR-25KG', '100000000001', 'Bread Flour 25 kg', '{}', 1.75, SEED_TIMESTAMP, SEED_TIMESTAMP);
        insertVariant.run('2f8c8d4e-8d28-4d4d-9f41-7a52c5f2e502', '2f8c8d4e-8d28-4d4d-9f41-7a52c5f2e402', 'VANILLA-118', '100000000002', 'Vanilla Extract 118 ml', '{}', 6.00, SEED_TIMESTAMP, SEED_TIMESTAMP);
        insertVariant.run('2f8c8d4e-8d28-4d4d-9f41-7a52c5f2e503', '2f8c8d4e-8d28-4d4d-9f41-7a52c5f2e403', 'BOX-CAKE-10', '100000000003', 'White Cake Box, 10 pack', '{}', 8.00, SEED_TIMESTAMP, SEED_TIMESTAMP);

        const insertPrice = database.prepare('INSERT INTO product_prices (product_price_id, variant_id, tier_id, price_per_unit, min_quantity) VALUES (?, ?, ?, ?, ?)');
        insertPrice.run('2f8c8d4e-8d28-4d4d-9f41-7a52c5f2e601', '2f8c8d4e-8d28-4d4d-9f41-7a52c5f2e501', RETAIL_TIER_ID, 2.49, 0);
        insertPrice.run('2f8c8d4e-8d28-4d4d-9f41-7a52c5f2e602', '2f8c8d4e-8d28-4d4d-9f41-7a52c5f2e501', WHOLESALE_TIER_ID, 2.09, 0);
        insertPrice.run('2f8c8d4e-8d28-4d4d-9f41-7a52c5f2e603', '2f8c8d4e-8d28-4d4d-9f41-7a52c5f2e502', RETAIL_TIER_ID, 8.99, 0);
        insertPrice.run('2f8c8d4e-8d28-4d4d-9f41-7a52c5f2e604', '2f8c8d4e-8d28-4d4d-9f41-7a52c5f2e502', WHOLESALE_TIER_ID, 7.49, 0);
        insertPrice.run('2f8c8d4e-8d28-4d4d-9f41-7a52c5f2e605', '2f8c8d4e-8d28-4d4d-9f41-7a52c5f2e503', RETAIL_TIER_ID, 12.00, 0);
        insertPrice.run('2f8c8d4e-8d28-4d4d-9f41-7a52c5f2e606', '2f8c8d4e-8d28-4d4d-9f41-7a52c5f2e503', WHOLESALE_TIER_ID, 10.50, 0);

        database.prepare(`
            INSERT INTO inventory_lots (lot_id, variant_id, lot_number, expiration_date, quantity_on_hand, created_at, updated_at)
            VALUES (?, ?, ?, ?, ?, ?, ?)
        `).run('2f8c8d4e-8d28-4d4d-9f41-7a52c5f2e701', '2f8c8d4e-8d28-4d4d-9f41-7a52c5f2e501', 'FLOUR-DEMO-01', '2027-03-31', 250, SEED_TIMESTAMP, SEED_TIMESTAMP);

        database.prepare(`
            INSERT INTO customers (customer_id, company_name, contact_name, tier_id, credit_limit, current_balance, created_at, updated_at)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?)
        `).run('2f8c8d4e-8d28-4d4d-9f41-7a52c5f2e801', 'Sunrise Bakery', 'Maya Chen', WHOLESALE_TIER_ID, 5000, 0, SEED_TIMESTAMP, SEED_TIMESTAMP);

    });

    seed();
}

import Database from 'better-sqlite3';
import { randomBytes, randomUUID, scryptSync } from 'node:crypto';

const SEED_TIMESTAMP = '2026-09-23T00:00:00.000Z';
const RETAIL_TIER_ID = '2f8c8d4e-8d28-4d4d-9f41-7a52c5f2e101';
const WHOLESALE_TIER_ID = '2f8c8d4e-8d28-4d4d-9f41-7a52c5f2e102';

function passwordRecord(password: string): { salt: string; hash: string } {
    const salt = randomBytes(16).toString('hex');
    return { salt, hash: scryptSync(password, salt, 64).toString('hex') };
}

function seedAdditionalProducts(database: Database.Database): void {
    const insertProduct = database.prepare(`
        INSERT OR IGNORE INTO products (product_id, category_id, name, base_uom_id, is_sold_by_weight, requires_lot_tracking, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `);
    const insertVariant = database.prepare(`
        INSERT OR IGNORE INTO product_variants (variant_id, product_id, sku, barcode, variant_name, attributes, initial_cost, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);
    const insertPrice = database.prepare(`
        INSERT OR IGNORE INTO product_prices (product_price_id, variant_id, tier_id, price_per_unit, min_quantity)
        VALUES (?, ?, ?, ?, 0)
    `);
    const products = [
        ['2f8c8d4e-8d28-4d4d-9f41-7a52c5f2f401', '2f8c8d4e-8d28-4d4d-9f41-7a52c5f2e301', 'Cocoa Powder', '2f8c8d4e-8d28-4d4d-9f41-7a52c5f2e201', 1, 1, 'COCOA-1KG', '100000000004', 'Cocoa Powder 1 kg', 4.25, 6.49, 5.75],
        ['2f8c8d4e-8d28-4d4d-9f41-7a52c5f2f402', '2f8c8d4e-8d28-4d4d-9f41-7a52c5f2e301', 'Baking Soda', '2f8c8d4e-8d28-4d4d-9f41-7a52c5f2e201', 1, 0, 'SODA-500G', '100000000005', 'Baking Soda 500 g', 1.15, 2.25, 1.95],
        ['2f8c8d4e-8d28-4d4d-9f41-7a52c5f2f403', '2f8c8d4e-8d28-4d4d-9f41-7a52c5f2e301', 'Active Dry Yeast', '2f8c8d4e-8d28-4d4d-9f41-7a52c5f2e201', 1, 1, 'YEAST-500G', '100000000006', 'Active Dry Yeast 500 g', 3.10, 5.25, 4.45],
        ['2f8c8d4e-8d28-4d4d-9f41-7a52c5f2f404', '2f8c8d4e-8d28-4d4d-9f41-7a52c5f2e302', 'Rainbow Sprinkles', '2f8c8d4e-8d28-4d4d-9f41-7a52c5f2e202', 0, 0, 'SPRINKLE-12', '100000000007', 'Rainbow Sprinkles 12 oz', 2.75, 4.99, 4.25],
        ['2f8c8d4e-8d28-4d4d-9f41-7a52c5f2f405', '2f8c8d4e-8d28-4d4d-9f41-7a52c5f2e302', 'Parchment Paper', '2f8c8d4e-8d28-4d4d-9f41-7a52c5f2e202', 0, 0, 'PARCH-50', '100000000008', 'Parchment Paper 50 sheets', 3.50, 6.50, 5.50],
    ] as const;
    for (const [productId, categoryId, name, uomId, soldByWeight, lotTracking, sku, barcode, variantName, cost, retailPrice, wholesalePrice] of products) {
        insertProduct.run(productId, categoryId, name, uomId, soldByWeight, lotTracking, SEED_TIMESTAMP, SEED_TIMESTAMP);
        const variantId = productId.replace('f401', 'f501').replace('f402', 'f502').replace('f403', 'f503').replace('f404', 'f504').replace('f405', 'f505');
        insertVariant.run(variantId, productId, sku, barcode, variantName, '{}', cost, SEED_TIMESTAMP, SEED_TIMESTAMP);
        insertPrice.run(randomUUID(), variantId, RETAIL_TIER_ID, retailPrice);
        insertPrice.run(randomUUID(), variantId, WHOLESALE_TIER_ID, wholesalePrice);
    }
}

function seedAdditionalInventory(database: Database.Database): void {
    const insertLot = database.prepare(`
        INSERT OR IGNORE INTO inventory_lots (lot_id, variant_id, lot_number, expiration_date, quantity_on_hand, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, ?)
    `);
    const lots = [
        ['2f8c8d4e-8d28-4d4d-9f41-7a52c5f2f701', '2f8c8d4e-8d28-4d4d-9f41-7a52c5f2f501', 'COCOA-DEMO-01', '2027-09-30', 100],
        ['2f8c8d4e-8d28-4d4d-9f41-7a52c5f2f702', '2f8c8d4e-8d28-4d4d-9f41-7a52c5f2f502', 'SODA-DEMO-01', null, 100],
        ['2f8c8d4e-8d28-4d4d-9f41-7a52c5f2f703', '2f8c8d4e-8d28-4d4d-9f41-7a52c5f2f503', 'YEAST-DEMO-01', '2027-06-30', 100],
        ['2f8c8d4e-8d28-4d4d-9f41-7a52c5f2f704', '2f8c8d4e-8d28-4d4d-9f41-7a52c5f2f504', 'SPRINKLE-DEMO-01', null, 100],
        ['2f8c8d4e-8d28-4d4d-9f41-7a52c5f2f705', '2f8c8d4e-8d28-4d4d-9f41-7a52c5f2f505', 'PARCH-DEMO-01', null, 100],
        ['2f8c8d4e-8d28-4d4d-9f41-7a52c5f2f706', '2f8c8d4e-8d28-4d4d-9f41-7a52c5f2e501', 'FLOUR-DEMO-02', '2027-09-30', 250],
        ['2f8c8d4e-8d28-4d4d-9f41-7a52c5f2f707', '2f8c8d4e-8d28-4d4d-9f41-7a52c5f2e502', 'VANILLA-DEMO-01', null, 100],
        ['2f8c8d4e-8d28-4d4d-9f41-7a52c5f2f708', '2f8c8d4e-8d28-4d4d-9f41-7a52c5f2e503', 'BOX-DEMO-01', null, 100],
    ] as const;
    for (const [lotId, variantId, lotNumber, expirationDate, quantityOnHand] of lots) {
        insertLot.run(lotId, variantId, lotNumber, expirationDate, quantityOnHand, SEED_TIMESTAMP, SEED_TIMESTAMP);
    }
}

function seedDummyCustomers(database: Database.Database): void {
    const insert = database.prepare(`INSERT OR IGNORE INTO customers (customer_id, company_name, contact_name, email, phone, tier_id, credit_limit, current_balance, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, 0, 0, ?, ?)`);
    const customers = [
        ['2f8c8d4e-8d28-4d4d-9f41-7a52c5f2f801', 'Golden Crust Bakery', 'Ava Brooks', 'ava@goldencrust.example', '555-0101', WHOLESALE_TIER_ID],
        ['2f8c8d4e-8d28-4d4d-9f41-7a52c5f2f802', 'Sweet Rise Cafe', 'Liam Carter', 'liam@sweetrise.example', '555-0102', WHOLESALE_TIER_ID],
        ['2f8c8d4e-8d28-4d4d-9f41-7a52c5f2f803', 'Butter & Bloom', 'Mia Davis', 'mia@butterbloom.example', '555-0103', WHOLESALE_TIER_ID],
        ['2f8c8d4e-8d28-4d4d-9f41-7a52c5f2f804', 'Home Baker', 'Noah Evans', 'noah@homebaker.example', '555-0104', RETAIL_TIER_ID],
        ['2f8c8d4e-8d28-4d4d-9f41-7a52c5f2f805', 'Cinnamon House', 'Emma Flores', 'emma@cinnamonhouse.example', '555-0105', WHOLESALE_TIER_ID],
        ['2f8c8d4e-8d28-4d4d-9f41-7a52c5f2f806', 'The Pie Room', 'Oliver Green', 'oliver@thepieroom.example', '555-0106', WHOLESALE_TIER_ID],
        ['2f8c8d4e-8d28-4d4d-9f41-7a52c5f2f807', 'Weekend Baker', 'Sophia Hill', 'sophia@weekendbaker.example', '555-0107', RETAIL_TIER_ID],
        ['2f8c8d4e-8d28-4d4d-9f41-7a52c5f2f808', 'Flour Power', 'James Irving', 'james@flourpower.example', '555-0108', WHOLESALE_TIER_ID],
        ['2f8c8d4e-8d28-4d4d-9f41-7a52c5f2f809', 'Sugar Studio', 'Isla Jones', 'isla@sugarstudio.example', '555-0109', RETAIL_TIER_ID],
        ['2f8c8d4e-8d28-4d4d-9f41-7a52c5f2f810', 'Morning Loaf', 'Ethan King', 'ethan@morningloaf.example', '555-0110', WHOLESALE_TIER_ID],
    ] as const;
    for (const [id, company, contact, email, phone, tier] of customers) insert.run(id, company, contact, email, phone, tier, SEED_TIMESTAMP, SEED_TIMESTAMP);
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
            seedAdditionalProducts(database);
            seedAdditionalInventory(database);
            seedDummyCustomers(database);
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

        seedAdditionalProducts(database);
        seedAdditionalInventory(database);
        seedDummyCustomers(database);

    });

    seed();
}

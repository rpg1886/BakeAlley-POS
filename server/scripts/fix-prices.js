// server/scripts/fix-prices.js
const { Pool } = require('pg');

const connectionString =
  process.env.DATABASE_URL ||
  'postgresql://postgres:BakeAlley_0824@127.0.0.1:5432/bakealley';

const pool = new Pool({ connectionString });
const CANONICAL_RETAIL_TIER_ID = '2f8c8d4e-8d28-4d4d-9f41-7a52c5f2e101';

async function fixCloudPrices() {
  const client = await pool.connect();
  try {
    console.log('==================================================');
    console.log('  BAKE ALLEY CLOUD POS - DATABASE PRICE REPAIR   ');
    console.log('==================================================\n');

    await client.query('BEGIN');

    // 1. Upsert canonical Retail Tier
    await client.query(
      `
      INSERT INTO price_tiers (tier_id, tier_name)
      VALUES ($1, 'Retail-Canonical')
      ON CONFLICT (tier_id) DO NOTHING;
    `,
      [CANONICAL_RETAIL_TIER_ID]
    );

    // 2. Re-link foreign keys to canonical Retail Tier ID
    await client.query(
      `
      UPDATE product_prices 
      SET tier_id = $1 
      WHERE tier_id IN (
        SELECT tier_id FROM price_tiers WHERE lower(tier_name) LIKE 'retail%' AND tier_id != $1
      );
    `,
      [CANONICAL_RETAIL_TIER_ID]
    );

    await client.query(
      `
      UPDATE customers 
      SET tier_id = $1 
      WHERE tier_id IN (
        SELECT tier_id FROM price_tiers WHERE lower(tier_name) LIKE 'retail%' AND tier_id != $1
      );
    `,
      [CANONICAL_RETAIL_TIER_ID]
    );

    await client.query(
      `
      UPDATE orders 
      SET pricing_tier_id = $1 
      WHERE pricing_tier_id IN (
        SELECT tier_id FROM price_tiers WHERE lower(tier_name) LIKE 'retail%' AND tier_id != $1
      );
    `,
      [CANONICAL_RETAIL_TIER_ID]
    );

    // 3. Delete non-canonical duplicate Retail tiers
    await client.query(
      `
      DELETE FROM price_tiers 
      WHERE tier_id != $1 AND lower(tier_name) LIKE 'retail%';
    `,
      [CANONICAL_RETAIL_TIER_ID]
    );

    // 4. Set canonical tier name to 'Retail'
    await client.query(
      `
      UPDATE price_tiers 
      SET tier_name = 'Retail' 
      WHERE tier_id = $1;
    `,
      [CANONICAL_RETAIL_TIER_ID]
    );

    // 5. Insert/Update prices with 20% markup based on initial_cost
    const upsertResult = await client.query(
      `
      INSERT INTO product_prices (product_price_id, variant_id, tier_id, price_per_unit, min_quantity)
      SELECT 
        gen_random_uuid(), 
        v.variant_id, 
        $1, 
        ROUND(CAST(GREATEST(p.initial_cost, 10.00) * 1.20 AS NUMERIC), 2), 
        0
      FROM product_variants v
      JOIN products p ON p.product_id = v.product_id
      ON CONFLICT (variant_id, tier_id, min_quantity) 
      DO UPDATE SET price_per_unit = EXCLUDED.price_per_unit;
    `,
      [CANONICAL_RETAIL_TIER_ID]
    );

    await client.query('COMMIT');
    console.log(`✓ Updated database with ${upsertResult.rowCount} retail prices (20% markup)!`);

    // Verification output
    const sample = await client.query(
      `
      SELECT 
        v.sku, 
        v.variant_name AS name, 
        pp.price_per_unit AS "pricePerUnit"
      FROM product_variants v
      JOIN product_prices pp ON pp.variant_id = v.variant_id
      WHERE pp.tier_id = $1
      LIMIT 5;
    `,
      [CANONICAL_RETAIL_TIER_ID]
    );

    console.log('\n--- Sample Products in Database ---');
    console.table(sample.rows);
    console.log('\n✅ SUCCESS: Prices are populated and active!');
  } catch (error) {
    await client.query('ROLLBACK').catch(() => undefined);
    console.error('❌ Database error:', error);
  } finally {
    client.release();
    await pool.end();
  }
}

fixCloudPrices();
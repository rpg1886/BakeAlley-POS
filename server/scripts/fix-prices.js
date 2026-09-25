// server/scripts/fix-prices.js
const { Pool } = require('pg');

const connectionString =
  process.env.DATABASE_URL ||
  'postgresql://postgres:BakeAlley_0824@127.0.0.1:5432/bakealley';

const pool = new Pool({ connectionString });

async function fixPrices() {
  const client = await pool.connect();
  try {
    console.log('Connecting to local PostgreSQL database...');

    // 1. Ensure Retail price tier exists with canonical UUID
    await client.query(`
      INSERT INTO price_tiers (tier_id, tier_name)
      VALUES ('2f8c8d4e-8d28-4d4d-9f41-7a52c5f2e101', 'Retail')
      ON CONFLICT (tier_name) DO NOTHING;
    `);
    console.log("✓ Retail price tier verified.");

    // 2. Populate/Update product_prices for all existing variants using 20% markup
    const result = await client.query(`
      INSERT INTO product_prices (product_price_id, variant_id, tier_id, price_per_unit, min_quantity)
      SELECT 
        gen_random_uuid(), 
        v.variant_id, 
        '2f8c8d4e-8d28-4d4d-9f41-7a52c5f2e101', 
        ROUND(CAST(p.initial_cost * 1.20 AS NUMERIC), 2), 
        0
      FROM product_variants v
      JOIN products p ON p.product_id = v.product_id
      ON CONFLICT (variant_id, tier_id, min_quantity) 
      DO UPDATE SET price_per_unit = EXCLUDED.price_per_unit;
    `);

    console.log(`✓ Successfully updated prices for ${result.rowCount} product variants with 20% markup!`);
  } catch (error) {
    console.error('❌ Failed to update prices:', error);
  } finally {
    client.release();
    await pool.end();
  }
}

fixPrices();

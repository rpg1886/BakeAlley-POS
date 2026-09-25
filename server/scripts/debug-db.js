// server/scripts/debug-db.js
const { Pool } = require('pg');

const connectionString =
  process.env.DATABASE_URL ||
  'postgresql://postgres:BakeAlley_0824@127.0.0.1:5432/bakealley';

const pool = new Pool({ connectionString });

async function debugDB() {
  const client = await pool.connect();
  try {
    console.log('==================================================');
    console.log('         BAKE ALLEY DATABASE DIAGNOSTIC           ');
    console.log('==================================================\n');

    console.log(`Connecting to: ${connectionString.replace(/:[^:@]+@/, ':****@')}\n`);

    // 1. Price Tiers
    const tiers = await client.query('SELECT tier_id AS "tierId", tier_name AS "tierName" FROM price_tiers');
    console.log('--- 1. PRICE TIERS IN DATABASE ---');
    console.table(tiers.rows);

    // 2. Product Prices Count
    const priceCount = await client.query('SELECT COUNT(*)::int FROM product_prices');
    console.log(`\nTotal rows in product_prices table: ${priceCount.rows.count}`);

    // 3. Sample Product Prices
    const samplePrices = await client.query(`
      SELECT 
        v.sku, 
        p.name, 
        p.initial_cost AS "initialCost",
        pp.tier_id AS "tierId", 
        pp.price_per_unit AS "pricePerUnit"
      FROM product_variants v
      JOIN products p ON p.product_id = v.product_id
      LEFT JOIN product_prices pp ON pp.variant_id = v.variant_id
      LIMIT 5
    `);
    console.log('\n--- 2. SAMPLE PRODUCTS & PRICES JOIN ---');
    console.table(samplePrices.rows);

    // 4. API Search Query Output Simulation
    const apiQuery = await client.query(`
      SELECT 
        v.variant_id AS "variantId", 
        v.sku, 
        v.variant_name AS name, 
        pp.tier_id AS "tierId", 
        pp.price_per_unit AS "pricePerUnit" 
      FROM product_variants v 
      JOIN products p ON p.product_id=v.product_id 
      LEFT JOIN product_prices pp ON pp.variant_id=v.variant_id 
      LIMIT 5
    `);
    console.log('\n--- 3. API SEARCH QUERY SIMULATION ---');
    console.table(apiQuery.rows);

    console.log('\n==================================================');
  } catch (err) {
    console.error('❌ Diagnostic error:', err);
  } finally {
    client.release();
    await pool.end();
  }
}

debugDB();

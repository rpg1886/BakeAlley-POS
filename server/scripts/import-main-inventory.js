// Imports Inventory_Main.csv (the store's source-of-truth stock take) directly into the
// cloud PostgreSQL catalog. Mirrors src/main/inventory/inventoryImportService.ts so the
// Electron desktop app and the cloud database build the same catalog from the same file.
//
// Usage: node server/scripts/import-main-inventory.js [path-to-csv] [defaultMarkupPercent]

const path = require('node:path');
const crypto = require('node:crypto');
const XLSX = require('xlsx');
const { pool, migrate } = require('../db');

const STOCK_TAKE_LOT_NUMBER = 'STOCKTAKE-MAIN';
const UNCATEGORIZED_CATEGORY = 'UNCATEGORIZED';

function slug(value) {
  return value.toUpperCase().replace(/[^A-Z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 24) || 'ITEM';
}

function parseNonNegativeNumber(value) {
  const parsed = typeof value === 'number' ? value : Number(String(value ?? '0').replace(/,/g, ''));
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : 0;
}

function roundMoney(value) {
  return Math.round(value * 100) / 100;
}

function roundQuantity(value) {
  return Math.round(value * 10000) / 10000;
}

function mergeRows(sourceRows) {
  const merged = new Map();
  let skippedRows = 0;
  for (const row of sourceRows) {
    const name = typeof row.Name === 'string' ? row.Name.trim() : '';
    if (!name) {
      skippedRows += 1;
      continue;
    }
    const category = typeof row.Category === 'string' && row.Category.trim() !== ''
      ? row.Category.trim().toUpperCase()
      : UNCATEGORIZED_CATEGORY;
    const warehouseRaw = typeof row.Warehouse === 'string' ? row.Warehouse.trim() : '';
    const warehouse = warehouseRaw === '' ? null : warehouseRaw;
    const quantity = roundQuantity(parseNonNegativeNumber(row['Stock Qty']));
    const cost = roundMoney(parseNonNegativeNumber(row.Cost));
    const key = `${category}::${name.toLowerCase()}`;
    const existing = merged.get(key);
    if (existing) {
      const totalQuantity = existing.quantity + quantity;
      existing.cost = totalQuantity > 0
        ? roundMoney((existing.cost * existing.quantity + cost * quantity) / totalQuantity)
        : roundMoney((existing.cost + cost) / 2);
      existing.quantity = totalQuantity;
      existing.warehouse = existing.warehouse ?? warehouse;
    } else {
      merged.set(key, { name, category, warehouse, quantity, cost });
    }
  }
  return { rows: merged, skippedRows };
}

async function ensurePieceUom(client) {
  const existing = await client.query("SELECT uom_id AS \"uomId\" FROM units_of_measure WHERE name = 'Piece'");
  if (existing.rowCount) {
    return existing.rows[0].uomId;
  }
  const inserted = await client.query(
    "INSERT INTO units_of_measure (uom_id, name, symbol) VALUES (gen_random_uuid(), 'Piece', 'pc') RETURNING uom_id AS \"uomId\"",
  );
  return inserted.rows[0].uomId;
}

async function importMainInventory(csvPath, defaultMarkupPercent) {
  await migrate();
  const workbook = XLSX.readFile(csvPath, { cellDates: false });
  const sheet = workbook.Sheets[workbook.SheetNames[0]];
  if (!sheet) throw new Error(`No worksheet found in ${csvPath}`);
  const sourceRows = XLSX.utils.sheet_to_json(sheet, { defval: null, raw: false });
  if (sourceRows.length === 0) throw new Error(`${csvPath} contains no rows`);

  const { rows: merged, skippedRows } = mergeRows(sourceRows);
  if (merged.size === 0) throw new Error(`${csvPath} contains no usable rows`);

  const client = await pool.connect();
  const usedSkus = new Set();
  let createdCategories = 0;
  let createdProducts = 0;
  let updatedProducts = 0;
  let createdLots = 0;
  let updatedLots = 0;

  try {
    await client.query('BEGIN');
    const uomId = await ensurePieceUom(client);
    const retailTier = await client.query("SELECT tier_id AS \"tierId\" FROM price_tiers WHERE lower(tier_name) = 'retail' LIMIT 1");
    const retailTierId = retailTier.rowCount ? retailTier.rows[0].tierId : null;

    const existingSkus = await client.query('SELECT sku FROM product_variants');
    for (const row of existingSkus.rows) usedSkus.add(row.sku);

    for (const row of merged.values()) {
      let categoryId;
      const existingCategory = await client.query('SELECT category_id AS "categoryId" FROM categories WHERE lower(name) = lower($1)', [row.category]);
      if (existingCategory.rowCount) {
        categoryId = existingCategory.rows[0].categoryId;
      } else {
        const inserted = await client.query('INSERT INTO categories (category_id, name) VALUES (gen_random_uuid(), $1) RETURNING category_id AS "categoryId"', [row.category]);
        categoryId = inserted.rows[0].categoryId;
        createdCategories += 1;
      }

      const attributes = row.warehouse ? { warehouse: row.warehouse } : {};
      const existingProduct = await client.query(
        `SELECT p.product_id AS "productId", v.variant_id AS "variantId"
         FROM products p JOIN product_variants v ON v.product_id = p.product_id
         WHERE lower(p.name) = lower($1) AND p.category_id = $2 LIMIT 1`,
        [row.name, categoryId],
      );

      let variantId;
      if (existingProduct.rowCount) {
        variantId = existingProduct.rows[0].variantId;
        await client.query(
          'UPDATE products SET initial_cost = $1, updated_at = now() WHERE product_id = $2',
          [row.cost, existingProduct.rows[0].productId],
        );
        await client.query(
          'UPDATE product_variants SET attributes = $1::jsonb, updated_at = now() WHERE variant_id = $2',
          [JSON.stringify(attributes), variantId],
        );
        updatedProducts += 1;
      } else {
        const productId = crypto.randomUUID();
        variantId = crypto.randomUUID();
        let sku = `${slug(row.category)}-${slug(row.name)}`;
        let suffix = 2;
        while (usedSkus.has(sku)) { sku = `${slug(row.category)}-${slug(row.name)}-${suffix}`; suffix += 1; }
        usedSkus.add(sku);
        await client.query(
          `INSERT INTO products (product_id, category_id, name, base_uom_id, is_sold_by_weight, requires_lot_tracking, initial_cost)
           VALUES ($1, $2, $3, $4, FALSE, FALSE, $5)`,
          [productId, categoryId, row.name, uomId, row.cost],
        );
        await client.query(
          `INSERT INTO product_variants (variant_id, product_id, sku, barcode, variant_name, attributes)
           VALUES ($1, $2, $3, NULL, $4, $5::jsonb)`,
          [variantId, productId, sku, row.name, JSON.stringify(attributes)],
        );
        createdProducts += 1;
      }

      if (retailTierId) {
        const retailPrice = roundMoney(row.cost * (1 + defaultMarkupPercent / 100));
        await client.query(
          `INSERT INTO product_prices (product_price_id, variant_id, tier_id, price_per_unit, min_quantity)
           VALUES (gen_random_uuid(), $1, $2, $3, 0)
           ON CONFLICT (variant_id, tier_id, min_quantity) DO UPDATE SET price_per_unit = excluded.price_per_unit`,
          [variantId, retailTierId, retailPrice],
        );
      }

      const existingLot = await client.query(
        'SELECT lot_id AS "lotId" FROM inventory_lots WHERE variant_id = $1 AND lot_number = $2',
        [variantId, STOCK_TAKE_LOT_NUMBER],
      );
      if (existingLot.rowCount) {
        await client.query(
          'UPDATE inventory_lots SET quantity_on_hand = $1, updated_at = now() WHERE lot_id = $2',
          [row.quantity, existingLot.rows[0].lotId],
        );
        updatedLots += 1;
      } else {
        await client.query(
          `INSERT INTO inventory_lots (lot_id, variant_id, lot_number, expiration_date, quantity_on_hand)
           VALUES (gen_random_uuid(), $1, $2, NULL, $3)`,
          [variantId, STOCK_TAKE_LOT_NUMBER, row.quantity],
        );
        createdLots += 1;
      }
    }

    await client.query('COMMIT');
    console.log(`Imported ${sourceRows.length} rows from ${csvPath} (${skippedRows} skipped).`);
    console.log(JSON.stringify({ createdCategories, createdProducts, updatedProducts, createdLots, updatedLots }));
  } catch (error) {
    await client.query('ROLLBACK').catch(() => undefined);
    throw error;
  } finally {
    client.release();
    await pool.end();
  }
}

const csvPath = path.resolve(process.argv[2] || path.join(__dirname, '..', '..', 'Inventory_Main.csv'));
const defaultMarkupPercent = Number(process.argv[3] || 35);
importMainInventory(csvPath, defaultMarkupPercent).catch((error) => {
  console.error(error);
  process.exitCode = 1;
});

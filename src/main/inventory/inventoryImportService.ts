import { randomUUID } from 'node:crypto';
import Database from 'better-sqlite3';
import * as XLSX from 'xlsx';
import type { AuthService } from '../auth/authService';

export interface InventoryImportResult {
    importedRows: number;
    createdLots: number;
    updatedLots: number;
}

export interface StockTakeImportResult {
    importedRows: number;
    skippedRows: number;
    createdCategories: number;
    createdProducts: number;
    updatedProducts: number;
    createdLots: number;
    updatedLots: number;
}

const STOCK_TAKE_LOT_NUMBER = 'STOCKTAKE-MAIN';
const STOCK_TAKE_UOM_ID = 'stock-take-piece-uom';
const UNCATEGORIZED_CATEGORY = 'UNCATEGORIZED';

export interface InventoryRow {
    sku: string;
    productName: string;
    variantName: string;
    lotNumber: string;
    expirationDate: string | null;
    quantityOnHand: number;
    unit: string;
    initialCapital: number;
    retailPrice: number;
    markupAmount: number;
    markupPercent: number | null;
}

interface InventoryImportRow {
    sku?: unknown;
    lot_number?: unknown;
    expiration_date?: unknown;
    quantity_on_hand?: unknown;
}

interface StockTakeSourceRow {
    Name?: unknown;
    'Stock Qty'?: unknown;
    Cost?: unknown;
    'Total Amount'?: unknown;
    Category?: unknown;
    Warehouse?: unknown;
}

interface MergedStockTakeRow {
    name: string;
    category: string;
    warehouse: string | null;
    quantity: number;
    cost: number;
}

export class InventoryImportService {
    private readonly database: Database.Database;
    private readonly auth: AuthService;

    public constructor(database: Database.Database, auth: AuthService) {
        this.database = database;
        this.auth = auth;
    }

    public importWorkbook(token: string, fileBytes: Uint8Array, fileName: string): InventoryImportResult {
        this.auth.requireAdmin(token);
        if (!/\.(csv|xlsx|xls)$/i.test(fileName)) {
            throw new Error('Only CSV, XLSX, and XLS inventory files are supported');
        }
        const workbook = XLSX.read(Buffer.from(fileBytes), { type: 'buffer', cellDates: false });
        const sheet = workbook.Sheets[workbook.SheetNames[0]];
        if (!sheet) {
            throw new Error('The inventory file has no worksheet');
        }
        const rows = XLSX.utils.sheet_to_json<InventoryImportRow>(sheet, { defval: null, raw: false });
        if (rows.length === 0) {
            throw new Error('The inventory file contains no rows');
        }

        const importRows = this.database.transaction(() => {
            let createdLots = 0;
            let updatedLots = 0;
            const now = new Date().toISOString();
            const findVariant = this.database.prepare('SELECT variant_id AS variantId FROM product_variants WHERE sku = ?');
            const findLot = this.database.prepare('SELECT lot_id AS lotId FROM inventory_lots WHERE variant_id = ? AND lot_number = ?');
            const insertLot = this.database.prepare(`
                INSERT INTO inventory_lots (lot_id, variant_id, lot_number, expiration_date, quantity_on_hand, created_at, updated_at)
                VALUES (?, ?, ?, ?, ?, ?, ?)
            `);
            const updateLot = this.database.prepare(`
                UPDATE inventory_lots
                SET expiration_date = ?, quantity_on_hand = ?, updated_at = ?
                WHERE lot_id = ?
            `);
            const queue = this.database.prepare(`
                INSERT INTO sync_queue (queue_id, entity_type, entity_id, operation, payload, status, retry_count, next_attempt_at, last_error, created_at, updated_at)
                VALUES (?, 'inventory_lots', ?, 'update', ?, 'PENDING', 0, NULL, NULL, ?, ?)
            `);

            for (const row of rows) {
                const sku = this.requiredString(row.sku, 'sku');
                const lotNumber = this.requiredString(row.lot_number, 'lot_number');
                const expirationDate = this.requiredDate(row.expiration_date);
                const quantity = this.requiredQuantity(row.quantity_on_hand);
                const variant = findVariant.get(sku) as { variantId: string } | undefined;
                if (!variant) {
                    throw new Error(`Unknown SKU in inventory file: ${sku}`);
                }
                const existingLot = findLot.get(variant.variantId, lotNumber) as { lotId: string } | undefined;
                const lotId = existingLot?.lotId ?? randomUUID();
                if (existingLot) {
                    updateLot.run(expirationDate, quantity, now, lotId);
                    updatedLots += 1;
                } else {
                    insertLot.run(lotId, variant.variantId, lotNumber, expirationDate, quantity, now, now);
                    createdLots += 1;
                }
                queue.run(randomUUID(), lotId, JSON.stringify({ lotId, variantId: variant.variantId, lotNumber, expirationDate, quantityOnHand: quantity }), now, now);
            }
            return { importedRows: rows.length, createdLots, updatedLots };
        });

        return importRows();
    }

    /**
     * Imports the master baking-supply stock take (Name, Stock Qty, Cost, Total Amount,
     * Category, Warehouse). This file is the source of truth for the catalog: categories,
     * products, variants, and a single non-expiring "STOCKTAKE-MAIN" lot are created or
     * refreshed from it. Since the sheet has no SKU/barcode/expiration data, SKUs are
     * derived deterministically from category + product name, and a default retail markup
     * is applied so every item has a sellable price until an admin overrides it.
     */
    public importStockTakeWorkbook(token: string, fileBytes: Uint8Array, fileName: string, defaultMarkupPercent = 35): StockTakeImportResult {
        this.auth.requireAdmin(token);
        if (!/\.(csv|xlsx|xls)$/i.test(fileName)) {
            throw new Error('Only CSV, XLSX, and XLS inventory files are supported');
        }
        if (!Number.isFinite(defaultMarkupPercent) || defaultMarkupPercent < 0) {
            throw new Error('defaultMarkupPercent must be a non-negative number');
        }
        const workbook = XLSX.read(Buffer.from(fileBytes), { type: 'buffer', cellDates: false });
        const sheet = workbook.Sheets[workbook.SheetNames[0]];
        if (!sheet) {
            throw new Error('The inventory file has no worksheet');
        }
        const sourceRows = XLSX.utils.sheet_to_json<StockTakeSourceRow>(sheet, { defval: null, raw: false });
        if (sourceRows.length === 0) {
            throw new Error('The inventory file contains no rows');
        }

        const { rows: merged, skippedRows } = this.mergeStockTakeRows(sourceRows);
        if (merged.size === 0) {
            throw new Error('The inventory file contains no usable rows');
        }

        const run = this.database.transaction(() => {
            const now = new Date().toISOString();
            let createdCategories = 0;
            let createdProducts = 0;
            let updatedProducts = 0;
            let createdLots = 0;
            let updatedLots = 0;

            const uomId = this.ensureStockTakeUom(now);
            const retailTier = this.database.prepare("SELECT tier_id AS tierId FROM price_tiers WHERE tier_name = 'Retail' LIMIT 1").get() as { tierId: string } | undefined;

            const findCategory = this.database.prepare('SELECT category_id AS categoryId FROM categories WHERE lower(name) = lower(?)');
            const insertCategory = this.database.prepare('INSERT INTO categories (category_id, name) VALUES (?, ?)');
            const findProductByNameAndCategory = this.database.prepare(`
                SELECT product.product_id AS productId, variant.variant_id AS variantId, variant.attributes AS attributes
                FROM products AS product
                JOIN product_variants AS variant ON variant.product_id = product.product_id
                WHERE lower(product.name) = lower(?) AND (product.category_id = ? OR (product.category_id IS NULL AND ? IS NULL))
                LIMIT 1
            `);
            const insertProduct = this.database.prepare(`
                INSERT INTO products (product_id, category_id, name, base_uom_id, is_sold_by_weight, requires_lot_tracking, created_at, updated_at)
                VALUES (?, ?, ?, ?, 0, 0, ?, ?)
            `);
            const insertVariant = this.database.prepare(`
                INSERT INTO product_variants (variant_id, product_id, sku, barcode, variant_name, attributes, initial_cost, created_at, updated_at)
                VALUES (?, ?, ?, NULL, ?, ?, ?, ?, ?)
            `);
            const updateVariantCostAndAttributes = this.database.prepare(`
                UPDATE product_variants SET initial_cost = ?, attributes = ?, updated_at = ? WHERE variant_id = ?
            `);
            const upsertRetailPrice = this.database.prepare(`
                INSERT INTO product_prices (product_price_id, variant_id, tier_id, price_per_unit, min_quantity)
                VALUES (?, ?, ?, ?, 0)
                ON CONFLICT (variant_id, tier_id, min_quantity) DO UPDATE SET price_per_unit = excluded.price_per_unit
            `);
            const findLot = this.database.prepare('SELECT lot_id AS lotId FROM inventory_lots WHERE variant_id = ? AND lot_number = ?');
            const insertLot = this.database.prepare(`
                INSERT INTO inventory_lots (lot_id, variant_id, lot_number, expiration_date, quantity_on_hand, created_at, updated_at)
                VALUES (?, ?, ?, NULL, ?, ?, ?)
            `);
            const updateLot = this.database.prepare(`
                UPDATE inventory_lots SET quantity_on_hand = ?, updated_at = ? WHERE lot_id = ?
            `);

            const usedSkus = new Set<string>(
                (this.database.prepare('SELECT sku FROM product_variants').all() as Array<{ sku: string }>).map((row) => row.sku),
            );

            for (const row of merged.values()) {
                const categoryName = row.category;
                let categoryId: string | null;
                const existingCategory = findCategory.get(categoryName) as { categoryId: string } | undefined;
                if (existingCategory) {
                    categoryId = existingCategory.categoryId;
                } else {
                    categoryId = randomUUID();
                    insertCategory.run(categoryId, categoryName);
                    createdCategories += 1;
                }

                const attributes = JSON.stringify(row.warehouse ? { warehouse: row.warehouse } : {});
                const existing = findProductByNameAndCategory.get(row.name, categoryId, categoryId) as
                    { productId: string; variantId: string; attributes: string } | undefined;

                let variantId: string;
                if (existing) {
                    variantId = existing.variantId;
                    updateVariantCostAndAttributes.run(row.cost, attributes, now, variantId);
                    updatedProducts += 1;
                } else {
                    const productId = randomUUID();
                    variantId = randomUUID();
                    const sku = this.generateSku(categoryName, row.name, usedSkus);
                    insertProduct.run(productId, categoryId, row.name, uomId, now, now);
                    insertVariant.run(variantId, productId, sku, row.name, attributes, row.cost, now, now);
                    createdProducts += 1;
                }

                if (retailTier) {
                    const retailPrice = this.roundMoney(row.cost * (1 + defaultMarkupPercent / 100));
                    upsertRetailPrice.run(randomUUID(), variantId, retailTier.tierId, retailPrice);
                }

                const existingLot = findLot.get(variantId, STOCK_TAKE_LOT_NUMBER) as { lotId: string } | undefined;
                if (existingLot) {
                    updateLot.run(row.quantity, now, existingLot.lotId);
                    updatedLots += 1;
                } else {
                    insertLot.run(randomUUID(), variantId, STOCK_TAKE_LOT_NUMBER, row.quantity, now, now);
                    createdLots += 1;
                }
            }

            return {
                importedRows: sourceRows.length,
                skippedRows,
                createdCategories,
                createdProducts,
                updatedProducts,
                createdLots,
                updatedLots,
            } satisfies StockTakeImportResult;
        });

        return run();
    }

    private mergeStockTakeRows(sourceRows: StockTakeSourceRow[]): { rows: Map<string, MergedStockTakeRow>; skippedRows: number } {
        const merged = new Map<string, MergedStockTakeRow>();
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
            const quantity = this.roundQuantity(this.parseNonNegativeNumber(row['Stock Qty']));
            const cost = this.roundMoney(this.parseNonNegativeNumber(row.Cost));
            const key = `${category}::${name.toLowerCase()}`;
            const existing = merged.get(key);
            if (existing) {
                const totalQuantity = existing.quantity + quantity;
                existing.cost = totalQuantity > 0
                    ? this.roundMoney((existing.cost * existing.quantity + cost * quantity) / totalQuantity)
                    : this.roundMoney((existing.cost + cost) / 2);
                existing.quantity = totalQuantity;
                existing.warehouse = existing.warehouse ?? warehouse;
            } else {
                merged.set(key, { name, category, warehouse, quantity, cost });
            }
        }
        return { rows: merged, skippedRows };
    }

    private ensureStockTakeUom(now: string): string {
        const existing = this.database.prepare('SELECT uom_id AS uomId FROM units_of_measure WHERE uom_id = ?').get(STOCK_TAKE_UOM_ID) as { uomId: string } | undefined;
        if (existing) {
            return existing.uomId;
        }
        this.database.prepare('INSERT INTO units_of_measure (uom_id, name, symbol) VALUES (?, ?, ?)').run(STOCK_TAKE_UOM_ID, 'Piece', 'pc');
        return STOCK_TAKE_UOM_ID;
    }

    private generateSku(category: string, name: string, usedSkus: Set<string>): string {
        const slug = (value: string): string => value
            .toUpperCase()
            .replace(/[^A-Z0-9]+/g, '-')
            .replace(/^-+|-+$/g, '')
            .slice(0, 24) || 'ITEM';
        const base = `${slug(category)}-${slug(name)}`;
        let candidate = base;
        let suffix = 2;
        while (usedSkus.has(candidate)) {
            candidate = `${base}-${suffix}`;
            suffix += 1;
        }
        usedSkus.add(candidate);
        return candidate;
    }

    private parseNonNegativeNumber(value: unknown): number {
        const parsed = typeof value === 'number' ? value : Number(String(value ?? '0').replace(/,/g, ''));
        return Number.isFinite(parsed) && parsed >= 0 ? parsed : 0;
    }

    private roundMoney(value: number): number {
        return Math.round(value * 100) / 100;
    }

    private roundQuantity(value: number): number {
        return Math.round(value * 10000) / 10000;
    }

    public listInventory(token: string): InventoryRow[] {
        this.auth.requireUser(token);
        return this.database.prepare(`
                 SELECT variant.sku AS sku,
                   product.name AS productName,
                   variant.variant_name AS variantName,
                     COALESCE(GROUP_CONCAT(lot.lot_number, ', '), 'No lot assigned') AS lotNumber,
                     MIN(lot.expiration_date) AS expirationDate,
                     COALESCE(SUM(lot.quantity_on_hand), 0) AS quantityOnHand,
                     uom.symbol AS unit,
                     variant.initial_cost AS initialCapital,
                     COALESCE(retail.price_per_unit, 0) AS retailPrice,
                       COALESCE(retail.price_per_unit, 0) - variant.initial_cost AS markupAmount,
                     CASE WHEN variant.initial_cost > 0 AND retail.price_per_unit IS NOT NULL
                       THEN ((retail.price_per_unit - variant.initial_cost) / variant.initial_cost) * 100
                       ELSE NULL END AS markupPercent
                 FROM product_variants AS variant
            JOIN products AS product ON product.product_id = variant.product_id
            JOIN units_of_measure AS uom ON uom.uom_id = product.base_uom_id
                 LEFT JOIN inventory_lots AS lot ON lot.variant_id = variant.variant_id
                 LEFT JOIN product_prices AS retail ON retail.variant_id = variant.variant_id
                  AND retail.tier_id = (SELECT tier_id FROM price_tiers WHERE tier_name = 'Retail' LIMIT 1)
                  AND retail.min_quantity = (SELECT MIN(min_quantity) FROM product_prices WHERE variant_id = variant.variant_id AND tier_id = retail.tier_id)
                GROUP BY variant.variant_id, variant.sku, product.name, variant.variant_name, uom.symbol, variant.initial_cost, retail.price_per_unit
                 ORDER BY CASE WHEN MIN(lot.expiration_date) IS NULL THEN 1 ELSE 0 END,
                    MIN(lot.expiration_date) ASC,
                    variant.variant_name ASC
        `).all() as InventoryRow[];
    }

    private requiredString(value: unknown, field: string): string {
        if (typeof value !== 'string' || value.trim() === '') {
            throw new Error(`Inventory field ${field} is required`);
        }
        return value.trim();
    }

    private requiredDate(value: unknown): string {
        const date = this.requiredString(value, 'expiration_date');
        if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) {
            throw new Error(`Invalid expiration_date: ${date}. Use YYYY-MM-DD`);
        }
        return date;
    }

    private requiredQuantity(value: unknown): number {
        const parsed = typeof value === 'number' ? value : Number(value);
        if (!Number.isFinite(parsed) || parsed < 0 || Number(parsed.toFixed(4)) !== parsed) {
            throw new Error(`Invalid quantity_on_hand: ${String(value)}`);
        }
        return parsed;
    }
}

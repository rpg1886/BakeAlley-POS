import { randomUUID } from 'node:crypto';
import Database from 'better-sqlite3';
import * as XLSX from 'xlsx';
import type { AuthService } from '../auth/authService';

export interface InventoryImportResult {
    importedRows: number;
    createdLots: number;
    updatedLots: number;
}

export interface InventoryRow {
    sku: string;
    productName: string;
    variantName: string;
    lotNumber: string;
    expirationDate: string | null;
    quantityOnHand: number;
    unit: string;
}

interface InventoryImportRow {
    sku?: unknown;
    lot_number?: unknown;
    expiration_date?: unknown;
    quantity_on_hand?: unknown;
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

    public listInventory(token: string): InventoryRow[] {
        this.auth.requireUser(token);
        return this.database.prepare(`
            SELECT variant.sku AS sku,
                   product.name AS productName,
                   variant.variant_name AS variantName,
                   lot.lot_number AS lotNumber,
                   lot.expiration_date AS expirationDate,
                   lot.quantity_on_hand AS quantityOnHand,
                   uom.symbol AS unit
            FROM inventory_lots AS lot
            JOIN product_variants AS variant ON variant.variant_id = lot.variant_id
            JOIN products AS product ON product.product_id = variant.product_id
            JOIN units_of_measure AS uom ON uom.uom_id = product.base_uom_id
            ORDER BY CASE WHEN lot.expiration_date IS NULL THEN 1 ELSE 0 END,
                     lot.expiration_date ASC,
                     variant.variant_name ASC,
                     lot.lot_number ASC
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

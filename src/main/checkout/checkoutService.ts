import { randomUUID } from 'node:crypto';
import Database from 'better-sqlite3';

export interface CatalogPrice {
    tierId: string;
    minQuantity: number;
    pricePerUnit: number;
}

export interface CatalogProduct {
    variantId: string;
    sku: string;
    name: string;
    unit: string;
    soldByWeight: boolean;
    prices: CatalogPrice[];
}

export interface CatalogCustomer {
    customerId: string;
    displayName: string;
    tierId: string;
}

export interface CreateOrderItemInput {
    variantId: string;
    quantity: number;
    unitPrice: number;
    totalPrice: number;
}

export interface CreateOrderInput {
    customerId: string | null;
    pricingTierId: string;
    orderType: 'retail' | 'commercial';
    items: CreateOrderItemInput[];
    subtotal: number;
    taxAmount: number;
    totalAmount: number;
    paymentMethod: 'cash' | 'card' | 'account';
    cashReceived: number;
}

export interface CheckoutServiceOptions {
    database: Database.Database;
    taxRate?: number;
    now?: () => Date;
}

interface VariantRow {
    variantId: string;
    sku: string;
    name: string;
    unit: string;
    soldByWeight: number;
    tierId: string;
    minQuantity: number;
    pricePerUnit: number;
}

interface LotRow {
    lotId: string;
    quantityOnHand: number;
}

const cents = (value: number): number => Number(value.toFixed(2));
const quantity = (value: number): number => Number(value.toFixed(4));

export class CheckoutService {
    private readonly database: Database.Database;
    private readonly taxRate: number;
    private readonly now: () => Date;

    public constructor(options: CheckoutServiceOptions) {
        this.database = options.database;
        this.taxRate = options.taxRate ?? 0;
        this.now = options.now ?? (() => new Date());
    }

    public searchProducts(query: string): CatalogProduct[] {
        const searchTerm = `%${query.trim()}%`;
        const rows = this.database.prepare(`
            SELECT
                variant.variant_id AS variantId,
                variant.sku AS sku,
                variant.variant_name AS name,
                uom.symbol AS unit,
                product.is_sold_by_weight AS soldByWeight,
                price.tier_id AS tierId,
                price.min_quantity AS minQuantity,
                price.price_per_unit AS pricePerUnit
            FROM product_variants AS variant
            JOIN products AS product ON product.product_id = variant.product_id
            JOIN units_of_measure AS uom ON uom.uom_id = product.base_uom_id
            LEFT JOIN product_prices AS price ON price.variant_id = variant.variant_id
            WHERE product.name LIKE @query COLLATE NOCASE
               OR variant.variant_name LIKE @query COLLATE NOCASE
               OR variant.sku LIKE @query COLLATE NOCASE
               OR COALESCE(variant.barcode, '') LIKE @query COLLATE NOCASE
            ORDER BY variant.variant_name ASC
            LIMIT 40
        `).all({ query: searchTerm }) as VariantRow[];

        const products = new Map<string, CatalogProduct>();
        for (const row of rows) {
            const existing = products.get(row.variantId);
            if (existing) {
                if (row.tierId) {
                    existing.prices.push({ tierId: row.tierId, minQuantity: row.minQuantity, pricePerUnit: row.pricePerUnit });
                }
                continue;
            }
            products.set(row.variantId, {
                variantId: row.variantId,
                sku: row.sku,
                name: row.name,
                unit: row.unit,
                soldByWeight: row.soldByWeight === 1,
                prices: row.tierId ? [{ tierId: row.tierId, minQuantity: row.minQuantity, pricePerUnit: row.pricePerUnit }] : [],
            });
        }
        return [...products.values()];
    }

    public listCustomers(): CatalogCustomer[] {
        return this.database.prepare(`
            SELECT customer_id AS customerId,
                   COALESCE(company_name || ' - ', '') || contact_name AS displayName,
                   tier_id AS tierId
            FROM customers
            ORDER BY displayName ASC
        `).all() as CatalogCustomer[];
    }

    public createOrderWithOutbox(input: CreateOrderInput): { orderId: string } {
        this.validateInput(input);
        const createdAt = this.now().toISOString();
        const orderId = randomUUID();
        const persistedItems: Array<CreateOrderItemInput & { orderItemId: string; lotId: string | null }> = [];

        const saveOrder = this.database.transaction(() => {
            const customer = input.customerId
                ? this.database.prepare('SELECT tier_id AS tierId FROM customers WHERE customer_id = ?').get(input.customerId) as { tierId: string } | undefined
                : undefined;
            if (input.customerId && !customer) {
                throw new Error('Customer was not found');
            }
            if (customer && customer.tierId !== input.pricingTierId) {
                throw new Error('Customer pricing tier is out of date');
            }
            if (!this.database.prepare('SELECT 1 FROM price_tiers WHERE tier_id = ?').get(input.pricingTierId)) {
                throw new Error('Pricing tier was not found');
            }

            const orderItems = input.items.flatMap((item) => this.persistItem(item, input.pricingTierId, createdAt, persistedItems));
            const subtotal = cents(orderItems.reduce((total, item) => total + item.totalPrice, 0));
            const taxAmount = cents(subtotal * this.taxRate);
            const totalAmount = cents(subtotal + taxAmount);
            if (input.paymentMethod === 'cash' && input.cashReceived < totalAmount) {
                throw new Error('Cash received must be at least the order total');
            }

            this.database.prepare(`
                INSERT INTO orders (
                    order_id, customer_id, pricing_tier_id, order_type, status,
                    subtotal, tax_amount, total_amount, payment_method, cash_received, change_due, created_at, updated_at
                ) VALUES (?, ?, ?, ?, 'completed', ?, ?, ?, ?, ?, ?, ?, ?)
            `).run(orderId, input.customerId, input.pricingTierId, input.orderType, subtotal, taxAmount, totalAmount, input.paymentMethod, input.cashReceived, input.paymentMethod === 'cash' ? cents(input.cashReceived - totalAmount) : 0, createdAt, createdAt);

            const insertOrderItem = this.database.prepare(`
                INSERT INTO order_items (
                    order_item_id, order_id, variant_id, lot_id, quantity, unit_price, total_price
                ) VALUES (?, ?, ?, ?, ?, ?, ?)
            `);
            for (const item of orderItems) {
                const orderItemId = randomUUID();
                insertOrderItem.run(orderItemId, orderId, item.variantId, item.lotId, item.quantity, item.unitPrice, item.totalPrice);
                persistedItems.push({ ...item, orderItemId });
            }

            this.database.prepare(`
                INSERT INTO sync_queue (
                    queue_id, entity_type, entity_id, operation, payload,
                    status, retry_count, next_attempt_at, last_error, created_at, updated_at
                ) VALUES (?, 'orders', ?, 'create', ?, 'PENDING', 0, NULL, NULL, ?, ?)
            `).run(randomUUID(), orderId, JSON.stringify({
                orderId,
                customerId: input.customerId,
                pricingTierId: input.pricingTierId,
                orderType: input.orderType,
                paymentMethod: input.paymentMethod,
                cashReceived: input.cashReceived,
                changeDue: input.paymentMethod === 'cash' ? cents(input.cashReceived - totalAmount) : 0,
                subtotal,
                taxAmount,
                totalAmount,
                items: persistedItems,
            }), createdAt, createdAt);
        });

        saveOrder();
        return { orderId };
    }

    private persistItem(
        input: CreateOrderItemInput,
        pricingTierId: string,
        createdAt: string,
        persistedItems: Array<CreateOrderItemInput & { orderItemId: string; lotId: string | null }>,
    ): Array<CreateOrderItemInput & { lotId: string | null }> {
        const variant = this.database.prepare(`
            SELECT variant.variant_id AS variantId, product.requires_lot_tracking AS requiresLotTracking
            FROM product_variants AS variant
            JOIN products AS product ON product.product_id = variant.product_id
            WHERE variant.variant_id = ?
        `).get(input.variantId) as { variantId: string; requiresLotTracking: number } | undefined;
        if (!variant) {
            throw new Error('Product variant was not found');
        }

        const price = this.database.prepare(`
            SELECT price_per_unit AS pricePerUnit
            FROM product_prices
            WHERE variant_id = ? AND tier_id = ? AND min_quantity <= ?
            ORDER BY min_quantity DESC
            LIMIT 1
        `).get(input.variantId, pricingTierId, input.quantity) as { pricePerUnit: number } | undefined;
        if (!price) {
            throw new Error('No price is configured for this product and tier');
        }
        const unitPrice = cents(price.pricePerUnit);
        const expectedTotal = cents(input.quantity * unitPrice);
        if (Math.abs(unitPrice - input.unitPrice) > 0.005 || Math.abs(expectedTotal - input.totalPrice) > 0.005) {
            throw new Error('Checkout price changed; please review the cart');
        }

        if (!variant.requiresLotTracking) {
            return [{ ...input, quantity: quantity(input.quantity), unitPrice, totalPrice: expectedTotal, lotId: null }];
        }

        const lots = this.database.prepare(`
            SELECT lot_id AS lotId, quantity_on_hand AS quantityOnHand
            FROM inventory_lots
            WHERE variant_id = ? AND quantity_on_hand > 0
            ORDER BY expiration_date ASC, lot_id ASC
        `).all(input.variantId) as LotRow[];
        let remaining = quantity(input.quantity);
        const allocations: Array<CreateOrderItemInput & { lotId: string | null }> = [];
        for (const lot of lots) {
            if (remaining <= 0) {
                break;
            }
            const allocated = quantity(Math.min(remaining, lot.quantityOnHand));
            if (allocated <= 0) {
                continue;
            }
            this.database.prepare(`
                UPDATE inventory_lots
                SET quantity_on_hand = quantity_on_hand - ?, updated_at = ?
                WHERE lot_id = ? AND quantity_on_hand >= ?
            `).run(allocated, createdAt, lot.lotId, allocated);
            allocations.push({ variantId: input.variantId, quantity: allocated, unitPrice, totalPrice: cents(allocated * unitPrice), lotId: lot.lotId });
            remaining = quantity(remaining - allocated);
        }
        if (remaining > 0) {
            throw new Error('Insufficient lot-tracked inventory');
        }
        return allocations;
    }

    private validateInput(input: CreateOrderInput): void {
        if (!input.items.length) {
            throw new Error('An order requires at least one item');
        }
        if (!Number.isFinite(this.taxRate) || this.taxRate < 0) {
            throw new Error('Invalid tax configuration');
        }
        for (const item of input.items) {
            if (!Number.isFinite(item.quantity) || item.quantity <= 0 || quantity(item.quantity) !== item.quantity) {
                throw new Error('Invalid item quantity');
            }
        }
        if (!Number.isFinite(input.cashReceived) || input.cashReceived < 0 || Number(input.cashReceived.toFixed(2)) !== input.cashReceived) {
            throw new Error('Invalid cash received amount');
        }
    }
}
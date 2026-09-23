const express = require('express');

const MAX_BATCH_SIZE = 50;

function createSyncRouter(pool) {
    const router = express.Router();

    router.post('/sync/push', async (request, response, next) => {
        const items = request.body?.items;
        if (!Array.isArray(items) || items.length === 0 || items.length > MAX_BATCH_SIZE) {
            response.status(400).json({ error: `items must contain between 1 and ${MAX_BATCH_SIZE} records` });
            return;
        }

        let client;
        try {
            client = await pool.connect();
            await client.query('BEGIN');

            for (const item of items) {
                const syncItem = parseSyncItem(item);
                if (syncItem.entityType !== 'orders' || syncItem.operation !== 'create') {
                    throw new Error('Only order create events are supported by this endpoint');
                }

                await applyOrder(client, syncItem);
            }

            await client.query('COMMIT');
            response.status(200).json({ syncedQueueIds: items.map((item) => item.queue_id) });
        } catch (error) {
            if (client) {
                await client.query('ROLLBACK').catch(() => undefined);
            }
            next(error);
        } finally {
            client?.release();
        }
    });

    return router;
}

function parseSyncItem(item) {
    if (!item || typeof item !== 'object') {
        throw badRequest('Each sync item must be an object');
    }
    if (typeof item.queue_id !== 'string' || !item.queue_id) {
        throw badRequest('Each sync item requires queue_id');
    }
    if (typeof item.entity_type !== 'string' || typeof item.entity_id !== 'string') {
        throw badRequest('Each sync item requires entity_type and entity_id');
    }
    if (!['create', 'update', 'delete'].includes(item.operation)) {
        throw badRequest('Each sync item has an invalid operation');
    }

    let payload;
    try {
        payload = typeof item.payload === 'string' ? JSON.parse(item.payload) : item.payload;
    } catch {
        throw badRequest('Sync payload must be valid JSON');
    }
    if (!payload || typeof payload !== 'object') {
        throw badRequest('Sync payload must be an object');
    }

    return {
        queueId: item.queue_id,
        entityType: item.entity_type,
        entityId: item.entity_id,
        operation: item.operation,
        payload,
    };
}

async function applyOrder(client, syncItem) {
    const payload = syncItem.payload;
    const orderId = payload.orderId || syncItem.entityId;
    if (orderId !== syncItem.entityId || typeof orderId !== 'string') {
        throw badRequest('Order payload ID does not match entity_id');
    }
    if (!Array.isArray(payload.items) || payload.items.length === 0) {
        throw badRequest('Order payload requires items');
    }

    const orderResult = await client.query({
        text: `
            INSERT INTO orders (
                order_id, customer_id, pricing_tier_id, order_type, status,
                subtotal, tax_amount, total_amount, created_at
            ) VALUES ($1, $2, $3, $4, 'completed', $5, $6, $7, $8)
            ON CONFLICT (order_id) DO NOTHING
            RETURNING order_id
        `,
        values: [
            orderId,
            payload.customerId || null,
            requireString(payload.pricingTierId, 'pricingTierId'),
            payload.orderType === 'commercial' ? 'commercial' : 'retail',
            requireMoney(payload.subtotal, 'subtotal'),
            requireMoney(payload.taxAmount, 'taxAmount'),
            requireMoney(payload.totalAmount, 'totalAmount'),
            payload.createdAt || new Date().toISOString(),
        ],
    });

    if (orderResult.rowCount === 0) {
        return;
    }

    for (const item of payload.items) {
        const variantId = requireString(item.variantId, 'variantId');
        const itemQuantity = requireQuantity(item.quantity, 'quantity');
        const unitPrice = requireMoney(item.unitPrice, 'unitPrice');
        const totalPrice = requireMoney(item.totalPrice, 'totalPrice');
        const orderItemId = requireString(item.orderItemId, 'orderItemId');
        const itemResult = await client.query({
            text: `
                INSERT INTO order_items (
                    order_item_id, order_id, variant_id, lot_id, quantity, unit_price, total_price
                ) VALUES ($1, $2, $3, $4, $5, $6, $7)
                ON CONFLICT (order_item_id) DO NOTHING
                RETURNING order_item_id
            `,
            values: [orderItemId, orderId, variantId, item.lotId || null, itemQuantity, unitPrice, totalPrice],
        });

        if (itemResult.rowCount === 0) {
            continue;
        }

        if (item.lotId) {
            const inventoryResult = await client.query({
                text: `
                    UPDATE inventory_lots
                    SET quantity_on_hand = quantity_on_hand - $1
                    WHERE lot_id = $2
                      AND variant_id = $3
                      AND quantity_on_hand >= $1
                `,
                values: [itemQuantity, item.lotId, variantId],
            });
            if (inventoryResult.rowCount !== 1) {
                throw new Error(`Insufficient inventory for lot ${item.lotId}`);
            }
        }
    }
}

function requireString(value, fieldName) {
    if (typeof value !== 'string' || value.length === 0) {
        throw badRequest(`${fieldName} must be a non-empty string`);
    }
    return value;
}

function requireMoney(value, fieldName) {
    if (typeof value !== 'number' || !Number.isFinite(value) || value < 0) {
        throw badRequest(`${fieldName} must be a non-negative number`);
    }
    return value;
}

function requireQuantity(value, fieldName) {
    if (typeof value !== 'number' || !Number.isFinite(value) || value <= 0) {
        throw badRequest(`${fieldName} must be a positive number`);
    }
    return value;
}

function badRequest(message) {
    const error = new Error(message);
    error.statusCode = 400;
    return error;
}

module.exports = { createSyncRouter };
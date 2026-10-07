const { z } = require('zod');

// Auth schemas
const loginSchema = z.object({
  username: z.string().min(1, 'Username is required'),
  password: z.string().min(1, 'Password is required'),
});

// Customer schemas
const customerSchema = z.object({
  contactName: z.string().min(1, 'Contact name is required'),
  companyName: z.string().optional().nullable(),
  email: z.string().email().optional().nullable(),
  phone: z.string().optional().nullable(),
  tierId: z.string().uuid('Tier ID must be a valid UUID'),
});

// Employee schemas
const employeeSchema = z.object({
  username: z.string().min(1, 'Username is required').toLowerCase(),
  displayName: z.string().min(1, 'Display name is required'),
  role: z.enum(['admin', 'cashier']),
  password: z.string().min(12, 'Password must be at least 12 characters'),
});

// Inventory schemas
const inventoryAdjustSchema = z.object({
  variantId: z.string().uuid('Variant ID must be a valid UUID'),
  quantity: z.number().nonnegative('Quantity must be non-negative'),
  lotNumber: z.string().optional(),
  expirationDate: z.string().optional().nullable(),
  retailPrice: z.number().nonnegative('Retail price must be non-negative').optional(),
});

const inventoryProductSchema = z.object({
  name: z.string().min(1, 'Product name is required'),
  sku: z.string().min(1, 'SKU is required'),
  variantName: z.string().min(1, 'Variant name is required'),
  baseUomId: z.string().uuid('Base UOM ID must be a valid UUID'),
  quantity: z.number().nonnegative('Quantity must be non-negative'),
  retailPrice: z.number().nonnegative('Retail price must be non-negative'),
  lotNumber: z.string().min(1, 'Lot number is required'),
  initialCost: z.number().nonnegative('Initial cost must be non-negative').optional(),
  expirationDate: z.string().optional().nullable(),
  barcode: z.string().optional().nullable(),
  soldByWeight: z.boolean().optional().default(false),
  requiresLotTracking: z.boolean().optional().default(false),
});

const inventoryUpdateSchema = z.object({
  variantName: z.string().min(1, 'Variant name is required').optional(),
  sku: z.string().min(1, 'SKU is required').optional(),
  retailPrice: z.number().nonnegative('Retail price must be non-negative').optional(),
  initialCost: z.number().nonnegative('Initial cost must be non-negative').optional(),
  quantity: z.number().nonnegative('Quantity must be non-negative').optional(),
  lotNumber: z.string().optional(),
  expirationDate: z.string().optional().nullable(),
});

// Order schemas
const orderItemSchema = z.object({
  orderItemId: z.string().uuid('Order item ID must be a valid UUID'),
  variantId: z.string().uuid('Variant ID must be a valid UUID'),
  lotId: z.string().uuid('Lot ID must be a valid UUID').optional().nullable(),
  quantity: z.number().positive('Quantity must be positive'),
  unitPrice: z.number().nonnegative('Unit price must be non-negative'),
  totalPrice: z.number().nonnegative('Total price must be non-negative'),
});

const orderPayloadSchema = z.object({
  orderId: z.string().uuid('Order ID must be a valid UUID'),
  customerId: z.string().uuid('Customer ID must be a valid UUID').optional().nullable(),
  pricingTierId: z.string().uuid('Pricing tier ID must be a valid UUID'),
  orderType: z.enum(['retail', 'commercial']),
  items: z.array(orderItemSchema).min(1, 'Order must have at least one item'),
  subtotal: z.number().nonnegative('Subtotal must be non-negative'),
  taxAmount: z.number().nonnegative('Tax amount must be non-negative').optional(),
  totalAmount: z.number().nonnegative('Total amount must be non-negative'),
  paymentMethod: z.enum(['cash', 'card', 'gcash', 'account', 'split', 'exchange']),
  cashReceived: z.number().nonnegative('Cash received must be non-negative').optional(),
  payments: z.array(z.object({
    method: z.enum(['cash', 'card', 'gcash', 'account', 'exchange']),
    amount: z.number().nonnegative(),
    cashReceived: z.number().nonnegative().optional(),
  })).optional(),
  returnedItems: z.array(z.object({
    orderItemId: z.string().uuid(),
    variantId: z.string().uuid(),
    lotId: z.string().uuid().optional().nullable(),
    quantity: z.number().positive(),
    restock: z.boolean(),
  })).optional(),
  createdAt: z.string().optional(),
});

// Search schema
const searchSchema = z.object({
  q: z.string().optional().default(''),
});

// Date schema
const dateSchema = z.object({
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Date must be in YYYY-MM-DD format').optional(),
});

// Validation helper
function validate(schema, data) {
  try {
    return { success: true, data: schema.parse(data) };
  } catch (error) {
    return { success: false, errors: error.errors };
  }
}

module.exports = {
  loginSchema,
  customerSchema,
  employeeSchema,
  inventoryAdjustSchema,
  inventoryProductSchema,
  inventoryUpdateSchema,
  orderPayloadSchema,
  searchSchema,
  dateSchema,
  validate,
};

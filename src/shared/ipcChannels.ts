export const scaleIpcChannels = {
    read: 'scale:read',
    reading: 'scale:reading',
    status: 'scale:status',
    connect: 'scale:connect',
    disconnect: 'scale:disconnect',
} as const;

export const checkoutIpcChannels = {
    searchProducts: 'checkout:search-products',
    listCustomers: 'checkout:list-customers',
    createOrderWithOutbox: 'checkout:create-order-with-outbox',
} as const;

export const authIpcChannels = {
    login: 'auth:login',
    logout: 'auth:logout',
} as const;

export const inventoryIpcChannels = {
    import: 'inventory:import',
} as const;
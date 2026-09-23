export const scaleIpcChannels = {
    read: 'scale:read',
    status: 'scale:status',
    connect: 'scale:connect',
    disconnect: 'scale:disconnect',
} as const;

export const checkoutIpcChannels = {
    searchProducts: 'checkout:search-products',
    createOrderWithOutbox: 'checkout:create-order-with-outbox',
} as const;
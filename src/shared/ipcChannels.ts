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
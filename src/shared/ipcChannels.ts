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
    list: 'inventory:list',
    import: 'inventory:import',
} as const;

export const salesIpcChannels = {
    report: 'sales:report',
} as const;

export const crmIpcChannels = {
    list: 'crm:list-customers',
    addTag: 'crm:add-tag',
} as const;

export const employeeIpcChannels = {
    list: 'employees:list',
    clockIn: 'employees:clock-in',
    clockOut: 'employees:clock-out',
    recordSale: 'employees:record-sale',
} as const;
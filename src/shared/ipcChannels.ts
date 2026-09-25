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
    importStockTake: 'inventory:import-stock-take',
} as const;

export const salesIpcChannels = {
    report: 'sales:report',
} as const;

export const crmIpcChannels = {
    list: 'crm:list-customers',
    addTag: 'crm:add-tag',
    create: 'crm:create-customer',
    delete: 'crm:delete-customer',
} as const;

export const employeeIpcChannels = {
    list: 'employees:list',
    clockIn: 'employees:clock-in',
    clockOut: 'employees:clock-out',
    recordSale: 'employees:record-sale',
    shifts: 'employees:shifts',
    create: 'employees:create',
} as const;
import { contextBridge, ipcRenderer } from 'electron';
import type { CheckoutCustomer, CheckoutDataSource, CheckoutProduct, CheckoutScaleReading } from './components/CheckoutScreen';
import type { CatalogCustomer, CreateOrderInput } from './main/checkout/checkoutService';
import type { InventoryRow } from './main/inventory/inventoryImportService';
import type { SalesReport } from './main/sales/salesReportService';
import type { CreateCustomerInput, CrmCustomer } from './main/crm/crmService';
import type { CreateEmployeeInput, EmployeeSummary, ShiftSummary } from './main/employees/employeeService';
import { authIpcChannels, checkoutIpcChannels, crmIpcChannels, employeeIpcChannels, inventoryIpcChannels, salesIpcChannels, scaleIpcChannels } from './shared/ipcChannels';

export interface BakeAlleyCheckoutBridge extends CheckoutDataSource {
    getCustomers: () => Promise<CheckoutCustomer[]>;
    scale: {
        read: () => Promise<CheckoutScaleReading | null>;
        onReading: (listener: (reading: CheckoutScaleReading) => void) => () => void;
    };
    auth: {
        login: (username: string, password: string) => Promise<{ token: string; user: { userId: string; username: string; displayName: string; role: 'admin' | 'cashier' } }>;
        logout: (token: string) => Promise<void>;
    };
    inventory: {
        list: (token: string) => Promise<InventoryRow[]>;
        import: (token: string, fileBytes: Uint8Array, fileName: string) => Promise<{ importedRows: number; createdLots: number; updatedLots: number }>;
    };
    sales: {
        report: (token: string, selectedDate: string, markupPercent: number) => Promise<SalesReport>;
    };
    crm: { listCustomers: (token: string) => Promise<CrmCustomer[]>; addTag: (token: string, customerId: string, tag: string) => Promise<void>; createCustomer: (token: string, input: CreateCustomerInput) => Promise<{ customerId: string }>; deleteCustomer: (token: string, customerId: string) => Promise<void> };
    employees: { list: (token: string, date?: string) => Promise<EmployeeSummary[]>; clockIn: (token: string) => Promise<void>; clockOut: (token: string) => Promise<void>; recordSale: (token: string, orderId: string) => Promise<void>; shifts: (token: string, date: string) => Promise<ShiftSummary[]>; create: (token: string, input: CreateEmployeeInput) => Promise<{ userId: string }> };
}

const checkoutBridge: BakeAlleyCheckoutBridge = {
    searchProducts: (query: string): Promise<CheckoutProduct[]> => ipcRenderer.invoke(checkoutIpcChannels.searchProducts, query),
    getCustomers: (): Promise<CatalogCustomer[]> => ipcRenderer.invoke(checkoutIpcChannels.listCustomers),
    createOrderWithOutbox: (order: CreateOrderInput): Promise<{ orderId: string }> => ipcRenderer.invoke(checkoutIpcChannels.createOrderWithOutbox, order),
    scale: {
        read: (): Promise<CheckoutScaleReading | null> => ipcRenderer.invoke(scaleIpcChannels.read),
        onReading: (listener: (reading: CheckoutScaleReading) => void): (() => void) => {
            const handler = (_event: Electron.IpcRendererEvent, reading: CheckoutScaleReading): void => listener(reading);
            ipcRenderer.on(scaleIpcChannels.reading, handler);
            return () => ipcRenderer.removeListener(scaleIpcChannels.reading, handler);
        },
    },
    auth: {
        login: (username, password) => ipcRenderer.invoke(authIpcChannels.login, username, password),
        logout: (token) => ipcRenderer.invoke(authIpcChannels.logout, token),
    },
    inventory: {
        list: (token) => ipcRenderer.invoke(inventoryIpcChannels.list, token),
        import: (token, fileBytes, fileName) => ipcRenderer.invoke(inventoryIpcChannels.import, token, fileBytes, fileName),
    },
    sales: {
        report: (token, selectedDate, markupPercent) => ipcRenderer.invoke(salesIpcChannels.report, token, selectedDate, markupPercent),
    },
    crm: {
        listCustomers: (token) => ipcRenderer.invoke(crmIpcChannels.list, token),
        addTag: (token, customerId, tag) => ipcRenderer.invoke(crmIpcChannels.addTag, token, customerId, tag),
        createCustomer: (token, input) => ipcRenderer.invoke(crmIpcChannels.create, token, input),
        deleteCustomer: (token, customerId) => ipcRenderer.invoke(crmIpcChannels.delete, token, customerId),
    },
    employees: {
        list: (token, date) => ipcRenderer.invoke(employeeIpcChannels.list, token, date),
        clockIn: (token) => ipcRenderer.invoke(employeeIpcChannels.clockIn, token),
        clockOut: (token) => ipcRenderer.invoke(employeeIpcChannels.clockOut, token),
        recordSale: (token, orderId) => ipcRenderer.invoke(employeeIpcChannels.recordSale, token, orderId),
        shifts: (token, date) => ipcRenderer.invoke(employeeIpcChannels.shifts, token, date),
        create: (token, input) => ipcRenderer.invoke(employeeIpcChannels.create, token, input),
    },
};

contextBridge.exposeInMainWorld('bakeAlleyCheckout', checkoutBridge);
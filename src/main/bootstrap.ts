import type { IpcMain } from 'electron';
import Database from 'better-sqlite3';
import { CheckoutService, type CheckoutServiceOptions } from './checkout/checkoutService';
import { registerCheckoutIpcHandlers } from './checkout/checkoutIpc';
import { registerScaleIpcHandlers, type ScaleService } from './hardware/scale';
import { AuthService } from './auth/authService';
import { registerAuthIpcHandlers } from './auth/authIpc';
import { InventoryImportService } from './inventory/inventoryImportService';
import { registerInventoryIpcHandlers } from './inventory/inventoryIpc';
import { SalesReportService } from './sales/salesReportService';
import { registerSalesIpcHandlers } from './sales/salesIpc';

export interface MainProcessServicesOptions extends Omit<CheckoutServiceOptions, 'database'> {
    ipcMain: Pick<IpcMain, 'handle' | 'removeHandler'>;
    database: Database.Database;
    scaleService: ScaleService;
}

export function registerMainProcessServices(options: MainProcessServicesOptions): CheckoutService {
    const authService = new AuthService(options.database);
    const inventoryImportService = new InventoryImportService(options.database, authService);
    const salesReportService = new SalesReportService(options.database, authService);
    const checkoutService = new CheckoutService({
        database: options.database,
        taxRate: options.taxRate,
        now: options.now,
    });
    registerCheckoutIpcHandlers(options.ipcMain, checkoutService);
    registerScaleIpcHandlers(options.ipcMain, options.scaleService);
    registerAuthIpcHandlers(options.ipcMain, authService);
    registerInventoryIpcHandlers(options.ipcMain, inventoryImportService);
    registerSalesIpcHandlers(options.ipcMain, salesReportService);
    return checkoutService;
}
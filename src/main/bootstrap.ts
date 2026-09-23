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
import { CrmService } from './crm/crmService';
import { registerCrmIpcHandlers } from './crm/crmIpc';
import { EmployeeService } from './employees/employeeService';
import { registerEmployeeIpcHandlers } from './employees/employeeIpc';

export interface MainProcessServicesOptions extends Omit<CheckoutServiceOptions, 'database'> {
    ipcMain: Pick<IpcMain, 'handle' | 'removeHandler'>;
    database: Database.Database;
    scaleService: ScaleService;
}

export function registerMainProcessServices(options: MainProcessServicesOptions): CheckoutService {
    const authService = new AuthService(options.database);
    const inventoryImportService = new InventoryImportService(options.database, authService);
    const salesReportService = new SalesReportService(options.database, authService);
    const crmService = new CrmService(options.database, authService);
    const employeeService = new EmployeeService(options.database, authService);
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
    registerCrmIpcHandlers(options.ipcMain, crmService);
    registerEmployeeIpcHandlers(options.ipcMain, employeeService);
    return checkoutService;
}
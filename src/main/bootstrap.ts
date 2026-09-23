import type { IpcMain } from 'electron';
import Database from 'better-sqlite3';
import { CheckoutService, type CheckoutServiceOptions } from './checkout/checkoutService';
import { registerCheckoutIpcHandlers } from './checkout/checkoutIpc';
import { registerScaleIpcHandlers, type ScaleService } from './hardware/scale';

export interface MainProcessServicesOptions extends Omit<CheckoutServiceOptions, 'database'> {
    ipcMain: Pick<IpcMain, 'handle' | 'removeHandler'>;
    database: Database.Database;
    scaleService: ScaleService;
}

export function registerMainProcessServices(options: MainProcessServicesOptions): CheckoutService {
    const checkoutService = new CheckoutService({
        database: options.database,
        taxRate: options.taxRate,
        now: options.now,
    });
    registerCheckoutIpcHandlers(options.ipcMain, checkoutService);
    registerScaleIpcHandlers(options.ipcMain, options.scaleService);
    return checkoutService;
}
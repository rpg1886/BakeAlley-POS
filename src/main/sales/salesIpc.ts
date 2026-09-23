import type { IpcMain } from 'electron';
import type { SalesReportService } from './salesReportService';
import { salesIpcChannels } from '../../shared/ipcChannels';

export function registerSalesIpcHandlers(ipcMain: Pick<IpcMain, 'handle' | 'removeHandler'>, service: SalesReportService): void {
    ipcMain.removeHandler(salesIpcChannels.report);
    ipcMain.handle(salesIpcChannels.report, (_event, token: unknown, selectedDate: unknown, markupPercent: unknown) => {
        if (typeof token !== 'string' || typeof selectedDate !== 'string' || typeof markupPercent !== 'number') {
            throw new Error('Invalid sales report request');
        }
        return service.getReport(token, selectedDate, markupPercent);
    });
}
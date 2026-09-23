import type { IpcMain } from 'electron';
import type { CrmService } from './crmService';
import { crmIpcChannels } from '../../shared/ipcChannels';

export function registerCrmIpcHandlers(ipcMain: Pick<IpcMain, 'handle' | 'removeHandler'>, service: CrmService): void {
    ipcMain.removeHandler(crmIpcChannels.list);
    ipcMain.removeHandler(crmIpcChannels.addTag);
    ipcMain.handle(crmIpcChannels.list, (_event, token: unknown) => {
        if (typeof token !== 'string') throw new Error('Authentication token is required');
        return service.listCustomers(token);
    });
    ipcMain.handle(crmIpcChannels.addTag, (_event, token: unknown, customerId: unknown, tag: unknown) => {
        if (typeof token !== 'string' || typeof customerId !== 'string' || typeof tag !== 'string') throw new Error('Invalid CRM tag request');
        return service.addTag(token, customerId, tag);
    });
}

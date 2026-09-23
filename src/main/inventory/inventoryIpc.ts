import type { IpcMain } from 'electron';
import type { InventoryImportService } from './inventoryImportService';
import { inventoryIpcChannels } from '../../shared/ipcChannels';

export function registerInventoryIpcHandlers(ipcMain: Pick<IpcMain, 'handle' | 'removeHandler'>, service: InventoryImportService): void {
    ipcMain.removeHandler(inventoryIpcChannels.list);
    ipcMain.removeHandler(inventoryIpcChannels.import);
    ipcMain.handle(inventoryIpcChannels.list, (_event, token: unknown) => {
        if (typeof token !== 'string') {
            throw new Error('Authentication token is required');
        }
        return service.listInventory(token);
    });
    ipcMain.handle(inventoryIpcChannels.import, (_event, token: unknown, fileBytes: unknown, fileName: unknown) => {
        if (typeof token !== 'string' || typeof fileName !== 'string' || !(fileBytes instanceof Uint8Array)) {
            throw new Error('Invalid inventory import request');
        }
        return service.importWorkbook(token, fileBytes, fileName);
    });
}
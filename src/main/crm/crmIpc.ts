import type { IpcMain } from 'electron';
import type { CreateCustomerInput, CrmService } from './crmService';
import { crmIpcChannels } from '../../shared/ipcChannels';

export function registerCrmIpcHandlers(ipcMain: Pick<IpcMain, 'handle' | 'removeHandler'>, service: CrmService): void {
    ipcMain.removeHandler(crmIpcChannels.list);
    ipcMain.removeHandler(crmIpcChannels.addTag);
    ipcMain.removeHandler(crmIpcChannels.create);
    ipcMain.removeHandler(crmIpcChannels.delete);
    ipcMain.handle(crmIpcChannels.list, (_event, token: unknown) => {
        if (typeof token !== 'string') throw new Error('Authentication token is required');
        return service.listCustomers(token);
    });
    ipcMain.handle(crmIpcChannels.addTag, (_event, token: unknown, customerId: unknown, tag: unknown) => {
        if (typeof token !== 'string' || typeof customerId !== 'string' || typeof tag !== 'string') throw new Error('Invalid CRM tag request');
        return service.addTag(token, customerId, tag);
    });
    ipcMain.handle(crmIpcChannels.create, (_event, token: unknown, input: unknown) => {
        if (typeof token !== 'string' || typeof input !== 'object' || input === null) throw new Error('Invalid customer request');
        const customer = input as Partial<CreateCustomerInput>;
        if (typeof customer.contactName !== 'string' || typeof customer.tierId !== 'string') throw new Error('Contact name and pricing tier are required');
        return service.createCustomer(token, { companyName: typeof customer.companyName === 'string' ? customer.companyName : null, contactName: customer.contactName, email: typeof customer.email === 'string' ? customer.email : null, phone: typeof customer.phone === 'string' ? customer.phone : null, tierId: customer.tierId });
    });
    ipcMain.handle(crmIpcChannels.delete, (_event, token: unknown, customerId: unknown) => {
        if (typeof token !== 'string' || typeof customerId !== 'string') throw new Error('Invalid customer delete request');
        return service.deleteCustomer(token, customerId);
    });
}

import type { IpcMain } from 'electron';
import type { CheckoutService, CreateOrderInput } from './checkoutService';
import { checkoutIpcChannels } from '../../shared/ipcChannels';

export { checkoutIpcChannels } from '../../shared/ipcChannels';

export function registerCheckoutIpcHandlers(ipcMain: Pick<IpcMain, 'handle' | 'removeHandler'>, service: CheckoutService): void {
    ipcMain.removeHandler(checkoutIpcChannels.searchProducts);
    ipcMain.removeHandler(checkoutIpcChannels.createOrderWithOutbox);

    ipcMain.handle(checkoutIpcChannels.searchProducts, (_event, query: unknown) => {
        if (typeof query !== 'string') {
            throw new Error('Product search query must be a string');
        }
        return service.searchProducts(query);
    });
    ipcMain.handle(checkoutIpcChannels.createOrderWithOutbox, (_event, input: unknown) => {
        if (!isCreateOrderInput(input)) {
            throw new Error('Invalid checkout order');
        }
        return service.createOrderWithOutbox(input);
    });
}

function isCreateOrderInput(input: unknown): input is CreateOrderInput {
    if (typeof input !== 'object' || input === null) {
        return false;
    }
    const candidate = input as Partial<CreateOrderInput>;
    return (candidate.customerId === null || typeof candidate.customerId === 'string')
        && typeof candidate.pricingTierId === 'string'
        && (candidate.orderType === 'retail' || candidate.orderType === 'commercial')
        && Array.isArray(candidate.items)
        && candidate.items.every((item) => typeof item === 'object' && item !== null)
        && typeof candidate.subtotal === 'number'
        && typeof candidate.taxAmount === 'number'
        && typeof candidate.totalAmount === 'number'
        && (candidate.paymentMethod === 'cash' || candidate.paymentMethod === 'card' || candidate.paymentMethod === 'account');
}
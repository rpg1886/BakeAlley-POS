import { contextBridge, ipcRenderer } from 'electron';
import type { CheckoutDataSource, CheckoutProduct, CheckoutScaleReading } from './components/CheckoutScreen';
import type { CreateOrderInput } from './main/checkout/checkoutService';
import { checkoutIpcChannels, scaleIpcChannels } from './shared/ipcChannels';

export interface BakeAlleyCheckoutBridge extends CheckoutDataSource {
    scale: {
        read: () => Promise<CheckoutScaleReading | null>;
    };
}

const checkoutBridge: BakeAlleyCheckoutBridge = {
    searchProducts: (query: string): Promise<CheckoutProduct[]> => ipcRenderer.invoke(checkoutIpcChannels.searchProducts, query),
    createOrderWithOutbox: (order: CreateOrderInput): Promise<{ orderId: string }> => ipcRenderer.invoke(checkoutIpcChannels.createOrderWithOutbox, order),
    scale: {
        read: (): Promise<CheckoutScaleReading | null> => ipcRenderer.invoke(scaleIpcChannels.read),
    },
};

contextBridge.exposeInMainWorld('bakeAlleyCheckout', checkoutBridge);
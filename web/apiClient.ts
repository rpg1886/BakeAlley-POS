export interface CloudApiClientOptions {
    baseUrl: string;
    getToken: () => string | null;
}

export interface CloudProduct {
    variantId: string;
    sku: string;
    name: string;
    unit: string;
    soldByWeight: boolean;
    prices: Array<{ tierId: string; minQuantity: number; pricePerUnit: number }>;
}

export interface CloudOrderPayload {
    orderId: string;
    customerId: string | null;
    pricingTierId: string;
    orderType: 'retail' | 'commercial';
    items: Array<{ orderItemId: string; variantId: string; lotId?: string; quantity: number; unitPrice: number; totalPrice: number }>;
    subtotal: number;
    taxAmount: number;
    totalAmount: number;
    paymentMethod: 'cash' | 'card' | 'account';
    cashReceived: number;
    changeDue: number;
}

export interface CloudCustomer { customerId: string; displayName: string; email?: string; phone?: string; tierId: string; }
export interface CloudInventoryRow { variantId: string; sku: string; variantName: string; expirationDate?: string | null; quantityOnHand: number; initialCapital: number; retailPrice: number; }
export interface CloudEmployee { userId: string; username: string; displayName: string; role: 'admin' | 'cashier'; active: boolean; salesCount: number; salesAmount: number; }
export interface CloudShift { shiftId: string; userId: string; displayName: string; clockIn: string; clockOut?: string; }
export interface CloudSalesPeriod { startDate: string; endDate: string; grossTotal: number; netTotal: number; orderCount: number; }
export interface CloudSalesReport { selectedDate: string; items: Array<{ orderId: string; soldAt: string; customerName: string; sku: string; itemName: string; quantity: number; amount: number; paymentMethod: string }>; dayGrossTotal: number; dayNetTotal: number; dayOrderCount: number; week?: CloudSalesPeriod; month?: CloudSalesPeriod; year?: CloudSalesPeriod; }

export class CloudApiClient {
    public constructor(protected readonly options: CloudApiClientOptions) {}

    protected apiUrl(path: string): string {
        return `${this.options.baseUrl}${path}`;
    }

    public async searchProducts(query: string): Promise<CloudProduct[]> {
        return this.request(`/api/v1/products/search?q=${encodeURIComponent(query)}`);
    }

    public async customers(): Promise<CloudCustomer[]> {
        return this.request('/api/v1/customers');
    }

    public async createCustomer(customer: { companyName?: string; contactName: string; email?: string; phone?: string; tierId: string }): Promise<CloudCustomer> {
        return this.request('/api/v1/customers', { method: 'POST', body: JSON.stringify(customer) });
    }

    public async deleteCustomer(customerId: string): Promise<void> {
        await this.request(`/api/v1/customers/${customerId}`, { method: 'DELETE' });
    }

    public async inventory(): Promise<CloudInventoryRow[]> {
        return this.request('/api/v1/inventory');
    }
    public async adjustInventory(adjustment: { variantId: string; expirationDate?: string; quantity: number; retailPrice?: number }): Promise<void> {
        await this.request('/api/v1/inventory/adjust', { method: 'POST', body: JSON.stringify(adjustment) });
    }
    public async createInventoryProduct(product: { name: string; sku: string; variantName: string; baseUomId: string; lotNumber: string; expirationDate?: string; quantity: number; retailPrice: number; initialCost?: number; barcode?: string; soldByWeight?: boolean; requiresLotTracking?: boolean }): Promise<void> {
        await this.request('/api/v1/inventory/products', { method: 'POST', body: JSON.stringify(product) });
    }

    public async employees(): Promise<CloudEmployee[]> { return this.request('/api/v1/employees'); }
    public async createEmployee(employee: { username: string; displayName: string; role: 'admin' | 'cashier'; password: string }): Promise<CloudEmployee> {
        return this.request('/api/v1/employees', { method: 'POST', body: JSON.stringify(employee) });
    }
    public async shifts(date?: string): Promise<CloudShift[]> { return this.request(`/api/v1/employees/shifts${date ? `?date=${encodeURIComponent(date)}` : ''}`); }
    public async clockIn(): Promise<CloudShift> { return this.request('/api/v1/employees/clock-in', { method: 'POST' }); }
    public async clockOut(): Promise<CloudShift> { return this.request('/api/v1/employees/clock-out', { method: 'POST' }); }

    public async createOrder(order: CloudOrderPayload): Promise<{ orderId: string }> {
        return this.request('/api/v1/orders', { method: 'POST', body: JSON.stringify(order) });
    }

    public async salesReport(date: string): Promise<CloudSalesReport> {
        return this.request(`/api/v1/sales/report?date=${encodeURIComponent(date)}`);
    }

    private async request(path: string, init: RequestInit = {}): Promise<any> {
        const token = this.options.getToken();
        const response = await fetch(`${this.options.baseUrl}${path}`, {
            ...init,
            headers: { 'content-type': 'application/json', ...(token ? { authorization: `Bearer ${token}` } : {}), ...init.headers },
        });
        if (!response.ok) {
            const body = await response.json().catch(() => ({}));
            throw new Error(body.error ?? `Cloud API request failed with HTTP ${response.status}`);
        }
        return response.status === 204 ? undefined : response.json();
    }
}

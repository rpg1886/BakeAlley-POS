import { useEffect, useRef, useState } from 'react';
import type { JSX } from 'react';
import type { SalesReport } from '../main/sales/salesReportService';
import type { CrmCustomer } from '../main/crm/crmService';
import type { EmployeeSummary } from '../main/employees/employeeService';
import logoUrl from '../../Images/bakeAlley-Logo.jpg';

export interface CheckoutProductPrice {
    tierId: string;
    minQuantity: number;
    pricePerUnit: number;
}

export interface CheckoutProduct {
    variantId: string;
    sku: string;
    name: string;
    unit: string;
    soldByWeight: boolean;
    prices: CheckoutProductPrice[];
}

export interface CheckoutCustomer {
    customerId: string;
    displayName: string;
    tierId: string;
}

export interface CheckoutScaleReading {
    grams: number;
    stable: boolean;
}

export interface CheckoutOrderItem {
    variantId: string;
    quantity: number;
    unitPrice: number;
    totalPrice: number;
}

export interface CheckoutOrderPayload {
    customerId: string | null;
    pricingTierId: string;
    orderType: 'retail' | 'commercial';
    items: CheckoutOrderItem[];
    subtotal: number;
    taxAmount: number;
    totalAmount: number;
    paymentMethod: 'cash' | 'card' | 'account';
    cashReceived: number;
}

export interface CheckoutDataSource {
    searchProducts: (query: string) => Promise<CheckoutProduct[]>;
    createOrderWithOutbox: (order: CheckoutOrderPayload) => Promise<{ orderId: string }>;
}

export interface CheckoutScaleSource {
    read: () => Promise<CheckoutScaleReading | null>;
}

export interface CheckoutScreenProps {
    dataSource: CheckoutDataSource;
    scaleSource?: CheckoutScaleSource;
    scaleEnabled?: boolean;
    customers: CheckoutCustomer[];
    retailTierId: string;
    taxRate?: number;
    employeeToken?: string;
    recordEmployeeSale?: (token: string, orderId: string) => Promise<void>;
}

interface CartLine {
    lineId: string;
    product: CheckoutProduct;
    quantity: number;
    unitPrice: number;
}

const money = new Intl.NumberFormat('en-PH', { style: 'currency', currency: 'PHP', minimumFractionDigits: 2, maximumFractionDigits: 2 });

function resolvePrice(product: CheckoutProduct, tierId: string, quantity: number): number {
    const matchingPrices = product.prices
        .filter((price) => price.tierId === tierId && price.minQuantity <= quantity)
        .sort((left, right) => right.minQuantity - left.minQuantity);
    return matchingPrices[0]?.pricePerUnit ?? 0;
}

function formatWeight(grams: number): string {
    return grams >= 1_000 ? `${(grams / 1_000).toFixed(3)} kg` : `${grams.toFixed(0)} g`;
}

export function CheckoutScreen({
    dataSource,
    scaleSource,
    scaleEnabled = true,
    customers,
    retailTierId,
    taxRate = 0,
    employeeToken,
    recordEmployeeSale,
}: CheckoutScreenProps): JSX.Element {
    const [query, setQuery] = useState('');
    const [results, setResults] = useState<CheckoutProduct[]>([]);
    const [cart, setCart] = useState<CartLine[]>([]);
    const [customerId, setCustomerId] = useState<string | null>(null);
    const [scaleReading, setScaleReading] = useState<CheckoutScaleReading | null>(null);
    const [paymentOpen, setPaymentOpen] = useState(false);
    const [paymentMethod, setPaymentMethod] = useState<CheckoutOrderPayload['paymentMethod']>('cash');
    const [cashReceived, setCashReceived] = useState('');
    const [busy, setBusy] = useState(false);
    const [message, setMessage] = useState<string | null>(null);
    const [paymentError, setPaymentError] = useState<string | null>(null);
    const searchInputRef = useRef<HTMLInputElement>(null);

    const selectedCustomer = customers.find((customer) => customer.customerId === customerId) ?? null;
    const pricingTierId = selectedCustomer?.tierId ?? retailTierId;
    const subtotal = cart.reduce((total, line) => total + line.quantity * line.unitPrice, 0);
    const taxAmount = subtotal * taxRate;
    const totalAmount = subtotal + taxAmount;
    const cashTendered = Number(cashReceived);
    const changeDue = paymentMethod === 'cash' && Number.isFinite(cashTendered) ? cashTendered - totalAmount : 0;
    const activeWeightLine = scaleEnabled ? cart.find((line) => line.product.soldByWeight) : undefined;

    const orderItems = cart.map((line) => ({
        variantId: line.product.variantId,
        quantity: line.quantity,
        unitPrice: line.unitPrice,
        totalPrice: line.quantity * line.unitPrice,
    }));

    useEffect(() => {
        searchInputRef.current?.focus();
    }, []);

    useEffect(() => {
        if (!scaleSource || !activeWeightLine) {
            setScaleReading(null);
            return undefined;
        }

        let mounted = true;
        const poll = async (): Promise<void> => {
            try {
                const reading = await scaleSource.read();
                if (mounted) {
                    setScaleReading(reading);
                }
            } catch {
                if (mounted) {
                    setScaleReading(null);
                }
            }
        };
        void poll();
        const interval = window.setInterval(() => void poll(), 500);
        return () => {
            mounted = false;
            window.clearInterval(interval);
        };
    }, [activeWeightLine?.lineId, scaleSource]);

    useEffect(() => {
        setCart((currentCart) => currentCart.map((line) => ({
            ...line,
            unitPrice: resolvePrice(line.product, pricingTierId, line.quantity),
        })));
    }, [pricingTierId]);

    useEffect(() => {
        if (!activeWeightLine || !scaleReading) {
            return;
        }
        const quantity = scaleReading.grams / (activeWeightLine.product.unit.toLowerCase() === 'kg' ? 1_000 : 1);
        if (quantity <= 0) {
            return;
        }
        setCart((currentCart) => currentCart.map((line) => line.lineId === activeWeightLine.lineId
            ? { ...line, quantity, unitPrice: resolvePrice(line.product, pricingTierId, quantity) }
            : line));
    }, [activeWeightLine?.lineId, activeWeightLine?.product.unit, pricingTierId, scaleReading?.grams]);

    const search = async (searchQuery: string): Promise<void> => {
        setQuery(searchQuery);
        if (searchQuery.trim().length < 1) {
            setResults([]);
            return;
        }
        setResults(await dataSource.searchProducts(searchQuery.trim()));
    };

    const addProduct = (product: CheckoutProduct): void => {
        setMessage(null);
        setResults([]);
        setQuery('');
        setCart((currentCart) => {
            const existing = currentCart.find((line) => line.product.variantId === product.variantId);
            if (existing && !product.soldByWeight) {
                const quantity = existing.quantity + 1;
                return currentCart.map((line) => line.lineId === existing.lineId
                    ? { ...line, quantity, unitPrice: resolvePrice(product, pricingTierId, quantity) }
                    : line);
            }

            const quantity = product.soldByWeight
                ? (scaleReading?.grams ?? 0) / (product.unit.toLowerCase() === 'kg' ? 1_000 : 1)
                : 1;
            return [...currentCart, {
                lineId: crypto.randomUUID(),
                product,
                quantity,
                unitPrice: resolvePrice(product, pricingTierId, quantity),
            }];
        });
    };

    const updateQuantity = (lineId: string, quantity: number): void => {
        if (!Number.isFinite(quantity) || quantity <= 0) {
            return;
        }
        setCart((currentCart) => currentCart.map((line) => line.lineId === lineId
            ? { ...line, quantity, unitPrice: resolvePrice(line.product, pricingTierId, quantity) }
            : line));
    };

    const submitOrder = async (): Promise<void> => {
        if (orderItems.length === 0 || orderItems.some((item) => item.quantity <= 0)) {
            setMessage('Add a valid quantity before taking payment.');
            return;
        }
        if (paymentMethod === 'cash' && (!Number.isFinite(cashTendered) || cashTendered < totalAmount)) {
            setMessage('Cash received must be at least the total amount.');
            return;
        }

        setBusy(true);
        setMessage(null);
        setPaymentError(null);
        try {
            const result = await dataSource.createOrderWithOutbox({
                customerId,
                pricingTierId,
                orderType: selectedCustomer ? 'commercial' : 'retail',
                items: orderItems,
                subtotal: Number(subtotal.toFixed(2)),
                taxAmount: Number(taxAmount.toFixed(2)),
                totalAmount: Number(totalAmount.toFixed(2)),
                paymentMethod,
                cashReceived: paymentMethod === 'cash' ? Number(cashTendered.toFixed(2)) : 0,
            });
            if (employeeToken && recordEmployeeSale) {
                await recordEmployeeSale(employeeToken, result.orderId);
            }
            setCart([]);
            setCashReceived('');
            setPaymentOpen(false);
            setMessage(`Order ${result.orderId} saved and queued for sync.`);
        } catch (error) {
            const errorMessage = error instanceof Error ? error.message : 'Unable to save the order.';
            setPaymentError(errorMessage);
            setMessage(errorMessage);
        } finally {
            setBusy(false);
        }
    };

    return (
        <main className="min-h-screen bg-[#FAF6F0] p-6 text-amber-950">
            <div className="mx-auto max-w-7xl space-y-6">
                <header className="flex flex-wrap items-end justify-between gap-4">
                    <div className="flex items-center gap-3">
                        <img alt="Bake Alley logo" className="h-9 w-9 rounded-full border border-amber-200/80 object-cover shadow-sm" src={logoUrl} />
                        <div>
                            <p className="text-sm font-semibold uppercase tracking-[0.18em] text-amber-600">Bake Alley POS</p>
                            <h1 className="font-bakery text-3xl font-bold tracking-tight text-amber-950">Checkout</h1>
                        </div>
                    </div>
                    <label className="w-full max-w-md text-sm font-semibold sm:w-auto">
                        Customer pricing
                        <select
                            className="mt-2 block w-full rounded-lg border border-amber-200/80 bg-white px-3 py-2 font-normal shadow-sm outline-none focus:border-amber-500 focus:ring-2 focus:ring-amber-500/40"
                            value={customerId ?? ''}
                            onChange={(event) => setCustomerId(event.target.value || null)}
                        >
                            <option value="">Retail walk-in</option>
                            {customers.map((customer) => <option key={customer.customerId} value={customer.customerId}>{customer.displayName}</option>)}
                        </select>
                    </label>
                </header>

                <section className="relative">
                    <label className="sr-only" htmlFor="product-search">Search by barcode or SKU</label>
                    <input
                        ref={searchInputRef}
                        id="product-search"
                        autoComplete="off"
                        className="w-full rounded-xl border border-amber-200/80 bg-white px-5 py-4 text-lg shadow-sm outline-none focus:border-amber-500 focus:ring-2 focus:ring-amber-500/40"
                        placeholder="Scan barcode or search SKU..."
                        value={query}
                        onChange={(event) => void search(event.target.value)}
                        onKeyDown={(event) => {
                            if (event.key === 'Enter' && results[0]) {
                                addProduct(results[0]);
                            }
                        }}
                    />
                    {results.length > 0 && (
                        <div className="absolute z-10 mt-2 grid w-full gap-2 rounded-2xl border border-amber-200/80 bg-white p-2 shadow-xl sm:grid-cols-2">
                            {results.slice(0, 8).map((product) => (
                                <button
                                    key={product.variantId}
                                    type="button"
                                    className="flex flex-col items-start gap-2 rounded-2xl border border-amber-200/80 bg-white px-4 py-3 text-left transition hover:-translate-y-0.5 hover:border-amber-400 hover:shadow-md"
                                    onClick={() => addProduct(product)}
                                >
                                    <span className="flex w-full items-center justify-between gap-2"><strong className="text-amber-950">{product.name}</strong><span className="rounded-full bg-amber-100 px-2 py-0.5 text-xs font-semibold text-amber-800">{product.unit}</span></span>
                                    <span className="flex w-full items-center justify-between text-sm text-amber-700"><span>{product.sku}</span>{product.soldByWeight && <span className="rounded-full bg-amber-100 px-2 py-0.5 text-xs font-semibold text-amber-800">Sold by weight</span>}</span>
                                </button>
                            ))}
                        </div>
                    )}
                </section>

                <section className="grid gap-6 lg:grid-cols-[1fr_22rem]">
                    <div className="overflow-hidden rounded-xl border border-amber-200/80 bg-white shadow-sm">
                        <div className="border-b border-amber-200/80 px-5 py-4"><h2 className="font-semibold">Current transaction</h2></div>
                        {cart.length === 0 ? <p className="px-5 py-16 text-center text-amber-700">Scan an item to begin.</p> : (
                            <div className="overflow-x-auto">
                                <table className="w-full text-left text-sm">
                                    <thead className="bg-amber-50/60 text-xs uppercase tracking-wide text-amber-700"><tr><th className="px-5 py-3">Item</th><th className="px-3 py-3">Qty</th><th className="px-3 py-3">Price</th><th className="px-5 py-3 text-right">Total</th><th><span className="sr-only">Remove</span></th></tr></thead>
                                    <tbody>
                                        {cart.map((line) => <tr key={line.lineId} className="border-t border-amber-100/60">
                                            <td className="px-5 py-4"><strong>{line.product.name}</strong><div className="text-xs text-amber-700">{line.product.sku}</div></td>
                                            <td className="px-3 py-4"><input aria-label={`Quantity for ${line.product.name}`} className="w-24 rounded border border-amber-200/80 px-2 py-1" min="0.0001" step="0.0001" type="number" value={line.quantity} onChange={(event) => updateQuantity(line.lineId, Number(event.target.value))} /></td>
                                            <td className="px-3 py-4 tabular-nums">{money.format(line.unitPrice)} / {line.product.unit}</td>
                                            <td className="px-5 py-4 text-right font-semibold tabular-nums">{money.format(line.quantity * line.unitPrice)}</td>
                                            <td className="pr-4"><button className="text-amber-600 hover:text-red-600" title="Remove item" type="button" onClick={() => setCart((currentCart) => currentCart.filter((item) => item.lineId !== line.lineId))}>×</button></td>
                                        </tr>)}
                                    </tbody>
                                </table>
                            </div>
                        )}
                    </div>

                    <aside className="space-y-4">
                        {scaleEnabled && <div className="rounded-xl border border-amber-200/80 bg-white p-5 shadow-sm">
                            <div className="mb-5 flex items-center justify-between"><h2 className="font-semibold">Scale</h2><span className={`rounded-full px-2 py-1 text-xs font-semibold ${scaleReading?.stable ? 'bg-emerald-100 text-emerald-700' : 'bg-amber-100 text-amber-700'}`}>{activeWeightLine ? (scaleReading?.stable ? 'Stable' : 'Waiting') : 'Idle'}</span></div>
                            <p className="text-3xl font-bold tabular-nums">{activeWeightLine && scaleReading ? formatWeight(scaleReading.grams) : '0 g'}</p>
                            <p className="mt-1 text-sm text-amber-700">{activeWeightLine ? `Reading for ${activeWeightLine.product.name}` : 'Add a weight-based item to read the scale.'}</p>
                        </div>}
                        <div className="rounded-xl border border-amber-200/80 bg-white p-5 shadow-sm">
                            <div className="flex justify-between text-sm text-amber-800"><span>Subtotal</span><span className="font-semibold tabular-nums">{money.format(subtotal)}</span></div>
                            <div className="mt-2 flex justify-between text-sm text-amber-800"><span>Tax</span><span className="font-semibold tabular-nums">{money.format(taxAmount)}</span></div>
                            <div className="mt-4 flex justify-between border-t border-amber-200/80 pt-4 text-xl font-bold"><span>Total</span><span className="tabular-nums">{money.format(totalAmount)}</span></div>
                            <button className="mt-5 w-full rounded-lg bg-amber-600 px-4 py-3 font-semibold text-white shadow-sm hover:bg-amber-700 disabled:cursor-not-allowed disabled:opacity-50" disabled={cart.length === 0 || busy} type="button" onClick={() => setPaymentOpen(true)}>Take payment</button>
                        </div>
                    </aside>
                </section>

                {message && <p className="rounded-lg bg-amber-950 px-4 py-3 text-sm text-white" role="status">{message}</p>}
            </div>

            {paymentOpen && <div className="fixed inset-0 z-20 flex items-center justify-center bg-amber-950/50 p-4" role="presentation">
                <section aria-labelledby="payment-title" aria-modal="true" className="w-full max-w-md rounded-xl bg-white p-6 shadow-2xl" role="dialog">
                    <div className="flex items-start justify-between"><div><p className="text-sm font-semibold uppercase tracking-wide text-amber-600">Payment</p><h2 className="font-bakery mt-1 text-2xl font-bold tabular-nums" id="payment-title">{money.format(totalAmount)}</h2></div><button aria-label="Close payment dialog" className="text-2xl text-amber-600 hover:text-amber-900" type="button" onClick={() => setPaymentOpen(false)}>×</button></div>
                    <fieldset className="mt-6"><legend className="text-sm font-semibold">Payment method</legend><div className="mt-3 grid grid-cols-3 gap-2">{(['cash', 'card', 'account'] as const).map((method) => <button className={`rounded-lg border px-3 py-3 text-sm font-semibold capitalize ${paymentMethod === method ? 'border-amber-600 bg-amber-50 text-amber-700' : 'border-amber-200/80 text-amber-800'}`} key={method} type="button" onClick={() => { setPaymentMethod(method); if (method !== 'cash') setCashReceived(''); }}>{method}</button>)}</div></fieldset>
                    {paymentMethod === 'cash' && <div className="mt-5"><label className="text-sm font-semibold">Cash received<input autoFocus className="mt-2 w-full rounded-lg border border-amber-200/80 px-3 py-3 text-lg outline-none focus:border-amber-500 focus:ring-2 focus:ring-amber-500/40" min={totalAmount.toFixed(2)} step="0.01" type="number" value={cashReceived} onChange={(event) => setCashReceived(event.target.value)} /></label><div className={`mt-3 flex justify-between rounded-lg px-3 py-3 text-sm font-semibold ${changeDue >= 0 ? 'bg-emerald-50 text-emerald-800' : 'bg-red-50 text-red-700'}`}><span>{changeDue >= 0 ? 'Change due' : 'Still needed'}</span><span>{money.format(Math.abs(changeDue))}</span></div></div>}
                    {paymentError && <p className="mt-4 rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700" role="alert">{paymentError}</p>}
                    <button className="mt-6 w-full rounded-lg bg-amber-600 px-4 py-3 font-semibold text-white hover:bg-amber-700 disabled:opacity-50" disabled={busy || (paymentMethod === 'cash' && changeDue < 0)} type="button" onClick={() => void submitOrder()}>{busy ? 'Saving...' : 'Confirm payment'}</button>
                </section>
            </div>}
        </main>
    );
}

declare global {
    interface Window {
        bakeAlleyCheckout?: CheckoutDataSource & {
            getCustomers: () => Promise<CheckoutCustomer[]>;
            scale: CheckoutScaleSource;
            auth: {
                login: (username: string, password: string) => Promise<{ token: string; user: { userId: string; username: string; displayName: string; role: 'admin' | 'cashier' } }>;
                logout: (token: string) => Promise<void>;
            };
            inventory: {
                import: (token: string, fileBytes: Uint8Array, fileName: string) => Promise<{ importedRows: number; createdLots: number; updatedLots: number }>;
            };
            sales: {
                report: (token: string, selectedDate: string, markupPercent: number) => Promise<SalesReport>;
            };
            crm: { listCustomers: (token: string) => Promise<CrmCustomer[]>; addTag: (token: string, customerId: string, tag: string) => Promise<void> };
            employees: { list: (token: string) => Promise<EmployeeSummary[]>; clockIn: (token: string) => Promise<void>; clockOut: (token: string) => Promise<void>; recordSale: (token: string, orderId: string) => Promise<void> };
        };
    }
}
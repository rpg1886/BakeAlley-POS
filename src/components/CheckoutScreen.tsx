import { useEffect, useRef, useState } from 'react';
import type { JSX } from 'react';
import type { SalesReport } from '../main/sales/salesReportService';

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
    customers: CheckoutCustomer[];
    retailTierId: string;
    taxRate?: number;
}

interface CartLine {
    lineId: string;
    product: CheckoutProduct;
    quantity: number;
    unitPrice: number;
}

const money = new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' });

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
    customers,
    retailTierId,
    taxRate = 0,
}: CheckoutScreenProps): JSX.Element {
    const [query, setQuery] = useState('');
    const [results, setResults] = useState<CheckoutProduct[]>([]);
    const [cart, setCart] = useState<CartLine[]>([]);
    const [customerId, setCustomerId] = useState<string | null>(null);
    const [scaleReading, setScaleReading] = useState<CheckoutScaleReading | null>(null);
    const [paymentOpen, setPaymentOpen] = useState(false);
    const [paymentMethod, setPaymentMethod] = useState<CheckoutOrderPayload['paymentMethod']>('cash');
    const [busy, setBusy] = useState(false);
    const [message, setMessage] = useState<string | null>(null);
    const searchInputRef = useRef<HTMLInputElement>(null);

    const selectedCustomer = customers.find((customer) => customer.customerId === customerId) ?? null;
    const pricingTierId = selectedCustomer?.tierId ?? retailTierId;
    const subtotal = cart.reduce((total, line) => total + line.quantity * line.unitPrice, 0);
    const taxAmount = subtotal * taxRate;
    const totalAmount = subtotal + taxAmount;
    const activeWeightLine = cart.find((line) => line.product.soldByWeight);

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

        setBusy(true);
        setMessage(null);
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
            });
            setCart([]);
            setPaymentOpen(false);
            setMessage(`Order ${result.orderId} saved and queued for sync.`);
        } catch (error) {
            setMessage(error instanceof Error ? error.message : 'Unable to save the order.');
        } finally {
            setBusy(false);
        }
    };

    return (
        <main className="min-h-screen bg-slate-100 p-6 text-slate-900">
            <div className="mx-auto max-w-7xl space-y-6">
                <header className="flex flex-wrap items-end justify-between gap-4">
                    <div>
                        <p className="text-sm font-semibold uppercase tracking-[0.18em] text-orange-600">Bake Alley POS</p>
                        <h1 className="text-3xl font-bold tracking-tight">Checkout</h1>
                    </div>
                    <label className="w-full max-w-md text-sm font-semibold sm:w-auto">
                        Customer pricing
                        <select
                            className="mt-2 block w-full rounded-lg border border-slate-300 bg-white px-3 py-2 font-normal shadow-sm outline-none focus:border-orange-500 focus:ring-2 focus:ring-orange-200"
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
                        className="w-full rounded-xl border border-slate-300 bg-white px-5 py-4 text-lg shadow-sm outline-none focus:border-orange-500 focus:ring-2 focus:ring-orange-200"
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
                        <div className="absolute z-10 mt-2 w-full overflow-hidden rounded-xl border border-slate-200 bg-white shadow-xl">
                            {results.slice(0, 8).map((product) => (
                                <button
                                    key={product.variantId}
                                    type="button"
                                    className="flex w-full items-center justify-between border-b border-slate-100 px-5 py-3 text-left last:border-0 hover:bg-orange-50"
                                    onClick={() => addProduct(product)}
                                >
                                    <span><strong>{product.name}</strong><span className="ml-3 text-sm text-slate-500">{product.sku}</span></span>
                                    <span className="text-sm text-slate-500">{product.unit}</span>
                                </button>
                            ))}
                        </div>
                    )}
                </section>

                <section className="grid gap-6 lg:grid-cols-[1fr_22rem]">
                    <div className="overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm">
                        <div className="border-b border-slate-200 px-5 py-4"><h2 className="font-semibold">Current transaction</h2></div>
                        {cart.length === 0 ? <p className="px-5 py-16 text-center text-slate-500">Scan an item to begin.</p> : (
                            <div className="overflow-x-auto">
                                <table className="w-full text-left text-sm">
                                    <thead className="bg-slate-50 text-xs uppercase tracking-wide text-slate-500"><tr><th className="px-5 py-3">Item</th><th className="px-3 py-3">Qty</th><th className="px-3 py-3">Price</th><th className="px-5 py-3 text-right">Total</th><th><span className="sr-only">Remove</span></th></tr></thead>
                                    <tbody>
                                        {cart.map((line) => <tr key={line.lineId} className="border-t border-slate-100">
                                            <td className="px-5 py-4"><strong>{line.product.name}</strong><div className="text-xs text-slate-500">{line.product.sku}</div></td>
                                            <td className="px-3 py-4"><input aria-label={`Quantity for ${line.product.name}`} className="w-24 rounded border border-slate-300 px-2 py-1" min="0.0001" step="0.0001" type="number" value={line.quantity} onChange={(event) => updateQuantity(line.lineId, Number(event.target.value))} /></td>
                                            <td className="px-3 py-4">{money.format(line.unitPrice)} / {line.product.unit}</td>
                                            <td className="px-5 py-4 text-right font-semibold">{money.format(line.quantity * line.unitPrice)}</td>
                                            <td className="pr-4"><button className="text-slate-400 hover:text-red-600" title="Remove item" type="button" onClick={() => setCart((currentCart) => currentCart.filter((item) => item.lineId !== line.lineId))}>×</button></td>
                                        </tr>)}
                                    </tbody>
                                </table>
                            </div>
                        )}
                    </div>

                    <aside className="space-y-4">
                        <div className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
                            <div className="mb-5 flex items-center justify-between"><h2 className="font-semibold">Scale</h2><span className={`rounded-full px-2 py-1 text-xs font-semibold ${scaleReading?.stable ? 'bg-emerald-100 text-emerald-700' : 'bg-amber-100 text-amber-700'}`}>{activeWeightLine ? (scaleReading?.stable ? 'Stable' : 'Waiting') : 'Idle'}</span></div>
                            <p className="text-3xl font-bold tabular-nums">{activeWeightLine && scaleReading ? formatWeight(scaleReading.grams) : '0 g'}</p>
                            <p className="mt-1 text-sm text-slate-500">{activeWeightLine ? `Reading for ${activeWeightLine.product.name}` : 'Add a weight-based item to read the scale.'}</p>
                        </div>
                        <div className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
                            <div className="flex justify-between text-sm text-slate-600"><span>Subtotal</span><span>{money.format(subtotal)}</span></div>
                            <div className="mt-2 flex justify-between text-sm text-slate-600"><span>Tax</span><span>{money.format(taxAmount)}</span></div>
                            <div className="mt-4 flex justify-between border-t border-slate-200 pt-4 text-xl font-bold"><span>Total</span><span>{money.format(totalAmount)}</span></div>
                            <button className="mt-5 w-full rounded-lg bg-orange-600 px-4 py-3 font-semibold text-white shadow-sm hover:bg-orange-700 disabled:cursor-not-allowed disabled:opacity-50" disabled={cart.length === 0 || busy} type="button" onClick={() => setPaymentOpen(true)}>Take payment</button>
                        </div>
                    </aside>
                </section>

                {message && <p className="rounded-lg bg-slate-900 px-4 py-3 text-sm text-white" role="status">{message}</p>}
            </div>

            {paymentOpen && <div className="fixed inset-0 z-20 flex items-center justify-center bg-slate-950/50 p-4" role="presentation">
                <section aria-labelledby="payment-title" aria-modal="true" className="w-full max-w-md rounded-xl bg-white p-6 shadow-2xl" role="dialog">
                    <div className="flex items-start justify-between"><div><p className="text-sm font-semibold uppercase tracking-wide text-orange-600">Payment</p><h2 className="mt-1 text-2xl font-bold" id="payment-title">{money.format(totalAmount)}</h2></div><button aria-label="Close payment dialog" className="text-2xl text-slate-400 hover:text-slate-700" type="button" onClick={() => setPaymentOpen(false)}>×</button></div>
                    <fieldset className="mt-6"><legend className="text-sm font-semibold">Payment method</legend><div className="mt-3 grid grid-cols-3 gap-2">{(['cash', 'card', 'account'] as const).map((method) => <button className={`rounded-lg border px-3 py-3 text-sm font-semibold capitalize ${paymentMethod === method ? 'border-orange-600 bg-orange-50 text-orange-700' : 'border-slate-300 text-slate-600'}`} key={method} type="button" onClick={() => setPaymentMethod(method)}>{method}</button>)}</div></fieldset>
                    <button className="mt-6 w-full rounded-lg bg-orange-600 px-4 py-3 font-semibold text-white hover:bg-orange-700 disabled:opacity-50" disabled={busy} type="button" onClick={() => void submitOrder()}>{busy ? 'Saving...' : 'Confirm payment'}</button>
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
        };
    }
}
import { useEffect, useState, type JSX } from 'react';

export interface InventoryViewRow {
    sku: string;
    productName: string;
    variantName: string;
    lotNumber: string;
    expirationDate: string | null;
    quantityOnHand: number;
    unit: string;
}

interface InventoryViewProps {
    token: string;
    listInventory: (token: string) => Promise<InventoryViewRow[]>;
}

export function InventoryView({ token, listInventory }: InventoryViewProps): JSX.Element {
    const [rows, setRows] = useState<InventoryViewRow[]>([]);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);

    const refresh = (): void => {
        setLoading(true);
        void listInventory(token).then(setRows).catch((loadError: unknown) => {
            setError(loadError instanceof Error ? loadError.message : 'Unable to load inventory.');
        }).finally(() => setLoading(false));
    };

    useEffect(() => {
        refresh();
    }, [token]);

    return <section className="min-h-[calc(100vh-9rem)] bg-slate-100 px-6 pb-8 pt-6">
        <div className="mx-auto max-w-7xl">
            <div className="mb-5 flex flex-wrap items-end justify-between gap-3">
                <div><p className="text-sm font-semibold uppercase tracking-[0.18em] text-orange-600">Stock control</p><h1 className="text-3xl font-bold text-slate-900">Inventory</h1><p className="mt-1 text-sm text-slate-500">Live lot quantities ordered by expiration date.</p></div>
                <button className="rounded-lg border border-slate-300 bg-white px-4 py-2 text-sm font-semibold text-slate-700 shadow-sm hover:border-orange-500" type="button" onClick={refresh}>Refresh</button>
            </div>
            {error && <p className="mb-4 rounded-lg bg-red-50 px-4 py-3 text-sm text-red-700" role="alert">{error}</p>}
            <div className="overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm">
                {loading ? <p className="px-5 py-12 text-center text-slate-500">Loading inventory...</p> : rows.length === 0 ? <p className="px-5 py-12 text-center text-slate-500">No inventory lots found.</p> : <div className="overflow-x-auto"><table className="w-full text-left text-sm"><thead className="bg-slate-50 text-xs uppercase tracking-wide text-slate-500"><tr><th className="px-5 py-3">Product</th><th className="px-3 py-3">SKU</th><th className="px-3 py-3">Lot</th><th className="px-3 py-3">Expiration</th><th className="px-5 py-3 text-right">On hand</th></tr></thead><tbody>{rows.map((row) => <tr className="border-t border-slate-100" key={`${row.sku}-${row.lotNumber}`}><td className="px-5 py-4"><strong>{row.variantName}</strong><div className="text-xs text-slate-500">{row.productName}</div></td><td className="px-3 py-4 font-mono text-xs">{row.sku}</td><td className="px-3 py-4">{row.lotNumber}</td><td className="px-3 py-4">{row.expirationDate ?? 'No expiry'}</td><td className="px-5 py-4 text-right font-semibold tabular-nums">{row.quantityOnHand.toFixed(4)} {row.unit}</td></tr>)}</tbody></table></div>}
            </div>
        </div>
    </section>;
}

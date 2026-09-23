import { useEffect, useState, type JSX } from 'react';
import type { SalesReport } from '../main/sales/salesReportService';

interface SalesViewProps {
    token: string;
    role: 'admin' | 'cashier';
    getReport: (token: string, selectedDate: string, markupPercent: number) => Promise<SalesReport>;
}

const today = (): string => { const date = new Date(); return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`; };
const money = new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' });

function PeriodCard({ label, report }: { label: string; report: SalesReport['week'] }): JSX.Element {
    return <div className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
        <p className="text-sm font-semibold uppercase tracking-wide text-slate-500">{label}</p>
        <p className="mt-2 text-xs text-slate-500">{report.startDate} to {report.endDate}</p>
        <dl className="mt-4 space-y-2 text-sm">
            <div className="flex justify-between"><dt className="text-slate-500">Gross</dt><dd className="font-semibold">{money.format(report.grossTotal)}</dd></div>
            <div className="flex justify-between"><dt className="text-slate-500">Net</dt><dd className="font-semibold text-emerald-700">{money.format(report.netTotal)}</dd></div>
            <div className="flex justify-between"><dt className="text-slate-500">Orders</dt><dd className="font-semibold">{report.orderCount}</dd></div>
        </dl>
    </div>;
}

export function SalesView({ token, role, getReport }: SalesViewProps): JSX.Element {
    const [selectedDate, setSelectedDate] = useState(today);
    const [markupPercent, setMarkupPercent] = useState(0);
    const [report, setReport] = useState<SalesReport | null>(null);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);

    const refresh = (): void => {
        setLoading(true);
        setError(null);
        void getReport(token, selectedDate, markupPercent)
            .then(setReport)
            .catch((reason: unknown) => setError(reason instanceof Error ? reason.message : 'Unable to load sales report.'))
            .finally(() => setLoading(false));
    };

    useEffect(() => { refresh(); }, [token, selectedDate, markupPercent]);

    return <section className="min-h-[calc(100vh-5rem)] bg-slate-100 px-6 pb-8 pt-6">
        <div className="mx-auto max-w-7xl">
            <div className="mb-6 flex flex-wrap items-end justify-between gap-4">
                <div><p className="text-sm font-semibold uppercase tracking-[0.18em] text-orange-600">Performance</p><h1 className="text-3xl font-bold text-slate-900">Sales</h1><p className="mt-1 text-sm text-slate-500">Review completed transactions by day.</p></div>
                <div className="flex flex-wrap items-end gap-3">
                    <label className="text-sm font-semibold text-slate-700">Calendar day<input className="mt-2 block rounded-lg border border-slate-300 bg-white px-3 py-2 font-normal" type="date" value={selectedDate} onChange={(event) => setSelectedDate(event.target.value)} /></label>
                    {role === 'admin' && <label className="text-sm font-semibold text-slate-700">Markup %<input className="mt-2 block w-28 rounded-lg border border-slate-300 bg-white px-3 py-2 font-normal" min="0" step="0.01" type="number" value={markupPercent} onChange={(event) => setMarkupPercent(Math.max(0, Number(event.target.value) || 0))} /></label>}
                    <button className="rounded-lg border border-slate-300 bg-white px-4 py-2 text-sm font-semibold text-slate-700" type="button" onClick={refresh}>Refresh</button>
                </div>
            </div>
            {error && <p className="mb-4 rounded-lg bg-red-50 px-4 py-3 text-sm text-red-700" role="alert">{error}</p>}
            {loading || !report ? <p className="rounded-xl border border-slate-200 bg-white px-5 py-12 text-center text-slate-500">Loading sales...</p> : <>
                {role === 'admin' && <>
                    <div className="grid gap-4 md:grid-cols-3">
                        <div className="rounded-xl bg-slate-900 p-5 text-white"><p className="text-sm text-slate-300">Gross sales for {report.selectedDate}</p><p className="mt-2 text-3xl font-bold">{money.format(report.dayGrossTotal)}</p><p className="mt-2 text-sm text-slate-300">{report.dayOrderCount} completed orders</p></div>
                        <div className="rounded-xl bg-emerald-700 p-5 text-white"><p className="text-sm text-emerald-100">Net sales</p><p className="mt-2 text-3xl font-bold">{money.format(report.dayNetTotal)}</p><p className="mt-2 text-sm text-emerald-100">Markup basis: {report.markupPercent.toFixed(2)}%</p></div>
                        <div className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm"><p className="text-sm text-slate-500">Items sold</p><p className="mt-2 text-3xl font-bold">{report.items.reduce((sum, item) => sum + item.quantity, 0).toFixed(4)}</p><p className="mt-2 text-sm text-slate-500">Across selected day</p></div>
                    </div>
                    <div className="mt-6 grid gap-4 md:grid-cols-3"><PeriodCard label="This week" report={report.week} /><PeriodCard label="This month" report={report.month} /><PeriodCard label="This year" report={report.year} /></div>
                </>}
                <div className="mt-6 overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm">
                    <div className="border-b border-slate-200 px-5 py-4"><h2 className="font-semibold">Daily transactions on {report.selectedDate}</h2></div>
                    {report.items.length === 0 ? <p className="px-5 py-12 text-center text-slate-500">No completed sales for this day.</p> : <div className="overflow-x-auto"><table className="w-full text-left text-sm"><thead className="bg-slate-50 text-xs uppercase tracking-wide text-slate-500"><tr><th className="px-5 py-3">Time / customer</th><th className="px-3 py-3">Item</th><th className="px-3 py-3">SKU</th><th className="px-3 py-3">Paid by</th><th className="px-3 py-3 text-right">Quantity</th><th className="px-5 py-3 text-right">Amount</th></tr></thead><tbody>{report.items.map((item, index) => <tr className="border-t border-slate-100" key={`${item.orderId}-${item.sku}-${index}`}><td className="px-5 py-4"><div className="font-semibold">{new Date(item.soldAt).toLocaleTimeString()}</div><div className="text-xs text-slate-500">{item.customerName}</div><div className="font-mono text-[10px] text-slate-400">{item.orderId.slice(0, 8)}</div></td><td className="px-3 py-4 font-semibold">{item.itemName}</td><td className="px-3 py-4 font-mono text-xs">{item.sku}</td><td className="px-3 py-4 capitalize">{item.paymentMethod}</td><td className="px-3 py-4 text-right">{item.quantity.toFixed(4)}</td><td className="px-5 py-4 text-right font-semibold">{money.format(item.amount)}</td></tr>)}</tbody></table></div>}
                </div>
            </>}
        </div>
    </section>;
}

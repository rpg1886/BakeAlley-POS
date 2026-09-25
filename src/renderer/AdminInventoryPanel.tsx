import { useRef, useState, type JSX } from 'react';

interface AdminInventoryPanelProps {
    token: string;
    importInventory: (token: string, bytes: Uint8Array, fileName: string) => Promise<{ importedRows: number; createdLots: number; updatedLots: number }>;
    importStockTake: (token: string, bytes: Uint8Array, fileName: string) => Promise<{
        importedRows: number;
        skippedRows: number;
        createdCategories: number;
        createdProducts: number;
        updatedProducts: number;
        createdLots: number;
        updatedLots: number;
    }>;
}

export function AdminInventoryPanel({ token, importInventory, importStockTake }: AdminInventoryPanelProps): JSX.Element {
    const fileRef = useRef<HTMLInputElement>(null);
    const [message, setMessage] = useState<string | null>(null);
    const [busy, setBusy] = useState(false);

    const stockTakeFileRef = useRef<HTMLInputElement>(null);
    const [stockTakeMessage, setStockTakeMessage] = useState<string | null>(null);
    const [stockTakeBusy, setStockTakeBusy] = useState(false);

    const importFile = async (): Promise<void> => {
        const file = fileRef.current?.files?.[0];
        if (!file) {
            setMessage('Choose a CSV or Excel file first.');
            return;
        }
        setBusy(true);
        setMessage(null);
        try {
            const result = await importInventory(token, new Uint8Array(await file.arrayBuffer()), file.name);
            setMessage(`Imported ${result.importedRows} rows: ${result.createdLots} new lots, ${result.updatedLots} updated lots.`);
            if (fileRef.current) {
                fileRef.current.value = '';
            }
        } catch (error) {
            setMessage(error instanceof Error ? error.message : 'Inventory import failed.');
        } finally {
            setBusy(false);
        }
    };

    const importStockTakeFile = async (): Promise<void> => {
        const file = stockTakeFileRef.current?.files?.[0];
        if (!file) {
            setStockTakeMessage('Choose the main inventory CSV/Excel file first.');
            return;
        }
        setStockTakeBusy(true);
        setStockTakeMessage(null);
        try {
            const result = await importStockTake(token, new Uint8Array(await file.arrayBuffer()), file.name);
            setStockTakeMessage(
                `Imported ${result.importedRows} rows (${result.skippedRows} skipped): `
                + `${result.createdCategories} new categories, ${result.createdProducts} new products, `
                + `${result.updatedProducts} refreshed products, ${result.createdLots} new stock lots, ${result.updatedLots} updated stock lots.`,
            );
            if (stockTakeFileRef.current) {
                stockTakeFileRef.current.value = '';
            }
        } catch (error) {
            setStockTakeMessage(error instanceof Error ? error.message : 'Main inventory import failed.');
        } finally {
            setStockTakeBusy(false);
        }
    };


    return <div className="space-y-4">
        <section className="rounded-xl border border-orange-200 bg-orange-50 p-5">
            <div className="flex flex-wrap items-center justify-between gap-3">
                <div><h2 className="font-semibold text-orange-950">Main inventory import (source of truth)</h2><p className="mt-1 text-sm text-orange-800">CSV/XLSX columns: Name, Stock Qty, Cost, Total Amount, Category, Warehouse. Categories, products, and stock levels are created or refreshed automatically.</p></div>
                <input ref={stockTakeFileRef} accept=".csv,.xlsx,.xls" className="max-w-full rounded-lg border border-orange-300 bg-white px-3 py-2 text-sm" type="file" />
                <button className="rounded-lg bg-orange-700 px-4 py-2 text-sm font-semibold text-white hover:bg-orange-800 disabled:opacity-50" disabled={stockTakeBusy} type="button" onClick={() => void importStockTakeFile()}>{stockTakeBusy ? 'Importing...' : 'Import main inventory'}</button>
            </div>
            {stockTakeMessage && <p className="mt-3 text-sm text-orange-900" role="status">{stockTakeMessage}</p>}
        </section>
        <section className="rounded-xl border border-orange-200 bg-orange-50 p-5">
            <div className="flex flex-wrap items-center justify-between gap-3">
                <div><h2 className="font-semibold text-orange-950">Restock existing lots</h2><p className="mt-1 text-sm text-orange-800">CSV/XLSX columns: sku, lot_number, expiration_date, quantity_on_hand</p></div>
                <input ref={fileRef} accept=".csv,.xlsx,.xls" className="max-w-full rounded-lg border border-orange-300 bg-white px-3 py-2 text-sm" type="file" />
                <button className="rounded-lg bg-orange-700 px-4 py-2 text-sm font-semibold text-white hover:bg-orange-800 disabled:opacity-50" disabled={busy} type="button" onClick={() => void importFile()}>{busy ? 'Importing...' : 'Import inventory'}</button>
            </div>
            {message && <p className="mt-3 text-sm text-orange-900" role="status">{message}</p>}
        </section>
    </div>;
}

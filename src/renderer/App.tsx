import { useEffect, useState, type JSX } from 'react';
import { CheckoutScreen, type CheckoutCustomer } from '../components/CheckoutScreen';
import { AdminInventoryPanel } from './AdminInventoryPanel';
import { LoginScreen, type LoginUser } from './LoginScreen';
import { InventoryView } from './InventoryView';

const RETAIL_TIER_ID = '2f8c8d4e-8d28-4d4d-9f41-7a52c5f2e101';

export function App(): JSX.Element {
    const [customers, setCustomers] = useState<CheckoutCustomer[]>([]);
    const [error, setError] = useState<string | null>(null);
    const [session, setSession] = useState<{ token: string; user: LoginUser } | null>(null);
    const [activeTab, setActiveTab] = useState<'checkout' | 'inventory'>('checkout');
    const bridge = window.bakeAlleyCheckout;

    useEffect(() => {
        if (!session) {
            return;
        }
        if (!bridge) {
            setError('The Electron preload bridge is unavailable.');
            return;
        }
        void bridge.getCustomers().then(setCustomers).catch((loadError: unknown) => {
            setError(loadError instanceof Error ? loadError.message : 'Unable to load customers.');
        });
    }, [bridge, session]);

    if (!bridge) {
        return <main className="grid min-h-screen place-items-center bg-slate-100 p-6"><p className="rounded-lg bg-white p-6 text-red-700 shadow">{error ?? 'Starting Bake Alley POS...'}</p></main>;
    }

    if (!session) {
        return <LoginScreen onLogin={async (username, password) => setSession(await bridge.auth.login(username, password))} />;
    }

    if (error) {
        return <main className="grid min-h-screen place-items-center bg-slate-100 p-6"><p className="rounded-lg bg-white p-6 text-red-700 shadow">{error}</p></main>;
    }

    return <main><header className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-200 bg-white px-6 py-3"><div className="flex items-center gap-6"><p className="text-sm text-slate-600">Signed in as <strong>{session.user.displayName}</strong> ({session.user.role})</p><nav aria-label="Main navigation" className="flex gap-1"><button className={`rounded-lg px-4 py-2 text-sm font-semibold ${activeTab === 'checkout' ? 'bg-orange-100 text-orange-700' : 'text-slate-500 hover:bg-slate-100'}`} type="button" onClick={() => setActiveTab('checkout')}>Checkout</button><button className={`rounded-lg px-4 py-2 text-sm font-semibold ${activeTab === 'inventory' ? 'bg-orange-100 text-orange-700' : 'text-slate-500 hover:bg-slate-100'}`} type="button" onClick={() => setActiveTab('inventory')}>Inventory</button></nav></div><button className="text-sm font-semibold text-slate-500 hover:text-red-600" type="button" onClick={() => { void bridge.auth.logout(session.token); setSession(null); }}>Sign out</button></header>{activeTab === 'inventory' ? <InventoryView token={session.token} listInventory={bridge.inventory.list} /> : <><div className="mx-auto max-w-7xl px-6 pt-6">{session.user.role === 'admin' && <AdminInventoryPanel token={session.token} importInventory={bridge.inventory.import} />}</div><CheckoutScreen dataSource={bridge} scaleSource={bridge.scale} customers={customers} retailTierId={RETAIL_TIER_ID} taxRate={0} /></>}</main>;
}
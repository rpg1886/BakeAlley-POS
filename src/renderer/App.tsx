import { useEffect, useState, type JSX } from 'react';
import { CheckoutScreen, type CheckoutCustomer } from '../components/CheckoutScreen';
import { AdminInventoryPanel } from './AdminInventoryPanel';
import { LoginScreen, type LoginUser } from './LoginScreen';

const RETAIL_TIER_ID = '2f8c8d4e-8d28-4d4d-9f41-7a52c5f2e101';

export function App(): JSX.Element {
    const [customers, setCustomers] = useState<CheckoutCustomer[]>([]);
    const [error, setError] = useState<string | null>(null);
    const [session, setSession] = useState<{ token: string; user: LoginUser } | null>(null);
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

    return <main><header className="flex items-center justify-between border-b border-slate-200 bg-white px-6 py-3"><p className="text-sm text-slate-600">Signed in as <strong>{session.user.displayName}</strong> ({session.user.role})</p><button className="text-sm font-semibold text-slate-500 hover:text-red-600" type="button" onClick={() => { void bridge.auth.logout(session.token); setSession(null); }}>Sign out</button></header>{session.user.role === 'admin' && <div className="mx-auto max-w-7xl px-6 pt-6"><AdminInventoryPanel token={session.token} importInventory={bridge.inventory.import} /></div>}<CheckoutScreen dataSource={bridge} scaleSource={bridge.scale} customers={customers} retailTierId={RETAIL_TIER_ID} taxRate={0} /></main>;
}
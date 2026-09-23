import { useEffect, useState, type JSX } from 'react';
import { CheckoutScreen, type CheckoutCustomer } from '../components/CheckoutScreen';

const RETAIL_TIER_ID = '2f8c8d4e-8d28-4d4d-9f41-7a52c5f2e101';

export function App(): JSX.Element {
    const [customers, setCustomers] = useState<CheckoutCustomer[]>([]);
    const [error, setError] = useState<string | null>(null);
    const bridge = window.bakeAlleyCheckout;

    useEffect(() => {
        if (!bridge) {
            setError('The Electron preload bridge is unavailable.');
            return;
        }
        void bridge.getCustomers().then(setCustomers).catch((loadError: unknown) => {
            setError(loadError instanceof Error ? loadError.message : 'Unable to load customers.');
        });
    }, [bridge]);

    if (!bridge || error) {
        return <main className="grid min-h-screen place-items-center bg-slate-100 p-6"><p className="rounded-lg bg-white p-6 text-red-700 shadow">{error ?? 'Starting Bake Alley POS...'}</p></main>;
    }

    return <CheckoutScreen dataSource={bridge} scaleSource={bridge.scale} customers={customers} retailTierId={RETAIL_TIER_ID} taxRate={0} />;
}
import { useState, type FormEvent, type JSX } from 'react';

export interface LoginUser {
    userId: string;
    username: string;
    displayName: string;
    role: 'admin' | 'cashier';
}

interface LoginScreenProps {
    onLogin: (username: string, password: string) => Promise<void>;
}

export function LoginScreen({ onLogin }: LoginScreenProps): JSX.Element {
    const [username, setUsername] = useState('');
    const [password, setPassword] = useState('');
    const [error, setError] = useState<string | null>(null);
    const [busy, setBusy] = useState(false);

    const submit = async (event: FormEvent<HTMLFormElement>): Promise<void> => {
        event.preventDefault();
        setBusy(true);
        setError(null);
        try {
            await onLogin(username, password);
        } catch (loginError) {
            setError(loginError instanceof Error ? loginError.message : 'Unable to sign in.');
        } finally {
            setBusy(false);
        }
    };

    return <main className="grid min-h-screen place-items-center bg-slate-100 p-6">
        <form className="w-full max-w-md rounded-2xl border border-slate-200 bg-white p-8 shadow-xl" onSubmit={(event) => void submit(event)}>
            <p className="text-sm font-semibold uppercase tracking-[0.18em] text-orange-600">Bake Alley POS</p>
            <h1 className="mt-2 text-3xl font-bold text-slate-900">Sign in</h1>
            <p className="mt-2 text-sm text-slate-500">Use your store account to access checkout.</p>
            <label className="mt-8 block text-sm font-semibold text-slate-700">Username<input autoComplete="username" className="mt-2 w-full rounded-lg border border-slate-300 px-3 py-3 outline-none focus:border-orange-500 focus:ring-2 focus:ring-orange-200" value={username} onChange={(event) => setUsername(event.target.value)} /></label>
            <label className="mt-4 block text-sm font-semibold text-slate-700">Password<input autoComplete="current-password" className="mt-2 w-full rounded-lg border border-slate-300 px-3 py-3 outline-none focus:border-orange-500 focus:ring-2 focus:ring-orange-200" type="password" value={password} onChange={(event) => setPassword(event.target.value)} /></label>
            {error && <p className="mt-4 rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700" role="alert">{error}</p>}
            <button className="mt-6 w-full rounded-lg bg-orange-600 px-4 py-3 font-semibold text-white hover:bg-orange-700 disabled:opacity-50" disabled={busy || !username || !password} type="submit">{busy ? 'Signing in...' : 'Sign in'}</button>
        </form>
    </main>;
}

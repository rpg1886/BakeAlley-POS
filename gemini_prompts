import { useState, type FormEvent, type JSX } from 'react';
import logoUrl from '../../Images/bakeAlley-Logo.jpg';

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

    return (
        <main className="grid min-h-screen place-items-center bg-[#FAF6F0] p-6">
            <form 
                className="w-full max-w-md rounded-2xl border border-amber-200/80 bg-white p-8 shadow-xl" 
                onSubmit={(event) => void submit(event)}
            >
                {/* Header Container */}
                <div className="flex flex-col items-center text-center">
                    <img 
                        alt="Bake Alley logo" 
                        src={logoUrl} 
                        style={{ 
                            height: '75px', 
                            width: 'auto', 
                            maxWidth: '220px', 
                            objectFit: 'contain',
                            display: 'block'
                        }} 
                    />
                    
                    <div className="mt-4 space-y-1">
                        <h1 className="font-bakery text-2xl font-bold tracking-tight text-amber-950">
                            Bake Alley POS
                        </h1>
                        <h2 className="text-base font-semibold text-amber-800">
                            Sign in
                        </h2>
                        <p className="text-xs text-amber-700/80">
                            Use your store account to access checkout.
                        </p>
                    </div>
                </div>

                {/* Input Fields Section (Shifted inward with px-3 and pl-1) */}
                <div className="mt-6 space-y-4 px-3">
                    <label className="block text-left text-sm font-semibold text-amber-900 pl-1">
                        Username
                        <input 
                            autoComplete="username" 
                            className="mt-1.5 w-full rounded-lg border border-amber-200/80 bg-amber-50/20 px-3.5 py-2.5 text-amber-950 outline-none transition focus:border-amber-500 focus:bg-white focus:ring-2 focus:ring-amber-500/30" 
                            value={username} 
                            onChange={(event) => setUsername(event.target.value)} 
                        />
                    </label>

                    <label className="block text-left text-sm font-semibold text-amber-900 pl-1">
                        Password
                        <input 
                            autoComplete="current-password" 
                            className="mt-1.5 w-full rounded-lg border border-amber-200/80 bg-amber-50/20 px-3.5 py-2.5 text-amber-950 outline-none transition focus:border-amber-500 focus:bg-white focus:ring-2 focus:ring-amber-500/30" 
                            type="password" 
                            value={password} 
                            onChange={(event) => setPassword(event.target.value)} 
                        />
                    </label>
                </div>

                {error && (
                    <div className="px-3 mt-4">
                        <p className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700" role="alert">
                            {error}
                        </p>
                    </div>
                )}

                {/* Button Container (Matching px-3 inset) */}
                <div className="px-3 mt-6">
                    <button 
                        className="w-full rounded-lg border border-amber-800 bg-amber-700 px-4 py-3 font-semibold text-white shadow-sm transition hover:bg-amber-800 disabled:cursor-not-allowed disabled:border-amber-300 disabled:bg-amber-300 disabled:text-amber-50" 
                        disabled={busy || !username || !password} 
                        type="submit"
                    >
                        {busy ? 'Signing in...' : 'Sign in'}
                    </button>
                </div>
            </form>
        </main>
    );
}

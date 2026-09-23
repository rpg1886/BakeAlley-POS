import { useEffect, useState, type JSX } from 'react';
import { CheckoutScreen, type CheckoutCustomer } from '../components/CheckoutScreen';
import { AdminInventoryPanel } from './AdminInventoryPanel';
import { LoginScreen, type LoginUser } from './LoginScreen';
import { InventoryView } from './InventoryView';
import { SalesView } from './SalesView';
import { CrmView } from './CrmView';
import { EmployeesView } from './EmployeesView';

const RETAIL_TIER_ID = '2f8c8d4e-8d28-4d4d-9f41-7a52c5f2e101';
type AppTab = 'checkout' | 'inventory' | 'sales' | 'crm' | 'employees';

export function App(): JSX.Element {
    const [customers, setCustomers] = useState<CheckoutCustomer[]>([]);
    const [error, setError] = useState<string | null>(null);
    const [session, setSession] = useState<{ token: string; user: LoginUser } | null>(null);
    const [activeTab, setActiveTab] = useState<AppTab>('checkout');
    const bridge = window.bakeAlleyCheckout;
    useEffect(() => { if (session && bridge) void bridge.getCustomers().then(setCustomers).catch((reason: unknown) => setError(reason instanceof Error ? reason.message : 'Unable to load customers.')); }, [bridge, session]);
    if (!bridge) return <main className="grid min-h-screen place-items-center bg-slate-100 p-6"><p className="rounded-lg bg-white p-6 text-red-700 shadow">{error ?? 'Starting Bake Alley POS...'}</p></main>;
    if (!session) return <LoginScreen onLogin={async (username, password) => setSession(await bridge.auth.login(username, password))} />;
    if (error) return <main className="grid min-h-screen place-items-center bg-slate-100 p-6"><p className="rounded-lg bg-white p-6 text-red-700 shadow">{error}</p></main>;
    const tabButton = (tab: AppTab, label: string): JSX.Element => <button className={`rounded-lg px-4 py-2 text-sm font-semibold ${activeTab === tab ? 'bg-orange-100 text-orange-700' : 'text-slate-500 hover:bg-slate-100'}`} type="button" onClick={() => setActiveTab(tab)}>{label}</button>;
    return <main><header className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-200 bg-white px-6 py-3"><div className="flex items-center gap-6"><p className="text-sm text-slate-600">Signed in as <strong>{session.user.displayName}</strong> ({session.user.role})</p><nav aria-label="Main navigation" className="flex gap-1">{tabButton('checkout', 'Checkout')}{tabButton('inventory', 'Inventory')}{tabButton('sales', 'Sales')}{tabButton('crm', 'CRM')}{tabButton('employees', 'Employees')}</nav></div><button className="text-sm font-semibold text-slate-500 hover:text-red-600" type="button" onClick={() => { void bridge.auth.logout(session.token); setSession(null); }}>Sign out</button></header><div className={activeTab === 'checkout' ? '' : 'hidden'}><CheckoutScreen dataSource={bridge} scaleSource={bridge.scale} customers={customers} retailTierId={RETAIL_TIER_ID} taxRate={0} employeeToken={session.token} recordEmployeeSale={bridge.employees.recordSale} /></div><div className={activeTab === 'inventory' ? '' : 'hidden'}><InventoryView token={session.token} listInventory={bridge.inventory.list} />{session.user.role === 'admin' && <div className="mx-auto max-w-7xl px-6 pb-8"><AdminInventoryPanel token={session.token} importInventory={bridge.inventory.import} /></div>}</div><div className={activeTab === 'sales' ? '' : 'hidden'}><SalesView token={session.token} role={session.user.role} getReport={bridge.sales.report} /></div><div className={activeTab === 'crm' ? '' : 'hidden'}><CrmView token={session.token} role={session.user.role} listCustomers={bridge.crm.listCustomers} createCustomer={bridge.crm.createCustomer} deleteCustomer={bridge.crm.deleteCustomer} /></div><div className={activeTab === 'employees' ? '' : 'hidden'}><EmployeesView token={session.token} role={session.user.role} list={bridge.employees.list} clockIn={bridge.employees.clockIn} clockOut={bridge.employees.clockOut} shifts={bridge.employees.shifts} createEmployee={bridge.employees.create} /></div></main>;
}

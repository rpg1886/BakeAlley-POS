import { useEffect, useMemo, useState, type JSX, type ReactNode } from 'react';
import { CheckoutScreen, type CheckoutCustomer, type CheckoutOrderPayload, type CheckoutProduct } from '../src/components/CheckoutScreen';
import { LoginScreen } from '../src/renderer/LoginScreen';
import { SalesView } from '../src/renderer/SalesView';
import { InventoryView } from '../src/renderer/InventoryView';
import { CrmView } from '../src/renderer/CrmView';
import { CloudPosApi, type CloudSession } from './cloudApi';
import logoUrl from '../Images/bakeAlley-Logo.jpg';
import type { CloudCustomer, CloudEmployee, CloudInventoryRow, CloudOrderPayload, CloudSalesReport, CloudShift } from './apiClient';

const api = new CloudPosApi({
  baseUrl: (import.meta.env.VITE_API_URL || 'https://bakealley-pos-production.up.railway.app').replace(/\/+$/, ''),
  getToken: () => localStorage.getItem('bakealley_cloud_token') || sessionStorage.getItem('bakealley_cloud_token'),
});

const retailTierId = import.meta.env.VITE_RETAIL_TIER_ID ?? '2f8c8d4e-8d28-4d4d-9f41-7a52c5f2e101';
const INACTIVITY_TIMEOUT_MS = 5 * 60 * 1000;
const LOW_STOCK_THRESHOLD = 10;
const CARD_FEE_RATE = 0.025;

const money = new Intl.NumberFormat('en-PH', { style: 'currency', currency: 'PHP', minimumFractionDigits: 2, maximumFractionDigits: 2 });
const today = (): string => new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Manila' }).format(new Date());

type Tab = 'checkout' | 'sales' | 'inventory' | 'crm' | 'employees';

function errorText(reason: unknown, fallback: string): string {
    if (!(reason instanceof Error)) return fallback;
    const messages: Record<string, string> = {
      CUSTOMER_HAS_ORDERS: 'This customer cannot be deleted because they have completed orders.',
      INVALID_CUSTOMER: 'Enter a contact name and pricing tier.',
      INVALID_EMPLOYEE: 'Enter all employee fields.',
      PASSWORD_TOO_SHORT: 'Employee passwords must be at least 12 characters.',
      INVALID_INVENTORY_ADJUSTMENT: 'Choose a product and lot, then enter valid quantity and price values.',
      CANNOT_DELETE_SELF: 'You cannot delete your own logged-in admin account.',
      USER_NOT_FOUND: 'Employee not found or already deactivated.'
    };
    return messages[reason.message] ?? (reason.message || fallback);
}

function clearSessionStorage(): void {
  localStorage.removeItem('bakealley_cloud_token');
  localStorage.removeItem('bakealley_cloud_user');
  localStorage.removeItem('bakealley_cloud_last_active');
  localStorage.removeItem('bakealley_cloud_tab');
  localStorage.removeItem('bakealley_pos_cart');
  localStorage.removeItem('bakealley_pos_customer_id');
  localStorage.removeItem('bakealley_pos_crm_form');
  localStorage.removeItem('bakealley_pos_emp_form');
  sessionStorage.removeItem('bakealley_cloud_token');
  sessionStorage.removeItem('bakealley_cloud_user');
  sessionStorage.removeItem('bakealley_cloud_last_active');
}

export function CloudApp(): JSX.Element {
  const [session, setSession] = useState<CloudSession | null>(() => {
    const token = localStorage.getItem('bakealley_cloud_token');
    const userJson = localStorage.getItem('bakealley_cloud_user');
    if (token && userJson) {
      try {
        const user = JSON.parse(userJson);
        return { token, user };
      } catch {
        clearSessionStorage();
        return null;
      }
    }
    return null;
  });

  const [tab, setTab] = useState<Tab>(() => {
    const savedTab = localStorage.getItem('bakealley_cloud_tab') as Tab | null;
    if (savedTab) return savedTab;
    return session?.user.role === 'admin' ? 'employees' : 'checkout';
  });

  const [customers, setCustomers] = useState<CloudCustomer[]>([]);
  const [inventory, setInventory] = useState<CloudInventoryRow[]>([]);
  const [salesReport, setSalesReport] = useState<CloudSalesReport | null>(null);
  const [salesDate, setSalesDate] = useState<string>(today());
  const [salesLoading, setSalesLoading] = useState(false);

  const updateLastActiveTime = () => {
    localStorage.setItem('bakealley_cloud_last_active', String(Date.now()));
  };

  useEffect(() => {
    if (!session) return;
    const checkInactivity = () => {
      const lastActiveStr = localStorage.getItem('bakealley_cloud_last_active');
      const lastActive = lastActiveStr ? Number(lastActiveStr) : Date.now();
      if (Date.now() - lastActive > INACTIVITY_TIMEOUT_MS) handleLogout();
    };
    const activityInterval = setInterval(checkInactivity, 10000);
    const handleUserActivity = () => updateLastActiveTime();
    window.addEventListener('mousemove', handleUserActivity);
    window.addEventListener('keydown', handleUserActivity);
    window.addEventListener('click', handleUserActivity);
    return () => {
      clearInterval(activityInterval);
      window.removeEventListener('mousemove', handleUserActivity);
      window.removeEventListener('keydown', handleUserActivity);
      window.removeEventListener('click', handleUserActivity);
    };
  }, [session]);

  const handleLogout = () => {
    api.logout().catch((err) => console.error('Logout failed:', err));
    clearSessionStorage();
    setSession(null);
  };

  const refreshCustomers = async (): Promise<void> => {
    try { setCustomers(await api.customers()); } catch (error) { console.error('Failed to load customers:', error); }
  };

  const refreshInventory = async (): Promise<void> => {
    try { setInventory(await api.inventory()); } catch (error) { console.error('Failed to load inventory:', error); }
  };

  const refreshSalesReport = async (dateStr: string): Promise<void> => {
    setSalesLoading(true);
    try { setSalesReport(await api.salesReport(dateStr)); } catch (error) { console.error('Failed to load sales report:', error); } finally { setSalesLoading(false); }
  };

  useEffect(() => {
    if (session) {
      updateLastActiveTime();
      void refreshCustomers();
      void refreshInventory();
      void refreshSalesReport(salesDate);
    }
  }, [session]);

  const handleTabChange = (nextTab: Tab) => {
    setTab(nextTab);
    localStorage.setItem('bakealley_cloud_tab', nextTab);
  };

  const dataSource = useMemo(() => ({
    searchProducts: (query: string): Promise<CheckoutProduct[]> => api.searchProducts(query) as Promise<CheckoutProduct[]>,
    customers: (): Promise<CheckoutCustomer[]> => api.customers() as Promise<CheckoutCustomer[]>,
    createCustomer: (customer: { companyName?: string; contactName: string; email?: string; phone?: string; tierId: string }): Promise<CheckoutCustomer> => api.createCustomer(customer) as Promise<CheckoutCustomer>,
    createOrderWithOutbox: async (order: CheckoutOrderPayload): Promise<{ orderId: string }> => {
      const cloudOrder: CloudOrderPayload = {
        ...order,
        paymentMethod: order.paymentMethod as 'cash' | 'card' | 'gcash' | 'account',
      };
      const result = await api.createOrder(cloudOrder);
      void refreshInventory();
      void refreshSalesReport(salesDate);
      return result;
    },
    getUnitsOfMeasure: () => api.getUnitsOfMeasure(),
  }), [salesDate]);

  if (!session) {
    return (
      <LoginScreen
        onLogin={async (username, password) => {
          const loggedIn = await api.login(username, password);
          const now = Date.now();
          localStorage.setItem('bakealley_cloud_token', loggedIn.token);
          localStorage.setItem('bakealley_cloud_user', JSON.stringify(loggedIn.user));
          localStorage.setItem('bakealley_cloud_last_active', String(now));
          const initialTab: Tab = loggedIn.user.role === 'admin' ? 'employees' : 'checkout';
          handleTabChange(initialTab);
          setSession(loggedIn);
        }}
      />
    );
  }

  const isAdmin = session.user.role === 'admin';
  const availableTabs: Tab[] = isAdmin 
    ? ['checkout', 'sales', 'inventory', 'crm', 'employees']
    : ['checkout', 'sales'];

  return (
    <div className="min-h-screen bg-[#FAF6F0] text-amber-950 font-sans antialiased">
      <header className="sticky top-0 z-40 border-b border-amber-200/80 bg-white/95 backdrop-blur-md shadow-sm">
        <div className="mx-auto flex max-w-7xl items-center justify-between px-6 py-3">
          <div className="flex items-center gap-3">
            <img alt="Bake Alley logo" src={logoUrl} style={{ height: '36px', width: 'auto', objectFit: 'contain' }} />
            <div>
              <h1 className="font-bakery text-lg font-bold leading-tight tracking-tight text-amber-950">Bake Alley POS</h1>
              <p className="text-[11px] font-semibold text-amber-800/80">
                {session.user.displayName} ({session.user.role})
              </p>
            </div>
          </div>

          <div className="flex items-center gap-3">
            <nav className="flex gap-1 rounded-xl bg-amber-100/60 p-1 border border-amber-200/80">
              {availableTabs.map((item) => (
                <button
                  key={item}
                  type="button"
                  onClick={() => handleTabChange(item)}
                  className={`rounded-lg px-3 py-1.5 text-xs font-bold capitalize transition ${tab === item ? 'bg-amber-800 text-white shadow-sm' : 'text-amber-900 hover:bg-amber-200/50'}`}
                >
                  {item === 'crm' ? 'CRM' : item}
                </button>
              ))}
            </nav>

            <button
              className="rounded-xl border border-amber-200/80 bg-amber-50/50 px-3 py-1.5 text-xs font-semibold text-amber-900 transition hover:bg-amber-100/60"
              type="button"
              onClick={handleLogout}
            >
              Sign out
            </button>
          </div>
        </div>
      </header>

      <main className="mx-auto max-w-7xl px-6 py-6">
        {tab === 'checkout' && (
          <CheckoutScreen
            dataSource={dataSource}
            retailTierId={retailTierId}
            lowStockThreshold={LOW_STOCK_THRESHOLD}
            cardFeeRate={CARD_FEE_RATE}
          />
        )}
        {tab === 'sales' && (
          <SalesView
            report={salesReport}
            selectedDate={salesDate}
            onDateChange={setSalesDate}
            loading={salesLoading}
          />
        )}
        {tab === 'inventory' && (
          <InventoryView
            inventory={inventory}
            onRefresh={refreshInventory}
            onAdjustStock={async (adj) => { await api.adjustInventory(adj); await refreshInventory(); }}
            onCreateProduct={async (prod) => { await api.createInventoryProduct(prod); await refreshInventory(); }}
            isAdmin={isAdmin}
          />
        )}
        {tab === 'crm' && (
          <CrmView
            customers={customers}
            onRefresh={refreshCustomers}
            onCreateCustomer={async (cust) => { await api.createCustomer(cust); await refreshCustomers(); }}
            onDeleteCustomer={async (id) => { await api.deleteCustomer(id); await refreshCustomers(); }}
            isAdmin={isAdmin}
          />
        )}
        {tab === 'employees' && (
          <EmployeesView session={session} />
        )}
      </main>
    </div>
  );
}

function EmployeesView({ session }: { session: CloudSession }): JSX.Element {
  const [employees, setEmployees] = useState<CloudEmployee[]>([]);
  const [shifts, setShifts] = useState<CloudShift[]>([]);
  const [selectedDate, setSelectedDate] = useState<string>(today());
  const [form, setForm] = useState({ username: '', displayName: '', role: 'cashier' as 'admin' | 'cashier', password: '' });
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [deleteConfirm, setDeleteConfirm] = useState<{ userId: string; displayName: string } | null>(null);
  const [deleting, setDeleting] = useState(false);

  const isAdmin = session.user.role === 'admin';

  const refresh = async (): Promise<void> => {
    try {
      setEmployees(await api.employees(selectedDate));
      setShifts(await api.shifts(selectedDate));
      setError(null);
    } catch (reason) {
      setError(errorText(reason, 'Unable to load employees.'));
    }
  };

  useEffect(() => {
    void refresh();
  }, [selectedDate]);

  const addEmployee = async (): Promise<void> => {
    setSaving(true);
    setError(null);
    try {
      await api.createEmployee(form);
      setForm({ username: '', displayName: '', role: 'cashier', password: '' });
      setMessage('Employee added.');
      await refresh();
    } catch (reason) {
      setError(errorText(reason, 'Employee could not be added.'));
    } finally {
      setSaving(false);
    }
  };

  const deleteEmployee = async (userId: string): Promise<void> => {
    setDeleting(true);
    setError(null);
    try {
      await api.deleteEmployee(userId);
      setMessage(`Employee "${deleteConfirm?.displayName}" deactivated successfully.`);
      setDeleteConfirm(null);
      await refresh();
    } catch (reason) {
      setError(errorText(reason, 'Employee could not be deactivated.'));
    } finally {
      setDeleting(false);
    }
  };

  return (
    <section className="mx-auto max-w-7xl space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-3xl font-bold text-amber-950">Employee management</h1>
          <p className="mt-1 text-sm text-amber-700">{isAdmin ? 'Permissions, shifts, and individual sales count.' : 'Your access role and current shift.'}</p>
        </div>
        <button className="rounded-lg border border-amber-200/80 bg-white px-4 py-2 text-sm font-semibold" type="button" onClick={() => void refresh()}>
          Refresh
        </button>
      </div>

      {message && <p className="rounded-lg bg-emerald-50 p-3 text-sm text-emerald-700">{message}</p>}
      {error && <p className="rounded-lg bg-red-50 p-3 text-sm text-red-700" role="alert">{error}</p>}

      {isAdmin && (
        <div className="grid gap-3 rounded-xl border border-amber-200/80 bg-white p-5 shadow-sm md:grid-cols-4">
          <input className="rounded-lg border border-amber-200/80 px-3 py-2 text-sm" placeholder="Username" value={form.username} onChange={(event) => setForm({ ...form, username: event.target.value })} />
          <input className="rounded-lg border border-amber-200/80 px-3 py-2 text-sm" placeholder="Display name" value={form.displayName} onChange={(event) => setForm({ ...form, displayName: event.target.value })} />
          <select className="rounded-lg border border-amber-200/80 px-3 py-2 text-sm" value={form.role} onChange={(event) => setForm({ ...form, role: event.target.value as 'admin' | 'cashier' })}>
            <option value="cashier">Cashier</option>
            <option value="admin">Admin</option>
          </select>
          <input className="rounded-lg border border-amber-200/80 px-3 py-2 text-sm" minLength={12} placeholder="Password (12+ characters)" type="password" value={form.password} onChange={(event) => setForm({ ...form, password: event.target.value })} />
          <button className="rounded-lg bg-amber-800 px-4 py-2 font-semibold text-white disabled:opacity-50 md:col-span-4 hover:bg-amber-900" disabled={saving || !form.username.trim() || !form.displayName.trim() || form.password.length < 12} type="button" onClick={() => void addEmployee()}>
            {saving ? 'Saving...' : 'Add employee'}
          </button>
        </div>
      )}

      <div className="overflow-hidden rounded-xl border border-amber-200/80 bg-white shadow-sm">
        <div className="overflow-x-auto">
          <table className="w-full text-left text-sm">
            <thead className="bg-amber-50/60 text-xs uppercase tracking-wide text-amber-700">
              <tr>
                <th className="px-5 py-3">Employee</th>
                <th className="px-3 py-3">Access role</th>
                <th className="px-3 py-3 text-right">Sales count</th>
                <th className="px-5 py-3 text-right">Action</th>
              </tr>
            </thead>
            <tbody>
              {employees.map((employee) => {
                const isSelf = employee.userId === session.user.userId;
                return (
                  <tr className="border-t border-amber-100/60" key={employee.userId}>
                    <td className="px-5 py-4">
                      <strong className="text-amber-950">{employee.displayName}</strong>
                      <div className="text-xs text-amber-700">{employee.username}</div>
                    </td>
                    <td className="px-3 py-4 capitalize">{employee.role}</td>
                    <td className="px-3 py-4 text-right tabular-nums">{employee.salesCount}</td>
                    <td className="px-5 py-4 text-right">
                      {isAdmin && !isSelf && (
                        <button
                          className="rounded-lg bg-red-600 px-3 py-1.5 text-xs font-semibold text-white transition hover:bg-red-700 disabled:opacity-50"
                          type="button"
                          onClick={() => setDeleteConfirm({ userId: employee.userId, displayName: employee.displayName })}
                          disabled={deleting}
                        >
                          Deactivate
                        </button>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>

      {/* Deactivate Confirmation Modal */}
      {deleteConfirm && (
        <div className="fixed inset-0 flex items-center justify-center bg-amber-950/50 z-50 p-4">
          <div className="w-full max-w-md rounded-2xl bg-white p-6 shadow-2xl space-y-4">
            <h2 className="text-lg font-bold text-red-700">Deactivate Employee Account</h2>
            <p className="text-xs text-amber-900 leading-relaxed">
              Are you sure you want to remove <strong>{deleteConfirm.displayName}</strong>? 
              This will deactivate their account and revoke login permissions while preserving historical sales reports.
            </p>
            <div className="flex gap-2 pt-2 border-t border-amber-100">
              <button
                type="button"
                className="flex-1 rounded-xl border border-amber-300 bg-amber-50 px-4 py-2 text-xs font-bold text-amber-900 hover:bg-amber-100"
                onClick={() => setDeleteConfirm(null)}
                disabled={deleting}
              >
                Cancel
              </button>
              <button
                type="button"
                className="flex-1 rounded-xl bg-red-700 px-4 py-2 text-xs font-bold text-white hover:bg-red-800 disabled:opacity-50"
                onClick={() => void deleteEmployee(deleteConfirm.userId)}
                disabled={deleting}
              >
                {deleting ? 'Deactivating...' : 'Confirm Deactivation'}
              </button>
            </div>
          </div>
        </div>
      )}
    </section>
  );
}
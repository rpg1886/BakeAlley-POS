import { useEffect, useState, type JSX, type ReactNode } from 'react';
import { CheckoutScreen, type CheckoutCustomer, type CheckoutOrderPayload, type CheckoutProduct } from '../src/components/CheckoutScreen';
import { LoginScreen } from '../src/renderer/LoginScreen';
import { CloudPosApi, type CloudSession } from './cloudApi';
import logoUrl from '../Images/bakeAlley-Logo.jpg';
import type { CloudCustomer, CloudEmployee, CloudInventoryRow, CloudOrderPayload, CloudSalesReport, CloudShift } from './apiClient';

const api = new CloudPosApi({
  baseUrl: import.meta.env.VITE_API_URL ?? '',
  getToken: () => localStorage.getItem('bakealley_cloud_token') || sessionStorage.getItem('bakealley_cloud_token'),
});

const retailTierId = import.meta.env.VITE_RETAIL_TIER_ID ?? '2f8c8d4e-8d28-4d4d-9f41-7a52c5f2e101';
const EIGHT_HOURS_MS = 8 * 60 * 60 * 1000;

const money = new Intl.NumberFormat('en-PH', { style: 'currency', currency: 'PHP', minimumFractionDigits: 2, maximumFractionDigits: 2 });
const today = (): string => new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Manila' }).format(new Date());

type Tab = 'checkout' | 'sales' | 'inventory' | 'crm' | 'employees';

function errorText(error: unknown, fallback: string): string {
  if (error instanceof Error) return error.message;
  return fallback;
}

function clearSessionStorage(): void {
  localStorage.removeItem('bakealley_cloud_token');
  localStorage.removeItem('bakealley_cloud_user');
  localStorage.removeItem('bakealley_cloud_last_active');
  localStorage.removeItem('bakealley_pos_cart');
  localStorage.removeItem('bakealley_pos_customer_id');
  localStorage.removeItem('bakealley_pos_crm_form');
  localStorage.removeItem('bakealley_pos_emp_form');
  sessionStorage.removeItem('bakealley_cloud_token');
  sessionStorage.removeItem('bakealley_cloud_user');
  sessionStorage.removeItem('bakealley_cloud_last_active');
}

function ActionButton({ children, disabled, onClick }: { children: ReactNode; disabled?: boolean; onClick: () => void }): JSX.Element {
  return (
    <button
      className="rounded-lg bg-amber-700 px-4 py-2 text-sm font-semibold text-white shadow-sm hover:bg-amber-800 disabled:opacity-50"
      disabled={disabled}
      type="button"
      onClick={onClick}
    >
      {children}
    </button>
  );
}

function Panel({ title, children }: { title: string; children: ReactNode }): JSX.Element {
  return (
    <section className="rounded-2xl border border-amber-200/80 bg-white p-5 shadow-sm sm:p-6">
      <h1 className="mb-4 text-xl font-bold text-amber-950 sm:text-2xl">{title}</h1>
      {children}
    </section>
  );
}

function PeriodCard({ label, period }: { label: string; period?: CloudSalesReport['week'] }): JSX.Element {
  if (!period) return <div className="rounded-xl border border-amber-200/80 bg-amber-50/60 p-4 text-sm text-amber-700">Admin summary unavailable</div>;
  return (
    <div className="rounded-xl border border-amber-200/80 bg-white p-4">
      <p className="text-sm font-semibold uppercase tracking-wide text-amber-700">{label}</p>
      <p className="mt-1 text-xs text-amber-700">{period.startDate} to {period.endDate}</p>
      <div className="mt-3 flex justify-between text-sm"><span>Gross</span><strong>{money.format(Number(period.grossTotal) || 0)}</strong></div>
      <div className="flex justify-between text-sm"><span>Orders</span><strong>{Number(period.orderCount) || 0}</strong></div>
    </div>
  );
}

function SalesView({ isAdmin }: { isAdmin: boolean }): JSX.Element {
  const [selectedDate, setSelectedDate] = useState<string>(() => {
    return localStorage.getItem('bakealley_pos_sales_date') || today();
  });
  const [report, setReport] = useState<CloudSalesReport | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    localStorage.setItem('bakealley_pos_sales_date', selectedDate);
  }, [selectedDate]);

  const refresh = async (): Promise<void> => {
    setLoading(true);
    setError(null);
    try {
      setReport(await api.salesReport(selectedDate));
    } catch (reason) {
      setError(errorText(reason, 'Unable to load sales report.'));
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void refresh();
  }, [selectedDate]);

  return (
    <Panel title="Sales report">
      <div className="mb-5 flex flex-wrap items-end justify-between gap-3">
        <label className="text-sm font-semibold">
          Transaction date
          <input className="mt-1 block rounded-lg border border-amber-200/80 px-3 py-2 font-normal" type="date" value={selectedDate} onChange={(event) => setSelectedDate(event.target.value)} />
        </label>
        <ActionButton disabled={loading} onClick={() => void refresh()}>{loading ? 'Refreshing...' : 'Refresh'}</ActionButton>
      </div>
      {error && <p className="mb-4 rounded-lg bg-red-50 p-3 text-sm text-red-700" role="alert">{error}</p>}
      {report && !loading && (
        <>
          <div className="grid gap-3 sm:grid-cols-3">
            <div className="rounded-xl bg-amber-950 p-4 text-white">
              <p className="text-sm text-amber-200/80">Daily gross</p>
              <strong className="text-2xl">{money.format(Number(report.dayGrossTotal) || 0)}</strong>
              <p className="mt-1 text-xs text-amber-200/80">{Number(report.dayOrderCount) || 0} orders</p>
            </div>
            <div className="rounded-xl bg-emerald-700 p-4 text-white">
              <p className="text-sm text-emerald-100">Daily net</p>
              <strong className="text-2xl">{money.format(Number(report.dayNetTotal) || 0)}</strong>
            </div>
            <div className="rounded-xl bg-amber-50 p-4">
              <p className="text-sm text-amber-700">Items sold</p>
              <strong className="text-2xl text-amber-950">{report.items.reduce((total, item) => total + (Number(item.quantity) || 0), 0).toFixed(4)}</strong>
            </div>
          </div>
          {isAdmin && (
            <div className="mt-4 grid gap-3 md:grid-cols-3">
              <PeriodCard label="This week" period={report.week} />
              <PeriodCard label="This month" period={report.month} />
              <PeriodCard label="This year" period={report.year} />
            </div>
          )}
          <div className="mt-5 overflow-x-auto">
            <table className="w-full text-left text-sm">
              <thead className="border-b text-xs uppercase text-amber-700">
                <tr><th className="py-2">Time / customer</th><th>Item</th><th>SKU</th><th>Qty</th><th>Amount</th><th>Payment</th></tr>
              </thead>
              <tbody>
                {report.items.map((item, index) => (
                  <tr className="border-b last:border-0" key={`$ [cite: 79, 173]{item.orderId}-${index}`}>
                    <td className="py-3">
                      <div>{new Date(item.soldAt).toLocaleTimeString()}</div>
                      <div className="text-xs text-amber-700">{item.customerName}</div>
                    </td>
                    <td className="font-semibold">{item.itemName}</td>
                    <td className="font-mono text-xs">{item.sku}</td>
                    <td>{Number(item.quantity).toFixed(4)}</td>
                    <td>{money.format(Number(item.amount) || 0)}</td>
                    <td className="capitalize">{item.paymentMethod}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            {report.items.length === 0 && <p className="py-8 text-center text-amber-700">No completed sales for this date.</p>}
          </div>
        </>
      )}
    </Panel>
  );
}

function InventoryView({ isAdmin }: { isAdmin: boolean }): JSX.Element {
  const [rows, setRows] = useState<CloudInventoryRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const refresh = async (): Promise<void> => {
    setLoading(true);
    setError(null);
    try {
      setRows(await api.inventory());
    } catch (reason) {
      setError(errorText(reason, 'Unable to load inventory.'));
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void refresh();
  }, []);

  return (
    <Panel title="Inventory stock">
      <div className="mb-4 flex justify-end">
        <ActionButton disabled={loading} onClick={() => void refresh()}>{loading ? 'Refreshing...' : 'Refresh'}</ActionButton>
      </div>
      {error && <p className="mb-4 rounded-lg bg-red-50 p-3 text-sm text-red-700" role="alert">{error}</p>}
      <div className="overflow-x-auto">
        <table className="w-full text-left text-sm">
          <thead className="border-b text-xs uppercase text-amber-700">
            <tr><th className="py-2">Product</th><th>SKU</th><th>Expiration</th><th className="text-right">Qty</th><th className="text-right">Capital</th><th className="text-right">Retail price</th></tr>
          </thead>
          <tbody>
            {rows.map((row) => (
              <tr className="border-b last:border-0" key={row.variantId}>
                <td className="py-3 font-semibold">{row.variantName}</td>
                <td className="font-mono text-xs">{row.sku}</td>
                <td>{row.expirationDate ?? 'No expiry'}</td>
                <td className="text-right">{Number(row.quantityOnHand).toFixed(4)}</td>
                <td className="text-right">{money.format(Number(row.initialCapital) || 0)}</td>
                <td className="text-right font-semibold">{money.format(Number(row.retailPrice) || 0)}</td>
              </tr>
            ))}
          </tbody>
        </table>
        {rows.length === 0 && !loading && <p className="py-8 text-center text-amber-700">No products found.</p>}
      </div>
    </Panel>
  );
}

function CrmView({ session, customers, refresh }: { session: CloudSession; customers: CloudCustomer[]; refresh: () => Promise<void> }): JSX.Element {
  const [form, setForm] = useState(() => {
    try {
      const saved = localStorage.getItem('bakealley_pos_crm_form');
      return saved ? JSON.parse(saved) : { contactName: '', companyName: '', email: '', phone: '' };
    } catch {
      return { contactName: '', companyName: '', email: '', phone: '' };
    }
  });

  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    localStorage.setItem('bakealley_pos_crm_form', JSON.stringify(form));
  }, [form]);

  const submit = async (): Promise<void> => {
    setSaving(true);
    setMessage(null);
    setError(null);
    try {
      await api.createCustomer({ ...form, tierId: retailTierId });
      setForm({ contactName: '', companyName: '', email: '', phone: '' });
      localStorage.removeItem('bakealley_pos_crm_form');
      setMessage('Customer added.');
      await refresh();
    } catch (reason) {
      setError(errorText(reason, 'Customer could not be added.'));
    } finally {
      setSaving(false);
    }
  };

  const remove = async (customer: CloudCustomer): Promise<void> => {
    if (!window.confirm(`Delete ${customer.displayName}?`)) return;
    try {
      await api.deleteCustomer(customer.customerId);
      setMessage('Customer deleted.');
      await refresh();
    } catch (reason) {
      setError(errorText(reason, 'Customer could not be deleted.'));
    }
  };

  return (
    <Panel title="Customer relationships">
      <div className="mb-4 flex justify-end">
        <ActionButton onClick={() => void refresh()}>Refresh</ActionButton>
      </div>
      <div className="grid gap-3 md:grid-cols-5">
        <input className="rounded-lg border p-3" placeholder="Company" value={form.companyName} onChange={(event) => setForm({ ...form, companyName: event.target.value })} />
        <input className="rounded-lg border p-3" placeholder="Contact name *" value={form.contactName} onChange={(event) => setForm({ ...form, contactName: event.target.value })} />
        <input className="rounded-lg border p-3" placeholder="Email" type="email" value={form.email} onChange={(event) => setForm({ ...form, email: event.target.value })} />
        <input className="rounded-lg border p-3" placeholder="Phone" value={form.phone} onChange={(event) => setForm({ ...form, phone: event.target.value })} />
        <button className="rounded-lg bg-amber-600 px-4 py-2 font-semibold text-white disabled:opacity-50" disabled={saving || !form.contactName.trim()} type="button" onClick={() => void submit()}>{saving ? 'Saving...' : 'Add customer'}</button>
      </div>
      {message && <p className="mt-3 rounded-lg bg-emerald-50 p-3 text-sm text-emerald-700">{message}</p>}
      {error && <p className="mt-3 rounded-lg bg-red-50 p-3 text-sm text-red-700" role="alert">{error}</p>}
      <div className="mt-5 overflow-x-auto">
        <table className="w-full text-left text-sm">
          <thead className="border-b text-xs uppercase text-amber-700">
            <tr><th className="py-2">Customer</th><th>Company</th><th>Email</th><th>Phone</th><th>Tier</th><th></th></tr>
          </thead>
          <tbody>
            {customers.map((customer) => {
              const parts = customer.displayName.split(' - ');
              return (
                <tr className="border-b last:border-0" key={customer.customerId}>
                  <td className="py-3 font-semibold">{parts.at(-1)}</td>
                  <td>{parts.length > 1 ? parts : 'Walk-in'}</td>
                  <td>{customer.email || '—'}</td>
                  <td>{customer.phone || '—'}</td>
                  <td>{customer.tierId === retailTierId ? 'Retail' : 'Wholesale'}</td>
                  <td>
                    {session.user.role === 'admin' && (
                      <button className="text-sm font-semibold text-red-600" type="button" onClick={() => void remove(customer)}>
                        Delete
                      </button>
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </Panel>
  );
}

function EmployeesView({ session }: { session: CloudSession }): JSX.Element {
  const [employees, setEmployees] = useState<CloudEmployee[]>([]);
  const [shifts, setShifts] = useState<CloudShift[]>([]);

  const [selectedDate, setSelectedDate] = useState<string>(() => {
    return localStorage.getItem('bakealley_pos_emp_date') || today();
  });

  const [form, setForm] = useState(() => {
    try {
      const saved = localStorage.getItem('bakealley_pos_emp_form');
      return saved ? JSON.parse(saved) : { username: '', displayName: '', role: 'cashier' as 'admin' | 'cashier', password: '' };
    } catch {
      return { username: '', displayName: '', role: 'cashier' as 'admin' | 'cashier', password: '' };
    }
  });

  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    localStorage.setItem('bakealley_pos_emp_date', selectedDate);
  }, [selectedDate]);

  useEffect(() => {
    localStorage.setItem('bakealley_pos_emp_form', JSON.stringify(form));
  }, [form]);

  const isAdmin = session.user.role === 'admin';

  const refresh = async (): Promise<void> => {
    try {
      setEmployees(await api.employees());
      setShifts(await api.shifts(selectedDate));
      setError(null);
    } catch (reason) {
      setError(errorText(reason, 'Unable to load employees.'));
    }
  };

  useEffect(() => {
    void refresh();
  }, [selectedDate]);

  const ownShift = shifts.find((shift) => shift.userId === session.user.userId && !shift.clockOut);

  const clock = async (): Promise<void> => {
    try {
      if (ownShift) await api.clockOut();
      else await api.clockIn();
      setMessage(ownShift ? 'Clocked out successfully.' : 'Clocked in successfully.');
      await refresh();
    } catch (reason) {
      setError(errorText(reason, 'Unable to update shift.'));
    }
  };

  const addEmployee = async (): Promise<void> => {
    setSaving(true);
    setError(null);
    try {
      await api.createEmployee(form);
      setForm({ username: '', displayName: '', role: 'cashier', password: '' });
      localStorage.removeItem('bakealley_pos_emp_form');
      setMessage('Employee added.');
      await refresh();
    } catch (reason) {
      setError(errorText(reason, 'Employee could not be added.'));
    } finally {
      setSaving(false);
    }
  };

  return (
    <section className="mx-auto max-w-7xl">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-3xl font-bold text-amber-950">Employee management</h1>
          <p className="mt-1 text-sm text-amber-700">{isAdmin ? 'Permissions, shifts, and individual sales count.' : 'Your access role and current shift.'}</p>
        </div>
        <button className="rounded-lg border border-amber-200/80 bg-white px-4 py-2 text-sm font-semibold" type="button" onClick={() => void refresh()}>
          Refresh
        </button>
      </div>
      {message && <p className="mt-4 rounded-lg bg-emerald-50 p-3 text-sm text-emerald-700">{message}</p>}
      {error && <p className="mt-4 rounded-lg bg-red-50 p-3 text-sm text-red-700" role="alert">{error}</p>}
      {isAdmin && (
        <div className="mt-6 grid gap-3 rounded-xl border border-amber-200/80 bg-white p-5 shadow-sm md:grid-cols-4">
          <input className="rounded-lg border border-amber-200/80 px-3 py-2" placeholder="Username" value={form.username} onChange={(event) => setForm({ ...form, username: event.target.value })} />
          <input className="rounded-lg border border-amber-200/80 px-3 py-2" placeholder="Display name" value={form.displayName} onChange={(event) => setForm({ ...form, displayName: event.target.value })} />
          <select className="rounded-lg border border-amber-200/80 px-3 py-2" value={form.role} onChange={(event) => setForm({ ...form, role: event.target.value as 'admin' | 'cashier' })}>
            <option value="cashier">Cashier</option>
            <option value="admin">Admin</option>
          </select>
          <input className="rounded-lg border border-amber-200/80 px-3 py-2" minLength={12} placeholder="Password (12+ characters)" type="password" value={form.password} onChange={(event) => setForm({ ...form, password: event.target.value })} />
          <button className="rounded-lg bg-amber-600 px-4 py-2 font-semibold text-white disabled:opacity-50 md:col-span-4" disabled={saving || !form.username.trim() || !form.displayName.trim() || form.password.length < 12} type="button" onClick={() => void addEmployee()}>
            {saving ? 'Saving...' : 'Add employee'}
          </button>
        </div>
      )}
      <div className="mt-6 overflow-hidden rounded-xl border border-amber-200/80 bg-white shadow-sm">
        <div className="overflow-x-auto">
          <table className="w-full text-left text-sm">
            <thead className="bg-amber-50/60 text-xs uppercase tracking-wide text-amber-700">
              <tr>
                <th className="px-5 py-3">Employee</th>
                <th className="px-3 py-3">Access role</th>
                <th className="px-3 py-3">Current shift</th>
                {isAdmin && <th className="px-3 py-3 text-right">Sales amount</th>}
                <th className="px-3 py-3 text-right">Sales count</th>
                <th><span className="sr-only">Action</span></th>
              </tr>
            </thead>
            <tbody>
              {employees.map((employee) => {
                const employeeShift = shifts.find((shift) => shift.userId === employee.userId && !shift.clockOut);
                const isSelf = employee.userId === session.user.userId;
                return (
                  <tr className="border-t border-amber-100/60" key={employee.userId}>
                    <td className="px-5 py-4">
                      <strong>{employee.displayName}</strong>
                      <div className="text-xs text-amber-700">{employee.username}</div>
                    </td>
                    <td className="px-3 py-4 capitalize">{employee.role}</td>
                    <td className="px-3 py-4">{employeeShift ? `Clocked in ${new Date(employeeShift.clockIn).toLocaleTimeString()}` : 'Off shift'}</td>
                    {isAdmin && <td className="px-3 py-4 text-right">{money.format(Number(employee.salesAmount) || 0)}</td>}
                    <td className="px-3 py-4 text-right">{employee.salesCount}</td>
                    <td className="pr-5 text-right">
                      {isSelf && (
                        <button className="rounded-lg border border-amber-200/80 px-3 py-2 text-xs font-semibold" type="button" onClick={() => void clock()}>
                          {ownShift ? 'Clock out' : 'Clock in'}
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
      {isAdmin && (
        <div className="mt-6 rounded-xl border border-amber-200/80 bg-white p-5 shadow-sm">
          <div className="flex flex-wrap items-end justify-between gap-3">
            <div>
              <h2 className="font-semibold">Shift calendar</h2>
              <p className="text-sm text-amber-700">Clock-in and clock-out records for the selected day.</p>
            </div>
            <input className="rounded-lg border border-amber-200/80 px-3 py-2" type="date" value={selectedDate} onChange={(event) => setSelectedDate(event.target.value)} />
          </div>
          <div className="mt-4 overflow-x-auto">
            <table className="w-full text-left text-sm">
              <thead className="text-xs uppercase tracking-wide text-amber-700">
                <tr><th className="py-3">Employee</th><th className="py-3">Role</th><th className="py-3">Clock in</th><th className="py-3">Clock out</th></tr>
              </thead>
              <tbody>
                {shifts.map((shift) => {
                  const shiftEmployee = employees.find((employee) => employee.userId === shift.userId);
                  return (
                    <tr className="border-t border-amber-100/60" key={shift.shiftId}>
                      <td className="py-3">{shift.displayName}</td>
                      <td className="py-3 capitalize">{shiftEmployee?.role ?? '—'}</td>
                      <td className="py-3">{new Date(shift.clockIn).toLocaleTimeString()}</td>
                      <td className="py-3">{shift.clockOut ? new Date(shift.clockOut).toLocaleTimeString() : 'Still clocked in'}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </section>
  );
}

export function CloudApp(): JSX.Element {
  const [session, setSession] = useState<CloudSession | null>(() => {
    const token = localStorage.getItem('bakealley_cloud_token') || sessionStorage.getItem('bakealley_cloud_token');
    const userJson = localStorage.getItem('bakealley_cloud_user') || sessionStorage.getItem('bakealley_cloud_user');
    const lastActiveStr = localStorage.getItem('bakealley_cloud_last_active');

    if (token && userJson && lastActiveStr) {
      const lastActiveTime = Number(lastActiveStr);
      if (Date.now() - lastActiveTime > EIGHT_HOURS_MS) {
        clearSessionStorage();
        return null;
      }
      try {
        return { token, user: JSON.parse(userJson) };
      } catch {
        clearSessionStorage();
        return null;
      }
    }
    return null;
  });

  const [tab, setTab] = useState<Tab>(() => {
    const savedTab = localStorage.getItem('bakealley_cloud_tab') as Tab;
    return savedTab && ['checkout', 'sales', 'inventory', 'crm', 'employees'].includes(savedTab)
      ? savedTab
      : 'checkout';
  });

  const [customers, setCustomers] = useState<CloudCustomer[]>([]);

  const changeTab = (newTab: Tab): void => {
    setTab(newTab);
    localStorage.setItem('bakealley_cloud_tab', newTab);
  };

  const updateLastActiveTime = (): void => {
    if (session) {
      localStorage.setItem('bakealley_cloud_last_active', String(Date.now()));
    }
  };

  const refreshCustomers = async (): Promise<void> => {
    try {
      setCustomers(await api.customers());
    } catch (error) {
      console.error('Failed to load customers:', error);
    }
  };

  useEffect(() => {
    if (session) {
      updateLastActiveTime();
      void refreshCustomers();
    }
  }, [session]);

  useEffect(() => {
    if (!session) return;

    const handleActivity = (): void => {
      const lastActiveStr = localStorage.getItem('bakealley_cloud_last_active');
      if (lastActiveStr && Date.now() - Number(lastActiveStr) > EIGHT_HOURS_MS) {
        clearSessionStorage();
        setSession(null);
      } else {
        updateLastActiveTime();
      }
    };

    window.addEventListener('click', handleActivity);
    window.addEventListener('keydown', handleActivity);
    window.addEventListener('mousemove', handleActivity);
    window.addEventListener('scroll', handleActivity);

    return () => {
      window.removeEventListener('click', handleActivity);
      window.removeEventListener('keydown', handleActivity);
      window.removeEventListener('mousemove', handleActivity);
      window.removeEventListener('scroll', handleActivity);
    };
  }, [session]);

  if (!session) {
    return (
      <LoginScreen
        onLogin={async (username, password) => {
          const loggedIn = await api.login(username, password);
          const now = Date.now();
          localStorage.setItem('bakealley_cloud_token', loggedIn.token);
          localStorage.setItem('bakealley_cloud_user', JSON.stringify(loggedIn.user));
          localStorage.setItem('bakealley_cloud_last_active', String(now));
          setSession(loggedIn);
        }}
      />
    );
  }

  const dataSource = {
    searchProducts: (query: string): Promise<CheckoutProduct[]> => api.searchProducts(query) as Promise<CheckoutProduct[]>,
    createOrderWithOutbox: async (order: CheckoutOrderPayload): Promise<{ orderId: string }> => {
      const cloudOrder: CloudOrderPayload = {
        ...order,
        orderId: crypto.randomUUID(),
        items: order.items.map((item) => ({ ...item, orderItemId: crypto.randomUUID() })),
        changeDue: order.paymentMethod === 'cash' ? Number((order.cashReceived - order.totalAmount).toFixed(2)) : 0
      };
      return api.createOrder(cloudOrder);
    }
  };

  const tabs: Array<[Tab, string]> = [
    ['checkout', 'Checkout'],
    ['sales', 'Sales'],
    ['inventory', 'Inventory'],
    ['crm', 'CRM'],
    ['employees', 'Employees']
  ];

  return (
    <div className="min-h-screen bg-[#FAF6F0]">
      <header className="sticky top-0 z-30 border-b border-amber-200/60 bg-white/90 px-4 py-4 backdrop-blur-md sm:px-6">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-2">
            <img alt="Bake Alley logo" className="h-9 w-9 rounded-full border border-amber-200/80 object-cover shadow-sm" src={logoUrl} />
            <strong className="font-bakery text-lg text-amber-950">Bake Alley Cloud POS</strong>
            <span className="ml-1 rounded-full bg-amber-100 px-3 py-1 text-xs font-semibold text-amber-900">
              {session.user.displayName} · {session.user.role}
            </span>
          </div>
          <button
            className="text-sm font-semibold text-amber-700 hover:text-amber-900"
            type="button"
            onClick={() => {
              clearSessionStorage();
              setSession(null);
            }}
          >
            Log out
          </button>
        </div>
        <nav className="mt-4 flex gap-1 overflow-x-auto rounded-xl bg-amber-100/50 p-1">
          {tabs.map(([key, label]) => (
            <button
              className={`whitespace-nowrap rounded-lg px-3 py-2 text-sm font-semibold transition ${
                tab === key ? 'bg-amber-700 text-white shadow-sm' : 'text-amber-900 hover:bg-white/70'
              }`}
              type="button"
              key={key}
              onClick={() => changeTab(key)}
            >
              {label}
            </button>
          ))}
        </nav>
      </header>
      {tab === 'checkout' && <CheckoutScreen dataSource={dataSource} scaleEnabled={false} customers={customers as CheckoutCustomer[]} retailTierId={retailTierId} taxRate={0} />}
      {tab !== 'checkout' && (
        <main className="mx-auto max-w-7xl p-4 sm:p-6">
          {tab === 'sales' && <SalesView isAdmin={session.user.role === 'admin'} />}
          {tab === 'inventory' && <InventoryView isAdmin={session.user.role === 'admin'} />}
          {tab === 'crm' && <CrmView session={session} customers={customers} refresh={refreshCustomers} />}
          {tab === 'employees' && <EmployeesView session={session} />}
        </main>
      )}
    </div>
  );
}
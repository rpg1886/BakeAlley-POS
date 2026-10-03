import { Fragment, useEffect, useMemo, useState, type JSX, type ReactNode } from 'react';
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
const money = new Intl.NumberFormat('en-PH', { style: 'currency', currency: 'PHP', minimumFractionDigits: 2, maximumFractionDigits: 2 });
const today = (): string => new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Manila' }).format(new Date());
type Tab = 'checkout' | 'sales' | 'inventory' | 'crm' | 'employees';

export interface ExtendedCloudShift extends CloudShift {
  openingFloat?: number;
  closingCashCount?: number;
  expectedCash?: number;
  cashDiscrepancy?: number;
  status?: string;
  notes?: string | null;
}

function errorText(reason: unknown, fallback: string): string {
  if (reason instanceof Error) return reason.message;
  if (typeof reason === 'string') return reason;
  return fallback;
}

async function fetchClockIn(openingFloat: number = 1500, notes: string | null = null): Promise<any> {
  const token = sessionStorage.getItem('bakealley_cloud_token') || localStorage.getItem('bakealley_cloud_token');
  const baseUrl = import.meta.env.VITE_API_URL ?? '';
  const response = await fetch(`${baseUrl}/api/v1/employees/clock-in`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', ...(token ? { authorization: `Bearer ${token}` } : {}) },
    body: JSON.stringify({ openingFloat, notes }),
  });
  if (!response.ok) {
    const err = await response.json().catch(() => ({}));
    throw new Error(err.message || err.error || 'Clock in failed');
  }
  return response.json();
}

async function fetchClockOut(closingCashCount: number = 0, notes: string | null = null): Promise<any> {
  const token = sessionStorage.getItem('bakealley_cloud_token') || localStorage.getItem('bakealley_cloud_token');
  const baseUrl = import.meta.env.VITE_API_URL ?? '';
  const response = await fetch(`${baseUrl}/api/v1/employees/clock-out`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', ...(token ? { authorization: `Bearer ${token}` } : {}) },
    body: JSON.stringify({ closingCashCount, notes }),
  });
  if (!response.ok) {
    const err = await response.json().catch(() => ({}));
    throw new Error(err.message || err.error || 'Clock out failed');
  }
  return response.json();
}

function ActionButton({ children, onClick, disabled = false }: { children: ReactNode; onClick: () => void; disabled?: boolean }): JSX.Element {
  return (
    <button
      type="button"
      className="rounded-lg border border-amber-300 bg-amber-50 px-3 py-1.5 text-xs font-bold text-amber-900 shadow-sm transition hover:bg-amber-100 disabled:opacity-50"
      disabled={disabled}
      onClick={onClick}
    >
      {children}
    </button>
  );
}

function Panel({ title, children }: { title: string; children: ReactNode }): JSX.Element {
  return (
    <section className="rounded-2xl border border-amber-200/80 bg-white p-5 shadow-sm">
      <h2 className="mb-4 text-lg font-bold text-amber-950">{title}</h2>
      {children}
    </section>
  );
}

function PeriodCard({ label, period }: { label: string; period?: CloudSalesReport['week'] }): JSX.Element {
  if (!period) return <div className="rounded-xl border border-amber-200/80 bg-amber-50/30 p-4 text-xs text-amber-800">No data</div>;
  return (
    <div className="rounded-xl border border-amber-200/80 bg-white p-4 shadow-sm">
      <p className="text-xs font-bold uppercase tracking-wider text-amber-800">{label}</p>
      <p className="mt-1 text-[11px] text-amber-700/80">{period.startDate} to {period.endDate}</p>
      <dl className="mt-3 space-y-1.5 text-xs">
        <div className="flex justify-between"><dt className="text-amber-800">Gross Sales</dt><dd className="font-bold text-amber-950 tabular-nums">{money.format(period.grossTotal)}</dd></div>
        <div className="flex justify-between"><dt className="text-amber-800">Net Sales</dt><dd className="font-bold text-emerald-800 tabular-nums">{money.format(period.netTotal)}</dd></div>
        <div className="flex justify-between"><dt className="text-amber-800">Completed Orders</dt><dd className="font-semibold text-amber-950">{period.orderCount}</dd></div>
      </dl>
    </div>
  );
}

interface GroupedTransaction {
  orderId: string;
  soldAt: string;
  customerName: string;
  cashierName?: string;
  paymentMethod: string;
  totalAmount: number;
  cashReceived: number;
  changeDue: number;
  items: Array<{ itemName: string; sku: string; quantity: number; amount: number }>;
}

function SalesView({ isAdmin }: { isAdmin: boolean }): JSX.Element {
  const [selectedDate, setSelectedDate] = useState<string>(() => localStorage.getItem('bakealley_pos_sales_date') || today());
  const [report, setReport] = useState<CloudSalesReport | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [expandedOrderId, setExpandedOrderId] = useState<string | null>(null);

  useEffect(() => { localStorage.setItem('bakealley_pos_sales_date', selectedDate); }, [selectedDate]);

  const refresh = async (): Promise<void> => {
    setLoading(true);
    setError(null);
    try { setReport(await api.salesReport(selectedDate)); } catch (reason) { setError(errorText(reason, 'Unable to load sales report.')); } finally { setLoading(false); }
  };

  useEffect(() => { void refresh(); }, [selectedDate]);

  const groupedTransactions = useMemo(() => {
    if (!report?.items) return [];
    const map = new Map<string, GroupedTransaction>();
    for (const item of report.items) {
      if (!map.has(item.orderId)) {
        map.set(item.orderId, {
          orderId: item.orderId,
          soldAt: item.soldAt,
          customerName: item.customerName || 'Walk-in',
          cashierName: (item as any).cashierName || 'Staff',
          paymentMethod: item.paymentMethod || 'cash',
          totalAmount: Number((item as any).totalAmount) || 0,
          cashReceived: Number((item as any).cashReceived) || 0,
          changeDue: Number((item as any).changeDue) || 0,
          items: [],
        });
      }
      const tx = map.get(item.orderId)!;
      tx.items.push({ itemName: item.itemName, sku: item.sku, quantity: Number(item.quantity) || 0, amount: Number(item.amount) || 0 });
      if (!tx.totalAmount) tx.totalAmount = tx.items.reduce((sum, i) => sum + i.amount, 0);
    }
    return Array.from(map.values());
  }, [report]);

  const toggleExpand = (orderId: string) => { setExpandedOrderId((prev) => (prev === orderId ? null : orderId)); };

  return (
    <Panel title="Sales report">
      <div className="mb-5 flex flex-wrap items-end justify-between gap-3">
        <label className="text-sm font-semibold">Transaction date<input className="mt-1 block rounded-lg border border-amber-200/80 px-3 py-2 font-normal" type="date" value={selectedDate} onChange={(event) => setSelectedDate(event.target.value)} /></label>
        <ActionButton disabled={loading} onClick={() => void refresh()}>{loading ? 'Refreshing...' : 'Refresh'}</ActionButton>
      </div>
      {error && <p className="mb-4 rounded-lg bg-red-50 p-3 text-sm text-red-700" role="alert">{error}</p>}
      {report && !loading && (
        <>
          <div className="grid gap-3 sm:grid-cols-3">
            <div className="rounded-xl bg-amber-950 p-4 text-white"><p className="text-sm text-amber-200/80">Daily gross</p><strong className="text-2xl">{money.format(Number(report.dayGrossTotal) || 0)}</strong><p className="mt-1 text-xs text-amber-200/80">{Number(report.dayOrderCount) || 0} orders</p></div>
            <div className="rounded-xl bg-emerald-700 p-4 text-white"><p className="text-sm text-emerald-100">Daily net</p><strong className="text-2xl">{money.format(Number(report.dayNetTotal) || 0)}</strong></div>
            <div className="rounded-xl bg-amber-50 p-4"><p className="text-sm text-amber-700">Items sold</p><strong className="text-2xl text-amber-950">{report.items.reduce((total, item) => total + (Number(item.quantity) || 0), 0).toFixed(4)}</strong></div>
          </div>

          <div className="mt-5 overflow-x-auto">
            <table className="w-full text-left text-sm">
              <thead className="border-b text-xs uppercase text-amber-700">
                <tr>
                  <th className="py-2.5 px-3">Time / Customer</th>
                  <th className="py-2.5 px-3">Cashier</th>
                  <th className="py-2.5 px-3">Purchased Items</th>
                  <th className="py-2.5 px-3">Total Amount</th>
                  <th className="py-2.5 px-3">Payment</th>
                  <th className="py-2.5 px-3 text-right">Details</th>
                </tr>
              </thead>
              <tbody>
                {groupedTransactions.map((tx) => {
                  const methodStr = String(tx.paymentMethod || 'cash').toLowerCase();
                  let paymentBadge = <span className="font-semibold text-amber-950">{"\u{1F4B5}"} Cash</span>;
                  if (methodStr.includes('gcash')) paymentBadge = <span className="font-bold text-sky-700">{"\u{1F4F2}"} GCash</span>;
                  else if (methodStr.includes('card')) paymentBadge = <span className="font-bold text-blue-700">{"\u{1F4B3}"} Card</span>;
                  else if (methodStr.includes('account')) paymentBadge = <span className="font-semibold text-amber-900">{"\u{1F4CB}"} Account</span>;

                  const isExpanded = expandedOrderId === tx.orderId;
                  return (
                    <Fragment key={tx.orderId}>
                      <tr className={`border-b cursor-pointer transition-colors ${isExpanded ? 'bg-amber-50/70' : 'hover:bg-amber-50/30'}`} onClick={() => toggleExpand(tx.orderId)}>
                        <td className="py-3 px-3"><div className="font-semibold text-amber-950">{new Date(tx.soldAt).toLocaleTimeString()}</div><div className="text-xs text-amber-700">{tx.customerName}</div></td>
                        <td className="py-3 px-3 font-semibold text-amber-900">{tx.cashierName || 'Staff'}</td>
                        <td className="py-3 px-3 font-medium text-amber-900">{tx.items.length} {tx.items.length === 1 ? 'item' : 'items'}</td>
                        <td className="py-3 px-3 font-bold text-amber-950 tabular-nums">{money.format(tx.totalAmount)}</td>
                        <td className="py-3 px-3">{paymentBadge}</td>
                        <td className="py-3 px-3 text-right">
                          <button type="button" className="rounded-lg bg-amber-100 px-2.5 py-1 text-xs font-bold text-amber-900 hover:bg-amber-200" onClick={(e) => { e.stopPropagation(); toggleExpand(tx.orderId); }}>
                            {isExpanded ? '\u25B2 Hide' : '\u25BC View Items'}
                          </button>
                        </td>
                      </tr>
                      {isExpanded && (
                        <tr className="bg-amber-50/40">
                          <td colSpan={6} className="p-3 sm:p-4">
                            <div className="rounded-xl border border-amber-200/80 bg-white p-4 shadow-sm">
                              <div className="flex flex-wrap items-center justify-between border-b border-amber-100 pb-2 mb-3">
                                <h4 className="font-bold text-amber-950 text-sm">Transaction Receipt {"\u2014"} {new Date(tx.soldAt).toLocaleTimeString()}</h4>
                                <span className="text-xs font-mono text-amber-700">Order ID: {tx.orderId}</span>
                              </div>
                              <table className="w-full text-left text-xs mb-3">
                                <thead className="border-b bg-amber-50/60 text-amber-800">
                                  <tr><th className="py-2 px-2">Item Name</th><th className="py-2 px-2">SKU</th><th className="py-2 px-2 text-right">Quantity</th><th className="py-2 px-2 text-right">Amount</th></tr>
                                </thead>
                                <tbody>
                                  {tx.items.map((subItem, idx) => (
                                    <tr key={idx} className="border-b last:border-0 border-amber-100/60">
                                      <td className="py-2 px-2 font-semibold text-amber-950">{subItem.itemName}</td>
                                      <td className="py-2 px-2 font-mono text-amber-700">{subItem.sku}</td>
                                      <td className="py-2 px-2 text-right tabular-nums">{subItem.quantity.toFixed(4)}</td>
                                      <td className="py-2 px-2 text-right font-semibold text-amber-950 tabular-nums">{money.format(subItem.amount)}</td>
                                    </tr>
                                  ))}
                                </tbody>
                              </table>
                              <div className="flex flex-wrap items-center justify-between rounded-lg bg-amber-50/80 p-3 text-xs border border-amber-200/60">
                                <div className="space-y-1">
                                  <div><span className="font-semibold text-amber-800">Cashier / Staff:</span>{' '}<span className="font-bold text-amber-950">{tx.cashierName || 'Staff'}</span></div>
                                  <div><span className="font-semibold text-amber-800">Payment Method:</span>{' '}<span className="capitalize font-bold text-amber-950">{tx.paymentMethod}</span></div>
                                  {methodStr.includes('cash') && (
                                    <>
                                      <div><span className="text-amber-800">Cash Received:</span>{' '}<strong className="text-emerald-800 tabular-nums">{money.format(tx.cashReceived)}</strong></div>
                                      <div><span className="text-amber-800">Change Given:</span>{' '}<strong className="text-amber-950 tabular-nums">{money.format(tx.changeDue)}</strong></div>
                                    </>
                                  )}
                                </div>
                                <div className="text-right mt-2 sm:mt-0">
                                  <span className="text-amber-800 font-semibold block">Total Transaction Amount</span>
                                  <strong className="text-base text-amber-950 tabular-nums">{money.format(tx.totalAmount)}</strong>
                                </div>
                              </div>
                            </div>
                          </td>
                        </tr>
                      )}
                    </Fragment>
                  );
                })}
              </tbody>
            </table>
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
  const refresh = async (): Promise<void> => { setLoading(true); setError(null); try { setRows(await api.inventory()); } catch (reason) { setError(errorText(reason, 'Unable to load inventory.')); } finally { setLoading(false); } };
  useEffect(() => { void refresh(); }, []);
  return (
    <Panel title="Inventory control">
      <div className="mb-4 flex justify-between items-center"><p className="text-xs text-amber-700">Live stock quantities sorted by earliest expiration.</p><ActionButton disabled={loading} onClick={() => void refresh()}>{loading ? 'Refreshing...' : 'Refresh'}</ActionButton></div>
      {error && <p className="mb-4 rounded-lg bg-red-50 p-3 text-sm text-red-700">{error}</p>}
      <div className="overflow-x-auto">
        <table className="w-full text-left text-sm">
          <thead className="border-b text-xs uppercase text-amber-700">
            <tr><th className="py-2 px-3">Product / SKU</th><th className="py-2 px-3 text-right">Quantity</th><th className="py-2 px-3 text-right">Retail Price</th>{isAdmin && <th className="py-2 px-3 text-right">Initial Capital</th>}</tr>
          </thead>
          <tbody>
            {rows.map((row) => (
              <tr key={row.variantId} className="border-b border-amber-100/60">
                <td className="py-3 px-3"><strong className="text-amber-950 block">{row.variantName}</strong><span className="font-mono text-xs text-amber-700">{row.sku}</span></td>
                <td className="py-3 px-3 text-right font-bold tabular-nums text-amber-950">{row.quantityOnHand.toFixed(4)}</td>
                <td className="py-3 px-3 text-right font-bold tabular-nums text-amber-950">{money.format(row.retailPrice)}</td>
                {isAdmin && <td className="py-3 px-3 text-right tabular-nums text-amber-800">{money.format(row.initialCapital)}</td>}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </Panel>
  );
}

function CrmView({ session, customers, refresh }: { session: CloudSession; customers: CloudCustomer[]; refresh: () => Promise<void> }): JSX.Element {
  const [form, setForm] = useState({ contactName: '', companyName: '', email: '', phone: '', tierId: retailTierId });
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const save = async (): Promise<void> => {
    setSaving(true); setError(null);
    try { await api.createCustomer(form); setForm({ contactName: '', companyName: '', email: '', phone: '', tierId: retailTierId }); await refresh(); } catch (reason) { setError(errorText(reason, 'Failed to create customer')); } finally { setSaving(false); }
  };

  return (
    <Panel title="Customer relationship management">
      <div className="mb-4 flex justify-between items-center"><p className="text-xs text-amber-700">Customer directory and wholesale accounts.</p><ActionButton onClick={() => void refresh()}>Refresh</ActionButton></div>
      {error && <p className="mb-4 rounded-lg bg-red-50 p-3 text-sm text-red-700">{error}</p>}
      <div className="mb-6 grid gap-2 sm:grid-cols-4">
        <input className="rounded-lg border border-amber-200 px-3 py-1.5 text-xs" placeholder="Contact name *" value={form.contactName} onChange={(e) => setForm({ ...form, contactName: e.target.value })} />
        <input className="rounded-lg border border-amber-200 px-3 py-1.5 text-xs" placeholder="Company name" value={form.companyName} onChange={(e) => setForm({ ...form, companyName: e.target.value })} />
        <input className="rounded-lg border border-amber-200 px-3 py-1.5 text-xs" placeholder="Phone" value={form.phone} onChange={(e) => setForm({ ...form, phone: e.target.value })} />
        <button type="button" className="rounded-lg bg-amber-800 px-3 py-1.5 text-xs font-bold text-white hover:bg-amber-900 disabled:opacity-50" disabled={saving || !form.contactName.trim()} onClick={() => void save()}>{saving ? 'Saving...' : 'Add Customer'}</button>
      </div>
      <div className="overflow-x-auto">
        <table className="w-full text-left text-sm">
          <thead className="border-b text-xs uppercase text-amber-700">
            <tr><th className="py-2 px-3">Name</th><th className="py-2 px-3">Company</th><th className="py-2 px-3">Phone</th></tr>
          </thead>
          <tbody>
            {customers.map((c) => (
              <tr key={c.customerId} className="border-b border-amber-100/60">
                <td className="py-2.5 px-3 font-bold text-amber-950">{c.displayName}</td>
                <td className="py-2.5 px-3 text-amber-800">{c.email || '\u2014'}</td>
                <td className="py-2.5 px-3 text-amber-800">{c.phone || '\u2014'}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </Panel>
  );
}

function EmployeesView({
  session,
  shifts,
  openShift,
  pendingShift,
  onOpenClockIn,
  onOpenClockOut,
  onOpenPending,
  refresh,
}: {
  session: CloudSession;
  shifts: ExtendedCloudShift[];
  openShift?: ExtendedCloudShift;
  pendingShift?: ExtendedCloudShift;
  onOpenClockIn: () => void;
  onOpenClockOut: () => void;
  onOpenPending: () => void;
  refresh: () => Promise<void>;
}): JSX.Element {
  const [employees, setEmployees] = useState<CloudEmployee[]>([]);
  const [selectedDate, setSelectedDate] = useState(today());
  const [form, setForm] = useState({ username: '', displayName: '', role: 'cashier' as 'admin' | 'cashier', password: '' });
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const isAdmin = session.user.role === 'admin';

  const loadData = async (): Promise<void> => {
    try { setEmployees(await api.employees()); await refresh(); setError(null); } catch (reason) { setError(errorText(reason, 'Unable to load employees.')); }
  };

  useEffect(() => { void loadData(); }, [selectedDate]);

  const addEmployee = async (): Promise<void> => {
    setSaving(true); setError(null);
    try { await api.createEmployee(form); setForm({ username: '', displayName: '', role: 'cashier', password: '' }); setMessage('Employee added.'); await loadData(); } catch (reason) { setError(errorText(reason, 'Employee could not be added.')); } finally { setSaving(false); }
  };

  return (
    <section className="mx-auto max-w-7xl">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-3xl font-bold text-amber-950">Employee management</h1>
          <p className="mt-1 text-sm text-amber-700">{isAdmin ? 'Permissions, shifts, and individual sales count.' : 'Your access role and current shift.'}</p>
        </div>
        <button className="rounded-lg border border-amber-200/80 bg-white px-4 py-2 text-sm font-semibold" type="button" onClick={() => void loadData()}>
          Refresh
        </button>
      </div>

      {pendingShift && (
        <div className="mt-4 rounded-xl border border-amber-400 bg-amber-100 p-4 text-amber-950 flex flex-wrap items-center justify-between gap-3">
          <div>
            <strong className="block text-sm font-bold">{"\u26A0"} Unclosed Shift Detected From Yesterday</strong>
            <p className="text-xs text-amber-900 mt-0.5">Please perform a physical cash drawer count to reconcile yesterday's shift before starting a new shift.</p>
          </div>
          <button type="button" className="rounded-lg bg-amber-800 px-3 py-1.5 text-xs font-bold text-white shadow hover:bg-amber-900" onClick={onOpenPending}>
            Reconcile Yesterday Cash Count
          </button>
        </div>
      )}

      {message && <p className="mt-4 rounded-lg bg-emerald-50 p-3 text-sm text-emerald-700">{message}</p>}
      {error && <p className="mt-4 rounded-lg bg-red-50 p-3 text-sm text-red-700" role="alert">{error}</p>}

      {isAdmin && (
        <div className="mt-6 grid gap-3 rounded-xl border border-amber-200/80 bg-white p-5 shadow-sm md:grid-cols-4">
          <input className="rounded-lg border border-amber-200/80 px-3 py-2 text-xs" placeholder="Username" value={form.username} onChange={(event) => setForm({ ...form, username: event.target.value })} />
          <input className="rounded-lg border border-amber-200/80 px-3 py-2 text-xs" placeholder="Display name" value={form.displayName} onChange={(event) => setForm({ ...form, displayName: event.target.value })} />
          <select className="rounded-lg border border-amber-200/80 px-3 py-2 text-xs" value={form.role} onChange={(event) => setForm({ ...form, role: event.target.value as 'admin' | 'cashier' })}>
            <option value="cashier">Cashier</option>
            <option value="admin">Admin</option>
          </select>
          <input className="rounded-lg border border-amber-200/80 px-3 py-2 text-xs" minLength={12} placeholder="Password (12+ chars)" type="password" value={form.password} onChange={(event) => setForm({ ...form, password: event.target.value })} />
          <button className="rounded-lg bg-amber-800 px-4 py-2 font-semibold text-white disabled:opacity-50 md:col-span-4 text-xs" disabled={saving || !form.username.trim() || !form.displayName.trim() || form.password.length < 12} type="button" onClick={() => void addEmployee()}>
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
                    <td className="px-5 py-4"><strong>{employee.displayName}</strong><div className="text-xs text-amber-700">{employee.username}</div></td>
                    <td className="px-3 py-4 capitalize">{employee.role}</td>
                    <td className="px-3 py-4">{employeeShift ? `{"\\u{1F7E2}"} Clocked in (${money.format(Number(employeeShift.openingFloat) || 1500)})` : 'Off shift'}</td>
                    {isAdmin && <td className="px-3 py-4 text-right">{money.format(Number(employee.salesAmount) || 0)}</td>}
                    <td className="px-3 py-4 text-right">{employee.salesCount}</td>
                    <td className="pr-5 text-right">
                      {isSelf && (
                        <button
                          className="rounded-lg border border-amber-300 bg-amber-50 px-3 py-1.5 text-xs font-bold text-amber-900 shadow-sm hover:bg-amber-100"
                          type="button"
                          onClick={() => {
                            if (pendingShift) onOpenPending();
                            else if (openShift) onOpenClockOut();
                            else onOpenClockIn();
                          }}
                        >
                          {pendingShift ? 'Reconcile Yesterday Cash' : openShift ? 'Clock Out' : 'Clock In'}
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
            <div><h2 className="font-semibold text-amber-950">Shift calendar</h2><p className="text-sm text-amber-700">Clock-in and clock-out audit history.</p></div>
            <input className="rounded-lg border border-amber-200/80 px-3 py-2 text-xs" type="date" value={selectedDate} onChange={(event) => setSelectedDate(event.target.value)} />
          </div>
          <div className="mt-4 overflow-x-auto">
            <table className="w-full text-left text-xs">
              <thead className="text-xs uppercase tracking-wide text-amber-800 bg-amber-50/60 border-b border-amber-100">
                <tr>
                  <th className="py-2.5 px-3">Employee</th>
                  <th className="py-2.5 px-3">Clock In</th>
                  <th className="py-2.5 px-3">Clock Out</th>
                  <th className="py-2.5 px-3 text-right">Opening Float</th>
                  <th className="py-2.5 px-3 text-right">Expected Cash</th>
                  <th className="py-2.5 px-3 text-right">Physical Count</th>
                  <th className="py-2.5 px-3 text-right">Audit Status</th>
                </tr>
              </thead>
              <tbody>
                {shifts.map((shift) => {
                  const shiftEmployee = employees.find((e) => e.userId === shift.userId);
                  const isPending = shift.status === 'PENDING_PHYSICAL_COUNT';
                  const isOpen = !shift.clockOut && shift.status !== 'CLOSED' && shift.status !== 'CLOSED_NEXT_DAY';
                  const disc = Number(shift.cashDiscrepancy) || 0;

                  let auditBadge = <span className="font-bold text-emerald-700">{"\\u2705"} \u20B10.00 Balanced</span>;
                  if (isOpen) auditBadge = <span className="font-bold text-emerald-800">{"\\u{1F7E2}"} On Shift</span>;
                  else if (isPending) auditBadge = <span className="font-bold text-amber-800">{"\\u23F1"} Pending Count</span>;
                  else if (disc < 0) auditBadge = <span className="font-bold text-red-700">{"\\u26A0"} -\u20B1{Math.abs(disc).toFixed(2)} Short</span>;
                  else if (disc > 0) auditBadge = <span className="font-bold text-amber-900">{"\\u2139"} +\u20B1{disc.toFixed(2)} Over</span>;

                  return (
                    <tr className="border-b border-amber-100/60" key={shift.shiftId}>
                      <td className="py-3 px-3"><strong>{shift.displayName}</strong><div className="text-[10px] text-amber-700 capitalize">{shiftEmployee?.role ?? 'cashier'}</div></td>
                      <td className="py-3 px-3">{new Date(shift.clockIn).toLocaleString()}</td>
                      <td className="py-3 px-3">{shift.clockOut ? new Date(shift.clockOut).toLocaleString() : 'Still clocked in'}</td>
                      <td className="py-3 px-3 text-right tabular-nums font-medium">{money.format(Number(shift.openingFloat) || 1500)}</td>
                      <td className="py-3 px-3 text-right tabular-nums font-medium">{shift.expectedCash !== undefined ? money.format(Number(shift.expectedCash) || 0) : '\u2014'}</td>
                      <td className="py-3 px-3 text-right tabular-nums font-bold">{shift.closingCashCount !== undefined ? money.format(Number(shift.closingCashCount) || 0) : '\u2014'}</td>
                      <td className="py-3 px-3 text-right">{auditBadge}</td>
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
    if (token && userJson) {
      try { return { token, user: JSON.parse(userJson) }; } catch { return null; }
    }
    return null;
  });

  const [customers, setCustomers] = useState<CloudCustomer[]>([]);
  const [shifts, setShifts] = useState<ExtendedCloudShift[]>([]);
  const [tab, setTab] = useState<Tab>('checkout');

  // Modals state
  const [showClockInModal, setShowClockInModal] = useState(false);
  const [showClockOutModal, setShowClockOutModal] = useState(false);
  const [showPendingModal, setShowPendingModal] = useState(false);

  const [openingFloatInput, setOpeningFloatInput] = useState('1500.00');
  const [openingNotesInput, setOpeningNotesInput] = useState('');

  const [closingCashInput, setClosingCashInput] = useState('');
  const [closingNotesInput, setClosingNotesInput] = useState('');

  const [isLogoutPending, setIsLogoutPending] = useState(false);
  const [modalError, setModalError] = useState<string | null>(null);
  const [modalBusy, setModalBusy] = useState(false);

  const refreshCustomers = async (): Promise<void> => { try { setCustomers(await api.customers()); } catch {} };
  const refreshShifts = async (): Promise<ExtendedCloudShift[]> => {
    try {
      const data = await api.shifts();
      setShifts(data as ExtendedCloudShift[]);
      return data as ExtendedCloudShift[];
    } catch {
      return [];
    }
  };

  useEffect(() => {
    if (session) {
      void refreshCustomers();
      void refreshShifts();
    }
  }, [session]);

  const openShift = shifts.find((s) => s.userId === session?.user.userId && !s.clockOut && (s.status === 'OPEN' || !s.status));
  const pendingShift = shifts.find((s) => s.userId === session?.user.userId && s.status === 'PENDING_PHYSICAL_COUNT');

  // Auto-check for pending shifts or mandatory clock-in on session load
  useEffect(() => {
    if (session) {
      if (pendingShift) {
        setShowPendingModal(true);
      }
    }
  }, [session, pendingShift]);

  const handleClockInSubmit = async (): Promise<void> => {
    setModalBusy(true); setModalError(null);
    try {
      const floatVal = Number(openingFloatInput) || 1500;
      await fetchClockIn(floatVal, openingNotesInput || null);
      setShowClockInModal(false);
      setOpeningNotesInput('');
      await refreshShifts();
    } catch (err) {
      setModalError(errorText(err, 'Failed to clock in.'));
    } finally {
      setModalBusy(false);
    }
  };

  const handleClockOutSubmit = async (): Promise<void> => {
    setModalBusy(true); setModalError(null);
    try {
      const cashVal = Number(closingCashInput) || 0;
      await fetchClockOut(cashVal, closingNotesInput || null);
      setShowClockOutModal(false);
      setShowPendingModal(false);
      setClosingCashInput('');
      setClosingNotesInput('');
      await refreshShifts();

      if (isLogoutPending) {
        setIsLogoutPending(false);
        sessionStorage.removeItem('bakealley_cloud_token');
        localStorage.removeItem('bakealley_cloud_token');
        setSession(null);
      } else if (showPendingModal) {
        // Automatically open clock-in modal for today's shift after closing yesterday's pending count
        setShowClockInModal(true);
      }
    } catch (err) {
      setModalError(errorText(err, 'Failed to clock out.'));
    } finally {
      setModalBusy(false);
    }
  };

  const handleLogoutClick = () => {
    if (pendingShift) {
      setShowPendingModal(true);
    } else if (openShift) {
      setIsLogoutPending(true);
      setShowClockOutModal(true);
    } else {
      sessionStorage.removeItem('bakealley_cloud_token');
      localStorage.removeItem('bakealley_cloud_token');
      setSession(null);
    }
  };

  if (!session) {
    return (
      <LoginScreen
        onLogin={async (username, password) => {
          const loggedIn = await api.login(username, password);
          sessionStorage.setItem('bakealley_cloud_token', loggedIn.token);
          sessionStorage.setItem('bakealley_cloud_user', JSON.stringify(loggedIn.user));
          setSession(loggedIn);
          void refreshCustomers();
          void refreshShifts();
        }}
      />
    );
  }

  const dataSource = {
    searchProducts: (query: string): Promise<CheckoutProduct[]> => api.searchProducts(query) as Promise<CheckoutProduct[]>,
    createOrderWithOutbox: async (order: CheckoutOrderPayload): Promise<{ orderId: string }> => {
      if (!openShift) {
        setShowClockInModal(true);
        throw new Error('Shift not started. Please clock in before processing sales.');
      }
      const cloudOrder: CloudOrderPayload = {
        ...order,
        orderId: crypto.randomUUID(),
        items: order.items.map((item) => ({ ...item, orderItemId: crypto.randomUUID() })),
        changeDue: order.paymentMethod === 'cash' ? Number((order.cashReceived - order.totalAmount).toFixed(2)) : 0,
      };
      return api.createOrder(cloudOrder);
    },
  };

  const tabs: Array<[Tab, string]> = [
    ['checkout', 'Checkout'],
    ['sales', 'Sales'],
    ['inventory', 'Inventory'],
    ['crm', 'CRM'],
    ['employees', 'Employees'],
  ];

  return (
    <div className="min-h-screen bg-slate-100">
      <header className="border-b bg-white px-4 py-4 sm:px-6 shadow-sm">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <strong className="text-lg text-amber-950">Bake Alley Cloud POS</strong>
            <span className="ml-3 text-xs font-semibold text-amber-800 bg-amber-50 border border-amber-200/80 rounded-full px-2.5 py-1">
              {session.user.displayName} {"\u2022"} {session.user.role}
            </span>
          </div>
          <div className="flex items-center gap-3">
            {!openShift && !pendingShift && (
              <button
                type="button"
                className="rounded-lg bg-emerald-700 px-3 py-1.5 text-xs font-bold text-white shadow-sm hover:bg-emerald-800"
                onClick={() => setShowClockInModal(true)}
              >
                {"\u23F1"} Clock In (Start Shift)
              </button>
            )}
            {openShift && (
              <span className="text-xs font-bold text-emerald-800 bg-emerald-50 border border-emerald-200 rounded-lg px-2.5 py-1">
                {"\u{1F7E2}"} Shift Active
              </span>
            )}
            <button className="text-xs font-bold text-amber-900 hover:text-red-600" type="button" onClick={handleLogoutClick}>
              Log out
            </button>
          </div>
        </div>

        <nav className="mt-4 flex gap-2 overflow-x-auto">
          {tabs.map(([key, label]) => (
            <button
              className={`whitespace-nowrap rounded-lg px-3.5 py-2 text-xs font-bold transition-all ${
                tab === key ? 'bg-amber-800 text-white shadow-sm' : 'text-amber-900 hover:bg-amber-50'
              }`}
              type="button"
              key={key}
              onClick={() => setTab(key)}
            >
              {label}
            </button>
          ))}
        </nav>
      </header>

      {/* Main Tab Routing */}
      <main className="mx-auto max-w-7xl p-4 sm:p-6">
        {tab === 'checkout' && (
          <div className="space-y-4">
            {!openShift && (
              <div className="rounded-xl border border-amber-300 bg-amber-50 p-4 text-amber-950 flex flex-wrap items-center justify-between gap-3 shadow-sm">
                <div className="flex items-center gap-2">
                  <span className="text-xl">{"\u{1F512}"}</span>
                  <div>
                    <strong className="block text-sm font-bold">Shift Not Started {"\u2014"} Clock In Required</strong>
                    <p className="text-xs text-amber-800">You must initialize your shift and opening cash float before processing orders.</p>
                  </div>
                </div>
                <button
                  type="button"
                  className="rounded-lg bg-amber-800 px-4 py-2 text-xs font-bold text-white shadow hover:bg-amber-900"
                  onClick={() => setShowClockInModal(true)}
                >
                  Clock In Now
                </button>
              </div>
            )}
            <CheckoutScreen dataSource={dataSource} scaleEnabled={false} customers={customers as CheckoutCustomer[]} retailTierId={retailTierId} taxRate={0} />
          </div>
        )}
        {tab === 'sales' && <SalesView isAdmin={session.user.role === 'admin'} />}
        {tab === 'inventory' && <InventoryView isAdmin={session.user.role === 'admin'} />}
        {tab === 'crm' && <CrmView session={session} customers={customers} refresh={refreshCustomers} />}
        {tab === 'employees' && (
          <EmployeesView
            session={session}
            shifts={shifts}
            openShift={openShift}
            pendingShift={pendingShift}
            onOpenClockIn={() => setShowClockInModal(true)}
            onOpenClockOut={() => setShowClockOutModal(true)}
            onOpenPending={() => setShowPendingModal(true)}
            refresh={refreshShifts}
          />
        )}
      </main>

      {/* 1. CLOCK IN MODAL */}
      {showClockInModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
          <div className="w-full max-w-md rounded-2xl border border-amber-200 bg-white p-6 shadow-xl">
            <div className="flex items-center justify-between border-b border-amber-100 pb-3">
              <h3 className="font-bold text-amber-950 text-base flex items-center gap-2">
                <span>{"\u23F1"}</span> Start Shift & Cash Drawer Initialization
              </h3>
              <button type="button" className="text-amber-800 font-bold hover:text-amber-950" onClick={() => setShowClockInModal(false)}>
                {"\u00D7"}
              </button>
            </div>

            {modalError && <p className="mt-3 rounded-lg bg-red-50 p-2.5 text-xs text-red-700">{modalError}</p>}

            <div className="mt-4 space-y-4">
              <div>
                <label className="block text-xs font-bold text-amber-900 mb-1">Opening Cash Float (\u20B1)</label>
                <input
                  type="number"
                  step="0.01"
                  min="0"
                  className="w-full rounded-lg border border-amber-300 px-3.5 py-2 text-sm font-bold text-amber-950 outline-none focus:border-amber-600 focus:ring-2 focus:ring-amber-500/20"
                  value={openingFloatInput}
                  onChange={(e) => setOpeningFloatInput(e.target.value)}
                />
                <p className="mt-1 text-[11px] text-amber-700">Enter starting physical cash provided in drawer for change (default: \u20B11,500.00).</p>
              </div>

              <div>
                <label className="block text-xs font-bold text-amber-900 mb-1">Opening Notes (Optional)</label>
                <textarea
                  rows={2}
                  className="w-full rounded-lg border border-amber-300 px-3.5 py-2 text-xs text-amber-950 outline-none focus:border-amber-600"
                  placeholder="e.g. 10x 100s, 10x 50s bill breakdown"
                  value={openingNotesInput}
                  onChange={(e) => setOpeningNotesInput(e.target.value)}
                />
              </div>
            </div>

            <div className="mt-6 flex gap-3">
              <button
                type="button"
                className="flex-1 rounded-lg border border-amber-300 bg-white py-2.5 text-xs font-bold text-amber-900 hover:bg-amber-50"
                onClick={() => setShowClockInModal(false)}
                disabled={modalBusy}
              >
                Cancel
              </button>
              <button
                type="button"
                className="flex-1 rounded-lg bg-amber-800 py-2.5 text-xs font-bold text-white shadow hover:bg-amber-900 disabled:opacity-50"
                onClick={() => void handleClockInSubmit()}
                disabled={modalBusy}
              >
                {modalBusy ? 'Opening...' : 'Confirm & Open Shift'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* 2. CLOCK OUT MODAL */}
      {showClockOutModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
          <div className="w-full max-w-md rounded-2xl border border-amber-200 bg-white p-6 shadow-xl">
            <div className="flex items-center justify-between border-b border-amber-100 pb-3">
              <h3 className="font-bold text-amber-950 text-base flex items-center gap-2">
                <span>{"\u{1F512}"}</span> End Shift & Blind Cash Drawer Count
              </h3>
              <button type="button" className="text-amber-800 font-bold hover:text-amber-950" onClick={() => setShowClockOutModal(false)}>
                {"\u00D7"}
              </button>
            </div>

            {modalError && <p className="mt-3 rounded-lg bg-red-50 p-2.5 text-xs text-red-700">{modalError}</p>}

            <div className="mt-4 space-y-4">
              <div>
                <label className="block text-xs font-bold text-amber-900 mb-1">Physical Cash Count in Drawer (\u20B1)</label>
                <input
                  type="number"
                  step="0.01"
                  min="0"
                  className="w-full rounded-lg border border-amber-300 px-3.5 py-2 text-sm font-bold text-amber-950 outline-none focus:border-amber-600 focus:ring-2 focus:ring-amber-500/20"
                  placeholder="0.00"
                  value={closingCashInput}
                  onChange={(e) => setClosingCashInput(e.target.value)}
                />
                <p className="mt-1 text-[11px] text-amber-700">{"\u{1F512}"} Blind Audit Security: Enter exact physical drawer cash counted (including starting float).</p>
              </div>

              <div>
                <label className="block text-xs font-bold text-amber-900 mb-1">Shift Closing Remarks (Optional)</label>
                <textarea
                  rows={2}
                  className="w-full rounded-lg border border-amber-300 px-3.5 py-2 text-xs text-amber-950 outline-none focus:border-amber-600"
                  placeholder="e.g. Explanation for any known change overage/shortage"
                  value={closingNotesInput}
                  onChange={(e) => setClosingNotesInput(e.target.value)}
                />
              </div>
            </div>

            <div className="mt-6 flex gap-3">
              <button
                type="button"
                className="flex-1 rounded-lg border border-amber-300 bg-white py-2.5 text-xs font-bold text-amber-900 hover:bg-amber-50"
                onClick={() => { setShowClockOutModal(false); setIsLogoutPending(false); }}
                disabled={modalBusy}
              >
                Cancel
              </button>
              <button
                type="button"
                className="flex-1 rounded-lg bg-amber-800 py-2.5 text-xs font-bold text-white shadow hover:bg-amber-900 disabled:opacity-50"
                onClick={() => void handleClockOutSubmit()}
                disabled={modalBusy || !closingCashInput.trim()}
              >
                {modalBusy ? 'Closing...' : 'Confirm & Close Shift'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* 3. PENDING SHIFT CLOSEOUT MODAL (NEXT-MORNING HANDOVER INTERCEPTOR) */}
      {showPendingModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
          <div className="w-full max-w-md rounded-2xl border border-amber-300 bg-white p-6 shadow-xl">
            <div className="flex items-center justify-between border-b border-amber-200 pb-3">
              <h3 className="font-bold text-amber-950 text-base flex items-center gap-2">
                <span>{"\u26A0"}</span> Reconcile Yesterday's Unclosed Shift
              </h3>
              <button type="button" className="text-amber-800 font-bold hover:text-amber-950" onClick={() => setShowPendingModal(false)}>
                {"\u00D7"}
              </button>
            </div>

            <div className="mt-3 rounded-lg bg-amber-50 p-3 text-xs text-amber-900 border border-amber-200">
              Yesterday's shift was automatically closed at midnight. Please enter the physical cash counted in the drawer to reconcile yesterday's shift before starting today's shift.
            </div>

            {modalError && <p className="mt-3 rounded-lg bg-red-50 p-2.5 text-xs text-red-700">{modalError}</p>}

            <div className="mt-4 space-y-4">
              <div>
                <label className="block text-xs font-bold text-amber-900 mb-1">Yesterday's Physical Drawer Cash (\u20B1)</label>
                <input
                  type="number"
                  step="0.01"
                  min="0"
                  className="w-full rounded-lg border border-amber-300 px-3.5 py-2 text-sm font-bold text-amber-950 outline-none focus:border-amber-600 focus:ring-2 focus:ring-amber-500/20"
                  placeholder="0.00"
                  value={closingCashInput}
                  onChange={(e) => setClosingCashInput(e.target.value)}
                />
              </div>

              <div>
                <label className="block text-xs font-bold text-amber-900 mb-1">Reconciliation Remarks (Optional)</label>
                <textarea
                  rows={2}
                  className="w-full rounded-lg border border-amber-300 px-3.5 py-2 text-xs text-amber-950 outline-none focus:border-amber-600"
                  placeholder="e.g. Next-morning drawer handover count by opener"
                  value={closingNotesInput}
                  onChange={(e) => setClosingNotesInput(e.target.value)}
                />
              </div>
            </div>

            <div className="mt-6 flex gap-3">
              <button
                type="button"
                className="flex-1 rounded-lg border border-amber-300 bg-white py-2.5 text-xs font-bold text-amber-900 hover:bg-amber-50"
                onClick={() => setShowPendingModal(false)}
                disabled={modalBusy}
              >
                Dismiss
              </button>
              <button
                type="button"
                className="flex-1 rounded-lg bg-amber-800 py-2.5 text-xs font-bold text-white shadow hover:bg-amber-900 disabled:opacity-50"
                onClick={() => void handleClockOutSubmit()}
                disabled={modalBusy || !closingCashInput.trim()}
              >
                {modalBusy ? 'Submitting...' : 'Reconcile & Open Today'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

import { useEffect, useMemo, useState, type JSX, type ReactNode } from 'react';
import { CheckoutScreen, type CheckoutCustomer, type CheckoutOrderPayload, type CheckoutProduct, type CheckoutScaleReading } from '../src/components/CheckoutScreen';
import { LoginScreen } from '../src/renderer/LoginScreen';
import { SalesView } from '../src/renderer/SalesView';
import { InventoryView } from '../src/renderer/InventoryView';
import { CrmView } from '../src/renderer/CrmView';
import { CloudPosApi, type CloudSession } from './cloudApi';
import logoUrl from '../Images/bakeAlley-Logo.jpg';
import type { CloudCustomer, CloudEmployee, CloudInventoryRow, CloudOrderPayload, CloudSalesReport, CloudShift } from './apiClient';

const api = new CloudPosApi({
  baseUrl: (import.meta.env.VITE_API_URL || 'https://bakealley-pos-production.up.railway.app').replace(/\/+\$/, ''),
  getToken: () => localStorage.getItem('bakealley_cloud_token') || sessionStorage.getItem('bakealley_cloud_token'),
});

const retailTierId = import.meta.env.VITE_RETAIL_TIER_ID ?? '2f8c8d4e-8d28-4d4d-9f41-7a52c5f2e101';

// Unified Inactivity Timeout - 5 minutes for all users
const INACTIVITY_TIMEOUT_MS = 5 * 60 * 1000;   // 5 Minutes of inactivity for all users

const LOW_STOCK_THRESHOLD = 10;
const CARD_FEE_RATE = 0.025; // 2.5% estimated card fee

const money = new Intl.NumberFormat('en-PH', { style: 'currency', currency: 'PHP', minimumFractionDigits: 2, maximumFractionDigits: 2 });
const today = (): string => new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Manila' }).format(new Date());

type Tab = 'checkout' | 'sales' | 'financials' | 'bi' | 'inventory' | 'crm' | 'employees';
type VelocityTimeframe = 'monthly' | 'yearly';

async function clockInWithFloat(openingFloat: number | null, notes?: string): Promise<CloudShift> {
  const token = localStorage.getItem('bakealley_cloud_token') || sessionStorage.getItem('bakealley_cloud_token');
  const baseUrl = import.meta.env.VITE_API_URL || 'https://bakealley-pos-production.up.railway.app';
  const sanitizedUrl = baseUrl.replace(/\/+\$/, '');
  const response = await fetch(`${sanitizedUrl}/api/v1/employees/clock-in`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      ...(token ? { authorization: `Bearer ${token}` } : {}),
    },
    body: JSON.stringify({ openingFloat, notes }),
  });
  if (!response.ok) {
    const body = await response.json().catch(() => ({}));
    throw new Error(body.message || body.error || 'Failed to clock in');
  }
  return response.json();
}

async function clockOutWithCount(closingCashCount: number | null, notes?: string): Promise<CloudShift> {
  const token = localStorage.getItem('bakealley_cloud_token') || sessionStorage.getItem('bakealley_cloud_token');
  const baseUrl = import.meta.env.VITE_API_URL || 'https://bakealley-pos-production.up.railway.app';
  const sanitizedUrl = baseUrl.replace(/\/+\$/, '');
  const response = await fetch(`${sanitizedUrl}/api/v1/employees/clock-out`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      ...(token ? { authorization: `Bearer ${token}` } : {}),
    },
    body: JSON.stringify({ closingCashCount, notes }),
  });
  if (!response.ok) {
    const body = await response.json().catch(() => ({}));
    throw new Error(body.message || body.error || 'Failed to clock out');
  }
  return response.json();
}

function getInactivityTimeout(): number {
  return INACTIVITY_TIMEOUT_MS;  // 5 minutes for all users
}

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

function ActionButton({ children, onClick, disabled = false }: { children: ReactNode; onClick: () => void; disabled?: boolean }): JSX.Element {
    return <button className="rounded-lg border border-amber-200/80 bg-white px-3 py-1.5 text-xs font-semibold text-amber-950 shadow-sm transition hover:bg-amber-50/80 hover:border-amber-300 disabled:opacity-50" disabled={disabled} type="button" onClick={onClick}>{children}</button>;
}

function Panel({ title, action, children }: { title: string; action?: ReactNode; children: ReactNode }): JSX.Element {
    return <section className="rounded-2xl border border-amber-200/80 bg-white p-6 shadow-sm"><div className="mb-4 flex flex-wrap items-center justify-between gap-3"><h2 className="text-lg font-bold tracking-tight text-amber-950">{title}</h2>{action}</div>{children}</section>;
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
  const [shifts, setShifts] = useState<CloudShift[]>([]);
  const [shiftsLoaded, setShiftsLoaded] = useState(false);

  const updateLastActiveTime = () => {
    const now = Date.now();
    localStorage.setItem('bakealley_cloud_last_active', String(now));
  };

  useEffect(() => {
    if (!session) return;

    const checkInactivity = () => {
      const lastActiveStr = localStorage.getItem('bakealley_cloud_last_active');
      const lastActive = lastActiveStr ? Number(lastActiveStr) : Date.now();
      const now = Date.now();
      const timeoutMs = getInactivityTimeout();

      if (now - lastActive > timeoutMs) {
        handleLogout();
      }
    };

    const activityInterval = setInterval(checkInactivity, 10000); // Check every 10 seconds

    const handleUserActivity = () => {
      updateLastActiveTime();
    };

    window.addEventListener('mousemove', handleUserActivity);
    window.addEventListener('keydown', handleUserActivity);
    window.addEventListener('click', handleUserActivity);
    window.addEventListener('scroll', handleUserActivity);

    return () => {
      clearInterval(activityInterval);
      window.removeEventListener('mousemove', handleUserActivity);
      window.removeEventListener('keydown', handleUserActivity);
      window.removeEventListener('click', handleUserActivity);
      window.removeEventListener('scroll', handleUserActivity);
    };
  }, [session]);

  const handleLogout = () => {
    api.logout().catch((err) => console.error('Logout failed:', err));
    clearSessionStorage();
    setSession(null);
  };

  const refreshCustomers = async (): Promise<void> => {
    try {
      setCustomers(await api.customers());
    } catch (error) {
      console.error('Failed to load customers:', error);
    }
  };

  const refreshInventory = async (): Promise<void> => {
    try {
      setInventory(await api.inventory());
    } catch (error) {
      console.error('Failed to load inventory:', error);
    }
  };

  const refreshSalesReport = async (dateStr: string): Promise<void> => {
    setSalesLoading(true);
    try {
      setSalesReport(await api.salesReport(dateStr));
    } catch (error) {
      console.error('Failed to load sales report:', error);
    } finally {
      setSalesLoading(false);
    }
  };

  const refreshShifts = async (): Promise<void> => {
    if (!session) return;
    try {
      setShifts(await api.shifts());
    } catch (error) {
      console.error('Failed to load shifts:', error);
    } finally {
      setShiftsLoaded(true);
    }
  };

  useEffect(() => {
    if (session) {
      updateLastActiveTime();
      void refreshCustomers();
      void refreshInventory();
      void refreshSalesReport(salesDate);
      void refreshShifts();
    }
  }, [session]);

  useEffect(() => {
    if (session && tab === 'sales') {
      void refreshSalesReport(salesDate);
    }
  }, [salesDate, tab, session]);

  const handleTabChange = (nextTab: Tab) => {
    setTab(nextTab);
    localStorage.setItem('bakealley_cloud_tab', nextTab);
  };

  const dataSource = useMemo(() => ({
    searchProducts: (query: string): Promise<CheckoutProduct[]> => api.searchProducts(query) as Promise<CheckoutProduct[]>,
    customers: (): Promise<CheckoutCustomer[]> => api.customers() as Promise<CheckoutCustomer[]>,
    createCustomer: (customer: { companyName?: string; contactName: string; email?: string; phone?: string; tierId: string }): Promise<CheckoutCustomer> =>
      api.createCustomer(customer) as Promise<CheckoutCustomer>,
    createOrderWithOutbox: async (order: CheckoutOrderPayload): Promise<{ orderId: string }> => {
      const cloudOrder: CloudOrderPayload = {
        ...order,
        paymentMethod: order.paymentMethod as 'cash' | 'card' | 'gcash' | 'account',
      };
      const result = await api.createOrder(cloudOrder);
      void refreshInventory();
      void refreshSalesReport(salesDate);
      void refreshShifts();
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
    ? ['checkout', 'sales', 'financials', 'bi', 'inventory', 'crm', 'employees']
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

          <div className="flex items-center gap-2">
            <nav className="flex gap-1 rounded-xl bg-amber-100/60 p-1 border border-amber-200/80">
              {availableTabs.map((item) => (
                <button
                  key={item}
                  type="button"
                  onClick={() => handleTabChange(item)}
                  className={`rounded-lg px-3 py-1.5 text-xs font-bold capitalize transition ${tab === item ? 'bg-amber-800 text-white shadow-sm' : 'text-amber-900 hover:bg-amber-200/50'}`}
                >
                  {item === 'crm' ? 'CRM' : item === 'bi' ? 'BI Analytics' : item}
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
        {tab === 'financials' && (
          <FinancialsView salesReport={salesReport} />
        )}
        {tab === 'bi' && (
          <BiView inventory={inventory} salesReport={salesReport} />
        )}
        {tab === 'inventory' && (
          <InventoryView
            inventory={inventory}
            onRefresh={refreshInventory}
            onAdjustStock={async (adj) => {
              await api.adjustInventory(adj);
              await refreshInventory();
            }}
            onCreateProduct={async (prod) => {
              await api.createInventoryProduct(prod);
              await refreshInventory();
            }}
            isAdmin={isAdmin}
          />
        )}
        {tab === 'crm' && (
          <CrmView
            customers={customers}
            onRefresh={refreshCustomers}
            onCreateCustomer={async (cust) => {
              await api.createCustomer(cust);
              await refreshCustomers();
            }}
            onDeleteCustomer={async (id) => {
              await api.deleteCustomer(id);
              await refreshCustomers();
            }}
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

function FinancialsView({ salesReport }: { salesReport: CloudSalesReport | null }): JSX.Element {
  const gross = salesReport?.dayGrossTotal ?? 0;
  const net = salesReport?.dayNetTotal ?? 0;
  const count = salesReport?.dayOrderCount ?? 0;
  const items = salesReport?.items ?? [];

  const paymentBreakdown = useMemo(() => {
    const map = new Map<string, { count: number; total: number }>();
    for (const item of items) {
      const method = (item.paymentMethod || 'cash').toLowerCase();
      const existing = map.get(method) || { count: 0, total: 0 };
      map.set(method, {
        count: existing.count + 1,
        total: existing.total + (item.amount || 0),
      });
    }
    return Array.from(map.entries()).map(([method, data]) => ({
      method,
      count: data.count,
      total: data.total,
    }));
  }, [items]);

  return (
    <section className="mx-auto max-w-7xl space-y-6">
      <header>
        <h1 className="text-3xl font-bold text-amber-950">Financial Audits & Ledger</h1>
        <p className="mt-1 text-sm text-amber-700">Real-time daily revenue, card fee deductions, and payment method summaries.</p>
      </header>

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <Panel title="Daily Gross Revenue">
          <div className="text-2xl font-black text-amber-950 tabular-nums">{money.format(gross)}</div>
          <p className="mt-1 text-xs text-amber-700">{count} completed transactions today</p>
        </Panel>
        <Panel title="Est. Card Processing Fees">
          <div className="text-2xl font-black text-amber-800 tabular-nums">
            {money.format(
              paymentBreakdown
                .filter((p) => p.method === 'card')
                .reduce((acc, curr) => acc + curr.total * CARD_FEE_RATE, 0)
            )}
          </div>
          <p className="mt-1 text-xs text-amber-700">Estimated at 2.5% per card transaction</p>
        </Panel>
        <Panel title="Net Operating Revenue">
          <div className="text-2xl font-black text-emerald-800 tabular-nums">
            {money.format(
              gross -
                paymentBreakdown
                  .filter((p) => p.method === 'card')
                  .reduce((acc, curr) => acc + curr.total * CARD_FEE_RATE, 0)
            )}
          </div>
          <p className="mt-1 text-xs text-amber-700">Gross total minus card processing fees</p>
        </Panel>
        <Panel title="Average Ticket Size">
          <div className="text-2xl font-black text-amber-950 tabular-nums">
            {money.format(count > 0 ? gross / count : 0)}
          </div>
          <p className="mt-1 text-xs text-amber-700">Average spent per customer order</p>
        </Panel>
      </div>

      <Panel title="Payment Method Breakdown">
        <div className="overflow-x-auto">
          <table className="w-full text-left text-sm">
            <thead className="bg-amber-50/60 text-xs uppercase tracking-wide text-amber-700">
              <tr>
                <th className="px-4 py-3">Payment Method</th>
                <th className="px-4 py-3 text-right">Transaction Count</th>
                <th className="px-4 py-3 text-right">Gross Total</th>
                <th className="px-4 py-3 text-right">% of Total Revenue</th>
              </tr>
            </thead>
            <tbody>
              {paymentBreakdown.length === 0 ? (
                <tr>
                  <td className="px-4 py-6 text-center text-amber-700/80" colSpan={4}>
                    No sales recorded for the selected date.
                  </td>
                </tr>
              ) : (
                paymentBreakdown.map((row) => (
                  <tr className="border-t border-amber-100/60" key={row.method}>
                    <td className="px-4 py-3 font-semibold capitalize text-amber-950">{row.method}</td>
                    <td className="px-4 py-3 text-right tabular-nums">{row.count}</td>
                    <td className="px-4 py-3 text-right font-bold tabular-nums text-amber-950">{money.format(row.total)}</td>
                    <td className="px-4 py-3 text-right tabular-nums">{gross > 0 ? ((row.total / gross) * 100).toFixed(1) : 0}%</td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </Panel>
    </section>
  );
}

function BiView({ inventory, salesReport }: { inventory: CloudInventoryRow[]; salesReport: CloudSalesReport | null }): JSX.Element {
  const [velocityTimeframe, setVelocityTimeframe] = useState<VelocityTimeframe>('monthly');

  const lowStockItems = useMemo(() => {
    return inventory.filter((item) => item.quantityOnHand <= LOW_STOCK_THRESHOLD);
  }, [inventory]);

  const stockValuation = useMemo(() => {
    let totalInitialCost = 0;
    let totalRetailValuation = 0;

    for (const item of inventory) {
      const qty = item.quantityOnHand || 0;
      totalInitialCost += (item.initialCapital || 0) * qty;
      totalRetailValuation += (item.retailPrice || 0) * qty;
    }

    return {
      totalInitialCost,
      totalRetailValuation,
      projectedProfit: totalRetailValuation - totalInitialCost,
    };
  }, [inventory]);

  const topSellers = useMemo(() => {
    const items = salesReport?.items ?? [];
    const map = new Map<string, { name: string; sku: string; quantity: number; revenue: number }>();

    for (const item of items) {
      const key = item.sku || item.itemName;
      const existing = map.get(key) || { name: item.itemName, sku: item.sku, quantity: 0, revenue: 0 };
      map.set(key, {
        name: item.itemName,
        sku: item.sku,
        quantity: existing.quantity + (item.quantity || 0),
        revenue: existing.revenue + (item.amount || 0),
      });
    }

    return Array.from(map.values())
      .sort((a, b) => b.revenue - a.revenue)
      .slice(0, 5);
  }, [salesReport]);

  return (
    <section className="mx-auto max-w-7xl space-y-6">
      <header>
        <h1 className="text-3xl font-bold text-amber-950">Business Intelligence & Velocity</h1>
        <p className="mt-1 text-sm text-amber-700">Stock valuation, product turn velocity, and margin analytics.</p>
      </header>

      <div className="grid gap-4 sm:grid-cols-3">
        <Panel title="Capital Investment (Cost)">
          <div className="text-2xl font-black text-amber-950 tabular-nums">{money.format(stockValuation.totalInitialCost)}</div>
          <p className="mt-1 text-xs text-amber-700">Total cost basis of current on-hand stock</p>
        </Panel>
        <Panel title="Retail Stock Valuation">
          <div className="text-2xl font-black text-amber-900 tabular-nums">{money.format(stockValuation.totalRetailValuation)}</div>
          <p className="mt-1 text-xs text-amber-700">Potential gross value at retail prices</p>
        </Panel>
        <Panel title="Projected Stock Margin">
          <div className="text-2xl font-black text-emerald-800 tabular-nums">{money.format(stockValuation.projectedProfit)}</div>
          <p className="mt-1 text-xs text-amber-700">Potential gross profit if all stock is sold</p>
        </Panel>
      </div>

      <div className="grid gap-6 lg:grid-cols-2">
        <Panel
          action={
            <div className="flex rounded-lg border border-amber-200/80 bg-amber-50/50 p-0.5">
              <button
                className={`rounded-md px-2.5 py-1 text-xs font-semibold ${velocityTimeframe === 'monthly' ? 'bg-white text-amber-950 shadow-sm' : 'text-amber-800'}`}
                type="button"
                onClick={() => setVelocityTimeframe('monthly')}
              >
                Monthly
              </button>
              <button
                className={`rounded-md px-2.5 py-1 text-xs font-semibold ${velocityTimeframe === 'yearly' ? 'bg-white text-amber-950 shadow-sm' : 'text-amber-800'}`}
                type="button"
                onClick={() => setVelocityTimeframe('yearly')}
              >
                Yearly
              </button>
            </div>
          }
          title="Top Performing Products Today"
        >
          <div className="overflow-x-auto">
            <table className="w-full text-left text-sm">
              <thead className="bg-amber-50/60 text-xs uppercase tracking-wide text-amber-700">
                <tr>
                  <th className="px-3 py-2">Item</th>
                  <th className="px-3 py-2 text-right">Units Sold</th>
                  <th className="px-3 py-2 text-right">Gross Revenue</th>
                </tr>
              </thead>
              <tbody>
                {topSellers.length === 0 ? (
                  <tr>
                    <td className="px-3 py-6 text-center text-amber-700/80" colSpan={3}>
                      No sales data available for top sellers today.
                    </td>
                  </tr>
                ) : (
                  topSellers.map((item) => (
                    <tr className="border-t border-amber-100/60" key={item.sku}>
                      <td className="px-3 py-2.5 font-medium text-amber-950">
                        {item.name}
                        <div className="text-xs text-amber-700/80">{item.sku}</div>
                      </td>
                      <td className="px-3 py-2.5 text-right tabular-nums">{item.quantity}</td>
                      <td className="px-3 py-2.5 text-right font-bold tabular-nums text-amber-950">{money.format(item.revenue)}</td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </Panel>

        <Panel title={`Low Stock Alerts (${lowStockItems.length})`}>
          <div className="overflow-x-auto">
            <table className="w-full text-left text-sm">
              <thead className="bg-amber-50/60 text-xs uppercase tracking-wide text-amber-700">
                <tr>
                  <th className="px-3 py-2">Item Name</th>
                  <th className="px-3 py-2 text-right">Qty On Hand</th>
                  <th className="px-3 py-2 text-right">Status</th>
                </tr>
              </thead>
              <tbody>
                {lowStockItems.length === 0 ? (
                  <tr>
                    <td className="px-3 py-6 text-center text-emerald-700 font-medium" colSpan={3}>
                      All inventory items are well-stocked above threshold.
                    </td>
                  </tr>
                ) : (
                  lowStockItems.map((item) => (
                    <tr className="border-t border-amber-100/60" key={item.variantId}>
                      <td className="px-3 py-2.5 font-medium text-amber-950">
                        {item.variantName}
                        <div className="text-xs text-amber-700/80">{item.sku}</div>
                      </td>
                      <td className="px-3 py-2.5 text-right font-bold tabular-nums text-red-700">{item.quantityOnHand}</td>
                      <td className="px-3 py-2.5 text-right">
                        <span className="inline-block rounded-full bg-red-100 px-2 py-0.5 text-xs font-semibold text-red-800">
                          Low Stock
                        </span>
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </Panel>
      </div>
    </section>
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

  // Shift Management State
  const [clockInModalOpen, setClockInModalOpen] = useState(false);
  const [clockOutModalOpen, setClockOutModalOpen] = useState(false);
  const [openingFloatInput, setOpeningFloatInput] = useState<string>('1500.00');
  const [closingCashCountInput, setClosingCashCountInput] = useState<string>('');
  const [shiftNotesInput, setShiftNotesInput] = useState<string>('');
  const [shiftBusy, setShiftBusy] = useState(false);

  const isAdmin = session.user.role === 'admin';

  const ownShift = useMemo(() => {
    return shifts.find((s) => s.userId === session.user.userId && !s.clockOut);
  }, [shifts, session.user.userId]);

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

  const handleClockInSubmit = async (): Promise<void> => {
    setShiftBusy(true);
    setError(null);
    try {
      const floatVal = openingFloatInput.trim() !== '' ? Number(openingFloatInput) : 1500.00;
      await clockInWithFloat(floatVal, shiftNotesInput.trim() || undefined);
      setMessage('Successfully clocked in.');
      setClockInModalOpen(false);
      setShiftNotesInput('');
      await refresh();
    } catch (reason) {
      setError(errorText(reason, 'Clock-in failed.'));
    } finally {
      setShiftBusy(false);
    }
  };

  const handleClockOutSubmit = async (): Promise<void> => {
    setShiftBusy(true);
    setError(null);
    try {
      const closingVal = closingCashCountInput.trim() !== '' ? Number(closingCashCountInput) : null;
      await clockOutWithCount(closingVal, shiftNotesInput.trim() || undefined);
      setMessage('Successfully clocked out.');
      setClockOutModalOpen(false);
      setClosingCashCountInput('');
      setShiftNotesInput('');
      await refresh();
    } catch (reason) {
      setError(errorText(reason, 'Clock-out failed.'));
    } finally {
      setShiftBusy(false);
    }
  };

  return (
    <section className="mx-auto max-w-7xl space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-3xl font-bold text-amber-950">Employee management</h1>
          <p className="mt-1 text-sm text-amber-700">{isAdmin ? 'Permissions, shifts, and individual sales count.' : 'Your access role and current shift.'}</p>
        </div>
        <div className="flex items-center gap-2">
          {ownShift ? (
            <button
              className="rounded-lg bg-red-700 px-4 py-2 text-sm font-bold text-white shadow-sm transition hover:bg-red-800"
              type="button"
              onClick={() => setClockOutModalOpen(true)}
            >
              Clock Out Current Shift
            </button>
          ) : (
            <button
              className="rounded-lg bg-emerald-700 px-4 py-2 text-sm font-bold text-white shadow-sm transition hover:bg-emerald-800"
              type="button"
              onClick={() => setClockInModalOpen(true)}
            >
              Clock In New Shift
            </button>
          )}
          <button className="rounded-lg border border-amber-200/80 bg-white px-4 py-2 text-sm font-semibold" type="button" onClick={() => void refresh()}>
            Refresh
          </button>
        </div>
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
                        <button className="rounded-lg bg-red-600 text-white px-3 py-2 text-xs font-semibold hover:bg-red-700 disabled:opacity-50" type="button" onClick={() => setDeleteConfirm({ userId: employee.userId, displayName: employee.displayName })} disabled={deleting}>
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

      <Panel title="Shift History & Cash Drawer Audits">
        <div className="overflow-x-auto">
          <table className="w-full text-left text-sm">
            <thead className="bg-amber-50/60 text-xs uppercase tracking-wide text-amber-700">
              <tr>
                <th className="px-4 py-3">Staff Member</th>
                <th className="px-4 py-3">Clock In</th>
                <th className="px-4 py-3">Clock Out</th>
                <th className="px-4 py-3 text-right">Opening Float</th>
                <th className="px-4 py-3 text-right">Expected Cash</th>
                <th className="px-4 py-3 text-right">Closing Count</th>
                <th className="px-4 py-3 text-right">Discrepancy</th>
                <th className="px-4 py-3 text-center">Status</th>
              </tr>
            </thead>
            <tbody>
              {shifts.length === 0 ? (
                <tr>
                  <td className="px-4 py-6 text-center text-amber-700/80" colSpan={8}>
                    No shifts logged for the selected date.
                  </td>
                </tr>
              ) : (
                shifts.map((s) => (
                  <tr className="border-t border-amber-100/60" key={s.shiftId}>
                    <td className="px-4 py-3 font-semibold text-amber-950">{s.displayName}</td>
                    <td className="px-4 py-3 text-xs tabular-nums text-amber-900">{new Date(s.clockIn).toLocaleString('en-PH', { timeZone: 'Asia/Manila' })}</td>
                    <td className="px-4 py-3 text-xs tabular-nums text-amber-900">{s.clockOut ? new Date(s.clockOut).toLocaleString('en-PH', { timeZone: 'Asia/Manila' }) : 'Active Shift'}</td>
                    <td className="px-4 py-3 text-right tabular-nums">{money.format((s as any).openingFloat ?? 1500)}</td>
                    <td className="px-4 py-3 text-right tabular-nums">{(s as any).expectedCash !== null ? money.format((s as any).expectedCash) : '—'}</td>
                    <td className="px-4 py-3 text-right tabular-nums font-semibold">{(s as any).closingCashCount !== null ? money.format((s as any).closingCashCount) : '—'}</td>
                    <td className={`px-4 py-3 text-right tabular-nums font-bold ${(s as any).cashDiscrepancy < 0 ? 'text-red-700' : (s as any).cashDiscrepancy > 0 ? 'text-emerald-700' : 'text-amber-950'}`}>
                      {(s as any).cashDiscrepancy !== null ? money.format((s as any).cashDiscrepancy) : '—'}
                    </td>
                    <td className="px-4 py-3 text-center">
                      <span className={`inline-block rounded-full px-2 py-0.5 text-xs font-bold ${(s as any).status === 'SHORTAGE' ? 'bg-red-100 text-red-800' : (s as any).status === 'OVERAGE' ? 'bg-amber-100 text-amber-800' : (s as any).status === 'OPEN' ? 'bg-emerald-100 text-emerald-800' : 'bg-gray-100 text-gray-800'}`}>
                        {(s as any).status || (s.clockOut ? 'CLOSED' : 'OPEN')}
                      </span>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </Panel>

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

      {/* Clock-In Modal */}
      {clockInModalOpen && (
        <div className="fixed inset-0 flex items-center justify-center bg-amber-950/50 z-50 p-4" role="presentation">
          <div aria-modal="true" className="w-full max-w-md rounded-2xl bg-white p-6 shadow-2xl space-y-4" role="dialog">
            <div className="flex items-start justify-between border-b border-amber-100 pb-3">
              <div>
                <h2 className="text-lg font-bold text-amber-950">Clock In Shift</h2>
                <p className="text-xs text-amber-700">Set opening cash float before starting sales.</p>
              </div>
              <button className="text-amber-800 hover:text-amber-950 font-bold text-sm" type="button" onClick={() => setClockInModalOpen(false)}>
                ✕
              </button>
            </div>

            <div className="space-y-3">
              <div>
                <label className="block text-xs font-bold uppercase tracking-wider text-amber-900 mb-1">Opening Cash Float (PHP)</label>
                <input
                  className="w-full rounded-xl border border-amber-200 bg-amber-50/30 px-3.5 py-2 text-sm font-semibold text-amber-950 outline-none focus:border-amber-500"
                  placeholder="1500.00"
                  type="number"
                  step="0.01"
                  value={openingFloatInput}
                  onChange={(e) => setOpeningFloatInput(e.target.value)}
                />
              </div>

              <div>
                <label className="block text-xs font-bold uppercase tracking-wider text-amber-900 mb-1">Shift Notes (Optional)</label>
                <textarea
                  className="w-full rounded-xl border border-amber-200 bg-amber-50/30 px-3.5 py-2 text-sm text-amber-950 outline-none focus:border-amber-500"
                  placeholder="e.g. Starting register for morning shift"
                  rows={2}
                  value={shiftNotesInput}
                  onChange={(e) => setShiftNotesInput(e.target.value)}
                />
              </div>
            </div>

            <div className="flex gap-2 pt-2 border-t border-amber-100">
              <button
                type="button"
                className="flex-1 rounded-xl border border-amber-300 bg-amber-50 px-4 py-2 text-xs font-bold text-amber-900 hover:bg-amber-100"
                onClick={() => setClockInModalOpen(false)}
                disabled={shiftBusy}
              >
                Cancel
              </button>
              <button
                type="button"
                className="flex-1 rounded-xl bg-emerald-700 px-4 py-2 text-xs font-bold text-white hover:bg-emerald-800 disabled:opacity-50"
                onClick={() => void handleClockInSubmit()}
                disabled={shiftBusy}
              >
                {shiftBusy ? 'Clocking In...' : 'Confirm Clock In'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Clock-Out Modal */}
      {clockOutModalOpen && (
        <div className="fixed inset-0 flex items-center justify-center bg-amber-950/50 z-50 p-4" role="presentation">
          <div aria-modal="true" className="w-full max-w-md rounded-2xl bg-white p-6 shadow-2xl space-y-4" role="dialog">
            <div className="flex items-start justify-between border-b border-amber-100 pb-3">
              <div>
                <h2 className="text-lg font-bold text-amber-950">Clock Out & Reconcile Cash</h2>
                <p className="text-xs text-amber-700">Enter final cash counted in the physical drawer.</p>
              </div>
              <button className="text-amber-800 hover:text-amber-950 font-bold text-sm" type="button" onClick={() => setClockOutModalOpen(false)}>
                ✕
              </button>
            </div>

            <div className="space-y-3">
              <div>
                <label className="block text-xs font-bold uppercase tracking-wider text-amber-900 mb-1">Physical Cash Count in Drawer (PHP)</label>
                <input
                  className="w-full rounded-xl border border-amber-200 bg-amber-50/30 px-3.5 py-2 text-sm font-semibold text-amber-950 outline-none focus:border-amber-500"
                  placeholder="e.g. 3450.00"
                  type="number"
                  step="0.01"
                  value={closingCashCountInput}
                  onChange={(e) => setClosingCashCountInput(e.target.value)}
                />
              </div>

              <div>
                <label className="block text-xs font-bold uppercase tracking-wider text-amber-900 mb-1">Shift Notes / Discrepancy Explanation</label>
                <textarea
                  className="w-full rounded-xl border border-amber-200 bg-amber-50/30 px-3.5 py-2 text-sm text-amber-950 outline-none focus:border-amber-500"
                  placeholder="e.g. Drawer balanced, handed over to evening cashier"
                  rows={2}
                  value={shiftNotesInput}
                  onChange={(e) => setShiftNotesInput(e.target.value)}
                />
              </div>
            </div>

            <div className="flex gap-2 pt-2 border-t border-amber-100">
              <button
                type="button"
                className="flex-1 rounded-xl border border-amber-300 bg-amber-50 px-4 py-2 text-xs font-bold text-amber-900 hover:bg-amber-100"
                onClick={() => setClockOutModalOpen(false)}
                disabled={shiftBusy}
              >
                Cancel
              </button>
              <button
                type="button"
                className="flex-1 rounded-xl bg-red-700 px-4 py-2 text-xs font-bold text-white hover:bg-red-800 disabled:opacity-50"
                onClick={() => void handleClockOutSubmit()}
                disabled={shiftBusy}
              >
                {shiftBusy ? 'Clocking Out...' : 'Confirm Clock Out'}
              </button>
            </div>
          </div>
        </div>
      )}
    </section>
  );
}
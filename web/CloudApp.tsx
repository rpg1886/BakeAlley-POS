import { useEffect, useMemo, useState, type JSX, type ReactNode } from 'react';
import { CheckoutScreen, type CheckoutCustomer, type CheckoutOrderPayload, type CheckoutProduct } from '../src/components/CheckoutScreen';
import { LoginScreen } from '../src/renderer/LoginScreen';
import { SalesView as LegacySalesView } from '../src/renderer/SalesView';
import { InventoryView as LegacyInventoryView } from '../src/renderer/InventoryView';
import { CrmView as LegacyCrmView } from '../src/renderer/CrmView';
import { CloudPosApi, type CloudSession, type CloudCategory } from './cloudApi';
import logoUrl from '../Images/bakeAlley-Logo.jpg';
import type { CloudCustomer, CloudEmployee, CloudInventoryRow, CloudOrderPayload, CloudSalesReport, CloudShift, CloudUnitOfMeasure } from './apiClient';

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

type Tab = 'checkout' | 'sales' | 'financials' | 'bi' | 'inventory' | 'crm' | 'employees';
type VelocityTimeframe = 'monthly' | 'yearly';

function getInactivityTimeout(): number {
  return INACTIVITY_TIMEOUT_MS;
}

function errorText(error: unknown, fallback: string): string {
  if (error instanceof Error) {
    const messages: Record<string, string> = { 
      CUSTOMER_HAS_ORDERS: 'This customer cannot be deleted because they have completed orders.', 
      INVALID_CUSTOMER: 'Enter a contact name and pricing tier.', 
      INVALID_EMPLOYEE: 'Enter all employee fields.', 
      PASSWORD_TOO_SHORT: 'Employee passwords must be at least 12 characters.', 
      INVALID_INVENTORY_ADJUSTMENT: 'Choose a product and lot, then enter valid quantity and price values.',
      CANNOT_DELETE_SELF: 'You cannot delete your own logged-in admin account.',
      USER_NOT_FOUND: 'Employee not found or already deactivated.',
      USERNAME_EXISTS: 'An active employee with that username already exists.'
    };
    return messages[error.message] ?? error.message;
  }
  return fallback;
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

    const activityInterval = setInterval(checkInactivity, 10000);

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
    : ['checkout', 'sales', 'employees'];

  const ownShift = shifts.find((shift) => shift.userId === session.user.userId && !shift.clockOut);

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
          <FinancialsView report={salesReport} />
        )}

        {tab === 'bi' && (
          <BiView report={salesReport} inventory={inventory} />
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
            onUpdateProduct={async (variantId, update) => {
              await api.updateInventoryProduct(variantId, update);
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
          <EmployeesView session={session} ownShift={ownShift} onShiftChange={refreshShifts} />
        )}
      </main>
    </div>
  );
}

function FinancialsView({ report }: { report: CloudSalesReport | null }): JSX.Element {
  if (!report) return <Panel title="Financial Audit"><p className="text-sm text-amber-700">Loading financial reports...</p></Panel>;

  const grossSales = report.dayGrossTotal || 0;
  const cardFeeDeduction = report.items
    .filter((i) => i.paymentMethod?.toLowerCase() === 'card')
    .reduce((sum, i) => sum + i.amount * CARD_FEE_RATE, 0);

  const netSales = grossSales - cardFeeDeduction;

  const paymentBreakdown = report.items.reduce<Record<string, number>>((acc, item) => {
    const method = item.paymentMethod || 'cash';
    acc[method] = (acc[method] || 0) + item.amount;
    return acc;
  }, {});

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-amber-950">Financial Audit & Ledger</h1>
          <p className="text-xs text-amber-700">Daily revenue statements, estimated processing fees, and payment channel breakdown.</p>
        </div>
      </div>

      <div className="grid gap-4 md:grid-cols-3">
        <div className="rounded-2xl border border-amber-200/80 bg-white p-5 shadow-sm">
          <p className="text-xs font-bold uppercase tracking-wider text-amber-700">Gross Sales</p>
          <p className="mt-2 text-2xl font-black text-amber-950">{money.format(grossSales)}</p>
          <p className="mt-1 text-[11px] text-amber-600">Total unadjusted revenue</p>
        </div>

        <div className="rounded-2xl border border-amber-200/80 bg-white p-5 shadow-sm">
          <p className="text-xs font-bold uppercase tracking-wider text-amber-700">Estimated Card Fees (2.5%)</p>
          <p className="mt-2 text-2xl font-black text-red-700">-{money.format(cardFeeDeduction)}</p>
          <p className="mt-1 text-[11px] text-amber-600">Estimated processing cost</p>
        </div>

        <div className="rounded-2xl border border-amber-200/80 bg-white p-5 shadow-sm">
          <p className="text-xs font-bold uppercase tracking-wider text-amber-700">Net Estimated Realization</p>
          <p className="mt-2 text-2xl font-black text-emerald-700">{money.format(netSales)}</p>
          <p className="mt-1 text-[11px] text-amber-600">Gross minus processing fees</p>
        </div>
      </div>

      <Panel title="Revenue by Payment Method">
        <div className="grid gap-4 sm:grid-cols-2 md:grid-cols-4">
          {Object.entries(paymentBreakdown).map(([method, amount]) => (
            <div key={method} className="rounded-xl border border-amber-100 bg-amber-50/40 p-4">
              <p className="text-xs font-bold uppercase text-amber-800">{method}</p>
              <p className="mt-1 text-lg font-bold text-amber-950">{money.format(amount)}</p>
              <p className="text-[11px] text-amber-600">{((amount / (grossSales || 1)) * 100).toFixed(1)}% of total</p>
            </div>
          ))}
        </div>
      </Panel>
    </div>
  );
}

function BiView({ report, inventory }: { report: CloudSalesReport | null; inventory: CloudInventoryRow[] }): JSX.Element {
  const [timeframe, setTimeframe] = useState<VelocityTimeframe>('monthly');

  if (!report) return <Panel title="Business Intelligence"><p className="text-sm text-amber-700">Loading analytics...</p></Panel>;

  const totalCapital = inventory.reduce((sum, item) => sum + item.initialCapital * item.quantityOnHand, 0);
  const totalRetailValue = inventory.reduce((sum, item) => sum + item.retailPrice * item.quantityOnHand, 0);
  const potentialProfit = totalRetailValue - totalCapital;

  const productSales = report.items.reduce<Record<string, { sku: string; name: string; quantity: number; amount: number }>>((acc, item) => {
    if (!acc[item.sku]) {
      acc[item.sku] = { sku: item.sku, name: item.itemName, quantity: 0, amount: 0 };
    }
    acc[item.sku].quantity += item.quantity;
    acc[item.sku].amount += item.amount;
    return acc;
  }, {});

  const sortedProducts = Object.values(productSales).sort((a, b) => b.amount - a.amount);
  const multiplier = timeframe === 'monthly' ? 30 : 365;

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-amber-950">Business Intelligence & Velocity Analytics</h1>
          <p className="text-xs text-amber-700">Valuation, product sales velocity, and projected turnover.</p>
        </div>

        <div className="flex gap-1 rounded-xl bg-amber-100/60 p-1 border border-amber-200">
          <button
            type="button"
            className={`rounded-lg px-3 py-1 text-xs font-bold ${timeframe === 'monthly' ? 'bg-amber-800 text-white' : 'text-amber-900'}`}
            onClick={() => setTimeframe('monthly')}
          >
            Monthly Run-rate
          </button>
          <button
            type="button"
            className={`rounded-lg px-3 py-1 text-xs font-bold ${timeframe === 'yearly' ? 'bg-amber-800 text-white' : 'text-amber-900'}`}
            onClick={() => setTimeframe('yearly')}
          >
            Annual Projection
          </button>
        </div>
      </div>

      <div className="grid gap-4 md:grid-cols-3">
        <div className="rounded-2xl border border-amber-200/80 bg-white p-5 shadow-sm">
          <p className="text-xs font-bold uppercase tracking-wider text-amber-700">Total Inventory Capital</p>
          <p className="mt-2 text-2xl font-black text-amber-950">{money.format(totalCapital)}</p>
          <p className="mt-1 text-[11px] text-amber-600">Asset cost on hand</p>
        </div>

        <div className="rounded-2xl border border-amber-200/80 bg-white p-5 shadow-sm">
          <p className="text-xs font-bold uppercase tracking-wider text-amber-700">Retail Asset Value</p>
          <p className="mt-2 text-2xl font-black text-amber-950">{money.format(totalRetailValue)}</p>
          <p className="mt-1 text-[11px] text-amber-600">Potential retail realization</p>
        </div>

        <div className="rounded-2xl border border-amber-200/80 bg-white p-5 shadow-sm">
          <p className="text-xs font-bold uppercase tracking-wider text-amber-700">Potential Retail Margin</p>
          <p className="mt-2 text-2xl font-black text-emerald-700">{money.format(potentialProfit)}</p>
          <p className="mt-1 text-[11px] text-amber-600">Expected unrealized profit</p>
        </div>
      </div>

      <Panel title={`Top Selling Items Velocity (${timeframe === 'monthly' ? '30-Day' : '365-Day'} Projection)`}>
        <div className="overflow-x-auto">
          <table className="w-full text-left text-xs">
            <thead className="border-b border-amber-100 bg-amber-50/50 uppercase text-amber-800">
              <tr>
                <th className="py-2.5 px-3">SKU</th>
                <th className="py-2.5 px-3">Item Name</th>
                <th className="py-2.5 px-3 text-right">Daily Units Sold</th>
                <th className="py-2.5 px-3 text-right">Daily Revenue</th>
                <th className="py-2.5 px-3 text-right">Projected Run-rate ({multiplier}d)</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-amber-100/60">
              {sortedProducts.map((p) => (
                <tr key={p.sku} className="hover:bg-amber-50/30">
                  <td className="py-2.5 px-3 font-mono font-semibold text-amber-900">{p.sku}</td>
                  <td className="py-2.5 px-3 font-medium text-amber-950">{p.name}</td>
                  <td className="py-2.5 px-3 text-right font-bold text-amber-950">{p.quantity}</td>
                  <td className="py-2.5 px-3 text-right font-bold text-amber-950">{money.format(p.amount)}</td>
                  <td className="py-2.5 px-3 text-right font-black text-emerald-700">{money.format(p.amount * multiplier)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Panel>
    </div>
  );
}

function SalesView({ report, selectedDate, onDateChange, loading }: { report: CloudSalesReport | null; selectedDate: string; onDateChange: (date: string) => void; loading?: boolean }): JSX.Element {
  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-amber-950">Daily Transaction Journal</h1>
          <p className="text-xs text-amber-700">Detailed line-item record of completed sales.</p>
        </div>

        <div className="flex items-center gap-2">
          <label className="text-xs font-bold text-amber-900">Select Date:</label>
          <input
            type="date"
            className="rounded-xl border border-amber-200/80 bg-white px-3 py-1.5 text-xs font-semibold text-amber-950"
            value={selectedDate}
            onChange={(e) => onDateChange(e.target.value)}
          />
        </div>
      </div>

      <LegacySalesView report={report} loading={loading} />
    </div>
  );
}

function InventoryView({ inventory, onRefresh, onAdjustStock, onCreateProduct, onUpdateProduct, isAdmin }: { inventory: CloudInventoryRow[]; onRefresh: () => void; onAdjustStock: (adj: any) => Promise<void>; onCreateProduct: (prod: any) => Promise<void>; onUpdateProduct?: (variantId: string, update: any) => Promise<void>; isAdmin: boolean }): JSX.Element {
  const [categories, setCategories] = useState<CloudCategory[]>([]);
  const [units, setUnits] = useState<CloudUnitOfMeasure[]>([]);
  const [selectedCategory, setSelectedCategory] = useState<string>('');

  useEffect(() => {
    api.categories().then(setCategories).catch(console.error);
    api.getUnitsOfMeasure().then(setUnits).catch(console.error);
  }, []);

  const filteredInventory = useMemo(() => {
    if (!selectedCategory) return inventory;
    return inventory.filter(i => (i as any).categoryId === selectedCategory || (i as any).categoryName === selectedCategory);
  }, [inventory, selectedCategory]);

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-amber-950">Inventory & Stock Control</h1>
          <p className="text-xs text-amber-700">Manage products, pricing tiers, and FEFO lot quantities.</p>
        </div>

        <div className="flex items-center gap-3">
          <select
            className="rounded-xl border border-amber-200/80 bg-white px-3 py-1.5 text-xs font-semibold text-amber-950"
            value={selectedCategory}
            onChange={(e) => setSelectedCategory(e.target.value)}
          >
            <option value="">All Categories</option>
            {categories.map((c) => (
              <option key={c.categoryId} value={c.categoryId}>{c.name}</option>
            ))}
          </select>

          <ActionButton onClick={onRefresh}>Refresh Inventory</ActionButton>
        </div>
      </div>

      <LegacyInventoryView
        inventory={filteredInventory}
        onRefresh={onRefresh}
        onAdjustStock={onAdjustStock}
        onCreateProduct={onCreateProduct}
        onUpdateProduct={onUpdateProduct}
        categories={categories}
        units={units}
        isAdmin={isAdmin}
      />
    </div>
  );
}

function CrmView({ customers, onRefresh, onCreateCustomer, onDeleteCustomer, isAdmin }: { customers: CloudCustomer[]; onRefresh: () => void; onCreateCustomer: (cust: any) => Promise<void>; onDeleteCustomer: (id: string) => Promise<void>; isAdmin: boolean }): JSX.Element {
  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-amber-950">Customer Relationship Management</h1>
          <p className="text-xs text-amber-700">Customer directory and tier assignments.</p>
        </div>
        <ActionButton onClick={onRefresh}>Refresh Directory</ActionButton>
      </div>

      <LegacyCrmView
        customers={customers}
        onRefresh={onRefresh}
        onCreateCustomer={onCreateCustomer}
        onDeleteCustomer={onDeleteCustomer}
        isAdmin={isAdmin}
      />
    </div>
  );
}

function EmployeesView({ session, ownShift, onShiftChange }: { session: CloudSession; ownShift?: CloudShift; onShiftChange: () => void }): JSX.Element {
  const [employees, setEmployees] = useState<CloudEmployee[]>([]);
  const [shifts, setShifts] = useState<CloudShift[]>([]);
  const [selectedDate, setSelectedDate] = useState<string>(today());
  const [form, setForm] = useState({ username: '', displayName: '', role: 'cashier' as 'admin' | 'cashier', password: '' });
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [deleteConfirm, setDeleteConfirm] = useState<{ userId: string; displayName: string } | null>(null);
  const [deleting, setDeleting] = useState(false);

  const [clockInModalOpen, setClockInModalOpen] = useState(false);
  const [clockOutModalOpen, setClockOutModalOpen] = useState(false);
  const [openingFloat, setOpeningFloat] = useState<string>('1500');
  const [closingCashCount, setClosingCashCount] = useState<string>('');
  const [shiftNotes, setShiftNotes] = useState<string>('');
  const [shiftSubmitting, setShiftSubmitting] = useState(false);

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

  const handleClockInSubmit = async () => {
    setShiftSubmitting(true);
    setError(null);
    try {
      const floatVal = Number(openingFloat) || 1500;
      await clockInWithFloat(floatVal, shiftNotes);
      setClockInModalOpen(false);
      setShiftNotes('');
      setMessage('Clocked in successfully.');
      onShiftChange();
      await refresh();
    } catch (reason) {
      setError(errorText(reason, 'Clock-in failed.'));
    } finally {
      setShiftSubmitting(false);
    }
  };

  const handleClockOutSubmit = async () => {
    setShiftSubmitting(true);
    setError(null);
    try {
      const closingVal = closingCashCount !== '' ? Number(closingCashCount) : null;
      await clockOutWithCount(closingVal, shiftNotes);
      setClockOutModalOpen(false);
      setClosingCashCount('');
      setShiftNotes('');
      setMessage('Clocked out successfully.');
      onShiftChange();
      await refresh();
    } catch (reason) {
      setError(errorText(reason, 'Clock-out failed.'));
    } finally {
      setShiftSubmitting(false);
    }
  };

  return (
    <section className="mx-auto max-w-7xl space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-3xl font-bold text-amber-950">Employee & Shift Control</h1>
          <p className="mt-1 text-sm text-amber-700">{isAdmin ? 'Permissions, active shifts, and individual sales metrics.' : 'Your shift clock-in status and sales metrics.'}</p>
        </div>

        <div className="flex items-center gap-2">
          {ownShift ? (
            <button
              className="rounded-xl bg-red-700 px-4 py-2 text-xs font-bold text-white hover:bg-red-800 shadow-sm"
              type="button"
              onClick={() => setClockOutModalOpen(true)}
            >
              Clock Out (End Shift)
            </button>
          ) : (
            <button
              className="rounded-xl bg-emerald-700 px-4 py-2 text-xs font-bold text-white hover:bg-emerald-800 shadow-sm"
              type="button"
              onClick={() => setClockInModalOpen(true)}
            >
              Clock In (Start Shift)
            </button>
          )}

          <button className="rounded-xl border border-amber-200/80 bg-white px-4 py-2 text-xs font-bold text-amber-950 shadow-sm" type="button" onClick={() => void refresh()}>
            Refresh
          </button>
        </div>
      </div>

      {message && <p className="rounded-xl bg-emerald-50 p-3 text-xs font-semibold text-emerald-700 border border-emerald-200">{message}</p>}
      {error && <p className="rounded-xl bg-red-50 p-3 text-xs font-semibold text-red-700 border border-red-200" role="alert">{error}</p>}

      {isAdmin && (
        <Panel title="Add New Employee">
          <div className="grid gap-3 md:grid-cols-4">
            <input className="rounded-xl border border-amber-200/80 px-3 py-2 text-xs" placeholder="Username" value={form.username} onChange={(event) => setForm({ ...form, username: event.target.value })} />
            <input className="rounded-xl border border-amber-200/80 px-3 py-2 text-xs" placeholder="Display name" value={form.displayName} onChange={(event) => setForm({ ...form, displayName: event.target.value })} />
            <select className="rounded-xl border border-amber-200/80 px-3 py-2 text-xs" value={form.role} onChange={(event) => setForm({ ...form, role: event.target.value as 'admin' | 'cashier' })}>
              <option value="cashier">Cashier</option>
              <option value="admin">Admin</option>
            </select>
            <input className="rounded-xl border border-amber-200/80 px-3 py-2 text-xs" minLength={12} placeholder="Password (12+ characters)" type="password" value={form.password} onChange={(event) => setForm({ ...form, password: event.target.value })} />
            <button className="rounded-xl bg-amber-800 px-4 py-2 font-bold text-xs text-white disabled:opacity-50 md:col-span-4 hover:bg-amber-900" disabled={saving || !form.username.trim() || !form.displayName.trim() || form.password.length < 12} type="button" onClick={() => void addEmployee()}>
              {saving ? 'Saving...' : 'Add Employee'}
            </button>
          </div>
        </Panel>
      )}

      <Panel title="Active Employee Roster">
        <div className="overflow-x-auto">
          <table className="w-full text-left text-xs">
            <thead className="bg-amber-50/60 uppercase text-amber-800 border-b border-amber-100">
              <tr>
                <th className="px-4 py-2.5">Employee</th>
                <th className="px-3 py-2.5">Role</th>
                <th className="px-3 py-2.5 text-right">Orders Processed</th>
                <th className="px-3 py-2.5 text-right">Sales Amount</th>
                <th className="px-4 py-2.5 text-right">Action</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-amber-100/60">
              {employees.map((employee) => {
                const isSelf = employee.userId === session.user.userId;
                return (
                  <tr className="hover:bg-amber-50/30" key={employee.userId}>
                    <td className="px-4 py-3">
                      <strong className="text-amber-950 font-bold">{employee.displayName}</strong>
                      <div className="text-[11px] text-amber-700">{employee.username}</div>
                    </td>
                    <td className="px-3 py-3 capitalize font-semibold">{employee.role}</td>
                    <td className="px-3 py-3 text-right font-bold text-amber-950 tabular-nums">{employee.salesCount}</td>
                    <td className="px-3 py-3 text-right font-bold text-amber-950 tabular-nums">{money.format(employee.salesAmount)}</td>
                    <td className="px-4 py-3 text-right">
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
      </Panel>

      <Panel title="Shift History Log">
        <div className="overflow-x-auto">
          <table className="w-full text-left text-xs">
            <thead className="bg-amber-50/60 uppercase text-amber-800 border-b border-amber-100">
              <tr>
                <th className="px-4 py-2.5">Staff</th>
                <th className="px-3 py-2.5">Clock In</th>
                <th className="px-3 py-2.5">Clock Out</th>
                <th className="px-3 py-2.5 text-right">Opening Float</th>
                <th className="px-3 py-2.5 text-right">Closing Count</th>
                <th className="px-3 py-2.5 text-right">Expected Cash</th>
                <th className="px-3 py-2.5 text-right">Variance</th>
                <th className="px-3 py-2.5 text-center">Status</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-amber-100/60">
              {shifts.map((s) => (
                <tr key={s.shiftId} className="hover:bg-amber-50/30">
                  <td className="px-4 py-3 font-bold text-amber-950">{s.displayName}</td>
                  <td className="px-3 py-3 text-amber-800">{new Date(s.clockIn).toLocaleString('en-PH', { timeZone: 'Asia/Manila' })}</td>
                  <td className="px-3 py-3 text-amber-800">{s.clockOut ? new Date(s.clockOut).toLocaleString('en-PH', { timeZone: 'Asia/Manila' }) : '—'}</td>
                  <td className="px-3 py-3 text-right font-semibold text-amber-950 tabular-nums">{money.format(s.openingFloat ?? 1500)}</td>
                  <td className="px-3 py-3 text-right font-semibold text-amber-950 tabular-nums">{s.closingCashCount !== null && s.closingCashCount !== undefined ? money.format(s.closingCashCount) : '—'}</td>
                  <td className="px-3 py-3 text-right font-semibold text-amber-950 tabular-nums">{s.expectedCash !== null && s.expectedCash !== undefined ? money.format(s.expectedCash) : '—'}</td>
                  <td className="px-3 py-3 text-right font-bold tabular-nums">
                    {s.cashDiscrepancy !== null && s.cashDiscrepancy !== undefined ? (
                      <span className={s.cashDiscrepancy < 0 ? 'text-red-700' : s.cashDiscrepancy > 0 ? 'text-emerald-700' : 'text-amber-900'}>
                        {money.format(s.cashDiscrepancy)}
                      </span>
                    ) : '—'}
                  </td>
                  <td className="px-3 py-3 text-center">
                    <span className={`inline-block rounded-full px-2 py-0.5 text-[10px] font-bold uppercase ${s.status === 'OPEN' ? 'bg-emerald-100 text-emerald-800' : 'bg-amber-100 text-amber-800'}`}>
                      {s.status || (s.clockOut ? 'CLOSED' : 'OPEN')}
                    </span>
                  </td>
                </tr>
              ))}
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
            <h2 className="text-lg font-bold text-amber-950">Clock In (Start Shift)</h2>
            <div className="space-y-3">
              <div>
                <label className="block text-xs font-bold uppercase text-amber-900 mb-1">Opening Cash Float (\u20B1)</label>
                <input
                  type="number"
                  step="0.01"
                  className="w-full rounded-xl border border-amber-200 bg-amber-50/20 px-3 py-2 text-sm font-semibold text-amber-950"
                  value={openingFloat}
                  onChange={(e) => setOpeningFloat(e.target.value)}
                />
              </div>
              <div>
                <label className="block text-xs font-bold uppercase text-amber-900 mb-1">Shift Notes (Optional)</label>
                <input
                  type="text"
                  className="w-full rounded-xl border border-amber-200 bg-amber-50/20 px-3 py-2 text-xs font-medium text-amber-950"
                  placeholder="e.g. Opening shift cash float verified"
                  value={shiftNotes}
                  onChange={(e) => setShiftNotes(e.target.value)}
                />
              </div>
            </div>
            <div className="flex gap-2 pt-2 border-t border-amber-100">
              <button
                type="button"
                className="flex-1 rounded-xl border border-amber-300 bg-amber-50 px-4 py-2 text-xs font-bold text-amber-900 hover:bg-amber-100"
                onClick={() => setClockInModalOpen(false)}
                disabled={shiftSubmitting}
              >
                Cancel
              </button>
              <button
                type="button"
                className="flex-1 rounded-xl bg-emerald-700 px-4 py-2 text-xs font-bold text-white hover:bg-emerald-800 disabled:opacity-50"
                onClick={() => void handleClockInSubmit()}
                disabled={shiftSubmitting}
              >
                {shiftSubmitting ? 'Starting...' : 'Confirm Clock-In'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Clock-Out Modal */}
      {clockOutModalOpen && (
        <div className="fixed inset-0 flex items-center justify-center bg-amber-950/50 z-50 p-4" role="presentation">
          <div aria-modal="true" className="w-full max-w-md rounded-2xl bg-white p-6 shadow-2xl space-y-4" role="dialog">
            <h2 className="text-lg font-bold text-amber-950">Clock Out (End Shift)</h2>
            <div className="space-y-3">
              <div>
                <label className="block text-xs font-bold uppercase text-amber-900 mb-1">Closing Cash Drawer Count (\u20B1)</label>
                <input
                  type="number"
                  step="0.01"
                  className="w-full rounded-xl border border-amber-200 bg-amber-50/20 px-3 py-2 text-sm font-semibold text-amber-950"
                  placeholder="Count total physical cash in drawer"
                  value={closingCashCount}
                  onChange={(e) => setClosingCashCount(e.target.value)}
                />
              </div>
              <div>
                <label className="block text-xs font-bold uppercase text-amber-900 mb-1">Closing Shift Notes (Optional)</label>
                <input
                  type="text"
                  className="w-full rounded-xl border border-amber-200 bg-amber-50/20 px-3 py-2 text-xs font-medium text-amber-950"
                  placeholder="e.g. End of day cash drop completed"
                  value={shiftNotes}
                  onChange={(e) => setShiftNotes(e.target.value)}
                />
              </div>
            </div>
            <div className="flex gap-2 pt-2 border-t border-amber-100">
              <button
                type="button"
                className="flex-1 rounded-xl border border-amber-300 bg-amber-50 px-4 py-2 text-xs font-bold text-amber-900 hover:bg-amber-100"
                onClick={() => setClockOutModalOpen(false)}
                disabled={shiftSubmitting}
              >
                Cancel
              </button>
              <button
                type="button"
                className="flex-1 rounded-xl bg-red-700 px-4 py-2 text-xs font-bold text-white hover:bg-red-800 disabled:opacity-50"
                onClick={() => void handleClockOutSubmit()}
                disabled={shiftSubmitting}
              >
                {shiftSubmitting ? 'Ending Shift...' : 'Confirm Clock-Out'}
              </button>
            </div>
          </div>
        </div>
      )}
    </section>
  );
}

async function clockInWithFloat(openingFloat: number, notes?: string): Promise<CloudShift> {
  const token = localStorage.getItem('bakealley_cloud_token') || sessionStorage.getItem('bakealley_cloud_token');
  const baseUrl = import.meta.env.VITE_API_URL || 'https://bakealley-pos-production.up.railway.app';
  const sanitizedUrl = baseUrl.replace(/\/+$/, '');
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
  const sanitizedUrl = baseUrl.replace(/\/+$/, '');
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
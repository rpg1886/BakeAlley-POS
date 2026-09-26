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
const LOW_STOCK_THRESHOLD = 10;
const CARD_FEE_RATE = 0.025; // 2.5% estimated card fee

const money = new Intl.NumberFormat('en-PH', { style: 'currency', currency: 'PHP', minimumFractionDigits: 2, maximumFractionDigits: 2 });
const today = (): string => new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Manila' }).format(new Date());

type Tab = 'checkout' | 'sales' | 'financials' | 'bi' | 'inventory' | 'crm' | 'employees';
type VelocityTimeframe = 'monthly' | 'yearly';

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
    <div className="rounded-xl border border-amber-200/80 bg-white p-4 shadow-sm">
      <p className="text-sm font-semibold uppercase tracking-wide text-amber-700">{label}</p>
      <p className="mt-1 text-xs text-amber-700">{period.startDate} to {period.endDate}</p>
      <div className="mt-3 flex justify-between text-sm"><span>Gross</span><strong className="text-amber-950">{money.format(Number(period.grossTotal) || 0)}</strong></div>
      <div className="flex justify-between text-sm"><span>Orders</span><strong className="text-amber-950">{Number(period.orderCount) || 0}</strong></div>
    </div>
  );
}

/* ==========================================================================
   FINANCIAL REPORT VIEW (EOD AUDIT + PDF/CSV EXPORTS)
   ========================================================================== */
function FinancialsView({ isAdmin }: { isAdmin: boolean }): JSX.Element {
  const [selectedDate, setSelectedDate] = useState<string>(() => localStorage.getItem('bakealley_pos_financial_date') || today());
  const [report, setReport] = useState<CloudSalesReport | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    localStorage.setItem('bakealley_pos_financial_date', selectedDate);
  }, [selectedDate]);

  const refresh = async (): Promise<void> => {
    setLoading(true);
    setError(null);
    try {
      setReport(await api.salesReport(selectedDate));
    } catch (reason) {
      setError(errorText(reason, 'Unable to generate financial report.'));
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void refresh();
  }, [selectedDate]);

  const dayGross = Number(report?.dayGrossTotal) || 0;
  const dayNet = Number(report?.dayNetTotal) || 0;
  const orderCount = Number(report?.dayOrderCount) || 0;
  const avgOrderValue = orderCount > 0 ? dayGross / orderCount : 0;
  const totalItemsSold = (report?.items || []).reduce((sum, item) => sum + (Number(item.quantity) || 0), 0);
  const avgUnitsPerOrder = orderCount > 0 ? totalItemsSold / orderCount : 0;

  const estimatedCogs = dayGross / 1.20;
  const grossProfit = dayGross - estimatedCogs;
  const profitMarginPct = dayGross > 0 ? (grossProfit / dayGross) * 100 : 0;

  const paymentBreakdown = (report?.items || []).reduce(
    (acc, item) => {
      const method = (item.paymentMethod || 'cash').toLowerCase();
      const amount = Number(item.amount) || 0;
      if (method === 'cash') acc.cash += amount;
      else if (method === 'card') acc.card += amount;
      else if (method === 'gcash') acc.gcash += amount;
      else acc.account += amount;
      return acc;
    },
    { cash: 0, card: 0, gcash: 0, account: 0 }
  );

  const estimatedCardFees = paymentBreakdown.card * CARD_FEE_RATE;

  const exportCsv = (): void => {
    if (!report) return;
    const items = report.items || [];
    const csvData = [
      ['Bake Alley Cloud POS — End of Day Financial Audit Statement'],
      ['Audit Date', selectedDate],
      ['Generated Date/Time', new Date().toLocaleString()],
      [''],
      ['FINANCIAL METRIC', 'VALUE (PHP)'],
      ['Gross Sales Revenue', dayGross.toFixed(2)],
      ['Net Revenue', dayNet.toFixed(2)],
      ['Estimated Cost of Goods Sold (COGS)', estimatedCogs.toFixed(2)],
      ['Estimated Gross Profit', grossProfit.toFixed(2)],
      ['Profit Margin %', `${profitMarginPct.toFixed(1)}%`],
      ['Total Orders Completed', orderCount],
      ['Average Order Value (AOV)', avgOrderValue.toFixed(2)],
      ['Average Units Per Basket', avgUnitsPerOrder.toFixed(2)],
      ['Cash Payments Received', paymentBreakdown.cash.toFixed(2)],
      ['Card Payments Received', paymentBreakdown.card.toFixed(2)],
      ['GCash Payments Received', paymentBreakdown.gcash.toFixed(2)],
      ['Account Charges Received', paymentBreakdown.account.toFixed(2)],
      ['Estimated Card Fees (2.5%)', estimatedCardFees.toFixed(2)],
      [''],
      ['Time', 'Customer', 'Item Name', 'SKU', 'Quantity', 'Amount (PHP)', 'Payment Method'],
      ...items.map((item) => [
        new Date(item.soldAt).toLocaleTimeString(),
        `"${(item.customerName || 'Walk-in').replace(/"/g, '""')}"`,
        `"${(item.itemName || '').replace(/"/g, '""')}"`,
        item.sku,
        Number(item.quantity).toFixed(4),
        Number(item.amount).toFixed(2),
        item.paymentMethod,
      ]),
    ];

    const csvContent = 'data:text/csv;charset=utf-8,' + csvData.map((row) => row.join(',')).join('\n');
    const encodedUri = encodeURI(csvContent);
    const downloadLink = document.createElement('a');
    downloadLink.setAttribute('href', encodedUri);
    downloadLink.setAttribute('download', `EOD_Financial_Report_${selectedDate}.csv`);
    document.body.appendChild(downloadLink);
    downloadLink.click();
    document.body.removeChild(downloadLink);
  };

  const exportPdfPrint = (): void => {
    if (!report) return;
    const printWindow = window.open('', '_blank');
    if (!printWindow) return;

    const printContent = `
      <!DOCTYPE html>
      <html>
        <head>
          <title>Bake Alley POS - EOD Financial Statement (${selectedDate})</title>
          <style>
            body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; padding: 24px; color: #271c19; }
            h1 { color: #451a03; border-bottom: 2px solid #78350f; padding-bottom: 8px; margin-bottom: 4px; font-size: 22px; }
            .header-info { display: flex; justify-content: space-between; font-size: 13px; color: #78350f; margin-bottom: 20px; }
            .summary-grid { display: grid; grid-template-cols: repeat(4, 1fr); gap: 10px; margin-bottom: 20px; }
            .card { border: 1px solid #fde68a; background: #fffbeb; padding: 12px; rounded-md: 8px; }
            .card p { font-size: 11px; text-transform: uppercase; color: #92400e; margin: 0; }
            .card strong { font-size: 18px; color: #451a03; display: block; margin-top: 4px; }
            table { width: 100%; border-collapse: collapse; margin-top: 12px; font-size: 12px; }
            th, td { border: 1px solid #fde68a; padding: 8px; text-align: left; }
            th { background-color: #fef3c7; color: #78350f; text-transform: uppercase; font-size: 10px; }
            .text-right { text-align: right; }
            @media print { button { display: none; } }
          </style>
        </head>
        <body>
          <h1>🍞 Bake Alley Cloud POS — End of Day Financial Audit</h1>
          <div class="header-info">
            <div><strong>Audit Date:</strong> ${selectedDate}</div>
            <div><strong>Generated:</strong> ${new Date().toLocaleString()}</div>
          </div>
          <div class="summary-grid">
            <div class="card"><p>Gross Revenue</p><strong>PHP ${dayGross.toLocaleString('en-PH', { minimumFractionDigits: 2 })}</strong></div>
            <div class="card"><p>Net Revenue</p><strong>PHP ${dayNet.toLocaleString('en-PH', { minimumFractionDigits: 2 })}</strong></div>
            <div class="card"><p>Estimated COGS</p><strong>PHP ${estimatedCogs.toLocaleString('en-PH', { minimumFractionDigits: 2 })}</strong></div>
            <div class="card"><p>Gross Profit Margin</p><strong>${profitMarginPct.toFixed(1)}%</strong></div>
          </div>
          <h3>Payment Method Reconciliation</h3>
          <p style="font-size: 13px;">
            <strong>Cash:</strong> PHP ${paymentBreakdown.cash.toFixed(2)} | 
            <strong>Card:</strong> PHP ${paymentBreakdown.card.toFixed(2)} | 
            <strong>GCash:</strong> PHP ${paymentBreakdown.gcash.toFixed(2)} | 
            <strong>Account:</strong> PHP ${paymentBreakdown.account.toFixed(2)}
          </p>
          <h3>Line Item Transaction Audit</h3>
          <table>
            <thead>
              <tr><th>Time</th><th>Customer</th><th>Item Name</th><th>SKU</th><th class="text-right">Qty</th><th class="text-right">Amount</th><th>Method</th></tr>
            </thead>
            <tbody>
              ${(report.items || []).map((item) => `
                <tr>
                  <td>${new Date(item.soldAt).toLocaleTimeString()}</td>
                  <td>${item.customerName || 'Walk-in'}</td>
                  <td>${item.itemName}</td>
                  <td>${item.sku}</td>
                  <td class="text-right">${Number(item.quantity).toFixed(2)}</td>
                  <td class="text-right">PHP ${Number(item.amount).toFixed(2)}</td>
                  <td style="text-transform: capitalize;">${item.paymentMethod}</td>
                </tr>
              `).join('')}
            </tbody>
          </table>
          <script>
            window.onload = function() { window.print(); }
          </script>
        </body>
      </html>
    `;
    printWindow.document.write(printContent);
    printWindow.document.close();
  };

  return (
    <Panel title="Financial Statements & Accounting Audit">
      <div className="mb-6 flex flex-wrap items-end justify-between gap-4 border-b border-amber-100 pb-4">
        <div>
          <label className="text-sm font-semibold text-amber-900 block mb-1">Select Audit Date</label>
          <input
            className="rounded-lg border border-amber-200/80 px-3 py-2 text-sm outline-none focus:border-amber-500"
            type="date"
            value={selectedDate}
            onChange={(event) => setSelectedDate(event.target.value)}
          />
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <button
            type="button"
            onClick={exportCsv}
            disabled={loading || !report}
            className="rounded-lg border border-amber-300 bg-amber-50 px-3.5 py-2 text-xs font-bold text-amber-900 shadow-sm hover:bg-amber-100 disabled:opacity-50"
          >
            📥 Export CSV
          </button>
          <button
            type="button"
            onClick={exportPdfPrint}
            disabled={loading || !report}
            className="rounded-lg bg-amber-800 px-3.5 py-2 text-xs font-bold text-white shadow-sm hover:bg-amber-900 disabled:opacity-50"
          >
            🖨️ Print / Save PDF
          </button>
          <ActionButton disabled={loading} onClick={() => void refresh()}>{loading ? 'Generating...' : 'Refresh'}</ActionButton>
        </div>
      </div>

      {error && <p className="mb-4 rounded-lg bg-red-50 p-3 text-sm text-red-700" role="alert">{error}</p>}

      {report && !loading && (
        <div className="space-y-8">
          <section>
            <div className="flex items-center justify-between mb-3">
              <h2 className="font-bakery text-lg font-bold text-amber-950">End of Day (EOD) Audit — {selectedDate}</h2>
              <span className="rounded-full bg-amber-100 px-3 py-1 text-xs font-semibold text-amber-800">Verified EOD Statement</span>
            </div>

            <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
              <div className="rounded-xl border border-amber-200/80 bg-amber-950 p-4 text-white shadow-sm">
                <p className="text-xs uppercase tracking-wider text-amber-200/80">EOD Gross Revenue</p>
                <strong className="mt-1 block text-2xl font-bold tabular-nums">{money.format(dayGross)}</strong>
                <p className="mt-1 text-xs text-amber-200/70">{orderCount} completed transactions</p>
              </div>
              <div className="rounded-xl border border-amber-200/80 bg-emerald-700 p-4 text-white shadow-sm">
                <p className="text-xs uppercase tracking-wider text-emerald-100">EOD Net Revenue</p>
                <strong className="mt-1 block text-2xl font-bold tabular-nums">{money.format(dayNet)}</strong>
                <p className="mt-1 text-xs text-emerald-100/80">Realized revenue</p>
              </div>
              <div className="rounded-xl border border-amber-200/80 bg-amber-50/80 p-4 shadow-sm">
                <p className="text-xs uppercase tracking-wider text-amber-700">Est. Gross Profit & Margin</p>
                <strong className="mt-1 block text-2xl font-bold text-amber-950 tabular-nums">{money.format(grossProfit)}</strong>
                <p className="mt-1 text-xs font-semibold text-emerald-700">{profitMarginPct.toFixed(1)}% Profit Margin</p>
              </div>
              <div className="rounded-xl border border-amber-200/80 bg-amber-50/80 p-4 shadow-sm">
                <p className="text-xs uppercase tracking-wider text-amber-700">Basket & Size Metrics</p>
                <strong className="mt-1 block text-2xl font-bold text-amber-950 tabular-nums">{money.format(avgOrderValue)}</strong>
                <p className="mt-1 text-xs text-amber-700">{avgUnitsPerOrder.toFixed(1)} items avg / basket</p>
              </div>
            </div>

            <div className="mt-4 grid gap-4 md:grid-cols-2">
              <div className="rounded-xl border border-amber-200/60 bg-amber-50/30 p-4">
                <h3 className="text-xs font-bold uppercase tracking-wider text-amber-800 mb-3">Register Cash Drawer vs Digital Tender</h3>
                <div className="grid grid-cols-4 gap-2 text-center text-sm">
                  <div className="rounded-lg bg-white p-2 border border-amber-200/60">
                    <span className="text-[10px] text-amber-700 font-semibold block">💵 Cash</span>
                    <strong className="text-amber-950 text-xs tabular-nums">{money.format(paymentBreakdown.cash)}</strong>
                  </div>
                  <div className="rounded-lg bg-white p-2 border border-amber-200/60">
                    <span className="text-[10px] text-amber-700 font-semibold block">💳 Card</span>
                    <strong className="text-amber-950 text-xs tabular-nums">{money.format(paymentBreakdown.card)}</strong>
                  </div>
                  <div className="rounded-lg bg-white p-2 border border-amber-200/60">
                    <span className="text-[10px] text-sky-700 font-bold block">📲 GCash</span>
                    <strong className="text-amber-950 text-xs tabular-nums">{money.format(paymentBreakdown.gcash)}</strong>
                  </div>
                  <div className="rounded-lg bg-white p-2 border border-amber-200/60">
                    <span className="text-[10px] text-amber-700 font-semibold block">📋 Account</span>
                    <strong className="text-amber-950 text-xs tabular-nums">{money.format(paymentBreakdown.account)}</strong>
                  </div>
                </div>
              </div>

              <div className="rounded-xl border border-amber-200/60 bg-amber-50/30 p-4">
                <h3 className="text-xs font-bold uppercase tracking-wider text-amber-800 mb-3">Cost Analysis & Processing Fee Forecast</h3>
                <div className="space-y-2 text-sm">
                  <div className="flex justify-between border-b border-amber-100 pb-1">
                    <span className="text-amber-800">Estimated Cost of Goods (COGS):</span>
                    <strong className="tabular-nums">{money.format(estimatedCogs)}</strong>
                  </div>
                  <div className="flex justify-between border-b border-amber-100 pb-1">
                    <span className="text-amber-800">Est. Merchant Card Fees (2.5%):</span>
                    <strong className="tabular-nums text-red-700">-{money.format(estimatedCardFees)}</strong>
                  </div>
                  <div className="flex justify-between pt-1">
                    <span className="font-semibold text-amber-950">Net Operating Realization:</span>
                    <strong className="tabular-nums text-emerald-800">{money.format(grossProfit - estimatedCardFees)}</strong>
                  </div>
                </div>
              </div>
            </div>
          </section>

          {isAdmin && (
            <section className="border-t border-amber-100 pt-6">
              <h2 className="font-bakery text-lg font-bold text-amber-950 mb-4">Executive Period Summaries (EOW / EOM / EOY)</h2>
              <div className="grid gap-4 md:grid-cols-3">
                <PeriodCard label="End of Week (EOW)" period={report.week} />
                <PeriodCard label="End of Month (EOM)" period={report.month} />
                <PeriodCard label="End of Year (EOY)" period={report.year} />
              </div>
            </section>
          )}
        </div>
      )}
    </Panel>
  );
}

/* ==========================================================================
   BUSINESS INTELLIGENCE VIEW (MONTHLY VS YEARLY VELOCITY)
   ========================================================================== */
function BiView(): JSX.Element {
  const [timeframe, setTimeframe] = useState<VelocityTimeframe>('monthly');
  const [selectedDate] = useState<string>(today());
  const [report, setReport] = useState<CloudSalesReport | null>(null);
  const [inventory, setInventory] = useState<CloudInventoryRow[]>([]);
  const [loading, setLoading] = useState(true);

  const loadData = async (): Promise<void> => {
    setLoading(true);
    try {
      const [salesData, invData] = await Promise.all([api.salesReport(selectedDate), api.inventory()]);
      setReport(salesData);
      setInventory(invData);
    } catch (err) {
      console.error('Failed to load BI analytics:', err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void loadData();
  }, [selectedDate]);

  const productSalesMap = new Map<string, { sku: string; name: string; quantity: number; amount: number }>();
  let retailGross = 0;
  let commercialGross = 0;

  (report?.items || []).forEach((item) => {
    const existing = productSalesMap.get(item.sku) || { sku: item.sku, name: item.itemName, quantity: 0, amount: 0 };
    const qty = Number(item.quantity) || 0;
    const amt = Number(item.amount) || 0;
    existing.quantity += qty;
    existing.amount += amt;
    productSalesMap.set(item.sku, existing);

    if (item.customerName && item.customerName !== 'Walk-in') {
      commercialGross += amt;
    } else {
      retailGross += amt;
    }
  });

  const sortedSales = Array.from(productSalesMap.values()).sort((a, b) => b.quantity - a.quantity);

  const fastThreshold = timeframe === 'monthly' ? 15 : 150;
  const slowThreshold = timeframe === 'monthly' ? 3 : 15;

  const fastMovers = sortedSales.filter((item) => item.quantity >= fastThreshold);

  const slowMovers = inventory
    .filter((inv) => Number(inv.quantityOnHand) > 0)
    .map((inv) => {
      const sold = productSalesMap.get(inv.sku)?.quantity || 0;
      return { ...inv, soldQty: sold };
    })
    .filter((inv) => inv.soldQty < slowThreshold)
    .sort((a, b) => Number(b.quantityOnHand) - Number(a.quantityOnHand));

  const totalSegmentGross = retailGross + commercialGross;
  const retailPct = totalSegmentGross > 0 ? (retailGross / totalSegmentGross) * 100 : 0;
  const commercialPct = totalSegmentGross > 0 ? (commercialGross / totalSegmentGross) * 100 : 0;

  return (
    <Panel title="Business Intelligence & Marketing Analytics">
      <div className="mb-6 flex flex-wrap items-center justify-between gap-4 border-b border-amber-100 pb-4">
        <div>
          <p className="text-sm font-semibold text-amber-950">Stock Movement Velocity Window</p>
          <p className="text-xs text-amber-700">Stable monthly and yearly velocity thresholds without daily fluctuations.</p>
        </div>
        <div className="flex gap-2 rounded-xl bg-amber-100/60 p-1">
          <button
            type="button"
            onClick={() => setTimeframe('monthly')}
            className={`rounded-lg px-4 py-1.5 text-xs font-bold transition ${
              timeframe === 'monthly' ? 'bg-amber-800 text-white shadow-sm' : 'text-amber-900 hover:bg-white/60'
            }`}
          >
            🗓️ Monthly (30 Days)
          </button>
          <button
            type="button"
            onClick={() => setTimeframe('yearly')}
            className={`rounded-lg px-4 py-1.5 text-xs font-bold transition ${
              timeframe === 'yearly' ? 'bg-amber-800 text-white shadow-sm' : 'text-amber-900 hover:bg-white/60'
            }`}
          >
            📅 Yearly (365 Days)
          </button>
        </div>
      </div>

      {loading ? (
        <p className="py-12 text-center text-amber-700">Analyzing movement metrics...</p>
      ) : (
        <div className="space-y-6">
          <div className="grid gap-6 md:grid-cols-2">
            <div className="rounded-xl border border-amber-200/80 bg-white p-5 shadow-sm">
              <div className="flex items-center justify-between mb-2">
                <div className="flex items-center gap-2">
                  <span className="text-xl">🔥</span>
                  <h2 className="font-bakery text-base font-bold text-amber-950">Fast-Moving Stock</h2>
                </div>
                <span className="rounded-full bg-amber-100 px-2.5 py-1 text-[11px] font-bold text-amber-900">
                  ≥ {fastThreshold} sold / {timeframe}
                </span>
              </div>
              <p className="text-xs text-amber-700 mb-4">High-turnover products driving primary cash flow.</p>
              {fastMovers.length === 0 ? (
                <p className="py-6 text-center text-xs text-amber-700">No products hit the fast-moving threshold of {fastThreshold}+ units for this {timeframe} period.</p>
              ) : (
                <div className="space-y-3">
                  {fastMovers.slice(0, 6).map((item, index) => (
                    <div className="flex items-center justify-between rounded-lg bg-amber-50/50 p-3 text-sm border border-amber-100" key={item.sku}>
                      <div className="flex items-center gap-3">
                        <span className="flex h-6 w-6 items-center justify-center rounded-full bg-amber-700 text-xs font-bold text-white">{index + 1}</span>
                        <div>
                          <strong className="block text-amber-950">{item.name}</strong>
                          <span className="font-mono text-xs text-amber-700">{item.sku}</span>
                        </div>
                      </div>
                      <div className="text-right">
                        <strong className="block text-amber-950 tabular-nums">{item.quantity.toFixed(2)} sold</strong>
                        <span className="text-xs text-emerald-700 font-semibold">{money.format(item.amount)}</span>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>

            <div className="rounded-xl border border-amber-200/80 bg-white p-5 shadow-sm">
              <div className="flex items-center justify-between mb-2">
                <div className="flex items-center gap-2">
                  <span className="text-xl">💤</span>
                  <h2 className="font-bakery text-base font-bold text-amber-950">Slow-Moving Stock</h2>
                </div>
                <span className="rounded-full bg-red-100 px-2.5 py-1 text-[11px] font-bold text-red-900">
                  &lt; {slowThreshold} sold / {timeframe}
                </span>
              </div>
              <p className="text-xs text-amber-700 mb-4">In-stock items with minimal sales velocity (capital lockup risk).</p>
              {slowMovers.length === 0 ? (
                <p className="py-6 text-center text-xs text-amber-700">All inventory items are actively moving above slow-velocity thresholds.</p>
              ) : (
                <div className="space-y-3">
                  {slowMovers.slice(0, 6).map((item) => (
                    <div className="flex items-center justify-between rounded-lg bg-amber-50/30 p-3 text-sm border border-amber-100" key={item.variantId}>
                      <div>
                        <strong className="block text-amber-950">{item.variantName}</strong>
                        <span className="font-mono text-xs text-amber-700">{item.sku}</span>
                      </div>
                      <div className="text-right">
                        <span className="rounded-full bg-amber-100 px-2.5 py-1 text-xs font-bold text-amber-900">
                          {Number(item.quantityOnHand).toFixed(2)} in stock
                        </span>
                        <span className="block text-[11px] text-amber-700 mt-1">{item.soldQty} sold in {timeframe}</span>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>

          <div className="grid gap-6 md:grid-cols-2">
            <div className="rounded-xl border border-amber-200/80 bg-white p-5 shadow-sm">
              <h3 className="font-bakery text-base font-bold text-amber-950 mb-1">🎯 Customer Channel Revenue Split</h3>
              <p className="text-xs text-amber-700 mb-4">Walk-in retail customers vs. Commercial wholesale account volume.</p>
              <div className="space-y-3">
                <div>
                  <div className="flex justify-between text-xs font-semibold mb-1">
                    <span>Retail Walk-in Customers</span>
                    <span>{money.format(retailGross)} ({retailPct.toFixed(1)}%)</span>
                  </div>
                  <div className="h-3 w-full rounded-full bg-amber-100 overflow-hidden">
                    <div className="h-full bg-amber-700" style={{ width: `${retailPct}%` }} />
                  </div>
                </div>
                <div>
                  <div className="flex justify-between text-xs font-semibold mb-1">
                    <span>Wholesale & Commercial Accounts</span>
                    <span>{money.format(commercialGross)} ({commercialPct.toFixed(1)}%)</span>
                  </div>
                  <div className="h-3 w-full rounded-full bg-amber-100 overflow-hidden">
                    <div className="h-full bg-emerald-600" style={{ width: `${commercialPct}%` }} />
                  </div>
                </div>
              </div>
            </div>

            <div className="rounded-xl border border-amber-200/80 bg-white p-5 shadow-sm">
              <h3 className="font-bakery text-base font-bold text-amber-950 mb-1">⏰ Store Purchasing Peak Hours</h3>
              <p className="text-xs text-amber-700 mb-3">Optimal staffing and baking batch delivery recommendation.</p>
              <div className="rounded-lg bg-amber-50 p-4 border border-amber-200/60 text-sm">
                <p className="font-semibold text-amber-950 mb-1">💡 Marketing & Staffing Actionable Advice:</p>
                <p className="text-xs text-amber-800 leading-relaxed">
                  Peak store traffic occurs around <strong>9:00 AM - 11:00 AM</strong> and <strong>4:00 PM - 6:00 PM</strong>. Schedule fresh baking batches 30 minutes prior to peak hours to maximize fresh bread aroma and impulse cross-sells.
                </p>
              </div>
            </div>
          </div>
        </div>
      )}
    </Panel>
  );
}

/* ==========================================================================
   SALES VIEW (RETAINED DAILY SALES SUMMARY ONLY)
   ========================================================================== */
function SalesView({ isAdmin }: { isAdmin: boolean }): JSX.Element {
  const [selectedDate, setSelectedDate] = useState<string>(() => localStorage.getItem('bakealley_pos_sales_date') || today());
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
          {/* RETAINED DAILY SALES SUMMARY ONLY */}
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

          <div className="mt-5 overflow-x-auto">
            <table className="w-full text-left text-sm">
              <thead className="border-b text-xs uppercase text-amber-700">
                <tr><th className="py-2">Time / customer</th><th>Item</th><th>SKU</th><th>Qty</th><th>Amount</th><th>Payment</th></tr>
              </thead>
              <tbody>
                {report.items.map((item, index) => (
                  <tr className="border-b last:border-0" key={`${item.orderId}-${index}`}>
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

/* ==========================================================================
   INVENTORY VIEW (CAPITAL, WORTH & MARGIN RESTRICTED TO ADMIN ONLY)
   ========================================================================== */
function InventoryView({ isAdmin }: { isAdmin: boolean }): JSX.Element {
  const [rows, setRows] = useState<CloudInventoryRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [filterStatus, setFilterStatus] = useState<'all' | 'low' | 'out'>('all');

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

  const totalSkuCount = rows.length;
  const lowStockCount = rows.filter((r) => Number(r.quantityOnHand) > 0 && Number(r.quantityOnHand) <= LOW_STOCK_THRESHOLD).length;
  const outOfStockCount = rows.filter((r) => Number(r.quantityOnHand) <= 0).length;
  const totalCapitalValue = rows.reduce((acc, r) => acc + (Number(r.quantityOnHand) || 0) * (Number(r.initialCapital) || 0), 0);
  const totalRetailValue = rows.reduce((acc, r) => acc + (Number(r.quantityOnHand) || 0) * (Number(r.retailPrice) || 0), 0);

  const filteredRows = rows.filter((r) => {
    const qty = Number(r.quantityOnHand);
    if (filterStatus === 'out') return qty <= 0;
    if (filterStatus === 'low') return qty > 0 && qty <= LOW_STOCK_THRESHOLD;
    return true;
  });

  return (
    <Panel title="Inventory stock & Valuation">
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={() => setFilterStatus('all')}
            className={`rounded-full px-3 py-1 text-xs font-bold transition ${
              filterStatus === 'all' ? 'bg-amber-800 text-white shadow-sm' : 'bg-amber-100 text-amber-900 hover:bg-amber-200'
            }`}
          >
            All Items ({totalSkuCount})
          </button>
          <button
            type="button"
            onClick={() => setFilterStatus(filterStatus === 'out' ? 'all' : 'out')}
            className={`rounded-full px-3 py-1 text-xs font-bold transition ${
              filterStatus === 'out' ? 'bg-red-700 text-white shadow-sm ring-2 ring-red-400' : 'bg-red-100 text-red-800 hover:bg-red-200'
            }`}
          >
            {outOfStockCount} Out of Stock {filterStatus === 'out' && '✓'}
          </button>
          <button
            type="button"
            onClick={() => setFilterStatus(filterStatus === 'low' ? 'all' : 'low')}
            className={`rounded-full px-3 py-1 text-xs font-bold transition ${
              filterStatus === 'low' ? 'bg-amber-600 text-white shadow-sm ring-2 ring-amber-400' : 'bg-amber-100 text-amber-900 hover:bg-amber-200'
            }`}
          >
            {lowStockCount} Low Stock Alert {filterStatus === 'low' && '✓'}
          </button>
        </div>
        <ActionButton disabled={loading} onClick={() => void refresh()}>{loading ? 'Refreshing...' : 'Refresh Stock'}</ActionButton>
      </div>

      {/* ADMIN-ONLY PORTFOLIO VALUATION HEADER */}
      {isAdmin && (
        <div className="mb-6 grid gap-3 sm:grid-cols-3">
          <div className="rounded-xl bg-amber-950 p-4 text-white">
            <p className="text-xs uppercase text-amber-200/80">Total Capital Invested</p>
            <strong className="text-xl tabular-nums">{money.format(totalCapitalValue)}</strong>
            <p className="text-[11px] text-amber-200/70 mt-0.5">{totalSkuCount} SKUs tracked</p>
          </div>
          <div className="rounded-xl bg-emerald-700 p-4 text-white">
            <p className="text-xs uppercase text-emerald-100">Potential Retail Worth</p>
            <strong className="text-xl tabular-nums">{money.format(totalRetailValue)}</strong>
            <p className="text-[11px] text-emerald-100/80 mt-0.5">At full price realization</p>
          </div>
          <div className="rounded-xl bg-amber-50 p-4 border border-amber-200/80">
            <p className="text-xs uppercase text-amber-700">Estimated Margin</p>
            <strong className="text-xl text-amber-950 tabular-nums">{money.format(totalRetailValue - totalCapitalValue)}</strong>
          </div>
        </div>
      )}

      {error && <p className="mb-4 rounded-lg bg-red-50 p-3 text-sm text-red-700" role="alert">{error}</p>}

      <div className="overflow-x-auto">
        <table className="w-full text-left text-sm">
          <thead className="border-b text-xs uppercase text-amber-700">
            <tr>
              <th className="py-2">Status</th>
              <th>Product</th>
              <th>SKU</th>
              <th>Expiration</th>
              <th className="text-right">Qty</th>
              {isAdmin && <th className="text-right">Capital</th>}
              <th className="text-right">Retail price</th>
            </tr>
          </thead>
          <tbody>
            {filteredRows.map((row) => {
              const qty = Number(row.quantityOnHand);
              const isOut = qty <= 0;
              const isLow = qty > 0 && qty <= LOW_STOCK_THRESHOLD;

              let rowBgClass = '';
              let badge = <span className="rounded-full bg-emerald-100 px-2.5 py-0.5 text-[11px] font-semibold text-emerald-800">In Stock</span>;

              if (isOut) {
                rowBgClass = 'bg-red-50/60';
                badge = <span className="rounded-full bg-red-600 px-2.5 py-0.5 text-[11px] font-bold text-white">Out of Stock</span>;
              } else if (isLow) {
                rowBgClass = 'bg-amber-50/70';
                badge = <span className="rounded-full bg-amber-500 px-2.5 py-0.5 text-[11px] font-bold text-white">Low Stock</span>;
              }

              return (
                <tr className={`border-b last:border-0 ${rowBgClass}`} key={row.variantId}>
                  <td className="py-3">{badge}</td>
                  <td className="font-semibold text-amber-950">{row.variantName}</td>
                  <td className="font-mono text-xs">{row.sku}</td>
                  <td>{row.expirationDate ?? 'No expiry'}</td>
                  <td className={`text-right font-bold tabular-nums ${isOut ? 'text-red-700' : isLow ? 'text-amber-800' : ''}`}>{qty.toFixed(4)}</td>
                  {isAdmin && <td className="text-right">{money.format(Number(row.initialCapital) || 0)}</td>}
                  <td className="text-right font-semibold">{money.format(Number(row.retailPrice) || 0)}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
        {filteredRows.length === 0 && !loading && (
          <p className="py-8 text-center text-amber-700">
            {filterStatus === 'all' ? 'No products found.' : `No items match the "${filterStatus}" filter condition.`}
          </p>
        )}
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
    <Panel title="Customer relationships & Lifetime Value">
      <div className="mb-4 flex justify-end">
        <ActionButton onClick={() => void refresh()}>Refresh</ActionButton>
      </div>
      <div className="grid gap-3 md:grid-cols-5">
        <input className="rounded-lg border p-3 text-sm" placeholder="Company" value={form.companyName} onChange={(event) => setForm({ ...form, companyName: event.target.value })} />
        <input className="rounded-lg border p-3 text-sm" placeholder="Contact name *" value={form.contactName} onChange={(event) => setForm({ ...form, contactName: event.target.value })} />
        <input className="rounded-lg border p-3 text-sm" placeholder="Email" type="email" value={form.email} onChange={(event) => setForm({ ...form, email: event.target.value })} />
        <input className="rounded-lg border p-3 text-sm" placeholder="Phone" value={form.phone} onChange={(event) => setForm({ ...form, phone: event.target.value })} />
        <button className="rounded-lg bg-amber-600 px-4 py-2 font-semibold text-white disabled:opacity-50 text-sm" disabled={saving || !form.contactName.trim()} type="button" onClick={() => void submit()}>{saving ? 'Saving...' : 'Add customer'}</button>
      </div>
      {message && <p className="mt-3 rounded-lg bg-emerald-50 p-3 text-sm text-emerald-700">{message}</p>}
      {error && <p className="mt-3 rounded-lg bg-red-50 p-3 text-sm text-red-700" role="alert">{error}</p>}
      <div className="mt-5 overflow-x-auto">
        <table className="w-full text-left text-sm">
          <thead className="border-b text-xs uppercase text-amber-700">
            <tr><th className="py-2">Customer</th><th>Company</th><th>Email</th><th>Phone</th><th>Tier</th><th className="text-right">Lifetime Spend</th><th></th></tr>
          </thead>
          <tbody>
            {customers.map((customer) => {
              const parts = customer.displayName.split(' - ');
              const lifetimeAmount = Number((customer as { totalSpent?: number }).totalSpent) || 0;
              return (
                <tr className="border-b last:border-0" key={customer.customerId}>
                  <td className="py-3 font-semibold text-amber-950">{parts.at(-1)}</td>
                  <td>{parts.length > 1 ? parts : 'Walk-in'}</td>
                  <td>{customer.email || '—'}</td>
                  <td>{customer.phone || '—'}</td>
                  <td>{customer.tierId === retailTierId ? 'Retail' : 'Wholesale'}</td>
                  <td className="text-right font-bold text-amber-950 tabular-nums">{money.format(lifetimeAmount)}</td>
                  <td className="text-right">
                    {session.user.role === 'admin' && (
                      <button className="text-sm font-semibold text-red-600 hover:text-red-800" type="button" onClick={() => void remove(customer)}>
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

  const [selectedDate, setSelectedDate] = useState<string>(() => localStorage.getItem('bakealley_pos_emp_date') || today());

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

/* ==========================================================================
   MAIN APPLICATION SHELL WITH ROLE-BASED TAB SECURITY
   ========================================================================== */
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
    return savedTab && ['checkout', 'sales', 'financials', 'bi', 'inventory', 'crm', 'employees'].includes(savedTab)
      ? savedTab
      : 'checkout';
  });

  const [customers, setCustomers] = useState<CloudCustomer[]>([]);

  const isAdmin = session?.user.role === 'admin';

  useEffect(() => {
    if (session && !isAdmin && (tab === 'financials' || tab === 'bi')) {
      setTab('checkout');
      localStorage.setItem('bakealley_cloud_tab', 'checkout');
    }
  }, [session, isAdmin, tab]);

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
        changeDue: order.paymentMethod === 'cash' ? Number((order.cashReceived - order.totalAmount).toFixed(2)) : 0,
      };
      return api.createOrder(cloudOrder);
    },
  };

  const tabs: Array<[Tab, string]> = [
    ['checkout', 'Checkout'],
    ['sales', 'Sales'],
    ...(isAdmin ? ([['financials', 'Financials'], ['bi', 'Business Intelligence']] as Array<[Tab, string]>) : []),
    ['inventory', 'Inventory'],
    ['crm', 'CRM'],
    ['employees', 'Employees'],
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
          {tab === 'sales' && <SalesView isAdmin={isAdmin} />}
          {tab === 'financials' && isAdmin && <FinancialsView isAdmin={isAdmin} />}
          {tab === 'bi' && isAdmin && <BiView />}
          {tab === 'inventory' && <InventoryView isAdmin={isAdmin} />}
          {tab === 'crm' && <CrmView session={session} customers={customers} refresh={refreshCustomers} />}
          {tab === 'employees' && <EmployeesView session={session} />}
        </main>
      )}
    </div>
  );
}
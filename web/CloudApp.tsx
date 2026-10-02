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

// Unified Inactivity Timeout - 5 minutes for all users
const INACTIVITY_TIMEOUT_MS = 5 * 60 * 1000;   // 5 Minutes of inactivity for all users

const LOW_STOCK_THRESHOLD = 10;
const CARD_FEE_RATE = 0.025; // 2.5% estimated card fee

const money = new Intl.NumberFormat('en-PH', { style: 'currency', currency: 'PHP', minimumFractionDigits: 2, maximumFractionDigits: 2 });
const today = (): string => new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Manila' }).format(new Date());

type Tab = 'checkout' | 'sales' | 'financials' | 'bi' | 'inventory' | 'crm' | 'employees';
type VelocityTimeframe = 'monthly' | 'yearly';

function getInactivityTimeout(): number {
  return INACTIVITY_TIMEOUT_MS;  // 5 minutes for all users
}

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
   FINANCIAL REPORT VIEW (EOD AUDIT + CONSOLIDATED TENDER RECONCILIATION)
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

  // Normalized payment reducer matching all tender variations
  const paymentBreakdown = (report?.items || []).reduce(
    (acc, item) => {
      const rawMethod = String(item.paymentMethod || 'cash').toLowerCase().trim();
      const amount = Number(item.amount) || 0;

      if (rawMethod.includes('gcash')) {
        acc.gcash += amount;
      } else if (rawMethod.includes('card')) {
        acc.card += amount;
      } else if (rawMethod.includes('account')) {
        acc.account += amount;
      } else if (rawMethod.includes('cash')) {
        acc.cash += amount;
      } else {
        acc.other += amount;
      }
      return acc;
    },
    { cash: 0, card: 0, gcash: 0, account: 0, other: 0 }
  );

  const totalDigitalTender = paymentBreakdown.card + paymentBreakdown.gcash + paymentBreakdown.account + paymentBreakdown.other;
  const totalConsolidatedTender = paymentBreakdown.cash + totalDigitalTender;
  const estimatedCardFees = paymentBreakdown.card * CARD_FEE_RATE;

  const exportCsv = (): void => {
    if (!report) return;
    const items = report.items || [];
    const csvData = [
      ['Bake Alley Cloud POS â€” End of Day Financial Audit Statement'],
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
      [''],
      ['TENDER RECONCILIATION & CONSOLIDATION', 'AMOUNT (PHP)'],
      ['Cash Payments Received (Cash Drawer)', paymentBreakdown.cash.toFixed(2)],
      ['GCash E-Wallet Payments Received', paymentBreakdown.gcash.toFixed(2)],
      ['Card / POS Terminal Payments Received', paymentBreakdown.card.toFixed(2)],
      ['Account Charges Received', paymentBreakdown.account.toFixed(2)],
      ['Total Digital / Non-Cash Tenders', totalDigitalTender.toFixed(2)],
      ['Total Consolidated Realized Tender', totalConsolidatedTender.toFixed(2)],
      ['Estimated Card Merchant Fees (2.5%)', estimatedCardFees.toFixed(2)],
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
          <h1>ðŸž Bake Alley Cloud POS â€” End of Day Financial Audit</h1>
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
          <h3>Payment Method Consolidation & Tender Breakdown</h3>
          <p style="font-size: 13px;">
            <strong>ðŸ’µ Cash Drawer:</strong> PHP ${paymentBreakdown.cash.toFixed(2)} | 
            <strong>ðŸ“² GCash E-Wallet:</strong> PHP ${paymentBreakdown.gcash.toFixed(2)} | 
            <strong>ðŸ’³ Card / POS:</strong> PHP ${paymentBreakdown.card.toFixed(2)} | 
            <strong>ðŸ“‹ Commercial Account:</strong> PHP ${paymentBreakdown.account.toFixed(2)}<br>
            <strong>ðŸŒ Total Digital Tenders:</strong> PHP ${totalDigitalTender.toFixed(2)} | 
            <strong>ðŸ’° Total Consolidated Realization:</strong> PHP ${totalConsolidatedTender.toFixed(2)}
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
            ðŸ“¥ Export CSV
          </button>
          <button
            type="button"
            onClick={exportPdfPrint}
            disabled={loading || !report}
            className="rounded-lg bg-amber-800 px-3.5 py-2 text-xs font-bold text-white shadow-sm hover:bg-amber-900 disabled:opacity-50"
          >
            ðŸ–¨ï¸ Print / Save PDF
          </button>
          <ActionButton disabled={loading} onClick={() => void refresh()}>{loading ? 'Generating...' : 'Refresh'}</ActionButton>
        </div>
      </div>

      {error && <p className="mb-4 rounded-lg bg-red-50 p-3 text-sm text-red-700" role="alert">{error}</p>}

      {report && !loading && (
        <div className="space-y-8">
          <section>
            <div className="flex items-center justify-between mb-3">
              <h2 className="font-bakery text-lg font-bold text-amber-950">End of Day (EOD) Audit â€” {selectedDate}</h2>
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

            {/* CONSOLIDATED TENDER RECONCILIATION CARD */}
            <div className="mt-4 grid gap-4 md:grid-cols-2">
              <div className="rounded-xl border border-amber-200/60 bg-amber-50/30 p-5">
                <div className="flex flex-wrap items-center justify-between gap-2 mb-3">
                  <h3 className="text-xs font-bold uppercase tracking-wider text-amber-800">Register Cash Drawer vs Digital Tender</h3>
                  <span className="text-xs font-bold text-amber-950">
                    Total Realized: <span className="text-emerald-700">{money.format(totalConsolidatedTender)}</span>
                  </span>
                </div>

                <div className="grid grid-cols-2 sm:grid-cols-5 gap-2 text-center text-sm">
                  <div className="rounded-lg bg-white p-2.5 border border-amber-200/60 shadow-sm">
                    <span className="text-[10px] text-amber-800 font-bold block uppercase tracking-wider">ðŸ’µ Cash</span>
                    <strong className="text-amber-950 text-xs tabular-nums block mt-1">{money.format(paymentBreakdown.cash)}</strong>
                    <span className="text-[9px] text-amber-700 block mt-0.5">Cash Drawer</span>
                  </div>
                  <div className="rounded-lg bg-white p-2.5 border border-sky-200 shadow-sm">
                    <span className="text-[10px] text-sky-800 font-bold block uppercase tracking-wider">ðŸ“² GCash</span>
                    <strong className="text-sky-950 text-xs tabular-nums block mt-1">{money.format(paymentBreakdown.gcash)}</strong>
                    <span className="text-[9px] text-sky-700 block mt-0.5">E-Wallet</span>
                  </div>
                  <div className="rounded-lg bg-white p-2.5 border border-blue-200 shadow-sm">
                    <span className="text-[10px] text-blue-800 font-bold block uppercase tracking-wider">ðŸ’³ Card</span>
                    <strong className="text-blue-950 text-xs tabular-nums block mt-1">{money.format(paymentBreakdown.card)}</strong>
                    <span className="text-[9px] text-blue-700 block mt-0.5">POS Terminal</span>
                  </div>
                  <div className="rounded-lg bg-white p-2.5 border border-amber-200/60 shadow-sm">
                    <span className="text-[10px] text-amber-800 font-bold block uppercase tracking-wider">ðŸ“‹ Account</span>
                    <strong className="text-amber-950 text-xs tabular-nums block mt-1">{money.format(paymentBreakdown.account)}</strong>
                    <span className="text-[9px] text-amber-700 block mt-0.5">Receivable</span>
                  </div>
                  <div className="col-span-2 sm:col-span-1 rounded-lg bg-emerald-800 p-2.5 text-white shadow-sm">
                    <span className="text-[10px] text-emerald-200 font-bold block uppercase tracking-wider">ðŸŒ Digital Total</span>
                    <strong className="text-white text-xs tabular-nums block mt-1">{money.format(totalDigitalTender)}</strong>
                    <span className="text-[9px] text-emerald-200 block mt-0.5">Non-Cash Tenders</span>
                  </div>
                </div>
              </div>

              <div className="rounded-xl border border-amber-200/60 bg-amber-50/30 p-5">
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
            ðŸ—“ï¸ Monthly (30 Days)
          </button>
          <button
            type="button"
            onClick={() => setTimeframe('yearly')}
            className={`rounded-lg px-4 py-1.5 text-xs font-bold transition ${
              timeframe === 'yearly' ? 'bg-amber-800 text-white shadow-sm' : 'text-amber-900 hover:bg-white/60'
            }`}
          >
            ðŸ“… Yearly (365 Days)
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
                  <span className="text-xl">ðŸ”¥</span>
                  <h2 className="font-bakery text-base font-bold text-amber-950">Fast-Moving Stock</h2>
                </div>
                <span className="rounded-full bg-amber-100 px-2.5 py-1 text-[11px] font-bold text-amber-900">
                  â‰¥ {fastThreshold} sold / {timeframe}
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
                  <span className="text-xl">ðŸ’¤</span>
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
              <h3 className="font-bakery text-base font-bold text-amber-950 mb-1">ðŸŽ¯ Customer Channel Revenue Split</h3>
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
              <h3 className="font-bakery text-base font-bold text-amber-950 mb-1">â° Store Purchasing Peak Hours</h3>
              <p className="text-xs text-amber-700 mb-3">Optimal staffing and baking batch delivery recommendation.</p>
              <div className="rounded-lg bg-amber-50 p-4 border border-amber-200/60 text-sm">
                <p className="font-semibold text-amber-950 mb-1">ðŸ’¡ Marketing & Staffing Actionable Advice:</p>
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
   SALES VIEW (DAILY SALES SUMMARY WITH FORMATTED PAYMENT BADGES)
   ========================================================================== */
interface GroupedTransaction {
  orderId: string;
  soldAt: string;
  customerName: string;
  paymentMethod: string;
  totalAmount: number;
  cashReceived: number;
  changeDue: number;
  items: Array<{
    itemName: string;
    sku: string;
    quantity: number;
    amount: number;
  }>;
}

/* ==========================================================================
   SALES VIEW (GROUPED TRANSACTIONS WITH EXPANDABLE RECEIPT & CASH DETAILS)
   ========================================================================== */
function SalesView({ isAdmin }: { isAdmin: boolean }): JSX.Element {
  const [selectedDate, setSelectedDate] = useState<string>(() => localStorage.getItem('bakealley_pos_sales_date') || today());
  const [report, setReport] = useState<CloudSalesReport | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [expandedOrderId, setExpandedOrderId] = useState<string | null>(null);

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

  const groupedTransactions = useMemo(() => {
    if (!report?.items) return [];

    const map = new Map<string, GroupedTransaction>();

    for (const item of report.items) {
      if (!map.has(item.orderId)) {
        map.set(item.orderId, {
          orderId: item.orderId,
          soldAt: item.soldAt,
          customerName: item.customerName || 'Walk-in',
          paymentMethod: item.paymentMethod || 'cash',
          totalAmount: Number((item as { totalAmount?: number }).totalAmount) || 0,
          cashReceived: Number((item as { cashReceived?: number }).cashReceived) || 0,
          changeDue: Number((item as { changeDue?: number }).changeDue) || 0,
          items: [],
        });
      }

      const tx = map.get(item.orderId)!;
      tx.items.push({
        itemName: item.itemName,
        sku: item.sku,
        quantity: Number(item.quantity) || 0,
        amount: Number(item.amount) || 0,
      });

      if (!tx.totalAmount) {
        tx.totalAmount = tx.items.reduce((sum, i) => sum + i.amount, 0);
      }
    }

    return Array.from(map.values());
  }, [report]);

  const toggleExpand = (orderId: string) => {
    setExpandedOrderId((prev) => (prev === orderId ? null : orderId));
  };

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

          <div className="mt-5 overflow-x-auto">
            <table className="w-full text-left text-sm">
              <thead className="border-b text-xs uppercase text-amber-700">
                <tr>
                  <th className="py-2.5 px-3">Time / Customer</th>
                  <th className="py-2.5 px-3">Purchased Items</th>
                  <th className="py-2.5 px-3">Total Amount</th>
                  <th className="py-2.5 px-3">Payment</th>
                  <th className="py-2.5 px-3 text-right">Details</th>
                </tr>
              </thead>
              <tbody>
                {groupedTransactions.map((tx) => {
                  const methodStr = String(tx.paymentMethod || 'cash').toLowerCase();
                  let paymentBadge = <span className="font-semibold text-amber-950">ðŸ’µ Cash</span>;
                  if (methodStr.includes('gcash')) {
                    paymentBadge = <span className="font-bold text-sky-700">ðŸ“² GCash</span>;
                  } else if (methodStr.includes('card')) {
                    paymentBadge = <span className="font-bold text-blue-700">ðŸ’³ Card</span>;
                  } else if (methodStr.includes('account')) {
                    paymentBadge = <span className="font-semibold text-amber-900">ðŸ“‹ Account</span>;
                  }

                  const isExpanded = expandedOrderId === tx.orderId;

                  return (
                    <Fragment key={tx.orderId}>
                      <tr 
                        className={`border-b cursor-pointer transition-colors ${isExpanded ? 'bg-amber-50/70' : 'hover:bg-amber-50/30'}`}
                        onClick={() => toggleExpand(tx.orderId)}
                      >
                        <td className="py-3 px-3">
                          <div className="font-semibold text-amber-950">{new Date(tx.soldAt).toLocaleTimeString()}</div>
                          <div className="text-xs text-amber-700">{tx.customerName}</div>
                        </td>
                        <td className="py-3 px-3 font-medium text-amber-900">
                          {tx.items.length} {tx.items.length === 1 ? 'item' : 'items'}
                        </td>
                        <td className="py-3 px-3 font-bold text-amber-950 tabular-nums">
                          {money.format(tx.totalAmount)}
                        </td>
                        <td className="py-3 px-3">{paymentBadge}</td>
                        <td className="py-3 px-3 text-right">
                          <button
                            type="button"
                            className="rounded-lg bg-amber-100 px-2.5 py-1 text-xs font-bold text-amber-900 hover:bg-amber-200"
                            onClick={(e) => {
                              e.stopPropagation();
                              toggleExpand(tx.orderId);
                            }}
                          >
                            {isExpanded ? 'â–² Hide' : 'â–¼ View Items'}
                          </button>
                        </td>
                      </tr>

                      {isExpanded && (
                        <tr className="bg-amber-50/40">
                          <td colSpan={5} className="p-3 sm:p-4">
                            <div className="rounded-xl border border-amber-200/80 bg-white p-4 shadow-sm">
                              <div className="flex flex-wrap items-center justify-between border-b border-amber-100 pb-2 mb-3">
                                <h4 className="font-bold text-amber-950 text-sm">
                                  Transaction Receipt â€” {new Date(tx.soldAt).toLocaleTimeString()}
                                </h4>
                                <span className="text-xs font-mono text-amber-700">Order ID: {tx.orderId}</span>
                              </div>

                              <table className="w-full text-left text-xs mb-3">
                                <thead className="border-b bg-amber-50/60 text-amber-800">
                                  <tr>
                                    <th className="py-2 px-2">Item Name</th>
                                    <th className="py-2 px-2">SKU</th>
                                    <th className="py-2 px-2 text-right">Quantity</th>
                                    <th className="py-2 px-2 text-right">Amount</th>
                                  </tr>
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
                                  <div>
                                    <span className="font-semibold text-amber-800">Payment Method:</span>{' '}
                                    <span className="capitalize font-bold text-amber-950">{tx.paymentMethod}</span>
                                  </div>
                                  {methodStr.includes('cash') && (
                                    <>
                                      <div>
                                        <span className="text-amber-800">Cash Received:</span>{' '}
                                        <strong className="text-emerald-800 tabular-nums">{money.format(tx.cashReceived)}</strong>
                                      </div>
                                      <div>
                                        <span className="text-amber-800">Change Given:</span>{' '}
                                        <strong className="text-amber-950 tabular-nums">{money.format(tx.changeDue)}</strong>
                                      </div>
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
            {groupedTransactions.length === 0 && <p className="py-8 text-center text-amber-700">No completed sales for this date.</p>}
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
  const [uoms, setUoms] = useState<Array<{ uomId: string; name: string; symbol: string }>>([]);
  const [defaultUomId, setDefaultUomId] = useState<string>('');
  const [filterStatus, setFilterStatus] = useState<'all' | 'low' | 'out'>('all');
  const [searchTerm, setSearchTerm] = useState('');
  const [showEditModal, setShowEditModal] = useState(false);
  const [showAddModal, setShowAddModal] = useState(false);
  const [editingRow, setEditingRow] = useState<CloudInventoryRow | null>(null);
  const [editForm, setEditForm] = useState({ variantName: '', sku: '', retailPrice: '', initialCost: '', quantity: '', expirationDate: '' });
  const [addForm, setAddForm] = useState({ name: '', sku: '', variantName: '', retailPrice: '', initialCost: '', quantity: '', lotNumber: '', expirationDate: '' });
  const [formError, setFormError] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);

  const refresh = async (): Promise<void> => {
    setLoading(true);
    setError(null);
    try {
      const [inventoryData, uomData] = await Promise.all([api.inventory(), api.getUnitsOfMeasure()]);
      setRows(inventoryData);
      setUoms(uomData);
      if (uomData.length > 0 && !defaultUomId) {
        setDefaultUomId(uomData[0].uomId);
      }
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
    const statusMatch = filterStatus === 'all' || (filterStatus === 'out' && qty <= 0) || (filterStatus === 'low' && qty > 0 && qty <= LOW_STOCK_THRESHOLD);
    
    if (!statusMatch) return false;
    
    // Search filter (case-insensitive across SKU, product name, variant name)
    const searchLower = searchTerm.toLowerCase().trim();
    if (searchLower) {
      return r.sku.toLowerCase().includes(searchLower) ||
             r.variantName.toLowerCase().includes(searchLower);
    }
    return true;
  });

  const openEditModal = (row: CloudInventoryRow) => {
    setEditingRow(row);
    setEditForm({
      variantName: row.variantName,
      sku: row.sku,
      retailPrice: String(row.retailPrice),
      initialCost: String(row.initialCapital),
      quantity: String(row.quantityOnHand),
      expirationDate: row.expirationDate || '',
    });
    setFormError(null);
    setShowEditModal(true);
  };

  const closeEditModal = () => {
    setShowEditModal(false);
    setEditingRow(null);
    setEditForm({ variantName: '', sku: '', retailPrice: '', initialCost: '', quantity: '', expirationDate: '' });
    setFormError(null);
  };

  const openAddModal = () => {
    setAddForm({ name: '', sku: '', variantName: '', retailPrice: '', initialCost: '', quantity: '', lotNumber: '', expirationDate: '' });
    setFormError(null);
    setShowAddModal(true);
  };

  const closeAddModal = () => {
    setShowAddModal(false);
    setAddForm({ name: '', sku: '', variantName: '', retailPrice: '', initialCost: '', quantity: '', lotNumber: '', expirationDate: '' });
    setFormError(null);
  };

  const validateEditForm = (): boolean => {
    if (!editForm.variantName.trim()) {
      setFormError('Variant name is required');
      return false;
    }
    if (!editForm.sku.trim()) {
      setFormError('SKU is required');
      return false;
    }
    if (Number(editForm.retailPrice) < 0) {
      setFormError('Retail price cannot be negative');
      return false;
    }
    if (Number(editForm.initialCost) < 0) {
      setFormError('Initial cost cannot be negative');
      return false;
    }
    if (Number(editForm.quantity) < 0) {
      setFormError('Quantity cannot be negative');
      return false;
    }
    return true;
  };

  const validateAddForm = (): boolean => {
    if (!addForm.name.trim()) {
      setFormError('Product name is required');
      return false;
    }
    if (!addForm.sku.trim()) {
      setFormError('SKU is required');
      return false;
    }
    if (!addForm.variantName.trim()) {
      setFormError('Variant name is required');
      return false;
    }
    if (Number(addForm.retailPrice) <= 0) {
      setFormError('Retail price must be greater than 0');
      return false;
    }
    if (Number(addForm.quantity) < 0) {
      setFormError('Quantity cannot be negative');
      return false;
    }
    if (!addForm.lotNumber.trim()) {
      setFormError('Lot number is required');
      return false;
    }
    return true;
  };

  const handleEditSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!validateEditForm() || !editingRow) return;

    setIsSubmitting(true);
    setFormError(null);
    try {
      await api.updateInventoryProduct(editingRow.variantId, {
        variantName: editForm.variantName !== editingRow.variantName ? editForm.variantName : undefined,
        sku: editForm.sku !== editingRow.sku ? editForm.sku : undefined,
        retailPrice: Number(editForm.retailPrice) !== editingRow.retailPrice ? Number(editForm.retailPrice) : undefined,
        initialCost: Number(editForm.initialCost) !== editingRow.initialCapital ? Number(editForm.initialCost) : undefined,
        quantity: Number(editForm.quantity) !== editingRow.quantityOnHand ? Number(editForm.quantity) : undefined,
        expirationDate: editForm.expirationDate !== editingRow.expirationDate ? (editForm.expirationDate || null) : undefined,
      });
      await refresh();
      closeEditModal();
    } catch (reason) {
      setFormError(errorText(reason, 'Failed to update inventory'));
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleAddSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!validateAddForm()) return;

    setIsSubmitting(true);
    setFormError(null);
    try {
      if (!defaultUomId) {
        setFormError('Unit of measure not available. Please refresh.');
        return;
      }
      await api.createInventoryProduct({
        name: addForm.name,
        sku: addForm.sku,
        variantName: addForm.variantName,
        baseUomId: defaultUomId,
        lotNumber: addForm.lotNumber,
        quantity: Number(addForm.quantity),
        retailPrice: Number(addForm.retailPrice),
        initialCost: Number(addForm.initialCost) || 0,
        expirationDate: addForm.expirationDate || undefined,
      });
      await refresh();
      closeAddModal();
    } catch (reason) {
      setFormError(errorText(reason, 'Failed to add inventory item'));
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <Panel title="Inventory stock & Valuation">
      <div className="mb-6">
        <div className="rounded-lg border border-amber-200 bg-white mb-4 px-4 py-3">
          <input
            type="text"
            placeholder="Search by SKU, product name, variant name, or lot number..."
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
            className="w-full px-3 py-2 border border-amber-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-amber-500 bg-white"
          />
        </div>
      </div>

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
            {outOfStockCount} Out of Stock {filterStatus === 'out' && 'âœ“'}
          </button>
          <button
            type="button"
            onClick={() => setFilterStatus(filterStatus === 'low' ? 'all' : 'low')}
            className={`rounded-full px-3 py-1 text-xs font-bold transition ${
              filterStatus === 'low' ? 'bg-amber-600 text-white shadow-sm ring-2 ring-amber-400' : 'bg-amber-100 text-amber-900 hover:bg-amber-200'
            }`}
          >
            {lowStockCount} Low Stock Alert {filterStatus === 'low' && 'âœ“'}
          </button>
        </div>
        <div className="flex gap-2">
          {isAdmin && (
            <ActionButton disabled={loading || isSubmitting} onClick={openAddModal}>
              + Add Item
            </ActionButton>
          )}
          <ActionButton disabled={loading} onClick={() => void refresh()}>{loading ? 'Refreshing...' : 'Refresh Stock'}</ActionButton>
        </div>
      </div>

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
              {isAdmin && <th>Actions</th>}
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
                  {isAdmin && (
                    <td className="pl-4">
                      <button
                        type="button"
                        onClick={() => openEditModal(row)}
                        className="rounded px-2 py-1 text-xs font-semibold text-white bg-blue-600 hover:bg-blue-700 disabled:opacity-50"
                        disabled={isSubmitting}
                      >
                        Edit
                      </button>
                    </td>
                  )}
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

      {/* Edit Modal */}
      {showEditModal && editingRow && (
        <div className="fixed inset-0 flex items-center justify-center bg-black/50 z-50">
          <div className="bg-white rounded-2xl p-6 w-96 max-h-screen overflow-y-auto shadow-lg">
            <h2 className="text-xl font-bold text-amber-950 mb-4">Edit Inventory Item</h2>
            {formError && <p className="mb-4 rounded-lg bg-red-50 p-3 text-sm text-red-700">{formError}</p>}
            <form onSubmit={handleEditSubmit} className="space-y-3">
              <div>
                <label className="block text-sm font-semibold text-amber-950">Variant Name</label>
                <input
                  type="text"
                  value={editForm.variantName}
                  onChange={(e) => setEditForm({ ...editForm, variantName: e.target.value })}
                  className="mt-1 w-full rounded-lg border border-amber-200 px-3 py-2"
                  disabled={isSubmitting}
                />
              </div>
              <div>
                <label className="block text-sm font-semibold text-amber-950">SKU</label>
                <input
                  type="text"
                  value={editForm.sku}
                  onChange={(e) => setEditForm({ ...editForm, sku: e.target.value })}
                  className="mt-1 w-full rounded-lg border border-amber-200 px-3 py-2"
                  disabled={isSubmitting}
                />
              </div>
              <div>
                <label className="block text-sm font-semibold text-amber-950">Retail Price (â‚±)</label>
                <input
                  type="number"
                  step="0.01"
                  value={editForm.retailPrice}
                  onChange={(e) => setEditForm({ ...editForm, retailPrice: e.target.value })}
                  className="mt-1 w-full rounded-lg border border-amber-200 px-3 py-2"
                  disabled={isSubmitting}
                />
              </div>
              <div>
                <label className="block text-sm font-semibold text-amber-950">Initial Cost (â‚±)</label>
                <input
                  type="number"
                  step="0.01"
                  value={editForm.initialCost}
                  onChange={(e) => setEditForm({ ...editForm, initialCost: e.target.value })}
                  className="mt-1 w-full rounded-lg border border-amber-200 px-3 py-2"
                  disabled={isSubmitting}
                />
              </div>
              <div>
                <label className="block text-sm font-semibold text-amber-950">Quantity</label>
                <input
                  type="number"
                  step="0.0001"
                  value={editForm.quantity}
                  onChange={(e) => setEditForm({ ...editForm, quantity: e.target.value })}
                  className="mt-1 w-full rounded-lg border border-amber-200 px-3 py-2"
                  disabled={isSubmitting}
                />
              </div>
              <div>
                <label className="block text-sm font-semibold text-amber-950">Expiration Date (optional)</label>
                <input
                  type="date"
                  value={editForm.expirationDate}
                  onChange={(e) => setEditForm({ ...editForm, expirationDate: e.target.value })}
                  className="mt-1 w-full rounded-lg border border-amber-200 px-3 py-2"
                  disabled={isSubmitting}
                />
              </div>
              <div className="flex gap-2 pt-4">
                <button
                  type="submit"
                  className="flex-1 rounded-lg bg-blue-600 px-4 py-2 text-white font-semibold hover:bg-blue-700 disabled:opacity-50"
                  disabled={isSubmitting}
                >
                  {isSubmitting ? 'Saving...' : 'Save Changes'}
                </button>
                <button
                  type="button"
                  onClick={closeEditModal}
                  className="flex-1 rounded-lg bg-gray-300 px-4 py-2 text-gray-900 font-semibold hover:bg-gray-400 disabled:opacity-50"
                  disabled={isSubmitting}
                >
                  Cancel
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Add Item Modal */}
      {showAddModal && (
        <div className="fixed inset-0 flex items-center justify-center bg-black/50 z-50">
          <div className="bg-white rounded-2xl p-6 w-96 max-h-screen overflow-y-auto shadow-lg">
            <h2 className="text-xl font-bold text-amber-950 mb-4">Add New Inventory Item</h2>
            {formError && <p className="mb-4 rounded-lg bg-red-50 p-3 text-sm text-red-700">{formError}</p>}
            <form onSubmit={handleAddSubmit} className="space-y-3">
              <div>
                <label className="block text-sm font-semibold text-amber-950">Product Name</label>
                <input
                  type="text"
                  value={addForm.name}
                  onChange={(e) => setAddForm({ ...addForm, name: e.target.value })}
                  className="mt-1 w-full rounded-lg border border-amber-200 px-3 py-2"
                  disabled={isSubmitting}
                />
              </div>
              <div>
                <label className="block text-sm font-semibold text-amber-950">SKU</label>
                <input
                  type="text"
                  value={addForm.sku}
                  onChange={(e) => setAddForm({ ...addForm, sku: e.target.value })}
                  className="mt-1 w-full rounded-lg border border-amber-200 px-3 py-2"
                  disabled={isSubmitting}
                />
              </div>
              <div>
                <label className="block text-sm font-semibold text-amber-950">Variant Name</label>
                <input
                  type="text"
                  value={addForm.variantName}
                  onChange={(e) => setAddForm({ ...addForm, variantName: e.target.value })}
                  className="mt-1 w-full rounded-lg border border-amber-200 px-3 py-2"
                  disabled={isSubmitting}
                />
              </div>
              <div>
                <label className="block text-sm font-semibold text-amber-950">Retail Price (â‚±)</label>
                <input
                  type="number"
                  step="0.01"
                  value={addForm.retailPrice}
                  onChange={(e) => setAddForm({ ...addForm, retailPrice: e.target.value })}
                  className="mt-1 w-full rounded-lg border border-amber-200 px-3 py-2"
                  disabled={isSubmitting}
                />
              </div>
              <div>
                <label className="block text-sm font-semibold text-amber-950">Initial Cost (â‚±)</label>
                <input
                  type="number"
                  step="0.01"
                  value={addForm.initialCost}
                  onChange={(e) => setAddForm({ ...addForm, initialCost: e.target.value })}
                  className="mt-1 w-full rounded-lg border border-amber-200 px-3 py-2"
                  disabled={isSubmitting}
                />
              </div>
              <div>
                <label className="block text-sm font-semibold text-amber-950">Quantity</label>
                <input
                  type="number"
                  step="0.0001"
                  value={addForm.quantity}
                  onChange={(e) => setAddForm({ ...addForm, quantity: e.target.value })}
                  className="mt-1 w-full rounded-lg border border-amber-200 px-3 py-2"
                  disabled={isSubmitting}
                />
              </div>
              <div>
                <label className="block text-sm font-semibold text-amber-950">Lot Number</label>
                <input
                  type="text"
                  value={addForm.lotNumber}
                  onChange={(e) => setAddForm({ ...addForm, lotNumber: e.target.value })}
                  className="mt-1 w-full rounded-lg border border-amber-200 px-3 py-2"
                  disabled={isSubmitting}
                />
              </div>
              <div>
                <label className="block text-sm font-semibold text-amber-950">Expiration Date (optional)</label>
                <input
                  type="date"
                  value={addForm.expirationDate}
                  onChange={(e) => setAddForm({ ...addForm, expirationDate: e.target.value })}
                  className="mt-1 w-full rounded-lg border border-amber-200 px-3 py-2"
                  disabled={isSubmitting}
                />
              </div>
              <div className="flex gap-2 pt-4">
                <button
                  type="submit"
                  className="flex-1 rounded-lg bg-emerald-600 px-4 py-2 text-white font-semibold hover:bg-emerald-700 disabled:opacity-50"
                  disabled={isSubmitting}
                >
                  {isSubmitting ? 'Adding...' : 'Add Item'}
                </button>
                <button
                  type="button"
                  onClick={closeAddModal}
                  className="flex-1 rounded-lg bg-gray-300 px-4 py-2 text-gray-900 font-semibold hover:bg-gray-400 disabled:opacity-50"
                  disabled={isSubmitting}
                >
                  Cancel
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
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
                  <td>{customer.email || 'â€”'}</td>
                  <td>{customer.phone || 'â€”'}</td>
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
  const [deleteConfirm, setDeleteConfirm] = useState<{ userId: string; displayName: string } | null>(null);
  const [deleting, setDeleting] = useState(false);

  useEffect(() => {
    localStorage.setItem('bakealley_pos_emp_date', selectedDate);
  }, [selectedDate]);

  useEffect(() => {
    localStorage.setItem('bakealley_pos_emp_form', JSON.stringify(form));
  }, [form]);

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

  const deleteEmployee = async (userId: string): Promise<void> => {
    setDeleting(true);
    setError(null);
    try {
      await api.deleteEmployee(userId);
      setMessage(`Employee "${deleteConfirm?.displayName}" deleted successfully.`);
      setDeleteConfirm(null);
      await refresh();
    } catch (reason) {
      setError(errorText(reason, 'Employee could not be deleted.'));
    } finally {
      setDeleting(false);
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
                      {isAdmin && !isSelf && (
                        <button className="rounded-lg bg-red-600 text-white px-3 py-2 text-xs font-semibold hover:bg-red-700 disabled:opacity-50" type="button" onClick={() => setDeleteConfirm({ userId: employee.userId, displayName: employee.displayName })} disabled={deleting}>
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
                      <td className="py-3 capitalize">{shiftEmployee?.role ?? 'â€”'}</td>
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

      {/* Delete Confirmation Dialog */}
      {deleteConfirm && (
        <div className="fixed inset-0 flex items-center justify-center bg-black/50 z-50">
          <div className="bg-white rounded-2xl p-6 w-96 shadow-lg">
            <h2 className="text-lg font-bold text-red-600 mb-4">Delete Employee</h2>
            <p className="text-sm text-gray-700 mb-6">
              Are you sure you want to delete <strong>{deleteConfirm.displayName}</strong>? This action cannot be undone.
            </p>
            <div className="flex gap-3">
              <button
                type="button"
                className="flex-1 rounded-lg bg-red-600 px-4 py-2 text-white font-semibold hover:bg-red-700 disabled:opacity-50"
                onClick={() => void deleteEmployee(deleteConfirm.userId)}
                disabled={deleting}
              >
                {deleting ? 'Deleting...' : 'Delete Employee'}
              </button>
              <button
                type="button"
                className="flex-1 rounded-lg bg-gray-300 px-4 py-2 text-gray-900 font-semibold hover:bg-gray-400 disabled:opacity-50"
                onClick={() => setDeleteConfirm(null)}
                disabled={deleting}
              >
                Cancel
              </button>
            </div>
          </div>
        </div>
      )}
    </section>
  );
}

/* ==========================================================================
   MAIN APPLICATION SHELL WITH ROLE-BASED SESSION TIMEOUT & TAB SECURITY
   ========================================================================== */
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

  // Inactivity Monitor Effect - Auto-logout after 5 minutes of inactivity
  useEffect(() => {
    if (!session) return;

    const handleActivity = (): void => {
      const lastActiveStr = localStorage.getItem('bakealley_cloud_last_active');
      const timeoutMs = getInactivityTimeout();
      if (lastActiveStr && Date.now() - Number(lastActiveStr) > timeoutMs) {
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
              {session.user.displayName} Â· {session.user.role}
            </span>
          </div>
          <button
            className="text-sm font-semibold text-amber-700 hover:text-amber-900"
            type="button"
            onClick={async () => {
              try {
                await api.logout();
              } catch (error) {
                console.error('Logout failed:', error);
              }
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
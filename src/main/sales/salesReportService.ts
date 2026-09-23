import Database from 'better-sqlite3';
import type { AuthService } from '../auth/authService';

export interface SalesItemSummary {
    orderId: string;
    soldAt: string;
    customerName: string;
    sku: string;
    itemName: string;
    quantity: number;
    amount: number;
    paymentMethod: 'cash' | 'card' | 'account';
}

export interface SalesPeriodSummary {
    startDate: string;
    endDate: string;
    grossTotal: number;
    netTotal: number;
    orderCount: number;
}

export interface SalesReport {
    selectedDate: string;
    markupPercent: number;
    items: SalesItemSummary[];
    dayGrossTotal: number;
    dayNetTotal: number;
    dayOrderCount: number;
    week: SalesPeriodSummary;
    month: SalesPeriodSummary;
    year: SalesPeriodSummary;
}

interface Period {
    startDate: string;
    endDate: string;
}

const roundMoney = (value: number): number => Number(value.toFixed(2));
const roundQuantity = (value: number): number => Number(value.toFixed(4));

export class SalesReportService {
    private readonly database: Database.Database;
    private readonly auth: AuthService;

    public constructor(database: Database.Database, auth: AuthService) {
        this.database = database;
        this.auth = auth;
    }

    public getReport(token: string, selectedDate: string, requestedMarkupPercent: number): SalesReport {
        const user = this.auth.requireUser(token);
        const date = this.validateDate(selectedDate);
        const markupPercent = user.role === 'admin' ? this.validateMarkup(requestedMarkupPercent) : 0;
        const periods = this.periodsFor(date);
        const bounds = this.localDayBounds(date);
        const items = this.database.prepare(`
                        SELECT order_record.order_id AS orderId,
                                     order_record.created_at AS soldAt,
                                     COALESCE(customer.company_name || ' - ', '') || COALESCE(customer.contact_name, 'Walk-in') AS customerName,
                                     variant.sku AS sku,
                   variant.variant_name AS itemName,
                                     item.quantity AS quantity,
                                     item.total_price AS amount,
                   order_record.payment_method AS paymentMethod
            FROM order_items AS item
            JOIN orders AS order_record ON order_record.order_id = item.order_id
            JOIN product_variants AS variant ON variant.variant_id = item.variant_id
                        LEFT JOIN customers AS customer ON customer.customer_id = order_record.customer_id
            WHERE order_record.status = 'completed'
              AND order_record.created_at >= ?
              AND order_record.created_at < ?
                        ORDER BY order_record.created_at ASC, order_record.order_id ASC, item.order_item_id ASC
        `).all(bounds.start, bounds.end).map((row) => {
                        const item = row as { orderId: string; soldAt: string; customerName: string; sku: string; itemName: string; quantity: number; amount: number; paymentMethod: 'cash' | 'card' | 'account' };
            return {
                                orderId: item.orderId,
                                soldAt: item.soldAt,
                                customerName: item.customerName,
                sku: item.sku,
                itemName: item.itemName,
                quantity: roundQuantity(item.quantity),
                amount: roundMoney(item.amount),
                paymentMethod: item.paymentMethod,
            };
        });
        const day = this.aggregate(date, this.nextDate(date), markupPercent);

        return {
            selectedDate: date,
            markupPercent,
            items,
            dayGrossTotal: day.grossTotal,
            dayNetTotal: day.netTotal,
            dayOrderCount: day.orderCount,
            week: this.aggregatePeriod(periods.week, markupPercent),
            month: this.aggregatePeriod(periods.month, markupPercent),
            year: this.aggregatePeriod(periods.year, markupPercent),
        };
    }

    private aggregatePeriod(period: Period, markupPercent: number): SalesPeriodSummary {
        const aggregate = this.aggregate(period.startDate, period.endDate, markupPercent);
        return { ...period, ...aggregate };
    }

    private aggregate(startDate: string, endDate: string, markupPercent: number): Omit<SalesPeriodSummary, 'startDate' | 'endDate'> {
        const startBounds = this.localDayBounds(startDate).start;
        const endBounds = this.localDayBounds(endDate).start;
        const row = this.database.prepare(`
            SELECT COALESCE(SUM(total_amount), 0) AS grossTotal,
                   COUNT(order_id) AS orderCount
            FROM orders
            WHERE status = 'completed'
              AND created_at >= ?
              AND created_at < ?
        `).get(startBounds, endBounds) as { grossTotal: number; orderCount: number };
        const grossTotal = roundMoney(row.grossTotal);
        const netTotal = roundMoney(grossTotal / (1 + markupPercent / 100));
        return { grossTotal, netTotal, orderCount: row.orderCount };
    }

    private periodsFor(date: string): { week: Period; month: Period; year: Period } {
        const selected = new Date(`${date}T00:00:00Z`);
        const dayOfWeek = selected.getUTCDay();
        const daysFromMonday = dayOfWeek === 0 ? 6 : dayOfWeek - 1;
        const weekStart = new Date(selected);
        weekStart.setUTCDate(selected.getUTCDate() - daysFromMonday);
        const monthStart = new Date(Date.UTC(selected.getUTCFullYear(), selected.getUTCMonth(), 1));
        const yearStart = new Date(Date.UTC(selected.getUTCFullYear(), 0, 1));
        return {
            week: { startDate: this.formatDate(weekStart), endDate: this.formatDate(new Date(weekStart.getTime() + 7 * 86_400_000)) },
            month: { startDate: this.formatDate(monthStart), endDate: this.formatDate(new Date(Date.UTC(selected.getUTCFullYear(), selected.getUTCMonth() + 1, 1))) },
            year: { startDate: this.formatDate(yearStart), endDate: this.formatDate(new Date(Date.UTC(selected.getUTCFullYear() + 1, 0, 1))) },
        };
    }

    private nextDate(date: string): string {
        const next = new Date(`${date}T00:00:00Z`);
        next.setUTCDate(next.getUTCDate() + 1);
        return this.formatDate(next);
    }

    private localDayBounds(date: string): { start: string; end: string } {
        const [year, month, day] = date.split('-').map(Number);
        const start = new Date(year, month - 1, day);
        const end = new Date(year, month - 1, day + 1);
        return { start: start.toISOString(), end: end.toISOString() };
    }

    private formatDate(date: Date): string {
        return date.toISOString().slice(0, 10);
    }

    private validateDate(value: string): string {
        if (!/^\d{4}-\d{2}-\d{2}$/.test(value) || Number.isNaN(new Date(`${value}T00:00:00Z`).getTime())) {
            throw new Error('Date must use YYYY-MM-DD format');
        }
        return value;
    }

    private validateMarkup(value: number): number {
        if (!Number.isFinite(value) || value < 0 || value > 1_000_000) {
            throw new Error('Markup must be a non-negative percentage');
        }
        return Number(value.toFixed(4));
    }
}

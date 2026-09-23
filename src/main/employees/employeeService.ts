import { randomUUID } from 'node:crypto';
import Database from 'better-sqlite3';
import type { AuthService } from '../auth/authService';

export interface EmployeeSummary {
    userId: string;
    username: string;
    displayName: string;
    role: 'admin' | 'cashier';
    active: boolean;
    openShiftStart: string | null;
    salesCount: number;
    salesTotal: number;
}

export class EmployeeService {
    public constructor(private readonly database: Database.Database, private readonly auth: AuthService) {}

    public listEmployees(token: string): EmployeeSummary[] {
        this.auth.requireAdmin(token);
        return this.database.prepare(`
            SELECT u.user_id AS userId, u.username, u.display_name AS displayName, u.role,
                   u.active = 1 AS active,
                   MAX(CASE WHEN s.clock_out IS NULL THEN s.clock_in END) AS openShiftStart,
                   COUNT(es.employee_sale_id) AS salesCount,
                   COALESCE(SUM(o.total_amount), 0) AS salesTotal
            FROM users u
            LEFT JOIN employee_shifts s ON s.user_id = u.user_id
            LEFT JOIN employee_sales es ON es.user_id = u.user_id
            LEFT JOIN orders o ON o.order_id = es.order_id AND o.status = 'completed'
            GROUP BY u.user_id, u.username, u.display_name, u.role, u.active
            ORDER BY u.display_name ASC
        `).all() as EmployeeSummary[];
    }

    public clockIn(token: string): void {
        const user = this.auth.requireUser(token);
        const existing = this.database.prepare('SELECT 1 FROM employee_shifts WHERE user_id = ? AND clock_out IS NULL').get(user.userId);
        if (!existing) this.database.prepare('INSERT INTO employee_shifts (shift_id, user_id, clock_in) VALUES (?, ?, ?)').run(randomUUID(), user.userId, new Date().toISOString());
    }

    public clockOut(token: string): void {
        const user = this.auth.requireUser(token);
        this.database.prepare('UPDATE employee_shifts SET clock_out = ? WHERE user_id = ? AND clock_out IS NULL').run(new Date().toISOString(), user.userId);
    }

    public recordSale(token: string, orderId: string): void {
        const user = this.auth.requireUser(token);
        this.database.prepare('INSERT OR IGNORE INTO employee_sales (employee_sale_id, user_id, order_id, created_at) VALUES (?, ?, ?, ?)').run(randomUUID(), user.userId, orderId, new Date().toISOString());
    }
}

import { randomBytes, randomUUID, scryptSync } from 'node:crypto';
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

export interface ShiftSummary {
    userId: string;
    displayName: string;
    role: 'admin' | 'cashier';
    clockIn: string;
    clockOut: string | null;
}

export interface CreateEmployeeInput {
    username: string;
    displayName: string;
    role: 'admin' | 'cashier';
    password: string;
}

export class EmployeeService {
    public constructor(private readonly database: Database.Database, private readonly auth: AuthService) {}

    public listEmployees(token: string, date?: string): EmployeeSummary[] {
        const user = this.auth.requireUser(token);
        const employeeFilter = user.role === 'admin' ? '' : 'WHERE u.user_id = @userId';
        const params = user.role === 'admin' ? { userId: null, startDate: `${date ?? '1900-01-01'}T00:00:00.000Z`, endDate: `${date ?? '2999-12-31'}T23:59:59.999Z` } : { userId: user.userId, startDate: `${date ?? '1900-01-01'}T00:00:00.000Z`, endDate: `${date ?? '2999-12-31'}T23:59:59.999Z` };
        return this.database.prepare(`
            SELECT u.user_id AS userId, u.username, u.display_name AS displayName, u.role,
                   u.active = 1 AS active,
                   MAX(CASE WHEN s.clock_out IS NULL THEN s.clock_in END) AS openShiftStart,
                     COUNT(CASE WHEN es.created_at >= @startDate AND es.created_at < @endDate THEN es.employee_sale_id END) AS salesCount,
                     COALESCE(SUM(CASE WHEN es.created_at >= @startDate AND es.created_at < @endDate THEN o.total_amount ELSE 0 END), 0) AS salesTotal
            FROM users u
            LEFT JOIN employee_shifts s ON s.user_id = u.user_id
            LEFT JOIN employee_sales es ON es.user_id = u.user_id
            LEFT JOIN orders o ON o.order_id = es.order_id AND o.status = 'completed'
            ${employeeFilter}
            GROUP BY u.user_id, u.username, u.display_name, u.role, u.active
            ORDER BY u.display_name ASC
        `).all(params) as EmployeeSummary[];
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

    public listShifts(token: string, date: string): ShiftSummary[] {
        this.auth.requireAdmin(token);
        return this.database.prepare(`
            SELECT u.user_id AS userId, u.display_name AS displayName, u.role,
                   s.clock_in AS clockIn, s.clock_out AS clockOut
            FROM employee_shifts s JOIN users u ON u.user_id = s.user_id
            WHERE s.clock_in >= ? AND s.clock_in < ?
            ORDER BY s.clock_in ASC
        `).all(`${date}T00:00:00.000Z`, `${date}T23:59:59.999Z`) as ShiftSummary[];
    }

    public createEmployee(token: string, input: CreateEmployeeInput): { userId: string } {
        this.auth.requireAdmin(token);
        if (!input.username.trim() || !input.displayName.trim() || input.password.length < 8) throw new Error('Username, display name, and an 8-character password are required');
        if (this.database.prepare('SELECT 1 FROM users WHERE username = ?').get(input.username.trim().toLowerCase())) throw new Error('Username already exists');
        const { salt, hash } = createPasswordRecord(input.password);
        const userId = randomUUID();
        const now = new Date().toISOString();
        this.database.prepare('INSERT INTO users (user_id, username, display_name, role, password_salt, password_hash, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)').run(userId, input.username.trim().toLowerCase(), input.displayName.trim(), input.role, salt, hash, now, now);
        return { userId };
    }
}

function createPasswordRecord(password: string): { salt: string; hash: string } {
    const salt = randomBytes(16).toString('hex');
    return { salt, hash: scryptSync(password, salt, 64).toString('hex') };
}

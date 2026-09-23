import { randomUUID } from 'node:crypto';
import Database from 'better-sqlite3';
import type { AuthService } from '../auth/authService';

export interface CrmCustomer {
    customerId: string;
    displayName: string;
    email: string | null;
    phone: string | null;
    tierId: string;
    orderCount: number;
    lifetimeValue: number;
    pointsBalance: number;
    tags: string[];
    lastPurchaseAt: string | null;
}

export class CrmService {
    public constructor(private readonly database: Database.Database, private readonly auth: AuthService) {}

    public listCustomers(token: string): CrmCustomer[] {
        this.auth.requireUser(token);
        const rows = this.database.prepare(`
            SELECT c.customer_id AS customerId,
                   COALESCE(c.company_name || ' - ', '') || c.contact_name AS displayName,
                   c.email, c.phone, c.tier_id AS tierId,
                   COUNT(DISTINCT o.order_id) AS orderCount,
                   COALESCE(SUM(o.total_amount), 0) AS lifetimeValue,
                   COALESCE(la.points_balance, 0) AS pointsBalance,
                   MAX(o.created_at) AS lastPurchaseAt,
                   COALESCE(GROUP_CONCAT(ct.name, '||'), '') AS tagList
            FROM customers c
            LEFT JOIN orders o ON o.customer_id = c.customer_id AND o.status = 'completed'
            LEFT JOIN loyalty_accounts la ON la.customer_id = c.customer_id
            LEFT JOIN customer_tag_links ctl ON ctl.customer_id = c.customer_id
            LEFT JOIN customer_tags ct ON ct.tag_id = ctl.tag_id
            GROUP BY c.customer_id, c.company_name, c.contact_name, c.email, c.phone, c.tier_id, la.points_balance
            ORDER BY lastPurchaseAt DESC, displayName ASC
        `).all() as Array<Omit<CrmCustomer, 'tags'> & { tagList: string }>;
        return rows.map((row) => ({ ...row, tags: row.tagList ? row.tagList.split('||') : [] }));
    }

    public addTag(token: string, customerId: string, tagName: string): void {
        this.auth.requireAdmin(token);
        const now = new Date().toISOString();
        const tag = this.database.prepare('SELECT tag_id AS tagId FROM customer_tags WHERE name = ?').get(tagName.trim()) as { tagId: string } | undefined;
        const tagId = tag?.tagId ?? randomUUID();
        const transaction = this.database.transaction(() => {
            if (!tag) this.database.prepare('INSERT INTO customer_tags (tag_id, name) VALUES (?, ?)').run(tagId, tagName.trim());
            this.database.prepare('INSERT OR IGNORE INTO customer_tag_links (customer_id, tag_id, created_at) VALUES (?, ?, ?)').run(customerId, tagId, now);
        });
        transaction();
    }
}

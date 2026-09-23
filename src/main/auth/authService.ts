import { randomBytes, randomUUID, scryptSync, timingSafeEqual } from 'node:crypto';
import Database from 'better-sqlite3';

export type UserRole = 'admin' | 'cashier';

export interface AuthUser {
    userId: string;
    username: string;
    displayName: string;
    role: UserRole;
}

export interface LoginResult {
    token: string;
    user: AuthUser;
}

interface UserRow {
    userId: string;
    username: string;
    displayName: string;
    role: UserRole;
    passwordSalt: string;
    passwordHash: string;
}

export class AuthService {
    private readonly database: Database.Database;
    private readonly sessions = new Map<string, AuthUser>();

    public constructor(database: Database.Database) {
        this.database = database;
    }

    public login(username: string, password: string): LoginResult {
        const row = this.database.prepare(`
            SELECT user_id AS userId, username, display_name AS displayName, role,
                   password_salt AS passwordSalt, password_hash AS passwordHash
            FROM users
            WHERE username = ? AND active = 1
        `).get(username.trim().toLowerCase()) as UserRow | undefined;
        if (!row || !this.verifyPassword(password, row.passwordSalt, row.passwordHash)) {
            throw new Error('Invalid username or password');
        }

        const user: AuthUser = {
            userId: row.userId,
            username: row.username,
            displayName: row.displayName,
            role: row.role,
        };
        const token = randomUUID();
        this.sessions.set(token, user);
        return { token, user };
    }

    public logout(token: string): void {
        this.sessions.delete(token);
    }

    public requireUser(token: string): AuthUser {
        const user = this.sessions.get(token);
        if (!user) {
            throw new Error('Authentication required');
        }
        return user;
    }

    public requireAdmin(token: string): AuthUser {
        const user = this.requireUser(token);
        if (user.role !== 'admin') {
            throw new Error('Administrator access required');
        }
        return user;
    }

    private verifyPassword(password: string, salt: string, expectedHash: string): boolean {
        const actual = scryptSync(password, salt, 64);
        const expected = Buffer.from(expectedHash, 'hex');
        return actual.length === expected.length && timingSafeEqual(actual, expected);
    }
}

export function createPasswordRecord(password: string): { salt: string; hash: string } {
    const salt = randomBytes(16).toString('hex');
    return { salt, hash: scryptSync(password, salt, 64).toString('hex') };
}

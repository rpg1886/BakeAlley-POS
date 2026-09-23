import { CloudApiClient } from './apiClient';

export interface CloudSession {
    token: string;
    user: { userId: string; username: string; displayName: string; role: 'admin' | 'cashier' };
}

export class CloudPosApi extends CloudApiClient {
    public async login(username: string, password: string): Promise<CloudSession> {
        const response = await fetch(this.apiUrl('/api/v1/auth/login'), {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({ username, password }),
        });
        if (!response.ok) throw new Error((await response.json().catch(() => ({}))).error ?? 'Login failed');
        return response.json() as Promise<CloudSession>;
    }

}

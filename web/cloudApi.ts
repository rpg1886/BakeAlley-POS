import { CloudApiClient, type CloudEmployee, type CloudProduct, type CloudShift } from './apiClient';

export interface CloudCategory {
  categoryId: string;
  name: string;
}

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

  public async categories(): Promise<CloudCategory[]> {
    const token = this.options.getToken();
    const response = await fetch(this.apiUrl('/api/v1/categories'), {
      headers: {
        'content-type': 'application/json',
        ...(token ? { authorization: `Bearer ${token}` } : {}),
      },
    });
    if (!response.ok) {
      const body = await response.json().catch(() => ({}));
      throw new Error(body.error ?? 'Failed to fetch categories');
    }
    return response.json() as Promise<CloudCategory[]>;
  }

  public override async searchProducts(query: string): Promise<CloudProduct[]> {
    const token = this.options.getToken();
    const endpoint = query.startsWith('?')
      ? `/api/v1/products/search${query}`
      : `/api/v1/products/search?q=${encodeURIComponent(query)}`;

    const response = await fetch(this.apiUrl(endpoint), {
      headers: {
        'content-type': 'application/json',
        ...(token ? { authorization: `Bearer ${token}` } : {}),
      },
    });
    if (!response.ok) {
      const body = await response.json().catch(() => ({}));
      throw new Error(body.error ?? 'Product search failed');
    }
    return response.json() as Promise<CloudProduct[]>;
  }

  public override async employees(date?: string): Promise<CloudEmployee[]> {
    const token = this.options.getToken();
    const path = date ? `/api/v1/employees?date=${encodeURIComponent(date)}` : '/api/v1/employees';
    const response = await fetch(this.apiUrl(path), {
      headers: {
        'content-type': 'application/json',
        ...(token ? { authorization: `Bearer ${token}` } : {}),
      },
    });
    if (!response.ok) {
      const body = await response.json().catch(() => ({}));
      throw new Error(body.error ?? 'Failed to fetch employees');
    }
    return response.json() as Promise<CloudEmployee[]>;
  }

  public override async shifts(date?: string): Promise<CloudShift[]> {
    const token = this.options.getToken();
    const path = date ? `/api/v1/employees/shifts?date=${encodeURIComponent(date)}` : '/api/v1/employees/shifts';
    const response = await fetch(this.apiUrl(path), {
      headers: {
        'content-type': 'application/json',
        ...(token ? { authorization: `Bearer ${token}` } : {}),
      },
    });
    if (!response.ok) {
      const body = await response.json().catch(() => ({}));
      throw new Error(body.error ?? 'Failed to fetch shifts');
    }
    return response.json() as Promise<CloudShift[]>;
  }
}
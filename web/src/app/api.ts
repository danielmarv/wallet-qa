import { Injectable } from '@angular/core';

/** An error answer of the Wallet QA API, with its HTTP status. */
export class ApiError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message);
  }
}

export const errorText = (error: unknown) => (error instanceof Error ? error.message : 'Request failed');

/** The Wallet QA HTTP API under /v1, the same one the Maestro flows and WalletQaClient use. */
@Injectable({ providedIn: 'root' })
export class Api {
  async request<T>(route: string, init: RequestInit = {}): Promise<T> {
    const response = await fetch(`/v1${route}`, {
      ...init,
      headers: { 'Content-Type': 'application/json', ...init.headers },
    });
    const data = response.status === 204 ? null : await response.json().catch(() => null);
    if (!response.ok) throw new ApiError(data?.error?.message ?? 'Request failed', response.status);
    return data as T;
  }

  get<T>(route: string): Promise<T> {
    return this.request<T>(route);
  }

  /** A body that is already a string (an uploaded file) is sent as it is. */
  post<T>(route: string, body: unknown = {}): Promise<T> {
    return this.request<T>(route, { method: 'POST', body: typeof body === 'string' ? body : JSON.stringify(body) });
  }

  patch<T>(route: string, body: unknown): Promise<T> {
    return this.request<T>(route, { method: 'PATCH', body: JSON.stringify(body) });
  }

  delete(route: string): Promise<null> {
    return this.request<null>(route, { method: 'DELETE' });
  }

  /** A non-JSON answer, such as the JUnit report. */
  async text(route: string): Promise<string> {
    const response = await fetch(`/v1${route}`);
    if (!response.ok) throw new ApiError('Request failed', response.status);
    return response.text();
  }
}

/** localStorage that keeps working when storage is blocked (private mode, WebViews). */
export const storage = {
  get(key: string): string | null {
    try {
      return localStorage.getItem(key);
    } catch {
      return null;
    }
  },
  set(key: string, value: string) {
    try {
      localStorage.setItem(key, value);
    } catch {
      /* The page still works without it. */
    }
  },
  remove(key: string) {
    try {
      localStorage.removeItem(key);
    } catch {
      /* Nothing stored. */
    }
  },
};

/** Storage keys, the same as the plain-JS page used, so a stored workspace and run carry over. */
export const LAST_WORKSPACE_KEY = 'walletqa.lastWorkspace';
export const activeRunKey = (workspaceId: string) => `walletqa.activeRun.${workspaceId}`;

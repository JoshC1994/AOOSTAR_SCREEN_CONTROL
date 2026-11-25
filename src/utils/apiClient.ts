import type {AuthStatusResponse} from '../types.ts';

const authRequiredListeners = new Set<() => void>();

export function subscribeAuthRequired(listener: () => void): () => void {
  authRequiredListeners.add(listener);
  return () => {
    authRequiredListeners.delete(listener);
  };
}

export function notifyAuthRequired(): void {
  for (const listener of authRequiredListeners) {
    listener();
  }
}

export async function apiFetch(input: RequestInfo | URL, init: RequestInit = {}): Promise<Response> {
  const headers = new Headers(init.headers ?? {});
  headers.set('X-Requested-With', 'AoostarDisplayStudio');

  const res = await fetch(input, {
    ...init,
    headers,
    credentials: 'same-origin',
  });

  if (res.status === 401) {
    notifyAuthRequired();
  }

  return res;
}

export async function fetchAuthStatus(): Promise<AuthStatusResponse | null> {
  try {
    const res = await fetch('/api/auth/status', {
      credentials: 'same-origin',
      headers: {'X-Requested-With': 'AoostarDisplayStudio'},
    });
    if (!res.ok) return null;
    return (await res.json()) as AuthStatusResponse;
  } catch {
    return null;
  }
}

export async function loginWithPassword(
  username: string,
  password: string
): Promise<{
  ok: boolean;
  status?: number;
  error?: string;
  username?: string;
  usingDefaultPassword?: boolean;
  envOverrideActive?: boolean;
  publicBlocked?: boolean;
}> {
  try {
    const res = await fetch('/api/auth/login', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Requested-With': 'AoostarDisplayStudio',
      },
      credentials: 'same-origin',
      body: JSON.stringify({username: username.trim(), password}),
    });

    const data = (await res.json().catch(() => ({}))) as {
      ok?: boolean;
      error?: string;
      username?: string;
      usingDefaultPassword?: boolean;
      envOverrideActive?: boolean;
      publicBlocked?: boolean;
    };

    if (!res.ok) {
      return {
        ok: false,
        status: res.status,
        error: data.error || `Sign in failed (HTTP ${res.status})`,
        publicBlocked: Boolean(data.publicBlocked),
      };
    }

    return {
      ok: true,
      status: res.status,
      username: data.username,
      usingDefaultPassword: Boolean(data.usingDefaultPassword),
      envOverrideActive: Boolean(data.envOverrideActive),
    };
  } catch {
    return {ok: false, error: 'Failed to reach authentication endpoint.'};
  }
}

export async function logoutSession(): Promise<boolean> {
  try {
    const res = await fetch('/api/auth/logout', {
      method: 'POST',
      headers: {'X-Requested-With': 'AoostarDisplayStudio'},
      credentials: 'same-origin',
    });
    return res.ok;
  } catch {
    return false;
  }
}

export async function logoutEverywhere(): Promise<boolean> {
  try {
    const res = await apiFetch('/api/auth/logout-all', {
      method: 'POST',
    });
    return res.ok;
  } catch {
    return false;
  }
}

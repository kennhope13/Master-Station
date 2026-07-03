import { authService } from '../AuthService';
import { useAuthStore } from '@/store/authStore';
import { API_BASE_URL } from '@/utils/env';

export const API_BASE = `${API_BASE_URL}/api/v1`;
const GET_CACHE_PREFIX = 'api-get-cache:';
const GET_CACHE_TTL_MS = 60_000;

let refreshPromise: Promise<string | null> | null = null;
const inflightGetRequests = new Map<string, Promise<any>>();

type CachedGetRecord = {
  ts: number;
  data: unknown;
};

function getUserCacheScope(): string {
  const user = useAuthStore.getState().user;
  return user?.user_id || user?.username || 'anonymous';
}

function buildGetCacheKey(path: string): string {
  return `${GET_CACHE_PREFIX}${getUserCacheScope()}:${path}`;
}

function readGetCache<T>(cacheKey: string): T | null {
  try {
    const raw = sessionStorage.getItem(cacheKey);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as CachedGetRecord;
    if (!parsed || typeof parsed.ts !== 'number') return null;
    if (Date.now() - parsed.ts > GET_CACHE_TTL_MS) {
      sessionStorage.removeItem(cacheKey);
      return null;
    }
    return parsed.data as T;
  } catch {
    return null;
  }
}

function writeGetCache(cacheKey: string, data: unknown) {
  try {
    const payload: CachedGetRecord = { ts: Date.now(), data };
    sessionStorage.setItem(cacheKey, JSON.stringify(payload));
  } catch {
    // sessionStorage may be unavailable or full
  }
}

export function clearGetCache() {
  try {
    const keysToRemove: string[] = [];
    for (let i = 0; i < sessionStorage.length; i += 1) {
      const key = sessionStorage.key(i);
      if (key?.startsWith(GET_CACHE_PREFIX)) {
        keysToRemove.push(key);
      }
    }
    for (const key of keysToRemove) {
      sessionStorage.removeItem(key);
    }
  } catch {
    // ignore storage errors
  }
  inflightGetRequests.clear();
}

async function performRefresh(): Promise<string | null> {
  const store = useAuthStore.getState();
  const refreshToken = store.refreshToken;
  if (!refreshToken) return null;

  try {
    const res = await fetch(`${API_BASE}/auth/refresh`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ refreshToken }),
    });

    if (!res.ok) {
      store.clearSession();
      return null;
    }

    const data = await res.json();
    const token: string = data.token ?? '';
    const newRefreshToken = data.refreshToken ?? '';

    // Decode JWT payload để lấy thông tin user
    const base64url = token.split('.')[1] ?? '';
    const base64 = base64url.replace(/-/g, '+').replace(/_/g, '/');
    const jsonBytes = Uint8Array.from(atob(base64), c => c.charCodeAt(0));
    const payload = JSON.parse(new TextDecoder('utf-8').decode(jsonBytes));

    const user = {
      user_id: payload['http://schemas.xmlsoap.org/ws/2005/05/identity/claims/nameidentifier'] ?? '',
      username: payload['http://schemas.xmlsoap.org/ws/2005/05/identity/claims/name'] ?? '',
      fullname: payload['fullName'] ?? '',
      email: '',
      role: payload['http://schemas.microsoft.com/ws/2008/06/identity/claims/role'] ?? 'operator',
      active: true,
      created_at: new Date().toISOString(),
      is_restricted: payload['isRestricted'] === 'true' || !!payload['stationIds'],
      station_ids: payload['stationIds'] ? payload['stationIds'].split(',') : undefined,
      province_ids: payload['provinceIds'] ? payload['provinceIds'].split(',') : undefined,
    };

    store.setSession(user, token, newRefreshToken);
    return token;
  } catch (err) {
    store.clearSession();
    return null;
  }
}

async function getValidToken(): Promise<string | null> {
  const token = authService.getToken();
  if (!token) return null;

  try {
    const base64url = token.split('.')[1] ?? '';
    const base64 = base64url.replace(/-/g, '+').replace(/_/g, '/');
    const jsonBytes = Uint8Array.from(atob(base64), c => c.charCodeAt(0));
    const payload = JSON.parse(new TextDecoder('utf-8').decode(jsonBytes));
    
    // Nếu token sắp hết hạn trong vòng 10 giây -> tải lại chủ động
    const exp = payload.exp * 1000;
    if (Date.now() + 10000 >= exp) {
      if (!refreshPromise) {
        refreshPromise = performRefresh().finally(() => {
          refreshPromise = null;
        });
      }
      return await refreshPromise;
    }
  } catch {
    if (!refreshPromise) {
      refreshPromise = performRefresh().finally(() => {
        refreshPromise = null;
      });
    }
    return await refreshPromise;
  }

  return token;
}

/** GET request với Bearer token tự động. Tự động tải lại và thử lại nếu token hết hạn. */
export async function apiFetch<T>(path: string): Promise<T> {
  const cacheKey = buildGetCacheKey(path);
  const cached = readGetCache<T>(cacheKey);
  if (cached !== null) {
    return cached;
  }

  const inflight = inflightGetRequests.get(cacheKey);
  if (inflight) {
    return inflight as Promise<T>;
  }

  const request = (async () => {
    let token = await getValidToken();
    let res = await fetch(`${API_BASE}${path}`, {
      headers: token ? { Authorization: `Bearer ${token}` } : {}
    });

    if (res.status === 401) {
      if (!refreshPromise) {
        refreshPromise = performRefresh().finally(() => {
          refreshPromise = null;
        });
      }
      token = await refreshPromise;
      if (token) {
        res = await fetch(`${API_BASE}${path}`, {
          headers: { Authorization: `Bearer ${token}` }
        });
      }
    }

    if (!res.ok) {
      const errText = await res.text().catch(() => '');
      let message = '';
      try {
        const parsed = JSON.parse(errText);
        message = parsed.message || parsed.error || '';
      } catch {}
      throw new Error(message || `API ${path} → ${res.status}`);
    }

    if (res.status === 204) {
      return null as T;
    }

    const data = await res.json() as T;
    writeGetCache(cacheKey, data);
    return data;
  })();

  inflightGetRequests.set(cacheKey, request);
  try {
    return await request;
  } finally {
    inflightGetRequests.delete(cacheKey);
  }
}

/** POST/PUT/PATCH/DELETE với JSON body và Bearer token. Tự động tải lại và thử lại nếu token hết hạn. */
export async function apiMutate<T = any>(method: string, path: string, body?: object): Promise<T> {
  let token = await getValidToken();
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    ...(token ? { Authorization: `Bearer ${token}` } : {})
  };

  let res = await fetch(`${API_BASE}${path}`, {
    method,
    headers,
    body: body ? JSON.stringify(body) : undefined
  });

  if (res.status === 401) {
    if (!refreshPromise) {
      refreshPromise = performRefresh().finally(() => {
        refreshPromise = null;
      });
    }
    token = await refreshPromise;
    if (token) {
      headers['Authorization'] = `Bearer ${token}`;
      res = await fetch(`${API_BASE}${path}`, {
        method,
        headers,
        body: body ? JSON.stringify(body) : undefined
      });
    }
  }

  if (!res.ok) {
    const errText = await res.text().catch(() => '');
    let message = '';
    try {
      const parsed = JSON.parse(errText);
      message = parsed.message || parsed.error || '';
    } catch {}
    throw new Error(message || errText || `${method} ${path} → ${res.status}`);
  }
  if (res.status === 204) {
    clearGetCache();
    return null as T;
  }
  const data = await res.json();
  clearGetCache();
  return data;
}

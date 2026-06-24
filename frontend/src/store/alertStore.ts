// ============================================================
// alertStore.ts — Cache cảnh báo global
// Key cache theo filter (status). Hỗ trợ optimistic ack/close.
// TTL 5s (alert phải gần realtime). SignalR có thể trigger invalidate.
// ============================================================

import { create } from 'zustand';
import { createJSONStorage, persist } from 'zustand/middleware';
import { alertService } from '@/services/api/AlertService';
import type { AlertItem } from '@/types/api.types';
import { ALERT_STATUS } from '@/types/enums';

const STALE_MS = 5_000;

interface AlertStore {
  /** Map theo key filter (vd "open" hoặc "all"). */
  alertsByFilter: Record<string, AlertItem[]>;
  isLoading: boolean;
  lastFetchedAt: Record<string, number>;
  error: string | null;
  fetch: (status?: string, force?: boolean) => Promise<AlertItem[]>;
  invalidate: (status?: string) => void;
  /** Ack 1 alert + optimistic update vào cache. */
  ack: (id: string, note?: string) => Promise<void>;
  /** Close 1 alert + optimistic update. */
  close: (id: string) => Promise<void>;
  /** Inject 1 alert mới (từ SignalR realtime push). */
  prepend: (alert: AlertItem) => void;
  /** Selector: số alert open. */
  countOpen: () => number;
}

const inflight: Record<string, Promise<AlertItem[]> | null> = {};

const keyFor = (status?: string) => status ?? 'all';

export const useAlertStore = create<AlertStore>()(
  persist(
    (set, get) => ({
      alertsByFilter: {},
      isLoading: false,
      lastFetchedAt: {},
      error: null,

      fetch: async (status, force = false) => {
        const k = keyFor(status);
        const state = get();
        const ts = state.lastFetchedAt[k];
        const isFresh = ts && (Date.now() - ts) < STALE_MS;
        if (!force && isFresh && state.alertsByFilter[k]) return state.alertsByFilter[k];
        if (inflight[k]) return inflight[k]!;

        set({ isLoading: true, error: null });
        inflight[k] = alertService.getAlerts(status)
          .then(alerts => {
            set(s => ({
              alertsByFilter: { ...s.alertsByFilter, [k]: alerts },
              lastFetchedAt: { ...s.lastFetchedAt, [k]: Date.now() },
              isLoading: false,
            }));
            return alerts;
          })
          .catch(err => {
            set({ isLoading: false, error: String(err) });
            throw err;
          })
          .finally(() => { inflight[k] = null; });
        return inflight[k]!;
      },

      invalidate: (status) => {
        if (status === undefined) {
          set({ lastFetchedAt: {} });
        } else {
          set(s => {
            const next = { ...s.lastFetchedAt };
            delete next[keyFor(status)];
            return { lastFetchedAt: next };
          });
        }
      },

      ack: async (id, note) => {
        await alertService.ackAlert(id, note);
        set(s => {
          const next: Record<string, AlertItem[]> = {};
          for (const [k, list] of Object.entries(s.alertsByFilter)) {
            next[k] = list.map(a =>
              a.id === id ? { ...a, status: ALERT_STATUS.ACKED, ackedAt: new Date().toISOString(), ackNote: note } : a
            );
          }
          return { alertsByFilter: next };
        });
      },

      close: async (id) => {
        await alertService.closeAlert(id);
        set(s => {
          const next: Record<string, AlertItem[]> = {};
          for (const [k, list] of Object.entries(s.alertsByFilter)) {
            next[k] = list.map(a =>
              a.id === id ? { ...a, status: ALERT_STATUS.CLOSED, closedAt: new Date().toISOString() } : a
            );
          }
          return { alertsByFilter: next };
        });
      },

      prepend: (alert) => {
        set(s => {
          const next: Record<string, AlertItem[]> = { ...s.alertsByFilter };
          if (next.all) next.all = [alert, ...next.all];
          const list = next[alert.status];
          if (list) next[alert.status] = [alert, ...list];
          return { alertsByFilter: next };
        });
      },

      countOpen: () => {
        const s = get();
        return (s.alertsByFilter[ALERT_STATUS.OPEN] ?? s.alertsByFilter.all ?? [])
          .filter(a => a.status === ALERT_STATUS.OPEN).length;
      },
    }),
    {
      name: 'alert-store-cache',
      storage: createJSONStorage(() => sessionStorage),
      partialize: (state) => ({
        alertsByFilter: state.alertsByFilter,
        lastFetchedAt: state.lastFetchedAt,
      }),
    }
  )
);

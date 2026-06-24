// ============================================================
// sensorStore.ts — Cache latest sensor points
// Dashboard + RuleEngine cùng đọc. TTL 3s vì là dữ liệu realtime.
// ============================================================

import { create } from 'zustand';
import { createJSONStorage, persist } from 'zustand/middleware';
import { sensorService } from '@/services/api/SensorService';
import type { SensorPoint } from '@/types/api.types';

const STALE_MS = 3_000;

interface SensorStore {
  pointsByStation: Record<string, SensorPoint[]>;
  isLoading: boolean;
  lastFetchedAt: Record<string, number>;
  error: string | null;
  fetch: (stationId?: string, force?: boolean) => Promise<SensorPoint[]>;
  invalidate: (stationId?: string) => void;
}

const inflight: Record<string, Promise<SensorPoint[]> | null> = {};
const keyFor = (stationId?: string) => stationId ?? '__all__';

export const useSensorStore = create<SensorStore>()(
  persist(
    (set, get) => ({
      pointsByStation: {},
      isLoading: false,
      lastFetchedAt: {},
      error: null,

      fetch: async (stationId, force = false) => {
        const k = keyFor(stationId);
        const state = get();
        const ts = state.lastFetchedAt[k];
        const isFresh = ts && (Date.now() - ts) < STALE_MS;
        if (!force && isFresh && state.pointsByStation[k]) return state.pointsByStation[k];
        if (inflight[k]) return inflight[k]!;

        set({ isLoading: true, error: null });
        inflight[k] = sensorService.getLatestPoints(stationId)
          .then(points => {
            set(s => ({
              pointsByStation: { ...s.pointsByStation, [k]: points },
              lastFetchedAt: { ...s.lastFetchedAt, [k]: Date.now() },
              isLoading: false,
            }));
            return points;
          })
          .catch(err => {
            set({ isLoading: false, error: String(err) });
            throw err;
          })
          .finally(() => { inflight[k] = null; });
        return inflight[k]!;
      },

      invalidate: (stationId) => {
        if (stationId === undefined) {
          set({ lastFetchedAt: {} });
        } else {
          const k = keyFor(stationId);
          set(s => {
            const next = { ...s.lastFetchedAt };
            delete next[k];
            return { lastFetchedAt: next };
          });
        }
      },
    }),
    {
      name: 'sensor-store-cache',
      storage: createJSONStorage(() => sessionStorage),
      partialize: (state) => ({
        pointsByStation: state.pointsByStation,
        lastFetchedAt: state.lastFetchedAt,
      }),
    }
  )
);

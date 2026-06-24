// ============================================================
// deviceStore.ts — Cache devices theo stationId
// Trang dashboard, maintenance, device-management, alerts-history đều dùng.
// TTL 30s. Hỗ trợ optimistic update sau CRUD.
// ============================================================

import { create } from 'zustand';
import { createJSONStorage, persist } from 'zustand/middleware';
import { deviceService } from '@/services/api/DeviceService';
import type { Device } from '@/types/api.types';

const STALE_MS = 30_000;

interface DeviceStore {
  devicesByStation: Record<string, Device[]>;
  isLoading: boolean;
  lastFetchedAt: Record<string, number>;
  error: string | null;
  fetch: (stationId: string, force?: boolean) => Promise<Device[]>;
  invalidate: (stationId?: string) => void;
  /** Thay thế 1 device trong cache sau update (optimistic). */
  upsert: (device: Device) => void;
  /** Xóa 1 device khỏi cache sau delete. */
  remove: (stationId: string, deviceId: string) => void;
  /** Selector: tìm device theo id, không cần fetch lại. */
  findById: (deviceId: string) => Device | undefined;
}

const inflight: Record<string, Promise<Device[]> | null> = {};

export const useDeviceStore = create<DeviceStore>()(
  persist(
    (set, get) => ({
      devicesByStation: {},
      isLoading: false,
      lastFetchedAt: {},
      error: null,

      fetch: async (stationId, force = false) => {
        const state = get();
        const ts = state.lastFetchedAt[stationId];
        const isFresh = ts && (Date.now() - ts) < STALE_MS;
        if (!force && isFresh && state.devicesByStation[stationId]) {
          return state.devicesByStation[stationId];
        }
        if (inflight[stationId]) return inflight[stationId]!;

        set({ isLoading: true, error: null });
        inflight[stationId] = deviceService.getDevices(stationId, undefined, force)
          .then(devices => {
            set(s => ({
              devicesByStation: { ...s.devicesByStation, [stationId]: devices },
              lastFetchedAt: { ...s.lastFetchedAt, [stationId]: Date.now() },
              isLoading: false,
            }));
            return devices;
          })
          .catch(err => {
            set({ isLoading: false, error: String(err) });
            throw err;
          })
          .finally(() => { inflight[stationId] = null; });
        return inflight[stationId]!;
      },

      invalidate: (stationId) => {
        if (stationId === undefined) {
          set({ lastFetchedAt: {} });
        } else {
          set(s => {
            const next = { ...s.lastFetchedAt };
            delete next[stationId];
            return { lastFetchedAt: next };
          });
        }
      },

      upsert: (device) => {
        set(s => {
          const next: Record<string, Device[]> = {};
          for (const [sid, list] of Object.entries(s.devicesByStation)) {
            const idx = list.findIndex(d => d.id === device.id);
            if (idx >= 0) {
              next[sid] = [...list.slice(0, idx), device, ...list.slice(idx + 1)];
            } else if (device.stationId === sid) {
              next[sid] = [...list, device];
            } else {
              next[sid] = list;
            }
          }
          return { devicesByStation: next };
        });
      },

      remove: (stationId, deviceId) => {
        set(s => {
          const list = s.devicesByStation[stationId];
          if (!list) return s;
          return {
            devicesByStation: {
              ...s.devicesByStation,
              [stationId]: list.filter(d => d.id !== deviceId),
            },
          };
        });
      },

      findById: (deviceId) => {
        const all = Object.values(get().devicesByStation).flat();
        return all.find(d => d.id === deviceId);
      },
    }),
    {
      name: 'device-store-cache',
      storage: createJSONStorage(() => sessionStorage),
      partialize: (state) => ({
        devicesByStation: state.devicesByStation,
        lastFetchedAt: state.lastFetchedAt,
      }),
    }
  )
);

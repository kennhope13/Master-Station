// ============================================================
// StationService.ts — Quản lý danh sách trạm điện (Station)
// Endpoints: GET /stations
// Một hệ thống có thể có nhiều trạm (multisite); mỗi trạm có id riêng
// Export: stationService (singleton), dùng qua StationApiService facade
// ============================================================

import { apiFetch, apiMutate } from './BaseApiService';
import type { Station } from '@/types/api.types';

export class StationService {
  /** Lấy danh sách tất cả trạm điện đang quản lý. */
  async getStations(): Promise<Station[]> {
    return apiFetch<Station[]>('/stations');
  }

  /** Lấy id của trạm đầu tiên — dùng khi URL không chứa stationId. */
  async getFirstStationId(): Promise<string | null> {
    const stations = await this.getStations();
    if (stations.length === 0) return null;
    return stations[0]?.id ?? null;
  }

  /** Tạo trạm mới. */
  async createStation(name: string, code: string, location: string, apiUrl?: string): Promise<Station> {
    return apiMutate<Station>('POST', '/stations', { name, code, location, apiUrl });
  }

  /** Kiểm tra kết nối tới trạm con. */
  async testConnection(url: string): Promise<{ reachable: boolean; responseMs: number; error?: string }> {
    return apiMutate('POST', '/stations/test-connection', { url });
  }

  /** Lấy KPI thực từ trạm con. */
  async getRemoteKpi(id: string): Promise<{ devicesOnline: number; devicesTotal: number; alertsCount: number; error?: string }> {
    return apiFetch(`/stations/${id}/remote-kpi`);
  }

  /** Xóa trạm. */
  async deleteStation(id: string): Promise<void> {
    return apiMutate<void>('DELETE', `/stations/${id}`);
  }
}

export const stationService = new StationService();

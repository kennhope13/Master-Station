// ============================================================
// StationService.ts — Quản lý danh sách trạm điện (Station)
// Endpoints: GET /stations
// Một hệ thống có thể có nhiều trạm (multisite); mỗi trạm có id riêng
// Export: stationService (singleton), dùng qua StationApiService facade
// ============================================================

import { apiFetch, apiMutate } from './BaseApiService';
import type { Station, CameraDevice } from '@/types/api.types';

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
  async createStation(
    name: string,
    code: string,
    location: string,
    apiUrl?: string,
    webUrl?: string,
    apiPassword?: string,
    apiUsername: string = 'stationadmin',
    provinceId?: string
  ): Promise<Station> {
    return apiMutate<Station>('POST', '/stations', { name, code, location, apiUrl, webUrl, apiPassword, apiUsername, provinceId });
  }

  /** Kiểm tra kết nối tới trạm con. */
  async testConnection(url: string): Promise<{ reachable: boolean; responseMs: number; error?: string }> {
    return apiMutate('POST', '/stations/test-connection', { url });
  }

  /** Lấy KPI thực từ trạm con (bao gồm devices, alerts, sensor points, health scores). */
  async getRemoteKpi(id: string): Promise<{
    devicesOnline: number;
    devicesTotal: number;
    alertsCount: number;
    points: Array<{ deviceId: string; pointId: string; value: number; unit: string; quality: number; time: string }>;
    healthScores: Array<{ deviceId: string; deviceName: string; deviceType: string; status: string; score: number; risk: string }>;
    boundaries: Array<{ id: string; deviceId: string; name: string; type: string; severityLevel: string; enabled: boolean }>;
    roiPoints: Array<{ id: string; deviceId: string; label: string }>;
    go2rtcBase?: string;
    rtspBase?: string;
    webUiUrl?: string;
    error?: string;
  }> {
    return apiFetch(`/stations/${id}/remote-kpi`);
  }

  /** Lấy danh sách camera từ trạm con qua proxy master station. */
  async getRemoteCameras(id: string): Promise<{
    go2rtcBase: string | null;
    rtspBase: string | null;
    cameras: Array<{ device: CameraDevice; streamUrls: Record<string, string> }>;
  }> {
    return apiFetch(`/stations/${id}/remote-cameras`);
  }

  /** Lấy JWT token từ trạm con để SSO. */
  async getRemoteToken(id: string): Promise<{ token: string }> {
    return apiFetch(`/stations/${id}/remote-token`);
  }

  /** Proxy danh sách cảnh báo từ trạm con. */
  async getRemoteAlerts(id: string, opts?: { status?: string; from?: string; to?: string; limit?: number }): Promise<import('@/types/api.types').AlertItem[]> {
    const params = new URLSearchParams();
    if (opts?.status) params.set('status', opts.status);
    if (opts?.from)   params.set('from', opts.from);
    if (opts?.to)     params.set('to', opts.to);
    if (opts?.limit)  params.set('limit', String(opts.limit));
    return apiFetch(`/stations/${id}/remote-alerts?${params.toString()}`);
  }

  /** Cập nhật thông tin trạm. */
  async updateStation(id: string, data: { name?: string; code?: string; location?: string; apiUrl?: string; apiUsername?: string; apiPassword?: string; webUrl?: string; status?: string }): Promise<void> {
    return apiMutate<void>('PUT', `/stations/${id}`, data);
  }

  /** Xóa trạm. */
  async deleteStation(id: string): Promise<void> {
    return apiMutate<void>('DELETE', `/stations/${id}?force=true`);
  }
}

export const stationService = new StationService();

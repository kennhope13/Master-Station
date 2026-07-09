// ============================================================
// StationService.ts — Quản lý danh sách trạm điện (Station)
// Endpoints: GET /stations
// Một hệ thống có thể có nhiều trạm (multisite); mỗi trạm có id riêng
// Export: stationService (singleton), dùng qua StationApiService facade
// ============================================================

import { apiFetch, apiMutate, clearGetCache } from './BaseApiService';
import { authService } from '@/services/AuthService';
import type { Station, CameraDevice, UserItem } from '@/types/api.types';

export class StationService {
  /** Lấy danh sách tất cả trạm điện đang quản lý. */
  async getStations(force = false): Promise<Station[]> {
    return apiFetch<Station[]>('/stations', force);
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
    provinceId?: string,
    cameraQuota?: number | null,
    sensorQuota?: number | null
  ): Promise<Station> {
    return apiMutate<Station>('POST', '/stations', { name, code, location, apiUrl, webUrl, apiPassword, apiUsername, provinceId, cameraQuota, sensorQuota });
  }

  /** Kiểm tra kết nối tới trạm cục bộ. */
  async testConnection(url: string): Promise<{ reachable: boolean; responseMs: number; error?: string }> {
    return apiMutate('POST', '/stations/test-connection', { url });
  }

  /** Lấy KPI thực từ trạm cục bộ (bao gồm devices, alerts, sensor points, health scores). */
  async getRemoteKpi(id: string, force = false): Promise<{
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
    return apiFetch(`/stations/${id}/remote-kpi`, force);
  }

  /** Lấy danh sách camera từ trạm cục bộ qua proxy master station. */
  async getRemoteCameras(id: string): Promise<{
    go2rtcBase: string | null;
    rtspBase: string | null;
    cameras: Array<{ device: CameraDevice; streamUrls: Record<string, string> }>;
  }> {
    return apiFetch(`/stations/${id}/remote-cameras`);
  }

  /** Lấy JWT token từ trạm cục bộ để SSO. */
  async getRemoteToken(id: string): Promise<{ token: string }> {
    return apiFetch(`/stations/${id}/remote-token`);
  }

  /** Xuất request string license từ trạm cục bộ qua proxy trạm trung tâm. */
  async getRemoteLicenseRequest(id: string): Promise<{ request: string; fileName: string }> {
    return apiFetch(`/stations/${id}/remote-license-request`, true);
  }

  /** Nhập file license .lic vào trạm cục bộ qua proxy trạm trung tâm. */
  async importRemoteLicense(id: string, file: File): Promise<any> {
    const formData = new FormData();
    formData.append('file', file);
    const token = authService.getToken() || localStorage.getItem('station_token');
    const baseUrl = (window as any).__API_BASE__ || '';
    const res = await fetch(`${baseUrl}/api/v1/stations/${id}/remote-license-import`, {
      method: 'POST',
      headers: token ? { Authorization: `Bearer ${token}` } : {},
      body: formData,
    });
    if (!res.ok) {
      const err = await res.json().catch(() => ({ message: res.statusText }));
      throw new Error(err.message || err.detail || 'Import license trạm cục bộ thất bại');
    }
    const data = await res.json();
    clearGetCache();
    return data;
  }

  /** Tạo license theo quota đã cấp và nhập trực tiếp vào trạm cục bộ. */
  async provisionRemoteLicense(id: string): Promise<any> {
    return apiMutate('POST', `/stations/${id}/remote-license-provision`);
  }

  /** Xóa toàn bộ license đang áp dụng trên trạm cục bộ. */
  async clearRemoteLicense(id: string): Promise<any> {
    return apiMutate('DELETE', `/stations/${id}/remote-license-clear`);
  }

  /** Proxy danh sách cảnh báo từ trạm cục bộ. */
  async getRemoteAlerts(id: string, opts?: { status?: string; from?: string; to?: string; limit?: number }): Promise<import('@/types/api.types').AlertItem[]> {
    const params = new URLSearchParams();
    if (opts?.status) params.set('status', opts.status);
    if (opts?.from)   params.set('from', opts.from);
    if (opts?.to)     params.set('to', opts.to);
    if (opts?.limit)  params.set('limit', String(opts.limit));
    return apiFetch(`/stations/${id}/remote-alerts?${params.toString()}`);
  }

  /** Lấy danh sách người dùng từ trạm cục bộ qua proxy master station. */
  async getRemoteUsers(id: string): Promise<UserItem[]> {
    return apiFetch<UserItem[]>(`/stations/${id}/remote-users`);
  }

  /** Proxy audit logs từ trạm cục bộ. */
  async getRemoteAuditLogs(id: string, opts?: { action?: string; entityType?: string; userId?: string; from?: string; to?: string; stationId?: string; limit?: number }): Promise<import('@/types/api.types').AuditLogEntry[]> {
    const params = new URLSearchParams();
    if (opts?.action) params.set('action', opts.action);
    if (opts?.entityType) params.set('entityType', opts.entityType);
    if (opts?.userId) params.set('userId', opts.userId);
    if (opts?.from) params.set('from', opts.from);
    if (opts?.to) params.set('to', opts.to);
    if (opts?.stationId) params.set('stationId', opts.stationId);
    if (opts?.limit) params.set('limit', String(opts.limit));
    return apiFetch(`/stations/${id}/remote-audit-logs?${params.toString()}`);
  }

  /** Proxy login logs từ trạm cục bộ. */
  async getRemoteLoginLogs(id: string, opts?: { from?: string; to?: string; stationId?: string; limit?: number }): Promise<import('@/types/api.types').LoginLogEntry[]> {
    const params = new URLSearchParams();
    if (opts?.from) params.set('from', opts.from);
    if (opts?.to) params.set('to', opts.to);
    if (opts?.stationId) params.set('stationId', opts.stationId);
    if (opts?.limit) params.set('limit', String(opts.limit));
    return apiFetch(`/stations/${id}/remote-login-logs?${params.toString()}`);
  }

  /** Proxy notify logs từ trạm cục bộ. */
  async getRemoteNotifyLogs(id: string, opts?: { status?: string; channel?: string; from?: string; to?: string; stationId?: string; limit?: number }): Promise<import('@/types/api.types').NotifyLogEntry[]> {
    const params = new URLSearchParams();
    if (opts?.status) params.set('status', opts.status);
    if (opts?.channel) params.set('channel', opts.channel);
    if (opts?.from) params.set('from', opts.from);
    if (opts?.to) params.set('to', opts.to);
    if (opts?.stationId) params.set('stationId', opts.stationId);
    if (opts?.limit) params.set('limit', String(opts.limit));
    return apiFetch(`/stations/${id}/remote-notify-logs?${params.toString()}`);
  }

  /** Proxy rule trigger logs từ trạm cục bộ. */
  async getRemoteRuleTriggerLogs(id: string, opts?: { ruleId?: string; deviceId?: string; from?: string; to?: string; stationId?: string; limit?: number }): Promise<import('@/types/api.types').RuleTriggerLogEntry[]> {
    const params = new URLSearchParams();
    if (opts?.ruleId) params.set('ruleId', opts.ruleId);
    if (opts?.deviceId) params.set('deviceId', opts.deviceId);
    if (opts?.from) params.set('from', opts.from);
    if (opts?.to) params.set('to', opts.to);
    if (opts?.stationId) params.set('stationId', opts.stationId);
    if (opts?.limit) params.set('limit', String(opts.limit));
    return apiFetch(`/stations/${id}/remote-rule-trigger-logs?${params.toString()}`);
  }

  /** Lấy lịch sử dự báo của trạm cục bộ qua proxy. */
  async getRemotePredictionHistory(id: string, params: Record<string, string>): Promise<any> {
    const q = new URLSearchParams(params).toString();
    return apiFetch(`/stations/${id}/remote-prediction-history?${q}`);
  }

  /** Lấy dự báo mới nhất của trạm cục bộ qua proxy. */
  async getRemoteLatestPrediction(id: string, params: Record<string, string>): Promise<any> {
    const q = new URLSearchParams(params).toString();
    return apiFetch(`/stations/${id}/remote-latest-prediction?${q}`);
  }

  /** Lấy trạng thái huấn luyện AI của trạm cục bộ qua proxy. */
  async getRemoteTrainingStatus(id: string): Promise<any> {
    return apiFetch(`/stations/${id}/remote-training-status`);
  }

  /** Lấy cấu hình dự báo AI của trạm cục bộ qua proxy. */
  async getRemotePredictionConfig(id: string, params: Record<string, string>): Promise<any> {
    const q = new URLSearchParams(params).toString();
    return apiFetch(`/stations/${id}/remote-prediction-config?${q}`);
  }

  /** Lấy danh sách sự kiện phát hiện của trạm cục bộ qua proxy. */
  async getRemoteDetections(id: string, params: Record<string, string>): Promise<any[]> {
    const q = new URLSearchParams(params).toString();
    return apiFetch(`/stations/${id}/remote-detections?${q}`);
  }

  /** Cập nhật thông tin trạm. */
  async updateStation(id: string, data: { name?: string; code?: string; location?: string; apiUrl?: string; apiUsername?: string; apiPassword?: string; webUrl?: string; status?: string; provinceId?: string; cameraQuota?: number | null; sensorQuota?: number | null }): Promise<void> {
    return apiMutate<void>('PUT', `/stations/${id}`, data);
  }

  /** Xóa trạm. */
  async deleteStation(id: string): Promise<void> {
    return apiMutate<void>('DELETE', `/stations/${id}?force=true`);
  }
}

export const stationService = new StationService();

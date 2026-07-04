// ============================================================
// StationService.ts — Quản lý danh sách trạm điện (Station)
// Endpoints: GET /stations
// Một hệ thống có thể có nhiều trạm (multisite); mỗi trạm có id riêng
// Export: stationService (singleton), dùng qua StationApiService facade
// ============================================================

import { apiFetch, apiMutate } from './BaseApiService';
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
    provinceId?: string
  ): Promise<Station> {
    return apiMutate<Station>('POST', '/stations', { name, code, location, apiUrl, webUrl, apiPassword, apiUsername, provinceId });
  }

  /** Kiểm tra kết nối tới trạm con. */
  async testConnection(url: string): Promise<{ reachable: boolean; responseMs: number; error?: string }> {
    return apiMutate('POST', '/stations/test-connection', { url });
  }

  /** Lấy KPI thực từ trạm con (bao gồm devices, alerts, sensor points, health scores). */
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

  /** Lấy danh sách người dùng từ trạm con qua proxy master station. */
  async getRemoteUsers(id: string): Promise<UserItem[]> {
    return apiFetch<UserItem[]>(`/stations/${id}/remote-users`);
  }

  /** Proxy audit logs từ trạm con. */
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

  /** Proxy login logs từ trạm con. */
  async getRemoteLoginLogs(id: string, opts?: { from?: string; to?: string; stationId?: string; limit?: number }): Promise<import('@/types/api.types').LoginLogEntry[]> {
    const params = new URLSearchParams();
    if (opts?.from) params.set('from', opts.from);
    if (opts?.to) params.set('to', opts.to);
    if (opts?.stationId) params.set('stationId', opts.stationId);
    if (opts?.limit) params.set('limit', String(opts.limit));
    return apiFetch(`/stations/${id}/remote-login-logs?${params.toString()}`);
  }

  /** Proxy notify logs từ trạm con. */
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

  /** Proxy rule trigger logs từ trạm con. */
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

  /** Lấy lịch sử dự báo của trạm con qua proxy. */
  async getRemotePredictionHistory(id: string, params: Record<string, string>): Promise<any> {
    const q = new URLSearchParams(params).toString();
    return apiFetch(`/stations/${id}/remote-prediction-history?${q}`);
  }

  /** Lấy dự báo mới nhất của trạm con qua proxy. */
  async getRemoteLatestPrediction(id: string, params: Record<string, string>): Promise<any> {
    const q = new URLSearchParams(params).toString();
    return apiFetch(`/stations/${id}/remote-latest-prediction?${q}`);
  }

  /** Lấy trạng thái huấn luyện AI của trạm con qua proxy. */
  async getRemoteTrainingStatus(id: string): Promise<any> {
    return apiFetch(`/stations/${id}/remote-training-status`);
  }

  /** Lấy cấu hình dự báo AI của trạm con qua proxy. */
  async getRemotePredictionConfig(id: string, params: Record<string, string>): Promise<any> {
    const q = new URLSearchParams(params).toString();
    return apiFetch(`/stations/${id}/remote-prediction-config?${q}`);
  }

  /** Lấy danh sách sự kiện phát hiện của trạm con qua proxy. */
  async getRemoteDetections(id: string, params: Record<string, string>): Promise<any[]> {
    const q = new URLSearchParams(params).toString();
    return apiFetch(`/stations/${id}/remote-detections?${q}`);
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

// ============================================================
// AnalyticsService.ts — Báo cáo, bảo trì, sức khỏe hệ thống
// Endpoints: /reports, /maintenance, /analytics/health, /analytics/trend
// Dùng cho: ReportsPage (xuất báo cáo), MaintenancePage (lịch bảo trì),
//           AnalyticsPage (sức khỏe tủ, xu hướng nhiệt độ)
// Export: analyticsService (singleton), dùng qua StationApiService facade
// ============================================================

import { apiFetch, apiMutate, API_BASE } from './BaseApiService';
import { authService } from '../AuthService';
import type { ReportItem, MaintenanceTask, MaintenanceSuggestion, HealthScore, TrendItem } from '@/types/api.types';

export class AnalyticsService {
  // ── Reports ──────────────────────────────────────────────

  /** Tạo báo cáo mới (daily/monthly/event). Backend xử lý async, trả về ReportItem với status. */
  async generateReport(data: {
    stationId?: string;
    scopeType?: 'fleet' | 'province' | 'team' | 'station';
    provinceId?: string;
    teamId?: string;
    scopeLabel?: string;
    type: string;
    from: string;
    to: string;
  }): Promise<ReportItem> {
    const guidEmpty = '00000000-0000-0000-0000-000000000000';
    return apiMutate('POST', '/reports/generate', {
      stationId: data.stationId || guidEmpty,
      scopeType: data.scopeType || 'station',
      provinceId: data.provinceId || null,
      teamId: data.teamId || null,
      scopeLabel: data.scopeLabel || null,
      type: data.type,
      from: new Date(data.from).toISOString(),
      to: new Date(data.to).toISOString(),
    });
  }

  /** Danh sách báo cáo đã tạo của trạm. */
  async getReports(filters?: {
    stationId?: string;
    scopeType?: 'fleet' | 'province' | 'team' | 'station';
    provinceId?: string;
    teamId?: string;
  }): Promise<ReportItem[]> {
    const params = new URLSearchParams();
    if (filters?.scopeType && filters.scopeType !== 'fleet') params.set('scopeType', filters.scopeType);
    if (filters?.stationId) params.set('stationId', filters.stationId);
    if (filters?.provinceId) params.set('provinceId', filters.provinceId);
    if (filters?.teamId) params.set('teamId', filters.teamId);
    const q = params.toString() ? `?${params.toString()}` : '';
    return apiFetch<ReportItem[]>(`/reports${q}`);
  }

  /** Xóa báo cáo (xóa luôn file đã tạo trên server). */
  async deleteReport(id: string): Promise<void> {
    return apiMutate('DELETE', `/reports/${id}`);
  }

  /** Tải file báo cáo (PDF/XLSX). Trả về Blob để trigger browser download. */
  async downloadReport(id: string): Promise<Blob> {
    const token = authService.getToken();
    const res = await fetch(`${API_BASE}/reports/${id}/download`, {
      headers: token ? { Authorization: `Bearer ${token}` } : {}
    });
    if (!res.ok) throw new Error(`Download failed: ${res.status}`);
    return res.blob();
  }

  // ── Maintenance ───────────────────────────────────────────

  /** Danh sách task bảo trì. Lọc theo trạm, trạng thái (pending/in_progress/done), thiết bị. */
  async getMaintenance(stationId?: string, status?: string, deviceId?: string): Promise<MaintenanceTask[]> {
    const params = new URLSearchParams();
    if (stationId) params.set('stationId', stationId);
    if (status)    params.set('status', status);
    if (deviceId)  params.set('deviceId', deviceId);
    const q = params.toString() ? `?${params}` : '';
    return apiFetch<MaintenanceTask[]>(`/maintenance${q}`);
  }

  /** Tạo task bảo trì mới. checklist là JSON string (stringify mảng string[]). */
  async createMaintenance(data: {
    stationId: string; deviceId?: string; title: string; type: string;
    scheduledDate: string; assignedTo?: string; notes?: string; checklist?: string;
  }): Promise<MaintenanceTask> {
    return apiMutate('POST', '/maintenance', data);
  }

  /** Cập nhật task bảo trì (tiêu đề, ngày, ghi chú, checklist...). */
  async updateMaintenance(id: string, data: any): Promise<MaintenanceTask> {
    return apiMutate('PUT', `/maintenance/${id}`, data);
  }

  /** Xóa task bảo trì. */
  async deleteMaintenance(id: string): Promise<void> {
    return apiMutate('DELETE', `/maintenance/${id}`);
  }

  /** Bắt đầu thực hiện task — chuyển status sang "in_progress". */
  async startMaintenance(id: string): Promise<MaintenanceTask> {
    return apiMutate('POST', `/maintenance/${id}/start`, {});
  }

  /** Đánh dấu task hoàn thành kèm ghi chú kết quả. */
  async completeMaintenance(id: string, notes?: string): Promise<MaintenanceTask> {
    return apiMutate('POST', `/maintenance/${id}/complete`, { notes });
  }

  /** Gợi ý bảo trì từ AI — dựa trên xu hướng nhiệt, PD, lịch sử cảnh báo. */
  async getMaintenanceSuggestions(stationId?: string): Promise<MaintenanceSuggestion[]> {
    const q = stationId ? `?stationId=${stationId}` : '';
    return apiFetch<MaintenanceSuggestion[]>(`/maintenance/suggestions${q}`);
  }

  // ── Health & Trends ───────────────────────────────────────

  /** Điểm sức khỏe từng tủ điện (0-100). Dùng cho bảng fleet overview trong Analytics. */
  async getHealthScores(stationId?: string): Promise<HealthScore[]> {
    const q = stationId ? `?stationId=${stationId}` : '';
    return apiFetch<HealthScore[]>(`/analytics/health${q}`);
  }

  /** Xu hướng nhiệt độ và PD theo ngày — dùng cho biểu đồ trend trong Analytics. */
  async getTrends(stationId?: string, days = 7): Promise<TrendItem[]> {
    const params = new URLSearchParams({ days: String(days) });
    if (stationId) params.set('stationId', stationId);
    return apiFetch<TrendItem[]>(`/analytics/trend?${params}`);
  }
}

export const analyticsService = new AnalyticsService();

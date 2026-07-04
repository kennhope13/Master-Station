// ============================================================
// SystemService.ts — Cài đặt hệ thống, người dùng, cloud sync, license
// Endpoints: /users, /settings, /sync, /notifications, /detections, /license
// Gộp các API quản trị hệ thống không thuộc domain cụ thể nào
// Export: systemService (singleton), dùng qua StationApiService facade
// ============================================================

import { apiFetch, apiMutate, clearGetCache } from './BaseApiService';
import { authService } from '../AuthService';
import type { UserItem, SmtpConfig, SyncStatus, PermissionInfo, Province, Team } from '@/types/api.types';

export class SystemService {
  // ── Users ─────────────────────────────────────────────────

  private mapToUserItem(u: any): UserItem {
    return {
      ...u,
      province_ids: u.provinceIds || u.province_ids,
      station_ids: u.stationIds || u.station_ids,
      initialPassword: u.initialPassword ?? u.initial_password ?? null,
    };
  }

  private mapToBackendBody(data: any): any {
    const payload = { ...data };
    if ('province_ids' in payload) {
      payload.provinceIds = payload.province_ids;
      delete payload.province_ids;
    }
    if ('station_ids' in payload) {
      payload.stationIds = payload.station_ids;
      delete payload.station_ids;
    }
    return payload;
  }

  /** Lấy danh sách tài khoản người dùng. */
  async getUsers(): Promise<UserItem[]> {
    const list = await apiFetch<any[]>('/users');
    return list.map(u => this.mapToUserItem(u));
  }

  // ── Teams ─────────────────────────────────────────────────

  /** Lấy danh sách tổ/đội. */
  async getTeams(): Promise<Team[]> {
    return apiFetch<Team[]>('/teams');
  }

  /** Lấy thông tin chi tiết tổ/đội. */
  async getTeam(id: string): Promise<Team> {
    return apiFetch<Team>(`/teams/${id}`);
  }

  /** Tạo tổ mới. */
  async createTeam(data: { name: string; description?: string; provinceId: string; stationIds?: string[] }): Promise<Team> {
    return apiMutate('POST', '/teams', data);
  }

  /** Cập nhật tổ. */
  async updateTeam(id: string, data: { name: string; description?: string; provinceId: string; stationIds?: string[] }): Promise<Team> {
    return apiMutate('PUT', `/teams/${id}`, data);
  }

  /** Xóa tổ. */
  async deleteTeam(id: string): Promise<void> {
    return apiMutate('DELETE', `/teams/${id}`);
  }

  /** Lấy danh sách quyền hạn khả dụng. */
  async getAvailablePermissions(): Promise<PermissionInfo[]> {
    return apiFetch<PermissionInfo[]>('/users/permissions');
  }

  /** Lấy danh sách tỉnh khả dụng. */
  async getProvinces(): Promise<Province[]> {
    return apiFetch<Province[]>(`/provinces?_t=${Date.now()}`);
  }

  /** Tạo tài khoản mới. data cần có username, password, role, fullname. */
  async createUser(data: any): Promise<UserItem> {
    const payload = this.mapToBackendBody(data);
    const res = await apiMutate('POST', '/users', payload);
    return this.mapToUserItem(res);
  }

  /** Cập nhật thông tin hoặc role của người dùng. */
  async updateUser(id: string, data: any): Promise<UserItem> {
    const payload = this.mapToBackendBody(data);
    const res = await apiMutate('PUT', `/users/${id}`, payload);
    return this.mapToUserItem(res);
  }

  /** Vô hiệu hóa tài khoản (soft delete). */
  async deleteUser(id: string): Promise<void> {
    return apiMutate('DELETE', `/users/${id}`);
  }

  /** Xóa vĩnh viễn tài khoản (hard delete). */
  async permanentDeleteUser(id: string): Promise<void> {
    return apiMutate('DELETE', `/users/${id}?permanent=true`);
  }

  /** Đổi mật khẩu. Admin không cần oldPassword; user thường thì cần. */
  async changePassword(id: string, data: { oldPassword?: string; newPassword: string }): Promise<{ message: string }> {
    return apiMutate('POST', `/users/${id}/change-password`, data);
  }

  // ── Settings ──────────────────────────────────────────────

  /** Lấy toàn bộ cài đặt hệ thống dạng key-value string. */
  async getSettings(): Promise<Record<string, string>> {
    return apiFetch<Record<string, string>>('/settings');
  }

  /** Cập nhật một setting theo key. Ví dụ key: "smtp.host", value: "smtp.gmail.com". */
  async updateSetting(key: string, value: string): Promise<any> {
    return apiMutate('PUT', `/settings/${key}`, { value });
  }

  // ── Cloud Sync ────────────────────────────────────────────

  /** Trạng thái đồng bộ cloud: lần sync cuối, lỗi nếu có. */
  async getSyncStatus(): Promise<SyncStatus> {
    return apiFetch<SyncStatus>('/sync/status');
  }

  /** Kích hoạt đồng bộ cloud ngay lập tức (không chờ schedule). */
  async triggerSync(): Promise<any> {
    return apiMutate('POST', '/sync/trigger');
  }

  // ── Notifications ─────────────────────────────────────────

  /** Lấy cấu hình SMTP hiện tại để điền vào form cài đặt. */
  async getSmtpConfig(): Promise<SmtpConfig> {
    return apiFetch<SmtpConfig>('/notifications/smtp-config');
  }

  /** Gửi email test để kiểm tra cấu hình SMTP. */
  async sendTestEmail(email: string): Promise<{ message: string }> {
    return apiMutate('POST', '/notifications/test-email', { email });
  }

  // ── Detections ────────────────────────────────────────────

  /** Lấy danh sách sự kiện phát hiện (AI/camera). queryString truyền thẳng vào URL. */
  async getDetections(queryString: string): Promise<any[]> {
    return apiFetch(`/detections?${queryString}`);
  }

  // ── License ───────────────────────────────────────────────

  /** Trạng thái license: hợp lệ/hết hạn, số ngày còn lại, giới hạn tài nguyên. */
  async getLicenseStatus(): Promise<any> {
    return apiFetch('/license/status');
  }

  /** Kích hoạt license bằng key. */
  async activateLicense(key: string): Promise<any> {
    return apiMutate('POST', '/license/activate', { key });
  }

  /** Kiểm tra tính hợp lệ key mà không kích hoạt. */
  async validateLicenseKey(key: string): Promise<any> {
    return apiMutate('POST', '/license/validate', { key });
  }

  /** Tổng quan sử dụng tài nguyên hiện tại vs giới hạn license. */
  async getLicenseLimits(): Promise<any[]> {
    return apiFetch('/license/limits');
  }

  /** Xuất request string (vân tay phần cứng) để gửi cho nhà cung cấp tạo license offline. */
  async getLicenseRequest(): Promise<any> {
    return apiFetch('/license/request');
  }

  /** Nhập file license (.lic) — base hoặc add-on — để kích hoạt offline. */
  async importLicense(file: File): Promise<any> {
    const formData = new FormData();
    formData.append('file', file);
    const token = authService.getToken() || localStorage.getItem('station_token');
    const baseUrl = (window as any).__API_BASE__ || '';
    const res = await fetch(`${baseUrl}/api/v1/license/import`, {
      method: 'POST',
      headers: token ? { Authorization: `Bearer ${token}` } : {},
      body: formData,
    });
    if (!res.ok) {
      const err = await res.json().catch(() => ({ message: res.statusText }));
      throw new Error(err.message || 'Import thất bại');
    }
    const data = await res.json();
    clearGetCache();
    return data;
  }

  /** Xóa license hiện tại đang áp dụng trên app. */
  async clearLicense(): Promise<any> {
    return apiMutate('POST', '/license/clear');
  }
}

export const systemService = new SystemService();

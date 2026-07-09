// ============================================================
// LogService.ts — Đọc các loại log hệ thống
// Endpoints: /logs/audit, /logs/login, /logs/notify, /logs/rule-triggers
// Dùng cho trang Audit Log — xem hoạt động người dùng và hệ thống
// Export: logService (singleton), dùng qua StationApiService facade
// ============================================================

import { apiFetch } from './BaseApiService';
import type { AuditLogEntry, LoginLogEntry, NotifyLogEntry, RuleTriggerLogEntry } from '@/types/api.types';

export class LogService {
  /** Log hành động người dùng (tạo/sửa/xóa thiết bị, rule, user...). */
  async getAuditLogs(opts?: { limit?: number; action?: string; from?: string; to?: string; stationId?: string }): Promise<AuditLogEntry[]> {
    const params = new URLSearchParams({ limit: String(opts?.limit ?? 200) });
    if (opts?.action) params.set('action', opts.action);
    if (opts?.from) params.set('from', opts.from);
    if (opts?.to) params.set('to', opts.to);
    if (opts?.stationId) params.set('stationId', opts.stationId);
    return apiFetch(`/logs/audit?${params}`);
  }

  /** Lịch sử đăng nhập/đăng xuất theo khoảng thời gian. */
  async getLoginLogs(opts?: { limit?: number; from?: string; to?: string; stationId?: string }): Promise<LoginLogEntry[]> {
    const params = new URLSearchParams();
    if (opts?.limit) params.set('limit', String(opts.limit));
    if (opts?.from) params.set('from', opts.from);
    if (opts?.to)   params.set('to', opts.to);
    if (opts?.stationId) params.set('stationId', opts.stationId);
    const q = params.toString() ? `?${params}` : '';
    return apiFetch(`/logs/login${q}`);
  }

  /** Log gửi thông báo (email/SMS) từ rule engine. */
  async getNotifyLogs(opts?: { limit?: number; from?: string; to?: string; stationId?: string }): Promise<NotifyLogEntry[]> {
    const params = new URLSearchParams();
    if (opts?.limit) params.set('limit', String(opts.limit));
    if (opts?.from) params.set('from', opts.from);
    if (opts?.to)   params.set('to', opts.to);
    if (opts?.stationId) params.set('stationId', opts.stationId);
    const q = params.toString() ? `?${params}` : '';
    return apiFetch(`/logs/notify${q}`);
  }

  /** Log các lần rule được kích hoạt (trigger) — dùng để debug rule engine. */
  async getRuleTriggerLogs(opts?: { limit?: number; from?: string; to?: string; stationId?: string }): Promise<RuleTriggerLogEntry[]> {
    const params = new URLSearchParams();
    if (opts?.limit) params.set('limit', String(opts.limit));
    if (opts?.from) params.set('from', opts.from);
    if (opts?.to)   params.set('to', opts.to);
    if (opts?.stationId) params.set('stationId', opts.stationId);
    const q = params.toString() ? `?${params}` : '';
    return apiFetch(`/logs/rule-triggers${q}`);
  }
}

export const logService = new LogService();

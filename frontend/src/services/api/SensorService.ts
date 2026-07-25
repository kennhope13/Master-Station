// ============================================================
// SensorService.ts — Đọc dữ liệu cảm biến (nhiệt độ, PD, camera...)
// Endpoints: GET /points (latest), GET /history (single), GET /history/bulk
// Export: sensorService (singleton), dùng qua StationApiService facade
// ============================================================

import { apiFetch, apiMutate } from './BaseApiService';
import type { SensorPoint } from '@/types/api.types';

export class SensorService {
  /** Lấy giá trị mới nhất của tất cả cảm biến trong trạm. Dùng cho dashboard realtime. */
  async getLatestPoints(stationId?: string): Promise<SensorPoint[]> {
    const query = stationId ? `?stationId=${stationId}` : '';
    return apiFetch<SensorPoint[]>(`/points${query}`);
  }

  /** Lịch sử một cảm biến cụ thể — dùng cho biểu đồ chi tiết từng điểm đo. */
  async getHistory(
    deviceId: string,
    pointId: string,
    from?: string,
    to?: string,
    limit = 500
  ): Promise<Array<{ time: string; value: number; quality: number }>> {
    const params = new URLSearchParams({ deviceId, pointId, limit: String(limit) });
    if (from) params.set('from', from);
    if (to) params.set('to', to);
    return apiFetch(`/history?${params}`);
  }

  /**
   * Lịch sử nhiều cảm biến cùng lúc — dùng cho ExportTab và Analytics.
   * intervalMinutes=0 trả về raw (tất cả mẫu), >0 thì downsample theo khoảng.
   * Response đã normalize camelCase (pointId/time/value) từ backend PascalCase.
   */
  async getHistoryBulk(
    stationId: string,
    from: string,
    to: string,
    intervalMinutes = 5,
    pointIds?: string[],
    deviceId?: string
  ): Promise<Array<{ pointId: string; time: string; value: number; deviceId?: string }>> {
    const params = new URLSearchParams({
      stationId, from, to,
      intervalMinutes: String(intervalMinutes)
    });
    if (pointIds && pointIds.length) {
      params.set('pointIds', pointIds.join(','));
    }
    if (deviceId) {
      params.set('deviceId', deviceId);
    }
    const data = await apiFetch<any[]>(`/history/bulk?${params}`);
    return data.map(item => ({
      pointId: item.pointId || item.PointId,
      time:    item.time    || item.Time,
      value:   item.value !== undefined ? item.value : item.Value,
      deviceId: item.deviceId || item.DeviceId
    }));
  }

  /** Xóa thủ công lịch sử dữ liệu cảm biến */
  async cleanupHistory(days: number): Promise<{ success: boolean; deletedCount: number; message: string }> {
    return apiMutate<{ success: boolean; deletedCount: number; message: string }>(
      'POST',
      `/measurements/cleanup?days=${days}`
    );
  }
}

export const sensorService = new SensorService();

// ============================================================
// IRealtimeNotifier — Interface để Workers push data realtime
// Triển khai trong Api (SignalR), inject vào Workers
// Tách biệt để tránh circular dependency Api ↔ Workers
// ============================================================

namespace StationOS.Services;

public interface IRealtimeNotifier
{
    Task SendSensorUpdateAsync(object payload);
    Task SendAlertAsync(object alert);
    Task SendAlertUpdatedAsync(object alert);
    Task SendDeviceStatusAsync(Guid deviceId, string status);
    Task SendCameraEventAsync(object evt);
    Task SendMetadataAsync(Guid cameraId, long frameTs, object items);
    Task SendStationStatusAsync(Guid stationId, string status, DateTime? lastSeenAt = null, string? reason = null);
    Task SendStationDataReceivedAsync(Guid stationId, string stationName, int sensorCount, int alertCount, int eventCount, DateTime receivedAt);
    Task SendStationListChangedAsync(string action, Guid stationId);
    Task SendDeviceListChangedAsync(string action, Guid stationId, Guid deviceId);
    Task SendMaintenanceChangedAsync(string action, Guid stationId);
    Task SendRuleListChangedAsync(string action, Guid stationId);
}

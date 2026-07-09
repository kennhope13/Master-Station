// ============================================================
// SignalRNotifier — Triển khai IRealtimeNotifier qua SignalR
// Inject vào Workers để push data realtime về frontend
// ============================================================

using Microsoft.AspNetCore.SignalR;
using StationOS.Services;

namespace StationOS.Api.Hubs;

public class SignalRNotifier : IRealtimeNotifier
{
    private readonly IHubContext<RealtimeHub> _hub;

    public SignalRNotifier(IHubContext<RealtimeHub> hub) => _hub = hub;

    /// <summary>
    /// Broadcast dữ liệu cảm biến mới nhất tới tất cả client SignalR đang kết nối.
    /// Event: "SensorUpdate"
    /// </summary>
    public Task SendSensorUpdateAsync(object payload)
        => _hub.Clients.All.SendAsync("SensorUpdate", payload);

    /// <summary>
    /// Broadcast cảnh báo mới tới tất cả client SignalR.
    /// Event: "AlertNew"
    /// </summary>
    public Task SendAlertAsync(object alert)
        => _hub.Clients.All.SendAsync("AlertNew", alert);

    /// <summary>
    /// Broadcast trạng thái cập nhật của cảnh báo (ack/close/video/ảnh) tới tất cả client.
    /// Event: "AlertUpdated"
    /// </summary>
    public Task SendAlertUpdatedAsync(object alert)
        => _hub.Clients.All.SendAsync("AlertUpdated", alert);

    /// <summary>
    /// Broadcast trạng thái kết nối thiết bị (online/offline) tới tất cả client.
    /// Event: "DeviceStatus"
    /// </summary>
    public Task SendDeviceStatusAsync(Guid deviceId, string status)
        => _hub.Clients.All.SendAsync("DeviceStatus", new { deviceId, status });

    /// <summary>
    /// Broadcast sự kiện phát hiện từ camera (bắt đầu, kết thúc, boundary thay đổi...) tới tất cả client.
    /// Event: "CameraEvent"
    /// </summary>
    public Task SendCameraEventAsync(object evt)
        => _hub.Clients.All.SendAsync("CameraEvent", evt);

    /// <summary>
    /// Broadcast metadata khung hình realtime (bounding box, polygon overlay) từ AI Engine tới tất cả client.
    /// Event: "CameraMetadata"
    /// </summary>
    public Task SendMetadataAsync(Guid cameraId, long frameTs, object items)
        => _hub.Clients.All.SendAsync("CameraMetadata", new { cameraId, frameTs, items });

    /// <summary>
    /// Broadcast trạng thái kết nối của trạm cục bộ tới UI đa trạm.
    /// Event: "StationStatusChanged"
    /// </summary>
    public Task SendStationStatusAsync(Guid stationId, string status, DateTime? lastSeenAt = null, string? reason = null)
        => _hub.Clients.All.SendAsync("StationStatusChanged", new
        {
            stationId,
            status,
            lastSeenAt,
            reason,
            changedAt = DateTime.UtcNow
        });

    /// <summary>
    /// Broadcast khi trạm cục bộ vừa đẩy thêm dữ liệu lên trạm trung tâm.
    /// Event: "StationDataReceived"
    /// </summary>
    public Task SendStationDataReceivedAsync(Guid stationId, string stationName, int sensorCount, int alertCount, int eventCount, DateTime receivedAt)
        => _hub.Clients.All.SendAsync("StationDataReceived", new
        {
            stationId,
            stationName,
            sensorCount,
            alertCount,
            eventCount,
            receivedAt
        });

    public Task SendStationListChangedAsync(string action, Guid stationId)
        => _hub.Clients.All.SendAsync("StationListChanged", new { action, stationId });

    public Task SendDeviceListChangedAsync(string action, Guid stationId, Guid deviceId)
        => _hub.Clients.All.SendAsync("DeviceListChanged", new { action, stationId, deviceId });

    public Task SendMaintenanceChangedAsync(string action, Guid stationId)
        => _hub.Clients.All.SendAsync("MaintenanceChanged", new { action, stationId });

    public Task SendRuleListChangedAsync(string action, Guid stationId)
        => _hub.Clients.All.SendAsync("RuleListChanged", new { action, stationId });

    public Task SendAuditLogListChangedAsync(string action, Guid stationId)
        => _hub.Clients.All.SendAsync("AuditLogListChanged", new { action, stationId });
}

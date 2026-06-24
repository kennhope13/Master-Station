using System.Globalization;
using System.Net.Http.Json;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Configuration;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.Hosting;
using Microsoft.Extensions.Logging;
using StationOS.Data;
using StationOS.Data.Entities;
using StationOS.Services;

namespace StationOS.Workers.Polling;

/// <summary>
/// Trạm con kéo lịch bảo trì do trạm tổng tạo về DB local.
/// Chỉ chạy khi cấu hình CentralServer và StationId.
/// </summary>
public class CentralTaskPullWorker : BackgroundService
{
    private readonly IServiceScopeFactory _scopeFactory;
    private readonly ILogger<CentralTaskPullWorker> _logger;
    private readonly IHttpClientFactory _httpClientFactory;
    private readonly IRealtimeNotifier _notifier;
    private readonly string? _centralUrl;
    private readonly string? _stationId;

    private DateTime? _lastSuccessfulPullAt;

    private const int IntervalMs = 30_000;

    public CentralTaskPullWorker(
        IServiceScopeFactory scopeFactory,
        ILogger<CentralTaskPullWorker> logger,
        IHttpClientFactory httpClientFactory,
        IRealtimeNotifier notifier,
        IConfiguration configuration)
    {
        _scopeFactory = scopeFactory;
        _logger = logger;
        _httpClientFactory = httpClientFactory;
        _notifier = notifier;
        _centralUrl = configuration["CentralServer"]?.TrimEnd('/');
        _stationId = configuration["StationId"];
    }

    protected override async Task ExecuteAsync(CancellationToken stoppingToken)
    {
        if (string.IsNullOrWhiteSpace(_centralUrl))
        {
            _logger.LogInformation("[CentralTaskPull] CentralServer chưa cấu hình — worker không chạy");
            return;
        }

        if (string.IsNullOrWhiteSpace(_stationId))
        {
            _logger.LogWarning("[CentralTaskPull] StationId chưa cấu hình — không thể pull lịch bảo trì");
            return;
        }

        _logger.LogInformation("[CentralTaskPull] Khởi động, pull task từ trạm tổng: {Url}", _centralUrl);

        await Task.Delay(15_000, stoppingToken);

        while (!stoppingToken.IsCancellationRequested)
        {
            try
            {
                await PullTasksAsync(stoppingToken);
            }
            catch (Exception ex)
            {
                _logger.LogError(ex, "[CentralTaskPull] Lỗi pull maintenance tasks");
            }

            await Task.Delay(IntervalMs, stoppingToken);
        }
    }

    private async Task PullTasksAsync(CancellationToken ct)
    {
        var client = _httpClientFactory.CreateClient();
        client.DefaultRequestHeaders.Add("X-Station-Id", _stationId);
        client.Timeout = TimeSpan.FromSeconds(15);

        var url = $"{_centralUrl}/api/v1/ingest/tasks";
        if (_lastSuccessfulPullAt.HasValue)
        {
            var since = Uri.EscapeDataString(_lastSuccessfulPullAt.Value.ToString("O", CultureInfo.InvariantCulture));
            url = $"{url}?since={since}";
        }

        var pulled = await client.GetFromJsonAsync<List<CentralMaintenanceTaskDto>>(url, ct) ?? [];
        _lastSuccessfulPullAt = DateTime.UtcNow;

        if (pulled.Count == 0)
            return;

        using var scope = _scopeFactory.CreateScope();
        var db = scope.ServiceProvider.GetRequiredService<AppDbContext>();

        var changedStationIds = new HashSet<Guid>();
        var created = 0;
        var updated = 0;

        foreach (var remote in pulled)
        {
            if (remote.Id == Guid.Empty)
                continue;

            var local = await db.MaintenanceTasks.FirstOrDefaultAsync(t => t.Id == remote.Id, ct);
            if (local == null)
            {
                db.MaintenanceTasks.Add(new MaintenanceTask
                {
                    Id = remote.Id,
                    StationId = remote.StationId,
                    DeviceId = remote.DeviceId,
                    DeviceNameSnapshot = remote.DeviceName,
                    Title = remote.Title ?? string.Empty,
                    Type = remote.Type ?? "inspection",
                    ScheduledDate = remote.ScheduledDate,
                    AssignedTo = remote.AssignedTo,
                    Status = remote.Status ?? "pending",
                    Checklist = remote.Checklist,
                    Notes = remote.Notes,
                    CreatedAt = remote.CreatedAt == default ? DateTime.UtcNow : remote.CreatedAt,
                    CompletedAt = remote.CompletedAt,
                    SyncSource = "central",
                    SyncedToStationAt = DateTime.UtcNow,
                });
                created++;
                changedStationIds.Add(remote.StationId);
                continue;
            }

            var changed = false;
            if (local.StationId != remote.StationId) { local.StationId = remote.StationId; changed = true; }
            if (local.DeviceId != remote.DeviceId) { local.DeviceId = remote.DeviceId; changed = true; }
            if (local.DeviceNameSnapshot != remote.DeviceName) { local.DeviceNameSnapshot = remote.DeviceName; changed = true; }
            if (local.Title != (remote.Title ?? string.Empty)) { local.Title = remote.Title ?? string.Empty; changed = true; }
            if (local.Type != (remote.Type ?? "inspection")) { local.Type = remote.Type ?? "inspection"; changed = true; }
            if (local.ScheduledDate != remote.ScheduledDate) { local.ScheduledDate = remote.ScheduledDate; changed = true; }
            if (local.AssignedTo != remote.AssignedTo) { local.AssignedTo = remote.AssignedTo; changed = true; }
            if (local.Status != (remote.Status ?? "pending")) { local.Status = remote.Status ?? "pending"; changed = true; }
            if (local.Checklist != remote.Checklist) { local.Checklist = remote.Checklist; changed = true; }
            if (local.Notes != remote.Notes) { local.Notes = remote.Notes; changed = true; }
            if (local.CompletedAt != remote.CompletedAt) { local.CompletedAt = remote.CompletedAt; changed = true; }
            if (local.SyncSource != "central") { local.SyncSource = "central"; changed = true; }

            if (remote.CreatedAt != default)
            {
                if (local.CreatedAt != remote.CreatedAt)
                {
                    local.CreatedAt = remote.CreatedAt;
                    changed = true;
                }
            }

            local.SyncedToStationAt = DateTime.UtcNow;

            if (changed)
            {
                updated++;
                changedStationIds.Add(local.StationId);
            }
        }

        if (created == 0 && updated == 0)
            return;

        await db.SaveChangesAsync(ct);

        foreach (var stationId in changedStationIds)
            await _notifier.SendMaintenanceChangedAsync("synced", stationId);

        _logger.LogInformation("[CentralTaskPull] Đồng bộ {Created} mới, {Updated} cập nhật maintenance tasks", created, updated);
    }
    private sealed class CentralMaintenanceTaskDto
    {
        public Guid Id { get; set; }
        public Guid StationId { get; set; }
        public Guid? DeviceId { get; set; }
        public string? DeviceName { get; set; }
        public string? Title { get; set; }
        public string? Type { get; set; }
        public string? Status { get; set; }
        public string? AssignedTo { get; set; }
        public string? Notes { get; set; }
        public string? Checklist { get; set; }
        public DateTime ScheduledDate { get; set; }
        public DateTime CreatedAt { get; set; }
        public DateTime? CompletedAt { get; set; }
    }
}

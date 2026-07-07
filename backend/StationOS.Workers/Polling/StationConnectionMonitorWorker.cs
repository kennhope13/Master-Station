using System.Collections.Concurrent;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.Hosting;
using Microsoft.Extensions.Logging;
using StationOS.Data;
using StationOS.Services;

namespace StationOS.Workers.Polling;

public class StationConnectionMonitorWorker : BackgroundService
{
    private readonly IServiceScopeFactory _scopeFactory;
    private readonly IHttpClientFactory _httpClientFactory;
    private readonly IRealtimeNotifier _notifier;
    private readonly ILogger<StationConnectionMonitorWorker> _logger;
    private readonly ConcurrentDictionary<Guid, string> _lastStatusByStation = new();

    private const int StartupDelayMs = 3_000;
    private const int IntervalMs = 5_000;
    public StationConnectionMonitorWorker(
        IServiceScopeFactory scopeFactory,
        IHttpClientFactory httpClientFactory,
        IRealtimeNotifier notifier,
        ILogger<StationConnectionMonitorWorker> logger)
    {
        _scopeFactory = scopeFactory;
        _httpClientFactory = httpClientFactory;
        _notifier = notifier;
        _logger = logger;
    }

    protected override async Task ExecuteAsync(CancellationToken stoppingToken)
    {
        await Task.Delay(StartupDelayMs, stoppingToken);

        while (!stoppingToken.IsCancellationRequested)
        {
            try
            {
                await CheckStationsAsync(stoppingToken);
            }
            catch (Exception ex)
            {
                _logger.LogWarning(ex, "[StationMonitor] Lỗi khi kiểm tra trạng thái trạm con");
            }

            await Task.Delay(IntervalMs, stoppingToken);
        }
    }

    private async Task CheckStationsAsync(CancellationToken ct)
    {
        using var scope = _scopeFactory.CreateScope();
        var db = scope.ServiceProvider.GetRequiredService<AppDbContext>();

        var stations = await db.Stations
            .Where(s => s.Status == "active" && s.ApiUrl != null && s.ApiUrl != "")
            .ToListAsync(ct);

        foreach (var station in stations)
        {
            var (status, reason) = await ProbeStationAsync(station.ApiUrl!, ct);
            var lastSeenAt = await GetLastSeenAtAsync(db, station.Id, ct);

            if (status == "online")
            {
                var observedAt = DateTime.UtcNow;
                if (!station.LastContactAt.HasValue || observedAt > station.LastContactAt.Value)
                {
                    station.LastContactAt = observedAt;
                    await db.SaveChangesAsync(ct);
                }
            }

            if (_lastStatusByStation.TryGetValue(station.Id, out var previous) && previous == status)
                continue;

            _lastStatusByStation[station.Id] = status;
            _logger.LogInformation("[StationMonitor] {Name} => {Status} ({Reason})", station.Name, status, reason ?? "n/a");
            await _notifier.SendStationStatusAsync(station.Id, status, lastSeenAt, reason);
        }
    }

    private async Task<(string Status, string? Reason)> ProbeStationAsync(string apiUrl, CancellationToken ct)
    {
        try
        {
            var client = _httpClientFactory.CreateClient("station-ping");
            using var response = await client.GetAsync($"{apiUrl.TrimEnd('/')}/health", ct);
            return response.IsSuccessStatusCode
                ? ("online", null)
                : ("offline", $"http_{(int)response.StatusCode}");
        }
        catch (Exception ex)
        {
            return ("offline", ex.GetType().Name);
        }
    }

    private static async Task<DateTime?> GetLastSeenAtAsync(AppDbContext db, Guid stationId, CancellationToken ct)
    {
        var lastSensor = await db.SensorReadings
            .Where(x => x.StationId == stationId)
            .MaxAsync(x => (DateTime?)x.Time, ct);

        var lastAlert = await db.Alerts
            .Where(x => x.StationId == stationId)
            .MaxAsync(x => (DateTime?)x.TriggeredAt, ct);

        var lastEvent = await db.DetectionEvents
            .Where(x => x.StationId == stationId)
            .MaxAsync(x => (DateTime?)x.DetectedAt, ct);

        return new[] { lastSensor, lastAlert, lastEvent }.Max();
    }
}

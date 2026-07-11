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
    private const int StartupDelayMs = 500;
    private const int IntervalMs = 2_000;
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

        var stationIds = await db.Stations
            .Where(s => s.Status == "active" && s.ApiUrl != null && s.ApiUrl != "")
            .Select(s => s.Id)
            .ToListAsync(ct);

        // Mỗi trạm có scope/DbContext riêng để một trạm timeout không làm chậm
        // việc phát hiện mất/kết nối lại của các trạm còn lại.
        await Task.WhenAll(stationIds.Select(id => CheckStationAsync(id, ct)));
    }

    private async Task CheckStationAsync(Guid stationId, CancellationToken ct)
    {
        using var scope = _scopeFactory.CreateScope();
        var db = scope.ServiceProvider.GetRequiredService<AppDbContext>();
        var station = await db.Stations.FindAsync([stationId], ct);
        if (station?.ApiUrl == null) return;

        var (status, reason) = await ProbeStationAsync(station.ApiUrl, ct);
        var previousStatus = station.ConnectionStatus;
        var statusChanged = !string.Equals(previousStatus, status, StringComparison.OrdinalIgnoreCase);
        var observedAt = DateTime.UtcNow;

        if (status == "online")
            station.LastContactAt = observedAt;

        station.ConnectionStatus = status;
        if (statusChanged)
            station.ConnectionStatusChangedAt = observedAt;

        await db.SaveChangesAsync(ct);

        if (!statusChanged) return;

        _logger.LogInformation("[StationMonitor] {Name} => {Status} ({Reason})", station.Name, status, reason ?? "n/a");
        await _notifier.SendStationStatusAsync(station.Id, status, station.LastContactAt, reason);
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

}

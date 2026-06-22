// ============================================================
// ReportSchedulerWorker — Hangfire job: tạo daily report 00:05
// Đăng ký trong Program.cs với RecurringJob
// ============================================================

using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.Logging;
using StationOS.Data;
using StationOS.Services.Reports;

namespace StationOS.Workers.Polling;

public class ReportSchedulerWorker
{
    private readonly ReportGeneratorService _generator;
    private readonly IServiceScopeFactory   _scopeFactory;
    private readonly ILogger<ReportSchedulerWorker> _logger;

    public ReportSchedulerWorker(
        ReportGeneratorService generator,
        IServiceScopeFactory scopeFactory,
        ILogger<ReportSchedulerWorker> logger)
    {
        _generator    = generator;
        _scopeFactory = scopeFactory;
        _logger       = logger;
    }

    /// <summary>Chạy mỗi ngày lúc 00:05 — tự tạo daily report ngày hôm qua</summary>
    public async Task GenerateDailyAsync()
    {
        _logger.LogInformation("[ReportScheduler] Bắt đầu tạo báo cáo ngày hôm qua");
        try
        {
            using var scope = _scopeFactory.CreateScope();
            var db = scope.ServiceProvider.GetRequiredService<AppDbContext>();
            var stations = await db.Stations.Where(s => s.Status == "active").ToListAsync();

            var yesterday = DateTime.UtcNow.Date.AddDays(-1);
            var from = yesterday;
            var to   = yesterday.AddDays(1).AddSeconds(-1);

            foreach (var station in stations)
            {
                var opts = new ReportOptions(station.Id, "station", null, null, station.Name, "daily", from, to);
                var report = await _generator.GenerateAsync(opts);
                _logger.LogInformation("[ReportScheduler] Đã tạo báo cáo {Id} cho trạm {Station}", report.Id, station.Name);
            }
        }
        catch (Exception ex)
        {
            _logger.LogError(ex, "[ReportScheduler] Lỗi khi tạo báo cáo tự động");
        }
    }
}

// ============================================================
// IngestController — Nhận data từ trạm con đẩy lên trạm tổng
// POST /api/v1/ingest/alerts   — Nhận alert từ trạm con
// POST /api/v1/ingest/sensors  — Nhận sensor readings từ trạm con
// POST /api/v1/ingest/events   — Nhận detection events từ trạm con
//
// Auth: Header X-Station-Id (Guid của trạm con — phải tồn tại trong DB)
// ============================================================

using Microsoft.AspNetCore.Mvc;
using Microsoft.EntityFrameworkCore;
using StationOS.Data;
using StationOS.Data.Entities;
using StationOS.Services;

namespace StationOS.Api.Controllers;

[ApiController]
[Route("api/v1/ingest")]
public class IngestController : ControllerBase
{
    private readonly AppDbContext _db;
    private readonly IRealtimeNotifier _notifier;
    private readonly ILogger<IngestController> _logger;

    public IngestController(AppDbContext db, IRealtimeNotifier notifier, ILogger<IngestController> logger)
    {
        _db = db;
        _notifier = notifier;
        _logger = logger;
    }

    // ── Xác thực trạm con ────────────────────────────────────
    private async Task<Station?> AuthenticateStationAsync()
    {
        if (!Request.Headers.TryGetValue("X-Station-Id", out var raw) ||
            !Guid.TryParse(raw, out var stationId))
            return null;

        return await _db.Stations.FirstOrDefaultAsync(s => s.Id == stationId && s.Status == "active");
    }

    private async Task MarkStationOnlineAsync(Station station, string? reason = null)
    {
        var lastSeenAt = DateTime.UtcNow;
        await _notifier.SendStationStatusAsync(station.Id, "online", lastSeenAt, reason);
    }

    // ── POST /api/v1/ingest/alerts ───────────────────────────
    /// <summary>Trạm con đẩy danh sách alert lên trạm tổng để hiển thị tập trung.</summary>
    [HttpPost("alerts")]
    public async Task<IActionResult> IngestAlerts([FromBody] List<IngestAlertDto> items, CancellationToken ct)
    {
        var station = await AuthenticateStationAsync();
        if (station == null) return Unauthorized(new { message = "X-Station-Id không hợp lệ" });

        int saved = 0;
        foreach (var dto in items)
        {
            // Bỏ qua nếu alert này đã tồn tại (idempotent)
            if (await _db.Alerts.AnyAsync(a => a.Id == dto.Id, ct)) continue;

            var alert = new Alert
            {
                Id          = dto.Id,
                StationId   = station.Id,
                Source      = dto.Source ?? "station_push",
                Level       = dto.Level,
                Status      = dto.Status ?? "open",
                Message     = dto.Message,
                Value       = dto.Value,
                TriggeredAt = dto.TriggeredAt,
            };
            _db.Alerts.Add(alert);
            saved++;
        }

        await _db.SaveChangesAsync(ct);
        await MarkStationOnlineAsync(station, "alerts_ingest");
        await _notifier.SendStationDataReceivedAsync(station.Id, station.Name, 0, items.Count, 0, DateTime.UtcNow);
        if (saved > 0)
            await _notifier.SendAlertAsync(new { stationId = station.Id, count = saved, message = $"[{station.Name}] {saved} cảnh báo mới" });

        _logger.LogInformation("[Ingest] Trạm {Name}: nhận {Saved}/{Total} alerts", station.Name, saved, items.Count);
        return Ok(new { received = items.Count, saved });
    }

    // ── POST /api/v1/ingest/sensors ──────────────────────────
    /// <summary>Trạm con đẩy sensor readings lên trạm tổng.</summary>
    [HttpPost("sensors")]
    public async Task<IActionResult> IngestSensors([FromBody] List<IngestSensorDto> items, CancellationToken ct)
    {
        var station = await AuthenticateStationAsync();
        if (station == null) return Unauthorized(new { message = "X-Station-Id không hợp lệ" });

        var payload = new List<object>(items.Count);
        foreach (var dto in items)
        {
            var time = dto.Time == default ? DateTime.UtcNow : dto.Time;
            var qualityCode = dto.Quality == "good" ? 0 : dto.Quality == "bad" ? 1 : 2;
            _db.SensorReadings.Add(new SensorReading
            {
                Id        = dto.Id == Guid.Empty ? Guid.NewGuid() : dto.Id,
                StationId = station.Id,
                DeviceId  = dto.DeviceId,
                PointId   = dto.PointId,
                Value     = dto.Value,
                Unit      = dto.Unit,
                Quality   = (short)qualityCode,
                Time      = time,
            });

            payload.Add(new
            {
                stationId = station.Id,
                deviceId = dto.DeviceId,
                pointId = dto.PointId,
                value = dto.Value,
                unit = dto.Unit,
                quality = qualityCode,
                time
            });
        }

        await _db.SaveChangesAsync(ct);
        await MarkStationOnlineAsync(station, "sensors_ingest");
        await _notifier.SendSensorUpdateAsync(payload);
        await _notifier.SendStationDataReceivedAsync(station.Id, station.Name, items.Count, 0, 0, DateTime.UtcNow);
        _logger.LogInformation("[Ingest] Trạm {Name}: nhận {Count} sensor readings", station.Name, items.Count);
        return Ok(new { received = items.Count });
    }

    // ── POST /api/v1/ingest/events ───────────────────────────
    /// <summary>Trạm con đẩy detection events (AI) lên trạm tổng.</summary>
    [HttpPost("events")]
    public async Task<IActionResult> IngestEvents([FromBody] List<IngestEventDto> items, CancellationToken ct)
    {
        var station = await AuthenticateStationAsync();
        if (station == null) return Unauthorized(new { message = "X-Station-Id không hợp lệ" });

        int saved = 0;
        foreach (var dto in items)
        {
            if (await _db.DetectionEvents.AnyAsync(e => e.Id == dto.Id, ct)) continue;

            _db.DetectionEvents.Add(new DetectionEvent
            {
                Id            = dto.Id,
                StationId     = station.Id,
                CameraId      = dto.CameraId,
                Source        = dto.Source ?? "station_push",
                DetectionType = dto.DetectionType ?? "unknown",
                Confidence    = dto.Confidence,
                BoundingBoxes = dto.BoundingBoxes ?? "[]",
                Metadata      = dto.Metadata,
                DetectedAt    = dto.DetectedAt == default ? DateTime.UtcNow : dto.DetectedAt,
            });
            saved++;
        }

        await _db.SaveChangesAsync(ct);
        await MarkStationOnlineAsync(station, "events_ingest");
        await _notifier.SendStationDataReceivedAsync(station.Id, station.Name, 0, 0, items.Count, DateTime.UtcNow);
        _logger.LogInformation("[Ingest] Trạm {Name}: nhận {Saved}/{Total} events", station.Name, saved, items.Count);
        return Ok(new { received = items.Count, saved });
    }

    // ── GET /api/v1/ingest/ping ──────────────────────────────
    /// <summary>Trạm con kiểm tra kết nối đến trạm tổng.</summary>
    [HttpGet("ping")]
    public async Task<IActionResult> Ping()
    {
        var station = await AuthenticateStationAsync();
        if (station == null) return Unauthorized(new { message = "X-Station-Id không hợp lệ" });
        return Ok(new { ok = true, stationName = station.Name, serverTime = DateTime.UtcNow });
    }
}

// ── DTOs ─────────────────────────────────────────────────────
public record IngestAlertDto(
    Guid Id, string Level, string? Status, string? Source,
    string? Message, double? Value, DateTime TriggeredAt);

public record IngestSensorDto(
    Guid Id, Guid DeviceId, string PointId, double Value,
    string? Unit, string? Quality, DateTime Time);

public record IngestEventDto(
    Guid Id, Guid CameraId, string? Source, string? DetectionType,
    float Confidence, string? BoundingBoxes, string? Metadata, DateTime DetectedAt);

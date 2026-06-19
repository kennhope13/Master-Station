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
        station.LastContactAt = lastSeenAt;
        await _db.SaveChangesAsync();
        await _notifier.SendStationStatusAsync(station.Id, "online", lastSeenAt, reason);
    }

    // ── POST /api/v1/ingest/alerts ───────────────────────────
    /// <summary>Trạm con đẩy danh sách alert lên trạm tổng. Hỗ trợ cả camelCase và snake_case.</summary>
    [HttpPost("alerts")]
    public async Task<IActionResult> IngestAlerts([FromBody] List<System.Text.Json.JsonElement> items, CancellationToken ct)
    {
        var station = await AuthenticateStationAsync();
        if (station == null) return Unauthorized(new { message = "X-Station-Id không hợp lệ" });

        static string? Str(System.Text.Json.JsonElement e, string camel, string snake)
        {
            if (e.TryGetProperty(camel, out var v) && v.ValueKind == System.Text.Json.JsonValueKind.String) return v.GetString();
            if (e.TryGetProperty(snake, out var v2) && v2.ValueKind == System.Text.Json.JsonValueKind.String) return v2.GetString();
            return null;
        }
        static bool TryGuid(System.Text.Json.JsonElement e, string camel, string snake, out Guid result)
        {
            if (e.TryGetProperty(camel, out var v) && v.TryGetGuid(out result)) return true;
            if (e.TryGetProperty(snake, out var v2) && v2.TryGetGuid(out result)) return true;
            result = Guid.Empty; return false;
        }

        int saved = 0;
        foreach (var elem in items)
        {
            // Lấy ID — bỏ qua nếu đã tồn tại (idempotent)
            TryGuid(elem, "id", "id", out var id);
            if (id != Guid.Empty && await _db.Alerts.AnyAsync(a => a.Id == id, ct)) continue;

            var level = Str(elem, "level", "level") ?? "warning";
            if (string.IsNullOrEmpty(level)) continue;

            TryGuid(elem, "deviceId", "device_id", out var deviceId);
            TryGuid(elem, "ruleId",   "rule_id",   out var ruleId);

            double? value = null;
            if (elem.TryGetProperty("value", out var vEl) && vEl.ValueKind == System.Text.Json.JsonValueKind.Number)
                value = vEl.GetDouble();

            DateTime triggeredAt = DateTime.UtcNow;
            if (elem.TryGetProperty("triggeredAt", out var tEl) && tEl.TryGetDateTime(out var td)) triggeredAt = td;
            else if (elem.TryGetProperty("triggered_at", out var tEl2) && tEl2.TryGetDateTime(out var td2)) triggeredAt = td2;

            var alert = new Alert
            {
                Id           = id == Guid.Empty ? Guid.NewGuid() : id,
                StationId    = station.Id,
                DeviceId     = deviceId == Guid.Empty ? null : deviceId,
                RuleId       = ruleId   == Guid.Empty ? null : ruleId,
                Source       = Str(elem, "source",       "source")        ?? "station_push",
                Level        = level,
                Status       = Str(elem, "status",       "status")        ?? "open",
                Message      = Str(elem, "message",      "message"),
                Value        = value,
                TriggeredAt  = triggeredAt,
                ImageUrl     = Str(elem, "imageUrl",     "image_url"),
                ThumbnailUrl = Str(elem, "thumbnailUrl", "thumbnail_url"),
                VideoUrl     = Str(elem, "videoUrl",     "video_url"),
            };
            _db.Alerts.Add(alert);
            saved++;
        }

        await _db.SaveChangesAsync(ct);
        await MarkStationOnlineAsync(station, "alerts_ingest");
        await _notifier.SendStationDataReceivedAsync(station.Id, station.Name, 0, saved, 0, DateTime.UtcNow);
        if (saved > 0)
            await _notifier.SendAlertAsync(new { stationId = station.Id, count = saved, message = $"[{station.Name}] {saved} cảnh báo mới" });

        _logger.LogInformation("[Ingest] Trạm {Name}: nhận {Saved}/{Total} alerts", station.Name, saved, items.Count);
        return Ok(new { received = items.Count, saved });
    }

    // ── POST /api/v1/ingest/sensors ──────────────────────────
    /// <summary>Trạm con đẩy sensor readings lên trạm tổng. Hỗ trợ cả camelCase và snake_case.</summary>
    [HttpPost("sensors")]
    public async Task<IActionResult> IngestSensors([FromBody] List<System.Text.Json.JsonElement> items, CancellationToken ct)
    {
        var station = await AuthenticateStationAsync();
        if (station == null) return Unauthorized(new { message = "X-Station-Id không hợp lệ" });

        static string? GetStr(System.Text.Json.JsonElement e, string camel, string snake)
        {
            if (e.TryGetProperty(camel, out var v1) && v1.ValueKind == System.Text.Json.JsonValueKind.String) return v1.GetString();
            if (e.TryGetProperty(snake, out var v2) && v2.ValueKind == System.Text.Json.JsonValueKind.String) return v2.GetString();
            return null;
        }
        static bool TryGetGuid(System.Text.Json.JsonElement e, string camel, string snake, out Guid result)
        {
            if (e.TryGetProperty(camel, out var v1) && v1.TryGetGuid(out result)) return true;
            if (e.TryGetProperty(snake, out var v2) && v2.TryGetGuid(out result)) return true;
            result = Guid.Empty; return false;
        }

        var payload = new List<object>(items.Count);
        int saved = 0;
        foreach (var elem in items)
        {
            if (!TryGetGuid(elem, "deviceId", "device_id", out var deviceId)) continue;
            var pointId = GetStr(elem, "pointId", "point_id");
            if (string.IsNullOrEmpty(pointId)) continue;

            TryGetGuid(elem, "id", "id", out var id);
            var value = elem.TryGetProperty("value", out var vEl) && vEl.TryGetDouble(out var vv) ? vv : 0.0;
            var unit  = GetStr(elem, "unit", "unit");
            var time  = elem.TryGetProperty("time", out var tEl) && tEl.TryGetDateTime(out var td) ? td : DateTime.UtcNow;
            int qualityCode = 2;
            if (elem.TryGetProperty("quality", out var qEl))
            {
                qualityCode = qEl.ValueKind == System.Text.Json.JsonValueKind.Number ? qEl.GetInt32() :
                              qEl.ValueKind == System.Text.Json.JsonValueKind.String
                                  ? (qEl.GetString() == "good" ? 0 : qEl.GetString() == "bad" ? 1 : 2) : 2;
            }

            _db.SensorReadings.Add(new SensorReading
            {
                Id        = id == Guid.Empty ? Guid.NewGuid() : id,
                StationId = station.Id,
                DeviceId  = deviceId,
                PointId   = pointId,
                Value     = value,
                Unit      = unit,
                Quality   = (short)qualityCode,
                Time      = time,
            });
            payload.Add(new { stationId = station.Id, deviceId, pointId, value, unit, quality = qualityCode, time });
            saved++;
        }

        await _db.SaveChangesAsync(ct);
        await MarkStationOnlineAsync(station, "sensors_ingest");
        await _notifier.SendSensorUpdateAsync(payload);
        await _notifier.SendStationDataReceivedAsync(station.Id, station.Name, saved, 0, 0, DateTime.UtcNow);
        _logger.LogInformation("[Ingest] Trạm {Name}: nhận {Count} sensor readings", station.Name, saved);
        return Ok(new { received = saved });
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
public record IngestEventDto(
    Guid Id, Guid CameraId, string? Source, string? DetectionType,
    float Confidence, string? BoundingBoxes, string? Metadata, DateTime DetectedAt);

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
            if (e.TryGetProperty(camel, out var v) && v.ValueKind == System.Text.Json.JsonValueKind.String && v.TryGetGuid(out result)) return true;
            if (e.TryGetProperty(snake, out var v2) && v2.ValueKind == System.Text.Json.JsonValueKind.String && v2.TryGetGuid(out result)) return true;
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

    // ── POST /api/v1/ingest/reports ─────────────────────────
    /// <summary>Nhận danh sách báo cáo từ trạm con.</summary>
    [HttpPost("reports")]
    public async Task<IActionResult> IngestReports([FromBody] List<System.Text.Json.JsonElement> items, CancellationToken ct)
    {
        var station = await AuthenticateStationAsync();
        if (station == null) return Unauthorized(new { message = "X-Station-Id không hợp lệ" });

        // Helper: tìm property theo camelCase hoặc PascalCase
        static bool TryProp(System.Text.Json.JsonElement e, string name, out System.Text.Json.JsonElement val)
        {
            if (e.TryGetProperty(name, out val)) return true;
            var pascal = char.ToUpper(name[0]) + name[1..];
            return e.TryGetProperty(pascal, out val);
        }
        static bool TryGuidProp(System.Text.Json.JsonElement e, string name, out Guid result)
        {
            if (TryProp(e, name, out var v) && v.ValueKind == System.Text.Json.JsonValueKind.String && v.TryGetGuid(out result)) return true;
            result = Guid.Empty; return false;
        }
        static string? StrProp(System.Text.Json.JsonElement e, string name)
        {
            return TryProp(e, name, out var v) && v.ValueKind == System.Text.Json.JsonValueKind.String ? v.GetString() : null;
        }
        static bool TryDateProp(System.Text.Json.JsonElement e, string name, out DateTime result)
        {
            if (TryProp(e, name, out var v) && v.ValueKind != System.Text.Json.JsonValueKind.Null && v.TryGetDateTime(out result)) return true;
            result = default; return false;
        }

        int saved = 0;
        foreach (var elem in items)
        {
            if (!TryGuidProp(elem, "id", out var id)) continue;
            if (await _db.Reports.AnyAsync(r => r.Id == id, ct)) continue;

            var report = new Report { Id = id, StationId = station.Id, ScopeType = "station" };
            report.Type = StrProp(elem, "type") ?? "daily";
            if (TryDateProp(elem, "periodFrom", out var pf)) report.PeriodFrom = pf;
            if (TryDateProp(elem, "periodTo",   out var pt)) report.PeriodTo   = pt;
            report.FileUrl = StrProp(elem, "fileUrl");
            if (TryDateProp(elem, "generatedAt", out var ga)) report.GeneratedAt = ga;
            if (TryGuidProp(elem, "generatedBy", out var gb)) report.GeneratedBy = gb;

            _db.Reports.Add(report);
            saved++;
        }

        await _db.SaveChangesAsync(ct);
        await MarkStationOnlineAsync(station, "reports_ingest");
        _logger.LogInformation("[Ingest] Trạm {Name}: nhận {Saved}/{Total} reports", station.Name, saved, items.Count);
        return Ok(new { received = items.Count, saved });
    }

    // ── POST /api/v1/ingest/audit-logs ──────────────────────
    /// <summary>Nhận audit log từ trạm con.</summary>
    [HttpPost("audit-logs")]
    public async Task<IActionResult> IngestAuditLogs([FromBody] List<System.Text.Json.JsonElement> items, CancellationToken ct)
    {
        var station = await AuthenticateStationAsync();
        if (station == null) return Unauthorized(new { message = "X-Station-Id không hợp lệ" });

        static bool TryPropAL(System.Text.Json.JsonElement e, string name, out System.Text.Json.JsonElement val)
        {
            if (e.TryGetProperty(name, out val)) return true;
            var pascal = char.ToUpper(name[0]) + name[1..];
            return e.TryGetProperty(pascal, out val);
        }
        static bool TryGuidAL(System.Text.Json.JsonElement e, string name, out Guid result)
        {
            if (TryPropAL(e, name, out var v) && v.ValueKind == System.Text.Json.JsonValueKind.String && v.TryGetGuid(out result)) return true;
            result = Guid.Empty; return false;
        }
        static string? StrAL(System.Text.Json.JsonElement e, string name)
            => TryPropAL(e, name, out var v) && v.ValueKind == System.Text.Json.JsonValueKind.String ? v.GetString() : null;

        int saved = 0;
        foreach (var elem in items)
        {
            if (!TryGuidAL(elem, "id", out var id)) continue;
            if (await _db.AuditLogs.AnyAsync(a => a.Id == id, ct)) continue;

            var log = new AuditLog { Id = id, StationId = station.Id };
            log.Action    = StrAL(elem, "action") ?? "";
            log.EntityType = StrAL(elem, "entityType");
            if (TryGuidAL(elem, "entityId", out var eidv)) log.EntityId = eidv;
            if (TryGuidAL(elem, "userId",   out var uidv)) log.UserId   = uidv;
            log.IpAddress = StrAL(elem, "ipAddress");
            log.OldValue  = StrAL(elem, "oldValue");
            log.NewValue  = StrAL(elem, "newValue");
            if (TryPropAL(elem, "ts", out var tsEl) && tsEl.ValueKind != System.Text.Json.JsonValueKind.Null && tsEl.TryGetDateTime(out var tsv)) log.Ts = tsv;

            _db.AuditLogs.Add(log);
            saved++;
        }

        await _db.SaveChangesAsync(ct);
        await MarkStationOnlineAsync(station, "audit_ingest");
        _logger.LogInformation("[Ingest] Trạm {Name}: nhận {Saved}/{Total} audit logs", station.Name, saved, items.Count);
        return Ok(new { received = items.Count, saved });
    }

    // ── POST /api/v1/ingest/maintenance ─────────────────────
    /// <summary>Nhận maintenance tasks từ trạm con.</summary>
    [HttpPost("maintenance")]
    public async Task<IActionResult> IngestMaintenance([FromBody] List<System.Text.Json.JsonElement> items, CancellationToken ct)
    {
        var station = await AuthenticateStationAsync();
        if (station == null) return Unauthorized(new { message = "X-Station-Id không hợp lệ" });

        static bool TryPropMT(System.Text.Json.JsonElement e, string name, out System.Text.Json.JsonElement val)
        {
            if (e.TryGetProperty(name, out val)) return true;
            var pascal = char.ToUpper(name[0]) + name[1..];
            return e.TryGetProperty(pascal, out val);
        }
        static string? StrMT(System.Text.Json.JsonElement e, string name)
            => TryPropMT(e, name, out var v) && v.ValueKind == System.Text.Json.JsonValueKind.String ? v.GetString() : null;
        static bool TryGuidMT(System.Text.Json.JsonElement e, string name, out Guid result)
        {
            if (TryPropMT(e, name, out var v) && v.ValueKind == System.Text.Json.JsonValueKind.String && v.TryGetGuid(out result)) return true;
            result = Guid.Empty; return false;
        }

        int saved = 0, updated = 0;
        foreach (var elem in items)
        {
            if (!TryGuidMT(elem, "id", out var id)) continue;

            var existing = await _db.MaintenanceTasks.FindAsync([id], ct);
            if (existing != null)
            {
                // Đánh dấu nguồn gốc từ trạm con, không ghi đè task của trạm tổng (SyncSource="central")
                if (existing.SyncSource != "central") existing.SyncSource = "station";

                // Cập nhật status/completedAt nếu task trạm con báo cáo về
                var newStatus = StrMT(elem, "status");
                if (newStatus != null && existing.Status != newStatus)
                {
                    existing.Status = newStatus;
                    if (TryPropMT(elem, "completedAt", out var ca2) && ca2.ValueKind != System.Text.Json.JsonValueKind.Null && ca2.TryGetDateTime(out var cav2))
                        existing.CompletedAt = cav2;
                    updated++;
                }
                var incomingDeviceName = StrMT(elem, "deviceName");
                if (!string.IsNullOrWhiteSpace(incomingDeviceName) && existing.DeviceNameSnapshot != incomingDeviceName)
                    existing.DeviceNameSnapshot = incomingDeviceName;
                continue;
            }

            var task = new MaintenanceTask { Id = id, StationId = station.Id, SyncSource = "station" };
            task.Title  = StrMT(elem, "title") ?? "";
            task.Type   = StrMT(elem, "type")   ?? "general";
            task.Status = StrMT(elem, "status") ?? "pending";
            task.AssignedTo = StrMT(elem, "assignedTo");
            task.Notes      = StrMT(elem, "notes");
            task.DeviceNameSnapshot = StrMT(elem, "deviceName");
            if (TryPropMT(elem, "scheduledDate", out var sd) && sd.ValueKind != System.Text.Json.JsonValueKind.Null && sd.TryGetDateTime(out var sdv)) task.ScheduledDate = sdv;
            if (TryPropMT(elem, "completedAt",   out var ca) && ca.ValueKind != System.Text.Json.JsonValueKind.Null && ca.TryGetDateTime(out var cav)) task.CompletedAt   = cav;

            _db.MaintenanceTasks.Add(task);
            saved++;
        }

        await _db.SaveChangesAsync(ct);
        await MarkStationOnlineAsync(station, "maintenance_ingest");
        _logger.LogInformation("[Ingest] Trạm {Name}: nhận {Saved} mới, {Updated} cập nhật / {Total} maintenance tasks", station.Name, saved, updated, items.Count);
        return Ok(new { received = items.Count, saved, updated });
    }

    // ── GET /api/v1/ingest/tasks ─────────────────────────────
    /// <summary>Trạm con lấy danh sách task bảo trì được tạo từ trạm tổng cho mình.</summary>
    [HttpGet("tasks")]
    public async Task<IActionResult> GetTasksForStation([FromQuery] DateTime? since, CancellationToken ct)
    {
        var station = await AuthenticateStationAsync();
        if (station == null) return Unauthorized(new { message = "X-Station-Id không hợp lệ" });

        // Chỉ trả task tạo từ trạm tổng (SyncSource null hoặc "central"), không trả task do trạm tự tạo sync lên
        var q = _db.MaintenanceTasks
            .Where(t => t.StationId == station.Id && (t.SyncSource == null || t.SyncSource == "central"));

        if (since.HasValue)
            q = q.Where(t =>
                t.CreatedAt > since.Value ||
                (t.CompletedAt == null && t.Status != "completed") ||
                (t.CompletedAt != null && t.CompletedAt > since.Value));

        var tasks = await q.OrderByDescending(t => t.CreatedAt).Take(100).ToListAsync(ct);

        var deviceIds = tasks
            .Where(t => t.DeviceId.HasValue)
            .Select(t => t.DeviceId!.Value)
            .Distinct()
            .ToList();

        var deviceNames = await _db.Devices
            .Where(d => deviceIds.Contains(d.Id))
            .ToDictionaryAsync(d => d.Id, d => d.Name, ct);

        // Đánh dấu đã sync xuống trạm (ghi nhận thời điểm)
        var now = DateTime.UtcNow;
        foreach (var t in tasks) t.SyncedToStationAt ??= now;
        if (tasks.Any()) await _db.SaveChangesAsync(ct);

        await MarkStationOnlineAsync(station, "task_pull");
        _logger.LogInformation("[Ingest] Trạm {Name} pull {Count} tasks từ trạm tổng", station.Name, tasks.Count);

        return Ok(tasks.Select(t => new {
            t.Id, t.StationId, t.DeviceId, t.Title, t.Type, t.Status,
            DeviceName = t.DeviceId.HasValue && deviceNames.TryGetValue(t.DeviceId.Value, out var dn) ? dn : t.DeviceNameSnapshot,
            t.AssignedTo, t.Notes, t.Checklist,
            ScheduledDate = t.ScheduledDate,
            CreatedAt     = t.CreatedAt,
            CompletedAt   = t.CompletedAt,
        }));
    }

    // ── GET /api/v1/ingest/ping ──────────────────────────────
    /// <summary>Trạm con kiểm tra kết nối đến trạm tổng.</summary>
    [HttpPost("devices")]
    public async Task<IActionResult> IngestDevices([FromBody] List<System.Text.Json.JsonElement> items, CancellationToken ct)
    {
        var station = await AuthenticateStationAsync();
        if (station == null) return Unauthorized(new { message = "X-Station-Id không hợp lệ" });

        int upserted = 0;
        foreach (var item in items)
        {
            if (!item.TryGetProperty("id", out var idProp)) continue;
            if (!Guid.TryParse(idProp.GetString(), out var deviceId)) continue;

            var name = item.TryGetProperty("name", out var n) ? n.GetString() ?? "" : "";
            var type = item.TryGetProperty("type", out var t) ? t.GetString() ?? "" : "";
            var status = item.TryGetProperty("status", out var s) ? s.GetString() ?? "online" : "online";

            var existing = await _db.Devices.FindAsync(new object[] { deviceId }, ct);
            if (existing != null)
            {
                existing.Name = name;
                existing.Type = type;
                existing.Status = status;
                existing.StationId = station.Id;
            }
            else
            {
                _db.Devices.Add(new Device
                {
                    Id = deviceId,
                    StationId = station.Id,
                    Name = name,
                    Type = type,
                    Status = status,
                    CreatedAt = DateTime.UtcNow
                });
            }
            upserted++;
        }

        await _db.SaveChangesAsync(ct);
        return Ok(new { upserted });
    }

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

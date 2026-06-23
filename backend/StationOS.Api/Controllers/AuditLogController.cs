// ============================================================
// AuditLogController — Nhật ký hành động hệ thống
// GET /api/v1/logs/audit   — Hành động (join username)
// GET /api/v1/logs/login   — Đăng nhập / thất bại
// GET /api/v1/logs/notify  — Thông báo email đã gửi
// GET /api/v1/logs/rule-triggers — Lịch sử kích hoạt rule
// ============================================================

using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using Microsoft.EntityFrameworkCore;
using System.Text.Json;
using StationOS.Data;

namespace StationOS.Api.Controllers;

[ApiController]
[Route("api/v1/logs")]
[Authorize]
public class AuditLogController : ControllerBase
{
    private readonly AppDbContext _db;
    private readonly StationOS.Services.PermissionService _permissions;

    public AuditLogController(AppDbContext db, StationOS.Services.PermissionService permissions)
    {
        _db = db;
        _permissions = permissions;
    }

    /// <summary>Lấy nhật ký hành động (audit log) — các thao tác POST/PUT/DELETE.</summary>
    [HttpGet("audit")]
    public async Task<IActionResult> GetAudit(
        [FromQuery] string? action,
        [FromQuery] string? entityType,
        [FromQuery] Guid? userId,
        [FromQuery] DateTime? from,
        [FromQuery] DateTime? to,
        [FromQuery] Guid? stationId,
        [FromQuery] int limit = 200)
    {
        var allowed = await _permissions.GetAllowedStationIdsAsync();

        var q = _db.AuditLogs.AsQueryable();

        if (!string.IsNullOrEmpty(action))     q = q.Where(a => a.Action == action);
        if (!string.IsNullOrEmpty(entityType)) q = q.Where(a => a.EntityType == entityType);
        if (userId.HasValue)                   q = q.Where(a => a.UserId == userId);
        if (from.HasValue)                     q = q.Where(a => a.Ts >= from.Value);
        if (to.HasValue)                       q = q.Where(a => a.Ts <= to.Value);

        var logs = await q
            .OrderByDescending(a => a.Ts)
            .Take(limit)
            .Select(a => new {
                a.Id, a.Action, a.EntityType, a.EntityId,
                a.IpAddress, a.Ts, a.UserId,
                a.OldValue, a.NewValue,
                a.StationId   // include pre-set stationId from synced logs
            })
            .ToListAsync();

        // Join username từ Users
        var userIds = logs
            .Where(l => l.UserId.HasValue)
            .Select(l => l.UserId!.Value)
            .Distinct()
            .ToList();

        var userMap = new Dictionary<Guid, (string username, string? fullName, Guid[]? stationIds, Guid[]? provinceIds, Guid? teamId)>();
        if (userIds.Any())
        {
            var dbUsers = await _db.Users
                .Where(u => userIds.Contains(u.Id))
                .Select(u => new { u.Id, u.Username, u.FullName, u.StationIds, u.ProvinceIds, u.TeamId })
                .ToListAsync();
            foreach (var u in dbUsers)
                userMap[u.Id] = (u.Username, u.FullName, u.StationIds, u.ProvinceIds, u.TeamId);
        }

        // Entity IDs mapping to stations
        var bodyDeviceIds = logs
            .Select(l => TryExtractDeviceIdFromJson(l.NewValue, out var bodyDeviceId) ? (Guid?)bodyDeviceId : null)
            .Where(id => id.HasValue)
            .Select(id => id!.Value)
            .Distinct()
            .ToList();

        var deviceIds = logs
            .Where(l => l.EntityType == "device" && l.EntityId.HasValue)
            .Select(l => l.EntityId!.Value)
            .Concat(bodyDeviceIds)
            .Distinct()
            .ToList();
        var ruleIds = logs.Where(l => l.EntityType == "rule" && l.EntityId.HasValue).Select(l => l.EntityId!.Value).Distinct().ToList();
        var alertIds = logs.Where(l => l.EntityType == "alert" && l.EntityId.HasValue).Select(l => l.EntityId!.Value).Distinct().ToList();
        var maintenanceIds = logs.Where(l => l.EntityType == "maintenance" && l.EntityId.HasValue).Select(l => l.EntityId!.Value).Distinct().ToList();
        var reportIds = logs.Where(l => l.EntityType == "report" && l.EntityId.HasValue).Select(l => l.EntityId!.Value).Distinct().ToList();
        var stationEntityIds = logs.Where(l => l.EntityType == "station" && l.EntityId.HasValue).Select(l => l.EntityId!.Value).Distinct().ToList();
        var sldEntityIds = logs.Where(l => l.EntityType == "sld" && l.EntityId.HasValue).Select(l => l.EntityId!.Value).Distinct().ToList();
        var settingIds = logs.Where(l => l.EntityType == "setting" && l.EntityId.HasValue).Select(l => l.EntityId!.Value).Distinct().ToList();

        var deviceStations = deviceIds.Any()
            ? await _db.Devices.Where(d => deviceIds.Contains(d.Id)).Select(d => new { d.Id, d.StationId }).ToDictionaryAsync(d => d.Id, d => d.StationId)
            : new Dictionary<Guid, Guid>();

        var ruleStations = ruleIds.Any()
            ? await _db.Rules.Where(r => ruleIds.Contains(r.Id)).Select(r => new { r.Id, r.StationId }).ToDictionaryAsync(r => r.Id, r => r.StationId)
            : new Dictionary<Guid, Guid>();

        var alertStations = alertIds.Any()
            ? await _db.Alerts.Where(a => alertIds.Contains(a.Id)).Select(a => new { a.Id, a.StationId }).ToDictionaryAsync(a => a.Id, a => a.StationId)
            : new Dictionary<Guid, Guid>();

        var maintenanceStations = maintenanceIds.Any()
            ? await _db.MaintenanceTasks.Where(t => maintenanceIds.Contains(t.Id)).Select(t => new { t.Id, t.StationId }).ToDictionaryAsync(t => t.Id, t => t.StationId)
            : new Dictionary<Guid, Guid>();

        var reportStations = reportIds.Any()
            ? await _db.Reports.Where(r => reportIds.Contains(r.Id)).Select(r => new { r.Id, r.StationId }).ToDictionaryAsync(r => r.Id, r => r.StationId)
            : new Dictionary<Guid, Guid>();

        var settingStations = settingIds.Any()
            ? await _db.SystemSettings.Where(s => settingIds.Contains(s.Id)).Select(s => new { s.Id, s.StationId }).ToDictionaryAsync(s => s.Id, s => s.StationId)
            : new Dictionary<Guid, Guid>();

        var stationEntities = stationEntityIds.Any()
            ? await _db.Stations.Where(s => stationEntityIds.Contains(s.Id)).Select(s => s.Id).ToListAsync()
            : new List<Guid>();

        var sldFileStations = sldEntityIds.Any()
            ? await _db.SldFiles.Where(f => sldEntityIds.Contains(f.Id)).Select(f => new { f.Id, f.StationId }).ToDictionaryAsync(f => f.Id, f => f.StationId)
            : new Dictionary<Guid, Guid>();

        var sldPointStations = sldEntityIds.Any()
            ? await _db.SldPoints
                .Where(p => sldEntityIds.Contains(p.Id))
                .Select(p => new
                {
                    p.Id,
                    StationId = p.SldFile != null
                        ? p.SldFile.StationId
                        : p.Device != null
                            ? p.Device.StationId
                            : Guid.Empty
                })
                .Where(x => x.StationId != Guid.Empty)
                .ToDictionaryAsync(x => x.Id, x => x.StationId)
            : new Dictionary<Guid, Guid>();

        var mappedLogs = logs.Select(l => {
            // Ưu tiên StationId đã được set sẵn (ví dụ: log được đẩy từ trạm con qua IngestController)
            Guid? resolvedStationId = l.StationId;
            if (resolvedStationId == null)
            {
                if (l.EntityType == "device" && l.EntityId.HasValue && deviceStations.TryGetValue(l.EntityId.Value, out var ds))
                    resolvedStationId = ds;
                else if (l.EntityType == "rule" && l.EntityId.HasValue && ruleStations.TryGetValue(l.EntityId.Value, out var rs))
                    resolvedStationId = rs;
                else if (l.EntityType == "alert" && l.EntityId.HasValue && alertStations.TryGetValue(l.EntityId.Value, out var als))
                    resolvedStationId = als;
                else if (l.EntityType == "maintenance" && l.EntityId.HasValue && maintenanceStations.TryGetValue(l.EntityId.Value, out var ms))
                    resolvedStationId = ms;
                else if (l.EntityType == "maintenance" && l.EntityId.HasValue && alertStations.TryGetValue(l.EntityId.Value, out var mas))
                    resolvedStationId = mas;
                else if (l.EntityType == "report" && l.EntityId.HasValue && reportStations.TryGetValue(l.EntityId.Value, out var rps))
                    resolvedStationId = rps;
                else if (l.EntityType == "setting" && l.EntityId.HasValue && settingStations.TryGetValue(l.EntityId.Value, out var sts))
                    resolvedStationId = sts;
                else if (l.EntityType == "station" && l.EntityId.HasValue && stationEntities.Contains(l.EntityId.Value))
                    resolvedStationId = l.EntityId.Value;
                else if (l.EntityType == "sld" && l.EntityId.HasValue && sldFileStations.TryGetValue(l.EntityId.Value, out var sldFs))
                    resolvedStationId = sldFs;
                else if (l.EntityType == "sld" && l.EntityId.HasValue && sldPointStations.TryGetValue(l.EntityId.Value, out var sldPs))
                    resolvedStationId = sldPs;
                else if (l.EntityType == "sld" && l.EntityId.HasValue && stationEntities.Contains(l.EntityId.Value))
                    resolvedStationId = l.EntityId.Value;
                else if (TryExtractStationIdFromJson(l.NewValue, out var bodyStationId))
                    resolvedStationId = bodyStationId;
                else if (TryExtractDeviceIdFromJson(l.NewValue, out var bodyDeviceId) && deviceStations.TryGetValue(bodyDeviceId, out var bodyDeviceStationId))
                    resolvedStationId = bodyDeviceStationId;
            }

            Guid? accountStationId = null;
            Guid? accountProvinceId = null;
            Guid? accountTeamId = null;
            if (l.UserId.HasValue && userMap.TryGetValue(l.UserId.Value, out var uInfo))
            {
                if (uInfo.stationIds != null && uInfo.stationIds.Length > 0)
                    accountStationId = uInfo.stationIds[0];
                if (uInfo.provinceIds != null && uInfo.provinceIds.Length > 0)
                    accountProvinceId = uInfo.provinceIds[0];
                accountTeamId = uInfo.teamId;
            }

            return new {
                l.Id, l.Action, l.EntityType, l.EntityId,
                l.IpAddress, l.Ts, l.UserId,
                Username = l.UserId.HasValue && userMap.TryGetValue(l.UserId.Value, out var u) ? u.username : null,
                FullName = l.UserId.HasValue && userMap.TryGetValue(l.UserId.Value, out var u2) ? u2.fullName : null,
                l.OldValue, l.NewValue,
                StationId = resolvedStationId,
                AccountStationId = accountStationId,
                AccountProvinceId = accountProvinceId,
                AccountTeamId = accountTeamId,
            };
        }).ToList();

        // Scoping & Filtering
        if (allowed != null)
        {
            mappedLogs = mappedLogs.Where(l => l.StationId.HasValue && allowed.Contains(l.StationId.Value)).ToList();
        }

        if (stationId.HasValue)
        {
            mappedLogs = mappedLogs.Where(l => l.StationId == stationId.Value).ToList();
        }

        // Fetch station names + provinceIds
        var uniqueStationIds = mappedLogs
            .SelectMany(l => new[] { l.StationId, l.AccountStationId })
            .Where(id => id.HasValue)
            .Select(id => id!.Value)
            .Distinct()
            .ToList();
        var stationInfoList = await _db.Stations
            .Where(s => uniqueStationIds.Contains(s.Id))
            .Select(s => new { s.Id, s.Name, s.ProvinceId })
            .ToListAsync();
        var stationInfos = stationInfoList.ToDictionary(s => s.Id);

        // Collect all province IDs: from station.ProvinceId + user.ProvinceIds
        var stationProvinceIds = stationInfos.Values.Where(s => s.ProvinceId.HasValue).Select(s => (Guid)s.ProvinceId!.Value).ToList();
        var userProvinceIds = mappedLogs.Where(l => l.AccountProvinceId.HasValue).Select(l => l.AccountProvinceId!.Value).ToList();
        var uniqueProvinceIds = stationProvinceIds.Concat(userProvinceIds).Distinct().ToList();
        var provinceNames = uniqueProvinceIds.Any()
            ? await _db.Provinces.Where(p => uniqueProvinceIds.Contains(p.Id)).ToDictionaryAsync(p => p.Id, p => p.Name)
            : new Dictionary<Guid, string>();

        // Fetch team names
        var uniqueTeamIds = mappedLogs.Where(l => l.AccountTeamId.HasValue).Select(l => l.AccountTeamId!.Value).Distinct().ToList();
        var teamNames = uniqueTeamIds.Any()
            ? await _db.Teams.Where(t => uniqueTeamIds.Contains(t.Id)).ToDictionaryAsync(t => t.Id, t => t.Name)
            : new Dictionary<Guid, string>();

        var result = mappedLogs.Select(l => {
            Guid? stationProvinceId = l.StationId.HasValue && stationInfos.TryGetValue(l.StationId.Value, out var si) && si.ProvinceId.HasValue
                ? si.ProvinceId : null;
            Guid? acctStProvinceId = l.AccountStationId.HasValue && stationInfos.TryGetValue(l.AccountStationId.Value, out var asi) && asi.ProvinceId.HasValue
                ? asi.ProvinceId : null;

            string? stationName = l.StationId.HasValue && stationInfos.TryGetValue(l.StationId.Value, out var siName) ? siName.Name : null;
            string? acctStationName = l.AccountStationId.HasValue && stationInfos.TryGetValue(l.AccountStationId.Value, out var asiName) ? asiName.Name : null;

            // Province: từ stationId → station.provinceId, fallback từ account's station, fallback từ user.provinceIds
            Guid? resolvedProvinceId = stationProvinceId ?? acctStProvinceId ?? l.AccountProvinceId;

            return new {
                l.Id, l.Action, l.EntityType, l.EntityId,
                l.IpAddress, l.Ts, l.UserId,
                l.Username, l.FullName,
                l.OldValue, l.NewValue,
                l.StationId,
                StationName = stationName,
                l.AccountStationId,
                AccountStationName = acctStationName,
                ProvinceId = resolvedProvinceId,
                ProvinceName = resolvedProvinceId.HasValue && provinceNames.TryGetValue(resolvedProvinceId.Value, out var pn) ? pn : null,
                TeamId = l.AccountTeamId,
                TeamName = l.AccountTeamId.HasValue && teamNames.TryGetValue(l.AccountTeamId.Value, out var tn) ? tn : null,
            };
        });

        return Ok(result);
    }

    private static bool TryExtractStationIdFromJson(string? json, out Guid stationId)
    {
        stationId = Guid.Empty;
        if (string.IsNullOrWhiteSpace(json)) return false;

        try
        {
            using var doc = JsonDocument.Parse(json);
            if (!TryReadGuid(doc.RootElement, "stationId", out stationId) &&
                !TryReadGuid(doc.RootElement, "StationId", out stationId))
                return false;

            return stationId != Guid.Empty;
        }
        catch
        {
            return false;
        }
    }

    private static bool TryExtractDeviceIdFromJson(string? json, out Guid deviceId)
    {
        deviceId = Guid.Empty;
        if (string.IsNullOrWhiteSpace(json)) return false;

        try
        {
            using var doc = JsonDocument.Parse(json);
            if (!TryReadGuid(doc.RootElement, "deviceId", out deviceId) &&
                !TryReadGuid(doc.RootElement, "DeviceId", out deviceId))
                return false;

            return deviceId != Guid.Empty;
        }
        catch
        {
            return false;
        }
    }

    private static bool TryReadGuid(JsonElement root, string propertyName, out Guid value)
    {
        value = Guid.Empty;
        if (!root.TryGetProperty(propertyName, out var prop)) return false;

        if (prop.ValueKind == JsonValueKind.String && Guid.TryParse(prop.GetString(), out var parsed))
        {
            value = parsed;
            return true;
        }

        return false;
    }

    /// <summary>Lấy nhật ký đăng nhập (login log).</summary>
    [HttpGet("login")]
    public async Task<IActionResult> GetLogin(
        [FromQuery] DateTime? from,
        [FromQuery] DateTime? to,
        [FromQuery] Guid? stationId,
        [FromQuery] int limit = 200)
    {
        var allowed = await _permissions.GetAllowedStationIdsAsync();

        var q = _db.LoginLogs.AsQueryable();
        if (from.HasValue) q = q.Where(l => l.Ts >= from.Value);
        if (to.HasValue)   q = q.Where(l => l.Ts <= to.Value);

        var logs = await q
            .OrderByDescending(l => l.Ts)
            .Take(limit)
            .Select(l => new {
                l.Id, l.Username, l.Action,
                l.IpAddress, l.Ts, l.UserId
            })
            .ToListAsync();

        var userIds = logs.Where(l => l.UserId.HasValue).Select(l => l.UserId!.Value).Distinct().ToList();
        var usernames = logs.Where(l => !l.UserId.HasValue && !string.IsNullOrEmpty(l.Username)).Select(l => l.Username!).Distinct().ToList();

        var userStations = await _db.Users
            .Where(u => userIds.Contains(u.Id) || (u.Username != null && usernames.Contains(u.Username)))
            .Select(u => new { u.Id, u.Username, u.StationIds })
            .ToListAsync();

        var mappedLogs = logs.Select(l => {
            var dbUser = userStations.FirstOrDefault(u => u.Id == l.UserId || (l.Username != null && u.Username == l.Username));
            Guid? accountStationId = (dbUser?.StationIds != null && dbUser.StationIds.Length > 0) ? dbUser.StationIds[0] : null;

            return new {
                l.Id, l.Username, l.Action,
                l.IpAddress, l.Ts,
                StationId = accountStationId,
                AccountStationId = accountStationId
            };
        }).ToList();

        if (allowed != null)
        {
            mappedLogs = mappedLogs.Where(l => l.StationId.HasValue && allowed.Contains(l.StationId.Value)).ToList();
        }

        if (stationId.HasValue)
        {
            mappedLogs = mappedLogs.Where(l => l.StationId == stationId.Value).ToList();
        }

        var uniqueStationIds = mappedLogs.Where(l => l.StationId.HasValue).Select(l => l.StationId!.Value).Distinct().ToList();
        var stationNames = uniqueStationIds.Any()
            ? await _db.Stations.Where(s => uniqueStationIds.Contains(s.Id)).ToDictionaryAsync(s => s.Id, s => s.Name)
            : new Dictionary<Guid, string>();

        var result = mappedLogs.Select(l => new {
            l.Id, l.Username, l.Action,
            l.IpAddress, l.Ts,
            l.StationId,
            StationName = l.StationId.HasValue && stationNames.TryGetValue(l.StationId.Value, out var sn) ? sn : null,
            l.AccountStationId,
            AccountStationName = l.AccountStationId.HasValue && stationNames.TryGetValue(l.AccountStationId.Value, out var asn) ? asn : null
        });

        return Ok(result);
    }

    /// <summary>Lấy nhật ký kích hoạt rule (rule trigger log).</summary>
    [HttpGet("rule-triggers")]
    public async Task<IActionResult> GetRuleTriggers(
        [FromQuery] Guid? ruleId,
        [FromQuery] Guid? deviceId,
        [FromQuery] DateTime? from,
        [FromQuery] DateTime? to,
        [FromQuery] Guid? stationId,
        [FromQuery] int limit = 200)
    {
        var allowed = await _permissions.GetAllowedStationIdsAsync();

        var q = _db.RuleTriggerLogs.AsQueryable();
        if (ruleId.HasValue)   q = q.Where(r => r.RuleId == ruleId);
        if (deviceId.HasValue) q = q.Where(r => r.DeviceId == deviceId);
        if (from.HasValue)     q = q.Where(r => r.TriggeredAt >= from.Value);
        if (to.HasValue)       q = q.Where(r => r.TriggeredAt <= to.Value);

        if (allowed != null)   q = q.Where(r => allowed.Contains(r.StationId));
        if (stationId.HasValue) q = q.Where(r => r.StationId == stationId.Value);

        var logs = await q
            .OrderByDescending(r => r.TriggeredAt)
            .Take(limit)
            .Select(r => new { r.Id, r.RuleId, r.DeviceId, r.StationId,
                                r.TriggeredAt, r.ValueAtTrigger, r.AlertId, r.ConditionSnapshot })
            .ToListAsync();

        var ruleIds   = logs.Select(l => l.RuleId).Distinct().ToList();
        var devIds    = logs.Where(l => l.DeviceId.HasValue).Select(l => l.DeviceId!.Value).Distinct().ToList();
        var stationIds = logs.Select(l => l.StationId).Distinct().ToList();

        var ruleNames = await _db.Rules.Where(r => ruleIds.Contains(r.Id))
            .ToDictionaryAsync(r => r.Id, r => r.Name);
        var devNames  = devIds.Any()
            ? await _db.Devices.Where(d => devIds.Contains(d.Id))
                .ToDictionaryAsync(d => d.Id, d => d.Name)
            : new Dictionary<Guid, string>();
        var stationNames = stationIds.Any()
            ? await _db.Stations.Where(s => stationIds.Contains(s.Id))
                .ToDictionaryAsync(s => s.Id, s => s.Name)
            : new Dictionary<Guid, string>();

        var result = logs.Select(l => new {
            l.Id, l.RuleId, l.DeviceId, l.StationId,
            l.TriggeredAt, l.ValueAtTrigger, l.AlertId,
            l.ConditionSnapshot,
            RuleName  = ruleNames.TryGetValue(l.RuleId, out var rn)  ? rn : null,
            DeviceName = l.DeviceId.HasValue && devNames.TryGetValue(l.DeviceId.Value, out var dn) ? dn : null,
            StationName = stationNames.TryGetValue(l.StationId, out var sn) ? sn : null
        });

        return Ok(result);
    }

    /// <summary>Lấy nhật ký gửi thông báo (email, SMS...).</summary>
    [HttpGet("notify")]
    public async Task<IActionResult> GetNotify(
        [FromQuery] string? status,
        [FromQuery] string? channel,
        [FromQuery] DateTime? from,
        [FromQuery] DateTime? to,
        [FromQuery] Guid? stationId,
        [FromQuery] int limit = 200)
    {
        var allowed = await _permissions.GetAllowedStationIdsAsync();

        var q = _db.NotifyLogs.AsQueryable();
        if (!string.IsNullOrEmpty(status))  q = q.Where(n => n.Status == status);
        if (!string.IsNullOrEmpty(channel)) q = q.Where(n => n.Channel == channel);
        if (from.HasValue) q = q.Where(n => n.SentAt >= from.Value);
        if (to.HasValue)   q = q.Where(n => n.SentAt <= to.Value);

        var logs = await q
            .OrderByDescending(n => n.SentAt)
            .Take(limit)
            .Select(n => new {
                n.Id, n.AlertId, n.Channel,
                n.Recipient, n.Status, n.SentAt, n.ErrorMsg
            })
            .ToListAsync();

        var alertIds = logs.Where(l => l.AlertId.HasValue).Select(l => l.AlertId!.Value).Distinct().ToList();

        var alertStations = alertIds.Any()
            ? await _db.Alerts.Where(a => alertIds.Contains(a.Id)).Select(a => new { a.Id, a.StationId }).ToDictionaryAsync(a => a.Id, a => a.StationId)
            : new Dictionary<Guid, Guid>();

        var mappedLogs = logs.Select(l => {
            Guid? resolvedStationId = (l.AlertId.HasValue && alertStations.TryGetValue(l.AlertId.Value, out var sid)) ? sid : null;

            return new {
                l.Id, l.AlertId, l.Channel,
                l.Recipient, l.Status, l.SentAt, l.ErrorMsg,
                StationId = resolvedStationId
            };
        }).ToList();

        if (allowed != null)
        {
            mappedLogs = mappedLogs.Where(l => l.StationId.HasValue && allowed.Contains(l.StationId.Value)).ToList();
        }

        if (stationId.HasValue)
        {
            mappedLogs = mappedLogs.Where(l => l.StationId == stationId.Value).ToList();
        }

        var uniqueStationIds = mappedLogs.Where(l => l.StationId.HasValue).Select(l => l.StationId!.Value).Distinct().ToList();
        var stationNames = uniqueStationIds.Any()
            ? await _db.Stations.Where(s => uniqueStationIds.Contains(s.Id)).ToDictionaryAsync(s => s.Id, s => s.Name)
            : new Dictionary<Guid, string>();

        var result = mappedLogs.Select(l => new {
            l.Id, l.AlertId, l.Channel,
            l.Recipient, l.Status, l.SentAt, l.ErrorMsg,
            l.StationId,
            StationName = l.StationId.HasValue && stationNames.TryGetValue(l.StationId.Value, out var sn) ? sn : null
        });

        return Ok(result);
    }
}

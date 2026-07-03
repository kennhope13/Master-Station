using System.Net.Http.Headers;
using System.Text.Json;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Logging;
using Microsoft.Extensions.Configuration;
using StationOS.Data;
using StationOS.Data.Entities;
using StationOS.Services;
using StationOS.Services.Security;
using StationOS.Api.Filters;

namespace StationOS.Api.Controllers;

[ApiController]
[Route("api/v1/stations")]
[Authorize]
public class StationsController : ControllerBase
{
    private readonly AppDbContext _db;
    private readonly PermissionService _permissions;
    private readonly IHttpClientFactory _httpClientFactory;
    private readonly CredentialEncryptionService _crypto;
    private readonly InternalAuthService _internalAuth;
    private readonly IRealtimeNotifier _notifier;
    private readonly ILogger<StationsController> _logger;
    private readonly LicenseService _license;
    private readonly bool _allowStationCreation;
    private const string DefaultApiUsername = "stationadmin";
    private const string DefaultApiPassword = "Station@123";
    private const string DefaultProvinceAdminPasswordSuffix = "@2026!";
    private const string DefaultStationAdminPasswordSuffix = "@26";

    private async Task<bool> StationBelongsToProvinceAsync(Guid provinceId, string? stationName, string? locationJson)
    {
        var provinces = await _db.Provinces.AsNoTracking()
            .Select(p => new { p.Id, p.Name, p.Code }).ToListAsync();

        var selected = provinces.FirstOrDefault(p => p.Id == provinceId);
        if (selected == null) return false;

        string address = "";
        if (!string.IsNullOrWhiteSpace(locationJson))
        {
            try
            {
                using var doc = System.Text.Json.JsonDocument.Parse(locationJson);
                if (doc.RootElement.TryGetProperty("address", out var ap))
                    address = ap.GetString() ?? "";
            }
            catch { }
        }

        var haystack = address.ToLowerInvariant();
        if (string.IsNullOrWhiteSpace(haystack)) return false;

        var selectedName = selected.Name?.Trim().ToLowerInvariant() ?? "";
        var selectedCode = selected.Code?.Trim().ToLowerInvariant() ?? "";
        var selectedProvinceMatched =
            (!string.IsNullOrWhiteSpace(selectedName) && haystack.Contains(selectedName)) ||
            (!string.IsNullOrWhiteSpace(selectedCode) && haystack.Contains(selectedCode));

        if (!selectedProvinceMatched)
            return false;

        foreach (var p in provinces)
        {
            if (p.Id == provinceId) continue;
            var otherName = p.Name?.Trim().ToLowerInvariant() ?? "";
            var otherCode = p.Code?.Trim().ToLowerInvariant() ?? "";
            if ((!string.IsNullOrWhiteSpace(otherName) && haystack.Contains(otherName)) ||
                (!string.IsNullOrWhiteSpace(otherCode) && haystack.Contains(otherCode)))
                return false;
        }

        return true;
    }

    public StationsController(AppDbContext db, PermissionService permissions, IHttpClientFactory httpClientFactory, CredentialEncryptionService crypto, InternalAuthService internalAuth, IRealtimeNotifier notifier, ILogger<StationsController> logger, LicenseService license, IConfiguration config)
    {
        _db = db;
        _permissions = permissions;
        _httpClientFactory = httpClientFactory;
        _crypto = crypto;
        _internalAuth = internalAuth;
        _notifier = notifier;
        _logger = logger;
        _license = license;
        _allowStationCreation = config.GetValue<bool?>("AppFeatures:AllowStationCreation") ?? false;
    }

    private static string NormalizeProvinceAccountToken(string? value)
    {
        var token = UsernameNormalizer.Normalize(
            value?
                .Replace("Tỉnh", "", StringComparison.OrdinalIgnoreCase)
                .Replace("Thành phố", "", StringComparison.OrdinalIgnoreCase)
                .Replace("TP.", "", StringComparison.OrdinalIgnoreCase)
                .Replace("TP", "", StringComparison.OrdinalIgnoreCase)
                .Trim());
        return string.IsNullOrWhiteSpace(token) ? "province" : token;
    }

    private static string NormalizeStationAccountToken(string? value)
    {
        var token = UsernameNormalizer.Normalize(value);
        return string.IsNullOrWhiteSpace(token) ? "tram" : token;
    }

    private async Task EnsureProvinceAdminAccountAsync(Guid provinceId)
    {
        var province = await _db.Provinces.AsNoTracking().FirstOrDefaultAsync(p => p.Id == provinceId);
        if (province == null)
            return;

        var hasProvinceAdmin = await _db.Users.AnyAsync(u =>
            u.Role == "admin_province" &&
            u.ProvinceIds != null &&
            u.ProvinceIds.Contains(provinceId));

        if (hasProvinceAdmin)
            return;

        var token = !string.IsNullOrWhiteSpace(province.Code)
            ? NormalizeProvinceAccountToken(province.Code)
            : NormalizeProvinceAccountToken(province.Name);

        var usernameBase = $"admintinh{token}";
        var username = usernameBase;
        var suffix = 2;
        while (await _db.Users.AnyAsync(u => u.Username == username))
        {
            username = $"{usernameBase}{suffix}";
            suffix++;
        }

        var passwordToken = (!string.IsNullOrWhiteSpace(province.Code)
            ? NormalizeProvinceAccountToken(province.Code).ToUpperInvariant()
            : token.ToUpperInvariant());
        var defaultPassword = $"Tinh{passwordToken}{DefaultProvinceAdminPasswordSuffix}";

        var user = new User
        {
            Username = username,
            PasswordHash = BCrypt.Net.BCrypt.HashPassword(defaultPassword, workFactor: 12),
            ProvisionedPassword = _crypto.Encrypt(defaultPassword),
            FullName = $"Quản trị viên {province.Name}",
            Email = $"{username}@stationos.vn",
            Role = "admin_province",
            ProvinceIds = new[] { province.Id },
            Permissions = PermissionService.GetDefaultPermissionsForRole("admin_province").ToArray(),
            IsActive = true,
            MustChangePassword = true,
            LastPasswordChangedAt = DateTime.UtcNow
        };

        _db.Users.Add(user);
        await _db.SaveChangesAsync();

        _logger.LogInformation(
            "Auto-created province admin account {Username} for province {ProvinceName} ({ProvinceId})",
            username, province.Name, province.Id);
    }

    private async Task EnsureStationAdminAccountAsync(Station station)
    {
        var hasStationAdmin = await _db.Users.AnyAsync(u =>
            u.Role == "admin_station" &&
            u.StationIds != null &&
            u.StationIds.Contains(station.Id));

        if (hasStationAdmin)
            return;

        var token = !string.IsNullOrWhiteSpace(station.Code)
            ? NormalizeStationAccountToken(station.Code)
            : NormalizeStationAccountToken(station.Name);

        var usernameBase = $"admintram{token}";
        var username = usernameBase;
        var suffix = 2;
        while (await _db.Users.AnyAsync(u => u.Username == username))
        {
            username = $"{usernameBase}{suffix}";
            suffix++;
        }

        var passwordToken = !string.IsNullOrWhiteSpace(station.Code)
            ? NormalizeStationAccountToken(station.Code).ToUpperInvariant()
            : token.ToUpperInvariant();
        if (passwordToken.Length > 8)
            passwordToken = passwordToken[..8];

        var defaultPassword = $"Tram{passwordToken}{DefaultStationAdminPasswordSuffix}";

        var user = new User
        {
            Username = username,
            PasswordHash = BCrypt.Net.BCrypt.HashPassword(defaultPassword, workFactor: 12),
            ProvisionedPassword = _crypto.Encrypt(defaultPassword),
            FullName = $"Quản trị viên {station.Name}",
            Email = $"{username}@stationos.vn",
            Role = "admin_station",
            StationIds = new[] { station.Id },
            Permissions = PermissionService.GetDefaultPermissionsForRole("admin_station").ToArray(),
            IsActive = true,
            MustChangePassword = true,
            LastPasswordChangedAt = DateTime.UtcNow
        };

        _db.Users.Add(user);
        await _db.SaveChangesAsync();

        _logger.LogInformation(
            "Auto-created station admin account {Username} for station {StationName} ({StationId})",
            username, station.Name, station.Id);
    }

    /// <summary>Lấy danh sách trạm biến áp. Operator chỉ thấy trạm được phân quyền.</summary>
    /// <returns>Danh sách trạm (id, name, code, location, status, createdAt).</returns>
    [HttpGet]
    public async Task<IActionResult> GetAll()
    {
        var allowed = await _permissions.GetAllowedStationIdsAsync();
        var q = _db.Stations.AsQueryable();
        if (allowed != null) q = q.Where(s => allowed.Contains(s.Id));

        var stations = await q
            .OrderBy(s => s.Name)
            .Select(s => new {
                s.Id, s.Name, s.Code, s.Location, s.Status, s.CreatedAt, s.ApiUrl, s.ApiUsername, s.ApiPassword, s.WebUrl, s.LastContactAt, s.ProvinceId
            }).ToListAsync();

        var stationIds = stations.Select(s => s.Id).ToList();
        var lastSensorByStation = await _db.SensorReadings
            .Where(x => stationIds.Contains(x.StationId))
            .GroupBy(x => x.StationId)
            .Select(g => new { StationId = g.Key, LastSeenAt = (DateTime?)g.Max(x => x.Time) })
            .ToDictionaryAsync(x => x.StationId, x => x.LastSeenAt);

        var lastAlertByStation = await _db.Alerts
            .Where(x => stationIds.Contains(x.StationId))
            .GroupBy(x => x.StationId)
            .Select(g => new { StationId = g.Key, LastSeenAt = (DateTime?)g.Max(x => x.TriggeredAt) })
            .ToDictionaryAsync(x => x.StationId, x => x.LastSeenAt);

        var lastEventByStation = await _db.DetectionEvents
            .Where(x => stationIds.Contains(x.StationId))
            .GroupBy(x => x.StationId)
            .Select(g => new { StationId = g.Key, LastSeenAt = (DateTime?)g.Max(x => x.DetectedAt) })
            .ToDictionaryAsync(x => x.StationId, x => x.LastSeenAt);

        var threshold = DateTime.UtcNow.AddMinutes(-5);

        return Ok(stations.Select(s =>
        {
            var lastSeenAt = new[]
            {
                lastSensorByStation.GetValueOrDefault(s.Id),
                lastAlertByStation.GetValueOrDefault(s.Id),
                lastEventByStation.GetValueOrDefault(s.Id),
                s.LastContactAt
            }.Max();

            var connectionStatus = string.IsNullOrWhiteSpace(s.ApiUrl)
                ? "unknown"
                : lastSeenAt.HasValue && lastSeenAt.Value >= threshold
                    ? "online"
                    : "offline";

            return new
            {
                s.Id,
                s.Name,
                s.Code,
                s.Location,
                s.Status,
                s.CreatedAt,
                s.ApiUrl,
                apiUsername = string.IsNullOrWhiteSpace(s.ApiUsername) ? DefaultApiUsername : s.ApiUsername,
                hasApiPassword = !string.IsNullOrWhiteSpace(s.ApiPassword),
                webUrl = s.WebUrl ?? DeriveWebUrl(s.ApiUrl),
                connectionStatus,
                lastSeenAt,
                s.ProvinceId
            };
        }));
    }

    /// <summary>Lấy chi tiết 1 trạm theo ID.</summary>
    /// <param name="id">Station ID.</param>
    /// <returns>Đối tượng Station hoặc 404.</returns>
    [HttpGet("{id:guid}")]
    public async Task<IActionResult> GetById(Guid id)
    {
        var s = await _db.Stations.FindAsync(id);
        if (s == null) return NotFound();
        return Ok(ToStationResponse(s));
    }

    /// <summary>Tạo trạm mới. Chỉ admin.</summary>
    /// <param name="req">Thông tin trạm (name, code, location).</param>
    /// <returns>Station vừa tạo với status 201 Created.</returns>
    [HttpPost]
    [HasPermission("station:manage")]
    public async Task<IActionResult> Create([FromBody] StationRequest req)
    {
        var licenseStatus = await _license.GetStatusAsync();
        var isLicensed = licenseStatus != null && licenseStatus.IsValid;
        if (!_allowStationCreation && !isLicensed)
        {
            return StatusCode(403, new { message = "Bản phát hành này không cho phép tạo trạm mới. Vui lòng kích hoạt License." });
        }

        var limitInfo = await _license.CheckResourceLimitAsync("stations");
        if (limitInfo.Exceeded)
        {
            return BadRequest(new { message = $"Đã đạt giới hạn số lượng trạm biến áp của bản quyền ({limitInfo.Max} trạm). Vui lòng liên hệ nhà phát triển (dev) để nâng cấp." });
        }
        var allowedProvinceIds = await _permissions.GetAllowedProvinceIdsAsync();
        Guid? provinceId = req.ProvinceId;

        if (allowedProvinceIds != null)
        {
            if (provinceId == null)
            {
                return BadRequest(new { message = "Bạn phải chọn tỉnh trong phạm vi được phân quyền trước khi tạo trạm." });
            }
            else if (!allowedProvinceIds.Contains(provinceId.Value))
            {
                return StatusCode(403, new { message = "Bạn không có quyền tạo trạm tại tỉnh này." });
            }
        }

        // Validate province assignment
        if (provinceId == null)
        {
            return BadRequest(new { message = "Bạn phải chỉ định tỉnh cho trạm." });
        }

        if (!await StationBelongsToProvinceAsync(provinceId.Value, req.Name, req.Location))
            return StatusCode(403, new { message = "Bạn không có quyền thêm trạm ở ngoài tỉnh được phân công." });

        // Validate location JSON contains lat and lng
        if (string.IsNullOrWhiteSpace(req.Location))
        {
            return BadRequest(new { message = "Vị trí (Location) không được để trống." });
        }
        try
        {
            using var doc = JsonDocument.Parse(req.Location);
            if (!doc.RootElement.TryGetProperty("lat", out var latProp) || !doc.RootElement.TryGetProperty("lng", out var lngProp))
            {
                return BadRequest(new { message = "Location phải chứa trường 'lat' và 'lng'." });
            }
            // Optional: you could add further range checks here
        }
        catch (Exception)
        {
            return BadRequest(new { message = "Location không phải là JSON hợp lệ." });
        }

        var station = new Station
        {
            Name        = req.Name,
            Code        = req.Code,
            Location    = req.Location,
            ApiUrl      = req.ApiUrl,
            ApiUsername = NormalizeApiUsername(req.ApiUsername),
            ApiPassword = EncryptApiPassword(req.ApiPassword, useDefaultWhenEmpty: true),
            WebUrl      = req.WebUrl,
            ProvinceId  = provinceId,
            Status      = "active"
        };
        _db.Stations.Add(station);
        await _db.SaveChangesAsync();
        await EnsureProvinceAdminAccountAsync(provinceId.Value);
        await EnsureStationAdminAccountAsync(station);
        _ = _notifier.SendStationListChangedAsync("created", station.Id);
        return CreatedAtAction(nameof(GetById), new { id = station.Id }, ToStationResponse(station));
    }

    /// <summary>Cập nhật thông tin trạm. Chỉ admin.</summary>
    /// <param name="id">Station ID.</param>
    /// <param name="req">Thông tin cần cập nhật.</param>
    /// <returns>Station đã cập nhật.</returns>
    [HttpPut("{id:guid}")]
    [HasPermission("station:manage")]
    public async Task<IActionResult> Update(Guid id, [FromBody] StationRequest req)
    {
        var station = await _db.Stations.FindAsync(id);
        if (station == null) return NotFound();

        var allowedProvinceIds = await _permissions.GetAllowedProvinceIdsAsync();
        if (allowedProvinceIds != null)
        {
            if (station.ProvinceId == null || !allowedProvinceIds.Contains(station.ProvinceId.Value))
            {
                return StatusCode(403, new { message = "Bạn không có quyền chỉnh sửa trạm ngoài tỉnh được gán." });
            }
            if (req.ProvinceId == null || !allowedProvinceIds.Contains(req.ProvinceId.Value))
            {
                return StatusCode(403, new { message = "Tỉnh mới không nằm trong danh sách quản lý của bạn." });
            }
        }

        var targetProvinceId = req.ProvinceId ?? station.ProvinceId;
        if (targetProvinceId != null && !await StationBelongsToProvinceAsync(targetProvinceId.Value, req.Name, req.Location))
            return StatusCode(403, new { message = "Bạn không có quyền thêm trạm ở ngoài tỉnh được phân công." });

        station.Name       = req.Name;
        station.Code       = req.Code;
        station.Location   = req.Location;
        station.ApiUrl     = req.ApiUrl;
        station.ApiUsername = NormalizeApiUsername(req.ApiUsername ?? station.ApiUsername);
        if (!string.IsNullOrWhiteSpace(req.ApiPassword))
            station.ApiPassword = EncryptApiPassword(req.ApiPassword, useDefaultWhenEmpty: false);
        station.WebUrl     = req.WebUrl;
        station.ProvinceId = req.ProvinceId;
        if (!string.IsNullOrWhiteSpace(req.Status))
            station.Status = req.Status;

        await _db.SaveChangesAsync();
        _ = _notifier.SendStationListChangedAsync("updated", station.Id);
        return Ok(ToStationResponse(station));
    }

    /// <summary>Xóa trạm. Chỉ admin, và chỉ khi trạm không còn thiết bị nào.</summary>
    /// <param name="id">Station ID.</param>
    /// <returns>204 NoContent hoặc 400 nếu còn thiết bị.</returns>
    [HttpDelete("{id:guid}")]
    [HasPermission("station:manage")]
    public async Task<IActionResult> Delete(Guid id, [FromQuery] bool force = false)
    {
        var station = await _db.Stations.FindAsync(id);
        if (station == null) return NotFound();

        var allowedProvinceIds = await _permissions.GetAllowedProvinceIdsAsync();
        if (allowedProvinceIds != null)
        {
            if (station.ProvinceId == null || !allowedProvinceIds.Contains(station.ProvinceId.Value))
            {
                return StatusCode(403, new { message = "Bạn không có quyền xóa trạm ngoài tỉnh được gán." });
            }
        }

        // Kiểm tra xem có thiết bị nào thuộc trạm này không
        var hasDevices = await _db.Devices.AnyAsync(d => d.StationId == id);
        if (hasDevices && !force)
            return BadRequest(new { message = "Không thể xóa trạm đang có thiết bị. Xóa thiết bị trước." });

        if (!force)
        {
            var blocking = new List<string>();
            if (await _db.Alerts.AnyAsync(x => x.StationId == id)) blocking.Add("cảnh báo");
            if (await _db.SensorReadings.AnyAsync(x => x.StationId == id)) blocking.Add("dữ liệu cảm biến");
            if (await _db.DetectionEvents.AnyAsync(x => x.StationId == id)) blocking.Add("sự kiện AI");
            if (await _db.Rules.AnyAsync(x => x.StationId == id)) blocking.Add("rule");
            if (await _db.SystemSettings.AnyAsync(x => x.StationId == id)) blocking.Add("cấu hình hệ thống");
            if (await _db.Reports.AnyAsync(x => x.StationId == id)) blocking.Add("báo cáo");
            if (await _db.MaintenanceTasks.AnyAsync(x => x.StationId == id)) blocking.Add("công việc bảo trì");
            if (await _db.RuleTriggerLogs.AnyAsync(x => x.StationId == id)) blocking.Add("nhật ký kích hoạt rule");
            if (await _db.SldFiles.AnyAsync(x => x.StationId == id)) blocking.Add("file sơ đồ SLD");

            if (blocking.Count > 0)
            {
                return BadRequest(new
                {
                    message = $"Không thể xóa trạm vì còn dữ liệu liên quan: {string.Join(", ", blocking)}."
                });
            }
        }

        using var transaction = await _db.Database.BeginTransactionAsync();
        try
        {
            if (force)
            {
                _logger.LogInformation("Bắt đầu thực hiện xóa bắt buộc (force delete) cho trạm {StationId} ({StationName})", id, station.Name);

                var deviceIds = await _db.Devices
                    .Where(x => x.StationId == id)
                    .Select(x => x.Id)
                    .ToListAsync();
                _logger.LogInformation("Tìm thấy {Count} thiết bị liên quan đến trạm {StationId}", deviceIds.Count, id);

                var sldFileIds = await _db.SldFiles
                    .Where(x => x.StationId == id)
                    .Select(x => x.Id)
                    .ToListAsync();
                _logger.LogInformation("Tìm thấy {Count} files sơ đồ SLD liên quan đến trạm {StationId}", sldFileIds.Count, id);

                var alertIds = await _db.Alerts
                    .Where(x => x.StationId == id)
                    .Select(x => x.Id)
                    .ToListAsync();
                _logger.LogInformation("Tìm thấy {Count} cảnh báo liên quan đến trạm {StationId}", alertIds.Count, id);

                var ruleIds = await _db.Rules
                    .Where(x => x.StationId == id)
                    .Select(x => x.Id)
                    .ToListAsync();

                var boundaryIds = deviceIds.Count == 0
                    ? new List<Guid>()
                    : await _db.Boundaries.Where(x => deviceIds.Contains(x.DeviceId)).Select(x => x.Id).ToListAsync();

                var mediaFileIds = deviceIds.Count == 0
                    ? new List<Guid>()
                    : await _db.MediaFiles.Where(x => deviceIds.Contains(x.CameraId)).Select(x => x.Id).ToListAsync();

                var usersToUpdate = await _db.Users
                    .Where(u => u.StationIds != null && u.StationIds.Contains(id))
                    .ToListAsync();
                _logger.LogInformation("Cập nhật quyền truy cập cho {Count} tài khoản người dùng liên quan", usersToUpdate.Count);
                foreach (var user in usersToUpdate)
                {
                    user.StationIds = user.StationIds?.Where(x => x != id).ToArray();
                }

                var teamsToUpdate = await _db.Teams
                    .Where(t => t.StationIds != null && t.StationIds.Contains(id))
                    .ToListAsync();
                _logger.LogInformation("Cập nhật quyền truy cập cho {Count} tổ/đội liên quan", teamsToUpdate.Count);
                foreach (var team in teamsToUpdate)
                {
                    team.StationIds = team.StationIds?.Where(x => x != id).ToArray();
                }

                var sldPoints = await _db.SldPoints
                    .Where(x => sldFileIds.Contains(x.SldFileId) || (x.DeviceId != null && deviceIds.Contains(x.DeviceId.Value)))
                    .ToListAsync();
                _logger.LogInformation("Xóa {Count} điểm SldPoints", sldPoints.Count);
                _db.SldPoints.RemoveRange(sldPoints);

                var alertHistories = await _db.AlertHistories
                    .Where(x => alertIds.Contains(x.AlertId))
                    .ToListAsync();
                _logger.LogInformation("Xóa {Count} lịch sử cảnh báo AlertHistories", alertHistories.Count);
                _db.AlertHistories.RemoveRange(alertHistories);

                var notifyLogs = await _db.NotifyLogs
                    .Where(x => x.AlertId != null && alertIds.Contains(x.AlertId.Value))
                    .ToListAsync();
                _logger.LogInformation("Xóa {Count} nhật ký thông báo NotifyLogs", notifyLogs.Count);
                _db.NotifyLogs.RemoveRange(notifyLogs);

                var detectionEvents = await _db.DetectionEvents
                    .Where(x => x.StationId == id
                        || deviceIds.Contains(x.CameraId)
                        || (x.AlertId != null && alertIds.Contains(x.AlertId.Value))
                        || (x.BoundaryId != null && boundaryIds.Contains(x.BoundaryId.Value))
                        || (x.MediaFileId != null && mediaFileIds.Contains(x.MediaFileId.Value)))
                    .ToListAsync();
                _logger.LogInformation("Xóa {Count} sự kiện AI DetectionEvents", detectionEvents.Count);
                _db.DetectionEvents.RemoveRange(detectionEvents);

                var ruleTriggerLogs = await _db.RuleTriggerLogs
                    .Where(x => x.StationId == id
                        || (x.RuleId != Guid.Empty && ruleIds.Contains(x.RuleId))
                        || (x.DeviceId != null && deviceIds.Contains(x.DeviceId.Value))
                        || (x.AlertId != null && alertIds.Contains(x.AlertId.Value)))
                    .ToListAsync();
                _logger.LogInformation("Xóa {Count} nhật ký kích hoạt rule RuleTriggerLogs", ruleTriggerLogs.Count);
                _db.RuleTriggerLogs.RemoveRange(ruleTriggerLogs);

                var roiPoints = await _db.RoiPoints
                    .Where(x => deviceIds.Contains(x.DeviceId))
                    .ToListAsync();
                _logger.LogInformation("Xóa {Count} điểm RoiPoints", roiPoints.Count);
                _db.RoiPoints.RemoveRange(roiPoints);

                var boundaries = await _db.Boundaries
                    .Where(x => deviceIds.Contains(x.DeviceId))
                    .ToListAsync();
                _logger.LogInformation("Xóa {Count} vùng ranh giới Boundaries", boundaries.Count);
                _db.Boundaries.RemoveRange(boundaries);

                var thermalFrames = await _db.ThermalFrames
                    .Where(x => deviceIds.Contains(x.CameraId))
                    .ToListAsync();
                _logger.LogInformation("Xóa {Count} khung ảnh nhiệt ThermalFrames", thermalFrames.Count);
                _db.ThermalFrames.RemoveRange(thermalFrames);

                var maintenanceTasks = await _db.MaintenanceTasks
                    .Where(x => x.StationId == id || (x.DeviceId != null && deviceIds.Contains(x.DeviceId.Value)) || (x.SourceAlertId != null && alertIds.Contains(x.SourceAlertId.Value)))
                    .ToListAsync();
                _logger.LogInformation("Xóa {Count} công việc bảo trì MaintenanceTasks", maintenanceTasks.Count);
                _db.MaintenanceTasks.RemoveRange(maintenanceTasks);

                var sensorReadings = await _db.SensorReadings
                    .Where(x => x.StationId == id)
                    .ToListAsync();
                _logger.LogInformation("Xóa {Count} dữ liệu cảm biến SensorReadings", sensorReadings.Count);
                _db.SensorReadings.RemoveRange(sensorReadings);

                var reports = await _db.Reports
                    .Where(x => x.StationId == id)
                    .ToListAsync();
                _logger.LogInformation("Xóa {Count} báo cáo Reports", reports.Count);
                _db.Reports.RemoveRange(reports);

                var settings = await _db.SystemSettings
                    .Where(x => x.StationId == id)
                    .ToListAsync();
                _logger.LogInformation("Xóa {Count} cấu hình hệ thống SystemSettings", settings.Count);
                _db.SystemSettings.RemoveRange(settings);

                var rules = await _db.Rules
                    .Where(x => x.StationId == id)
                    .ToListAsync();
                _logger.LogInformation("Xóa {Count} quy tắc Rules", rules.Count);
                _db.Rules.RemoveRange(rules);

                var alerts = await _db.Alerts
                    .Where(x => x.StationId == id)
                    .ToListAsync();
                _logger.LogInformation("Xóa {Count} cảnh báo Alerts", alerts.Count);
                _db.Alerts.RemoveRange(alerts);

                var sldFiles = await _db.SldFiles
                    .Where(x => x.StationId == id)
                    .ToListAsync();
                _logger.LogInformation("Xóa {Count} sơ đồ SLD SldFiles", sldFiles.Count);
                _db.SldFiles.RemoveRange(sldFiles);

                var mediaFiles = await _db.MediaFiles
                    .Where(x => deviceIds.Contains(x.CameraId))
                    .ToListAsync();
                _logger.LogInformation("Xóa {Count} tệp đa phương tiện MediaFiles", mediaFiles.Count);
                _db.MediaFiles.RemoveRange(mediaFiles);

                var devices = await _db.Devices
                    .Where(x => x.StationId == id)
                    .ToListAsync();
                _logger.LogInformation("Xóa {Count} thiết bị Devices", devices.Count);
                _db.Devices.RemoveRange(devices);
            }

            _logger.LogInformation("Xóa trạm chính {StationId}", id);

            HttpContext.Items["AuditOldValue"] = System.Text.Json.JsonSerializer.Serialize(new
            {
                name = station.Name,
                code = station.Code,
                location = station.Location,
                status = station.Status
            });

            _db.Stations.Remove(station);
            await _db.SaveChangesAsync();

            await transaction.CommitAsync();
            _logger.LogInformation("Hoàn tất xóa trạm {StationId} thành công", id);
            _ = _notifier.SendStationListChangedAsync("deleted", id);
            return NoContent();
        }
        catch (Exception ex)
        {
            await transaction.RollbackAsync();
            _logger.LogError(ex, "Lỗi xảy ra trong quá trình xóa trạm {StationId}", id);
            return StatusCode(500, new { message = "Lỗi hệ thống khi xóa trạm: " + ex.Message });
        }
    }

    [HttpPost("internal/repair-province-links")]
    [AllowAnonymous]
    public async Task<IActionResult> RepairProvinceLinks()
    {
        if (!_internalAuth.IsAuthorized(HttpContext))
            return Unauthorized(new { message = "Internal auth failed" });

        var provinces = await _db.Provinces
            .AsNoTracking()
            .Select(p => new { p.Id, p.Name, p.Code })
            .ToListAsync();

        if (provinces.Count == 0)
            return Ok(new { updated = 0, message = "Không có tỉnh nào để đối chiếu." });

        static string NormalizeProvinceToken(string value)
            => value.Trim().ToLowerInvariant()
                .Replace("tỉnh ", "")
                .Replace("thành phố ", "")
                .Replace("tp. ", "")
                .Replace("tp ", "")
                .Trim();

        static IEnumerable<string> BuildAliases(string? name, string? code)
        {
            var aliases = new HashSet<string>(StringComparer.OrdinalIgnoreCase);
            if (!string.IsNullOrWhiteSpace(name)) aliases.Add(NormalizeProvinceToken(name));
            if (!string.IsNullOrWhiteSpace(code)) aliases.Add(NormalizeProvinceToken(code));
            return aliases.Where(x => !string.IsNullOrWhiteSpace(x));
        }

        static string ExtractAddress(string? locationJson)
        {
            if (string.IsNullOrWhiteSpace(locationJson)) return string.Empty;
            try
            {
                using var doc = JsonDocument.Parse(locationJson);
                if (doc.RootElement.TryGetProperty("address", out var addressProp))
                    return addressProp.GetString() ?? string.Empty;
            }
            catch
            {
            }
            return string.Empty;
        }

        var aliasMap = provinces
            .Select(p => new
            {
                ProvinceId = p.Id,
                Aliases = BuildAliases(p.Name, p.Code).OrderByDescending(x => x.Length).ToArray()
            })
            .ToList();

        var stations = await _db.Stations.ToListAsync();
        var updated = 0;
        foreach (var station in stations)
        {
            var haystack = NormalizeProvinceToken($"{station.Name} {ExtractAddress(station.Location)}");
            if (string.IsNullOrWhiteSpace(haystack)) continue;

            var matched = aliasMap.FirstOrDefault(x => x.Aliases.Any(alias => haystack.Contains(alias)));
            if (matched == null) continue;

            if (station.ProvinceId != matched.ProvinceId)
            {
                station.ProvinceId = matched.ProvinceId;
                updated++;
            }
        }

        if (updated > 0)
            await _db.SaveChangesAsync();

        return Ok(new { updated });
    }

    private static readonly System.Collections.Concurrent.ConcurrentDictionary<Guid, (string Token, DateTime ExpiresAt, string AuthKey)> _tokenCache = new();


    private async Task<string?> GetOrFetchTokenAsync(Station station, string apiBase, bool forceRefresh = false)
    {
        var authKey = $"{ResolveApiUsername(station)}|{station.ApiPassword ?? ""}";
        if (!forceRefresh &&
            _tokenCache.TryGetValue(station.Id, out var cached) &&
            cached.ExpiresAt > DateTime.UtcNow &&
            cached.AuthKey == authKey)
        {
            return cached.Token;
        }

        // Try 1: Internal token endpoint
        try
        {
            var loginClient = _httpClientFactory.CreateClient("station-ping");
            loginClient.Timeout = TimeSpan.FromSeconds(2);
            _internalAuth.ApplyHeaders(loginClient);
            var loginRes = await loginClient.PostAsync($"{apiBase}/api/v1/auth/internal-token", JsonContent.Create(new { }));
            if (loginRes.IsSuccessStatusCode)
            {
                var loginJson = await loginRes.Content.ReadFromJsonAsync<JsonElement>();
                if (loginJson.TryGetProperty("token", out var tokenProp))
                {
                    var token = tokenProp.GetString();
                    if (!string.IsNullOrEmpty(token))
                    {
                        _tokenCache[station.Id] = (token, DateTime.UtcNow.AddMinutes(30), authKey);
                        return token;
                    }
                }
            }
        }
        catch (Exception ex)
        {
            System.Console.WriteLine($"[StationsController] Error authenticating via internal-token with child station {station.Id}: {ex.Message}");
        }

        // Try 2: Fallback to standard login endpoint with decrypted password
        try
        {
            var username = ResolveApiUsername(station);
            var decryptedPassword = "";
            try
            {
                decryptedPassword = _crypto.Decrypt(station.ApiPassword);
            }
            catch (Exception ex)
            {
                System.Console.WriteLine($"[StationsController] Decrypt failed for station {station.Id}: {ex.Message}");
                decryptedPassword = station.ApiPassword ?? "";
            }

            if (!string.IsNullOrEmpty(username))
            {
                var loginClient = _httpClientFactory.CreateClient("station-ping");
                loginClient.Timeout = TimeSpan.FromSeconds(2);
                var loginRes = await loginClient.PostAsync($"{apiBase}/api/v1/auth/login", JsonContent.Create(new
                {
                    username = username,
                    password = decryptedPassword
                }));

                if (loginRes.IsSuccessStatusCode)
                {
                    var loginJson = await loginRes.Content.ReadFromJsonAsync<JsonElement>();
                    if (loginJson.TryGetProperty("token", out var tokenProp))
                    {
                        var token = tokenProp.GetString();
                        if (!string.IsNullOrEmpty(token))
                        {
                            _tokenCache[station.Id] = (token, DateTime.UtcNow.AddMinutes(30), authKey);
                            return token;
                        }
                    }
                }
                else
                {
                    var errorStr = await loginRes.Content.ReadAsStringAsync();
                    System.Console.WriteLine($"[StationsController] Fallback login failed for station {station.Id} (Status {loginRes.StatusCode}): {errorStr}");
                }
            }
        }
        catch (Exception ex)
        {
            System.Console.WriteLine($"[StationsController] Error authenticating via fallback login with child station {station.Id}: {ex.Message}");
        }

        return null;
    }

    /// <summary>Lấy KPI thực từ trạm con (devices, alerts, points, health).</summary>
    [HttpGet("{id}/remote-kpi")]
    public async Task<IActionResult> GetRemoteKpi(Guid id)
    {
        var station = await _db.Stations.FindAsync(id);
        if (station == null || string.IsNullOrWhiteSpace(station.ApiUrl))
            return Ok(new { devicesOnline = 0, devicesTotal = 0, alertsCount = 0, points = Array.Empty<object>(), healthScores = Array.Empty<object>(), boundaries = Array.Empty<object>(), roiPoints = Array.Empty<object>(), go2rtcBase = (string?)null, rtspBase = (string?)null, webUiUrl = (string?)null, error = "no_url" });

        var apiBase    = station.ApiUrl.TrimEnd('/');
        var apiUri     = new Uri(apiBase);
        var go2rtcBase = $"{apiUri.Scheme}://{apiUri.Host}:1984";
        var rtspBase   = $"rtsp://{apiUri.Host}:8554";
        var webUiUrl   = $"{apiUri.Scheme}://{apiUri.Host}:4173";

        try
        {
            // 1. Lấy token từ cache hoặc login
            var token = await GetOrFetchTokenAsync(station, apiBase);
            if (string.IsNullOrEmpty(token))
            {
                System.Console.WriteLine($"[StationsController] Không lấy được token cho trạm {station.Name} ({station.ApiUrl})");
                return StatusCode(502, new { error = "auth_failed", message = $"Không thể đăng nhập trạm {station.Name}" });
            }
            // Ghi nhận lần kết nối thành công
            station.LastContactAt = DateTime.UtcNow;
            await _db.SaveChangesAsync();

            // 2. Gọi song song 4 endpoint trạm con
            using var client = new HttpClient { Timeout = TimeSpan.FromSeconds(3) };
            client.DefaultRequestHeaders.Authorization = new AuthenticationHeaderValue("Bearer", token);

            var devicesTask = client.GetAsync($"{apiBase}/api/v1/devices");
            var alertsTask  = client.GetAsync($"{apiBase}/api/v1/alerts?status=open&pageSize=200");
            var pointsTask  = client.GetAsync($"{apiBase}/api/v1/points");
            var healthTask  = client.GetAsync($"{apiBase}/api/v1/analytics/health");
            await Task.WhenAll(devicesTask, alertsTask, pointsTask, healthTask);

            // Nếu nhận được 401 Unauthorized từ bất kỳ endpoint nào, có thể token đã hết hạn sớm ở trạm con.
            // Thử login lại 1 lần duy nhất.
            if (devicesTask.Result.StatusCode == System.Net.HttpStatusCode.Unauthorized ||
                alertsTask.Result.StatusCode == System.Net.HttpStatusCode.Unauthorized ||
                pointsTask.Result.StatusCode == System.Net.HttpStatusCode.Unauthorized ||
                healthTask.Result.StatusCode == System.Net.HttpStatusCode.Unauthorized)
            {
                token = await GetOrFetchTokenAsync(station, apiBase, forceRefresh: true);
                if (string.IsNullOrEmpty(token))
                    return Ok(new { devicesOnline = 0, devicesTotal = 0, alertsCount = 0, points = Array.Empty<object>(), healthScores = Array.Empty<object>(), boundaries = Array.Empty<object>(), roiPoints = Array.Empty<object>(), go2rtcBase, rtspBase, webUiUrl, error = "auth_failed" });

                client.DefaultRequestHeaders.Authorization = new AuthenticationHeaderValue("Bearer", token);
                devicesTask = client.GetAsync($"{apiBase}/api/v1/devices");
                alertsTask  = client.GetAsync($"{apiBase}/api/v1/alerts?status=open&pageSize=200");
                pointsTask  = client.GetAsync($"{apiBase}/api/v1/points");
                healthTask  = client.GetAsync($"{apiBase}/api/v1/analytics/health");
                await Task.WhenAll(devicesTask, alertsTask, pointsTask, healthTask);
            }

            int devicesTotal = 0, devicesOnline = 0, alertsCount = 0;
            var pointsList      = new List<object>();
            var healthList      = new List<object>();
            var cameraDeviceIds = new List<string>();

            if (devicesTask.Result.IsSuccessStatusCode)
            {
                var devJson = await devicesTask.Result.Content.ReadFromJsonAsync<JsonElement>();
                var arr = devJson.ValueKind == JsonValueKind.Array ? devJson
                        : devJson.TryGetProperty("items", out var items) ? items
                        : devJson.TryGetProperty("data",  out var data)  ? data
                        : default;
                if (arr.ValueKind == JsonValueKind.Array)
                {
                    devicesTotal = arr.GetArrayLength();
                    foreach (var d in arr.EnumerateArray())
                    {
                        if (d.TryGetProperty("status", out var s) && s.GetString() == "online")
                            devicesOnline++;
                        // Thu thập ID của camera thermal/pd để sau lấy boundaries
                        if (d.TryGetProperty("type", out var t))
                        {
                            var dtype = t.GetString() ?? "";
                            if (dtype.StartsWith("camera_thermal") || dtype.StartsWith("camera_pd") || dtype.StartsWith("camera_dual"))
                            {
                                if (d.TryGetProperty("id", out var did))
                                    cameraDeviceIds.Add(did.GetString() ?? "");
                            }
                        }
                    }
                }
            }

            if (alertsTask.Result.IsSuccessStatusCode)
            {
                var alJson = await alertsTask.Result.Content.ReadFromJsonAsync<JsonElement>();
                var arr = alJson.ValueKind == JsonValueKind.Array ? alJson
                        : alJson.TryGetProperty("items", out var items) ? items
                        : alJson.TryGetProperty("data",  out var data)  ? data
                        : default;
                if (arr.ValueKind == JsonValueKind.Array)
                    alertsCount = arr.GetArrayLength();
            }

            var existingPointKeys = new HashSet<string>(StringComparer.OrdinalIgnoreCase);
            if (pointsTask.Result.IsSuccessStatusCode)
            {
                var ptJson = await pointsTask.Result.Content.ReadFromJsonAsync<JsonElement>();
                if (ptJson.ValueKind == JsonValueKind.Array)
                    foreach (var p in ptJson.EnumerateArray())
                    {
                        pointsList.Add(p);
                        if (p.TryGetProperty("deviceId", out var did) && p.TryGetProperty("pointId", out var pid))
                            existingPointKeys.Add($"{did.GetString()}_{pid.GetString()}");
                    }
            }

            if (healthTask.Result.IsSuccessStatusCode)
            {
                var hlJson = await healthTask.Result.Content.ReadFromJsonAsync<JsonElement>();
                if (hlJson.ValueKind == JsonValueKind.Array)
                    foreach (var h in hlJson.EnumerateArray())
                        healthList.Add(h);
            }

            // Wave 2: lấy boundaries (vùng ROI + PD) và roi-points cho từng camera
            var boundariesList = new List<object>();
            var roiPointsList  = new List<object>();
            var validCameraIds = cameraDeviceIds.Where(id => !string.IsNullOrWhiteSpace(id)).Distinct().Take(15).ToList();
            if (validCameraIds.Count > 0)
            {
                try
                {
                    // boundaries: AllowAnonymous — dùng client không cần token
                    using var boundaryClient = new HttpClient { Timeout = TimeSpan.FromSeconds(3) };
                    var bTasks = validCameraIds
                        .Select(id => boundaryClient.GetAsync($"{apiBase}/api/v1/devices/{id}/boundaries"))
                        .ToList();
                    // roi-points: yêu cầu auth — dùng client có token
                    var rTasks = validCameraIds
                        .Where(id => !string.IsNullOrWhiteSpace(id))
                        .Select(id => client.GetAsync($"{apiBase}/api/v1/devices/{id}/roi-points"))
                        .ToList();
                    // thermal-readings: lấy nhiệt độ tức thời của từng điểm ROI trên camera nhiệt
                    var tTasks = validCameraIds
                        .Select(id => client.GetAsync($"{apiBase}/api/v1/devices/{id}/thermal-readings"))
                        .ToList();
                    await Task.WhenAll(bTasks.Cast<Task>().Concat(rTasks.Cast<Task>()).Concat(tTasks.Cast<Task>()));

                    foreach (var bt in bTasks)
                    {
                        if (bt.IsCompletedSuccessfully && bt.Result.IsSuccessStatusCode)
                        {
                            var bJson = await bt.Result.Content.ReadFromJsonAsync<JsonElement>();
                            if (bJson.ValueKind == JsonValueKind.Array)
                                foreach (var b in bJson.EnumerateArray())
                                    boundariesList.Add(b);
                        }
                    }
                    foreach (var rt in rTasks)
                    {
                        if (rt.IsCompletedSuccessfully && rt.Result.IsSuccessStatusCode)
                        {
                            var rJson = await rt.Result.Content.ReadFromJsonAsync<JsonElement>();
                            if (rJson.ValueKind == JsonValueKind.Array)
                                foreach (var r in rJson.EnumerateArray())
                                    roiPointsList.Add(r);
                        }
                    }
                    // Merge thermal readings vào pointsList, bỏ qua các điểm đã có từ /points
                    foreach (var (camId, tt) in validCameraIds.Zip(tTasks))
                    {
                        if (!tt.IsCompletedSuccessfully || !tt.Result.IsSuccessStatusCode) continue;
                        var trJson = await tt.Result.Content.ReadFromJsonAsync<JsonElement>();
                        if (trJson.ValueKind != JsonValueKind.Object) continue;
                        foreach (var prop in trJson.EnumerateObject())
                        {
                            if (prop.Value.ValueKind != JsonValueKind.Number) continue;
                            var dedupeKey = $"{camId}_{prop.Name}";
                            if (existingPointKeys.Contains(dedupeKey)) continue;
                            pointsList.Add(new
                            {
                                deviceId = camId,
                                pointId  = prop.Name,
                                value    = Math.Round(prop.Value.GetDouble(), 2),
                                unit     = "°C",
                                quality  = 0,
                                time     = DateTime.UtcNow
                            });
                            existingPointKeys.Add(dedupeKey);
                        }
                    }
                }
                catch { /* best-effort — không fail toàn bộ KPI vì boundaries/roiPoints/thermalReadings */ }
            }

            return Ok(new { devicesOnline, devicesTotal, alertsCount, points = pointsList, healthScores = healthList, boundaries = boundariesList, roiPoints = roiPointsList, go2rtcBase, rtspBase, webUiUrl });
        }
        catch (Exception ex)
        {
            return Ok(new { devicesOnline = 0, devicesTotal = 0, alertsCount = 0, points = Array.Empty<object>(), healthScores = Array.Empty<object>(), boundaries = Array.Empty<object>(), roiPoints = Array.Empty<object>(), go2rtcBase, rtspBase, webUiUrl, error = ex.Message });
        }
    }

    /// <summary>
    /// Proxy danh sách cảnh báo từ trạm con — hỗ trợ lọc status, from, to, limit.
    /// Trả về mảng AlertItem với stationId gắn vào để frontend phân biệt nguồn.
    /// </summary>
    [HttpGet("{id}/remote-alerts")]
    public async Task<IActionResult> GetRemoteAlerts(
        Guid id,
        [FromQuery] string? status,
        [FromQuery] DateTime? from,
        [FromQuery] DateTime? to,
        [FromQuery] int limit = 200)
    {
        var station = await _db.Stations.FindAsync(id);
        if (station == null || string.IsNullOrWhiteSpace(station.ApiUrl))
            return Ok(Array.Empty<object>());

        var apiBase = station.ApiUrl.TrimEnd('/');

        try
        {
            var token = await GetOrFetchTokenAsync(station, apiBase);
            if (string.IsNullOrEmpty(token))
                return Ok(Array.Empty<object>());

            using var client = new HttpClient { Timeout = TimeSpan.FromSeconds(8) };
            client.DefaultRequestHeaders.Authorization = new AuthenticationHeaderValue("Bearer", token);

            var qp = new System.Collections.Specialized.NameValueCollection();
            if (!string.IsNullOrEmpty(status)) qp["status"] = status;
            if (from.HasValue)  qp["from"]  = from.Value.ToString("o");
            if (to.HasValue)    qp["to"]    = to.Value.ToString("o");
            qp["limit"] = limit.ToString();
            var qs = string.Join("&", Array.ConvertAll(qp.AllKeys!, k => $"{k}={Uri.EscapeDataString(qp[k]!)}"));

            var res = await client.GetAsync($"{apiBase}/api/v1/alerts?{qs}");

            if (res.StatusCode == System.Net.HttpStatusCode.Unauthorized)
            {
                token = await GetOrFetchTokenAsync(station, apiBase, forceRefresh: true);
                if (string.IsNullOrEmpty(token)) return Ok(Array.Empty<object>());
                client.DefaultRequestHeaders.Authorization = new AuthenticationHeaderValue("Bearer", token);
                res = await client.GetAsync($"{apiBase}/api/v1/alerts?{qs}");
            }

            if (!res.IsSuccessStatusCode) return Ok(Array.Empty<object>());

            var json = await res.Content.ReadFromJsonAsync<JsonElement>();
            var arr = json.ValueKind == JsonValueKind.Array ? json
                    : json.TryGetProperty("items", out var items) ? items
                    : json.TryGetProperty("data",  out var data)  ? data
                    : default;

            if (arr.ValueKind != JsonValueKind.Array) return Ok(Array.Empty<object>());

            // Gắn thêm stationId và stationName vào mỗi alert để frontend nhận biết nguồn
            string? ResolveUrl(string? path)
            {
                if (string.IsNullOrEmpty(path)) return null;
                if (path.StartsWith("http://") || path.StartsWith("https://") || path.StartsWith("data:")) return path;
                return $"{apiBase}{(path.StartsWith("/") ? "" : "/")}{path}";
            }

            var result = arr.EnumerateArray().Select(a => new
            {
                id           = GetProp(a, "id"),
                source       = GetProp(a, "source"),
                level        = GetProp(a, "level"),
                status       = GetProp(a, "status"),
                message      = GetProp(a, "message"),
                value        = GetDoubleProp(a, "value"),
                deviceId     = GetProp(a, "deviceId"),
                ruleId       = GetProp(a, "ruleId"),
                stationId    = id,
                stationName  = station.Name,
                triggeredAt  = GetProp(a, "triggeredAt"),
                ackedAt      = GetProp(a, "ackedAt"),
                closedAt     = GetProp(a, "closedAt"),
                ackNote      = GetProp(a, "ackNote"),
                imageUrl     = ResolveUrl(GetProp(a, "imageUrl")),
                videoUrl     = ResolveUrl(GetProp(a, "videoUrl")),
                thumbnailUrl = ResolveUrl(GetProp(a, "thumbnailUrl")),
            }).ToList();

            return Ok(result);
        }
        catch
        {
            return Ok(Array.Empty<object>());
        }
    }

    private static string? GetProp(JsonElement el, string name)
    {
        if (el.TryGetProperty(name, out var v) && v.ValueKind != JsonValueKind.Null)
            return v.ToString();
        return null;
    }

    private static double? GetDoubleProp(JsonElement el, string name)
    {
        if (el.TryGetProperty(name, out var v) && v.ValueKind == JsonValueKind.Number)
            return v.GetDouble();
        return null;
    }

    /// <summary>
    /// Lấy danh sách camera từ trạm con + URL stream go2rtc của trạm con.
    /// go2rtc của trạm con chạy port 1984 (WebRTC/HLS) và 8554 (RTSP).
    /// </summary>
    [HttpGet("{id}/remote-cameras")]
    public async Task<IActionResult> GetRemoteCameras(Guid id)
    {
        var station = await _db.Stations.FindAsync(id);
        if (station == null || string.IsNullOrWhiteSpace(station.ApiUrl))
            return Ok(new { go2rtcBase = (string?)null, rtspBase = (string?)null, cameras = Array.Empty<object>() });

        var apiBase = station.ApiUrl.TrimEnd('/');

        // Derive go2rtc URLs từ host của apiUrl (theo tài liệu trạm con: port 1984 WebRTC, 8554 RTSP)
        var uri       = new Uri(apiBase);
        var go2rtcBase = $"{uri.Scheme}://{uri.Host}:1984";
        var rtspBase   = $"rtsp://{uri.Host}:8554";

        try
        {
            var token = await GetOrFetchTokenAsync(station, apiBase);
            if (string.IsNullOrEmpty(token))
                return Ok(new { go2rtcBase, rtspBase, cameras = Array.Empty<object>() });

            // Ghi nhận lần kết nối thành công
            station.LastContactAt = DateTime.UtcNow;
            await _db.SaveChangesAsync();

            using var client = new HttpClient { Timeout = TimeSpan.FromSeconds(3) };
            client.DefaultRequestHeaders.Authorization = new AuthenticationHeaderValue("Bearer", token);

            // Lấy tất cả devices vì filter type=camera không đồng nhất giữa các phiên bản trạm con
            var res = await client.GetAsync($"{apiBase}/api/v1/devices");
            if (res.StatusCode == System.Net.HttpStatusCode.Unauthorized)
            {
                token = await GetOrFetchTokenAsync(station, apiBase, forceRefresh: true);
                if (string.IsNullOrEmpty(token))
                    return Ok(new { go2rtcBase, rtspBase, cameras = Array.Empty<object>() });

                client.DefaultRequestHeaders.Authorization = new AuthenticationHeaderValue("Bearer", token);
                res = await client.GetAsync($"{apiBase}/api/v1/devices");
            }

            if (!res.IsSuccessStatusCode)
                return Ok(new { go2rtcBase, rtspBase, cameras = Array.Empty<object>() });

            var json = await res.Content.ReadFromJsonAsync<JsonElement>();
            var all = json.ValueKind == JsonValueKind.Array ? json
                    : json.TryGetProperty("items", out var items) ? items
                    : json.TryGetProperty("data",  out var data)  ? data
                    : default;

            // Lọc chỉ lấy camera (type bắt đầu bằng "camera")
            var arr = all.ValueKind == JsonValueKind.Array
                ? (IEnumerable<JsonElement>)all.EnumerateArray()
                    .Where(d => d.TryGetProperty("type", out var t) && t.GetString()?.StartsWith("camera") == true)
                : Enumerable.Empty<JsonElement>();

            // Enrich mỗi camera với stream URLs từ go2rtc của trạm con
            var cameras = new List<object>();
            foreach (var d in arr)
            {
                // Parse config để lấy tên stream go2rtc
                string? go2rtcOptical = null, go2rtcThermal = null, go2rtcId = null;
                if (d.TryGetProperty("config", out var cfgEl))
                {
                    try
                    {
                        var cfgStr = cfgEl.ValueKind == JsonValueKind.String
                            ? cfgEl.GetString()
                            : cfgEl.GetRawText();
                        var cfg = JsonSerializer.Deserialize<JsonElement>(cfgStr ?? "{}");
                        if (cfg.TryGetProperty("go2rtc_optical", out var vo)) go2rtcOptical = vo.GetString();
                        if (cfg.TryGetProperty("go2rtc_thermal", out var vt)) go2rtcThermal = vt.GetString();
                        if (cfg.TryGetProperty("go2rtc_id",      out var vi)) go2rtcId      = vi.GetString();
                    }
                    catch { }
                }

                // Xây dựng streamUrls cho từng camera
                var streamUrls = new Dictionary<string, string>();
                if (!string.IsNullOrEmpty(go2rtcOptical))
                {
                    streamUrls["optical_webrtc"] = $"{go2rtcBase}/api/ws?src={go2rtcOptical}";
                    streamUrls["optical_hls"]    = $"{go2rtcBase}/api/stream.m3u8?src={go2rtcOptical}";
                    streamUrls["optical_rtsp"]   = $"{rtspBase}/{go2rtcOptical}";
                }
                if (!string.IsNullOrEmpty(go2rtcThermal))
                {
                    streamUrls["thermal_webrtc"] = $"{go2rtcBase}/api/ws?src={go2rtcThermal}";
                    streamUrls["thermal_hls"]    = $"{go2rtcBase}/api/stream.m3u8?src={go2rtcThermal}";
                    streamUrls["thermal_rtsp"]   = $"{rtspBase}/{go2rtcThermal}";
                }
                if (!string.IsNullOrEmpty(go2rtcId))
                {
                    streamUrls["main_webrtc"] = $"{go2rtcBase}/api/ws?src={go2rtcId}";
                    streamUrls["main_hls"]    = $"{go2rtcBase}/api/stream.m3u8?src={go2rtcId}";
                    streamUrls["main_rtsp"]   = $"{rtspBase}/{go2rtcId}";
                }

                cameras.Add(new { device = d, streamUrls, go2rtcBase, rtspBase });
            }

            return Ok(new { go2rtcBase, rtspBase, cameras });
        }
        catch
        {
            return Ok(new { go2rtcBase, rtspBase, cameras = Array.Empty<object>() });
        }
    }

    /// <summary>Lấy JWT token từ trạm con để SSO (trạm tổng không cần login lại).</summary>
    [HttpGet("{id}/remote-token")]
    public async Task<IActionResult> GetRemoteToken(Guid id)
    {
        var station = await _db.Stations.FindAsync(id);
        if (station == null || string.IsNullOrWhiteSpace(station.ApiUrl))
            return NotFound(new { error = "no_url" });

        var apiBase = station.ApiUrl.TrimEnd('/');
        try
        {
            var token = await GetOrFetchTokenAsync(station, apiBase);
            if (string.IsNullOrEmpty(token))
                return BadRequest(new { error = "auth_failed" });
            return Ok(new { token });
        }
        catch (Exception ex)
        {
            return BadRequest(new { error = ex.Message });
        }
    }

    /// <summary>Kiểm tra kết nối tới trạm con qua ApiUrl.</summary>
    [HttpPost("test-connection")]
    [HasPermission("station:manage")]
    public async Task<IActionResult> TestConnection([FromBody] StationPingRequest req)
    {
        if (string.IsNullOrWhiteSpace(req.Url))
            return BadRequest(new { reachable = false, error = "URL không được để trống" });

        var url = req.Url.TrimEnd('/');
        var sw = System.Diagnostics.Stopwatch.StartNew();
        try
        {
            var client = _httpClientFactory.CreateClient("station-ping");
            var res = await client.GetAsync(url);
            sw.Stop();
            if (res.IsSuccessStatusCode)
                return Ok(new { reachable = true, responseMs = sw.ElapsedMilliseconds });

            return Ok(new { reachable = false, responseMs = sw.ElapsedMilliseconds, error = $"HTTP {(int)res.StatusCode}" });
        }
        catch (Exception ex)
        {
            sw.Stop();
            return Ok(new { reachable = false, responseMs = sw.ElapsedMilliseconds, error = ex.Message });
        }
    }

    private async Task<IActionResult> ProxyGetToStationAsync(Guid id, string subPath, string? queryString = null)
    {
        var station = await _db.Stations.FindAsync(id);
        if (station == null || string.IsNullOrWhiteSpace(station.ApiUrl))
            return NotFound(new { error = "station_not_found" });

        var apiBase = station.ApiUrl.TrimEnd('/');
        try
        {
            var token = await GetOrFetchTokenAsync(station, apiBase);
            if (string.IsNullOrEmpty(token))
            {
                return StatusCode(502, new { error = "auth_failed", message = $"Không thể đăng nhập trạm {station.Name}" });
            }

            using var client = _httpClientFactory.CreateClient();
            client.Timeout = TimeSpan.FromSeconds(10);
            client.DefaultRequestHeaders.Authorization = new AuthenticationHeaderValue("Bearer", token);

            var url = $"{apiBase}{subPath}";
            if (!string.IsNullOrEmpty(queryString))
            {
                url += queryString;
            }

            var resp = await client.GetAsync(url);
            if (resp.StatusCode == System.Net.HttpStatusCode.Unauthorized)
            {
                token = await GetOrFetchTokenAsync(station, apiBase, forceRefresh: true);
                if (string.IsNullOrEmpty(token))
                    return StatusCode(502, new { error = "auth_failed" });

                client.DefaultRequestHeaders.Authorization = new AuthenticationHeaderValue("Bearer", token);
                resp = await client.GetAsync(url);
            }

            var body = await resp.Content.ReadAsStringAsync();
            return new ContentResult
            {
                Content = body,
                ContentType = "application/json",
                StatusCode = (int)resp.StatusCode
            };
        }
        catch (Exception ex)
        {
            return StatusCode(502, new { error = "station_unreachable", detail = ex.Message });
        }
    }

    private async Task<IActionResult> ProxyToLocalAiEngineAsync(string subPath, string? queryString = null)
    {
        try
        {
            using var client = _httpClientFactory.CreateClient();
            client.Timeout = TimeSpan.FromSeconds(10);

            var url = $"http://127.0.0.1:8100{subPath}";
            if (!string.IsNullOrEmpty(queryString))
            {
                url += queryString;
            }

            var resp = await client.GetAsync(url);
            var body = await resp.Content.ReadAsStringAsync();
            return Content(body, "application/json");
        }
        catch (Exception ex)
        {
            return StatusCode(503, new { error = "ai_engine_unreachable", detail = ex.Message });
        }
    }

    [HttpGet("{id}/remote-prediction-history")]
    public async Task<IActionResult> GetRemotePredictionHistory(Guid id)
    {
        return await ProxyGetToStationAsync(id, "/api/v1/stations/local-prediction-history", Request.QueryString.Value);
    }

    [HttpGet("{id}/remote-latest-prediction")]
    public async Task<IActionResult> GetRemoteLatestPrediction(Guid id)
    {
        return await ProxyGetToStationAsync(id, "/api/v1/stations/local-latest-prediction", Request.QueryString.Value);
    }

    [HttpGet("{id}/remote-training-status")]
    public async Task<IActionResult> GetRemoteTrainingStatus(Guid id)
    {
        return await ProxyGetToStationAsync(id, "/api/v1/stations/local-training-status", Request.QueryString.Value);
    }

    [HttpGet("{id}/remote-prediction-config")]
    public async Task<IActionResult> GetRemotePredictionConfig(Guid id)
    {
        return await ProxyGetToStationAsync(id, "/api/v1/stations/local-prediction-config", Request.QueryString.Value);
    }

    [HttpGet("{id}/remote-detections")]
    public async Task<IActionResult> GetRemoteDetections(Guid id)
    {
        return await ProxyGetToStationAsync(id, "/api/v1/detections", Request.QueryString.Value);
    }

    [HttpGet("local-prediction-history")]
    public async Task<IActionResult> GetLocalPredictionHistory()
    {
        return await ProxyToLocalAiEngineAsync("/api/prediction/history", Request.QueryString.Value);
    }

    [HttpGet("local-latest-prediction")]
    public async Task<IActionResult> GetLocalLatestPrediction()
    {
        return await ProxyToLocalAiEngineAsync("/api/latest-prediction", Request.QueryString.Value);
    }

    [HttpGet("local-training-status")]
    public async Task<IActionResult> GetLocalTrainingStatus()
    {
        return await ProxyToLocalAiEngineAsync("/api/training-status", Request.QueryString.Value);
    }

    [HttpGet("local-prediction-config")]
    public async Task<IActionResult> GetLocalPredictionConfig()
    {
        return await ProxyToLocalAiEngineAsync("/api/config", Request.QueryString.Value);
    }

    /// <summary>Tự động suy URL giao diện web từ URL API theo quy ước cổng.</summary>
    private static string? DeriveWebUrl(string? apiUrl)
    {
        if (string.IsNullOrWhiteSpace(apiUrl)) return null;
        try
        {
            var uri = new Uri(apiUrl.TrimEnd('/'));
            var newPort = uri.Port switch
            {
                5000 => 4173,   // child StationOS
                6000 => 6173,   // master StationOS
                _    => uri.Port
            };
            return $"{uri.Scheme}://{uri.Host}:{newPort}";
        }
        catch { return null; }
    }

    private object ToStationResponse(Station station) => new
    {
        station.Id,
        station.Name,
        station.Code,
        station.Location,
        station.Status,
        station.CreatedAt,
        station.ApiUrl,
        apiUsername = ResolveApiUsername(station),
        hasApiPassword = !string.IsNullOrWhiteSpace(station.ApiPassword),
        webUrl = station.WebUrl ?? DeriveWebUrl(station.ApiUrl),
        lastSeenAt = station.LastContactAt,
        station.ProvinceId
    };

    private static string NormalizeApiUsername(string? value)
        => string.IsNullOrWhiteSpace(value) ? DefaultApiUsername : value.Trim();

    private string EncryptApiPassword(string? value, bool useDefaultWhenEmpty)
    {
        var raw = string.IsNullOrWhiteSpace(value)
            ? (useDefaultWhenEmpty ? DefaultApiPassword : null)
            : value.Trim();
        return string.IsNullOrWhiteSpace(raw) ? "" : _crypto.Encrypt(raw);
    }

    private static string ResolveApiUsername(Station station) => NormalizeApiUsername(station.ApiUsername);
}

public record StationRequest(string Name, string? Code, string? Location, string? Status, string? ApiUrl, string? ApiUsername, string? ApiPassword, string? WebUrl, Guid? ProvinceId = null);
public record StationPingRequest(string Url);

// ============================================================
// LicenseService — Quản lý license key và concurrent sessions
// Hỗ trợ 5 định dạng key:
//   4 phần:  TIER-YYMMDD-NONCE-HMAC8          (mặc định theo tier)
//   5 phần:  TIER-YYMMDD-MAXUSERS-NONCE-HMAC8
//   7 phần:  TIER-YYMMDD-MAXDEVS-MAXCAMS-MAXROI-NONCE-HMAC8
//   9 phần:  TIER-YYMMDD-MAXDEVS-MAXCAMS-MAXROI-MAXROIREG-MAXPDREG-NONCE-HMAC8
//  10 phần:  TIER-YYMMDD-MAXUSERS-MAXDEVS-MAXCAMS-MAXROI-MAXROIREG-MAXPDREG-NONCE-HMAC8
// ============================================================

using System.Collections.Concurrent;
using System.Security.Cryptography;
using System.Text;
using System.Text.Json;
using Microsoft.AspNetCore.Http;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Configuration;
using Microsoft.Extensions.DependencyInjection;
using StationOS.Data;
using StationOS.Data.Entities;
using StationOS.Services.Licensing;

namespace StationOS.Services;

public class LicenseService
{
    private readonly IServiceScopeFactory _scopeFactory;
    private readonly string? _vendorPrivateKey;
    private readonly string _vendorSecret;
    private readonly LicenseManager _licenseManager;

    // In-memory session tracking: tokenHash → ActiveSessionInfo
    private readonly ConcurrentDictionary<string, ActiveSessionInfo> _activeSessions = new();

    public LicenseService(IServiceScopeFactory scopeFactory, IConfiguration config)
        : this(scopeFactory, config, new LicenseManager(config, scopeFactory))
    {
    }

    [ActivatorUtilitiesConstructor]
    public LicenseService(IServiceScopeFactory scopeFactory, IConfiguration config, LicenseManager licenseManager)
    {
        _scopeFactory = scopeFactory;
        _licenseManager = licenseManager;
        _vendorPrivateKey = Environment.GetEnvironmentVariable("STATIONOS_VENDOR_PRIVATE_KEY")
                            ?? config["License:VendorPrivateKey"];
        _vendorSecret = Environment.GetEnvironmentVariable("STATIONOS_VENDOR_SECRET") 
                        ?? config["License:VendorSecret"] 
                        ?? string.Empty;
    }

    // ── Default resource limits per tier ──────────────────────
    private static (int maxUsers, int maxStations, int maxCameras, int maxSensors, int maxRoiPoints, int maxRoiRegions, int maxPdRegions) GetTierDefaults(string tier)
    {
        return tier switch
        {
            // ROI / PD không còn mặc định vô hạn. Bản license gốc tập trung vào trạm và thiết bị/camera.
            "SOLO" => (1,   1,   2,   2,   0,   0,   0),
            "TEAM" => (5,   10,  8,   8,   0,   0,   0),
            "ENT"  => (999, 999, 999, 999, 0,   0,   0),
            _      => (-1, -1, -1, -1, -1, -1, -1)
        };
    }

    // ── Key validation ─────────────────────────────────────────

    /// <summary>
    /// Xác thực License Key — hỗ trợ 5 định dạng (4/5/7/9/10 phần).
    /// Trả về LicenseKeyInfo chứa toàn bộ giới hạn tài nguyên.
    /// </summary>
    public LicenseKeyInfo ValidateKey(string key)
    {
        var normalizedKey = key.ToUpper().Trim();
        if (normalizedKey == "STATION-MONITOR-ENTERPRISE-UNLIMITED")
        {
            return new LicenseKeyInfo(true, "ent", 99999, 99999, 99999, 99999, 99999, 99999, 99999, DateTime.UtcNow.AddYears(100), "");
        }

        var parts = normalizedKey.Split('-');
        
        string tier;
        DateTime expiresAt;
        int maxUsers;
        int maxStations;
        int maxCameras;
        int maxSensors;
        int maxRoiPoints;
        int maxRoiRegions;
        int maxPdRegions;
        string nonce;
        string hmacIn;

        if (parts.Length >= 10)
        {
            // Parse custom commercial packages (e.g. CML-SDL500-CAM8-SEL2-291231-3-12-8-500-50-50-A1B2-C3D4E5F6)
            var tierParts = new string[parts.Length - 9];
            Array.Copy(parts, tierParts, parts.Length - 9);
            tier = string.Join("-", tierParts);

            var expire = parts[parts.Length - 9];
            if (expire.Length != 6 ||
                !DateTime.TryParseExact("20" + expire, "yyyyMMdd",
                    null, System.Globalization.DateTimeStyles.None, out expiresAt))
                return LicenseKeyInfo.Error("Ngày hết hạn không đúng định dạng YYMMDD");

            if (!int.TryParse(parts[parts.Length - 8], out maxUsers) || maxUsers < 1)
                return LicenseKeyInfo.Error("MaxUsers phải là số nguyên dương");
            if (!int.TryParse(parts[parts.Length - 7], out maxStations) || maxStations < 1)
                return LicenseKeyInfo.Error("MaxDevices/Stations phải là số nguyên dương");
            if (!int.TryParse(parts[parts.Length - 6], out maxCameras) || maxCameras < 1)
                return LicenseKeyInfo.Error("MaxCameras phải là số nguyên dương");
            maxSensors = maxCameras;
            if (!int.TryParse(parts[parts.Length - 5], out maxRoiPoints) || maxRoiPoints < 1)
                return LicenseKeyInfo.Error("MaxRoiPoints phải là số nguyên dương");
            if (!int.TryParse(parts[parts.Length - 4], out maxRoiRegions) || maxRoiRegions < 1)
                return LicenseKeyInfo.Error("MaxRoiRegions phải là số nguyên dương");
            if (!int.TryParse(parts[parts.Length - 3], out maxPdRegions) || maxPdRegions < 1)
                return LicenseKeyInfo.Error("MaxPdRegions phải là số nguyên dương");

            nonce  = parts[parts.Length - 2];
            hmacIn = parts[parts.Length - 1];
        }
        else
        {
            // Legacy keys parsing (parts.Length < 10)
            if (parts.Length is not (4 or 5 or 7 or 9))
                return LicenseKeyInfo.Error("Định dạng key không hợp lệ (cần 4/5/7/9 phần, phân tách bởi dấu -)");

            tier = parts[0];
            var expire = parts[1];
            
            var defaults = GetTierDefaults(tier);
            if (defaults.maxUsers < 0)
                return LicenseKeyInfo.Error("Tier không hợp lệ (SOLO / TEAM / ENT)");

            if (expire.Length != 6 ||
                !DateTime.TryParseExact("20" + expire, "yyyyMMdd",
                    null, System.Globalization.DateTimeStyles.None, out expiresAt))
                return LicenseKeyInfo.Error("Ngày hết hạn không đúng định dạng YYMMDD");

            maxUsers      = defaults.maxUsers;
            maxStations   = defaults.maxStations;
            maxCameras    = defaults.maxCameras;
            maxSensors    = defaults.maxSensors;
            maxRoiPoints  = defaults.maxRoiPoints;
            maxRoiRegions = defaults.maxRoiRegions;
            maxPdRegions  = defaults.maxPdRegions;

            switch (parts.Length)
            {
                case 4:
                    nonce  = parts[2];
                    hmacIn = parts[3];
                    break;
                case 5:
                    if (!int.TryParse(parts[2], out maxUsers) || maxUsers < 1)
                        return LicenseKeyInfo.Error("MaxUsers phải là số nguyên dương");
                    nonce  = parts[3];
                    hmacIn = parts[4];
                    break;
                case 7:
                    if (!int.TryParse(parts[2], out maxStations) || maxStations < 1)
                        return LicenseKeyInfo.Error("MaxDevices/Stations phải là số nguyên dương");
                    if (!int.TryParse(parts[3], out maxCameras) || maxCameras < 1)
                        return LicenseKeyInfo.Error("MaxCameras phải là số nguyên dương");
                    maxSensors = maxCameras;
                    if (!int.TryParse(parts[4], out maxRoiPoints) || maxRoiPoints < 1)
                        return LicenseKeyInfo.Error("MaxRoiPoints phải là số nguyên dương");
                    nonce  = parts[5];
                    hmacIn = parts[6];
                    break;
                case 9:
                    if (!int.TryParse(parts[2], out maxStations) || maxStations < 1)
                        return LicenseKeyInfo.Error("MaxDevices/Stations phải là số nguyên dương");
                    if (!int.TryParse(parts[3], out maxCameras) || maxCameras < 1)
                        return LicenseKeyInfo.Error("MaxCameras phải là số nguyên dương");
                    maxSensors = maxCameras;
                    if (!int.TryParse(parts[4], out maxRoiPoints) || maxRoiPoints < 1)
                        return LicenseKeyInfo.Error("MaxRoiPoints phải là số nguyên dương");
                    if (!int.TryParse(parts[5], out maxRoiRegions) || maxRoiRegions < 1)
                        return LicenseKeyInfo.Error("MaxRoiRegions phải là số nguyên dương");
                    if (!int.TryParse(parts[6], out maxPdRegions) || maxPdRegions < 1)
                        return LicenseKeyInfo.Error("MaxPdRegions phải là số nguyên dương");
                    nonce  = parts[7];
                    hmacIn = parts[8];
                    break;
                default:
                    return LicenseKeyInfo.Error("Định dạng key không hợp lệ");
            }
        }

        // Validate nonce (4 ký tự hex)
        if (nonce.Length != 4)
            return LicenseKeyInfo.Error("Nonce phải là 4 ký tự hex");

        // Xác thực HMAC — payload = tất cả phần trước HMAC
        var payloadParts = new string[parts.Length - 1];
        Array.Copy(parts, payloadParts, parts.Length - 1);
        var payload  = string.Join("-", payloadParts);
        var expected = ComputeHmac8(payload);
        if (hmacIn != expected)
            return LicenseKeyInfo.Error("Chữ ký không hợp lệ — key bị sai hoặc giả mạo");

        // Kiểm tra hết hạn
        var expiresUtc = DateTime.SpecifyKind(expiresAt, DateTimeKind.Utc);
        if (DateTime.UtcNow > expiresUtc)
            return new LicenseKeyInfo(false, tier.ToLower(), maxUsers, maxStations, maxCameras,
                maxSensors, maxRoiPoints, maxRoiRegions, maxPdRegions, expiresUtc, "License đã hết hạn");

        return new LicenseKeyInfo(true, tier.ToLower(), maxUsers, maxStations, maxCameras,
            maxSensors, maxRoiPoints, maxRoiRegions, maxPdRegions, expiresUtc, "");
    }

    private string ComputeHmac8(string payload)
    {
        var key  = Encoding.UTF8.GetBytes(_vendorSecret);
        var data = Encoding.UTF8.GetBytes(payload);
        var hash = HMACSHA256.HashData(key, data);
        return Convert.ToHexString(hash)[..8];
    }

    // ── Activate ───────────────────────────────────────────────

    public async Task<(bool success, string error)> ActivateAsync(string key)
    {
        var info = ValidateKey(key);
        if (!info.Valid) return (false, info.ErrorMessage);

        using var scope = _scopeFactory.CreateScope();
        var db = scope.ServiceProvider.GetRequiredService<AppDbContext>();

        // Deactivate any existing license
        var existing = await db.Licenses.Where(l => l.IsActive).ToListAsync();
        foreach (var l in existing) l.IsActive = false;

        db.Licenses.Add(new License
        {
            Key           = key.ToUpper().Trim(),
            Tier          = info.Tier,
            MaxUsers      = info.MaxUsers,
            MaxStations   = info.MaxStations,
            MaxCameras    = info.MaxCameras,
            MaxRoiPoints  = info.MaxRoiPoints,
            MaxRoiRegions = info.MaxRoiRegions,
            MaxPdRegions  = info.MaxPdRegions,
            ExpiresAt     = info.ExpiresAt,
            ActivatedAt   = DateTime.UtcNow,
            IsActive      = true
        });

        await db.SaveChangesAsync();

        try
        {
            var licDir = Path.Combine(AppContext.BaseDirectory, "Licenses");
            Directory.CreateDirectory(licDir);
            var hardware = HardwareFingerprint.Capture();
            var structured = LicenseParser.CreateStructuredLicenseJson(
                LicensePackageKind.Base,
                Guid.NewGuid(),
                null,
                null,
                info.Tier,
                DateTime.UtcNow,
                info.ExpiresAt,
                new LicenseHardwareBinding(hardware.CpuId, hardware.MainboardUuid, hardware.OsDiskSerial, hardware.MachineName, hardware.Platform, hardware.MacAddress),
                new LicenseResourceBundle(info.MaxUsers, info.MaxStations, info.MaxCameras, info.MaxSensors, info.MaxRoiPoints, info.MaxRoiRegions, info.MaxPdRegions),
                _vendorPrivateKey,
                _vendorSecret
            );
            await File.WriteAllTextAsync(Path.Combine(licDir, "base.lic"), structured);
            _licenseManager.ReloadLicenses();
        }
        catch
        {
            // Nếu không thể sinh file license thì vẫn giữ luồng DB legacy cho tương thích ngược.
        }

        return (true, "");
    }

    /// <summary>
    /// Xóa license hiện tại đang áp dụng:
    /// - gỡ license active trong DB
    /// - xóa các file .lic trong thư mục Licenses
    /// - reload snapshot để hệ thống trở về trạng thái chưa kích hoạt
    /// </summary>
    public async Task<(bool success, string error)> ClearCurrentLicenseAsync()
    {
        using var scope = _scopeFactory.CreateScope();
        var db = scope.ServiceProvider.GetRequiredService<AppDbContext>();

        var activeLicenses = await db.Licenses.Where(l => l.IsActive).ToListAsync();
        foreach (var license in activeLicenses)
        {
            license.IsActive = false;
        }

        if (activeLicenses.Count > 0)
        {
            await db.SaveChangesAsync();
        }

        try
        {
            var licDir = Path.Combine(AppContext.BaseDirectory, "Licenses");
            if (Directory.Exists(licDir))
            {
                foreach (var file in Directory.EnumerateFiles(licDir, "*.lic", SearchOption.TopDirectoryOnly))
                {
                    try
                    {
                        File.Delete(file);
                    }
                    catch
                    {
                        // Ignore file deletion failures; DB state is still cleared.
                    }
                }
            }
        }
        finally
        {
            _licenseManager.ReloadLicenses();
        }

        return (true, "Đã xóa license hiện tại");
    }

    // ── Status ─────────────────────────────────────────────────

    /// <summary>
    /// Lấy trạng thái license hiện tại từ DB.
    /// Trả null nếu chưa kích hoạt license nào.
    /// </summary>
    public async Task<LicenseStatusDto?> GetStatusAsync()
    {
        var fileSnapshot = _licenseManager.GetEffectiveSnapshot();
        if (fileSnapshot.HasLicense)
        {
            CleanExpiredSessions();
            var fileActiveSessions = _activeSessions.Values.Count(s => !s.IsBypass);
            var fileIsValid = !fileSnapshot.ExpiresAtUtc.HasValue || DateTime.UtcNow <= fileSnapshot.ExpiresAtUtc.Value;
            return new LicenseStatusDto(
                fileSnapshot.Tier,
                fileSnapshot.MaxUsers,
                fileSnapshot.MaxStations,
                fileSnapshot.MaxCameras,
                fileSnapshot.MaxSensors,
                fileSnapshot.MaxRoiPoints,
                fileSnapshot.MaxRoiRegions,
                fileSnapshot.MaxPdRegions,
                fileSnapshot.ExpiresAtUtc ?? DateTime.UtcNow,
                fileSnapshot.ReloadedAtUtc,
                fileActiveSessions,
                fileIsValid
            );
        }

        using var scope = _scopeFactory.CreateScope();
        var db = scope.ServiceProvider.GetRequiredService<AppDbContext>();

        var license = await db.Licenses
            .Where(l => l.IsActive)
            .OrderByDescending(l => l.ActivatedAt)
            .FirstOrDefaultAsync();

        if (license == null)
            return null;

        CleanExpiredSessions();

        var dbActiveSessions = _activeSessions.Values.Count(s => !s.IsBypass);
        var dbIsValid = DateTime.UtcNow <= license.ExpiresAt;

        return new LicenseStatusDto(
            license.Tier,
            license.MaxUsers,
            license.MaxStations,
            license.MaxCameras,
            license.MaxCameras,
            license.MaxRoiPoints,
            license.MaxRoiRegions,
            license.MaxPdRegions,
            license.ExpiresAt,
            license.ActivatedAt,
            dbActiveSessions,
            dbIsValid
        );
    }

    // ── Resource limit check ──────────────────────────────────

    /// <summary>
    /// Kiểm tra giới hạn tài nguyên dựa trên license hiện tại.
    /// Trả về (allowed, current, max) để frontend/backend biết vượt limit chưa.
    /// </summary>
    public async Task<ResourceLimitInfo> CheckResourceLimitAsync(string resource)
    {
        var fileSnapshot = _licenseManager.GetEffectiveSnapshot();

        using var scope = _scopeFactory.CreateScope();
        var db = scope.ServiceProvider.GetRequiredService<AppDbContext>();

        var license = await GetActiveLicenseAsync(db);
        var maxUsers = fileSnapshot.HasLicense ? fileSnapshot.MaxUsers : license?.MaxUsers ?? 10;
        var maxStations = fileSnapshot.HasLicense ? fileSnapshot.MaxStations : license?.MaxStations ?? 10;
        var maxCameras = fileSnapshot.HasLicense ? fileSnapshot.MaxCameras : license?.MaxCameras ?? 10;
        var maxSensors = fileSnapshot.HasLicense ? fileSnapshot.MaxSensors : maxCameras;
        int current = 0;
        int max = 999;

        // Chưa có license → không cho hiển thị giới hạn sử dụng
        if (!fileSnapshot.HasLicense && license == null)
        {
            return new ResourceLimitInfo(resource, 0, 0, false);
        }

        switch (resource.ToLower())
        {
            case "stations":
                current = await db.Stations.CountAsync();
                max = fileSnapshot.HasLicense ? maxStations : license!.MaxStations;
                break;
            case "cameras":
                current = await db.Devices.CountAsync(d => d.Type.ToLower().StartsWith("camera"));
                max = fileSnapshot.HasLicense ? maxCameras : license!.MaxCameras;
                break;
            case "sensors":
                current = await db.Devices.CountAsync(d => !d.Type.ToLower().StartsWith("camera"));
                max = fileSnapshot.HasLicense ? maxSensors : license!.MaxCameras;
                break;
            case "devices":
                current = await db.Devices.CountAsync();
                max = (fileSnapshot.HasLicense ? maxCameras : license!.MaxCameras) + (fileSnapshot.HasLicense ? maxSensors : license!.MaxCameras);
                break;
            case "roi_points":
                current = await db.RoiPoints.CountAsync();
                max = fileSnapshot.HasLicense ? fileSnapshot.MaxRoiPoints : (license?.MaxRoiPoints ?? 0);
                break;
            case "roi_regions":
                current = await db.Set<StationOS.Data.Entities.Boundary>()
                    .CountAsync(b => b.Type.ToLower() == "roi");
                max = fileSnapshot.HasLicense ? fileSnapshot.MaxRoiRegions : (license?.MaxRoiRegions ?? 0);
                break;
            case "pd_regions":
                current = await db.Set<StationOS.Data.Entities.Boundary>()
                    .CountAsync(b => b.Type.ToLower() == "pd");
                max = fileSnapshot.HasLicense ? fileSnapshot.MaxPdRegions : (license?.MaxPdRegions ?? 0);
                break;
            default:
                return new ResourceLimitInfo(resource, 0, 0, false);
        }

        var exceeded = max < 999 && current >= max;
        return new ResourceLimitInfo(resource, current, max, exceeded);
    }

    /// <summary>
    /// Lấy tổng quan toàn bộ giới hạn tài nguyên.
    /// </summary>
    public async Task<List<ResourceLimitInfo>> GetAllResourceLimitsAsync()
    {
        var fileSnapshot = _licenseManager.GetEffectiveSnapshot();

        using var scope = _scopeFactory.CreateScope();
        var db = scope.ServiceProvider.GetRequiredService<AppDbContext>();

        var license = await GetActiveLicenseAsync(db);
        if (!fileSnapshot.HasLicense && license == null)
        {
            return new List<ResourceLimitInfo>
            {
                new("stations", 0, 0, false),
                new("cameras", 0, 0, false),
                new("sensors", 0, 0, false),
                new("roi_points", 0, 0, false),
                new("roi_regions", 0, 0, false),
                new("pd_regions", 0, 0, false),
            };
        }

        var stationCount = await db.Stations.CountAsync();
        var cameraCount = await db.Devices.CountAsync(d => d.Type.ToLower().StartsWith("camera"));
        var sensorCount = await db.Devices.CountAsync(d => !d.Type.ToLower().StartsWith("camera"));
        var roiPointCount = await db.RoiPoints.CountAsync();
        var roiRegionCount = await db.Boundaries.CountAsync(b => b.Type.ToLower() == "roi");
        var pdRegionCount = await db.Boundaries.CountAsync(b => b.Type.ToLower() == "pd");

        var defaultMax = 0;
        var useFileLicense = fileSnapshot.HasLicense;

        return new List<ResourceLimitInfo>
        {
            new("stations", stationCount, useFileLicense ? fileSnapshot.MaxStations : (license?.MaxStations ?? defaultMax), IsExceeded(stationCount, useFileLicense ? fileSnapshot.MaxStations : (license?.MaxStations ?? defaultMax))),
            new("cameras", cameraCount, useFileLicense ? fileSnapshot.MaxCameras : (license?.MaxCameras ?? defaultMax), IsExceeded(cameraCount, useFileLicense ? fileSnapshot.MaxCameras : (license?.MaxCameras ?? defaultMax))),
            new("sensors", sensorCount, useFileLicense ? fileSnapshot.MaxSensors : (license?.MaxCameras ?? defaultMax), IsExceeded(sensorCount, useFileLicense ? fileSnapshot.MaxSensors : (license?.MaxCameras ?? defaultMax))),
            new("roi_points", roiPointCount, useFileLicense ? fileSnapshot.MaxRoiPoints : (license?.MaxRoiPoints ?? defaultMax), IsExceeded(roiPointCount, useFileLicense ? fileSnapshot.MaxRoiPoints : (license?.MaxRoiPoints ?? defaultMax))),
            new("roi_regions", roiRegionCount, useFileLicense ? fileSnapshot.MaxRoiRegions : (license?.MaxRoiRegions ?? defaultMax), IsExceeded(roiRegionCount, useFileLicense ? fileSnapshot.MaxRoiRegions : (license?.MaxRoiRegions ?? defaultMax))),
            new("pd_regions", pdRegionCount, useFileLicense ? fileSnapshot.MaxPdRegions : (license?.MaxPdRegions ?? defaultMax), IsExceeded(pdRegionCount, useFileLicense ? fileSnapshot.MaxPdRegions : (license?.MaxPdRegions ?? defaultMax))),
        };
    }

    private static bool IsExceeded(int current, int max)
        => max < 999 && current >= max;

    private static Task<License?> GetActiveLicenseAsync(AppDbContext db)
        => db.Licenses
            .Where(l => l.IsActive)
            .OrderByDescending(l => l.ActivatedAt)
            .FirstOrDefaultAsync();

    // ── Session tracking ───────────────────────────────────────

    /// <summary>
    /// Gọi sau khi login thành công.
    /// Trả false nếu đã đủ concurrent users (không tính phiên bypass).
    /// Bypass: tài khoản "multi" hoặc role "admin" không bị tính vào giới hạn.
    /// Nếu chưa có license thì vẫn cho vào để giữ tương thích luồng hiện tại.
    /// </summary>
    public async Task<(bool allowed, string reason)> TryAcquireSessionAsync(
        string tokenHash, DateTime expiresAt, string username, string role)
    {
        // Dọn dẹp phiên hết hạn trước
        CleanExpiredSessions();

        // Kiểm tra bypass: admin hoặc tài khoản trạm tổng ("multi")
        var isBypass = string.Equals(role, "admin", StringComparison.OrdinalIgnoreCase) 
                    || string.Equals(username, "multi", StringComparison.OrdinalIgnoreCase);

        // Lấy license hiện tại
        var fileSnapshot = _licenseManager.GetEffectiveSnapshot();
        using var scope = _scopeFactory.CreateScope();
        var db = scope.ServiceProvider.GetRequiredService<AppDbContext>();
        var license = await db.Licenses
            .Where(l => l.IsActive)
            .OrderByDescending(l => l.ActivatedAt)
            .FirstOrDefaultAsync();

        var effectiveMaxUsers = fileSnapshot.HasLicense ? fileSnapshot.MaxUsers : license?.MaxUsers ?? 10;

        // Chưa có license → cho vào nhưng gắn cờ
        if (!fileSnapshot.HasLicense && license == null)
        {
            _activeSessions[tokenHash] = new ActiveSessionInfo(
                tokenHash, username, role, expiresAt, isBypass);
            return (true, "no_license");
        }

        // License hết hạn → vẫn cho vào nhưng cảnh báo
        if ((fileSnapshot.HasLicense && fileSnapshot.ExpiresAtUtc.HasValue && DateTime.UtcNow > fileSnapshot.ExpiresAtUtc.Value)
            || (!fileSnapshot.HasLicense && license != null && DateTime.UtcNow > license.ExpiresAt))
        {
            _activeSessions[tokenHash] = new ActiveSessionInfo(
                tokenHash, username, role, expiresAt, isBypass);
            return (true, "expired");
        }

        // Bypass → luôn cho phép, không tính vào giới hạn
        if (isBypass)
        {
            _activeSessions[tokenHash] = new ActiveSessionInfo(
                tokenHash, username, role, expiresAt, true);
            return (true, "");
        }

        // Đếm phiên non-bypass hiện tại
        var activeCount = _activeSessions.Values.Count(s => !s.IsBypass);
        if (activeCount >= effectiveMaxUsers)
        {
            return (false, "max_users");
        }

        // Cho phép đăng nhập
        _activeSessions[tokenHash] = new ActiveSessionInfo(
            tokenHash, username, role, expiresAt, false);
        return (true, "");
    }

    public void ReleaseSession(string tokenHash)
        => _activeSessions.TryRemove(tokenHash, out _);

    public int GetActiveSessionCount()
    {
        CleanExpiredSessions();
        return _activeSessions.Values.Count(s => !s.IsBypass);
    }

    public void ClearAllSessions()
        => _activeSessions.Clear();

    public string GenerateRequestString()
        => _licenseManager.GenerateRequestString();

    public async Task<(bool success, string error, string? licenseJson)> CreateChildBaseLicenseAsync(
        string licenseRequestJson,
        int cameraQuota,
        int sensorQuota)
    {
        if (string.IsNullOrWhiteSpace(licenseRequestJson))
            return (false, "Thiếu .licreq của trạm con", null);

        if (cameraQuota < 0 || sensorQuota < 0)
            return (false, "Quota camera/sensor phải là số nguyên không âm", null);

        LicenseHardwareBinding hardware;
        try
        {
            using var doc = JsonDocument.Parse(licenseRequestJson);
            if (doc.RootElement.TryGetProperty("fingerprint", out var legacyFingerprint)
                && legacyFingerprint.ValueKind == JsonValueKind.String
                && !doc.RootElement.TryGetProperty("requestType", out _))
            {
                return CreateLegacyChildBaseLicense(doc.RootElement, cameraQuota, sensorQuota);
            }

            if (!doc.RootElement.TryGetProperty("fingerprint", out var fp))
                return (false, "File .licreq không có fingerprint phần cứng", null);

            hardware = new LicenseHardwareBinding(
                GetJsonString(fp, "cpuId"),
                GetJsonString(fp, "mainboardUuid"),
                GetJsonString(fp, "osDiskSerial"),
                GetJsonString(fp, "machineName"),
                GetJsonString(fp, "platform"),
                GetJsonString(fp, "macAddress")
            );
        }
        catch (Exception ex)
        {
            return (false, $"Không đọc được .licreq của trạm con: {ex.Message}", null);
        }

        var status = await GetStatusAsync();
        var expiresAt = status?.ExpiresAt;
        if (expiresAt == null || expiresAt.Value <= DateTime.UtcNow)
            expiresAt = DateTime.UtcNow.AddYears(1);

        try
        {
            var licenseJson = LicenseParser.CreateStructuredLicenseJson(
                LicensePackageKind.Base,
                Guid.NewGuid(),
                null,
                null,
                "child",
                DateTime.UtcNow,
                expiresAt.Value,
                hardware,
                new LicenseResourceBundle(
                    Users: 5,
                    Stations: 1,
                    Cameras: cameraQuota,
                    Sensors: sensorQuota,
                    RoiPoints: 0,
                    RoiRegions: 0,
                    PdRegions: 0),
                _vendorPrivateKey,
                _vendorSecret
            );

            return (true, "", licenseJson);
        }
        catch (Exception ex)
        {
            return (false, $"Không thể tạo license cho trạm con: {ex.Message}", null);
        }
    }

    private (bool success, string error, string? licenseJson) CreateLegacyChildBaseLicense(
        JsonElement request,
        int cameraQuota,
        int sensorQuota)
    {
        if (string.IsNullOrWhiteSpace(_vendorSecret))
            return (false, "Thiếu VendorSecret để ký license cho trạm con cũ", null);

        var licenseId = Guid.NewGuid();
        var issuedAt = DateTime.UtcNow;
        var status = GetStatusAsync().GetAwaiter().GetResult();
        var expiresAt = status?.ExpiresAt;
        if (expiresAt == null || expiresAt.Value <= DateTime.UtcNow)
            expiresAt = DateTime.UtcNow.AddYears(1);

        var machineName = GetJsonString(request, "machineName");
        var platform = GetJsonString(request, "platform");
        var cpuId = GetJsonString(request, "cpuId");
        var mainboardUuid = GetJsonString(request, "mainboardUuid");
        var diskSerial = GetJsonString(request, "diskSerial");
        var macs = ReadStringArray(request, "physicalMacs");

        var hardwareHash = ComputeLegacyHardwareHash(cpuId, mainboardUuid, diskSerial, machineName, platform, macs.FirstOrDefault() ?? string.Empty);
        var canonical = string.Join("|", new[]
        {
            "BASE",
            licenseId.ToString("N"),
            string.Empty,
            string.Empty,
            "CHILD",
            issuedAt.ToUniversalTime().ToString("O"),
            expiresAt.Value.ToUniversalTime().ToString("O"),
            hardwareHash,
            $"users=5;stations=1;cameras={cameraQuota};sensors={sensorQuota};roi_points=0;roi_regions=0;pd_regions=0"
        });

        var signature = ComputeHmac(canonical);
        var envelope = new
        {
            payload = new
            {
                version = 1,
                licenseType = "base",
                licenseId = licenseId.ToString(),
                addonId = (string?)null,
                tier = "CHILD",
                customer = (string?)null,
                issuedAt,
                expiresAt = expiresAt.Value,
                hardware = new
                {
                    fingerprint = GetJsonString(request, "fingerprint"),
                    cpuId,
                    mainboardUuid,
                    diskSerial,
                    machineName,
                    platform,
                    machineGuid = (string?)null,
                    physicalMacs = macs,
                    macAddress = macs.FirstOrDefault()
                },
                limits = new
                {
                    maxUsers = 5,
                    maxDevices = 1,
                    maxCameras = cameraQuota,
                    maxSensors = sensorQuota,
                    maxRoiPoints = 0,
                    maxRoiRegions = 0,
                    maxPdRegions = 0
                }
            },
            signature = new
            {
                algorithm = "FLAT-HMAC-SHA256",
                value = signature,
                keyId = canonical
            }
        };

        var json = JsonSerializer.Serialize(envelope, new JsonSerializerOptions
        {
            PropertyNamingPolicy = JsonNamingPolicy.CamelCase,
            WriteIndented = true
        });
        return (true, "", json);
    }

    private string ComputeHmac(string payload)
    {
        var key = Encoding.UTF8.GetBytes(_vendorSecret);
        var data = Encoding.UTF8.GetBytes(payload);
        var hash = HMACSHA256.HashData(key, data);
        return Convert.ToHexString(hash).ToLowerInvariant();
    }

    private static string ComputeLegacyHardwareHash(
        string? cpuId,
        string? mainboardUuid,
        string? diskSerial,
        string? machineName,
        string? platform,
        string? macAddress)
    {
        var payload = string.Join("|", new[]
        {
            NormalizeLegacyHardware(cpuId),
            NormalizeLegacyHardware(mainboardUuid),
            NormalizeLegacyHardware(diskSerial),
            NormalizeLegacyHardware(machineName),
            NormalizeLegacyHardware(platform),
            NormalizeLegacyHardware(macAddress)
        });

        return Convert.ToHexString(SHA256.HashData(Encoding.UTF8.GetBytes(payload)));
    }

    private static string NormalizeLegacyHardware(string? value)
        => string.IsNullOrWhiteSpace(value)
            ? string.Empty
            : System.Text.RegularExpressions.Regex.Replace(value.Trim().ToUpperInvariant(), @"[^A-Z0-9]+", string.Empty);

    private static string[] ReadStringArray(JsonElement element, string propertyName)
    {
        if (!element.TryGetProperty(propertyName, out var value) || value.ValueKind != JsonValueKind.Array)
            return Array.Empty<string>();

        return value.EnumerateArray()
            .Select(item => item.ValueKind == JsonValueKind.String ? item.GetString() : item.ToString())
            .Where(item => !string.IsNullOrWhiteSpace(item))
            .Select(item => item!)
            .ToArray();
    }

    private static string GetJsonString(JsonElement element, string propertyName)
    {
        if (!element.TryGetProperty(propertyName, out var value))
            return string.Empty;

        return value.ValueKind == JsonValueKind.String ? value.GetString() ?? string.Empty : value.ToString();
    }

    public async Task<LicenseImportOutcome> ImportLicenseAsync(IFormFile file)
        => await _licenseManager.ImportLicenseAsync(file);

    public void ReloadLicenses()
        => _licenseManager.ReloadLicenses();

    private void CleanExpiredSessions()
    {
        var now = DateTime.UtcNow;
        foreach (var kvp in _activeSessions)
            if (kvp.Value.ExpiresAt < now) 
                _activeSessions.TryRemove(kvp.Key, out _);
    }
}

// ── DTOs ──────────────────────────────────────────────────────

public record LicenseStatusDto(
    string Tier,
    int MaxUsers,
    int MaxStations,
    int MaxCameras,
    int MaxSensors,
    int MaxRoiPoints,
    int MaxRoiRegions,
    int MaxPdRegions,
    DateTime ExpiresAt,
    DateTime ActivatedAt,
    int ActiveSessions,
    bool IsValid
);

public record ActiveSessionInfo(
    string SessionId,
    string Username,
    string Role,
    DateTime ExpiresAt,
    bool IsBypass
);

public record LicenseKeyInfo(
    bool Valid,
    string Tier,
    int MaxUsers,
    int MaxStations,
    int MaxCameras,
    int MaxSensors,
    int MaxRoiPoints,
    int MaxRoiRegions,
    int MaxPdRegions,
    DateTime ExpiresAt,
    string ErrorMessage
)
{
    public static LicenseKeyInfo Error(string message) =>
        new(false, "", 0, 0, 0, 0, 0, 0, 0, default, message);
}

public record ResourceLimitInfo(
    string Resource,
    int Current,
    int Max,
    bool Exceeded
);

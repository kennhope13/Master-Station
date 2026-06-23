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
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Configuration;
using Microsoft.Extensions.DependencyInjection;
using StationOS.Data;
using StationOS.Data.Entities;

namespace StationOS.Services;

public class LicenseService
{
    private readonly IServiceScopeFactory _scopeFactory;
    private readonly string _vendorSecret;

    // In-memory session tracking: tokenHash → ActiveSessionInfo
    private readonly ConcurrentDictionary<string, ActiveSessionInfo> _activeSessions = new();

    public LicenseService(IServiceScopeFactory scopeFactory, IConfiguration config)
    {
        _scopeFactory = scopeFactory;
        _vendorSecret = Environment.GetEnvironmentVariable("STATIONOS_VENDOR_SECRET") 
                        ?? config["License:VendorSecret"] 
                        ?? throw new InvalidOperationException("Khóa bí mật nhà cung cấp (VendorSecret) chưa được cấu hình. Vui lòng thiết lập biến môi trường STATIONOS_VENDOR_SECRET.");
    }

    // ── Default resource limits per tier ──────────────────────
    private static (int maxUsers, int maxStations, int maxCameras, int maxRoiPoints, int maxRoiRegions, int maxPdRegions) GetTierDefaults(string tier)
    {
        return tier switch
        {
            "SOLO" => (1,   1,   2,   10,  5,   5),
            "TEAM" => (5,   10,  8,   500, 30,  30),
            "ENT"  => (999, 999, 999, 999, 999, 999),
            _      => (-1, -1, -1, -1, -1, -1)
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
            return new LicenseKeyInfo(true, "ent", 99999, 99999, 99999, 99999, 99999, 99999, DateTime.UtcNow.AddYears(100), "");
        }

        var parts = normalizedKey.Split('-');
        
        string tier;
        DateTime expiresAt;
        int maxUsers;
        int maxStations;
        int maxCameras;
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
                maxRoiPoints, maxRoiRegions, maxPdRegions, expiresUtc, "License đã hết hạn");

        return new LicenseKeyInfo(true, tier.ToLower(), maxUsers, maxStations, maxCameras,
            maxRoiPoints, maxRoiRegions, maxPdRegions, expiresUtc, "");
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
        return (true, "");
    }

    // ── Status ─────────────────────────────────────────────────

    /// <summary>
    /// Lấy trạng thái license hiện tại từ DB.
    /// Trả null nếu chưa kích hoạt license nào.
    /// </summary>
    public async Task<LicenseStatusDto?> GetStatusAsync()
    {
        using var scope = _scopeFactory.CreateScope();
        var db = scope.ServiceProvider.GetRequiredService<AppDbContext>();

        var license = await db.Licenses
            .Where(l => l.IsActive)
            .OrderByDescending(l => l.ActivatedAt)
            .FirstOrDefaultAsync();

        if (license == null)
            return null;

        CleanExpiredSessions();

        var activeSessions = _activeSessions.Values.Count(s => !s.IsBypass);
        var isValid = DateTime.UtcNow <= license.ExpiresAt;

        return new LicenseStatusDto(
            license.Tier,
            license.MaxUsers,
            license.MaxStations,
            license.MaxCameras,
            license.MaxRoiPoints,
            license.MaxRoiRegions,
            license.MaxPdRegions,
            license.ExpiresAt,
            license.ActivatedAt,
            activeSessions,
            isValid
        );
    }

    // ── Resource limit check ──────────────────────────────────

    /// <summary>
    /// Kiểm tra giới hạn tài nguyên dựa trên license hiện tại.
    /// Trả về (allowed, current, max) để frontend/backend biết vượt limit chưa.
    /// </summary>
    public async Task<ResourceLimitInfo> CheckResourceLimitAsync(string resource)
    {
        using var scope = _scopeFactory.CreateScope();
        var db = scope.ServiceProvider.GetRequiredService<AppDbContext>();

        var license = await db.Licenses
            .Where(l => l.IsActive)
            .OrderByDescending(l => l.ActivatedAt)
            .FirstOrDefaultAsync();

        int current = 0;
        int max = 999;

        // Chưa có license → mặc định giới hạn 10 cho mỗi loại tài nguyên (Trial/Demo)
        if (license == null)
        {
            switch (resource.ToLower())
            {
                case "stations":
                    current = await db.Stations.CountAsync();
                    break;
                case "cameras":
                case "devices":
                    current = await db.Devices.CountAsync();
                    break;
                case "roi_points":
                    current = await db.RoiPoints.CountAsync();
                    break;
                case "roi_regions":
                    current = await db.Boundaries.CountAsync(b => b.Type == "roi");
                    break;
                case "pd_regions":
                    current = await db.Boundaries.CountAsync(b => b.Type == "pd");
                    break;
            }
            max = 10;
            var exceededTrial = current >= max;
            return new ResourceLimitInfo(resource, current, max, exceededTrial);
        }

        switch (resource.ToLower())
        {
            case "stations":
                current = await db.Stations.CountAsync();
                max = license.MaxStations;
                break;
            case "cameras":
            case "devices":
                current = await db.Devices.CountAsync();
                max = license.MaxCameras;
                break;
            case "roi_points":
                current = await db.RoiPoints.CountAsync();
                max = license.MaxRoiPoints;
                break;
            case "roi_regions":
                current = await db.Set<StationOS.Data.Entities.Boundary>()
                    .CountAsync(b => b.Type == "roi");
                max = license.MaxRoiRegions;
                break;
            case "pd_regions":
                current = await db.Set<StationOS.Data.Entities.Boundary>()
                    .CountAsync(b => b.Type == "pd");
                max = license.MaxPdRegions;
                break;
            default:
                return new ResourceLimitInfo(resource, 0, 999, false);
        }

        var exceeded = max < 999 && current >= max;
        return new ResourceLimitInfo(resource, current, max, exceeded);
    }

    /// <summary>
    /// Lấy tổng quan toàn bộ giới hạn tài nguyên.
    /// </summary>
    public async Task<List<ResourceLimitInfo>> GetAllResourceLimitsAsync()
    {
        var resources = new[] { "stations", "cameras", "roi_points", "roi_regions", "pd_regions" };
        var results = new List<ResourceLimitInfo>();
        foreach (var r in resources)
            results.Add(await CheckResourceLimitAsync(r));
        return results;
    }

    // ── Session tracking ───────────────────────────────────────

    /// <summary>
    /// Gọi sau khi login thành công.
    /// Trả false nếu đã đủ concurrent users (không tính phiên bypass).
    /// Bypass: tài khoản "multi" hoặc role "admin" không bị tính vào giới hạn.
    /// Nếu chưa có license thì vẫn cho vào (demo mode).
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
        using var scope = _scopeFactory.CreateScope();
        var db = scope.ServiceProvider.GetRequiredService<AppDbContext>();
        var license = await db.Licenses
            .Where(l => l.IsActive)
            .OrderByDescending(l => l.ActivatedAt)
            .FirstOrDefaultAsync();

        // Chưa có license → cho vào (demo mode) nhưng gắn cờ
        if (license == null)
        {
            _activeSessions[tokenHash] = new ActiveSessionInfo(
                tokenHash, username, role, expiresAt, isBypass);
            return (true, "no_license");
        }

        // License hết hạn → vẫn cho vào nhưng cảnh báo
        if (DateTime.UtcNow > license.ExpiresAt)
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
        if (activeCount >= license.MaxUsers)
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
    int MaxRoiPoints,
    int MaxRoiRegions,
    int MaxPdRegions,
    DateTime ExpiresAt,
    string ErrorMessage
)
{
    public static LicenseKeyInfo Error(string message) =>
        new(false, "", 0, 0, 0, 0, 0, 0, default, message);
}

public record ResourceLimitInfo(
    string Resource,
    int Current,
    int Max,
    bool Exceeded
);

// ============================================================
// PermissionService — Lọc dữ liệu theo phân cấp 3 tầng
//
// Cấp bậc:
//   admin           → Admin Toàn Cục: thấy TẤT CẢ tỉnh & trạm
//   admin_province  → Admin Tỉnh: thấy trạm thuộc tỉnh được gán (ProvinceIds)
//   operator_province → Operator PC Tỉnh: giám sát trạm thuộc tỉnh (read-only)
//   team_leader     → Tổ trưởng: thấy trạm của Tổ (Team.StationIds)
//   team_member     → Nhân viên Tổ: thấy trạm của Tổ (Team.StationIds)
//   admin_station   → Admin Trạm: thấy trạm được gán (StationIds)
//   manager         → Manager Trạm: thấy trạm được gán (StationIds)
//   operator        → Operator: thấy trạm được gán (StationIds)
// ============================================================

using System.Security.Claims;
using System.Text.Json;
using Microsoft.AspNetCore.Http;
using Microsoft.EntityFrameworkCore;
using StationOS.Data;
using StationOS.Services.Security;

namespace StationOS.Services;

public class PermissionService
{
    private readonly IHttpContextAccessor _http;
    private readonly AppDbContext _db;

    public PermissionService(IHttpContextAccessor http, AppDbContext db)
    {
        _http = http;
        _db   = db;
    }

    private static string NormalizeProvinceToken(string value)
    {
        return value
            .Trim()
            .ToLowerInvariant()
            .Replace("tỉnh ", "")
            .Replace("thành phố ", "")
            .Replace("tp. ", "")
            .Replace("tp ", "")
            .Trim();
    }

    private static IEnumerable<string> BuildProvinceAliases(string? name, string? code)
    {
        var aliases = new HashSet<string>(StringComparer.OrdinalIgnoreCase);

        if (!string.IsNullOrWhiteSpace(name))
        {
            aliases.Add(NormalizeProvinceToken(name));
        }

        if (!string.IsNullOrWhiteSpace(code))
        {
            aliases.Add(NormalizeProvinceToken(code));
        }

        return aliases.Where(x => !string.IsNullOrWhiteSpace(x));
    }

    private static string ExtractAddress(string? locationJson)
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

    /// <summary>
    /// Trả về danh sách StationId mà user hiện tại được phép xem/quản lý.
    /// null = không hạn chế (Admin Toàn Cục).
    /// Empty array = không có quyền trên bất kỳ trạm nào.
    /// </summary>
    public async Task<Guid[]?> GetAllowedStationIdsAsync()
    {
        var user = _http.HttpContext?.User;
        if (user == null) return Array.Empty<Guid>();
        if (user.HasClaim(InternalAuthService.InternalMachineClaim, "true")) return null;

        var userIdStr = user.FindFirstValue(ClaimTypes.NameIdentifier);
        if (!Guid.TryParse(userIdStr, out var userId)) return Array.Empty<Guid>();

        var dbUser = await _db.Users
            .AsNoTracking()
            .Select(u => new { u.Id, u.Role, u.StationIds, u.ProvinceIds, u.TeamId })
            .FirstOrDefaultAsync(u => u.Id == userId);

        if (dbUser == null) return Array.Empty<Guid>();

        // ── Tầng 1: Admin Toàn Cục ──────────────────────────────────
        // Không bị lọc — thấy tất cả
        if (dbUser.Role == "admin")
            return null;

        // ── Tầng 2: Admin Tỉnh / Operator PC Tỉnh ───────────────────
        // Chỉ thấy trạm thuộc các tỉnh được gán. Nếu chưa gán tỉnh → không thấy trạm nào.
        if (dbUser.Role == "admin_province" || dbUser.Role == "operator_province")
        {
            if (dbUser.ProvinceIds == null || dbUser.ProvinceIds.Length == 0)
            {
                return Array.Empty<Guid>(); // Chưa gán tỉnh → không thấy trạm nào
            }

            var provinces = await _db.Provinces
                .AsNoTracking()
                .Select(p => new { p.Id, p.Name, p.Code })
                .ToListAsync();

            var allowedProvinceAliases = provinces
                .Where(p => dbUser.ProvinceIds.Contains(p.Id))
                .SelectMany(p => BuildProvinceAliases(p.Name, p.Code))
                .ToHashSet(StringComparer.OrdinalIgnoreCase);

            var otherProvinceAliases = provinces
                .Where(p => !dbUser.ProvinceIds.Contains(p.Id))
                .SelectMany(p => BuildProvinceAliases(p.Name, p.Code))
                .OrderByDescending(x => x.Length)
                .ToArray();

            var candidateStations = await _db.Stations
                .AsNoTracking()
                .Where(s => s.ProvinceId != null && dbUser.ProvinceIds.Contains(s.ProvinceId!.Value))
                .Select(s => new { s.Id, s.Name, s.Location })
                .ToListAsync();

            var stationIds = candidateStations
                .Where(s =>
                {
                    var haystack = NormalizeProvinceToken($"{s.Name} {ExtractAddress(s.Location)}");
                    if (string.IsNullOrWhiteSpace(haystack)) return true;

                    var mentionsOtherProvince = otherProvinceAliases.Any(alias => haystack.Contains(alias));
                    if (!mentionsOtherProvince) return true;

                    return allowedProvinceAliases.Any(alias => haystack.Contains(alias));
                })
                .Select(s => s.Id)
                .ToArray();

            return stationIds;
        }

        // ── Tầng 3: Admin Trạm / Manager / Operator ─────────────────
        // Chỉ thấy các trạm được gán trực tiếp
        if (dbUser.StationIds != null && dbUser.StationIds.Length > 0)
            return dbUser.StationIds;

        // ── Tầng 4: Team-based (Tổ thao tác lưu động) ─────────────
        // Nếu user có TeamId thì trả về StationIds của team
        if (dbUser.TeamId != null)
        {
            var team = await _db.Teams
                .AsNoTracking()
                .FirstOrDefaultAsync(t => t.Id == dbUser.TeamId);
            if (team?.StationIds != null && team.StationIds.Length > 0)
                return team.StationIds;
        }

        // Không có StationIds và không có team → không thấy trạm nào
        return Array.Empty<Guid>();
    }

    /// <summary>
    /// Kiểm tra user hiện tại có quyền quản lý trạm cụ thể không.
    /// </summary>
    public async Task<bool> CanAccessStationAsync(Guid stationId)
    {
        var allowed = await GetAllowedStationIdsAsync();
        if (allowed == null) return true; // Admin Toàn Cục
        return allowed.Contains(stationId);
    }

    /// <summary>
    /// Trả về danh sách ProvinceId mà user hiện tại được phép quản lý.
    /// null = không hạn chế (Admin Toàn Cục).
    /// </summary>
    public async Task<Guid[]?> GetAllowedProvinceIdsAsync()
    {
        var user = _http.HttpContext?.User;
        if (user == null) return Array.Empty<Guid>();
        if (user.HasClaim(InternalAuthService.InternalMachineClaim, "true")) return null;

        var userIdStr = user.FindFirstValue(ClaimTypes.NameIdentifier);
        if (!Guid.TryParse(userIdStr, out var userId)) return Array.Empty<Guid>();

        var dbUser = await _db.Users
            .AsNoTracking()
            .Select(u => new { u.Id, u.Role, u.ProvinceIds })
            .FirstOrDefaultAsync(u => u.Id == userId);

        if (dbUser == null) return Array.Empty<Guid>();

        if (dbUser.Role == "admin") return null; // tất cả

        if (dbUser.Role == "admin_province" || dbUser.Role == "operator_province")
        {
            if (dbUser.ProvinceIds == null || dbUser.ProvinceIds.Length == 0)
                return Array.Empty<Guid>(); // Chưa gán tỉnh → không có quyền trên tỉnh nào

            return dbUser.ProvinceIds;
        }

        return Array.Empty<Guid>(); // các role thấp hơn không quản lý tỉnh
    }

    /// <summary>
    /// Kiểm tra người dùng hiện tại có được cấp quyền cụ thể hay không.
    /// Quyền có thể gán động qua checklist.
    /// admin (Admin Toàn Cục) luôn có full quyền.
    /// </summary>
    public async Task<bool> HasPermissionAsync(string permissionKey)
    {
        var user = _http.HttpContext?.User;
        if (user == null) return false;
        if (user.HasClaim(InternalAuthService.InternalMachineClaim, "true")) return true;

        var userIdStr = user.FindFirstValue(ClaimTypes.NameIdentifier);
        if (!Guid.TryParse(userIdStr, out var userId)) return false;

        var dbUser = await _db.Users
            .AsNoTracking()
            .Select(u => new { u.Id, u.Role, u.Permissions })
            .FirstOrDefaultAsync(u => u.Id == userId);

        if (dbUser == null) return false;

        // Admin Toàn Cục luôn có full quyền (cái to nhất có full)
        if (dbUser.Role == "admin") return true;

        // Cấu hình quyền mặc định theo vai trò
        var defaultPermissions = GetDefaultPermissionsForRole(dbUser.Role);
        if (defaultPermissions.Contains(permissionKey)) return true;

        // Kiểm tra trong danh sách quyền được cấp động
        if (dbUser.Permissions == null || dbUser.Permissions.Length == 0) return false;

        return dbUser.Permissions.Contains(permissionKey);
    }

    private static readonly string[] ProvinceAdminPermissions = new[]
    {
        "station:view", "station:manage", "device:view", "device:manage",
        "rule:view", "rule:manage", "user:view", "user:manage",
        "report:view", "report:manage", "license:manage"
    };

    private static readonly string[] StationAdminPermissions = new[]
    {
        "station:view", "station:manage", "device:view", "device:manage",
        "rule:view", "rule:manage", "user:view", "user:manage",
        "report:view", "report:manage", "license:manage"
    };

    private static readonly string[] OperatorProvincePermissions = new[]
    {
        "station:view", "device:view", "rule:view", "report:view"
    };

    private static readonly string[] OperatorPermissions = new[]
    {
        "station:view", "device:view", "rule:view", "report:view"
    };

    // Tổ trưởng: quản lý tổ + nhân viên trong tổ + trạm của tổ
    private static readonly string[] TeamLeaderPermissions = new[]
    {
        "station:view", "device:view", "device:manage",
        "rule:view", "report:view",
        "user:view", "user:manage"
    };

    // Manager: quản lý trạm, có device:manage
    private static readonly string[] ManagerPermissions = new[]
    {
        "station:view", "device:view", "device:manage",
        "rule:view", "report:view"
    };

    public static System.Collections.Generic.HashSet<string> GetDefaultPermissionsForRole(string role)
    {
        var list = role switch
        {
            "admin_province" => ProvinceAdminPermissions,
            "admin_station" => StationAdminPermissions,
            "operator_province" => OperatorProvincePermissions,
            "manager" => ManagerPermissions,
            "operator" => OperatorPermissions,
            "team_leader" => TeamLeaderPermissions,
            "team_member" => OperatorPermissions,
            _ => System.Array.Empty<string>()
        };
        return new System.Collections.Generic.HashSet<string>(list);
    }
}

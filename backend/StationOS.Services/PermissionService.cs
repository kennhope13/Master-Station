// ============================================================
// PermissionService — Lọc dữ liệu theo phân cấp 3 tầng
//
// Cấp bậc:
//   admin           → Admin Toàn Cục: thấy TẤT CẢ tỉnh & trạm
//   admin_province  → Admin Tỉnh: thấy trạm thuộc tỉnh được gán (ProvinceIds)
//   admin_station   → Admin Trạm: thấy trạm được gán (StationIds)
//   manager         → Manager Trạm: thấy trạm được gán (StationIds)
//   operator        → Operator: thấy trạm được gán (StationIds)
// ============================================================

using System.Security.Claims;
using Microsoft.AspNetCore.Http;
using Microsoft.EntityFrameworkCore;
using StationOS.Data;

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

    /// <summary>
    /// Trả về danh sách StationId mà user hiện tại được phép xem/quản lý.
    /// null = không hạn chế (Admin Toàn Cục).
    /// Empty array = không có quyền trên bất kỳ trạm nào.
    /// </summary>
    public async Task<Guid[]?> GetAllowedStationIdsAsync()
    {
        var user = _http.HttpContext?.User;
        if (user == null) return Array.Empty<Guid>();

        var userIdStr = user.FindFirstValue(ClaimTypes.NameIdentifier);
        if (!Guid.TryParse(userIdStr, out var userId)) return Array.Empty<Guid>();

        var dbUser = await _db.Users
            .AsNoTracking()
            .Select(u => new { u.Id, u.Role, u.StationIds, u.ProvinceIds })
            .FirstOrDefaultAsync(u => u.Id == userId);

        if (dbUser == null) return Array.Empty<Guid>();

        // ── Tầng 1: Admin Toàn Cục ──────────────────────────────────
        // Không bị lọc — thấy tất cả
        if (dbUser.Role == "admin")
            return null;

        // ── Tầng 2: Admin Tỉnh ──────────────────────────────────────
        // Thấy tất cả trạm thuộc các tỉnh được gán
        if (dbUser.Role == "admin_province")
        {
            if (dbUser.ProvinceIds == null || dbUser.ProvinceIds.Length == 0)
                return Array.Empty<Guid>(); // chưa gán tỉnh → không thấy gì

            // Lấy tất cả stationId thuộc các tỉnh đó
            var stationIds = await _db.Stations
                .AsNoTracking()
                .Where(s => s.ProvinceId != null && dbUser.ProvinceIds.Contains(s.ProvinceId!.Value))
                .Select(s => s.Id)
                .ToArrayAsync();

            return stationIds;
        }

        // ── Tầng 3: Admin Trạm / Manager / Operator ─────────────────
        // Chỉ thấy các trạm được gán trực tiếp
        if (dbUser.StationIds != null && dbUser.StationIds.Length > 0)
            return dbUser.StationIds;

        // Không có StationIds → không thấy trạm nào
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

        var userIdStr = user.FindFirstValue(ClaimTypes.NameIdentifier);
        if (!Guid.TryParse(userIdStr, out var userId)) return Array.Empty<Guid>();

        var dbUser = await _db.Users
            .AsNoTracking()
            .Select(u => new { u.Id, u.Role, u.ProvinceIds })
            .FirstOrDefaultAsync(u => u.Id == userId);

        if (dbUser == null) return Array.Empty<Guid>();

        if (dbUser.Role == "admin") return null; // tất cả

        if (dbUser.Role == "admin_province")
            return dbUser.ProvinceIds ?? Array.Empty<Guid>();

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

        var userIdStr = user.FindFirstValue(ClaimTypes.NameIdentifier);
        if (!Guid.TryParse(userIdStr, out var userId)) return false;

        var dbUser = await _db.Users
            .AsNoTracking()
            .Select(u => new { u.Id, u.Role, u.Permissions })
            .FirstOrDefaultAsync(u => u.Id == userId);

        if (dbUser == null) return false;

        // Admin Toàn Cục luôn có full quyền (cái to nhất có full)
        if (dbUser.Role == "admin") return true;

        // Kiểm tra trong danh sách quyền được cấp động
        if (dbUser.Permissions == null || dbUser.Permissions.Length == 0) return false;

        return dbUser.Permissions.Contains(permissionKey);
    }
}

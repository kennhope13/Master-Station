// ============================================================
// UsersController — Quản lý tài khoản người dùng
// Routes:
//   GET    /api/v1/users          — Danh sách users (admin only)
//   POST   /api/v1/users          — Tạo user mới (admin only)
//   PUT    /api/v1/users/{id}     — Sửa thông tin (admin only)
//   POST   /api/v1/users/{id}/change-password — Đổi mật khẩu
//   DELETE /api/v1/users/{id}     — Vô hiệu hóa (admin only)
//
// Restricted admin (admin + StationIds):
//   - Chỉ thấy/quản lý user thuộc trạm mình phụ trách
//   - Không tạo được global admin (admin không có StationIds)
//   - Không đụng được user ngoài scope trạm
// ============================================================

using System.Security.Claims;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using Microsoft.EntityFrameworkCore;
using StationOS.Data;
using StationOS.Data.Entities;
using StationOS.Api.Filters;
using Microsoft.AspNetCore.SignalR;
using StationOS.Api.Hubs;
using StationOS.Services;
using StationOS.Services.Security;

namespace StationOS.Api.Controllers;

[ApiController]
[Route("api/v1/users")]
[Authorize]
public class UsersController : ControllerBase
{
    private readonly AppDbContext _db;
    private readonly IHubContext<RealtimeHub> _hubContext;
    private readonly PermissionService _permissions;
    private readonly CredentialEncryptionService _crypto;

    public UsersController(AppDbContext db, IHubContext<RealtimeHub> hubContext, PermissionService permissions, CredentialEncryptionService crypto)
    {
        _db = db;
        _hubContext = hubContext;
        _permissions = permissions;
        _crypto = crypto;
    }

    private object ToUserResponse(User user) => new
    {
        user.Id, user.Username, user.FullName,
        user.Email, user.Role, user.IsActive, user.StationIds, user.ProvinceIds,
        user.TeamId, user.Permissions, user.CreatedAt,
        initialPassword = string.IsNullOrWhiteSpace(user.ProvisionedPassword) ? null : _crypto.Decrypt(user.ProvisionedPassword)
    };

    // Lấy danh sách StationId và ProvinceId mà caller được phép quản lý. null = không giới hạn.
    private async Task<(bool isRestricted, Guid[]? stationIds, Guid[]? provinceIds)> GetCallerScopeAsync()
    {
        var provinceIds = await _permissions.GetAllowedProvinceIdsAsync();
        var stationIds = await _permissions.GetAllowedStationIdsAsync();
        var isRestricted = provinceIds != null || stationIds != null;
        return (isRestricted, stationIds, provinceIds);
    }

    private async Task<bool> UserInScopeAsync(Guid[]? targetStationIds, Guid[]? targetProvinceIds, Guid? targetTeamId, Guid[]? callerStationIds, Guid[]? callerProvinceIds)
    {
        if (callerProvinceIds != null && callerProvinceIds.Length > 0)
        {
            if (targetProvinceIds != null && targetProvinceIds.Any(pid => callerProvinceIds.Contains(pid)))
                return true;

            if (targetStationIds != null && targetStationIds.Length > 0)
            {
                var stationsInProvinces = await _db.Stations
                    .Where(s => s.ProvinceId != null && callerProvinceIds.Contains(s.ProvinceId.Value))
                    .Select(s => s.Id)
                    .ToListAsync();
                if (targetStationIds.Any(sid => stationsInProvinces.Contains(sid)))
                    return true;
            }

            if (targetTeamId != null)
            {
                var team = await _db.Teams.FindAsync(targetTeamId.Value);
                if (team != null && team.ProvinceId != null && callerProvinceIds.Contains(team.ProvinceId.Value))
                    return true;
            }
        }

        if (callerStationIds != null && callerStationIds.Length > 0)
        {
            if (targetStationIds != null && targetStationIds.Any(sid => callerStationIds.Contains(sid)))
                return true;

            if (targetTeamId != null)
            {
                var team = await _db.Teams.FindAsync(targetTeamId.Value);
                if (team?.StationIds != null && team.StationIds.Any(sid => callerStationIds.Contains(sid)))
                    return true;
            }
        }

        return false;
    }

    private static Guid[]? NormalizeGuidArray(Guid[]? values)
    {
        if (values == null) return null;
        var normalized = values
            .Where(v => v != Guid.Empty)
            .Distinct()
            .ToArray();
        return normalized.Length == 0 ? null : normalized;
    }

    private async Task<(bool ok, IActionResult? error, Guid[]? stationIds, Guid[]? provinceIds, Guid? teamId)> ValidateAndNormalizeAssignmentsAsync(
        string role,
        Guid[]? stationIds,
        Guid[]? provinceIds,
        Guid? teamId,
        bool isRestricted,
        Guid[]? callerStationIds,
        Guid[]? callerProvinceIds)
    {
        stationIds = NormalizeGuidArray(stationIds);
        provinceIds = NormalizeGuidArray(provinceIds);
        teamId = teamId == Guid.Empty ? null : teamId;

        if (role == "admin")
        {
            return (true, null, null, null, null);
        }

        if (isRestricted)
        {
            if (callerProvinceIds != null && callerProvinceIds.Length > 0)
            {
                if (provinceIds != null)
                {
                    var unauthorizedProvinces = provinceIds.Where(pid => !callerProvinceIds.Contains(pid)).ToArray();
                    if (unauthorizedProvinces.Length > 0)
                    {
                        return (false, StatusCode(403, new { message = "Bạn không có quyền gán một số Tỉnh đã chọn." }), null, null, null);
                    }
                }

                if (stationIds != null)
                {
                    var stationsInProvinces = await _db.Stations
                        .Where(s => s.ProvinceId != null && callerProvinceIds.Contains(s.ProvinceId.Value))
                        .Select(s => s.Id)
                        .ToListAsync();
                    var unauthorizedStations = stationIds.Where(sid => !stationsInProvinces.Contains(sid)).ToArray();
                    if (unauthorizedStations.Length > 0)
                    {
                        return (false, StatusCode(403, new { message = "Bạn không có quyền gán một số trạm giám sát ngoài tỉnh được quản lý." }), null, null, null);
                    }
                }
            }
            else if (callerStationIds != null && callerStationIds.Length > 0)
            {
                if (provinceIds != null)
                {
                    return (false, BadRequest(new { message = "Tài khoản quản lý trạm không được gán Tỉnh quản lý." }), null, null, null);
                }

                if (stationIds != null)
                {
                    var unauthorizedStations = stationIds.Where(sid => !callerStationIds.Contains(sid)).ToArray();
                    if (unauthorizedStations.Length > 0)
                    {
                        return (false, StatusCode(403, new { message = "Bạn không có quyền gán một số trạm giám sát đã chọn." }), null, null, null);
                    }
                }
            }
        }

        if (teamId != null)
        {
            var team = await _db.Teams.FindAsync(teamId.Value);
            if (team == null)
            {
                return (false, BadRequest(new { message = "Không tìm thấy tổ thao tác đã chọn." }), null, null, null);
            }

            if (isRestricted)
            {
                if (callerProvinceIds != null && callerProvinceIds.Length > 0)
                {
                    if (team.ProvinceId == null || !callerProvinceIds.Contains(team.ProvinceId.Value))
                    {
                        return (false, StatusCode(403, new { message = "Bạn không có quyền gán tổ thao tác thuộc tỉnh khác." }), null, null, null);
                    }
                }
                else if (callerStationIds != null && callerStationIds.Length > 0)
                {
                    if (team.StationIds == null || !team.StationIds.Any(sid => callerStationIds.Contains(sid)))
                    {
                        return (false, StatusCode(403, new { message = "Bạn không có quyền gán tổ thao tác thuộc trạm khác." }), null, null, null);
                    }
                }
            }
        }

        if (role is "admin_province" or "operator_province")
        {
            if (provinceIds == null || provinceIds.Length == 0)
            {
                return (false, BadRequest(new { message = "Tài khoản cấp tỉnh phải được gán ít nhất một Tỉnh quản lý." }), null, null, null);
            }

            stationIds = null;
            teamId = null;
        }
        else if (role is "admin_station" or "manager" or "operator" or "team_leader" or "team_member")
        {
            if ((stationIds == null || stationIds.Length == 0) && teamId == null)
            {
                return (false, BadRequest(new { message = "Tài khoản cấp trạm hoặc tổ thao tác phải được gán ít nhất một trạm hoặc một tổ thao tác." }), null, null, null);
            }

            provinceIds = null;
        }

        return (true, null, stationIds, provinceIds, teamId);
    }

    /// <summary>Danh sách users. Restricted admin chỉ thấy user thuộc trạm hoặc tỉnh của mình.</summary>
    [HttpGet]
    [HasPermission("user:view")]
    public async Task<IActionResult> GetAll()
    {
        var (isRestricted, callerStationIds, callerProvinceIds) = await GetCallerScopeAsync();

        var allUsers = await _db.Users
            .OrderByDescending(u => u.CreatedAt)
            .ToListAsync();

        if (isRestricted)
        {
            var filtered = new List<User>();
            foreach (var u in allUsers)
            {
                if (await UserInScopeAsync(u.StationIds, u.ProvinceIds, u.TeamId, callerStationIds, callerProvinceIds))
                {
                    filtered.Add(u);
                }
            }
            return Ok(filtered.Select(ToUserResponse));
        }

        return Ok(allUsers.Select(ToUserResponse));
    }

    /// <summary>Lấy danh sách các Permission Keys khả dụng cho bảng chọn phân quyền (checklist).</summary>
    [HttpGet("permissions")]
    [HasPermission("user:view")]
    public IActionResult GetAvailablePermissions()
    {
        var permissions = new[]
        {
            new { Key = "station:view", Name = "Xem Trạm", Group = "Quản lý Trạm" },
            new { Key = "station:manage", Name = "Cấu hình / Quản lý Trạm", Group = "Quản lý Trạm" },
            new { Key = "device:view", Name = "Xem Thiết bị / Đo lường", Group = "Vận hành" },
            new { Key = "device:manage", Name = "Quản lý Thiết bị", Group = "Vận hành" },
            new { Key = "user:view", Name = "Xem Người dùng", Group = "Quản trị" },
            new { Key = "user:manage", Name = "Quản lý Người dùng / Phân quyền", Group = "Quản trị" },
            new { Key = "rule:view", Name = "Xem Quy tắc / SLD", Group = "Cấu hình" },
            new { Key = "rule:manage", Name = "Cấu hình Quy tắc / SLD", Group = "Cấu hình" },
            new { Key = "report:view", Name = "Xem Báo cáo / Nhật ký", Group = "Báo cáo" },
            new { Key = "report:manage", Name = "Tạo Báo cáo thủ công", Group = "Báo cáo" },
            new { Key = "settings:manage", Name = "Cài đặt hệ thống", Group = "Hệ thống" },
            new { Key = "license:manage", Name = "Quản lý Bản quyền / Giftcode", Group = "Bản quyền" }
        };
        return Ok(permissions);
    }
    /// <summary>Tạo user mới. Restricted admin không tạo được global admin và chỉ gán trạm/tỉnh trong scope.</summary>
    [HttpPost]
    [HasPermission("user:manage")]
    public async Task<IActionResult> Create([FromBody] CreateUserRequest req)
    {
        var (isRestricted, callerStationIds, callerProvinceIds) = await GetCallerScopeAsync();

        var normalizedUsername = UsernameNormalizer.Normalize(req.Username);
        if (string.IsNullOrWhiteSpace(normalizedUsername))
            return BadRequest(new { message = "Tên đăng nhập chỉ được gồm chữ và số, không dùng ký tự đặc biệt." });

        if (await _db.Users.AnyAsync(u => u.Username == normalizedUsername))
            return BadRequest(new { message = $"Tên đăng nhập '{normalizedUsername}' đã tồn tại" });

        if (string.IsNullOrWhiteSpace(req.Password) || req.Password.Length < 6)
            return BadRequest(new { message = "Mật khẩu phải ít nhất 6 ký tự" });

        var validRoles = new[] { "operator", "manager", "admin_station", "admin_province", "operator_province", "team_leader", "team_member", "admin" };
        var role = req.Role?.ToLower() ?? "operator";
        if (!validRoles.Contains(role))
            return BadRequest(new { message = "Vai trò không hợp lệ" });

        var stationIds = req.StationIds;
        var provinceIds = req.ProvinceIds;

        var callerRole = User.FindFirstValue(ClaimTypes.Role);

        if (isRestricted)
        {
            // Restricted admin không được tạo global admin
            if (role == "admin")
                return Forbid();

            // Nếu caller giới hạn theo tỉnh (admin_province)
            if (callerProvinceIds != null && callerProvinceIds.Length > 0)
            {
                // Không được tạo admin_province
                if (role == "admin_province")
                    return Forbid();
            }
            // Nếu caller giới hạn theo trạm
            else if (callerStationIds != null && callerStationIds.Length > 0)
            {
                if (callerRole == "team_leader")
                {
                    // Tổ trưởng chỉ được tạo nhân viên tổ và operator
                    if (!new[] { "team_member", "operator" }.Contains(role))
                        return Forbid();
                }
                else
                {
                    // admin_station: không được tạo vai trò cấp tỉnh
                    if (new[] { "admin_province", "operator_province" }.Contains(role))
                        return Forbid();
                }
            }
        }

        var normalized = await ValidateAndNormalizeAssignmentsAsync(role, stationIds, provinceIds, req.TeamId, isRestricted, callerStationIds, callerProvinceIds);
        if (!normalized.ok) return normalized.error!;

        var user = new User
        {
            Username     = normalizedUsername,
            PasswordHash = BCrypt.Net.BCrypt.HashPassword(req.Password),
            ProvisionedPassword = _crypto.Encrypt(req.Password),
            FullName     = req.FullName?.Trim(),
            Email        = req.Email?.Trim(),
            Role         = role,
            IsActive     = true,
            StationIds   = normalized.stationIds,
            ProvinceIds  = normalized.provinceIds,
            TeamId       = normalized.teamId,
            Permissions  = req.Permissions
        };

        _db.Users.Add(user);
        await _db.SaveChangesAsync();

        await _hubContext.Clients.All.SendAsync("UserStatusChange", new { username = user.Username, status = "updated", ts = DateTime.UtcNow });

        return Ok(ToUserResponse(user));
    }

    /// <summary>Sửa thông tin user. Restricted admin chỉ sửa user trong scope trạm/tỉnh.</summary>
    [HttpPut("{id:guid}")]
    [HasPermission("user:manage")]
    public async Task<IActionResult> Update(Guid id, [FromBody] UpdateUserRequest req)
    {
        var (isRestricted, callerStationIds, callerProvinceIds) = await GetCallerScopeAsync();

        var user = await _db.Users.FindAsync(id);
        if (user == null) return NotFound(new { message = "Không tìm thấy người dùng" });

        if (isRestricted && !await UserInScopeAsync(user.StationIds, user.ProvinceIds, user.TeamId, callerStationIds, callerProvinceIds))
            return Forbid();

        if (req.FullName != null) user.FullName = req.FullName.Trim();
        if (req.Email    != null) user.Email    = req.Email.Trim();
        if (req.Role     != null)
        {
            var validRoles = new[] { "operator", "manager", "admin_station", "admin_province", "operator_province", "team_leader", "team_member", "admin" };
            var nextRole = req.Role.ToLower();
            if (!validRoles.Contains(nextRole))
                return BadRequest(new { message = "Vai trò không hợp lệ" });

            var callerRoleForUpdate = User.FindFirstValue(ClaimTypes.Role);
            if (isRestricted)
            {
                // Không được nâng thành admin
                if (nextRole == "admin")
                    return Forbid();

                // Nếu caller là admin tỉnh, không được nâng thành admin tỉnh khác hoặc admin toàn cục
                if (callerProvinceIds != null && callerProvinceIds.Length > 0 && nextRole == "admin_province")
                {
                    if (user.Role != "admin_province")
                        return Forbid();
                }

                // Tổ trưởng chỉ được đặt vai trò team_member hoặc operator cho người trong tổ
                if (callerRoleForUpdate == "team_leader" && !new[] { "team_member", "operator" }.Contains(nextRole))
                    return Forbid();
            }

            user.Role = nextRole;
        }
        if (req.IsActive.HasValue) user.IsActive = req.IsActive.Value;

        var nextStationIds = req.StationIds ?? user.StationIds;
        var nextProvinceIds = req.ProvinceIds ?? user.ProvinceIds;
        var nextTeamId = req.TeamId.HasValue ? req.TeamId : user.TeamId;
        var normalizedUpdate = await ValidateAndNormalizeAssignmentsAsync(user.Role, nextStationIds, nextProvinceIds, nextTeamId, isRestricted, callerStationIds, callerProvinceIds);
        if (!normalizedUpdate.ok) return normalizedUpdate.error!;

        user.StationIds = normalizedUpdate.stationIds;
        user.ProvinceIds = normalizedUpdate.provinceIds;
        user.TeamId = normalizedUpdate.teamId;

        if (req.Permissions != null) user.Permissions = req.Permissions;

        await _db.SaveChangesAsync();
        await _hubContext.Clients.All.SendAsync("UserStatusChange", new { username = user.Username, status = "updated", ts = DateTime.UtcNow });

        return Ok(ToUserResponse(user));
    }

    /// <summary>
    /// Đổi mật khẩu:
    ///   Admin → có thể đổi bất kỳ user nào (trong scope nếu restricted)
    ///   User thường → chỉ đổi của mình + cần cung cấp old password
    /// </summary>
    [HttpPost("{id:guid}/change-password")]
    public async Task<IActionResult> ChangePassword(Guid id, [FromBody] ChangePasswordRequest req)
    {
        var currentUserId = User.FindFirstValue(ClaimTypes.NameIdentifier);
        var currentRole   = User.FindFirstValue(ClaimTypes.Role);
        var isAdmin       = currentRole == "admin" || currentRole == "admin_province" || currentRole == "admin_station";

        if (!isAdmin && currentUserId != id.ToString())
            return Forbid();

        var user = await _db.Users.FindAsync(id);
        if (user == null) return NotFound(new { message = "Không tìm thấy người dùng" });

        // Restricted admin chỉ đổi mật khẩu user trong scope
        if (isAdmin && currentUserId != id.ToString())
        {
            var (isRestricted, callerStationIds, callerProvinceIds) = await GetCallerScopeAsync();
            if (isRestricted && !await UserInScopeAsync(user.StationIds, user.ProvinceIds, user.TeamId, callerStationIds, callerProvinceIds))
                return Forbid();
        }

        if (currentUserId == id.ToString())
        {
            if (string.IsNullOrEmpty(req.OldPassword))
                return BadRequest(new { message = "Cần cung cấp mật khẩu cũ" });
            if (!BCrypt.Net.BCrypt.Verify(req.OldPassword, user.PasswordHash))
                return BadRequest(new { message = "Mật khẩu cũ không đúng" });
        }

        if (string.IsNullOrWhiteSpace(req.NewPassword) || req.NewPassword.Length < 6)      {
            if (string.IsNullOrEmpty(req.OldPassword))
                return BadRequest(new { message = "Cần cung cấp mật khẩu cũ" });
            if (!BCrypt.Net.BCrypt.Verify(req.OldPassword, user.PasswordHash))
                return BadRequest(new { message = "Mật khẩu cũ không đúng" });
        }

        if (string.IsNullOrWhiteSpace(req.NewPassword) || req.NewPassword.Length < 6)
            return BadRequest(new { message = "Mật khẩu mới phải ít nhất 6 ký tự" });

        user.PasswordHash = BCrypt.Net.BCrypt.HashPassword(req.NewPassword);
        user.LastPasswordChangedAt = DateTime.UtcNow;
        if (currentUserId == id.ToString())
        {
            user.ProvisionedPassword = null;
            user.MustChangePassword = false;
        }
        else
        {
            user.ProvisionedPassword = _crypto.Encrypt(req.NewPassword);
            user.MustChangePassword = true;
        }
        await _db.SaveChangesAsync();

        await _hubContext.Clients.All.SendAsync("UserStatusChange", new { username = user.Username, status = "updated", ts = DateTime.UtcNow });

        return Ok(new { message = "Đổi mật khẩu thành công" });
    }

    /// <summary>Vô hiệu hóa hoặc xóa vĩnh viễn user. ?permanent=true để xóa hẳn.</summary>
    [HttpDelete("{id:guid}")]
    [HasPermission("user:manage")]
    public async Task<IActionResult> Deactivate(Guid id, [FromQuery] bool permanent = false)
    {
        var currentUserId = User.FindFirstValue(ClaimTypes.NameIdentifier);
        if (currentUserId == id.ToString())
            return BadRequest(new { message = permanent ? "Không thể xóa tài khoản của chính mình" : "Không thể vô hiệu hóa tài khoản của chính mình" });

        var (isRestricted, callerStationIds, callerProvinceIds) = await GetCallerScopeAsync();

        var user = await _db.Users.FindAsync(id);
        if (user == null) return NotFound(new { message = "Không tìm thấy người dùng" });

        if (isRestricted && !await UserInScopeAsync(user.StationIds, user.ProvinceIds, user.TeamId, callerStationIds, callerProvinceIds))
            return Forbid();

        HttpContext.Items["AuditOldValue"] = System.Text.Json.JsonSerializer.Serialize(new
        {
            username = user.Username,
            fullName = user.FullName,
            email = user.Email,
            role = user.Role,
            isActive = user.IsActive
        });

        if (permanent)
        {
            _db.Users.Remove(user);
            await _db.SaveChangesAsync();
            await _hubContext.Clients.All.SendAsync("UserStatusChange", new { username = user.Username, status = "deleted", ts = DateTime.UtcNow });
            return Ok(new { message = $"Đã xóa vĩnh viễn tài khoản '{user.Username}'" });
        }

        if (!user.IsActive)
            return BadRequest(new { message = "Tài khoản đã bị vô hiệu hóa" });

        user.IsActive = false;
        await _db.SaveChangesAsync();
        await _hubContext.Clients.All.SendAsync("UserStatusChange", new { username = user.Username, status = "deactivated", ts = DateTime.UtcNow });

        return Ok(new { message = $"Đã vô hiệu hóa tài khoản '{user.Username}'" });
    }
}

// ── Request Models ─────────────────────────────────────────
public record CreateUserRequest(
    string Username,
    string Password,
    string? FullName,
    string? Email,
    string? Role,
    Guid[]? StationIds,
    Guid[]? ProvinceIds,
    Guid?   TeamId,
    string[]? Permissions
);

public record UpdateUserRequest(
    string? FullName,
    string? Email,
    string? Role,
    bool?   IsActive,
    Guid[]? StationIds,
    Guid[]? ProvinceIds,
    Guid?   TeamId,
    string[]? Permissions
);

public record ChangePasswordRequest(
    string? OldPassword,  // Bắt buộc nếu không phải admin
    string  NewPassword
);

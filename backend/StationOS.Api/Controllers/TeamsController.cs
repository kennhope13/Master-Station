// ============================================================
// TeamsController — Quản lý Tổ thao tác lưu động
// Routes:
//   GET    /api/v1/teams          — Danh sách tổ thao tác
//   GET    /api/v1/teams/{id}     — Chi tiết tổ thao tác
//   POST   /api/v1/teams          — Tạo tổ thao tác mới (admin/manager)
//   PUT    /api/v1/teams/{id}     — Sửa thông tin tổ (admin/manager)
//   DELETE /api/v1/teams/{id}     — Xóa tổ (admin/manager)
// ============================================================

using System.Security.Claims;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using Microsoft.EntityFrameworkCore;
using Microsoft.AspNetCore.SignalR;
using StationOS.Data;
using StationOS.Data.Entities;
using StationOS.Services;
using StationOS.Api.Filters;
using StationOS.Services.Security;

namespace StationOS.Api.Controllers;

[ApiController]
[Route("api/v1/teams")]
[Authorize]
public class TeamsController : ControllerBase
{
    private readonly AppDbContext _db;
    private readonly PermissionService _permissions;
    private readonly Microsoft.AspNetCore.SignalR.IHubContext<Hubs.RealtimeHub> _hubContext;
    private readonly CredentialEncryptionService _crypto;
    private const string DefaultTeamLeaderPasswordSuffix = "@26";

    public TeamsController(AppDbContext db, PermissionService permissions, Microsoft.AspNetCore.SignalR.IHubContext<Hubs.RealtimeHub> hubContext, CredentialEncryptionService crypto)
    {
        _db = db;
        _permissions = permissions;
        _hubContext = hubContext;
        _crypto = crypto;
    }

    private static string NormalizeAccountToken(string? value)
    {
        var token = UsernameNormalizer.Normalize(value);
        return string.IsNullOrWhiteSpace(token) ? "team" : token;
    }

    private async Task EnsureDefaultTeamLeaderAsync(Team team)
    {
        var hasLeader = await _db.Users.AnyAsync(u => u.Role == "team_leader" && u.TeamId == team.Id);
        if (hasLeader)
            return;

        var province = team.ProvinceId.HasValue
            ? await _db.Provinces.AsNoTracking().FirstOrDefaultAsync(p => p.Id == team.ProvinceId.Value)
            : null;

        var teamToken = NormalizeAccountToken(team.Name);
        var provinceToken = NormalizeAccountToken(!string.IsNullOrWhiteSpace(province?.Code) ? province!.Code : province?.Name);
        var usernameToken = string.IsNullOrWhiteSpace(provinceToken) ? teamToken : $"{teamToken}{provinceToken}";
        var usernameBase = $"teamleader{usernameToken}";
        var username = usernameBase;
        var suffix = 2;
        while (await _db.Users.AnyAsync(u => u.Username == username))
        {
            username = $"{usernameBase}{suffix}";
            suffix++;
        }

        var shortTeamToken = teamToken.Length > 6 ? teamToken[..6] : teamToken;
        var shortProvinceToken = provinceToken.Length > 3 ? provinceToken[..3] : provinceToken;
        var passwordToken = $"{char.ToUpperInvariant(shortTeamToken[0])}{shortTeamToken[1..]}{shortProvinceToken.ToUpperInvariant()}";
        var defaultPassword = $"{passwordToken}{DefaultTeamLeaderPasswordSuffix}";

        var user = new User
        {
            Username = username,
            PasswordHash = BCrypt.Net.BCrypt.HashPassword(defaultPassword, workFactor: 12),
            ProvisionedPassword = _crypto.Encrypt(defaultPassword),
            FullName = $"Tổ trưởng {team.Name}",
            Email = $"{username}@stationos.vn",
            Role = "team_leader",
            TeamId = team.Id,
            Permissions = PermissionService.GetDefaultPermissionsForRole("team_leader").ToArray(),
            IsActive = true,
            MustChangePassword = true,
            LastPasswordChangedAt = DateTime.UtcNow
        };

        _db.Users.Add(user);
        await _db.SaveChangesAsync();
    }

    /// <summary>Danh sách tổ thao tác — lọc theo phân cấp tổ → tỉnh → toàn cục.</summary>
    [HttpGet]
    public async Task<IActionResult> GetAll()
    {
        var callerRole = User.FindFirstValue(ClaimTypes.Role);
        var callerTeamIdStr = User.FindFirstValue("teamId");

        // Tổ trưởng chỉ thấy tổ của mình
        if (callerRole == "team_leader" && Guid.TryParse(callerTeamIdStr, out var callerTeamId))
        {
            var ownTeam = await _db.Teams.AsNoTracking().FirstOrDefaultAsync(t => t.Id == callerTeamId);
            return Ok(ownTeam != null ? new[] { ownTeam } : Array.Empty<Team>());
        }

        // Admin tỉnh chỉ thấy tổ trong tỉnh của mình
        var allowedProvinceIds = await _permissions.GetAllowedProvinceIdsAsync();
        if (allowedProvinceIds != null)
        {
            var provincedTeams = await _db.Teams.AsNoTracking()
                .Where(t => t.ProvinceId != null && allowedProvinceIds.Contains(t.ProvinceId.Value))
                .ToListAsync();
            return Ok(provincedTeams);
        }

        var teams = await _db.Teams.AsNoTracking().ToListAsync();
        return Ok(teams);
    }

    /// <summary>Chi tiết tổ thao tác.</summary>
    [HttpGet("{id:guid}")]
    public async Task<IActionResult> GetById(Guid id)
    {
        var team = await _db.Teams.AsNoTracking().FirstOrDefaultAsync(t => t.Id == id);
        if (team == null) return NotFound(new { message = "Không tìm thấy tổ thao tác" });
        return Ok(team);
    }

    /// <summary>Tạo tổ thao tác mới. Tổ trưởng không được tạo tổ mới.</summary>
    [HttpPost]
    [HasPermission("user:manage")]
    public async Task<IActionResult> Create([FromBody] CreateTeamRequest req)
    {
        // Chỉ admin và admin_province mới được tạo tổ
        var callerRole = User.FindFirstValue(ClaimTypes.Role);
        if (callerRole == "team_leader")
            return Forbid();

        if (string.IsNullOrWhiteSpace(req.Name))
            return BadRequest(new { message = "Tên tổ không được để trống" });

        var allowedProvinceIds = await _permissions.GetAllowedProvinceIdsAsync();
        if (allowedProvinceIds != null)
        {
            if (req.ProvinceId == null)
            {
                return BadRequest(new { message = "Tài khoản của bạn yêu cầu phải chọn Tỉnh khi tạo tổ thao tác." });
            }
            if (!allowedProvinceIds.Contains(req.ProvinceId.Value))
            {
                return StatusCode(403, new { message = "Bạn không có quyền tạo tổ thao tác tại tỉnh này." });
            }
        }

        if (req.ProvinceId == null && req.StationIds != null && req.StationIds.Length > 0)
        {
            return BadRequest(new { message = "Không thể gán trạm giám sát khi tổ thao tác không có Tỉnh quản lý." });
        }

        if (req.StationIds != null && req.StationIds.Length > 0)
        {
            var invalidStationsExist = await _db.Stations
                .AnyAsync(s => req.StationIds.Contains(s.Id) && s.ProvinceId != req.ProvinceId);
            if (invalidStationsExist)
            {
                return BadRequest(new { message = "Một số trạm được chọn không thuộc Tỉnh quản lý của tổ thao tác." });
            }

            var allowedStationIds = await _permissions.GetAllowedStationIdsAsync();
            if (allowedStationIds != null)
            {
                var unauthorizedStationsExist = req.StationIds.Any(sid => !allowedStationIds.Contains(sid));
                if (unauthorizedStationsExist)
                {
                    return StatusCode(403, new { message = "Bạn không có quyền gán một số trạm giám sát đã chọn." });
                }
            }
        }

        var team = new Team
        {
            Name = req.Name.Trim(),
            ProvinceId = req.ProvinceId,
            StationIds = req.StationIds ?? Array.Empty<Guid>()
        };

        _db.Teams.Add(team);
        await _db.SaveChangesAsync();
        await EnsureDefaultTeamLeaderAsync(team);

        await _hubContext.Clients.All.SendAsync("UserStatusChange", new { username = "", status = "team_changed", ts = DateTime.UtcNow });

        return Ok(team);
    }

    /// <summary>Cập nhật tổ thao tác. Tổ trưởng chỉ sửa được tổ của mình.</summary>
    [HttpPut("{id:guid}")]
    [HasPermission("user:manage")]
    public async Task<IActionResult> Update(Guid id, [FromBody] UpdateTeamRequest req)
    {
        var team = await _db.Teams.FindAsync(id);
        if (team == null) return NotFound(new { message = "Không tìm thấy tổ thao tác" });

        // Tổ trưởng chỉ sửa được tổ của mình, không đổi được tỉnh hay trạm
        var callerRole = User.FindFirstValue(ClaimTypes.Role);
        var callerTeamIdStr = User.FindFirstValue("teamId");
        if (callerRole == "team_leader")
        {
            if (!Guid.TryParse(callerTeamIdStr, out var callerTeamId) || callerTeamId != id)
                return Forbid();
            // Tổ trưởng chỉ đổi được tên tổ
            if (req.Name != null) team.Name = req.Name.Trim();
            await _db.SaveChangesAsync();
            await _hubContext.Clients.All.SendAsync("UserStatusChange", new { username = "", status = "team_changed", ts = DateTime.UtcNow });
            return Ok(team);
        }

        var allowedProvinceIds = await _permissions.GetAllowedProvinceIdsAsync();
        if (allowedProvinceIds != null)
        {
            if (team.ProvinceId == null || !allowedProvinceIds.Contains(team.ProvinceId.Value))
            {
                return StatusCode(403, new { message = "Bạn không có quyền chỉnh sửa tổ thao tác ngoài tỉnh được gán." });
            }
            if (req.ProvinceId == null || !allowedProvinceIds.Contains(req.ProvinceId.Value))
            {
                return StatusCode(403, new { message = "Tỉnh mới không nằm trong danh sách quản lý của bạn." });
            }
        }

        var targetProvinceId = req.ProvinceId ?? team.ProvinceId;

        if (targetProvinceId == null && req.StationIds != null && req.StationIds.Length > 0)
        {
            return BadRequest(new { message = "Không thể gán trạm giám sát khi tổ thao tác không có Tỉnh quản lý." });
        }

        if (req.StationIds != null && req.StationIds.Length > 0)
        {
            var invalidStationsExist = await _db.Stations
                .AnyAsync(s => req.StationIds.Contains(s.Id) && s.ProvinceId != targetProvinceId);
            if (invalidStationsExist)
            {
                return BadRequest(new { message = "Một số trạm được chọn không thuộc Tỉnh quản lý của tổ thao tác." });
            }

            var allowedStationIds = await _permissions.GetAllowedStationIdsAsync();
            if (allowedStationIds != null)
            {
                var unauthorizedStationsExist = req.StationIds.Any(sid => !allowedStationIds.Contains(sid));
                if (unauthorizedStationsExist)
                {
                    return StatusCode(403, new { message = "Bạn không có quyền gán một số trạm giám sát đã chọn." });
                }
            }
        }

        if (req.Name != null) team.Name = req.Name.Trim();
        team.ProvinceId = req.ProvinceId; // Can be set to null
        if (req.StationIds != null) team.StationIds = req.StationIds;

        await _db.SaveChangesAsync();

        await _hubContext.Clients.All.SendAsync("UserStatusChange", new { username = "", status = "team_changed", ts = DateTime.UtcNow });

        return Ok(team);
    }

    /// <summary>Xóa tổ thao tác. Tổ trưởng không được xóa tổ.</summary>
    [HttpDelete("{id:guid}")]
    [HasPermission("user:manage")]
    public async Task<IActionResult> Delete(Guid id)
    {
        // Tổ trưởng không được xóa tổ
        var callerRole = User.FindFirstValue(ClaimTypes.Role);
        if (callerRole == "team_leader")
            return Forbid();

        var team = await _db.Teams.FindAsync(id);
        if (team == null) return NotFound(new { message = "Không tìm thấy tổ thao tác" });

        var allowedProvinceIds = await _permissions.GetAllowedProvinceIdsAsync();
        if (allowedProvinceIds != null)
        {
            if (team.ProvinceId == null || !allowedProvinceIds.Contains(team.ProvinceId.Value))
            {
                return StatusCode(403, new { message = "Bạn không có quyền xóa tổ thao tác ngoài tỉnh được gán." });
            }
        }

        // Delete all users belonging to this team
        var usersInTeam = await _db.Users.Where(u => u.TeamId == id).ToListAsync();
        _db.Users.RemoveRange(usersInTeam);

        _db.Teams.Remove(team);
        await _db.SaveChangesAsync();

        await _hubContext.Clients.All.SendAsync("UserStatusChange", new { username = "", status = "team_changed", ts = DateTime.UtcNow });

        return NoContent();
    }
}

// ── Request Models ─────────────────────────────────────────
public record CreateTeamRequest(string Name, Guid? ProvinceId, Guid[]? StationIds);
public record UpdateTeamRequest(string? Name, Guid? ProvinceId, Guid[]? StationIds);

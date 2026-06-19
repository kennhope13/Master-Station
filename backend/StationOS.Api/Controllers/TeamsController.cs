// ============================================================
// TeamsController — Quản lý Tổ thao tác lưu động
// Routes:
//   GET    /api/v1/teams          — Danh sách tổ thao tác
//   GET    /api/v1/teams/{id}     — Chi tiết tổ thao tác
//   POST   /api/v1/teams          — Tạo tổ thao tác mới (admin/manager)
//   PUT    /api/v1/teams/{id}     — Sửa thông tin tổ (admin/manager)
//   DELETE /api/v1/teams/{id}     — Xóa tổ (admin/manager)
// ============================================================

using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using Microsoft.EntityFrameworkCore;
using Microsoft.AspNetCore.SignalR;
using StationOS.Data;
using StationOS.Data.Entities;
using StationOS.Services;
using StationOS.Api.Filters;

namespace StationOS.Api.Controllers;

[ApiController]
[Route("api/v1/teams")]
[Authorize]
public class TeamsController : ControllerBase
{
    private readonly AppDbContext _db;
    private readonly PermissionService _permissions;
    private readonly Microsoft.AspNetCore.SignalR.IHubContext<Hubs.RealtimeHub> _hubContext;

    public TeamsController(AppDbContext db, PermissionService permissions, Microsoft.AspNetCore.SignalR.IHubContext<Hubs.RealtimeHub> hubContext)
    {
        _db = db;
        _permissions = permissions;
        _hubContext = hubContext;
    }

    /// <summary>Danh sách tổ thao tác.</summary>
    [HttpGet]
    public async Task<IActionResult> GetAll()
    {
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

    /// <summary>Tạo tổ thao tác mới.</summary>
    [HttpPost]
    [HasPermission("user:manage")]
    public async Task<IActionResult> Create([FromBody] CreateTeamRequest req)
    {
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

        await _hubContext.Clients.All.SendAsync("UserStatusChange", new { username = "", status = "team_changed", ts = DateTime.UtcNow });

        return Ok(team);
    }

    /// <summary>Cập nhật tổ thao tác.</summary>
    [HttpPut("{id:guid}")]
    [HasPermission("user:manage")]
    public async Task<IActionResult> Update(Guid id, [FromBody] UpdateTeamRequest req)
    {
        var team = await _db.Teams.FindAsync(id);
        if (team == null) return NotFound(new { message = "Không tìm thấy tổ thao tác" });

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

    /// <summary>Xóa tổ thao tác.</summary>
    [HttpDelete("{id:guid}")]
    [HasPermission("user:manage")]
    public async Task<IActionResult> Delete(Guid id)
    {
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

        // Unlink users belonging to this team
        var usersInTeam = await _db.Users.Where(u => u.TeamId == id).ToListAsync();
        foreach (var u in usersInTeam)
        {
            u.TeamId = null;
        }

        _db.Teams.Remove(team);
        await _db.SaveChangesAsync();

        await _hubContext.Clients.All.SendAsync("UserStatusChange", new { username = "", status = "team_changed", ts = DateTime.UtcNow });

        return NoContent();
    }
}

// ── Request Models ─────────────────────────────────────────
public record CreateTeamRequest(string Name, Guid? ProvinceId, Guid[]? StationIds);
public record UpdateTeamRequest(string? Name, Guid? ProvinceId, Guid[]? StationIds);

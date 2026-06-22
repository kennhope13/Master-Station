using System.Security.Claims;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using Microsoft.EntityFrameworkCore;
using StationOS.Api.Filters;
using StationOS.Data;
using StationOS.Services.Security;

namespace StationOS.Api.Controllers;

[ApiController]
[Route("api/v1/admin-tools")]
[Authorize]
public class AdminToolsController : ControllerBase
{
    private readonly AppDbContext _db;
    private static readonly string[] PreservedUsernames = ["multi", "stationadmin"];

    public AdminToolsController(AppDbContext db)
    {
        _db = db;
    }

    [HttpPost("reset-database")]
    [HasPermission("settings:manage")]
    public async Task<IActionResult> ResetDatabase([FromBody] ResetDatabaseRequest? req = null)
    {
        var currentRole = User.FindFirstValue(ClaimTypes.Role);
        if (!string.Equals(currentRole, "admin", StringComparison.OrdinalIgnoreCase))
            return Forbid();

        if (req?.Confirm != "RESET_KEEP_4_USERS")
            return BadRequest(new { message = "Thiếu xác nhận hợp lệ. Gửi Confirm = RESET_KEEP_4_USERS." });

        await using var tx = await _db.Database.BeginTransactionAsync();

        var preservedUsers = await _db.Users
            .Where(u => PreservedUsernames.Contains(u.Username))
            .ToListAsync();

        // Dọn dữ liệu vận hành / cấu hình
        _db.AlertHistories.RemoveRange(await _db.AlertHistories.ToListAsync());
        _db.NotifyLogs.RemoveRange(await _db.NotifyLogs.ToListAsync());
        _db.RuleTriggerLogs.RemoveRange(await _db.RuleTriggerLogs.ToListAsync());
        _db.DetectionEvents.RemoveRange(await _db.DetectionEvents.ToListAsync());
        _db.ThermalFrames.RemoveRange(await _db.ThermalFrames.ToListAsync());
        _db.SensorReadings.RemoveRange(await _db.SensorReadings.ToListAsync());
        _db.MaintenanceTasks.RemoveRange(await _db.MaintenanceTasks.ToListAsync());
        _db.Reports.RemoveRange(await _db.Reports.ToListAsync());
        _db.Alerts.RemoveRange(await _db.Alerts.ToListAsync());
        _db.Boundaries.RemoveRange(await _db.Boundaries.ToListAsync());
        _db.RoiPoints.RemoveRange(await _db.RoiPoints.ToListAsync());
        _db.MediaFiles.RemoveRange(await _db.MediaFiles.ToListAsync());
        _db.SldPoints.RemoveRange(await _db.SldPoints.ToListAsync());
        _db.SldFiles.RemoveRange(await _db.SldFiles.ToListAsync());
        _db.Rules.RemoveRange(await _db.Rules.ToListAsync());
        _db.SyncQueues.RemoveRange(await _db.SyncQueues.ToListAsync());
        _db.SystemSettings.RemoveRange(await _db.SystemSettings.ToListAsync());
        _db.Devices.RemoveRange(await _db.Devices.ToListAsync());
        _db.Stations.RemoveRange(await _db.Stations.ToListAsync());

        // Dọn log hệ thống
        _db.AuditLogs.RemoveRange(await _db.AuditLogs.ToListAsync());
        _db.LoginLogs.RemoveRange(await _db.LoginLogs.ToListAsync());

        // Xóa toàn bộ user khác
        var otherUsers = await _db.Users
            .Where(u => !PreservedUsernames.Contains(u.Username))
            .ToListAsync();
        _db.Users.RemoveRange(otherUsers);

        // Giữ lại province/team để các tài khoản còn scope/capability hợp lệ, nhưng bỏ liên kết station cũ
        var teams = await _db.Teams.ToListAsync();
        foreach (var team in teams)
            team.StationIds = Array.Empty<Guid>();

        foreach (var user in preservedUsers)
        {
            user.StationIds = null;
            user.TeamId = null;
        }

        await _db.SaveChangesAsync();
        await tx.CommitAsync();

        return Ok(new
        {
            message = "Đã xóa toàn bộ dữ liệu, chỉ giữ lại 4 tài khoản chỉ định.",
            preservedUsers = PreservedUsernames
        });
    }

    [HttpPost("normalize-usernames")]
    [HasPermission("settings:manage")]
    public async Task<IActionResult> NormalizeUsernames()
    {
        var currentRole = User.FindFirstValue(ClaimTypes.Role);
        if (!string.Equals(currentRole, "admin", StringComparison.OrdinalIgnoreCase))
            return Forbid();

        var users = await _db.Users
            .OrderBy(u => u.CreatedAt)
            .ToListAsync();

        var reserved = new HashSet<string>(StringComparer.OrdinalIgnoreCase);
        var changed = new List<object>();

        foreach (var user in users)
        {
            var original = user.Username;
            var normalized = UsernameNormalizer.Normalize(original);
            if (string.IsNullOrWhiteSpace(normalized))
                normalized = $"user{user.Id.ToString("N")[..8]}";

            var candidate = normalized;
            var suffix = 2;
            while (reserved.Contains(candidate))
            {
                candidate = $"{normalized}{suffix}";
                suffix++;
            }

            reserved.Add(candidate);

            if (!string.Equals(original, candidate, StringComparison.Ordinal))
            {
                user.Username = candidate;
                changed.Add(new { id = user.Id, from = original, to = candidate });
            }
        }

        if (changed.Count > 0)
            await _db.SaveChangesAsync();

        return Ok(new
        {
            message = changed.Count == 0
                ? "Không có username nào cần chuẩn hóa."
                : $"Đã chuẩn hóa {changed.Count} username.",
            changed
        });
    }
}

public record ResetDatabaseRequest(string Confirm);

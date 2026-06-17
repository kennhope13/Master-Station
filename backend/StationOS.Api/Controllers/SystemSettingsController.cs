// ============================================================
// SystemSettingsController — Cài đặt hệ thống theo trạm
// Routes:
//   GET /api/v1/settings         — Lấy tất cả settings của trạm đầu tiên
//   PUT /api/v1/settings/{key}   — Cập nhật 1 setting theo key
// ============================================================

using System.Security.Claims;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using Microsoft.EntityFrameworkCore;
using StationOS.Data;
using StationOS.Data.Entities;
using StationOS.Api.Filters;

namespace StationOS.Api.Controllers;

[ApiController]
[Route("api/v1/settings")]
[Authorize]
public class SystemSettingsController : ControllerBase
{
    private readonly AppDbContext _db;

    // Default settings khi trạm chưa có cấu hình
    private static readonly Dictionary<string, string> DefaultSettings = new()
    {
        ["polling_interval_s"] = "3",
        ["alert_email"]        = "",
        ["timezone"]           = "Asia/Ho_Chi_Minh"
    };

    public SystemSettingsController(AppDbContext db) => _db = db;

    /// <summary>
    /// Lấy tất cả settings của trạm đầu tiên
    /// Trả về object key → value (string)
    /// Nếu chưa có setting nào → trả về defaults
    /// </summary>
    [HttpGet]
    public async Task<IActionResult> GetAll()
    {
        var station = await _db.Stations.FirstOrDefaultAsync();
        if (station == null)
            return Ok(DefaultSettings);

        var settings = await _db.SystemSettings
            .Where(s => s.StationId == station.Id && !s.Key.StartsWith("refresh_token_"))
            .ToListAsync();

        // Merge settings từ DB với defaults
        var result = new Dictionary<string, string>(DefaultSettings);
        foreach (var s in settings)
        {
            // Value lưu dạng JSONB string — có thể là "\"value\"" hoặc "value"
            var val = s.Value;
            // Unwrap JSON string nếu cần (e.g. "\"abc\"" → "abc")
            if (val.StartsWith("\"") && val.EndsWith("\"") && val.Length >= 2)
                val = val[1..^1];
            result[s.Key] = val;
        }

        return Ok(result);
    }

    /// <summary>
    /// Cập nhật 1 setting theo key (admin only)
    /// Tự động tạo nếu chưa có (upsert)
    /// </summary>
    [HttpPut("{key}")]
    [HasPermission("settings:manage")]
    public async Task<IActionResult> Update(string key, [FromBody] UpdateSettingRequest req)
    {
        var station = await _db.Stations.FirstOrDefaultAsync();
        if (station == null)
            return BadRequest(new { message = "Chưa có trạm nào trong hệ thống" });

        var currentUserId = User.FindFirstValue(ClaimTypes.NameIdentifier);
        Guid? updatedBy = currentUserId != null ? Guid.Parse(currentUserId) : null;

        var existing = await _db.SystemSettings
            .FirstOrDefaultAsync(s => s.StationId == station.Id && s.Key == key);

        // Lưu value dạng JSON string
        var jsonValue = System.Text.Json.JsonSerializer.Serialize(req.Value);

        if (existing == null)
        {
            _db.SystemSettings.Add(new SystemSettings
            {
                StationId = station.Id,
                Key       = key,
                Value     = jsonValue,
                UpdatedBy = updatedBy,
                UpdatedAt = DateTime.UtcNow
            });
        }
        else
        {
            existing.Value     = jsonValue;
            existing.UpdatedBy = updatedBy;
            existing.UpdatedAt = DateTime.UtcNow;
        }

        await _db.SaveChangesAsync();
        return Ok(new { key, value = req.Value });
    }
}

public record UpdateSettingRequest(string Value);

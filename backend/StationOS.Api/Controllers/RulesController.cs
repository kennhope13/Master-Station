// ============================================================
// RulesController — CRUD cho Rule Engine
// GET/POST/PUT/DELETE /api/v1/rules
// ============================================================

using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using Microsoft.EntityFrameworkCore;
using StationOS.Data;
using StationOS.Data.Entities;
using StationOS.Services;
using StationOS.Api.Filters;

namespace StationOS.Api.Controllers;

[ApiController]
[Route("api/v1/rules")]
// Removed global [Authorize] to allow local AI Engine access to GetAll
public class RulesController : ControllerBase
{
    private readonly AppDbContext _db;
    private readonly PermissionService _permissions;
    private readonly IRealtimeNotifier _notifier;

    public RulesController(AppDbContext db, PermissionService permissions, IRealtimeNotifier notifier)
    {
        _db = db;
        _permissions = permissions;
        _notifier = notifier;
    }

    /// <summary>Lấy danh sách tất cả rule. Nếu gọi từ localhost (AI Engine) thì trả toàn bộ không giới hạn trạm.</summary>
    /// <returns>Danh sách rule kèm tên thiết bị liên kết.</returns>
    // GET /api/v1/rules
    [HttpGet]
    [AllowAnonymous] 
    public async Task<IActionResult> GetAll()
    {
        // Cho phép truy cập không giới hạn nếu cuộc gọi đến từ chính máy chủ (Local AI Engine)
        var isLocal = HttpContext.Connection.RemoteIpAddress?.ToString() == "127.0.0.1" || 
                      HttpContext.Connection.RemoteIpAddress?.ToString() == "::1";

        if (isLocal)
        {
            var allRules = await _db.Rules
                .Include(r => r.Device)
                .OrderByDescending(r => r.CreatedAt)
                .Select(r => new {
                    r.Id, r.Name, r.RuleSet, r.Enabled,
                    r.Condition, r.Actions,
                    r.StationId, r.DeviceId,
                    deviceName = r.Device != null ? r.Device.Name : null,
                    r.CreatedAt
                })
                .ToListAsync();
            return Ok(allRules);
        }

        var allowed = await _permissions.GetAllowedStationIdsAsync();
        var q = _db.Rules.AsQueryable();
        if (allowed != null) q = q.Where(r => allowed.Contains(r.StationId));

        var rules = await q
            .Include(r => r.Device)
            .OrderByDescending(r => r.CreatedAt)
            .Select(r => new {
                r.Id, r.Name, r.RuleSet, r.Enabled,
                r.Condition, r.Actions,
                r.StationId, r.DeviceId,
                deviceName = r.Device != null ? r.Device.Name : null,
                r.CreatedAt
            })
            .ToListAsync();

        return Ok(rules);
    }

    /// <summary>Lấy chi tiết 1 rule theo ID.</summary>
    /// <param name="id">Rule ID.</param>
    /// <returns>Đối tượng Rule hoặc 404.</returns>
    // GET /api/v1/rules/{id}
    [HttpGet("{id:guid}")]
    [AllowAnonymous]
    public async Task<IActionResult> GetById(Guid id)
    {
        var rule = await _db.Rules.FindAsync(id);
        if (rule == null) return NotFound();
        return Ok(rule);
    }

    /// <summary>Tạo rule mới. Yêu cầu quyền admin hoặc manager.</summary>
    /// <param name="req">Thông tin rule cần tạo.</param>
    /// <returns>Rule vừa tạo.</returns>
    // POST /api/v1/rules
    [HttpPost]
    [HasPermission("rule:manage")]
    public async Task<IActionResult> Create([FromBody] RuleRequest req)
    {
        var station = await _db.Stations.FirstOrDefaultAsync();
        if (station == null) return BadRequest("Chưa có trạm nào trong hệ thống");

        var rule = new Rule
        {
            StationId = req.StationId ?? station.Id,
            DeviceId  = req.DeviceId,
            Name      = req.Name ?? "Tên quy tắc mới",
            RuleSet   = req.RuleSet,
            Condition = req.Condition ?? "{}",
            Actions   = req.Actions ?? "[]",
            Enabled   = req.Enabled ?? true,
        };

        _db.Rules.Add(rule);
        await _db.SaveChangesAsync();
        _ = _notifier.SendRuleListChangedAsync("created", rule.StationId);
        return Ok(rule);
    }

    /// <summary>Cập nhật rule. Chỉ cập nhật các field được gửi lên (non-null).</summary>
    /// <param name="id">Rule ID cần sửa.</param>
    /// <param name="req">Các field cần cập nhật.</param>
    /// <returns>Rule đã cập nhật.</returns>
    // PUT /api/v1/rules/{id}
    [HttpPut("{id:guid}")]
    [HasPermission("rule:manage")]
    public async Task<IActionResult> Update(Guid id, [FromBody] RuleRequest req)
    {
        var rule = await _db.Rules.FindAsync(id);
        if (rule == null) return NotFound();

        var wasEnabled = rule.Enabled;
        if (req.Name      != null) rule.Name      = req.Name;
        if (req.RuleSet   != null) rule.RuleSet   = req.RuleSet == "" ? null : req.RuleSet;
        if (req.Actions   != null) rule.Actions    = req.Actions;
        if (req.Enabled   != null) rule.Enabled    = req.Enabled.Value;
        if (req.DeviceId  != null) rule.DeviceId   = req.DeviceId;

        // Khi thay đổi condition hoặc disable rule → close hết open alerts để worker tạo alert mới chính xác
        bool conditionChanged = req.Condition != null && req.Condition != rule.Condition;
        if (req.Condition != null) rule.Condition = req.Condition;

        bool shouldCloseAlerts = conditionChanged || (wasEnabled && req.Enabled == false);
        if (shouldCloseAlerts)
        {
            var openAlerts = await _db.Alerts
                .Where(a => a.RuleId == id && a.Status == "open")
                .ToListAsync();
            foreach (var a in openAlerts)
            {
                a.Status = "closed";
                a.ClosedAt = DateTime.UtcNow;
            }
        }

        await _db.SaveChangesAsync();
        _ = _notifier.SendRuleListChangedAsync("updated", rule.StationId);
        return Ok(rule);
    }

    /// <summary>Xóa rule. Chỉ admin mới có quyền.</summary>
    /// <param name="id">Rule ID cần xóa.</param>
    /// <returns>204 NoContent nếu thành công.</returns>
    // DELETE /api/v1/rules/{id}
    [HttpDelete("{id:guid}")]
    [HasPermission("rule:manage")]
    public async Task<IActionResult> Delete(Guid id)
    {
        var rule = await _db.Rules.FindAsync(id);
        if (rule == null) return NotFound();
        _db.Rules.Remove(rule);
        await _db.SaveChangesAsync();
        _ = _notifier.SendRuleListChangedAsync("deleted", rule.StationId);
        return NoContent();
    }

    /// <summary>Bật/tắt rule (toggle enabled).</summary>
    /// <param name="id">Rule ID.</param>
    /// <returns>Trạng thái enabled mới của rule.</returns>
    [HttpPatch("{id}/toggle")]
    [HasPermission("rule:manage")]
    public async Task<IActionResult> Toggle(Guid id)
    {
        var rule = await _db.Rules.FindAsync(id);
        if (rule == null) return NotFound();
        var wasEnabled = rule.Enabled;
        rule.Enabled = !rule.Enabled;

        // Khi tắt rule → close hết open alerts để khi bật lại worker tạo alert mới
        if (wasEnabled && !rule.Enabled)
        {
            var openAlerts = await _db.Alerts
                .Where(a => a.RuleId == id && a.Status == "open")
                .ToListAsync();
            foreach (var a in openAlerts)
            {
                a.Status = "closed";
                a.ClosedAt = DateTime.UtcNow;
            }
        }

        await _db.SaveChangesAsync();
        _ = _notifier.SendRuleListChangedAsync("toggled", rule.StationId);
        return Ok(new { rule.Id, rule.Enabled });
    }
}

/// <summary>Request DTO cho tạo/cập nhật rule.</summary>
public class RuleRequest
{
    /// <summary>Tên rule hiển thị.</summary>
    public string? Name      { get; set; }
    /// <summary>Bộ rule (ví dụ: "Tủ 471").</summary>
    public string? RuleSet   { get; set; }
    /// <summary>Điều kiện kích hoạt dạng JSON: {"point","op","value","clearValue"}.</summary>
    public string? Condition { get; set; }
    /// <summary>Hành động khi kích hoạt dạng JSON array: [{"type","level","penalty"}].</summary>
    public string? Actions   { get; set; }
    /// <summary>Rule có được bật không.</summary>
    public bool?   Enabled   { get; set; }
    /// <summary>Trạm áp dụng rule.</summary>
    public Guid?   StationId { get; set; }
    /// <summary>Thiết bị áp dụng rule (null = toàn trạm).</summary>
    public Guid?   DeviceId  { get; set; }
}

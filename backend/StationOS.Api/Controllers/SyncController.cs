// ============================================================
// SyncController — Cloud Sync status
// GET /api/v1/sync/status   — Trạng thái đồng bộ cloud
// POST /api/v1/sync/trigger — Kích hoạt sync ngay lập tức (admin)
// ============================================================

using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using Microsoft.EntityFrameworkCore;
using StationOS.Data;
using StationOS.Services;
using StationOS.Api.Filters;

namespace StationOS.Api.Controllers;

[ApiController]
[Route("api/v1/sync")]
[Authorize]
public class SyncController : ControllerBase
{
    private readonly AppDbContext _db;
    private readonly SupabaseService _supabase;

    public SyncController(AppDbContext db, SupabaseService supabase)
    {
        _db = db;
        _supabase = supabase;
    }

    /// <summary>Lấy trạng thái đồng bộ dữ liệu lên cloud (Supabase).</summary>
    /// <returns>Thông tin: isConfigured, pendingCount, sentCount, failedCount, lastSyncAt.</returns>
    // GET /api/v1/sync/status
    [HttpGet("status")]
    public async Task<IActionResult> GetStatus(CancellationToken ct)
    {
        var pendingCount = await _db.SyncQueues.CountAsync(q => q.Status == "pending", ct);
        var sentCount    = await _db.SyncQueues.CountAsync(q => q.Status == "sent", ct);
        var failedCount  = await _db.SyncQueues.CountAsync(q => q.Status == "failed", ct);
        var lastSent     = await _db.SyncQueues
            .Where(q => q.SentAt != null)
            .OrderByDescending(q => q.SentAt)
            .Select(q => q.SentAt)
            .FirstOrDefaultAsync(ct);

        return Ok(new
        {
            isConfigured  = _supabase.IsConfigured,
            pendingCount,
            sentCount,
            failedCount,
            lastSyncAt    = lastSent,
            supabaseUrl   = _supabase.IsConfigured ? "https://nezuteiwukcheqpzitcn.supabase.co" : null
        });
    }

    /// <summary>Kích hoạt đồng bộ ngay lập tức — reset các item failed về pending. Chỉ admin.</summary>
    /// <returns>Thông báo số item đã reset.</returns>
    // POST /api/v1/sync/trigger — trigger sync ngay (reset retry count của failed items)
    [HttpPost("trigger")]
    [HasPermission("settings:manage")]
    public async Task<IActionResult> TriggerSync(CancellationToken ct)
    {
        // Reset failed items để retry lại
        var failed = await _db.SyncQueues
            .Where(q => q.Status == "failed")
            .ToListAsync(ct);

        foreach (var item in failed)
        {
            item.Status = "pending";
            item.RetryCount = 0;
        }

        // Đánh dấu pending items đã có là priority
        await _db.SaveChangesAsync(ct);

        return Ok(new { message = $"Đã reset {failed.Count} items failed, sync sẽ chạy trong vòng 5 phút" });
    }
}

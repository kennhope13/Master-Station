// ============================================================
// AuditMiddleware — Tự động ghi AuditLog cho mọi thao tác
// POST/PUT/DELETE /api/v1/** → ghi vào bảng AuditLogs
// Bỏ qua: GET, auth/login, auth/refresh, ws/*
// ============================================================

using System.Security.Claims;
using System.Text;
using StationOS.Data;
using StationOS.Data.Entities;
using StationOS.Services;

namespace StationOS.Api.Middleware;

public class AuditMiddleware
{
    private readonly RequestDelegate _next;

    public AuditMiddleware(RequestDelegate next) => _next = next;

    /// <summary>Xử lý request và tự động ghi AuditLog cho mọi thao tác thay đổi dữ liệu (POST/PUT/PATCH/DELETE) trên /api/v1/** sau khi response thành công.</summary>
    /// <param name="ctx">HttpContext của request hiện tại.</param>
    /// <param name="db">AppDbContext để ghi audit log vào database.</param>
    public async Task InvokeAsync(HttpContext ctx, AppDbContext db, IRealtimeNotifier notifier)
    {
        var method = ctx.Request.Method;
        var path   = ctx.Request.Path.Value ?? "";
        var requestBody = await ReadJsonRequestBodyAsync(ctx);

        await _next(ctx);

        // Chỉ ghi khi: là API call thay đổi dữ liệu, đã authen, thành công
        if (!IsWriteMethod(method)) return;
        if (!path.StartsWith("/api/v1/")) return;
        if (path.Contains("/auth/")) return;
        if (ctx.Response.StatusCode is < 200 or >= 300) return;
        if (ctx.User?.Identity?.IsAuthenticated != true) return;

        var userId    = ctx.User.FindFirstValue(ClaimTypes.NameIdentifier);
        var action    = method.ToLower() switch {
            "post"   => "create",
            "put"    => "update",
            "patch"  => "update",
            "delete" => "delete",
            _        => method.ToLower()
        };

        // Đặc biệt: ack / close alert
        if (path.Contains("/ack"))   action = "ack_alert";
        if (path.Contains("/close")) action = "close_alert";

        var entityType = ExtractEntityType(path);
        var entityId   = ExtractEntityId(path);

        try
        {
            var auditLog = new AuditLog
            {
                UserId     = Guid.TryParse(userId, out var uid) ? uid : null,
                Action     = action,
                EntityType = entityType,
                EntityId   = entityId,
                OldValue   = ctx.Items["AuditOldValue"] as string,
                NewValue   = (ctx.Items["AuditNewValue"] as string) ?? requestBody,
                IpAddress  = ctx.Connection.RemoteIpAddress?.ToString(),
            };
            db.AuditLogs.Add(auditLog);
            await db.SaveChangesAsync();
            await notifier.SendAuditLogListChangedAsync(action, auditLog.StationId ?? Guid.Empty);
        }
        catch
        {
            // Không để audit lỗi phá vỡ response
        }
    }

    private static bool IsWriteMethod(string method) =>
        method is "POST" or "PUT" or "PATCH" or "DELETE";

    private static string? ExtractEntityType(string path)
    {
        // /api/v1/devices/xxx → "device"
        // /api/v1/rules/xxx   → "rule"
        var segments = path.Split('/', StringSplitOptions.RemoveEmptyEntries);
        // segments: ["api", "v1", "devices", ...]
        return segments.Length >= 3 ? segments[2].TrimEnd('s') : null;
    }

    private static Guid? ExtractEntityId(string path)
    {
        var segments = path.Split('/', StringSplitOptions.RemoveEmptyEntries);
        // Ưu tiên GUID cuối cùng để hỗ trợ route lồng nhau như /sld/points/{id}
        for (var i = segments.Length - 1; i >= 0; i--)
        {
            if (Guid.TryParse(segments[i], out var id))
                return id;
        }

        return null;
    }

    private static async Task<string?> ReadJsonRequestBodyAsync(HttpContext ctx)
    {
        var method = ctx.Request.Method;
        var path   = ctx.Request.Path.Value ?? "";
        var contentType = ctx.Request.ContentType ?? "";

        if (!IsWriteMethod(method)) return null;
        if (!path.StartsWith("/api/v1/")) return null;
        if (path.Contains("/auth/")) return null;
        if (!contentType.Contains("application/json", StringComparison.OrdinalIgnoreCase)) return null;
        if (!ctx.Request.Body.CanRead) return null;

        ctx.Request.EnableBuffering();

        using var reader = new StreamReader(ctx.Request.Body, Encoding.UTF8, detectEncodingFromByteOrderMarks: false, leaveOpen: true);
        var body = await reader.ReadToEndAsync();
        ctx.Request.Body.Position = 0;

        return string.IsNullOrWhiteSpace(body) ? null : body;
    }
}

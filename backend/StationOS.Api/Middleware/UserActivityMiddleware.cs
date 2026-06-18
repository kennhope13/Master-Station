using System.Security.Claims;
using Microsoft.EntityFrameworkCore;
using Microsoft.AspNetCore.SignalR;
using StationOS.Data;

namespace StationOS.Api.Middleware;

public class UserActivityMiddleware
{
    private readonly RequestDelegate _next;
    private readonly Microsoft.AspNetCore.SignalR.IHubContext<Hubs.RealtimeHub> _hubContext;

    public UserActivityMiddleware(RequestDelegate next, Microsoft.AspNetCore.SignalR.IHubContext<Hubs.RealtimeHub> hubContext)
    {
        _next = next;
        _hubContext = hubContext;
    }

    public async Task InvokeAsync(HttpContext ctx, AppDbContext db)
    {
        await _next(ctx);

        if (ctx.User?.Identity?.IsAuthenticated == true)
        {
            var path = ctx.Request.Path.Value ?? "";
            if (path.StartsWith("/api/v1/"))
            {
                var userId = ctx.User.FindFirstValue(ClaimTypes.NameIdentifier);
                if (Guid.TryParse(userId, out var uid))
                {
                    try
                    {
                        var latestLog = await db.LoginLogs
                            .Where(l => l.UserId == uid && l.Action == "login")
                            .OrderByDescending(l => l.Ts)
                            .FirstOrDefaultAsync();

                        if (latestLog != null)
                        {
                            // Chỉ cập nhật nếu thời gian trôi qua hơn 60 giây (tránh spam ghi DB liên tục)
                            if ((DateTime.UtcNow - latestLog.Ts).TotalSeconds > 60)
                            {
                                latestLog.Ts = DateTime.UtcNow;
                                await db.SaveChangesAsync();
                                await _hubContext.Clients.All.SendAsync("UserStatusChange", new { username = ctx.User.Identity?.Name ?? "", status = "online", ts = DateTime.UtcNow });
                            }
                        }
                    }
                    catch
                    {
                        // Không làm ảnh hưởng luồng chính của ứng dụng
                    }
                }
            }
        }
    }
}

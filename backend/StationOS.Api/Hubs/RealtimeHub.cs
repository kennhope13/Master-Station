using Microsoft.AspNetCore.SignalR;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.DependencyInjection;
using System.Security.Claims;
using System.Collections.Concurrent;

namespace StationOS.Api.Hubs;

public class RealtimeHub : Hub
{
    private static readonly ConcurrentDictionary<string, int> _activeUsers = new();
    private readonly IServiceScopeFactory _scopeFactory;

    public RealtimeHub(IServiceScopeFactory scopeFactory)
    {
        _scopeFactory = scopeFactory;
    }

    /// <summary>
    /// Được gọi khi client kết nối tới WebSocket hub.
    /// </summary>
    public override async Task OnConnectedAsync()
    {
        await base.OnConnectedAsync();

        var username = Context.User?.Identity?.Name;
        var userIdStr = Context.User?.FindFirst(ClaimTypes.NameIdentifier)?.Value;

        if (!string.IsNullOrEmpty(username))
        {
            _activeUsers.AddOrUpdate(username, 1, (key, oldVal) => oldVal + 1);

            // Cập nhật database log
            if (Guid.TryParse(userIdStr, out var userId))
            {
                try
                {
                    using var scope = _scopeFactory.CreateScope();
                    var db = scope.ServiceProvider.GetRequiredService<StationOS.Data.AppDbContext>();
                    
                    var latestLog = await db.LoginLogs
                        .Where(l => l.UserId == userId && l.Action == "login")
                        .OrderByDescending(l => l.Ts)
                        .FirstOrDefaultAsync();

                    if (latestLog != null)
                    {
                        latestLog.Ts = DateTime.UtcNow;
                        await db.SaveChangesAsync();
                    }
                }
                catch
                {
                    // Tránh làm sập kết nối nếu lỗi DB
                }
            }

            // Gửi thông báo tới toàn bộ client
            await Clients.All.SendAsync("UserStatusChange", new { username, status = "online", ts = DateTime.UtcNow });
        }
    }

    /// <summary>
    /// Được gọi khi client ngắt kết nối khỏi WebSocket hub.
    /// </summary>
    public override async Task OnDisconnectedAsync(Exception? exception)
    {
        await base.OnDisconnectedAsync(exception);

        var username = Context.User?.Identity?.Name;
        var userIdStr = Context.User?.FindFirst(ClaimTypes.NameIdentifier)?.Value;

        if (!string.IsNullOrEmpty(username))
        {
            if (_activeUsers.TryGetValue(username, out var count))
            {
                if (count <= 1)
                {
                    _activeUsers.TryRemove(username, out _);

                    // Cập nhật database log để offline
                    if (Guid.TryParse(userIdStr, out var userId))
                    {
                        try
                        {
                            using var scope = _scopeFactory.CreateScope();
                            var db = scope.ServiceProvider.GetRequiredService<StationOS.Data.AppDbContext>();
                            
                            var latestLog = await db.LoginLogs
                                .Where(l => l.UserId == userId && l.Action == "login")
                                .OrderByDescending(l => l.Ts)
                                .FirstOrDefaultAsync();

                            if (latestLog != null)
                            {
                                latestLog.Ts = DateTime.UtcNow.AddMinutes(-30);
                                await db.SaveChangesAsync();
                            }
                        }
                        catch
                        {
                            // Tránh lỗi
                        }
                    }

                    // Gửi thông báo tới toàn bộ client
                    await Clients.All.SendAsync("UserStatusChange", new { username, status = "offline", ts = DateTime.UtcNow.AddMinutes(-30) });
                }
                else
                {
                    _activeUsers.TryUpdate(username, count - 1, count);
                }
            }
        }
    }
}

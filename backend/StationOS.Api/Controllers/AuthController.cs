// ============================================================
// AuthController — REST API xác thực người dùng
// Routes:
//   POST /api/v1/auth/login   — Đăng nhập → JWT (8h)
//   POST /api/v1/auth/refresh — Refresh token
//   GET  /api/v1/auth/me      — Thông tin user hiện tại (cần JWT)
// ============================================================

using System.Security.Claims;
using System.Security.Cryptography;
using System.Text;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using Microsoft.AspNetCore.RateLimiting;
using Microsoft.EntityFrameworkCore;
using StationOS.Data;
using StationOS.Data.Entities;
using StationOS.Services;
using StationOS.Services.Auth;
using StationOS.Services.Security;

namespace StationOS.Api.Controllers;

[ApiController]
[Route("api/v1/auth")]
public class AuthController : ControllerBase
{
    private readonly AuthService _auth;
    private readonly AppDbContext _db;
    private readonly LicenseService _license;
    private readonly InternalAuthService _internalAuth;

    public AuthController(AuthService auth, AppDbContext db, LicenseService license, InternalAuthService internalAuth)
    {
        _auth    = auth;
        _db      = db;
        _license = license;
        _internalAuth = internalAuth;
    }

    /// <summary>
    /// Đăng nhập bằng username/password
    /// Trả về: JWT token (8h), refresh token, thông tin user
    /// Lỗi 401: sai thông tin hoặc tài khoản bị khóa
    /// </summary>
    [HttpPost("login")]
    [EnableRateLimiting("login")]  // 5 attempts/min/IP — chống brute force
    public async Task<IActionResult> Login([FromBody] LoginRequest req)
    {
        var result = await _auth.LoginAsync(req.Username, req.Password);
        if (result == null)
            return Unauthorized(new { message = "Tên đăng nhập hoặc mật khẩu không đúng" });

        var (token, refreshToken, user) = result.Value;

        // Kiểm tra license: giới hạn concurrent users
        var tokenHash  = Convert.ToHexString(SHA256.HashData(Encoding.UTF8.GetBytes(token)));
        var jwtExpiry  = DateTime.UtcNow.AddDays(3650);
        var (allowed, reason) = await _license.TryAcquireSessionAsync(
            tokenHash, jwtExpiry, user.Username, user.Role);
        if (!allowed)
            return StatusCode(403, new { message = "Đã đạt giới hạn người dùng đồng thời. Vui lòng liên hệ quản trị viên hoặc nâng cấp license." });

        // Lưu refresh token vào SystemSettings (đơn giản, không cần bảng riêng)
        await SaveRefreshTokenAsync(user.Id, refreshToken);

        return Ok(new
        {
            token,
            refreshToken,
            licenseReason = reason, // "no_license" | "expired" | ""
            mustChangePassword = user.MustChangePassword, // FE chuyển sang trang đổi password
            user = new
            {
                id = user.Id,
                username = user.Username,
                fullName = user.FullName,
                role = user.Role,
                email = user.Email
            }
        });
    }

    /// <summary>
    /// Đổi password user hiện tại.
    /// Body: { oldPassword, newPassword }
    /// </summary>
    [HttpPost("change-password")]
    [Authorize]
    public async Task<IActionResult> ChangePassword([FromBody] SelfChangePasswordRequest req)
    {
        var userIdClaim = User.FindFirst(ClaimTypes.NameIdentifier)?.Value;
        if (!Guid.TryParse(userIdClaim, out var userId))
            return Unauthorized();

        var (ok, error) = await _auth.ChangePasswordAsync(userId, req.OldPassword, req.NewPassword);
        if (!ok) return BadRequest(new { message = error });
        return Ok(new { message = "Đổi mật khẩu thành công" });
    }

    /// <summary>
    /// Refresh JWT token bằng refresh token
    /// Nhận: { refreshToken: string }
    /// Trả về: JWT mới + refresh token mới
    /// </summary>
    [HttpPost("refresh")]
    public async Task<IActionResult> Refresh([FromBody] RefreshRequest req)
    {
        if (string.IsNullOrEmpty(req.RefreshToken))
            return BadRequest(new { message = "Thiếu refresh token" });

        // Tìm user có refresh token này trong SystemSettings (key: refresh_token_{userId})
        var settings = await _db.SystemSettings
            .Where(s => s.Key.StartsWith("refresh_token_"))
            .ToListAsync();

        // Unwrap JSON value
        static string UnwrapJson(string val)
        {
            if (val.StartsWith("\"") && val.EndsWith("\"") && val.Length >= 2)
                return val[1..^1];
            return val;
        }

        var match = settings.FirstOrDefault(s => UnwrapJson(s.Value) == req.RefreshToken);
        if (match == null)
            return Unauthorized(new { message = "Refresh token không hợp lệ hoặc đã hết hạn" });

        var user = await _db.Users.FindAsync(match.UpdatedBy);
        if (user == null || !user.IsActive)
            return Unauthorized(new { message = "Tài khoản không tồn tại hoặc bị vô hiệu hóa" });

        // Issue new tokens
        var newToken = _auth.GenerateJwt(user);
        var newRefreshToken = AuthService.GenerateRefreshToken();
        await SaveRefreshTokenAsync(user.Id, newRefreshToken);

        return Ok(new
        {
            token = newToken,
            refreshToken = newRefreshToken,
            user = new
            {
                id = user.Id,
                username = user.Username,
                fullName = user.FullName,
                role = user.Role,
                email = user.Email
            }
        });
    }

    [HttpPost("internal-token")]
    [AllowAnonymous]
    public async Task<IActionResult> InternalToken()
    {
        if (!_internalAuth.IsAuthorized(HttpContext))
            return Unauthorized(new { message = "Internal auth failed" });

        var username = "stationadmin";
        var user = await _db.Users.FirstOrDefaultAsync(u => u.Username == username && u.IsActive)
                   ?? await _db.Users.FirstOrDefaultAsync(u => u.Username == "admin" && u.IsActive);
        if (user == null)
            return NotFound(new { message = "Không tìm thấy tài khoản nội bộ để cấp token" });

        var token = _auth.GenerateJwt(user, TimeSpan.FromDays(3650));
        return Ok(new
        {
            token,
            user = new
            {
                id = user.Id,
                username = user.Username,
                role = user.Role
            }
        });
    }

    /// <summary>
    /// Lấy thông tin user hiện tại từ JWT token
    /// Yêu cầu: Header Authorization: Bearer {token}
    /// </summary>
    [Authorize]
    [HttpGet("me")]
    public async Task<IActionResult> Me()
    {
        var userId = User.FindFirstValue(ClaimTypes.NameIdentifier);
        var username = User.FindFirstValue(ClaimTypes.Name);
        var role = User.FindFirstValue(ClaimTypes.Role);
        var fullName = User.FindFirstValue("fullName");

        if (Guid.TryParse(userId, out var uid))
        {
            var latestLog = await _db.LoginLogs
                .Where(l => l.UserId == uid && l.Action == "login")
                .OrderByDescending(l => l.Ts)
                .FirstOrDefaultAsync();

            if (latestLog != null)
            {
                latestLog.Ts = DateTime.UtcNow;
                await _db.SaveChangesAsync();
            }
        }

        return Ok(new { userId, username, role, fullName });
    }

    // ── Helpers ──────────────────────────────────────────────
    private async Task SaveRefreshTokenAsync(Guid userId, string token)
    {
        // Lưu refresh token trong SystemSettings với key riêng mỗi user
        // Dùng station ID thật để không vi phạm FK constraint
        var station = await _db.Stations.FirstOrDefaultAsync();
        if (station == null) return; // Chưa có station — bỏ qua

        var key = $"refresh_token_{userId}";
        var jsonValue = System.Text.Json.JsonSerializer.Serialize(token);

        var existing = await _db.SystemSettings
            .FirstOrDefaultAsync(s => s.StationId == station.Id && s.Key == key);

        if (existing == null)
        {
            _db.SystemSettings.Add(new SystemSettings
            {
                StationId = station.Id,
                Key       = key,
                Value     = jsonValue,
                UpdatedBy = userId,
                UpdatedAt = DateTime.UtcNow
            });
        }
        else
        {
            existing.Value     = jsonValue;
            existing.UpdatedBy = userId;
            existing.UpdatedAt = DateTime.UtcNow;
        }

        await _db.SaveChangesAsync();
    }
}

// ── Request Models ────────────────────────────────────────
public record LoginRequest(string Username, string Password);
public record RefreshRequest(string RefreshToken);
public record SelfChangePasswordRequest(string OldPassword, string NewPassword);

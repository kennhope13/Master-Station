// ============================================================
// AuthService — Xử lý đăng nhập và tạo JWT token
// Dùng: BCrypt để hash/verify password
//        System.IdentityModel.Tokens.Jwt để tạo token
// Ghi: LoginLog mỗi lần đăng nhập thành công
// ============================================================

using System.IdentityModel.Tokens.Jwt;
using System.Security.Claims;
using System.Security.Cryptography;
using System.Text;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Configuration;
using Microsoft.IdentityModel.Tokens;
using StationOS.Data;
using StationOS.Data.Entities;
using StationOS.Services.Security;

namespace StationOS.Services.Auth;

public class AuthService
{
    private readonly AppDbContext _db;
    private readonly IConfiguration _config;
    private readonly CredentialEncryptionService _crypto;

    public AuthService(AppDbContext db, IConfiguration config, CredentialEncryptionService crypto)
    {
        _db = db;
        _config = config;
        _crypto = crypto;
    }

    /// <summary>
    /// Đăng nhập: kiểm tra username/password → trả JWT + refreshToken
    /// Trả null nếu sai thông tin hoặc tài khoản bị vô hiệu
    /// </summary>
    public async Task<(string token, string refreshToken, User user)?> LoginAsync(string username, string password)
    {
        username = UsernameNormalizer.Normalize(username);

        // Tìm user active trong DB
        var user = await _db.Users
            .FirstOrDefaultAsync(u => u.Username == username && u.IsActive);

        // BCrypt.Verify so sánh password nhập với hash trong DB
        if (user == null || !BCrypt.Net.BCrypt.Verify(password, user.PasswordHash))
            return null;

        var token = GenerateJwt(user);
        var refreshToken = GenerateRefreshToken();

        // Update last login timestamp
        user.LastLoginAt = DateTime.UtcNow;

        // Ghi log đăng nhập vào bảng LoginLogs
        _db.LoginLogs.Add(new LoginLog
        {
            UserId = user.Id,
            Username = user.Username,
            Action = "login"
        });
        await _db.SaveChangesAsync();

        return (token, refreshToken, user);
    }

    /// <summary>
    /// Đổi password user — verify password cũ + set hash mới + clear MustChangePassword.
    /// Validate password mạnh (tối thiểu 12 ký tự, có HOA, thường, số, ký tự đặc biệt).
    /// </summary>
    public async Task<(bool ok, string? error)> ChangePasswordAsync(Guid userId, string oldPassword, string newPassword)
    {
        var user = await _db.Users.FirstOrDefaultAsync(u => u.Id == userId);
        if (user == null) return (false, "Không tìm thấy người dùng");

        if (!BCrypt.Net.BCrypt.Verify(oldPassword, user.PasswordHash))
            return (false, "Mật khẩu cũ không chính xác");

        // Validate strength - Cấp độ sản xuất (min 12 ký tự, HOA, thường, số, ký tự đặc biệt)
        if (newPassword.Length < 12)
            return (false, "Mật khẩu mới phải có độ dài tối thiểu 12 ký tự");
        if (!newPassword.Any(char.IsUpper))
            return (false, "Mật khẩu mới phải chứa ít nhất 1 chữ cái viết HOA");
        if (!newPassword.Any(char.IsLower))
            return (false, "Mật khẩu mới phải chứa ít nhất 1 chữ cái viết thường");
        if (!newPassword.Any(char.IsDigit))
            return (false, "Mật khẩu mới phải chứa ít nhất 1 chữ số");
        if (!newPassword.Any(c => !char.IsLetterOrDigit(c)))
            return (false, "Mật khẩu mới phải chứa ít nhất 1 ký tự đặc biệt (ví dụ: @, #, $, ...)");
        if (newPassword == oldPassword)
            return (false, "Mật khẩu mới không được trùng với mật khẩu cũ");

        user.PasswordHash = BCrypt.Net.BCrypt.HashPassword(newPassword, workFactor: 12);
        user.ProvisionedPassword = null;
        user.MustChangePassword = false;
        user.LastPasswordChangedAt = DateTime.UtcNow;
        await _db.SaveChangesAsync();
        return (true, null);
    }

    /// <summary>
    /// Tạo JWT token chứa: userId, username, role, fullName
    /// Hết hạn sau ExpiryMinutes phút (config trong appsettings.json)
    /// </summary>
    public string GenerateJwt(User user, TimeSpan? lifetime = null)
    {
        var key = new SymmetricSecurityKey(
            Encoding.UTF8.GetBytes(_config["Jwt:Key"]!));
        var creds = new SigningCredentials(key, SecurityAlgorithms.HmacSha256);

        var claims = new List<Claim>
        {
            new Claim(ClaimTypes.NameIdentifier, user.Id.ToString()),
            new Claim(ClaimTypes.Name, user.Username),
            new Claim(ClaimTypes.Role, user.Role),
            new Claim("fullName", user.FullName ?? user.Username),
        };

        var isRestricted = (user.StationIds != null && user.StationIds.Length > 0) || 
                           (user.ProvinceIds != null && user.ProvinceIds.Length > 0);

        if (isRestricted)
        {
            claims.Add(new Claim("isRestricted", "true"));
        }

        if (user.StationIds != null && user.StationIds.Length > 0)
        {
            claims.Add(new Claim("stationIds", string.Join(",", user.StationIds)));
        }

        if (user.ProvinceIds != null && user.ProvinceIds.Length > 0)
        {
            claims.Add(new Claim("provinceIds", string.Join(",", user.ProvinceIds)));
        }

        if (user.TeamId != null)
        {
            claims.Add(new Claim("teamId", user.TeamId.ToString()!));
        }

        var permissionsSet = new HashSet<string>();
        if (user.Permissions != null)
        {
            foreach (var p in user.Permissions) permissionsSet.Add(p);
        }
        var defaultPermissions = PermissionService.GetDefaultPermissionsForRole(user.Role);
        foreach (var p in defaultPermissions) permissionsSet.Add(p);

        if (permissionsSet.Count > 0)
        {
            claims.Add(new Claim("permissions", string.Join(",", permissionsSet)));
        }

        var token = new JwtSecurityToken(
            issuer: _config["Jwt:Issuer"],
            audience: _config["Jwt:Audience"],
            claims: claims,
            expires: DateTime.UtcNow.Add(lifetime ?? TimeSpan.FromMinutes(
                int.Parse(_config["Jwt:ExpiryMinutes"]!))),
            signingCredentials: creds);

        return new JwtSecurityTokenHandler().WriteToken(token);
    }

    /// <summary>
    /// Tạo refresh token ngẫu nhiên 64 bytes (base64)
    /// TODO: lưu vào DB để validate khi refresh
    /// </summary>
    public static string GenerateRefreshToken()
    {
        var bytes = RandomNumberGenerator.GetBytes(64);
        return Convert.ToBase64String(bytes);
    }

    /// <summary>
    /// Seed tài khoản admin mặc định nếu bảng Users còn trống
    /// Chạy 1 lần khi khởi động lần đầu
    /// Tài khoản: admin / Admin@123
    /// </summary>
    public async Task SeedAdminIfNotExistsAsync()
    {
        await NormalizeExistingUsernamesAsync();

        // 0. Seed Provinces if none exist
        if (!await _db.Provinces.AnyAsync())
        {
            var pTayNinh = new Province { Id = Guid.NewGuid(), Name = "Tỉnh Tây Ninh", Code = "TN", Status = "active" };
            var pCanTho = new Province { Id = Guid.NewGuid(), Name = "Thành phố Cần Thơ", Code = "CT", Status = "active" };
            var pLongAn = new Province { Id = Guid.NewGuid(), Name = "Tỉnh Long An", Code = "LA", Status = "active" };
            var pVinhLong = new Province { Id = Guid.NewGuid(), Name = "Tỉnh Vĩnh Long", Code = "VL", Status = "active" };

            _db.Provinces.AddRange(pTayNinh, pCanTho, pLongAn, pVinhLong);
            await _db.SaveChangesAsync();
        }

        await SyncStationProvinceAssignmentsAsync();

        // 1. Upsert admin (Trạm con) - Only if not Central
        var connStr = _config.GetConnectionString("Default") ?? "";
        bool isCentral = connStr.Contains("Central", StringComparison.OrdinalIgnoreCase);
        if (isCentral)
        {
            var existingAdmin = await _db.Users.FirstOrDefaultAsync(u => u.Username == "admin");
            if (existingAdmin != null)
            {
                _db.Users.Remove(existingAdmin);
                await _db.SaveChangesAsync();
            }
        }
        else
        {
            var admin = await _db.Users.FirstOrDefaultAsync(u => u.Username == "admin");
            if (admin == null)
            {
                admin = new User { Username = "admin", Role = "admin" };
                _db.Users.Add(admin);
            }
            admin.PasswordHash = BCrypt.Net.BCrypt.HashPassword("Admin@123", workFactor: 12);
            admin.FullName = "Quản trị viên Trạm con";
            admin.Email = "admin@StationOS.vn";
            admin.IsActive = true;
            admin.MustChangePassword = false;
        }

        // 2. Upsert multi (Đa trạm)
        var multi = await _db.Users.FirstOrDefaultAsync(u => u.Username == "multi");
        if (multi == null)
        {
            multi = new User { Username = "multi", Role = "admin" };
            _db.Users.Add(multi);
        }
        multi.PasswordHash = BCrypt.Net.BCrypt.HashPassword("Demo@2024", workFactor: 12);
        multi.FullName = "Quản trị viên Đa trạm";
        multi.Email = "multi@StationOS.vn";
        multi.IsActive = true;
        multi.MustChangePassword = false;

        // 4. Upsert station admin (Admin Trạm)
        var stationAdmin = await _db.Users.FirstOrDefaultAsync(u => u.Username == "stationadmin");
        if (stationAdmin == null)
        {
            stationAdmin = new User { Username = "stationadmin", Role = "admin_station" };
            _db.Users.Add(stationAdmin);
        }
        stationAdmin.PasswordHash = BCrypt.Net.BCrypt.HashPassword("Station@123", workFactor: 12);
        stationAdmin.FullName = "Quản trị viên Trạm";
        stationAdmin.Email = "stationadmin@StationOS.vn";
        stationAdmin.IsActive = true;
        stationAdmin.MustChangePassword = false;
        // Assign a sample station if exists
        var sampleStation = await _db.Stations.FirstOrDefaultAsync();
        stationAdmin.StationIds = sampleStation != null ? new[] { sampleStation.Id } : null;

        // 5. Remove redundant local accounts (manager, operator, provinceadmin) to keep seed clean
        var existingManager = await _db.Users.FirstOrDefaultAsync(u => u.Username == "manager");
        if (existingManager != null) _db.Users.Remove(existingManager);
        var existingOperator = await _db.Users.FirstOrDefaultAsync(u => u.Username == "operator");
        if (existingOperator != null) _db.Users.Remove(existingOperator);
        var existingProvinceAdmin = await _db.Users.FirstOrDefaultAsync(u => u.Username == "provinceadmin");
        if (existingProvinceAdmin != null) _db.Users.Remove(existingProvinceAdmin);

        // 7. Remove redundant account (operatorprovince) if it exists
        var existingOpProv = await _db.Users.FirstOrDefaultAsync(u => u.Username == "operatorprovince");
        if (existingOpProv != null) _db.Users.Remove(existingOpProv);

        // 8. Remove redundant account (teamleader) if it exists
        var existingTeamLeader = await _db.Users.FirstOrDefaultAsync(u => u.Username == "teamleader");
        if (existingTeamLeader != null) _db.Users.Remove(existingTeamLeader);

        // 9. Remove redundant account (teammember) if it exists
        var existingTeamMember = await _db.Users.FirstOrDefaultAsync(u => u.Username == "teammember");
        if (existingTeamMember != null) _db.Users.Remove(existingTeamMember);

        await _db.SaveChangesAsync();
    }

    private async Task NormalizeExistingUsernamesAsync()
    {
        var users = await _db.Users.OrderBy(u => u.CreatedAt).ToListAsync();
        if (users.Count == 0) return;

        var reserved = new HashSet<string>(StringComparer.OrdinalIgnoreCase);
        var changed = false;

        foreach (var user in users)
        {
            var normalized = UsernameNormalizer.Normalize(user.Username);
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
            if (!string.Equals(user.Username, candidate, StringComparison.Ordinal))
            {
                user.Username = candidate;
                changed = true;
            }
        }

        if (changed)
            await _db.SaveChangesAsync();
    }

    private async Task SyncStationProvinceAssignmentsAsync()
    {
        static IEnumerable<string> BuildProvinceAliases(Province province)
        {
            var aliases = new HashSet<string>(StringComparer.OrdinalIgnoreCase);

            if (!string.IsNullOrWhiteSpace(province.Name))
            {
                aliases.Add(province.Name.Trim());

                var normalized = province.Name
                    .Replace("Tỉnh ", "", StringComparison.OrdinalIgnoreCase)
                    .Replace("Thành phố ", "", StringComparison.OrdinalIgnoreCase)
                    .Replace("TP. ", "", StringComparison.OrdinalIgnoreCase)
                    .Trim();

                if (!string.IsNullOrWhiteSpace(normalized))
                    aliases.Add(normalized);
            }

            if (!string.IsNullOrWhiteSpace(province.Code))
                aliases.Add(province.Code.Trim());

            return aliases;
        }

        var provinces = await _db.Provinces.AsNoTracking().ToListAsync();
        if (provinces.Count == 0) return;

        var provinceAliases = provinces
            .Select(p => new
            {
                Province = p,
                Aliases = BuildProvinceAliases(p)
                    .OrderByDescending(a => a.Length)
                    .ToArray()
            })
            .ToList();

        var stations = await _db.Stations.ToListAsync();
        var changed = false;

        foreach (var station in stations)
        {
            // Only match against name and address text — NOT the raw location JSON
            // (the JSON contains field names like "lat" which would falsely match "LA")
            string address = "";
            if (!string.IsNullOrWhiteSpace(station.Location))
            {
                try
                {
                    using var doc = System.Text.Json.JsonDocument.Parse(station.Location);
                    if (doc.RootElement.TryGetProperty("address", out var ap))
                        address = ap.GetString() ?? "";
                }
                catch { }
            }

            // Province determined by map coordinates/address only — not station name
            // Match against full official name only ("Tỉnh X", "Thành phố X") to avoid
            // false matches from ward/district names (e.g., "Phường Long An" ≠ tỉnh Long An)
            var haystack = address.ToLowerInvariant();
            if (string.IsNullOrWhiteSpace(haystack)) continue;

            var matchedProvince = provinceAliases.FirstOrDefault(x =>
                !string.IsNullOrWhiteSpace(x.Province.Name) &&
                haystack.Contains(x.Province.Name.Trim().ToLowerInvariant())
            )?.Province;

            if (matchedProvince != null && station.ProvinceId != matchedProvince.Id)
            {
                station.ProvinceId = matchedProvince.Id;
                changed = true;
            }
        }

        if (changed)
            await _db.SaveChangesAsync();
    }
}

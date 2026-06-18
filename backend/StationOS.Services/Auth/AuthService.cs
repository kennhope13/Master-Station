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

namespace StationOS.Services.Auth;

public class AuthService
{
    private readonly AppDbContext _db;
    private readonly IConfiguration _config;

    public AuthService(AppDbContext db, IConfiguration config)
    {
        _db = db;
        _config = config;
    }

    /// <summary>
    /// Đăng nhập: kiểm tra username/password → trả JWT + refreshToken
    /// Trả null nếu sai thông tin hoặc tài khoản bị vô hiệu
    /// </summary>
    public async Task<(string token, string refreshToken, User user)?> LoginAsync(string username, string password)
    {
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
        user.MustChangePassword = false;
        user.LastPasswordChangedAt = DateTime.UtcNow;
        await _db.SaveChangesAsync();
        return (true, null);
    }

    /// <summary>
    /// Tạo JWT token chứa: userId, username, role, fullName
    /// Hết hạn sau ExpiryMinutes phút (config trong appsettings.json)
    /// </summary>
    public string GenerateJwt(User user)
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
            expires: DateTime.UtcNow.AddMinutes(
                int.Parse(_config["Jwt:ExpiryMinutes"]!)),
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
        // 0. Seed Provinces if none exist
        if (!await _db.Provinces.AnyAsync())
        {
            var pTayNinh = new Province { Id = Guid.NewGuid(), Name = "Tỉnh Tây Ninh", Code = "TN", Status = "active" };
            var pCanTho = new Province { Id = Guid.NewGuid(), Name = "Thành phố Cần Thơ", Code = "CT", Status = "active" };
            var pLongAn = new Province { Id = Guid.NewGuid(), Name = "Tỉnh Long An", Code = "LA", Status = "active" };
            var pVinhLong = new Province { Id = Guid.NewGuid(), Name = "Tỉnh Vĩnh Long", Code = "VL", Status = "active" };

            _db.Provinces.AddRange(pTayNinh, pCanTho, pLongAn, pVinhLong);
            await _db.SaveChangesAsync();

            // Link existing stations to provinces
            var stations = await _db.Stations.ToListAsync();
            foreach (var s in stations)
            {
                if (s.Name.Contains("An Thạnh")) s.ProvinceId = pTayNinh.Id;
                else if (s.Name.Contains("Cái Răng")) s.ProvinceId = pCanTho.Id;
                else if (s.Name.Contains("Tân Trụ") || s.Name.Contains("Tân An")) s.ProvinceId = pLongAn.Id;
                else if (s.Name.Contains("Trà Ôn")) s.ProvinceId = pVinhLong.Id;
                else s.ProvinceId = pTayNinh.Id; // default fallback
            }
            await _db.SaveChangesAsync();
        }

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

        // 3. Upsert province admin (Admin Tỉnh)
        var provinceAdmin = await _db.Users.FirstOrDefaultAsync(u => u.Username == "provinceadmin");
        if (provinceAdmin == null)
        {
            provinceAdmin = new User { Username = "provinceadmin", Role = "admin_province" };
            _db.Users.Add(provinceAdmin);
        }
        provinceAdmin.PasswordHash = BCrypt.Net.BCrypt.HashPassword("Province@123", workFactor: 12);
        provinceAdmin.FullName = "Quản trị viên Tỉnh";
        provinceAdmin.Email = "provinceadmin@StationOS.vn";
        provinceAdmin.IsActive = true;
        provinceAdmin.MustChangePassword = false;
        // Assign Tây Ninh and Long An provinces for demo
        var tnProvince = await _db.Provinces.FirstOrDefaultAsync(p => p.Code == "TN");
        var laProvince = await _db.Provinces.FirstOrDefaultAsync(p => p.Code == "LA");
        var provIds = new List<Guid>();
        if (tnProvince != null) provIds.Add(tnProvince.Id);
        if (laProvince != null) provIds.Add(laProvince.Id);

        if (provIds.Count > 0)
        {
            provinceAdmin.ProvinceIds = provIds.ToArray();
        }
        else
        {
            provinceAdmin.ProvinceIds = await _db.Provinces.Select(p => p.Id).ToArrayAsync();
        }

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

        // 5. Upsert manager (Quản lý)
        var manager = await _db.Users.FirstOrDefaultAsync(u => u.Username == "manager");
        if (manager == null)
        {
            manager = new User { Username = "manager", Role = "manager" };
            _db.Users.Add(manager);
        }
        manager.PasswordHash = BCrypt.Net.BCrypt.HashPassword("Manager@123", workFactor: 12);
        manager.FullName = "Quản lý hệ thống";
        manager.Email = "manager@StationOS.vn";
        manager.IsActive = true;
        manager.MustChangePassword = false;
        // Manager may have broad station access – assign null (unrestricted)
        manager.StationIds = null;

        // 6. Upsert operator (Nhân viên)
        var operatorUser = await _db.Users.FirstOrDefaultAsync(u => u.Username == "operator");
        if (operatorUser == null)
        {
            operatorUser = new User { Username = "operator", Role = "operator" };
            _db.Users.Add(operatorUser);
        }
        operatorUser.PasswordHash = BCrypt.Net.BCrypt.HashPassword("Operator@123", workFactor: 12);
        operatorUser.FullName = "Nhân viên vận hành";
        operatorUser.Email = "operator@StationOS.vn";
        operatorUser.IsActive = true;
        operatorUser.MustChangePassword = false;
        // Operator may be limited to specific stations – assign null (no restriction)
        operatorUser.StationIds = null;

        // 7. Seed default Teams and Team-based users
        var laProv = await _db.Provinces.FirstOrDefaultAsync(p => p.Code == "LA");
        var tnProv = await _db.Provinces.FirstOrDefaultAsync(p => p.Code == "TN");

        var team1 = await _db.Teams.FirstOrDefaultAsync(t => t.Name == "Tổ thao tác lưu động 1");
        if (team1 == null)
        {
            team1 = new Team { Name = "Tổ thao tác lưu động 1" };
            _db.Teams.Add(team1);
        }
        team1.ProvinceId = laProv?.Id;
        var allStationIds = await _db.Stations.Select(s => s.Id).ToArrayAsync();
        team1.StationIds = allStationIds;

        var team2 = await _db.Teams.FirstOrDefaultAsync(t => t.Name == "Tổ thao tác lưu động 2");
        if (team2 == null)
        {
            team2 = new Team { Name = "Tổ thao tác lưu động 2" };
            _db.Teams.Add(team2);
        }
        team2.ProvinceId = tnProv?.Id;
        team2.StationIds = allStationIds.Take(2).ToArray();

        // Save changes first to get Team IDs
        await _db.SaveChangesAsync();

        // 8. Upsert Operator Province
        var operatorProv = await _db.Users.FirstOrDefaultAsync(u => u.Username == "operatorprovince");
        if (operatorProv == null)
        {
            operatorProv = new User { Username = "operatorprovince", Role = "operator_province" };
            _db.Users.Add(operatorProv);
        }
        operatorProv.PasswordHash = BCrypt.Net.BCrypt.HashPassword("OperatorProvince@123", workFactor: 12);
        operatorProv.FullName = "Nhân viên PC Tỉnh";
        operatorProv.Email = "operatorprovince@StationOS.vn";
        operatorProv.IsActive = true;
        operatorProv.MustChangePassword = false;
        operatorProv.ProvinceIds = await _db.Provinces.Select(p => p.Id).ToArrayAsync();

        // 9. Upsert Team Leader
        var teamLeader = await _db.Users.FirstOrDefaultAsync(u => u.Username == "teamleader");
        if (teamLeader == null)
        {
            teamLeader = new User { Username = "teamleader", Role = "team_leader" };
            _db.Users.Add(teamLeader);
        }
        teamLeader.PasswordHash = BCrypt.Net.BCrypt.HashPassword("TeamLeader@123", workFactor: 12);
        teamLeader.FullName = "Tổ trưởng Tổ 1";
        teamLeader.Email = "teamleader@StationOS.vn";
        teamLeader.IsActive = true;
        teamLeader.MustChangePassword = false;
        teamLeader.TeamId = team1.Id;

        // 10. Upsert Team Member
        var teamMember = await _db.Users.FirstOrDefaultAsync(u => u.Username == "teammember");
        if (teamMember == null)
        {
            teamMember = new User { Username = "teammember", Role = "team_member" };
            _db.Users.Add(teamMember);
        }
        teamMember.PasswordHash = BCrypt.Net.BCrypt.HashPassword("TeamMember@123", workFactor: 12);
        teamMember.FullName = "Nhân viên Tổ 1";
        teamMember.Email = "teammember@StationOS.vn";
        teamMember.IsActive = true;
        teamMember.MustChangePassword = false;
        teamMember.TeamId = team1.Id;

        await _db.SaveChangesAsync();
    }
}

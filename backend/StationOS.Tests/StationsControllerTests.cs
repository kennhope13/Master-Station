using System.Security.Claims;
using Microsoft.AspNetCore.Http;
using Microsoft.AspNetCore.Mvc;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Configuration;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.Logging;
using Moq;
using StationOS.Api.Controllers;
using StationOS.Data;
using StationOS.Data.Entities;
using StationOS.Services;
using StationOS.Services.Security;

namespace StationOS.Tests;

public class StationsControllerTests
{
    private static AppDbContext CreateInMemoryDb()
    {
        var opts = new DbContextOptionsBuilder<AppDbContext>()
            .UseInMemoryDatabase(Guid.NewGuid().ToString())
            .Options;
        return new AppDbContext(opts);
    }

    private static StationsController CreateController(AppDbContext db, User actingUser)
    {
        var claims = new List<Claim>
        {
            new Claim(ClaimTypes.NameIdentifier, actingUser.Id.ToString()),
            new Claim(ClaimTypes.Name, actingUser.Username),
            new Claim(ClaimTypes.Role, actingUser.Role)
        };

        if (actingUser.TeamId.HasValue)
            claims.Add(new Claim("teamId", actingUser.TeamId.Value.ToString()));

        var httpContext = new DefaultHttpContext
        {
            User = new ClaimsPrincipal(new ClaimsIdentity(claims, "TestAuth"))
        };

        var httpAccessor = new HttpContextAccessor { HttpContext = httpContext };
        var permissionService = new PermissionService(httpAccessor, db);

        var mockHttpClientFactory = new Mock<IHttpClientFactory>();
        var mockConfig = new Mock<IConfiguration>();
        var mockSection = new Mock<IConfigurationSection>();
        mockSection.Setup(s => s.Value).Returns("true");
        mockConfig.Setup(c => c.GetSection("AppFeatures:AllowStationCreation")).Returns(mockSection.Object);
        var mockCryptoLogger = new Mock<ILogger<CredentialEncryptionService>>();
        var mockNotifier = new Mock<IRealtimeNotifier>();
        var mockControllerLogger = new Mock<ILogger<StationsController>>();

        var testKeyBytes = System.Security.Cryptography.SHA256.HashData(System.Text.Encoding.UTF8.GetBytes("TEST_KEY"));
        Environment.SetEnvironmentVariable("STATIONOS_ENCRYPTION_KEY", Convert.ToBase64String(testKeyBytes));
        Environment.SetEnvironmentVariable("STATIONOS_VENDOR_SECRET", Convert.ToBase64String(testKeyBytes));

        var crypto = new CredentialEncryptionService(mockConfig.Object, mockCryptoLogger.Object);
        var internalAuth = new InternalAuthService(mockConfig.Object);

        var serviceProvider = new Microsoft.Extensions.DependencyInjection.ServiceCollection()
            .AddSingleton(db)
            .BuildServiceProvider();

        var mockScope = new Mock<Microsoft.Extensions.DependencyInjection.IServiceScope>();
        mockScope.Setup(s => s.ServiceProvider).Returns(serviceProvider);

        var mockScopeFactory = new Mock<Microsoft.Extensions.DependencyInjection.IServiceScopeFactory>();
        mockScopeFactory.Setup(f => f.CreateScope()).Returns(mockScope.Object);

        var licenseService = new LicenseService(mockScopeFactory.Object, mockConfig.Object);

        return new StationsController(
            db,
            permissionService,
            mockHttpClientFactory.Object,
            crypto,
            internalAuth,
            mockNotifier.Object,
            mockControllerLogger.Object,
            licenseService,
            mockConfig.Object);
    }

    [Fact]
    public async Task Create_WhenProvinceHasNoAdminProvince_ShouldAutoCreateProvinceAdmin()
    {
        using var db = CreateInMemoryDb();

        var admin = new User
        {
            Id = Guid.NewGuid(),
            Username = "multi",
            PasswordHash = BCrypt.Net.BCrypt.HashPassword("Demo@2024"),
            Role = "admin",
            IsActive = true
        };
        var province = new Province
        {
            Id = Guid.NewGuid(),
            Name = "Tỉnh Vĩnh Long",
            Code = "VL",
            Status = "active"
        };

        db.Users.Add(admin);
        db.Provinces.Add(province);
        await db.SaveChangesAsync();

        var controller = CreateController(db, admin);
        var request = new StationRequest(
            Name: "Trạm Vĩnh Long 01",
            Code: "VL01",
            Location: """{"lat":10.253,"lng":105.972,"address":"Phường 1, Tỉnh Vĩnh Long"}""",
            Status: null,
            ApiUrl: null,
            ApiUsername: null,
            ApiPassword: null,
            WebUrl: null,
            ProvinceId: province.Id);

        var result = await controller.Create(request);

        Assert.IsType<CreatedAtActionResult>(result);

        var provinceAdmin = await db.Users.SingleAsync(u => u.Role == "admin_province");
        Assert.Equal(new[] { province.Id }, provinceAdmin.ProvinceIds);
        Assert.Equal("admintinhvl", provinceAdmin.Username);
        Assert.True(provinceAdmin.MustChangePassword);
        Assert.StartsWith("enc:v1:", provinceAdmin.ProvisionedPassword);
        Assert.True(BCrypt.Net.BCrypt.Verify("TinhVL@2026!", provinceAdmin.PasswordHash));

        var stationAdmin = await db.Users.SingleAsync(u => u.Role == "admin_station");
        var createdStation = await db.Stations.SingleAsync();
        Assert.Equal(new[] { createdStation.Id }, stationAdmin.StationIds);
        Assert.Equal("admintramvl01", stationAdmin.Username);
        Assert.True(stationAdmin.MustChangePassword);
        Assert.StartsWith("enc:v1:", stationAdmin.ProvisionedPassword);
        Assert.True(BCrypt.Net.BCrypt.Verify("TramVL01@26", stationAdmin.PasswordHash));
    }

    [Fact]
    public async Task Create_WhenProvinceAlreadyHasAdminProvince_ShouldNotCreateDuplicateAccount()
    {
        using var db = CreateInMemoryDb();

        var admin = new User
        {
            Id = Guid.NewGuid(),
            Username = "multi",
            PasswordHash = BCrypt.Net.BCrypt.HashPassword("Demo@2024"),
            Role = "admin",
            IsActive = true
        };
        var province = new Province
        {
            Id = Guid.NewGuid(),
            Name = "Tỉnh Vĩnh Long",
            Code = "VL",
            Status = "active"
        };
        var existingProvinceAdmin = new User
        {
            Id = Guid.NewGuid(),
            Username = "admintinhvl",
            PasswordHash = BCrypt.Net.BCrypt.HashPassword("Existing@123"),
            Role = "admin_province",
            ProvinceIds = new[] { province.Id },
            IsActive = true
        };

        db.Users.AddRange(admin, existingProvinceAdmin);
        db.Provinces.Add(province);
        await db.SaveChangesAsync();

        var controller = CreateController(db, admin);
        var request = new StationRequest(
            Name: "Trạm Vĩnh Long 02",
            Code: "VL02",
            Location: """{"lat":10.254,"lng":105.973,"address":"Phường 2, Tỉnh Vĩnh Long"}""",
            Status: null,
            ApiUrl: null,
            ApiUsername: null,
            ApiPassword: null,
            WebUrl: null,
            ProvinceId: province.Id);

        var result = await controller.Create(request);

        Assert.IsType<CreatedAtActionResult>(result);
        Assert.Equal(1, await db.Users.CountAsync(u => u.Role == "admin_province" && u.ProvinceIds != null && u.ProvinceIds.Contains(province.Id)));
    }

    [Fact]
    public async Task Create_WhenStationAdminUsernameExists_ShouldCreateUniqueStationAdminAccount()
    {
        using var db = CreateInMemoryDb();

        var admin = new User
        {
            Id = Guid.NewGuid(),
            Username = "multi",
            PasswordHash = BCrypt.Net.BCrypt.HashPassword("Demo@2024"),
            Role = "admin",
            IsActive = true
        };
        var province = new Province
        {
            Id = Guid.NewGuid(),
            Name = "Tỉnh Vĩnh Long",
            Code = "VL",
            Status = "active"
        };
        var existingStationAdmin = new User
        {
            Id = Guid.NewGuid(),
            Username = "admintramvl01",
            PasswordHash = BCrypt.Net.BCrypt.HashPassword("Old@123"),
            Role = "admin_station",
            StationIds = new[] { Guid.NewGuid() },
            IsActive = true
        };

        db.Users.AddRange(admin, existingStationAdmin);
        db.Provinces.Add(province);
        await db.SaveChangesAsync();

        var controller = CreateController(db, admin);
        var request = new StationRequest(
            Name: "Trạm Vĩnh Long 01",
            Code: "VL01",
            Location: """{"lat":10.253,"lng":105.972,"address":"Phường 1, Tỉnh Vĩnh Long"}""",
            Status: null,
            ApiUrl: null,
            ApiUsername: null,
            ApiPassword: null,
            WebUrl: null,
            ProvinceId: province.Id);

        var result = await controller.Create(request);

        Assert.IsType<CreatedAtActionResult>(result);

        var stationAdmins = await db.Users
            .Where(u => u.Role == "admin_station")
            .OrderBy(u => u.Username)
            .ToListAsync();

        Assert.Equal(2, stationAdmins.Count);
        Assert.Contains(stationAdmins, u => u.Username == "admintramvl01");
        Assert.Contains(stationAdmins, u => u.Username == "admintramvl012");
    }

    [Fact]
    public async Task Create_WhenCallerIsTeamLeaderWithFixedProvince_ShouldAllowCreatingStationInOwnProvince()
    {
        using var db = CreateInMemoryDb();

        var province = new Province
        {
            Id = Guid.NewGuid(),
            Name = "Tỉnh Vĩnh Long",
            Code = "VL",
            Status = "active"
        };
        var team = new Team
        {
            Id = Guid.NewGuid(),
            Name = "Tổ Vĩnh Long 1",
            ProvinceId = province.Id,
            StationIds = Array.Empty<Guid>()
        };
        var leader = new User
        {
            Id = Guid.NewGuid(),
            Username = "teamleadervl1",
            PasswordHash = BCrypt.Net.BCrypt.HashPassword("Demo@2024"),
            Role = "team_leader",
            TeamId = team.Id,
            IsActive = true
        };

        db.Provinces.Add(province);
        db.Teams.Add(team);
        db.Users.Add(leader);
        await db.SaveChangesAsync();

        var controller = CreateController(db, leader);
        var request = new StationRequest(
            Name: "Trạm Vĩnh Long 03",
            Code: "VL03",
            Location: """{"lat":10.255,"lng":105.974,"address":"Phường 3, Tỉnh Vĩnh Long"}""",
            Status: null,
            ApiUrl: null,
            ApiUsername: null,
            ApiPassword: null,
            WebUrl: null,
            ProvinceId: province.Id);

        var result = await controller.Create(request);

        Assert.IsType<CreatedAtActionResult>(result);
        var createdStation = await db.Stations.SingleAsync();
        Assert.Equal(province.Id, createdStation.ProvinceId);
    }
}

using System.Security.Claims;
using Microsoft.AspNetCore.Http;
using Microsoft.AspNetCore.SignalR;
using Microsoft.AspNetCore.Mvc;
using Microsoft.EntityFrameworkCore;
using Moq;
using StationOS.Api.Controllers;
using StationOS.Api.Hubs;
using StationOS.Data;
using StationOS.Data.Entities;
using StationOS.Services;
using StationOS.Services.Security;
using Microsoft.Extensions.Configuration;
using Microsoft.Extensions.Logging;

namespace StationOS.Tests;

public class TeamsControllerTests
{
    private static AppDbContext CreateInMemoryDb()
    {
        var opts = new DbContextOptionsBuilder<AppDbContext>()
            .UseInMemoryDatabase(Guid.NewGuid().ToString())
            .Options;
        return new AppDbContext(opts);
    }

    private static TeamsController CreateController(AppDbContext db, Guid adminUserId)
    {
        var httpContext = new DefaultHttpContext
        {
            User = new ClaimsPrincipal(new ClaimsIdentity(new[]
            {
                new Claim(ClaimTypes.NameIdentifier, adminUserId.ToString()),
                new Claim(ClaimTypes.Name, "multi"),
                new Claim(ClaimTypes.Role, "admin")
            }, "TestAuth"))
        };

        var httpAccessor = new HttpContextAccessor { HttpContext = httpContext };
        var permissionService = new PermissionService(httpAccessor, db);

        var clientProxy = new Mock<IClientProxy>();
        clientProxy
            .Setup(x => x.SendCoreAsync(It.IsAny<string>(), It.IsAny<object?[]>(), It.IsAny<CancellationToken>()))
            .Returns(Task.CompletedTask);

        var hubClients = new Mock<IHubClients>();
        hubClients.Setup(x => x.All).Returns(clientProxy.Object);

        var hubContext = new Mock<IHubContext<RealtimeHub>>();
        hubContext.Setup(x => x.Clients).Returns(hubClients.Object);

        var mockConfig = new Mock<IConfiguration>();
        var mockCryptoLogger = new Mock<ILogger<CredentialEncryptionService>>();
        var testKeyBytes = System.Security.Cryptography.SHA256.HashData(System.Text.Encoding.UTF8.GetBytes("TEST_KEY"));
        Environment.SetEnvironmentVariable("STATIONOS_ENCRYPTION_KEY", Convert.ToBase64String(testKeyBytes));
        var crypto = new CredentialEncryptionService(mockConfig.Object, mockCryptoLogger.Object);

        return new TeamsController(db, permissionService, hubContext.Object, crypto);
    }

    [Fact]
    public async Task Create_ShouldAutoCreateDefaultTeamLeader()
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
        var station = new Station
        {
            Id = Guid.NewGuid(),
            Name = "Trạm Vĩnh Long 01",
            Code = "VL01",
            Location = """{"lat":10.253,"lng":105.972,"address":"Phường 1, Tỉnh Vĩnh Long"}""",
            ProvinceId = province.Id,
            Status = "active"
        };

        db.Users.Add(admin);
        db.Provinces.Add(province);
        db.Stations.Add(station);
        await db.SaveChangesAsync();

        var controller = CreateController(db, admin.Id);
        var result = await controller.Create(new CreateTeamRequest("Tổ thao tác Vĩnh Long 1", province.Id, new[] { station.Id }));

        Assert.IsType<OkObjectResult>(result);

        var team = await db.Teams.SingleAsync();
        var teamLeader = await db.Users.SingleAsync(u => u.Role == "team_leader" && u.TeamId == team.Id);
        Assert.Equal("teamleadertothaotacvinhlong1vl", teamLeader.Username);
        Assert.True(teamLeader.MustChangePassword);
        Assert.StartsWith("enc:v1:", teamLeader.ProvisionedPassword);
        Assert.True(BCrypt.Net.BCrypt.Verify("TothaoVL@26", teamLeader.PasswordHash));
    }

    [Fact]
    public async Task Create_WhenDefaultUsernameAlreadyExists_ShouldAppendSuffix()
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
        var station = new Station
        {
            Id = Guid.NewGuid(),
            Name = "Trạm Vĩnh Long 01",
            Code = "VL01",
            Location = """{"lat":10.253,"lng":105.972,"address":"Phường 1, Tỉnh Vĩnh Long"}""",
            ProvinceId = province.Id,
            Status = "active"
        };
        var existingUser = new User
        {
            Id = Guid.NewGuid(),
            Username = "teamleadertothaotacvinhlong1vl",
            PasswordHash = BCrypt.Net.BCrypt.HashPassword("Existing@123"),
            Role = "operator",
            IsActive = true
        };

        db.Users.AddRange(admin, existingUser);
        db.Provinces.Add(province);
        db.Stations.Add(station);
        await db.SaveChangesAsync();

        var controller = CreateController(db, admin.Id);
        var result = await controller.Create(new CreateTeamRequest("Tổ thao tác Vĩnh Long 1", province.Id, new[] { station.Id }));

        Assert.IsType<OkObjectResult>(result);

        var team = await db.Teams.SingleAsync();
        var teamLeader = await db.Users.SingleAsync(u => u.Role == "team_leader" && u.TeamId == team.Id);
        Assert.Equal("teamleadertothaotacvinhlong1vl2", teamLeader.Username);
    }

    [Fact]
    public async Task Delete_ShouldRemoveTeamAndAllUsersBelongingToTeam()
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
        var team = new Team
        {
            Id = Guid.NewGuid(),
            Name = "tổ 5",
            StationIds = Array.Empty<Guid>()
        };
        var teamLeader = new User
        {
            Id = Guid.NewGuid(),
            Username = "teamleaderto5tn",
            PasswordHash = BCrypt.Net.BCrypt.HashPassword("To5TN@26"),
            Role = "team_leader",
            TeamId = team.Id,
            IsActive = true
        };
        var teamMember = new User
        {
            Id = Guid.NewGuid(),
            Username = "nhanviento5tn",
            PasswordHash = BCrypt.Net.BCrypt.HashPassword("NhanVien@26"),
            Role = "team_member",
            TeamId = team.Id,
            IsActive = true
        };

        db.Users.AddRange(admin, teamLeader, teamMember);
        db.Teams.Add(team);
        await db.SaveChangesAsync();

        var controller = CreateController(db, admin.Id);
        var result = await controller.Delete(team.Id);

        Assert.IsType<NoContentResult>(result);
        Assert.False(await db.Teams.AnyAsync(t => t.Id == team.Id));
        Assert.False(await db.Users.AnyAsync(u => u.TeamId == team.Id));
        Assert.False(await db.Users.AnyAsync(u => u.Username == "teamleaderto5tn"));
        Assert.False(await db.Users.AnyAsync(u => u.Username == "nhanviento5tn"));
    }
}

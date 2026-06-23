// ============================================================
// LicenseTests — Unit tests for LicenseService key validation,
// activation, resource limits, and concurrent session tracking.
// ============================================================
using System.Security.Cryptography;
using System.Text;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Configuration;
using Microsoft.Extensions.DependencyInjection;
using Moq;
using StationOS.Data;
using StationOS.Data.Entities;
using StationOS.Services;
using Xunit;

namespace StationOS.Tests;

public class LicenseTests : IDisposable
{
    private readonly AppDbContext _db;
    private readonly LicenseService _licenseService;
    private const string TestSecret = "MY_SUPER_DUPER_TEST_VENDOR_SECRET_KEY_12345";

    public LicenseTests()
    {
        // 1. Setup Environment Secret
        Environment.SetEnvironmentVariable("STATIONOS_VENDOR_SECRET", TestSecret);

        // 2. Setup InMemory DB
        var options = new DbContextOptionsBuilder<AppDbContext>()
            .UseInMemoryDatabase(databaseName: Guid.NewGuid().ToString())
            .Options;
        _db = new AppDbContext(options);

        // 3. Setup Dependency Injection Scope factory mockup
        var serviceProvider = new ServiceCollection()
            .AddSingleton(_db)
            .BuildServiceProvider();

        var mockScope = new Mock<IServiceScope>();
        mockScope.Setup(s => s.ServiceProvider).Returns(serviceProvider);

        var mockScopeFactory = new Mock<IServiceScopeFactory>();
        mockScopeFactory.Setup(f => f.CreateScope()).Returns(mockScope.Object);

        var mockConfig = new Mock<IConfiguration>();

        // 4. Initialize Service
        _licenseService = new LicenseService(mockScopeFactory.Object, mockConfig.Object);
    }

    public void Dispose()
    {
        _db.Database.EnsureDeleted();
        _db.Dispose();
    }

    private string GenerateTestKey(string payload)
    {
        var keyBytes = Encoding.UTF8.GetBytes(TestSecret);
        var dataBytes = Encoding.UTF8.GetBytes(payload);
        var hash = HMACSHA256.HashData(keyBytes, dataBytes);
        var hmac8 = Convert.ToHexString(hash)[..8];
        return $"{payload}-{hmac8}";
    }

    [Fact]
    public void ValidateKey_4PartKey_ShouldParseCorrectly()
    {
        // Format: TIER-YYMMDD-NONCE-HMAC8
        // Defaults for TEAM: MaxUsers=5, MaxStations=10, MaxCameras=8, MaxRoiPoints=500, MaxRoiRegions=30, MaxPdRegions=30
        var payload = "TEAM-291231-A1B2";
        var key = GenerateTestKey(payload);

        var result = _licenseService.ValidateKey(key);

        Assert.True(result.Valid);
        Assert.Equal("team", result.Tier);
        Assert.Equal(5, result.MaxUsers);
        Assert.Equal(10, result.MaxStations);
        Assert.Equal(8, result.MaxCameras);
        Assert.Equal(500, result.MaxRoiPoints);
        Assert.Equal(30, result.MaxRoiRegions);
        Assert.Equal(30, result.MaxPdRegions);
        Assert.Equal(new DateTime(2029, 12, 31, 0, 0, 0, DateTimeKind.Utc), result.ExpiresAt);
    }

    [Fact]
    public void ValidateKey_5PartKey_ShouldParseCorrectly()
    {
        // Format: TIER-YYMMDD-MAXUSERS-NONCE-HMAC8
        var payload = "SOLO-300101-3-E4D2";
        var key = GenerateTestKey(payload);

        var result = _licenseService.ValidateKey(key);

        Assert.True(result.Valid);
        Assert.Equal("solo", result.Tier);
        Assert.Equal(3, result.MaxUsers); // Custom max users override
        Assert.Equal(1, result.MaxStations); // Defaults for SOLO
        Assert.Equal(2, result.MaxCameras);
        Assert.Equal(10, result.MaxRoiPoints);
    }

    [Fact]
    public void ValidateKey_7PartKey_ShouldParseCorrectly()
    {
        // Format: TIER-YYMMDD-MAXDEVICES-MAXCAMERAS-MAXROIPOINTS-NONCE-HMAC8
        var payload = "TEAM-290505-15-20-400-A9C3";
        var key = GenerateTestKey(payload);

        var result = _licenseService.ValidateKey(key);

        Assert.True(result.Valid);
        Assert.Equal("team", result.Tier);
        Assert.Equal(5, result.MaxUsers); // default TEAM max users
        Assert.Equal(15, result.MaxStations);
        Assert.Equal(20, result.MaxCameras);
        Assert.Equal(400, result.MaxRoiPoints);
        Assert.Equal(30, result.MaxRoiRegions); // default TEAM
    }

    [Fact]
    public void ValidateKey_9PartKey_ShouldParseCorrectly()
    {
        // Format: TIER-YYMMDD-MAXDEVICES-MAXCAMERAS-MAXROIPOINTS-MAXROIREGIONS-MAXPDREGIONS-NONCE-HMAC8
        var payload = "TEAM-290505-15-20-400-25-35-A9C3";
        var key = GenerateTestKey(payload);

        var result = _licenseService.ValidateKey(key);

        Assert.True(result.Valid);
        Assert.Equal("team", result.Tier);
        Assert.Equal(15, result.MaxStations);
        Assert.Equal(20, result.MaxCameras);
        Assert.Equal(400, result.MaxRoiPoints);
        Assert.Equal(25, result.MaxRoiRegions);
        Assert.Equal(35, result.MaxPdRegions);
    }

    [Fact]
    public void ValidateKey_10PartKey_ShouldParseCorrectly()
    {
        // Format: TIER-YYMMDD-MAXUSERS-MAXDEVICES-MAXCAMERAS-MAXROIPOINTS-MAXROIREGIONS-MAXPDREGIONS-NONCE-HMAC8
        var payload = "ENT-321231-100-50-80-600-80-80-D9F1";
        var key = GenerateTestKey(payload);

        var result = _licenseService.ValidateKey(key);

        Assert.True(result.Valid);
        Assert.Equal("ent", result.Tier);
        Assert.Equal(100, result.MaxUsers);
        Assert.Equal(50, result.MaxStations);
        Assert.Equal(80, result.MaxCameras);
        Assert.Equal(600, result.MaxRoiPoints);
        Assert.Equal(80, result.MaxRoiRegions);
        Assert.Equal(80, result.MaxPdRegions);
    }

    [Fact]
    public void ValidateKey_InvalidSignature_ShouldReturnError()
    {
        var payload = "TEAM-291231-A1B2";
        var key = GenerateTestKey(payload) + "X"; // Modified HMAC

        var result = _licenseService.ValidateKey(key);

        Assert.False(result.Valid);
        Assert.Contains("Chữ ký không hợp lệ", result.ErrorMessage);
    }

    [Fact]
    public void ValidateKey_ExpiredKey_ShouldReturnValidFalseOrExpiredMessage()
    {
        var payload = "SOLO-201231-A1B2"; // Expired in 2020
        var key = GenerateTestKey(payload);

        var result = _licenseService.ValidateKey(key);

        Assert.False(result.Valid);
        Assert.Contains("hết hạn", result.ErrorMessage);
    }

    [Fact]
    public async Task ActivateAsync_ValidKey_ShouldSaveToDatabaseAndDeactivateOld()
    {
        var key1 = GenerateTestKey("SOLO-291231-1111");
        var key2 = GenerateTestKey("TEAM-301231-2222");

        // 1. Activate key1
        var (s1, e1) = await _licenseService.ActivateAsync(key1);
        Assert.True(s1);
        Assert.True(string.IsNullOrEmpty(e1));

        var activeLicenses1 = await _db.Licenses.Where(l => l.IsActive).ToListAsync();
        Assert.Single(activeLicenses1);
        Assert.Equal("solo", activeLicenses1[0].Tier);

        // 2. Activate key2 (should deactivate key1)
        var (s2, e2) = await _licenseService.ActivateAsync(key2);
        Assert.True(s2);

        var activeLicenses2 = await _db.Licenses.Where(l => l.IsActive).ToListAsync();
        Assert.Single(activeLicenses2);
        Assert.Equal("team", activeLicenses2[0].Tier);

        var inactiveLicenses = await _db.Licenses.Where(l => !l.IsActive).ToListAsync();
        Assert.Single(inactiveLicenses);
        Assert.Equal("solo", inactiveLicenses[0].Tier);
    }

    [Fact]
    public async Task TryAcquireSessionAsync_EnforcesConcurrentLimitAndBypass()
    {
        // Activate a key with MaxUsers = 2
        var key = GenerateTestKey("TEAM-291231-2-9999"); // Override MaxUsers to 2 using 5-part format
        await _licenseService.ActivateAsync(key);

        var expiry = DateTime.UtcNow.AddHours(1);

        // Session 1: operator 1 -> Allowed
        var (allow1, _) = await _licenseService.TryAcquireSessionAsync("token1", expiry, "user1", "operator");
        Assert.True(allow1);

        // Session 2: operator 2 -> Allowed
        var (allow2, _) = await _licenseService.TryAcquireSessionAsync("token2", expiry, "user2", "operator");
        Assert.True(allow2);

        // Session 3: operator 3 -> Rejected (limit is 2)
        var (allow3, reason3) = await _licenseService.TryAcquireSessionAsync("token3", expiry, "user3", "operator");
        Assert.False(allow3);
        Assert.Equal("max_users", reason3);

        // Session 4: admin 1 -> Allowed (Bypassed)
        var (allow4, _) = await _licenseService.TryAcquireSessionAsync("token4", expiry, "admin1", "admin");
        Assert.True(allow4);

        // Session 5: operator 3 again -> still rejected
        var (allow5, _) = await _licenseService.TryAcquireSessionAsync("token3", expiry, "user3", "operator");
        Assert.False(allow5);

        // Release session 1
        _licenseService.ReleaseSession("token1");

        // Session 3 now: operator 3 -> Allowed
        var (allow6, _) = await _licenseService.TryAcquireSessionAsync("token3", expiry, "user3", "operator");
        Assert.True(allow6);
    }

    [Fact]
    public async Task CheckResourceLimitAsync_NoLicense_DefaultsToLimitOfTen()
    {
        // Ensure no active licenses are in DB
        var activeLicenses = await _db.Licenses.Where(l => l.IsActive).ToListAsync();
        _db.Licenses.RemoveRange(activeLicenses);
        await _db.SaveChangesAsync();

        var limitStations = await _licenseService.CheckResourceLimitAsync("stations");
        Assert.Equal(10, limitStations.Max);
        Assert.False(limitStations.Exceeded);

        var limitCameras = await _licenseService.CheckResourceLimitAsync("cameras");
        Assert.Equal(10, limitCameras.Max);
        Assert.False(limitCameras.Exceeded);

        var limitRoiPoints = await _licenseService.CheckResourceLimitAsync("roi_points");
        Assert.Equal(10, limitRoiPoints.Max);
        Assert.False(limitRoiPoints.Exceeded);

        var limitRoiRegions = await _licenseService.CheckResourceLimitAsync("roi_regions");
        Assert.Equal(10, limitRoiRegions.Max);
        Assert.False(limitRoiRegions.Exceeded);

        var limitPdRegions = await _licenseService.CheckResourceLimitAsync("pd_regions");
        Assert.Equal(10, limitPdRegions.Max);
        Assert.False(limitPdRegions.Exceeded);
    }
}

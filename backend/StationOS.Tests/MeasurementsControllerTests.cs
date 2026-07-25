using Microsoft.AspNetCore.Mvc;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Caching.Memory;
using Microsoft.Extensions.Configuration;
using Microsoft.AspNetCore.SignalR;
using Moq;
using StationOS.Api.Controllers;
using StationOS.Api.Hubs;
using StationOS.Data;
using StationOS.Data.Entities;
using Xunit;

namespace StationOS.Tests;

public class MeasurementsControllerTests
{
    private static AppDbContext CreateInMemoryDb()
    {
        var opts = new DbContextOptionsBuilder<AppDbContext>()
            .UseInMemoryDatabase(Guid.NewGuid().ToString())
            .Options;
        return new AppDbContext(opts);
    }

    [Fact]
    public async Task CleanupSensorReadings_DeletesOnlyOldRecords()
    {
        // Arrange
        using var db = CreateInMemoryDb();
        var mockHubContext = new Mock<IHubContext<RealtimeHub>>();
        var mockConfig = new Mock<IConfiguration>();
        var mockCache = new Mock<IMemoryCache>();

        var controller = new MeasurementsController(db, mockHubContext.Object, mockConfig.Object, mockCache.Object);

        var now = DateTime.UtcNow;
        var oldReading = new SensorReading
        {
            Time = now.AddDays(-35),
            DeviceId = Guid.NewGuid(),
            PointId = "temp_1",
            Value = 25.5
        };
        var newReading = new SensorReading
        {
            Time = now.AddDays(-10),
            DeviceId = Guid.NewGuid(),
            PointId = "temp_1",
            Value = 30.2
        };

        db.SensorReadings.AddRange(oldReading, newReading);
        await db.SaveChangesAsync();

        // Act
        var result = await controller.CleanupSensorReadings(30);

        // Assert
        var okResult = Assert.IsType<OkObjectResult>(result);
        
        // Dùng dynamic/reflection hoặc JSON serialization để đọc giá trị anonymous type
        var value = okResult.Value;
        Assert.NotNull(value);
        
        var deletedCountProp = value.GetType().GetProperty("deletedCount");
        Assert.NotNull(deletedCountProp);
        var deletedCount = (int)deletedCountProp.GetValue(value)!;
        Assert.Equal(1, deletedCount);

        var remainingReadings = await db.SensorReadings.ToListAsync();
        Assert.Single(remainingReadings);
        Assert.Equal(newReading.Time, remainingReadings[0].Time);
    }
}

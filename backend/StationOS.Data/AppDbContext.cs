using Microsoft.EntityFrameworkCore;
using StationOS.Data.Entities;

namespace StationOS.Data;

public class AppDbContext : DbContext
{
    public AppDbContext(DbContextOptions<AppDbContext> options) : base(options) { }

    public DbSet<Province> Provinces => Set<Province>();
    public DbSet<Station> Stations => Set<Station>();
    public DbSet<Device> Devices => Set<Device>();
    public DbSet<User> Users => Set<User>();
    public DbSet<SldFile> SldFiles => Set<SldFile>();
    public DbSet<SldPoint> SldPoints => Set<SldPoint>();
    public DbSet<SensorReading> SensorReadings => Set<SensorReading>();
    public DbSet<AiModelVersion> AiModelVersions => Set<AiModelVersion>();
    public DbSet<DetectionEvent> DetectionEvents => Set<DetectionEvent>();
    public DbSet<MediaFile> MediaFiles => Set<MediaFile>();
    public DbSet<ThermalFrame> ThermalFrames => Set<ThermalFrame>();
    public DbSet<Alert> Alerts => Set<Alert>();
    public DbSet<AlertHistory> AlertHistories => Set<AlertHistory>();
    public DbSet<Rule> Rules => Set<Rule>();
    public DbSet<RuleTriggerLog> RuleTriggerLogs => Set<RuleTriggerLog>();
    public DbSet<AuditLog> AuditLogs => Set<AuditLog>();
    public DbSet<LoginLog> LoginLogs => Set<LoginLog>();
    public DbSet<NotifyLog> NotifyLogs => Set<NotifyLog>();
    public DbSet<SystemSettings> SystemSettings => Set<SystemSettings>();
    public DbSet<Report> Reports => Set<Report>();
    public DbSet<SyncQueue> SyncQueues => Set<SyncQueue>();
    public DbSet<MaintenanceTask> MaintenanceTasks => Set<MaintenanceTask>();
    public DbSet<License> Licenses => Set<License>();
    public DbSet<LicenseAddonRecord> LicenseAddons => Set<LicenseAddonRecord>();
    public DbSet<Boundary> Boundaries => Set<Boundary>();
    public DbSet<RoiPoint> RoiPoints => Set<RoiPoint>();
    public DbSet<Team> Teams => Set<Team>();

    protected override void OnModelCreating(ModelBuilder modelBuilder)
    {
        base.OnModelCreating(modelBuilder);

        // SensorReading — TimescaleDB hypertable (composite key: time + id)
        modelBuilder.Entity<SensorReading>(e =>
        {
            e.HasKey(x => new { x.Time, x.Id });
            e.Property(x => x.Id).ValueGeneratedOnAdd();
            e.HasIndex(x => new { x.StationId, x.Time });
            e.HasIndex(x => new { x.DeviceId, x.PointId, x.Time });
        });

        // SystemSettings — unique constraint (station_id, key)
        modelBuilder.Entity<SystemSettings>()
            .HasIndex(x => new { x.StationId, x.Key })
            .IsUnique();

        // LicenseAddonRecord — mỗi AddonId (GUID) chỉ được ghi nhận một lần, chống nạp trùng
        // vĩnh viễn kể cả khi file .lic gốc bị xoá khỏi thư mục Licenses rồi nạp lại.
        modelBuilder.Entity<LicenseAddonRecord>()
            .HasIndex(x => x.AddonId)
            .IsUnique();

        // JSON columns (PostgreSQL JSONB)
        modelBuilder.Entity<Station>().Property(x => x.Location).HasColumnType("jsonb");
        // Name/Code are trimmed by the API before persistence. These constraints are the
        // final guard against two concurrent requests creating the same station.
        modelBuilder.Entity<Station>().HasIndex(x => x.Name).IsUnique();
        modelBuilder.Entity<Station>().HasIndex(x => x.Code).IsUnique();
        // Station.ProvinceId FK
        modelBuilder.Entity<Station>()
            .HasOne<Province>()
            .WithMany()
            .HasForeignKey(s => s.ProvinceId)
            .OnDelete(DeleteBehavior.SetNull);
        // User.ProvinceIds — lưu dưới dạng Guid array (PostgreSQL)
        modelBuilder.Entity<User>().Property(x => x.ProvinceIds).HasColumnType("uuid[]");
        // User.Permissions — lưu dưới dạng string array (PostgreSQL text[])
        modelBuilder.Entity<User>().Property(x => x.Permissions).HasColumnType("text[]");
        // User → Team FK
        modelBuilder.Entity<User>()
            .HasOne<Team>()
            .WithMany()
            .HasForeignKey(u => u.TeamId)
            .OnDelete(DeleteBehavior.SetNull);

        // Team configuration
        modelBuilder.Entity<Team>().Property(x => x.StationIds).HasColumnType("uuid[]");
        modelBuilder.Entity<Team>()
            .HasOne<Province>()
            .WithMany()
            .HasForeignKey(t => t.ProvinceId)
            .OnDelete(DeleteBehavior.SetNull);
        modelBuilder.Entity<Device>().Property(x => x.Config).HasColumnType("jsonb");
        modelBuilder.Entity<Rule>().Property(x => x.Condition).HasColumnType("jsonb");
        modelBuilder.Entity<Rule>().Property(x => x.Actions).HasColumnType("jsonb");
        modelBuilder.Entity<DetectionEvent>().Property(x => x.BoundingBoxes).HasColumnType("jsonb");
        modelBuilder.Entity<DetectionEvent>().Property(x => x.Metadata).HasColumnType("jsonb");
        modelBuilder.Entity<ThermalFrame>().Property(x => x.TempMatrix).HasColumnType("jsonb");
        modelBuilder.Entity<AuditLog>().Property(x => x.OldValue).HasColumnType("jsonb");
        modelBuilder.Entity<AuditLog>().Property(x => x.NewValue).HasColumnType("jsonb");
        modelBuilder.Entity<SyncQueue>().Property(x => x.Payload).HasColumnType("jsonb");
        modelBuilder.Entity<SystemSettings>().Property(x => x.Value).HasColumnType("jsonb");
        modelBuilder.Entity<RuleTriggerLog>().Property(x => x.ConditionSnapshot).HasColumnType("jsonb");
        modelBuilder.Entity<MaintenanceTask>().Property(x => x.Checklist).HasColumnType("jsonb");
        modelBuilder.Entity<Boundary>().Property(x => x.PolygonJson).HasColumnType("jsonb");
        modelBuilder.Entity<Boundary>().Property(x => x.ThresholdsJson).HasColumnType("jsonb");

        // Boundary index: nhanh khi list theo device
        modelBuilder.Entity<Boundary>().HasIndex(x => new { x.DeviceId, x.Type });
    }
}

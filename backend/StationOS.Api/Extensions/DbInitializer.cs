using Microsoft.EntityFrameworkCore;
using Npgsql;
using StationOS.Data;
using StationOS.Services.Auth;
using StationOS.Services.Devices;

namespace StationOS.Api.Extensions;

public static class DbInitializer
{
    /// <summary>Khởi tạo cơ sở dữ liệu khi ứng dụng khởi động: tạo extension TimescaleDB, chạy migration, chuyển SensorReadings thành hypertable, seed dữ liệu tối thiểu cho đăng nhập/phân quyền, đồng bộ camera lên go2rtc.</summary>
    /// <param name="app">WebApplication instance để lấy service provider.</param>
    public static async Task InitializeDatabaseAsync(this WebApplication app)
    {
        using var scope = app.Services.CreateScope();
        var services = scope.ServiceProvider;
        var db = services.GetRequiredService<AppDbContext>();
        var config = services.GetRequiredService<IConfiguration>();

        // 0. Tự động tạo database nếu chưa tồn tại (PostgreSQL)
        await EnsureDatabaseCreatedAsync(config);

        // 1. Tạo extension TimescaleDB TRƯỚC khi migrate (cần thiết cho hypertable)
        try
        {
            await db.Database.ExecuteSqlRawAsync(@"CREATE EXTENSION IF NOT EXISTS timescaledb;");
        }
        catch (Exception ex)
        {
            // SQLite hoặc Postgres không có TimescaleDB → bỏ qua, dùng bảng thường
            Console.WriteLine($"[Startup] TimescaleDB extension không khả dụng (OK nếu là SQLite): {ex.Message}");
        }

        // 2. Chạy migration tạo schema
        db.Database.Migrate();

        // 3. Biến SensorReadings thành hypertable (sau khi table đã được tạo)
        try
        {
            await db.Database.ExecuteSqlRawAsync(
                @"SELECT create_hypertable('""SensorReadings""', 'Time', if_not_exists => TRUE, migrate_data => TRUE);");
        }
        catch (Exception ex)
        {
            Console.WriteLine($"[Startup] Không convert SensorReadings sang hypertable (OK nếu không phải TimescaleDB): {ex.Message}");
        }

        // Đảm bảo các cột được thêm vào kể cả khi migration đã bị đánh dấu "applied" mà DDL chưa chạy
        await db.Database.ExecuteSqlRawAsync(@"ALTER TABLE ""Rules"" ADD COLUMN IF NOT EXISTS ""RuleSet"" text;");
        await db.Database.ExecuteSqlRawAsync(@"ALTER TABLE ""Stations"" ADD COLUMN IF NOT EXISTS ""ApiUrl"" text;");
        await db.Database.ExecuteSqlRawAsync(@"ALTER TABLE ""Stations"" ADD COLUMN IF NOT EXISTS ""ApiUsername"" text;");
        await db.Database.ExecuteSqlRawAsync(@"ALTER TABLE ""Stations"" ADD COLUMN IF NOT EXISTS ""ApiPassword"" text;");
        await db.Database.ExecuteSqlRawAsync(@"ALTER TABLE ""Stations"" ADD COLUMN IF NOT EXISTS ""WebUrl"" text;");
        await db.Database.ExecuteSqlRawAsync(@"ALTER TABLE ""Stations"" ADD COLUMN IF NOT EXISTS ""ConnectionStatus"" text NOT NULL DEFAULT 'unknown';");
        await db.Database.ExecuteSqlRawAsync(@"ALTER TABLE ""Stations"" ADD COLUMN IF NOT EXISTS ""ConnectionStatusChangedAt"" timestamp with time zone;");
        await db.Database.ExecuteSqlRawAsync(@"ALTER TABLE ""Stations"" ADD COLUMN IF NOT EXISTS ""LastContactAt"" timestamptz;");
        await db.Database.ExecuteSqlRawAsync(@"ALTER TABLE ""Stations"" ADD COLUMN IF NOT EXISTS ""CameraQuota"" integer;");
        await db.Database.ExecuteSqlRawAsync(@"ALTER TABLE ""Stations"" ADD COLUMN IF NOT EXISTS ""SensorQuota"" integer;");
        await db.Database.ExecuteSqlRawAsync(@"ALTER TABLE ""Users"" ADD COLUMN IF NOT EXISTS ""ProvisionedPassword"" text;");
        await db.Database.ExecuteSqlRawAsync(@"ALTER TABLE ""Reports"" ADD COLUMN IF NOT EXISTS ""ScopeType"" text DEFAULT 'station';");
        await db.Database.ExecuteSqlRawAsync(@"ALTER TABLE ""Reports"" ADD COLUMN IF NOT EXISTS ""ProvinceId"" uuid;");
        await db.Database.ExecuteSqlRawAsync(@"ALTER TABLE ""Reports"" ADD COLUMN IF NOT EXISTS ""TeamId"" uuid;");
        await db.Database.ExecuteSqlRawAsync(@"ALTER TABLE ""Reports"" ADD COLUMN IF NOT EXISTS ""ScopeLabel"" text;");
        await db.Database.ExecuteSqlRawAsync(@"ALTER TABLE ""AuditLogs"" ADD COLUMN IF NOT EXISTS ""StationId"" uuid;");
        await db.Database.ExecuteSqlRawAsync(@"ALTER TABLE ""MaintenanceTasks"" ADD COLUMN IF NOT EXISTS ""SyncSource"" text;");
        await db.Database.ExecuteSqlRawAsync(@"ALTER TABLE ""MaintenanceTasks"" ADD COLUMN IF NOT EXISTS ""SyncedToStationAt"" timestamptz;");
        await db.Database.ExecuteSqlRawAsync(@"ALTER TABLE ""MaintenanceTasks"" ADD COLUMN IF NOT EXISTS ""DeviceNameSnapshot"" text;");

        // await SeedDefaultStationAsync(db);

        var authService = services.GetRequiredService<AuthService>();
        await authService.SeedAdminIfNotExistsAsync();
        await CleanupDemoDeviceDataAsync(db);
        // Tắt tính năng tự động tạo Rule mặc định
        // await SeedNetaRulesAsync(db);
        // await SeedTemperatureRulesAsync(db);
        // await SeedThermalPointsRulesAsync(db);
        

        // Sync tất cả camera trong DB lên go2rtc (phòng khi go2rtc restart)
        try
        {
            var deviceService = services.GetRequiredService<DeviceService>();
            var cameras = await db.Devices.Where(d => d.Type.StartsWith("camera")).ToListAsync();
            await deviceService.SyncAllCamerasToGo2RtcAsync(cameras);
        }
        catch (Exception ex)
        {
            Console.WriteLine($"[Startup] Lỗi đồng bộ camera lên go2rtc: {ex.Message}");
        }
    }

    // ── Cleanup demo data from older seeded databases ────────
    private static async Task CleanupDemoDeviceDataAsync(AppDbContext db)
    {
        var demoDeviceNames = new[]
        {
            "Cổng Modbus Vũng Tàu",
            "Tủ 471",
            "HIKVISION – Dual Thermal & Optical",
            "HIKVISION – Phóng điện",
        };

        var demoDevices = await db.Devices
            .Where(d => demoDeviceNames.Contains(d.Name))
            .ToListAsync();

        if (demoDevices.Count == 0) return;

        var demoDeviceIds = demoDevices.Select(d => d.Id).ToList();
        var demoAlerts = await db.Alerts
            .Where(a => a.DeviceId != null && demoDeviceIds.Contains(a.DeviceId.Value))
            .ToListAsync();
        var demoAlertIds = demoAlerts.Select(a => a.Id).ToList();
        var demoAlertHistories = await db.AlertHistories
            .Where(h => demoAlertIds.Contains(h.AlertId))
            .ToListAsync();

        db.AlertHistories.RemoveRange(demoAlertHistories);
        db.Alerts.RemoveRange(demoAlerts);
        db.Devices.RemoveRange(demoDevices);
        await db.SaveChangesAsync();

        Console.WriteLine($"[DbInitializer] Đã xóa {demoDevices.Count} thiết bị demo, {demoAlerts.Count} cảnh báo demo và {demoAlertHistories.Count} lịch sử cảnh báo demo.");
    }

    // ── Seed rules NETA MTS 2023 ────────────────────────────
    private static async Task SeedNetaRulesAsync(AppDbContext db)
    {
        if (await db.Rules.AnyAsync(r => r.Name.StartsWith("NETA"))) return;

        var station = await db.Stations.FirstOrDefaultAsync();
        if (station == null) return;

        db.Rules.AddRange(
            new StationOS.Data.Entities.Rule
            {
                StationId = station.Id,
                Name      = "NETA Monitor — Phóng điện",
                RuleSet   = "Tủ 471",
                Condition = """{"point":"phong_dien","op":">","value":-37}""",
                Actions   = """[{"type":"health","penalty":5},{"type":"maintenance","taskType":"inspection","scheduledInDays":180}]""",
                Enabled   = true,
            },
            new StationOS.Data.Entities.Rule
            {
                StationId = station.Id,
                Name      = "NETA Warning — Phóng điện",
                RuleSet   = "Tủ 471",
                Condition = """{"point":"phong_dien","op":">","value":-27}""",
                Actions   = """[{"type":"health","penalty":15},{"type":"maintenance","taskType":"repair","scheduledInDays":45}]""",
                Enabled   = true,
            },
            new StationOS.Data.Entities.Rule
            {
                StationId = station.Id,
                Name      = "NETA Critical — Phóng điện",
                RuleSet   = "Tủ 471",
                Condition = """{"point":"phong_dien","op":">","value":-20}""",
                Actions   = """[{"type":"health","penalty":30},{"type":"maintenance","taskType":"repair","scheduledInDays":3}]""",
                Enabled   = true,
            }
        );
        await db.SaveChangesAsync();
    }

    // ── Seed trạm + thiết bị thật ────────────────────────────
    private static async Task SeedDefaultStationAsync(AppDbContext db)
    {
        // 1. Nếu có trạm cũ TBA-001 (từ bản backup), thực hiện đổi tên thành Trạm 110kV Long An
        var oldStation = await db.Stations.FirstOrDefaultAsync(s => s.Code == "TBA-001");
        if (oldStation != null)
        {
            oldStation.Name = "Trạm 110kV Long An";
            oldStation.Code = "TBA-LA01";
            oldStation.Location = """{"lat": 10.53, "lng": 106.41, "address": "Bến Lức, Long An"}""";
            await db.SaveChangesAsync();
            Console.WriteLine("[DbInitializer] Đã chuyển đổi trạm TBA-001 thành TBA-LA01 (Trạm 110kV Long An)");
        }

        // 2. Nếu không có trạm nào trong DB, seed đầy đủ từ đầu
        if (!await db.Stations.AnyAsync())
        {
            // 1. Trạm Long An (Có thiết bị kết nối)
            var laStation = new StationOS.Data.Entities.Station
            {
                Name = "Trạm 110kV Long An",
                Code = "TBA-LA01",
                Location = """{"lat": 10.53, "lng": 106.41, "address": "Bến Lức, Long An"}""",
                Status = "active"
            };
            db.Stations.Add(laStation);
            await db.SaveChangesAsync();

            await db.SaveChangesAsync();
        }

        // 3. Đảm bảo các trạm cục bộ khác tồn tại
        if (!await db.Stations.AnyAsync(s => s.Code == "TBA-DT01"))
        {
            db.Stations.Add(new StationOS.Data.Entities.Station
            {
                Name = "Trạm 110kV Đồng Tháp",
                Code = "TBA-DT01",
                Location = """{"lat": 10.45, "lng": 105.63, "address": "Cao Lãnh, Đồng Tháp"}""",
                Status = "active"
            });
        }

        if (!await db.Stations.AnyAsync(s => s.Code == "TBA-VT01"))
        {
            var vtStation = new StationOS.Data.Entities.Station
            {
                Name = "Trạm 110kV Vũng Tàu",
                Code = "TBA-VT01",
                Location = """{"lat": 10.41, "lng": 107.13, "address": "Phú Mỹ, Bà Rịa - Vũng Tàu"}""",
                Status = "active"
            };
            db.Stations.Add(vtStation);
            await db.SaveChangesAsync();

        }

        if (!await db.Stations.AnyAsync(s => s.Code == "TBA-TN01"))
        {
            db.Stations.Add(new StationOS.Data.Entities.Station
            {
                Name = "Trạm 110kV Tây Ninh",
                Code = "TBA-TN01",
                Location = """{"lat": 11.36, "lng": 106.11, "address": "Trảng Bàng, Tây Ninh"}""",
                Status = "active"
            });
        }

        if (!await db.Stations.AnyAsync(s => s.Code == "TBA-HCM01"))
        {
            db.Stations.Add(new StationOS.Data.Entities.Station
            {
                Name = "Trung tâm Giám sát Đa trạm (TP. HCM)",
                Code = "TBA-HCM01",
                Location = """{"lat": 10.7769, "lng": 106.7009, "address": "Quận 1, TP. Hồ Chí Minh"}""",
                Status = "active"
            });
        }

        await db.SaveChangesAsync();
    }

    // ── Seed rules nhiệt độ 3 pha ────────────────────────────────
    private static async Task SeedTemperatureRulesAsync(AppDbContext db)
    {
        if (await db.Rules.AnyAsync(r => r.Name.StartsWith("Nhiệt độ"))) return;

        var station = await db.Stations.FirstOrDefaultAsync();
        if (station == null) return;

        var phases = new[]
        {
            ("nhiet_do_pha_1", "Pha 1"),
            ("nhiet_do_pha_2", "Pha 2"),
            ("nhiet_do_pha_3", "Pha 3"),
        };

        foreach (var (pointId, label) in phases)
        {
            // Warning ≥50°C: kiểm tra, lên lịch bảo trì 30 ngày
            db.Rules.Add(new StationOS.Data.Entities.Rule
            {
                StationId = station.Id,
                Name      = $"Nhiệt độ {label} — Kiểm tra (≥50°C)",
                RuleSet   = "Tủ 471",
                Condition = System.Text.Json.JsonSerializer.Serialize(
                    new { point = pointId, op = ">=", value = 50, clearValue = 47 }),
                Actions   = """[{"type":"alert","level":"warning"},{"type":"maintenance","taskType":"inspection","scheduledInDays":30}]""",
                Enabled   = true,
            });

            // Alarm ≥65°C: nguy hiểm, sửa trong 3 ngày
            db.Rules.Add(new StationOS.Data.Entities.Rule
            {
                StationId = station.Id,
                Name      = $"Nhiệt độ {label} — Nguy hiểm (≥65°C)",
                RuleSet   = "Tủ 471",
                Condition = System.Text.Json.JsonSerializer.Serialize(
                    new { point = pointId, op = ">=", value = 65, clearValue = 62 }),
                Actions   = """[{"type":"alert","level":"alarm"},{"type":"maintenance","taskType":"repair","scheduledInDays":3}]""",
                Enabled   = true,
            });
        }
        await db.SaveChangesAsync();
        Console.WriteLine("[Startup] Đã seed 6 rules nhiệt độ 3 pha (50°C warning, 65°C alarm)");
    }

    // ── Fix go2rtc_id sai cho Camera 153 (chạy 1 lần) ──────────
    private static async Task FixCamera153Go2rtcIdAsync(AppDbContext db)
    {
        var allPdCams = await db.Devices
            .Where(d => d.Type == "camera_pd")
            .ToListAsync();

        var cams = allPdCams
            .Where(d => d.Config != null && d.Config.Contains("hikvision_main"))
            .ToList();

        foreach (var cam in cams)
        {
            try
            {
                var cfg = System.Text.Json.JsonSerializer.Deserialize<Dictionary<string, object>>(cam.Config!)!;
                cfg["go2rtc_id"] = "camera_153_pd";
                cam.Config = System.Text.Json.JsonSerializer.Serialize(cfg);
                Console.WriteLine($"[Startup] Fixed {cam.Name}: go2rtc_id hikvision_main → camera_153_pd");
            }
            catch { }
        }

        if (cams.Count > 0)
            await db.SaveChangesAsync();
    }

    // ── Đổi tên PLC thành "Tủ 471" (chạy 1 lần) ────────────────
    private static async Task FixPlcNameAsync(AppDbContext db)
    {
        var oldNames = new[] { "PLC S7-1200 – Cảm biến nhiệt & PD", "PLC S7-1200 — Tủ 471" };
        var plc = await db.Devices
            .FirstOrDefaultAsync(d => d.Type == "plc_s7" && oldNames.Contains(d.Name));
        if (plc == null) return;

        plc.Name = "Tủ 471";
        await db.SaveChangesAsync();
        Console.WriteLine($"[Startup] Đã đổi tên PLC → \"Tủ 471\"");
    }

    private static async Task FixUngroupedRulesAsync(AppDbContext db)
    {
        var oldNames = new[] { (string?)null, "Tủ 471 — CBM", "Tủ 471 - CBM", "Tu 471" };
        var toFix = await db.Rules.Where(r => oldNames.Contains(r.RuleSet)).ToListAsync();
        if (toFix.Count == 0) return;

        foreach (var r in toFix) r.RuleSet = "Tủ 471";
        await db.SaveChangesAsync();
        Console.WriteLine($"[Startup] Normalized RuleSet cho {toFix.Count} rule → \"Tủ 471\"");
    }

    // ── Seed 20 rules nhiệt độ cho Camera 152 (P1 -> P20) ─────
    private static async Task SeedThermalPointsRulesAsync(AppDbContext db)
    {
        if (await db.Rules.AnyAsync(r => r.RuleSet == "Các điểm đo của cam nhiệt")) return;

        var station = await db.Stations.FirstOrDefaultAsync();
        if (station == null) return;

        var thermalCam = await db.Devices.FirstOrDefaultAsync(d => d.Type == "camera_dual");

        for (int i = 1; i <= 20; i++)
        {
            db.Rules.Add(new StationOS.Data.Entities.Rule
            {
                StationId = station.Id,
                DeviceId  = thermalCam?.Id,
                Name      = $"Cảnh báo điểm P{i}",
                RuleSet   = "Các điểm đo của cam nhiệt",
                Condition = System.Text.Json.JsonSerializer.Serialize(new { 
                    point = $"P{i}", 
                    op = ">=", 
                    pre_alarm = 50, 
                    alarm = 70,
                    type = "analog"
                }),
                Actions   = """[{"type":"alert","level":"hybrid"}]""",
                Enabled   = true,
            });
        }
        await db.SaveChangesAsync();
        Console.WriteLine("[Startup] Đã seed 20 rules nhiệt độ camera (P1-P20)");
    }

    // Tự động tạo database PostgreSQL nếu chưa tồn tại
    private static async Task EnsureDatabaseCreatedAsync(IConfiguration config)
    {
        var connStr = config.GetConnectionString("Default");
        if (string.IsNullOrEmpty(connStr)) return;

        var builder = new NpgsqlConnectionStringBuilder(connStr);
        var dbName  = builder.Database;
        if (string.IsNullOrEmpty(dbName)) return;

        // Kết nối vào database mặc định "postgres" để tạo database mới
        builder.Database = "postgres";
        try
        {
            await using var conn = new NpgsqlConnection(builder.ConnectionString);
            await conn.OpenAsync();
            await using var cmd = conn.CreateCommand();
            cmd.CommandText = $"SELECT 1 FROM pg_database WHERE datname = '{dbName}'";
            var exists = await cmd.ExecuteScalarAsync();
            if (exists == null)
            {
                cmd.CommandText = $"CREATE DATABASE \"{dbName}\"";
                await cmd.ExecuteNonQueryAsync();
                Console.WriteLine($"[Startup] Đã tạo database '{dbName}'");
            }
        }
        catch (Exception ex)
        {
            Console.WriteLine($"[Startup] Không thể tự tạo database (bỏ qua): {ex.Message}");
        }
    }
}

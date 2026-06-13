using System.Net.Http.Headers;
using System.Text.Json;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using Microsoft.EntityFrameworkCore;
using StationOS.Data;
using StationOS.Data.Entities;
using StationOS.Services;

namespace StationOS.Api.Controllers;

[ApiController]
[Route("api/v1/stations")]
[Authorize]
public class StationsController : ControllerBase
{
    private readonly AppDbContext _db;
    private readonly PermissionService _permissions;
    private readonly IHttpClientFactory _httpClientFactory;
    public StationsController(AppDbContext db, PermissionService permissions, IHttpClientFactory httpClientFactory)
    {
        _db = db;
        _permissions = permissions;
        _httpClientFactory = httpClientFactory;
    }

    /// <summary>Lấy danh sách trạm biến áp. Operator chỉ thấy trạm được phân quyền.</summary>
    /// <returns>Danh sách trạm (id, name, code, location, status, createdAt).</returns>
    [HttpGet]
    public async Task<IActionResult> GetAll()
    {
        var allowed = await _permissions.GetAllowedStationIdsAsync();
        var q = _db.Stations.AsQueryable();
        if (allowed != null) q = q.Where(s => allowed.Contains(s.Id));

        var stations = await q
            .OrderBy(s => s.Name)
            .Select(s => new {
                s.Id, s.Name, s.Code, s.Location, s.Status, s.CreatedAt, s.ApiUrl
            }).ToListAsync();

        var stationIds = stations.Select(s => s.Id).ToList();
        var lastSensorByStation = await _db.SensorReadings
            .Where(x => stationIds.Contains(x.StationId))
            .GroupBy(x => x.StationId)
            .Select(g => new { StationId = g.Key, LastSeenAt = (DateTime?)g.Max(x => x.Time) })
            .ToDictionaryAsync(x => x.StationId, x => x.LastSeenAt);

        var lastAlertByStation = await _db.Alerts
            .Where(x => stationIds.Contains(x.StationId))
            .GroupBy(x => x.StationId)
            .Select(g => new { StationId = g.Key, LastSeenAt = (DateTime?)g.Max(x => x.TriggeredAt) })
            .ToDictionaryAsync(x => x.StationId, x => x.LastSeenAt);

        var lastEventByStation = await _db.DetectionEvents
            .Where(x => stationIds.Contains(x.StationId))
            .GroupBy(x => x.StationId)
            .Select(g => new { StationId = g.Key, LastSeenAt = (DateTime?)g.Max(x => x.DetectedAt) })
            .ToDictionaryAsync(x => x.StationId, x => x.LastSeenAt);

        var threshold = DateTime.UtcNow.AddMinutes(-2);

        return Ok(stations.Select(s =>
        {
            var lastSeenAt = new[]
            {
                lastSensorByStation.GetValueOrDefault(s.Id),
                lastAlertByStation.GetValueOrDefault(s.Id),
                lastEventByStation.GetValueOrDefault(s.Id)
            }.Max();

            var connectionStatus = string.IsNullOrWhiteSpace(s.ApiUrl)
                ? "unknown"
                : lastSeenAt.HasValue && lastSeenAt.Value >= threshold
                    ? "online"
                    : "offline";

            return new
            {
                s.Id,
                s.Name,
                s.Code,
                s.Location,
                s.Status,
                s.CreatedAt,
                s.ApiUrl,
                connectionStatus,
                lastSeenAt
            };
        }));
    }

    /// <summary>Lấy chi tiết 1 trạm theo ID.</summary>
    /// <param name="id">Station ID.</param>
    /// <returns>Đối tượng Station hoặc 404.</returns>
    [HttpGet("{id}")]
    public async Task<IActionResult> GetById(Guid id)
    {
        var s = await _db.Stations.FindAsync(id);
        if (s == null) return NotFound();
        return Ok(s);
    }

    /// <summary>Tạo trạm mới. Chỉ admin.</summary>
    /// <param name="req">Thông tin trạm (name, code, location).</param>
    /// <returns>Station vừa tạo với status 201 Created.</returns>
    [HttpPost]
    [Authorize(Roles = "admin")]
    public async Task<IActionResult> Create([FromBody] StationRequest req)
    {
        var station = new Station
        {
            Name     = req.Name,
            Code     = req.Code,
            Location = req.Location,
            ApiUrl   = req.ApiUrl,
            Status   = "active"
        };
        _db.Stations.Add(station);
        await _db.SaveChangesAsync();
        return CreatedAtAction(nameof(GetById), new { id = station.Id }, station);
    }

    /// <summary>Cập nhật thông tin trạm. Chỉ admin.</summary>
    /// <param name="id">Station ID.</param>
    /// <param name="req">Thông tin cần cập nhật.</param>
    /// <returns>Station đã cập nhật.</returns>
    [HttpPut("{id}")]
    [Authorize(Roles = "admin")]
    public async Task<IActionResult> Update(Guid id, [FromBody] StationRequest req)
    {
        var station = await _db.Stations.FindAsync(id);
        if (station == null) return NotFound();

        station.Name     = req.Name;
        station.Code     = req.Code;
        station.Location = req.Location;
        station.ApiUrl   = req.ApiUrl;
        if (!string.IsNullOrWhiteSpace(req.Status))
            station.Status = req.Status;

        await _db.SaveChangesAsync();
        return Ok(station);
    }

    /// <summary>Xóa trạm. Chỉ admin, và chỉ khi trạm không còn thiết bị nào.</summary>
    /// <param name="id">Station ID.</param>
    /// <returns>204 NoContent hoặc 400 nếu còn thiết bị.</returns>
    [HttpDelete("{id}")]
    [Authorize(Roles = "admin")]
    public async Task<IActionResult> Delete(Guid id)
    {
        var station = await _db.Stations.FindAsync(id);
        if (station == null) return NotFound();

        // Kiểm tra xem có thiết bị nào thuộc trạm này không
        var hasDevices = await _db.Devices.AnyAsync(d => d.StationId == id);
        if (hasDevices)
            return BadRequest(new { message = "Không thể xóa trạm đang có thiết bị. Xóa thiết bị trước." });

        _db.Stations.Remove(station);
        await _db.SaveChangesAsync();
        return NoContent();
    }

    /// <summary>Lấy KPI thực từ trạm con (devices, alerts).</summary>
    [HttpGet("{id}/remote-kpi")]
    public async Task<IActionResult> GetRemoteKpi(Guid id)
    {
        var station = await _db.Stations.FindAsync(id);
        if (station == null || string.IsNullOrWhiteSpace(station.ApiUrl))
            return Ok(new { devicesOnline = 0, devicesTotal = 0, alertsCount = 0, error = "no_url" });

        var apiBase = station.ApiUrl.TrimEnd('/');
        var opts = new JsonSerializerOptions { PropertyNameCaseInsensitive = true };

        try
        {
            // 1. Login vào trạm con
            var loginClient = _httpClientFactory.CreateClient("station-ping");
            var loginBody = JsonContent.Create(new { username = "admin", password = "Admin@123" });
            var loginRes = await loginClient.PostAsync($"{apiBase}/api/v1/auth/login", loginBody);
            if (!loginRes.IsSuccessStatusCode)
                return Ok(new { devicesOnline = 0, devicesTotal = 0, alertsCount = 0, error = "auth_failed" });

            var loginJson = await loginRes.Content.ReadFromJsonAsync<JsonElement>();
            var token = loginJson.GetProperty("token").GetString();

            // 2. Dùng token gọi API trạm con
            using var client = new HttpClient { Timeout = TimeSpan.FromSeconds(8) };
            client.DefaultRequestHeaders.Authorization = new AuthenticationHeaderValue("Bearer", token);

            var devicesTask = client.GetAsync($"{apiBase}/api/v1/devices");
            var alertsTask  = client.GetAsync($"{apiBase}/api/v1/alerts?status=open&pageSize=200");
            await Task.WhenAll(devicesTask, alertsTask);

            int devicesTotal = 0, devicesOnline = 0, alertsCount = 0;

            if (devicesTask.Result.IsSuccessStatusCode)
            {
                var devJson = await devicesTask.Result.Content.ReadFromJsonAsync<JsonElement>();
                var arr = devJson.ValueKind == JsonValueKind.Array ? devJson
                        : devJson.TryGetProperty("items", out var items) ? items
                        : devJson.TryGetProperty("data",  out var data)  ? data
                        : default;
                if (arr.ValueKind == JsonValueKind.Array)
                {
                    devicesTotal = arr.GetArrayLength();
                    foreach (var d in arr.EnumerateArray())
                        if (d.TryGetProperty("status", out var s) && s.GetString() == "online")
                            devicesOnline++;
                }
            }

            if (alertsTask.Result.IsSuccessStatusCode)
            {
                var alJson = await alertsTask.Result.Content.ReadFromJsonAsync<JsonElement>();
                var arr = alJson.ValueKind == JsonValueKind.Array ? alJson
                        : alJson.TryGetProperty("items", out var items) ? items
                        : alJson.TryGetProperty("data",  out var data)  ? data
                        : default;
                if (arr.ValueKind == JsonValueKind.Array)
                    alertsCount = arr.GetArrayLength();
            }

            return Ok(new { devicesOnline, devicesTotal, alertsCount });
        }
        catch (Exception ex)
        {
            return Ok(new { devicesOnline = 0, devicesTotal = 0, alertsCount = 0, error = ex.Message });
        }
    }

    /// <summary>Kiểm tra kết nối tới trạm con qua ApiUrl.</summary>
    [HttpPost("test-connection")]
    [Authorize(Roles = "admin")]
    public async Task<IActionResult> TestConnection([FromBody] StationPingRequest req)
    {
        if (string.IsNullOrWhiteSpace(req.Url))
            return BadRequest(new { reachable = false, error = "URL không được để trống" });

        var url = req.Url.TrimEnd('/');
        var sw = System.Diagnostics.Stopwatch.StartNew();
        try
        {
            var client = _httpClientFactory.CreateClient("station-ping");
            var res = await client.GetAsync(url);
            sw.Stop();
            if (res.IsSuccessStatusCode)
                return Ok(new { reachable = true, responseMs = sw.ElapsedMilliseconds });

            return Ok(new { reachable = false, responseMs = sw.ElapsedMilliseconds, error = $"HTTP {(int)res.StatusCode}" });
        }
        catch (Exception ex)
        {
            sw.Stop();
            return Ok(new { reachable = false, responseMs = sw.ElapsedMilliseconds, error = ex.Message });
        }
    }
}

public record StationRequest(string Name, string? Code, string? Location, string? Status, string? ApiUrl);
public record StationPingRequest(string Url);

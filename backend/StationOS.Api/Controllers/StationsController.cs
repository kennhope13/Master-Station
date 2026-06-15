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
                s.Id, s.Name, s.Code, s.Location, s.Status, s.CreatedAt, s.ApiUrl, s.WebUrl, s.LastContactAt
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

        var threshold = DateTime.UtcNow.AddMinutes(-5);

        return Ok(stations.Select(s =>
        {
            var lastSeenAt = new[]
            {
                lastSensorByStation.GetValueOrDefault(s.Id),
                lastAlertByStation.GetValueOrDefault(s.Id),
                lastEventByStation.GetValueOrDefault(s.Id),
                s.LastContactAt
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
                webUrl = s.WebUrl ?? DeriveWebUrl(s.ApiUrl),
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
            WebUrl   = req.WebUrl,
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
        station.WebUrl   = req.WebUrl;
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

    private static readonly System.Collections.Concurrent.ConcurrentDictionary<Guid, (string Token, DateTime ExpiresAt)> _tokenCache = new();

    private async Task<string?> GetOrFetchTokenAsync(Guid stationId, string apiBase, bool forceRefresh = false)
    {
        if (!forceRefresh && _tokenCache.TryGetValue(stationId, out var cached) && cached.ExpiresAt > DateTime.UtcNow)
        {
            return cached.Token;
        }

        try
        {
            var loginClient = _httpClientFactory.CreateClient("station-ping");
            var loginBody = JsonContent.Create(new { username = "admin", password = "Admin@123" });
            var loginRes = await loginClient.PostAsync($"{apiBase}/api/v1/auth/login", loginBody);
            if (!loginRes.IsSuccessStatusCode)
                return null;

            var loginJson = await loginRes.Content.ReadFromJsonAsync<JsonElement>();
            if (loginJson.TryGetProperty("token", out var tokenProp))
            {
                var token = tokenProp.GetString();
                if (!string.IsNullOrEmpty(token))
                {
                    _tokenCache[stationId] = (token, DateTime.UtcNow.AddMinutes(30));
                    return token;
                }
            }
        }
        catch (Exception ex)
        {
            System.Console.WriteLine($"[StationsController] Error authenticating with child station {stationId}: {ex.Message}");
        }

        return null;
    }

    /// <summary>Lấy KPI thực từ trạm con (devices, alerts, points, health).</summary>
    [HttpGet("{id}/remote-kpi")]
    public async Task<IActionResult> GetRemoteKpi(Guid id)
    {
        var station = await _db.Stations.FindAsync(id);
        if (station == null || string.IsNullOrWhiteSpace(station.ApiUrl))
            return Ok(new { devicesOnline = 0, devicesTotal = 0, alertsCount = 0, points = Array.Empty<object>(), healthScores = Array.Empty<object>(), go2rtcBase = (string?)null, rtspBase = (string?)null, webUiUrl = (string?)null, error = "no_url" });

        var apiBase    = station.ApiUrl.TrimEnd('/');
        var apiUri     = new Uri(apiBase);
        var go2rtcBase = $"{apiUri.Scheme}://{apiUri.Host}:1984";
        var rtspBase   = $"rtsp://{apiUri.Host}:8554";
        var webUiUrl   = $"{apiUri.Scheme}://{apiUri.Host}:4173";

        try
        {
            // 1. Lấy token từ cache hoặc login
            var token = await GetOrFetchTokenAsync(id, apiBase);
            if (string.IsNullOrEmpty(token))
                return Ok(new { devicesOnline = 0, devicesTotal = 0, alertsCount = 0, points = Array.Empty<object>(), healthScores = Array.Empty<object>(), go2rtcBase, rtspBase, webUiUrl, error = "auth_failed" });

            // Ghi nhận lần kết nối thành công
            station.LastContactAt = DateTime.UtcNow;
            await _db.SaveChangesAsync();

            // 2. Gọi song song 4 endpoint trạm con
            using var client = new HttpClient { Timeout = TimeSpan.FromSeconds(10) };
            client.DefaultRequestHeaders.Authorization = new AuthenticationHeaderValue("Bearer", token);

            var devicesTask = client.GetAsync($"{apiBase}/api/v1/devices");
            var alertsTask  = client.GetAsync($"{apiBase}/api/v1/alerts?status=open&pageSize=200");
            var pointsTask  = client.GetAsync($"{apiBase}/api/v1/points");
            var healthTask  = client.GetAsync($"{apiBase}/api/v1/analytics/health");
            await Task.WhenAll(devicesTask, alertsTask, pointsTask, healthTask);

            // Nếu nhận được 401 Unauthorized từ bất kỳ endpoint nào, có thể token đã hết hạn sớm ở trạm con.
            // Thử login lại 1 lần duy nhất.
            if (devicesTask.Result.StatusCode == System.Net.HttpStatusCode.Unauthorized ||
                alertsTask.Result.StatusCode == System.Net.HttpStatusCode.Unauthorized ||
                pointsTask.Result.StatusCode == System.Net.HttpStatusCode.Unauthorized ||
                healthTask.Result.StatusCode == System.Net.HttpStatusCode.Unauthorized)
            {
                token = await GetOrFetchTokenAsync(id, apiBase, forceRefresh: true);
                if (string.IsNullOrEmpty(token))
                    return Ok(new { devicesOnline = 0, devicesTotal = 0, alertsCount = 0, points = Array.Empty<object>(), healthScores = Array.Empty<object>(), go2rtcBase, rtspBase, webUiUrl, error = "auth_failed" });

                client.DefaultRequestHeaders.Authorization = new AuthenticationHeaderValue("Bearer", token);
                devicesTask = client.GetAsync($"{apiBase}/api/v1/devices");
                alertsTask  = client.GetAsync($"{apiBase}/api/v1/alerts?status=open&pageSize=200");
                pointsTask  = client.GetAsync($"{apiBase}/api/v1/points");
                healthTask  = client.GetAsync($"{apiBase}/api/v1/analytics/health");
                await Task.WhenAll(devicesTask, alertsTask, pointsTask, healthTask);
            }

            int devicesTotal = 0, devicesOnline = 0, alertsCount = 0;
            var pointsList  = new List<object>();
            var healthList  = new List<object>();

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

            if (pointsTask.Result.IsSuccessStatusCode)
            {
                var ptJson = await pointsTask.Result.Content.ReadFromJsonAsync<JsonElement>();
                if (ptJson.ValueKind == JsonValueKind.Array)
                    foreach (var p in ptJson.EnumerateArray())
                        pointsList.Add(p);
            }

            if (healthTask.Result.IsSuccessStatusCode)
            {
                var hlJson = await healthTask.Result.Content.ReadFromJsonAsync<JsonElement>();
                if (hlJson.ValueKind == JsonValueKind.Array)
                    foreach (var h in hlJson.EnumerateArray())
                        healthList.Add(h);
            }

            return Ok(new { devicesOnline, devicesTotal, alertsCount, points = pointsList, healthScores = healthList, go2rtcBase, rtspBase, webUiUrl });
        }
        catch (Exception ex)
        {
            return Ok(new { devicesOnline = 0, devicesTotal = 0, alertsCount = 0, points = Array.Empty<object>(), healthScores = Array.Empty<object>(), go2rtcBase, rtspBase, webUiUrl, error = ex.Message });
        }
    }

    /// <summary>
    /// Lấy danh sách camera từ trạm con + URL stream go2rtc của trạm con.
    /// go2rtc của trạm con chạy port 1984 (WebRTC/HLS) và 8554 (RTSP).
    /// </summary>
    [HttpGet("{id}/remote-cameras")]
    public async Task<IActionResult> GetRemoteCameras(Guid id)
    {
        var station = await _db.Stations.FindAsync(id);
        if (station == null || string.IsNullOrWhiteSpace(station.ApiUrl))
            return Ok(new { go2rtcBase = (string?)null, rtspBase = (string?)null, cameras = Array.Empty<object>() });

        var apiBase = station.ApiUrl.TrimEnd('/');

        // Derive go2rtc URLs từ host của apiUrl (theo tài liệu trạm con: port 1984 WebRTC, 8554 RTSP)
        var uri       = new Uri(apiBase);
        var go2rtcBase = $"{uri.Scheme}://{uri.Host}:1984";
        var rtspBase   = $"rtsp://{uri.Host}:8554";

        try
        {
            var token = await GetOrFetchTokenAsync(id, apiBase);
            if (string.IsNullOrEmpty(token))
                return Ok(new { go2rtcBase, rtspBase, cameras = Array.Empty<object>() });

            // Ghi nhận lần kết nối thành công
            station.LastContactAt = DateTime.UtcNow;
            await _db.SaveChangesAsync();

            using var client = new HttpClient { Timeout = TimeSpan.FromSeconds(10) };
            client.DefaultRequestHeaders.Authorization = new AuthenticationHeaderValue("Bearer", token);

            // Lấy tất cả devices vì filter type=camera không đồng nhất giữa các phiên bản trạm con
            var res = await client.GetAsync($"{apiBase}/api/v1/devices");
            if (res.StatusCode == System.Net.HttpStatusCode.Unauthorized)
            {
                token = await GetOrFetchTokenAsync(id, apiBase, forceRefresh: true);
                if (string.IsNullOrEmpty(token))
                    return Ok(new { go2rtcBase, rtspBase, cameras = Array.Empty<object>() });

                client.DefaultRequestHeaders.Authorization = new AuthenticationHeaderValue("Bearer", token);
                res = await client.GetAsync($"{apiBase}/api/v1/devices");
            }

            if (!res.IsSuccessStatusCode)
                return Ok(new { go2rtcBase, rtspBase, cameras = Array.Empty<object>() });

            var json = await res.Content.ReadFromJsonAsync<JsonElement>();
            var all = json.ValueKind == JsonValueKind.Array ? json
                    : json.TryGetProperty("items", out var items) ? items
                    : json.TryGetProperty("data",  out var data)  ? data
                    : default;

            // Lọc chỉ lấy camera (type bắt đầu bằng "camera")
            var arr = all.ValueKind == JsonValueKind.Array
                ? (IEnumerable<JsonElement>)all.EnumerateArray()
                    .Where(d => d.TryGetProperty("type", out var t) && t.GetString()?.StartsWith("camera") == true)
                : Enumerable.Empty<JsonElement>();

            // Enrich mỗi camera với stream URLs từ go2rtc của trạm con
            var cameras = new List<object>();
            foreach (var d in arr)
            {
                // Parse config để lấy tên stream go2rtc
                string? go2rtcOptical = null, go2rtcThermal = null, go2rtcId = null;
                if (d.TryGetProperty("config", out var cfgEl))
                {
                    try
                    {
                        var cfgStr = cfgEl.ValueKind == JsonValueKind.String
                            ? cfgEl.GetString()
                            : cfgEl.GetRawText();
                        var cfg = JsonSerializer.Deserialize<JsonElement>(cfgStr ?? "{}");
                        if (cfg.TryGetProperty("go2rtc_optical", out var vo)) go2rtcOptical = vo.GetString();
                        if (cfg.TryGetProperty("go2rtc_thermal", out var vt)) go2rtcThermal = vt.GetString();
                        if (cfg.TryGetProperty("go2rtc_id",      out var vi)) go2rtcId      = vi.GetString();
                    }
                    catch { }
                }

                // Xây dựng streamUrls cho từng camera
                var streamUrls = new Dictionary<string, string>();
                if (!string.IsNullOrEmpty(go2rtcOptical))
                {
                    streamUrls["optical_webrtc"] = $"{go2rtcBase}/api/ws?src={go2rtcOptical}";
                    streamUrls["optical_hls"]    = $"{go2rtcBase}/api/stream.m3u8?src={go2rtcOptical}";
                    streamUrls["optical_rtsp"]   = $"{rtspBase}/{go2rtcOptical}";
                }
                if (!string.IsNullOrEmpty(go2rtcThermal))
                {
                    streamUrls["thermal_webrtc"] = $"{go2rtcBase}/api/ws?src={go2rtcThermal}";
                    streamUrls["thermal_hls"]    = $"{go2rtcBase}/api/stream.m3u8?src={go2rtcThermal}";
                    streamUrls["thermal_rtsp"]   = $"{rtspBase}/{go2rtcThermal}";
                }
                if (!string.IsNullOrEmpty(go2rtcId))
                {
                    streamUrls["main_webrtc"] = $"{go2rtcBase}/api/ws?src={go2rtcId}";
                    streamUrls["main_hls"]    = $"{go2rtcBase}/api/stream.m3u8?src={go2rtcId}";
                    streamUrls["main_rtsp"]   = $"{rtspBase}/{go2rtcId}";
                }

                cameras.Add(new { device = d, streamUrls, go2rtcBase, rtspBase });
            }

            return Ok(new { go2rtcBase, rtspBase, cameras });
        }
        catch
        {
            return Ok(new { go2rtcBase, rtspBase, cameras = Array.Empty<object>() });
        }
    }

    /// <summary>Lấy JWT token từ trạm con để SSO (trạm tổng không cần login lại).</summary>
    [HttpGet("{id}/remote-token")]
    public async Task<IActionResult> GetRemoteToken(Guid id)
    {
        var station = await _db.Stations.FindAsync(id);
        if (station == null || string.IsNullOrWhiteSpace(station.ApiUrl))
            return NotFound(new { error = "no_url" });

        var apiBase = station.ApiUrl.TrimEnd('/');
        try
        {
            var token = await GetOrFetchTokenAsync(station.Id, apiBase);
            if (string.IsNullOrEmpty(token))
                return BadRequest(new { error = "auth_failed" });
            return Ok(new { token });
        }
        catch (Exception ex)
        {
            return BadRequest(new { error = ex.Message });
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

    /// <summary>Tự động suy URL giao diện web từ URL API theo quy ước cổng.</summary>
    private static string? DeriveWebUrl(string? apiUrl)
    {
        if (string.IsNullOrWhiteSpace(apiUrl)) return null;
        try
        {
            var uri = new Uri(apiUrl.TrimEnd('/'));
            var newPort = uri.Port switch
            {
                5000 => 4173,   // child StationOS
                6000 => 6173,   // master StationOS
                _    => uri.Port
            };
            return $"{uri.Scheme}://{uri.Host}:{newPort}";
        }
        catch { return null; }
    }
}

public record StationRequest(string Name, string? Code, string? Location, string? Status, string? ApiUrl, string? WebUrl);
public record StationPingRequest(string Url);

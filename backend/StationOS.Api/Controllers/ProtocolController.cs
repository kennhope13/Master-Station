// ============================================================
// ProtocolController — API quản lý và khám phá protocol
// GET  /api/v1/protocols/discover?subnet=192.168.10&from=1&to=50
// GET  /api/v1/protocols/discover-onvif
// GET  /api/v1/protocols/scan?ip=192.168.10.10
// POST /api/v1/protocols/test-connection
// GET  /api/v1/protocols/serial-ports
// ============================================================

using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using StationOS.Services;
using StationOS.Api.Filters;

namespace StationOS.Api.Controllers;

[ApiController]
[Route("api/v1/protocols")]
[HasPermission("device:manage")]
public class ProtocolController : ControllerBase
{
    private readonly AutoDiscoveryService        _discovery;
    private readonly ProtocolConnectionTester    _tester;
    private readonly ILogger<ProtocolController> _logger;

    public ProtocolController(
        AutoDiscoveryService        discovery,
        ProtocolConnectionTester    tester,
        ILogger<ProtocolController> logger)
    {
        _discovery = discovery;
        _tester    = tester;
        _logger    = logger;
    }

    // ── Discovery ─────────────────────────────────────────────

    /// <summary>Quét toàn bộ subnet để tìm thiết bị.</summary>
    [HttpGet("discover")]
    public async Task<IActionResult> DiscoverSubnet(
        [FromQuery] string subnet = "192.168.10",
        [FromQuery] int    from   = 1,
        [FromQuery] int    to     = 50,
        CancellationToken ct     = default)
    {
        if (to - from > 254) return BadRequest("Range quá lớn (tối đa 254 host)");
        _logger.LogInformation("[Protocol] Scan subnet {Subnet}.{From}-{To}", subnet, from, to);
        var results = await _discovery.ScanSubnetAsync(subnet, from, to, ct);
        return Ok(results);
    }

    /// <summary>Phát hiện camera ONVIF qua WS-Discovery multicast.</summary>
    [HttpGet("discover-onvif")]
    [AllowAnonymous]
    public async Task<IActionResult> DiscoverOnvif(CancellationToken ct)
    {
        var results = await _discovery.DiscoverOnvifAsync(timeoutMs: 4000);
        return Ok(results);
    }

    /// <summary>Quét một địa chỉ IP cụ thể.</summary>
    [HttpGet("scan")]
    public async Task<IActionResult> ScanSingle([FromQuery] string ip, CancellationToken ct)
    {
        if (string.IsNullOrWhiteSpace(ip)) return BadRequest("Cần truyền ip");
        var results = await _discovery.ScanSingleAsync(ip, ct);
        return Ok(results);
    }

    // ── Connection Test ───────────────────────────────────────

    /// <summary>
    /// Test kết nối tới thiết bị — KHÔNG ghi vào database.
    /// Body: { "protocol": "modbus_tcp", "config": "{\"ip\":\"...\",\"port\":502}" }
    /// </summary>
    [HttpPost("test-connection")]
    [AllowAnonymous]
    public async Task<IActionResult> TestConnection(
        [FromBody] TestConnectionRequest req,
        CancellationToken ct)
    {
        if (string.IsNullOrWhiteSpace(req.Protocol))
            return BadRequest("Thiếu field 'protocol'");

        _logger.LogInformation("[Protocol] Test connection: {Protocol} → {Config}",
            req.Protocol, req.Config);

        var result = await _tester.TestAsync(req.Protocol, req.Config ?? "{}", ct);
        return Ok(result);
    }

    // ── Utilities ─────────────────────────────────────────────

    /// <summary>Danh sách cổng serial khả dụng trên máy chủ.</summary>
    [HttpGet("serial-ports")]
    public IActionResult GetSerialPorts()
    {
        var ports = System.IO.Ports.SerialPort.GetPortNames();
        return Ok(new { ports });
    }
}

public class TestConnectionRequest
{
    public string  Protocol { get; set; } = "";
    public string? Config   { get; set; }
}

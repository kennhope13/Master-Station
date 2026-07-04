// ============================================================
// LicenseController — Quản lý license key
// GET  /api/v1/license/status   — public, trả về trạng thái
// POST /api/v1/license/activate — yêu cầu admin JWT
// POST /api/v1/license/clear     — xóa license hiện tại
// POST /api/v1/license/validate — public, kiểm tra key (không kích hoạt)
// GET  /api/v1/license/limits   — public, trả về resource usage vs limits
// GET  /api/v1/license/request  — xuất .licreq
// POST /api/v1/license/import   — nhập .lic
// ============================================================

using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using StationOS.Services;
using StationOS.Api.Filters;
using System.Net.NetworkInformation;
using System.Runtime.InteropServices;
using System.Security.Cryptography;
using System.Text;

namespace StationOS.Api.Controllers;

[ApiController]
[Route("api/v1/license")]
public class LicenseController : ControllerBase
{
    private readonly LicenseService _license;

    public LicenseController(LicenseService license) => _license = license;

    /// <summary>Lấy trạng thái license hiện tại: tier, giới hạn tài nguyên, ngày hết hạn, số phiên đang hoạt động.</summary>
    /// <returns>Thông tin license đang kích hoạt hoặc activated = false nếu chưa kích hoạt.</returns>
    [HttpGet("status")]
    public async Task<IActionResult> Status()
    {
        var status = await _license.GetStatusAsync();
        if (status == null)
        {
            return Ok(new
            {
                activated     = false,
                tier          = "",
                maxUsers      = 0,
                maxStations   = 0,
                maxCameras    = 0,
                maxRoiPoints  = 0,
                maxRoiRegions = 0,
                maxPdRegions  = 0,
                expiresAt     = (DateTime?)null,
                activatedAt   = (DateTime?)null,
                activeSessions = 0,
                isValid       = false,
                daysRemaining = 0
            });
        }

        return Ok(new
        {
            activated      = true,
            tier           = status.Tier,
            maxUsers       = status.MaxUsers,
            maxStations    = status.MaxStations,
            maxCameras     = status.MaxCameras,
            maxRoiPoints   = status.MaxRoiPoints,
            maxRoiRegions  = status.MaxRoiRegions,
            maxPdRegions   = status.MaxPdRegions,
            expiresAt      = status.ExpiresAt,
            activatedAt    = status.ActivatedAt,
            activeSessions = status.ActiveSessions,
            isValid        = status.IsValid,
            daysRemaining  = (int)(status.ExpiresAt - DateTime.UtcNow).TotalDays
        });
    }

    /// <summary>Kích hoạt license key cho hệ thống. Yêu cầu quyền admin.</summary>
    /// <param name="req">License key cần kích hoạt.</param>
    /// <returns>Thông báo kích hoạt thành công hoặc lỗi nếu key không hợp lệ.</returns>
    [HasPermission("license:manage")]
    [HttpPost("activate")]
    public async Task<IActionResult> Activate([FromBody] LicenseKeyRequest req)
    {
        if (string.IsNullOrWhiteSpace(req.Key))
            return BadRequest(new { message = "Thiếu license key" });

        var (success, error) = await _license.ActivateAsync(req.Key);
        if (!success)
            return BadRequest(new { message = error });

        return Ok(new { message = "Kích hoạt license thành công" });
    }

    /// <summary>Xóa license hiện tại đang áp dụng trên app.</summary>
    [HasPermission("license:manage")]
    [HttpPost("clear")]
    public async Task<IActionResult> Clear()
    {
        var (success, error) = await _license.ClearCurrentLicenseAsync();
        if (!success)
            return BadRequest(new { message = error });

        return Ok(new { message = error });
    }

    /// <summary>Kiểm tra tính hợp lệ của license key mà không kích hoạt.</summary>
    /// <param name="req">License key cần kiểm tra.</param>
    /// <returns>Kết quả kiểm tra: valid, tier, tất cả giới hạn tài nguyên, ngày hết hạn.</returns>
    [HttpPost("validate")]
    public IActionResult Validate([FromBody] LicenseKeyRequest req)
    {
        var info = _license.ValidateKey(req.Key ?? "");
        if (!info.Valid)
            return BadRequest(new { valid = false, message = info.ErrorMessage });

        return Ok(new
        {
            valid          = true,
            tier           = info.Tier,
            maxUsers       = info.MaxUsers,
            maxStations    = info.MaxStations,
            maxCameras     = info.MaxCameras,
            maxRoiPoints   = info.MaxRoiPoints,
            maxRoiRegions  = info.MaxRoiRegions,
            maxPdRegions   = info.MaxPdRegions,
            expiresAt      = info.ExpiresAt,
            daysRemaining  = (int)(info.ExpiresAt - DateTime.UtcNow).TotalDays
        });
    }

    /// <summary>Trả về tổng quan sử dụng tài nguyên hiện tại so với giới hạn license.</summary>
    /// <returns>Danh sách từng loại tài nguyên: tên, current, max, exceeded.</returns>
    [HttpGet("limits")]
    public async Task<IActionResult> Limits()
    {
        var limits = await _license.GetAllResourceLimitsAsync();
        return Ok(limits.Select(l => new
        {
            resource = l.Resource,
            current  = l.Current,
            max      = l.Max >= 999 ? -1 : l.Max,   // -1 = unlimited
            exceeded = l.Exceeded
        }));
    }

    /// <summary>
    /// Xuất mã yêu cầu phần cứng để gửi nhà cung cấp tạo file .lic.
    /// Trả về request string ổn định theo máy hiện tại.
    /// </summary>
    [HttpGet("request")]
    public IActionResult Request()
    {
        return Ok(new
        {
            request = _license.GenerateRequestString(),
            fileName = "StationMonitor_Request.licreq"
        });
    }

    /// <summary>
    /// Nhập file .lic, ưu tiên lấy license key từ text/plain hoặc JSON đơn giản.
    /// </summary>
    [HttpPost("import")]
    public async Task<IActionResult> Import([FromForm] IFormFile file)
    {
        var result = await _license.ImportLicenseAsync(file);
        if (!result.Success)
            return BadRequest(new { message = result.Message });

        return Ok(new
        {
            message = result.Message,
            fileName = Path.GetFileName(result.SavedPath ?? file.FileName),
            kind = result.Document?.Kind.ToString().ToLowerInvariant() ?? "base"
        });
    }
}

public record LicenseKeyRequest(string? Key);

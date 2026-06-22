// ============================================================
// ProvincesController — Quản lý Tỉnh / Vùng
// Routes:
//   GET    /api/v1/provinces          — Danh sách tỉnh
//   GET    /api/v1/provinces/{id}     — Chi tiết tỉnh + danh sách trạm
//   POST   /api/v1/provinces          — Tạo tỉnh mới (admin only)
//   PUT    /api/v1/provinces/{id}     — Sửa thông tin tỉnh (admin only)
//   DELETE /api/v1/provinces/{id}     — Xóa tỉnh (admin only, chỉ khi không còn trạm)
// ============================================================

using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using Microsoft.EntityFrameworkCore;
using StationOS.Data;
using StationOS.Data.Entities;
using StationOS.Services;
using StationOS.Api.Filters;

namespace StationOS.Api.Controllers;

[ApiController]
[Route("api/v1/provinces")]
[Authorize]
public class ProvincesController : ControllerBase
{
    private readonly AppDbContext _db;
    private readonly PermissionService _permissions;
    private readonly IRealtimeNotifier _notifier;

    public ProvincesController(AppDbContext db, PermissionService permissions, IRealtimeNotifier notifier)
    {
        _db = db;
        _permissions = permissions;
        _notifier = notifier;
    }

    /// <summary>Danh sách tỉnh mà user hiện tại được phép xem.</summary>
    [HttpGet]
    public async Task<IActionResult> GetAll()
    {
        var allowedProvinceIds = await _permissions.GetAllowedProvinceIdsAsync();

        var query = _db.Provinces.AsNoTracking().OrderBy(p => p.Name);

        List<Province> provinces;
        if (allowedProvinceIds == null)
            provinces = await query.ToListAsync(); // Admin Toàn Cục — thấy tất cả
        else if (allowedProvinceIds.Length == 0)
            provinces = new List<Province>(); // không có quyền
        else
            provinces = await query.Where(p => allowedProvinceIds.Contains(p.Id)).ToListAsync();

        // Gắn thêm số trạm trong từng tỉnh
        var stationCounts = await _db.Stations
            .AsNoTracking()
            .Where(s => s.ProvinceId != null)
            .GroupBy(s => s.ProvinceId)
            .Select(g => new { ProvinceId = g.Key, Count = g.Count() })
            .ToListAsync();

        var result = provinces.Select(p => new
        {
            p.Id, p.Name, p.Code, p.Description, p.Status,
            stationCount = stationCounts.FirstOrDefault(x => x.ProvinceId == p.Id)?.Count ?? 0
        });

        return Ok(result);
    }

    /// <summary>Chi tiết tỉnh + danh sách các trạm thuộc tỉnh.</summary>
    [HttpGet("{id:guid}")]
    public async Task<IActionResult> GetById(Guid id)
    {
        var province = await _db.Provinces.FindAsync(id);
        if (province == null) return NotFound();

        // Kiểm tra quyền
        var allowedProvinceIds = await _permissions.GetAllowedProvinceIdsAsync();
        if (allowedProvinceIds != null && !allowedProvinceIds.Contains(id))
            return Forbid();

        var stations = await _db.Stations
            .AsNoTracking()
            .Where(s => s.ProvinceId == id)
            .Select(s => new { s.Id, s.Name, s.Code, s.Status, s.ApiUrl, s.LastContactAt })
            .ToListAsync();

        return Ok(new
        {
            province.Id, province.Name, province.Code,
            province.Description, province.Status,
            stations
        });
    }

    /// <summary>Tạo tỉnh mới. Chỉ Admin Toàn Cục.</summary>
    [HttpPost]
    [HasPermission("station:manage")]
    public async Task<IActionResult> Create([FromBody] CreateProvinceRequest req)
    {
        // Only global admin can create a province
        var allowedProvinceIds = await _permissions.GetAllowedProvinceIdsAsync();
        if (allowedProvinceIds != null)
        {
            return StatusCode(403, new { message = "Bạn không có quyền tạo tỉnh mới." });
        }
        if (string.IsNullOrWhiteSpace(req.Name))
            return BadRequest(new { message = "Tên tỉnh không được để trống" });

        var nameNorm = req.Name.Trim();
        var codeNorm = req.Code?.Trim().ToUpper();
        var exists = await _db.Provinces.AnyAsync(p =>
            p.Name == nameNorm || (codeNorm != null && p.Code == codeNorm));
        if (exists)
            return Conflict(new { message = "Tỉnh với tên hoặc mã này đã tồn tại." });

        var province = new Province
        {
            Name        = req.Name.Trim(),
            Code        = req.Code?.Trim().ToUpper(),
            Description = req.Description?.Trim(),
            Status      = "active"
        };

        _db.Provinces.Add(province);
        await _db.SaveChangesAsync();

        return Ok(province);
    }

    /// <summary>Sửa thông tin tỉnh. Chỉ Admin Toàn Cục.</summary>
    [HttpPut("{id:guid}")]
    [HasPermission("station:manage")]
    public async Task<IActionResult> Update(Guid id, [FromBody] UpdateProvinceRequest req)
    {
        // Only global admin can modify province details
        var allowedProvinceIds = await _permissions.GetAllowedProvinceIdsAsync();
        if (allowedProvinceIds != null)
        {
            return StatusCode(403, new { message = "Bạn không có quyền sửa tỉnh này." });
        }
        var province = await _db.Provinces.FindAsync(id);
        if (province == null) return NotFound();

        if (req.Name        != null) province.Name        = req.Name.Trim();
        if (req.Code        != null) province.Code        = req.Code.Trim().ToUpper();
        if (req.Description != null) province.Description = req.Description.Trim();
        if (req.Status      != null) province.Status      = req.Status;

        await _db.SaveChangesAsync();
        return Ok(province);
    }

    /// <summary>Xóa tỉnh. Chỉ Admin Toàn Cục, và chỉ khi không còn trạm nào.</summary>
    [HttpDelete("{id:guid}")]
    [HasPermission("station:manage")]
    public async Task<IActionResult> Delete(Guid id)
    {
        // Only global admin can delete a province
        var allowedProvinceIds = await _permissions.GetAllowedProvinceIdsAsync();
        if (allowedProvinceIds != null)
        {
            return StatusCode(403, new { message = "Bạn không có quyền xóa tỉnh này." });
        }
        var province = await _db.Provinces.FindAsync(id);
        if (province == null) return NotFound();

        var hasStations = await _db.Stations.AnyAsync(s => s.ProvinceId == id);
        if (hasStations)
            return BadRequest(new { message = "Không thể xóa tỉnh đang có trạm. Hãy gỡ các trạm ra khỏi tỉnh trước." });

        _db.Provinces.Remove(province);
        await _db.SaveChangesAsync();
        return NoContent();
    }

    /// <summary>Gán / thay đổi tỉnh cho một trạm. Chỉ Admin Toàn Cục.</summary>
    [HttpPost("{id:guid}/assign-station/{stationId:guid}")]
    [HasPermission("station:manage")]
    public async Task<IActionResult> AssignStation(Guid id, Guid stationId)
    {
        var allowedProvinceIds = await _permissions.GetAllowedProvinceIdsAsync();
        if (allowedProvinceIds != null)
        {
            if (!allowedProvinceIds.Contains(id))
            {
                return StatusCode(403, new { message = "Bạn không có quyền quản lý tỉnh này." });
            }
        }

        var province = await _db.Provinces.FindAsync(id);
        if (province == null) return NotFound(new { message = "Không tìm thấy tỉnh" });

        var station = await _db.Stations.FindAsync(stationId);
        if (station == null) return NotFound(new { message = "Không tìm thấy trạm" });

        if (allowedProvinceIds != null && station.ProvinceId != null && !allowedProvinceIds.Contains(station.ProvinceId.Value))
        {
            return StatusCode(403, new { message = "Bạn không có quyền chuyển trạm này từ tỉnh khác." });
        }

        station.ProvinceId = id;
        await _db.SaveChangesAsync();
        _ = _notifier.SendStationListChangedAsync("province_assigned", station.Id);

        return Ok(new { message = $"Đã gán trạm '{station.Name}' vào tỉnh '{province.Name}'" });
    }

    /// <summary>Gỡ trạm khỏi tỉnh. Chỉ Admin Toàn Cục.</summary>
    [HttpDelete("{id:guid}/assign-station/{stationId:guid}")]
    [HasPermission("station:manage")]
    public async Task<IActionResult> UnassignStation(Guid id, Guid stationId)
    {
        var allowedProvinceIds = await _permissions.GetAllowedProvinceIdsAsync();
        if (allowedProvinceIds != null)
        {
            if (!allowedProvinceIds.Contains(id))
            {
                return StatusCode(403, new { message = "Bạn không có quyền quản lý tỉnh này." });
            }
        }

        var station = await _db.Stations.FindAsync(stationId);
        if (station == null) return NotFound(new { message = "Không tìm thấy trạm" });

        if (station.ProvinceId != id)
            return BadRequest(new { message = "Trạm không thuộc tỉnh này" });

        station.ProvinceId = null;
        await _db.SaveChangesAsync();
        _ = _notifier.SendStationListChangedAsync("province_unassigned", station.Id);

        return Ok(new { message = $"Đã gỡ trạm '{station.Name}' khỏi tỉnh" });
    }
}

// ── Request Models ─────────────────────────────────────────
public record CreateProvinceRequest(string Name, string? Code, string? Description);
public record UpdateProvinceRequest(string? Name, string? Code, string? Description, string? Status);

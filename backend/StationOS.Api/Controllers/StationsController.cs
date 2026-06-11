// ============================================================
// StationsController — CRUD trạm biến áp
// GET    /api/v1/stations        — Danh sách trạm
// GET    /api/v1/stations/{id}   — Chi tiết 1 trạm
// POST   /api/v1/stations        — Tạo trạm mới (Admin)
// PUT    /api/v1/stations/{id}   — Cập nhật trạm (Admin)
// DELETE /api/v1/stations/{id}   — Xóa trạm (Admin)
// ============================================================

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
    public StationsController(AppDbContext db, PermissionService permissions)
    {
        _db = db;
        _permissions = permissions;
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
                s.Id, s.Name, s.Code, s.Location, s.Status, s.CreatedAt
            }).ToListAsync();
        return Ok(stations);
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
}

/// <summary>Request DTO cho tạo/cập nhật trạm.</summary>
/// <param name="Name">Tên trạm (bắt buộc).</param>
/// <param name="Code">Mã trạm.</param>
/// <param name="Location">Vị trí dạng JSON {"lat","lng","address"}.</param>
/// <param name="Status">Trạng thái: active | inactive | maintenance.</param>
/// <param name="ApiUrl">URL API của trạm con (để trạm tổng kết nối vào). Ví dụ: http://192.168.1.100:5000</param>
public record StationRequest(string Name, string? Code, string? Location, string? Status, string? ApiUrl);

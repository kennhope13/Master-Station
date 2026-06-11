using System.ComponentModel.DataAnnotations;

namespace StationOS.Data.Entities;

public class Station
{
    /// <summary>ID định danh trạm (UUID).</summary>
    public Guid Id { get; set; } = Guid.NewGuid();
    /// <summary>Tên trạm hiển thị.</summary>
    [Required] public string Name { get; set; } = string.Empty;
    /// <summary>Mã trạm (ví dụ: TBA-001).</summary>
    public string? Code { get; set; }
    /// <summary>Vị trí địa lý dạng JSONB: {"lat","lng","address"}.</summary>
    public string? Location { get; set; }
    /// <summary>Trạng thái: active | inactive | maintenance.</summary>
    public string Status { get; set; } = "active";
    /// <summary>Thời điểm tạo trạm.</summary>
    public DateTime CreatedAt { get; set; } = DateTime.UtcNow;
    /// <summary>URL API của trạm con (dùng để trạm tổng kết nối vào). Ví dụ: http://192.168.1.100:5000</summary>
    public string? ApiUrl { get; set; }
}

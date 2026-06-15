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
    /// <summary>URL giao diện web của trạm con (dùng để mở cửa sổ vào trạm). Ví dụ: http://192.168.1.100:4173</summary>
    public string? WebUrl { get; set; }
    /// <summary>Lần cuối trạm tổng kết nối thành công tới trạm con (ping, remote-kpi, remote-cameras).</summary>
    public DateTime? LastContactAt { get; set; }
}

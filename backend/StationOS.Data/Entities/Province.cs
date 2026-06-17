using System.ComponentModel.DataAnnotations;

namespace StationOS.Data.Entities;

/// <summary>
/// Tỉnh / Vùng — cấp quản lý trung gian giữa Trạm và Toàn Cục.
/// Mỗi tỉnh chứa nhiều trạm. Admin Tỉnh chỉ quản lý trạm trong tỉnh đó.
/// </summary>
public class Province
{
    public Guid Id { get; set; } = Guid.NewGuid();

    /// <summary>Tên tỉnh / vùng. Ví dụ: Tỉnh Long An, Tỉnh Tiền Giang.</summary>
    [Required] public string Name { get; set; } = string.Empty;

    /// <summary>Mã tỉnh. Ví dụ: LA, TG.</summary>
    public string? Code { get; set; }

    /// <summary>Mô tả.</summary>
    public string? Description { get; set; }

    /// <summary>Trạng thái: active | inactive.</summary>
    public string Status { get; set; } = "active";

    public DateTime CreatedAt { get; set; } = DateTime.UtcNow;
}

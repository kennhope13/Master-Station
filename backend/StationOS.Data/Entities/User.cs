using System.ComponentModel.DataAnnotations;

namespace StationOS.Data.Entities;

public class User
{
    public Guid Id { get; set; } = Guid.NewGuid();
    [Required] public string Username { get; set; } = string.Empty;
    [Required] public string PasswordHash { get; set; } = string.Empty;
    public string? ProvisionedPassword { get; set; }
    public string? FullName { get; set; }
    public string? Email { get; set; }
    [Required] public string Role { get; set; } = "operator"; // operator | manager | admin_station | admin_province | admin
    public Guid? TeamId { get; set; } // Nullable foreign key to Team
    /// <summary>Danh sách trạm được phép quản lý (Admin Trạm). null = không giới hạn.</summary>
    public Guid[]? StationIds { get; set; }
    /// <summary>Danh sách tỉnh được phép quản lý (Admin Tỉnh). null = không giới hạn.</summary>
    public Guid[]? ProvinceIds { get; set; }
    /// <summary>Danh sách các mã quyền được cấp (Permissions checklist). Ví dụ: ["station:view", "device:manage"]</summary>
    public string[]? Permissions { get; set; }
    public bool IsActive { get; set; } = true;

    /// <summary>true = user phải đổi password trước khi dùng tiếp.
    /// Set true cho admin seed mặc định, và mỗi khi admin reset password user khác.</summary>
    public bool MustChangePassword { get; set; } = false;

    public DateTime? LastPasswordChangedAt { get; set; }
    public DateTime? LastLoginAt { get; set; }

    public DateTime CreatedAt { get; set; } = DateTime.UtcNow;
}

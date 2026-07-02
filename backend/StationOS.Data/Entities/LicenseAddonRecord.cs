using System.ComponentModel.DataAnnotations;

namespace StationOS.Data.Entities;

/// <summary>
/// Sổ cái bền vững các gói license Add-on (Camera/Sensor...) đã được nạp thành công vào trạm.
/// Dùng để chống nạp trùng một file Add-on (theo AddonId GUID) kể cả khi file gốc đã bị xoá
/// khỏi thư mục Licenses và nạp lại sau này, đồng thời cho phép tra cứu lịch sử nâng cấp.
/// </summary>
public class LicenseAddonRecord
{
    public Guid Id { get; set; } = Guid.NewGuid();

    [Required] public Guid AddonId { get; set; }
    public Guid? BaseLicenseId { get; set; }

    [Required] public string Tier { get; set; } = "addon";

    public int Users { get; set; }
    public int Stations { get; set; }
    public int Cameras { get; set; }
    public int RoiPoints { get; set; }
    public int RoiRegions { get; set; }
    public int PdRegions { get; set; }

    public DateTime IssuedAtUtc { get; set; }
    public DateTime ExpiresAtUtc { get; set; }
    public DateTime ImportedAtUtc { get; set; } = DateTime.UtcNow;

    [Required] public string SourceFileName { get; set; } = "";
}

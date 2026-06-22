using System.ComponentModel.DataAnnotations;

namespace StationOS.Data.Entities;

public class License
{
    public Guid Id { get; set; } = Guid.NewGuid();
    [Required] public string Key { get; set; } = "";
    [Required] public string Tier { get; set; } = "solo"; // solo | team | ent
    public int MaxUsers { get; set; } = 1;
    public int MaxStations { get; set; } = 10;
    public int MaxCameras { get; set; } = 8;
    public int MaxRoiPoints { get; set; } = 500;
    public int MaxRoiRegions { get; set; } = 30;
    public int MaxPdRegions { get; set; } = 30;
    public DateTime ExpiresAt { get; set; }
    public DateTime ActivatedAt { get; set; } = DateTime.UtcNow;
    public bool IsActive { get; set; } = true;
}

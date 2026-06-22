using System.ComponentModel.DataAnnotations;

namespace StationOS.Data.Entities;

public class Report
{
    public Guid Id { get; set; } = Guid.NewGuid();
    public Guid StationId { get; set; }
    public string ScopeType { get; set; } = "station";
    public Guid? ProvinceId { get; set; }
    public Guid? TeamId { get; set; }
    public string? ScopeLabel { get; set; }
    [Required] public string Type { get; set; } = string.Empty; // daily | monthly | event | cbm
    public DateTime? PeriodFrom { get; set; }
    public DateTime? PeriodTo { get; set; }
    public string? FileUrl { get; set; }
    public Guid? GeneratedBy { get; set; }
    public DateTime GeneratedAt { get; set; } = DateTime.UtcNow;
}

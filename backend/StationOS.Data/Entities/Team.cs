using System.ComponentModel.DataAnnotations;

namespace StationOS.Data.Entities;

public class Team
{
    public Guid Id { get; set; } = Guid.NewGuid();
    [Required] public string Name { get; set; } = string.Empty;
    /// <summary>
    /// Optional province this team operates in. Null means cross‑province.
    /// </summary>
    public Guid? ProvinceId { get; set; }
    /// <summary>
    /// List of station IDs this team is responsible for.
    /// Stored as PostgreSQL uuid[] column.
    /// </summary>
    public Guid[]? StationIds { get; set; }
}

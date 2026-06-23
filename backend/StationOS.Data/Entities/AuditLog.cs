using System.ComponentModel.DataAnnotations;

namespace StationOS.Data.Entities;

public class AuditLog
{
    public Guid Id { get; set; } = Guid.NewGuid();
    public Guid? UserId { get; set; }
    [Required] public string Action { get; set; } = string.Empty; // create | update | delete | ack_alert | export | view_camera
    public string? EntityType { get; set; } // device | rule | alert | user
    public Guid? EntityId { get; set; }
    public string? OldValue { get; set; } // JSONB
    public string? NewValue { get; set; } // JSONB
    public string? IpAddress { get; set; }
    public DateTime Ts { get; set; } = DateTime.UtcNow;
    // Trạm con nguồn (null = hành động trực tiếp tại trạm tổng)
    public Guid? StationId { get; set; }
}

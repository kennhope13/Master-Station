using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace StationOS.Data.Migrations
{
    public partial class AddAuditLogStationId : Migration
    {
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.AddColumn<Guid>(
                name: "StationId",
                table: "AuditLogs",
                type: "uuid",
                nullable: true);
        }

        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropColumn(name: "StationId", table: "AuditLogs");
        }
    }
}

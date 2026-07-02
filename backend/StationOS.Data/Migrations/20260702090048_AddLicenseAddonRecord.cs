using System;
using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace StationOS.Data.Migrations
{
    /// <inheritdoc />
    public partial class AddLicenseAddonRecord : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.CreateTable(
                name: "LicenseAddons",
                columns: table => new
                {
                    Id = table.Column<Guid>(type: "uuid", nullable: false),
                    AddonId = table.Column<Guid>(type: "uuid", nullable: false),
                    BaseLicenseId = table.Column<Guid>(type: "uuid", nullable: true),
                    Tier = table.Column<string>(type: "text", nullable: false),
                    Users = table.Column<int>(type: "integer", nullable: false),
                    Stations = table.Column<int>(type: "integer", nullable: false),
                    Cameras = table.Column<int>(type: "integer", nullable: false),
                    RoiPoints = table.Column<int>(type: "integer", nullable: false),
                    RoiRegions = table.Column<int>(type: "integer", nullable: false),
                    PdRegions = table.Column<int>(type: "integer", nullable: false),
                    IssuedAtUtc = table.Column<DateTime>(type: "timestamp with time zone", nullable: false),
                    ExpiresAtUtc = table.Column<DateTime>(type: "timestamp with time zone", nullable: false),
                    ImportedAtUtc = table.Column<DateTime>(type: "timestamp with time zone", nullable: false),
                    SourceFileName = table.Column<string>(type: "text", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_LicenseAddons", x => x.Id);
                });

            migrationBuilder.CreateIndex(
                name: "IX_LicenseAddons_AddonId",
                table: "LicenseAddons",
                column: "AddonId",
                unique: true);
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropTable(
                name: "LicenseAddons");
        }
    }
}

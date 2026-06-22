using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace StationOS.Data.Migrations
{
    /// <inheritdoc />
    public partial class AddLicenseResourceLimits : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.AddColumn<int>(
                name: "MaxCameras",
                table: "Licenses",
                type: "integer",
                nullable: false,
                defaultValue: 8);

            migrationBuilder.AddColumn<int>(
                name: "MaxPdRegions",
                table: "Licenses",
                type: "integer",
                nullable: false,
                defaultValue: 30);

            migrationBuilder.AddColumn<int>(
                name: "MaxRoiPoints",
                table: "Licenses",
                type: "integer",
                nullable: false,
                defaultValue: 500);

            migrationBuilder.AddColumn<int>(
                name: "MaxRoiRegions",
                table: "Licenses",
                type: "integer",
                nullable: false,
                defaultValue: 30);

            migrationBuilder.AddColumn<int>(
                name: "MaxStations",
                table: "Licenses",
                type: "integer",
                nullable: false,
                defaultValue: 10);
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropColumn(
                name: "MaxCameras",
                table: "Licenses");

            migrationBuilder.DropColumn(
                name: "MaxPdRegions",
                table: "Licenses");

            migrationBuilder.DropColumn(
                name: "MaxRoiPoints",
                table: "Licenses");

            migrationBuilder.DropColumn(
                name: "MaxRoiRegions",
                table: "Licenses");

            migrationBuilder.DropColumn(
                name: "MaxStations",
                table: "Licenses");
        }
    }
}

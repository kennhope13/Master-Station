using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace StationOS.Data.Migrations;

/// <inheritdoc />
public partial class AddUniqueStationNameAndCode : Migration
{
    /// <inheritdoc />
    protected override void Up(MigrationBuilder migrationBuilder)
    {
        // Keep every existing record, but disambiguate duplicates before adding the
        // constraints. The short GUID makes the generated value deterministic and unique.
        migrationBuilder.Sql("""
            WITH duplicates AS (
                SELECT "Id", ROW_NUMBER() OVER (
                    PARTITION BY "Name" ORDER BY "CreatedAt", "Id"
                ) AS duplicate_number
                FROM "Stations"
            )
            UPDATE "Stations" AS station
            SET "Name" = station."Name" || ' [' || LEFT(station."Id"::text, 8) || ']'
            FROM duplicates
            WHERE station."Id" = duplicates."Id" AND duplicates.duplicate_number > 1;
            """);

        migrationBuilder.Sql("""
            WITH duplicates AS (
                SELECT "Id", ROW_NUMBER() OVER (
                    PARTITION BY "Code" ORDER BY "CreatedAt", "Id"
                ) AS duplicate_number
                FROM "Stations"
                WHERE "Code" IS NOT NULL
            )
            UPDATE "Stations" AS station
            SET "Code" = station."Code" || '-' || LEFT(station."Id"::text, 8)
            FROM duplicates
            WHERE station."Id" = duplicates."Id" AND duplicates.duplicate_number > 1;
            """);

        migrationBuilder.CreateIndex(
            name: "IX_Stations_Name",
            table: "Stations",
            column: "Name",
            unique: true);

        migrationBuilder.CreateIndex(
            name: "IX_Stations_Code",
            table: "Stations",
            column: "Code",
            unique: true);
    }

    /// <inheritdoc />
    protected override void Down(MigrationBuilder migrationBuilder)
    {
        migrationBuilder.DropIndex(name: "IX_Stations_Name", table: "Stations");
        migrationBuilder.DropIndex(name: "IX_Stations_Code", table: "Stations");
    }
}

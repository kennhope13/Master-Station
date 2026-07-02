using Microsoft.AspNetCore.Http;
using Microsoft.Extensions.Configuration;
using Microsoft.Extensions.DependencyInjection;
using StationOS.Data;
using StationOS.Data.Entities;
using Microsoft.EntityFrameworkCore;

namespace StationOS.Services.Licensing;

public sealed record EffectiveLicenseSnapshot(
    bool HasLicense,
    string Tier,
    int MaxUsers,
    int MaxStations,
    int MaxCameras,
    int MaxRoiPoints,
    int MaxRoiRegions,
    int MaxPdRegions,
    DateTime? ExpiresAtUtc,
    DateTime ReloadedAtUtc,
    Guid? BaseLicenseId,
    int BaseFileCount,
    int AddonFileCount,
    int TotalFileCount
)
{
    public static EffectiveLicenseSnapshot Empty { get; } = new(
        false,
        "demo",
        10,
        10,
        10,
        10,
        10,
        10,
        null,
        DateTime.UtcNow,
        null,
        0,
        0,
        0
    );
}

public sealed record LicenseImportOutcome(
    bool Success,
    string Message,
    string? SavedPath = null,
    LicenseDocument? Document = null
);

public sealed class LicenseManager
{
    private readonly string _vendorSecret;
    private readonly string _licensesDirectory;
    private readonly IServiceScopeFactory _scopeFactory;
    private readonly object _sync = new();
    private EffectiveLicenseSnapshot _snapshot = EffectiveLicenseSnapshot.Empty;
    private HardwareFingerprintSnapshot _currentFingerprint = HardwareFingerprint.Capture();

    public LicenseManager(IConfiguration configuration, IServiceScopeFactory scopeFactory)
    {
        _vendorSecret = Environment.GetEnvironmentVariable("STATIONOS_VENDOR_SECRET")
            ?? configuration["License:VendorSecret"]
            ?? throw new InvalidOperationException("Thiếu License:VendorSecret / STATIONOS_VENDOR_SECRET.");

        _scopeFactory = scopeFactory;
        _licensesDirectory = Path.Combine(AppContext.BaseDirectory, "Licenses");
        Directory.CreateDirectory(_licensesDirectory);
        ReloadLicenses();
    }

    public string GenerateRequestString() => HardwareFingerprint.GenerateRequestString();

    public HardwareFingerprintSnapshot GetCurrentFingerprint()
    {
        _currentFingerprint = HardwareFingerprint.Capture();
        return _currentFingerprint;
    }

    public EffectiveLicenseSnapshot GetEffectiveSnapshot()
    {
        lock (_sync)
        {
            return _snapshot;
        }
    }

    public void ReloadLicenses()
    {
        lock (_sync)
        {
            _currentFingerprint = HardwareFingerprint.Capture();
            var now = DateTime.UtcNow;
            var loaded = new List<LicenseDocument>();

            foreach (var file in Directory.EnumerateFiles(_licensesDirectory, "*.lic", SearchOption.TopDirectoryOnly))
            {
                try
                {
                    var content = File.ReadAllText(file);
                    if (!LicenseParser.TryParseDocument(content, _vendorSecret, _currentFingerprint, out var doc, out _))
                        continue;

                    loaded.Add(doc with { SourcePath = file });
                }
                catch
                {
                    // Ignore invalid files so one bad addon does not block the whole folder.
                }
            }

            var validBase = loaded
                .Where(d => d.Kind == LicensePackageKind.Base && d.ExpiresAtUtc >= now)
                .OrderByDescending(d => d.IssuedAtUtc)
                .ThenByDescending(d => d.ExpiresAtUtc)
                .FirstOrDefault();

            if (validBase == null)
            {
                _snapshot = EffectiveLicenseSnapshot.Empty with { ReloadedAtUtc = now };
                return;
            }

            var usedAddonIds = new HashSet<Guid>();
            var addonFiles = loaded
                .Where(d => d.Kind == LicensePackageKind.Addon && d.ExpiresAtUtc >= now)
                .Where(d => d.BaseLicenseId == null || d.BaseLicenseId == validBase.LicenseId)
                .Where(d => usedAddonIds.Add(d.AddonId ?? d.LicenseId))
                .ToList();
            var baseFileCount = loaded.Count(d => d.Kind == LicensePackageKind.Base && d.ExpiresAtUtc >= now);

            var additive = new LicenseResourceBundle();
            foreach (var addon in addonFiles)
                additive += addon.Limits;

            var effective = validBase.Limits + additive;
            var minExpiry = addonFiles.Count > 0
                ? addonFiles.Prepend(validBase).Min(d => d.ExpiresAtUtc)
                : validBase.ExpiresAtUtc;

            _snapshot = new EffectiveLicenseSnapshot(
                true,
                string.IsNullOrWhiteSpace(validBase.Tier) ? "base" : validBase.Tier,
                effective.Users <= 0 ? 10 : effective.Users,
                effective.Stations <= 0 ? validBase.Limits.Stations : effective.Stations,
                effective.Cameras <= 0 ? validBase.Limits.Cameras : effective.Cameras,
                effective.RoiPoints <= 0 ? validBase.Limits.RoiPoints : effective.RoiPoints,
                effective.RoiRegions <= 0 ? validBase.Limits.RoiRegions : effective.RoiRegions,
                effective.PdRegions <= 0 ? validBase.Limits.PdRegions : effective.PdRegions,
                minExpiry,
                now,
                validBase.LicenseId,
                baseFileCount,
                addonFiles.Count,
                loaded.Count
            );
        }
    }

    public async Task<LicenseImportOutcome> ImportLicenseAsync(IFormFile file)
    {
        if (file == null || file.Length == 0)
            return new LicenseImportOutcome(false, "Vui lòng chọn file .lic hợp lệ");

        var currentFingerprint = GetCurrentFingerprint();
        string content;
        using (var reader = new StreamReader(file.OpenReadStream()))
        {
            content = await reader.ReadToEndAsync();
        }

        if (!LicenseParser.TryParseDocument(content, _vendorSecret, currentFingerprint, out var doc, out var error))
            return new LicenseImportOutcome(false, error);

        if (doc!.Kind == LicensePackageKind.Addon)
        {
            var addonId = doc.AddonId ?? doc.LicenseId;
            var alreadyConsumed = await IsAddonAlreadyConsumedAsync(addonId);
            if (alreadyConsumed)
                return new LicenseImportOutcome(false, "License add-on này đã được sử dụng trước đó (GUID trùng lặp), không thể nạp lại");
        }

        var safeName = doc.Kind == LicensePackageKind.Addon
            ? $"addon_{(doc.AddonId ?? doc.LicenseId):N}.lic"
            : "base.lic";

        var targetPath = Path.Combine(_licensesDirectory, safeName);
        await File.WriteAllTextAsync(targetPath, content);

        if (doc.Kind == LicensePackageKind.Addon)
            await RecordAddonConsumptionAsync(doc, safeName);

        ReloadLicenses();

        return new LicenseImportOutcome(true, doc.Kind == LicensePackageKind.Addon ? "Nhập add-on license thành công" : "Nhập base license thành công", targetPath, doc);
    }

    public async Task<(bool success, string error, LicenseDocument? document)> TryParseAsync(IFormFile file)
    {
        if (file == null || file.Length == 0)
            return (false, "Vui lòng chọn file .lic hợp lệ", null);

        string content;
        using (var reader = new StreamReader(file.OpenReadStream()))
        {
            content = await reader.ReadToEndAsync();
        }

        var ok = LicenseParser.TryParseDocument(content, _vendorSecret, GetCurrentFingerprint(), out var doc, out var error);
        return ok ? (true, "", doc) : (false, error, null);
    }

    public async Task SaveTextAsRequestAsync(string requestText, string fileName)
    {
        var target = Path.Combine(_licensesDirectory, fileName);
        await File.WriteAllTextAsync(target, requestText);
    }

    private async Task<bool> IsAddonAlreadyConsumedAsync(Guid addonId)
    {
        using var scope = _scopeFactory.CreateScope();
        var db = scope.ServiceProvider.GetRequiredService<AppDbContext>();
        return await db.LicenseAddons.AnyAsync(a => a.AddonId == addonId);
    }

    private async Task RecordAddonConsumptionAsync(LicenseDocument doc, string sourceFileName)
    {
        using var scope = _scopeFactory.CreateScope();
        var db = scope.ServiceProvider.GetRequiredService<AppDbContext>();
        db.LicenseAddons.Add(new LicenseAddonRecord
        {
            AddonId = doc.AddonId ?? doc.LicenseId,
            BaseLicenseId = doc.BaseLicenseId,
            Tier = doc.Tier,
            Users = doc.Limits.Users,
            Stations = doc.Limits.Stations,
            Cameras = doc.Limits.Cameras,
            RoiPoints = doc.Limits.RoiPoints,
            RoiRegions = doc.Limits.RoiRegions,
            PdRegions = doc.Limits.PdRegions,
            IssuedAtUtc = doc.IssuedAtUtc,
            ExpiresAtUtc = doc.ExpiresAtUtc,
            SourceFileName = sourceFileName,
        });

        try
        {
            await db.SaveChangesAsync();
        }
        catch (DbUpdateException)
        {
            // Unique index trên AddonId chặn race condition nạp trùng đồng thời — bỏ qua an toàn.
        }
    }
}

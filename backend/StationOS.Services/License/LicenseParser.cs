using System.Security.Cryptography;
using System.Text;
using System.Text.Json;

namespace StationOS.Services.Licensing;

public enum LicensePackageKind
{
    Base,
    Addon
}

public sealed record LicenseResourceBundle(
    int Users = 0,
    int Stations = 0,
    int Cameras = 0,
    int RoiPoints = 0,
    int RoiRegions = 0,
    int PdRegions = 0
)
{
    public static LicenseResourceBundle operator +(LicenseResourceBundle left, LicenseResourceBundle right) =>
        new(
            left.Users + right.Users,
            left.Stations + right.Stations,
            left.Cameras + right.Cameras,
            left.RoiPoints + right.RoiPoints,
            left.RoiRegions + right.RoiRegions,
            left.PdRegions + right.PdRegions
        );

    public string ToCanonicalString() =>
        $"users={Users};stations={Stations};cameras={Cameras};roi_points={RoiPoints};roi_regions={RoiRegions};pd_regions={PdRegions}";
}

public sealed record LicenseHardwareBinding(
    string CpuId = "",
    string MainboardUuid = "",
    string OsDiskSerial = "",
    string MachineName = "",
    string Platform = "",
    string MacAddress = ""
)
{
    public HardwareFingerprintSnapshot ToSnapshot() =>
        HardwareFingerprint.FromValues(CpuId, MainboardUuid, OsDiskSerial, MachineName, Platform, MacAddress);
}

public sealed record LicenseDocument(
    LicensePackageKind Kind,
    Guid LicenseId,
    Guid? AddonId,
    Guid? BaseLicenseId,
    string Tier,
    DateTime IssuedAtUtc,
    DateTime ExpiresAtUtc,
    LicenseHardwareBinding Hardware,
    LicenseResourceBundle Limits,
    string Signature,
    string RawContent,
    string SourcePath = ""
)
{
    public bool IsAddon => Kind == LicensePackageKind.Addon;
}

public static class LicenseParser
{
    public static bool TryParseDocument(
        string content,
        string? vendorPublicKey,
        string? legacyVendorSecret,
        HardwareFingerprintSnapshot currentFingerprint,
        out LicenseDocument? document,
        out string errorMessage)
    {
        document = null;
        errorMessage = string.Empty;

        if (string.IsNullOrWhiteSpace(content))
        {
            errorMessage = "File license rỗng";
            return false;
        }

        content = content.Trim();
        if (!content.StartsWith('{'))
        {
            errorMessage = "License .lic phải là JSON có ký số";
            return false;
        }

        try
        {
            using var doc = JsonDocument.Parse(content);
            var root = doc.RootElement;

            var kind = ParseKind(root.GetStringOrDefault("kind"));
            var licenseId = ParseGuid(root.GetStringOrDefault("licenseId") ?? root.GetStringOrDefault("license_id")) ?? Guid.NewGuid();
            var addonId = ParseGuid(root.GetStringOrDefault("addonId") ?? root.GetStringOrDefault("addon_id"));
            var baseLicenseId = ParseGuid(root.GetStringOrDefault("baseLicenseId") ?? root.GetStringOrDefault("base_license_id"));
            var tier = (root.GetStringOrDefault("tier") ?? (kind == LicensePackageKind.Base ? "base" : "addon")).Trim();
            var issuedAtUtc = ParseDate(root.GetStringOrDefault("issuedAtUtc") ?? root.GetStringOrDefault("issued_at_utc") ?? root.GetStringOrDefault("issuedAt")) ?? DateTime.UtcNow;
            var expiresAtUtc = ParseDate(root.GetStringOrDefault("expiresAtUtc") ?? root.GetStringOrDefault("expires_at_utc") ?? root.GetStringOrDefault("expiresAt"));
            if (expiresAtUtc == null)
            {
                errorMessage = "Thiếu ngày hết hạn license";
                return false;
            }

            var hardware = ParseHardware(root.TryGetProperty("hardware", out var hardwareElement) ? hardwareElement : default);
            var limits = ParseLimits(root.TryGetProperty("limits", out var limitsElement) ? limitsElement : default, kind);
            var signatureAlgorithm = (root.GetStringOrDefault("signatureAlgorithm") ?? root.GetStringOrDefault("signature_algorithm") ?? string.Empty).Trim().ToLowerInvariant();
            var signature = (root.GetStringOrDefault("signature") ?? string.Empty).Trim();
            if (string.IsNullOrWhiteSpace(signature))
            {
                errorMessage = "Thiếu chữ ký license";
                return false;
            }

            var payload = BuildCanonicalPayload(kind, licenseId, addonId, baseLicenseId, tier, issuedAtUtc, expiresAtUtc.Value, hardware, limits);
            if (string.Equals(Environment.GetEnvironmentVariable("STATIONOS_LICENSE_DEBUG"), "1", StringComparison.OrdinalIgnoreCase))
            {
                var fingerprintHash = HardwareFingerprint.ComputeFingerprintHash(hardware.ToSnapshot());
                Console.WriteLine($"[LICENSE-DEBUG] fingerprintHash: {fingerprintHash}");
                Console.WriteLine($"[LICENSE-DEBUG] canonical ({payload.Length} chars): {payload}");
                Console.WriteLine($"[LICENSE-DEBUG] signatureAlgorithm: {signatureAlgorithm}");
                Console.WriteLine($"[LICENSE-DEBUG] publicKeyFingerprint: {ComputePemFingerprint(vendorPublicKey)}");
            }
            if (!VerifySignature(signature, payload, signatureAlgorithm, vendorPublicKey, legacyVendorSecret))
            {
                var rawPayload = BuildRawJsonPayload(root);
                if (!VerifySignature(signature, rawPayload, signatureAlgorithm, vendorPublicKey, legacyVendorSecret))
                {
                    errorMessage = "Chữ ký license không hợp lệ";
                    return false;
                }
            }

            var bindingSnapshot = hardware.ToSnapshot();
            var match = HardwareFingerprint.Compare(bindingSnapshot, currentFingerprint);
            if (!match.IsMatch)
            {
                errorMessage = $"License không khớp phần cứng (match {match.Matched}/3)";
                return false;
            }

            // Add-on: đối chiếu thêm địa chỉ MAC card mạng vật lý của máy trạm (mục 3 spec).
            // Bỏ qua nếu một trong hai bên không đọc được MAC (best-effort, tránh false-reject).
            if (kind == LicensePackageKind.Addon && !HardwareFingerprint.MacMatches(bindingSnapshot, currentFingerprint))
            {
                errorMessage = "License add-on không khớp địa chỉ MAC phần cứng của máy trạm";
                return false;
            }

            document = new LicenseDocument(
                kind,
                licenseId,
                addonId,
                baseLicenseId,
                tier,
                issuedAtUtc,
                expiresAtUtc.Value,
                hardware,
                limits,
                signature,
                content
            );
            return true;
        }
        catch (JsonException)
        {
            errorMessage = "File .lic không đúng định dạng JSON";
            return false;
        }
        catch (Exception ex)
        {
            errorMessage = ex.Message;
            return false;
        }
    }

    public static string BuildCanonicalPayload(
        LicensePackageKind kind,
        Guid licenseId,
        Guid? addonId,
        Guid? baseLicenseId,
        string tier,
        DateTime issuedAtUtc,
        DateTime expiresAtUtc,
        LicenseHardwareBinding hardware,
        LicenseResourceBundle limits)
    {
        return string.Join("|", new[]
        {
            kind.ToString().ToUpperInvariant(),
            licenseId.ToString("N"),
            addonId?.ToString("N") ?? string.Empty,
            baseLicenseId?.ToString("N") ?? string.Empty,
            tier.Trim().ToUpperInvariant(),
            issuedAtUtc.ToUniversalTime().ToString("O"),
            expiresAtUtc.ToUniversalTime().ToString("O"),
            HardwareFingerprint.ComputeFingerprintHash(hardware.ToSnapshot()),
            limits.ToCanonicalString()
        });
    }

    public static string ComputeSignature(string vendorSecret, string payload)
    {
        var key = Encoding.UTF8.GetBytes(vendorSecret);
        var data = Encoding.UTF8.GetBytes(payload);
        var hash = HMACSHA256.HashData(key, data);
        return Convert.ToHexString(hash)[..8];
    }

    private static string SignPayload(string payload, string? vendorPrivateKey, string? legacyVendorSecret, out string signatureAlgorithm)
    {
        if (!string.IsNullOrWhiteSpace(vendorPrivateKey))
        {
            signatureAlgorithm = "rsa-sha256";
            return SignWithRsaPrivateKey(vendorPrivateKey, payload);
        }

        if (!string.IsNullOrWhiteSpace(legacyVendorSecret))
        {
            signatureAlgorithm = "hmac-sha256";
            return ComputeSignature(legacyVendorSecret, payload);
        }

        throw new InvalidOperationException("Thiếu khóa ký license. Vui lòng cấu hình License:VendorPrivateKey hoặc License:VendorSecret.");
    }

    private static bool VerifySignature(string signature, string payload, string? signatureAlgorithm, string? vendorPublicKey, string? legacyVendorSecret)
    {
        if (string.Equals(signatureAlgorithm, "rsa-sha256", StringComparison.OrdinalIgnoreCase) ||
            string.Equals(signatureAlgorithm, "rsa", StringComparison.OrdinalIgnoreCase))
        {
            return !string.IsNullOrWhiteSpace(vendorPublicKey) && VerifyWithRsaPublicKey(vendorPublicKey, payload, signature);
        }

        if (string.Equals(signatureAlgorithm, "hmac-sha256", StringComparison.OrdinalIgnoreCase) ||
            string.Equals(signatureAlgorithm, "hmac", StringComparison.OrdinalIgnoreCase))
        {
            return !string.IsNullOrWhiteSpace(legacyVendorSecret) &&
                   string.Equals(signature, ComputeSignature(legacyVendorSecret, payload), StringComparison.OrdinalIgnoreCase);
        }

        if (!string.IsNullOrWhiteSpace(vendorPublicKey) && VerifyWithRsaPublicKey(vendorPublicKey, payload, signature))
            return true;

        if (!string.IsNullOrWhiteSpace(legacyVendorSecret) &&
            string.Equals(signature, ComputeSignature(legacyVendorSecret, payload), StringComparison.OrdinalIgnoreCase))
            return true;

        return false;
    }

    private static string SignWithRsaPrivateKey(string privateKeyPem, string payload)
    {
        using var rsa = RSA.Create();
        rsa.ImportFromPem(privateKeyPem);
        var data = Encoding.UTF8.GetBytes(payload);
        var signature = rsa.SignData(data, HashAlgorithmName.SHA256, RSASignaturePadding.Pkcs1);
        return Convert.ToBase64String(signature);
    }

    private static bool VerifyWithRsaPublicKey(string publicKeyPem, string payload, string signature)
    {
        try
        {
            using var rsa = RSA.Create();
            rsa.ImportFromPem(publicKeyPem);
            var data = Encoding.UTF8.GetBytes(payload);
            var signatureBytes = Convert.FromBase64String(signature);
            return rsa.VerifyData(data, signatureBytes, HashAlgorithmName.SHA256, RSASignaturePadding.Pkcs1);
        }
        catch
        {
            return false;
        }
    }

    private static string ComputePemFingerprint(string? pem)
    {
        if (string.IsNullOrWhiteSpace(pem))
            return "(empty)";

        var cleaned = pem
            .Replace("-----BEGIN PUBLIC KEY-----", string.Empty)
            .Replace("-----END PUBLIC KEY-----", string.Empty)
            .Replace("\r", string.Empty)
            .Replace("\n", string.Empty)
            .Trim();

        try
        {
            var bytes = Convert.FromBase64String(cleaned);
            var hash = SHA256.HashData(bytes);
            return Convert.ToHexString(hash);
        }
        catch
        {
            return "(invalid-pem)";
        }
    }

    private static string BuildRawJsonPayload(JsonElement root)
    {
        using var doc = BuildSignatureDocument(root);
        return JsonSerializer.Serialize(doc.RootElement, new JsonSerializerOptions
        {
            WriteIndented = false,
            PropertyNamingPolicy = null
        });
    }

    public static string CreateStructuredLicenseJson(
        LicensePackageKind kind,
        Guid licenseId,
        Guid? addonId,
        Guid? baseLicenseId,
        string tier,
        DateTime issuedAtUtc,
        DateTime expiresAtUtc,
        LicenseHardwareBinding hardware,
        LicenseResourceBundle limits,
        string? vendorPrivateKey = null,
        string? legacyVendorSecret = null)
    {
        var payload = BuildCanonicalPayload(kind, licenseId, addonId, baseLicenseId, tier, issuedAtUtc, expiresAtUtc, hardware, limits);
        var signature = SignPayload(payload, vendorPrivateKey, legacyVendorSecret, out var signatureAlgorithm);
        var payloadObject = new
        {
            version = 1,
            kind = kind.ToString().ToLowerInvariant(),
            licenseId = licenseId.ToString(),
            addonId = addonId?.ToString(),
            baseLicenseId = baseLicenseId?.ToString(),
            tier,
            issuedAtUtc = issuedAtUtc.ToUniversalTime().ToString("O"),
            expiresAtUtc = expiresAtUtc.ToUniversalTime().ToString("O"),
            hardware = new
            {
                cpuId = hardware.CpuId,
                mainboardUuid = hardware.MainboardUuid,
                osDiskSerial = hardware.OsDiskSerial,
                machineName = hardware.MachineName,
                platform = hardware.Platform,
                macAddress = hardware.MacAddress,
            },
            limits = new
            {
                users = limits.Users,
                stations = limits.Stations,
                cameras = limits.Cameras,
                roiPoints = limits.RoiPoints,
                roiRegions = limits.RoiRegions,
                pdRegions = limits.PdRegions,
            },
            signatureAlgorithm,
            signature
        };

        return JsonSerializer.Serialize(payloadObject, new JsonSerializerOptions
        {
            WriteIndented = true,
            PropertyNamingPolicy = JsonNamingPolicy.CamelCase,
        });
    }

    private static LicensePackageKind ParseKind(string? value)
    {
        return value?.Trim().ToLowerInvariant() switch
        {
            "addon" => LicensePackageKind.Addon,
            _ => LicensePackageKind.Base
        };
    }

    private static Guid? ParseGuid(string? value)
    {
        if (Guid.TryParse(value, out var guid))
            return guid;
        return null;
    }

    private static DateTime? ParseDate(string? value)
    {
        if (string.IsNullOrWhiteSpace(value))
            return null;

        if (DateTime.TryParse(value, null, System.Globalization.DateTimeStyles.AdjustToUniversal | System.Globalization.DateTimeStyles.AssumeUniversal, out var date))
            return DateTime.SpecifyKind(date, DateTimeKind.Utc);

        return null;
    }

    private static LicenseHardwareBinding ParseHardware(JsonElement element)
    {
        if (element.ValueKind != JsonValueKind.Object)
            return new LicenseHardwareBinding();

        return new LicenseHardwareBinding(
            element.GetStringOrDefault("cpuId") ?? element.GetStringOrDefault("cpu_id") ?? string.Empty,
            element.GetStringOrDefault("mainboardUuid") ?? element.GetStringOrDefault("mainboard_uuid") ?? string.Empty,
            element.GetStringOrDefault("osDiskSerial") ?? element.GetStringOrDefault("os_disk_serial") ?? string.Empty,
            element.GetStringOrDefault("machineName") ?? element.GetStringOrDefault("machine_name") ?? string.Empty,
            element.GetStringOrDefault("platform") ?? string.Empty,
            element.GetStringOrDefault("macAddress") ?? element.GetStringOrDefault("mac_address") ?? string.Empty
        );
    }

    private static LicenseResourceBundle ParseLimits(JsonElement element, LicensePackageKind kind)
    {
        if (element.ValueKind != JsonValueKind.Object)
        {
            return kind == LicensePackageKind.Addon
                ? new LicenseResourceBundle()
                : new LicenseResourceBundle(1, 1, 2, 0, 0, 0);
        }

        int ReadInt(params string[] names)
        {
            foreach (var name in names)
            {
                if (element.TryGetProperty(name, out var value) && value.ValueKind == JsonValueKind.Number && value.TryGetInt32(out var number))
                    return number;
            }
            return 0;
        }

        var bundle = new LicenseResourceBundle(
            ReadInt("users", "maxUsers", "max_users", "addUsers", "add_users"),
            ReadInt("stations", "maxStations", "max_stations", "addStations", "add_stations"),
            ReadInt("cameras", "maxCameras", "max_cameras", "addCameras", "add_cameras"),
            ReadInt("roiPoints", "maxRoiPoints", "max_roi_points", "addRoiPoints", "add_roi_points"),
            ReadInt("roiRegions", "maxRoiRegions", "max_roi_regions", "addRoiRegions", "add_roi_regions"),
            ReadInt("pdRegions", "maxPdRegions", "max_pd_regions", "addPdRegions", "add_pd_regions")
        );

        if (kind == LicensePackageKind.Addon)
            return bundle;

        // Base license: nếu tài liệu chỉ ghi add-on fields, vẫn lấy max* fields nếu có.
        return bundle;
    }

    private static string? GetStringOrDefault(this JsonElement element, string propertyName)
    {
        if (element.ValueKind != JsonValueKind.Object)
            return null;

        if (!element.TryGetProperty(propertyName, out var value))
            return null;

        return value.ValueKind switch
        {
            JsonValueKind.String => value.GetString(),
            JsonValueKind.Number => value.ToString(),
            JsonValueKind.True => "true",
            JsonValueKind.False => "false",
            _ => null
        };
    }

    private static JsonDocument BuildSignatureDocument(JsonElement root)
    {
        var payload = new Dictionary<string, object?>(StringComparer.Ordinal)
        {
            ["version"] = root.GetStringOrDefault("version") ?? "1",
            ["kind"] = root.GetStringOrDefault("kind"),
            ["licenseId"] = root.GetStringOrDefault("licenseId") ?? root.GetStringOrDefault("license_id"),
            ["addonId"] = root.GetStringOrDefault("addonId") ?? root.GetStringOrDefault("addon_id"),
            ["baseLicenseId"] = root.GetStringOrDefault("baseLicenseId") ?? root.GetStringOrDefault("base_license_id"),
            ["tier"] = root.GetStringOrDefault("tier"),
            ["issuedAtUtc"] = root.GetStringOrDefault("issuedAtUtc") ?? root.GetStringOrDefault("issued_at_utc") ?? root.GetStringOrDefault("issuedAt"),
            ["expiresAtUtc"] = root.GetStringOrDefault("expiresAtUtc") ?? root.GetStringOrDefault("expires_at_utc") ?? root.GetStringOrDefault("expiresAt"),
            ["signatureAlgorithm"] = root.GetStringOrDefault("signatureAlgorithm") ?? root.GetStringOrDefault("signature_algorithm"),
            ["hardware"] = root.TryGetProperty("hardware", out var hardwareElement) && hardwareElement.ValueKind == JsonValueKind.Object
                ? JsonSerializer.Deserialize<Dictionary<string, object?>>(hardwareElement.GetRawText())
                : null,
            ["limits"] = root.TryGetProperty("limits", out var limitsElement) && limitsElement.ValueKind == JsonValueKind.Object
                ? JsonSerializer.Deserialize<Dictionary<string, object?>>(limitsElement.GetRawText())
                : null
        };

        return JsonDocument.Parse(JsonSerializer.Serialize(payload, new JsonSerializerOptions
        {
            WriteIndented = false,
            PropertyNamingPolicy = null
        }));
    }
}

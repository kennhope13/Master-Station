using System.Diagnostics;
using System.Globalization;
using System.Security.Cryptography;
using System.Text;
using System.Text.Json;
using System.Text.RegularExpressions;

namespace StationOS.Services.Licensing;

public sealed record HardwareFingerprintSnapshot(
    string CpuId,
    string MainboardUuid,
    string OsDiskSerial,
    string MachineName,
    string Platform,
    DateTime CapturedAtUtc,
    string MacAddress = ""
);

public sealed record HardwareFingerprintMatch(
    int Compared,
    int Matched
)
{
    public bool IsMatch => Matched >= 2;
}

public static class HardwareFingerprint
{
    private static readonly JsonSerializerOptions JsonOptions = new()
    {
        WriteIndented = true,
        PropertyNamingPolicy = JsonNamingPolicy.CamelCase,
    };

    public static HardwareFingerprintSnapshot Capture()
    {
        var machineName = Environment.MachineName;
        var platform = Environment.OSVersion.Platform.ToString();

        var cpuId = FirstNonEmpty(
            TryReadWindowsWmic("cpu", "ProcessorId", "wmic cpu get ProcessorId"),
            TryReadLinuxCpuId(),
            Environment.GetEnvironmentVariable("PROCESSOR_IDENTIFIER"),
            machineName);

        var boardUuid = FirstNonEmpty(
            TryReadWindowsWmic("csproduct", "UUID", "wmic csproduct get UUID"),
            TryReadLinuxDmiValue("/sys/class/dmi/id/product_uuid"),
            TryReadLinuxDmiValue("/sys/devices/virtual/dmi/id/product_uuid"),
            machineName);

        var diskSerial = FirstNonEmpty(
            TryReadWindowsDiskSerial(),
            TryReadLinuxRootDiskSerial(),
            TryReadLinuxDmiValue("/etc/machine-id"),
            machineName);

        // Địa chỉ MAC card mạng vật lý onboard (loại trừ card ảo/USB LAN). Có thể rỗng
        // trên máy không có NIC vật lý — khi đó sẽ không tham gia so khớp add-on.
        var macAddress = FirstNonEmpty(
            TryReadWindowsPhysicalMac(),
            TryReadLinuxPhysicalMac());

        return new HardwareFingerprintSnapshot(
            Normalize(cpuId),
            Normalize(boardUuid),
            Normalize(diskSerial),
            Normalize(machineName),
            Normalize(platform),
            DateTime.UtcNow,
            Normalize(macAddress)
        );
    }

    public static string GenerateRequestString()
    {
        var snapshot = Capture();
        var request = new
        {
            version = 1,
            requestType = "licreq",
            requestId = Guid.NewGuid().ToString("N"),
            capturedAtUtc = snapshot.CapturedAtUtc.ToString("O", CultureInfo.InvariantCulture),
            fingerprint = snapshot,
            fingerprintHash = ComputeFingerprintHash(snapshot),
        };

        return JsonSerializer.Serialize(request, JsonOptions);
    }

    public static string ComputeFingerprintHash(HardwareFingerprintSnapshot snapshot)
    {
        var payload = string.Join("|", new[]
        {
            snapshot.CpuId,
            snapshot.MainboardUuid,
            snapshot.OsDiskSerial,
            snapshot.MachineName,
            snapshot.Platform,
            snapshot.MacAddress
        });

        return Convert.ToHexString(SHA256.HashData(Encoding.UTF8.GetBytes(payload)));
    }

    public static HardwareFingerprintMatch Compare(HardwareFingerprintSnapshot? left, HardwareFingerprintSnapshot? right)
    {
        if (left == null || right == null)
            return new HardwareFingerprintMatch(0, 0);

        var compared = 0;
        var matched = 0;

        CompareField(left.CpuId, right.CpuId, ref compared, ref matched);
        CompareField(left.MainboardUuid, right.MainboardUuid, ref compared, ref matched);
        CompareField(left.OsDiskSerial, right.OsDiskSerial, ref compared, ref matched);

        return new HardwareFingerprintMatch(compared, matched);
    }

    public static HardwareFingerprintSnapshot FromValues(string? cpuId, string? mainboardUuid, string? osDiskSerial, string? machineName = null, string? platform = null, string? macAddress = null)
    {
        return new HardwareFingerprintSnapshot(
            Normalize(cpuId),
            Normalize(mainboardUuid),
            Normalize(osDiskSerial),
            Normalize(machineName ?? Environment.MachineName),
            Normalize(platform ?? Environment.OSVersion.Platform.ToString()),
            DateTime.UtcNow,
            Normalize(macAddress)
        );
    }

    /// <summary>
    /// Đối chiếu MAC card mạng vật lý — dùng riêng khi nạp license Add-on (mục 3 tài liệu spec).
    /// Không tham gia thuật toán khớp 2/3 (chỉ CPU ID, Motherboard UUID, Main Disk Serial).
    /// Trả về true nếu một trong hai bên không có MAC (best-effort, tránh false-reject).
    /// </summary>
    public static bool MacMatches(HardwareFingerprintSnapshot? left, HardwareFingerprintSnapshot? right)
    {
        var leftMac = left?.MacAddress;
        var rightMac = right?.MacAddress;
        if (string.IsNullOrWhiteSpace(leftMac) || string.IsNullOrWhiteSpace(rightMac))
            return true;

        return Normalize(leftMac) == Normalize(rightMac);
    }

    private static void CompareField(string? left, string? right, ref int compared, ref int matched)
    {
        if (string.IsNullOrWhiteSpace(left) || string.IsNullOrWhiteSpace(right))
            return;

        compared += 1;
        if (Normalize(left) == Normalize(right))
            matched += 1;
    }

    internal static string Normalize(string? value)
    {
        if (string.IsNullOrWhiteSpace(value))
            return string.Empty;

        return Regex.Replace(value.Trim().ToUpperInvariant(), @"[^A-Z0-9]+", string.Empty);
    }

    private static string FirstNonEmpty(params string?[] values)
    {
        foreach (var value in values)
        {
            if (!string.IsNullOrWhiteSpace(value))
                return value.Trim();
        }
        return string.Empty;
    }

    private static string? TryReadWindowsWmic(string category, string field, string command)
    {
        if (!OperatingSystem.IsWindows())
            return null;

        return RunCommandAndParseSingleValue("wmic", command.Replace("wmic ", string.Empty));
    }

    private static string? TryReadWindowsDiskSerial()
    {
        if (!OperatingSystem.IsWindows())
            return null;

        // Chỉ quét ổ đĩa vật lý chứa phân vùng hệ điều hành (ổ C:), loại trừ hoàn toàn
        // USB/ổ ngoài cắm rời — cắm/rút thiết bị ngoại vi không được làm lệch vân tay.
        return FirstNonEmpty(
            // Ưu tiên 1: serial ổ đĩa vật lý thực sự đứng sau phân vùng C: (chính xác nhất).
            RunCommandAndParseSingleValue(
                "powershell",
                "-NoProfile -NonInteractive -Command \"(Get-Partition -DriveLetter C | Get-Disk).SerialNumber\"",
                timeoutMs: 4000),
            // Ưu tiên 2: serial số volume của riêng ổ C: qua wmic — vẫn chỉ giới hạn ở ổ C:.
            RunCommandAndParseSingleValue("wmic", "logicaldisk where DeviceID='C:' get VolumeSerialNumber"),
            // Phương án cuối cùng (best-effort) — chỉ dùng khi cả hai cách trên đều thất bại,
            // KHÔNG được ưu tiên vì có thể liệt kê nhầm ổ USB/ổ ngoài đang cắm.
            RunCommandAndParseSingleValue("wmic", "diskdrive get SerialNumber")
        );
    }

    private static string? TryReadWindowsPhysicalMac()
    {
        if (!OperatingSystem.IsWindows())
            return null;

        // Get-NetAdapter -Physical loại trừ toàn bộ adapter ảo (Hyper-V vSwitch, VPN,
        // loopback, WFP filter...) — chỉ trả về card mạng vật lý onboard/PCIe.
        return RunCommandAndParseSingleValue(
            "powershell",
            "-NoProfile -NonInteractive -Command \"Get-NetAdapter -Physical | " +
            "Where-Object { $_.Status -ne 'Disabled' } | " +
            "Sort-Object -Property InterfaceIndex | " +
            "Select-Object -First 1 -ExpandProperty MacAddress\"",
            timeoutMs: 4000);
    }

    private static string? TryReadLinuxPhysicalMac()
    {
        if (OperatingSystem.IsWindows())
            return null;

        try
        {
            const string netDir = "/sys/class/net";
            if (!Directory.Exists(netDir))
                return null;

            var virtualPrefixes = new[] { "lo", "veth", "docker", "br-", "virbr", "tun", "tap", "wg", "vmnet", "vboxnet" };

            foreach (var ifaceDir in Directory.GetDirectories(netDir).OrderBy(d => d, StringComparer.OrdinalIgnoreCase))
            {
                var iface = Path.GetFileName(ifaceDir);
                if (virtualPrefixes.Any(prefix => iface.StartsWith(prefix, StringComparison.OrdinalIgnoreCase)))
                    continue;

                // Card mạng vật lý có symlink "device" trỏ tới thiết bị PCI/USB thật;
                // adapter thuần ảo (bridge, vpn...) thì không có.
                if (!Directory.Exists(Path.Combine(ifaceDir, "device")))
                    continue;

                var mac = ReadFileIfExists(Path.Combine(ifaceDir, "address"));
                if (!string.IsNullOrWhiteSpace(mac) && mac != "00:00:00:00:00:00")
                    return mac;
            }
        }
        catch
        {
            // Best effort only.
        }

        return null;
    }

    private static string? TryReadLinuxCpuId()
    {
        if (OperatingSystem.IsWindows())
            return null;

        var cpuInfo = ReadFileIfExists("/proc/cpuinfo");
        if (!string.IsNullOrWhiteSpace(cpuInfo))
        {
            var serialLine = cpuInfo
                .Split('\n', StringSplitOptions.RemoveEmptyEntries | StringSplitOptions.TrimEntries)
                .FirstOrDefault(line => line.StartsWith("Serial", StringComparison.OrdinalIgnoreCase));
            if (!string.IsNullOrWhiteSpace(serialLine))
            {
                var parts = serialLine.Split(':', 2);
                if (parts.Length == 2)
                    return parts[1].Trim();
            }

            var modelLine = cpuInfo
                .Split('\n', StringSplitOptions.RemoveEmptyEntries | StringSplitOptions.TrimEntries)
                .FirstOrDefault(line => line.StartsWith("model name", StringComparison.OrdinalIgnoreCase));
            if (!string.IsNullOrWhiteSpace(modelLine))
            {
                var parts = modelLine.Split(':', 2);
                if (parts.Length == 2)
                    return parts[1].Trim();
            }
        }

        return null;
    }

    private static string? TryReadLinuxDmiValue(string path)
    {
        if (OperatingSystem.IsWindows())
            return null;

        return ReadFileIfExists(path);
    }

    private static string? TryReadLinuxRootDiskSerial()
    {
        if (OperatingSystem.IsWindows())
            return null;

        try
        {
            var mounts = ReadFileIfExists("/proc/mounts");
            if (string.IsNullOrWhiteSpace(mounts))
                return null;

            var rootLine = mounts
                .Split('\n', StringSplitOptions.RemoveEmptyEntries | StringSplitOptions.TrimEntries)
                .FirstOrDefault(line => line.Contains(" / "));
            if (string.IsNullOrWhiteSpace(rootLine))
                return null;

            var source = rootLine.Split(' ', StringSplitOptions.RemoveEmptyEntries | StringSplitOptions.TrimEntries).FirstOrDefault();
            if (string.IsNullOrWhiteSpace(source))
                return null;

            var deviceName = source.StartsWith("/dev/", StringComparison.OrdinalIgnoreCase)
                ? source["/dev/".Length..]
                : Path.GetFileName(source);

            if (string.IsNullOrWhiteSpace(deviceName))
                return null;

            var candidates = new[]
            {
                $"/sys/class/block/{deviceName}/device/serial",
                $"/sys/class/block/{deviceName}/serial",
                $"/sys/block/{deviceName}/device/serial",
                $"/sys/block/{deviceName}/serial",
            };

            foreach (var candidate in candidates)
            {
                var value = ReadFileIfExists(candidate);
                if (!string.IsNullOrWhiteSpace(value))
                    return value;
            }
        }
        catch
        {
            // Best effort only.
        }

        return null;
    }

    private static string? ReadFileIfExists(string path)
    {
        try
        {
            if (!File.Exists(path))
                return null;
            return File.ReadAllText(path).Trim();
        }
        catch
        {
            return null;
        }
    }

    private static string? RunCommandAndParseSingleValue(string fileName, string arguments, int timeoutMs = 2000)
    {
        try
        {
            var psi = new ProcessStartInfo
            {
                FileName = fileName,
                Arguments = arguments,
                RedirectStandardOutput = true,
                RedirectStandardError = true,
                UseShellExecute = false,
                CreateNoWindow = true,
            };

            using var process = Process.Start(psi);
            if (process == null)
                return null;

            var output = process.StandardOutput.ReadToEnd();
            process.WaitForExit(timeoutMs);

            var lines = output
                .Split('\n', StringSplitOptions.RemoveEmptyEntries | StringSplitOptions.TrimEntries)
                .Where(line => !line.StartsWith("ProcessorId", StringComparison.OrdinalIgnoreCase))
                .Where(line => !line.StartsWith("UUID", StringComparison.OrdinalIgnoreCase))
                .Where(line => !line.StartsWith("SerialNumber", StringComparison.OrdinalIgnoreCase))
                .Where(line => !line.StartsWith("VolumeSerialNumber", StringComparison.OrdinalIgnoreCase))
                .Select(line => line.Trim())
                .Where(line => !string.IsNullOrWhiteSpace(line))
                .ToList();

            return lines.Count > 0 ? lines[0] : null;
        }
        catch
        {
            return null;
        }
    }
}

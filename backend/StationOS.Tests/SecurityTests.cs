// ============================================================
// SecurityTests — Kiểm thử chuyên sâu cho các tính năng bảo mật Phase 1
// Bao gồm: Mã hóa thông tin nhạy cảm (AES-256-GCM) và độ mạnh mật khẩu
// ============================================================
using System.Text.Json;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Configuration;
using Microsoft.Extensions.Logging;
using Moq;
using StationOS.Data;
using StationOS.Data.Entities;
using StationOS.Services.Auth;
using StationOS.Services.Security;
using Xunit;

namespace StationOS.Tests;

public class SecurityTests
{
    private readonly Mock<IConfiguration> _mockConfig;
    private readonly Mock<ILogger<CredentialEncryptionService>> _mockLogger;
    private readonly CredentialEncryptionService _encryptionService;

    public SecurityTests()
    {
        _mockConfig = new Mock<IConfiguration>();
        _mockLogger = new Mock<ILogger<CredentialEncryptionService>>();

        // Giả lập khóa STATIONOS_ENCRYPTION_KEY 32-bytes dạng base64
        // Key tương đương: "STATIONOS_SUPER_SECRET_KEY_FOR_TESTS_ONLY!!!" (32 bytes hash)
        var testKeyBytes = System.Security.Cryptography.SHA256.HashData(System.Text.Encoding.UTF8.GetBytes("TEST_KEY"));
        var testKeyBase64 = Convert.ToBase64String(testKeyBytes);
        
        Environment.SetEnvironmentVariable("STATIONOS_ENCRYPTION_KEY", testKeyBase64);
        
        _encryptionService = new CredentialEncryptionService(_mockConfig.Object, _mockLogger.Object);
    }

    // ── 1. KIỂM THỬ AES-256-GCM CREDENTIAL ENCRYPTION ──────────────────

    [Fact]
    public void EncryptDecrypt_RawString_ShouldReturnOriginalValue()
    {
        var rawPassword = "DemoPassword@2026!";
        
        // 1. Mã hóa
        var encrypted = _encryptionService.Encrypt(rawPassword);
        Assert.StartsWith("enc:v1:", encrypted);
        Assert.NotEqual(rawPassword, encrypted);

        // 2. Giải mã
        var decrypted = _encryptionService.Decrypt(encrypted);
        Assert.Equal(rawPassword, decrypted);
    }

    [Fact]
    public void Decrypt_LegacyPlainText_ShouldReturnOriginalValue()
    {
        var plainText = "Legacy_Plain_Text_Without_Prefix";
        // Nếu không có tiền tố enc:v1: thì hàm Decrypt phải trả về nguyên trạng để tương thích ngược
        var result = _encryptionService.Decrypt(plainText);
        Assert.Equal(plainText, result);
    }

    [Fact]
    public void EncryptDecrypt_ConfigJson_ShouldEncryptOnlyPasswordFields()
    {
        var configJson = """{"ip":"192.168.1.100","port":502,"password":"SecretPassword@123","username":"admin"}""";

        // 1. Mã hóa trường nhạy cảm trong JSON
        var encryptedJson = _encryptionService.EncryptPasswordInConfigJson(configJson);
        Assert.NotNull(encryptedJson);

        using var encDoc = JsonDocument.Parse(encryptedJson);
        var ip = encDoc.RootElement.GetProperty("ip").GetString();
        var port = encDoc.RootElement.GetProperty("port").GetInt32();
        var username = encDoc.RootElement.GetProperty("username").GetString();
        var password = encDoc.RootElement.GetProperty("password").GetString();

        Assert.Equal("192.168.1.100", ip);
        Assert.Equal(502, port);
        Assert.Equal("admin", username);
        Assert.StartsWith("enc:v1:", password);

        // 2. Giải mã trường nhạy cảm trong JSON
        var decryptedJson = _encryptionService.DecryptPasswordInConfigJson(encryptedJson);
        using var decDoc = JsonDocument.Parse(decryptedJson);
        var decPassword = decDoc.RootElement.GetProperty("password").GetString();
        Assert.Equal("SecretPassword@123", decPassword);
    }

    [Fact]
    public void RedactPassword_ConfigJson_ShouldReplacePasswordWithAsterisks()
    {
        var configJson = """{"ip":"192.168.1.100","password":"DemoPassword123","secret":"SuperSecret"}""";
        
        var redactedJson = _encryptionService.RedactPasswordInConfigJson(configJson);
        using var doc = JsonDocument.Parse(redactedJson);
        
        Assert.Equal("192.168.1.100", doc.RootElement.GetProperty("ip").GetString());
        Assert.Equal("***", doc.RootElement.GetProperty("password").GetString());
        Assert.Equal("***", doc.RootElement.GetProperty("secret").GetString());
    }

    // ── 2. KIỂM THỬ ĐỘ MẠNH MẬT KHẨU (PASSWORD STRENGTH) ────────────────

    private static AppDbContext CreateInMemoryDb()
    {
        var opts = new DbContextOptionsBuilder<AppDbContext>()
            .UseInMemoryDatabase(Guid.NewGuid().ToString())
            .Options;
        return new AppDbContext(opts);
    }

    [Theory]
    // Quá ngắn (< 12 ký tự)
    [InlineData("Short123!", false, "Mật khẩu mới phải có độ dài tối thiểu 12 ký tự")]
    // Thiếu chữ cái viết HOA
    [InlineData("lowercase123!", false, "Mật khẩu mới phải chứa ít nhất 1 chữ cái viết HOA")]
    // Thiếu chữ cái viết thường
    [InlineData("UPPERCASE123!", false, "Mật khẩu mới phải chứa ít nhất 1 chữ cái viết thường")]
    // Thiếu chữ số
    [InlineData("NoDigitsHere!", false, "Mật khẩu mới phải chứa ít nhất 1 chữ số")]
    // Thiếu ký tự đặc biệt
    [InlineData("NoSpecialChars123", false, "Mật khẩu mới phải chứa ít nhất 1 ký tự đặc biệt")]
    // Mật khẩu hợp lệ hoàn chỉnh
    [InlineData("ValidSecurePassword@2026", true, null)]
    public async Task ChangePassword_StrengthValidation_ShouldMatchPolicies(string newPassword, bool expectedOk, string? expectedErrorSnippet)
    {
        using var db = CreateInMemoryDb();
        var authConfig = new Mock<IConfiguration>();
        var cryptoLogger = new Mock<ILogger<CredentialEncryptionService>>();
        var crypto = new CredentialEncryptionService(authConfig.Object, cryptoLogger.Object);
        var authService = new AuthService(db, authConfig.Object, crypto);

        // Tạo user mẫu
        var userId = Guid.NewGuid();
        var oldPlainPassword = "OldPassword@123";
        var user = new User
        {
            Id = userId,
            Username = "testoperator",
            PasswordHash = BCrypt.Net.BCrypt.HashPassword(oldPlainPassword, workFactor: 12),
            Role = "operator",
            IsActive = true
        };
        db.Users.Add(user);
        await db.SaveChangesAsync();

        // Đổi mật khẩu
        var (ok, error) = await authService.ChangePasswordAsync(userId, oldPlainPassword, newPassword);

        Assert.Equal(expectedOk, ok);
        if (!expectedOk)
        {
            Assert.NotNull(error);
            Assert.Contains(expectedErrorSnippet!, error);
        }
        else
        {
            Assert.Null(error);
            // Verify hash mới hoạt động
            var updatedUser = await db.Users.FindAsync(userId);
            Assert.True(BCrypt.Net.BCrypt.Verify(newPassword, updatedUser!.PasswordHash));
            Assert.False(updatedUser.MustChangePassword);
        }
    }
}

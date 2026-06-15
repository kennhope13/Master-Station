using System.Net;
using System.Net.Sockets;

namespace StationOS.Api.Services;

/// <summary>
/// Forward port 14173 (0.0.0.0) → 127.0.0.1:4173
/// Electron chỉ bind localhost:4173, service này cho phép truy cập qua IP mạng.
/// </summary>
public class ElectronProxyService : BackgroundService
{
    private const int PublicPort = 14173;
    private const string TargetHost = "127.0.0.1";
    private const int TargetPort = 4173;

    private readonly ILogger<ElectronProxyService> _logger;

    public ElectronProxyService(ILogger<ElectronProxyService> logger)
    {
        _logger = logger;
    }

    protected override async Task ExecuteAsync(CancellationToken stoppingToken)
    {
        var listener = new TcpListener(IPAddress.Any, PublicPort);
        try
        {
            listener.Start();
            _logger.LogInformation("[ElectronProxy] Listening on 0.0.0.0:{Public} → {Target}:{TargetPort}",
                PublicPort, TargetHost, TargetPort);
        }
        catch (Exception ex)
        {
            _logger.LogWarning("[ElectronProxy] Cannot bind port {Port}: {Msg}", PublicPort, ex.Message);
            return;
        }

        try
        {
            while (!stoppingToken.IsCancellationRequested)
            {
                var client = await listener.AcceptTcpClientAsync(stoppingToken);
                client.NoDelay = true;
                _ = ForwardAsync(client, stoppingToken);
            }
        }
        finally
        {
            listener.Stop();
        }
    }

    private async Task ForwardAsync(TcpClient client, CancellationToken ct)
    {
        try
        {
            using var _ = client;
            using var target = new TcpClient { NoDelay = true };
            await target.ConnectAsync(TargetHost, TargetPort, ct);

            var clientStream = client.GetStream();
            var targetStream = target.GetStream();

            await Task.WhenAny(
                clientStream.CopyToAsync(targetStream, ct),
                targetStream.CopyToAsync(clientStream, ct)
            );
        }
        catch (OperationCanceledException) { }
        catch (Exception ex)
        {
            _logger.LogDebug("[ElectronProxy] Connection closed: {Msg}", ex.Message);
        }
    }
}

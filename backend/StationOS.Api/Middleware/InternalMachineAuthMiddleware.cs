using StationOS.Services.Security;

namespace StationOS.Api.Middleware;

public class InternalMachineAuthMiddleware
{
    private readonly RequestDelegate _next;

    public InternalMachineAuthMiddleware(RequestDelegate next)
    {
        _next = next;
    }

    public async Task InvokeAsync(HttpContext ctx, InternalAuthService internalAuth)
    {
        if (ctx.User?.Identity?.IsAuthenticated != true && internalAuth.IsAuthorized(ctx))
            ctx.User = internalAuth.CreatePrincipal();

        await _next(ctx);
    }
}

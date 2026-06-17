using Microsoft.AspNetCore.Mvc;
using Microsoft.AspNetCore.Mvc.Filters;
using StationOS.Services;

namespace StationOS.Api.Filters;

/// <summary>
/// Bộ lọc ủy quyền dựa trên Permission Key động.
/// Ví dụ sử dụng: [HasPermission("device:manage")]
/// </summary>
[AttributeUsage(AttributeTargets.Method | AttributeTargets.Class, AllowMultiple = true)]
public class HasPermissionAttribute : TypeFilterAttribute
{
    public HasPermissionAttribute(string permission) : base(typeof(HasPermissionFilter))
    {
        Arguments = new object[] { permission };
    }
}

public class HasPermissionFilter : IAsyncAuthorizationFilter
{
    private readonly string _permission;

    public HasPermissionFilter(string permission)
    {
        _permission = permission;
    }

    public async Task OnAuthorizationAsync(AuthorizationFilterContext context)
    {
        var httpContext = context.HttpContext;
        
        // Kiểm tra xem User đã đăng nhập chưa
        if (httpContext.User.Identity?.IsAuthenticated != true)
        {
            context.Result = new ChallengeResult();
            return;
        }

        // Lấy PermissionService từ DI Container
        var permissionService = httpContext.RequestServices.GetService(typeof(PermissionService)) as PermissionService;
        if (permissionService == null)
        {
            context.Result = new StatusCodeResult(StatusCodes.Status500InternalServerError);
            return;
        }

        // Thực hiện kiểm tra quyền
        var hasPermission = await permissionService.HasPermissionAsync(_permission);
        if (!hasPermission)
        {
            context.Result = new ForbidResult();
        }
    }
}

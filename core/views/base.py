from django.conf import settings
from django.http import JsonResponse
from django.shortcuts import render
from django.views.decorators.csrf import ensure_csrf_cookie


@ensure_csrf_cookie
def index_page(request, *args, **kwargs):
    return render(
        request,
        "index.html",
        {
            "app_build_timestamp": getattr(settings, "APP_BUILD_TIMESTAMP", ""),
            "app_github_repository": getattr(settings, "APP_GITHUB_REPOSITORY", "GabrielJean/FinGlass"),
            "app_github_default_branch": getattr(settings, "APP_GITHUB_DEFAULT_BRANCH", "main"),
            "app_version": getattr(settings, "APP_VERSION", "1.0.0"),
        },
    )


def health_view(request):
    return JsonResponse({"ok": True, "service": "django", "status": "healthy"})


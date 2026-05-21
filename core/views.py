from django.conf import settings
from django.db.models import Max
from django.http import JsonResponse
from django.shortcuts import render
from django.views.decorators.csrf import ensure_csrf_cookie

from core.models import ChequingTransaction, CreditCardTransaction, HoldingSnapshot, ImportBatch
from core.services.settings_service import get_feature_settings


@ensure_csrf_cookie
def login_page(request):
    return render(request, "login.html")


def index_page(request):
    return render(
        request,
        "index.html",
        {
            "app_build_timestamp": getattr(settings, "APP_BUILD_TIMESTAMP", ""),
            "app_github_repository": getattr(settings, "APP_GITHUB_REPOSITORY", "GabrielJean/FinGlass"),
            "app_github_default_branch": getattr(settings, "APP_GITHUB_DEFAULT_BRANCH", "main"),
        },
    )


def _feature_enabled(request, feature):
    settings = get_feature_settings(request.user)
    return settings.get(feature, True)


def security_page(request, security):
    if not _feature_enabled(request, "acb_tracker"):
        return JsonResponse({"error": "ACB tracker is disabled in settings"}, status=403)
    return render(request, "security.html", {"security": security})


def acb_page(request):
    if not _feature_enabled(request, "acb_tracker"):
        return JsonResponse({"error": "ACB tracker is disabled in settings"}, status=403)
    return render(request, "acb.html")


def credit_card_page(request):
    if not _feature_enabled(request, "credit_card"):
        return JsonResponse({"error": "Credit card feature is disabled in settings"}, status=403)
    provider = str(request.GET.get("provider") or "").strip()
    return render(request, "credit_card.html", {"provider": provider})


def chequing_page(request):
    if not _feature_enabled(request, "chequing_tracker"):
        return JsonResponse({"error": "Chequing tracker is disabled in settings"}, status=403)
    return render(request, "chequing.html")


def net_worth_page(request):
    if not _feature_enabled(request, "net_worth"):
        return JsonResponse({"error": "Net worth tracker is disabled in settings"}, status=403)
    return render(request, "net_worth.html")


def tfsa_page(request):
    if not _feature_enabled(request, "tfsa_tracker"):
        return JsonResponse({"error": "TFSA tracker is disabled in settings"}, status=403)
    return render(request, "tfsa.html")


def rrsp_page(request):
    if not _feature_enabled(request, "rrsp_tracker"):
        return JsonResponse({"error": "RRSP tracker is disabled in settings"}, status=403)
    return render(request, "rrsp.html")


def fhsa_page(request):
    if not _feature_enabled(request, "fhsa_tracker"):
        return JsonResponse({"error": "FHSA tracker is disabled in settings"}, status=403)
    return render(request, "fhsa.html")


def import_page(request):
    user_id = request.user.id
    last_import_used = {
        "transactions": ImportBatch.objects.filter(
            user_id=user_id,
            source_type="activities_csv",
            status="committed",
        ).aggregate(last_used=Max("committed_at"))["last_used"],
        "holdings": HoldingSnapshot.objects.filter(user_id=user_id).aggregate(last_used=Max("imported_at"))["last_used"],
        "credit_card": CreditCardTransaction.objects.filter(user_id=user_id).aggregate(last_used=Max("imported_at"))["last_used"],
        "chequing": ChequingTransaction.objects.filter(user_id=user_id).aggregate(last_used=Max("imported_at"))["last_used"],
        "tax_pdf": ImportBatch.objects.filter(
            user_id=user_id,
            source_type="tax_pdf",
            status="committed",
        ).aggregate(last_used=Max("committed_at"))["last_used"],
    }
    return render(request, "import_wizard.html", {"last_import_used": last_import_used})


def holdings_page(request):
    if not _feature_enabled(request, "holdings_overview"):
        return JsonResponse({"error": "Holdings overview is disabled in settings"}, status=403)
    return render(request, "holdings.html")


def admin_users_page(request):
    if not request.user.is_superuser:
        return JsonResponse({"error": "Superuser access required"}, status=403)
    return render(request, "admin_users.html")


def health_view(request):
    return JsonResponse({"ok": True, "service": "django", "status": "healthy"})

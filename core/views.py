from django.conf import settings
from django.db.models import Max
from django.http import JsonResponse
from django.shortcuts import render
from django.views.decorators.csrf import ensure_csrf_cookie

from core.models import ChequingTransaction, CreditCardTransaction, HoldingSnapshot, ImportBatch
from core.services.settings_service import get_feature_settings


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


login_page = index_page
security_page = index_page
acb_page = index_page
credit_card_page = index_page
chequing_page = index_page
net_worth_page = index_page
tfsa_page = index_page
rrsp_page = index_page
fhsa_page = index_page
import_page = index_page
holdings_page = index_page
retirement_page = index_page
admin_users_page = index_page


def health_view(request):
    return JsonResponse({"ok": True, "service": "django", "status": "healthy"})


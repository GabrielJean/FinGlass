import os
import sys
from pathlib import Path

BASE_DIR = Path(__file__).resolve().parent.parent

SECRET_KEY = os.getenv("SECRET_KEY", "dev-only-change-me")
DEBUG = os.getenv("DJANGO_DEBUG", "0") == "1"
ALLOWED_HOSTS = ["*"]

INSTALLED_APPS = [
    "django.contrib.admin",
    "django.contrib.auth",
    "django.contrib.contenttypes",
    "django.contrib.sessions",
    "django.contrib.messages",
    "django.contrib.staticfiles",
    "accounts",
    "core",
]

MIDDLEWARE = [
    "django.middleware.security.SecurityMiddleware",
    "django.contrib.sessions.middleware.SessionMiddleware",
    "django.middleware.common.CommonMiddleware",
    "django.middleware.csrf.CsrfViewMiddleware",
    "django.contrib.auth.middleware.AuthenticationMiddleware",
    "django.contrib.messages.middleware.MessageMiddleware",
    "django.middleware.clickjacking.XFrameOptionsMiddleware",
    "core.middleware.LoginRequiredMiddleware",
    "core.middleware.SecurityHeadersMiddleware",
]

if not DEBUG:
    MIDDLEWARE.insert(1, "whitenoise.middleware.WhiteNoiseMiddleware")

ROOT_URLCONF = "finglass_project.urls"

TEMPLATES = [
    {
        "BACKEND": "django.template.backends.django.DjangoTemplates",
        "DIRS": [BASE_DIR / "templates"],
        "APP_DIRS": True,
        "OPTIONS": {
            "context_processors": [
                "django.template.context_processors.request",
                "django.contrib.auth.context_processors.auth",
                "django.contrib.messages.context_processors.messages",
            ],
        },
    },
]

WSGI_APPLICATION = "finglass_project.wsgi.application"

DATABASES = {
    "default": {
        "ENGINE": "django.db.backends.sqlite3",
        "NAME": BASE_DIR / "data" / "finglass.sqlite3",
    }
}


def _skip_sqlite_path_validation():
    if os.getenv("SKIP_SQLITE_PATH_VALIDATION", "0") in {"1", "true", "True"}:
        return True

    # collectstatic is build-time safe without a writable runtime DB path.
    command = (sys.argv[1] if len(sys.argv) > 1 else "").strip().lower()
    return command == "collectstatic"


def _validate_sqlite_database_path():
    db_config = DATABASES.get("default", {})
    if db_config.get("ENGINE") != "django.db.backends.sqlite3":
        return

    if _skip_sqlite_path_validation():
        return

    db_path = Path(db_config.get("NAME", "")).expanduser()
    parent_dir = db_path.parent

    if db_path.exists():
        if not os.access(db_path, os.R_OK | os.W_OK):
            raise RuntimeError(
                f"SQLite database is not readable/writable: {db_path}. "
                "Fix ownership/permissions for the runtime user."
            )
        return

    if not parent_dir.exists():
        raise RuntimeError(
            f"SQLite directory does not exist: {parent_dir}. "
            "Create it before starting the app."
        )

    if not os.access(parent_dir, os.R_OK | os.W_OK | os.X_OK):
        raise RuntimeError(
            f"SQLite directory is not accessible: {parent_dir}. "
            "Grant read/write/execute permissions to the runtime user."
        )


_validate_sqlite_database_path()

AUTH_PASSWORD_VALIDATORS = []

LANGUAGE_CODE = "en-ca"
TIME_ZONE = "UTC"
USE_I18N = True
USE_TZ = True

STATIC_URL = "/static/"
STATICFILES_DIRS = [BASE_DIR / "static"]
STATIC_ROOT = BASE_DIR / "staticfiles"
if DEBUG:
    STATICFILES_STORAGE = "django.contrib.staticfiles.storage.StaticFilesStorage"
else:
    STATICFILES_STORAGE = "whitenoise.storage.CompressedManifestStaticFilesStorage"

DEFAULT_AUTO_FIELD = "django.db.models.BigAutoField"
AUTH_USER_MODEL = "accounts.User"

LOGIN_URL = "/login"
SESSION_COOKIE_HTTPONLY = True
SESSION_COOKIE_SAMESITE = "Strict"
SESSION_COOKIE_SECURE = os.getenv("SESSION_COOKIE_SECURE", "0") in {"1", "true", "True"}
SESSION_COOKIE_AGE = 60 * 60 * 24 * 30

CSRF_COOKIE_NAME = "csrf_token"
CSRF_HEADER_NAME = "HTTP_X_CSRF_TOKEN"
CSRF_COOKIE_HTTPONLY = False
CSRF_COOKIE_SAMESITE = "Strict"
CSRF_COOKIE_SECURE = SESSION_COOKIE_SECURE
CSRF_TRUSTED_ORIGINS = [h.strip() for h in os.getenv("CSRF_TRUSTED_ORIGINS", "").split(",") if h.strip()]

# Trust proxy headers for HTTPS detection behind reverse proxies/load balancers
SECURE_PROXY_SSL_HEADER = ("HTTP_X_FORWARDED_PROTO", "https")
USE_X_FORWARDED_HOST = os.getenv("USE_X_FORWARDED_HOST", "1") in {"1", "true", "True"}
SECURE_SSL_REDIRECT = os.getenv("SECURE_SSL_REDIRECT", "0") in {"1", "true", "True"}

X_FRAME_OPTIONS = "DENY"
SECURE_CONTENT_TYPE_NOSNIFF = True
SECURE_REFERRER_POLICY = "strict-origin-when-cross-origin"

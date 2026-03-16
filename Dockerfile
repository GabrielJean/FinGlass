FROM python:3.12-slim

WORKDIR /app

ARG APP_GITHUB_REPOSITORY=GabrielJean/FinGlass
ARG APP_GITHUB_DEFAULT_BRANCH=main

ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    PYTHONIOENCODING=utf-8 \
    APP_ENV=production \
    DJANGO_DEBUG=0 \
    APP_GITHUB_REPOSITORY=${APP_GITHUB_REPOSITORY} \
    APP_GITHUB_DEFAULT_BRANCH=${APP_GITHUB_DEFAULT_BRANCH}

COPY requirements.txt ./
RUN pip install --no-cache-dir -r requirements.txt

COPY . .

# Build timestamp fallback for update checks when no explicit SHA is injected.
RUN date -u +"%Y-%m-%dT%H:%M:%SZ" > /app/.app_build_timestamp

RUN python manage.py collectstatic --noinput

EXPOSE 8000

ENTRYPOINT ["/bin/bash", "/app/docker-entrypoint.sh"]

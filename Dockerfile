FROM node:22-alpine AS frontend
WORKDIR /build/frontend
COPY frontend/package*.json ./
RUN npm ci
COPY frontend ./
COPY VERSION ../VERSION
ARG APP_VERSION=""
ENV VITE_APP_VERSION=${APP_VERSION}
RUN npm run build

FROM python:3.12-slim

WORKDIR /app

ARG APP_GITHUB_REPOSITORY=GabrielJean/FinGlass
ARG APP_GITHUB_DEFAULT_BRANCH=main
ARG APP_VERSION=""

LABEL org.opencontainers.image.title="FinGlass"
LABEL org.opencontainers.image.description="FinGlass - Canadian Personal Wealth Intelligence"
LABEL org.opencontainers.image.url="https://github.com/${APP_GITHUB_REPOSITORY}"
LABEL org.opencontainers.image.source="https://github.com/${APP_GITHUB_REPOSITORY}"
LABEL org.opencontainers.image.version="${APP_VERSION}"
LABEL version="${APP_VERSION}"

ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    PYTHONIOENCODING=utf-8 \
    APP_ENV=production \
    DJANGO_DEBUG=0 \
    APP_GITHUB_REPOSITORY=${APP_GITHUB_REPOSITORY} \
    APP_GITHUB_DEFAULT_BRANCH=${APP_GITHUB_DEFAULT_BRANCH} \
    APP_VERSION=${APP_VERSION}

COPY requirements.txt ./
RUN pip install --no-cache-dir -r requirements.txt

COPY . .
COPY --from=frontend /build/static ./static

RUN mkdir -p /app/data && chmod +x /app/docker-entrypoint.sh

# Build timestamp fallback for update checks when no explicit SHA is injected.
RUN date -u +"%Y-%m-%dT%H:%M:%SZ" > /app/.app_build_timestamp

RUN python manage.py collectstatic --noinput

VOLUME ["/app/data"]
EXPOSE 8000

ENTRYPOINT ["/bin/bash", "/app/docker-entrypoint.sh"]
